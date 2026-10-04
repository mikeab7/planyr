/* siteStackParity — NEW-1 amendment (B2018608). /food's DEFAULT option and the Site tab's browse map must
 * show the SAME layers at every zoom — same stack, same zoom gating — because both read one pure
 * `siteStack(zoom)`. Owner, on two phone screenshots at one metro zoom over Houston: Site = satellite + clean
 * city names, no road lines; /food = edge-to-edge thick road bands. "I don't understand why they differ."
 * Source guards below fail if either surface grows a private gate again. */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { siteStack, SITE_PLAN_BASEMAP, SITE_ROADS_FROM, resolveBasemapChoice } from "../src/shared/basemaps/basemaps.js";
import { placeNamesVisible } from "../src/shared/basemaps/placeNamesGate.js";

const read = (rel) => readFileSync(join(__dirname, "..", rel), "utf8");
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

describe("the visible layer set, by zoom", () => {
  it("METRO zoom (10-12): imagery + Planyr's city names, and NO road lines — the Site tab's look", () => {
    for (const z of [10, 11, 12]) expect(siteStack(z)).toEqual(["imagery", "cityNames"]);
  });
  it("NEIGHBOURHOOD zoom (15-17): imagery + road lines/names, city names gone (parcel zoom owns the screen)", () => {
    for (const z of [15, 16, 17]) expect(siteStack(z)).toEqual(["imagery", "roadNames"]);
  });
  it("the gates are the Site map's own: city names = placeNamesVisible, roads from SITE_ROADS_FROM (14)", () => {
    expect(SITE_ROADS_FROM).toBe(14);
    for (let z = 0; z <= 21; z++) {
      const s = siteStack(z);
      expect(s.includes("cityNames")).toBe(placeNamesVisible(z));
      expect(s.includes("roadNames")).toBe(z >= SITE_ROADS_FROM);
    }
  });
  it("the Site Layers panel toggles still switch each row off", () => {
    expect(siteStack(11, { cityNames: false })).toEqual(["imagery"]);
    expect(siteStack(16, { roads: false })).toEqual(["imagery"]);
  });
  it("an unknown zoom (map not yet reporting one) reads as nothing yet, never as zoom 0", () => {
    expect(siteStack(null)).toEqual(["imagery"]);
  });
});

describe("both surfaces read the one stack", () => {
  it("/food no longer mirrors the Site stack (B2070433): its default is Satellite, photo only; the Site Plan definition itself is unchanged", () => {
    expect(resolveBasemapChoice(undefined).key).toBe("satellite");
    expect(resolveBasemapChoice("siteplan").key).toBe("satellite");
    expect(SITE_PLAN_BASEMAP.vectorMode).toBe("site");
    expect(strip(read("src/workspaces/food/components/FoodMap.jsx"))).not.toMatch(/attachSiteLabelStack|siteStack/);
  });
  it("the map finder reads siteStack — it keeps no private zoom literal", () => {
    const finder = strip(read("src/workspaces/site-planner/MapFinder.jsx"));
    expect(finder).toMatch(/siteStack\(zoom, \{ roads: labels, cityNames \}\)/);
    expect(finder).toMatch(/siteStack\(zoom\)\.includes\("cityNames"\)/);
    expect(finder).not.toMatch(/getZoom\(\)\s*>=\s*\d+/);
  });
  it("the city-name layer is shared code (food may not import site-planner) and the old path is a pure re-export", () => {
    for (const f of ["placeNamesGate", "placeNamesLayer", "placeNamesData", "zoomTracker"]) {
      expect(strip(read(`src/workspaces/site-planner/lib/${f}.js`)).trim()).toBe(`export * from "../../../shared/basemaps/${f}.js";`);
    }
  });
});
