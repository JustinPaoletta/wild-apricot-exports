import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  exportAll: vi.fn().mockResolvedValue({ failedCount: 0 }),
  exportConfig: vi.fn().mockResolvedValue({ written: [], failed: [] }),
  exportEvents: vi.fn().mockResolvedValue({ count: 0, failureCount: 0 }),
  retryEventFailures: vi.fn().mockResolvedValue({ attempted: 0, recovered: 0 }),
  exportRegistrations: vi.fn().mockResolvedValue({ count: 0, failureCount: 0 }),
  exportContacts: vi.fn().mockResolvedValue({ count: 0 }),
  exportInvoices: vi.fn().mockResolvedValue({ count: 0 }),
  exportPayments: vi.fn().mockResolvedValue({ count: 0 }),
  exportDonations: vi.fn().mockResolvedValue({ count: 0 }),
  exportAuditLog: vi.fn().mockResolvedValue({ count: 0 }),
  exportFiles: vi
    .fn()
    .mockResolvedValue({ stats: { total: 0, downloaded: 0, skipped: 0, failed: 0 } }),
}));

vi.mock("../src/index", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/index")>();
  return {
    ...actual,
    exportAll: mocks.exportAll,
    exportConfig: mocks.exportConfig,
    exportEvents: mocks.exportEvents,
    retryEventFailures: mocks.retryEventFailures,
    exportRegistrations: mocks.exportRegistrations,
    exportContacts: mocks.exportContacts,
    exportInvoices: mocks.exportInvoices,
    exportPayments: mocks.exportPayments,
    exportDonations: mocks.exportDonations,
    exportAuditLog: mocks.exportAuditLog,
    exportFiles: mocks.exportFiles,
  };
});

import { buildCli } from "../src/cli/index";

const NODE_ARGS = ["node", "wa-export"] as const;
const API_KEY = ["--api-key", "test-key"] as const;

describe("CLI", () => {
  let exitSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    exitSpy = vi.spyOn(process, "exit").mockImplementation(((code?: number) => {
      throw new Error(`process.exit(${code ?? 0})`);
    }) as never);
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    delete process.env.WILD_APRICOT_API_KEY;
    delete process.env.WILD_APRICOT_ACCOUNT_ID;
    delete process.env.WILD_APRICOT_WEBDAV_URL;
    delete process.env.WILD_APRICOT_ADMIN_EMAIL;
    delete process.env.WILD_APRICOT_ADMIN_PASSWORD;
    delete process.env.WILD_APRICOT_FILE_DIRS;
    delete process.env.INVOICES_START_DATE;
    delete process.env.WA_EVENT_REQUEST_DELAY_MS;
  });

  afterEach(() => {
    exitSpy.mockRestore();
    errorSpy.mockRestore();
  });

  it("prints help for the root command", async () => {
    const chunks: string[] = [];
    vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
      chunks.push(String(chunk));
      return true;
    });
    await expect(buildCli().parseAsync([...NODE_ARGS, "-h"])).rejects.toThrow("process.exit(0)");
    expect(chunks.join("")).toContain("Export data from a Wild Apricot account");
  });

  it("reports version from package.json", () => {
    expect(buildCli().version()).toMatch(/\d+\.\d+\.\d+/);
  });

  it("requires an API key for REST exporters", async () => {
    await expect(buildCli().parseAsync([...NODE_ARGS, "contacts"])).rejects.toThrow(
      "process.exit(1)"
    );
    expect(errorSpy.mock.calls.flat().join(" ")).toMatch(/No API key/);
    expect(mocks.exportContacts).not.toHaveBeenCalled();
  });

  it("uses WILD_APRICOT_API_KEY from the environment", async () => {
    process.env.WILD_APRICOT_API_KEY = "env-key";
    process.env.WILD_APRICOT_ACCOUNT_ID = "abc-org";
    await buildCli().parseAsync([...NODE_ARGS, "contacts"]);
    expect(mocks.exportContacts).toHaveBeenCalledWith(
      expect.objectContaining({ apiKey: "env-key", accountId: "abc-org" })
    );
  });

  it("passes global flags through to exportContacts", async () => {
    await buildCli().parseAsync([
      ...NODE_ARGS,
      ...API_KEY,
      "--account-id",
      "999",
      "-o",
      "./out",
      "-q",
      "contacts",
    ]);
    expect(mocks.exportContacts).toHaveBeenCalledWith(
      expect.objectContaining({
        apiKey: "test-key",
        accountId: 999,
        outDir: expect.stringContaining(`${path.sep}out`),
      })
    );
  });

  it("routes config subcommand", async () => {
    await buildCli().parseAsync([...NODE_ARGS, ...API_KEY, "config"]);
    expect(mocks.exportConfig).toHaveBeenCalledOnce();
  });

  it("routes events with delay and checkpoint flags", async () => {
    process.env.WA_EVENT_REQUEST_DELAY_MS = "500";
    process.env.WA_EVENTS_SAVE_EVERY = "10";
    await buildCli().parseAsync([
      ...NODE_ARGS,
      ...API_KEY,
      "events",
      "--request-delay-ms",
      "100",
      "--save-every-n",
      "5",
    ]);
    expect(mocks.exportEvents).toHaveBeenCalledWith(
      expect.objectContaining({ requestDelayMs: 100, saveEveryN: 5 })
    );
  });

  it("routes retry-events subcommand", async () => {
    await buildCli().parseAsync([
      ...NODE_ARGS,
      ...API_KEY,
      "retry-events",
      "--request-delay-ms",
      "0",
    ]);
    expect(mocks.retryEventFailures).toHaveBeenCalledWith(
      expect.objectContaining({ requestDelayMs: 0 })
    );
  });

  it("routes registrations and reads cached events JSON when present", async () => {
    const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "wae-cli-"));
    const eventsDir = path.join(outDir, "events");
    fs.mkdirSync(eventsDir, { recursive: true });
    fs.writeFileSync(
      path.join(eventsDir, "wild-apricot-events.json"),
      JSON.stringify([{ Id: 1, Name: "Cached" }]),
      "utf8"
    );
    try {
      await buildCli().parseAsync([...NODE_ARGS, ...API_KEY, "-o", outDir, "registrations"]);
      expect(mocks.exportRegistrations).toHaveBeenCalledWith(
        expect.objectContaining({ events: [{ Id: 1, Name: "Cached" }] })
      );
    } finally {
      fs.rmSync(outDir, { recursive: true, force: true });
    }
  });

  it("routes invoices with date flags and env fallbacks", async () => {
    process.env.INVOICES_START_DATE = "2026-01-01";
    await buildCli().parseAsync([...NODE_ARGS, ...API_KEY, "invoices", "--end-date", "2026-06-30"]);
    expect(mocks.exportInvoices).toHaveBeenCalledWith(
      expect.objectContaining({ startDate: "2026-01-01", endDate: "2026-06-30" })
    );
  });

  it("routes payments and donations subcommands", async () => {
    await buildCli().parseAsync([...NODE_ARGS, ...API_KEY, "payments"]);
    await buildCli().parseAsync([
      ...NODE_ARGS,
      ...API_KEY,
      "donations",
      "--start-date",
      "2026-01-01",
    ]);
    expect(mocks.exportPayments).toHaveBeenCalledOnce();
    expect(mocks.exportDonations).toHaveBeenCalledWith(
      expect.objectContaining({ startDate: "2026-01-01" })
    );
  });

  it("routes audit-log subcommand", async () => {
    await buildCli().parseAsync([...NODE_ARGS, ...API_KEY, "audit-log"]);
    expect(mocks.exportAuditLog).toHaveBeenCalledOnce();
  });

  it("requires WebDAV credentials for files", async () => {
    await expect(buildCli().parseAsync([...NODE_ARGS, "files"])).rejects.toThrow("process.exit(1)");
    expect(mocks.exportFiles).not.toHaveBeenCalled();
  });

  it("routes files with WebDAV env and file-dirs flag", async () => {
    process.env.WILD_APRICOT_WEBDAV_URL = "https://org.wildapricot.org";
    process.env.WILD_APRICOT_ADMIN_EMAIL = "admin@example.com";
    process.env.WILD_APRICOT_ADMIN_PASSWORD = "secret";
    await buildCli().parseAsync([
      ...NODE_ARGS,
      "files",
      "--file-dirs",
      "Documents,Pictures",
      "--inter-file-delay-ms",
      "0",
      "--max-retries",
      "2",
      "--retry-base-ms",
      "100",
    ]);
    expect(mocks.exportFiles).toHaveBeenCalledWith(
      expect.objectContaining({
        fileDirs: ["Documents", "Pictures"],
        interFileDelayMs: 0,
        maxRetries: 2,
        retryBaseMs: 100,
      })
    );
  });

  it("routes files using WILD_APRICOT_FILE_DIRS from the environment", async () => {
    process.env.WILD_APRICOT_WEBDAV_URL = "https://org.wildapricot.org";
    process.env.WILD_APRICOT_ADMIN_EMAIL = "admin@example.com";
    process.env.WILD_APRICOT_ADMIN_PASSWORD = "secret";
    process.env.WILD_APRICOT_FILE_DIRS = "Documents,Pictures";
    await buildCli().parseAsync([...NODE_ARGS, "files"]);
    expect(mocks.exportFiles).toHaveBeenCalledWith(
      expect.objectContaining({ fileDirs: ["Documents", "Pictures"] })
    );
  });

  it("routes all with exclude and env-backed pacing options", async () => {
    process.env.WA_EVENT_REQUEST_DELAY_MS = "not-a-number";
    process.env.WA_REGISTRATIONS_SAVE_EVERY = "25";
    await buildCli().parseAsync([...NODE_ARGS, ...API_KEY, "all", "--exclude", "files,events"]);
    expect(mocks.exportAll).toHaveBeenCalledWith(
      expect.objectContaining({
        exclude: ["files", "events"],
        eventsOptions: expect.objectContaining({ requestDelayMs: undefined }),
        registrationsOptions: expect.objectContaining({ saveEveryN: 25 }),
      })
    );
  });

  it("routes all with include and exclude", async () => {
    process.env.WILD_APRICOT_WEBDAV_URL = "https://org.wildapricot.org";
    process.env.WILD_APRICOT_ADMIN_EMAIL = "admin@example.com";
    process.env.WILD_APRICOT_ADMIN_PASSWORD = "secret";
    await buildCli().parseAsync([
      ...NODE_ARGS,
      ...API_KEY,
      "all",
      "--include",
      "config,contacts",
      "--start-date",
      "2026-01-01",
      "--file-dirs",
      "Documents",
    ]);
    expect(mocks.exportAll).toHaveBeenCalledWith(
      expect.objectContaining({
        include: ["config", "contacts"],
        webdavUrl: "https://org.wildapricot.org",
        fileDirs: ["Documents"],
        invoicesOptions: expect.objectContaining({ startDate: "2026-01-01" }),
      })
    );
  });

  it("exits when an exporter throws", async () => {
    mocks.exportContacts.mockRejectedValueOnce(new Error("boom"));
    await expect(buildCli().parseAsync([...NODE_ARGS, ...API_KEY, "contacts"])).rejects.toThrow(
      "process.exit(1)"
    );
    expect(errorSpy.mock.calls.flat().join(" ")).toMatch(/FAILED: boom/);
  });

  it("exits 130 on AbortError", async () => {
    const err = new Error("Interrupted");
    err.name = "AbortError";
    mocks.exportContacts.mockRejectedValueOnce(err);
    await expect(buildCli().parseAsync([...NODE_ARGS, ...API_KEY, "contacts"])).rejects.toThrow(
      "process.exit(130)"
    );
  });

  it("uses default exports directory when outDir is omitted", async () => {
    await buildCli().parseAsync([...NODE_ARGS, ...API_KEY, "config"]);
    expect(mocks.exportConfig).toHaveBeenCalledWith(
      expect.objectContaining({
        outDir: expect.stringContaining(`${path.sep}exports`),
      })
    );
  });

  it("reports non-Error failures from exporters", async () => {
    mocks.exportConfig.mockRejectedValueOnce("plain string failure");
    await expect(buildCli().parseAsync([...NODE_ARGS, ...API_KEY, "config"])).rejects.toThrow(
      "process.exit(1)"
    );
    expect(errorSpy.mock.calls.flat().join(" ")).toMatch(/FAILED: plain string failure/);
  });

  it("treats empty env vars as unset for envInt-backed options", async () => {
    process.env.WA_EVENT_REQUEST_DELAY_MS = "";
    await buildCli().parseAsync([...NODE_ARGS, ...API_KEY, "events"]);
    expect(mocks.exportEvents).toHaveBeenCalledWith(
      expect.objectContaining({ requestDelayMs: undefined })
    );
  });

  it("ignores invalid envInt values", async () => {
    process.env.WA_EVENT_REQUEST_DELAY_MS = "not-a-number";
    await buildCli().parseAsync([...NODE_ARGS, ...API_KEY, "events"]);
    expect(mocks.exportEvents).toHaveBeenCalledWith(
      expect.objectContaining({ requestDelayMs: undefined })
    );
  });

  it("resolves a custom out directory from -o", async () => {
    await buildCli().parseAsync([...NODE_ARGS, ...API_KEY, "-o", "custom-out", "config"]);
    expect(mocks.exportConfig).toHaveBeenCalledWith(
      expect.objectContaining({
        outDir: expect.stringContaining(`${path.sep}custom-out`),
      })
    );
  });
});
