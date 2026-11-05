import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { VECTOR_SOURCES, fetchCached, vectorKey, hitFeature } from "../src/workspaces/site-planner/lib/vectorLayers.js";
import { cityPolysFromGeoJson, netEtjFeatures } from "../src/workspaces/site-planner/lib/etjNet.js";
import { esriPolygons, pointInPolygons, intersectionAreaSqM, unionAreaSqM, netPolysToEsriRings, SQM_PER_ACRE } from "../src/workspaces/site-planner/lib/jurisdictionShare.js";
import { createGisCache } from "../src/workspaces/site-planner/lib/gisCache.js";

/* ═══════════════════════════════════════════════════════════════════════════════════════════════
 * B2472945 — THE DRAWN ETJ LAYER IS NET OF CITY LIMITS (the map half of B2472944's header rule).
 *
 * An ETJ is the ground OUTSIDE every city's limits (Local Gov't Code ch. 42). The header already refuses to name an ETJ over ground a
 * city's limits hold; the map layer still drew the publisher's polygon as published, so on Concept A's ground the dashed Houston ETJ
 * ran through Sugar Land's limits. The fixture is the same REAL polygons the header's red-proof uses (TxGIO Sugar Land limits and
 * H-GAC's Houston ETJ, cut to a window around the site). ⛔ The expected areas/points are measured, not tuned to a result.
 * ═══════════════════════════════════════════════════════════════════════════════════════════════ */

const FIX = JSON.parse(fs.readFileSync(path.join(process.cwd(), "test/fixtures/etjCityOverlapSugarLand.json"), "utf8"));
const REF = [-95.6693177, 29.6122132];
const BBOX = { w: -95.70, s: 29.60, e: -95.64, n: 29.64 };
const ZOOM = 15;

function makeStore() {
  const map = new Map();
  return { getItem: (k) => (map.has(k) ? map.get(k) : null), setItem: (k, v) => { map.set(k, v); }, removeItem: (k) => map.delete(k), get length() { return map.size; }, key: (i) => Array.from(map.keys())[i] ?? null };
}
const freshCache = () => createGisCache({ store: makeStore(), now: () => 1_000_000 });

function fakeFetch({ cityDown = false, etj = [FIX.etjHouston], city = [FIX.city] } = {}) {
  const fn = async (url) => {
    fn.urls.push(url);
    if (url.includes("Texas_City_Boundaries")) { if (cityDown) throw new Error("city layer down"); return { features: city }; }
    if (url.includes("HGAC_City_ETJ")) return { features: etj };
    throw new Error("no route for " + url);
  };
  fn.urls = [];
  return fn;
}
const drawnEtj = async (fetchJson, cache = freshCache()) => (await fetchCached(VECTOR_SOURCES.jur_etj, BBOX, { cache, fetchJson, zoom: ZOOM })).data;
const polysOf = (fc) => cityPolysFromGeoJson(fc.features);
const cityPolys = esriPolygons(FIX.city.geometry);
const etjOriginal = esriPolygons(FIX.etjHouston.geometry);

const IN_BAND = [-95.667, 29.6255];        // inside Sugar Land's limits AND under Houston's published ETJ polygon (measured)
const ETJ_ONLY = [-95.6865, 29.622];       // Houston ETJ ground outside every limit
const IN_LIMITS_NO_ETJ = [-95.6693, 29.6122]; // Concept A's origin: inside the limits, in no ETJ polygon

describe("B2472945 — controls: the sample points are where the tests say they are, on the RAW published polygons", () => {
  it("IN_BAND is in the limits AND the published ETJ; ETJ_ONLY is ETJ outside the limits; the origin is limits only", () => {
    expect(pointInPolygons(IN_BAND, cityPolys)).toBe(true);
    expect(pointInPolygons(IN_BAND, etjOriginal)).toBe(true);
    expect(pointInPolygons(ETJ_ONLY, etjOriginal)).toBe(true);
    expect(pointInPolygons(ETJ_ONLY, cityPolys)).toBe(false);
    expect(pointInPolygons(IN_LIMITS_NO_ETJ, cityPolys)).toBe(true);
    expect(pointInPolygons(IN_LIMITS_NO_ETJ, etjOriginal)).toBe(false);
    // the straddle sample points
    expect(pointInPolygons([-95.6755, 29.6165], etjOriginal) && !pointInPolygons([-95.6755, 29.6165], cityPolys)).toBe(true);
    expect(pointInPolygons([-95.6695, 29.6200], cityPolys)).toBe(true);
    expect(pointInPolygons([-95.6695, 29.6200], etjOriginal)).toBe(true);   // the overlap: ETJ claims it too, so the cut is what clears it
  });
});

describe("B2472945 — the drawn ETJ layer never covers ground a city's limits hold", () => {
  it("RED PROOF · the ETJ the map draws has no area inside Sugar Land's limits (on main: the whole overlap band)", async () => {
    const polys = polysOf(await drawnEtj(fakeFetch()));
    expect(polys.length).toBeGreaterThan(0);
    // The published polygon overlaps the limits by hundreds of acres in this window (the premise — a control on the instrument).
    const rawOverlapAc = intersectionAreaSqM(etjOriginal, cityPolys, REF) / SQM_PER_ACRE;
    expect(rawOverlapAc).toBeGreaterThan(100);
    const drawnOverlapAc = intersectionAreaSqM(polys, cityPolys, REF) / SQM_PER_ACRE;
    expect(drawnOverlapAc).toBeLessThan(rawOverlapAc * 0.02);   // slivers of generalisation noise at most — not the band
    expect(pointInPolygons(IN_BAND, polys)).toBe(false);
  });

  it("plain ETJ ground still draws: outside the limits the area is the publisher's, to the percent", async () => {
    const polys = polysOf(await drawnEtj(fakeFetch()));
    expect(pointInPolygons(ETJ_ONLY, polys)).toBe(true);
    expect(pointInPolygons(IN_LIMITS_NO_ETJ, polys)).toBe(false);
    // Area of the published ETJ that is NOT under the limits == area drawn (the cut removes only what the limits hold).
    const outside = unionAreaSqM(etjOriginal, REF) - intersectionAreaSqM(etjOriginal, cityPolys, REF);
    const drawn = unionAreaSqM(polys, REF);
    expect(Math.abs(drawn - outside) / outside).toBeLessThan(0.02);
  });

  it("a site that GENUINELY straddles keeps the ETJ for the part outside the limits (the header's split case, same ground)", async () => {
    const polys = polysOf(await drawnEtj(fakeFetch()));
    // The straddle box from the header's test: 74% limits, ~24% Houston ETJ outside them. Sample its ETJ-only corner and its limits corner.
    expect(pointInPolygons([-95.6755, 29.6165], polys)).toBe(true);
    expect(pointInPolygons([-95.6695, 29.6200], polys)).toBe(false);
  });

  it("the cut is REPORTED on the cached payload, and the cache key moved so no un-netted entry is ever served", async () => {
    const fc = await drawnEtj(fakeFetch());
    expect(fc.netted.cityFeatures).toBeGreaterThan(0);
    expect(fc.netted.touched).toBeGreaterThan(0);
    expect(vectorKey(VECTOR_SOURCES.jur_etj, BBOX, null)).toMatch(/!r3$/);
    expect(VECTOR_SOURCES.jur_etj.query.netAgainst).toBe("jur_city");
  });

  it("the city limits are read through the city layer's OWN source (one source of truth), not a second copy", async () => {
    const f = fakeFetch();
    await drawnEtj(f);
    const cityCalls = f.urls.filter((u) => u.includes("Texas_City_Boundaries"));
    expect(cityCalls.length).toBeGreaterThan(0);
    // …and the city layer's cache entry is what a second ETJ pull reads: with the same cache, the city service is not asked again.
    const cache = freshCache();
    const f1 = fakeFetch(); await drawnEtj(f1, cache);
    const f2 = fakeFetch(); await fetchCached(VECTOR_SOURCES.jur_city, BBOX, { cache, fetchJson: f2, zoom: ZOOM });
    expect(f2.urls.filter((u) => u.includes("Texas_City_Boundaries")).length).toBe(0);
  });

  it("LOUD-FAILURE · if the city layer cannot answer, the ETJ pull FAILS — an un-netted ETJ is never cached as if it were netted", async () => {
    const cache = freshCache();
    await expect(fetchCached(VECTOR_SOURCES.jur_etj, BBOX, { cache, fetchJson: fakeFetch({ cityDown: true }), zoom: ZOOM }))
      .rejects.toThrow(/netted against city limits/);
    // Nothing was stored under the ETJ key, so the next healthy pull is a real pull.
    const again = await drawnEtj(fakeFetch(), cache);
    expect(pointInPolygons(IN_BAND, polysOf(again))).toBe(false);
  });
});

describe("B2472945 — the netting rule itself", () => {
  const sq = (x0, y0, x1, y1) => [[x0, y0], [x0, y1], [x1, y1], [x1, y0], [x0, y0]];   // clockwise = an ESRI outer ring
  const feat = (rings, attrs = { CITY: "Houston" }) => ({ geometry: { rings }, attributes: attrs });
  const ref = [-95.2, 29.4];

  it("a small city wholly inside a big city's ETJ polygon punches a hole (Humble / Will Clayton shape)", () => {
    const big = feat([sq(-95.30, 29.30, -95.10, 29.50)]);
    const humble = esriPolygons({ rings: [sq(-95.22, 29.38, -95.18, 29.42)] });
    const { features, touched } = netEtjFeatures([big], humble, { ref, minWidthM: 0 });
    expect(touched).toBe(1);
    const polys = esriPolygons(features[0].geometry);
    expect(pointInPolygons([-95.20, 29.40], polys)).toBe(false);   // inside the small city: no ETJ
    expect(pointInPolygons([-95.28, 29.32], polys)).toBe(true);    // plain ETJ ground
  });

  it("an ETJ wholly inside a city's limits disappears (its label with it)", () => {
    const e = feat([sq(-95.21, 29.39, -95.19, 29.41)]);
    const city = esriPolygons({ rings: [sq(-95.30, 29.30, -95.10, 29.50)] });
    const { features, dropped } = netEtjFeatures([e], city, { ref });
    expect(features).toHaveLength(0);
    expect(dropped).toBe(1);
  });

  it("an ETJ clear of every city is returned UNTOUCHED — the same object, not re-wound or re-snapped", () => {
    const e = feat([sq(-95.30, 29.30, -95.25, 29.35)]);
    const city = esriPolygons({ rings: [sq(-95.22, 29.38, -95.18, 29.42)] });
    const { features, touched } = netEtjFeatures([e], city, { ref });
    expect(touched).toBe(0);
    expect(features[0]).toBe(e);
  });

  it("an SB 2038 release area is left alone — it is not an ETJ claim", () => {
    const rel = feat([sq(-95.21, 29.39, -95.19, 29.41)], { CITY: "Fort Worth ETJ release area (SB 2038)", _release: true });
    const city = esriPolygons({ rings: [sq(-95.30, 29.30, -95.10, 29.50)] });
    const { features } = netEtjFeatures([rel], city, { ref });
    expect(features[0]).toBe(rel);
  });

  it("SLIVERS: independent generalisation of the shared border leaves a ribbon, and minWidthM removes it without eating real ETJ", () => {
    // ETJ and city abut at x = -95.20; the ETJ's copy of the border sits ~0.00001° (≈1 m) inside the city's — a ribbon of 'ETJ' under the city.
    const etj = esriPolygons({ rings: [sq(-95.30, 29.30, -95.19999, 29.50)] });
    const city = esriPolygons({ rings: [sq(-95.20, 29.30, -95.10, 29.50)] });
    const raw = netPolysToEsriRings(etj, city, ref, { minWidthM: 0 });
    const clean = netPolysToEsriRings(etj, city, ref, { minWidthM: 5 });
    const wide = unionAreaSqM(esriPolygons({ rings: clean }), ref);
    const wideExpected = unionAreaSqM(etj, ref);
    expect(raw.length).toBeGreaterThan(0);
    expect(Math.abs(wide - wideExpected) / wideExpected).toBeLessThan(0.01);   // the real ETJ survives whole
    // A ribbon on its own (nothing wider behind it) is removed entirely.
    const ribbon = esriPolygons({ rings: [sq(-95.20001, 29.30, -95.2, 29.50)] });
    expect(netPolysToEsriRings(ribbon, esriPolygons({ rings: [sq(-95.2, 29.30, -95.1, 29.5)] }), ref, { minWidthM: 5 })).toHaveLength(0);
  });

  it("ring orientation is ESRI's (outer clockwise, hole counter-clockwise) so esriPolygons reads the result back", () => {
    const big = esriPolygons({ rings: [sq(-95.30, 29.30, -95.10, 29.50)] });
    const hole = esriPolygons({ rings: [sq(-95.22, 29.38, -95.18, 29.42)] });
    const rings = netPolysToEsriRings(big, hole, ref, {});
    const back = esriPolygons({ rings });
    expect(back).toHaveLength(1);
    expect(back[0].holes).toHaveLength(1);
  });
});

describe("B2472945 — the click hit-test agrees with the picture (a multi-part polygon is not 'outer + holes')", () => {
  const sq = (x0, y0, x1, y1) => [[x0, y0], [x0, y1], [x1, y1], [x1, y0], [x0, y0]];
  const polyFeat = (rings) => ({ type: "FeatureCollection", features: [{ type: "Feature", properties: { CITY: "Test" }, geometry: { type: "Polygon", coordinates: rings } }] });
  it("a feature with TWO separate parts hits in either part (the second part used to count as a hole and answered nothing)", () => {
    const fc = polyFeat([sq(0, 0, 1, 1), sq(2, 0, 3, 1)]);
    expect(hitFeature(fc, { lng: 0.5, lat: 0.5, tolDeg: 0 })).not.toBe(null);
    expect(hitFeature(fc, { lng: 2.5, lat: 0.5, tolDeg: 0 })).not.toBe(null);
    expect(hitFeature(fc, { lng: 1.5, lat: 0.5, tolDeg: 0 })).toBe(null);
  });
  it("a hole is still a hole, and an island inside the hole is inside again — outer + holes behaves exactly as before", () => {
    const fc = polyFeat([sq(0, 0, 10, 10), sq(2, 2, 8, 8), sq(4, 4, 6, 6)]);
    expect(hitFeature(fc, { lng: 1, lat: 1, tolDeg: 0 })).not.toBe(null);
    expect(hitFeature(fc, { lng: 3, lat: 3, tolDeg: 0 })).toBe(null);
    expect(hitFeature(fc, { lng: 5, lat: 5, tolDeg: 0 })).not.toBe(null);
  });
  it("on the REAL netted ETJ: plain ETJ ground answers (Houston), the overlap band answers nothing", async () => {
    const fc = await drawnEtj(fakeFetch());
    const hit = hitFeature(fc, { lng: ETJ_ONLY[0], lat: ETJ_ONLY[1], tolDeg: 0.000005 });
    expect(hit && hit.properties.CITY).toBe("Houston");
    expect(hitFeature(fc, { lng: IN_BAND[0], lat: IN_BAND[1], tolDeg: 0.000005 })).toBe(null);
  });
});

describe("B2472945 — PDF-PARITY: the printed sheet draws the SAME netted features, not a second pull", () => {
  it("the export's vector branch reads the live painted layer's GeoJSON and never fetches ETJ itself", () => {
    const src = fs.readFileSync(path.join(process.cwd(), "src/workspaces/site-planner/lib/exportSheet.js"), "utf8");
    expect(src).toMatch(/geo\.toGeoJSON\(\)/);
    expect(src).not.toMatch(/fetchCached|ETJ_SOURCES|fetchVectorFeatures/);
  });
});
