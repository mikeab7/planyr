/* NEW-4 — the visual-hierarchy guard.
 *
 * The owner's report: with ten layers on, "the site plan is buried… nothing recedes and the
 * plan the owner is designing is the least legible thing on his own screen. They are all
 * shouting at the same volume."
 *
 * He was describing a measurable fact. Eighteen of twenty-two layers shipped their default
 * opacity inside a single 0.10 band (0.85–0.95), each value picked in isolation months apart.
 * The fix is a declared model (lib/layerWeight.js) plus this guard — because the previous state
 * was not one bad decision, it was the ABSENCE of a decision, and only a machine check stops
 * that re-accumulating one reasonable exception at a time.
 */
import { describe, it, expect, vi } from "vitest";

// layers.js pulls in Leaflet-facing modules that need a DOM — stub the five offenders (their
// values are unused by ALL_LAYERS, which is a pure config object). Same pattern as
// test/coverage.test.js.
vi.mock("esri-leaflet", () => ({ dynamicMapLayer: vi.fn(), imageMapLayer: vi.fn(), featureLayer: vi.fn(), tiledMapLayer: vi.fn() }));
vi.mock("../src/workspaces/site-planner/lib/evidenceLayers.js", () => ({ overpassLayer: vi.fn(), mapillaryLayer: vi.fn() }));
vi.mock("../src/workspaces/site-planner/lib/terrainLayers.js", () => ({ contourLayer: vi.fn(), flowLayer: vi.fn(), TERRAIN_MIN_ZOOM: 13 }));
vi.mock("../src/workspaces/site-planner/lib/vectorOverlay.js", () => ({ cachedVectorLayer: vi.fn(), cachedPipelineLayer: vi.fn(), cachedCorridorLayer: vi.fn(), isPointFeature: vi.fn() }));
vi.mock("../src/workspaces/site-planner/lib/mapSymbols.js", () => ({ installDefaultMarkerIcon: vi.fn(), pointToLayerFor: vi.fn() }));

import { ALL_LAYERS } from "../src/workspaces/site-planner/lib/layers.js";
import {
  hierarchyProblems, unpinnedDynamicLayers, sweepableLayerIds, tierOf, isExempt,
  defaultOpacityFor, defaultWeightFor, TIER_MAX_OPACITY, TIER_MAX_WEIGHT, LAYER_TIER, TIERS,
} from "../src/workspaces/site-planner/lib/layerWeight.js";

describe("the shipped layer registry", () => {
  it("satisfies the hierarchy — every layer within its tier's ceilings", () => {
    expect(hierarchyProblems(ALL_LAYERS)).toEqual([]);
  });

  it("declares a tier for EVERY layer (no silent fallback)", () => {
    const undeclared = Object.keys(ALL_LAYERS).filter((id) => !isExempt(id) && !tierOf(id));
    expect(undeclared).toEqual([]);
  });

  it("pins the sublayers of every server-rendered layer", () => {
    // An unpinned `/export` renders EVERY default-visible sublayer, and agency services publish
    // label sublayers beside their data (the RRC's layer 0 is literally "Well Number", drawn at
    // parcel zoom). That is how numbered labels end up scattered across the buildings.
    expect(unpinnedDynamicLayers(ALL_LAYERS)).toEqual([]);
  });

  it("the plan-burying defaults are genuinely gone — nothing reference-or-quieter above 0.55", () => {
    const loud = Object.entries(ALL_LAYERS)
      .filter(([id, c]) => !isExempt(id) && tierOf(id) !== "constraint" && typeof c.opacity === "number" && c.opacity > 0.55)
      .map(([id, c]) => `${id}=${c.opacity}`);
    expect(loud).toEqual([]);
  });

  it("the tiers are actually SEPARATED — not three names for the same volume", () => {
    // The whole complaint was that everything sat in one narrow band. Assert the model spreads.
    expect(TIER_MAX_OPACITY.constraint).toBeGreaterThan(TIER_MAX_OPACITY.reference);
    expect(TIER_MAX_OPACITY.reference).toBeGreaterThan(TIER_MAX_OPACITY.context);
    expect(TIER_MAX_OPACITY.constraint - TIER_MAX_OPACITY.context).toBeGreaterThanOrEqual(0.4);
    expect(TIER_MAX_WEIGHT.constraint).toBeGreaterThan(TIER_MAX_WEIGHT.context);
  });

  it("the constraint tier holds the things that actually stop you building", () => {
    for (const id of ["fema", "wetlands", "txrrc_pipe", "faults", "bkdd_easements", "hcfcd_row"]) {
      expect(tierOf(id), id).toBe("constraint");
    }
  });

  it("orientation furniture is in the quietest tier", () => {
    for (const id of ["jur_county", "jur_city", "jur_isd", "txdot_aadt", "faa_airports"]) {
      expect(tierOf(id), id).toBe("context");
    }
  });
});

describe("the guard actually fails", () => {
  // A guard never shown red is a hope. Each of these is a real regression shape.
  it("rejects a too-loud reference layer", () => {
    const problems = hierarchyProblems({ txrrc_wells: { kind: "vector", opacity: 0.95 } });
    expect(problems.some((p) => /exceeds the "reference" ceiling/.test(p))).toBe(true);
  });

  it("rejects a too-heavy context line", () => {
    expect(hierarchyProblems({ jur_county: { kind: "vector", weight: 4 } })
      .some((p) => /exceeds the "context" ceiling/.test(p))).toBe(true);
  });

  it("rejects a brand-new layer with no declared tier", () => {
    expect(hierarchyProblems({ some_new_layer: { kind: "vector", opacity: 0.5 } })
      .some((p) => /no declared tier/.test(p))).toBe(true);
  });

  it("rejects a server-rendered layer that leaves its sublayers unpinned", () => {
    expect(hierarchyProblems({ fema: { kind: "dynamic", opacity: 0.5, layers: null } })
      .some((p) => /no pinned/.test(p))).toBe(true);
    expect(hierarchyProblems({ fema: { kind: "dynamic", opacity: 0.5, layers: [] } })
      .some((p) => /no pinned/.test(p))).toBe(true);
  });
});

describe("the clamps", () => {
  it("never RAISE a layer that already ships quieter than its ceiling", () => {
    // The ceilings are a maximum, not a target — a big translucent wash should stay a wash.
    expect(defaultOpacityFor("fema", 0.35)).toBeCloseTo(0.35, 5);
    expect(defaultWeightFor("jur_county", 1.0)).toBeCloseTo(1.0, 5);
  });

  it("leave the drawing surface alone", () => {
    // Terrain and the aerial are the ground, not reference drawn over it. Fading them is not
    // what "I can't see my plan" means.
    for (const id of ["elevation", "contours", "flowdir"]) {
      expect(defaultOpacityFor(id, 1), id).toBe(1);
      expect(isExempt(id), id).toBe(true);
    }
  });

  it("every declared tier is one of the three", () => {
    for (const [id, t] of Object.entries(LAYER_TIER)) expect(TIERS, id).toContain(t);
  });
});

describe("turn all reference layers off (the escape hatch)", () => {
  it("sweeps EVERY overlay — including terrain, which the owner turned on the same way", () => {
    // Exempt-from-the-ceilings and exempt-from-the-sweep are different questions, and the first
    // cut of this module conflated them: contours kept their full weight (right — a hairline over
    // a building is the B1205 rule) but were also skipped by the sweep (wrong — the owner asked
    // for one click that "leaves the plan and the basemap", and contours are neither).
    const ids = sweepableLayerIds(ALL_LAYERS);
    for (const id of ["fema", "txrrc_wells", "contours", "elevation", "flowdir"]) expect(ids, id).toContain(id);
    // The basemap needs no exemption: it is its own segmented control, not an overlay row.
    expect(ids).not.toContain("basemap");
    expect(ids).not.toContain("aerial");
  });

  it("is derived from the live registry, so a new layer is swept the day it lands", () => {
    const ids = sweepableLayerIds({ ...ALL_LAYERS, brand_new: { kind: "vector" } });
    expect(ids).toContain("brand_new");
  });
});
