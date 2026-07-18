// NEW-C2 — regional-detention / fee-in-lieu registry + on-site-vs-fee compare. Pure.
import { describe, it, expect } from "vitest";
import { regionalDetentionFor, feeInLieuCompare, problems, REGIONAL_DETENTION } from "../src/workspaces/site-planner/lib/regionalDetention.js";

describe("registry", () => {
  it("has no audit problems", () => {
    expect(problems()).toEqual([]);
  });
  it("states availability honestly (tri-state), never assumes a program", () => {
    expect(regionalDetentionFor("hcfcd").available).toBe(true);
    expect(regionalDetentionFor("fortbend").available).toBe(false); // FBCDD DCM: none published
    expect(regionalDetentionFor("coh").available).toBeNull();       // unknown → verify
    expect(regionalDetentionFor("nope")).toBeNull();
  });
  it("never fabricates a fee rate", () => {
    for (const e of Object.values(REGIONAL_DETENTION)) {
      expect(e.feeRatePerAcFt === null || Number.isFinite(e.feeRatePerAcFt)).toBe(true);
    }
  });
});

describe("feeInLieuCompare", () => {
  it("recovers buildable SF from the pond land-take at the coverage ratio", () => {
    // 2 ac land-take × 43560 × 0.40 = 34,848 SF
    const c = feeInLieuCompare({ pondLandTakeAc: 2, coverageRatio: 0.4 });
    expect(c.landRecoveredAc).toBe(2);
    expect(c.buildableSfRecovered).toBe(Math.round(2 * 43560 * 0.4));
  });
  it("prices the fee when the rate + volume are known", () => {
    const c = feeInLieuCompare({ pondLandTakeAc: 2, requiredAcFt: 5, feeRatePerAcFt: 30000 });
    expect(c.feeCost).toBe(150000);
    expect(c.flags).not.toContain("fee-rate-unknown");
  });
  it("flags (never fabricates) a missing fee rate or volume", () => {
    expect(feeInLieuCompare({ pondLandTakeAc: 2 }).flags).toContain("fee-rate-unknown");
    const c = feeInLieuCompare({ pondLandTakeAc: 2, feeRatePerAcFt: 30000 });
    expect(c.feeCost).toBeNull();
    expect(c.flags).toContain("required-volume-unknown");
  });
  it("carries the avoided on-site cost + recovered land value when supplied", () => {
    const c = feeInLieuCompare({ pondLandTakeAc: 2, requiredAcFt: 5, feeRatePerAcFt: 30000, onsitePondCost: 200000, landValuePerAc: 250000 });
    expect(c.avoidedOnsiteCost).toBe(200000);
    expect(c.landValueRecovered).toBe(500000);
  });
  it("no land-take → no comparison", () => {
    expect(feeInLieuCompare({ pondLandTakeAc: 0 }).flags).toContain("no-pond-land-take");
  });
});
