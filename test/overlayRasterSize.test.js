import { describe, it, expect } from "vitest";
import { effectiveRasterDpi, cappedRasterDims } from "../src/shared/sitePlans/lib/overlayRasterSize.js";

describe("overlayRasterSize — effectiveRasterDpi", () => {
  it("leaves a normal letter-size flyer page at the base DPI (the owner's real Airtex page, 8.5x11in)", () => {
    // 8.5in x 11in in points (72pt/in) — matches the real measurement (612 x 792 pt).
    const dpi = effectiveRasterDpi(612, 792, { baseDpi: 150, maxLongEdgePx: 4000 });
    expect(dpi).toBe(150);
  });

  it("caps a large civil sheet (24x36in ARCH D) down from the base DPI", () => {
    // 24in x 36in in points = 1728 x 2592 pt. At 150 dpi the long edge would be 36*150=5400px.
    const dpi = effectiveRasterDpi(1728, 2592, { baseDpi: 150, maxLongEdgePx: 4000 });
    expect(dpi).toBeLessThan(150);
    const longEdgePx = (2592 / 72) * dpi;
    expect(longEdgePx).toBeCloseTo(4000, 0);
  });

  it("never raises the DPI above the base, even for a tiny page", () => {
    const dpi = effectiveRasterDpi(100, 100, { baseDpi: 150, maxLongEdgePx: 4000 });
    expect(dpi).toBe(150);
  });

  it("falls back to the base DPI for a malformed/zero page size", () => {
    expect(effectiveRasterDpi(0, 0)).toBe(150);
    expect(effectiveRasterDpi(null, null)).toBe(150);
  });
});

describe("overlayRasterSize — cappedRasterDims", () => {
  it("leaves dimensions already under the cap unchanged", () => {
    expect(cappedRasterDims(1275, 1650, 4000)).toEqual({ w: 1275, h: 1650 });
  });

  it("scales a too-large image down proportionally", () => {
    const { w, h } = cappedRasterDims(3600, 5400, 4000);
    expect(h).toBe(4000);
    expect(w).toBe(Math.round(3600 * (4000 / 5400)));
    expect(w / h).toBeCloseTo(3600 / 5400, 3);
  });

  it("never scales up", () => {
    expect(cappedRasterDims(200, 100, 4000)).toEqual({ w: 200, h: 100 });
  });
});
