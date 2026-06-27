/* /api/mcp — the Scheduler connector (MCP server) endpoint.
 *
 * Cloudflare Pages Function (thin wrapper, same-origin as the app). This is the door the Claude
 * you already pay for plugs into: add it once in claude.ai → Settings → Connectors (or point
 * Claude Desktop at it via `mcp-remote`). Through it, a normal chat — or any Project you attach
 * it to — can read your live Scheduler and drop *pending* suggestions you then Approve/Dismiss
 * in the Scheduler's Review panel. Claude never edits the schedule directly.
 *
 *   POST /api/mcp   body: a JSON-RPC message (MCP Streamable HTTP)   → JSON-RPC response
 *   GET  /api/mcp   → 200 health JSON (no server-initiated stream)
 *
 * Real logic + contract live in server/scheduler/* (unit-tested in Node); this only supplies the
 * config, live `fetch`, and the bearer-token gate. Dormant until SCHEDULER_* env is set → honest
 * 503, never open. (claude.ai's native connector OAuth is the production hardening — see
 * server/scheduler/README.md; the bearer token is what Claude Desktop testing uses.)
 */
import { schedulerConfig, schedulerConfigured } from "../../../server/scheduler/config.js";
import { handleMcp } from "../../../server/scheduler/mcpServer.js";
import { getSchedule, insertSuggestion } from "../../../server/scheduler/scheduleClient.js";

const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { "content-type": "application/json; charset=utf-8" } });

function authorized(request, cfg) {
  if (!cfg.connectorToken) return false; // no token configured → endpoint stays closed
  const got = (request.headers.get("authorization") || "").replace(/^Bearer\s+/i, "").trim();
  return got && got === cfg.connectorToken;
}

export async function onRequestGet(context) {
  const cfg = schedulerConfig(context.env);
  return json({ ok: true, service: "planyr-scheduler-mcp", configured: schedulerConfigured(cfg), transport: "streamable-http", note: "POST JSON-RPC messages here." });
}

export async function onRequestPost(context) {
  const { env, request } = context;
  const cfg = schedulerConfig(env);

  if (!schedulerConfigured(cfg))
    return json({ jsonrpc: "2.0", id: null, error: { code: -32000, message: "Scheduler connector isn't enabled yet (SCHEDULER_SUPABASE_* unset)." } }, 503);

  if (!authorized(request, cfg))
    return json({ jsonrpc: "2.0", id: null, error: { code: -32001, message: "Unauthorized — missing or wrong connector token." } }, 401);

  let message;
  try { message = await request.json(); } catch (_) { return json({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error." } }, 400); }

  // A JSON-RPC batch (array) is allowed by the spec; handle each in order.
  const deps = { cfg, getSchedule, insertSuggestion, fetchImpl: fetch };
  if (Array.isArray(message)) {
    const out = [];
    for (const m of message) { const r = await handleMcp(m, deps); if (r.body) out.push(r.body); }
    return out.length ? json(out, 200) : new Response(null, { status: 202 });
  }

  const { status, body } = await handleMcp(message, deps);
  return body ? json(body, status) : new Response(null, { status });
}
