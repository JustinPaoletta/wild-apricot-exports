# wild-apricot-exports

Export and back up your [Wild Apricot](https://www.wildapricot.com/) data directly, without using the admin UI.

A set of small Node.js scripts that pull your data out of Wild Apricot via the public REST API (and WebDAV for files) and save it locally as JSON, CSV, and the original uploaded files.

## What gets exported

| Script                    | Output                                                | Source           |
| ------------------------- | ----------------------------------------------------- | ---------------- |
| `export-config.js`        | Account / membership levels / event tags / settings   | REST API         |
| `export-events.js`        | All events                                            | REST API         |
| `export-registrations.js` | Event registrations                                   | REST API         |
| `export-contacts.js`      | Contacts / members                                    | REST API         |
| `export-invoices.js`      | Invoices                                              | REST API         |
| `export-payments.js`      | Payments                                              | REST API         |
| `export-donations.js`     | Donations                                             | REST API         |
| `export-audit-log.js`     | Audit log entries                                     | REST API         |
| `export-files.js`         | All uploaded files (Documents, Pictures, Logos, etc.) | WebDAV           |
| `export-all.js`           | Runs every script above in sequence                   | REST API + WebDAV |

REST exports are written as both `.json` (full payload) and `.csv` (flattened, spreadsheet-friendly). File exports preserve the original folder structure under `exports/files/`.

## Requirements

- Node.js 18+
- A Wild Apricot account with admin access
- A Wild Apricot **API key** (Settings → Authorized applications → Authorize application)
- For file export only: your Wild Apricot **admin login** (email + password) — the WebDAV server does not accept API keys

## Setup

```bash
git clone https://github.com/JustinPaoletta/wild-apricot-exports.git
cd wild-apricot-exports
npm install
cp .env.example .env
```

Then edit `.env` and fill in your credentials. At minimum you need `WILD_APRICOT_API_KEY`. To export files you also need the WebDAV URL and admin login. See `.env.example` for the full list of options, including optional date-range filters for invoices, payments, donations, and the audit log.

## Usage

Run any individual exporter:

```bash
npm run export-events
npm run export-contacts
npm run export-invoices
npm run export-payments
npm run export-donations
npm run export-registrations
npm run export-audit-log
npm run export-config
npm run export-files
```

Or run everything at once:

```bash
npm run export-all
```

`export-all` runs each step sequentially and prints a summary at the end. A failure in one step does not stop the others.

## Output

Everything is written under `exports/` in the project directory:

```
exports/
  config/         account.json, membership-levels.csv, ...
  events/         events.json, events.csv
  registrations/  registrations.json, registrations.csv
  contacts/       contacts.json, contacts.csv
  invoices/       invoices.json, invoices.csv
  payments/       payments.json, payments.csv
  donations/      donations.json, donations.csv
  audit-log/      audit-log.json, audit-log.csv
  files/          <original folder structure from WebDAV>
                  _manifest.json
```

`exports/` is gitignored — your data stays on your machine.

## Notes

- **File downloads are resumable.** `export-files.js` writes a manifest after every file, so re-running it skips files already downloaded successfully and retries failed ones.
- **WebDAV uses HTTP Digest auth.** Wild Apricot's WebDAV endpoint returns 500 on Basic auth; the script handles this automatically.
- **Auto-discovery of top-level WebDAV folders is unreliable** — listing `/` often 500s. The default `WILD_APRICOT_TOP_DIRS` covers the standard set (Documents, Pictures, Logos, Theme, Theme_Overrides, SiteUploads, SiteAlbums, EmailTemplates, favicon, Site). Add or remove entries as needed.
- **Audit log retention is limited** by Wild Apricot (often 30–90 days depending on plan). Old `AUDIT_START_DATE` values will simply return nothing.
- **Date filters** for invoices, payments, donations, and the audit log are optional. Leave them blank in `.env` to fetch everything.

## License

MIT
