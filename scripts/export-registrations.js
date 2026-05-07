// export-registrations.js
// Exports event registrations for every event in the account.
// Reads cached events from exports/events/wild-apricot-events.json if present
// (so you don't need to re-fetch the event list).

require("dotenv").config();

const fs = require("fs");
const path = require("path");
const {
  API_BASE,
  apiGet,
  paginate,
  ensureDir,
  writeJson,
  writeCsv,
  getNested,
  getAuthAndAccount,
  sleep,
} = require("../lib/wa-api");

const OUT_DIR = path.join(process.cwd(), "exports", "registrations");
const EVENTS_CACHE = path.join(process.cwd(), "exports", "events", "wild-apricot-events.json");
const PARTIAL_PATH = path.join(OUT_DIR, "registrations.partial.json");
const FAILURES_PATH = path.join(OUT_DIR, "_failures.json");

const REQUEST_DELAY_MS = parseInt(process.env.WA_REQUEST_DELAY_MS || "350", 10);
const SAVE_EVERY_N = parseInt(process.env.WA_REGISTRATIONS_SAVE_EVERY || "5", 10);

async function getEventList(token, accountId) {
  if (fs.existsSync(EVENTS_CACHE)) {
    console.log(`Using cached event list: ${EVENTS_CACHE}`);
    return JSON.parse(fs.readFileSync(EVENTS_CACHE, "utf8"));
  }
  console.log("No cached events found — fetching event list...");
  const url = `${API_BASE}/accounts/${accountId}/events`;
  return paginate(url, token, { top: 100 });
}

function loadPartial() {
  if (!fs.existsSync(PARTIAL_PATH)) {
    return { completedEventIds: [], registrations: [], failures: [] };
  }
  try {
    const raw = JSON.parse(fs.readFileSync(PARTIAL_PATH, "utf8"));
    if (raw && Array.isArray(raw.completedEventIds) && Array.isArray(raw.registrations)) {
      raw.failures = Array.isArray(raw.failures) ? raw.failures : [];
      return raw;
    }
  } catch (err) {
    console.warn(`  partial cache unreadable, starting fresh: ${err.message}`);
  }
  return { completedEventIds: [], registrations: [], failures: [] };
}

function savePartial(state) {
  fs.writeFileSync(PARTIAL_PATH, JSON.stringify(state, null, 2), "utf8");
}

function normalizeRegistration(reg, event) {
  const contact = reg.Contact || reg.contact || {};
  return {
    registrationId: getNested(reg, ["Id", "id"]),
    eventId: getNested(event, ["Id", "id"]) || getNested(reg, ["Event.Id", "EventId"]),
    eventTitle: getNested(event, ["Name", "Title"]) || "",
    eventStartDate: getNested(event, ["StartDate", "StartDateTime"]) || "",
    contactId: getNested(contact, ["Id", "id"]) || getNested(reg, ["ContactId"]),
    firstName: getNested(contact, ["FirstName", "firstName"]),
    lastName: getNested(contact, ["LastName", "lastName"]),
    email: getNested(contact, ["Email", "email"]) || getNested(reg, ["RegistrationFields.Email"]),
    displayName: getNested(reg, ["DisplayName", "displayName"]) || getNested(contact, ["DisplayName"]),
    registrationTypeName: getNested(reg, ["RegistrationType.Name", "RegistrationTypeName"]),
    registrationTypeId: getNested(reg, ["RegistrationTypeId", "RegistrationType.Id"]),
    isPaid: getNested(reg, ["IsPaid", "isPaid"]),
    paidSum: getNested(reg, ["PaidSum", "paidSum"]),
    invoiceId: getNested(reg, ["InvoiceId", "invoiceId"]),
    confirmationCode: getNested(reg, ["ConfirmationCode"]),
    isCheckedIn: getNested(reg, ["IsCheckedIn"]),
    onWaitList: getNested(reg, ["OnWaitList"]),
    status: getNested(reg, ["Status"]),
    memo: getNested(reg, ["Memo"]),
    createdDate: getNested(reg, ["CreatedDate", "createdDate"]),
  };
}

async function main() {
  ensureDir(OUT_DIR);
  const { token, accountId } = await getAuthAndAccount();

  const events = await getEventList(token, accountId);
  console.log(`Will fetch registrations for ${events.length} events.`);

  const partial = loadPartial();
  const completed = new Set(partial.completedEventIds.map(String));
  const allRegistrations = partial.registrations;
  const failures = partial.failures;

  if (completed.size) {
    console.log(
      `Resuming: ${completed.size} events already processed (${allRegistrations.length} registrations cached).`
    );
  }

  let processedSinceSave = 0;

  for (let i = 0; i < events.length; i++) {
    const event = events[i];
    const id = event.Id || event.id;
    if (!id) continue;
    const idKey = String(id);

    if (completed.has(idKey)) {
      // already done in a previous run
      continue;
    }

    const title = event.Name || event.Title || "(untitled)";
    console.log(`[${i + 1}/${events.length}] event ${id} — ${title}`);

    try {
      const url = `${API_BASE}/accounts/${accountId}/eventregistrations?eventId=${id}&includeDetails=true`;
      const data = await apiGet(url, token);
      const items = Array.isArray(data) ? data : data.Items || data.Registrations || [];
      for (const reg of items) {
        allRegistrations.push({ ...reg, _event: { Id: id, Name: title } });
      }
      console.log(`  ${items.length} registrations`);
      completed.add(idKey);
      partial.completedEventIds.push(idKey);
    } catch (err) {
      const msg = err && err.message ? err.message : String(err);
      console.warn(`  failed: ${msg.split("\n")[0]}`);
      failures.push({ eventId: id, error: msg });
      // Mark as completed so we don't get stuck retrying the same broken event
      // on every resume. Failures are still tracked in _failures.json.
      completed.add(idKey);
      partial.completedEventIds.push(idKey);
    }

    processedSinceSave++;
    if (processedSinceSave >= SAVE_EVERY_N) {
      savePartial(partial);
      processedSinceSave = 0;
    }

    // Be polite to the API
    await sleep(REQUEST_DELAY_MS);
  }

  // Final flush of partial state before writing the canonical outputs.
  savePartial(partial);

  const jsonPath = path.join(OUT_DIR, "registrations.json");
  const csvPath = path.join(OUT_DIR, "registrations.csv");
  writeJson(allRegistrations, jsonPath);

  const normalized = allRegistrations.map((r) => normalizeRegistration(r, r._event || {}));
  const columns = [
    "registrationId",
    "eventId",
    "eventTitle",
    "eventStartDate",
    "contactId",
    "firstName",
    "lastName",
    "email",
    "displayName",
    "registrationTypeName",
    "registrationTypeId",
    "isPaid",
    "paidSum",
    "invoiceId",
    "confirmationCode",
    "isCheckedIn",
    "onWaitList",
    "status",
    "memo",
    "createdDate",
  ];
  writeCsv(normalized, columns, csvPath);

  if (failures.length) {
    writeJson(failures, FAILURES_PATH);
    console.log(`\n${failures.length} events failed — see ${FAILURES_PATH}`);
  } else if (fs.existsSync(FAILURES_PATH)) {
    fs.unlinkSync(FAILURES_PATH);
  }

  // Clean up the partial cache once we've successfully written the final files.
  if (fs.existsSync(PARTIAL_PATH)) fs.unlinkSync(PARTIAL_PATH);

  console.log("");
  console.log("Done.");
  console.log(`Total registrations: ${allRegistrations.length}`);
  console.log(`JSON: ${jsonPath}`);
  console.log(`CSV:  ${csvPath}`);
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
