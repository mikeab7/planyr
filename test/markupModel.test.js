import { describe, it, expect } from "vitest";
import { ptsOf, setPts, translate, bboxOfMarkup, boxCorners, minPtsOf, isClosed, sanitizeMarkup, sanitizeMarkups, calloutParts, addCalloutLeader, removeCalloutLeader } from "../src/shared/markup/markupModel.js";
import { rollup } from "../src/shared/markup/measure.js";

/* B423 / NEW-2 — the model reconciles the two host storage forms (Site Planner's { a, b }
 * line and centre-box; Document Review's flat `pts`) so shared code reads any markup. */

describe("ptsOf — normalizes every host form to a vertex list", () => {
  it("Document Review flat pts pass through", () => {
    const m = { kind: "polygon", pts: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }] };
    expect(ptsOf(m)).toHaveLength(3);
  });
  it("a Site Planner { a, b } line becomes [a, b]", () => {
    expect(ptsOf({ kind: "line", a: { x: 0, y: 0 }, b: { x: 4, y: 3 } })).toEqual([{ x: 0, y: 0 }, { x: 4, y: 3 }]);
  });
  it("a Site Planner centre-box yields its 4 rotated corners", () => {
    const box = { kind: "rect", cx: 10, cy: 10, w: 4, h: 2, rot: 0 };
    const c = ptsOf(box);
    expect(c).toHaveLength(4);
    expect(boxCorners(box)[0]).toEqual({ x: 8, y: 9 }); // -hw,-hh
  });
  it("empty / unknown geometry is [] (never throws)", () => {
    expect(ptsOf({ kind: "text" })).toEqual([]);
    expect(ptsOf(null)).toEqual([]);
  });
});

describe("setPts / translate", () => {
  it("setPts writes back in the line's a/b form", () => {
    const out = setPts({ kind: "line", a: { x: 0, y: 0 }, b: { x: 1, y: 1 } }, [{ x: 2, y: 2 }, { x: 3, y: 3 }]);
    expect(out.a).toEqual({ x: 2, y: 2 });
    expect(out.b).toEqual({ x: 3, y: 3 });
  });
  it("setPts writes a flat pts array for the pts form", () => {
    const out = setPts({ kind: "polyline", pts: [{ x: 0, y: 0 }] }, [{ x: 5, y: 5 }]);
    expect(out.pts).toEqual([{ x: 5, y: 5 }]);
  });
  it("translate moves pts, a/b, and a centre-box centre by the same delta", () => {
    expect(translate({ kind: "polyline", pts: [{ x: 0, y: 0 }] }, 3, 4).pts[0]).toEqual({ x: 3, y: 4 });
    const line = translate({ kind: "line", a: { x: 0, y: 0 }, b: { x: 1, y: 1 } }, 1, 1);
    expect(line.a).toEqual({ x: 1, y: 1 });
    const box = translate({ kind: "rect", cx: 10, cy: 10, w: 2, h: 2 }, -5, 5);
    expect([box.cx, box.cy]).toEqual([5, 15]);
  });
});

describe("bbox / minPts / isClosed", () => {
  it("bboxOfMarkup wraps any form", () => {
    expect(bboxOfMarkup({ kind: "polygon", pts: [{ x: 0, y: 0 }, { x: 10, y: 4 }] })).toEqual({ x: 0, y: 0, w: 10, h: 4 });
  });
  it("minPtsOf: rings need 3, lines need 2, markers need 1", () => {
    expect(minPtsOf("polygon")).toBe(3);
    expect(minPtsOf("line")).toBe(2);
    expect(minPtsOf("count")).toBe(1);
  });
  it("isClosed delegates to the matrix", () => {
    expect(isClosed("polygon")).toBe(true);
    expect(isClosed("line")).toBe(false);
  });
});

describe("sanitizeMarkup — load-path validation (moved from takeoff)", () => {
  it("drops non-finite points and fills text", () => {
    const m = sanitizeMarkup({ kind: "polyline", pts: [{ x: 1, y: 2 }, { x: NaN, y: 5 }, { x: null, y: 0 }] });
    expect(m.pts).toEqual([{ x: 1, y: 2 }]);
  });
  it("a missing kind is unsalvageable → null, and sanitizeMarkups filters it", () => {
    expect(sanitizeMarkup({ pts: [] })).toBe(null);
    expect(sanitizeMarkups([{ kind: "text" }, { pts: [] }, null])).toHaveLength(1);
  });
});

describe("callout N-leader model (B909/NEW-2) — pts = [...tips, box]", () => {
  it("a legacy 2-point [tip, box] callout reads as exactly ONE leader — zero migration needed", () => {
    const legacy = { kind: "callout", pts: [{ x: 10, y: 10 }, { x: 50, y: 50 }], text: "hi" };
    const { tips, box } = calloutParts(legacy);
    expect(tips).toEqual([{ x: 10, y: 10 }]);
    expect(box).toEqual({ x: 50, y: 50 });
  });
  it("a single-point callout is box-only (no leader) — the plain-text-label case", () => {
    const boxOnly = { kind: "callout", pts: [{ x: 5, y: 5 }], text: "note" };
    const { tips, box } = calloutParts(boxOnly);
    expect(tips).toEqual([]);
    expect(box).toEqual({ x: 5, y: 5 });
  });
  it("an empty/degenerate callout has no box", () => {
    expect(calloutParts({ kind: "callout", pts: [] })).toEqual({ tips: [], box: null });
  });

  it("addCalloutLeader inserts a new tip while keeping the box LAST", () => {
    const c = { kind: "callout", pts: [{ x: 0, y: 0 }, { x: 100, y: 100 }], text: "t" };
    const c2 = addCalloutLeader(c, { x: 20, y: 20 });
    expect(c2.pts).toEqual([{ x: 0, y: 0 }, { x: 20, y: 20 }, { x: 100, y: 100 }]);
    const c3 = addCalloutLeader(c2, { x: 30, y: 30 });
    const { tips, box } = calloutParts(c3);
    expect(tips).toHaveLength(3);
    expect(box).toEqual({ x: 100, y: 100 });
  });
  it("addCalloutLeader on a box-only callout gives it its first leader", () => {
    const c = addCalloutLeader({ kind: "callout", pts: [{ x: 5, y: 5 }], text: "" }, { x: 40, y: 40 });
    expect(calloutParts(c)).toEqual({ tips: [{ x: 40, y: 40 }], box: { x: 5, y: 5 } });
  });

  it("removeCalloutLeader drops the leader at that index, box unaffected", () => {
    const c = { kind: "callout", pts: [{ x: 1, y: 1 }, { x: 2, y: 2 }, { x: 3, y: 3 }, { x: 9, y: 9 }], text: "" };
    const c2 = removeCalloutLeader(c, 1); // drop the middle leader ({2,2})
    expect(calloutParts(c2)).toEqual({ tips: [{ x: 1, y: 1 }, { x: 3, y: 3 }], box: { x: 9, y: 9 } });
  });
  it("removing the LAST remaining leader leaves a plain box-only label (Bluebeam default)", () => {
    const c = { kind: "callout", pts: [{ x: 1, y: 1 }, { x: 9, y: 9 }], text: "hi" };
    const c2 = removeCalloutLeader(c, 0);
    expect(calloutParts(c2)).toEqual({ tips: [], box: { x: 9, y: 9 } });
  });
  it("removeCalloutLeader is a no-op for an out-of-range index (incl. the box's own slot)", () => {
    const c = { kind: "callout", pts: [{ x: 1, y: 1 }, { x: 9, y: 9 }], text: "hi" };
    expect(removeCalloutLeader(c, 1)).toBe(c); // index 1 IS the box, not a tip
    expect(removeCalloutLeader(c, 5)).toBe(c);
    expect(removeCalloutLeader(c, -1)).toBe(c);
  });

  it("reload-from-serialized round-trip: JSON stringify/parse preserves every leader", () => {
    let c = { id: "co1", kind: "callout", pts: [{ x: 5, y: 5 }], text: "note" };
    c = addCalloutLeader(c, { x: 10, y: 10 });
    c = addCalloutLeader(c, { x: 20, y: 5 });
    c = addCalloutLeader(c, { x: 15, y: 30 });
    const reloaded = sanitizeMarkup(JSON.parse(JSON.stringify(c)));
    expect(reloaded.pts).toEqual(c.pts);
    expect(calloutParts(reloaded).tips).toHaveLength(3);
  });
});

/* B919 multi-leader map port — the Site Planner's OWN callouts collection persists as
 * { tip|tips, box, noLeader? } with NO `.kind` field at all (it's a sibling array, never a
 * markups entry). ptsOf/setPts must recognize this shape too, so calloutParts/addCalloutLeader/
 * removeCalloutLeader work UNCHANGED on a real Site Planner callout object — reused, not forked. */
describe("Site Planner { tip|tips, box } callout shape (usesTipBox, B919)", () => {
  it("a legacy single-tip callout (no kind field) reads as one leader", () => {
    const c = { id: "c1", tip: { x: 0, y: 0 }, box: { x: 10, y: 10 }, text: "hi" };
    expect(ptsOf(c)).toEqual([{ x: 0, y: 0 }, { x: 10, y: 10 }]);
    expect(calloutParts(c)).toEqual({ tips: [{ x: 0, y: 0 }], box: { x: 10, y: 10 } });
  });
  it("a noLeader text box (no tip) reads as box-only", () => {
    const c = { id: "c2", box: { x: 10, y: 10 }, noLeader: true, text: "label" };
    expect(ptsOf(c)).toEqual([{ x: 10, y: 10 }]);
    expect(calloutParts(c)).toEqual({ tips: [], box: { x: 10, y: 10 } });
  });
  it("an existing tips[] array (N leaders) reads through directly", () => {
    const c = { id: "c3", tips: [{ x: 0, y: 0 }, { x: 5, y: 5 }], box: { x: 10, y: 10 }, text: "hi" };
    expect(calloutParts(c).tips).toHaveLength(2);
  });
  it("addCalloutLeader on a legacy single-tip callout produces a tips[] array, drops the singular tip", () => {
    const c = { id: "c1", tip: { x: 0, y: 0 }, box: { x: 10, y: 10 }, text: "hi" };
    const c2 = addCalloutLeader(c, { x: 20, y: 0 });
    expect(c2.tip).toBeUndefined();
    expect(c2.tips).toEqual([{ x: 0, y: 0 }, { x: 20, y: 0 }]);
    expect(c2.noLeader).toBe(false);
    expect(c2.box).toEqual({ x: 10, y: 10 }); // box untouched
  });
  it("addCalloutLeader on a noLeader text box turns it into a single-tip callout", () => {
    const c = { id: "c2", box: { x: 10, y: 10 }, noLeader: true, text: "label" };
    const c2 = addCalloutLeader(c, { x: 0, y: 0 });
    expect(c2.tip).toEqual({ x: 0, y: 0 });
    expect(c2.tips).toBeUndefined();
    expect(c2.noLeader).toBe(false);
  });
  it("removeCalloutLeader from tips[] down to 1 collapses back to the singular `tip` field", () => {
    const c = { id: "c3", tips: [{ x: 0, y: 0 }, { x: 5, y: 5 }], box: { x: 10, y: 10 }, text: "hi" };
    const c2 = removeCalloutLeader(c, 1);
    expect(c2.tip).toEqual({ x: 0, y: 0 });
    expect(c2.tips).toBeUndefined();
  });
  it("removeCalloutLeader down to zero sets noLeader:true and clears tip/tips (Bluebeam default)", () => {
    const c = { id: "c1", tip: { x: 0, y: 0 }, box: { x: 10, y: 10 }, text: "hi" };
    const c2 = removeCalloutLeader(c, 0);
    expect(c2.noLeader).toBe(true);
    expect(c2.tip).toBeUndefined();
    expect(c2.tips).toBeUndefined();
    expect(c2.box).toEqual({ x: 10, y: 10 });
  });
  it("translate moves the box and every tip together", () => {
    const c = { id: "c3", tips: [{ x: 0, y: 0 }, { x: 5, y: 5 }], box: { x: 10, y: 10 }, text: "hi" };
    const moved = translate(c, 100, -50);
    expect(moved.box).toEqual({ x: 110, y: -40 });
    expect(moved.tips).toEqual([{ x: 100, y: -50 }, { x: 105, y: -45 }]);
  });
  it("bboxOfMarkup covers every tip and the box", () => {
    const c = { id: "c3", tips: [{ x: -5, y: 0 }, { x: 5, y: 20 }], box: { x: 10, y: 10 }, text: "hi" };
    const bb = bboxOfMarkup(c);
    expect(bb.x).toBe(-5);
    expect(bb.y).toBe(0);
  });
});

describe("rollup — generalized unit-scale seam", () => {
  const dist10 = { kind: "distance", page: 1, pts: [{ x: 0, y: 0 }, { x: 10, y: 0 }] };
  it("accepts a calByPage OBJECT (legacy Document Review form)", () => {
    expect(rollup([dist10], { 1: 2 }).distFt).toBe(20); // 10 units × 2 ft/unit
  });
  it("accepts a calForMarkup FUNCTION (Site Planner passes () => 1)", () => {
    expect(rollup([dist10], () => 1).distFt).toBe(10);  // feet-native
  });
  it("counts a polylength run into the distance total", () => {
    const poly = { kind: "polylength", page: 1, pts: [{ x: 0, y: 0 }, { x: 3, y: 0 }, { x: 3, y: 4 }] };
    expect(rollup([poly], () => 1).distFt).toBe(7);
  });
});
