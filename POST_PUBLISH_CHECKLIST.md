# After publish — quick verification checklist

Exercise the registry package (`@latest` or the version you shipped), not the repo checkout.

## Global CLI

- [ ] `npm install -g wild-apricot-exports@latest`
- [ ] `wa-export --help` prints
- [ ] From a disposable dir with `.env` (`WILD_APRICOT_API_KEY`, etc.): `wa-export config --out-dir ./exports` succeeds
- [ ] Same dir: `wa-export contacts --out-dir ./exports` succeeds
- [ ] `./exports/` layout matches README; no unexplained exporter errors

## Library (ESM smoke)

- [ ] `mkdir`/cd temp project → `npm init -y` → `npm install wild-apricot-exports@latest`
- [ ] `run.mjs` imports `exportContacts` (or another exporter) + `consoleLogger`, passes `apiKey` / `outDir`, runs once (see README snippet)
- [ ] Run completes and writes expected outputs

## Tarball sanity (optional)

- [ ] In repo after `npm run prepublishOnly` + `npm pack`: `tar -tzf wild-apricot-exports-*.tgz` shows **no** `.env`, **no** machine `exports/` tree

## npm page

- [ ] [npmjs.com/package/wild-apricot-exports](https://www.npmjs.com/package/wild-apricot-exports) — version matches tag, readme/bin look right
