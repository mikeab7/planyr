import { describe, it, expect } from "vitest";
import {
  dashZoom,
  insetRingVisible,
  DASH_ZOOM_FLOOR_PX,
  DASH_ZOOM_CEIL,
  INSET_MIN_VISIBLE_PX,
} from "../src/workspaces/site-planner/lib/lineZoom.js";

// B880 — the dash-period + inset-visibility zoom helpers (B617 siblings for dashed feet-frame lines).

describe("dashZoom — scales the dash period with zoom, floored + capped", () => {
  it("is a no-op at site zoom (zk = 1) for a normal dash", () => {
    // "7 6" period 13; floorScale = 3/13 ≈ 0.23 < 1, ceil 3.5 > 1 → scale = 1 → unchanged
    expect(dashZoom("7 6", 1)).toBe("7 6");
  });

  it("shrinks the period on zoom-out but never below the sub-pixel floor", () => {
    // zk 0.5 is above the floorScale (3/13≈0.23) → scales by 0.5
    expect(dashZoom("7 6", 0.5)).toBe("3.5 3");
    // zk 0.05 is BELOW the floorScale → clamps to floorScale so period === DASH_ZOOM_FLOOR_PX
    const out = dashZoom("7 6", 0.05).split(" ").map(Number);
    const period = out[0] + out[1];
    expect(period).toBeCloseTo(DASH_ZOOM_FLOOR_PX, 5);
    // the floored period is the exact fix for "edges shorter than one dash cycle can't render"
  });

  it("grows the period on zoom-in but caps at DASH_ZOOM_CEIL", () => {
    expect(dashZoom("7 6", 2)).toBe("14 12");
    // zk 10 exceeds the ceiling → clamps to 3.5×
    expect(dashZoom("7 6", DASH_ZOOM_CEIL + 100)).toBe(`${7 * DASH_ZOOM_CEIL} ${6 * DASH_ZOOM_CEIL}`);
  });

  it("passes a solid line (null/undefined/empty) through unchanged — never emits 'undefined'", () => {
    expect(dashZoom(undefined, 0.2)).toBe(undefined);
    expect(dashZoom(null, 0.2)).toBe(null);
    expect(dashZoom("", 0.2)).toBe("");
  });

  it("passes an unparseable / negative spec through unchanged (never fabricates a pattern)", () => {
    expect(dashZoom("abc", 0.5)).toBe("abc");
    expect(dashZoom("7 -6", 0.5)).toBe("7 -6");
    expect(dashZoom("7 6", NaN)).toBe("7 6");
  });

  it("handles multi-segment and weight-derived dotted/dashed specs", () => {
    // a dashArray("dashed", 2) → "6 4.8"; period 10.8, zk 1 → unchanged
    expect(dashZoom("6 4.8", 1)).toBe("6 4.8");
    // three-segment spec scales each segment
    expect(dashZoom("4 2 1", 2)).toBe("8 4 2");
  });
});

describe("insetRingVisible — suppress the dashed inset ring when it merges into the boundary", () => {
  it("is visible when the smallest inset is >= the px floor", () => {
    // 25 ft setback at ppf 0.35 (site zoom) = 8.75 px >> floor → visible
    expect(insetRingVisible(25, 0.35)).toBe(true);
  });

  it("is suppressed when the on-screen inset drops below the floor (the reported garble zoom)", () => {
    // 25 ft at ppf 0.086 ≈ 2.15 px < 3 px floor → suppressed (fixes the double-line at the reported zoom)
    expect(insetRingVisible(25, 0.086)).toBe(false);
    // 25 ft at ppf 0.05 = 1.25 px → suppressed
    expect(insetRingVisible(25, 0.05)).toBe(false);
  });

  it("uses the px floor exactly at the boundary and honors a custom threshold", () => {
    expect(insetRingVisible(INSET_MIN_VISIBLE_PX, 1)).toBe(true); // 3 ft × 1 = 3 px === floor
    expect(insetRingVisible(2.9, 1)).toBe(false);
    expect(insetRingVisible(10, 0.35, 2)).toBe(true); // 3.5 px >= custom 2 px
  });

  it("reads non-positive / non-finite inputs as NOT visible (nothing to draw)", () => {
    expect(insetRingVisible(0, 0.35)).toBe(false);
    expect(insetRingVisible(-5, 0.35)).toBe(false);
    expect(insetRingVisible(25, 0)).toBe(false);
    expect(insetRingVisible(NaN, 0.35)).toBe(false);
  });
});
