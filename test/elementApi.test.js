import { describe, it, expect } from "vitest";
import { commitElements, fetchElements, fetchParcelSummaries, fetchElementRecency, keepaliveCommit, ELEMENT_SELECT } from "../src/workspaces/site-planner/lib/elementApi.js";

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

  // B1117 — the atomic overload. The migration is live on production (applied + rollback-verified
  // 2026-07-29); these lock the client contract, including the two DIFFERENT wire shapes.
  it("opts.atomic sends p_atomic and normalises the OBJECT shape the atomic overload returns", async () => {
    let seen;
    const client = fakeClient(async (name, args) => {
      seen = args;
      return { data: { applied: false, results: [{ id: "e1", status: "ok", rev: 64 }, { id: "e2", status: "conflict", row: { rev: 66 } }] }, error: null };
    });
    const r = await commitElements(client, "s", [{ op: "update", id: "e1" }, { op: "update", id: "e2" }], { atomic: true });
    expect(seen.p_atomic).toBe(true);
    expect(r.ok).toBe(true);
    expect(r.applied).toBe(false);                       // the whole call was rolled back
    expect(r.results).toHaveLength(2);
  });

  it("an atomic call that APPLIED reports applied:true", async () => {
    const client = fakeClient(async () => ({ data: { applied: true, results: [{ id: "e1", status: "ok", rev: 2 }] }, error: null }));
    const r = await commitElements(client, "s", [{ op: "update", id: "e1" }], { atomic: true });
    expect(r.applied).toBe(true);
    expect(r.results).toEqual([{ id: "e1", status: "ok", rev: 2 }]);
  });

  it("without opts.atomic the call is the plain 2-arg form and the bare ARRAY shape still works", async () => {
    let seen;
    const client = fakeClient(async (name, args) => { seen = args; return { data: [{ id: "e1", status: "ok", rev: 2 }], error: null }; });
    const r = await commitElements(client, "s", [{ op: "update", id: "e1" }]);
    expect(seen).not.toHaveProperty("p_atomic");
    expect(r).toEqual({ ok: true, results: [{ id: "e1", status: "ok", rev: 2 }] });
  });

  it("a REAL rpc error is still reported, not mistaken for a missing overload", async () => {
    const client = fakeClient(async () => ({ data: null, error: { code: "42501", message: "permission denied for function commit_elements" } }));
    const r = await commitElements(client, "s", [{ op: "update", id: "e1" }], { atomic: true });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/permission denied/);
  });

  it("an environment WITHOUT the migration falls back to the 2-arg call instead of failing every write", async () => {
    // The owner's rollout caution: a 3-arg call against a project that has not run the migration
    // gets a PostgREST "function not found". That must degrade, never break.
    const calls = [];
    const client = fakeClient(async (name, args) => {
      calls.push(args);
      if (args.p_atomic) return { data: null, error: { code: "PGRST202", message: "Could not find the function public.commit_elements(p_atomic, p_ops, p_site)" } };
      return { data: [{ id: "e1", status: "ok", rev: 2 }], error: null };
    });
    const r = await commitElements(client, "s", [{ op: "update", id: "e1" }], { atomic: true });
    expect(r.ok).toBe(true);                             // the write still lands…
    expect(r.results).toHaveLength(1);
    expect(calls).toHaveLength(2);                       // …via a retry on the plain path
    expect(calls[1]).not.toHaveProperty("p_atomic");
    // …and it is LATCHED, so the next batch does not pay the failed probe again.
    const r2 = await commitElements(client, "s", [{ op: "update", id: "e2" }], { atomic: true });
    expect(r2.ok).toBe(true);
    expect(calls).toHaveLength(3);
    expect(calls[2]).not.toHaveProperty("p_atomic");
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

describe("fetchParcelSummaries", () => {
  // B849344 — the network seam behind the Sites panel / map pin's canonical boundary read.
  // B868960 (NEW-2) — now a paged walk (same helper as fetchElementRecency below); one short
  // page is a complete portfolio, exercised here at ordinary (sub-page) size.
  const chainTo = (result) => ({
    from: (t) => {
      expect(t).toBe("site_elements");
      return {
        select: (s) => ({
          eq: (c, v) => ({
            is: (c2, v2) => ({
              range: (from, to) => { chainTo.seen = { s, c, v, c2, v2, from, to }; return Promise.resolve(result); },
            }),
          }),
        }),
      };
    },
  });

  it("selects site_id,data filtered to live parcel rows (kind='parcel', deleted_at is null) and pages from 0", async () => {
    const client = chainTo({ data: [{ site_id: "s1", data: { id: "p1" } }], error: null });
    const r = await fetchParcelSummaries(client);
    expect(chainTo.seen).toEqual({ s: "site_id,data", c: "kind", v: "parcel", c2: "deleted_at", v2: null, from: 0, to: 999 });
    expect(r).toEqual({ ok: true, rows: [{ site_id: "s1", data: { id: "p1" } }] });
  });

  it("returns ok:false on a fetch error (LOUD-FAILURE — never a silent empty portfolio)", async () => {
    const client = { from: () => ({ select: () => ({ eq: () => ({ is: () => ({ range: () => Promise.resolve({ data: null, error: { message: "down" } }) }) }) }) }) };
    const r = await fetchParcelSummaries(client);
    expect(r).toMatchObject({ ok: false, rows: [], error: "down" });
  });

  it("no client → ok:false without throwing", async () => {
    const r = await fetchParcelSummaries(null);
    expect(r).toEqual({ ok: false, rows: [], error: "no client" });
  });
});

describe("fetchElementRecency", () => {
  // B845089 amendment (2026-08-30, NEW-1) — the truncation fix: PostgREST caps an unbounded select at
  // 1,000 rows and answers ok:true on the partial window. These pin the paginated replacement's
  // contract directly against a faked client that reproduces the exact failure shape measured
  // live (page 1 full at 1,000, page 2 short).
  const pagedClient = (pages) => {
    const calls = [];
    return {
      calls,
      from: (t) => {
        expect(t).toBe("site_elements");
        return {
          select: (s) => ({
            is: (c, v) => ({
              range: (from, to) => {
                calls.push({ s, c, v, from, to });
                const page = pages[calls.length - 1];
                if (!page) return Promise.resolve({ data: [], error: null });
                return page.error
                  ? Promise.resolve({ data: null, error: page.error })
                  : Promise.resolve({ data: page.rows, error: null });
              },
            }),
          }),
        };
      },
    };
  };

  it("requests page 1 unbounded-shaped and stops on a page shorter than 1,000 — a single sub-page portfolio needs one page", async () => {
    const client = pagedClient([{ rows: [{ site_id: "s1", updated_at: "2026-08-01" }] }]);
    const r = await fetchElementRecency(client);
    expect(client.calls).toEqual([{ s: "site_id,updated_at", c: "deleted_at", v: null, from: 0, to: 999 }]);
    expect(r).toEqual({ ok: true, rows: [{ site_id: "s1", updated_at: "2026-08-01" }] });
  });

  it("a FULL 1,000-row page 1 is not treated as complete — page 2 is requested, and both pages' rows are merged", async () => {
    const page1 = Array.from({ length: 1000 }, (_, i) => ({ site_id: `s${i}`, updated_at: "2026-08-01" }));
    const page2 = [{ site_id: "s1000", updated_at: "2026-08-30" }, { site_id: "s1001", updated_at: "2026-08-29" }];
    const client = pagedClient([{ rows: page1 }, { rows: page2 }]);
    const r = await fetchElementRecency(client);
    expect(client.calls).toEqual([
      { s: "site_id,updated_at", c: "deleted_at", v: null, from: 0, to: 999 },
      { s: "site_id,updated_at", c: "deleted_at", v: null, from: 1000, to: 1999 },
    ]);
    expect(r.ok).toBe(true);
    expect(r.rows).toHaveLength(1002);
    expect(r.rows.slice(0, 1000)).toEqual(page1);
    expect(r.rows.slice(1000)).toEqual(page2);
  });

  it("a mid-loop error yields ok:false with rows:[] — never page 1's rows reported as complete (LOUD-FAILURE)", async () => {
    const page1 = Array.from({ length: 1000 }, (_, i) => ({ site_id: `s${i}`, updated_at: "2026-08-01" }));
    const client = pagedClient([{ rows: page1 }, { error: { message: "connection reset" } }]);
    const r = await fetchElementRecency(client);
    expect(client.calls).toHaveLength(2);
    expect(r).toEqual({ ok: false, rows: [], error: "connection reset" });
  });

  it("no client → ok:false without throwing", async () => {
    const r = await fetchElementRecency(null);
    expect(r).toEqual({ ok: false, rows: [], error: "no client" });
  });

  it("a response that never comes back short trips the page ceiling rather than looping forever", async () => {
    let calls = 0;
    const fullPage = Array.from({ length: 1000 }, (_, i) => ({ site_id: `s${i}`, updated_at: "x" }));
    const client = {
      from: () => ({
        select: () => ({
          is: () => ({
            range: () => { calls += 1; return Promise.resolve({ data: fullPage, error: null }); },
          }),
        }),
      }),
    };
    const r = await fetchElementRecency(client);
    expect(r.ok).toBe(false);
    expect(r.rows).toEqual([]);
    expect(r.error).toMatch(/page ceiling/);
    expect(calls).toBe(200); // PAGE_CEILING — bounded, not infinite
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
