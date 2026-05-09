// lib/exporters/retry-events.js
// Re-fetch detail for events listed in <outDir>/events/_detail_failures.json,
// merge the successful ones back into wild-apricot-events.json/.csv, and
// rewrite _detail_failures.json with anything still failing.
//
// Useful because Wild Apricot sometimes returns transient 401s on individual
// /events/{id} calls during a long export.

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
} = require("../wa-api");

const DEFAULT_REQUEST_DELAY_MS = 2200;

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

function writeEventsCsv(events, filePath) {
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

async function retryEventFailures(opts = {}) {
  const outDir = path.join(opts.outDir || "./exports", "events");
  const eventsJsonPath = path.join(outDir, "wild-apricot-events.json");
  const eventsCsvPath = path.join(outDir, "wild-apricot-events.csv");
  const failuresPath = path.join(outDir, "_detail_failures.json");
  const requestDelayMs =
    typeof opts.requestDelayMs === "number" ? opts.requestDelayMs : DEFAULT_REQUEST_DELAY_MS;

  ensureDir(outDir);

  if (!fs.existsSync(failuresPath)) {
    console.log(`No failures file at ${failuresPath} — nothing to retry.`);
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

  const failures = JSON.parse(fs.readFileSync(failuresPath, "utf8"));
  if (!failures.length) {
    console.log("Failures file is empty — nothing to retry.");
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
  });
  const events = JSON.parse(fs.readFileSync(eventsJsonPath, "utf8"));
  const eventsById = new Map(events.map((e) => [String(getId(e)), e]));

  console.log(
    `Retrying ${failures.length} previously-failed event(s) (${requestDelayMs}ms between requests)...`
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

    if (i < failures.length - 1) await sleep(requestDelayMs);
  }

  // Rebuild events array preserving the original ordering.
  const merged = events.map((e) => eventsById.get(String(getId(e))) || e);

  fs.writeFileSync(eventsJsonPath, JSON.stringify(merged, null, 2), "utf8");
  writeEventsCsv(merged, eventsCsvPath);

  if (stillFailing.length) {
    fs.writeFileSync(failuresPath, JSON.stringify(stillFailing, null, 2), "utf8");
  } else {
    fs.unlinkSync(failuresPath);
  }

  console.log("");
  console.log("Done.");
  console.log(`Recovered    : ${recovered}/${failures.length}`);
  console.log(`Still failing: ${stillFailing.length}`);
  console.log(`JSON: ${eventsJsonPath}`);
  console.log(`CSV:  ${eventsCsvPath}`);
  if (stillFailing.length) {
    console.log(`Remaining failures written to ${failuresPath}`);
  } else {
    console.log("All previous failures recovered — _detail_failures.json removed.");
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

module.exports = { retryEventFailures };
