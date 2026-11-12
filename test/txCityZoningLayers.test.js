/* Texas city zoning layer rows — Richmond, Fulshear (two layers), Stafford (NEW-1, 2026-11-12).
 *
 * THE RULE UNDER TEST: each row appears only inside its city's limits, and a site anywhere else (Sugar Land, Houston, Dallas, Georgia, Rosenberg, Katy…) must NEVER issue a request for it.
 * Proved at three levels, as Sugar Land's is: the declared scope on every row, the pure availability gate at real points, and the network itself (`syncOverlayLayers` driven with every row ON). */
import { describe, it, expect, vi, beforeAll } from "vitest";

const featureLayerCalls = [];
vi.mock("esri-leaflet", () => ({
  dynamicMapLayer: vi.fn(), imageMapLayer: vi.fn(), tiledMapLayer: vi.fn(),
  featureLayer: vi.fn((o) => { featureLayerCalls.push(o); return { on() {}, off() {}, addTo() { return this; }, setStyle() {}, eachFeature() {} }; }),
}));
vi.mock("../src/workspaces/site-planner/lib/evidenceLayers.js", () => ({ overpassLayer: vi.fn(), mapillaryLayer: vi.fn() }));
vi.mock("../src/workspaces/site-planner/lib/terrainLayers.js", () => ({ contourLayer: vi.fn(), flowLayer: vi.fn(), TERRAIN_MIN_ZOOM: 13 }));
vi.mock("../src/workspaces/site-planner/lib/vectorOverlay.js", () => ({ cachedVectorLayer: vi.fn(), cachedPipelineLayer: vi.fn(), cachedCorridorLayer: vi.fn(), isPointFeature: vi.fn() }));
vi.mock("../src/workspaces/site-planner/lib/mapSymbols.js", () => ({ installDefaultMarkerIcon: vi.fn(), pointToLayerFor: vi.fn(() => () => null) }));

import { SERVICE_AREAS } from "../src/workspaces/site-planner/lib/serviceAreaData.js";
import { _setServiceAreas } from "../src/workspaces/site-planner/lib/serviceAreas.js";
import { ALL_LAYERS, defaultOverlayState, syncOverlayLayers, layerVintage } from "../src/workspaces/site-planner/lib/layers.js";
import { siteState } from "../src/workspaces/site-planner/lib/siteRegion.js";
import { layerAvailableHere, drawnOverlaysOf, inRegion } from "../src/workspaces/site-planner/lib/layerPanelModel.js";
import { LAYER_TIER, hierarchyProblems } from "../src/workspaces/site-planner/lib/layerWeight.js";
import { GIS_SOURCES, auditRegistry } from "../src/shared/gis/sources.js";
import { SOURCE_FIXTURES, SOURCE_DOCS } from "../src/shared/gis/sourceFixtures.js";
import { TX_CITY_ZONING_LAYERS } from "../src/workspaces/site-planner/lib/txCityZoningLayers.js";
import { RICHMOND, FULSHEAR, FULSHEAR_NEWER, STAFFORD } from "../src/workspaces/site-planner/lib/txCityZoning.js";

beforeAll(() => _setServiceAreas(SERVICE_AREAS));

const IDS = Object.keys(TX_CITY_ZONING_LAYERS);
const REGION_OF = { richmond_zoning: "richmond", fulshear_zoning: "fulshear", fulshear_zoning_newer: "fulshear", stafford_zoning: "stafford" };
/* Real points, each ON a vertex of that city's own zoning layer (sourceFixturesTxCityZoning.js). */
const INSIDE = {
  richmond: { lat: 29.5822, lng: -95.76094 },
  fulshear: { lat: 29.69419, lng: -95.89986 },
  stafford: { lat: 29.61618, lng: -95.5574 },
};
const ELSEWHERE = {
  sugarLandAcademy: { lat: 29.6122, lng: -95.6693 }, houston: { lat: 29.7604, lng: -95.3698 }, dallas: { lat: 32.7767, lng: -96.797 }, atlanta: { lat: 33.749, lng: -84.388 },
  katy: { lat: 29.7858, lng: -95.8245 }, rosenberg: { lat: 29.5572, lng: -95.8087 }, sienna: { lat: 29.485, lng: -95.51 }, memphis: { lat: 35.1495, lng: -90.049 },
};
const scopeOf = (p) => ({ state: siteState(p), loc: p });
const SERVICE_HOSTS = /(riku34rn6C8cs2t5|k1ZyjVw1fpWcwy7h|Ga5PFntoooL0Dlwu)/;

describe("each city's service area is a real boundary (TxGIO city limits)", () => {
  it.each(["richmond", "fulshear", "stafford"])("%s is built into the generated area data", (k) => {
    expect(SERVICE_AREAS[k]).toBeTruthy();
    expect(SERVICE_AREAS[k].polys.length).toBeGreaterThan(0);
    expect(SERVICE_AREAS[k].source).toMatch(/Texas_City_Boundaries/);
  });
  it("contains its own zoning-layer vertices", () => {
    for (const [k, p] of Object.entries(INSIDE)) expect(inRegion(k, p), k).toBe(true);
  });
  it("excludes the other cities and everywhere else", () => {
    for (const k of Object.keys(INSIDE)) {
      for (const [name, p] of Object.entries(ELSEWHERE)) expect(inRegion(k, p), `${k} must not hold ${name}`).toBe(false);
    }
    expect(inRegion("richmond", INSIDE.fulshear)).toBe(false);
    expect(inRegion("fulshear", INSIDE.stafford)).toBe(false);
    expect(inRegion("stafford", INSIDE.richmond)).toBe(false);
  });
});

describe("every row is registered whole and scoped to its city", () => {
  it("declares Texas AND its city's region on every row — none is offered state-wide", () => {
    for (const id of IDS) {
      const c = ALL_LAYERS[id];
      expect(c, id).toBeTruthy();
      expect(c.states, id).toEqual(["TX"]);
      expect(c.regions, id).toEqual([REGION_OF[id]]);
    }
  });
  it("reads each city's own public ArcGIS Online service directly (no relay needed), URL from the registry row", () => {
    const want = { richmond_zoning: "richmondZoning", fulshear_zoning: "fulshearZoning", fulshear_zoning_newer: "fulshearZoningNewer", stafford_zoning: "staffordZoning" };
    for (const id of IDS) {
      expect(ALL_LAYERS[id].url, id).toBe(GIS_SOURCES[want[id]].serviceUrl);
      expect(ALL_LAYERS[id].url, id).toMatch(SERVICE_HOSTS);
      expect(ALL_LAYERS[id].url.startsWith("https://"), id).toBe(true);
    }
  });
  it("carries the full row the panel reads; names say the city; legend and card are the city's", () => {
    for (const id of IDS) {
      const c = ALL_LAYERS[id];
      expect(c.role, id).toBe("area");
      expect(c.group, id).toBe("jurisdiction");
      expect(c.label, id).toMatch(/^(Richmond|Fulshear|Stafford) Zoning/);
      expect(c.source, id).toBeTruthy();
      expect(c.note, id).toBeTruthy();
      expect(c.infoCaveat, id).toMatch(/limits only/);
      expect(Number.isFinite(c.minZoom), id).toBe(true);
      expect(typeof c.identifyCard, id).toBe("function");
      expect(typeof c.viewLegend, id).toBe("function");
      expect(typeof c.styleFn, id).toBe("function");
      expect(c.canvasIdentify, id).toBe(true);
      expect(c.lineLabel.format, id).toBeTypeOf("function");
    }
  });
  it("each row prints the field its own layer holds the code in", () => {
    expect(ALL_LAYERS.richmond_zoning.lineLabel.field).toBe("Zone");
    expect(ALL_LAYERS.fulshear_zoning.lineLabel.field).toBe("Zone_Distr");
    expect(ALL_LAYERS.fulshear_zoning_newer.lineLabel.field).toBe("Zone_Distr");
    expect(ALL_LAYERS.stafford_zoning.lineLabel.field).toBe("ZONE_CODE");
    expect(ALL_LAYERS.richmond_zoning.styleFn).toBe(RICHMOND.style);
    expect(ALL_LAYERS.fulshear_zoning.styleFn).toBe(FULSHEAR.style);
    expect(ALL_LAYERS.fulshear_zoning_newer.styleFn).toBe(FULSHEAR_NEWER.style);
    expect(ALL_LAYERS.stafford_zoning.styleFn).toBe(STAFFORD.style);
  });
  it("the legend a row publishes is headed by its city (#50)", () => {
    const lg = ALL_LAYERS.stafford_zoning.viewLegend([{ properties: { ZONE_CODE: "RCT", ZONE_DESCR: "RESIDENTIAL, COMMERCIAL, & TECHNOLOGY DISTRICT" } }]);
    expect(lg[0]).toEqual({ heading: true, label: "Stafford" });
    expect(lg[1].label).toBe("RCT · Residential, Commercial, & Technology District");
  });
  it("stays inside its weight tier, has a tier and a vintage line", () => {
    expect(hierarchyProblems(ALL_LAYERS)).toEqual([]);
    for (const id of IDS) { expect(LAYER_TIER[id], id).toBeTruthy(); expect(layerVintage(id, ALL_LAYERS[id]), id).toBeTruthy(); }
  });
  it("starts at 100% opacity (#42) and is off by default", () => {
    const st = defaultOverlayState();
    for (const id of IDS) { expect(st[id].on, id).toBe(false); expect(ALL_LAYERS[id].opacity ?? 1, id).toBe(1); }
  });
  it("no `fields` list omits the object-id field (it collapses every feature into one), and each asks for the field it prints", () => {
    for (const id of IDS) {
      const f = ALL_LAYERS[id].fields;
      expect(f.some((x) => /^(OBJECTID|FID)$/i.test(x)), id).toBe(true);
      expect(f, id).toContain(ALL_LAYERS[id].lineLabel.field);
    }
    expect(ALL_LAYERS.fulshear_zoning.fields).toContain("FID");           // the earlier layer's object-id field
    expect(ALL_LAYERS.fulshear_zoning_newer.fields).toContain("OBJECTID"); // the newer layer's
  });
  it("is in the verified GIS registry with fixtures and notes (the weekly drift job asks about it)", () => {
    expect(auditRegistry(GIS_SOURCES, SOURCE_FIXTURES, SOURCE_DOCS).problems).toEqual([]);
    for (const k of ["richmondZoning", "fulshearZoning", "fulshearZoningNewer", "staffordZoning"]) {
      expect(GIS_SOURCES[k].states).toEqual(["TX"]);
      expect(SOURCE_FIXTURES[k].fixtures.length, k).toBeGreaterThanOrEqual(2);
    }
  });
});

describe("availability gate — ON inside the city, OFF everywhere else (#3: nothing Texas-derived on another state's site)", () => {
  it("each row is available at its own city's point only", () => {
    for (const id of IDS) {
      const region = REGION_OF[id];
      expect(layerAvailableHere(ALL_LAYERS[id], scopeOf(INSIDE[region])), `${id} inside`).toBe(true);
      for (const [name, p] of Object.entries(ELSEWHERE)) expect(layerAvailableHere(ALL_LAYERS[id], scopeOf(p)), `${id} at ${name}`).toBe(false);
    }
  });
});

describe("requests actually issued — a city's URL fires inside that city and never elsewhere", () => {
  const fakeMap = () => {
    const panes = {};
    return { _loaded: true, getSize: () => ({ x: 800, y: 600 }), getZoom: () => 18, getPane: (n) => panes[n], createPane: (n) => { const el = { style: {} }; panes[n] = el; return el; }, whenReady(cb) { cb(); }, on() {}, off() {}, hasLayer: () => false };
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
    return { fetched: fetched.filter((u) => SERVICE_HOSTS.test(u)), built: featureLayerCalls.map((o) => o.url).filter((u) => SERVICE_HOSTS.test(u)) };
  }
  it("inside Richmond only Richmond's service is built; inside Fulshear both Fulshear services; inside Stafford only Stafford's", async () => {
    expect((await run(INSIDE.richmond)).built).toEqual([GIS_SOURCES.richmondZoning.serviceUrl]);
    expect((await run(INSIDE.fulshear)).built.sort()).toEqual([GIS_SOURCES.fulshearZoning.serviceUrl, GIS_SOURCES.fulshearZoningNewer.serviceUrl].sort());
    expect((await run(INSIDE.stafford)).built).toEqual([GIS_SOURCES.staffordZoning.serviceUrl]);
  });
  it.each(Object.entries(ELSEWHERE))("at %s: zero requests to any of the cities' services", async (_k, p) => {
    const r = await run(p);
    expect(r.fetched).toEqual([]);
    expect(r.built).toEqual([]);
  });
});
