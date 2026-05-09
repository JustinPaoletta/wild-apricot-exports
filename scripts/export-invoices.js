#!/usr/bin/env node
// scripts/export-invoices.js — thin CLI shim over lib/exporters/invoices.js

require("dotenv").config();

const path = require("path");
const { exportInvoices } = require("../lib/exporters/invoices");

async function main() {
  await exportInvoices({
    apiKey: process.env.WILD_APRICOT_API_KEY,
    accountId: process.env.WILD_APRICOT_ACCOUNT_ID,
    outDir: path.join(process.cwd(), "exports"),
    startDate: process.env.INVOICES_START_DATE,
    endDate: process.env.INVOICES_END_DATE,
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
