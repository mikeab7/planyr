// B905 — computed time of concentration (Kirpich), replacing the hard-coded 15-min
// screening assumption. Pure — no browser. Hand-checked Kirpich values.
import { describe, it, expect } from "vitest";
import {
  kirpichTcMin,
  estimateFlowPathLengthFt,
  computeTimeOfConcentration,
  DEFAULT_TC_FLOOR_MIN,
  DEFAULT_KIRPICH_URBAN_ADJUSTMENT,
} from "../src/workspaces/site-planner/lib/timeOfConcentration.js";
import { criteriaFor } from "../src/workspaces/site-planner/lib/detentionCriteria.js";
import { rationalPeakCfs } from "../src/workspaces/site-planner/lib/pondRouting.js";

describe("kirpichTcMin — Tc = 0.0078·L^0.77·S^-0.385", () => {
  it("hand-worked example: L=1000 ft, S=0.01 ft/ft (1%) → ~9.4 min", () => {
    // 1000^0.77 = 10^(3*0.77) = 10^2.31 ≈ 204.17; 0.01^-0.385 = 10^0.77 ≈ 5.888
    // Tc = 0.0078 * 204.17 * 5.888 ≈ 9.38 min
    expect(kirpichTcMin({ lengthFt: 1000, slopeFtPerFt: 0.01, imperviousPct: 0, floorMin: 0 })).toBeCloseTo(9.38, 1);
  });

  it("a longer flow path yields a longer Tc at the same slope", () => {
    const short = kirpichTcMin({ lengthFt: 500, slopeFtPerFt: 0.01, floorMin: 0 });
    const long = kirpichTcMin({ lengthFt: 2000, slopeFtPerFt: 0.01, floorMin: 0 });
    expect(long).toBeGreaterThan(short);
  });

  it("a steeper slope yields a shorter Tc at the same length", () => {
    const flat = kirpichTcMin({ lengthFt: 1000, slopeFtPerFt: 0.005, floorMin: 0 });
    const steep = kirpichTcMin({ lengthFt: 1000, slopeFtPerFt: 0.04, floorMin: 0 });
    expect(steep).toBeLessThan(flat);
  });

  it("the urban adjustment scales Tc down as impervious % rises, toward the adjustment factor at 100%", () => {
    const bare = kirpichTcMin({ lengthFt: 1000, slopeFtPerFt: 0.01, imperviousPct: 0, floorMin: 0 });
    const half = kirpichTcMin({ lengthFt: 1000, slopeFtPerFt: 0.01, imperviousPct: 50, floorMin: 0 });
    const full = kirpichTcMin({ lengthFt: 1000, slopeFtPerFt: 0.01, imperviousPct: 100, floorMin: 0, urbanAdjustment: DEFAULT_KIRPICH_URBAN_ADJUSTMENT });
    expect(half).toBeLessThan(bare);
    expect(full).toBeLessThan(half);
    expect(full).toBeCloseTo(bare * DEFAULT_KIRPICH_URBAN_ADJUSTMENT, 2);
  });

  it("a tiny, steep site clamps to the configured floor", () => {
    const tc = kirpichTcMin({ lengthFt: 50, slopeFtPerFt: 0.15, floorMin: DEFAULT_TC_FLOOR_MIN });
    expect(tc).toBe(DEFAULT_TC_FLOOR_MIN);
  });

  it("LOUD-FAILURE: missing/non-positive length or slope → null, never a fabricated Tc", () => {
    expect(kirpichTcMin({ lengthFt: null, slopeFtPerFt: 0.01 })).toBeNull();
    expect(kirpichTcMin({ lengthFt: 1000, slopeFtPerFt: 0 })).toBeNull();
    expect(kirpichTcMin({ lengthFt: -5, slopeFtPerFt: 0.01 })).toBeNull();
  });
});

describe("estimateFlowPathLengthFt — L ≈ k·√(area)", () => {
  it("a bigger area yields a longer estimated flow path", () => {
    const small = estimateFlowPathLengthFt({ areaAcres: 5 });
    const big = estimateFlowPathLengthFt({ areaAcres: 50 });
    expect(big).toBeGreaterThan(small);
  });
  it("LOUD-FAILURE: no area → null", () => {
    expect(estimateFlowPathLengthFt({ areaAcres: null })).toBeNull();
    expect(estimateFlowPathLengthFt({ areaAcres: 0 })).toBeNull();
  });
});

describe("computeTimeOfConcentration — the top-level call, real inputs vs. fallback estimates", () => {
  it("uses a supplied length/slope directly (not estimated) when both are given", () => {
    const r = computeTimeOfConcentration({ areaAcres: 20, impPct: 50, lengthFt: 1200, slopePct: 2 });
    expect(r.lengthEstimated).toBe(false);
    expect(r.slopeEstimated).toBe(false);
    expect(r.lengthFt).toBeCloseTo(1200, 0);
    expect(r.slopePct).toBeCloseTo(2, 1);
  });

  it("falls back to an area-based length estimate AND the default slope when neither is resolvable — both flagged", () => {
    const r = computeTimeOfConcentration({ areaAcres: 20, impPct: 50 });
    expect(r.lengthEstimated).toBe(true);
    expect(r.slopeEstimated).toBe(true);
    expect(r.lengthFt).toBeGreaterThan(0);
    expect(r.slopePct).toBeGreaterThan(0);
    expect(r.basis).toMatch(/screening estimate/);
    expect(r.basis).toMatch(/screening default/);
  });

  it("a supplied length but unresolved slope only flags the slope as estimated", () => {
    const r = computeTimeOfConcentration({ areaAcres: 20, lengthFt: 900 });
    expect(r.lengthEstimated).toBe(false);
    expect(r.slopeEstimated).toBe(true);
  });

  it("every coefficient is criteria-configurable — a jurisdiction override changes the result", () => {
    const base = computeTimeOfConcentration({ areaAcres: 20, impPct: 0 });
    const overridden = computeTimeOfConcentration({
      areaAcres: 20, impPct: 0,
      criteria: criteriaFor("waller", { overrides: { waller: { tcDefaultSlopePct: 5, tcFlowPathKFactor: 3 } } }),
    });
    expect(overridden.slopePct).toBeCloseTo(5, 1);
    expect(overridden.lengthFt).toBeGreaterThan(base.lengthFt); // bigger k-factor → longer estimated path
  });

  it("LOUD-FAILURE: no area and no explicit length → null, never a fabricated Tc", () => {
    expect(computeTimeOfConcentration({ areaAcres: null })).toBeNull();
  });
});

describe("swapping Tc changes the Rational intensity as expected (a longer Tc lowers i)", () => {
  it("a flatter/bigger site's longer computed Tc reads a lower IDF intensity than a small, steep site's", () => {
    const smallSteep = computeTimeOfConcentration({ areaAcres: 3, lengthFt: 300, slopePct: 5 });
    const bigFlat = computeTimeOfConcentration({ areaAcres: 80, lengthFt: 3000, slopePct: 0.3 });
    expect(bigFlat.tcMin).toBeGreaterThan(smallSteep.tcMin);
    const iSmall = rationalPeakCfs({ runoffC: 0.3, returnPeriodYr: 100, tcMin: smallSteep.tcMin, areaAcres: 10 });
    const iBig = rationalPeakCfs({ runoffC: 0.3, returnPeriodYr: 100, tcMin: bigFlat.tcMin, areaAcres: 10 });
    // Same runoff coefficient and area — the ONLY thing that differs is Tc — so a lower
    // per-acre peak (iBig/10 < iSmall/10) directly reflects the IDF curve reading a lower
    // intensity at the longer duration.
    expect(iBig).toBeLessThan(iSmall);
  });
});
