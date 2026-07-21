/* B920 / B921 — pure hit-test + z-stack cycling for Site Planner markups.
 *
 * The reported bug: a big UNFILLED (fillOpacity:0) polygon, drawn over the roads, swallowed every
 * click across its whole interior — so the roads under it were unreachable and "Send to Back" was
 * powerless (it's a hit-AREA problem, not paint order). These specs pin the two fixes so a future
 * canvas refactor can't silently regress them:
 *   • B920 — an UNFILLED closed markup grabs on its stroke + tolerance ONLY, never its interior;
 *            a FILLED one still grabs by its whole body (B155 small-annotation feel).
 *   • B921 — repeat/Alt-click cycles DOWN the stack of markups under the pointer, smaller-area
 *            first, so a covered shape is always reachable.
 */
import { describe, it, expect } from "vitest";
import {
  ringArea,
  pointInRing,
  distToPolyline,
  distToRing,
  boxCorners,
  ellipseRing,
  markupHitModel,
  markupUnderPoint,
  markupsUnderPoint,
  nextMarkupSelection,
} from "../src/workspaces/site-planner/lib/markupPick.js";

const square = (id, s, extra = {}) => ({ id, kind: "polygon", pts: [{ x: 0, y: 0 }, { x: s, y: 0 }, { x: s, y: s }, { x: 0, y: s }], ...extra });

describe("markupUnderPoint — the B920 fill-aware rule", () => {
  it("a FILLED closed polygon is hit on its interior", () => {
    const m = square("f", 100, { fillOpacity: 0.2 });
    expect(markupUnderPoint(m, { x: 50, y: 50 }, 1)).toMatchObject({ area: 10000 });
    expect(markupUnderPoint(m, { x: 300, y: 300 }, 1)).toBe(null);
  });

  it("an UNFILLED closed polygon is NOT hit on its interior — only near its stroke", () => {
    const m = square("u", 100, { fillOpacity: 0 });
    expect(markupUnderPoint(m, { x: 50, y: 50 }, 6)).toBe(null);     // dead centre → falls through (THE fix)
    expect(markupUnderPoint(m, { x: 50, y: 0.5 }, 6)).not.toBe(null); // on the top edge → grabs
    expect(markupUnderPoint(m, { x: -4, y: 50 }, 6)).not.toBe(null);  // just outside the left edge, within tol
    expect(markupUnderPoint(m, { x: -20, y: 50 }, 6)).toBe(null);     // well outside → miss
  });

  it("a fillOpacity of undefined is treated as unfilled (interior inert)", () => {
    const m = square("n", 100); // no fillOpacity
    expect(markupUnderPoint(m, { x: 50, y: 50 }, 6)).toBe(null);
  });

  it("an open line/polyline hits near its stroke only, never an 'interior'", () => {
    const line = { id: "l", kind: "line", a: { x: 0, y: 0 }, b: { x: 100, y: 0 } };
    expect(markupUnderPoint(line, { x: 50, y: 0.5 }, 4)).toMatchObject({ area: 0 });
    expect(markupUnderPoint(line, { x: 50, y: 40 }, 4)).toBe(null);
    const poly = { id: "p", kind: "polyline", pts: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }] };
    expect(markupUnderPoint(poly, { x: 100, y: 50 }, 4)).not.toBe(null); // on the vertical leg
    expect(markupUnderPoint(poly, { x: 40, y: 50 }, 4)).toBe(null);      // inside the L, off both legs
  });

  it("a rect honours rotation for its interior test", () => {
    const rect = { id: "r", kind: "rect", cx: 0, cy: 0, w: 100, h: 20, rot: 90, fillOpacity: 0.3 };
    expect(markupUnderPoint(rect, { x: 5, y: 40 }, 1)).not.toBe(null); // long axis now vertical
    expect(markupUnderPoint(rect, { x: 40, y: 5 }, 1)).toBe(null);     // where the unrotated rect would have reached
  });

  it("an ellipse is hit inside its curve but NOT at the bounding-box corner", () => {
    const el = { id: "e", kind: "ellipse", cx: 0, cy: 0, w: 100, h: 60, fillOpacity: 0.3 };
    expect(markupUnderPoint(el, { x: 0, y: 0 }, 1)).not.toBe(null);   // centre
    expect(markupUnderPoint(el, { x: 49, y: 29 }, 1)).toBe(null);     // bbox corner, outside the ellipse
  });

  it("semantic markups (encumbrance) grab by body regardless of fillOpacity", () => {
    const deed = { id: "d", kind: "encumbrance", pts: [{ x: 0, y: 0 }, { x: 200, y: 0 }, { x: 200, y: 200 }, { x: 0, y: 200 }] };
    expect(markupUnderPoint(deed, { x: 100, y: 100 }, 1)).not.toBe(null);
  });
});

describe("markupsUnderPoint + nextMarkupSelection — the B921 cycle", () => {
  it("orders overlapping FILLED shapes smaller-area-first so a small shape on a big one wins", () => {
    const big = square("big", 100, { fillOpacity: 0.2 });
    const small = square("small", 20, { fillOpacity: 0.2 });
    const order = markupsUnderPoint([big, small], { x: 10, y: 10 }, 1);
    expect(order).toEqual(["small", "big"]);
  });

  it("a repeat pick walks DOWN the stack and wraps", () => {
    const a = square("a", 20, { fillOpacity: 0.2 });   // smallest
    const b = square("b", 60, { fillOpacity: 0.2 });
    const c = square("c", 100, { fillOpacity: 0.2 });   // biggest
    const order = markupsUnderPoint([c, b, a], { x: 5, y: 5 }, 1);
    expect(order).toEqual(["a", "b", "c"]);
    expect(nextMarkupSelection(order, null)).toBe("a"); // fresh pick → smallest
    expect(nextMarkupSelection(order, "a")).toBe("b");  // re-pick → next down
    expect(nextMarkupSelection(order, "b")).toBe("c");
    expect(nextMarkupSelection(order, "c")).toBe("a");  // wraps
  });

  it("the giant UNFILLED boundary is absent from an interior click's stack (so it can't shadow the roads)", () => {
    // The exact reported shape: a huge invisible polygon over smaller FILLED road strips.
    const giant = { id: "giant", kind: "polygon", fillOpacity: 0, pts: [{ x: 0, y: 0 }, { x: 5000, y: 0 }, { x: 5000, y: 4000 }, { x: 0, y: 4000 }] };
    const road = { id: "road", kind: "polygon", fillOpacity: 0.4, pts: [{ x: 1000, y: 1000 }, { x: 1500, y: 1000 }, { x: 1500, y: 1050 }, { x: 1000, y: 1050 }] };
    const order = markupsUnderPoint([giant, road], { x: 1200, y: 1025 }, 6);
    expect(order).toEqual(["road"]); // the giant is gone; the road is grabbable
    // …but the giant is still reachable by clicking near its (invisible) edge:
    expect(markupsUnderPoint([giant, road], { x: 2, y: 2000 }, 6)).toEqual(["giant"]);
  });

  it("nextMarkupSelection is null for an empty stack", () => {
    expect(nextMarkupSelection([], "x")).toBe(null);
    expect(nextMarkupSelection(null, "x")).toBe(null);
  });
});

describe("geometry helpers", () => {
  it("ringArea is the absolute shoelace area", () => {
    expect(ringArea([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }])).toBe(100);
    expect(ringArea([{ x: 0, y: 0 }])).toBe(0);
  });
  it("pointInRing / distToPolyline / distToRing behave", () => {
    const ring = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }];
    expect(pointInRing({ x: 5, y: 5 }, ring)).toBe(true);
    expect(pointInRing({ x: 50, y: 5 }, ring)).toBe(false);
    expect(distToPolyline({ x: 5, y: -3 }, [{ x: 0, y: 0 }, { x: 10, y: 0 }])).toBeCloseTo(3, 6);
    expect(distToRing({ x: 5, y: 13 }, ring)).toBeCloseTo(3, 6); // near the top edge across the closing span
  });
  it("boxCorners rotates about the centre; ellipseRing samples the boundary", () => {
    const c = boxCorners({ cx: 0, cy: 0, w: 100, h: 100, rot: 0 });
    expect(c).toHaveLength(4);
    expect(c[0]).toMatchObject({ x: -50, y: -50 });
    expect(ellipseRing({ cx: 0, cy: 0, w: 100, h: 100 }, 4)).toHaveLength(4);
  });
  it("markupHitModel returns null for an unknown kind", () => {
    expect(markupHitModel({ kind: "mystery" })).toBe(null);
    expect(markupHitModel(null)).toBe(null);
  });
});
