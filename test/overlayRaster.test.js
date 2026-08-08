import { describe, it, expect } from "vitest";
import {
  baseRasterScale, chooseOverlayRasterScale, knockoutNearWhite,
  MAX_RERASTER_DIM,
} from "../src/workspaces/site-planner/lib/overlayPdf.js";

describe("baseRasterScale — B749 base raster cap 4500px", () => {
  it("fills 4500px on the long edge for a large sheet (36×24in ≈ 2592pt)", () => {
    expect(baseRasterScale(2592)).toBeCloseTo(4500 / 2592, 6);
    expect(2592 * baseRasterScale(2592)).toBeCloseTo(4500, 3);
  });
  it("lets a small sheet sharpen (scale cap 4×), never upsamples past that", () => {
    expect(baseRasterScale(500)).toBe(4); // 4500/500=9 → capped at 4
    expect(500 * baseRasterScale(500)).toBeLessThanOrEqual(4500);
  });
  it("never drops below 0.5×", () => {
    expect(baseRasterScale(1e6)).toBe(0.5);
  });
});

describe("chooseOverlayRasterScale — B749 zoom-aware re-raster decision", () => {
  const pageMaxPts = 2592;
  const baseScale = baseRasterScale(pageMaxPts); // ≈1.736
  const ftPerPx = 100 / 72; // a 1"=100' sheet, feet per point

  it("stays on the base raster at sheet-fit zoom (no needless re-raster)", () => {
    const ppf = baseScale / ftPerPx; // magnification ≈ 1
    const d = chooseOverlayRasterScale({ ftPerPx, ppf, pageMaxPts, baseScale });
    expect(d.isHires).toBe(false);
    expect(d.scale).toBeCloseTo(baseScale, 6);
  });

  it("upgrades to hi-res once magnification passes ~1.5×", () => {
    const ppf = (baseScale / ftPerPx) * 2; // 2× the base magnification
    const d = chooseOverlayRasterScale({ ftPerPx, ppf, pageMaxPts, baseScale });
    expect(d.isHires).toBe(true);
    expect(d.scale).toBeGreaterThan(baseScale);
  });

  it("never renders past the 8192px texture cap", () => {
    const ppf = 1000; // absurd zoom
    const d = chooseOverlayRasterScale({ ftPerPx, ppf, pageMaxPts, baseScale });
    expect(d.isHires).toBe(true);
    expect(d.capped).toBe(true);
    expect(d.scale * pageMaxPts).toBeLessThanOrEqual(MAX_RERASTER_DIM + 1e-6);
  });

  /* NEW-1 — the chosen scale is QUANTISED UP to an octave rung, so it is no longer the continuous
   * `want`. Here `want` is 7 and the next rung above the 4× base is 8, which is under the 8.19 cap:
   * a slightly FINER raster than the old rule picked, and — the property that matters — never a
   * coarser one. The reason is the measured cost of the continuous rule: every ×1.12 wheel notch
   * asked for a slightly different scale and re-rendered the whole page, up to 8192 px, on the main
   * thread. See the header of `chooseOverlayRasterScale` and test/overlayRerasterCount.test.js. */
  it("a small page reaches a hi-res RUNG without capping, and never coarser than `want`", () => {
    const pmp = 1000, bs = baseRasterScale(pmp); // 4
    const fpp = 1.0, ppf = 7; // want=7, magAtBase=1.75 → hires, cap=8192/1000=8.19
    const d = chooseOverlayRasterScale({ ftPerPx: fpp, ppf, pageMaxPts: pmp, baseScale: bs });
    expect(d.isHires).toBe(true);
    expect(d.capped).toBe(false);
    expect(d.scale).toBeCloseTo(8, 6);            // the rung: 4 × 2
    expect(d.scale).toBeGreaterThanOrEqual(7);    // never coarser than the continuous rule
  });
});

describe("knockoutNearWhite — the pure band-processed pass (B654/B749)", () => {
  it("turns near-white transparent and leaves ink opaque", () => {
    const d = new Uint8ClampedArray([250, 250, 250, 255, /* ink */ 20, 30, 40, 255]);
    knockoutNearWhite(d);
    expect(d[3]).toBe(0);   // near-white → transparent
    expect(d[7]).toBe(255); // ink untouched
  });
});
