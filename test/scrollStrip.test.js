// NAV-ARROWS — the shared chevron-strip model: absolute, clamped, edge-flush paging.
import { describe, it, expect } from "vitest";
import { pageTarget, edgeState } from "../src/shared/ui/scrollStrip.js";

const strip = (scrollLeft, clientWidth = 390, scrollWidth = 459) => ({ scrollLeft, clientWidth, scrollWidth });

describe("pageTarget", () => {
  it("clamps at both ends — never below 0, never past max", () => {
    for (const sl of [0, 10, 40, 69]) {
      expect(pageTarget({ ...strip(sl), dir: -1 })).toBe(0);
      expect(pageTarget({ ...strip(sl), dir: 1 })).toBe(69);
    }
  });
  it("snaps flush to the edge instead of leaving a sliver", () => {
    expect(pageTarget({ ...strip(100, 390, 1500), dir: -1 })).toBeGreaterThanOrEqual(0);
    expect(pageTarget({ scrollLeft: 1000, clientWidth: 390, scrollWidth: 1500, dir: 1 })).toBe(1110);
    expect(pageTarget({ scrollLeft: 300, clientWidth: 390, scrollWidth: 1500, dir: -1 })).toBe(0);
  });
  it("a mid-strip page moves about a screenful minus a tab", () => {
    expect(pageTarget({ scrollLeft: 500, clientWidth: 390, scrollWidth: 2000, dir: 1 })).toBe(818);
    expect(pageTarget({ scrollLeft: 800, clientWidth: 390, scrollWidth: 2000, dir: -1 })).toBe(482);
  });
  it("a strip that does not overflow stays at 0", () => {
    expect(pageTarget({ scrollLeft: 0, clientWidth: 390, scrollWidth: 390, dir: 1 })).toBe(0);
  });
});

describe("edgeState", () => {
  it("hidden exactly at each end, both shown between", () => {
    expect(edgeState(strip(0))).toEqual({ left: false, right: true });
    expect(edgeState(strip(69))).toEqual({ left: true, right: false });
    expect(edgeState(strip(30))).toEqual({ left: true, right: true });
  });
  it("iOS rubber-band (scrollLeft < 0 or > max) reads as the end, not past it", () => {
    expect(edgeState(strip(-40))).toEqual({ left: false, right: true });
    expect(edgeState(strip(120))).toEqual({ left: true, right: false });
  });
});
