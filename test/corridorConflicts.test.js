// NEW-11/B831 (pond-roles branch) — ponds vs easement/pipeline-corridor overlap:
// exact areas on hand-computed squares, the minSf floor, the bbox prefilter, and
// the corridor buffer → site-feet round-trip. Pure — no browser.
import { describe, it, expect } from "vitest";
import { pondEncumbranceConflicts } from "../src/workspaces/site-planner/lib/corridorConflicts.js";
import { corridorRingLngLat, DEFAULT_CORRIDOR_WIDTH_FT } from "../src/workspaces/site-planner/lib/pipelineCorridor.js";
import { lngLatRingToFeet, feetToLatLng } from "../src/workspaces/site-planner/lib/arcgis.js";

const rect = (x0, y0, x1, y1) => [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }];

describe("pondEncumbranceConflicts — hand-computed overlaps", () => {
  it("reports the exact overlap area of a pond and an easement strip", () => {
    const pond = { id: "p1", ring: rect(0, 0, 100, 100) };
    const ease = { id: "e1", ring: rect(50, -50, 150, 150), label: "Pipeline esmt" };
    const out = pondEncumbranceConflicts({ ponds: [pond], easements: [ease] });
    expect(out).toHaveLength(1);
    expect(out[0].pondId).toBe("p1");
    expect(out[0].easementSf).toBeCloseTo(5000, -1); // 50×100 overlap
    expect(out[0].corridorSf).toBe(0);
    expect(out[0].easementIds).toEqual(["e1"]);
  });
  it("sums easement + corridor legs into totalSf", () => {
    const pond = { id: "p1", ring: rect(0, 0, 100, 100) };
    const ease = { id: "e1", ring: rect(0, 0, 100, 20) };       // 2 000 sf
    const corridor = rect(0, 80, 100, 120);                      // 2 000 sf inside
    const out = pondEncumbranceConflicts({ ponds: [pond], easements: [ease], corridorRings: [corridor] });
    expect(out[0].easementSf).toBeCloseTo(2000, -1);
    expect(out[0].corridorSf).toBeCloseTo(2000, -1);
    expect(out[0].totalSf).toBeCloseTo(4000, -1);
  });
  it("a sliver under minSf is not a finding; a clear pond reports nothing", () => {
    const pond = { id: "p1", ring: rect(0, 0, 100, 100) };
    const sliver = { id: "e1", ring: rect(99, 99, 199, 199) };   // 1 sf overlap
    expect(pondEncumbranceConflicts({ ponds: [pond], easements: [sliver] })).toEqual([]);
    const far = { id: "e2", ring: rect(5000, 5000, 5100, 5100) }; // bbox prefilter path
    expect(pondEncumbranceConflicts({ ponds: [pond], easements: [far] })).toEqual([]);
  });
  it("degenerate rings are skipped, never a throw", () => {
    const out = pondEncumbranceConflicts({
      ponds: [{ id: "p1", ring: rect(0, 0, 50, 50) }, { id: "bad", ring: [{ x: 0, y: 0 }] }],
      easements: [{ id: "e1", ring: null }, { id: "e2", ring: rect(0, 0, 50, 25) }],
    });
    expect(out).toHaveLength(1);
    expect(out[0].easementSf).toBeCloseTo(1250, -1);
  });
});

describe("corridor buffer → site feet round-trip (the NEW-11 reprojection chain)", () => {
  const ORIGIN = { lat: 29.55, lon: -95.8 }; // Houston/Katy area — the app's real frame
  it("a straight centerline buffers to ~the requested width once back in feet", () => {
    // A north-south centerline through the origin, ~2000 ft long, as [lon,lat].
    const a = feetToLatLng({ x: 0, y: -1000 }, ORIGIN.lat, ORIGIN.lon); // [lat, lng]
    const b = feetToLatLng({ x: 0, y: 1000 }, ORIGIN.lat, ORIGIN.lon);
    const band = corridorRingLngLat([[a[1], a[0]], [b[1], b[0]]], DEFAULT_CORRIDOR_WIDTH_FT);
    expect(band.length).toBeGreaterThanOrEqual(4);
    const feet = lngLatRingToFeet(band, ORIGIN.lon, ORIGIN.lat);
    const xs = feet.map((p) => p.x);
    const width = Math.max(...xs) - Math.min(...xs);
    expect(width).toBeGreaterThan(DEFAULT_CORRIDOR_WIDTH_FT * 0.95);
    expect(width).toBeLessThan(DEFAULT_CORRIDOR_WIDTH_FT * 1.05);
    // And a pond drawn across it reports a corridor overlap ≈ width × pond height.
    const pond = { id: "p1", ring: rect(-100, -100, 100, 100) };
    const out = pondEncumbranceConflicts({ ponds: [pond], corridorRings: [feet] });
    expect(out).toHaveLength(1);
    expect(out[0].corridorSf).toBeGreaterThan(DEFAULT_CORRIDOR_WIDTH_FT * 200 * 0.9);
    expect(out[0].corridorSf).toBeLessThan(DEFAULT_CORRIDOR_WIDTH_FT * 200 * 1.1);
  });
});
