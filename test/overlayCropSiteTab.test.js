/* NEW-1 (B1838704) — CROP ON THE SITE TAB OVERLAYS PANEL. The pure half: the ONE projection of
 * either crop shape into the planner canvas's screen-px <clipPath>, the lock/eligibility predicate
 * the panel AND the write both ask, the page-change re-fit, and the poly-safe effective rect the
 * trim fields read. The wiring half is test/overlayCropWiring.test.js.
 */
import { describe, it, expect } from "vitest";
import {
  cropClipShapeScreen, cropClipRectScreen, cropEditBlock, recropForRaster, effectiveCropRect, cropTrimFeet,
  normalizeCropShape,
} from "../src/workspaces/site-planner/lib/overlayCrop.js";

const base = { id: "a", src: "data:image/png;base64,x", imgW: 1000, imgH: 800, ftPerPx: 0.5 };

describe("cropClipShapeScreen", () => {
  const tl = { x: 10, y: 20 };
  it("no crop → null (the image draws whole, no <clipPath> at all)", () => {
    expect(cropClipShapeScreen(base, tl, 0.5, 0.5, 2)).toBeNull();
  });
  it("a rect crop is numerically identical to the legacy cropClipRectScreen", () => {
    for (const crop of [{ x: 100, y: 50, w: 700, h: 670 }, { kind: "rect", x: 3, y: 4, w: 500, h: 400 }]) {
      const o = { ...base, crop };
      const r = cropClipShapeScreen(o, tl, 0.5, 0.5, 2);
      const legacy = cropClipRectScreen(o, tl, 0.5, 2);
      expect(r.kind).toBe("rect");
      expect({ x: r.x, y: r.y, width: r.width, height: r.height }).toEqual(legacy);
    }
  });
  it("a polygon projects every vertex by the same image-px → screen-px scale, offset by the image's top-left", () => {
    const o = { ...base, crop: { kind: "poly", pts: [[0, 0], [100, 0], [50, 80]] } };
    const r = cropClipShapeScreen(o, tl, 0.5, 0.5, 2); // k = 1
    expect(r.kind).toBe("poly");
    expect(r.pts).toEqual([[10, 20], [110, 20], [60, 100]]);
    expect(r.points).toBe("10,20 110,20 60,100");
  });
  it("honours a separate vertical scale (a map capture's Web-Mercator ftPerPxY)", () => {
    const o = { ...base, crop: { kind: "poly", pts: [[10, 10], [20, 10], [20, 20]] } };
    const r = cropClipShapeScreen(o, { x: 0, y: 0 }, 1, 2, 1);
    expect(r.pts).toEqual([[10, 20], [20, 20], [20, 40]]);
  });
  it("a malformed stored crop never clips (null), so a bad record can't clip a sheet to nothing", () => {
    for (const crop of [{ kind: "poly", pts: [[0, 0], [1, 1]] }, { x: 0, y: 0, w: 0, h: 5 }, { kind: "poly", pts: "nope" }]) {
      expect(cropClipShapeScreen({ ...base, crop }, tl, 0.5, 0.5, 2)).toBeNull();
    }
  });
  it("the result is independent of rotation — rotation is the parent <g>'s transform, never baked into the clip", () => {
    const crop = { kind: "poly", pts: [[0, 0], [100, 0], [50, 80]] };
    expect(cropClipShapeScreen({ ...base, crop, rotation: 37 }, tl, 0.5, 0.5, 2))
      .toEqual(cropClipShapeScreen({ ...base, crop, rotation: 0 }, tl, 0.5, 0.5, 2));
  });
});

describe("cropEditBlock — the ONE lock/eligibility predicate (asked by the panel AND by the write)", () => {
  it("an ordinary loaded overlay may be cropped", () => expect(cropEditBlock(base)).toBeNull());
  it("a LOCKED overlay refuses, with a plain reason", () => {
    expect(cropEditBlock({ ...base, locked: true })).toMatch(/Unlock/);
  });
  it("the pinned map capture refuses (it prints via its own aerial path — a crop would not export)", () => {
    expect(cropEditBlock({ ...base, fromMap: true })).toMatch(/map capture/);
  });
  it("an overlay with no raster on this device refuses (nothing to crop against)", () => {
    expect(cropEditBlock({ ...base, src: null })).toMatch(/Load the drawing/);
    expect(cropEditBlock({ ...base, imgW: 0 })).toMatch(/Load the drawing/);
  });
  it("a missing overlay refuses", () => expect(cropEditBlock(undefined)).toBeTruthy());
});

describe("recropForRaster — a PDF page change re-fits the crop to the new raster's box", () => {
  it("same-size page keeps the crop exactly", () => {
    const crop = { kind: "rect", x: 10, y: 10, w: 500, h: 400 };
    expect(recropForRaster(crop, 1000, 800)).toEqual(crop);
  });
  it("a smaller page clamps the crop inside it", () => {
    const r = recropForRaster({ kind: "rect", x: 100, y: 100, w: 900, h: 700 }, 600, 500);
    expect(r.x + r.w).toBeLessThanOrEqual(600);
    expect(r.y + r.h).toBeLessThanOrEqual(500);
  });
  it("no crop stays no crop", () => expect(recropForRaster(null, 10, 10)).toBeNull());
  it("a polygon whose vertices all fall off the new page is dropped (full sheet), never kept as a sliver", () => {
    expect(recropForRaster({ kind: "poly", pts: [[900, 700], [990, 700], [950, 790]] }, 100, 100)).toBeNull();
  });
});

describe("effectiveCropRect / cropTrimFeet are poly-safe (never NaN)", () => {
  it("a polygon crop reads as its bounding box", () => {
    const o = { ...base, crop: { kind: "poly", pts: [[100, 50], [700, 60], [400, 720]] } };
    expect(effectiveCropRect(o)).toEqual({ x: 100, y: 50, w: 600, h: 670 });
    const t = cropTrimFeet(o);
    for (const v of Object.values(t)) expect(Number.isFinite(v)).toBe(true);
  });
});

describe("the trim fields' output is kind-stamped on write (normalizeCropShape)", () => {
  it("a legacy no-kind rect from cropFromTrimFeet becomes {kind:'rect', …}", () => {
    expect(normalizeCropShape({ x: 10, y: 10, w: 100, h: 100 }, 1000, 800)).toEqual({ kind: "rect", x: 10, y: 10, w: 100, h: 100 });
  });
});
