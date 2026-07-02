// src/wa-api.ts
// Shared helpers for talking to the Wild Apricot REST API.

import * as fs from "node:fs";
import { Buffer } from "node:buffer";

import { TokenResponseSchema, PaginatedResponseSchema } from "./schemas";
import { resolveLogger } from "./logger";
import type { Logger, TokenManager, AuthAndAccount } from "./types";

/** Wild Apricot REST API v2.2 base (`https://api.wildapricot.org/v2.2`). Append `/accounts/:id/...`. */
export const API_BASE = "https://api.wildapricot.org/v2.2";
const TOKEN_URL = "https://oauth.wildapricot.org/auth/token";

/* --------------------------------------------------------------------------
 * Cancellation-aware sleep
 * -------------------------------------------------------------------------- */

/**
 * Delay that rejects with an `AbortError` if `signal` is aborted before completion.
 */
export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(toAbortError(signal));
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(toAbortError(signal!));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

function toAbortError(signal: AbortSignal): Error {
  const reason: unknown = (signal as { reason?: unknown }).reason;
  if (reason instanceof Error) return reason;
  const err = new Error("The operation was aborted");
  (err as { name?: string }).name = "AbortError";
  return err;
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw toAbortError(signal);
}

/* --------------------------------------------------------------------------
 * OAuth token management
 * -------------------------------------------------------------------------- */

interface FetchTokenResponse {
  accessToken: string;
  expiresIn: number | null;
}

async function fetchTokenResponse(
  apiKey: string,
  signal?: AbortSignal
): Promise<FetchTokenResponse> {
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
    signal,
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Token request failed: ${response.status} ${response.statusText}\n${body}`);
  }

  const dataRaw = await response.json();
  const data = TokenResponseSchema.parse(dataRaw);
  return {
    accessToken: data.access_token,
    expiresIn: typeof data.expires_in === "number" ? data.expires_in : null,
  };
}

export async function getAccessToken(apiKey: string, signal?: AbortSignal): Promise<string> {
  const { accessToken } = await fetchTokenResponse(apiKey, signal);
  return accessToken;
}

/**
 * Wild Apricot OAuth tokens expire (~30 min). For long exports we need to
 * be able to refresh the token mid-run, so callers pass a "token manager"
 * instead of a raw token string. The manager caches the current token,
 * proactively refreshes ~60s before expiration, and exposes a refresh()
 * for reactive recovery on a 401.
 */
export function createTokenManager(
  apiKey: string,
  options: { signal?: AbortSignal } = {}
): TokenManager {
  if (!apiKey) throw new Error("Missing WILD_APRICOT_API_KEY");

  let cachedToken: string | null = null;
  let expiresAtMs = 0;
  let inflight: Promise<string> | null = null;
  const SAFETY_MS = 60 * 1000;

  async function refresh(): Promise<string> {
    if (inflight) return inflight;
    inflight = (async () => {
      const { accessToken, expiresIn } = await fetchTokenResponse(apiKey, options.signal);
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

  async function get(): Promise<string> {
    if (cachedToken && Date.now() + SAFETY_MS < expiresAtMs) return cachedToken;
    return refresh();
  }

  return { get, refresh, isTokenManager: true };
}

function isTokenManager(value: unknown): value is TokenManager {
  return Boolean(
    value &&
    typeof value === "object" &&
    (value as { isTokenManager?: unknown }).isTokenManager === true
  );
}

/* --------------------------------------------------------------------------
 * apiFetch — generic Wild Apricot HTTP helper
 *
 * Handles:
 *   - Bearer auth (raw string token OR token manager that can refresh)
 *   - 429 with exponential backoff that honors Retry-After
 *   - 401 → token refresh + retry (when a manager is provided)
 *   - Generic 5xx + 408 transient retries with exponential backoff
 *   - 4xx fast-fail (except 401/408 which fall through to retries)
 *   - 204 no-content
 *   - Sometimes-XML responses (audit log on some accounts)
 * -------------------------------------------------------------------------- */

/** Tunables for {@link apiFetch} and {@link apiGet}. */
export interface ApiFetchOptions {
  /** HTTP method when not using default GET semantics; usually omitted. */
  method?: string;
  /** Attempts after transient/network-style failures (separate from 429 / 401 budgets). Default 3. */
  retries?: number;
  /** Dedicated 429 budget with exponential backoff and `Retry-After`. Default 8. */
  rateLimitRetries?: number;
  /** Cap on seconds waited between 429 backoff rounds. Default 300. */
  maxBackoffSeconds?: number;
  /** Bearer refresh retries on HTTP 401 when a {@link TokenManager} is supplied. Default 2. */
  authRefreshRetries?: number;
  signal?: AbortSignal;
  logger?: Logger;
}

interface ApiError extends Error {
  status?: number;
}

/**
 * Authenticated HTTP helper for arbitrary Wild Apricot REST URLs (JSON by default).
 * Handles bearer auth from a raw string or {@link TokenManager}, exponential 429 backoff
 * honoring `Retry-After`, reactive 401 refresh with a manager, and generic transient retries.
 *
 * Prefer {@link apiGet} when issuing simple GET requests.
 */
export async function apiFetch(
  url: string,
  tokenOrManager: string | TokenManager,
  options: ApiFetchOptions = {}
): Promise<unknown> {
  const {
    method = "GET",
    retries = 3,
    rateLimitRetries = 8,
    maxBackoffSeconds = 300,
    authRefreshRetries = 2,
    signal,
    logger,
  } = options;

  const log = resolveLogger(logger);
  const manager = isTokenManager(tokenOrManager) ? tokenOrManager : null;

  let attempt = 0;
  let rateLimitAttempt = 0;
  let authRefreshAttempt = 0;
  let lastErr: unknown;

  while (true) {
    throwIfAborted(signal);
    try {
      const token = manager ? await manager.get() : tokenOrManager;
      const response = await fetch(url, {
        method,
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/json",
        },
        signal,
      });

      // Handle rate limiting with exponential backoff (separate counter from
      // generic retries so a 429 storm doesn't get mixed up with 5xx flakiness).
      if (response.status === 429) {
        rateLimitAttempt++;
        if (rateLimitAttempt > rateLimitRetries) {
          const err: ApiError = new Error(
            `Rate limited (429) — gave up after ${rateLimitRetries} retries\nURL: ${url}`
          );
          err.status = 429;
          throw err;
        }
        const headerSeconds = parseInt(response.headers.get("Retry-After") || "0", 10);
        // 10s, 20s, 40s, 80s, 160s, then capped at maxBackoffSeconds
        const backoff = Math.min(10 * Math.pow(2, rateLimitAttempt - 1), maxBackoffSeconds);
        const waitSeconds = Math.max(headerSeconds, backoff);
        log.warn(
          `  [429] rate limited (${rateLimitAttempt}/${rateLimitRetries}) — waiting ${waitSeconds}s`
        );
        await sleep(waitSeconds * 1000, signal);
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
          const err: ApiError = new Error(
            `${method} 401 Unauthorized after ${authRefreshRetries} token refresh(es)\nURL: ${url}\n${body.slice(0, 500)}`
          );
          err.status = 401;
          throw err;
        }
        // Drain body so the connection is freed.
        try {
          await response.text();
        } catch {
          /* ignore */
        }
        log.warn(
          `  [401] access token rejected — refreshing token and retrying (${authRefreshAttempt}/${authRefreshRetries})`
        );
        try {
          await manager.refresh();
        } catch (refreshErr) {
          const message = refreshErr instanceof Error ? refreshErr.message : String(refreshErr);
          const err: ApiError = new Error(`Failed to refresh access token after 401: ${message}`);
          err.status = 401;
          throw err;
        }
        continue;
      }

      if (!response.ok) {
        const body = await response.text();
        const err: ApiError = new Error(
          `${method} ${response.status} ${response.statusText}\nURL: ${url}\n${body.slice(0, 500)}`
        );
        err.status = response.status;
        // Retry vs fast-fail for 4xx/5xx is decided in the catch block below.
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
      // Abort errors propagate immediately, don't retry.
      if (err instanceof Error && err.name === "AbortError") throw err;
      lastErr = err;
      const apiErr = err as ApiError;
      // Don't retry permanent client errors. 408 is treated as transient
      // (matches the throw logic above). 401 only reaches this path when
      // the caller passed a raw string token (no manager) — retry it as
      // before, even though the same token will probably keep failing.
      const isTransient4xx = apiErr.status === 401 || apiErr.status === 408;
      if (apiErr.status && apiErr.status >= 400 && apiErr.status < 500 && !isTransient4xx) {
        throw err;
      }
      attempt++;
      if (attempt > retries) break;
      const delay = 1000 * Math.pow(2, attempt - 1);
      const msg = err instanceof Error ? err.message.split("\n")[0] : String(err);
      log.warn(`  [retry ${attempt}/${retries}] ${msg} — waiting ${delay}ms`);
      await sleep(delay, signal);
    }
  }
  if (lastErr) throw lastErr;
  throw new Error(`apiFetch failed without a captured error: ${url}`);
}

/** Same as {@link apiFetch} with `method: "GET"` (default). */
export async function apiGet(
  url: string,
  tokenOrManager: string | TokenManager,
  options: ApiFetchOptions = {}
): Promise<unknown> {
  return apiFetch(url, tokenOrManager, options);
}

/* --------------------------------------------------------------------------
 * Account discovery & helpers
 * -------------------------------------------------------------------------- */

/**
 * Returns the caller's Wild Apricot account id via `GET .../accounts` when omitted from options.
 * Uses the first account in the listing (typical single-org API keys).
 */
export async function discoverAccountId(
  tokenOrManager: string | TokenManager,
  options: { signal?: AbortSignal; logger?: Logger } = {}
): Promise<string | number> {
  const data = (await apiGet(`${API_BASE}/accounts`, tokenOrManager, options)) as
    | unknown[]
    | { Accounts?: unknown[]; accounts?: unknown[]; Items?: unknown[]; items?: unknown[] };
  const accounts = Array.isArray(data)
    ? data
    : data?.Accounts || data?.accounts || data?.Items || data?.items || [];
  if (!accounts.length) {
    throw new Error(`No accounts found:\n${JSON.stringify(data, null, 2)}`);
  }
  const a = accounts[0] as Record<string, unknown>;
  const id = (a.Id ?? a.id ?? a.AccountId ?? a.accountId) as string | number | undefined;
  if (!id) {
    throw new Error(`Could not discover account ID:\n${JSON.stringify(a, null, 2)}`);
  }
  return id;
}

export function extractItems(data: unknown, hint?: string): unknown[] {
  if (Array.isArray(data)) return data;
  if (data && typeof data === "object") {
    const obj = data as Record<string, unknown>;
    if (hint && Array.isArray(obj[hint])) return obj[hint] as unknown[];
    return (
      (obj.Items as unknown[]) ||
      (obj.items as unknown[]) ||
      (obj.Contacts as unknown[]) ||
      (obj.Events as unknown[]) ||
      (obj.Invoices as unknown[]) ||
      (obj.Payments as unknown[]) ||
      (obj.Donations as unknown[]) ||
      (obj.Registrations as unknown[]) ||
      (obj.AuditLogItems as unknown[]) ||
      []
    );
  }
  return [];
}

/* --------------------------------------------------------------------------
 * Pagination & async query helpers
 * -------------------------------------------------------------------------- */

/** Controls page size (`$top`) search params and logging for {@link paginate}. */
export interface PaginateOptions {
  /** `$top` page size (default 100). */
  top?: number;
  /** Static query-string parameters merged before `$top`/`$skip` are applied. */
  params?: Record<string, string>;
  signal?: AbortSignal;
  logger?: Logger;
}

/**
 * Page through a collection URL using OData-style `$skip`/`$top` until a short page arrives.
 */
export async function paginate(
  baseUrl: string,
  tokenOrManager: string | TokenManager,
  options: PaginateOptions = {}
): Promise<unknown[]> {
  const { top = 100, params = {}, signal, logger } = options;
  const log = resolveLogger(logger);
  const all: unknown[] = [];
  let skip = 0;
  while (true) {
    throwIfAborted(signal);
    const url = new URL(baseUrl);
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
    url.searchParams.set("$top", String(top));
    url.searchParams.set("$skip", String(skip));
    log.progress?.(`  fetching skip=${skip}... `);
    const data = await apiGet(url.toString(), tokenOrManager, { signal, logger });
    PaginatedResponseSchema.parse(data); // shape sanity check
    const items = extractItems(data);
    log.info(`${items.length} items`);
    all.push(...items);
    if (items.length < top) break;
    skip += top;
  }
  return all;
}

/**
 * Executes a Wild Apricot **async** query: starts `baseUrl` with `params`,
 * optionally polls with `resultId` until `State === "Complete"` (2s cadence),
 * otherwise returns synchronous payloads unchanged.
 *
 * Throws if polling exceeds ~4 minutes without completion.
 */
export async function asyncQuery(
  baseUrl: string,
  tokenOrManager: string | TokenManager,
  params: Record<string, string> = {},
  options: { signal?: AbortSignal; logger?: Logger } = {}
): Promise<unknown> {
  const { signal, logger } = options;
  const log = resolveLogger(logger);
  const url = new URL(baseUrl);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);

  log.info(`  starting async query: ${url.toString()}`);
  const initial = (await apiGet(url.toString(), tokenOrManager, {
    signal,
    logger,
  })) as Record<string, unknown> | unknown[];

  // If the response already includes the data inline, just return it.
  if (Array.isArray(initial)) return initial;
  if (initial && typeof initial === "object") {
    if ((initial as { Items?: unknown }).Items) return initial;
    if ((initial as { Contacts?: unknown }).Contacts) return initial;
  }

  const initialObj = (initial as Record<string, unknown>) || {};
  const resultId =
    (initialObj.ResultId as string | number | undefined) ??
    (initialObj.resultId as string | number | undefined) ??
    null;

  if (!resultId) {
    // Some accounts return data directly; if no resultId & no items, return whatever we got.
    return initial;
  }

  const pollUrl = new URL(baseUrl);
  pollUrl.searchParams.set("resultId", String(resultId));

  for (let i = 0; i < 120; i++) {
    throwIfAborted(signal);
    await sleep(2000, signal);
    const poll = (await apiGet(pollUrl.toString(), tokenOrManager, {
      signal,
      logger,
    })) as Record<string, unknown>;
    if (poll && poll.State && poll.State !== "Complete") {
      log.info(`  state: ${String(poll.State)}`);
      continue;
    }
    return poll;
  }
  throw new Error(`Async query timed out after 4 minutes: ${baseUrl}`);
}

/* --------------------------------------------------------------------------
 * Filesystem & CSV helpers
 * -------------------------------------------------------------------------- */

export function ensureDir(dir: string): void {
  fs.mkdirSync(dir, { recursive: true });
}

export function csvEscape(value: unknown): string {
  if (value === null || value === undefined) return "";
  const str = typeof value === "object" ? JSON.stringify(value) : String(value);
  if (/[",\n\r]/.test(str)) return `"${str.replace(/"/g, '""')}"`;
  return str;
}

export function getNested(obj: unknown, paths: string[]): unknown {
  for (const p of paths) {
    const parts = p.split(".");
    let cur: unknown = obj;
    for (const part of parts) {
      if (cur == null) break;
      cur = (cur as Record<string, unknown>)[part];
    }
    if (cur !== undefined && cur !== null && cur !== "") return cur;
  }
  return "";
}

export function writeCsv(
  rows: Record<string, unknown>[],
  columns: string[],
  filePath: string
): void {
  const lines = [
    columns.join(","),
    ...rows.map((row) => columns.map((c) => csvEscape(row[c])).join(",")),
  ];
  fs.writeFileSync(filePath, lines.join("\n"), "utf8");
}

export function writeJson(data: unknown, filePath: string): void {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf8");
}

/* --------------------------------------------------------------------------
 * Library-friendly auth bootstrap
 *
 * Takes an explicit `apiKey` (and optional `accountId`) instead of reading
 * process.env, and throws on missing inputs rather than calling
 * process.exit. CLI shims read .env and pass values in.
 * -------------------------------------------------------------------------- */

/** Inputs accepted by {@link getAuthAndAccount}. */
export interface GetAuthAndAccountOptions {
  /** Wild Apricot authorized-application API key. */
  apiKey: string;
  /** When omitted, discovered via {@link discoverAccountId}. */
  accountId?: string | number;
  signal?: AbortSignal;
  logger?: Logger;
}

/** Creates a cached {@link TokenManager}, primes a bearer snapshot, resolves `accountId` when omitted. */
export async function getAuthAndAccount(opts: GetAuthAndAccountOptions): Promise<AuthAndAccount> {
  if (!opts || !opts.apiKey) {
    throw new Error(
      "Missing apiKey — pass opts.apiKey or set WILD_APRICOT_API_KEY in your CLI shim."
    );
  }
  const log = resolveLogger(opts.logger);
  const tokenManager = createTokenManager(opts.apiKey, { signal: opts.signal });
  // Prime the manager so any caller using the legacy `token` snapshot
  // gets a real access token without an extra round-trip.
  const token = await tokenManager.get();
  let accountId = opts.accountId;
  if (!accountId) {
    log.info("Discovering account ID...");
    accountId = await discoverAccountId(tokenManager, {
      signal: opts.signal,
      logger: opts.logger,
    });
    log.info(`Using account ID: ${accountId}`);
  }
  return { token, tokenManager, accountId };
}
