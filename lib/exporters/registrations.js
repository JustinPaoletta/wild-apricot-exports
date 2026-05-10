// lib/exporters/registrations.js
// Exports event registrations for every event in the account.
//
// Cross-exporter cache contract: the caller may pass `events: Event[]` to
// avoid re-fetching the event list. If omitted, this function fetches the
// event list fresh from the API. (The CLI shim handles "read from
// <outDir>/events/wild-apricot-events.json if present" so library users
// don't get surprise file I/O.)

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
} = require("../wa-api");

const DEFAULT_REQUEST_DELAY_MS = 350;
const DEFAULT_SAVE_EVERY_N = 5;

function loadPartial(partialPath) {
  if (!fs.existsSync(partialPath)) {
    return { completedEventIds: [], registrations: [], failures: [] };
  }
  try {
    const raw = JSON.parse(fs.readFileSync(partialPath, "utf8"));
    if (raw && Array.isArray(raw.completedEventIds) && Array.isArray(raw.registrations)) {
      raw.failures = Array.isArray(raw.failures) ? raw.failures : [];
      return raw;
    }
  } catch (err) {
    console.warn(`  partial cache unreadable, starting fresh: ${err.message}`);
  }
  return { completedEventIds: [], registrations: [], failures: [] };
}

function savePartial(state, partialPath) {
  fs.writeFileSync(partialPath, JSON.stringify(state, null, 2), "utf8");
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

async function exportRegistrations(opts = {}) {
  const outDir = path.join(opts.outDir || "./exports", "registrations");
  const partialPath = path.join(outDir, "registrations.partial.json");
  const failuresPath = path.join(outDir, "_failures.json");
  const requestDelayMs =
    typeof opts.requestDelayMs === "number" ? opts.requestDelayMs : DEFAULT_REQUEST_DELAY_MS;
  const saveEveryN =
    typeof opts.saveEveryN === "number" ? opts.saveEveryN : DEFAULT_SAVE_EVERY_N;

  ensureDir(outDir);

  const { tokenManager, accountId } = await getAuthAndAccount({
    apiKey: opts.apiKey,
    accountId: opts.accountId,
  });

  let events;
  if (Array.isArray(opts.events)) {
    events = opts.events;
    console.log(`Using ${events.length} events from caller (no fetch).`);
  } else {
    console.log("No events passed in — fetching event list...");
    const url = `${API_BASE}/accounts/${accountId}/events`;
    events = await paginate(url, tokenManager, { top: 100 });
  }
  console.log(`Will fetch registrations for ${events.length} events.`);

  const partial = loadPartial(partialPath);
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
      const data = await apiGet(url, tokenManager);
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
    if (processedSinceSave >= saveEveryN) {
      savePartial(partial, partialPath);
      processedSinceSave = 0;
    }

    await sleep(requestDelayMs);
  }

  savePartial(partial, partialPath);

  const jsonPath = path.join(outDir, "registrations.json");
  const csvPath = path.join(outDir, "registrations.csv");
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

  let writtenFailuresPath;
  if (failures.length) {
    writeJson(failures, failuresPath);
    writtenFailuresPath = failuresPath;
    console.log(`\n${failures.length} events failed — see ${failuresPath}`);
  } else if (fs.existsSync(failuresPath)) {
    fs.unlinkSync(failuresPath);
  }

  if (fs.existsSync(partialPath)) fs.unlinkSync(partialPath);

  console.log("");
  console.log("Done.");
  console.log(`Total registrations: ${allRegistrations.length}`);
  console.log(`JSON: ${jsonPath}`);
  console.log(`CSV:  ${csvPath}`);

  return {
    outDir,
    jsonPath,
    csvPath,
    failuresPath: writtenFailuresPath,
    count: allRegistrations.length,
    failureCount: failures.length,
  };
}

module.exports = { exportRegistrations };
