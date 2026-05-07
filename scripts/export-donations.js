// export-donations.js
// Exports all donations. Override with DONATIONS_START_DATE / DONATIONS_END_DATE in .env.

const path = require("path");
const {
  API_BASE,
  paginate,
  ensureDir,
  writeJson,
  writeCsv,
  getNested,
  getAuthAndAccount,
} = require("../lib/wa-api");

const OUT_DIR = path.join(process.cwd(), "exports", "donations");

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

async function main() {
  ensureDir(OUT_DIR);
  const { token, accountId } = await getAuthAndAccount();

  const params = {};
  if (process.env.DONATIONS_START_DATE) params.StartDate = process.env.DONATIONS_START_DATE;
  if (process.env.DONATIONS_END_DATE) params.EndDate = process.env.DONATIONS_END_DATE;

  const url = `${API_BASE}/accounts/${accountId}/donations`;
  console.log("Fetching donations...");
  const donations = await paginate(url, token, { top: 100, params });

  console.log(`Got ${donations.length} donations.`);

  const jsonPath = path.join(OUT_DIR, "donations.json");
  const csvPath = path.join(OUT_DIR, "donations.csv");
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
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
