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
  autoSizeCompoundOutlet,
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

// B903 — a too-small outlet throttles outflow so hard that the CLAMPED routed peak (the
// routing model has no data above top of bank) can compare ≤ the pre-development peak even
// while the basin is actively overtopping. That used to read PASS; it must read SHORT — the
// exact "a pond that passes the small storm but fails a larger one" bug the compound-outlet
// solver exists to fix. A 300x300 ft, 8-ft-deep pond (small footprint, ~2 ac) draining a
// realistic 45-ac watershed with only a single 10-in floor orifice: the 10-yr storm passes
// cleanly (plenty of headroom), the 100-yr storm overtops the basin — confirmed empirically
// against the real routing engine before locking in this fixture.
describe("assessRoutedDetention — overtopping forces a FAIL, even when the clamped peak compares low", () => {
  const SQ2 = [{ x: 0, y: 0 }, { x: 300, y: 0 }, { x: 300, y: 300 }, { x: 0, y: 300 }];
  const DET2 = { depth: 8, freeboard: 1, slope: 3, tobElev: 100 }; // floor 92, design WS 99
  const criteria = { requiredStorms: [10, 100], orificeC: { value: 0.6 }, weirC: { value: 3.33 } };
  const outlet = { stages: [{ kind: "orifice", invertElevFt: 92, diameterIn: 10, count: 1, coeff: 0.6 }] };

  it("the smaller storm passes without overtopping", () => {
    const res = assessRoutedDetention({ ring: SQ2, det: DET2, outlet, criteria, areaAcres: 45, impPct: 90, preRunoffC: 0.3, tcMin: 15 });
    const s10 = res.perStorm.find((s) => s.returnPeriodYr === 10);
    expect(s10.status).toBe("pass");
    expect(s10.overtopped).toBe(false);
  });

  it("the larger storm overtops and is correctly flagged SHORT, not PASS, despite a low routed cfs", () => {
    const res = assessRoutedDetention({ ring: SQ2, det: DET2, outlet, criteria, areaAcres: 45, impPct: 90, preRunoffC: 0.3, tcMin: 15 });
    const s100 = res.perStorm.find((s) => s.returnPeriodYr === 100);
    expect(s100.overtopped).toBe(true);
    expect(s100.routedPeakCfs).toBeLessThan(s100.preCfs); // the naive comparison alone would say PASS
    expect(s100.status).toBe("short"); // the fix: overtopping overrides that naive comparison
    expect(s100.shortByCfs).toBeNull(); // LOUD-FAILURE: no fabricated cfs number once clamped
  });

  it("the OVERALL verdict is FAIL when only the larger storm overtops — one bad storm can't hide behind one that passed", () => {
    const res = assessRoutedDetention({ ring: SQ2, det: DET2, outlet, criteria, areaAcres: 45, impPct: 90, preRunoffC: 0.3, tcMin: 15 });
    expect(res.allPass).toBe(false);
    expect(res.flags).toContain("overtopping");
  });
});

// B903 — MULTI-STAGE OUTLET + ALL-STORMS-AT-ONCE auto-size solver.
describe("autoSizeCompoundOutlet — solves a compound outlet so ALL required storms pass at once", () => {
  const SQ2 = [{ x: 0, y: 0 }, { x: 300, y: 0 }, { x: 300, y: 300 }, { x: 0, y: 300 }];
  const DET2 = { depth: 8, freeboard: 1, slope: 3, tobElev: 100 };
  const criteria2 = { requiredStorms: [10, 100], orificeC: { value: 0.6 }, weirC: { value: 3.33 } };

  it("a feasible pond converges to a structure that passes EVERY required storm", () => {
    const r = autoSizeCompoundOutlet({ ring: SQ2, det: DET2, criteria: criteria2, areaAcres: 45, impPct: 90, preRunoffC: 0.3, tcMin: 15 });
    expect(r.ok).toBe(true);
    expect(r.allPass).toBe(true);
    expect(r.perStorm.length).toBe(2);
    expect(r.perStorm.every((s) => s.status === "pass")).toBe(true);
    // The single-orifice B900/B902 fixture at this same target (10 in) overtopped the 100-yr —
    // the solver must have sized something different (bigger) to actually pass both.
    expect(r.outlet.stages[0].kind).toBe("orifice");
    expect(r.outlet.stages[0].diameterIn).toBeGreaterThan(10);
    // An emergency spillway is always present, at the design water surface (freeboard line).
    const spillway = r.outlet.stages.find((s) => s.role === "spillway");
    expect(spillway).toBeTruthy();
    expect(spillway.crestElevFt).toBeCloseTo(99, 3);
  });

  it("introduces a genuine SECOND (control) stage when a single orifice alone can't clear every storm", () => {
    // A 2/10/100-yr criteria (BKDD-like — the 2-yr allowable is far more restrictive than the
    // 100-yr's) over a big enough watershed that the orifice sized for the 2-yr storm needs a
    // control weir's help to also clear the 100-yr without overtopping.
    const criteria3 = { requiredStorms: [2, 10, 100], orificeC: { value: 0.6 }, weirC: { value: 3.33 } };
    const SQ3 = [{ x: 0, y: 0 }, { x: 250, y: 0 }, { x: 250, y: 250 }, { x: 0, y: 250 }];
    const DET3 = { depth: 6, freeboard: 1, slope: 3, tobElev: 100 };
    const r = autoSizeCompoundOutlet({ ring: SQ3, det: DET3, criteria: criteria3, areaAcres: 35, impPct: 90, preRunoffC: 0.3, tcMin: 15 });
    expect(r.ok).toBe(true);
    expect(r.allPass).toBe(true);
    expect(r.perStorm.length).toBe(3);
    const control = r.outlet.stages.find((s) => s.role === "control");
    expect(control).toBeTruthy();
    expect(control.kind).toBe("weir");
    expect(control.crestElevFt).toBeGreaterThan(r.outlet.stages[0].invertElevFt);
  });

  it("respects WHATEVER jurisdiction's required storms are passed in — a single-storm criteria needs no control stage", () => {
    const oneStorm = { requiredStorms: [100], orificeC: { value: 0.6 }, weirC: { value: 3.33 } };
    const r = autoSizeCompoundOutlet({ ring: SQ2, det: DET2, criteria: oneStorm, areaAcres: 20, impPct: 90, preRunoffC: 0.3, tcMin: 15 });
    expect(r.ok).toBe(true);
    expect(r.perStorm.length).toBe(1);
    expect(r.outlet.stages.find((s) => s.role === "control")).toBeFalsy();
  });

  it("LOUD-FAILURE: a genuinely infeasible pond (tiny footprint, huge watershed) reports honest failure, never a fabricated pass", () => {
    const r = autoSizeCompoundOutlet({ ring: SQ2, det: DET2, criteria: criteria2, areaAcres: 400, impPct: 90, preRunoffC: 0.3, tcMin: 15 });
    expect(r.ok).toBe(false);
    expect(r.allPass).toBe(false);
    expect(r.worstStorm).toBeTruthy();
    expect(r.worstStorm.status).not.toBe("pass");
    expect(r.reason).toMatch(/storm still/);
    expect(r.reason.toLowerCase()).toMatch(/expand this pond|deeper|footprint/);
    // Even on failure, the best attempt is returned (never null) so the UI can show it.
    expect(r.outlet).toBeTruthy();
    expect(r.perStorm.length).toBe(2);
  });

  it("LOUD-FAILURE: an unanchored pond / missing drainage area / no required storms refuse cleanly", () => {
    expect(autoSizeCompoundOutlet({ ring: SQ2, det: { depth: 8, freeboard: 1, slope: 3 }, criteria: criteria2, areaAcres: 20, impPct: 90 }).ok).toBe(false);
    expect(autoSizeCompoundOutlet({ ring: SQ2, det: DET2, criteria: criteria2, areaAcres: null, impPct: 90 }).ok).toBe(false);
    expect(autoSizeCompoundOutlet({ ring: SQ2, det: DET2, criteria: { requiredStorms: [] }, areaAcres: 20, impPct: 90 }).ok).toBe(false);
  });

  // B903 — the orifice equation measures head to the CENTROID (invert + half the diameter),
  // so an unrealistically large "orifice" reports ZERO flow until the water surface clears
  // its own centroid (an 8-ft-diameter hole needs 4 ft of head before this simplified model
  // shows any discharge at all) — a real bug this solver hit while chasing a huge target
  // release on a small pond: it grew the orifice past the point where the model behaves
  // sensibly, producing a nonsensical near-zero routed peak that (wrongly) read as PASS.
  // Fixed by capping the orifice role at a physically sane 48 in — past that, the compound
  // structure leans on the control weir instead of an ever-growing single "orifice."
  it("never proposes a physically nonsensical oversized orifice (LOUD-FAILURE over a model artifact)", () => {
    // A huge drainage area with almost no impervious cover relative to a modest pond: a real,
    // if unusual, screening input that this solver has actually hit live.
    const SQ4 = [{ x: 0, y: 0 }, { x: 580, y: 0 }, { x: 580, y: 580 }, { x: 0, y: 580 } ];
    const DET4 = { depth: 7, freeboard: 1, slope: 3, tobElev: 100 };
    const criteria4 = { requiredStorms: [10, 100], orificeC: { value: 0.6 }, weirC: { value: 3.33 } };
    const r = autoSizeCompoundOutlet({ ring: SQ4, det: DET4, criteria: criteria4, areaAcres: 900, impPct: 0 });
    const orifice = r.outlet.stages.find((s) => s.role === "primary");
    expect(orifice.diameterIn).toBeLessThanOrEqual(48);
    // Whatever the verdict, every reported figure must be internally consistent — a claimed
    // PASS can never ride on a routed peak that's suspiciously exactly zero against a real
    // nonzero post-development peak (the tell for this exact model artifact).
    for (const s of r.perStorm) {
      if (s.postUnroutedCfs > 1 && s.status === "pass") expect(s.routedPeakCfs).toBeGreaterThan(0);
    }
  });
});
