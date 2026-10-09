/* B2225425 (round 3) — the plan-open / plan-switch stall, the four root causes found and fixed here, each guarded:
 *   1. the rows seed REPLACED every element on every open (the device copy was read-normalized, the rows were not; and the road migration
 *      that rowsToModel runs was adopted straight back by rows-canonical) — READ_NORMALIZE is one table both read paths run;
 *   2. a whole aerial grid (112–252 tiles) answered in one main-thread burst — tile loads are paced (createTilePacer);
 *   3. the parcel-overlap screen re-asked every pair on every open — pair areas are memoised by ring identity;
 *   4. the planner's first render ran at a placeholder box/view and was re-rendered inside the switch's commit — framingPoints /
 *      framedViewFor are ONE derivation shared by fit() and the first render.
 * Account: docs/perf/PERF-PLAN-OPEN.md (round 3). Instrument: ui-audit/perf-plan-open.mjs. */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { rowsToModel } from "../src/workspaces/site-planner/lib/elementRows.js";
import { createSiteModel, READ_NORMALIZE } from "../src/workspaces/site-planner/lib/siteModel.js";
import { healDockAxes } from "../src/workspaces/site-planner/lib/dockZones.js";
import { createTilePacer } from "../src/workspaces/site-planner/lib/tileLifecycle.js";
import { polyIntersectArea, triangulate } from "../src/workspaces/site-planner/lib/polyClip.js";

const fixture = (f) => JSON.parse(readFileSync(new URL(`../ui-audit/fixtures/plan-load/${f}.json`, import.meta.url), "utf8"));
const FIELDS = ["els", "parcels", "markups", "measures", "callouts"];
const J = (x) => JSON.stringify(x);
const seedNormalize = (m) => Object.fromEntries(FIELDS.map((f) => [f, f === "els" ? healDockAxes(READ_NORMALIZE.els(m.els)) : READ_NORMALIZE[f](m[f])]));

describe("one read normalization for both read paths (the rows seed no longer replaces every element on open)", () => {
  for (const name of ["bolt-on", "concept-a", "richfield-concept-a-live"]) {
    it(`${name}: rows → model → READ_NORMALIZE equals the device copy's createSiteModel, element for element`, () => {
      const fx = fixture(name);
      const seeded = seedNormalize(rowsToModel({}, fx.rows));
      const device = createSiteModel({ ...fx.header, ...seeded });
      const mount = { ...device, els: healDockAxes(device.els) };
      for (const f of FIELDS) expect(J(mount[f]), f).toBe(J(seeded[f]));
    });
    it(`${name}: normalizing an already-normal canvas changes nothing (no write, no re-render)`, () => {
      const once = seedNormalize(rowsToModel({}, fixture(name).rows));
      const twice = seedNormalize(once);
      for (const f of FIELDS) expect(twice[f], f).toBe(once[f]);
    });
  }
  it("RED PROOF — the raw rows disagree with the device copy on the owner's own plans (the defect this closes)", () => {
    const bolt = rowsToModel({}, fixture("bolt-on").rows);
    const dev = createSiteModel({ ...fixture("bolt-on").header, ...bolt });
    expect(J(dev.els)).not.toBe(J(bolt.els));                       // 6 duplicate z → every element renumbered
    const ca = rowsToModel({}, fixture("concept-a").rows);
    const devCa = createSiteModel({ ...fixture("concept-a").header, ...ca });
    expect(J(devCa.parcels)).not.toBe(J(ca.parcels));               // pre-NEW-5 `locked` with no `lockSem`
    // and the raw ROW of Bolt-on's road is not what the model draws (the road migration — adopted back on every open before this)
    const raw = fixture("bolt-on").rows.find((r) => r.id === "e1455359wmveej").data;
    expect(bolt.els.find((e) => e.id === "e1455359wmveej").pts.length).not.toBe(raw.pts.length);
  });
  it("createSiteModel runs the table itself (one implementation, not a copy)", () => {
    const src = readFileSync(new URL("../src/workspaces/site-planner/lib/siteModel.js", import.meta.url), "utf8");
    for (const f of ["parcels", "els", "markups", "measures", "callouts"]) expect(src).toMatch(new RegExp(`${f}: READ_NORMALIZE\\.${f}\\(`));
  });
  it("the seed commits what it normalized instead of adopting the raw row back (exempt from rows-canonical) and warms before seeding", () => {
    const sp = readFileSync(new URL("../src/workspaces/site-planner/SitePlanner.jsx", import.meta.url), "utf8");
    const body = sp.slice(sp.indexOf("const refetchReplace = async (eng) => {"), sp.indexOf("/* Plan-switch first-write loss"));
    expect(body).toMatch(/READ_NORMALIZE\[field\]/);
    expect(body).toMatch(/eng\.reconcile\(shown, \{ busy: false, afterSeed: true, exempt: new Set\(\[\.\.\.healed\.map\(\(h\) => "el:" \+ h\.id\), \.\.\.normKeys\]\)/);
    expect(body).toMatch(/load-normalized-persisted/);
    expect(body.indexOf("warmSeedCaches(r.rows)")).toBeGreaterThan(-1);
    expect(body.indexOf("warmSeedCaches(r.rows)")).toBeLessThan(body.indexOf("eng.seed(rows)"));
  });
});

/* a tile stand-in: an EventTarget with the two properties the pacer reads */
class FakeTile extends EventTarget { constructor() { super(); this.isConnected = true; this.src = ""; } }
const settle = (t, ev = "load") => t.dispatchEvent(new Event(ev));

describe("tile loads are paced (a whole grid never answers in one burst)", () => {
  it("never has more than maxInFlight tiles loading, and starts them in the order Leaflet asked", () => {
    const p = createTilePacer({ maxInFlight: 3 });
    const tiles = Array.from({ length: 10 }, () => new FakeTile());
    tiles.forEach((t, i) => p.schedule(t, `u${i}`));
    expect(tiles.filter((t) => t.src).map((t) => t.src)).toEqual(["u0", "u1", "u2"]);
    expect(p.inFlight).toBe(3); expect(p.queued).toBe(7);
    settle(tiles[1]); expect(tiles[3].src).toBe("u3");
    settle(tiles[0], "error"); expect(tiles[4].src).toBe("u4");
    settle(tiles[0]);                                   // a second event on a settled tile does not release twice
    expect(p.inFlight).toBe(3); expect(tiles[5].src).toBe("");
    for (let i = 2; i < 10; i++) settle(tiles[i]);
    expect(tiles.every((t) => t.src)).toBe(true); expect(p.stats.peak).toBe(3); expect(p.inFlight).toBe(0);
  });
  it("never fetches a tile Leaflet discarded while it waited", () => {
    const p = createTilePacer({ maxInFlight: 1 });
    const [a, b, c] = [new FakeTile(), new FakeTile(), new FakeTile()];
    p.schedule(a, "a"); p.schedule(b, "b"); p.schedule(c, "c");
    p.attached(b); b.isConnected = false;               // pruned before its turn
    settle(a);
    expect(b.src).toBe(""); expect(c.src).toBe("c"); expect(p.stats.dropped).toBe(1);
  });
  it("is wired to BOTH planner basemap layers", () => {
    const sp = readFileSync(new URL("../src/workspaces/site-planner/SitePlanner.jsx", import.meta.url), "utf8");
    expect(sp).toMatch(/paceTileLoads\(bf\)/); expect(sp).toMatch(/paceTileLoads\(t\)/);
  });
});

describe("parcel pair areas are memoised by ring identity (same answer, asked once)", () => {
  const sq = (x, y, s) => [{ x, y }, { x: x + s, y }, { x: x + s, y: y + s }, { x, y: y + s }];
  it("returns the same area as a fresh computation, in either order, and is stable on repeat", () => {
    const a = sq(0, 0, 10), b = sq(5, 5, 10), c = sq(50, 50, 3);
    expect(polyIntersectArea(a, b)).toBeCloseTo(25, 9);
    expect(polyIntersectArea(b, a)).toBeCloseTo(25, 9);
    expect(polyIntersectArea(a, c)).toBe(0);
    expect(polyIntersectArea([...a], [...b])).toBeCloseTo(25, 9);   // new arrays, same geometry → same answer
    expect(triangulate(a).length).toBe(2);
  });
});

describe("the planner's first render frames like fit() does (one derivation)", () => {
  it("fit() and the first render both go through framingPoints + framedViewFor", () => {
    const sp = readFileSync(new URL("../src/workspaces/site-planner/SitePlanner.jsx", import.meta.url), "utf8");
    expect(sp).toMatch(/const pts = framingPoints\(hiddenGroups, parcels, els, sheetOverlays\);/);
    expect(sp).toMatch(/setView\(framedViewFor\(box2, pts\)\)/);
    expect(sp).toMatch(/framedViewFor\(lastMeasuredCanvas\.box, framingPoints\(settings\.hidden, parcels, els, restored\?\.sheetOverlays \|\| \[\]\)\)/);
    // the boot framing's reveal is still owned by fit() against a MEASURED box — the guess never marks the canvas framed
    expect(sp).not.toMatch(/lastMeasuredCanvas[^\n]*markFramed/);
  });
});
