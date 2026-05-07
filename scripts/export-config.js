// export-config.js
// Exports configuration / metadata: membership levels, contact field definitions,
// picklists, saved searches, tenders, account settings.
// Useful for documenting the site's setup before a migration.

const path = require("path");
const {
  API_BASE,
  apiGet,
  ensureDir,
  writeJson,
  getAuthAndAccount,
} = require("../lib/wa-api");

const OUT_DIR = path.join(process.cwd(), "exports", "config");

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

async function main() {
  ensureDir(OUT_DIR);
  const { token, accountId } = await getAuthAndAccount();

  for (const endpoint of ENDPOINTS) {
    const url = `${API_BASE}/accounts/${accountId}${endpoint.path}`;
    process.stdout.write(`Fetching ${endpoint.name} (${url})... `);
    try {
      const data = await apiGet(url, token);
      const filePath = path.join(OUT_DIR, `${endpoint.name}.json`);
      writeJson(data, filePath);
      const count = Array.isArray(data) ? data.length : data && data.Items ? data.Items.length : "ok";
      console.log(`saved (${count})`);
    } catch (err) {
      console.log(`failed: ${err.message.split("\n")[0]}`);
    }
  }

  console.log("");
  console.log(`Config files saved to: ${OUT_DIR}`);
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
