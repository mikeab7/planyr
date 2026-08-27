import { describe, it, expect } from "vitest";
import { worstWindow } from "../src/shared/telemetry/perfTrigger.js";

/* NEW-2 (this session) — the perf-capture button reported the wrong window when pressed after the
 * lag ends. `worstWindow` is the fix: a post-hoc scan over the FULL retained frame history for the
 * worst-mean sub-window, so a manual capture taken after recovery still carries the evidence. */

describe("worstWindow — the maximum-mean sub-window over retained frame history", () => {
  it("returns null with no frames, or a non-positive span", () => {
    expect(worstWindow([], [], { spanMs: 2000 })).toBe(null);
    expect(worstWindow([0, 100], [16, 16], { spanMs: 0 })).toBe(null);
    expect(worstWindow([0, 100], [16, 16], { spanMs: -5 })).toBe(null);
  });

  it("finds the single obviously-worse window among several fast ones", () => {
    // Three regions: fast(16ms) · slow(200ms, 30 frames — long enough that a 2000ms window can
    // sit entirely inside it, away from the fast/slow boundary) · fast(16ms) again.
    const times = [], deltas = [];
    let t = 0;
    for (let i = 0; i < 100; i++) { t += 16; times.push(t); deltas.push(16); }
    const slowStart = t;
    for (let i = 0; i < 30; i++) { t += 200; times.push(t); deltas.push(200); }
    for (let i = 0; i < 100; i++) { t += 16; times.push(t); deltas.push(16); }
    const worst = worstWindow(times, deltas, { spanMs: 2000, minFrames: 8 });
    expect(worst).not.toBe(null);
    expect(worst.meanMs).toBeCloseTo(200, 0);
    expect(worst.atMs).toBeGreaterThanOrEqual(slowStart);
  });

  it("returns null when no window can ever reach minFrames", () => {
    const times = [0, 16, 32, 48, 949, 965];
    const deltas = [16, 16, 16, 16, 901, 16];  // one enormous single frame at index 4
    const worst = worstWindow(times, deltas, { spanMs: 2000, minFrames: 8 });
    expect(worst).toBe(null); // only 6 frames total — no window here can ever reach 8
  });

  it("the winning window always respects minFrames, even with a single huge spike nearby", () => {
    // A single 900ms frame alone would have the highest MEAN of any one-frame window, but a
    // window under minFrames must never win — the same GC-immunity property the live trigger has.
    // 20 fast frames, one spike, 20 more fast frames: a window has to straddle enough frames to
    // reach minFrames=8, so the returned window can never be "just the spike".
    const times = [], deltas = [];
    let t = 0;
    for (let i = 0; i < 20; i++) { t += 16; times.push(t); deltas.push(16); }
    t += 900; times.push(t); deltas.push(900);
    for (let i = 0; i < 20; i++) { t += 16; times.push(t); deltas.push(16); }
    const worst = worstWindow(times, deltas, { spanMs: 200, minFrames: 8 });
    expect(worst).not.toBe(null);
    expect(worst.frames).toBeGreaterThanOrEqual(8);
  });

  it("computes slowFraction against the supplied slowBar, omitting it when slowBar is not given", () => {
    const times = [0, 100, 200, 300, 400];
    const deltas = [10, 60, 10, 60, 10];
    // minFrames pinned to the whole series so the winning window is deterministic (the whole
    // array) rather than whichever smaller sub-window happens to have the highest mean.
    const withBar = worstWindow(times, deltas, { spanMs: 10_000, minFrames: 5, slowBar: 50 });
    expect(withBar.frames).toBe(5);
    expect(withBar.slowFraction).toBeCloseTo(2 / 5, 5);
    const withoutBar = worstWindow(times, deltas, { spanMs: 10_000, minFrames: 5 });
    expect(withoutBar.slowFraction).toBe(null);
  });

  /* ⛔ THE EXACT REPORTED CASE — B802400 round 4's own numbers, reproduced. An AUTO capture fired
   * reporting windowMeanMs 288.6 / slowFraction 0.67 over its own sustain window; 0.6s later,
   * after the tab caught up, the SAME frame history (plus a handful of fast trailing frames) was
   * read by a MANUAL capture that used only the LIVE (freshly reset) window and reported 16.1ms —
   * the evidence was gone. worstWindow(), scanning the SAME retained history a manual capture
   * would see, must recover the bad window instead. */
  it("RED→GREEN: recovers the owner's lost evidence — a manual capture 0.6s after recovery still finds the bad window", () => {
    const times = [], deltas = [];
    let t = 0;
    // ~2s of frames at the reported 288.6ms mean / 0.67 slow fraction (slowBar chosen at 2x a
    // 16.7ms baseline = 33.4ms, matching the trigger's own MULTIPLIER).
    const SLOW_BAR = 33.4;
    for (let i = 0; i < 10; i++) {
      const dt = i % 3 === 0 ? 20 : 380; // roughly 2/3 of frames well over slowBar, mean ~260
      t += dt; times.push(t); deltas.push(dt);
    }
    const worstEndsBy = t;
    // The trigger fires here and resets its OWN live window — worstWindow doesn't know or care;
    // it just keeps scanning the same retained history. 600ms of recovered, fast frames follow.
    for (let i = 0; i < 36; i++) { t += 16.7; times.push(t); deltas.push(16.7); } // ~0.6s of 60fps
    const worst = worstWindow(times, deltas, { spanMs: 2000, minFrames: 8, slowBar: SLOW_BAR });
    expect(worst).not.toBe(null);
    expect(worst.meanMs).toBeGreaterThan(SLOW_BAR); // the bad window, not the recovered tail
    expect(worst.atMs).toBeLessThanOrEqual(worstEndsBy + 1); // anchored to when the lag actually was
    // A LIVE-window-only reading (what the old manual path used) over the SAME final state would
    // instead land on the recovered tail — this is the exact defect: the live mean of the last
    // ~2000ms of history (the recovered fast frames) is nowhere near the bad window's mean.
    const tailStart = t - 2000;
    let tailSum = 0, tailN = 0;
    for (let i = 0; i < times.length; i++) if (times[i] >= tailStart) { tailSum += deltas[i]; tailN++; }
    const liveMean = tailSum / tailN;
    expect(liveMean).toBeLessThan(worst.meanMs);
  });
});
