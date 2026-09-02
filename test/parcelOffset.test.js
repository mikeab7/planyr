import { describe, it, expect } from "vitest";
import { offsetPolygon, outsetPolygon, lineIntersect, setbackRingArea } from "../src/workspaces/site-planner/lib/parcelOffset.js";
import { ringArea } from "../src/workspaces/site-planner/lib/ringMath.js";

/* Even-odd point-in-polygon, mirroring the module's own internal test — kept separate here on
 * purpose so this suite doesn't just re-check the implementation against itself. */
function pointInPolygon(pt, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i].x, yi = poly[i].y, xj = poly[j].x, yj = poly[j].y;
    const intersect = (yi > pt.y) !== (yj > pt.y) && pt.x < ((xj - xi) * (pt.y - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}
function dist(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }
function distToBoundary(pt, poly) {
  let best = Infinity;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    const abx = b.x - a.x, aby = b.y - a.y;
    const len2 = abx * abx + aby * aby;
    const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((pt.x - a.x) * abx + (pt.y - a.y) * aby) / len2));
    best = Math.min(best, dist(pt, { x: a.x + abx * t, y: a.y + aby * t }));
  }
  return best;
}

const SQ = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }];
const SQ_AREA = 100 * 100;

describe("offsetPolygon (parcel setback ring geometry)", () => {
  it("insets a square uniformly by a scalar distance", () => {
    const o = offsetPolygon(SQ, 10);
    expect(o.map((p) => ({ x: Math.round(p.x), y: Math.round(p.y) }))).toEqual([
      { x: 10, y: 10 }, { x: 90, y: 10 }, { x: 90, y: 90 }, { x: 10, y: 90 },
    ]);
  });

  it("returns null under n<3 points", () => {
    expect(offsetPolygon([{ x: 0, y: 0 }, { x: 1, y: 1 }], 5)).toBeNull();
  });

  it("shrinks area for a uniform inward offset", () => {
    const area = setbackRingArea(SQ, 10);
    expect(area).toBeCloseTo(80 * 80, 0);
  });

  /* ⛔ B966627 — RED PRE-FIX. Real production geometry: Bain (site smthnjl2cxyg), parcel
   * e1455090gmiinz ("Parcel 2A1A1B", 4.97 AC), offset by the site's 25' default setback. Two of
   * its 12 vertices landed OUTSIDE the source ring under the old unclamped miter/bevel
   * construction — exactly the owner's screenshot: "dashes reading outside the solid boundary."
   * An INWARD offset must never step outward; every result vertex must be inside the source ring
   * (or clamped onto its boundary, distance ~0). */
  it("never places an inward-offset vertex outside the source ring — the real Bain sliver that broke it", () => {
    const BAIN_2A1A1B = [
      { x: 1103.5873279698, y: 85.78304580270387 }, { x: 1103.6100866865718, y: 90.47382436051589 },
      { x: 1104.2442225883303, y: 292.8940463791757 }, { x: 1106.0743131052254, y: 576.3756948350392 },
      { x: 1106.0694970924756, y: 739.7898890631645 }, { x: 1107.0915895192948, y: 802.1996944168902 },
      { x: 975.8626519214661, y: 769.0464966442929 }, { x: 646.6234252414001, y: 684.3619586002476 },
      { x: 647.279486251534, y: 685.8822782101826 }, { x: 517.2, y: 542.51 },
      { x: 796.84, y: 390.17 }, { x: 859.4939671608021, y: 327.951766871429 },
    ];
    const offset = offsetPolygon(BAIN_2A1A1B, 25);
    expect(offset).not.toBeNull();
    for (const p of offset) {
      const inside = pointInPolygon(p, BAIN_2A1A1B);
      const onBoundary = distToBoundary(p, BAIN_2A1A1B) < 0.01;
      expect(inside || onBoundary, `vertex (${p.x.toFixed(2)}, ${p.y.toFixed(2)}) is outside the source ring by ${distToBoundary(p, BAIN_2A1A1B).toFixed(3)} ft`).toBe(true);
    }
    // And the inset still genuinely shrinks the lot — the clamp corrects an escaped corner, it
    // doesn't collapse the whole ring back onto the boundary.
    expect(setbackRingArea(BAIN_2A1A1B, 25)).toBeLessThan(setbackRingArea(BAIN_2A1A1B, 0));
  });

  it("lineIntersect returns null for parallel lines", () => {
    expect(lineIntersect(0, 0, 10, 0, 0, 5, 10, 5)).toBeNull();
  });
});

/* B848720 — outsetPolygon is offsetPolygon's mirror: it must always GROW the ring (never
 * clamp back to the source boundary the way an inward offset does), because this is what the
 * selection outline on a box-kind markup / a selected site element draws OUTSIDE the feature's
 * own boundary, so the outline can never land on the exact same path as the feature's own
 * (possibly user-recoloured) stroke. See SitePlanner.jsx SEL_OUTLINE_GAP_PX / markupHandles /
 * elSelOutline for the two call sites this exists for. */
describe("outsetPolygon (the selection-outline halo geometry, B848720)", () => {
  it("grows a square uniformly outward by a scalar distance", () => {
    const o = outsetPolygon(SQ, 10);
    expect(o.map((p) => ({ x: Math.round(p.x), y: Math.round(p.y) }))).toEqual([
      { x: -10, y: -10 }, { x: 110, y: -10 }, { x: 110, y: 110 }, { x: -10, y: 110 },
    ]);
  });

  it("returns null under n<3 points", () => {
    expect(outsetPolygon([{ x: 0, y: 0 }, { x: 1, y: 1 }], 4)).toBeNull();
  });

  it("grows the area for a uniform outward offset (the exact opposite of offsetPolygon)", () => {
    const outArea = ringArea(outsetPolygon(SQ, 10));
    const inArea = ringArea(offsetPolygon(SQ, 10));
    expect(outArea).toBeGreaterThan(SQ_AREA);
    expect(inArea).toBeLessThan(SQ_AREA);
  });

  // Real production geometry (the same Bain sliver B966627 used for the inward clamp): every
  // grown vertex must land OUTSIDE the source ring — the mirror image of that test's invariant.
  // A grown ring that still clamped back onto the boundary would be indistinguishable from the
  // coincident outline this exists to replace.
  it("never places an outward-offset vertex inside the source ring — the real Bain sliver", () => {
    const BAIN_2A1A1B = [
      { x: 1103.5873279698, y: 85.78304580270387 }, { x: 1103.6100866865718, y: 90.47382436051589 },
      { x: 1104.2442225883303, y: 292.8940463791757 }, { x: 1106.0743131052254, y: 576.3756948350392 },
      { x: 1106.0694970924756, y: 739.7898890631645 }, { x: 1107.0915895192948, y: 802.1996944168902 },
      { x: 975.8626519214661, y: 769.0464966442929 }, { x: 646.6234252414001, y: 684.3619586002476 },
      { x: 647.279486251534, y: 685.8822782101826 }, { x: 517.2, y: 542.51 },
      { x: 796.84, y: 390.17 }, { x: 859.4939671608021, y: 327.951766871429 },
    ];
    const outset = outsetPolygon(BAIN_2A1A1B, 4);
    expect(outset).not.toBeNull();
    for (const p of outset) {
      const inside = pointInPolygon(p, BAIN_2A1A1B);
      const onBoundary = distToBoundary(p, BAIN_2A1A1B) < 0.01;
      expect(inside && !onBoundary, `vertex (${p.x.toFixed(2)}, ${p.y.toFixed(2)}) is still inside the source ring`).toBe(false);
    }
    expect(ringArea(outset)).toBeGreaterThan(ringArea(BAIN_2A1A1B));
  });

  it("a screen-space rect (constant px gap, the markup box-kind shape) grows on every side", () => {
    const RECT = [{ x: 100, y: 100 }, { x: 400, y: 100 }, { x: 400, y: 300 }, { x: 100, y: 300 }];
    const grown = outsetPolygon(RECT, 4);
    const xs = grown.map((p) => p.x), ys = grown.map((p) => p.y);
    expect(Math.min(...xs)).toBeCloseTo(96, 1);
    expect(Math.max(...xs)).toBeCloseTo(404, 1);
    expect(Math.min(...ys)).toBeCloseTo(96, 1);
    expect(Math.max(...ys)).toBeCloseTo(304, 1);
  });
});
