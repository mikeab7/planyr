import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "node:fs";
import { COUNTIES, COUNTIES_MAP, candidateCountiesForPoint } from "../src/workspaces/site-planner/lib/counties.js";
import { setCountyPolygons } from "../src/workspaces/site-planner/lib/countyPolygons.js";
import { expandCase, judgePoint, judgeCase, rollup, mutantsOf } from "../ui-audit/lib/countyParcelRunner.mjs";
import { CASES } from "../ui-audit/county-parcels/cases.mjs";

/* NEW-1 (2026-11-13) — the county-parcel verification runner (ui-audit/verify-county-parcels.mjs).
 * Two halves, both offline:
 *   1. the pure VERDICT logic, against synthetic observations, including a deliberately wrong twin that MUST go red
 *      (a runner that cannot go red is not evidence — AGENT-RULES "demand a positive control");
 *   2. the TABLE itself, checked against the shipped registry, so a bad row (a typo'd key, a layer regex that no longer
 *      matches the registered URL, a routing claim the shipped router contradicts) fails CI without touching a county server. */
const cfgFor = (k) => ({ ...COUNTIES[k], ...COUNTIES_MAP[k], idField: (COUNTIES_MAP[k] || {}).idField ?? (COUNTIES[k] || {}).idField });

beforeAll(async () => {
  await setCountyPolygons(JSON.parse(readFileSync(new URL("../public/geo/county-polygons.json", import.meta.url), "utf8")));
});

const feat = (attrs) => ({ attributes: attrs, geometry: { rings: [[[0, 0], [0, 1], [1, 1], [0, 0]]] } });
const pt = { label: "x", lat: 1, lng: 2, routes: ["k"], live: true, answeredBy: "k", pin: /^\d{3}$/, layer: /\/L\/0$/ };
const obs = (over = {}) => ({
  candidates: ["k"], probes: {},
  live: { results: { k: { layerUrl: "https://h.example/L/0", feature: feat({ PIN: "123" }), error: null } }, requests: ["https://h.example/L/0/query?f=json"] },
  ...over,
});
const cfg = () => ({ idField: "PIN" });

describe("judgePoint — verdicts", () => {
  it("PASS when routing, PIN shape, layer and request count all hold", () => {
    const v = judgePoint(pt, obs(), cfg);
    expect(v.status).toBe("PASS");
    expect(v.evidence.pin).toBe("123");
  });
  it("FAIL(routing) when the router picks a different source set", () => {
    const v = judgePoint(pt, obs({ candidates: ["k", "other"] }), cfg);
    expect(v.status).toBe("FAIL"); expect(v.cause).toBe("routing");
  });
  it("FAIL(source) when the county returns no parcel at a point confirmed to be inside a lot", () => {
    const o = obs(); o.live.results.k.feature = null;
    const v = judgePoint(pt, o, cfg);
    expect(v.status).toBe("FAIL"); expect(v.cause).toBe("source");
  });
  it("VOID — not FAIL — when the same empty answer comes from a point not confirmed to be inside a lot", () => {
    const o = obs(); o.live.results.k.feature = null;
    expect(judgePoint({ ...pt, interior: false }, o, cfg).status).toBe("VOID");
  });
  it("FAIL(source) on an ArcGIS error body or HTTP error — the server answered, wrongly", () => {
    const o = obs(); o.live.results.k = { layerUrl: "https://h.example/L/0", feature: null, error: { kind: "arcgis", message: "Token Required", status: 499 } };
    const v = judgePoint(pt, o, cfg);
    expect(v.status).toBe("FAIL"); expect(v.cause).toBe("source");
  });
  it("VOID(egress) on a network failure, with routing still judged", () => {
    const o = obs({ probes: { "h.example": "the egress proxy refused the tunnel" } });
    o.live.results.k = { layerUrl: "https://h.example/L/0", feature: null, error: { kind: "network", message: "x" } };
    const v = judgePoint(pt, o, cfg);
    expect(v.status).toBe("VOID"); expect(v.cause).toBe("egress"); expect(v.void).toMatch(/egress proxy/);
    // …and a routing mismatch on the same point is still a FAIL, not hidden behind the VOID
    expect(judgePoint(pt, { ...o, candidates: ["wrong"] }, cfg).status).toBe("FAIL");
  });
  it("FAIL(shape) on a wrong PIN shape, a wrong layer, or an empty PIN", () => {
    expect(judgePoint({ ...pt, pin: /^\d{13}$/ }, obs(), cfg).cause).toBe("shape");
    expect(judgePoint({ ...pt, layer: /Other/ }, obs(), cfg).cause).toBe("shape");
    const o = obs(); o.live.results.k.feature = feat({ PIN: "  " });
    expect(judgePoint(pt, o, cfg).cause).toBe("shape");
  });
  it("attrs: an extra attribute expectation passes when present and fails when missing", () => {
    const o = obs(); o.live.results.k.feature = feat({ PIN: "123", OWNER: "ACME LLC" });
    expect(judgePoint({ ...pt, attrs: { OWNER: /ACME/ } }, o, cfg).status).toBe("PASS");
    expect(judgePoint({ ...pt, attrs: { OWNER: /NOBODY/ } }, o, cfg).cause).toBe("shape");
    expect(judgePoint({ ...pt, attrs: { SITUS: /./ } }, o, cfg).status).toBe("FAIL");
  });
  it("FAIL when more parcel requests fired than the row allows, or a forbidden host was asked", () => {
    const o = obs(); o.live.requests.push("https://h2.example/x/query?f=json");
    expect(judgePoint(pt, o, cfg).status).toBe("FAIL");
    expect(judgePoint({ ...pt, requests: 5, noRequestTo: ["h.example"] }, obs(), cfg).status).toBe("FAIL");
  });
  it("routing-only: the live half is VOID, never PASS", () => {
    expect(judgePoint(pt, { candidates: ["k"], live: null, probes: {} }, cfg).status).toBe("VOID");
    expect(judgePoint({ ...pt, live: false }, { candidates: ["k"], live: null, probes: {} }, cfg).status).toBe("PASS");
  });
  it("every mutant of a passing point goes RED (the judge can see the defects it claims to)", () => {
    for (const m of mutantsOf(pt)) expect(judgePoint(m.point, obs(), cfg).status, m.name).toBe("FAIL");
  });
  it("distinct: repeated PINs across a case fail it; rollup ranks FAIL > VOID > PASS", () => {
    const a = judgePoint(pt, obs(), cfg), b = judgePoint(pt, obs(), cfg);
    const checks = judgeCase({ distinct: true }, [a, b]);
    expect(checks[0].ok).toBe(false);
    expect(rollup([a, b], checks)).toBe("FAIL");
    expect(rollup([a, { status: "VOID" }])).toBe("VOID");
    expect(rollup([a, b])).toBe("PASS");
  });
});

describe("the table — checked against the shipped registry (no network)", () => {
  it("has unique ids and well-formed ledger ids", () => {
    const ids = CASES.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const c of CASES) { expect(c.id).toMatch(/^[a-z0-9-]+$/); for (const v of c.covers || []) expect(v).toMatch(/^V\d+$/); }
  });
  const points = CASES.flatMap(expandCase);
  it("covers the seven first rows' ledger items", () => {
    const covered = new Set(CASES.flatMap((c) => c.covers || []));
    for (const v of ["V1179280", "V1179281", "V1179282", "V1179283", "V1179284", "V1179285", "V1179286"]) expect(covered.has(v), v).toBe(true);
  });
  for (const p of points) {
    it(`${p.caseId} · ${p.label}: routing claims hold against the shipped router`, () => {
      const got = candidateCountiesForPoint(p.lat, p.lng);
      if (p.routes) expect([...got].sort()).toEqual([...p.routes].sort());
      for (const k of p.routesNot || []) expect(got).not.toContain(k);
      for (const k of p.routesInclude || []) expect(got).toContain(k);
    });
    if (p.live) {
      it(`${p.caseId} · ${p.label}: answeredBy is a candidate and its registered layer matches the row`, () => {
        expect(p.answeredBy, "live rows must name answeredBy").toBeTruthy();
        expect(candidateCountiesForPoint(p.lat, p.lng)).toContain(p.answeredBy);
        const c = cfgFor(p.answeredBy);
        expect(c.layerUrl, p.answeredBy).toBeTruthy();
        if (p.layer) expect(c.layerUrl).toMatch(p.layer);
        if (p.pin) expect(c.idField || p.field, "need an id field to read the PIN from").toBeTruthy();
      });
    }
  }
});
