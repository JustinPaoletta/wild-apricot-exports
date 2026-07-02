# API Reference

Programmatic reference for **`wild-apricot-exports@1.0.0`**. For installation, credentials, and CLI usage, see [README.md](README.md).

## Module format

The published package is **CommonJS** (`require`). TypeScript and ESM projects can use `import` via standard interop:

```ts
import { exportContacts, consoleLogger } from "wild-apricot-exports";
```

```js
const { exportContacts, consoleLogger } = require("wild-apricot-exports");
```

Type definitions ship in `dist/index.d.ts` (also mirrored in-repo as `src/types.ts`).

---

## Package exports

### Functions

| Export                | Returns                              | Description                                   |
| --------------------- | ------------------------------------ | --------------------------------------------- |
| `exportConfig`        | `Promise<ConfigExportResult>`        | Account metadata shards as JSON               |
| `exportEvents`        | `Promise<EventsExportResult>`        | Events with full detail payloads → JSON + CSV |
| `retryEventFailures`  | `Promise<RetryEventFailuresResult>`  | Re-fetch events from `_detail_failures.json`  |
| `exportRegistrations` | `Promise<RegistrationsExportResult>` | Registrations per event → JSON + CSV          |
| `exportContacts`      | `Promise<ContactsExportResult>`      | Contacts / members → JSON + CSV               |
| `exportInvoices`      | `Promise<InvoicesExportResult>`      | Invoices → JSON + CSV                         |
| `exportPayments`      | `Promise<PaymentsExportResult>`      | Payments → JSON + CSV                         |
| `exportDonations`     | `Promise<DonationsExportResult>`     | Donations → JSON + CSV                        |
| `exportAuditLog`      | `Promise<AuditLogExportResult>`      | Audit log → JSON + CSV                        |
| `exportFiles`         | `Promise<FilesExportResult>`         | WebDAV file crawl (no API key)                |
| `exportAll`           | `Promise<ExportAllResult>`           | Run multiple steps in sequence                |
| `consoleLogger`       | `Logger`                             | Stdout/stderr logger (CLI default)            |
| `silentLogger`        | `Logger`                             | No-op logger (library default)                |
| `API_BASE`            | `string`                             | `https://api.wildapricot.org/v2.2`            |
| `createTokenManager`  | `TokenManager`                       | OAuth client-credentials with refresh         |
| `getAuthAndAccount`   | `Promise<AuthAndAccount>`            | Token manager + resolved account id           |
| `discoverAccountId`   | `Promise<string \| number>`          | `GET /accounts` → first account id            |
| `apiFetch`            | `Promise<unknown>`                   | Authenticated HTTP with retries               |
| `apiGet`              | `Promise<unknown>`                   | `apiFetch` with `GET`                         |
| `paginate`            | `Promise<unknown[]>`                 | OData `$skip` / `$top` paging                 |
| `asyncQuery`          | `Promise<unknown>`                   | Wild Apricot async query poll loop            |
| `sleep`               | `Promise<void>`                      | Delay; rejects on `AbortSignal`               |

### Types

`Logger`, `ProgressEvent`, `OnProgress`, `ExportOptions`, `ConfigExportOptions`, `EventsExportOptions`, `RetryEventFailuresOptions`, `RegistrationsExportOptions`, `ContactsExportOptions`, `DateRangeExportOptions`, `InvoicesExportOptions`, `PaymentsExportOptions`, `DonationsExportOptions`, `AuditLogExportOptions`, `FilesExportOptions`, `AllStepName`, `ExportAllOptions`, `ConfigExportResult`, `EventsExportResult`, `RetryEventFailuresResult`, `RegistrationsExportResult`, `ContactsExportResult`, `InvoicesExportResult`, `PaymentsExportResult`, `DonationsExportResult`, `AuditLogExportResult`, `FilesExportResult`, `AllStepResult`, `ExportAllResult`, `TokenManager`, `AuthAndAccount`

---

## Shared options

Most REST exporters extend **`ExportOptions`**:

```ts
interface ExportOptions {
  apiKey: string; // required
  accountId?: string | number; // auto-discovered via GET /accounts if omitted
  outDir?: string; // default: "./exports" (resolved from process.cwd())
  logger?: Logger; // default: silentLogger
  onProgress?: (event: ProgressEvent) => void;
  signal?: AbortSignal; // abort → throws AbortError
}
```

**`exportFiles`** does **not** accept `apiKey`. It uses WebDAV digest auth instead (see below).

**Cancellation:** When `signal` aborts, in-flight `fetch` calls are cancelled and the exporter throws. Wrap in `try/catch` and check `err.name === "AbortError"`.

---

## Progress events

Pass `onProgress` for structured updates (dashboards, progress bars). Human-readable output still goes to `logger`.

```ts
type ProgressEvent =
  | { kind: "start"; exporter: string; total?: number }
  | { kind: "step"; exporter: string; index: number; total: number; label?: string }
  | { kind: "checkpoint"; exporter: string; processed: number; total: number; failures: number }
  | { kind: "finish"; exporter: string; count: number; failures: number };
```

---

## Logger

```ts
interface Logger {
  info(message: string): void;
  warn(message: string): void;
  error(message: string): void;
  progress?(message: string): void; // optional; falls back to info in some code paths
}
```

Use `consoleLogger` for CLI-style output. Omit `logger` (or pass `silentLogger`) for quiet embedding.

---

## Exporters

### `exportConfig(options: ConfigExportOptions): Promise<ConfigExportResult>`

Writes one JSON file per config endpoint under `<outDir>/config/`:

| File                     | REST path           |
| ------------------------ | ------------------- |
| `account.json`           | `/accounts/:id`     |
| `membership-levels.json` | `/membershiplevels` |
| `contact-fields.json`    | `/contactfields`    |
| `saved-searches.json`    | `/savedsearches`    |
| `tenders.json`           | `/tenders`          |
| `picklists.json`         | `/picklists`        |
| `campaigns.json`         | `/campaigns`        |
| `funds.json`             | `/funds`            |

Individual shards can fail without stopping the rest. Check `result.failed`.

**Result:**

```ts
interface ConfigExportResult {
  outDir: string;
  written: Array<{ name: string; path: string }>;
  failed: Array<{ name: string; error: string }>;
}
```

---

### `exportEvents(options: EventsExportOptions): Promise<EventsExportResult>`

Fetches every event, then fetches each event's **detail** payload (rate-limited).

| Option           | Default | Description                             |
| ---------------- | ------- | --------------------------------------- |
| `requestDelayMs` | `2200`  | Pause between detail requests (~27/min) |
| `saveEveryN`     | `100`   | Checkpoint every N events               |

**Output** (`<outDir>/events/`):

| File                       | Purpose                                     |
| -------------------------- | ------------------------------------------- |
| `wild-apricot-events.json` | Full event array                            |
| `wild-apricot-events.csv`  | Flattened spreadsheet                       |
| `_partial.json`            | Resume checkpoint (removed on success)      |
| `_detail_failures.json`    | Events that fell back to list data (if any) |

**Result:**

```ts
interface EventsExportResult {
  outDir: string;
  jsonPath: string;
  csvPath: string;
  failuresPath?: string;
  count: number;
  failureCount: number;
}
```

---

### `retryEventFailures(options: RetryEventFailuresOptions): Promise<RetryEventFailuresResult>`

Reads `<outDir>/events/_detail_failures.json`, re-fetches detail for each failed event, merges successes back into the main JSON/CSV, and rewrites or removes the failures file.

| Option           | Default |
| ---------------- | ------- |
| `requestDelayMs` | `2200`  |

**Result:**

```ts
interface RetryEventFailuresResult {
  outDir: string;
  jsonPath: string;
  csvPath: string;
  attempted: number;
  recovered: number;
  stillFailingCount: number;
  failuresPath?: string;
}
```

---

### `exportRegistrations(options: RegistrationsExportOptions): Promise<RegistrationsExportResult>`

One registration fetch per event.

| Option           | Default            | Description                                                                      |
| ---------------- | ------------------ | -------------------------------------------------------------------------------- |
| `events`         | _(fetch from API)_ | Pre-fetched event list; CLI reads cached `wild-apricot-events.json` when present |
| `requestDelayMs` | `350`              | Pause between per-event fetches                                                  |
| `saveEveryN`     | `5`                | Checkpoint every N events                                                        |

**Output** (`<outDir>/registrations/`):

| File                         | Purpose                                |
| ---------------------------- | -------------------------------------- |
| `registrations.json`         | All registrations                      |
| `registrations.csv`          | Flattened spreadsheet                  |
| `registrations.partial.json` | Resume checkpoint (removed on success) |
| `_failures.json`             | Per-event fetch failures (if any)      |

---

### `exportContacts(options: ContactsExportOptions): Promise<ContactsExportResult>`

Uses Wild Apricot's async contact query pattern. Not resumable mid-run (re-run is idempotent overwrite).

**Output:** `<outDir>/contacts/contacts.json`, `contacts.csv`

---

### Date-filtered exporters

`exportInvoices`, `exportPayments`, `exportDonations`, and `exportAuditLog` accept optional **inclusive** `YYYY-MM-DD` bounds:

```ts
interface DateRangeExportOptions extends ExportOptions {
  startDate?: string;
  endDate?: string;
}
```

Omit both dates to fetch everything the API returns.

**`exportAuditLog` defaults:** When dates are omitted, the exporter uses the **last 30 days**. The API only retains audit history for a limited window (often 30–90 days depending on plan).

**Output paths:**

| Exporter          | JSON                                | CSV             |
| ----------------- | ----------------------------------- | --------------- |
| `exportInvoices`  | `<outDir>/invoices/invoices.json`   | `invoices.csv`  |
| `exportPayments`  | `<outDir>/payments/payments.json`   | `payments.csv`  |
| `exportDonations` | `<outDir>/donations/donations.json` | `donations.csv` |
| `exportAuditLog`  | `<outDir>/audit-log/audit-log.json` | `audit-log.csv` |

**Audit log result** also includes `startDate` and `endDate` (the effective query window).

---

### `exportFiles(options: FilesExportOptions): Promise<FilesExportResult>`

Crawls Wild Apricot's **WebDAV** server with HTTP **Digest** auth (admin email + password — not the API key).

```ts
interface FilesExportOptions {
  webdavUrl: string; // e.g. https://yourorg.wildapricot.org/resources
  adminEmail: string;
  adminPassword: string;
  outDir?: string; // default: "./exports"
  fileDirs?: string[]; // default: crawl `/` recursively
  interFileDelayMs?: number; // default: 500
  maxRetries?: number; // default: 4
  retryBaseMs?: number; // default: 2000
  logger?: Logger;
  onProgress?: OnProgress;
  signal?: AbortSignal;
}
```

**Output** (`<outDir>/files/`): original folder structure from WebDAV plus `_manifest.json` (resume + download stats).

**Result:**

```ts
interface FilesExportResult {
  outDir: string;
  manifestPath: string;
  stats: { total: number; downloaded: number; skipped: number; failed: number };
}
```

**Errors:** If any download still fails after retries, `exportFiles` **throws** (with `code: "FILE_DOWNLOAD_FAILURES"` and `stats` / `manifestPath` on the error object). Re-run to retry failed entries listed in `_manifest.json`.

---

### `exportAll(options: ExportAllOptions): Promise<ExportAllResult>`

Runs exporters **sequentially** in this order:

`config` → `events` → `registrations` → `contacts` → `invoices` → `payments` → `donations` → `audit-log` → `files`

A failure in one step is recorded but **does not stop** later steps.

```ts
interface ExportAllOptions extends ExportOptions {
  include?: AllStepName[]; // default: all steps
  exclude?: AllStepName[];

  // Used when the `files` step runs (skipped with a warning if missing):
  webdavUrl?: string;
  adminEmail?: string;
  adminPassword?: string;
  fileDirs?: string[];

  // Per-step overrides (merged into that step's options):
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
```

**Step names (`AllStepName`):** `"config"`, `"events"`, `"registrations"`, `"contacts"`, `"invoices"`, `"payments"`, `"donations"`, `"audit-log"`, `"files"`

When `events` completes inside `exportAll`, the event list is passed to `registrations` in memory. If `events` was excluded, `exportAll` tries to read `<outDir>/events/wild-apricot-events.json` before falling back to an API fetch.

**Result:**

```ts
type AllStepResult =
  | { step: AllStepName; ok: true; result: unknown }
  | { step: AllStepName; ok: false; error: string };

interface ExportAllResult {
  outDir: string;
  steps: AllStepName[];
  results: AllStepResult[];
  failedCount: number;
}
```

---

## REST helpers (advanced)

Use these to build custom Wild Apricot integrations with the same OAuth, 429 backoff, and 401 refresh behavior as the exporters.

### `createTokenManager(apiKey, { signal? }): TokenManager`

Caches OAuth access tokens, refreshes ~60s before expiry, and exposes `refresh()` for reactive 401 recovery.

```ts
interface TokenManager {
  get(): Promise<string>;
  refresh(): Promise<string>;
  isTokenManager: true;
}
```

Prefer passing a `TokenManager` to `paginate` / `apiFetch` over a raw bearer string for long-running jobs.

### `getAuthAndAccount({ apiKey, accountId?, signal?, logger? }): Promise<AuthAndAccount>`

```ts
interface AuthAndAccount {
  token: string; // primed bearer snapshot
  tokenManager: TokenManager;
  accountId: string | number;
}
```

### `discoverAccountId(tokenOrManager, { signal?, logger? })`

Returns the first account id from `GET ${API_BASE}/accounts`.

### `apiFetch(url, tokenOrManager, options?)`

| Option               | Default | Description                                    |
| -------------------- | ------- | ---------------------------------------------- |
| `method`             | `"GET"` | HTTP method                                    |
| `retries`            | `3`     | Transient / 5xx retries                        |
| `rateLimitRetries`   | `8`     | 429 retries with exponential backoff           |
| `maxBackoffSeconds`  | `300`   | Cap for 429 wait                               |
| `authRefreshRetries` | `2`     | 401 refresh attempts (requires `TokenManager`) |
| `signal`             | —       | AbortSignal                                    |
| `logger`             | silent  | Progress / retry logging                       |

Handles JSON and occasional XML responses (some audit-log accounts).

### `apiGet(url, tokenOrManager, options?)`

Same as `apiFetch` with default GET.

### `paginate(baseUrl, tokenOrManager, { top?, params?, signal?, logger? })`

Walks `$top` / `$skip` pages until a short page. Default `top`: `100`.

### `asyncQuery(baseUrl, tokenOrManager, params?, { signal?, logger? })`

Starts an async Wild Apricot query; polls every 2s until `State === "Complete"` (timeout ~4 minutes).

### `sleep(ms, signal?)`

Promise-based delay. Rejects with `AbortError` if `signal` aborts.

---

## Environment variables (CLI)

The CLI reads these from `process.env` or a `.env` file in the working directory. See [`.env.example`](.env.example) for the full list.

| Variable                                      | Used by                           |
| --------------------------------------------- | --------------------------------- |
| `WILD_APRICOT_API_KEY`                        | REST exporters & `all`            |
| `WILD_APRICOT_ACCOUNT_ID`                     | REST exporters & `all` (optional) |
| `WILD_APRICOT_WEBDAV_URL`                     | `files`, `all`                    |
| `WILD_APRICOT_ADMIN_EMAIL`                    | `files`, `all`                    |
| `WILD_APRICOT_ADMIN_PASSWORD`                 | `files`, `all`                    |
| `WILD_APRICOT_FILE_DIRS`                      | `files`, `all` (comma-separated)  |
| `WA_EVENT_REQUEST_DELAY_MS`                   | `events`, `retry-events`, `all`   |
| `WA_EVENTS_SAVE_EVERY`                        | `events`, `all`                   |
| `WA_REQUEST_DELAY_MS`                         | `registrations`, `all`            |
| `WA_REGISTRATIONS_SAVE_EVERY`                 | `registrations`, `all`            |
| `INVOICES_START_DATE` / `INVOICES_END_DATE`   | `invoices`, `all`                 |
| `PAYMENTS_START_DATE` / `PAYMENTS_END_DATE`   | `payments`, `all`                 |
| `DONATIONS_START_DATE` / `DONATIONS_END_DATE` | `donations`, `all`                |
| `AUDIT_START_DATE` / `AUDIT_END_DATE`         | `audit-log`, `all`                |

Library callers pass equivalent values as function options instead of reading env vars.

---

## Examples

### Single exporter

```ts
import { exportContacts, consoleLogger } from "wild-apricot-exports";

const result = await exportContacts({
  apiKey: process.env.WILD_APRICOT_API_KEY!,
  outDir: "./exports",
  logger: consoleLogger,
});

console.log(`${result.count} contacts → ${result.csvPath}`);
```

### Orchestrated backup

```ts
import { exportAll, consoleLogger } from "wild-apricot-exports";

const { failedCount, results } = await exportAll({
  apiKey: process.env.WILD_APRICOT_API_KEY!,
  outDir: "./exports",
  logger: consoleLogger,
  exclude: ["files"], // skip WebDAV unless credentials are set
  invoicesOptions: { startDate: "2020-01-01" },
});

for (const r of results) {
  console.log(r.ok ? `✓ ${r.step}` : `✗ ${r.step}: ${r.error}`);
}
```

### Cancellation

```ts
const ac = new AbortController();
setTimeout(() => ac.abort(), 30_000);

try {
  await exportEvents({ apiKey: "…", signal: ac.signal });
} catch (err) {
  if (err instanceof Error && err.name === "AbortError") {
    console.log("Export cancelled");
  }
}
```

### Custom API call

```ts
import { API_BASE, getAuthAndAccount, paginate } from "wild-apricot-exports";

const { tokenManager, accountId } = await getAuthAndAccount({
  apiKey: process.env.WILD_APRICOT_API_KEY!,
});

const levels = await paginate(`${API_BASE}/accounts/${accountId}/membershiplevels`, tokenManager);
```
