/* NEW-1 (2026-11-12, Mont Belvieu sweep) — Chambers County's city ETJs were invisible: H-GAC's mosaic carries no Chambers city, TxGIO's city layer answers 0 outside the limits, and Baytown's own
 * ETJ row answers 0 at Mont Belvieu — so a site at (-94.86, 29.89), inside Mont Belvieu's ETJ, read "Unincorporated — Texas counties have no zoning".
 *
 * The City of Mont Belvieu's own server (www.cmbgis.com, read through the same-origin /gis-proxy relay) publishes its ETJ (AdministrativeArea_v2 layer 1) and a COPY of its neighbours' ETJ lines
 * (layer 5, `CITY` = "BEACH CITY ETJ" / "COVE ETJ" / "OLD RIVER ETJ" / "BAYTOWN ETJ" / "DAYTON ETJ" / "LIBERTY ETJ"). What is under test is what the APP does with those answers:
 *   · the four points the brief names resolve to the right jurisdiction (limits outrank ETJ — constraint #38; an unincorporated point stays unincorporated);
 *   · the neighbours' copy reads as CITY names (suffix stripped, "Old River" → the legal "Old River-Winfree"), and only the three Chambers cities are asked for (Baytown keeps its own publisher);
 *   · the copy says it is a copy and that its date is not published (constraint #40);
 *   · both rows are relayed (never a direct call to a host whose CORS is unmeasured), routed by bbox, and do not add a request to a Houston click.
 * The recorded answers below are the shapes the sweep measured on 2026-11-01; the live re-measure through the PR preview is the item's V#. */
import { describe, it, expect } from "vitest";
import {
  ETJ_SOURCES, etjUpstreamUrl, etjSourcesForPoint, etjSourceCovers, identifyJurisdiction, formatJurisdictionBadge, buildIdentifyParams, normalizeFeature,
} from "../src/workspaces/site-planner/lib/jurisdiction.js";
import { etjNamesOf } from "../src/workspaces/site-planner/lib/etjNames.js";
import { createGisCache } from "../src/workspaces/site-planner/lib/gisCache.js";
import { VECTOR_SOURCES, fetchVectorFeatures } from "../src/workspaces/site-planner/lib/vectorLayers.js";
import { GIS_SOURCES, auditRegistry } from "../src/shared/gis/sources.js";

function makeStore() {
  const map = new Map();
  return { getItem: (k) => (map.has(k) ? map.get(k) : null), setItem: (k, v) => { map.delete(k); map.set(k, v); },
    removeItem: (k) => map.delete(k), get length() { return map.size; }, key: (i) => Array.from(map.keys())[i] ?? null };
}
const freshCache = () => createGisCache({ store: makeStore(), now: () => 1_000_000 });
const row = (id) => ETJ_SOURCES.find((s) => s.id === id);
const needleOf = (id) => new URL(etjUpstreamUrl(row(id))).pathname;
const NONE = () => [];
const attr = (a) => [{ attributes: a }];
const ETJ_ALL_EMPTY = Object.fromEntries(ETJ_SOURCES.map((s) => [needleOf(s.id), NONE]));
function fakeFetch(routes, seen = []) {
  return async (url) => {
    seen.push(url);
    for (const [needle, respond] of Object.entries(routes)) if (url.includes(needle)) return { features: respond(url) };
    throw new Error("no route for " + url);
  };
}
const ROLES = ["county", "city", "etj"];
const run = (lng, lat, routes, seen) => identifyJurisdiction(lng, lat, { cache: freshCache(), fetchJson: fakeFetch(routes, seen), roles: ROLES });
const COUNTY = { "Texas_County_Boundaries": () => attr({ CNTY_NM: "Chambers" }) };
// a TxGIO city answer carries its ring (the city role measures a share, so it needs geometry); a small square around the probe point is enough
const sq = (lng, lat, d = 0.02) => ({ rings: [[[lng - d, lat - d], [lng + d, lat - d], [lng + d, lat + d], [lng - d, lat + d], [lng - d, lat - d]]] });
const TARGA = [-94.9019, 29.8405], MB_ETJ = [-94.86, 29.89], AMERIPORT = [-94.867, 29.793], NRG_COVE = [-94.829, 29.764];

describe("the four points the brief names", () => {
  it("Targa plant → Mont Belvieu CITY (limits outrank any ETJ hit, constraint #38) — never unincorporated", async () => {
    const j = await run(TARGA[0], TARGA[1], {
      ...COUNTY, "Texas_City_Boundaries": () => [{ attributes: { city_name: "Mont Belvieu" }, geometry: sq(TARGA[0], TARGA[1]) }],
      ...ETJ_ALL_EMPTY,
    });
    expect(j.city).toEqual(["Mont Belvieu"]);
    expect(formatJurisdictionBadge(j).text).toMatch(/Mont Belvieu/);
    expect(formatJurisdictionBadge(j).text).not.toMatch(/Unincorporated/);
  });
  it("(-94.86, 29.89) → Mont Belvieu ETJ", async () => {
    const j = await run(MB_ETJ[0], MB_ETJ[1], {
      ...COUNTY, "Texas_City_Boundaries": NONE, ...ETJ_ALL_EMPTY, [needleOf("etj_montbelvieu")]: () => attr({ NAME: "MONT BELVIEU ETJ" }),
    });
    expect(j.etj).toEqual(["Mont Belvieu"]);
    expect(j.etjUnavailable).toBe(false);
    expect(formatJurisdictionBadge(j).text).toMatch(/City of Mont Belvieu ETJ/);
    expect(formatJurisdictionBadge(j).text).not.toMatch(/Unincorporated/);
  });
  it("Ameriport (-94.867, 29.793) → Baytown ETJ, from Baytown's own publisher (unchanged by this item)", async () => {
    const j = await run(AMERIPORT[0], AMERIPORT[1], {
      ...COUNTY, "Texas_City_Boundaries": NONE, ...ETJ_ALL_EMPTY, [needleOf("etj_baytown")]: () => attr({}),
    });
    expect(j.etj).toEqual(["Baytown"]);
    expect(formatJurisdictionBadge(j).text).toMatch(/City of Baytown ETJ/);
  });
  it("NRG Cove (-94.829, 29.764) → no ETJ, no city: unincorporated", async () => {
    const j = await run(NRG_COVE[0], NRG_COVE[1], { ...COUNTY, "Texas_City_Boundaries": NONE, ...ETJ_ALL_EMPTY });
    expect(j.etj).toEqual([]);
    expect(j.etjUnavailable).toBe(false);                       // every routed source ANSWERED (empty) — a real "no ETJ", not a silence
    expect(formatJurisdictionBadge(j).text).toMatch(/Unincorporated/);
  });
  it("a Chambers source that FAILS is recorded on the answer by name, not folded into 'no ETJ'", async () => {
    const boom = () => { throw new Error("cmbgis down"); };
    const j = await run(MB_ETJ[0], MB_ETJ[1], { ...COUNTY, "Texas_City_Boundaries": NONE, ...ETJ_ALL_EMPTY, [needleOf("etj_montbelvieu")]: boom });
    expect(j.etj).toEqual([]);
    expect(j.etjSourceErrors).toContain("etj_montbelvieu");        // the failure is NAMED on the answer, never folded into "no ETJ"
    // The BADGE for a failed source outside the DFW zone still reads "Unincorporated" — the statewide "no ETJ hit is not a finding" rule is the open item B1992434, deliberately not built here.
  });
});

describe("the neighbours' copy (layer 5) reads as city names, and only the three Chambers cities", () => {
  const src = () => row("etj_chambers_neighbors");
  it("strips the layer's own ' ETJ' suffix and uses the legal name for Old River-Winfree", () => {
    for (const [raw, want] of [["BEACH CITY ETJ", "Beach City"], ["COVE ETJ", "Cove"], ["OLD RIVER ETJ", "Old River-Winfree"]]) {
      expect(etjNamesOf(src(), raw), raw).toEqual([want]);
      expect(normalizeFeature(src(), { CITY: raw }).name, raw).toBe(want);
    }
  });
  it("the query filter asks for those three only — Baytown (own publisher), Dayton and Liberty are left out — on the identify AND the drawn layer", async () => {
    const where = buildIdentifyParams(src(), { lng: -94.8, lat: 29.76 }).where;
    expect(where).toBe(GIS_SOURCES.etj_chambers_neighbors.where);
    for (const wanted of ["BEACH CITY ETJ", "COVE ETJ", "OLD RIVER ETJ"]) expect(where).toContain(wanted);
    for (const out of ["BAYTOWN", "DAYTON", "LIBERTY"]) expect(where).not.toContain(out);
    const urls = [];
    await fetchVectorFeatures(VECTOR_SOURCES.jur_etj, { w: -94.95, s: 29.7, e: -94.75, n: 29.95 }, { fetchJson: async (u) => { urls.push(u); return { features: [] }; }, tier: null });
    const hit = urls.find((u) => u.includes("MapServer/5"));
    expect(hit, "the drawn layer asks the neighbours' copy").toBeTruthy();
    expect(decodeURIComponent(hit).replace(/\+/g, " ")).toContain("OLD RIVER ETJ");
    expect(decodeURIComponent(hit).replace(/\+/g, " ")).not.toContain("BAYTOWN");
  });
  it("its roster is the honest bound: the three cities are covered, Baytown / Dayton / Liberty are not claimed by this row", () => {
    for (const c of ["Beach City", "Cove", "Old River-Winfree"]) expect(etjSourceCovers(src(), c), c).toBe(true);
    for (const c of ["Baytown", "Dayton", "Liberty"]) expect(etjSourceCovers(src(), c), c).toBe(false);
  });
  it("says it is a COPY and that its date is not published (constraint #40) — no invented date", () => {
    expect(src().copy).toEqual({ publisher: "City of Mont Belvieu GIS", asOf: null });
    expect(src().sourceName).toMatch(/copy/i);
    expect(src().sourceName).toMatch(/date not published/i);
    expect(src().dataLastEdited).toBeUndefined();
    expect(GIS_SOURCES.etj_chambers_neighbors.dataLastEdited).toBeUndefined();
  });
});

describe("both rows are relayed, routed by bbox, and cost a Houston click nothing", () => {
  it("each reads the same-origin relay (the server's CORS is unmeasured) and the registry marks it relayed", () => {
    for (const [id, layer] of [["etj_montbelvieu", 1], ["etj_chambers_neighbors", 5]]) {
      expect(row(id).url).toBe(`/gis-proxy/www.cmbgis.com/arcgis/rest/services/AdministrativeArea_v2/MapServer/${layer}`);
      expect(GIS_SOURCES[id].relay).toBe(true);
      expect(GIS_SOURCES[id].serviceUrl).toBe(`https://www.cmbgis.com/arcgis/rest/services/AdministrativeArea_v2/MapServer/${layer}`);
      expect(etjUpstreamUrl(row(id))).toBe(GIS_SOURCES[id].serviceUrl);
      expect(GIS_SOURCES[id].states).toEqual(["TX"]);
    }
  });
  it("every named point is routed to the new rows; Houston, Katy and Dallas are not", () => {
    for (const [lng, lat] of [MB_ETJ, TARGA, NRG_COVE, AMERIPORT]) {
      const ids = etjSourcesForPoint(lat, lng).map((s) => s.id);
      expect(ids, `${lng},${lat}`).toContain("etj_montbelvieu");
      expect(ids, `${lng},${lat}`).toContain("etj_chambers_neighbors");
    }
    expect(etjSourcesForPoint(29.76, -95.37).map((s) => s.id)).toEqual(["etj_hgac"]);          // downtown Houston — still one query
    expect(etjSourcesForPoint(29.79, -95.82).map((s) => s.id)).toEqual(["etj_hgac"]);          // Katy
    expect(etjSourcesForPoint(32.78, -96.8).map((s) => s.id)).not.toContain("etj_montbelvieu"); // Dallas
  });
  it("the registry audit has no complaint about either new row's shape, state scope or tier", () => {
    const { problems } = auditRegistry({ etj_montbelvieu: GIS_SOURCES.etj_montbelvieu, etj_chambers_neighbors: GIS_SOURCES.etj_chambers_neighbors });
    expect(problems.filter((p) => !/fixture/i.test(p))).toEqual([]);
  });
});
