/* Metro Nashville water-quality buffers + pending / preliminary flood maps (NEW-1 / NEW-2, 2026-11-12).
 *
 * THE RULES UNDER TEST:
 *   · every row appears only in Davidson County and a Memphis / Knoxville / Murfreesboro / Houston / Georgia site NEVER issues a request for them (declared scope, the pure gate at real points, and the
 *     network itself — `syncOverlayLayers` is driven with every row ON and the URLs it asks for are recorded, as Sugar Land's test does);
 *   · each row's URL IS a registry endpoint (the Metro service), the dense ribbons ride `fetchAll` + server simplification, the group is ONE panel row per merge group;
 *   · the cards print a distance ONLY where Metro's own attribute carries it (constraint #4) and are clean (constraint #45);
 *   · Pending / Preliminary are EMPTY on the live service (measured 2026-11-12): the rows say so with the date, and their fixtures probe the sibling Approved layer, never a count on an empty layer. */
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
import { _setServiceAreas, areaContains } from "../src/workspaces/site-planner/lib/serviceAreas.js";
import { ALL_LAYERS, syncOverlayLayers, MERGE_GROUPS, layerVintage } from "../src/workspaces/site-planner/lib/layers.js";
import { siteState } from "../src/workspaces/site-planner/lib/siteRegion.js";
import { layerAvailableHere, drawnOverlaysOf, PANEL_GROUPS, groupEntriesFor, availableEntries } from "../src/workspaces/site-planner/lib/layerPanelModel.js";
import { LAYER_TIER, hierarchyProblems } from "../src/workspaces/site-planner/lib/layerWeight.js";
import { FLOOD_TIERS } from "../src/workspaces/site-planner/lib/floodGroup.js";
import { GIS_SOURCES, auditRegistry, fixturePoints, haversineKm } from "../src/shared/gis/sources.js";
import { SOURCE_FIXTURES, SOURCE_DOCS } from "../src/shared/gis/sourceFixtures.js";
import { NASHVILLE_LAYERS, NASHVILLE_LAYER_IDS, NASHVILLE_MERGE_GROUPS } from "../src/workspaces/site-planner/lib/nashvilleLayers.js";
import * as cards from "../src/workspaces/site-planner/lib/nashvilleCards.js";

beforeAll(() => _setServiceAreas(SERVICE_AREAS));

const BUFFERS = ["nash_stream_buffer", "nash_pond_buffer", "nash_wetland_buffer", "nash_floodway_buffer"];
const FEMA_ROWS = ["nash_flood_pending", "nash_flood_preliminary"];
const IN = { downtown: { lat: 36.1627, lng: -86.7816 }, antioch: { lat: 36.03, lng: -86.63 }, whitesCreek: { lat: 36.29, lng: -86.81 }, bellevue: { lat: 36.07, lng: -86.96 },
  /* the county's north tip (Goodlettsville / Joelton): the 38-vertex bundled county outline LEFT IT OUT — 1.6% of Metro's buffer polygons sit there (measured 2026-11-12) — so a site there lost every layer */
  northTip: { lat: 36.391, lng: -86.747 }, joelton: { lat: 36.354, lng: -86.811 } };
const OUT = {
  murfreesboro: { lat: 35.8456, lng: -86.3903 }, christiana: { lat: 35.7425, lng: -86.3436 }, franklin: { lat: 35.9251, lng: -86.8689 }, memphis: { lat: 35.1495, lng: -90.049 },
  knoxville: { lat: 35.9606, lng: -83.9207 }, houston: { lat: 29.7604, lng: -95.3698 }, atlanta: { lat: 33.749, lng: -84.388 }, davidsonNC: { lat: 35.8, lng: -80.2 }, louisville: { lat: 38.2527, lng: -85.7585 },
};
const scopeOf = (p) => ({ state: siteState(p), loc: p });
const HOST = /HdTo6HJqh92wn4D8/;
const MERGE = (id) => ALL_LAYERS[id].mergeGroup;

describe("the Davidson County service area is a real boundary", () => {
  it("holds Nashville and its suburbs, not the neighbouring counties or Davidson County NC", () => {
    for (const [k, p] of Object.entries(IN)) expect(areaContains("davidson_tn", p), k).toBe(true);
    for (const [k, p] of Object.entries(OUT)) expect(areaContains("davidson_tn", p), k).toBe(false);
  });
});

describe("every Metro row is registered whole, scoped to Davidson County", () => {
  it("has the six rows, each Tennessee-only AND davidson_tn-only", () => {
    expect(NASHVILLE_LAYER_IDS).toEqual([...BUFFERS.slice(0, 4), ...FEMA_ROWS].sort((a, b) => NASHVILLE_LAYER_IDS.indexOf(a) - NASHVILLE_LAYER_IDS.indexOf(b)));
    expect(NASHVILLE_LAYER_IDS.length).toBe(6);
    for (const id of NASHVILLE_LAYER_IDS) {
      expect(ALL_LAYERS[id], id).toBe(NASHVILLE_LAYERS[id]);
      expect(ALL_LAYERS[id].states, id).toEqual(["TN"]);
      expect(ALL_LAYERS[id].regions, id).toEqual(["davidson_tn"]);
    }
  });
  it("carries the full row the panel and the stacking model read", () => {
    for (const id of NASHVILLE_LAYER_IDS) {
      const c = ALL_LAYERS[id];
      expect(c.label, id).toMatch(/^[A-Z]/);
      for (const f of ["source", "note", "infoCaveat", "vintage"]) expect(c[f], `${id}.${f}`).toBeTruthy();
      expect(c.role, id).toBe("area");
      expect(c.group, id).toBe("flood");
      expect(Number.isFinite(c.order), id).toBe(true);
      expect(Number.isFinite(c.minZoom), id).toBe(true);
      expect(c.agency, id).toBeTruthy();                                   // layers.js / floodGroup require floodTier + agency on a flood row
      expect(FLOOD_TIERS.map((t) => t.key), id).toContain(c.floodTier);
      expect(typeof c.styleFn, id).toBe("function");
      expect(typeof c.identifyCard, id).toBe("function");
      if (c.hoverIdentify) expect(c.canvasIdentify, `${id}: a hover row must also open the click card (constraint #43)`).toBe(true);
    }
  });
  it("sits in a weight tier, and the hierarchy audit stays clean", () => {
    for (const id of NASHVILLE_LAYER_IDS) expect(LAYER_TIER[id], id).toBeTruthy();
    for (const id of BUFFERS) expect(LAYER_TIER[id], id).toBe("constraint");
    expect(hierarchyProblems(ALL_LAYERS)).toEqual([]);
  });
  it("every url IS a registry endpoint — the Metro service, read directly (it is CORS-open, no relay)", () => {
    const endpoint = (s) => (Array.isArray(s.layerId) ? `${s.serviceUrl}/${s.layerId[0]}` : s.serviceUrl);
    const urls = new Set(Object.values(GIS_SOURCES).map(endpoint));
    for (const id of NASHVILLE_LAYER_IDS) {
      expect(urls.has(ALL_LAYERS[id].url), `${id}: ${ALL_LAYERS[id].url}`).toBe(true);
      expect(ALL_LAYERS[id].url, id).toMatch(/^https:\/\/services2\.arcgis\.com\/HdTo6HJqh92wn4D8\/arcgis\/rest\/services\//);
    }
    expect(ALL_LAYERS.nash_stream_buffer.url).toMatch(/Stormwater_Regulation_Buffers_view\/FeatureServer\/2$/);
    expect(ALL_LAYERS.nash_pond_buffer.url).toMatch(/\/FeatureServer\/1$/);
    expect(ALL_LAYERS.nash_wetland_buffer.url).toMatch(/\/FeatureServer\/3$/);
    expect(ALL_LAYERS.nash_floodway_buffer.url).toMatch(/\/FeatureServer\/0$/);
    expect(ALL_LAYERS.nash_flood_pending.url).toMatch(/FEMA_Floodplains_and_Floodways_view\/FeatureServer\/2$/);
    expect(ALL_LAYERS.nash_flood_preliminary.url).toMatch(/FeatureServer\/3$/);
  });
  it("NEVER reads the Approved layer (FEMA's NFHL row is the effective map) — no duplicate", () => {
    for (const id of NASHVILLE_LAYER_IDS) expect(ALL_LAYERS[id].url, id).not.toMatch(/FEMA_Floodplains_and_Floodways_view\/FeatureServer\/1$/);
  });
  it("the buffer ribbons are fetched whole and simplified: none draws before z13, stream + wetland follow the paging, every row asks the server for ~1 px", () => {
    for (const id of BUFFERS) { expect(ALL_LAYERS[id].minZoom, id).toBeGreaterThanOrEqual(13); expect(ALL_LAYERS[id].simplifyFactor, id).toBe(1); expect(ALL_LAYERS[id].fields, `${id}: no fields list`).toBeUndefined(); }
    // 2,000 is the service page size and a downtown z13 view holds ~3,800 stream polygons (measured 2026-11-12) — esri-leaflet would silently drop the rest
    for (const id of ["nash_stream_buffer", "nash_wetland_buffer"]) expect(ALL_LAYERS[id].fetchAll, id).toBe(true);
    for (const id of FEMA_ROWS) expect(ALL_LAYERS[id].simplifyFactor, id).toBe(1);
  });
  it("one panel row per merge group, each with a label and a note, and the registry's merge map carries them", () => {
    expect(new Set(BUFFERS.map(MERGE))).toEqual(new Set(["metro_wq_buffers"]));
    expect(new Set(FEMA_ROWS.map(MERGE))).toEqual(new Set(["metro_pending_flood"]));
    expect(NASHVILLE_MERGE_GROUPS.metro_wq_buffers.label).toBe("Metro water-quality buffers");
    expect(NASHVILLE_MERGE_GROUPS.metro_pending_flood.label).toBe("Metro floodplain — pending / preliminary maps");
    for (const k of Object.keys(NASHVILLE_MERGE_GROUPS)) { expect(MERGE_GROUPS[k], k).toBe(NASHVILLE_MERGE_GROUPS[k]); expect(NASHVILLE_MERGE_GROUPS[k].note, k).toBeTruthy(); }
  });
  it("the (i) cites §6.10 with the three tiers and says what is NOT printed per stream (constraint #4)", () => {
    const s = ALL_LAYERS.nash_stream_buffer.infoCaveat;
    expect(s).toMatch(/§6\.10/);
    expect(s).toMatch(/30 ft/); expect(s).toMatch(/50 ft/); expect(s).toMatch(/75 ft/);
    expect(s).toMatch(/floodway/i);
    expect(s).toMatch(/neither the width nor the zone split/);
    expect(ALL_LAYERS.nash_pond_buffer.infoCaveat).toMatch(/25 ft/);
    expect(ALL_LAYERS.nash_wetland_buffer.infoCaveat).toMatch(/25 ft/);
  });
  it("the existing 30 ft Tennessee stream-buffer row stays — Metro's polygons are the local rule on top of it", () => {
    expect(ALL_LAYERS.tn_stream_buffers).toBeTruthy();
    expect(ALL_LAYERS.nash_stream_buffer.infoCaveat).toMatch(/state's 30 ft construction buffer/);
  });
  it("the pending / preliminary rows say they are EMPTY today, with the date, and that empty is not 'none exist'", () => {
    for (const id of FEMA_ROWS) {
      expect(ALL_LAYERS[id].note, id).toMatch(/EMPTY as of 2026-11-12/);
      expect(ALL_LAYERS[id].infoCaveat, id).toMatch(/not that FEMA has none in progress/);
      expect(layerVintage(ALL_LAYERS[id]) || ALL_LAYERS[id].vintage, id).toMatch(/0 features/);
      expect(ALL_LAYERS[id].floodTier, id).toBe("advisory"); // never listed with the adopted regulatory layers
    }
    expect(NASHVILLE_MERGE_GROUPS.metro_pending_flood.note).toMatch(/As of 2026-11-12/);
  });
});

describe("the registry rows (GIS_SOURCES) the weekly health check covers", () => {
  const KEYS = ["metroFloodwayBuffer", "metroPondBuffer", "metroStreamBuffer", "metroWetlandBuffer", "metroFemaPending", "metroFemaPreliminary"];
  it("passes the whole registry audit (shape, tier, availability, fixture coverage, reach, state scope)", () => {
    expect(auditRegistry(GIS_SOURCES, SOURCE_FIXTURES, SOURCE_DOCS).problems).toEqual([]);
  });
  it("each is a TN-only production row with a source date, a probe date and a note", () => {
    for (const k of KEYS) {
      const s = GIS_SOURCES[k];
      expect(s, k).toBeTruthy();
      expect(s.states, k).toEqual(["TN"]);
      expect(s.tier, k).toBe("production");
      expect(s.dataLastEdited, k).toMatch(/^20\d\d-\d\d-\d\d$/);
      expect(s.lastVerified, k).toBe("2026-11-12");
      expect(SOURCE_DOCS[k] && SOURCE_DOCS[k].notes, k).toBeTruthy();
    }
  });
  it("every fixture sits in Davidson County and the two ends are at least 15 km apart", () => {
    for (const k of KEYS) {
      const pts = fixturePoints(SOURCE_FIXTURES[k]);
      for (const [lng, lat] of pts) expect(areaContains("davidson_tn", { lat, lng }), `${k} ${lng},${lat}`).toBe(true);
    }
    for (const k of ["metroFloodwayBuffer", "metroPondBuffer", "metroStreamBuffer", "metroWetlandBuffer"]) {
      const pts = fixturePoints(SOURCE_FIXTURES[k]);
      let max = 0; for (const a of pts) for (const b of pts) max = Math.max(max, haversineKm(a, b));
      expect(max, k).toBeGreaterThanOrEqual(15);
    }
  });
  it("the stream source carries the sweep's Antioch box (72 on 2026-11-12)", () => {
    const fx = SOURCE_FIXTURES.metroStreamBuffer.fixtures.find((f) => f.bbox && f.bbox.join() === "-86.64,36.03,-86.62,36.045");
    expect(fx).toBeTruthy();
    expect(fx.expectMinCount).toBeGreaterThanOrEqual(1);
  });
  it("PENDING / PRELIMINARY are EMPTY today, so their fixtures probe the sibling Approved layer — a count asserted on an empty layer would fail the weekly job forever", () => {
    for (const k of ["metroFemaPending", "metroFemaPreliminary"]) {
      const s = GIS_SOURCES[k];
      expect(Array.isArray(s.layerId), k).toBe(true);
      expect(s.layerId, k).toContain(1);                                    // the verifier resolves fixture.layer against layerId
      for (const fx of SOURCE_FIXTURES[k].fixtures) { expect(fx.layer, `${k} ${fx.label}`).toBe(1); expect(fx.expectMinCount).toBeGreaterThanOrEqual(1); }
      // the schema check asks every named field of EVERY listed layer: only fields all three FEMA layers share may be named
      for (const col of Object.values(s.fields)) expect(["FloodZone", "ZoneDescription", "StudyType"]).toContain(col);
    }
  });
});

describe("where each row is offered — the pure gate at real points", () => {
  const groups = PANEL_GROUPS.filter((g) => g.key !== "base").map((g) => g.key);
  const offeredAt = (p) => new Set(groups.flatMap((g) => availableEntries(groupEntriesFor(ALL_LAYERS, g), scopeOf(p)).map(([id]) => id)));
  for (const [name, p] of Object.entries(IN)) {
    it(`${name} (Davidson County) is offered every Metro row`, () => {
      const offered = offeredAt(p);
      for (const id of NASHVILLE_LAYER_IDS) expect(offered.has(id), id).toBe(true);
    });
  }
  for (const [name, p] of Object.entries(OUT)) {
    it(`${name} is offered NO Metro row`, () => {
      const offered = offeredAt(p);
      for (const id of NASHVILLE_LAYER_IDS) expect(offered.has(id), id).toBe(false);
    });
  }
  it("other Tennessee counties still get the state's own rows (the Metro rows are additive, not a replacement)", () => {
    const offered = offeredAt(OUT.murfreesboro);
    expect(offered.has("tn_stream_buffers")).toBe(true);
    expect(offered.has("tn_wqa")).toBe(true);
  });
  it("the map's draw filter turns every Metro row off outside Davidson County (so no request fires) and leaves them on inside it", () => {
    const on = Object.fromEntries(NASHVILLE_LAYER_IDS.map((id) => [id, { on: true, opacity: 1 }]));
    const out = drawnOverlaysOf(on, { scope: scopeOf(OUT.murfreesboro), layers: ALL_LAYERS });
    for (const id of NASHVILLE_LAYER_IDS) expect(out[id].on, id).toBe(false);
    const inside = drawnOverlaysOf(on, { scope: scopeOf(IN.downtown), layers: ALL_LAYERS });
    for (const id of NASHVILLE_LAYER_IDS) expect(inside[id].on, id).toBe(true);
    expect(layerAvailableHere(ALL_LAYERS.nash_stream_buffer, scopeOf(IN.antioch))).toBe(true);
  });
});

describe("requests actually issued — the Metro service is asked inside Davidson County and never elsewhere", () => {
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
      for (const id of NASHVILLE_LAYER_IDS) all[id] = { on: true, opacity: 1 };
      const drawn = drawnOverlaysOf(all, { scope: scopeOf(point), layers: ALL_LAYERS });
      syncOverlayLayers(fakeMap(), drawn, {}, { onStatus() {}, onError() {} });
      await new Promise((r) => setTimeout(r, 200));
    } finally { globalThis.fetch = realFetch; }
    return { fetched: fetched.filter((u) => HOST.test(u)), calls: featureLayerCalls.filter((o) => HOST.test(o.url)) };
  }
  it("at Nashville every row is built, with the server simplifying, the paged rows following the paging, and no fields list on the buffers", async () => {
    const r = await run(IN.downtown);
    expect(r.calls.length).toBe(NASHVILLE_LAYER_IDS.length);
    const byUrl = (re) => r.calls.find((o) => re.test(o.url));
    expect(byUrl(/Buffers_view\/FeatureServer\/2$/).fetchAllFeatures).toBe(true);
    expect(byUrl(/Buffers_view\/FeatureServer\/3$/).fetchAllFeatures).toBe(true);
    for (const o of r.calls) expect(o.simplifyFactor).toBe(1);
    for (const o of r.calls.filter((o) => /Buffers_view/.test(o.url))) expect(o.fields).toBeUndefined();
  });
  it.each(Object.entries(OUT))("at %s: zero requests to Metro's service", async (_k, p) => {
    const r = await run(p);
    expect(r.fetched).toEqual([]);
    expect(r.calls).toEqual([]);
  });
});

/* ---- the click cards ---- */
const RAW = /\b(BufferDistance|OBJECTID|GlobalID|Shape__|ZoneDescription|FloodZone|ZoneSubtype|StudyType|DFIRM_ID|VersionID|FloodAreaID)\b/;
const flat = (c) => JSON.stringify(c);
const noJunk = (card) => {
  expect(card.title).toBeTruthy();
  for (const r of card.rows) {
    expect(r.label, flat(r)).toMatch(/^[A-Z]/);
    expect(r.text, flat(r)).toBeTruthy();
    expect(r.text, flat(r)).not.toMatch(/^(null|undefined|none|nan|0)$/i);
  }
  expect(flat(card)).not.toMatch(RAW);
  expect(flat(card)).not.toMatch(/\bnull\b|\bundefined\b|\bNaN\b/);
};

describe("click cards are clean (constraint #45) and print a distance only where Metro's attribute carries it (constraint #4)", () => {
  it("floodway buffer — real BufferDistance values 50 and 75 (recorded 2026-11-12)", () => {
    for (const d of [50, 75]) {
      const c = cards.floodwayBufferCard({ OBJECTID: 7, BufferDistance: d, GlobalID: "x", Shape__Area: 1, Shape__Length: 2 });
      noJunk(c);
      expect(c.rows.find((r) => r.label === "Buffer beyond the floodway").text).toBe(`${d} ft`);
    }
  });
  it("floodway buffer with a missing / zero / junk distance prints NO number and no empty row", () => {
    for (const props of [{}, { BufferDistance: null }, { BufferDistance: 0 }, { BufferDistance: "n/a" }, null]) {
      const c = cards.floodwayBufferCard(props);
      noJunk(c);
      expect(c.rows.some((r) => /\d+ ft/.test(r.text)), flat(props)).toBe(false);
    }
  });
  it("pond buffer — 25 ft from normal pool from the layer's own value; without it, no number", () => {
    const c = cards.pondBufferCard({ BufferDistance: 25, OBJECTID: 3 });
    noJunk(c);
    expect(c.rows.find((r) => r.label === "Buffer").text).toBe("25 ft from the normal pool");
    expect(cards.pondBufferCard({}).rows.find((r) => r.label === "Buffer").text).not.toMatch(/\d/);
  });
  it("stream buffer — the card states the rule and the three possible widths, NEVER a single width for this stream (the polygon carries none)", () => {
    const c = cards.streamBufferCard({ OBJECTID: 1, GlobalID: "g", Shape__Area: 5 });
    noJunk(c);
    const width = c.rows.find((r) => r.label === "Width").text;
    expect(width).toMatch(/30, 50 or 75 ft/);
    expect(width).toMatch(/does not say which/);
    expect(c.rows.find((r) => r.label === "Rule").text).toMatch(/§6\.10/);
  });
  it("wetland buffer — the rule's 25 ft, cited", () => {
    const c = cards.wetlandBufferCard();
    noJunk(c);
    expect(c.rows.find((r) => r.label === "Buffer").text).toMatch(/^25 ft/);
  });
  it("pending / preliminary — fed the SCHEMA-SHAPED bag (the services hold no real record to recorded: shape taken from the Approved layer's real rows and the layers' own field list)", () => {
    const bag = { DFIRM_ID: "47037C", VersionID: "1.1.0.0", FloodAreaID: "47037C_1", StudyType: "SFHA with BFE and floodway", FloodZone: "AE", ZoneSubtype: " ", ZoneDescription: "100 Year Floodplain", Status: "Pending", Effective: "2026-12-01", OBJECTID: 9, GlobalID: "g", Shape__Area: 1 };
    const p = cards.pendingFloodCard(bag, "pending");
    noJunk(p);
    expect(p.title).toBe("Pending flood map — 100-year floodplain");
    expect(p.rows.find((r) => r.label === "Map status").text).toMatch(/not yet in effect/);
    expect(p.rows.find((r) => r.label === "Flood zone").text).toBe("Zone AE");
    expect(p.note).toMatch(/adopted \(effective\) map still governs/);
    const pre = cards.pendingFloodCard({ ...bag, ZoneDescription: "Floodway", Status: " ", Effective: null }, "preliminary");
    noJunk(pre);
    expect(pre.title).toBe("Preliminary flood map — floodway");
    expect(pre.rows.map((r) => r.label)).not.toContain("Takes effect");
    expect(pre.rows.map((r) => r.label)).not.toContain("Status noted by Metro");
    expect(pre.rows.find((r) => r.label === "Map status").text).toMatch(/not yet adopted/);
  });
  it("a bare pending feature still gets a card with no empty row", () => {
    const c = cards.pendingFloodCard({}, "pending");
    noJunk(c);
    expect(c.title).toBe("Pending flood map");
  });
  it("the layer rows hand the right state to the card", () => {
    expect(ALL_LAYERS.nash_flood_pending.identifyCard({ ZoneDescription: "500 Year Floodplain" }).title).toMatch(/^Pending flood map/);
    expect(ALL_LAYERS.nash_flood_preliminary.identifyCard({ ZoneDescription: "500 Year Floodplain" }).title).toMatch(/^Preliminary flood map/);
    expect(ALL_LAYERS.nash_floodway_buffer.identifyCard({ BufferDistance: 75 }).rows[0].text).toBe("75 ft");
  });
  it("feetText refuses anything that is not a positive number", () => {
    expect(cards.feetText(75)).toBe("75 ft");
    expect(cards.feetText("50")).toBe("50 ft");
    for (const v of [0, -5, null, undefined, "", "abc", NaN]) expect(cards.feetText(v), String(v)).toBe("");
  });
});
