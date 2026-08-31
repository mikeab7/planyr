import { describe, it, expect } from "vitest";
import {
  solveOverlayTransform, invertOverlayTransform, imagePointToLatLon, latLonToImagePoint,
  overlayCornersLatLon, measureLatLonFeet,
} from "../src/shared/sitePlans/lib/overlayGeoref.js";
import { projectToGrid, gridToProject } from "../src/shared/coordinates/index.js";

// A synthetic overlay near Katy, TX: image (0,0) sits at this lat/lon, and image (1000,0) is
// 1000 px east of it at the SAME real-world scale as `SCALE_FT_PER_PX` feet/px, unrotated.
const ORIGIN = { lat: 29.7858, lon: -95.8244 };
const SCALE_FT_PER_PX = 0.75;

function syntheticControlPoints() {
  const originFeet = projectToGrid(ORIGIN.lat, ORIGIN.lon);
  const p1 = { px: 0, py: 0, ...ORIGIN };
  const feet2 = { x: originFeet.x + 1000 * SCALE_FT_PER_PX, y: originFeet.y };
  const ll2 = gridToProject(feet2);
  const p2 = { px: 1000, py: 0, lat: ll2.lat, lon: ll2.lon };
  return [p1, p2];
}

describe("overlayGeoref — solveOverlayTransform", () => {
  it("returns null for fewer than 2 control points", () => {
    expect(solveOverlayTransform([])).toBe(null);
    expect(solveOverlayTransform([{ px: 0, py: 0, lat: 1, lon: 1 }])).toBe(null);
  });

  it("recovers the known scale from 2 control points, unrotated", () => {
    const cps = syntheticControlPoints();
    const t = solveOverlayTransform(cps);
    expect(t).not.toBe(null);
    expect(t.scale).toBeCloseTo(SCALE_FT_PER_PX, 6);
    expect(t.rotDeg).toBeCloseTo(0, 4);
    expect(t.residual).toBeCloseTo(0, 6);
  });

  it("recovers a known rotation", () => {
    const originFeet = projectToGrid(ORIGIN.lat, ORIGIN.lon);
    // image (1000,0) placed 90 degrees off (north instead of east) at the same scale.
    const feet2 = { x: originFeet.x, y: originFeet.y + 1000 * SCALE_FT_PER_PX };
    const ll2 = gridToProject(feet2);
    const cps = [{ px: 0, py: 0, ...ORIGIN }, { px: 1000, py: 0, lat: ll2.lat, lon: ll2.lon }];
    const t = solveOverlayTransform(cps);
    expect(Math.abs(t.rotDeg)).toBeCloseTo(90, 3);
  });
});

describe("overlayGeoref — point conversion round-trips", () => {
  it("imagePointToLatLon then latLonToImagePoint returns the original pixel", () => {
    const cps = syntheticControlPoints();
    const ll = imagePointToLatLon(cps, 400, 250);
    expect(ll).not.toBe(null);
    const back = latLonToImagePoint(cps, ll.lat, ll.lon);
    expect(back.x).toBeCloseTo(400, 3);
    expect(back.y).toBeCloseTo(250, 3);
  });

  it("invertOverlayTransform undoes the forward transform", () => {
    const cps = syntheticControlPoints();
    const t = solveOverlayTransform(cps);
    const inv = invertOverlayTransform(t);
    const feet = t.apply({ x: 123, y: 45 });
    const back = inv.apply(feet);
    expect(back.x).toBeCloseTo(123, 3);
    expect(back.y).toBeCloseTo(45, 3);
  });

  it("returns null with no resolvable transform", () => {
    expect(imagePointToLatLon([], 0, 0)).toBe(null);
    expect(latLonToImagePoint([], 1, 1)).toBe(null);
    expect(invertOverlayTransform(null)).toBe(null);
  });
});

describe("overlayGeoref — overlayCornersLatLon", () => {
  it("places all four corners consistently with the transform", () => {
    const cps = syntheticControlPoints();
    const corners = overlayCornersLatLon(cps, 2000, 1000);
    expect(corners).not.toBe(null);
    // top-left is image (0,0), which is a control point itself.
    expect(corners.topLeft.lat).toBeCloseTo(ORIGIN.lat, 6);
    expect(corners.topLeft.lon).toBeCloseTo(ORIGIN.lon, 6);
    // top-right (2000,0) should read further east than top-left, roughly the same latitude
    // (unrotated) — not exactly equal, since state-plane "due east" isn't exactly a line of
    // constant latitude over any real distance (Lambert Conformal Conic convergence).
    expect(corners.topRight.lon).toBeGreaterThan(corners.topLeft.lon);
    expect(corners.topRight.lat).toBeCloseTo(corners.topLeft.lat, 3);
    // bottom-left (0,1000) should read further south (lower latitude) than top-left.
    expect(corners.bottomLeft.lat).toBeLessThan(corners.topLeft.lat);
  });
});

describe("overlayGeoref — image y-down vs. grid y-up handedness (regression)", () => {
  // A similarity transform is a rigid rotation and cannot represent an axis flip; naively
  // fitting raw image px/py (y-down) against project-grid feet (y-up, north-positive)
  // mirrors the placement for any real (non-degenerate) control-point pair. Caught by an
  // earlier version of the corners test above; this pins the fix with control points that
  // vary in BOTH image axes at once, an unrotated site plan (the common real case), so a
  // reflection can't hide behind a degenerate single-axis pick.
  it("keeps south-in-the-image mapping to south-on-the-map (no mirroring) for an unrotated plan", () => {
    const originFeet = projectToGrid(ORIGIN.lat, ORIGIN.lon);
    // image (1000,1000) is 1000px east AND 1000px down from (0,0) — on an unrotated plan
    // that must land east AND south of the origin, never east-and-north (a mirror).
    const feet2 = { x: originFeet.x + 1000 * SCALE_FT_PER_PX, y: originFeet.y - 1000 * SCALE_FT_PER_PX };
    const ll2 = gridToProject(feet2);
    const cps = [{ px: 0, py: 0, ...ORIGIN }, { px: 1000, py: 1000, lat: ll2.lat, lon: ll2.lon }];
    const t = solveOverlayTransform(cps);
    // unrotated: image +x -> feet +x (east), image +y (down) -> feet -y (south) — net rotDeg ~ 0.
    expect(Math.abs(((t.rotDeg % 360) + 360) % 360)).toBeCloseTo(0, 3);
    // a point straight below (0,0) in image space must read SOUTH (lower latitude), not north.
    const below = imagePointToLatLon(cps, 0, 500);
    expect(below.lat).toBeLessThan(ORIGIN.lat);
    expect(below.lon).toBeCloseTo(ORIGIN.lon, 4);
  });
});

describe("overlayGeoref — measureLatLonFeet", () => {
  it("measures a known 1000 ft east-west separation", () => {
    const originFeet = projectToGrid(ORIGIN.lat, ORIGIN.lon);
    const b = gridToProject({ x: originFeet.x + 1000, y: originFeet.y });
    expect(measureLatLonFeet(ORIGIN, b)).toBeCloseTo(1000, 3);
  });

  it("is zero for the same point", () => {
    expect(measureLatLonFeet(ORIGIN, ORIGIN)).toBeCloseTo(0, 9);
  });
});
