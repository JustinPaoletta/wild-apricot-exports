// lib/exporters/files.js
// Recursively downloads all files from Wild Apricot via WebDAV.
// - Skips files already downloaded (resume-friendly via _manifest.json)
// - Retries failed downloads with exponential backoff
// - Serial downloads to avoid overwhelming the server
// - Logs a manifest of every file attempted
//
// Wild Apricot's WebDAV server requires HTTP Digest auth — Basic auth returns 500.

const fs = require("fs");
const path = require("path");
const { createClient, AuthType } = require("webdav");

const DEFAULT_INTER_FILE_DELAY_MS = 500;
const DEFAULT_MAX_RETRIES = 4;
const DEFAULT_RETRY_BASE_MS = 2000;

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function loadManifest(manifestPath) {
  if (fs.existsSync(manifestPath)) {
    try {
      return JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    } catch {
      return {};
    }
  }
  return {};
}

function saveManifest(manifest, manifestPath) {
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), "utf8");
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

async function downloadWithRetry(client, remotePath, localPath, maxRetries, retryBaseMs, attempt = 1) {
  try {
    const buffer = await client.getFileContents(remotePath, { format: "binary" });
    fs.writeFileSync(localPath, Buffer.from(buffer));
    return { status: "ok" };
  } catch (err) {
    if (attempt >= maxRetries) {
      return { status: "error", message: err.message };
    }
    const delay = retryBaseMs * Math.pow(2, attempt - 1);
    console.warn(
      `  [RETRY ${attempt}/${maxRetries - 1}] ${path.basename(remotePath)} — ${err.message} — waiting ${delay}ms`
    );
    await sleep(delay);
    return downloadWithRetry(client, remotePath, localPath, maxRetries, retryBaseMs, attempt + 1);
  }
}

async function crawlAndDownload(client, remotePath, localBase, manifest, manifestPath, stats, settings) {
  const items = await listDir(client, remotePath);

  for (const item of items) {
    const itemRemotePath = item.filename;
    const relativePath = itemRemotePath.replace(/^\//, "");
    const localPath = path.join(localBase, relativePath);

    if (item.type === "directory") {
      ensureDir(localPath);
      await crawlAndDownload(client, itemRemotePath, localBase, manifest, manifestPath, stats, settings);
    } else {
      stats.total++;

      if (manifest[itemRemotePath] === "ok" && fs.existsSync(localPath)) {
        console.log(`  [SKIP] ${itemRemotePath}`);
        stats.skipped++;
        continue;
      }

      ensureDir(path.dirname(localPath));
      console.log(`  [DOWN] ${itemRemotePath}`);

      const result = await downloadWithRetry(
        client,
        itemRemotePath,
        localPath,
        settings.maxRetries,
        settings.retryBaseMs
      );
      manifest[itemRemotePath] = result.status === "ok" ? "ok" : `error: ${result.message}`;
      saveManifest(manifest, manifestPath);

      if (result.status === "ok") {
        stats.downloaded++;
      } else {
        console.error(`  [FAIL] ${itemRemotePath}: ${result.message}`);
        stats.failed++;
      }

      await sleep(settings.interFileDelayMs);
    }
  }
}

async function exportFiles(opts = {}) {
  const webdavUrl = opts.webdavUrl;
  const adminEmail = opts.adminEmail;
  const adminPassword = opts.adminPassword;

  if (!webdavUrl || !adminEmail || !adminPassword) {
    throw new Error(
      "Missing required opts for exportFiles: webdavUrl, adminEmail, adminPassword."
    );
  }

  const outDir = path.join(opts.outDir || "./exports", "files");
  const manifestPath = path.join(outDir, "_manifest.json");

  const settings = {
    interFileDelayMs:
      typeof opts.interFileDelayMs === "number"
        ? opts.interFileDelayMs
        : DEFAULT_INTER_FILE_DELAY_MS,
    maxRetries:
      typeof opts.maxRetries === "number" ? opts.maxRetries : DEFAULT_MAX_RETRIES,
    retryBaseMs:
      typeof opts.retryBaseMs === "number" ? opts.retryBaseMs : DEFAULT_RETRY_BASE_MS,
  };

  ensureDir(outDir);
  const manifest = loadManifest(manifestPath);

  const client = createClient(webdavUrl, {
    username: adminEmail,
    password: adminPassword,
    authType: AuthType.Digest,
  });

  console.log(`WebDAV URL: ${webdavUrl}`);
  console.log(`Output dir: ${outDir}`);

  const stats = { total: 0, downloaded: 0, skipped: 0, failed: 0 };

  const fileDirs = Array.isArray(opts.fileDirs)
    ? opts.fileDirs.map((d) => String(d).trim()).filter(Boolean)
    : [];

  if (fileDirs.length) {
    console.log(`Crawling specified dirs: ${fileDirs.join(", ")}`);
    for (const dir of fileDirs) {
      const remotePath = `/${dir.replace(/^\/+/, "")}`;
      ensureDir(path.join(outDir, dir.replace(/^\/+/, "")));
      console.log(`\nCrawling: ${remotePath}`);
      await crawlAndDownload(client, remotePath, outDir, manifest, manifestPath, stats, settings);
    }
  } else {
    console.log("\nCrawling: / (root, recursive — everything)");
    await crawlAndDownload(client, "/", outDir, manifest, manifestPath, stats, settings);
  }

  console.log("\n--- Done ---");
  console.log(`Total files found : ${stats.total}`);
  console.log(`Downloaded        : ${stats.downloaded}`);
  console.log(`Skipped (cached)  : ${stats.skipped}`);
  console.log(`Failed            : ${stats.failed}`);
  console.log(`Manifest          : ${manifestPath}`);

  if (stats.failed > 0) {
    console.log("\nFailed files are logged in the manifest. Re-run to retry them.");
    const err = new Error(`${stats.failed} file download(s) failed`);
    err.code = "FILE_DOWNLOAD_FAILURES";
    err.stats = stats;
    err.manifestPath = manifestPath;
    throw err;
  }

  return {
    outDir,
    manifestPath,
    stats,
  };
}

module.exports = { exportFiles };
