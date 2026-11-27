/* POST /api/oauth/register — dynamic client registration (RFC 7591) for "Connect to Claude". See ./_lib.js.
 * Only Claude's own callbacks and loopback addresses can register; a client's name is SELF-REPORTED, which is why the
 * Allow page and Settings both show the host a client sends you back to. Capped per IP (keyed hash) and per day. */
import { jsonReply, preflight, readParams, redirectAllowed, rpc } from "./_lib.js";
import { hmacKey } from "../auth/email-link.js";

export async function handleRegister({ env, request, fetchImpl = fetch }) {
  if (request.method === "OPTIONS") return preflight();
  if (request.method !== "POST") return jsonReply({ error: "invalid_request", error_description: "POST only" }, 405, { allow: "POST, OPTIONS" });
  const p = await readParams(request);
  const uris = p.redirect_uris;
  if (!Array.isArray(uris) || uris.length < 1 || uris.length > 5 || !uris.every(redirectAllowed)) {
    return jsonReply({ error: "invalid_redirect_uri", error_description: "Planyr accepts Claude's own callback addresses (claude.ai, claude.com) or a loopback address only." }, 400);
  }
  const auth = p.token_endpoint_auth_method;
  if (auth != null && auth !== "none") return jsonReply({ error: "invalid_client_metadata", error_description: "Public clients only (token_endpoint_auth_method none)." }, 400);
  const types = p.grant_types;
  if (types != null && (!Array.isArray(types) || !types.every((t) => t === "authorization_code" || t === "refresh_token"))) {
    return jsonReply({ error: "invalid_client_metadata", error_description: "grant_types may be authorization_code and refresh_token only." }, 400);
  }
  const name = typeof p.client_name === "string" ? p.client_name.replace(/[\u0000-\u001f\u007f<>]/g, "").trim().slice(0, 80) : "";
  let out;
  try {
    const ipHash = await hmacKey(env.SUPABASE_SERVICE_ROLE_KEY || "", "mcp-register-ip:" + (request.headers.get("cf-connecting-ip") || "unknown"));
    out = await rpc(env, "mcp_oauth_register", { p_name: name, p_redirect_uris: uris, p_ip_hash: ipHash }, fetchImpl);
  } catch (e) {
    console.log(JSON.stringify({ evt: "mcp-register", ok: false, error: String(e?.message || e).slice(0, 200) }));
    return jsonReply({ error: "temporarily_unavailable" }, 503);
  }
  if (!out?.ok) {
    if (out?.reason === "throttled") return jsonReply({ error: "temporarily_unavailable", error_description: "Too many registrations; try again later." }, 429, { "retry-after": "3600" });
    return jsonReply({ error: "invalid_redirect_uri" }, 400);
  }
  return jsonReply({
    client_id: out.client_id,
    client_id_issued_at: Math.floor(Date.now() / 1000),
    client_name: name || "Unnamed assistant",
    redirect_uris: uris,
    grant_types: ["authorization_code", "refresh_token"],
    response_types: ["code"],
    token_endpoint_auth_method: "none",
  }, 201);
}

export const onRequest = (context) => handleRegister({ env: context.env, request: context.request });
