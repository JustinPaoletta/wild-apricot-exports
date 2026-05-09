#!/usr/bin/env node
// scripts/export-events.js — thin CLI shim over lib/exporters/events.js

require("dotenv").config();

const path = require("path");
const { exportEvents } = require("../lib/exporters/events");

async function main() {
  await exportEvents({
    apiKey: process.env.WILD_APRICOT_API_KEY,
    accountId: process.env.WILD_APRICOT_ACCOUNT_ID,
    outDir: path.join(process.cwd(), "exports"),
    requestDelayMs: process.env.WA_EVENT_REQUEST_DELAY_MS
      ? parseInt(process.env.WA_EVENT_REQUEST_DELAY_MS, 10)
      : undefined,
    saveEveryN: process.env.WA_EVENTS_SAVE_EVERY
      ? parseInt(process.env.WA_EVENTS_SAVE_EVERY, 10)
      : undefined,
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
