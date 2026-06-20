/* Google OAuth config — the SINGLE source of truth for the redirect (callback) URI.
 *
 * The redirect URI Google bounces the browser back to after the user approves Planyr's
 * Drive access MUST match, byte-for-byte, what's registered in the Google Cloud OAuth
 * client. Any difference (scheme, host, port, trailing slash, path) → the classic
 * `redirect_uri_mismatch` dead-end. So both sides read the value from HERE.
 *
 * Hosting decision (2026-06-19): the /server backend runs at the SAME ORIGIN as the app,
 * under `/api` (Cloudflare Pages Functions / Worker on the planyr.io domain). One domain,
 * no second host, no CORS, same-origin callback. Reversible — if hosting ever moves, edit
 * the authorized redirect URIs in the Google Cloud console and update this file together.
 *
 * Secrets (client id/secret, refresh token) are NOT here — they live in server env only
 * (see server/storage/README.md). This file holds only the non-secret callback path.
 */

// The one path the OAuth callback route is mounted at (same on every origin).
export const OAUTH_REDIRECT_PATH = "/api/auth/google/callback";

// Build the full redirect URI for an origin (e.g. "https://planyr.io"); trailing slash safe.
export const googleRedirectUri = (origin) =>
  `${String(origin || "").replace(/\/+$/, "")}${OAUTH_REDIRECT_PATH}`;

// The exact strings to register as "Authorized redirect URIs" in the Google OAuth client.
// Production is the one that matters for the live integration; the localhost one is only
// needed if/when the OAuth flow is exercised against a local backend.
export const PRODUCTION_REDIRECT_URI = googleRedirectUri("https://planyr.io");
export const DEV_REDIRECT_URI = googleRedirectUri("http://localhost:8788"); // Cloudflare Pages local dev default port

// All URIs to register (production first).
export const REGISTERED_REDIRECT_URIS = [PRODUCTION_REDIRECT_URI, DEV_REDIRECT_URI];
