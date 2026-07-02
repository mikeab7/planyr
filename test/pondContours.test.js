import { describe, it, expect } from "vitest";
import { pondContours, autoContourInterval, contourLabelPoint, pointInRing } from "../src/workspaces/site-planner/lib/pondGeom.js";

const rect = (W, H) => [{ x: 0, y: 0 }, { x: W, y: 0 }, { x: W, y: H }, { x: 0, y: H }];

describe("pondContours — stage contour rings (robust offset)", () => {
  it("emits a nesting stack with water + bottom levels, feasible on a healthy pond", () => {
    const c = pondContours(rect(200, 120), { depth: 8, freeboard: 1, slope: 3, contourInterval: 1 });
    expect(c.feasible).toBe(true);
    const water = c.levels.find((l) => l.isWater);
    const bottom = c.levels.find((l) => l.isBottom);
    expect(water).toBeTruthy();
    expect(water.down).toBeCloseTo(1, 6);
    expect(bottom).toBeTruthy();
    expect(bottom.down).toBeCloseTo(8, 6);
    // every level carries an ARRAY of rings; areas nest (each smaller than the last).
    for (const l of c.levels) expect(Array.isArray(l.rings)).toBe(true);
    for (let i = 1; i < c.levels.length; i++) expect(c.levels[i].area).toBeLessThan(c.levels[i - 1].area);
  });

  it("reports infeasibility (loud) when the footprint is too narrow for the depth", () => {
    // 200×40 footprint, slope 4, depth 8 → max inscribed reach 20 → maxDepth 5 < 8.
    const c = pondContours(rect(200, 40), { depth: 8, freeboard: 1, slope: 4, contourInterval: 1 });
    expect(c.feasible).toBe(false);
    expect(c.maxDepth).toBeCloseTo(5, 1);
    // it still emits the real contours that DO exist (down to pinch-off), never garbage.
    expect(c.levels.length).toBeGreaterThan(1);
    expect(c.levels.every((l) => l.area >= 0)).toBe(true);
    // the floor (down=8) is never reached, so no bottom level.
    expect(c.levels.some((l) => l.isBottom)).toBe(false);
  });

  it("a shallow-enough pond on the same narrow footprint is feasible", () => {
    const c = pondContours(rect(200, 40), { depth: 4, freeboard: 1, slope: 4, contourInterval: 1 });
    expect(c.feasible).toBe(true);
    expect(c.levels.some((l) => l.isBottom)).toBe(true);
  });

  it("always includes footprint + water + bottom when the interval exceeds the depth", () => {
    const c = pondContours(rect(400, 400), { depth: 8, freeboard: 2, slope: 2, contourInterval: 50 });
    expect(c.levels.some((l) => l.down === 0)).toBe(true);
    expect(c.levels.some((l) => l.isWater)).toBe(true);
    expect(c.levels.some((l) => l.isBottom)).toBe(true);
  });

  it("clamps a zero / negative interval (no infinite loop)", () => {
    const c = pondContours(rect(400, 400), { depth: 8, freeboard: 1, slope: 2, contourInterval: 0 });
    expect(c.meta.interval).toBeGreaterThanOrEqual(0.5);
    expect(c.levels.length).toBeGreaterThan(2);
    expect(c.levels.length).toBeLessThan(100);
  });

  it("labels rings as real elevations when a top-of-bank elevation is set, else undefined", () => {
    const withDatum = pondContours(rect(200, 120), { depth: 8, freeboard: 1, slope: 3, tobElev: 96, contourInterval: 1 });
    expect(withDatum.levels.find((l) => l.isWater).elev).toBeCloseTo(95, 6); // 96 - 1
    expect(withDatum.levels.find((l) => l.isBottom).elev).toBeCloseTo(88, 6); // 96 - 8
    const noDatum = pondContours(rect(200, 120), { depth: 8, freeboard: 1, slope: 3 });
    expect(noDatum.levels.every((l) => l.elev === undefined)).toBe(true);
  });

  it("returns an empty result for a degenerate ring", () => {
    expect(pondContours([{ x: 0, y: 0 }], { depth: 8 }).levels).toEqual([]);
  });
});

describe("autoContourInterval — ~4–6 rings across the depth", () => {
  it("steps the interval up with depth", () => {
    expect(autoContourInterval(4)).toBe(1);
    expect(autoContourInterval(10)).toBe(2);
    expect(autoContourInterval(20)).toBe(3);
  });
  it("keeps the ring count in a readable band for typical depths", () => {
    for (const d of [4, 8, 12, 18, 24]) {
      const n = d / autoContourInterval(d);
      expect(n).toBeGreaterThanOrEqual(3);
      expect(n).toBeLessThanOrEqual(8);
    }
  });
});

describe("contourLabelPoint — seats a ring's label on it, off the centroid", () => {
  it("returns a point on/inside the ring, distinct from the centroid", () => {
    const ring = rect(200, 120);
    const p = contourLabelPoint(ring, "top");
    expect(p).toBeTruthy();
    expect(pointInRing(p, ring)).toBe(true);
    expect(Math.hypot(p.x - 100, p.y - 60)).toBeGreaterThan(1); // not stacked on the centre
  });
  it("returns null for a degenerate ring", () => {
    expect(contourLabelPoint([{ x: 0, y: 0 }])).toBeNull();
  });
});
