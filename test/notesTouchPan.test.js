/* NEW-2 — the pure half of touch pan / pinch-with-midpoint / inertia (lib/notesViewport.js). The
 * wiring is proven on a real touch engine by ui-audit/verify-notes-touch-pan.mjs. */
import { describe, expect, it } from "vitest";
import {
  TOUCH_PAN_SLOP, inertiaStep, panView, pinchView, releaseVelocity, toWorkspace, touchTravelled,
} from "../src/workspaces/notes/lib/notesViewport.js";

describe("touch pan slop is a fingertip's, not a mouse's", () => {
  it("a wobble inside the slop is still a tap; past it is a pan", () => {
    expect(TOUCH_PAN_SLOP).toBeGreaterThan(4);
    expect(touchTravelled({ x: 0, y: 0 }, { x: 6, y: 5 })).toBe(false);
    expect(touchTravelled({ x: 0, y: 0 }, { x: 11, y: 0 })).toBe(true);
  });
});

describe("a one-finger drag moves the content by the finger's travel", () => {
  it("content follows the finger (view moves the opposite way), zoom untouched", () => {
    expect(panView({ x: 100, y: 200, z: 1.5 }, { x: 50, y: 50 }, { x: 20, y: 90 })).toEqual({ x: 130, y: 160, z: 1.5 });
  });
});

describe("pinch zooms AND follows the midpoint", () => {
  const start = { view: { x: 40, y: 80, z: 1 }, mid: { x: 150, y: 200 }, dist: 100 };
  it("the workspace point under the starting midpoint stays under the current midpoint", () => {
    const now = { mid: { x: 210, y: 170 }, dist: 200 };
    const v = pinchView(start, now);
    expect(v.z).toBeCloseTo(2, 6);
    const w0 = toWorkspace(start.view, start.mid);
    const w1 = toWorkspace(v, now.mid);
    expect(w1.x).toBeCloseTo(w0.x, 6);
    expect(w1.y).toBeCloseTo(w0.y, 6);
  });
  it("a pure two-finger drag (same spread) is a pure pan", () => {
    const v = pinchView(start, { mid: { x: 180, y: 260 }, dist: 100 });
    expect(v).toEqual({ x: 10, y: 20, z: 1 });
  });
  it("zoom is clamped; a degenerate start spread does not produce NaN", () => {
    expect(pinchView(start, { mid: start.mid, dist: 1e9 }).z).toBeLessThanOrEqual(8);
    const v = pinchView({ ...start, dist: 0 }, { mid: start.mid, dist: 50 });
    expect(Number.isFinite(v.x) && Number.isFinite(v.y) && v.z === 1).toBe(true);
  });
});

describe("inertia", () => {
  it("a flick carries on and decays to a stop; a held finger does not fling", () => {
    const now = 1000;
    const flick = releaseVelocity([{ t: 940, x: 0, y: 0 }, { t: 980, x: 40, y: 0 }, { t: 995, x: 55, y: 0 }], now);
    expect(flick.x).toBeGreaterThan(5);
    const held = releaseVelocity([{ t: 700, x: 0, y: 0 }, { t: 740, x: 40, y: 0 }], now);
    expect(held).toEqual({ x: 0, y: 0 });
    let v = flick; let travelled = 0; let frames = 0;
    for (;;) { const s = inertiaStep(v); if (s.done) break; travelled += s.delta.x; v = s.vel; frames += 1; if (frames > 500) throw new Error("never stops"); }
    expect(frames).toBeGreaterThan(3);
    expect(frames).toBeLessThan(120);
    expect(travelled).toBeGreaterThan(flick.x);
  });
});
