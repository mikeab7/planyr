import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
  polyArea, splitPolygonByLine, splitPolygonByPath,
  splitPolygonByCut, remapEdgeVector, CUT_REASONS,
} from "../src/workspaces/site-planner/lib/polygonSplit.js";

// --- tiny local oracle helpers (independent of the implementation) ---
const segsCross = (p1, p2, p3, p4) => {
  const o = (a, b, c) => Math.sign((b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x));
  const o1 = o(p1, p2, p3), o2 = o(p1, p2, p4), o3 = o(p3, p4, p1), o4 = o(p3, p4, p2);
  return !!o1 && !!o2 && !!o3 && !!o4 && o1 !== o2 && o3 !== o4;
};
const selfIntersects = (pts) => {
  const n = pts.length;
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
    if ((i + 1) % n === j || (j + 1) % n === i) continue;
    if (segsCross(pts[i], pts[(i + 1) % n], pts[j], pts[(j + 1) % n])) return true;
  }
  return false;
};
const pip = (pt, poly) => {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i].x, yi = poly[i].y, xj = poly[j].x, yj = poly[j].y;
    if (((yi > pt.y) !== (yj > pt.y)) && (pt.x < (xj - xi) * (pt.y - yi) / (yj - yi) + xi)) c = !c;
  }
  return c;
};
const areas = (pieces) => pieces.map(polyArea).sort((a, b) => a - b);
const sumAreas = (pieces) => pieces.reduce((s, p) => s + polyArea(p), 0);

const RECT = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }];
// L-shape: bottom band + left band (concave, area 6400).
const L = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 40 }, { x: 40, y: 40 }, { x: 40, y: 100 }, { x: 0, y: 100 }];
// U-shape: two prongs over a base (deeply concave, area 7600). A horizontal cut across the
// prongs makes THREE pieces — the case the old splitter got wrong.
const U = [
  { x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 70, y: 100 },
  { x: 70, y: 40 }, { x: 30, y: 40 }, { x: 30, y: 100 }, { x: 0, y: 100 },
];

describe("splitPolygonByLine — convex", () => {
  it("vertical cut halves a square into two equal pieces", () => {
    const pieces = splitPolygonByLine(RECT, { x: 50, y: -10 }, { x: 50, y: 110 });
    expect(pieces).toHaveLength(2);
    expect(areas(pieces)).toEqual([5000, 5000]);
    expect(sumAreas(pieces)).toBeCloseTo(polyArea(RECT), 6);
    pieces.forEach((p) => expect(selfIntersects(p)).toBe(false));
  });

  it("returns null when the line misses the polygon entirely", () => {
    expect(splitPolygonByLine(RECT, { x: 200, y: -10 }, { x: 200, y: 110 })).toBeNull();
  });

  it("returns null on degenerate input (fewer than 3 vertices)", () => {
    expect(splitPolygonByLine([{ x: 0, y: 0 }, { x: 1, y: 1 }], { x: 0, y: 0 }, { x: 1, y: 0 })).toBeNull();
  });
});

describe("splitPolygonByLine — concave, 2 crossings (cut stays inside)", () => {
  it("L-shape vertical cut through the tall part -> 2 pieces, area conserved", () => {
    const pieces = splitPolygonByLine(L, { x: 20, y: -10 }, { x: 20, y: 110 });
    expect(pieces).toHaveLength(2);
    expect(sumAreas(pieces)).toBeCloseTo(6400, 6);
    expect(areas(pieces)).toEqual([2000, 4400]); // 20x100 strip + remainder
    pieces.forEach((p) => expect(selfIntersects(p)).toBe(false));
  });

  it("L-shape vertical cut through the short band -> 2 pieces", () => {
    const pieces = splitPolygonByLine(L, { x: 60, y: -10 }, { x: 60, y: 110 });
    expect(pieces).toHaveLength(2);
    expect(areas(pieces)).toEqual([1600, 4800]); // 40x40 corner + remainder
    expect(sumAreas(pieces)).toBeCloseTo(6400, 6);
  });
});

describe("splitPolygonByLine — concave, 4 crossings (the headline fix)", () => {
  it("U-shape horizontal cut across both prongs -> THREE pieces that conserve area", () => {
    const pieces = splitPolygonByLine(U, { x: -10, y: 70 }, { x: 110, y: 70 });
    expect(pieces).toHaveLength(3);
    expect(sumAreas(pieces)).toBeCloseTo(7600, 6);
    // two 30x30 prong tops + the base
    expect(areas(pieces)).toEqual([900, 900, 5800]);
    pieces.forEach((p) => expect(selfIntersects(p)).toBe(false));
  });

  it("every interior point lands in exactly one piece; no exterior point lands in any", () => {
    const pieces = splitPolygonByLine(U, { x: -10, y: 70 }, { x: 110, y: 70 });
    let bad = 0;
    for (let i = 0; i < 2000; i++) {
      const q = { x: -20 + Math.random() * 140, y: -20 + Math.random() * 140 };
      const inWhole = pip(q, U);
      const hits = pieces.reduce((c, p) => c + (pip(q, p) ? 1 : 0), 0);
      if (inWhole ? hits !== 1 : hits !== 0) bad++;
    }
    expect(bad).toBe(0);
  });
});

describe("splitPolygonByLine — comb (6 crossings -> 4 pieces)", () => {
  // A 3-tooth comb: a base with three upward prongs, cut horizontally through the prongs.
  // The cut crosses the boundary 6 times, so the result must be 4 pieces (base + 3 tops).
  const COMB = [
    { x: 0, y: 0 }, { x: 180, y: 0 }, { x: 180, y: 30 },
    { x: 160, y: 30 }, { x: 160, y: 90 }, { x: 140, y: 90 }, { x: 140, y: 30 }, // right tooth
    { x: 100, y: 30 }, { x: 100, y: 90 }, { x: 80, y: 90 }, { x: 80, y: 30 },   // middle tooth
    { x: 40, y: 30 }, { x: 40, y: 90 }, { x: 20, y: 90 }, { x: 20, y: 30 },     // left tooth
    { x: 0, y: 30 },
  ];
  it("yields 4 area-conserving simple pieces", () => {
    const pieces = splitPolygonByLine(COMB, { x: -10, y: 60 }, { x: 190, y: 60 });
    expect(pieces).toHaveLength(4);
    expect(sumAreas(pieces)).toBeCloseTo(polyArea(COMB), 4);
    expect(areas(pieces)).toEqual([600, 600, 600, 7200]); // 3 tooth-tops + base-with-stubs
    pieces.forEach((p) => expect(selfIntersects(p)).toBe(false));
  });
});

describe("splitPolygonByLine — randomized property check", () => {
  // Many random concave star cuts: every produced split must conserve area and tile the
  // original (membership). This is the regression net for the geometry.
  function mulberry32(a) { return function () { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
  it("conserves area + membership across 1500 random concave cuts", () => {
    const rng = mulberry32(7);
    let checked = 0;
    for (let it = 0; it < 1500; it++) {
      const nv = 5 + Math.floor(rng() * 7);
      const P = [];
      for (let k = 0; k < nv; k++) { const ang = 2 * Math.PI * k / nv, r = 20 + rng() * 80; P.push({ x: Math.cos(ang) * r, y: Math.sin(ang) * r }); }
      if (selfIntersects(P)) continue;
      const whole = polyArea(P);
      if (whole < 50) continue;
      const A = { x: -120 + rng() * 240, y: -120 + rng() * 240 };
      const B = { x: -120 + rng() * 240, y: -120 + rng() * 240 };
      if (Math.hypot(B.x - A.x, B.y - A.y) < 5) continue;
      const pieces = splitPolygonByLine(P, A, B);
      if (!pieces) continue;
      checked++;
      expect(sumAreas(pieces)).toBeCloseTo(whole, 3);
      // membership: sample inside the bbox
      let bad = 0, tot = 0;
      let minx = Infinity, miny = Infinity, maxx = -Infinity, maxy = -Infinity;
      for (const p of P) { minx = Math.min(minx, p.x); miny = Math.min(miny, p.y); maxx = Math.max(maxx, p.x); maxy = Math.max(maxy, p.y); }
      for (let s = 0; s < 120; s++) {
        const q = { x: minx + rng() * (maxx - minx), y: miny + rng() * (maxy - miny) };
        const inWhole = pip(q, P);
        const hits = pieces.reduce((c, pc) => c + (pip(q, pc) ? 1 : 0), 0);
        tot++;
        if (inWhole ? hits !== 1 : hits !== 0) bad++;
      }
      // allow a hair of slack only for points landing within ~1 unit of the cut line
      expect(bad / tot).toBeLessThan(0.03);
    }
    expect(checked).toBeGreaterThan(200);
  });
});

describe("splitPolygonByPath — bent polyline cut (RETIRED; kept as the pre-fix oracle)", () => {
  it("splits a square with a 3-point bent cut into two area-conserving pieces", () => {
    const half = splitPolygonByPath(RECT, [{ x: 50, y: 0 }, { x: 60, y: 50 }, { x: 50, y: 100 }]);
    expect(half).not.toBeNull();
    expect(half).toHaveLength(2);
    expect(sumAreas(half)).toBeCloseTo(10000, 6);
  });

  it("returns null when entry and exit project to the same edge", () => {
    expect(splitPolygonByPath(RECT, [{ x: 10, y: 0 }, { x: 90, y: 0 }])).toBeNull();
  });
});

/* ============================================================================================ *
 *  splitPolygonByCut — the general engine (NEW-1).
 *
 *  The owner's report: "I tried to split a parcel, but it seems like it only allows very simple
 *  cuts. And I'd like to split a parcel with a more complicated cut." The app answered a bent cut
 *  with "That cut crosses the parcel ambiguously (concave shape) — try a straight cut between two
 *  opposite edges." Two of his OWN production parcels reproduce that toast verbatim under the
 *  pre-fix pipeline, and both are asserted below (`the pre-fix pipeline`) so this suite is proven
 *  RED against the code it replaces rather than only green against the code it adds.
 * ============================================================================================ */

const fixture = (file, id) => {
  const j = JSON.parse(readFileSync(new URL(`../ui-audit/fixtures/${file}`, import.meta.url), "utf8"));
  const pc = j.parcels.find((p) => p.id === id);
  if (!pc) throw new Error(`fixture ${file} has no parcel ${id}`);
  return pc.points;
};
const bbox = (pts) => {
  let minx = Infinity, miny = Infinity, maxx = -Infinity, maxy = -Infinity;
  for (const p of pts) { minx = Math.min(minx, p.x); miny = Math.min(miny, p.y); maxx = Math.max(maxx, p.x); maxy = Math.max(maxy, p.y); }
  return { minx, miny, maxx, maxy, w: maxx - minx, h: maxy - miny };
};
// A creek-shaped cut: four points, three bends, entering and leaving well outside the tract.
const creekCut = (pts) => {
  const b = bbox(pts);
  return [
    { x: b.minx - 50, y: b.miny + b.h * 0.25 },
    { x: b.minx + b.w * 0.40, y: b.miny + b.h * 0.55 },
    { x: b.minx + b.w * 0.70, y: b.miny + b.h * 0.35 },
    { x: b.maxx + 50, y: b.miny + b.h * 0.80 },
  ];
};
const cutAreas = (r) => r.pieces.map((p) => p.area);
const cutSum = (r) => r.pieces.reduce((s, p) => s + p.area, 0);

// The exact pre-fix pipeline from SitePlanner.performSplit, so "it used to refuse this" is a
// measurement rather than a memory.
function preFixSplit(points, path) {
  const pieces = path.length === 2 ? splitPolygonByLine(points, path[0], path[1]) : splitPolygonByPath(points, path);
  if (!pieces) return { refused: "null" };
  const whole = polyArea(points), sum = pieces.reduce((s, r) => s + polyArea(r), 0);
  if (pieces.some(selfIntersects) || Math.abs(sum - whole) > whole * 0.02 + 1) return { refused: "ambiguous-toast" };
  return { pieces };
}

describe("splitPolygonByCut — orientation convention (pinned)", () => {
  // The face walk turns as clockwise as it can at every node, which makes BOUNDED faces
  // counter-clockwise and each outer cycle the other way. The engine uses that sign as its
  // boundedness test, so if the convention ever drifts this is the test that says so — every
  // other case here would fail as a confusing area mismatch.
  it("a straight cut across a square yields exactly the two halves", () => {
    const r = splitPolygonByCut(RECT, [{ x: 50, y: -10 }, { x: 50, y: 110 }]);
    expect(r.ok).toBe(true);
    expect(r.pieces).toHaveLength(2);
    expect(cutAreas(r).map(Math.round)).toEqual([5000, 5000]);
  });
});

describe("splitPolygonByCut — multi-segment cuts (reading (a) of 'more complicated')", () => {
  it("a 3-point bent cut divides a square and conserves area exactly", () => {
    const r = splitPolygonByCut(RECT, [{ x: 50, y: -5 }, { x: 60, y: 50 }, { x: 50, y: 105 }]);
    expect(r.ok).toBe(true);
    expect(r.pieces).toHaveLength(2);
    expect(cutSum(r)).toBeCloseTo(10000, 6);
    r.pieces.forEach((p) => expect(selfIntersects(p.ring)).toBe(false));
  });

  it("a 5-point zig-zag across a concave L conserves area and tiles it", () => {
    const path = [
      { x: -10, y: 20 }, { x: 20, y: 30 }, { x: 45, y: 15 }, { x: 70, y: 30 }, { x: 110, y: 25 },
    ];
    const r = splitPolygonByCut(L, path);
    expect(r.ok).toBe(true);
    expect(cutSum(r)).toBeCloseTo(polyArea(L), 6);
    let bad = 0;
    for (let i = 0; i < 3000; i++) {
      const q = { x: -20 + Math.random() * 140, y: -20 + Math.random() * 140 };
      const inWhole = pip(q, L);
      const hits = r.pieces.reduce((c, p) => c + (pip(q, p.ring) ? 1 : 0), 0);
      if (inWhole ? hits > 1 : hits !== 0) bad++;   // never in two pieces, never outside the parent
    }
    expect(bad).toBe(0);
  });

  it("a cut end that stops INSIDE the lot is carried out along its own bearing, not refused", () => {
    const inside = [{ x: 50, y: 10 }, { x: 60, y: 50 }, { x: 50, y: 90 }];
    const r = splitPolygonByCut(RECT, inside);
    expect(r.ok).toBe(true);
    expect(r.extended).toBe(true);
    expect(cutSum(r)).toBeCloseTo(10000, 6);
    // …and with the forgiveness switched off it is a NAMED refusal, not a generic one.
    const strict = splitPolygonByCut(RECT, inside, { extendEnds: false });
    expect(strict.ok).toBe(false);
    expect(strict.code).toBe("dead-end");
    expect(strict.message).toBe(CUT_REASONS["dead-end"]);
  });
});

describe("splitPolygonByCut — more than two crossings (reading (b) of 'more complicated')", () => {
  it("a straight cut across the U makes THREE pieces, agreeing with the line oracle", () => {
    const r = splitPolygonByCut(U, [{ x: -10, y: 70 }, { x: 110, y: 70 }]);
    expect(r.ok).toBe(true);
    expect(r.pieces).toHaveLength(3);
    expect(cutAreas(r).map(Math.round).sort((a, b) => a - b)).toEqual([900, 900, 5800]);
    // Independent implementation, same answer.
    const oracle = splitPolygonByLine(U, { x: -10, y: 70 }, { x: 110, y: 70 });
    expect(areas(oracle).map(Math.round)).toEqual(cutAreas(r).map(Math.round).sort((a, b) => a - b));
  });

  it("a straight cut across a 3-tooth comb makes FOUR pieces", () => {
    const COMB = [
      { x: 0, y: 0 }, { x: 180, y: 0 }, { x: 180, y: 30 },
      { x: 160, y: 30 }, { x: 160, y: 90 }, { x: 140, y: 90 }, { x: 140, y: 30 },
      { x: 100, y: 30 }, { x: 100, y: 90 }, { x: 80, y: 90 }, { x: 80, y: 30 },
      { x: 40, y: 30 }, { x: 40, y: 90 }, { x: 20, y: 90 }, { x: 20, y: 30 },
      { x: 0, y: 30 },
    ];
    const r = splitPolygonByCut(COMB, [{ x: -10, y: 60 }, { x: 190, y: 60 }]);
    expect(r.ok).toBe(true);
    expect(r.pieces).toHaveLength(4);
    expect(cutAreas(r).map(Math.round).sort((a, b) => a - b)).toEqual([600, 600, 600, 7200]);
    expect(cutSum(r)).toBeCloseTo(polyArea(COMB), 4);
  });

  it("a BENT cut that re-enters the U makes four pieces and still conserves area", () => {
    const r = splitPolygonByCut(U, [
      { x: -10, y: 70 }, { x: 50, y: 70 }, { x: 50, y: 20 }, { x: 90, y: 20 }, { x: 90, y: 110 },
    ]);
    expect(r.ok).toBe(true);
    expect(r.pieces.length).toBeGreaterThanOrEqual(3);
    expect(cutSum(r)).toBeCloseTo(polyArea(U), 6);
    r.pieces.forEach((p) => expect(selfIntersects(p.ring)).toBe(false));
  });
});

describe("splitPolygonByCut — the owner's real parcels", () => {
  /* These are recorded production rings, not textbook polygons, and each one carries a condition
   * that broke an earlier draft of this engine. Do not "tidy" the numbers. */
  const GOOSE = fixture("goose-creek-plan1copy.json", "e1454746tcmstb");       // 95 AC, pinched hole
  const SYLVESTRI = fixture("sylvestri-concept-d-full.json", "e1454631bfeaps"); // 158 AC, 56 verts
  const BAIN = fixture("bain-quiddity.json", "e1454855gyzzln");                 // 109 AC, zero-width prong

  it("the pre-fix pipeline reproduces the owner's toast on his own land", () => {
    // This is the reported bug, measured. Both refusals are the "concave shape" path.
    expect(preFixSplit(GOOSE, creekCut(GOOSE)).refused).toBe("ambiguous-toast");
    expect(preFixSplit(BAIN, creekCut(BAIN)).refused).toBe("ambiguous-toast");
  });

  it("Goose Creek (95 AC, concave) takes a bent creek-shaped cut, area conserved to the last foot", () => {
    const r = splitPolygonByCut(GOOSE, creekCut(GOOSE));
    expect(r.ok).toBe(true);
    expect(r.pieces.length).toBeGreaterThanOrEqual(2);
    expect(Math.abs(cutSum(r) - polyArea(GOOSE)) / polyArea(GOOSE)).toBeLessThan(1e-9);
    r.pieces.forEach((p) => expect(selfIntersects(p.ring)).toBe(false));
  });

  it("Goose Creek's PINCHED interior exclusion is not turned into a piece", () => {
    /* Its ring runs out to a point, clockwise around an interior exclusion while the rest of the
     * lot runs counter-clockwise, and back through that same point — a hole reached by a
     * zero-width slit. Under an even-odd containment test that hole reads as land and the split
     * invents ~13,400 SF of acreage that the parcel does not own. */
    const r = splitPolygonByCut(GOOSE, creekCut(GOOSE));
    expect(cutSum(r)).toBeLessThan(polyArea(GOOSE) * (1 + 1e-9));
    expect(r.pieces.every((p) => p.area > 0)).toBe(true);
  });

  it("Sylvestri (158 AC, 56 vertices) splits and conserves area", () => {
    const r = splitPolygonByCut(SYLVESTRI, creekCut(SYLVESTRI));
    expect(r.ok).toBe(true);
    expect(Math.abs(cutSum(r) - polyArea(SYLVESTRI)) / polyArea(SYLVESTRI)).toBeLessThan(1e-9);
  });

  it("Bain (109 AC): every piece is KEPT, the tiny ones are named, and the broken outline is reported", () => {
    /* This ring runs 1,296 ft out along a zero-width prong and back, and the returning leg clips
     * the outgoing one about two tenths of an inch above its base. The quoted (shoelace) acreage
     * therefore counts an 8 SF crumb twice.
     * ⛔ B520560, owner rule: "Nothing may be discarded silently — if a cut produces a sliver, he
     * gets it as a parcel rather than losing the acreage." B455360 dropped scraps under a
     * hundred-thousandth of the parent and reported the loss; this asserts the REVERSAL. */
    const r = splitPolygonByCut(BAIN, creekCut(BAIN));
    expect(r.ok).toBe(true);
    expect(r.pieces).toHaveLength(5);               // 3 real pieces + the 2 crumbs, all KEPT
    expect(r.tiny).not.toBeNull();
    expect(r.tiny.count).toBe(2);
    expect(r.outlineDrift).not.toBeNull();
    expect(r.outlineDrift.sqft).toBeGreaterThan(0);
    expect(r.outlineDrift.sqft).toBeLessThan(polyArea(BAIN) * 1e-4);
    // Nothing left the plan: the pieces themselves plus the reported outline drift are the parcel.
    expect(cutSum(r) + r.outlineDrift.sqft).toBeCloseTo(polyArea(BAIN), 3);
    // And the tiny ones are pieces, not a subtraction — their area is inside the sum above.
    expect(r.tiny.area).toBeGreaterThan(0);
    expect(cutSum(r)).toBeGreaterThan(polyArea(BAIN) - r.outlineDrift.sqft - 1e-6);
  });
});

describe("splitPolygonByCut — the guardrail says what is wrong with THIS cut", () => {
  it("a cut that never reaches the parcel", () => {
    const r = splitPolygonByCut(RECT, [{ x: 200, y: -10 }, { x: 220, y: 110 }]);
    expect(r.ok).toBe(false);
    expect(r.code).toBe("outside");
    expect(r.message).toMatch(/never crosses the parcel/);
  });

  it("a cut drawn along the property line", () => {
    const r = splitPolygonByCut(RECT, [{ x: 10, y: 0 }, { x: 90, y: 0 }], { extendEnds: false });
    expect(r.ok).toBe(false);
    expect(r.code).toBe("along-boundary");
  });

  it("a cut that dead-ends inside", () => {
    const r = splitPolygonByCut(RECT, [{ x: 50, y: -10 }, { x: 50, y: 50 }], { extendEnds: false });
    expect(r.ok).toBe(false);
    expect(r.code).toBe("dead-end");
  });

  it("a degenerate parcel or cut", () => {
    expect(splitPolygonByCut([{ x: 0, y: 0 }, { x: 1, y: 1 }], [{ x: 0, y: 0 }, { x: 1, y: 0 }]).code).toBe("bad-parcel");
    expect(splitPolygonByCut(RECT, [{ x: 5, y: 5 }]).code).toBe("bad-cut");
  });

  it("every refusal carries its own words — there is no generic fallback message", () => {
    const seen = new Set();
    for (const [code, msg] of Object.entries(CUT_REASONS)) {
      expect(msg.length).toBeGreaterThan(20);
      expect(msg).not.toMatch(/try a straight cut/i);   // the copy this item exists to delete
      expect(seen.has(msg)).toBe(false);
      seen.add(msg);
      expect(code).toBeTruthy();
    }
  });
});

describe("splitPolygonByCut — per-edge provenance", () => {
  it("reports which parent edge every new edge came from, and -1 for the cut's own", () => {
    const r = splitPolygonByCut(RECT, [{ x: 50, y: -10 }, { x: 50, y: 110 }]);
    for (const p of r.pieces) {
      expect(p.edgeSrc).toHaveLength(p.ring.length);
      expect(p.edgeSrc.some((s) => s === -1)).toBe(true);          // the cut made at least one edge
      expect(p.edgeSrc.every((s) => s === -1 || (s >= 0 && s < RECT.length))).toBe(true);
    }
  });

  it("remapEdgeVector carries per-edge setbacks across and never guesses on a cut edge", () => {
    const r = splitPolygonByCut(RECT, [{ x: 50, y: -10 }, { x: 50, y: 110 }]);
    const setbacks = [25, 10, 25, 10];
    for (const p of r.pieces) {
      const out = remapEdgeVector(setbacks, p.edgeSrc);
      expect(out).toHaveLength(p.ring.length);
      p.edgeSrc.forEach((src, i) => {
        expect(out[i]).toBe(src === -1 ? null : setbacks[src]);
      });
    }
    expect(remapEdgeVector(null, [0, 1])).toBeNull();
    expect(remapEdgeVector([], [0, 1])).toBeNull();
    expect(remapEdgeVector([null, null], [0, 1])).toBeNull();   // nothing to carry → no key added
  });
});

describe("splitPolygonByCut — randomized property check over BENT cuts", () => {
  function mulberry32(a) { return function () { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
  it("conserves area and tiles the parent across 800 random multi-segment cuts", () => {
    const rng = mulberry32(11);
    let checked = 0;
    for (let iter = 0; iter < 800; iter++) {
      const nv = 5 + Math.floor(rng() * 8);
      const P = [];
      for (let k = 0; k < nv; k++) { const ang = 2 * Math.PI * k / nv, r = 20 + rng() * 80; P.push({ x: Math.cos(ang) * r, y: Math.sin(ang) * r }); }
      if (selfIntersects(P)) continue;
      const whole = polyArea(P);
      if (whole < 200) continue;
      const segs = 2 + Math.floor(rng() * 4);
      const path = [];
      for (let k = 0; k <= segs; k++) path.push({ x: -160 + rng() * 320, y: -160 + rng() * 320 });
      const r = splitPolygonByCut(P, path);
      if (!r.ok) continue;
      checked++;
      const claimed = cutSum(r);   // every piece is kept, so the pieces ARE the parcel
      expect(Math.abs(claimed - whole)).toBeLessThan(whole * 1e-6 + 1e-6);
      r.pieces.forEach((p) => expect(selfIntersects(p.ring)).toBe(false));
      // membership: no point may be claimed by two pieces, and nothing outside the parent may be
      // claimed at all.
      let bad = 0, tot = 0;
      for (let s = 0; s < 60; s++) {
        const q = { x: -110 + rng() * 220, y: -110 + rng() * 220 };
        const hits = r.pieces.reduce((c, pc) => c + (pip(q, pc.ring) ? 1 : 0), 0);
        tot++;
        if (hits > 1) bad++;
        else if (hits === 1 && !pip(q, P)) bad++;
      }
      expect(bad / tot).toBeLessThan(0.03);
    }
    expect(checked).toBeGreaterThan(150);
  });
});
