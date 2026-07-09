import { describe, it, expect } from "vitest";
import { commitElements, fetchElements, keepaliveCommit, ELEMENT_SELECT } from "../src/workspaces/site-planner/lib/elementApi.js";

// B671 — the network seam. The keepalive path is pure over an injected fetch; commit/fetch are
// thin over a fake supabase-js client.

describe("commitElements", () => {
  const fakeClient = (rpcImpl) => ({ rpc: rpcImpl });

  it("calls the commit_elements RPC with p_site + p_ops and returns the results array", async () => {
    let seen;
    const client = fakeClient(async (name, args) => { seen = { name, args }; return { data: [{ id: "e1", status: "ok", rev: 2 }], error: null }; });
    const r = await commitElements(client, "site-1", [{ op: "update", id: "e1", kind: "el", expected: 1, data: {} }]);
    expect(seen.name).toBe("commit_elements");
    expect(seen.args).toEqual({ p_site: "site-1", p_ops: [{ op: "update", id: "e1", kind: "el", expected: 1, data: {} }] });
    expect(r).toEqual({ ok: true, results: [{ id: "e1", status: "ok", rev: 2 }] });
  });

  it("short-circuits an empty batch without calling the RPC", async () => {
    let called = false;
    const client = fakeClient(async () => { called = true; return { data: [], error: null }; });
    const r = await commitElements(client, "s", []);
    expect(called).toBe(false);
    expect(r).toEqual({ ok: true, results: [] });
  });

  it("surfaces an RPC error as ok:false (LOUD-FAILURE, never a silent success)", async () => {
    const client = fakeClient(async () => ({ data: null, error: { message: "boom" } }));
    const r = await commitElements(client, "s", [{ op: "create", id: "e1", kind: "el", data: {} }]);
    expect(r).toMatchObject({ ok: false, error: "boom" });
  });

  it("catches a throw", async () => {
    const client = fakeClient(async () => { throw new Error("network"); });
    const r = await commitElements(client, "s", [{ op: "create", id: "e1", kind: "el", data: {} }]);
    expect(r.ok).toBe(false);
    expect(r.error).toContain("network");
  });

  it("times out a HUNG commit as ok:false so the sync slot can't wedge forever (NEW-1, LOUD-FAILURE)", async () => {
    let fire;
    const client = fakeClient(() => new Promise(() => {})); // never settles — simulates a stalled request
    const p = commitElements(client, "s", [{ op: "delete", id: "e1", kind: "el", expected: 1 }], {
      timeoutMs: 8000, setTimer: (fn) => { fire = fn; return 1; }, clearTimer: () => {},
    });
    expect(typeof fire).toBe("function"); // the timer was armed synchronously, before the await
    fire();                              // trip the timeout instead of waiting 8s
    const r = await p;
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/timeout/);
  });

  it("wires an AbortSignal through to the builder when it supports .abortSignal()", async () => {
    let gotSignal;
    const builder = { abortSignal: (sig) => { gotSignal = sig; return Promise.resolve({ data: [{ id: "e1", status: "ok", rev: 2 }], error: null }); } };
    const client = { rpc: () => builder };
    const r = await commitElements(client, "s", [{ op: "create", id: "e1", kind: "el", data: {} }]);
    expect(r).toEqual({ ok: true, results: [{ id: "e1", status: "ok", rev: 2 }] });
    expect(gotSignal && typeof gotSignal.aborted === "boolean").toBe(true); // an AbortSignal was passed
  });
});

describe("fetchElements", () => {
  const chain = (result) => ({ from: () => ({ select: (sel) => { chain.sel = sel; return { eq: async () => result }; } }) });

  it("selects the element columns filtered by site_id", async () => {
    let sel, col, val;
    const client = { from: (t) => { expect(t).toBe("site_elements"); return { select: (s) => { sel = s; return { eq: async (c, v) => { col = c; val = v; return { data: [{ id: "e1" }], error: null }; } }; } }; } };
    const r = await fetchElements(client, "site-9");
    expect(sel).toBe(ELEMENT_SELECT);
    expect([col, val]).toEqual(["site_id", "site-9"]);
    expect(r).toEqual({ ok: true, rows: [{ id: "e1" }] });
    void chain;
  });

  it("returns ok:false on a fetch error so the caller keeps the current canvas (B54 discipline)", async () => {
    const client = { from: () => ({ select: () => ({ eq: async () => ({ data: null, error: { message: "down" } }) }) }) };
    const r = await fetchElements(client, "s");
    expect(r).toMatchObject({ ok: false, rows: [], error: "down" });
  });

  it("times out a HUNG fetch as ok:false so a stalled refetch can't hang the read path (NEW-1)", async () => {
    let fire;
    const client = { from: () => ({ select: () => ({ eq: () => new Promise(() => {}) }) }) }; // never settles
    const p = fetchElements(client, "s", { timeoutMs: 8000, setTimer: (fn) => { fire = fn; return 1; }, clearTimer: () => {} });
    expect(typeof fire).toBe("function");
    fire();
    const r = await p;
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/timeout/);
  });
});

describe("keepaliveCommit", () => {
  it("POSTs to the rpc endpoint with keepalive + auth headers and the batch body", () => {
    const calls = [];
    const ok = keepaliveCommit({
      fetchImpl: (url, opts) => { calls.push({ url, opts }); return { catch() {} }; },
      url: "https://x.supabase.co", anon: "anon-key", token: "jwt", siteId: "site-1",
      ops: [{ op: "create", id: "e1", kind: "el", data: {} }],
    });
    expect(ok).toBe(true);
    expect(calls[0].url).toBe("https://x.supabase.co/rest/v1/rpc/commit_elements");
    expect(calls[0].opts.method).toBe("POST");
    expect(calls[0].opts.keepalive).toBe(true);
    expect(calls[0].opts.headers.apikey).toBe("anon-key");
    expect(calls[0].opts.headers.Authorization).toBe("Bearer jwt");
    expect(JSON.parse(calls[0].opts.body)).toEqual({ p_site: "site-1", p_ops: [{ op: "create", id: "e1", kind: "el", data: {} }] });
  });

  it("no-ops (returns false) when a requirement is missing or the batch is empty", () => {
    const f = () => ({ catch() {} });
    expect(keepaliveCommit({ fetchImpl: f, url: "", anon: "a", token: "t", siteId: "s", ops: [{}] })).toBe(false);
    expect(keepaliveCommit({ fetchImpl: f, url: "u", anon: "a", token: "", siteId: "s", ops: [{}] })).toBe(false);
    expect(keepaliveCommit({ fetchImpl: f, url: "u", anon: "a", token: "t", siteId: "s", ops: [] })).toBe(false);
  });
});
