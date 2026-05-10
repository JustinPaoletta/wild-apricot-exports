#!/usr/bin/env node
// scripts/export-audit-log.js — thin CLI shim over lib/exporters/audit-log.js

require("dotenv").config();

const path = require("path");
const { exportAuditLog } = require("../lib/exporters/audit-log");

async function main() {
  await exportAuditLog({
    apiKey: process.env.WILD_APRICOT_API_KEY,
    accountId: process.env.WILD_APRICOT_ACCOUNT_ID,
    outDir: path.join(process.cwd(), "exports"),
    startDate: process.env.AUDIT_START_DATE,
    endDate: process.env.AUDIT_END_DATE,
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
