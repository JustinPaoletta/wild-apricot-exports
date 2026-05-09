// src/exporters/retry-events.ts
// Re-fetch detail for events listed in <outDir>/events/_detail_failures.json,
// merge the successful ones back into wild-apricot-events.json/.csv, and
// rewrite _detail_failures.json with anything still failing.

import * as fs from "node:fs";
import * as path from "node:path";

import {
  API_BASE,
  apiGet,
  ensureDir,
  getNested,
  getAuthAndAccount,
  sleep,
  csvEscape,
} from "../wa-api";
import { RetryEventFailuresOptionsSchema } from "../schemas";
import { resolveLogger } from "../logger";
import type {
  RetryEventFailuresOptions,
  RetryEventFailuresResult,
} from "../types";

const DEFAULT_REQUEST_DELAY_MS = 2200;

interface FailureRecord {
  eventId: string | number;
  status?: number;
  error?: string;
}

function normalizeEvent(event: unknown): Record<string, unknown> {
  return {
    id: getNested(event, ["Id", "id", "EventId", "eventId"]),
    title: getNested(event, ["Name", "Title", "name", "title"]),
    startDate: getNested(event, [
      "StartDate",
      "StartDateTime",
      "startDate",
      "startDateTime",
    ]),
    endDate: getNested(event, [
      "EndDate",
      "EndDateTime",
      "endDate",
      "endDateTime",
    ]),
    location: getNested(event, [
      "Location",
      "LocationName",
      "location",
      "locationName",
    ]),
    registrationEnabled: getNested(event, [
      "RegistrationEnabled",
      "registrationEnabled",
    ]),
    registrationLimit: getNested(event, [
      "RegistrationLimit",
      "registrationLimit",
    ]),
    registeredCount: getNested(event, [
      "RegisteredCount",
      "RegistrantsCount",
      "registeredCount",
      "registrantsCount",
    ]),
    publicUrl: getNested(event, ["Url", "PublicUrl", "url", "publicUrl"]),
    detailsUrl: getNested(event, ["DetailsUrl", "detailsUrl"]),
  };
}

function writeEventsCsv(events: unknown[], filePath: string): void {
  const columns = [
    "id",
    "title",
    "startDate",
    "endDate",
    "location",
    "registrationEnabled",
    "registrationLimit",
    "registeredCount",
    "publicUrl",
    "detailsUrl",
  ];
  const normalized = events.map(normalizeEvent);
  const rows = [
    columns.join(","),
    ...normalized.map((event) =>
      columns.map((c) => csvEscape(event[c])).join(",")
    ),
  ];
  fs.writeFileSync(filePath, rows.join("\n"), "utf8");
}

function getId(event: unknown): string | number | undefined {
  if (!event || typeof event !== "object") return undefined;
  const obj = event as Record<string, unknown>;
  return (
    (obj.Id as string | number | undefined) ??
    (obj.id as string | number | undefined) ??
    (obj.EventId as string | number | undefined) ??
    (obj.eventId as string | number | undefined)
  );
}

export async function retryEventFailures(
  opts: RetryEventFailuresOptions
): Promise<RetryEventFailuresResult> {
  RetryEventFailuresOptionsSchema.parse(opts);
  const logger = resolveLogger(opts.logger);

  const outDir = path.join(opts.outDir || "./exports", "events");
  const eventsJsonPath = path.join(outDir, "wild-apricot-events.json");
  const eventsCsvPath = path.join(outDir, "wild-apricot-events.csv");
  const failuresPath = path.join(outDir, "_detail_failures.json");
  const requestDelayMs =
    typeof opts.requestDelayMs === "number"
      ? opts.requestDelayMs
      : DEFAULT_REQUEST_DELAY_MS;

  ensureDir(outDir);

  if (!fs.existsSync(failuresPath)) {
    logger.info(`No failures file at ${failuresPath} — nothing to retry.`);
    return {
      outDir,
      jsonPath: eventsJsonPath,
      csvPath: eventsCsvPath,
      attempted: 0,
      recovered: 0,
      stillFailingCount: 0,
    };
  }
  if (!fs.existsSync(eventsJsonPath)) {
    throw new Error(
      `Cannot find ${eventsJsonPath}. Run the events exporter first.`
    );
  }

  const failures = JSON.parse(
    fs.readFileSync(failuresPath, "utf8")
  ) as FailureRecord[];
  if (!failures.length) {
    logger.info("Failures file is empty — nothing to retry.");
    return {
      outDir,
      jsonPath: eventsJsonPath,
      csvPath: eventsCsvPath,
      attempted: 0,
      recovered: 0,
      stillFailingCount: 0,
    };
  }

  const { tokenManager, accountId } = await getAuthAndAccount({
    apiKey: opts.apiKey,
    accountId: opts.accountId,
    signal: opts.signal,
    logger: opts.logger,
  });
  const events = JSON.parse(
    fs.readFileSync(eventsJsonPath, "utf8")
  ) as unknown[];
  const eventsById = new Map<string, unknown>(
    events.map((e) => [String(getId(e)), e])
  );

  logger.info(
    `Retrying ${failures.length} previously-failed event(s) (${requestDelayMs}ms between requests)...`
  );

  const stillFailing: FailureRecord[] = [];
  let recovered = 0;

  for (let i = 0; i < failures.length; i++) {
    const f = failures[i]!;
    const id = f.eventId;
    logger.progress?.(`[${i + 1}/${failures.length}] Event ${id}... `);

    try {
      const detail = await apiGet(
        `${API_BASE}/accounts/${accountId}/events/${id}`,
        tokenManager,
        { signal: opts.signal, logger: opts.logger }
      );
      eventsById.set(String(id), detail);
      recovered++;
      logger.info("ok");
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") throw err;
      const msg =
        err instanceof Error ? err.message.split("\n")[0] : String(err);
      const status = (err as { status?: number }).status;
      stillFailing.push({ eventId: id, status, error: msg });
      logger.info(`FAILED (${status ?? "?"}): ${msg}`);
    }

    if (i < failures.length - 1) await sleep(requestDelayMs, opts.signal);
  }

  // Rebuild events array preserving the original ordering.
  const merged = events.map((e) => eventsById.get(String(getId(e))) || e);

  fs.writeFileSync(
    eventsJsonPath,
    JSON.stringify(merged, null, 2),
    "utf8"
  );
  writeEventsCsv(merged, eventsCsvPath);

  if (stillFailing.length) {
    fs.writeFileSync(
      failuresPath,
      JSON.stringify(stillFailing, null, 2),
      "utf8"
    );
  } else {
    fs.unlinkSync(failuresPath);
  }

  logger.info("");
  logger.info("Done.");
  logger.info(`Recovered    : ${recovered}/${failures.length}`);
  logger.info(`Still failing: ${stillFailing.length}`);
  logger.info(`JSON: ${eventsJsonPath}`);
  logger.info(`CSV:  ${eventsCsvPath}`);
  if (stillFailing.length) {
    logger.info(`Remaining failures written to ${failuresPath}`);
  } else {
    logger.info(
      "All previous failures recovered — _detail_failures.json removed."
    );
  }

  return {
    outDir,
    jsonPath: eventsJsonPath,
    csvPath: eventsCsvPath,
    attempted: failures.length,
    recovered,
    stillFailingCount: stillFailing.length,
    failuresPath: stillFailing.length ? failuresPath : undefined,
  };
}
