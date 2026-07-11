import { describe, it, expect } from "vitest";
import {
  VECTOR_SOURCES,
  buildVectorQuery, buildQueryUrl, fetchVectorFeatures,
  featuresToGeoJson, simplifyGeoJson, styleFor,
  decideVectorOrImage, fetchCached,
  pickTier, snapBbox, vectorKey,
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
    expect(VECTOR_SOURCES.fema.query.outFields).toEqual(["FLD_ZONE", "ZONE_SUBTY", "SFHA_TF", "STATIC_BFE", "DEPTH", "V_DATUM"]);
    expect(VECTOR_SOURCES.fema.imageFallback.layers).toEqual([27, 28]);
    expect(VECTOR_SOURCES.fema.note).toMatch(/screening only/i);
    expect(VECTOR_SOURCES.wetlands.style).toBe("nwi");
    expect(VECTOR_SOURCES.wetlands.query.outFields).toEqual(["WETLAND_TYPE", "ATTRIBUTE"]);
    expect(VECTOR_SOURCES.wetlands.imageFallback.layers).toEqual([0]);
    expect(VECTOR_SOURCES.wetlands.note).toMatch(/screening only/i);
  });
  it("FEMA line layers (B755): BFE lines on sublayer 16 with ELEV, cross-sections on 14 with WSEL_REG", () => {
    expect(VECTOR_SOURCES.bfeLines.query.url).toContain("/NFHL/MapServer/16/query");
    expect(VECTOR_SOURCES.bfeLines.query.outFields).toContain("ELEV");
    expect(VECTOR_SOURCES.bfeLines.query.outFields).toContain("V_DATUM");
    expect(VECTOR_SOURCES.bfeLines.imageFallback).toBeUndefined(); // compute-only, no map render
    expect(VECTOR_SOURCES.bfeLines.note).toMatch(/screening only/i);
    expect(VECTOR_SOURCES.crossSections.query.url).toContain("/NFHL/MapServer/14/query");
    expect(VECTOR_SOURCES.crossSections.query.outFields).toContain("WSEL_REG");
  });
  it("B762: crossSections keyRev bumped 1→2 (its parse first ships; discard stale attribute-less entries)", () => {
    expect(VECTOR_SOURCES.crossSections.query.keyRev).toBe(2);
    // outFields unchanged by the bump — the S_XS attribute set the mitigation engine reads.
    expect(VECTOR_SOURCES.crossSections.query.outFields).toEqual(["WSEL_REG", "WTR_NM", "STREAM_STN", "XS_LTR", "V_DATUM", "STRMBED_EL"]);
    // bfeLines keyRev untouched (its fields didn't change).
    expect(VECTOR_SOURCES.bfeLines.query.keyRev).toBe(1);
    expect(VECTOR_SOURCES.bfeLines.query.outFields).toEqual(["ELEV", "LEN_UNIT", "V_DATUM", "SOURCE_CIT"]);
  });
});

describe("VECTOR_SOURCES — boundary rows (B694)", () => {
  it("county / city / ETJ carry tiers, label fields, and the live-fallback flag", () => {
    for (const id of ["jur_county", "jur_city", "jur_etj"]) {
      const s = VECTOR_SOURCES[id];
      expect(s.id).toBe(id);
      expect(s.liveFallback).toBe(true);
      expect(s.labelField).toBeTruthy();
      expect(s.labelZoom.min).toBeLessThan(s.labelZoom.max);
      expect(s.query.url).toMatch(/\/query$/);
      expect(s.query.tiers.length).toBeGreaterThan(1);
      expect(s.query.tiers[s.query.tiers.length - 1].maxZoom).toBeUndefined(); // catch-all fine tier
    }
    // The identify's exact column names (jurisdiction.js) — one source of truth.
    expect(VECTOR_SOURCES.jur_county.labelField).toBe("CNTY_NM");
    expect(VECTOR_SOURCES.jur_city.labelField).toBe("city_name");
    expect(VECTOR_SOURCES.jur_etj.labelField).toBe("CITY");
    expect(VECTOR_SOURCES.jur_etj.titleCaseLabel).toBe(true);
    // County + ETJ coarse tiers are source-level ("all"); city is always bbox-scoped.
    expect(VECTOR_SOURCES.jur_county.query.tiers[0].scope).toBe("all");
    expect(VECTOR_SOURCES.jur_etj.query.tiers[0].scope).toBe("all");
    expect(VECTOR_SOURCES.jur_city.query.tiers.every((t) => t.scope === "bbox")).toBe(true);
  });
  it("boundaries are always vector: no minVectorZoom / area gate can flip them to image", () => {
    for (const id of ["jur_county", "jur_city", "jur_etj"]) {
      expect(decideVectorOrImage(VECTOR_SOURCES[id], { zoom: 5, bboxAreaDeg: 50 })).toBe("vector");
      expect(decideVectorOrImage(VECTOR_SOURCES[id], { lastVectorError: new Error("x") })).toBe("image"); // fallback trigger
    }
  });
});

// ----------------------------------------------------------------------------
describe("pickTier / snapBbox — detail tiers (B694)", () => {
  const county = VECTOR_SOURCES.jur_county;
  it("no tiers (FEMA/NWI) → null: original single-detail behavior", () => {
    expect(pickTier(VECTOR_SOURCES.fema, 15)).toBe(null);
  });
  it("zoom within maxZoom → the coarse tier; beyond → the catch-all fine tier", () => {
    expect(pickTier(county, 6).scope).toBe("all");
    expect(pickTier(county, 11).scope).toBe("all");   // == maxZoom still coarse
    expect(pickTier(county, 12).scope).toBe("bbox");
    expect(pickTier(county, 18).scope).toBe("bbox");
  });
  it("no zoom hint → the coarsest tier (cheapest always-valid answer)", () => {
    expect(pickTier(county)).toBe(county.query.tiers[0]);
  });
  it("snapBbox expands OUTWARD to the grid and kills float dust", () => {
    const b = snapBbox({ w: -95.43, s: 29.71, e: -95.38, n: 29.79 }, 0.25);
    expect(b).toEqual({ w: -95.5, s: 29.5, e: -95.25, n: 30 });
    // outward: snapped box always contains the input box
    expect(b.w).toBeLessThanOrEqual(-95.43);
    expect(b.e).toBeGreaterThanOrEqual(-95.38);
    // exact multiples survive (no shrink): already-aligned edges stay put
    expect(snapBbox({ w: -95.5, s: 29.5, e: -95.25, n: 30 }, 0.25)).toEqual({ w: -95.5, s: 29.5, e: -95.25, n: 30 });
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
    expect(p.outFields).toBe("FLD_ZONE,ZONE_SUBTY,SFHA_TF,STATIC_BFE,DEPTH,V_DATUM"); // joined
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
  it("an 'all' tier drops the spatial filter and asks the server to generalize", () => {
    const tier = VECTOR_SOURCES.jur_county.query.tiers[0];
    const p = buildVectorQuery(VECTOR_SOURCES.jur_county, null, { tier });
    expect(p.geometry).toBeUndefined();          // statewide — no envelope
    expect(p.geometryType).toBeUndefined();
    expect(p.spatialRel).toBeUndefined();
    expect(p.maxAllowableOffset).toBe(0.002);    // server-side thinning
    expect(p.geometryPrecision).toBe(4);
    expect(p.outFields).toBe("CNTY_NM,FIPS_ST_CNTY_CD");
  });
  it("a 'bbox' tier keeps the envelope and adds its own offset/precision", () => {
    const tier = VECTOR_SOURCES.jur_county.query.tiers[1];
    const p = buildVectorQuery(VECTOR_SOURCES.jur_county, BBOX, { tier });
    expect(JSON.parse(p.geometry).xmin).toBe(-95.5);
    expect(p.maxAllowableOffset).toBe(0.0002);
    expect(p.geometryPrecision).toBe(5);
  });
  it("no tier → no maxAllowableOffset (FEMA/NWI behavior unchanged)", () => {
    expect(buildVectorQuery(VECTOR_SOURCES.fema, BBOX).maxAllowableOffset).toBeUndefined();
  });
});

describe("vectorKey — tier-stamped cache keys (B694)", () => {
  it("tierless keeps the original 3-dp bbox key", () => {
    expect(vectorKey(VECTOR_SOURCES.fema, BBOX)).toBe("vec:fema:-95.500,29.700,-95.400,29.800!r2");
  });
  it("an 'all' tier has ONE view-independent key", () => {
    const tier = VECTOR_SOURCES.jur_county.query.tiers[0];
    expect(vectorKey(VECTOR_SOURCES.jur_county, null, tier)).toBe("vec:jur_county:all@0.002p4");
    expect(vectorKey(VECTOR_SOURCES.jur_county, BBOX, tier)).toBe("vec:jur_county:all@0.002p4"); // bbox ignored
  });
  it("a 'bbox' tier stamps offset AND precision so coarse/fine (or a retuned precision) never collide", () => {
    const fine = VECTOR_SOURCES.jur_county.query.tiers[1];
    expect(vectorKey(VECTOR_SOURCES.jur_county, BBOX, fine)).toBe("vec:jur_county:-95.500,29.700,-95.400,29.800@0.0002p5");
    // a precision retune busts the cache even with the same offset
    expect(vectorKey(VECTOR_SOURCES.jur_county, BBOX, { ...fine, precision: 4 }))
      .not.toBe(vectorKey(VECTOR_SOURCES.jur_county, BBOX, fine));
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
    expect(parsed.searchParams.get("outFields")).toBe("FLD_ZONE,ZONE_SUBTY,SFHA_TF,STATIC_BFE,DEPTH,V_DATUM");
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
  it("B755: one path → LineString, several paths → MultiLineString; attributes copied", () => {
    const fc = featuresToGeoJson([
      { attributes: { ELEV: 96 }, geometry: { paths: [[[0, 0], [1, 1]]] } },
      { attributes: { ELEV: 97 }, geometry: { paths: [[[0, 0], [1, 0]], [[2, 2], [3, 3]]] } },
    ], { source: VECTOR_SOURCES.bfeLines });
    expect(fc.style).toBe("bfe");
    expect(fc.features[0].geometry.type).toBe("LineString");
    expect(fc.features[0].geometry.coordinates).toEqual([[0, 0], [1, 1]]);
    expect(fc.features[0].properties).toEqual({ ELEV: 96 });
    expect(fc.features[1].geometry.type).toBe("MultiLineString");
    expect(fc.features[1].geometry.coordinates).toEqual([[[0, 0], [1, 0]], [[2, 2], [3, 3]]]);
  });
  it("B755: a mixed polygon + polyline batch keeps both kinds", () => {
    const fc = featuresToGeoJson([
      { attributes: { a: 1 }, geometry: { rings: [square(0, 0, 1)] } },
      { attributes: { a: 2 }, geometry: { paths: [[[0, 0], [1, 1]]] } },
    ]);
    expect(fc.features.map((f) => f.geometry.type)).toEqual(["Polygon", "LineString"]);
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
  // (Line-geometry simplification is covered by the B751 "Douglas–Peucker on lines" block below.)
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

  it("a maxFeatures-capped pull carries `truncated` on the stored payload (B707 — an undercount must surface, never read as everything)", async () => {
    const cache = freshCache();
    // Server keeps saying "more" — fetchVectorFeatures hard-caps at maxFeatures (4000)
    // only after many pages; exercise the flag cheaply by a huge single page + limit
    // via the wetlands source's smaller page interplay is overkill — instead return
    // pageSize features + exceededTransferLimit until the fema cap trips.
    const page = () => ({
      features: Array.from({ length: VECTOR_SOURCES.fema.query.pageSize }, () => ({ attributes: { FLD_ZONE: "AE" }, geometry: { rings: [square(0, 0, 1)] } })),
      exceededTransferLimit: true,
    });
    const fetchJson = fakeFetch({ [FEMA]: page });
    const r = await fetchCached(VECTOR_SOURCES.fema, BBOX, { cache, fetchJson });
    expect(r.data.truncated).toBe(true);
    expect(r.data.features.length).toBe(VECTOR_SOURCES.fema.query.maxFeatures);
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
    expect(cache.read("vec:fema:-95.500,29.700,-95.400,29.800!r2").data.features[0].properties.FLD_ZONE).toBe("VE");
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

  it("cold + failed fetch THROWS (loud) instead of resolving a silent null", async () => {
    const cache = freshCache();
    const fetchJson = fakeFetch({ [FEMA]: () => { throw new Error("service down"); } });
    await expect(fetchCached(VECTOR_SOURCES.fema, BBOX, { cache, fetchJson })).rejects.toThrow(/service down/);
  });
});

// ----------------------------------------------------------------------------
describe("fetchCached — tiered boundary sources (B694)", () => {
  const COUNTY = "Texas_County_Boundaries";
  const countyResp = (name = "Harris") => ({
    features: [{ attributes: { CNTY_NM: name, FIPS_ST_CNTY_CD: 48201 }, geometry: { rings: [square(-95.8, 29.5, 1)] } }],
  });

  it("low zoom: ONE statewide entry serves ANY view — second view is a pure cache hit", async () => {
    const cache = freshCache();
    const urls = [];
    const fetchJson = fakeFetch({ [COUNTY]: (url) => { urls.push(url); return countyResp(); } });
    const houston = { w: -95.8, s: 29.5, e: -95.0, n: 30.1 };
    const dallas = { w: -97.2, s: 32.5, e: -96.5, n: 33.1 };
    const r1 = await fetchCached(VECTOR_SOURCES.jur_county, houston, { cache, fetchJson, zoom: 8 });
    const r2 = await fetchCached(VECTOR_SOURCES.jur_county, dallas, { cache, fetchJson, zoom: 10 });
    expect(fetchJson.calls).toBe(1); // Dallas view served from the Houston-triggered statewide pull
    expect(r1.data.features[0].properties.CNTY_NM).toBe("Harris");
    expect(r2.data.features[0].properties.CNTY_NM).toBe("Harris");
    // the statewide pull carried NO envelope and asked the server to generalize
    const q = new URL(urls[0]).searchParams;
    expect(q.get("geometry")).toBe(null);
    expect(q.get("maxAllowableOffset")).toBe("0.002");
  });

  it("high zoom: fine bbox tier — snapped grid key, so a pan within the cell is a hit", async () => {
    const cache = freshCache();
    const fetchJson = fakeFetch({ [COUNTY]: () => countyResp() });
    await fetchCached(VECTOR_SOURCES.jur_county, { w: -95.43, s: 29.71, e: -95.38, n: 29.76 }, { cache, fetchJson, zoom: 15 });
    expect(fetchJson.calls).toBe(1);
    // pan a little — still inside the same 0.25° cell → no refetch
    await fetchCached(VECTOR_SOURCES.jur_county, { w: -95.42, s: 29.72, e: -95.37, n: 29.77 }, { cache, fetchJson, zoom: 15 });
    expect(fetchJson.calls).toBe(1);
    // coarse + fine tiers never collide: the statewide key is separate
    expect(cache.read(vectorKey(VECTOR_SOURCES.jur_county, null, VECTOR_SOURCES.jur_county.query.tiers[0]))).toBe(null);
  });

  it("stale statewide entry: paints last-good NOW, onFresh delivers the refresh", async () => {
    const clock = makeClock();
    const cache = freshCache(clock);
    let name = "Harris";
    const fetchJson = fakeFetch({ [COUNTY]: () => countyResp(name) });
    await fetchCached(VECTOR_SOURCES.jur_county, BBOX, { cache, fetchJson, zoom: 8 }); // prime
    clock.advance(31 * 24 * 3600 * 1000); // past the 30-day ttl
    name = "Renamed";
    let freshResult = null;
    const r = await fetchCached(VECTOR_SOURCES.jur_county, BBOX, {
      cache, fetchJson, zoom: 8, onFresh: (fr) => { freshResult = fr; },
    });
    expect(r.stale).toBe(true);
    expect(r.data.features[0].properties.CNTY_NM).toBe("Harris"); // last-good painted now
    await new Promise((res) => setTimeout(res, 0));
    expect(freshResult).not.toBe(null);           // the background refresh reported in
    expect(freshResult.updated).toBe(true);
    expect(freshResult.data.features[0].properties.CNTY_NM).toBe("Renamed");
  });

  it("tiered pulls skip the client Douglas–Peucker (server already generalized)", async () => {
    const cache = freshCache();
    // A ring with collinear midpoints that client DP would strip — it must survive
    // a tiered pull untouched (the server was asked to generalize instead).
    const dense = [[0, 0], [0.5, 0], [1, 0], [1, 1], [0, 1], [0, 0]];
    const fetchJson = fakeFetch({ [COUNTY]: () => ({ features: [{ attributes: { CNTY_NM: "X" }, geometry: { rings: [dense] } }] }) });
    const r = await fetchCached(VECTOR_SOURCES.jur_county, BBOX, { cache, fetchJson, zoom: 8 });
    expect(r.data.features[0].geometry.coordinates[0]).toEqual(dense);
  });
});

// ----------------------------------------------------------------------------
// B751 — pipeline LINE geometry + the txrrc_pipe vector source
// ----------------------------------------------------------------------------
const PIPE = "RRC_Public_Viewer_Srvs/MapServer/13/query";

describe("featuresToGeoJson — Esri paths → GeoJSON lines (B751)", () => {
  it("a single path → LineString; multiple paths → MultiLineString; attributes copied", () => {
    const fc = featuresToGeoJson([
      { attributes: { OPERATOR: "Acme", COMMODITY_DESCRIPTION: "NATURAL GAS" }, geometry: { paths: [[[0, 0], [1, 1]]] } },
      { attributes: { OPERATOR: "Beta" }, geometry: { paths: [[[0, 0], [1, 0]], [[2, 2], [3, 3]]] } },
    ]);
    expect(fc.features[0].geometry).toEqual({ type: "LineString", coordinates: [[0, 0], [1, 1]] });
    expect(fc.features[0].properties.COMMODITY_DESCRIPTION).toBe("NATURAL GAS");
    expect(fc.features[1].geometry.type).toBe("MultiLineString");
    expect(fc.features[1].geometry.coordinates.length).toBe(2);
  });
  it("skips features with no/empty/too-short paths (never a 1-point line)", () => {
    const fc = featuresToGeoJson([
      { attributes: {}, geometry: {} },
      { attributes: {}, geometry: { paths: [] } },
      { attributes: {}, geometry: { paths: [[[0, 0]]] } }, // single vertex — not drawable
      { attributes: { keep: 1 }, geometry: { paths: [[[0, 0], [1, 1]]] } },
    ]);
    expect(fc.features).toHaveLength(1);
    expect(fc.features[0].properties.keep).toBe(1);
  });
  it("still handles polygons (rings) unchanged — no regression", () => {
    const fc = featuresToGeoJson([{ attributes: {}, geometry: { rings: [square(0, 0, 1)] } }]);
    expect(fc.features[0].geometry.type).toBe("Polygon");
  });
});

describe("simplifyGeoJson — Douglas–Peucker on lines (B751)", () => {
  it("strips collinear midpoints from a LineString, keeps endpoints", () => {
    const dense = [[0, 0], [0.5, 0], [1, 0], [1.5, 0], [2, 0]];
    const out = simplifyGeoJson({ type: "FeatureCollection", features: [{ type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: dense } }] }, 0.001);
    expect(out.features[0].geometry.coordinates).toEqual([[0, 0], [2, 0]]);
  });
  it("simplifies each part of a MultiLineString and drops a part that collapses below a segment", () => {
    const fc = {
      type: "FeatureCollection",
      features: [{
        type: "Feature", properties: {},
        geometry: { type: "MultiLineString", coordinates: [[[0, 0], [1, 0], [2, 0]], [[5, 5]]] },
      }],
    };
    const out = simplifyGeoJson(fc, 0.001);
    // the second part had a single vertex → dropped; the survivor collapses to a single LineString
    expect(out.features[0].geometry.type).toBe("LineString");
    expect(out.features[0].geometry.coordinates).toEqual([[0, 0], [2, 0]]);
  });
});

describe("styleFor — pipeline commodity symbology (B751)", () => {
  it("colors + weights + dashes a pipeline by commodity via the crosswalk", () => {
    const src = VECTOR_SOURCES.txrrc_pipe;
    expect(styleFor(src, { COMMODITY_DESCRIPTION: "NATURAL GAS" })).toMatchObject({ color: "#EF9F27", weight: 3 });
    expect(styleFor(src, { COMMODITY_DESCRIPTION: "REFINED PRODUCTS" })).toMatchObject({ color: "#1D9E75", dashArray: "10 6" });
    expect(styleFor(src, { COMMODITY_DESCRIPTION: "PROPANE" }).color).toBe("#E24B4A"); // HVL
    expect(styleFor(src, {}).color).toBe("#9a9992"); // unknown
  });
});

describe("VECTOR_SOURCES.txrrc_pipe — pipeline vector source (B751)", () => {
  const s = VECTOR_SOURCES.txrrc_pipe;
  it("reuses the authoritative statewide RRC layer 13 + the registry field columns", () => {
    expect(s.id).toBe("txrrc_pipe");
    expect(s.style).toBe("pipeline");
    expect(s.query.url).toContain("/MapServer/13/query");
    expect(s.query.outFields).toEqual(expect.arrayContaining(["OPERATOR", "COMMODITY_DESCRIPTION", "DIAMETER", "STATUS"]));
    expect(s.commodityField).toBe("COMMODITY_DESCRIPTION");
    expect(s.imageFallback.layers).toEqual([13]);
    expect(s.note).toMatch(/schematic/i);
  });
  it("is VECTOR when zoomed in, RASTER when zoomed out or the view is too large (the zoom-switch gate)", () => {
    expect(decideVectorOrImage(s, { zoom: 15, bboxAreaDeg: 0.02 })).toBe("vector");
    expect(decideVectorOrImage(s, { zoom: 12, bboxAreaDeg: 0.02 })).toBe("image"); // below minVectorZoom (13)
    expect(decideVectorOrImage(s, { zoom: 15, bboxAreaDeg: 0.5 })).toBe("image");  // area > maxAreaDeg (0.2)
    expect(decideVectorOrImage(s, { zoom: 15, bboxAreaDeg: 0.02, lastVectorError: new Error("x") })).toBe("image");
  });
  it("pages LINE features through the SWR cache into GeoJSON lines", async () => {
    const cache = freshCache();
    const fetchJson = fakeFetch({ [PIPE]: () => ({ features: [{ attributes: { COMMODITY_DESCRIPTION: "CRUDE OIL" }, geometry: { paths: [[[-95, 29.7], [-95.01, 29.71]]] } }] }) });
    const r = await fetchCached(s, { w: -95.1, s: 29.6, e: -94.9, n: 29.8 }, { cache, fetchJson, zoom: 15 });
    expect(r.data.features[0].geometry.type).toBe("LineString");
    expect(r.data.features[0].properties.COMMODITY_DESCRIPTION).toBe("CRUDE OIL");
  });
});
