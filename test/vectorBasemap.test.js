/* vectorBasemap — NEW-1 (B2018608). The vector roads/labels style + source contract, pure (no browser;
 * the live render is ui-audit/verify-vector-basemap.mjs). */
import { describe, it, expect } from "vitest";
import { VECTOR_SOURCE, VECTOR_ZOOM_OFFSET, SITE_ROADS_FROM } from "../src/shared/basemaps/basemaps.js";
import { buildVectorStyle, visibleRoadClassesAt, LOCAL_STREETS_FROM } from "../src/shared/basemaps/vectorStyle.js";
import { vectorLayerOptions, VECTOR_PANE } from "../src/shared/basemaps/vectorLabelLayer.js";

const style = buildVectorStyle(VECTOR_SOURCE, "https://x.test/map-assets/fonts/{fontstack}/{range}.pbf");

describe("vector source config", () => {
  it("is one swappable entry: TileJSON + glyphs + credit, no API key anywhere", () => {
    expect(VECTOR_SOURCE.tilejson).toMatch(/^https:\/\/tiles\.openfreemap\.org\//);
    expect(VECTOR_SOURCE.schema).toBe("openmaptiles");
    expect(JSON.stringify(VECTOR_SOURCE)).not.toMatch(/key=|apikey|token/i);
    expect(VECTOR_SOURCE.attribution).toMatch(/OpenFreeMap/);
    expect(VECTOR_SOURCE.attribution).toMatch(/OpenStreetMap/);
  });
  it("the style names the source only through the config (swap = edit the config)", () => {
    expect(style.sources.vec.url).toBe(VECTOR_SOURCE.tilejson);
    expect(JSON.stringify(style.layers)).not.toMatch(/openfreemap/);
  });
  it("glyphs are self-hosted (same origin), absolute for the worker", () => {
    expect(VECTOR_SOURCE.glyphs.startsWith("/map-assets/fonts/")).toBe(true);
    expect(vectorLayerOptions(VECTOR_SOURCE, { origin: "https://planyr.io" }).style.glyphs).toBe("https://planyr.io/map-assets/fonts/{fontstack}/{range}.pbf");
  });
});

describe("style: Apple-like hierarchy and collision", () => {
  const layer = (id) => style.layers.find((l) => l.id === id);
  it("local streets hidden at metro zoom, shown at neighbourhood zoom; freeways always before arterials before locals", () => {
    expect([...visibleRoadClassesAt(11)].sort()).not.toContain("minor");
    expect(visibleRoadClassesAt(11).has("motorway")).toBe(true);
    expect(visibleRoadClassesAt(16).has("minor")).toBe(true);
    expect(LOCAL_STREETS_FROM).toBeGreaterThan(12);
    expect(layer("road-local").minzoom).toBe(LOCAL_STREETS_FROM - VECTOR_ZOOM_OFFSET);
    expect(layer("road-freeway").minzoom).toBeLessThan(layer("road-major").minzoom);
    expect(layer("road-major").minzoom).toBeLessThan(layer("road-arterial").minzoom);
  });
  it("strokes are thin and translucent — no opaque bands", () => {
    for (const id of ["road-freeway", "road-major", "road-arterial", "road-collector", "road-local", "road-service"]) {
      const l = layer(id);
      expect(l.paint["line-opacity"]).toBeLessThan(1);
      const stops = l.paint["line-width"].slice(3).filter((_, i) => i % 2 === 1);
      expect(Math.max(...stops)).toBeLessThanOrEqual(13);
    }
    const f = layer("road-freeway").paint["line-width"], m = layer("road-local").paint["line-width"];
    expect(f[f.length - 1]).toBeGreaterThan(m[m.length - 1]); // freeway wider than local
  });
  it("label collision is ON everywhere (no text-allow-overlap), road names follow the line, halos are soft", () => {
    const symbols = style.layers.filter((l) => l.type === "symbol");
    expect(symbols.length).toBeGreaterThan(4);
    for (const l of symbols) {
      expect(l.layout["text-allow-overlap"]).toBe(false);
      expect(l.layout["text-ignore-placement"]).toBe(false);
      expect(l.paint["text-halo-width"]).toBeLessThanOrEqual(1.3);
      expect(l.layout["text-font"][0]).toMatch(/^Noto Sans/);
    }
    for (const id of ["roadname-major", "roadname-collector", "roadname-local"]) expect(layer(id).layout["symbol-placement"]).toBe("line");
  });
  it("POIs are sparse and optional: absent on Food (pins are the POIs), ranked + class-filtered on Site Plan", () => {
    expect(buildVectorStyle(VECTOR_SOURCE, "g", { includePois: false }).layers.some((l) => l.id === "poi-landmarks")).toBe(false);
    const poi = layer("poi-landmarks");
    expect(poi).toBeTruthy();
    expect(JSON.stringify(poi.filter)).toMatch(/rank/);
  });
  it("transparent over the aerial: no background/fill layer", () => {
    expect(style.layers.some((l) => l.type === "background" || l.type === "fill")).toBe(false);
  });
});

describe("site mode — the Site Plan map's close-zoom roads", () => {
  const site = buildVectorStyle(VECTOR_SOURCE, "g", { mode: "site" });
  it("draws roads + road names ONLY: no vector places, no POIs (city names are Planyr's own layer there)", () => {
    expect(site.layers.some((l) => /^place-|^poi-/.test(l.id))).toBe(false);
    expect(site.layers.length).toBeGreaterThan(8);
  });
  it("NOTHING draws below the Site map's road gate: every layer's minzoom >= SITE_ROADS_FROM (no road lines at metro zoom)", () => {
    for (const l of site.layers) expect(l.minzoom).toBeGreaterThanOrEqual(SITE_ROADS_FROM - VECTOR_ZOOM_OFFSET);
    for (const z of [3, 8, 10, 11, 12, 13]) expect(visibleRoadClassesAt(z, "site").size).toBe(0);
    expect(visibleRoadClassesAt(14, "site").has("motorway")).toBe(true);
    expect(visibleRoadClassesAt(16, "site").has("minor")).toBe(true);
  });
  it("hybrid is the opposite: freeways already draw at metro zoom", () => {
    expect(visibleRoadClassesAt(11, "hybrid").has("motorway")).toBe(true);
    expect(visibleRoadClassesAt(11, "hybrid").has("minor")).toBe(false);
  });
});

describe("layer options", () => {
  it("non-interactive, own pane (above tiles, below markers), no MapLibre attribution control", () => {
    const o = vectorLayerOptions(VECTOR_SOURCE, { origin: "https://planyr.io" });
    expect(o.interactive).toBe(false);
    expect(o.pane).toBe(VECTOR_PANE);
    expect(o.attributionControl).toBe(false);
  });
});

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { IMAGERY_GRADE } from "../src/shared/basemaps/basemaps.js";
describe("imagery grade + seam fix CSS", () => {
  const css = readFileSync(join(__dirname, "..", "src/index.css"), "utf8");
  it("the CSS filter matches IMAGERY_GRADE, and the seam-gap class exists", () => {
    expect(css).toContain(`.${IMAGERY_GRADE.className} { filter: brightness(${IMAGERY_GRADE.brightness}) saturate(${IMAGERY_GRADE.saturate}); }`);
    expect(css).toMatch(new RegExp(`\\.leaflet-container\\.${IMAGERY_GRADE.containerClass}\\s*\\{[^}]*--aerial-gap-bg`));
  });
});

describe("no tinted roads (B2106752)", () => {
  const NEUTRAL_RE = /^(#ffffff|rgba\(\s*(10|18),\s*(16|26),\s*(24|38),[^)]*\))$/i;
  const NEUTRAL = { test: (c) => NEUTRAL_RE.test(c) || /^rgba\(\s*255,\s*255,\s*255,/.test(c) };
  it("every road stroke/casing and every label colour in the style is neutral white or the dark casing/halo — no yellow/cream anywhere", () => {
    const colours = [];
    for (const l of style.layers) {
      const p = l.paint || {};
      for (const k of ["line-color", "text-color", "text-halo-color"]) if (typeof p[k] === "string") colours.push([l.id, k, p[k]]);
    }
    expect(colours.length).toBeGreaterThan(10);
    const tinted = colours.filter(([, , c]) => !NEUTRAL.test(c));
    expect(tinted).toEqual([]);
  });
  it("freeways rank above streets by width, not hue", () => {
    const road = (id) => style.layers.find((l) => l.id === id).paint;
    expect(road("road-freeway")["line-color"]).toBe(road("road-major")["line-color"]);
    const w = (id) => road(id)["line-width"].at(-1);
    expect(w("road-freeway")).toBeGreaterThan(w("road-major"));
  });
});
