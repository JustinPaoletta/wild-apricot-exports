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
} = require("./lib/wa-api");

const OUT_DIR = path.join(process.cwd(), "exports", "events");

// Event endpoints are often throttled much lower than WA's general API docs (~30/min
// in practice). ~2.2s spacing stays under that; override with WA_EVENT_REQUEST_DELAY_MS.
const EVENT_REQUEST_DELAY_MS = parseInt(process.env.WA_EVENT_REQUEST_DELAY_MS || "2200", 10);

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

async function getAllEvents(token, accountId) {
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

    const data = await apiGet(nextUrl, token);
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

async function getEventDetails(token, accountId, event) {
  const id = event.Id || event.id || event.EventId || event.eventId;

  if (!id) return { event, ok: true, skipped: true };

  const url = `${API_BASE}/accounts/${accountId}/events/${id}`;

  try {
    const detail = await apiGet(url, token);
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

async function main() {
  ensureDir(OUT_DIR);

  const { token, accountId } = await getAuthAndAccount();

  console.log("Fetching event list...");
  const eventList = await getAllEvents(token, accountId);

  console.log(`Found ${eventList.length} events.`);
  console.log(
    `Fetching event details (${EVENT_REQUEST_DELAY_MS}ms between requests; event routes are often ~30/min)...`
  );

  const detailedEvents = [];
  const failures = [];
  let okCount = 0;

  for (let i = 0; i < eventList.length; i++) {
    const event = eventList[i];
    const id =
      event.Id ||
      event.id ||
      event.EventId ||
      event.eventId ||
      `index-${i}`;

    process.stdout.write(`[${i + 1}/${eventList.length}] Event ${id}... `);
    const result = await getEventDetails(token, accountId, event);
    detailedEvents.push(result.event);

    if (result.ok) {
      okCount++;
      console.log(result.skipped ? "skipped (no id)" : "ok");
    } else {
      failures.push({ eventId: id, status: result.status, error: result.error });
      console.log(`FAILED (${result.status || "?"}): ${result.error}`);
    }

    if (i < eventList.length - 1) await sleep(EVENT_REQUEST_DELAY_MS);
  }

  const jsonPath = path.join(OUT_DIR, "wild-apricot-events.json");
  const csvPath = path.join(OUT_DIR, "wild-apricot-events.csv");

  fs.writeFileSync(jsonPath, JSON.stringify(detailedEvents, null, 2), "utf8");
  writeCsv(detailedEvents, csvPath);

  if (failures.length) {
    const failPath = path.join(OUT_DIR, "_detail_failures.json");
    fs.writeFileSync(failPath, JSON.stringify(failures, null, 2), "utf8");
    console.log("");
    console.log(
      `${failures.length} of ${eventList.length} events fell back to list-version data — see ${failPath}`
    );
  }

  console.log("");
  console.log("Done.");
  console.log(`Detail fetched OK : ${okCount}/${eventList.length}`);
  console.log(`JSON: ${jsonPath}`);
  console.log(`CSV:  ${csvPath}`);
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}