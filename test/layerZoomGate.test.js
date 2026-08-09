/* NEW-1 — the zoom-gate model, and the guard that keeps the PANEL and the MAP agreeing.
 *
 * The owner's report was that a checked-but-suppressed layer is indistinguishable from a broken
 * one. The whole fix rests on the panel knowing, per layer, the zoom the runtime will actually
 * suppress it at — so the dangerous failure is not a wrong pixel, it is the panel and the runtime
 * holding two different numbers and the panel confidently reporting the wrong one. The source
 * sweeps below are therefore the load-bearing tests here, not the arithmetic ones.
 */
import { describe, it, expect, vi } from "vitest";

// layers.js pulls in Leaflet-facing modules that need a DOM — stub them so the registry loads
// in the node test environment (the test/layerConsolidation.test.js pattern).
vi.mock("esri-leaflet", () => ({ dynamicMapLayer: vi.fn(), imageMapLayer: vi.fn(), featureLayer: vi.fn(), tiledMapLayer: vi.fn() }));
vi.mock("../src/workspaces/site-planner/lib/evidenceLayers.js", () => ({ overpassLayer: vi.fn(), mapillaryLayer: vi.fn() }));
vi.mock("../src/workspaces/site-planner/lib/terrainLayers.js", () => ({ contourLayer: vi.fn(), flowLayer: vi.fn() }));
vi.mock("../src/workspaces/site-planner/lib/vectorOverlay.js", () => ({ cachedVectorLayer: vi.fn(), cachedPipelineLayer: vi.fn(), cachedCorridorLayer: vi.fn(), isPointFeature: vi.fn() }));
vi.mock("../src/workspaces/site-planner/lib/mapSymbols.js", () => ({ installDefaultMarkerIcon: vi.fn(), pointToLayerFor: vi.fn() }));

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import {
  layerMinZoom, levelsToGate, layerVisibility, combineVisibility, dormantZoomLine,
  TERRAIN_MIN_ZOOM, OSM_MIN_ZOOM, MAPILLARY_MIN_ZOOM, ESRI_FEATURE_DEFAULT_MIN_ZOOM, GATE_CLEARANCE,
} from "../src/workspaces/site-planner/lib/layerZoomGate.js";
import { ALL_LAYERS } from "../src/workspaces/site-planner/lib/layers.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const src = (rel) => readFileSync(join(HERE, "..", "src", "workspaces", "site-planner", rel), "utf8");

describe("layerMinZoom — what the runtime actually gates on", () => {
  it("reads the registry's declared gate", () => {
    expect(layerMinZoom({ kind: "esriFeature", minZoom: 11 })).toBe(11);
    expect(layerMinZoom({ kind: "vector", minZoom: 9 })).toBe(9);
  });

  it("gives an UNDECLARED esriFeature layer the gate Leaflet is actually handed", () => {
    // featureLayerOptions passes `minZoom: cfg.minZoom ?? 10`. This is the invisible half of the
    // bug family: such a row reports "loaded" (it did) and draws nothing (Leaflet declines).
    expect(layerMinZoom({ kind: "esriFeature" })).toBe(ESRI_FEATURE_DEFAULT_MIN_ZOOM);
    expect(ESRI_FEATURE_DEFAULT_MIN_ZOOM).toBe(10);
  });

  it("gives the kind-gated layers their pipeline's own constant", () => {
    expect(layerMinZoom({ kind: "contours" })).toBe(TERRAIN_MIN_ZOOM);
    expect(layerMinZoom({ kind: "flowdir" })).toBe(TERRAIN_MIN_ZOOM);
    expect(layerMinZoom({ kind: "overpass" })).toBe(OSM_MIN_ZOOM);
    expect(layerMinZoom({ kind: "mapillary" })).toBe(MAPILLARY_MIN_ZOOM);
  });

  it("claims NO gate for a raster export, which draws at any scale", () => {
    expect(layerMinZoom({ kind: "esriDynamic", minZoom: 12 })).toBeNull();
    expect(layerMinZoom({ kind: "esriImage" })).toBeNull();
    // …and none for an undeclared vector layer: below its source's minVectorZoom it still draws,
    // as a flat image. Claiming a gate there would make a DRAWING layer read as dormant.
    expect(layerMinZoom({ kind: "vector" })).toBeNull();
  });
});

describe("the declared gates and the runtime constants may never drift", () => {
  it("the terrain pipeline gates on the same number the registry declares", () => {
    const t = src("lib/terrainLayers.js");
    expect(t).toMatch(/z\s*<\s*TERRAIN_MIN_ZOOM/);
    expect(ALL_LAYERS.contours.minZoom).toBe(TERRAIN_MIN_ZOOM);
    expect(ALL_LAYERS.flowdir.minZoom).toBe(TERRAIN_MIN_ZOOM);
  });

  it("the evidence layers import their gates rather than keeping private copies", () => {
    const e = src("lib/evidenceLayers.js");
    // The two constants must come FROM the shared leaf — a re-declared literal here is exactly
    // how the panel and the map would come to disagree.
    expect(e).toMatch(/from\s+"\.\/layerZoomGate\.js"/);
    expect(e).toMatch(/const MIN_ZOOM = OSM_MIN_ZOOM;/);
    expect(e).toMatch(/const MLY_MIN_ZOOM = MAPILLARY_MIN_ZOOM;/);
    expect(ALL_LAYERS.osm_power.minZoom).toBe(OSM_MIN_ZOOM);
    expect(ALL_LAYERS.mapillary.minZoom).toBe(MAPILLARY_MIN_ZOOM);
  });

  it("the assumed pipeline corridor declares the vector gate it really has", () => {
    // The corridor only exists where the centrelines came back as VECTORS, so its gate is the
    // pipeline source's own minVectorZoom. Read the real registry rather than trusting a comment.
    const v = readFileSync(join(HERE, "..", "src", "workspaces", "site-planner", "lib", "vectorLayers.js"), "utf8");
    const block = v.slice(v.indexOf("txrrc_pipe:"));
    const m = /minVectorZoom:\s*(\d+)/.exec(block);
    expect(m).toBeTruthy();
    expect(ALL_LAYERS.txrrc_pipe_easement.minZoom).toBe(+m[1]);
  });

  it("featureLayerOptions still defaults to the number this module names", () => {
    const r = src("lib/layerRequest.js");
    const m = /minZoom:\s*cfg\.minZoom\s*\?\?\s*(\d+)/.exec(r);
    expect(m).toBeTruthy();
    expect(+m[1]).toBe(ESRI_FEATURE_DEFAULT_MIN_ZOOM);
  });

  it("every layer in the registry gets a definite answer (a gate, or an explicit none)", () => {
    for (const [id, cfg] of Object.entries(ALL_LAYERS)) {
      const z = layerMinZoom(cfg);
      expect(z === null || (typeof z === "number" && z >= 0 && z <= 22), `${id} → ${z}`).toBe(true);
    }
  });
});

describe("levelsToGate — the number the row says out loud", () => {
  it("counts whole levels and is never zero", () => {
    expect(levelsToGate(13, 16)).toBe(3);
    expect(levelsToGate(15.4, 16)).toBe(1);
    expect(levelsToGate(15.99, 16)).toBe(1);
    expect(levelsToGate(10.2, 16)).toBe(6);
  });
  it("says 'level' for one and 'levels' for more", () => {
    expect(dormantZoomLine(1)).toBe("Not showing at this zoom — zoom in 1 level");
    expect(dormantZoomLine(3)).toBe("Not showing at this zoom — zoom in 3 levels");
  });
});

describe("layerVisibility — the four states, which are the four the owner must tell apart", () => {
  const contours = ALL_LAYERS.contours;

  it("unchecked → off, and claims nothing", () => {
    expect(layerVisibility({ cfg: contours, on: false, zoom: 12 }).state).toBe("off");
  });

  it("checked BELOW the gate → dormant-zoom, with the level count and a target past the gate", () => {
    const v = layerVisibility({ cfg: contours, on: true, zoom: 13.2, status: { state: "empty", msg: "Zoom in to ≥ 16 to load" } });
    expect(v.state).toBe("dormant-zoom");
    expect(v.levels).toBe(3);
    expect(v.target).toBeGreaterThan(TERRAIN_MIN_ZOOM);
    expect(v.target).toBe(TERRAIN_MIN_ZOOM + GATE_CLEARANCE);
  });

  it("checked ABOVE the gate → drawing", () => {
    expect(layerVisibility({ cfg: contours, on: true, zoom: 17, status: { state: "loaded" } }).state).toBe("drawing");
  });

  it("checked, past the gate, but the source's data does not reach here → dormant-blank", () => {
    const v = layerVisibility({ cfg: ALL_LAYERS.osm_power, on: true, zoom: 17, coverage: "out" });
    expect(v.state).toBe("dormant-blank");
    expect(v.why).toBe("out-of-area");
  });

  it("checked, past the gate, source answered with nothing → dormant-blank", () => {
    const v = layerVisibility({ cfg: ALL_LAYERS.osm_power, on: true, zoom: 17, status: { state: "empty" } });
    expect(v.state).toBe("dormant-blank");
    expect(v.why).toBe("nothing-here");
  });

  it("⛔ the ZOOM gate outranks coverage — below the gate nothing was ever asked, so 'no data here' would be a fabrication", () => {
    const v = layerVisibility({ cfg: contours, on: true, zoom: 11, coverage: "out", status: { state: "empty" } });
    expect(v.state).toBe("dormant-zoom");
  });

  it("an in-flight layer is not blank — a pending answer is not an answer (LOUD-FAILURE, inverted)", () => {
    const v = layerVisibility({ cfg: ALL_LAYERS.osm_power, on: true, zoom: 17, status: { state: "loading" } });
    expect(v.state).toBe("drawing");
  });

  it("an esriFeature layer that reports LOADED below zoom 10 is still dormant — the case with no text at all", () => {
    const v = layerVisibility({ cfg: { kind: "esriFeature" }, on: true, zoom: 8, status: { state: "loaded" } });
    expect(v.state).toBe("dormant-zoom");
    expect(v.levels).toBe(2);
  });

  it("a failure stays a failure and is never softened into dormancy", () => {
    const v = layerVisibility({ cfg: ALL_LAYERS.osm_power, on: true, zoom: 17, status: { state: "failed", msg: "boom" } });
    expect(v.state).toBe("drawing"); // the row's own red dot + message own this state
  });
});

describe("combineVisibility — a merged row drives several layers with DIFFERENT gates", () => {
  const a = { cfg: { kind: "esriFeature", minZoom: 11 }, zoom: 9, on: true };
  const b = { cfg: { kind: "esriFeature", minZoom: 14 }, zoom: 9, on: true };

  it("is dormant only when every ON member is", () => {
    const drawing = { cfg: { kind: "esriDynamic" }, zoom: 9, on: true };
    expect(combineVisibility([a, b, drawing]).state).toBe("drawing");
  });

  it("offers the SHALLOWEST gate — clearing that is what puts something on the map", () => {
    const v = combineVisibility([a, b]);
    expect(v.state).toBe("dormant-zoom");
    expect(v.minZoom).toBe(11);
    expect(v.levels).toBe(2);
  });

  it("ignores members that are switched off", () => {
    expect(combineVisibility([{ ...a, on: false }, { ...b, on: false }]).state).toBe("off");
  });

  it("a gated member beside a blank one reports blank — no single zoom fixes the row", () => {
    const blank = { cfg: { kind: "esriDynamic" }, zoom: 9, on: true, coverage: "out" };
    expect(combineVisibility([a, blank]).state).toBe("dormant-blank");
  });
});
