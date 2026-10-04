/* NEW-1 (parcel ARRIVAL cost) — the pure half of absorbing a /query response over several frames. See
 * src/workspaces/site-planner/lib/parcelIngest.js. The browser half (red on main, green here) is
 * ui-audit/verify-parcel-arrival-cost.mjs; this suite is the CI-runnable proof of the queue's contract. */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { IngestQueue, INGEST_BUDGET_MS, PAINT_BUDGET_MS } from "../src/workspaces/site-planner/lib/parcelIngest.js";

// A fake clock: every `process` call costs `perLot` ms, so a "budget" is exactly a lot count.
function rig({ perLot = 0.1, alive } = {}) {
  let t = 0;
  const done = [];
  const q = new IngestQueue({ now: () => t, process: (f) => { done.push(f); t += perLot; }, alive });
  return { q, done, clock: () => t, tick: (ms) => { t += ms; } };
}
const lots = (n, from = 0) => Array.from({ length: n }, (_, i) => ({ id: from + i }));

describe("IngestQueue", () => {
  it("never spends more than the budget in one drain (the whole point: no response-sized task)", () => {
    const { q, done, clock } = rig({ perLot: 0.1 });
    q.push(lots(1200));
    const t0 = clock();
    const n = q.drain(5);
    expect(n).toBeGreaterThan(0);
    expect(n).toBeLessThan(1200);
    // the clock is read every 8 lots, so the overshoot is bounded by one stride
    expect(clock() - t0).toBeLessThanOrEqual(5 + 8 * 0.1 + 1e-9);
    expect(q.pending).toBe(1200 - n);
    expect(done.length).toBe(n);
  });

  it("eventually delivers EVERY lot exactly once, in order, across frames", () => {
    const { q, done } = rig({ perLot: 0.1 });
    q.push(lots(500));
    q.push(lots(300, 500));
    let frames = 0;
    while (q.pending && frames < 1000) { q.drain(INGEST_BUDGET_MS); frames++; }
    expect(q.pending).toBe(0);
    expect(done.map((f) => f.id)).toEqual(Array.from({ length: 800 }, (_, i) => i));
    expect(frames).toBeGreaterThan(1); // it really was spread over frames
  });

  it("skips a job whose cell left the view while it waited — and accounts for the skipped lots", () => {
    const live = new Set(["a"]);
    const { q, done } = rig({ alive: (c) => !c || live.has(c) });
    q.push(lots(10), "a");
    q.push(lots(10, 100), "b"); // cell b is not live
    q.push(lots(5, 200)); // no coords (a programmatic addFeatures) — always processed
    while (q.pending) q.drain(INGEST_BUDGET_MS);
    expect(done.map((f) => f.id)).toEqual([...Array.from({ length: 10 }, (_, i) => i), ...Array.from({ length: 5 }, (_, i) => 200 + i)]);
    expect(q.pending).toBe(0);
  });

  it("re-checks liveness at drain time, not push time (a prune between frames drops what is still queued)", () => {
    const live = new Set(["a"]);
    const { q, done } = rig({ perLot: 1, alive: (c) => live.has(c) });
    q.push(lots(100), "a");
    q.drain(5); // some land
    const landed = done.length;
    live.delete("a"); // the user panned away; prune forgot the cell
    q.drain(1000);
    expect(done.length).toBe(landed);
    expect(q.pending).toBe(0);
  });

  it("always makes progress even with a zero budget (a stalled queue would hold `load` forever)", () => {
    const { q } = rig({ perLot: 1 });
    q.push(lots(50));
    let guard = 0;
    while (q.pending && guard++ < 100) q.drain(0);
    expect(q.pending).toBe(0);
  });

  it("clear() forgets everything", () => {
    const { q, done } = rig();
    q.push(lots(100));
    q.clear();
    expect(q.pending).toBe(0);
    expect(q.drain(5)).toBe(0);
    expect(done.length).toBe(0);
  });

  it("budgets are one-third / one-quarter of a 60 fps frame, so ingest + paint leave room for the browser", () => {
    expect(INGEST_BUDGET_MS + PAINT_BUDGET_MS).toBeLessThanOrEqual(16.7 / 1.5);
  });
});

describe("makeParcelLayer wiring (source guard — parcelDisplay.js imports Leaflet, so it cannot run in plain Node)", () => {
  const src = readFileSync(new URL("../src/workspaces/site-planner/lib/parcelDisplay.js", import.meta.url), "utf8");
  it("a response goes through the queue, never straight into createLayers", () => {
    expect(src).toMatch(/enqueue\(features, coords\)/);
    expect(src).not.toMatch(/\n\s*this\.createLayers\(features\);\s*\n\s*};\s*\n\s*}/); // the old synchronous call at the end of the _addFeatures override
  });
  it("`load` is held until the queue drains (MapFinder reads it as 'the outlines for this view are drawn')", () => {
    expect(src).toMatch(/_postProcessFeatures = function/);
    expect(src).toMatch(/if \(queue\.pending\) \{ heldLoads\.push\(bounds\)/);
    expect(src).toMatch(/releaseLoads\(\); \/\/ keeps esri-leaflet's request counter honest/); // and a removed layer still settles its counter
  });
  it("tile repainting is budgeted and waits for ingest (no per-slice repaint storm)", () => {
    expect(src).toMatch(/PAINT_BUDGET_MS/);
    expect(src).toMatch(/this\._busy && this\._busy\(\)/);
  });
});

import { prepareParcel } from "../src/workspaces/site-planner/lib/parcelTileLayer.js";
describe("prepareParcel packs a lot's rings into ONE buffer (GC pressure on arrival) without changing them", () => {
  const sq = (x, y, s) => [[x, y], [x + s, y], [x + s, y + s], [x, y + s], [x, y]];
  it("polygon with a hole: two rings, each its own view, values identical to the per-ring derivation", () => {
    const outer = sq(-84.83, 34.2, 0.002), hole = sq(-84.829, 34.201, 0.0005);
    const p = prepareParcel({ type: "Polygon", coordinates: [outer, hole] });
    expect(p.rings.length).toBe(2);
    expect(p.rings[0].length).toBe(outer.length * 2);
    expect(p.rings[1].length).toBe(hole.length * 2);
    expect(p.rings[0].buffer).toBe(p.rings[1].buffer); // one backing store per lot
    const ux = (lng) => (lng + 180) / 360, uy = (lat) => 0.5 - Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360)) / (2 * Math.PI);
    outer.forEach(([lng, lat], i) => { expect(p.rings[0][2 * i]).toBeCloseTo(ux(lng), 12); expect(p.rings[0][2 * i + 1]).toBeCloseTo(uy(lat), 12); });
    hole.forEach(([lng, lat], i) => { expect(p.rings[1][2 * i]).toBeCloseTo(ux(lng), 12); expect(p.rings[1][2 * i + 1]).toBeCloseTo(uy(lat), 12); });
    [-84.83, 34.2, -84.828, 34.202].forEach((v, i) => expect(p.bbox[i]).toBeCloseTo(v, 9));
  });
  it("multipolygon, degenerate one-point rings dropped, empty geometry safe", () => {
    const p = prepareParcel({ type: "MultiPolygon", coordinates: [[sq(0, 0, 1)], [sq(5, 5, 1)], [[[9, 9]]]] });
    expect(p.rings.length).toBe(2);
    expect(prepareParcel(null).rings).toEqual([]);
    expect(prepareParcel({ type: "Polygon", coordinates: [] }).rings).toEqual([]);
  });
});
