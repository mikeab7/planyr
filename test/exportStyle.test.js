import { describe, it, expect } from "vitest";
import { printStrokeWidth, sheetFitScale, PT_PER_CENTI_INCH, PRINT_WEIGHTS } from "../src/workspaces/site-planner/lib/exportStyle.js";

// The printed point-weight a thinned stroke ends up at, given the sheet-fit scale.
const printedPt = (sw, sheetScale) => printStrokeWidth(sw, sheetScale) * sheetScale * PT_PER_CENTI_INCH;

describe("printStrokeWidth — retarget strokes to a physical print weight (NEW-2)", () => {
  it("an object line (authored weight 2) prints at the object point weight regardless of zoom", () => {
    for (const s of [0.3, 0.6, 1, 1.4, 2.2]) {
      expect(printedPt(PRINT_WEIGHTS.refSw, s)).toBeCloseTo(PRINT_WEIGHTS.objectPt, 6);
    }
  });

  it("is zoom-independent: same printed weight at very different sheet scales", () => {
    const a = printedPt(2, 0.4);
    const b = printedPt(2, 1.8);
    expect(a).toBeCloseTo(b, 6);
  });

  it("preserves the hierarchy — a heavier authored stroke prints heavier", () => {
    const s = 1.0;
    expect(printedPt(2, s)).toBeGreaterThan(printedPt(1.25, s));
    expect(printedPt(1.25, s)).toBeGreaterThanOrEqual(printedPt(0.75, s));
  });

  it("floors the thinnest striping so it never disappears (>= minPt)", () => {
    const s = 1.0;
    expect(printedPt(0.5, s)).toBeGreaterThanOrEqual(PRINT_WEIGHTS.minPt - 1e-6);
    expect(printedPt(0.5, s)).toBeCloseTo(PRINT_WEIGHTS.minPt, 6); // 0.5 maps below floor → clamped
  });

  it("caps a stray heavy stroke at maxPt", () => {
    const s = 1.0;
    expect(printedPt(20, s)).toBeCloseTo(PRINT_WEIGHTS.maxPt, 6);
  });

  it("brings a typical heavy clone down (2 px @ scale 1 thins below the authored width)", () => {
    // scale 1 ci/unit: printed object weight 0.6pt → width 0.6/0.72 ≈ 0.83 unit, < 2.
    expect(printStrokeWidth(2, 1)).toBeLessThan(2);
    expect(printStrokeWidth(2, 1)).toBeCloseTo(0.6 / 0.72, 5);
  });

  it("returns the input unchanged for non-positive inputs (defensive)", () => {
    expect(printStrokeWidth(0, 1)).toBe(0);
    expect(printStrokeWidth(2, 0)).toBe(2);
    expect(printStrokeWidth(NaN, 1)).toBeNaN();
  });
});

describe("sheetFitScale — centi-inches of paper per viewBox unit (preserveAspectRatio meet)", () => {
  it("uses the limiting dimension (min of the two axis scales)", () => {
    expect(sheetFitScale(1000, 800, 700, 646)).toBeCloseTo(Math.min(700 / 1000, 646 / 800), 6);
  });

  it("a viewBox matching the plan-box aspect scales uniformly", () => {
    // 1000x800 (aspect 1.25) into 750x600 (aspect 1.25) → 0.75 either way.
    expect(sheetFitScale(1000, 800, 750, 600)).toBeCloseTo(0.75, 6);
  });
});
