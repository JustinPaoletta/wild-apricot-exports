// src/exporters/audit-log.ts
// Exports the Wild Apricot audit log. Wild Apricot caps the audit log to a
// finite history window — the API will only return what's still available.
// Pass startDate/endDate (YYYY-MM-DD) to narrow the range. Defaults to the
// last 30 days.

import * as path from "node:path";

import {
  API_BASE,
  paginate,
  ensureDir,
  writeJson,
  writeCsv,
  getNested,
  getAuthAndAccount,
} from "../wa-api";
import { AuditLogExportOptionsSchema } from "../schemas";
import { resolveLogger } from "../logger";
import type {
  AuditLogExportOptions,
  AuditLogExportResult,
} from "../types";

function normalizeAuditItem(a: unknown): Record<string, unknown> {
  return {
    id: getNested(a, ["Id", "id"]),
    timestamp: getNested(a, ["Timestamp", "timestamp", "TimestampUtc"]),
    type: getNested(a, ["Message.Type", "MessageType", "Type"]),
    message: getNested(a, ["Message.Description", "Message", "Description"]),
    userId: getNested(a, ["User.Id", "UserId"]),
    userName: getNested(a, ["User.Name", "User.DisplayName", "UserName"]),
    contactId: getNested(a, ["Contact.Id", "ContactId"]),
    ipAddress: getNested(a, ["IpAddress", "ipAddress"]),
  };
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export async function exportAuditLog(
  opts: AuditLogExportOptions
): Promise<AuditLogExportResult> {
  AuditLogExportOptionsSchema.parse(opts);
  const logger = resolveLogger(opts.logger);

  const outDir = path.join(opts.outDir || "./exports", "audit-log");
  ensureDir(outDir);

  const { tokenManager, accountId } = await getAuthAndAccount({
    apiKey: opts.apiKey,
    accountId: opts.accountId,
    signal: opts.signal,
    logger: opts.logger,
  });

  const today = new Date();
  const thirtyDaysAgo = new Date(today.getTime() - 30 * 24 * 60 * 60 * 1000);
  const startDate = opts.startDate || isoDate(thirtyDaysAgo);
  const endDate = opts.endDate || isoDate(today);

  // The two endpoints use different param casing.
  const rpcParams: Record<string, string> = { StartDate: startDate, EndDate: endDate };
  const altParams: Record<string, string> = { startDate, endDate };

  const url = `${API_BASE}/rpc/${accountId}/ListAuditLogItems`;
  logger.info(`Fetching audit log (${startDate} to ${endDate})...`);

  let items: unknown[] = [];
  try {
    items = await paginate(url, tokenManager, {
      top: 100,
      params: rpcParams,
      signal: opts.signal,
      logger: opts.logger,
    });
  } catch (err) {
    // Some accounts expose this at a different path — try the alternate.
    const msg = err instanceof Error ? err.message.split("\n")[0] : String(err);
    logger.warn(`  primary endpoint failed: ${msg}`);
    logger.warn("  trying alternate /accounts/{id}/auditLogItems endpoint...");
    const alt = `${API_BASE}/accounts/${accountId}/auditLogItems`;
    items = await paginate(alt, tokenManager, {
      top: 100,
      params: altParams,
      signal: opts.signal,
      logger: opts.logger,
    });
  }

  logger.info(`Got ${items.length} audit log entries.`);

  const jsonPath = path.join(outDir, "audit-log.json");
  const csvPath = path.join(outDir, "audit-log.csv");
  writeJson(items, jsonPath);

  const columns = [
    "id",
    "timestamp",
    "type",
    "message",
    "userId",
    "userName",
    "contactId",
    "ipAddress",
  ];
  writeCsv(items.map(normalizeAuditItem), columns, csvPath);

  logger.info("");
  logger.info("Done.");
  logger.info(`JSON: ${jsonPath}`);
  logger.info(`CSV:  ${csvPath}`);

  return {
    outDir,
    jsonPath,
    csvPath,
    count: items.length,
    startDate,
    endDate,
  };
}
