/* B2448816 / B2448817 — the crop tool's drawing stays inside its box, and the pre-placement crop opens in the full-size window.
 *
 * The browser half (a real zoom, real presses, the boxes of every piece of chrome on all three surfaces, wide + narrow) is
 * ui-audit/verify-crop-contained.mjs. This is the CI-runnable half: the pure geometry (lib/cropChrome.js) and source guards for the
 * two decisions that must not silently come back — an UNCLIPPED chrome layer, and the small inline pre-placement box. */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { visibleRect, gripBox, dotCenter, clipSegment } from "../src/shared/sitePlans/lib/cropChrome.js";

const W = 800, H = 600;

describe("visibleRect — the outline is cut to the drawing area", () => {
  it("a rect wholly inside is unchanged and all four sides show", () => {
    expect(visibleRect(100, 80, 300, 200, W, H)).toEqual({ x: 100, y: 80, w: 300, h: 200, left: true, right: true, top: true, bottom: true });
  });
  it("zoomed in on a near-full-sheet crop (the owner's case) it is exactly the drawing area and NO side shows", () => {
    const r = visibleRect(-5277, -8244, 10500, 14800, W, H);
    expect(r).toEqual({ x: 0, y: 0, w: W, h: H, left: false, right: false, top: false, bottom: false });
  });
  it("one edge on screen shows only that side", () => {
    const r = visibleRect(-4000, 120, 9000, 9000, W, H);
    expect(r.top).toBe(true); expect(r.left).toBe(false); expect(r.right).toBe(false); expect(r.bottom).toBe(false);
    expect(r.y).toBe(120); expect(r.x).toBe(0); expect(r.w).toBe(W);
  });
  it("entirely off screen is null", () => {
    expect(visibleRect(900, 0, 200, 200, W, H)).toBeNull();
    expect(visibleRect(-300, 10, 200, 50, W, H)).toBeNull();
  });
  it("never reaches past the area for any input", () => {
    for (const [x, y, w, h] of [[-9e3, -9e3, 2e4, 2e4], [790, 590, 50, 50], [-10, -10, 30, 30], [0, 0, W, H]]) {
      const r = visibleRect(x, y, w, h, W, H);
      if (!r) continue;
      expect(r.x).toBeGreaterThanOrEqual(0); expect(r.y).toBeGreaterThanOrEqual(0);
      expect(r.x + r.w).toBeLessThanOrEqual(W); expect(r.y + r.h).toBeLessThanOrEqual(H);
    }
  });
});

describe("gripBox / dotCenter — a grip is shown only while its point is, and never half cut off", () => {
  it("off screen → no grip (no ghost grips)", () => {
    expect(gripBox(-1, 100, 12, 12, W, H)).toBeNull();
    expect(gripBox(100, H + 1, 12, 12, W, H)).toBeNull();
    expect(dotCenter(-3, 50, 6, W, H)).toBeNull();
  });
  it("well inside → centred on its point", () => {
    expect(gripBox(200, 150, 12, 12, W, H)).toEqual({ left: 194, top: 144 });
    expect(dotCenter(200, 150, 6, W, H)).toEqual({ x: 200, y: 150 });
  });
  it("on the very edge → slid inward so the whole grip is inside and fully grabbable", () => {
    expect(gripBox(0, 0, 12, 12, W, H)).toEqual({ left: 0, top: 0 });
    expect(gripBox(W, H, 12, 12, W, H)).toEqual({ left: W - 12, top: H - 12 });
    expect(gripBox(3, 300, 12, 12, W, H).left).toBe(0);
    expect(dotCenter(2, 300, 6, W, H)).toEqual({ x: 6, y: 300 });
    expect(dotCenter(W, H, 6, W, H)).toEqual({ x: W - 6, y: H - 6 });
  });
  it("every shown grip lies wholly inside the area", () => {
    for (let x = 0; x <= W; x += 37) for (let y = 0; y <= H; y += 41) {
      const g = gripBox(x, y, 24, 12, W, H);
      expect(g.left).toBeGreaterThanOrEqual(0); expect(g.left + 24).toBeLessThanOrEqual(W);
      expect(g.top).toBeGreaterThanOrEqual(0); expect(g.top + 12).toBeLessThanOrEqual(H);
    }
  });
});

describe("clipSegment — a polygon edge's hit strip exists only where it is on screen", () => {
  it("inside is unchanged", () => { expect(clipSegment(10, 10, 200, 100, W, H)).toEqual({ x1: 10, y1: 10, x2: 200, y2: 100 }); });
  it("a long edge is cut at the area's border", () => {
    const s = clipSegment(-5000, 300, 5000, 300, W, H);
    expect(s).toEqual({ x1: 0, y1: 300, x2: W, y2: 300 });
  });
  it("a diagonal is cut where it enters and leaves", () => {
    const s = clipSegment(-100, -100, 900, 700, W, H);
    // y = -100 + 0.8 (x + 100): enters through the top edge at x = 25, leaves through the bottom edge at x = 775
    expect(s.x1).toBeCloseTo(25, 6); expect(s.y1).toBeCloseTo(0, 6); expect(s.x2).toBeCloseTo(775, 6); expect(s.y2).toBeCloseTo(600, 6);
  });
  it("wholly outside is null", () => {
    expect(clipSegment(-50, -50, -10, 900, W, H)).toBeNull();
    expect(clipSegment(0, -20, W, -5, W, H)).toBeNull();
  });
});

describe("source guards", () => {
  const tool = readFileSync(new URL("../src/shared/sitePlans/components/ImageCropTool.jsx", import.meta.url), "utf8");
  const section = readFileSync(new URL("../src/shared/sitePlans/components/SitePlansSection.jsx", import.meta.url), "utf8");
  it("the chrome layer is clipped — never `overflow: visible` again", () => {
    expect(tool).toMatch(/data-testid="crop-chrome"[^>]*overflow: "hidden"/);
    expect(tool).not.toMatch(/overflow: "visible"/);
  });
  it("the rectangle's outline and grips go through cropChrome (no raw screen-rect positioning)", () => {
    expect(tool).toMatch(/visibleRect\(rx, ry, rw, rh, VIEW_W, VIEW_H\)/);
    expect(tool).toMatch(/gripBox\(/);
    expect(tool).not.toMatch(/left: rx, top: ry, width: rw, height: rh/);
  });
  it("the pre-placement crop opens in the shared full-size CropModal with `fill`, not a small inline box", () => {
    expect(section).not.toMatch(/maxWidth=\{420\}/);
    expect(section).toMatch(/testId="site-plan-precrop-modal"/);
    const i = section.indexOf('testId="site-plan-precrop-modal"');
    expect(section.slice(i, i + 700)).toMatch(/<ImageCropTool\s+fill /);
  });
});
