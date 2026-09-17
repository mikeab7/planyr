import { describe, it, expect } from "vitest";
import { easeToward, SETTLE_POS, SETTLE_STRENGTH, FOLLOW_RADIUS2, FOLLOW_STRENGTH, DEPTH_RATE } from "../src/workspaces/dashboard/lib/topoMotion.js";

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
    for (let i = 0; i < 200; i++) {
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
    for (let i = 0; i < 200; i++) v = easeToward(v, 0, SETTLE_STRENGTH);
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
    // A 100-unit jump; after ONE frame at SETTLE_POS, well under half of it should have closed.
    const afterOneFrame = easeToward(0, 100, SETTLE_POS);
    expect(afterOneFrame).toBeLessThan(10);
  });

  it("SETTLE is meaningfully slower than the pre-item constants it replaced (0.11 position / 0.065 intensity) — the actual product change, not just a rename", () => {
    expect(SETTLE_POS).toBeLessThan(0.11);
    expect(SETTLE_STRENGTH).toBeLessThan(0.065);
  });
});

describe("FOLLOW / DEPTH — named, unchanged from their pre-item inline values", () => {
  it("FOLLOW_RADIUS2 / FOLLOW_STRENGTH match the values DashboardTopoBackground.jsx used to inline (d2 < 9, S * 1.6)", () => {
    expect(FOLLOW_RADIUS2).toBe(9);
    expect(FOLLOW_STRENGTH).toBe(1.6);
  });

  it("DEPTH_RATE matches the value DashboardTopoBackground.jsx used to inline (t += 0.0000625) — pure ambient drift, not touched by this item", () => {
    expect(DEPTH_RATE).toBe(0.0000625);
  });
});
