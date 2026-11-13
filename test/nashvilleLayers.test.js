/* Metro Nashville & Davidson County layer rows + the Davidson parcel card (NEW-1 / NEW-2 / NEW-3, 2026-11-12).
 *
 * THE RULES UNDER TEST:
 *  · every Nashville row appears only in Davidson County — a Memphis, Knoxville, Houston or Atlanta site must NEVER issue a request for them (the declared scope, the pure availability gate, and the network
 *    itself: `syncOverlayLayers` is driven with every row ON and the URLs it asks for are recorded);
 *  · owner constraint #46 — a district NAME is shown only where Title 17 sources it (nashvilleZoningNames.js); every other code shows bare, and the table never names a code the layer does not have;
 *  · owner constraint #41 — land a satellite city zones reads "Zoned by City of X — not Metro" and the placeholder "ZZ" codes are never printed as codes;
 *  · owner constraint #50 — the Zoning legend is one heading naming the government, then one code per row;
 *  · the parcel card (NEW-2): the assessor's zoning / tax district / council district + the portal link, and NO Metro row for a placeholder lot across the county line, which a click never returns. */
import { describe, it, expect, vi, beforeAll, afterEach } from "vitest";

const featureLayerCalls = [];
vi.mock("esri-leaflet", () => ({
  dynamicMapLayer: vi.fn(), imageMapLayer: vi.fn(), tiledMapLayer: vi.fn(),
  featureLayer: vi.fn((o) => { featureLayerCalls.push(o); return { on() {}, off() {}, addTo() { return this; }, setStyle() {}, eachFeature() {} }; }),
}));
vi.mock("../src/workspaces/site-planner/lib/evidenceLayers.js", () => ({ overpassLayer: vi.fn(), mapillaryLayer: vi.fn() }));
vi.mock("../src/workspaces/site-planner/lib/terrainLayers.js", () => ({ contourLayer: vi.fn(), flowLayer: vi.fn(), TERRAIN_MIN_ZOOM: 13 }));
vi.mock("../src/workspaces/site-planner/lib/vectorOverlay.js", () => ({
  cachedVectorLayer: vi.fn(), cachedPipelineLayer: vi.fn(), cachedCorridorLayer: vi.fn(), isPointFeature: vi.fn(),
}));
vi.mock("../src/workspaces/site-planner/lib/mapSymbols.js", () => ({ installDefaultMarkerIcon: vi.fn(), pointToLayerFor: vi.fn(() => () => null) }));

import { SERVICE_AREAS } from "../src/workspaces/site-planner/lib/serviceAreaData.js";
import { _setServiceAreas } from "../src/workspaces/site-planner/lib/serviceAreas.js";
import { ALL_LAYERS, defaultOverlayState, syncOverlayLayers, layerVintage } from "../src/workspaces/site-planner/lib/layers.js";
import { siteState } from "../src/workspaces/site-planner/lib/siteRegion.js";
import { drawnOverlaysOf, inRegion, layerAvailableHere } from "../src/workspaces/site-planner/lib/layerPanelModel.js";
import { LAYER_TIER, hierarchyProblems } from "../src/workspaces/site-planner/lib/layerWeight.js";
import { GIS_SOURCES, auditRegistry } from "../src/shared/gis/sources.js";
import { SOURCE_FIXTURES, SOURCE_DOCS } from "../src/shared/gis/sourceFixtures.js";
import { NASHVILLE_LAYERS, NASHVILLE_RELAY, relayed } from "../src/workspaces/site-planner/lib/nashvilleLayers.js";
import {
  zoneClass, zoneColor, zoningStyle, zoneLabelText, zoneWithName, zoningRows, zoningCard, zoningLegend, legendItemsOf, overlayCard, overlayLegend, overlayStyle, overlayColor,
  dtcCard, pudCard, ccmCard, ccmLegend, ccmStyle, SATELLITE_CODE, soft,
} from "../src/workspaces/site-planner/lib/nashvilleZoning.js";
import { NASH_ZONE_NAMES, nashZoneName, NASH_ZONING_CITATION } from "../src/workspaces/site-planner/lib/nashvilleZoningNames.js";
import { satelliteFrom, satelliteCityAt, _setSatellites, cityName } from "../src/workspaces/site-planner/lib/nashvilleJurisdiction.js";
import {
  davidsonRows, isDavidsonRecord, isOutOfCountyPlaceholder, assessorZoningText, councilText, taxDistrictText, METRO_POINT_WHERE, OUT_OF_COUNTY_FEATURETYPES, ASSESSOR_PORTAL,
} from "../src/workspaces/site-planner/lib/davidsonParcel.js";
import { apprRows, parcelCardRows, countyRecord } from "../src/workspaces/site-planner/lib/appraisal.js";
import { COUNTIES_MAP, pointWhereForUrl, COUNTIES } from "../src/workspaces/site-planner/lib/counties.js";
import { queryAtPoint } from "../src/workspaces/site-planner/lib/arcgis.js";
import { ALLOWED_HOSTS } from "../functions/gis-proxy/[[path]].js";

beforeAll(() => _setServiceAreas(SERVICE_AREAS));

const IDS = Object.keys(NASHVILLE_LAYERS);
const ELM_HILL = { lat: 36.148911, lng: -86.715502 }; // Elm Hill Pike — zoned IR, ordinance O73-650, 1974-12-24 (the sweep's anchor)
const DOWNTOWN = { lat: 36.1627, lng: -86.7816 };
const ELSEWHERE = {
  memphis: { lat: 35.1495, lng: -90.049 }, knoxville: { lat: 35.9606, lng: -83.9207 }, houston: { lat: 29.7604, lng: -95.3698 }, atlanta: { lat: 33.749, lng: -84.388 }, murfreesboro: { lat: 35.8456, lng: -86.3903 }, desoto: { lat: 34.9615, lng: -89.8 },
};
const scopeOf = (p) => ({ state: siteState(p), loc: p });
const METRO_ORG = /HdTo6HJqh92wn4D8/;
const ISSUED = (u) => METRO_ORG.test(u) || /maps\.nashville\.gov/.test(u);

/* The 92 distinct ZONE_DESC codes in Metro's zoning layer on 2026-11-12 (the layer's own values). */
const LIVE_CODES = ["AG", "AR2A", "CA", "CF", "CL", "CL-A", "CL-NS", "CN", "CS", "CS-A", "CS-A-NS", "CS-NS", "DTC", "I", "IG", "IR", "IWD", "MHP", "MUG", "MUG-A", "MUG-A-NS", "MUG-NS", "MUI", "MUI-A", "MUL", "MUL-A", "MUL-A-NS", "MUL-NS", "MUN", "MUN-A", "MUN-A-NS", "MUN-NS",
  "OG", "OL", "ON", "OR20", "OR20-A", "OR20-A-NS", "OR20-NS", "OR40", "OR40-A", "OR40-A-NS", "ORI", "ORI-A", "R10", "R15", "R20", "R30", "R40", "R6", "R6-A", "R8", "R8-A", "R80", "RL2", "RM15", "RM15-A", "RM15-A-NS", "RM15-NS", "RM2", "RM2-NS", "RM20", "RM20-A", "RM20-A-NS", "RM20-NS",
  "RM4", "RM4-NS", "RM40", "RM40-A", "RM40-A-NS", "RM6", "RM6-NS", "RM60", "RM9", "RM9-A", "RM9-A-NS", "RM9-NS", "RS10", "RS15", "RS20", "RS3.75", "RS30", "RS40", "RS5", "RS5-A", "RS7.5", "RS80", "SCC", "SCN", "SCR", "SP", "Satellite City"];

describe("the Davidson service area is a real boundary", () => {
  it("is built into the generated area data", () => {
    expect(SERVICE_AREAS.davidson).toBeTruthy();
    expect(SERVICE_AREAS.davidson.polys.length).toBeGreaterThanOrEqual(1);
  });
  it("contains Elm Hill Pike and downtown; excludes Memphis, Knoxville, Houston, Atlanta and Murfreesboro", () => {
    expect(inRegion("davidson", ELM_HILL)).toBe(true);
    expect(inRegion("davidson", DOWNTOWN)).toBe(true);
    for (const [k, p] of Object.entries(ELSEWHERE)) expect(inRegion("davidson", p), k).toBe(false);
  });
});

describe("every Nashville row is registered whole and scoped to Davidson County", () => {
  it("is in the registry, on Metro's org (direct) or its server (through the relay) — never Metro's server directly", () => {
    expect(IDS.sort()).toEqual(["tn_nash_ccm", "tn_nash_dtc", "tn_nash_overlays", "tn_nash_pud", "tn_nash_zoning"]);
    for (const id of IDS) {
      const c = ALL_LAYERS[id];
      expect(c, id).toBeTruthy();
      expect(c.url.startsWith(NASHVILLE_RELAY) || METRO_ORG.test(c.url), `${id}: ${c.url}`).toBe(true);
      expect(/^https?:\/\/maps\.nashville\.gov/.test(c.url), `${id} must ride the relay`).toBe(false);
    }
    expect(ALL_LAYERS.tn_nash_ccm.url).toBe(`${NASHVILLE_RELAY}/Planning/CCM/MapServer/2`);
    expect(relayed("https://maps.nashville.gov/arcgis/rest/services/X/Y")).toBe(`${NASHVILLE_RELAY}/X/Y`);
    expect(ALLOWED_HOSTS.has("maps.nashville.gov")).toBe(true);
  });
  it("declares Tennessee AND the davidson region on every row", () => {
    for (const id of IDS) { expect(ALL_LAYERS[id].states, id).toEqual(["TN"]); expect(ALL_LAYERS[id].regions, id).toEqual(["davidson"]); }
  });
  it("carries the full row the panel and stacking model read: click-only, clean, capitalised, a tier and a vintage", () => {
    for (const id of IDS) {
      const c = ALL_LAYERS[id];
      expect(c.role, id).toBe("area");
      expect(c.label, id).toMatch(/^[A-Z]/);
      expect(c.note && c.source && c.infoCaveat, id).toBeTruthy();
      expect(typeof c.identifyCard, id).toBe("function");
      expect(c.canvasIdentify, id).toBe(true);
      expect(LAYER_TIER[id], id).toBeTruthy();
      expect(layerVintage(id, c), id).toBeTruthy();
      if (c.fields) expect(c.fields.some((n) => /^OBJECTID(_1)?$/.test(n)), `${id}: a fields list without the object id collapses every feature into one`).toBe(true);
    }
    expect(hierarchyProblems(ALL_LAYERS)).toEqual([]);
  });
  it("starts at 100% opacity, off by default (#42)", () => {
    const st = defaultOverlayState();
    for (const id of IDS) { expect(st[id].on, id).toBe(false); expect(ALL_LAYERS[id].opacity ?? 1, id).toBe(1); }
  });
  it("the 6,000-polygon zoning layer is asked simplified with every page followed (the draw budget), and the policy layer is context-tier and off the base zoning's row", () => {
    expect(ALL_LAYERS.tn_nash_zoning.simplifyFactor).toBeGreaterThan(0);
    expect(ALL_LAYERS.tn_nash_zoning.fetchAll).toBe(true);
    expect(LAYER_TIER.tn_nash_ccm).toBe("context");
    expect(ALL_LAYERS.tn_nash_ccm.minZoom).toBeGreaterThanOrEqual(12);
  });
});

describe("the registry rows (GIS_SOURCES) the weekly health check covers", () => {
  const KEYS = ["nashZoning", "nashOverlays", "nashDtc", "nashPud", "nashSatellite", "nashCcm"];
  it("exist, are Tennessee production rows with fixtures and notes, and pass the registry audit", () => {
    for (const k of KEYS) { expect(GIS_SOURCES[k], k).toBeTruthy(); expect(GIS_SOURCES[k].states).toEqual(["TN"]); expect(SOURCE_FIXTURES[k].fixtures.length, k).toBeGreaterThanOrEqual(2); expect(SOURCE_DOCS[k].notes, k).toBeTruthy(); }
    const mine = Object.fromEntries(KEYS.map((k) => [k, GIS_SOURCES[k]]));
    expect(auditRegistry(mine, SOURCE_FIXTURES, SOURCE_DOCS).problems).toEqual([]);
  });
  it("the sweep's anchors are fixtures: Elm Hill Pike (zoning, overlay) and Vultee Blvd (Airport Impact)", () => {
    const has = (k, pt) => SOURCE_FIXTURES[k].fixtures.some((f) => Math.abs(f.point[0] - pt[0]) < 1e-4 && Math.abs(f.point[1] - pt[1]) < 1e-4);
    expect(has("nashZoning", [-86.715502, 36.148911])).toBe(true);
    expect(has("nashOverlays", [-86.7176, 36.1222])).toBe(true);
  });
  it("only the relayed policy row (maps.nashville.gov, unreachable from the build) defers its fixture reach, and it says which V# closes it", () => {
    expect(GIS_SOURCES.nashCcm.relay).toBe(true);
    expect(GIS_SOURCES.nashZoning.relay).toBeUndefined();
  });
});

describe("location scope: a Memphis / Knoxville / Houston / Atlanta site never sees or asks for a Nashville row", () => {
  it("the panel gate: on at Elm Hill and downtown, off everywhere else", () => {
    for (const id of IDS) {
      expect(layerAvailableHere(ALL_LAYERS[id], scopeOf(ELM_HILL)), id).toBe(true);
      for (const [k, p] of Object.entries(ELSEWHERE)) expect(layerAvailableHere(ALL_LAYERS[id], scopeOf(p)), `${id} @ ${k}`).toBe(false);
    }
  });
  const fakeMap = () => {
    const panes = {};
    return { _loaded: true, getSize: () => ({ x: 800, y: 600 }), getZoom: () => 16, getPane: (n) => panes[n], createPane: (n) => { const el = { style: {} }; panes[n] = el; return el; }, whenReady(cb) { cb(); }, on() {}, off() {}, hasLayer: () => false };
  };
  async function run(point) {
    featureLayerCalls.length = 0;
    const fetched = [];
    const realFetch = globalThis.fetch;
    globalThis.fetch = vi.fn(async (u) => { fetched.push(String(u)); return { ok: true, status: 200, json: async () => ({ fullExtent: null }), text: async () => "{}" }; });
    try {
      const all = Object.fromEntries(Object.keys(ALL_LAYERS).map((id) => [id, { on: false, opacity: 1 }]));
      for (const id of IDS) all[id] = { on: true, opacity: 1 };
      const drawn = drawnOverlaysOf(all, { scope: scopeOf(point), layers: ALL_LAYERS });
      syncOverlayLayers(fakeMap(), drawn, {}, { onStatus() {}, onError() {} });
      await new Promise((r) => setTimeout(r, 250));
    } finally { globalThis.fetch = realFetch; }
    return { fetched: fetched.filter(ISSUED), built: featureLayerCalls.map((o) => o.url).filter(ISSUED), calls: featureLayerCalls.filter((o) => ISSUED(o.url)) };
  }
  it("at Elm Hill every row is built; the policy row only through the relay", async () => {
    const r = await run(ELM_HILL);
    expect(r.built.length).toBe(IDS.length);
    expect(r.built.filter((u) => /^https?:\/\/maps\.nashville\.gov/.test(u))).toEqual([]);
    expect(r.built.some((u) => u.startsWith(NASHVILLE_RELAY))).toBe(true);
  });
  it.each(Object.entries(ELSEWHERE))("at %s: zero requests to Metro's org or server", async (_k, p) => {
    const r = await run(p);
    expect(r.fetched).toEqual([]);
    expect(r.built).toEqual([]);
  });
});

describe("district names are sourced (#46): a table that names only what Title 17 was read for, and never a code the layer does not have", () => {
  it("every named code is a code Metro's layer really carries, with the three industrial names Title 17 § 17.08.010 lists", () => {
    expect(NASH_ZONE_NAMES).toEqual({ IWD: "Industrial Warehousing/Distribution", IR: "Industrial Restrictive", IG: "Industrial General" });
    for (const code of Object.keys(NASH_ZONE_NAMES)) expect(LIVE_CODES, code).toContain(code);
    expect(NASH_ZONING_CITATION).toMatch(/17\.08\.010/);
  });
  it("a named code reads \"code · name\"; every other legend code shows as the BARE code, never a guess", () => {
    expect(zoneWithName("IR")).toBe("IR · Industrial Restrictive");
    expect(zoneWithName("IWD")).toBe("IWD · Industrial Warehousing/Distribution");
    for (const code of LIVE_CODES.filter((c) => !NASH_ZONE_NAMES[c])) { expect(nashZoneName(code), code).toBeNull(); expect(zoneWithName(code), code).toBe(code); }
    expect(nashZoneName("toString")).toBeNull();
  });
  it("every live code lands in a family, and an unknown code is neutral — never invented", () => {
    for (const code of LIVE_CODES) expect(zoneClass(code), code).toBeTruthy();
    expect(zoneClass("MUL-A-NS")).toBe("mixed");
    expect(zoneClass("RS7.5")).toBe("residential");
    expect(zoneClass("OR20-A")).toBe("office");
    expect(zoneClass("SCR")).toBe("commercial");
    expect(zoneClass("IWD")).toBe("industrial");
    expect(zoneClass("ZZZ")).toBe("other");
    expect(zoneClass("")).toBe("other");
    expect(zoneClass(SATELLITE_CODE)).toBe("satellite");
  });
});

describe("zoning card + legend (#41 / #50 / #45)", () => {
  const IR = { OBJECTID: 686, ORD_DATE: 157096800000, CASE_NO: " ", ORDINANCE: "O73-650 ", ZONE_DESC: "IR", NAME: null };
  it("Elm Hill Pike: IR, named, with the ordinance and the adoption date — and no blank Case row", () => {
    const c = zoningCard(IR, null);
    expect(c.title).toBe("Zoning · Metro Nashville");
    expect(c.rows).toEqual([{ label: "Zone", text: "IR · Industrial Restrictive" }, { label: "Ordinance", text: "O73-650" }, { label: "Adopted", text: "Dec 24, 1974" }]);
    expect(JSON.stringify(c)).not.toMatch(/ZONE_DESC|ORD_DATE|OBJECTID|null|undefined/);
  });
  it("a specific plan shows its plan name; a code with no sourced name shows bare", () => {
    const sp = zoningRows({ ZONE_DESC: "SP", NAME: "Hickory Hollow Specific Plan", ORDINANCE: "BL2015-1" }, null);
    expect(sp[0]).toEqual({ label: "Zone", text: "SP" });
    expect(sp).toContainEqual({ label: "Plan name", text: "Hickory Hollow Specific Plan" });
  });
  it("a lot inside a satellite city reads \"Zoned by City of X — not Metro\" — never a Metro code, never a ZZ code", () => {
    const c = zoningCard({ ZONE_DESC: SATELLITE_CODE, ORDINANCE: " " }, "City of Belle Meade");
    expect(c.title).toBe("Zoning · City of Belle Meade");
    expect(c.rows).toEqual([{ label: "Zoning", text: "Zoned by City of Belle Meade — not Metro" }]);
    expect(zoningCard({ ZONE_DESC: SATELLITE_CODE }, null).rows).toEqual([{ label: "Zoning", text: "Zoned by the satellite city — not Metro" }]);
    // a Metro code on land the city zones is shown, not hidden
    expect(zoningRows({ ZONE_DESC: "R10" }, "City of Oak Hill")).toContainEqual({ label: "Metro's layer reads", text: "R10" });
    expect(JSON.stringify(c)).not.toMatch(/\dZZ/);
  });
  it("the legend is ONE heading naming the government, then one row per code, sorted by family; satellite land is one row; duplicates fold", () => {
    const feats = ["IR", "IWD", "R10", "R10", "SP", SATELLITE_CODE, "MUL-A"].map((z) => ({ properties: { ZONE_DESC: z } }));
    const lg = zoningLegend(legendItemsOf(feats));
    expect(lg[0]).toEqual({ heading: true, label: "Metro Nashville" });
    expect(lg.filter((r) => r.heading)).toHaveLength(1);
    const labels = lg.filter((r) => r.row).map((r) => r.label);
    expect(labels).toEqual(["R10", "MUL-A", "IR · Industrial Restrictive", "IWD · Industrial Warehousing/Distribution", "SP", "Satellite cities — zoned by each city"]);
    expect(lg.filter((r) => r.row).every((r) => r.color)).toBe(true);
    expect(zoningLegend([])).toEqual([]);
  });
  it("labels print codes on the map, nothing on satellite-city land; the style is a translucent family wash, dashed for satellite land", () => {
    expect(zoneLabelText("MUL-A")).toBe("MUL-A");
    expect(zoneLabelText(SATELLITE_CODE)).toBeNull();
    expect(zoneLabelText(" ")).toBeNull();
    const s = zoningStyle({ ZONE_DESC: "IR" }, 1);
    expect(s.fillColor).toBe(zoneColor("IR"));
    expect(s.fillOpacity).toBeLessThanOrEqual(0.45);
    expect(zoningStyle({ ZONE_DESC: SATELLITE_CODE }, 1).dashArray).toBeTruthy();
  });
});

describe("overlays, downtown code, PUDs and the NashvilleNext policy: clean cards (#45) and legends", () => {
  it("overlay: the name is already plain words; blank fields are no rows; the base-zoning note rides along", () => {
    const c = overlayCard({ ZONE_DESC: "Airport Impact", CASE_NO: " ", ORDINANCE: "O73-650", ORD_DATE: 157096800000, NAME: null, IMPACT_ZONE: " ", SUBDISTRICT: " " });
    expect(c.title).toBe("Overlay · Airport Impact");
    expect(c.rows).toEqual([{ label: "Ordinance", text: "O73-650" }, { label: "Adopted", text: "Dec 24, 1974" }]);
    expect(c.note).toMatch(/base zoning/);
    const lg = overlayLegend([{ properties: { ZONE_DESC: "Urban Design Overlay" } }, { properties: { ZONE_DESC: "Airport Impact" } }, { properties: { ZONE_DESC: "Airport Impact" } }]);
    expect(lg.map((r) => r.label)).toEqual(["Metro Nashville overlays", "Airport Impact", "Urban Design Overlay"]);
    expect(overlayColor("Airport Impact")).toBe(overlayColor("airport impact"));
    expect(overlayStyle({ ZONE_DESC: "Airport Impact" }, 1).dashArray).toBeTruthy();
  });
  it("downtown code: shouted names read as words", () => {
    expect(dtcCard({ Subdistrict: "GULCH SOUTH", UseArea: "WEST" })).toEqual({ title: "Downtown Code · Gulch South", rows: [{ label: "Subdistrict", text: "Gulch South" }, { label: "Use area", text: "West" }] });
    expect(soft("2ND AND BROADWAY")).toBe("2nd and Broadway");
  });
  it("PUD: the type exactly as typed; case and ordinance; no GIS date or global id", () => {
    const c = pudCard({ ZONE_DESC: "Res. PUD (Amended)", CASE_NO: "2000P-007G-02", ORDINANCE: "BL2000-374", ORD_DATE: 969667200000, GIS_DATE: 1090281600000, GlobalID: "x" });
    expect(c.rows.map((r) => r.label)).toEqual(["Type", "Case", "Ordinance", "Adopted"]);
    expect(c.rows[0].text).toBe("Res. PUD (Amended)");
    expect(JSON.stringify(c)).not.toMatch(/GlobalID|GIS_DATE/);
  });
  it("policy: code + the policy's own description, transect and date; a legend headed by the plan", () => {
    const c = ccmCard({ PolicyCode: "CO", PolicyDesc: "Conservation", Transect: "T2 RURAL", DateAdopted: 1498089600000 });
    expect(c.rows).toEqual([{ label: "Policy", text: "CO · Conservation" }, { label: "Transect", text: "T2 Rural" }, { label: "Adopted", text: "Jun 22, 2017" }]);
    expect(c.note).toMatch(/not zoning/);
    const lg = ccmLegend([{ properties: { PolicyCode: "CO", PolicyDesc: "Conservation" } }, { properties: { PolicyCode: "CO", PolicyDesc: "Conservation" } }]);
    expect(lg).toHaveLength(2);
    expect(lg[0]).toEqual({ heading: true, label: "NashvilleNext policy" });
    expect(ccmStyle({ PolicyCode: "CO" }, 1).fillColor).toBe(overlayColor("CO"));
    expect(ccmCard({ DateAdopted: "not a date" }).rows).toEqual([{ label: "Adopted", text: "not a date" }]);
  });
});

describe("the satellite city a site falls in", () => {
  const sq = (x0, y0, x1, y1) => ({ type: "Polygon", coordinates: [[[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]]] });
  const FC = { features: [
    { properties: { Name: "CITY OF BELLE MEADE" }, geometry: sq(-86.87, 36.08, -86.84, 36.12) },
    { properties: { Name: "CITY OF RIDGETOP" }, geometry: sq(-86.78, 36.39, -86.76, 36.41) },
  ] };
  it("names the city inside it; null outside every one, outside the county, and with no limits in hand", () => {
    expect(cityName("CITY OF BELLE MEADE")).toBe("City of Belle Meade");
    expect(satelliteFrom(FC, 36.1, -86.856)).toBe("City of Belle Meade");
    expect(satelliteFrom(FC, 36.4, -86.77)).toBe("City of Ridgetop");
    expect(satelliteFrom(FC, ELM_HILL.lat, ELM_HILL.lng)).toBeNull();
    expect(satelliteFrom(FC, 35.1495, -90.049)).toBeNull();
    expect(satelliteFrom(null, 36.1, -86.856)).toBeNull();
    expect(satelliteFrom({ features: [] }, 36.1, -86.856)).toBeNull();
  });
  it("the synchronous lookup answers from the held limits, and the card uses it", () => {
    _setSatellites(FC);
    expect(satelliteCityAt(36.1, -86.856)).toBe("City of Belle Meade");
    const lyr = ALL_LAYERS.tn_nash_zoning;
    expect(lyr.identifyCard({ ZONE_DESC: SATELLITE_CODE }, { lat: 36.1, lng: -86.856 }).rows[0].text).toBe("Zoned by City of Belle Meade — not Metro");
    expect(lyr.identifyCard({ ZONE_DESC: "IR", ORDINANCE: "O73-650" }, ELM_HILL).title).toBe("Zoning · Metro Nashville");
    _setSatellites(null);
  });
});

describe("NEW-2 — the Davidson parcel card", () => {
  // the sweep's lot: 20 CULVERT ST, STANPAR 10508026600, measured again on 2026-11-12
  const LOT = { OBJECTID: 1, STANPAR: "10508026600", FEATURETYPE: "Acreage Tract", Council: "16", TaxDist: "USD", Zoning: "IR,IWD", LUCode: "072", LUDesc: "HEAVY MANUFACTURING", PropAddr: "20 CULVERT ST", Owner: "AKZO NOBEL COATINGS INC", Acres: 9.52 };
  const labels = (rows) => rows.map((r) => r.label);
  it("shows Zoning (per assessor), Tax district, Council district, Land use and the assessor portal link", () => {
    const rows = davidsonRows(LOT);
    expect(rows).toEqual([
      { label: "Land use", value: "Heavy Manufacturing" },
      { label: "Zoning (per assessor)", value: "IR, IWD" },
      { label: "Tax district", value: "USD" },
      { label: "Council district", value: "16" },
      { label: "Assessor portal", value: ASSESSOR_PORTAL },
    ]);
    expect(ASSESSOR_PORTAL).toBe("https://portal.padctn.org/OFS/WP/Home");
  });
  it("the real card: generic Zoning / Land use are replaced, the rows land before Legal, and countyRecord reads the STANPAR account and the acres", () => {
    const attrs = { ...LOT, LegalDesc: "LOT 1" };
    const curated = apprRows(attrs);
    expect(labels(curated).filter((l) => /^Zoning/.test(l))).toEqual(["Zoning (per assessor)"]);
    expect(labels(curated)).toContain("Tax district");
    expect(labels(curated)).toContain("Council district");
    expect(labels(curated).indexOf("Council district")).toBeLessThan(labels(curated).indexOf("Legal"));
    const { more } = parcelCardRows(attrs, { acct: "10508026600" });
    expect(more.map((r) => r.label)).toEqual(expect.arrayContaining(["Zoning (per assessor)", "Tax district", "Council district", "Assessor portal"]));
    const rec = countyRecord(attrs, { idField: "STANPAR", addrField: "PropAddr" });
    expect(rec.account).toBe("10508026600");
    expect(rec.owner).toBe("AKZO NOBEL COATINGS INC");
    expect(rec.deedAcres).toBe(9.52);
  });
  it("satellite-city lots: the ZZ placeholder is words, never a code; trailing spaces trimmed; UNASSIGNED is no district; a leading-zero council number is plain", () => {
    expect(assessorZoningText("3ZZ")).toBe("Zoned by the city, not Metro");
    expect(assessorZoningText("6ZZ,R10")).toBe("Zoned by the city, not Metro (assessor also lists R10)");
    expect(assessorZoningText("4ZZ,CS,SCC")).toBe("Zoned by the city, not Metro (assessor also lists CS, SCC)");
    expect(assessorZoningText("6ZZ,6ZZ")).toBe("Zoned by the city, not Metro");
    expect(assessorZoningText("IR,IWD")).toBe("IR, IWD");
    expect(assessorZoningText("  ")).toBeNull();
    expect(taxDistrictText("OH  ")).toBe("OH");
    expect(taxDistrictText("UNASSIGNED")).toBeNull();
    expect(taxDistrictText(null)).toBeNull();
    expect(councilText("01")).toBe("1");
    expect(councilText("16")).toBe("16");
    for (const z of ["3ZZ", "4ZZ,IWD", "8ZZ", "9ZZ,AR2A"]) expect(JSON.stringify(davidsonRows({ ...LOT, Zoning: z })), z).not.toMatch(/\dZZ/);
    expect(labels(davidsonRows({ ...LOT, TaxDist: null, Council: null }))).toEqual(["Land use", "Zoning (per assessor)", "Assessor portal"]);
  });
  it("a placeholder polygon for a lot across the county line gets NO Metro row — and no zoning at all", () => {
    for (const ft of OUT_OF_COUNTY_FEATURETYPES) {
      const ph = { ...LOT, FEATURETYPE: ft, LegalDesc: `ASSESSED IN ${ft.toUpperCase()} COUNTY`, Zoning: "RS15" };
      expect(isOutOfCountyPlaceholder(ph), ft).toBe(true);
      expect(davidsonRows(ph), ft).toEqual([]);
      const l = labels(apprRows(ph));
      expect(l.some((x) => /^(Zoning|Tax district|Council|Assessor)/.test(x)), ft).toBe(false);
    }
    expect(OUT_OF_COUNTY_FEATURETYPES).toEqual(["Cheatham", "Robertson", "Rutherford", "Williamson", "Wilson"]);
    expect(isOutOfCountyPlaceholder({ ...LOT, FEATURETYPE: "USA" })).toBe(false); // federal land inside Davidson is real
  });
  it("other counties' lots are untouched", () => {
    const harris = { acct: "1234", owner_name: "X", zoning: "Residential", land_use: "Single family" };
    expect(isDavidsonRecord(harris)).toBe(false);
    expect(davidsonRows(harris)).toEqual([]);
    expect(labels(apprRows(harris))).toContain("Zoning");
  });
});

describe("NEW-2 — a click on Davidson's layer is never answered by a placeholder polygon", () => {
  const URL_ = COUNTIES.tn_davidson.layerUrl;
  afterEach(() => vi.restoreAllMocks());
  it("the layer declares the filter, keyed by URL, and no other county has one", () => {
    expect(COUNTIES_MAP.tn_davidson.pointWhere).toBe(METRO_POINT_WHERE);
    expect(pointWhereForUrl(URL_)).toBe("FEATURETYPE NOT IN ('Cheatham','Robertson','Rutherford','Williamson','Wilson')");
    expect(pointWhereForUrl(URL_ + "/")).toBe(METRO_POINT_WHERE);
    expect(pointWhereForUrl(COUNTIES.tn_rutherford.layerUrl)).toBeNull();
  });
  it("queryAtPoint puts it in the request; a layer without one sends no where", async () => {
    const urls = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (u, init) => { urls.push(String(u) + (init && init.body ? "?" + String(init.body) : "")); return { ok: true, status: 200, json: async () => ({ features: [] }), text: async () => '{"features":[]}' }; });
    await queryAtPoint(URL_, -86.7155, 36.1489);
    expect(urls.length).toBeGreaterThan(0);
    expect(decodeURIComponent(urls[0]).replace(/\+/g, " ")).toContain("where=FEATURETYPE NOT IN ('Cheatham','Robertson','Rutherford','Williamson','Wilson')");
    urls.length = 0;
    await queryAtPoint(COUNTIES.tn_rutherford.layerUrl, -86.39, 35.84);
    expect(decodeURIComponent(urls[0])).not.toMatch(/where=FEATURETYPE/);
  });
});
