import { describe, it, expect } from "vitest";
import { pointInRing, pointInPairRing, distToSegment, distToSegmentXY, extentOfRings, extentOfPairRings } from "../src/workspaces/site-planner/lib/ringMath.js";

/* B2671309 — the shared geometry leaf is bit-identical to the hand-rolled copies it replaced. The
 * "old_*" functions below are the verbatim loops those copies used. */
const old_pair = (ring, x, y) => {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
};
const old_seg = (p, a, b) => {
  const dx = b.x - a.x, dy = b.y - a.y, len2 = dx * dx + dy * dy;
  if (len2 === 0) return Math.hypot(p.x - a.x, p.y - a.y);
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
};
let seed = 12345;
const rnd = () => ((seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296);
const rpt = () => [rnd() * 200 - 100, rnd() * 200 - 100];

describe("geometry leaf (B2671309)", () => {
  it("pointInPairRing matches the old pair-ring loop on random rings and points", () => {
    for (let n = 0; n < 300; n++) {
      const ring = Array.from({ length: 3 + Math.floor(rnd() * 8) }, rpt);
      const [x, y] = rpt();
      expect(pointInPairRing(ring, x, y)).toBe(old_pair(ring, x, y));
    }
  });
  it("pointInPairRing knows inside from outside and tolerates an empty ring", () => {
    const sq = [[0, 0], [10, 0], [10, 10], [0, 10]];
    expect(pointInPairRing(sq, 5, 5)).toBe(true);
    expect(pointInPairRing(sq, 15, 5)).toBe(false);
    expect(pointInPairRing([], 1, 1)).toBe(false);
  });
  it("the {x,y} and pair spellings agree", () => {
    const pairs = [[0, 0], [10, 0], [10, 10], [0, 10]];
    const objs = pairs.map(([x, y]) => ({ x, y }));
    for (const [x, y] of [[5, 5], [11, 5], [-1, -1], [9.99, 0.01]]) expect(pointInRing({ x, y }, objs)).toBe(pointInPairRing(pairs, x, y));
  });
  it("distToSegment matches the old segment loop, including a zero-length segment", () => {
    for (let n = 0; n < 300; n++) {
      const [px, py] = rpt(), [ax, ay] = rpt(), [bx, by] = rpt();
      const p = { x: px, y: py }, a = { x: ax, y: ay }, b = { x: bx, y: by };
      expect(distToSegment(p, a, b)).toBe(old_seg(p, a, b));
      expect(distToSegmentXY(px, py, ax, ay, bx, by)).toBe(old_seg(p, a, b));
    }
    const p = { x: 3, y: 4 }, a = { x: 0, y: 0 };
    expect(distToSegment(p, a, a)).toBe(5);
    expect(distToSegment({ x: 20, y: 0 }, { x: 0, y: 0 }, { x: 10, y: 0 })).toBe(10); // clamped, not extrapolated
  });
  it("extentOfRings / extentOfPairRings give [minX, minY, maxX, maxY] and the empty sentinel", () => {
    expect(extentOfRings([[{ x: 1, y: 5 }, { x: -2, y: 3 }], [{ x: 4, y: 9 }]])).toEqual([-2, 3, 4, 9]);
    expect(extentOfPairRings([[[1, 5], [-2, 3]], [[4, 9]]])).toEqual([-2, 3, 4, 9]);
    expect(extentOfRings([])).toEqual([Infinity, Infinity, -Infinity, -Infinity]);
  });
});
