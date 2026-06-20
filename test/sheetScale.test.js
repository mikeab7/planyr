import { describe, it, expect } from "vitest";
import { parseSheetScale, ftPerPointForScale } from "../src/workspaces/site-planner/lib/overlayScale.js";

describe("parseSheetScale — Document Review stated-scale auto-calibration (B267)", () => {
  it("reads engineer's scales (civil)", () => {
    expect(parseSheetScale('1"=50\'')).toMatchObject({ ftPerInch: 50, form: "engineer" });
    expect(parseSheetScale("SCALE: 1\" = 100 FT")).toMatchObject({ ftPerInch: 100, form: "engineer" });
    expect(parseSheetScale("1 inch = 30 ft")).toMatchObject({ ftPerInch: 30, form: "engineer" });
  });

  it("reads architectural fractional scales (below the civil floor)", () => {
    expect(parseSheetScale('1/4"=1\'-0"')).toMatchObject({ ftPerInch: 4, form: "arch" });
    expect(parseSheetScale('1/8" = 1\'-0"')).toMatchObject({ ftPerInch: 8, form: "arch" });
    expect(parseSheetScale('1/16" = 1\'-0"')).toMatchObject({ ftPerInch: 16, form: "arch" });
    expect(parseSheetScale('3/16"=1\'-0"').ftPerInch).toBeCloseTo(5.333, 2);
    expect(parseSheetScale('1 1/2"=1\'-0"').ftPerInch).toBeCloseTo(0.667, 2);
  });

  it("reads ratio scales", () => {
    expect(parseSheetScale("1:200").ftPerInch).toBeCloseTo(16.667, 2);
    expect(parseSheetScale("1 : 100").ftPerInch).toBeCloseTo(8.333, 2);
  });

  it("flags an explicit NOT TO SCALE / NTS / AS NOTED (distinct from no-scale)", () => {
    expect(parseSheetScale("SCALE: NOT TO SCALE")).toEqual({ explicit: "nts", label: "NOT TO SCALE" });
    expect(parseSheetScale("N.T.S.")).toMatchObject({ explicit: "nts" });
    expect(parseSheetScale("NTS")).toMatchObject({ explicit: "nts" });
    expect(parseSheetScale("SCALE: AS NOTED")).toMatchObject({ explicit: "nts" });
  });

  it("returns null when there is no parseable scale", () => {
    expect(parseSheetScale("GENERAL NOTES")).toBeNull();
    expect(parseSheetScale("Sheet 5 of 19")).toBeNull();
    expect(parseSheetScale("")).toBeNull();
    expect(parseSheetScale(null)).toBeNull();
  });

  it("matches the exact strings found in the owner's real sample sheets (2026-06-20)", () => {
    // KG B1 ARCH IFP (architectural)
    expect(parseSheetScale('1/16" = 1\'-0"')).toMatchObject({ ftPerInch: 16, form: "arch" });
    expect(parseSheetScale('1/4" = 1\'-0"')).toMatchObject({ ftPerInch: 4, form: "arch" });
    // Jacintoport Fire Sprinkler IFC
    expect(parseSheetScale("SCALE: NOT TO SCALE")).toMatchObject({ explicit: "nts" });
  });

  it("feet-per-point conversion is correct for an architectural scale", () => {
    // 1/16\"=1'-0\" → 16 ft/in → 16/72 ft per PDF point
    const r = parseSheetScale('1/16" = 1\'-0"');
    expect(ftPerPointForScale(r.ftPerInch)).toBeCloseTo(16 / 72, 6);
  });
});
