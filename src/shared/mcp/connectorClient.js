/* "Connect to Claude" — the app's four calls (2026-11-27). Each is a POST through the signed-in person's own Supabase
 * client (their session token rides in the Authorization header, never a cookie), to a database function that acts
 * only on auth.uid()'s own rows (server/mcp/db/mcp_oauth.sql). Every call returns { ok, ... } and never throws:
 * a failure carries a plain message the screen shows (LOUD-FAILURE). */
import { supabase } from "../supabase/client.js";

const failed = (error) => ({ ok: false, reason: "error", message: String(error?.message || error || "Something went wrong.") });

async function call(fn, args) {
  if (!supabase) return { ok: false, reason: "error", message: "Planyr's cloud isn't configured here." };
  try {
    const { data, error } = await supabase.rpc(fn, args);
    if (error) return failed(error);
    return { ok: true, data };
  } catch (e) {
    return failed(e);
  }
}

/** What the Allow page shows: { ok, client_name, redirect_host, scope } or { ok:false, reason }. */
export async function connectRequestInfo(id) {
  const r = await call("mcp_oauth_request_info", { p_id: id });
  return r.ok ? r.data || { ok: false, reason: "missing" } : r;
}

/** Allow (true) or Cancel (false). On success: { ok, redirect_uri, state, code | error }. */
export async function decideConnect(id, allow) {
  const r = await call("mcp_oauth_decide", { p_id: id, p_allow: !!allow });
  return r.ok ? r.data || { ok: false, reason: "missing" } : r;
}

/** Settings → AI assistants: the person's live connections (never a token). */
export async function listMyAssistants() {
  const r = await call("mcp_oauth_my_grants", {});
  return r.ok ? { ok: true, grants: Array.isArray(r.data) ? r.data : [] } : r;
}

export async function disconnectAssistant(id) {
  const r = await call("mcp_oauth_revoke_my_grant", { p_id: id });
  if (!r.ok) return r;
  return r.data === true ? { ok: true } : { ok: false, reason: "missing", message: "That connection was already gone." };
}

export async function disconnectAllAssistants() {
  const r = await call("mcp_oauth_revoke_all_my_grants", {});
  return r.ok ? { ok: true, count: Number(r.data) || 0 } : r;
}

/** Where the browser goes after Allow / Cancel. Only ever the redirect the database returned for this request (an
 *  exact registered match); `iss` names Planyr (RFC 9207) so a client can tell which server answered. */
export function returnUrl({ redirect_uri, state, code, error }, issuer) {
  const u = new URL(redirect_uri);
  if (code) u.searchParams.set("code", code);
  if (error) u.searchParams.set("error", error);
  if (state != null && state !== "") u.searchParams.set("state", state);
  if (issuer) u.searchParams.set("iss", issuer);
  return u.toString();
}
