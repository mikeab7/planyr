import { describe, it, expect } from "vitest";
import {
  backingScale, backingPixels, CANVAS_PX_BUDGET,
  backdropDensity, BACKDROP_PX_BUDGET, visibleRegion, tileCovers,
} from "../src/workspaces/doc-review/lib/renderBudget.js";

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

  it("supersamples the detail window between the 2× floor and the 2.5× cap when it fits the budget", () => {
    // A small region at modest zoom: cssW*cssH well under budget, so use the floor/cap, not the budget.
    expect(backingScale(800, 600, 1, 2)).toBe(2);
    expect(backingScale(800, 600, 1, 1)).toBe(2);   // 1× monitor → still 2× (supersampled for cleaner AA)
    expect(backingScale(800, 600, 1, 3)).toBe(2.5); // 3× retina → a bit denser than the floor, capped at 2.5×
    expect(backingScale(800, 600, 1, 4)).toBe(2.5); // 4× → held at the 2.5× cap (bounds memory)
  });

  it("never returns a non-positive density (no degenerate zero-area canvas)", () => {
    expect(backingScale(E_W, E_H, 6, 2)).toBeGreaterThan(0);
    expect(backingScale(1, 1, 0.0001, 1)).toBeGreaterThan(0);
  });
});

describe("backdropDensity — the fixed whole-page floor (B415)", () => {
  it("uses device density on a small sheet and stays under the backdrop budget on a big one", () => {
    expect(backdropDensity(612, 792, 2)).toBe(2);   // letter: budget is generous → full device density (capped 2)
    expect(backdropDensity(612, 792, 1)).toBe(1);
    const d = backdropDensity(3456, 2592, 2);        // a very large sheet: budget lowers density below 2
    expect(d).toBeLessThan(2);
    expect(d).toBeGreaterThan(0.1);
  });

  it("keeps the whole-page backdrop within its (smaller) budget", () => {
    for (const [w, h] of [[612, 792], [E_W, E_H], [3456, 2592], [4896, 3168]]) {
      const d = backdropDensity(w, h, 2);
      expect(Math.floor(w * d) * Math.floor(h * d)).toBeLessThanOrEqual(BACKDROP_PX_BUDGET * 1.001);
    }
  });

  it("never collapses to a zero-area backdrop", () => {
    expect(backdropDensity(99999, 99999, 2)).toBeGreaterThan(0.05);
  });

  it("the 16 MP budget (B488) lifts the whole-page floor on a large sheet (was sub-1× at 8 MP)", () => {
    const d = backdropDensity(3456, 2592, 2); // 8 MP gave ~0.95× here; 16 MP gives ~1.34×, still in budget
    expect(d).toBeGreaterThan(1.2);
    expect(Math.floor(3456 * d) * Math.floor(2592 * d)).toBeLessThanOrEqual(BACKDROP_PX_BUDGET * 1.001);
  });
});

describe("visibleRegion — the page-rect the detail layer rasterises (B415)", () => {
  const PAGE = { w: E_W, h: E_H };

  it("returns ~the whole page at fit, with the visible rect inside the margined region", () => {
    // Fit-width-ish: scale so the page is fully on screen, origin at 0,0.
    const view = { scale: 0.5, tx: 0, ty: 0 };
    const r = visibleRegion(view, PAGE, 1400, 900, 0.25);
    expect(r).toBeTruthy();
    // visible rect clamps to the page; the margined region contains it and also clamps to the page.
    expect(r.rect.rx).toBeGreaterThanOrEqual(0);
    expect(r.rect.ry).toBeGreaterThanOrEqual(0);
    expect(r.rect.rx + r.rect.rw).toBeLessThanOrEqual(E_W + 1e-6);
    expect(r.rect.ry + r.rect.rh).toBeLessThanOrEqual(E_H + 1e-6);
    expect(r.rect.rx).toBeLessThanOrEqual(r.visible.rx);
    expect(r.rect.ry).toBeLessThanOrEqual(r.visible.ry);
    expect(r.rect.rx + r.rect.rw).toBeGreaterThanOrEqual(r.visible.rx + r.visible.rw);
  });

  it("returns a SMALL sub-rect when zoomed in (the whole point — budget spent on the window)", () => {
    // 300% zoom, viewport centred on the page → an interior window far smaller than the sheet.
    const view = { scale: 3, tx: -2972, ty: -1926 };
    const r = visibleRegion(view, PAGE, 1400, 900, 0.25);
    expect(r).toBeTruthy();
    expect(r.rect.rw).toBeLessThan(E_W);
    expect(r.rect.rh).toBeLessThan(E_H);
    // visible window ≈ viewport / scale
    expect(r.visible.rw).toBeCloseTo(1400 / 3, 1);
    expect(r.visible.rh).toBeCloseTo(900 / 3, 1);
  });

  it("returns null when the page is panned fully off-screen, or inputs are degenerate", () => {
    expect(visibleRegion({ scale: 1, tx: -99999, ty: 0 }, PAGE, 1400, 900)).toBe(null);
    expect(visibleRegion(null, PAGE, 1400, 900)).toBe(null);
    expect(visibleRegion({ scale: 1, tx: 0, ty: 0 }, PAGE, 0, 0)).toBe(null);
  });

  it("the wider default margin (0.40, B488) pre-renders a larger halo than an explicit 0.25 — still in budget", () => {
    const view = { scale: 3, tx: -2972, ty: -1926 }; // zoomed interior window, not clamped to a page edge
    const wide = visibleRegion(view, PAGE, 1400, 900);          // default 0.40
    const narrow = visibleRegion(view, PAGE, 1400, 900, 0.25);
    expect(wide.rect.rw).toBeGreaterThan(narrow.rect.rw);
    expect(wide.rect.rh).toBeGreaterThan(narrow.rect.rh);
    expect(backingPixels(wide.rect.rw, wide.rect.rh, view.scale, 2)).toBeLessThanOrEqual(CANVAS_PX_BUDGET);
  });
});

describe("the detail layer stays native-sharp where the whole page goes soft (B415 sharpness)", () => {
  it("renders the visible window at full device density even when the whole sheet can't", () => {
    // 300% on an E-size sheet, viewport centred: the OLD whole-page raster drops well below 1×…
    const wholePage = backingScale(E_W, E_H, 3, 2);
    expect(wholePage).toBeLessThan(1); // soft — the reported Bluebeam gap

    // …but the detail layer only rasterises the visible window, so the budget gives full 2×.
    const view = { scale: 3, tx: -2972, ty: -1926 };
    const reg = visibleRegion(view, { w: E_W, h: E_H }, 1400, 900, 0.25);
    const detail = backingScale(reg.rect.rw, reg.rect.rh, view.scale, 2);
    expect(detail).toBe(2); // native device density on screen → Bluebeam-class sharpness
  });
});

describe("tileCovers — when a settle needs no re-raster (B415)", () => {
  const visible = { rx: 100, ry: 100, rw: 200, rh: 150 };
  it("covers when the tile contains the visible rect at the same scale", () => {
    expect(tileCovers({ rx: 50, ry: 50, rw: 400, rh: 300, scale: 2 }, visible, 2)).toBe(true);
    expect(tileCovers({ rx: 100, ry: 100, rw: 200, rh: 150, scale: 2 }, visible, 2)).toBe(true); // exact fit
  });
  it("does NOT cover at a different scale (density would be wrong) or when the view moved past it", () => {
    expect(tileCovers({ rx: 50, ry: 50, rw: 400, rh: 300, scale: 1 }, visible, 2)).toBe(false); // zoom changed
    expect(tileCovers({ rx: 150, ry: 100, rw: 200, rh: 150, scale: 2 }, visible, 2)).toBe(false); // panned past left edge
    expect(tileCovers(null, visible, 2)).toBe(false);
  });
});
