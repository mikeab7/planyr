/* NEW-1 / NEW-2 (2026-11-12) — COUNTY-PUBLISHED ETJ SOURCES: Fort Bend (fresher table + SB 2038 releases) and Harris (fallback).
 *
 * Every fixture POINT here was read live on 2026-11-12 from the county layers (Origin https://planyr.io — both hosts are CORS-clean):
 *   • (-95.85373, 29.6276)  inside Fort Bend /16 OID 14, Fulshear's 4,663.8-ac "Petition of Release from ETJ" (filed 2023-09-28).
 *       /5 → nothing · /16 → "Fulshear ETJ" · H-GAC → FULSHEAR (stale) · Harris → nothing.
 *   • (-95.93562, 29.44609) inside /16 OID 9162, Rosenberg Ordinance No 2026-16 (filed 2026-04-20). /5 → nothing · H-GAC → ROSENBERG.
 *   • (-95.9235, 29.7488)   the Fulshear cluster the weekly sweep used. /5 → FULSHEAR · H-GAC → FULSHEAR · TxGIO city → none.
 *   • (-95.05901, 29.71901) La Porte's ETJ. H-GAC → NOTHING (its roster has no La Porte) · Harris HC_Cities_ETJ → LA PORTE.
 * What is under test is what the APP does with those answers; the attribute rows are the services' real column names.
 */
import { describe, it, expect } from "vitest";
import {
  ETJ_SOURCES, CITY_SOURCES, etjSourcesForPoint, etjFallbackSourcesForPoint, etjCoverageFor, supersededSourceIds,
  identifyJurisdiction, normalizeFeature, formatJurisdictionBadge,
} from "../src/workspaces/site-planner/lib/jurisdiction.js";
import { VECTOR_SOURCES, fetchCached } from "../src/workspaces/site-planner/lib/vectorLayers.js";
import { createGisCache } from "../src/workspaces/site-planner/lib/gisCache.js";
import { GIS_SOURCES } from "../src/shared/gis/sources.js";
import { SOURCE_FIXTURES } from "../src/shared/gis/sourceFixtures.js";
import { esriPolygons, pointInPolygons } from "../src/workspaces/site-planner/lib/jurisdictionShare.js";

function makeStore() {
  const map = new Map();
  return { getItem: (k) => (map.has(k) ? map.get(k) : null), setItem: (k, v) => { map.delete(k); map.set(k, v); },
    removeItem: (k) => map.delete(k), get length() { return map.size; }, key: (i) => Array.from(map.keys())[i] ?? null };
}
const freshCache = () => createGisCache({ store: makeStore(), now: () => 1_000_000 });

// URL needles. The Fort Bend layers share one base path, so the layer index is part of the needle.
const FB = "Boundaries_Public/MapServer";
const N = {
  fbEtj: `${FB}/5/query`, fbRelease: `${FB}/16/query`, fbCity: `${FB}/4/query`, fbCounty: `${FB}/3/query`,
  hgac: "HGAC_City_ETJ", harris: "HC_Cities_ETJ", txCity: "Texas_City_Boundaries", txCounty: "Texas_County_Boundaries",
};
const attr = (a) => [{ attributes: a }];
const NONE = () => [];
/** A fake service: `routes` maps needle → () => features | throws. Anything unrouted THROWS, so an unexpected query is loud. */
function fakeFetch(routes, seen = []) {
  return async (url) => {
    seen.push(url);
    for (const [needle, respond] of Object.entries(routes)) {
      if (url.includes(needle)) { const f = respond(url); return { features: f }; }
    }
    throw new Error("no route for " + url);
  };
}
const boom = (msg = "service down") => () => { throw new Error(msg); };
const ROLES = ["county", "city", "etj"];
const run = (lng, lat, routes, seen) => identifyJurisdiction(lng, lat, { cache: freshCache(), fetchJson: fakeFetch(routes, seen), roles: ROLES });

const FULSHEAR_RELEASE = [-95.85373, 29.6276];
const ROSENBERG_REMOVAL = [-95.93562, 29.44609];
const FULSHEAR_CLUSTER = [-95.9235, 29.7488];
const LA_PORTE = [-95.05901, 29.71901];
const HOUSTON_DOWNTOWN = [-95.37, 29.76];

const fortBendCounty = () => attr({ CNTY_NM: "Fort Bend" });
const harrisCounty = () => attr({ CNTY_NM: "Harris" });

// ---------------------------------------------------------------------------------------------
describe("the registry rows exist, are routed, and read the county servers directly (no relay)", () => {
  it("each new ETJ row is a registry row on the SAME url, with fixtures", () => {
    for (const id of ["etj_fortbend", "etj_release_fortbend", "etj_harris"]) {
      const row = ETJ_SOURCES.find((s) => s.id === id);
      expect(row, id).toBeTruthy();
      expect(row.url, id).toBe(GIS_SOURCES[id].serviceUrl);
      expect(SOURCE_FIXTURES[id].fixtures.length, id).toBeGreaterThanOrEqual(1);
    }
    expect(CITY_SOURCES.find((s) => s.id === "city_fortbend").url).toBe(GIS_SOURCES.city_fortbend.serviceUrl);
  });
  it("both hosts are CORS-clean (measured): the rows carry no relay flag", () => {
    for (const id of ["etj_fortbend", "etj_release_fortbend", "etj_harris"]) expect(ETJ_SOURCES.find((s) => s.id === id).viaProxy, id).toBeFalsy();
  });
  it("a Fort Bend point routes to the county table + its release layer + H-GAC; a Houston click is still exactly one query", () => {
    const [lng, lat] = FULSHEAR_RELEASE;
    expect(etjSourcesForPoint(lat, lng).map((s) => s.id).sort()).toEqual(["etj_fortbend", "etj_hgac", "etj_release_fortbend"]);
    expect(etjSourcesForPoint(29.76, -95.37).map((s) => s.id)).toEqual(["etj_hgac"]);
  });
  it("Harris is a FALLBACK row: never routed in parallel, offered only for H-GAC, and counted as coverage (Katy is no longer 'not mapped')", () => {
    const [lng, lat] = LA_PORTE;
    expect(etjSourcesForPoint(lat, lng).map((s) => s.id)).not.toContain("etj_harris");   // (Baytown's own ring shares this box)
    expect(etjSourcesForPoint(lat, lng).map((s) => s.id)).toContain("etj_hgac");
    expect(etjFallbackSourcesForPoint(lat, lng, "etj_hgac").map((s) => s.id)).toEqual(["etj_harris"]);
    expect(etjFallbackSourcesForPoint(lat, lng, "etj_austin")).toEqual([]);
    expect(etjCoverageFor("Katy", lat, lng)).toBe("covered");     // H-GAC's roster has no Katy; Harris's does
    expect(etjCoverageFor("La Porte", lat, lng)).toBe("covered");
  });
  it("the release row's `where` keeps ETJ removals only — not a city de-annexation, not an old ordinance, not 'Expand ETJ'", () => {
    const w = ETJ_SOURCES.find((s) => s.id === "etj_release_fortbend").where;
    expect(w).toMatch(/Type = 'De-annexation'/);
    expect(w).toMatch(/City LIKE '% ETJ'/);
    expect(w).toMatch(/Filing_Date >= DATE '2020-01-01'/);
    expect(w).toMatch(/NOT LIKE '%xpand%'/);
  });
  it("a release polygon's city is the City column with ' ETJ' stripped — Fulshear, not Fort Worth", () => {
    const row = ETJ_SOURCES.find((s) => s.id === "etj_release_fortbend");
    expect(normalizeFeature(row, { City: "Fulshear ETJ" }).name).toBe("Fulshear");
    expect(normalizeFeature(row, { City: "Missouri City ETJ" }).name).toBe("Missouri City");
    expect(normalizeFeature(row, { City: "Houston ETJ" }).release).toBe(true);
  });
});

// ---------------------------------------------------------------------------------------------
describe("NEW-1 · SB 2038 releases: the county's Land Ordinances layer says RELEASED where H-GAC says Fulshear ETJ", () => {
  const routes = (over = {}) => ({
    [N.txCounty]: fortBendCounty, [N.txCity]: NONE, [N.fbCity]: NONE,
    [N.fbEtj]: NONE, [N.fbRelease]: () => attr({ City: "Fulshear ETJ" }), [N.hgac]: () => attr({ CITY: "FULSHEAR" }),
    ...over,
  });
  it("a point inside the 4,663.8-ac Fulshear release (filed 2023-09-28) reads released, with no Fulshear ETJ", async () => {
    const j = await run(...FULSHEAR_RELEASE, routes());
    expect(j.etjReleased).toEqual(["Fulshear"]);
    expect(j.etj).toEqual([]);
    expect(j.unincorporated).toBe(true);   // out of every city's limits, and no ETJ claims it
    const badge = formatJurisdictionBadge(j);
    expect(JSON.stringify(badge)).toMatch(/Fulshear/);
    expect(JSON.stringify(badge)).toMatch(/release/i);
  });
  it("Rosenberg Ordinance 2026-16 reads released", async () => {
    const j = await run(...ROSENBERG_REMOVAL, routes({ [N.fbRelease]: () => attr({ City: "Rosenberg ETJ" }), [N.hgac]: () => attr({ CITY: "ROSENBERG" }) }));
    expect(j.etjReleased).toEqual(["Rosenberg"]);
    expect(j.etj).toEqual([]);
  });
  it("RED PROOF · H-GAC alone cannot say released — it names Fulshear ETJ (the pre-change answer)", async () => {
    const j = await run(...FULSHEAR_RELEASE, routes({ [N.fbEtj]: boom(), [N.fbRelease]: boom(), [N.fbCity]: boom() }));
    expect(j.etjReleased).toEqual([]);
    expect(j.etj).toEqual(["Fulshear"]);
    expect((j.etjSourceErrors || []).sort()).toEqual(["etj_fortbend", "etj_release_fortbend"]);   // and it says the county layers were not heard
  });
  it("a point in the Fulshear ETJ but in NO release polygon is still ETJ (the Fulshear cluster)", async () => {
    const j = await run(...FULSHEAR_CLUSTER, routes({ [N.fbEtj]: () => attr({ City: "FULSHEAR" }), [N.fbRelease]: NONE }));
    expect(j.etj).toEqual(["Fulshear"]);
    expect(j.etjReleased).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------
describe("NEW-1 · the county's own ETJ table is FIRST inside Fort Bend County, H-GAC the backup (constraint #39)", () => {
  const base = (county, over = {}) => ({
    [N.txCounty]: county, [N.txCity]: NONE, [N.fbCity]: NONE, [N.fbRelease]: NONE,
    [N.fbEtj]: NONE, [N.hgac]: () => attr({ CITY: "ROSENBERG" }),
    ...over,
  });
  it("inside Fort Bend, ground the county no longer holds is NOT ETJ even though H-GAC's 2024 edition still draws it", async () => {
    const j = await run(-95.91, 29.5, base(fortBendCounty));
    expect(j.etj).toEqual([]);
    expect(j.superseded).toContain("etj_hgac");    // said, not silent
  });
  it("RED PROOF · the same answers at a HARRIS point keep H-GAC — supersession is by county, not by the box", async () => {
    const j = await run(-95.91, 29.5, base(harrisCounty));
    expect(j.etj).toEqual(["Rosenberg"]);
    expect(j.superseded || []).not.toContain("etj_hgac");
  });
  it("the county's name comes from the county layer's own answer; no county named → no supersession (the old union)", async () => {
    const j = await run(-95.91, 29.5, base(NONE));
    expect(j.etj).toEqual(["Rosenberg"]);
  });
  it("when both name an ETJ the county's spelling stands alone — one Fulshear, not two", async () => {
    const j = await run(...FULSHEAR_CLUSTER, base(fortBendCounty, { [N.fbEtj]: () => attr({ City: "FULSHEAR" }), [N.hgac]: () => attr({ CITY: "FULSHEAR" }) }));
    expect(j.etj).toEqual(["Fulshear"]);
  });
  it("a county layer that FAILS puts H-GAC straight back, and the failure is recorded", async () => {
    const j = await run(-95.91, 29.5, base(fortBendCounty, { [N.fbEtj]: boom("county server down") }));
    expect(j.etj).toEqual(["Rosenberg"]);
    expect(j.etjSourceErrors).toContain("etj_fortbend");
    expect(j.superseded || []).not.toContain("etj_hgac");
  });
  it("supersededSourceIds is pure: needs an answered superseder AND the declared county", () => {
    const srcs = [ETJ_SOURCES.find((s) => s.id === "etj_fortbend"), ETJ_SOURCES.find((s) => s.id === "etj_hgac")];
    expect([...supersededSourceIds(srcs, [{ error: null }, { error: null }], "Fort Bend")]).toEqual(["etj_hgac"]);
    expect([...supersededSourceIds(srcs, [{ error: null }, { error: null }], "Fort Bend County")]).toEqual(["etj_hgac"]);
    expect([...supersededSourceIds(srcs, [{ error: "x" }, { error: null }], "Fort Bend")]).toEqual([]);
    expect([...supersededSourceIds(srcs, [{ error: null }, { error: null }], "Harris")]).toEqual([]);
    expect([...supersededSourceIds(srcs, [{ error: null }, { error: null }], null)]).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------
describe("NEW-1 · Fort Bend's own city limits are first inside the county, TxGIO the backup", () => {
  const r = (over = {}) => ({
    [N.txCounty]: fortBendCounty, [N.txCity]: () => attr({ city_name: "Rosenberg" }), [N.fbCity]: () => attr({ CityName: "SUGAR LAND" }),
    [N.fbEtj]: NONE, [N.fbRelease]: NONE, [N.hgac]: NONE, ...over,
  });
  it("the county's layer names the city (title-cased) and the statewide layer's stale answer is dropped", async () => {
    const j = await run(-95.63, 29.6, r());
    expect(j.city).toEqual(["Sugar Land"]);
    expect(j.superseded).toContain("city");
  });
  it("the county city layer failing puts TxGIO straight back", async () => {
    const j = await run(-95.63, 29.6, r({ [N.fbCity]: boom() }));
    expect(j.city).toEqual(["Rosenberg"]);
    expect(j.citySourceErrors.map((e) => e.id)).toContain("city_fortbend");
  });
  it("at a Harris point the Fort Bend city layer, even if asked, never replaces TxGIO", async () => {
    const j = await run(-95.4, 29.76, r({ [N.txCounty]: harrisCounty, [N.txCity]: () => attr({ city_name: "Houston" }) }));
    expect(j.city).toEqual(["Houston"]);
  });
});

// ---------------------------------------------------------------------------------------------
describe("NEW-2 · Harris County's own ETJ table when H-GAC answers 0", () => {
  const h = (over = {}) => ({
    [N.txCounty]: harrisCounty, [N.txCity]: NONE, [N.hgac]: NONE, [N.harris]: () => attr({ Name: "LA PORTE" }), ...over,
  });
  it("H-GAC answers nothing at La Porte's ETJ; Harris's table resolves it", async () => {
    const j = await run(...LA_PORTE, h());
    expect(j.etj).toEqual(["La Porte"]);
    expect(j.etjFallback).toEqual(["etj_harris"]);
  });
  it("a mocked-empty H-GAC at a Harris point still resolves 'Houston ETJ' (the weekly sweep's point)", async () => {
    const j = await run(-95.75, 30.05, h({ [N.harris]: () => attr({ Name: "HOUSTON" }) }));
    expect(j.etj).toEqual(["Houston"]);
    expect(JSON.stringify(formatJurisdictionBadge(j))).toMatch(/Houston/);
  });
  it("H-GAC FAILING (its quota 429) is the same: the fallback answers, the failure stays on record", async () => {
    const j = await run(...LA_PORTE, h({ [N.hgac]: boom("429 quota") }));
    expect(j.etj).toEqual(["La Porte"]);
    expect(j.etjSourceErrors).toContain("etj_hgac");
  });
  it("RED PROOF · without the fallback H-GAC alone says 'no ETJ' here (the pre-change answer)", async () => {
    const j = await run(...LA_PORTE, h({ [N.harris]: boom() }));
    expect(j.etj).toEqual([]);
    expect(j.etjSourceErrors).toContain("etj_harris");   // and the miss is reported, not read as a finding
  });
  it("when H-GAC DOES answer, Harris is never asked — a Houston click stays one query", async () => {
    const seen = [];
    const j = await run(...HOUSTON_DOWNTOWN, h({ [N.hgac]: () => attr({ CITY: "HOUSTON" }) }), seen);
    expect(j.etj).toEqual(["Houston"]);
    expect(seen.some((u) => u.includes(N.harris))).toBe(false);
    expect(j.etjFallback).toBeUndefined();
  });
  it("both empty is still 'no ETJ' (nothing invented)", async () => {
    const j = await run(...LA_PORTE, h({ [N.harris]: NONE }));
    expect(j.etj).toEqual([]);
    expect(j.etjFallback).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------
describe("the DRAWN ETJ layer reads the same rows (the line you see is the line the screening reports)", () => {
  // Rings are ESRI outer rings (clockwise). A 0.02° square west of Rosenberg, inside Fort Bend.
  const sq = (w, s, e, n) => ({ rings: [[[w, s], [w, n], [e, n], [e, s], [w, s]]] });
  const BBOX = { w: -96.0, s: 29.4, e: -95.8, n: 29.6 };
  const COUNTY = sq(-96.05, 29.3, -95.7, 29.7);                  // the (fake) county line covers the whole view
  const HGAC_STALE = sq(-95.95, 29.45, -95.9, 29.5);            // H-GAC still draws this
  const FB_ETJ = sq(-95.88, 29.5, -95.85, 29.55);               // the county's own, smaller, edition
  const RELEASE = sq(-95.95, 29.45, -95.92, 29.48);
  const routes = ({ countyDown = false, hgac = HGAC_STALE } = {}) => (url) => {
    if (url.includes(N.fbCounty.replace("/query", ""))) { if (countyDown) throw new Error("county line down"); return { features: [{ attributes: { OBJECTID: 1 }, geometry: COUNTY }] }; }
    if (url.includes(N.fbEtj)) return { features: [{ attributes: { City: "FULSHEAR" }, geometry: FB_ETJ }] };
    if (url.includes(N.fbRelease)) return { features: [{ attributes: { City: "Fulshear ETJ" }, geometry: RELEASE }] };
    if (url.includes(N.hgac)) return { features: [{ attributes: { CITY: "ROSENBERG" }, geometry: hgac }] };
    if (url.includes(N.harris)) return { features: [] };
    if (url.includes(N.txCity)) return { features: [] };
    throw new Error("no route for " + url);
  };
  const drawn = async (fetchJson) => (await fetchCached(VECTOR_SOURCES.jur_etj, BBOX, { cache: freshCache(), fetchJson: async (u) => routes(fetchJson)(u), zoom: 15 })).data;
  const feat = (fc, label) => fc.features.filter((f) => f.properties.CITY === label);

  it("inside Fort Bend County H-GAC's polygon is cut away by the county line and the county's own polygon draws", async () => {
    const fc = await drawn({});
    expect(feat(fc, "Rosenberg")).toHaveLength(0);               // the stale polygon sat wholly inside the county line
    expect(feat(fc, "Fulshear")).toHaveLength(1);
  });
  it("the release area draws under its OWN city's name, flagged as a release", async () => {
    const fc = await drawn({});
    const rel = fc.features.filter((f) => f.properties._release);
    expect(rel).toHaveLength(1);
    expect(rel[0].properties.CITY).toBe("Fulshear ETJ release area (SB 2038)");
  });
  it("no county line → the stale polygon stays (the OLD picture, never a blank) and the miss is reported", async () => {
    const fc = await drawn({ countyDown: true });
    expect(feat(fc, "Rosenberg")).toHaveLength(1);
    expect(fc.softFailed).toContain("etj_fortbend:county-line");
  });
  it("a county-published row that fails does NOT blank the metro: H-GAC draws and the failure is on the payload", async () => {
    const fc = await fetchCached(VECTOR_SOURCES.jur_etj, BBOX, { cache: freshCache(), zoom: 15, fetchJson: async (u) => {
      if (u.includes(N.fbEtj) || u.includes(N.fbRelease) || u.includes(N.harris)) throw new Error("county server down");
      return routes({})(u);
    } }).then((r) => r.data);
    expect(feat(fc, "Rosenberg")).toHaveLength(1);
    expect(fc.softFailed).toEqual(expect.arrayContaining(["etj_fortbend", "etj_release_fortbend", "etj_harris"]));
  });
  it("sanity: the fixture squares are where the tests say (control)", () => {
    expect(pointInPolygons([-95.925, 29.475], esriPolygons(HGAC_STALE))).toBe(true);
    expect(pointInPolygons([-95.925, 29.475], esriPolygons(COUNTY))).toBe(true);
  });
});
