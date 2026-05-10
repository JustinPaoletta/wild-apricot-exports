// lib/exporters/payments.js
// Exports all payments. Pass startDate/endDate (YYYY-MM-DD) to narrow the range.

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

async function exportPayments(opts = {}) {
  const outDir = path.join(opts.outDir || "./exports", "payments");
  ensureDir(outDir);

  const { tokenManager, accountId } = await getAuthAndAccount({
    apiKey: opts.apiKey,
    accountId: opts.accountId,
  });

  const params = {};
  if (opts.startDate) params.StartDate = opts.startDate;
  if (opts.endDate) params.EndDate = opts.endDate;

  const url = `${API_BASE}/accounts/${accountId}/payments`;
  console.log("Fetching payments...");
  const payments = await paginate(url, tokenManager, { top: 100, params });

  console.log(`Got ${payments.length} payments.`);

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

  console.log("");
  console.log("Done.");
  console.log(`JSON: ${jsonPath}`);
  console.log(`CSV:  ${csvPath}`);

  return {
    outDir,
    jsonPath,
    csvPath,
    count: payments.length,
  };
}

module.exports = { exportPayments };
