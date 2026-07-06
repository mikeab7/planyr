/* /api/mcp/<token> — Planyr's read-only remote MCP server (B671).
 *
 * Thin Cloudflare Pages Functions wrapper; all logic lives in the testable core
 * (_handler.js → _tools.js → _metrics.js). The catch-all exists so the capability
 * token rides as a path segment (claude.ai custom connectors take a bare URL).
 */
import { handleMcp } from "./_handler.js";

const segsOf = (params) => (Array.isArray(params?.path) ? params.path : String(params?.path || "").split("/").filter(Boolean));

export async function onRequestPost(context) {
  const { env, request, params } = context;
  return handleMcp({ env, request, method: "POST", segs: segsOf(params) });
}

export async function onRequestGet(context) {
  const { env, request, params } = context;
  return handleMcp({ env, request, method: "GET", segs: segsOf(params) });
}

export async function onRequestDelete(context) {
  const { env, request, params } = context;
  return handleMcp({ env, request, method: "DELETE", segs: segsOf(params) });
}
