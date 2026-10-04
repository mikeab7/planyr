/* basemapsShared — NEW-1 (Food map). "The Site Plan map" is defined ONCE (src/shared/basemaps) and
 * /food, the map finder and the planner all read it from there. These tests fail if anyone re-inlines
 * a copy, break the Hybrid layer stack, or break the remembered-choice default. */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  BASEMAPS, SITE_PLAN_BASEMAP, HYBRID_BASEMAP, VECTOR_SOURCE, IMAGERY_GRADE, densityTileOptions,
  SATELLITE_BASEMAP, FOOD_BASEMAP_CHOICES, resolveBasemapChoice, basemapTileLayers, basemapAttribution,
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

  it("Food's default is Satellite, and its imagery IS the Site Plan map's imagery object (one source for the photo)", () => {
    expect(FOOD_BASEMAP_CHOICES[0]).toBe(SATELLITE_BASEMAP);
    expect(SITE_PLAN_BASEMAP.imagery).toBe(BASEMAPS[SITE_PLAN_BASEMAP.imageryKey]);
    expect(SATELLITE_BASEMAP.imagery).toBe(SITE_PLAN_BASEMAP.imagery);
    expect(SATELLITE_BASEMAP.imageryKey).toBe(SITE_PLAN_BASEMAP.imageryKey);
    expect(SATELLITE_BASEMAP.graded).toBe(SITE_PLAN_BASEMAP.graded);
    expect(resolveBasemapChoice(undefined)).toBe(SATELLITE_BASEMAP); // new user
    expect(resolveBasemapChoice("garbage")).toBe(SATELLITE_BASEMAP);
  });

  it("FoodMap imports the shared module and holds no tile URL of its own", () => {
    const code = stripComments(read("src/workspaces/food/components/FoodMap.jsx"));
    expect(code).toMatch(/from "\.\.\/\.\.\/\.\.\/shared\/basemaps\/basemaps\.js"/);
    expect(code).not.toMatch(/arcgisonline|nationalmap\.gov|cartocdn|openstreetmap/);
  });

  it("the map finder and planner take their defaults from the shared object, with no re-inlined tile URL", () => {
    const finder = stripComments(read("src/workspaces/site-planner/MapFinder.jsx"));
    expect(finder).not.toMatch(/arcgisonline|openfreemap/);
    expect(finder).toMatch(/addVectorLabels\(/);
    expect(finder).toMatch(/useState\(SITE_PLAN_BASEMAP\.imageryKey\)/);
    expect(stripComments(read("src/workspaces/site-planner/SitePlanner.jsx"))).toMatch(/SITE_PLAN_BASEMAP\.imageryKey/);
  });

  it("Food and the map finder use the SAME vector-label helper (never a Food-only copy)", () => {
    const food = stripComments(read("src/workspaces/food/components/FoodMap.jsx"));
    const finder = stripComments(read("src/workspaces/site-planner/MapFinder.jsx"));
    for (const code of [food, finder]) expect(code).toMatch(/(from |import\()"(\.\.\/)+shared\/basemaps\/vectorLabelLayer\.js"/);
    expect(food).not.toMatch(/maplibre|buildVectorStyle/);
  });

  it("Food's DEFAULT is Satellite; Hybrid is the second option; a legacy stored \"siteplan\" (and any junk) migrates to Satellite", () => {
    expect(FOOD_BASEMAP_CHOICES[0]).toBe(SATELLITE_BASEMAP);
    expect(FOOD_BASEMAP_CHOICES[1]).toBe(HYBRID_BASEMAP);
    expect(resolveBasemapChoice("siteplan")).toBe(SATELLITE_BASEMAP);
    expect(resolveBasemapChoice("siteplan").key).toBe("satellite");
    expect(resolveBasemapChoice("satellite")).toBe(SATELLITE_BASEMAP);
    expect(resolveBasemapChoice("hybrid")).toBe(HYBRID_BASEMAP);
    expect(resolveBasemapChoice(null)).toBe(SATELLITE_BASEMAP);
  });
});

describe("layer stacks", () => {
  it("Satellite = UNGRADED imagery and NO road/label layer of any kind; Hybrid = graded imagery + the vector roads/labels", () => {
    const sp = basemapTileLayers(SATELLITE_BASEMAP), hy = basemapTileLayers(HYBRID_BASEMAP);
    for (const l of [sp, hy]) { expect(l.map((x) => x.id)).toEqual(["imagery"]); expect(l[0].url).toBe(BASEMAPS.esri.tiles); }
    expect("className" in sp[0].opts).toBe(false);
    expect(hy[0].opts.className).toBe(IMAGERY_GRADE.className);
    // Satellite: zero road/label layers — no vector source, no vector mode, no raster overlay.
    expect(SATELLITE_BASEMAP.vector).toBeNull();
    expect(SATELLITE_BASEMAP.vectorMode).toBeNull();
    expect(sp).toHaveLength(1);
    expect(sp.some((x) => /Transportation|Boundaries_and_Places|Reference/.test(x.url))).toBe(false);
    // Hybrid keeps the vector roads/labels.
    expect(HYBRID_BASEMAP.vector).toBe(VECTOR_SOURCE);
    // The Site tab's own definition is untouched.
    expect(SITE_PLAN_BASEMAP.vector).toBe(VECTOR_SOURCE);
    expect(HYBRID_BASEMAP.vector).toBe(VECTOR_SOURCE);
    expect(SITE_PLAN_BASEMAP.vectorMode).toBe("site");
    expect(HYBRID_BASEMAP.vectorMode).toBe("hybrid");
  });

  it("imagery is HIGH DENSITY at dpr 2 (one zoom deeper, ceiling-1) and plain at dpr 1", () => {
    expect(densityTileOptions(19, 2)).toEqual({ detectRetina: true, maxNativeZoom: 18 });
    expect(densityTileOptions(19, 3)).toEqual({ detectRetina: true, maxNativeZoom: 18 });
    expect(densityTileOptions(19, 1)).toEqual({ detectRetina: false, maxNativeZoom: 19 });
    const hi = basemapTileLayers(SATELLITE_BASEMAP, { dpr: 2 })[0].opts;
    expect(hi.detectRetina).toBe(true);
    expect(hi.maxNativeZoom).toBe(BASEMAPS.esri.maxNative - 1);
    expect(basemapTileLayers(HYBRID_BASEMAP)[0].opts.detectRetina).toBe(false);
  });

  it("every layer: Esri {z}/{y}/{x} axis order, no `subdomains` key (B634981 / B220)", () => {
    for (const c of FOOD_BASEMAP_CHOICES) {
      for (const layer of basemapTileLayers(c)) {
        expect(layer.url).toMatch(/\/tile\/\{z\}\/\{y\}\/\{x\}$/);
        expect("subdomains" in layer.opts).toBe(false);
      }
    }
  });

  it("the offered choices are exactly Satellite (default) then Hybrid, each with its own credit", () => {
    expect(FOOD_BASEMAP_CHOICES.map((c) => c.key)).toEqual(["satellite", "hybrid"]);
    expect(FOOD_BASEMAP_CHOICES.map((c) => c.label)).toEqual(["Satellite", "Hybrid"]);
    // Satellite: the imagery credit only (no vector source drawn → no OpenFreeMap credit). Hybrid: both.
    expect(basemapAttribution(SATELLITE_BASEMAP)).toBe(BASEMAPS.esri.attr);
    expect(basemapAttribution(SATELLITE_BASEMAP)).not.toContain("OpenFreeMap");
    expect(basemapAttribution(HYBRID_BASEMAP)).toContain(BASEMAPS.esri.attr);
    expect(basemapAttribution(HYBRID_BASEMAP)).toContain("OpenFreeMap");
  });

  it("the export path never sees the grade: exportSheet imports no grade/vector module", () => {
    const code = stripComments(read("src/workspaces/site-planner/lib/exportSheet.js"));
    expect(code).not.toMatch(/IMAGERY_GRADE|planyr-imagery-graded|vectorLabelLayer/);
  });
});
