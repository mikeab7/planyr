/* Part A (Georgia screening) — ONE registry decides which layers a site's state sees.
 *
 * Every layer row carries its coverage: `states: [...]` for a state's own data, or NO `states` for a national
 * source. The Layers panel (LayerPanel.outOfState) reads exactly that field and nothing else, so the audit below IS
 * the audit of what a Georgia / Texas / Colorado site is shown.
 *
 * The national list is DECLARED here, by name. A new layer with no `states` therefore fails this test until someone
 * states, in this file, that it really is national — which is the moment "is this a Texas institution?" gets asked.
 * (Michael, 2026-10-04: Houston/Texas-only layers come OFF for non-Texas sites; national ones stay.) */
import { describe, it, expect, vi } from "vitest";

vi.mock("esri-leaflet", () => ({ dynamicMapLayer: vi.fn(), imageMapLayer: vi.fn(), featureLayer: vi.fn(), tiledMapLayer: vi.fn() }));
vi.mock("../src/workspaces/site-planner/lib/evidenceLayers.js", () => ({ overpassLayer: vi.fn(), mapillaryLayer: vi.fn() }));
vi.mock("../src/workspaces/site-planner/lib/terrainLayers.js", () => ({ contourLayer: vi.fn(), flowLayer: vi.fn() }));
vi.mock("../src/workspaces/site-planner/lib/vectorOverlay.js", () => ({
  cachedVectorLayer: vi.fn(), cachedPipelineLayer: vi.fn(), cachedCorridorLayer: vi.fn(), isPointFeature: vi.fn(),
}));
vi.mock("../src/workspaces/site-planner/lib/mapSymbols.js", () => ({ installDefaultMarkerIcon: vi.fn(), pointToLayerFor: vi.fn() }));

import { ALL_LAYERS, JLAYERS } from "../src/workspaces/site-planner/lib/layers.js";
import { GIS_SOURCES } from "../src/shared/gis/sources.js";
import { STATE_ENVELOPES, STATE_POLYGONS } from "../src/workspaces/site-planner/lib/siteRegion.js";

/* National sources — shown on every site. FEMA, NWI, EPA, rail/airports, OSM, HIFLD, Mapillary, USGS NHD and 3DEP. */
const NATIONAL = [
  "fema", "wetlands", "env_cleanups", "bts_rail", "faa_airports", "elevation", "contours", "flowdir",
  "osm_power", "hifld_tx", "hifld_substations", "osm_hydrants", "mapillary", "nhd_flowlines", "soil_bedrock", "bts_truck_network", "hpms_aadt",
].sort();

/* Texas-only — HCFCD, TxRRC, TxDOT, BKDD, the Texas county groups, ETJ/MUD, CCN, TCEQ, the growth faults. */
const TEXAS_ONLY = [
  "txrrc_pipe", "txrrc_pipe_easement", "txrrc_wells", "ccn_service", "env_lpst", "faults", "txdot_aadt",
  "jur_county", "jur_city", "jur_etj", "jur_isd", "jur_mud", "jur_road_authority", "coh_hydrants", "hcfcd_row",
  "coh_ww", "coh_storm", "coh_water", "bkdd_drainage", "bkdd_easements", "bkdd_dmp", "fb_contours",
];

/* Shared by Florida AND Georgia (PR #1902): the EIA approximate pipeline layers. */
const SHARED_FL_GA = ["eia_gas", "eia_petroleum", "eia_crude", "eia_hgl"];
const GEORGIA = ["ga_county", "ga_city", "ga_hsi", "ga_ust", "ga_nrhp", "ga_cemeteries", "ga_crit_habitat", "ga_gopher_tortoise", "ga_trout", "ga_stream_buffers", "ga_slope"];
const idsWhere = (pred) => Object.entries(ALL_LAYERS).filter(([, c]) => pred(c)).map(([k]) => k);

describe("the layer registry's state coverage", () => {
  it("the set of layers with NO state scope is exactly the declared national list", () => {
    expect(idsWhere((c) => !c.states).sort()).toEqual(NATIONAL);
  });
  it("every Texas institution's layer is Texas-only — hidden for a Georgia site", () => {
    for (const id of TEXAS_ONLY) expect(ALL_LAYERS[id].states, id).toEqual(["TX"]);
  });
  it("every per-county group in counties.js (Harris, Fort Bend, Chambers, Waller…) is Texas-only", () => {
    expect(Object.keys(JLAYERS).length).toBeGreaterThan(0);
    for (const [id, cfg] of Object.entries(JLAYERS)) expect(cfg.states, id).toEqual(["TX"]);
  });
  it("every state code used is one siteState() can actually return", () => {
    const known = new Set([...Object.keys(STATE_ENVELOPES), ...Object.keys(STATE_POLYGONS)]);
    for (const [id, c] of Object.entries(ALL_LAYERS)) for (const st of c.states || []) expect(known.has(st), `${id}: ${st}`).toBe(true);
  });
  it("every Georgia layer is Georgia-only, and each is in the declared Georgia set", () => {
    for (const id of GEORGIA) expect(ALL_LAYERS[id].states, id).toEqual(["GA"]);
    for (const id of SHARED_FL_GA) expect(ALL_LAYERS[id].states, id).toEqual(["FL", "GA"]);
    expect(idsWhere((c) => (c.states || []).includes("GA")).sort()).toEqual([...GEORGIA, ...SHARED_FL_GA].sort());
  });
  it("no layer is both national and scoped, and no row lists an empty scope (an empty list would hide it everywhere)", () => {
    for (const [id, c] of Object.entries(ALL_LAYERS)) if (c.states) expect(c.states.length, id).toBeGreaterThan(0);
  });
  it("Georgia gets no Texas layer and Texas gets no Georgia layer, by construction", () => {
    const shownIn = (st) => Object.entries(ALL_LAYERS).filter(([, c]) => !c.states || c.states.includes(st)).map(([k]) => k);
    const ga = shownIn("GA"), tx = shownIn("TX");
    for (const id of TEXAS_ONLY) expect(ga, id).not.toContain(id);
    for (const id of [...GEORGIA, ...SHARED_FL_GA]) expect(tx, id).not.toContain(id);
    for (const id of NATIONAL) { expect(ga, id).toContain(id); expect(tx, id).toContain(id); }
  });
});

describe("every Georgia layer row is complete (a row an inline comment swallowed once rendered as a blank checkbox)", () => {
  it("each carries a label, a source, a note, a role, a group and an order", () => {
    for (const id of GEORGIA) {
      const c = ALL_LAYERS[id];
      expect(typeof c.label, `${id} label`).toBe("string");
      expect(c.label.length, `${id} label`).toBeGreaterThan(3);
      expect(c.source || c.kind === "vector", `${id} source`).toBeTruthy();
      expect(c.note, `${id} note`).toBeTruthy();
      expect(["area", "line", "point"], `${id} role`).toContain(c.role);
      expect(typeof c.order, `${id} order`).toBe("number");
    }
  });
  it("the slope row lives in the Base & terrain list (the group renders TERRAIN's entries, not a filter of the registry)", async () => {
    const { TERRAIN } = await import("../src/workspaces/site-planner/lib/layers.js");
    expect(Object.keys(TERRAIN)).toContain("ga_slope");
  });
});

describe("the Georgia GIS registry rows", () => {
  const KEYS = ["countyGa", "cityGa", "hsiGa", "ustGa", "troutGa", "mngwpd", "critHabitat", "gopherTortoiseGa", "nrhp", "cemeteries"];
  it("each is Georgia-scoped, production-tier, and not on a test/staging path", () => {
    for (const k of KEYS) {
      const s = GIS_SOURCES[k];
      expect(s.states, k).toEqual(["GA"]);
      expect(s.tier, k).toBe("production");
      expect(s.serviceUrl, k).not.toMatch(/\/Test\/|staging|geogimstest/i);
    }
  });
});
