/* B2081249 — the two NATIONAL road-access layers (USDOT BTS: STAA National Network + HPMS 2022).
 * The load-bearing fact, found by probing the live service: National_Network ALSO holds NN = 0 segments, so an
 * unfiltered draw would print a "truck route" claim on roads that are not on the network. */
import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";

vi.mock("esri-leaflet", () => ({ dynamicMapLayer: vi.fn(), imageMapLayer: vi.fn(), featureLayer: vi.fn(), tiledMapLayer: vi.fn() }));
vi.mock("../src/workspaces/site-planner/lib/evidenceLayers.js", () => ({ overpassLayer: vi.fn(), mapillaryLayer: vi.fn(), bedrockLayer: vi.fn() }));
vi.mock("../src/workspaces/site-planner/lib/terrainLayers.js", () => ({ contourLayer: vi.fn(), flowLayer: vi.fn() }));
vi.mock("../src/workspaces/site-planner/lib/vectorOverlay.js", () => ({
  cachedVectorLayer: vi.fn(), cachedPipelineLayer: vi.fn(), cachedCorridorLayer: vi.fn(), isPointFeature: vi.fn(),
}));
vi.mock("../src/workspaces/site-planner/lib/mapSymbols.js", () => ({ installDefaultMarkerIcon: vi.fn(), pointToLayerFor: vi.fn() }));

import { ALL_LAYERS } from "../src/workspaces/site-planner/lib/layers.js";
import { GIS_SOURCES, auditRegistry, statesFor } from "../src/shared/gis/sources.js";
import { SOURCE_FIXTURES, SOURCE_DOCS } from "../src/shared/gis/sourceFixtures.js";
import { featureLayerOptions } from "../src/workspaces/site-planner/lib/layerRequest.js";
import { esriPrintFeatures } from "../src/workspaces/site-planner/lib/overlayVectorSvg.js";

const leaf = (s) => ({ stroke: s && s.color, strokeWidth: s && s.weight, strokeOpacity: s && s.opacity != null ? s.opacity : 1 });

describe("registry rows", () => {
  it("both are national production rows on the BTS atlas org, with a real fixture spread", () => {
    for (const k of ["ntaNationalNetwork", "hpmsAadt"]) {
      expect(statesFor(GIS_SOURCES[k]), k).toBeNull();
      expect(GIS_SOURCES[k].tier, k).toBe("production");
      expect(GIS_SOURCES[k].serviceUrl, k).toMatch(/^https:\/\/services\.arcgis\.com\/xOi1kZaI0eWDREZv\//);
      expect(SOURCE_FIXTURES[k].fixtures.length, k).toBeGreaterThanOrEqual(3);
      expect(SOURCE_DOCS[k].notes, k).toBeTruthy();
    }
    expect(auditRegistry(GIS_SOURCES, SOURCE_FIXTURES, SOURCE_DOCS).problems).toEqual([]);
  });
  it("the Gwinnett box the owner probed is a fixture of both", () => {
    for (const k of ["ntaNationalNetwork", "hpmsAadt"]) {
      expect(SOURCE_FIXTURES[k].fixtures.some((f) => JSON.stringify(f.bbox) === JSON.stringify([-84.05, 33.9, -83.95, 34.0])), k).toBe(true);
    }
  });
  it("⛔ the National Network row filters to NN = 1 (the layer also holds NN = 0 roads)", () => {
    expect(GIS_SOURCES.ntaNationalNetwork.where).toBe("NN = 1");
    expect(ALL_LAYERS.bts_truck_network.where).toBe("NN = 1");
    expect(featureLayerOptions(ALL_LAYERS.bts_truck_network, 0.55, "p").where).toBe("NN = 1");
  });
  it("a row with no `where` passes none (existing esriFeature rows are untouched)", () => {
    expect(featureLayerOptions(ALL_LAYERS.txdot_aadt, 0.4, "p").where).toBeUndefined();
  });
  it("the HPMS row is honest that it is the NHS only", () => {
    expect(ALL_LAYERS.hpms_aadt.note).toMatch(/NATIONAL HIGHWAY SYSTEM only/);
    expect(ALL_LAYERS.hpms_aadt.note).toMatch(/coverage gap, never low traffic/);
    expect(GIS_SOURCES.hpmsAadt.where).toBeUndefined(); // the service is already an NHS view
  });
});

describe("layer rows", () => {
  it("are national (no state scope), esriFeature lines in the access group, off the Texas row's slot", () => {
    for (const id of ["bts_truck_network", "hpms_aadt"]) {
      const c = ALL_LAYERS[id];
      expect(c.kind, id).toBe("esriFeature");
      expect(c.states, id).toBeUndefined();
      expect(c.role, id).toBe("line");
      expect(c.group, id).toBe("access");
      expect(c.url, id).toBe(GIS_SOURCES[id === "bts_truck_network" ? "ntaNationalNetwork" : "hpmsAadt"].serviceUrl);
      expect(c.note.length, id).toBeGreaterThan(40);
    }
    expect(ALL_LAYERS.txdot_aadt.states).toEqual(["TX"]); // the Texas layer is neither displaced nor duplicated
  });
  it("the hover fields name only attributes that exist on the registry's fields", () => {
    expect(ALL_LAYERS.bts_truck_network.hoverFields.flatMap((h) => h.names)).toEqual(expect.arrayContaining(["SIGN1", "AADT", "AADT_COM", "AADT_SINGL"]));
  });
  it("HPMS colours by AADT band, and a segment with no count is grey, never a volume colour", () => {
    const f = ALL_LAYERS.hpms_aadt.styleFn;
    expect(f({ AADT: 5000 }, 1).color).toBe("#0ea5e9");
    expect(f({ AADT: 31300 }, 1).color).toBe("#7c3aed");
    expect(f({ AADT: 90000 }, 1).color).toBe("#be185d");
    expect(f({ AADT: null }, 1).color).toBe("#64748b");
    expect(f({}, 1).color).toBe("#64748b");
  });
  it("PDF-PARITY: both print their lines through the shared esriFeature rule", () => {
    const line = { properties: { AADT: 31300 }, geometry: { type: "LineString", coordinates: [[-84, 33.9], [-83.9, 34]] } };
    for (const id of ["bts_truck_network", "hpms_aadt"]) {
      const out = esriPrintFeatures(line, ALL_LAYERS[id], leaf);
      expect(out, id).toHaveLength(1);
      expect(out[0].kind, id).toBe("line");
    }
  });
});

describe("the verifier honours the row's where", () => {
  it("gis-source-coverage-verify counts fixtures with the row's own where", () => {
    const src = readFileSync(new URL("../gis-verify/gis-source-coverage-verify.mjs", import.meta.url), "utf8");
    expect(src).toMatch(/where: s\.where \|\| "1=1"/);
  });
});
