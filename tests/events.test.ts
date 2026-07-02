import * as fs from "node:fs";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { exportEvents } from "../src/exporters/events";
import { API_BASE } from "../src/wa-api";
import { makeTempDir, rmTempDir } from "./helpers/temp-dir";
import {
  installFetchMock,
  jsonResponse,
  restoreFetchMock,
  withAuthDefaults,
} from "./helpers/mock-fetch";

describe("exportEvents", () => {
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

  it("exports event list and detail payloads", async () => {
    installFetchMock(
      withAuthDefaults(async (url) => {
        if (url.includes("/events/42")) {
          return jsonResponse({ Id: 42, Name: "Annual Gala", Location: "Hall A" });
        }
        if (url.includes("/events")) {
          return jsonResponse({ Events: [{ Id: 42, Name: "Annual Gala" }] });
        }
        return jsonResponse([]);
      })
    );

    const p = exportEvents({
      apiKey: "key",
      accountId: 123456,
      outDir: tmpDir,
      requestDelayMs: 0,
      saveEveryN: 1,
    });
    await vi.runAllTimersAsync();
    const result = await p;

    expect(result.count).toBe(1);
    expect(result.failureCount).toBe(0);
    const events = JSON.parse(fs.readFileSync(result.jsonPath, "utf8")) as Array<{
      Location?: string;
    }>;
    expect(events[0].Location).toBe("Hall A");
    expect(fs.existsSync(path.join(result.outDir, "_partial.json"))).toBe(false);
  });

  it("resumes from partial state without refetching the event list", async () => {
    const eventsDir = path.join(tmpDir, "events");
    fs.mkdirSync(eventsDir, { recursive: true });
    fs.writeFileSync(
      path.join(eventsDir, "_partial.json"),
      JSON.stringify({
        eventList: [{ Id: 7, Name: "Cached Event" }],
        completedEventIds: [],
        detailedEventsById: {},
        failures: [],
      }),
      "utf8"
    );

    const listUrls: string[] = [];
    installFetchMock(
      withAuthDefaults(async (url) => {
        if (url.includes("/events?")) listUrls.push(url);
        if (url.includes("/events/7"))
          return jsonResponse({ Id: 7, Name: "Cached Event", Details: true });
        return jsonResponse([]);
      })
    );

    const p = exportEvents({
      apiKey: "key",
      accountId: 123456,
      outDir: tmpDir,
      requestDelayMs: 0,
    });
    await vi.runAllTimersAsync();
    await p;

    expect(listUrls).toHaveLength(0);
  });

  it("records detail failures and invokes onProgress", async () => {
    const progress: string[] = [];
    installFetchMock(
      withAuthDefaults(async (url) => {
        if (url.includes("/events/42")) return jsonResponse({ error: true }, 404);
        if (url.includes("/events/99")) return jsonResponse({ Id: 99, Name: "OK" });
        if (url.includes("/events")) {
          return jsonResponse({
            Events: [{ Id: 42, Name: "Bad" }, { eventId: 99, Title: "Good" }, { Name: "NoId" }],
          });
        }
        return jsonResponse([]);
      })
    );

    const p = exportEvents({
      apiKey: "key",
      accountId: 123456,
      outDir: tmpDir,
      requestDelayMs: 0,
      saveEveryN: 1,
      onProgress: (e) => progress.push(e.kind),
    });
    await vi.runAllTimersAsync();
    const result = await p;

    expect(result.failureCount).toBe(1);
    expect(result.failuresPath).toBeTruthy();
    expect(progress).toContain("start");
    expect(progress).toContain("finish");
  });

  it("follows explicit nextUrl pagination", async () => {
    installFetchMock(
      withAuthDefaults(async (url) => {
        if (url.includes("skip=0")) {
          return jsonResponse({
            Events: [{ Id: 1 }],
            NextUrl: `${url.split("?")[0]}?$top=100&$skip=100`,
          });
        }
        if (url.includes("skip=100")) {
          return jsonResponse({ Events: [{ Id: 2 }] });
        }
        if (url.includes("/events/1") || url.includes("/events/2")) {
          return jsonResponse({ Id: 1 });
        }
        return jsonResponse([]);
      })
    );

    const p = exportEvents({
      apiKey: "key",
      accountId: 123456,
      outDir: tmpDir,
      requestDelayMs: 0,
    });
    await vi.runAllTimersAsync();
    const result = await p;
    expect(result.count).toBe(2);
  });

  it("warns and restarts when partial cache is unreadable", async () => {
    const eventsDir = path.join(tmpDir, "events");
    fs.mkdirSync(eventsDir, { recursive: true });
    fs.writeFileSync(path.join(eventsDir, "_partial.json"), "{ corrupt", "utf8");

    installFetchMock(
      withAuthDefaults(async (url) => {
        if (url.includes("/events/1")) return jsonResponse({ Id: 1, Name: "Fresh" });
        if (url.includes("/events")) return jsonResponse({ Events: [{ Id: 1, Name: "Fresh" }] });
        return jsonResponse([]);
      })
    );

    const p = exportEvents({
      apiKey: "key",
      accountId: 123456,
      outDir: tmpDir,
      requestDelayMs: 0,
    });
    await vi.runAllTimersAsync();
    const result = await p;
    expect(result.count).toBe(1);
  });

  it("follows nextLink and lowercase events keys", async () => {
    const page2 = `${API_BASE}/accounts/123456/events?$top=100&$skip=100`;
    installFetchMock(
      withAuthDefaults(async (url) => {
        if (url.includes("skip=0")) {
          return jsonResponse({
            events: [{ Id: 1, Name: 'Party, "Big"' }],
            nextLink: page2,
          });
        }
        if (url.includes("skip=100")) {
          return jsonResponse({ items: [{ Id: 2, Title: "Second" }] });
        }
        if (url.includes("/events/1")) return jsonResponse({ Id: 1, Name: 'Party, "Big"' });
        if (url.includes("/events/2")) return jsonResponse({ Id: 2, Title: "Second" });
        return jsonResponse([]);
      })
    );

    const p = exportEvents({
      apiKey: "key",
      accountId: 123456,
      outDir: tmpDir,
      requestDelayMs: 0,
    });
    await vi.runAllTimersAsync();
    const result = await p;
    expect(result.count).toBe(2);
    expect(fs.readFileSync(path.join(result.outDir, "wild-apricot-events.csv"), "utf8")).toContain(
      '"Party, ""Big"""'
    );
  });

  it("resumes completed events and clears a stale failures file", async () => {
    const eventsDir = path.join(tmpDir, "events");
    fs.mkdirSync(eventsDir, { recursive: true });
    fs.writeFileSync(
      path.join(eventsDir, "_partial.json"),
      JSON.stringify({
        eventList: [{ Id: 1, Name: "Done" }],
        completedEventIds: ["1"],
        detailedEventsById: { "1": { Id: 1, Name: "Done", Location: "X" } },
        failures: [],
      }),
      "utf8"
    );
    fs.writeFileSync(path.join(eventsDir, "_detail_failures.json"), "[]", "utf8");

    installFetchMock(withAuthDefaults(async () => jsonResponse([])));

    const p = exportEvents({
      apiKey: "key",
      accountId: 123456,
      outDir: tmpDir,
      requestDelayMs: 0,
    });
    await vi.runAllTimersAsync();
    await p;

    expect(fs.existsSync(path.join(eventsDir, "_detail_failures.json"))).toBe(false);
  });

  it("paginates with a full first page via skip", async () => {
    const page1 = Array.from({ length: 100 }, (_, i) => ({ Id: i + 1, Name: `E${i + 1}` }));
    installFetchMock(
      withAuthDefaults(async (url) => {
        if (url.includes("skip=0") && url.includes("/events")) {
          return jsonResponse({ Items: page1 });
        }
        if (url.includes("skip=100") && url.includes("/events")) {
          return jsonResponse({ Items: [{ Id: 101, Name: "Last" }] });
        }
        if (url.includes("/events/")) return jsonResponse({ Id: 1, Name: "Detail" });
        return jsonResponse([]);
      })
    );

    const p = exportEvents({
      apiKey: "key",
      accountId: 123456,
      outDir: tmpDir,
      requestDelayMs: 0,
    });
    await vi.runAllTimersAsync();
    const result = await p;
    expect(result.count).toBe(101);
  });

  it("treats empty keyed list payloads as zero events", async () => {
    installFetchMock(
      withAuthDefaults(async (url) => {
        if (url.includes("/events") && url.includes("skip=0")) {
          return jsonResponse({});
        }
        return jsonResponse([]);
      })
    );

    const p = exportEvents({
      apiKey: "key",
      accountId: 123456,
      outDir: tmpDir,
      requestDelayMs: 0,
    });
    await vi.runAllTimersAsync();
    const result = await p;
    expect(result.count).toBe(0);
  });
});
