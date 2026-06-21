import { describe, it, expect } from "vitest";
import { backingScale, backingPixels, CANVAS_PX_BUDGET } from "../src/workspaces/doc-review/lib/renderBudget.js";

// An E-size architectural sheet in PDF points (the exact case the bug was measured on).
const E_W = 2448, E_H = 1584;

describe("renderBudget — backing-store pixel budget (NEW-2)", () => {
  it("stays within the ~24 MP budget at every zoom, including the 600% max", () => {
    for (const scale of [0.5, 1, 2, 3, 4, 6]) {
      // dpr up to 3 simulates a Retina display — the budget must hold regardless.
      for (const dpr of [1, 2, 3]) {
        expect(backingPixels(E_W, E_H, scale, dpr)).toBeLessThanOrEqual(CANVAS_PX_BUDGET);
      }
    }
  });

  it("pegs the 600% E-size render at the budget instead of the old ~140 MP / ~533 MB blowup", () => {
    const px = backingPixels(E_W, E_H, 6, 2);
    // The pre-fix code floored density at 1×, allocating cssW*cssH = ~140 MP here.
    expect(px).toBeLessThanOrEqual(CANVAS_PX_BUDGET);
    expect(px).toBeGreaterThan(CANVAS_PX_BUDGET * 0.9); // and it still uses the budget, not a tiny canvas
    expect(backingScale(E_W, E_H, 6, 2)).toBeLessThan(1); // density drops below 1× — soft, not OOM
  });

  it("renders at full device density when the sheet comfortably fits the budget", () => {
    // A small region at modest zoom: cssW*cssH well under budget, so use the device dpr (≤2×).
    expect(backingScale(800, 600, 1, 2)).toBe(2);
    expect(backingScale(800, 600, 1, 1)).toBe(1);
    expect(backingScale(800, 600, 1, 3)).toBe(2); // device density is still capped at 2×
  });

  it("never returns a non-positive density (no degenerate zero-area canvas)", () => {
    expect(backingScale(E_W, E_H, 6, 2)).toBeGreaterThan(0);
    expect(backingScale(1, 1, 0.0001, 1)).toBeGreaterThan(0);
  });
});
