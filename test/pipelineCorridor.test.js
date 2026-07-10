import { describe, it, expect } from "vitest";
import {
  corridorRingLngLat, corridorRings,
  DEFAULT_CORRIDOR_WIDTH_FT, MIN_CORRIDOR_WIDTH_FT, MAX_CORRIDOR_WIDTH_FT,
} from "../src/workspaces/site-planner/lib/pipelineCorridor.js";

const FT_PER_DEG_LAT = 364567;

describe("corridorRingLngLat — buffer a lon/lat centerline into a [lon,lat] strip ring", () => {
  it("returns null for a degenerate path or non-positive width (honest omission, never a sliver)", () => {
    expect(corridorRingLngLat([], 50)).toBeNull();
    expect(corridorRingLngLat([[-95, 29.7]], 50)).toBeNull(); // one point
    expect(corridorRingLngLat([[-95, 29.7], [-94.99, 29.7]], 0)).toBeNull();
    expect(corridorRingLngLat([[-95, 29.7], [-94.99, 29.7]], -10)).toBeNull();
    expect(corridorRingLngLat([[NaN, 29.7], [-94.99, 29.7]], 50)).toBeNull(); // < 2 finite vertices
  });

  it("offsets an east-west segment ±half-width in LATITUDE (feet → degrees), leaving longitude put", () => {
    const lat = 29.76, lon0 = -95.37, lon1 = -95.36;
    const ring = corridorRingLngLat([[lon0, lat], [lon1, lat]], 50);
    expect(ring).toBeTruthy();
    expect(ring.length).toBe(4); // flat-capped strip: left(2) + right(2)
    const lats = ring.map((p) => p[1]);
    const halfDeg = 25 / FT_PER_DEG_LAT; // 25 ft each side
    expect(Math.max(...lats) - lat).toBeCloseTo(halfDeg, 6);
    expect(lat - Math.min(...lats)).toBeCloseTo(halfDeg, 6);
    // longitude unchanged (only stays within the two endpoints)
    for (const [lon] of ring) expect(lon).toBeGreaterThanOrEqual(Math.min(lon0, lon1) - 1e-9);
  });

  it("wider width → proportionally wider band", () => {
    const path = [[-95.37, 29.76], [-95.36, 29.76]];
    const narrow = corridorRingLngLat(path, 50).map((p) => p[1]);
    const wide = corridorRingLngLat(path, 100).map((p) => p[1]);
    const spanN = Math.max(...narrow) - Math.min(...narrow);
    const spanW = Math.max(...wide) - Math.min(...wide);
    expect(spanW / spanN).toBeCloseTo(2, 3);
  });
});

describe("corridorRings — many centerlines at one width", () => {
  it("one ring per bufferable path; degenerate parts skipped", () => {
    const rings = corridorRings([
      [[-95.37, 29.76], [-95.36, 29.76]],
      [[-95.30, 29.70]],                 // one point → skipped
      [[-95.20, 29.60], [-95.19, 29.61]],
    ], 50);
    expect(rings.length).toBe(2);
  });
  it("empty / nullish input → empty array", () => {
    expect(corridorRings(null, 50)).toEqual([]);
    expect(corridorRings([], 50)).toEqual([]);
  });
});

describe("width defaults + bounds", () => {
  it("ships a conservative 50 ft default within the editable bounds", () => {
    expect(DEFAULT_CORRIDOR_WIDTH_FT).toBe(50);
    expect(MIN_CORRIDOR_WIDTH_FT).toBeLessThan(DEFAULT_CORRIDOR_WIDTH_FT);
    expect(MAX_CORRIDOR_WIDTH_FT).toBeGreaterThan(DEFAULT_CORRIDOR_WIDTH_FT);
  });
});
