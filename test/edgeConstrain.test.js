/* NEW — pure helpers behind "start a measurement on a parcel boundary, then hold Shift to keep it
 * perpendicular to that boundary" (the setback-measurement lock). This spec pins the edge
 * detection (project onto the nearest parcel line within tolerance) and the relative-angle snap
 * (parallel / perpendicular / 45° off the edge) so a canvas refactor can't silently regress it.
 */
import { describe, it, expect } from "vitest";
import {
  projectToSegment,
  nearestBoundaryEdge,
  constrainToEdgeAngle,
} from "../src/workspaces/site-planner/lib/edgeConstrain.js";

const near = (a, b, eps = 1e-6) => Math.abs(a - b) <= eps;

describe("edgeConstrain · projectToSegment", () => {
  it("projects onto the interior of a segment", () => {
    const r = projectToSegment({ x: 5, y: 3 }, { x: 0, y: 0 }, { x: 10, y: 0 });
    expect(r.pt).toEqual({ x: 5, y: 0 });
    expect(near(r.t, 0.5)).toBe(true);
    expect(near(r.dist, 3)).toBe(true);
  });
  it("clamps past an endpoint", () => {
    const r = projectToSegment({ x: -4, y: 0 }, { x: 0, y: 0 }, { x: 10, y: 0 });
    expect(r.pt).toEqual({ x: 0, y: 0 });
    expect(r.t).toBe(0);
    expect(near(r.dist, 4)).toBe(true);
  });
  it("handles a degenerate zero-length segment", () => {
    const r = projectToSegment({ x: 3, y: 4 }, { x: 0, y: 0 }, { x: 0, y: 0 });
    expect(r.pt).toEqual({ x: 0, y: 0 });
    expect(near(r.dist, 5)).toBe(true);
  });
});

describe("edgeConstrain · nearestBoundaryEdge", () => {
  // A 100×100 square parcel; the bottom edge runs along y=0 (angle 0).
  const parcels = [{ id: "p1", points: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }] }];

  it("snaps a near-boundary click onto the edge and returns its angle", () => {
    const e = nearestBoundaryEdge({ x: 40, y: 6 }, parcels, 12);
    expect(e).toBeTruthy();
    expect(e.pt).toEqual({ x: 40, y: 0 }); // projected onto the bottom edge
    expect(near(e.ang, 0)).toBe(true);     // bottom edge points along +x
  });

  it("returns null when no boundary is within tolerance", () => {
    expect(nearestBoundaryEdge({ x: 50, y: 50 }, parcels, 12)).toBeNull();
  });

  it("recovers the anchor edge from a point already ON the boundary (dist 0)", () => {
    const e = nearestBoundaryEdge({ x: 40, y: 0 }, parcels, 12);
    expect(e).toBeTruthy();
    expect(near(e.dist, 0)).toBe(true);
    expect(near(e.ang, 0)).toBe(true);
  });

  it("picks the closest of several edges", () => {
    // Near the right edge (x=100, vertical → angle 90°)
    const e = nearestBoundaryEdge({ x: 96, y: 50 }, parcels, 12);
    expect(near(Math.abs(e.ang), Math.PI / 2)).toBe(true);
    expect(e.pt).toEqual({ x: 100, y: 50 });
  });
});

describe("edgeConstrain · constrainToEdgeAngle", () => {
  const anchor = { x: 0, y: 0 };

  it("locks perpendicular to a horizontal edge (setback case)", () => {
    // Edge angle 0 (horizontal); a cursor mostly straight up snaps to a true vertical.
    const p = constrainToEdgeAngle(anchor, { x: 3, y: 40 }, 0);
    expect(near(p.x, 0, 1e-9)).toBe(true);   // pulled onto the perpendicular
    expect(near(Math.hypot(p.x, p.y), Math.hypot(3, 40))).toBe(true); // length preserved
  });

  it("locks parallel to the edge", () => {
    const p = constrainToEdgeAngle(anchor, { x: 40, y: 3 }, 0);
    expect(near(p.y, 0, 1e-9)).toBe(true);
    expect(near(p.x, Math.hypot(40, 3))).toBe(true);
  });

  it("perpendicular is relative to a tilted edge", () => {
    // Edge tilted 30°; a cursor 90°+30° off +x should lock exactly perpendicular to the edge.
    const base = Math.PI / 6; // 30°
    const perpDir = base + Math.PI / 2;
    const r = 20;
    const cursor = { x: Math.cos(perpDir + 0.15) * r, y: Math.sin(perpDir + 0.15) * r }; // slightly off perp
    const p = constrainToEdgeAngle(anchor, cursor, base);
    const gotAng = Math.atan2(p.y, p.x);
    expect(near(((gotAng - perpDir) % (Math.PI * 2)), 0, 1e-9)).toBe(true);
  });

  it("returns the anchor for a zero-length segment", () => {
    expect(constrainToEdgeAngle(anchor, { x: 0, y: 0 }, 0)).toEqual({ x: 0, y: 0 });
  });
});
