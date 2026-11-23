import { describe, it, expect } from "vitest";
import { polyArea } from "../src/workspaces/site-planner/lib/siteGeometry.js";
import { ringArea } from "../src/workspaces/site-planner/lib/ringMath.js";
describe("shoelace de-duplication (audit I2)", () => {
  // Verbatim old spelling of siteGeometry.polyArea / MapFinder.shoelace.
  const old = (pts) => {
    if (!Array.isArray(pts) || !pts.length) return 0;
    let a = 0;
    for (let i = 0; i < pts.length; i++) { const j = (i + 1) % pts.length; a += pts[i].x * pts[j].y - pts[j].x * pts[i].y; }
    return Math.abs(a) / 2;
  };
  it("polyArea is bit-identical to the old loop", () => {
    const cases = [null, [], [{ x: 1, y: 2 }], [{ x: 1.1, y: 2.3 }, { x: 4.7, y: 9.1 }],
      [{ x: 0, y: 0 }, { x: 123.456, y: 0.1 }, { x: 98.7, y: 654.321 }, { x: -3.3, y: 10.01 }]];
    for (const c of cases) { expect(polyArea(c)).toBe(old(c)); expect(ringArea(c)).toBe(old(c)); }
  });
});
