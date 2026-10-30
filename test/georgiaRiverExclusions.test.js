/* NEW-1 (B2535200 review, finding 1) — a Georgia protected river's 100-ft rule does NOT cover a segment under the Metropolitan River Protection Act or the Coastal Marshlands Protection Act
 * (Rule 391-3-16-.04 / O.C.G.A. 12-2-8). DCA's ProtectedRiver layer (live 2026-10-30) draws the Chattahoochee MRPA reach and the tidal Altamaha / Ogeechee / Savannah / Satilla / St Marys to the sea,
 * so the 100-ft band was drawn across both. Red on the unfixed `streamBufferBands` (every river part got the band) and on the old card (the 100-ft sentence printed everywhere). */
import { describe, it, expect, vi } from "vitest";

vi.mock("esri-leaflet", () => ({ dynamicMapLayer: vi.fn(), imageMapLayer: vi.fn(), featureLayer: vi.fn(), tiledMapLayer: vi.fn() }));
vi.mock("../src/workspaces/site-planner/lib/evidenceLayers.js", () => ({ overpassLayer: vi.fn(), mapillaryLayer: vi.fn() }));
vi.mock("../src/workspaces/site-planner/lib/terrainLayers.js", () => ({ contourLayer: vi.fn(), flowLayer: vi.fn(), TERRAIN_MIN_ZOOM: 13 }));
vi.mock("../src/workspaces/site-planner/lib/vectorOverlay.js", () => ({
  cachedVectorLayer: vi.fn(), cachedPipelineLayer: vi.fn(), cachedCorridorLayer: vi.fn(), isPointFeature: vi.fn(),
}));
vi.mock("../src/workspaces/site-planner/lib/mapSymbols.js", () => ({ installDefaultMarkerIcon: vi.fn(), pointToLayerFor: vi.fn() }));

import { streamBufferBands, keepRuns } from "../src/workspaces/site-planner/lib/georgiaStreamBuffers.js";
import { inTidalReach, riverExclusionAt, inMrpaReachBox, MRPA_REACH_BOX } from "../src/workspaces/site-planner/lib/georgiaRiverExclusions.js";
import { GA_TIDAL_CELLS, GA_TIDAL_CELL_DEG } from "../src/workspaces/site-planner/lib/gaTidalReaches.js";
import { ALL_LAYERS } from "../src/workspaces/site-planner/lib/layers.js";

const line = (name, coords) => ({ type: "Feature", properties: { FENAME: name }, geometry: { type: "LineString", coordinates: coords } });
const fc = (...features) => ({ type: "FeatureCollection", features });
const poly = (ring) => ({ type: "Feature", properties: {}, geometry: { type: "Polygon", coordinates: [ring] } });
const riverBands = (bands) => bands.filter((b) => b.tier.id === "river");

/* Real protected-river vertices, sampled 2026-10-30 from DCA's ProtectedRiver layer, each classified by the National Wetlands Inventory under it (R1… Riverine-Tidal / E… Estuarine). */
const TIDAL = [["Savannah", -81.1188, 32.1202], ["Altamaha", -81.4454, 31.3279], ["Ogeechee", -81.2885, 31.9539], ["Satilla", -81.8538, 30.8878], ["St Marys", -81.6535, 30.7351]];
const FRESH = [["Savannah (Augusta side)", -81.5036, 32.9376], ["Ogeechee (above the tide)", -81.5355, 32.4792], ["Altamaha (above the tide)", -82.4776, 31.972], ["Satilla (above the tide)", -81.8819, 31.3], ["St Marys (above the tide)", -82.0109, 30.79]];

describe("the tidal reaches (Coastal Marshlands Protection Act ground)", () => {
  it("the baked data is a real, non-trivial cell list", () => {
    expect(GA_TIDAL_CELL_DEG).toBe(0.01);
    expect(GA_TIDAL_CELLS.split(",").length).toBeGreaterThan(400); // 330 cells measured → 660 numbers
  });
  it.each(TIDAL)("%s: a tidal stretch is inside the reach", (_n, lng, lat) => expect(inTidalReach(lng, lat)).toBe(true));
  it.each(FRESH)("%s: a freshwater stretch is not", (_n, lng, lat) => expect(inTidalReach(lng, lat)).toBe(false));
  it("the Chattahoochee, Flint and the north Georgia rivers are nowhere near it", () => {
    for (const [lng, lat] of [[-84.3348, 33.9982], [-84.8021, 33.5733], [-84.1, 32.2], [-83.0, 33.9]]) expect(inTidalReach(lng, lat)).toBe(false);
  });
});

describe("the bands: the river tier is cut out of the two excluded segments", () => {
  const MRPA_RING = [[-84.9, 33.5], [-84.2, 33.5], [-84.2, 34.1], [-84.9, 34.1], [-84.9, 33.5]];
  it("a Chattahoochee line inside the MRPA corridor gets NO 100-ft band; the same river upstream of it still does", () => {
    const upstream = [[-83.9, 34.3], [-83.95, 34.28], [-84.0, 34.25]];
    const inside = [[-84.3, 33.99], [-84.33, 33.97], [-84.36, 33.95]];
    const bands = streamBufferBands({ rivers: fc(line("Chattahoochee River", [...upstream, ...inside])), mrpa: fc(poly(MRPA_RING)) });
    const mid = riverBands(bands).map((b) => b.ring.reduce((a, p) => a + p[1], 0) / b.ring.length);
    expect(mid.length).toBeGreaterThan(0);
    for (const lat of mid) expect(lat, "only the upstream part (north of the corridor) carries the band").toBeGreaterThan(34.1);
  });
  it("DCA's centreline a hair outside ARC's corridor edge is still the MRPA reach (live: 81 vertices sat 2-120 m outside), but a river 400 m beyond it is not", () => {
    const edgeLng = -84.2; // the ring's east side
    const near = line("Chattahoochee River", [[edgeLng + 0.0008, 34.0], [edgeLng + 0.0008, 34.01]]);   // ~75 m outside
    const far = line("Chattahoochee River", [[edgeLng + 0.004, 34.0], [edgeLng + 0.004, 34.01]]);      // ~370 m outside
    expect(riverBands(streamBufferBands({ rivers: fc(near), mrpa: fc(poly(MRPA_RING)) })).length).toBe(0);
    expect(riverBands(streamBufferBands({ rivers: fc(far), mrpa: fc(poly(MRPA_RING)) })).length).toBe(1);
  });
  it("a non-MRPA protected river is untouched by the corridor", () => {
    const coosa = line("Coosa River", [[-85.2, 34.3], [-85.15, 34.27], [-85.1, 34.24]]);
    expect(riverBands(streamBufferBands({ rivers: fc(coosa), mrpa: fc(poly(MRPA_RING)) })).length).toBe(1);
    expect(riverBands(streamBufferBands({ rivers: fc(coosa) })).length).toBe(1);
  });
  it("a tidal run is cut and the fresh run above it kept (Savannah River)", () => {
    const run = line("Savannah River", [[-81.5036, 32.9376], [-81.5, 32.9], [-81.1188, 32.1202], [-81.1, 32.1]]);
    const bands = riverBands(streamBufferBands({ rivers: fc(run) }));
    expect(bands.length).toBe(1); // the freshwater part only
    const lats = bands[0].ring.map((p) => p[1]);
    expect(Math.min(...lats)).toBeGreaterThan(32.8);
  });
  it("a tidal-only river carries no river band at all, and its 25-ft NHD state band is not touched", () => {
    const tidal = line("Altamaha River", [[-81.4454, 31.3279], [-81.4454, 31.3281]]);
    expect(riverBands(streamBufferBands({ rivers: fc(tidal) })).length).toBe(0);
  });
  it("without the corridor polygon (it failed to load) the Chattahoochee band is drawn — and the caller is told, by a null mrpa", () => {
    const r = line("Chattahoochee River", [[-84.3, 33.99], [-84.33, 33.97], [-84.36, 33.95]]);
    expect(riverBands(streamBufferBands({ rivers: fc(r), mrpa: null })).length).toBe(1);
  });
  it("keepRuns splits at dropped vertices and drops one-vertex scraps", () => {
    expect(keepRuns([1, 2, 3, 4, 5, 6], (v) => v === 3 || v === 6)).toEqual([[1, 2], [4, 5]]);
    expect(keepRuns([1, 2, 3], (v) => v === 2)).toEqual([]);
  });
});

describe("the Protected Rivers click card", () => {
  const card = (name, at) => ALL_LAYERS.ga_protected_rivers.identifyCard({ FENAME: name }, at);
  const text = (c) => c.rows.flat().map((r) => r.text).join(" ");
  it("MRPA reach: the Act's corridor governs — no 100-ft protected-river rule is printed", () => {
    expect(inMrpaReachBox(-84.3348, 33.9982)).toBe(true);
    expect(MRPA_REACH_BOX.latMax).toBeGreaterThan(34.1);
    const t = text(card("Chattahoochee River", { lat: 33.9982, lng: -84.3348 }));
    expect(t).toMatch(/Metropolitan River Protection Act/);
    expect(t).not.toMatch(/100-ft river corridor/);
  });
  it("a non-MRPA protected river keeps the 100-ft rule, and says the band is drawn from the centreline", () => {
    const t = text(card("Etowah River", { lat: 34.15, lng: -84.8 }));
    expect(t).toMatch(/100-ft river corridor/);
    expect(t).toMatch(/centreline/);
  });
  it("NEW-1: the card cites the RULE (not an ordinance), says the corridor is measured from the top of the bank, and says in one plain line that the drawn band understates it", () => {
    const c = card("Etowah River", { lat: 34.15, lng: -84.8 });
    const t = text(c);
    expect(t).toMatch(/Rule 391-3-16-\.04/);
    expect(t).toMatch(/measured horizontally from the uppermost part of the river bank/);
    expect(t).toMatch(/400 cfs/);
    expect(t).toMatch(/The true corridor starts at the top of the river bank, so the band drawn here \(from DCA's centreline\) understates it\./);
    expect(t).toMatch(/excluded/);
    expect(JSON.stringify(c)).not.toMatch(/ordinance/i);
    for (const [nm, at] of [["Chattahoochee River", { lat: 33.9982, lng: -84.3348 }], ["Ogeechee River", { lat: 31.9539, lng: -81.2885 }]]) { const x = card(nm, at); expect(x.rows.length).toBeGreaterThan(0); expect(JSON.stringify(x)).not.toMatch(/ordinance/i); }
  });
  it("NEW-1: the Protected Rivers legend line says the true corridor starts at the top of the bank and the drawn band understates it", () => {
    const lg = ALL_LAYERS.ga_protected_rivers.legend;
    expect(lg).toHaveLength(1);
    expect(lg[0].label).toMatch(/starts at the top of the bank/);
    expect(lg[0].label).toMatch(/understates/);
  });
  it("the Chattahoochee ABOVE Buford Dam / below the Douglas line is an ordinary protected river", () => {
    expect(riverExclusionAt("Chattahoochee River", { lat: 34.52, lng: -83.7 })).toBe(null);
    expect(riverExclusionAt("Chattahoochee River", { lat: 32.0, lng: -85.0 })).toBe(null);
  });
  it("a tidal reach: the Coastal Marshlands Protection Act governs", () => {
    expect(riverExclusionAt("Ogeechee River", { lat: 31.9539, lng: -81.2885 })).toBe("tidal");
    const t = text(card("Ogeechee River", { lat: 31.9539, lng: -81.2885 }));
    expect(t).toMatch(/Coastal Marshlands Protection Act/);
    expect(t).not.toMatch(/100-ft river corridor/);
  });
  it("the layer's note names both exclusions", () => {
    expect(ALL_LAYERS.ga_protected_rivers.note).toMatch(/Metropolitan River Protection Act/);
    expect(ALL_LAYERS.ga_protected_rivers.note).toMatch(/Coastal Marshlands Protection Act/);
    expect(ALL_LAYERS.ga_stream_buffers.note).toMatch(/understates/);
  });
});
