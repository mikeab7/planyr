import { describe, it, expect } from "vitest";
import {
  styleCapsOf, commonStyleState, selectionRingFeet,
} from "../src/workspaces/site-planner/lib/multiStyle.js";

// Minimal element/markup fixtures.
const bldg = (over = {}) => ({ id: "b1", type: "building", cx: 0, cy: 0, w: 100, h: 60, rot: 0, ...over });
const paving = (over = {}) => ({ id: "p1", type: "paving", cx: 0, cy: 0, w: 40, h: 200, rot: 30, ...over });
const trailer = (over = {}) => ({ id: "t1", type: "trailer", cx: 10, cy: 10, w: 30, h: 120, rot: 30, ...over });
const rectMk = (over = {}) => ({ id: "m1", kind: "rect", cx: 0, cy: 0, w: 20, h: 10, rot: 0, stroke: "#c2410c", weight: 2, dash: "solid", fill: "#c2410c", fillOpacity: 0.3, ...over });
const lineMk = (over = {}) => ({ id: "m2", kind: "line", a: { x: 0, y: 0 }, b: { x: 10, y: 10 }, stroke: "#c2410c", weight: 2, dash: "dashed", ...over });
const M = (item, kind = "el") => ({ item, kind });

describe("styleCapsOf", () => {
  it("an element exposes fill/stroke/fillOpacity only (weight is type-level)", () => {
    expect(styleCapsOf(bldg(), "el").sort()).toEqual(["fill", "fillOpacity", "stroke"]);
  });
  it("a closed markup exposes stroke/weight/dash/fill/fillOpacity", () => {
    expect(styleCapsOf(rectMk(), "markup").sort()).toEqual(["dash", "fill", "fillOpacity", "stroke", "weight"]);
  });
  it("an open markup (line) exposes stroke/weight/dash only", () => {
    expect(styleCapsOf(lineMk(), "markup").sort()).toEqual(["dash", "stroke", "weight"]);
  });
  it("a measure / unknown kind exposes nothing", () => {
    expect(styleCapsOf({ id: "x" }, "measure")).toEqual([]);
  });
});

describe("commonStyleState — uniform vs mixed", () => {
  it("3 elements with the same fill → not mixed, opacity uniform at the default 1", () => {
    const s = commonStyleState([M(bldg({ fill: "#ffffff" })), M(bldg({ id: "b2", fill: "#ffffff" })), M(bldg({ id: "b3", fill: "#ffffff" }))], {});
    expect(s.caps).toEqual(["fillOpacity", "fill", "stroke"]);
    expect(s.props.fill.mixed).toBe(false);
    expect(s.props.fill.value.toLowerCase()).toBe("#ffffff");
    expect(s.props.fillOpacity).toEqual({ value: 1, mixed: false });
  });
  it("elements that disagree on fill → fill is mixed (value undefined)", () => {
    const s = commonStyleState([M(bldg({ fill: "#ffffff" })), M(bldg({ id: "b2", fill: "#000000" }))], {});
    expect(s.props.fill).toEqual({ value: undefined, mixed: true });
  });
  it("hex forms that name the same color are NOT mixed (#abc == #aabbcc)", () => {
    const s = commonStyleState([M(bldg({ stroke: "#abc" })), M(bldg({ id: "b2", stroke: "#aabbcc" }))], {});
    expect(s.props.stroke.mixed).toBe(false);
  });
  it("differing fillOpacity → mixed (the exact restore-all driver: raise them together)", () => {
    const s = commonStyleState([M(bldg({ fillOpacity: 0.3 })), M(paving({ fillOpacity: 0.5 })), M(trailer({ fillOpacity: 1 }))], {});
    expect(s.props.fillOpacity).toEqual({ value: undefined, mixed: true });
  });
});

describe("commonStyleState — mixed types intersect capabilities", () => {
  it("building + trailer + paving → caps are fill/stroke/fillOpacity", () => {
    const s = commonStyleState([M(bldg()), M(trailer()), M(paving())], {});
    expect(s.caps).toEqual(["fillOpacity", "fill", "stroke"]);
  });
  it("el + closed markup → weight/dash dropped, fill/stroke/fillOpacity shared", () => {
    const s = commonStyleState([M(bldg()), M(rectMk(), "markup")], {});
    expect(s.caps).toEqual(["fillOpacity", "fill", "stroke"]);
    expect(s.caps).not.toContain("weight");
    expect(s.caps).not.toContain("dash");
  });
  it("el + open markup (line) → only stroke is shared", () => {
    const s = commonStyleState([M(bldg()), M(lineMk(), "markup")], {});
    expect(s.caps).toEqual(["stroke"]);
  });
  it("closed markup + open markup → stroke/weight/dash shared", () => {
    const s = commonStyleState([M(rectMk(), "markup"), M(lineMk(), "markup")], {});
    expect(s.caps).toEqual(["stroke", "weight", "dash"]);
  });
  it("a measure in the set collapses the common caps to nothing", () => {
    const s = commonStyleState([M(bldg()), M({ id: "z" }, "measure")], {});
    expect(s.caps).toEqual([]);
  });
});

describe("commonStyleState — edges", () => {
  it("empty selection → empty caps/props", () => {
    expect(commonStyleState([], {})).toEqual({ caps: [], props: {} });
  });
  it("null members are ignored", () => {
    const s = commonStyleState([null, M(bldg()), { item: null, kind: "el" }], {});
    expect(s.caps).toEqual(["fillOpacity", "fill", "stroke"]);
  });
});

describe("selectionRingFeet — rotation-aware outline", () => {
  it("a rotated rect element returns its four rotated corners (OBB, not an upright box)", () => {
    const r = selectionRingFeet(paving({ cx: 0, cy: 0, w: 40, h: 200, rot: 30 }), "el");
    expect(r.closed).toBe(true);
    expect(r.pts).toHaveLength(4);
    // rot=30 means no corner lies on an axis-aligned rectangle of the same center — verify
    // at least one corner has both coords off the unrotated extents.
    const unrot = [{ x: -20, y: -100 }, { x: 20, y: -100 }, { x: 20, y: 100 }, { x: -20, y: 100 }];
    const anyRotated = r.pts.some((p, i) => Math.abs(p.x - unrot[i].x) > 1 && Math.abs(p.y - unrot[i].y) > 1);
    expect(anyRotated).toBe(true);
  });
  it("a polygon element returns its ring", () => {
    const poly = { id: "pg", type: "paving", points: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 5, y: 8 }] };
    const r = selectionRingFeet(poly, "el");
    expect(r).toEqual({ pts: poly.points, closed: true });
  });
  it("a centerline road returns its centerline as an open polyline (no box)", () => {
    const road = { id: "rd", type: "road", pts: [{ x: 0, y: 0 }, { x: 50, y: 0 }, { x: 80, y: 30 }] };
    const r = selectionRingFeet(road, "el");
    expect(r).toEqual({ pts: road.pts, closed: false });
  });
  it("a centre-box markup returns rotated corners; a line returns its endpoints (open)", () => {
    expect(selectionRingFeet(rectMk(), "markup").closed).toBe(true);
    const l = selectionRingFeet(lineMk(), "markup");
    expect(l.closed).toBe(false);
    expect(l.pts).toHaveLength(2);
  });
  it("returns null for an unstyleable / empty item", () => {
    expect(selectionRingFeet(null, "el")).toBe(null);
    expect(selectionRingFeet({ id: "z" }, "measure")).toBe(null);
  });
});
