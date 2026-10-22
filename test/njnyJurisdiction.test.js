/* NEW-1 (New Jersey + New York) — county lines + municipal limits + jurisdiction, and the "no Texas number on a NJ / NY site" guard.
 *
 * RED-PROOF: every identify / badge assertion below fails on the pre-change main — there was no `countyNj` / `cityNj` / `countyNy` /
 * `cityNy` / `townNy` / `villageNy` row, NJ and NY points routed NO county or municipal source, so a Newark point and a Pleasantville point
 * named no municipality at all. The Texas, Colorado, Georgia and California arms assert those states resolve EXACTLY as before.
 *
 * The fixtures' attribute shapes are the LIVE ones, measured from the build sandbox 2026-10-22 (NJOGIS hosted layers; NYS ITS Civil Boundaries
 * through the official NYS GIS AGOL org). */
import { describe, it, expect, vi } from "vitest";

// layers.js pulls in Leaflet-facing modules that need a DOM — same stubs as test/californiaJurisdiction.test.js.
vi.mock("esri-leaflet", () => ({ dynamicMapLayer: vi.fn(), imageMapLayer: vi.fn(), featureLayer: vi.fn(), tiledMapLayer: vi.fn() }));
vi.mock("../src/workspaces/site-planner/lib/evidenceLayers.js", () => ({ overpassLayer: vi.fn(), mapillaryLayer: vi.fn() }));
vi.mock("../src/workspaces/site-planner/lib/terrainLayers.js", () => ({ contourLayer: vi.fn(), flowLayer: vi.fn(), TERRAIN_MIN_ZOOM: 13 }));
vi.mock("../src/workspaces/site-planner/lib/vectorOverlay.js", () => ({ cachedVectorLayer: vi.fn(), cachedPipelineLayer: vi.fn(), cachedCorridorLayer: vi.fn(), isPointFeature: vi.fn() }));
vi.mock("../src/workspaces/site-planner/lib/mapSymbols.js", () => ({ installDefaultMarkerIcon: vi.fn(), pointToLayerFor: vi.fn() }));

import {
  JURISDICTION_SOURCES, countySourcesForPoint, citySourcesForPoint, etjSourcesForPoint,
  identifyJurisdiction, formatJurisdictionBadge, countyAtPoint, normalizeFeature, samePlace,
} from "../src/workspaces/site-planner/lib/jurisdiction.js";
import { createGisCache } from "../src/workspaces/site-planner/lib/gisCache.js";
import { siteState, STATE_POLYGONS } from "../src/workspaces/site-planner/lib/siteRegion.js";
import {
  NJ_OUTLINE, NY_OUTLINE, inNewJerseyEnvelope, inNewYorkEnvelope, njnyStateAt, municipalName, municipalDisplayName, municipalType,
  sortMunicipalNames, nycBoroughOf, isNewYorkCity, NJNY_NOT_WIRED_FLAGS,
} from "../src/workspaces/site-planner/lib/njnyJurisdiction.js";
import { computeRequiredDetention, authorityForJurisdiction } from "../src/workspaces/site-planner/lib/detentionRules.js";
import { deriveZoning, buildJurisdictionFinding } from "../src/workspaces/site-planner/lib/siteAnalysis.js";
import { formatJurisdictionLabel } from "../src/workspaces/site-planner/lib/jurisdictionLabel.js";
import { GIS_SOURCES, statesFor, sourceCoversState, auditRegistry } from "../src/shared/gis/sources.js";
import { SOURCE_FIXTURES, SOURCE_DOCS } from "../src/shared/gis/sourceFixtures.js";
import { declaredLimitClassing } from "../src/workspaces/site-planner/lib/cityLimitClass.js";
import { ALL_LAYERS as LAYERS_BY_ID } from "../src/workspaces/site-planner/lib/layers.js";
import { VECTOR_SOURCES, isCountyLinesId, isCityLimitsId } from "../src/workspaces/site-planner/lib/vectorLayers.js";
import { jurisdictionRungs, governingIdentity, jurisdictionSegments } from "../src/workspaces/site-planner/lib/jurisdictionBadgeFit.js";

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
const NJ_COUNTY = "NJ_Counties_3857", NJ_MUNI = "NJ_Municipalities_3857";
const NYC = "NYS_Civil_Boundaries/FeatureServer/2/query", NYCITY = "NYS_Civil_Boundaries/FeatureServer/4/query",
  NYTOWN = "NYS_Civil_Boundaries/FeatureServer/5/query", NYVILLAGE = "NYS_Civil_Boundaries/FeatureServer/7/query";
const one = (attributes) => (attributes ? [{ attributes }] : []);
/* NJ answer: county = the all-caps COUNTY value NJOGIS publishes; muni = { NAME, MUN_TYPE } exactly as published. */
const nj = (county, muni) => ({
  [NJ_COUNTY]: () => one(county && { COUNTY: county, FIPSSTCO: "34000" }),
  [NJ_MUNI]: () => one(muni && { ...muni, CENSUS2020: "3400000000" }),
});
/* NY answer: any of county / city / town / village may be null (a point in none of that tier). */
const ny = ({ county, city, town, village } = {}) => ({
  [NYC]: () => one(county && { NAME: county, FIPS_CODE: "36000" }),
  [NYCITY]: () => one(city && { NAME: city, FIPS_CODE: "3600000000" }),
  [NYTOWN]: () => one(town && { NAME: town, FIPS_CODE: "3600000000" }),
  [NYVILLAGE]: () => one(village && { NAME: village, TOWN: "x", FIPS_CODE: "360000000000000" }),
});
const both = (a, b) => ({ ...a, ...b });
const NONE_NJ = nj(null, null), NONE_NY = ny();
const run = (pt, routes) => identifyJurisdiction(pt[0], pt[1], { cache: freshCache(), fetchJson: fakeFetch(routes), roles: ["county", "city", "etj"] });
const badge = async (pt, routes) => formatJurisdictionBadge(await run(pt, routes));

const NEWARK = [-74.1724, 40.7357], FORT_LEE = [-73.9701, 40.8509], SEASIDE = [-74.0729, 39.944], CAPE_MAY = [-74.906, 38.9351],
  PHILLIPSBURG = [-75.1904, 40.6937], EDISON = [-74.4121, 40.5187], EASTON_PA = [-75.2207, 40.6884], GREENWICH_CT = [-73.6285, 41.0262],
  LOCKPORT_IL = [-88.0578, 41.5895], MONTVALE_NJ = [-74.0229, 41.0467], PEARL_RIVER_NY = [-74.0218, 41.0587];
const BROOKLYN = [-73.9442, 40.6782], MANHATTAN = [-73.9712, 40.7831], STATEN = [-74.1502, 40.5795], BRONX = [-73.8648, 40.8448], QUEENS = [-73.7949, 40.7282],
  PLEASANTVILLE = [-73.7926, 41.1329], HEMPSTEAD_VILLAGE = [-73.6187, 40.7062], LEVITTOWN = [-73.5143, 40.7259], BUFFALO = [-78.8784, 42.8864],
  ROCHESTER = [-77.6088, 43.1566], PLATTSBURGH = [-73.4529, 44.6995], SARATOGA = [-73.7846, 43.0831], INDIAN_LAKE = [-74.2668, 43.7792],
  SARANAC_LAKE = [-74.1313, 44.3295];

describe("routing — the outlines route, never overlap TX / CO / GA / CA, and the state's own layers decide", () => {
  it("a NJ point routes to the NJOGIS county + municipal rows ONLY", () => {
    expect(countySourcesForPoint(NEWARK[1], NEWARK[0])).toEqual([JURISDICTION_SOURCES.countyNj]);
    expect(citySourcesForPoint(NEWARK[1], NEWARK[0])).toEqual([JURISDICTION_SOURCES.cityNj]);
  });
  it("a NY point routes to NYS counties and the three municipal tiers, village → city → town", () => {
    expect(countySourcesForPoint(BUFFALO[1], BUFFALO[0])).toEqual([JURISDICTION_SOURCES.countyNy]);
    expect(citySourcesForPoint(BUFFALO[1], BUFFALO[0])).toEqual([JURISDICTION_SOURCES.villageNy, JURISDICTION_SOURCES.cityNy, JURISDICTION_SOURCES.townNy]);
  });
  it("where the two outlines overlap (the Hudson), BOTH states' layers are asked", () => {
    for (const hudson of [[40.764, -73.999] /* Hell's Kitchen, NY */, [40.7695, -74.0204] /* Weehawken, NJ */]) {
      expect(inNewJerseyEnvelope(...hudson) && inNewYorkEnvelope(...hudson), `${hudson}`).toBe(true);
      expect(countySourcesForPoint(...hudson)).toEqual([JURISDICTION_SOURCES.countyNj, JURISDICTION_SOURCES.countyNy]);
      expect(citySourcesForPoint(...hudson)).toEqual([JURISDICTION_SOURCES.cityNj, JURISDICTION_SOURCES.villageNy, JURISDICTION_SOURCES.cityNy, JURISDICTION_SOURCES.townNy]);
    }
  });
  it("Texas (Katy), Colorado (Denver), Georgia (Atlanta) and California (LA) resolve to the SAME sources as before", () => {
    expect(countySourcesForPoint(29.78, -95.79)).toEqual([JURISDICTION_SOURCES.county]);
    expect(countySourcesForPoint(39.74, -104.99)).toEqual([JURISDICTION_SOURCES.countyCo]);
    expect(countySourcesForPoint(33.749, -84.388)).toEqual([JURISDICTION_SOURCES.countyGa]);
    expect(countySourcesForPoint(34.0522, -118.2437)).toEqual([JURISDICTION_SOURCES.countyCa]);
    const njny = [JURISDICTION_SOURCES.countyNj, JURISDICTION_SOURCES.countyNy, JURISDICTION_SOURCES.cityNj, JURISDICTION_SOURCES.villageNy, JURISDICTION_SOURCES.cityNy, JURISDICTION_SOURCES.townNy];
    for (const [la, lo] of [[29.78, -95.79], [39.74, -104.99], [33.749, -84.388], [34.0522, -118.2437]]) {
      for (const s of [...countySourcesForPoint(la, lo), ...citySourcesForPoint(la, lo)]) expect(njny).not.toContain(s);
    }
    expect(siteState({ lat: 29.78, lng: -95.79 })).toBe("TX");
    expect(siteState({ lat: 39.74, lng: -104.99 })).toBe("CO");
    expect(siteState({ lat: 33.749, lng: -84.388 })).toBe("GA");
    expect(siteState({ lat: 34.0522, lng: -118.2437 })).toBe("CA");
  });
  it("Greenwich CT and Lockport IL never reach a NJ / NY SOURCE that names them (CT is only in the routing outline; IL is nowhere near)", () => {
    expect(countySourcesForPoint(LOCKPORT_IL[1], LOCKPORT_IL[0])).toEqual([]);
    expect(citySourcesForPoint(LOCKPORT_IL[1], LOCKPORT_IL[0])).toEqual([]);
    expect(siteState({ lat: LOCKPORT_IL[1], lng: LOCKPORT_IL[0] })).toBeNull();
  });
  it("neither state has an ETJ source, and no NJ / NY city is 'ETJ not mapped'", () => {
    for (const p of [NEWARK, BUFFALO, PLEASANTVILLE]) expect(etjSourcesForPoint(p[1], p[0])).toEqual([]);
  });
  it("siteState: NJ and NY, with the Hudson settled by the border — not by key order", () => {
    const cases = [["Newark", NEWARK, "NJ"], ["Fort Lee", FORT_LEE, "NJ"], ["Cape May", CAPE_MAY, "NJ"], ["Jersey City", [-74.0431, 40.7178], "NJ"], ["Hoboken", [-74.0324, 40.744], "NJ"],
      ["Bayonne", [-74.1143, 40.6687], "NJ"], ["Brooklyn", BROOKLYN, "NY"], ["Lower Manhattan", [-74.006, 40.7128], "NY"], ["Staten Island", STATEN, "NY"],
      ["Bronx", BRONX, "NY"], ["Buffalo", BUFFALO, "NY"], ["Plattsburgh", PLATTSBURGH, "NY"], ["Montauk", [-71.9545, 41.0359], "NY"], ["Montvale NJ", MONTVALE_NJ, "NJ"], ["Pearl River NY", PEARL_RIVER_NY, "NY"]];
    for (const [name, p, want] of cases) expect(siteState({ lat: p[1], lng: p[0] }), name).toBe(want);
    expect(Object.keys(STATE_POLYGONS)).toEqual(expect.arrayContaining(["FL", "GA", "NJ", "NY"]));
  });
  it("the outlines are the real boundaries grown: the NJ outline holds every NJ fixture and none of Houston / Denver / Atlanta / LA", () => {
    expect(NJ_OUTLINE.length).toBeGreaterThan(20);
    expect(NY_OUTLINE.length).toBeGreaterThan(30);
    for (const p of [NEWARK, FORT_LEE, SEASIDE, CAPE_MAY, PHILLIPSBURG, EDISON]) expect(inNewJerseyEnvelope(p[1], p[0])).toBe(true);
    for (const p of [BROOKLYN, MANHATTAN, STATEN, BRONX, QUEENS, PLEASANTVILLE, HEMPSTEAD_VILLAGE, BUFFALO, ROCHESTER, PLATTSBURGH, SARATOGA, INDIAN_LAKE]) expect(inNewYorkEnvelope(p[1], p[0])).toBe(true);
    for (const p of [[-95.37, 29.76], [-104.99, 39.74], [-84.388, 33.749], [-118.2437, 34.0522], LOCKPORT_IL]) {
      expect(njnyStateAt(p[1], p[0])).toBeNull();
    }
  });
});

describe("municipal names — the TYPE is part of the name, and the Village of Hempstead is not the Town of Hempstead", () => {
  const nameOf = (cfg, attrs) => municipalName(cfg, attrs);
  it("NJ: built from NAME + MUN_TYPE however NJOGIS typed (or did not type) the name", () => {
    const cfg = { baseField: "NAME", typeField: "MUN_TYPE" };
    expect(nameOf(cfg, { NAME: "Newark", MUN_TYPE: "City" })).toBe("Newark City");
    expect(nameOf(cfg, { NAME: "Fort Lee Borough", MUN_TYPE: "Borough" })).toBe("Fort Lee Borough");
    expect(nameOf(cfg, { NAME: "Edison Township", MUN_TYPE: "Township" })).toBe("Edison Township");
    expect(nameOf(cfg, { NAME: "Phillipsburg", MUN_TYPE: "Town" })).toBe("Phillipsburg Town");
    expect(nameOf(cfg, { NAME: "Ridgewood Village", MUN_TYPE: "Village" })).toBe("Ridgewood Village");
    expect(nameOf(cfg, { NAME: "Princeton", MUN_TYPE: "Borough" })).toBe("Princeton Borough");
    expect(nameOf(cfg, { NAME: "City of Orange Township", MUN_TYPE: "City" })).toBe("City of Orange Township");
  });
  it("display: '<Type> of <Name>' — with the three legal names that do not fit the pattern pinned", () => {
    for (const [internal, shown] of [["Newark City", "City of Newark"], ["Fort Lee Borough", "Borough of Fort Lee"], ["Edison Township", "Township of Edison"],
      ["Phillipsburg Town", "Town of Phillipsburg"], ["Ridgewood Village", "Village of Ridgewood"], ["Hempstead Village", "Village of Hempstead"],
      ["Hempstead Town", "Town of Hempstead"], ["New York City", "New York City"], ["City of Orange Township", "City of Orange Township"],
      ["Princeton Borough", "Municipality of Princeton"], ["Mount Pleasant Town", "Town of Mount Pleasant"]]) expect(municipalDisplayName(internal), internal).toBe(shown);
  });
  it("placeKey would MERGE 'Village of Hempstead' with 'Town of Hempstead' — the suffix form keeps them two governments", () => {
    expect(samePlace("Village of Hempstead", "Town of Hempstead")).toBe(true); // the trap, shown
    expect(samePlace("Hempstead Village", "Hempstead Town")).toBe(false);       // the fix
  });
  it("order: village → city → town; New York City is recognised", () => {
    expect(sortMunicipalNames(["Mount Pleasant Town", "Pleasantville Village"])).toEqual(["Pleasantville Village", "Mount Pleasant Town"]);
    expect(municipalType("Hempstead Village")).toBe("Village");
    expect(isNewYorkCity(["New York City"])).toBe(true);
    expect(isNewYorkCity(["Buffalo City"])).toBe(false);
    expect(nycBoroughOf("Kings")).toBe("Brooklyn");
    expect(nycBoroughOf("Erie")).toBeNull();
  });
  it("normalizeFeature builds the typed name for every NJ / NY source, and Texas names are untouched", () => {
    expect(normalizeFeature(JURISDICTION_SOURCES.cityNj, { NAME: "Newark", MUN_TYPE: "City" }).name).toBe("Newark City");
    expect(normalizeFeature(JURISDICTION_SOURCES.villageNy, { NAME: "Pleasantville", TOWN: "Mount Pleasant" }).name).toBe("Pleasantville Village");
    expect(normalizeFeature(JURISDICTION_SOURCES.townNy, { NAME: "Hempstead" }).name).toBe("Hempstead Town");
    expect(normalizeFeature(JURISDICTION_SOURCES.cityNy, { NAME: "New York" }).name).toBe("New York City");
    expect(normalizeFeature(JURISDICTION_SOURCES.countyNj, { COUNTY: "CAPE MAY" }).name).toBe("Cape May");
    expect(normalizeFeature(JURISDICTION_SOURCES.countyNy, { NAME: "St Lawrence" }).name).toBe("St. Lawrence");
    expect(normalizeFeature(JURISDICTION_SOURCES.city, { city_name: "Bay City" }).name).toBe("Bay City"); // Texas: never re-typed
  });
});

describe("identify + badge — the New Jersey acceptance points", () => {
  it("Newark → City of Newark · Essex County", async () => {
    const j = await run(NEWARK, nj("ESSEX", { NAME: "Newark", MUN_TYPE: "City" }));
    expect(j.county).toEqual(["Essex"]);
    expect(j.city).toEqual(["Newark City"]);
    expect(j.state).toBe("NJ");
    expect(j.unincorporated).toBe(false);
    const b = formatJurisdictionBadge(j);
    expect(b.text).toBe("City of Newark · Essex County");
    expect(b.governingCities).toEqual(["Newark City"]);
    expect(b.state).toBe("NJ");
    expect(b.shape).toBe("in-city");
  });
  it("Fort Lee → Borough of Fort Lee · Bergen County", async () => {
    expect((await badge(FORT_LEE, nj("BERGEN", { NAME: "Fort Lee Borough", MUN_TYPE: "Borough" }))).text).toBe("Borough of Fort Lee · Bergen County");
  });
  it("Seaside Heights, Cape May, Phillipsburg, Edison → the type the state gives them", async () => {
    expect((await badge(SEASIDE, nj("OCEAN", { NAME: "Seaside Heights Borough", MUN_TYPE: "Borough" }))).text).toBe("Borough of Seaside Heights · Ocean County");
    expect((await badge(CAPE_MAY, nj("CAPE MAY", { NAME: "Cape May", MUN_TYPE: "City" }))).text).toBe("City of Cape May · Cape May County");
    expect((await badge(PHILLIPSBURG, nj("WARREN", { NAME: "Phillipsburg", MUN_TYPE: "Town" }))).text).toBe("Town of Phillipsburg · Warren County");
    expect((await badge(EDISON, nj("MIDDLESEX", { NAME: "Edison Township", MUN_TYPE: "Township" }))).text).toBe("Township of Edison · Middlesex County");
  });
  it("Easton PA (across the Delaware from Phillipsburg) is inside the routing outline but NOT New Jersey — nothing is named", async () => {
    const j = await run(EASTON_PA, NONE_NJ);
    expect(j.notInNjNy).toBe(true);
    expect(j.city).toEqual([]);
    expect(formatJurisdictionBadge(j)).toBeNull();
  });
  it("NEVER 'Unincorporated' and NEVER ETJ wording on a NJ site — every string the badge carries", async () => {
    const j = await run(NEWARK, nj("ESSEX", { NAME: "Newark", MUN_TYPE: "City" }));
    const b = formatJurisdictionBadge(j);
    // the LABEL and every source message: no ETJ, no "unincorporated". (The tooltip note is the one place the word appears — to say there is none.)
    const everything = JSON.stringify({ t: b.text, jur: b.jur, parts: b.parts, tail: b.tail, msgs: j.sources.map((x) => x.msg) });
    expect(everything).not.toMatch(/etj|extraterritorial|unincorporated/i);
    expect(b.gaNote).not.toMatch(/etj|extraterritorial/i);
    expect(j.etjUnmappedCities).toEqual([]);
    expect(b.gaNote).toMatch(/no unincorporated land/);
  });
  it("a confirmed NJ county with NO municipality found says so — it does not invent 'Unincorporated'", async () => {
    const j = await run(NEWARK, nj("ESSEX", null));
    expect(j.state).toBe("NJ");
    expect(j.unincorporated).toBe(false);
    expect(j.noMunicipality).toBe(true);
    expect(formatJurisdictionBadge(j).text).toBe("No municipality found · Essex County");
  });
});

describe("identify + badge — the New York acceptance points", () => {
  it("Pleasantville → Village of Pleasantville · Town of Mount Pleasant · Westchester County (village, THEN its town)", async () => {
    const j = await run(PLEASANTVILLE, ny({ county: "Westchester", town: "Mount Pleasant", village: "Pleasantville" }));
    expect(j.state).toBe("NY");
    expect(j.county).toEqual(["Westchester"]);
    expect([...j.city].sort()).toEqual(["Mount Pleasant Town", "Pleasantville Village"]);
    const b = formatJurisdictionBadge(j);
    expect(b.text).toBe("Village of Pleasantville · Town of Mount Pleasant · Westchester County");
    expect(b.shape).toBe("in-city");
    expect(b.straddle, "a village inside its town is the normal nested answer, not a straddle").toBe(false);
    expect(b.parts).toEqual(["Village of Pleasantville", "Town of Mount Pleasant"]); // the pill drops whole facts from these; the county is its own field
    expect(b.county).toBe("Westchester County");
  });
  it("Hempstead (village) vs Hempstead (town): two governments, one bare name, both named and kept apart", async () => {
    const v = await run(HEMPSTEAD_VILLAGE, ny({ county: "Nassau", town: "Hempstead", village: "Hempstead" }));
    expect(formatJurisdictionBadge(v).text).toBe("Village of Hempstead · Town of Hempstead · Nassau County");
    const t = await run(LEVITTOWN, ny({ county: "Nassau", town: "Hempstead" }));
    expect(formatJurisdictionBadge(t).text).toBe("Town of Hempstead · Nassau County");
  });
  it("cities carry no town: Buffalo, Rochester, Plattsburgh, Saratoga Springs", async () => {
    expect((await badge(BUFFALO, ny({ county: "Erie", city: "Buffalo" }))).text).toBe("City of Buffalo · Erie County");
    expect((await badge(ROCHESTER, ny({ county: "Monroe", city: "Rochester" }))).text).toBe("City of Rochester · Monroe County");
    expect((await badge(PLATTSBURGH, ny({ county: "Clinton", city: "Plattsburgh" }))).text).toBe("City of Plattsburgh · Clinton County");
    expect((await badge(SARATOGA, ny({ county: "Saratoga", city: "Saratoga Springs" }))).text).toBe("City of Saratoga Springs · Saratoga County");
  });
  it("a rural town in Hamilton County → Town of Indian Lake · Hamilton County", async () => {
    expect((await badge(INDIAN_LAKE, ny({ county: "Hamilton", town: "Indian Lake" }))).text).toBe("Town of Indian Lake · Hamilton County");
  });
  it("New York City is ONE city and its boroughs are counties: 'New York City · Brooklyn (Kings County)'", async () => {
    const cases = [["Brooklyn", BROOKLYN, "Kings", "New York City · Brooklyn (Kings County)"], ["Manhattan", MANHATTAN, "New York", "New York City · Manhattan (New York County)"],
      ["Staten Island", STATEN, "Richmond", "New York City · Staten Island (Richmond County)"], ["Bronx", BRONX, "Bronx", "New York City · Bronx (Bronx County)"],
      ["Queens", QUEENS, "Queens", "New York City · Queens (Queens County)"]];
    for (const [name, p, county, want] of cases) {
      const b = await badge(p, ny({ county, city: "New York" }));
      expect(b.text, name).toBe(want);
      expect(b.county, name).toMatch(/\(.+ County\)$/);
    }
  });
  it("a village that straddles three towns (Saranac Lake) is one village and its towns, in order", async () => {
    const b = await badge(SARANAC_LAKE, ny({ county: "Franklin", village: "Saranac Lake", town: "Harrietstown" }));
    expect(b.text).toBe("Village of Saranac Lake · Town of Harrietstown · Franklin County");
  });
  it("St Lawrence is printed 'St. Lawrence County'", async () => {
    expect((await badge([-75.5, 44.6], ny({ county: "St Lawrence", town: "Potsdam" }))).text).toBe("Town of Potsdam · St. Lawrence County");
  });
  it("Greenwich CT (inside the NY routing outline) is NOT New York — nothing is named", async () => {
    const j = await run(GREENWICH_CT, NONE_NY);
    expect(j.notInNjNy).toBe(true);
    expect(formatJurisdictionBadge(j)).toBeNull();
  });
  it("NEVER 'Unincorporated' and NEVER ETJ wording on a NY site", async () => {
    const j = await run(PLEASANTVILLE, ny({ county: "Westchester", town: "Mount Pleasant", village: "Pleasantville" }));
    const b = formatJurisdictionBadge(j);
    expect(JSON.stringify({ t: b.text, parts: b.parts, tail: b.tail, note: b.gaNote, msgs: j.sources.map((x) => x.msg) })).not.toMatch(/etj|extraterritorial|unincorporated/i);
    expect(b.gaNote).toMatch(/village/i);
  });
});

describe("the Rockland / Bergen line — both sides, and the state is whichever layer answered", () => {
  it("Pearl River NY (Rockland): the NJ layer is asked if the outline reaches it and answers empty; the state is NY", async () => {
    const j = await run(PEARL_RIVER_NY, both(NONE_NJ, ny({ county: "Rockland", town: "Orangetown" })));
    expect(j.state).toBe("NY");
    expect(formatJurisdictionBadge(j).text).toBe("Town of Orangetown · Rockland County");
  });
  it("Montvale NJ (Bergen): the NY layer answers empty; the state is NJ", async () => {
    const j = await run(MONTVALE_NJ, both(nj("BERGEN", { NAME: "Montvale Borough", MUN_TYPE: "Borough" }), NONE_NY));
    expect(j.state).toBe("NJ");
    expect(formatJurisdictionBadge(j).text).toBe("Borough of Montvale · Bergen County");
  });
  it("on the Hudson both states' layers are asked and the one with a county wins", async () => {
    const hk = [-73.999, 40.764], weehawken = [-74.0204, 40.7695]; // both inside BOTH outlines
    const a = await run(hk, both(NONE_NJ, ny({ county: "New York", city: "New York" })));
    expect(a.state).toBe("NY");
    expect(formatJurisdictionBadge(a).text).toBe("New York City · Manhattan (New York County)");
    const w = await run(weehawken, both(nj("HUDSON", { NAME: "Weehawken Township", MUN_TYPE: "Township" }), NONE_NY));
    expect(w.state).toBe("NJ");
    expect(formatJurisdictionBadge(w).text).toBe("Township of Weehawken · Hudson County");
  });
});

describe("a Texas number never lands on a NJ / NY site", () => {
  it("authorityForJurisdiction: New York's Montgomery / Orange / Jefferson / Washington Counties are not Texas's", () => {
    for (const c of ["Montgomery", "Orange", "Jefferson", "Washington", "Harris"]) {
      const a = authorityForJurisdiction({ county: [c], city: [], unincorporated: false, state: "NY" });
      expect(a.primary, c).toBeNull();
      expect(a.channelAuthority, c).toBeNull();
      expect(a.flags).toEqual(expect.arrayContaining([NJNY_NOT_WIRED_FLAGS[1], "no-criteria-modeled"]));
    }
    expect(authorityForJurisdiction({ county: ["Monmouth"], city: [], state: "NJ" }).flags).toContain(NJNY_NOT_WIRED_FLAGS[0]);
    // Texas is unchanged
    expect(authorityForJurisdiction({ county: ["Montgomery"], city: [], state: "TX" }).primary).toBe("montgomery");
  });
  it("computeRequiredDetention on a NJ / NY site is the named 'not available' state — never a number", () => {
    for (const [st, word] of [["NJ", "New Jersey"], ["NY", "New York"]]) {
      const r = computeRequiredDetention({ acres: 50, impPct: 80, siteState: st, authorityId: "hcfcd" });
      expect(r.kind).toBe("unavailable");
      expect(r.requiredAcFt).toBeNull();
      expect(r.headline).toBe(`Detention criteria not yet available in ${word}`);
      expect(r.verdictSubject).toBe(`${word} detention`);
    }
  });
  it("countyAtPoint: a NJ / NY point is answered by its own layer and carries its own state — never 'TX'", async () => {
    const r = await countyAtPoint(PLEASANTVILLE[0], PLEASANTVILLE[1], { cache: freshCache(), fetchJson: fakeFetch(both(NONE_NJ, ny({ county: "Westchester" }))) });
    expect(r).toMatchObject({ name: "Westchester", state: "NY", key: null });
    const n = await countyAtPoint(NEWARK[0], NEWARK[1], { cache: freshCache(), fetchJson: fakeFetch(nj("ESSEX", null)) });
    expect(n).toMatchObject({ name: "Essex", state: "NJ", key: null });
  });
});

describe("Site Analysis — the jurisdiction card and the zoning line", () => {
  it("the card names the municipalities, the county and the NJ / NY publishers; ETJ reads 'None in <State>'", async () => {
    const j = await run(PLEASANTVILLE, ny({ county: "Westchester", town: "Mount Pleasant", village: "Pleasantville" }));
    const f = buildJurisdictionFinding(j, "NY");
    const row = (k) => (f.rows.find((r) => r[0] === k) || [])[1];
    expect(row("County")).toBe("Westchester");
    expect(row("City")).toBe("Village of Pleasantville + Town of Mount Pleasant");
    expect(row("ETJ")).toMatch(/^None in New York/);
    expect(f.sourceName).toMatch(/NYS ITS/);
    const nj1 = buildJurisdictionFinding(await run(NEWARK, nj("ESSEX", { NAME: "Newark", MUN_TYPE: "City" })), "NJ");
    expect((nj1.rows.find((r) => r[0] === "City") || [])[1]).toBe("City of Newark");
    expect(nj1.sourceName).toMatch(/NJOGIS/);
  });
  it("zoning is municipal: never 'Texas counties have no zoning', never Houston trivia", async () => {
    const j = await run(PLEASANTVILLE, ny({ county: "Westchester", town: "Mount Pleasant", village: "Pleasantville" }));
    const z = deriveZoning(j, "NY");
    expect(z.summary).toMatch(/^Within Village of Pleasantville \+ Town of Mount Pleasant — municipal zoning applies/);
    expect(z.summary).not.toMatch(/Texas|Houston|unincorporated/i);
    expect(z.caveat).toMatch(/county is not the zoning authority/);
  });
});

describe("the label model — the pieces", () => {
  it("a village that holds PART of the site sits under the town that holds all of it", () => {
    const l = formatJurisdictionLabel({ state: "NY", governingCities: ["Mount Pleasant Town"], partialCities: ["Pleasantville Village"], splitNote: " 31% by area", counties: ["Westchester"] });
    expect(l.shape).toBe("split");
    expect(l.text).toBe("Town of Mount Pleasant · Part in Village of Pleasantville (31% by area) · Westchester County");
  });
  it("a NJ split between two municipalities names both; the remainder is never 'unincorporated' or an ETJ", () => {
    const l = formatJurisdictionLabel({ state: "NJ", partialCities: ["Edison Township"], splitNote: " 62% by area", remainderLabel: "rest outside the mapped municipality", counties: ["Middlesex"] });
    expect(l.text).toBe("Part in Township of Edison (62% by area) · rest outside the mapped municipality · Middlesex County");
    expect(l.text).not.toMatch(/unincorporated|ETJ/i);
  });
});

describe("registry + layers", () => {
  const ROWS = ["countyNj", "cityNj", "countyNy", "cityNy", "townNy", "villageNy"];
  it("six rows, each scoped to its own state, production tier, passing the registry audit with fixtures + docs", () => {
    expect(auditRegistry(GIS_SOURCES, SOURCE_FIXTURES, SOURCE_DOCS).problems).toEqual([]);
    for (const k of ROWS) { expect(GIS_SOURCES[k], k).toBeTruthy(); expect(GIS_SOURCES[k].tier).toBe("production"); }
    expect(statesFor(GIS_SOURCES.cityNj)).toEqual(["NJ"]);
    expect(statesFor(GIS_SOURCES.villageNy)).toEqual(["NY"]);
    expect(sourceCoversState(GIS_SOURCES.cityNj, "TX")).toBe(false);
    expect(sourceCoversState(GIS_SOURCES.townNy, "NJ")).toBe(false);
  });
  it("every NJ / NY city-limits row declares it carries full-purpose limits only (the cityLimitClass rule)", () => {
    for (const k of ["cityNj", "cityNy", "townNy", "villageNy"]) {
      expect(GIS_SOURCES[k].fullPurposeOnly, k).toBe(true);
      expect(declaredLimitClassing(JURISDICTION_SOURCES[k]).ok, k).toBe(true);
    }
  });
  it("the identify sources read their endpoints from the registry (B176: one URL, not two)", () => {
    for (const k of ROWS) expect(JURISDICTION_SOURCES[k].url).toBe(GIS_SOURCES[k].serviceUrl);
  });
  it("six Layers rows, all in the one 'Counties & Cities' merge group, state-scoped, each with a vector source reading the SAME endpoint", () => {
    const map = { nj_county: "countyNj", nj_city: "cityNj", ny_county: "countyNy", ny_city: "cityNy", ny_town: "townNy", ny_village: "villageNy" };
    for (const [id, key] of Object.entries(map)) {
      const row = LAYERS_BY_ID[id];
      expect(row, id).toBeTruthy();
      expect(row.mergeGroup, id).toBe("counties_cities");
      expect(row.states, id).toEqual(GIS_SOURCES[key].states);
      expect(row.url).toBe(GIS_SOURCES[key].serviceUrl);
      expect(VECTOR_SOURCES[id].query.url, id).toBe(GIS_SOURCES[key].serviceUrl + "/query");
    }
    // no ETJ row for either state
    expect(Object.keys(LAYERS_BY_ID).filter((k) => /^(nj|ny)_.*etj/i.test(k))).toEqual([]);
  });
});

/* ── A drawn SITE, not a point: the area-share pass over real polygons ─────────────────────────────────────────────── */
const rect = (x0, y0, x1, y1) => ({ rings: [[[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]]] });
const SITE = [[-73.7930, 41.1325], [-73.7920, 41.1325], [-73.7920, 41.1335], [-73.7930, 41.1335], [-73.7930, 41.1325]]; // ~85 x 110 m, Pleasantville
const withGeom = (county, tiers) => ({
  [NYC]: () => one({ NAME: county, FIPS_CODE: "36119" }),
  [NYCITY]: () => [],
  [NYTOWN]: () => tiers.town.map((g) => ({ attributes: { NAME: g.name, FIPS_CODE: "36119" }, geometry: g.geom })),
  [NYVILLAGE]: () => tiers.village.map((g) => ({ attributes: { NAME: g.name, TOWN: "x", FIPS_CODE: "36119" }, geometry: g.geom })),
});
const runRing = (routes) => identifyJurisdiction(-73.7925, 41.133, { ring: SITE, rings: [SITE], cache: freshCache(), fetchJson: fakeFetch(routes), roles: ["county", "city", "etj"] });
describe("a drawn site — the area-share pass over village / town polygons", () => {
  it("a site wholly inside a village inside a town: BOTH hold it, village first, no split, no straddle", async () => {
    const j = await runRing(withGeom("Westchester", {
      town: [{ name: "Mount Pleasant", geom: rect(-73.80, 41.12, -73.75, 41.15) }],
      village: [{ name: "Pleasantville", geom: rect(-73.795, 41.130, -73.790, 41.135) }],
    }));
    expect(j.state).toBe("NY");
    expect(j.cityShareMethod).toBe("area");
    expect([...j.cityAll].sort()).toEqual(["Mount Pleasant Town", "Pleasantville Village"]);
    expect(j.citySome).toEqual([]);
    const b = formatJurisdictionBadge(j);
    expect(b.text).toBe("Village of Pleasantville · Town of Mount Pleasant · Westchester County");
    expect(b.shape).toBe("in-city");
    expect(b.straddle).toBe(false);
  });
  it("a village holding only the east half of the site: the town still leads, the village is named with its share", async () => {
    const j = await runRing(withGeom("Westchester", {
      town: [{ name: "Mount Pleasant", geom: rect(-73.80, 41.12, -73.75, 41.15) }],
      village: [{ name: "Pleasantville", geom: rect(-73.7925, 41.130, -73.785, 41.135) }],
    }));
    expect(j.cityAll).toEqual(["Mount Pleasant Town"]);
    expect(j.citySome).toEqual(["Pleasantville Village"]);
    const b = formatJurisdictionBadge(j);
    expect(b.shape).toBe("split");
    expect(b.text).toMatch(/^Town of Mount Pleasant · Part in Village of Pleasantville \(\d+% by area\) · Westchester County$/);
    expect(b.text).not.toMatch(/unincorporated|ETJ|rest /i);
    expect(b.straddle).toBe(true);
  });
  it("Hempstead on a drawn site keeps the village and the town apart in the shares (placeKey would have merged them)", async () => {
    const j = await runRing(withGeom("Nassau", {
      town: [{ name: "Hempstead", geom: rect(-73.80, 41.12, -73.75, 41.15) }],
      village: [{ name: "Hempstead", geom: rect(-73.795, 41.130, -73.790, 41.135) }],
    }));
    expect(j.cityAreas.rows.map((r) => r.name).sort()).toEqual(["Hempstead Town", "Hempstead Village"]);
    expect(formatJurisdictionBadge(j).text).toBe("Village of Hempstead · Town of Hempstead · Nassau County");
  });
});

describe("the header pill and the drawn lines", () => {
  const nyBadge = async () => formatJurisdictionBadge(await run(PLEASANTVILLE, ny({ county: "Westchester", town: "Mount Pleasant", village: "Pleasantville" })));
  it("the shortened forms name the village, never 'City of Pleasantville Village'", async () => {
    const b = await nyBadge();
    expect(jurisdictionSegments(b)).toEqual(["Village of Pleasantville", "Town of Mount Pleasant", "Westchester County"]);
    expect(governingIdentity(b)).toBe("Village of Pleasantville");
    for (const r of jurisdictionRungs(b)) expect(r).not.toMatch(/City of .* (Village|Town|Township|Borough)/);
  });
  it("a split reads 'Part in <Village>' and a gap reads 'No municipality found' — never 'Unincorporated'", () => {
    expect(governingIdentity({ state: "NY", partialCities: ["Pleasantville Village"] })).toBe("Part in Village of Pleasantville");
    expect(governingIdentity({ state: "NJ", cityContainment: "none" })).toBe("No municipality found");
    expect(governingIdentity({ state: null, cityContainment: "none" })).toBe("Unincorporated"); // Texas unchanged
  });
  it("the NJ / NY county and municipal layers are in the shared county-lines / city-limits id sets (labels, PDF parity)", () => {
    for (const id of ["nj_county", "ny_county"]) expect(isCountyLinesId(id)).toBe(true);
    for (const id of ["nj_city", "ny_city", "ny_town", "ny_village"]) expect(isCityLimitsId(id)).toBe(true);
  });
});
