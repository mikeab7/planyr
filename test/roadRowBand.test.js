import { describe, it, expect } from "vitest";
import {
  makeXSection, xsectionFromRoad, designatedRowSides, designatedRowFt, rowShiftOf, withRowSide, withRowSides, withRowWidth, rowMarginsBySide, rowMarginFt,
} from "../src/workspaces/site-planner/lib/roadCrossSection.js";
import { roadRowGeometry, rowSideLine, rowBandRing, rowSideMinFt, signedOffsetFrom, rowSideCompass } from "../src/workspaces/site-planner/lib/roadRowBand.js";
import { TYPE, typeStyle } from "../src/workspaces/site-planner/lib/planStyle.js";
import { ELEMENT_DEFAULT_PAINT } from "../src/shared/theme/familyInk.js";

const line = (a, b, n = 10) => Array.from({ length: n + 1 }, (_, i) => ({ x: a.x + (b.x - a.x) * i / n, y: a.y + (b.y - a.y) * i / n }));
const plain = (travelW = 24, row = 60, shift) => ({ id: "r1", type: "road", travelW, xsection: makeXSection([{ type: "travel", w: travelW }], row, shift) });

describe("uneven right-of-way: storage", () => {
  it("an old plan (no shift) is centred, exactly as before", () => {
    const x = makeXSection([{ type: "travel", w: 24 }], 100);
    expect(x.rowShiftFt).toBeUndefined();
    expect(designatedRowSides(x)).toEqual({ left: 50, right: 50 });
    expect(rowMarginsBySide(x)).toEqual({ left: 38, right: 38 });
  });
  it("setting one side moves only that line; the width follows", () => {
    const x0 = makeXSection([{ type: "travel", w: 24 }], 100);
    const x = withRowSide(x0, 1, 70);
    expect(designatedRowSides(x)).toEqual({ left: 70, right: 50 });
    expect(designatedRowFt(x)).toBe(120);
    const y = withRowSide(x, -1, 30);
    expect(designatedRowSides(y)).toEqual({ left: 70, right: 30 });
  });
  it("a new width keeps the shift (each side moves half the change)", () => {
    const x = withRowSides(makeXSection([{ type: "travel", w: 24 }], 100), 70, 30);
    const y = withRowWidth(x, 120);
    expect(designatedRowSides(y)).toEqual({ left: 80, right: 40 });
  });
  it("clearing the width removes both keys (presence is the signal)", () => {
    const x = withRowSides(makeXSection([{ type: "travel", w: 24 }], 100), 70, 30);
    const y = withRowWidth(x, null);
    expect("rowDesignFt" in y).toBe(false);
    expect("rowShiftFt" in y).toBe(false);
    expect(designatedRowSides(y)).toBeNull();
  });
  it("a centred pair stores no shift; never a stored 0", () => {
    const x = withRowSides(makeXSection([{ type: "travel", w: 24 }], 80), 50, 50);
    expect("rowShiftFt" in x).toBe(false);
    expect(rowShiftOf(x)).toBe(0);
  });
  it("the shift survives a round trip through the dialog's wrapper", () => {
    const el = { type: "road", travelW: 24, xsection: withRowSides(makeXSection([{ type: "travel", w: 24 }], 100), 65, 35) };
    expect(designatedRowSides(xsectionFromRoad(el))).toEqual({ left: 65, right: 35 });
  });
  it("a shift that would cross the centerline is held at the centerline", () => {
    const x = makeXSection([{ type: "travel", w: 24 }], 40, 99);
    expect(designatedRowSides(x).right).toBe(0);
    expect(rowMarginFt(x)).toBeNull(); // right line inside the pavement: the invalid, loud state — nothing draws
  });
  it("garbage input leaves the section unchanged", () => {
    const x = makeXSection([{ type: "travel", w: 24 }], 100);
    expect(withRowSides(x, -1, 5)).toBe(x);
    expect(withRowSides(x, NaN, 5)).toBe(x);
  });
});

describe("the ROW floor and the drag arithmetic", () => {
  it("a plain road's side can never go inside its back of curb", () => {
    expect(rowSideMinFt(plain(24), 1)).toBeCloseTo(12.5);
    expect(rowSideMinFt({ ...plain(24), curb: 1 }, -1)).toBeCloseTo(13);
  });
  it("a designed section's side can never go inside its outermost band on that side", () => {
    const el = { type: "road", travelW: 24, xsection: makeXSection([{ type: "sidewalk", w: 6 }, { type: "travel", w: 12 }, { type: "travel", w: 12 }], 80) };
    expect(rowSideMinFt(el, 1)).toBeCloseTo(18);   // 12 (half the curb-to-curb) + 6 sidewalk on the left
    expect(rowSideMinFt(el, -1)).toBeCloseTo(12.5); // right side: back of curb
  });
  it("signed offset: + is the left side, in both directions of travel", () => {
    const east = line({ x: 0, y: 0 }, { x: 100, y: 0 });
    // y grows DOWN the screen; the left normal of an east-running road points +y
    expect(signedOffsetFrom(east, { x: 40, y: 30 })).toBeCloseTo(30);
    expect(signedOffsetFrom(east, { x: 40, y: -20 })).toBeCloseTo(-20);
    const west = line({ x: 100, y: 0 }, { x: 0, y: 0 });
    expect(signedOffsetFrom(west, { x: 40, y: 30 })).toBeCloseTo(-30);
  });
  it("names each side by the compass, from the road's direction", () => {
    const east = line({ x: 0, y: 0 }, { x: 100, y: 0 });
    expect(rowSideCompass(east, 1)).toBe("South");
    expect(rowSideCompass(east, -1)).toBe("North");
    const south = line({ x: 0, y: 0 }, { x: 0, y: 100 });
    expect(rowSideCompass(south, 1)).toBe("West");
    expect(rowSideCompass(south, -1)).toBe("East");
    const nw = line({ x: 0, y: 0 }, { x: -100, y: -80 });
    expect(new Set([rowSideCompass(nw, 1), rowSideCompass(nw, -1)]).size).toBe(2);
  });
});

describe("ROW geometry (lines + band)", () => {
  const net = (roads, dense) => roadRowGeometry({ roads, denseOf: (r) => dense[r.id], taperOf: () => undefined, pavingOf: () => null });

  it("a straight road: two lines at each side's own distance, a band between", () => {
    const r = { ...plain(24, 100, 10), id: "a" };     // left 60, right 40
    const g = net([r], { a: line({ x: 0, y: 0 }, { x: 200, y: 0 }) }).get("a");
    expect(g.lineL.every((p) => Math.abs(p.y - 60) < 1e-6)).toBe(true);
    expect(g.lineR.every((p) => Math.abs(p.y + 40) < 1e-6)).toBe(true);
    expect(g.band.length).toBe(g.lineL.length + g.lineR.length);
    expect(g.linesL).toHaveLength(1);
  });
  it("a curved road: every line point keeps its distance from the arc", () => {
    const arc = Array.from({ length: 41 }, (_, i) => { const t = i / 40 * Math.PI / 2; return { x: 400 * Math.sin(t), y: 400 * (1 - Math.cos(t)) }; });
    const r = { ...plain(24, 80), id: "c" };
    const g = net([r], { c: arc }).get("c");
    const C = { x: 0, y: 400 };   // the arc's centre
    for (const p of g.lineL.slice(1, -1)) expect(Math.abs(Math.hypot(p.x - C.x, p.y - C.y) - 360)).toBeLessThan(0.5);
    for (const p of g.lineR.slice(1, -1)) expect(Math.abs(Math.hypot(p.x - C.x, p.y - C.y) - 440)).toBeLessThan(0.5);
  });
  it("no designated ROW, or an invalid one, draws nothing", () => {
    const none = { id: "n", type: "road", travelW: 24, xsection: makeXSection([{ type: "travel", w: 24 }]) };
    const bad = { id: "b", type: "road", travelW: 24, xsection: makeXSection([{ type: "travel", w: 24 }], 10) };
    const m = net([none, bad, { id: "z", type: "road", travelW: 24 }], { n: line({ x: 0, y: 0 }, { x: 99, y: 0 }), b: line({ x: 0, y: 0 }, { x: 99, y: 0 }), z: line({ x: 0, y: 0 }, { x: 99, y: 0 }) });
    expect(m.size).toBe(0);
  });
  it("crossing ROWs: each road's ROW line stops at the other road's band (a plat's intersection)", () => {
    const a = { ...plain(24, 60), id: "a" };   // east-west
    const b = { ...plain(24, 60), id: "b" };   // north-south through the middle
    const m = net([a, b], { a: line({ x: -200, y: 0 }, { x: 200, y: 0 }, 40), b: line({ x: 0, y: -200 }, { x: 0, y: 200 }, 40) });
    const ga = m.get("a"), gb = m.get("b");
    // each line is cut into two pieces either side of the other road's 60 ft band
    expect(ga.linesL.length).toBe(2);
    expect(gb.linesR.length).toBe(2);
    for (const seg of [...ga.linesL, ...ga.linesR]) for (const p of seg) expect(Math.abs(p.x)).toBeGreaterThanOrEqual(30 - 1e-3);
    // the band itself is NOT cut: the two bands overlap and paint as one ground
    expect(ga.band.length).toBeGreaterThan(4);
  });
  it("a road without a ROW still interrupts a neighbour's ROW line with its pavement", () => {
    const a = { ...plain(24, 60), id: "a" };
    const drive = { id: "d", type: "road", travelW: 24 };
    const paving = [{ x: -13, y: -100 }, { x: 13, y: -100 }, { x: 13, y: 100 }, { x: -13, y: 100 }];
    const m = roadRowGeometry({ roads: [a, drive], denseOf: (r) => (r.id === "a" ? line({ x: -200, y: 0 }, { x: 200, y: 0 }, 40) : line({ x: 0, y: -100 }, { x: 0, y: 100 })), taperOf: () => undefined, pavingOf: (r) => (r.id === "d" ? paving : null) });
    expect(m.get("a").linesL.length).toBe(2);
    expect(m.has("d")).toBe(false);
  });
  it("rowSideLine / rowBandRing refuse degenerate input", () => {
    expect(rowSideLine([], undefined, 10, 1)).toBeNull();
    expect(rowSideLine(line({ x: 0, y: 0 }, { x: 10, y: 0 }), undefined, 0, 1)).toBeNull();
    expect(rowBandRing(null, [{ x: 0, y: 0 }, { x: 1, y: 0 }])).toBeNull();
  });
});

describe("the Right-of-way colour row (Standards → Colors)", () => {
  it("is a real standard: built-in, mirrored in the ink table, overridable per plan", () => {
    expect(TYPE.rightOfWay.label).toBe("Right-of-way");
    expect(ELEMENT_DEFAULT_PAINT.rightOfWay).toEqual([TYPE.rightOfWay.fill, TYPE.rightOfWay.stroke]);
    expect(typeStyle("rightOfWay", { typeStyles: { rightOfWay: { fill: "#ffffff" } } }).fill).toBe("#ffffff");
  });
  it("the band reads against the road: clearly lighter than the road fill", () => {
    const lum = (h) => { const n = parseInt(h.slice(1), 16); return 0.2126 * (n >> 16) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255); };
    expect(lum(TYPE.rightOfWay.fill) - lum(TYPE.road.fill)).toBeGreaterThan(40);
    expect(TYPE.rightOfWay.fill).not.toBe(TYPE.landscape.fill);
    expect(TYPE.rightOfWay.fill).not.toBe(TYPE.sidewalk.fill);
  });
});
