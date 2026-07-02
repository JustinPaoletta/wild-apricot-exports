import * as fs from "node:fs";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { exportRegistrations } from "../src/exporters/registrations";
import { retryEventFailures } from "../src/exporters/retry-events";
import { makeTempDir, rmTempDir } from "./helpers/temp-dir";
import {
  installFetchMock,
  jsonResponse,
  restoreFetchMock,
  withAuthDefaults,
} from "./helpers/mock-fetch";

describe("exportRegistrations", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTempDir();
    vi.useFakeTimers();
  });

  afterEach(() => {
    rmTempDir(tmpDir);
    restoreFetchMock();
    vi.useRealTimers();
  });

  it("uses caller-supplied events and writes registration outputs", async () => {
    installFetchMock(
      withAuthDefaults(async (url) => {
        if (url.includes("eventregistrations")) {
          return jsonResponse([
            { Id: 100, Contact: { Id: 1, FirstName: "Bob", Email: "bob@example.com" } },
          ]);
        }
        return jsonResponse([]);
      })
    );

    const p = exportRegistrations({
      apiKey: "key",
      accountId: 123456,
      outDir: tmpDir,
      events: [{ Id: 42, Name: "Meetup" }],
      requestDelayMs: 0,
      saveEveryN: 1,
    });
    await vi.runAllTimersAsync();
    const result = await p;

    expect(result.count).toBe(1);
    expect(fs.existsSync(result.jsonPath)).toBe(true);
    const csv = fs.readFileSync(result.csvPath, "utf8");
    expect(csv).toContain("Bob");
  });

  it("fetches the event list when events are not supplied", async () => {
    installFetchMock(
      withAuthDefaults(async (url) => {
        if (url.includes("/events") && url.includes("skip=0")) {
          return jsonResponse({ Items: [{ Id: 5, Name: "Fetched" }] });
        }
        if (url.includes("eventregistrations")) {
          return jsonResponse({ Registrations: [{ Id: 1, Contact: { Id: 2 } }] });
        }
        return jsonResponse({ Items: [] });
      })
    );

    const p = exportRegistrations({
      apiKey: "key",
      accountId: 123456,
      outDir: tmpDir,
      requestDelayMs: 0,
    });
    await vi.runAllTimersAsync();
    const result = await p;
    expect(result.count).toBe(1);
  });

  it("resumes from partial state and records per-event failures", async () => {
    const regDir = path.join(tmpDir, "registrations");
    fs.mkdirSync(regDir, { recursive: true });
    fs.writeFileSync(
      path.join(regDir, "registrations.partial.json"),
      JSON.stringify({
        completedEventIds: ["1"],
        registrations: [{ Id: 50, _event: { Id: 1, Name: "Done" } }],
        failures: [],
      }),
      "utf8"
    );

    installFetchMock(
      withAuthDefaults(async (url) => {
        if (url.includes("eventregistrations") && url.includes("eventId=2")) {
          return jsonResponse([], 500);
        }
        if (url.includes("eventregistrations")) {
          return jsonResponse([{ Id: 51 }]);
        }
        return jsonResponse([]);
      })
    );

    const p = exportRegistrations({
      apiKey: "key",
      accountId: 123456,
      outDir: tmpDir,
      events: [
        { Id: 1, Name: "Done" },
        { Id: 2, Name: "Broken" },
        { Id: 3, Name: "Fresh" },
      ],
      requestDelayMs: 0,
      saveEveryN: 1,
    });
    await vi.runAllTimersAsync();
    const result = await p;

    expect(result.count).toBe(2);
    expect(result.failureCount).toBe(1);
    expect(result.failuresPath).toBeTruthy();
  });

  it("handles unreadable partial cache and Registrations wrapper responses", async () => {
    const regDir = path.join(tmpDir, "registrations");
    fs.mkdirSync(regDir, { recursive: true });
    fs.writeFileSync(path.join(regDir, "registrations.partial.json"), "{bad", "utf8");

    installFetchMock(
      withAuthDefaults(async (url) => {
        if (url.includes("eventregistrations")) {
          return jsonResponse({ Registrations: [{ Id: 77, Contact: { Id: 1 } }] });
        }
        return jsonResponse([]);
      })
    );

    const p = exportRegistrations({
      apiKey: "key",
      accountId: 123456,
      outDir: tmpDir,
      events: [{ Id: 4, Name: "Wrap" }],
      requestDelayMs: 0,
      onProgress: (e) => e.kind,
    });
    await vi.runAllTimersAsync();
    const result = await p;
    expect(result.count).toBe(1);
  });

  it("uses Items responses, skips id-less events, and removes stale failure files", async () => {
    const regDir = path.join(tmpDir, "registrations");
    fs.mkdirSync(regDir, { recursive: true });
    fs.writeFileSync(path.join(regDir, "_failures.json"), "[]", "utf8");

    installFetchMock(
      withAuthDefaults(async (url) => {
        if (url.includes("eventregistrations")) {
          return jsonResponse({
            Items: [
              {
                id: 10,
                contact: { firstName: "Sam", email: "sam@example.com" },
                RegistrationType: { Name: "Guest", Id: 1 },
              },
            ],
          });
        }
        return jsonResponse([]);
      })
    );

    const p = exportRegistrations({
      apiKey: "key",
      accountId: 123456,
      outDir: tmpDir,
      events: [null, { Title: "No id event" }, { id: 8, Title: "Gala" }],
      requestDelayMs: 0,
    });
    await vi.runAllTimersAsync();
    const result = await p;

    expect(result.count).toBe(1);
    expect(result.failureCount).toBe(0);
    expect(fs.existsSync(path.join(regDir, "_failures.json"))).toBe(false);
    const csv = fs.readFileSync(result.csvPath, "utf8");
    expect(csv).toContain("Sam");
    expect(csv).toContain("Gala");
  });

  it("ignores partial cache with invalid shape", async () => {
    const regDir = path.join(tmpDir, "registrations");
    fs.mkdirSync(regDir, { recursive: true });
    fs.writeFileSync(
      path.join(regDir, "registrations.partial.json"),
      JSON.stringify({ completedEventIds: "not-array", registrations: [] }),
      "utf8"
    );

    installFetchMock(
      withAuthDefaults(async (url) => {
        if (url.includes("eventregistrations")) return jsonResponse([{ Id: 1 }]);
        return jsonResponse([]);
      })
    );

    const p = exportRegistrations({
      apiKey: "key",
      accountId: 123456,
      outDir: tmpDir,
      events: [{ Id: 3, Name: "Show" }],
      requestDelayMs: 0,
    });
    await vi.runAllTimersAsync();
    const result = await p;
    expect(result.count).toBe(1);
  });

  it("handles null registration rows and untitled event names", async () => {
    installFetchMock(
      withAuthDefaults(async (url) => {
        if (url.includes("eventregistrations")) {
          return jsonResponse({ Items: [null, { Id: 1 }] });
        }
        return jsonResponse([]);
      })
    );

    const p = exportRegistrations({
      apiKey: "key",
      accountId: 123456,
      outDir: tmpDir,
      events: [{ Id: 6, Title: "Gala night" }],
      requestDelayMs: 0,
    });
    await vi.runAllTimersAsync();
    const result = await p;
    expect(result.count).toBe(2);
  });

  it("accepts empty object registration responses", async () => {
    installFetchMock(
      withAuthDefaults(async (url) => {
        if (url.includes("eventregistrations")) return jsonResponse({});
        return jsonResponse([]);
      })
    );

    const p = exportRegistrations({
      apiKey: "key",
      accountId: 123456,
      outDir: tmpDir,
      events: [{ Id: 7, Name: "Empty" }],
      requestDelayMs: 0,
    });
    await vi.runAllTimersAsync();
    const result = await p;
    expect(result.count).toBe(0);
  });

  it("records non-Error registration fetch failures", async () => {
    const waApi = await import("../src/wa-api");
    const originalGet = waApi.apiGet;
    vi.spyOn(waApi, "apiGet").mockImplementation(async (url, ...args) => {
      if (url.includes("eventregistrations")) throw "broken registrations";
      return originalGet(url, ...args);
    });
    installFetchMock(withAuthDefaults(async () => jsonResponse([])));

    const p = exportRegistrations({
      apiKey: "key",
      accountId: 123456,
      outDir: tmpDir,
      events: [{ Id: 12, Name: "Fail" }],
      requestDelayMs: 0,
    });
    await vi.runAllTimersAsync();
    const result = await p;
    expect(result.failureCount).toBe(1);
    vi.restoreAllMocks();
  });
});

describe("retryEventFailures", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTempDir();
    vi.useFakeTimers();
    const eventsDir = path.join(tmpDir, "events");
    fs.mkdirSync(eventsDir, { recursive: true });
    fs.writeFileSync(
      path.join(eventsDir, "wild-apricot-events.json"),
      JSON.stringify([{ Id: 42, Name: "Meetup" }]),
      "utf8"
    );
    fs.writeFileSync(
      path.join(eventsDir, "_detail_failures.json"),
      JSON.stringify([{ eventId: 42, error: "timeout" }]),
      "utf8"
    );
  });

  afterEach(() => {
    rmTempDir(tmpDir);
    restoreFetchMock();
    vi.useRealTimers();
  });

  it("retries failed events and merges detail back into the export", async () => {
    installFetchMock(
      withAuthDefaults(async (url) => {
        if (url.includes("/events/42")) {
          return jsonResponse({ Id: 42, Name: "Meetup", Location: "Hall B" });
        }
        return jsonResponse([]);
      })
    );

    const p = retryEventFailures({
      apiKey: "key",
      accountId: 123456,
      outDir: tmpDir,
      requestDelayMs: 0,
    });
    await vi.runAllTimersAsync();
    const result = await p;

    expect(result.attempted).toBe(1);
    expect(result.recovered).toBe(1);
    const events = JSON.parse(fs.readFileSync(result.jsonPath, "utf8")) as Array<{
      Location?: string;
    }>;
    expect(events[0].Location).toBe("Hall B");
    expect(fs.existsSync(path.join(result.outDir, "_detail_failures.json"))).toBe(false);
  });

  it("returns early when failures file is empty", async () => {
    fs.writeFileSync(
      path.join(tmpDir, "events", "_detail_failures.json"),
      JSON.stringify([]),
      "utf8"
    );
    const result = await retryEventFailures({
      apiKey: "key",
      accountId: 123456,
      outDir: tmpDir,
    });
    expect(result.attempted).toBe(0);
  });

  it("retries events identified by eventId field", async () => {
    fs.writeFileSync(
      path.join(tmpDir, "events", "wild-apricot-events.json"),
      JSON.stringify([{ eventId: 77, title: "Alt id" }]),
      "utf8"
    );
    fs.writeFileSync(
      path.join(tmpDir, "events", "_detail_failures.json"),
      JSON.stringify([{ eventId: 77, error: "timeout" }]),
      "utf8"
    );

    installFetchMock(
      withAuthDefaults(async (url) => {
        if (url.includes("/events/77"))
          return jsonResponse({ eventId: 77, title: "Alt id", Location: "Room" });
        return jsonResponse([]);
      })
    );

    const p = retryEventFailures({
      apiKey: "key",
      accountId: 123456,
      outDir: tmpDir,
      requestDelayMs: 0,
    });
    await vi.runAllTimersAsync();
    const result = await p;
    expect(result.recovered).toBe(1);
  });

  it("returns early when no failures file exists", async () => {
    fs.rmSync(path.join(tmpDir, "events", "_detail_failures.json"));
    const result = await retryEventFailures({
      apiKey: "key",
      accountId: 123456,
      outDir: tmpDir,
    });
    expect(result.attempted).toBe(0);
  });

  it("keeps failures file when retry still fails", async () => {
    installFetchMock(
      withAuthDefaults(async (url) => {
        if (url.includes("/events/42")) return jsonResponse("nope", 500);
        return jsonResponse([]);
      })
    );

    const p = retryEventFailures({
      apiKey: "key",
      accountId: 123456,
      outDir: tmpDir,
      requestDelayMs: 0,
    });
    await vi.runAllTimersAsync();
    const result = await p;

    expect(result.stillFailingCount).toBe(1);
    expect(result.failuresPath).toBeTruthy();
  });

  it("throws when events JSON is missing", async () => {
    fs.rmSync(path.join(tmpDir, "events", "wild-apricot-events.json"));
    await expect(
      retryEventFailures({ apiKey: "key", accountId: 123456, outDir: tmpDir })
    ).rejects.toThrow(/Cannot find/);
  });

  it("uses default request delay and resolves EventId lookups", async () => {
    fs.writeFileSync(
      path.join(tmpDir, "events", "wild-apricot-events.json"),
      JSON.stringify([{ EventId: 88, Name: "E" }]),
      "utf8"
    );
    fs.writeFileSync(
      path.join(tmpDir, "events", "_detail_failures.json"),
      JSON.stringify([{ eventId: 88, error: "x" }]),
      "utf8"
    );

    installFetchMock(
      withAuthDefaults(async (url) => {
        if (url.includes("/events/88")) return jsonResponse({ EventId: 88, Name: "E" });
        return jsonResponse([]);
      })
    );

    const result = await retryEventFailures({ apiKey: "key", accountId: 123456, outDir: tmpDir });
    expect(result.recovered).toBe(1);
  });

  it("records non-Error failures while retrying", async () => {
    installFetchMock(
      withAuthDefaults(async (url) => {
        if (url.includes("/events/42")) throw "broken";
        return jsonResponse([]);
      })
    );

    const p = retryEventFailures({
      apiKey: "key",
      accountId: 123456,
      outDir: tmpDir,
      requestDelayMs: 0,
    });
    await vi.runAllTimersAsync();
    const result = await p;
    expect(result.stillFailingCount).toBe(1);
  });

  it("waits between multiple failure retries and preserves null event rows", async () => {
    fs.writeFileSync(
      path.join(tmpDir, "events", "wild-apricot-events.json"),
      JSON.stringify([null, { Id: 42, Name: "Meetup" }]),
      "utf8"
    );
    fs.writeFileSync(
      path.join(tmpDir, "events", "_detail_failures.json"),
      JSON.stringify([
        { eventId: 42, error: "timeout" },
        { eventId: 43, error: "timeout" },
      ]),
      "utf8"
    );

    installFetchMock(
      withAuthDefaults(async (url) => {
        if (url.includes("/events/42"))
          return jsonResponse({ Id: 42, Name: "Meetup", Location: "A" });
        if (url.includes("/events/43"))
          return jsonResponse({ Id: 43, Name: "Other", Location: "B" });
        return jsonResponse([]);
      })
    );

    const p = retryEventFailures({
      apiKey: "key",
      accountId: 123456,
      outDir: tmpDir,
      requestDelayMs: 0,
    });
    await vi.runAllTimersAsync();
    const result = await p;
    expect(result.recovered).toBe(2);
    expect(fs.existsSync(path.join(tmpDir, "events", "_detail_failures.json"))).toBe(false);
  });
});
