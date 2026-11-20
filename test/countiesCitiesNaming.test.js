/* NEW-1 (owner 2026-11-05, Academy › Concept A) — Counties & Cities carry identifying information.
 *
 * Reproduced live on planyr.io before the fix: every city outline the same blue; at working zoom (15) the layer printed NO names at all (city labels switched off above 13,
 * county above 14, each placed at a polygon centre that is off screen once the polygon is bigger than the view); neighbouring cities indistinguishable; a click on the planner
 * canvas answered nothing; a county label cut off at the edge. Each block below fails on that behaviour. Pure modules only — the live read is ui-audit/verify-counties-cities-live. */
import { describe, it, expect } from "vitest";
import { createColorBook, colorFeatures, placeKey, placeStyle } from "../src/workspaces/site-planner/lib/boundaryPaint.js";
import { viewAnchors, placeNames, labelFontPx, clipRingToRect } from "../src/workspaces/site-planner/lib/placeLabelAnchors.js";
import { countyLineLabels } from "../src/workspaces/site-planner/lib/countyLineLabels.js";
import { placeLabelZoom, VECTOR_SOURCES } from "../src/workspaces/site-planner/lib/vectorLayers.js";
import { boundaryRoleOf, combineJurisdictionHits, foldBoundaryItems } from "../src/workspaces/site-planner/lib/jurisdictionCard.js";
import { limitLineFlags, limitLineNote } from "../src/workspaces/site-planner/lib/limitLineFlags.js";
import { PLACE_PALETTE, ETJ_LINE_WEIGHT, CITY_LINE_MIN_WEIGHT, CITY_TINT_OPACITY, ETJ_TINT_OPACITY } from "../src/workspaces/site-planner/lib/boundaryStyle.js";
import { labelsVisible } from "../src/workspaces/site-planner/lib/boundaryLabels.js";

const sq = (x, y, w = 0.1, h = 0.1) => ({ type: "Polygon", coordinates: [[[x, y], [x + w, y], [x + w, y + h], [x, y + h], [x, y]]] });

describe("each city has its OWN colour; neighbours never share one", () => {
  const names = ["Sugar Land", "Missouri City", "Stafford", "Houston", "Richmond", "Rosenberg", "Meadows Place"];
  // a chain of overlapping bounding boxes: every city is a neighbour of the next
  const fc = { features: names.map((n, i) => ({ properties: { n }, geometry: sq(i * 0.08, 0) })) };
  it("assigns neighbouring cities different hues from the palette", () => {
    const book = createColorBook();
    colorFeatures(fc, (f) => f.properties.n, book);
    for (let i = 0; i + 1 < names.length; i++) {
      const a = book.colorOf(placeKey(names[i])), b = book.colorOf(placeKey(names[i + 1]));
      expect(PLACE_PALETTE).toContain(a);
      expect(a).not.toBe(b);
    }
  });
  it("a place keeps its hue when more places load around it (panning never recolours)", () => {
    const book = createColorBook();
    colorFeatures({ features: fc.features.slice(0, 3) }, (f) => f.properties.n, book);
    const before = names.slice(0, 3).map((n) => book.colorOf(placeKey(n)));
    colorFeatures(fc, (f) => f.properties.n, book);
    expect(names.slice(0, 3).map((n) => book.colorOf(placeKey(n)))).toEqual(before);
  });
  it("a city and its ETJ share one hue (same key), limits bold + stronger tint, ETJ thinner + dashed + fainter", () => {
    const book = createColorBook();
    colorFeatures({ features: [{ properties: { n: "Sugar Land" }, geometry: sq(0, 0) }] }, (f) => f.properties.n, book);
    const city = placeStyle("city", "Sugar Land", { book }), etj = placeStyle("etj", "Sugar Land ETJ", { book });
    expect(placeKey("Sugar Land ETJ")).toBe(placeKey("City of Sugar Land"));
    expect(etj.color).toBe(city.color);
    expect(city.weight).toBe(CITY_LINE_MIN_WEIGHT);
    expect(etj.weight).toBe(ETJ_LINE_WEIGHT);
    expect(city.weight).toBeGreaterThan(etj.weight);
    expect(city.dashArray).toBeUndefined();
    expect(etj.dashArray).toBeTruthy();
    expect(city.fillOpacity).toBe(CITY_TINT_OPACITY);
    expect(etj.fillOpacity).toBe(ETJ_TINT_OPACITY);
    expect(city.fillOpacity).toBeGreaterThan(etj.fillOpacity);
  });
});

describe("a city's name is on screen at EVERY zoom, in the part of its polygon you can see", () => {
  const W = 1000, H = 800;
  const project = (lng, lat) => ({ x: (lng + 95.7) * 10000, y: (29.65 - lat) * 10000 });
  // a city much bigger than the view (working zoom), a small one near the right edge, one wholly off screen
  const BIG = { properties: { n: "Sugar Land" }, geometry: { type: "Polygon", coordinates: [[[-95.8, 29.7], [-95.5, 29.7], [-95.5, 29.5], [-95.8, 29.5], [-95.8, 29.7]]] } };
  const SMALL = { properties: { n: "Stafford" }, geometry: { type: "Polygon", coordinates: [[[-95.605, 29.6], [-95.595, 29.6], [-95.595, 29.605], [-95.605, 29.605], [-95.605, 29.6]]] } };
  const GONE = { properties: { n: "Elsewhere" }, geometry: sq(-94, 28.9) };
  const run = (feats) => viewAnchors(feats, { nameOf: (f) => f.properties.n, project, viewW: W, viewH: H });
  it("labels a polygon that is bigger than the view — the old centre anchor was off screen", () => {
    const a = run([BIG]);
    expect(a).toHaveLength(1);
    expect(a[0].x).toBeGreaterThan(0); expect(a[0].x).toBeLessThan(W);
    expect(a[0].y).toBeGreaterThan(0); expect(a[0].y).toBeLessThan(H);
    // …parked in the top band, off the middle of the screen where the site is drawn
    expect(a[0].big).toBe(true);
    expect(a[0].y).toBeLessThan(H * 0.3);
  });
  it("labels a small polygon too, and nothing for a polygon that is not in view", () => {
    const names = run([BIG, SMALL, GONE]).map((a) => a.name).sort();
    expect(names).toEqual(["Stafford", "Sugar Land"]);
  });
  it("keeps every label box inside the view (nothing cut off at an edge) and never overlaps two", () => {
    const placed = placeNames(run([BIG, SMALL]), { textOf: (a) => a.name, fontPx: 14, viewW: W, viewH: H });
    for (const p of placed) {
      expect(p.x - p.box.w / 2).toBeGreaterThanOrEqual(0); expect(p.x + p.box.w / 2).toBeLessThanOrEqual(W);
      expect(p.y - p.box.h / 2).toBeGreaterThanOrEqual(0); expect(p.y + p.box.h / 2).toBeLessThanOrEqual(H);
    }
    const [a, b] = placed;
    if (a && b) expect(Math.abs(a.x - b.x) * 2 >= a.box.w + b.box.w || Math.abs(a.y - b.y) * 2 >= a.box.h + b.box.h).toBe(true);
  });
  it("one label per place, even when the place is several polygons", () => {
    const two = { properties: { n: "Houston" }, geometry: { type: "MultiPolygon", coordinates: [sq(-95.69, 29.6, 0.02, 0.02).coordinates, sq(-95.65, 29.62, 0.03, 0.03).coordinates] } };
    expect(run([two]).filter((a) => a.name === "Houston")).toHaveLength(1);
  });
  it("never prints an ETJ's name inside the hole where a city was cut out of it", () => {
    const outer = [[-95.69, 29.6], [-95.61, 29.6], [-95.61, 29.64], [-95.69, 29.64], [-95.69, 29.6]];
    const hole = [[-95.675, 29.605], [-95.625, 29.605], [-95.625, 29.635], [-95.675, 29.635], [-95.675, 29.605]];
    const etj = { properties: { n: "Houston ETJ" }, geometry: { type: "Polygon", coordinates: [outer, hole] } };
    const [a] = run([etj]);
    const px = (r) => r.map(([lng, lat]) => { const p = project(lng, lat); return [p.x, p.y]; });
    const inHole = (() => { const h = px(hole); let c = false; for (let i = 0, j = h.length - 1; i < h.length; j = i++) { const p = h[i], q = h[j]; if ((p[1] > a.y) !== (q[1] > a.y) && a.x < ((q[0] - p[0]) * (a.y - p[1])) / (q[1] - p[1]) + p[0]) c = !c; } return c; })();
    expect(inHole).toBe(false);
  });
  it("the Sutherland–Hodgman clip returns the visible part", () => {
    const c = clipRingToRect([[-10, -10], [20, -10], [20, 20], [-10, 20]], 0, 0, 10, 10);
    expect(c.length).toBeGreaterThanOrEqual(4);
    for (const [x, y] of c) { expect(x).toBeGreaterThanOrEqual(0); expect(x).toBeLessThanOrEqual(10); expect(y).toBeGreaterThanOrEqual(0); expect(y).toBeLessThanOrEqual(10); }
  });
  it("names grow with zoom", () => { expect(labelFontPx(10)).toBeLessThan(labelFontPx(14)); expect(labelFontPx(14)).toBeLessThan(labelFontPx(17) + 0.001); });
});

describe("the name floor stays, the old ceilings are gone (names at working zoom)", () => {
  it.each(["jur_county", "jur_city", "jur_etj", "ga_city", "fl_city", "ny_village", "tn_county"])("%s labels at zoom 15 and still start where it did", (id) => {
    const src = VECTOR_SOURCES[id];
    expect(src, id).toBeTruthy();
    expect(labelsVisible(placeLabelZoom(src), 15)).toBe(true);
    expect(labelsVisible(placeLabelZoom(src), src.labelZoom.min - 1)).toBe(false);
  });
  it("a layer that is not a county / city / ETJ keeps its own ceiling (ISD names stay off at parcel zoom)", () => {
    expect(labelsVisible(placeLabelZoom(VECTOR_SOURCES.jur_isd), 15)).toBe(false);
  });
});

describe("a county name is never clipped by the view edge", () => {
  // The county lies NORTH of a horizontal boundary 10 px below the top of the view. The old placement set the name 13 px beside the line on the county's side — y = −3, half the
  // letters above the top edge ("Fort Bend Co…" cut off). The name must now sit fully inside the view or not be set on that line at all.
  const project = (lng, lat) => ({ x: lng, y: -lat });
  const unproject = (x, y) => ({ lng: x, lat: -y });
  const NORTH = { properties: { n: "Fort Bend" }, geometry: { type: "Polygon", coordinates: [[[-1000, -10], [900, -10], [900, 600], [-1000, 600], [-1000, -10]]] } };
  it("every name returned has its whole box inside the view", () => {
    const out = countyLineLabels([NORTH], { project, unproject, viewW: 500, viewH: 400, textOf: () => "Fort Bend Co.", fontPx: 12 });
    for (const l of out) { expect(l.x - 40).toBeGreaterThanOrEqual(0); expect(l.x + 40).toBeLessThanOrEqual(500); expect(l.y - 8).toBeGreaterThanOrEqual(0); expect(l.y + 8).toBeLessThanOrEqual(400); }
  });
  it("a line with a roomy stretch still carries the name (the fix is not 'print nothing')", () => {
    const long = { properties: { n: "Fort Bend" }, geometry: { type: "Polygon", coordinates: [[[-1000, -200], [900, -200], [900, -600], [-1000, -600], [-1000, -200]]] } };
    const out = countyLineLabels([long], { project, unproject, viewW: 500, viewH: 400, textOf: () => "Fort Bend Co.", fontPx: 12 });
    expect(out).toHaveLength(1);
    expect(out[0].x).toBeGreaterThan(40); expect(out[0].x).toBeLessThan(460);
  });
});

describe("one click card: city, limits or ETJ, county", () => {
  const city = { sourceId: "jur_city", title: "Sugar Land — city limits", name: "Sugar Land", sourceName: "TxGIO (statewide)", note: "Inside this line is in the city.", rows: [] };
  const etj = { sourceId: "jur_etj", title: "Houston — ETJ", name: "Houston", sourceName: "H-GAC", rows: [] };
  const county = { sourceId: "jur_county", title: "Fort Bend County", name: "Fort Bend", sourceName: "TxDOT TPP (statewide)", rows: [] };
  it("names the city, says it is inside the limits, and names the county", () => {
    const c = combineJurisdictionHits([county, city]);
    expect(c.title).toBe("Sugar Land — city limits");
    expect(c.rows.find((r) => r.label === "Jurisdiction").text).toBe("City of Sugar Land — inside the city limits");
    expect(c.rows.find((r) => r.label === "County").text).toBe("Fort Bend County");
    expect(c.sourceName).toMatch(/TxGIO/); expect(c.sourceName).toMatch(/TxDOT/);
  });
  it("an ETJ-only click says 'outside its limits', never the bare word", () => {
    const c = combineJurisdictionHits([county, etj]);
    expect(c.rows.find((r) => r.label === "Jurisdiction").text).toBe("In the ETJ of City of Houston — outside its limits");
    expect(c.title).toBe("Houston — ETJ");
  });
  it("limits outrank ETJ: where both answer, the ETJ is not printed (constraint #38)", () => {
    const c = combineJurisdictionHits([city, etj, county]);
    expect(c.rows.map((r) => r.text).join(" ")).not.toMatch(/ETJ/);
  });
  it("a county-only click is just the county; no claim about a layer that did not answer", () => {
    const c = combineJurisdictionHits([county]);
    expect(c.title).toBe("Fort Bend County");
    expect(c.rows).toEqual([{ label: "County", text: "Fort Bend County" }]);
  });
  it("ignores layers that are not part of the merged row, and folds members into one item at the first member's place", () => {
    expect(combineJurisdictionHits([{ sourceId: "jur_isd", title: "X ISD" }])).toBeNull();
    const items = [{ id: "z", sourceId: "zoning", title: "Zoning" }, { ...county, id: "jur_county" }, { ...city, id: "jur_city" }];
    const out = foldBoundaryItems(items);
    expect(out.map((i) => i.id)).toEqual(["z", "counties_cities"]);
  });
  it("every Counties & Cities source id maps to a role", () => {
    for (const id of ["jur_county", "jur_city", "jur_etj", "ga_city", "ca_county", "ny_village", "tn_city", "ok_county"]) expect(boundaryRoleOf(id), id).toBeTruthy();
    expect(boundaryRoleOf("fema")).toBeNull();
  });
});

describe("a site that crosses or touches a limits / ETJ line is flagged", () => {
  it("a tract crossing a city's limits is flagged with its share", () => {
    const f = limitLineFlags({ partialCities: ["Sugar Land"], cityShareOf: () => 0.62 });
    expect(f).toEqual([{ kind: "crosses", line: "city", name: "Sugar Land", share: 0.62 }]);
    expect(limitLineNote(f)).toBe("The site crosses the City of Sugar Land limits line — 62% of it by area is inside the city, the rest is outside it.");
  });
  it("a tract that straddles an ETJ edge (rest unincorporated) is flagged — the chip used to name the ETJ alone", () => {
    const f = limitLineFlags({ etjRows: [{ name: "Houston", share: 0.55 }] });
    expect(f).toEqual([{ kind: "crosses", line: "etj", name: "Houston", share: 0.55 }]);
  });
  it("a tract wholly inside the ETJ, or wholly inside a city, is NOT flagged", () => {
    expect(limitLineFlags({ etjRows: [{ name: "Houston", share: 1 }] })).toEqual([]);
    expect(limitLineFlags({ coreCities: ["Sugar Land"], etjRows: [{ name: "Houston", share: 0.4 }] })).toEqual([]);
  });
  it("an edge that only touches is flagged as touching, in plain words", () => {
    const f = limitLineFlags({ edgeCities: ["Katy"], etjEdge: ["Houston"] });
    expect(f.map((x) => `${x.kind}:${x.line}:${x.name}`)).toEqual(["touches:city:Katy", "touches:etj:Houston"]);
    expect(limitLineNote(f)).toMatch(/edge touches the City of Katy limits line/);
  });
  it("the same line is never flagged twice, and a city split suppresses its ETJ flag", () => {
    const f = limitLineFlags({ partialCities: ["Baytown", "Baytown"], etjRows: [{ name: "Baytown", share: 0.5 }] });
    expect(f).toHaveLength(1);
  });
});
