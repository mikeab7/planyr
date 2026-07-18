// NEW-C1 — upstream flow-accumulation + offsite-drainage flag over a DEM grid. Pure.
import { describe, it, expect } from "vitest";
import { flowAccumulation, contributingAcres, lowestCell, delineateUpstream, offsiteDrainageFlag } from "../src/workspaces/site-planner/lib/upstreamArea.js";

// 4×4 plane sloping to the bottom-right corner (value 100 − x − y): every cell drains to (3,3).
const W = 4, H = 4;
const values = [];
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) values.push(100 - x - y);
const mask = new Array(W * H).fill(1);
const grid = { values, mask, width: W, height: H, cellFt: 100 };
const OUTLET = 3 * W + 3; // (3,3)

describe("flowAccumulation", () => {
  const acc = flowAccumulation(grid);
  it("the outlet accumulates every cell (whole plane drains to it)", () => {
    expect(acc[OUTLET]).toBe(W * H); // 16
    expect(Math.max(...acc)).toBe(16);
  });
  it("every cell's accumulation is ≥ 1 (itself)", () => {
    for (let i = 0; i < acc.length; i++) expect(acc[i]).toBeGreaterThanOrEqual(1);
  });
});

describe("contributingAcres + lowestCell", () => {
  const acc = flowAccumulation(grid);
  it("contributing area at the outlet = 16 cells × (100 ft)² / 43560", () => {
    expect(contributingAcres(acc, OUTLET, 100)).toBeCloseTo((16 * 10000) / 43560, 2); // ~3.67
  });
  it("lowestCell finds the outlet", () => {
    expect(lowestCell(grid)).toBe(OUTLET);
  });
});

describe("delineateUpstream", () => {
  it("the whole grid is upstream of the outlet on a converging plane", () => {
    const d = delineateUpstream(grid, OUTLET);
    expect(d.cells.size).toBe(16);
    expect(d.upstreamAcres).toBeCloseTo(3.67, 1);
  });
  it("off-grid outlet → null", () => {
    expect(delineateUpstream(grid, -1)).toBeNull();
    expect(delineateUpstream(grid, 999)).toBeNull();
  });
});

describe("offsiteDrainageFlag", () => {
  it("upstream materially larger than the site → warn (offsite flow)", () => {
    const f = offsiteDrainageFlag({ upstreamAcres: 40, siteAcres: 10 });
    expect(f.offsite).toBe(true);
    expect(f.severity).toBe("warn");
    expect(f.offsiteAcres).toBeCloseTo(30, 1);
    expect(f.message).toMatch(/engineer/);
  });
  it("upstream ≈ site → ok", () => {
    const f = offsiteDrainageFlag({ upstreamAcres: 11, siteAcres: 10 });
    expect(f.offsite).toBe(false);
    expect(f.severity).toBe("ok");
  });
  it("missing inputs → known:false, never fabricated", () => {
    expect(offsiteDrainageFlag({ upstreamAcres: null, siteAcres: 10 }).known).toBe(false);
    expect(offsiteDrainageFlag({ upstreamAcres: 40, siteAcres: 0 }).known).toBe(false);
  });
});
