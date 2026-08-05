// B882 (scope note 2) — the HCFCD MAAPnext WSE sampler.
//
// NEW-1 (2026-08-05) rewrote what this suite is guarding. The old shape was "the WSE endpoints
// are PROVISIONAL (null), so the sampler is a no-op". Both halves of that are gone:
//   • the endpoints are CONFIRMED now (read from HCFCD's own ArcGIS-Online item catalog), and
//   • the host is DOWN — measured, with an `outage` record in the registry to prove it — so the
//     sampler must THROW a named outage rather than return the null that used to read downstream
//     as "no coverage here". On the owner's core county those are opposite facts.
// The injected-endpoints behaviour (feet through untouched, empty → honest null, HTTP error →
// throw) is unchanged and still guarded, via `ignoreOutage` which is the deliberate escape hatch.
import { describe, it, expect, beforeEach } from "vitest";
import { sampleMaapnextWse, maapnextEndpoints, maapnextOutage, clearMaapnextCache } from "../src/workspaces/site-planner/lib/hcfcdWse.js";
import { gisSource, availabilityProblems, fixtureCount } from "../src/shared/gis/sources.js";

const okJson = (body) => ({ ok: true, json: async () => body });
const sampleBody = (v) => okJson({ samples: v == null ? [] : [{ value: String(v), resolution: 3 }] });
const EPS = { wse1pct: "https://x/MAAPNext/WSE_1pct/ImageServer", wse02: "https://x/MAAPNext/WSE_02pct/ImageServer" };
const LIVE = { ignoreOutage: true }; // bypass the declared outage to exercise the wire behaviour

beforeEach(() => clearMaapnextCache());

describe("the declared outage (NEW-1)", () => {
  it("the registry now carries the CONFIRMED WSE ImageServer endpoints — not nulls", () => {
    const eps = maapnextEndpoints();
    expect(eps.wse1pct).toMatch(/MAAPNext\/WSE_100YR\/ImageServer$/);
    expect(eps.wse02).toMatch(/MAAPNext\/WSE_500YR\/ImageServer$/);
    expect(eps.provisional).toBeUndefined();
  });

  it("reports the outage as a NAMED state carrying why, what it costs, and what replaces it", () => {
    const o = maapnextOutage();
    expect(o).toBeTruthy();
    expect(o.availability).toBe("down");
    expect(o.since).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    // The impact line is the whole point: a Harris estimate without MAAPnext is likely LOW.
    expect(o.impact).toMatch(/higher|low/i);
    expect(o.replacement).toMatch(/none/i);
  });

  it("THROWS an outage-tagged error WITHOUT spending a request — never a silent null", async () => {
    let calls = 0;
    const fetchImpl = async () => { calls++; return sampleBody(1); };
    await expect(sampleMaapnextWse(29.76, -95.37, { endpoints: EPS, fetchImpl })).rejects.toThrow(/unavailable/i);
    expect(calls).toBe(0);
    // The tag is what lets the caller render "not answering" instead of "no coverage".
    await sampleMaapnextWse(29.76, -95.37, { endpoints: EPS, fetchImpl }).catch((e) => {
      expect(e.outage).toBeTruthy();
      expect(e.outage.symptom).toMatch(/fximgservices/);
    });
  });

  it("returning null here would be the BUG, not the fallback (regression guard)", async () => {
    // A null resolves downstream to `maapnextFlags.state = "not-configured"` and the provider
    // simply vanishes from the readout. That is exactly the silence this task exists to remove.
    const r = await sampleMaapnextWse(29.76, -95.37, { endpoints: EPS, fetchImpl: async () => sampleBody(1) }).catch(() => "threw");
    expect(r).toBe("threw");
  });
});

describe("with endpoints injected (the live-configured behavior)", () => {
  it("samples both rasters in FEET, untouched", async () => {
    const fetchImpl = async (u) => sampleBody(u.includes("WSE_1pct") ? 56.7 : 58.9);
    const r = await sampleMaapnextWse(29.76, -95.37, { endpoints: EPS, fetchImpl, ...LIVE });
    expect(r.wse1pctFt).toBeCloseTo(56.7, 5);
    expect(r.wse02Ft).toBeCloseTo(58.9, 5);
  });
  it("out-of-coverage (empty sample) → honest null per band", async () => {
    const fetchImpl = async (u) => sampleBody(u.includes("WSE_1pct") ? 56.7 : null);
    const r = await sampleMaapnextWse(29.76, -95.37, { endpoints: EPS, fetchImpl, ...LIVE });
    expect(r.wse1pctFt).toBeCloseTo(56.7, 5);
    expect(r.wse02Ft).toBeNull();
  });
  it("HTTP / service errors THROW (LOUD-FAILURE → the caller falls through)", async () => {
    await expect(sampleMaapnextWse(29.76, -95.37, { endpoints: EPS, fetchImpl: async () => ({ ok: false, status: 500 }), ...LIVE })).rejects.toThrow(/500/);
  });
  it("caches per location", async () => {
    let calls = 0;
    const fetchImpl = async (u) => { calls++; return sampleBody(u.includes("WSE_1pct") ? 56.7 : 58.9); };
    await sampleMaapnextWse(29.76, -95.37, { endpoints: EPS, fetchImpl, ...LIVE });
    await sampleMaapnextWse(29.76, -95.37, { endpoints: EPS, fetchImpl, ...LIVE });
    expect(calls).toBe(2); // one call per band on the first sample, cached on the second
  });
  it("returns null (provider absent) when there are genuinely no endpoints configured", async () => {
    let calls = 0;
    const fetchImpl = async () => { calls++; return sampleBody(1); };
    expect(await sampleMaapnextWse(29.76, -95.37, { endpoints: { wse1pct: null, wse02: null }, fetchImpl, ...LIVE })).toBeNull();
    expect(calls).toBe(0);
  });
});

describe("the hcfcdMaapnext registry row", () => {
  it("is a production Harris-County raster row, declared DOWN with a complete outage record", () => {
    const s = gisSource("hcfcdMaapnext");
    expect(s.tier).toBe("production");            // it IS the authoritative endpoint …
    expect(s.availability).toBe("down");          // … and it is NOT answering. Both are true.
    expect(s.serviceUrl).toContain("fximgservices.hcfcd.org");
    expect(s.label).toMatch(/screening/i);
    expect(availabilityProblems(s)).toEqual([]);  // the record is complete
  });

  it("carries coverage fixtures, so the weekly drift job can see it recover", () => {
    // This is the hole NEW-1 closed: a fixture-less row is invisible to the verifier, which is
    // exactly how this source rotted for weeks behind a green weekly check.
    expect(fixtureCount(gisSource("hcfcdMaapnext"))).toBeGreaterThan(0);
  });
});
