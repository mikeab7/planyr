/* B910 / NEW-1 — pure hit-test + z-order cycling for on-canvas measurements.
 *
 * The canvas bug: clicking a measurement was inert unless you'd already switched to the Select
 * tool, and repeated clicks never cycled through a stack. selectMeasure now resolves the click
 * through these pure helpers — smaller-area-wins so a tiny measurement on top of a big one is
 * reachable first, and a re-click walks DOWN the stack (wrapping). This spec pins that ordering
 * and the cycle so a future canvas refactor can't silently regress "clicking a measurement does
 * nothing / repeated clicks feel inert."
 */
import { describe, it, expect } from "vitest";
import {
  measuresUnderPoint,
  nextMeasureSelection,
  ringArea,
  pointInRing,
  distToPolyline,
  measPoints,
  measModeOf,
} from "../src/workspaces/site-planner/lib/measureHit.js";

const sq = (x, y, n) => [{ x, y }, { x: x + n, y }, { x: x + n, y: y + n }, { x, y: y + n }];

describe("measureHit · geometry primitives", () => {
  it("ringArea returns |area|, orientation-independent", () => {
    expect(ringArea(sq(0, 0, 10))).toBe(100);
    expect(ringArea([...sq(0, 0, 10)].reverse())).toBe(100);
    expect(ringArea([{ x: 0, y: 0 }])).toBe(0); // degenerate
  });
  it("pointInRing ray-casts inside vs outside", () => {
    const r = sq(0, 0, 10);
    expect(pointInRing({ x: 5, y: 5 }, r)).toBe(true);
    expect(pointInRing({ x: 50, y: 5 }, r)).toBe(false);
  });
  it("distToPolyline is the nearest-segment distance", () => {
    const line = [{ x: 0, y: 0 }, { x: 10, y: 0 }];
    expect(distToPolyline({ x: 5, y: 3 }, line)).toBeCloseTo(3, 6);
    expect(distToPolyline({ x: 5, y: 0 }, [{ x: 0, y: 0 }])).toBe(Infinity); // < 2 pts
  });
  it("measPoints tolerates the legacy {a,b} distance shape; measModeOf defaults to line", () => {
    expect(measPoints({ a: { x: 0, y: 0 }, b: { x: 1, y: 1 } })).toHaveLength(2);
    expect(measModeOf({ pts: [] })).toBe("line");
    expect(measModeOf({ mode: "area" })).toBe("area");
  });
});

describe("measuresUnderPoint · which measurements a click lands on", () => {
  const big = { mode: "area", pts: sq(0, 0, 100) };      // 10,000 sf, index 0
  const small = { mode: "area", pts: sq(40, 40, 10) };   // 100 sf,   index 1 (stacked on top)
  const line = { mode: "line", pts: [{ x: 0, y: 50 }, { x: 100, y: 50 }] }; // index 2
  const count = { mode: "count", pts: [{ x: 90, y: 90 }] };                 // index 3

  it("a point inside both areas returns SMALLER-area first (reachable on top)", () => {
    const order = measuresUnderPoint([big, small, line, count], { x: 45, y: 45 }, 1);
    expect(order[0]).toBe(1); // small area wins the first click
    expect(order).toContain(0); // big is still reachable underneath
  });
  it("a point only inside the big area returns just it", () => {
    const order = measuresUnderPoint([big, small, line, count], { x: 5, y: 5 }, 1);
    expect(order).toEqual([0]);
  });
  it("lines/counts (no area) sort AHEAD of area measurements", () => {
    // near the line (y≈50) and inside big — line's area 0 ranks before big's 10,000
    const order = measuresUnderPoint([big, line], { x: 50, y: 50 }, 2);
    expect(order[0]).toBe(1); // the line
    expect(order).toContain(0);
  });
  it("tol is a feet-space buffer: a near-miss outside tol is not a hit", () => {
    const order = measuresUnderPoint([line], { x: 50, y: 60 }, 5); // 10 ft away, tol 5
    expect(order).toEqual([]);
    const near = measuresUnderPoint([line], { x: 50, y: 53 }, 5);  // 3 ft away, tol 5
    expect(near).toEqual([0]);
  });
  it("count markers hit within tol of the marker point", () => {
    expect(measuresUnderPoint([count], { x: 91, y: 91 }, 3)).toEqual([3 - 3]); // sole item, index 0
    expect(measuresUnderPoint([count], { x: 200, y: 200 }, 3)).toEqual([]);
  });
});

describe("nextMeasureSelection · repeated clicks cycle DOWN the stack", () => {
  it("fresh click (nothing selected) picks the top/smallest", () => {
    expect(nextMeasureSelection([1, 0], -1)).toBe(1);
  });
  it("re-clicking the current selection advances to the next underneath, then wraps", () => {
    const order = [1, 0, 2]; // small, big, line under the cursor
    expect(nextMeasureSelection(order, 1)).toBe(0); // 1 → 0
    expect(nextMeasureSelection(order, 0)).toBe(2); // 0 → 2
    expect(nextMeasureSelection(order, 2)).toBe(1); // 2 → wrap to 1
  });
  it("current selection not under the cursor → jump to the top hit (no cycle)", () => {
    expect(nextMeasureSelection([3, 5], 9)).toBe(3);
  });
  it("nothing under the cursor → null", () => {
    expect(nextMeasureSelection([], 4)).toBe(null);
  });
});
