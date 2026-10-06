/* NEW-2 (B2163345) — the selection chrome of a CROPPED overlay fits the visible region, and resize /
 * rotate pivot about its centre, on BOTH surfaces (one implementation: shared/overlay). */
import { describe, it, expect } from "vitest";
import {
  visibleFrame, visibleCenterPx, visibleCornersPx, visibleCenterWorld, anchorVisibleCentre, anchorVisibleCentreGeo,
  imagePointToWorld, imagePointToLatLon,
} from "../src/shared/overlay/overlayPlacement.js";

const base = { x: -500, y: -400, imgW: 1000, imgH: 800, ftPerPx: 1, rotation: 0 };
const geoBase = { centerLat: 29.78, centerLon: -95.82, imgW: 1000, imgH: 800, ftPerPx: 1, rotationDeg: 0 };
const CROPS = {
  none: undefined,
  rect: { kind: "rect", x: 600, y: 100, w: 200, h: 150 },
  legacyRect: { x: 600, y: 100, w: 200, h: 150 }, // no `kind` reads as rect
  poly: { kind: "poly", pts: [[600, 100], [800, 120], [700, 250]] },
};

describe("visible frame", () => {
  it("is the whole image when uncropped (Reset crop returns the chrome to the full image)", () => {
    expect(visibleFrame({ ...base })).toEqual({ x: 0, y: 0, w: 1000, h: 800 });
    expect(visibleCenterPx({ ...base })).toEqual({ x: 500, y: 400 });
  });
  it("is the rect crop, or a polygon crop's bounding box", () => {
    expect(visibleFrame({ ...base, crop: CROPS.rect })).toEqual({ x: 600, y: 100, w: 200, h: 150 });
    expect(visibleFrame({ ...base, crop: CROPS.legacyRect })).toEqual({ x: 600, y: 100, w: 200, h: 150 });
    expect(visibleFrame({ ...base, crop: CROPS.poly })).toEqual({ x: 600, y: 100, w: 200, h: 150 });
    expect(visibleCornersPx({ ...base, crop: CROPS.rect })).toEqual([{ x: 600, y: 100 }, { x: 800, y: 100 }, { x: 800, y: 250 }, { x: 600, y: 250 }]);
  });
});

describe("canvas: gestures pivot about the VISIBLE centre", () => {
  for (const [name, crop] of Object.entries(CROPS)) for (const rot of [0, 33]) {
    const o = { ...base, rotation: rot, crop };
    it(`scale keeps the visible centre fixed (${name}, rotation ${rot})`, () => {
      const v0 = visibleCenterWorld(o);
      const patch = anchorVisibleCentre(o, { ftPerPx: 2.5 });
      const o1 = { ...o, ...patch };
      expect(o1.ftPerPx).toBe(2.5);
      const v1 = visibleCenterWorld(o1);
      expect(v1.x).toBeCloseTo(v0.x, 6); expect(v1.y).toBeCloseTo(v0.y, 6);
    });
    it(`rotate keeps the visible centre fixed and leaves scale + crop alone (${name}, rotation ${rot})`, () => {
      const v0 = visibleCenterWorld(o);
      const patch = anchorVisibleCentre(o, { rotation: rot + 71 });
      const o1 = { ...o, ...patch };
      expect(Object.keys(patch).sort()).toEqual(["rotation", "x", "y"]);
      const v1 = visibleCenterWorld(o1);
      expect(v1.x).toBeCloseTo(v0.x, 6); expect(v1.y).toBeCloseTo(v0.y, 6);
      expect(o1.ftPerPx).toBe(o.ftPerPx); expect(o1.crop).toBe(crop);
    });
  }
  it("uncropped: identical to the old pivot about the image centre", () => {
    const o = { ...base, rotation: 20 };
    const p = anchorVisibleCentre(o, { ftPerPx: 3 });
    expect(p.x).toBeCloseTo(-1500, 6); expect(p.y).toBeCloseTo(-1200, 6); // centre stays at (0,0)
  });
  it("a point of the image keeps its place relative to the crop under a scale (no drift)", () => {
    const o = { ...base, crop: CROPS.rect };
    const o1 = { ...o, ...anchorVisibleCentre(o, { ftPerPx: 2 }) };
    const a = imagePointToWorld(o1, 600, 100), b = imagePointToWorld(o1, 800, 250);
    expect(b.x - a.x).toBeCloseTo(400, 6); expect(b.y - a.y).toBeCloseTo(300, 6);
  });
});

describe("map surface (geo): same rule", () => {
  for (const [name, crop] of Object.entries(CROPS)) for (const rot of [0, 33]) {
    const o = { ...geoBase, rotationDeg: rot, crop };
    const c = visibleCenterPx(o);
    it(`scale + rotate keep the visible centre's lat/lon (${name}, rotation ${rot})`, () => {
      const v0 = imagePointToLatLon(o, o.imgW, o.imgH, c.x, c.y);
      for (const patch of [{ ftPerPx: 2.2 }, { rotationDeg: rot + 58 }]) {
        const o1 = anchorVisibleCentreGeo(o, patch);
        const v1 = imagePointToLatLon(o1, o1.imgW, o1.imgH, c.x, c.y);
        expect(v1.lat).toBeCloseTo(v0.lat, 9); expect(v1.lon).toBeCloseTo(v0.lon, 9);
      }
    });
  }
  it("uncropped: the anchor does not move (old behaviour)", () => {
    const o1 = anchorVisibleCentreGeo(geoBase, { ftPerPx: 4 });
    expect(o1.centerLat).toBeCloseTo(geoBase.centerLat, 9); expect(o1.centerLon).toBeCloseTo(geoBase.centerLon, 9);
  });
});
