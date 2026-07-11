import { describe, it, expect } from "vitest";
import {
  JURISDICTION_SOURCES, ETJ_SOURCES, etjSourcesForPoint, ROAD_MAINT_AGENCY, roadAuthority,
  buildIdentifyParams, normalizeFeature, simplifyRing, polylineDistMeters, polylineLengthMeters,
  identifySource, identifyJurisdiction, identifyRoadAuthority, countyAtPoint,
  formatHighway, roadDisplayName, roadAuthorityStyle, ROAD_AUTHORITY_COLORS, ROAD_AUTHORITY_LEGEND,
  formatJurisdictionBadge,
} from "../src/workspaces/site-planner/lib/jurisdiction.js";

const HGAC = ETJ_SOURCES.find((s) => s.id === "etj_hgac"); // the regional Houston ETJ source
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
const CITY = "Texas_City_Boundaries", COUNTY = "Texas_County_Boundaries", ROAD = "TxDOT_Roadway_Inventory", ETJ = "HGAC_City_ETJ", ISD = "Current_Districts";

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
  it("line source against a parcel ring buffers the frontage (polygon + distance)", () => {
    const ring = [[-95, 29], [-95, 29.01], [-94.99, 29.01], [-94.99, 29]];
    const p = buildIdentifyParams(JURISDICTION_SOURCES.road, { ring });
    expect(p.geometryType).toBe("esriGeometryPolygon");
    expect(p.returnGeometry).toBe("true");
    expect(p.distance).toBe(40);
    expect(p.units).toBe("esriSRUnit_Meter");
  });
});

describe("normalizeFeature — source schema → one internal shape", () => {
  it("renames each source's columns onto internal keys", () => {
    expect(normalizeFeature(JURISDICTION_SOURCES.city, { city_name: "Houston" })).toEqual({ role: "city", name: "Houston" });
    expect(normalizeFeature(JURISDICTION_SOURCES.county, { CNTY_NM: "Harris", FIPS_ST_CNTY_CD: "48201" }))
      .toEqual({ role: "county", name: "Harris", fips: "48201" });
  });
  it("the H-GAC ETJ maps the CITY field and title-cases the ALL-CAPS value", () => {
    expect(normalizeFeature(HGAC, { CITY: "HOUSTON" })).toEqual({ role: "etj", name: "Houston" });
    expect(normalizeFeature(HGAC, { CITY: "MISSOURI CITY" })).toEqual({ role: "etj", name: "Missouri City" });
  });
  it("a single-jurisdiction layer with no name column falls back to the source constant", () => {
    expect(normalizeFeature({ role: "etj", fields: { name: null }, nameConst: "Houston" }, { OBJECTID: 5 })).toEqual({ role: "etj", name: "Houston" });
  });
  it("a null-mapped field with no constant stays null", () => {
    expect(normalizeFeature({ role: "x", fields: { name: null } }, {})).toEqual({ role: "x", name: null });
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
describe("identifySource — rides the SWR cache (B96)", () => {
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
  it("an unavailable source (no endpoint) degrades without a fetch", async () => {
    const fetchJson = fakeFetch({});
    const src = { id: "x", role: "x", url: null, unavailable: true, fields: { name: null } };
    const q = identifySource(src, { lng: -95.37, lat: 29.76 }, { fetchJson });
    expect(q.unavailable).toBe(true);
    expect((await q.fresh).items).toEqual([]);
    expect(fetchJson.calls).toBe(0);
  });
});

// ----------------------------------------------------------------------------
describe("etjSourcesForPoint — region routing (Houston stays one query)", () => {
  it("a Houston-metro point routes ONLY to H-GAC (no Austin/DFW server touched)", () => {
    const ids = etjSourcesForPoint(29.76, -95.37).map((s) => s.id);
    expect(ids).toEqual(["etj_hgac"]); // exactly one — the Houston use case is unchanged
  });
  it("an Austin point routes only to the Austin source", () => {
    expect(etjSourcesForPoint(30.27, -97.74).map((s) => s.id)).toEqual(["etj_austin"]);
  });
  it("a Dallas–Fort Worth point routes only to the Fort Worth source", () => {
    expect(etjSourcesForPoint(32.75, -97.33).map((s) => s.id)).toEqual(["etj_fortworth"]);
  });
  it("a point outside every covered metro routes to nothing (honest no-coverage)", () => {
    expect(etjSourcesForPoint(31.76, -106.49)).toEqual([]); // El Paso
  });
});

// ----------------------------------------------------------------------------
describe("identifyJurisdiction (B93) — city / ETJ / county", () => {
  const base = {
    [COUNTY]: () => [{ attributes: { CNTY_NM: "Harris", FIPS_ST_CNTY_CD: "48201" } }],
    [CITY]: (url) => url.includes("esriGeometryPolygon")
      ? [{ attributes: { city_name: "Houston" } }, { attributes: { city_name: "Bellaire" } }] // a parcel straddling two cities
      : [{ attributes: { city_name: "Houston" } }],
    [ETJ]: () => [], // in-city / most points are NOT in the (Houston-only) ETJ ring
    [ISD]: () => [{ attributes: { NAME: "Houston ISD", DISTRICT_N: 101912 } }], // B764: ISD joins the identify
  };
  it("a point in one city + county: names resolved, no straddle, not unincorporated", async () => {
    const seen = [];
    const out = await identifyJurisdiction(-95.37, 29.76, {
      cache: freshCache(), fetchJson: fakeFetch(base),
      onStatus: (role, state) => seen.push(role + ":" + state),
    });
    expect(out.county).toEqual(["Harris"]);
    expect(out.city).toEqual(["Houston"]);
    expect(out.isd).toEqual(["Houston ISD"]); // B764
    expect(out.unincorporated).toBe(false);
    expect(out.straddle).toBe(false);
    expect(seen).toContain("city:loaded");
    expect(seen).toContain("county:loaded");
    expect(seen).toContain("isd:loaded");
    // ETJ source is wired (COHGIS) but this in-city point isn't in the ETJ ring → empty
    expect(out.etj).toEqual([]);
    expect(out.sources.find((s) => s.id === "etj").state).toBe("empty");
  });
  it("an unincorporated point inside Houston's ETJ resolves via the H-GAC CITY field", async () => {
    const out = await identifyJurisdiction(-95.38, 29.93, {
      cache: freshCache(),
      fetchJson: fakeFetch({
        [COUNTY]: () => [{ attributes: { CNTY_NM: "Harris" } }],
        [CITY]: () => [],
        [ETJ]: () => [{ attributes: { CITY: "HOUSTON" } }], // H-GAC regional ETJ, ALL-CAPS city
      }),
    });
    expect(out.unincorporated).toBe(true);
    expect(out.etj).toEqual(["Houston"]); // title-cased
    expect(out.sources.find((s) => s.id === "etj").state).toBe("loaded");
  });
  it("a NON-Houston city ETJ resolves from the regional layer (no longer Houston-only)", async () => {
    const out = await identifyJurisdiction(-95.70, 29.56, {
      cache: freshCache(),
      fetchJson: fakeFetch({
        [COUNTY]: () => [{ attributes: { CNTY_NM: "Fort Bend" } }],
        [CITY]: () => [],
        [ETJ]: () => [{ attributes: { CITY: "RICHMOND" } }], // a different city's ETJ
      }),
    });
    expect(out.unincorporated).toBe(true);
    expect(out.etj).toEqual(["Richmond"]); // title-cased, not Houston
    expect(out.county).toEqual(["Fort Bend"]);
  });
  it("an Austin-metro point reads the Austin ETJ source, not H-GAC (region-routed)", async () => {
    const out = await identifyJurisdiction(-97.74, 30.27, {
      cache: freshCache(),
      fetchJson: fakeFetch({
        [COUNTY]: () => [{ attributes: { CNTY_NM: "Travis" } }],
        [CITY]: () => [],
        "COA_Jurisdiction": () => [{ attributes: { CITY_NAME: "CITY OF AUSTIN" } }], // Austin layer → nameConst "Austin"
      }),
    });
    expect(out.county).toEqual(["Travis"]);
    expect(out.etj).toEqual(["Austin"]); // resolved via the Austin source's nameConst
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
      fetchJson: fakeFetch({ [COUNTY]: () => [{ attributes: { CNTY_NM: "Montgomery" } }], [CITY]: () => [], [ETJ]: () => [] }),
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
        [ETJ]: () => [],
      }),
    });
    expect(out.county).toEqual(["Harris"]);
    expect(out.sources.find((s) => s.id === "city").state).toBe("failed");
  });
});

// ----------------------------------------------------------------------------
describe("countyAtPoint (B13/B36) — point-in-county primitive", () => {
  it("returns the county name + the configured CAD key", async () => {
    const out = await countyAtPoint(-95.37, 29.76, { cache: freshCache(), fetchJson: fakeFetch({ [COUNTY]: () => [{ attributes: { CNTY_NM: "Harris" } }] }) });
    expect(out.name).toBe("Harris");
    expect(out.key).toBe("harris");
  });
  it("maps 'Fort Bend' onto the fortbend key", async () => {
    const out = await countyAtPoint(-95.8, 29.5, { cache: freshCache(), fetchJson: fakeFetch({ [COUNTY]: () => [{ attributes: { CNTY_NM: "Fort Bend" } }] }) });
    expect(out.key).toBe("fortbend");
  });
  it("a county with no wired CAD has a name but a null key", async () => {
    const out = await countyAtPoint(-94.6, 29.7, { cache: freshCache(), fetchJson: fakeFetch({ [COUNTY]: () => [{ attributes: { CNTY_NM: "Galveston" } }] }) });
    expect(out.name).toBe("Galveston");
    expect(out.key).toBeNull();
  });
  it("no county (offshore / empty) → name + key both null", async () => {
    const out = await countyAtPoint(0, 0, { cache: freshCache(), fetchJson: fakeFetch({ [COUNTY]: () => [] }) });
    expect(out.name).toBeNull();
    expect(out.key).toBeNull();
  });
});

// ----------------------------------------------------------------------------
describe("identifyRoadAuthority (B94) — nearest segment / parcel frontage", () => {
  it("point mode: returns the NEAREST segment's authority among several", async () => {
    const fetchJson = fakeFetch({
      [ROAD]: () => [
        { attributes: { RIA_RTE_ID: "IH0010", HSYS: "IH", RDWAY_MAINT_AGCY: 1, F_SYSTEM: 1 }, geometry: { paths: [[[-95.0, 29.01], [-95.0, 29.02]]] } }, // ~1 km away
        { attributes: { RIA_RTE_ID: "LS1234", HSYS: "LS", RDWAY_MAINT_AGCY: 4, F_SYSTEM: 7 }, geometry: { paths: [[[-95.0001, 29.0], [-95.0001, 29.0009]]] } }, // ~10 m away
      ],
    });
    const out = await identifyRoadAuthority(-95.0, 29.0005, { cache: freshCache(), fetchJson });
    expect(out.nearest.authority.label).toBe("City");
    expect(out.nearest.route).toBe("LS1234");
    expect(out.nearest.distMeters).toBeLessThan(20);
    expect(out.authorities).toContain("City");
  });
  it("frontage mode: a parcel ring lists every distinct fronting authority (deduped)", async () => {
    const ring = [[-95.0, 29.0], [-95.0, 29.001], [-94.999, 29.001], [-94.999, 29.0]];
    const fetchJson = fakeFetch({
      [ROAD]: (url) => {
        expect(url).toContain("esriGeometryPolygon"); // whole-parcel geometry
        expect(url).toContain("distance="); // frontage buffer applied
        return [
          { attributes: { RIA_RTE_ID: "US0290", HSYS: "US", RDWAY_MAINT_AGCY: 1 }, geometry: { paths: [] } },
          { attributes: { RIA_RTE_ID: "LS1", HSYS: "LS", RDWAY_MAINT_AGCY: 4 }, geometry: { paths: [] } },
          { attributes: { RIA_RTE_ID: "LS1", HSYS: "LS", RDWAY_MAINT_AGCY: 4 }, geometry: { paths: [] } }, // dup route
        ];
      },
    });
    const out = await identifyRoadAuthority(-94.9995, 29.0005, { ring, cache: freshCache(), fetchJson });
    expect(out.nearest).toBeNull(); // no single nearest in frontage mode
    expect(out.roads.map((x) => x.route).sort()).toEqual(["LS1", "US0290"]); // deduped
    expect(out.authorities.sort()).toEqual(["City", "State (TxDOT)"]);
  });
  it("nothing mapped within tolerance → honest unknown, not a guess", async () => {
    const out = await identifyRoadAuthority(-95.0, 29.0, { cache: freshCache(), fetchJson: fakeFetch({ [ROAD]: () => [] }) });
    expect(out.nearest).toBeNull();
    expect(out.roads).toEqual([]);
    expect(out.authorities).toEqual([]);
    expect(out.note).toMatch(/no roads matched within 40 m — screening only/i);
  });
  it("a server error surfaces as empty + error note, not a throw", async () => {
    const out = await identifyRoadAuthority(-95.0, 29.0, {
      cache: freshCache(),
      fetchJson: fakeFetch({ [ROAD]: () => { throw new Error("Failed to fetch"); } }),
    });
    expect(out.roads).toEqual([]);
    expect(out.error).toBeTruthy();
  });
});

// ----------------------------------------------------------------------------
describe("road display name (B94 per-road) — STE_NAM / HWY / TOLL", () => {
  it("formatHighway turns a coded HWY into a readable route", () => {
    expect(formatHighway("SL0008")).toBe("SL 8");
    expect(formatHighway("IH0045")).toBe("IH 45");
    expect(formatHighway("US0059")).toBe("US 59");
    expect(formatHighway("FM1960")).toBe("FM 1960");
    expect(formatHighway("")).toBeNull();
    expect(formatHighway(null)).toBeNull();
  });
  it("roadDisplayName prefers the street name, then the highway, then the toll name", () => {
    expect(roadDisplayName({ name: "ATRIUM DR" })).toBe("Atrium Dr");
    expect(roadDisplayName({ name: "BENMAR  DR" })).toBe("Benmar Dr"); // collapses doubled spaces
    expect(roadDisplayName({ name: "", hwy: "SL0008" })).toBe("SL 8");
    expect(roadDisplayName({ name: null, hwy: null, toll: "SAM HOUSTON TOLLWAY" })).toBe("Sam Houston Tollway");
    // a bare numeric inventory id is NOT a name → null (the row labels by route instead)
    expect(roadDisplayName({ route: "1124150" })).toBeNull();
  });
});

describe("polylineLengthMeters — abutment length for ordering", () => {
  it("sums path segment lengths in metres", () => {
    const geom = { paths: [[[-95.0, 29.0], [-95.0, 29.001]]] }; // ~111 m vertical
    expect(polylineLengthMeters(geom, 29.0)).toBeGreaterThan(105);
    expect(polylineLengthMeters(geom, 29.0)).toBeLessThan(118);
  });
  it("is 0 for missing geometry", () => {
    expect(polylineLengthMeters(null)).toBe(0);
    expect(polylineLengthMeters({ paths: [] })).toBe(0);
  });
});

describe("roadAuthorityStyle (NEW-2/B571) — per-feature color reuses roadAuthority()", () => {
  it("colors each maintainer distinctly, drawn solid", () => {
    expect(roadAuthorityStyle({ RDWAY_MAINT_AGCY: 1, HSYS: "IH" }).color).toBe(ROAD_AUTHORITY_COLORS["State (TxDOT)"]);
    expect(roadAuthorityStyle({ RDWAY_MAINT_AGCY: 2, HSYS: "CR" }).color).toBe(ROAD_AUTHORITY_COLORS["County"]);
    expect(roadAuthorityStyle({ RDWAY_MAINT_AGCY: 4, HSYS: "LS" }).color).toBe(ROAD_AUTHORITY_COLORS["City"]);
    expect(roadAuthorityStyle({ RDWAY_MAINT_AGCY: 5, HSYS: "TL" }).color).toBe(ROAD_AUTHORITY_COLORS["Toll / managed-lane authority"]);
    expect(roadAuthorityStyle({ RDWAY_MAINT_AGCY: 1, HSYS: "IH" }).dashArray).toBeUndefined();
  });
  it("Unknown is a neutral gray, distinguished by a dash pattern (never by fading)", () => {
    const s = roadAuthorityStyle({ RDWAY_MAINT_AGCY: 999, HSYS: "ZZ" }, 0.9);
    expect(s.color).toBe(ROAD_AUTHORITY_COLORS["Unknown"]);
    expect(s.dashArray).toBeTruthy();
    expect(s.opacity).toBe(0.9); // opacity carries through; hierarchy is via dash, not a faded line
  });
  it("the palette never reuses a locked status/module/brand hex", () => {
    // project-status (coral/blue/amber/grays) + ALL four module accents (Site/Schedule/
    // Review/Library) + brand + the alert reds — the full locked set the road palette must avoid.
    const locked = new Set(["#D85A30", "#378ADD", "#BA7517", "#888780", "#1D9E75", "#7F77DD", "#EF9F27", "#0E7490", "#E24B4A", "#F2706F"].map((h) => h.toLowerCase()));
    for (const hex of Object.values(ROAD_AUTHORITY_COLORS)) expect(locked.has(String(hex).toLowerCase())).toBe(false);
    expect(ROAD_AUTHORITY_LEGEND.find((l) => l.label === "Unknown").dash).toBe(true);
  });
});

describe("identifyRoadAuthority frontage — per-road merge + ordering (B94)", () => {
  it("merges same-named segments into one row, longest frontage first", async () => {
    const ring = [[-95.0, 29.0], [-95.0, 29.002], [-94.997, 29.002], [-94.997, 29.0]];
    // Greens Rd in 3 inventory segments (short) + a state highway frontage (longest).
    const seg = (lat0, lat1) => ({ paths: [[[-95.0, lat0], [-95.0, lat1]]] });
    const fetchJson = fakeFetch({
      [ROAD]: () => [
        { attributes: { RIA_RTE_ID: "g1", STE_NAM: "GREENS RD", HSYS: "LS", RDWAY_MAINT_AGCY: 4, F_SYSTEM: 4 }, geometry: seg(29.0, 29.0003) },
        { attributes: { RIA_RTE_ID: "g2", STE_NAM: "GREENS RD", HSYS: "LS", RDWAY_MAINT_AGCY: 4, F_SYSTEM: 4 }, geometry: seg(29.0003, 29.0006) },
        { attributes: { RIA_RTE_ID: "g3", STE_NAM: "GREENS  RD", HSYS: "LS", RDWAY_MAINT_AGCY: 4, F_SYSTEM: 4 }, geometry: seg(29.0006, 29.0009) },
        { attributes: { RIA_RTE_ID: "h1", HWY: "IH0045", HSYS: "IH", RDWAY_MAINT_AGCY: 1, F_SYSTEM: 1 }, geometry: seg(29.0, 29.0020) },
      ],
    });
    const out = await identifyRoadAuthority(-94.999, 29.001, { ring, cache: freshCache(), fetchJson });
    expect(out.roads.length).toBe(2); // 3 Greens Rd segments collapsed to one
    expect(out.roads[0].name).toBe("IH 45"); // longest abutment first
    expect(out.roads[0].authority.label).toBe("State (TxDOT)");
    expect(out.roads[1].name).toBe("Greens Rd");
    expect(out.roads[1].authority.label).toBe("City");
    expect(out.authorities.sort()).toEqual(["City", "State (TxDOT)"]);
  });
  it("an unclassifiable segment carries an explicit Unknown authority (never a guess)", async () => {
    const ring = [[-95.0, 29.0], [-95.0, 29.001], [-94.999, 29.001], [-94.999, 29.0]];
    const fetchJson = fakeFetch({
      [ROAD]: () => [
        { attributes: { RIA_RTE_ID: "x1", STE_NAM: "MYSTERY LN", HSYS: "ZZ", RDWAY_MAINT_AGCY: 999 }, geometry: { paths: [[[-95.0, 29.0], [-95.0, 29.0005]]] } },
      ],
    });
    const out = await identifyRoadAuthority(-94.9995, 29.0005, { ring, cache: freshCache(), fetchJson });
    expect(out.roads[0].name).toBe("Mystery Ln");
    expect(out.roads[0].authority.label).toBe("Unknown");
  });
});

describe("formatJurisdictionBadge (B763) — the passive active-parcel badge", () => {
  it("in a city → 'City of X · Y County'", () => {
    const b = formatJurisdictionBadge({ city: ["Houston"], etj: [], county: ["Harris"], straddle: false });
    expect(b.text).toBe("City of Houston · Harris County");
    expect(b.straddle).toBe(false);
  });

  it("in an ETJ (no city) → 'City of X — ETJ · Y County'", () => {
    const b = formatJurisdictionBadge({ city: [], etj: ["Baytown"], county: ["Harris"], unincorporated: true });
    expect(b.text).toBe("City of Baytown — ETJ · Harris County");
  });

  it("neither city nor ETJ → 'Unincorporated · Y County'", () => {
    const b = formatJurisdictionBadge({ city: [], etj: [], county: ["Waller"], unincorporated: true });
    expect(b.text).toBe("Unincorporated · Waller County");
  });

  it("straddle lists BOTH cities and flags straddle", () => {
    const b = formatJurisdictionBadge({ city: ["Houston", "Katy"], etj: [], county: ["Harris"], straddle: true });
    expect(b.text).toBe("City of Houston / City of Katy · Harris County");
    expect(b.straddle).toBe(true);
  });

  it("drops an ETJ name already covered by a matched city (limit straddle reads once)", () => {
    const b = formatJurisdictionBadge({ city: ["Houston"], etj: ["Houston"], county: ["Harris"], straddle: true });
    expect(b.text).toBe("City of Houston · Harris County");
  });

  it("straddling two counties lists both", () => {
    const b = formatJurisdictionBadge({ city: [], etj: [], county: ["Harris", "Fort Bend"], straddle: true });
    expect(b.text).toBe("Unincorporated · Harris County / Fort Bend County");
  });

  it("appends the ISD from the identify result (B764: j.isd)", () => {
    const b = formatJurisdictionBadge({ city: [], etj: ["Baytown"], county: ["Harris"], isd: ["Goose Creek Consolidated ISD"] });
    expect(b.text).toBe("City of Baytown — ETJ · Harris County · Goose Creek Consolidated ISD");
    expect(b.isd).toBe("Goose Creek Consolidated ISD");
  });
  it("an explicit opts.isd overrides the result's ISD", () => {
    const b = formatJurisdictionBadge({ city: [], etj: ["Baytown"], county: ["Harris"], isd: ["A ISD"] }, { isd: "B ISD" });
    expect(b.text).toBe("City of Baytown — ETJ · Harris County · B ISD");
  });
  it("lists both districts when a parcel straddles two ISDs", () => {
    const b = formatJurisdictionBadge({ city: ["Houston"], etj: [], county: ["Harris"], isd: ["Houston ISD", "Aldine ISD"], straddle: true });
    expect(b.text).toBe("City of Houston · Harris County · Houston ISD / Aldine ISD");
    expect(b.straddle).toBe(true);
  });

  it("returns null for a missing result (failed identify → no badge)", () => {
    expect(formatJurisdictionBadge(null)).toBe(null);
  });

  it("no county known → just the jurisdiction part", () => {
    const b = formatJurisdictionBadge({ city: ["Houston"], etj: [], county: [] });
    expect(b.text).toBe("City of Houston");
    expect(b.county).toBe(null);
  });
});
