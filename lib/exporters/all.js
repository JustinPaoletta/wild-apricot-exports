// lib/exporters/all.js
// Runs every Wild Apricot exporter in sequence. Failures in one step do not
// stop the others. Returns a summary of which steps succeeded and which failed.

const fs = require("fs");
const path = require("path");

const { exportConfig } = require("./config");
const { exportEvents } = require("./events");
const { exportRegistrations } = require("./registrations");
const { exportContacts } = require("./contacts");
const { exportInvoices } = require("./invoices");
const { exportPayments } = require("./payments");
const { exportDonations } = require("./donations");
const { exportAuditLog } = require("./audit-log");
const { exportFiles } = require("./files");

// The orchestrator preserves the cross-exporter cache contract: events writes
// its JSON to disk, then registrations re-reads that file (matching today's
// CLI behavior). Library users calling exportRegistrations directly should
// instead pass `events: Event[]` themselves — see lib/exporters/registrations.js.
function loadEventsCache(outDir) {
  const eventsCachePath = path.join(outDir, "events", "wild-apricot-events.json");
  if (!fs.existsSync(eventsCachePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(eventsCachePath, "utf8"));
  } catch {
    return null;
  }
}

const ALL_STEPS = [
  "config",
  "events",
  "registrations",
  "contacts",
  "invoices",
  "payments",
  "donations",
  "audit-log",
  "files",
];

async function exportAll(opts = {}) {
  const outDir = opts.outDir || "./exports";
  const include =
    Array.isArray(opts.include) && opts.include.length ? opts.include : ALL_STEPS;
  const exclude = Array.isArray(opts.exclude) ? opts.exclude : [];
  const steps = include.filter((s) => !exclude.includes(s));

  // Per-exporter knob bags (callers can pass invoiceOptions, eventsOptions, etc.
  // for fine-grained control without polluting the top-level opts).
  const passthrough = (extra = {}) => ({
    apiKey: opts.apiKey,
    accountId: opts.accountId,
    outDir,
    ...extra,
  });

  const results = [];

  for (const step of steps) {
    console.log(`\n========== ${step.toUpperCase()} ==========`);
    try {
      let result;
      switch (step) {
        case "config":
          result = await exportConfig(passthrough(opts.configOptions));
          break;
        case "events":
          result = await exportEvents(passthrough(opts.eventsOptions));
          break;
        case "registrations":
          // Match the original CLI behavior: read events from disk if present.
          result = await exportRegistrations(
            passthrough({
              events: loadEventsCache(outDir),
              ...(opts.registrationsOptions || {}),
            })
          );
          break;
        case "contacts":
          result = await exportContacts(passthrough(opts.contactsOptions));
          break;
        case "invoices":
          result = await exportInvoices(passthrough(opts.invoicesOptions));
          break;
        case "payments":
          result = await exportPayments(passthrough(opts.paymentsOptions));
          break;
        case "donations":
          result = await exportDonations(passthrough(opts.donationsOptions));
          break;
        case "audit-log":
          result = await exportAuditLog(passthrough(opts.auditLogOptions));
          break;
        case "files":
          result = await exportFiles({
            webdavUrl: opts.webdavUrl,
            adminEmail: opts.adminEmail,
            adminPassword: opts.adminPassword,
            outDir,
            fileDirs: opts.fileDirs,
            ...(opts.filesOptions || {}),
          });
          break;
        default:
          throw new Error(`Unknown step: ${step}`);
      }
      results.push({ step, ok: true, result });
    } catch (err) {
      const msg = err && err.message ? err.message : String(err);
      console.error(`Step "${step}" failed: ${msg}`);
      results.push({ step, ok: false, error: msg });
    }
  }

  console.log("\n========== SUMMARY ==========");
  for (const r of results) {
    console.log(`${r.ok ? "OK   " : "FAIL "} ${r.step}`);
  }

  const failed = results.filter((r) => !r.ok);
  return {
    outDir,
    steps,
    results,
    failedCount: failed.length,
  };
}

module.exports = { exportAll, ALL_STEPS };
