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
        _layers: {},
        createLayers(f) { created.push(f.length); f.forEach((x) => { if (x.id != null) this._layers[x.id] = x; }); },
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
    // the SAME feature delivered again and again (each pan touches it) is never counted twice: forty re-deliveries of a 62k-point polygon all pass
    const big = { ...poly(62000), id: 77 };
    for (let i = 0; i < 40; i++) lyr.createLayers([big]);
    expect(created.length).toBe(41);
    expect(fired.length).toBe(1);
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


describe("B2521584 — the budget counts a feature once, and a refusal survives the `load` that follows it", () => {
  const mocks = () => {
    vi.doMock("esri-leaflet", () => ({
      dynamicMapLayer: vi.fn(), imageMapLayer: vi.fn(), tiledMapLayer: vi.fn(),
      featureLayer: vi.fn(() => ({
        handlers: {},
        _layers: {},
        createLayers(f) { this.created = (this.created || 0) + f.length; for (const x of f) if (x && x.id != null) this._layers[x.id] = x; }, // like esri-leaflet: a drawn feature is held under its id
        fire(name, e) { (this.handlers[name] || []).forEach((h) => h(e)); },
        on(name, h) { (this.handlers[name] = this.handlers[name] || []).push(h); return this; },
      })),
    }));
    vi.doMock("../src/workspaces/site-planner/lib/evidenceLayers.js", () => ({ overpassLayer: vi.fn(), mapillaryLayer: vi.fn() }));
    vi.doMock("../src/workspaces/site-planner/lib/terrainLayers.js", () => ({ contourLayer: vi.fn(), flowLayer: vi.fn(), TERRAIN_MIN_ZOOM: 13 }));
    vi.doMock("../src/workspaces/site-planner/lib/vectorOverlay.js", () => ({ cachedVectorLayer: vi.fn(), cachedPipelineLayer: vi.fn(), cachedCorridorLayer: vi.fn(), isPointFeature: vi.fn() }));
    vi.doMock("../src/workspaces/site-planner/lib/mapSymbols.js", () => ({ installDefaultMarkerIcon: vi.fn(), pointToLayerFor: vi.fn() }));
  };
  it("a long polygon returned whole to many tiles is counted ONCE (80k unique vertices must not read as 6 × 80k)", async () => {
    vi.resetModules(); mocks();
    const { buildFeatureLayerForTest } = await import("../src/workspaces/site-planner/lib/layers.js");
    const lyr = buildFeatureLayerForTest({ url: "https://example.test/FeatureServer/0", label: "Whole polygons", color: "#000" }, 1, "pane");
    const whole = { id: 7, ...poly(80000) };
    for (let tile = 0; tile < 6; tile++) lyr.createLayers([whole]);   // six tiles, the same feature each time
    expect(lyr.created).toBe(6);                                       // every batch reached esri-leaflet (which keys by id and draws it once)
    const refused = [];
    lyr.on("overbudget", (e) => refused.push(e));
    lyr.createLayers([{ id: 8, ...poly(80000) }, { id: 9, ...poly(80000) }, { id: 10, ...poly(80000) }, { id: 11, ...poly(10000) }]);
    expect(refused).toHaveLength(1);                                   // genuinely new vertices (250k) still trip the 120k batch cap
  });
  it("a feature with no id is counted every time (the safe direction)", async () => {
    vi.resetModules(); mocks();
    const { buildFeatureLayerForTest } = await import("../src/workspaces/site-planner/lib/layers.js");
    const lyr = buildFeatureLayerForTest({ url: "https://example.test/FeatureServer/0", label: "No ids", color: "#000" }, 1, "pane");
    const refused = [];
    lyr.on("overbudget", (e) => refused.push(e));
    for (let i = 0; i < 5; i++) lyr.createLayers([poly(70000)]);
    expect(refused.length).toBeGreaterThan(0);                          // 5 × 70k > the 300k layer total
  });
  it("attachFeatureRetry: a refusal is NOT overwritten by the `load` that follows; the next request cycle clears it", async () => {
    vi.resetModules(); mocks();
    const { attachFeatureRetry } = await import("../src/workspaces/site-planner/lib/layers.js");
    const handlers = {};
    const lyr = { on(n, h) { (handlers[n] = handlers[n] || []).push(h); return this; }, onRemove() {}, eachLayer: () => {}, _layers: {} };
    const out = [];
    attachFeatureRetry(lyr, "k", { label: "Layer" }, (...a) => out.push(a));
    const fire = (n, e) => (handlers[n] || []).forEach((h) => h(e));
    fire("loading"); fire("overbudget", { vertices: 523000 }); fire("load");
    expect(out.map((o) => o[1])).toEqual(["failed"]);                   // not "failed" then "empty"
    expect(out[0][2]).toMatch(/too detailed to draw/);
    fire("loading"); fire("load");                                      // the next cycle (a zoom) starts clean
    expect(out).toHaveLength(2);
    expect(out[1][1]).not.toBe("failed");                                // …and reports what it found, not the old refusal
  });
  it("attachFeatureRetry gives up: esri-leaflet fires `load` BEFORE `requesterror` for a failed request, which used to wipe the retry count every cycle (1,801 refreshes in 12 minutes, 'failed' never reached)", async () => {
    vi.resetModules(); mocks();
    vi.useFakeTimers();
    try {
      const { attachFeatureRetry } = await import("../src/workspaces/site-planner/lib/layers.js");
      const handlers = {}; let refreshes = 0;
      const lyr = { on(n, h) { (handlers[n] = handlers[n] || []).push(h); return this; }, onRemove() {}, refresh() { refreshes++; }, _layers: {} };
      const out = [];
      attachFeatureRetry(lyr, "k", { label: "Layer" }, (...a) => out.push(a[1]));
      const fire = (n, e) => (handlers[n] || []).forEach((h) => h(e));
      for (let cycle = 0; cycle < 12; cycle++) {
        fire("loading"); fire("load"); fire("requesterror", { error: { code: 503 } });   // the real order: load, then the error
        vi.advanceTimersByTime(5000);
      }
      expect(refreshes).toBeLessThanOrEqual(3);                 // bounded by `max`
      expect(out).toContain("failed");                          // …and it ends on "failed", not "loaded"/"retrying" forever
    } finally { vi.useRealTimers(); }
  });
});
