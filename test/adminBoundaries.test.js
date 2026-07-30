/* NEW-1 — the pure halves of the wide-zoom state/country boundary layer.
 *
 * Two things are worth testing without a browser: the ZOOM BAND (the LOD rule that
 * decides what belongs on screen) and the DECODER (the exact inverse of the build
 * script's delta encoding). The rendering itself is asserted on the real page by
 * ui-audit/verify-admin-boundaries.mjs, because "is it actually drawn" is a question
 * static tests cannot answer — the B1127 lesson.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { ADMIN_BOUNDARY_MAX_ZOOM, adminBoundariesVisible } from "../src/workspaces/site-planner/lib/adminBoundaryGate.js";
import {
  ADMIN1_MIN_ZOOM,
  adminBoundaryLevels as levelsAt,
  decodeRing,
  decodeAsset,
} from "../src/workspaces/site-planner/lib/adminBoundaryData.js";

const adminBoundaryLevels = (z) => levelsAt(z, ADMIN_BOUNDARY_MAX_ZOOM);

const here = dirname(fileURLToPath(import.meta.url));
const asset = JSON.parse(readFileSync(resolve(here, "../public/geo/admin-boundaries.json"), "utf8"));

describe("NEW-1 · the wide-zoom boundary band", () => {
  it("shows nothing at site working zoom — the whole point of the gate", () => {
    for (const z of [8, 10, 14, 15, 17, 19, 21]) {
      expect(adminBoundaryLevels(z)).toEqual({ country: false, admin1: false });
      expect(adminBoundariesVisible(z)).toBe(false);
    }
  });

  it("shows countries across the whole wide band, states only once they can resolve", () => {
    expect(adminBoundaryLevels(3)).toEqual({ country: true, admin1: false });
    expect(adminBoundaryLevels(4)).toEqual({ country: true, admin1: false });
    expect(adminBoundaryLevels(5)).toEqual({ country: true, admin1: true });
    expect(adminBoundaryLevels(7)).toEqual({ country: true, admin1: true });
  });

  it("closes the band exactly at the OLD zoom floor, so nothing new appears at any zoom that was already reachable", () => {
    // B1102/NEW-6 lowered the map's minZoom from 8 to 3. Everything z8+ was reachable
    // before this feature and must look exactly as it did.
    expect(ADMIN_BOUNDARY_MAX_ZOOM).toBe(7);
    expect(adminBoundariesVisible(8)).toBe(false);
    expect(ADMIN1_MIN_ZOOM).toBeGreaterThan(3);
    expect(ADMIN1_MIN_ZOOM).toBeLessThanOrEqual(ADMIN_BOUNDARY_MAX_ZOOM);
  });

  it("treats a not-yet-reported zoom as 'nothing', never as zoom 0", () => {
    for (const z of [null, undefined, NaN]) {
      // NaN is a number but no comparison against it is true, so it also reads as off.
      expect(adminBoundariesVisible(z)).toBe(false);
    }
  });
});

describe("NEW-1 · the delta decoder", () => {
  it("is the exact inverse of the build script's encoding", () => {
    // [x0,y0, dx,dy, …] at 1000 units per degree → [lat, lng] pairs.
    expect(decodeRing([-95123, 29456, 1000, -500, -250, 250], 1000)).toEqual([
      [29.456, -95.123],
      [28.956, -94.123],
      [29.206, -94.373],
    ]);
  });

  it("decodes a single-point ring without inventing a second point", () => {
    expect(decodeRing([1000, 2000], 1000)).toEqual([[2, 1]]);
  });

  it("defaults the scale rather than producing NaN coordinates for a scale-less doc", () => {
    const out = decodeAsset({ levels: { country: [[1000, 2000, 0, 1000]] } });
    expect(out.country[0]).toEqual([[2, 1], [3, 1]]);
  });
});

describe("NEW-1 · the committed boundary asset", () => {
  it("carries both admin levels", () => {
    expect(asset.format).toBe("planyr-admin-boundaries-v1");
    expect(asset.levels.country.length).toBeGreaterThan(150);
    expect(asset.levels.admin1.length).toBeGreaterThan(45);
  });

  it("stays small enough to be furniture — it is fetched on a zoom-out, not a boot", () => {
    // A ceiling, not a measurement: this is the whole reason for the simplification +
    // delta encoding. Growing past it means re-simplifying, not raising the number.
    expect(JSON.stringify(asset).length).toBeLessThan(150 * 1024);
  });

  it("decodes to plausible geography — Texas and Colorado both fall inside a US state ring", () => {
    const rings = decodeAsset(asset).admin1;
    const inside = (lat, lng) => rings.some((ring) => {
      let hit = false;
      for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const [yi, xi] = ring[i], [yj, xj] = ring[j];
        if ((yi > lat) !== (yj > lat) && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) hit = !hit;
      }
      return hit;
    });
    expect(inside(29.76, -95.37)).toBe(true);  // Houston, Texas
    expect(inside(39.74, -104.99)).toBe(true); // Denver, Colorado
    expect(inside(19.43, -99.13)).toBe(false); // Mexico City — admin-1 is US-only at 1:110m
  });

  it("keeps Mexico and Canada readable at the COUNTRY level, since 1:110m has no provinces for them", () => {
    const rings = decodeAsset(asset).country;
    const spanning = (latLo, latHi, lngLo, lngHi) =>
      rings.some((r) => r.some(([lat, lng]) => lat > latLo && lat < latHi && lng > lngLo && lng < lngHi));
    expect(spanning(15, 32, -117, -87)).toBe(true); // Mexico
    expect(spanning(49, 70, -140, -60)).toBe(true); // Canada
  });
});
