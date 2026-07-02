import * as fs from "node:fs";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const getDirectoryContents = vi.fn();
const getFileContents = vi.fn();

vi.mock("webdav", () => ({
  AuthType: { Digest: "digest" },
  createClient: vi.fn(() => ({
    getDirectoryContents,
    getFileContents,
  })),
}));

import { exportFiles } from "../src/exporters/files";
import { makeTempDir, rmTempDir } from "./helpers/temp-dir";

describe("exportFiles", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTempDir();
    vi.clearAllMocks();
    getDirectoryContents.mockImplementation(async (remotePath: string) => {
      if (remotePath === "/Documents") {
        return [{ filename: "/Documents/readme.txt", type: "file" as const }];
      }
      if (remotePath === "/") {
        return [
          { filename: "/nested", type: "directory" as const },
          { filename: "/root.txt", type: "file" as const },
        ];
      }
      if (remotePath === "/nested") {
        return [{ filename: "/nested/inner.txt", type: "file" as const }];
      }
      if (remotePath === "/missing") {
        throw new Error("list failed");
      }
      return [];
    });
    getFileContents.mockResolvedValue(Buffer.from("hello files"));
  });

  afterEach(() => {
    rmTempDir(tmpDir);
  });

  it("downloads files under specified WebDAV directories", async () => {
    const result = await exportFiles({
      webdavUrl: "https://org.wildapricot.org",
      adminEmail: "admin@example.com",
      adminPassword: "secret",
      outDir: tmpDir,
      fileDirs: ["Documents"],
      interFileDelayMs: 0,
    });

    expect(result.stats.downloaded).toBe(1);
    expect(fs.existsSync(path.join(result.outDir, "Documents/readme.txt"))).toBe(true);
  });

  it("skips files already marked ok in the manifest", async () => {
    const filesDir = path.join(tmpDir, "files");
    fs.mkdirSync(path.join(filesDir, "Documents"), { recursive: true });
    fs.writeFileSync(path.join(filesDir, "Documents/readme.txt"), "cached", "utf8");
    fs.writeFileSync(
      path.join(filesDir, "_manifest.json"),
      JSON.stringify({ "/Documents/readme.txt": "ok" }),
      "utf8"
    );

    const result = await exportFiles({
      webdavUrl: "https://org.wildapricot.org",
      adminEmail: "admin@example.com",
      adminPassword: "secret",
      outDir: tmpDir,
      fileDirs: ["Documents"],
      interFileDelayMs: 0,
    });

    expect(result.stats.skipped).toBe(1);
    expect(getFileContents).not.toHaveBeenCalled();
  });

  it("crawls root recursively when fileDirs is omitted", async () => {
    const result = await exportFiles({
      webdavUrl: "https://org.wildapricot.org",
      adminEmail: "admin@example.com",
      adminPassword: "secret",
      outDir: tmpDir,
      interFileDelayMs: 0,
    });

    expect(result.stats.downloaded).toBe(2);
    expect(fs.existsSync(path.join(result.outDir, "root.txt"))).toBe(true);
    expect(fs.existsSync(path.join(result.outDir, "nested/inner.txt"))).toBe(true);
  });

  it("retries failed downloads then succeeds", async () => {
    let attempts = 0;
    getFileContents.mockImplementation(async () => {
      attempts++;
      if (attempts < 2) throw new Error("transient");
      return Buffer.from("recovered");
    });

    const result = await exportFiles({
      webdavUrl: "https://org.wildapricot.org",
      adminEmail: "admin@example.com",
      adminPassword: "secret",
      outDir: tmpDir,
      fileDirs: ["Documents"],
      interFileDelayMs: 0,
      maxRetries: 3,
      retryBaseMs: 0,
    });

    expect(result.stats.downloaded).toBe(1);
    expect(attempts).toBe(2);
  });

  it("throws when downloads remain failed after retries", async () => {
    getFileContents.mockRejectedValue(new Error("permanent"));

    await expect(
      exportFiles({
        webdavUrl: "https://org.wildapricot.org",
        adminEmail: "admin@example.com",
        adminPassword: "secret",
        outDir: tmpDir,
        fileDirs: ["Documents"],
        interFileDelayMs: 0,
        maxRetries: 1,
        retryBaseMs: 0,
      })
    ).rejects.toMatchObject({ code: "FILE_DOWNLOAD_FAILURES" });
  });

  it("tolerates unreadable manifest and list failures", async () => {
    const filesDir = path.join(tmpDir, "files");
    fs.mkdirSync(filesDir, { recursive: true });
    fs.writeFileSync(path.join(filesDir, "_manifest.json"), "{not json", "utf8");

    getDirectoryContents.mockImplementation(async (remotePath: string) => {
      if (remotePath === "/missing") return [];
      throw new Error("list failed");
    });

    const result = await exportFiles({
      webdavUrl: "https://org.wildapricot.org",
      adminEmail: "admin@example.com",
      adminPassword: "secret",
      outDir: tmpDir,
      fileDirs: ["missing"],
      interFileDelayMs: 0,
    });

    expect(result.stats.total).toBe(0);
  });

  it("accepts WebDAV listings wrapped in a data property", async () => {
    getDirectoryContents.mockImplementation(async (remotePath: string) => {
      if (remotePath === "/Docs") {
        return { data: [{ filename: "/Docs/wrapped.txt", type: "file" as const }] };
      }
      return [];
    });

    const result = await exportFiles({
      webdavUrl: "https://org.wildapricot.org",
      adminEmail: "admin@example.com",
      adminPassword: "secret",
      outDir: tmpDir,
      fileDirs: ["Docs"],
      interFileDelayMs: 0,
    });

    expect(result.stats.downloaded).toBe(1);
  });

  it("aborts when signal is triggered during inter-file delay", async () => {
    getDirectoryContents.mockImplementation(async (remotePath: string) => {
      if (remotePath === "/Docs") {
        return [
          { filename: "/Docs/a.txt", type: "file" as const },
          { filename: "/Docs/b.txt", type: "file" as const },
        ];
      }
      return [];
    });

    const ac = new AbortController();
    const p = exportFiles({
      webdavUrl: "https://org.wildapricot.org",
      adminEmail: "admin@example.com",
      adminPassword: "secret",
      outDir: tmpDir,
      fileDirs: ["Docs"],
      interFileDelayMs: 1000,
      signal: ac.signal,
    });
    ac.abort();
    await expect(p).rejects.toMatchObject({ name: "AbortError" });
  });

  it("uses default timing options when overrides are omitted", async () => {
    getDirectoryContents.mockImplementation(async (remotePath: string) => {
      if (remotePath === "/Docs") {
        return [{ filename: "/Docs/one.txt", type: "file" as const }];
      }
      return [];
    });

    const result = await exportFiles({
      webdavUrl: "https://org.wildapricot.org",
      adminEmail: "admin@example.com",
      adminPassword: "secret",
      outDir: tmpDir,
      fileDirs: ["Docs"],
    });

    expect(result.stats.downloaded).toBe(1);
  });

  it("warns and continues when directory listing throws a non-Error", async () => {
    getDirectoryContents.mockImplementation(async (remotePath: string) => {
      if (remotePath === "/Docs") throw "list exploded";
      return [];
    });

    const result = await exportFiles({
      webdavUrl: "https://org.wildapricot.org",
      adminEmail: "admin@example.com",
      adminPassword: "secret",
      outDir: tmpDir,
      fileDirs: ["Docs"],
      interFileDelayMs: 0,
    });

    expect(result.stats.total).toBe(0);
  });

  it("aborts during inter-file sleep after the first download", async () => {
    vi.useFakeTimers();
    getDirectoryContents.mockImplementation(async (remotePath: string) => {
      if (remotePath === "/Docs") {
        return [
          { filename: "/Docs/a.txt", type: "file" as const },
          { filename: "/Docs/b.txt", type: "file" as const },
        ];
      }
      return [];
    });

    const ac = new AbortController();
    const p = exportFiles({
      webdavUrl: "https://org.wildapricot.org",
      adminEmail: "admin@example.com",
      adminPassword: "secret",
      outDir: tmpDir,
      fileDirs: ["Docs"],
      interFileDelayMs: 5000,
      signal: ac.signal,
    });
    await vi.advanceTimersByTimeAsync(0);
    ac.abort();
    await expect(p).rejects.toMatchObject({ name: "AbortError" });
    vi.useRealTimers();
  });

  it("aborts during download retry backoff when already aborted", async () => {
    vi.useFakeTimers();
    getFileContents.mockRejectedValue(new Error("transient"));
    const ac = new AbortController();

    const p = exportFiles({
      webdavUrl: "https://org.wildapricot.org",
      adminEmail: "admin@example.com",
      adminPassword: "secret",
      outDir: tmpDir,
      fileDirs: ["Documents"],
      maxRetries: 3,
      retryBaseMs: 5000,
      signal: ac.signal,
    });
    await vi.advanceTimersByTimeAsync(0);
    ac.abort();
    await expect(p).rejects.toMatchObject({ name: "AbortError" });
    vi.useRealTimers();
  });
});
