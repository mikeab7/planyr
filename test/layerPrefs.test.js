import { describe, it, expect, vi } from "vitest";

// layers.js pulls in Leaflet-facing modules that need a DOM — stub them so the module
// loads in the node test environment (same pattern as test/coverage.test.js).
vi.mock("esri-leaflet", () => ({ dynamicMapLayer: vi.fn(), imageMapLayer: vi.fn(), featureLayer: vi.fn(), tiledMapLayer: vi.fn() }));
vi.mock("../src/workspaces/site-planner/lib/evidenceLayers.js", () => ({ overpassLayer: vi.fn(), mapillaryLayer: vi.fn() }));
vi.mock("../src/workspaces/site-planner/lib/terrainLayers.js", () => ({ contourLayer: vi.fn(), flowLayer: vi.fn(), TERRAIN_MIN_ZOOM: 13 }));
vi.mock("../src/workspaces/site-planner/lib/vectorOverlay.js", () => ({ cachedVectorLayer: vi.fn(), cachedPipelineLayer: vi.fn(), cachedCorridorLayer: vi.fn() }));

import { ALL_LAYERS, defaultOverlayState } from "../src/workspaces/site-planner/lib/layers.js";
import {
  sanitizeLayerOverrides, overridesFromOverlays, overlaysWithOverrides, applyOnOverrides, overridesSig,
} from "../src/workspaces/site-planner/lib/layerPrefs.js";
import { createSiteModel, mergeSiteContent } from "../src/workspaces/site-planner/lib/siteModel.js";

/* NEW-1 — per-site GIS Layers-panel toggle memory. These pin the acceptance criteria: restore an
 * enabled layer on reload, keep new/never-opened sites on defaults, remember an OFF override, ignore
 * layers newly added to the registry (they show with their default), self-prune stale keys, and carry
 * the tiny map through the site-model persistence + cross-copy merge (newer-wins) path. */

// A real registry layer key that defaults OFF (every layer defaults off today) — pick FEMA, the
// motivating case, and one more so multi-key ordering is exercised.
const FEMA = "fema";
const NWI = "wetlands";

describe("layerPrefs — sanitize", () => {
  it("keeps only boolean values on real registry keys; drops garbage / stale / non-registry keys", () => {
    expect(sanitizeLayerOverrides({ [FEMA]: true, [NWI]: false })).toEqual({ [FEMA]: true, [NWI]: false });
    expect(sanitizeLayerOverrides({ [FEMA]: "yes", nope: true, ghostLayer: true })).toEqual({});
    expect(sanitizeLayerOverrides(null)).toEqual({});
    expect(sanitizeLayerOverrides([1, 2])).toEqual({}); // an array is not a valid map
    expect(sanitizeLayerOverrides(undefined)).toEqual({});
  });
});

describe("layerPrefs — project overlays → sparse overrides", () => {
  it("emits a key ONLY when its on-state differs from the layer default (all layers default off)", () => {
    const ov = defaultOverlayState();
    expect(overridesFromOverlays(ov)).toEqual({}); // untouched = no overrides
    ov[FEMA] = { ...ov[FEMA], on: true };
    expect(overridesFromOverlays(ov)).toEqual({ [FEMA]: true });
  });
  it("never emits a key that isn't in the current registry", () => {
    const ov = { ...defaultOverlayState(), ghostLayer: { on: true } };
    expect(overridesFromOverlays(ov)).toEqual({}); // ghostLayer ignored — not a registry default
  });
  it("does NOT record opacity — a visibility-only projection", () => {
    const ov = defaultOverlayState();
    ov[FEMA] = { ...ov[FEMA], opacity: 0.1 }; // opacity changed, still off
    expect(overridesFromOverlays(ov)).toEqual({});
  });
});

describe("layerPrefs — apply saved overrides → full overlays", () => {
  it("rebuilds fresh defaults then flips the saved on-states", () => {
    const ov = overlaysWithOverrides({ [FEMA]: true });
    expect(ov[FEMA].on).toBe(true);
    expect(ov[NWI].on).toBe(false);
    // every registry layer is present with its default opacity
    for (const k of Object.keys(ALL_LAYERS)) {
      expect(ov[k]).toBeTruthy();
      expect(ov[k].opacity).toBe(ALL_LAYERS[k].opacity ?? 0.8);
    }
  });
  it("a layer newly added to the registry (absent from a saved map) shows with its default (off)", () => {
    // Simulate an OLD saved map that predates FEMA being on: only NWI recorded.
    const ov = overlaysWithOverrides({ [NWI]: true });
    expect(ov[NWI].on).toBe(true);
    expect(ov[FEMA].on).toBe(false); // not in the saved map → default
  });
  it("ignores a stale/removed key", () => {
    const ov = overlaysWithOverrides({ ghostLayer: true, [FEMA]: true });
    expect(ov[FEMA].on).toBe(true);
    expect(ov.ghostLayer).toBeUndefined();
  });
});

describe("layerPrefs — round-trip stability", () => {
  it("apply → project is the identity for a valid sparse map", () => {
    const saved = { [FEMA]: true, [NWI]: false };
    // NWI:false is a no-op vs the default (off), so the projection drops it — the STABLE form is
    // just the layers that actually differ from default.
    expect(overridesFromOverlays(overlaysWithOverrides(saved))).toEqual({ [FEMA]: true });
    // a pure on-set round-trips exactly
    expect(overridesFromOverlays(overlaysWithOverrides({ [FEMA]: true }))).toEqual({ [FEMA]: true });
  });
});

describe("layerPrefs — applyOnOverrides preserves opacity (undo restore)", () => {
  it("flips on/off per the override map but keeps each layer's live opacity", () => {
    const live = defaultOverlayState();
    live[FEMA] = { on: true, opacity: 0.2 };   // user turned FEMA on AND dimmed it
    live[NWI] = { on: true, opacity: 0.9 };
    // restore a snapshot where only FEMA was on
    const restored = applyOnOverrides(live, { [FEMA]: true });
    expect(restored[FEMA].on).toBe(true);
    expect(restored[FEMA].opacity).toBe(0.2); // opacity untouched
    expect(restored[NWI].on).toBe(false);     // not in the snapshot → default off
    expect(restored[NWI].opacity).toBe(0.9);  // opacity preserved, not reset to default
  });
  it("returns the same object reference for a layer whose on-state is unchanged", () => {
    const live = defaultOverlayState();
    const before = live[NWI];
    const out = applyOnOverrides(live, { [FEMA]: true });
    expect(out[NWI]).toBe(before); // untouched layer keeps identity
  });
});

describe("layerPrefs — signature", () => {
  it("is stable regardless of key order and empty for no overrides", () => {
    expect(overridesSig({})).toBe("");
    expect(overridesSig({ [NWI]: true, [FEMA]: true })).toBe(overridesSig({ [FEMA]: true, [NWI]: true }));
    expect(overridesSig({ [FEMA]: true })).not.toBe(overridesSig({ [FEMA]: false }));
  });
});

describe("siteModel — layerOverrides persistence", () => {
  it("defaults to an empty object for a legacy record with no field (today's behavior)", () => {
    expect(createSiteModel({}).layerOverrides).toEqual({});
  });
  it("carries a boolean map through, coercing away non-booleans", () => {
    const m = createSiteModel({ layerOverrides: { [FEMA]: true, [NWI]: false, junk: "x" } });
    expect(m.layerOverrides).toEqual({ [FEMA]: true, [NWI]: false });
  });
  it("survives the normalize round-trip (createSiteModel is idempotent on it)", () => {
    const once = createSiteModel({ layerOverrides: { [FEMA]: true } });
    const twice = createSiteModel(once);
    expect(twice.layerOverrides).toEqual({ [FEMA]: true });
  });
  it("cross-copy merge is newer-wins on layerOverrides (like any scalar field)", () => {
    const older = createSiteModel({ id: "s1", updatedAt: 1000, layerOverrides: { [FEMA]: true }, parcels: [{ id: "p1", points: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }] }] });
    const newer = createSiteModel({ id: "s1", updatedAt: 2000, layerOverrides: { [NWI]: true }, parcels: [{ id: "p1", points: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }] }] });
    expect(mergeSiteContent(older, newer).layerOverrides).toEqual({ [NWI]: true }); // newer wins
    expect(mergeSiteContent(newer, older).layerOverrides).toEqual({ [NWI]: true }); // order-independent (by updatedAt)
  });
});
