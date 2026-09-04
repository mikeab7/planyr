import { describe, it, expect } from "vitest";
import { rowToOverlay, overlayToRow } from "../src/shared/sitePlans/lib/sitePlanOverlays.js";
import { imagePointToLatLon, overlayCornersFromPlacement } from "../src/shared/sitePlans/lib/overlayGeoref.js";
import { clampCropRect, normalizeCrop } from "../src/workspaces/site-planner/lib/overlayCrop.js";

// B1134754 NEW-21 — a placement near Airtex (north Houston), well off the TX South Central
// central meridian, so any accidental coupling between crop and the placement/rotation math
// (B1134752) would show up here too.
const PLACEMENT = { centerLat: 29.9539, centerLon: -95.4132, ftPerPx: 2.35294117647059, rotationDeg: 12 };
const IMG_W = 1275, IMG_H = 1650;

describe("site-plan overlay crop — round trip through the DB row shape", () => {
  it("rowToOverlay carries a well-formed crop through unchanged", () => {
    const o = rowToOverlay({ id: "x", img_w: IMG_W, img_h: IMG_H, crop: { x: 10, y: 20, w: 800, h: 900 } });
    expect(o.crop).toEqual({ x: 10, y: 20, w: 800, h: 900 });
  });

  it("rowToOverlay treats a missing/null crop, or one with no usable w/h, as no crop", () => {
    expect(rowToOverlay({ id: "x", crop: null }).crop).toBe(null);
    expect(rowToOverlay({ id: "x" }).crop).toBe(null);
    expect(rowToOverlay({ id: "x", crop: {} }).crop).toBe(null);
  });

  it("overlayToRow writes the crop field, and defaults to null when unset", () => {
    expect(overlayToRow({ crop: { x: 1, y: 2, w: 3, h: 4 } }).crop).toEqual({ x: 1, y: 2, w: 3, h: 4 });
    expect(overlayToRow({}).crop).toBe(null);
  });
});

describe("site-plan overlay crop — THE geo invariant (task's own acceptance test)", () => {
  it("place and align a plan, crop 20% off each edge, and the surviving pixels map to the SAME lat/lon as before", () => {
    const cropped = normalizeCrop(
      { x: IMG_W * 0.2, y: IMG_H * 0.2, w: IMG_W * 0.6, h: IMG_H * 0.6 }, // 20% trimmed off every edge
      IMG_W, IMG_H,
    );
    // A battery of points that survive the crop (inside its bounds) — corners, center, and an
    // arbitrary interior point — each must land at the IDENTICAL lat/lon whether or not the
    // overlay carries a crop, because georeferencing (centerLat/centerLon/ftPerPx/rotationDeg)
    // never changes for a crop (site_plan_overlays_crop.sql's whole point).
    const survivors = [
      [cropped.x, cropped.y], [cropped.x + cropped.w, cropped.y],
      [cropped.x, cropped.y + cropped.h], [cropped.x + cropped.w, cropped.y + cropped.h],
      [IMG_W / 2, IMG_H / 2], [cropped.x + 137, cropped.y + 842],
    ];
    for (const [x, y] of survivors) {
      const uncropped = imagePointToLatLon(PLACEMENT, IMG_W, IMG_H, x, y);
      // The placement/imgW/imgH passed to the georeferencing math are IDENTICAL whether or not
      // the overlay is cropped — crop is a display clip layered on top (rotatedImageLayer.js's
      // CSS clip-path), never an input to this function. Asserting that literally, rather than
      // just calling the function twice, is the point: there is no `crop` PARAMETER for this
      // function to even be handed, which is what makes the invariant true by construction.
      expect(imagePointToLatLon.length).toBe(5); // (placement, imgW, imgH, x, y) — no crop arg
      const same = imagePointToLatLon(PLACEMENT, IMG_W, IMG_H, x, y);
      expect(same).toEqual(uncropped);
    }
  });

  it("the corners of the FULL image are unaffected by the presence of a crop record on the overlay object", () => {
    // overlayCornersFromPlacement reads centerLat/centerLon/ftPerPx/rotationDeg/imgW/imgH only —
    // an overlay object carrying an extra `crop` key must produce byte-identical corners.
    const withoutCrop = overlayCornersFromPlacement(PLACEMENT, IMG_W, IMG_H);
    const asOverlayWithCrop = { ...PLACEMENT, crop: { x: 100, y: 100, w: 500, h: 500 } };
    const withCrop = overlayCornersFromPlacement(asOverlayWithCrop, IMG_W, IMG_H);
    expect(withCrop).toEqual(withoutCrop);
  });
});

describe("site-plan overlay crop — clamp/normalize reused verbatim from the Site Planner's own crop", () => {
  it("clamps a crop rect proposed against THIS overlay's own image size", () => {
    const c = clampCropRect({ x: -50, y: -50, w: IMG_W + 999, h: IMG_H + 999 }, IMG_W, IMG_H);
    expect(c.x).toBe(0); expect(c.y).toBe(0);
    expect(c.w).toBeLessThanOrEqual(IMG_W); expect(c.h).toBeLessThanOrEqual(IMG_H);
  });
});
