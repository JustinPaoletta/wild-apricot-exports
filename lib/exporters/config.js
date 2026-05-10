// lib/exporters/config.js
// Exports configuration / metadata: membership levels, contact field definitions,
// picklists, saved searches, tenders, account settings.
//
// Pure async function. CLI shim handles .env loading and process.exit.

const path = require("path");
const {
  API_BASE,
  apiGet,
  ensureDir,
  writeJson,
  getAuthAndAccount,
} = require("../wa-api");

const ENDPOINTS = [
  { name: "account", path: "" },
  { name: "membership-levels", path: "/membershiplevels" },
  { name: "contact-fields", path: "/contactfields" },
  { name: "saved-searches", path: "/savedsearches" },
  { name: "tenders", path: "/tenders" },
  { name: "picklists", path: "/picklists" },
  { name: "campaigns", path: "/campaigns" },
  { name: "funds", path: "/funds" },
];

async function exportConfig(opts = {}) {
  const outDir = path.join(opts.outDir || "./exports", "config");
  ensureDir(outDir);

  const { tokenManager, accountId } = await getAuthAndAccount({
    apiKey: opts.apiKey,
    accountId: opts.accountId,
  });

  const written = [];
  const failed = [];

  for (const endpoint of ENDPOINTS) {
    const url = `${API_BASE}/accounts/${accountId}${endpoint.path}`;
    process.stdout.write(`Fetching ${endpoint.name} (${url})... `);
    try {
      const data = await apiGet(url, tokenManager);
      const filePath = path.join(outDir, `${endpoint.name}.json`);
      writeJson(data, filePath);
      const count = Array.isArray(data)
        ? data.length
        : data && data.Items
        ? data.Items.length
        : "ok";
      console.log(`saved (${count})`);
      written.push({ name: endpoint.name, path: filePath });
    } catch (err) {
      const msg = err && err.message ? err.message.split("\n")[0] : String(err);
      console.log(`failed: ${msg}`);
      failed.push({ name: endpoint.name, error: msg });
    }
  }

  console.log("");
  console.log(`Config files saved to: ${outDir}`);

  return { outDir, written, failed };
}

module.exports = { exportConfig };
