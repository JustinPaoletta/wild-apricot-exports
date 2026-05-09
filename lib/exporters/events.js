// lib/exporters/events.js
// Exports Wild Apricot events to JSON and CSV with resumable per-event
// detail fetches and exponential backoff on failure.
//
// Pure async function. CLI shim handles .env loading and process.exit.

const fs = require("fs");
const path = require("path");

const {
  API_BASE,
  apiGet,
  ensureDir,
  getNested,
  getAuthAndAccount,
  sleep,
} = require("../wa-api");

const DEFAULT_REQUEST_DELAY_MS = 2200;
const DEFAULT_SAVE_EVERY_N = 100;

function csvEscape(value) {
  if (value === null || value === undefined) return "";
  const str = String(value);
  if (/[",\n\r]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function normalizeEvent(event) {
  return {
    id: getNested(event, ["Id", "id", "EventId", "eventId"]),
    title: getNested(event, ["Name", "Title", "name", "title"]),
    startDate: getNested(event, ["StartDate", "StartDateTime", "startDate", "startDateTime"]),
    endDate: getNested(event, ["EndDate", "EndDateTime", "endDate", "endDateTime"]),
    location: getNested(event, ["Location", "LocationName", "location", "locationName"]),
    registrationEnabled: getNested(event, ["RegistrationEnabled", "registrationEnabled"]),
    registrationLimit: getNested(event, ["RegistrationLimit", "registrationLimit"]),
    registeredCount: getNested(event, ["RegisteredCount", "RegistrantsCount", "registeredCount", "registrantsCount"]),
    publicUrl: getNested(event, ["Url", "PublicUrl", "url", "publicUrl"]),
    detailsUrl: getNested(event, ["DetailsUrl", "detailsUrl"]),
    raw: event,
  };
}

function extractItems(data) {
  if (Array.isArray(data)) return data;
  return (
    data.Events ||
    data.events ||
    data.Items ||
    data.items ||
    []
  );
}

function extractNextUrl(data) {
  return (
    data.NextUrl ||
    data.nextUrl ||
    data.NextLink ||
    data.nextLink ||
    data["@odata.nextLink"] ||
    null
  );
}

async function getAllEvents(tokenManager, accountId, requestDelayMs) {
  const all = [];

  // top/skip style pagination. If Wild Apricot returns a next link, this also follows it.
  let skip = 0;
  const top = 100;
  let nextUrl = `${API_BASE}/accounts/${accountId}/events?$top=${top}&$skip=${skip}`;
  let firstPage = true;

  while (nextUrl) {
    if (!firstPage) await sleep(requestDelayMs);
    firstPage = false;
    console.log(`Fetching: ${nextUrl}`);

    const data = await apiGet(nextUrl, tokenManager);
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

async function getEventDetails(tokenManager, accountId, event) {
  const id = event.Id || event.id || event.EventId || event.eventId;

  if (!id) return { event, ok: true, skipped: true };

  const url = `${API_BASE}/accounts/${accountId}/events/${id}`;

  try {
    const detail = await apiGet(url, tokenManager);
    return { event: detail, ok: true };
  } catch (err) {
    const msg = err && err.message ? err.message.split("\n")[0] : String(err);
    return { event, ok: false, error: msg, status: err && err.status };
  }
}

function writeEventsCsv(events, filePath) {
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

function getId(event) {
  return event && (event.Id || event.id || event.EventId || event.eventId);
}

// Partial state schema (see comments in the original script for the full
// rationale). Identical layout — kept stable so a partial export from before
// PR 1 can be picked up by this code unchanged.
function loadPartial(partialPath) {
  if (!fs.existsSync(partialPath)) {
    return { eventList: null, completedEventIds: [], detailedEventsById: {}, failures: [] };
  }
  try {
    const raw = JSON.parse(fs.readFileSync(partialPath, "utf8"));
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
    console.warn(`  partial cache unreadable, starting fresh: ${err.message}`);
  }
  return { eventList: null, completedEventIds: [], detailedEventsById: {}, failures: [] };
}

function savePartial(state, partialPath) {
  fs.writeFileSync(partialPath, JSON.stringify(state, null, 2), "utf8");
}

async function exportEvents(opts = {}) {
  const outDir = path.join(opts.outDir || "./exports", "events");
  const partialPath = path.join(outDir, "_partial.json");
  const failuresPath = path.join(outDir, "_detail_failures.json");
  const requestDelayMs =
    typeof opts.requestDelayMs === "number" ? opts.requestDelayMs : DEFAULT_REQUEST_DELAY_MS;
  const saveEveryN =
    typeof opts.saveEveryN === "number" ? opts.saveEveryN : DEFAULT_SAVE_EVERY_N;

  ensureDir(outDir);

  const { tokenManager, accountId } = await getAuthAndAccount({
    apiKey: opts.apiKey,
    accountId: opts.accountId,
  });

  const partial = loadPartial(partialPath);
  let eventList;
  if (partial.eventList && partial.eventList.length) {
    eventList = partial.eventList;
    console.log(`Using cached event list from partial state: ${eventList.length} events.`);
  } else {
    console.log("Fetching event list...");
    eventList = await getAllEvents(tokenManager, accountId, requestDelayMs);
    partial.eventList = eventList;
    savePartial(partial, partialPath);
  }

  const completed = new Set(partial.completedEventIds.map(String));
  const detailedEventsById = partial.detailedEventsById;
  const failures = partial.failures;

  if (completed.size) {
    console.log(
      `Resuming: ${completed.size}/${eventList.length} events already processed (${failures.length} prior failures).`
    );
  }

  console.log(
    `Fetching event details (${requestDelayMs}ms between requests; event routes are often ~30/min)...`
  );

  let okThisRun = 0;
  let processedSinceSave = 0;

  for (let i = 0; i < eventList.length; i++) {
    const event = eventList[i];
    const realId = getId(event);
    const idKey = realId ? String(realId) : null;

    if (idKey && completed.has(idKey)) continue;

    const displayId = realId || `index-${i}`;
    process.stdout.write(`[${i + 1}/${eventList.length}] Event ${displayId}... `);
    const result = await getEventDetails(tokenManager, accountId, event);

    if (idKey) {
      detailedEventsById[idKey] = result.event;
      completed.add(idKey);
      partial.completedEventIds.push(idKey);
    }

    if (result.ok) {
      okThisRun++;
      console.log(result.skipped ? "skipped (no id)" : "ok");
    } else {
      failures.push({ eventId: displayId, status: result.status, error: result.error });
      console.log(`FAILED (${result.status || "?"}): ${result.error}`);
    }

    processedSinceSave++;
    if (processedSinceSave >= saveEveryN) {
      savePartial(partial, partialPath);
      console.log(
        `  [checkpoint] saved progress (${completed.size}/${eventList.length} processed, ${failures.length} failures)`
      );
      processedSinceSave = 0;
    }

    if (i < eventList.length - 1) await sleep(requestDelayMs);
  }

  // Final flush so the on-disk partial matches what we're about to write.
  savePartial(partial, partialPath);

  // Build the final ordered output by walking the original eventList. For any
  // event we have a cached detail for, use it; otherwise fall back to the
  // list-version event (matches the original behavior on detail-fetch failure).
  const detailedEvents = eventList.map((e) => {
    const id = getId(e);
    if (id && detailedEventsById[String(id)]) return detailedEventsById[String(id)];
    return e;
  });

  const jsonPath = path.join(outDir, "wild-apricot-events.json");
  const csvPath = path.join(outDir, "wild-apricot-events.csv");

  fs.writeFileSync(jsonPath, JSON.stringify(detailedEvents, null, 2), "utf8");
  writeEventsCsv(detailedEvents, csvPath);

  let writtenFailuresPath;
  if (failures.length) {
    fs.writeFileSync(failuresPath, JSON.stringify(failures, null, 2), "utf8");
    writtenFailuresPath = failuresPath;
    console.log("");
    console.log(
      `${failures.length} of ${eventList.length} events fell back to list-version data — see ${failuresPath}`
    );
  } else if (fs.existsSync(failuresPath)) {
    fs.unlinkSync(failuresPath);
  }

  // Clean up the partial cache once we've successfully written the final files.
  if (fs.existsSync(partialPath)) fs.unlinkSync(partialPath);

  const okTotal = eventList.length - failures.length;

  console.log("");
  console.log("Done.");
  console.log(`Detail fetched OK : ${okTotal}/${eventList.length} (${okThisRun} this run)`);
  console.log(`JSON: ${jsonPath}`);
  console.log(`CSV:  ${csvPath}`);

  return {
    outDir,
    jsonPath,
    csvPath,
    failuresPath: writtenFailuresPath,
    count: eventList.length,
    failureCount: failures.length,
  };
}

module.exports = { exportEvents };
