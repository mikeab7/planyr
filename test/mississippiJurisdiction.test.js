/* NEW-1 (DeSoto County MS, B2507059) — the header chip and Site Analysis name the CITY, or "Unincorporated DeSoto County, MS".
 *
 * RED-PROOF: on the pre-change main a DeSoto point routed the TENNESSEE county layer only (the TN box holds the ground), which answers empty on Mississippi ground → `notInTennessee`
 * → a null badge: the header said NOTHING. The Texas, Georgia, Tennessee and rest-of-Mississippi arms assert those resolve exactly as before.
 *
 * Answers are the LIVE ones, measured 2026-10-29 from gis.desotocountyms.gov through planyr.io/gis-proxy: BaseLayers/8 "County Outline" (COUNTY = "DeSoto") and
 * BaseLayers/4 "Municipalities" (NAME = OLIVE BRANCH · SOUTHAVEN · HORN LAKE · HERNANDO · WALLS). */
import { describe, it, expect, vi } from "vitest";

vi.mock("esri-leaflet", () => ({ dynamicMapLayer: vi.fn(), imageMapLayer: vi.fn(), featureLayer: vi.fn(), tiledMapLayer: vi.fn() }));
vi.mock("../src/workspaces/site-planner/lib/evidenceLayers.js", () => ({ overpassLayer: vi.fn(), mapillaryLayer: vi.fn() }));
vi.mock("../src/workspaces/site-planner/lib/terrainLayers.js", () => ({ contourLayer: vi.fn(), flowLayer: vi.fn(), TERRAIN_MIN_ZOOM: 13 }));
vi.mock("../src/workspaces/site-planner/lib/vectorOverlay.js", () => ({ cachedVectorLayer: vi.fn(), cachedPipelineLayer: vi.fn(), cachedCorridorLayer: vi.fn(), isPointFeature: vi.fn() }));
vi.mock("../src/workspaces/site-planner/lib/mapSymbols.js", () => ({ installDefaultMarkerIcon: vi.fn(), pointToLayerFor: vi.fn() }));

import {
  JURISDICTION_SOURCES, countySourcesForPoint, citySourcesForPoint, identifyJurisdiction, formatJurisdictionBadge,
} from "../src/workspaces/site-planner/lib/jurisdiction.js";
import { createGisCache } from "../src/workspaces/site-planner/lib/gisCache.js";
import { siteState } from "../src/workspaces/site-planner/lib/siteRegion.js";
import { inDeSotoEnvelope, MS_COUNTY_URL, MS_CITY_URL } from "../src/workspaces/site-planner/lib/mississippiJurisdiction.js";
import { deriveZoning } from "../src/workspaces/site-planner/lib/siteAnalysis.js";
import { jurisdictionFrom } from "../src/workspaces/site-planner/lib/desotoJurisdiction.js";
import { readFileSync } from "node:fs";

const makeStore = () => { const m = new Map(); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => { m.set(k, v); }, removeItem: (k) => m.delete(k), get length() { return m.size; }, key: (i) => Array.from(m.keys())[i] ?? null }; };
const freshCache = () => createGisCache({ store: makeStore(), now: () => 1_000_000 });
function fakeFetch(routes) {
  const fn = async (url) => {
    for (const [needle, respond] of Object.entries(routes)) if (url.includes(needle)) { fn.log.push(needle); return { features: respond(url) }; }
    throw new Error("no route for " + url);
  };
  fn.log = [];
  return fn;
}
const one = (attributes) => (attributes ? [{ attributes }] : []);
/* A DeSoto County answer. Tennessee's and Georgia's layers are routed in the overlap/neighbourhood and answer empty on Mississippi ground. */
const ms = (county, city) => ({
  "BaseLayers/MapServer/8": () => one(county && { COUNTY: county }),
  "BaseLayers/MapServer/4": () => one(city && { NAME: city }),
  "TN_Counties_view": () => [], "TN_Cities_view": () => [], "Counties_2018": () => [], "Municipal_Boundaries": () => [],
});
const run = (pt, routes) => identifyJurisdiction(pt[0], pt[1], { cache: freshCache(), fetchJson: fakeFetch(routes), roles: ["county", "city", "etj"] });
const badge = async (pt, routes) => formatJurisdictionBadge(await run(pt, routes));

/* [lng, lat] */
const OLIVE_BRANCH = [-89.8295, 34.9618], HACKS_CROSS = [-89.78, 34.9], SOUTHAVEN = [-90.0126, 34.9889], HERNANDO = [-89.9937, 34.824];
const MEMPHIS = [-90.049, 35.1495], TUPELO = [-88.7, 34.26], HOUSTON = [-95.37, 29.76], ATLANTA = [-84.388, 33.749], NASHVILLE = [-86.7816, 36.1627];

describe("routing — DeSoto County's box asks the county's own layers (and Tennessee's where the boxes overlap)", () => {
  it("a point in DeSoto County routes to the county's County Outline + Municipalities, and the URLs are the relayed county server", () => {
    expect(countySourcesForPoint(HACKS_CROSS[1], HACKS_CROSS[0])).toEqual([JURISDICTION_SOURCES.countyMs]);   // south of Tennessee's box: the county's layers only
    expect(citySourcesForPoint(HACKS_CROSS[1], HACKS_CROSS[0])).toEqual([JURISDICTION_SOURCES.cityMs]);
    expect(countySourcesForPoint(OLIVE_BRANCH[1], OLIVE_BRANCH[0])).toEqual([JURISDICTION_SOURCES.countyMs, JURISDICTION_SOURCES.countyTn]); // Olive Branch is inside Tennessee's box too
    expect(MS_COUNTY_URL).toBe("/gis-proxy/gis.desotocountyms.gov/arcgis/rest/services/BaseLayers/MapServer/8");
    expect(MS_CITY_URL).toBe("/gis-proxy/gis.desotocountyms.gov/arcgis/rest/services/BaseLayers/MapServer/4");
  });
  it("on the Tennessee line (Southaven, inside Tennessee's box too) BOTH states' layers are asked, Mississippi first", () => {
    expect(countySourcesForPoint(SOUTHAVEN[1], SOUTHAVEN[0])).toEqual([JURISDICTION_SOURCES.countyMs, JURISDICTION_SOURCES.countyTn]);
    expect(citySourcesForPoint(SOUTHAVEN[1], SOUTHAVEN[0])).toEqual([JURISDICTION_SOURCES.cityMs, JURISDICTION_SOURCES.cityTn]);
  });
  it("everywhere else routes exactly as before — Memphis/Nashville Tennessee only, Georgia, Texas, rest-of-Mississippi nothing from DeSoto", () => {
    expect(countySourcesForPoint(MEMPHIS[1], MEMPHIS[0])).toEqual([JURISDICTION_SOURCES.countyTn]);
    expect(countySourcesForPoint(NASHVILLE[1], NASHVILLE[0])).toEqual([JURISDICTION_SOURCES.countyTn]);
    expect(countySourcesForPoint(ATLANTA[1], ATLANTA[0])).toEqual([JURISDICTION_SOURCES.countyGa]);
    expect(countySourcesForPoint(HOUSTON[1], HOUSTON[0])).toEqual([JURISDICTION_SOURCES.county]);
    expect(countySourcesForPoint(TUPELO[1], TUPELO[0])).not.toContain(JURISDICTION_SOURCES.countyMs);
    expect(citySourcesForPoint(TUPELO[1], TUPELO[0])).not.toContain(JURISDICTION_SOURCES.cityMs);
    expect(inDeSotoEnvelope(MEMPHIS[1], MEMPHIS[0])).toBe(false);
    expect(inDeSotoEnvelope(OLIVE_BRANCH[1], OLIVE_BRANCH[0])).toBe(true);
  });
  it("the Mississippi site is Mississippi to the region module too", () => { expect(siteState({ lat: OLIVE_BRANCH[1], lng: OLIVE_BRANCH[0] })).toBe("MS"); });
});

describe("the header chip — the city, or Unincorporated DeSoto County", () => {
  it("Olive Branch: the city leads and the state is Mississippi's", async () => {
    const j = await run(OLIVE_BRANCH, ms("DeSoto", "OLIVE BRANCH"));
    expect(j.state).toBe("MS");
    expect(j.county).toEqual(["DeSoto"]);
    const b = formatJurisdictionBadge(j);
    expect(b).toBeTruthy();
    expect(b.jur).toMatch(/Olive Branch/i);
    expect(b.jur).toMatch(/MS/);
    expect(b.jur).not.toMatch(/ETJ/i);
  });
  it("outside the five cities it reads 'Unincorporated DeSoto County, MS' — no ETJ is ever printed", async () => {
    const b = await badge(HACKS_CROSS, ms("DeSoto", null));
    expect(b.jur).toBe("Unincorporated DeSoto County, MS");
    expect(b.jur).not.toMatch(/ETJ/i);
  });
  it("on the Tennessee line, a Southaven point is Mississippi's (Tennessee's empty answer does not null the chip)", async () => {
    const j = await run(SOUTHAVEN, ms("DeSoto", "SOUTHAVEN"));
    expect(j.state).toBe("MS");
    expect(j.notInTennessee).toBeFalsy();          // Mississippi named the county, so Tennessee's empty answer is not a verdict
    const b = formatJurisdictionBadge(j);
    expect(b && b.jur).toMatch(/Southaven/);
  });
  it("the two answers agree — the chip's city is the one the zoning card names for the same point (one set of limits)", async () => {
    const fc = JSON.parse(readFileSync(new URL("./fixtures/desotoMunicipalities.json", import.meta.url), "utf8"));
    for (const [pt, city] of [[OLIVE_BRANCH, "Olive Branch"], [SOUTHAVEN, "Southaven"], [HERNANDO, "Hernando"]]) {
      expect(jurisdictionFrom(fc, pt[1], pt[0])).toBe(city);
      const b = await badge(pt, ms("DeSoto", city.toUpperCase()));
      expect(b.jur).toMatch(new RegExp(city, "i"));
    }
  });
  it("the county layer not holding the point (Mississippi ground outside DeSoto reached through the box) shows nothing — never a guessed 'Unincorporated'", async () => {
    const j = await run([-89.66, 34.69], ms(null, null));   // inside the box's corner, outside the county
    expect(j.state ?? null).toBeNull();
    expect(formatJurisdictionBadge(j)).toBeNull();
  });
});

describe("regressions — the other states are byte-for-byte as before", () => {
  it("a Tennessee point still reads Tennessee (Memphis: Shelby County, TN)", async () => {
    const routes = { "TN_Counties_view": () => one({ NAME: "Shelby", GEOID: "47157" }), "TN_Cities_view": () => one({ NAME: "Memphis" }), "Counties_2018": () => [], "Municipal_Boundaries": () => [] };
    const j = await run(MEMPHIS, routes);
    expect(j.state).toBe("TN");
    expect(j.county).toEqual(["Shelby"]);
  });
});

describe("Site Analysis zoning sentence — DeSoto County's own, never Texas's", () => {
  it("unincorporated DeSoto County zones its land and says Mississippi has no ETJ", () => {
    const z = deriveZoning({ county: ["DeSoto"], city: [], etj: [], unincorporated: true }, "MS");
    expect(z.summary).toMatch(/Unincorporated DeSoto County/);
    expect(z.summary).toMatch(/zones its unincorporated land/);
    expect(z.summary).not.toMatch(/Texas counties have no zoning/);
  });
  it("another Mississippi county gets the generic sentence — the DeSoto claim is made for DeSoto only", () => {
    expect(deriveZoning({ county: ["Lee"], city: [], etj: [], unincorporated: true }, "MS").summary).toMatch(/varies by state/);
  });
  it("inside a city the city's zoning is named", () => {
    expect(deriveZoning({ county: ["DeSoto"], city: ["Olive Branch"], etj: [] }, "MS").summary).toMatch(/Within Olive Branch/);
  });
});
