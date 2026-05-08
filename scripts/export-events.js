// export-events.js
// Exports Wild Apricot events to JSON and CSV.
// Requires Node 18+ because it uses built-in fetch.

require("dotenv").config();

const fs = require("fs");
const path = require("path");

const {
  API_BASE,
  apiGet,
  ensureDir,
  getNested,
  getAuthAndAccount,
  sleep,
} = require("../lib/wa-api");

const OUT_DIR = path.join(process.cwd(), "exports", "events");
const PARTIAL_PATH = path.join(OUT_DIR, "_partial.json");
const FAILURES_PATH = path.join(OUT_DIR, "_detail_failures.json");

// Event endpoints are often throttled much lower than WA's general API docs (~30/min
// in practice). ~2.2s spacing stays under that; override with WA_EVENT_REQUEST_DELAY_MS.
const EVENT_REQUEST_DELAY_MS = parseInt(process.env.WA_EVENT_REQUEST_DELAY_MS || "2200", 10);

// Checkpoint partial progress every N events processed. Override with
// WA_EVENTS_SAVE_EVERY. With 1000+ events and ~2.2s spacing, a full export
// takes 30-45min — frequent checkpoints make Ctrl+C / crash recovery cheap.
const SAVE_EVERY_N = parseInt(process.env.WA_EVENTS_SAVE_EVERY || "100", 10);

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

async function getAllEvents(tokenManager, accountId) {
  const all = [];

  // top/skip style pagination. If Wild Apricot returns a next link, this also follows it.
  let skip = 0;
  const top = 100;
  let nextUrl = `${API_BASE}/accounts/${accountId}/events?$top=${top}&$skip=${skip}`;
  let firstPage = true;

  while (nextUrl) {
    if (!firstPage) await sleep(EVENT_REQUEST_DELAY_MS);
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

function writeCsv(events, filePath) {
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

// Partial state schema:
//   eventList            — original list-version events from /events (cached so
//                          a resume doesn't have to re-paginate the list)
//   completedEventIds    — string IDs we've already processed (success OR
//                          fall-through-failure). Failures are still recorded
//                          in `failures`; marking them completed prevents an
//                          infinite retry loop on broken events. Use
//                          `retry-event-failures` to re-attempt them.
//   detailedEventsById   — { [id]: detailObject } — successful detail fetches
//                          and list-version fallbacks for failures
//   failures             — [{ eventId, status, error }] same shape as the
//                          legacy _detail_failures.json
function loadPartial() {
  if (!fs.existsSync(PARTIAL_PATH)) {
    return { eventList: null, completedEventIds: [], detailedEventsById: {}, failures: [] };
  }
  try {
    const raw = JSON.parse(fs.readFileSync(PARTIAL_PATH, "utf8"));
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

function savePartial(state) {
  fs.writeFileSync(PARTIAL_PATH, JSON.stringify(state, null, 2), "utf8");
}

async function main() {
  ensureDir(OUT_DIR);

  const { tokenManager, accountId } = await getAuthAndAccount();

  const partial = loadPartial();
  let eventList;
  if (partial.eventList && partial.eventList.length) {
    eventList = partial.eventList;
    console.log(`Using cached event list from partial state: ${eventList.length} events.`);
  } else {
    console.log("Fetching event list...");
    eventList = await getAllEvents(tokenManager, accountId);
    partial.eventList = eventList;
    savePartial(partial);
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
    `Fetching event details (${EVENT_REQUEST_DELAY_MS}ms between requests; event routes are often ~30/min)...`
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
    if (processedSinceSave >= SAVE_EVERY_N) {
      savePartial(partial);
      console.log(
        `  [checkpoint] saved progress (${completed.size}/${eventList.length} processed, ${failures.length} failures)`
      );
      processedSinceSave = 0;
    }

    if (i < eventList.length - 1) await sleep(EVENT_REQUEST_DELAY_MS);
  }

  // Final flush so the on-disk partial matches what we're about to write.
  savePartial(partial);

  // Build the final ordered output by walking the original eventList. For any
  // event we have a cached detail for, use it; otherwise fall back to the
  // list-version event (matches the original behavior on detail-fetch failure).
  const detailedEvents = eventList.map((e) => {
    const id = getId(e);
    if (id && detailedEventsById[String(id)]) return detailedEventsById[String(id)];
    return e;
  });

  const jsonPath = path.join(OUT_DIR, "wild-apricot-events.json");
  const csvPath = path.join(OUT_DIR, "wild-apricot-events.csv");

  fs.writeFileSync(jsonPath, JSON.stringify(detailedEvents, null, 2), "utf8");
  writeCsv(detailedEvents, csvPath);

  if (failures.length) {
    fs.writeFileSync(FAILURES_PATH, JSON.stringify(failures, null, 2), "utf8");
    console.log("");
    console.log(
      `${failures.length} of ${eventList.length} events fell back to list-version data — see ${FAILURES_PATH}`
    );
  } else if (fs.existsSync(FAILURES_PATH)) {
    fs.unlinkSync(FAILURES_PATH);
  }

  // Clean up the partial cache once we've successfully written the final files.
  if (fs.existsSync(PARTIAL_PATH)) fs.unlinkSync(PARTIAL_PATH);

  const okTotal = eventList.length - failures.length;

  console.log("");
  console.log("Done.");
  console.log(`Detail fetched OK : ${okTotal}/${eventList.length} (${okThisRun} this run)`);
  console.log(`JSON: ${jsonPath}`);
  console.log(`CSV:  ${csvPath}`);
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}