/* B227888 — THE POND MATH MUST NOT RUN BECAUSE THE VIEW MOVED.
 *
 * The owner's specification, verbatim: *"I don't really understand how a static pond, how the
 * calculation should slow anything down at all. And you can give me the reason, but I still don't
 * think it should."*
 *
 * ⛔ THIS SUITE ASSERTS INVOCATION COUNTS, NOT TIME, and that is the whole point of it. A time
 * budget passes the moment a computation that should not be running at all merely becomes cheaper —
 * and this programme has three separate cases on record of a cost class returning unnoticed because
 * only a total was being watched. `offsetStats.misses` counts REAL clipper executions (a cache hit
 * does not increment it), so "the pond was not recomputed" is a property that can be stated exactly
 * rather than inferred from a stopwatch.
 *
 * The four properties, in the order they matter:
 *   1. RECURRENCE  — repeating an identical question does ZERO additional geometric work. This is
 *                    the defect: `drainFacts()` rebuilt this model 156 times per pond per pan.
 *   2. FRESHNESS   — every input that can move an answer still moves it. A memo that cannot go
 *                    stale is worth more than a memo that is fast, because a wrong engineering
 *                    number is worse than a slow one (the reason `drainFacts` gates rather than
 *                    memoises in the first place, and the reason this keys on the inputs).
 *   3. VERTEX COST — the per-vertex cost ratio stays inside a stated bound, measured on a
 *                    COLLINEAR-INSERTED ring: same polygon, same area, same perimeter, same
 *                    bounding box, same drawn picture, only the vertex count rises. This is the
 *                    guard the brief asked for against per-vertex cost going superlinear again.
 *   4. IDENTITY    — the memo is keyed on the ring's identity, so an edit (which replaces the
 *                    array) can never be served the old answer.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { offsetStats, maxInwardOffset, offsetInward } from "../src/workspaces/site-planner/lib/pondOffset.js";
import { pondStageModel, pondElevations, stageTable } from "../src/workspaces/site-planner/lib/pondStageModel.js";

/* A deliberately CONCAVE ring — concavity is what loads clipper's intersection sweep, and a convex
 * test ring would make this suite pass on an implementation that is still quadratic in practice. */
const RING = [
  { x: 0, y: 0 }, { x: 400, y: 0 }, { x: 400, y: 120 }, { x: 260, y: 120 },
  { x: 260, y: 220 }, { x: 400, y: 220 }, { x: 400, y: 340 }, { x: 0, y: 340 },
  { x: 0, y: 220 }, { x: 140, y: 220 }, { x: 140, y: 120 }, { x: 0, y: 120 },
];
const DET = { depth: 8, freeboard: 1, slope: 3, tobElev: 100 };
const OPTS = { floodElevFt: 96, outletInvertFt: 94, bandFt: 1, id: "p1", name: "Pond 1" };

/** Fresh array every call — a NEW ring identity, which is exactly what a pond edit produces. */
const copy = (r) => r.map((p) => ({ x: p.x, y: p.y }));

/** Insert `k` collinear midpoints into every edge. The polygon is unchanged as a SHAPE: identical
 *  area, perimeter, bounding box and rendered path. Only the vertex count rises. */
function collinear(ring, k) {
  const out = [];
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i], b = ring[(i + 1) % ring.length];
    out.push({ x: a.x, y: a.y });
    for (let j = 1; j <= k; j++) out.push({ x: a.x + ((b.x - a.x) * j) / (k + 1), y: a.y + ((b.y - a.y) * j) / (k + 1) });
  }
  return out;
}

const work = (fn) => { const before = offsetStats.misses; fn(); return offsetStats.misses - before; };

beforeEach(() => { offsetStats.calls = 0; offsetStats.misses = 0; });

describe("B227888 · a static pond is not recomputed because the view moved", () => {
  it("rebuilding an identical stage model does ZERO additional clipper work", () => {
    const ring = copy(RING);
    const first = work(() => pondStageModel(ring, DET, OPTS));
    expect(first).toBeGreaterThan(0); // the first build is real work — proves the counter is live

    // 156 repeats is the measured per-pond count for ONE pan gesture of the owner's Bain plan.
    const repeats = work(() => { for (let i = 0; i < 156; i++) pondStageModel(ring, DET, OPTS); });
    expect(repeats).toBe(0);
  });

  it("the repeats return the SAME answer, not merely a fast one", () => {
    const ring = copy(RING);
    const a = pondStageModel(ring, DET, OPTS);
    const b = pondStageModel(ring, DET, OPTS);
    expect(b).toBe(a);
    expect(a.totalCf).toBeGreaterThan(0);
  });

  it("stageTable does not re-derive the pinch-off search once per band", () => {
    const ring = copy(RING);
    const st = stageTable(ring, DET, { bandFt: 1 });
    expect(st.bands.length).toBeGreaterThan(2);
    // `pondElevations` is asked for once by stageTable and twice per band by areaAtElev. All of
    // those must be one computation, not 1 + 2·bands of them.
    const again = work(() => { for (let i = 0; i < 20; i++) pondElevations(ring, DET); });
    expect(again).toBe(0);
  });

  it("maxInwardOffset runs its 29-execute search once per ring, not once per ask", () => {
    const ring = copy(RING);
    const first = work(() => maxInwardOffset(ring));
    expect(first).toBeGreaterThanOrEqual(2); // a real binary search happened
    expect(work(() => { for (let i = 0; i < 50; i++) maxInwardOffset(ring); })).toBe(0);
  });
});

describe("B227888 · the memo cannot serve a stale engineering number", () => {
  it("a ring EDIT (a new array) is never served the old answer", () => {
    const a = pondStageModel(copy(RING), DET, OPTS);
    const bigger = RING.map((p) => ({ x: p.x * 1.5, y: p.y * 1.5 }));
    const b = pondStageModel(bigger, DET, OPTS);
    expect(b.totalCf).toBeGreaterThan(a.totalCf * 1.5);
  });

  for (const [label, det] of [
    ["depth", { ...DET, depth: 12 }],
    ["freeboard", { ...DET, freeboard: 3 }],
    ["side slope", { ...DET, slope: 5 }],
    ["top-of-bank elevation", { ...DET, tobElev: 130 }],
  ]) {
    it(`a change of ${label} moves the answer`, () => {
      const ring = copy(RING);
      const base = pondStageModel(ring, DET, OPTS);
      const changed = pondStageModel(ring, det, OPTS);
      expect(changed).not.toBe(base);
      const moved = changed.totalCf !== base.totalCf
        || changed.stage.floorElev !== base.stage.floorElev
        || changed.stage.waterSurfElev !== base.stage.waterSurfElev;
      expect(moved).toBe(true);
    });
  }

  for (const [label, opts] of [
    ["the governing flood elevation", { ...OPTS, floodElevFt: 98 }],
    ["the outfall invert", { ...OPTS, outletInvertFt: 97 }],
    ["the band height", { ...OPTS, bandFt: 0.5 }],
  ]) {
    it(`a change of ${label} moves the answer`, () => {
      const ring = copy(RING);
      const base = pondStageModel(ring, DET, OPTS);
      const changed = pondStageModel(ring, DET, opts);
      expect(changed).not.toBe(base);
    });
  }

  it("the pond's display name reaches the model rather than being cached away", () => {
    const ring = copy(RING);
    expect(pondStageModel(ring, DET, { ...OPTS, name: "North Basin" }).name).toBe("North Basin");
    expect(pondStageModel(ring, DET, { ...OPTS, name: "South Basin" }).name).toBe("South Basin");
  });
});

describe("B227888 · per-vertex cost stays inside a stated bound", () => {
  /* ⛔ MEASURED ON A COLLINEAR-INSERTED RING, which is what makes this a guard on VERTEX COUNT and
   * not on shape. Decimating a ring — the instrument docs/PERF-REAL-PLANS.md §5.5 used — removes
   * concavity along with the vertices, so it confounds "more points" with "a simpler polygon", and
   * that is precisely how §5.5 came to report a superlinear per-vertex law that does not exist.
   * Here area, perimeter, bounding box and the drawn path are identical at every rung. */
  const bbox = (r) => r.reduce((a, p) => [Math.min(a[0], p.x), Math.min(a[1], p.y), Math.max(a[2], p.x), Math.max(a[3], p.y)], [Infinity, Infinity, -Infinity, -Infinity]);

  it("collinear insertion changes the vertex count and nothing else about the polygon", () => {
    const a = collinear(RING, 0), b = collinear(RING, 7);
    expect(b.length).toBe(RING.length * 8);
    expect(bbox(b)).toEqual(bbox(a));
  });

  it("clipper work per model build grows no faster than linearly in vertex count", () => {
    /* The COUNT of clipper executes, not the time — the same reason this whole file counts. An
     * implementation that started asking for an offset per vertex would fail here, and a machine
     * that happens to be busy cannot. */
    const lo = work(() => pondStageModel(collinear(RING, 0), DET, OPTS));
    const hi = work(() => pondStageModel(collinear(RING, 7), DET, OPTS)); // 8× the vertices
    expect(lo).toBeGreaterThan(0);
    expect(hi).toBeLessThanOrEqual(lo); // the question count is a function of BANDS, never of vertices
  });

  it("a single inward offset is not superlinear in vertex count", () => {
    /* Cost is bounded against a ring with 16× the vertices and an identical shape. The bound is
     * generous on purpose: it exists to catch a CLASS CHANGE (an O(n²) scan arriving on this path),
     * not to police a few per cent, and a tight bound on a shared CI box would be flaky rather
     * than informative. Measured at ~1.75× when this was written. */
    const time = (r) => {
      offsetInward(r, 13); // warm — this measures the algorithm, not the memo
      const t0 = performance.now();
      for (let i = 0; i < 20; i++) offsetInward(copy(r), 13 + i * 0.001);
      return performance.now() - t0;
    };
    const small = time(collinear(RING, 0));
    const large = time(collinear(RING, 15)); // 16× the vertices, identical polygon
    expect(large).toBeLessThan(Math.max(small, 1) * 6);
  });
});
