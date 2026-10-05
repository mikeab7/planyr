import { describe, it, expect, vi } from "vitest";
import { runTrustedChecks, assertMeasurement, ringsHash, VERDICT_CACHE_VERSION } from "../src/workspaces/site-planner/lib/siteChecksRun.js";
import { createGisCache } from "../src/workspaces/site-planner/lib/gisCache.js";
import { GisFetchError } from "../src/workspaces/site-planner/lib/gisFetch.js";

/* The FAILURE contract (owner, 2026-10-05): a trusted source that errors, times out, or answers a bad query
 * with zero features must NEVER render "None" or green. Every path is forced here through the real
 * runner with an injected transport, and the verdict asserted on the ROW the panel renders. */

const LAT0 = 29.80, LNG0 = -95.00;
const FT_LAT = 364567, FT_LNG = 364567 * Math.cos((LAT0 * Math.PI) / 180);
const rect = (x0, y0, x1, y1, lng = LNG0, lat = LAT0) => {
  const p = (x, y) => [lng + x / FT_LNG, lat + y / FT_LAT];
  return [p(x0, y0), p(x1, y0), p(x1, y1), p(x0, y1)];
};
const SITE = [rect(0, 0, 1000, 1000)];
const esri = (ring) => ({ rings: [ring] });

function makeStore() {
  const map = new Map();
  return { getItem: (k) => (map.has(k) ? map.get(k) : null), setItem: (k, v) => { map.set(k, v); }, removeItem: (k) => map.delete(k), get length() { return map.size; }, key: (i) => Array.from(map.keys())[i] ?? null };
}
const freshCache = () => createGisCache({ store: makeStore(), now: () => 1_000_000 });

const FLOOD_OK = [{ attributes: { FLD_ZONE: "X", ZONE_SUBTY: "AREA OF MINIMAL FLOOD HAZARD" }, geometry: esri(rect(-50, -50, 1050, 1050)) }];
/* A transport routed by host fragment → a response (or a thrown error). */
const transport = (routes) => {
  const fn = vi.fn(async (url, o) => {
    const key = Object.keys(routes).find((k) => url.includes(k));
    if (!key) throw new Error("no route for " + url);
    const r = routes[key](url, o);
    if (r instanceof Error) throw r;
    return r;
  });
  return fn;
};
const HOSTS = { flood: "hazards.fema.gov", wetlands: "fwsprimary.wim.usgs.gov", rrc: "gis.rrc.texas.gov" };
const happy = () => ({
  [HOSTS.flood]: () => ({ features: FLOOD_OK }),
  [HOSTS.wetlands]: () => ({ features: [] }),
  [HOSTS.rrc]: () => ({ features: [] }),
});
const byId = (res) => Object.fromEntries(res.rows.map((r) => [r.id, r]));

describe("happy path — every trusted check answers, a clean Texas site is all green", () => {
  it("five rows, in order, all green with 'None'", async () => {
    const res = await runTrustedChecks(SITE, { cache: freshCache(), fetchJson: transport(happy()) });
    expect(res.rows.map((r) => r.id)).toEqual(["flood100", "flood500", "wetlands", "pipelines", "wells"]);
    for (const r of res.rows) { expect(r.severity, r.id).toBe("green"); expect(r.figure).toBe("None"); }
  });
});

describe("FAILURE — a source that fails is 'Couldn't check', never None, never green", () => {
  const FAILS = {
    "a timeout": () => new GisFetchError("timeout", "The GIS source didn't respond in time — it may be busy.", { retryable: true }),
    "an HTTP 503": () => new GisFetchError("http-5xx", "The GIS source returned HTTP 503 — temporarily unavailable.", { status: 503, retryable: true }),
    "a network failure": () => new TypeError("Failed to fetch"),
    "an ArcGIS {error} body (a bad query the server answered politely)": () => new GisFetchError("arcgis", "ArcGIS error 400: Unable to complete operation.", { arcgisCode: 400 }),
  };
  for (const [name, mk] of Object.entries(FAILS)) {
    it(`${name}: all five rows fail loudly`, async () => {
      const res = await runTrustedChecks(SITE, { cache: freshCache(), fetchJson: transport({ [HOSTS.flood]: mk, [HOSTS.wetlands]: mk, [HOSTS.rrc]: mk }) });
      expect(res.rows).toHaveLength(5);
      for (const r of res.rows) {
        expect(r.severity, r.id).toBe("failed");
        expect(r.figure).toBe("Couldn't check");
        expect(r.retry).toBe(true);
        expect(`${r.figure} ${r.line}`).not.toMatch(/\bNone\b/);
      }
    });
  }
  it("a 200 with NO features array (a bad query answered politely) is a failure, not '0 features'", async () => {
    const res = await runTrustedChecks(SITE, { cache: freshCache(), fetchJson: transport({ [HOSTS.flood]: () => ({}), [HOSTS.wetlands]: () => ({ count: 0 }), [HOSTS.rrc]: () => ({ features: null }) }) });
    for (const r of res.rows) expect(r.severity, r.id).toBe("failed");
  });
  it("an {error} OBJECT returned (not thrown) by a transport is a failure too", async () => {
    const res = await runTrustedChecks(SITE, { cache: freshCache(), fetchJson: transport({ [HOSTS.flood]: () => ({ error: { code: 400, message: "bad" } }), [HOSTS.wetlands]: () => ({ error: { code: 500 } }), [HOSTS.rrc]: () => ({ error: { code: 400 } }) }) });
    for (const r of res.rows) expect(r.severity, r.id).toBe("failed");
  });
  it("features that carry NO geometry cannot be measured, so the row fails", async () => {
    const res = await runTrustedChecks(SITE, { cache: freshCache(), fetchJson: transport({
      ...happy(),
      [HOSTS.flood]: () => ({ features: [{ attributes: { FLD_ZONE: "AE" } }] }),
      [HOSTS.rrc]: () => ({ features: [{ attributes: { OPERATOR: "X" } }] }),
    }) });
    const r = byId(res);
    expect(r.flood100.severity).toBe("failed"); expect(r.flood500.severity).toBe("failed");
    expect(r.pipelines.severity).toBe("failed"); expect(r.wells.severity).toBe("failed");
    expect(r.wetlands.severity).toBe("green"); // an honestly empty NWI answer is still a real "None"
  });
  it("a result still truncated after the page cap fails (a partial area would understate the site)", async () => {
    const res = await runTrustedChecks(SITE, { cache: freshCache(), fetchJson: transport({ ...happy(), [HOSTS.flood]: () => ({ features: FLOOD_OK, exceededTransferLimit: true }) }) });
    expect(byId(res).flood100.severity).toBe("failed");
  });
  it("ONE group failing does not take the others down, and does not dress itself green", async () => {
    const res = await runTrustedChecks(SITE, { cache: freshCache(), fetchJson: transport({ ...happy(), [HOSTS.rrc]: () => new GisFetchError("timeout", "slow", {}) }) });
    const r = byId(res);
    expect(r.pipelines.severity).toBe("failed"); expect(r.wells.severity).toBe("failed");
    expect(r.flood100.severity).toBe("green"); expect(r.wetlands.severity).toBe("green");
  });
  it("a failure with an OLDER stored copy behind it is STILL a failure (never a stale verdict)", async () => {
    let now = 1_000_000;
    const cache = createGisCache({ store: makeStore(), now: () => now });
    await runTrustedChecks(SITE, { cache, fetchJson: transport(happy()) });
    now += 40 * 24 * 3600 * 1000; // past every TTL
    const res = await runTrustedChecks(SITE, { cache, fetchJson: transport({ [HOSTS.flood]: () => new Error("down"), [HOSTS.wetlands]: () => new Error("down"), [HOSTS.rrc]: () => new Error("down") }) });
    for (const r of res.rows) expect(r.severity, r.id).toBe("failed");
  });
  it("FEMA answering with no polygon at all is amber 'Not fully mapped', never the green 'None'", async () => {
    const res = await runTrustedChecks(SITE, { cache: freshCache(), fetchJson: transport({ ...happy(), [HOSTS.flood]: () => ({ features: [] }) }) });
    expect(byId(res).flood100.severity).toBe("amber");
    expect(byId(res).flood100.figure).toBe("Not fully mapped");
  });
  it("Retry on the 100-year row also refreshes its 500-year twin (they share one FEMA answer)", async () => {
    const cache = freshCache();
    await runTrustedChecks(SITE, { cache, fetchJson: transport({ ...happy(), [HOSTS.flood]: () => new Error("down") }) });
    const res = await runTrustedChecks(SITE, { cache, fetchJson: transport(happy()), only: ["flood100"], force: true });
    expect(res.rows.map((r) => r.id)).toEqual(["flood100", "flood500"]);
    for (const r of res.rows) expect(r.severity).not.toBe("failed");
  });
  it("Retry re-asks ONLY the named check and bypasses its stored answer", async () => {
    const cache = freshCache();
    const first = transport({ ...happy(), [HOSTS.rrc]: () => new Error("down") });
    await runTrustedChecks(SITE, { cache, fetchJson: first });
    const second = transport(happy());
    const res = await runTrustedChecks(SITE, { cache, fetchJson: second, only: ["pipelines"], force: true });
    expect(res.rows.map((r) => r.id)).toEqual(["pipelines"]);
    expect(res.rows[0].severity).toBe("green");
    expect(second.mock.calls.every(([u]) => u.includes(HOSTS.rrc))).toBe(true);
  });
});

describe("REGION GATE — no RRC verdict (and no RRC request) off Texas ground", () => {
  const CO = [rect(0, 0, 1000, 1000, -104.99, 39.74)];
  const GA = [rect(0, 0, 1000, 1000, -84.39, 33.75)];
  const SHREVEPORT = [rect(0, 0, 1000, 1000, -93.75, 32.5)];
  const STRADDLE = [...SITE, ...CO];
  for (const [name, ring] of [["Colorado", CO], ["Georgia", GA], ["Shreveport (inside the Texas box, outside Texas)", SHREVEPORT], ["a Texas+Colorado straddle", STRADDLE]]) {
    it(`${name}: pipelines + wells get no verdict and the RRC is never asked; FEMA + NWI still answer`, async () => {
      const t = transport(happy());
      const res = await runTrustedChecks(ring, { cache: freshCache(), fetchJson: t });
      expect(res.rows.map((r) => r.id)).toEqual(["flood100", "flood500", "wetlands"]);
      expect(res.untrusted.sort()).toEqual(["pipelines", "wells"]);
      expect(t.mock.calls.some(([u]) => u.includes(HOSTS.rrc))).toBe(false);
    });
  }
  it("a Texas site DOES ask the RRC", async () => {
    const t = transport(happy());
    await runTrustedChecks(SITE, { cache: freshCache(), fetchJson: t });
    expect(t.mock.calls.some(([u]) => u.includes(HOSTS.rrc))).toBe(true);
  });
});

describe("severity through the real runner — crossing / near / none on the wire", () => {
  const lineFeat = (pts, op = "CHEVRON PIPE LINE COMPANY") => ({ attributes: { OPERATOR: op }, geometry: { paths: [pts.map(([x, y]) => [LNG0 + x / FT_LNG, LAT0 + y / FT_LAT])] } });
  const run = (feats, extra = {}) => runTrustedChecks(SITE, { cache: freshCache(), fetchJson: transport({ ...happy(), [HOSTS.rrc]: (u) => (u.includes("/13/") ? { features: feats } : { features: [] }) }), ...extra });
  it("a crossing pipeline → red, 'Crosses'", async () => {
    const r = byId(await run([lineFeat([[-300, 500], [1300, 500]])]));
    expect(r.pipelines.severity).toBe("red"); expect(r.pipelines.figure).toBe("Crosses");
  });
  it("a pipeline 200 ft off → amber with a ~distance and a direction", async () => {
    const r = byId(await run([lineFeat([[1200, -300], [1200, 1300]])]));
    expect(r.pipelines.severity).toBe("amber"); expect(r.pipelines.figure).toMatch(/^~\d+ ft$/);
    expect(r.pipelines.line).toContain("east");
  });
  it("a crowded corridor (answer hits the cap) triggers the unbuffered ON-SITE pass so a crossing cannot hide", async () => {
    const decoys = Array.from({ length: 200 }, (_, i) => lineFeat([[1200 + i, -300], [1200 + i, 1300]]));
    const cross = lineFeat([[-300, 500], [1300, 500]]);
    let call = 0;
    const t = transport({ ...happy(), [HOSTS.rrc]: (u) => (u.includes("/13/") ? { features: (call++ === 0 ? decoys : [cross]), exceededTransferLimit: call === 1 } : { features: [] }) });
    const r = byId(await runTrustedChecks(SITE, { cache: freshCache(), fetchJson: t }));
    expect(r.pipelines.severity).toBe("red");
  });
});

describe("STALE PERSISTED VERDICTS — the cache holds measurements under a versioned key, never verdicts", () => {
  it("an old-version stored 'green' answer is never read: the source is asked again", async () => {
    const cache = freshCache();
    const hash = ringsHash(SITE, []);
    // what the OLD remembered state would have looked like — keyed under the previous scheme, saying "all clear"
    for (const old of ["v1", "v0"]) for (const g of ["flood", "wetlands", "pipelines", "wells"]) cache.write(`siteverdict:${old}:${g}:0.25:${hash}`, { severity: "green", figure: "None" });
    cache.write(`analysis:flood:1_${hash}`, [{ FLD_ZONE: "X" }]);
    const t = transport({ ...happy(), [HOSTS.flood]: () => ({ features: [{ attributes: { FLD_ZONE: "AE" }, geometry: esri(rect(-50, -50, 1050, 1050)) }] }) });
    const res = await runTrustedChecks(SITE, { cache, fetchJson: t });
    expect(t).toHaveBeenCalled();
    expect(byId(res).flood100.severity).toBe("red");
    expect(VERDICT_CACHE_VERSION).toBe("v2");
  });
  it("a current stored measurement is reclassified with TODAY's thresholds", async () => {
    const cache = freshCache();
    const lineFeat = { attributes: { OPERATOR: "X" }, geometry: { paths: [[[LNG0 + 1200 / FT_LNG, LAT0 - 300 / FT_LAT], [LNG0 + 1200 / FT_LNG, LAT0 + 1300 / FT_LAT]]] } };
    const t = transport({ ...happy(), [HOSTS.rrc]: (u) => (u.includes("/13/") ? { features: [lineFeat] } : { features: [] }) });
    const a = await runTrustedChecks(SITE, { cache, fetchJson: t, thresholds: { nearRadiusMi: 0.25 } });
    expect(byId(a).pipelines.severity).toBe("amber");
    // same stored measurement is NOT reused across a different radius (it is part of the key) — and a tighter one reads green
    const b = await runTrustedChecks(SITE, { cache, fetchJson: t, thresholds: { nearRadiusMi: 0.01 } });
    expect(byId(b).pipelines.severity).toBe("green");
  });
  it("the rings hash covers every coordinate, not just the bbox", () => {
    const a = [[[0, 0], [10, 0], [10, 10], [0, 10]]], b = [[[0, 0], [10, 0], [10, 10], [5, 3], [0, 10]]];
    expect(ringsHash(a)).not.toBe(ringsHash(b));
    expect(ringsHash(a, [])).not.toBe(ringsHash(a, [[[1, 1], [2, 1], [2, 2]]]));
  });
});

describe("review findings — runner", () => {
  it("polygons with no flood-zone attribute fail (they would all read 'mapped, not floodplain')", async () => {
    const res = await runTrustedChecks(SITE, { cache: freshCache(), fetchJson: transport({ ...happy(), [HOSTS.flood]: () => ({ features: [{ attributes: {}, geometry: esri(rect(-50, -50, 1050, 1050)) }] }) }) });
    expect(byId(res).flood100.severity).toBe("failed");
  });
  it("empty paths / empty rings are unusable geometry → failed, never a zero-count green", async () => {
    const res = await runTrustedChecks(SITE, { cache: freshCache(), fetchJson: transport({ ...happy(), [HOSTS.rrc]: () => ({ features: [{ attributes: {}, geometry: { paths: [] } }] }) }) });
    expect(byId(res).pipelines.severity).toBe("failed");
    expect(byId(res).wells.severity).toBe("failed");
  });
  it("an incomplete stored measurement throws, never falls through to green", () => {
    for (const g of ["flood", "wetlands", "pipelines", "wells"]) expect(() => assertMeasurement(g, {})).toThrow();
  });
  it("a joined layer that rejects orderByFields (live NWI: HTTP 400) still answers — the first read is unordered", async () => {
    const t = transport({ ...happy(), [HOSTS.wetlands]: (u) => (u.includes("orderByFields") ? new GisFetchError("arcgis", "Invalid or missing input parameters.", { arcgisCode: 400 }) : { features: [] }) });
    const res = await runTrustedChecks(SITE, { cache: freshCache(), fetchJson: t });
    expect(byId(res).wetlands.severity).toBe("green");
  });
  it("only a TRUNCATED answer pages, from the top, every page ordered by the layer's own id field", async () => {
    let n = 0;
    const t = transport({ ...happy(), [HOSTS.flood]: (u) => (++n === 1 ? { features: FLOOD_OK, exceededTransferLimit: true, objectIdFieldName: "OBJECTID" } : { features: FLOOD_OK }) });
    const res = await runTrustedChecks(SITE, { cache: freshCache(), fetchJson: t });
    const floodCalls = t.mock.calls.filter(([u]) => u.includes(HOSTS.flood)).map(([u]) => u);
    expect(floodCalls[0]).not.toContain("orderByFields");
    expect(floodCalls.slice(1).every((u) => u.includes("orderByFields=OBJECTID"))).toBe(true);
    expect(byId(res).flood100.severity).not.toBe("failed");
  });
});
