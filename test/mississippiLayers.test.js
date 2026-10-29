/* Mississippi due-diligence layer rows (NEW-1, 2026-10-29).
 *
 * What is under test: (1) every colour rule, with the legend it prints beside it; (2) every click card, over attribute bags recorded from the live services on
 * 2026-10-29; (3) that each row is registered whole, scoped to Mississippi (the DeSoto ones also to the county), and reads the URL its GIS_SOURCES row names; (4) that a
 * Texas / Georgia / Tennessee / Florida site never issues a request for any of them; (5) that the per-marker colour reaches the screen, the opacity setter and the print path. */
import { describe, it, expect, vi, beforeAll } from "vitest";

const featureLayerCalls = [];
const featureLayerObjs = [];
vi.mock("esri-leaflet", () => ({
  dynamicMapLayer: vi.fn(), imageMapLayer: vi.fn(), tiledMapLayer: vi.fn(),
  featureLayer: vi.fn((o) => { featureLayerCalls.push(o.url); const lyr = { opts: o, styles: [], on() {}, off() {}, addTo() { return this; }, setStyle(f) { this.styles.push(f); }, eachFeature() {} }; featureLayerObjs.push(lyr); return lyr; }),
}));
vi.mock("../src/workspaces/site-planner/lib/evidenceLayers.js", () => ({ overpassLayer: vi.fn(), mapillaryLayer: vi.fn() }));
vi.mock("../src/workspaces/site-planner/lib/terrainLayers.js", () => ({ contourLayer: vi.fn(), flowLayer: vi.fn(), TERRAIN_MIN_ZOOM: 13 }));
vi.mock("../src/workspaces/site-planner/lib/vectorOverlay.js", () => ({
  cachedVectorLayer: vi.fn(), cachedPipelineLayer: vi.fn(), cachedCorridorLayer: vi.fn(), isPointFeature: vi.fn((f) => !!(f && f.geometry && f.geometry.type === "Point")),
}));
vi.mock("../src/workspaces/site-planner/lib/mapSymbols.js", () => ({ installDefaultMarkerIcon: vi.fn(), pointToLayerFor: vi.fn(() => () => null) }));

import { SERVICE_AREAS } from "../src/workspaces/site-planner/lib/serviceAreaData.js";
import { _setServiceAreas } from "../src/workspaces/site-planner/lib/serviceAreas.js";
import { ALL_LAYERS, defaultOverlayState, syncOverlayLayers, layerVintage } from "../src/workspaces/site-planner/lib/layers.js";
import { siteState } from "../src/workspaces/site-planner/lib/siteRegion.js";
import { layerAvailableHere, drawnOverlaysOf } from "../src/workspaces/site-planner/lib/layerPanelModel.js";
import { pointSymbolOptions } from "../src/workspaces/site-planner/lib/layerRequest.js";
import { esriPrintFeatures } from "../src/workspaces/site-planner/lib/overlayVectorSvg.js";
import { LAYER_TIER, hierarchyProblems } from "../src/workspaces/site-planner/lib/layerWeight.js";
import { cleanCard } from "../src/workspaces/site-planner/lib/identifyCard.js";
import { VECTOR_SOURCES, isCountyLinesId } from "../src/workspaces/site-planner/lib/vectorLayers.js";
import { GIS_SOURCES } from "../src/shared/gis/sources.js";
import {
  MISSISSIPPI_LAYERS, MISSISSIPPI_VINTAGE, relayed, ustClass, UST_CLASSES, gardClass, GARD_CLASSES, wellClass, WELL_CLASSES, landfillClass, LANDFILL_CLASSES,
  damClass, DAM_CLASSES, gardCard, ustCard, wellCard, damCard, lomrCard, lomaCard, landfillCard,
} from "../src/workspaces/site-planner/lib/mississippiLayers.js";

beforeAll(() => _setServiceAreas(SERVICE_AREAS));

const IDS = Object.keys(MISSISSIPPI_LAYERS);
const DESOTO_IDS = IDS.filter((id) => (MISSISSIPPI_LAYERS[id].regions || []).includes("desoto"));
const STATEWIDE_IDS = IDS.filter((id) => !DESOTO_IDS.includes(id));
const OLIVE_BRANCH = { lat: 34.9618, lng: -89.8295 };
const MS_POINTS = { jackson: { lat: 32.2988, lng: -90.1848 }, gulfport: { lat: 30.3674, lng: -89.0928 }, tupelo: { lat: 34.2576, lng: -88.7034 }, oliveBranch: OLIVE_BRANCH };
const ELSEWHERE = {
  harris: { lat: 29.7604, lng: -95.3698 }, dallas: { lat: 32.7767, lng: -96.797 }, atlanta: { lat: 33.749, lng: -84.388 }, nashville: { lat: 36.1627, lng: -86.7816 },
  memphis: { lat: 35.1495, lng: -90.049 }, miami: { lat: 25.7617, lng: -80.1918 }, denver: { lat: 39.7392, lng: -104.9903 }, mobile: { lat: 30.6954, lng: -88.0399 },
};
const scopeOf = (p) => ({ state: siteState(p), loc: p });
const MS_HOSTS = /gis\.deq\.ms\.gov|opcgis\.deq\.state\.ms\.us|gis\.mississippi\.edu|gis\.desotocountyms\.gov/;

describe("the colour rules and the legends printed beside them", () => {
  const SETS = [
    ["UST", UST_CLASSES, ustClass, "ms_deq_ust"], ["contaminated sites", GARD_CLASSES, gardClass, "ms_deq_gard"], ["wells", WELL_CLASSES, wellClass, "ms_ogb_wells"],
    ["landfills", LANDFILL_CLASSES, landfillClass, "ms_deq_landfills"], ["dams", DAM_CLASSES, damClass, "ms_dams"],
  ];
  it.each(SETS)("%s: the row's legend is exactly the class table, and its marker colour is the table's colour", (_n, classes, classOf, id) => {
    const cfg = MISSISSIPPI_LAYERS[id];
    expect(cfg.legend.map((l) => [l.label, l.color])).toEqual(Object.values(classes).map((c) => [c.label, c.color]));
    for (const [k, c] of Object.entries(classes)) expect(c.color, `${id}.${k}`).toMatch(/^#[0-9a-f]{6}$/i);
    expect(typeof classOf).toBe("function");
  });
  it("an open release is red whatever the tank's own status says; closed and in-service tanks are not", () => {
    expect(ustClass({ RELEASE_STATUS: "Open Release", STATUS: "Confirmed Release" })).toBe("open");
    expect(ustClass({ RELEASE_STATUS: "Open Release", STATUS: "Closed Release" })).toBe("open");
    expect(ustClass({ RELEASE_STATUS: "No Release", STATUS: "Active" })).toBe("active");
    expect(ustClass({ RELEASE_STATUS: "No Release", STATUS: "Closed" })).toBe("closed");
    expect(ustClass({})).toBe("closed");
  });
  it("federal NPL wins over state status; an active state site is its own class", () => {
    expect(gardClass({ FEDERALSTATUS: "NPL", STATESTATUS: "Inactive" })).toBe("npl");
    expect(gardClass({ FEDERALSTATUS: "NPL-Proposed" })).toBe("other"); // not on the list
    expect(gardClass({ FEDERALSTATUS: "NPL-Delisted" })).toBe("other"); // cleaned up and removed
    expect(gardClass({ FEDERALSTATUS: "NFRAP", STATESTATUS: "Active" })).toBe("active");
    expect(gardClass({ FEDERALSTATUS: "Archive", STATESTATUS: "SNFA" })).toBe("other");
    expect(gardClass({})).toBe("other");
  });
  it.each([
    ["PA - Plugged and Abandoned", "plugged"], ["PAS - Plugged and Abandoned - surveyor inspection", "plugged"], ["DA - Dry and Abandoned", "plugged"],
    ["PR - Producing", "active"], ["CI - Closed In (Producing Well)", "active"], ["AI - Active Injection", "active"], ["SB - Stand By (Injection Well)", "active"],
    ["OPA - Orphaned P&A", "orphaned"], ["O - Orphaned Well", "orphaned"], ["PO - Potential Orphan", "orphaned"], ["AU - Abandoned - Unapproved", "orphaned"], ["TA - Temporarily Abandoned", "other"], ["APA - Appears P&A/No Records", "orphaned"], ["APS - Appears P&A/No Records - surveyor inspection", "orphaned"],
    ["AUS - Abandoned - Unapproved Surveyor Inspection", "orphaned"], ["NRR - No Report Required", "other"], ["DWW Domestic Water Well", "other"], ["", "other"],
  ])("well status %j → %s (every status the Board publishes — the 25,200-well census, 2026-10-29)", (statdesc, k) => expect(wellClass({ statdesc })).toBe(k));
  it("landfills: only an Active permit is the loud class; closed, inactive and unknown are quiet", () => {
    expect(landfillClass({ Status: "Active" })).toBe("active");
    expect(landfillClass({ Status: "Closed" })).toBe("closed");
    expect(landfillClass({ Status: "Inactive" })).toBe("closed");
    expect(landfillClass({})).toBe("closed");
  });
  it("dams: H / S / L are the three hazard classes; a breached or unlisted dam is the grey fourth", () => {
    expect(["H", "S", "L", "BREACHED", "FIN", "", undefined].map((h) => damClass({ HAZRDCLASS: h }))).toEqual(["high", "significant", "low", "other", "other", "other", "other"]);
  });
  it("a marker's colour reaches the screen symbol, the opacity setter and the print path from ONE rule", () => {
    const cfg = MISSISSIPPI_LAYERS.ms_deq_ust;
    for (const [k, p] of [["open", { RELEASE_STATUS: "Open Release", STATUS: "Confirmed Release" }], ["active", { RELEASE_STATUS: "No Release", STATUS: "Active" }], ["closed", { RELEASE_STATUS: "No Release", STATUS: "Closed" }]]) {
      const want = UST_CLASSES[k];
      const sym = pointSymbolOptions(cfg, 0.8, p);
      expect(sym.color, k).toBe(want.color);
      expect(sym.fillColor, k).toBe(want.color);
      expect(sym.radius, k).toBe(want.radius);
      const printed = esriPrintFeatures({ properties: p, geometry: { type: "Point", coordinates: [-89.8, 34.9] } }, cfg, (s) => s)[0];
      expect(printed.style.fill, `print ${k}`).toBe(want.color);
      expect(printed.style.radius, `print ${k}`).toBe(want.radius);
    }
    // without properties (a layer that has not loaded a feature yet) the row falls back to its flat colour — and a row with no function is untouched
    expect(pointSymbolOptions(cfg, 1).color).toBe(cfg.color);
    expect(pointSymbolOptions({ color: "#123456", pointRadius: 7 }, 1, { RELEASE_STATUS: "Open Release" })).toMatchObject({ color: "#123456", radius: 7 });
  });
});

describe("click cards — recorded attribute bags, cleaned the way the app cleans them", () => {
  const rowsOf = (card) => Object.fromEntries(cleanCard(card).rows.map((r) => [r.label, r.text]));
  it("a MDEQ contaminated site: words, a real date, no empty rows, no raw field names", () => {
    const card = gardCard({ OBJECTID: 45, SITENAME: "American Helmitin Tank Farm", TYPECLEAN: "VEP", SITEACRES: "3", SITECOUNTY: "DeSoto", SITECITY: "Olive Branch", STATESTATUS: "SNFA", FEDERALSTATUS: null,
      SITEADDRESS: "11110 Airport Road", MAJCONT: "1,1-Dichloroethylene", DATEDISCV: 838339200000 });
    const c = cleanCard(card);
    expect(c.title).toBe("American Helmitin Tank Farm");
    expect(rowsOf(card)).toEqual({ Address: "11110 Airport Road, Olive Branch", County: "DeSoto", Program: "Voluntary Evaluation Program", "State status": "SNFA", "Main contaminant": "1,1-Dichloroethylene", Discovered: "Jul 26, 1996", Acres: "3" });
    for (const r of c.rows) expect(r.label).not.toMatch(/[A-Z]{4,}|_/);
  });
  it("a site with nothing but a name still answers", () => {
    const c = cleanCard(gardCard({ SITENAME: "Old Plant", TYPECLEAN: null, STATESTATUS: null, FEDERALSTATUS: "Archive" }));
    expect(c.title).toBe("Old Plant");
    expect(c.rows).toEqual([{ label: "Federal status", text: "Archive" }]);
  });
  it("a tank facility reads in words", () => {
    expect(rowsOf(ustCard({ FACILITY_NAME: "Quick Stop #4", ADDRESS: "1 Main St", CITY: "Hernando", STATUS: "Confirmed Release", RELEASE_STATUS: "Open Release", TOTAL_TANKS: 3, OWNER_NAME: "Acme Fuel LLC" })))
      .toEqual({ Address: "1 Main St, Hernando", "Tank status": "Confirmed Release", Release: "Open Release", Tanks: "3", Owner: "Acme Fuel LLC" });
  });
  it("a landfill and a well", () => {
    expect(rowsOf(landfillCard({ Facility_N: "Prairie Bluff Landfill", Facility_T: "Municipal Solid Waste Landfills", Status: "Active", County: "Chickasaw", Acres: 236, Permit__: "SW00901B0302" })))
      .toEqual({ Type: "Municipal Solid Waste Landfills", Status: "Active", County: "Chickasaw", Acres: "236", Permit: "SW00901B0302" });
    expect(rowsOf(wellCard({ typedesc: "OIL - Production", statdesc: "PA - Plugged and Abandoned", API: "2300122827" }))).toEqual({ Type: "OIL - Production", Status: "PA - Plugged and Abandoned", "API no.": "2300122827" });
  });
  it("a dam: hazard in words, height with its unit, the two posted documents as short links — only MDEQ's own host; an empty condition is dropped", () => {
    const ok = damCard({ DAMNAME: "W B CROSS LAKE DAM", COUNTYNAME: "ATTALA", HAZRDCLASS: "L", Dam_Height: "14", CONDITION: " ", Online_EAP: "https://landandwater.deq.ms.gov/damsafety/docs/digital%20eaps/MS00001.pdf", Online_Inspect: "https://landandwater.deq.ms.gov/damsafety/docs/inspection%20reports/MS00001.pdf" });
    const c = cleanCard(ok);
    expect(c.rows.map((r) => [r.label, r.text])).toEqual([["County", "Attala"], ["Hazard class", "Low"], ["Height", "14 ft"], ["Emergency action plan", "Open"], ["Inspection report", "Open"]]);
    expect(c.rows.filter((r) => r.href).map((r) => r.href)).toEqual([
      "https://landandwater.deq.ms.gov/damsafety/docs/digital%20eaps/MS00001.pdf", "https://landandwater.deq.ms.gov/damsafety/docs/inspection%20reports/MS00001.pdf"]);
    const foreign = cleanCard(damCard({ DAMNAME: "X", Online_EAP: "https://evil.example/x.pdf", Online_Inspect: "javascript:alert(1)" }));
    expect(foreign.rows.filter((r) => r.href)).toEqual([]);
  });
  it("a dam card never prints a code the data does not explain: FIN / U / blank hazard, a zero height and the junk condition 'Test' drop out; DeSoto keeps its capital S", () => {
    const rowsOf2 = (p) => Object.fromEntries(cleanCard(damCard({ DAMNAME: "D", ...p })).rows.map((r) => [r.label, r.text]));
    for (const hz of ["FIN", "U", "", undefined]) expect(rowsOf2({ HAZRDCLASS: hz }), String(hz)).not.toHaveProperty("Hazard class");
    expect(rowsOf2({ HAZRDCLASS: "BREACHED" })["Hazard class"]).toBe("Breached");
    expect(rowsOf2({ Dam_Height: "0" })).not.toHaveProperty("Height");
    expect(rowsOf2({ CONDITION: "Test" })).not.toHaveProperty("Condition");
    expect(rowsOf2({ CONDITION: "SATISFACTORY" }).Condition).toBe("SATISFACTORY");
    expect(rowsOf2({ COUNTYNAME: "DESOTO" }).County).toBe("DeSoto");
  });
  it("FEMA letters: case numbers and links, no more than are there", () => {
    const lomr = cleanCard(lomrCard({ CASE_NO: "21-04-0112P", EFF_DATE: 1613088000000, LINK_1: "https://msc.fema.gov/a.pdf", LINK_2: null, LINK_3: " " }));
    expect(lomr.rows.map((r) => r.label)).toEqual(["FEMA case", "Effective", "FEMA letter"]);
    const loma = cleanCard(lomaCard({ CASE_NO_1: "17-04-1234A", LINK_1: "https://msc.fema.gov/b.pdf", CASE_NO_2: "19-04-0001A", LINK_2: "https://msc.fema.gov/c.pdf" }));
    expect(loma.rows.length).toBe(4);
  });
});

describe("relayed()", () => {
  it("sends the four state / county hosts through the same-origin relay and leaves everything else alone", () => {
    expect(relayed("https://gis.deq.ms.gov/arcgis/rest/services/x/MapServer/1")).toBe("/gis-proxy/gis.deq.ms.gov/arcgis/rest/services/x/MapServer/1");
    expect(relayed("https://opcgis.deq.state.ms.us/opcgis/rest/services/x/MapServer/1")).toBe("/gis-proxy/opcgis.deq.state.ms.us/opcgis/rest/services/x/MapServer/1");
    expect(relayed("https://gis.mississippi.edu/server/rest/services/x/MapServer/0")).toBe("/gis-proxy/gis.mississippi.edu/server/rest/services/x/MapServer/0");
    expect(relayed("https://services.arcgis.com/abc/ArcGIS/rest/services/x/FeatureServer/0")).toBe("https://services.arcgis.com/abc/ArcGIS/rest/services/x/FeatureServer/0");
    expect(relayed("")).toBe("");
  });
});

describe("every Mississippi row is registered whole, sourced, and scoped", () => {
  it("is in the registry and reads the URL its GIS_SOURCES row names (no inline endpoint)", () => {
    const keyOf = {
      ms_city: "msCity", ms_tribal: "msTribal", ms_deq_gard: "msDeqGard", ms_deq_ust: "msDeqUst", ms_epa_brownfields: "msBrownfields", ms_deq_landfills: "msDeqLandfills",
      ms_deq_mines: "msDeqMines", ms_ogb_wells: "msOgbWells", ms_deq_og_fields: "msDeqOgFields", ms_deq_spa: "msDeqSpa", ms_nrcs_easements: "msNrcsEasements", ms_nrhp: "msNrhp", ms_cemeteries: "msCemeteries",
      ms_crit_habitat: "msCritHabitat", ms_303d: "ms303d", ms_dams: "msDams", ms_dam_inundation: "msDamInundation", ms_desoto_drainage: "msDesotoDrainage",
      ms_desoto_levee: "msDesotoLevee", ms_desoto_lomr: "msDesotoLomr", ms_desoto_loma: "msDesotoLoma", ms_desoto_cemeteries: "msDesotoCemeteries",
    };
    expect(Object.keys(keyOf).sort()).toEqual([...IDS].sort());
    for (const [id, key] of Object.entries(keyOf)) {
      expect(ALL_LAYERS[id], id).toBeTruthy();
      expect(ALL_LAYERS[id].url, id).toBe(relayed(GIS_SOURCES[key].serviceUrl));
      expect(GIS_SOURCES[key].states, key).toEqual(["MS"]);
      expect(GIS_SOURCES[key].tier, key).toBe("production");
      expect(GIS_SOURCES[key].lastVerified, key).toBe("2026-10-29");
      if (GIS_SOURCES[key].where) expect(ALL_LAYERS[id].where, id).toBe(GIS_SOURCES[key].where);
    }
  });
  it("declares Mississippi on every row, and the county on the DeSoto ones", () => {
    for (const id of IDS) expect(ALL_LAYERS[id].states, id).toEqual(["MS"]);
    for (const id of DESOTO_IDS) expect(ALL_LAYERS[id].regions, id).toEqual(["desoto"]);
    for (const id of STATEWIDE_IDS) expect(ALL_LAYERS[id].regions, id).toBeUndefined();
    expect(DESOTO_IDS.sort()).toEqual(["ms_desoto_cemeteries", "ms_desoto_drainage", "ms_desoto_levee", "ms_desoto_loma", "ms_desoto_lomr"]);
  });
  it("carries the full row the panel, the stacking model and the (i) read — and every number is cited to its source, never a regulatory width", () => {
    for (const id of IDS) {
      const c = ALL_LAYERS[id];
      expect(["line", "point", "area"], id).toContain(c.role);
      expect(["jurisdiction", "environmental", "flood"], id).toContain(c.group);
      expect(c.label, id).toMatch(/^[A-Z]/);
      expect(c.source, id).toBeTruthy();
      expect(c.note, id).toBeTruthy();
      expect(c.infoCaveat || c.note, id).toBeTruthy();
      expect(Number.isFinite(c.minZoom), id).toBe(true);
      expect(Number.isFinite(c.order), id).toBe(true);
      expect(typeof c.identifyCard, id).toBe("function");
      expect(c.kind, id).toBe("esriFeature");
      if (c.group === "flood") expect(["regulatory", "local", "hydrography", "advisory"], id).toContain(c.floodTier);
    }
  });
  it("declares no `fields` list on any row: esri-leaflet draws by the unique-id field, and a list that omits it collapses every feature to one id (live on the preview: one marker of ten)", () => {
    for (const id of IDS) expect(ALL_LAYERS[id].fields, id).toBeUndefined();
  });
  it("draws no assumed buffer or setback anywhere: Mississippi has no statewide stream / wetland buffer rule in the sources found", () => {
    for (const id of IDS) { expect(ALL_LAYERS[id].bufferRule, id).toBeUndefined(); expect(ALL_LAYERS[id].kind, id).not.toBe("pipelineCorridor"); }
  });
  it("is tiered (county / city = context, the rest by what it can do to a deal), within the tier ceilings", () => {
    expect(hierarchyProblems(ALL_LAYERS)).toEqual([]);
    for (const id of [...IDS, "ms_county_state"]) expect(LAYER_TIER[id], id).toBeTruthy();
    expect(LAYER_TIER.ms_city).toBe("context");
  });
  it("has a vintage line for every row", () => {
    expect(Object.keys(MISSISSIPPI_VINTAGE).sort()).toEqual([...IDS].sort());
    for (const id of IDS) expect(layerVintage(id, ALL_LAYERS[id]), id).toBeTruthy();
  });
  it("is off by default", () => {
    const st = defaultOverlayState();
    for (const id of [...IDS, "ms_county_state"]) expect(st[id].on, id).toBe(false);
  });
  it("the statewide county lines are a registered vector source (the Georgia lesson), keep DeSoto out of the pull, and count as county lines for names and the PDF", () => {
    expect(ALL_LAYERS.ms_county_state.kind).toBe("vector");
    expect(ALL_LAYERS.ms_county_state.states).toEqual(["MS"]);
    const src = VECTOR_SOURCES.ms_county_state;
    expect(src).toBeTruthy();
    expect(src.query.url).toBe(`${ALL_LAYERS.ms_county_state.url}/query`);
    expect(isCountyLinesId("ms_county_state")).toBe(true);
  });
  it("the `where` of every filtered row is pinned to the value measured live (a wrong literal once excluded nothing and drew DeSoto twice)", () => {
    expect(ALL_LAYERS.ms_epa_brownfields.where).toBe("STATE_CODE='MS'");
    expect(ALL_LAYERS.ms_nrhp.where).toBe("State = 'MISSISSIPPI'");
    expect(ALL_LAYERS.ms_cemeteries.where).toBe("STATE = 'MS'");
    expect(ALL_LAYERS.ms_city.where).toBe("County <> 'DeSoto'");
    expect(VECTOR_SOURCES.ms_county_state.query.where).toBe("UPPER(CONAME) <> 'DESOTO'"); // MDEQ stores the name as "Desoto"
  });
  it("the heavy polygon rows ask the server to generalise and sit at a zoom where their cells fit the draw budget (live: Gulf sturgeon habitat alone is 725,409 vertices)", () => {
    for (const id of ["ms_crit_habitat", "ms_deq_og_fields", "ms_dam_inundation"]) {
      expect(ALL_LAYERS[id].simplifyFactor, id).toBeGreaterThan(0);
      expect(ALL_LAYERS[id].minZoom, id).toBeGreaterThanOrEqual(9);
    }
  });
  it("the statewide city layer leaves DeSoto County's five cities to the county's own (newer) layer", () => {
    expect(ALL_LAYERS.ms_city.where).toBe("County <> 'DeSoto'");
    expect(ALL_LAYERS.ms_desoto_city).toBeTruthy();
  });
});

describe("where each row is offered", () => {
  it.each(Object.entries(MS_POINTS))("%s: every statewide row is offered", (_k, p) => {
    for (const id of [...STATEWIDE_IDS, "ms_county_state"]) expect(layerAvailableHere(ALL_LAYERS[id], scopeOf(p)), id).toBe(true);
  });
  it("the DeSoto rows are offered in DeSoto County and nowhere else in the state", () => {
    for (const id of DESOTO_IDS) {
      expect(layerAvailableHere(ALL_LAYERS[id], scopeOf(OLIVE_BRANCH)), `${id} at Olive Branch`).toBe(true);
      for (const k of ["jackson", "gulfport", "tupelo"]) expect(layerAvailableHere(ALL_LAYERS[id], scopeOf(MS_POINTS[k])), `${id} at ${k}`).toBe(false);
    }
  });
  it.each(Object.entries(ELSEWHERE))("%s: not one Mississippi row is offered", (_k, p) => {
    for (const id of [...IDS, "ms_county_state"]) expect(layerAvailableHere(ALL_LAYERS[id], scopeOf(p)), id).toBe(false);
  });
});

describe("requests actually issued", () => {
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
      await new Promise((r) => setTimeout(r, 200));
    } finally { globalThis.fetch = realFetch; }
    const mine = (u) => MS_HOSTS.test(u) || /cJ9YHowT8TU7DUyn|FiaPA4ga0iQKduv3|QVENGdaPbd4LUkLV|carto\.nationalmap\.gov/.test(u);
    return { fetched: fetched.filter(mine), built: featureLayerCalls.filter(mine) };
  }
  it("at Olive Branch every statewide row and every DeSoto row is built", async () => {
    const r = await run(OLIVE_BRANCH);
    expect(r.built.length).toBe(IDS.length);
  });
  it("at Jackson the statewide rows are built and not one DeSoto County request fires", async () => {
    const r = await run(MS_POINTS.jackson);
    expect(r.built.length).toBe(STATEWIDE_IDS.length);
    expect(r.built.concat(r.fetched).some((u) => /desotocountyms/.test(u))).toBe(false);
  });
  it("the opacity setter keeps each marker's own colour (a flat restyle would turn every tank the same colour on the first slider move)", async () => {
    featureLayerObjs.length = 0;
    await run(OLIVE_BRANCH);
    const cases = [
      ["ms_deq_ust", UST_CLASSES, [[{ RELEASE_STATUS: "Open Release", STATUS: "Confirmed Release" }, "open"], [{ RELEASE_STATUS: "No Release", STATUS: "Closed" }, "closed"]]],
      ["ms_ogb_wells", WELL_CLASSES, [[{ statdesc: "OPA - Orphaned P&A" }, "orphaned"], [{ statdesc: "PA - Plugged and Abandoned" }, "plugged"]]],
      ["ms_dams", DAM_CLASSES, [[{ HAZRDCLASS: "H" }, "high"], [{ HAZRDCLASS: "L" }, "low"]]],
    ];
    for (const [id, classes, feats] of cases) {
      const lyr = featureLayerObjs.find((l) => l.opts.url === ALL_LAYERS[id].url);
      expect(lyr, id).toBeTruthy();
      lyr.setOpacity(0.4);
      const styleFn = lyr.styles[lyr.styles.length - 1];
      expect(typeof styleFn, id).toBe("function");
      for (const [props, k] of feats) {
        const st = styleFn({ properties: props, geometry: { type: "Point", coordinates: [-89.8, 34.9] } });
        expect(st.color, `${id} ${k}`).toBe(classes[k].color);
        expect(st.opacity, `${id} ${k}`).toBe(0.4);
      }
    }
  });
  it.each(Object.entries(ELSEWHERE))("at %s: zero requests to any Mississippi source", async (_k, p) => {
    const r = await run(p);
    expect(r.fetched).toEqual([]);
    expect(r.built).toEqual([]);
  });
});
