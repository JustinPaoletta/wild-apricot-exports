// lib/index.js
// Public surface of the wild-apricot-exports library. CLI shims and external
// consumers should import from here rather than reaching into individual files.

const { exportConfig } = require("./exporters/config");
const { exportEvents } = require("./exporters/events");
const { retryEventFailures } = require("./exporters/retry-events");
const { exportRegistrations } = require("./exporters/registrations");
const { exportContacts } = require("./exporters/contacts");
const { exportInvoices } = require("./exporters/invoices");
const { exportPayments } = require("./exporters/payments");
const { exportDonations } = require("./exporters/donations");
const { exportAuditLog } = require("./exporters/audit-log");
const { exportFiles } = require("./exporters/files");
const { exportAll, ALL_STEPS } = require("./exporters/all");

const {
  API_BASE,
  apiGet,
  paginate,
  asyncQuery,
  createTokenManager,
  discoverAccountId,
  getAuthAndAccount,
} = require("./wa-api");

module.exports = {
  // Exporters
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
  exportAll,
  ALL_STEPS,

  // Lower-level helpers (rarely needed, but useful for advanced users)
  API_BASE,
  apiGet,
  paginate,
  asyncQuery,
  createTokenManager,
  discoverAccountId,
  getAuthAndAccount,
};
