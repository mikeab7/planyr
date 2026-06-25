import { describe, it, expect } from "vitest";
import { normalizeDeg, parseRotationInput, formatDeg } from "../src/shared/ui/RotationStepper.jsx";

/* B463 / owner "NEW-3" — the shared rotation stepper that retires the 0–360 slider. The
 * pure helpers carry the spec's hard rules: wrap into [0,360), accept hundredth-degree typed
 * values, reject non-numeric (so the UI can flash instead of clamping to 0), and never force
 * trailing .00 zeros on display. */

describe("normalizeDeg — wrap any angle into [0,360)", () => {
  it("leaves in-range values untouched", () => {
    expect(normalizeDeg(0)).toBe(0);
    expect(normalizeDeg(45.25)).toBe(45.25);
    expect(normalizeDeg(359.99)).toBe(359.99);
  });
  it("wraps over 360 (370 → 10)", () => {
    expect(normalizeDeg(370)).toBe(10);
    expect(normalizeDeg(720)).toBe(0);
    expect(normalizeDeg(360)).toBe(0);
  });
  it("wraps negatives (−5 → 355)", () => {
    expect(normalizeDeg(-5)).toBe(355);
    expect(normalizeDeg(-360)).toBe(0);
    expect(normalizeDeg(-365)).toBe(355);
  });
});

describe("parseRotationInput — typed text → committed value (or null to reject)", () => {
  it("parses whole and decimal degrees", () => {
    expect(parseRotationInput("45")).toBe(45);
    expect(parseRotationInput("45.25")).toBe(45.25);
    expect(parseRotationInput(" 90 ")).toBe(90);
  });
  it("accepts hundredth-degree precision and rounds to 2dp", () => {
    expect(parseRotationInput("12.34")).toBe(12.34);
    expect(parseRotationInput("12.345")).toBe(12.35); // rounds to hundredths
    expect(parseRotationInput("12.344")).toBe(12.34);
  });
  it("normalizes/wraps on parse (370 → 10, −5 → 355)", () => {
    expect(parseRotationInput("370")).toBe(10);
    expect(parseRotationInput("-5")).toBe(355);
    expect(parseRotationInput("360")).toBe(0);
  });
  it("rejects empty / partial / non-numeric (returns null, never 0)", () => {
    expect(parseRotationInput("")).toBeNull();
    expect(parseRotationInput("   ")).toBeNull();
    expect(parseRotationInput("-")).toBeNull();
    expect(parseRotationInput(".")).toBeNull();
    expect(parseRotationInput("abc")).toBeNull();
    expect(parseRotationInput("12deg")).toBeNull();
    expect(parseRotationInput("Infinity")).toBeNull();
    expect(parseRotationInput("NaN")).toBeNull();
    expect(parseRotationInput(null)).toBeNull();
  });
});

describe("formatDeg — display value (≤2 decimals, no forced .00)", () => {
  it("trims trailing zeros", () => {
    expect(formatDeg(45)).toBe("45");
    expect(formatDeg(45.5)).toBe("45.5");
    expect(formatDeg(45.25)).toBe("45.25");
  });
  it("normalizes before formatting", () => {
    expect(formatDeg(370)).toBe("10");
    expect(formatDeg(-5)).toBe("355");
  });
  it("is safe on non-finite input", () => {
    expect(formatDeg(NaN)).toBe("0");
    expect(formatDeg(Infinity)).toBe("0");
  });
});

describe("no rounding drift — repeated ±1 nudges off the stored value", () => {
  it("a fractional start stays fractional after many nudges (no creep to integer)", () => {
    let v = 10.37; // a value a freehand drag could leave
    for (let i = 0; i < 50; i++) v = normalizeDeg(v + 1);
    for (let i = 0; i < 50; i++) v = normalizeDeg(v - 1);
    expect(v).toBeCloseTo(10.37, 10); // exact round-trip, no accumulated rounding
  });
});
