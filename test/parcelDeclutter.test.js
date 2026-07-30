/* NEW-1 / NEW-2 / NEW-3 — the parcel-chrome declutter trio.
 *
 * Owner report 2026-07-30 (Weld County CO, ~62.7 ac, every edge 25 ft): the parcel boundary
 * follows a subdivision edge with a long curved run, so it carries dozens of short segments.
 * One curved corner rendered ~12 vertex handles and ~12 overlapping "25′" chips stacked into an
 * illegible pile, and the whole parcel carried 30+.
 *
 * These tests pin the three pure decisions behind the fix:
 *   setbackChips.js    — WHICH edges share one chip (value + direction, not per segment)
 *   screenDeclutter.js — WHICH of the resulting marks survive at the current zoom
 *   polylabel.js       — WHERE the parcel's acreage badge goes
 */
import { describe, it, expect } from "vitest";
import { setbackChipRuns, CHIP_TURN_BREAK_DEG } from "../src/workspaces/site-planner/lib/setbackChips.js";
import { spaceOut, cornerTurns, turnBetween } from "../src/workspaces/site-planner/lib/screenDeclutter.js";
import { polylabel, signedDist } from "../src/workspaces/site-planner/lib/polylabel.js";
import { edgeRuns } from "../src/workspaces/site-planner/lib/edgeRuns.js";

// --- fixtures ---------------------------------------------------------------------------------

// `n` points along an arc — the digitized-curve shape at the heart of the report.
const arc = (cx, cy, r, a0, sweep, n) =>
  Array.from({ length: n + 1 }, (_, k) => {
    const a = ((a0 + (sweep * k) / n) * Math.PI) / 180;
    return { x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) };
  });

const rect = (w, h) => [{ x: 0, y: 0 }, { x: w, y: 0 }, { x: w, y: h }, { x: 0, y: h }];

/* A rectangle whose NE corner is a 90° fillet digitized as 12 short segments — 7.5° of turn per
 * segment, i.e. just past the ±7° tolerance `edgeRuns` uses, which is exactly why the shipped
 * grouping produced a dozen sides (and a dozen chips) at one corner. */
const filletedCorner = () => {
  const R = 60, W = 900, H = 500;
  return [
    { x: 0, y: 0 }, { x: W, y: 0 }, { x: W, y: H - R },
    ...arc(W - R, H - R, R, 0, 90, 12).slice(1, -1),
    { x: W - R, y: H }, { x: 0, y: H },
  ];
};

const uniform = (pts, v) => pts.map(() => v);

// --- setbackChipRuns --------------------------------------------------------------------------

describe("setbackChipRuns — one chip per labelled run (NEW-1)", () => {
  it("a plain rectangle is still four sides, one per boundary side", () => {
    const p = rect(800, 500);
    const runs = setbackChipRuns(p, uniform(p, 25));
    expect(runs).toHaveLength(4);
    expect(runs.every((r) => r.edges.length === 1)).toBe(true);
    expect(runs.every((r) => r.value === 25)).toBe(true);
  });

  it("every edge appears in exactly one run, for every fixture", () => {
    for (const p of [rect(800, 500), filletedCorner(), arc(0, 0, 500, 0, 300, 24)]) {
      const runs = setbackChipRuns(p, uniform(p, 25));
      const seen = runs.flatMap((r) => r.edges).sort((a, b) => a - b);
      expect(seen).toEqual(Array.from({ length: p.length }, (_, i) => i));
    }
  });

  it("THE REPORT: a filleted corner reads as a handful of runs, not one per segment", () => {
    const p = filletedCorner();
    // The shipped geometric-side model breaks on every fillet segment — this is the bug.
    expect(edgeRuns(p, 7).length).toBeGreaterThanOrEqual(12);
    const runs = setbackChipRuns(p, uniform(p, 25));
    expect(runs.length).toBeLessThanOrEqual(5);      // "a handful … or one per boundary side"
    // …and the fillet is folded into its neighbouring straights, not left as a dozen slivers.
    expect(Math.max(...runs.map((r) => r.edges.length))).toBeGreaterThan(1);
  });

  it("survey noise on a nominally straight side never accumulates into a break", () => {
    // 40 segments alternating ±1.5° — the classic dense survey boundary.
    const pts = [{ x: 0, y: 0 }];
    for (let i = 1; i <= 40; i++) pts.push({ x: i * 25, y: (i % 2 ? 1 : -1) * 0.6 });
    pts.push({ x: 1000, y: 400 }, { x: 0, y: 400 });
    const runs = setbackChipRuns(pts, uniform(pts, 25));
    // The noisy bottom (40 edges) collapses to ONE run; the other three sides stay their own.
    expect(runs.length).toBeLessThanOrEqual(4);
    expect(Math.max(...runs.map((r) => r.edges.length))).toBeGreaterThanOrEqual(40);
  });

  it("a change of setback VALUE always breaks a run, even mid-straight", () => {
    const p = rect(800, 500);
    const sb = [25, 25, 10, 25];
    const runs = setbackChipRuns(p, sb);
    expect(runs).toHaveLength(4);
    expect(runs.map((r) => r.value).sort((a, b) => a - b)).toEqual([10, 25, 25, 25]);
    // …and a straight side split in two by a value change stays two runs.
    const split = [{ x: 0, y: 0 }, { x: 400, y: 0 }, { x: 800, y: 0 }, { x: 800, y: 500 }, { x: 0, y: 500 }];
    const r2 = setbackChipRuns(split, [25, 10, 25, 25, 25]);
    expect(r2.find((r) => r.edges.includes(0)).edges).not.toContain(1);
  });

  it("a long continuous arc breaks about every turnBreakDeg of sweep, not per segment", () => {
    const p = arc(0, 0, 500, 0, 300, 30);           // 300° of sweep in 30 segments
    const runs = setbackChipRuns(p, uniform(p, 25));
    const expected = 300 / CHIP_TURN_BREAK_DEG;      // ≈ 6
    expect(runs.length).toBeGreaterThanOrEqual(Math.floor(expected) - 2);
    expect(runs.length).toBeLessThanOrEqual(Math.ceil(expected) + 3);
    expect(runs.length).toBeLessThan(p.length);      // and never per-segment
  });

  it("a run straddling the index-0 seam merges (the digitizer started mid-side)", () => {
    // A rectangle whose ring starts halfway along the bottom edge.
    const p = [{ x: 400, y: 0 }, { x: 800, y: 0 }, { x: 800, y: 500 }, { x: 0, y: 500 }, { x: 0, y: 0 }];
    const runs = setbackChipRuns(p, uniform(p, 25));
    expect(runs).toHaveLength(4);
    const seam = runs.find((r) => r.edges.includes(0));
    expect(seam.edges).toContain(4);                 // the closing edge folded onto the opening one
  });

  it("the chip anchors on the LONGEST edge in its run, and reports that edge's length", () => {
    const p = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 900, y: 0 }, { x: 900, y: 500 }, { x: 0, y: 500 }];
    const runs = setbackChipRuns(p, uniform(p, 25));
    const bottom = runs.find((r) => r.edges.includes(0));
    expect(bottom.edges).toEqual([0, 1]);
    expect(bottom.anchorEdge).toBe(1);               // the 800 ft segment, not the 100 ft one
    expect(bottom.anchorLenFt).toBeCloseTo(800, 5);
    expect(bottom.midF).toEqual({ x: 500, y: 0 });   // midpoint of THAT edge
    expect(bottom.lengthFt).toBeCloseTo(900, 5);     // run total is still the whole side
  });

  it("degenerate rings are answered, never thrown on", () => {
    expect(setbackChipRuns([], [])).toEqual([]);
    expect(setbackChipRuns(null, null)).toEqual([]);
    expect(setbackChipRuns([{ x: 0, y: 0 }], [0])).toEqual([]);
    expect(setbackChipRuns([{ x: 0, y: 0 }, { x: 10, y: 0 }], [5, 5])).toHaveLength(1);
  });

  it("a missing setbacks array reads as zero, and still groups", () => {
    const p = rect(800, 500);
    expect(setbackChipRuns(p, undefined).every((r) => r.value === 0)).toBe(true);
  });
});

// --- spaceOut ---------------------------------------------------------------------------------

describe("spaceOut — screen-space thinning (NEW-1 / NEW-2)", () => {
  const at = (id, x, y, priority) => ({ id, x, y, priority });

  it("keeps everything when nothing is crowded", () => {
    const items = [at("a", 0, 0, 1), at("b", 100, 0, 1), at("c", 0, 100, 1)];
    expect(spaceOut(items, 40).map((i) => i.id)).toEqual(["a", "b", "c"]);
  });

  it("drops the LOWER-priority mark of a crowded pair", () => {
    const kept = spaceOut([at("small", 0, 0, 10), at("big", 5, 0, 900)], 40);
    expect(kept.map((i) => i.id)).toEqual(["big"]);
  });

  it("returns survivors in INPUT order, so render order and indices are untouched", () => {
    const kept = spaceOut([at("a", 0, 0, 1), at("b", 5, 0, 5), at("c", 200, 0, 2)], 40);
    expect(kept.map((i) => i.id)).toEqual(["b", "c"]);
  });

  it("ties break on input position, so the result is deterministic", () => {
    const twice = () => spaceOut([at("a", 0, 0, 3), at("b", 4, 0, 3), at("c", 8, 0, 3)], 40).map((i) => i.id);
    expect(twice()).toEqual(["a"]);
    expect(twice()).toEqual(twice());
  });

  it("zooming in reveals more: the same points, spread wider, all survive", () => {
    const ring = Array.from({ length: 12 }, (_, i) => at(`v${i}`, i * 6, 0, 1));       // 6 px apart
    const zoomed = ring.map((p, i) => at(`v${i}`, i * 60, 0, 1));                      // 60 px apart
    expect(spaceOut(ring, 18).length).toBeLessThan(5);
    expect(spaceOut(zoomed, 18)).toHaveLength(12);
  });

  it("an Infinity priority (the selected vertex) is always kept", () => {
    const items = [at("a", 0, 0, 999), at("sel", 3, 0, Infinity), at("b", 6, 0, 998)];
    expect(spaceOut(items, 40).map((i) => i.id)).toEqual(["sel"]);
  });

  it("non-finite positions are dropped, and a zero/absent separation is a no-op", () => {
    expect(spaceOut([at("a", NaN, 0, 1), at("b", 1, 2, 1)], 10).map((i) => i.id)).toEqual(["b"]);
    expect(spaceOut([at("a", 0, 0, 1), at("b", 1, 0, 1)], 0)).toHaveLength(2);
    expect(spaceOut(null, 10)).toEqual([]);
  });

  it("scales to a densely digitized boundary without an O(n²) blow-up", () => {
    const many = Array.from({ length: 4000 }, (_, i) => at(i, (i % 200) * 3, Math.floor(i / 200) * 3, i));
    const t0 = Date.now();
    const kept = spaceOut(many, 18);
    expect(Date.now() - t0).toBeLessThan(500);
    expect(kept.length).toBeLessThan(many.length);
    // No two survivors are closer than the separation.
    for (let i = 0; i < kept.length; i++) {
      for (let j = i + 1; j < kept.length; j++) {
        expect(Math.hypot(kept[i].x - kept[j].x, kept[i].y - kept[j].y)).toBeGreaterThanOrEqual(18);
      }
    }
  });
});

describe("cornerTurns — handle priority is CORNER-NESS (NEW-2)", () => {
  it("a rectangle's four corners each turn 90°", () => {
    expect(cornerTurns(rect(800, 500)).map(Math.round)).toEqual([90, 90, 90, 90]);
  });

  it("a real corner outranks every mid-arc point on a filleted boundary", () => {
    const p = filletedCorner();
    const turns = cornerTurns(p);
    const hardCorner = Math.max(...turns);
    const arcPoints = turns.filter((t) => t < hardCorner - 1);
    expect(hardCorner).toBeGreaterThan(80);
    expect(Math.max(...arcPoints)).toBeLessThan(20);        // fillet points barely turn
  });

  it("turnBetween is symmetric and wraps", () => {
    expect(turnBetween(10, 350)).toBeCloseTo(20, 6);
    expect(turnBetween(350, 10)).toBeCloseTo(20, 6);
    expect(turnBetween(0, 180)).toBeCloseTo(180, 6);
  });

  it("degenerate rings return zeros, never throw", () => {
    expect(cornerTurns([])).toEqual([]);
    expect(cornerTurns([{ x: 0, y: 0 }, { x: 1, y: 1 }])).toEqual([0, 0]);
  });
});

// --- polylabel --------------------------------------------------------------------------------

describe("polylabel — the parcel badge sits at the VISUAL centre (NEW-3)", () => {
  const inside = (pt, ring) => signedDist(pt, ring) > 0;

  it("a rectangle's pole is its centre", () => {
    const p = polylabel(rect(800, 400));
    expect(p.x).toBeCloseTo(400, 0);
    expect(p.y).toBeCloseTo(200, 0);
  });

  it("THE REPORT: a dense-on-one-side strip is labelled INSIDE, where the vertex average is not", () => {
    // A long strip whose SOUTH edge was digitized with 40 points and whose north edge is one
    // segment — exactly the subdivision-boundary shape that dragged the old anchor off the lot.
    const south = Array.from({ length: 41 }, (_, i) => ({ x: i * 25, y: 0 }));
    const ring = [...south, { x: 1000, y: 220 }, { x: 0, y: 220 }];
    const vertexAvg = ring.reduce((a, p) => ({ x: a.x + p.x / ring.length, y: a.y + p.y / ring.length }), { x: 0, y: 0 });
    expect(vertexAvg.y).toBeLessThan(20);                        // dragged hard onto the dense edge
    expect(inside(polylabel(ring), ring)).toBe(true);
    expect(polylabel(ring).y).toBeGreaterThan(60);               // and up in the body of the strip
  });

  it("is inside for concave shapes where the area centroid is not", () => {
    // A deep U — its area centroid falls in the notch, outside the polygon.
    const u = [{ x: 0, y: 0 }, { x: 400, y: 0 }, { x: 400, y: 500 }, { x: 300, y: 500 },
               { x: 300, y: 120 }, { x: 100, y: 120 }, { x: 100, y: 500 }, { x: 0, y: 500 }];
    let a2 = 0, gx = 0, gy = 0;
    for (let i = 0; i < u.length; i++) {
      const p = u[i], q = u[(i + 1) % u.length], f = p.x * q.y - q.x * p.y;
      a2 += f; gx += (p.x + q.x) * f; gy += (p.y + q.y) * f;
    }
    const areaCentroid = { x: gx / (3 * a2), y: gy / (3 * a2) };
    expect(inside(areaCentroid, u)).toBe(false);
    expect(inside(polylabel(u), u)).toBe(true);
  });

  it("is inside for an L, a flag lot and a triangle", () => {
    const shapes = [
      [{ x: 0, y: 0 }, { x: 600, y: 0 }, { x: 600, y: 200 }, { x: 200, y: 200 }, { x: 200, y: 600 }, { x: 0, y: 600 }],
      [{ x: 170, y: 0 }, { x: 230, y: 0 }, { x: 230, y: 300 }, { x: 430, y: 300 }, { x: 430, y: 560 }, { x: 0, y: 560 }, { x: 0, y: 300 }, { x: 170, y: 300 }],
      [{ x: 0, y: 0 }, { x: 700, y: 0 }, { x: 350, y: 520 }],
    ];
    for (const s of shapes) expect(inside(polylabel(s), s)).toBe(true);
  });

  it("memoises per ring array (same reference → identical object)", () => {
    const ring = rect(800, 400);
    expect(polylabel(ring)).toBe(polylabel(ring));
  });

  it("answers degenerate input instead of throwing", () => {
    expect(polylabel(null)).toBeNull();
    expect(polylabel([{ x: 0, y: 0 }, { x: 1, y: 1 }])).toBeNull();
    expect(polylabel([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 20, y: 0 }])).toEqual({ x: 10, y: 0 }); // zero-area → bbox centre
    expect(polylabel([{ x: 0, y: 0 }, { x: NaN, y: 0 }, { x: 5, y: 5 }])).toBeNull();
  });

  it("signedDist is positive inside, negative outside, and measures the nearest edge", () => {
    const r = rect(100, 100);
    expect(signedDist({ x: 50, y: 50 }, r)).toBeCloseTo(50, 6);
    expect(signedDist({ x: 50, y: 10 }, r)).toBeCloseTo(10, 6);
    expect(signedDist({ x: -5, y: 50 }, r)).toBeCloseTo(-5, 6);
  });
});
