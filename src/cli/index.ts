// src/cli/index.ts
// Single-binary CLI for wild-apricot-exports. Replaces the per-exporter
// `npm run export-*` scripts with one `wa-export <subcommand>` command.

import * as fs from "node:fs";
import * as path from "node:path";

import { Command } from "commander";
import dotenv from "dotenv";

import {
  exportAll,
  exportConfig,
  exportEvents,
  retryEventFailures,
  exportRegistrations,
  exportContacts,
  exportInvoices,
  exportPayments,
  exportDonations,
  exportAuditLog,
  exportFiles,
  consoleLogger,
  silentLogger,
} from "../index";
import type { AllStepName, Logger } from "../types";

dotenv.config();

interface CommonEnv {
  apiKey: string;
  accountId?: string | number;
  outDir: string;
}

/** Parse integer env vars used by the legacy `scripts/export-*.js` workflow. */
function envInt(name: string): number | undefined {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return undefined;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) ? n : undefined;
}

interface GlobalCliOpts {
  outDir?: string;
  apiKey?: string;
  accountId?: string;
  quiet?: boolean;
  verbose?: boolean;
}

function getCommonEnv(globalOpts: GlobalCliOpts): CommonEnv {
  const apiKey = globalOpts.apiKey ?? process.env.WILD_APRICOT_API_KEY;
  if (!apiKey) {
    console.error(
      "ERROR: No API key. Pass --api-key, set WILD_APRICOT_API_KEY, or add it to a .env file."
    );
    process.exit(1);
  }
  const outDir = globalOpts.outDir
    ? path.resolve(process.cwd(), globalOpts.outDir)
    : path.join(process.cwd(), "exports");
  const accountId =
    globalOpts.accountId ?? process.env.WILD_APRICOT_ACCOUNT_ID;
  return {
    apiKey,
    accountId:
      accountId === undefined || accountId === ""
        ? undefined
        : /^\d+$/.test(String(accountId))
          ? Number(accountId)
          : accountId,
    outDir,
  };
}

/** CLI uses console output by default; `--quiet` switches to the silent logger. */
function resolveCliLogger(globalOpts: GlobalCliOpts): Logger {
  if (globalOpts.quiet) return silentLogger;
  return consoleLogger;
}

function readGlobalOpts(cmd: Command): GlobalCliOpts {
  return cmd.optsWithGlobals() as GlobalCliOpts;
}

function readPkgVersion(): string {
  // package.json is at the repo root; from dist/cli/index.js it's three
  // levels up. From src/cli/index.ts (during dev) it's also three up if
  // ts-node is used. Try both.
  const candidates = [
    path.join(__dirname, "..", "..", "package.json"),
    path.join(__dirname, "..", "..", "..", "package.json"),
  ];
  for (const p of candidates) {
    try {
      const pkg = JSON.parse(fs.readFileSync(p, "utf8")) as { version?: string };
      if (pkg.version) return pkg.version;
    } catch {
      /* ignore */
    }
  }
  return "0.0.0";
}

function makeAbortSignal(): AbortSignal {
  const ac = new AbortController();
  let signaled = false;
  const handler = () => {
    if (!signaled) {
      signaled = true;
      console.error("\n[wa-export] caught interrupt — finishing in-flight request and aborting...");
      ac.abort(new Error("Interrupted"));
    } else {
      console.error("[wa-export] second interrupt — exiting hard.");
      process.exit(130);
    }
  };
  process.on("SIGINT", handler);
  process.on("SIGTERM", handler);
  return ac.signal;
}

async function runOrExit(fn: () => Promise<unknown>): Promise<void> {
  try {
    await fn();
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      console.error("\n[wa-export] aborted.");
      process.exit(130);
    }
    if (err instanceof Error) {
      console.error(`\n[wa-export] FAILED: ${err.message}`);
    } else {
      console.error("\n[wa-export] FAILED:", err);
    }
    process.exit(1);
  }
}

export function buildCli(): Command {
  const program = new Command();

  program
    .name("wa-export")
    .description("Export data from a Wild Apricot account.")
    .version(readPkgVersion(), "-v, --version")
    .option(
      "-o, --out-dir <dir>",
      "Root output directory (subdirs are created per exporter)",
      "exports"
    )
    .option(
      "--api-key <key>",
      "Wild Apricot API key (overrides WILD_APRICOT_API_KEY)"
    )
    .option(
      "--account-id <id>",
      "Wild Apricot account ID (overrides WILD_APRICOT_ACCOUNT_ID; auto-discovered if omitted)"
    )
    .option("-q, --quiet", "Suppress progress output (errors still print)")
    .option("--verbose", "Enable verbose diagnostics (reserved; default output is informational)")
    .option("--no-color", "Disable ANSI colors (no-op today; reserved for themed output)");

  // ----- all -----
  program
    .command("all")
    .description("Run every exporter in sequence (config → events → registrations → contacts → invoices → payments → donations → audit-log → files).")
    .option("--include <steps>", "Comma-separated whitelist of steps to run.")
    .option("--exclude <steps>", "Comma-separated steps to skip.")
    .option("--start-date <YYYY-MM-DD>", "Lower bound for date-filterable exporters (invoices/payments/donations/audit-log).")
    .option("--end-date <YYYY-MM-DD>", "Upper bound for date-filterable exporters.")
    .option("--file-dirs <dirs>", "Comma-separated top-level WebDAV directories to crawl (defaults to full root).")
    .action(async (
      cmdOpts: {
        include?: string;
        exclude?: string;
        startDate?: string;
        endDate?: string;
        fileDirs?: string;
      },
      cmd: Command
    ) => {
      const g = readGlobalOpts(cmd);
      const env = getCommonEnv(g);
      const logger = resolveCliLogger(g);
      const include = cmdOpts.include
        ? (cmdOpts.include.split(",").map((s) => s.trim()).filter(Boolean) as AllStepName[])
        : undefined;
      const exclude = cmdOpts.exclude
        ? (cmdOpts.exclude.split(",").map((s) => s.trim()).filter(Boolean) as AllStepName[])
        : undefined;
      const fileDirs = cmdOpts.fileDirs
        ? cmdOpts.fileDirs.split(",").map((s) => s.trim()).filter(Boolean)
        : process.env.WILD_APRICOT_FILE_DIRS
          ? process.env.WILD_APRICOT_FILE_DIRS.split(",").map((s) => s.trim()).filter(Boolean)
          : undefined;

      const cliDates =
        cmdOpts.startDate || cmdOpts.endDate
          ? { startDate: cmdOpts.startDate, endDate: cmdOpts.endDate }
          : {};

      await runOrExit(() =>
        exportAll({
          apiKey: env.apiKey,
          accountId: env.accountId,
          outDir: env.outDir,
          logger,
          signal: makeAbortSignal(),
          include,
          exclude,
          webdavUrl: process.env.WILD_APRICOT_WEBDAV_URL,
          adminEmail: process.env.WILD_APRICOT_ADMIN_EMAIL,
          adminPassword: process.env.WILD_APRICOT_ADMIN_PASSWORD,
          fileDirs,
          invoicesOptions: {
            startDate:
              cliDates.startDate ?? process.env.INVOICES_START_DATE,
            endDate: cliDates.endDate ?? process.env.INVOICES_END_DATE,
          },
          paymentsOptions: {
            startDate:
              cliDates.startDate ?? process.env.PAYMENTS_START_DATE,
            endDate: cliDates.endDate ?? process.env.PAYMENTS_END_DATE,
          },
          donationsOptions: {
            startDate:
              cliDates.startDate ?? process.env.DONATIONS_START_DATE,
            endDate: cliDates.endDate ?? process.env.DONATIONS_END_DATE,
          },
          auditLogOptions: {
            startDate:
              cliDates.startDate ?? process.env.AUDIT_START_DATE,
            endDate: cliDates.endDate ?? process.env.AUDIT_END_DATE,
          },
          eventsOptions: {
            requestDelayMs: envInt("WA_EVENT_REQUEST_DELAY_MS"),
            saveEveryN: envInt("WA_EVENTS_SAVE_EVERY"),
          },
          registrationsOptions: {
            requestDelayMs: envInt("WA_REQUEST_DELAY_MS"),
            saveEveryN: envInt("WA_REGISTRATIONS_SAVE_EVERY"),
          },
        })
      );
    });

  // ----- config -----
  program
    .command("config")
    .description("Export account configuration: membership levels, contact fields, picklists, etc.")
    .action(async (_opts, cmd: Command) => {
      const g = readGlobalOpts(cmd);
      const env = getCommonEnv(g);
      const logger = resolveCliLogger(g);
      await runOrExit(() =>
        exportConfig({
          apiKey: env.apiKey,
          accountId: env.accountId,
          outDir: env.outDir,
          logger,
          signal: makeAbortSignal(),
        })
      );
    });

  // ----- events -----
  program
    .command("events")
    .description("Export every event with its full detail payload (resumable via _partial.json).")
    .option("--request-delay-ms <ms>", "Spacing between event-detail requests.", (v) => parseInt(v, 10))
    .option("--save-every-n <n>", "Checkpoint cadence (events processed between writes to _partial.json).", (v) => parseInt(v, 10))
    .action(async (cmdOpts: { requestDelayMs?: number; saveEveryN?: number }, cmd: Command) => {
      const g = readGlobalOpts(cmd);
      const env = getCommonEnv(g);
      const logger = resolveCliLogger(g);
      await runOrExit(() =>
        exportEvents({
          apiKey: env.apiKey,
          accountId: env.accountId,
          outDir: env.outDir,
          logger,
          signal: makeAbortSignal(),
          requestDelayMs:
            cmdOpts.requestDelayMs ?? envInt("WA_EVENT_REQUEST_DELAY_MS"),
          saveEveryN: cmdOpts.saveEveryN ?? envInt("WA_EVENTS_SAVE_EVERY"),
        })
      );
    });

  // ----- retry-events -----
  program
    .command("retry-events")
    .description("Re-fetch events listed in <outDir>/events/_detail_failures.json and merge successes back in.")
    .option("--request-delay-ms <ms>", "Spacing between event-detail requests.", (v) => parseInt(v, 10))
    .action(async (cmdOpts: { requestDelayMs?: number }, cmd: Command) => {
      const g = readGlobalOpts(cmd);
      const env = getCommonEnv(g);
      const logger = resolveCliLogger(g);
      await runOrExit(() =>
        retryEventFailures({
          apiKey: env.apiKey,
          accountId: env.accountId,
          outDir: env.outDir,
          logger,
          signal: makeAbortSignal(),
          requestDelayMs:
            cmdOpts.requestDelayMs ?? envInt("WA_EVENT_REQUEST_DELAY_MS"),
        })
      );
    });

  // ----- registrations -----
  program
    .command("registrations")
    .description("Export event registrations for every event (resumable via registrations.partial.json).")
    .option("--request-delay-ms <ms>", "Spacing between per-event registration fetches.", (v) => parseInt(v, 10))
    .option("--save-every-n <n>", "Checkpoint cadence (events processed between writes to partial.json).", (v) => parseInt(v, 10))
    .action(async (cmdOpts: { requestDelayMs?: number; saveEveryN?: number }, cmd: Command) => {
      const g = readGlobalOpts(cmd);
      const env = getCommonEnv(g);
      const logger = resolveCliLogger(g);
      // CLI convenience: read events from the events JSON if present, so we
      // don't re-fetch the event list when the user just ran `events`.
      let events: unknown[] | undefined;
      const eventsJson = path.join(env.outDir, "events", "wild-apricot-events.json");
      if (fs.existsSync(eventsJson)) {
        try {
          events = JSON.parse(fs.readFileSync(eventsJson, "utf8")) as unknown[];
          logger.info(
            `Found cached events at ${eventsJson} — using ${events.length} events.`
          );
        } catch {
          events = undefined;
        }
      }
      await runOrExit(() =>
        exportRegistrations({
          apiKey: env.apiKey,
          accountId: env.accountId,
          outDir: env.outDir,
          events,
          logger,
          signal: makeAbortSignal(),
          requestDelayMs:
            cmdOpts.requestDelayMs ?? envInt("WA_REQUEST_DELAY_MS"),
          saveEveryN:
            cmdOpts.saveEveryN ?? envInt("WA_REGISTRATIONS_SAVE_EVERY"),
        })
      );
    });

  // ----- contacts -----
  program
    .command("contacts")
    .description("Export all contacts (members + non-members) using the async API pattern.")
    .action(async (_opts, cmd: Command) => {
      const g = readGlobalOpts(cmd);
      const env = getCommonEnv(g);
      const logger = resolveCliLogger(g);
      await runOrExit(() =>
        exportContacts({
          apiKey: env.apiKey,
          accountId: env.accountId,
          outDir: env.outDir,
          logger,
          signal: makeAbortSignal(),
        })
      );
    });

  // ----- invoices -----
  program
    .command("invoices")
    .description("Export all invoices.")
    .option("--start-date <YYYY-MM-DD>", "Inclusive lower bound.")
    .option("--end-date <YYYY-MM-DD>", "Inclusive upper bound.")
    .action(async (cmdOpts: { startDate?: string; endDate?: string }, cmd: Command) => {
      const g = readGlobalOpts(cmd);
      const env = getCommonEnv(g);
      const logger = resolveCliLogger(g);
      await runOrExit(() =>
        exportInvoices({
          apiKey: env.apiKey,
          accountId: env.accountId,
          outDir: env.outDir,
          logger,
          signal: makeAbortSignal(),
          startDate:
            cmdOpts.startDate ?? process.env.INVOICES_START_DATE,
          endDate: cmdOpts.endDate ?? process.env.INVOICES_END_DATE,
        })
      );
    });

  // ----- payments -----
  program
    .command("payments")
    .description("Export all payments.")
    .option("--start-date <YYYY-MM-DD>", "Inclusive lower bound.")
    .option("--end-date <YYYY-MM-DD>", "Inclusive upper bound.")
    .action(async (cmdOpts: { startDate?: string; endDate?: string }, cmd: Command) => {
      const g = readGlobalOpts(cmd);
      const env = getCommonEnv(g);
      const logger = resolveCliLogger(g);
      await runOrExit(() =>
        exportPayments({
          apiKey: env.apiKey,
          accountId: env.accountId,
          outDir: env.outDir,
          logger,
          signal: makeAbortSignal(),
          startDate:
            cmdOpts.startDate ?? process.env.PAYMENTS_START_DATE,
          endDate: cmdOpts.endDate ?? process.env.PAYMENTS_END_DATE,
        })
      );
    });

  // ----- donations -----
  program
    .command("donations")
    .description("Export all donations.")
    .option("--start-date <YYYY-MM-DD>", "Inclusive lower bound.")
    .option("--end-date <YYYY-MM-DD>", "Inclusive upper bound.")
    .action(async (cmdOpts: { startDate?: string; endDate?: string }, cmd: Command) => {
      const g = readGlobalOpts(cmd);
      const env = getCommonEnv(g);
      const logger = resolveCliLogger(g);
      await runOrExit(() =>
        exportDonations({
          apiKey: env.apiKey,
          accountId: env.accountId,
          outDir: env.outDir,
          logger,
          signal: makeAbortSignal(),
          startDate:
            cmdOpts.startDate ?? process.env.DONATIONS_START_DATE,
          endDate: cmdOpts.endDate ?? process.env.DONATIONS_END_DATE,
        })
      );
    });

  // ----- audit-log -----
  program
    .command("audit-log")
    .description("Export the Wild Apricot audit log (defaults to last 30 days).")
    .option("--start-date <YYYY-MM-DD>", "Inclusive lower bound.")
    .option("--end-date <YYYY-MM-DD>", "Inclusive upper bound.")
    .action(async (cmdOpts: { startDate?: string; endDate?: string }, cmd: Command) => {
      const g = readGlobalOpts(cmd);
      const env = getCommonEnv(g);
      const logger = resolveCliLogger(g);
      await runOrExit(() =>
        exportAuditLog({
          apiKey: env.apiKey,
          accountId: env.accountId,
          outDir: env.outDir,
          logger,
          signal: makeAbortSignal(),
          startDate:
            cmdOpts.startDate ?? process.env.AUDIT_START_DATE,
          endDate: cmdOpts.endDate ?? process.env.AUDIT_END_DATE,
        })
      );
    });

  // ----- files -----
  program
    .command("files")
    .description("Recursively download every file from Wild Apricot's WebDAV server (resumable via _manifest.json).")
    .option("--file-dirs <dirs>", "Comma-separated top-level directories to crawl (defaults to full root).")
    .option("--inter-file-delay-ms <ms>", "Pause between successful downloads.", (v) => parseInt(v, 10))
    .option("--max-retries <n>", "Max retry attempts per file.", (v) => parseInt(v, 10))
    .option("--retry-base-ms <ms>", "Base delay (ms) for exponential backoff between retries.", (v) => parseInt(v, 10))
    .action(async (
      cmdOpts: {
        fileDirs?: string;
        interFileDelayMs?: number;
        maxRetries?: number;
        retryBaseMs?: number;
      },
      cmd: Command
    ) => {
      const g = readGlobalOpts(cmd);
      const env = getCommonEnv(g);
      const logger = resolveCliLogger(g);
      const webdavUrl = process.env.WILD_APRICOT_WEBDAV_URL;
      const adminEmail = process.env.WILD_APRICOT_ADMIN_EMAIL;
      const adminPassword = process.env.WILD_APRICOT_ADMIN_PASSWORD;
      if (!webdavUrl || !adminEmail || !adminPassword) {
        console.error(
          "ERROR: WILD_APRICOT_WEBDAV_URL, WILD_APRICOT_ADMIN_EMAIL, and WILD_APRICOT_ADMIN_PASSWORD must all be set."
        );
        process.exit(1);
      }
      const fileDirs = cmdOpts.fileDirs
        ? cmdOpts.fileDirs.split(",").map((s) => s.trim()).filter(Boolean)
        : process.env.WILD_APRICOT_FILE_DIRS
          ? process.env.WILD_APRICOT_FILE_DIRS.split(",").map((s) => s.trim()).filter(Boolean)
          : undefined;
      await runOrExit(() =>
        exportFiles({
          webdavUrl,
          adminEmail,
          adminPassword,
          outDir: env.outDir,
          logger,
          signal: makeAbortSignal(),
          fileDirs,
          interFileDelayMs: cmdOpts.interFileDelayMs,
          maxRetries: cmdOpts.maxRetries,
          retryBaseMs: cmdOpts.retryBaseMs,
        })
      );
    });

  return program;
}

export async function runCli(argv: string[] = process.argv): Promise<void> {
  await buildCli().parseAsync(argv);
}
