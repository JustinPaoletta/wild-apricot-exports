// src/types.ts
// Public type surface for the wild-apricot-exports library.
//
// We deliberately do NOT try to faithfully type Wild Apricot's API responses
// (the API returns inconsistent casing — Id vs id, Name vs Title — across
// endpoints, and any strict typing of those is fragile). The boundary types
// here describe what callers pass IN and what they get OUT after our own
// normalization.

/**
 * Logger interface accepted by every exporter. Default in the library is the
 * silent logger; the CLI uses the console logger.
 */
export interface Logger {
  info(message: string): void;
  warn(message: string): void;
  error(message: string): void;
  /**
   * In-place progress updates (e.g. "skip=300...500 items"). Optional because
   * not every logger has a notion of partial-line output. Falls back to info
   * when omitted.
   */
  progress?(message: string): void;
}

/**
 * Structured progress event delivered to `onProgress` callbacks. Useful for
 * driving dashboards or other programmatic consumers; the human-readable
 * stream still goes to the Logger.
 */
export type ProgressEvent =
  | { kind: "start"; exporter: string; total?: number }
  | { kind: "step"; exporter: string; index: number; total: number; label?: string }
  | { kind: "checkpoint"; exporter: string; processed: number; total: number; failures: number }
  | { kind: "finish"; exporter: string; count: number; failures: number };

export type OnProgress = (event: ProgressEvent) => void;

/**
 * Common options for every exporter.
 */
export interface ExportOptions {
  /** Wild Apricot API key. Required. */
  apiKey: string;

  /** Wild Apricot account ID. Auto-discovered from the API if omitted. */
  accountId?: string | number;

  /**
   * Root output directory. Each exporter writes to a subdirectory beneath it
   * (e.g. `<outDir>/events`, `<outDir>/contacts`). Defaults to `./exports`
   * resolved relative to `process.cwd()`.
   */
  outDir?: string;

  /** Logger. Defaults to a silent logger inside the library. */
  logger?: Logger;

  /** Optional structured progress callback. */
  onProgress?: OnProgress;

  /** Cancellation. When aborted, in-flight requests are cancelled and the function throws. */
  signal?: AbortSignal;
}

/** Options accepted by `exportConfig`. */
export type ConfigExportOptions = ExportOptions;

/** Options accepted by `exportEvents`. */
export interface EventsExportOptions extends ExportOptions {
  /** Spacing between event-detail requests. Default 2200ms. */
  requestDelayMs?: number;
  /** Checkpoint cadence (events processed). Default 100. */
  saveEveryN?: number;
}

/**
 * Options for `retryEventFailures`. Reads the existing events export under
 * `<outDir>/events/` (CSV/JSON produced by `exportEvents`) and re-requests
 * only events that previously failed.
 */
export interface RetryEventFailuresOptions extends ExportOptions {
  /** Spacing between event-detail retries. Default 2200ms. */
  requestDelayMs?: number;
}

/** Options accepted by `exportRegistrations`. */
export interface RegistrationsExportOptions extends ExportOptions {
  /**
   * Optional pre-fetched event list. When provided, the function uses it
   * directly. When omitted, it fetches events fresh from the API. The CLI
   * shim handles the "read from <outDir>/events/wild-apricot-events.json
   * if present" convenience layer.
   */
  events?: unknown[];
  /** Spacing between per-event registration fetches. Default 350ms. */
  requestDelayMs?: number;
  /** Checkpoint cadence (events processed). Default 5. */
  saveEveryN?: number;
}

/** Options accepted by `exportContacts`. */
export type ContactsExportOptions = ExportOptions;

/**
 * Options for date-filterable exporters (`exportInvoices`, `exportPayments`,
 * `exportDonations`, `exportAuditLog`).
 *
 * Shared fields for exporters that honor an optional **inclusive** date range.
 * Dates are **`YYYY-MM-DD`** strings aligned with CLI `--start-date` / `--end-date`.
 */
export interface DateRangeExportOptions extends ExportOptions {
  /** YYYY-MM-DD inclusive lower bound. */
  startDate?: string;
  /** YYYY-MM-DD inclusive upper bound. */
  endDate?: string;
}

export type InvoicesExportOptions = DateRangeExportOptions;
export type PaymentsExportOptions = DateRangeExportOptions;
export type DonationsExportOptions = DateRangeExportOptions;
export type AuditLogExportOptions = DateRangeExportOptions;

/**
 * WebDAV-backed file crawl. Uses **admin digest auth**, not the REST API key.
 * Only `outDir`, `logger`, `onProgress`, and `signal` are inherited from
 * {@link ExportOptions}; there is **no `apiKey`** field on this type.
 */
export interface FilesExportOptions extends Pick<
  ExportOptions,
  "outDir" | "logger" | "onProgress" | "signal"
> {
  /** WebDAV server URL. Required. */
  webdavUrl: string;
  /** Wild Apricot admin email used as the WebDAV username. Required. */
  adminEmail: string;
  /** Wild Apricot admin password used for WebDAV digest auth. Required. */
  adminPassword: string;
  /** Restrict crawl to the given top-level directories. Default: full root crawl. */
  fileDirs?: string[];
  /** Delay between successful downloads. Default 500ms. */
  interFileDelayMs?: number;
  /** Max retry attempts per file. Default 4. */
  maxRetries?: number;
  /** Base delay (ms) for exponential backoff between retries. Default 2000ms. */
  retryBaseMs?: number;
}

/** Per-exporter step name passed to include/exclude in `exportAll`. */
export type AllStepName =
  | "config"
  | "events"
  | "registrations"
  | "contacts"
  | "invoices"
  | "payments"
  | "donations"
  | "audit-log"
  | "files";

/**
 * Options for `exportAll`. Extends {@link ExportOptions} with step selection
 * and optional WebDAV credentials at the **top level** (used only when the
 * `files` step runs). Use `*Options` partials to pass per-step overrides
 * (e.g. `eventsOptions: { saveEveryN: 50 }`) without mutating other steps.
 */
export interface ExportAllOptions extends ExportOptions {
  /** Whitelist of steps to run. Default: all. */
  include?: AllStepName[];
  /** Steps to skip. Default: none. */
  exclude?: AllStepName[];

  /**
   * WebDAV site URL when the `files` step is included. Same semantics as
   * {@link FilesExportOptions.webdavUrl}.
   */
  webdavUrl?: string;
  /**
   * Admin email for WebDAV digest auth when the `files` step is included.
   * Same semantics as {@link FilesExportOptions.adminEmail}.
   */
  adminEmail?: string;
  /**
   * Admin password for WebDAV when the `files` step is included.
   * Same semantics as {@link FilesExportOptions.adminPassword}.
   */
  adminPassword?: string;
  /** Optional directory allowlist forwarded to {@link FilesExportOptions.fileDirs}. */
  fileDirs?: string[];

  /** Overrides merged into the `config` step. */
  configOptions?: Partial<ConfigExportOptions>;
  /** Overrides merged into the `events` step. */
  eventsOptions?: Partial<EventsExportOptions>;
  /** Overrides merged into the `registrations` step. */
  registrationsOptions?: Partial<RegistrationsExportOptions>;
  /** Overrides merged into the `contacts` step. */
  contactsOptions?: Partial<ContactsExportOptions>;
  /** Overrides merged into the `invoices` step. */
  invoicesOptions?: Partial<InvoicesExportOptions>;
  /** Overrides merged into the `payments` step. */
  paymentsOptions?: Partial<PaymentsExportOptions>;
  /** Overrides merged into the `donations` step. */
  donationsOptions?: Partial<DonationsExportOptions>;
  /** Overrides merged into the `audit-log` step. */
  auditLogOptions?: Partial<AuditLogExportOptions>;
  /** Overrides merged into the `files` step (WebDAV options live here too). */
  filesOptions?: Partial<FilesExportOptions>;
}

/* --------------------------------------------------------------------------
 * Result types
 * -------------------------------------------------------------------------- */

/** Outcome of {@link exportConfig}: per-endpoint JSON paths plus any failures. */
export interface ConfigExportResult {
  /** Directory holding `account.json`, `membership-levels.json`, etc. */
  outDir: string;
  /** Successfully written config shards. */
  written: Array<{ name: string; path: string }>;
  /** Endpoints that errored (export continues per shard). */
  failed: Array<{ name: string; error: string }>;
}

/** Outcome of {@link exportEvents}. */
export interface EventsExportResult {
  /** Events directory (`<root>/events`). */
  outDir: string;
  /** Full JSON snapshot path. */
  jsonPath: string;
  /** Flattened spreadsheet path. */
  csvPath: string;
  /** Optional sidecar CSV of rows that failed after retries. */
  failuresPath?: string;
  /** Successfully exported events. */
  count: number;
  /** Events still failing after the run. */
  failureCount: number;
}

/** Outcome of {@link retryEventFailures}: recovery counts for a prior events run. */
export interface RetryEventFailuresResult {
  outDir: string;
  jsonPath: string;
  csvPath: string;
  attempted: number;
  recovered: number;
  stillFailingCount: number;
  /** Sidecar listing events still failing after this pass, if any. */
  failuresPath?: string;
}

/** Outcome of {@link exportRegistrations}. */
export interface RegistrationsExportResult {
  outDir: string;
  jsonPath: string;
  csvPath: string;
  failuresPath?: string;
  count: number;
  failureCount: number;
}

/** Outcome of {@link exportContacts}. */
export interface ContactsExportResult {
  outDir: string;
  jsonPath: string;
  csvPath: string;
  count: number;
}

/** Outcome of {@link exportInvoices}. */
export interface InvoicesExportResult {
  outDir: string;
  jsonPath: string;
  csvPath: string;
  count: number;
}

/** Outcome of {@link exportPayments}. */
export interface PaymentsExportResult {
  outDir: string;
  jsonPath: string;
  csvPath: string;
  count: number;
}

/** Outcome of {@link exportDonations}. */
export interface DonationsExportResult {
  outDir: string;
  jsonPath: string;
  csvPath: string;
  count: number;
}

/** Outcome of {@link exportAuditLog}. Includes the effective query window. */
export interface AuditLogExportResult {
  outDir: string;
  jsonPath: string;
  csvPath: string;
  count: number;
  startDate: string;
  endDate: string;
}

/** Outcome of {@link exportFiles}: manifest path plus crawl/download counters. */
export interface FilesExportResult {
  outDir: string;
  manifestPath: string;
  stats: {
    total: number;
    downloaded: number;
    skipped: number;
    failed: number;
  };
}

/** Per-step discriminated outcome from {@link exportAll}; `result` is the exporter return value when `ok`. */
export type AllStepResult =
  | { step: AllStepName; ok: true; result: unknown }
  | { step: AllStepName; ok: false; error: string };

/** Aggregate result from {@link exportAll}: ordered steps, parallel `results`, and failure tally. */
export interface ExportAllResult {
  outDir: string;
  steps: AllStepName[];
  results: AllStepResult[];
  failedCount: number;
}

/* --------------------------------------------------------------------------
 * Auth / token-manager types (used internally and re-exported as a
 * lower-level helper for advanced consumers).
 * -------------------------------------------------------------------------- */

/**
 * Cached OAuth access token with proactive refresh (~60s before expiry) and
 * reactive {@link TokenManager.refresh} after HTTP 401. Prefer passing this to
 * {@link paginate}, {@link apiFetch}, etc., instead of a raw bearer string so
 * long jobs survive token expiry.
 */
export interface TokenManager {
  /** Current (or freshly refreshed) bearer token for `Authorization`. */
  get(): Promise<string>;
  /** Forces a new token exchange; used internally on 401. */
  refresh(): Promise<string>;
  /** Discriminator for narrowing `string | TokenManager` overloads. */
  isTokenManager: true;
}

/** Convenience bundle from {@link getAuthAndAccount}: one-shot `token`, reusable `tokenManager`, and resolved `accountId`. */
export interface AuthAndAccount {
  token: string;
  tokenManager: TokenManager;
  accountId: string | number;
}
