/* basemapsShared — NEW-1 (Food map). "The Site Plan map" is defined ONCE (src/shared/basemaps) and
 * /food, the map finder and the planner all read it from there. These tests fail if anyone re-inlines
 * a copy, break the Hybrid layer stack, or break the remembered-choice default. */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  BASEMAPS, ROAD_NAMES_TILES, PLACE_NAMES_TILES, SITE_PLAN_BASEMAP, HYBRID_BASEMAP,
  SITE_PLAN_BASEMAP_CHOICES, resolveBasemapChoice, basemapTileLayers, basemapAttribution,
} from "../src/shared/basemaps/basemaps.js";
import * as plannerReexport from "../src/workspaces/site-planner/lib/basemaps.js";

const read = (rel) => readFileSync(join(__dirname, "..", rel), "utf8");
const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

describe("one definition of the Site Plan map", () => {
  it("the planner's basemaps module is a pure re-export — the SAME objects, not copies", () => {
    expect(plannerReexport.BASEMAPS).toBe(BASEMAPS);
    expect(plannerReexport.SITE_PLAN_BASEMAP).toBe(SITE_PLAN_BASEMAP);
    expect(stripComments(read("src/workspaces/site-planner/lib/basemaps.js")).trim()).toMatch(/^export \* from "\.\.\/\.\.\/\.\.\/shared\/basemaps\/basemaps\.js";$/);
  });

  it("Food's default IS the shared Site Plan object (identity), and its imagery is the planner's own BASEMAPS entry", () => {
    expect(SITE_PLAN_BASEMAP_CHOICES[0]).toBe(SITE_PLAN_BASEMAP);
    expect(SITE_PLAN_BASEMAP.imagery).toBe(BASEMAPS[SITE_PLAN_BASEMAP.imageryKey]);
    expect(resolveBasemapChoice(undefined)).toBe(SITE_PLAN_BASEMAP); // new user
    expect(resolveBasemapChoice("garbage")).toBe(SITE_PLAN_BASEMAP);
  });

  it("FoodMap imports the shared module and holds no tile URL of its own", () => {
    const code = stripComments(read("src/workspaces/food/components/FoodMap.jsx"));
    expect(code).toMatch(/from "\.\.\/\.\.\/\.\.\/shared\/basemaps\/basemaps\.js"/);
    expect(code).not.toMatch(/arcgisonline|nationalmap\.gov|cartocdn|openstreetmap/);
  });

  it("the map finder and planner take their defaults from the shared object, with no re-inlined road-names URL", () => {
    const finder = stripComments(read("src/workspaces/site-planner/MapFinder.jsx"));
    expect(finder).not.toMatch(/arcgisonline/);
    expect(finder).toMatch(/ROAD_NAMES_TILES\.url/);
    expect(finder).toMatch(/useState\(SITE_PLAN_BASEMAP\.imageryKey\)/);
    expect(stripComments(read("src/workspaces/site-planner/SitePlanner.jsx"))).toMatch(/SITE_PLAN_BASEMAP\.imageryKey/);
  });
});

describe("layer stacks", () => {
  it("Site Plan = imagery + road names (the planner's default opacity), nothing more", () => {
    const l = basemapTileLayers(SITE_PLAN_BASEMAP);
    expect(l.map((x) => x.id)).toEqual(["imagery", "roads"]);
    expect(l[0].url).toBe(BASEMAPS.esri.tiles);
    expect(l[1].url).toBe(ROAD_NAMES_TILES.url);
    expect(l[1].opts.opacity).toBe(ROAD_NAMES_TILES.defaultOpacity);
  });

  it("Hybrid = imagery + road names + place names, labels at full strength, stacked in that order", () => {
    const l = basemapTileLayers(HYBRID_BASEMAP);
    expect(l.map((x) => x.id)).toEqual(["imagery", "roads", "places"]);
    expect(l[2].url).toBe(PLACE_NAMES_TILES.url);
    expect(l[1].opts.opacity).toBe(1);
    expect(l[2].opts.opacity).toBe(1);
    expect(l.map((x) => x.opts.zIndex)).toEqual([1, 2, 3]);
  });

  it("every layer: Esri {z}/{y}/{x} axis order, no `subdomains` key, imagery clamped to its native ceiling (B634981 / B220)", () => {
    for (const c of SITE_PLAN_BASEMAP_CHOICES) {
      for (const layer of basemapTileLayers(c)) {
        expect(layer.url).toMatch(/\/tile\/\{z\}\/\{y\}\/\{x\}$/);
        expect("subdomains" in layer.opts).toBe(false);
        expect(layer.opts.maxNativeZoom).toBeGreaterThan(0);
      }
      expect(basemapTileLayers(c)[0].opts.maxNativeZoom).toBe(BASEMAPS.esri.maxNative);
    }
  });

  it("the offered choices are exactly Site Plan and Hybrid, and each has a correct Esri credit", () => {
    expect(SITE_PLAN_BASEMAP_CHOICES.map((c) => c.key)).toEqual(["siteplan", "hybrid"]);
    for (const c of SITE_PLAN_BASEMAP_CHOICES) expect(basemapAttribution(c)).toContain("Esri");
    expect(basemapAttribution(HYBRID_BASEMAP)).toContain("Labels");
  });
});
