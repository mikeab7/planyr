// B735 — the PDF/PNG export must include the on-screen satellite aerial. When the LIVE
// basemap is on, the aerial is a Leaflet tile <div> the exported SVG can't clone, so the
// export synthesizes a frame-exact image from the source's `export` endpoint. These tests
// cover the pure geometry that makes that image line up with the parcels: feetExtentToBbox
// turns the printed feet extent into a lon/lat bbox, and aerialPlacement must reverse it
// exactly (same FT_PER_DEG constants), so the placed image reconstructs the original extent.
import { describe, it, expect } from "vitest";
import { feetExtentToBbox, aerialPlacement, feetToLatLng } from "../src/workspaces/site-planner/lib/arcgis.js";

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
