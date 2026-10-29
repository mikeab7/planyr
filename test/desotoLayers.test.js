/* DeSoto County MS + Olive Branch layer rows (B2507056–B2507059).
 *
 * The OWNER RULE under test (2026-10-29): every one of these layers "only appears where its source actually serves" — DeSoto County MS only,
 * Olive Branch rows only within or near Olive Branch — and a Texas / Georgia / Tennessee site must NEVER issue a request for them. That is
 * proved here at three levels: the declared scope on every row, the pure availability gate at real points, and — the one that matters — the
 * network itself: `syncOverlayLayers` is driven with every DeSoto row switched ON and the URLs it actually asks for are recorded, at Olive Branch
 * (requests expected) and at Harris County / Atlanta / Nashville / Memphis (zero DeSoto or Olive Branch requests). */
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
import { ALL_LAYERS, defaultOverlayState, syncOverlayLayers, layerVintage, identifyOverlaysAt } from "../src/workspaces/site-planner/lib/layers.js";
import { siteState } from "../src/workspaces/site-planner/lib/siteRegion.js";
import { layerAvailableHere, drawnOverlaysOf } from "../src/workspaces/site-planner/lib/layerPanelModel.js";
import { lineLabelText } from "../src/workspaces/site-planner/lib/layerRequest.js";
import { esriLineLabels } from "../src/workspaces/site-planner/lib/overlayVectorSvg.js";
import { LAYER_TIER, hierarchyProblems } from "../src/workspaces/site-planner/lib/layerWeight.js";
import {
  DESOTO_LAYERS, OB_AGOL, pipeSizeLabel, isFieldVerified, verifiedStyle, VERIFIED_DASH,
} from "../src/workspaces/site-planner/lib/desotoLayers.js";

beforeAll(() => _setServiceAreas(SERVICE_AREAS));

const IDS = Object.keys(DESOTO_LAYERS);
const OLIVE_BRANCH = { lat: 34.9618, lng: -89.8295 };
const HERNANDO = { lat: 34.8237, lng: -89.9937 };           // DeSoto County, outside the Olive Branch utility area
const ELSEWHERE = {
  harris: { lat: 29.7604, lng: -95.3698 }, dallas: { lat: 32.7767, lng: -96.797 }, atlanta: { lat: 33.749, lng: -84.388 },
  nashville: { lat: 36.1627, lng: -86.7816 }, memphis: { lat: 35.1495, lng: -90.049 }, jackson: { lat: 32.2988, lng: -90.1848 }, houstonSuburb: { lat: 29.9, lng: -95.5 },
};
const scopeOf = (p) => ({ state: siteState(p), loc: p });

describe("pipeSizeLabel — the city's hand-typed sizes become short labels", () => {
  it.each([
    ['8"', '8"'], ["8''", '8"'], ["8", '8"'], ['12"', '12"'], ['2" Abandoned', '2" abandoned'], ['8" ab', '8" abandoned'],
    ['6 HP"', '6" HP'], ['6" HP', '6" HP'], ['FUTURE 6', '6" future'], ['FDC 4"', '4"'], ['10" abandoned', '10" abandoned'],
  ])("%s → %s", (raw, out) => expect(pipeSizeLabel(raw)).toBe(out));
  it.each([["None"], ["none"], [""], [null], [undefined], ["Upper Camp Creek"], [" "]])("%j → nothing printed", (raw) => expect(pipeSizeLabel(raw)).toBeNull());
  it("a bare word 'Abandoned' still says so", () => expect(pipeSizeLabel("Abandoned")).toBe("abandoned"));
  it("a decimal size keeps its decimal", () => expect(pipeSizeLabel('2.5"')).toBe('2.5"'));
});

describe("solid = field verified, dashed = not (the city's own convention)", () => {
  it.each([["FIELD VERIFIED", true], ["Field Verified", true], [" field verified ", true], ["NOT FIELD VERIFIED", false], ["Not Field Verified", false], [null, false], ["None", false], ["", false], ["Abandoned", false]])(
    "%j → verified=%s", (v, ok) => expect(isFieldVerified({ CONVERSION_STATUS: v })).toBe(ok));
  it("a missing property bag is not verified", () => expect(isFieldVerified(undefined)).toBe(false));
  it("verified draws solid; everything else draws dashed", () => {
    const f = verifiedStyle("#0070ff", 2);
    expect(f({ CONVERSION_STATUS: "FIELD VERIFIED" }, 0.5)).toMatchObject({ dashArray: null, color: "#0070ff", weight: 2, opacity: 0.5, fill: false });
    expect(f({ CONVERSION_STATUS: "NOT FIELD VERIFIED" }, 0.5).dashArray).toBe(VERIFIED_DASH);
    expect(f({}, 0.5).dashArray).toBe(VERIFIED_DASH);
  });
  it("the three city line layers with a status are drawn through verifiedStyle", () => {
    for (const id of ["ms_ob_water_main", "ms_ob_sewer_gravity", "ms_ob_sewer_force", "ms_ob_gas_main"]) {
      expect(typeof DESOTO_LAYERS[id].styleFn, id).toBe("function");
      expect(DESOTO_LAYERS[id].styleFn({ CONVERSION_STATUS: "NOT FIELD VERIFIED" }, 1).dashArray, id).toBe(VERIFIED_DASH);
      expect(DESOTO_LAYERS[id].styleFn({ CONVERSION_STATUS: "FIELD VERIFIED" }, 1).dashArray, id).toBeNull();
    }
  });
});

describe("line labels — screen text and printed twin agree", () => {
  const cfg = { lineLabel: { field: "SIZE" } };
  it("reads the row's field through the pipe-size cleaner", () => {
    expect(lineLabelText(cfg, { SIZE: "8''" })).toBe('8"');
    expect(lineLabelText(cfg, { SIZE: "None" })).toBeNull();
    expect(lineLabelText({}, { SIZE: "8" })).toBeNull();
    expect(lineLabelText(cfg, null)).toBeNull();
  });
  it("a row may bring its own formatter", () => {
    expect(lineLabelText({ lineLabel: { field: "X", format: (v) => `#${v}` } }, { X: 7 })).toBe("#7");
  });
  it("the printed label sits at the middle of the line's length, once per feature", () => {
    const gj = { properties: { SIZE: "12\"" }, geometry: { type: "LineString", coordinates: [[0, 0], [10, 0], [10, 10]] } };
    expect(esriLineLabels(gj, cfg)).toEqual([{ lng: 10, lat: 0, text: '12"' }]);
    const gj2 = { properties: { SIZE: "6" }, geometry: { type: "LineString", coordinates: [[0, 0], [4, 0]] } };
    expect(esriLineLabels(gj2, cfg)).toEqual([{ lng: 2, lat: 0, text: '6"' }]);
  });
  it("the longest part of a multi-line carries the label; nothing to say → nothing printed", () => {
    const gj = { properties: { SIZE: "8" }, geometry: { type: "MultiLineString", coordinates: [[[0, 0], [1, 0]], [[0, 5], [8, 5]]] } };
    expect(esriLineLabels(gj, cfg)).toEqual([{ lng: 4, lat: 5, text: '8"' }]);
    expect(esriLineLabels({ properties: { SIZE: "None" }, geometry: gj.geometry }, cfg)).toEqual([]);
    expect(esriLineLabels({ properties: { SIZE: "8" }, geometry: { type: "Point", coordinates: [1, 1] } }, cfg)).toEqual([]);
  });
});

describe("every DeSoto / Olive Branch row is registered whole and scoped to Mississippi", () => {
  it("is in the registry, and its public sources are the right hosts", () => {
    for (const id of IDS) {
      const c = ALL_LAYERS[id];
      expect(c, id).toBeTruthy();
      expect(c.url.startsWith(OB_AGOL) || c.url.startsWith("/gis-proxy/gis.desotocountyms.gov/"), `${id}: ${c.url}`).toBe(true);
    }
  });
  it("declares Mississippi AND a region on every row — no row is offered state-wide or nationally", () => {
    for (const id of IDS) {
      const c = ALL_LAYERS[id];
      expect(c.states, id).toEqual(["MS"]);
      expect(c.regions && c.regions.length, id).toBeGreaterThan(0);
      for (const r of c.regions) expect(SERVICE_AREAS[r], `${id}: region ${r} has no geometry`).toBeTruthy();
    }
  });
  it("is never the licensed imagery or a no-value layer the brief ruled out", () => {
    for (const id of IDS) expect(JSON.stringify(ALL_LAYERS[id]), id).not.toMatch(/nearmap|PROPOSED_ZONING|cemeter|cannabis|ward|polling|garbage|rubbish/i);
  });
  it("carries the full row (role, group, order, source, note, minZoom) the panel and the stacking model read", () => {
    for (const id of IDS) {
      const c = ALL_LAYERS[id];
      expect(["line", "point", "area"], id).toContain(c.role);
      expect(c.group, id).toBeTruthy();
      expect(c.label, id).toMatch(/^[A-Z]/);          // layer names are capitalised (owner rule)
      expect(c.source, id).toBeTruthy();
      expect(c.note, id).toBeTruthy();
      expect(Number.isFinite(c.minZoom), id).toBe(true);
    }
  });
  it("stays inside its weight tier (utilities are reference, the planning line is context)", () => {
    expect(hierarchyProblems(ALL_LAYERS)).toEqual([]);
    for (const id of IDS) expect(LAYER_TIER[id], id).toBeTruthy();
  });
  it("has a vintage line for the (i) popover", () => {
    for (const id of IDS) expect(layerVintage(id, ALL_LAYERS[id]), id).toBeTruthy();
  });
  it("the dense service-line rows are not merged into the Water & Sewer row and sit at close zoom only", () => {
    for (const id of ["ms_ob_water_service", "ms_ob_sewer_service"]) { expect(ALL_LAYERS[id].mergeGroup, id).toBeUndefined(); expect(ALL_LAYERS[id].minZoom, id).toBeGreaterThanOrEqual(17); }
  });
  it("is off by default", () => {
    const st = defaultOverlayState();
    for (const id of IDS) expect(st[id].on, id).toBe(false);
  });
});

describe("where each row is offered — the pure gate at real points", () => {
  it("every Olive Branch row is offered at Olive Branch; the DCRUA rows are offered across DeSoto County", () => {
    for (const id of IDS) expect(layerAvailableHere(ALL_LAYERS[id], scopeOf(OLIVE_BRANCH)), id).toBe(true);
  });
  it("Hernando (DeSoto County, outside the Olive Branch utility area): DCRUA yes, Olive Branch's own mains no", () => {
    const sc = scopeOf(HERNANDO);
    expect(sc.state).toBe("MS");
    for (const id of IDS) {
      const countywide = (ALL_LAYERS[id].regions || []).includes("desoto");
      expect(layerAvailableHere(ALL_LAYERS[id], sc), id).toBe(countywide);
    }
  });
  it.each(Object.entries(ELSEWHERE))("%s: not one DeSoto / Olive Branch row is offered", (_k, p) => {
    for (const id of IDS) expect(layerAvailableHere(ALL_LAYERS[id], scopeOf(p)), id).toBe(false);
  });
  it("the map's draw filter turns every one of them off outside DeSoto (so no request fires), and leaves them on inside it", () => {
    const on = Object.fromEntries(IDS.map((id) => [id, { on: true, opacity: 0.5 }]));
    const out = drawnOverlaysOf(on, { scope: scopeOf(ELSEWHERE.harris), layers: ALL_LAYERS });
    for (const id of IDS) expect(out[id].on, id).toBe(false);
    const inside = drawnOverlaysOf(on, { scope: scopeOf(OLIVE_BRANCH), layers: ALL_LAYERS });
    for (const id of IDS) expect(inside[id].on, id).toBe(true);
  });
});

/* THE NETWORK ITSELF. A fake Leaflet map + a recording `fetch` (the layer health probe) + the mocked esri featureLayer constructor: every URL the
 * sync pass would ask for is captured. */
describe("requests actually issued — DeSoto / Olive Branch URLs fire at Olive Branch and never elsewhere", () => {
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
      const all = Object.fromEntries(Object.keys(ALL_LAYERS).map((id) => [id, { on: false, opacity: 0.5 }]));
      for (const id of IDS) all[id] = { on: true, opacity: 0.5 };
      const drawn = drawnOverlaysOf(all, { scope: scopeOf(point), layers: ALL_LAYERS });
      syncOverlayLayers(fakeMap(), drawn, {}, { onStatus() {}, onError() {} });
      await new Promise((r) => setTimeout(r, 250)); // the hover/identify chunk (and the zoning row's warm-up of the municipal limits) attach on a dynamic import — let them land INSIDE this run's window
    } finally { globalThis.fetch = realFetch; }
    const mine = (u) => /VGtdH6iTQlVulSnr|desotocountyms/.test(u);
    return { fetched: fetched.filter(mine), built: featureLayerCalls.filter(mine) };
  }
  it("at Olive Branch every row is probed and built", async () => {
    const r = await run(OLIVE_BRANCH);
    expect(r.fetched.length).toBeGreaterThan(0);
    expect(r.built.length).toBe(IDS.length);
    expect(r.fetched.some((u) => /desotocountyms/.test(u)), "the county server is asked (health probes, the zoning row's municipal-limits warm-up)").toBe(true);
  });
  it.each(Object.entries(ELSEWHERE))("at %s: zero requests to the Olive Branch org or the DeSoto County server", async (_k, p) => {
    const r = await run(p);
    expect(r.fetched).toEqual([]);
    expect(r.built).toEqual([]);
  });
});

describe("identifyOverlaysAt — several layers answering with the same card collapse to one", () => {
  it("the four PSC layers ON → ONE 'Who serves this site' item, not four", () => {
    const PSC = ["ms_psc_electric", "ms_psc_gas", "ms_psc_water", "ms_psc_sewer"];
    const card = { title: "Who serves this site", rows: [], note: null, sourceName: "x", dedupeKey: "ms-psc-providers" };
    const refs = Object.fromEntries(PSC.map((id) => [id, { identifyAt: () => ({ ...card }) }]));
    const overlays = Object.fromEntries(PSC.map((id) => [id, { on: true, opacity: 0.4 }]));
    const items = identifyOverlaysAt(refs, overlays, { lat: 34.96, lng: -89.83 });
    expect(items).toHaveLength(1);
    expect(items[0].title).toBe("Who serves this site");
  });
  it("hits without a dedupeKey are never collapsed", () => {
    const refs = { ms_ob_water_main: { identifyAt: () => ({ title: "a", rows: [] }) }, ms_ob_gas_main: { identifyAt: () => ({ title: "b", rows: [] }) } };
    const overlays = { ms_ob_water_main: { on: true }, ms_ob_gas_main: { on: true } };
    expect(identifyOverlaysAt(refs, overlays, { lat: 34.96, lng: -89.83 })).toHaveLength(2);
  });
});
