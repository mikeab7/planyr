/* NEW-1 (2026-10-29) — drag-select geometry + edge-autoscroll speed (lib/dragSelect.js).
 * Red on main: the module does not exist there — the grid extended a drag only from each cell's
 * own mouseenter, so the selection stopped at the last visible row. */
import { describe, it, expect } from "vitest";
import {
  edgeVelocity, cellAtPoint, paneBounds, autoscrollStep, colAtOffset,
  AUTOSCROLL_MIN_SPEED, AUTOSCROLL_MAX_SPEED,
} from "../src/workspaces/model/lib/dragSelect.js";

// 1000 rows of 22px, 30 columns of 120px behind a 44px gutter, a 26px header, viewport 800x400 at (100, 50).
const rowOffsets = Array.from({ length: 1001 }, (_, i) => i * 22);
const colOffsets = Array.from({ length: 31 }, (_, i) => 44 + i * 120);
const geom = (over = {}) => ({
  rect: { left: 100, top: 50 }, viewport: { width: 800, height: 400 }, scroll: { left: 0, top: 0 },
  headerH: 26, rowOffsets, colOffsets, freezeRows: 0, freezeCols: 0, ...over,
});

describe("edgeVelocity — near the edge is slow, far is fast, inside is still", () => {
  it("is 0 comfortably inside the pane", () => {
    expect(edgeVelocity(200, 100, 500)).toBe(0);
  });
  it("scrolls forward at/after the far edge, backward at/before the near edge", () => {
    expect(edgeVelocity(500, 100, 500)).toBeGreaterThan(0);
    expect(edgeVelocity(900, 100, 500)).toBeGreaterThan(0);
    expect(edgeVelocity(100, 100, 500)).toBeLessThan(0);
    expect(edgeVelocity(-50, 100, 500)).toBeLessThan(0);
  });
  it("ramps with distance and caps", () => {
    const near = Math.abs(edgeVelocity(510, 100, 500)), far = Math.abs(edgeVelocity(700, 100, 500));
    expect(far).toBeGreaterThan(near);
    expect(near).toBeGreaterThanOrEqual(AUTOSCROLL_MIN_SPEED);
    expect(Math.abs(edgeVelocity(99999, 100, 500))).toBe(AUTOSCROLL_MAX_SPEED);
  });
});

describe("cellAtPoint — pointer → row/column from scroll offsets, not from rendered DOM", () => {
  it("maps a point inside the grid", () => {
    // y = 50 + 26 + 22*3 + 5 → row 3 ; x = 100 + 44 + 120*2 + 5 → column 2
    expect(cellAtPoint(geom(), 100 + 44 + 245, 50 + 26 + 66 + 5)).toEqual({ r: 3, c: 2 });
  });
  it("honours the scroll offset, so a row that is NOT rendered is still reachable", () => {
    const g = geom({ scroll: { left: 0, top: 22 * 500 } });
    const { r } = cellAtPoint(g, 300, 50 + 26 + 10);
    expect(r).toBe(500);
  });
  it("clamps a pointer beyond every edge to the nearest cell on that edge", () => {
    expect(cellAtPoint(geom(), 999999, 999999)).toEqual({ r: 999, c: 29 });
    expect(cellAtPoint(geom(), -500, -500)).toEqual({ r: 0, c: 0 });
  });
  it("frozen rows/columns are pinned: a pointer over them ignores the scroll offset", () => {
    const g = geom({ freezeRows: 2, freezeCols: 1, scroll: { left: 3000, top: 22 * 300 } });
    // over the frozen band (first two rows, first column)
    expect(cellAtPoint(g, 100 + 44 + 10, 50 + 26 + 5)).toEqual({ r: 0, c: 0 });
    expect(cellAtPoint(g, 100 + 44 + 10, 50 + 26 + 30)).toEqual({ r: 1, c: 0 });
    // below the frozen band the scroll applies again
    const { r } = cellAtPoint(g, 100 + 44 + 200, 50 + 26 + 22 * 2 + 5);
    expect(r).toBe(302);
  });
});

describe("autoscrollStep — keeps scrolling while the pointer is held still outside the edge", () => {
  it("scrolls down for a pointer parked below the grid, in every frame", () => {
    const g = geom();
    const a = autoscrollStep(g, 300, 50 + 400 + 30, 16);
    const b = autoscrollStep(g, 300, 50 + 400 + 30, 16);
    expect(a.dy).toBeGreaterThan(0); expect(b.dy).toBe(a.dy); // same input → same scroll, every frame
    expect(a.dx).toBe(0);
  });
  it("scrolls right, and diagonally (both axes at once)", () => {
    const g = geom();
    expect(autoscrollStep(g, 100 + 800 + 40, 200, 16).dx).toBeGreaterThan(0);
    const d = autoscrollStep(g, 100 + 800 + 40, 50 + 400 + 40, 16);
    expect(d.dx).toBeGreaterThan(0); expect(d.dy).toBeGreaterThan(0);
  });
  it("scrolls up/left when the pointer is over the pinned header band or gutter", () => {
    const g = geom();
    expect(autoscrollStep(g, 300, 50 + 10, 16).dy).toBeLessThan(0); // inside the 26px header band
    expect(autoscrollStep(g, 100 + 10, 200, 16).dx).toBeLessThan(0); // inside the 44px gutter
  });
  it("is zero inside the pane, and a gesture can pin an axis off (a column-header drag never scrolls rows)", () => {
    const g = geom();
    const mid = autoscrollStep(g, 400, 250, 16);
    expect(mid.dx).toBe(0); expect(mid.dy).toBe(0);
    expect(autoscrollStep(g, 400, 50 + 400 + 80, 16, { x: true, y: false }).dy).toBe(0);
  });
  it("faster the farther past the edge", () => {
    const g = geom();
    expect(autoscrollStep(g, 300, 50 + 400 + 200, 16).dy).toBeGreaterThan(autoscrollStep(g, 300, 50 + 400 + 5, 16).dy);
  });
  it("paneBounds excludes the header band and frozen rows", () => {
    const b = paneBounds(geom({ freezeRows: 2 }));
    expect(b.top).toBe(50 + 26 + 44);
    expect(b.bottom).toBe(450);
  });
});

describe("colAtOffset", () => {
  it("finds the column whose span holds x, clamping left of the gutter to column 0", () => {
    expect(colAtOffset(colOffsets, 10)).toBe(0);
    expect(colAtOffset(colOffsets, 44 + 120)).toBe(1);
    expect(colAtOffset(colOffsets, 99999)).toBe(29);
  });
});
