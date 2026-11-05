import { describe, it, expect } from "vitest";
import {
  maskOutlinePath, maskHatchPixels, maskDistance, maskVisualCentre, maskTightBox, HATCH_ALPHA, HATCH_BAND_FT, HATCH_SS,
  traceEdges, cellPaint, cellsPixels, cellsOutlinePath, cellsLattice, slopeOnly, hexToRgb,
  CUT_RGB, FILL_RGB, OUT_RGB,
} from "../src/workspaces/site-planner/lib/gradingPaint.js";
import { buildLattice, prepareSweep, maskAt } from "../src/workspaces/site-planner/lib/buildableGround.js";
import { buildProposedSurface } from "../src/workspaces/site-planner/lib/proposedSurface.js";

const rect = (x, y, w, h) => [{ x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h }];

describe("Level-pad limit painting — a LINE, never a fill", () => {
  const lat = buildLattice({ bbox: [-50, -50, 650, 650], cell: 10, sample: (x) => 0.05 * x });
  const ctx = prepareSweep({ lattice: lat, rings: [rect(0, 0, 600, 600)] });
  const m = maskAt(ctx, 15, 2, 12);
  const info = { mask: m.mask, nx: lat.nx, ny: lat.ny, x0: lat.x0, y0: lat.y0, cell: lat.cell };
  const rgb = [10, 20, 30];
  const hatch = maskHatchPixels(info, rgb);
  const dist = maskDistance(info);
  const cellOf = (sx, sy) => ((sy / HATCH_SS) | 0) * lat.nx + ((sx / HATCH_SS) | 0);
  it("the hatch texture is supersampled and tinted at ~12% of the accent", () => {
    expect(hatch.w).toBe(lat.nx * HATCH_SS); expect(hatch.h).toBe(lat.ny * HATCH_SS);
    const k = hatch.pixels.findIndex((v, i) => i % 4 === 3 && v > 0);
    expect(k).toBeGreaterThan(-1);
    expect([hatch.pixels[k - 3], hatch.pixels[k - 2], hatch.pixels[k - 1]]).toEqual(rgb);
    expect(hatch.pixels[k]).toBe(Math.round(HATCH_ALPHA * 255));
  });
  it("NOTHING is hatched outside the mask, and nothing deeper than 40 ft inside it", () => {
    let inked = 0;
    for (let sy = 0; sy < hatch.h; sy++) for (let sx = 0; sx < hatch.w; sx++) {
      if (hatch.pixels[(sy * hatch.w + sx) * 4 + 3] === 0) continue;
      inked++;
      const k = cellOf(sx, sy);
      expect(m.mask[k]).toBe(1);
      expect(dist[k]).toBeLessThanOrEqual(HATCH_BAND_FT / lat.cell + 1e-6);
    }
    expect(inked).toBeGreaterThan(200);
  });
  it("the interior of a big pad is left clear — it is a line with a hatch on its inside edge, not a tint", () => {
    let interiorCells = 0, interiorInk = 0;
    for (let sy = 0; sy < hatch.h; sy++) for (let sx = 0; sx < hatch.w; sx++) {
      const k = cellOf(sx, sy);
      if (!m.mask[k] || dist[k] <= HATCH_BAND_FT / lat.cell + 1) continue;
      interiorCells++;
      if (hatch.pixels[(sy * hatch.w + sx) * 4 + 3] > 0) interiorInk++;
    }
    expect(interiorCells).toBeGreaterThan(1000);
    expect(interiorInk).toBe(0);
  });
  it("the stripes are diagonal: both a pixel and its neighbour along the stripe's direction are inked", () => {
    const at = (sx, sy) => hatch.pixels[(sy * hatch.w + sx) * 4 + 3] > 0;
    let checked = 0;
    for (let sy = 0; sy < hatch.h - 1 && checked < 200; sy++) for (let sx = 1; sx < hatch.w; sx++) {
      if (at(sx, sy) && at(sx - 1, sy + 1)) { checked++; break; }
    }
    expect(checked).toBeGreaterThan(50);
  });
  it("the outline is the mask's perimeter: total traced length = 10 ft × boundary cell sides", () => {
    const d = maskOutlinePath(info);
    let sides = 0;
    const at = (i, j) => (i < 0 || j < 0 || i >= lat.nx || j >= lat.ny ? 0 : m.mask[j * lat.nx + i]);
    for (let j = 0; j < lat.ny; j++) for (let i = 0; i < lat.nx; i++) if (at(i, j)) sides += (!at(i - 1, j)) + (!at(i + 1, j)) + (!at(i, j - 1)) + (!at(i, j + 1));
    let len = 0;
    for (const mm of d.matchAll(/M(-?[\d.]+) (-?[\d.]+)([HV])(-?[\d.]+)/g)) len += Math.abs(+mm[4] - (mm[3] === "H" ? +mm[1] : +mm[2]));
    expect(Math.round(len)).toBe(sides * 10);
  });
  it("the visual centre is an in-mask cell as far from every edge as the mask allows", () => {
    const c = maskVisualCentre(info);
    const i = Math.floor((c.x - info.x0) / info.cell), j = Math.floor((c.y - info.y0) / info.cell);
    expect(m.mask[j * lat.nx + i]).toBe(1);
    let max = 0; for (let k = 0; k < dist.length; k++) if (dist[k] > max) max = dist[k];
    expect(dist[j * lat.nx + i]).toBeGreaterThanOrEqual(max - 1e-6);
  });
  it("a plain square: centre in the middle, distance 1 at the edge, tight box = the square", () => {
    const sq = { mask: new Uint8Array(100), nx: 10, ny: 10, x0: 0, y0: 0, cell: 10 };
    for (let j = 2; j < 8; j++) for (let i = 2; i < 8; i++) sq.mask[j * 10 + i] = 1;
    const c = maskVisualCentre(sq);
    expect(Math.abs(c.x - 50)).toBeLessThanOrEqual(10); expect(Math.abs(c.y - 50)).toBeLessThanOrEqual(10);
    expect(maskDistance(sq)[2 * 10 + 2]).toBe(1);
    expect(maskTightBox(sq)).toEqual({ x0: 20, y0: 20, x1: 80, y1: 80 });
    expect(maskVisualCentre({ ...sq, mask: new Uint8Array(100) })).toBeNull();
    expect(maskTightBox({ ...sq, mask: new Uint8Array(100) })).toBeNull();
  });
  it("traceEdges on one cell is a unit square", () => {
    const d = traceEdges((i, j) => i === 0 && j === 0, 1, 1, 0, 0, 5, 5);
    expect((d.match(/M/g) || []).length).toBe(4);
  });
});

describe("Cut & Fill painting", () => {
  const els = [
    { id: "b", type: "building", ring: rect(0, 0, 200, 100), padElevFt: 100 },
    { id: "c", type: "paving", ring: rect(0, 100, 200, 100), dockStack: { x: 100, y: 50 }, hostId: "b" },
  ];
  const s = buildProposedSurface({ els, ffeFt: 100, existAt: (p) => 100 - 0.05 * (p.x - 100), parcelRings: [],
    grading: { slopeRatio: 2, shoulderFt: 5, setbackRings: [rect(-8, -8, 216, 216)] }, opts: { maxCells: 20000, minCellFt: 4 } });
  it("rust for cut, blue for fill, alpha grows with depth, red for outside the setback", () => {
    expect(cellPaint({ dzFt: -3 }).rgb).toEqual(CUT_RGB);
    expect(cellPaint({ dzFt: 3 }).rgb).toEqual(FILL_RGB);
    expect(cellPaint({ dzFt: 6 }).a).toBeGreaterThan(cellPaint({ dzFt: 1 }).a);
    // ROUND 7 (NEW-2, amends B2396674): the band is a light TINT under the contours — a thin shallow band still reads (≥ 0.12)
    // and a deep one never passes a quarter opacity, so the contour family carries the picture at the 250-ft scale
    expect(cellPaint({ dzFt: 0.5 }).a).toBeGreaterThanOrEqual(0.12);
    expect(cellPaint({ dzFt: 40 }).a).toBeLessThanOrEqual(0.25);
    expect(cellPaint({ dzFt: 3, out: true }).rgb).toEqual(OUT_RGB);
    expect(cellPaint({ dzFt: 0.01 })).toBeNull();
    expect(cellPaint({ dzFt: null }).kind).toBe("void");
  });
  it("ONLY the slopes are painted: no cell inside any element polygon carries ink, and every slope cell with a depth does", () => {
    const cp = cellsPixels(s.grid.cells, slopeOnly);
    const L = cellsLattice(s.grid.cells);
    let slope = 0, element = 0;
    for (const c of s.grid.cells) {
      const { i, j } = L.at(c); const k = j * cp.nx + i;
      expect(cp.present[k]).toBe(1);                        // every cell still marks the daylight set
      const p = cellPaint(c);
      if (c.wedge) {
        slope++;
        expect(cp.pixels[k * 4 + 3]).toBe(p ? Math.round(p.a * 255) : 0);
      } else {
        element++;
        expect(cp.pixels[k * 4 + 3]).toBe(0);              // the pad, court, rows, lots, walks: never tinted
      }
    }
    expect(slope).toBeGreaterThan(50); expect(element).toBeGreaterThan(50);
    expect(s.grid.outside.count).toBeGreaterThan(0);          // the slope really does leave the 30 ft setback
    expect(s.grid.cells.some((c) => c.out)).toBe(true);
  });
  it("red survives on the slopes (the setback breach is a slope cell)", () => {
    const cp = cellsPixels(s.grid.cells, slopeOnly);
    const L = cellsLattice(s.grid.cells);
    const redSlope = s.grid.cells.filter((c) => c.wedge && c.out);
    expect(redSlope.length).toBeGreaterThan(0);
    for (const c of redSlope.slice(0, 50)) { const { i, j } = L.at(c); expect(cp.pixels[(j * cp.nx + i) * 4]).toBe(OUT_RGB[0]); }
  });
  it("without a filter every cell is inked (the old behaviour is only reachable on purpose)", () => {
    const all = cellsPixels(s.grid.cells);
    const L = cellsLattice(s.grid.cells);
    const some = s.grid.cells.find((c) => !c.wedge && cellPaint(c));
    const { i, j } = L.at(some);
    expect(all.pixels[(j * all.nx + i) * 4 + 3]).toBeGreaterThan(0);
  });
  it("the daylight outline traces the graded set", () => {
    const cp = cellsPixels(s.grid.cells, slopeOnly);
    expect(cellsOutlinePath(cp).length).toBeGreaterThan(40);
  });
});
