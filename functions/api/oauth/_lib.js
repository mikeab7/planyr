/* "Connect to Claude" — the OAuth 2.1 pieces Planyr's MCP connector needs (AI agent access, part 2, 2026-11-27).
 * Not routed (no onRequest* export). The routes are:
 *   POST /api/oauth/register                 dynamic client registration (RFC 7591), redirect allow-list
 *   GET  /oauth/authorize                    validates, stores the request server-side, sends the browser to the
 *                                            Allow page #/connect/<id>; a bad client or redirect gets an error PAGE,
 *                                            never a redirect (RFC 6749 4.1.2.1)
 *   POST /api/oauth/token                    authorization_code (PKCE S256 only) and refresh_token
 *   GET  /.well-known/oauth-protected-resource[/api/mcp], /.well-known/oauth-authorization-server   metadata
 * Every database step is a server-only function in server/mcp/db/mcp_oauth.sql, called with the service-role key
 * (server-side only). Tokens are opaque (`pmcp_at_…`, `pmcp_rt_…`), stored only as hashes, and mean nothing to
 * PostgREST, Storage or any other /api route, which all verify a real Supabase session JWT. */
import { serviceHeaders } from "../lib/http.js";

export const SCOPE = "planyr.read";
export const ACCESS_TOKEN_SECONDS = 3600;
export const MCP_PATH = "/api/mcp";

/* The redirect allow-list (the database enforces the same list again). claude.ai and claude.com callbacks exactly,
 * or loopback http for desktop and command-line clients (RFC 8252 7.3). Nothing else may register. */
const EXACT_REDIRECTS = new Set(["https://claude.ai/api/mcp/auth_callback", "https://claude.com/api/mcp/auth_callback"]);
const LOOPBACK_RE = /^http:\/\/(localhost|127\.0\.0\.1)(:[0-9]{1,5})?(\/[A-Za-z0-9._~/-]*)?$/;
export const redirectAllowed = (u) => typeof u === "string" && (EXACT_REDIRECTS.has(u) || LOOPBACK_RE.test(u));

export const VERIFIER_RE = /^[A-Za-z0-9._~-]{43,128}$/;
export const CHALLENGE_RE = /^[A-Za-z0-9_-]{43}$/;

const b64url = (bytes) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
/* BASE64URL(SHA256(ASCII(code_verifier))) — RFC 7636 4.6. */
export async function s256(verifier) {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(String(verifier)));
  return b64url(new Uint8Array(d));
}

export const NO_STORE = { "cache-control": "no-store", pragma: "no-cache" };
/* The token and registration endpoints carry no cookies and no ambient authority, so any origin may call them
 * (browser-based MCP clients need this). The Allow page is the only place a person's session is used. */
export const CORS = { "access-control-allow-origin": "*", "access-control-allow-methods": "POST, OPTIONS", "access-control-allow-headers": "content-type, authorization" };
export const jsonReply = (obj, status = 200, extra = {}) =>
  new Response(JSON.stringify(obj), { status, headers: { "content-type": "application/json; charset=utf-8", ...NO_STORE, ...CORS, ...extra } });
export const preflight = () => new Response(null, { status: 204, headers: { ...CORS, "access-control-max-age": "86400" } });

export function requireConfig(env) {
  if (!env?.SUPABASE_URL || !env?.SUPABASE_SERVICE_ROLE_KEY) throw new Error("not configured: SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY");
}

/* One server-only database function, by name. Throws on a transport/HTTP failure (LOUD-FAILURE: the caller turns it
 * into a visible 5xx/error page, never a silent success). */
export async function rpc(env, fn, args, fetchImpl = fetch) {
  requireConfig(env);
  const r = await fetchImpl(`${env.SUPABASE_URL.replace(/\/+$/, "")}/rest/v1/rpc/${fn}`, {
    method: "POST",
    headers: serviceHeaders(env.SUPABASE_SERVICE_ROLE_KEY, { "content-type": "application/json" }),
    body: JSON.stringify(args),
  });
  if (!r.ok) throw new Error(`Supabase ${fn} failed: ${r.status} ${(await r.text().catch(() => "")).slice(0, 300)}`);
  return r.json();
}

/* application/x-www-form-urlencoded (what OAuth clients send) or JSON. Returns a plain object of strings. */
export async function readParams(request) {
  const type = (request.headers.get("content-type") || "").toLowerCase();
  try {
    if (type.includes("application/json")) {
      const o = await request.json();
      return o && typeof o === "object" ? o : {};
    }
    return Object.fromEntries(new URLSearchParams(await request.text()));
  } catch (_) {
    return {};
  }
}

export const originOf = (request) => new URL(request.url).origin;

export const protectedResourceMetadata = (origin) => ({
  resource: origin + MCP_PATH,
  authorization_servers: [origin],
  scopes_supported: [SCOPE],
  bearer_methods_supported: ["header"],
  resource_name: "Planyr (read only)",
  resource_documentation: origin + "/llms.txt",
});

export const authorizationServerMetadata = (origin) => ({
  issuer: origin,
  authorization_endpoint: origin + "/oauth/authorize",
  token_endpoint: origin + "/api/oauth/token",
  registration_endpoint: origin + "/api/oauth/register",
  response_types_supported: ["code"],
  grant_types_supported: ["authorization_code", "refresh_token"],
  code_challenge_methods_supported: ["S256"],
  token_endpoint_auth_methods_supported: ["none"],
  scopes_supported: [SCOPE],
  service_documentation: origin + "/llms.txt",
});

export const wwwAuthenticate = (origin, error) =>
  `Bearer realm="planyr", resource_metadata="${origin}/.well-known/oauth-protected-resource${MCP_PATH}"` +
  (error ? `, error="${error}"` : "");
