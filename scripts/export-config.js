#!/usr/bin/env node
// scripts/export-config.js — thin CLI shim over lib/exporters/config.js

require("dotenv").config();

const path = require("path");
const { exportConfig } = require("../lib/exporters/config");

async function main() {
  await exportConfig({
    apiKey: process.env.WILD_APRICOT_API_KEY,
    accountId: process.env.WILD_APRICOT_ACCOUNT_ID,
    outDir: path.join(process.cwd(), "exports"),
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
