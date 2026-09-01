import { describe, it, expect, beforeEach } from "vitest";
import {
  MIN_ZOOM, MAX_ZOOM, DEFAULT_ZOOM,
  clampZoom, zoomFromWheelDelta, zoomStepButton, readZoom, writeZoom,
} from "../src/workspaces/model/lib/sheetZoom.js";

describe("clampZoom", () => {
  it("passes a value already inside [MIN_ZOOM, MAX_ZOOM] through unchanged", () => {
    expect(clampZoom(1)).toBe(1);
    expect(clampZoom(0.75)).toBe(0.75);
  });
  it("clamps below MIN_ZOOM and above MAX_ZOOM", () => {
    expect(clampZoom(0.1)).toBe(MIN_ZOOM);
    expect(clampZoom(5)).toBe(MAX_ZOOM);
  });
  it("a non-finite or garbage value falls back to DEFAULT_ZOOM, never NaN/Infinity", () => {
    expect(clampZoom(NaN)).toBe(DEFAULT_ZOOM);
    expect(clampZoom(Infinity)).toBe(DEFAULT_ZOOM);
    expect(clampZoom(undefined)).toBe(DEFAULT_ZOOM);
    expect(clampZoom("not a number")).toBe(DEFAULT_ZOOM);
  });
});

describe("zoomFromWheelDelta", () => {
  it("a negative deltaY (scroll up/away) zooms IN", () => {
    expect(zoomFromWheelDelta(1, -100)).toBeGreaterThan(1);
  });
  it("a positive deltaY (scroll down/toward) zooms OUT", () => {
    expect(zoomFromWheelDelta(1, 100)).toBeLessThan(1);
  });
  it("deltaY of 0 is a no-op", () => {
    expect(zoomFromWheelDelta(1, 0)).toBe(1);
  });
  it("never produces a result outside [MIN_ZOOM, MAX_ZOOM] regardless of how large the delta is", () => {
    expect(zoomFromWheelDelta(1, -100000)).toBe(MAX_ZOOM);
    expect(zoomFromWheelDelta(1, 100000)).toBe(MIN_ZOOM);
  });
  it("a trackpad's many small deltas and a mouse wheel's few large ones land near the same place for the same total magnitude", () => {
    let trackpad = 1;
    for (let i = 0; i < 100; i++) trackpad = zoomFromWheelDelta(trackpad, -6); // 100 * 6 = 600
    const mouseWheel = zoomFromWheelDelta(1, -600);
    expect(Math.abs(trackpad - mouseWheel)).toBeLessThan(0.02);
  });
});

describe("zoomStepButton", () => {
  it("steps up/down by a fixed 10%", () => {
    expect(zoomStepButton(1, 1)).toBeCloseTo(1.1, 10);
    expect(zoomStepButton(1, -1)).toBeCloseTo(0.9, 10);
  });
  it("clamps at the bounds rather than stepping past them", () => {
    expect(zoomStepButton(MAX_ZOOM, 1)).toBe(MAX_ZOOM);
    expect(zoomStepButton(MIN_ZOOM, -1)).toBe(MIN_ZOOM);
  });
});

// The suite runs in the `node` environment (vitest.config.js — deliberately no jsdom, so the
// pure suites stay fast), so localStorage is stubbed here — same pattern as
// test/smoothZoomHome.test.js, the repo's own precedent for a localStorage-backed preference.
function installLocalStorageStub() {
  const store = new Map();
  globalThis.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => { store.set(k, String(v)); },
    removeItem: (k) => { store.delete(k); },
    clear: () => { store.clear(); },
  };
}

describe("readZoom / writeZoom — per-project localStorage, never the undo stack or the cloud", () => {
  beforeEach(() => { installLocalStorageStub(); });

  it("an unseen project reads DEFAULT_ZOOM", () => {
    expect(readZoom("proj-1")).toBe(DEFAULT_ZOOM);
  });
  it("round-trips a written value", () => {
    writeZoom("proj-1", 1.5);
    expect(readZoom("proj-1")).toBe(1.5);
  });
  it("clamps on write, so a corrupt/out-of-range stored value never reads back out of bounds", () => {
    writeZoom("proj-1", 99);
    expect(readZoom("proj-1")).toBe(MAX_ZOOM);
  });
  it("is keyed per project — two projects never share a zoom level", () => {
    writeZoom("proj-1", 1.5);
    writeZoom("proj-2", 0.6);
    expect(readZoom("proj-1")).toBe(1.5);
    expect(readZoom("proj-2")).toBe(0.6);
  });
  it("a hand-corrupted (non-JSON) stored value falls back to DEFAULT_ZOOM rather than throwing", () => {
    localStorage.setItem("planyr:model:zoom:v1:proj-1", "{not json");
    expect(() => readZoom("proj-1")).not.toThrow();
    expect(readZoom("proj-1")).toBe(DEFAULT_ZOOM);
  });
  it("no projectId is a safe no-op / default read, never a crash", () => {
    expect(() => writeZoom(null, 1.5)).not.toThrow();
    expect(readZoom(null)).toBe(DEFAULT_ZOOM);
  });
});
