/* NEW-1 — the paint-only curb-return seam: a road's inner face-of-curb stripe (roadCurbLines)
 * used to be clipped dead at a drive junction's own tangent point, so the straight body carried
 * its curb detail and the curb-return fillet carried none, reading as two distinct painted
 * surfaces even though PR 1763 already proved the dissolved pavement is one continuous shape.
 * `insetArcTowardCenter` / `extendInsetTowardSideTangent` / `driveJunctionCurbStripes`
 * (siteGeometry.js) continue the stripe around the fillet instead. Pure geometry — asserted here
 * without a browser; the live paint is verified by ui-audit/verify-road-junction-cleanup.mjs's
 * sibling harness. */
import { describe, it, expect } from "vitest";
import {
  insetArcTowardCenter, extendInsetTowardSideTangent, driveJunctionCurbStripes, STRIPE_OVERLAP_FT,
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

describe("extendInsetTowardSideTangent", () => {
  it("extends the END of the polyline nearest the side tangent, by STRIPE_OVERLAP_FT, along its own local tangent", () => {
    const pts = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 20, y: 0 }];
    const sideTan = { x: 21, y: 0 }; // just past the LAST point
    const out = extendInsetTowardSideTangent(pts, sideTan);
    expect(out.length).toBe(4);
    const tail = out[out.length - 1];
    expect(tail.x).toBeCloseTo(20 + STRIPE_OVERLAP_FT, 6);
    expect(tail.y).toBeCloseTo(0, 6);
    // the original points are untouched, in order
    expect(out.slice(0, 3)).toEqual(pts);
  });

  it("extends the START of the polyline when the side tangent is nearer the first point", () => {
    const pts = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 20, y: 0 }];
    const sideTan = { x: -1, y: 0 }; // just before the FIRST point
    const out = extendInsetTowardSideTangent(pts, sideTan);
    expect(out.length).toBe(4);
    const head = out[0];
    expect(head.x).toBeCloseTo(0 - STRIPE_OVERLAP_FT, 6);
    expect(head.y).toBeCloseTo(0, 6);
    expect(out.slice(1)).toEqual(pts);
  });

  it("is a no-op when given no side tangent or too short a polyline", () => {
    const pts = [{ x: 0, y: 0 }, { x: 10, y: 0 }];
    expect(extendInsetTowardSideTangent(pts, null)).toBe(pts);
    expect(extendInsetTowardSideTangent([{ x: 0, y: 0 }], { x: 1, y: 1 })).toEqual([{ x: 0, y: 0 }]);
  });
});

describe("driveJunctionCurbStripes — the render-layer entry point", () => {
  it("produces one continuation polyline per fillet arc, each overlapping its own side tangent", () => {
    const c1 = { x: 0, y: 0 }, R1 = 20;
    const c2 = { x: 100, y: 0 }, R2 = 20;
    const arcA = arcOf(c1, R1, Math.PI, Math.PI * 1.5);
    const arcB = arcOf(c2, R2, Math.PI * 1.5, Math.PI * 2);
    const dj = {
      sideId: "roadA",
      geom: {
        returns: [arcA, arcB],
        // sideTangents nearest each arc's OWN last point, as teeGeometry's own convention pairs them
        sideTangents: [arcA[arcA.length - 1], arcB[arcB.length - 1]],
      },
    };
    const out = driveJunctionCurbStripes([dj], 0.5);
    expect(out.length).toBe(2);
    for (const line of out) {
      expect(line.length).toBeGreaterThanOrEqual(2);
    }
  });

  it("returns nothing for an empty junction list, or a non-positive curb width", () => {
    expect(driveJunctionCurbStripes([], 0.5)).toEqual([]);
    expect(driveJunctionCurbStripes(undefined, 0.5)).toEqual([]);
    const arc = arcOf({ x: 0, y: 0 }, 10, 0, 1);
    const dj = { sideId: "r", geom: { returns: [arc], sideTangents: [arc[arc.length - 1]] } };
    expect(driveJunctionCurbStripes([dj], 0)).toEqual([]);
  });
});
