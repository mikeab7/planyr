// B881 — the "challenge the estimate" engine: sanity-check vs grade, the ±1 ft sensitivity
// band, and estimate-vs-estimate disagreement. Pure — no I/O.
import { describe, it, expect } from "vitest";
import {
  impliedDepthFt, sanityCheckEstimate, compareEstimates, sensitivityBand,
  IMPLAUSIBLE_DEPTH_FT, DISAGREE_THRESHOLD_FT,
} from "../src/workspaces/site-planner/lib/estimateChallenge.js";

describe("impliedDepthFt", () => {
  it("is WSE minus grade, null on non-finite", () => {
    expect(impliedDepthFt(105, 100)).toBe(5);
    expect(impliedDepthFt(null, 100)).toBeNull();
    expect(impliedDepthFt(105, null)).toBeNull();
  });
});

describe("sanityCheckEstimate (a)", () => {
  const stats = { medianFt: 100, minFt: 96, maxFt: 104 };
  it("a plausible depth is NOT suspect", () => {
    const r = sanityCheckEstimate({ wseFt: 103, gradeStats: stats });
    expect(r.checked).toBe(true);
    expect(r.suspect).toBe(false);
    expect(r.impliedDepthFt).toBe(3);
    expect(r.reasons).toEqual([]);
  });
  it("flags an implausibly DEEP implied inundation (likely datum/units error)", () => {
    const r = sanityCheckEstimate({ wseFt: 100 + IMPLAUSIBLE_DEPTH_FT + 5, gradeStats: stats });
    expect(r.suspect).toBe(true);
    expect(r.reasons.some((x) => x.code === "deep")).toBe(true);
  });
  it("flags a WSE below the site's low point (lowest sampled grade proxy)", () => {
    const r = sanityCheckEstimate({ wseFt: 94, gradeStats: stats }); // below minFt 96 by > tol
    expect(r.suspect).toBe(true);
    expect(r.reasons.some((x) => x.code === "below-invert")).toBe(true);
  });
  it("uses an explicit drainage invert when provided", () => {
    const r = sanityCheckEstimate({ wseFt: 97, gradeStats: stats, drainageInvertFt: 98.5 });
    expect(r.reasons.some((x) => x.code === "below-invert")).toBe(true);
  });
  it("returns checked:false when the DEM/grade stats are missing (never a false suspect)", () => {
    expect(sanityCheckEstimate({ wseFt: 100, gradeStats: null }).checked).toBe(false);
    expect(sanityCheckEstimate({ wseFt: null, gradeStats: { medianFt: 100 } }).checked).toBe(false);
  });
});

describe("compareEstimates (c)", () => {
  it("agrees within the threshold", () => {
    const r = compareEstimates({ ebfeFt: 100.4, gradeFt: 100 });
    expect(r.comparable).toBe(true);
    expect(r.disagree).toBe(false);
    expect(r.deltaFt).toBeCloseTo(0.4, 5);
  });
  it("disagrees beyond the threshold and reports the higher source", () => {
    const r = compareEstimates({ ebfeFt: 103, gradeFt: 100 });
    expect(r.disagree).toBe(true);
    expect(r.absDeltaFt).toBe(3);
    expect(r.higher).toBe("ebfe");
    expect(compareEstimates({ ebfeFt: 97, gradeFt: 100 }).higher).toBe("grade");
  });
  it("not comparable when either estimate is missing", () => {
    expect(compareEstimates({ ebfeFt: 100, gradeFt: null }).comparable).toBe(false);
    expect(compareEstimates({ ebfeFt: null, gradeFt: 100 }).comparable).toBe(false);
  });
  it("respects a custom threshold", () => {
    expect(compareEstimates({ ebfeFt: 100.6, gradeFt: 100, thresholdFt: 0.5 }).disagree).toBe(true);
    expect(compareEstimates({ ebfeFt: 100.6, gradeFt: 100, thresholdFt: DISAGREE_THRESHOLD_FT }).disagree).toBe(false);
  });
});

describe("sensitivityBand (b)", () => {
  it("flags a categorical VERDICT flip inside the band", () => {
    // pad passes at BFE and BFE-1, fails at BFE+1 → the verdict flips.
    const evalFn = (wse) => ({ ffeVerdict: wse > 100.5 ? "short" : "pass", cost: 1000 });
    const band = sensitivityBand(evalFn, 100, { deltaFt: 1 });
    expect(band.sensitive).toBe(true);
    expect(band.flips.some((f) => f.key === "ffeVerdict" && f.kind === "verdict")).toBe(true);
  });
  it("flags a MATERIAL cost move (>15%) inside the band", () => {
    const evalFn = (wse) => ({ mitigationCf: (wse - 95) * 1000 }); // 4000 / 5000 / 6000 across 99/100/101 → ±20%
    const band = sensitivityBand(evalFn, 100, { deltaFt: 1 });
    expect(band.sensitive).toBe(true);
    expect(band.flips.some((f) => f.key === "mitigationCf" && f.kind === "cost")).toBe(true);
  });
  it("does NOT flag a small (<15%) cost wiggle", () => {
    const evalFn = (wse) => ({ mitigationCf: 100000 + (wse - 100) * 100 }); // ±100 on 100k = 0.1%
    const band = sensitivityBand(evalFn, 100, { deltaFt: 1 });
    expect(band.sensitive).toBe(false);
    expect(band.flips).toEqual([]);
  });
  it("flags a value that APPEARS/vanishes across the band (null ↔ number)", () => {
    const evalFn = (wse) => ({ mitigationCf: wse >= 100.5 ? 500 : null });
    const band = sensitivityBand(evalFn, 100, { deltaFt: 1 });
    expect(band.sensitive).toBe(true);
  });
  it("returns the three samples for display", () => {
    const evalFn = (wse) => ({ requiredFfeFt: wse + 1.5 });
    const band = sensitivityBand(evalFn, 100, { deltaFt: 1 });
    expect(band.samples.low.requiredFfeFt).toBe(100.5);
    expect(band.samples.mid.requiredFfeFt).toBe(101.5);
    expect(band.samples.high.requiredFfeFt).toBe(102.5);
  });
  it("null when it can't run (no evalFn or no base WSE)", () => {
    expect(sensitivityBand(null, 100)).toBeNull();
    expect(sensitivityBand((w) => ({ x: w }), null)).toBeNull();
  });
});
