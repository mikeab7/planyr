/* 2026-09-23 hardening — the crop tool's pan/zoom viewport (NEW-2, ImageCropTool.jsx).
 *
 * The owner's report: "the size of it doesn't make a ton of sense, I can't zoom in to get the
 * little piece that I want." The fix drives ImageCropTool's own crop shapes (a rect draft, a
 * polygon's points) through the SAME shared { scale, tx, ty } viewport engine every canvas in
 * this app uses (src/shared/viewport/viewportTransform.js), while the crop shapes themselves stay
 * stored in IMAGE PIXELS and never read `view` at all.
 *
 * This file cannot mount the React component (no @testing-library/react in this repo — component
 * behavior here is proven by the ui-audit headless-browser harnesses instead). What IS provable
 * here, purely: that composing the exact sequence of viewport operations ImageCropTool's own
 * wheel/pan/Fit/100% handlers perform never moves a STORED image-space point — because the
 * component only ever re-projects a stored point through the CURRENT view at render time, it never
 * derives or rewrites a stored point from the view. Proven by literally driving `view` through a
 * realistic multi-gesture sequence while never touching the points, then confirming every stored
 * point still projects to the image position it always had (round-trip through the final view).
 */
import { describe, it, expect } from "vitest";
import { worldToScreen, screenToWorld, zoomAround, panBy, fitView } from "../src/shared/viewport/viewportTransform.js";
import { wheelZoomFactor } from "../src/shared/viewport/viewAnchor.js";

const K_MIN = 0.02, K_MAX = 16;
const IMG_W = 3400, IMG_H = 2200; // a realistic full-size scanned sheet
const VIEW_W = 900, VIEW_H = 620;

// A hand-traced polygon in IMAGE px — the thing that must never move relative to the picture.
const POLY = [[120, 90], [3100, 140], [2960, 2050], [900, 1980], [400, 1200]];

describe("crop viewport — pan/zoom never move a stored crop point relative to the image", () => {
  it("round-trips a single point through Fit -> zoom-in-on-pointer -> pan -> zoom-out", () => {
    let view = fitView(IMG_W, IMG_H, VIEW_W, VIEW_H, { pad: 0, min: K_MIN, max: 1, mode: "page" });
    const pt = [2960, 2050];

    // Where this point renders BEFORE any gesture.
    const before = worldToScreen(view, { x: pt[0], y: pt[1] });

    // Zoom in hard on an arbitrary pointer position (not the point itself — the general case).
    view = zoomAround(view, Math.pow(1.12, 8), 640, 210, K_MIN, K_MAX);
    // Pan around.
    view = panBy(view, -180, 240);
    view = panBy(view, 55, -90);
    // Zoom back out a bit, about a different pointer position.
    view = zoomAround(view, 1 / Math.pow(1.12, 3), 300, 500, K_MIN, K_MAX);

    // The STORED point is untouched (it was never derived from `view`) — projecting it through
    // the FINAL view and back to image space must still land on the exact original image pixel.
    const screenNow = worldToScreen(view, { x: pt[0], y: pt[1] });
    const backToImage = screenToWorld(view, screenNow);
    expect(backToImage.x).toBeCloseTo(pt[0], 6);
    expect(backToImage.y).toBeCloseTo(pt[1], 6);

    // And the screen position genuinely changed (the view really did move) — otherwise this test
    // would trivially pass even if pan/zoom were no-ops.
    expect(Math.hypot(screenNow.x - before.x, screenNow.y - before.y)).toBeGreaterThan(50);
  });

  it("an entire polygon's stored points survive a long realistic gesture sequence unchanged", () => {
    let view = fitView(IMG_W, IMG_H, VIEW_W, VIEW_H, { pad: 0, min: K_MIN, max: 1, mode: "page" });
    const original = POLY.map((p) => [...p]);

    // A believable sequence: several wheel notches at different pointer positions, two drags,
    // a Fit, then more zooming — driven through the exact same functions the component calls.
    const wheelIn = wheelZoomFactor({ deltaY: -100, deltaMode: 0 });
    const wheelOut = wheelZoomFactor({ deltaY: 300, deltaMode: 0 });
    view = zoomAround(view, wheelIn, 500, 300, K_MIN, K_MAX);
    view = zoomAround(view, wheelIn, 520, 280, K_MIN, K_MAX);
    view = panBy(view, -260, 140);
    view = zoomAround(view, wheelIn, 700, 450, K_MIN, K_MAX);
    view = panBy(view, 90, -200);
    view = fitView(IMG_W, IMG_H, VIEW_W, VIEW_H, { pad: 0, min: K_MIN, max: 1, mode: "page" }); // Fit button
    view = zoomAround(view, 1 / view.scale, VIEW_W / 2, VIEW_H / 2, K_MIN, K_MAX); // 100% button
    view = zoomAround(view, wheelOut, 100, 100, K_MIN, K_MAX);
    view = panBy(view, 30, 30);

    // No mutation ever touched `POLY`/`original` — assert that directly (the real guarantee),
    // then confirm every point still round-trips through the final view to its original position.
    expect(POLY).toEqual(original);
    for (const [x, y] of original) {
      const screen = worldToScreen(view, { x, y });
      const back = screenToWorld(view, screen);
      expect(back.x).toBeCloseTo(x, 6);
      expect(back.y).toBeCloseTo(y, 6);
    }
  });

  it("Fit never upscales past 100% (never blows up a small image), 100% is exact", () => {
    const tiny = fitView(200, 150, VIEW_W, VIEW_H, { pad: 0, min: K_MIN, max: 1, mode: "page" });
    expect(tiny.scale).toBeLessThanOrEqual(1);

    let view = fitView(IMG_W, IMG_H, VIEW_W, VIEW_H, { pad: 0, min: K_MIN, max: 1, mode: "page" });
    view = zoomAround(view, 1 / view.scale, VIEW_W / 2, VIEW_H / 2, K_MIN, K_MAX);
    expect(view.scale).toBeCloseTo(1, 9);
  });

  it("zoom is clamped so a runaway scroll session can't blow the scale past K_MAX or below K_MIN", () => {
    let view = fitView(IMG_W, IMG_H, VIEW_W, VIEW_H, { pad: 0, min: K_MIN, max: 1, mode: "page" });
    for (let i = 0; i < 40; i++) view = zoomAround(view, 1.5, 450, 310, K_MIN, K_MAX);
    expect(view.scale).toBeLessThanOrEqual(K_MAX);
    for (let i = 0; i < 40; i++) view = zoomAround(view, 1 / 1.5, 450, 310, K_MIN, K_MAX);
    expect(view.scale).toBeGreaterThanOrEqual(K_MIN);
  });
});
