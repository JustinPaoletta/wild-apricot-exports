# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Changed

- Publish workflow (`publish.yml`) now creates a **GitHub Release** with GitHub-generated release notes after each successful `npm publish` (skipped if the release already exists).

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
