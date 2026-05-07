// export-invoices.js
// Exports all invoices. By default fetches everything (no date filter).
// Override with INVOICES_START_DATE / INVOICES_END_DATE in .env (YYYY-MM-DD).

const path = require("path");
const {
  API_BASE,
  paginate,
  ensureDir,
  writeJson,
  writeCsv,
  getNested,
  getAuthAndAccount,
} = require("./lib/wa-api");

const OUT_DIR = path.join(process.cwd(), "exports", "invoices");

function normalizeInvoice(inv) {
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

async function main() {
  ensureDir(OUT_DIR);
  const { token, accountId } = await getAuthAndAccount();

  const params = {};
  if (process.env.INVOICES_START_DATE) params.StartDate = process.env.INVOICES_START_DATE;
  if (process.env.INVOICES_END_DATE) params.EndDate = process.env.INVOICES_END_DATE;

  const url = `${API_BASE}/accounts/${accountId}/invoices`;
  console.log("Fetching invoices...");
  const invoices = await paginate(url, token, { top: 100, params });

  console.log(`Got ${invoices.length} invoices.`);

  const jsonPath = path.join(OUT_DIR, "invoices.json");
  const csvPath = path.join(OUT_DIR, "invoices.csv");
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
