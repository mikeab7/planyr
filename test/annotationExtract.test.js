/* annotationExtract — which objects an editable-markup PDF lifts out of the page and which stay printed into it
 * (NEW-1 / NEW-2, 2026-10-19). Runs the real extractor over a fake SVG clone; the ladder it mirrors is
 * lib/paintOrder.js (markup above = rung 6, reference above = 7, callout above = 8, measure above = 9). */
import { describe, it, expect } from "vitest";
import { extractMarkupAnnotations } from "../src/workspaces/site-planner/lib/annotationExtract.js";
import { buildAnnotations } from "../src/workspaces/site-planner/lib/pdfAnnotations.js";
import { h, txt, FakeNode } from "./fixtures/fakeSvgDom.js";
const txtNode = (str) => new FakeNode("#text", {}, [], str);
import { VB, PAGE, M0, frame, descriptors as fixtureDescriptors } from "./fixtures/pdfAnnotationsFixture.js";
import { dogEarGeom } from "../src/workspaces/site-planner/lib/dogEar.js";
import { rectCorners } from "../src/workspaces/site-planner/lib/buildingOutline.js";

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

describe("NEW-1 (2026-10-19) — a building and its corner bump-outs are ONE annotation", () => {
  // Fixture: a 500×300 building whose dock wall (bottom) carries the default 55′×60′ bump-out at each end,
  // exactly as the planner stores them (dogEarGeom-derived boxes, `attachedTo` the host) and draws them (their own
  // el: nodes, after the host in creation order). Clone units == feet here (f2p is identity).
  const host = { id: "b1", type: "building", cx: 600, cy: 450, w: 500, h: 300, rot: 0 };
  const bump = (id, sign) => ({ id, type: "building", attachedTo: "b1", noFit: true, noLabel: true, dock: "none", rot: 0, dogEar: { side: "bottom", sign, along: 55, proj: 60 }, w: 55, h: 60, cx: 600 + sign * 222.5, cy: 630 });
  const els = [host, bump("bpL", -1), bump("bpR", 1)];
  const hostNode = () => buildingNode("b1", 350, 300, 500, 300);
  const bumpNode = (id) => { const b = els.find((e) => e.id === id); return h("g", { "data-el-id": id, "data-feature": `el:${id}` }, h("rect", { x: b.cx - b.w / 2, y: b.cy - b.h / 2, width: b.w, height: b.h, fill: "#f3ece1", stroke: "#33302b", "stroke-width": 2 })); };
  const scene = () => root(hostNode(), buildingLabel("b1", 600, 450, "Building 1"), bumpNode("bpL"), bumpNode("bpR"), mkRect("m1", 900, 100));
  const run = (c, extra = {}) => extractMarkupAnnotations(c, { markups: markups({ id: "m1" }), els, f2p, ...extra });
  const left = (c) => c.querySelectorAll("[data-feature]").map((n) => n.getAttribute("data-feature"));

  it("RED-PROOF: one Building descriptor, its Polygon's vertex set covers the bump-outs, and no bump-out ink is left in the page", () => {
    const c = scene();
    const r = run(c);
    expect(keysOf(r)).toEqual(["building:b1", "markup:m1"]);
    expect(left(c)).toEqual([]); // host, label AND both bump-outs left the page content
    const b = buildAnnotations(r.descriptors, { M0, frame, patterns: r.patterns }).annots[0];
    expect(b.subtype).toBe("Polygon"); expect(b.subj).toBe("Building");
    expect(b.vertices).toHaveLength(16); // eight vertices: the outline through both bump-outs
    const ys = b.vertices.filter((_, i) => i % 2 === 1);
    const pdfY = (y) => M0[3] * y + M0[5];
    expect(Math.min(...ys)).toBeCloseTo(pdfY(660), 4); // 630 + 30: the bump-outs' far edge (PDF y runs up)
    expect(Math.max(...ys)).toBeCloseTo(pdfY(300), 4);
    expect(b.rect[1]).toBeLessThanOrEqual(pdfY(660) + 1e-6); // /Rect spans the bump-outs too
    expect(r.descriptors[0].meta.bumpOuts).toEqual(["bpL", "bpR"]);
    expect(b.degraded.some((g) => /bump-out/.test(g))).toBe(false);
  });
  it("the appearance paints the bump-outs: three filled-and-stroked rects (host + two) plus the label", () => {
    const r = run(scene());
    const b = buildAnnotations(r.descriptors, { M0, frame, patterns: r.patterns }).annots[0];
    expect((b.ap.stream.match(/^B$/gm) || []).length).toBeGreaterThanOrEqual(4); // host + door + two bump-outs
    expect(b.ap.stream).toMatch(/Tj/);
    expect(b.ic).toBeTruthy(); expect(b.color).toBeTruthy(); // regeneration inputs still read off the host's footprint
  });
  it("a building with NO bump-outs is unchanged (4 vertices); a bump-out whose host is not drawn stays page content", () => {
    const c = root(hostNode(), mkRect("m1", 900, 100));
    const r = run(c, { els: [host] });
    expect(buildAnnotations(r.descriptors, { M0, frame, patterns: r.patterns }).annots[0].vertices).toHaveLength(8);
    const orphan = root(bumpNode("bpL"), mkRect("m1", 900, 100));
    const r2 = run(orphan);
    expect(keysOf(r2)).toEqual(["markup:m1"]); expect(left(orphan)).toEqual(["el:bpL"]);
  });
  it("a bump-out painted BEFORE its host (Arrange) is still a member; a markup between them is judged against each member at its own position", () => {
    // the markup sits under the host only: lifting the building paints exactly what the page painted → building lifted
    const c = root(bumpNode("bpL"), mkRect("under", 600, 400), hostNode(), bumpNode("bpR"));
    const r = extractMarkupAnnotations(c, { markups: markups({ id: "under", behindEls: true }), els, f2p });
    expect(r.flattened).toEqual(["markup:under"]); expect(keysOf(r)).toEqual(["building:b1"]);
    expect(left(c)).toEqual(["markup:under"]);
    // the markup ALSO lies over the earlier bump-out: a lifted building would paint that bump-out over it → pinned
    const c2 = root(bumpNode("bpL"), mkRect("under", 380, 580), hostNode(), bumpNode("bpR"));
    const r2 = extractMarkupAnnotations(c2, { markups: markups({ id: "under", behindEls: true }), els, f2p });
    expect(r2.flattened).toEqual(["markup:under", "el:b1"]); expect(keysOf(r2)).toEqual([]);
    expect(left(c2)).toEqual(["el:bpL", "markup:under", "el:b1", "el:bpR"]);
  });
  it("two buildings whose members interleave: the annotation order follows the page (A's bump-out over B's host → A written after B)", () => {
    // A: host at 350..850 × 300..600 with bump-outs; B: a building painted between A's host and A's bump-outs, under A's left bump-out
    const B = { id: "b2", type: "building", cx: 300, cy: 700, w: 200, h: 120, rot: 0 };
    const c = root(hostNode(), buildingNode("b2", 200, 640, 200, 120), bumpNode("bpL"), bumpNode("bpR"));
    const r = extractMarkupAnnotations(c, { els: [...els, B], f2p });
    expect(r.flattened).toEqual([]);
    expect(keysOf(r)).toEqual(["building:b2", "building:b1"]); // A's last member paints after B
    // the same two with B's host ALSO over A's host: no annotation order can reproduce the page → both stay in it
    const B2 = { ...B, cx: 400, cy: 620, w: 300, h: 200 };
    const c2 = root(hostNode(), buildingNode("b2", 250, 520, 300, 200), bumpNode("bpL"), bumpNode("bpR"));
    const r2 = extractMarkupAnnotations(c2, { els: [...els, B2], f2p });
    expect(keysOf(r2)).toEqual([]); expect(r2.flattened.sort()).toEqual(["el:b1", "el:b2"]);
  });
  it("later page content over a BUMP-OUT alone pins the whole building (the flattened picture's order wins)", () => {
    const c = root(hostNode(), bumpNode("bpL"), bumpNode("bpR"), h("g", { "data-feature": "el:lot" }, h("rect", { x: 340, y: 640, width: 80, height: 100, fill: "#bbb", "fill-opacity": 0.9 })));
    const r = run(c);
    expect(keysOf(r)).toEqual([]); expect(r.flattened).toEqual(["el:b1"]);
    expect(left(c)).toEqual(["el:b1", "el:bpL", "el:bpR", "el:lot"]); // nothing moved
  });
  it("a truck court flush against a bump-out does not pin it; a parcel chip over a bump-out travels with the building", () => {
    const court = h("g", { "data-feature": "el:court" }, h("rect", { x: 405, y: 600, width: 390, height: 130, fill: "#bbb", stroke: "#666", "stroke-width": 1 }));
    const chip = h("g", { "data-print-chip": "acre", "data-feature": "parcel:pc1" }, txt("24.79 AC", { x: 822, y: 640, "font-size": 12, fill: "#111", "text-anchor": "middle" }));
    const c = root(hostNode(), bumpNode("bpL"), bumpNode("bpR"), court, chip);
    const r = run(c);
    expect(keysOf(r)).toEqual(["building:b1"]);
    expect(buildAnnotations(r.descriptors, { M0, frame, patterns: r.patterns }).annots[0].ap.stream).toContain("(24.79 AC) Tj");
    expect(left(c)).toEqual(["el:court"]);
  });
  it("a rotated building with bump-outs lifts as one Polygon with eight vertices", () => {
    const hr = { ...host, rot: 30 };
    const rb = (id, sign) => { const de = { side: "bottom", sign, along: 55, proj: 60 }; return { ...bump(id, sign), rot: 30, ...dogEarGeom(hr, de) }; };
    const rEls = [hr, rb("bpL", -1), rb("bpR", 1)];
    const poly = (e) => { const cs = rectCorners(e); return h("g", { "data-el-id": e.id, "data-feature": `el:${e.id}` }, h("path", { d: "M" + cs.map((p) => `${p.x} ${p.y}`).join("L") + "Z", fill: "#f3ece1", stroke: "#33302b", "stroke-width": 2 })); };
    const c = root(...rEls.map(poly));
    const r = extractMarkupAnnotations(c, { els: rEls, f2p });
    expect(keysOf(r)).toEqual(["building:b1"]); expect(left(c)).toEqual([]);
    expect(buildAnnotations(r.descriptors, { M0, frame }).annots[0].vertices).toHaveLength(16);
  });
  it("LOUD: a bump-out that does not touch its host is drawn in the appearance but named as outside the vertices", () => {
    const farEls = [host, { ...bump("bpX", 1), cx: 1100, cy: 700 }];
    const c = root(hostNode(), h("g", { "data-feature": "el:bpX" }, h("rect", { x: 1072.5, y: 670, width: 55, height: 60, fill: "#f3ece1", stroke: "#33302b", "stroke-width": 2 })));
    const r = extractMarkupAnnotations(c, { els: farEls, f2p });
    const built = buildAnnotations(r.descriptors, { M0, frame });
    expect(built.annots[0].vertices).toHaveLength(8);
    expect(built.degraded.join(" ")).toMatch(/bump-out\(s\) bpX do not touch/);
  });
});

describe("NEW-1 (2026-10-19) — a stacked label keeps its lines (tspans) in the appearance", () => {
  it("a three-tspan building label becomes three Tj lines at descending baselines, not one run-together string", () => {
    const label = h("g", { "data-label-for": "b1", "data-feature": "el:b1" },
      h("text", { x: 300, y: 190, "font-size": 12, fill: "#111", "text-anchor": "middle" },
        ...["Building 1", "450,000 SF", "900′ × 500′"].map((t, i) => h("tspan", { x: 300, dy: i === 0 ? 0 : 14 }, txtNode(t)))));
    const c = root(buildingNode("b1", 200, 140, 200, 120), label);
    const r = extractMarkupAnnotations(c, { els: [{ id: "b1", type: "building", cx: 300, cy: 200, w: 200, h: 120, rot: 0 }], f2p });
    const ap = buildAnnotations(r.descriptors, { M0, frame, patterns: r.patterns }).annots[0];
    expect((ap.ap.stream.match(/\) Tj/g) || []).length).toBe(3);
    expect(ap.ap.stream).toContain("(Building 1) Tj"); expect(ap.ap.stream).toContain("(450,000 SF) Tj");
    expect(ap.contents).toBe("Building 1");
  });
});
