import { describe, it, expect } from "vitest";
import { isCacheableGisRequest, trimPlan, GIS_CACHE, MAX_ENTRIES } from "../src/workspaces/site-planner/lib/gisSwRules.js";

const APP = "https://planyr.io";

describe("isCacheableGisRequest", () => {
  it("caches cross-origin ArcGIS dynamic exports", () => {
    expect(isCacheableGisRequest("https://hazards.fema.gov/arcgis/rest/services/X/MapServer/export?bbox=1&f=image", APP)).toBe(true);
  });
  it("caches cross-origin ImageServer exportImage", () => {
    expect(isCacheableGisRequest("https://elevation.nationalmap.gov/arcgis/rest/services/3DEPElevation/ImageServer/exportImage?f=image", APP)).toBe(true);
  });
  it("caches ArcGIS cached map tiles", () => {
    expect(isCacheableGisRequest("https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/12/1620/963", APP)).toBe(true);
  });
  it("caches generic {z}/{y}/{x} tiles", () => {
    expect(isCacheableGisRequest("https://tiles.example.gov/layer/tile/10/500/300.png", APP)).toBe(true);
  });
  it("NEVER caches same-origin app assets (the safety rule)", () => {
    expect(isCacheableGisRequest("https://planyr.io/assets/SitePlannerApp-abc.js", APP)).toBe(false);
    expect(isCacheableGisRequest("https://planyr.io/MapServer/export", APP)).toBe(false); // even an export path, if same-origin
    expect(isCacheableGisRequest("https://planyr.io/api/mapillary?z=1", APP)).toBe(false);
    expect(isCacheableGisRequest("https://planyr.io/index.html", APP)).toBe(false);
  });
  it("ignores non-http(s) and unrelated cross-origin requests", () => {
    expect(isCacheableGisRequest("data:image/png;base64,AAAA", APP)).toBe(false);
    expect(isCacheableGisRequest("https://fonts.googleapis.com/css?family=X", APP)).toBe(false);
    expect(isCacheableGisRequest("https://supabase.co/rest/v1/sites", APP)).toBe(false);
    expect(isCacheableGisRequest("not a url", APP)).toBe(false);
  });
});

describe("trimPlan", () => {
  it("returns nothing under the cap", () => {
    expect(trimPlan(["a", "b"], 5)).toEqual([]);
  });
  it("drops the oldest beyond the cap (insertion order = oldest first)", () => {
    expect(trimPlan(["a", "b", "c", "d"], 2)).toEqual(["a", "b"]);
  });
  it("handles non-arrays defensively", () => {
    expect(trimPlan(null, 2)).toEqual([]);
  });
});

describe("cache identity", () => {
  it("exposes a versioned cache name + a modest cap", () => {
    expect(GIS_CACHE).toBe("planyr-gis-v1");
    expect(MAX_ENTRIES).toBeGreaterThan(0);
  });
});
