/* Proximity screening core (public-data screening PHASE 2) — pure geometry tests.
 * Distances are measured in the real EPSG:2278 grid, so on-site reads 0 and offsets
 * land in the expected feet range near Houston. */
import { describe, it, expect } from "vitest";
import {
  pointInRingFt, distPointSegFt, distPointToRingsFt, screenProximity, fmtDistFt, ringToGridFt,
  segmentsIntersectFt, distSegSegFt, distPathToRingsFt, featureDistFt,
} from "../src/workspaces/site-planner/lib/proximityScreen.js";

// ~0.01° square parcel near Katy, TX (same corner the siteAnalysis test uses).
const SQUARE = [[[-95.80, 29.78], [-95.79, 29.78], [-95.79, 29.79], [-95.80, 29.79], [-95.80, 29.78]]];

describe("pure feet geometry", () => {
  const ring = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }];
  it("pointInRingFt: inside vs outside", () => {
    expect(pointInRingFt({ x: 50, y: 50 }, ring)).toBe(true);
    expect(pointInRingFt({ x: 150, y: 50 }, ring)).toBe(false);
  });
  it("distPointSegFt: perpendicular + endpoint-clamped", () => {
    expect(distPointSegFt({ x: 50, y: 10 }, { x: 0, y: 0 }, { x: 100, y: 0 })).toBeCloseTo(10, 6);
    expect(distPointSegFt({ x: -30, y: 0 }, { x: 0, y: 0 }, { x: 100, y: 0 })).toBeCloseTo(30, 6);
  });
  it("distPointToRingsFt: 0 inside, else nearest edge", () => {
    expect(distPointToRingsFt({ x: 50, y: 50 }, [ring])).toBe(0);
    expect(distPointToRingsFt({ x: 130, y: 50 }, [ring])).toBeCloseTo(30, 6);
  });
});

describe("screenProximity — real projection distances", () => {
  it("a feature inside the parcel reads 0 ft (on/under the site)", () => {
    const r = screenProximity(SQUARE, [{ lngLat: [-95.795, 29.785], attrs: { NAME: "On-site tank" } }]);
    expect(r.count).toBe(1);
    expect(r.nearestFt).toBe(0);
    expect(r.nearest.attrs.NAME).toBe("On-site tank");
  });

  it("a feature ~0.01° east of the east edge lands ~3,000–3,300 ft away", () => {
    // 0.01° lon at ~29.78°N ≈ 966 m ≈ 3,170 ft.
    const r = screenProximity(SQUARE, [{ lngLat: [-95.78, 29.785], attrs: { NAME: "Nearby LPST" } }]);
    expect(r.nearestFt).toBeGreaterThan(2500);
    expect(r.nearestFt).toBeLessThan(3800);
  });

  it("ranks nearest-first and counts all valid features", () => {
    const r = screenProximity(SQUARE, [
      { lngLat: [-95.70, 29.785], attrs: { NAME: "Far" } },     // ~0.09° east — miles away
      { lngLat: [-95.795, 29.785], attrs: { NAME: "On-site" } }, // inside → 0
      { lngLat: [-95.78, 29.785], attrs: { NAME: "Near" } },     // ~3,170 ft
    ]);
    expect(r.count).toBe(3);
    expect(r.ranked.map((f) => f.attrs.NAME)).toEqual(["On-site", "Near", "Far"]);
    expect(r.ranked[2].distFt).toBeGreaterThan(20000); // the far one is miles out
  });

  it("skips features with missing/non-finite coordinates (never a phantom 0)", () => {
    const r = screenProximity(SQUARE, [
      { lngLat: null, attrs: { NAME: "no-geom" } },
      { lngLat: [NaN, 29.7], attrs: { NAME: "bad" } },
      { lngLat: [-95.78, 29.785], attrs: { NAME: "good" } },
    ]);
    expect(r.count).toBe(1);
    expect(r.nearest.attrs.NAME).toBe("good");
  });

  it("no parcel rings → no crash, features rank by Infinity", () => {
    const r = screenProximity([], [{ lngLat: [-95.78, 29.785], attrs: {} }]);
    expect(r.count).toBe(1);
    expect(r.nearestFt).toBe(Infinity);
  });
});

describe("line geometry (PHASE 3 faults / PHASE 6 rail)", () => {
  const ring = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }];
  it("segmentsIntersectFt: crossing vs parallel", () => {
    expect(segmentsIntersectFt({ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 5, y: -5 }, { x: 5, y: 5 })).toBe(true);
    expect(segmentsIntersectFt({ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 0, y: 5 }, { x: 10, y: 5 })).toBe(false);
  });
  it("distSegSegFt: 0 when crossing, else the gap", () => {
    expect(distSegSegFt({ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 5, y: -5 }, { x: 5, y: 5 })).toBe(0);
    expect(distSegSegFt({ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 0, y: 5 }, { x: 10, y: 5 })).toBeCloseTo(5, 6);
  });
  it("distPathToRingsFt: a line crossing the parcel is 0; a line outside is the gap", () => {
    expect(distPathToRingsFt([{ x: -10, y: 50 }, { x: 50, y: 50 }], [ring])).toBe(0); // enters the ring
    expect(distPathToRingsFt([{ x: 200, y: 50 }, { x: 300, y: 50 }], [ring])).toBeCloseTo(100, 6);
  });
  it("screenProximity ranks a fault LINE crossing the site at 0 ft; a nearby line by its gap", () => {
    const crossing = { paths: [[[-95.805, 29.785], [-95.785, 29.785]]], attrs: { Name: "LONG POINT FAULT" } }; // spans the parcel
    const nearby = { paths: [[[-95.785, 29.785], [-95.778, 29.785]]], attrs: { Name: "OTHER FAULT" } };          // east of the parcel
    const r = screenProximity(SQUARE, [nearby, crossing]);
    expect(r.count).toBe(2);
    expect(r.ranked[0].attrs.Name).toBe("LONG POINT FAULT");
    expect(r.nearestFt).toBe(0); // crosses the site
    expect(r.ranked[1].distFt).toBeGreaterThan(500); // the nearby one is offset
  });
  it("featureDistFt returns null for a feature with no usable geometry", () => {
    expect(featureDistFt({ attrs: {} }, [ringToGridFt(SQUARE[0])])).toBe(null);
  });
});

describe("fmtDistFt — screening distance strings", () => {
  it("on-site, feet, and miles bands", () => {
    expect(fmtDistFt(0)).toBe("on/under the site");
    expect(fmtDistFt(20)).toBe("on/under the site");
    expect(fmtDistFt(1200)).toMatch(/ft$/);
    expect(fmtDistFt(10560)).toBe("~2.0 mi");
    expect(fmtDistFt(null)).toBe("");
    expect(fmtDistFt(Infinity)).toBe("");
  });
  it("ringToGridFt projects a WGS84 ring to finite feet", () => {
    const g = ringToGridFt(SQUARE[0]);
    expect(g.length).toBe(5);
    expect(Number.isFinite(g[0].x) && Number.isFinite(g[0].y)).toBe(true);
  });
});
