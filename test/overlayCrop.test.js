/* B712595 — CROP A PLACED OVERLAY. Pure geometry: clamping, the sparse "no crop" convention, the
 * screen clip rect, the PDF.js hi-res render-viewport offset math, and the panel's feet-based trim
 * fields. See src/workspaces/site-planner/lib/overlayCrop.js for the derivation of the viewport
 * offset formula (worked from PageViewport's own transform construction in pdfjs-dist).
 */
import { describe, it, expect } from "vitest";
import {
  MIN_CROP_PX, clampCropRect, isFullCrop, normalizeCrop, hasCrop, effectiveCropRect,
  cropClipRectScreen, cropTrimFeet, cropFromTrimFeet,
} from "../src/workspaces/site-planner/lib/overlayCrop.js";

describe("clampCropRect", () => {
  it("passes through an already-valid rect unchanged", () => {
    expect(clampCropRect({ x: 100, y: 50, w: 400, h: 300 }, 1000, 800)).toEqual({ x: 100, y: 50, w: 400, h: 300 });
  });
  it("clamps negative origin to 0", () => {
    expect(clampCropRect({ x: -50, y: -20, w: 200, h: 200 }, 1000, 800)).toEqual({ x: 0, y: 0, w: 200, h: 200 });
  });
  it("clamps a rect that overruns the right/bottom edge", () => {
    expect(clampCropRect({ x: 900, y: 700, w: 500, h: 500 }, 1000, 800)).toEqual({ x: 900, y: 700, w: 100, h: 100 });
  });
  it("never produces a rect thinner than MIN_CROP_PX", () => {
    const c = clampCropRect({ x: 0, y: 0, w: 1, h: 1 }, 1000, 800);
    expect(c.w).toBeGreaterThanOrEqual(MIN_CROP_PX);
    expect(c.h).toBeGreaterThanOrEqual(MIN_CROP_PX);
  });
  it("returns null for a non-positive image size (never divides by / clamps against garbage)", () => {
    expect(clampCropRect({ x: 0, y: 0, w: 10, h: 10 }, 0, 800)).toBe(null);
    expect(clampCropRect({ x: 0, y: 0, w: 10, h: 10 }, 1000, -5)).toBe(null);
  });
});

describe("isFullCrop / normalizeCrop — the sparse convention", () => {
  it("no crop object at all is a full crop", () => {
    expect(isFullCrop(null, 1000, 800)).toBe(true);
    expect(isFullCrop(undefined, 1000, 800)).toBe(true);
  });
  it("a rect covering exactly the whole image is a full crop", () => {
    expect(isFullCrop({ x: 0, y: 0, w: 1000, h: 800 }, 1000, 800)).toBe(true);
  });
  it("a real trim is NOT a full crop", () => {
    expect(isFullCrop({ x: 10, y: 0, w: 990, h: 800 }, 1000, 800)).toBe(false);
  });
  it("normalizeCrop collapses a full-image rect to null — no residue key on an untouched/reset overlay", () => {
    expect(normalizeCrop({ x: 0, y: 0, w: 1000, h: 800 }, 1000, 800)).toBe(null);
  });
  it("normalizeCrop keeps + clamps a real trim", () => {
    expect(normalizeCrop({ x: -10, y: 0, w: 500, h: 900 }, 1000, 800)).toEqual({ x: 0, y: 0, w: 500, h: 800 });
  });
});

describe("hasCrop / effectiveCropRect", () => {
  it("hasCrop is false for an untouched overlay", () => {
    expect(hasCrop({ imgW: 1000, imgH: 800 })).toBe(false);
  });
  it("effectiveCropRect falls back to the full image when uncropped", () => {
    expect(effectiveCropRect({ imgW: 1000, imgH: 800 })).toEqual({ x: 0, y: 0, w: 1000, h: 800 });
  });
  it("effectiveCropRect returns the stored crop verbatim when present", () => {
    const o = { imgW: 1000, imgH: 800, crop: { x: 10, y: 20, w: 300, h: 200 } };
    expect(hasCrop(o)).toBe(true);
    expect(effectiveCropRect(o)).toEqual(o.crop);
  });
});

describe("cropClipRectScreen — the SVG <clipPath> rect, same coordinate space as the <image>", () => {
  it("equals the overlay's own on-screen x/y/w/h when uncropped (a no-op clip)", () => {
    const o = { imgW: 1000, imgH: 800, ftPerPx: 2 };
    const tl = { x: 50, y: 60 };
    const rppf = 0.5; // screen px per foot
    expect(cropClipRectScreen(o, tl, o.ftPerPx, rppf)).toEqual({ x: 50, y: 60, width: 1000, height: 800 });
  });
  it("shrinks + offsets to the cropped sub-rect, in the same screen units as the full image", () => {
    const o = { imgW: 1000, imgH: 800, ftPerPx: 2, crop: { x: 100, y: 50, w: 400, h: 300 } };
    const tl = { x: 0, y: 0 };
    const rppf = 1;
    // k = ftPerPx * rppf = 2
    expect(cropClipRectScreen(o, tl, o.ftPerPx, rppf)).toEqual({ x: 200, y: 100, width: 800, height: 600 });
  });
  it("respects a non-zero top-left placement (tl) additively", () => {
    const o = { imgW: 1000, imgH: 800, ftPerPx: 1, crop: { x: 10, y: 10, w: 100, h: 100 } };
    const tl = { x: 500, y: 500 };
    expect(cropClipRectScreen(o, tl, o.ftPerPx, 1)).toEqual({ x: 510, y: 510, width: 100, height: 100 });
  });
});

describe("cropTrimFeet / cropFromTrimFeet — the panel's four edge fields, round-tripped", () => {
  const o = { imgW: 1000, imgH: 800, ftPerPx: 0.5 }; // 500 x 400 ft sheet
  it("zero trim on an uncropped overlay", () => {
    expect(cropTrimFeet(o)).toEqual({ left: 0, top: 0, right: 0, bottom: 0 });
  });
  it("reads back the trim implied by a stored crop", () => {
    const cropped = { ...o, crop: { x: 100, y: 40, w: 700, h: 600 } }; // right/bottom margin: 1000-100-700=200px, 800-40-600=160px
    expect(cropTrimFeet(cropped)).toEqual({ left: 50, top: 20, right: 100, bottom: 80 });
  });
  it("round-trips: trim -> crop -> trim", () => {
    const trim = { left: 25, top: 10, right: 25, bottom: 10 };
    const crop = cropFromTrimFeet(trim, o);
    expect(crop).not.toBe(null);
    const cropped = { ...o, crop };
    expect(cropTrimFeet(cropped)).toEqual(trim);
  });
  it("all-zero trim normalizes to no crop at all (null), never a stored no-op rect", () => {
    expect(cropFromTrimFeet({ left: 0, top: 0, right: 0, bottom: 0 }, o)).toBe(null);
  });
  it("negative/garbage trims read as zero, never expand past the edge", () => {
    const crop = cropFromTrimFeet({ left: -50, top: NaN, right: 10, bottom: 5 }, o);
    expect(crop.x).toBe(0);
    expect(crop.y).toBe(0);
  });
});
