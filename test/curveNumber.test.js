// NEW-B1 — SCS Curve-Number runoff method. Pure — no browser. Hand-checked TR-55 values.
import { describe, it, expect } from "vitest";
import { normalizeHsg, perviousCn, compositeCn, runoffDepthIn, screenRunoff, IMPERVIOUS_CN } from "../src/workspaces/site-planner/lib/curveNumber.js";

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
