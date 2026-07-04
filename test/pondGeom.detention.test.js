// B630 — detentionStorage lifted from SitePlanner.jsx into lib/pondGeom.js.
// Pins (1) numeric parity with the pre-lift implementation, (2) the daylighting
// behavior NEW-2 depends on (collapsing side slopes must NOT silently zero the
// stored volume), and (3) the new Map/LRU memo under interleaved callers (the
// yield metrics pass iterates every pond per render — the old 1-entry memo
// would thrash; a broken memo returning stale results would corrupt totals).
import { describe, it, expect } from "vitest";
import { detentionStorage } from "../src/workspaces/site-planner/lib/pondGeom.js";

const rect = (w, h) => [
  { x: 0, y: 0 },
  { x: w, y: 0 },
  { x: w, y: h },
  { x: 0, y: h },
];

describe("detentionStorage — lift parity", () => {
  it("300'x300' square, depth 8 / freeboard 1 / slope 3:1 — pinned fixture", () => {
    // Hand-check of the average-end-area integral the pre-lift SitePlanner.jsx
    // implementation produced (1-ft slabs from freeboard=1 to floor=8; stage
    // area at depth d = (300 - 2*3*d)^2):
    //   Σ over d=1..7 of ((300-6d)^2 + (300-6(d+1))^2)/2  = 522,774 cf
    const r = detentionStorage(rect(300, 300), 8, 1, 3);
    expect(r.aTop).toBeCloseTo(90000, 6);
    expect(r.aWater).toBeCloseTo(294 * 294, 0); // 1 ft down at 3:1 → offset 3 ft/side
    expect(r.aBottom).toBeCloseTo(252 * 252, 0); // 8 ft down → offset 24 ft/side
    expect(r.dw).toBe(7);
    expect(r.vol).toBeCloseTo(522774, -1);
    expect(r.feasible).toBe(true);
    expect(r.maxDepth).toBeCloseTo(50, 0); // 150 ft inscribed reach / slope 3
  });

  it("rings are {x,y} world-feet; volume is CUBIC FEET (ac-ft conversion is the caller's)", () => {
    const r = detentionStorage(rect(300, 300), 8, 1, 3);
    // 522,774 cf ≈ 12.0 ac-ft — sanity that nobody silently converted units.
    expect(r.vol / 43560).toBeGreaterThan(11.5);
    expect(r.vol / 43560).toBeLessThan(12.5);
  });
});

describe("detentionStorage — daylighting (the NEW-2 edge case)", () => {
  it("side slopes meeting before design depth: aBottom is 0 but vol is NOT silently zeroed", () => {
    // 60' wide sliver at 3:1 → max inward offset 30 ft → maxDepth 10 ft. Ask for 20 ft.
    const r = detentionStorage(rect(60, 600), 20, 1, 3);
    expect(r.feasible).toBe(false);
    expect(r.maxDepth).toBeCloseTo(10, 0);
    expect(r.aBottom).toBe(0); // basin daylights before 20 ft
    expect(r.vol).toBeGreaterThan(0); // …but the slabs that DO exist still count
    // And the volume equals the same basin computed at its achievable depth.
    const capped = detentionStorage(rect(60, 600), 10, 1, 3);
    expect(r.vol).toBeCloseTo(capped.vol, 0);
  });

  it("zero slope → maxDepth 0, vol 0, infeasible for any positive depth (no crash)", () => {
    const r = detentionStorage(rect(100, 100), 8, 1, 0);
    expect(r.maxDepth).toBe(0);
    expect(r.vol).toBe(0);
    expect(r.feasible).toBe(false);
  });
});

describe("detentionStorage — Map/LRU memo under interleaving", () => {
  it("A, B, A with different args all return correct results (the 1-entry-thrash regression)", () => {
    const A = rect(300, 300);
    const B = rect(200, 150);
    const a1 = detentionStorage(A, 8, 1, 3);
    const b1 = detentionStorage(B, 6, 1, 4);
    const a2 = detentionStorage(A, 8, 1, 3); // must be the memo hit, not B's answer
    expect(a2).toBe(a1); // identity — memo returned the same object
    expect(b1.vol).not.toBeCloseTo(a1.vol, 0);
    const b2 = detentionStorage(B, 6, 1, 4);
    expect(b2).toBe(b1);
  });

  it("distinct depths on the same ring are distinct memo entries", () => {
    const A = rect(300, 300);
    const d8 = detentionStorage(A, 8, 1, 3);
    const d10 = detentionStorage(A, 10, 1, 3);
    expect(d10.vol).toBeGreaterThan(d8.vol);
    expect(detentionStorage(A, 8, 1, 3)).toBe(d8);
  });

  it("memo eviction never corrupts results (fill past the LRU cap, re-ask the first)", () => {
    const first = detentionStorage(rect(310, 310), 8, 1, 3);
    const firstVol = first.vol;
    for (let i = 0; i < 40; i++) detentionStorage(rect(100 + i, 100 + i), 5, 1, 3); // flood the memo
    const again = detentionStorage(rect(310, 310), 8, 1, 3); // recomputed after eviction
    expect(again.vol).toBeCloseTo(firstVol, 6);
  });
});
