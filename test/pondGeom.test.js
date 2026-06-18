import { describe, it, expect } from "vitest";
import { pointInRing, addedAreaLabelPoint } from "../src/workspaces/site-planner/lib/pondGeom.js";

// Helper: a rectangle ring from corner (x0,y0) to (x1,y1).
const rect = (x0, y0, x1, y1) => [
  { x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 },
];

describe("pondGeom — added-detention label placement (B151)", () => {
  it("pointInRing: even-odd inside/outside", () => {
    const r = rect(0, 0, 100, 100);
    expect(pointInRing({ x: 50, y: 50 }, r)).toBe(true);
    expect(pointInRing({ x: 150, y: 50 }, r)).toBe(false);
    expect(pointInRing({ x: -1, y: 50 }, r)).toBe(false);
  });

  it("one-sided expansion: label lands ON the new strip, not in the old pond", () => {
    const baseline = rect(0, 0, 100, 100);
    const expanded = rect(0, 0, 160, 100); // pushed the right bank out 60 ft
    const p = addedAreaLabelPoint(expanded, baseline);
    expect(p).not.toBeNull();
    // Inside the new ground, never inside the existing basin.
    expect(pointInRing(p, expanded)).toBe(true);
    expect(pointInRing(p, baseline)).toBe(false);
    // The strip is x∈[100,160]; the deepest point sits near its middle.
    expect(p.x).toBeGreaterThan(100);
    expect(p.x).toBeLessThan(160);
  });

  it("uniform all-sides expansion: label sits in the new RING, NOT the old pond's centroid", () => {
    const baseline = rect(0, 0, 100, 100);
    const expanded = rect(-40, -40, 140, 140); // banks pushed out ~40 ft all around
    const p = addedAreaLabelPoint(expanded, baseline);
    expect(p).not.toBeNull();
    // The whole-pond centroid (50,50) is inside the OLD pond — the bug we are avoiding.
    expect(pointInRing({ x: 50, y: 50 }, baseline)).toBe(true);
    // Our point must instead be in the added ring band: outside baseline, inside expanded.
    expect(pointInRing(p, baseline)).toBe(false);
    expect(pointInRing(p, expanded)).toBe(true);
  });

  it("no expansion (expanded == baseline) → null", () => {
    const r = rect(0, 0, 100, 100);
    expect(addedAreaLabelPoint(r, r)).toBeNull();
  });

  it("pure shrink (expanded smaller, fully inside baseline) → null", () => {
    const baseline = rect(0, 0, 100, 100);
    const expanded = rect(20, 20, 80, 80);
    expect(addedAreaLabelPoint(expanded, baseline)).toBeNull();
  });

  it("degenerate / too-few-point rings → null", () => {
    expect(addedAreaLabelPoint([{ x: 0, y: 0 }, { x: 1, y: 1 }], rect(0, 0, 9, 9))).toBeNull();
    expect(addedAreaLabelPoint(rect(0, 0, 9, 9), null)).toBeNull();
  });
});
