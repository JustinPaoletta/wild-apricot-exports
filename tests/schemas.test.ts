import { describe, expect, it } from "vitest";

import {
  AuditLogExportOptionsSchema,
  ExportOptionsSchema,
  FilesExportOptionsSchema,
  InvoicesExportOptionsSchema,
  PaginatedResponseSchema,
  TokenResponseSchema,
} from "../src/schemas";

describe("schemas", () => {
  it("ExportOptionsSchema requires apiKey", () => {
    expect(() => ExportOptionsSchema.parse({})).toThrow(/apiKey/);
    expect(ExportOptionsSchema.parse({ apiKey: "abc" }).apiKey).toBe("abc");
  });

  it("InvoicesExportOptionsSchema validates date format", () => {
    expect(() =>
      InvoicesExportOptionsSchema.parse({ apiKey: "k", startDate: "not-a-date" })
    ).toThrow(/YYYY-MM-DD/);
    expect(
      InvoicesExportOptionsSchema.parse({
        apiKey: "k",
        startDate: "2026-01-01",
        endDate: "2026-12-31",
      }).startDate
    ).toBe("2026-01-01");
  });

  it("AuditLogExportOptionsSchema accepts optional dates", () => {
    expect(AuditLogExportOptionsSchema.parse({ apiKey: "k" }).apiKey).toBe("k");
  });

  it("FilesExportOptionsSchema requires webdav credentials", () => {
    expect(() =>
      FilesExportOptionsSchema.parse({
        webdavUrl: "",
        adminEmail: "",
        adminPassword: "",
      })
    ).toThrow();
    expect(
      FilesExportOptionsSchema.parse({
        webdavUrl: "https://org.wildapricot.org",
        adminEmail: "admin@example.com",
        adminPassword: "secret",
      }).adminEmail
    ).toBe("admin@example.com");
  });

  it("TokenResponseSchema accepts valid OAuth payload", () => {
    const parsed = TokenResponseSchema.parse({
      access_token: "tok",
      expires_in: 1800,
      token_type: "Bearer",
    });
    expect(parsed.access_token).toBe("tok");
  });

  it("TokenResponseSchema rejects missing access_token", () => {
    expect(() => TokenResponseSchema.parse({ expires_in: 1800 })).toThrow();
  });

  it("PaginatedResponseSchema accepts array or Items wrapper", () => {
    expect(PaginatedResponseSchema.parse([{ id: 1 }])).toEqual([{ id: 1 }]);
    expect(PaginatedResponseSchema.parse({ Items: [{ id: 2 }] })).toEqual({
      Items: [{ id: 2 }],
    });
  });
});
