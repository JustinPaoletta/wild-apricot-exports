#!/usr/bin/env node
// scripts/export-donations.js — thin CLI shim over lib/exporters/donations.js

require("dotenv").config();

const path = require("path");
const { exportDonations } = require("../lib/exporters/donations");

async function main() {
  await exportDonations({
    apiKey: process.env.WILD_APRICOT_API_KEY,
    accountId: process.env.WILD_APRICOT_ACCOUNT_ID,
    outDir: path.join(process.cwd(), "exports"),
    startDate: process.env.DONATIONS_START_DATE,
    endDate: process.env.DONATIONS_END_DATE,
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
