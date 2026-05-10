// lib/wa-api.js
// Shared helpers for talking to the Wild Apricot REST API.

const fs = require("fs");
const path = require("path");

const API_BASE = "https://api.wildapricot.org/v2.2";
const TOKEN_URL = "https://oauth.wildapricot.org/auth/token";

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchTokenResponse(apiKey) {
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
  return {
    accessToken: data.access_token,
    expiresIn: typeof data.expires_in === "number" ? data.expires_in : null,
  };
}

async function getAccessToken(apiKey) {
  const { accessToken } = await fetchTokenResponse(apiKey);
  return accessToken;
}

// Wild Apricot OAuth tokens expire (~30 min). For long exports we need to
// be able to refresh the token mid-run, so callers pass a "token manager"
// instead of a raw token string. The manager caches the current token,
// proactively refreshes ~60s before expiration, and exposes a refresh()
// for reactive recovery on a 401.
function createTokenManager(apiKey) {
  if (!apiKey) throw new Error("Missing WILD_APRICOT_API_KEY");

  let cachedToken = null;
  let expiresAtMs = 0;
  let inflight = null;
  const SAFETY_MS = 60 * 1000;

  async function refresh() {
    if (inflight) return inflight;
    inflight = (async () => {
      const { accessToken, expiresIn } = await fetchTokenResponse(apiKey);
      cachedToken = accessToken;
      const lifetimeMs = (expiresIn ? expiresIn : 1800) * 1000;
      expiresAtMs = Date.now() + lifetimeMs;
      return cachedToken;
    })();
    try {
      return await inflight;
    } finally {
      inflight = null;
    }
  }

  async function get() {
    if (cachedToken && Date.now() + SAFETY_MS < expiresAtMs) return cachedToken;
    return refresh();
  }

  return { get, refresh, isTokenManager: true };
}

function isTokenManager(value) {
  return Boolean(value && typeof value === "object" && value.isTokenManager);
}

async function apiFetch(
  url,
  tokenOrManager,
  {
    method = "GET",
    retries = 3,
    rateLimitRetries = 8,
    maxBackoffSeconds = 300,
    authRefreshRetries = 2,
  } = {}
) {
  const manager = isTokenManager(tokenOrManager) ? tokenOrManager : null;

  let attempt = 0;
  let rateLimitAttempt = 0;
  let authRefreshAttempt = 0;
  let lastErr;

  while (true) {
    try {
      const token = manager ? await manager.get() : tokenOrManager;
      const response = await fetch(url, {
        method,
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/json",
        },
      });

      // Handle rate limiting with exponential backoff (separate counter from
      // generic retries so a 429 storm doesn't get mixed up with 5xx flakiness).
      if (response.status === 429) {
        rateLimitAttempt++;
        if (rateLimitAttempt > rateLimitRetries) {
          const err = new Error(
            `Rate limited (429) — gave up after ${rateLimitRetries} retries\nURL: ${url}`
          );
          err.status = 429;
          throw err;
        }
        const headerSeconds = parseInt(response.headers.get("Retry-After") || "0", 10);
        // 10s, 20s, 40s, 80s, 160s, then capped at maxBackoffSeconds
        const backoff = Math.min(10 * Math.pow(2, rateLimitAttempt - 1), maxBackoffSeconds);
        const waitSeconds = Math.max(headerSeconds, backoff);
        console.warn(
          `  [429] rate limited (${rateLimitAttempt}/${rateLimitRetries}) — waiting ${waitSeconds}s`
        );
        await sleep(waitSeconds * 1000);
        continue;
      }

      // 401s on a long export almost always mean the access token expired
      // mid-run. If we have a token manager, refresh and retry without
      // burning the generic retry budget. If we don't (raw string token),
      // fall through to the generic retry path so existing callers still
      // work the same way.
      if (response.status === 401 && manager) {
        authRefreshAttempt++;
        if (authRefreshAttempt > authRefreshRetries) {
          const body = await response.text();
          const err = new Error(
            `${method} 401 Unauthorized after ${authRefreshRetries} token refresh(es)\nURL: ${url}\n${body.slice(0, 500)}`
          );
          err.status = 401;
          throw err;
        }
        // Drain body so the connection is freed.
        try { await response.text(); } catch {}
        console.warn(
          `  [401] access token rejected — refreshing token and retrying (${authRefreshAttempt}/${authRefreshRetries})`
        );
        try {
          await manager.refresh();
        } catch (refreshErr) {
          const err = new Error(
            `Failed to refresh access token after 401: ${refreshErr.message}`
          );
          err.status = 401;
          throw err;
        }
        continue;
      }

      if (!response.ok) {
        const body = await response.text();
        const err = new Error(
          `${method} ${response.status} ${response.statusText}\nURL: ${url}\n${body.slice(0, 500)}`
        );
        err.status = response.status;
        // 408 is occasionally transient on WA — let it fall through to the
        // generic retry path. Other 4xx (403/404/etc.) are genuine client
        // errors and should fail fast.
        const isTransient4xx = response.status === 408;
        if (response.status >= 400 && response.status < 500 && !isTransient4xx) throw err;
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
      // Don't retry permanent client errors. 408 is treated as transient
      // (matches the throw logic above). 401 only reaches this path when
      // the caller passed a raw string token (no manager) — retry it as
      // before, even though the same token will probably keep failing.
      const isTransient4xx = err.status === 401 || err.status === 408;
      if (err.status && err.status >= 400 && err.status < 500 && !isTransient4xx) throw err;
      attempt++;
      if (attempt > retries) break;
      const delay = 1000 * Math.pow(2, attempt - 1);
      const msg = err && err.message ? err.message.split("\n")[0] : String(err);
      console.warn(`  [retry ${attempt}/${retries}] ${msg} — waiting ${delay}ms`);
      await sleep(delay);
    }
  }
  throw lastErr || new Error(`apiFetch failed without a captured error: ${url}`);
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

// Library-friendly auth bootstrap: takes an explicit `apiKey` (and optional
// `accountId`) instead of reading process.env, and throws on missing inputs
// rather than calling process.exit. CLI shims read .env and pass values in.
async function getAuthAndAccount(opts = {}) {
  const apiKey = opts.apiKey;
  if (!apiKey) {
    throw new Error(
      "Missing apiKey — pass opts.apiKey or set WILD_APRICOT_API_KEY in your CLI shim."
    );
  }
  const tokenManager = createTokenManager(apiKey);
  // Prime the manager so any caller using the legacy `token` snapshot
  // gets a real access token without an extra round-trip.
  const token = await tokenManager.get();
  let accountId = opts.accountId;
  if (!accountId) {
    console.log("Discovering account ID...");
    accountId = await discoverAccountId(tokenManager);
    console.log(`Using account ID: ${accountId}`);
  }
  return { token, tokenManager, accountId };
}

module.exports = {
  API_BASE,
  sleep,
  getAccessToken,
  createTokenManager,
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
