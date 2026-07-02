import * as fs from "node:fs";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  API_BASE,
  apiFetch,
  asyncQuery,
  createTokenManager,
  csvEscape,
  discoverAccountId,
  extractItems,
  getAccessToken,
  getAuthAndAccount,
  getNested,
  paginate,
  sleep,
  writeCsv,
  writeJson,
} from "../src/wa-api";
import { silentLogger } from "../src/logger";
import { makeTempDir, rmTempDir } from "./helpers/temp-dir";
import {
  installFetchMock,
  jsonResponse,
  restoreFetchMock,
  textResponse,
  withAuthDefaults,
} from "./helpers/mock-fetch";

describe("wa-api helpers", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTempDir();
  });

  afterEach(() => {
    rmTempDir(tmpDir);
    restoreFetchMock();
    vi.useRealTimers();
  });

  it("csvEscape handles quoting and nulls", () => {
    expect(csvEscape(null)).toBe("");
    expect(csvEscape("plain")).toBe("plain");
    expect(csvEscape('say "hi"')).toBe('"say ""hi"""');
    expect(csvEscape("a,b")).toBe('"a,b"');
    expect(csvEscape({ x: 1 })).toBe('"{""x"":1}"');
  });

  it("getNested walks alternate paths", () => {
    expect(getNested({ Id: 1, Contact: { Name: "Ada" } }, ["Contact.Name", "name"])).toBe("Ada");
    expect(getNested({}, ["missing"])).toBe("");
  });

  it("extractItems handles array and keyed payloads", () => {
    expect(extractItems([1, 2])).toEqual([1, 2]);
    expect(extractItems({ Contacts: [{ id: 1 }] })).toEqual([{ id: 1 }]);
    expect(extractItems({ items: [3] })).toEqual([3]);
    expect(extractItems({ Registrations: [4] })).toEqual([4]);
    expect(extractItems({ Events: [5], hint: "ignored" }, "Contacts")).toEqual([5]);
    expect(extractItems(null)).toEqual([]);
  });

  it("writeJson and writeCsv round-trip to disk", () => {
    const jsonPath = path.join(tmpDir, "out.json");
    const csvPath = path.join(tmpDir, "out.csv");
    writeJson({ ok: true }, jsonPath);
    writeCsv([{ a: 1, b: "x,y" }], ["a", "b"], csvPath);
    expect(JSON.parse(fs.readFileSync(jsonPath, "utf8"))).toEqual({ ok: true });
    expect(fs.readFileSync(csvPath, "utf8")).toContain('"x,y"');
  });

  it("sleep rejects when aborted before start", async () => {
    const ac = new AbortController();
    ac.abort();
    await expect(sleep(10, ac.signal)).rejects.toMatchObject({ name: "AbortError" });
  });

  it("sleep rejects when aborted during wait", async () => {
    vi.useFakeTimers();
    const ac = new AbortController();
    const p = sleep(1000, ac.signal);
    ac.abort();
    await expect(p).rejects.toMatchObject({ name: "AbortError" });
  });
});

describe("createTokenManager", () => {
  afterEach(() => {
    restoreFetchMock();
    vi.useRealTimers();
  });

  it("caches token and deduplicates concurrent refresh", async () => {
    let tokenCalls = 0;
    installFetchMock(async (url) => {
      if (url.includes("oauth.wildapricot.org/auth/token")) {
        tokenCalls++;
        return jsonResponse({ access_token: `tok-${tokenCalls}`, expires_in: 1800 });
      }
      return jsonResponse([]);
    });

    const manager = createTokenManager("key");
    const [a, b] = await Promise.all([manager.get(), manager.get()]);
    expect(a).toBe("tok-1");
    expect(b).toBe("tok-1");
    expect(tokenCalls).toBe(1);
  });

  it("refreshes proactively near expiry", async () => {
    vi.useFakeTimers();
    let tokenCalls = 0;
    installFetchMock(async (url) => {
      if (url.includes("oauth.wildapricot.org/auth/token")) {
        tokenCalls++;
        return jsonResponse({ access_token: `tok-${tokenCalls}`, expires_in: 120 });
      }
      return jsonResponse([]);
    });

    const manager = createTokenManager("key");
    await manager.get();
    expect(tokenCalls).toBe(1);

    vi.advanceTimersByTime(70_000);
    await manager.get();
    expect(tokenCalls).toBe(2);
  });
});

describe("apiFetch", () => {
  afterEach(() => {
    restoreFetchMock();
    vi.useRealTimers();
  });

  it("returns JSON on success", async () => {
    installFetchMock(async () => jsonResponse({ ok: true }));
    const data = await apiFetch("https://example.test/data", "raw-token");
    expect(data).toEqual({ ok: true });
  });

  it("handles 204 No Content", async () => {
    installFetchMock(async () => new Response(null, { status: 204 }));
    const data = await apiFetch("https://example.test/empty", "raw-token");
    expect(data).toBeNull();
  });

  it("fast-fails on 404", async () => {
    installFetchMock(async () => textResponse("missing", 404));
    await expect(
      apiFetch("https://example.test/missing", "raw-token", { retries: 0 })
    ).rejects.toMatchObject({ status: 404 });
  });

  it("retries 408 with exponential backoff", async () => {
    vi.useFakeTimers();
    let calls = 0;
    installFetchMock(async () => {
      calls++;
      if (calls < 3) return textResponse("timeout", 408);
      return jsonResponse({ ok: true });
    });

    const p = apiFetch("https://example.test/retry", "raw-token", {
      retries: 3,
      logger: silentLogger,
    });
    await vi.runAllTimersAsync();
    await expect(p).resolves.toEqual({ ok: true });
    expect(calls).toBe(3);
  });

  it("honors Retry-After on 429", async () => {
    vi.useFakeTimers();
    let calls = 0;
    installFetchMock(async () => {
      calls++;
      if (calls === 1) {
        return textResponse("slow down", 429, { "Retry-After": "5" });
      }
      return jsonResponse({ ok: true });
    });

    const p = apiFetch("https://example.test/rate", "raw-token", {
      rateLimitRetries: 2,
      logger: silentLogger,
    });
    await vi.runAllTimersAsync();
    await expect(p).resolves.toEqual({ ok: true });
    expect(calls).toBe(2);
  });

  it("refreshes token on 401 when manager is provided", async () => {
    let apiCalls = 0;
    let refreshCalls = 0;
    const manager = {
      isTokenManager: true as const,
      get: vi.fn(async () => (refreshCalls === 0 ? "stale" : "fresh")),
      refresh: vi.fn(async () => {
        refreshCalls++;
        return "fresh";
      }),
    };

    installFetchMock(async (_url, init) => {
      apiCalls++;
      const auth = init?.headers && (init.headers as Record<string, string>).Authorization;
      if (auth === "Bearer stale") return textResponse("unauthorized", 401);
      return jsonResponse({ ok: true });
    });

    const data = await apiFetch("https://example.test/auth", manager, {
      authRefreshRetries: 2,
      logger: silentLogger,
    });
    expect(data).toEqual({ ok: true });
    expect(manager.refresh).toHaveBeenCalledOnce();
    expect(apiCalls).toBe(2);
  });

  it("fails when token refresh throws after 401", async () => {
    const manager = {
      isTokenManager: true as const,
      get: vi.fn(async () => "stale"),
      refresh: vi.fn(async () => {
        throw "refresh broke";
      }),
    };

    installFetchMock(async () => textResponse("unauthorized", 401));

    await expect(
      apiFetch("https://example.test/auth", manager, {
        authRefreshRetries: 2,
        logger: silentLogger,
        retries: 0,
      })
    ).rejects.toMatchObject({ status: 401, message: /Failed to refresh access token/ });
  });

  it("parses non-JSON text responses", async () => {
    installFetchMock(async () =>
      textResponse("<xml>ok</xml>", 200, { "Content-Type": "application/xml" })
    );
    const data = await apiFetch("https://example.test/xml", "raw-token");
    expect(data).toBe("<xml>ok</xml>");
  });
});

describe("discoverAccountId", () => {
  afterEach(() => restoreFetchMock());

  it("returns Id from accounts listing", async () => {
    installFetchMock(async (url) => {
      if (url.includes("/accounts") && !url.includes("/accounts/")) {
        return jsonResponse([{ Id: 999 }]);
      }
      return jsonResponse([]);
    });
    const id = await discoverAccountId("token");
    expect(id).toBe(999);
  });

  it("throws when no accounts are returned", async () => {
    installFetchMock(async (url) => {
      if (url.includes("/accounts") && !url.includes("/accounts/")) {
        return jsonResponse([]);
      }
      return jsonResponse([]);
    });
    await expect(discoverAccountId("token")).rejects.toThrow(/No accounts found/);
  });

  it("throws when account record has no id field", async () => {
    installFetchMock(async (url) => {
      if (url.includes("/accounts") && !url.includes("/accounts/")) {
        return jsonResponse([{ Name: "NoId Org" }]);
      }
      return jsonResponse([]);
    });
    await expect(discoverAccountId("token")).rejects.toThrow(/Could not discover account ID/);
  });

  it("reads Accounts and items wrappers", async () => {
    installFetchMock(async (url) => {
      if (url.includes("/accounts") && !url.includes("/accounts/")) {
        return jsonResponse({ Accounts: [{ Id: 111 }] });
      }
      return jsonResponse([]);
    });
    await expect(discoverAccountId("token")).resolves.toBe(111);

    installFetchMock(async (url) => {
      if (url.includes("/accounts") && !url.includes("/accounts/")) {
        return jsonResponse({ items: [{ Id: 222 }] });
      }
      return jsonResponse([]);
    });
    await expect(discoverAccountId("token")).resolves.toBe(222);
  });
});

describe("paginate", () => {
  afterEach(() => restoreFetchMock());

  it("walks pages until a short page", async () => {
    installFetchMock(
      withAuthDefaults(async (url) => {
        if (url.includes("skip=0")) {
          return jsonResponse({ Items: [{ id: 1 }, { id: 2 }] });
        }
        if (url.includes("skip=2")) {
          return jsonResponse({ Items: [{ id: 3 }] });
        }
        return jsonResponse({ Items: [] });
      })
    );

    const manager = createTokenManager("key");
    const items = await paginate(`${API_BASE}/accounts/123/invoices`, manager, {
      top: 2,
      logger: silentLogger,
    });
    expect(items).toHaveLength(3);
  });
});

describe("asyncQuery", () => {
  afterEach(() => {
    restoreFetchMock();
    vi.useRealTimers();
  });

  it("returns inline Contacts without polling", async () => {
    installFetchMock(withAuthDefaults(async () => jsonResponse({ Contacts: [{ id: 8 }] })));
    const manager = createTokenManager("key");
    const result = await asyncQuery(
      `${API_BASE}/accounts/123/contacts`,
      manager,
      {},
      { logger: silentLogger }
    );
    expect(extractItems(result, "Contacts")).toEqual([{ id: 8 }]);
  });

  it("returns inline array responses from asyncQuery", async () => {
    installFetchMock(withAuthDefaults(async () => jsonResponse([{ id: 1 }, { id: 2 }])));
    const manager = createTokenManager("key");
    const result = await asyncQuery(
      `${API_BASE}/accounts/123/contacts`,
      manager,
      {},
      { logger: silentLogger }
    );
    expect(result).toEqual([{ id: 1 }, { id: 2 }]);
  });

  it("polls until State is Complete", async () => {
    vi.useFakeTimers();
    let polls = 0;
    installFetchMock(
      withAuthDefaults(async (url) => {
        if (!url.includes("resultId")) {
          return jsonResponse({ ResultId: "abc", State: "Pending" });
        }
        polls++;
        if (polls < 2) return jsonResponse({ State: "Running" });
        return jsonResponse({ State: "Complete", Contacts: [{ id: 7 }] });
      })
    );

    const manager = createTokenManager("key");
    const p = asyncQuery(
      `${API_BASE}/accounts/123/contacts`,
      manager,
      {},
      { logger: silentLogger }
    );
    await vi.runAllTimersAsync();
    const result = await p;
    expect(extractItems(result, "Contacts")).toEqual([{ id: 7 }]);
  });

  it("returns initial payload when no resultId is present", async () => {
    installFetchMock(
      withAuthDefaults(async () => jsonResponse({ State: "Complete", Items: [{ id: 3 }] }))
    );
    const manager = createTokenManager("key");
    const result = await asyncQuery(
      `${API_BASE}/accounts/123/contacts`,
      manager,
      {},
      { logger: silentLogger }
    );
    expect(extractItems(result)).toEqual([{ id: 3 }]);
  });

  it("times out when polling never completes", async () => {
    vi.useFakeTimers();
    installFetchMock(
      withAuthDefaults(async (url) => {
        if (!url.includes("resultId")) {
          return jsonResponse({ ResultId: "slow", State: "Pending" });
        }
        return jsonResponse({ State: "Running" });
      })
    );
    const manager = createTokenManager("key");
    const p = asyncQuery(
      `${API_BASE}/accounts/123/contacts`,
      manager,
      {},
      { logger: silentLogger }
    );
    const assertion = expect(p).rejects.toThrow(/Async query timed out/);
    await vi.runAllTimersAsync();
    await assertion;
  });
});

describe("getAuthAndAccount", () => {
  afterEach(() => restoreFetchMock());

  it("uses provided accountId and primes token manager", async () => {
    installFetchMock(withAuthDefaults(async () => jsonResponse([])));
    const auth = await getAuthAndAccount({ apiKey: "key", accountId: 42, logger: silentLogger });
    expect(auth.accountId).toBe(42);
    expect(auth.token).toBe("test-token");
    expect(auth.tokenManager.isTokenManager).toBe(true);
  });

  it("throws when apiKey is missing", async () => {
    await expect(getAuthAndAccount({ apiKey: "" })).rejects.toThrow(/Missing apiKey/);
  });

  it("discovers accountId when omitted", async () => {
    installFetchMock(withAuthDefaults(async () => jsonResponse([])));
    const auth = await getAuthAndAccount({ apiKey: "key", logger: silentLogger });
    expect(auth.accountId).toBe(123456);
  });
});

describe("getAccessToken", () => {
  afterEach(() => restoreFetchMock());

  it("returns bearer token from OAuth endpoint", async () => {
    installFetchMock(async (url) => {
      if (url.includes("oauth.wildapricot.org/auth/token")) {
        return jsonResponse({ access_token: "direct-token", expires_in: 1800 });
      }
      return jsonResponse([]);
    });
    await expect(getAccessToken("key")).resolves.toBe("direct-token");
  });

  it("throws when apiKey is empty", async () => {
    await expect(getAccessToken("")).rejects.toThrow(/Missing WILD_APRICOT_API_KEY/);
  });
});

describe("apiFetch edge cases", () => {
  afterEach(() => {
    restoreFetchMock();
    vi.useRealTimers();
  });

  it("gives up after too many 429 responses", async () => {
    vi.useFakeTimers();
    installFetchMock(async () => textResponse("slow", 429));
    const p = apiFetch("https://example.test/rate", "raw-token", {
      rateLimitRetries: 1,
      logger: silentLogger,
    });
    const assertion = expect(p).rejects.toMatchObject({ status: 429 });
    await vi.runAllTimersAsync();
    await assertion;
  });

  it("rejects when createTokenManager gets an empty api key", () => {
    expect(() => createTokenManager("")).toThrow(/Missing WILD_APRICOT_API_KEY/);
  });

  it("parses JSON body even when content-type is not application/json", async () => {
    installFetchMock(async () =>
      textResponse('{"ok":true}', 200, { "Content-Type": "text/plain" })
    );
    await expect(apiFetch("https://example.test/json", "raw-token")).resolves.toEqual({ ok: true });
  });
});
