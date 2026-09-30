/* NEW-1 (Georgia) — county lines + city limits + jurisdiction, and the "no Texas number on a Georgia site" guard.
 *
 * RED-PROOF: every assertion below fails on the pre-change main (there was no `countyGa` / `cityGa` row, no
 * Georgia envelope, Georgia points resolved NO county, and a Georgia site fell through to Texas detention /
 * HCFCD logic). The Texas and Colorado arms assert those two states resolve EXACTLY as before. */
import { describe, it, expect, vi } from "vitest";

// layers.js pulls in Leaflet-facing modules that need a DOM — same stubs as test/coverage.test.js.
vi.mock("esri-leaflet", () => ({ dynamicMapLayer: vi.fn(), imageMapLayer: vi.fn(), featureLayer: vi.fn(), tiledMapLayer: vi.fn() }));
vi.mock("../src/workspaces/site-planner/lib/evidenceLayers.js", () => ({ overpassLayer: vi.fn(), mapillaryLayer: vi.fn() }));
vi.mock("../src/workspaces/site-planner/lib/terrainLayers.js", () => ({ contourLayer: vi.fn(), flowLayer: vi.fn(), TERRAIN_MIN_ZOOM: 13 }));
vi.mock("../src/workspaces/site-planner/lib/vectorOverlay.js", () => ({ cachedVectorLayer: vi.fn(), cachedPipelineLayer: vi.fn(), cachedCorridorLayer: vi.fn(), isPointFeature: vi.fn() }));
vi.mock("../src/workspaces/site-planner/lib/mapSymbols.js", () => ({ installDefaultMarkerIcon: vi.fn(), pointToLayerFor: vi.fn() }));

import {
  JURISDICTION_SOURCES, countySourcesForPoint, citySourcesForPoint, etjSourcesForPoint, etjCoverageFor,
  identifyJurisdiction, formatJurisdictionBadge, countyAtPoint,
} from "../src/workspaces/site-planner/lib/jurisdiction.js";
import { createGisCache } from "../src/workspaces/site-planner/lib/gisCache.js";
import { siteState, STATE_ENVELOPES } from "../src/workspaces/site-planner/lib/siteRegion.js";
import { GA_ENVELOPE_BOX, GA_ENVELOPE, georgiaConsolidatedFor, GA_CONSOLIDATED } from "../src/workspaces/site-planner/lib/georgiaJurisdiction.js";
import { computeRequiredDetention, authorityForJurisdiction } from "../src/workspaces/site-planner/lib/detentionRules.js";
import { GIS_SOURCES, statesFor, sourceCoversState, auditRegistry } from "../src/shared/gis/sources.js";
import { SOURCE_FIXTURES, SOURCE_DOCS } from "../src/shared/gis/sourceFixtures.js";
import { declaredLimitClassing } from "../src/workspaces/site-planner/lib/cityLimitClass.js";
import { ALL_LAYERS as LAYERS_BY_ID } from "../src/workspaces/site-planner/lib/layers.js";

function makeStore() {
  const map = new Map();
  return { getItem: (k) => (map.has(k) ? map.get(k) : null), setItem: (k, v) => { map.set(k, v); }, removeItem: (k) => map.delete(k),
    get length() { return map.size; }, key: (i) => Array.from(map.keys())[i] ?? null };
}
const freshCache = () => createGisCache({ store: makeStore(), now: () => 1_000_000 });
function fakeFetch(routes) {
  const fn = async (url) => {
    for (const [needle, respond] of Object.entries(routes)) if (url.includes(needle)) { fn.log.push(needle); return { features: respond(url) }; }
    throw new Error("no route for " + url);
  };
  fn.log = [];
  return fn;
}
const COUNTY_GA = "Counties_2018", CITY_GA = "Municipal_Boundaries";
const ga = (county, city) => ({
  [COUNTY_GA]: () => (county ? [{ attributes: { NAME: county, GEOID: "13000" } }] : []),
  [CITY_GA]: () => (city ? [{ attributes: { cityname: city, GEOID: "1300000" } }] : []),
});
const ATL = [-84.388, 33.749], GWINNETT = [-83.95, 34.02], ATHENS = [-83.3776, 33.9519], NORTH_AUGUSTA_SC = [-81.96, 33.5];
const run = (pt, routes) => identifyJurisdiction(pt[0], pt[1], { cache: freshCache(), fetchJson: fakeFetch(routes), roles: ["county", "city", "etj"] });

describe("routing — the envelope routes, and never overlaps TX / CO", () => {
  it("a Georgia point routes to the DCA county + city rows", () => {
    expect(countySourcesForPoint(ATL[1], ATL[0])).toEqual([JURISDICTION_SOURCES.countyGa]);
    expect(citySourcesForPoint(ATL[1], ATL[0])).toEqual([JURISDICTION_SOURCES.cityGa]);
  });
  it("Texas (Katy) and Colorado (Denver) resolve to the SAME sources as before", () => {
    expect(countySourcesForPoint(29.78, -95.79)).toEqual([JURISDICTION_SOURCES.county]);
    expect(countySourcesForPoint(39.74, -104.99)).toEqual([JURISDICTION_SOURCES.countyCo]);
    expect(citySourcesForPoint(29.78, -95.79)).not.toContain(JURISDICTION_SOURCES.cityGa);
    expect(siteState({ lat: 29.78, lng: -95.79 })).toBe("TX");
    expect(siteState({ lat: 39.74, lng: -104.99 })).toBe("CO");
  });
  it("the GA envelope overlaps neither TX nor CO, and the two copies of it agree", () => {
    const box = STATE_ENVELOPES.GA;
    expect(box).toEqual(GA_ENVELOPE_BOX);
    expect([GA_ENVELOPE.latMin, GA_ENVELOPE.lonMin, GA_ENVELOPE.latMax, GA_ENVELOPE.lonMax]).toEqual(box);
    const overlap = (a, b) => a[0] <= b[2] && a[2] >= b[0] && a[1] <= b[3] && a[3] >= b[1];
    expect(overlap(box, STATE_ENVELOPES.TX)).toBe(false);
    expect(overlap(box, STATE_ENVELOPES.CO)).toBe(false);
    expect(siteState({ lat: ATL[1], lng: ATL[0] })).toBe("GA");
  });
  it("Georgia has no ETJ source, and a Georgia city is never 'ETJ not mapped'", () => {
    expect(etjSourcesForPoint(ATL[1], ATL[0])).toEqual([]);
    expect(etjCoverageFor("Atlanta", ATL[1], ATL[0])).toBe("no-layer");
  });
});

describe("identify + badge — the Georgia acceptance points", () => {
  it("downtown Atlanta → City of Atlanta, GA · Fulton County", async () => {
    const j = await run(ATL, ga("Fulton", "Atlanta"));
    expect(j.county).toEqual(["Fulton"]);
    expect(j.city).toEqual(["Atlanta"]);
    expect(j.state).toBe("GA");
    const b = formatJurisdictionBadge(j);
    expect(b.text).toBe("City of Atlanta, GA · Fulton County");
    expect(b.governingCities).toEqual(["Atlanta"]);
  });
  it("unincorporated Gwinnett → the county governs, with NO ETJ wording anywhere", async () => {
    const j = await run(GWINNETT, ga("Gwinnett", null));
    expect(j.unincorporated).toBe(true);
    const b = formatJurisdictionBadge(j);
    expect(b.text).toBe("Unincorporated Gwinnett County, GA");
    expect(b.county).toBe("Gwinnett County");
    // every VISIBLE string (keys like `etjLabels` are data plumbing, not wording): label, slots, tail, tooltip note, source messages
    const everything = JSON.stringify({ t: b.text, jur: b.jur, parts: b.parts, tail: b.tail, note: b.gaNote, msgs: j.sources.map((x) => x.msg) });
    expect(everything).not.toMatch(/etj|extraterritorial/i);
    expect(j.etjUnmappedCities).toEqual([]);
    expect(b.gaNote).toMatch(/county is the zoning and permitting authority/);
  });
  it("a consolidated city-county reads as ONE government, not 'city + unincorporated'", async () => {
    const j = await run(ATHENS, ga("Clarke", "Athens-Clarke County"));
    const b = formatJurisdictionBadge(j);
    expect(b.text).toBe("Athens-Clarke County, GA (consolidated)");
    expect(b.text).not.toMatch(/unincorporated|City of/);
    expect(b.consolidated.county).toBe("Clarke");
    expect(georgiaConsolidatedFor(["Bibb"]).label).toBe("Macon-Bibb County");
    expect(georgiaConsolidatedFor(["Fulton"])).toBeNull();
    expect(Object.keys(GA_CONSOLIDATED)).toEqual(expect.arrayContaining(["Clarke", "Richmond", "Muscogee", "Bibb"]));
  });
  it("a point in the GA envelope but in NO Georgia county (SC bank of Augusta) is not Georgia: no badge, no guess", async () => {
    const j = await run(NORTH_AUGUSTA_SC, ga(null, null));
    expect(j.notInGeorgia).toBe(true);
    expect(j.state).toBeUndefined();
    expect(formatJurisdictionBadge(j)).toBeNull();
  });
  it("a FAILED county lookup is an outage, not 'not Georgia'", async () => {
    const boom = async () => { throw new Error("Failed to fetch"); };
    const j = await identifyJurisdiction(ATL[0], ATL[1], { cache: freshCache(), fetchJson: boom, roles: ["county", "city"] });
    expect(j.notInGeorgia).toBeUndefined();
  });
  it("a Texas result formats exactly as before (no ', GA', no consolidated note)", () => {
    const b = formatJurisdictionBadge({ city: [], county: ["Fort Bend"], etj: [], isd: [], unincorporated: true,
      cityCentroid: [], cityAll: [], citySome: [], sources: [{ id: "city", state: "empty" }, { id: "county", state: "loaded" }, { id: "etj", state: "empty" }] });
    expect(b.text).toBe("Unincorporated · Fort Bend County");
    expect(b.state).toBeNull();
    expect(b.gaNote).toBeNull();
  });
  it("countyAtPoint answers Georgia with a Georgia county and state GA (never Texas)", async () => {
    const r = await countyAtPoint(ATL[0], ATL[1], { cache: freshCache(), fetchJson: fakeFetch(ga("Fulton", "Atlanta")) });
    expect(r).toMatchObject({ name: "Fulton", state: "GA", key: null });
  });
});

describe("no Texas number on a Georgia site", () => {
  it("detention is a named 'not available in Georgia yet' state, even with a Texas authority forced", () => {
    for (const authorityId of [null, "hcfcd", "montgomery", "coh"]) {
      const r = computeRequiredDetention({ acres: 40, impPct: 80, authorityId, siteState: "GA" });
      expect(r.kind).toBe("unavailable");
      expect(r.requiredAcFt).toBeNull();
      expect(r.rateAcFtPerAc).toBeNull();
      expect(r.headline).toBe("Detention criteria not yet available in Georgia");
      expect(r.verdictSubject).toBe("Georgia detention");
      expect(r.flags).toContain("georgia-not-wired");
    }
  });
  it("Texas detention is unchanged (Harris County still prices)", () => {
    const r = computeRequiredDetention({ acres: 40, impPct: 80, authorityId: "hcfcd", siteState: "TX" });
    expect(r.kind).not.toBe("unavailable");
  });
  it("Harris County, GEORGIA is not HCFCD; Montgomery County, GEORGIA is not Montgomery TX", () => {
    for (const county of ["Harris", "Montgomery"]) {
      const a = authorityForJurisdiction({ city: [], etj: [], county: [county], unincorporated: true, state: "GA" });
      expect(a.primary).toBeNull();
      expect(a.channelAuthority).toBeNull();
      expect(a.flags).toContain("georgia-not-wired");
    }
    // ...while the identical names WITHOUT the Georgia state still resolve as Texas (control).
    expect(authorityForJurisdiction({ city: [], etj: [], county: ["Harris"], unincorporated: true }).channelAuthority).toBe("hcfcd");
  });
});

describe("registry + layers", () => {
  it("countyGa / cityGa are GA-only rows that pass the registry audit and declare their limit classing", () => {
    for (const k of ["countyGa", "cityGa"]) {
      expect(statesFor(GIS_SOURCES[k])).toEqual(["GA"]);
      expect(sourceCoversState(GIS_SOURCES[k], "TX")).toBe(false);
      expect(sourceCoversState(GIS_SOURCES[k], "GA")).toBe(true);
      expect(GIS_SOURCES[k].serviceUrl).not.toMatch(/\/Test\/|staging/i);
    }
    expect(declaredLimitClassing(GIS_SOURCES.cityGa)).toBeTruthy();
    const { problems } = auditRegistry(GIS_SOURCES, SOURCE_FIXTURES, SOURCE_DOCS);
    expect(problems.filter((p) => /^(countyGa|cityGa)\b/.test(p))).toEqual([]);
  });
  it("the map layers: Georgia gets its own county + city rows, Texas rows stay TX-only, no Georgia ETJ row", () => {
    expect(LAYERS_BY_ID.ga_county.states).toEqual(["GA"]);
    expect(LAYERS_BY_ID.ga_city.states).toEqual(["GA"]);
    expect(LAYERS_BY_ID.ga_county.url).toBe(GIS_SOURCES.countyGa.serviceUrl);
    expect(LAYERS_BY_ID.ga_city.url).toBe(GIS_SOURCES.cityGa.serviceUrl);
    expect(LAYERS_BY_ID.jur_county.states).toEqual(["TX"]);
    expect(LAYERS_BY_ID.jur_city.states).toEqual(["TX"]);
    expect(Object.keys(LAYERS_BY_ID).filter((k) => /^ga_.*etj/i.test(k))).toEqual([]);
    expect(LAYERS_BY_ID.jur_etj.noEquivalentIn.GA).not.toMatch(/etj/i);
  });
});
