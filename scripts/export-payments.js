#!/usr/bin/env node
// scripts/export-payments.js — thin CLI shim over lib/exporters/payments.js

require("dotenv").config();

const path = require("path");
const { exportPayments } = require("../lib/exporters/payments");

async function main() {
  await exportPayments({
    apiKey: process.env.WILD_APRICOT_API_KEY,
    accountId: process.env.WILD_APRICOT_ACCOUNT_ID,
    outDir: path.join(process.cwd(), "exports"),
    startDate: process.env.PAYMENTS_START_DATE,
    endDate: process.env.PAYMENTS_END_DATE,
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
