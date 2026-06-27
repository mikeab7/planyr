import { describe, it, expect } from "vitest";
import { pondContours, smoothRing, autoContourInterval, contourLabelPoint, pointInRing } from "../src/workspaces/site-planner/lib/pondGeom.js";

// Faithful inward offset for an axis-aligned rectangle ring: shrink by `d` on every side
// (so width/height each drop by 2d), preserving vertex order; null when it collapses. This
// matches what the real offsetPolygon does on a rectangle and lets us check areas in closed
// form: at depth `down`, area = (W - 2*slope*down)*(H - 2*slope*down).
const rectOffset = (ring, d) => {
  const xs = ring.map((p) => p.x), ys = ring.map((p) => p.y);
  const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
  const x0 = minX + d, x1 = maxX - d, y0 = minY + d, y1 = maxY - d;
  if (x1 - x0 <= 1e-6 || y1 - y0 <= 1e-6) return null; // tapered past a point
  return [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }];
};
const rect = (W, H) => [{ x: 0, y: 0 }, { x: W, y: 0 }, { x: W, y: H }, { x: 0, y: H }];
const polyArea = (r) => { let a = 0; for (let i = 0, n = r.length; i < n; i++) { const p = r[i], q = r[(i + 1) % n]; a += p.x * q.y - q.x * p.y; } return Math.abs(a / 2); };

describe("pondContours — stage contour rings", () => {
  it("emits a nesting stack with water + bottom levels, no collapse on a normal pond", () => {
    const ring = rect(200, 120); // 200×120 top of bank
    const c = pondContours(ring, { depth: 8, freeboard: 1, slope: 3, contourInterval: 1 }, rectOffset);
    expect(c.collapsedAt).toBeNull();
    const water = c.levels.find((l) => l.isWater);
    const bottom = c.levels.find((l) => l.isBottom);
    expect(water).toBeTruthy();
    expect(water.down).toBeCloseTo(1, 6);
    expect(bottom).toBeTruthy();
    expect(bottom.down).toBeCloseTo(8, 6);
    // Rings strictly nest (each smaller than the last) from top to bottom.
    for (let i = 1; i < c.levels.length; i++) expect(c.levels[i].area).toBeLessThan(c.levels[i - 1].area);
  });

  it("areas match the closed-form rectangle offset (reuse of offsetPolygon is faithful)", () => {
    const W = 200, H = 120, slope = 3;
    const ring = rect(W, H);
    const c = pondContours(ring, { depth: 8, freeboard: 1, slope, contourInterval: 1 }, rectOffset);
    const water = c.levels.find((l) => l.isWater);
    const bottom = c.levels.find((l) => l.isBottom);
    expect(water.area).toBeCloseTo((W - 2 * slope * 1) * (H - 2 * slope * 1), 3); // down=1
    expect(bottom.area).toBeCloseTo((W - 2 * slope * 8) * (H - 2 * slope * 8), 3); // down=8
  });

  it("over-taper: stops at the last valid ring, emits nothing deeper, deepest area > 0", () => {
    // 40×40 basin, slope 3, depth 10 → at down=7 the offset is 2*3*7=42 > 40 → collapsed.
    const ring = rect(40, 40);
    const c = pondContours(ring, { depth: 10, freeboard: 1, slope: 3, contourInterval: 1 }, rectOffset);
    expect(c.collapsedAt).not.toBeNull();
    expect(c.collapsedAt).toBeGreaterThan(0);
    // No emitted level is at or past the collapse depth, and the deepest one still holds area.
    for (const l of c.levels) expect(l.down).toBeLessThan(c.collapsedAt);
    const deepest = c.levels[c.levels.length - 1];
    expect(deepest.area).toBeGreaterThan(0);
    expect(c.levels.some((l) => l.isBottom)).toBe(false); // bottom never reached
  });

  it("always includes footprint + water + bottom even when the interval is larger than depth", () => {
    const ring = rect(300, 300);
    const c = pondContours(ring, { depth: 8, freeboard: 2, slope: 2, contourInterval: 50 }, rectOffset);
    expect(c.levels.some((l) => l.down === 0)).toBe(true);   // footprint
    expect(c.levels.some((l) => l.isWater)).toBe(true);      // water surface
    expect(c.levels.some((l) => l.isBottom)).toBe(true);     // bottom
  });

  it("clamps a zero / negative interval (no infinite loop) and still terminates", () => {
    const ring = rect(300, 300);
    const c = pondContours(ring, { depth: 8, freeboard: 1, slope: 2, contourInterval: 0 }, rectOffset);
    expect(c.meta.interval).toBeGreaterThanOrEqual(0.5);
    expect(c.levels.length).toBeGreaterThan(2);
    expect(c.levels.length).toBeLessThan(100);
  });

  it("labels rings as real elevations when a top-of-bank elevation is set", () => {
    const ring = rect(200, 120);
    const c = pondContours(ring, { depth: 8, freeboard: 1, slope: 3, tobElev: 96, contourInterval: 1 }, rectOffset);
    const water = c.levels.find((l) => l.isWater);
    expect(water.elev).toBeCloseTo(95, 6); // 96 - 1 ft down
    const bottom = c.levels.find((l) => l.isBottom);
    expect(bottom.elev).toBeCloseTo(88, 6); // 96 - 8
  });

  it("leaves elev undefined with no datum", () => {
    const c = pondContours(rect(200, 120), { depth: 8, freeboard: 1, slope: 3 }, rectOffset);
    expect(c.levels.every((l) => l.elev === undefined)).toBe(true);
  });

  it("returns an empty result for a degenerate ring or a missing offset fn", () => {
    expect(pondContours([{ x: 0, y: 0 }], { depth: 8 }, rectOffset).levels).toEqual([]);
    expect(pondContours(rect(100, 100), { depth: 8 }, null).levels).toEqual([]);
  });
});

describe("autoContourInterval — ~4–6 rings across the depth", () => {
  it("steps the interval up with depth", () => {
    expect(autoContourInterval(4)).toBe(1);
    expect(autoContourInterval(6)).toBe(1);
    expect(autoContourInterval(10)).toBe(2);
    expect(autoContourInterval(12)).toBe(2);
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

describe("smoothRing — cosmetic, never changes the numbers", () => {
  it("rounds corners (more points), stays a closed ring inside the original bbox", () => {
    const ring = rect(100, 60);
    const sm = smoothRing(ring, 2);
    expect(sm.length).toBeGreaterThan(ring.length);
    for (const p of sm) {
      expect(p.x).toBeGreaterThanOrEqual(-1e-9);
      expect(p.x).toBeLessThanOrEqual(100 + 1e-9);
      expect(p.y).toBeGreaterThanOrEqual(-1e-9);
      expect(p.y).toBeLessThanOrEqual(60 + 1e-9);
    }
    // A smoothed convex ring has slightly less area than the polygon (corners cut) — but the
    // contour AREAS reported by pondContours never use the smoothed ring, which is the point.
    expect(polyArea(sm)).toBeLessThan(polyArea(ring));
  });
  it("pondContours level rings are the TRUE (un-smoothed) polygons", () => {
    const c = pondContours(rect(200, 120), { depth: 8, freeboard: 1, slope: 3, contourInterval: 1 }, rectOffset);
    // Each offset of a rectangle is still a 4-vertex rectangle — smoothing would have grown it.
    for (const l of c.levels) expect(l.ring.length).toBe(4);
  });
  it("is a no-op on a degenerate ring", () => {
    expect(smoothRing([{ x: 0, y: 0 }, { x: 1, y: 1 }])).toHaveLength(2);
  });
});

describe("contourLabelPoint — seats a ring's label on it, off the centroid", () => {
  it("returns a point on/inside the ring, distinct from the centroid", () => {
    const ring = rect(200, 120);
    const p = contourLabelPoint(ring);
    expect(p).toBeTruthy();
    expect(pointInRing(p, ring)).toBe(true);
    const cx = 100, cy = 60; // rectangle centroid
    expect(Math.hypot(p.x - cx, p.y - cy)).toBeGreaterThan(1); // not stacked on the centre
  });
  it("returns null for a degenerate ring", () => {
    expect(contourLabelPoint([{ x: 0, y: 0 }])).toBeNull();
  });
});
