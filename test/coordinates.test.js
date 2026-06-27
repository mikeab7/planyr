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
    // US survey foot (3937/1200), matching PROJECT_CRS us-ft — not the international foot (B57b).
    expect(FT_PER_M).toBeCloseTo(3937 / 1200, 9);
  });

  it("ftToAcres: 43,560 sf == 1 acre", () => {
    expect(ftToAcres(43560)).toBe(1);
    expect(ftToAcres(0)).toBe(0);
  });

  it("metersToFeet: 1 US survey foot (1200/3937 m) == 1 ft", () => {
    // The project grid is EPSG:2278 (us-ft), so metersToFeet uses the US survey foot (B57b).
    expect(metersToFeet(1200 / 3937)).toBeCloseTo(1, 9);
  });

  it("makePoint builds an {x,y} point", () => {
    expect(makePoint(3, 4)).toEqual({ x: 3, y: 4 });
  });

  // EPSG:2278 ↔ WGS84 — validated against pyproj (Transformer 2278→4326). The City of
  // Houston / HCFCD publish their service extents in this State-Plane frame, so the
  // coverage engine relies on this projection being right.
  describe("EPSG:2278 ↔ WGS84 projection", () => {
    it("gridToProject: State-Plane feet → lat/lon matches pyproj to <1e-4°", () => {
      // HCFCD fullExtent corners (ftUS) → Harris-County lat/lon (pyproj ground truth).
      const sw = gridToProject({ x: 2933015.36, y: 13740884.42 });
      expect(sw.lat).toBeCloseTo(29.497360, 4);
      expect(sw.lon).toBeCloseTo(-95.967511, 4);
      const ne = gridToProject({ x: 3265645.57, y: 13989597.88 });
      expect(ne.lat).toBeCloseTo(30.153088, 4);
      expect(ne.lon).toBeCloseTo(-94.895011, 4);
    });

    it("projectToGrid: downtown Houston lat/lon → State-Plane feet matches pyproj", () => {
      const g = projectToGrid(29.7604, -95.3698);
      expect(g.x).toBeCloseTo(3120099.088, 1);
      expect(g.y).toBeCloseTo(13841900.858, 1);
    });

    it("round-trips lat/lon → grid → lat/lon to sub-micro-degree", () => {
      const rt = gridToProject(projectToGrid(29.7604, -95.3698));
      expect(rt.lat).toBeCloseTo(29.7604, 8);
      expect(rt.lon).toBeCloseTo(-95.3698, 8);
    });

    it("still guards junk input (honest throw, never a silent wrong number)", () => {
      expect(() => projectToGrid(NaN, -95.4)).toThrow();
      expect(() => gridToProject({ x: undefined, y: 0 })).toThrow();
      expect(() => gridToProject()).toThrow();
    });
  });
});
