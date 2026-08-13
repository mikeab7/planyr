import { describe, it, expect } from "vitest";
import { samplePoint, sampleProfile, profileQuery, ditchStats, M_TO_FT, DEP_URL, DEP_SERVICE_LABEL } from "../src/workspaces/site-planner/lib/elevation.js";

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

// ---------------------------------------------------------------------------
/* NEW-1 — `profileQuery` is the ONE derivation of a transect request, and the ground-elevation
 * cache keys on its output. If the key and the URL could be built independently they could drift,
 * and a drifted key serves elevation for the wrong ground. */
const TRANSECT = [[-95.7954, 29.782], [-95.7946, 29.782]];

describe("profileQuery — key and URL from one derivation (NEW-1)", () => {
  const path = TRANSECT;
  it("is byte-stable for identical inputs", () => {
    expect(profileQuery(path, 9).url).toBe(profileQuery(path, 9).url);
    expect(profileQuery(path, 9).geometry).toBe(profileQuery(path, 9).geometry);
  });
  it("the URL carries the very geometry string it reports", () => {
    const q = profileQuery(path, 9);
    expect(q.url).toContain(encodeURIComponent(q.geometry));
    expect(q.url).toContain("geometryType=esriGeometryPolyline");
    expect(q.url).toContain("sampleCount=9");
    expect(q.url).toContain("interpolation=RSP_BilinearInterpolation");
  });
  it("a different sampleCount or interpolation is a different request", () => {
    expect(profileQuery(path, 9).url).not.toBe(profileQuery(path, 48).url);
    expect(profileQuery(path, 9, "RSP_NearestNeighbor").url).not.toBe(profileQuery(path, 9).url);
  });
  it("the geometry is a compact, fully-determined string — the whole basis for keying a cache on it", () => {
    const g = profileQuery(path, 9).geometry;
    expect(g).toBe(JSON.stringify({ paths: [path], spatialReference: { wkid: 4326 } }));
    expect(g).toContain("-95.7954");
    expect(g).toContain("4326");
  });
});

/* NEW-3 — a failure must NAME the service, so the owner can tell a slow federal host from a
 * broken app rather than watching an indefinite spinner. */
describe("sampleProfile — bounded, and its failures are named (NEW-3)", () => {
  const path = TRANSECT;
  it("converts metres with the survey foot and preserves no-data POSITION", async () => {
    const f = fakeFetch({ samples: [{ value: "10" }, { value: "NoData" }, { value: "20" }] });
    const out = await sampleProfile(path, 3, 1000, { fetchImpl: f });
    expect(out).toHaveLength(3);
    expect(out[0]).toBeCloseTo(10 * M_TO_FT, 9);
    expect(out[1]).toBeNull();
  });
  it("an HTTP failure names the service", async () => {
    const f = fakeFetch({}, { ok: false, status: 503 });
    await expect(sampleProfile(path, 9, 1000, { fetchImpl: f })).rejects.toThrow(new RegExp(DEP_SERVICE_LABEL));
    await sampleProfile(path, 9, 1000, { fetchImpl: f }).catch((e) => {
      expect(e.service).toBe(DEP_SERVICE_LABEL);
      expect(e.status).toBe(503);
    });
  });
  it("a service error names the service too", async () => {
    const f = fakeFetch({ error: { message: "boom" } });
    await sampleProfile(path, 9, 1000, { fetchImpl: f }).catch((e) => expect(e.service).toBe(DEP_SERVICE_LABEL));
  });
  it("a TIMEOUT is a named, flagged failure — never a bare AbortError", async () => {
    // Honour the signal the way a real fetch does: an aborted request REJECTS.
    const hang = (_u, opts) => new Promise((_r, rej) => {
      opts.signal.addEventListener("abort", () => rej(Object.assign(new Error("aborted"), { name: "AbortError" })));
    });
    await sampleProfile(path, 9, 5, { fetchImpl: hang }).then(
      () => { throw new Error("should not resolve"); },
      (e) => {
        expect(e.timedOut).toBe(true);
        expect(e.service).toBe(DEP_SERVICE_LABEL);
        expect(String(e.message)).toMatch(/timed out/);
      },
    );
  });
  it("a caller signal is CHAINED onto our controller, never substituted for it (the samplePoint rule)", async () => {
    const ctrl = new AbortController();
    const hang = (_u, opts) => new Promise((_r, rej) => { opts.signal.addEventListener("abort", () => rej(Object.assign(new Error("aborted"), { name: "AbortError" }))); });
    const p = sampleProfile(path, 9, 5000, { fetchImpl: hang, signal: ctrl.signal });
    ctrl.abort();
    await expect(p).rejects.toThrow(/abort/i);
  });
});
