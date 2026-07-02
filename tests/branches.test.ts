import * as fs from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { exportAuditLog } from "../src/exporters/audit-log";
import { exportConfig } from "../src/exporters/config";
import { exportContacts } from "../src/exporters/contacts";
import { exportDonations } from "../src/exporters/donations";
import { exportInvoices } from "../src/exporters/invoices";
import { exportPayments } from "../src/exporters/payments";
import * as waApi from "../src/wa-api";
import { silentLogger } from "../src/logger";
import { makeTempDir, rmTempDir } from "./helpers/temp-dir";
import {
  installFetchMock,
  jsonResponse,
  restoreFetchMock,
  textResponse,
  withAuthDefaults,
} from "./helpers/mock-fetch";

describe("branch coverage — exporters", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTempDir();
  });

  afterEach(() => {
    rmTempDir(tmpDir);
    restoreFetchMock();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("exportConfig uses default outDir and logs ok for non-list payloads", async () => {
    installFetchMock(
      withAuthDefaults(async (url) => {
        if (url.includes("/tenders")) return jsonResponse({ enabled: true });
        if (url.includes("/accounts/123456")) return jsonResponse({ Id: 123456 });
        return jsonResponse([]);
      }, 123456)
    );

    const result = await exportConfig({ apiKey: "key", accountId: 123456 });
    expect(result.outDir).toMatch(/exports[/\\]config$/);
  });

  it("exportContacts handles missing field values and object JSON fallback", async () => {
    installFetchMock(
      withAuthDefaults(async (url) => {
        if (url.includes("/contacts")) {
          return jsonResponse({
            Contacts: [
              { Id: 1, FieldValues: [] },
              {
                Id: 2,
                fieldValues: [{ fieldName: "Meta", value: { nested: true } }],
              },
            ],
          });
        }
        return jsonResponse([]);
      })
    );

    const result = await exportContacts({ apiKey: "key", accountId: 123456, outDir: tmpDir });
    expect(result.count).toBe(2);
  });

  it("exportPayments handles empty allocations and endDate-only filters", async () => {
    const urls: string[] = [];
    installFetchMock(
      withAuthDefaults(async (url) => {
        urls.push(url);
        if (url.includes("/payments")) {
          return jsonResponse({
            Items: [{ Id: 1, Value: 10 }],
          });
        }
        return jsonResponse({ Items: [] });
      })
    );

    const result = await exportPayments({
      apiKey: "key",
      accountId: 123456,
      endDate: "2026-12-31",
    });
    expect(result.count).toBe(1);
    expect(urls.some((u) => u.includes("EndDate=2026-12-31"))).toBe(true);
  });

  it("exportInvoices works with endDate only and default outDir", async () => {
    installFetchMock(withAuthDefaults(async () => jsonResponse({ Items: [{ Id: 3 }] })));
    const result = await exportInvoices({
      apiKey: "key",
      accountId: 123456,
      endDate: "2026-06-30",
    });
    expect(result.outDir).toMatch(/exports[/\\]invoices$/);
    expect(result.count).toBe(1);
  });

  it("exportDonations uses default outDir", async () => {
    installFetchMock(
      withAuthDefaults(async (url) => {
        if (url.includes("/donations")) return jsonResponse({ Items: [{ Id: 1 }] });
        return jsonResponse({ Items: [] });
      })
    );
    const result = await exportDonations({ apiKey: "key", accountId: 123456 });
    expect(result.outDir).toMatch(/exports[/\\]donations$/);
  });

  it("exportAuditLog accepts only startDate or only endDate", async () => {
    installFetchMock(
      withAuthDefaults(async (url) => {
        if (url.includes("/ListAuditLogItems")) return jsonResponse({ Items: [{ Id: 1 }] });
        return jsonResponse({ Items: [] });
      })
    );
    const byEnd = await exportAuditLog({
      apiKey: "key",
      accountId: 123456,
      outDir: tmpDir,
      endDate: "2026-05-01",
    });
    expect(byEnd.endDate).toBe("2026-05-01");

    const byStart = await exportAuditLog({
      apiKey: "key",
      accountId: 123456,
      outDir: tmpDir,
      startDate: "2026-01-01",
    });
    expect(byStart.startDate).toBe("2026-01-01");
  });

  it("exportConfig records non-Error failures", async () => {
    installFetchMock(
      withAuthDefaults(async (url) => {
        if (url.includes("/accounts/123456")) return jsonResponse({ Id: 123456 });
        return jsonResponse([]);
      }, 123456)
    );

    const originalGet = waApi.apiGet;
    vi.spyOn(waApi, "apiGet").mockImplementation(async (url, ...args) => {
      if (url.includes("/campaigns")) throw "plain failure";
      return originalGet(url, ...args);
    });

    const result = await exportConfig({ apiKey: "key", accountId: 123456, outDir: tmpDir });
    expect(result.failed.some((f) => f.name === "campaigns" && f.error === "plain failure")).toBe(
      true
    );
  });

  it("exportContacts handles scalar field arrays and bare contacts", async () => {
    installFetchMock(
      withAuthDefaults(async (url) => {
        if (url.includes("/contacts")) {
          return jsonResponse({
            Contacts: [
              {},
              {
                Id: 3,
                FieldValues: [{ FieldName: "Tags", Value: ["alpha", "beta"] }],
              },
            ],
          });
        }
        return jsonResponse([]);
      })
    );

    const result = await exportContacts({ apiKey: "key", accountId: 123456, outDir: tmpDir });
    expect(result.count).toBe(2);
  });

  it("exportPayments normalizes Allocations with Id-only rows", async () => {
    installFetchMock(
      withAuthDefaults(async (url) => {
        if (url.includes("/payments")) {
          return jsonResponse({
            Items: [{ Allocations: [{ InvoiceId: 9 }] }],
          });
        }
        return jsonResponse({ Items: [] });
      })
    );

    const result = await exportPayments({ apiKey: "key", accountId: 123456, outDir: tmpDir });
    const csv = fs.readFileSync(result.csvPath, "utf8");
    expect(csv).toContain("inv:9=");
  });

  it("exportAuditLog falls back when primary endpoint throws a non-Error", async () => {
    const originalPaginate = waApi.paginate;
    vi.spyOn(waApi, "paginate").mockImplementation(async (url, ...args) => {
      if (url.includes("ListAuditLogItems")) throw "rpc unavailable";
      return originalPaginate(url, ...args);
    });
    installFetchMock(
      withAuthDefaults(async (url) => {
        if (url.includes("/auditLogItems")) {
          return jsonResponse({ Items: [{ Id: 3, Timestamp: "2026-01-01T00:00:00Z" }] });
        }
        return jsonResponse({ Items: [] });
      })
    );

    const result = await exportAuditLog({
      apiKey: "key",
      accountId: 123456,
      outDir: tmpDir,
      startDate: "2026-01-01",
      endDate: "2026-01-31",
    });
    expect(result.count).toBe(1);
  });

  it("exportPayments reads lowercase allocations", async () => {
    installFetchMock(
      withAuthDefaults(async (url) => {
        if (url.includes("/payments")) {
          return jsonResponse({
            Items: [{ allocations: [{ invoiceId: 3, value: 5 }] }],
          });
        }
        return jsonResponse({ Items: [] });
      })
    );

    const result = await exportPayments({ apiKey: "key", accountId: 123456, outDir: tmpDir });
    const csv = fs.readFileSync(result.csvPath, "utf8");
    expect(csv).toContain("inv:3=5");
  });

  it("exportContacts flattens Label-only array entries and organization flat fields", async () => {
    installFetchMock(
      withAuthDefaults(async () =>
        jsonResponse({
          Contacts: [
            null,
            {
              Id: 4,
              FieldValues: [
                { FieldName: "Tags", Value: [{ Label: "VIP" }] },
                { FieldName: "Organization", Value: "Acme Corp" },
              ],
            },
          ],
        })
      )
    );

    const result = await exportContacts({ apiKey: "key", accountId: 123456, outDir: tmpDir });
    const csv = fs.readFileSync(result.csvPath, "utf8");
    expect(result.count).toBe(2);
    expect(csv).toContain("Acme Corp");
  });

  it("exportPayments handles null payment rows", async () => {
    installFetchMock(
      withAuthDefaults(async (url) => {
        if (url.includes("/payments")) {
          return jsonResponse({ Items: [null] });
        }
        return jsonResponse({ Items: [] });
      })
    );

    const result = await exportPayments({ apiKey: "key", accountId: 123456, outDir: tmpDir });
    expect(result.count).toBe(1);
  });
});

describe("branch coverage — wa-api", () => {
  afterEach(() => {
    restoreFetchMock();
    vi.useRealTimers();
  });

  it("extractItems reads AuditLogItems and hinted keys", () => {
    expect(waApi.extractItems({ AuditLogItems: [1] })).toEqual([1]);
    expect(waApi.extractItems({ Invoices: [2] }, "Invoices")).toEqual([2]);
  });

  it("discovers lowercase account id fields", async () => {
    installFetchMock(async (url) => {
      if (url.includes("/accounts") && !url.includes("/accounts/")) {
        return jsonResponse([{ accountId: 555 }]);
      }
      return jsonResponse([]);
    });
    await expect(waApi.discoverAccountId("token")).resolves.toBe(555);
  });

  it("throws when OAuth token request fails", async () => {
    installFetchMock(async (url) => {
      if (url.includes("oauth.wildapricot.org/auth/token")) {
        return textResponse("denied", 403);
      }
      return jsonResponse([]);
    });
    await expect(waApi.getAccessToken("key")).rejects.toThrow(/Token request failed/);
  });

  it("gives up on 401 after auth refresh budget is exhausted", async () => {
    const manager = waApi.createTokenManager("key");
    installFetchMock(async (url) => {
      if (url.includes("oauth.wildapricot.org/auth/token")) {
        return jsonResponse({ access_token: "tok", expires_in: 1800 });
      }
      return textResponse("unauthorized", 401);
    });

    await expect(
      waApi.apiFetch("https://example.test/protected", manager, {
        authRefreshRetries: 0,
        retries: 0,
        logger: silentLogger,
      })
    ).rejects.toMatchObject({ status: 401 });
  });

  it("asyncQuery returns without resultId when response has no inline items", async () => {
    installFetchMock(
      withAuthDefaults(async () => jsonResponse({ State: "Pending", ResultId: null }))
    );
    const manager = waApi.createTokenManager("key");
    const result = await waApi.asyncQuery(
      `${waApi.API_BASE}/accounts/1/contacts`,
      manager,
      {},
      {
        logger: silentLogger,
      }
    );
    expect(result).toMatchObject({ State: "Pending" });
  });

  it("sleep rejects with a custom abort reason", async () => {
    const { sleep } = await import("../src/wa-api");
    const ac = new AbortController();
    const reason = new Error("custom abort");
    ac.abort(reason);
    await expect(sleep(10, ac.signal)).rejects.toBe(reason);
  });

  it("401 refresh succeeds and retries the original request", async () => {
    let apiCalls = 0;
    const manager = waApi.createTokenManager("key");
    installFetchMock(async (url, init) => {
      if (url.includes("oauth.wildapricot.org/auth/token")) {
        return jsonResponse({ access_token: "fresh", expires_in: 1800 });
      }
      apiCalls++;
      const auth = init?.headers && (init.headers as Record<string, string>).Authorization;
      if (apiCalls === 1) return textResponse("stale", 401);
      if (auth === "Bearer fresh") return jsonResponse({ ok: true });
      return textResponse("nope", 401);
    });

    await expect(
      waApi.apiFetch("https://example.test/retry", manager, { logger: silentLogger, retries: 0 })
    ).resolves.toEqual({ ok: true });
  });
});
