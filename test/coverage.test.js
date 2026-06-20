import { describe, it, expect, beforeEach } from "vitest";
import {
  LAYER_SCOPE, layerScope, isRegional,
  srPointToLatLon, esriExtentToBounds, bufferBounds, boundsIntersect,
  regionCoverage, displayCoverage, COVERAGE_STATE, computeCoverage,
  setLayerExtent, getCachedExtent, prefetchExtents, _resetCoverageCache,
  normalizeMode, normalizeRadius, RELEVANCE_MODES, DEFAULT_RELEVANCE, DEFAULT_RADIUS_MI,
} from "../src/workspaces/site-planner/lib/coverage.js";
import { dynamicLayerOptions } from "../src/workspaces/site-planner/lib/layerRequest.js";
import { JURISDICTION_LAYERS } from "../src/workspaces/site-planner/lib/counties.js";

// Real ArcGIS extents (verified live 2026-06-20): HCFCD publishes its fullExtent in
// EPSG:2278 (Texas State-Plane, US ft); the TxDOT county layer publishes in Web Mercator.
const HCFCD_EXTENT_2278 = {
  xmin: 2933015.36, ymin: 13740884.42, xmax: 3265645.57, ymax: 13989597.88,
  spatialReference: { wkid: 102740, latestWkid: 2278 },
};
const COUNTY_EXTENT_3857 = {
  xmin: -11908629.47, ymin: 2962683.98, xmax: -10366275.08, ymax: 4374369.82,
  spatialReference: { wkid: 102100, latestWkid: 3857 },
};
// Viewports {s,w,n,e}
const HOUSTON_VIEW = { s: 29.60, w: -95.60, n: 29.90, e: -95.20 };
const DALLAS_VIEW = { s: 32.70, w: -96.90, n: 32.90, e: -96.70 };

// ---------------------------------------------------------------------------
describe("LAYER_SCOPE — national | statewide | regional", () => {
  it("tags the blank-outside-the-region utility layers as regional", () => {
    for (const id of ["coh_water", "coh_ww", "coh_storm", "coh_hydrants", "hcfcd_row", "fb_contours", "jur_etj"])
      expect(layerScope(id)).toBe("regional");
    for (const id of ["coh_water", "hcfcd_row"]) expect(isRegional(id)).toBe(true);
  });
  it("tags national + statewide layers (always in-coverage)", () => {
    expect(layerScope("fema")).toBe("national");
    expect(layerScope("wetlands")).toBe("national");
    expect(layerScope("jur_county")).toBe("statewide");
    expect(layerScope("jur_mud")).toBe("statewide");
  });
  it("fails OPEN for an unknown layer id → national (never hidden)", () => {
    expect(layerScope("totally_new_layer")).toBe("national");
    expect(LAYER_SCOPE.totally_new_layer).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
describe("srPointToLatLon — spatial-reference aware", () => {
  it("passes 4326 through unchanged (x=lon, y=lat)", () => {
    expect(srPointToLatLon(-95.4, 29.7, 4326)).toEqual({ lat: 29.7, lon: -95.4 });
  });
  it("inverts Web Mercator (3857)", () => {
    const p = srPointToLatLon(-10620000, 3470000, 3857);
    expect(p.lat).toBeCloseTo(29.69, 1);
    expect(p.lon).toBeCloseTo(-95.40, 1);
  });
  it("inverts Texas State-Plane 2278 via the project grid", () => {
    const p = srPointToLatLon(3120099.09, 13841900.86, 2278);
    expect(p.lat).toBeCloseTo(29.7604, 3);
    expect(p.lon).toBeCloseTo(-95.3698, 3);
  });
  it("returns null for an unrecognized SR (→ caller fails open)", () => {
    expect(srPointToLatLon(1, 2, 9999)).toBe(null);
  });
});

// ---------------------------------------------------------------------------
describe("esriExtentToBounds — reproject a service extent to a lat/lon bbox", () => {
  it("State-Plane (EPSG:2278) HCFCD extent → Harris-County bbox", () => {
    // All 4 corners reprojected, min/max taken — so the bbox safely ENCLOSES the
    // (slightly rotated) conic footprint. Values are pyproj's 4-corner min/max.
    const b = esriExtentToBounds(HCFCD_EXTENT_2278);
    expect(b.s).toBeCloseTo(29.4696, 2);
    expect(b.n).toBeCloseTo(30.1811, 2);
    expect(b.w).toBeCloseTo(-95.9675, 2);
    expect(b.e).toBeCloseTo(-94.8950, 2);
  });
  it("Web Mercator (3857) county extent → a Texas-wide bbox", () => {
    const b = esriExtentToBounds(COUNTY_EXTENT_3857);
    expect(b.s).toBeCloseTo(25.8, 0);
    expect(b.n).toBeCloseTo(36.5, 0);
    expect(b.w).toBeCloseTo(-107.0, 0);
    expect(b.e).toBeCloseTo(-93.1, 0);
  });
  it("WGS84 (4326) extent passes through", () => {
    const b = esriExtentToBounds({ xmin: -96, ymin: 29, xmax: -95, ymax: 30, spatialReference: { wkid: 4326 } });
    expect(b).toEqual({ s: 29, n: 30, w: -96, e: -95 });
  });
  it("unknown SR or junk numbers → null (fail open)", () => {
    expect(esriExtentToBounds({ xmin: 1, ymin: 2, xmax: 3, ymax: 4, spatialReference: { wkid: 2913 } })).toBe(null);
    expect(esriExtentToBounds({ xmin: 1, ymax: 4, spatialReference: { wkid: 4326 } })).toBe(null); // missing fields
    expect(esriExtentToBounds(null)).toBe(null);
  });
});

// ---------------------------------------------------------------------------
describe("bufferBounds + boundsIntersect", () => {
  it("grows a bbox outward by ~miles (lat by miles/69)", () => {
    const b = bufferBounds({ s: 29.5, n: 29.6, w: -95.5, e: -95.4 }, 6.9);
    expect(29.5 - b.s).toBeCloseTo(0.1, 3);   // 6.9 mi / 69 = 0.1°
    expect(b.n - 29.6).toBeCloseTo(0.1, 3);
    expect(b.w).toBeLessThan(-95.5);          // lon also grows (wider at this latitude)
  });
  it("detects overlap / disjointness (touching counts)", () => {
    expect(boundsIntersect({ s: 0, n: 1, w: 0, e: 1 }, { s: 0.5, n: 2, w: 0.5, e: 2 })).toBe(true);
    expect(boundsIntersect({ s: 0, n: 1, w: 0, e: 1 }, { s: 2, n: 3, w: 2, e: 3 })).toBe(false);
    expect(boundsIntersect({ s: 0, n: 1, w: 0, e: 1 }, { s: 1, n: 2, w: 1, e: 2 })).toBe(true); // edge-touch
    expect(boundsIntersect(null, { s: 0, n: 1, w: 0, e: 1 })).toBe(false);
  });
});

// ---------------------------------------------------------------------------
describe("regionCoverage — the core in/out/unknown classification (NEW-1)", () => {
  const hcfcd = esriExtentToBounds(HCFCD_EXTENT_2278);
  it("national + statewide are ALWAYS in-coverage", () => {
    expect(regionCoverage({ scope: "national", extentBounds: null, viewport: DALLAS_VIEW })).toBe("in");
    expect(regionCoverage({ scope: "statewide", extentBounds: null, viewport: DALLAS_VIEW })).toBe("in");
  });
  it("regional: data IN the view → in; data OUT of the view → out", () => {
    expect(regionCoverage({ scope: "regional", extentBounds: hcfcd, viewport: HOUSTON_VIEW })).toBe("in");
    expect(regionCoverage({ scope: "regional", extentBounds: hcfcd, viewport: DALLAS_VIEW })).toBe("out");
  });
  it("the nearby radius pulls just-off-region data back in", () => {
    // A view just west of the HCFCD extent: out at 0 mi, in once buffered generously.
    const justWest = { s: 29.6, n: 29.8, w: -96.30, e: -96.05 }; // ~7-25 mi west of w=-95.97
    expect(regionCoverage({ scope: "regional", extentBounds: hcfcd, viewport: justWest, bufferMiles: 0 })).toBe("out");
    expect(regionCoverage({ scope: "regional", extentBounds: hcfcd, viewport: justWest, bufferMiles: 25 })).toBe("in");
  });
  it("fails OPEN: regional with no extent, or no viewport, → unknown (treated as available)", () => {
    expect(regionCoverage({ scope: "regional", extentBounds: null, viewport: HOUSTON_VIEW })).toBe("unknown");
    expect(regionCoverage({ scope: "regional", extentBounds: hcfcd, viewport: null })).toBe("unknown");
  });
});

// ---------------------------------------------------------------------------
describe("displayCoverage — the three honest per-layer states (NEW-1)", () => {
  it("out-of-coverage when the region test says out", () => {
    expect(displayCoverage("out", true)).toBe(COVERAGE_STATE.OUT);
    expect(displayCoverage("out", null)).toBe(COVERAGE_STATE.OUT);
  });
  it("covers-region-but-empty-here when in coverage but the query came back empty", () => {
    expect(displayCoverage("in", false)).toBe(COVERAGE_STATE.REGION_EMPTY);
    expect(displayCoverage("unknown", false)).toBe(COVERAGE_STATE.REGION_EMPTY);
  });
  it("data-in-view when in coverage and features painted (or not yet known)", () => {
    expect(displayCoverage("in", true)).toBe(COVERAGE_STATE.IN_VIEW);
    expect(displayCoverage("in", null)).toBe(COVERAGE_STATE.IN_VIEW);
  });
});

// ---------------------------------------------------------------------------
describe("computeCoverage + the extent cache", () => {
  beforeEach(() => _resetCoverageCache());
  it("classifies every layer in the overlay state against the viewport", () => {
    setLayerExtent("hcfcd_row", esriExtentToBounds(HCFCD_EXTENT_2278));
    const overlays = { hcfcd_row: { on: true }, fema: { on: false }, jur_county: { on: false }, coh_water: { on: false } };
    const inHou = computeCoverage(HOUSTON_VIEW, overlays, 2.5);
    expect(inHou.hcfcd_row).toBe("in");   // regional, extent known, in view
    expect(inHou.fema).toBe("in");        // national → always in
    expect(inHou.jur_county).toBe("in");  // statewide → always in
    expect(inHou.coh_water).toBe("unknown"); // regional, extent NOT cached → fail open
    const inDal = computeCoverage(DALLAS_VIEW, overlays, 2.5);
    expect(inDal.hcfcd_row).toBe("out");  // regional, out of view → the whole point
  });
});

// ---------------------------------------------------------------------------
describe("prefetchExtents — read regional extents from the health probe only", () => {
  beforeEach(() => _resetCoverageCache());
  it("probes ONLY regional layers (national/statewide need no extent) and caches the bounds", async () => {
    const probed = [];
    const probe = async (url) => { probed.push(url); return { ok: true, fullExtent: HCFCD_EXTENT_2278 }; };
    const layers = {
      hcfcd_row: { url: "https://hcfcd" }, // regional → probed
      fema: { url: "https://fema" },        // national → skipped
      jur_county: { url: "https://county" }, // statewide → skipped
    };
    await prefetchExtents(layers, probe);
    expect(probed).toEqual(["https://hcfcd"]);
    const b = getCachedExtent("hcfcd_row");
    expect(b.s).toBeCloseTo(29.4696, 2);
    expect(b.n).toBeCloseTo(30.1811, 2);
  });
  it("a failed/extent-less probe caches null → that layer fails open (stays available)", async () => {
    const probe = async () => { throw new Error("network"); };
    await prefetchExtents({ coh_water: { url: "https://coh" } }, probe);
    expect(getCachedExtent("coh_water")).toBe(null);
    expect(regionCoverage({ scope: "regional", extentBounds: getCachedExtent("coh_water"), viewport: HOUSTON_VIEW })).toBe("unknown");
  });
});

// ---------------------------------------------------------------------------
// THE HARD RULE (NEW-1): coverage is picker-only — it can NEVER change a layer's map
// request. A turned-on layer always renders everything its source returns for the view.
describe("HARD RULE — coverage never alters a layer's request", () => {
  const coh = JURISDICTION_LAYERS.harris.layers.coh_water; // real config, pinned sublayers [0,1]
  it("the COH request carries its FULL sublayer set and no where/bbox/extent", () => {
    const spec = dynamicLayerOptions(coh, 0.85, "envpane");
    expect(spec.layers).toEqual([0, 1]);     // full pinned set, never trimmed by coverage
    expect(spec).not.toHaveProperty("where");
    expect(spec).not.toHaveProperty("bbox");
    expect(spec).not.toHaveProperty("extent");
  });
  it("is coverage-independent by construction — the builder takes no coverage input", () => {
    // Whatever a layer's coverage state, the request is byte-identical (coverage is not a
    // parameter). This is the structural guarantee, not just a value check.
    const a = dynamicLayerOptions(coh, 0.85, "envpane");
    const b = dynamicLayerOptions(coh, 0.85, "envpane");
    expect(a).toEqual(b);
    expect(dynamicLayerOptions.length).toBe(3); // (cfg, opacity, pane) — no coverage arg
  });
});

// ---------------------------------------------------------------------------
describe("relevance prefs — normalize/clamp (NEW-2)", () => {
  it("mode normalizes to a known mode, defaulting to dim", () => {
    expect(RELEVANCE_MODES).toEqual(["all", "dim", "hide"]);
    expect(DEFAULT_RELEVANCE).toBe("dim");
    expect(normalizeMode("hide")).toBe("hide");
    expect(normalizeMode("bogus")).toBe("dim");
    expect(normalizeMode(undefined)).toBe("dim");
  });
  it("radius clamps to a sane mileage and defaults to ~2.5", () => {
    expect(DEFAULT_RADIUS_MI).toBe(2.5);
    expect(normalizeRadius(3)).toBe(3);
    expect(normalizeRadius(0)).toBe(0.5);     // floor
    expect(normalizeRadius(999)).toBe(25);    // ceil
    expect(normalizeRadius("abc")).toBe(2.5); // junk → default
  });
});
