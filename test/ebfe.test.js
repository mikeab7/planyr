// B882 — the FEMA/USGS InFRM EBFE point sampler: /identify parse (layers 17 + 21), the
// no-coverage/timeout → null fallback contract, the throw-on-error contract, and the
// per-location cache. The service publishes FEET (ft-NAVD88); an out-of-coverage point
// returns no result / "NoData" → honest null (the caller falls back to grade).
import { describe, it, expect, beforeEach } from "vitest";
import {
  sampleEbfePoint, foldIdentify, pixelValueOf, ebfeIdentifyUrl, clearEbfeCache, EBFE_URL, EBFE_LAYERS,
} from "../src/workspaces/site-planner/lib/ebfe.js";
import { gisSource } from "../src/shared/gis/sources.js";

const okJson = (body) => ({ ok: true, json: async () => body });
// A realistic identify result for the two raster layers.
const identifyBody = (bfe, wse02) => ({
  results: [
    ...(bfe != null ? [{ layerId: 17, layerName: "1 Percent Water Surface Elevation (ft)", value: String(bfe), attributes: { "Pixel Value": String(bfe) } }] : []),
    ...(wse02 != null ? [{ layerId: 21, layerName: "0.2 Percent (500-yr) WSE", value: String(wse02), attributes: { "Pixel Value": String(wse02) } }] : []),
  ],
});

beforeEach(() => clearEbfeCache());

describe("pixelValueOf", () => {
  it("prefers the raw Pixel Value attribute, else the top-level value", () => {
    expect(pixelValueOf({ attributes: { "Pixel Value": "42.5" }, value: "rendered" })).toBe(42.5);
    expect(pixelValueOf({ value: "37.25" })).toBe(37.25);
  });
  it("treats NoData / empty / non-numeric as null (never a fabricated 0)", () => {
    expect(pixelValueOf({ value: "NoData" })).toBeNull();
    expect(pixelValueOf({ value: "" })).toBeNull();
    expect(pixelValueOf({ attributes: { "Pixel Value": "NoData" }, value: "NoData" })).toBeNull();
    expect(pixelValueOf(null)).toBeNull();
  });
});

describe("foldIdentify", () => {
  it("maps layer 17 → bfe1pctFt and layer 21 → wse02Ft", () => {
    const r = foldIdentify(identifyBody(48.3, 50.1).results, EBFE_LAYERS);
    expect(r.bfe1pctFt).toBeCloseTo(48.3, 5);
    expect(r.wse02Ft).toBeCloseTo(50.1, 5);
  });
  it("a missing layer stays null (partial coverage)", () => {
    expect(foldIdentify(identifyBody(48.3, null).results, EBFE_LAYERS)).toEqual({ bfe1pctFt: 48.3, wse02Ft: null });
    expect(foldIdentify([], EBFE_LAYERS)).toEqual({ bfe1pctFt: null, wse02Ft: null });
  });
});

describe("ebfeIdentifyUrl", () => {
  it("builds an /identify point query against layers 17,21 in WGS84", () => {
    const u = ebfeIdentifyUrl(29.78, -95.75);
    expect(u).toContain(EBFE_URL);
    expect(u).toContain("/identify");
    expect(u).toContain("esriGeometryPoint");
    expect(u).toContain(encodeURIComponent("all:17,21"));
    expect(decodeURIComponent(u)).toContain('"x":-95.75');
    expect(decodeURIComponent(u)).toContain('"wkid":4326');
  });
});

describe("sampleEbfePoint", () => {
  it("returns FEET for both layers, untouched (no metres conversion)", async () => {
    let calledUrl = null;
    const fetchImpl = async (u) => { calledUrl = u; return okJson(identifyBody(48.35, 50.12)); };
    const r = await sampleEbfePoint(29.78, -95.75, { fetchImpl });
    expect(r.bfe1pctFt).toBeCloseTo(48.35, 5);
    expect(r.wse02Ft).toBeCloseTo(50.12, 5);
    expect(calledUrl).toContain("/identify");
  });
  it("out-of-coverage (no results) → both null (the caller falls back to grade)", async () => {
    const r = await sampleEbfePoint(44.0, -110.0, { fetchImpl: async () => okJson({ results: [] }) });
    expect(r).toEqual({ bfe1pctFt: null, wse02Ft: null });
  });
  it("HTTP / service errors THROW (an outage reads failed, never a value — LOUD-FAILURE)", async () => {
    await expect(sampleEbfePoint(29.78, -95.75, { fetchImpl: async () => ({ ok: false, status: 503 }) })).rejects.toThrow(/503/);
    await expect(sampleEbfePoint(29.78, -95.75, { fetchImpl: async () => okJson({ error: { message: "boom" } }) })).rejects.toThrow(/boom/);
  });
  it("aborts on timeout (bounded fetch — the B874 watchdog pattern)", async () => {
    // A fetch that rejects when its AbortSignal fires simulates the timeout abort.
    const fetchImpl = (u, { signal }) => new Promise((_, reject) => {
      if (signal) signal.addEventListener("abort", () => reject(new Error("AbortError")));
    });
    await expect(sampleEbfePoint(29.78, -95.75, { fetchImpl, timeoutMs: 5 })).rejects.toThrow(/Abort/);
  });
  it("caches per location — a second call at the same point does NOT re-fetch", async () => {
    let calls = 0;
    const fetchImpl = async () => { calls++; return okJson(identifyBody(48.35, 50.12)); };
    await sampleEbfePoint(29.78, -95.75, { fetchImpl });
    await sampleEbfePoint(29.78, -95.75, { fetchImpl });
    expect(calls).toBe(1);
    // a different location DOES fetch again
    await sampleEbfePoint(30.10, -95.20, { fetchImpl });
    expect(calls).toBe(2);
  });
  it("non-finite coordinates → null (no fetch)", async () => {
    let calls = 0;
    const fetchImpl = async () => { calls++; return okJson(identifyBody(1, 1)); };
    expect(await sampleEbfePoint(NaN, -95, { fetchImpl })).toBeNull();
    expect(calls).toBe(0);
  });
});

describe("the femaEbfe registry row", () => {
  it("is a production identify-raster row with layers 17 (1% BFE) + 21 (0.2%)", () => {
    const s = gisSource("femaEbfe");
    expect(s.tier).toBe("production");
    expect(s.kind).toBe("raster-identify");
    expect(s.identifyLayers).toEqual({ bfe1pct: 17, wse02: 21 });
    expect(s.serviceUrl).toContain("txgeo.usgs.gov");
    expect(EBFE_URL).toBe(s.serviceUrl); // the sampler reads the registry, no inline URL
    expect(s.label).toMatch(/screening/i);
  });
});
