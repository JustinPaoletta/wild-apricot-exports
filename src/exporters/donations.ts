// src/exporters/donations.ts
// Exports all donations. Pass startDate/endDate (YYYY-MM-DD) to narrow the range.

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
import { DonationsExportOptionsSchema } from "../schemas";
import { resolveLogger } from "../logger";
import type {
  DonationsExportOptions,
  DonationsExportResult,
} from "../types";

function normalizeDonation(d: unknown): Record<string, unknown> {
  return {
    id: getNested(d, ["Id", "id"]),
    documentNumber: getNested(d, ["DocumentNumber", "documentNumber"]),
    donationDate: getNested(d, ["DonationDate", "donationDate", "DocumentDate"]),
    contactId: getNested(d, ["Contact.Id", "ContactId"]),
    contactName: getNested(d, ["Contact.Name", "Contact.DisplayName"]),
    value: getNested(d, ["Value", "value"]),
    isAnonymous: getNested(d, ["IsAnonymous", "isAnonymous"]),
    campaignName: getNested(d, ["Campaign.Name", "CampaignName"]),
    campaignId: getNested(d, ["Campaign.Id", "CampaignId"]),
    fundName: getNested(d, ["Fund.Name", "FundName"]),
    invoiceId: getNested(d, ["InvoiceId", "invoiceId"]),
    comment: getNested(d, ["Comment", "comment"]),
    publicComment: getNested(d, ["PublicComment", "publicComment"]),
    url: getNested(d, ["Url", "url"]),
  };
}

export async function exportDonations(
  opts: DonationsExportOptions
): Promise<DonationsExportResult> {
  DonationsExportOptionsSchema.parse(opts);
  const logger = resolveLogger(opts.logger);

  const outDir = path.join(opts.outDir || "./exports", "donations");
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

  const url = `${API_BASE}/accounts/${accountId}/donations`;
  logger.info("Fetching donations...");
  const donations = await paginate(url, tokenManager, {
    top: 100,
    params,
    signal: opts.signal,
    logger: opts.logger,
  });

  logger.info(`Got ${donations.length} donations.`);

  const jsonPath = path.join(outDir, "donations.json");
  const csvPath = path.join(outDir, "donations.csv");
  writeJson(donations, jsonPath);

  const columns = [
    "id",
    "documentNumber",
    "donationDate",
    "contactId",
    "contactName",
    "value",
    "isAnonymous",
    "campaignName",
    "campaignId",
    "fundName",
    "invoiceId",
    "comment",
    "publicComment",
    "url",
  ];
  writeCsv(donations.map(normalizeDonation), columns, csvPath);

  logger.info("");
  logger.info("Done.");
  logger.info(`JSON: ${jsonPath}`);
  logger.info(`CSV:  ${csvPath}`);

  return {
    outDir,
    jsonPath,
    csvPath,
    count: donations.length,
  };
}
