// NEW-1 (B2016112) — free pinch zoom on the browse maps.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { FREE_ZOOM_OPTIONS, isPinchWheel, pinchLevels, notchLevels } from "../src/shared/map/freePinchZoom.js";

const src = (p) => readFileSync(new URL(`../src/workspaces/${p}`, import.meta.url), "utf8");

describe("freePinchZoom — pure rules", () => {
  it("options: gestures unsnapped, +/- and double-click stay one full level", () => {
    expect(FREE_ZOOM_OPTIONS.zoomSnap).toBe(0);
    expect(FREE_ZOOM_OPTIONS.zoomDelta).toBe(1);
  });
  it("a small ctrl+wheel is a trackpad pinch; a mouse notch (even with ctrl) is not", () => {
    expect(isPinchWheel({ ctrlKey: true, deltaMode: 0, deltaY: -3.5 })).toBe(true);
    expect(isPinchWheel({ ctrlKey: true, deltaMode: 0, deltaY: -100 })).toBe(false);
    expect(isPinchWheel({ ctrlKey: false, deltaMode: 0, deltaY: -3.5 })).toBe(false);
    expect(isPinchWheel({ ctrlKey: true, deltaMode: 1, deltaY: -3 })).toBe(false);
  });
  it("pinch is continuous and signed (spread = zoom in)", () => {
    expect(pinchLevels({ deltaY: -10 })).toBeCloseTo(0.1);
    expect(pinchLevels({ deltaY: 4 })).toBeCloseTo(-0.04);
  });
  it("one mouse notch is exactly one whole level, either direction", () => {
    for (const px of [1, 10, 60, 100, 120]) {
      expect(notchLevels(px)).toBe(1);
      expect(notchLevels(-px)).toBe(-1);
    }
    expect(notchLevels(0)).toBe(0);
  });
});

describe("freePinchZoom — wiring on the three browse maps", () => {
  const files = ["site-planner/MapFinder.jsx", "dashboard/components/LocationsMapCard.jsx", "food/components/FoodMap.jsx"];
  for (const f of files) {
    it(`${f} creates its map with FREE_ZOOM_OPTIONS and attaches the wheel handler`, () => {
      const s = src(f);
      expect(s).toMatch(/\.\.\.FREE_ZOOM_OPTIONS/);
      expect(s).toMatch(/attachFreeWheelZoom\(L, map\)/);
      expect(s).toMatch(/detachFreeWheel\(\)/);
    });
  }
  it("the site-plan backdrop map is left alone (already zoomSnap 0, own gesture code)", () => {
    expect(src("site-planner/SitePlanner.jsx")).not.toMatch(/FREE_ZOOM_OPTIONS/);
  });
});
