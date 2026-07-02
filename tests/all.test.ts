import * as fs from "node:fs";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { makeTempDir, rmTempDir } from "./helpers/temp-dir";

const mocks = vi.hoisted(() => ({
  exportConfig: vi.fn(),
  exportEvents: vi.fn(),
  exportRegistrations: vi.fn(),
  exportContacts: vi.fn(),
  exportInvoices: vi.fn(),
  exportPayments: vi.fn(),
  exportDonations: vi.fn(),
  exportAuditLog: vi.fn(),
  exportFiles: vi.fn(),
}));

vi.mock("../src/exporters/config", () => ({ exportConfig: mocks.exportConfig }));
vi.mock("../src/exporters/events", () => ({ exportEvents: mocks.exportEvents }));
vi.mock("../src/exporters/registrations", () => ({
  exportRegistrations: mocks.exportRegistrations,
}));
vi.mock("../src/exporters/contacts", () => ({ exportContacts: mocks.exportContacts }));
vi.mock("../src/exporters/invoices", () => ({ exportInvoices: mocks.exportInvoices }));
vi.mock("../src/exporters/payments", () => ({ exportPayments: mocks.exportPayments }));
vi.mock("../src/exporters/donations", () => ({ exportDonations: mocks.exportDonations }));
vi.mock("../src/exporters/audit-log", () => ({ exportAuditLog: mocks.exportAuditLog }));
vi.mock("../src/exporters/files", () => ({ exportFiles: mocks.exportFiles }));

import { exportAll } from "../src/exporters/all";

describe("exportAll", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTempDir();
    vi.clearAllMocks();
    mocks.exportConfig.mockResolvedValue({ outDir: "x/config", written: [], failed: [] });
    mocks.exportEvents.mockResolvedValue({
      outDir: path.join(tmpDir, "events"),
      jsonPath: path.join(tmpDir, "events", "wild-apricot-events.json"),
      csvPath: path.join(tmpDir, "events", "wild-apricot-events.csv"),
      count: 1,
      failureCount: 0,
    });
    mocks.exportRegistrations.mockResolvedValue({ count: 0 });
    mocks.exportContacts.mockResolvedValue({ count: 0 });
    mocks.exportInvoices.mockResolvedValue({ count: 0 });
    mocks.exportPayments.mockResolvedValue({ count: 0 });
    mocks.exportDonations.mockResolvedValue({ count: 0 });
    mocks.exportAuditLog.mockResolvedValue({ count: 0 });
    mocks.exportFiles.mockResolvedValue({
      stats: { total: 0, downloaded: 0, skipped: 0, failed: 0 },
    });
  });

  afterEach(() => {
    rmTempDir(tmpDir);
  });

  it("runs only included steps", async () => {
    const result = await exportAll({
      apiKey: "key",
      outDir: tmpDir,
      include: ["config", "contacts"],
    });
    expect(mocks.exportConfig).toHaveBeenCalledOnce();
    expect(mocks.exportContacts).toHaveBeenCalledOnce();
    expect(result.steps).toEqual(["config", "contacts"]);
    expect(result.failedCount).toBe(0);
  });

  it("honors exclude list", async () => {
    await exportAll({
      apiKey: "key",
      outDir: tmpDir,
      exclude: ["files", "audit-log"],
    });
    expect(mocks.exportFiles).not.toHaveBeenCalled();
    expect(mocks.exportAuditLog).not.toHaveBeenCalled();
    expect(mocks.exportConfig).toHaveBeenCalled();
  });

  it("continues when one step fails", async () => {
    mocks.exportConfig.mockRejectedValue(new Error("config blew up"));
    const result = await exportAll({
      apiKey: "key",
      outDir: tmpDir,
      include: ["config", "contacts"],
    });
    expect(mocks.exportContacts).toHaveBeenCalledOnce();
    expect(result.failedCount).toBe(1);
  });

  it("threads events JSON into registrations in the same run", async () => {
    const eventsDir = path.join(tmpDir, "events");
    fs.mkdirSync(eventsDir, { recursive: true });
    const jsonPath = path.join(eventsDir, "wild-apricot-events.json");
    fs.writeFileSync(jsonPath, JSON.stringify([{ Id: 5, Name: "Gala" }]), "utf8");
    mocks.exportEvents.mockResolvedValue({
      outDir: eventsDir,
      jsonPath,
      csvPath: path.join(eventsDir, "wild-apricot-events.csv"),
      count: 1,
      failureCount: 0,
    });

    await exportAll({
      apiKey: "key",
      outDir: tmpDir,
      include: ["events", "registrations"],
    });

    expect(mocks.exportRegistrations).toHaveBeenCalledWith(
      expect.objectContaining({ events: [{ Id: 5, Name: "Gala" }] })
    );
  });

  it("reads on-disk events for registrations when events step was excluded", async () => {
    const eventsDir = path.join(tmpDir, "events");
    fs.mkdirSync(eventsDir, { recursive: true });
    fs.writeFileSync(
      path.join(eventsDir, "wild-apricot-events.json"),
      JSON.stringify([{ Id: 9 }]),
      "utf8"
    );

    await exportAll({
      apiKey: "key",
      outDir: tmpDir,
      include: ["registrations"],
    });

    expect(mocks.exportRegistrations).toHaveBeenCalledWith(
      expect.objectContaining({ events: [{ Id: 9 }] })
    );
  });

  it("runs financial and audit exporters with per-step options", async () => {
    await exportAll({
      apiKey: "key",
      outDir: tmpDir,
      include: ["invoices", "payments", "donations", "audit-log"],
      invoicesOptions: { startDate: "2026-01-01" },
      paymentsOptions: { endDate: "2026-12-31" },
      donationsOptions: { startDate: "2026-02-01" },
      auditLogOptions: { endDate: "2026-03-01" },
    });

    expect(mocks.exportInvoices).toHaveBeenCalledWith(
      expect.objectContaining({ startDate: "2026-01-01" })
    );
    expect(mocks.exportPayments).toHaveBeenCalledWith(
      expect.objectContaining({ endDate: "2026-12-31" })
    );
    expect(mocks.exportDonations).toHaveBeenCalledWith(
      expect.objectContaining({ startDate: "2026-02-01" })
    );
    expect(mocks.exportAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({ endDate: "2026-03-01" })
    );
  });

  it("skips files when WebDAV credentials are missing", async () => {
    const result = await exportAll({
      apiKey: "key",
      outDir: tmpDir,
      include: ["files"],
    });
    expect(mocks.exportFiles).not.toHaveBeenCalled();
    expect(result.failedCount).toBe(1);
  });

  it("runs files when WebDAV credentials are provided", async () => {
    const result = await exportAll({
      apiKey: "key",
      outDir: tmpDir,
      include: ["files"],
      webdavUrl: "https://org.wildapricot.org",
      adminEmail: "admin@example.com",
      adminPassword: "secret",
      fileDirs: ["Documents"],
    });
    expect(mocks.exportFiles).toHaveBeenCalledWith(
      expect.objectContaining({ fileDirs: ["Documents"] })
    );
    expect(result.failedCount).toBe(0);
  });

  it("continues when a step throws a non-Error value", async () => {
    mocks.exportContacts.mockRejectedValue("plain step failure");
    const result = await exportAll({
      apiKey: "key",
      outDir: tmpDir,
      include: ["contacts", "config"],
    });
    expect(result.failedCount).toBe(1);
    expect(mocks.exportConfig).toHaveBeenCalled();
  });

  it("ignores unreadable on-disk events JSON for registrations", async () => {
    const eventsDir = path.join(tmpDir, "events");
    fs.mkdirSync(eventsDir, { recursive: true });
    fs.writeFileSync(path.join(eventsDir, "wild-apricot-events.json"), "{bad", "utf8");

    await exportAll({
      apiKey: "key",
      outDir: tmpDir,
      include: ["registrations"],
    });

    expect(mocks.exportRegistrations).toHaveBeenCalledWith(
      expect.objectContaining({ events: undefined })
    );
  });

  it("clears cached events when the events JSON cannot be read after export", async () => {
    const eventsDir = path.join(tmpDir, "events");
    fs.mkdirSync(eventsDir, { recursive: true });
    const jsonPath = path.join(eventsDir, "wild-apricot-events.json");
    mocks.exportEvents.mockResolvedValue({
      outDir: eventsDir,
      jsonPath,
      csvPath: path.join(eventsDir, "wild-apricot-events.csv"),
      count: 1,
      failureCount: 0,
    });
    fs.writeFileSync(jsonPath, "{bad", "utf8");

    await exportAll({
      apiKey: "key",
      outDir: tmpDir,
      include: ["events", "registrations"],
    });

    expect(mocks.exportRegistrations).toHaveBeenCalledWith(
      expect.objectContaining({ events: undefined })
    );
  });
});
