// B904 — NRCS Type III design-storm hyetograph. Pure — no browser.
import { describe, it, expect } from "vitest";
import { typeIIIFraction, buildTypeIIIHyetograph, TYPE_III_MASS_CURVE } from "../src/workspaces/site-planner/lib/hyetograph.js";

describe("typeIIIFraction — the published NRCS Type III cumulative mass curve", () => {
  it("matches known published cumulative fractions at key time points", () => {
    expect(typeIIIFraction(0)).toBeCloseTo(0, 3);
    expect(typeIIIFraction(1)).toBeCloseTo(1, 3);
    expect(typeIIIFraction(0.5)).toBeCloseTo(0.5, 2); // hr 12 — the storm's center of mass
    expect(typeIIIFraction(0.375)).toBeCloseTo(0.115, 2); // hr 9
  });

  it("is monotonically non-decreasing across the whole curve", () => {
    const xs = TYPE_III_MASS_CURVE.map((p) => p[0]);
    let prev = -1;
    for (const x of xs) {
      const y = typeIIIFraction(x);
      expect(y).toBeGreaterThanOrEqual(prev - 1e-9);
      prev = y;
    }
  });

  it("clamps outside [0,1]", () => {
    expect(typeIIIFraction(-0.5)).toBe(0);
    expect(typeIIIFraction(1.5)).toBe(1);
  });

  it("concentrates roughly 60% of the storm's depth within about 2 hours around the peak (hr 11–13)", () => {
    // The Type III signature: a sharp mid-storm rise, unlike a uniform/flat distribution.
    const at11 = typeIIIFraction(11 / 24);
    const at13 = typeIIIFraction(13 / 24);
    expect(at13 - at11).toBeGreaterThan(0.35);
  });

  it("null on non-finite input", () => {
    expect(typeIIIFraction(null)).toBeNull();
    expect(typeIIIFraction(NaN)).toBeNull();
  });
});

describe("buildTypeIIIHyetograph", () => {
  it("distributes the total depth over the storm — cumulative series ends at the total depth", () => {
    const h = buildTypeIIIHyetograph({ totalDepthIn: 13, durationHr: 24, dtMin: 60 });
    expect(h).not.toBeNull();
    expect(h.series[0].cumulativeIn).toBeCloseTo(0, 3);
    expect(h.series[h.series.length - 1].cumulativeIn).toBeCloseTo(13, 2);
  });

  it("incremental values sum back to the total depth", () => {
    const h = buildTypeIIIHyetograph({ totalDepthIn: 13, durationHr: 24, dtMin: 30 });
    const sum = h.series.reduce((s, p) => s + p.incrementalIn, 0);
    expect(sum).toBeCloseTo(13, 1);
  });

  it("every increment is non-negative (a monotonic mass curve never produces negative rainfall)", () => {
    const h = buildTypeIIIHyetograph({ totalDepthIn: 13, durationHr: 24, dtMin: 15 });
    expect(h.series.every((p) => p.incrementalIn >= 0)).toBe(true);
  });

  it("the mid-storm timestep carries far more rainfall than an early/late one — a real shape, not flat", () => {
    const h = buildTypeIIIHyetograph({ totalDepthIn: 13, durationHr: 24, dtMin: 60 });
    const at2 = h.series.find((p) => p.tMin === 120).incrementalIn; // hr 2
    const at12 = h.series.find((p) => p.tMin === 720).incrementalIn; // hr 12 — the peak hour
    expect(at12).toBeGreaterThan(at2 * 5);
  });

  it("rescales to a shorter duration and flags it as a screening simplification", () => {
    const h24 = buildTypeIIIHyetograph({ totalDepthIn: 7.4, durationHr: 24, dtMin: 15 });
    const h3 = buildTypeIIIHyetograph({ totalDepthIn: 7.4, durationHr: 3, dtMin: 15 });
    expect(h3.series[h3.series.length - 1].cumulativeIn).toBeCloseTo(7.4, 2);
    expect(h3.caveat).toMatch(/screening simplification/);
    expect(h24.caveat).not.toMatch(/screening simplification/);
  });

  it("LOUD-FAILURE: missing/non-positive depth or duration → null, never a fabricated storm", () => {
    expect(buildTypeIIIHyetograph({ totalDepthIn: null })).toBeNull();
    expect(buildTypeIIIHyetograph({ totalDepthIn: 0 })).toBeNull();
    expect(buildTypeIIIHyetograph({ totalDepthIn: 13, durationHr: 0 })).toBeNull();
    expect(buildTypeIIIHyetograph({ totalDepthIn: 13, dtMin: -5 })).toBeNull();
  });
});
