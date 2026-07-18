// NEW-A4 — screening reservoir routing (modified-Puls) proving Post ≤ Pre per storm.
// Pure — no browser. Property-based routing checks + hand-computed rational peaks.
import { describe, it, expect } from "vitest";
import {
  rationalPeakCfs,
  modifiedRationalHydrograph,
  routeHydrograph,
  routeStorm,
  assessRoutedDetention,
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
