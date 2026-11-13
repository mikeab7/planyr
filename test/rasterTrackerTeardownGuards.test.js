import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

/* NEW-1 / NEW-2 (2026-11-12) — source guards for the two teardown races reported in `client_errors`.
 * The behaviour of the raster error guard is unit-tested in rasterErrorGuard; these pin the SEAMS so a new constructor / a new
 * frame loop cannot quietly skip them. (zoomTracker and adminBoundaryLayer import Leaflet, which needs a `window`, so they
 * can only be exercised in a browser — e2e/raster-error-after-off drives both.) */
const root = path.resolve(import.meta.dirname, "..");
const read = (p) => fs.readFileSync(path.join(root, p), "utf8");
function walk(dir, out = []) {
  for (const f of fs.readdirSync(path.join(root, dir), { withFileTypes: true })) {
    const rel = path.join(dir, f.name);
    if (f.isDirectory()) walk(rel, out); else if (/\.(js|jsx)$/.test(f.name)) out.push(rel);
  }
  return out;
}

describe("NEW-1 — every esri raster layer is built behind the error guard", () => {
  it("each EL.dynamicMapLayer( / EL.imageMapLayer( call in src/ sits inside guardRasterErrors( or guardRasterOpacity(", () => {
    const bad = [];
    let seen = 0;
    for (const f of walk("src")) {
      const lines = read(f).split("\n");
      lines.forEach((line, i) => {
        if (/^\s*(\/\/|\*)/.test(line)) return;
        if (!/EL\.(dynamicMapLayer|imageMapLayer)\(/.test(line)) return;
        seen++;
        // the wrapper may open on the previous line (`const layer = guardRasterOpacity(EL.dynamicMapLayer({`) or the same one
        if (!/guardRaster(Errors|Opacity)\(/.test(line) && !/guardRaster(Errors|Opacity)\(/.test(lines[i - 1] || "")) bad.push(`${f}:${i + 1}`);
      });
    }
    expect(seen, "the scan found the constructors it is about").toBeGreaterThanOrEqual(4);
    expect(bad, `unguarded raster constructors: ${bad.join(", ")}`).toEqual([]);
  });

  it("the guard keeps ONE _renderImage wrapper per layer (guardRasterOpacity shares install() with guardRasterErrors)", () => {
    const g = read("src/workspaces/site-planner/lib/parcelOpacityGuard.js");
    expect((g.match(/layer\._renderImage = function/g) || []).length).toBe(1);
    expect(g).toMatch(/export function guardRasterErrors/);
  });
});

describe("NEW-2 — a queued frame never projects through a map whose panes are gone", () => {
  it("the zoom tracker exposes `alive` (map._mapPane) and the admin-boundary frame checks it before projecting", () => {
    const t = read("src/shared/basemaps/zoomTracker.js");
    expect(t).toMatch(/get alive\(\)\s*{\s*return !!map\._mapPane;/);
    const a = read("src/workspaces/site-planner/lib/adminBoundaryLayer.js");
    const draw = a.slice(a.indexOf("const draw = (ts)"), a.indexOf("tracker.frame("));
    expect(draw).toMatch(/!tracker\.alive/);
    expect(draw.indexOf("!tracker.alive")).toBeLessThan(draw.indexOf("map.getSize"));
  });

  it("every layer that draws from tracker.frame guards on a torn-down map first (placeNamesLayer already did)", () => {
    for (const f of ["src/workspaces/site-planner/lib/adminBoundaryLayer.js", "src/shared/basemaps/placeNamesLayer.js"]) {
      const s = read(f);
      const i = s.indexOf("tracker.frame(");
      expect(i, f).toBeGreaterThan(0);
      expect(s.slice(0, i), f).toMatch(/!tracker\.alive|!map\._mapPane/);
    }
  });
});
