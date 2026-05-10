// src/exporters/invoices.ts
// Exports all invoices. By default fetches everything; pass startDate/endDate
// (YYYY-MM-DD) to narrow the range.

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
import { InvoicesExportOptionsSchema } from "../schemas";
import { resolveLogger } from "../logger";
import type { InvoicesExportOptions, InvoicesExportResult } from "../types";

function normalizeInvoice(inv: unknown): Record<string, unknown> {
  return {
    id: getNested(inv, ["Id", "id"]),
    documentNumber: getNested(inv, ["DocumentNumber", "documentNumber"]),
    documentDate: getNested(inv, ["DocumentDate", "documentDate"]),
    dueDate: getNested(inv, ["DueDate", "dueDate"]),
    contactId: getNested(inv, ["Contact.Id", "ContactId", "contactId"]),
    contactName: getNested(inv, ["Contact.Name", "Contact.DisplayName"]),
    value: getNested(inv, ["Value", "value"]),
    paidAmount: getNested(inv, ["PaidAmount", "paidAmount"]),
    isPaid: getNested(inv, ["IsPaid", "isPaid"]),
    publicMemo: getNested(inv, ["PublicMemo", "publicMemo"]),
    memo: getNested(inv, ["Memo", "memo"]),
    url: getNested(inv, ["Url", "url"]),
  };
}

export async function exportInvoices(opts: InvoicesExportOptions): Promise<InvoicesExportResult> {
  InvoicesExportOptionsSchema.parse(opts);
  const logger = resolveLogger(opts.logger);

  const outDir = path.join(opts.outDir || "./exports", "invoices");
  ensureDir(outDir);

  const { tokenManager, accountId } = await getAuthAndAccount({
    apiKey: opts.apiKey,
    accountId: opts.accountId,
    signal: opts.signal,
    logger: opts.logger,
  });

  const params: Record<string, string> = {};
  if (opts.startDate) params.StartDate = opts.startDate;
  if (opts.endDate) params.EndDate = opts.endDate;

  const url = `${API_BASE}/accounts/${accountId}/invoices`;
  logger.info("Fetching invoices...");
  const invoices = await paginate(url, tokenManager, {
    top: 100,
    params,
    signal: opts.signal,
    logger: opts.logger,
  });

  logger.info(`Got ${invoices.length} invoices.`);

  const jsonPath = path.join(outDir, "invoices.json");
  const csvPath = path.join(outDir, "invoices.csv");
  writeJson(invoices, jsonPath);

  const columns = [
    "id",
    "documentNumber",
    "documentDate",
    "dueDate",
    "contactId",
    "contactName",
    "value",
    "paidAmount",
    "isPaid",
    "publicMemo",
    "memo",
    "url",
  ];
  writeCsv(invoices.map(normalizeInvoice), columns, csvPath);

  logger.info("");
  logger.info("Done.");
  logger.info(`JSON: ${jsonPath}`);
  logger.info(`CSV:  ${csvPath}`);

  return {
    outDir,
    jsonPath,
    csvPath,
    count: invoices.length,
  };
}
