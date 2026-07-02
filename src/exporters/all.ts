// src/exporters/all.ts
// Orchestrator that runs every individual exporter in sequence and reports
// a summary at the end. Failures in any one exporter are logged but do not
// stop the others — matches the original export-all orchestrator behavior.

import * as fs from "node:fs";
import * as path from "node:path";

import { exportConfig } from "./config";
import { exportEvents } from "./events";
import { exportRegistrations } from "./registrations";
import { exportContacts } from "./contacts";
import { exportInvoices } from "./invoices";
import { exportPayments } from "./payments";
import { exportDonations } from "./donations";
import { exportAuditLog } from "./audit-log";
import { exportFiles } from "./files";

import { resolveLogger } from "../logger";
import type {
  ExportAllOptions,
  ExportAllResult,
  AllStepName,
  AllStepResult,
  EventsExportResult,
} from "../types";

const ORDERED_STEPS: AllStepName[] = [
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

export async function exportAll(opts: ExportAllOptions): Promise<ExportAllResult> {
  const logger = resolveLogger(opts.logger);
  const outDir = opts.outDir || "./exports";

  const include = Array.isArray(opts.include) && opts.include.length ? opts.include : ORDERED_STEPS;
  const exclude = new Set<AllStepName>(opts.exclude ?? []);
  const steps = ORDERED_STEPS.filter((s) => include.includes(s) && !exclude.has(s));

  const results: AllStepResult[] = [];

  // We thread the events list between exportEvents and exportRegistrations
  // so registrations doesn't need to re-fetch it. If exportEvents wasn't run
  // (e.g. user excluded it), exportRegistrations falls back to fetching its
  // own list from the API.
  let cachedEvents: unknown[] | null = null;

  function envelope(step: AllStepName, fn: () => Promise<unknown>): Promise<AllStepResult> {
    return (async () => {
      const banner =
        "===============================================================================";
      logger.info("\n" + banner);
      logger.info(`# ${step}`);
      logger.info(banner);
      try {
        const result = await fn();
        return { step, ok: true, result } as const;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        logger.error(`[${step}] FAILED: ${message}`);
        return { step, ok: false, error: message } as const;
      }
    })();
  }

  for (const step of steps) {
    let result: AllStepResult;
    switch (step) {
      case "config":
        result = await envelope(step, () =>
          exportConfig({
            apiKey: opts.apiKey,
            accountId: opts.accountId,
            outDir,
            logger: opts.logger,
            onProgress: opts.onProgress,
            signal: opts.signal,
            ...(opts.configOptions ?? {}),
          })
        );
        break;
      case "events":
        result = await envelope(step, async () => {
          const r = (await exportEvents({
            apiKey: opts.apiKey,
            accountId: opts.accountId,
            outDir,
            logger: opts.logger,
            onProgress: opts.onProgress,
            signal: opts.signal,
            ...(opts.eventsOptions ?? {}),
          })) as EventsExportResult;
          // Read the JSON we just wrote so we can pass it through to
          // exportRegistrations without re-fetching from the API.
          try {
            cachedEvents = JSON.parse(fs.readFileSync(r.jsonPath, "utf8")) as unknown[];
          } catch {
            cachedEvents = null;
          }
          return r;
        });
        break;
      case "registrations": {
        // If events ran in this same `exportAll` call, prefer the in-memory
        // cache. Otherwise, try to read the on-disk events JSON if it exists
        // (so re-running `exportAll --skip events` after a previous full run
        // still works without an extra fetch). Failing both, registrations
        // will fetch its own list.
        let events: unknown[] | undefined = cachedEvents ?? undefined;
        if (!events) {
          const eventsJson = path.join(outDir, "events", "wild-apricot-events.json");
          if (fs.existsSync(eventsJson)) {
            try {
              events = JSON.parse(fs.readFileSync(eventsJson, "utf8")) as unknown[];
            } catch {
              events = undefined;
            }
          }
        }
        result = await envelope(step, () =>
          exportRegistrations({
            apiKey: opts.apiKey,
            accountId: opts.accountId,
            outDir,
            events,
            logger: opts.logger,
            onProgress: opts.onProgress,
            signal: opts.signal,
            ...(opts.registrationsOptions ?? {}),
          })
        );
        break;
      }
      case "contacts":
        result = await envelope(step, () =>
          exportContacts({
            apiKey: opts.apiKey,
            accountId: opts.accountId,
            outDir,
            logger: opts.logger,
            onProgress: opts.onProgress,
            signal: opts.signal,
            ...(opts.contactsOptions ?? {}),
          })
        );
        break;
      case "invoices":
        result = await envelope(step, () =>
          exportInvoices({
            apiKey: opts.apiKey,
            accountId: opts.accountId,
            outDir,
            logger: opts.logger,
            onProgress: opts.onProgress,
            signal: opts.signal,
            ...(opts.invoicesOptions ?? {}),
          })
        );
        break;
      case "payments":
        result = await envelope(step, () =>
          exportPayments({
            apiKey: opts.apiKey,
            accountId: opts.accountId,
            outDir,
            logger: opts.logger,
            onProgress: opts.onProgress,
            signal: opts.signal,
            ...(opts.paymentsOptions ?? {}),
          })
        );
        break;
      case "donations":
        result = await envelope(step, () =>
          exportDonations({
            apiKey: opts.apiKey,
            accountId: opts.accountId,
            outDir,
            logger: opts.logger,
            onProgress: opts.onProgress,
            signal: opts.signal,
            ...(opts.donationsOptions ?? {}),
          })
        );
        break;
      case "audit-log":
        result = await envelope(step, () =>
          exportAuditLog({
            apiKey: opts.apiKey,
            accountId: opts.accountId,
            outDir,
            logger: opts.logger,
            onProgress: opts.onProgress,
            signal: opts.signal,
            ...(opts.auditLogOptions ?? {}),
          })
        );
        break;
      case "files":
        if (!opts.webdavUrl || !opts.adminEmail || !opts.adminPassword) {
          logger.warn(
            "Skipping files: webdavUrl, adminEmail, and adminPassword required to export files."
          );
          result = {
            step,
            ok: false,
            error: "webdavUrl, adminEmail, and adminPassword required to export files",
          };
        } else {
          result = await envelope(step, () =>
            exportFiles({
              webdavUrl: opts.webdavUrl!,
              adminEmail: opts.adminEmail!,
              adminPassword: opts.adminPassword!,
              outDir,
              fileDirs: opts.fileDirs,
              logger: opts.logger,
              onProgress: opts.onProgress,
              signal: opts.signal,
              ...(opts.filesOptions ?? {}),
            })
          );
        }
        break;
      default: {
        // exhaustiveness check
        const _exhaustive: never = step;
        throw new Error(`Unknown step: ${String(_exhaustive)}`);
      }
    }
    results.push(result);
  }

  const failedCount = results.filter((r) => !r.ok).length;

  logger.info("\n===============================================================================");
  logger.info("# Summary");
  logger.info("===============================================================================");
  for (const r of results) {
    if (r.ok) logger.info(`  ✓ ${r.step}`);
    else logger.info(`  ✗ ${r.step}: ${r.error}`);
  }

  return { outDir, steps, results, failedCount };
}
