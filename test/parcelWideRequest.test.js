import { describe, it, expect } from "vitest";
import {
  wideStageForZoom, wideFloorFor, bucketForStage, tilesForBounds, tileEnvelope, buildWideTileQuery, areaCutoff, offsetDegrees,
  wideTileRequest, areaFieldForUrl, outlineHoldForView, relayFallbackWanted, geodesicAreaM2, geoJsonAcres, okAreaField, relayAllows,
  WIDE_MIN_ACRES, MID_MIN_ACRES, MAX_TILES_PER_VIEW, AREA_UNITS,
} from "../src/workspaces/site-planner/lib/parcelWideRequest.js";
import { isTransientEsriStatus } from "../src/workspaces/site-planner/lib/parcelQueryWire.js";
import { b64urlDecode } from "../src/shared/gis/gisProxyCore.js";
import { areaFieldsReady } from "../src/workspaces/site-planner/lib/parcelAreaFieldsLazy.js";

await areaFieldsReady(); // the table is a lazily loaded chunk in the app; the tests load it the same way

const DAVIDSON = "https://services2.arcgis.com/HdTo6HJqh92wn4D8/arcgis/rest/services/Parcels_view/FeatureServer/0";
const HARRIS = "https://www.gis.hctx.net/arcgis/rest/services/HCAD/Parcels/MapServer/0";
const RUTHERFORD = "https://services.arcgis.com/36I6IHIdr660pAyH/arcgis/rest/services/ParcelsCAMA1/FeatureServer/0";
const DOUGHERTY = "https://services6.arcgis.com/VKHi8CC6pMIyYUIs/arcgis/rest/services/Parcels_Public_View/FeatureServer/0";
const CULVERT = { lat: 36.1376, lng: -86.7535 }; // 20 Culvert St, Nashville

describe("stages — two zoom steps out from each source's own cutoff", () => {
  it("Davidson (cutoff 17): wide 15–16, mid 16–17, close 17+, nothing below 15", () => {
    expect(wideStageForZoom(14.9, 17)).toBe("far");
    expect(wideStageForZoom(15, 17)).toBe("wide");
    expect(wideStageForZoom(15.99, 17)).toBe("wide");
    expect(wideStageForZoom(16, 17)).toBe("mid");
    expect(wideStageForZoom(16.99, 17)).toBe("mid");
    expect(wideStageForZoom(17, 17)).toBe("close");
    expect(wideStageForZoom(20, 17)).toBe("close");
  });
  it("a source with no verified size column has NO wide stage — today's cutoff exactly", () => {
    expect(wideStageForZoom(16.5, 17, false)).toBe("far");
    expect(wideStageForZoom(17, 17, false)).toBe("close");
  });
  it("never reaches below zoom 12 whatever the cutoff, and handles a missing zoom", () => {
    expect(wideFloorFor(14)).toBe(12);
    expect(wideFloorFor(13)).toBe(12);
    expect(wideStageForZoom(11.9, 14)).toBe("far");
    expect(wideStageForZoom(null, 17)).toBe("far");
    expect(wideStageForZoom(NaN, 17)).toBe("far");
  });
  it("each stage has its own tile bucket (zoom the tiles are keyed to)", () => {
    expect(bucketForStage("wide", 17)).toBe(15);
    expect(bucketForStage("mid", 17)).toBe(16);
    expect(bucketForStage("close", 17)).toBeNull();
  });
});

describe("the four named counties have a VERIFIED size column", () => {
  it.each([[DAVIDSON, "Shape__Area"], [RUTHERFORD, "Shape__Area"], [DOUGHERTY, "Shape__Area"], [HARRIS, "Shape.STArea()"]])("%s", (url, field) => {
    const a = areaFieldForUrl(url);
    expect(a).toEqual({ field, unit: "ft2" });
    expect(okAreaField(a.field)).toBe(true);
  });
  it("until the table has loaded, NO source has a wide stage (never a guess)", async () => {
    const { setAreaFieldsForTest, areaFieldsNow } = await import("../src/workspaces/site-planner/lib/parcelAreaFieldsLazy.js");
    const t = areaFieldsNow();
    setAreaFieldsForTest(null);
    try { expect(areaFieldForUrl(DAVIDSON)).toBeNull(); } finally { setAreaFieldsForTest(t); }
    expect(areaFieldForUrl(DAVIDSON)).not.toBeNull();
  });
  it("an unknown source (or a trailing slash on a known one) behaves", () => {
    expect(areaFieldForUrl("https://example.com/x/FeatureServer/0")).toBeNull();
    expect(areaFieldForUrl(`${DAVIDSON}/`)).not.toBeNull();
  });
  it("a column name that is not a plain identifier is refused (it is interpolated into a where-clause)", () => {
    expect(okAreaField("Shape__Area; DROP")).toBe(false);
    expect(okAreaField("a b")).toBe(false);
    expect(okAreaField("Shape.STArea()")).toBe(true);
  });
});

describe("tiles — fixed, keyed to a zoom bucket, the same for everyone", () => {
  const view = (z) => { // 1400×850 css px around the Culvert St lot
    const mpp = 156543.03392 * Math.cos((CULVERT.lat * Math.PI) / 180) / 2 ** z;
    const dlat = (850 * mpp / 2) / 111320, dlng = (1400 * mpp / 2) / (111320 * Math.cos((CULVERT.lat * Math.PI) / 180));
    return { west: CULVERT.lng - dlng, east: CULVERT.lng + dlng, south: CULVERT.lat - dlat, north: CULVERT.lat + dlat };
  };
  it("the tiles cover the view, nearest the centre first, within the cap", () => {
    const b = view(15);
    const tiles = tilesForBounds(b, 15);
    expect(tiles.length).toBeGreaterThan(0);
    expect(tiles.length).toBeLessThanOrEqual(MAX_TILES_PER_VIEW);
    const env = tiles.map(tileEnvelope);
    expect(Math.min(...env.map((e) => e[0]))).toBeLessThanOrEqual(b.west);
    expect(Math.max(...env.map((e) => e[2]))).toBeGreaterThanOrEqual(b.east);
    expect(Math.min(...env.map((e) => e[1]))).toBeLessThanOrEqual(b.south);
    expect(Math.max(...env.map((e) => e[3]))).toBeGreaterThanOrEqual(b.north);
    const c = tiles.find((t) => { const e = tileEnvelope(t); return CULVERT.lng >= e[0] && CULVERT.lng <= e[2] && CULVERT.lat >= e[1] && CULVERT.lat <= e[3]; });
    expect(tiles.indexOf(c)).toBeLessThan(3);
  });
  it("a PAN re-uses tiles: moving the view a little changes only the edge tiles, never the keys of the ones still in view", () => {
    const a = tilesForBounds(view(15), 15).map((t) => t.key);
    const b0 = view(15), shift = (b0.east - b0.west) * 0.1;
    const panned = tilesForBounds({ ...b0, west: b0.west + shift, east: b0.east + shift }, 15).map((t) => t.key);
    const common = a.filter((k) => panned.includes(k));
    expect(common.length).toBeGreaterThanOrEqual(a.length - 3);
  });
  it("is deterministic to the last digit — the same tile is the same relay-cache key for every user", () => {
    const t = tilesForBounds(view(15), 15)[0];
    expect(tileEnvelope(t)).toEqual(tileEnvelope({ ...t }));
    expect(tileEnvelope(t).every((v) => Number(v.toFixed(6)) === v)).toBe(true);
  });
  it("one tile is 512 css px at its bucket zoom (a slippy tile one zoom up)", () => {
    const e = tileEnvelope({ x: 0, y: 0, b: 1 }); // zoom 1, 512-px tiles: ONE tile covers the world
    expect(e[0]).toBe(-180); expect(e[2]).toBe(180);
  });
});

describe("the request one tile sends — THE load-shedding contract", () => {
  const tile = tilesForBounds({ west: CULVERT.lng - 0.01, east: CULVERT.lng + 0.01, south: CULVERT.lat - 0.01, north: CULVERT.lat + 0.01 }, 15)[0];
  const area = { field: "Shape__Area", unit: "ft2" };
  const q = (stage, extra = {}) => buildWideTileQuery({ tile, stage, area, fields: ["OBJECTID", "STANPAR"], ...extra }).params;

  it("WIDE: the county is asked only for lots of at least half an acre, with generalised geometry — the house lots are never sent", () => {
    const p = q("wide");
    expect(p.where).toBe("Shape__Area >= 21780"); // 0.5 ac in sq ft
    expect(Number(p.maxAllowableOffset)).toBeGreaterThan(0);
    expect(Number(p.maxAllowableOffset)).toBeLessThan(0.0001);
    expect(p.geometryPrecision).toBe(5);
    expect(p.geometryType).toBe("esriGeometryEnvelope");
    expect(p.outFields).toBe("OBJECTID,STANPAR");
    expect(p.returnGeometry).toBe(true);
  });
  it("MID: a smaller cutoff than wide (mid-size lots too), still filtered and generalised", () => {
    const p = q("mid");
    expect(p.where).toBe(`Shape__Area >= ${Math.round(MID_MIN_ACRES * 43560)}`);
    expect(Number(p.maxAllowableOffset)).toBeGreaterThan(0);
    expect(MID_MIN_ACRES).toBeLessThan(WIDE_MIN_ACRES);
  });
  it("CLOSE: no size filter and no extra generalisation — every lot, full detail", () => {
    const p = q("close");
    expect(p.where).toBe("1=1");
    expect(p).not.toHaveProperty("maxAllowableOffset");
    expect(p.geometryPrecision).toBe(6);
  });
  it("a tile that overflowed the server's record cap asks again with the cutoff × 4 per tier, never smaller", () => {
    expect(q("wide", { tier: 1 }).where).toBe("Shape__Area >= 87120");
    expect(q("wide", { tier: 2 }).where).toBe("Shape__Area >= 348480");
  });
  it("parameters are in a fixed alphabetical order (one tile = one URL = one cache entry)", () => {
    const keys = Object.keys(q("wide"));
    expect(keys).toEqual([...keys].sort());
  });
  it("units: ft², m², acres and a Web-Mercator layer (area inflated by 1/cos²(lat)) all resolve to 0.5 real acres", () => {
    const lat = CULVERT.lat;
    expect(areaCutoff({ stage: "wide", unit: "ft2", lat })).toBe(21780);
    expect(areaCutoff({ stage: "wide", unit: "m2", lat })).toBe(2023);
    expect(areaCutoff({ stage: "wide", unit: "ac", lat })).toBe(0.5);
    const wm = areaCutoff({ stage: "wide", unit: "m2wm", lat });
    expect(wm).toBeGreaterThan(2023);
    expect(wm / 2023).toBeCloseTo(1 / Math.cos((lat * Math.PI) / 180) ** 2, 2);
    expect(Object.keys(AREA_UNITS)).toEqual(["m2", "ft2", "ac", "m2wm", "ft2wm"]);
  });
  it("the generalisation tolerance is half a pixel at the bucket zoom and halves with every zoom step", () => {
    expect(offsetDegrees(16, 36) / offsetDegrees(15, 36)).toBeCloseTo(0.5, 1);
  });
  it("refuses to build a wide tile without a verified column, or with no fields — never a silent unfiltered query", () => {
    expect(() => buildWideTileQuery({ tile, stage: "wide", area: null, fields: ["OBJECTID"] })).toThrow();
    expect(() => buildWideTileQuery({ tile, stage: "wide", area, fields: [] })).toThrow();
    expect(() => buildWideTileQuery({ tile, stage: "wide", area: { field: "x; drop", unit: "ft2" }, fields: ["OBJECTID"] })).toThrow();
  });
});

describe("where a tile is fetched from", () => {
  const params = { f: "json", where: "Shape__Area >= 21780" };
  it("a county on the relay's allow-list goes through /api/gis-cache so it is fetched from the county once for every user", () => {
    for (const u of [DAVIDSON, RUTHERFORD, DOUGHERTY, HARRIS]) {
      const r = wideTileRequest(u, params);
      expect(r.via).toBe("gis-cache");
      expect(r.url.startsWith("/api/gis-cache/svc/")).toBe(true);
      expect(r.url.endsWith("/query")).toBe(true);
      expect(b64urlDecode(r.url.split("/")[4])).toBe(u);
    }
  });
  it("a host the relay would refuse is fetched direct (still tiled, filtered and debounced); a same-origin /gis-proxy source stays on its proxy", () => {
    expect(relayAllows("https://gis.example.org/arcgis/rest/services/P/FeatureServer/0")).toBe(false);
    expect(wideTileRequest("https://gis.example.org/arcgis/rest/services/P/FeatureServer/0", params).via).toBe("direct");
    expect(wideTileRequest("/gis-proxy/gis.example.org/arcgis/rest/services/P/FeatureServer/0", params).via).toBe("gis-proxy");
  });
  it("when the relay does not answer (relay: false) the same tile is fetched direct", () => {
    expect(wideTileRequest(DAVIDSON, params, { relay: false }).via).toBe("direct");
  });
});

describe("when a tile that failed through the relay is asked of the county directly", () => {
  const fail = (o) => ({ ok: false, transient: false, status: 404, unparsable: false, ...o });
  it("the relay is missing or refuses us (404/400/403/405) → go direct", () => {
    for (const status of [404, 400, 403, 405]) expect(relayFallbackWanted("gis-cache", fail({ status }))).toBe(true);
  });
  it("the relay answers 200 with a page that is not ArcGIS (a dev server's SPA fallback) → go direct", () => {
    expect(relayFallbackWanted("gis-cache", fail({ status: 200, unparsable: true, transient: true }))).toBe(true);
  });
  it("a BUSY county (429/503/5xx, even with a plain-text or HTML body) is NOT a broken relay — never go round the cache to ask it again", () => {
    for (const status of [429, 500, 502, 503, 504]) expect(relayFallbackWanted("gis-cache", fail({ status, transient: true, unparsable: true }))).toBe(false);
  });
  it("an ArcGIS error body on a 200 (a bad query) and a network failure are not a broken relay either", () => {
    expect(relayFallbackWanted("gis-cache", fail({ status: 200, transient: false, unparsable: false }))).toBe(false);
    expect(relayFallbackWanted("gis-cache", fail({ status: 0, transient: true }))).toBe(false);
  });
  it("only a tile that went through the relay can fall back, and a success never does", () => {
    expect(relayFallbackWanted("direct", fail({ status: 404 }))).toBe(false);
    expect(relayFallbackWanted("gis-proxy", fail({ status: 404 }))).toBe(false);
    expect(relayFallbackWanted("gis-cache", { ok: true })).toBe(false);
  });
});

describe("which failures are retried", () => {
  it("network failure, 408, 429, 499 and EVERY 5xx (Cloudflare's 524 included) back off and retry", () => {
    for (const c of [0, 408, 429, 499, 500, 502, 503, 504, 520, 522, 524, 599]) expect(isTransientEsriStatus(c)).toBe(true);
  });
  it("a refused query (other 4xx) and a good answer are never retried", () => {
    for (const c of [200, 301, 400, 401, 403, 404, 405, 410]) expect(isTransientEsriStatus(c)).toBe(false);
  });
});

describe("the bottom hint tells the truth about what is held back", () => {
  const davidson = [{ floor: 17, wide: true }];
  it("close → nothing held; wide/mid → held; below the wide floor → far (the old 'zoom in a little')", () => {
    expect(outlineHoldForView(17.5, davidson)).toBe("none");
    expect(outlineHoldForView(16.5, davidson)).toBe("held");
    expect(outlineHoldForView(15.2, davidson)).toBe("held");
    expect(outlineHoldForView(14.5, davidson)).toBe("far");
  });
  it("a source with no size column stays 'far' right up to its cutoff — a blank patch never gets the 'larger lots' promise", () => {
    expect(outlineHoldForView(16.5, [{ floor: 17, wide: false }])).toBe("far");
  });
  it("two sources in view: any source still blank wins ('far'); otherwise any held → held", () => {
    expect(outlineHoldForView(16.5, [...davidson, { floor: 17, wide: false }])).toBe("far");
    expect(outlineHoldForView(16.5, [...davidson, { floor: 16, wide: true }])).toBe("held");
    expect(outlineHoldForView(16.5, [])).toBe("none");
  });
});

describe("geodesic area (the probe's calibration and the saved-copy filter)", () => {
  it("a 100 ft × 100 ft square is ~0.2296 acre", () => {
    const lat = 36.1, dLat = 100 * 0.3048 / 110574, dLng = 100 * 0.3048 / (111320 * Math.cos(lat * Math.PI / 180));
    const ring = [[-86.7, lat], [-86.7 + dLng, lat], [-86.7 + dLng, lat + dLat], [-86.7, lat + dLat], [-86.7, lat]];
    expect(geoJsonAcres({ type: "Polygon", coordinates: [ring] })).toBeCloseTo(0.2296, 2);
    expect(geodesicAreaM2([ring])).toBeCloseTo(929, -1);
  });
  it("a hole subtracts", () => {
    const lat = 36.1, s = 0.001;
    const outer = [[-86, lat], [-86 + s, lat], [-86 + s, lat + s], [-86, lat + s], [-86, lat]];
    const hole = [[-86 + s / 4, lat + s / 4], [-86 + s / 4, lat + s * 3 / 4], [-86 + s * 3 / 4, lat + s * 3 / 4], [-86 + s * 3 / 4, lat + s / 4], [-86 + s / 4, lat + s / 4]];
    expect(geoJsonAcres({ type: "Polygon", coordinates: [outer, hole] })).toBeCloseTo(geoJsonAcres({ type: "Polygon", coordinates: [outer] }) * 0.75, 3);
  });
});
