// B881 (scope note 2) — the HCFCD MAAPnext WSE sampler. The 1%/0.2% WSE ImageServer
// endpoints are PROVISIONAL in the registry (sandbox can't confirm the raster names), so the
// default sampler is a no-op (returns null → the provider is absent → the resolver falls
// through to EBFE). With endpoints injected it behaves exactly like the FBCDD getSamples core:
// FEET through untouched, empty → honest null, HTTP/service error → throw.
import { describe, it, expect, beforeEach } from "vitest";
import { sampleMaapnextWse, maapnextEndpoints, clearMaapnextCache } from "../src/workspaces/site-planner/lib/hcfcdWse.js";
import { gisSource } from "../src/shared/gis/sources.js";

const okJson = (body) => ({ ok: true, json: async () => body });
const sampleBody = (v) => okJson({ samples: v == null ? [] : [{ value: String(v), resolution: 3 }] });
const EPS = { wse1pct: "https://x/MAAPNext/WSE_1pct/ImageServer", wse02: "https://x/MAAPNext/WSE_02pct/ImageServer" };

beforeEach(() => clearMaapnextCache());

describe("provisional (unconfigured) endpoints", () => {
  it("the registry ships MAAPnext WSE endpoints as provisional (null) pending V362", () => {
    const eps = maapnextEndpoints();
    expect(eps.provisional).toBe(true);
    expect(eps.wse1pct).toBeNull();
    expect(eps.wse02).toBeNull();
  });
  it("returns null WITHOUT fetching when no endpoints are configured (provider absent)", async () => {
    let calls = 0;
    const fetchImpl = async () => { calls++; return sampleBody(1); };
    expect(await sampleMaapnextWse(29.76, -95.37, { fetchImpl })).toBeNull();
    expect(calls).toBe(0);
  });
});

describe("with endpoints injected (the live-configured behavior)", () => {
  it("samples both rasters in FEET, untouched", async () => {
    const fetchImpl = async (u) => sampleBody(u.includes("WSE_1pct") ? 56.7 : 58.9);
    const r = await sampleMaapnextWse(29.76, -95.37, { endpoints: EPS, fetchImpl });
    expect(r.wse1pctFt).toBeCloseTo(56.7, 5);
    expect(r.wse02Ft).toBeCloseTo(58.9, 5);
  });
  it("out-of-coverage (empty sample) → honest null per band", async () => {
    const fetchImpl = async (u) => sampleBody(u.includes("WSE_1pct") ? 56.7 : null);
    const r = await sampleMaapnextWse(29.76, -95.37, { endpoints: EPS, fetchImpl });
    expect(r.wse1pctFt).toBeCloseTo(56.7, 5);
    expect(r.wse02Ft).toBeNull();
  });
  it("HTTP / service errors THROW (LOUD-FAILURE → the caller falls through)", async () => {
    await expect(sampleMaapnextWse(29.76, -95.37, { endpoints: EPS, fetchImpl: async () => ({ ok: false, status: 500 }) })).rejects.toThrow(/500/);
  });
  it("caches per location", async () => {
    let calls = 0;
    const fetchImpl = async (u) => { calls++; return sampleBody(u.includes("WSE_1pct") ? 56.7 : 58.9); };
    await sampleMaapnextWse(29.76, -95.37, { endpoints: EPS, fetchImpl });
    await sampleMaapnextWse(29.76, -95.37, { endpoints: EPS, fetchImpl });
    expect(calls).toBe(2); // one call per band on the first sample, cached on the second
  });
});

describe("the hcfcdMaapnext registry row", () => {
  it("is a production Harris-County raster row with provisional WSE endpoints", () => {
    const s = gisSource("hcfcdMaapnext");
    expect(s.tier).toBe("production");
    expect(s.serviceUrl).toContain("fximgservices.hcfcd.org");
    expect(s.wseLayers.provisional).toBe(true);
    expect(s.label).toMatch(/screening/i);
  });
});
