/* B2233521 (round 5) — the plan-open road warm-up. The dissolved road network (roadNetSteps) is one function with two drivers: the render's memo runs it to completion, the
 * seed's warm-up runs it in slices BEFORE the render. This pins the three things that make that safe and worth having:
 *   1. the warm-up PRIMES exactly what the render then asks for — on the owner's real Bolt-on and Richfield rows, after a warm-up the render's own run makes NO
 *      cache miss (dissolve / stripe clip / road ring), even though it is handed different element OBJECTS (the caches are by value);
 *   2. the answer is the same whether or not it was warmed (a warm-up can change speed, never geometry);
 *   3. the warm-up really IS sliced (it yields many times — a single synchronous call is the defect this fixes), and the by-value ring cache is a cache.
 * Red-proof: with the caches disabled (cleared between the two runs) the "no miss" assertions fail — see the control at the bottom of each case. */
import { describe, it, expect, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { rowsToModel } from "../src/workspaces/site-planner/lib/elementRows.js";
import { createSiteModel } from "../src/workspaces/site-planner/lib/siteModel.js";
import {
  roadNetworkStats, resetRoadNetworkCaches, dissolveRingsSteps, dissolveRings, roadSurfaceRing,
} from "../src/workspaces/site-planner/lib/roadNetwork.js";
import { roadNetSteps, driveSteps, roadNetInputs, warmRoadNetFromEls } from "../src/workspaces/site-planner/lib/roadNetBuild.js";

const fixture = (f) => JSON.parse(readFileSync(new URL(`../ui-audit/fixtures/plan-load/${f}.json`, import.meta.url), "utf8"));
const plan = (f) => {
  const { header, rows } = fixture(f);
  const m = createSiteModel({ ...header, ...rowsToModel(header, rows) });
  return { els: m.els, settings: m.settings, rows, header };
};
const clone = (x) => JSON.parse(JSON.stringify(x));
const norm = (net) => JSON.stringify(net, (k, v) => (v instanceof Map ? [...v.entries()] : v instanceof Set ? [...v] : v));
const misses = () => ({ dissolve: roadNetworkStats.dissolveCalls - roadNetworkStats.dissolveHits, clip: roadNetworkStats.clipCalls - roadNetworkStats.clipHits });
const countTicks = () => { let n = 0; return { tick: async () => { n++; await Promise.resolve(); }, get n() { return n; } }; };

beforeEach(() => resetRoadNetworkCaches());

describe.each(["bolt-on", "richfield-concept-a-live"])("road warm-up on %s", (name) => {
  const P = plan(name);
  it("the plan really has a road network (precondition — else every assertion below is vacuous)", async () => {
    const net = driveSteps(roadNetSteps(await roadNetInputs(P.els, P.settings)));
    expect(net.regions.length).toBeGreaterThan(0);
    expect(net.stripes.size).toBeGreaterThan(0);
  });

  /* `calls - hits` also counts calls that never reach the cache (a stripe with no cutter near it returns early), so "no miss" is asserted as STEADY STATE: the render's first
   * run after the warm-up asks the cache for exactly as much new work as a second, certainly-warm run does — none. */
  const renderDelta = async (els, settings) => {
    const b = misses();
    driveSteps(roadNetSteps(await roadNetInputs(els, settings)));
    const a = misses();
    return { dissolve: a.dissolve - b.dissolve, clip: a.clip - b.clip };
  };

  it("a warm-up leaves the render's own run with NO cache miss, on different element objects", async () => {
    const t = countTicks();
    await warmRoadNetFromEls(P.els, P.settings, t.tick);
    const first = await renderDelta(clone(P.els), P.settings);     // same values, none of the same objects
    const steady = await renderDelta(clone(P.els), P.settings);
    expect(first.dissolve).toBe(0);
    expect(first.clip).toBe(steady.clip);
    expect(t.n).toBeGreaterThan(8);                                // sliced, not one call
  });

  it("control (red-proof): with the caches cleared between warm-up and render, the render DOES miss", async () => {
    await warmRoadNetFromEls(P.els, P.settings, async () => {});
    resetRoadNetworkCaches();
    const first = await renderDelta(clone(P.els), P.settings);
    const steady = await renderDelta(clone(P.els), P.settings);
    expect(first.dissolve).toBeGreaterThan(0);
    expect(first.clip).toBeGreaterThan(steady.clip);
  });

  it("warmed and cold runs give the same network", async () => {
    const cold = norm(driveSteps(roadNetSteps(await roadNetInputs(P.els, P.settings))));
    resetRoadNetworkCaches();
    await warmRoadNetFromEls(P.els, P.settings, async () => {});
    const warmed = norm(driveSteps(roadNetSteps(await roadNetInputs(clone(P.els), P.settings))));
    expect(warmed).toBe(cold);
  });
});

describe("dissolve as steps / road ring cache", () => {
  const ring = (x, y, w) => [{ x, y }, { x: x + w, y }, { x: x + w, y: y + w }, { x, y: y + w }];
  it("dissolveRings (sync) equals the stepped form driven to the end, and the stepped form yields", () => {
    const rings = [ring(0, 0, 40), ring(30, 10, 40), ring(60, 0, 30)];
    const gen = dissolveRingsSteps(rings); let yields = 0, r;
    for (;;) { r = gen.next(); if (r.done) break; yields++; }
    resetRoadNetworkCaches();
    expect(JSON.stringify(dissolveRings(rings))).toBe(JSON.stringify(r.value));
    expect(yields).toBeGreaterThanOrEqual(3);
  });
  it("roadSurfaceRing answers the same road from the cache (and a different width is a different road)", () => {
    const pts = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 160, y: 40 }];
    const a = roadSurfaceRing(pts, 36), b = roadSurfaceRing(pts.map((p) => ({ ...p })), 36), c = roadSurfaceRing(pts, 44);
    expect(a).toBeTruthy();
    expect(b).toBe(a);                                    // by value, not identity: a fresh array of the same points hits
    expect(c).not.toBe(a);
    expect(roadSurfaceRing([{ x: 0, y: 0 }, { x: 100.5, y: 0 }, { x: 160, y: 40 }], 36)).not.toBe(a);   // a road that really moved is recomputed
  });
});

describe("wiring (source guards)", () => {
  const sp = readFileSync(new URL("../src/workspaces/site-planner/SitePlanner.jsx", import.meta.url), "utf8");
  it("the render's memo drives the SAME steps the warm-up does", () => {
    expect(sp).toMatch(/const roadNet = useMemo\(\(\) => \{[\s\S]{0,400}return driveSteps\(roadNetSteps\(\{/);
    expect(sp).toMatch(/await warmRoadNetFromEls\(els, settings, tick\)/);
    expect(sp, "the steps must not be re-implemented in the component").not.toMatch(/function\* roadNetSteps/);
  });
  it("the warm-up runs inside the seed's warm-up, before anything is seeded", () => {
    expect(sp.indexOf("warmSeedCaches(r.rows, 8, { settings })")).toBeGreaterThan(-1);
    expect(sp.indexOf("warmSeedCaches(r.rows, 8, { settings })")).toBeLessThan(sp.indexOf("eng.seed(rows)"));
    expect(sp).toMatch(/if \(settings\) await warmRoadNet\(rows, settings, tick\)/);
  });
});
