/* NEW-1 (California) — county lines + city limits + jurisdiction, and the "no Texas number on a California site" guard.
 *
 * RED-PROOF: every assertion below fails on the pre-change main (there was no `countyCa` / `cityCa` row, no California
 * envelope, California points resolved NO county, and a California site fell through to Texas detention / HCFCD logic).
 * The Texas, Colorado and Georgia arms assert those states resolve EXACTLY as before.
 *
 * The fixtures' attribute shapes are the LIVE ones, measured from the build sandbox 2026-10-02 (CDT State Geoportal). */
import { describe, it, expect, vi } from "vitest";

// layers.js pulls in Leaflet-facing modules that need a DOM — same stubs as test/georgiaJurisdiction.test.js.
vi.mock("esri-leaflet", () => ({ dynamicMapLayer: vi.fn(), imageMapLayer: vi.fn(), featureLayer: vi.fn(), tiledMapLayer: vi.fn() }));
vi.mock("../src/workspaces/site-planner/lib/evidenceLayers.js", () => ({ overpassLayer: vi.fn(), mapillaryLayer: vi.fn() }));
vi.mock("../src/workspaces/site-planner/lib/terrainLayers.js", () => ({ contourLayer: vi.fn(), flowLayer: vi.fn(), TERRAIN_MIN_ZOOM: 13 }));
vi.mock("../src/workspaces/site-planner/lib/vectorOverlay.js", () => ({ cachedVectorLayer: vi.fn(), cachedPipelineLayer: vi.fn(), cachedCorridorLayer: vi.fn(), isPointFeature: vi.fn() }));
vi.mock("../src/workspaces/site-planner/lib/mapSymbols.js", () => ({ installDefaultMarkerIcon: vi.fn(), pointToLayerFor: vi.fn() }));

import {
  JURISDICTION_SOURCES, countySourcesForPoint, citySourcesForPoint, etjSourcesForPoint, etjCoverageFor,
  identifyJurisdiction, formatJurisdictionBadge, countyAtPoint, normalizeFeature,
} from "../src/workspaces/site-planner/lib/jurisdiction.js";
import { createGisCache } from "../src/workspaces/site-planner/lib/gisCache.js";
import { siteState, STATE_ENVELOPES } from "../src/workspaces/site-planner/lib/siteRegion.js";
import { CA_ENVELOPE_BOX, CA_ENVELOPE, inCaliforniaEnvelope, californiaConsolidatedFor, CA_CONSOLIDATED, caCityDisplayName } from "../src/workspaces/site-planner/lib/californiaJurisdiction.js";
import { computeRequiredDetention, authorityForJurisdiction } from "../src/workspaces/site-planner/lib/detentionRules.js";
import { deriveZoning } from "../src/workspaces/site-planner/lib/siteAnalysis.js";
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
const COUNTY_CA = "California_County_Boundaries_and_Identifiers_Blue_Version_view", CITY_CA = "California_Cities_and_Identifiers_Blue_Version_view";
const ca = (county, city) => ({
  [COUNTY_CA]: () => (county ? [{ attributes: { CDT_NAME_SHORT: county, CENSUS_GEOID: "06000" } }] : []),
  [CITY_CA]: () => (city ? [{ attributes: { CDT_NAME_SHORT: city, CENSUS_GEOID: "0600000" } }] : []),
});
const LA = [-118.2437, 34.0522], ONTARIO = [-117.5931, 34.0633], BLOOMINGTON = [-117.3958, 34.07], STOCKTON = [-121.2908, 37.9577],
  TRACY = [-121.426, 37.7397], SF = [-122.4194, 37.7749], RENO_NV = [-119.8138, 39.5296], YUMA_AZ = [-114.6277, 32.7253], TIJUANA = [-117.0382, 32.5149];
const run = (pt, routes) => identifyJurisdiction(pt[0], pt[1], { cache: freshCache(), fetchJson: fakeFetch(routes), roles: ["county", "city", "etj"] });

describe("routing — the envelope routes, and never overlaps TX / CO / GA", () => {
  it("a California point routes to the CDT county + city rows", () => {
    expect(countySourcesForPoint(LA[1], LA[0])).toEqual([JURISDICTION_SOURCES.countyCa]);
    expect(citySourcesForPoint(LA[1], LA[0])).toEqual([JURISDICTION_SOURCES.cityCa]);
  });
  it("Texas (Katy), Colorado (Denver) and Georgia (Atlanta) resolve to the SAME sources as before", () => {
    expect(countySourcesForPoint(29.78, -95.79)).toEqual([JURISDICTION_SOURCES.county]);
    expect(countySourcesForPoint(39.74, -104.99)).toEqual([JURISDICTION_SOURCES.countyCo]);
    expect(countySourcesForPoint(33.749, -84.388)).toEqual([JURISDICTION_SOURCES.countyGa]);
    for (const [la, lo] of [[29.78, -95.79], [39.74, -104.99], [33.749, -84.388]]) {
      expect(citySourcesForPoint(la, lo)).not.toContain(JURISDICTION_SOURCES.cityCa);
      expect(countySourcesForPoint(la, lo)).not.toContain(JURISDICTION_SOURCES.countyCa);
    }
    expect(siteState({ lat: 29.78, lng: -95.79 })).toBe("TX");
    expect(siteState({ lat: 39.74, lng: -104.99 })).toBe("CO");
    expect(siteState({ lat: 33.749, lng: -84.388 })).toBe("GA");
  });
  it("the CA envelope overlaps none of TX / CO / GA, and the two copies of it agree", () => {
    const box = STATE_ENVELOPES.CA;
    expect(box).toEqual(CA_ENVELOPE_BOX);
    expect([CA_ENVELOPE.latMin, CA_ENVELOPE.lonMin, CA_ENVELOPE.latMax, CA_ENVELOPE.lonMax]).toEqual(box);
    const overlap = (a, b) => a[0] <= b[2] && a[2] >= b[0] && a[1] <= b[3] && a[3] >= b[1];
    for (const other of ["TX", "CO", "GA"]) expect(overlap(box, STATE_ENVELOPES[other])).toBe(false);
    expect(siteState({ lat: LA[1], lng: LA[0] })).toBe("CA");
  });
  it("the east-side diagonal is real: Las Vegas / Henderson / Reno / Pahrump / Laughlin are NOT routed to California (the box alone would)", () => {
    // each of these is inside CA_ENVELOPE_BOX — that is exactly why the outline exists
    for (const [name, lat, lng] of [["Las Vegas NV", 36.1699, -115.1398], ["Henderson NV", 36.04, -114.98], ["Reno NV", 39.5296, -119.8138],
      ["Pahrump NV", 36.21, -115.98], ["Laughlin NV", 35.17, -114.57], ["North Las Vegas NV", 36.2, -115.12]]) {
      expect(lat >= CA_ENVELOPE.latMin && lat <= CA_ENVELOPE.latMax && lng >= CA_ENVELOPE.lonMin && lng <= CA_ENVELOPE.lonMax, `${name} is inside the box`).toBe(true);
      expect(inCaliforniaEnvelope(lat, lng), name).toBe(false);
      expect(countySourcesForPoint(lat, lng), name).toEqual([]);
      expect(siteState({ lat, lng }), name).toBeNull();
    }
  });
  it("...while real California ground along that same edge IS routed: Death Valley, Needles, Blythe, Truckee, South Lake Tahoe, Alturas, Calexico, Crescent City", () => {
    for (const [name, lat, lng] of [["Death Valley CA", 36.5, -117.0], ["Needles CA", 34.8481, -114.6147], ["Blythe CA", 33.61, -114.5958],
      ["Truckee CA", 39.327, -120.183], ["South Lake Tahoe CA", 38.939, -119.977], ["Alturas CA", 41.4871, -120.5425], ["Calexico CA", 32.679, -115.4989],
      ["Crescent City CA", 41.7558, -124.2026], ["Imperial Beach CA", 32.5839, -117.1131], ["Bakersfield CA", 35.3733, -119.0187]]) {
      expect(inCaliforniaEnvelope(lat, lng), name).toBe(true);
      expect(siteState({ lat, lng }), name).toBe("CA");
      expect(countySourcesForPoint(lat, lng)[0], name).toBe(JURISDICTION_SOURCES.countyCa);
    }
  });
  it("California has no ETJ source, and a California city is never 'ETJ not mapped'", () => {
    expect(etjSourcesForPoint(LA[1], LA[0])).toEqual([]);
    expect(etjCoverageFor("Los Angeles", LA[1], LA[0])).toBe("no-layer");
  });
});

describe("identify + badge — the California acceptance points", () => {
  it("downtown Los Angeles → City of Los Angeles, CA · Los Angeles County", async () => {
    const j = await run(LA, ca("Los Angeles", "Los Angeles"));
    expect(j.county).toEqual(["Los Angeles"]);
    expect(j.city).toEqual(["Los Angeles"]);
    expect(j.state).toBe("CA");
    const b = formatJurisdictionBadge(j);
    expect(b.text).toBe("City of Los Angeles, CA · Los Angeles County");
    expect(b.governingCities).toEqual(["Los Angeles"]);
    expect(b.state).toBe("CA");
  });
  it("Ontario CA industrial → City of Ontario, CA · San Bernardino County", async () => {
    const j = await run(ONTARIO, ca("San Bernardino", "Ontario"));
    expect(formatJurisdictionBadge(j).text).toBe("City of Ontario, CA · San Bernardino County");
  });
  it("Stockton and Tracy → their own city + San Joaquin County", async () => {
    expect(formatJurisdictionBadge(await run(STOCKTON, ca("San Joaquin", "Stockton"))).text).toBe("City of Stockton, CA · San Joaquin County");
    expect(formatJurisdictionBadge(await run(TRACY, ca("San Joaquin", "Tracy"))).text).toBe("City of Tracy, CA · San Joaquin County");
  });
  it("unincorporated Bloomington → the county governs, with NO ETJ wording anywhere", async () => {
    const j = await run(BLOOMINGTON, ca("San Bernardino", null));
    expect(j.unincorporated).toBe(true);
    const b = formatJurisdictionBadge(j);
    expect(b.text).toBe("Unincorporated San Bernardino County, CA");
    expect(b.county).toBe("San Bernardino County");
    // every VISIBLE string (keys like `etjLabels` are data plumbing, not wording): label, slots, tail, tooltip note, source messages
    const everything = JSON.stringify({ t: b.text, jur: b.jur, parts: b.parts, tail: b.tail, note: b.gaNote, msgs: j.sources.map((x) => x.msg) });
    expect(everything).not.toMatch(/etj|extraterritorial/i);
    expect(j.etjUnmappedCities).toEqual([]);
    expect(b.gaNote).toMatch(/county is the zoning and permitting authority/);
    expect(b.gaNote).not.toMatch(/Georgia/);
  });
  it("San Francisco reads as ONE government, not 'city + unincorporated' and not 'City of San Francisco … San Francisco County'", async () => {
    const j = await run(SF, ca("San Francisco", "San Francisco"));
    const b = formatJurisdictionBadge(j);
    expect(b.text).toBe("City and County of San Francisco, CA (consolidated)");
    expect(b.text).not.toMatch(/unincorporated|City of /);
    expect(b.consolidated.county).toBe("San Francisco");
    expect(b.gaNote).toMatch(/Consolidated city-county government/);
    expect(californiaConsolidatedFor(["Los Angeles"])).toBeNull(); // Los Angeles is NOT consolidated
    expect(Object.keys(CA_CONSOLIDATED)).toEqual(["San Francisco"]);
  });
  it("a point inside the routing outline but in NO California county (Tijuana, Mexicali — Baja is inside the bounding ground) is not California: no badge, no guess", async () => {
    const MEXICALI = [-115.4678, 32.6633];
    for (const pt of [TIJUANA, MEXICALI]) {
      expect(countySourcesForPoint(pt[1], pt[0])[0], "routed to CA").toBe(JURISDICTION_SOURCES.countyCa);
      const j = await run(pt, ca(null, null));
      expect(j.notInCalifornia).toBe(true);
      expect(j.state).toBeUndefined();
      expect(formatJurisdictionBadge(j)).toBeNull();
    }
  });
  it("Reno NV and Yuma AZ are never even routed to the California service (no wasted request, no 'California' anything)", async () => {
    for (const pt of [RENO_NV, YUMA_AZ]) {
      expect(countySourcesForPoint(pt[1], pt[0])).toEqual([]);
      expect(citySourcesForPoint(pt[1], pt[0])).not.toContain(JURISDICTION_SOURCES.cityCa);
      expect(siteState({ lat: pt[1], lng: pt[0] })).toBeNull();
      const j = await run(pt, {}); // any California fetch would throw "no route"
      expect(j.state).toBeUndefined();
      expect(j.notInCalifornia).toBeUndefined();
    }
  });
  it("a FAILED county lookup is an outage, not 'not California'", async () => {
    const boom = async () => { throw new Error("Failed to fetch"); };
    const j = await identifyJurisdiction(LA[0], LA[1], { cache: freshCache(), fetchJson: boom, roles: ["county", "city"] });
    expect(j.notInCalifornia).toBeUndefined();
  });
  it("a Texas result formats exactly as before (no ', CA', no consolidated note) and Georgia is untouched", () => {
    const b = formatJurisdictionBadge({ city: [], county: ["Fort Bend"], etj: [], isd: [], unincorporated: true,
      cityCentroid: [], cityAll: [], citySome: [], sources: [{ id: "city", state: "empty" }, { id: "county", state: "loaded" }, { id: "etj", state: "empty" }] });
    expect(b.text).toBe("Unincorporated · Fort Bend County");
    expect(b.state).toBeNull();
    expect(b.gaNote).toBeNull();
    const g = formatJurisdictionBadge({ city: [], county: ["Gwinnett"], etj: [], isd: [], unincorporated: true, state: "GA",
      cityCentroid: [], cityAll: [], citySome: [], sources: [{ id: "city", state: "empty" }, { id: "county", state: "loaded" }] });
    expect(g.text).toBe("Unincorporated Gwinnett County, GA");
    expect(g.gaNote).toMatch(/Georgia cities/);
  });
  it("countyAtPoint answers California with a California county and state CA (never Texas)", async () => {
    const r = await countyAtPoint(LA[0], LA[1], { cache: freshCache(), fetchJson: fakeFetch(ca("Los Angeles", "Los Angeles")) });
    expect(r).toMatchObject({ name: "Los Angeles", state: "CA", key: null });
  });
});

describe("the legal-name quirk in the CDT city layer", () => {
  it("prints the names people use for the three legal names, and leaves every other name alone", () => {
    expect(normalizeFeature(JURISDICTION_SOURCES.cityCa, { CDT_NAME_SHORT: "San Buenaventura" }).name).toBe("Ventura");
    expect(normalizeFeature(JURISDICTION_SOURCES.cityCa, { CDT_NAME_SHORT: "El Paso de Robles" }).name).toBe("Paso Robles");
    expect(normalizeFeature(JURISDICTION_SOURCES.cityCa, { CDT_NAME_SHORT: "Saint Helena" }).name).toBe("St. Helena");
    expect(normalizeFeature(JURISDICTION_SOURCES.cityCa, { CDT_NAME_SHORT: "California City" }).name).toBe("California City");
    expect(normalizeFeature(JURISDICTION_SOURCES.cityCa, { CDT_NAME_SHORT: "Ontario" }).name).toBe("Ontario");
    expect(caCityDisplayName("Ontario")).toBe("Ontario");
  });
  it("the county row reads the SHORT name column, so the badge never says 'County County'", () => {
    expect(normalizeFeature(JURISDICTION_SOURCES.countyCa, { CDT_NAME_SHORT: "Los Angeles", CDTFA_COUNTY: "Los Angeles County", CENSUS_GEOID: "06037" }))
      .toMatchObject({ name: "Los Angeles", fips: "06037" });
  });
});

describe("no Texas number on a California site", () => {
  it("detention is a named 'not available in California yet' state, even with a Texas authority forced", () => {
    for (const authorityId of [null, "hcfcd", "montgomery", "coh"]) {
      const r = computeRequiredDetention({ acres: 40, impPct: 80, authorityId, siteState: "CA" });
      expect(r.kind).toBe("unavailable");
      expect(r.requiredAcFt).toBeNull();
      expect(r.rateAcFtPerAc).toBeNull();
      expect(r.headline).toBe("Detention criteria not yet available in California");
      expect(r.verdictSubject).toBe("California detention");
      expect(r.flags).toContain("california-not-wired");
    }
  });
  it("Texas detention is unchanged (Harris County still prices)", () => {
    expect(computeRequiredDetention({ acres: 40, impPct: 80, authorityId: "hcfcd", siteState: "TX" }).kind).not.toBe("unavailable");
  });
  it("Orange County, CALIFORNIA is not Orange County, Texas; Trinity County, CALIFORNIA is not Trinity, Texas", () => {
    for (const county of ["Orange", "Trinity", "Harris", "Montgomery"]) {
      const a = authorityForJurisdiction({ city: [], etj: [], county: [county], unincorporated: true, state: "CA" });
      expect(a.primary).toBeNull();
      expect(a.channelAuthority).toBeNull();
      expect(a.flags).toContain("california-not-wired");
    }
    // ...while the identical names WITHOUT the California state still resolve as Texas (control).
    expect(authorityForJurisdiction({ city: [], etj: [], county: ["Harris"], unincorporated: true }).channelAuthority).toBe("hcfcd");
  });
  it("the zoning card states California's own doctrine (counties zone) — never Texas's 'no county zoning'", () => {
    const z = deriveZoning({ city: [], etj: [], unincorporated: true, county: ["San Bernardino"] }, "CA");
    expect(z.summary).toMatch(/California counties DO zone/);
    expect(z.summary).not.toMatch(/Texas|ETJ/);
    expect(z.caveat).not.toMatch(/Houston/);
    expect(deriveZoning({ city: [], etj: [], unincorporated: true }, "TX").summary).toMatch(/Texas counties have no zoning/);
  });
});

describe("registry + layers", () => {
  it("countyCa / cityCa are CA-only rows that pass the registry audit and declare their limit classing", () => {
    for (const k of ["countyCa", "cityCa"]) {
      expect(statesFor(GIS_SOURCES[k])).toEqual(["CA"]);
      expect(sourceCoversState(GIS_SOURCES[k], "TX")).toBe(false);
      expect(sourceCoversState(GIS_SOURCES[k], "GA")).toBe(false);
      expect(sourceCoversState(GIS_SOURCES[k], "CA")).toBe(true);
      expect(GIS_SOURCES[k].serviceUrl).not.toMatch(/\/Test\/|staging/i);
    }
    expect(declaredLimitClassing(GIS_SOURCES.cityCa)).toBeTruthy();
    // the state's own identifier layer — the registry points at the CDT org, never a personal-account copy
    for (const k of ["countyCa", "cityCa"]) expect(GIS_SOURCES[k].serviceUrl).toContain("/uknczv4rpevve42E/");
    const { problems } = auditRegistry(GIS_SOURCES, SOURCE_FIXTURES, SOURCE_DOCS);
    expect(problems.filter((p) => /^(countyCa|cityCa)\b/.test(p))).toEqual([]);
  });
  it("the city row withholds offshore water and the unincorporated community of Mountain House (live count 482)", () => {
    expect(GIS_SOURCES.cityCa.where).toBe("CENSUS_PLACE_TYPE IS NOT NULL AND OFFSHORE IS NULL");
    expect(JURISDICTION_SOURCES.cityCa.where).toBe(GIS_SOURCES.cityCa.where);
  });
  it("the map layers: California gets its own county + city rows, Texas/Georgia rows stay theirs, no California ETJ row", () => {
    expect(LAYERS_BY_ID.ca_county.states).toEqual(["CA"]);
    expect(LAYERS_BY_ID.ca_city.states).toEqual(["CA"]);
    expect(LAYERS_BY_ID.ca_county.url).toBe(GIS_SOURCES.countyCa.serviceUrl);
    expect(LAYERS_BY_ID.ca_city.url).toBe(GIS_SOURCES.cityCa.serviceUrl);
    expect(LAYERS_BY_ID.jur_county.states).toEqual(["TX"]);
    expect(LAYERS_BY_ID.jur_city.states).toEqual(["TX"]);
    expect(LAYERS_BY_ID.ga_county.states).toEqual(["GA"]);
    expect(Object.keys(LAYERS_BY_ID).filter((k) => /^ca_.*etj/i.test(k))).toEqual([]);
    expect(LAYERS_BY_ID.jur_etj.noEquivalentIn.CA).not.toMatch(/etj/i);
    // the sphere-of-influence is a planning boundary, not jurisdiction — it must not be offered as a layer
    expect(Object.keys(LAYERS_BY_ID).filter((k) => /^ca_.*(sphere|soi|lafco)/i.test(k))).toEqual([]);
  });
});
