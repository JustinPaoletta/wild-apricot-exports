// lib/exporters/donations.js
// Exports all donations. Pass startDate/endDate (YYYY-MM-DD) to narrow the range.

const path = require("path");
const {
  API_BASE,
  paginate,
  ensureDir,
  writeJson,
  writeCsv,
  getNested,
  getAuthAndAccount,
} = require("../wa-api");

function normalizeDonation(d) {
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

async function exportDonations(opts = {}) {
  const outDir = path.join(opts.outDir || "./exports", "donations");
  ensureDir(outDir);

  const { tokenManager, accountId } = await getAuthAndAccount({
    apiKey: opts.apiKey,
    accountId: opts.accountId,
  });

  const params = {};
  if (opts.startDate) params.StartDate = opts.startDate;
  if (opts.endDate) params.EndDate = opts.endDate;

  const url = `${API_BASE}/accounts/${accountId}/donations`;
  console.log("Fetching donations...");
  const donations = await paginate(url, tokenManager, { top: 100, params });

  console.log(`Got ${donations.length} donations.`);

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

  console.log("");
  console.log("Done.");
  console.log(`JSON: ${jsonPath}`);
  console.log(`CSV:  ${csvPath}`);

  return {
    outDir,
    jsonPath,
    csvPath,
    count: donations.length,
  };
}

module.exports = { exportDonations };
