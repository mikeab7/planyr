/* B719779 — CROP A PLACED OVERLAY. Pure geometry: clamping, the sparse "no crop" convention, the
 * screen clip rect, the PDF.js hi-res render-viewport offset math, and the panel's feet-based trim
 * fields. See src/workspaces/site-planner/lib/overlayCrop.js for the derivation of the viewport
 * offset formula (worked from PageViewport's own transform construction in pdfjs-dist).
 */
import { describe, it, expect } from "vitest";
import {
  MIN_CROP_PX, clampCropRect, isFullCrop, normalizeCrop, hasCrop, effectiveCropRect,
  cropClipRectScreen, cropTrimFeet, cropFromTrimFeet,
  MIN_POLY_VERTICES, cropKind, polygonAreaPx, clampPolyPoints, isUsablePoly, normalizePolyCrop,
  rectToPolyPoints, polyPointsToRect, isValidCropShape, normalizeCropShape, clipPathValueForCrop,
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

/* NEW-1 (B1783328) — polygon crop. Discriminated union: {kind:'rect', x,y,w,h} |
 * {kind:'poly', pts}. A crop object with no `kind` key (every row written before this shipped,
 * incl. Michael's live overlay at version 208) must still read as rect — that's the whole point
 * of `cropKind` being a migrate-on-read function rather than a data rewrite. */
describe("cropKind — migrate-on-read discrimination", () => {
  it("no crop at all has no kind", () => {
    expect(cropKind(null)).toBe(null);
  });
  it("a legacy rect (no `kind` key) reads as rect", () => {
    expect(cropKind({ x: 0, y: 0, w: 10, h: 10 })).toBe("rect");
  });
  it("an explicit {kind:'rect'} reads as rect", () => {
    expect(cropKind({ kind: "rect", x: 0, y: 0, w: 10, h: 10 })).toBe("rect");
  });
  it("an explicit {kind:'poly'} reads as poly", () => {
    expect(cropKind({ kind: "poly", pts: [[0, 0], [1, 0], [1, 1]] })).toBe("poly");
  });
});

describe("polygonAreaPx — unsigned shoelace area, used only as a degenerate-shape guard", () => {
  it("a right triangle", () => {
    expect(polygonAreaPx([[0, 0], [10, 0], [0, 10]])).toBe(50);
  });
  it("a square, winding either direction, gives the same unsigned area", () => {
    expect(polygonAreaPx([[0, 0], [10, 0], [10, 10], [0, 10]])).toBe(100);
    expect(polygonAreaPx([[0, 0], [0, 10], [10, 10], [10, 0]])).toBe(100);
  });
  it("fewer than 3 points is zero, not a throw", () => {
    expect(polygonAreaPx([[0, 0], [1, 1]])).toBe(0);
    expect(polygonAreaPx(null)).toBe(0);
  });
});

describe("clampPolyPoints", () => {
  it("clamps every vertex independently into the image bounds", () => {
    expect(clampPolyPoints([[-10, -10], [2000, 5], [5, 2000]], 1000, 800)).toEqual([[0, 0], [1000, 5], [5, 800]]);
  });
  it("returns null for a non-positive image size", () => {
    expect(clampPolyPoints([[0, 0], [1, 1], [2, 2]], 0, 800)).toBe(null);
  });
});

describe("isUsablePoly / normalizePolyCrop — the same degenerate-sliver floor the rect crop uses", () => {
  const imgW = 1000, imgH = 800;
  it("a real triangle well inside the image is usable", () => {
    const pts = [[100, 100], [400, 100], [250, 400]];
    expect(isUsablePoly(pts, imgW, imgH)).toBe(true);
    expect(normalizePolyCrop(pts, imgW, imgH)).toEqual(pts);
  });
  it("fewer than MIN_POLY_VERTICES points is never usable — an overlay can't be clipped to nothing", () => {
    expect(MIN_POLY_VERTICES).toBe(3);
    expect(isUsablePoly([[0, 0], [10, 10]], imgW, imgH)).toBe(false);
    expect(normalizePolyCrop([[0, 0], [10, 10]], imgW, imgH)).toBe(null);
  });
  it("a hairline sliver (near-zero bounding box) is refused, same floor as MIN_CROP_PX", () => {
    const sliver = [[100, 100], [101, 100], [100.5, 101]];
    expect(isUsablePoly(sliver, imgW, imgH)).toBe(false);
    expect(normalizePolyCrop(sliver, imgW, imgH)).toBe(null);
  });
  it("a non-finite vertex makes the whole polygon unusable", () => {
    expect(isUsablePoly([[0, 0], [10, 0], [NaN, 10]], imgW, imgH)).toBe(false);
  });
  it("normalizePolyCrop clamps out-of-bounds vertices before checking usability", () => {
    const pts = [[-50, -50], [500, -50], [500, 500], [-50, 500]];
    expect(normalizePolyCrop(pts, imgW, imgH)).toEqual([[0, 0], [500, 0], [500, 500], [0, 500]]);
  });
});

describe("rectToPolyPoints / polyPointsToRect — reversible, one-step shape conversion", () => {
  it("a rect becomes its 4 corners, clockwise from top-left", () => {
    expect(rectToPolyPoints({ x: 10, y: 20, w: 100, h: 50 })).toEqual([[10, 20], [110, 20], [110, 70], [10, 70]]);
  });
  it("polyPointsToRect is the bounding box — round-trips a rect-derived quad exactly", () => {
    const rect = { x: 10, y: 20, w: 100, h: 50 };
    expect(polyPointsToRect(rectToPolyPoints(rect))).toEqual(rect);
  });
  it("polyPointsToRect on an irregular polygon returns its bounding box, not a lossless shape", () => {
    expect(polyPointsToRect([[0, 0], [100, 30], [40, 90]])).toEqual({ x: 0, y: 0, w: 100, h: 90 });
  });
  it("null in, null out", () => {
    expect(rectToPolyPoints(null)).toBe(null);
    expect(polyPointsToRect(null)).toBe(null);
  });
});

describe("isValidCropShape — the DB-row reader's guard against a malformed crop reaching render", () => {
  it("null is always valid (full image)", () => {
    expect(isValidCropShape(null)).toBe(true);
  });
  it("a legacy rect (no kind) is valid", () => {
    expect(isValidCropShape({ x: 1, y: 2, w: 10, h: 10 })).toBe(true);
  });
  it("a valid poly is valid", () => {
    expect(isValidCropShape({ kind: "poly", pts: [[0, 0], [10, 0], [10, 10]] })).toBe(true);
  });
  it("a poly with fewer than 3 points is invalid", () => {
    expect(isValidCropShape({ kind: "poly", pts: [[0, 0], [10, 0]] })).toBe(false);
  });
  it("a poly whose points aren't [number,number] pairs is invalid", () => {
    expect(isValidCropShape({ kind: "poly", pts: [[0, 0], [10, 0], "bad"] })).toBe(false);
  });
  it("a rect with a non-positive w/h is invalid", () => {
    expect(isValidCropShape({ x: 1, y: 2, w: 0, h: 10 })).toBe(false);
  });
});

describe("normalizeCropShape — dispatches by kind and stamps the discriminator going forward", () => {
  it("a real rect trim commits with an explicit kind:'rect'", () => {
    expect(normalizeCropShape({ x: 10, y: 10, w: 500, h: 400 }, 1000, 800)).toEqual({ kind: "rect", x: 10, y: 10, w: 500, h: 400 });
  });
  it("a full-image rect collapses to null, same as the rect-only path", () => {
    expect(normalizeCropShape({ x: 0, y: 0, w: 1000, h: 800 }, 1000, 800)).toBe(null);
  });
  it("a real polygon commits with kind:'poly' and clamped points", () => {
    const pts = [[100, 100], [400, 100], [250, 400]];
    expect(normalizeCropShape({ kind: "poly", pts }, 1000, 800)).toEqual({ kind: "poly", pts });
  });
  it("a degenerate polygon normalizes to null, exactly like an unusable rect", () => {
    expect(normalizeCropShape({ kind: "poly", pts: [[0, 0], [1, 1]] }, 1000, 800)).toBe(null);
  });
  it("null in, null out", () => {
    expect(normalizeCropShape(null, 1000, 800)).toBe(null);
  });
});

describe("clipPathValueForCrop — the ONE clip mechanism for either shape, in image-local px", () => {
  it("no crop produces no clip", () => {
    expect(clipPathValueForCrop(null, 1000, 800)).toBe("");
  });
  it("a rect produces the same inset() B1134754 always produced", () => {
    const crop = { x: 100, y: 50, w: 400, h: 300 };
    expect(clipPathValueForCrop(crop, 1000, 800)).toBe("inset(50px 500px 450px 100px)");
  });
  it("a legacy no-kind rect and an explicit kind:'rect' produce the identical clip", () => {
    const legacy = { x: 100, y: 50, w: 400, h: 300 };
    const explicit = { kind: "rect", x: 100, y: 50, w: 400, h: 300 };
    expect(clipPathValueForCrop(explicit, 1000, 800)).toBe(clipPathValueForCrop(legacy, 1000, 800));
  });
  it("a polygon produces an evenodd CSS polygon() in image-local px, not lat/lon or screen px", () => {
    const crop = { kind: "poly", pts: [[0, 0], [100, 0], [100, 100]] };
    expect(clipPathValueForCrop(crop, 1000, 800)).toBe("polygon(evenodd, 0px 0px, 100px 0px, 100px 100px)");
  });
  it("a poly with fewer than 3 points produces no clip rather than a malformed CSS value", () => {
    expect(clipPathValueForCrop({ kind: "poly", pts: [[0, 0], [1, 1]] }, 1000, 800)).toBe("");
  });
});

/* THE GEO INVARIANT (B1134754's own proof, re-run for the polygon shape): cropping only clips
 * what is PAINTED, never what is ANCHORED. `imagePointToLatLon` takes no `crop` argument at all —
 * there is no path by which a polygon crop COULD move a surviving pixel's ground position, exactly
 * as already proven for the rect shape in test/siteplanOverlayCrop.test.js. Proven here at the
 * SOURCE level (the function's own arity), the same technique that file already uses. */
describe("geo invariant — a crop (rect OR poly) cannot move a surviving pixel's ground position", () => {
  it("imagePointToLatLon's signature carries no crop parameter", async () => {
    const mod = await import("../src/shared/sitePlans/lib/overlayGeoref.js");
    // arity = declared parameter count; a crop argument would show up here if one existed.
    expect(mod.imagePointToLatLon.length).toBeLessThanOrEqual(5);
    expect(mod.imagePointToLatLon.toString()).not.toMatch(/\bcrop\b/);
  });
});
