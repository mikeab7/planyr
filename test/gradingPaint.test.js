import { describe, it, expect } from "vitest";
import {
  maskPixels, maskOutlinePath, traceEdges, cellPaint, cellsPixels, cellsOutlinePath, cellsLattice, hexToRgb,
  CUT_RGB, FILL_RGB, OUT_RGB,
} from "../src/workspaces/site-planner/lib/gradingPaint.js";
import { buildLattice, prepareSweep, maskAt } from "../src/workspaces/site-planner/lib/buildableGround.js";
import { buildProposedSurface } from "../src/workspaces/site-planner/lib/proposedSurface.js";

const rect = (x, y, w, h) => [{ x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h }];

describe("Buildable layer painting", () => {
  const lat = buildLattice({ bbox: [-50, -50, 650, 650], cell: 10, sample: (x) => 0.05 * x });
  const ctx = prepareSweep({ lattice: lat, rings: [rect(0, 0, 600, 600)] });
  const m = maskAt(ctx, 15, 2, 12);
  const info = { mask: m.mask, nx: lat.nx, ny: lat.ny, x0: lat.x0, y0: lat.y0, cell: lat.cell };
  it("the painted mask equals the engine mask CELL FOR CELL", () => {
    const px = maskPixels(info, hexToRgb("#0E9F6E"));
    let painted = 0;
    for (let k = 0; k < m.mask.length; k++) {
      expect(px[k * 4 + 3] > 0).toBe(!!m.mask[k]);
      painted += px[k * 4 + 3] > 0 ? 1 : 0;
    }
    expect(painted).toBe(m.cells);
    expect(m.cells).toBeGreaterThan(100);
  });
  it("tint is ~30% of the accent", () => {
    const px = maskPixels(info, [10, 20, 30]);
    const k = m.mask.indexOf(1);
    expect([px[k * 4], px[k * 4 + 1], px[k * 4 + 2]]).toEqual([10, 20, 30]);
    expect(px[k * 4 + 3]).toBe(Math.round(0.3 * 255));
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
    expect(cellPaint({ dzFt: 3, out: true }).rgb).toEqual(OUT_RGB);
    expect(cellPaint({ dzFt: 0.01 })).toBeNull();
    expect(cellPaint({ dzFt: null }).kind).toBe("void");
  });
  it("every retained cell lands on its lattice slot with its own colour", () => {
    const cp = cellsPixels(s.grid.cells);
    const L = cellsLattice(s.grid.cells);
    for (const c of s.grid.cells.slice(0, 800)) {
      const { i, j } = L.at(c); const k = j * cp.nx + i;
      const p = cellPaint(c);
      expect(cp.present[k]).toBe(1);
      expect(cp.pixels[k * 4 + 3]).toBe(p ? Math.round(p.a * 255) : 0);
    }
    expect(s.grid.outside.count).toBeGreaterThan(0);          // the slope really does leave the 30 ft setback
    expect(s.grid.cells.some((c) => c.out)).toBe(true);
  });
  it("the daylight outline traces the graded set", () => {
    const cp = cellsPixels(s.grid.cells);
    expect(cellsOutlinePath(cp).length).toBeGreaterThan(40);
  });
});
