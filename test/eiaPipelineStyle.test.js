/* NEW-2 (follow-up to B1994512) — the four EIA pipeline layers draw in a DELIBERATE style, never Leaflet's default.
 *
 * MEASURED 2026-10-05 on the real built app, Georgia plan, gas layer on: 5 paths stroke #c2410c weight 2.2 and 11
 * paths stroke #3388ff weight 3 opacity 0.8 — in the SAME pane. ROOT CAUSE (not just the colour): the row's opacity
 * setter restyled the layer with a bare `{ opacity }`, esri-leaflet keeps the last style it was given for every
 * feature it fetches afterwards, so every line loaded after the first opacity write was born with Leaflet's default
 * stroke. The fix is at that source (`featureBaseStyle`, one definition for construction AND the setter), and the
 * EIA rows now carry a full per-feature `styleFn` in the Texas RRC commodity classes (pipelineCommodity.js).
 * The rendered-stroke assertion on the real map is in ui-audit/verify-eia-pipelines.mjs. */
import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";

vi.mock("esri-leaflet", () => ({ dynamicMapLayer: vi.fn(), imageMapLayer: vi.fn(), featureLayer: vi.fn(), tiledMapLayer: vi.fn() }));
vi.mock("../src/workspaces/site-planner/lib/evidenceLayers.js", () => ({ overpassLayer: vi.fn(), mapillaryLayer: vi.fn() }));
vi.mock("../src/workspaces/site-planner/lib/terrainLayers.js", () => ({ contourLayer: vi.fn(), flowLayer: vi.fn() }));
vi.mock("../src/workspaces/site-planner/lib/vectorOverlay.js", () => ({
  cachedVectorLayer: vi.fn(() => null), cachedPipelineLayer: vi.fn(() => null), cachedCorridorLayer: vi.fn(() => null), isPointFeature: vi.fn(),
}));
vi.mock("../src/workspaces/site-planner/lib/mapSymbols.js", () => ({ installDefaultMarkerIcon: vi.fn(), pointToLayerFor: vi.fn() }));

import { ALL_LAYERS } from "../src/workspaces/site-planner/lib/layers.js";
import { featureLayerOptions, featureBaseStyle } from "../src/workspaces/site-planner/lib/layerRequest.js";
import { COMMODITY_BUCKETS, commodityBucketRecord } from "../src/workspaces/site-planner/lib/pipelineCommodity.js";

const EIA = { eia_gas: "gas", eia_petroleum: "refined", eia_crude: "crude", eia_hgl: "hvl" };
const LEAFLET_DEFAULT = "#3388ff";
// every blue the map already uses for water: Leaflet default, the CO2 commodity blue, NHD/flood rows in the registry.
const waterBlues = () => {
  const out = new Set([LEAFLET_DEFAULT, commodityBucketRecord("co2").color.toLowerCase()]);
  for (const [k, c] of Object.entries(ALL_LAYERS)) if (/stream|flood|fema|nhd|hydro|nwi|wetland|ditch/i.test(k + " " + (c.label || "")) && c.color) out.add(String(c.color).toLowerCase());
  return out;
};

describe("EIA pipeline layers — deliberate style (NEW-2)", () => {
  for (const [id, bucket] of Object.entries(EIA)) {
    it(`${id}: stroke is the Texas RRC "${bucket}" class, not Leaflet's default and not a water blue`, () => {
      const cfg = ALL_LAYERS[id]; const b = commodityBucketRecord(bucket);
      const st = featureLayerOptions(cfg, 1, "p").style({ properties: {} });
      expect(st.color).toBe(b.color);
      expect(st.weight).toBe(Math.min(b.weight, 3));
      expect((st.dashArray || null)).toBe(b.dash || null);
      expect(st.color.toLowerCase()).not.toBe(LEAFLET_DEFAULT);
      expect(waterBlues().has(st.color.toLowerCase())).toBe(false);
      expect(cfg.color).toBe(b.color); // the Layers-panel swatch reads the same colour
    });
    it(`${id}: the same default strength as the Texas pipeline layer (0.85) — colour and dash carry the hierarchy`, () => {
      expect(ALL_LAYERS[id].opacity).toBe(0.85);
    });
  }

  it("the four layers are told apart (colour or dash), and are all different from each other", () => {
    const sig = Object.keys(EIA).map((id) => { const s = featureLayerOptions(ALL_LAYERS[id], 1, "p").style({}); return `${s.color}|${s.dashArray || ""}`; });
    expect(new Set(sig).size).toBe(4);
  });

  it("an OPACITY change re-derives the whole style (the leak: a bare {opacity} left new features default-blue)", () => {
    for (const id of Object.keys(EIA)) {
      const st = ALL_LAYERS[id].styleFn({}, 0.4);
      expect(st.opacity).toBe(0.4);
      expect(st.color).toBe(commodityBucketRecord(EIA[id]).color);
    }
  });

  it("featureBaseStyle (every flat esriFeature row) always carries its own colour + weight", () => {
    expect(featureBaseStyle({ color: "#123456", weight: 4 }, 0.5)).toEqual({ color: "#123456", weight: 4, opacity: 0.5, fillOpacity: 0 });
    expect(featureBaseStyle({}, 1).color).not.toBe(LEAFLET_DEFAULT);
  });

  it("source guard: the flat opacity setter restyles through featureBaseStyle, never a bare { opacity }", () => {
    const src = readFileSync(new URL("../src/workspaces/site-planner/lib/layers.js", import.meta.url), "utf8");
    expect(src).toMatch(/featureBaseStyle\(cfg, oo\)/);
    expect(src).not.toMatch(/: \{ opacity: oo \}\)\)/);
  });

  it("every commodity bucket the EIA rows use exists in the Texas palette", () => {
    const keys = COMMODITY_BUCKETS.map((b) => b.key);
    for (const b of Object.values(EIA)) expect(keys).toContain(b);
  });
});
