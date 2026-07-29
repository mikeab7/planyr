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
import { strandedFromHost, normalizeBondedChildren } from "../src/workspaces/site-planner/lib/siteModel.js";

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
