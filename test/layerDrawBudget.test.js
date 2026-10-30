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
  it("attachFeatureRetry gives up on a persistently failing service — including a SLOW one (esri-leaflet fires `load` BEFORE `requesterror`, which used to wipe the retry count every cycle)", async () => {
    vi.resetModules(); mocks();
    vi.useFakeTimers();
    try {
      const { attachFeatureRetry } = await import("../src/workspaces/site-planner/lib/layers.js");
      const handlers = {}; let refreshes = 0;
      const lyr = { on(n, h) { (handlers[n] = handlers[n] || []).push(h); return this; }, onRemove() {}, refresh() { refreshes++; }, _layers: {} };
      const out = [];
      attachFeatureRetry(lyr, "k", { label: "Layer" }, (...a) => out.push(a[1]));
      const fire = (n, e) => (handlers[n] || []).forEach((h) => h(e));
      for (const waitMs of [5000, 30000]) {   // a quick failure and a service that hangs 30 s then answers 504
        refreshes = 0; out.length = 0;
        for (let cycle = 0; cycle < 12; cycle++) {
          fire("loading"); vi.advanceTimersByTime(waitMs);
          fire("load"); fire("requesterror", { url: "https://x/FeatureServer/0/query", params: {}, message: "Gateway Timeout", code: 504, method: "get" });   // esri-leaflet 3.x shape, in its real order
          vi.advanceTimersByTime(5000);
        }
        expect(refreshes, `wait ${waitMs}`).toBeLessThanOrEqual(3);   // bounded by `max`
        expect(out, `wait ${waitMs}`).toContain("failed");
        fire("loading"); fire("load"); vi.advanceTimersByTime(1);      // a later healthy cycle starts the count over
      }
      // a non-transient answer (403) does not retry at all
      refreshes = 0; fire("loading"); fire("load"); fire("requesterror", { code: 403 }); vi.advanceTimersByTime(5000);
      expect(refreshes).toBe(0);
    } finally { vi.useRealTimers(); }
  });
  it("a heavier geometry re-delivered under a held id is charged for what it GROWS by (a simplified layer re-asked after a zoom sends the finer copy under the same id)", async () => {
    vi.resetModules(); mocks();
    const { buildFeatureLayerForTest } = await import("../src/workspaces/site-planner/lib/layers.js");
    const lyr = buildFeatureLayerForTest({ url: "https://example.test/FeatureServer/0", label: "Re-asked", color: "#000", vertexBudget: 250000 }, 1, "pane");
    const refused = [];
    lyr.on("overbudget", (e) => refused.push(e));
    lyr.createLayers([{ id: 1, ...poly(15000) }]);
    expect(refused).toHaveLength(0);
    lyr.createLayers([{ id: 1, ...poly(15000) }]);                 // a plain repeat: free
    expect(refused).toHaveLength(0);
    const before = lyr.created;
    lyr.createLayers([{ id: 1, ...poly(509000) }]);                // the finer copy: +494k over the 250k cap
    expect(refused).toHaveLength(1);
    expect(lyr.created).toBe(before);                              // refused → the old geometry stays on the map
    lyr.createLayers([{ id: 1, ...poly(12000) }]);                 // a LIGHTER copy is free and becomes the held size
    expect(refused).toHaveLength(1);
  });
  it("attachFeatureRetry: the OTHER event order too — a fast cell fails (requesterror) and a slower one finishes after it (load) — still gives up", async () => {
    vi.resetModules(); mocks();
    vi.useFakeTimers();
    try {
      const { attachFeatureRetry } = await import("../src/workspaces/site-planner/lib/layers.js");
      const handlers = {}; let refreshes = 0;
      const lyr = { on(n, h) { (handlers[n] = handlers[n] || []).push(h); return this; }, onRemove() {}, refresh() { refreshes++; }, _layers: {} };
      const out = [];
      attachFeatureRetry(lyr, "k", { label: "Layer" }, (...a) => out.push(a[1]));
      const fire = (n, e) => (handlers[n] || []).forEach((h) => h(e));
      for (let cycle = 0; cycle < 20; cycle++) {
        fire("loading"); fire("requesterror", { code: 503 }); vi.advanceTimersByTime(300); fire("load"); vi.advanceTimersByTime(5000);
      }
      expect(refreshes).toBeLessThanOrEqual(3);
      expect(out).toContain("failed");
    } finally { vi.useRealTimers(); }
  });
  it("attachFeatureRetry: removing the layer clears the pending reset timer", async () => {
    vi.resetModules(); mocks();
    vi.useFakeTimers();
    try {
      const { attachFeatureRetry } = await import("../src/workspaces/site-planner/lib/layers.js");
      const handlers = {}; let removed = 0;
      const lyr = { on(n, h) { (handlers[n] = handlers[n] || []).push(h); return this; }, onRemove() { removed++; }, _layers: {} };
      attachFeatureRetry(lyr, "k", { label: "Layer" }, () => {});
      (handlers.load || []).forEach((h) => h());
      expect(vi.getTimerCount()).toBe(1);        // the deferred reset
      lyr.onRemove({});
      expect(removed).toBe(1);
      expect(vi.getTimerCount()).toBe(0);        // cleared with the layer
    } finally { vi.useRealTimers(); }
  });
  it("the budget: a REFUSED batch records nothing (the old geometry stays, so a second heavy copy is refused too); light/heavy alternation never ratchets up to a refusal; remove forgets", async () => {
    vi.resetModules(); mocks();
    const { buildFeatureLayerForTest } = await import("../src/workspaces/site-planner/lib/layers.js");
    const mk = () => buildFeatureLayerForTest({ url: "https://example.test/FeatureServer/0", label: "Re-asked", color: "#000", vertexBudget: 250000 }, 1, "pane");
    // (a) refused → held unchanged
    let lyr = mk(); let refused = 0; lyr.on("overbudget", () => { refused++; });
    lyr.createLayers([{ id: 1, ...poly(15000) }]);
    lyr.createLayers([{ id: 1, ...poly(509000) }]); lyr.createLayers([{ id: 1, ...poly(509000) }]);
    expect(refused).toBe(2);
    // (b) one id alternating 150k / 100k, 60 batches, budget 250k (total 500k): the real geometry never exceeds 150k, so it must never be refused
    lyr = mk(); refused = 0; lyr.on("overbudget", () => { refused++; });
    for (let i = 0; i < 60; i++) lyr.createLayers([{ id: 7, ...poly(i % 2 ? 100000 : 150000) }]);
    expect(refused).toBe(0);
    // (c) remove forgets what was held: the same id is charged afresh (a cold 200k copy after removal is a NEW 200k, still under the 250k cap), and a heavier one is judged from zero
    lyr = mk(); refused = 0; lyr.on("overbudget", () => { refused++; });
    lyr.createLayers([{ id: 3, ...poly(200000) }]);
    (lyr.handlers.remove || []).forEach((h) => h());
    lyr._layers = {};                                          // a layer object that is rebuilt after removal holds nothing
    lyr.createLayers([{ id: 3, ...poly(240000) }]);          // held forgotten → charged 240k (< 250k cap), not "growth of 40k"
    lyr.createLayers([{ id: 4, ...poly(240000) }]);          // total 480k < 500k
    expect(refused).toBe(0);
    lyr.createLayers([{ id: 5, ...poly(100000) }]);          // total 580k > 500k
    expect(refused).toBe(1);
  });
  it("the budget: an id esri-leaflet already holds but the wrapper never saw is a free repeat (as before), then becomes tracked", async () => {
    vi.resetModules(); mocks();
    const { buildFeatureLayerForTest } = await import("../src/workspaces/site-planner/lib/layers.js");
    const lyr = buildFeatureLayerForTest({ url: "https://example.test/FeatureServer/0", label: "Pre-held", color: "#000" }, 1, "pane");
    for (const id of [9, 10, 11, 12]) lyr._layers[id] = {};      // four 110k reaches held by esri-leaflet before the wrapper saw them
    const refused = []; lyr.on("overbudget", (e) => refused.push(e));
    for (const id of [9, 10, 11, 12]) lyr.createLayers([{ id, ...poly(110000) }]);   // free repeats: 440k of already-drawn geometry must not trip the 300k layer total
    expect(refused).toHaveLength(0);
    lyr.createLayers([{ id: 9, ...poly(400000) }]);             // now tracked at 110k: +290k growth > the 120k cap
    expect(refused).toHaveLength(1);
  });
  /* ---- the sixth review's gaps: each test below turns red under the named mutation of layers.js ---- */
  const retryRig = async () => {
    vi.resetModules(); mocks();
    const { attachFeatureRetry } = await import("../src/workspaces/site-planner/lib/layers.js");
    const handlers = {}; const rig = { refreshes: 0, out: [] };
    rig.lyr = { on(n, h) { (handlers[n] = handlers[n] || []).push(h); return this; }, onRemove() {}, refresh() { rig.refreshes++; }, _layers: {} };
    attachFeatureRetry(rig.lyr, "k", { label: "Layer" }, (...a) => rig.out.push(a[1]));
    rig.fire = (n, e) => (handlers[n] || []).forEach((h) => h(e));
    return rig;
  };
  it("status: a slower cell finishing AFTER a failed one does not flip a failed (or retrying) row to 'loaded'", async () => {
    vi.useFakeTimers();
    try {
      const r = await retryRig();
      for (let i = 0; i < 6; i++) { r.fire("loading"); r.fire("requesterror", { code: 503 }); vi.advanceTimersByTime(300); r.fire("load"); vi.advanceTimersByTime(6000); }
      expect(r.out[r.out.length - 1]).toBe("failed");                       // gaveUp owns the status
      const r2 = await retryRig();
      r2.fire("loading"); r2.fire("requesterror", { code: 503 }); r2.fire("load");   // error, then the slow cell: a retry is pending
      expect(r2.out).toEqual(["loading"]);                                   // "retrying…" stays; "loaded" did not overwrite it
    } finally { vi.useRealTimers(); }
  });
  it("status: a row that gave up reads 'loaded' again once the NEXT request cycle succeeds (gaveUp is cleared by 'loading')", async () => {
    vi.useFakeTimers();
    try {
      const r = await retryRig();
      for (let i = 0; i < 6; i++) { r.fire("loading"); r.fire("requesterror", { code: 503 }); vi.advanceTimersByTime(300); r.fire("load"); vi.advanceTimersByTime(6000); }
      expect(r.out[r.out.length - 1]).toBe("failed");
      r.fire("loading"); r.fire("load"); vi.advanceTimersByTime(10);                // the service is back
      expect(r.out[r.out.length - 1]).not.toBe("failed");
    } finally { vi.useRealTimers(); }
  });
  it("status: once the retry has FIRED, a clean load reports the row again (retryPending is cleared by the timer)", async () => {
    vi.useFakeTimers();
    try {
      const r = await retryRig();
      r.fire("loading"); r.fire("requesterror", { code: 503 }); r.fire("load");
      vi.advanceTimersByTime(8000);                                                 // the retry fires (refresh)
      expect(r.refreshes).toBe(1);
      r.fire("load");                                                               // …and its cell answers cleanly, with no new "loading" seen
      expect(r.out[r.out.length - 1]).not.toBe("loading");
    } finally { vi.useRealTimers(); }
  });
  it("status: several cells failing in ONE cycle trip the cap, but the retry that follows owns the status even when no 'loading' fires (a slower cell is still in flight)", async () => {
    vi.useFakeTimers();
    try {
      const r = await retryRig();
      r.fire("loading");
      for (let i = 0; i < 4; i++) r.fire("requesterror", { code: 503 });          // four cells 503 in one cycle: tries reaches the cap, the row reads failed
      expect(r.out[r.out.length - 1]).toBe("failed");
      vi.advanceTimersByTime(8000);                                                  // the pending retry fires refresh(); the overlapping request means NO "loading" event
      expect(r.refreshes).toBeGreaterThan(0);
      r.fire("load");                                                                // everything finally answers
      expect(r.out[r.out.length - 1]).not.toBe("failed");
    } finally { vi.useRealTimers(); }
  });
  it("status: a stale refusal does not outlive the retry that re-asks (no 'loading' fires for an overlapping refresh)", async () => {
    vi.useFakeTimers();
    try {
      const r = await retryRig();
      r.fire("loading"); r.fire("overbudget", {}); r.fire("requesterror", { code: 503 });
      vi.advanceTimersByTime(8000);                                                  // the retry's refresh() overlaps a slow cell: no "loading"
      r.fire("load");                                                                // the view has changed; everything answered cleanly
      expect(r.out[r.out.length - 1]).not.toBe("loading");
      expect(r.out[r.out.length - 1]).not.toBe("failed");
    } finally { vi.useRealTimers(); }
  });
  it("retries: a recovered blip + a healthy cycle start the count over (cycleErr is cleared by the next 'loading')", async () => {
    vi.useFakeTimers();
    try {
      const r = await retryRig();
      r.fire("loading"); r.fire("load"); r.fire("requesterror", { code: 503 }); vi.advanceTimersByTime(5000);   // a blip: 1 retry used
      r.fire("loading"); r.fire("load"); vi.advanceTimersByTime(5000);                                             // healthy cycle → reset
      r.refreshes = 0;
      for (let i = 0; i < 8; i++) { r.fire("loading"); r.fire("load"); r.fire("requesterror", { code: 503 }); vi.advanceTimersByTime(8000); }
      expect(r.refreshes).toBe(3);                                            // the full budget again, not 2
    } finally { vi.useRealTimers(); }
  });
  it("retries: the legacy `{ error: { code } }` shape still counts, and a 403 never retries", async () => {
    vi.useFakeTimers();
    try {
      const r = await retryRig();
      r.fire("loading"); r.fire("load"); r.fire("requesterror", { error: { code: 403 } }); vi.advanceTimersByTime(8000);
      expect(r.refreshes).toBe(0);
      r.fire("loading"); r.fire("load"); r.fire("requesterror", { error: { code: 503 } }); vi.advanceTimersByTime(8000);
      expect(r.refreshes).toBe(1);
    } finally { vi.useRealTimers(); }
  });
  it("budget: the held-growth term is clamped — a lighter held feature cannot offset a heavy NEW one in the same batch", async () => {
    vi.resetModules(); mocks();
    const { buildFeatureLayerForTest } = await import("../src/workspaces/site-planner/lib/layers.js");
    const lyr = buildFeatureLayerForTest({ url: "https://example.test/FeatureServer/0", label: "Clamp", color: "#000", vertexBudget: 250000 }, 1, "pane");
    const refused = []; lyr.on("overbudget", (e) => refused.push(e));
    lyr.createLayers([{ id: 1, ...poly(100000) }]);
    lyr.createLayers([{ id: 1, ...poly(10000) }, { id: 2, ...poly(260000) }]);   // −90k and +260k: the batch cap judges the +260k, not the net +170k
    expect(refused).toHaveLength(1);
  });
  it("budget: feature id 0 is a real id (tracked, so its repeats are free)", async () => {
    vi.resetModules(); mocks();
    const { buildFeatureLayerForTest } = await import("../src/workspaces/site-planner/lib/layers.js");
    const lyr = buildFeatureLayerForTest({ url: "https://example.test/FeatureServer/0", label: "Id zero", color: "#000", vertexBudget: 250000 }, 1, "pane");
    const refused = []; lyr.on("overbudget", (e) => refused.push(e));
    for (let i = 0; i < 8; i++) lyr.createLayers([{ id: 0, ...poly(100000) }]);   // 8 × 100k > the 500k total if each repeat were charged
    expect(refused).toHaveLength(0);
  });
  it("budget: the same id twice in ONE batch is one feature (the total does not drift above what is held)", async () => {
    vi.resetModules(); mocks();
    const { buildFeatureLayerForTest } = await import("../src/workspaces/site-planner/lib/layers.js");
    const lyr = buildFeatureLayerForTest({ url: "https://example.test/FeatureServer/0", label: "Dup ids", color: "#000", vertexBudget: 250000 }, 1, "pane");
    const refused = []; lyr.on("overbudget", (e) => refused.push(e));
    for (let i = 0; i < 4; i++) lyr.createLayers([{ id: 5 + i, ...poly(100000) }, { id: 5 + i, ...poly(100000) }]);   // 4 distinct features = 400k < 500k (8 × 100k would refuse)
    expect(refused).toHaveLength(0);
  });
  it("budget: after the 2-level zoom re-ask the total is what is still ON the map, not zero", async () => {
    vi.resetModules(); mocks();
    const { buildFeatureLayerForTest } = await import("../src/workspaces/site-planner/lib/layers.js");
    const lyr = buildFeatureLayerForTest({ url: "https://example.test/FeatureServer/0", label: "Re-ask", color: "#000", vertexBudget: 250000, simplifyFactor: 6 }, 1, "pane");
    const map = { z: 10, h: {}, getZoom() { return this.z; }, on(n, h) { this.h[n] = h; }, off() {} };
    lyr._map = map; lyr.refresh = () => {};
    (lyr.handlers.add || []).forEach((h) => h()); (lyr.handlers.load || []).forEach((h) => h());   // fetched at z10
    const refused = []; lyr.on("overbudget", (e) => refused.push(e));
    for (const id of [1, 2, 3]) lyr.createLayers([{ id, ...poly(100000) }]);                         // 300k on the map
    map.z = 12; map.h.zoomend();                                                                      // the re-ask
    lyr.createLayers([{ id: 4, ...poly(150000) }]);                                                   // 450k ≤ 500k
    expect(refused).toHaveLength(0);
    lyr.createLayers([{ id: 5, ...poly(100000) }]);                                                   // 550k > 500k — only if the total survived the re-ask
    expect(refused).toHaveLength(1);
  });
  /* NEW-1 review of B2521584, finding 7: esri-leaflet takes a feature off the map when its cell leaves the view and puts it back with addLayers; the budget must follow what is ON the map */
  it("budget: panning out and back — a cell that left the view stops counting, and counts again when it returns", async () => {
    vi.resetModules(); mocks();
    const { buildFeatureLayerForTest } = await import("../src/workspaces/site-planner/lib/layers.js");
    const lyr = buildFeatureLayerForTest({ url: "https://example.test/FeatureServer/0", label: "Pan", color: "#000", vertexBudget: 250000 }, 1, "pane");
    const refused = []; lyr.on("overbudget", (e) => refused.push(e));
    const leave = (ids, permanent = false) => ids.forEach((id) => lyr.fire("removefeature", { feature: { id }, permanent }));
    const enter = (ids) => ids.forEach((id) => lyr.fire("addfeature", { feature: { id } }));
    for (const id of [1, 2, 3, 4]) lyr.createLayers([{ id, ...poly(100000) }]);        // view A: 400k on the map (total 500k)
    leave([1, 2, 3, 4]);                                                                  // pan to B
    for (const id of [5, 6, 7, 8]) lyr.createLayers([{ id, ...poly(100000) }]);        // view B: 400k — 800k "ever seen" would be refused
    expect(refused).toHaveLength(0);
    leave([5, 6, 7, 8]); enter([1, 2, 3, 4]);                                             // pan back to A
    lyr.createLayers([{ id: 9, ...poly(90000) }]);                                       // 490k on the map ≤ 500k
    expect(refused).toHaveLength(0);
    lyr.createLayers([{ id: 10, ...poly(20000) }]);                                      // 510k > 500k — A really is back on the map
    expect(refused).toHaveLength(1);
  });
  it("budget: a re-delivery of a feature that is off the map is charged when it comes back, and a permanent removal forgets it", async () => {
    vi.resetModules(); mocks();
    const { buildFeatureLayerForTest } = await import("../src/workspaces/site-planner/lib/layers.js");
    const lyr = buildFeatureLayerForTest({ url: "https://example.test/FeatureServer/0", label: "Pan2", color: "#000", vertexBudget: 250000 }, 1, "pane");
    const refused = []; lyr.on("overbudget", (e) => refused.push(e));
    for (const id of [1, 2, 3, 4]) lyr.createLayers([{ id, ...poly(100000) }]);        // 400k
    lyr.fire("removefeature", { feature: { id: 1 }, permanent: false });                 // off the map: 300k
    lyr.createLayers([{ id: 1, ...poly(100000) }]);                                      // delivered again → back on the map: 400k, not 500k+
    lyr.createLayers([{ id: 11, ...poly(100000) }]);                                     // 500k, still within the total
    expect(refused).toHaveLength(0);
    lyr.createLayers([{ id: 12, ...poly(1000) }]);                                       // 501k → refused: the credit was not double-counted
    expect(refused).toHaveLength(1);
    lyr.fire("removefeature", { feature: { id: 2 }, permanent: true });                  // gone for good
    lyr.createLayers([{ id: 12, ...poly(1000) }]);                                       // 401k + 1k: fits again
    expect(refused).toHaveLength(1);
  });
});
