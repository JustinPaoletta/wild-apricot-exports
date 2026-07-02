# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Documentation

- **API.md:** full programmatic reference (exporters, options, return types, REST helpers, env vars, examples).
- **README / `.env.example` / CONTRIBUTING:** aligned with v1.0.0 CLI (`wa-export`), resumability filenames, audit-log defaults, and WebDAV CLI flags.

## [1.0.0] - 2026-07-02

### Added

- **Test suite:** Vitest coverage for the REST client (`wa-api`), Zod schemas, loggers, CLI routing, `exportAll` orchestration, individual exporters (config, contacts, invoices, payments, donations, audit-log, events, files), and shared test helpers for mocked `fetch` / temp directories.
- **`npm run test:coverage`** with V8 coverage thresholds in `vitest.config.ts`.

### Changed

- **1.0.0 stable release:** TypeScript `src/` → `dist/` is the sole supported implementation; removed legacy in-repo CommonJS reference trees under `lib/` and `scripts/`.
- **CLI:** removed reserved no-op flags `--verbose` and `--no-color` (they can return when implemented).
- **`apiFetch`:** simplified error handling so 4xx/5xx retry vs fast-fail is decided in one place (the catch block).

### Removed

- Legacy CommonJS reference implementation (`lib/`, `scripts/`).

## [0.2.1] - 2026-05-15

### Fixed

- CLI `files` subcommand no longer requires `WILD_APRICOT_API_KEY` / `--api-key` (only WebDAV admin credentials and output directory are needed), matching documented behavior for file exports.

### Documentation

- **README:** centered header logo; clarified which environment variables and global CLI options apply to REST exporters / `all` vs `files`-only WebDAV runs.

### Changed

- **npm package:** ship `assets/wae-logo.png` and list it in `package.json` `files` so the README image resolves on the npm package page.

## [0.2.0] - 2026-05-11

### Added

- Maintainer post-publish checklist: `POST_PUBLISH_CHECKLIST.md`.

### Changed

- `CONTRIBUTING.md`: releasing section points at `POST_PUBLISH_CHECKLIST.md` after publishes.

### Documentation

- **README:** “Library exports (quick reference)” tables for exporters, loggers, and REST helpers; clearer baseline `ExportOptions` notes (`exportFiles` without `apiKey`, `exportAll` orchestration).
- **Published typings / editor hints:** richer JSDoc on public surface (`types.ts`, `wa-api.ts`, `logger.ts`, `index.ts`).

## [0.1.1] - 2026-05-10

### Fixed

- TypeScript: use `module` / `moduleResolution` `"Node16"` / `"node16"` instead of deprecated `node10` and `ignoreDeprecations: "6.0"` (that value is invalid under TypeScript 5’s config validation).
- Files exporter: load ESM-only `webdav` with dynamic `import()` and a type-only import using `resolution-mode: "import"` so Node16 resolution matches runtime.

### Changed

- README: clearer consumption paths (global install, `npx`, local dependency), CommonJS `require` example and module-format note, explicit typings location under `node_modules`, and local-CLI hints for quick start and `--help`.

### Added

- GitHub Actions **CI** (Node 20 & 22): lint, Prettier check, typecheck, build, test.
- GitHub Actions **Publish** workflow on tags `v*` using npm **Trusted Publishing** (OIDC; no `NPM_TOKEN`).
- **ESLint** (flat config) + **Prettier** + **EditorConfig**.
- **CONTRIBUTING.md** and **CODE_OF_CONDUCT.md** (Contributor Covenant link).

## [0.1.0] - 2026-05-09

### Added

- CLI `wa-export` with subcommands: `all`, `config`, `events`, `retry-events`, `registrations`, `contacts`, `invoices`, `payments`, `donations`, `audit-log`, `files`.
- Library API: programmatic exports with typed options and results (`exportContacts`, `exportEvents`, `exportAll`, etc.).
- TypeScript sources compiled to `dist/` with declaration maps.
- Runtime validation with Zod at OAuth token fetch and permissive checks on API payloads.
- Injectable `Logger`, optional `onProgress` callback, and `AbortSignal` support on exporters.
- Global CLI flags: `--api-key`, `--account-id`, `-o/--out-dir`, `-q/--quiet`, `--verbose`, `--no-color`.
- Environment-variable fallbacks aligned with the pre-CLI scripts (`WA_EVENT_REQUEST_DELAY_MS`, `INVOICES_*`, etc.).
