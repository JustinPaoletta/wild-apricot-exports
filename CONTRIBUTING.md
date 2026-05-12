# Contributing

Thank you for helping improve `wild-apricot-exports`. This project is intentionally small: **open an issue first** for sizable features or behavioral changes so we can agree on scope before you invest in a PR.

## Code of conduct

This project adopts the [Contributor Covenant](https://www.contributor-covenant.org/version/2/1/code_of_conduct/) as our code of conduct. By participating, you agree to uphold it. Concerns may be raised via [GitHub issues](https://github.com/JustinPaoletta/wild-apricot-exports/issues) or by contacting the maintainers privately.

## Local development

Requirements: **Node.js 20+** (Node 22+ recommended), npm.

```bash
git clone https://github.com/JustinPaoletta/wild-apricot-exports.git
cd wild-apricot-exports
npm ci
npm run lint
npm run typecheck
npm run build
npm test
node bin/wa-export.js --help
```

During active work:

```bash
npm run build:watch
```

Avoid committing secrets: keep `.env` out of git (it's gitignored). Never commit Wild Apricot exports or backups that contain member PII.

## Testing against a real Wild Apricot account

Prefer a **sandbox or test account** where possible. If you only have production access, throttle exports (`WA_EVENT_REQUEST_DELAY_MS`, small date windows) and remember output contains **PII**. Do not paste API keys or export files into GitHub issues or PR descriptions.

There are **no** automated integration tests against the live API (too flaky). Contributions should use **Vitest** with mocked `fetch` unless you clearly scope a reproducible harness.

## Pull requests

- One logical change per PR when feasible.
- Prefer **clear commit messages**; Conventional Commit-style prefixes (`feat:`, `fix:`, `docs:`) are welcome but not enforced.
- **Do not force-push** after review has started unless a maintainer asks you to squash/rebase.
- CI must stay green (`lint`, `typecheck`, `build`, `test`).

## Releasing & npm Trusted Publishing

Publishing is triggered by pushing a **git tag** `v*` which runs [.github/workflows/publish.yml](.github/workflows/publish.yml). Uses **Trusted Publishing** (OIDC) — no long-lived npm token in GitHub Secrets.

Configure once on npm: package **Settings → Publishing access → Trusted publishers → GitHub Actions**, with workflow file name **`publish.yml`** and this repository. See [npm Trusted publishing](https://docs.npmjs.com/trusted-publishers).

Your `package.json` **`repository.url`** must match this GitHub repository exactly or npm OIDC publishes may fail.

After `v0.x.y` is on npm, follow [POST_PUBLISH_CHECKLIST.md](POST_PUBLISH_CHECKLIST.md). A quick check: `npm install -g wild-apricot-exports@0.x.y` and `wa-export --version`.
