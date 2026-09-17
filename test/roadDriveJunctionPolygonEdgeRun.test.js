/* B1717616 — a road tee-ing into a POLYGON paving pad at an oblique angle gets a real curb return
 * on only one corner; the other silently degrades to teeGeometry's own NEW-2/B1703665 sharp-corner
 * fallback (a raw, un-rounded corner) whenever the pad's nominally-straight edge is digitized as more
 * than one polygon segment — which a freehand-drawn pad routinely is (a mouse-clicked property line,
 * or a vertex an earlier edit left behind).
 *
 * ⛔ THIS SUITE CALLS THE REAL `driveJunctionsOf` (roadJunctions.js) DIRECTLY, never a hand-copied
 * re-derivation. `test/roadDriveJunctionFillet.test.js`'s own scenario helpers predate the B1703666
 * extraction and still hand-copy `driveJunctionsOf`'s math — exactly the trap `roadJunctions.js`'s own
 * header names as the reason three prior road-junction "fixes" shipped with a fully green suite while
 * the deployed build stayed broken (the test was never running the function the app runs). This file
 * exists so this specific defect class cannot recur invisibly the same way: it imports the app's own
 * pure junction builder and drives it end to end.
 *
 * ROOT CAUSE, measured directly (not assumed): `driveJunctionsOf` computed `throughAvailPos`/
 * `throughAvailNeg` — the room `teeGeometry`'s reach clamp (`tMax`) is allowed to use — from ONLY the
 * single polygon edge nearest the connect point (`edgeRunPos`/`edgeRunNeg`, a straight-line projection
 * to that edge's own endpoints). A polygon pad's "one straight bottom edge" is routinely digitized as
 * several near- or exactly-collinear segments; a connect point that happens to land near one of those
 * purely-cosmetic digitizing vertices saw only a few tens of feet of "room" instead of the true (much
 * longer) straight run, collapsing `tMax` to ~0 on that side. `teeGeometry`'s wedge builder still
 * closed the resulting gore (the NEW-2/B1703665 sharp-corner fallback), so the region stayed one
 * connected, simple polygon with zero enclosed area — which is exactly why the EXISTING
 * `roadDriveJunctionFillet.test.js` suite (region count, simplicity, enclosed-flood-fill-area) reads
 * clean on this defect: none of those measures can see "the pavement is there, but it is a raw sharp
 * corner instead of a smooth curb return." Per the dispatch's own instruction, this suite instead
 * fits a circle to each corner's own tessellated arc and checks its RESIDUAL and PER-SEGMENT TURN
 * ANGLE — never a hasArc flag or an SVG "A" command (there is no arc command anywhere; a real curb
 * return is a tessellated polyline).
 *
 * THE FIX (`roadGeometry.js`'s `polygonEdgeRunFrom`, wired into `driveJunctionsOf`): walk the
 * connect-point's own polygon edge PAST any neighbour that is still collinear with it (within a small
 * tolerance) before measuring available room — mirroring `roadRunFrom`'s existing "step over
 * sub-tolerance vertex clutter" treatment for a ROAD's own polyline, one level up, for a PAD's
 * boundary. A genuine corner (the boundary actually turns) still stops the walk exactly as before.
 */
import { describe, it, expect } from "vitest";
import { driveJunctionsOf } from "../src/workspaces/site-planner/lib/roadJunctions.js";
import { polygonEdgeRunFrom, polygonEdges } from "../src/workspaces/site-planner/lib/roadGeometry.js";
import { dissolveRings } from "../src/workspaces/site-planner/lib/roadNetwork.js";
import { roadStripRing } from "../src/workspaces/site-planner/lib/siteGeometry.js";

const ccw = (a, b, c) => (c.y - a.y) * (b.x - a.x) > (b.y - a.y) * (c.x - a.x);
const segCross = (a, b, c, d) => ccw(a, c, d) !== ccw(b, c, d) && ccw(a, b, c) !== ccw(a, b, d);
function isSimplePolygon(ring) {
  const n = ring && ring.length;
  if (!n || n < 3) return false;
  for (let i = 0; i < n; i++) {
    const a = ring[i], b = ring[(i + 1) % n];
    for (let j = i + 1; j < n; j++) {
      const c = ring[j], d = ring[(j + 1) % n];
      if (j === (i + 1) % n || (j + 1) % n === i) continue;
      if (segCross(a, b, c, d)) return false;
    }
  }
  return true;
}

// Kasa algebraic least-squares circle fit + RMS residual — the acceptance shape the dispatch itself
// specified ("a circle fit with a residual"), never a hasArc flag or an SVG "A" command.
function fitCircle(pts) {
  const n = pts.length;
  if (n < 3) return null;
  let sx = 0, sy = 0, sxx = 0, syy = 0, sxy = 0, sxz = 0, syz = 0, sz = 0;
  for (const p of pts) {
    const z = p.x * p.x + p.y * p.y;
    sx += p.x; sy += p.y; sxx += p.x * p.x; syy += p.y * p.y; sxy += p.x * p.y;
    sxz += p.x * z; syz += p.y * z; sz += z;
  }
  // Solve [[sxx,sxy,sx],[sxy,syy,sy],[sx,sy,n]] * [A,B,C] = [sxz,syz,sz]  (Kasa method)
  const M = [[sxx, sxy, sx], [sxy, syy, sy], [sx, sy, n]];
  const rhs = [sxz, syz, sz];
  const det3 = (m) => m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1])
    - m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0])
    + m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0]);
  const D = det3(M);
  if (!(Math.abs(D) > 1e-9)) return null;
  const withCol = (col, v) => M.map((row, i) => row.map((x, j) => (j === col ? v[i] : x)));
  const A = det3(withCol(0, rhs)) / D;
  const B = det3(withCol(1, rhs)) / D;
  const C = det3(withCol(2, rhs)) / D;
  const cx = A / 2, cy = B / 2;
  const R2 = C + cx * cx + cy * cy;
  if (!(R2 > 0)) return null;
  const R = Math.sqrt(R2);
  const rms = Math.sqrt(pts.reduce((s, p) => s + (Math.hypot(p.x - cx, p.y - cy) - R) ** 2, 0) / n);
  return { cx, cy, R, rms };
}

// The largest single-vertex deflection along a tessellated polyline, in degrees — a real fillet
// tessellates into many SMALL, roughly-uniform turns (DEFAULT_TESS_DEG≈6°/segment); a raw kink
// (the pre-fix defect) shows one large turn instead.
function maxSegmentTurnDeg(pts) {
  let worst = 0;
  for (let i = 1; i < pts.length - 1; i++) {
    const d1 = { x: pts[i].x - pts[i - 1].x, y: pts[i].y - pts[i - 1].y };
    const d2 = { x: pts[i + 1].x - pts[i].x, y: pts[i + 1].y - pts[i].y };
    const l1 = Math.hypot(d1.x, d1.y), l2 = Math.hypot(d2.x, d2.y);
    if (!(l1 > 1e-9) || !(l2 > 1e-9)) continue;
    const cosA = Math.max(-1, Math.min(1, (d1.x * d2.x + d1.y * d2.y) / (l1 * l2)));
    const deg = (Math.acos(cosA) * 180) / Math.PI;
    if (deg > worst) worst = deg;
  }
  return worst;
}

// A polygon paving pad whose BOTTOM edge is digitized as `segCount` collinear segments instead of
// one — mimics a freehand-drawn / mouse-clicked pad boundary. Everything else stays a plain rect.
function makePolygonPad({ w = 400, h = 150, segCount = 1 } = {}) {
  const pts = [];
  const y = -h / 2;
  for (let i = 0; i <= segCount; i++) pts.push({ x: -w / 2 + (w * i) / segCount, y });
  pts.push({ x: w / 2, y: h / 2 }, { x: -w / 2, y: h / 2 });
  return { id: "pad1", type: "paving", points: pts };
}
function makeRectPad({ w = 400, h = 150 } = {}) {
  return { id: "pad1", type: "paving", cx: 0, cy: 0, w, h, rot: 0 };
}
// A road entering the pad's bottom edge at `angleDeg` off perpendicular, landing at `alongEdge`.
function makeRoad(id, angleDeg, alongEdge, { width = 36, driveLen = 300, curb = 0.5, edgeMidY = -75 } = {}) {
  const P = { x: alongEdge, y: edgeMidY };
  const rad = (angleDeg * Math.PI) / 180;
  const outN = { x: 0, y: -1 }, edgeDir = { x: 1, y: 0 };
  const c = Math.cos(rad), s = Math.sin(rad);
  const dir = { x: outN.x * c + edgeDir.x * s, y: outN.y * c + edgeDir.y * s };
  const far = { x: P.x + dir.x * driveLen, y: P.y + dir.y * driveLen };
  return { id, type: "road", pts: [far, P], vtx: [{}, {}], travelW: width, curb, roadClass: "aisle" };
}
function oneJunction(pad, road) {
  const [j] = driveJunctionsOf([pad, road], {});
  return j;
}

const ANGLES = [0, 5, 15, 25, 30, 33, 34, 45, 60];
const SEG_COUNTS = [2, 3, 4, 8, 16];

describe("B1717616 — polygon-pad digitizing-vertex clutter must not starve a curb-return corner", () => {
  it("KNOWN-GOOD CONTROL ARM: a rect target (no interior vertices, never subject to this defect) always fits a real, non-degenerate circle on both corners across the angle sweep — proves the instrument recognizes a working case before trusting it on the polygon case below", () => {
    for (const deg of ANGLES) {
      const j = oneJunction(makeRectPad({}), makeRoad("r", deg, 0));
      expect(j, `deg ${deg}: junction found`).toBeTruthy();
      for (const arc of j.geom.returns) {
        expect(arc.length, `deg ${deg}: rect-target arc must be a real tessellated curve`).toBeGreaterThan(2);
        const fit = fitCircle(arc);
        expect(fit, `deg ${deg}: circle fit`).toBeTruthy();
        expect(fit.R, `deg ${deg}: fitted radius`).toBeGreaterThan(3);
        expect(fit.rms, `deg ${deg}: fit residual`).toBeLessThan(0.05);
      }
    }
  });

  it("RED-PROOF-TURNED-GREEN: a polygon pad's bottom edge, digitized as 2–16 collinear segments, produces the IDENTICAL curb-return geometry as an unsubdivided (segCount:1) edge, at every angle in the sweep", () => {
    for (const deg of ANGLES) {
      const baseline = oneJunction(makePolygonPad({ segCount: 1 }), makeRoad("base", deg, 0));
      expect(baseline, `deg ${deg}: baseline junction found`).toBeTruthy();
      const baseArcLens = baseline.geom.returns.map((a) => a.length);
      const baseFits = baseline.geom.returns.map((a) => fitCircle(a));
      for (const segCount of SEG_COUNTS) {
        const j = oneJunction(makePolygonPad({ segCount }), makeRoad("r", deg, 0));
        expect(j, `deg ${deg} seg ${segCount}: junction found`).toBeTruthy();
        const arcLens = j.geom.returns.map((a) => a.length);
        expect(arcLens, `deg ${deg} seg ${segCount}: neither corner's arc may collapse to a degenerate point just because the edge was digitized into ${segCount} collinear segments`).toEqual(baseArcLens);
        j.geom.returns.forEach((arc, idx) => {
          const fit = fitCircle(arc);
          const base = baseFits[idx];
          if (!base) return; // a genuinely degenerate corner in the baseline itself (none in this sweep) — nothing to compare
          expect(fit, `deg ${deg} seg ${segCount} corner ${idx}: circle fit`).toBeTruthy();
          expect(Math.abs(fit.R - base.R), `deg ${deg} seg ${segCount} corner ${idx}: fitted radius drifted from the unsubdivided baseline (${base.R.toFixed(3)} → ${fit.R.toFixed(3)})`).toBeLessThan(0.05);
          expect(fit.rms, `deg ${deg} seg ${segCount} corner ${idx}: fit residual`).toBeLessThan(0.05);
          expect(maxSegmentTurnDeg(arc), `deg ${deg} seg ${segCount} corner ${idx}: no single-segment kink (a raw, un-rounded corner reads as one large turn instead of a smooth tessellated arc)`).toBeLessThan(15);
        });
      }
    }
  });

  it("DISCRIMINATION CHECK (WRONG-CASE / DRIVER-SCROLL §6 — the instrument must FAIL on a deliberately-broken construction, proving it can see the defect at all): rebuilding the same junction with the OLD single-edge-only room formula reproduces a degenerate corner", () => {
    const pad = makePolygonPad({ segCount: 2 }); // a vertex sits exactly at the connect point below
    const road = makeRoad("r", 25, 0); // lands exactly on the polygon vertex the segCount:2 split introduces
    const edges = polygonEdges(pad.points);
    // The OLD formula (pre-fix): room is measured only to the CURRENT edge's own endpoints — no walk
    // past a collinear neighbour. Reproduced here directly (not via a stashed diff) so the discriminator
    // survives independently of git history.
    const oldEdgeRun = (edge, at, dir) => {
      const d = dir > 0 ? { x: edge.b.x - at.x, y: edge.b.y - at.y } : { x: at.x - edge.a.x, y: at.y - edge.a.y };
      return d.x * edge.dir.x + d.y * edge.dir.y;
    };
    const junctionPt = { x: 0, y: -75 };
    const idx = edges.findIndex((e) => Math.abs(e.a.x - junctionPt.x) < 1e-6 || Math.abs(e.b.x - junctionPt.x) < 1e-6 || (junctionPt.x > e.a.x - 1e-6 && junctionPt.x < e.b.x + 1e-6 && Math.abs(e.a.y - junctionPt.y) < 1e-6));
    expect(idx, "the connect point sits on one of the two split bottom-edge segments").toBeGreaterThanOrEqual(0);
    const oldPos = oldEdgeRun(edges[idx], junctionPt, 1);
    const oldNeg = oldEdgeRun(edges[idx], junctionPt, -1);
    // KNOWN-BAD: at least one direction is starved down to a fraction of the true ~200ft run, because
    // the connect point sits at (or extremely near) the split vertex.
    expect(Math.min(oldPos, oldNeg), "KNOWN-BAD control: the old single-edge formula must genuinely starve one direction — otherwise this discriminator proves nothing").toBeLessThan(5);
    // The FIXED formula, on the exact same pad/point, must NOT be starved (this is the actual fix).
    const fixedPos = polygonEdgeRunFrom(edges, idx, junctionPt, 1);
    const fixedNeg = polygonEdgeRunFrom(edges, idx, junctionPt, -1);
    expect(Math.min(fixedPos, fixedNeg), "the fix must recover the true collinear run the old formula lost").toBeGreaterThan(100);
    // And driving the real app function end to end on this exact geometry must NOT show the defect.
    const j = oneJunction(pad, road);
    for (const arc of j.geom.returns) expect(arc.length, "no degenerate corner on the real driveJunctionsOf path").toBeGreaterThan(2);
  });

  it("a GENUINE corner in the polygon boundary still clamps the reach correctly — the fix must never bridge a real turn, only collinear digitizing clutter", () => {
    // An L-shaped field: the bottom edge (y=-75) meets a REAL reflex corner at x=100.
    const lShape = { id: "pad1", type: "paving", points: [
      { x: -100, y: -75 }, { x: 100, y: -75 }, { x: 100, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 75 }, { x: -100, y: 75 },
    ] };
    // Close to the real corner: the near-side return must still be genuinely constrained (small or
    // degenerate is CORRECT here — there just isn't room), never artificially inflated to the far
    // baseline radius the fix restores for a FAKE (collinear) vertex.
    const near = oneJunction(lShape, makeRoad("r", 0, 95));
    expect(near, "junction found near the real corner").toBeTruthy();
    const nearFits = near.geom.returns.map((a) => (a.length > 2 ? fitCircle(a) : null));
    const constrainedSide = nearFits.some((f) => !f || f.R < 20);
    expect(constrainedSide, "the side genuinely close to the real corner must still be constrained (this fix recovers fake room only, never bridges a real turn)").toBe(true);
    // Far from the corner: both sides get the full, unconstrained radius.
    const far = oneJunction(lShape, makeRoad("r", 0, -50));
    for (const arc of far.geom.returns) {
      expect(arc.length).toBeGreaterThan(2);
      expect(fitCircle(arc).R).toBeGreaterThan(20);
    }
  });

  it("MUST NOT REGRESS: the dissolved pavement stays one simple, connected region (roadNetwork.test.js's own invariant, re-asserted here against the real app function) across the full digitizing-clutter × angle sweep", () => {
    for (const deg of ANGLES) {
      for (const segCount of [1, ...SEG_COUNTS]) {
        const pad = makePolygonPad({ segCount });
        const road = makeRoad("r", deg, 0);
        const j = oneJunction(pad, road);
        const strip = roadStripRing(road, {}, undefined, undefined);
        const dissolved = dissolveRings([strip, ...j.geom.wedges]);
        expect(dissolved.length, `deg ${deg} seg ${segCount}: one connected region`).toBe(1);
        expect(isSimplePolygon(dissolved[0].outer), `deg ${deg} seg ${segCount}: simple polygon`).toBe(true);
        expect(j.geom.wedges.length, `deg ${deg} seg ${segCount}: exactly 2 wedges per junction`).toBe(2);
      }
    }
  });
});
