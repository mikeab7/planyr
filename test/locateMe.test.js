import { describe, it, expect } from "vitest";
import {
  shouldShowAccuracyCircle,
  formatAccuracyFt,
  locateErrorMessage,
  ACCURACY_CIRCLE_THRESHOLD_M,
} from "../src/workspaces/site-planner/lib/locateMe.js";

describe("shouldShowAccuracyCircle — honest precision (never draw a tight ring on a vague fix)", () => {
  it("shows the circle for a tight GPS-class fix", () => {
    expect(shouldShowAccuracyCircle(10)).toBe(true);
    expect(shouldShowAccuracyCircle(30)).toBe(true);
  });

  it("shows the circle right at the threshold, hides it just past", () => {
    expect(shouldShowAccuracyCircle(ACCURACY_CIRCLE_THRESHOLD_M)).toBe(true);
    expect(shouldShowAccuracyCircle(ACCURACY_CIRCLE_THRESHOLD_M + 1)).toBe(false);
  });

  it("hides the circle for a vague Wi-Fi/IP-class fix", () => {
    expect(shouldShowAccuracyCircle(5000)).toBe(false);
  });

  it("refuses a non-finite, zero or negative accuracy rather than drawing a nonsense circle", () => {
    expect(shouldShowAccuracyCircle(0)).toBe(false);
    expect(shouldShowAccuracyCircle(-5)).toBe(false);
    expect(shouldShowAccuracyCircle(NaN)).toBe(false);
    expect(shouldShowAccuracyCircle(undefined)).toBe(false);
    expect(shouldShowAccuracyCircle(Infinity)).toBe(false);
  });
});

describe("formatAccuracyFt — feet below a mile, miles above", () => {
  it("formats a tight fix in feet", () => {
    expect(formatAccuracyFt(10)).toMatch(/^±\d+ ft$/);
  });

  it("formats a vague fix in miles once past a mile", () => {
    const s = formatAccuracyFt(5000); // ~3.1 mi
    expect(s).toMatch(/^±\d+\.\d mi$/);
  });

  it("never prints an absurd feet count past a mile", () => {
    expect(formatAccuracyFt(5000)).not.toMatch(/ft$/);
  });

  it("returns null for an unreadable accuracy", () => {
    expect(formatAccuracyFt(0)).toBeNull();
    expect(formatAccuracyFt(-1)).toBeNull();
    expect(formatAccuracyFt(NaN)).toBeNull();
    expect(formatAccuracyFt(undefined)).toBeNull();
  });
});

describe("locateErrorMessage — an honest sentence for every GeolocationPositionError code", () => {
  it("names permission denial specifically (code 1)", () => {
    expect(locateErrorMessage(1)).toMatch(/denied/i);
  });

  it("names a timeout specifically (code 3)", () => {
    expect(locateErrorMessage(3)).toMatch(/too long/i);
  });

  it("falls back to an honest generic message for position-unavailable (code 2) and any unknown code", () => {
    expect(locateErrorMessage(2)).toBeTruthy();
    expect(locateErrorMessage(999)).toBeTruthy();
    expect(locateErrorMessage(undefined)).toBeTruthy();
  });

  it("never returns an empty string, so a caller can never show a silent failure", () => {
    for (const code of [1, 2, 3, 0, undefined, null, "x"]) {
      expect(locateErrorMessage(code).length).toBeGreaterThan(0);
    }
  });
});
