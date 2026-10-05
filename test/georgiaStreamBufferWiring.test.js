/* Georgia stream buffers — the wiring between the registry rows, the vector sources and the layer builder. */
import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";

vi.mock("esri-leaflet", () => ({ dynamicMapLayer: vi.fn(), imageMapLayer: vi.fn(), featureLayer: vi.fn(), tiledMapLayer: vi.fn() }));
vi.mock("../src/workspaces/site-planner/lib/evidenceLayers.js", () => ({ overpassLayer: vi.fn(), mapillaryLayer: vi.fn() }));
vi.mock("../src/workspaces/site-planner/lib/terrainLayers.js", () => ({ contourLayer: vi.fn(), flowLayer: vi.fn() }));
vi.mock("../src/workspaces/site-planner/lib/vectorOverlay.js", () => ({
  cachedVectorLayer: vi.fn(), cachedPipelineLayer: vi.fn(), cachedCorridorLayer: vi.fn(), isPointFeature: vi.fn(),
}));
vi.mock("../src/workspaces/site-planner/lib/mapSymbols.js", () => ({ installDefaultMarkerIcon: vi.fn(), pointToLayerFor: vi.fn() }));

import { ALL_LAYERS } from "../src/workspaces/site-planner/lib/layers.js";
import { VECTOR_SOURCES, styleFor, pickTier, vectorKey } from "../src/workspaces/site-planner/lib/vectorLayers.js";
import { GIS_SOURCES } from "../src/shared/gis/sources.js";
import { layerMinZoom } from "../src/workspaces/site-planner/lib/layerZoomGate.js";

describe("the three sources the buffer layer reads", () => {
  it("trout streams + the District outline are registered, read the GIS_SOURCES endpoints, and are never inlined", () => {
    expect(VECTOR_SOURCES.ga_trout.query.url).toBe(GIS_SOURCES.troutGa.serviceUrl + "/query");
    expect(VECTOR_SOURCES.ga_mngwpd.query.url).toBe(GIS_SOURCES.mngwpd.serviceUrl + "/query");
    expect(VECTOR_SOURCES.nhd_flowlines).toBeTruthy();
  });
  it("the District outline is ONE source-level cache entry, whatever the view (membership must not change on a pan)", () => {
    const tier = pickTier(VECTOR_SOURCES.ga_mngwpd, 14);
    expect(tier.scope).toBe("all");
    expect(vectorKey(VECTOR_SOURCES.ga_mngwpd, { w: 1, s: 2, e: 3, n: 4 }, tier)).toBe(vectorKey(VECTOR_SOURCES.ga_mngwpd, { w: 9, s: 9, e: 9, n: 9 }, tier));
  });
  it("the NHD pull carries ftype + fcode — the two attributes the buffer rule reads", () => {
    expect(VECTOR_SOURCES.nhd_flowlines.query.outFields).toEqual(expect.arrayContaining(["ftype", "fcode"]));
  });
  it("trout streams draw in the cold-water teal, not the neutral fallback", () => {
    expect(styleFor(VECTOR_SOURCES.ga_trout, {}).color).toBe("#0f766e");
  });
});

describe("the layer row", () => {
  const row = ALL_LAYERS.ga_stream_buffers;
  it("is a corridor-kind row naming its rule, Georgia-only, in the Flood & drainage group", () => {
    expect(row.kind).toBe("pipelineCorridor");
    expect(row.bufferRule).toBe("ga_streams");
    expect(row.states).toEqual(["GA"]);
    expect(row.group).toBe("flood");
  });
  it("its declared zoom gate IS the NHD source's vector gate (the panel and the map may not disagree)", () => {
    expect(row.minZoom).toBe(VECTOR_SOURCES.nhd_flowlines.query.minVectorZoom);
    expect(layerMinZoom(row)).toBe(VECTOR_SOURCES.nhd_flowlines.query.minVectorZoom);
  });
  it("says it is measured from the centreline and that the county's ordinance governs", () => {
    expect(row.note).toMatch(/CENTRELINE/);
    expect(row.note).toMatch(/confirm with the county/i);
    expect(row.note).toMatch(/50 undisturbed \+ 25 impervious/);
  });
  it("the corridor builder hands a bufferRule row to the Georgia builder (and only that row)", () => {
    const src = readFileSync(new URL("../src/workspaces/site-planner/lib/vectorOverlay.js", import.meta.url), "utf8");
    expect(src).toMatch(/if \(cfg\.bufferRule === "ga_streams"\) return cachedStreamBufferLayer\(/);
    // loud on a failed supporting source — a missing District outline must never silently draw 25 ft as the answer
    expect(src).toMatch(/couldn't load \$\{lost\.join\(" and "\)\}/);
  });
});

describe("slope", () => {
  it("is a 3DEP raster chain Slope → Remap(5 classes) → Colormap, with the flat class transparent", () => {
    const r = ALL_LAYERS.ga_slope.rendering;
    expect(r.rasterFunction).toBe("Colormap");
    const remap = r.rasterFunctionArguments.Raster;
    expect(remap.rasterFunction).toBe("Remap");
    expect(remap.rasterFunctionArguments.Raster.rasterFunction).toBe("Slope");
    expect(remap.rasterFunctionArguments.Raster.rasterFunctionArguments.SlopeType).toBe(2); // percent rise
    expect(r.rasterFunctionArguments.Colormap[0]).toEqual([1, 0, 0, 0, 0]); // <2% paints nothing
    expect(remap.rasterFunctionArguments.InputRanges).toEqual([0, 2, 2, 5, 5, 10, 10, 15, 15, 10000]);
  });
});

describe("PDF-PARITY — every Georgia point / polygon row prints", () => {
  it("each is an esriFeature row and the export branch prints through the shared esriPrintFeatures rule (B2081252)", () => {
    for (const id of ["ga_hsi", "ga_nrhp", "ga_cemeteries", "ga_crit_habitat", "ga_gopher_tortoise"]) {
      expect(ALL_LAYERS[id].kind, id).toBe("esriFeature");
      expect(ALL_LAYERS[id].printGeometry, id).not.toBe(false); // printing is the default now; only `false` opts OUT
    }
    const src = readFileSync(new URL("../src/workspaces/site-planner/lib/exportSheet.js", import.meta.url), "utf8");
    expect(src).toMatch(/esriPrintFeatures\(gj, cfg, leafStyle\)/);
  });
  it("polygon fills are proportional to the slider (no cap), so print = screen at any opacity", () => {
    for (const id of ["ga_crit_habitat", "ga_gopher_tortoise"]) {
      const at = (o) => ALL_LAYERS[id].styleFn({ Tier: 1 }, o).fillOpacity;
      expect(at(0.8) / at(0.4), id).toBeCloseTo(2, 6);
      expect(at(1), id).toBeGreaterThan(0);
    }
  });
});
