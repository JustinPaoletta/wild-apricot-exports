// export-payments.js
// Exports all payments. Override with PAYMENTS_START_DATE / PAYMENTS_END_DATE in .env.

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

const OUT_DIR = path.join(process.cwd(), "exports", "payments");

function normalizePayment(p) {
  const allocations = (p.Allocations || p.allocations || [])
    .map((a) => `inv:${a.InvoiceId || a.invoiceId || ""}=${a.Value || a.value || ""}`)
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

async function main() {
  ensureDir(OUT_DIR);
  const { token, accountId } = await getAuthAndAccount();

  const params = {};
  if (process.env.PAYMENTS_START_DATE) params.StartDate = process.env.PAYMENTS_START_DATE;
  if (process.env.PAYMENTS_END_DATE) params.EndDate = process.env.PAYMENTS_END_DATE;

  const url = `${API_BASE}/accounts/${accountId}/payments`;
  console.log("Fetching payments...");
  const payments = await paginate(url, token, { top: 100, params });

  console.log(`Got ${payments.length} payments.`);

  const jsonPath = path.join(OUT_DIR, "payments.json");
  const csvPath = path.join(OUT_DIR, "payments.csv");
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
