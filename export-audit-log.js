// export-audit-log.js
// Exports the Wild Apricot audit log (admin actions, email events, etc.).
// Wild Apricot caps the audit log to a finite history window — the API will
// only return what's still available. Override AUDIT_START_DATE / AUDIT_END_DATE
// in .env (YYYY-MM-DD) to narrow the range.

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

const OUT_DIR = path.join(process.cwd(), "exports", "audit-log");

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

async function main() {
  ensureDir(OUT_DIR);
  const { token, accountId } = await getAuthAndAccount();

  const params = {};
  if (process.env.AUDIT_START_DATE) params.StartDate = process.env.AUDIT_START_DATE;
  if (process.env.AUDIT_END_DATE) params.EndDate = process.env.AUDIT_END_DATE;

  const url = `${API_BASE}/rpc/${accountId}/ListAuditLogItems`;
  console.log("Fetching audit log...");

  let items = [];
  try {
    items = await paginate(url, token, { top: 100, params });
  } catch (err) {
    // Some accounts expose this at a different path — try the alternate.
    console.warn(`  primary endpoint failed: ${err.message.split("\n")[0]}`);
    console.warn("  trying alternate /accounts/{id}/auditLogItems endpoint...");
    const alt = `${API_BASE}/accounts/${accountId}/auditLogItems`;
    items = await paginate(alt, token, { top: 100, params });
  }

  console.log(`Got ${items.length} audit log entries.`);

  const jsonPath = path.join(OUT_DIR, "audit-log.json");
  const csvPath = path.join(OUT_DIR, "audit-log.csv");
  writeJson(items, jsonPath);

  const columns = ["id", "timestamp", "type", "message", "userId", "userName", "contactId", "ipAddress"];
  writeCsv(items.map(normalizeAuditItem), columns, csvPath);

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
