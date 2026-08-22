/* B685200 (NEW-1, owner chat block 2026-08-22) — the WIRING half of the fix.
 * `test/layerZoomGate.test.js` proves the pure state machine now folds an `"unregistered"`
 * status into dormant-blank; this file proves `syncOverlayLayers` (layers.js) actually reports
 * that state — not the generic `"failed"` — the moment a `vector`/`vectorLine`/
 * `pipelineCorridor` registry row has no matching source wired up.
 *
 * Live repro: "Water & sanitation districts (Colorado)" (`co_water_districts`, `kind: "vector"`)
 * is a real ALL_LAYERS row with NO matching `VECTOR_SOURCES` entry in vectorLayers.js — the
 * exact registry-drift shape this test drives. `vectorOverlay.js` is mocked below (the house
 * pattern for every test that loads layers.js in a node env), so `cachedVectorLayer` returning
 * null is asserted explicitly rather than relied on as the mock's default.
 */
import { describe, it, expect, vi } from "vitest";

vi.mock("esri-leaflet", () => ({ dynamicMapLayer: vi.fn(), imageMapLayer: vi.fn(), featureLayer: vi.fn(), tiledMapLayer: vi.fn() }));
vi.mock("../src/workspaces/site-planner/lib/evidenceLayers.js", () => ({ overpassLayer: vi.fn(), mapillaryLayer: vi.fn() }));
vi.mock("../src/workspaces/site-planner/lib/terrainLayers.js", () => ({ contourLayer: vi.fn(), flowLayer: vi.fn() }));
vi.mock("../src/workspaces/site-planner/lib/vectorOverlay.js", () => ({
  cachedVectorLayer: vi.fn(() => null),
  cachedPipelineLayer: vi.fn(() => null),
  cachedCorridorLayer: vi.fn(() => null),
  isPointFeature: vi.fn(),
}));
vi.mock("../src/workspaces/site-planner/lib/mapSymbols.js", () => ({ installDefaultMarkerIcon: vi.fn(), pointToLayerFor: vi.fn() }));

import { syncOverlayLayers } from "../src/workspaces/site-planner/lib/layers.js";

// A minimal Leaflet-map stand-in — just enough surface for syncOverlayLayers to get past its
// readiness checks and reach the per-layer branch (the test/tileLifecycle.test.js fake-object
// pattern, sized to what this function actually touches).
function fakeMap() {
  const panes = {};
  return {
    _loaded: true,
    getSize: () => ({ x: 800, y: 600 }),
    getPane: (name) => panes[name],
    createPane: (name) => { const el = { style: {} }; panes[name] = el; return el; },
    whenReady(cb) { cb(); },
    on() {}, off() {},
  };
}

describe("syncOverlayLayers — a registry-drift layer reports \"unregistered\", never the generic \"failed\"", () => {
  it("⛔ B685200 — a `vector` row with no VECTOR_SOURCES entry reports \"unregistered\" with the diagnostic message", () => {
    const onStatus = vi.fn();
    const overlays = { co_water_districts: { on: true, opacity: 0.8 } };
    syncOverlayLayers(fakeMap(), overlays, {}, { onStatus });
    expect(onStatus).toHaveBeenCalledWith("co_water_districts", "loading");
    expect(onStatus).toHaveBeenCalledWith(
      "co_water_districts", "unregistered",
      expect.stringContaining("no vector source registered"),
    );
    expect(onStatus).not.toHaveBeenCalledWith("co_water_districts", "failed", expect.anything());
  });

  it("B685200 — a `vectorLine` row with no source reports \"unregistered\" too", () => {
    const onStatus = vi.fn();
    // txrrc_pipe is a real `vectorLine` row; the mock above returns null regardless of which
    // key is asked, simulating the same registry-drift shape for this kind.
    const overlays = { txrrc_pipe: { on: true, opacity: 0.8 } };
    syncOverlayLayers(fakeMap(), overlays, {}, { onStatus });
    expect(onStatus).toHaveBeenCalledWith(
      "txrrc_pipe", "unregistered",
      expect.stringContaining("no vector source registered"),
    );
  });

  it("B685200 — a `pipelineCorridor` row with no source reports \"unregistered\" too", () => {
    const onStatus = vi.fn();
    const overlays = { txrrc_pipe_easement: { on: true, opacity: 0.8, widthFt: 50 } };
    syncOverlayLayers(fakeMap(), overlays, {}, { onStatus });
    expect(onStatus).toHaveBeenCalledWith(
      "txrrc_pipe_easement", "unregistered",
      expect.stringContaining("no pipeline source registered"),
    );
  });
});
