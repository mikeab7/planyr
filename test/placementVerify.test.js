import { describe, it, expect } from "vitest";
import {
  parseFeetInches, scaleFromDimension, severityFor, verifyDimension, crossCheck,
  OK_PCT, WARN_PCT,
} from "../src/workspaces/site-planner/lib/placementVerify.js";

describe("placementVerify — parseFeetInches (B183)", () => {
  it("parses feet-inches forms", () => {
    expect(parseFeetInches("24'-0\"")).toBeCloseTo(24, 9);
    expect(parseFeetInches("24'-6\"")).toBeCloseTo(24.5, 9);
    expect(parseFeetInches("24' 6\"")).toBeCloseTo(24.5, 9);
    expect(parseFeetInches("570'")).toBeCloseTo(570, 9);
    expect(parseFeetInches("12.5'")).toBeCloseTo(12.5, 9);
  });
  it("parses ft/feet and bare numbers as feet", () => {
    expect(parseFeetInches("100 ft")).toBeCloseTo(100, 9);
    expect(parseFeetInches("240 feet")).toBeCloseTo(240, 9);
    expect(parseFeetInches("24")).toBeCloseTo(24, 9);
    expect(parseFeetInches(48)).toBe(48);
  });
  it("returns null on junk", () => {
    expect(parseFeetInches("")).toBe(null);
    expect(parseFeetInches("north")).toBe(null);
    expect(parseFeetInches(null)).toBe(null);
  });
});

describe("placementVerify — scaleFromDimension (rung-4 calibration)", () => {
  it("derives feet-per-unit from a traced length + real value", () => {
    expect(scaleFromDimension(240, 120)).toBeCloseTo(0.5, 9); // 120 ft over 240 px
  });
  it("guards bad inputs", () => {
    expect(scaleFromDimension(0, 100)).toBe(null);
    expect(scaleFromDimension(100, 0)).toBe(null);
    expect(scaleFromDimension(-5, 100)).toBe(null);
    expect(scaleFromDimension(Infinity, 100)).toBe(null);
  });
});

describe("placementVerify — verifyDimension (auto-verification probe)", () => {
  it("reports a tight match as ok with a number, not an eyeball", () => {
    const v = verifyDimension({ measuredFt: 24.02, stated: "24'-0\"" });
    expect(v.status).toBe("ok");
    expect(v.severity).toBe("none");
    expect(v.pctOff).toBeLessThan(OK_PCT);
    expect(v.label).toMatch(/measures 24(\.0)? ft, label 24'-0" — 0\.1% off/);
  });
  it("flags a frank miss as fail + high severity (silent-failure rule)", () => {
    const v = verifyDimension({ measuredFt: 30, statedFt: 24 });
    expect(v.status).toBe("fail");
    expect(v.severity).toBe("high");
    expect(v.pctOff).toBeCloseTo(25, 5);
  });
  it("treats a small-but-real gap as a warn", () => {
    const v = verifyDimension({ measuredFt: 24 * (1 + WARN_PCT / 100 / 2), statedFt: 24 });
    expect(v.status).toBe("warn");
    expect(v.severity).toBe("low");
  });
  it("returns null when a value is missing/bad", () => {
    expect(verifyDimension({ measuredFt: 24 })).toBe(null);
    expect(verifyDimension({ statedFt: 24 })).toBe(null);
    expect(verifyDimension({ measuredFt: 24, statedFt: 0 })).toBe(null);
  });
});

describe("placementVerify — severityFor", () => {
  it("buckets percent-off into none/low/high", () => {
    expect(severityFor(0.2)).toBe("none");
    expect(severityFor(1.5)).toBe("low");
    expect(severityFor(8)).toBe("high");
    expect(severityFor(NaN)).toBe("high");
  });
});

describe("placementVerify — crossCheck (two independent reads)", () => {
  it("agrees and yields one confident scale when within tolerance", () => {
    const r = crossCheck({ scale: 0.500, axis: "x" }, { scale: 0.502, axis: "y" });
    expect(r.status).toBe("agree");
    expect(r.scale).toBeCloseTo(0.501, 6);
    expect(r.pctDiff).toBeLessThan(1);
  });
  it("flags non-uniform scaling as a distinct state and does NOT average", () => {
    const r = crossCheck({ scale: 0.50, axis: "x" }, { scale: 0.60, axis: "y" });
    expect(r.status).toBe("nonuniform");
    expect(r.scale).toBe(null);               // never silently averaged
    expect(r.pctDiff).toBeGreaterThan(1);
    expect(r.note).toMatch(/x vs y/);
    expect(r.note).toMatch(/stretched unevenly/);
  });
  it("is insufficient when a read is missing", () => {
    expect(crossCheck({ scale: 0.5 }, null).status).toBe("insufficient");
    expect(crossCheck({ scale: 0 }, { scale: 0.5 }).status).toBe("insufficient");
  });
});
