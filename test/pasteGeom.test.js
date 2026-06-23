/* B417 — paste-at-cursor placement math. The pure geometry shared by the Site Planner
 * (pasteClip, polygon branch) and the Review canvas (pasteMarkup): a pasted copy lands
 * CENTERED under the cursor, rigidly translated (shape never distorts). */
import { describe, it, expect } from "vitest";
import { bboxCenter, centerOn } from "../src/shared/geometry/pasteGeom.js";

const near = (a, b, t = 1e-9) => Math.abs(a - b) <= t;

describe("bboxCenter", () => {
  it("is the center of an axis-aligned box from its corners", () => {
    expect(bboxCenter([{ x: 0, y: 0 }, { x: 10, y: 4 }])).toEqual({ x: 5, y: 2 });
  });
  it("handles a single point (a text anchor) — center IS the point", () => {
    expect(bboxCenter([{ x: 7, y: -3 }])).toEqual({ x: 7, y: -3 });
  });
  it("uses extremes, not the average — an off-center cluster still centers on its bbox", () => {
    // four points, three bunched low-left + one far up-right: bbox center is the midpoint of extremes
    expect(bboxCenter([{ x: 0, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }, { x: 100, y: 50 }])).toEqual({ x: 50, y: 25 });
  });
  it("works with negative coordinates", () => {
    expect(bboxCenter([{ x: -40, y: -10 }, { x: -20, y: -2 }])).toEqual({ x: -30, y: -6 });
  });
});

describe("centerOn", () => {
  it("lands the bbox center exactly on the target", () => {
    const out = centerOn([{ x: 0, y: 0 }, { x: 20, y: 12 }], { x: 100, y: 50 });
    const c = bboxCenter(out);
    expect(near(c.x, 100)).toBe(true);
    expect(near(c.y, 50)).toBe(true);
  });
  it("moves a single point (text) onto the target", () => {
    expect(centerOn([{ x: 3, y: 9 }], { x: -5, y: 5 })).toEqual([{ x: -5, y: 5 }]);
  });
  it("is a rigid translation — every point shifts by the SAME delta (shape preserved)", () => {
    const src = [{ x: 2, y: 2 }, { x: 8, y: 2 }, { x: 8, y: 6 }, { x: 2, y: 6 }]; // a 6x4 rect, center (5,4)
    const out = centerOn(src, { x: 0, y: 0 });
    const dx = out[0].x - src[0].x, dy = out[0].y - src[0].y;
    expect({ dx, dy }).toEqual({ dx: -5, dy: -4 });
    for (let i = 0; i < src.length; i++) {
      expect(near(out[i].x - src[i].x, dx)).toBe(true);
      expect(near(out[i].y - src[i].y, dy)).toBe(true);
    }
    // edge lengths are unchanged (no scale/shear)
    expect(out[1].x - out[0].x).toBe(src[1].x - src[0].x);
    expect(out[2].y - out[1].y).toBe(src[2].y - src[1].y);
  });
  it("preserves the point count and order (count-stamp clusters paste intact)", () => {
    const src = [{ x: 0, y: 0 }, { x: 5, y: 0 }, { x: 10, y: 0 }];
    const out = centerOn(src, { x: 1000, y: 1000 });
    expect(out).toHaveLength(3);
    expect(bboxCenter(out)).toEqual({ x: 1000, y: 1000 });
  });
  it("does not mutate the input points", () => {
    const src = [{ x: 1, y: 1 }, { x: 3, y: 3 }];
    const snap = JSON.parse(JSON.stringify(src));
    centerOn(src, { x: 50, y: 50 });
    expect(src).toEqual(snap);
  });
});
