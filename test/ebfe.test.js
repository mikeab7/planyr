/* B882 / NEW-1 — the FEMA/USGS InFRM EBFE point sampler.
 *
 * ⛔ WHY THIS SUITE WAS REWRITTEN (2026-08-05), and the lesson worth keeping: the previous
 * version was green for weeks while the sampler returned a permanent silent null in production.
 * It was green because every fixture in it was INVENTED — results tagged `layerId: 17` carrying
 * an `attributes: { "Pixel Value": … }` and a numeric top-level `value`. The real service returns
 * none of those three things. It reports the RASTER sublayers (20 / 24, never the 17 / 21 mosaic
 * GROUP ids, which identify does not echo back), under the attribute name "Service Pixel Value",
 * and its top-level `value` on the boundary sublayer is a Shape_Length in the tens of millions.
 *
 * So the fixtures below are now VERBATIM CAPTURES of the live response at the Tsakiris tract
 * (-95.89503, 29.77938 → 1% 154.8 ft · 0.2% 156 ft) and at downtown Houston (studied, so BLE is
 * NoData by design), taken 2026-08-05 through the app's own same-origin GIS proxy. Do not
 * "simplify" them back into a hand-written shape — the shape IS the thing under test.
 */
import { describe, it, expect, beforeEach } from "vitest";
import {
  sampleEbfePoint, foldIdentify, pixelValueOf, ebfeIdentifyUrl, ebfeEndpoint,
  clearEbfeCache, EBFE_URL, EBFE_LAYERS, EBFE_PIXEL_ATTRS,
} from "../src/workspaces/site-planner/lib/ebfe.js";
import { gisSource, fixtureCount } from "../src/shared/gis/sources.js";
import { fixturesFor } from "../src/shared/gis/sourceFixtures.js";

const okJson = (body) => ({ ok: true, json: async () => body });

/* VERBATIM live capture — Tsakiris tract, 2026-08-05. Note: no top-level `value` at all, and
 * the numbers live under "Service Pixel Value". */
const REAL_IN_COVERAGE = {
  results: [
    { layerId: 20, layerName: "1 Percent WSE Image", attributes: { "Service Pixel Value": "154.8", "Classify.Pixel Value": "154.800000", Name: "E01_12040101" } },
    { layerId: 24, layerName: ".2 Percent WSE Image", attributes: { "Service Pixel Value": "156", "Classify.Pixel Value": "156.000000", Name: "E002_12040101" } },
  ],
};

/* VERBATIM live capture — downtown Houston, 2026-08-05. The area IS studied, so BLE publishes
 * no surface: the mosaic answers, but every pixel reads NoData. */
const REAL_NODATA = {
  results: [
    { layerId: 20, layerName: "1 Percent WSE Image", attributes: { "Service Pixel Value": "NoData", "Classify.Pixel Value": "NoData", Name: "E01_12040101" } },
    { layerId: 24, layerName: ".2 Percent WSE Image", attributes: { "Service Pixel Value": "NoData", "Classify.Pixel Value": "NoData", Name: "E002_12040101" } },
  ],
};

/* The response the OLD code was accidentally reading: the mosaic's boundary/footprint children,
 * whose `value` is a Shape_Length. This exists so the "never trust result.value" rule is a test,
 * not a comment. */
const REAL_BOUNDARY_NOISE = {
  results: [
    { layerId: 18, layerName: "1 Percent WSE Boundary", displayFieldName: "Shape_Length", value: "17141870.9255999", attributes: { OBJECTID: "60", Shape_Length: "17141870.9256" } },
    { layerId: 19, layerName: "1 Percent WSE Footprint", value: "E01_12040101", attributes: { Name: "E01_12040101" } },
  ],
};

beforeEach(() => clearEbfeCache());

describe("pixelValueOf", () => {
  it("reads the attribute names this service ACTUALLY uses", () => {
    expect(pixelValueOf(REAL_IN_COVERAGE.results[0])).toBeCloseTo(154.8, 5);
    expect(pixelValueOf(REAL_IN_COVERAGE.results[1])).toBeCloseTo(156, 5);
  });

  it("⛔ NEVER reads the top-level `value` — on this service it is a Shape_Length", () => {
    // 17,141,870 ft is not a flood elevation. A fold that trusted `value` would have reported it.
    expect(pixelValueOf(REAL_BOUNDARY_NOISE.results[0])).toBeNull();
    expect(pixelValueOf({ value: "37.25" })).toBeNull();
  });

  it("treats NoData / empty / non-numeric / absent as null (never a fabricated 0)", () => {
    expect(pixelValueOf(REAL_NODATA.results[0])).toBeNull();
    expect(pixelValueOf({ attributes: { "Service Pixel Value": "" } })).toBeNull();
    expect(pixelValueOf({ attributes: {} })).toBeNull();
    expect(pixelValueOf(null)).toBeNull();
  });

  it("falls through the declared attribute list in order", () => {
    expect(EBFE_PIXEL_ATTRS[0]).toBe("Service Pixel Value");
    expect(pixelValueOf({ attributes: { "Service Pixel Value": "NoData", "Classify.Pixel Value": "88.5" } })).toBeCloseTo(88.5, 5);
  });
});

describe("foldIdentify", () => {
  it("maps the RASTER sublayers 20 → bfe1pctFt and 24 → wse02Ft", () => {
    const r = foldIdentify(REAL_IN_COVERAGE.results, EBFE_LAYERS);
    expect(r.bfe1pctFt).toBeCloseTo(154.8, 5);
    expect(r.wse02Ft).toBeCloseTo(156, 5);
  });

  it("⛔ REGRESSION: matching the 17/21 MOSAIC ids folds to nothing — the shipped bug", () => {
    // identify expands a mosaic layer and reports only its children, so a group id matches no
    // result, ever. This is why the EBFE provider silently produced no value since B882.
    const r = foldIdentify(REAL_IN_COVERAGE.results, { bfe1pct: 17, wse02: 21 });
    expect(r).toEqual({ bfe1pctFt: null, wse02Ft: null });
  });

  it("ignores the boundary/footprint siblings entirely", () => {
    expect(foldIdentify([...REAL_BOUNDARY_NOISE.results, ...REAL_IN_COVERAGE.results], EBFE_LAYERS))
      .toEqual({ bfe1pctFt: 154.8, wse02Ft: 156 });
  });

  it("a NoData layer stays null (studied area / partial coverage)", () => {
    expect(foldIdentify(REAL_NODATA.results, EBFE_LAYERS)).toEqual({ bfe1pctFt: null, wse02Ft: null });
    expect(foldIdentify([REAL_IN_COVERAGE.results[0], REAL_NODATA.results[1]], EBFE_LAYERS))
      .toEqual({ bfe1pctFt: 154.8, wse02Ft: null });
    expect(foldIdentify([], EBFE_LAYERS)).toEqual({ bfe1pctFt: null, wse02Ft: null });
  });
});

describe("ebfeIdentifyUrl", () => {
  it("goes through the same-origin proxy by default (the browser cannot reach the agency)", () => {
    const u = ebfeIdentifyUrl(29.78, -95.75);
    expect(u.startsWith("/api/gis-cache/svc/")).toBe(true);
    expect(u).toContain("nostore=1"); // a point JSON read must never enter the imagery cache
    expect(ebfeEndpoint()).toBe(ebfeEndpoint({ direct: false }));
  });

  it("builds an /identify point query against layers 20,24 in WGS84", () => {
    const u = ebfeIdentifyUrl(29.78, -95.75, { direct: true });
    expect(u).toContain(EBFE_URL);
    expect(u).toContain("/identify");
    expect(u).toContain("esriGeometryPoint");
    expect(u).toContain(encodeURIComponent("all:20,24"));
    expect(decodeURIComponent(u)).toContain('"x":-95.75');
    expect(decodeURIComponent(u)).toContain('"wkid":4326');
    expect(u).not.toContain("nostore"); // a direct call has no proxy flag to strip
  });
});

describe("sampleEbfePoint", () => {
  it("returns FEET for both layers, untouched (no metres conversion)", async () => {
    let calledUrl = null;
    const fetchImpl = async (u) => { calledUrl = u; return okJson(REAL_IN_COVERAGE); };
    const r = await sampleEbfePoint(29.77938, -95.89503, { fetchImpl });
    expect(r.bfe1pctFt).toBeCloseTo(154.8, 5);
    expect(r.wse02Ft).toBeCloseTo(156, 5);
    expect(calledUrl).toContain("/identify");
  });
  it("a studied / out-of-coverage point → both null (the caller falls back to grade)", async () => {
    expect(await sampleEbfePoint(29.76, -95.37, { fetchImpl: async () => okJson(REAL_NODATA) }))
      .toEqual({ bfe1pctFt: null, wse02Ft: null });
    expect(await sampleEbfePoint(44.0, -110.0, { fetchImpl: async () => okJson({ results: [] }) }))
      .toEqual({ bfe1pctFt: null, wse02Ft: null });
  });
  it("HTTP / service errors THROW (an outage reads failed, never a value — LOUD-FAILURE)", async () => {
    await expect(sampleEbfePoint(29.78, -95.75, { fetchImpl: async () => ({ ok: false, status: 503 }) })).rejects.toThrow(/503/);
    await expect(sampleEbfePoint(29.78, -95.75, { fetchImpl: async () => okJson({ error: { message: "boom" } }) })).rejects.toThrow(/boom/);
  });
  it("aborts on timeout (bounded fetch — the B874 watchdog pattern)", async () => {
    const fetchImpl = (u, { signal }) => new Promise((_, reject) => {
      if (signal) signal.addEventListener("abort", () => reject(new Error("AbortError")));
    });
    await expect(sampleEbfePoint(29.78, -95.75, { fetchImpl, timeoutMs: 5 })).rejects.toThrow(/Abort/);
  });
  it("caches per location — a second call at the same point does NOT re-fetch", async () => {
    let calls = 0;
    const fetchImpl = async () => { calls++; return okJson(REAL_IN_COVERAGE); };
    await sampleEbfePoint(29.78, -95.75, { fetchImpl });
    await sampleEbfePoint(29.78, -95.75, { fetchImpl });
    expect(calls).toBe(1);
    await sampleEbfePoint(30.10, -95.20, { fetchImpl });
    expect(calls).toBe(2);
  });
  it("non-finite coordinates → null (no fetch)", async () => {
    let calls = 0;
    const fetchImpl = async () => { calls++; return okJson(REAL_IN_COVERAGE); };
    expect(await sampleEbfePoint(NaN, -95, { fetchImpl })).toBeNull();
    expect(calls).toBe(0);
  });
});

describe("the femaEbfe registry row", () => {
  it("is a production identify-raster row pointed at the RASTER sublayers 20 + 24", () => {
    const s = gisSource("femaEbfe");
    expect(s.tier).toBe("production");
    expect(s.kind).toBe("raster-identify");
    expect(s.identifyLayers).toEqual({ bfe1pct: 20, wse02: 24 });
    expect(s.serviceUrl).toContain("txgeo.usgs.gov");
    expect(EBFE_URL).toBe(s.serviceUrl); // the sampler reads the registry, no inline URL
    expect(s.useProxy).toBe(true);
    expect(s.label).toMatch(/screening/i);
  });

  it("carries REAL measured fixtures, not a provisional guess", () => {
    const fx = fixturesFor("femaEbfe");
    expect(fixtureCount(null, fx)).toBeGreaterThan(0);
    // No fixture may still be flagged provisional — that flag is what made the old fixture
    // unfalsifiable, and an unfalsifiable fixture is the same as no fixture at all.
    for (const f of fx.sampleFixtures) expect(f.provisional).toBeUndefined();
    // Both directions are pinned: somewhere it answers, and somewhere it correctly does not.
    expect(fx.sampleFixtures.some((f) => f.expectValueRange)).toBe(true);
    expect(fx.sampleFixtures.some((f) => f.expectNoData)).toBe(true);
  });
});
