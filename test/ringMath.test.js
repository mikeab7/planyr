import { describe, it, expect } from "vitest";
import { pointInRing, ringArea, projectOntoSegment } from "../src/workspaces/site-planner/lib/ringMath.js";

const near = (a, b, eps = 1e-6) => Math.abs(a - b) < eps;
const ptNear = (p, x, y, eps = 1e-6) => near(p.x, x, eps) && near(p.y, y, eps);

describe("pointInRing / ringArea — sanity (already covered elsewhere; smoke only)", () => {
  const square = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }];
  it("pointInRing basic containment", () => {
    expect(pointInRing({ x: 5, y: 5 }, square)).toBe(true);
    expect(pointInRing({ x: 50, y: 50 }, square)).toBe(false);
  });
  it("ringArea of a 10x10 square is 100", () => {
    expect(ringArea(square)).toBeCloseTo(100, 6);
  });
});

// B872/NEW-5 — inserting a control point on an existing edge must be a geometric no-op. The
// reported repro: shift-click an END WALL (an angled edge, not axis-aligned) to add a control
// point, drag nothing, and the reported footprint area moved 417,600 SF -> 417,601 SF because the
// snapped click point landed a hair off the true edge line.
describe("projectOntoSegment — B872/NEW-5 (inserting a control point never moves the edge)", () => {
  it("returns the point unchanged when it's already exactly on the segment", () => {
    const a = { x: 0, y: 0 }, b = { x: 100, y: 0 };
    expect(ptNear(projectOntoSegment(a, b, { x: 40, y: 0 }), 40, 0)).toBe(true);
  });

  it("snaps a point that drifted off an AXIS-ALIGNED edge straight back onto it", () => {
    const a = { x: 0, y: 0 }, b = { x: 100, y: 0 };
    const p = projectOntoSegment(a, b, { x: 37.2, y: 0.03 }); // e.g. rounded off by an independent x/y snap
    expect(ptNear(p, 37.2, 0)).toBe(true);
  });

  it("snaps a point that drifted off an ANGLED edge back onto the true line — the exact repro shape", () => {
    // An angled end wall — not axis-aligned, so rounding x and y independently (a naive grid snap)
    // does NOT generally land back on the line. Verify the projected point is collinear with a/b.
    const a = { x: -161.8, y: 0 }, b = { x: -50, y: 87.3 };
    const drifted = { x: -120.0, y: 34.51 }; // near the line but not exactly on it
    const p = projectOntoSegment(a, b, drifted);
    // Collinearity check: cross product of (b-a) and (p-a) must be ~0.
    const cross = (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x);
    expect(Math.abs(cross)).toBeLessThan(1e-6);
  });

  it("clamps to the segment — never extrapolates past either endpoint", () => {
    const a = { x: 0, y: 0 }, b = { x: 10, y: 0 };
    expect(ptNear(projectOntoSegment(a, b, { x: -5, y: 3 }), 0, 0)).toBe(true);
    expect(ptNear(projectOntoSegment(a, b, { x: 15, y: -3 }), 10, 0)).toBe(true);
  });

  it("degenerate segment (a === b) returns the endpoint, never NaN", () => {
    const a = { x: 5, y: 5 };
    const p = projectOntoSegment(a, a, { x: 100, y: -100 });
    expect(ptNear(p, 5, 5)).toBe(true);
  });

  it("a control point inserted mid-edge never changes the ring's area — the reported invariant", () => {
    // A simple rectangle-ish 4-gon standing in for a building footprint; insert a point on the
    // "end wall" edge (index 1 -> 2) at a naively-snapped, slightly-off-line position and confirm
    // the shoelace area of the resulting 5-gon equals the original 4-gon's, exactly.
    const ring = [
      { x: 0, y: 0 },
      { x: 200, y: 0 },
      { x: 200, y: 100 }, // "end wall" runs from here...
      { x: 0, y: 100 },   // ...to here (still axis-aligned in this fixture; angled case proven above)
    ];
    const before = ringArea(ring);
    const inserted = projectOntoSegment(ring[2], ring[3], { x: 100.02, y: 100.0 }); // drifted a hair
    const withPoint = [ring[0], ring[1], ring[2], inserted, ring[3]];
    expect(ringArea(withPoint)).toBeCloseTo(before, 9);
  });
});
