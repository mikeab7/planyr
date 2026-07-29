/* NEW-1 / NEW-3 / NEW-4 — the bonded-assembly tear.
 *
 * A building plus everything `attachedTo` it is ONE object to the user: dragging the building
 * moves the truck court, the trailer parking, the sidewalks, the side parking and the corner
 * dock bump-outs with it. Three independent defects let that assembly come apart on a plain drag
 * and then never heal:
 *
 *   NEW-1  the write path had no notion of an assembly. A batch was "whatever happened to be
 *          dirty", so a move could commit the host in one transaction and part of its children in
 *          another — and the later transaction carried the payload captured BEFORE the gesture.
 *   NEW-3  once torn it never converged: a genuine foreign row (a repair) was classified as a
 *          self-echo, and the client re-pushed its own stale copy over it.
 *   NEW-4  the `site_elements` read path healed nothing, so a torn assembly survived every reload.
 *
 * All three are asserted here against the pure layers (injected commit/timers/clock; no I/O).
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createElementSync, stableStringify } from "../src/workspaces/site-planner/lib/elementSync.js";
import { rowsToModel } from "../src/workspaces/site-planner/lib/elementRows.js";
import { commitElements } from "../src/workspaces/site-planner/lib/elementApi.js";
import { strandedFromHost, normalizeBondedChildren, offAnchor } from "../src/workspaces/site-planner/lib/siteModel.js";
import { toastForSyncEvent } from "../src/workspaces/site-planner/lib/conflictToasts.js";

const tick = () => new Promise((r) => setTimeout(r, 0));

// Engine harness with a controllable clock/timers, a scriptable commit, and a MUTABLE canvas the
// engine reads through `liveCollections` — exactly how SitePlanner wires it.
function makeHarness(overrides = {}) {
  const commits = [];
  const events = [];
  const timers = [];
  let clock = 1000;
  const canvas = { els: [], markups: [], measures: [], callouts: [], parcels: [] };
  let responder = overrides.responder || ((ops) => ({
    ok: true, results: ops.map((o) => ({ id: o.id, status: "ok", rev: (o.expected || 0) + 1 })),
  }));
  const sync = createElementSync({
    siteId: "site-1",
    commit: async (ops) => { commits.push(ops); return responder(ops); },
    now: () => clock,
    setTimer: (fn, ms) => { const id = timers.length + 1; timers.push({ fn, ms, id }); return id; },
    clearTimer: (id) => { const i = timers.findIndex((t) => t.id === id); if (i >= 0) timers.splice(i, 1); },
    onEvent: (e) => events.push(e),
    liveCollections: () => canvas,
    // Mirror SitePlanner: an assigned stacking key is written back onto the canvas element, so the
    // live copy and the committed copy agree (without it every element looks permanently dirty).
    patchElement: (kind, id, patch) => {
      const field = kind === "el" ? "els" : `${kind}s`;
      canvas[field] = (canvas[field] || []).map((e) => (e.id === id ? { ...e, ...patch } : e));
    },
    ...overrides.sync,
  });
  sync.seed(overrides.seed || []);
  return {
    sync, commits, events, canvas,
    setResponder: (r) => { responder = r; },
    advance: (ms) => { clock += ms; },
    runTimers: () => { const due = timers.splice(0); due.forEach((t) => t.fn()); },
    pendingTimers: () => timers.length,
    // Reconcile against the CURRENT canvas (what the autosave effect does).
    reconcile: (busy) => sync.reconcile(canvas, { busy }),
  };
}

// A building + N bonded children, at the origin.
const host = (id, extra = {}) => ({ id, type: "building", cx: 0, cy: 0, w: 600, h: 300, rot: 0, ...extra });
const kid = (id, cx, cy, extra = {}) => ({ id, type: "paving", attachedTo: "b1", cx, cy, w: 600, h: 135, rot: 0, ...extra });
// The Tsakiris shape: one host, five bonded children at their own offsets.
const assembly = () => [
  host("b1"),
  kid("k1", 0, 217.5), kid("k2", 0, 342.5), kid("k3", 0, -217.5),
  kid("k4", -302.5, 0, { w: 5, h: 300 }), kid("k5", 302.5, 0, { w: 5, h: 300 }),
];
const move = (els, dx, dy) => els.map((e) => ({ ...e, cx: e.cx + dx, cy: e.cy + dy }));

describe("NEW-1 — a gesture that moves a host and its bonded children commits as ONE batch", () => {
  it("drags a host with 5 bonded children → exactly one commit, 6 ops, all at post-gesture coordinates", async () => {
    const h = makeHarness();
    h.canvas.els = assembly();
    h.reconcile(false); await tick();          // the six creates
    expect(h.commits).toHaveLength(1);
    h.commits.length = 0;

    // The drag: one React commit translates every member by the same delta (SitePlanner's
    // `members`/`assemblyOf` move), then pointer-up flushes.
    h.canvas.els = move(h.canvas.els, 0, -241);
    h.reconcile(false);
    h.sync.flushGesture();
    await tick();

    expect(h.commits).toHaveLength(1);                       // ONE transaction, not two
    const ops = h.commits[0];
    expect(ops).toHaveLength(6);                             // host + all five children
    expect(new Set(ops.map((o) => o.id))).toEqual(new Set(["b1", "k1", "k2", "k3", "k4", "k5"]));
    for (const o of ops) {
      const live = h.canvas.els.find((e) => e.id === o.id);
      expect(o.data.cy).toBe(live.cy);                       // post-gesture coordinates, every one
    }
  });

  it("a member left behind by the diff is CLOSED INTO the same commit, not dribbled out later", async () => {
    // Reproduces the shape of the production tear: the host + two children reach the dirty queue,
    // the other three are equally moved on the canvas but were never enqueued (whatever the cause —
    // a deferred cascade, a mid-gesture refetch, a busy-gated diff). Pre-fix that split the assembly
    // across transactions; the closure pass folds them into the same batch.
    const h = makeHarness();
    h.canvas.els = assembly();
    h.reconcile(false); await tick();
    h.commits.length = 0;

    const moved = move(h.canvas.els, 0, -241);
    // Diff a PARTIAL view of the canvas — only the host + k1 + k2 look changed to the differ…
    h.sync.reconcile({ els: [moved[0], moved[1], moved[2], h.canvas.els[3], h.canvas.els[4], h.canvas.els[5]] }, {});
    // …while the real canvas has the whole assembly moved.
    h.canvas.els = moved;
    h.sync.flushGesture();
    await tick();

    expect(h.commits).toHaveLength(1);
    expect(h.commits[0]).toHaveLength(6);
    for (const o of h.commits[0]) expect(o.data.cy).toBe(h.canvas.els.find((e) => e.id === o.id).cy);
  });

  it("a queued op's PRE-GESTURE payload is re-read from live state at flush time", async () => {
    const h = makeHarness();
    h.canvas.els = assembly();
    h.reconcile(false); await tick();
    h.commits.length = 0;

    // An op is enqueued from the pre-drag state (this is the stale payload the server was seeing)…
    h.canvas.els = h.canvas.els.map((e) => (e.id === "k1" ? { ...e, cy: e.cy + 1 } : e));
    h.reconcile(false);
    expect(h.pendingTimers()).toBe(1);                       // debounced, still queued
    // …then the gesture moves the whole assembly and flushes.
    h.canvas.els = move(assembly(), 0, -241);
    h.sync.flushGesture(); await tick();

    const k1 = h.commits[0].find((o) => o.id === "k1");
    expect(k1.data.cy).toBe(h.canvas.els.find((e) => e.id === "k1").cy); // NOT the captured payload
  });

  it("an unbonded element is untouched by the closure (no assembly, no extra ops)", async () => {
    const h = makeHarness();
    h.canvas.els = [host("b1"), { id: "solo", type: "parking", cx: 5000, cy: 5000, w: 100, h: 60, rot: 0 }];
    h.reconcile(false); await tick();
    h.commits.length = 0;
    h.canvas.els = h.canvas.els.map((e) => (e.id === "solo" ? { ...e, cx: 5100 } : e));
    h.reconcile(false); h.sync.flushGesture(); await tick();
    expect(h.commits[0]).toHaveLength(1);
    expect(h.commits[0][0].id).toBe("solo");
  });
});

describe("NEW-2 — an undo/redo is a gesture boundary and commits immediately", () => {
  const read = (p) => readFileSync(fileURLToPath(new URL(p, import.meta.url)), "utf8");
  const src = read("../src/workspaces/site-planner/SitePlanner.jsx");

  it("restoring a snapshot and flushing commits NOW — it never rides the debounce", async () => {
    const h = makeHarness();
    h.canvas.els = assembly();
    h.reconcile(false); await tick();
    h.commits.length = 0;

    const before = h.canvas.els;                             // the pre-move snapshot the history holds
    h.canvas.els = move(before, 0, -241);                    // the move…
    h.reconcile(false); h.sync.flushGesture(); await tick();
    expect(h.commits).toHaveLength(1);

    // …then Ctrl+Z. applySnapshot restores the snapshot and flushes against IT (React has not
    // re-rendered, so `stateRef` still holds the moved state — the diff must come from the snapshot).
    h.canvas.els = before;
    h.sync.reconcile({ els: before }, {});
    h.sync.flushGesture(); await tick();

    expect(h.commits).toHaveLength(2);                       // committed on the spot…
    expect(h.pendingTimers()).toBe(0);                       // …not left on a 750 ms timer
    expect(h.commits[1]).toHaveLength(6);                    // the whole assembly, together
    for (const o of h.commits[1]) expect(o.data.cy).toBe(before.find((e) => e.id === o.id).cy);
  });

  it("applySnapshot flushes the restored snapshot (anti-drift source guard)", () => {
    const idx = src.indexOf("const applySnapshot = (s) => {");
    expect(idx, "applySnapshot not found — has it moved or been renamed?").toBeGreaterThan(-1);
    const end = src.indexOf("\n  };", idx);
    const block = src.slice(idx, end);
    // Flushed against the SNAPSHOT, not stateRef — passing `s` is the whole point.
    expect(block).toMatch(/flushElems\(s\)/);
  });

  it("flushElems accepts the snapshot override and installs it for the engine's live read", () => {
    expect(src).toMatch(/const flushElems = \(override\) =>/);
    expect(src).toMatch(/syncStateOverride\.current \|\| stateRef\.current/);
  });
});

/* NEW-1 (2026-07-29 live verification of V509) — the STRAGGLER re-tear.
 *
 * The undo's own flush was proven correct on production: the drag committed as one 12-op batch and
 * Ctrl+Z committed immediately as one 12-op batch at pre-move coordinates. But ~4 s later a THIRD
 * batch of 2 ops went out carrying the PRE-UNDO coordinates, and the assembly was torn again — 10
 * members restored, 2 stranded.
 *
 * The straggler escapes `closeAssemblies` and `freshen` legitimately, and that is the point: BOTH
 * ran, and both were right. A late echo of the pre-undo commit had been put back on the canvas for
 * those two elements, so by flush time the canvas itself was torn — `freshen` faithfully read the
 * torn bytes, and `closeAssemblies` correctly folded in nothing because only those two disagreed
 * with the server. The defect is upstream of the write path: our own bytes, from a state the user
 * has explicitly undone, must never reach the canvas again. */
describe("NEW-1 — a late echo of an undone commit can never re-tear the assembly", () => {
  const rowFor = (el, rev, uid) => ({ kind: "el", id: el.id, data: el, rev, z_index: 0, updated_by: uid });

  it("commit A → snapshot → commit B → the delayed echo of A: no third commit, nothing resurrected", async () => {
    const h = makeHarness({ sync: { selfUid: "me" } });
    h.canvas.els = assembly();
    h.reconcile(false); await tick();
    h.commits.length = 0;

    const restored = h.canvas.els;                       // the pre-move snapshot the history holds
    // Commit A — the drag. One batch, the whole assembly, moved coordinates.
    const moved = move(restored, -218, -223);
    h.canvas.els = moved;
    h.reconcile(false); h.sync.flushGesture(); await tick();
    expect(h.commits).toHaveLength(1);
    expect(h.commits[0]).toHaveLength(6);

    // Ctrl+Z — applySnapshot restores the canvas and declares itself the authority, then flushes.
    h.canvas.els = restored;
    h.sync.noteLocalAuthority();
    h.sync.reconcile({ els: restored }, {});
    h.sync.flushGesture(); await tick();
    expect(h.commits).toHaveLength(2);                   // commit B — immediate
    expect(h.commits[1]).toHaveLength(6);                // the WHOLE assembly…
    for (const o of h.commits[1]) expect(o.data.cx).toBe(restored.find((e) => e.id === o.id).cx); // …restored

    // …and NOW the delayed realtime echo of commit A arrives for two members.
    for (const id of ["k4", "k5"]) {
      const stale = moved.find((e) => e.id === id);
      const res = h.sync.applyRemoteRow(rowFor(stale, 99, "me"));
      expect(res.action, `${id}: an undone commit's echo must not reach the canvas`).toBe("ignore");
    }

    // The canvas is untouched, so no third batch is minted.
    h.reconcile(false); h.runTimers(); await tick();
    const straggler = h.commits.slice(2).flat();
    const resurrected = straggler.filter((o) => o.data && o.data.cx === moved.find((e) => e.id === o.id)?.cx);
    expect(resurrected, "no op may carry the undone geometry").toEqual([]);
    for (const o of straggler) expect(o.data.cx).toBe(restored.find((e) => e.id === o.id).cx);
  });

  it("if the shadow adopted the echo's rev, the re-assertion goes out as the WHOLE assembly", async () => {
    const h = makeHarness({ sync: { selfUid: "me" } });
    h.canvas.els = assembly();
    h.reconcile(false); await tick();
    const restored = h.canvas.els;
    h.canvas.els = move(restored, -218, -223);
    h.reconcile(false); h.sync.flushGesture(); await tick();
    h.canvas.els = restored;
    h.sync.noteLocalAuthority();
    h.sync.reconcile({ els: restored }, {}); h.sync.flushGesture(); await tick();
    h.commits.length = 0;
    // A late FOREIGN row for one bonded child (not our bytes) — it upserts, the canvas is re-trued
    // by the app, and the correction commits assembly-closed rather than as a lone straggler.
    const foreign = { ...restored.find((e) => e.id === "k4"), cx: restored[0].cx - 999 };
    expect(h.sync.applyRemoteRow(rowFor(foreign, 120, "someone-else")).action).toBe("upsert");
    h.canvas.els = restored.map((e) => (e.id === "k4" ? { ...e, w: e.w + 1 } : e)); // a later real edit
    h.reconcile(false); h.sync.flushGesture(); await tick();
    expect(h.commits).toHaveLength(1);
    expect(h.commits[0].length).toBeGreaterThanOrEqual(1);
    for (const o of h.commits[0]) expect(o.data.cx).toBe(restored.find((e) => e.id === o.id).cx);
  });

  it("an own echo from the CURRENT epoch still upserts (the stale-seed re-true is unchanged)", async () => {
    const h = makeHarness({ sync: { selfUid: "me" } });
    h.canvas.els = [host("b1")];
    h.reconcile(false); await tick();
    h.sync.seed([{ kind: "el", id: "b1", data: host("b1"), rev: 1, z_index: 0 }]); // stale re-seed
    const mine = host("b1", { cx: 7 });
    h.canvas.els = [mine];
    h.reconcile(false); h.sync.flushGesture(); await tick();
    h.sync.seed([{ kind: "el", id: "b1", data: host("b1"), rev: 1, z_index: 0 }]); // stale re-seed again
    // No snapshot has been applied, so this echo is still current truth → it re-trues the canvas.
    expect(h.sync.applyRemoteRow(rowFor(mine, 50, "me")).action).toBe("upsert");
  });

  it("a buffered REMOVE survives a snapshot — a remote delete is not undone by a local undo", () => {
    // The SitePlanner-side rule, asserted on the shipped source (the buffer lives in the component).
    const src = readFileSync(fileURLToPath(new URL("../src/workspaces/site-planner/SitePlanner.jsx", import.meta.url)), "utf8");
    const idx = src.indexOf("const applySnapshot = (s) => {");
    const block = src.slice(idx, src.indexOf("\n  };", idx));
    expect(block).toMatch(/pendingRemoteRef\.current\.filter\(\(i\) => i && i\.action === "remove"\)/);
    expect(block).toMatch(/noteLocalAuthority\(\)/);
  });
});

/* Round 3 (2026-07-29, live re-verification of V509b) — the STALE CACHE, the MISSED tear, and the
 * HOT LOOP. A plan opened in a profile holding an older cached copy wrote that cached geometry back
 * over canonical rows in FOUR transactions across six seconds, for four members of a twelve-member
 * assembly; the bonded healer did not catch a 218 ft displacement; and a stale tab hammered the RPC
 * once a second with every op rejected. */
describe("NEW-1 (round 3) — rows are canonical across a seed; a stale cache never wins", () => {
  const rowsFor = (els, rev = 4) => els.map((e, i) => ({ kind: "el", id: e.id, data: e, rev, z_index: i * 1024 }));

  it("a divergent cached copy of 4 of 12 assembly members commits NOTHING — the rows are adopted", async () => {
    const adopted = [];
    const h = makeHarness({ sync: { onRowsCanonical: (a) => adopted.push(...a) } });
    const canonical = assembly();
    h.sync.seed(rowsFor(canonical));                       // the server's current truth

    // The on-device cache replays an old drag for a SUBSET of the assembly (the measured shape:
    // a uniform stale delta on four members while the rest hold canonical values).
    const staleIds = new Set(["k1", "k2", "k4", "k5"]);
    h.canvas.els = canonical.map((e) => (staleIds.has(e.id) ? { ...e, cx: e.cx - 218, cy: e.cy - 223 } : e));

    h.sync.reconcile(h.canvas, { afterSeed: true });
    h.runTimers(); await tick();

    expect(h.commits, "a stale cache must not write anything back").toEqual([]);
    expect(adopted.map((a) => a.id).sort()).toEqual(["k1", "k2", "k4", "k5"]);
    for (const a of adopted) {
      const want = canonical.find((e) => e.id === a.id);
      expect(a.el.cx).toBe(want.cx);
      expect(a.el.cy).toBe(want.cy);
    }
  });

  it("NEVER a 4-op commit: whatever goes out after a seed is the whole assembly or nothing", async () => {
    const h = makeHarness();
    const canonical = assembly();
    h.sync.seed(rowsFor(canonical));
    const staleIds = new Set(["k1", "k2", "k4", "k5"]);
    h.canvas.els = canonical.map((e) => (staleIds.has(e.id) ? { ...e, cx: e.cx - 218 } : e));
    h.sync.reconcile(h.canvas, { afterSeed: true });
    h.runTimers(); await tick();
    for (const batch of h.commits) expect(batch.length === 6 || batch.length === 0).toBe(true);
    expect(h.commits.flat().length).toBe(0);
  });

  it("a PENDING local edit is still protected — it explains the divergence, so it commits", async () => {
    const h = makeHarness();
    const canonical = assembly();
    h.sync.seed(rowsFor(canonical));
    h.canvas.els = canonical.map((e) => (e.id === "k1" ? { ...e, cy: e.cy + 40 } : e));
    h.sync.reconcile(h.canvas, {});                        // a real edit, diffed normally…
    h.canvas.els = h.canvas.els.map((e) => (e.id === "k1" ? { ...e, cy: e.cy + 1 } : e));
    h.sync.reconcile(h.canvas, { afterSeed: true });        // …then a refetch lands
    h.runTimers(); await tick();
    expect(h.commits.flat().map((o) => o.id)).toContain("k1"); // not discarded as a cache replay
  });

  it("an element the server has NEVER seen still wins locally (B124 / B756 unchanged)", async () => {
    const h = makeHarness();
    const canonical = assembly();
    h.sync.seed(rowsFor(canonical));
    const born = { id: "local-only", type: "parking", cx: 10, cy: 20, w: 100, h: 60, rot: 0, z: 0 };
    h.canvas.els = [...canonical, born];
    h.sync.reconcile(h.canvas, { afterSeed: true });
    h.runTimers(); await tick();
    expect(h.commits.flat().map((o) => o.id)).toEqual(["local-only"]);
    expect(h.commits.flat()[0].op).toBe("create");
  });
});

describe("NEW-2 (round 3) — strandedness is measured against the COMPUTED anchor, not a distance", () => {
  const planWithStack = () => ([
    { id: "b1", type: "building", cx: 0, cy: 0, w: 600, h: 300, rot: 0, dock: "single", dockSide: "bottom" },
    { id: "court", type: "paving", attachedTo: "b1", truckCourt: { side: "bottom" }, noFit: true, cx: 0, cy: 217.5, w: 600, h: 135, rot: 0 },
    { id: "trailer", type: "trailer", attachedTo: "b1", forCourt: "court", prevZone: "court", noFit: true, cx: 0, cy: 310, w: 600, h: 50, rot: 0 },
  ]);
  const byId = (list, id) => list.find((e) => e.id === id);

  // The reported displacement: 218 ft along the wall, 223 ft across it — big, but nowhere near the
  // 2,086 ft the V508 case used, and the old absolute-distance test let it straight through.
  for (const d of [50, 200, 2000]) {
    it(`a stack member displaced ${d} ft is healed back onto its host`, () => {
      const torn = planWithStack().map((e) => (e.id === "court" || e.id === "trailer" ? { ...e, cx: e.cx - d, cy: e.cy - d } : e));
      const healed = normalizeBondedChildren(torn);
      expect(byId(healed, "court").cx).toBeCloseTo(0, 6);
      expect(byId(healed, "court").cy).toBeCloseTo(217.5, 6);
      expect(byId(healed, "trailer").cx).toBeCloseTo(0, 6);
      expect(byId(healed, "trailer").cy).toBeCloseTo(310, 6);
    });
  }

  it("the EXACT reported displacement (218 west / 223 north) heals — it did not before", () => {
    const torn = planWithStack().map((e) => (e.id === "court" || e.id === "trailer" ? { ...e, cx: e.cx - 218, cy: e.cy - 223 } : e));
    const healed = normalizeBondedChildren(torn);
    expect(byId(healed, "court").cy).toBeCloseTo(217.5, 6);
    expect(byId(healed, "trailer").cy).toBeCloseTo(310, 6);
  });

  it("a correct stack is returned UNCHANGED, and a resized depth is respected not reset", () => {
    const ok = planWithStack();
    expect(stableStringify(normalizeBondedChildren(ok))).toBe(stableStringify(ok));
    // A deeper court (the user dragged its depth) re-anchors the trailer without resetting anything.
    const deeper = ok.map((e) => (e.id === "court" ? { ...e, h: 200, cy: 150 + 100 } : e));
    const healed = normalizeBondedChildren(deeper);
    expect(byId(healed, "court").h).toBe(200);
    expect(byId(healed, "court").cy).toBeCloseTo(250, 6);
  });

  it("a legitimately SLID side-parking row keeps its slide; one slid off the wall is re-centred", () => {
    const b = { id: "b1", type: "building", cx: 0, cy: 0, w: 600, h: 300, rot: 0 };
    const walk = { id: "w", type: "sidewalk", attachedTo: "b1", sidewalkSide: "left", cx: -152.5, cy: 0, w: 5, h: 300, rot: 0 };
    const park = { id: "p", type: "parking", attachedTo: "b1", sideParkSide: "left", cx: -335, cy: 60, w: 60, h: 300, rot: 0 };
    expect(byId(normalizeBondedChildren([b, walk, park]), "p").cy).toBeCloseTo(60, 6);
    // Slid clean off the wall it is bonded to → the number is wreckage, so it re-centres.
    const off = byId(normalizeBondedChildren([b, walk, { ...park, cy: 900 }]), "p");
    expect(off.cy).toBeCloseTo(0, 6);
  });

  it("offAnchor is pure and never claims a tear it cannot measure", () => {
    expect(offAnchor({ acrossHave: 217.5, acrossWant: 217.5, alongHave: 0, alongLimit: 600 })).toBe(false);
    expect(offAnchor({ acrossHave: 217.5, acrossWant: 217.5, alongHave: 900, alongLimit: 600 })).toBe(true);
    expect(offAnchor({ acrossHave: -5.5, acrossWant: 217.5, alongHave: 0, alongLimit: 600 })).toBe(true);
    expect(offAnchor({ acrossHave: NaN, acrossWant: 217.5 })).toBe(false);
  });
});

describe("NEW-3 (round 3) — a rejected commit backs off and eventually gives up", () => {
  // Every op rejected, forever — a tab running against a plan that has moved on.
  const allRejected = (ops) => ({ ok: true, results: ops.map((o) => ({ id: o.id, status: "conflict", row: { rev: 99, data: { id: o.id, type: "building", cx: -1, cy: -1, w: 1, h: 1, rot: 0 }, z_index: 0 } })) });

  it("the retry interval GROWS instead of hammering at the debounce rate", async () => {
    // Record the delay the engine asks for each time it schedules a retry. Pre-fix every rejected
    // batch re-queued on the plain 750 ms debounce — the ~1 RPC/s hot loop that was measured live.
    const delays = [];
    const timers = [];
    const h = makeHarness({
      responder: allRejected,
      sync: {
        maxRejectStreak: 99,                                  // don't give up — we're measuring the curve
        setTimer: (fn, ms) => { delays.push(ms); timers.push(fn); return timers.length; },
        clearTimer: () => {},
      },
    });
    h.canvas.els = [host("b1")];
    h.sync.reconcile(h.canvas, {}); await tick();              // create → every op rejected
    for (let i = 0; i < 4; i++) { const fn = timers.pop(); if (fn) fn(); await tick(); }

    const retries = delays.filter((ms) => ms !== 750);         // the debounce is not a retry
    expect(retries.length).toBeGreaterThanOrEqual(3);
    for (let i = 1; i < retries.length; i++) expect(retries[i]).toBeGreaterThan(retries[i - 1]);
    expect(retries[0]).toBeGreaterThanOrEqual(1000);           // …and the first wait already exceeds the old debounce
  });

  it("after N consecutive all-rejected batches it STOPS and reports that the tab is out of date", async () => {
    const events = [];
    const h = makeHarness({ responder: allRejected, sync: { onEvent: (e) => events.push(e), maxRejectStreak: 3 } });
    h.canvas.els = [host("b1")];
    h.sync.reconcile(h.canvas, {}); await tick();
    for (let i = 0; i < 8; i++) { h.runTimers(); await tick(); }
    expect(h.sync.state).toBe("stale");
    expect(events.filter((e) => e.type === "client-stale").length).toBeGreaterThan(0);
    const before = h.commits.length;
    h.runTimers(); await tick();                              // no timer left to fire
    expect(h.commits.length).toBe(before);                    // the hot loop has stopped
    expect(before).toBeLessThan(8);                           // and it stopped EARLY, not after 8 tries
  });

  it("a client-stale event becomes a plain-English reload prompt", () => {
    const t = toastForSyncEvent({ type: "client-stale", streak: 4, pending: 8 }, { name: "you", label: "a building" });
    expect(t).toBeTruthy();
    expect(t.text).toMatch(/out of date/i);
    expect(t.text).toMatch(/[Rr]eload/);
    expect(t.action).toBe(null);                              // nothing to zoom to — it is not about one element
  });

  it("one accepted op breaks the streak (a healthy client never goes stale)", async () => {
    let rejectNext = true;
    const h = makeHarness({
      responder: (ops) => (rejectNext ? allRejected(ops) : { ok: true, results: ops.map((o) => ({ id: o.id, status: "ok", rev: (o.expected || 0) + 1 })) }),
      sync: { maxRejectStreak: 2 },
    });
    h.canvas.els = [host("b1")];
    h.sync.reconcile(h.canvas, {}); await tick();
    rejectNext = false;
    h.runTimers(); await tick();
    expect(h.sync.state).not.toBe("stale");
  });
});

/* Round 4 (2026-07-29, live re-verification of V509b on 2bdc985) — the client was CORRECT on the
 * wire (exactly two 12-op commits, nothing else) and the plan still landed torn: of the undo
 * batch's twelve ops the server accepted ONE (the host) and refused eleven, and the client treated
 * that as settled. Client-side atomicity does not survive a partially-rejected batch. */
describe("NEW-1 (round 4) — a partially-accepted batch is never settled", () => {
  const conflictRow = (o) => ({ rev: 500, data: { ...o.data, cx: (o.data.cx || 0) - 236, cy: (o.data.cy || 0) + 180 }, z_index: 0, updated_by: "me" });
  // The measured server behaviour: the host's op lands, every bonded child is refused.
  const onlyHostAccepted = (ops) => ({
    ok: true,
    results: ops.map((o) => (o.id === "b1"
      ? { id: o.id, status: "ok", rev: 79 }
      : { id: o.id, status: "conflict", row: conflictRow(o) })),
  });

  it("1-of-12 accepted → the client re-commits the rest of the assembly instead of going quiet", async () => {
    const events = [];
    const h = makeHarness({ sync: { selfUid: "me", isDirectEdit: () => false, onEvent: (e) => events.push(e) } });
    h.canvas.els = assembly();
    h.reconcile(false); await tick();
    h.commits.length = 0;

    h.setResponder(onlyHostAccepted);
    h.canvas.els = move(h.canvas.els, -236, 180);
    h.reconcile(false); h.sync.flushGesture(); await tick();

    expect(h.commits).toHaveLength(1);
    expect(h.commits[0]).toHaveLength(6);
    // The split is DETECTED and said out loud…
    const split = events.filter((e) => e.type === "assembly-split");
    expect(split.length).toBeGreaterThan(0);
    expect(split[0].ids.length).toBe(5);                       // every refused child, not just some
    // …and the refused members are re-queued rather than abandoned.
    expect(h.sync.pendingCount()).toBe(5);
    h.setResponder((ops) => ({ ok: true, results: ops.map((o) => ({ id: o.id, status: "ok", rev: 600 })) }));
    h.runTimers(); await tick();
    expect(h.commits).toHaveLength(2);
    expect(h.commits[1]).toHaveLength(5);                      // the retry carries the whole remainder
    for (const o of h.commits[1]) expect(o.data.cx).toBe(h.canvas.els.find((e) => e.id === o.id).cx);
  });

  it("a DERIVED op never yields to OUR OWN earlier write — that was the silence", async () => {
    // The B1099 yield is right against another writer and catastrophic against ourselves: on an undo
    // every bonded child conflicts with the move being undone, and yielding left eleven of twelve
    // ops standing down while the host's went through.
    const h = makeHarness({ sync: { selfUid: "me", isDirectEdit: () => false } });
    h.canvas.els = assembly();
    h.reconcile(false); await tick();
    h.commits.length = 0;
    h.setResponder(onlyHostAccepted);
    h.canvas.els = move(h.canvas.els, -236, 180);
    h.reconcile(false); h.sync.flushGesture(); await tick();
    expect(h.sync.pendingCount()).toBeGreaterThan(0);          // NOT settled
  });

  it("a genuinely FOREIGN row still wins over derived churn (B1099 unregressed)", async () => {
    const h = makeHarness({ sync: { selfUid: "me", isDirectEdit: () => false } });
    h.canvas.els = assembly();
    h.reconcile(false); await tick();
    h.commits.length = 0;
    h.setResponder((ops) => ({ ok: true, results: ops.map((o) => ({ id: o.id, status: "conflict", row: { rev: 500, data: { ...o.data, cx: 9 }, z_index: 0, updated_by: "someone-else" } })) }));
    h.canvas.els = move(h.canvas.els, -236, 180);
    h.reconcile(false); h.sync.flushGesture(); await tick();
    expect(h.sync.pendingCount()).toBe(0);                     // all refused by ANOTHER writer → yield, no re-push
  });

  it("an assembly that will not commit whole escalates loudly instead of looping", async () => {
    const events = [];
    const h = makeHarness({ sync: { selfUid: "me", isDirectEdit: () => false, onEvent: (e) => events.push(e), maxRejectStreak: 2 } });
    h.canvas.els = assembly();
    h.reconcile(false); await tick();
    h.setResponder(onlyHostAccepted);
    h.canvas.els = move(h.canvas.els, -236, 180);
    h.reconcile(false); h.sync.flushGesture(); await tick();
    for (let i = 0; i < 6; i++) { h.runTimers(); await tick(); }
    expect(h.sync.state).toBe("stale");
    // It goes loud, and the split itself was reported on the way — the escalation may arrive via
    // the split counter or, once the retry contains only refused ops, via the all-rejected counter.
    // Either is correct; what matters is that it stops and tells the user, and never falls silent.
    expect(events.some((e) => e.type === "client-stale")).toBe(true);
    expect(events.some((e) => e.type === "assembly-split")).toBe(true);
  });
});

/* B1117 — the SERVER-side all-or-nothing group commit is live (migration applied and
 * rollback-verified against the real Tsakiris assembly 2026-07-29: a two-op atomic call with one
 * good rev and one stale one left BOTH rows untouched). These cover the client half. */
describe("B1117 — the client asks for atomic group commits and honours the rollback", () => {
  // Capture what the engine asked for alongside the ops.
  function atomicHarness(responder) {
    const asked = [];
    const events = [];
    const timers = [];
    let clock = 1000;
    const canvas = { els: [], markups: [], measures: [], callouts: [], parcels: [] };
    const sync = createElementSync({
      siteId: "s",
      commit: async (ops, opts) => { asked.push({ ops, atomic: !!(opts && opts.atomic) }); return responder(ops); },
      now: () => clock,
      setTimer: (fn, ms) => { timers.push({ fn, ms }); return timers.length; },
      clearTimer: () => {},
      onEvent: (e) => events.push(e),
      liveCollections: () => canvas,
      patchElement: (kind, id, patch) => { canvas.els = canvas.els.map((e) => (e.id === id ? { ...e, ...patch } : e)); },
      selfUid: "me",
    });
    sync.seed([]);
    return { sync, asked, events, canvas, runTimers: () => { const d = timers.splice(0); d.forEach((t) => t.fn()); } };
  }
  const allOk = (ops) => ({ ok: true, results: ops.map((o) => ({ id: o.id, status: "ok", rev: (o.expected || 0) + 1 })) });

  it("asks for atomic ONLY when the batch spans more than one member of an assembly", async () => {
    const h = atomicHarness(allOk);
    h.canvas.els = assembly();
    h.sync.reconcile(h.canvas, {}); await tick();
    expect(h.asked[0].atomic, "a 6-op assembly batch is atomic").toBe(true);

    const h2 = atomicHarness(allOk);
    h2.canvas.els = [host("b1")];
    h2.sync.reconcile(h2.canvas, {}); await tick();
    expect(h2.asked[0].atomic, "a lone element has nothing to be atomic about").toBe(false);

    const h3 = atomicHarness(allOk);
    h3.canvas.els = [host("b1"), { id: "solo", type: "parking", cx: 9, cy: 9, w: 10, h: 10, rot: 0 }];
    h3.sync.reconcile(h3.canvas, {}); await tick();
    expect(h3.asked[0].atomic, "two UNRELATED elements are not an assembly").toBe(false);
  });

  it("`applied:false` means NOTHING landed — an op whose own status says ok is NOT treated as committed", async () => {
    // The exact shape the live rollback test returned: one op ok, one conflict, nothing written.
    let firstCall = true;
    const h = atomicHarness((ops) => {
      if (!firstCall) return allOk(ops);
      firstCall = false;
      return {
        ok: true,
        applied: false,
        results: ops.map((o, i) => (i === 0
          ? { id: o.id, status: "ok", rev: 64 }
          : { id: o.id, status: "conflict", row: { rev: 66, data: o.data, z_index: 0, updated_by: "me" } })),
      };
    });
    h.canvas.els = assembly();
    h.sync.reconcile(h.canvas, {}); await tick();

    expect(h.asked).toHaveLength(1);
    // Every op is re-queued, including the one the server reported "ok" — because it was rolled back.
    expect(h.sync.pendingCount()).toBe(assembly().length);
    expect(h.events.some((e) => e.type === "assembly-split" && e.rolledBack === true)).toBe(true);
    // …and the retry carries the whole group again.
    h.runTimers(); await tick();
    expect(h.asked).toHaveLength(2);
    expect(h.asked[1].ops).toHaveLength(assembly().length);
    expect(h.sync.pendingCount()).toBe(0);
  });

  it("the rollback adopts the FRESH revs so the retry does not repeat the same stale expectation", async () => {
    let firstCall = true;
    const h = atomicHarness((ops) => {
      if (!firstCall) return allOk(ops);
      firstCall = false;
      return { ok: true, applied: false, results: ops.map((o) => ({ id: o.id, status: "conflict", row: { rev: 500, data: o.data, z_index: 0, updated_by: "me" } })) };
    });
    h.canvas.els = assembly();
    h.sync.reconcile(h.canvas, {}); await tick();
    h.runTimers(); await tick();
    for (const o of h.asked[1].ops) if (o.op === "update") expect(o.expected).toBe(500);
  });

  it("a group that will not commit whole escalates loudly rather than retrying forever", async () => {
    const h = atomicHarness((ops) => ({ ok: true, applied: false, results: ops.map((o) => ({ id: o.id, status: "conflict", row: { rev: 500, data: o.data, z_index: 0, updated_by: "me" } })) }));
    h.canvas.els = assembly();
    h.sync.reconcile(h.canvas, {}); await tick();
    for (let i = 0; i < 8; i++) { h.runTimers(); await tick(); }
    expect(h.sync.state).toBe("stale");
    expect(h.events.some((e) => e.type === "client-stale" && e.reason === "assembly-split")).toBe(true);
  });

  it("the plain (non-atomic) bare-array shape still works exactly as before", async () => {
    const h = atomicHarness(allOk);
    h.canvas.els = [host("b1")];
    h.sync.reconcile(h.canvas, {}); await tick();
    expect(h.asked[0].atomic).toBe(false);
    expect(h.sync.pendingCount()).toBe(0);              // settled normally, no rollback path taken
  });
});

/* B1120 — the gap that let a dead feature ship green.
 *
 * Every B1117 test drove the engine through a harness whose own `commit` accepted `(ops, opts)`.
 * The REAL adapter in SitePlanner.jsx was `commit: (ops) => commitElements(supabase, siteId, ops)` —
 * fixed arity, so the engine's `{ atomic }` was silently DISCARDED and every batch went out as the
 * plain 2-arg RPC with HTTP 200 and no error. Measured on production: eight commit_elements calls
 * across two drag+undo runs, every one with body keys `p_site` + `p_ops` only.
 *
 * So these tests assert the REQUEST BODY, not the gate's return value, with the real `commitElements`
 * in the loop. A mock that is more capable than the shipped adapter proves nothing about the
 * shipped adapter. */
describe("B1120 — the p_atomic REQUEST BODY, with the real transport in the loop", () => {
  // The engine → the real commitElements → a fake supabase client. Only the network is faked.
  function wiredHarness({ adapter } = {}) {
    const rpcCalls = [];
    const timers = [];
    const canvas = { els: [], markups: [], measures: [], callouts: [], parcels: [] };
    const client = {
      rpc: async (name, args) => {
        rpcCalls.push({ name, args });
        const results = (args.p_ops || []).map((o) => ({ id: o.id, status: "ok", rev: (o.expected || 0) + 1 }));
        return { data: args.p_atomic ? { applied: true, results } : results, error: null };
      },
    };
    // `adapter` lets a test wire the engine's commit hook EXACTLY as the app does — including the
    // broken fixed-arity form, so the guard can be proven to fire on it.
    const commit = adapter === "fixed-arity"
      ? (ops) => commitElements(client, "s", ops)
      : (ops, opts) => commitElements(client, "s", ops, opts);
    const reports = [];
    const events = [];
    const sync = createElementSync({
      siteId: "s",
      commit,
      now: () => 1000,
      setTimer: (fn, ms) => { timers.push({ fn, ms }); return timers.length; },
      clearTimer: () => {},
      report: (code, msg, ctx) => reports.push({ code, msg, ctx }),
      onEvent: (e) => events.push(e),
      liveCollections: () => canvas,
      patchElement: (kind, id, patch) => { canvas.els = canvas.els.map((e) => (e.id === id ? { ...e, ...patch } : e)); },
      selfUid: "me",
    });
    sync.seed([]);
    return { sync, rpcCalls, reports, events, canvas, runTimers: () => { const d = timers.splice(0); d.forEach((t) => t.fn()); } };
  }

  it("a 12-member assembly batch puts p_atomic ON THE WIRE", async () => {
    const h = wiredHarness();
    h.canvas.els = assembly();
    h.sync.reconcile(h.canvas, {}); await tick();
    expect(h.rpcCalls).toHaveLength(1);
    expect(Object.keys(h.rpcCalls[0].args).sort()).toEqual(["p_atomic", "p_ops", "p_site"]);
    expect(h.rpcCalls[0].args.p_atomic).toBe(true);
    expect(h.rpcCalls[0].args.p_ops).toHaveLength(6);
  });

  it("a single-element batch does NOT carry p_atomic (the production body shape, verbatim)", async () => {
    const h = wiredHarness();
    h.canvas.els = [host("b1")];
    h.sync.reconcile(h.canvas, {}); await tick();
    expect(Object.keys(h.rpcCalls[0].args).sort()).toEqual(["p_ops", "p_site"]);
  });

  it("THE REGRESSION ITSELF: a fixed-arity adapter drops the request — and is now caught LOUDLY", async () => {
    const h = wiredHarness({ adapter: "fixed-arity" });   // exactly the shipped bug
    h.canvas.els = assembly();
    h.sync.reconcile(h.canvas, {}); await tick();
    // The body really does go out without it — that is the production observation reproduced…
    expect(Object.keys(h.rpcCalls[0].args).sort()).toEqual(["p_ops", "p_site"]);
    // …and it can no longer happen in silence.
    expect(h.reports.some((r) => r.code === "element-atomic-request-lost")).toBe(true);
    expect(h.events.some((e) => e.type === "atomic-request-lost")).toBe(true);
  });

  it("the CORRECT adapter fires no such warning", async () => {
    const h = wiredHarness();
    h.canvas.els = assembly();
    h.sync.reconcile(h.canvas, {}); await tick();
    expect(h.reports.some((r) => r.code === "element-atomic-request-lost")).toBe(false);
  });

  it("a project WITHOUT the migration falls back quietly and is not reported as a wiring bug", async () => {
    // The one legitimate mismatch: PGRST202 → the latched 2-arg fallback. It reports itself via the
    // fallback path, so it must not also be flagged as a lost request.
    const rpcCalls = [];
    const timers = [];
    const canvas = { els: assembly(), markups: [], measures: [], callouts: [], parcels: [] };
    const client = {
      rpc: async (name, args) => {
        rpcCalls.push(args);
        if (args.p_atomic) return { data: null, error: { code: "PGRST202", message: "Could not find the function" } };
        return { data: (args.p_ops || []).map((o) => ({ id: o.id, status: "ok", rev: 1 })), error: null };
      },
    };
    const reports = [];
    const sync = createElementSync({
      siteId: "s2",
      commit: (ops, opts) => commitElements(client, "s2", ops, opts),
      now: () => 1000,
      setTimer: (fn, ms) => { timers.push({ fn, ms }); return timers.length; },
      clearTimer: () => {},
      report: (code) => reports.push(code),
      liveCollections: () => canvas,
      patchElement: () => {},
      selfUid: "me",
    });
    sync.seed([]);
    sync.reconcile(canvas, {}); await tick();
    expect(rpcCalls.some((a) => a.p_atomic)).toBe(true);            // it did try…
    expect(rpcCalls.some((a) => !("p_atomic" in a))).toBe(true);    // …then fell back and the write landed
    expect(reports.includes("element-atomic-request-lost")).toBe(false); // not a wiring bug
  });

  it("the shipped adapter forwards opts (anti-drift source guard)", () => {
    const src = readFileSync(fileURLToPath(new URL("../src/workspaces/site-planner/SitePlanner.jsx", import.meta.url)), "utf8");
    // A fixed-arity adapter is the exact shape of the bug; require the two-parameter form.
    expect(src).toMatch(/commit:\s*\(ops,\s*opts\)\s*=>\s*commitElements\(supabase,\s*siteId,\s*ops,\s*opts\)/);
    expect(src).not.toMatch(/commit:\s*\(ops\)\s*=>\s*commitElements/);
  });
});

describe("NEW-2 (round 4) — the heal catches a whole-assembly translation on a LARGE host", () => {
  // 882 × 510 — the owner's real building. Its half-diagonal alone is over 500 ft, so the coarse
  // distance test tolerated a 236/180 ft tear: the bigger the building, the bigger the tear it
  // allowed, which is backwards. The computed anchor does not scale with host size.
  const bigPlan = () => {
    const b = { id: "b1", type: "building", cx: 1117.2, cy: -13.85, w: 882, h: 510, rot: 0, dock: "cross" };
    const mk = (id, cy, h, extra) => ({ id, type: "paving", attachedTo: "b1", noFit: true, cx: 1117.2, cy, w: 882, h, rot: 0, ...extra });
    return [
      b,
      mk("court-n", -13.85 - 255 - 67.5, 135, { truckCourt: { side: "top" } }),
      { ...mk("trailer-n", -13.85 - 255 - 135 - 25, 50, { forCourt: "court-n", prevZone: "court-n" }), type: "trailer" },
      mk("court-s", -13.85 + 255 + 67.5, 135, { truckCourt: { side: "bottom" } }),
      { ...mk("trailer-s", -13.85 + 255 + 135 + 25, 50, { forCourt: "court-s", prevZone: "court-s" }), type: "trailer" },
    ];
  };
  const byId = (list, id) => list.find((e) => e.id === id);

  it("every child translated 236 ft west / 180 ft north is re-fitted on load", () => {
    const ok = bigPlan();
    const torn = ok.map((e) => (e.id === "b1" ? e : { ...e, cx: e.cx - 236, cy: e.cy - 180 }));
    const healed = [];
    const out = normalizeBondedChildren(torn, (h) => healed.push(h));
    for (const e of ok.slice(1)) {
      expect(byId(out, e.id).cx, `${e.id} x`).toBeCloseTo(e.cx, 6);
      expect(byId(out, e.id).cy, `${e.id} y`).toBeCloseTo(e.cy, 6);
    }
    expect(healed.map((x) => x.id).sort()).toEqual(["court-n", "court-s", "trailer-n", "trailer-s"]);
  });

  it("the same large plan, untorn, is returned byte-identical (no churn on a big building)", () => {
    const ok = bigPlan();
    expect(stableStringify(normalizeBondedChildren(ok))).toBe(stableStringify(ok));
  });

  it("a stack member on NO chain is still anchored (it used to be skipped entirely)", () => {
    const b = { id: "b1", type: "building", cx: 0, cy: 0, w: 882, h: 510, rot: 0 };
    // noFit, bonded, but heading no recognised dock chain and carrying no truckCourt tag.
    const orphan = { id: "orphan", type: "paving", attachedTo: "b1", noFit: true, cx: 0, cy: 255 + 67.5, w: 882, h: 135, rot: 0 };
    expect(stableStringify(normalizeBondedChildren([b, orphan]))).toBe(stableStringify([b, orphan])); // correct → untouched
    const torn = normalizeBondedChildren([b, { ...orphan, cx: -236, cy: orphan.cy - 180 }]);
    expect(byId(torn, "orphan").cx).toBeCloseTo(0, 6);
    expect(byId(torn, "orphan").cy).toBeCloseTo(322.5, 6);
  });

  it("a healed element is EXEMPT from rows-canonical, so the repair commits instead of being reverted", async () => {
    // The two guarantees would otherwise fight: the heal repairs the canvas, then rows-canonical
    // adopts the TORN rows straight back over it — and the broken copy wins.
    const h = makeHarness();
    const canonical = assembly();
    h.sync.seed(canonical.map((e, i) => ({ kind: "el", id: e.id, data: e, rev: 4, z_index: i * 1024 })));
    h.canvas.els = canonical.map((e) => (e.id === "k1" ? { ...e, cy: e.cy + 5 } : e)); // "healed" copy
    h.sync.reconcile(h.canvas, { afterSeed: true, exempt: new Set(["el:k1"]) });
    h.runTimers(); await tick();
    expect(h.commits.flat().map((o) => o.id)).toContain("k1");   // the repair is committed…
    // …while a NON-exempt stale divergence is still overruled by the rows.
    const h2 = makeHarness();
    h2.sync.seed(canonical.map((e, i) => ({ kind: "el", id: e.id, data: e, rev: 4, z_index: i * 1024 })));
    h2.canvas.els = canonical.map((e) => (e.id === "k1" ? { ...e, cy: e.cy + 5 } : e));
    h2.sync.reconcile(h2.canvas, { afterSeed: true });
    h2.runTimers(); await tick();
    expect(h2.commits).toEqual([]);
  });
});

describe("NEW-3 — a foreign row can win", () => {
  const rowFor = (el, rev, uid) => ({ kind: "el", id: el.id, data: el, rev, z_index: 0, updated_by: uid });

  it("a higher-rev foreign row carrying bytes this client never sent is ADOPTED, not ignored", () => {
    const h = makeHarness({ sync: { selfUid: "me" } });
    h.canvas.els = [host("b1")];
    // The client's own high-water rev sits at 9 while a stale refetch rolled its shadow back to 2 —
    // the exact state in which the old high-water guard swallowed a genuine foreign row.
    h.sync.seed([{ kind: "el", id: "b1", data: host("b1"), rev: 2, z_index: 0 }]);
    h.sync.reconcile({ els: [host("b1", { cx: 1 })] }, {});
    h.setResponder((ops) => ({ ok: true, results: ops.map((o) => ({ id: o.id, status: "ok", rev: 9 })) }));
    h.runTimers();
    return tick().then(() => {
      h.sync.seed([{ kind: "el", id: "b1", data: host("b1"), rev: 2, z_index: 0 }]); // stale refetch
      const repaired = host("b1", { cx: 1117.2, cy: -13.85 });
      const res = h.sync.applyRemoteRow(rowFor(repaired, 4, "someone-else"));
      expect(res.action).toBe("upsert");
      expect(res.el.cx).toBe(1117.2);
    });
  });

  it("our own echo at/below the high-water is still ignored (B812 unchanged)", async () => {
    const h = makeHarness({ sync: { selfUid: "me" } });
    h.sync.seed([{ kind: "el", id: "b1", data: host("b1"), rev: 2, z_index: 0 }]);
    h.sync.reconcile({ els: [host("b1", { cx: 1 })] }, {});
    h.setResponder((ops) => ({ ok: true, results: ops.map((o) => ({ id: o.id, status: "ok", rev: 9 })) }));
    h.runTimers(); await tick();
    h.sync.seed([{ kind: "el", id: "b1", data: host("b1"), rev: 2, z_index: 0 }]);
    // Same rev band, but stamped with OUR uid → still our echo.
    expect(h.sync.applyRemoteRow(rowFor(host("b1", { cx: 4 }), 4, "me")).action).toBe("ignore");
  });

  it("a foreign row beats a pending DERIVED op — the client adopts it instead of re-pushing", async () => {
    const h = makeHarness({
      sync: { selfUid: "me", isDirectEdit: () => false }, // every op is cascade-derived
    });
    h.canvas.els = assembly();
    h.reconcile(false); await tick();
    h.commits.length = 0;

    // A derived edit is queued locally…
    h.canvas.els = h.canvas.els.map((e) => (e.id === "k1" ? { ...e, cy: 9999 } : e));
    h.reconcile(false);
    // …and a foreign repair lands for the same element, carrying bytes this client never sent.
    const repaired = { ...assembly()[1], cy: 220.75 };
    const res = h.sync.applyRemoteRow(rowFor(repaired, 5, "someone-else"));
    expect(res.action).toBe("upsert");                       // the row reaches the canvas
    expect(res.el.cy).toBe(220.75);
    h.canvas.els = h.canvas.els.map((e) => (e.id === "k1" ? repaired : e));

    // …and nothing re-pushes our stale copy over it.
    h.runTimers(); await tick();
    const pushed = h.commits.flat().filter((o) => o.id === "k1" && o.data && o.data.cy === 9999);
    expect(pushed).toHaveLength(0);
  });

  it("a foreign row still LOSES to a pending DIRECT user edit (the B673 matrix is unchanged)", async () => {
    const h = makeHarness({ sync: { selfUid: "me" } }); // isDirectEdit defaults to "everything is direct"
    h.canvas.els = [host("b1")];
    h.reconcile(false); await tick();
    h.canvas.els = [host("b1", { cx: 50 })];
    h.reconcile(false);
    const res = h.sync.applyRemoteRow(rowFor(host("b1", { cx: 900 }), 5, "someone-else"));
    expect(res.action).toBe("ignore");                       // local edit stays on the canvas
    expect(h.events.some((e) => e.type === "remote-while-dirty")).toBe(true); // …loudly
  });
});

describe("NEW-4 — a torn assembly is healed on the site_elements read path", () => {
  // A building with a full dock stack + a wall strip and a side-parking row, all correctly placed.
  const plan = () => {
    const b = { id: "b1", type: "building", cx: 0, cy: 0, w: 600, h: 300, rot: 0, dock: "single", dockSide: "bottom" };
    const court = { id: "court", type: "paving", attachedTo: "b1", truckCourt: { side: "bottom" }, noFit: true, cx: 0, cy: 217.5, w: 600, h: 135, rot: 0 };
    const trailer = { id: "trailer", type: "trailer", attachedTo: "b1", forCourt: "court", prevZone: "court", noFit: true, cx: 0, cy: 310, w: 600, h: 50, rot: 0 };
    const walk = { id: "walk", type: "sidewalk", attachedTo: "b1", sidewalkSide: "top", cx: 0, cy: -152.5, w: 600, h: 5, rot: 0 };
    return [b, court, trailer, walk];
  };
  const rowsOf = (els) => els.map((e, i) => ({ kind: "el", id: e.id, data: e, rev: 1, z_index: i * 1024 }));
  const byId = (list, id) => list.find((e) => e.id === id);

  it("a stranded dock zone and trailer strip are BOTH re-fitted to their host on load", () => {
    const els = plan();
    // The production tear: the host committed ~2,000 ft east, three children stayed behind.
    const torn = els.map((e) => (e.id === "b1" ? { ...e, cx: 2000 } : e));
    const healed = [];
    const model = rowsToModel({}, rowsOf(torn), { onHeal: (x) => healed.push(x) });

    const b = byId(model.els, "b1");
    const court = byId(model.els, "court");
    const trailer = byId(model.els, "trailer");
    const walk = byId(model.els, "walk");
    expect(b.cx).toBe(2000);                                  // the host is never second-guessed
    expect(court.cx).toBeCloseTo(2000, 6);                    // …the children come to it
    expect(court.cy).toBeCloseTo(217.5, 6);
    expect(trailer.cx).toBeCloseTo(2000, 6);
    expect(trailer.cy).toBeCloseTo(310, 6);
    expect(walk.cx).toBeCloseTo(2000, 6);
    expect(walk.cy).toBeCloseTo(-152.5, 6);
    // …and it says what it did.
    expect(healed.map((x) => x.id).sort()).toEqual(["court", "trailer", "walk"]);
  });

  it("a correct record is returned UNCHANGED (identity-preserving — no load-time churn)", () => {
    const els = plan();
    const model = rowsToModel({}, rowsOf(els));
    for (const e of els) expect(stableStringify(byId(model.els, e.id))).toBe(stableStringify(e));
  });

  it("healing is idempotent — a second read changes nothing", () => {
    const torn = plan().map((e) => (e.id === "b1" ? { ...e, cx: 2000 } : e));
    const once = rowsToModel({}, rowsOf(torn)).els;
    const twice = rowsToModel({}, rowsOf(once)).els;
    expect(stableStringify(twice)).toBe(stableStringify(once));
  });

  it("a side-parking row torn off its host is re-centred; one still on the wall keeps its slide", () => {
    const b = { id: "b1", type: "building", cx: 0, cy: 0, w: 600, h: 300, rot: 0 };
    const walk = { id: "w", type: "sidewalk", attachedTo: "b1", sidewalkSide: "left", cx: -152.5, cy: 0, w: 5, h: 300, rot: 0 };
    // Flush outside the sidewalk (wall at −300, 5 ft walk, 60 ft deep row → centre −335), and
    // deliberately slid 60 ft along the wall — user intent, never normalised (B1039 owner rule).
    const park = { id: "p", type: "parking", attachedTo: "b1", sideParkSide: "left", cx: -335, cy: 60, w: 60, h: 300, rot: 0 };
    const kept = normalizeBondedChildren([b, walk, park]);
    expect(byId(kept, "p").cy).toBeCloseTo(60, 6);            // slide preserved
    expect(byId(kept, "p").cx).toBeCloseTo(-335, 6);
    // Now tear it off entirely — the along-wall number is wreckage, so the re-fit re-centres it.
    const healed = normalizeBondedChildren([b, walk, { ...park, cy: 2400 }]);
    expect(byId(healed, "p").cy).toBeCloseTo(0, 6);
    expect(byId(healed, "p").cx).toBeCloseTo(-335, 6);
  });

  it("strandedFromHost measures the bond's maximum legal reach — it never fires on a placement", () => {
    const b = { cx: 0, cy: 0, w: 600, h: 300 };
    expect(strandedFromHost(b, { cx: 0, cy: 310, w: 600, h: 50 }, 185)).toBe(false); // outermost stack member
    expect(strandedFromHost(b, { cx: 2000, cy: 310, w: 600, h: 50 }, 185)).toBe(true);
    expect(strandedFromHost(b, { cx: NaN, cy: 0, w: 1, h: 1 })).toBe(false);         // no centre → no claim
  });
});
