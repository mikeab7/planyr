import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { createElementSync } from "../src/workspaces/site-planner/lib/elementSync.js";

/* The plan-switch first-write loss (sweep report, 2026-10-06, reproduced 3/3 signed in).
 *
 * Draw a markup on a freshly created plan, switch plans quickly, and the markup never reaches
 * `site_elements`. Measured live (network timeline, planyr.io build 80683f6): the new plan's engine
 * issued NO fetch and NO commit before the switch — it seeds on the realtime join or a 4 s fallback,
 * and until then `reconcile()` is a deliberate no-op, so the create was never queued. SitePlanner is
 * keyed by plan id, so the switch UNMOUNTS it and the effect cleanup hard-`stop()`ped the engine,
 * discarding the only path that would have committed it (the seed's never-synced fold). The same
 * hard stop also dropped a debounced update and a transport-failure retry waiting on its backoff.
 * The local mirror still held the line, so the drawing device kept showing it; any other device or a
 * fresh sign-in saw an empty plan.
 *
 * The fix: teardown is `stop({ drain: true })` (+ `drainSeed(rows, rows ∪ never-synced local)` for an
 * engine that never seeded) — no new diffs accepted, what is owed is committed with the normal
 * retry/backoff, against the canvas as it stood at teardown, rows canonical for anything the server
 * already has, canvas-facing callbacks muted (the component is gone).
 */

const tick = () => new Promise((r) => setTimeout(r, 0));

function makeHarness(overrides = {}) {
  const commits = [];
  const events = [];
  const reports = [];
  const timers = [];
  let clock = 1000;
  let responder = overrides.responder || ((ops) => ({
    ok: true, results: ops.map((o) => ({ id: o.id, status: "ok", rev: (o.expected || 0) + 1 })),
  }));
  const sync = createElementSync({
    siteId: "site-new",
    commit: async (ops) => { commits.push(ops); return responder(ops); },
    now: () => clock,
    setTimer: (fn, ms) => { const id = timers.length + 1 + Math.random(); timers.push({ fn, ms, id }); return id; },
    clearTimer: (id) => { const i = timers.findIndex((t) => t.id === id); if (i >= 0) timers.splice(i, 1); },
    onEvent: (e) => events.push(e),
    report: (name, msg, extra) => reports.push({ name, extra }),
    debounceMs: 750,
    ...overrides.sync,
  });
  if (!overrides.noSeed) sync.seed(overrides.rows || []); // default: a brand-new plan, zero rows on the server
  return {
    sync, commits, events, reports,
    setResponder: (r) => { responder = r; },
    runTimers: () => { const due = timers.splice(0); due.forEach((t) => t.fn()); },
    pendingTimers: () => timers.length,
  };
}

const line = { id: "mk1", type: "line", pts: [[0, 0], [10, 0]] };

const row = (id, data, rev = 1) => ({ kind: "markup", id, data, rev, z_index: 0 });

describe("plan switch before the outgoing plan's writes reached the wire", () => {
  it("REGRESSION (the measured case): a plan closed before its engine ever seeded still commits its first markup", async () => {
    const h = makeHarness({ noSeed: true });
    h.sync.reconcile({ markups: [line] });          // engine not seeded yet → a no-op, nothing queued
    expect(h.sync.pendingCount()).toBe(0);
    h.sync.stop({ drain: true });                   // plan switch → SitePlanner unmounts
    h.sync.drainSeed([], { markups: [line] });      // teardown: rows fetched now (none) ∪ never-synced local
    await tick(); await tick();
    expect(h.commits).toHaveLength(1);
    expect(h.commits[0]).toEqual([expect.objectContaining({ op: "create", id: "mk1", kind: "markup" })]);
  });

  it("REGRESSION: a debounced update queued at teardown is committed, not dropped", async () => {
    const h = makeHarness({ rows: [row("mk1", line)] });
    h.sync.reconcile({ markups: [{ ...line, pts: [[0, 0], [30, 0]] }] }); // an edit → update on the 750 ms debounce
    expect(h.commits).toHaveLength(0);
    h.sync.stop({ drain: true });
    await tick(); await tick();
    expect(h.commits).toHaveLength(1);
    expect(h.commits[0][0]).toMatchObject({ op: "update", id: "mk1", expected: 1 });
    expect(h.sync.pendingCount()).toBe(0);
  });

  it("a plain stop() is still a hard stop (the contract every other caller relies on)", async () => {
    const h = makeHarness({ rows: [row("mk1", line)] });
    h.sync.reconcile({ markups: [{ ...line, pts: [[0, 0], [30, 0]] }] });
    h.sync.stop();
    h.runTimers(); await tick();
    expect(h.commits).toHaveLength(0);
  });

  it("drainSeed keeps ROWS CANONICAL: a stale local copy of a server-known element is not written back", async () => {
    const h = makeHarness({ noSeed: true });
    h.sync.stop({ drain: true });
    const server = { ...line, id: "mk0", pts: [[5, 5], [6, 6]] };
    const stale = { ...server, pts: [[0, 0], [1, 1]] };
    h.sync.drainSeed([row("mk0", server, 4)], { markups: [stale, line] });
    await tick(); await tick();
    expect(h.commits.flat().map((o) => [o.op, o.id])).toEqual([["create", "mk1"]]);
  });

  it("drainSeed never resurrects an element the server holds as a tombstone", async () => {
    const h = makeHarness({ noSeed: true });
    h.sync.stop({ drain: true });
    h.sync.drainSeed([{ ...row("mk1", line, 3), deleted_at: "2026-10-06T00:00:00Z" }], { markups: [line] });
    await tick(); await tick();
    expect(h.commits.flat().filter((o) => o.op === "create")).toEqual([]);
  });

  it("a draining engine accepts no NEW diffs — nothing the unmounted component does can enqueue more", async () => {
    const h = makeHarness({ rows: [row("mk1", line)] });
    h.sync.reconcile({ markups: [{ ...line, pts: [[0, 0], [30, 0]] }] });
    h.sync.stop({ drain: true });
    h.sync.reconcile({ markups: [line, { id: "mk2", type: "line", pts: [] }] });
    h.sync.restore("markup", "mk3", { id: "mk3" });
    await tick(); await tick();
    h.runTimers(); await tick();
    expect(h.commits.flat().map((o) => o.id)).toEqual(["mk1"]);
  });

  it("the drain survives a transport failure: it retries on its backoff until the write lands", async () => {
    let fail = true;
    const h = makeHarness({
      noSeed: true,
      responder: (ops) => (fail ? { ok: false, error: "network" }
        : { ok: true, results: ops.map((o) => ({ id: o.id, status: "ok", rev: 1 })) }),
    });
    h.sync.stop({ drain: true });
    h.sync.drainSeed([], { markups: [line] });
    await tick(); await tick();
    expect(h.commits).toHaveLength(1);
    expect(h.pendingTimers()).toBe(1);              // a backoff retry is armed, not cancelled
    fail = false;
    h.runTimers(); await tick(); await tick();
    expect(h.commits).toHaveLength(2);
    expect(h.commits[1][0]).toMatchObject({ op: "create", id: "mk1" });
    expect(h.sync.pendingCount()).toBe(0);
  });

  it("flushes against the canvas AS IT STOOD at stop time, never whatever the live getter serves later", async () => {
    const edited = { ...line, pts: [[0, 0], [20, 0]] };
    let live = { markups: [edited] };
    const h = makeHarness({ rows: [row("mk1", line)], sync: { liveCollections: () => live } });
    h.sync.reconcile({ markups: [edited] });
    h.sync.stop({ drain: true });
    live = { markups: [{ ...line, pts: [[99, 99], [99, 99]] }] }; // anything after teardown is not this plan's
    await tick(); await tick();
    expect(h.commits[0][0].data.pts).toEqual([[0, 0], [20, 0]]);
  });

  it("canvas-facing callbacks are muted while draining (the component that owned them is gone), telemetry is not", async () => {
    const adopted = [];
    const h = makeHarness({
      rows: [row("mk1", line)],
      sync: { onRowsCanonical: (l) => adopted.push(l) },
      responder: (ops) => ({ ok: true, results: ops.map((o) => ({ id: o.id, status: "conflict", row: { id: o.id, kind: o.kind, rev: 3, data: { id: o.id, type: "line", pts: [] }, updated_by: "someone-else" } })) }),
    });
    h.sync.reconcile({ markups: [{ ...line, pts: [[0, 0], [30, 0]] }] });
    h.sync.stop({ drain: true });
    await tick(); await tick();
    expect(h.commits.length).toBeGreaterThan(0);
    expect(h.events).toEqual([]);
    expect(adopted).toEqual([]);
    expect(h.reports.some((r) => r.name === "element-drain")).toBe(true);
  });

  it("nothing pending → stop({ drain: true }) sends nothing", async () => {
    const h = makeHarness();
    h.sync.stop({ drain: true });
    await tick();
    expect(h.commits).toHaveLength(0);
  });
});

describe("the SitePlanner teardown seam uses the draining stop", () => {
  const src = readFileSync(new URL("../src/workspaces/site-planner/SitePlanner.jsx", import.meta.url), "utf8");
  it("the element-sync effect's cleanup drains (and seeds a never-seeded engine), never a bare stop()", () => {
    const i = src.indexOf("refetchReplace(eng); }, 4000);");
    expect(i).toBeGreaterThan(0);
    const cleanup = src.slice(i, i + 3000);
    expect(cleanup).toMatch(/drainElementsOnTeardown\(eng/);
    expect(cleanup).not.toMatch(/eng\.stop\(\);/);
    const fn = src.slice(src.indexOf("const drainElementsOnTeardown"), src.indexOf("const drainElementsOnTeardown") + 6000);
    expect(fn).toMatch(/eng\.stop\(\{\s*drain:\s*true\s*\}\)/);
    expect(fn).toMatch(/\.drainSeed\(/);
    expect(fn).toMatch(/foldNeverSyncedLocal\(/);
  });
});
