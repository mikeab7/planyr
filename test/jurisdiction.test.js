import { describe, it, expect } from "vitest";
import {
  JURISDICTION_SOURCES, ROAD_MAINT_AGENCY, roadAuthority,
  buildIdentifyParams, normalizeFeature, simplifyRing, polylineDistMeters,
  identifySource, identifyJurisdiction, identifyRoadAuthority,
} from "../src/workspaces/site-planner/lib/jurisdiction.js";
import { createGisCache } from "../src/workspaces/site-planner/lib/gisCache.js";

// Deterministic deps: a fake localStorage + clock for the cache, and a fake
// ArcGIS fetcher routed by service name — no DOM, no network.
function makeStore() {
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => { map.delete(k); map.set(k, v); },
    removeItem: (k) => map.delete(k),
    get length() { return map.size; },
    key: (i) => Array.from(map.keys())[i] ?? null,
  };
}
function makeClock(start = 1_000_000) { let t = start; const now = () => t; now.advance = (ms) => { t += ms; }; return now; }
const freshCache = () => createGisCache({ store: makeStore(), now: makeClock() });

// Build a fake fetchJson from { matchSubstring: (url) => featuresArray }. Counts calls.
function fakeFetch(routes) {
  const fn = async (url) => {
    for (const [needle, respond] of Object.entries(routes)) {
      if (url.includes(needle)) { fn.calls++; return { features: respond(url) }; }
    }
    throw new Error("no route for " + url);
  };
  fn.calls = 0;
  return fn;
}
const CITY = "Texas_City_Boundaries", COUNTY = "Texas_County_Boundaries", ROAD = "TxDOT_Roadway_Inventory";

// ----------------------------------------------------------------------------
describe("roadAuthority — coded agency → who maintains (calibrated)", () => {
  it("maps the calibrated agency codes", () => {
    expect(roadAuthority(1, "IH").label).toBe("State (TxDOT)");
    expect(roadAuthority(2, "CR").label).toBe("County");
    expect(roadAuthority(4, "LS").label).toBe("City");
    expect(roadAuthority(1, "IH").onSystem).toBe(true);
    expect(roadAuthority(4, "LS").onSystem).toBe(false);
    expect(roadAuthority("4", "LS").label).toBe("City"); // numeric string accepted
  });
  it("buckets federal-land codes 7–15 and toll codes 5/6/16", () => {
    for (const c of [7, 9, 12, 15]) expect(roadAuthority(c, "FD").label).toBe("Federal");
    for (const c of [5, 6, 16]) expect(roadAuthority(c, "TL").label).toMatch(/Toll/);
  });
  it("falls back to HSYS when the agency code is missing/unknown", () => {
    expect(roadAuthority(null, "CR").label).toBe("County");   // off-system county road
    expect(roadAuthority(null, "LS").label).toBe("City");     // local street
    expect(roadAuthority(null, "FD").label).toBe("Federal");
    expect(roadAuthority(null, "US").label).toBe("State (TxDOT)"); // on-system prefix
    expect(roadAuthority(null, "US").basis).toBe("hsys");
  });
  it("is honestly Unknown when nothing resolves — never a guess", () => {
    const a = roadAuthority(null, "ZZ");
    expect(a.label).toBe("Unknown");
    expect(a.onSystem).toBe(null);
    expect(a.basis).toBe("unknown");
    expect(roadAuthority(999, null).label).toBe("Unknown");
  });
  it("the registry only claims confidently-known codes", () => {
    expect(ROAD_MAINT_AGENCY[1].label).toBe("State (TxDOT)");
    expect(ROAD_MAINT_AGENCY[3]).toBeUndefined(); // code 3 not observed → not fabricated
  });
});

// ----------------------------------------------------------------------------
describe("buildIdentifyParams — one connector, parameterized per source", () => {
  it("point query against a polygon source: intersect, no geometry, mapped outFields", () => {
    const p = buildIdentifyParams(JURISDICTION_SOURCES.city, { lng: -95.37, lat: 29.76 });
    expect(p.geometryType).toBe("esriGeometryPoint");
    expect(p.spatialRel).toBe("esriSpatialRelIntersects");
    expect(p.returnGeometry).toBe("false");
    expect(p.outFields).toBe("city_name");
    expect(p.distance).toBeUndefined();
  });
  it("parcel-ring query against a polygon source: polygon geometry (whole-parcel straddle)", () => {
    const ring = [[-95, 29], [-95, 29.01], [-94.99, 29.01], [-94.99, 29]];
    const p = buildIdentifyParams(JURISDICTION_SOURCES.county, { ring });
    expect(p.geometryType).toBe("esriGeometryPolygon");
    expect(p.outFields).toBe("CNTY_NM,FIPS_ST_CNTY_CD");
    expect(JSON.parse(p.geometry).rings[0].length).toBeGreaterThanOrEqual(4);
  });
  it("line source buffers the point and returns geometry for nearest-segment", () => {
    const p = buildIdentifyParams(JURISDICTION_SOURCES.road, { lng: -95.37, lat: 29.76 });
    expect(p.returnGeometry).toBe("true");
    expect(p.distance).toBe(40);
    expect(p.units).toBe("esriSRUnit_Meter");
    expect(p.outFields).toContain("RDWAY_MAINT_AGCY");
  });
});

describe("normalizeFeature — source schema → one internal shape", () => {
  it("renames each source's columns onto internal keys", () => {
    expect(normalizeFeature(JURISDICTION_SOURCES.city, { city_name: "Houston" })).toEqual({ role: "city", name: "Houston" });
    expect(normalizeFeature(JURISDICTION_SOURCES.county, { CNTY_NM: "Harris", FIPS_ST_CNTY_CD: "48201" }))
      .toEqual({ role: "county", name: "Harris", fips: "48201" });
  });
  it("null-mapped fields resolve to null (e.g. ETJ has no name column yet)", () => {
    expect(normalizeFeature(JURISDICTION_SOURCES.etj, {})).toEqual({ role: "etj", name: null });
  });
});

describe("simplifyRing — keep GET query URLs bounded", () => {
  it("passes short rings through and decimates long ones, keeping endpoints", () => {
    const short = [[0, 0], [1, 1], [2, 2]];
    expect(simplifyRing(short)).toBe(short);
    const long = Array.from({ length: 500 }, (_, i) => [i, i]);
    const out = simplifyRing(long, 80);
    expect(out.length).toBe(80);
    expect(out[0]).toEqual([0, 0]);
    expect(out[out.length - 1]).toEqual([499, 499]);
  });
});

describe("polylineDistMeters — nearest-segment distance", () => {
  it("measures perpendicular distance to a segment in metres", () => {
    const geom = { paths: [[[-95.0, 29.0], [-95.0, 29.001]]] }; // ~111 m vertical segment
    const d = polylineDistMeters(geom, -95.0005, 29.0005);       // 0.0005° east at lat 29
    expect(d).toBeGreaterThan(44);
    expect(d).toBeLessThan(54); // ≈ 48.7 m
  });
  it("returns Infinity for missing geometry", () => {
    expect(polylineDistMeters(null, 0, 0)).toBe(Infinity);
    expect(polylineDistMeters({ paths: [] }, 0, 0)).toBe(Infinity);
  });
});

// ----------------------------------------------------------------------------
describe("identifySource — rides the SWR cache (B75)", () => {
  it("normalizes features and serves a repeat lookup from cache (no refetch)", async () => {
    const fetchJson = fakeFetch({ [CITY]: () => [{ attributes: { city_name: "Houston" } }] });
    const cache = freshCache();
    const a = await identifySource(JURISDICTION_SOURCES.city, { lng: -95.37, lat: 29.76 }, { cache, fetchJson }).fresh;
    expect(a.items[0].attrs.city_name).toBe("Houston");
    expect(fetchJson.calls).toBe(1);
    // same point, still fresh (ttl 7d, clock not advanced) → cache hit, fetcher not called again
    const b = await identifySource(JURISDICTION_SOURCES.city, { lng: -95.37, lat: 29.76 }, { cache, fetchJson }).fresh;
    expect(b.items[0].attrs.city_name).toBe("Houston");
    expect(fetchJson.calls).toBe(1);
  });
  it("a failed refresh keeps the last-good copy (error surfaced, not thrown)", async () => {
    const cache = freshCache();
    const ok = fakeFetch({ [CITY]: () => [{ attributes: { city_name: "Houston" } }] });
    await identifySource(JURISDICTION_SOURCES.city, { lng: -95.37, lat: 29.76 }, { cache, fetchJson: ok, }).fresh;
    // force staleness by using ttl 0 so the next call revalidates, and make it fail
    const boom = async () => { throw new Error("Failed to fetch"); };
    const src0 = { ...JURISDICTION_SOURCES.city, ttl: 0 };
    const r = await identifySource(src0, { lng: -95.37, lat: 29.76 }, { cache, fetchJson: boom }).fresh;
    expect(r.error).toBeTruthy();
    expect(r.items[0].attrs.city_name).toBe("Houston"); // last-good preserved
  });
  it("an unavailable source (ETJ, no endpoint) degrades without a fetch", async () => {
    const fetchJson = fakeFetch({});
    const q = identifySource(JURISDICTION_SOURCES.etj, { lng: -95.37, lat: 29.76 }, { fetchJson });
    expect(q.unavailable).toBe(true);
    expect((await q.fresh).items).toEqual([]);
    expect(fetchJson.calls).toBe(0);
  });
});

// ----------------------------------------------------------------------------
describe("identifyJurisdiction (B72) — city / ETJ / county", () => {
  const base = {
    [COUNTY]: () => [{ attributes: { CNTY_NM: "Harris", FIPS_ST_CNTY_CD: "48201" } }],
    [CITY]: (url) => url.includes("esriGeometryPolygon")
      ? [{ attributes: { city_name: "Houston" } }, { attributes: { city_name: "Bellaire" } }] // a parcel straddling two cities
      : [{ attributes: { city_name: "Houston" } }],
  };
  it("a point in one city + county: names resolved, no straddle, not unincorporated", async () => {
    const seen = [];
    const out = await identifyJurisdiction(-95.37, 29.76, {
      cache: freshCache(), fetchJson: fakeFetch(base),
      onStatus: (role, state) => seen.push(role + ":" + state),
    });
    expect(out.county).toEqual(["Harris"]);
    expect(out.city).toEqual(["Houston"]);
    expect(out.unincorporated).toBe(false);
    expect(out.straddle).toBe(false);
    expect(seen).toContain("city:loaded");
    expect(seen).toContain("county:loaded");
    // ETJ has no wired source → surfaced as unavailable, never crashes
    expect(out.sources.find((s) => s.id === "etj").state).toBe("unavailable");
  });
  it("a whole-parcel test flags a boundary straddle (every city listed)", async () => {
    const ring = [[-95.46, 29.70], [-95.46, 29.72], [-95.44, 29.72], [-95.44, 29.70]];
    const out = await identifyJurisdiction(-95.45, 29.71, { ring, cache: freshCache(), fetchJson: fakeFetch(base) });
    expect(out.city.sort()).toEqual(["Bellaire", "Houston"]);
    expect(out.straddle).toBe(true);
  });
  it("a point in no city reads as unincorporated", async () => {
    const out = await identifyJurisdiction(-95.0, 30.5, {
      cache: freshCache(),
      fetchJson: fakeFetch({ [COUNTY]: () => [{ attributes: { CNTY_NM: "Montgomery" } }], [CITY]: () => [] }),
    });
    expect(out.unincorporated).toBe(true);
    expect(out.city).toEqual([]);
    expect(out.county).toEqual(["Montgomery"]);
  });
  it("a failed source is reported failed without sinking the others", async () => {
    const out = await identifyJurisdiction(-95.37, 29.76, {
      cache: freshCache(),
      fetchJson: fakeFetch({
        [COUNTY]: () => [{ attributes: { CNTY_NM: "Harris" } }],
        [CITY]: () => { throw new Error("Failed to fetch"); },
      }),
    });
    expect(out.county).toEqual(["Harris"]);
    expect(out.sources.find((s) => s.id === "city").state).toBe("failed");
  });
});

// ----------------------------------------------------------------------------
describe("identifyRoadAuthority (B73) — nearest segment", () => {
  it("returns the NEAREST segment's authority among several", async () => {
    const fetchJson = fakeFetch({
      [ROAD]: () => [
        { attributes: { RIA_RTE_ID: "IH0010", HSYS: "IH", RDWAY_MAINT_AGCY: 1, F_SYSTEM: 1 }, geometry: { paths: [[[-95.0, 29.01], [-95.0, 29.02]]] } }, // ~1 km away
        { attributes: { RIA_RTE_ID: "LS1234", HSYS: "LS", RDWAY_MAINT_AGCY: 4, F_SYSTEM: 7 }, geometry: { paths: [[[-95.0001, 29.0], [-95.0001, 29.0009]]] } }, // ~10 m away
      ],
    });
    const out = await identifyRoadAuthority(-95.0, 29.0005, { cache: freshCache(), fetchJson });
    expect(out.road.authority.label).toBe("City");
    expect(out.road.route).toBe("LS1234");
    expect(out.road.distMeters).toBeLessThan(20);
  });
  it("nothing mapped within tolerance → honest null (unknown), not a guess", async () => {
    const out = await identifyRoadAuthority(-95.0, 29.0, { cache: freshCache(), fetchJson: fakeFetch({ [ROAD]: () => [] }) });
    expect(out.road).toBeNull();
    expect(out.note).toMatch(/unknown/i);
  });
  it("a server error surfaces as a null road with the error note, not a throw", async () => {
    const out = await identifyRoadAuthority(-95.0, 29.0, {
      cache: freshCache(),
      fetchJson: fakeFetch({ [ROAD]: () => { throw new Error("Failed to fetch"); } }),
    });
    expect(out.road).toBeNull();
    expect(out.error).toBeTruthy();
  });
});
