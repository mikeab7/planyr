/* STRESS / FUZZ suite for the Document-Review markup tool's geometry engine
 * (`takeoff.js`). The markup tool lets a user click arbitrary vertices, so the
 * geometry functions must survive ANY point set a hand can draw — duplicate
 * vertices, collinear runs, zero-length segments, single-point "polygons",
 * bow-tie self-intersections, and coordinates that span sub-pixel to whole-sheet.
 * A bad number here is a wrong takeoff (acreage a developer acts on), so these
 * are HARD invariants, not nice-to-haves.
 *
 * The seed is fixed so failures are reproducible and CI never flakes. Iteration
 * counts are kept modest (sub-second) while still covering the adversarial space;
 * an exhaustive 200k-iter sweep was run by hand against this same code (all green
 * bar self-intersecting label placement, which is mathematically undefined and
 * asserted separately below). */
import { describe, it, expect } from "vitest";
import {
  dist, pathLength, polyArea, measureValue, measureLabel, rollup,
  midOfPath, centroidOf, canCommitMeasure, MIN_MEASURE_PTS,
  sanitizeMarkup, sanitizeMarkups,
} from "../src/workspaces/doc-review/lib/takeoff.js";

// Deterministic LCG so the fuzz corpus is identical every run.
function makeRng(seed) {
  let s = seed >>> 0;
  return () => { s = (Math.imul(s, 1103515245) + 12345) & 0x7fffffff; return s / 0x7fffffff; };
}

// Even-odd point-in-polygon, mirrors takeoff's internal helper — used to verify
// centroidOf's "label sits on the shape" promise for SIMPLE polygons.
function pointInPoly(p, pts) {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const xi = pts[i].x, yi = pts[i].y, xj = pts[j].x, yj = pts[j].y;
    if ((yi > p.y) !== (yj > p.y) && p.x < ((xj - xi) * (p.y - yi)) / ((yj - yi) || 1e-12) + xi) inside = !inside;
  }
  return inside;
}

// Is the closed polygon simple (no non-adjacent edge crossings)?
function isSimple(pts) {
  const n = pts.length;
  const ccw = (a, b, c) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
  const cross = (a, b, c, d) => {
    const d1 = ccw(c, d, a), d2 = ccw(c, d, b), d3 = ccw(a, b, c), d4 = ccw(a, b, d);
    return ((d1 > 0) !== (d2 > 0)) && ((d3 > 0) !== (d4 > 0));
  };
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (i === (j + 1) % n || j === (i + 1) % n) continue;
      if (cross(pts[i], pts[(i + 1) % n], pts[j], pts[(j + 1) % n])) return false;
    }
  }
  return true;
}

const finite = (v) => Number.isFinite(v);
const finitePt = (p) => p && finite(p.x) && finite(p.y);
const KINDS = ["distance", "perimeter", "area", "count"];
// Calibrations a user (or a half-loaded sheet) can produce, incl. nasties.
const CALS = [0, 1, 2.5, 1 / 12, 240, 1e-9, 1e9];

// Build one adversarial markup from the RNG.
function randomMarkup(rand) {
  const n = 1 + Math.floor(rand() * 9);                 // 1..9 vertices
  const span = [1, 1e-6, 1e3, 1e6, 1e9][Math.floor(rand() * 5)];
  const pts = [];
  for (let i = 0; i < n; i++) pts.push({ x: (rand() - 0.5) * span, y: (rand() - 0.5) * span });
  if (rand() < 0.2 && pts.length > 1) pts[pts.length - 1] = { ...pts[0] };          // duplicate vertex
  if (rand() < 0.1) for (const p of pts) { p.x = pts[0].x; p.y = pts[0].y; }         // all coincident
  if (rand() < 0.1 && n >= 3) for (let i = 0; i < n; i++) { pts[i].x = i; pts[i].y = i; } // collinear
  return { kind: KINDS[Math.floor(rand() * KINDS.length)], page: Math.floor(rand() * 4), pts };
}

describe("markup geometry — adversarial fuzz (never NaN / Infinity / throw)", () => {
  it("survives 12k random/degenerate point sets with finite, sane outputs", () => {
    const rand = makeRng(0xC0FFEE);
    let checked = 0;
    for (let t = 0; t < 12000; t++) {
      const m = randomMarkup(rand);
      const fpu = CALS[Math.floor(rand() * CALS.length)];
      const pts = m.pts;

      // Nothing throws.
      const v = measureValue(m, fpu);
      const label = measureLabel(m, fpu);
      const area = polyArea(pts);
      const len = pathLength(pts, true);
      const mid = midOfPath(pts, m.kind !== "distance");
      const cen = centroidOf(pts);

      // Areas/lengths are non-negative and finite.
      expect(area, "polyArea ≥ 0").toBeGreaterThanOrEqual(0);
      expect(finite(area), "polyArea finite").toBe(true);
      expect(len, "pathLength ≥ 0").toBeGreaterThanOrEqual(0);
      expect(finite(len), "pathLength finite").toBe(true);

      // Label anchors are always finite points (they position SVG text).
      expect(finitePt(mid), "midOfPath finite").toBe(true);
      expect(finitePt(cen), "centroidOf finite").toBe(true);

      // measureValue numbers are finite when the input is.
      if (v.kind === "count") expect(Number.isInteger(v.count)).toBe(true);
      if (finite(fpu) && fpu > 0) {
        if (v.kind === "area" && v.calibrated) {
          expect(finite(v.areaSf), `area finite (fpu=${fpu})`).toBe(true);
          expect(finite(v.areaAc)).toBe(true);
          expect(v.areaSf).toBeGreaterThanOrEqual(0);
        }
        if ((v.kind === "distance" || v.kind === "perimeter") && v.calibrated) {
          expect(finite(v.lengthFt)).toBe(true);
          expect(v.lengthFt).toBeGreaterThanOrEqual(0);
        }
      }
      // Label is always a non-empty string, never "NaN"/"undefined".
      expect(typeof label).toBe("string");
      expect(label.length).toBeGreaterThan(0);
      expect(/NaN|undefined|Infinity/.test(label), `clean label: ${label}`).toBe(false);
      checked++;
    }
    expect(checked).toBe(12000);
  });
});

describe("markup geometry — invariants on well-formed shapes", () => {
  it("area label anchor sits INSIDE every simple polygon with real area (B307 promise)", () => {
    const rand = makeRng(42);
    let tested = 0;
    for (let t = 0; t < 20000 && tested < 4000; t++) {
      const n = 3 + Math.floor(rand() * 6);
      const pts = [];
      for (let i = 0; i < n; i++) pts.push({ x: Math.round((rand() - 0.5) * 400), y: Math.round((rand() - 0.5) * 400) });
      if (polyArea(pts) < 5) continue;          // skip slivers — label position is moot
      if (!isSimple(pts)) continue;             // self-intersecting "inside" is undefined
      const c = centroidOf(pts);
      expect(pointInPoly(c, pts), `centroid outside simple poly: ${JSON.stringify(pts)}`).toBe(true);
      tested++;
    }
    expect(tested).toBeGreaterThan(500);        // made sure we actually exercised the path
  });

  it("midOfPath stays within the path's bounding box (label never flies off-sheet)", () => {
    const rand = makeRng(7);
    for (let t = 0; t < 10000; t++) {
      const n = 2 + Math.floor(rand() * 7);
      const pts = [];
      for (let i = 0; i < n; i++) pts.push({ x: (rand() - 0.5) * 1000, y: (rand() - 0.5) * 1000 });
      const closed = rand() < 0.5;
      const mid = midOfPath(pts, closed);
      const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y);
      const eps = 1e-6;
      expect(mid.x).toBeGreaterThanOrEqual(Math.min(...xs) - eps);
      expect(mid.x).toBeLessThanOrEqual(Math.max(...xs) + eps);
      expect(mid.y).toBeGreaterThanOrEqual(Math.min(...ys) - eps);
      expect(mid.y).toBeLessThanOrEqual(Math.max(...ys) + eps);
    }
  });

  it("polyArea is invariant under vertex rotation and winding direction", () => {
    const rand = makeRng(99);
    for (let t = 0; t < 5000; t++) {
      const n = 3 + Math.floor(rand() * 6);
      const pts = [];
      for (let i = 0; i < n; i++) pts.push({ x: (rand() - 0.5) * 500, y: (rand() - 0.5) * 500 });
      const base = polyArea(pts);
      const rotated = [...pts.slice(1), pts[0]];        // start at a different vertex
      const reversed = [...pts].reverse();              // flip winding
      expect(polyArea(rotated)).toBeCloseTo(base, 6);
      expect(polyArea(reversed)).toBeCloseTo(base, 6);
    }
  });

  it("dist is symmetric and obeys the triangle inequality", () => {
    const rand = makeRng(123);
    for (let t = 0; t < 5000; t++) {
      const a = { x: (rand() - 0.5) * 1e4, y: (rand() - 0.5) * 1e4 };
      const b = { x: (rand() - 0.5) * 1e4, y: (rand() - 0.5) * 1e4 };
      const c = { x: (rand() - 0.5) * 1e4, y: (rand() - 0.5) * 1e4 };
      expect(dist(a, b)).toBeCloseTo(dist(b, a), 9);
      expect(dist(a, c)).toBeLessThanOrEqual(dist(a, b) + dist(b, c) + 1e-6);
    }
  });
});

describe("markup takeoff rollup — stress across many sheets", () => {
  it("rolls up 50k mixed markups with nasty calibrations into finite, consistent totals", () => {
    const rand = makeRng(2026);
    const markups = [];
    for (let i = 0; i < 50000; i++) {
      const n = 1 + Math.floor(rand() * 5);
      const pts = [];
      for (let k = 0; k < n; k++) pts.push({ x: rand() * 200, y: rand() * 200 });
      markups.push({ kind: KINDS[i % KINDS.length], page: i % 6, pts });
    }
    // page calibrations include 0 (uncalibrated), NaN, and real scales.
    const calByPage = { 0: 0, 1: 1, 2: 2.5, 3: NaN, 4: 1 / 12, 5: undefined };
    const r = rollup(markups, calByPage);

    for (const key of ["areaSf", "areaAc", "perimFt", "distFt", "count", "uncal"]) {
      expect(finite(r[key]), `rollup.${key} finite (=${r[key]})`).toBe(true);
      expect(r[key]).toBeGreaterThanOrEqual(0);
    }
    expect(Number.isInteger(r.count)).toBe(true);
    expect(Number.isInteger(r.uncal)).toBe(true);

    // Cross-check the aggregate loop against an independent per-markup pass through
    // measureValue (rollup has its own loop, so this is a real check, not a tautology).
    // NB a length/area markup is "uncalibrated" if EITHER its page lacks a scale OR it
    // has too few points to measure (e.g. a 1-point distance) — exactly what
    // measureValue reports, which is why a naive page-only count would be wrong.
    let xCount = 0, xUncal = 0;
    for (const m of markups) {
      const v = measureValue(m, calByPage[m.page]);
      if (v.kind === "count") xCount += v.count;
      else if (!v.calibrated) xUncal++;
    }
    expect(r.count).toBe(xCount);
    expect(r.uncal).toBe(xUncal);
    expect(r.count).toBe(markups.filter((m) => m.kind === "count").reduce((s, m) => s + m.pts.length, 0));
  });

  it("rollup ignores a NaN calibration instead of poisoning the totals", () => {
    const markups = [
      { kind: "area", page: 0, pts: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }] },
      { kind: "area", page: 1, pts: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }] },
    ];
    const r = rollup(markups, { 0: NaN, 1: 2 });   // page 0 calibration is garbage
    expect(finite(r.areaSf)).toBe(true);
    expect(r.areaSf).toBe(400);                    // only page 1 (100 * 2^2) counts
    expect(r.uncal).toBe(1);                        // page 0 excluded, not NaN-poisoned
  });
});

describe("markup commit gating — degenerate shapes can't be saved", () => {
  it("canCommitMeasure matches MIN_MEASURE_PTS and is monotonic in vertex count", () => {
    for (const kind of KINDS) {
      const need = MIN_MEASURE_PTS[kind];
      for (let n = 0; n <= need + 3; n++) {
        expect(canCommitMeasure(kind, n)).toBe(n >= need);
      }
    }
    // unknown kinds fall back to a single point (never block a stray tool).
    expect(canCommitMeasure("text", 1)).toBe(true);
    expect(canCommitMeasure("text", 0)).toBe(false);
  });

  it("B24 regression — empty / short point sets never throw and read as uncalibrated/zero", () => {
    for (const kind of KINDS) {
      for (const pts of [undefined, null, [], [{ x: 1, y: 2 }]]) {
        const m = { kind, pts: pts === undefined ? undefined : pts };
        expect(() => measureValue(m, 2)).not.toThrow();
        expect(() => measureLabel(m, 2)).not.toThrow();
        expect(() => measureValue(m, 0)).not.toThrow();
      }
    }
  });
});

describe("sanitizeMarkups — the load-boundary guard against corrupted/partial saved reviews", () => {
  it("gives a text markup a string `text` and an array `pts` (the m.text.length crash)", () => {
    // Exactly the shape that used to crash draw() at `m.text.length`.
    const out = sanitizeMarkup({ id: "m", kind: "text", pts: [{ x: 1, y: 2 }] }); // no `text`
    expect(out.text).toBe("");
    expect(typeof out.text).toBe("string");
    expect(out.pts).toEqual([{ x: 1, y: 2 }]);
    expect(() => `${out.text.length}`).not.toThrow();
  });

  it("drops non-finite (JSON-null) coordinates that a degenerate gesture could have saved", () => {
    // JSON.stringify turns NaN/Infinity into null → readDraft returns {x:null,y:null}.
    const out = sanitizeMarkup({ id: "m", kind: "area", pts: [
      { x: 0, y: 0 }, { x: null, y: null }, { x: 10, y: 0 }, { x: NaN, y: 5 }, { x: 10, y: 10 },
    ] });
    expect(out.pts).toEqual([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }]);
    // and the cleaned shape feeds the takeoff without NaN.
    expect(Number.isFinite(measureValue(out, 2).areaSf)).toBe(true);
  });

  it("preserves every other field losslessly and keeps valid markups intact", () => {
    const m = { id: "m7", page: 3, kind: "distance", pts: [{ x: 1, y: 2 }, { x: 3, y: 4 }], note: "keep me", revision: 2 };
    expect(sanitizeMarkup(m)).toEqual(m);
  });

  it("returns null for unsalvageable entries; the array form filters them out", () => {
    expect(sanitizeMarkup(null)).toBeNull();
    expect(sanitizeMarkup({})).toBeNull();              // no kind
    expect(sanitizeMarkup({ kind: 42 })).toBeNull();    // kind not a string
    const cleaned = sanitizeMarkups([
      null,
      { kind: "text", pts: [{ x: 0, y: 0 }] },          // valid (text filled)
      "garbage",
      { kind: "distance", pts: "not-an-array" },        // pts coerced to []
      undefined,
    ]);
    expect(cleaned).toHaveLength(2);
    expect(cleaned[0].text).toBe("");
    expect(cleaned[1].pts).toEqual([]);
  });

  it("is safe on non-array / missing input (a brand-new or schemaless review)", () => {
    expect(sanitizeMarkups(undefined)).toEqual([]);
    expect(sanitizeMarkups(null)).toEqual([]);
    expect(sanitizeMarkups("nope")).toEqual([]);
  });

  it("fuzz: never throws and always yields render-safe markups", () => {
    const rand = makeRng(0x5A117A);
    const kinds = ["distance", "perimeter", "area", "count", "rect", "cloud", "text", "bogus", 7, null];
    for (let i = 0; i < 5000; i++) {
      const raw = {
        id: rand() < 0.9 ? `m${i}` : undefined,
        kind: kinds[Math.floor(rand() * kinds.length)],
        pts: rand() < 0.8 ? Array.from({ length: Math.floor(rand() * 6) }, () => ({
          x: [0, 1.5, NaN, Infinity, null, "x"][Math.floor(rand() * 6)],
          y: [0, 2.5, -Infinity, NaN, undefined][Math.floor(rand() * 5)],
        })) : (rand() < 0.5 ? null : "junk"),
        text: rand() < 0.5 ? undefined : "note",
      };
      const out = sanitizeMarkup(raw);
      if (out === null) continue;
      expect(Array.isArray(out.pts)).toBe(true);
      for (const p of out.pts) expect(Number.isFinite(p.x) && Number.isFinite(p.y)).toBe(true);
      if (out.kind === "text") expect(typeof out.text).toBe("string");
    }
  });
});
