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

/** Options accepted by `retryEventFailures`. */
export interface RetryEventFailuresOptions extends ExportOptions {
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

/** Options for date-filterable exporters (`exportInvoices`, `exportPayments`, `exportDonations`, `exportAuditLog`). */
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

/** Options accepted by `exportFiles`. */
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

/** Options accepted by `exportAll`. */
export interface ExportAllOptions extends ExportOptions {
  /** Whitelist of steps to run. Default: all. */
  include?: AllStepName[];
  /** Steps to skip. Default: none. */
  exclude?: AllStepName[];

  // Files-specific (only used if "files" runs).
  webdavUrl?: string;
  adminEmail?: string;
  adminPassword?: string;
  fileDirs?: string[];

  // Per-exporter knob bags for fine-grained control.
  configOptions?: Partial<ConfigExportOptions>;
  eventsOptions?: Partial<EventsExportOptions>;
  registrationsOptions?: Partial<RegistrationsExportOptions>;
  contactsOptions?: Partial<ContactsExportOptions>;
  invoicesOptions?: Partial<InvoicesExportOptions>;
  paymentsOptions?: Partial<PaymentsExportOptions>;
  donationsOptions?: Partial<DonationsExportOptions>;
  auditLogOptions?: Partial<AuditLogExportOptions>;
  filesOptions?: Partial<FilesExportOptions>;
}

/* --------------------------------------------------------------------------
 * Result types
 * -------------------------------------------------------------------------- */

export interface ConfigExportResult {
  outDir: string;
  written: Array<{ name: string; path: string }>;
  failed: Array<{ name: string; error: string }>;
}

export interface EventsExportResult {
  outDir: string;
  jsonPath: string;
  csvPath: string;
  failuresPath?: string;
  count: number;
  failureCount: number;
}

export interface RetryEventFailuresResult {
  outDir: string;
  jsonPath: string;
  csvPath: string;
  attempted: number;
  recovered: number;
  stillFailingCount: number;
  failuresPath?: string;
}

export interface RegistrationsExportResult {
  outDir: string;
  jsonPath: string;
  csvPath: string;
  failuresPath?: string;
  count: number;
  failureCount: number;
}

export interface ContactsExportResult {
  outDir: string;
  jsonPath: string;
  csvPath: string;
  count: number;
}

export interface InvoicesExportResult {
  outDir: string;
  jsonPath: string;
  csvPath: string;
  count: number;
}

export interface PaymentsExportResult {
  outDir: string;
  jsonPath: string;
  csvPath: string;
  count: number;
}

export interface DonationsExportResult {
  outDir: string;
  jsonPath: string;
  csvPath: string;
  count: number;
}

export interface AuditLogExportResult {
  outDir: string;
  jsonPath: string;
  csvPath: string;
  count: number;
  startDate: string;
  endDate: string;
}

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

export type AllStepResult =
  | { step: AllStepName; ok: true; result: unknown }
  | { step: AllStepName; ok: false; error: string };

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

export interface TokenManager {
  get(): Promise<string>;
  refresh(): Promise<string>;
  isTokenManager: true;
}

export interface AuthAndAccount {
  token: string;
  tokenManager: TokenManager;
  accountId: string | number;
}
