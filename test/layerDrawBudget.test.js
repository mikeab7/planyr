/* B2507064 (NEW-9) — no layer may freeze the tab. The Discover DeSoto layer was 12 polygons holding 707,071 vertices (a 28 MB answer); drawn zoomed out it left
 * Chrome on "Page Unresponsive" (measured live). The guard is a vertex budget in front of Leaflet: a batch over it is declined, the layer reports a plain failure. */
import { describe, it, expect, vi } from "vitest";
import { countVertices, FEATURE_VERTEX_BUDGET, FEATURE_VERTEX_TOTAL } from "../src/workspaces/site-planner/lib/layerRequest.js";

const ring = (n) => Array.from({ length: n }, (_, i) => [i, i % 7]);
const poly = (n) => ({ geometry: { type: "Polygon", coordinates: [ring(n)] } });

describe("countVertices", () => {
  it("counts every position of polygons, multipolygons, lines, points and collections", () => {
    expect(countVertices([poly(10)])).toBe(10);
    expect(countVertices([{ geometry: { type: "MultiPolygon", coordinates: [[ring(5)], [ring(7), ring(3)]] } }])).toBe(15);
    expect(countVertices([{ geometry: { type: "LineString", coordinates: ring(4) } }, { geometry: { type: "Point", coordinates: [1, 2] } }])).toBe(5);
    expect(countVertices([{ geometry: { type: "GeometryCollection", geometries: [{ type: "Point", coordinates: [1, 2] }, { type: "LineString", coordinates: ring(3) }] } }])).toBe(4);
    expect(countVertices([{ geometry: null }, null, {}])).toBe(0);
  });
  it("stops walking once past the cap (a 700k-vertex answer is not walked in full)", () => {
    const big = [poly(634514), poly(44109)];
    const t0 = Date.now();
    const n = countVertices(big, 1000);
    expect(n).toBeGreaterThan(1000);
    expect(n).toBeLessThan(634514);
    expect(Date.now() - t0).toBeLessThan(200);
  });
  it("the real Discover DeSoto shape (12 features, 707,071 vertices) is over the budget; every other new DeSoto row's typical answer is far under it", () => {
    const sizes = [463, 364, 354, 170, 634514, 44109, 924, 15416, 557, 7122, 320, 2758];
    expect(countVertices(sizes.map(poly), 1e9)).toBe(707071);
    expect(707071).toBeGreaterThan(FEATURE_VERTEX_BUDGET);
    expect(FEATURE_VERTEX_TOTAL).toBeGreaterThan(FEATURE_VERTEX_BUDGET);
  });
});

describe("the guard in buildFeatureLayer", () => {
  it("declines an over-budget batch, fires `overbudget`, and passes a small one through", async () => {
    const created = [];
    const fired = [];
    vi.resetModules();
    vi.doMock("esri-leaflet", () => ({
      dynamicMapLayer: vi.fn(), imageMapLayer: vi.fn(), tiledMapLayer: vi.fn(),
      featureLayer: vi.fn(() => ({
        createLayers(f) { created.push(f.length); },
        fire(name, e) { fired.push([name, e]); },
        on() { return this; },
      })),
    }));
    vi.doMock("../src/workspaces/site-planner/lib/evidenceLayers.js", () => ({ overpassLayer: vi.fn(), mapillaryLayer: vi.fn() }));
    vi.doMock("../src/workspaces/site-planner/lib/terrainLayers.js", () => ({ contourLayer: vi.fn(), flowLayer: vi.fn(), TERRAIN_MIN_ZOOM: 13 }));
    vi.doMock("../src/workspaces/site-planner/lib/vectorOverlay.js", () => ({ cachedVectorLayer: vi.fn(), cachedPipelineLayer: vi.fn(), cachedCorridorLayer: vi.fn(), isPointFeature: vi.fn() }));
    vi.doMock("../src/workspaces/site-planner/lib/mapSymbols.js", () => ({ installDefaultMarkerIcon: vi.fn(), pointToLayerFor: vi.fn() }));
    const { buildFeatureLayerForTest } = await import("../src/workspaces/site-planner/lib/layers.js");
    expect(typeof buildFeatureLayerForTest).toBe("function");
    const lyr = buildFeatureLayerForTest({ url: "https://example.test/FeatureServer/0", label: "Test layer", color: "#000" }, 1, "pane");
    lyr.createLayers([poly(50)]);
    expect(created).toEqual([1]);
    lyr.createLayers([poly(634514)]);
    expect(created).toEqual([1]);
    expect(fired.map((f) => f[0])).toEqual(["overbudget"]);
    expect(fired[0][1].vertices).toBeGreaterThan(FEATURE_VERTEX_BUDGET);
  });
});

describe("opt-in server-side simplification (Future Land Use: 308 k vertices, ~2 s to draw)", () => {
  it("featureLayerOptions asks esri-leaflet to simplify only for a row that declares simplifyFactor", async () => {
    const { featureLayerOptions } = await import("../src/workspaces/site-planner/lib/layerRequest.js");
    expect(featureLayerOptions({ url: "u", color: "#000" }, 1, "p").simplifyFactor).toBeUndefined();
    expect(featureLayerOptions({ url: "u", color: "#000", simplifyFactor: 0.75 }, 1, "p").simplifyFactor).toBe(0.75);
  });
  it("the Future Land Use row declares it", async () => {
    const { DESOTO_LAYERS } = await import("../src/workspaces/site-planner/lib/desotoLayers.js");
    expect(DESOTO_LAYERS.ms_desoto_flu.simplifyFactor).toBeGreaterThan(0);
  });
});
