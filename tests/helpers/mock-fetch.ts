import { vi, type Mock } from "vitest";

import { API_BASE } from "../../src/wa-api";

export const TOKEN_URL = "https://oauth.wildapricot.org/auth/token";

export type FetchHandler = (url: string, init?: RequestInit) => Response | Promise<Response>;

export function jsonResponse(
  data: unknown,
  status = 200,
  headers: Record<string, string> = {}
): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });
}

export function textResponse(
  body: string,
  status = 200,
  headers: Record<string, string> = {}
): Response {
  return new Response(body, { status, headers });
}

/** Wrap a handler with default OAuth token + account discovery responses. */
export function withAuthDefaults(
  handler: FetchHandler,
  accountId: string | number = 123456
): FetchHandler {
  return async (url, init) => {
    if (url.includes("oauth.wildapricot.org/auth/token")) {
      return jsonResponse({ access_token: "test-token", expires_in: 1800 });
    }
    if (url === `${API_BASE}/accounts` || url.endsWith("/v2.2/accounts")) {
      return jsonResponse([{ Id: accountId }]);
    }
    return handler(url, init);
  };
}

export function installFetchMock(handler: FetchHandler): Mock {
  const mock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const response = await handler(url, init);
    return response;
  });
  vi.stubGlobal("fetch", mock);
  return mock;
}

export function restoreFetchMock(): void {
  vi.unstubAllGlobals();
}
