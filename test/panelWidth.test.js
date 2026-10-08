import { describe, it, expect } from "vitest";
import { cssStepForDpr, snapPanelWidth } from "../src/workspaces/site-planner/lib/panelWidth.js";
import { canvasEdgeLeft } from "../src/workspaces/site-planner/lib/canvasBox.js";
import { readFileSync } from "node:fs";

describe("panelWidth (B2154768)", () => {
  it("steps: whole CSS px that are whole device px", () => {
    expect(cssStepForDpr(1)).toBe(1);
    expect(cssStepForDpr(2)).toBe(1);
    expect(cssStepForDpr(1.5)).toBe(2);
    expect(cssStepForDpr(1.25)).toBe(4);
    expect(cssStepForDpr(1.75)).toBe(4);
    expect(cssStepForDpr(undefined)).toBe(1);
    expect(cssStepForDpr(NaN)).toBe(1);
  });
  it("a fractional pointer never yields a fractional-device-pixel width", () => {
    for (const dpr of [1, 1.25, 1.5, 1.75, 2]) {
      for (let raw = 238.1; raw < 630; raw += 0.37) {
        const w = snapPanelWidth(raw, dpr);
        expect(Math.abs(w * dpr - Math.round(w * dpr))).toBeLessThan(1e-6);
        expect(w).toBeGreaterThanOrEqual(240);
        expect(w).toBeLessThanOrEqual(620);
      }
    }
  });
  it("is monotone and moves by one step at a time (no big jump)", () => {
    let prev = snapPanelWidth(240, 1.25);
    for (let raw = 240; raw <= 620; raw += 0.5) { const w = snapPanelWidth(raw, 1.25); expect(w).toBeGreaterThanOrEqual(prev); expect(w - prev).toBeLessThanOrEqual(4); prev = w; }
  });
  it("canvasEdgeLeft keeps the fraction (the old Math.round(offsetLeft) did not)", () => {
    expect(canvasEdgeLeft(363.33, 0)).toBeCloseTo(363.33, 5);
    expect(canvasEdgeLeft(363.33, 10)).toBeCloseTo(353.33, 5);
    expect(canvasEdgeLeft(NaN, 5)).toBe(-5);
  });
  it("wiring: the resize handler snaps, and the pan comp no longer rounds the edge", () => {
    const src = readFileSync(new URL("../src/workspaces/site-planner/SitePlanner.jsx", import.meta.url), "utf8");
    expect(src).toMatch(/snapPanelWidth\(startW \+ \(ev\.clientX - startX\)/);
    expect(src).not.toMatch(/Math\.round\(el\.offsetLeft\)/);
  });
});
