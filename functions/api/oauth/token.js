/* POST /api/oauth/token — authorization_code (PKCE S256 required) and refresh_token for "Connect to Claude".
 * See ./_lib.js. Every failure is RFC 6749 5.2 JSON (`invalid_grant` etc.), never a redirect. A code is spent on ANY
 * attempt; a reused code or refresh token revokes the whole grant (server/mcp/db/mcp_oauth.sql). */
import { jsonReply, preflight, readParams, rpc, s256, VERIFIER_RE } from "./_lib.js";

const bad = (error, description, status = 400) => jsonReply({ error, ...(description ? { error_description: description } : {}) }, status);

export async function handleToken({ env, request, fetchImpl = fetch }) {
  if (request.method === "OPTIONS") return preflight();
  if (request.method !== "POST") return bad("invalid_request", "POST only", 405);
  const p = await readParams(request);
  const clientId = typeof p.client_id === "string" ? p.client_id : "";
  if (!clientId) return bad("invalid_client", "client_id is required (public client).", 401);
  try {
    if (p.grant_type === "authorization_code") {
      if (typeof p.code !== "string" || !p.code) return bad("invalid_request", "code is required.");
      if (typeof p.redirect_uri !== "string" || !p.redirect_uri) return bad("invalid_request", "redirect_uri is required.");
      if (typeof p.code_verifier !== "string" || !VERIFIER_RE.test(p.code_verifier)) return bad("invalid_grant", "code_verifier is missing or malformed.");
      const out = await rpc(env, "mcp_oauth_exchange", {
        p_code: p.code, p_client_id: clientId, p_redirect_uri: p.redirect_uri, p_verifier_challenge: await s256(p.code_verifier),
      }, fetchImpl);
      return out?.ok ? jsonReply(tokenBody(out)) : bad(out?.error || "invalid_grant");
    }
    if (p.grant_type === "refresh_token") {
      if (typeof p.refresh_token !== "string" || !p.refresh_token) return bad("invalid_request", "refresh_token is required.");
      const out = await rpc(env, "mcp_oauth_refresh", { p_refresh: p.refresh_token, p_client_id: clientId }, fetchImpl);
      return out?.ok ? jsonReply(tokenBody(out)) : bad(out?.error || "invalid_grant");
    }
    return bad("unsupported_grant_type");
  } catch (e) {
    console.log(JSON.stringify({ evt: "mcp-token", ok: false, error: String(e?.message || e).slice(0, 200) }));
    return bad("temporarily_unavailable", null, 503);
  }
}
const tokenBody = (o) => ({ access_token: o.access_token, token_type: "Bearer", expires_in: o.expires_in, refresh_token: o.refresh_token, scope: o.scope });

export const onRequest = (context) => handleToken({ env: context.env, request: context.request });
