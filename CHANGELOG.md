# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

## [0.1.0] - 2026-05-09

### Added

- CLI `wa-export` with subcommands: `all`, `config`, `events`, `retry-events`, `registrations`, `contacts`, `invoices`, `payments`, `donations`, `audit-log`, `files`.
- Library API: programmatic exports with typed options and results (`exportContacts`, `exportEvents`, `exportAll`, etc.).
- TypeScript sources compiled to `dist/` with declaration maps.
- Runtime validation with Zod at OAuth token fetch and permissive checks on API payloads.
- Injectable `Logger`, optional `onProgress` callback, and `AbortSignal` support on exporters.
- Global CLI flags: `--api-key`, `--account-id`, `-o/--out-dir`, `-q/--quiet`, `--verbose`, `--no-color`.
- Environment-variable fallbacks aligned with the pre-CLI scripts (`WA_EVENT_REQUEST_DELAY_MS`, `INVOICES_*`, etc.).
