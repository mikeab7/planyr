import { describe, it, expect } from "vitest";
import { headingFromOrientation, headingFromCoords, resolveHeading, smoothHeading } from "../src/shared/map/locateHeading.js";
import { nextLocateState, tapAction } from "../src/shared/map/locateButtonState.js";
import { metersPerPixel, accuracyCircleVisible } from "../src/shared/map/locateGeometry.js";

describe("heading sources", () => {
  it("iOS: webkitCompassHeading is used as-is", () => {
    expect(headingFromOrientation({ webkitCompassHeading: 90 })).toBe(90);
    expect(headingFromOrientation({ webkitCompassHeading: 360 })).toBe(0);
  });
  it("Android/absolute: heading = 360 − alpha", () => {
    expect(headingFromOrientation({ alpha: 90, absolute: true })).toBe(270);
    expect(headingFromOrientation({ alpha: 0, absolute: true })).toBe(0);
  });
  it("a relative alpha is NOT north-referenced → no heading", () => {
    expect(headingFromOrientation({ alpha: 90, absolute: false })).toBeNull();
    expect(headingFromOrientation({ alpha: 90 })).toBeNull();
  });
  it("none (desktop): null, never a guessed 0", () => {
    expect(headingFromOrientation({ alpha: null, absolute: true })).toBeNull();
    expect(headingFromOrientation(null)).toBeNull();
    expect(resolveHeading({})).toBeNull();
  });
  it("coords.heading only counts while moving", () => {
    expect(headingFromCoords({ heading: 45, speed: 3 })).toBe(45);
    expect(headingFromCoords({ heading: 45, speed: 0 })).toBeNull();
    expect(headingFromCoords({ heading: NaN, speed: 3 })).toBeNull();
    expect(headingFromCoords({ heading: null, speed: null })).toBeNull();
  });
  it("compass wins over travel direction; travel is the fallback", () => {
    expect(resolveHeading({ orientationHeading: 10, coords: { heading: 200, speed: 5 } })).toBe(10);
    expect(resolveHeading({ coords: { heading: 200, speed: 5 } })).toBe(200);
  });
  it("smoothing takes the short way across north", () => {
    const h = smoothHeading(350, 10, 0.5);
    expect(h).toBeCloseTo(0, 5);
    expect(smoothHeading(null, 123)).toBe(123);
    expect(smoothHeading(10, null)).toBeNull();
  });
});

describe("locate button state machine", () => {
  it("idle → locating → following (found)", () => {
    let s = nextLocateState("idle", "tap"); expect(s).toBe("locating");
    s = nextLocateState(s, "found"); expect(s).toBe("following");
  });
  it("following → located when the user pans, tap re-centres to following", () => {
    expect(nextLocateState("following", "panned")).toBe("located");
    expect(tapAction("located")).toBe("recenter");
    expect(nextLocateState("located", "tap")).toBe("following");
  });
  it("a tap while following turns tracking off", () => {
    expect(tapAction("following")).toBe("stop");
    expect(nextLocateState("following", "tap")).toBe("idle");
  });
  it("a tap while locating cancels; an error always returns to idle (no stuck spinner)", () => {
    expect(tapAction("locating")).toBe("cancel");
    expect(nextLocateState("locating", "tap")).toBe("idle");
    for (const st of ["locating", "following", "located"]) expect(nextLocateState(st, "error")).toBe("idle");
  });
  it("unknown events leave the state alone", () => {
    expect(nextLocateState("idle", "panned")).toBe("idle");
    expect(nextLocateState("located", "found")).toBe("located");
  });
});

describe("accuracy circle geometry", () => {
  it("metres per pixel halves each zoom level", () => {
    expect(metersPerPixel(0, 10) / metersPerPixel(0, 11)).toBeCloseTo(2, 6);
  });
  it("hidden when it would hug the dot, shown when clearly wider", () => {
    expect(accuracyCircleVisible(5, 29.8, 10)).toBe(false);
    expect(accuracyCircleVisible(50, 29.8, 18)).toBe(true);
    expect(accuracyCircleVisible(0, 29.8, 18)).toBe(false);
  });
});
