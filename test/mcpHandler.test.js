/* MCP transport tests (B671) — who is asking (legacy path token + per-person OAuth), method gates, JSON-RPC dispatch. */
import { describe, it, expect, vi } from "vitest";
import { handleMcp } from "../functions/api/mcp/_handler.js";

const ENV = { PLANYR_MCP_TOKEN: "sekret-token", PLANYR_MCP_OWNER_ID: "OWNER-123", SUPABASE_URL: "https://main.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "svc-key" };
const req = (body) => new Request("https://planyr.io/api/mcp/sekret-token", {
  method: "POST", headers: { "content-type": "application/json" },
  body: typeof body === "string" ? body : JSON.stringify(body),
});
const post = (body, env = ENV, segs = ["sekret-token"]) => handleMcp({ env, request: req(body), method: "POST", segs });

describe("legacy capability-URL token (owner only)", () => {
  it("404s on a wrong path token, extra segments, and unset env — identically", async () => {
    for (const segs of [["wrong"], ["sekret-token", "extra"]]) {
      const r = await post({ jsonrpc: "2.0", id: 1, method: "ping" }, ENV, segs);
      expect(r.status).toBe(404);
      expect(await r.text()).toBe("Not found");
    }
    for (const env of [{}, { PLANYR_MCP_TOKEN: "sekret-token" }]) {   // no owner id → the legacy path is off
      expect((await post({ jsonrpc: "2.0", id: 1, method: "ping" }, env, ["sekret-token"])).status).toBe(404);
    }
  });

  it("passes with the right token", async () => {
    const r = await post({ jsonrpc: "2.0", id: 1, method: "ping" });
    expect(r.status).toBe(200);
    expect((await r.json()).result).toEqual({});
  });
});

describe("per-person OAuth bearer (Connect to Claude)", () => {
  const bearerReq = (auth) => new Request("https://planyr.io/api/mcp", {
    method: "POST", headers: { "content-type": "application/json", ...(auth ? { authorization: auth } : {}) },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping" }),
  });
  const call = (auth, fetchImpl) => handleMcp({ env: ENV, request: bearerReq(auth), method: "POST", segs: [], fetchImpl });
  const checkStub = (answer, status = 200) => vi.fn(async () => new Response(JSON.stringify(answer), { status }));

  it("no token → 401 whose WWW-Authenticate points at the protected-resource metadata", async () => {
    const r = await call(null, checkStub({ ok: false }));
    expect(r.status).toBe(401);
    expect(r.headers.get("www-authenticate")).toBe('Bearer realm="planyr", resource_metadata="https://planyr.io/.well-known/oauth-protected-resource/api/mcp"');
  });

  it("a live access token is checked against the grant on EVERY call and names the person", async () => {
    const f = checkStub({ ok: true, user_id: "user-b", grant_id: "g1", scope: "planyr.read" });
    const r = await call("Bearer pmcp_at_abc", f);
    expect(r.status).toBe(200);
    expect(f).toHaveBeenCalledTimes(1);
    const [url, init] = f.mock.calls[0];
    expect(url).toBe("https://main.supabase.co/rest/v1/rpc/mcp_oauth_check");
    expect(JSON.parse(init.body)).toEqual({ p_access: "pmcp_at_abc" });
  });

  it("a revoked / expired / unknown token → 401 invalid_token (Disconnect stops the next call)", async () => {
    const r = await call("Bearer pmcp_at_revoked", checkStub({ ok: false }));
    expect(r.status).toBe(401);
    expect(r.headers.get("www-authenticate")).toMatch(/error="invalid_token"/);
  });

  it("a Supabase session JWT or any other string is not an MCP token", async () => {
    const f = checkStub({ ok: true, user_id: "x" });
    for (const t of ["Bearer eyJhbGciOiJIUzI1NiJ9.e30.sig", "Bearer pmcp_rt_refresh", "Bearer wrong"]) {
      const r = await call(t, f);
      expect(r.status).toBe(401);
    }
    expect(f).not.toHaveBeenCalled();
  });

  it("the legacy secret as a bearer stays pinned to the owner", async () => {
    const f = checkStub({ ok: true, user_id: "someone-else" });
    const r = await call("Bearer sekret-token", f);
    expect(r.status).toBe(200);
    expect(f).not.toHaveBeenCalled();
  });

  it("a database outage during the check is a loud 503, never a pass", async () => {
    const r = await call("Bearer pmcp_at_abc", checkStub("boom", 500));
    expect(r.status).toBe(503);
  });
});

describe("method gates", () => {
  it("GET and DELETE get 405 with Allow: POST (after passing the token guard)", async () => {
    for (const method of ["GET", "DELETE"]) {
      const r = await handleMcp({ env: ENV, request: new Request("https://x/", { method }), method, segs: ["sekret-token"] });
      expect(r.status).toBe(405);
      expect(r.headers.get("allow")).toBe("POST");
    }
  });
});

describe("JSON-RPC dispatch", () => {
  it("initialize echoes a supported protocol version and falls back on unknown ones", async () => {
    const a = await (await post({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-03-26" } })).json();
    expect(a.result.protocolVersion).toBe("2025-03-26");
    expect(a.result.serverInfo.name).toBe("planyr-mcp");
    expect(a.result.capabilities).toEqual({ tools: {} });
    const b = await (await post({ jsonrpc: "2.0", id: 2, method: "initialize", params: { protocolVersion: "1999-01-01" } })).json();
    expect(b.result.protocolVersion).toBe("2025-06-18");
  });

  it("notifications (no id) → 202 empty, even unknown ones", async () => {
    for (const method of ["notifications/initialized", "notifications/whatever"]) {
      const r = await post({ jsonrpc: "2.0", method });
      expect(r.status).toBe(202);
      expect(await r.text()).toBe("");
    }
  });

  it("tools/list returns the five tools with schemas", async () => {
    const a = await (await post({ jsonrpc: "2.0", id: 3, method: "tools/list" })).json();
    const names = a.result.tools.map((t) => t.name);
    expect(names).toEqual(["list_projects", "get_project", "get_site_layout", "get_schedule", "search_project_files"]);
    for (const t of a.result.tools) {
      expect(t.description.length).toBeGreaterThan(20);
      expect(t.inputSchema.type).toBe("object");
    }
  });

  it("parse error → -32700, unknown method → -32601, unknown tool / bad args → -32602", async () => {
    const bad = await (await post("{not json")).json();
    expect(bad.error.code).toBe(-32700);
    const missing = await (await post({ jsonrpc: "2.0", id: 4, method: "resources/list" })).json();
    expect(missing.error.code).toBe(-32601);
    const unknownTool = await (await post({ jsonrpc: "2.0", id: 5, method: "tools/call", params: { name: "nope" } })).json();
    expect(unknownTool.error.code).toBe(-32602);
    const badArgs = await (await post({ jsonrpc: "2.0", id: 6, method: "tools/call", params: { name: "get_project", arguments: {} } })).json();
    expect(badArgs.error.code).toBe(-32602);
    expect(badArgs.error.message).toMatch(/missing required argument: project/);
  });

  it("handles a batch array, answering requests and swallowing notifications", async () => {
    const r = await post([
      { jsonrpc: "2.0", id: 1, method: "ping" },
      { jsonrpc: "2.0", method: "notifications/initialized" },
    ]);
    const arr = await r.json();
    expect(arr).toHaveLength(1);
    expect(arr[0].id).toBe(1);
  });
});
