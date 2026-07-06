/* Planyr MCP — JSON-RPC 2.0 transport over stateless Streamable HTTP (B671).
 *
 * Single endpoint POST /api/mcp/<token>. The token segment is a capability URL checked
 * against env.PLANYR_MCP_TOKEN — wrong/missing/unset all return an identical plain 404,
 * so the endpoint is indistinguishable from nonexistent without the secret (same guard
 * philosophy as functions/api/drive/selftest.js).
 *
 * Transport contract (minimal, spec-legal for a stateless JSON-only server):
 *   POST  JSON-RPC message (or 2025-03-26 batch array) → application/json response
 *   GET   → 405 Allow: POST (no server-initiated SSE stream offered)
 *   DELETE → 405 (no sessions to terminate)
 *   notifications (any message without an id) → 202 empty body
 * Tool failures are result.isError content — never protocol errors, never 500s.
 */
import { TOOLS, callTool, InvalidParams } from "./_tools.js";

const SUPPORTED_VERSIONS = ["2025-03-26", "2025-06-18"];
const LATEST_VERSION = "2025-06-18";

const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { "content-type": "application/json; charset=utf-8" } });

const rpcResult = (id, result) => ({ jsonrpc: "2.0", id, result });
const rpcError = (id, code, message) => ({ jsonrpc: "2.0", id: id ?? null, error: { code, message } });

async function dispatchOne(env, msg) {
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
        return rpcResult(msg.id, await callTool(env, msg.params));
      default:
        return rpcError(msg.id, -32601, `method not found: ${msg.method}`);
    }
  } catch (e) {
    if (e instanceof InvalidParams) return rpcError(msg.id, -32602, e.message);
    // Unexpected throw outside a tool handler — still a visible JSON-RPC error, not a 500.
    return rpcError(msg.id, -32603, `internal error: ${e?.message || String(e)}`);
  }
}

export async function handleMcp({ env, request, method, segs }) {
  // Capability-URL guard FIRST — before revealing that anything lives here at all.
  const token = Array.isArray(segs) && segs.length === 1 ? segs[0] : null;
  if (!env?.PLANYR_MCP_TOKEN || !token || token !== env.PLANYR_MCP_TOKEN) {
    return new Response("Not found", { status: 404 });
  }

  if (method !== "POST") {
    return new Response("Method not allowed", { status: 405, headers: { allow: "POST" } });
  }

  let body;
  try { body = await request.json(); }
  catch (_) { return json(rpcError(null, -32700, "parse error: body is not valid JSON")); }

  if (Array.isArray(body)) { // 2025-03-26 allowed batching; cheap to honour
    if (!body.length) return json(rpcError(null, -32600, "invalid request: empty batch"));
    const answers = (await Promise.all(body.map((m) => dispatchOne(env, m)))).filter(Boolean);
    return answers.length ? json(answers) : new Response(null, { status: 202 });
  }

  const answer = await dispatchOne(env, body);
  return answer ? json(answer) : new Response(null, { status: 202 });
}
