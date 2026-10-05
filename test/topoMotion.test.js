import { describe, it, expect } from "vitest";
import { easeToward, SETTLE_POS, SETTLE_STRENGTH, FOLLOW_RADIUS2, FOLLOW_STRENGTH, DEPTH_RATE, TOPO_INK } from "../src/workspaces/dashboard/lib/topoMotion.js";

// NEW-2 (owner ask, 2026-09-17: "the background topo should have some lag to it"). easeToward is
// the pure spring/lerp step behind DashboardTopoBackground.jsx's cursor-follow highlight — see
// that module's own header for what drives the picture (cursor only; there is no scroll driver)
// and topoMotion.js's header for the follow/settle/depth naming this closes out.
describe("easeToward — the pure lerp step behind the topo background's SETTLE dial", () => {
  it("moves partway from current toward target by exactly `rate`", () => {
    expect(easeToward(0, 100, 0.25)).toBe(25);
    expect(easeToward(10, 10, 0.5)).toBe(10); // already at target — no-op
  });

  it("rate=1 is an instant snap to the target (the pre-existing 'pointer just entered' case uses a direct assignment instead, never this)", () => {
    expect(easeToward(0, 50, 1)).toBe(50);
  });

  it("never overshoots — repeated application converges monotonically toward the target from either side", () => {
    let v = 0;
    const target = 100;
    let prev = v;
    for (let i = 0; i < 6000; i++) {
      v = easeToward(v, target, SETTLE_POS);
      expect(v).toBeGreaterThanOrEqual(prev); // monotonic, no oscillation
      expect(v).toBeLessThanOrEqual(target);  // never overshoots a fixed target
      prev = v;
    }
    expect(v).toBeCloseTo(target, 1);
  });

  it("converges from above the target too (a lerp is symmetric, not just approach-from-below)", () => {
    // ptr.s (the intensity this rate drives) ranges roughly 0..1 in the real component — start
    // there rather than at an unrealistic magnitude.
    let v = 1;
    for (let i = 0; i < 6000; i++) v = easeToward(v, 0, SETTLE_STRENGTH);
    expect(v).toBeCloseTo(0, 2);
  });
});

describe("SETTLE is genuine lag, not lockstep tracking", () => {
  it("SETTLE_POS/SETTLE_STRENGTH are strictly between 0 and 1 — 0 would never move, 1 would be an instant snap (lockstep, the pre-fix behavior this item removes)", () => {
    for (const rate of [SETTLE_POS, SETTLE_STRENGTH]) {
      expect(rate).toBeGreaterThan(0);
      expect(rate).toBeLessThan(1);
    }
  });

  it("a sudden jump in the target is still mostly uncaught one frame later — this is the visible 'trails behind' effect", () => {
    const afterOneFrame = easeToward(0, 100, SETTLE_POS);
    expect(afterOneFrame).toBeLessThan(10);
  });

  it("SETTLE is the owner-tuned value (TOPO-TUNE-2026-10-05) — deliberately extreme, never clamped", () => {
    expect(SETTLE_POS).toBe(0.0019);
    expect(SETTLE_STRENGTH).toBe(0.0013);
  });

  it("at 60fps the highlight closes ~90% of the gap in about 20 seconds", () => {
    let v = 0, frames = 0;
    while (v < 90 && frames < 100000) { v = easeToward(v, 100, SETTLE_POS); frames++; }
    expect(frames / 60).toBeGreaterThan(17);
    expect(frames / 60).toBeLessThan(23);
  });

  it("the highlight gates still turn on and fully off at the slow intensity rate", () => {
    let s = 0, f = 0;
    while (s <= 0.01 && f < 1e5) { s = easeToward(s, 1, SETTLE_STRENGTH); f++; }
    expect(f).toBeLessThan(60 * 5); // appears within seconds of entering
    let g = 1, h = 0;
    while (g > 0.01 && h < 1e6) { g = easeToward(g, 0, SETTLE_STRENGTH); h++; }
    expect(h).toBeLessThan(60 * 90); // fully gone, not stuck on
  });
});

describe("FOLLOW unchanged; DEPTH owner-tuned", () => {
  it("FOLLOW_RADIUS2 / FOLLOW_STRENGTH match the values DashboardTopoBackground.jsx used to inline (d2 < 9, S * 1.6)", () => {
    expect(FOLLOW_RADIUS2).toBe(9);
    expect(FOLLOW_STRENGTH).toBe(1.6);
  });

  it("DEPTH_RATE is the owner-tuned slow drift", () => {
    expect(DEPTH_RATE).toBe(0.0000031);
  });

  it("TOPO_INK holds the owner's day/night line set", () => {
    expect(TOPO_INK.light).toMatchObject({ minor: "#8394AA", index: "#3B4B63", alpha: 0.5, minorWidth: 0.9, indexWidth: 1.5 });
    expect(TOPO_INK.dark).toMatchObject({ minor: "#5F6E86", index: "#B7C4DA", alpha: 0.55, minorWidth: 0.9, indexWidth: 1.5 });
  });
});
