// export-events.js
// Exports Wild Apricot events to JSON and CSV.
// Requires Node 18+ because it uses built-in fetch.

require("dotenv").config();

const fs = require("fs");
const path = require("path");

const API_KEY = process.env.WILD_APRICOT_API_KEY;
let ACCOUNT_ID = process.env.WILD_APRICOT_ACCOUNT_ID;

if (!API_KEY) {
  console.error("Missing WILD_APRICOT_API_KEY in .env");
  process.exit(1);
}

const OUT_DIR = path.join(process.cwd(), "exports", "events");

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function csvEscape(value) {
  if (value === null || value === undefined) return "";
  const str = String(value);
  if (/[",\n\r]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function getNested(obj, paths) {
  for (const p of paths) {
    const parts = p.split(".");
    let cur = obj;

    for (const part of parts) {
      if (cur == null) break;
      cur = cur[part];
    }

    if (cur !== undefined && cur !== null && cur !== "") return cur;
  }

  return "";
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

async function getAccessToken() {
  const credentials = Buffer.from(`APIKEY:${API_KEY}`).toString("base64");

  const response = await fetch("https://oauth.wildapricot.org/auth/token", {
    method: "POST",
    headers: {
      Authorization: `Basic ${credentials}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      scope: "auto",
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(
      `Token request failed: ${response.status} ${response.statusText}\n${body}`
    );
  }

  const data = await response.json();

  if (!data.access_token) {
    throw new Error(
      `Token response did not include access_token:\n${JSON.stringify(data, null, 2)}`
    );
  }

  return data.access_token;
}

async function apiGet(url, token) {
  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
    },
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(
      `GET failed: ${response.status} ${response.statusText}\nURL: ${url}\n${body}`
    );
  }

  return response.json();
}

async function discoverAccountId(token) {
  const accountsUrl = "https://api.wildapricot.org/v2.2/accounts";
  const data = await apiGet(accountsUrl, token);

  const accounts = Array.isArray(data)
    ? data
    : data.Accounts || data.accounts || data.Items || data.items || [];

  if (!accounts.length) {
    throw new Error(`No accounts found:\n${JSON.stringify(data, null, 2)}`);
  }

  const account = accounts[0];
  const accountId =
    account.Id || account.id || account.AccountId || account.accountId;

  if (!accountId) {
    throw new Error(
      `Could not discover account ID:\n${JSON.stringify(account, null, 2)}`
    );
  }

  return accountId;
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
  let nextUrl = `https://api.wildapricot.org/v2.2/accounts/${accountId}/events?$top=${top}&$skip=${skip}`;

  while (nextUrl) {
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
      nextUrl = `https://api.wildapricot.org/v2.2/accounts/${accountId}/events?$top=${top}&$skip=${skip}`;
    }
  }

  return all;
}

async function getEventDetails(token, accountId, event) {
  const id = event.Id || event.id || event.EventId || event.eventId;

  if (!id) return event;

  const url = `https://api.wildapricot.org/v2.2/accounts/${accountId}/events/${id}`;

  try {
    return await apiGet(url, token);
  } catch (err) {
    console.warn(
      `Could not fetch detail for event ${id}. Keeping list version.`
    );
    return event;
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

  const token = await getAccessToken();

  if (!ACCOUNT_ID) {
    console.log(
      "No WILD_APRICOT_ACCOUNT_ID provided. Discovering account ID..."
    );
    ACCOUNT_ID = await discoverAccountId(token);
    console.log(`Using account ID: ${ACCOUNT_ID}`);
  }

  console.log("Fetching event list...");
  const eventList = await getAllEvents(token, ACCOUNT_ID);

  console.log(`Found ${eventList.length} events.`);
  console.log("Fetching event details...");

  const detailedEvents = [];
  for (let i = 0; i < eventList.length; i++) {
    const event = eventList[i];
    const id =
      event.Id ||
      event.id ||
      event.EventId ||
      event.eventId ||
      `index-${i}`;

    console.log(`[${i + 1}/${eventList.length}] Event ${id}`);
    const detail = await getEventDetails(token, ACCOUNT_ID, event);
    detailedEvents.push(detail);
  }

  const jsonPath = path.join(OUT_DIR, "wild-apricot-events.json");
  const csvPath = path.join(OUT_DIR, "wild-apricot-events.csv");

  fs.writeFileSync(
    jsonPath,
    JSON.stringify(detailedEvents, null, 2),
    "utf8"
  );
  writeCsv(detailedEvents, csvPath);

  console.log("");
  console.log("Done.");
  console.log(`JSON: ${jsonPath}`);
  console.log(`CSV:  ${csvPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});