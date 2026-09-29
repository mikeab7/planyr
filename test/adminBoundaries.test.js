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
import { PARCEL_MINZOOM } from "../src/workspaces/site-planner/lib/parcelDisplayZoom.js";
import {
  ADMIN1_MIN_ZOOM,
  ADMIN1_DETAIL_MIN_ZOOM,
  COUNTRY_MAX_ZOOM,
  admin1Style,
  adminBoundaryLevels as levelsAt,
  decodeRing,
  decodeAsset,
} from "../src/workspaces/site-planner/lib/adminBoundaryData.js";

const adminBoundaryLevels = (z) => levelsAt(z, ADMIN_BOUNDARY_MAX_ZOOM);

const here = dirname(fileURLToPath(import.meta.url));
const asset = JSON.parse(readFileSync(resolve(here, "../public/geo/admin-boundaries.json"), "utf8"));

describe("NEW-1 · the boundary band (revised 2026-09-29: states survive to zoom 12)", () => {
  it("shows nothing once parcels and site work own the screen (13+)", () => {
    for (const z of [13, 14, 15, 17, 19, 21]) {
      expect(adminBoundaryLevels(z)).toEqual({ country: false, admin1: false, detail: false });
      expect(adminBoundariesVisible(z)).toBe(false);
    }
  });

  it("keeps STATE outlines on through zoom 12 inclusive — the owner ask (fails on the old band, which ended at 7)", () => {
    for (const z of [5, 6, 7, 8, 9, 10, 11, 12]) {
      expect(adminBoundaryLevels(z).admin1).toBe(true);
      expect(adminBoundariesVisible(z)).toBe(true);
    }
    expect(ADMIN_BOUNDARY_MAX_ZOOM).toBe(12);
  });

  it("leaves the COUNTRY band exactly as it was: through zoom 7, off from 8", () => {
    for (const z of [3, 4, 5, 6, 7]) expect(adminBoundaryLevels(z).country).toBe(true);
    for (const z of [8, 9, 12]) expect(adminBoundaryLevels(z).country).toBe(false);
    expect(COUNTRY_MAX_ZOOM).toBe(7);
  });

  it("states join the countries only once they can resolve (5), and use the fine geometry from 8", () => {
    expect(adminBoundaryLevels(3)).toEqual({ country: true, admin1: false, detail: false });
    expect(adminBoundaryLevels(4)).toEqual({ country: true, admin1: false, detail: false });
    expect(adminBoundaryLevels(5)).toEqual({ country: true, admin1: true, detail: false });
    expect(adminBoundaryLevels(7)).toEqual({ country: true, admin1: true, detail: false });
    expect(adminBoundaryLevels(8)).toEqual({ country: false, admin1: true, detail: true });
    expect(adminBoundaryLevels(12)).toEqual({ country: false, admin1: true, detail: true });
    expect(ADMIN1_MIN_ZOOM).toBeGreaterThan(3);
    expect(ADMIN1_DETAIL_MIN_ZOOM).toBe(COUNTRY_MAX_ZOOM + 1);
  });

  it("ends one zoom before parcels draw, so the line never shares a screen with site work", () => {
    expect(ADMIN_BOUNDARY_MAX_ZOOM).toBe(PARCEL_MINZOOM - 2);
    expect(adminBoundariesVisible(PARCEL_MINZOOM - 1)).toBe(false);
  });

  it("treats a not-yet-reported zoom as 'nothing', never as zoom 0", () => {
    for (const z of [null, undefined, NaN]) {
      expect(adminBoundariesVisible(z)).toBe(false);
      expect(adminBoundaryLevels(z, ADMIN_BOUNDARY_MAX_ZOOM).admin1).toBe(false);
    }
  });
});

describe("NEW-1 · the state line steps back as it survives into closer zooms", () => {
  it("is quieter (fainter AND thinner) at 10-12 than at 8-9, and than the wide zooms", () => {
    const wide = admin1Style(6), mid = admin1Style(8), near = admin1Style(11);
    expect(mid.line.opacity).toBeLessThan(wide.line.opacity);
    expect(near.line.opacity).toBeLessThan(mid.line.opacity);
    expect(near.casing.opacity).toBeLessThan(mid.casing.opacity);
    expect(near.line.weight).toBeLessThan(mid.line.weight);
    expect(admin1Style(12)).toEqual(admin1Style(10));
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

describe("NEW-1 · the close-zoom (1:10m) state asset", () => {
  const detail = JSON.parse(readFileSync(resolve(here, "../public/geo/admin1-detail.json"), "utf8"));
  const lines = decodeAsset(detail).admin1;
  const pts = lines.flat();

  it("is present, US-only, and small enough to fetch lazily", () => {
    expect(detail.format).toBe("planyr-admin-boundaries-v1");
    expect(lines.length).toBeGreaterThan(50);
    expect(JSON.stringify(detail).length).toBeLessThan(150 * 1024);
  });

  it("keeps real borders — the Sabine (TX/LA) and the Red River (TX/OK) are present", () => {
    const near = (lat, lng, tol = 0.15) => pts.some(([la, lo]) => Math.abs(la - lat) < tol && Math.abs(lo - lng) < tol);
    expect(near(31.0, -93.55)).toBe(true); // Sabine River, TX/LA
    expect(near(33.9, -97.0, 0.3)).toBe(true); // Red River, TX/OK
  });

  it("does NOT draw the Gulf coast as a state line (a 1:10m shoreline would cut through the bay)", () => {
    const gulf = pts.filter(([la, lo]) => la < 29.7 && la > 26 && lo < -93.9 && lo > -97.5);
    expect(gulf.length).toBe(0);
  });
});
