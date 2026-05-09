#!/usr/bin/env node
// scripts/retry-event-failures.js — thin CLI shim over lib/exporters/retry-events.js

require("dotenv").config();

const path = require("path");
const { retryEventFailures } = require("../lib/exporters/retry-events");

async function main() {
  await retryEventFailures({
    apiKey: process.env.WILD_APRICOT_API_KEY,
    accountId: process.env.WILD_APRICOT_ACCOUNT_ID,
    outDir: path.join(process.cwd(), "exports"),
    requestDelayMs: process.env.WA_EVENT_REQUEST_DELAY_MS
      ? parseInt(process.env.WA_EVENT_REQUEST_DELAY_MS, 10)
      : undefined,
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
