import { describe, it, expect } from "vitest";
import {
  solveDeedAlignment, gridConvergenceDeg, rotatePointsAbout,
  ringCentroid, describeRotation, CONFIDENT_FRAC,
} from "../src/workspaces/site-planner/lib/deedAlign.js";
import { projectToGrid } from "../src/shared/coordinates/index.js";

const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const FT_PER_DEG_LAT = 365223; // matches arcgis.js local model

// A deliberately NON-symmetric boundary so its rotation is unambiguous (a symmetric
// rectangle would fit equally at 0/90/180/270). Feet, planner frame (north up).
const PARCEL = [
  { x: 0, y: 0 }, { x: 1000, y: 0 }, { x: 1000, y: 600 },
  { x: 400, y: 600 }, { x: 400, y: 1500 }, { x: 0, y: 1500 },
];

describe("deedAlign — empirical fit to the county parcel (basis-of-bearings fix)", () => {
  it("recovers a known rotation + translation and lands the deed on the parcel", () => {
    const pivot = ringCentroid(PARCEL);
    // A deed mis-plotted by the ~1.55° grid-vs-true rotation, then dropped 250'E / 370'N off.
    const deed = rotatePointsAbout(PARCEL, -1.55, pivot).map((p) => ({ x: p.x + 250, y: p.y - 370 }));
    const fit = solveDeedAlignment(deed, PARCEL);
    expect(fit.ok).toBe(true);
    expect(fit.residualFt).toBeLessThan(0.5);
    expect(fit.confident).toBe(true);
    // rotation that lands the deed on the parcel is +1.55° (undoes the −1.55° mis-plot)
    expect(Math.abs(fit.rotDeg - 1.55)).toBeLessThan(0.1);
    // applying the fit overlays every vertex on the parcel
    const moved = deed.map(fit.apply);
    for (let i = 0; i < PARCEL.length; i++) expect(dist(moved[i], PARCEL[i])).toBeLessThan(1);
  });

  it("is RIGID — it never scales the deed to a differently-sized parcel", () => {
    // Deed 20% smaller than the parcel (e.g. a record vs GIS size difference).
    const deed = PARCEL.map((p) => ({ x: p.x * 0.8, y: p.y * 0.8 }));
    const fit = solveDeedAlignment(deed, PARCEL);
    const moved = deed.map(fit.apply);
    // the 800' deed edge stays 800' after the fit — NOT rubber-sheeted up to the parcel's 1000'
    expect(Math.abs(dist(moved[0], moved[1]) - 800)).toBeLessThan(1);
    // and a genuine shape/size mismatch is reported (not silently "confident")
    expect(fit.residualFt).toBeGreaterThan(10);
  });

  it("handles a reversed winding (deed digitized the opposite way round)", () => {
    const pivot = ringCentroid(PARCEL);
    const reversed = [...PARCEL].reverse();
    const deed = rotatePointsAbout(reversed, 1.0, pivot);
    const fit = solveDeedAlignment(deed, PARCEL);
    expect(fit.residualFt).toBeLessThan(1);
  });

  it("returns ok:false when a ring is too small to form a shape", () => {
    expect(solveDeedAlignment([{ x: 0, y: 0 }, { x: 1, y: 1 }], PARCEL).ok).toBe(false);
    expect(solveDeedAlignment(PARCEL, [{ x: 0, y: 0 }]).ok).toBe(false);
  });
});

describe("deedAlign — grid convergence (no-parcel theoretical fallback)", () => {
  it("computes Texas grid convergence (~+1.5°, grid north EAST of true north) at Katy", () => {
    const c = gridConvergenceDeg(29.80, -95.83);
    expect(c).toBeGreaterThan(1.4);
    expect(c).toBeLessThan(1.7);
  });

  it("vanishes on the zone's central meridian (99°W) and flips sign west of it", () => {
    expect(Math.abs(gridConvergenceDeg(29.80, -99.0))).toBeLessThan(0.02);
    expect(gridConvergenceDeg(29.80, -101.5)).toBeLessThan(0);
  });

  it("sign is consistent with the projection: a true-north line reads −convergence in grid", () => {
    const lat = 29.80, lon = -95.83;
    const A = projectToGrid(lat, lon);
    const B = projectToGrid(lat + 1000 / FT_PER_DEG_LAT, lon); // 1000 ft due TRUE north
    const gridAz = (Math.atan2(B.x - A.x, B.y - A.y) * 180) / Math.PI; // clockwise from grid north
    expect(Math.abs(gridAz + gridConvergenceDeg(lat, lon))).toBeLessThan(0.05);
  });

  it("returns 0 for non-finite input rather than throwing", () => {
    expect(gridConvergenceDeg(NaN, -95.8)).toBe(0);
    expect(gridConvergenceDeg(29.8, undefined)).toBe(0);
  });
});

describe("deedAlign — plain-language read-out", () => {
  it("names the rotation direction for the honest message", () => {
    expect(describeRotation(1.55)).toMatch(/clockwise/);
    expect(describeRotation(-1.55)).toMatch(/counter-clockwise/);
    expect(describeRotation(0)).toMatch(/already aligned/);
  });
  it("exports a sane confidence floor", () => {
    expect(CONFIDENT_FRAC).toBeGreaterThan(0);
    expect(CONFIDENT_FRAC).toBeLessThan(0.1);
  });
});
