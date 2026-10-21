import { getEnv } from "./env.js";

interface TokenCache {
  token: string;
  expiresAt: number;
  scope: string;
}

let cache: TokenCache | null = null;
let inflight: Promise<TokenCache> | null = null;

const REFRESH_SKEW_MS = 5 * 60 * 1000;

interface TokenResponse {
  access_token?: string;
  scope?: string;
  expires_in?: number;
  error?: string;
  error_description?: string;
}

async function requestToken(): Promise<TokenCache> {
  const env = getEnv();
  const url = `https://${env.SHOPIFY_STORE_DOMAIN}/admin/oauth/access_token`;

  const body = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: env.SHOPIFY_CLIENT_ID,
    client_secret: env.SHOPIFY_CLIENT_SECRET,
  });

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });

  let json: TokenResponse;
  try {
    json = (await res.json()) as TokenResponse;
  } catch {
    throw new Error(`Shopify token exchange failed: HTTP ${res.status}`);
  }

  if (!res.ok || !json.access_token) {
    const detail =
      json.error_description ?? json.error ?? `HTTP ${res.status}`;
    throw new Error(`Shopify token exchange failed: ${detail}`);
  }

  const expiresInSec =
    typeof json.expires_in === "number" && json.expires_in > 0
      ? json.expires_in
      : 24 * 60 * 60;

  return {
    token: json.access_token,
    expiresAt: Date.now() + expiresInSec * 1000,
    scope: json.scope ?? "",
  };
}

function isFresh(entry: TokenCache): boolean {
  return Date.now() <= entry.expiresAt - REFRESH_SKEW_MS;
}

async function refreshToken(): Promise<TokenCache> {
  if (inflight) return inflight;
  inflight = requestToken()
    .then((entry) => {
      cache = entry;
      return entry;
    })
    .finally(() => {
      inflight = null;
    });
  return inflight;
}

export async function getAccessToken(): Promise<string> {
  if (cache && isFresh(cache)) return cache.token;
  const entry = await refreshToken();
  return entry.token;
}

export async function forceRefreshToken(): Promise<string> {
  cache = null;
  const entry = await refreshToken();
  return entry.token;
}

export async function getTokenMeta(): Promise<{
  ok: boolean;
  scope: string[];
  expiresInMs: number | null;
  error?: string;
}> {
  try {
    await getAccessToken();
    return {
      ok: true,
      scope: (cache?.scope ?? "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
      expiresInMs: cache ? Math.max(0, cache.expiresAt - Date.now()) : null,
    };
  } catch (err) {
    return {
      ok: false,
      scope: [],
      expiresInMs: null,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
