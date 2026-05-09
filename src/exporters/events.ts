// src/exporters/events.ts
// Exports Wild Apricot events to JSON and CSV with resumable per-event
// detail fetches and exponential backoff on failure.

import * as fs from "node:fs";
import * as path from "node:path";

import {
  API_BASE,
  apiGet,
  ensureDir,
  getNested,
  getAuthAndAccount,
  sleep,
} from "../wa-api";
import { EventsExportOptionsSchema, EventsResponseSchema } from "../schemas";
import { resolveLogger } from "../logger";
import type {
  EventsExportOptions,
  EventsExportResult,
  TokenManager,
  Logger,
} from "../types";

const DEFAULT_REQUEST_DELAY_MS = 2200;
const DEFAULT_SAVE_EVERY_N = 100;

function csvEscape(value: unknown): string {
  if (value === null || value === undefined) return "";
  const str = String(value);
  if (/[",\n\r]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
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
    raw: event,
  };
}

function extractItems(data: unknown): unknown[] {
  if (Array.isArray(data)) return data;
  if (data && typeof data === "object") {
    const obj = data as Record<string, unknown>;
    return (
      (obj.Events as unknown[]) ||
      (obj.events as unknown[]) ||
      (obj.Items as unknown[]) ||
      (obj.items as unknown[]) ||
      []
    );
  }
  return [];
}

function extractNextUrl(data: unknown): string | null {
  if (!data || typeof data !== "object") return null;
  const obj = data as Record<string, unknown>;
  return (
    (obj.NextUrl as string | undefined) ||
    (obj.nextUrl as string | undefined) ||
    (obj.NextLink as string | undefined) ||
    (obj.nextLink as string | undefined) ||
    (obj["@odata.nextLink"] as string | undefined) ||
    null
  );
}

async function getAllEvents(
  tokenManager: TokenManager,
  accountId: string | number,
  requestDelayMs: number,
  signal: AbortSignal | undefined,
  logger: Logger
): Promise<unknown[]> {
  const all: unknown[] = [];

  let skip = 0;
  const top = 100;
  let nextUrl: string | null = `${API_BASE}/accounts/${accountId}/events?$top=${top}&$skip=${skip}`;
  let firstPage = true;

  while (nextUrl) {
    if (!firstPage) await sleep(requestDelayMs, signal);
    firstPage = false;
    logger.info(`Fetching: ${nextUrl}`);

    const data = await apiGet(nextUrl, tokenManager, { signal, logger });
    EventsResponseSchema.parse(data);
    const items = extractItems(data);

    all.push(...items);

    const explicitNextUrl = extractNextUrl(data);
    if (explicitNextUrl) {
      nextUrl = explicitNextUrl;
      continue;
    }

    if (!items.length || items.length < top) {
      nextUrl = null;
    } else {
      skip += top;
      nextUrl = `${API_BASE}/accounts/${accountId}/events?$top=${top}&$skip=${skip}`;
    }
  }

  return all;
}

interface EventDetailResult {
  event: unknown;
  ok: boolean;
  skipped?: boolean;
  error?: string;
  status?: number;
}

async function getEventDetails(
  tokenManager: TokenManager,
  accountId: string | number,
  event: unknown,
  signal: AbortSignal | undefined,
  logger: Logger
): Promise<EventDetailResult> {
  const obj = (event ?? {}) as Record<string, unknown>;
  const id =
    (obj.Id as string | number | undefined) ??
    (obj.id as string | number | undefined) ??
    (obj.EventId as string | number | undefined) ??
    (obj.eventId as string | number | undefined);

  if (!id) return { event, ok: true, skipped: true };

  const url = `${API_BASE}/accounts/${accountId}/events/${id}`;

  try {
    const detail = await apiGet(url, tokenManager, { signal, logger });
    return { event: detail, ok: true };
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") throw err;
    const msg = err instanceof Error ? err.message.split("\n")[0] : String(err);
    return {
      event,
      ok: false,
      error: msg,
      status: (err as { status?: number }).status,
    };
  }
}

function writeEventsCsv(events: unknown[], filePath: string): void {
  const normalized = events.map(normalizeEvent);

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

  const rows = [
    columns.join(","),
    ...normalized.map((event) =>
      columns.map((col) => csvEscape(event[col])).join(",")
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

interface PartialState {
  eventList: unknown[] | null;
  completedEventIds: string[];
  detailedEventsById: Record<string, unknown>;
  failures: Array<{
    eventId: string | number;
    status?: number;
    error?: string;
  }>;
}

function loadPartial(partialPath: string, logger: Logger): PartialState {
  const empty: PartialState = {
    eventList: null,
    completedEventIds: [],
    detailedEventsById: {},
    failures: [],
  };
  if (!fs.existsSync(partialPath)) return empty;
  try {
    const raw = JSON.parse(fs.readFileSync(partialPath, "utf8")) as Partial<PartialState>;
    if (
      raw &&
      Array.isArray(raw.completedEventIds) &&
      raw.detailedEventsById &&
      typeof raw.detailedEventsById === "object"
    ) {
      return {
        eventList: Array.isArray(raw.eventList) ? raw.eventList : null,
        completedEventIds: raw.completedEventIds,
        detailedEventsById: raw.detailedEventsById,
        failures: Array.isArray(raw.failures) ? raw.failures : [],
      };
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.warn(`  partial cache unreadable, starting fresh: ${msg}`);
  }
  return empty;
}

function savePartial(state: PartialState, partialPath: string): void {
  fs.writeFileSync(partialPath, JSON.stringify(state, null, 2), "utf8");
}

export async function exportEvents(
  opts: EventsExportOptions
): Promise<EventsExportResult> {
  EventsExportOptionsSchema.parse(opts);
  const logger = resolveLogger(opts.logger);

  const outDir = path.join(opts.outDir || "./exports", "events");
  const partialPath = path.join(outDir, "_partial.json");
  const failuresPath = path.join(outDir, "_detail_failures.json");
  const requestDelayMs =
    typeof opts.requestDelayMs === "number"
      ? opts.requestDelayMs
      : DEFAULT_REQUEST_DELAY_MS;
  const saveEveryN =
    typeof opts.saveEveryN === "number" ? opts.saveEveryN : DEFAULT_SAVE_EVERY_N;

  ensureDir(outDir);

  const { tokenManager, accountId } = await getAuthAndAccount({
    apiKey: opts.apiKey,
    accountId: opts.accountId,
    signal: opts.signal,
    logger: opts.logger,
  });

  const partial = loadPartial(partialPath, logger);
  let eventList: unknown[];
  if (partial.eventList && partial.eventList.length) {
    eventList = partial.eventList;
    logger.info(
      `Using cached event list from partial state: ${eventList.length} events.`
    );
  } else {
    logger.info("Fetching event list...");
    eventList = await getAllEvents(
      tokenManager,
      accountId,
      requestDelayMs,
      opts.signal,
      logger
    );
    partial.eventList = eventList;
    savePartial(partial, partialPath);
  }

  const completed = new Set(partial.completedEventIds.map(String));
  const detailedEventsById = partial.detailedEventsById;
  const failures = partial.failures;

  if (completed.size) {
    logger.info(
      `Resuming: ${completed.size}/${eventList.length} events already processed (${failures.length} prior failures).`
    );
  }

  logger.info(
    `Fetching event details (${requestDelayMs}ms between requests; event routes are often ~30/min)...`
  );
  opts.onProgress?.({ kind: "start", exporter: "events", total: eventList.length });

  let okThisRun = 0;
  let processedSinceSave = 0;

  for (let i = 0; i < eventList.length; i++) {
    const event = eventList[i];
    const realId = getId(event);
    const idKey = realId !== undefined ? String(realId) : null;

    if (idKey && completed.has(idKey)) continue;

    const displayId = realId ?? `index-${i}`;
    logger.progress?.(`[${i + 1}/${eventList.length}] Event ${displayId}... `);
    const result = await getEventDetails(
      tokenManager,
      accountId,
      event,
      opts.signal,
      logger
    );

    if (idKey) {
      detailedEventsById[idKey] = result.event;
      completed.add(idKey);
      partial.completedEventIds.push(idKey);
    }

    if (result.ok) {
      okThisRun++;
      logger.info(result.skipped ? "skipped (no id)" : "ok");
    } else {
      failures.push({
        eventId: displayId,
        status: result.status,
        error: result.error,
      });
      logger.info(`FAILED (${result.status || "?"}): ${result.error}`);
    }

    opts.onProgress?.({
      kind: "step",
      exporter: "events",
      index: i + 1,
      total: eventList.length,
      label: String(displayId),
    });

    processedSinceSave++;
    if (processedSinceSave >= saveEveryN) {
      savePartial(partial, partialPath);
      logger.info(
        `  [checkpoint] saved progress (${completed.size}/${eventList.length} processed, ${failures.length} failures)`
      );
      opts.onProgress?.({
        kind: "checkpoint",
        exporter: "events",
        processed: completed.size,
        total: eventList.length,
        failures: failures.length,
      });
      processedSinceSave = 0;
    }

    if (i < eventList.length - 1) await sleep(requestDelayMs, opts.signal);
  }

  // Final flush so the on-disk partial matches what we're about to write.
  savePartial(partial, partialPath);

  // Build the final ordered output by walking the original eventList. For any
  // event we have a cached detail for, use it; otherwise fall back to the
  // list-version event (matches the original behavior on detail-fetch failure).
  const detailedEvents = eventList.map((e) => {
    const id = getId(e);
    if (id !== undefined && detailedEventsById[String(id)]) {
      return detailedEventsById[String(id)];
    }
    return e;
  });

  const jsonPath = path.join(outDir, "wild-apricot-events.json");
  const csvPath = path.join(outDir, "wild-apricot-events.csv");

  fs.writeFileSync(jsonPath, JSON.stringify(detailedEvents, null, 2), "utf8");
  writeEventsCsv(detailedEvents, csvPath);

  let writtenFailuresPath: string | undefined;
  if (failures.length) {
    fs.writeFileSync(failuresPath, JSON.stringify(failures, null, 2), "utf8");
    writtenFailuresPath = failuresPath;
    logger.info("");
    logger.info(
      `${failures.length} of ${eventList.length} events fell back to list-version data — see ${failuresPath}`
    );
  } else if (fs.existsSync(failuresPath)) {
    fs.unlinkSync(failuresPath);
  }

  if (fs.existsSync(partialPath)) fs.unlinkSync(partialPath);

  const okTotal = eventList.length - failures.length;

  logger.info("");
  logger.info("Done.");
  logger.info(
    `Detail fetched OK : ${okTotal}/${eventList.length} (${okThisRun} this run)`
  );
  logger.info(`JSON: ${jsonPath}`);
  logger.info(`CSV:  ${csvPath}`);

  opts.onProgress?.({
    kind: "finish",
    exporter: "events",
    count: eventList.length,
    failures: failures.length,
  });

  return {
    outDir,
    jsonPath,
    csvPath,
    failuresPath: writtenFailuresPath,
    count: eventList.length,
    failureCount: failures.length,
  };
}
