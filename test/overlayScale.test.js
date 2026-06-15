import { describe, it, expect } from "vitest";
import {
  detectSheet, parseScaleNote, ftPerPointForScale, scaleForFtPerPoint, COMMON_SCALES,
} from "../src/workspaces/site-planner/lib/overlayScale.js";

const IN = 72; // points per inch

describe("overlay scale — sheet-size detection (B73)", () => {
  it("recognizes standard plot sheets in either orientation", () => {
    expect(detectSheet(36 * IN, 24 * IN).std).toBe(true);        // ARCH D landscape
    expect(detectSheet(24 * IN, 36 * IN).label).toMatch(/ARCH D/); // ...portrait, same sheet
    expect(detectSheet(34 * IN, 22 * IN).label).toMatch(/ANSI D/);
    expect(detectSheet(48 * IN, 36 * IN).label).toMatch(/ARCH E/);
  });
  it("tolerates a small margin off the exact size", () => {
    expect(detectSheet(36.3 * IN, 23.8 * IN).std).toBe(true);    // within ±0.6 in
  });
  it("flags a non-standard (likely shrunk) page as not std", () => {
    const r = detectSheet(11 * IN, 8.5 * IN); // letter — not a civil plot size... wait, ANSI A is 8.5x11
    expect(r.std).toBe(true); // 8.5x11 IS ANSI A
    const odd = detectSheet(9.7 * IN, 7.1 * IN);
    expect(odd.std).toBe(false);
    expect(odd.label).toContain("in");
  });
  it("does not confuse ANSI D (22×34) with ARCH D (24×36)", () => {
    expect(detectSheet(34 * IN, 22 * IN).label).toMatch(/ANSI D/);
    expect(detectSheet(36 * IN, 24 * IN).label).toMatch(/ARCH D/);
  });
});

describe("overlay scale — engineer's scale-note parsing (B73)", () => {
  it("reads the common civil forms", () => {
    expect(parseScaleNote('SCALE: 1"=100\'')).toBe(100);
    expect(parseScaleNote("1\" = 40'")).toBe(40);
    expect(parseScaleNote("1 inch = 60 ft")).toBe(60);
    expect(parseScaleNote('plan view  1"=200 FT  north')).toBe(200);
  });
  it("ignores junk and out-of-range values", () => {
    expect(parseScaleNote("no scale here")).toBe(null);
    expect(parseScaleNote("")).toBe(null);
    expect(parseScaleNote(null)).toBe(null);
    expect(parseScaleNote('1"=5\'')).toBe(null);     // below the 10 ft floor
    expect(parseScaleNote('1"=5000\'')).toBe(null);  // above the 1000 ft ceiling
  });
});

describe("overlay scale — scale↔size conversion (B73)", () => {
  it("ftPerPoint = feetPerInch / 72 and round-trips", () => {
    expect(ftPerPointForScale(72)).toBeCloseTo(1, 9);          // 1"=72' → 1 ft/pt
    expect(ftPerPointForScale(100)).toBeCloseTo(100 / 72, 9);
    expect(scaleForFtPerPoint(ftPerPointForScale(100))).toBeCloseTo(100, 9);
  });
  it("a 36-inch (ARCH D) sheet at 1\"=100' spans 3600 ft", () => {
    const widthPt = 36 * IN;
    expect(widthPt * ftPerPointForScale(100)).toBeCloseTo(3600, 6);
  });
  it("exposes the common civil scales", () => {
    expect(COMMON_SCALES).toContain(100);
    expect(COMMON_SCALES).toContain(20);
  });
});
