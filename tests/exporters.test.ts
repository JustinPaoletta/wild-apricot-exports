import * as fs from "node:fs";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { exportAuditLog } from "../src/exporters/audit-log";
import { exportConfig } from "../src/exporters/config";
import { exportContacts } from "../src/exporters/contacts";
import { exportDonations } from "../src/exporters/donations";
import { exportInvoices } from "../src/exporters/invoices";
import { exportPayments } from "../src/exporters/payments";
import { makeTempDir, rmTempDir } from "./helpers/temp-dir";
import {
  installFetchMock,
  jsonResponse,
  restoreFetchMock,
  textResponse,
  withAuthDefaults,
} from "./helpers/mock-fetch";

describe("REST exporters", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTempDir();
  });

  afterEach(() => {
    rmTempDir(tmpDir);
    restoreFetchMock();
  });

  it("exportConfig writes endpoint JSON files", async () => {
    installFetchMock(
      withAuthDefaults(async (url) => {
        if (url.includes("/membershiplevels")) return jsonResponse([{ Id: 1, Name: "Member" }]);
        if (url.includes("/accounts/123456")) return jsonResponse({ Id: 123456, Name: "Org" });
        return jsonResponse({ ok: true });
      }, 123456)
    );

    const result = await exportConfig({
      apiKey: "key",
      accountId: 123456,
      outDir: tmpDir,
    });

    expect(result.written.some((w) => w.name === "membership-levels")).toBe(true);
    expect(fs.existsSync(path.join(result.outDir, "membership-levels.json"))).toBe(true);
  });

  it("exportContacts flattens FieldValues into CSV", async () => {
    installFetchMock(
      withAuthDefaults(async (url) => {
        if (url.includes("/contacts")) {
          return jsonResponse({
            Contacts: [
              {
                Id: 10,
                FirstName: "Ada",
                LastName: "Lovelace",
                Email: "ada@example.com",
                FieldValues: [
                  { FieldName: "Phone", Value: "555-0100" },
                  { fieldName: "Mobile phone", value: "555-0200" },
                ],
              },
            ],
          });
        }
        return jsonResponse([]);
      })
    );

    const result = await exportContacts({ apiKey: "key", accountId: 123456, outDir: tmpDir });
    expect(result.count).toBe(1);
    const csv = fs.readFileSync(result.csvPath, "utf8");
    expect(csv).toContain("Ada");
    expect(csv).toContain("555-0100");
    expect(JSON.parse(fs.readFileSync(result.jsonPath, "utf8"))).toHaveLength(1);
  });

  it("exportContacts maps array field values using Value-only objects", async () => {
    installFetchMock(
      withAuthDefaults(async () =>
        jsonResponse({
          Contacts: [
            {
              Id: 11,
              FieldValues: [{ FieldName: "Tags", Value: [{ Value: "Member" }] }],
            },
          ],
        })
      )
    );

    await exportContacts({ apiKey: "key", accountId: 123456, outDir: tmpDir });
  });

  it("exportInvoices applies date filters to pagination", async () => {
    const seenParams: string[] = [];
    installFetchMock(
      withAuthDefaults(async (url) => {
        seenParams.push(url);
        return jsonResponse({ Items: [{ Id: 1, DocumentNumber: "INV-1" }] });
      })
    );

    const result = await exportInvoices({
      apiKey: "key",
      accountId: 123456,
      outDir: tmpDir,
      startDate: "2026-01-01",
      endDate: "2026-06-30",
    });

    expect(result.count).toBe(1);
    expect(seenParams.some((u) => u.includes("StartDate=2026-01-01"))).toBe(true);
    expect(seenParams.some((u) => u.includes("EndDate=2026-06-30"))).toBe(true);
  });

  it("exportInvoices works with only a start date", async () => {
    installFetchMock(withAuthDefaults(async () => jsonResponse({ Items: [{ Id: 2 }] })));
    const result = await exportInvoices({
      apiKey: "key",
      accountId: 123456,
      outDir: tmpDir,
      startDate: "2026-03-01",
    });
    expect(result.count).toBe(1);
  });

  it("exportPayments writes JSON and CSV outputs", async () => {
    installFetchMock(
      withAuthDefaults(async (url) => {
        if (url.includes("/payments")) return jsonResponse({ Items: [{ Id: 5, Value: 25 }] });
        return jsonResponse({ Items: [] });
      })
    );

    const result = await exportPayments({ apiKey: "key", accountId: 123456, outDir: tmpDir });
    expect(result.count).toBe(1);
    expect(fs.existsSync(result.jsonPath)).toBe(true);
    expect(fs.existsSync(result.csvPath)).toBe(true);
  });

  it("exportDonations paginates records", async () => {
    installFetchMock(
      withAuthDefaults(async (url) => {
        if (url.includes("/donations")) return jsonResponse({ Items: [{ Id: 9 }] });
        return jsonResponse({ Items: [] });
      })
    );

    const result = await exportDonations({ apiKey: "key", accountId: 123456, outDir: tmpDir });
    expect(result.count).toBe(1);
  });

  it("exportConfig counts Items arrays in log output", async () => {
    installFetchMock(
      withAuthDefaults(async (url) => {
        if (url.includes("/funds")) return jsonResponse({ Items: [{ Id: 1 }, { Id: 2 }] });
        if (url.includes("/accounts/123456")) return jsonResponse({ Id: 123456 });
        return jsonResponse({ ok: true });
      }, 123456)
    );

    const result = await exportConfig({ apiKey: "key", accountId: 123456, outDir: tmpDir });
    expect(result.written.some((w) => w.name === "funds")).toBe(true);
  });

  it("exportConfig records failed endpoints without stopping", async () => {
    installFetchMock(
      withAuthDefaults(async (url) => {
        if (url.includes("/picklists")) return textResponse("nope", 404);
        if (url.includes("/accounts/123456")) return jsonResponse({ Id: 123456 });
        return jsonResponse([{ Id: 1 }]);
      }, 123456)
    );

    const result = await exportConfig({ apiKey: "key", accountId: 123456, outDir: tmpDir });
    expect(result.failed.some((f) => f.name === "picklists")).toBe(true);
    expect(result.written.length).toBeGreaterThan(0);
  });

  it("exportContacts handles array and object FieldValues", async () => {
    installFetchMock(
      withAuthDefaults(async (url) => {
        if (url.includes("/contacts")) {
          return jsonResponse({
            Contacts: [
              {
                id: 11,
                firstName: "Grace",
                fieldValues: [
                  { fieldName: "Phone", value: "555-9999" },
                  { fieldName: "Tags", value: [{ Label: "VIP" }, { Value: "Speaker" }] },
                  { fieldName: "Note", value: { Value: "Plain value" } },
                ],
              },
            ],
          });
        }
        return jsonResponse([]);
      })
    );

    const result = await exportContacts({ apiKey: "key", accountId: 123456, outDir: tmpDir });
    const csv = fs.readFileSync(result.csvPath, "utf8");
    expect(csv).toContain("Grace");
    expect(csv).toContain("555-9999");
  });

  it("exportPayments normalizes allocation rows", async () => {
    installFetchMock(
      withAuthDefaults(async (url) => {
        if (url.includes("/payments")) {
          return jsonResponse({
            Items: [
              {
                Id: 1,
                allocations: [{ invoiceId: 7, value: 50 }],
                Contact: { Id: 2, DisplayName: "Pat" },
                Tender: { Id: 3, Name: "Card" },
              },
              {
                Id: 2,
                Allocations: [{ InvoiceId: 8, Value: 15 }],
              },
            ],
          });
        }
        return jsonResponse({ Items: [] });
      })
    );

    const result = await exportPayments({
      apiKey: "key",
      accountId: 123456,
      outDir: tmpDir,
      startDate: "2026-01-01",
    });
    const csv = fs.readFileSync(result.csvPath, "utf8");
    expect(csv).toContain("inv:7=50");
    expect(csv).toContain("inv:8=15");
    expect(csv).toContain("Pat");
  });

  it("exportDonations normalizes nested campaign and fund fields", async () => {
    installFetchMock(
      withAuthDefaults(async (url) => {
        if (url.includes("/donations")) {
          return jsonResponse({
            Items: [
              {
                id: 3,
                documentDate: "2026-02-01",
                Campaign: { Name: "Annual", Id: 1 },
                Fund: { Name: "General" },
                IsAnonymous: true,
              },
            ],
          });
        }
        return jsonResponse({ Items: [] });
      })
    );

    const result = await exportDonations({
      apiKey: "key",
      accountId: 123456,
      outDir: tmpDir,
      startDate: "2026-01-01",
      endDate: "2026-12-31",
    });
    const csv = fs.readFileSync(result.csvPath, "utf8");
    expect(csv).toContain("Annual");
    expect(csv).toContain("General");
  });

  it("exportAuditLog uses primary RPC endpoint when available", async () => {
    installFetchMock(
      withAuthDefaults(async (url) => {
        if (url.includes("/ListAuditLogItems")) {
          return jsonResponse({ Items: [{ Id: 1, Timestamp: "2026-01-02T00:00:00Z" }] });
        }
        return jsonResponse({ Items: [] });
      })
    );

    const result = await exportAuditLog({ apiKey: "key", accountId: 123456, outDir: tmpDir });
    expect(result.count).toBe(1);
  });

  it("exportAuditLog defaults date range to the last 30 days", async () => {
    installFetchMock(
      withAuthDefaults(async (url) => {
        if (url.includes("/ListAuditLogItems")) {
          return jsonResponse({ Items: [{ Id: 2 }] });
        }
        return jsonResponse({ Items: [] });
      })
    );

    const result = await exportAuditLog({ apiKey: "key", accountId: 123456, outDir: tmpDir });
    expect(result.count).toBe(1);
    expect(result.startDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(result.endDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("exportAuditLog falls back to alternate endpoint", async () => {
    installFetchMock(
      withAuthDefaults(async (url) => {
        if (url.includes("/ListAuditLogItems")) {
          return textResponse("not found", 404);
        }
        if (url.includes("/auditLogItems")) {
          return jsonResponse({ Items: [{ Id: 99, Timestamp: "2026-01-01T00:00:00Z" }] });
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
    expect(result.startDate).toBe("2026-01-01");
  });

  it("exportAuditLog uses default outDir when omitted", async () => {
    installFetchMock(
      withAuthDefaults(async (url) => {
        if (url.includes("/ListAuditLogItems")) {
          return jsonResponse({ Items: [{ Id: 1 }] });
        }
        return jsonResponse({ Items: [] });
      })
    );

    const result = await exportAuditLog({ apiKey: "key", accountId: 123456 });
    expect(result.outDir).toMatch(/exports[/\\]audit-log$/);
  });
});
