#!/usr/bin/env node
// scripts/export-all.js — thin CLI shim over lib/exporters/all.js
//
// Runs every Wild Apricot exporter in sequence. Failures in one step do not
// stop the others. Final summary lists what worked and what didn't.

require("dotenv").config();

const path = require("path");
const { exportAll } = require("../lib/exporters/all");

function parseFileDirsEnv(value) {
  if (!value || !value.trim()) return [];
  return value
    .split(",")
    .map((d) => d.trim())
    .filter(Boolean);
}

async function main() {
  const result = await exportAll({
    apiKey: process.env.WILD_APRICOT_API_KEY,
    accountId: process.env.WILD_APRICOT_ACCOUNT_ID,
    outDir: path.join(process.cwd(), "exports"),

    // Files-specific (only used if "files" step runs).
    webdavUrl: process.env.WILD_APRICOT_WEBDAV_URL,
    adminEmail: process.env.WILD_APRICOT_ADMIN_EMAIL,
    adminPassword: process.env.WILD_APRICOT_ADMIN_PASSWORD,
    fileDirs: parseFileDirsEnv(process.env.WILD_APRICOT_FILE_DIRS),

    // Date filter env vars threaded through to the relevant exporters.
    invoicesOptions: {
      startDate: process.env.INVOICES_START_DATE,
      endDate: process.env.INVOICES_END_DATE,
    },
    paymentsOptions: {
      startDate: process.env.PAYMENTS_START_DATE,
      endDate: process.env.PAYMENTS_END_DATE,
    },
    donationsOptions: {
      startDate: process.env.DONATIONS_START_DATE,
      endDate: process.env.DONATIONS_END_DATE,
    },
    auditLogOptions: {
      startDate: process.env.AUDIT_START_DATE,
      endDate: process.env.AUDIT_END_DATE,
    },
    eventsOptions: {
      requestDelayMs: process.env.WA_EVENT_REQUEST_DELAY_MS
        ? parseInt(process.env.WA_EVENT_REQUEST_DELAY_MS, 10)
        : undefined,
      saveEveryN: process.env.WA_EVENTS_SAVE_EVERY
        ? parseInt(process.env.WA_EVENTS_SAVE_EVERY, 10)
        : undefined,
    },
    registrationsOptions: {
      requestDelayMs: process.env.WA_REQUEST_DELAY_MS
        ? parseInt(process.env.WA_REQUEST_DELAY_MS, 10)
        : undefined,
      saveEveryN: process.env.WA_REGISTRATIONS_SAVE_EVERY
        ? parseInt(process.env.WA_REGISTRATIONS_SAVE_EVERY, 10)
        : undefined,
    },
  });

  if (result.failedCount > 0) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
