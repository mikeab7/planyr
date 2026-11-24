/* NEW-1 (Waller County layers, 2026-11-24) — proposed thoroughfares, Katy Prairie Conservancy land, water/sewer service areas, MUDs and the county floodway buffer.
 *
 * Holds: (1) the six rows exist, are Texas-only AND region-scoped to the Waller polygon (hidden at Harris / Fort Bend / Dallas / Georgia points, shown at Waller points);
 * (2) every row reads a registry source at the county's own ArcGIS Online org and nothing rides the relay; (3) the click cards are CLEAN — plain labels, no raw field names,
 * no sentinel placeholders, no contact columns; (4) the floodway buffer is a map layer only and says it is not the screening buffer; (5) the registry fixtures exist per row and no fixture
 * invents a count (the host is unreachable from the build sandbox — the live endpoint truth is the V# pass). */
import { describe, it, expect, vi, beforeAll } from "vitest";

vi.mock("esri-leaflet", () => ({ dynamicMapLayer: vi.fn(), imageMapLayer: vi.fn(), tiledMapLayer: vi.fn(), featureLayer: vi.fn() }));
vi.mock("../src/workspaces/site-planner/lib/evidenceLayers.js", () => ({ overpassLayer: vi.fn(), mapillaryLayer: vi.fn() }));
vi.mock("../src/workspaces/site-planner/lib/terrainLayers.js", () => ({ contourLayer: vi.fn(), flowLayer: vi.fn(), TERRAIN_MIN_ZOOM: 13 }));
vi.mock("../src/workspaces/site-planner/lib/vectorOverlay.js", () => ({ cachedVectorLayer: vi.fn(), cachedPipelineLayer: vi.fn(), cachedCorridorLayer: vi.fn(), isPointFeature: vi.fn() }));
vi.mock("../src/workspaces/site-planner/lib/mapSymbols.js", () => ({ installDefaultMarkerIcon: vi.fn(), pointToLayerFor: vi.fn(() => () => null) }));

import { ALL_LAYERS } from "../src/workspaces/site-planner/lib/layers.js";
import { siteState } from "../src/workspaces/site-planner/lib/siteRegion.js";
import { layerAvailableHere, drawnOverlaysOf } from "../src/workspaces/site-planner/lib/layerPanelModel.js";
import { _setServiceAreas } from "../src/workspaces/site-planner/lib/serviceAreas.js";
import { SERVICE_AREAS } from "../src/workspaces/site-planner/lib/serviceAreaData.js";
import { GIS_SOURCES, auditRegistry } from "../src/shared/gis/sources.js";
import { SOURCE_FIXTURES, SOURCE_DOCS } from "../src/shared/gis/sourceFixtures.js";
import { LAYER_TIER } from "../src/workspaces/site-planner/lib/layerWeight.js";
import {
  WALLER_LAYERS, BUFFER_STATUS, soft, acresText, thoroughfareCard, cpcEasementCard, cpcOwnedCard, ccnCard, mudCard, floodwayBufferCard,
} from "../src/workspaces/site-planner/lib/wallerLayers.js";

beforeAll(() => _setServiceAreas(SERVICE_AREAS));

const IDS = ["waller_thoroughfare", "waller_cpc_easements", "waller_cpc_owned", "waller_ccn", "waller_mud", "waller_floodway_buffer"];
const KEYS = { waller_thoroughfare: "wallerThoroughfare", waller_cpc_easements: "wallerCpcEasements", waller_cpc_owned: "wallerCpcOwned", waller_ccn: "wallerCcn", waller_mud: "wallerMud", waller_floodway_buffer: "wallerFloodwayBuffer" };
const scopeOf = (p) => ({ state: siteState(p), loc: p });
const MUD19 = { lat: 29.785, lng: -95.93 }; // the sweep's named point: "Waller County MUD 19"
const HEMPSTEAD = { lat: 30.1, lng: -96.08 };
const HOUSTON = { lat: 29.76, lng: -95.37 };
const FULSHEAR = { lat: 29.69, lng: -95.9 }; // Fort Bend
const DALLAS = { lat: 32.78, lng: -96.8 };
const GEORGIA = { lat: 32.84, lng: -83.63 };

describe("the six Waller rows are registered, Texas-only and region-scoped", () => {
  it("all six are in the registry, and nothing else was added under the waller_ prefix", () => {
    expect(Object.keys(WALLER_LAYERS).sort()).toEqual([...IDS].sort());
    for (const id of IDS) expect(ALL_LAYERS[id], id).toBe(WALLER_LAYERS[id]);
    expect(Object.keys(ALL_LAYERS).filter((k) => k.startsWith("waller_")).sort()).toEqual([...IDS].sort());
  });
  it("the duplicates the sweep measured are NOT re-wired (RRC pipelines, FEMA flood zones)", () => {
    const text = JSON.stringify(Object.values(WALLER_LAYERS).map((c) => [c.label, c.url]));
    expect(text).not.toMatch(/pipeline|flood zone|floodplain/i);
  });
  it("the Waller polygon is in the service-area data", () => { expect(SERVICE_AREAS.waller.polys.length).toBeGreaterThan(0); });
  it.each(IDS)("%s: states [TX], regions [waller]", (id) => {
    expect(ALL_LAYERS[id].states).toEqual(["TX"]);
    expect(ALL_LAYERS[id].regions).toEqual(["waller"]);
  });
  it.each(IDS)("%s is offered at Waller points and hidden at Houston, Fort Bend, Dallas and Georgia points", (id) => {
    const cfg = ALL_LAYERS[id];
    expect(layerAvailableHere(cfg, scopeOf(MUD19)), "Waller MUD 19").toBe(true);
    expect(layerAvailableHere(cfg, scopeOf(HEMPSTEAD)), "Hempstead").toBe(true);
    for (const [name, pt] of [["Houston", HOUSTON], ["Fulshear", FULSHEAR], ["Dallas", DALLAS], ["Georgia", GEORGIA]]) expect(layerAvailableHere(cfg, scopeOf(pt)), name).toBe(false);
  });
  it("the draw filter turns every row off outside the county (no request fires) and leaves them on inside it", () => {
    const on = Object.fromEntries(IDS.map((id) => [id, { on: true, opacity: 1 }]));
    const inside = drawnOverlaysOf(on, { scope: scopeOf(MUD19), layers: ALL_LAYERS });
    for (const id of IDS) expect(inside[id].on, id).toBe(true);
    for (const elsewhere of [HOUSTON, FULSHEAR, DALLAS, GEORGIA]) {
      const drawn = drawnOverlaysOf(on, { scope: scopeOf(elsewhere), layers: ALL_LAYERS });
      for (const id of IDS) expect(drawn[id].on, id).toBe(false);
    }
  });
});

/* ⛔ THE GUARD THAT WOULD HAVE CAUGHT PR 3031: every layer is its OWN FeatureServer service in the county's org. The first cut pointed all six at the single
 * `Brookshire_Katy_Drainage_District1` service (which only has layer 54) and every row answered "Invalid URL" live. These are the service paths MEASURED LIVE on 2026-11-24. */
const ORG = "https://services1.arcgis.com/BqVKz0o32DERqyE4/arcgis/rest/services";
const URLS = {
  wallerThoroughfare: `${ORG}/Proposed_Thoroughfare/FeatureServer/10`,
  wallerCpcEasements: `${ORG}/CPC_Protected_Properties_2024/FeatureServer/0`,
  wallerCpcOwned: `${ORG}/CPC_owned_2024/FeatureServer/0`,
  wallerCcn: `${ORG}/CCN_Boundaries/FeatureServer/0`,
  wallerMud: `${ORG}/MUDs/FeatureServer/103`,
  wallerFloodwayBuffer: `${ORG}/Floodway_Buffer_100ft/FeatureServer/51`,
};
describe("every row reads a registry source at the county's own ArcGIS Online org", () => {
  it.each(Object.entries(KEYS))("%s → GIS_SOURCES.%s", (id, key) => {
    const src = GIS_SOURCES[key];
    expect(src, key).toBeTruthy();
    expect(ALL_LAYERS[id].url).toBe(src.serviceUrl);
    expect(src.serviceUrl).not.toMatch(/\/gis-proxy\//);
    expect(src.states).toEqual(["TX"]);
    expect(src.tier).toBe("production");
  });
  it("each row's service URL is exactly the measured one — its own service, never the BKDD boundary service", () => {
    for (const [key, url] of Object.entries(URLS)) {
      expect(GIS_SOURCES[key].serviceUrl, key).toBe(url);
      expect(GIS_SOURCES[key].serviceUrl, key).not.toMatch(/Brookshire_Katy_Drainage_District/);
    }
    expect(Object.keys(URLS).sort()).toEqual(Object.values(KEYS).sort());
  });
  it("the one service that DOES hold the BKDD boundary (layer 54) is the only thing that may point at it; no Waller county row shares a service", () => {
    const services = Object.values(URLS).map((u) => u.split("/").slice(-3, -2)[0]);
    expect(new Set(services).size).toBe(services.length);
    expect(GIS_SOURCES.bkdd.serviceUrl).toMatch(/Brookshire_Katy_Drainage_District1\/FeatureServer$/);
    expect(GIS_SOURCES.bkdd.layerId).toBe(54);
  });
  it("the file production actually loads says the same: the lazy pack loader, the all-packs tooling copy and the file text on disk all carry the measured URLs", async () => {
    const { SOURCE_PACKS } = await import("../src/shared/gis/sourcePacks.js");
    const { PACKS_ALL } = await import("../src/shared/gis/sourcePacksAll.js");
    const { readFileSync } = await import("node:fs");
    const loaded = await SOURCE_PACKS.find((p) => p.id === "waller").load(); // the exact path lazyLayerFiles.js takes in production
    for (const [key, url] of Object.entries(URLS)) {
      expect(loaded.sources[key].serviceUrl, `lazy pack ${key}`).toBe(url);
      expect(PACKS_ALL.waller.sources[key].serviceUrl, `all-packs ${key}`).toBe(url);
    }
    const text = readFileSync(new URL("../src/shared/gis/sourcesWaller.js", import.meta.url), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    expect(text).not.toMatch(/Brookshire_Katy_Drainage_District/);
    for (const svc of ["Proposed_Thoroughfare", "CPC_Protected_Properties_2024", "CPC_owned_2024", "CCN_Boundaries", "MUDs", "Floodway_Buffer_100ft"]) expect(text, svc).toContain(svc);
  });
  it("every service URL is shaped <org>/<Service>/FeatureServer/<layer>", () => {
    for (const [key, url] of Object.entries(URLS)) expect(url, key).toMatch(/^https:\/\/services1\.arcgis\.com\/BqVKz0o32DERqyE4\/arcgis\/rest\/services\/[A-Za-z0-9_]+\/FeatureServer\/\d+$/);
  });
  it("the Waller city-limits name column is CITY (measured live), in the registry row and the jurisdiction source", () => {
    expect(GIS_SOURCES.city_waller.fields.name).toBe("CITY");
  });
  it("the registry audit is clean for the Waller rows (a fixture each, two places ≥ 2 km apart, a tier, a state scope)", () => {
    const mine = Object.fromEntries(Object.entries(GIS_SOURCES).filter(([k]) => Object.values(KEYS).includes(k)));
    expect(Object.keys(mine).length).toBe(6);
    expect(auditRegistry(mine, SOURCE_FIXTURES, SOURCE_DOCS).problems).toEqual([]);
  });
  it("fixtures: the named MUD 19 point is present, and only the sweep's countywide counts assert a feature exists (no invented per-area counts)", () => {
    expect(SOURCE_FIXTURES.wallerMud.fixtures.some((f) => f.point && Math.abs(f.point[0] + 95.93) < 1e-4 && Math.abs(f.point[1] - 29.785) < 1e-4 && f.expectMinCount === 1)).toBe(true);
    for (const key of Object.values(KEYS)) for (const f of SOURCE_FIXTURES[key].fixtures) {
      if (f.expectMinCount >= 1) expect(f.point || /countywide/.test(f.label), `${key}: ${f.label}`).toBeTruthy();
      expect(f.expectMinCount, `${key}: ${f.label}`).toBeLessThanOrEqual(1);
    }
    for (const key of ["wallerCpcEasements", "wallerCpcOwned"]) for (const f of SOURCE_FIXTURES[key].fixtures) expect(f.expectMinCount, key).toBe(0);
  });
});

describe("the click cards are clean (owner constraint #45) and honest", () => {
  const RAW = /\b(StreetName|ROW_CLASS|ProposeROW|CE_holder|OBJECTID|CCN_Name|MUD_Name|undefined|null|NaN)\b/;
  const text = (card) => JSON.stringify(card);
  it("thoroughfare: the name, 'Proposed — not built', the class and the right-of-way", () => {
    const c = thoroughfareCard({ StreetName: "FM 1488 EXTENSION", ROW_CLASS: "MAJOR ARTERIAL", ProposeROW: "120", Status: "Proposed" });
    expect(c.title).toBe("FM 1488 Extension");
    expect(c.rows).toEqual([{ label: "Plan status", text: "Proposed — not built" }, { label: "Road class", text: "Major Arterial" }, { label: "Proposed right-of-way", text: "120" }]);
    expect(text(c)).not.toMatch(RAW);
  });
  it("thoroughfare: blanks and placeholders drop out; a card with nothing but a name still has a title", () => {
    const c = thoroughfareCard({ StreetName: " ", ROW_CLASS: null, ProposeROW: -9999, Status: "" });
    expect(c.title).toBe("Proposed roadway");
    expect(c.rows).toEqual([{ label: "Plan status", text: "Proposed — not built" }]);
    expect(thoroughfareCard({ StreetName: "X", Status: "Under study" }).rows[0].text).toBe("Proposed — Under study");
    expect(thoroughfareCard().title).toBe("Proposed roadway");
  });
  it("Conservancy easement and fee land: name, holder, acreage, a plain 'what this is'", () => {
    const c = cpcEasementCard({ Name: "WARREN RANCH TRACT", CE_holder: "Katy Prairie Conservancy" });
    expect(c.title).toBe("Warren Ranch Tract");
    expect(c.rows.map((r) => r.label)).toEqual(["What this is", "Easement holder"]);
    expect(text(c)).not.toMatch(RAW);
    expect(cpcEasementCard({}).title).toBe("Conservation easement");
    expect(cpcEasementCard({ Name: "N", CE_holder: "NP" }).rows.length).toBe(1);
    const o = cpcOwnedCard({ Property: "Cypress Creek Tract", Acres: 412.6 });
    expect(o.title).toBe("Cypress Creek Tract");
    expect(o.rows).toEqual([{ label: "What this is", text: "Land the Katy Prairie Conservancy owns outright — not developable" }, { label: "Size", text: "413 acres" }]);
    expect(cpcOwnedCard({}).title).toBe("Katy Prairie Conservancy land");
    expect(cpcOwnedCard({ Property: "P", Acres: 0 }).rows.length).toBe(1);
    expect(acresText(12.34)).toBe("12.3 acres");
    expect(acresText("junk")).toBe("");
  });
  it("CCN card: utility, service, certificate number, status — nothing it cannot read", () => {
    expect(ccnCard({ UTILITY: "CITY OF HEMPSTEAD", CCN_TYPE: "Water", TYPE: "WATER", CCN_NO: "12345", STATUS: "A", COUNTY: "Waller", OBJECTID: 4 })).toEqual({
      title: "City of Hempstead", rows: [{ label: "Service", text: "Water" }, { label: "Certificate number", text: "12345" }, { label: "Status", text: "Active" }],
    });
    expect(ccnCard({ UTILITY: "X", CCN_TYPE: "Sewer", TYPE: "Wastewater" }).rows.map((r) => r.label)).toEqual(["Service", "Type"]);
    expect(ccnCard({ OBJECTID: 1 })).toEqual({ title: "Water / sewer service area", rows: [] });
    expect(text(ccnCard({ UTILITY: "X", COUNTY: "Waller", CONTACT_PHONE: "555-0100" }))).not.toMatch(/555|COUNTY/);
  });
  it("MUD card: name, district id, type, status", () => {
    expect(mudCard({ NAME: "Waller County MUD 19", DISTRICT_ID: "WC19", TYPE: "MUD", STATUS: "A", COUNTY: "Waller" })).toEqual({
      title: "Waller County MUD 19", rows: [{ label: "District ID", text: "WC19" }, { label: "Type", text: "MUD" }, { label: "Status", text: "Active" }],
    });
    expect(mudCard({}).title).toBe("Municipal utility district");
    expect(text(mudCard({ NAME: "M", POC: "A Person", PHONE: "555" }))).not.toMatch(/Person|555/);
  });
  it("floodway buffer: says it is the county's own drawing, not FEMA and not the screening buffer", () => {
    expect(BUFFER_STATUS).toMatch(/not the effective FEMA map/);
    expect(BUFFER_STATUS).toMatch(/not Planyr's screening buffer/);
    expect(floodwayBufferCard().rows).toEqual([{ label: "What this is", text: BUFFER_STATUS }]);
    const c = floodwayBufferCard({ FLD_ZONE: "AE", ZONE_SUBTY: "FLOODWAY", BUFF_DIST: 100 });
    expect(c.rows.map((r) => r.text)).toEqual(["Zone AE", "Floodway", BUFFER_STATUS]);
    expect(text(c)).not.toMatch(/BUFF_DIST|\b100\b/); // the buffer distance is never printed
  });
  it("soft() reads shouted text", () => {
    expect(soft("FM 359 RD")).toBe("FM 359 Rd");
    expect(soft("Already Mixed")).toBe("Already Mixed");
  });
  it("every row's click card is wired (no hover popup — the card only opens on a click, owner constraint #43)", () => {
    for (const id of IDS) {
      expect(typeof ALL_LAYERS[id].identifyCard, id).toBe("function");
      expect(ALL_LAYERS[id].hoverTitle, id).toBeUndefined();
      expect(ALL_LAYERS[id].hoverFields, id).toBeUndefined();
    }
  });
});

describe("placement and the standing owner rules", () => {
  it("groups: thoroughfares Access, Conservancy rows Environmental, CCN and MUDs Utilities, the buffer Flood & Drainage", () => {
    expect(ALL_LAYERS.waller_thoroughfare.group).toBe("access");
    expect(ALL_LAYERS.waller_thoroughfare.role).toBe("line");
    for (const id of ["waller_cpc_easements", "waller_cpc_owned"]) expect(ALL_LAYERS[id].group, id).toBe("environmental");
    for (const id of ["waller_ccn", "waller_mud"]) expect(ALL_LAYERS[id].group, id).toBe("utilities");
    expect(ALL_LAYERS.waller_floodway_buffer.group).toBe("flood");
  });
  it("the floodway buffer joins a flood tier with an agency and the Waller area; it is a map layer, not wired into the screening math", () => {
    const b = ALL_LAYERS.waller_floodway_buffer;
    expect(["regulatory", "local", "hydrography", "advisory"]).toContain(b.floodTier);
    expect(b.agency).toBeTruthy();
    expect(b.areaCounties).toEqual(["waller"]);
    expect(b.infoCaveat).toMatch(/screening keeps its own modelled floodway buffer/);
  });
  it("every row declares a stacking role, a zone gate, a source and a loudness tier (layerWeight)", () => {
    for (const id of IDS) {
      expect(["area", "line", "point"]).toContain(ALL_LAYERS[id].role);
      expect(ALL_LAYERS[id].minZoom, id).toBeGreaterThanOrEqual(10);
      expect(ALL_LAYERS[id].source, id).toBeTruthy();
      expect(LAYER_TIER[id], id).toBeTruthy();
    }
  });
  it("opacity: no row sets its own default below 100% (owner constraint #42)", () => {
    for (const id of IDS) expect(ALL_LAYERS[id].opacity ?? 1, id).toBe(1);
  });
  it("no row requests a personal-contact column", () => {
    for (const id of IDS) for (const f of ALL_LAYERS[id].fields || []) expect(f, `${id}.${f}`).not.toMatch(/PHONE|POC|CONTACT|EMAIL/i);
  });
});
