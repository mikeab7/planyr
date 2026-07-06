/* MCP transport tests (B671) — token guard, method gates, JSON-RPC dispatch. */
import { describe, it, expect } from "vitest";
import { handleMcp } from "../functions/api/mcp/_handler.js";

const ENV = { PLANYR_MCP_TOKEN: "sekret-token" };
const req = (body) => new Request("https://planyr.io/api/mcp/sekret-token", {
  method: "POST", headers: { "content-type": "application/json" },
  body: typeof body === "string" ? body : JSON.stringify(body),
});
const post = (body, env = ENV, segs = ["sekret-token"]) => handleMcp({ env, request: req(body), method: "POST", segs });

describe("capability-URL token guard", () => {
  it("404s on wrong token, missing token, extra segments, and unset env — identically", async () => {
    for (const segs of [["wrong"], [], ["sekret-token", "extra"]]) {
      const r = await post({ jsonrpc: "2.0", id: 1, method: "ping" }, ENV, segs);
      expect(r.status).toBe(404);
      expect(await r.text()).toBe("Not found");
    }
    const unset = await post({ jsonrpc: "2.0", id: 1, method: "ping" }, {}, ["sekret-token"]);
    expect(unset.status).toBe(404);
  });

  it("passes with the right token", async () => {
    const r = await post({ jsonrpc: "2.0", id: 1, method: "ping" });
    expect(r.status).toBe(200);
    expect((await r.json()).result).toEqual({});
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
