// NEW-A4 — screening reservoir routing (modified-Puls) proving Post ≤ Pre per storm.
// Pure — no browser. Property-based routing checks + hand-computed rational peaks.
import { describe, it, expect } from "vitest";
import {
  rationalPeakCfs,
  modifiedRationalHydrograph,
  routeHydrograph,
  routeStorm,
  assessRoutedDetention,
  suggestedPreDevReleaseCfs,
  DEFAULT_PRE_RUNOFF_C,
  DEFAULT_TC_MIN,
} from "../src/workspaces/site-planner/lib/pondRouting.js";
import { buildStageStorageDischarge } from "../src/workspaces/site-planner/lib/stageStorageDischarge.js";

// A large basin so a small orifice can attenuate a 10-ac site's 100-yr peak.
const SQ = [{ x: 0, y: 0 }, { x: 400, y: 0 }, { x: 400, y: 400 }, { x: 0, y: 400 }];
const DET = { depth: 12, freeboard: 1, slope: 3, tobElev: 100 }; // floor 88, design WS 99

describe("rationalPeakCfs — Q = C·i·A", () => {
  it("100-yr, Tc 15 min: i = 7.4 in/hr (transcribed IDF)", () => {
    // C=0.3, A=10 → 0.3·7.4·10 = 22.2
    expect(rationalPeakCfs({ runoffC: 0.3, returnPeriodYr: 100, tcMin: 15, areaAcres: 10 })).toBeCloseTo(22.2, 2);
  });
  it("null on bad inputs / unmodeled storm", () => {
    expect(rationalPeakCfs({ runoffC: null, returnPeriodYr: 100, tcMin: 15, areaAcres: 10 })).toBeNull();
    expect(rationalPeakCfs({ runoffC: 0.3, returnPeriodYr: 7, tcMin: 15, areaAcres: 10 })).toBeNull();
  });
});

describe("modifiedRationalHydrograph", () => {
  it("trapezoid peak = C·i(D)·A for D ≥ Tc", () => {
    // 100-yr, D=60: i=3.9 in/hr; C=0.86, A=10 → 33.54
    const h = modifiedRationalHydrograph({ returnPeriodYr: 100, durationMin: 60, tcMin: 15, runoffC: 0.86, areaAcres: 10, dtSec: 60 });
    expect(h.peakCfs).toBeCloseTo(0.86 * 3.9 * 10, 2);
    expect(h.series[0].qCfs).toBe(0);
    expect(h.series[h.series.length - 1].qCfs).toBe(0);
  });
  it("null on bad inputs", () => {
    expect(modifiedRationalHydrograph({ returnPeriodYr: 100, durationMin: 0, runoffC: 0.5, areaAcres: 10 })).toBeNull();
  });
});

describe("routeHydrograph — physical invariants", () => {
  const ssd = buildStageStorageDischarge({ ring: SQ, det: DET, outlet: { stages: [
    { kind: "orifice", invertElevFt: 88, diameterIn: 12, count: 1, coeff: 0.6 },
    { kind: "weir", crestElevFt: 99, lengthFt: 20, coeff: 3.33 },
  ] }, steps: 40 });
  const hyd = modifiedRationalHydrograph({ returnPeriodYr: 100, durationMin: 60, tcMin: 15, runoffC: 0.86, areaAcres: 10, dtSec: 60 });
  const r = routeHydrograph(hyd.series, ssd.curve, 60);
  it("peak outflow never exceeds peak inflow (attenuation, not amplification)", () => {
    expect(r.peakOutflowCfs).toBeLessThanOrEqual(r.peakInflowCfs + 1e-6);
  });
  it("a small orifice attenuates meaningfully", () => {
    expect(r.peakOutflowCfs).toBeLessThan(r.peakInflowCfs * 0.6);
  });
  it("null on degenerate input", () => {
    expect(routeHydrograph([], ssd.curve, 60)).toBeNull();
  });
});

describe("assessRoutedDetention — Post ≤ Pre PASS/SHORT per storm", () => {
  const criteria = { requiredStorms: [10, 100], orificeC: { value: 0.6 }, weirC: { value: 3.33 } };

  it("a small outlet sized to pre-dev release PASSES; the routed peak ≤ pre and attenuates", () => {
    const outlet = { stages: [{ kind: "orifice", invertElevFt: 88, diameterIn: 8, count: 1, coeff: 0.6 }] };
    const res = assessRoutedDetention({ ring: SQ, det: DET, outlet, criteria, areaAcres: 10, impPct: 90, preRunoffC: 0.3, tcMin: 15 });
    expect(res.kind).toBe("routed");
    expect(res.perStorm.length).toBe(2);
    const s100 = res.perStorm.find((s) => s.returnPeriodYr === 100);
    expect(s100.status).toBe("pass");
    expect(s100.routedPeakCfs).toBeLessThanOrEqual(s100.preCfs + 1e-6);
    expect(s100.attenuationPct).toBeGreaterThan(30);
  });

  it("an oversized outlet (big floor weir) is SHORT — barely attenuates, exceeds pre", () => {
    const outlet = { stages: [{ kind: "weir", crestElevFt: 88.1, lengthFt: 60, coeff: 3.33 }] };
    const res = assessRoutedDetention({ ring: SQ, det: DET, outlet, criteria, areaAcres: 10, impPct: 90, preRunoffC: 0.3, tcMin: 15 });
    const s100 = res.perStorm.find((s) => s.returnPeriodYr === 100);
    expect(s100.status).toBe("short");
    expect(s100.shortByCfs).toBeGreaterThan(0);
    expect(res.allPass).toBe(false);
  });

  it("LOUD-FAILURE: no outlet → kind unknown with a reason, never a fabricated PASS", () => {
    const res = assessRoutedDetention({ ring: SQ, det: DET, outlet: { stages: [] }, criteria, areaAcres: 10, impPct: 90 });
    expect(res.kind).toBe("unknown");
    expect(res.allPass).toBe(false);
  });

  it("LOUD-FAILURE: missing drainage area → unknown", () => {
    const outlet = { stages: [{ kind: "orifice", invertElevFt: 88, diameterIn: 8 }] };
    expect(assessRoutedDetention({ ring: SQ, det: DET, outlet, criteria, areaAcres: null, impPct: 90 }).kind).toBe("unknown");
  });

  it("unanchored pond → unknown (ssd unavailable)", () => {
    const outlet = { stages: [{ kind: "orifice", invertElevFt: 88, diameterIn: 8 }] };
    const res = assessRoutedDetention({ ring: SQ, det: { depth: 12, freeboard: 1, slope: 3 }, outlet, criteria, areaAcres: 10, impPct: 90 });
    expect(res.kind).toBe("unknown");
  });

  it("surfaces the screening assumptions (pre-C, Tc) so they're never hidden", () => {
    const outlet = { stages: [{ kind: "orifice", invertElevFt: 88, diameterIn: 8 }] };
    const res = assessRoutedDetention({ ring: SQ, det: DET, outlet, criteria, areaAcres: 10, impPct: 90, preRunoffC: 0.3, tcMin: 15 });
    expect(res.assumptions.join(" ")).toMatch(/Pre-development runoff coefficient/);
    expect(res.assumptions.join(" ")).toMatch(/Time of concentration/);
  });
});

// B902 — AUTO-SUGGEST the allowable release: in a Post ≤ Pre district that publishes no
// cfs/ac cap (Waller, BKDD), the allowable release IS the site's own pre-development peak.
// This reuses rationalPeakCfs (the SAME engine assessRoutedDetention's pre-dev side already
// calls), so a suggested release can never disagree with what routing later verifies against.
describe("suggestedPreDevReleaseCfs — pre-dev peak as the auto-suggested release", () => {
  it("computes the pre-dev peak at the DEFAULT screening runoff coefficient/Tc", () => {
    // 10-yr, Tc 15 min, C=0.3 (undeveloped/pasture default): from the transcribed IDF used
    // elsewhere in this suite, matches rationalPeakCfs directly — no reimplementation.
    const tenYr = rationalPeakCfs({ runoffC: DEFAULT_PRE_RUNOFF_C, returnPeriodYr: 10, tcMin: DEFAULT_TC_MIN, areaAcres: 52.04 });
    const hundredYr = rationalPeakCfs({ runoffC: DEFAULT_PRE_RUNOFF_C, returnPeriodYr: 100, tcMin: DEFAULT_TC_MIN, areaAcres: 52.04 });
    const s = suggestedPreDevReleaseCfs({ requiredStorms: [10, 100], areaAcres: 52.04 });
    expect(s).not.toBeNull();
    expect(s.runoffC).toBe(DEFAULT_PRE_RUNOFF_C);
    expect(s.tcMin).toBe(DEFAULT_TC_MIN);
    expect(s.perStorm.find((p) => p.returnPeriodYr === 10).peakCfs).toBeCloseTo(tenYr, 2);
    expect(s.perStorm.find((p) => p.returnPeriodYr === 100).peakCfs).toBeCloseTo(hundredYr, 2);
  });

  it("governs on the MOST RESTRICTIVE (smallest) required storm's peak — a conservative seed", () => {
    const s = suggestedPreDevReleaseCfs({ requiredStorms: [10, 100], areaAcres: 52.04 });
    const min = Math.min(...s.perStorm.map((p) => p.peakCfs));
    expect(s.cfs).toBeCloseTo(min, 2);
    // 10-yr rainfall intensity is always < 100-yr at the same Tc, so it's always governing here.
    expect(s.governingStormYr).toBe(10);
  });

  it("an explicit runoff coefficient / Tc override is honored (still editable, not hardcoded)", () => {
    const s = suggestedPreDevReleaseCfs({ requiredStorms: [100], areaAcres: 20, runoffC: 0.2, tcMin: 20 });
    expect(s.runoffC).toBe(0.2);
    expect(s.tcMin).toBe(20);
    expect(s.cfs).toBeCloseTo(rationalPeakCfs({ runoffC: 0.2, returnPeriodYr: 100, tcMin: 20, areaAcres: 20 }), 2);
  });

  it("LOUD-FAILURE: never a fabricated number — null with no required storms / no area / non-positive area", () => {
    expect(suggestedPreDevReleaseCfs({ requiredStorms: [], areaAcres: 52.04 })).toBeNull();
    expect(suggestedPreDevReleaseCfs({ requiredStorms: [10, 100], areaAcres: null })).toBeNull();
    expect(suggestedPreDevReleaseCfs({ requiredStorms: [10, 100], areaAcres: 0 })).toBeNull();
    expect(suggestedPreDevReleaseCfs()).toBeNull();
  });
});
