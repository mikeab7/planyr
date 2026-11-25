/* B920 / B921 / NEW-1(2026-09-07) — pure hit-test + z-stack cycling for Site Planner markups.
 *
 * The original B920 bug: a big UNFILLED (fillOpacity:0), LOCKED polygon, drawn over the roads,
 * swallowed every click across its whole interior — so the roads under it were unreachable and
 * "Send to Back" was powerless (it's a hit-AREA problem, not paint order). B920's fix — an
 * unfilled closed markup grabs on its stroke + tolerance only — over-corrected: it also made an
 * ordinary, UNLOCKED, freshly-drawn shape unselectable by clicking inside it, which is the
 * standard behaviour of every drawing tool (owner report, 2026-09-07). The rule is now
 * fill-OR-unlocked: only a LOCKED + unfilled shape (the real B920 case — locking is the signal a
 * shape is a passive backdrop reference) keeps the stroke-only grab. These specs pin both:
 *   • B920 (as amended) — a LOCKED + unfilled closed markup grabs on its stroke + tolerance ONLY;
 *            a FILLED one, or any UNLOCKED one, grabs by its whole body.
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
  closedMarkupSize,
  openMarkupLength,
} from "../src/workspaces/site-planner/lib/markupPick.js";

const square = (id, s, extra = {}) => ({ id, kind: "polygon", pts: [{ x: 0, y: 0 }, { x: s, y: 0 }, { x: s, y: s }, { x: 0, y: s }], ...extra });

describe("markupUnderPoint — the B920/NEW-1 fill-or-unlocked rule", () => {
  it("a FILLED closed polygon is hit on its interior", () => {
    const m = square("f", 100, { fillOpacity: 0.2 });
    expect(markupUnderPoint(m, { x: 50, y: 50 }, 1)).toMatchObject({ area: 10000 });
    expect(markupUnderPoint(m, { x: 300, y: 300 }, 1)).toBe(null);
  });

  it("2026-11-24: an UNLOCKED unfilled, unhatched closed polygon is hit on its outline ONLY (supersedes the 2026-09-07 interior grab)", () => {
    const m = square("u", 100, { fillOpacity: 0 });
    expect(markupUnderPoint(m, { x: 50, y: 50 }, 6)).toBe(null);
    expect(markupUnderPoint(m, { x: 50, y: 2 }, 6)).not.toBe(null);
  });
  it("any visible fill, however faint, keeps the interior clickable", () => {
    expect(markupUnderPoint(square("faint", 100, { fillOpacity: 0.02 }), { x: 50, y: 50 }, 6)).not.toBe(null);
  });
  it("rect, ellipse and cloud follow the same rule (fill on/off x hatch on/off)", () => {
    const shapes = {
      rect: { kind: "rect", cx: 50, cy: 50, w: 100, h: 100, rot: 0 },
      ellipse: { kind: "ellipse", cx: 50, cy: 50, w: 100, h: 100, rot: 0 },
      cloud: { kind: "cloud", pts: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }] },
    };
    for (const [name, base] of Object.entries(shapes)) {
      const hitsAt = (extra) => markupUnderPoint({ id: name, ...base, ...extra }, { x: 50, y: 50 }, 6) != null;
      expect(hitsAt({ fillOpacity: 0 }), `${name} bare`).toBe(false);
      expect(hitsAt({ fillOpacity: 0.3 }), `${name} fill`).toBe(true);
      expect(hitsAt({ fillOpacity: 0, hatch: "diagonal" }), `${name} hatch`).toBe(true);
      expect(hitsAt({ fillOpacity: 0.3, hatch: "diagonal" }), `${name} both`).toBe(true);
    }
  });

  it("a LOCKED unfilled closed polygon is NOT hit on its interior — only near its stroke (the real B920 case)", () => {
    const m = square("u", 100, { fillOpacity: 0, locked: true });
    expect(markupUnderPoint(m, { x: 50, y: 50 }, 6)).toBe(null);     // dead centre → falls through (THE fix)
    expect(markupUnderPoint(m, { x: 50, y: 0.5 }, 6)).not.toBe(null); // on the top edge → grabs
    expect(markupUnderPoint(m, { x: -4, y: 50 }, 6)).not.toBe(null);  // just outside the left edge, within tol
    expect(markupUnderPoint(m, { x: -20, y: 50 }, 6)).toBe(null);     // well outside → miss
  });

  it("a fillOpacity of undefined on a LOCKED shape is treated as unfilled (interior inert)", () => {
    const m = square("n", 100, { locked: true }); // no fillOpacity
    expect(markupUnderPoint(m, { x: 50, y: 50 }, 6)).toBe(null);
  });

  it("a fillOpacity of undefined on an UNLOCKED shape is unfilled too (2026-11-24)", () => {
    const m = square("n2", 100); // no fillOpacity, no locked → unlocked
    expect(markupUnderPoint(m, { x: 50, y: 50 }, 6)).toBe(null);
  });

  it("a visible hatch makes a zero-opacity LOCKED closed markup body selectable", () => {
    const m = square("h", 100, { fillOpacity: 0, hatch: "diagonal", locked: true });
    expect(markupUnderPoint(m, { x: 50, y: 50 }, 6)).toMatchObject({ area: 10000 });
    const none = square("hn", 100, { fillOpacity: 0, hatch: "none", locked: true });
    expect(markupUnderPoint(none, { x: 50, y: 50 }, 6)).toBe(null);
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

  it("the giant LOCKED UNFILLED boundary is absent from an interior click's stack (so it can't shadow the roads)", () => {
    // The exact reported shape: a huge invisible, LOCKED polygon over smaller FILLED road strips.
    const giant = { id: "giant", kind: "polygon", fillOpacity: 0, locked: true, pts: [{ x: 0, y: 0 }, { x: 5000, y: 0 }, { x: 5000, y: 4000 }, { x: 0, y: 4000 }] };
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

describe("closedMarkupSize / openMarkupLength — NEW-3 (2026-09-07)", () => {
  it("a polygon's area + perimeter come off the SAME ring markupHitModel already builds", () => {
    const m = square("p", 100);
    expect(closedMarkupSize(m)).toMatchObject({ area: 10000, perimeter: 400 });
  });
  it("a cloud (also a plain pts ring) reports the same way as a polygon", () => {
    const m = { id: "c", kind: "cloud", pts: [{ x: 0, y: 0 }, { x: 40, y: 0 }, { x: 40, y: 30 }, { x: 0, y: 30 }] };
    expect(closedMarkupSize(m)).toMatchObject({ area: 1200, perimeter: 140 });
  });
  it("a rect's area + perimeter follow its w/h — rotation doesn't change either", () => {
    const m0 = { id: "r0", kind: "rect", cx: 0, cy: 0, w: 40, h: 20, rot: 0 };
    const m45 = { id: "r45", kind: "rect", cx: 0, cy: 0, w: 40, h: 20, rot: 45 };
    expect(closedMarkupSize(m0)).toMatchObject({ area: 800 });
    expect(closedMarkupSize(m0).perimeter).toBeCloseTo(120, 6);
    expect(closedMarkupSize(m45).area).toBeCloseTo(800, 6);
    expect(closedMarkupSize(m45).perimeter).toBeCloseTo(120, 6);
  });
  it("an ellipse's area is exact (πab); its perimeter is the sampled-ring approximation, close to the true value", () => {
    const m = { id: "e", kind: "ellipse", cx: 0, cy: 0, w: 100, h: 60 }; // a=50, b=30
    const size = closedMarkupSize(m);
    expect(size.area).toBeCloseTo(Math.PI * 50 * 30, 6);
    // Ramanujan's approximation for the true circumference, as an independent check the sampled
    // 48-gon ring is a close stand-in (never the actual formula used — the ring IS the geometry).
    const h = ((50 - 30) / (50 + 30)) ** 2;
    const trueCircumference = Math.PI * (50 + 30) * (1 + (3 * h) / (10 + Math.sqrt(4 - 3 * h)));
    expect(size.perimeter).toBeCloseTo(trueCircumference, 0);
  });
  it("closedMarkupSize is null for an open path or an unknown kind", () => {
    expect(closedMarkupSize({ id: "l", kind: "line", a: { x: 0, y: 0 }, b: { x: 10, y: 0 } })).toBe(null);
    expect(closedMarkupSize({ kind: "mystery" })).toBe(null);
  });
  it("openMarkupLength sums a line's / polyline's segments off the same points the renderer draws", () => {
    const line = { id: "l", kind: "line", a: { x: 0, y: 0 }, b: { x: 30, y: 40 } };
    expect(openMarkupLength(line)).toBeCloseTo(50, 6);
    const poly = { id: "p", kind: "polyline", pts: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }] };
    expect(openMarkupLength(poly)).toBeCloseTo(20, 6);
  });
  it("openMarkupLength is null for a closed kind", () => {
    expect(openMarkupLength(square("p2", 50))).toBe(null);
  });
});

describe("cloud grab reaches the scalloped line (2026-11-25)", () => {
  const sq = { id: "c", kind: "cloud", arcFt: 6, pts: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }] };
  it("an unfilled cloud grabs on an arc crest that bulges past the polygon edge", () => {
    expect(markupUnderPoint(sq, { x: 50, y: -9 }, 4)).not.toBe(null);   // outward bulge
    expect(markupUnderPoint(sq, { x: 50, y: 8 }, 4)).not.toBe(null);    // just inside the edge
  });
  it("still lets clicks through the middle and from well outside (both unfilled)", () => {
    expect(markupUnderPoint(sq, { x: 50, y: 50 }, 4)).toBe(null);
    expect(markupUnderPoint(sq, { x: 50, y: -40 }, 4)).toBe(null);
  });
  it("a filled cloud keeps its whole body", () => {
    expect(markupUnderPoint({ ...sq, fillOpacity: 0.3 }, { x: 50, y: 50 }, 4)).not.toBe(null);
  });
  it("a plain polygon's reach is unchanged", () => {
    expect(markupUnderPoint({ ...sq, kind: "polygon" }, { x: 50, y: -9 }, 4)).toBe(null);
  });
});
