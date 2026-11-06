/* NEW-1 second pass (B2671190 ×2, 2026-11-06) — GIS AREA fills paint OVER the default-band reference pictures.
 *
 * The owner's Academy › Concept A: "Zoning and Future Land Use are still cut out around the site", Map Base ON, after the first fix
 * (#2876, which moved the stored map SNAPSHOT under the fills and only ever applied with the Map Base Off). Measured 2026-11-06: the plan
 * also carries a hand-dropped PNG reference (added 2026-10-29, 901×929 px at 6.78 ft/px, running ~3,800 ft east of the origin and ~2,300 ft
 * west — the asymmetric rectangle "toward the airport"). References were drawn inside the plan SVG; the area fills were a pane of the
 * backdrop map UNDER that SVG — so an opaque reference cut a crisp hole in every fill. The live diagnostic (ui-audit diagnose-gis-fill-hole
 * `--ref`) read 257 of 365 zoning points unpainted on build 49b8f32.
 *
 * The rule now: basemap → (snapshot) → references → GIS AREA fills → parcel → setback → elements … The fills are hosted INSIDE the plan SVG
 * at the `data-gis-area-band` anchor right after the default-band references, and the export inserts the `under` band into the same anchor. */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { MAP_STACK, STACK_Z, SVG_TIERS, AREA_BAND_ATTR, FRONT_BAND_ATTR } from "../src/workspaces/site-planner/lib/mapStack.js";
import { plannerSource } from "./helpers/plannerSource.js";

const planner = plannerSource();
const exportSrc = readFileSync(new URL("../src/workspaces/site-planner/lib/exportSheet.js", import.meta.url), "utf8");
const css = readFileSync(new URL("../src/index.css", import.meta.url), "utf8");

describe("the model: references under the area fills, fills under the plan", () => {
  it("bottom→top: basemap, reference, gisArea, parcel …", () => {
    const ids = MAP_STACK.map((t) => t.id);
    expect(ids.indexOf("reference")).toBeLessThan(ids.indexOf("gisArea"));
    expect(ids.indexOf("gisArea")).toBeLessThan(ids.indexOf("parcel"));
    expect(STACK_Z.gisArea).toBeLessThan(STACK_Z.elements); // the load-bearing rule is untouched
    expect(STACK_Z.referenceFront).toBeGreaterThan(STACK_Z.gisArea); // a reference promoted above the plan still clears the fills
    expect(SVG_TIERS).toContain("gisArea");
    expect(AREA_BAND_ATTR).toBe("data-gis-area-band");
    expect(AREA_BAND_ATTR).not.toBe(FRONT_BAND_ATTR);
  });
});

describe("the planner hosts the area band in the plan SVG, right after the default-band references (red on 49b8f32)", () => {
  it("the area pane is mounted in the in-SVG host, never created in the backdrop map's own pane on the normal path", () => {
    expect(planner).toMatch(/mountBand\(geoAreaPaneRef\.current, PANE_AREA, PANE_AREA_LABEL, 350\)/);
    // the only remaining map-pane creation is the LOUD fallback when the host is missing
    const direct = planner.match(/map\.createPane\(PANE_AREA\)/g) || [];
    expect(direct.length).toBe(1);
    expect(planner).toMatch(/the GIS area band host \(data-gis-area-band\) is not mounted/);
  });
  it("the anchor renders immediately after `overlayBands.below` and before the parcel tier slot", () => {
    const below = planner.indexOf("{overlayBands.below.map(renderSheetOverlay)}");
    const band = planner.indexOf("[AREA_BAND_ATTR]: \"1\"");
    const parcelSlot = planner.indexOf("PARCELS IN FRONT (mapStack.js)", below);
    expect(below).toBeGreaterThan(0);
    expect(band).toBeGreaterThan(below);
    expect(parcelSlot).toBeGreaterThan(band);
    expect(planner.slice(below + 45, band)).not.toMatch(/renderSheetOverlay\)|parcelTierNodes\}/);
  });
  it("the host follows the imagery like the other bands (pane-transform mirror + gesture mirror)", () => {
    expect(planner).toMatch(/\[geoAreaPaneRef\.current, geoFrontPaneRef\.current, geoTopPaneRef\.current, geoPickPaneRef\.current\]/);
    expect(planner).toMatch(/const mirrors = \[geoTopWrapRef\.current, geoAreaWrapRef\.current, geoFrontWrapRef\.current, geoPickWrapRef\.current\]/);
  });
  it("nothing in the band takes a press", () => {
    expect(css).toMatch(/\[data-gis-area-band\] \* \{ pointer-events: none !important; \}/);
  });
});

describe("PDF-PARITY: the sheet puts the `under` band into the same anchor", () => {
  it("exportSheet inserts under-band rasters and vectors through `underInto`, which targets AREA_BAND_ATTR", () => {
    expect(exportSrc).toMatch(/const areaAnchor = root\.querySelector\(`\[\$\{AREA_BAND_ATTR\}\]`\)/);
    expect(exportSrc).toMatch(/else underInto\(im\);/);
    expect(exportSrc).toMatch(/else underInto\(g\);/);
  });
});
