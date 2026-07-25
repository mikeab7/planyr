/* NEW-2/NEW-3/NEW-4 — the corner solver: leg shares, the approach-shortfall readout, and the
 * self-fix that runs an approach out so a class turn actually fits.
 *
 * The regression these lock in is the one the owner hit on the real Tsakiris plan: a corner near
 * the END of a road had HALF its final leg taken away by a clamp meant for legs shared between two
 * corners, so a 28 ft fire-lane corner drew at 11 ft, the app flagged it, and nothing the owner
 * could click would fix it. */
import { describe, it, expect } from "vitest";
import {
  cornerShares, roadCornerRadii, roadRadiusConflicts, cornerApproachShortfall,
  fitRoadCorners, roadCenterline, minRadiusOfCurvature, repairBakedRadii,
} from "../src/workspaces/site-planner/lib/roadGeometry.js";

const L = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

describe("cornerShares — who owns each leg", () => {
  it("gives a corner the WHOLE leg that runs to a road endpoint", () => {
    expect(cornerShares(1, 3)).toEqual({ a: 1, c: 1 });      // both legs terminal
  });
  it("halves only a leg shared with a neighbouring corner", () => {
    expect(cornerShares(1, 4)).toEqual({ a: 1, c: 0.5 });    // 0-1-2-3: leg to 2 is shared
    expect(cornerShares(2, 4)).toEqual({ a: 0.5, c: 1 });
    expect(cornerShares(2, 5)).toEqual({ a: 0.5, c: 0.5 });  // interior on both sides
  });
});

describe("terminal legs are no longer halved", () => {
  // 90° corner, 100 ft in, 60 ft out to the road's end. tan(45°)=1, so a 60 ft radius fits exactly.
  const pts = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 60 }];
  const vtx = [{}, { treatment: "arc", radius: 60 }, {}];
  it("draws the full requested radius when the short leg is terminal", () => {
    const [c] = roadCornerRadii(pts, vtx);
    expect(c.rendered).toBeCloseTo(60, 6);
    expect(c.limited).toBe(false);
  });
  it("still halves that leg when a further corner shares it", () => {
    const p2 = [...pts, { x: 200, y: 60 }];
    const v2 = [{}, { treatment: "arc", radius: 60 }, { treatment: "arc", radius: 10 }, {}];
    const [c] = roadCornerRadii(p2, v2);
    expect(c.rendered).toBeCloseTo(30, 6);                   // 0.5 × 60
  });
  it("the RENDERED centerline agrees with what roadCornerRadii reports", () => {
    const dense = roadCenterline(pts, vtx);
    expect(minRadiusOfCurvature(dense)).toBeGreaterThan(59);
  });
  it("neighbouring corners still never overlap (the reason the half rule exists)", () => {
    const p = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }];
    const v = [{}, { treatment: "arc", radius: 999 }, { treatment: "arc", radius: 999 }, {}];
    const [a, b] = roadCornerRadii(p, v);
    expect(a.rendered).toBeLessThanOrEqual(50 + 1e-6);       // each may take half the shared 100 ft leg
    expect(b.rendered).toBeLessThanOrEqual(50 + 1e-6);
  });
});

describe("the app can SAY what the corner needs", () => {
  const pts = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 22 }];
  const vtx = [{}, { treatment: "arc", radius: 28 }, {}];
  it("reports the missing approach in feet, not a bare complaint", () => {
    const [f] = roadRadiusConflicts(pts, vtx, 28);
    expect(f.rendered).toBeCloseTo(22, 6);
    expect(f.shortfallFt).toBeCloseTo(6, 6);                 // 28·tan45 ÷ 1 − 22
    expect(f.extendable).toBe(true);                         // that leg runs to a road end
  });
  it("shortfall is zero once the corner holds", () => {
    expect(cornerApproachShortfall(roadCornerRadii(pts, vtx)[0], 20)).toBe(0);
  });
  it("a corner starved by an INTERIOR leg is not reported as extendable", () => {
    const p = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 22 }, { x: 160, y: 22 }];
    const v = [{}, { treatment: "arc", radius: 28 }, { treatment: "arc", radius: 5 }, {}];
    const [f] = roadRadiusConflicts(p, v, 28);
    expect(f.extendable).toBe(false);
  });
});

describe("fitRoadCorners — the self-fix", () => {
  it("runs the approach out so the class turn fits, and clears the flag", () => {
    const pts = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 22 }];
    const vtx = [{}, { treatment: "arc", radius: 28 }, {}];
    const r = fitRoadCorners(pts, vtx, 28, { targetRadius: 50 });
    expect(r.residual).toHaveLength(0);
    expect(L(r.pts[2], pts[1])).toBeGreaterThanOrEqual(28 - 1e-6);
    expect(roadRadiusConflicts(r.pts, r.vtx, 28)).toHaveLength(0);
  });
  it("extends along the leg's OWN bearing — the alignment never bends", () => {
    const pts = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 22 }];
    const r = fitRoadCorners(pts, [{}, { treatment: "arc", radius: 28 }, {}], 28, { targetRadius: 50 });
    expect(r.pts[2].x).toBeCloseTo(100, 6);                  // still due north of the corner
    expect(r.pts[2].y).toBeGreaterThan(22);
    expect(r.pts[0]).toEqual({ x: 0, y: 0 });                // untouched
    expect(r.pts[1]).toEqual({ x: 100, y: 0 });              // the corner itself never moves
  });
  it("never asks for LESS than the class radius (the bug that baked a clamped value in)", () => {
    const pts = [{ x: 0, y: 0 }, { x: 195, y: 0 }, { x: 195, y: 46.6 }];
    const vtx = [{}, { treatment: "arc", radius: 22.89 }, {}]; // what the old auto-fix stored
    const r = fitRoadCorners(pts, vtx, 50, { targetRadius: 120 });
    expect(r.vtx[1].radius).toBe(120);
  });
  it("honours the extension bound and reports what is still missing", () => {
    const pts = [{ x: 0, y: 0 }, { x: 400, y: 0 }, { x: 400, y: 5 }];
    const r = fitRoadCorners(pts, [{}, { treatment: "arc", radius: 120 }, {}], 120, { targetRadius: 120, maxExtendFt: 25 });
    expect(L(r.pts[2], r.pts[1])).toBeCloseTo(30, 6);        // 5 + the 25 ft cap
    expect(r.residual).toHaveLength(1);
    expect(r.residual[0].shortfallFt).toBeCloseTo(90, 6);    // 120 − 30
  });
  it("leaves a deliberate sharp corner alone", () => {
    const pts = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 22 }];
    const r = fitRoadCorners(pts, [{}, { treatment: "sharp" }, {}], 28, { targetRadius: 50 });
    expect(r.vtx[1].treatment).toBe("sharp");
    expect(r.pts).toEqual(pts);
  });
  it("is a no-op on a road that already holds its class", () => {
    const pts = [{ x: 0, y: 0 }, { x: 300, y: 0 }, { x: 300, y: 300 }];
    const vtx = [{}, { treatment: "arc", radius: 120 }, {}];
    const r = fitRoadCorners(pts, vtx, 50, { targetRadius: 120 });
    expect(r.changed).toBe(false);
    expect(r.extended).toHaveLength(0);
    expect(r.pts).toEqual(pts);
  });
  it("a 2-point straight road has no corner to fit", () => {
    const r = fitRoadCorners([{ x: 0, y: 0 }, { x: 100, y: 0 }], [{}, {}], 50);
    expect(r.changed).toBe(false);
  });
});

/* NEW-6 — the pre-B1013 auto-fixer wrote CLAMPED radii back onto vertices, so a corner drew as a
 * blob forever and read as a radius the owner had chosen. His live fire lane carries
 * radius: 11.532635922052066. Repairing that on load is what makes the plan look right with no
 * clicks at all — the owner's standing rule ("the software should self fix"). */
describe("repairBakedRadii — undo a radius the machine baked in", () => {
  const pts = [{ x: -283.5, y: 459 }, { x: -216.4, y: 459 }, { x: -216.4, y: 436.1 }];
  const baked = [{}, { treatment: "arc", radius: 11.532635922052066 }, {}];

  it("raises a below-class, non-round radius to the class radius", () => {
    const r = repairBakedRadii(pts, baked, 28, { targetRadius: 50 });
    expect(r).not.toBeNull();
    expect(r.repaired).toEqual([1]);
    expect(r.vtx[1].radius).toBe(50);
  });
  it("never moves a point — it is a data repair, not a reshape", () => {
    const r = repairBakedRadii(pts, baked, 28, { targetRadius: 50 });
    expect(r.pts).toEqual(pts);
  });
  it("the drawn corner improves but is still honestly clamped to what fits", () => {
    const r = repairBakedRadii(pts, baked, 28, { targetRadius: 50 });
    const [c] = roadCornerRadii(r.pts, r.vtx, { defaultRadius: 50 });
    expect(c.rendered).toBeCloseTo(22.9, 1);                 // the 22.9 ft terminal leg, not 11.5
    expect(roadRadiusConflicts(r.pts, r.vtx, 28).length).toBe(1); // still flagged — it is still short
  });
  it("leaves a ROUND radius alone — that is a value a person chose", () => {
    expect(repairBakedRadii(pts, [{}, { treatment: "arc", radius: 12 }, {}], 28, { targetRadius: 50 })).toBeNull();
    expect(repairBakedRadii(pts, [{}, { treatment: "arc", radius: 11.5 }, {}], 28, { targetRadius: 50 })).toBeNull();
  });
  it("leaves an at-or-above-class radius alone, round or not", () => {
    expect(repairBakedRadii(pts, [{}, { treatment: "arc", radius: 28.4137 }, {}], 28, { targetRadius: 50 })).toBeNull();
  });
  it("leaves a sharp corner and a radius-less vertex alone", () => {
    expect(repairBakedRadii(pts, [{}, { treatment: "sharp" }, {}], 28, { targetRadius: 50 })).toBeNull();
    expect(repairBakedRadii(pts, [{}, {}, {}], 28, { targetRadius: 50 })).toBeNull();
  });
  it("is idempotent — a repaired road returns null on a second pass (no churn)", () => {
    const r = repairBakedRadii(pts, baked, 28, { targetRadius: 50 });
    expect(repairBakedRadii(r.pts, r.vtx, 28, { targetRadius: 50 })).toBeNull();
  });
  it("no-ops on a 2-point road and on a class with no minimum", () => {
    expect(repairBakedRadii([pts[0], pts[1]], [{}, {}], 28)).toBeNull();
    expect(repairBakedRadii(pts, baked, 0)).toBeNull();
  });
});
