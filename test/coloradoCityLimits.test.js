/* Colorado city limits (2026-11-24) — a Colorado site read "Couldn't check city limits" because Colorado had a COUNTY row and NO CITY row:
 * no city source was ever asked, so containment stayed "unknown". RED-PROOF: both tests fail on the pre-fix code.
 * The sweep is the class guard: every state the app routes a county lookup for must route a city lookup too. */
import { describe, it, expect, vi } from "vitest";
vi.mock("esri-leaflet", () => ({ dynamicMapLayer: vi.fn(), imageMapLayer: vi.fn(), featureLayer: vi.fn(), tiledMapLayer: vi.fn() }));
vi.mock("../src/workspaces/site-planner/lib/evidenceLayers.js", () => ({ overpassLayer: vi.fn(), mapillaryLayer: vi.fn() }));
vi.mock("../src/workspaces/site-planner/lib/terrainLayers.js", () => ({ contourLayer: vi.fn(), flowLayer: vi.fn(), TERRAIN_MIN_ZOOM: 13 }));
vi.mock("../src/workspaces/site-planner/lib/vectorOverlay.js", () => ({ cachedVectorLayer: vi.fn(), cachedPipelineLayer: vi.fn(), cachedCorridorLayer: vi.fn(), isPointFeature: vi.fn() }));
vi.mock("../src/workspaces/site-planner/lib/mapSymbols.js", () => ({ installDefaultMarkerIcon: vi.fn(), pointToLayerFor: vi.fn() }));
import { JURISDICTION_SOURCES, countySourcesForPoint, citySourcesForPoint, identifyJurisdiction, formatJurisdictionBadge } from "../src/workspaces/site-planner/lib/jurisdiction.js";
import { createGisCache } from "../src/workspaces/site-planner/lib/gisCache.js";

const store = () => { const m = new Map(); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => { m.set(k, v); }, removeItem: (k) => m.delete(k), get length() { return m.size; }, key: (i) => [...m.keys()][i] ?? null }; };
const BRIGHTON = [-104.8205, 39.9853];
// One representative point per county-routed state (lng, lat).
const POINTS = { TX_Katy: [-95.79, 29.78], CO_Brighton: BRIGHTON, CO_Denver: [-104.99, 39.74], GA_Atlanta: [-84.388, 33.749], TN_Nashville: [-86.78, 36.16],
  MS_Southaven: [-90.0, 34.99], CA_LA: [-118.2437, 34.0522], NJ_Newark: [-74.17, 40.735], NY_Albany: [-73.757, 42.653] };

describe("every county-routed point also routes a city lookup", () => {
  for (const [name, [lng, lat]] of Object.entries(POINTS)) {
    it(name, () => {
      expect(countySourcesForPoint(lat, lng).length).toBeGreaterThan(0);
      const city = citySourcesForPoint(lat, lng).filter((s) => s && s.url);
      expect(city.length, `${name}: no city-limits source routed — the badge would say "Couldn't check city limits" with no request`).toBeGreaterThan(0);
    });
  }
  it("Colorado routes the DOLA row, never a Texas one", () => {
    expect(citySourcesForPoint(BRIGHTON[1], BRIGHTON[0])).toEqual([JURISDICTION_SOURCES.cityCo]);
  });
});

describe("Brighton CO (Adams County) resolves city limits end to end", () => {
  const run = (cityFeatures) => identifyJurisdiction(BRIGHTON[0], BRIGHTON[1], {
    cache: createGisCache({ store: store(), now: () => 1_000_000 }), roles: ["county", "city", "etj"],
    fetchJson: async (url) => {
      if (url.includes("Colorado_Counties")) return { features: [{ attributes: { NAME20: "Adams", GEOID20: "08001" } }] };
      if (url.includes("Municipal_Boundary")) return { features: cityFeatures };
      throw new Error("no route for " + url);
    },
  });
  it("inside a municipality: the city is named and containment is known", async () => {
    const j = await run([{ attributes: { cityname: "Brighton" } }]);
    expect(j.cityContainment).not.toBe("unknown");
    expect(j.city).toContain("Brighton");
  });
  it("outside every municipality: unincorporated, not unknown", async () => {
    const j = await run([]);
    expect(j.cityContainment).toBe("none");
    expect(j.unincorporated).toBe(true);
  });
});
