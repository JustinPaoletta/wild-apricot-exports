// lib/exporters/audit-log.js
// Exports the Wild Apricot audit log (admin actions, email events, etc.).
// Wild Apricot caps the audit log to a finite history window — the API will
// only return what's still available. Pass startDate/endDate (YYYY-MM-DD) to
// narrow the range. Defaults to the last 30 days.

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

function normalizeAuditItem(a) {
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

function isoDate(d) {
  return d.toISOString().slice(0, 10);
}

async function exportAuditLog(opts = {}) {
  const outDir = path.join(opts.outDir || "./exports", "audit-log");
  ensureDir(outDir);

  const { tokenManager, accountId } = await getAuthAndAccount({
    apiKey: opts.apiKey,
    accountId: opts.accountId,
  });

  // The /accounts/{id}/auditLogItems endpoint REQUIRES a date range (or a
  // FilterObjectType+Id, or explicit ids). Default to the last 30 days, which
  // matches Wild Apricot's typical audit retention window on most plans.
  const today = new Date();
  const thirtyDaysAgo = new Date(today.getTime() - 30 * 24 * 60 * 60 * 1000);
  const startDate = opts.startDate || isoDate(thirtyDaysAgo);
  const endDate = opts.endDate || isoDate(today);

  // The two endpoints use different param casing.
  const rpcParams = { StartDate: startDate, EndDate: endDate };
  const altParams = { startDate, endDate };

  const url = `${API_BASE}/rpc/${accountId}/ListAuditLogItems`;
  console.log(`Fetching audit log (${startDate} to ${endDate})...`);

  let items = [];
  try {
    items = await paginate(url, tokenManager, { top: 100, params: rpcParams });
  } catch (err) {
    // Some accounts expose this at a different path — try the alternate.
    console.warn(`  primary endpoint failed: ${err.message.split("\n")[0]}`);
    console.warn("  trying alternate /accounts/{id}/auditLogItems endpoint...");
    const alt = `${API_BASE}/accounts/${accountId}/auditLogItems`;
    items = await paginate(alt, tokenManager, { top: 100, params: altParams });
  }

  console.log(`Got ${items.length} audit log entries.`);

  const jsonPath = path.join(outDir, "audit-log.json");
  const csvPath = path.join(outDir, "audit-log.csv");
  writeJson(items, jsonPath);

  const columns = ["id", "timestamp", "type", "message", "userId", "userName", "contactId", "ipAddress"];
  writeCsv(items.map(normalizeAuditItem), columns, csvPath);

  console.log("");
  console.log("Done.");
  console.log(`JSON: ${jsonPath}`);
  console.log(`CSV:  ${csvPath}`);

  return {
    outDir,
    jsonPath,
    csvPath,
    count: items.length,
    startDate,
    endDate,
  };
}

module.exports = { exportAuditLog };
