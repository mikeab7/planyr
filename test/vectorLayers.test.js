import { describe, it, expect } from "vitest";
import {
  VECTOR_SOURCES,
  buildVectorQuery, buildQueryUrl, fetchVectorFeatures,
  featuresToGeoJson, simplifyGeoJson, styleFor,
  decideVectorOrImage, fetchCached,
} from "../src/workspaces/site-planner/lib/vectorLayers.js";
import { createGisCache } from "../src/workspaces/site-planner/lib/gisCache.js";

// Deterministic deps: a fake localStorage + clock for the cache, and a fake ArcGIS
// fetcher routed by service name — no DOM, no network (same harness as the
// jurisdiction / gisCache suites).
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
const freshCache = (now) => createGisCache({ store: makeStore(), now: now || makeClock() });

// A fake fetchJson driven by { matchSubstring: (url) => esriJsonResponse }. Counts
// calls so paging / cache-hit assertions are exact. The responder returns the FULL
// Esri JSON ({ features, exceededTransferLimit }) so paging can be exercised.
function fakeFetch(routes) {
  const fn = async (url) => {
    for (const [needle, respond] of Object.entries(routes)) {
      if (url.includes(needle)) { fn.calls++; return respond(url); }
    }
    throw new Error("no route for " + url);
  };
  fn.calls = 0;
  return fn;
}

const FEMA = "NFHL/MapServer/28", NWI = "Wetlands/MapServer/0";
const BBOX = { w: -95.5, s: 29.7, e: -95.4, n: 29.8 };
// A square ring helper for geometry tests (closed: first === last).
const square = (x, y, d) => [[x, y], [x, y + d], [x + d, y + d], [x + d, y], [x, y]];

// ----------------------------------------------------------------------------
describe("VECTOR_SOURCES — registry shape", () => {
  it("FEMA + wetlands carry query, imageFallback, style, and a screening note", () => {
    expect(VECTOR_SOURCES.fema.style).toBe("fema");
    expect(VECTOR_SOURCES.fema.query.url).toContain("/NFHL/MapServer/28/query");
    expect(VECTOR_SOURCES.fema.query.outFields).toEqual(["FLD_ZONE", "ZONE_SUBTY", "SFHA_TF", "STATIC_BFE"]);
    expect(VECTOR_SOURCES.fema.imageFallback.layers).toEqual([27, 28]);
    expect(VECTOR_SOURCES.fema.note).toMatch(/screening only/i);
    expect(VECTOR_SOURCES.wetlands.style).toBe("nwi");
    expect(VECTOR_SOURCES.wetlands.query.outFields).toEqual(["WETLAND_TYPE", "ATTRIBUTE"]);
    expect(VECTOR_SOURCES.wetlands.imageFallback.layers).toEqual([0]);
    expect(VECTOR_SOURCES.wetlands.note).toMatch(/screening only/i);
  });
});

// ----------------------------------------------------------------------------
describe("buildVectorQuery — envelope intersect, paged", () => {
  it("builds the envelope geometry, 4326 in/out, and paging fields", () => {
    const p = buildVectorQuery(VECTOR_SOURCES.fema, BBOX, { offset: 2000 });
    expect(p.geometryType).toBe("esriGeometryEnvelope");
    const g = JSON.parse(p.geometry);
    expect(g).toMatchObject({ xmin: -95.5, ymin: 29.7, xmax: -95.4, ymax: 29.8 });
    expect(g.spatialReference).toEqual({ wkid: 4326 });
    expect(p.inSR).toBe(4326);
    expect(p.outSR).toBe(4326);
    expect(p.spatialRel).toBe("esriSpatialRelIntersects");
    expect(p.outFields).toBe("FLD_ZONE,ZONE_SUBTY,SFHA_TF,STATIC_BFE"); // joined
    expect(p.returnGeometry).toBe("true");
    expect(p.geometryPrecision).toBe(5);
    expect(p.resultOffset).toBe(2000);
    expect(p.resultRecordCount).toBe(1000); // source.query.pageSize
    expect(p.f).toBe("json");
    expect(p.where).toBe("1=1");
  });
  it("defaults offset to 0 when not given", () => {
    expect(buildVectorQuery(VECTOR_SOURCES.wetlands, BBOX).resultOffset).toBe(0);
  });
});

describe("buildQueryUrl — encodes params onto a base URL", () => {
  it("URL-encodes the params and skips null/undefined", () => {
    const url = buildQueryUrl("https://x.test/MapServer/0/query", {
      where: "1=1", outFields: "A,B", geometryType: "esriGeometryEnvelope", skip: null, f: "json",
    });
    expect(url).toContain("https://x.test/MapServer/0/query?");
    expect(url).toContain("outFields=A%2CB");       // comma encoded
    expect(url).toContain("geometryType=esriGeometryEnvelope");
    expect(url).toContain("f=json");
    expect(url).not.toContain("skip="); // null dropped
  });
  it("round-trips a real buildVectorQuery (envelope JSON survives encoding)", () => {
    const p = buildVectorQuery(VECTOR_SOURCES.fema, BBOX);
    const url = buildQueryUrl(VECTOR_SOURCES.fema.query.url, p);
    const parsed = new URL(url);
    expect(JSON.parse(parsed.searchParams.get("geometry")).xmin).toBe(-95.5);
    expect(parsed.searchParams.get("outFields")).toBe("FLD_ZONE,ZONE_SUBTY,SFHA_TF,STATIC_BFE");
  });
});

// ----------------------------------------------------------------------------
describe("fetchVectorFeatures — paging loop + caps", () => {
  it("single page (no exceededTransferLimit) → one fetch, not truncated", async () => {
    const fetchJson = fakeFetch({
      [FEMA]: () => ({ features: [{ attributes: { FLD_ZONE: "AE" }, geometry: { rings: [square(0, 0, 1)] } }] }),
    });
    const { features, truncated } = await fetchVectorFeatures(VECTOR_SOURCES.fema, BBOX, { fetchJson });
    expect(features).toHaveLength(1);
    expect(truncated).toBe(false);
    expect(fetchJson.calls).toBe(1);
  });

  it("pages across two pages: exceededTransferLimit true → false, bumps offset", async () => {
    const seenOffsets = [];
    const page = (n, more) => Array.from({ length: n }, (_, i) => ({ attributes: { i }, geometry: { rings: [square(i, 0, 1)] } }));
    const fetchJson = fakeFetch({
      [FEMA]: (url) => {
        const off = Number(new URL(url).searchParams.get("resultOffset"));
        seenOffsets.push(off);
        return off === 0
          ? { features: page(1000), exceededTransferLimit: true }   // first page is full
          : { features: page(3), exceededTransferLimit: false };     // tail page
      },
    });
    const { features, truncated } = await fetchVectorFeatures(VECTOR_SOURCES.fema, BBOX, { fetchJson });
    expect(fetchJson.calls).toBe(2);
    expect(seenOffsets).toEqual([0, 1000]); // offset bumped by pageSize
    expect(features).toHaveLength(1003);
    expect(truncated).toBe(false);
  });

  it("hard-caps at maxFeatures and flags truncated", async () => {
    // Every page reports more available; cap at 5 across pages of 2.
    const fetchJson = fakeFetch({
      [NWI]: () => ({
        features: [{ attributes: {}, geometry: { rings: [square(0, 0, 1)] } }, { attributes: {}, geometry: { rings: [square(1, 0, 1)] } }],
        exceededTransferLimit: true,
      }),
    });
    const { features, truncated } = await fetchVectorFeatures(VECTOR_SOURCES.wetlands, BBOX, { fetchJson, maxFeatures: 5 });
    expect(features).toHaveLength(5); // capped
    expect(truncated).toBe(true);
  });

  it("throws the server's error message on j.error", async () => {
    const fetchJson = fakeFetch({ [FEMA]: () => ({ error: { message: "Layer not found" } }) });
    await expect(fetchVectorFeatures(VECTOR_SOURCES.fema, BBOX, { fetchJson })).rejects.toThrow(/Layer not found/);
  });
});

// ----------------------------------------------------------------------------
describe("featuresToGeoJson — Esri rings → GeoJSON Polygons", () => {
  it("passes rings through as Polygon coordinates and copies attributes to properties", () => {
    const fc = featuresToGeoJson(
      [{ attributes: { FLD_ZONE: "AE", STATIC_BFE: 42 }, geometry: { rings: [square(0, 0, 1)] } }],
      { source: VECTOR_SOURCES.fema }
    );
    expect(fc.type).toBe("FeatureCollection");
    expect(fc.style).toBe("fema");
    expect(fc.features).toHaveLength(1);
    expect(fc.features[0].type).toBe("Feature");
    expect(fc.features[0].geometry.type).toBe("Polygon");
    expect(fc.features[0].geometry.coordinates).toEqual([square(0, 0, 1)]);
    expect(fc.features[0].properties).toEqual({ FLD_ZONE: "AE", STATIC_BFE: 42 });
  });
  it("skips features with no/empty rings", () => {
    const fc = featuresToGeoJson([
      { attributes: { a: 1 }, geometry: null },
      { attributes: { a: 2 }, geometry: { rings: [] } },
      { attributes: { a: 3 } }, // no geometry key at all
      { attributes: { a: 4 }, geometry: { rings: [square(0, 0, 1)] } },
    ]);
    expect(fc.features).toHaveLength(1);
    expect(fc.features[0].properties.a).toBe(4);
  });
});

// ----------------------------------------------------------------------------
describe("simplifyGeoJson — Douglas–Peucker, closed rings, drop collapsed", () => {
  it("reduces collinear vertices while keeping the ring closed", () => {
    // A square edge with many collinear midpoints — DP should drop them.
    const dense = [
      [0, 0], [0.25, 0], [0.5, 0], [0.75, 0], [1, 0], // bottom edge, collinear
      [1, 1], [0, 1], [0, 0],
    ];
    const fc = simplifyGeoJson({ type: "FeatureCollection", features: [{ type: "Feature", properties: { k: 1 }, geometry: { type: "Polygon", coordinates: [dense] } }] });
    const out = fc.features[0].geometry.coordinates[0];
    expect(out.length).toBeLessThan(dense.length);     // vertices reduced
    expect(out[0]).toEqual(out[out.length - 1]);        // still closed
    expect(fc.features[0].properties).toEqual({ k: 1 }); // properties preserved
  });
  it("keeps a real bend (a vertex above tolerance survives)", () => {
    const ring = [[0, 0], [0.5, 0.5], [1, 0], [1, 1], [0, 1], [0, 0]]; // a clear peak at (0.5,0.5)
    const out = simplifyGeoJson({ type: "FeatureCollection", features: [{ type: "Feature", properties: {}, geometry: { type: "Polygon", coordinates: [ring] } }] }, 0.00003);
    const coords = out.features[0].geometry.coordinates[0];
    expect(coords.some(([x, y]) => x === 0.5 && y === 0.5)).toBe(true);
  });
  it("drops a ring that collapses below 4 points and the feature if it has none left", () => {
    const tri = [[0, 0], [0.0000001, 0], [0, 0.0000001], [0, 0]]; // tiny → collapses
    const out = simplifyGeoJson({ type: "FeatureCollection", features: [{ type: "Feature", properties: {}, geometry: { type: "Polygon", coordinates: [tri] } }] }, 0.001);
    expect(out.features).toHaveLength(0);
  });
  it("returns a NEW collection (does not mutate the input)", () => {
    const ring = [[0, 0], [0.25, 0], [0.5, 0], [1, 0], [1, 1], [0, 1], [0, 0]];
    const input = { type: "FeatureCollection", features: [{ type: "Feature", properties: {}, geometry: { type: "Polygon", coordinates: [ring] } }] };
    const out = simplifyGeoJson(input);
    expect(input.features[0].geometry.coordinates[0]).toBe(ring); // original ref untouched
    expect(out.features[0].geometry.coordinates[0]).not.toBe(ring);
  });
});

// ----------------------------------------------------------------------------
describe("styleFor — screening symbology", () => {
  const fema = VECTOR_SOURCES.fema, nwi = VECTOR_SOURCES.wetlands;
  it("FEMA: floodway wins over the generic SFHA test", () => {
    const s = styleFor(fema, { ZONE_SUBTY: "FLOODWAY", SFHA_TF: "T" });
    expect(s.fillColor).toBe("#dc2626");
    expect(s.fillOpacity).toBe(0.45);
  });
  it("FEMA: coastal V/VE → purple (over generic SFHA)", () => {
    const s = styleFor(fema, { FLD_ZONE: "VE", SFHA_TF: "T" });
    expect(s.fillColor).toBe("#7c3aed");
    expect(s.fillOpacity).toBe(0.4);
  });
  it("FEMA: high-risk SFHA (AE) → blue", () => {
    const s = styleFor(fema, { FLD_ZONE: "AE", SFHA_TF: "T" });
    expect(s.fillColor).toBe("#2563eb");
    expect(s.fillOpacity).toBe(0.35);
  });
  it("FEMA: 0.2% / 500-yr shaded → amber", () => {
    const s = styleFor(fema, { FLD_ZONE: "X", ZONE_SUBTY: "0.2 PCT ANNUAL CHANCE FLOOD HAZARD", SFHA_TF: "F" });
    expect(s.fillColor).toBe("#f59e0b");
    expect(s.fillOpacity).toBe(0.2);
  });
  it("FEMA: minimal X → faint grey", () => {
    const s = styleFor(fema, { FLD_ZONE: "X", SFHA_TF: "F" });
    expect(s.fillColor).toBe("#9ca3af");
    expect(s.fillOpacity).toBe(0.08);
    expect(s.weight).toBe(0.5);
  });
  it("NWI: each wetland type maps to its conventional colour", () => {
    expect(styleFor(nwi, { WETLAND_TYPE: "Freshwater Emergent Wetland" }).fillColor).toBe("#2e8b57");
    expect(styleFor(nwi, { WETLAND_TYPE: "Freshwater Forested/Shrub Wetland" }).fillColor).toBe("#228b22");
    expect(styleFor(nwi, { WETLAND_TYPE: "Freshwater Pond" }).fillColor).toBe("#1e90ff");
    expect(styleFor(nwi, { WETLAND_TYPE: "Lake" }).fillColor).toBe("#4169e1");
    expect(styleFor(nwi, { WETLAND_TYPE: "Riverine" }).fillColor).toBe("#5f9ea0");
    expect(styleFor(nwi, { WETLAND_TYPE: "Estuarine and Marine Wetland" }).fillColor).toBe("#20b2aa");
    expect(styleFor(nwi, { WETLAND_TYPE: "Estuarine and Marine Deepwater" }).fillColor).toBe("#008b8b");
  });
  it("NWI: an unknown type falls to the Other default", () => {
    expect(styleFor(nwi, { WETLAND_TYPE: "Mangrove Swamp" }).fillColor).toBe("#6b7280");
    expect(styleFor(nwi, {}).fillColor).toBe("#6b7280");
    expect(styleFor(nwi, { WETLAND_TYPE: "Freshwater Pond" }).fillOpacity).toBe(0.4);
  });
});

// ----------------------------------------------------------------------------
describe("decideVectorOrImage — vector vs. flat-image fallback", () => {
  it("vector under normal conditions", () => {
    expect(decideVectorOrImage(VECTOR_SOURCES.fema, { zoom: 15, bboxAreaDeg: 0.05 })).toBe("vector");
    expect(decideVectorOrImage(VECTOR_SOURCES.fema, {})).toBe("vector"); // no hints → vector
  });
  it("image when the source has no vector query (image-only)", () => {
    expect(decideVectorOrImage({ id: "img", imageFallback: {} }, { zoom: 15 })).toBe("image");
  });
  it("image when a prior vector pull errored", () => {
    expect(decideVectorOrImage(VECTOR_SOURCES.fema, { zoom: 15, lastVectorError: new Error("boom") })).toBe("image");
  });
  it("image when zoomed out past minVectorZoom", () => {
    expect(decideVectorOrImage(VECTOR_SOURCES.fema, { zoom: 14 })).toBe("image"); // < 15
    expect(decideVectorOrImage(VECTOR_SOURCES.fema, { zoom: 15 })).toBe("vector"); // == 15 ok
  });
  it("image when the bbox covers more than maxAreaDeg", () => {
    expect(decideVectorOrImage(VECTOR_SOURCES.fema, { bboxAreaDeg: 0.6 })).toBe("image"); // > 0.5
    expect(decideVectorOrImage(VECTOR_SOURCES.fema, { bboxAreaDeg: 0.5 })).toBe("vector"); // == ok
  });
});

// ----------------------------------------------------------------------------
describe("fetchCached — SWR through the browser cache", () => {
  const oneFeature = () => ({
    [FEMA]: () => ({ features: [{ attributes: { FLD_ZONE: "AE" }, geometry: { rings: [square(0, 0, 1)] } }] }),
  });

  it("cold → fetches, simplifies, and persists; data is a GeoJSON FC", async () => {
    const cache = freshCache();
    const fetchJson = fakeFetch(oneFeature());
    const r = await fetchCached(VECTOR_SOURCES.fema, BBOX, { cache, fetchJson });
    expect(fetchJson.calls).toBe(1);
    expect(r.stale).toBe(false);
    expect(r.data.type).toBe("FeatureCollection");
    expect(r.data.features[0].properties.FLD_ZONE).toBe("AE");
    expect(typeof r.ts).toBe("number");
    // persisted under the rounded-bbox key → a second cold cache wouldn't have it, but
    // this same cache now serves it from storage without a refetch (warm path below).
  });

  it("warm + fresh → serves the cached copy WITHOUT a refetch", async () => {
    const clock = makeClock();
    const cache = freshCache(clock);
    const fetchJson = fakeFetch(oneFeature());
    await fetchCached(VECTOR_SOURCES.fema, BBOX, { cache, fetchJson }); // primes the cache
    expect(fetchJson.calls).toBe(1);
    clock.advance(60_000); // still way under the 30-day ttl
    const r = await fetchCached(VECTOR_SOURCES.fema, BBOX, { cache, fetchJson });
    expect(fetchJson.calls).toBe(1);       // no second fetch
    expect(r.stale).toBe(false);            // within ttl
    expect(r.data.features[0].properties.FLD_ZONE).toBe("AE");
  });

  it("warm + stale → returns the cached copy now (stale:true) and revalidates", async () => {
    const clock = makeClock();
    const cache = freshCache(clock);
    let zone = "AE";
    const fetchJson = fakeFetch({
      [FEMA]: () => ({ features: [{ attributes: { FLD_ZONE: zone }, geometry: { rings: [square(0, 0, 1)] } }] }),
    });
    await fetchCached(VECTOR_SOURCES.fema, BBOX, { cache, fetchJson }); // prime (zone AE)
    expect(fetchJson.calls).toBe(1);
    clock.advance(31 * 24 * 3600 * 1000); // past the 30-day ttl → stale
    zone = "VE";                           // the server has new data
    const r = await fetchCached(VECTOR_SOURCES.fema, BBOX, { cache, fetchJson });
    expect(r.stale).toBe(true);                          // flagged stale
    expect(r.data.features[0].properties.FLD_ZONE).toBe("AE"); // last-good shown NOW
    // a background revalidation was kicked off; let it settle, then the cache holds VE
    await new Promise((res) => setTimeout(res, 0));
    expect(fetchJson.calls).toBe(2);
    expect(cache.read("vec:fema:-95.500,29.700,-95.400,29.800").data.features[0].properties.FLD_ZONE).toBe("VE");
  });

  it("rounds the bbox to 3 decimals so a sub-tile pan reuses the same entry", async () => {
    const clock = makeClock();
    const cache = freshCache(clock);
    const fetchJson = fakeFetch(oneFeature());
    await fetchCached(VECTOR_SOURCES.fema, BBOX, { cache, fetchJson });
    // nudge the bbox by < 0.0005° (rounds to the same 3-dp key) → cache hit, no refetch
    const nudged = { w: -95.5001, s: 29.7001, e: -95.4001, n: 29.7999 };
    const r = await fetchCached(VECTOR_SOURCES.fema, nudged, { cache, fetchJson });
    expect(fetchJson.calls).toBe(1);
    expect(r.data.features[0].properties.FLD_ZONE).toBe("AE");
  });
});
