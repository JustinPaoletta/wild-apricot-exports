#!/usr/bin/env node
// scripts/export-files.js — thin CLI shim over lib/exporters/files.js

require("dotenv").config();

const path = require("path");
const { exportFiles } = require("../lib/exporters/files");

function parseFileDirsEnv(value) {
  if (!value || !value.trim()) return [];
  return value
    .split(",")
    .map((d) => d.trim())
    .filter(Boolean);
}

async function main() {
  await exportFiles({
    webdavUrl: process.env.WILD_APRICOT_WEBDAV_URL,
    adminEmail: process.env.WILD_APRICOT_ADMIN_EMAIL,
    adminPassword: process.env.WILD_APRICOT_ADMIN_PASSWORD,
    outDir: path.join(process.cwd(), "exports"),
    fileDirs: parseFileDirsEnv(process.env.WILD_APRICOT_FILE_DIRS),
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
