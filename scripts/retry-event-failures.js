// retry-event-failures.js
// Re-fetch detail for events listed in exports/events/_detail_failures.json,
// merge the successful ones back into wild-apricot-events.json/.csv, and
// rewrite _detail_failures.json with anything still failing.
//
// Useful because Wild Apricot sometimes returns transient 401s on individual
// /events/{id} calls during a long export. Run this after `npm run export-events`
// if _detail_failures.json was produced.

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
  csvEscape,
} = require("../lib/wa-api");

const OUT_DIR = path.join(process.cwd(), "exports", "events");
const EVENTS_JSON = path.join(OUT_DIR, "wild-apricot-events.json");
const EVENTS_CSV = path.join(OUT_DIR, "wild-apricot-events.csv");
const FAILURES_JSON = path.join(OUT_DIR, "_detail_failures.json");

const EVENT_REQUEST_DELAY_MS = parseInt(process.env.WA_EVENT_REQUEST_DELAY_MS || "2200", 10);

function normalizeEvent(event) {
  return {
    id: getNested(event, ["Id", "id", "EventId", "eventId"]),
    title: getNested(event, ["Name", "Title", "name", "title"]),
    startDate: getNested(event, ["StartDate", "StartDateTime", "startDate", "startDateTime"]),
    endDate: getNested(event, ["EndDate", "EndDateTime", "endDate", "endDateTime"]),
    location: getNested(event, ["Location", "LocationName", "location", "locationName"]),
    registrationEnabled: getNested(event, ["RegistrationEnabled", "registrationEnabled"]),
    registrationLimit: getNested(event, ["RegistrationLimit", "registrationLimit"]),
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

function writeCsv(events, filePath) {
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
    ...normalized.map((event) => columns.map((c) => csvEscape(event[c])).join(",")),
  ];
  fs.writeFileSync(filePath, rows.join("\n"), "utf8");
}

function getId(event) {
  return event && (event.Id || event.id || event.EventId || event.eventId);
}

async function main() {
  ensureDir(OUT_DIR);

  if (!fs.existsSync(FAILURES_JSON)) {
    console.log(`No failures file at ${FAILURES_JSON} — nothing to retry.`);
    return;
  }
  if (!fs.existsSync(EVENTS_JSON)) {
    console.error(
      `Cannot find ${EVENTS_JSON}. Run \`npm run export-events\` first.`
    );
    process.exit(1);
  }

  const failures = JSON.parse(fs.readFileSync(FAILURES_JSON, "utf8"));
  if (!failures.length) {
    console.log("Failures file is empty — nothing to retry.");
    return;
  }

  const { tokenManager, accountId } = await getAuthAndAccount();
  const events = JSON.parse(fs.readFileSync(EVENTS_JSON, "utf8"));
  const eventsById = new Map(events.map((e) => [String(getId(e)), e]));

  console.log(
    `Retrying ${failures.length} previously-failed event(s) (${EVENT_REQUEST_DELAY_MS}ms between requests)...`
  );

  const stillFailing = [];
  let recovered = 0;

  for (let i = 0; i < failures.length; i++) {
    const f = failures[i];
    const id = f.eventId;
    process.stdout.write(`[${i + 1}/${failures.length}] Event ${id}... `);

    try {
      const detail = await apiGet(
        `${API_BASE}/accounts/${accountId}/events/${id}`,
        tokenManager
      );
      eventsById.set(String(id), detail);
      recovered++;
      console.log("ok");
    } catch (err) {
      const msg = err && err.message ? err.message.split("\n")[0] : String(err);
      stillFailing.push({ eventId: id, status: err && err.status, error: msg });
      console.log(`FAILED (${(err && err.status) || "?"}): ${msg}`);
    }

    if (i < failures.length - 1) await sleep(EVENT_REQUEST_DELAY_MS);
  }

  // Rebuild events array preserving the original ordering.
  const merged = events.map((e) => eventsById.get(String(getId(e))) || e);

  fs.writeFileSync(EVENTS_JSON, JSON.stringify(merged, null, 2), "utf8");
  writeCsv(merged, EVENTS_CSV);

  if (stillFailing.length) {
    fs.writeFileSync(FAILURES_JSON, JSON.stringify(stillFailing, null, 2), "utf8");
  } else {
    fs.unlinkSync(FAILURES_JSON);
  }

  console.log("");
  console.log("Done.");
  console.log(`Recovered    : ${recovered}/${failures.length}`);
  console.log(`Still failing: ${stillFailing.length}`);
  console.log(`JSON: ${EVENTS_JSON}`);
  console.log(`CSV:  ${EVENTS_CSV}`);
  if (stillFailing.length) {
    console.log(`Remaining failures written to ${FAILURES_JSON}`);
  } else {
    console.log("All previous failures recovered — _detail_failures.json removed.");
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
