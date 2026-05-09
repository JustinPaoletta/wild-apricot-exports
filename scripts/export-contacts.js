#!/usr/bin/env node
// scripts/export-contacts.js — thin CLI shim over lib/exporters/contacts.js

require("dotenv").config();

const path = require("path");
const { exportContacts } = require("../lib/exporters/contacts");

async function main() {
  await exportContacts({
    apiKey: process.env.WILD_APRICOT_API_KEY,
    accountId: process.env.WILD_APRICOT_ACCOUNT_ID,
    outDir: path.join(process.cwd(), "exports"),
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
