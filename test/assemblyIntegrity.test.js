/* NEW-1 / NEW-2 — the bonded-assembly INVARIANT, its DETECTOR, and the six races that must not
 * be able to leave a child off its host.
 *
 * THE HISTORY THIS SUITE EXISTS TO END. Eight merged PRs attacked this one symptom (#847, #849,
 * #850, #851, #852, #853, #854, #857) and it kept coming back. Every one of them closed a specific
 * interleaving in the WRITE path — a straggling echo, a partly-accepted batch, a stale cache, a
 * fixed-arity adapter that dropped the atomic flag. Closing interleavings makes the bad state
 * harder to REACH; it never makes it impossible to REPRESENT, and something always found the next
 * interleaving.
 *
 * The structural fix asserted here is different in kind: a bonded child's world position is
 * REDUNDANT — derivable from its host — so it is re-derived at every seam where a child can arrive
 * without its host. A torn assembly therefore cannot be put on the canvas and, the half that
 * matters, cannot be put on the WIRE. These tests do not check that any particular race is closed;
 * they check that the OUTCOME of each race is the same coherent assembly, which is the property
 * that does not depend on enumerating races correctly.
 *
 * The geometry is the owner's real one (site sms7v3ua7ksy, building e7373vqgilf): a 260 × 708.58
 * building at 354.818°, a truck court on its right face, and sidewalk + parking pairs on the west
 * and north ends. The re-derived west sidewalk lands at (−542.99, −697.38) and the west parking at
 * (−575.36, −694.45) — the two positions the owner computed BY HAND from the host's frame before
 * this work started, which is the check that the derivation asserted here is the right one.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { assemblyIntegrity, assemblyTears, tearPayload, ASSEMBLY_TEAR_TOL_FT } from "../src/workspaces/site-planner/lib/assemblyIntegrity.js";
import { createElementSync } from "../src/workspaces/site-planner/lib/elementSync.js";

const tick = () => new Promise((r) => setTimeout(r, 0));
const read = (p) => readFileSync(fileURLToPath(new URL(p, import.meta.url)), "utf8");

/* ---- the owner's assembly ------------------------------------------------------------------
 * Built by CANONICALISING a rough layout through the invariant itself, so the fixture is coherent
 * by construction and the tests never hand-encode a derived coordinate (which would just be a
 * second derivation to keep in sync — the exact failure mode this module exists to remove). */
const HOST = { id: "b1", type: "building", cx: -411.03, cy: -709.35, w: 260, h: 708.58, rot: 354.818, z: 1024 };
const rough = () => [
  { ...HOST },
  { id: "court", type: "paving", attachedTo: "b1", truckCourt: { side: "right" }, noFit: true, cx: 0, cy: 0, w: 135, h: 708.58, rot: 354.818, z: 2048 },
  { id: "swW", type: "sidewalk", attachedTo: "b1", sidewalkSide: "left", cx: 0, cy: 0, w: 5, h: 708.58, rot: 354.818, z: 3072 },
  { id: "pkW", type: "parking", attachedTo: "b1", sideParkSide: "left", cx: 0, cy: 0, w: 60, h: 708.58, rot: 354.818, z: 4096 },
  { id: "swN", type: "sidewalk", attachedTo: "b1", sidewalkSide: "top", cx: 0, cy: 0, w: 260, h: 5, rot: 354.818, z: 5120 },
  { id: "pkN", type: "parking", attachedTo: "b1", sideParkSide: "top", cx: 0, cy: 0, w: 260, h: 60, rot: 354.818, z: 6144 },
];
const ASSEMBLY = assemblyIntegrity(rough()).els;
// A second, independent assembly a long way off — for the multi-select case.
const ASSEMBLY_B = assemblyIntegrity(rough().map((e) => ({
  ...e,
  id: e.id + "_2",
  attachedTo: e.attachedTo ? e.attachedTo + "_2" : undefined,
  cx: e.cx + 4000, cy: e.cy + 4000,
  z: (e.z || 0) + 100000,
})).map((e) => (e.attachedTo === undefined ? { ...e, attachedTo: undefined } : e))).els;

const byId = (els, id) => els.find((e) => e.id === id);
const translate = (els, dx, dy, pick = () => true) =>
  els.map((e) => (pick(e) ? { ...e, cx: e.cx + dx, cy: e.cy + dy } : e));
/* THE assertion this whole suite is about: every bonded child is exactly where its host implies.
 * Expressed as "the invariant has nothing left to do", so it can never drift from the repair. */
const expectCoherent = (els) => {
  const res = assemblyIntegrity(els);
  expect(res.tears, `tears: ${JSON.stringify(res.tears)}`).toHaveLength(0);
  expect(res.changed, `repairs: ${JSON.stringify(res.repairs)}`).toBe(false);
};
const expectSamePlaces = (got, want) => {
  for (const w of want) {
    const g = byId(got, w.id);
    expect(g, `missing ${w.id}`).toBeTruthy();
    expect(Math.hypot(g.cx - w.cx, g.cy - w.cy)).toBeLessThan(1e-6);
  }
};

describe("the invariant: a bonded child's position is DERIVED, so the fixture is its own oracle", () => {
  it("a coherent assembly is returned BY IDENTITY — the guard costs a healthy plan nothing", () => {
    const res = assemblyIntegrity(ASSEMBLY);
    expect(res.changed).toBe(false);
    expect(res.els).toBe(ASSEMBLY);          // reference-identical → no re-render, no re-diff loop
    expect(res.tears).toHaveLength(0);
  });

  it("the derivation reproduces the owner's hand-computed positions for e7377 / e7378", () => {
    // The two numbers in the bug report, derived from the host's frame with no reference to what
    // the child rows stored. If this ever fails, the DERIVATION changed, not the test.
    expect(byId(ASSEMBLY, "swW").cx).toBeCloseTo(-542.99, 1);
    expect(byId(ASSEMBLY, "swW").cy).toBeCloseTo(-697.38, 1);
    expect(byId(ASSEMBLY, "pkW").cx).toBeCloseTo(-575.36, 1);
    expect(byId(ASSEMBLY, "pkW").cy).toBeCloseTo(-694.45, 1);
  });

  it("the reported tear — every child translated ~267 ft east / ~4 ft north, host left behind — is named and repaired EXACTLY", () => {
    const torn = translate(ASSEMBLY, 267.03, -4, (e) => !!e.attachedTo);
    const res = assemblyIntegrity(torn);
    expect(res.tears.map((t) => t.id).sort()).toEqual(["court", "pkN", "pkW", "swN", "swW"]);
    for (const t of res.tears) expect(t.dist).toBeGreaterThan(250);
    for (const t of res.tears) expect(t.host).toBe("b1");
    expectSamePlaces(res.els, ASSEMBLY);     // back to the host-derived positions, to the micro-foot
    expectCoherent(res.els);
  });

  it("moving the HOST alone tears every child by the same vector, and the heal follows the host", () => {
    // The other half of the same race: the host's write landed and the children's did not.
    const hostOnly = translate(ASSEMBLY, -300, 120, (e) => e.id === "b1");
    const res = assemblyIntegrity(hostOnly);
    expect(res.tears).toHaveLength(5);
    expectCoherent(res.els);
    expect(byId(res.els, "b1").cx).toBe(byId(hostOnly, "b1").cx);   // the HOST is never moved by the heal
    expect(byId(res.els, "b1").cy).toBe(byId(hostOnly, "b1").cy);
  });

  it("is idempotent — healing a healed plan is a no-op, so it can run on every seam every time", () => {
    const once = assemblyIntegrity(translate(ASSEMBLY, 800, -50, (e) => !!e.attachedTo));
    const twice = assemblyIntegrity(once.els);
    expect(twice.changed).toBe(false);
    expect(twice.els).toBe(once.els);
  });

  /* NEW-2 (2026-07-31) — the owner's amendment, asserted both ways. Sliding or shortening a
   * side-parking row along its wall is still a real thing he does (B1039) — but the intent must be
   * RECORDED to count. An unstamped difference is staleness, which is exactly what put a 205 ft
   * field on a 260 ft wall after a host resize on `sms4zs8unbkg`. */
  it("a RECORDED hand-slid parking field is NOT a tear; an unstamped slide IS", () => {
    const pk = byId(ASSEMBLY, "pkW");
    const rad = (354.818 * Math.PI) / 180;
    const move = (e) => ({ ...e, cx: pk.cx + 60 * -Math.sin(rad), cy: pk.cy + 60 * Math.cos(rad) }); // 60 ft along the west wall
    const stamped = ASSEMBLY.map((e) => (e.id === "pkW" ? { ...move(e), sideParkFit: { run: e.h, alongShift: 60 } } : e));
    expect(assemblyTears(stamped)).toHaveLength(0);
    const unstamped = ASSEMBLY.map((e) => (e.id === "pkW" ? move(e) : e));
    expect(assemblyTears(unstamped).map((t) => t.id)).toEqual(["pkW"]);
  });

  /* THE SYLVESTRI CASE, as the reproduction the owner asked for: resize a building's DEPTH and
   * assert every bonded child's RUN follows — measured immediately, with nothing reloaded.
   * Building `e1454731yyuqqs` went 220 → 200 deep; its sidewalks correctly reached 260 while its
   * end parking sat at 205, with a perfect perpendicular offset. Position was right, span was not. */
  it("a host DEPTH resize drags every bonded child's SPAN with it, not just its position", () => {
    /* The reproduction the owner asked to be added: resize the building's depth, then assert every
     * bonded child's RUN follows — measured immediately, nothing reloaded. The end wall is the one
     * whose length is the host's depth, so its sidewalk AND its parking row must both move to the
     * new number. Pre-fix the sidewalk followed and the parking did not, which is precisely what he
     * was looking at: 205 ft of parking beside a 260 ft sidewalk on the same wall. */
    const before = assemblyIntegrity(rough()).els;
    const wallRun = (els, id) => Math.max(byId(els, id).w, byId(els, id).h);
    expect(wallRun(before, "swN")).toBeCloseTo(wallRun(before, "pkN"), 3);   // they agree to start with

    // Take the depth OUT (the host's `w` is the end wall's length here), touching no child at all.
    const resized = before.map((e) => (e.id === "b1" ? { ...e, w: 320 } : e));
    const res = assemblyIntegrity(resized);

    // The detector names it, with a SPAN delta rather than only a position one…
    expect(res.tears.length, "a depth resize left children the wrong length and nobody noticed").toBeGreaterThan(0);
    expect(res.repairs.some((r) => Math.abs(r.span) > 1), "no span delta reported").toBe(true);
    // …and the heal makes the sidewalk and the parking beside it agree again, on the NEW wall.
    expect(wallRun(res.els, "pkN")).toBeCloseTo(wallRun(res.els, "swN"), 3);
    expect(wallRun(res.els, "pkN")).toBeGreaterThan(wallRun(before, "pkN") + 1);   // it actually GREW
    expectCoherent(res.els);
  });

  it("the detector reports SPAN as well as POSITION — a wrong-length child is as wrong as a misplaced one", () => {
    // A field the right distance out but the wrong length: position perfect, span stale.
    const short = ASSEMBLY.map((e) => (e.id === "swW" ? { ...e, h: e.h - 55 } : e));
    const res = assemblyIntegrity(short);
    const t = res.tears.find((x) => x.id === "swW");
    expect(t, `span-only tear not detected: ${JSON.stringify(res.tears)}`).toBeTruthy();
    expect(Math.abs(t.span)).toBeGreaterThan(50);
    expect(tearPayload(res.tears).items[0]).toHaveProperty("span");
  });

  it("reports the delta and the ids, bounded — a recurrence is a query, not an investigation", () => {
    const res = assemblyIntegrity(translate(ASSEMBLY, 267, 0, (e) => !!e.attachedTo));
    const p = tearPayload(res.tears);
    expect(p.count).toBe(5);
    expect(p.worstFt).toBeGreaterThan(250);
    expect(p.items[0]).toMatchObject({ host: "b1" });
    expect(p.items[0].id).toEqual(expect.any(String));
    expect(typeof p.items[0].dist).toBe("number");
    expect(tearPayload(res.tears, 2).items).toHaveLength(2);        // bounded payload
  });

  it("sub-tolerance drift is a REPAIR, never a TEAR — the detector does not page on rounding", () => {
    const nudged = ASSEMBLY.map((e) => (e.id === "swW" ? { ...e, cx: e.cx + ASSEMBLY_TEAR_TOL_FT / 4 } : e));
    const res = assemblyIntegrity(nudged);
    expect(res.repairs.length).toBeGreaterThan(0);
    expect(res.tears).toHaveLength(0);
  });

  it("survives junk without claiming a tear (a detector that crashes a load is worse than the bug)", () => {
    expect(assemblyIntegrity(null).tears).toHaveLength(0);
    expect(assemblyIntegrity([]).tears).toHaveLength(0);
    expect(assemblyIntegrity([{ id: "x" }, null, { attachedTo: "x" }]).tears).toHaveLength(0);
    expect(assemblyTears([{ id: "b", type: "building", cx: NaN, cy: 0, w: 1, h: 1, rot: 0 },
      { id: "c", type: "sidewalk", attachedTo: "b", cx: 9e9, cy: 0, w: 5, h: 5, rot: 0 }])).toHaveLength(0);
  });
});

/* ---- the six required races -----------------------------------------------------------------
 * Each drives the REAL sync engine (injected commit / timers / clock, no I/O) with the canvas
 * passing through the SAME guard SitePlanner installs in `reconcileElems` — so what is asserted is
 * the shipped composition, not a model of it. `guardedReconcile` is the three lines of
 * SitePlanner.reconcileElems that matter: re-derive, adopt, then diff. */
function makeHarness(overrides = {}) {
  const commits = [];
  const events = [];
  const timers = [];
  const tears = [];          // what the DETECTOR reported, i.e. what would have paged us
  let clock = 1000;
  const canvas = { els: [], markups: [], measures: [], callouts: [], parcels: [] };
  let responder = overrides.responder || ((ops) => ({
    ok: true, results: ops.map((o) => ({ id: o.id, status: "ok", rev: (o.expected || 0) + 1 })),
  }));
  const sync = createElementSync({
    siteId: "site-1",
    commit: async (ops, opts) => { commits.push(Object.assign(ops.slice(), { atomic: !!(opts && opts.atomic) })); return responder(ops); },
    now: () => clock,
    setTimer: (fn, ms) => { const id = timers.length + 1; timers.push({ fn, ms, id }); return id; },
    clearTimer: (id) => { const i = timers.findIndex((t) => t.id === id); if (i >= 0) timers.splice(i, 1); },
    onEvent: (e) => events.push(e),
    liveCollections: () => canvas,
    selfUid: "me",
    // Mirror SitePlanner: bonded children are DERIVED unless the gesture targeted them.
    isDirectEdit: (kind, id, el) => kind !== "el" || !el || el.attachedTo == null,
    patchElement: (kind, id, patch) => {
      const field = kind === "el" ? "els" : `${kind}s`;
      canvas[field] = (canvas[field] || []).map((e) => (e.id === id ? { ...e, ...patch } : e));
    },
    // The post-write ASSERTION, wired exactly as SitePlanner wires it.
    afterCommit: (summary) => { const t = assemblyTears(canvas.els); if (t.length) tears.push({ ...summary, tears: t }); },
    ...overrides.sync,
  });
  sync.seed(overrides.seed || []);
  // SitePlanner.reconcileElems: re-derive BEFORE the diff, adopt onto the canvas, then diff.
  const guardedReconcile = (busy) => {
    if (!busy) {
      const res = assemblyIntegrity(canvas.els);
      if (res.tears.length) { tears.push({ seam: "commit", tears: res.tears }); canvas.els = res.els; }
    }
    sync.reconcile(canvas, { busy });
  };
  return {
    sync, commits, events, canvas, tears, guardedReconcile,
    setResponder: (r) => { responder = r; },
    runTimers: () => { const due = timers.splice(0); due.forEach((t) => t.fn()); },
    pendingTimers: () => timers.length,
    // What actually reached the server for an element, per its last op.
    wireFor: (id) => {
      for (let i = commits.length - 1; i >= 0; i--) { const o = commits[i].find((x) => x.id === id); if (o) return o; }
      return null;
    },
  };
}

// Seed the engine with rows for a whole assembly at rev 1, as if the plan had been loaded.
const rowsFor = (els) => els.map((e) => ({ kind: "el", id: e.id, data: e, rev: 1, z_index: e.z, updated_by: "me" }));

describe("race 1 — move, then undo", () => {
  it("every child lands where its host implies, measured IMMEDIATELY after the undo (no reload)", async () => {
    const h = makeHarness({ seed: rowsFor(ASSEMBLY) });
    h.canvas.els = ASSEMBLY;
    // The move: the whole assembly translates.
    const moved = assemblyIntegrity(translate(ASSEMBLY, 267.03, -4)).els;
    h.canvas.els = moved;
    h.guardedReconcile(false); h.sync.flushGesture(); await tick();
    expect(h.commits).toHaveLength(1);

    // Ctrl+Z restores the pre-move snapshot — and, as in the reported case, a straggler from the
    // move puts THREE children back at pre-undo coordinates before the undo's flush runs. That is
    // the torn canvas the previous eight fixes each tried to make unreachable; here it is reached
    // deliberately, because the guarantee under test is about the OUTCOME, not the reachability.
    h.canvas.els = ASSEMBLY.map((e) => (["swW", "pkW", "court"].includes(e.id) ? byId(moved, e.id) : e));
    expect(assemblyTears(h.canvas.els)).toHaveLength(3);        // genuinely torn at this instant
    h.guardedReconcile(false); h.sync.flushGesture(); await tick();

    // THE assertion, in the same session, before anything reloads — which is the whole point of the
    // addendum to this dive: a reload would heal it and prove nothing.
    expectCoherent(h.canvas.els);
    expectSamePlaces(h.canvas.els, ASSEMBLY);
    // …and what went ON THE WIRE is the restored geometry, for every member.
    for (const e of ASSEMBLY) {
      const op = h.wireFor(e.id);
      expect(op, `${e.id} never committed`).toBeTruthy();
      expect(op.data.cx).toBeCloseTo(e.cx, 6);
      expect(op.data.cy).toBeCloseTo(e.cy, 6);
    }
  });

  it("a straggling echo of the pre-undo move cannot re-tear the canvas", async () => {
    const h = makeHarness({ seed: rowsFor(ASSEMBLY) });
    h.canvas.els = ASSEMBLY;
    const moved = translate(ASSEMBLY, 267.03, -4);
    h.canvas.els = moved;
    h.guardedReconcile(false); h.sync.flushGesture(); await tick();

    h.sync.noteLocalAuthority();                       // the undo bumps the local-authority epoch
    h.canvas.els = ASSEMBLY;
    h.guardedReconcile(false); h.sync.flushGesture(); await tick();

    // The move's own realtime rows arrive late, carrying pre-undo coordinates for THREE children.
    for (const id of ["swW", "pkW", "court"]) {
      const el = byId(moved, id);
      const instr = h.sync.applyRemoteRow({ kind: "el", id, data: el, rev: 9, z_index: el.z, updated_by: "me" });
      if (instr.action === "upsert") h.canvas.els = h.canvas.els.map((e) => (e.id === id ? instr.el : e));
    }
    // Whether or not any individual guard let a row through, the seam re-derives and the canvas is
    // coherent — that is the property that does not depend on getting every guard right.
    const res = assemblyIntegrity(h.canvas.els);
    h.canvas.els = res.els;
    expectCoherent(h.canvas.els);
    expectSamePlaces(h.canvas.els, ASSEMBLY);
  });
});

describe("race 2 — move, then redo", () => {
  it("a redo puts the whole assembly back at the moved position, together", async () => {
    const h = makeHarness({ seed: rowsFor(ASSEMBLY) });
    h.canvas.els = ASSEMBLY;
    const moved = assemblyIntegrity(translate(ASSEMBLY, 267.03, -4)).els;
    h.canvas.els = moved;
    h.guardedReconcile(false); h.sync.flushGesture(); await tick();
    h.canvas.els = ASSEMBLY;                                   // undo
    h.sync.noteLocalAuthority();
    h.guardedReconcile(false); h.sync.flushGesture(); await tick();
    // REDO, with two children left at the UNDONE position by a straggler (the mirror image of the
    // undo case): the redo frame lands torn and must not be committed or shown that way.
    h.canvas.els = moved.map((e) => (["swN", "pkN"].includes(e.id) ? byId(ASSEMBLY, e.id) : e));
    expect(assemblyTears(h.canvas.els)).toHaveLength(2);
    h.sync.noteLocalAuthority();
    h.guardedReconcile(false); h.sync.flushGesture(); await tick();

    expectCoherent(h.canvas.els);
    expectSamePlaces(h.canvas.els, moved);
    for (const e of moved) expect(h.wireFor(e.id).data.cx).toBeCloseTo(e.cx, 6);
  });

  it("a redo of a snapshot that was RECORDED torn is re-derived before it reaches the canvas", () => {
    // The history stack can hold a frame captured while a straggler had a child displaced. Replaying
    // it must not reinstate the tear — which is why the guard runs on the snapshot, not just on the
    // live canvas.
    const tornFrame = translate(ASSEMBLY, 267.03, -4, (e) => e.id === "pkW" || e.id === "swW");
    const res = assemblyIntegrity(tornFrame);
    expect(res.tears.map((t) => t.id).sort()).toEqual(["pkW", "swW"]);
    expectCoherent(res.els);
  });
});

describe("race 3 — a move with a second tab echoing mid-gesture", () => {
  it("a foreign row for one child arriving mid-drag cannot leave the assembly split", async () => {
    const h = makeHarness({ seed: rowsFor(ASSEMBLY) });
    h.canvas.els = ASSEMBLY;
    // The drag starts; the diff is deferred while busy (SitePlanner defers on busyRef).
    const moved = assemblyIntegrity(translate(ASSEMBLY, 500, 0)).els;
    h.canvas.els = moved;
    h.guardedReconcile(true);                                   // busy → nothing enqueued yet
    expect(h.commits).toHaveLength(0);

    // MID-GESTURE a second tab's row for ONE child lands, at the PRE-move position.
    const stale = byId(ASSEMBLY, "pkW");
    const instr = h.sync.applyRemoteRow({ kind: "el", id: "pkW", data: stale, rev: 7, z_index: stale.z, updated_by: "someone-else" });
    // SitePlanner buffers it (busyRef) and drains at the gesture boundary; either way it is applied
    // to a canvas the guard then re-derives.
    if (instr.action === "upsert") h.canvas.els = h.canvas.els.map((e) => (e.id === "pkW" ? instr.el : e));

    // Pointer-up: drain, guard, diff, flush.
    h.guardedReconcile(false); h.sync.flushGesture(); await tick();

    expectCoherent(h.canvas.els);
    expectSamePlaces(h.canvas.els, moved);
    const op = h.wireFor("pkW");
    expect(op.data.cx).toBeCloseTo(byId(moved, "pkW").cx, 6);   // never the foreign pre-move copy
  });
});

describe("race 4 — a rejected child commit with an accepted host", () => {
  it("the host lands, the children are refused, and the retry carries HOST-DERIVED coordinates", async () => {
    const h = makeHarness({ seed: rowsFor(ASSEMBLY) });
    h.canvas.els = ASSEMBLY;
    // The server takes the host and refuses every child on the rev guard — the exact shape the
    // owner's rows recorded (host rev 20 at 15:58:45; children written later, elsewhere).
    h.setResponder((ops) => ({
      ok: true,
      results: ops.map((o) => (o.id === "b1"
        ? { id: o.id, status: "ok", rev: 20 }
        : { id: o.id, status: "conflict", row: { rev: 21, data: byId(ASSEMBLY, o.id), updated_by: "me" } })),
    }));
    h.canvas.els = assemblyIntegrity(translate(ASSEMBLY, 267.03, -4)).els;
    h.guardedReconcile(false); h.sync.flushGesture(); await tick();

    // The partial landing is SAID OUT LOUD (B1116's assembly-split), and the canvas — which is what
    // the retry's payload is re-read from — is still coherent, so the retry cannot ship a tear.
    expect(h.events.some((e) => e.type === "assembly-split")).toBe(true);
    expectCoherent(h.canvas.els);

    // The retry: accept everything this time.
    h.setResponder((ops) => ({ ok: true, results: ops.map((o) => ({ id: o.id, status: "ok", rev: 30 })) }));
    h.runTimers(); await tick();
    for (const e of h.canvas.els) {
      const op = h.wireFor(e.id);
      if (!op) continue;
      expect(op.data.cx).toBeCloseTo(e.cx, 6);
      expect(op.data.cy).toBeCloseTo(e.cy, 6);
    }
    expectCoherent(h.canvas.els);
  });

  it("a torn canvas is UNCOMMITTABLE — the write seam re-derives before the diff", async () => {
    // The direct proof of the structural claim. Whatever produced the tear locally, the bytes that
    // reach the server describe a coherent assembly.
    const h = makeHarness({ seed: rowsFor(ASSEMBLY) });
    h.canvas.els = translate(ASSEMBLY, 267.03, -4, (e) => !!e.attachedTo);   // children moved, host not
    h.guardedReconcile(false); h.sync.flushGesture(); await tick();

    expect(h.tears.length).toBeGreaterThan(0);                 // the detector saw it…
    for (const e of ASSEMBLY) {
      const op = h.wireFor(e.id);
      if (!op) continue;
      expect(op.data.cx).toBeCloseTo(e.cx, 6);                 // …and nothing torn went on the wire
      expect(op.data.cy).toBeCloseTo(e.cy, 6);
    }
  });
});

describe("race 5 — an accepted child with a rejected host", () => {
  it("children land, the host is refused, and the assembly is still coherent afterwards", async () => {
    const h = makeHarness({ seed: rowsFor(ASSEMBLY) });
    h.canvas.els = ASSEMBLY;
    h.setResponder((ops) => ({
      ok: true,
      results: ops.map((o) => (o.id === "b1"
        ? { id: o.id, status: "conflict", row: { rev: 20, data: byId(ASSEMBLY, "b1"), updated_by: "me" } }
        : { id: o.id, status: "ok", rev: 22 })),
    }));
    const moved = assemblyIntegrity(translate(ASSEMBLY, 267.03, -4)).els;
    h.canvas.els = moved;
    h.guardedReconcile(false); h.sync.flushGesture(); await tick();

    expect(h.events.some((e) => e.type === "assembly-split")).toBe(true);
    expectCoherent(h.canvas.els);

    // Before the retry, a late echo of the accepted CHILD rows lands while the host still holds its
    // refused (old) position — the canvas tears the other way round. The retry must still not ship
    // it: the write seam re-derives, so the host's own frame wins over the stale child rows.
    h.canvas.els = h.canvas.els.map((e) => (e.id === "b1" ? byId(ASSEMBLY, "b1") : e));
    expect(assemblyTears(h.canvas.els).length).toBeGreaterThan(0);
    // The refused host is re-committed, and the children's committed bytes still agree with it.
    h.setResponder((ops) => ({ ok: true, results: ops.map((o) => ({ id: o.id, status: "ok", rev: 40 })) }));
    h.guardedReconcile(false);
    h.runTimers(); await tick();
    // The canvas settles on the HOST's frame (the host is the authority — a child never drags its
    // building), and every op that reached the server matches the settled canvas exactly.
    expectCoherent(h.canvas.els);
    expectSamePlaces(h.canvas.els, ASSEMBLY);
    for (const e of h.canvas.els) {
      const op = h.wireFor(e.id);
      if (!op) continue;
      expect(op.data.cx).toBeCloseTo(e.cx, 6);
      expect(op.data.cy).toBeCloseTo(e.cy, 6);
    }
  });

  it("a self-conflict never makes a DERIVED child op stand down (B1116, and now its read-side twin)", () => {
    // The engine must not yield a pending derived child op to a row written by THIS account with no
    // other writer involved — that is one tab standing down against its own earlier write, which is
    // the "host reverted, children did not" shape. Property + source guard, because the two halves
    // of this rule live in different functions and drifted apart once already.
    const src = read("../src/workspaces/site-planner/lib/elementSync.js");
    const yieldRead = src.indexOf("if (!sameData && !semEq && rowJson != null && !pendDirect");
    expect(yieldRead, "the realtime derived-yield branch moved or was renamed").toBeGreaterThan(-1);
    expect(src.slice(yieldRead, yieldRead + 200)).toMatch(/foreignAuthor\(row\)/);
    // and its commit-result twin still carries the same gate
    expect(src).toMatch(/e\.direct === false && foreignAuthor\(row\)/);
  });
});

describe("race 6 — undo of a multi-select move spanning two assemblies", () => {
  it("both assemblies come back whole; neither borrows the other's host", async () => {
    const both = [...ASSEMBLY, ...ASSEMBLY_B];
    expectCoherent(both);                                       // the two-assembly fixture is sane
    const h = makeHarness({ seed: rowsFor(both) });
    h.canvas.els = both;

    const moved = assemblyIntegrity(translate(both, -910, 640)).els;   // marquee both, drag once
    h.canvas.els = moved;
    h.guardedReconcile(false); h.sync.flushGesture(); await tick();

    // Ctrl+Z — with a straggler leaving ONE child of EACH assembly at the moved position, so the
    // undo lands on a canvas torn in two places at once and the repair has to keep them apart.
    h.sync.noteLocalAuthority();
    h.canvas.els = both.map((e) => (["pkW", "court_2"].includes(e.id) ? byId(moved, e.id) : e));
    expect(assemblyTears(h.canvas.els)).toHaveLength(2);
    h.guardedReconcile(false); h.sync.flushGesture(); await tick();

    expectCoherent(h.canvas.els);
    expectSamePlaces(h.canvas.els, both);
    for (const e of both) {
      const op = h.wireFor(e.id);
      expect(op, `${e.id} never committed`).toBeTruthy();
      expect(op.data.cx).toBeCloseTo(e.cx, 6);
    }
  });

  it("ONE assembly torn out of two is repaired without disturbing the other", () => {
    const both = [...ASSEMBLY, ...ASSEMBLY_B];
    const torn = translate(both, 267.03, -4, (e) => e.attachedTo === "b1");
    const res = assemblyIntegrity(torn);
    expect(new Set(res.tears.map((t) => t.host))).toEqual(new Set(["b1"]));
    for (const e of ASSEMBLY_B) {
      const g = byId(res.els, e.id);
      expect(g).toBe(byId(torn, e.id));                         // untouched, by identity
    }
    expectCoherent(res.els);
  });
});

/* ---- the seams, asserted in the source ------------------------------------------------------
 * The invariant is only as good as the set of boundaries it runs at, and a boundary is added by
 * editing SitePlanner, not by editing this module. These guards fail if a seam is removed — the
 * enumeration in the backlog item is the specification, and this is its enforcement. */
describe("every seam that can put a child on the canvas or on the wire runs the guard", () => {
  const src = read("../src/workspaces/site-planner/SitePlanner.jsx");

  it("the guard exists and is LOUD on both channels (detected + healed)", () => {
    expect(src).toMatch(/const assemblyGuard = \(list, seam\) =>/);
    expect(src).toMatch(/reportClientEvent\("assembly-tear-detected"/);
    expect(src).toMatch(/reportClientEvent\("assembly-tear-healed"/);
  });

  it("the ECHO / ADOPTION seam — one effect over `els`, covering every canvas mutation", () => {
    const idx = src.indexOf('const guarded = assemblyGuard(els, "canvas")');
    expect(idx, "the els-seam effect is gone").toBeGreaterThan(-1);
    expect(src.slice(idx, idx + 160)).toMatch(/setEls\(guarded\)/);
  });

  it("the REVERT seam — undo/redo re-derives the snapshot before restoring it", () => {
    const idx = src.indexOf("const applySnapshot = (s) => {");
    const block = src.slice(idx, src.indexOf("\n  };", idx));
    expect(block).toMatch(/assemblyGuard\(s\.els, "undo\/redo"\)/);
  });

  it("the WRITE seam — the diff can never be handed a torn canvas", () => {
    const idx = src.indexOf("const reconcileElems = (busy, override) =>");
    const block = src.slice(idx, src.indexOf("\n  };", idx));
    expect(block).toMatch(/assemblyGuard\(/);
    expect(block).toMatch(/e\.reconcile\(\{ els,/);            // the GUARDED list, not `s.els`
  });

  it("the FLUSH-OVERRIDE seam — what `freshen` re-reads is guarded too", () => {
    const idx = src.indexOf("const flushElems = (override) =>");
    const block = src.slice(idx, src.indexOf("\n  };", idx));
    expect(block).toMatch(/assemblyGuard\(ov\.els, "flush-override"\)/);
    expect(block).toMatch(/syncStateOverride\.current = ov/);
  });

  it("the LOAD seams — the rows refetch and the on-device read both report, so no repair is silent", () => {
    expect(src).toMatch(/const post = assemblyIntegrity\(merged\.els\)/);   // the rows/refetch path
    expect(src).toMatch(/seam: "load"/);
    // The on-device read reports from STORAGE, not from the planner. Measured, not assumed: a route
    // level read (the plan list, a group lookup) normalizes the record before the planner mounts, so
    // a detector inside the planner is outrun by the very repair it exists to report — the first
    // version of this work put it in the `restored` memo and it observed a clean record every time.
    const store = read("../src/workspaces/site-planner/lib/storage.js");
    expect(store).toMatch(/function bondedHealWatch\(id\)/);
    expect(store).toMatch(/reportClientEvent\("assembly-tear-detected"/);
    expect(store).toMatch(/migrate\(rec, \{ onHeal: watch\.onHeal \}\)/);   // listens to the heal that already runs
    expect(store).toMatch(/migrate\(r, \{ onHeal: watch\.onHeal \}\)/);     // …in the list read too
    // …and the repair is WRITTEN BACK, or the next reader gets the tear again.
    expect(store).toMatch(/if \(persistHeal && wasTorn\)/);
    expect(src).toMatch(/loadSite\(siteId, \{ persistHeal: true \}\)/);
  });

  it("every geometry pass in the heal can report — none repairs in silence", () => {
    const model = read("../src/workspaces/site-planner/lib/siteModel.js");
    // The rotation re-anchor was the one pass with no `onHeal` at all, so a host re-angled behind
    // its children's back was corrected with nobody told. Every pass now takes the callback.
    expect(model).toMatch(/function normalizeBondedRotations\(list, onHeal\)/);
    expect(model).toMatch(/kind: "bond-rotation"/);
    expect(model).toMatch(/normalizeBondedRotations\(normalizeCrossHostBonds\(els, onHeal\), onHeal\)/);
  });

  it("the POST-WRITE assertion is wired into the engine and cannot break the commit path", () => {
    expect(src).toMatch(/afterCommit: \(summary\) =>/);
    expect(src).toMatch(/seam: "post-commit"/);
    const eng = read("../src/workspaces/site-planner/lib/elementSync.js");
    expect(eng).toMatch(/const assertAssembly = \(outcome\) =>/);
    expect(eng).toMatch(/catch \(_\) \{ \/\* never break the commit path \*\/ \}/);
  });
});
