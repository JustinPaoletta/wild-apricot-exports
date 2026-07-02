# v1.0.0 Release — Your Next Steps

This document lists what was completed in-repo and what you still need to do manually to ship **wild-apricot-exports v1.0.0**.

---

## What was done (ready to review)

### Testing (155 tests across 11 files)

| Area          | File(s)                                                                                                                           | Coverage focus                                                                                                                                   |
| ------------- | --------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| REST client   | `tests/wa-api.test.ts`                                                                                                            | OAuth token manager, `apiFetch` retries/429/401, pagination, async queries, CSV/JSON helpers                                                     |
| Schemas       | `tests/schemas.test.ts`                                                                                                           | Zod validation for export options and API payloads                                                                                               |
| Loggers       | `tests/logger.test.ts`                                                                                                            | `consoleLogger`, `silentLogger`, `resolveLogger`                                                                                                 |
| Exporters     | `tests/exporters.test.ts`, `tests/events.test.ts`, `tests/registrations.test.ts`, `tests/files.test.ts`, `tests/branches.test.ts` | Config, contacts, invoices, payments, donations, audit-log, events (incl. resume), registrations, files (incl. manifest skip), branch edge cases |
| Orchestration | `tests/all.test.ts`                                                                                                               | `exportAll` include/exclude, failure isolation, missing WebDAV creds                                                                             |
| CLI           | `tests/cli.test.ts`                                                                                                               | Help, version, flag propagation, credential validation                                                                                           |
| Helpers       | `tests/helpers/mock-fetch.ts`, `tests/helpers/temp-dir.ts`                                                                        | Shared `fetch` mocking and temp directories                                                                                                      |

Run locally:

```bash
npm run lint
npm run format:check
npm run typecheck
npm run build
npm test
npm run test:coverage
```

Current coverage (~98% lines, ~90% branches, ~97% functions — thresholds in `vitest.config.ts` enforce **90 / 90 / 90 / 90**):

- **Remaining gaps:** some CLI signal-handler paths, unreachable defensive branches in `events.ts` `extractItems`, and a few Wild Apricot API response-shape fallbacks.
- **`src/types.ts`** is excluded from coverage (types-only).

### Release cleanup

- Removed legacy CommonJS reference trees: `lib/`, `scripts/`
- Removed reserved no-op CLI flags: `--verbose`, `--no-color`
- Simplified redundant branch in `src/wa-api.ts` `apiFetch` error handling
- Updated `README.md`, `CHANGELOG.md`, `eslint.config.mjs`, CI workflow (coverage step)
- Bumped `package.json` version to **1.0.0** (not committed or tagged yet — see below)

---

## What you need to do

### 1. Review the diff

```bash
git status
git diff
```

Confirm you’re comfortable removing `lib/` and `scripts/` permanently and with the test/coverage scope for a 1.0.

### 2. Commit

Nothing has been committed yet. Suggested message:

```bash
git add -A
git commit -m "$(cat <<'EOF'
Release v1.0.0: add test suite and remove legacy code.

Add Vitest coverage for the REST client, exporters, CLI, and orchestrator;
delete the pre-TypeScript lib/scripts reference trees; drop reserved CLI flags;
and bump to 1.0.0.
EOF
)"
```

### 3. Tag and push

The **Publish** workflow triggers on tags `v*`:

```bash
git tag v1.0.0
git push origin main
git push origin v1.0.0
```

That should:

1. Run CI on the push to `main`
2. Run **Publish** on the tag → `npm publish` (OIDC trusted publishing) + GitHub Release

**Prerequisite:** npm trusted publisher must already be configured for `publish.yml` (see comment block in `.github/workflows/publish.yml`). If this is your first publish from this machine/account, verify on [npmjs.com](https://www.npmjs.com/package/wild-apricot-exports) → Settings → Trusted publishers.

### 4. Post-publish verification

Follow [POST_PUBLISH_CHECKLIST.md](POST_PUBLISH_CHECKLIST.md):

- [ ] `npm install -g wild-apricot-exports@1.0.0` (or `@latest`)
- [ ] `wa-export --help`
- [ ] Real export against a disposable `.env` (e.g. `wa-export config`, `wa-export contacts`)
- [ ] Library smoke test from a temp project (`import { exportContacts } from "wild-apricot-exports"`)
- [ ] npm package page shows **1.0.0** and README renders correctly
- [ ] GitHub Release exists for `v1.0.0`

### 5. Optional follow-ups (not blocking 1.0)

These were identified but intentionally left for later:

| Item                                                           | Why optional                                                                                                                 |
| -------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| **Live integration tests** against a real Wild Apricot sandbox | Requires your API key + account; keep out of CI secrets unless you want a scheduled workflow                                 |
| **More CLI subcommand tests**                                  | CLI is ~50% covered; happy-path routing is tested, not every subcommand action                                               |
| **`exportAll` end-to-end with mocked fetch**                   | Orchestration logic is tested with mocked exporters; full pipeline test would be redundant unless you refactor for injection |
| **`npm audit fix`**                                            | `npm install` reported vulnerabilities in dev dependencies; review before `--force`                                          |
| **Re-add `--verbose` / `--no-color`**                          | Only when they actually do something                                                                                         |

---

## Quick reference: release checklist

```
[ ] Review diff
[ ] npm run prepublishOnly   # lint + format + typecheck + build + test
[ ] git commit
[ ] git tag v1.0.0
[ ] git push origin main && git push origin v1.0.0
[ ] POST_PUBLISH_CHECKLIST.md
[ ] Announce / update any downstream docs
```

---

## If publish fails

| Symptom                           | Likely fix                                                                                                                    |
| --------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| OIDC / trusted publisher error    | Confirm npm package settings: repo `JustinPaoletta/wild-apricot-exports`, workflow `publish.yml`, Node ≥ 22.14 on publish job |
| Version already published         | Bump patch (`1.0.1`) or unpublish window (npm unpublish policy — avoid if possible)                                           |
| CI fails on coverage              | Run `npm run test:coverage` locally; thresholds in `vitest.config.ts`                                                         |
| GitHub Release missing but npm OK | `gh release create v1.0.0 --generate-notes --verify-tag`                                                                      |

---

_Generated after the v1.0.0 prep pass. Delete or archive this file once you’ve shipped._
