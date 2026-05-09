// lib/exporters/invoices.js
// Exports all invoices. By default fetches everything; pass startDate/endDate
// (YYYY-MM-DD) to narrow the range.

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

async function exportInvoices(opts = {}) {
  const outDir = path.join(opts.outDir || "./exports", "invoices");
  ensureDir(outDir);

  const { tokenManager, accountId } = await getAuthAndAccount({
    apiKey: opts.apiKey,
    accountId: opts.accountId,
  });

  const params = {};
  if (opts.startDate) params.StartDate = opts.startDate;
  if (opts.endDate) params.EndDate = opts.endDate;

  const url = `${API_BASE}/accounts/${accountId}/invoices`;
  console.log("Fetching invoices...");
  const invoices = await paginate(url, tokenManager, { top: 100, params });

  console.log(`Got ${invoices.length} invoices.`);

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

  console.log("");
  console.log("Done.");
  console.log(`JSON: ${jsonPath}`);
  console.log(`CSV:  ${csvPath}`);

  return {
    outDir,
    jsonPath,
    csvPath,
    count: invoices.length,
  };
}

module.exports = { exportInvoices };
