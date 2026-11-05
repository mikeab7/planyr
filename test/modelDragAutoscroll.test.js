/* dragAutoscroll.js — the pure geometry behind drag-select autoscroll in the Spreadsheet grid
 * (B2452528). DOM-free: the live behaviour is e2e/model-drag-autoscroll.spec.js. */
import { describe, it, expect } from "vitest";
import { createSheet } from "../src/workspaces/model/lib/sheetModel.js";
import { buildRowOffsets } from "../src/workspaces/model/lib/rowLayout.js";
import { axisVelocity, axisIndexAt, EDGE_SLOP, MIN_SPEED, MAX_SPEED } from "../src/workspaces/model/lib/dragAutoscroll.js";
import { readFileSync } from "node:fs";

const ROWS = 500;
const offsets = buildRowOffsets(createSheet(), ROWS);
const H = offsets[1]; // default row height
const HEADER = 30, VIEW = 400;

describe("axisVelocity", () => {
  it("is 0 while the pointer is comfortably inside the cell area", () => {
    expect(axisVelocity(200, HEADER, VIEW)).toBe(0);
  });
  it("scrolls forward at/past the far edge and backward at/past the near edge", () => {
    expect(axisVelocity(VIEW, HEADER, VIEW)).toBeGreaterThan(0);
    expect(axisVelocity(VIEW - EDGE_SLOP + 1, HEADER, VIEW)).toBeGreaterThan(0);
    expect(axisVelocity(HEADER, HEADER, VIEW)).toBeLessThan(0);
    expect(axisVelocity(-50, HEADER, VIEW)).toBeLessThan(0);
  });
  it("ramps with the distance past the edge and caps", () => {
    const near = axisVelocity(VIEW + 2, HEADER, VIEW), far = axisVelocity(VIEW + 80, HEADER, VIEW);
    expect(near).toBeGreaterThanOrEqual(MIN_SPEED);
    expect(far).toBeGreaterThan(near);
    expect(axisVelocity(VIEW + 100000, HEADER, VIEW)).toBe(MAX_SPEED);
    expect(axisVelocity(-100000, HEADER, VIEW)).toBe(-MAX_SPEED);
  });
});

describe("axisIndexAt (rows)", () => {
  const base = { offsets, origin: HEADER, frozenCount: 0, viewSize: VIEW };
  it("maps by scroll offset + row heights, reaching rows that are not rendered", () => {
    expect(axisIndexAt({ ...base, pos: HEADER + 1, scroll: 0 })).toBe(0);
    // scrolled 200 rows down: a pointer near the top reaches row ~200 — far past any rendered window
    expect(axisIndexAt({ ...base, pos: HEADER + 1, scroll: 200 * H })).toBe(200);
  });
  it("a pointer below the viewport reaches the last VISIBLE row, never an unscrolled-to one", () => {
    const atEdge = axisIndexAt({ ...base, pos: VIEW - 1, scroll: 0 });
    expect(axisIndexAt({ ...base, pos: VIEW + 500, scroll: 0 })).toBe(atEdge);
  });
  it("over the header: index 0 when scrolled home, the first visible row otherwise", () => {
    expect(axisIndexAt({ ...base, pos: 5, scroll: 0 })).toBe(0);
    expect(axisIndexAt({ ...base, pos: -300, scroll: 50 * H })).toBe(50);
  });
  it("frozen rows: a pointer over the frozen band reaches that frozen row", () => {
    const f = { ...base, frozenCount: 2 };
    expect(axisIndexAt({ ...f, pos: HEADER + 1, scroll: 100 * H })).toBe(0);
    expect(axisIndexAt({ ...f, pos: HEADER + H + 1, scroll: 100 * H })).toBe(1);
    // below the frozen band it is a scrolling row
    expect(axisIndexAt({ ...f, pos: HEADER + 2 * H + 1, scroll: 100 * H })).toBe(102);
  });
  it("clamps to the sheet", () => {
    expect(axisIndexAt({ ...base, pos: VIEW - 1, scroll: (ROWS + 50) * H })).toBe(ROWS - 1);
  });
});

describe("axisIndexAt (columns)", () => {
  const GUT = 44, W = 100;
  const colOffsets = [GUT]; for (let c = 0; c < 26; c++) colOffsets.push(colOffsets[c] + W);
  const base = { offsets: colOffsets, origin: 0, frozenCount: 0, viewSize: 600 };
  it("maps by scroll offset", () => {
    expect(axisIndexAt({ ...base, pos: GUT + 10, scroll: 0 })).toBe(0);
    expect(axisIndexAt({ ...base, pos: GUT + 10, scroll: 5 * W })).toBe(5);
  });
  it("over the gutter reaches column 0 at home, the first visible column once scrolled", () => {
    expect(axisIndexAt({ ...base, pos: 10, scroll: 0 })).toBe(0);
    expect(axisIndexAt({ ...base, pos: 10, scroll: 3 * W })).toBe(3);
  });
});

describe("wiring", () => {
  const src = readFileSync(new URL("../src/workspaces/model/components/SheetView.jsx", import.meta.url), "utf8");
  it("the grid no longer ends a drag when the pointer leaves it, nor extends via per-cell mouseenter", () => {
    expect(src).not.toMatch(/onMouseLeave=\{stopDrag\}/);
    expect(src).not.toMatch(/cellMouseEnter/);
  });
  it("cell, column-header, row-header and fill drags all ride the one session", () => {
    for (const kind of ["cell", "col", "row", "fill"]) expect(src).toContain(`beginRangeDrag("${kind}"`);
  });
});
