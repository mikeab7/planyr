import { describe, it, expect } from "vitest";
import {
  validPlacement, overlayCornersFromPlacement, latLonToImagePoint, suggestFtPerPx,
  scalePlacement, rotatePlacement,
} from "../src/shared/sitePlans/lib/overlayGeoref.js";
import { projectToGrid, gridToProject } from "../src/shared/coordinates/index.js";

// A synthetic placement near Katy, TX.
const ORIGIN = { lat: 29.7858, lon: -95.8244 };
const SCALE_FT_PER_PX = 0.75;
const IMG_W = 2000, IMG_H = 1000;

function placement(rotationDeg = 0) {
  return { centerLat: ORIGIN.lat, centerLon: ORIGIN.lon, ftPerPx: SCALE_FT_PER_PX, rotationDeg };
}

describe("overlayGeoref — validPlacement", () => {
  it("rejects a missing or malformed placement", () => {
    expect(validPlacement(null)).toBe(false);
    expect(validPlacement({})).toBe(false);
    expect(validPlacement({ centerLat: 1, centerLon: 1, ftPerPx: 0 })).toBe(false);
    expect(validPlacement({ centerLat: 1, centerLon: 1, ftPerPx: -1 })).toBe(false);
  });
  it("accepts a well-formed placement", () => {
    expect(validPlacement(placement())).toBe(true);
  });
});

describe("overlayGeoref — overlayCornersFromPlacement", () => {
  it("returns null for an invalid placement or image size", () => {
    expect(overlayCornersFromPlacement(null, IMG_W, IMG_H)).toBe(null);
    expect(overlayCornersFromPlacement(placement(), 0, IMG_H)).toBe(null);
  });

  it("unrotated: top row is north of bottom row, right column east of left", () => {
    const c = overlayCornersFromPlacement(placement(0), IMG_W, IMG_H);
    expect(c).not.toBe(null);
    expect(c.topLeft.lat).toBeGreaterThan(c.bottomLeft.lat); // top = north
    expect(c.topRight.lon).toBeGreaterThan(c.topLeft.lon);   // right = east
    expect(c.topLeft.lat).toBeCloseTo(c.topRight.lat, 3);    // unrotated row stays level
  });

  it("the center of the four corners recovers the placement's center", () => {
    const c = overlayCornersFromPlacement(placement(37), IMG_W, IMG_H);
    const avgLat = (c.topLeft.lat + c.topRight.lat + c.bottomLeft.lat + c.bottomRight.lat) / 4;
    const avgLon = (c.topLeft.lon + c.topRight.lon + c.bottomLeft.lon + c.bottomRight.lon) / 4;
    expect(avgLat).toBeCloseTo(ORIGIN.lat, 6);
    expect(avgLon).toBeCloseTo(ORIGIN.lon, 6);
  });

  it("a 90-degree rotation turns the top edge to face east (never a mirror)", () => {
    // this is the exact defect the owner reported live — a 2-control-point similarity fit
    // shipped a plan upside down. A DIRECT rotation must never be able to reproduce that: the
    // top-center point, rotated 90 degrees clockwise-on-screen, must land due EAST of center,
    // not west (a mirror would send it west).
    const c = overlayCornersFromPlacement(placement(90), IMG_W, IMG_H);
    const topCenterLon = (c.topLeft.lon + c.topRight.lon) / 2;
    const topCenterLat = (c.topLeft.lat + c.topRight.lat) / 2;
    expect(topCenterLon).toBeGreaterThan(ORIGIN.lon);
    expect(topCenterLat).toBeCloseTo(ORIGIN.lat, 3);
  });

  it("a 180-degree rotation puts the top edge where the bottom edge was (not a reflection)", () => {
    const flat = overlayCornersFromPlacement(placement(0), IMG_W, IMG_H);
    const flipped = overlayCornersFromPlacement(placement(180), IMG_W, IMG_H);
    // top-left of the 180-rotated placement lands at the SAME point as bottom-right unrotated
    // (a true rotation), not at top-right (which a mirror could produce).
    expect(flipped.topLeft.lat).toBeCloseTo(flat.bottomRight.lat, 4);
    expect(flipped.topLeft.lon).toBeCloseTo(flat.bottomRight.lon, 4);
  });
});

describe("overlayGeoref — latLonToImagePoint round-trips overlayCornersFromPlacement", () => {
  it("recovers each corner's own image pixel", () => {
    const p = placement(25);
    const c = overlayCornersFromPlacement(p, IMG_W, IMG_H);
    const tl = latLonToImagePoint(p, IMG_W, IMG_H, c.topLeft.lat, c.topLeft.lon);
    expect(tl.x).toBeCloseTo(0, 3);
    expect(tl.y).toBeCloseTo(0, 3);
    const br = latLonToImagePoint(p, IMG_W, IMG_H, c.bottomRight.lat, c.bottomRight.lon);
    expect(br.x).toBeCloseTo(IMG_W, 3);
    expect(br.y).toBeCloseTo(IMG_H, 3);
  });

  it("recovers the center pixel", () => {
    const p = placement(-40);
    const mid = latLonToImagePoint(p, IMG_W, IMG_H, ORIGIN.lat, ORIGIN.lon);
    expect(mid.x).toBeCloseTo(IMG_W / 2, 3);
    expect(mid.y).toBeCloseTo(IMG_H / 2, 3);
  });

  it("returns null for an invalid placement", () => {
    expect(latLonToImagePoint(null, IMG_W, IMG_H, 1, 1)).toBe(null);
  });
});

describe("overlayGeoref — suggestFtPerPx", () => {
  it("sizes the image to a fraction of the given view width", () => {
    const ftPerPx = suggestFtPerPx(1000, 500, 0.6);
    expect(ftPerPx).toBeCloseTo((1000 * 0.6) / 500, 9);
  });
  it("falls back to a safe positive default for degenerate inputs", () => {
    expect(suggestFtPerPx(0, 500)).toBeGreaterThan(0);
    expect(suggestFtPerPx(1000, 0)).toBeGreaterThan(0);
  });
});

describe("overlayGeoref — scalePlacement / rotatePlacement (mirror the Site Planner's own ovScale/ovRotate)", () => {
  it("scalePlacement multiplies ftPerPx by the ratio and holds the center fixed", () => {
    const p = placement(10);
    const next = scalePlacement(p, 2);
    expect(next.ftPerPx).toBeCloseTo(SCALE_FT_PER_PX * 2, 9);
    expect(next.centerLat).toBe(p.centerLat);
    expect(next.centerLon).toBe(p.centerLon);
    expect(next.rotationDeg).toBe(p.rotationDeg);
  });

  it("rotatePlacement adds the delta and normalizes to [0,360)", () => {
    expect(rotatePlacement(placement(0), 0, 30).rotationDeg).toBeCloseTo(30, 9);
    expect(rotatePlacement(placement(0), 350, 20).rotationDeg).toBeCloseTo(10, 9);
    expect(rotatePlacement(placement(0), 10, -30).rotationDeg).toBeCloseTo(340, 9);
  });
});

// Sanity: overlayGeoref's grid math is the same shared spine used elsewhere — a placement's
// center round-trips through projectToGrid/gridToProject like any other point.
describe("overlayGeoref — shares the app's one coordinate spine", () => {
  it("projectToGrid/gridToProject round-trip the placement center", () => {
    const g = projectToGrid(ORIGIN.lat, ORIGIN.lon);
    const back = gridToProject(g);
    expect(back.lat).toBeCloseTo(ORIGIN.lat, 6);
    expect(back.lon).toBeCloseTo(ORIGIN.lon, 6);
  });
});
