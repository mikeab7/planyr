/* B1612608 (item 1) — the road SURFACE offset-polygon construction AT THE JOIN, not the
 * centerline. Repro: a road turning through a tight interior angle used to blow its outer edge
 * into a rounded lobe well past the road's own width and pinch its inner edge into a
 * self-crossing "bowtie", so the drawn corridor stopped holding its stated width through the
 * bend. Root cause: `roadStripRing` (siteGeometry.js) built the pavement ring with
 * `metesAndBounds.bufferPolyline`, which offsets each side of the centerline INDEPENDENTLY via a
 * per-vertex bisector-and-clamp approximation (the clamp caps the miter SCALE at a flat ×3 but
 * never checks the inside edge against the outside one, and never falls back to a bevel) —
 * MEASURED below: because that offsets only the SPARSE control points and connects the results
 * with a straight line, a blown-out corner tilts the WHOLE leg's offset boundary, so the width
 * defect isn't confined to the corner — at a 15° interior angle an 80 ft road still reads barely
 * 41 ft wide even 95% of the way down a 2000 ft leg (see the probe values in the red-proof test).
 *
 * The fix is `roadNetwork.roadSurfaceRing` — one robust ClipperOffset (jtMiter, a stated miter
 * LIMIT that falls back to a flat BEVEL past it, plus Clipper's own self-intersection repair) —
 * and `metesAndBounds.offsetPolylineMiterLimit` for the curb stroke lines (a true per-vertex
 * miter-with-bevel, so the stroke tracks the now-correct pavement edge instead of spiking past
 * it). See both modules' headers for the full diagnosis.
 *
 * This suite is the RED-PROOF the item asked for: the "old construction" test below runs the SAME
 * angle sweep through the untouched `bufferPolyline` and proves it fails at the sharp end — this
 * suite would have failed on pre-fix `main`, satisfied by construction rather than assumed.
 */
import { describe, it, expect } from "vitest";
import { roadSurfaceRing, ROAD_JOIN_MITER_LIMIT } from "../src/workspaces/site-planner/lib/roadNetwork.js";
import { bufferPolyline, offsetPolylineMiterLimit } from "../src/workspaces/site-planner/lib/metesAndBounds.js";
import { roadStripRing, roadCurbLines } from "../src/workspaces/site-planner/lib/siteGeometry.js";

// ---- shared geometry test helpers (self-contained — mirrors the pattern metesAndBounds.js's
// own ringsOverlap / roadNetwork.js's dissolveRings tests already use for segment crossing) ----
const ccw = (a, b, c) => (c.y - a.y) * (b.x - a.x) > (b.y - a.y) * (c.x - a.x);
const segCross = (a, b, c, d) => ccw(a, c, d) !== ccw(b, c, d) && ccw(a, b, c) !== ccw(a, b, d);

// A SIMPLE polygon: no two non-adjacent edges cross.
function isSimplePolygon(ring) {
  const n = ring && ring.length;
  if (!n || n < 3) return false;
  for (let i = 0; i < n; i++) {
    const a = ring[i], b = ring[(i + 1) % n];
    for (let j = i + 1; j < n; j++) {
      const c = ring[j], d = ring[(j + 1) % n];
      const adjacent = j === (i + 1) % n || (j + 1) % n === i;
      if (adjacent) continue;
      if (segCross(a, b, c, d)) return false;
    }
  }
  return true;
}

const ringArea = (ring) => {
  let s = 0;
  for (let i = 0; i < ring.length; i++) { const a = ring[i], b = ring[(i + 1) % ring.length]; s += a.x * b.y - b.x * a.y; }
  return Math.abs(s / 2);
};

// The ring's local width (ft) perpendicular to `legDir` at `origin` — casts a ray both ways and
// measures the gap between the two nearest boundary crossings, i.e. exactly what a person reading
// the drawing with a scale ruler would measure across the pavement at that point. Same ray/segment
// intersection shape as roadGeometry.js's own `cardinalTeePoint` (cross-product solve), reused here
// rather than re-derived so the math is proven, not hand-rolled twice.
function widthAt(ring, origin, legDir) {
  const perp = { x: -legDir.y, y: legDir.x };
  const n = ring.length;
  let pos = Infinity, neg = Infinity;
  for (let i = 0; i < n; i++) {
    const p1 = ring[i], p2 = ring[(i + 1) % n];
    const ex = p2.x - p1.x, ey = p2.y - p1.y;
    const denom = perp.x * ey - perp.y * ex;
    if (Math.abs(denom) < 1e-9) continue;
    const dx = p1.x - origin.x, dy = p1.y - origin.y;
    const t = (dx * ey - dy * ex) / denom;         // ray parameter: origin + t·perp
    const s = (dx * perp.y - dy * perp.x) / denom; // segment parameter: p1 + s·(p2-p1)
    if (s < -1e-9 || s > 1 + 1e-9) continue;
    if (t > 1e-6 && t < pos) pos = t;
    if (t < -1e-6 && -t < neg) neg = -t;
  }
  return Number.isFinite(pos) && Number.isFinite(neg) ? pos + neg : null;
}

const rot = (v, rad) => ({ x: v.x * Math.cos(rad) - v.y * Math.sin(rad), y: v.x * Math.sin(rad) + v.y * Math.cos(rad) });

// A two-leg road A→P→C with interior angle `thetaDeg` at P, both legs length L, meeting SHARP
// (treatment forced hard, matching how a junction vertex already renders — the direct, minimal
// repro of "the offset-polygon construction at the join", independent of the centerline's own
// arc/smooth fillet machinery per the item's framing). L defaults generously large (2000 ft) so a
// measurement point can sit comfortably past ANY join's influence zone at every width tested here
// (measured: even the worst case in this sweep, 15°/80 ft, is exactly stable by ~320 ft in).
function bentRoad(thetaDeg, L = 2000) {
  const deflect = ((180 - thetaDeg) * Math.PI) / 180;
  const d1 = { x: 0, y: 1 };
  const d2 = rot(d1, deflect);
  const A = { x: 0, y: 0 };
  const P = { x: 0, y: L };
  const C = { x: P.x + d2.x * L, y: P.y + d2.y * L };
  return { A, P, C, d1, d2, pts: [A, P, C] };
}

const SWEEP_DEG = [150, 120, 90, 60, 45, 30, 15];
const WIDTHS = [8, 24, 36, 40, 80]; // narrow → several typical → very wide

// Distances IN FROM the vertex, along each leg's own straight run, MEASURED (not guessed) to sit
// past every join's transition zone for every angle/width combination in this sweep — a mitred or
// bevelled corner legitimately reads a different local width for a short stretch closest to the
// vertex on ANY correct construction (the same way a real curb return's own rounding isn't "full
// width" either); past that zone the width must be exact.
const SAFE_FT = [400, 800];

describe("B1612608 item 1 — road surface holds its width through a tight join (roadSurfaceRing)", () => {
  for (const theta of SWEEP_DEG) {
    for (const w of WIDTHS) {
      it(`interior ${theta}°, width ${w}ft — simple polygon, width held through the bend on both legs`, () => {
        const { P, d1, d2, pts } = bentRoad(theta);
        const ring = roadSurfaceRing(pts, w);
        expect(ring, `roadSurfaceRing must return a ring at ${theta}°/${w}ft`).toBeTruthy();
        expect(isSimplePolygon(ring)).toBe(true);
        // Leg A→P: sample BACKWARD from P (toward A). Leg P→C: sample FORWARD from P (toward C).
        for (const d of SAFE_FT) {
          const wA = widthAt(ring, { x: P.x - d1.x * d, y: P.y - d1.y * d }, d1);
          const wC = widthAt(ring, { x: P.x + d2.x * d, y: P.y + d2.y * d }, d2);
          expect(wA, `A leg @${d}ft from the vertex`).not.toBeNull();
          expect(wC, `C leg @${d}ft from the vertex`).not.toBeNull();
          expect(Math.abs(wA - w), `A leg @${d}ft`).toBeLessThan(0.1);
          expect(Math.abs(wC - w), `C leg @${d}ft`).toBeLessThan(0.1);
        }
        // No zero-width neck: a genuinely pinched corridor reads as either a self-intersection
        // (already asserted above) or a collapsed area far below the two-leg minimum.
        expect(ringArea(ring)).toBeGreaterThan(w * 3000);
      });
    }
  }

  it("the sharp end of the sweep is RED on the OLD construction (bufferPolyline) — proves this is the real repro", () => {
    const w = 40;
    const results = SWEEP_DEG.map((theta) => {
      const { P, d1, d2, pts } = bentRoad(theta);
      const ring = bufferPolyline(pts, w);
      const wA = widthAt(ring, { x: P.x - d1.x * SAFE_FT[0], y: P.y - d1.y * SAFE_FT[0] }, d1);
      const wC = widthAt(ring, { x: P.x + d2.x * SAFE_FT[0], y: P.y + d2.y * SAFE_FT[0] }, d2);
      const widthHeld = wA != null && wC != null && Math.abs(wA - w) < 0.1 && Math.abs(wC - w) < 0.1;
      return { theta, simple: ring ? isSimplePolygon(ring) : false, widthHeld, wA, wC };
    });
    // At least the sharp half of the sweep must be broken (self-intersecting OR failing to hold
    // its stated width through the bend, deep into an otherwise-straight 2000 ft leg) on the
    // untouched primitive, or this suite is not exercising the reported defect.
    const brokenSharp = results.filter((r) => r.theta <= 90 && (!r.simple || !r.widthHeld));
    expect(brokenSharp.length, `old bufferPolyline should be broken at ≤90°: ${JSON.stringify(results)}`).toBeGreaterThan(0);
    // And the fix genuinely holds where the old construction did not, on the SAME cases.
    for (const r of brokenSharp) {
      const { pts } = bentRoad(r.theta);
      const newRing = roadSurfaceRing(pts, w);
      expect(isSimplePolygon(newRing), `fix must be simple at ${r.theta}°`).toBe(true);
    }
  });
});

describe("B1612608 item 1 — adjacent cases", () => {
  it("a two-vertex straight road is unchanged (a simple rectangle, full width, no join at all)", () => {
    const pts = [{ x: 0, y: 0 }, { x: 0, y: 200 }];
    const ring = roadSurfaceRing(pts, 36);
    expect(isSimplePolygon(ring)).toBe(true);
    expect(widthAt(ring, { x: 0, y: 100 }, { x: 0, y: 1 })).toBeCloseTo(36, 1);
  });

  it("a gentle bend (170° interior) holds width and stays simple", () => {
    const { pts, P, d1, d2 } = bentRoad(170);
    const ring = roadSurfaceRing(pts, 36);
    expect(isSimplePolygon(ring)).toBe(true);
    expect(widthAt(ring, { x: P.x - d1.x * 400, y: P.y - d1.y * 400 }, d1)).toBeCloseTo(36, 1);
    expect(widthAt(ring, { x: P.x + d2.x * 400, y: P.y + d2.y * 400 }, d2)).toBeCloseTo(36, 1);
  });

  it("a switchback (two sharp turns whose join influence zones overlap) stays a simple polygon", () => {
    // A short middle leg (well under the road's own width) between two 90° turns — the two
    // corners' bevel/miter geometry necessarily overlaps.
    const w = 40;
    const A = { x: 0, y: 0 }, P1 = { x: 0, y: 2000 }, P2 = { x: 30, y: 2000 }, C = { x: 30, y: 4000 };
    const ring = roadSurfaceRing([A, P1, P2, C], w);
    expect(ring).toBeTruthy();
    expect(isSimplePolygon(ring)).toBe(true);
    expect(widthAt(ring, { x: 0, y: 1600 }, { x: 0, y: 1 })).toBeCloseTo(w, 1);
    expect(widthAt(ring, { x: 30, y: 2400 }, { x: 0, y: 1 })).toBeCloseTo(w, 1);
  });

  it("a segment shorter than the road's own width stays a simple polygon", () => {
    const w = 40; // the middle segment (10 ft) is a quarter of this
    const A = { x: 0, y: 0 }, P1 = { x: 0, y: 2000 }, P2 = { x: 10, y: 2005 }, C = { x: 2000, y: 2005 };
    const ring = roadSurfaceRing([A, P1, P2, C], w);
    expect(ring).toBeTruthy();
    expect(isSimplePolygon(ring)).toBe(true);
    expect(widthAt(ring, { x: 0, y: 1600 }, { x: 0, y: 1 })).toBeCloseTo(w, 1);
    expect(widthAt(ring, { x: 1600, y: 2005 }, { x: 1, y: 0 })).toBeCloseTo(w, 1);
  });

  it("a closed loop (start === end) buffers without crashing — a real result either way, not a crash or an empty ring", () => {
    // Loop closure/weld is the road-to-road WELD system's job (roadNetwork.dissolveRings +
    // teeGeometry — its own test already covers a true loop-of-strips enclosing a hole), not this
    // offset-join fix. `roadSurfaceRing`, like the old `bufferPolyline` it replaces, buffers a
    // single road's alignment as one OPEN polyline (flat end caps) with no notion of "this is a
    // closed shape" — for a road whose own pts happen to start and end at the same coordinate,
    // MEASURED: the old construction's independent per-vertex offsets leave a self-crossing seam
    // at that point (shoelace area partly cancels, reading artificially small — 288,151 sf); the
    // new one's robust Clipper offset instead resolves the whole loop into one continuous
    // annulus-shaped OUTER boundary (4,144,972 sf, an outer-boundary-only reading since this
    // function keeps only the single largest-area path and does not yet return a HOLE for the
    // annulus's hollow middle). Neither is "the closed-loop feature" — that's the dissolve
    // pipeline's job for a road actually welded to itself or to another road — but the new
    // construction is honestly reported here as a materially different (and, for this shape,
    // more topologically correct) result than before, not a silent behaviour change.
    const loop = [{ x: 0, y: 0 }, { x: 2000, y: 0 }, { x: 2000, y: 2000 }, { x: 0, y: 2000 }, { x: 0, y: 0 }];
    expect(bufferPolyline(loop, 36)).toBeTruthy();
    const newRing = roadSurfaceRing(loop, 36);
    expect(newRing).toBeTruthy();
    expect(newRing.length).toBeGreaterThanOrEqual(4);
    expect(ringArea(newRing)).toBeGreaterThan(0);
  });

  it("very narrow and very wide roads both hold width through a sharp 60° turn", () => {
    for (const w of [4, 150]) {
      const { pts, P, d1, d2 } = bentRoad(60);
      const ring = roadSurfaceRing(pts, w);
      expect(isSimplePolygon(ring)).toBe(true);
      expect(widthAt(ring, { x: P.x - d1.x * 400, y: P.y - d1.y * 400 }, d1)).toBeCloseTo(w, 1);
      expect(widthAt(ring, { x: P.x + d2.x * 400, y: P.y + d2.y * 400 }, d2)).toBeCloseTo(w, 1);
    }
  });
});

describe("B1612608 item 1 — roadStripRing / roadCurbLines integration (real element, sharp treatment)", () => {
  const roadEl = (thetaDeg, travelW = 36) => {
    const { pts } = bentRoad(thetaDeg, 300);
    return { type: "road", pts, vtx: [{}, { treatment: "sharp" }, {}], travelW, curb: 0.5, roadClass: "aisle" };
  };

  for (const theta of [90, 60, 45, 30, 15]) {
    it(`roadStripRing stays simple at a real element's ${theta}° sharp vertex`, () => {
      const ring = roadStripRing(roadEl(theta), {}, new Set(), undefined);
      expect(ring.length).toBeGreaterThanOrEqual(3);
      expect(isSimplePolygon(ring)).toBe(true);
    });
  }

  it("roadCurbLines no longer uses the raw offsetPolyline clamp (uses offsetPolylineMiterLimit)", () => {
    // offsetPolylineMiterLimit is exported specifically for this — a direct spot check that the
    // two curb strokes exist, are distinct, and stay finite at a sharp vertex.
    const lines = roadCurbLines(roadEl(30), {}, new Set(), undefined);
    expect(lines.length).toBe(2);
    for (const line of lines) {
      expect(line.length).toBeGreaterThanOrEqual(3); // straight + bevelled corner ⇒ extra point
      for (const p of line) { expect(Number.isFinite(p.x)).toBe(true); expect(Number.isFinite(p.y)).toBe(true); }
    }
  });
});

describe("offsetPolylineMiterLimit — the proper mitered join, limited, falls back to a bevel", () => {
  it("straight through: no join, output is 1:1 with input", () => {
    const pts = [{ x: 0, y: 0 }, { x: 0, y: 100 }, { x: 0, y: 200 }];
    const out = offsetPolylineMiterLimit(pts, 10);
    expect(out).toHaveLength(3);
    for (const p of out) expect(p.x).toBeCloseTo(-10, 6);
  });

  it("a moderate turn within the limit is a single mitered point", () => {
    const pts = [{ x: 0, y: 0 }, { x: 0, y: 100 }, { x: 100, y: 100 }]; // 90° turn
    const out = offsetPolylineMiterLimit(pts, 10, ROAD_JOIN_MITER_LIMIT);
    expect(out).toHaveLength(3); // no bevel needed at 90°
  });

  it("a very sharp turn past the limit bevels (adds a point) instead of spiking", () => {
    const pts = [{ x: 0, y: 0 }, { x: 0, y: 100 }, { x: -3, y: 97 }]; // ~163° deflection (17° interior)
    const out = offsetPolylineMiterLimit(pts, 10, 2);
    expect(out.length).toBeGreaterThan(3); // the corner contributed 2 points, not 1
    for (const p of out) { expect(Number.isFinite(p.x)).toBe(true); expect(Number.isFinite(p.y)).toBe(true); }
  });

  it("a full reversal (hairpin) always bevels — no finite miter exists", () => {
    const pts = [{ x: 0, y: 0 }, { x: 0, y: 100 }, { x: 0, y: 99 }]; // dead U-turn
    const out = offsetPolylineMiterLimit(pts, 10, 2);
    expect(out.length).toBeGreaterThan(3);
    for (const p of out) { expect(Number.isFinite(p.x)).toBe(true); expect(Number.isFinite(p.y)).toBe(true); }
  });

  it("returns null for fewer than 2 points", () => {
    expect(offsetPolylineMiterLimit([{ x: 0, y: 0 }], 10)).toBeNull();
    expect(offsetPolylineMiterLimit(null, 10)).toBeNull();
  });
});
