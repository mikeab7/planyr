import { describe, it, expect } from "vitest";
import { placeMenu } from "../src/shared/ui/anchoredMenuPlacement.js";

// Pure placement math for the portal AnchoredMenu (B734). The account dropdown regressed to the
// top-left corner because a display:none copy of its trigger (zero-sized rect) fed zeros into
// this math; the null-on-zero-rect guard is the load-bearing fix, so lock it here along with the
// three placement branches and the viewport clamp.

// A realistic anchor pill near the top-right of a 1200×800 viewport.
const rect = (left, top, width, height) => ({
  left, top, right: left + width, bottom: top + height, width, height,
});
const VIEW = { viewportW: 1200, viewportH: 800 };

describe("placeMenu (AnchoredMenu placement, B734)", () => {
  it("below-right: right-aligns the menu to the anchor and drops below it", () => {
    // pill at right edge: left 1000, width 150 → right 1150, bottom 30
    const p = placeMenu({
      anchorRect: rect(1000, 6, 150, 24),
      menuW: 236, menuH: 300, ...VIEW, placement: "below-right", gap: 8, margin: 8,
    });
    expect(p).toEqual({ left: 1150 - 236, top: 30 + 8 }); // { left: 914, top: 38 }
    // stays inside the right edge: left + menuW = 1150 ≤ 1200 - 8
    expect(p.left + 236).toBeLessThanOrEqual(1200 - 8);
  });

  it("below-left: left-aligns the menu to the anchor and drops below it", () => {
    const p = placeMenu({
      anchorRect: rect(40, 50, 120, 24),
      menuW: 200, menuH: 180, ...VIEW, placement: "below-left", gap: 8, margin: 8,
    });
    expect(p).toEqual({ left: 40, top: 74 + 8 }); // bottom = 74
  });

  it("default 'left': flyout sits to the LEFT of the anchor, aligned to its top", () => {
    const p = placeMenu({
      anchorRect: rect(500, 200, 40, 40),
      menuW: 230, menuH: 300, ...VIEW, gap: 10, margin: 8, // placement omitted → "left"
    });
    expect(p).toEqual({ left: 500 - 10 - 230, top: 200 }); // { left: 260, top: 200 }
  });

  it("clamps a menu that would spill off the right edge back inside the viewport", () => {
    // below-left off a far-right anchor would push left past the edge
    const p = placeMenu({
      anchorRect: rect(1120, 6, 60, 24),
      menuW: 236, menuH: 200, ...VIEW, placement: "below-left", gap: 8, margin: 8,
    });
    expect(p.left).toBe(1200 - 236 - 8); // clamped to viewportW - menuW - margin = 956
  });

  it("clamps a menu that would spill off the bottom edge", () => {
    const p = placeMenu({
      anchorRect: rect(100, 790, 120, 24),
      menuW: 200, menuH: 300, ...VIEW, placement: "below-left", gap: 8, margin: 8,
    });
    expect(p.top).toBe(800 - 300 - 8); // clamped to viewportH - menuH - margin = 492
  });

  it("clamps a negative left up to the margin (never off the left edge)", () => {
    // 'left' flyout off an anchor near x=0 would compute a negative left
    const p = placeMenu({
      anchorRect: rect(20, 300, 30, 30),
      menuW: 230, menuH: 200, ...VIEW, gap: 10, margin: 8,
    });
    expect(p.left).toBe(8); // Math.max(margin, negative) = margin
  });

  it("returns null for a zero-sized anchor (display:none) — hide, do NOT pin top-left", () => {
    // This is the exact B734 failure input: a getBoundingClientRect() of all zeros.
    const p = placeMenu({
      anchorRect: rect(0, 0, 0, 0),
      menuW: 236, menuH: 300, ...VIEW, placement: "below-right", gap: 8, margin: 8,
    });
    expect(p).toBeNull();
  });

  it("returns null when the anchor rect is missing", () => {
    expect(placeMenu({
      anchorRect: null, menuW: 236, menuH: 300, ...VIEW, placement: "below-right",
    })).toBeNull();
  });
});
