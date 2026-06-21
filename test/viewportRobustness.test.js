/* STRESS TEST (different angle) — numeric robustness of the shared viewport
 * transform that feeds the markup tool its coordinates.
 *
 * Angle 1 fuzzed the takeoff GEOMETRY and stormed the UI. This fuzzes the layer
 * UPSTREAM of both: the pan/zoom math (viewportTransform.js) that turns a screen
 * click into the page-unit point a markup actually stores. The failure mode here is
 * insidious — if the view ever goes non-finite (a 0/0 pinch ratio from two fingers
 * on the same pixel, a NaN box from a half-measured sheet), every screenToWorld
 * coordinate becomes NaN, the markup stores NaN points, and JSON.stringify silently
 * rewrites them to `null` on save: the developer's measured area is gone, no error.
 *
 * Invariant under test: NO adversarial input may make these functions EMIT a
 * non-finite view or coordinate. (The live hosts already guard the divisor, so this
 * is defense-in-depth at the shared primitive both canvases share.) */
import { describe, it, expect } from "vitest";
import {
  clampNum, worldToScreen, screenToWorld, zoomAround, panBy, fitView,
  pinchZoom, midpoint, distance,
} from "../src/shared/viewport/viewportTransform.js";

const fin = (n) => Number.isFinite(n);
const finiteView = (v) => v && fin(v.scale) && fin(v.tx) && fin(v.ty) && v.scale > 0;
const MIN = 0.02, MAX = 8;

function makeRng(seed) {
  let s = seed >>> 0;
  return () => { s = (Math.imul(s, 1103515245) + 12345) & 0x7fffffff; return s / 0x7fffffff; };
}
// A grab-bag of nasty scalars a real gesture/layout can throw at the math.
const NASTY = [NaN, Infinity, -Infinity, 0, -0, 1e-12, 1e12, -1, 1e300, -1e300];

describe("clampNum is finite-safe (the single chokepoint for scale)", () => {
  it("NaN clamps to the low bound; ±Infinity clamp to the bounds", () => {
    expect(clampNum(NaN, MIN, MAX)).toBe(MIN);
    expect(clampNum(Infinity, MIN, MAX)).toBe(MAX);
    expect(clampNum(-Infinity, MIN, MAX)).toBe(MIN);
    expect(clampNum(5, MIN, MAX)).toBe(5);
    expect(clampNum("3", MIN, MAX)).toBe(3);   // coerces a stray string
  });
  it("never returns a non-finite number for any nasty input", () => {
    for (const n of NASTY) expect(fin(clampNum(n, MIN, MAX))).toBe(true);
  });
});

describe("zoom / pinch / fit never EMIT a non-finite view", () => {
  it("zoomAround survives every nasty factor and anchor", () => {
    const v = { scale: 1, tx: 30, ty: -40 };
    for (const f of NASTY) for (const a of NASTY) {
      const nv = zoomAround(v, f, a, a, MIN, MAX);
      expect(finiteView(nv), `factor=${f} anchor=${a}`).toBe(true);
      expect(nv.scale).toBeGreaterThanOrEqual(MIN);
      expect(nv.scale).toBeLessThanOrEqual(MAX);
    }
  });

  it("pinchZoom survives a degenerate two-finger gesture (0/0 ratio)", () => {
    const v = { scale: 1, tx: 0, ty: 0 };
    // Two fingers on the SAME pixel two frames running → distance 0 both frames →
    // factor = 0/0 = NaN. This is the exact corruption path.
    const factor = distance({ x: 5, y: 5 }, { x: 5, y: 5 }) / distance({ x: 5, y: 5 }, { x: 5, y: 5 });
    expect(Number.isNaN(factor)).toBe(true);
    const nv = pinchZoom(v, { x: 5, y: 5 }, { x: 5, y: 5 }, factor, MIN, MAX);
    expect(finiteView(nv)).toBe(true);
  });

  it("pinchZoom + fitView stay finite across a fuzz of nasty inputs", () => {
    const rand = makeRng(0xBADF00D);
    for (let i = 0; i < 20000; i++) {
      const v = { scale: MIN + rand() * MAX, tx: (rand() - 0.5) * 1e4, ty: (rand() - 0.5) * 1e4 };
      const pm = { x: (rand() - 0.5) * 2000, y: (rand() - 0.5) * 2000 };
      const cm = { x: (rand() - 0.5) * 2000, y: (rand() - 0.5) * 2000 };
      const factor = NASTY[Math.floor(rand() * NASTY.length)];
      expect(finiteView(pinchZoom(v, pm, cm, factor, MIN, MAX)), `pinch factor=${factor}`).toBe(true);

      const box = [NASTY[Math.floor(rand() * NASTY.length)], rand() * 5000, 0, rand() * 2000][Math.floor(rand() * 4)];
      const fv = fitView(box, rand() * 5000, rand() * 2000, rand() * 2000, { min: MIN, max: MAX });
      expect(finiteView(fv), `fit box=${box}`).toBe(true);
    }
  });

  it("fitView handles explicitly degenerate boxes/viewports", () => {
    for (const [bw, bh, vw, vh] of [[0, 0, 800, 600], [NaN, 100, 800, 600], [1e12, 1e12, 800, 600], [100, 100, 0, 0], [Infinity, Infinity, NaN, NaN]]) {
      expect(finiteView(fitView(bw, bh, vw, vh)), `box ${bw}x${bh} vp ${vw}x${vh}`).toBe(true);
    }
  });
});

describe("screen↔world stays finite and round-trips (no coordinate ever goes NaN)", () => {
  it("a finite view never produces a non-finite world point", () => {
    const rand = makeRng(7);
    for (let i = 0; i < 20000; i++) {
      const v = { scale: MIN + rand() * MAX, tx: (rand() - 0.5) * 1e4, ty: (rand() - 0.5) * 1e4 };
      const p = { x: (rand() - 0.5) * 1e5, y: (rand() - 0.5) * 1e5 };
      const w = screenToWorld(v, p);
      const s = worldToScreen(v, w);
      expect(fin(w.x) && fin(w.y)).toBe(true);
      expect(fin(s.x) && fin(s.y)).toBe(true);
      // round-trip recovers the original screen point.
      expect(s.x).toBeCloseTo(p.x, 3);
      expect(s.y).toBeCloseTo(p.y, 3);
    }
  });

  it("a degenerate scale-0 view yields a finite (not Infinity) world point", () => {
    const w = screenToWorld({ scale: 0, tx: 0, ty: 0 }, { x: 10, y: 10 });
    expect(fin(w.x) && fin(w.y)).toBe(true);
  });

  it("a chained gesture session never drifts a view non-finite", () => {
    // Simulate a long, messy session: alternating pinches, wheel-zooms and pans,
    // occasionally fed a nasty factor, and assert the view stays finite throughout —
    // i.e. one bad frame can't permanently poison the viewport for the rest of use.
    const rand = makeRng(2026);
    let v = { scale: 1, tx: 0, ty: 0 };
    for (let i = 0; i < 5000; i++) {
      const r = rand();
      if (r < 0.4) v = zoomAround(v, rand() < 0.1 ? NASTY[Math.floor(rand() * NASTY.length)] : 0.8 + rand(), rand() * 1200, rand() * 800, MIN, MAX);
      else if (r < 0.7) v = pinchZoom(v, { x: rand() * 1200, y: rand() * 800 }, { x: rand() * 1200, y: rand() * 800 }, rand() < 0.1 ? NaN : 0.5 + rand(), MIN, MAX);
      else v = panBy(v, (rand() - 0.5) * 400, (rand() - 0.5) * 400);
      expect(finiteView(v), `frame ${i}`).toBe(true);
    }
  });
});

describe("midpoint / distance helpers stay finite", () => {
  it("never emit NaN for finite points and report 0 for coincident points", () => {
    expect(distance({ x: 3, y: 3 }, { x: 3, y: 3 })).toBe(0);
    const rand = makeRng(11);
    for (let i = 0; i < 5000; i++) {
      const a = { x: (rand() - 0.5) * 1e4, y: (rand() - 0.5) * 1e4 };
      const b = { x: (rand() - 0.5) * 1e4, y: (rand() - 0.5) * 1e4 };
      expect(fin(distance(a, b))).toBe(true);
      const m = midpoint(a, b);
      expect(fin(m.x) && fin(m.y)).toBe(true);
    }
  });
});
