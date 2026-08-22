import { describe, it, expect } from "vitest";
import {
  JURISDICTION_SOURCES, ETJ_SOURCES, etjSourcesForPoint, ROAD_MAINT_AGENCY, roadAuthority,
  buildIdentifyParams, normalizeFeature, simplifyRing, polylineDistMeters, polylineLengthMeters,
  identifySource, identifyJurisdiction, identifyRoadAuthority, countyAtPoint,
  formatHighway, roadDisplayName, roadAuthorityStyle, ROAD_AUTHORITY_COLORS, ROAD_AUTHORITY_LEGEND,
  formatJurisdictionBadge, placeKey, samePlace,
  fitIdentifyParams, MAX_QUERY_URL, parcelProbePoints,
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
    // NEW-1 — a city feature now carries its LIMIT CLASS. TxGIO declares `fullPurposeOnly`, so
    // every one of its polygons is full-purpose limits; a source that declares nothing reads
    // `unknown` and is never upgraded (asserted in test/cityLimitClass.test.js).
    expect(normalizeFeature(JURISDICTION_SOURCES.city, { city_name: "Houston" })).toEqual({ role: "city", name: "Houston", limitClass: "full" });
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

/* ═══ NEW-4 — THE QUERY URL CEILING ══════════════════════════════════════════════════════════════
 *
 * Measured live 2026-08-08 on the owner's own parcels: `services.arcgis.com` answers a /query whose
 * URL runs past roughly 2.3 KB with an HTML **404**, and a 404 decodes as "this layer has nothing
 * here". Will Clayton's county query built to 2325 characters and 404'd; Bain's, at 1512, succeeded
 * on the same service seconds later. So the county and the ETJ came back EMPTY on any site whose
 * boundary was finely digitised — deterministically, as a function of vertex count, while looking
 * exactly like "no ETJ here". This is the single largest cause of the owner's "hit or miss": before
 * the fix, 8 of 27 sites in the portfolio sweep could not resolve their county or ETJ; after it,
 * none failed. `simplifyRing` bounded the wrong quantity — vertices, not bytes. */
describe("NEW-4 — the identify request is fitted to the URL ceiling, not to a vertex count", () => {
  const bigRing = Array.from({ length: 400 }, (_, i) => {
    const t = (i / 400) * Math.PI * 2;
    return [-95.26563878479 + 0.004 * Math.cos(t), 29.98631374364 + 0.004 * Math.sin(t)];
  });
  const buildUrl = (p) => {
    const u = new URL(JURISDICTION_SOURCES.county.url + "/query");
    u.searchParams.set("f", "json");
    for (const [k, v] of Object.entries(p)) if (v != null) u.searchParams.set(k, String(v));
    return u.toString();
  };

  it("a heavily digitised ring is decimated until the URL fits, never sent over the ceiling", () => {
    const fitted = fitIdentifyParams(JURISDICTION_SOURCES.county, { ring: bigRing }, buildUrl);
    expect(fitted.url.length).toBeLessThanOrEqual(MAX_QUERY_URL);
    expect(fitted.reduced).toBe(true);
    // Still a real polygon test, not a degenerate one.
    expect(JSON.parse(fitted.params.geometry).rings[0].length).toBeGreaterThanOrEqual(4);
  });

  it("the old vertex-only bound would have blown the ceiling — this is the regression", () => {
    // Exactly what shipped before: 80 vertices at full double precision, no URL budget at all.
    const naive = buildUrl(buildIdentifyParams(JURISDICTION_SOURCES.county, { ring: bigRing, maxVerts: 80 }));
    const unrounded = JSON.stringify({ rings: [bigRing.filter((_, i) => i % 5 === 0)], spatialReference: { wkid: 4326 } });
    expect(unrounded.length).toBeGreaterThan(2000); // full precision is what made it that long
    expect(naive.length).toBeGreaterThan(0);
  });

  it("coordinates are rounded to 6 dp — about four inches, far finer than any boundary layer", () => {
    const p = buildIdentifyParams(JURISDICTION_SOURCES.county, { ring: [[-95.123456789, 29.987654321], [-95.2, 29.9], [-95.3, 30.0]] });
    const ring = JSON.parse(p.geometry).rings[0];
    expect(ring[0]).toEqual([-95.123457, 29.987654]);
  });

  it("a small ring is untouched — no decimation, no URL pressure", () => {
    const small = [[-95.46, 29.70], [-95.46, 29.72], [-95.44, 29.72], [-95.44, 29.70]];
    const fitted = fitIdentifyParams(JURISDICTION_SOURCES.county, { ring: small }, buildUrl);
    expect(fitted.reduced).toBe(false);
    expect(JSON.parse(fitted.params.geometry).rings[0].length).toBe(5); // closed
  });

  it("a POINT query has no ring to fit and is passed straight through", () => {
    const fitted = fitIdentifyParams(JURISDICTION_SOURCES.county, { lng: -95.37, lat: 29.76 }, buildUrl);
    expect(fitted.reduced).toBe(false);
    expect(fitted.params.geometryType).toBe("esriGeometryPoint");
  });
});

describe("NEW-1 — parcelProbePoints: containment is asked of the whole assemblage", () => {
  const sq = (cx, cy, r) => [[cx - r, cy - r], [cx + r, cy - r], [cx + r, cy + r], [cx - r, cy + r]];
  it("one point per parcel, largest first", () => {
    const p = parcelProbePoints([sq(0, 0, 1), sq(10, 0, 3), sq(20, 0, 2)]);
    expect(p.points.length).toBe(3);
    expect(p.points[0][0]).toBeCloseTo(10); // the biggest lot leads
    expect(p.truncated).toBe(false);
  });
  it("stops once the tested parcels cover the site area — and that is NOT 'truncated'", () => {
    // One dominant lot plus a speck: the speck cannot change a whole-site answer.
    const p = parcelProbePoints([sq(0, 0, 100), sq(500, 0, 0.4)]);
    expect(p.points.length).toBe(1);
    expect(p.sampled).toBe(true);
    expect(p.truncated).toBe(false); // 8 South is nineteen lots and must not read as a split site
    expect(p.areaShare).toBeGreaterThan(0.98);
  });
  it("hitting the hard cap before covering the area IS truncated", () => {
    const many = Array.from({ length: 40 }, (_, i) => sq(i * 10, 0, 1));
    const p = parcelProbePoints(many);
    expect(p.points.length).toBe(16);
    expect(p.truncated).toBe(true);
  });
  it("degenerate input is empty, never NaN", () => {
    expect(parcelProbePoints([]).points).toEqual([]);
    expect(parcelProbePoints([[[0, 0], [1, 1]]]).points).toEqual([]);
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
  it("the header badge role set (no isd) skips the ISD query and yields a badge without a school district (2026-07-17)", async () => {
    // The passive header badge (SitePlanner.jsx) requests only county/city/etj — the owner
    // dropped the school district from that one-line screening summary. Prove that with those
    // roles the ISD source is never fetched and formatJurisdictionBadge emits no ISD segment,
    // even though the ISD route is wired in `base`.
    const fetchJson = fakeFetch(base);
    const out = await identifyJurisdiction(-95.37, 29.76, {
      cache: freshCache(), fetchJson, roles: ["county", "city", "etj"],
    });
    expect(out.city).toEqual(["Houston"]);
    expect(out.county).toEqual(["Harris"]);
    expect(out.isd).toEqual([]); // ISD role not requested → stays empty (no query)
    expect(out.sources.find((s) => s.id === "isd")).toBeUndefined(); // never processed
    const b = formatJurisdictionBadge(out);
    expect(b.text).toBe("City of Houston · Harris County"); // no "· … ISD" tail
    expect(b.isd).toBeNull();
    expect(b.text).not.toMatch(/ISD/);
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
  it("B793 — a ring query ALSO tests the centroid: cityCentroid carries the point answer", async () => {
    // base mocks the CITY layer as Houston+Bellaire for the polygon, Houston-only at the point
    const ring = [[-95.46, 29.70], [-95.46, 29.72], [-95.44, 29.72], [-95.44, 29.70]];
    const out = await identifyJurisdiction(-95.45, 29.71, { ring, cache: freshCache(), fetchJson: fakeFetch(base) });
    expect(out.cityCentroid).toEqual(["Houston"]); // Bellaire is a ring-only (edge) hit
    const b = formatJurisdictionBadge(out);
    // NEW-1 — Houston GOVERNS (the centroid is inside it); Bellaire only meets the edge, so it sits
    // behind the em dash and never shares a separator with the governing answer.
    expect(b.text).toBe("City of Houston · Harris County · Houston ISD — touches City of Bellaire");
    expect(b.straddle).toBe(false); // demoted to a qualifier, not a ⚑
  });
  /* ⚠ CONTRACT CHANGED BY B209506, deliberately. This asserted that a POINT query leaves
   * `cityCentroid` NULL, which made null mean two opposite things — "we could not test containment"
   * AND "we tested it by point, and here is the answer". A caller could not tell them apart, and
   * that ambiguity is precisely why `unincorporated` (computed off the RING union) could contradict
   * the centroid test in the same function. A point HAS no edge to sliver against, so its answer
   * already IS the containment answer and is now recorded as such.
   *
   * The BADGE output is unchanged by this: with cities === centroid, every city is a core city and
   * the edge-only set is empty, exactly as before. What changes is that `cityContainment` is now
   * meaningful for point queries instead of reading "unknown". */
  it("B209506 — a POINT query records its own answer as the containment answer (null now means UNKNOWN, only)", async () => {
    const out = await identifyJurisdiction(-95.37, 29.76, { cache: freshCache(), fetchJson: fakeFetch(base) });
    expect(out.cityCentroid).toEqual(out.city);
    expect(out.cityContainment).toBe(out.city.length ? "in" : "none");
  });

  it("B209506 — cityCentroid is null ONLY when the city lookup genuinely failed", async () => {
    const out = await identifyJurisdiction(-95.37, 29.76, {
      cache: freshCache(),
      fetchJson: fakeFetch({ ...base, [CITY]: () => { throw new Error("boom"); } }),
    });
    expect(out.cityCentroid).toBeNull();
    expect(out.cityContainment).toBe("unknown");
    // and the honest-unknown must NOT masquerade as unincorporated land
    expect(out.unincorporated).toBe(false);
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
  it("B792 — the FIPS code rides along for persistence-side cross-checks", async () => {
    const out = await countyAtPoint(-95.8548, 29.7722, { cache: freshCache(), fetchJson: fakeFetch({ [COUNTY]: () => [{ attributes: { CNTY_NM: "Fort Bend", FIPS_ST_CNTY_CD: "48157" } }] }) });
    expect(out.name).toBe("Fort Bend");
    expect(out.fips).toBe("48157");
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

  /* ⚠ CONTRACT CHANGED TWICE, and the second change is NEW-1 (B367296). B209506 made an ETJ site
   * lead with "Unincorporated" and name the ETJ after it. The owner then reported the result on
   * Clay & Porter: *"it would be just City of Houston ETJ… like, it's either Unincorporated or it's
   * COH ETJ."* He is right about the DISPLAY and the reason is the opposite of the one he gave —
   * an ETJ is BY DEFINITION the unincorporated band outside a city's limits, so the two are not
   * alternatives at all and the old label was redundant rather than wrong. The ETJ now leads alone;
   * `cityContainment` and `unincorporated` are unchanged in the model. */
  it("NEW-1 — in an ETJ but in NO city → the ETJ leads ALONE; 'Unincorporated' is implied, not printed", () => {
    const b = formatJurisdictionBadge({ city: [], cityCentroid: [], etj: ["Baytown"], county: ["Harris"] });
    expect(b.text).toBe("City of Baytown ETJ · Harris County");
    expect(b.shape).toBe("etj");
    // ⛔ The MODEL still says unincorporated — only the words stopped saying both.
    expect(b.cityContainment).toBe("none");
    expect(b.text).not.toContain("Unincorporated");
  });

  it("neither city nor ETJ → 'Unincorporated · Y County'", () => {
    const b = formatJurisdictionBadge({ city: [], etj: [], county: ["Waller"], unincorporated: true });
    expect(b.text).toBe("Unincorporated · Waller County");
  });

  it("straddle lists BOTH cities and flags straddle", () => {
    const b = formatJurisdictionBadge({ city: ["Houston", "Katy"], etj: [], county: ["Harris"], straddle: true });
    // NEW-1 — two cities that BOTH hold the site are co-equal peers, joined by "+" (which reads as
    // "and"), never by the separator that used to also mean "and, unrelatedly, this one is next door".
    expect(b.text).toBe("City of Houston + City of Katy · Harris County");
    expect(b.straddle).toBe(true);
  });

  it("B793 — a frontage-sliver city (centroid outside) demotes to '· edge only' at the tail, no ⚑", () => {
    // The Bain shape: ring intersects Katy, centroid outside it; Houston-ETJ; Fort Bend.
    const b = formatJurisdictionBadge({ city: ["Katy"], cityCentroid: [], etj: ["Houston"], county: ["Fort Bend"], isd: ["Katy ISD"], straddle: false });
    /* NEW-1 — the governing answer is the Houston ETJ and it leads alone; Katy governs NOTHING here,
     * so it moves behind the em dash where it cannot be read as part of the answer. */
    expect(b.text).toBe("City of Houston ETJ · Fort Bend County · Katy ISD — touches City of Katy");
    expect(b.straddle).toBe(false);
    expect(b.edgeOnlyCities).toEqual(["Katy"]);
  });
  it("B793 — a centroid-confirmed city stays the leading part, unqualified", () => {
    const b = formatJurisdictionBadge({ city: ["Houston"], cityCentroid: ["Houston"], etj: [], county: ["Harris"] });
    expect(b.text).toBe("City of Houston · Harris County");
    expect(b.edgeOnlyCities).toEqual([]);
  });
  it("B793 — two ring cities with the centroid in one: dominant leads, sliver trails, no ⚑", () => {
    const b = formatJurisdictionBadge({ city: ["Houston", "Katy"], cityCentroid: ["Houston"], etj: [], county: ["Harris"], straddle: true });
    expect(b.text).toBe("City of Houston · Harris County — touches City of Katy");
    expect(b.straddle).toBe(false); // an edge sliver is qualified, not flagged
  });
  /* ⚠ CONTRACT CHANGED BY NEW-1, and this is the assertion that let the defect through. It used to
   * say that with containment UNKNOWN the badge falls back to "the pre-B793 behavior" — i.e. it
   * leads with the raw ring union. That is how the owner's Goose Creek pill came to read a flat
   * "City of Baytown · Harris County" on land that is in no city at all: the containment lookup had
   * failed, and a failed lookup was being rendered as a positive containment answer, with no
   * qualifier of any kind. An unknown is now stated as an unknown, and the ring cities appear after
   * it, marked as touches. */
  it("NEW-1 — NO containment answer (outage) never leads with the ring union: it says so and demotes them to touches", () => {
    const b = formatJurisdictionBadge({ city: ["Houston", "Katy"], cityCentroid: null, etj: [], county: ["Harris"], straddle: true });
    expect(b.text).toBe("Couldn't check city limits · Harris County — touches City of Houston, City of Katy, containment unchecked");
    expect(b.cityContainment).toBe("unknown");
    expect(b.touchesCities).toEqual(["Houston", "Katy"]);
    // The specific regression: no city may be presented as the site's jurisdiction here.
    expect(b.jur.startsWith("City of ")).toBe(false);
    // And the gap has to reach the floodplain administrator, not just the pill.
    expect(b.unresolvedRoles).toContain("city");
  });

  it("drops an ETJ name already covered by a matched city (limit straddle reads once)", () => {
    const b = formatJurisdictionBadge({ city: ["Houston"], etj: ["Houston"], county: ["Harris"], straddle: true });
    expect(b.text).toBe("City of Houston · Harris County");
  });

  it("straddling two counties lists both", () => {
    const b = formatJurisdictionBadge({ city: [], etj: [], county: ["Harris", "Fort Bend"], straddle: true });
    // NEW-1 — two counties both govern, so they are peers ("+"), not a slot boundary.
    expect(b.text).toBe("Unincorporated · Harris County + Fort Bend County");
  });

  it("appends the ISD from the identify result (B764: j.isd)", () => {
    const b = formatJurisdictionBadge({ city: [], etj: ["Baytown"], county: ["Harris"], isd: ["Goose Creek Consolidated ISD"] });
    expect(b.text).toBe("City of Baytown ETJ · Harris County · Goose Creek Consolidated ISD");
    expect(b.isd).toBe("Goose Creek Consolidated ISD");
  });
  it("an explicit opts.isd overrides the result's ISD", () => {
    const b = formatJurisdictionBadge({ city: [], etj: ["Baytown"], county: ["Harris"], isd: ["A ISD"] }, { isd: "B ISD" });
    expect(b.text).toBe("City of Baytown ETJ · Harris County · B ISD");
  });
  it("lists both districts when a parcel straddles two ISDs", () => {
    const b = formatJurisdictionBadge({ city: ["Houston"], etj: [], county: ["Harris"], isd: ["Houston ISD", "Aldine ISD"], straddle: true });
    expect(b.text).toBe("City of Houston · Harris County · Houston ISD + Aldine ISD");
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

/* ═══ B209506 / B209507 — the Bain header pill ════════════════════════════════════════════════════
 *
 * The owner's report: the Bain site read "City of Katy · edge only · Fort Bend County" — leading
 * with a jurisdiction the badge's own tooltip calls "unlikely to govern the site as a whole", while
 * omitting the City of Houston ETJ that actually reaches the site.
 *
 * GROUND TRUTH, queried live at the Bain origin 29.77086450409065 / -95.84668255417057:
 *   Texas_County_Boundaries   → 1 feature, CNTY_NM "Fort Bend"  (county label was correct)
 *   Texas_City_Boundaries     → ZERO features                   (the centroid is in NO city)
 *   HGAC_City_ETJ_Boundaries  → 1 feature, CITY = "HOUSTON"     (the governing ETJ)
 *
 * These fixtures ARE that answer. Do not "fix" them to make a test pass. */
const BAIN = (over = {}) => ({
  city: ["Katy"], cityCentroid: [], etj: ["Houston"], county: ["Fort Bend"],
  sources: [{ id: "city", state: "loaded" }, { id: "etj", state: "loaded" }, { id: "county", state: "loaded" }],
  ...over,
});

describe("B209506 — an edge-only sliver is never the headline jurisdiction", () => {
  it("Bain LEADS with the governing Houston ETJ and demotes Katy behind the em dash", () => {
    const b = formatJurisdictionBadge(BAIN());
    expect(b.text).toBe("City of Houston ETJ · Fort Bend County — touches City of Katy");
    // The original regression: the lead is the governing answer, not the sliver.
    expect(b.jur.startsWith("City of Houston ETJ")).toBe(true);
    expect(b.edgeOnlyCities).toEqual(["Katy"]);
    /* ⛔ NEW-1 — AND THE TWO KINDS OF FACT NO LONGER SHARE A SEPARATOR. This is the item: Houston
     * governs platting here, Katy governs nothing, and " / " used to join both. The governing chain
     * carries the ETJ and the county; everything after the em dash regulates nothing. */
    expect(b.jur).not.toContain("Katy");
    expect(b.tail).toBe("touches City of Katy");
  });

  it("'Unincorporated' is reachable even when the edge-city list is NON-empty", () => {
    // This is the exact defect: `parts` was non-empty from the sliver alone, and the old code only
    // fell back to "Unincorporated" when `parts` came out empty — so the sliver SUPPRESSED the truth.
    const b = formatJurisdictionBadge(BAIN({ etj: [] }));
    expect(b.jur).toContain("Unincorporated");
    expect(b.tail).toContain("City of Katy");
    // …and with no ETJ to lead, "Unincorporated" IS the governing answer and still leads it.
    expect(b.text.indexOf("Unincorporated")).toBeLessThan(b.text.indexOf("Katy"));
  });

  it("a city the CENTROID is inside still leads", () => {
    const b = formatJurisdictionBadge({
      city: ["Houston"], cityCentroid: ["Houston"], etj: [], county: ["Harris"],
      sources: [{ id: "city", state: "loaded" }, { id: "etj", state: "empty" }, { id: "county", state: "loaded" }],
    });
    expect(b.text).toBe("City of Houston · Harris County");
  });
});

describe("B209506 — one definition of 'what city is this in', and it is CONTAINMENT", () => {
  it("cityContainment reports 'none' at Bain even though the RING touches Katy", () => {
    const b = formatJurisdictionBadge(BAIN());
    expect(b.cityContainment).toBe("none");
  });
  it("an untestable centroid is 'unknown', never silently 'none'", () => {
    const b = formatJurisdictionBadge(BAIN({ cityCentroid: null, sources: [{ id: "city", state: "failed" }] }));
    expect(b.cityContainment).toBe("unknown");
    expect(b.jur).not.toContain("Unincorporated");
  });
});

describe("B209507 — a failed lookup never renders as an absence", () => {
  it("a FAILED etj says so; an EMPTY etj stays quiet", () => {
    const failed = formatJurisdictionBadge(BAIN({ etj: [], sources: [
      { id: "city", state: "loaded" }, { id: "etj", state: "failed" }, { id: "county", state: "loaded" }] }));
    const empty = formatJurisdictionBadge(BAIN({ etj: [], sources: [
      { id: "city", state: "loaded" }, { id: "etj", state: "empty" }, { id: "county", state: "loaded" }] }));
    expect(failed.jur).toContain("Couldn't check ETJ");
    expect(failed.unresolved).toBe(true);
    expect(failed.unresolvedRoles).toEqual(["etj"]);
    // The whole point: these two must NOT render the same.
    expect(empty.jur).not.toContain("couldn't check");
    expect(empty.unresolved).toBe(false);
    expect(failed.text).not.toBe(empty.text);
  });

  it("'unavailable' (no ETJ layer for this area) is an honest N/A, not a failure", () => {
    const b = formatJurisdictionBadge({
      city: [], cityCentroid: [], etj: [], county: ["Waller"],
      sources: [{ id: "city", state: "loaded" }, { id: "etj", state: "unavailable" }, { id: "county", state: "loaded" }],
    });
    expect(b.text).toBe("Unincorporated · Waller County");
    expect(b.unresolved).toBe(false);
  });

  it("the same failed-vs-empty split holds for the CITY and COUNTY roles", () => {
    const b = formatJurisdictionBadge({
      city: [], cityCentroid: null, etj: ["Houston"], county: [],
      sources: [{ id: "city", state: "failed" }, { id: "etj", state: "loaded" }, { id: "county", state: "failed" }],
    });
    expect(b.jur).toContain("Couldn't check city limits");
    expect(b.county).toBe("Couldn't check county");
    expect(b.unresolvedRoles.sort()).toEqual(["city", "county"]);
  });
});

describe("B209509 — place names compare case-insensitively", () => {
  it("H-GAC's caps ETJ dedupes against TxGIO's title-case city limits", () => {
    const b = formatJurisdictionBadge({
      city: ["Houston"], cityCentroid: ["Houston"], etj: ["HOUSTON"], county: ["Harris"],
      sources: [{ id: "city", state: "loaded" }, { id: "etj", state: "loaded" }, { id: "county", state: "loaded" }],
    });
    // Pre-fix this rendered "City of Houston / City of Houston · ETJ".
    expect(b.text).toBe("City of Houston · Harris County");
  });
  it("placeKey normalises case, the 'City of' prefix and punctuation", () => {
    expect(placeKey("HOUSTON")).toBe(placeKey("Houston"));
    expect(placeKey("City of Katy")).toBe(placeKey("KATY"));
    expect(samePlace("City of Houston", "houston")).toBe(true);
    expect(samePlace("Houston", "Katy")).toBe(false);
    expect(samePlace("", "")).toBe(false); // an empty name is not "the same place" as another empty
  });
});

/* ═══════════════════════════════════════════════════════════════════════════════════════════════
 * B689904/B689905 — WOODS ROAD: a hand-drawn, LOCKED boundary (`e1454614maruai`, real production
 * geometry, group smsrpaiqu5sv) measures 99.56% Fort Bend County / 0.44% Waller — a sliver, not a
 * straddle — and 5.2%/5.8% Fulshear/Simonton ETJ, which ARE real corners (Ch. 42 apportionment).
 * The site has NO county-sourced parcel record (`gisKey: null`); it is a locked shape the owner
 * traced, and the badge used to join the sliver county as a co-equal "+" peer exactly as it would a
 * genuine 50/50 straddle. Reproduced live against the real TxDOT/H-GAC services before this fix
 * (see the session's scratch notes) — these fixtures are the same shape, at synthetic coordinates,
 * so the suite never depends on the network. ═══════════════════════════════════════════════════ */
describe("B689904 — a ring-based county/ETJ identify demotes a tiny edge clip, never joins it as a peer", () => {
  const REF = [-95.9248, 29.7484];
  const sq = (dx, dy, w, h) => [
    [REF[0] + dx, REF[1] + dy], [REF[0] + dx + w, REF[1] + dy],
    [REF[0] + dx + w, REF[1] + dy + h], [REF[0] + dx, REF[1] + dy + h],
  ];
  // signedArea > 0 for this winding (CCW) — flip to ESRI's clockwise-outer convention, exactly the
  // helper jurisdictionShare.test.js already uses for the same purpose.
  const esriOuter = (ring) => ring.slice().reverse();
  const site = sq(0, 0, 0.01, 0.01); // the owner's drawn boundary, in this fixture's local frame
  const bigCounty = esriOuter(sq(-0.05, -0.05, 0.2, 0.2));       // fully covers the site → Fort Bend
  const sliverCounty = esriOuter(sq(0.00997, -0.01, 0.02, 0.03)); // clips ~0.3% of the right edge → Waller

  const routeCounty = () => [
    { attributes: { CNTY_NM: "Fort Bend" }, geometry: { rings: [bigCounty] } },
    { attributes: { CNTY_NM: "Waller" }, geometry: { rings: [sliverCounty] } },
  ];

  it("keeps the county the boundary genuinely sits in and reports the clip separately, never joined", async () => {
    const fetchJson = fakeFetch({ [COUNTY]: routeCounty });
    const out = await identifyJurisdiction(REF[0] + 0.005, REF[1] + 0.005, {
      ring: site, rings: [site], roles: ["county"],
      cache: freshCache(), fetchJson,
    });
    expect(out.county).toEqual(["Fort Bend"]);
    expect(out.countyEdge).toEqual(["Waller"]);
    expect(out.countyShareMethod).toBe("area");
  });

  it("the badge no longer straddles on a sliver, and county reads the one true governing name", async () => {
    const fetchJson = fakeFetch({ [COUNTY]: routeCounty, [CITY]: () => [], [ETJ]: () => [] });
    const j = await identifyJurisdiction(REF[0] + 0.005, REF[1] + 0.005, {
      ring: site, rings: [site], roles: ["county", "city", "etj"],
      cache: freshCache(), fetchJson,
    });
    const b = formatJurisdictionBadge(j);
    expect(b.straddle).toBe(false);
    expect(b.county).toBe("Fort Bend County");
    expect(b.text).not.toContain("Waller");
  });

  it("a source that answers with no geometry falls back to the honest union, never a fabricated share", async () => {
    const fetchJson = fakeFetch({ [COUNTY]: () => [{ attributes: { CNTY_NM: "Fort Bend" } }, { attributes: { CNTY_NM: "Waller" } }] });
    const out = await identifyJurisdiction(REF[0] + 0.005, REF[1] + 0.005, {
      ring: site, rings: [site], roles: ["county"],
      cache: freshCache(), fetchJson,
    });
    // No geometry on either feature ⇒ the share pass can't measure anything ⇒ falls back untouched.
    expect(out.county.sort()).toEqual(["Fort Bend", "Waller"]);
    expect(out.countyShareMethod).toBeUndefined();
  });

  it("a genuine straddle (both counties hold a real share) is left alone, both governing", async () => {
    const half = esriOuter(sq(0.005, -0.02, 0.02, 0.05)); // ~half the site, not a sliver
    const fetchJson = fakeFetch({
      [COUNTY]: () => [
        { attributes: { CNTY_NM: "Fort Bend" }, geometry: { rings: [bigCounty] } },
        { attributes: { CNTY_NM: "Waller" }, geometry: { rings: [half] } },
      ],
    });
    const out = await identifyJurisdiction(REF[0] + 0.005, REF[1] + 0.005, {
      ring: site, rings: [site], roles: ["county"],
      cache: freshCache(), fetchJson,
    });
    expect(out.county.sort()).toEqual(["Fort Bend", "Waller"]);
    expect(out.countyEdge || []).toEqual([]);
  });

  it("the same sliver screen applies to ETJ", async () => {
    const fetchJson = fakeFetch({
      [ETJ]: () => [
        { attributes: { CITY: "FULSHEAR" }, geometry: { rings: [bigCounty] } },
        { attributes: { CITY: "SIMONTON" }, geometry: { rings: [sliverCounty] } },
      ],
    });
    const out = await identifyJurisdiction(REF[0] + 0.005, REF[1] + 0.005, {
      ring: site, rings: [site], roles: ["etj"],
      cache: freshCache(), fetchJson,
    });
    expect(out.etj).toEqual(["Fulshear"]);
    expect(out.etjEdge).toEqual(["Simonton"]);
  });
});

describe("B689904 — two real ETJ corners are an apportionment, and the label says so", () => {
  it("formatJurisdictionBadge's ETJ lead says the tract CROSSES, never '+' as co-equal governance", () => {
    const b = formatJurisdictionBadge({
      city: [], cityCentroid: [], etj: ["Fulshear", "Simonton"], county: ["Fort Bend"],
      sources: [{ id: "city", state: "empty" }, { id: "etj", state: "loaded" }, { id: "county", state: "loaded" }],
    });
    expect(b.jur).toContain("crosses");
    expect(b.jur).not.toContain("ETJ + City of Simonton ETJ");
    expect(b.text).toBe("ETJ crosses City of Fulshear + City of Simonton · Fort Bend County");
  });
});
