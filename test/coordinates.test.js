import { describe, it, expect } from "vitest";
import {
  PROJECT_CRS, FT_PER_M, SQFT_PER_ACRE,
  makePoint, ftToAcres, metersToFeet,
  projectToGrid, gridToProject,
} from "../src/shared/coordinates/index.js";

// The shared coordinate spine is what lets a deed polygon, a takeoff, and the site
// layout share one real-world frame. Lock its constants and the honesty of its stubs.
describe("shared/coordinates (cross-workspace spine)", () => {
  it("pins the project CRS to EPSG:2278 (TX South Central, US survey feet)", () => {
    expect(PROJECT_CRS.epsg).toBe(2278);
    expect(PROJECT_CRS.unit).toBe("us-ft");
  });

  it("carries the right unit constants", () => {
    expect(SQFT_PER_ACRE).toBe(43560);
    expect(FT_PER_M).toBeCloseTo(3.280839895, 6);
  });

  it("ftToAcres: 43,560 sf == 1 acre", () => {
    expect(ftToAcres(43560)).toBe(1);
    expect(ftToAcres(0)).toBe(0);
  });

  it("metersToFeet: 0.3048 m == 1 ft", () => {
    expect(metersToFeet(0.3048)).toBeCloseTo(1, 9);
  });

  it("makePoint builds an {x,y} point", () => {
    expect(makePoint(3, 4)).toEqual({ x: 3, y: 4 });
  });

  it("the unimplemented projections are honest stubs — they THROW, never return a wrong number", () => {
    expect(() => projectToGrid(29.7, -95.4)).toThrow();
    expect(() => gridToProject({ x: 0, y: 0 })).toThrow();
  });
});
