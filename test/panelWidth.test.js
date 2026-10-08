import { describe, it, expect } from "vitest";
import { cssStepForDpr, snapPanelWidth, panelFlowWidth } from "../src/workspaces/site-planner/lib/panelWidth.js";
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
  it("NEW-2: the owner's ≈2.15× display HAS a notch (20 CSS px = 43 device px), read through Chrome's float32 DPR", () => {
    expect(cssStepForDpr(2.1500000953674316)).toBe(20);
    expect(cssStepForDpr(2.15)).toBe(20);
    expect(cssStepForDpr(2.25)).toBe(4);
    expect(cssStepForDpr(1.1)).toBe(10);
  });
  it("NEW-2: the RESERVED width is whole CSS px AND whole device px, never wider than the painted width", () => {
    for (const dpr of [1, 1.25, 1.5, 1.75, 2, 2.1500000953674316, 1.1, 2.25]) {
      const n = cssStepForDpr(dpr);
      for (let raw = 238.1; raw < 630; raw += 0.37) {
        const w = snapPanelWidth(raw, dpr), f = panelFlowWidth(w, dpr);
        expect(Number.isInteger(w)).toBe(true);
        expect(w).toBeGreaterThanOrEqual(240); expect(w).toBeLessThanOrEqual(620);
        expect(Number.isInteger(f)).toBe(true);
        expect(Math.abs(f * dpr - Math.round(f * dpr))).toBeLessThan(1e-3);
        expect(f).toBeLessThanOrEqual(w);
        expect(w - f).toBeLessThan(n);             // the overlap is less than one notch
      }
    }
  });
  it("the painted width follows the pointer to the whole CSS px (no notchy panel edge)", () => {
    let prev = snapPanelWidth(240, 2.15);
    for (let raw = 240; raw <= 620; raw += 0.5) { const w = snapPanelWidth(raw, 2.15); expect(w).toBeGreaterThanOrEqual(prev); expect(w - prev).toBeLessThanOrEqual(1); prev = w; }
  });
  it("canvasEdgeLeft keeps the fraction (the old Math.round(offsetLeft) did not)", () => {
    expect(canvasEdgeLeft(363.33, 0)).toBeCloseTo(363.33, 5);
    expect(canvasEdgeLeft(363.33, 10)).toBeCloseTo(353.33, 5);
    expect(canvasEdgeLeft(NaN, 5)).toBe(-5);
  });
  it("wiring: the resize handler snaps, and the pan comp no longer rounds the edge", () => {
    const src = readFileSync(new URL("../src/workspaces/site-planner/SitePlanner.jsx", import.meta.url), "utf8");
    expect(src).toMatch(/snapPanelWidth\(startW \+ \(ev\.clientX - startX\)/);
    expect(src).toMatch(/panelFlowWidth\(leftWidth/);           // NEW-2: the canvas edge moves in notches
    expect(src).toMatch(/marginRight: -leftOverlap/);
    expect(src).not.toMatch(/Math\.round\(el\.offsetLeft\)/);
  });
});
