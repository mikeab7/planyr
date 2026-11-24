import { describe, it, expect } from "vitest";
import { roadRowLabelPlace } from "../src/workspaces/site-planner/lib/roadRowLabel.js";

const f2p = (p) => ({ x: p.x * 2, y: p.y * 2 }); // 2 px per foot
const line = (a, b, n = 20) => Array.from({ length: n + 1 }, (_, i) => ({ x: a.x + (b.x - a.x) * i / n, y: a.y + (b.y - a.y) * i / n }));
const place = (pts, w = 60, c = 50) => roadRowLabelPlace(pts, f2p, w, c);

describe("roadRowLabelPlace (B2671331)", () => {
  it("rides the centerline, parallel to a straight road", () => {
    const r = place(line({ x: 0, y: 0 }, { x: 400, y: 0 }));
    expect(r.angle).toBeCloseTo(0); expect(r.y).toBeCloseTo(0);
  });
  it("never upside down, in every direction", () => {
    for (let d = 0; d < 360; d += 15) {
      const a = d * Math.PI / 180;
      const r = place(line({ x: 0, y: 0 }, { x: 400 * Math.cos(a), y: 400 * Math.sin(a) }));
      expect(r.angle).toBeGreaterThanOrEqual(-90); expect(r.angle).toBeLessThanOrEqual(90);
    }
  });
  it("a right-to-left road reads left-to-right", () => {
    expect(place(line({ x: 400, y: 0 }, { x: 0, y: 0 })).angle).toBeCloseTo(0);
  });
  it("diagonal and vertical roads turn with the road", () => {
    expect(place(line({ x: 0, y: 0 }, { x: 300, y: 300 })).angle).toBeCloseTo(45);
    expect(Math.abs(place(line({ x: 0, y: 0 }, { x: 0, y: 400 })).angle)).toBeCloseTo(90);
  });
  it("on a curve the angle follows the bend at the label", () => {
    const arc = Array.from({ length: 60 }, (_, i) => { const t = i / 59 * Math.PI / 2; return { x: 300 * Math.sin(t), y: 300 * (1 - Math.cos(t)) }; });
    const r = place(arc);
    expect(r.angle).toBeGreaterThan(5); expect(r.angle).toBeLessThan(85);
  });
  it("stands off the centre station so it does not sit on the width callout", () => {
    const r = place(line({ x: 0, y: 0 }, { x: 400, y: 0 }));
    expect(Math.abs(r.x - 400)).toBeGreaterThan(20); // centre station is x = 400 px
  });
  it("hides on a road too short to hold it", () => {
    expect(place(line({ x: 0, y: 0 }, { x: 40, y: 0 }))).toBeNull();
  });
  it("is deterministic for degenerate input", () => {
    expect(roadRowLabelPlace([], f2p, 60, 50)).toBeNull();
    expect(roadRowLabelPlace([{ x: 1, y: 1 }, { x: 1, y: 1 }], f2p, 60, 50)).toBeNull();
  });
});
