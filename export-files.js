// export-files.js
// Recursively downloads all files from Wild Apricot via WebDAV.
// - Skips files already downloaded (resume-friendly)
// - Retries failed downloads with exponential backoff
// - Serial downloads to avoid overwhelming the server
// - Logs a manifest of every file attempted

require("dotenv").config();

const fs = require("fs");
const path = require("path");
const { createClient, AuthType } = require("webdav");

const WEBDAV_URL = process.env.WILD_APRICOT_WEBDAV_URL;
const USERNAME = process.env.WILD_APRICOT_ADMIN_EMAIL;
const PASSWORD = process.env.WILD_APRICOT_ADMIN_PASSWORD;

// Comma-separated list of top-level dirs to crawl, or blank = crawl everything
const TOP_DIRS_ENV = process.env.WILD_APRICOT_TOP_DIRS || "";

const OUT_DIR = path.join(process.cwd(), "exports", "files");
const MANIFEST_PATH = path.join(OUT_DIR, "_manifest.json");

// Delay between each file download (ms) — keeps the server happy
const INTER_FILE_DELAY_MS = 500;
// Max retries per file
const MAX_RETRIES = 4;
// Base delay for exponential backoff (ms)
const RETRY_BASE_MS = 2000;

if (!WEBDAV_URL || !USERNAME || !PASSWORD) {
  console.error(
    "Missing WILD_APRICOT_WEBDAV_URL, WILD_APRICOT_ADMIN_EMAIL, or WILD_APRICOT_ADMIN_PASSWORD in .env"
  );
  process.exit(1);
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function loadManifest() {
  if (fs.existsSync(MANIFEST_PATH)) {
    try {
      return JSON.parse(fs.readFileSync(MANIFEST_PATH, "utf8"));
    } catch {
      return {};
    }
  }
  return {};
}

function saveManifest(manifest) {
  fs.writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 2), "utf8");
}

async function listDir(client, remotePath) {
  try {
    const contents = await client.getDirectoryContents(remotePath);
    return Array.isArray(contents) ? contents : (contents.data || []);
  } catch (err) {
    console.warn(`  [WARN] Could not list ${remotePath}: ${err.message}`);
    return [];
  }
}

async function downloadWithRetry(client, remotePath, localPath, attempt = 1) {
  try {
    const buffer = await client.getFileContents(remotePath, { format: "binary" });
    fs.writeFileSync(localPath, Buffer.from(buffer));
    return { status: "ok" };
  } catch (err) {
    if (attempt >= MAX_RETRIES) {
      return { status: "error", message: err.message };
    }
    const delay = RETRY_BASE_MS * Math.pow(2, attempt - 1);
    console.warn(
      `  [RETRY ${attempt}/${MAX_RETRIES - 1}] ${path.basename(remotePath)} — ${err.message} — waiting ${delay}ms`
    );
    await sleep(delay);
    return downloadWithRetry(client, remotePath, localPath, attempt + 1);
  }
}

async function crawlAndDownload(client, remotePath, localBase, manifest, stats) {
  const items = await listDir(client, remotePath);

  for (const item of items) {
    const itemRemotePath = item.filename;
    const relativePath = itemRemotePath.replace(/^\//, "");
    const localPath = path.join(localBase, relativePath);

    if (item.type === "directory") {
      ensureDir(localPath);
      await crawlAndDownload(client, itemRemotePath, localBase, manifest, stats);
    } else {
      stats.total++;

      if (manifest[itemRemotePath] === "ok" && fs.existsSync(localPath)) {
        console.log(`  [SKIP] ${itemRemotePath}`);
        stats.skipped++;
        continue;
      }

      ensureDir(path.dirname(localPath));
      console.log(`  [DOWN] ${itemRemotePath}`);

      const result = await downloadWithRetry(client, itemRemotePath, localPath);
      manifest[itemRemotePath] = result.status === "ok" ? "ok" : `error: ${result.message}`;
      saveManifest(manifest);

      if (result.status === "ok") {
        stats.downloaded++;
      } else {
        console.error(`  [FAIL] ${itemRemotePath}: ${result.message}`);
        stats.failed++;
      }

      await sleep(INTER_FILE_DELAY_MS);
    }
  }
}

async function main() {
  ensureDir(OUT_DIR);
  const manifest = loadManifest();

  // Wild Apricot's WebDAV server requires HTTP Digest auth — Basic auth returns 500.
  const client = createClient(WEBDAV_URL, {
    username: USERNAME,
    password: PASSWORD,
    authType: AuthType.Digest,
  });

  console.log(`WebDAV URL: ${WEBDAV_URL}`);
  console.log(`Output dir: ${OUT_DIR}`);

  // Determine which top-level directories to crawl
  let topDirs;
  if (TOP_DIRS_ENV.trim()) {
    topDirs = TOP_DIRS_ENV.split(",").map((d) => d.trim()).filter(Boolean);
    console.log(`Crawling specified dirs: ${topDirs.join(", ")}`);
  } else {
    console.log("Discovering top-level directories...");
    const root = await listDir(client, "/");
    topDirs = root
      .filter((item) => item.type === "directory")
      .map((item) => item.basename);
    console.log(`Found dirs: ${topDirs.join(", ")}`);
  }

  const stats = { total: 0, downloaded: 0, skipped: 0, failed: 0 };

  for (const dir of topDirs) {
    const remotePath = `/${dir}`;
    const localPath = path.join(OUT_DIR, dir);
    ensureDir(localPath);
    console.log(`\nCrawling: ${remotePath}`);
    await crawlAndDownload(client, remotePath, OUT_DIR, manifest, stats);
  }

  console.log("\n--- Done ---");
  console.log(`Total files found : ${stats.total}`);
  console.log(`Downloaded        : ${stats.downloaded}`);
  console.log(`Skipped (cached)  : ${stats.skipped}`);
  console.log(`Failed            : ${stats.failed}`);
  console.log(`Manifest          : ${MANIFEST_PATH}`);

  if (stats.failed > 0) {
    console.log("\nFailed files are logged in the manifest. Re-run the script to retry them.");
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
