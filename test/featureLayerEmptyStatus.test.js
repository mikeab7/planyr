/* NEW-2 (B323424 ×2, owner report 2026-08-22 — Goose Creek, Baytown) — an `esriFeature` layer
 * (EPA Superfund/RCRA, Rail lines, faults, AADT, airports, transmission lines, substations, road
 * authority — the whole kind) used to report "loaded" the instant it mounted, before its query
 * had even answered, and never revisited that verdict against how many features actually came
 * back. So a genuinely empty query — past the zoom gate, in coverage — still showed a solid
 * "loaded" dot with no signal at all: the exact "checked box, filled dot, empty map" failure
 * B323424 was written to prevent, just from a different cause (no feature-count check in this
 * kind's status wiring) than the zoom-gate case it originally fixed.
 *
 * `County boundaries` / `City limits & ETJ` (`vector` kind) and `Pipelines` (`vectorLine` kind)
 * were audited and are NOT this bug — `vectorOverlay.js`'s `cachedVectorLayer`/`cachedPipelineLayer`
 * already count real features and report "empty" honestly (see the `report(n ? "loaded" : "empty"...)`
 * calls there). This test covers only the confirmed gap: the `esriFeature` runtime wiring.
 */
import { describe, it, expect, vi } from "vitest";

// layers.js pulls in Leaflet-facing modules that need a DOM — stub them so it loads in the node
// test environment (the test/layerZoomGate.test.js pattern).
vi.mock("esri-leaflet", () => ({ dynamicMapLayer: vi.fn(), imageMapLayer: vi.fn(), featureLayer: vi.fn(), tiledMapLayer: vi.fn() }));
vi.mock("../src/workspaces/site-planner/lib/evidenceLayers.js", () => ({ overpassLayer: vi.fn(), mapillaryLayer: vi.fn() }));
vi.mock("../src/workspaces/site-planner/lib/terrainLayers.js", () => ({ contourLayer: vi.fn(), flowLayer: vi.fn() }));
vi.mock("../src/workspaces/site-planner/lib/vectorOverlay.js", () => ({ cachedVectorLayer: vi.fn(), cachedPipelineLayer: vi.fn(), cachedCorridorLayer: vi.fn(), isPointFeature: vi.fn() }));
vi.mock("../src/workspaces/site-planner/lib/mapSymbols.js", () => ({ installDefaultMarkerIcon: vi.fn(), pointToLayerFor: vi.fn() }));

import { attachFeatureRetry } from "../src/workspaces/site-planner/lib/layers.js";

// A minimal esri-leaflet-shaped fake: `.on(event, cb)` registers a handler this test can fire
// directly, and `._currentSnapshot` is the private field FeatureManager tracks the current
// viewport's feature ids in (node_modules/esri-leaflet/src/Layers/FeatureLayer/FeatureManager.js).
function fakeFeatureLayer(snapshot) {
  const handlers = {};
  return {
    _currentSnapshot: snapshot,
    on(evt, cb) { handlers[evt] = cb; return this; },
    fire(evt, ...args) { if (handlers[evt]) handlers[evt](...args); },
  };
}

describe("attachFeatureRetry: an esriFeature layer's \"load\" reports what it actually found", () => {
  it("a genuinely empty answer reports \"empty\", never \"loaded\"", () => {
    const lyr = fakeFeatureLayer([]);
    const onStatus = vi.fn();
    attachFeatureRetry(lyr, "env_cleanups", { label: "EPA Superfund / RCRA" }, onStatus);
    lyr.fire("load");
    expect(onStatus).toHaveBeenCalledWith("env_cleanups", "empty", expect.any(String));
    expect(onStatus).not.toHaveBeenCalledWith("env_cleanups", "loaded");
  });

  it("a real answer with features still reports \"loaded\"", () => {
    const lyr = fakeFeatureLayer(["f1", "f2", "f3"]);
    const onStatus = vi.fn();
    attachFeatureRetry(lyr, "bts_rail", { label: "Rail lines" }, onStatus);
    lyr.fire("load");
    expect(onStatus).toHaveBeenCalledWith("bts_rail", "loaded", null);
  });

  it("an unreadable snapshot shape (esri-leaflet internals changed) falls back to \"loaded\", never guesses \"empty\"", () => {
    const lyr = fakeFeatureLayer(undefined);
    const onStatus = vi.fn();
    attachFeatureRetry(lyr, "faults", { label: "Faults" }, onStatus);
    lyr.fire("load");
    expect(onStatus).toHaveBeenCalledWith("faults", "loaded", null);
  });

  it("a retry that eventually succeeds with zero features still reports empty, not loaded", () => {
    const lyr = fakeFeatureLayer([]);
    const onStatus = vi.fn();
    attachFeatureRetry(lyr, "env_cleanups", { label: "EPA Superfund / RCRA" }, onStatus, 3);
    lyr.fire("requesterror", { error: { code: 503 } });
    lyr.fire("load"); // the retried request eventually lands, honestly empty
    const lastCall = onStatus.mock.calls[onStatus.mock.calls.length - 1];
    expect(lastCall[0]).toBe("env_cleanups");
    expect(lastCall[1]).toBe("empty");
  });
});
