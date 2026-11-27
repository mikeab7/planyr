/* Planyr MCP — JSON-RPC 2.0 transport over stateless Streamable HTTP (B671; per-person OAuth 2026-11-27).
 *
 * WHO IS ASKING (decided here and nowhere else; _tools.js reads only ctx.userId):
 *   POST /api/mcp  + `Authorization: Bearer pmcp_at_…`  → "Connect to Claude": the token is checked LIVE on every
 *       call (public.mcp_oauth_check), so Disconnect, a password change or a deleted account stops the very next
 *       call. The reads then run as that person under row-level security (server/mcp/db/mcp_oauth.sql).
 *       No or bad token → 401 with WWW-Authenticate pointing at /.well-known/oauth-protected-resource/api/mcp,
 *       which is how an MCP client discovers Planyr's OAuth server.
 *   POST /api/mcp/<PLANYR_MCP_TOKEN>  (or that secret as the bearer) → LEGACY owner-only capability URL, pinned to
 *       PLANYR_MCP_OWNER_ID, same read path as everyone else. A wrong path token is still a plain 404. To be removed
 *       once the owner has reconnected through OAuth (OWNER-TODO).
 *
 * Transport contract (minimal, spec-legal for a stateless JSON-only server):
 *   POST  JSON-RPC message (or 2025-03-26 batch array) → application/json response
 *   GET   → 405 Allow: POST (no server-initiated SSE stream offered)
 *   DELETE → 405 (no sessions to terminate)
 *   notifications (any message without an id) → 202 empty body
 * Tool failures are result.isError content — never protocol errors, never 500s.
 */
import { safeEqual } from "../lib/safeEqual.js";
import { TOOLS, callTool, InvalidParams } from "./_tools.js";
import { json } from "../lib/http.js";
import { rpc, wwwAuthenticate } from "../oauth/_lib.js";

const SUPPORTED_VERSIONS = ["2025-03-26", "2025-06-18"];
const LATEST_VERSION = "2025-06-18";

const rpcResult = (id, result) => ({ jsonrpc: "2.0", id, result });
const rpcError = (id, code, message) => ({ jsonrpc: "2.0", id: id ?? null, error: { code, message } });

async function dispatchOne(env, msg, ctx) {
  if (!msg || typeof msg !== "object" || typeof msg.method !== "string") {
    return rpcError(msg?.id, -32600, "invalid request: not a JSON-RPC message");
  }
  if (msg.id == null) return null; // notification (initialized, cancelled, …) — acknowledged, never answered
  try {
    switch (msg.method) {
      case "initialize": {
        const asked = msg.params?.protocolVersion;
        return rpcResult(msg.id, {
          protocolVersion: SUPPORTED_VERSIONS.includes(asked) ? asked : LATEST_VERSION,
          capabilities: { tools: {} },
          serverInfo: { name: "planyr-mcp", version: "1.0.0" },
        });
      }
      case "ping":
        return rpcResult(msg.id, {});
      case "tools/list":
        return rpcResult(msg.id, { tools: TOOLS.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })) });
      case "tools/call":
        return rpcResult(msg.id, await callTool(env, msg.params, ctx));
      default:
        return rpcError(msg.id, -32601, `method not found: ${msg.method}`);
    }
  } catch (e) {
    if (e instanceof InvalidParams) return rpcError(msg.id, -32602, e.message);
    // Unexpected throw outside a tool handler — still a visible JSON-RPC error, not a 500.
    return rpcError(msg.id, -32603, `internal error: ${e?.message || String(e)}`);
  }
}

const notFound = () => new Response("Not found", { status: 404 });

function unauthorized(request, error) {
  let origin = "https://planyr.io";
  try { origin = new URL(request.url).origin; } catch (_) { /* keep the default */ }
  return new Response(JSON.stringify({ error: error || "invalid_request", error_description: "Connect this assistant to Planyr first." }), {
    status: 401,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "www-authenticate": wwwAuthenticate(origin, error) },
  });
}

const isLegacy = async (env, tok) => !!(env?.PLANYR_MCP_TOKEN && env?.PLANYR_MCP_OWNER_ID && tok && (await safeEqual(tok, env.PLANYR_MCP_TOKEN)));

/* Who is asking: { ctx } or { response } (401/404/503). Exported for tests. */
export async function resolveCaller({ env, request, segs, fetchImpl = fetch }) {
  if (Array.isArray(segs) && segs.length > 1) return { response: notFound() };
  const pathTok = Array.isArray(segs) && segs.length === 1 ? segs[0] : null;
  if (pathTok) {
    // Legacy capability URL: identical 404 for wrong / unset, before revealing anything.
    return (await isLegacy(env, pathTok)) ? { ctx: { userId: env.PLANYR_MCP_OWNER_ID, via: "legacy" } } : { response: notFound() };
  }
  const tok = /^Bearer\s+(.+)$/i.exec(request?.headers?.get?.("authorization") || "")?.[1]?.trim() || "";
  if (!tok) return { response: unauthorized(request) };
  if (tok.startsWith("pmcp_at_")) {
    let out;
    try { out = await rpc(env, "mcp_oauth_check", { p_access: tok }, fetchImpl); }
    catch (e) {
      console.log(JSON.stringify({ evt: "mcp-check", ok: false, error: String(e?.message || e).slice(0, 200) }));
      return { response: json({ error: "temporarily_unavailable" }, 503) };
    }
    if (!out?.ok || typeof out.user_id !== "string") return { response: unauthorized(request, "invalid_token") };
    return { ctx: { userId: out.user_id, grantId: out.grant_id, via: "oauth" } };
  }
  if (await isLegacy(env, tok)) return { ctx: { userId: env.PLANYR_MCP_OWNER_ID, via: "legacy" } };
  return { response: unauthorized(request, "invalid_token") };
}

export async function handleMcp({ env, request, method, segs, fetchImpl = fetch }) {
  const who = await resolveCaller({ env, request, segs, fetchImpl });
  if (who.response) return who.response;
  const ctx = who.ctx;

  if (method !== "POST") {
    return new Response("Method not allowed", { status: 405, headers: { allow: "POST" } });
  }

  let body;
  try { body = await request.json(); }
  catch (_) { return json(rpcError(null, -32700, "parse error: body is not valid JSON")); }

  if (Array.isArray(body)) { // 2025-03-26 allowed batching; cheap to honour
    if (!body.length) return json(rpcError(null, -32600, "invalid request: empty batch"));
    const answers = (await Promise.all(body.map((m) => dispatchOne(env, m, ctx)))).filter(Boolean);
    return answers.length ? json(answers) : new Response(null, { status: 202 });
  }

  const answer = await dispatchOne(env, body, ctx);
  return answer ? json(answer) : new Response(null, { status: 202 });
}
