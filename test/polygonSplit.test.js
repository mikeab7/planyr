import { describe, it, expect } from "vitest";
import {
  polyArea, splitPolygonByLine, splitPolygonByPath,
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

describe("splitPolygonByPath — bent polyline cut", () => {
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
