// src/index.ts
// Public surface of the wild-apricot-exports library. CLI shims and external
// consumers should import from here rather than reaching into individual files.

export { exportAll } from "./exporters/all";
export { exportConfig } from "./exporters/config";
export { exportEvents } from "./exporters/events";
export { retryEventFailures } from "./exporters/retry-events";
export { exportRegistrations } from "./exporters/registrations";
export { exportContacts } from "./exporters/contacts";
export { exportInvoices } from "./exporters/invoices";
export { exportPayments } from "./exporters/payments";
export { exportDonations } from "./exporters/donations";
export { exportAuditLog } from "./exporters/audit-log";
export { exportFiles } from "./exporters/files";

// Loggers
export { consoleLogger, silentLogger } from "./logger";

// Lower-level helpers — useful if a consumer wants to drive their own
// requests/pagination against Wild Apricot using the same retry/backoff
// behavior the exporters use.
export {
  API_BASE,
  apiGet,
  apiFetch,
  paginate,
  asyncQuery,
  createTokenManager,
  discoverAccountId,
  getAuthAndAccount,
  sleep,
} from "./wa-api";

// Types
export type {
  Logger,
  ProgressEvent,
  OnProgress,
  ExportOptions,
  ConfigExportOptions,
  EventsExportOptions,
  RetryEventFailuresOptions,
  RegistrationsExportOptions,
  ContactsExportOptions,
  DateRangeExportOptions,
  InvoicesExportOptions,
  PaymentsExportOptions,
  DonationsExportOptions,
  AuditLogExportOptions,
  FilesExportOptions,
  AllStepName,
  ExportAllOptions,
  ConfigExportResult,
  EventsExportResult,
  RetryEventFailuresResult,
  RegistrationsExportResult,
  ContactsExportResult,
  InvoicesExportResult,
  PaymentsExportResult,
  DonationsExportResult,
  AuditLogExportResult,
  FilesExportResult,
  AllStepResult,
  ExportAllResult,
  TokenManager,
  AuthAndAccount,
} from "./types";
