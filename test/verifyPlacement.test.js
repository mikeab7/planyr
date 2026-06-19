import { describe, it, expect } from "vitest";
import {
  calibrateFromDimension, verifyDimension, crossCheckScales,
  VERIFY_OK_PCT, CROSS_DISAGREE_PCT,
} from "../src/shared/placement/verifyPlacement.js";

describe("verifyPlacement — calibrate from a labeled dimension (B183/NEW-4 rung 4)", () => {
  it("derives feet-per-unit from a traced length + its certified value", () => {
    const c = calibrateFromDimension(2, 240); // 2 drawn units = 240 ft
    expect(c.feetPerUnit).toBeCloseTo(120, 9);
  });
  it("rejects bad input", () => {
    expect(calibrateFromDimension(0, 100)).toBe(null);
    expect(calibrateFromDimension(2, -1)).toBe(null);
  });
});

describe("verifyPlacement — auto-verification probe (surface a number, not a thumbs-up)", () => {
  it("reports a tiny percentage as ok", () => {
    const v = verifyDimension(24.0, 24); // column grid label 24'-0"
    expect(v.ok).toBe(true);
    expect(v.severity).toBe("ok");
    expect(v.pct).toBeLessThanOrEqual(VERIFY_OK_PCT);
    expect(v.message).toMatch(/measures 24 ft, label 24 ft/);
  });
  it("grades a 2% miss as warn and a 10% miss as bad", () => {
    expect(verifyDimension(24.48, 24).severity).toBe("warn"); // 2%
    expect(verifyDimension(26.4, 24).severity).toBe("bad");   // 10%
  });
  it("returns a signed delta and rejects bad input", () => {
    expect(verifyDimension(25, 24).deltaFt).toBeCloseTo(1, 9);
    expect(verifyDimension(0, 24)).toBe(null);
  });
});

describe("verifyPlacement — cross-check two independent graphics", () => {
  it("agreeing graphics → confident, reports a mean scale", () => {
    const r = crossCheckScales([{ feetPerUnit: 100, axis: "x" }, { feetPerUnit: 100.5, axis: "y" }]);
    expect(r.state).toBe("confident");
    expect(r.meanScale).toBeCloseTo(100.25, 5);
    expect(r.spreadPct).toBeLessThanOrEqual(CROSS_DISAGREE_PCT);
  });
  it("disagreeing axes → non-uniform, NOT averaged (meanScale null)", () => {
    const r = crossCheckScales([{ feetPerUnit: 100, axis: "x" }, { feetPerUnit: 110, axis: "y" }]); // 10% apart
    expect(r.state).toBe("non-uniform");
    expect(r.meanScale).toBe(null);
    expect(r.axes).toHaveLength(2);
    expect(r.message).toMatch(/non-uniform/i);
  });
  it("fewer than two valid samples → insufficient", () => {
    expect(crossCheckScales([{ feetPerUnit: 100 }]).state).toBe("insufficient");
    expect(crossCheckScales([{ feetPerUnit: 0 }, { feetPerUnit: -1 }]).state).toBe("insufficient");
  });
});
