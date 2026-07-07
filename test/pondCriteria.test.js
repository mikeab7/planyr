// B709 — pond criteria conformance + the maintenance-berm land-take ring: the
// outward clipper offset, ring-area math, warning thresholds, unverified stamping.
import { describe, it, expect } from "vitest";
import { offsetOutward, offsetInward, ringsArea } from "../src/workspaces/site-planner/lib/pondOffset.js";
import {
  DEFAULT_POND_CRITERIA,
  loadPondCriteria,
  savePondCriteria,
  checkPondCriteria,
} from "../src/workspaces/site-planner/lib/pondCriteriaRules.js";

const SQ = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }];

describe("offsetOutward — the berm ring", () => {
  it("grows a square by the berm width; area matches the rounded-corner hand calc", () => {
    const [ring] = offsetOutward(SQ, 30);
    expect(ring.length).toBeGreaterThan(4); // round joins add arc points
    // Exact grown area = A + P·d + π·d² = 10000 + 400·30 + π·900 ≈ 24827 sf.
    const grown = ringsArea([ring]);
    expect(grown).toBeGreaterThan(24827 * 0.99);
    expect(grown).toBeLessThan(24827 * 1.01);
  });
  it("berm land take = grown ring minus the water footprint", () => {
    const [ring] = offsetOutward(SQ, 30);
    const takeSf = ringsArea([ring]) - ringsArea([SQ]);
    expect(takeSf).toBeGreaterThan(14000); // 12000 perimeter strip + ~2827 corners
    expect(takeSf).toBeLessThan(15500);
  });
  it("outward then inward round-trips to roughly the original", () => {
    const [grown] = offsetOutward(SQ, 20);
    const back = offsetInward(grown, 20);
    expect(back.length).toBe(1);
    expect(ringsArea(back)).toBeGreaterThan(10000 * 0.98);
    expect(ringsArea(back)).toBeLessThan(10000 * 1.02);
  });
  it("degenerate input → [], zero distance → a copy", () => {
    expect(offsetOutward([{ x: 0, y: 0 }], 10)).toEqual([]);
    const [copy] = offsetOutward(SQ, 0);
    expect(copy).toEqual(SQ);
    expect(copy).not.toBe(SQ);
  });
});

describe("criteria rules — seeds + conformance", () => {
  it("every seed is verified:false with the full schema (no fabricated authority)", () => {
    for (const [key, r] of Object.entries(DEFAULT_POND_CRITERIA)) {
      expect(r.verified, key).toBe(false);
      expect(r.maxSideSlope, key).toBeGreaterThan(0);
      expect(r.minFreeboardFt, key).toBeGreaterThanOrEqual(0);
      expect(r.maintBermWidthFt, key).toBeGreaterThan(0);
      expect(r.note, key).toMatch(/VERIFY/i);
    }
  });
  it("round-trips edits through an injected store", () => {
    const m = new Map();
    const store = { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, v) };
    const rules = loadPondCriteria(store);
    rules.harris = { ...rules.harris, maintBermWidthFt: 40, verified: true };
    savePondCriteria(rules, store);
    expect(loadPondCriteria(store).harris.maintBermWidthFt).toBe(40);
    expect(loadPondCriteria(store).coh.maintBermWidthFt).toBe(30);
  });
  it("a STEEPER slope (smaller n) than the cap violates; flatter conforms", () => {
    const rule = DEFAULT_POND_CRITERIA.harris; // 3:1 cap
    expect(checkPondCriteria({ slope: 2 }, rule).slope).toEqual({ slope: 2, maxSideSlope: 3 });
    expect(checkPondCriteria({ slope: 3 }, rule).slope).toBeNull();
    expect(checkPondCriteria({ slope: 4 }, rule).slope).toBeNull();
  });
  it("freeboard under the minimum violates; defaults fill in", () => {
    const rule = DEFAULT_POND_CRITERIA.harris; // 1 ft min
    expect(checkPondCriteria({ freeboard: 0.5 }, rule).freeboard).toEqual({ freeboard: 0.5, minFreeboardFt: 1 });
    expect(checkPondCriteria({ freeboard: 1 }, rule).freeboard).toBeNull();
    expect(checkPondCriteria({}, rule).freeboard).toBeNull(); // default fb 1 conforms
    expect(checkPondCriteria({}, null)).toEqual({ slope: null, freeboard: null });
  });
});
