/* NEW-1 — the paint-only curb-return seam: a road's inner face-of-curb stripe (roadCurbLines)
 * used to be clipped dead at a drive junction's own tangent point, so the straight body carried
 * its curb detail and the curb-return fillet carried none, reading as two distinct painted
 * surfaces even though PR 1763 already proved the dissolved pavement is one continuous shape.
 * `insetArcTowardCenter` / `returnArcStripe` / `driveJunctionCurbStripes`
 * (siteGeometry.js) continue the stripe around the fillet instead. Pure geometry — asserted here
 * without a browser; the live paint is verified by ui-audit/verify-road-junction-cleanup.mjs's
 * sibling harness.
 *
 * B1783376 ×3: the continuation used to be lengthened 3 ft along the arc's last CHORD (which tilts half a tessellation step off the straight edge — the jog at
 * the tangent). It is now a TRUE-CIRCLE arc that starts exactly on the straight stripe's line and is oriented side-road end first. */
import { describe, it, expect } from "vitest";
import {
  insetArcTowardCenter, returnArcStripe, driveJunctionCurbStripes, RETURN_STRIPE_STEP_DEG,
} from "../src/workspaces/site-planner/lib/siteGeometry.js";

// A clean quarter-circle arc of radius R centred at `c`, swept from `a0` to `a0+da` — the same
// shape rayFillet's own arc builder produces (roadGeometry.js), reproduced here rather than
// imported so this file exercises the PUBLIC CONTRACT (an array of {x,y}) and not roadGeometry's
// internals.
function arcOf(c, R, a0, a1, n = 12) {
  const pts = [];
  for (let k = 0; k <= n; k++) {
    const a = a0 + (a1 - a0) * (k / n);
    pts.push({ x: c.x + R * Math.cos(a), y: c.y + R * Math.sin(a) });
  }
  return pts;
}
const len = (pts) => {
  let L = 0;
  for (let i = 1; i < pts.length; i++) L += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
  return L;
};

describe("insetArcTowardCenter", () => {
  it("shortens a circular arc when offset toward its own center — a smaller-radius arc always has less length", () => {
    const c = { x: 0, y: 0 }, R = 20;
    const arc = arcOf(c, R, 0, Math.PI / 2);
    const inset = insetArcTowardCenter(arc, 0.5);
    expect(inset).toBeTruthy();
    expect(len(inset)).toBeLessThan(len(arc));
    // every inset point should land closer to the centre than the original arc point beside it
    for (let i = 0; i < inset.length; i++) {
      const dIn = Math.hypot(inset[i].x - c.x, inset[i].y - c.y);
      const dOrig = Math.hypot(arc[i].x - c.x, arc[i].y - c.y);
      expect(dIn).toBeLessThan(dOrig);
      expect(dIn).toBeCloseTo(R - 0.5, 1);
    }
  });

  it("picks the SAME inward direction regardless of the arc's own traversal (winding) order", () => {
    const c = { x: 5, y: -5 }, R = 15;
    const fwd = arcOf(c, R, 0.2, 1.4);
    const rev = fwd.slice().reverse();
    const insetFwd = insetArcTowardCenter(fwd, 0.5);
    const insetRev = insetArcTowardCenter(rev, 0.5);
    const rIn = (pts) => pts.map((p) => Math.hypot(p.x - c.x, p.y - c.y));
    for (const r of rIn(insetFwd)) expect(r).toBeCloseTo(R - 0.5, 1);
    for (const r of rIn(insetRev)) expect(r).toBeCloseTo(R - 0.5, 1);
  });

  it("returns null for a degenerate arc, or a non-positive distance", () => {
    expect(insetArcTowardCenter([{ x: 0, y: 0 }], 0.5)).toBeNull();
    expect(insetArcTowardCenter(null, 0.5)).toBeNull();
    expect(insetArcTowardCenter(arcOf({ x: 0, y: 0 }, 10, 0, 1), 0)).toBeNull();
    expect(insetArcTowardCenter(arcOf({ x: 0, y: 0 }, 10, 0, 1), -1)).toBeNull();
  });
});

describe("returnArcStripe — the face of curb around a return, as the true circle it is", () => {
  // a fillet in the corner at (10,10): centre (0,0), R 10 — the grass side; the pavement (and the corner) are OUTSIDE the circle
  const R = 10, c = { x: 0, y: 0 }, corner = { x: 10, y: 10 };
  const fillet = arcOf(c, R, 0, Math.PI / 2, 15);   // 6° chords, as rayFillet tessellates
  const heading = (a, b) => Math.atan2(b.y - a.y, b.x - a.x) * 180 / Math.PI;
  it("sits a curb-width OUTSIDE the circle (on the pavement side) at every point, and starts/ends radially off the arc's own tangent points", () => {
    const s = returnArcStripe(fillet, corner, 0.5);
    for (const p of s) expect(Math.hypot(p.x - c.x, p.y - c.y)).toBeCloseTo(R + 0.5, 9);
    expect(s[0].x).toBeCloseTo(R + 0.5, 9); expect(s[0].y).toBeCloseTo(0, 9);                       // the tangent point (10,0), pushed straight off the straight edge x = 10
    expect(s[s.length - 1].x).toBeCloseTo(0, 9); expect(s[s.length - 1].y).toBeCloseTo(R + 0.5, 9);
  });
  it("is tessellated finely enough that its END chords sit within a degree of the straight edges' headings", () => {
    const s = returnArcStripe(fillet, corner, 0.5);
    expect(RETURN_STRIPE_STEP_DEG).toBeLessThanOrEqual(2);
    // the straight edge at the first end runs along +y at x = 10.5 (heading 90°); the first chord is half a step off it
    expect(Math.abs(heading(s[0], s[1]) - 90)).toBeLessThanOrEqual(RETURN_STRIPE_STEP_DEG / 2 + 1e-6);
    expect(Math.abs(heading(s[0], s[1]) - 90)).toBeLessThan(1);
    // the old stripe (the 6° tessellation, offset) was 3° off at the same place
    const old = insetArcTowardCenter(fillet, 0.5);
    expect(Math.abs(heading(old[0], old[1]) - heading({ x: 0, y: 0 }, { x: 0, y: 1 }))).toBeGreaterThan(1);
  });
  it("keeps the arc's own direction and handles either winding", () => {
    const fwd = returnArcStripe(fillet, corner, 0.5), rev = returnArcStripe(fillet.slice().reverse(), corner, 0.5);
    expect(rev[0].x).toBeCloseTo(fwd[fwd.length - 1].x, 9); expect(rev[0].y).toBeCloseTo(fwd[fwd.length - 1].y, 9);
    for (const p of rev) expect(Math.hypot(p.x - c.x, p.y - c.y)).toBeCloseTo(R + 0.5, 9);
  });
  it("falls back to the chord offset when the points are not a circle, and returns null for no corner / degenerate input", () => {
    const wobble = fillet.map((p, i) => (i === 7 ? { x: p.x + 0.4, y: p.y } : p));
    const s = returnArcStripe(wobble, corner, 0.5);
    expect(s && s.length).toBe(wobble.length);                  // chord offset: one point per input point
    expect(returnArcStripe(fillet, null, 0.5)).toBeNull();
    expect(returnArcStripe([c], corner, 0.5)).toBeNull();
    expect(returnArcStripe(fillet, corner, 0)).toBeNull();
  });
});

describe("driveJunctionCurbStripes — the render-layer entry point", () => {
  it("produces one polyline per fillet arc, each ORIENTED side-road end first and with NO overlap lengthening", () => {
    const c1 = { x: 0, y: 0 }, R1 = 20;
    const c2 = { x: 100, y: 0 }, R2 = 20;
    const arcA = arcOf(c1, R1, Math.PI, Math.PI * 1.5);
    const arcB = arcOf(c2, R2, Math.PI * 1.5, Math.PI * 2);
    const dj = {
      sideId: "roadA",
      geom: {
        returns: [arcA, arcB],
        corners: [{ x: -20, y: -20 }, { x: 120, y: -20 }],
        // the side tangent of arcA is its FIRST point, arcB's its LAST — so the builder must flip arcA to put the side end first
        sideTangents: [arcA[0], arcB[arcB.length - 1]],
      },
    };
    const out = driveJunctionCurbStripes([dj], 0.5);
    expect(out.length).toBe(2);
    out.forEach((line, k) => {
      expect(line.length).toBeGreaterThanOrEqual(2);
      const st = dj.geom.sideTangents[k];
      expect(Math.hypot(line[0].x - st.x, line[0].y - st.y)).toBeCloseTo(0.5, 6);                    // a curb-width off the side tangent, radially
      expect(Math.hypot(line[line.length - 1].x - st.x, line[line.length - 1].y - st.y)).toBeGreaterThan(5);
    });
  });

  it("returns nothing for an empty junction list, or a non-positive curb width", () => {
    expect(driveJunctionCurbStripes([], 0.5)).toEqual([]);
    expect(driveJunctionCurbStripes(undefined, 0.5)).toEqual([]);
    const arc = arcOf({ x: 0, y: 0 }, 10, 0, 1);
    const dj = { sideId: "r", geom: { returns: [arc], corners: [{ x: 10, y: 10 }], sideTangents: [arc[arc.length - 1]] } };
    expect(driveJunctionCurbStripes([dj], 0)).toEqual([]);
  });
});
