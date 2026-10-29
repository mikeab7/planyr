/* NEW-1 (Florida, B2452976) — the Florida due-diligence layer rows.
 *
 * What this pins, each of which an adversarial reading of the work would attack:
 *   · SCOPE   — every Florida row is `states:["FL"]`, so a Texas / Georgia / Colorado / Tennessee view lists none of them; a county- or district-only
 *               source also declares a real `regions` boundary (a Tampa site is not offered a Broward wellfield row, a Broward site is not offered
 *               Miami-Dade's).
 *   · SOURCES — every row reads a registry endpoint (GIS_SOURCES), every relayed host is on the relay allow-list, and every row is complete (label, source, note, role,
 *               group, order, an identify path) — an inline `//` comment once swallowed a row's label.
 *   · NUMBERS — the only regulatory numbers printed are the publisher's own (Broward's 250 / 500 / 1,320 ft; Miami-Dade's 10 / 30 / 100 / 210 days) and a legend
 *               colour is the colour the map paints for that class.
 *   · TEXAS   — a Florida site is offered no Texas institution and the Texas golden master is untouched (their own suites).
 */
import { describe, it, expect, vi, beforeAll } from "vitest";

vi.mock("esri-leaflet", () => ({ dynamicMapLayer: vi.fn(), imageMapLayer: vi.fn(), featureLayer: vi.fn(), tiledMapLayer: vi.fn() }));
vi.mock("../src/workspaces/site-planner/lib/evidenceLayers.js", () => ({ overpassLayer: vi.fn(), mapillaryLayer: vi.fn() }));
vi.mock("../src/workspaces/site-planner/lib/terrainLayers.js", () => ({ contourLayer: vi.fn(), flowLayer: vi.fn(), TERRAIN_MIN_ZOOM: 13 }));
vi.mock("../src/workspaces/site-planner/lib/vectorOverlay.js", () => ({
  cachedVectorLayer: vi.fn(), cachedPipelineLayer: vi.fn(), cachedCorridorLayer: vi.fn(), isPointFeature: vi.fn(),
}));
vi.mock("../src/workspaces/site-planner/lib/mapSymbols.js", () => ({ installDefaultMarkerIcon: vi.fn(), pointToLayerFor: vi.fn() }));

import { ALL_LAYERS, layerVintage } from "../src/workspaces/site-planner/lib/layers.js";
import {
  FLORIDA_LAYERS, FLORIDA_VINTAGE, FLORIDA_RELAY, relayUrl, districtName, evacColor, EVAC_RAMP, evacStyle,
  EVAC_OTHER, BROWARD_WELLFIELD_RAMP, browardWellfieldStyle, MDC_TRAVEL_RAMP, mdcWellfieldStyle, mdcTravelDays, erpTypeLabel, ERP_TYPES as ERP_TYPES_FOR_TEST,
} from "../src/workspaces/site-planner/lib/floridaLayers.js";
import { GIS_SOURCES, statesFor, auditRegistry } from "../src/shared/gis/sources.js";
import { FLORIDA_SOURCES } from "../src/shared/gis/sourcesFlorida.js";
import { SOURCE_FIXTURES, SOURCE_DOCS } from "../src/shared/gis/sourceFixtures.js";
import { SERVICE_AREAS } from "../src/workspaces/site-planner/lib/serviceAreaData.js";
import { _setServiceAreas } from "../src/workspaces/site-planner/lib/serviceAreas.js";
import { layerAvailableHere, REGION_ZONES } from "../src/workspaces/site-planner/lib/layerPanelModel.js";
import { VECTOR_SOURCES, isCountyLinesId, isCityLimitsId } from "../src/workspaces/site-planner/lib/vectorLayers.js";
import { LAYER_TIER, tierOf } from "../src/workspaces/site-planner/lib/layerWeight.js";
import { ALLOWED_HOSTS } from "../functions/gis-proxy/[[path]].js";

const IDS = Object.keys(FLORIDA_LAYERS);
/* The declared Florida set, by name: a new Florida row must be added here on purpose. */
const FLORIDA_IDS_DECLARED = [
  "fl_brownfield_areas", "fl_city", "fl_conservation_lands", "fl_contamination_sites", "fl_county", "fl_drainage_districts_broward", "fl_eagle_nesting", "fl_erp_sfwmd", "fl_evac_zones",
  "fl_fll_noise", "fl_institutional_controls", "fl_natural_lands_broward", "fl_outstanding_florida_waters", "fl_panther_consultation", "fl_sfwmd_canals", "fl_sfwmd_conservation_easements",
  "fl_sfwmd_row_permits", "fl_sinkhole_areas", "fl_sinkhole_reports", "fl_sis_highways", "fl_udb_miamidade", "fl_wellfield_broward", "fl_wellfield_miamidade", "fl_wetlands_broward", "fl_wmd",
].sort();
const P = {
  sunriseHiatus: { lat: 26.1666, lng: -80.2554 },   // NW 44th St & Hiatus Rd — Broward, SFWMD
  miamiNw: { lat: 25.88, lng: -80.42 },             // Miami-Dade
  tampa: { lat: 27.95, lng: -82.46 },               // Hillsborough — SWFWMD, not SFWMD
  jacksonville: { lat: 30.33, lng: -81.66 },
  houston: { lat: 29.76, lng: -95.37 }, atlanta: { lat: 33.75, lng: -84.39 }, denver: { lat: 39.74, lng: -104.99 }, nashville: { lat: 36.16, lng: -86.78 },
};
const shows = (id, state, loc) => layerAvailableHere(ALL_LAYERS[id], { state, loc });

beforeAll(() => _setServiceAreas(SERVICE_AREAS));

describe("every Florida row is complete and reads the registry", () => {
  it("is registered in ALL_LAYERS and Florida-only", () => {
    expect([...IDS].sort()).toEqual(FLORIDA_IDS_DECLARED);
    expect(IDS.length).toBeGreaterThanOrEqual(25);
    for (const id of IDS) {
      expect(ALL_LAYERS[id], id).toBe(FLORIDA_LAYERS[id]);
      expect(ALL_LAYERS[id].states, id).toEqual(["FL"]);
    }
  });
  it("carries a label, a source, a note, a role, a group, an order and a way to answer a click", () => {
    for (const id of IDS) {
      const c = ALL_LAYERS[id];
      expect(c.label && c.label.length > 3 && c.label.length <= 30, `${id} label "${c.label}" (the Layers panel row cuts a name past ~30 characters)`).toBe(true);
      expect(c.source, `${id} source`).toBeTruthy();
      expect(c.note && c.note.length > 40, `${id} note`).toBe(true);
      expect(["area", "line", "point"], `${id} role`).toContain(c.role);
      expect(["jurisdiction", "flood", "environmental", "access", "utilities"], `${id} group`).toContain(c.group);
      expect(typeof c.order, `${id} order`).toBe("number");
      expect(c.canvasIdentify || c.kind === "vector", `${id} identify`).toBeTruthy();
      expect(typeof c.url, `${id} url`).toBe("string");
      expect(layerVintage(id, c), `${id} vintage`).toBeTruthy();
    }
    for (const id of Object.keys(FLORIDA_VINTAGE)) expect(IDS, `vintage for unknown row ${id}`).toContain(id);
  });
  it("every row has a layer-weight tier (a missing tier silently defaults)", () => {
    for (const id of IDS) expect(LAYER_TIER[id], `${id} tier`).toBeTruthy();
    for (const id of IDS) expect(["constraint", "reference", "context"]).toContain(tierOf(id));
  });
  it("every endpoint is a registry row's URL (relay-rewritten where the agency host is unreachable)", () => {
    const registryUrls = new Set(Object.values(FLORIDA_SOURCES).flatMap((s) => [s.serviceUrl, relayUrl(s.serviceUrl)]));
    for (const id of IDS) expect(registryUrls.has(ALL_LAYERS[id].url), `${id}: ${ALL_LAYERS[id].url}`).toBe(true);
  });
  it("every relayed row names a host the /gis-proxy relay allows", () => {
    for (const id of IDS) {
      const u = ALL_LAYERS[id].url;
      if (!u.startsWith(FLORIDA_RELAY + "/")) continue;
      const host = u.slice(FLORIDA_RELAY.length + 1).split("/")[0];
      expect(ALLOWED_HOSTS.has(host), `${id}: ${host} is not on the relay allow-list`).toBe(true);
    }
  });
  it("every direct (non-relayed) row is on an agency's ArcGIS Online host, https", () => {
    for (const id of IDS) {
      const u = ALL_LAYERS[id].url;
      if (u.startsWith(FLORIDA_RELAY + "/")) continue;
      expect(u, id).toMatch(/^https:\/\/services\d?\.arcgis\.com\//);
    }
  });
});

describe("the Florida registry rows", () => {
  it("are Florida-scoped, production-tier, dated, fixture-backed and pass the whole registry audit", () => {
    for (const [k, s] of Object.entries(FLORIDA_SOURCES)) {
      expect(statesFor(s), k).toEqual(["FL"]);
      expect(s.tier, k).toBe("production");
      expect(s.lastVerified, k).toBe("2026-10-29");
      expect(s.serviceUrl, k).toMatch(/^https:\/\//);
      expect(GIS_SOURCES[k], k).toBe(s);
      expect(SOURCE_FIXTURES[k] && SOURCE_FIXTURES[k].fixtures.length, `${k} fixtures`).toBeGreaterThanOrEqual(2);
      expect(SOURCE_DOCS[k] && SOURCE_DOCS[k].notes, `${k} notes`).toBeTruthy();
    }
    const { problems } = auditRegistry(GIS_SOURCES, SOURCE_FIXTURES, SOURCE_DOCS);
    expect(problems, JSON.stringify(problems, null, 2)).toEqual([]);
  });
});

describe("scope — a Florida row is offered only where its source serves", () => {
  it("no Florida row is offered on a Texas, Georgia, Colorado or Tennessee site", () => {
    for (const [st, loc] of [["TX", P.houston], ["GA", P.atlanta], ["CO", P.denver], ["TN", P.nashville]]) {
      for (const id of IDS) expect(shows(id, st, loc), `${id} on a ${st} site`).toBe(false);
    }
  });
  it("a Broward site is offered the Broward rows, the SFWMD rows and the statewide rows, but not Miami-Dade's wellfield areas", () => {
    for (const id of ["fl_wellfield_broward", "fl_drainage_districts_broward", "fl_wetlands_broward", "fl_natural_lands_broward", "fl_erp_sfwmd", "fl_evac_zones", "fl_county", "fl_city", "fl_wmd"]) {
      expect(shows(id, "FL", P.sunriseHiatus), id).toBe(true);
    }
    expect(shows("fl_wellfield_miamidade", "FL", P.sunriseHiatus)).toBe(false);
  });
  it("a Miami-Dade site gets Miami-Dade's wellfield areas and not Broward's", () => {
    expect(shows("fl_wellfield_miamidade", "FL", P.miamiNw)).toBe(true);
    expect(shows("fl_wellfield_broward", "FL", P.miamiNw)).toBe(false);
  });
  it("a Tampa site is offered no Broward row and no SFWMD permit row (a different water management district)", () => {
    for (const id of IDS.filter((i) => (ALL_LAYERS[i].regions || []).length)) expect(shows(id, "FL", P.tampa), `${id} on a Tampa site`).toBe(false);
    expect(shows("fl_evac_zones", "FL", P.tampa)).toBe(true);
    expect(shows("fl_conservation_lands", "FL", P.jacksonville)).toBe(true);
  });
  it("every region a Florida row names is a real built boundary (a typo would silently fail open)", () => {
    for (const id of IDS) for (const r of ALL_LAYERS[id].regions || []) expect(REGION_ZONES[r] || SERVICE_AREAS[r], `${id}: region "${r}"`).toBeTruthy();
  });
});

describe("Counties & Cities — the Florida vector rows draw (the Georgia lesson)", () => {
  it("fl_county / fl_city have a VECTOR_SOURCES entry on the registry endpoint and behave like every other state's rows", () => {
    expect(VECTOR_SOURCES.fl_county.query.url).toBe(GIS_SOURCES.countyFl.serviceUrl + "/query");
    expect(VECTOR_SOURCES.fl_city.query.url).toBe(GIS_SOURCES.cityFl.serviceUrl + "/query");
    expect(isCountyLinesId("fl_county")).toBe(true);
    expect(isCityLimitsId("fl_city")).toBe(true);
    expect(ALL_LAYERS.fl_county.mergeGroup).toBe("counties_cities");
    expect(ALL_LAYERS.fl_city.mergeGroup).toBe("counties_cities");
  });
  it("a Florida site has no ETJ row (Florida has no ETJ) and no Texas county / city / ETJ row", () => {
    expect(Object.keys(ALL_LAYERS).filter((id) => /etj/i.test(id) && (ALL_LAYERS[id].states || []).includes("FL"))).toEqual([]);
    for (const id of ["jur_county", "jur_city", "jur_etj"]) expect(shows(id, "FL", P.sunriseHiatus), id).toBe(false);
  });
});

describe("the numbers on screen are the publisher's, and a legend is what the map paints", () => {
  it("Broward's wellfield note carries the county's own 250 / 500 / 1,320 ft and its legend is the style ramp", () => {
    const c = ALL_LAYERS.fl_wellfield_broward;
    for (const n of ["250 ft", "500 ft", "1,320 ft"]) expect(c.note).toContain(n);
    expect(c.legend.map((l) => l.color)).toEqual([1, 2, 3].map((z) => BROWARD_WELLFIELD_RAMP[z]));
    for (const z of [1, 2, 3]) expect(browardWellfieldStyle({ ZONE: z }, 0.4).fillColor).toBe(BROWARD_WELLFIELD_RAMP[z]);
  });
  it("Miami-Dade's note names Chapter 24 and the 10 / 30 / 100 / 210-day contours, and its legend is the style ramp", () => {
    const c = ALL_LAYERS.fl_wellfield_miamidade;
    expect(c.note).toMatch(/Chapter 24/);
    for (const d of ["10", "30", "100", "210"]) expect(c.note).toContain(d);
    expect(c.legend.map((l) => l.color)).toEqual(["010", "030", "100", "210"].map((t) => MDC_TRAVEL_RAMP[t]));
    for (const t of ["010", "030", "100", "210"]) expect(mdcWellfieldStyle({ TRAVELTIME: t }, 0.4).fillColor).toBe(MDC_TRAVEL_RAMP[t]);
    expect(mdcTravelDays("030")).toBe("30");
    expect(mdcTravelDays("AVG")).toBe(null);
  });
  it("evacuation zones: the legend's zone-A colour is the colour zone A paints, and an unknown zone never paints as zone A", () => {
    const c = ALL_LAYERS.fl_evac_zones;
    expect(c.legend[0].color).toBe(EVAC_RAMP.A);
    // every colour the map can paint has a legend entry (the service holds A–E plus county zones F–M, HUR, LAKE, NPBC, SPBC …)
    const painted = new Set(["A", "AB", "B", "BC", "C", "D", "DE", "E", "F", "G", "H", "HUR", "I", "J", "K", "L", "LAKE", "M", "NPBC", "SPBC"].map((z) => evacColor(z)));
    const legend = new Set(c.legend.map((l) => l.color));
    for (const col of painted) expect(legend.has(col), `a painted evacuation colour ${col} has no legend entry`).toBe(true);
    expect(legend.has(EVAC_OTHER)).toBe(true);
    expect(evacStyle({ EZone: "A" }, 0.4).fillColor).toBe(EVAC_RAMP.A);
    expect(evacStyle({ EZone: "AB" }, 0.4).fillColor).toBe(EVAC_RAMP.A);
    expect(evacColor("LAKE")).not.toBe(EVAC_RAMP.A);
    expect(evacColor(null)).not.toBe(EVAC_RAMP.A);
    expect(c.note).toMatch(/163\.3178/);
  });
  it("no row prints a buffer, setback or distance the publisher does not publish", () => {
    const text = IDS.map((id) => ALL_LAYERS[id].note + " " + (ALL_LAYERS[id].infoCaveat || "")).join(" ");
    // the only feet figures in any Florida note are Broward's three wellfield distances (the county's layer description) and the FGS's sinkhole cover thicknesses
    // ("Cover is 30' to 200' thick" / "more than 200' thick" — the Survey's own DESC_1 text)
    const feet = [...text.matchAll(/(\d[\d,]*)\s*ft\b/g)].map((m) => m[1]);
    expect(new Set(feet)).toEqual(new Set(["250", "500", "1,320", "200"]));
  });
});

describe("label and permit helpers", () => {
  it("cleans Broward's drainage-district names (a stray line break and a doubled word)", () => {
    expect(districtName("Coral Bay\r\nCoral Bay")).toBe("Coral Bay");
    expect(districtName("Central Broward")).toBe("Central Broward");
    expect(districtName(null)).toBe(null);
  });
  it("words an ERP permit type and never invents one", () => {
    expect(erpTypeLabel("IND")).toBe("Individual");
    expect(erpTypeLabel("ZZZ")).toBe("ZZZ");
    expect(erpTypeLabel("")).toBe(null);
  });
});

describe("review findings (adversarial pass 1) stay fixed", () => {
  it("a layer whose service holds far more than one page answers with every page, never the first 2,000 silently", () => {
    // counts measured live 2026-10-29: ERP 41,239 · Broward wellfield 4,122 · FNAI 3,435 (a 2,000 first page, then exceededTransferLimit)
    for (const id of ["fl_erp_sfwmd", "fl_wellfield_broward", "fl_conservation_lands"]) expect(ALL_LAYERS[id].fetchAll, id).toBe(true);
  });
  it("fetchAll reaches esri-leaflet as fetchAllFeatures", async () => {
    const { featureLayerOptions } = await import("../src/workspaces/site-planner/lib/layerRequest.js");
    expect(featureLayerOptions(ALL_LAYERS.fl_erp_sfwmd, 0.4, "p").fetchAllFeatures).toBe(true);
    expect(featureLayerOptions(ALL_LAYERS.fl_wmd, 0.4, "p").fetchAllFeatures).toBeUndefined();
  });
  it("the evacuation layer opens only once a view's answer fits the draw budget (z9 measured 324k vertices over the 120k cap)", () => {
    expect(ALL_LAYERS.fl_evac_zones.minZoom).toBeGreaterThanOrEqual(11);
  });
  it("Miami-Dade's helper polygons (AVG / MAX / INT / OUTER) are not drawn as a travel-time class", () => {
    expect(ALL_LAYERS.fl_wellfield_miamidade.where).toBe("TRAVELTIME IN ('010','030','100','210')");
  });
  it("the ERP row names no permit-type word it cannot cite, and never links a generic page as the 'record'", () => {
    expect(Object.keys(ERP_TYPES_FOR_TEST).sort()).toEqual(["CA", "EXEM", "GP", "IND"]);
    expect(erpTypeLabel("FWD")).toBe("FWD");
    const card = ALL_LAYERS.fl_erp_sfwmd.identifyCard({ PROJECT_NAME: "X", PERMIT_NO: "06-1-P", Link: "https://www.sfwmd.gov/regpermitting" });
    expect(card.rows.some((r) => r.href)).toBe(false);
    expect(ALL_LAYERS.fl_erp_sfwmd.where).toMatch(/Pending-Expired/);
  });
  it("county and city names are title-cased (the services publish ALL CAPS)", () => {
    expect(VECTOR_SOURCES.fl_county.titleCaseLabel).toBe(true);
    expect(VECTOR_SOURCES.fl_city.titleCaseLabel).toBe(true);
  });
});
