/* Google OAuth token helper (B207 Drive wiring).
 *
 * Pure-ish: all network goes through an injectable `fetchImpl` (defaults to global fetch),
 * so the logic is unit-tested without hitting Google. Three jobs:
 *   - buildConsentUrl(): the URL the owner visits once to approve Drive access.
 *   - exchangeCodeForTokens(): callback turns the one-time `code` into a refresh token.
 *   - accessTokenFromRefresh(): the backend swaps the long-lived refresh token for a
 *     short-lived access token on each (cached) use.
 * Returns result-shaped objects ({ ok, ... } / { ok:false, error }) — never throws on an
 * API error — matching the storage adapter's no-silent-failure contract (B209).
 *
 * Secrets (client secret, refresh token) are passed in from server env by the caller;
 * none are stored here.
 */
import { googleRedirectUri } from "./config.js";

const AUTH_BASE = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
export const DRIVE_FILE_SCOPE = "https://www.googleapis.com/auth/drive.file";

// The consent URL. access_type=offline + prompt=consent guarantee a refresh token is
// issued (the one value we need to persist server-side).
export function buildConsentUrl({ clientId, origin, scope = DRIVE_FILE_SCOPE, state } = {}) {
  const p = new URLSearchParams({
    client_id: clientId || "",
    redirect_uri: googleRedirectUri(origin),
    response_type: "code",
    scope,
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "true",
  });
  if (state) p.set("state", state);
  return `${AUTH_BASE}?${p.toString()}`;
}

async function postToken(body, fetchImpl) {
  const res = await fetchImpl(TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  let data = {};
  try { data = await res.json(); } catch (_) { /* non-JSON error body */ }
  if (!res.ok) return { ok: false, error: data.error_description || data.error || `Google token endpoint ${res.status}` };
  return { ok: true, data };
}

// One-time: exchange the callback `code` for tokens. The refresh_token is what gets stored
// in GOOGLE_REFRESH_TOKEN; it's only returned on the first consent (hence prompt=consent).
export async function exchangeCodeForTokens({ code, clientId, clientSecret, origin, fetchImpl = fetch } = {}) {
  if (!code) return { ok: false, error: "Missing authorization code." };
  const r = await postToken(new URLSearchParams({
    code, client_id: clientId || "", client_secret: clientSecret || "",
    redirect_uri: googleRedirectUri(origin), grant_type: "authorization_code",
  }), fetchImpl);
  if (!r.ok) return r;
  return { ok: true, refreshToken: r.data.refresh_token || null, accessToken: r.data.access_token || null, expiresIn: r.data.expires_in || 0 };
}

// Per-use: turn the stored refresh token into a short-lived access token.
export async function accessTokenFromRefresh({ refreshToken, clientId, clientSecret, fetchImpl = fetch } = {}) {
  if (!refreshToken) return { ok: false, error: "Missing refresh token." };
  const r = await postToken(new URLSearchParams({
    refresh_token: refreshToken, client_id: clientId || "", client_secret: clientSecret || "", grant_type: "refresh_token",
  }), fetchImpl);
  if (!r.ok) return r;
  return { ok: true, accessToken: r.data.access_token || null, expiresIn: r.data.expires_in || 0 };
}

/* A cached access-token getter: refreshes only when the current token is within 60s of
 * expiry, so the Drive client can call it freely. Returns async () => accessToken (throws
 * a clear error if refresh fails, which the adapter's attempt() turns into a visible op
 * failure). */
export function makeTokenProvider({ refreshToken, clientId, clientSecret, fetchImpl = fetch, now = () => Date.now() } = {}) {
  let token = null;
  let expiresAt = 0;
  return async () => {
    if (token && now() < expiresAt - 60_000) return token;
    const r = await accessTokenFromRefresh({ refreshToken, clientId, clientSecret, fetchImpl });
    if (!r.ok) throw new Error(r.error);
    token = r.accessToken;
    expiresAt = now() + (r.expiresIn || 3600) * 1000;
    return token;
  };
}
