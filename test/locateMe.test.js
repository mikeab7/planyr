import { describe, it, expect } from "vitest";
import {
  shouldShowAccuracyCircle,
  formatAccuracyFt,
  locateErrorMessage,
  ACCURACY_CIRCLE_THRESHOLD_M,
  ACCURACY_USABLE_THRESHOLD_M,
  isAccuracyUsable,
  garbageAccuracyMessage,
  locateAvailability,
  locateUnavailableTooltip,
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

// NEW-MAPCTRL-2 — STEEL-MAN vii: a fix too vague to be a location at all (classic desktop
// IP-based positioning, 20-50 km) must never be treated as usable, distinct from merely not
// warranting the tight accuracy ring.
describe("isAccuracyUsable — a fix too vague to be a location at all, not just an imprecise one", () => {
  it("is usable well inside the threshold — a GPS-class fix", () => {
    expect(isAccuracyUsable(15)).toBe(true);
  });

  it("is usable past the circle threshold but still a real-world fix (Wi-Fi/cellular)", () => {
    expect(isAccuracyUsable(ACCURACY_CIRCLE_THRESHOLD_M + 1)).toBe(true);
    expect(isAccuracyUsable(5000)).toBe(true);
  });

  it("is usable right at the ceiling, unusable just past it", () => {
    expect(isAccuracyUsable(ACCURACY_USABLE_THRESHOLD_M)).toBe(true);
    expect(isAccuracyUsable(ACCURACY_USABLE_THRESHOLD_M + 1)).toBe(false);
  });

  it("rejects classic desktop IP-geolocation accuracy (20-50 km) as unusable", () => {
    expect(isAccuracyUsable(20000)).toBe(false);
    expect(isAccuracyUsable(35000)).toBe(false);
    expect(isAccuracyUsable(50000)).toBe(false);
  });

  it("refuses a non-finite, zero or negative accuracy — never usable", () => {
    expect(isAccuracyUsable(0)).toBe(false);
    expect(isAccuracyUsable(-5)).toBe(false);
    expect(isAccuracyUsable(NaN)).toBe(false);
    expect(isAccuracyUsable(undefined)).toBe(false);
    expect(isAccuracyUsable(Infinity)).toBe(false);
  });
});

describe("garbageAccuracyMessage — honest, never a silent drop of a bad fix", () => {
  it("names the fact that this looks like a network guess, not a real location", () => {
    expect(garbageAccuracyMessage(35000)).toMatch(/not.*a real location|rough network guess/i);
  });

  it("includes the accuracy figure when it's readable", () => {
    expect(garbageAccuracyMessage(32187)).toMatch(/accuracy/i);
  });

  it("still returns a non-empty, honest sentence when the accuracy itself is unreadable", () => {
    const msg = garbageAccuracyMessage(undefined);
    expect(msg.length).toBeGreaterThan(0);
    expect(msg).toMatch(/not.*a real location|rough network guess/i);
  });
});

// NEW-MAPCTRL-2 — STEEL-MAN i/v/vi: a control that already knows it cannot succeed must say so
// WITHOUT ever calling getCurrentPosition, so it never spins in a permanently-blocked environment.
describe("locateAvailability — checked BEFORE getCurrentPosition, so a blocked control never spins", () => {
  it("is 'ready' when nothing is known to block it", () => {
    expect(locateAvailability({ isSecureContext: true, hasGeolocation: true, permissionState: "prompt" })).toBe("ready");
    expect(locateAvailability({ isSecureContext: true, hasGeolocation: true, permissionState: "granted" })).toBe("ready");
    expect(locateAvailability({})).toBe("ready"); // unknown environment reads as ready — the reactive path still answers honestly
  });

  it("is 'insecure' on a non-HTTPS page regardless of anything else", () => {
    expect(locateAvailability({ isSecureContext: false, hasGeolocation: true, permissionState: "granted" })).toBe("insecure");
  });

  it("is 'unsupported' when the browser exposes no Geolocation API", () => {
    expect(locateAvailability({ isSecureContext: true, hasGeolocation: false })).toBe("unsupported");
  });

  it("is 'blocked' when the permission is already denied — an enterprise/company policy, no prompt ever shown", () => {
    expect(locateAvailability({ isSecureContext: true, hasGeolocation: true, permissionState: "denied" })).toBe("blocked");
  });

  it("checks insecure/unsupported BEFORE a denied permission — the more fundamental reason wins", () => {
    expect(locateAvailability({ isSecureContext: false, hasGeolocation: true, permissionState: "denied" })).toBe("insecure");
  });
});

describe("locateUnavailableTooltip — an honest, non-empty reason for every unavailable state", () => {
  it("names each reason distinctly", () => {
    expect(locateUnavailableTooltip("insecure")).toMatch(/https|secure/i);
    expect(locateUnavailableTooltip("unsupported")).toMatch(/browser/i);
    expect(locateUnavailableTooltip("blocked")).toMatch(/blocked|policy/i);
  });

  it("never returns an empty string, including for 'ready' (used as the idle tooltip)", () => {
    for (const a of ["ready", "insecure", "unsupported", "blocked", undefined]) {
      expect(locateUnavailableTooltip(a).length).toBeGreaterThan(0);
    }
  });
});
