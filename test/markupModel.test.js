import { describe, it, expect } from "vitest";
import { ptsOf, setPts, translate, bboxOfMarkup, boxCorners, minPtsOf, isClosed, sanitizeMarkup, sanitizeMarkups } from "../src/shared/markup/markupModel.js";
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
