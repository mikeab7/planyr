// NEW-B1 — SCS Curve-Number runoff method. Pure — no browser. Hand-checked TR-55 values.
import { describe, it, expect } from "vitest";
import { normalizeHsg, perviousCn, compositeCn, runoffDepthIn, screenRunoff, excessRainfallSeries, IMPERVIOUS_CN } from "../src/workspaces/site-planner/lib/curveNumber.js";

describe("normalizeHsg", () => {
  it("accepts A-D and drained dual groups; rejects junk", () => {
    expect(normalizeHsg("B")).toBe("B");
    expect(normalizeHsg("a")).toBe("A");
    expect(normalizeHsg("A/D")).toBe("A");
    expect(normalizeHsg("X")).toBeNull();
    expect(normalizeHsg(null)).toBeNull();
  });
});

describe("perviousCn / compositeCn", () => {
  it("open-space-good on group B = CN 61 (TR-55)", () => {
    expect(perviousCn("B", "openSpaceGood")).toBe(61);
  });
  it("composite blends impervious (98) with pervious area-weighted", () => {
    // 50% impervious on B open space: 0.5*98 + 0.5*61 = 79.5
    expect(compositeCn({ group: "B", impPct: 50 }).cn).toBeCloseTo(79.5, 1);
    expect(compositeCn({ group: "D", impPct: 100 }).cn).toBe(IMPERVIOUS_CN);
  });
  it("unknown soil → null (never a fabricated CN)", () => {
    expect(compositeCn({ group: "Z", impPct: 50 })).toBeNull();
  });
});

describe("runoffDepthIn — Q = (P−0.2S)²/(P+0.8S)", () => {
  it("CN 80, P 5 in → ~2.89 in", () => {
    // S = 1000/80-10 = 2.5; Q = (5-0.5)²/(5+2) = 20.25/7 = 2.893
    expect(runoffDepthIn(5, 80)).toBeCloseTo(2.893, 2);
  });
  it("below the initial abstraction → 0", () => {
    expect(runoffDepthIn(0.4, 80)).toBe(0); // 0.2S = 0.5 > 0.4
  });
  it("bad inputs → null", () => {
    expect(runoffDepthIn(-1, 80)).toBeNull();
    expect(runoffDepthIn(5, 0)).toBeNull();
  });
});

describe("screenRunoff — composite CN → depth → volume", () => {
  it("produces a runoff volume for a valid site", () => {
    const r = screenRunoff({ group: "C", impPct: 90, rainfallIn: 12, areaAcres: 10 });
    expect(r.flags).toHaveLength(0);
    expect(r.cn).toBeGreaterThan(90);
    expect(r.runoffVolumeAcFt).toBeGreaterThan(0);
    expect(r.runoffVolumeCf).toBeGreaterThan(0);
  });
  it("computes the post-minus-pre increase when a pre-condition is given", () => {
    const r = screenRunoff({ group: "C", impPct: 90, rainfallIn: 12, areaAcres: 10, preImpPct: 0, preCover: "pasture" });
    expect(r.increaseAcFt).not.toBeNull();
    expect(r.increaseAcFt).toBeLessThanOrEqual(r.runoffVolumeAcFt);
    expect(r.increaseAcFt).toBeGreaterThan(0);
  });
  it("LOUD-FAILURE: missing soil / rainfall / area flags, no fabricated volume", () => {
    const r = screenRunoff({ group: null, impPct: 90, rainfallIn: 12, areaAcres: 10 });
    expect(r.flags).toContain("soil-group-unknown");
    expect(r.runoffVolumeCf).toBeNull();
    expect(screenRunoff({ group: "C", impPct: 90, rainfallIn: null, areaAcres: 10 }).flags).toContain("rainfall-unknown");
    expect(screenRunoff({ group: "C", impPct: 90, rainfallIn: 12, areaAcres: 0 }).flags).toContain("area-unknown");
  });
});

// B904 — a rainfall hyetograph → a runoff (rainfall-excess) hyetograph: the standard NRCS
// input to a unit-hydrograph convolution.
describe("excessRainfallSeries — cumulative CN applied per timestep, then differenced", () => {
  const series = [
    { tMin: 0, cumulativeIn: 0 },
    { tMin: 60, cumulativeIn: 1 },
    { tMin: 120, cumulativeIn: 3 },
    { tMin: 180, cumulativeIn: 5 },
  ];

  it("cumulative excess at each step matches runoffDepthIn(cumulativeIn, cn) directly", () => {
    const r = excessRainfallSeries({ series, cn: 80 });
    expect(r).not.toBeNull();
    for (const pt of r.series) {
      const src = series.find((s) => s.tMin === pt.tMin);
      expect(pt.cumulativeExcessIn).toBeCloseTo(runoffDepthIn(src.cumulativeIn, 80), 3);
    }
  });

  it("incremental excess sums back to the total cumulative excess", () => {
    const r = excessRainfallSeries({ series, cn: 80 });
    const sum = r.series.reduce((s, p) => s + p.incrementalExcessIn, 0);
    expect(sum).toBeCloseTo(r.totalExcessIn, 2);
  });

  it("no runoff below the initial abstraction — early increments are 0 while cumulative rainfall is small", () => {
    // CN 80 → S=2.5, 0.2S=0.5 — 0.3 in of cumulative rainfall hasn't cleared it yet.
    const belowAbstraction = [{ tMin: 0, cumulativeIn: 0 }, { tMin: 30, cumulativeIn: 0.3 }, { tMin: 60, cumulativeIn: 1 }];
    const r = excessRainfallSeries({ series: belowAbstraction, cn: 80 });
    expect(r.series[1].cumulativeExcessIn).toBe(0);
    expect(r.series[1].incrementalExcessIn).toBe(0);
    expect(r.series[2].cumulativeExcessIn).toBeGreaterThan(0); // 1 in clears the 0.5-in abstraction
  });

  it("incremental excess is never negative even though the underlying curve is convex", () => {
    const r = excessRainfallSeries({ series, cn: 60 });
    expect(r.series.every((p) => p.incrementalExcessIn >= 0)).toBe(true);
  });

  it("LOUD-FAILURE: missing series / bad CN → null", () => {
    expect(excessRainfallSeries({ series: [], cn: 80 })).toBeNull();
    expect(excessRainfallSeries({ series, cn: 0 })).toBeNull();
    expect(excessRainfallSeries({ series, cn: null })).toBeNull();
  });
});
