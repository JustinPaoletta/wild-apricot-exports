// src/exporters/files.ts
// Recursively downloads all files from Wild Apricot via WebDAV.
// - Skips files already downloaded (resume-friendly via _manifest.json)
// - Retries failed downloads with exponential backoff
// - Serial downloads to avoid overwhelming the server
// - Logs a manifest of every file attempted
//
// Wild Apricot's WebDAV server requires HTTP Digest auth — Basic auth returns 500.

import * as fs from "node:fs";
import * as path from "node:path";
import { createClient, AuthType, type WebDAVClient } from "webdav";

import { FilesExportOptionsSchema } from "../schemas";
import { resolveLogger } from "../logger";
import type { FilesExportOptions, FilesExportResult, Logger } from "../types";

const DEFAULT_INTER_FILE_DELAY_MS = 500;
const DEFAULT_MAX_RETRIES = 4;
const DEFAULT_RETRY_BASE_MS = 2000;

interface Settings {
  interFileDelayMs: number;
  maxRetries: number;
  retryBaseMs: number;
  signal?: AbortSignal;
  logger: Logger;
}

interface Stats {
  total: number;
  downloaded: number;
  skipped: number;
  failed: number;
}

type Manifest = Record<string, string>;

function ensureDir(dir: string): void {
  fs.mkdirSync(dir, { recursive: true });
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      const err = new Error("The operation was aborted");
      err.name = "AbortError";
      reject(err);
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      const err = new Error("The operation was aborted");
      err.name = "AbortError";
      reject(err);
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

function loadManifest(manifestPath: string): Manifest {
  if (fs.existsSync(manifestPath)) {
    try {
      return JSON.parse(fs.readFileSync(manifestPath, "utf8")) as Manifest;
    } catch {
      return {};
    }
  }
  return {};
}

function saveManifest(manifest: Manifest, manifestPath: string): void {
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), "utf8");
}

interface WebDAVItem {
  filename: string;
  type: "file" | "directory";
}

async function listDir(
  client: WebDAVClient,
  remotePath: string,
  logger: Logger
): Promise<WebDAVItem[]> {
  try {
    const contents = (await client.getDirectoryContents(remotePath)) as
      | WebDAVItem[]
      | { data: WebDAVItem[] };
    return Array.isArray(contents) ? contents : contents.data || [];
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.warn(`  [WARN] Could not list ${remotePath}: ${msg}`);
    return [];
  }
}

async function downloadWithRetry(
  client: WebDAVClient,
  remotePath: string,
  localPath: string,
  settings: Settings,
  attempt = 1
): Promise<{ status: "ok" } | { status: "error"; message: string }> {
  try {
    const buffer = (await client.getFileContents(remotePath, {
      format: "binary",
    })) as ArrayBuffer | Buffer;
    fs.writeFileSync(localPath, Buffer.from(buffer as ArrayBuffer));
    return { status: "ok" };
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") throw err;
    const message = err instanceof Error ? err.message : String(err);
    if (attempt >= settings.maxRetries) {
      return { status: "error", message };
    }
    const delay = settings.retryBaseMs * Math.pow(2, attempt - 1);
    settings.logger.warn(
      `  [RETRY ${attempt}/${settings.maxRetries - 1}] ${path.basename(
        remotePath
      )} — ${message} — waiting ${delay}ms`
    );
    await sleep(delay, settings.signal);
    return downloadWithRetry(client, remotePath, localPath, settings, attempt + 1);
  }
}

async function crawlAndDownload(
  client: WebDAVClient,
  remotePath: string,
  localBase: string,
  manifest: Manifest,
  manifestPath: string,
  stats: Stats,
  settings: Settings
): Promise<void> {
  if (settings.signal?.aborted) {
    const err = new Error("The operation was aborted");
    err.name = "AbortError";
    throw err;
  }
  const items = await listDir(client, remotePath, settings.logger);

  for (const item of items) {
    const itemRemotePath = item.filename;
    const relativePath = itemRemotePath.replace(/^\//, "");
    const localPath = path.join(localBase, relativePath);

    if (item.type === "directory") {
      ensureDir(localPath);
      await crawlAndDownload(
        client,
        itemRemotePath,
        localBase,
        manifest,
        manifestPath,
        stats,
        settings
      );
    } else {
      stats.total++;

      if (manifest[itemRemotePath] === "ok" && fs.existsSync(localPath)) {
        settings.logger.info(`  [SKIP] ${itemRemotePath}`);
        stats.skipped++;
        continue;
      }

      ensureDir(path.dirname(localPath));
      settings.logger.info(`  [DOWN] ${itemRemotePath}`);

      const result = await downloadWithRetry(client, itemRemotePath, localPath, settings);
      manifest[itemRemotePath] = result.status === "ok" ? "ok" : `error: ${result.message}`;
      saveManifest(manifest, manifestPath);

      if (result.status === "ok") {
        stats.downloaded++;
      } else {
        settings.logger.error(`  [FAIL] ${itemRemotePath}: ${result.message}`);
        stats.failed++;
      }

      await sleep(settings.interFileDelayMs, settings.signal);
    }
  }
}

export async function exportFiles(opts: FilesExportOptions): Promise<FilesExportResult> {
  FilesExportOptionsSchema.parse(opts);
  const logger = resolveLogger(opts.logger);

  const outDir = path.join(opts.outDir || "./exports", "files");
  const manifestPath = path.join(outDir, "_manifest.json");

  const settings: Settings = {
    interFileDelayMs:
      typeof opts.interFileDelayMs === "number"
        ? opts.interFileDelayMs
        : DEFAULT_INTER_FILE_DELAY_MS,
    maxRetries: typeof opts.maxRetries === "number" ? opts.maxRetries : DEFAULT_MAX_RETRIES,
    retryBaseMs: typeof opts.retryBaseMs === "number" ? opts.retryBaseMs : DEFAULT_RETRY_BASE_MS,
    signal: opts.signal,
    logger,
  };

  ensureDir(outDir);
  const manifest = loadManifest(manifestPath);

  const client = createClient(opts.webdavUrl, {
    username: opts.adminEmail,
    password: opts.adminPassword,
    authType: AuthType.Digest,
  });

  logger.info(`WebDAV URL: ${opts.webdavUrl}`);
  logger.info(`Output dir: ${outDir}`);

  const stats: Stats = { total: 0, downloaded: 0, skipped: 0, failed: 0 };

  const fileDirs = Array.isArray(opts.fileDirs)
    ? opts.fileDirs.map((d) => String(d).trim()).filter(Boolean)
    : [];

  if (fileDirs.length) {
    logger.info(`Crawling specified dirs: ${fileDirs.join(", ")}`);
    for (const dir of fileDirs) {
      const remotePath = `/${dir.replace(/^\/+/, "")}`;
      ensureDir(path.join(outDir, dir.replace(/^\/+/, "")));
      logger.info(`\nCrawling: ${remotePath}`);
      await crawlAndDownload(client, remotePath, outDir, manifest, manifestPath, stats, settings);
    }
  } else {
    logger.info("\nCrawling: / (root, recursive — everything)");
    await crawlAndDownload(client, "/", outDir, manifest, manifestPath, stats, settings);
  }

  logger.info("\n--- Done ---");
  logger.info(`Total files found : ${stats.total}`);
  logger.info(`Downloaded        : ${stats.downloaded}`);
  logger.info(`Skipped (cached)  : ${stats.skipped}`);
  logger.info(`Failed            : ${stats.failed}`);
  logger.info(`Manifest          : ${manifestPath}`);

  if (stats.failed > 0) {
    logger.info("\nFailed files are logged in the manifest. Re-run to retry them.");
    const err: Error & { code?: string; stats?: Stats; manifestPath?: string } = new Error(
      `${stats.failed} file download(s) failed`
    );
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
