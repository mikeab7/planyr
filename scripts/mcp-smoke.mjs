#!/usr/bin/env node
/* Planyr MCP smoke driver (B671) — drives the /api/mcp handler in-process:
 * initialize → tools/list → tools/call list_projects, printing each response.
 *
 * Two modes:
 *   node scripts/mcp-smoke.mjs                 — stubbed fetch (no network, canned rows)
 *   SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… PLANYR_MCP_OWNER_ID=… node scripts/mcp-smoke.mjs
 *                                              — LIVE probe against real Supabase (read-only)
 * Not part of CI — a hand tool for local + post-deploy sanity checks.
 */
import { handleMcp } from "../functions/api/mcp/_handler.js";

const live = !!(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY && process.env.PLANYR_MCP_OWNER_ID);
const TOKEN = "smoke-token";
const env = live
  ? { PLANYR_MCP_TOKEN: TOKEN, SUPABASE_URL: process.env.SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY, PLANYR_MCP_OWNER_ID: process.env.PLANYR_MCP_OWNER_ID }
  : { PLANYR_MCP_TOKEN: TOKEN, SUPABASE_URL: "https://stub.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "stub", PLANYR_MCP_OWNER_ID: "stub-owner" };

if (!live) {
  const ok = (body) => new Response(JSON.stringify(body), { status: 200 });
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const u = String(url);
    if (u.includes("planar_data")) return ok([{ value: { projects: { 3: { id: 3, name: "Goose Creek", tasks: [{ id: 1, name: "Grading", start: "2026-05-01", end: "2026-06-01", duration: 31, health: "green", percentComplete: 100, parentId: null }] } } } }]);
    if (u.includes("/rest/v1/sites")) return ok([{ id: "s1", group_id: "g1", site: "Goose Creek", name: "Pad A", county: "Harris", updated_at: "2026-07-01T00:00:00Z", status: "active", lat: "29.7", lon: "-95.3", sched_id: "3", sched_name: "Goose Creek" }]);
    if (u.includes("/rest/v1/file_facts")) return ok([{ id: "f1", project_id: "g1", needs_filing: false, state: "filed" }]);
    return realFetch ? realFetch(url) : ok([]);
  };
}

const call = async (label, body) => {
  const request = new Request(`https://planyr.io/api/mcp/${TOKEN}`, { method: "POST", body: JSON.stringify(body) });
  const res = await handleMcp({ env, request, method: "POST", segs: [TOKEN] });
  const text = res.status === 202 ? "(202 accepted — notification)" : await res.text();
  console.log(`\n── ${label} → HTTP ${res.status} ──\n${text.length > 4000 ? text.slice(0, 4000) + "\n…(truncated)" : text}`);
  return res;
};

console.log(`Planyr MCP smoke — ${live ? "LIVE Supabase (read-only)" : "stubbed fetch"} mode`);
await call("initialize", { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "smoke", version: "0" } } });
await call("notifications/initialized", { jsonrpc: "2.0", method: "notifications/initialized" });
await call("tools/list", { jsonrpc: "2.0", id: 2, method: "tools/list" });
await call("tools/call list_projects", { jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "list_projects", arguments: {} } });
const guard = await handleMcp({ env, request: new Request("https://planyr.io/api/mcp/wrong", { method: "POST", body: "{}" }), method: "POST", segs: ["wrong"] });
console.log(`\n── wrong token → HTTP ${guard.status} (expect 404) ──`);
console.log("\nSmoke complete.");
