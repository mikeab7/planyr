// NEW-1 (B1057 completion) — the channel cross-section cut: the missing fourth input to the
// screening-BFE engine. Pure geometry over the SAME 3DEP DEM grid the drainage check fetches.
import { describe, it, expect } from "vitest";
import {
  gridCellFt, sampleAtPixel, siteMaskFromLatLngRings, channelCell,
  flowBearing, channelSlope, cutSection,
} from "../src/workspaces/site-planner/lib/channelSection.js";
import { flowAccumulation } from "../src/workspaces/site-planner/lib/upstreamArea.js";
import { gridRequest, pixelToLatLng } from "../src/workspaces/site-planner/lib/demGrid.js";

/* A synthetic V-shaped valley: a channel running down the grid's centre column, dropping 1 ft per
 * row northward→southward, with banks rising 2 ft per column away from the centre. Every cell
 * drains toward the centre column then down it — the shape a real reach approximates. */
const W = 41, H = 41, CENTER = 20;
function valley() {
  const values = new Float32Array(W * H);
  const mask = new Uint8Array(W * H).fill(1);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      values[y * W + x] = 100 - y * 1.0 + Math.abs(x - CENTER) * 2.0;
    }
  }
  return { values, mask, width: W, height: H };
}
const GRID = valley();
const CELL_FT = 50;
const G = { ...GRID, cellFt: CELL_FT };
// A real request descriptor, so cutSection's pixel math runs against the shipped geometry model.
const REQ = gridRequest({ west: -96.0, south: 29.9, east: -95.98, north: 29.92 }, 15);

describe("gridCellFt — ground feet per cell", () => {
  it("applies the cos(latitude) mercator→ground correction (Houston ≈ 0.87)", () => {
    const ft = gridCellFt(REQ, 29.91);
    expect(ft).toBeGreaterThan(0);
    // Never larger than the uncorrected mercator size — the correction only shrinks.
    expect(ft).toBeLessThan(REQ.cellMeters * 3.281);
  });
  it("null on a request with no cell size — never a fabricated default", () => {
    expect(gridCellFt(null)).toBe(null);
    expect(gridCellFt({ cellMeters: 0 })).toBe(null);
  });
});

describe("sampleAtPixel — bilinear, void-honest", () => {
  it("reads a cell centre exactly", () => {
    expect(sampleAtPixel(GRID, CENTER + 0.5, 10.5)).toBeCloseTo(100 - 10, 5);
  });
  it("interpolates between cell centres", () => {
    const v = sampleAtPixel(GRID, CENTER + 1.0, 10.5); // midway between x=20 and x=21
    expect(v).toBeCloseTo((100 - 10 + (100 - 10 + 2)) / 2, 5);
  });
  it("returns null off-grid instead of clamping", () => {
    expect(sampleAtPixel(GRID, -5, 10)).toBe(null);
    expect(sampleAtPixel(GRID, W + 5, 10)).toBe(null);
  });
  it("returns null rather than interpolating across a void cell", () => {
    const holed = { ...GRID, mask: Uint8Array.from(GRID.mask) };
    holed.mask[10 * W + CENTER] = 0;
    expect(sampleAtPixel(holed, CENTER + 0.5, 10.5)).toBe(null);
  });
});

describe("channelCell — where the channel crosses", () => {
  const acc = flowAccumulation(G);
  it("picks a centre-column cell (the highest accumulation is in the channel)", () => {
    const i = channelCell({ acc, mask: G.mask, width: W, height: H });
    expect(i).toBeGreaterThanOrEqual(0);
    expect(i % W).toBe(CENTER);
  });
  it("respects a site mask — the crossing must be inside the footprint", () => {
    const siteMask = new Uint8Array(W * H);
    for (let y = 5; y <= 9; y++) for (let x = 15; x <= 25; x++) siteMask[y * W + x] = 1;
    const i = channelCell({ acc, mask: G.mask, width: W, height: H }, siteMask);
    const y = (i / W) | 0;
    expect(y).toBeGreaterThanOrEqual(5);
    expect(y).toBeLessThanOrEqual(9);
  });
  it("returns -1 with no accumulation grid — never cell 0 by accident", () => {
    expect(channelCell({ acc: null, mask: G.mask, width: W, height: H })).toBe(-1);
  });
});

describe("flowBearing — the averaged downstream direction", () => {
  it("points south (grid y increases) down the valley", () => {
    const b = flowBearing(G, 10 * W + CENTER);
    expect(b).not.toBe(null);
    expect(b.uy).toBeGreaterThan(0.9); // essentially straight down-grid
    expect(Math.abs(b.ux)).toBeLessThan(0.2);
    expect(b.steps).toBeGreaterThan(1);
  });
  it("null on a perfectly flat grid — no invented direction", () => {
    const flat = { values: new Float32Array(W * H), mask: new Uint8Array(W * H).fill(1), width: W, height: H, cellFt: CELL_FT };
    expect(flowBearing(flat, 10 * W + CENTER)).toBe(null);
  });
});

describe("channelSlope — the S in Manning's equation", () => {
  it("recovers the built-in grade (1 ft drop per 50-ft cell = 0.02)", () => {
    const s = channelSlope(G, 5 * W + CENTER);
    expect(s).not.toBe(null);
    expect(s.slopeFtPerFt).toBeCloseTo(1 / CELL_FT, 3);
    expect(s.dropFt).toBeGreaterThan(0);
  });
  it("null on a flat reach rather than a fabricated minimum slope", () => {
    const flat = { values: new Float32Array(W * H), mask: new Uint8Array(W * H).fill(1), width: W, height: H, cellFt: CELL_FT };
    expect(channelSlope(flat, 10 * W + CENTER)).toBe(null);
  });
});

describe("cutSection — the station/elevation profile across the channel", () => {
  const bearing = { ux: 0, uy: 1 }; // flow runs south → section runs east-west
  const cell = 20 * W + CENTER;
  const r = cutSection(GRID, REQ, cell, bearing, { halfWidthFt: 400, samples: 41, cellFt: CELL_FT });

  it("produces a solvable section with real relief", () => {
    expect(r.ok).toBe(true);
    expect(r.station.length).toBeGreaterThan(20);
    expect(r.reliefFt).toBeGreaterThan(1);
    expect(r.sectionTopFt).toBeGreaterThan(r.bedFt);
  });
  it("is V-shaped about the channel — the low point sits at offset 0", () => {
    const low = r.station.reduce((a, p) => (p.elevFt < a.elevFt ? p : a), r.station[0]);
    expect(Math.abs(low.offsetFt)).toBeLessThan(30); // within one cell of centre
    const ends = [r.station[0], r.station[r.station.length - 1]];
    for (const e of ends) expect(e.elevFt).toBeGreaterThan(low.elevFt + 1);
  });
  it("stations run left→right monotonically (sectionAtWse integrates over them)", () => {
    for (let i = 1; i < r.station.length; i++) {
      expect(r.station[i].offsetFt).toBeGreaterThan(r.station[i - 1].offsetFt);
    }
  });
  it("cuts PERPENDICULAR to flow — rotating the bearing 90° gives a different profile SHAPE", () => {
    // Across the channel the profile is V-shaped (low in the middle). Rotate the bearing 90° and
    // the cut runs ALONG the channel instead, where elevation falls monotonically down-grade —
    // so the low point moves to one end. That shape change is the perpendicularity proof.
    const along = cutSection(GRID, REQ, cell, { ux: 1, uy: 0 }, { halfWidthFt: 400, samples: 41, cellFt: CELL_FT });
    expect(along.ok).toBe(true);
    const lowAlong = along.station.reduce((a, p) => (p.elevFt < a.elevFt ? p : a), along.station[0]);
    expect(Math.abs(lowAlong.offsetFt)).toBeGreaterThan(300); // at an END, not the middle
    const lowAcross = r.station.reduce((a, p) => (p.elevFt < a.elevFt ? p : a), r.station[0]);
    expect(Math.abs(lowAcross.offsetFt)).toBeLessThan(30);    // in the MIDDLE
  });

  it("LOUD-FAILURE: a flat grid yields no section, with a reason", () => {
    const flat = { values: new Float32Array(W * H), mask: new Uint8Array(W * H).fill(1), width: W, height: H };
    const f = cutSection(flat, REQ, cell, bearing, { halfWidthFt: 400, samples: 41, cellFt: CELL_FT });
    expect(f.ok).toBe(false);
    expect(f.reason).toMatch(/flat/i);
  });
  it("LOUD-FAILURE: no bearing → an explicit reason, never a default direction", () => {
    const f = cutSection(GRID, REQ, cell, null, { cellFt: CELL_FT });
    expect(f.ok).toBe(false);
    expect(f.reason).toMatch(/flow direction/i);
  });
  it("LOUD-FAILURE: a section mostly off-grid fails rather than returning a stub", () => {
    const f = cutSection(GRID, REQ, 20 * W + 1, { ux: 0, uy: 1 }, { halfWidthFt: 5000, samples: 41, cellFt: CELL_FT });
    expect(f.ok).toBe(false);
    expect(f.reason).toMatch(/outside the sampled terrain/i);
  });
  it("void cells are counted, not silently interpolated over", () => {
    // Void a band the ±400-ft cut actually crosses (±8 cells about column 20).
    const holed = { ...GRID, mask: Uint8Array.from(GRID.mask) };
    for (let y = 19; y <= 21; y++) for (let x = 13; x <= 15; x++) holed.mask[y * W + x] = 0;
    const h = cutSection(holed, REQ, cell, bearing, { halfWidthFt: 400, samples: 41, cellFt: CELL_FT });
    expect(h.ok).toBe(true);
    expect(h.voidCount).toBeGreaterThan(0);
    expect(h.station.length).toBeLessThan(41);
  });
});

describe("siteMaskFromLatLngRings", () => {
  it("rasterises a ring built from the grid's own pixel geometry", () => {
    // Build a lat/lng ring from four grid pixels, then check the mask lands back on those cells.
    const corners = [[8, 8], [8, 14], [14, 14], [14, 8]].map(([x, y]) => pixelToLatLng(REQ, x, y));
    const m = siteMaskFromLatLngRings(REQ, [corners], REQ.width, REQ.height);
    expect(m).not.toBe(null);
    expect(m[11 * REQ.width + 11]).toBe(1); // inside
    expect(m[2 * REQ.width + 2]).toBe(0);   // outside
  });
  it("null with no usable ring — never an all-ones mask", () => {
    expect(siteMaskFromLatLngRings(REQ, [], 10, 10)).toBe(null);
    expect(siteMaskFromLatLngRings(REQ, [[[1, 2]]], 10, 10)).toBe(null);
    expect(siteMaskFromLatLngRings(null, [[[1, 2], [3, 4], [5, 6]]], 10, 10)).toBe(null);
  });
});
