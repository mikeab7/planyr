import { describe, it, expect } from "vitest";
import {
  polyIntersectArea, triangulate, overlappingParcelPairs, PARCEL_OVERLAP_TOL,
} from "../src/workspaces/site-planner/lib/polyClip.js";

// Axis-aligned square helper (CCW), side s, lower-left at (x,y).
const sq = (x, y, s) => [{ x, y }, { x: x + s, y }, { x: x + s, y: y + s }, { x, y: y + s }];

describe("polyClip — polygon intersection area (B652)", () => {
  it("triangulates a convex quad into 2 triangles and a concave (L) into 4", () => {
    expect(triangulate(sq(0, 0, 10)).length).toBe(2);
    // L-shape (6 vertices, one reflex corner) → 4 ear triangles.
    const L = [{ x: 0, y: 0 }, { x: 20, y: 0 }, { x: 20, y: 10 }, { x: 10, y: 10 }, { x: 10, y: 20 }, { x: 0, y: 20 }];
    expect(triangulate(L).length).toBe(4);
  });

  it("identical squares intersect at the full area", () => {
    expect(polyIntersectArea(sq(0, 0, 10), sq(0, 0, 10))).toBeCloseTo(100, 6);
  });

  it("full containment → the inner polygon's area", () => {
    // 4×4 square fully inside a 10×10 square.
    expect(polyIntersectArea(sq(3, 3, 4), sq(0, 0, 10))).toBeCloseTo(16, 6);
    // order-independent
    expect(polyIntersectArea(sq(0, 0, 10), sq(3, 3, 4))).toBeCloseTo(16, 6);
  });

  it("partial overlap → the overlapping rectangle only", () => {
    // Two 10×10 squares offset by 6 in x and 6 in y → 4×4 overlap.
    expect(polyIntersectArea(sq(0, 0, 10), sq(6, 6, 10))).toBeCloseTo(16, 6);
  });

  it("edge-adjacent squares (shared boundary, no interior overlap) → 0", () => {
    expect(polyIntersectArea(sq(0, 0, 10), sq(10, 0, 10))).toBeCloseTo(0, 6);
  });

  it("disjoint squares → 0", () => {
    expect(polyIntersectArea(sq(0, 0, 10), sq(100, 100, 10))).toBeCloseTo(0, 6);
  });

  it("handles a concave (L-shaped) lot correctly", () => {
    // The L (area 300) fully contains a 5×5 square placed in its lower-left arm.
    const L = [{ x: 0, y: 0 }, { x: 20, y: 0 }, { x: 20, y: 10 }, { x: 10, y: 10 }, { x: 10, y: 20 }, { x: 0, y: 20 }];
    expect(polyIntersectArea(L, sq(1, 1, 5))).toBeCloseTo(25, 4);
    // A square straddling the L's notch overlaps only the part inside the L.
    // Square (8,8)-(18,18): the L covers x<=10 up to y=20 and x<=20 up to y=10.
    // Inside-L part of that square = {x in [8,10], y in [8,18]} (area 20) ∪
    //   {x in [10,18], y in [8,10]} (area 16) = 36.
    expect(polyIntersectArea(L, sq(8, 8, 10))).toBeCloseTo(36, 4);
  });

  it("degenerate inputs (fewer than 3 points) → 0, never throw", () => {
    expect(polyIntersectArea([{ x: 0, y: 0 }, { x: 1, y: 1 }], sq(0, 0, 10))).toBe(0);
    expect(polyIntersectArea(null, sq(0, 0, 10))).toBe(0);
  });
});

describe("overlappingParcelPairs — the B652 safety net", () => {
  const parent = { id: "p", points: sq(0, 0, 20) };            // 400 sf
  const childA = { id: "a", parentId: "p", points: [{ x: 0, y: 0 }, { x: 20, y: 0 }, { x: 20, y: 10 }, { x: 0, y: 10 }] };  // bottom half (200 sf)
  const childB = { id: "b", parentId: "p", points: [{ x: 0, y: 10 }, { x: 20, y: 10 }, { x: 20, y: 20 }, { x: 0, y: 20 }] }; // top half (200 sf)

  it("flags a parent + child both active (the double-count case)", () => {
    const pairs = overlappingParcelPairs([{ ...parent }, { ...childA }]);
    expect(pairs.length).toBe(1);
    expect(new Set([pairs[0].aId, pairs[0].bId])).toEqual(new Set(["p", "a"]));
  });

  it("does NOT flag two siblings that only share an edge", () => {
    // Children partition the parent — they touch at y=10 but don't overlap.
    expect(overlappingParcelPairs([childA, childB])).toEqual([]);
  });

  it("flags a parent overlapping BOTH children (two pairs) but not the sibling pair", () => {
    const pairs = overlappingParcelPairs([parent, childA, childB]);
    expect(pairs.length).toBe(2); // p∩a and p∩b, not a∩b
    const sets = pairs.map((pr) => new Set([pr.aId, pr.bId]));
    expect(sets).toContainEqual(new Set(["p", "a"]));
    expect(sets).toContainEqual(new Set(["p", "b"]));
  });

  it("excludes inactive parcels from the check", () => {
    // Parent inactive (superseded) + both children active = the correct post-split state → no warning.
    expect(overlappingParcelPairs([{ ...parent, active: false }, childA, childB])).toEqual([]);
  });

  it("ignores parcels with fewer than 3 points and respects the tolerance floor", () => {
    expect(overlappingParcelPairs([{ id: "x", points: [{ x: 0, y: 0 }] }, parent])).toEqual([]);
    expect(PARCEL_OVERLAP_TOL.absSqft).toBeGreaterThan(0);
  });
});
