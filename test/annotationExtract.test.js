/* annotationExtract — which objects an editable-markup PDF lifts out of the page and which stay printed into it
 * (NEW-1 / NEW-2, 2026-10-19). Runs the real extractor over a fake SVG clone; the ladder it mirrors is
 * lib/paintOrder.js (markup above = rung 6, reference above = 7, callout above = 8, measure above = 9). */
import { describe, it, expect } from "vitest";
import { extractMarkupAnnotations } from "../src/workspaces/site-planner/lib/annotationExtract.js";
import { buildAnnotations } from "../src/workspaces/site-planner/lib/pdfAnnotations.js";
import { h, txt } from "./fixtures/fakeSvgDom.js";
import { VB, PAGE, M0, frame, descriptors as fixtureDescriptors } from "./fixtures/pdfAnnotationsFixture.js";

const f2p = (p) => ({ x: p.x, y: p.y });
const rectNode = (key, x, y, w, hh, extra = {}) => h("g", { "data-feature": key }, h("rect", { x, y, width: w, height: hh, fill: "#16a34a", "fill-opacity": 0.3, stroke: "#16a34a", "stroke-width": 1, ...extra }));
const mkRect = (id, x, y, extra = {}) => rectNode(`markup:${id}`, x, y, 60, 40, extra);
const refNode = (id, x, y, w, hh) => h("g", { "data-feature": `reference:${id}` }, h("image", { x, y, width: w, height: hh, href: "data:," , "data-overlay-id": id }));
const buildingNode = (id, x, y, w, hh) => h("g", { "data-el-id": id, "data-feature": `el:${id}` },
  h("rect", { x, y, width: w, height: hh, fill: "#f3ece1", stroke: "#33302b", "stroke-width": 2 }),
  h("rect", { x: x + 10, y: y + hh - 4, width: 12, height: 4, fill: "#c2c9d2", stroke: "#5b6470", "stroke-width": 0.6 }));
const buildingLabel = (id, x, y, s) => h("g", { "data-label-for": id, "data-feature": `el:${id}` }, txt(s, { x, y, "font-size": 12, fill: "#111", "text-anchor": "middle" }));
const root = (...kids) => h("svg", { viewBox: "0 0 1000 800" }, ...kids);
const markups = (...ms) => ms.map((m) => ({ kind: "rect", ...m }));
const keysOf = (r) => r.descriptors.map((d) => `${d.family}:${d.id}`);

describe("NEW-1 — a drawing markup in its default band stays editable", () => {
  it("(a) a promoted reference drawing above the plan, not overlapping: markup AND measurement lifted", () => {
    const clone = root(
      refNode("r1", 700, 500, 200, 200),
      mkRect("m1", 100, 100),
      h("g", { "data-feature": "measure:0", "data-measure-mode": "line" }, h("polyline", { points: "100,300 300,300", fill: "none", stroke: "#0ea5e9", "stroke-width": 1.2 })),
    );
    const r = extractMarkupAnnotations(clone, { markups: markups({ id: "m1" }), measures: [{ id: "M1", mode: "line" }], f2p });
    expect(keysOf(r)).toEqual(["markup:m1", "measure:M1"]);
    expect(r.flattened).toEqual([]);
  });
  it("(a') even a reference drawing that DOES overlap it does not pin a default-band markup", () => {
    const clone = root(mkRect("m1", 100, 100), refNode("r1", 80, 80, 300, 300));
    const r = extractMarkupAnnotations(clone, { markups: markups({ id: "m1" }), f2p });
    expect(keysOf(r)).toEqual(["markup:m1"]);
  });
  it("(b) a geolocated plan with an EMPTY front band lifts the markup; a populated band does not pin it either", () => {
    const empty = root(mkRect("m1", 100, 100), h("g", { "data-gis-front-band": "1" }, h("foreignObject", { "data-export": "skip" })));
    expect(keysOf(extractMarkupAnnotations(empty, { markups: markups({ id: "m1" }), f2p }))).toEqual(["markup:m1"]);
    const full = root(mkRect("m1", 100, 100), h("g", { "data-gis-front-band": "1" }, h("image", { x: 0, y: 0, width: 1000, height: 800, "data-export-overlay": "1" })));
    expect(keysOf(extractMarkupAnnotations(full, { markups: markups({ id: "m1" }), f2p }))).toEqual(["markup:m1"]);
  });
  it("(c) a markup sent behind the plan stays in the page, even with a building over it", () => {
    const clone = root(mkRect("back", 100, 100), buildingNode("b1", 80, 80, 200, 120), mkRect("front", 600, 100));
    const r = extractMarkupAnnotations(clone, { markups: markups({ id: "back", behindEls: true }, { id: "front" }), els: [], f2p });
    expect(keysOf(r)).toEqual(["markup:front"]);
    expect(r.flattened).toEqual(["markup:back"]);
    expect(clone.querySelectorAll("[data-feature]").map((n) => n.getAttribute("data-feature"))).toEqual(["markup:back", "el:b1"]);
  });
  it("a behind-the-plan callout and measurement are pinned too, and relative order of the lifted ones is DOM order", () => {
    const clone = root(
      h("g", { "data-feature": "callout:c1" }, h("rect", { x: 10, y: 10, width: 50, height: 20, fill: "#fff", stroke: "#334155" })),
      mkRect("a", 300, 300), mkRect("b", 400, 400),
      h("g", { "data-feature": "measure:0", "data-measure-mode": "line" }, h("polyline", { points: "0,0 90,90", fill: "none", stroke: "#0ea5e9", "stroke-width": 1.2 })),
    );
    const r = extractMarkupAnnotations(clone, { markups: markups({ id: "a" }, { id: "b" }), callouts: [{ id: "c1", behindEls: true }], measures: [{ id: "M1", mode: "line" }], f2p });
    expect(r.flattened).toEqual(["callout:c1"]);
    expect(keysOf(r)).toEqual(["markup:a", "markup:b", "measure:M1"]);
  });
  it("a LATER ELEMENT that overlaps a markup still keeps it in the page (the selection-lift case); one that doesn't, doesn't", () => {
    const over = root(mkRect("m1", 100, 100), h("g", { "data-feature": "el:p1" }, h("rect", { x: 120, y: 110, width: 100, height: 100, fill: "#bbb" })));
    const rOver = extractMarkupAnnotations(over, { markups: markups({ id: "m1" }), f2p });
    expect(keysOf(rOver)).toEqual([]); expect(rOver.flattened).toEqual(["markup:m1"]);
    const apart = root(mkRect("m1", 100, 100), h("g", { "data-feature": "el:p1" }, h("rect", { x: 500, y: 500, width: 100, height: 100, fill: "#bbb" })));
    expect(keysOf(extractMarkupAnnotations(apart, { markups: markups({ id: "m1" }), f2p }))).toEqual(["markup:m1"]);
  });
  it("an easement/encumbrance (site data in the markups array) is page content, never lifted", () => {
    const clone = root(rectNode("markup:e1", 100, 100, 80, 40), mkRect("m1", 600, 100));
    const r = extractMarkupAnnotations(clone, { markups: markups({ id: "e1", kind: "easement" }, { id: "m1" }), f2p });
    expect(keysOf(r)).toEqual(["markup:m1"]);
    expect(clone.querySelector("[data-feature]").getAttribute("data-feature")).toBe("markup:e1");
  });
  it("(d) the full fixture still yields one annotation per markup", () => {
    const built = buildAnnotations(fixtureDescriptors, { M0, frame });
    expect(built.annots).toHaveLength(fixtureDescriptors.length);
  });
});

describe("NEW-2 — buildings lift as native Polygon annotations", () => {
  const els = [{ id: "b1", type: "building", cx: 300, cy: 200, w: 200, h: 120, rot: 0 }];
  const clone = () => root(buildingNode("b1", 200, 140, 200, 120), buildingLabel("b1", 300, 200, "Building 1"), mkRect("m1", 600, 100));
  const run = (c, extra = {}) => extractMarkupAnnotations(c, { markups: markups({ id: "m1" }), els, f2p, ...extra });

  it("one building + one markup → two annotations, a 4-vertex Polygon and a Square, building first (paint order)", () => {
    const r = run(clone());
    expect(keysOf(r)).toEqual(["building:b1", "markup:m1"]);
    const built = buildAnnotations(r.descriptors, { M0, frame, patterns: r.patterns });
    expect(built.annots.map((a) => a.subtype)).toEqual(["Polygon", "Square"]);
    const b = built.annots[0];
    expect(b.vertices).toHaveLength(8);
    expect(b.subj).toBe("Building");
    expect(b.contents).toBe("Building 1");
    expect(b.nm).toBe("planyr-building-b1");
    expect(b.ap.bbox.every(Number.isFinite)).toBe(true);
  });
  it("carries the footprint's fill and outline, and its doors + label are in the appearance, not just the outline", () => {
    const r = run(clone());
    const b = buildAnnotations(r.descriptors, { M0, frame, patterns: r.patterns }).annots[0];
    expect(b.ic).toBeTruthy(); expect(b.color).toBeTruthy(); expect(b.bw).toBeGreaterThan(0);
    expect(b.ap.stream).toMatch(/Tj/); // the label text
    expect((b.ap.stream.match(/^B$/gm) || []).length).toBeGreaterThanOrEqual(2); // footprint + a dock door, each filled and stroked
  });
  it("the lifted building's body AND label leave the page content", () => {
    const c = clone(); run(c);
    expect(c.querySelectorAll("[data-feature]").map((n) => n.getAttribute("data-feature"))).toEqual([]);
  });
  it("a polygon building uses its own ring", () => {
    const ring = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 50 }, { x: 40, y: 50 }, { x: 0, y: 90 }];
    const c = root(h("g", { "data-el-id": "p", "data-feature": "el:p" }, h("path", { d: "M0 0L100 0L100 50L40 50L0 90Z", fill: "#f3ece1", stroke: "#33302b", "stroke-width": 2 })));
    const r = extractMarkupAnnotations(c, { els: [{ id: "p", type: "building", points: ring }], f2p });
    const a = buildAnnotations(r.descriptors, { M0, frame }).annots[0];
    expect(a.subtype).toBe("Polygon"); expect(a.vertices).toHaveLength(10);
  });
  it("a road or pond is never lifted", () => {
    const c = root(h("g", { "data-feature": "el:r1" }, h("rect", { x: 0, y: 0, width: 50, height: 50, fill: "#999" })));
    expect(run(c, { els: [{ id: "r1", type: "road" }] }).descriptors).toEqual([]);
  });
  it("a LATER element painted over the building keeps it in the page (the flattened picture's order wins)", () => {
    const c = root(buildingNode("b1", 200, 140, 200, 120), h("g", { "data-feature": "el:lot" }, h("rect", { x: 250, y: 180, width: 300, height: 200, fill: "#bbb", "fill-opacity": 0.9 })));
    const r = run(c);
    expect(keysOf(r)).toEqual([]);
    expect(r.flattened).toEqual(["el:b1"]);
  });
  it("a court that merely TOUCHES the building does not pin it", () => {
    const c = root(buildingNode("b1", 200, 140, 200, 120), h("g", { "data-feature": "el:court" }, h("rect", { x: 200, y: 260, width: 200, height: 130, fill: "#bbb", stroke: "#666", "stroke-width": 1 })));
    expect(keysOf(run(c))).toEqual(["building:b1"]);
  });
  it("a reference drawing or lifted GIS layer over the building pins IT (parity), but an empty GIS band does not", () => {
    const withRef = root(buildingNode("b1", 200, 140, 200, 120), refNode("r", 150, 100, 400, 300));
    expect(run(withRef).flattened).toEqual(["el:b1"]);
    const withGis = root(buildingNode("b1", 200, 140, 200, 120), h("g", { "data-gis-front-band": "1" }, h("image", { x: 0, y: 0, width: 1000, height: 800 })));
    expect(run(withGis).flattened).toEqual(["el:b1"]);
    const emptyGis = root(buildingNode("b1", 200, 140, 200, 120), h("g", { "data-gis-front-band": "1" }, h("foreignObject", { "data-export": "skip" })));
    expect(keysOf(run(emptyGis))).toEqual(["building:b1"]);
  });
  it("a markup sent behind the plan under a building: markup pinned in the page, building lifted over it", () => {
    const c = root(mkRect("back", 220, 150), buildingNode("b1", 200, 140, 200, 120));
    const r = extractMarkupAnnotations(c, { markups: markups({ id: "back", behindEls: true }), els, f2p });
    expect(r.flattened).toEqual(["markup:back"]); expect(keysOf(r)).toEqual(["building:b1"]);
  });
  it("a parcel acreage chip painted over the building travels inside its appearance; one clear of it stays on the page", () => {
    const chip = (id, x, y) => h("g", { "data-print-chip": "acre", "data-feature": `parcel:${id}` }, txt("24.79 AC", { x, y, "font-size": 12, fill: "#111", "text-anchor": "middle" }));
    const c = root(buildingNode("b1", 200, 140, 200, 120), chip("pc1", 300, 200), chip("pc2", 800, 700));
    const r = run(c);
    const built = buildAnnotations(r.descriptors, { M0, frame, patterns: r.patterns });
    expect(built.annots[0].ap.stream).toContain("(24.79 AC) Tj");
    const left = c.querySelectorAll("[data-feature]").map((n) => n.getAttribute("data-feature"));
    expect(left).toEqual(["parcel:pc2"]); // pc1 left the page with the building; pc2 never overlapped it
  });
  it("without the plan's elements there is nothing to lift (callers that pass no els keep the old behaviour)", () => {
    const r = extractMarkupAnnotations(clone(), { markups: markups({ id: "m1" }), f2p });
    expect(keysOf(r)).toEqual(["markup:m1"]);
  });
});
