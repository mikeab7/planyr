/* NEW-1 (Memphis line band, recurrence ×3 of B2289168) — a lot that exists is never refused because the bundled county
 * geometry put the click on the wrong side of a county or state line.
 *
 * Owner report 2026-10-16: "its still saying no lot here in memphis" — Stateline Rd East between Swinnea and Tchulahoma, the
 * Shelby County TN / DeSoto County MS line. MEASURED (the two county servers are the ground truth, read 2026-10-16): DeSoto's
 * northernmost parcel vertex and Shelby's southernmost meet at ≈34.995°N along the whole line, while the asset draws the line at
 * ≈35.000°N — so every Shelby lot in that ≈550 m strip resolved CONFIDENTLY to DeSoto (not `nearEdge`), was asked of DeSoto
 * alone, and was refused. The fixture lots below are real Shelby Assessor parcels in that strip (PARCELID · owner).
 *
 * RED ON MAIN: `lineNeighbourKeysForPoint` / `identifyWithLineFallback` do not exist there; the browser half is
 * e2e/memphis-line-band.spec.js (the owner's exact clicks, server answers stubbed to the measured truth). */
import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "node:fs";
import { COUNTIES_MAP, countyIdentity, candidateCountiesForPoint, lineNeighbourKeysForPoint, LINE_NEIGHBOUR_DEG, silentServerPhrase, sourceDisplayName } from "../src/workspaces/site-planner/lib/counties.js";
import { setCountyPolygons, countiesNearPoint } from "../src/workspaces/site-planner/lib/countyPolygons.js";
import { identifyWithLineFallback } from "../src/workspaces/site-planner/lib/identifyWithFallback.js";
import { countyOutageMessage } from "../src/workspaces/site-planner/lib/parcelOutageGate.js";

beforeAll(async () => {
  await setCountyPolygons(JSON.parse(readFileSync(new URL("../public/geo/county-polygons.json", import.meta.url), "utf8")));
});

/* Real Shelby lots on the north side of Stateline Rd, inside the strip the asset calls DeSoto (Shelby Assessor CERTParcel,
 * measured 2026-10-16). The owner's screenshot area. */
const FX = JSON.parse(readFileSync(new URL("./fixtures/memphisLineBand.json", import.meta.url), "utf8"));
const OWNER_SPOTS = FX.ownerSpots;

/* A fake county world: `truth(lat,lng)` names the county source that holds a lot at the point; every other source answers
 * "no lot". Each call is recorded so the test can say what was asked, in what order. */
function fakeIdentify(truth, { failOnce = new Set() } = {}) {
  const calls = [];
  const failed = new Set();
  const identify = async (list, lng, lat) => {
    calls.push(list.map((c) => c.county));
    const sources = list.map((c) => {
      if (failOnce.has(c.county) && !failed.has(c.county)) { failed.add(c.county); return { county: c.county, ok: false, hit: false }; }
      return { county: c.county, ok: true, hit: truth(lat, lng) === c.county };
    });
    return { hits: sources.filter((s) => s.hit).map((s) => ({ county: s.county, feature: { attributes: { k: s.county } } })), responded: sources.filter((s) => s.ok).length, sources, complete: true };
  };
  return { identify, calls };
}
const cand = (keys) => keys.filter((k) => COUNTIES_MAP[k]).map((county) => ({ county, url: `u:${county}`, statewide: !!COUNTIES_MAP[county].statewide }));

describe("the owner's spot — Shelby lots north of Stateline Rd", () => {
  it.each(OWNER_SPOTS.map((s) => [s.name, s]))("%s selects its SHELBY lot", async (_n, s) => {
    const primary = cand(candidateCountiesForPoint(s.lat, s.lng));
    const { identify, calls } = fakeIdentify(() => "tn_shelby");
    const res = await identifyWithLineFallback({ primary, neighbours: async () => cand(lineNeighbourKeysForPoint(s.lat, s.lng)), lng: s.lng, lat: s.lat, identify });
    expect(res.hits.map((h) => h.county), `asked ${JSON.stringify(calls)}`).toEqual(["tn_shelby"]);
  });
  it("documents WHY: the asset puts the strip in DeSoto, confidently — routing alone never reaches Shelby", () => {
    const s = OWNER_SPOTS[0];
    const id = countyIdentity(s.lat, s.lng);
    expect(id.name).toBe("DeSoto County");
    expect(id.nearEdge).toBe(false);
    expect(candidateCountiesForPoint(s.lat, s.lng)).not.toContain("tn_shelby");
    expect(lineNeighbourKeysForPoint(s.lat, s.lng)).toContain("tn_shelby");
  });
});

/* Every line the brief names. For each, a point ON the asset's line is found by bisection between an interior point of each
 * county, then points 50 m – 600 m either side are generated (the measured asset error is ≈550 m). Whichever side truly owns
 * the lot, its source must be reachable within the rounds (primary ∪ line neighbours). */
const LINES = FX.lines;
const srcOf = (lat, lng) => { const id = countyIdentity(lat, lng); return id.key || id.statewideKey || null; };
function linePoint(a, b) {
  const sa = srcOf(...a);
  let lo = a, hi = b;
  for (let i = 0; i < 40; i++) {
    const m = [(lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2];
    if (srcOf(...m) === sa) lo = m; else hi = m;
  }
  return lo;
}

describe("adjacent lines — both sides are reachable within the asset's measured error", () => {
  it.each(LINES.map((l) => [l.name, l]))("%s", (_n, l) => {
    expect(srcOf(...l.a), "interior A").toBe(l.A);
    expect(srcOf(...l.b), "interior B").toBe(l.B);
    const p = linePoint(l.a, l.b);
    const d = [l.b[0] - l.a[0], l.b[1] - l.a[1]], n = Math.hypot(...d), u = [d[0] / n, d[1] / n];
    for (const m of [-600, -300, -150, -50, 50, 150, 300, 600]) {
      const deg = m / 111000;
      const pt = [p[0] + u[0] * deg, p[1] + u[1] * deg];
      const reach = new Set([...candidateCountiesForPoint(...pt), ...lineNeighbourKeysForPoint(...pt)]);
      expect(reach.has(l.A), `${l.A} unreachable at ${m} m (${pt})`).toBe(true);
      expect(reach.has(l.B), `${l.B} unreachable at ${m} m (${pt})`).toBe(true);
    }
  });
  it("the reach is bounded: a statewide layer that EXCLUDES the county is never offered for it", () => {
    // Deep inside Shelby, far from any line, the only neighbour is itself — tn_statewide (no Shelby rows) stays out.
    expect(lineNeighbourKeysForPoint(35.1495, -90.049)).toEqual(["tn_shelby"]);
  });
  it("LINE_NEIGHBOUR_DEG covers the worst measured offset with margin (≈550 m)", () => {
    expect(LINE_NEIGHBOUR_DEG * 111000).toBeGreaterThan(2 * 550);
    expect(countiesNearPoint(34.9955, -89.933, LINE_NEIGHBOUR_DEG).map((c) => c.name)).toEqual(["DeSoto County", "Shelby County"]);
  });
});

describe("the rounds — primary first, then a retry of the silent, then the line neighbours", () => {
  it("KNOWN-GOOD ARM — interior Memphis (airport east, downtown) answers on the primary round; no neighbour is asked", async () => {
    for (const [lat, lng] of [[35.03, -89.95], [35.1495, -90.049]]) {
      const { identify, calls } = fakeIdentify(() => "tn_shelby");
      let asked = false;
      const res = await identifyWithLineFallback({ primary: cand(candidateCountiesForPoint(lat, lng)), neighbours: async () => { asked = true; return []; }, lng, lat, identify });
      expect(res.via).toBe("primary");
      expect(asked).toBe(false);
      expect(calls).toEqual([["tn_shelby"]]);
    }
  });
  it("a stalled source is asked once more before anything is reported (measured: a fresh connection answers)", async () => {
    const { identify, calls } = fakeIdentify(() => "tn_shelby", { failOnce: new Set(["tn_shelby"]) });
    const res = await identifyWithLineFallback({ primary: cand(["tn_shelby"]), neighbours: async () => [], lng: -89.95, lat: 35.03, identify });
    expect(res.via).toBe("retry");
    expect(calls).toEqual([["tn_shelby"], ["tn_shelby"]]);
  });
  it("a genuine empty point (a road) asks the neighbours once and reports no lot — never loops", async () => {
    const { identify, calls } = fakeIdentify(() => null);
    const res = await identifyWithLineFallback({ primary: cand(["ms_desoto"]), neighbours: async () => cand(["ms_desoto", "tn_shelby"]), lng: -89.933, lat: 34.9955, identify });
    expect(res.hits).toEqual([]);
    expect(res.responded).toBe(2);
    expect(calls).toEqual([["ms_desoto"], ["tn_shelby"]]); // DeSoto is never asked twice
  });
  it("a primary with NO source (Fulton KY) still asks a neighbour across the line", async () => {
    const { identify, calls } = fakeIdentify(() => "tn_statewide");
    const res = await identifyWithLineFallback({ primary: [], neighbours: async () => cand(["tn_statewide"]), lng: -89.2, lat: 36.5, identify });
    expect(res.via).toBe("neighbour");
    expect(calls).toEqual([["tn_statewide"]]);
  });
  it("every source silent → the message NAMES the server", async () => {
    const identify = async (list) => ({ hits: [], responded: 0, sources: list.map((c) => ({ county: c.county, ok: false })), complete: true });
    const res = await identifyWithLineFallback({ primary: cand(["tn_shelby"]), neighbours: async () => [], lng: -89.95, lat: 35.03, identify });
    expect(res.responded).toBe(0);
    expect(res.silent).toEqual(["tn_shelby"]);
    expect(silentServerPhrase(res.silent)).toBe("Shelby County's parcel server");
  });
});

describe("the slow-server message names the county", () => {
  it("DeSoto (no statewide layer in MS) — the owner's toast, now naming the server", () => {
    expect(sourceDisplayName("ms_desoto")).toBe("DeSoto County");
    expect(countyOutageMessage(false, sourceDisplayName("ms_desoto"))).toMatch(/^DeSoto County's parcel server is slow right now/);
    expect(countyOutageMessage(true, "Shelby County")).toMatch(/^Shelby County's parcel server is slow.*statewide outlines/);
    expect(countyOutageMessage(false)).toMatch(/^That county's parcel server is slow/);
  });
});
