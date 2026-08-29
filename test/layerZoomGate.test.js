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
  layerMinZoom, levelsToGate, layerVisibility, combineVisibility, dormantZoomLine, DORMANT_BLANK_LINE,
  TERRAIN_MIN_ZOOM, OSM_MIN_ZOOM, MAPILLARY_MIN_ZOOM, ESRI_FEATURE_DEFAULT_MIN_ZOOM, GATE_CLEARANCE,
  PLACE_NAMES_MIN_ZOOM,
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

/* B427410 (×2) — RECURRENCE. The first fix renamed a bare "Labels" checkbox to "Place names";
 * the owner asked the identical "what does this do" question again, because the layer behind it
 * (Esri's road/highway transportation reference tiles) never carried city/landmark names, and
 * because below its own zoom gate the checkbox stayed checked while drawing nothing — a silent
 * no-op (LOUD-FAILURE). These guards pin the two halves of the actual fix: the panel and the map
 * read ONE gate constant (never two literals that can drift, the same OSM_MIN_ZOOM discipline),
 * and the wording says what is really drawn. Both assertions fail on the pre-fix source: it had
 * no `PLACE_NAMES_MIN_ZOOM` import and its wording claimed "City, road and landmark names". */
describe("PLACE_NAMES_MIN_ZOOM — the map-finder road-names overlay's own gate", () => {
  it("is declared once, at the value the map has always actually used", () => {
    expect(PLACE_NAMES_MIN_ZOOM).toBe(14);
  });

  it("MapFinder reads the shared constant rather than a private literal '14'", () => {
    const m = readFileSync(join(HERE, "..", "src", "workspaces", "site-planner", "MapFinder.jsx"), "utf8");
    expect(m).toMatch(/from\s+"\.\/lib\/layerZoomGate\.js"/);
    expect(m).toMatch(/PLACE_NAMES_MIN_ZOOM/);
    // The two places that used to hardcode the zoom threshold must both read the constant now.
    expect(m).toMatch(/getZoom\(\)\s*>=\s*PLACE_NAMES_MIN_ZOOM/);
    expect(m).toMatch(/zoom\s*>=\s*PLACE_NAMES_MIN_ZOOM/);
  });

  it("LayerPanel's dormant note is keyed off the same constant, not a re-guessed number", () => {
    const p = readFileSync(join(HERE, "..", "src", "workspaces", "site-planner", "components", "LayerPanel.jsx"), "utf8");
    expect(p).toMatch(/PLACE_NAMES_MIN_ZOOM/);
    expect(p).toMatch(/mapZoom\s*<\s*PLACE_NAMES_MIN_ZOOM/);
  });

  it("the control is named 'Road names' — the honest label — and 'Place names' is gone", () => {
    const p = readFileSync(join(HERE, "..", "src", "workspaces", "site-planner", "components", "LayerPanel.jsx"), "utf8");
    expect(p).toMatch(/>Road names</);
    expect(p).not.toMatch(/>Place names</);
  });

  it("the help text says what's drawn and disclaims the city/landmark promise it used to make", () => {
    const p = readFileSync(join(HERE, "..", "src", "workspaces", "site-planner", "components", "LayerPanel.jsx"), "utf8");
    const section = p.slice(p.indexOf('label="Road names"'), p.indexOf('label="Road names"') + 600);
    expect(section).toMatch(/road/i);
    expect(section).toMatch(/highway/i);
    expect(section).toMatch(/does not carry city/i);
  });
});

/* B427410 (×3) — AMENDMENT. Owner, verbatim: "I kinda want road names to just be there… right
 * now they're always kind of opaque [muddy]… or maybe let me adjust the opacity." Two guards:
 * the DEFAULT changed from the old context-tier 0.4 to a measured-crisp 0.85 (see MapFinder.jsx's
 * own header comment for the real-tile comparison this came from), and the SAME `opacityControl`
 * every other row in this panel already uses is wired to it — never a second slider component.
 * Both fail on the pre-fix (×2) source: it had no `opacityControl(` call for Road names and its
 * only opacity value anywhere near this control was the hardcoded `0.4`. */
describe("PLACE_NAMES_DEFAULT_OPACITY — the owner's crispness fix + his own opacity control", () => {
  it("MapFinder no longer hardcodes the old muddy 0.4 for this layer", () => {
    const m = readFileSync(join(HERE, "..", "src", "workspaces", "site-planner", "MapFinder.jsx"), "utf8");
    expect(m).toMatch(/PLACE_NAMES_DEFAULT_OPACITY\s*=\s*0\.85/);
    // Both places that used to read the literal `0.4` for this layer now read the shared default.
    expect(m).toMatch(/PLACE_NAMES_MIN_ZOOM\s*\)\s*\?\s*labelsOpacity\s*:\s*0/);
    expect(m).toMatch(/PLACE_NAMES_MIN_ZOOM\s*\?\s*labelsOpacity\s*:\s*0/);
  });

  it("the state feeding the map layer starts at the measured default, not a re-guessed number", () => {
    const m = readFileSync(join(HERE, "..", "src", "workspaces", "site-planner", "MapFinder.jsx"), "utf8");
    expect(m).toMatch(/useState\(PLACE_NAMES_DEFAULT_OPACITY\)/);
  });

  it("LayerPanel wires Road names through the SAME opacityControl every other row uses", () => {
    const p = readFileSync(join(HERE, "..", "src", "workspaces", "site-planner", "components", "LayerPanel.jsx"), "utf8");
    // Only one opacityControl DEFINITION may exist (the shared helper) — this asserts the Road
    // names row is a CALLER of it, not a second widget.
    expect((p.match(/const opacityControl = \(/g) || []).length).toBe(1);
    expect(p).toMatch(/opacityControl\("Road names", placeNames\.opacity, placeNames\.onOpacityChange\)/);
  });

  it("MapFinder passes the opacity value and setter through the placeNames prop", () => {
    const m = readFileSync(join(HERE, "..", "src", "workspaces", "site-planner", "MapFinder.jsx"), "utf8");
    expect(m).toMatch(/placeNames=\{\{[^}]*opacity:\s*labelsOpacity[^}]*onOpacityChange:\s*setLabelsOpacity/);
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

  /* B685200 (NEW-1, owner chat block 2026-08-22) — a checked layer with NO REGISTERED SOURCE
   * (layers.js's `fail(k, cfg, msg, "unregistered")` — the "no vector/pipeline source
   * registered" registry-drift path) used to fall into this function's default branch and
   * report "drawing", exactly like a genuinely healthy layer. Live evidence: "Water & sewer"
   * on a Texas site, switched on, read `data-layer-state="drawing"` while its own sub-text
   * said "Water & sanitation districts (Colorado) — no vector source registered". A row that
   * admits it has no source cannot be drawing anything. Distinct from "failed" (a live source
   * that errored — genuinely may recover, stays a loud red "drawing" alert, untouched above):
   * "unregistered" can NEVER succeed on any retry, in any environment, for any user, which is
   * exactly the "checked, gate cleared, permanently nothing to draw" shape dormant-blank
   * already models for an honest empty query. */
  it("⛔ B685200 — checked, past the gate, but NO SOURCE IS REGISTERED at all → dormant-blank, never drawing", () => {
    const v = layerVisibility({ cfg: ALL_LAYERS.osm_power, on: true, zoom: 17, status: { state: "unregistered", msg: "Water & sanitation districts (Colorado): no vector source registered" } });
    expect(v.state).toBe("dormant-blank");
    expect(v.why).toBe("no-source");
  });

  it("B685200 — the zoom gate still outranks a registered-source failure, same as every other reason", () => {
    const v = layerVisibility({ cfg: ALL_LAYERS.contours, on: true, zoom: 11, status: { state: "unregistered" } });
    expect(v.state).toBe("dormant-zoom"); // below the gate, nothing was ever asked
  });

  it("B685200 — DORMANT_BLANK_LINE carries a plain, user-facing reason — never the internal registry-drift wording", () => {
    expect(DORMANT_BLANK_LINE["no-source"]).toMatch(/not showing here/i);
    expect(DORMANT_BLANK_LINE["no-source"]).not.toMatch(/vector source registered/i);
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

  /* B685200/B685201 — the exact live shape: a "Water & sewer" style merge group where every
   * member reports genuinely empty except one out-of-region member with no source registered
   * at all. Pre-fix, that one "unregistered" member's `layerVisibility` fell through to
   * "drawing" and `combineVisibility`'s `some(state === "drawing")` took the WHOLE row down
   * that path — a row that admits (in its own sub-text) it has no source for one member still
   * read as confidently drawing. */
  it("⛔ B685200 — a source-less member no longer drags an otherwise-blank merged row into \"drawing\"", () => {
    const emptyTx = { cfg: { kind: "vector" }, zoom: 17, on: true, status: { state: "empty" } };
    const noSourceCo = { cfg: { kind: "vector" }, zoom: 17, on: true, status: { state: "unregistered" } };
    const v = combineVisibility([emptyTx, noSourceCo]);
    expect(v.state).toBe("dormant-blank");
  });
});
