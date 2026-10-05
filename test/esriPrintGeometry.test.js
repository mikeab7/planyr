/* B2081252 — PDF-PARITY: every esriFeature row prints its POINTS and POLYGONS, not just its lines.
 * Before: the export's esriFeature branch emitted `esriLineFeatures` only, so EPA cleanups, LPST tanks, HIFLD
 * substations, TxDOT/CDOT traffic counts, FAA airports and the Colorado cleanup layer (all points) were on the
 * screen and ABSENT from the PDF/PNG — Texas plans included. */
import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
vi.mock("esri-leaflet", () => ({ dynamicMapLayer: vi.fn(), imageMapLayer: vi.fn(), featureLayer: vi.fn(), tiledMapLayer: vi.fn() }));
vi.mock("../src/workspaces/site-planner/lib/evidenceLayers.js", () => ({ overpassLayer: vi.fn(), mapillaryLayer: vi.fn() }));
vi.mock("../src/workspaces/site-planner/lib/terrainLayers.js", () => ({ contourLayer: vi.fn(), flowLayer: vi.fn() }));
vi.mock("../src/workspaces/site-planner/lib/vectorOverlay.js", () => ({
  cachedVectorLayer: vi.fn(), cachedPipelineLayer: vi.fn(), cachedCorridorLayer: vi.fn(), isPointFeature: vi.fn(),
}));
vi.mock("../src/workspaces/site-planner/lib/mapSymbols.js", () => ({ installDefaultMarkerIcon: vi.fn(), pointToLayerFor: vi.fn() }));
import { esriPrintFeatures } from "../src/workspaces/site-planner/lib/overlayVectorSvg.js";
import { ALL_LAYERS } from "../src/workspaces/site-planner/lib/layers.js";
import { pointSymbolOptions } from "../src/workspaces/site-planner/lib/layerRequest.js";

const leaf = (s) => ({ stroke: s && s.color, strokeWidth: s && s.weight, strokeOpacity: s && s.opacity != null ? s.opacity : 1, dash: s && s.dashArray });
const pt = { type: "Feature", properties: {}, geometry: { type: "Point", coordinates: [-95.1, 29.7] } };
const poly = { type: "Feature", properties: {}, geometry: { type: "Polygon", coordinates: [[[-95, 29], [-95, 30], [-94, 30], [-95, 29]]] } };
const line = { type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: [[-95, 29], [-94, 30]] } };

describe("esriPrintFeatures", () => {
  const cfg = { color: "#b91c1c", weight: 2, pointRadius: 5 };
  it("prints a point in the screen's own symbology", () => {
    const f = esriPrintFeatures(pt, cfg, leaf);
    expect(f).toHaveLength(1);
    const o = pointSymbolOptions(cfg, 1);
    expect(f[0]).toMatchObject({ kind: "point", coords: [-95.1, 29.7], style: { stroke: o.color, fill: o.fillColor, radius: 5, fillOpacity: o.fillOpacity } });
  });
  it("prints a MultiPoint as one point each", () => {
    expect(esriPrintFeatures({ properties: {}, geometry: { type: "MultiPoint", coordinates: [[1, 2], [3, 4]] } }, cfg, leaf)).toHaveLength(2);
  });
  it("prints a polygon with no fill unless the row's styleFn gives one", () => {
    expect(esriPrintFeatures(poly, cfg, leaf)[0]).toMatchObject({ kind: "polygon", style: { fillOpacity: 0 } });
    const styled = { ...cfg, styleFn: (p, o) => ({ color: "#15803d", weight: 1.5, opacity: o, fillColor: "#15803d", fillOpacity: o * 0.5 }) };
    expect(esriPrintFeatures(poly, styled, leaf)[0].style.fillOpacity).toBe(0.5);
  });
  it("still prints a line exactly once", () => {
    const f = esriPrintFeatures(line, cfg, leaf);
    expect(f).toHaveLength(1);
    expect(f[0].kind).toBe("line");
  });
  it("a row can opt OUT with printGeometry:false (lines still print)", () => {
    expect(esriPrintFeatures(pt, { ...cfg, printGeometry: false }, leaf)).toHaveLength(0);
    expect(esriPrintFeatures(line, { ...cfg, printGeometry: false }, leaf)).toHaveLength(1);
  });
});

describe("every on-screen esriFeature row prints", () => {
  const rows = Object.entries(ALL_LAYERS).filter(([, c]) => c.kind === "esriFeature");
  it("covers the Texas / Colorado point layers the old branch dropped", () => {
    const ids = rows.map(([id]) => id);
    for (const id of ["env_cleanups", "txdot_aadt", "faa_airports", "hifld_substations", "co_aadt"]) expect(ids.some((x) => x === id), id).toBe(true);
  });
  it("no esriFeature row opts out, and the export branch routes through the shared rule", () => {
    for (const [id, c] of rows) expect(c.printGeometry, id).not.toBe(false);
    const src = readFileSync(new URL("../src/workspaces/site-planner/lib/exportSheet.js", import.meta.url), "utf8");
    expect(src).toMatch(/esriPrintFeatures\(gj, cfg, leafStyle\)/);
    expect(src).not.toMatch(/if \(cfg\.printGeometry\)/);
  });
});
