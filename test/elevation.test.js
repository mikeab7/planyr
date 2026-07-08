import { describe, it, expect } from "vitest";
import { samplePoint, ditchStats, M_TO_FT, DEP_URL } from "../src/workspaces/site-planner/lib/elevation.js";

// Injected-fetch helper (the vectorLayers.test.js pattern) — returns canned 3DEP JSON.
const fakeFetch = (body, { ok = true, status = 200 } = {}) => {
  const fn = async (url) => {
    fn.calls.push(url);
    return { ok, status, json: async () => body };
  };
  fn.calls = [];
  return fn;
};

// ---------------------------------------------------------------------------
describe("samplePoint — the B706 single-point elevation probe", () => {
  it("converts the metre sample with the US survey foot", async () => {
    const f = fakeFetch({ samples: [{ value: "40.553333282" }] });
    const ft = await samplePoint(29.782, -95.795, { fetchImpl: f });
    expect(ft).toBeCloseTo(40.553333282 * M_TO_FT, 6);
    expect(M_TO_FT).toBeCloseTo(3937 / 1200, 12);
  });
  it("asks getSamples for ONE bilinear point at the right service", async () => {
    const f = fakeFetch({ samples: [{ value: "1" }] });
    await samplePoint(29.782, -95.795, { fetchImpl: f });
    const u = f.calls[0];
    expect(u.startsWith(`${DEP_URL}/getSamples?`)).toBe(true);
    expect(u).toContain("geometryType=esriGeometryPoint");
    expect(u).toContain("interpolation=RSP_BilinearInterpolation");
    expect(u).toContain("returnFirstValueOnly=true");
    expect(u).toContain(encodeURIComponent('"x":-95.795'));
    expect(u).toContain(encodeURIComponent('"y":29.782'));
  });
  it("no-data comes back as null (the readout suppresses, never invents)", async () => {
    expect(await samplePoint(29, -95, { fetchImpl: fakeFetch({ samples: [{ value: "NoData" }] }) })).toBeNull();
    expect(await samplePoint(29, -95, { fetchImpl: fakeFetch({ samples: [] }) })).toBeNull();
  });
  it("HTTP and service errors THROW (LOUD-FAILURE) — they never read as a value", async () => {
    await expect(samplePoint(29, -95, { fetchImpl: fakeFetch({}, { ok: false, status: 503 }) }))
      .rejects.toThrow(/503/);
    await expect(samplePoint(29, -95, { fetchImpl: fakeFetch({ error: { message: "boom" } }) }))
      .rejects.toThrow(/boom/);
  });
});

// ---------------------------------------------------------------------------
describe("ditchStats — existing pure reducer (first dedicated coverage)", () => {
  it("places surviving samples at true fractional distance and skips voids (B58)", () => {
    const s = ditchStats([100, null, 96, null, 100], 400);
    expect(s.profile.map((p) => p.d)).toEqual([0, 200, 400]);
    expect(s.invertFt).toBe(96);
    expect(s.bankFt).toBe(100);
    expect(s.depthFt).toBe(4);
  });
  it("refuses degenerate input (B23: a single sample must not NaN)", () => {
    expect(ditchStats([100], 100)).toBeNull();
    expect(ditchStats([null, 100, null], 100)).toBeNull();
    expect(ditchStats(null, 100)).toBeNull();
  });
});
