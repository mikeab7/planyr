/* City of Sugar Land layer rows (NEW-1, 2026-11-02).
 *
 * THE RULE UNDER TEST: every one of these layers appears only where the city's data is — inside the City of Sugar Land's limits or ETJ — and a Harris County / Dallas / Atlanta site must NEVER
 * issue a request for them. Proved at three levels, as DeSoto's is: the declared scope on every row, the pure availability gate at real points (ON at the Academy point; OFF at Harris County
 * and in Georgia), and the network itself — `syncOverlayLayers` is driven with every Sugar Land row switched ON and the URLs it actually asks for are recorded. */
import { describe, it, expect, vi, beforeAll } from "vitest";

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
import { ALL_LAYERS, defaultOverlayState, syncOverlayLayers, layerVintage, MERGE_GROUPS } from "../src/workspaces/site-planner/lib/layers.js";
import { siteState } from "../src/workspaces/site-planner/lib/siteRegion.js";
import { layerAvailableHere, drawnOverlaysOf, inRegion } from "../src/workspaces/site-planner/lib/layerPanelModel.js";
import { LAYER_TIER, hierarchyProblems } from "../src/workspaces/site-planner/lib/layerWeight.js";
import { GIS_SOURCES, auditRegistry } from "../src/shared/gis/sources.js";
import { SOURCE_FIXTURES, SOURCE_DOCS } from "../src/shared/gis/sourceFixtures.js";
import {
  SUGARLAND_LAYERS, SUGARLAND_MERGE_GROUPS, UTILITY_MAP_REQUEST_URL, relayed, SUGARLAND_RELAY, soft, money, cityHref,
  airportCard, airportStyle, AIRPORT_AREAS, AIRPORT_CODE_URL, fluCard, fluLegend, hydrantCard, cupCard, exceptionCard, varianceCard, cipCard, CIP_WHERE, rowLandCard, tirzCard, availableSiteCard, devProjectCard,
} from "../src/workspaces/site-planner/lib/sugarLandLayers.js";
import { THOROUGHFARE_WHERE } from "../src/workspaces/site-planner/lib/sugarLandThoroughfare.js";

beforeAll(() => _setServiceAreas(SERVICE_AREAS));

const IDS = Object.keys(SUGARLAND_LAYERS);
const ACADEMY = { lat: 29.6122, lng: -95.6693 };      // the owner's "Academy" site, Concept A — inside the city limits beside Sugar Land Regional Airport
const CITY_HALL = { lat: 29.6197, lng: -95.6349 };
const ELSEWHERE = {
  harris: { lat: 29.7604, lng: -95.3698 }, harrisWest: { lat: 29.8, lng: -95.54 }, dallas: { lat: 32.7767, lng: -96.797 }, atlanta: { lat: 33.749, lng: -84.388 },
  georgiaMacon: { lat: 32.84, lng: -83.63 }, katy: { lat: 29.7858, lng: -95.8245 }, missouriCity: { lat: 29.6186, lng: -95.5377 }, sienna: { lat: 29.485, lng: -95.51 }, memphis: { lat: 35.1495, lng: -90.049 },
};
const scopeOf = (p) => ({ state: siteState(p), loc: p });
const CITY_HOST = /interactivemaps\.sugarlandtx\.gov/;
const ORG = /(SVtsrBXEiBhI5L5n|VVapzOPgBae5joyC)/; // the city's org, and CDM Smith's public copy of the water / sewer network (NEW-1, 2026-11-06)

describe("the Sugar Land service area is a real boundary (the city's limits ∪ its ETJ)", () => {
  it("is built into the generated area data with polygons", () => {
    expect(SERVICE_AREAS.sugarland).toBeTruthy();
    expect(SERVICE_AREAS.sugarland.polys.length).toBeGreaterThan(5);
    expect(SERVICE_AREAS.sugarland.source).toMatch(/CityLimits_ETJ/);
  });
  it("contains the Academy point and City Hall; excludes Harris County, Georgia, Katy, Missouri City and Sienna", () => {
    expect(inRegion("sugarland", ACADEMY)).toBe(true);
    expect(inRegion("sugarland", CITY_HALL)).toBe(true);
    for (const [k, p] of Object.entries(ELSEWHERE)) expect(inRegion("sugarland", p), k).toBe(false);
  });
});

describe("every Sugar Land row is registered whole and scoped to the city", () => {
  it("is in the registry, on the city's two hosts only (the city server through the relay, the org direct)", () => {
    for (const id of IDS) {
      const c = ALL_LAYERS[id];
      expect(c, id).toBeTruthy();
      expect(c.url.startsWith(SUGARLAND_RELAY) || ORG.test(c.url), `${id}: ${c.url}`).toBe(true);
      expect(/^https?:/.test(c.url) && CITY_HOST.test(c.url), `${id} must never call the city server directly (no CORS header)`).toBe(false);
    }
  });
  it("declares Texas AND the sugarland region on every row — no row is offered state-wide", () => {
    for (const id of IDS) {
      const c = ALL_LAYERS[id];
      expect(c.states, id).toEqual(["TX"]);
      expect(c.regions, id).toEqual(["sugarland"]);
      expect(SERVICE_AREAS[c.regions[0]], id).toBeTruthy();
    }
  });
  it("carries the full row the panel and the stacking model read; names are capitalised", () => {
    for (const id of IDS) {
      const c = ALL_LAYERS[id];
      expect(["line", "point", "area"], id).toContain(c.role);
      expect(c.group, id).toBeTruthy();
      expect(c.label, id).toMatch(/^[A-Z]/);
      expect(c.source, id).toBeTruthy();
      expect(c.note, id).toBeTruthy();
      expect(Number.isFinite(c.minZoom), id).toBe(true);
      expect(typeof c.identifyCard, id).toBe("function");
      expect(c.canvasIdentify, id).toBe(true);
    }
  });
  it("stays inside its weight tier, has a tier and a vintage line", () => {
    expect(hierarchyProblems(ALL_LAYERS)).toEqual([]);
    for (const id of IDS) { expect(LAYER_TIER[id], id).toBeTruthy(); expect(layerVintage(id, ALL_LAYERS[id]), id).toBeTruthy(); }
  });
  it("starts at 100% opacity and is off by default", () => {
    const st = defaultOverlayState();
    for (const id of IDS) { expect(st[id].on, id).toBe(false); expect(ALL_LAYERS[id].opacity ?? 1, id).toBe(1); }
  });
  it("no row sets a `fields` list that omits the object-id field (it collapses every feature into one)", () => {
    for (const id of IDS) {
      const f = ALL_LAYERS[id].fields;
      if (f) expect(f.some((n) => /^(OBJECTID|FID)$/.test(n)), id).toBe(true);
    }
  });
  it("the hydrant row asks only for the id and install date — no creator / editor / work-order fields", () => {
    expect(ALL_LAYERS.sl_hydrants.fields).toEqual(["OBJECTID", "FacilityID", "InstallDate"]);
    expect(JSON.stringify(ALL_LAYERS.sl_hydrants)).not.toMatch(/Creator|Editor|WorkorderID|LocationDescription/);
  });
  it("the rows whose source carries contacts or editor names request only a named list of non-personal fields", () => {
    const PERSONAL = /email|phone|telephone|Superintendent|Contractor|Manager|Inspector|Engineer|Creator|Editor|created_us|last_edite|ConfirmedB|LastEdited|OADDR|OWNERZIP|HIDEOWNER/i;
    for (const id of ["sl_dev_projects", "sl_capital_projects", "sl_hydrants", "sl_zoning_cup", "sl_zoning_exception", "sl_zoning_variance", "sl_public_land"]) {
      const f = ALL_LAYERS[id].fields;
      expect(Array.isArray(f) && f.length > 1, `${id} must name its fields`).toBe(true);
      expect(f.filter((n) => PERSONAL.test(n)), id).toEqual([]);
    }
  });
  it("the three zoning-case layers are ONE panel row; the hydrants join the existing Fire Hydrants row", () => {
    for (const id of ["sl_zoning_cup", "sl_zoning_exception", "sl_zoning_variance"]) expect(ALL_LAYERS[id].mergeGroup, id).toBe("sl_zoning_cases");
    expect(MERGE_GROUPS.sl_zoning_cases).toBe(SUGARLAND_MERGE_GROUPS.sl_zoning_cases);
    expect(ALL_LAYERS.sl_hydrants.mergeGroup).toBe("fire_hydrants");
  });
  it("the water and sewer rows exist, are tagged with the data's year, and never show a bare 'Water Mains' / 'Storm' row (the city publishes no storm lines)", () => {
    for (const id of ["sl_water_lines", "sl_sewer_gravity", "sl_sewer_laterals", "sl_sewer_force", "sl_water_valves", "sl_water_control_valves", "sl_manholes", "sl_cleanouts", "sl_lift_stations", "sl_wwtp", "sl_water_plants", "sl_water_wells"]) {
      expect(ALL_LAYERS[id], id).toBeTruthy();
      expect(ALL_LAYERS[id].group, id).toBe("utilities");
    }
    expect(ALL_LAYERS.sl_water_lines.label).toBe("Water Lines · as of 2017");
    for (const g of ["sl_sewer_lines", "sl_valves", "sl_sewer_structures", "sl_plants"]) expect(MERGE_GROUPS[g].label, g).toMatch(/ · as of 2017$/);
    expect(MERGE_GROUPS.sl_sewer_lines.label).toBe("Sewer Lines · as of 2017");
    expect(IDS.some((id) => /storm/.test(id))).toBe(false);
    for (const id of IDS) expect(ALL_LAYERS[id].label, id).not.toMatch(/storm/i);
  });
  it("close-zoom gates on the dense layers", () => {
    expect(ALL_LAYERS.sl_public_land.minZoom).toBeGreaterThanOrEqual(16);
    expect(ALL_LAYERS.sl_hydrants.minZoom).toBeGreaterThanOrEqual(16);
  });
});

describe("the registry rows (GIS_SOURCES) the weekly health check covers", () => {
  const KEYS = ["slThoroughfare", "slZoning", "slAirportZoning", "slFlu", "slHydrants", "slCups", "slSpecialExceptions", "slVariances", "slCip", "slRowLand", "slTirz", "slAvailableSites", "slDevProjects",
    "slWaterLines", "slSewerGravity", "slSewerLaterals", "slSewerForce", "slWaterValves", "slWaterControlValves", "slManholes", "slCleanouts", "slLiftStations", "slWwtp", "slWaterPlants", "slWaterWells"];
  it("has a row per layer, and passes the registry audit with fixtures", () => {
    for (const k of KEYS) expect(GIS_SOURCES[k], k).toBeTruthy();
    const { problems } = auditRegistry(GIS_SOURCES, SOURCE_FIXTURES, SOURCE_DOCS);
    expect(problems.filter((p) => KEYS.some((k) => p.startsWith(k + ":")))).toEqual([]);
  });
  it("every row has ≥2 fixture points, and the exact Academy origin is among them wherever a feature sits in its box", () => {
    for (const k of KEYS) expect(SOURCE_FIXTURES[k].fixtures.length, k).toBeGreaterThanOrEqual(2);
    for (const k of ["slThoroughfare", "slZoning", "slAirportZoning", "slFlu", "slHydrants", "slCip", "slRowLand"]) {
      expect(SOURCE_FIXTURES[k].fixtures.some((f) => f.point[0] === -95.6693 && f.point[1] === 29.6122), `${k} lacks the Academy point`).toBe(true);
    }
  });
  it("the city's own server rows are flagged for the relay and nothing else is", () => {
    for (const k of KEYS) expect(!!GIS_SOURCES[k].relay, k).toBe(/interactivemaps\.sugarlandtx\.gov/.test(GIS_SOURCES[k].serviceUrl));
    expect(GIS_SOURCES.slThoroughfare.relay).toBe(true);
    expect(GIS_SOURCES.slHydrants.relay).toBeUndefined();
  });
  it("the layer rows read their `where` from the registry (one definition)", () => {
    expect(ALL_LAYERS.sl_thoroughfare.where).toBe(THOROUGHFARE_WHERE);
    expect(ALL_LAYERS.sl_capital_projects.where).toBe(CIP_WHERE);
    expect(ALL_LAYERS.sl_hydrants.where).toBe(GIS_SOURCES.slHydrants.where);
    expect(GIS_SOURCES.slHydrants.where).toMatch(/Active/);
  });
  it("the zoning layer reads the copy that returns geometry (the Interactive_Map copy returns attributes only)", () => {
    expect(GIS_SOURCES.slZoning.serviceUrl).toMatch(/\/Zoning_GWNT\/MapServer\/0$/);
  });
});

describe("where each row is offered — the pure gate at real points", () => {
  it("every row is offered at the Academy point and at City Hall", () => {
    for (const p of [ACADEMY, CITY_HALL]) {
      const sc = scopeOf(p);
      expect(sc.state).toBe("TX");
      for (const id of IDS) expect(layerAvailableHere(ALL_LAYERS[id], sc), id).toBe(true);
    }
  });
  it.each(Object.entries(ELSEWHERE))("%s: not one Sugar Land row is offered", (_k, p) => {
    for (const id of IDS) expect(layerAvailableHere(ALL_LAYERS[id], scopeOf(p)), id).toBe(false);
  });
  it("the map's draw filter turns every one off outside the city (so no request fires) and leaves them on inside it", () => {
    const on = Object.fromEntries(IDS.map((id) => [id, { on: true, opacity: 1 }]));
    const out = drawnOverlaysOf(on, { scope: scopeOf(ELSEWHERE.harris), layers: ALL_LAYERS });
    for (const id of IDS) expect(out[id].on, id).toBe(false);
    const inside = drawnOverlaysOf(on, { scope: scopeOf(ACADEMY), layers: ALL_LAYERS });
    for (const id of IDS) expect(inside[id].on, id).toBe(true);
  });
});

describe("requests actually issued — Sugar Land URLs fire inside the city and never elsewhere", () => {
  const fakeMap = () => {
    const panes = {};
    return {
      _loaded: true, getSize: () => ({ x: 800, y: 600 }), getZoom: () => 18, getPane: (n) => panes[n], createPane: (n) => { const el = { style: {} }; panes[n] = el; return el; },
      whenReady(cb) { cb(); }, on() {}, off() {}, hasLayer: () => false,
    };
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
    const mine = (u) => CITY_HOST.test(u) || ORG.test(u);
    return { fetched: fetched.filter(mine), built: featureLayerCalls.map((o) => o.url).filter(mine), calls: featureLayerCalls.filter((o) => mine(o.url)) };
  }
  it("at the Academy point every row is built, the city server only through the relay, and the hydrant request is narrowed", async () => {
    const r = await run(ACADEMY);
    expect(r.built.length).toBe(IDS.length);
    expect(r.built.some((u) => u.startsWith(SUGARLAND_RELAY))).toBe(true);
    expect(r.built.filter((u) => /^https?:\/\/interactivemaps/.test(u))).toEqual([]);
    const hyd = r.calls.find((o) => /COSLHydrantInspections/.test(o.url));
    expect(hyd.fields).toEqual(["OBJECTID", "FacilityID", "InstallDate"]);
    expect(hyd.where).toMatch(/Active/);
    const tf = r.calls.find((o) => /Master_Thoroughfare_Plan/.test(o.url));
    expect(tf.where).toBe(THOROUGHFARE_WHERE);
  });
  it.each(Object.entries(ELSEWHERE))("at %s: zero requests to the city server or the city's org", async (_k, p) => {
    const r = await run(p);
    expect(r.fetched).toEqual([]);
    expect(r.built).toEqual([]);
  });
});

describe("airport zoning — the city's colours; the cards carry Chapter 9's land-use text and never a height", () => {
  const text = (t) => JSON.stringify(airportCard({ TYPE: t }));
  const row = (t, l) => (airportCard({ TYPE: t }).rows.find((r) => r.label === l) || {}).text;
  it("keeps the city's five colours", () => {
    expect(AIRPORT_AREAS["AZ-01"].color).toBe("#ebebb5");
    expect(AIRPORT_AREAS["AZ-02"].color).toBe("#de8585");
    expect(AIRPORT_AREAS.ANID.color).toBe("#cb88e3");
    expect(AIRPORT_AREAS["AVIGATION EASEMENT"].color).toBe("#84e8d1");
    expect(AIRPORT_AREAS["AIRPORT PROPERTY"].color).toBe("#86b3eb");
    expect(airportStyle({ TYPE: "AZ-02" }, 1).fillColor).toBe("#de8585");
    expect(new Set(Object.values(AIRPORT_AREAS).map((a) => a.color)).size).toBe(5);
  });
  it("AZ-01: the industrial line comes FIRST — warehouse and distribution permitted, subject to the base zoning, Sec. 9-17 Table 9-17.1", () => {
    const c = airportCard({ TYPE: "AZ-01" });
    expect(c.title).toBe("Airport zoning · AZ-01");
    expect(c.rows[0]).toEqual({ label: "Warehouse & distribution", text: "Permitted here, subject to the base zoning (Sec. 9-17, Table 9-17.1)." });
    expect(c.rows[1].text).toMatch(/Light manufacturing, heavy manufacturing, mini-warehouse and self-storage, wholesale uses, railroad freight yard/);
    expect(row("AZ-01", "Residential")).toMatch(/Prohibited.*Sec\. 9-16.*all residential uses and some nonresidential uses/);
    expect(row("AZ-01", "What this is")).toMatch(/Airport Zoning District 1 \(Sec\. 9-14\).*both the base zoning and AZ-01 apply/);
    expect(c.rows.some((r) => r.href === AIRPORT_CODE_URL)).toBe(true);
  });
  it("AZ-02: warehouse and distribution NOT permitted; manufacturing and wholesale blank; only the rows that were read are listed as permitted", () => {
    const c = airportCard({ TYPE: "AZ-02" });
    expect(c.rows[0]).toEqual({ label: "Warehouse & distribution", text: "Not permitted here (Sec. 9-17, Table 9-17.1)." });
    expect(row("AZ-02", "Also not permitted")).toMatch(/Light and heavy manufacturing and wholesale uses/);
    expect(row("AZ-02", "Permitted")).toMatch(/Includes municipal airport, railroad freight yard and utilities\. Table 9-17\.1 has the full schedule/);
    expect(row("AZ-02", "What this is")).toMatch(/Airport Zoning District 2 \(Sec\. 9-14\).*both the base zoning and AZ-02 apply/);
    expect(row("AZ-02", "Residential")).toMatch(/Sec\. 9-16/);
  });
  it("ANID: Airport Noise Impact District, no land use restrictions, consider the noise, Sec. 9-16 plat statement", () => {
    const c = airportCard({ TYPE: "ANID" });
    expect(c.rows.map((r) => r.text)).toEqual(expect.arrayContaining(["Airport Noise Impact District (Sec. 9-15).", "No land use restrictions are imposed in it. Landowners should consider the noise impact.", "Sec. 9-16 requires a statement on the plat."]));
  });
  it("avigation easement and airport property are LABELS ONLY — no code text is claimed", () => {
    for (const t of ["AVIGATION EASEMENT", "AIRPORT PROPERTY"]) expect(row(t, "Meaning")).toBe("Label only — the code text for this area was not read.");
    expect(airportCard({ TYPE: "SOMETHING NEW" }).rows[0].text).toMatch(/Something New/);
  });
  it("NO card states a height or a distance, and none claims a height zone", () => {
    for (const t of Object.keys(AIRPORT_AREAS)) {
      expect(text(t), t).not.toMatch(/\b\d+\s*(ft|feet|foot|')/i);
      expect(text(t), t).not.toMatch(/AGL|MSL|maximum height|height limit|height zone|conical|transitional|horizontal/i);
    }
  });
  it("the info line says the code governs and that height limits are on a separate city map", () => {
    const i = ALL_LAYERS.sl_airport_zoning.infoCaveat;
    expect(i).toMatch(/Chapter 9 governs/);
    expect(i).toMatch(/Height limits are on a separate city map/);
    expect(ALL_LAYERS.sl_airport_zoning.note).not.toMatch(/height/i);
    expect(AIRPORT_CODE_URL).toBe("https://library.municode.com/tx/sugar_land/codes/land_development_code?nodeId=CH9SULAREAIZORE");
  });
});

describe("the other click cards read real values and drop the empty ones", () => {
  it("future land use: title-cased class, planning area; the comprehensive-plan line is on the row", () => {
    expect(fluCard({ FUTURE_LAND_USE: "LIGHT INDUSTRIAL", SUBREGION: "Subarea 1" })).toEqual({ title: "Light Industrial", rows: [{ label: "Planning area", text: "Subarea 1" }] });
    expect(fluCard({ FUTURE_LAND_USE: "COMPANY TOWN - MXD USE" }).title).toBe("Company Town - MXD Use");
    expect(ALL_LAYERS.sl_flu.infoCaveat).toMatch(/not zoning/);
    expect(ALL_LAYERS.sl_flu.infoCaveat).toMatch(/213\.005/);
    const lg = fluLegend([{ properties: { FUTURE_LAND_USE: "LIGHT INDUSTRIAL" } }, { properties: { FUTURE_LAND_USE: "LIGHT INDUSTRIAL" } }, { properties: { FUTURE_LAND_USE: "AIRPORT" } }]);
    expect(lg.map((e) => e.label)).toEqual(["Airport", "Light Industrial"]);
  });
  it("hydrants: id and install date when present, nothing invented when blank", () => {
    expect(hydrantCard({ FacilityID: "wH0000168", InstallDate: 1117584000000 }).rows).toEqual([{ label: "ID", text: "wH0000168" }, { label: "Installed", text: "Jun 1, 2005" }]);
    expect(hydrantCard({ FacilityID: null, InstallDate: null })).toEqual({ title: "Fire hydrant", rows: [] });
  });
  it("conditional use permit: project, request, district, approval, ordinance, a real https PDF", () => {
    const c = cupCard({ Project_Na: "Audi Dealership", Descriptio: "Operate automobile dealership and service center", District: "B-2", Date_Appro: 1415059200000, Ordinance: 1978, Category: "ESTABLISHED NEW", PDF: "https://www.sugarlandtx.gov/DocumentCenter/View/39307/Ordinance-1978-Audi-CUP" });
    expect(c.title).toBe("Conditional use permit");
    expect(c.rows.map((r) => r.label)).toEqual(["Project", "Request", "District", "Approved", "Ordinance", "Status", "Ordinance PDF"]);
    expect(c.rows.find((r) => r.label === "Status").text).toBe("Established");
    expect(cupCard({ Project_Na: " ", Descriptio: "Operate hospital" }).rows.map((r) => r.label)).toEqual(["Request"]);
  });
  it("special exception / variance: case, date, request, result — an Excel-zero date and a blank case never print", () => {
    const e = exceptionCard({ Case_No_: " ", DATE_: -2209161600000, ZONING_DIS: "R-1-I", REQUEST: "Rear Yard Setback Requirement", ACTION: "APPROVED", RESULT: "Patio cover to be constructed in accordance to the site plan." });
    expect(e.rows).toEqual([{ label: "District", text: "R-1-I" }, { label: "Request", text: "Rear Yard Setback Requirement" }, { label: "Result", text: "Approved — Patio cover to be constructed in accordance to the site plan." }]);
    const v = varianceCard({ CASE_NO: "VR-00.002", DATE: 1270512000000, ZONING_DIS: "ETJ", REQUEST: "Lot Depth", ACTION: "DENIED", RESULT: " " });
    expect(v.rows).toEqual([{ label: "Case", text: "VR-00.002" }, { label: "Date", text: "Apr 6, 2010" }, { label: "District", text: "ETJ" }, { label: "Request", text: "Lot Depth" }, { label: "Result", text: "Denied" }]);
    expect(varianceCard({ ACTION: "NO ACTION" }).rows[0].text).toBe("No action");
  });
  it("capital project: title, phase, status, budget in words — no manager or email", () => {
    const c = cipCard({ Title: "Oyster Creek Diversion Channel", Phase: "Construction", Status: "In Progress", Budget: 27500000, Manager: "Robert Wilson", ProjectManagerEmail: "rwilson@sugarlandtx.gov" });
    expect(c).toEqual({ title: "Oyster Creek Diversion Channel", rows: [{ label: "Phase", text: "Construction" }, { label: "Status", text: "In Progress" }, { label: "Budget", text: "$27.5 million" }] });
    expect(JSON.stringify(c)).not.toMatch(/Wilson|@/);
    expect(money(150000)).toBe("$150,000");
    expect(money(0)).toBeNull();
    expect(money(null)).toBeNull();
    expect(money(2000000)).toBe("$2 million");
  });
  it("public land: owner, address, plain type, acres", () => {
    expect(rowLandCard({ OWNERNAME: "Fort Bend County", SITUS: "Cunningham Creek BLVD", PARCELTYPE: "RoadROW", LANDSIZEAC: 2.459 })).toEqual({ title: "Fort Bend County", rows: [{ label: "Address", text: "Cunningham Creek BLVD" }, { label: "Type", text: "Road right-of-way" }, { label: "Acres", text: "2.46" }] });
  });
  it("TIRZ / available sites / development projects", () => {
    expect(tirzCard({ NAME: "TIRZ 2", TIRZNOTES: "INACTIVE", ACRES: 371.3 }).rows).toEqual([{ label: "Status", text: "Inactive" }, { label: "Acres", text: "371" }]);
    expect(tirzCard({ NAME: "TIRZ 3", TIRZNOTES: "Imperial Redevelopment Zone", ACRES: 840.9 }).rows[0]).toEqual({ label: "Notes", text: "Imperial Redevelopment Zone" });
    expect(availableSiteCard({ Name: "Imperial HS-2F", Property_Type: "Commercial", Ownership: "Multiple Owners", acres: "±2.7 Acres" }).rows.map((r) => r.text)).toEqual(["Commercial", "Multiple Owners", "±2.7 Acres"]);
    const d = devProjectCard({ Project_Name: "Mithai Plaza", Address: "177 Citadel Way, Sugar Land, TX 77478", Status: "In Progress", Construction_Start: 1727721406007, Contractor: "x", Contractor_email: "a@b.c", Superintendent_Phone: "555" });
    expect(d.rows.map((r) => r.label)).toEqual(["Address", "Status", "Construction start"]);
    expect(JSON.stringify(d)).not.toMatch(/a@b\.c|555/);
  });
  it("small readers", () => {
    expect(soft("NEIGHBORHOOD ACTIVITY CENTER")).toBe("Neighborhood Activity Center");
    expect(soft("Already Mixed")).toBe("Already Mixed");
    expect(cityHref("http://www.sugarlandtx.gov/DocumentCenter/View/1")).toBe("https://www.sugarlandtx.gov/DocumentCenter/View/1");
    expect(cityHref("https://evil.example/x")).toBeNull();
    expect(relayed("https://interactivemaps.sugarlandtx.gov/512/rest/services/X/MapServer/0")).toBe("/gis-proxy/interactivemaps.sugarlandtx.gov/512/rest/services/X/MapServer/0");
    expect(relayed("https://services1.arcgis.com/a/b")).toBe("https://services1.arcgis.com/a/b");
  });
});

describe("the Utilities group carries NO paragraph — the note and the request link are behind each row's (i)", () => {
  it("there is no group note function or object any more", () => {
        expect(UTILITY_MAP_REQUEST_URL).toBe("https://survey123.arcgis.com/share/a9755767526546b5a9509d1648399862");
    expect(ALL_LAYERS.sl_water_lines.infoLink.href).toBe(UTILITY_MAP_REQUEST_URL);
  });
  it("the hydrant row no longer claims the city publishes no water lines", () => {
    expect(ALL_LAYERS.sl_hydrants.infoCaveat).not.toMatch(/does not publish/);
    expect(ALL_LAYERS.sl_hydrants.note).not.toMatch(/closest public trace/);
  });
});
