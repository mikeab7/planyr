/* NEW-1 — "point features must never paint as Leaflet's broken default marker."
 *
 * THE BUG. The owner turned the Electric layer on over an aerial and got two broken-image
 * icons labelled "Mark" standing where the HIFLD substations should be. A GeoJSON POINT handed
 * to `L.geoJSON` — or to esri-leaflet's `featureLayer`, which delegates to
 * `L.GeoJSON.geometryToLayer` — with NO `pointToLayer` gets Leaflet's documented default:
 * `L.marker(latlng)` wearing `L.Icon.Default`. Nothing in this repo ever configured
 * `L.Icon.Default`'s image paths for the bundler, so that PNG 404s and the browser paints its
 * broken-image glyph plus the marker's alt text — the string "Marker", clipped by the 25px icon
 * box to read "Mark".
 *
 * WHY ONLY POINTS. Every other `L.marker` call site in the repo passes an explicit icon
 * (MapFinder's sitePinIcon, terrainLayers' labelIcon, vectorOverlay's label divIcon). Only
 * GeoJSON point features fell through to the default — and substations are points.
 *
 * WHAT IS LOCKED HERE. Leaflet cannot be imported in the node test env (it touches `window` at
 * module scope — the reason layers.js's other tests vi.mock it), so the DOM-level assertions
 * ("zero img with a default-icon src, zero alt='Marker'") live in the Playwright harness spec
 * `e2e/layer-point-hover-identify.spec.js`. What node CAN lock, and what actually prevents the
 * regression, is structural: the pure symbol options, and the fact that every construction site
 * for a GeoJSON-consuming layer passes a `pointToLayer` at all.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { pointSymbolOptions, featureLayerOptions } from "../src/workspaces/site-planner/lib/layerRequest.js";
import { hitFeature } from "../src/workspaces/site-planner/lib/vectorLayers.js";

const src = (rel) => readFileSync(fileURLToPath(new URL(`../src/workspaces/site-planner/${rel}`, import.meta.url)), "utf8");

// ---------------------------------------------------------------------------
describe("pointSymbolOptions — a point is a deliberate SYMBOL, not a dropped pin", () => {
  it("is a FILLED disc in the source's own colour", () => {
    const o = pointSymbolOptions({ color: "#7c3aed", weight: 2 }, 0.95);
    expect(o.radius).toBeGreaterThan(0);
    expect(o.color).toBe("#7c3aed");
    expect(o.fillColor).toBe("#7c3aed");
    // A stroke-only ring would vanish over green aerial imagery — the same reason the
    // project-status map markers are solid-filled (the B433 rule).
    expect(o.fillOpacity).toBeGreaterThan(0);
  });

  it("tracks the layer's opacity so the panel slider dims the whole symbol together", () => {
    const dim = pointSymbolOptions({ color: "#b91c1c" }, 0.2);
    const bright = pointSymbolOptions({ color: "#b91c1c" }, 1);
    expect(dim.opacity).toBeCloseTo(0.2);
    expect(dim.fillOpacity).toBeLessThan(bright.fillOpacity);
  });

  it("honours a registry radius override (a dense national layer must not become confetti)", () => {
    expect(pointSymbolOptions({ pointRadius: 5 }, 1).radius).toBe(5);
    expect(pointSymbolOptions({}, 1).radius).toBe(4);
  });

  it("never returns an icon/marker shape — a circleMarker takes styles, not an icon", () => {
    const o = pointSymbolOptions({ color: "#000" }, 1);
    expect(o.icon).toBeUndefined();
    expect(o.iconUrl).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
describe("featureLayerOptions — carries the injected pointToLayer", () => {
  const cfg = { url: "https://example.gov/x/FeatureServer/0", color: "#b91c1c", weight: 2 };

  it("passes an injected pointToLayer straight through to esri-leaflet", () => {
    const p2l = () => ({});
    expect(featureLayerOptions(cfg, 1, "envpane", { pointToLayer: p2l }).pointToLayer).toBe(p2l);
  });

  it("omits pointToLayer when none is injected rather than inventing a broken one", () => {
    expect("pointToLayer" in featureLayerOptions(cfg, 1, "envpane")).toBe(false);
  });

  it("defaults to non-interactive, and opts in only when asked (the hover identify)", () => {
    expect(featureLayerOptions(cfg, 1, "envpane").interactive).toBe(false);
    expect(featureLayerOptions(cfg, 1, "envpane", { interactive: true }).interactive).toBe(true);
  });

  it("still shapes the request exactly as before (no coverage narrowing — B283's hard rule)", () => {
    const o = featureLayerOptions({ ...cfg, minZoom: 11 }, 0.9, "envpane", { interactive: true });
    expect(o.url).toBe(cfg.url);
    expect(o.minZoom).toBe(11);
    expect(typeof o.style).toBe("function");
    expect(o.where).toBeUndefined();
    expect(o.bbox).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
/* The structural lock. A future edit that constructs a GeoJSON-consuming layer without a
 * `pointToLayer` reintroduces the broken marker, and nothing else in the suite would notice. */
describe("NEW-1 guard — no construction path can fall back to the default marker", () => {
  it("builds every esri featureLayer through the ONE helper that injects pointToLayer", () => {
    const layers = src("lib/layers.js");
    const sites = layers.match(/EL\.featureLayer\(/g) || [];
    // Exactly one construction site, and it is inside buildFeatureLayer.
    expect(sites.length).toBe(1);
    const helper = layers.slice(layers.indexOf("function buildFeatureLayer"));
    expect(helper.slice(0, helper.indexOf("\n}\n"))).toContain("EL.featureLayer(");
    expect(helper.slice(0, helper.indexOf("\n}\n"))).toContain("pointToLayer:");
  });

  it("gives the cached vector overlay's L.geoJSON a pointToLayer", () => {
    const vo = src("lib/vectorOverlay.js");
    const calls = vo.match(/L\.geoJSON\([\s\S]{0,400}?\}\)/g) || [];
    expect(calls.length).toBeGreaterThan(0);
    for (const call of calls) expect(call).toContain("pointToLayer");
  });

  it("configures L.Icon.Default with a URL that resolves, so an accidental default marker is a real pin", () => {
    const sym = src("lib/mapSymbols.js");
    // A self-contained data URI — never a bare relative path (which would 404 exactly as hard as
    // the unconfigured default did) and never leaflet's bundled PNGs, which Vite base64-inlines
    // into the planner chunk at ~6 KB for a fallback that should never fire (perf-bundle-audit).
    expect(sym).toContain("data:image/svg+xml,");
    expect(sym).not.toMatch(/from\s+"leaflet\/dist\/images\//);
    expect(sym).toContain("L.Icon.Default.mergeOptions");
    // Leaflet's own path-guessing hook derives a URL from the <script> location, which is
    // meaningless under a bundler and would win over mergeOptions if left in place.
    expect(sym).toContain("delete L.Icon.Default.prototype._getIconUrl");
    // No shadow image: a fallback must not add a second <img> that can itself fail to load.
    expect(sym).toMatch(/shadowUrl:\s*null/);
  });

  it("installs that default before any layer is built, on both leaflet-facing modules", () => {
    expect(src("lib/layers.js")).toContain("installDefaultMarkerIcon()");
    expect(src("lib/vectorOverlay.js")).toContain("installDefaultMarkerIcon()");
  });

  it("styles points GEOMETRY-AWARELY (L.geoJSON applies `style` to circleMarkers too)", () => {
    // Without this the polygon hit-area fill (0.02) would flatten a point to near-invisible —
    // the symbol would technically not be a broken image, and still not be visible.
    const vo = src("lib/vectorOverlay.js");
    expect(vo).toContain("isPointFeature");
    expect(vo).toMatch(/baseStyle\s*=\s*\(feature\)\s*=>/);
  });
});

// ---------------------------------------------------------------------------
describe("hitFeature — POINT features are hittable (so the canvas identify reaches a substation)", () => {
  const at = { lat: 29.76, lng: -95.36 };
  const pointFc = (lng, lat) => ({
    type: "FeatureCollection",
    features: [{ type: "Feature", geometry: { type: "Point", coordinates: [lng, lat] }, properties: { NAME: "Addicks" } }],
  });

  it("hits a point inside the tolerance", () => {
    const hit = hitFeature(pointFc(at.lng + 0.00002, at.lat), { ...at, tolDeg: 0.0001 });
    expect(hit && hit.properties.NAME).toBe("Addicks");
  });

  it("misses a point outside the tolerance (a hover must not grab a mile away)", () => {
    expect(hitFeature(pointFc(at.lng + 0.01, at.lat), { ...at, tolDeg: 0.0001 })).toBe(null);
  });

  it("handles MultiPoint", () => {
    const fc = {
      type: "FeatureCollection",
      features: [{ type: "Feature", properties: { NAME: "pair" },
        geometry: { type: "MultiPoint", coordinates: [[at.lng + 0.5, at.lat], [at.lng, at.lat]] } }],
    };
    expect(hitFeature(fc, { ...at, tolDeg: 0.0001 }).properties.NAME).toBe("pair");
  });

  it("still lets an exact POLYGON containment beat a nearby point (the two-pass order)", () => {
    const d = 0.002;
    const fc = {
      type: "FeatureCollection",
      features: [
        { type: "Feature", properties: { NAME: "point" }, geometry: { type: "Point", coordinates: [at.lng + 0.00002, at.lat] } },
        { type: "Feature", properties: { NAME: "polygon" }, geometry: { type: "Polygon", coordinates: [[
          [at.lng - d, at.lat - d], [at.lng + d, at.lat - d], [at.lng + d, at.lat + d], [at.lng - d, at.lat + d], [at.lng - d, at.lat - d],
        ]] } },
      ],
    };
    expect(hitFeature(fc, { ...at, tolDeg: 0.0001 }).properties.NAME).toBe("polygon");
  });
});
