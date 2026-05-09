// src/exporters/config.ts
// Exports configuration / metadata: membership levels, contact field
// definitions, picklists, saved searches, tenders, account settings.

import * as path from "node:path";

import {
  API_BASE,
  apiGet,
  ensureDir,
  writeJson,
  getAuthAndAccount,
} from "../wa-api";
import { ExportOptionsSchema } from "../schemas";
import { resolveLogger } from "../logger";
import type {
  ConfigExportOptions,
  ConfigExportResult,
} from "../types";

const ENDPOINTS: Array<{ name: string; path: string }> = [
  { name: "account", path: "" },
  { name: "membership-levels", path: "/membershiplevels" },
  { name: "contact-fields", path: "/contactfields" },
  { name: "saved-searches", path: "/savedsearches" },
  { name: "tenders", path: "/tenders" },
  { name: "picklists", path: "/picklists" },
  { name: "campaigns", path: "/campaigns" },
  { name: "funds", path: "/funds" },
];

export async function exportConfig(
  opts: ConfigExportOptions
): Promise<ConfigExportResult> {
  ExportOptionsSchema.parse(opts);
  const logger = resolveLogger(opts.logger);

  const outDir = path.join(opts.outDir || "./exports", "config");
  ensureDir(outDir);

  const { tokenManager, accountId } = await getAuthAndAccount({
    apiKey: opts.apiKey,
    accountId: opts.accountId,
    signal: opts.signal,
    logger: opts.logger,
  });

  const written: ConfigExportResult["written"] = [];
  const failed: ConfigExportResult["failed"] = [];

  for (const endpoint of ENDPOINTS) {
    const url = `${API_BASE}/accounts/${accountId}${endpoint.path}`;
    logger.progress?.(`Fetching ${endpoint.name} (${url})... `);
    try {
      const data = await apiGet(url, tokenManager, {
        signal: opts.signal,
        logger: opts.logger,
      });
      const filePath = path.join(outDir, `${endpoint.name}.json`);
      writeJson(data, filePath);
      const count = Array.isArray(data)
        ? data.length
        : data && typeof data === "object" && "Items" in data && Array.isArray((data as { Items: unknown }).Items)
        ? ((data as { Items: unknown[] }).Items.length as number)
        : "ok";
      logger.info(`saved (${count})`);
      written.push({ name: endpoint.name, path: filePath });
    } catch (err) {
      const msg =
        err instanceof Error
          ? err.message.split("\n")[0] || err.message
          : String(err);
      logger.info(`failed: ${msg}`);
      failed.push({ name: endpoint.name, error: msg });
    }
  }

  logger.info("");
  logger.info(`Config files saved to: ${outDir}`);

  return { outDir, written, failed };
}
