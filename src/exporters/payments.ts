// src/exporters/payments.ts
// Exports all payments. Pass startDate/endDate (YYYY-MM-DD) to narrow the range.

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
import { PaymentsExportOptionsSchema } from "../schemas";
import { resolveLogger } from "../logger";
import type { PaymentsExportOptions, PaymentsExportResult } from "../types";

interface AllocationRow {
  InvoiceId?: string | number;
  invoiceId?: string | number;
  Value?: string | number;
  value?: string | number;
}

function normalizePayment(p: unknown): Record<string, unknown> {
  const obj = (p ?? {}) as Record<string, unknown>;
  const allocationsRaw =
    (obj.Allocations as AllocationRow[] | undefined) ??
    (obj.allocations as AllocationRow[] | undefined) ??
    [];
  const allocations = allocationsRaw
    .map((a) => `inv:${a.InvoiceId ?? a.invoiceId ?? ""}=${a.Value ?? a.value ?? ""}`)
    .join("; ");

  return {
    id: getNested(p, ["Id", "id"]),
    documentNumber: getNested(p, ["DocumentNumber", "documentNumber"]),
    documentDate: getNested(p, ["DocumentDate", "documentDate"]),
    contactId: getNested(p, ["Contact.Id", "ContactId"]),
    contactName: getNested(p, ["Contact.Name", "Contact.DisplayName"]),
    value: getNested(p, ["Value", "value"]),
    tenderName: getNested(p, ["Tender.Name", "TenderName"]),
    tenderId: getNested(p, ["Tender.Id", "TenderId"]),
    refundedAmount: getNested(p, ["RefundedAmount"]),
    comment: getNested(p, ["Comment", "comment"]),
    allocations,
    url: getNested(p, ["Url", "url"]),
  };
}

export async function exportPayments(opts: PaymentsExportOptions): Promise<PaymentsExportResult> {
  PaymentsExportOptionsSchema.parse(opts);
  const logger = resolveLogger(opts.logger);

  const outDir = path.join(opts.outDir || "./exports", "payments");
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

  const url = `${API_BASE}/accounts/${accountId}/payments`;
  logger.info("Fetching payments...");
  const payments = await paginate(url, tokenManager, {
    top: 100,
    params,
    signal: opts.signal,
    logger: opts.logger,
  });

  logger.info(`Got ${payments.length} payments.`);

  const jsonPath = path.join(outDir, "payments.json");
  const csvPath = path.join(outDir, "payments.csv");
  writeJson(payments, jsonPath);

  const columns = [
    "id",
    "documentNumber",
    "documentDate",
    "contactId",
    "contactName",
    "value",
    "tenderName",
    "tenderId",
    "refundedAmount",
    "comment",
    "allocations",
    "url",
  ];
  writeCsv(payments.map(normalizePayment), columns, csvPath);

  logger.info("");
  logger.info("Done.");
  logger.info(`JSON: ${jsonPath}`);
  logger.info(`CSV:  ${csvPath}`);

  return {
    outDir,
    jsonPath,
    csvPath,
    count: payments.length,
  };
}
