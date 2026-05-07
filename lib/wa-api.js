// lib/wa-api.js
// Shared helpers for talking to the Wild Apricot REST API.

const fs = require("fs");
const path = require("path");

const API_BASE = "https://api.wildapricot.org/v2.2";
const TOKEN_URL = "https://oauth.wildapricot.org/auth/token";

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function getAccessToken(apiKey) {
  if (!apiKey) throw new Error("Missing WILD_APRICOT_API_KEY");
  const credentials = Buffer.from(`APIKEY:${apiKey}`).toString("base64");

  const response = await fetch(TOKEN_URL, {
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
      `Token response missing access_token:\n${JSON.stringify(data, null, 2)}`
    );
  }
  return data.access_token;
}

async function apiFetch(url, token, { method = "GET", retries = 3 } = {}) {
  let attempt = 0;
  let lastErr;

  while (attempt <= retries) {
    try {
      const response = await fetch(url, {
        method,
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/json",
        },
      });

      // Handle rate limiting
      if (response.status === 429) {
        const retryAfter = parseInt(response.headers.get("Retry-After") || "10", 10);
        console.warn(`  [429] rate limited — waiting ${retryAfter}s`);
        await sleep(retryAfter * 1000);
        attempt++;
        continue;
      }

      if (!response.ok) {
        const body = await response.text();
        const err = new Error(
          `${method} ${response.status} ${response.statusText}\nURL: ${url}\n${body.slice(0, 500)}`
        );
        err.status = response.status;
        // Don't retry client errors (404, 401, 403, etc.) — they're not transient
        if (response.status >= 400 && response.status < 500) throw err;
        throw err;
      }

      // Some endpoints return 204 No Content
      if (response.status === 204) return null;

      // Some endpoints return XML (audit log can return application/xml in some accounts)
      const contentType = response.headers.get("content-type") || "";
      if (contentType.includes("application/json")) {
        return await response.json();
      }
      const text = await response.text();
      try {
        return JSON.parse(text);
      } catch {
        return text;
      }
    } catch (err) {
      lastErr = err;
      // Don't retry client errors
      if (err.status && err.status >= 400 && err.status < 500) throw err;
      attempt++;
      if (attempt > retries) break;
      const delay = 1000 * Math.pow(2, attempt - 1);
      console.warn(`  [retry ${attempt}/${retries}] ${err.message.split("\n")[0]} — waiting ${delay}ms`);
      await sleep(delay);
    }
  }
  throw lastErr;
}

async function apiGet(url, token) {
  return apiFetch(url, token);
}

async function discoverAccountId(token) {
  const data = await apiGet(`${API_BASE}/accounts`, token);
  const accounts = Array.isArray(data)
    ? data
    : data.Accounts || data.accounts || data.Items || data.items || [];
  if (!accounts.length) {
    throw new Error(`No accounts found:\n${JSON.stringify(data, null, 2)}`);
  }
  const a = accounts[0];
  const id = a.Id || a.id || a.AccountId || a.accountId;
  if (!id) throw new Error(`Could not discover account ID:\n${JSON.stringify(a, null, 2)}`);
  return id;
}

function extractItems(data, hint) {
  if (Array.isArray(data)) return data;
  if (hint && Array.isArray(data[hint])) return data[hint];
  return (
    data.Items ||
    data.items ||
    data.Contacts ||
    data.Events ||
    data.Invoices ||
    data.Payments ||
    data.Donations ||
    data.Registrations ||
    data.AuditLogItems ||
    []
  );
}

// Generic top/skip pagination for any endpoint that supports $top/$skip.
async function paginate(baseUrl, token, { top = 100, params = {} } = {}) {
  const all = [];
  let skip = 0;
  while (true) {
    const url = new URL(baseUrl);
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
    url.searchParams.set("$top", String(top));
    url.searchParams.set("$skip", String(skip));
    process.stdout.write(`  fetching skip=${skip}... `);
    const data = await apiGet(url.toString(), token);
    const items = extractItems(data);
    console.log(`${items.length} items`);
    all.push(...items);
    if (items.length < top) break;
    skip += top;
  }
  return all;
}

// Async result-id pattern. Used by /contacts and a few other endpoints that may not
// return data immediately. We start the async request, then poll until State=Complete.
async function asyncQuery(baseUrl, token, params = {}) {
  const url = new URL(baseUrl);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);

  console.log(`  starting async query: ${url.toString()}`);
  const initial = await apiGet(url.toString(), token);

  // If the response already includes the data inline, just return it.
  if (Array.isArray(initial) || initial.Items || initial.Contacts) {
    return initial;
  }

  const resultId =
    initial.ResultId ||
    initial.resultId ||
    (initial.State && initial.ResultId) ||
    null;

  if (!resultId) {
    // Some accounts return data directly; if no resultId & no items, return whatever we got.
    return initial;
  }

  const pollUrl = new URL(baseUrl);
  pollUrl.searchParams.set("resultId", resultId);

  for (let i = 0; i < 120; i++) {
    await sleep(2000);
    const poll = await apiGet(pollUrl.toString(), token);
    if (poll && poll.State && poll.State !== "Complete") {
      console.log(`  state: ${poll.State}`);
      continue;
    }
    return poll;
  }
  throw new Error(`Async query timed out after 4 minutes: ${baseUrl}`);
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function csvEscape(value) {
  if (value === null || value === undefined) return "";
  const str = typeof value === "object" ? JSON.stringify(value) : String(value);
  if (/[",\n\r]/.test(str)) return `"${str.replace(/"/g, '""')}"`;
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

function writeCsv(rows, columns, filePath) {
  const lines = [
    columns.join(","),
    ...rows.map((row) => columns.map((c) => csvEscape(row[c])).join(",")),
  ];
  fs.writeFileSync(filePath, lines.join("\n"), "utf8");
}

function writeJson(data, filePath) {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf8");
}

async function getAuthAndAccount() {
  require("dotenv").config();
  const apiKey = process.env.WILD_APRICOT_API_KEY;
  let accountId = process.env.WILD_APRICOT_ACCOUNT_ID;
  if (!apiKey) {
    console.error("Missing WILD_APRICOT_API_KEY in .env");
    process.exit(1);
  }
  const token = await getAccessToken(apiKey);
  if (!accountId) {
    console.log("Discovering account ID...");
    accountId = await discoverAccountId(token);
    console.log(`Using account ID: ${accountId}`);
  }
  return { token, accountId };
}

module.exports = {
  API_BASE,
  sleep,
  getAccessToken,
  discoverAccountId,
  apiGet,
  paginate,
  asyncQuery,
  extractItems,
  ensureDir,
  csvEscape,
  getNested,
  writeCsv,
  writeJson,
  getAuthAndAccount,
};
