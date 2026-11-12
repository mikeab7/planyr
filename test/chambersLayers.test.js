/* Chambers County TX layer rows (B2671240, 2026-11-12): the City of Mont Belvieu's zoning, water, sewer, storm and Master Drainage Plan, and the City of Baytown's zoning (its Chambers side included).
 *
 * Proved at three levels, the DeSoto way: the pure rules (how the city's hand-entered attributes read), the declared scope on every row plus the pure availability gate at real points, and — the one that matters —
 * the network itself: `syncOverlayLayers` is driven with every Chambers row ON and the URLs it actually asks for are recorded, at Targa / the Baytown industrial ground (requests expected) and at Houston, Katy,
 * Dallas, Anahuac and Atlanta (zero Mont Belvieu or Baytown requests).
 * Constraints checked: #3 (no Texas number on a non-Texas site), #4 (no naked number), #42 (100% default), #43 (click only), #45 (clean cards), #46 (names only from the city's own text), #50 (legend headed by the jurisdiction). */
import { describe, it, expect, vi, beforeAll } from "vitest";

const featureLayerCalls = [];
vi.mock("esri-leaflet", () => ({
  dynamicMapLayer: vi.fn(), imageMapLayer: vi.fn(), tiledMapLayer: vi.fn(),
  featureLayer: vi.fn((o) => { featureLayerCalls.push(o.url); return { on() {}, off() {}, addTo() { return this; }, setStyle() {}, eachFeature() {} }; }),
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
import { layerAvailableHere, drawnOverlaysOf } from "../src/workspaces/site-planner/lib/layerPanelModel.js";
import { lineLabelText } from "../src/workspaces/site-planner/lib/layerRequest.js";
import { LAYER_TIER, hierarchyProblems } from "../src/workspaces/site-planner/lib/layerWeight.js";
import { hoverRows } from "../src/workspaces/site-planner/lib/featureHover.js";
import { MONT_BELVIEU_RELAY } from "../src/workspaces/site-planner/lib/jurisdiction.js";
import {
  CHAMBERS_LAYERS, CHAMBERS_MERGE_GROUPS, CMB_RELAY, BAYTOWN_AGOL, diameterLabel, materialLabel, ownerLabel,
} from "../src/workspaces/site-planner/lib/chambersLayers.js";
import * as MB from "../src/workspaces/site-planner/lib/montBelvieuZoning.js";
import * as BT from "../src/workspaces/site-planner/lib/baytownZoning.js";

beforeAll(() => _setServiceAreas(SERVICE_AREAS));

const IDS = Object.keys(CHAMBERS_LAYERS);
const MB_IDS = IDS.filter((id) => id.startsWith("tx_mb_"));
const PLAN_IDS = IDS.filter((id) => id.startsWith("tx_mb_plan_"));
const MB_CITY_IDS = MB_IDS.filter((id) => !PLAN_IDS.includes(id));
const BT_IDS = IDS.filter((id) => id.startsWith("tx_baytown_"));
const TARGA = { lat: 29.8405, lng: -94.9019 };                // the Targa plant — Mont Belvieu's limits, "Hill Mixed Use"
const MAIN_ST = { lat: 29.8528, lng: -94.8863 };              // 1129 Main St, Mont Belvieu
const BAYTOWN_HI = { lat: 29.80, lng: -94.873 };              // Baytown's heavy-industrial ground on the Chambers side (HI, 152 ac, measured)
const COTTON_BAYOU = { lat: 29.79, lng: -94.84 };             // south of Mont Belvieu's ETJ, inside the Master Drainage Plan's Cotton Bayou watershed
const ELSEWHERE = {
  houston: { lat: 29.7604, lng: -95.3698 }, katy: { lat: 29.79, lng: -95.82 }, dallas: { lat: 32.7767, lng: -96.797 }, anahuac: { lat: 29.77, lng: -94.68 }, atlanta: { lat: 33.749, lng: -84.388 },
};
const scopeOf = (p) => ({ state: siteState(p), loc: p });

describe("the city's hand-entered attributes read as the city means them", () => {
  it.each([[8, '8"'], [12.0, '12"'], ["10", '10"'], [0.75, '0.75"'], [2.5, '2.5"']])("diameter %j → %s", (v, out) => expect(diameterLabel(v)).toBe(out));
  it.each([[0], [-1], [-9], [null], [undefined], [""], ["x"]])("diameter %j is a placeholder — nothing printed", (v) => expect(diameterLabel(v)).toBeNull());
  it("materials: the codes the data pairs with a word read as that word; unknowns and stray numerals print nothing; every other code is printed exactly as written", () => {
    expect(materialLabel("AC")).toBe("Asbestos cement");
    expect(materialLabel("Asbestos Cement")).toBe("Asbestos cement");
    expect(materialLabel("PVC")).toBe("PVC");
    expect(materialLabel("Polyvinyl chloride")).toBe("PVC");
    expect(materialLabel("PVC900")).toBe("PVC C-900");
    expect(materialLabel("PVC C-900")).toBe("PVC C-900");
    for (const nothing of ["UNK", "Unknown", " ", "", null, "11", "10", "7", "W"]) expect(materialLabel(nothing), String(nothing)).toBeNull();
    for (const asWritten of ["RCP", "HDPE", "Ductile Iron", "CMP", "PVC SDR-26"]) expect(materialLabel(asWritten)).toBe(asWritten);   // not expanded from memory
  });
  it("owners: the layer's own domain (1 Our Agency, −1 Private, −2 Other, −3 BHISD); any other code is no answer", () => {
    expect(ownerLabel(1)).toBe("City of Mont Belvieu");
    expect(ownerLabel(-1)).toBe("Private");
    expect(ownerLabel(-2)).toBe("Other");
    expect(ownerLabel(-3)).toBe("BHISD");
    for (const nothing of [null, undefined, "", " ", 0, 7]) expect(ownerLabel(nothing), String(nothing)).toBeNull();
  });
});

describe("Mont Belvieu zoning — names only from the city's own text (#46), legend headed by the jurisdiction (#50)", () => {
  it("the city's description is the name; only 'Vill.' and the 'Commerical' typo are corrected, to the code's own spelling", () => {
    expect(MB.zoneName("Hill Mixed Use")).toBe("Hill Mixed Use");
    expect(MB.zoneName("Vill. Mixed Use")).toBe("Village Mixed Use");
    expect(MB.zoneName("Freeway Commerical")).toBe("Freeway Commercial");
    expect(MB.zoneName("Rural Use")).toBe("Rural Use");
    expect(MB.zoneName("  Estate   Residential ")).toBe("Estate Residential");
    expect(MB.zoneName("Something New")).toBe("Something New");            // an unlisted description is shown exactly as the layer wrote it
    expect(MB.zoneName(" ")).toBeNull();
  });
  it("invents no district code: the layer carries none, so none is printed", () => {
    const text = JSON.stringify(MB.MB_ZONE_NAMES) + JSON.stringify(MB.zoningCard({ ZONEDESC: "Hill Mixed Use" })) + JSON.stringify(MB.zoningLegend([{ desc: "Hill Mixed Use" }]));
    expect(text).not.toMatch(/\b(VMU|HMU|FC|ER|SR|RU)\b/);
  });
  it("says there is no industrial district in the layer (the Targa plant reads Hill Mixed Use)", () => {
    expect(Object.values(MB.MB_ZONE_NAMES).some((n) => /industrial/i.test(n))).toBe(false);
    expect(MB.MB_CITATION).toMatch(/no industrial district/i);
    expect(MB.zoningCard({ ZONEDESC: "Hill Mixed Use" }).rows[0]).toEqual({ label: "Zone", text: "Hill Mixed Use" });
  });
  it("every card carries the 2017 vintage line (the brief's '2017 layer, confirm with Planning'), and a polygon with no description says so rather than going blank", () => {
    const rows = MB.zoningCard({ ZONEDESC: "Rural Use", LASTUPDATE: 1498176000000 }).rows;
    expect(rows).toContainEqual({ label: "Layer vintage", text: "2017 layer — confirm with Planning" });
    expect(rows).toContainEqual({ label: "Polygon updated", text: "Jun 23, 2017" });
    const none = MB.zoningCard({ ZONEDESC: " ", LASTUPDATE: null });
    expect(none.rows[0].text).toMatch(/not recorded/i);
    expect(none.rows.some((r) => r.label === "Polygon updated")).toBe(false);          // no empty row (#45)
    expect(MB.zoningCard({}).title).toBe("Zoning · Mont Belvieu");
  });
  it("the legend is ONE heading naming the city then one row per district in the family colour, duplicates folded", () => {
    const out = MB.zoningLegend([{ desc: "Rural Use" }, { desc: "Vill. Mixed Use" }, { desc: "Rural Use" }, { desc: "Hill Mixed Use" }, { desc: "PUD" }, { desc: " " }]);
    expect(out[0]).toEqual({ heading: true, label: "Mont Belvieu" });
    expect(out.slice(1).map((e) => e.label)).toEqual(["Rural Use", "Hill Mixed Use", "Village Mixed Use", "PUD"]);
    expect(out.slice(1).every((e) => e.row && /^#/.test(e.color))).toBe(true);
    expect(MB.zoningLegend([])).toEqual([]);
  });
  it("colour families: residential / rural / commercial / mixed / PUD, one stable colour each", () => {
    expect(MB.zoneClass("Estate Residential")).toBe("residential");
    expect(MB.zoneClass("Suburban Residential")).toBe("residential");
    expect(MB.zoneClass("Rural Use")).toBe("rural");
    expect(MB.zoneClass("Freeway Commerical")).toBe("commercial");
    expect(MB.zoneClass("Vill. Mixed Use")).toBe("mixed");
    expect(MB.zoneClass("PUD")).toBe("pud");
    expect(MB.zoneClass("???")).toBe("other");
    expect(MB.zoningStyle({ ZONEDESC: "Rural Use" }, 1)).toMatchObject({ fill: true, opacity: 1, color: MB.ZONE_COLORS.rural });
  });
});

describe("Baytown zoning — the city's own legend labels, the vintage gap said plainly, parcel-level data handled", () => {
  it("district names are the layer's own legend labels, exactly as written; PUD and SL (no legend entry) show bare", () => {
    expect(BT.zoneWithName("HI")).toBe("HI · Heavy Industrial");
    expect(BT.zoneWithName("LI")).toBe("LI · Light Industrial");
    expect(BT.zoneWithName("MF1")).toBe("MF1 · Med. Density Mixed Res.");        // the city's abbreviation, NOT expanded from memory
    expect(BT.zoneWithName("sf2")).toBe("SF2 · Mixed Res. Low/Med. Density");
    expect(BT.zoneWithName("PUD")).toBe("PUD");
    expect(BT.zoneWithName("SL")).toBe("SL");
    expect(Object.keys(BT.BT_ZONE_NAMES)).toHaveLength(16);
  });
  it("the two date shapes in ORD_Date are told apart (a 19/20 prefix is never a month); blank and nonsense are no date", () => {
    expect(BT.adoptedDate("20140724")).toBe("Jul 24, 2014");
    expect(BT.adoptedDate("08252022")).toBe("Aug 25, 2022");
    expect(BT.adoptedDate("20170325")).toBe("Mar 25, 2017");
    for (const nope of [" ", "", null, "2014", "99999999", "13252022", "20141332"]) expect(BT.adoptedDate(nope), String(nope)).toBeNull();
  });
  it("the ordinance number loses its thousands comma; a blank is no ordinance", () => {
    expect(BT.ordinanceNumber("15,178")).toBe("15178");
    expect(BT.ordinanceNumber("11326")).toBe("11326");
    expect(BT.ordinanceNumber(" ")).toBeNull();
    expect(BT.ordinanceNumber(null)).toBeNull();
  });
  it("the card: zone with its name, ordinance, date, the city's note — no empty rows — and ALWAYS the vintage line (the layer predates the new code)", () => {
    const c = BT.zoningCard({ ULDCZON_20: "HI", ORD_num: "11326", ORD_Date: "20170325", Comment_1: "HI SUP Ord No 11326 Council Meeting 3/25/2010" });
    expect(c.title).toBe("Zoning · Baytown");
    expect(c.rows.map((r) => r.label)).toEqual(["Zone", "Ordinance", "Adopted", "Note", "Layer vintage"]);
    expect(c.rows[0].text).toBe("HI · Heavy Industrial");
    const blank = BT.zoningCard({ ULDCZON_20: "LI", ORD_num: " ", ORD_Date: " ", Comment_1: " " });
    expect(blank.rows.map((r) => r.label)).toEqual(["Zone", "Layer vintage"]);
    expect(BT.zoningCard({ ULDCZON_20: null }).rows[0].text).toMatch(/not recorded/i);
    expect(BT.BAYTOWN_VINTAGE_SHORT).toMatch(/2023-02-16/);
    expect(BT.BAYTOWN_VINTAGE_SHORT).toMatch(/2025-01-01/);
    expect(BT.BAYTOWN_CITATION).toMatch(/new Unified Land Development Code effective 2025-01-01/);
  });
  it("the legend is headed 'Baytown', one code per row, blank codes skipped", () => {
    const out = BT.zoningLegend([{ code: "HI" }, { code: "SF2" }, { code: "HI" }, { code: "" }, { code: null }, { code: "SL" }]);
    expect(out[0]).toEqual({ heading: true, label: "Baytown" });
    expect(out.slice(1).map((e) => e.label)).toEqual(["SF2 · Mixed Res. Low/Med. Density", "HI · Heavy Industrial", "SL"]);
  });
  it("class colours: industrial purple, commercial orange, residential yellow; unknown codes neutral", () => {
    expect(BT.zoneClass("HI")).toBe("industrial");
    expect(BT.zoneClass("LI")).toBe("industrial");
    expect(BT.zoneClass("GC")).toBe("commercial");
    expect(BT.zoneClass("SF1")).toBe("residential");
    expect(BT.zoneClass("MF3")).toBe("residential");
    expect(BT.zoneClass("SL")).toBe("other");
    expect(BT.zoneClass("")).toBe("other");
    expect(BT.zoningStyle({ ULDCZON_20: "HI" }, 1).fillColor).toBe(BT.ZONE_COLORS.industrial);
  });
});

describe("the registry rows", () => {
  it("every row is in ALL_LAYERS, on the right host: Mont Belvieu through the relay, Baytown's AGOL org direct", () => {
    for (const id of IDS) {
      const c = ALL_LAYERS[id];
      expect(c, id).toBeTruthy();
      if (id.startsWith("tx_mb_")) expect(c.url.startsWith(`${CMB_RELAY}/`), `${id}: ${c.url}`).toBe(true);
      else expect(c.url.startsWith(BAYTOWN_AGOL), `${id}: ${c.url}`).toBe(true);
    }
    expect(CMB_RELAY).toBe(MONT_BELVIEU_RELAY);        // the layers and the ETJ rows read one relay prefix
  });
  it("declares Texas AND a region on every row — nothing is offered state-wide or nationally — and every region has geometry", () => {
    for (const id of IDS) {
      const c = ALL_LAYERS[id];
      expect(c.states, id).toEqual(["TX"]);
      expect(c.regions && c.regions.length, id).toBeGreaterThan(0);
      for (const r of c.regions) expect(SERVICE_AREAS[r], `${id}: region ${r} has no geometry`).toBeTruthy();
    }
  });
  it("draws NOTHING the brief ruled out: not the city's FEMA / Wetlands copies (LandUsePlanning layers 1 and 2), and none of the 'Citizen Problem' or collector folders", () => {
    for (const id of IDS) {
      expect(ALL_LAYERS[id].url, id).not.toMatch(/LandUsePlanning_v2\/MapServer\/[12]$/);
      expect(ALL_LAYERS[id].url, id).not.toMatch(/Citizen_Problem|Collector/i);
    }
  });
  it("carries the full row (role, group, order, source, note, minZoom) the panel and the stacking model read; names are capitalised", () => {
    for (const id of IDS) {
      const c = ALL_LAYERS[id];
      expect(["line", "point", "area"], id).toContain(c.role);
      expect(c.group, id).toBeTruthy();
      expect(c.label, id).toMatch(/^[A-Z]/);
      expect(c.source, id).toBeTruthy();
      expect(c.note, id).toBeTruthy();
      expect(Number.isFinite(c.minZoom), id).toBe(true);
    }
  });
  it("click only — never a hover popup (#43): identify is canvas/click-driven and the rows declare no hover-only mode", () => {
    for (const id of IDS) { expect(ALL_LAYERS[id].canvasIdentify, id).toBe(true); expect(ALL_LAYERS[id].hoverOnly, id).toBeUndefined(); }
  });
  it("starts at 100% like every other overlay (#42): no row sets its own opacity default", () => {
    for (const id of IDS) expect(ALL_LAYERS[id].opacity, id).toBe(1);
  });
  it("is off by default (including the whole Master Drainage Plan)", () => {
    const st = defaultOverlayState();
    for (const id of IDS) expect(st[id].on, id).toBe(false);
  });
  it("stays inside its weight tier and has a vintage line for the (i) popover", () => {
    expect(hierarchyProblems(ALL_LAYERS)).toEqual([]);
    for (const id of IDS) { expect(LAYER_TIER[id], id).toBeTruthy(); expect(layerVintage(id, ALL_LAYERS[id]), id).toBeTruthy(); }
  });
  it("every mergeGroup a row names exists (the shared Water & Sewer and Fire Hydrants rows, or one declared here)", () => {
    const shared = new Set(["water_sewer", "fire_hydrants"]);
    for (const id of IDS) { const g = ALL_LAYERS[id].mergeGroup; if (g) expect(shared.has(g) || CHAMBERS_MERGE_GROUPS[g], `${id}: ${g}`).toBeTruthy(); }
  });
  it("the Master Drainage Plan is two switchable rows (watersheds · projects) holding all 14 plan layers' worth of rows we draw", () => {
    const groups = new Set(PLAN_IDS.map((id) => ALL_LAYERS[id].mergeGroup));
    expect([...groups].sort()).toEqual(["tx_mb_plan_basins", "tx_mb_plan_projects"]);
    expect(PLAN_IDS.length).toBe(14);
    for (const id of PLAN_IDS) expect(ALL_LAYERS[id].group, id).toBe("flood");
  });
  it("Mont Belvieu's zoning asks only the two columns it reads; Baytown's asks the four it reads, simplified, following every page", () => {
    expect(ALL_LAYERS.tx_mb_zoning.fields).toEqual(["ZONEDESC", "LASTUPDATE"]);
    const b = ALL_LAYERS.tx_baytown_zoning;
    expect(b.fields).toEqual(["ULDCZON_20", "ORD_num", "ORD_Date", "Comment_1"]);
    expect(b.simplifyFactor).toBeGreaterThan(0);
    expect(b.fetchAll).toBe(true);
    expect(b.vertexBudget).toBeUndefined();            // the default budget stands — the fix is in the request
    expect(b.minZoom).toBeGreaterThanOrEqual(14);      // 24,849 parcel-level polygons: close zoom only
  });
  it("line labels print only a real pipe size (the data's 0 / −1 / −9 placeholders print nothing)", () => {
    const cfg = ALL_LAYERS.tx_mb_water_main;
    expect(lineLabelText(cfg, { DIAMETER: 8 })).toBe('8"');
    expect(lineLabelText(cfg, { DIAMETER: 0 })).toBeNull();
    expect(lineLabelText(ALL_LAYERS.tx_mb_storm_main, { DIAMETER: -9 })).toBeNull();
  });
  it("the click cards are clean (#45): a water main with placeholders prints only what the city actually said", () => {
    const rows = hoverRows(ALL_LAYERS.tx_mb_water_main, { DIAMETER: 0, MATERIAL: "UNK", OWNEDBY: 1, INSTALLDATE: null });
    expect(rows).toEqual([{ label: "Owner", text: "City of Mont Belvieu" }]);
    const full = hoverRows(ALL_LAYERS.tx_mb_water_main, { DIAMETER: 8, MATERIAL: "PVC C-900", OWNEDBY: -1, INSTALLDATE: null });
    expect(full).toEqual([{ label: "Diameter", text: '8"' }, { label: "Material", text: "PVC C-900" }, { label: "Owner", text: "Private" }]);
  });
  it("the drainage plan's ponds show their size and owner but NEVER the study's depth, volume or market value (#4)", () => {
    const rows = hoverRows(ALL_LAYERS.tx_mb_plan_ponds, { Type: "Pond", Owner: "Multiple Owners", Area_ac: 9.46613613, Depth: 5, Vol_af: 68.7, Market_Val: 0, Vol_at_TOB: 78 });
    expect(JSON.stringify(rows)).not.toMatch(/68\.7|78|Depth|Volume|Market/i);
    expect(rows.map((r) => r.label)).toEqual(expect.arrayContaining(["Type", "Owner"]));
  });
});

describe("where each row is offered — the pure gate at real points", () => {
  it("Targa and 1129 Main St: every Mont Belvieu city row and every plan row is offered; Baytown's is not", () => {
    for (const p of [TARGA, MAIN_ST]) {
      const sc = scopeOf(p);
      expect(sc.state, "Texas").toBe("TX");
      for (const id of [...MB_CITY_IDS, ...PLAN_IDS]) expect(layerAvailableHere(ALL_LAYERS[id], sc), id).toBe(true);
      for (const id of BT_IDS) expect(layerAvailableHere(ALL_LAYERS[id], sc), id).toBe(false);
    }
  });
  it("Baytown's industrial ground on the Chambers side: Baytown zoning and the drainage plan are offered; Mont Belvieu's city rows are not", () => {
    const sc = scopeOf(BAYTOWN_HI);
    for (const id of BT_IDS) expect(layerAvailableHere(ALL_LAYERS[id], sc), id).toBe(true);
    for (const id of PLAN_IDS) expect(layerAvailableHere(ALL_LAYERS[id], sc), id).toBe(true);
    for (const id of MB_CITY_IDS) expect(layerAvailableHere(ALL_LAYERS[id], sc), id).toBe(false);
  });
  it("the Cotton Bayou watershed south of the ETJ: the plan is offered, the city's utilities and zoning are not", () => {
    const sc = scopeOf(COTTON_BAYOU);
    for (const id of PLAN_IDS) expect(layerAvailableHere(ALL_LAYERS[id], sc), id).toBe(true);
    for (const id of MB_CITY_IDS) expect(layerAvailableHere(ALL_LAYERS[id], sc), id).toBe(false);
  });
  it.each(Object.entries(ELSEWHERE))("%s: not one Chambers row is offered", (_k, p) => {
    for (const id of IDS) expect(layerAvailableHere(ALL_LAYERS[id], scopeOf(p)), id).toBe(false);
  });
  it("the map's draw filter turns every one off outside Chambers (so no request fires), and leaves the right ones on inside it", () => {
    const on = Object.fromEntries(IDS.map((id) => [id, { on: true, opacity: 1 }]));
    for (const p of Object.values(ELSEWHERE)) {
      const out = drawnOverlaysOf(on, { scope: scopeOf(p), layers: ALL_LAYERS });
      for (const id of IDS) expect(out[id].on, id).toBe(false);
    }
    const at = drawnOverlaysOf(on, { scope: scopeOf(TARGA), layers: ALL_LAYERS });
    for (const id of [...MB_CITY_IDS, ...PLAN_IDS]) expect(at[id].on, id).toBe(true);
    for (const id of BT_IDS) expect(at[id].on, id).toBe(false);
  });
});

/* THE NETWORK ITSELF. A fake Leaflet map + a recording `fetch` (the layer health probe) + the mocked esri featureLayer constructor: every URL the sync pass would ask for is captured. */
describe("requests actually issued — Mont Belvieu / Baytown URLs fire in Chambers County and never elsewhere", () => {
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
    const mine = (u) => /cmbgis\.com|2iaYWEMdQLPv0ZUw/.test(u);
    return { fetched: fetched.filter(mine), built: featureLayerCalls.filter(mine) };
  }
  it("at Targa: every Mont Belvieu city row and every drainage-plan row is built — all through the relay — and Baytown's is not", async () => {
    const r = await run(TARGA);
    expect(r.built.length).toBe(MB_CITY_IDS.length + PLAN_IDS.length);
    expect(r.built.every((u) => u.startsWith("/gis-proxy/www.cmbgis.com/")), JSON.stringify(r.built)).toBe(true);
    expect(r.fetched.some((u) => /2iaYWEMdQLPv0ZUw/.test(u))).toBe(false);
  });
  it("at Baytown's industrial ground: Baytown's own AGOL layer and the drainage plan are built; no Mont Belvieu city row is", async () => {
    const r = await run(BAYTOWN_HI);
    expect(r.built.filter((u) => /2iaYWEMdQLPv0ZUw/.test(u))).toHaveLength(BT_IDS.length);
    expect(r.built.filter((u) => /cmbgis\.com/.test(u))).toHaveLength(PLAN_IDS.length);
  });
  it.each(Object.entries(ELSEWHERE))("at %s: zero requests to the Mont Belvieu server or Baytown's org", async (_k, p) => {
    const r = await run(p);
    expect(r.fetched).toEqual([]);
    expect(r.built).toEqual([]);
  });
});
