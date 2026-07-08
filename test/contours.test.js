import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  buildContours, pickInterval, dilateVoids, stripRing,
} from "../src/workspaces/site-planner/lib/contours.js";
import {
  decodeGrid, maskedSmooth, pixelToMerc,
} from "../src/workspaces/site-planner/lib/demGrid.js";

const grid = (width, height, fn) => {
  const values = new Float32Array(width * height);
  const mask = new Uint8Array(width * height).fill(1);
  for (let j = 0; j < height; j++) for (let i = 0; i < width; i++) values[j * width + i] = fn(i, j);
  return { values, mask, width, height };
};

// ---------------------------------------------------------------------------
describe("pickInterval — 1 ft is the workhorse, steep views auto-coarsen", () => {
  it("Houston-scale ranges get the 1-ft interval", () => {
    expect(pickInterval(4)).toBe(1);
    expect(pickInterval(29)).toBe(1);
    expect(pickInterval(50)).toBe(1);
  });
  it("coarser steps kick in only when 1 ft would drown the view", () => {
    expect(pickInterval(80)).toBe(2);
    expect(pickInterval(220)).toBe(5);
    expect(pickInterval(400)).toBe(10);
  });
});

// ---------------------------------------------------------------------------
// THE RAMP CALIBRATION TEST. This pins the full geometric chain to one convention:
// d3-contour's smoothed output is in continuous grid space with cell values at cell
// CENTERS (value i sits at px i+0.5) — measured against d3-contour 4.x, not assumed.
// demGrid.pixelToMerc and sampleAtLatLng use the SAME convention, so contours, the
// hover readout, and the cross-section tool can never disagree by half a cell.
describe("ramp calibration — the one convention everything shares", () => {
  it("a pure x-ramp puts the level-20 contour at exactly px = 20.5", () => {
    const g = grid(40, 8, (i) => i); // elevation(ft) = column index
    const out = buildContours(g);
    expect(out.interval).toBe(1);
    const lv = out.levels.find((l) => l.level === 20);
    expect(lv).toBeTruthy();
    expect(lv.lines.length).toBe(1);
    const line = lv.lines[0];
    // Douglas–Peucker collapses the straight line to its two endpoints — every
    // surviving vertex must sit at EXACTLY px = 20.5 (cell-center convention), and
    // the line must still span most of the grid's interior rows.
    expect(line.length).toBeGreaterThanOrEqual(2);
    for (const p of line) expect(p[0]).toBeCloseTo(20.5, 6);
    const ys = line.map((p) => p[1]);
    expect(Math.max(...ys) - Math.min(...ys)).toBeGreaterThanOrEqual(4);
  });
  it("…and pixelToMerc lands that line on the exact mercator x", () => {
    const req = { bbox: { xmin: 1000, ymin: 0, xmax: 1040, ymax: 8 }, cellMeters: 1, width: 40, height: 8 };
    const [mx] = pixelToMerc(req, 20.5, 4);
    expect(mx).toBe(1020.5);
  });
  it("the grid-border frame is stripped — no contour point rides the border", () => {
    const g = grid(40, 8, (i) => i);
    const out = buildContours(g);
    for (const lv of out.levels) for (const line of lv.lines) for (const p of line) {
      expect(p[0]).toBeGreaterThan(0.005);
      expect(p[0]).toBeLessThan(39.995);
      expect(p[1]).toBeGreaterThan(0.005);
      expect(p[1]).toBeLessThan(7.995);
    }
  });
});

// ---------------------------------------------------------------------------
describe("closed shapes and voids", () => {
  it("a cone yields a CLOSED ring at the right radius", () => {
    const g = grid(41, 41, (i, j) => 30 - Math.hypot(i + 0.5 - 20.5, j + 0.5 - 20.5));
    const out = buildContours(g);
    const lv = out.levels.find((l) => l.level === 20);
    expect(lv).toBeTruthy();
    expect(lv.lines.length).toBe(1);
    const ring = lv.lines[0];
    expect(ring[0]).toEqual(ring[ring.length - 1]); // closed
    for (const p of ring) {
      expect(Math.hypot(p[0] - 20.5, p[1] - 20.5)).toBeCloseTo(10, 0.5);
    }
  });
  it("contour lines BREAK at voids — no bridging, no edge-hugging outline", () => {
    const w = 40, h = 21;
    const g = grid(w, h, (i) => i);
    for (let j = 6; j <= 14; j++) for (let i = 15; i <= 25; i++) {
      g.mask[j * w + i] = 0; g.values[j * w + i] = 0; // pond block
    }
    const out = buildContours(g);
    const voids = dilateVoids(g.mask, w, h);
    const lv20 = out.levels.find((l) => l.level === 20); // px 20.5 runs straight through the pond
    expect(lv20).toBeTruthy();
    expect(lv20.lines.length).toBeGreaterThanOrEqual(2); // split above/below the void
    for (const level of out.levels) for (const line of level.lines) {
      for (let s = 1; s < line.length; s++) {
        const mx = (line[s][0] + line[s - 1][0]) / 2, my = (line[s][1] + line[s - 1][1]) / 2;
        const ci = Math.min(h - 1, Math.max(0, Math.floor(my))) * w +
          Math.min(w - 1, Math.max(0, Math.floor(mx)));
        expect(voids[ci]).toBe(0); // no drawn segment may touch the dilated void halo
      }
    }
  });
  it("an all-void or flat grid yields no lines (never a fabricated contour)", () => {
    const flat = grid(10, 10, () => 42);
    expect(buildContours(flat).levels).toEqual([]);
    const dead = grid(10, 10, () => 0);
    dead.mask.fill(0);
    expect(buildContours(dead).levels).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
describe("labels — sparse, index contours only", () => {
  it("labels land on index levels (every 5th interval), capped, on the line", () => {
    const g = grid(60, 40, (i) => i * 0.7); // range ~41 ft -> 1-ft interval
    const out = buildContours(g, { labelCap: 6 });
    expect(out.labels.length).toBeGreaterThan(0);
    expect(out.labels.length).toBeLessThanOrEqual(6);
    for (const lab of out.labels) {
      expect(lab.level % 5).toBe(0);
      // the label point must sit on that level's polyline (it IS a vertex of it)
      const lv = out.levels.find((l) => l.level === lab.level);
      const onLine = lv.lines.some((line) => line.some((p) => p[0] === lab.px && p[1] === lab.py));
      expect(onLine).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
describe("stripRing — cyclic run assembly (exported unit)", () => {
  const voids = new Uint8Array(100); // none
  it("a fully clean ring stays one CLOSED ring", () => {
    const ring = [[2, 2], [6, 2], [6, 6], [2, 6], [2, 2]];
    const runs = stripRing(ring, 10, 10, voids);
    expect(runs.length).toBe(1);
    expect(runs[0][0]).toEqual(runs[0][runs[0].length - 1]);
  });
  it("a ring touching the border splits into open interior runs", () => {
    const ring = [[0, 5], [4, 3], [8, 5], [4, 7], [0, 5]]; // two vertices path through border x=0
    const runs = stripRing(ring, 10, 10, voids);
    expect(runs.length).toBe(1);
    const run = runs[0];
    expect(run[0]).not.toEqual(run[run.length - 1]); // open
    for (const p of run) expect(p[0]).toBeGreaterThan(0.005);
  });
});

// ---------------------------------------------------------------------------
// End-to-end on the REAL captured tile: decode -> smooth -> contours, then check the
// serialized artifact stays under the gisCache per-entry cap (512 KB) once rounded.
describe("fixture end-to-end (real Katy 3DEP tile)", () => {
  it("produces 1-ft contours with sane levels and a cacheable artifact", () => {
    const p = fileURLToPath(new URL("./fixtures/dep-katy-463x400.lerc", import.meta.url));
    const b = readFileSync(p);
    const g = decodeGrid(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength),
      { width: 463, height: 400 });
    const smoothed = maskedSmooth(g.values, g.mask, g.width, g.height, 1.0);
    const out = buildContours({ values: smoothed, mask: g.mask, width: g.width, height: g.height });
    expect(out.interval).toBe(1);
    expect(out.levels.length).toBeGreaterThan(15);        // ~121-150 ft range
    expect(out.levels.every((l) => l.level > 115 && l.level < 155)).toBe(true);
    expect(out.labels.length).toBeGreaterThan(0);
    // artifact size, with coordinates rounded the way terrainLayers serializes them
    const rounded = out.levels.map((l) => ({
      ...l, lines: l.lines.map((line) => line.map(([x, y]) => [Math.round(x * 100) / 100, Math.round(y * 100) / 100])),
    }));
    const bytes = JSON.stringify(rounded).length;
    expect(bytes).toBeLessThan(512 * 1024);
  });
});
