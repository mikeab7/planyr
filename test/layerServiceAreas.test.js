/* B2436066 (Imagery & Layers NEW-3) — a source is listed only where it serves, and both surfaces answer the same for the same point.
 *
 * THE FINDING (measured): the planner's flood scoping reasoned over `floodCounty`, which is `null` whenever the site identify names MORE
 * THAN ONE county (a Baytown site straddles Harris and Chambers) or has not resolved — and a null county FAILS OPEN, so every Houston
 * source was listed. The map finder's county (`countyForView`) is never null, so it hid them. On top of that the old `houston` region was a
 * 65-mile circle that holds Chambers, Galveston and Brazoria, whose rows never answer. The rule is now location-only: each row declares
 * the real boundary it serves (lib/serviceAreas.js) and both hosts + the map's draw filter ask the SAME function with the SAME point. */
import { describe, it, expect, beforeAll, vi } from "vitest";
import { readFileSync } from "node:fs";

// layers.js pulls in Leaflet-facing modules that need a DOM — stub them (ALL_LAYERS is a pure config object). Same block as layerStateCoverage.
vi.mock("esri-leaflet", () => ({ dynamicMapLayer: vi.fn(), imageMapLayer: vi.fn(), featureLayer: vi.fn(), tiledMapLayer: vi.fn() }));
vi.mock("../src/workspaces/site-planner/lib/evidenceLayers.js", () => ({ overpassLayer: vi.fn(), mapillaryLayer: vi.fn() }));
vi.mock("../src/workspaces/site-planner/lib/terrainLayers.js", () => ({ contourLayer: vi.fn(), flowLayer: vi.fn(), TERRAIN_MIN_ZOOM: 13 }));
vi.mock("../src/workspaces/site-planner/lib/vectorOverlay.js", () => ({
  cachedVectorLayer: vi.fn(), cachedPipelineLayer: vi.fn(), cachedCorridorLayer: vi.fn(), isPointFeature: vi.fn(),
}));
vi.mock("../src/workspaces/site-planner/lib/mapSymbols.js", () => ({ installDefaultMarkerIcon: vi.fn(), pointToLayerFor: vi.fn() }));
import { SERVICE_AREAS } from "../src/workspaces/site-planner/lib/serviceAreaData.js";
import { _setServiceAreas, areaContains, PROBE_DEG } from "../src/workspaces/site-planner/lib/serviceAreas.js";
import { ALL_LAYERS } from "../src/workspaces/site-planner/lib/layers.js";
import { REGION_ZONES, layerAvailableHere, availableEntries, groupEntriesFor, drawnOverlaysOf, inRegion } from "../src/workspaces/site-planner/lib/layerPanelModel.js";
import { floodRowRelevance, scopeFloodEntries } from "../src/workspaces/site-planner/lib/floodGroup.js";

const P = {
  grandPort: { lat: 29.807276, lng: -94.877079 },       // Chambers · Baytown ETJ (the owner's plan)
  montBelvieu: { lat: 29.85, lng: -94.89 },             // Chambers
  houston: { lat: 29.7604, lng: -95.3698 },             // Harris, inside Houston
  baytownHarris: { lat: 29.74, lng: -94.97 },           // Harris, outside Houston limits + ETJ
  katyBkdd: { lat: 29.779, lng: -95.895 },              // inside the Brookshire–Katy Drainage District
  sugarLand: { lat: 29.5994, lng: -95.6349 },           // Fort Bend
  texasCity: { lat: 29.40, lng: -94.935 },              // Galveston
};
const HCFCD = "hcfcd_row", COH = ["coh_storm", "coh_ww", "coh_water", "coh_hydrants"], BKDD = ["bkdd_drainage", "bkdd_easements", "bkdd_dmp"];
const showing = (pt) => Object.keys(ALL_LAYERS).filter((id) => layerAvailableHere(ALL_LAYERS[id], { state: "TX", loc: pt }));
const has = (ids, pt) => ids.map((id) => showing(pt).includes(id));

beforeAll(() => _setServiceAreas(SERVICE_AREAS));

describe("the declared service areas", () => {
  it("every region name a registry row declares exists — a typo would silently fail open", () => {
    const names = new Set();
    for (const cfg of Object.values(ALL_LAYERS)) for (const r of cfg.regions || []) names.add(r);
    for (const r of names) expect(REGION_ZONES[r] || SERVICE_AREAS[r], `region "${r}" is declared nowhere`).toBeTruthy();
  });
  it("the 65-mile 'houston' circle is gone; only the growth-fault STUDY extent keeps a circle", () => {
    expect(REGION_ZONES.houston).toBeUndefined();
    expect(ALL_LAYERS.faults.regions).toEqual(["houston_metro"]);
  });
  it("each Houston-area source declares the area it actually serves", () => {
    expect(ALL_LAYERS[HCFCD].regions).toEqual(["harris"]);
    for (const id of COH) expect(ALL_LAYERS[id].regions, id).toEqual(["houston"]);
    for (const id of BKDD) expect(ALL_LAYERS[id].regions, id).toEqual(["bkdd"]);
  });
  it("points land where they should", () => {
    expect(areaContains("harris", P.houston)).toBe(true);
    expect(areaContains("houston", P.houston)).toBe(true);
    expect(areaContains("harris", P.baytownHarris)).toBe(true);
    expect(areaContains("houston", P.baytownHarris)).toBe(false);  // Baytown has its own city + ETJ
    expect(areaContains("bkdd", P.katyBkdd)).toBe(true);
    for (const k of ["grandPort", "montBelvieu", "sugarLand", "texasCity"]) {
      for (const a of ["harris", "houston", "bkdd"]) expect(areaContains(a, P[k]), `${k}/${a}`).toBe(false);
    }
  });
  it("an approximation errs towards SHOWING: a point just outside an edge but within the probe still counts", () => {
    // a point PROBE_DEG/2 south of Harris's northern edge is inside by probe even if the simplified edge sits a hair off
    const edge = SERVICE_AREAS.harris.polys[0][0].reduce((m, [, y]) => Math.max(m, y), -90);
    const top = SERVICE_AREAS.harris.polys[0][0].find(([, y]) => y === edge);
    expect(areaContains("harris", { lat: edge + PROBE_DEG / 2, lng: top[0] })).toBe(true);
    expect(areaContains("harris", { lat: edge + PROBE_DEG * 3, lng: top[0] })).toBe(false);
  });
});

describe("which rows a site gets (the adjacent cases)", () => {
  it("a Harris County site INSIDE Houston: the Houston and HCFCD rows show", () => {
    expect(has([HCFCD, ...COH], P.houston).every(Boolean)).toBe(true);
    expect(has(BKDD, P.houston)).toEqual([false, false, false]); // downtown is outside the Brookshire–Katy district
  });
  it("a Harris County site OUTSIDE Houston: HCFCD shows, the City of Houston storm sewer does not", () => {
    expect(has([HCFCD], P.baytownHarris)).toEqual([true]);
    expect(has(COH, P.baytownHarris)).toEqual([false, false, false, false]);
  });
  it("a Fort Bend site: no HCFCD, no City of Houston, no BKDD", () => {
    expect(has([HCFCD, ...COH, ...BKDD], P.sugarLand).some(Boolean)).toBe(false);
  });
  it("a Chambers site (Grand Port and Mont Belvieu): none of the HCFCD / City of Houston / BKDD rows", () => {
    for (const pt of [P.grandPort, P.montBelvieu]) expect(has([HCFCD, ...COH, ...BKDD], pt).some(Boolean)).toBe(false);
  });
  it("a Galveston site: none of them", () => {
    expect(has([HCFCD, ...COH, ...BKDD], P.texasCity).some(Boolean)).toBe(false);
  });
  it("a site inside BKDD: the three BKDD rows show, HCFCD and the City do not", () => {
    expect(has(BKDD, P.katyBkdd)).toEqual([true, true, true]);
    expect(has([HCFCD, ...COH], P.katyBkdd).some(Boolean)).toBe(false);
  });
  it("Flood & Drainage at Grand Port is exactly FEMA + streams — what the finder showed at Mont Belvieu", () => {
    for (const pt of [P.grandPort, P.montBelvieu]) {
      const ids = availableEntries(groupEntriesFor(ALL_LAYERS, "flood"), { state: "TX", loc: pt }).map(([id]) => id).sort();
      expect(ids).toEqual(["fema", "nhd_flowlines"]);
    }
  });
});

describe("one answer for the panel, the map and both surfaces", () => {
  it("the planner's null county no longer lets the Houston rows through at Grand Port", () => {
    const scope = { state: "TX", loc: P.grandPort };
    const entries = availableEntries(groupEntriesFor(ALL_LAYERS, "flood"), scope);
    // the planner with its county UNRESOLVED / multi-county (null): the district rules fail open — which is exactly the old bug…
    const open = scopeFloodEntries(Object.entries(ALL_LAYERS).filter(([, c]) => c.group === "flood" && (!c.states || c.states.includes("TX"))), { county: null });
    expect(open.tiers.flatMap((t) => t.rows).map(([id]) => id)).toEqual(expect.arrayContaining([HCFCD, ...BKDD, "coh_storm"]));
    // …and the location rule alone now removes them, with the county still null
    const scoped = scopeFloodEntries(entries, { county: null });
    expect(scoped.tiers.flatMap((t) => t.rows).map(([id]) => id).sort()).toEqual(["fema", "nhd_flowlines"]);
    expect(floodRowRelevance(ALL_LAYERS[HCFCD], { county: null }).relevant).toBe(true); // (the fail-open that was the planner's input)
  });
  it("the panel's list and the map's draw filter are the SAME decision for every point", () => {
    for (const [name, pt] of Object.entries(P)) {
      const scope = { state: "TX", loc: pt };
      const allOn = Object.fromEntries(Object.keys(ALL_LAYERS).map((id) => [id, { on: true }]));
      const drawn = drawnOverlaysOf(allOn, { scope, layers: ALL_LAYERS });
      for (const id of Object.keys(ALL_LAYERS)) {
        expect(!!drawn[id].on, `${name}/${id}`).toBe(layerAvailableHere(ALL_LAYERS[id], scope));
      }
    }
  });
  it("both hosts hand the panel + draw filter the same two facts — state and location — and nothing county-shaped", () => {
    const planner = readFileSync(new URL("../src/workspaces/site-planner/SitePlanner.jsx", import.meta.url), "utf8");
    const finder = readFileSync(new URL("../src/workspaces/site-planner/MapFinder.jsx", import.meta.url), "utf8");
    expect(planner).toMatch(/useDrawnOverlays\(overlaysEff, layerScopeState, origin \? \{ lat: origin\.lat, lng: origin\.lon \} : null\)/);
    expect(finder).toMatch(/useDrawnOverlays\(overlays, viewState, viewLoc\)/);
    expect(planner).toMatch(/siteLocation=\{origin \? \{ lat: origin\.lat, lng: origin\.lon \} : null\}/);
    expect(finder).toMatch(/siteLocation=\{viewLoc\}/);
  });
  it("unknown location, unloaded geometry and a missing area all fail OPEN", () => {
    expect(layerAvailableHere(ALL_LAYERS[HCFCD], { state: "TX", loc: null })).toBe(true);
    expect(inRegion("harris", null)).toBeNull();
    expect(inRegion("harris", { lat: NaN, lng: 1 })).toBeNull();
    _setServiceAreas(null);
    try {
      expect(areaContains("harris", P.grandPort)).toBeNull();
      expect(layerAvailableHere(ALL_LAYERS[HCFCD], { state: "TX", loc: P.grandPort })).toBe(true); // not loaded → never hides
    } finally { _setServiceAreas(SERVICE_AREAS); }
  });
  it("a layer left ON where its source does not serve is kept in saved state and simply not drawn", () => {
    const ov = { [HCFCD]: { on: true, opacity: 0.5 }, fema: { on: true } };
    const drawn = drawnOverlaysOf(ov, { scope: { state: "TX", loc: P.grandPort }, layers: ALL_LAYERS });
    expect(drawn[HCFCD].on).toBe(false);
    expect(drawn.fema.on).toBe(true);
    expect(ov[HCFCD].on).toBe(true); // the saved state is untouched
  });
});
