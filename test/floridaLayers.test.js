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
  EVAC_OTHER, BROWARD_WELLFIELD_RAMP, browardWellfieldStyle, MDC_TRAVEL_RAMP, mdcWellfieldStyle, mdcTravelDays, erpTypeLabel, ERP_TYPES as ERP_TYPES_FOR_TEST, niceCase, restrictionWords, epochDate, cleanupCategory, cleanupStatus, noiseLabel, sinkholeAreaStyle, SINKHOLE_AREA_RAMP, NOISE_RAMP, noiseStyle,
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
  it("NEW-1 second review: the OFW rule is cited as 'Rule 62-302.700, F.A.C.' (never 's.'), and Broward's distances point at the Code the county's description quotes", () => {
    expect(ALL_LAYERS.fl_outstanding_florida_waters.note).toMatch(/Rule 62-302\.700, F\.A\.C\./);
    for (const c of Object.values(ALL_LAYERS)) expect([c.note, c.infoCaveat].join(" "), c.label).not.toMatch(/\bs\. 62-/);
    const n = ALL_LAYERS.fl_wellfield_broward.note;
    expect(n).toMatch(/Broward County Code, Chapter 27, Article XIII/);
    expect(n).toMatch(/June 2013/);
    expect(n).not.toMatch(/tightest nearest the well/); // an inference no source states
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
    // St. Petersburg z11–13: with simplifyFactor 0.5 and the default 120k budget 16 of 30 tile batches were refused ("too detailed to draw"); the row asks the server for a much coarser copy and carries its own budget
    expect(ALL_LAYERS.fl_evac_zones.simplifyFactor).toBeGreaterThanOrEqual(6);
    expect(ALL_LAYERS.fl_evac_zones.vertexBudget).toBeGreaterThanOrEqual(400000);
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

describe("click-card wording", () => {
  it("prints agency ALL-CAPS in words and leaves mixed case alone", () => {
    expect(niceCase("CITY OF SUNRISE-SPRINGTREE GOLF COURSE")).toBe("City of Sunrise-Springtree Golf Course");
    expect(niceCase("8350 SPRINGTREE DRIVE")).toBe("8350 Springtree Drive");
    expect(niceCase("NW 44TH ST LLC")).toBe("NW 44th St LLC");
    expect(niceCase("One Price Dry Cleaning")).toBe("One Price Dry Cleaning");
    expect(niceCase(null)).toBe("");
  });
  it("decodes DEP's cleanup codes and restriction text, and prints an unknown code as written", () => {
    expect(cleanupCategory("PETRO")).toBe("Petroleum");
    expect(cleanupCategory("NEWCODE")).toBe("NEWCODE");
    expect(cleanupStatus("ONHOLD")).toBe("On hold");
    expect(restrictionWords("EC MAINTENANCE|GROUNDWATER USE RESTRICTION")).toBe("EC Maintenance · Groundwater Use Restriction");
    expect(restrictionWords("")).toBe(null);
  });
  it("sinkhole areas and noise contours paint the ramp colour the legend shows", () => {
    for (const a of Object.keys(SINKHOLE_AREA_RAMP)) expect(sinkholeAreaStyle({ AREA_DESC: a }, 0.4).fillColor).toBe(SINKHOLE_AREA_RAMP[a]);
    expect(ALL_LAYERS.fl_sinkhole_areas.legend.map((l) => l.color)).toEqual(Object.values(SINKHOLE_AREA_RAMP));
    for (const d of [60, 65, 70, 75]) expect(noiseStyle({ CONTOURVAL: d }, 0.5).color).toBe(NOISE_RAMP[d]);
    expect(ALL_LAYERS.fl_fll_noise.legend.map((l) => l.color)).toEqual([60, 65, 70, 75].map((d) => NOISE_RAMP[d]));
    expect(noiseLabel("65.0")).toBe("65 dB");
    expect(noiseLabel("")).toBe(null);
  });
  it("the relayed rows' card text carries no raw field names", () => {
    const rows = ALL_LAYERS.fl_institutional_controls.identifyCard({ PRIMARY_SITE_NAME: "X", PRIMARY_SITE_ADDRESS_LINE_1: "1 MAIN ST", PRIMARY_SITE_CITY: "SUNRISE", DESCRIPTION: "GROUNDWATER USE RESTRICTION", BEGIN_DATE: 1377561600000 }).rows;
    for (const r of rows) expect(r.label, r.label).not.toMatch(/[A-Z]{3,}_|_[A-Z]/);
  });
});

describe("review pass 2 stays fixed", () => {
  it("the panther consultation row is scoped to its own area, not offered statewide", () => {
    expect(ALL_LAYERS.fl_panther_consultation.regions).toEqual(["pantherconsult"]);
    expect(shows("fl_panther_consultation", "FL", { lat: 26.42, lng: -81.42 })).toBe(true);   // Immokalee
    expect(shows("fl_panther_consultation", "FL", { lat: 25.9, lng: -80.55 })).toBe(true);    // west Miami-Dade (Everglades side) — the area reaches it
    expect(shows("fl_panther_consultation", "FL", P.tampa)).toBe(false);
    expect(shows("fl_panther_consultation", "FL", P.jacksonville)).toBe(false);
    expect(ALL_LAYERS.fl_panther_consultation.note).not.toMatch(/Nothing here for Broward/);
  });
  it("the right-of-way row asks only for FINAL permits and prints pre-1970 dates and tidy 'use' text", () => {
    expect(ALL_LAYERS.fl_sfwmd_row_permits.where).toBe("reviewStatus = 'FINAL'");
    expect(epochDate(-310608000000)).toMatch(/1960/);
    expect(epochDate(null)).toBe("");
    const long = "(CANCELLED) " + "FENCE ENCLOSURE ".repeat(30);
    const card = ALL_LAYERS.fl_sfwmd_row_permits.identifyCard({ PERMIT_NO: "1", PERMITEE: "CARTER, GARY A.", PROJECT_WORKS: "C-42", AUTHORIZATION_: long, DATE_ISSUED: -310608000000 });
    expect(card.rows.find((r) => r.label === "Use").text.length).toBeLessThanOrEqual(140);
    expect(card.rows.find((r) => r.label === "Issued").text).toMatch(/1960/);
    expect(card.rows.find((r) => r.label === "Permittee").text).toBe("Carter, Gary A.");
  });
  it("only the registry's own pipe-joined restriction vocabulary is re-worded; free text prints as written", () => {
    expect(restrictionWords("GROUNDWATER USE RESTRICTION|LAND USE RESTRICTION")).toBe("Groundwater Use Restriction · Land Use Restriction");
    expect(restrictionWords("SS086 LUC Boundary")).toBe("SS086 LUC Boundary");
    expect(restrictionWords("Conditional Site Rehabilitation Completion Order")).toBe("Conditional Site Rehabilitation Completion Order");
    expect(restrictionWords("DOD_4_513 GW")).toBe("DOD_4_513 GW");
  });
  it("the sinkhole-area ramp is a neutral thickness ramp, not a hazard scale, and its legend names no cover figure the data contradicts", () => {
    for (const c of Object.values(SINKHOLE_AREA_RAMP)) expect(c).toMatch(/^#(33|64|94|cb)/);
    for (const l of ALL_LAYERS.fl_sinkhole_areas.legend) expect(l.label).not.toMatch(/\d+\s*ft/);
    expect(ALL_LAYERS.fl_sinkhole_areas.note).toMatch(/not a hazard scale/);
  });
  it("planned SIS corridors are dashed, existing ones solid", () => {
    const f = ALL_LAYERS.fl_sis_highways.styleFn;
    expect(f({ SISTYPE_DE: "Future Corridor" }, 0.5).dashArray).toBeTruthy();
    expect(f({ SISTYPE_DE: "SIS Corridor" }, 0.5).dashArray).toBeFalsy();
  });
  it("a row that asks the server to simplify and carries its own draw budget says why", () => {
    expect(ALL_LAYERS.fl_sinkhole_areas.vertexBudget).toBeGreaterThanOrEqual(300000);
  });
});

describe("review pass 4 stays fixed", () => {
  it("district / canal-owner acronyms stay upper-case and acres are rounded on the cards", async () => {
    const { hoverRows } = await import("../src/workspaces/site-planner/lib/featureHover.js");
    const text = (id, props, label) => (hoverRows(ALL_LAYERS[id], props).find((r) => r.label === label) || {}).text;
    for (const d of ["SFWMD", "SWFWMD", "SJRWMD", "SRWMD", "NWFWMD"]) expect(text("fl_wmd", { WMDNAME: d }, "District")).toBe(d);
    expect(text("fl_sfwmd_canals", { OWNER: "SFWMD" }, "Owner")).toBe("SFWMD");
    expect(text("fl_sfwmd_canals", { OWNER: "FORT PIERCE FARMS WCD" }, "Owner")).toBe("Fort Pierce Farms WCD");
    expect(text("fl_brownfield_areas", { ACREAGE: 3088.95607246 }, "Acres")).toBe("3,089");
    expect(text("fl_brownfield_areas", { ACREAGE: 41.23000296 }, "Acres")).toBe("41.23");
    expect(text("fl_sfwmd_conservation_easements", { RECORDED_ACRES: 12.3456789 }, "Acres")).toBe("12.35");
  });
  it("the flat-style opacity setter also updates _originalStyle (esri-leaflet's reset restores it on every re-delivered feature)", async () => {
    const { readFileSync } = await import("node:fs");
    const layers = readFileSync(new URL("../src/workspaces/site-planner/lib/layers.js", import.meta.url), "utf8");
    expect(layers).toMatch(/const sf = \(f\) => \(isPointFeature\(f\) \? pointSymbolOptions\(cfg, oo(?:, f && f\.properties)?\) : featureBaseStyle\(cfg, oo\)\); lyr\._originalStyle = sf; lyr\.setStyle\(sf\);/);
  });
});

describe("review pass 5 stays fixed — one acronym-aware formatter for every shouted name", () => {
  it("keeps district / canal-authority acronyms, canal ids and state-road numbers, and still words ordinary names", () => {
    const cases = {
      "NLWCD CANAL": "NLWCD Canal", "NSLRWCD C-24D": "NSLRWCD C-24D", "LWDD L-35": "LWDD L-35", "CBRWCD S-12": "CBRWCD S-12", "FPFWCD": "FPFWCD",
      "USACE": "USACE", "USACE/SFWMD": "USACE/SFWMD", "715 FARMS DD": "715 Farms DD", "BCB": "BCB", "US 27/SR 25": "US 27/SR 25", "SR 826": "SR 826",
      "NW 44TH ST LLC": "NW 44th St LLC", "FT L  PROSPECT": "Ft L Prospect", "WESTSIDE": "Westside", "HIATUS RD": "Hiatus Rd", "NORTH NEW RIVER CANAL": "North New River Canal",
      "ACME IMPROVEMENT DISTRICT": "Acme Improvement District", "CITY OF SUNRISE-SPRINGTREE GOLF COURSE": "City of Sunrise-Springtree Golf Course",
    };
    Object.assign(cases, {
      // pass 6 — the live canal / permit / site-name shapes
      "STA-1E": "STA-1E", "C-44 STA CELL 1": "C-44 STA Cell 1", "SIRWCD": "SIRWCD", "CSID": "CSID", "EBWCD": "EBWCD", "HDPE": "HDPE", "CATV": "CATV", "FPL'S": "FPL's", "FDOT'S": "FDOT's",
      "J&J": "J&J", "FP&L": "FP&L", "M&O": "M&O", "SR 821/HEFT": "SR 821/HEFT", "CHEVRON BLDG 3046": "Chevron Bldg 3046", "DADE CNTY SCHOOL BD": "Dade Cnty School Bd", "ANDERSON, ERIC MR. AND MRS.": "Anderson, Eric Mr. and Mrs.",
      "JEA SUBSTATION": "JEA Substation", "YMCA OF NORTH FLORIDA": "YMCA of North Florida", "CITY OF BOCA RATON": "City of Boca Raton", "O'KNIGHT": "O'Knight", "TODD ADDISON": "Todd Addison", "KEENE'S": "Keene's",
    });
    for (const [raw, want] of Object.entries(cases)) expect(niceCase(raw), raw).toBe(want);
    expect(niceCase("Already Mixed Case")).toBe("Already Mixed Case");
  });
  it("the canal name, SIS facility and wellfield cards run through it", async () => {
    const { hoverRows } = await import("../src/workspaces/site-planner/lib/featureHover.js");
    const text = (id, props, label) => (hoverRows(ALL_LAYERS[id], props).find((r) => r.label === label) || {}).text;
    expect(text("fl_sfwmd_canals", { NAME: "NLWCD CANAL" }, "Name")).toBe("NLWCD Canal");
    expect(text("fl_sis_highways", { FACILITY: "US 27/SR 25" }, "Facility")).toBe("US 27/SR 25");
    expect(text("fl_wellfield_broward", { LABEL: "FT L  PROSPECT" }, "Wellfield")).toBe("Ft L Prospect");
    expect(text("fl_wellfield_miamidade", { NAME: "WESTSIDE" }, "Wellfield")).toBe("Westside");
  });
});
