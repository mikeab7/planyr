// NEW-A2 — outlet-structure rating curve: orifice / weir / restrictor discharge,
// submergence, inverse sizing, validation. Pure — no browser. Hand-computed hydraulics.
import { describe, it, expect } from "vitest";
import {
  orificeAreaSf,
  stageDischarge,
  outletDischarge,
  sizeOrificeForRelease,
  sizeWeirForRelease,
  defaultOutletForPond,
  outletProblems,
  outletLowestElev,
} from "../src/workspaces/site-planner/lib/outletStructure.js";

describe("orificeAreaSf", () => {
  it("6-inch orifice = π·0.25/4 ft²", () => {
    expect(orificeAreaSf(6)).toBeCloseTo(Math.PI * 0.5 * 0.5 / 4, 6); // 0.19635
  });
  it("non-positive / non-finite → 0", () => {
    expect(orificeAreaSf(0)).toBe(0);
    expect(orificeAreaSf(null)).toBe(0);
    expect(orificeAreaSf(-3)).toBe(0);
  });
});

describe("stageDischarge — orifice Q = C·A·√(2g·h)", () => {
  const orf = { kind: "orifice", invertElevFt: 90, diameterIn: 6, count: 1, coeff: 0.6 };
  it("free orifice at 9.75 ft head ≈ 2.95 cfs", () => {
    // centroid = 90.25; ws 100 → h 9.75; 0.6·0.19635·8.0217·√9.75
    expect(stageDischarge(orf, 100)).toBeCloseTo(2.951, 2);
  });
  it("below the centroid → 0 (never negative)", () => {
    expect(stageDischarge(orf, 90.1)).toBe(0);
    expect(stageDischarge(orf, 80)).toBe(0);
  });
  it("count multiplies the flow", () => {
    const two = { ...orf, count: 2 };
    expect(stageDischarge(two, 100)).toBeCloseTo(2 * stageDischarge(orf, 100), 6);
  });
  it("tailwater submerges to the differential head", () => {
    // tailwater at 95 → effective downstream 95 → h = 100-95 = 5 (< the 9.75 free head)
    const sub = stageDischarge(orf, 100, { tailwaterElevFt: 95 });
    expect(sub).toBeCloseTo(0.6 * orificeAreaSf(6) * Math.sqrt(2 * 32.174) * Math.sqrt(5), 3);
    expect(sub).toBeLessThan(stageDischarge(orf, 100)); // submerged passes less
  });
  it("malformed orifice (no diameter) → null, never a fabricated flow", () => {
    expect(stageDischarge({ kind: "orifice", invertElevFt: 90 }, 100)).toBeNull();
  });
});

describe("stageDischarge — weir Q = C·L·h^1.5", () => {
  const weir = { kind: "weir", crestElevFt: 98, lengthFt: 10, coeff: 3.33 };
  it("2 ft over a 10 ft crest ≈ 94.19 cfs", () => {
    expect(stageDischarge(weir, 100)).toBeCloseTo(3.33 * 10 * Math.pow(2, 1.5), 2); // 94.19
  });
  it("below the crest → 0", () => {
    expect(stageDischarge(weir, 97)).toBe(0);
  });
  it("submerged weir passes less than free weir", () => {
    const free = stageDischarge(weir, 100);
    const sub = stageDischarge(weir, 100, { tailwaterElevFt: 99.5 });
    expect(sub).toBeLessThan(free);
    expect(sub).toBeGreaterThan(0);
  });
});

describe("stageDischarge — restrictor (constant once engaged)", () => {
  const r = { kind: "restrictor", invertElevFt: 90, maxCfs: 5 };
  it("holds its rate above the invert, zero below", () => {
    expect(stageDischarge(r, 95)).toBe(5);
    expect(stageDischarge(r, 90)).toBe(0);
    expect(stageDischarge(r, 89)).toBe(0);
  });
});

describe("outletDischarge — multistage sum + problem surfacing", () => {
  const outlet = { stages: [
    { kind: "orifice", invertElevFt: 90, diameterIn: 6, count: 1, coeff: 0.6 },
    { kind: "weir", crestElevFt: 98, lengthFt: 10, coeff: 3.33 },
  ] };
  it("sums engaged stages", () => {
    const d = outletDischarge(100, outlet);
    expect(d.cfs).toBeCloseTo(2.951 + 94.19, 1);
    expect(d.problems).toHaveLength(0);
  });
  it("only the orifice is engaged below the weir crest", () => {
    const d = outletDischarge(97, outlet);
    expect(d.cfs).toBeCloseTo(stageDischarge(outlet.stages[0], 97), 6);
  });
  it("a malformed stage lands in problems and contributes 0 — never mistaken for closed", () => {
    const broken = { stages: [{ kind: "orifice", invertElevFt: 90 /* no diameter */ }] };
    const d = outletDischarge(100, broken);
    expect(d.cfs).toBe(0);
    expect(d.problems.length).toBe(1);
  });
  it("criteria supplies the coefficient fallback", () => {
    const noCoeff = { stages: [{ kind: "orifice", invertElevFt: 90, diameterIn: 6 }] };
    const withCrit = outletDischarge(100, noCoeff, { criteria: { orificeC: { value: 0.8 } } });
    const with06 = outletDischarge(100, noCoeff, { criteria: { orificeC: { value: 0.6 } } });
    expect(withCrit.cfs).toBeCloseTo((0.8 / 0.6) * with06.cfs, 4);
  });
});

// B903 — a genuine THREE-stage compound outlet (low-flow orifice + control weir + emergency
// spillway at three different elevations): the rating curve must be the SUM of whichever
// stages are engaged at a given water surface, transitioning cleanly at each invert/crest.
describe("outletDischarge — a 3-stage COMPOUND structure sums + transitions correctly (B903)", () => {
  const outlet = { stages: [
    { kind: "orifice", invertElevFt: 90, diameterIn: 12, count: 1, coeff: 0.6, role: "primary" },
    { kind: "weir", crestElevFt: 93, lengthFt: 4, coeff: 3.33, role: "control" },
    { kind: "weir", crestElevFt: 98, lengthFt: 20, coeff: 3.33, role: "spillway" },
  ] };
  it("below the control crest: only the orifice is engaged", () => {
    const d = outletDischarge(92, outlet);
    expect(d.cfs).toBeCloseTo(stageDischarge(outlet.stages[0], 92), 6);
  });
  it("between the control crest and the spillway crest: orifice + control weir sum", () => {
    const d = outletDischarge(95, outlet);
    const expected = stageDischarge(outlet.stages[0], 95) + stageDischarge(outlet.stages[1], 95);
    expect(d.cfs).toBeCloseTo(expected, 6);
    // and the spillway (not yet engaged) contributes nothing
    expect(stageDischarge(outlet.stages[2], 95)).toBe(0);
  });
  it("above the spillway crest: ALL THREE stages sum together", () => {
    const d = outletDischarge(99, outlet);
    const expected = stageDischarge(outlet.stages[0], 99) + stageDischarge(outlet.stages[1], 99) + stageDischarge(outlet.stages[2], 99);
    expect(d.cfs).toBeCloseTo(expected, 6);
    expect(d.problems).toHaveLength(0);
  });
  it("discharge is monotonically non-decreasing across the transitions (no discontinuous drop)", () => {
    const elevs = [91, 92.9, 93, 93.1, 95, 97.9, 98, 98.1, 99];
    const cfs = elevs.map((e) => outletDischarge(e, outlet).cfs);
    for (let i = 1; i < cfs.length; i++) expect(cfs[i]).toBeGreaterThanOrEqual(cfs[i - 1] - 1e-9);
  });
});

describe("sizeWeirForRelease — inverse round-trips (B903)", () => {
  it("sizing to 50 cfs at 2 ft head, then discharging at 2 ft head, returns ~50 cfs", () => {
    const L = sizeWeirForRelease({ targetCfs: 50, headFt: 2, coeff: 3.33 });
    expect(L).not.toBeNull();
    const weir = { kind: "weir", crestElevFt: 90, lengthFt: L, coeff: 3.33 };
    expect(stageDischarge(weir, 92)).toBeCloseTo(50, 1);
  });
  it("bad inputs → null", () => {
    expect(sizeWeirForRelease({ targetCfs: 0, headFt: 2 })).toBeNull();
    expect(sizeWeirForRelease({ targetCfs: 50, headFt: 0 })).toBeNull();
  });
});

describe("sizeOrificeForRelease — inverse round-trips", () => {
  it("sizing to 2 cfs at 4 ft head, then discharging at 4 ft head, returns ~2 cfs", () => {
    const sized = sizeOrificeForRelease({ targetCfs: 2, headFt: 4, coeff: 0.6 });
    expect(sized).not.toBeNull();
    const orf = { kind: "orifice", invertElevFt: 0, diameterIn: sized.diameterIn, count: 1, coeff: 0.6 };
    // discharge with head measured from centroid: ws so that ws - centroid = 4
    const centroid = sized.diameterIn / 12 / 2;
    expect(stageDischarge(orf, centroid + 4)).toBeCloseTo(2, 1);
  });
  it("bad inputs → null", () => {
    expect(sizeOrificeForRelease({ targetCfs: 0, headFt: 4 })).toBeNull();
    expect(sizeOrificeForRelease({ targetCfs: 2, headFt: 0 })).toBeNull();
  });
});

describe("defaultOutletForPond", () => {
  it("proposes a floor orifice sized to the allowable release", () => {
    const r = defaultOutletForPond({ floorElevFt: 90, designWsElevFt: 99, allowableReleaseCfs: 3, orificeC: 0.6 });
    expect(r.outlet.stages[0].kind).toBe("orifice");
    expect(r.outlet.stages[0].invertElevFt).toBe(90);
    expect(r.estimated).toBe(true);
    expect(r.targetCfs).toBe(3);
  });
  it("refuses (reason, no fabricated hole) when unanchored or no release", () => {
    expect(defaultOutletForPond({ floorElevFt: null, designWsElevFt: 99, allowableReleaseCfs: 3 }).outlet).toBeNull();
    expect(defaultOutletForPond({ floorElevFt: 90, designWsElevFt: 99, allowableReleaseCfs: null }).outlet).toBeNull();
  });
});

describe("outletProblems + outletLowestElev", () => {
  it("empty outlet is a problem", () => {
    expect(outletProblems(null)).toEqual(["no outlet stages defined"]);
    expect(outletProblems({ stages: [] })).toEqual(["no outlet stages defined"]);
  });
  it("flags each malformed stage", () => {
    const p = outletProblems({ stages: [{ kind: "orifice", invertElevFt: 90 }, { kind: "weir", crestElevFt: 98 }] });
    expect(p.length).toBe(2);
  });
  it("lowest engaged elevation across mixed stages", () => {
    const outlet = { stages: [{ kind: "weir", crestElevFt: 98, lengthFt: 10 }, { kind: "orifice", invertElevFt: 90, diameterIn: 6 }] };
    expect(outletLowestElev(outlet)).toBe(90);
  });
});
