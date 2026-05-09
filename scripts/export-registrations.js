#!/usr/bin/env node
// scripts/export-registrations.js — thin CLI shim over lib/exporters/registrations.js
// Preserves the legacy CLI behavior: read events from disk if present.

require("dotenv").config();

const fs = require("fs");
const path = require("path");
const { exportRegistrations } = require("../lib/exporters/registrations");

function readEventsCacheIfPresent(outDir) {
  const cachePath = path.join(outDir, "events", "wild-apricot-events.json");
  if (!fs.existsSync(cachePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(cachePath, "utf8"));
  } catch (err) {
    console.warn(
      `Failed to parse cached events at ${cachePath}: ${err.message}. Will fetch fresh.`
    );
    return null;
  }
}

async function main() {
  const outDir = path.join(process.cwd(), "exports");
  const cachedEvents = readEventsCacheIfPresent(outDir);
  if (cachedEvents) {
    console.log(`Using cached event list: ${path.join(outDir, "events", "wild-apricot-events.json")}`);
  } else {
    console.log("No cached events found — will fetch event list.");
  }

  await exportRegistrations({
    apiKey: process.env.WILD_APRICOT_API_KEY,
    accountId: process.env.WILD_APRICOT_ACCOUNT_ID,
    outDir,
    events: cachedEvents,
    requestDelayMs: process.env.WA_REQUEST_DELAY_MS
      ? parseInt(process.env.WA_REQUEST_DELAY_MS, 10)
      : undefined,
    saveEveryN: process.env.WA_REGISTRATIONS_SAVE_EVERY
      ? parseInt(process.env.WA_REGISTRATIONS_SAVE_EVERY, 10)
      : undefined,
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
