import { describe, it, expect } from "vitest";
import { ParcelIndex, drawParcelTile, prepareParcel, geometryBBox, geometryLines, tileLngLatBounds } from "../src/workspaces/site-planner/lib/parcelTileLayer.js";

/* NEW-1 — the per-tile outline drawer. The owner's Bartow view at z14 holds ~16.7k lots; the old canvas
 * renderer's settle cost scaled with that held count (75–94 ms). This is the CI-runnable half of the
 * acceptance: drawing a settle's worth of tiles from a z14-density index stays inside one frame budget,
 * and the work is bounded by what a tile CONTAINS, not by what is held. */

const mockCtx = () => {
  const c = { moves: 0, lines: 0, strokes: 0, clears: 0, begins: 0 };
  return Object.assign(c, {
    clearRect() { c.clears++; }, beginPath() { c.begins++; },
    moveTo() { c.moves++; }, lineTo() { c.lines++; }, stroke() { c.strokes++; },
  });
};

// A Bartow-like grid: 17k lots (~110 m pitch → ~400 lots per z14 tile, matching the 7,124-in-view / ~17-tile measurement) around 34.20 / -84.83.
function denseIndex(n = 17000, step = 0.001, lng0 = -84.83, lat0 = 34.20) {
  const idx = new ParcelIndex();
  const side = Math.ceil(Math.sqrt(n));
  let made = 0;
  for (let i = 0; i < side && made < n; i++) for (let j = 0; j < side && made < n; j++, made++) {
    const x = lng0 + (i - side / 2) * step, y = lat0 + (j - side / 2) * step, h = step * 0.45;
    const geometry = { type: "Polygon", coordinates: [[[x, y], [x + h, y], [x + h, y + h], [x, y + h], [x, y]]] };
    idx.add({ feature: { id: made, geometry }, ...prepareParcel(geometry) });
  }
  return idx;
}

// World tile containing a lng/lat at zoom z.
const tileOf = (lng, lat, z) => {
  const n = Math.pow(2, z);
  const x = Math.floor(((lng + 180) / 360) * n);
  const y = Math.floor((0.5 - Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360)) / (2 * Math.PI)) * n);
  return { x, y, z };
};

describe("geometry helpers", () => {
  it("bbox and lines for polygons, multipolygons, lines; nothing for points", () => {
    const poly = { type: "Polygon", coordinates: [[[0, 0], [2, 0], [2, 1], [0, 0]]] };
    expect(geometryBBox(poly)).toEqual([0, 0, 2, 1]);
    expect(geometryLines(poly)).toHaveLength(1);
    const mp = { type: "MultiPolygon", coordinates: [[[[0, 0], [1, 0], [1, 1], [0, 0]]], [[[5, 5], [6, 5], [6, 6], [5, 5]]]] };
    expect(geometryLines(mp)).toHaveLength(2);
    expect(geometryBBox(mp)).toEqual([0, 0, 6, 6]);
    expect(geometryLines({ type: "Point", coordinates: [1, 1] })).toEqual([]);
    expect(geometryBBox(null)).toBeNull();
  });
  it("tile bounds contain the tile's own centre lng/lat and are padded", () => {
    const t = tileOf(-84.83, 34.2, 14);
    const b = tileLngLatBounds(t.x, t.y, t.z);
    expect(b[0]).toBeLessThan(-84.83); expect(b[2]).toBeGreaterThan(-84.83);
    expect(b[1]).toBeLessThan(34.2); expect(b[3]).toBeGreaterThan(34.2);
  });
});

describe("drawParcelTile", () => {
  const idx = denseIndex();
  it("draws only the lots inside the tile, as ONE stroked path", () => {
    const t = tileOf(-84.83, 34.2, 14);
    const ctx = mockCtx();
    const drawn = drawParcelTile(ctx, idx, t);
    expect(drawn).toBeGreaterThan(50);
    expect(drawn).toBeLessThan(idx.size / 10); // a tile holds a small slice of what is held
    expect(ctx.strokes).toBe(1);
    expect(ctx.moves).toBe(drawn); // one ring per lot
  });
  it("a tile with nothing under it draws nothing and strokes nothing", () => {
    const ctx = mockCtx();
    expect(drawParcelTile(ctx, idx, tileOf(-100, 40, 14))).toBe(0);
    expect(ctx.strokes).toBe(0);
  });
  it("lots added/removed change what a tile draws (index is the source of truth)", () => {
    const small = new ParcelIndex();
    const g = { type: "Polygon", coordinates: [[[-84.83, 34.2], [-84.8299, 34.2], [-84.8299, 34.2001], [-84.83, 34.2]]] };
    const item = prepareParcel(g);
    const t = tileOf(-84.83, 34.2, 15);
    small.add(item);
    expect(drawParcelTile(mockCtx(), small, t)).toBe(1);
    small.delete(item);
    expect(drawParcelTile(mockCtx(), small, t)).toBe(0);
  });
  it("SETTLE COST: drawing a viewport of z14 tiles from a 17k-lot index stays under one frame (16 ms)", () => {
    // A 1280x860 view at z14 is at most 6x4 = 24 tiles; a zoom settle creates ALL of them (new tile zoom).
    const c = tileOf(-84.83, 34.2, 14);
    const tiles = [];
    for (let dx = -3; dx <= 2; dx++) for (let dy = -2; dy <= 1; dy++) tiles.push({ x: c.x + dx, y: c.y + dy, z: 14 });
    const settle = () => { let drawn = 0; const t0 = performance.now(); for (const t of tiles) drawn += drawParcelTile(mockCtx(), idx, t); return { ms: performance.now() - t0, drawn }; };
    const cold = settle(); // first call after module load — JIT not warm; reported, not gated
    const runs = Array.from({ length: 7 }, settle).sort((a, b) => a.ms - b.ms);
    const median = runs[3];
    console.log(`  settle (24 z14 tiles, ${idx.size} held, ${median.drawn} drawn): cold ${cold.ms.toFixed(2)} ms, median-of-7 warm ${median.ms.toFixed(2)} ms`);
    expect(median.drawn).toBeGreaterThan(3000);
    expect(median.ms).toBeLessThan(16);
  });
  it("cost is independent of how many lots are held out of view", () => {
    const near = denseIndex(2000);
    const far = denseIndex(17000);
    const t = tileOf(-84.83, 34.2, 14);
    const time = (index) => { drawParcelTile(mockCtx(), index, t); const t0 = performance.now(); for (let i = 0; i < 20; i++) drawParcelTile(mockCtx(), index, t); return (performance.now() - t0) / 20; };
    const a = time(near), b = time(far);
    // 8.5x the lots held; the tile draw must not scale with it (the bbox reject is the only per-held cost).
    expect(b).toBeLessThan(Math.max(a * 6, 2));
  });
});
