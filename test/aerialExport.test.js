// B735 — the PDF/PNG export must include the on-screen satellite aerial. When the LIVE
// basemap is on, the aerial is a Leaflet tile <div> the exported SVG can't clone, so the
// export synthesizes a frame-exact image from the source's `export` endpoint. These tests
// cover the pure geometry that makes that image line up with the parcels: feetExtentToBbox
// turns the printed feet extent into a lon/lat bbox, and aerialPlacement must reverse it
// exactly (same FT_PER_DEG constants), so the placed image reconstructs the original extent.
import { describe, it, expect } from "vitest";
import {
  feetExtentToBbox,
  aerialPlacement,
  feetToLatLng,
  lngLatToGlobalPixel,
  aerialTileGrid,
  pickAerialTileZoom,
} from "../src/workspaces/site-planner/lib/arcgis.js";

// A Katy-area origin (the app's home turf), same latitude band as EPSG:2278.
const lat0 = 29.7858, lon0 = -95.8244;

describe("feetExtentToBbox (B735)", () => {
  it("produces a well-formed bbox with north/south oriented correctly", () => {
    // In planner feet +x is EAST, +y is SOUTH. So minY (top of the frame) is the NORTH edge.
    const ext = { minX: -500, minY: -800, maxX: 1200, maxY: 400 };
    const bbox = feetExtentToBbox(ext, lat0, lon0);
    expect(bbox.lonMin).toBeLessThan(bbox.lonMax);
    expect(bbox.latMin).toBeLessThan(bbox.latMax);
    // minY (north) must be the MAX latitude; maxY (south) the MIN latitude.
    const [latAtMinY] = feetToLatLng({ x: 0, y: ext.minY }, lat0, lon0);
    const [latAtMaxY] = feetToLatLng({ x: 0, y: ext.maxY }, lat0, lon0);
    expect(bbox.latMax).toBeCloseTo(latAtMinY, 9);
    expect(bbox.latMin).toBeCloseTo(latAtMaxY, 9);
  });

  it("round-trips through aerialPlacement to the original feet extent", () => {
    const ext = { minX: -320, minY: -640, maxX: 980, maxY: 210 };
    const bbox = feetExtentToBbox(ext, lat0, lon0);
    const p = aerialPlacement(bbox, lon0, lat0, { maxPx: 2400 });
    // The placed image's top-left is the extent's top-left (feet), and its far corner is the
    // bottom-right — so the synthesized aerial fills exactly the printed frame.
    const sy = p.ftPerPxY || p.ftPerPx;
    expect(p.x).toBeCloseTo(ext.minX, 3);
    expect(p.y).toBeCloseTo(ext.minY, 3);
    expect(p.x + p.imgW * p.ftPerPx).toBeCloseTo(ext.maxX, 3);
    expect(p.y + p.imgH * sy).toBeCloseTo(ext.maxY, 3);
  });

  it("keeps the export image within the ArcGIS export pixel ceiling", () => {
    // A very wide sheet still asks for <= maxPx on the long side (ArcGIS caps at 4096).
    const ext = { minX: -5000, minY: -300, maxX: 5000, maxY: 300 };
    const bbox = feetExtentToBbox(ext, lat0, lon0);
    const p = aerialPlacement(bbox, lon0, lat0, { maxPx: 2400 });
    expect(Math.max(p.imgW, p.imgH)).toBeLessThanOrEqual(2400);
    expect(Math.min(p.imgW, p.imgH)).toBeGreaterThan(0);
  });
});

// B839 — reuse cached basemap TILES for the export backdrop. Pure Web Mercator tile-grid math.
describe("lngLatToGlobalPixel (B839)", () => {
  it("puts the world center at the middle of the 256px z0 world and scales with zoom", () => {
    const p0 = lngLatToGlobalPixel(0, 0, 0);
    expect(p0.x).toBeCloseTo(128, 6);
    expect(p0.y).toBeCloseTo(128, 6);
    // Every zoom level doubles the world's pixel size.
    const p2 = lngLatToGlobalPixel(0, 0, 2);
    expect(p2.x).toBeCloseTo(128 * 4, 6);
    expect(p2.y).toBeCloseTo(128 * 4, 6);
  });
  it("increases x with longitude (east) and y with decreasing latitude (south)", () => {
    const z = 12;
    const west = lngLatToGlobalPixel(-96, 30, z);
    const east = lngLatToGlobalPixel(-95, 30, z);
    expect(east.x).toBeGreaterThan(west.x);
    const north = lngLatToGlobalPixel(-95.5, 31, z);
    const south = lngLatToGlobalPixel(-95.5, 29, z);
    expect(south.y).toBeGreaterThan(north.y); // y grows going south
  });
});

describe("aerialTileGrid (B839)", () => {
  // Use a real printed frame's bbox so the grid is exercised on production-shaped input.
  const bbox = feetExtentToBbox({ minX: -1100, minY: -1100, maxX: 1100, maxY: 1100 }, lat0, lon0);

  it("crops the canvas to the exact Mercator pixel span of the bbox", () => {
    const z = 18;
    const nw = lngLatToGlobalPixel(bbox.lonMin, bbox.latMax, z);
    const se = lngLatToGlobalPixel(bbox.lonMax, bbox.latMin, z);
    const g = aerialTileGrid(bbox, z);
    expect(g.canvasW).toBe(Math.max(1, Math.round(se.x - nw.x)));
    expect(g.canvasH).toBe(Math.max(1, Math.round(se.y - nw.y)));
    expect(g.z).toBe(z);
  });

  it("returns tiles that fully cover the cropped canvas with in-range indices", () => {
    const z = 18;
    const g = aerialTileGrid(bbox, z);
    const n = Math.pow(2, z);
    expect(g.tiles.length).toBeGreaterThan(0);
    for (const t of g.tiles) {
      expect(t.x).toBeGreaterThanOrEqual(0);
      expect(t.x).toBeLessThan(n);
      expect(t.y).toBeGreaterThanOrEqual(0);
      expect(t.y).toBeLessThan(n);
    }
    // The NW-most tile starts at or before the canvas origin; the SE-most reaches past the far edge —
    // so drawn 256×256 the tiles blanket [0,canvasW]×[0,canvasH] with no gap.
    const minDx = Math.min(...g.tiles.map((t) => t.dx));
    const minDy = Math.min(...g.tiles.map((t) => t.dy));
    const maxDx = Math.max(...g.tiles.map((t) => t.dx));
    const maxDy = Math.max(...g.tiles.map((t) => t.dy));
    expect(minDx).toBeLessThanOrEqual(0);
    expect(minDy).toBeLessThanOrEqual(0);
    expect(maxDx + 256).toBeGreaterThanOrEqual(g.canvasW);
    expect(maxDy + 256).toBeGreaterThanOrEqual(g.canvasH);
    // tiles form a dense rectangular grid: count == unique-x * unique-y
    const ux = new Set(g.tiles.map((t) => t.x)).size;
    const uy = new Set(g.tiles.map((t) => t.y)).size;
    expect(g.tiles.length).toBe(ux * uy);
  });
});

describe("pickAerialTileZoom (B839)", () => {
  it("never exceeds the source's native ceiling and keeps the canvas within maxPx", () => {
    const bbox = feetExtentToBbox({ minX: -1100, minY: -1100, maxX: 1100, maxY: 1100 }, lat0, lon0);
    const zEsri = pickAerialTileZoom(bbox, { maxNative: 19, maxPx: 3072 });
    expect(zEsri).toBeLessThanOrEqual(19);
    const gEsri = aerialTileGrid(bbox, zEsri);
    expect(gEsri.canvasW).toBeLessThanOrEqual(3072);
    expect(gEsri.canvasH).toBeLessThanOrEqual(3072);
    // A ~2200ft frame fits comfortably at Esri's ceiling → the sharpest zoom is chosen.
    expect(zEsri).toBe(19);
    // USGS tops out shallower (z16) — the picker must respect the lower ceiling.
    expect(pickAerialTileZoom(bbox, { maxNative: 16, maxPx: 3072 })).toBeLessThanOrEqual(16);
  });

  it("drops zoom for a large frame so the stitched canvas stays under maxPx", () => {
    const big = feetExtentToBbox({ minX: -12000, minY: -12000, maxX: 12000, maxY: 12000 }, lat0, lon0);
    const z = pickAerialTileZoom(big, { maxNative: 19, maxPx: 3072 });
    const g = aerialTileGrid(big, z);
    expect(g.canvasW).toBeLessThanOrEqual(3072);
    expect(g.canvasH).toBeLessThanOrEqual(3072);
    expect(z).toBeLessThan(19); // a 24000ft sheet can't stay under maxPx at z19
  });
});
