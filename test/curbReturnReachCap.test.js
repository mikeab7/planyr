/* B1713105 — PINS a deliberate behaviour so it is never "fixed" by a future session: a curb
 * return's radius CLIPS DOWN when the pad edge it sweeps along doesn't have enough room before the
 * pad's own corner, producing a genuine (smaller) constant-radius arc — never a bevel, never an
 * unclamped overshoot past the corner.
 *
 * MEASURED live on build b3be9cf (chunk SitePlannerApp-Dn_gidcm.js): where a road's near curb edge
 * landed 23.59 ft from a pad corner, that side's return fit R = 20.78 ft while the far side (ample
 * room) fit the full R = 24.00 ft class radius — both genuine constant-radius arcs (13-15 segments,
 * 5.6-6.0 deg/segment, RMS residual 0.0034-0.0111 ft), not a bevel.
 *
 * This IS deliberate, and it predates the dispatch that asked about it: it is the documented
 * "REACH-CAP the curb return" rule (roadGeometry.js `teeGeometry`'s `fillet()`, B1005/NEW-1,
 * superseding B989) — "the return reach is ALWAYS <= R at ANY angle... Still bounded by the actual
 * road/drive run available (a short drive shrinks the return further)." A return that could not fit
 * would otherwise either overshoot past the pad's own corner (pavement floating off the edge it is
 * supposed to be rounding) or, before B1703665 NEW-2's chamfer fallback, degenerate to an exposed
 * bevel. Clipping the RADIUS to fit the available room, while still tracing a true circular arc, is
 * the correct behaviour and is pinned here so it cannot be "corrected" back to an unclamped radius.
 */
import { describe, it, expect } from "vitest";
import { teeGeometry, rectEdges, nearestRectEdge, roadEdgeCrossing } from "../src/workspaces/site-planner/lib/roadGeometry.js";
import { roadCurbWidth } from "../src/workspaces/site-planner/lib/siteGeometry.js";

const roadOuterHalf = (el) => Math.max(0, (+el.travelW || 0) / 2) + roadCurbWidth(el);

// Least-squares (Kasa) circle fit: returns { cx, cy, R, rmsResidual }.
function fitCircle(points) {
  const n = points.length;
  let sx = 0, sy = 0;
  for (const p of points) { sx += p.x; sy += p.y; }
  const mx = sx / n, my = sy / n;
  let Suu = 0, Suv = 0, Svv = 0, Suuu = 0, Suvv = 0, Svvv = 0, Svuu = 0;
  for (const p of points) {
    const u = p.x - mx, v = p.y - my;
    Suu += u * u; Suv += u * v; Svv += v * v;
    Suuu += u * u * u; Suvv += u * v * v; Svvv += v * v * v; Svuu += v * u * u;
  }
  const A = Suu, B = Suv, C = Suv, D = Svv;
  const E = (Suuu + Suvv) / 2, F = (Svvv + Svuu) / 2;
  const det = A * D - B * C;
  if (Math.abs(det) < 1e-9) return null;
  const uc = (E * D - B * F) / det, vc = (A * F - C * E) / det;
  const cx = uc + mx, cy = vc + my;
  const R = Math.sqrt(uc * uc + vc * vc + (Suu + Svv) / n);
  let sqErr = 0;
  for (const p of points) { const d = Math.hypot(p.x - cx, p.y - cy) - R; sqErr += d * d; }
  return { cx, cy, R, rmsResidual: Math.sqrt(sqErr / n) };
}

// Per-segment turn angle (deg) along a polyline arc.
function turnAngles(pts) {
  const out = [];
  for (let i = 1; i < pts.length - 1; i++) {
    const a = pts[i - 1], b = pts[i], c = pts[i + 1];
    const v1 = { x: b.x - a.x, y: b.y - a.y }, v2 = { x: c.x - b.x, y: c.y - b.y };
    const turn = Math.atan2(v1.x * v2.y - v1.y * v2.x, v1.x * v2.x + v1.y * v2.y) * 180 / Math.PI;
    out.push(Math.abs(turn));
  }
  return out;
}

// A road tee-ing into a pad's edge NEAR_CORNER_DIST ft from the corner (near side, tight room) with
// the far side (padW - NEAR_CORNER_DIST) wide open. Mirrors roadJunctionRealPlanFixture.test.js's
// own driveJunctionScenario construction, isolated here so this file stands alone as a focused pin.
function nearCornerJunction(nearCornerDist, opts = {}) {
  const { padW = 300, padH = 150, width = 36, R = 24, curb = 0.5 } = opts;
  const pad = { cx: 0, cy: 0, w: padW, h: padH, rot: 0 };
  const edges = rectEdges(pad.cx, pad.cy, pad.w, pad.h, 0);
  const e = edges[0]; // bottom edge, corner a at -padW/2
  const P = { x: e.a.x + e.dir.x * nearCornerDist, y: e.a.y + e.dir.y * nearCornerDist };
  const far = { x: P.x, y: P.y - 200 };
  const road = { pts: [far, P], travelW: width, curb, roadClass: "truck" };
  const hit = nearestRectEdge(P, edges, { facingOnly: false });
  const edgeRunPos = (hit.edge.b.x - P.x) * hit.edge.dir.x + (hit.edge.b.y - P.y) * hit.edge.dir.y;
  const edgeRunNeg = (P.x - hit.edge.a.x) * hit.edge.dir.x + (P.y - hit.edge.a.y) * hit.edge.dir.y;
  const geom = teeGeometry({
    T: P, throughDir: hit.edge.dir, sideDir: { x: far.x - P.x, y: far.y - P.y },
    phT: 0, phS: roadOuterHalf(road), R: Math.min(R, Math.max(1, padH)),
    curbT: 0.5, curbS: roadCurbWidth(road),
    throughAvailPos: Math.max(0, edgeRunPos), throughAvailNeg: Math.max(0, edgeRunNeg), sideAvail: 199,
  });
  // returns[0] (wedge A) is the corner toward +u / edgeRunPos (the FAR corner, edge.b); returns[1]
  // (wedge B) is toward -u / edgeRunNeg (the NEAR corner, edge.a) — verified directly against the
  // arc points' own coordinates, not assumed from the sign convention alone.
  return geom;
}

describe("B1713105 — curb return radius clips to fit near a pad corner; PINS this as deliberate", () => {
  it("near a corner (tight room on one side, ample on the other): the near side clips to a SMALLER " +
     "genuine circular arc, the far side keeps the full class radius", () => {
    const NEAR = 23.59; // the exact real-plan distance measured live, from the dispatch
    const R_CLASS = 24;
    const geom = nearCornerJunction(NEAR, { R: R_CLASS });
    expect(geom, "a near-corner junction must still resolve").toBeTruthy();

    const [farArc, nearArc] = geom.returns;
    expect(nearArc.length, "the near side must be a real multi-point arc, not a bare corner").toBeGreaterThan(3);
    expect(farArc.length, "the far side must be a real multi-point arc").toBeGreaterThan(3);

    const nearFit = fitCircle(nearArc), farFit = fitCircle(farArc);
    expect(nearFit).toBeTruthy();
    expect(farFit).toBeTruthy();

    // Far side: ample room, so it keeps (up to numerical tessellation slack) the full class radius.
    expect(farFit.R, `far-side radius ${farFit.R}`).toBeGreaterThan(R_CLASS - 1);
    expect(farFit.R, `far-side radius ${farFit.R}`).toBeLessThanOrEqual(R_CLASS + 0.5);

    // Near side: room is tighter than the class radius needs, so it CLIPS DOWN — genuinely smaller
    // than the far side, never zero (a bevel) and never the full class radius (unclamped overshoot).
    expect(nearFit.R, `near-side radius ${nearFit.R} vs class ${R_CLASS}`).toBeLessThan(farFit.R - 0.5);
    expect(nearFit.R, `near-side radius ${nearFit.R}`).toBeGreaterThan(1);

    // Both are genuine constant-radius arcs: a tight circle-fit residual, not a bevel or a
    // convex-hull artifact (which would fit a circle poorly, if at all).
    expect(nearFit.rmsResidual, `near-side RMS residual ${nearFit.rmsResidual}`).toBeLessThan(0.05);
    expect(farFit.rmsResidual, `far-side RMS residual ${farFit.rmsResidual}`).toBeLessThan(0.05);

    // Per-segment turn angle stays within tessellation's own bound (DEFAULT_TESS_DEG = 6, with
    // headroom for radius/segment-count rounding) — a real smooth sweep, not one big bevel step.
    for (const turn of turnAngles(nearArc)) expect(turn, `near-side turn ${turn}deg`).toBeLessThan(10);
    for (const turn of turnAngles(farArc)) expect(turn, `far-side turn ${turn}deg`).toBeLessThan(10);
  });

  it("sweeping the near-corner distance from very tight to ample: the fitted radius rises " +
     "monotonically toward the class radius and never overshoots it", () => {
    const R_CLASS = 24;
    let prevR = 0;
    for (const dist of [3, 8, 15, 23.59, 40, 80]) {
      const geom = nearCornerJunction(dist, { R: R_CLASS });
      const arc = geom.returns[1]; // wedge B: the side toward the near corner (edgeRunNeg = dist)
      // Below roughly the drive's own half-width there is no room for ANY curve at all — an honest
      // SHARP corner (arc.length < 3, R effectively 0), a DIFFERENT and already-covered behaviour
      // (B1703665's chamfer fallback in wedge()). This sweep is about the RADIUS clip once a real
      // arc still fits, so a degenerate corner here just means R=0 and the monotonic chain continues.
      const fit = arc.length >= 3 ? fitCircle(arc) : null;
      const R = fit ? fit.R : 0;
      expect(R, `dist=${dist}: radius ${R} must never exceed the class radius`).toBeLessThanOrEqual(R_CLASS + 0.5);
      expect(R, `dist=${dist}: radius ${R} must not shrink as room grows`).toBeGreaterThanOrEqual(prevR - 0.5);
      prevR = R;
    }
    expect(prevR, "with ample room (dist=80), the radius must reach the full class radius").toBeGreaterThan(R_CLASS - 1);
  });
});
