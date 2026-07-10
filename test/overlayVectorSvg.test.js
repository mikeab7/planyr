// B745 — the PDF/PNG export must include the VECTOR/client-drawn GIS overlay layers (transmission,
// road-authority, county/city/ETJ boundaries, contours, drainage arrows, OSM/Mapillary points).
// Each is reprojected from lat/lon into the site feet frame and redrawn as SVG. These tests lock
// the pure emitter + normalizers: the injected projection is honored verbatim, a non-finite vertex
// skips the WHOLE feature (never a half-drawn line), and the terrain [lat,lng]→[lon,lat] swap holds.
import { describe, it, expect } from "vitest";
import {
  featureToSvg, buildOverlayVectorFragment, overlayVectorSvg,
  esriLineFeatures, esriPolygonFeatures, contourFeatures, arrowGlyphFeatures, swapLatLng,
} from "../src/workspaces/site-planner/lib/overlayVectorSvg.js";

const ident = ([lon, lat]) => ({ x: lon, y: lat }); // identity projection for assertions

describe("featureToSvg / buildOverlayVectorFragment (B745)", () => {
  it("emits a line <path> with the injected projection + opacity multiply", () => {
    const f = { kind: "line", coords: [[0, 0], [10, 20]], style: { stroke: "#b91c1c", strokeWidth: 2.6, strokeOpacity: 0.9 } };
    const svg = featureToSvg(f, ident, { opacity: 0.9 });
    expect(svg).toBe('<path d="M0,0 L10,20" fill="none" stroke="#b91c1c" stroke-width="2.6" stroke-opacity="0.81" stroke-linejoin="round" stroke-linecap="round"/>');
  });

  it("honors a linear (scale+offset) projection verbatim", () => {
    const f = { kind: "line", coords: [[1, 1], [2, 3]], style: { stroke: "#000", strokeWidth: 1 } };
    const proj = ([lon, lat]) => ({ x: lon * 10 + 5, y: lat * 10 + 5 });
    expect(featureToSvg(f, proj)).toContain('d="M15,15 L25,35"');
  });

  it("emits a polygon <path> with a hole (fill-rule evenodd, two Z-terminated subpaths)", () => {
    const f = {
      kind: "polygon",
      coords: [[[0, 0], [10, 0], [10, 10], [0, 10]], [[3, 3], [6, 3], [6, 6], [3, 6]]],
      style: { stroke: "#374151", strokeWidth: 2, fill: "none" },
    };
    const svg = featureToSvg(f, ident);
    expect(svg).toContain('fill-rule="evenodd"');
    expect(svg.match(/Z/g)).toHaveLength(2);
    expect(svg).toContain('fill="none"');
    expect(svg.startsWith("<path")).toBe(true);
  });

  it("emits a point <circle> with radius + fill", () => {
    const f = { kind: "point", coords: [4, 5], style: { stroke: "#0ea5e9", fill: "#dc2626", radius: 4 } };
    const svg = featureToSvg(f, ident);
    expect(svg).toBe('<circle cx="4" cy="5" r="4" fill="#dc2626" stroke="#0ea5e9"/>');
  });

  it("SKIPS a feature with any non-finite projected vertex (never a partial path)", () => {
    const good = { kind: "line", coords: [[0, 0], [1, 1]], style: { stroke: "#000", strokeWidth: 1 } };
    const bad = { kind: "line", coords: [[0, 0], [NaN, 1]], style: { stroke: "#000", strokeWidth: 1 } };
    expect(featureToSvg(bad, ident)).toBeNull();
    const r = buildOverlayVectorFragment([good, bad], ident);
    expect(r.emitted).toBe(1);
    expect(r.skipped).toBe(1);
    expect(r.svg).not.toContain("NaN");
    expect(r.svg.match(/<path/g)).toHaveLength(1);
  });

  it("renders pre-placed labels as haloed exhibit <text>, escaped + optional uppercase", () => {
    const r = buildOverlayVectorFragment([], ident, {
      labels: [{ x: 5, y: 6, text: "Harris & Co", uppercase: true }],
    });
    expect(r.svg).toContain('paint-order="stroke"');
    expect(r.svg).toContain("Harris &amp; Co");
    expect(r.svg).toContain("text-transform:uppercase");
  });

  it("space:'pixel' features bypass the lon/lat projection (used by flow arrows)", () => {
    const f = { kind: "line", space: "pixel", coords: [[100, 200], [110, 205]], style: { stroke: "#0369A1", strokeWidth: 1.5 } };
    // A projection that would corrupt the coords if (wrongly) applied:
    const proj = () => ({ x: -999, y: -999 });
    expect(featureToSvg(f, proj)).toContain('d="M100,200 L110,205"');
  });

  it("overlayVectorSvg returns just the concatenated string", () => {
    const s = overlayVectorSvg([{ kind: "point", coords: [1, 2], style: { stroke: "#000" } }], ident);
    expect(s).toContain("<circle");
  });
});

describe("esri geometry normalizers (B745)", () => {
  const style = { stroke: "#b91c1c", strokeWidth: 2.4 };
  it("LineString → one line feature; MultiLineString → one per part", () => {
    expect(esriLineFeatures({ type: "LineString", coordinates: [[0, 0], [1, 1]] }, style)).toHaveLength(1);
    const multi = esriLineFeatures({ type: "MultiLineString", coordinates: [[[0, 0], [1, 1]], [[2, 2], [3, 3]]] }, style);
    expect(multi).toHaveLength(2);
    expect(multi[0]).toMatchObject({ kind: "line", coords: [[0, 0], [1, 1]], style });
  });
  it("Polygon → one polygon feature; MultiPolygon → one per part", () => {
    const poly = { type: "Polygon", coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] };
    expect(esriPolygonFeatures(poly, style)).toHaveLength(1);
    const mp = { type: "MultiPolygon", coordinates: [poly.coordinates, poly.coordinates] };
    expect(esriPolygonFeatures(mp, style)).toHaveLength(2);
  });
  it("ignores empty/degenerate geometry", () => {
    expect(esriLineFeatures(null, style)).toEqual([]);
    expect(esriLineFeatures({ type: "LineString", coordinates: [[0, 0]] }, style)).toEqual([]);
    expect(esriPolygonFeatures({ type: "Polygon", coordinates: [[[0, 0], [1, 1]]] }, style)).toEqual([]);
  });
});

describe("terrain normalizers (B745)", () => {
  it("swapLatLng flips [lat,lng] → [lon,lat]", () => {
    expect(swapLatLng([29.7, -95.8])).toEqual([-95.8, 29.7]);
  });
  it("contourFeatures swaps coords + weights index heavier + emits ft labels", () => {
    const contours = {
      levels: [
        { level: 100, isIndex: false, lines: [[[29.7, -95.8], [29.71, -95.81]]] },
        { level: 105, isIndex: true, lines: [[[29.72, -95.82], [29.73, -95.83]]] },
      ],
      labels: [{ ll: [29.72, -95.82], level: 105 }],
    };
    const { features, labels } = contourFeatures(contours);
    expect(features).toHaveLength(2);
    // [lat,lng] → [lon,lat]
    expect(features[0].coords[0]).toEqual([-95.8, 29.7]);
    // index line heavier than intermediate (salience by weight)
    expect(features[1].style.strokeWidth).toBeGreaterThan(features[0].style.strokeWidth);
    expect(labels).toEqual([{ lng: -95.82, lat: 29.72, text: "105 ft" }]);
  });
  it("arrowGlyphFeatures builds a fixed-px glyph from the projected center + dir/slope", () => {
    const feats = arrowGlyphFeatures({ dir: 0, slope: 0.02 }, { x: 100, y: 100 });
    expect(feats).toHaveLength(1);
    expect(feats[0]).toMatchObject({ kind: "line", space: "pixel" });
    // dir 0 = +x: tail left of center, tip right (len = 14+14 = 28 at max slope → ±14)
    expect(feats[0].coords[0][0]).toBeCloseTo(86, 1); // tail x
    expect(feats[0].coords[1][0]).toBeCloseTo(114, 1); // tip x
    expect(feats[0].coords[0][1]).toBeCloseTo(100, 1); // y unchanged along +x
    expect(feats[0].style.stroke).toBe("#0369A1");
  });
  it("arrowGlyphFeatures returns [] for a non-finite center", () => {
    expect(arrowGlyphFeatures({ dir: 0, slope: 0.01 }, { x: NaN, y: 1 })).toEqual([]);
  });
});
