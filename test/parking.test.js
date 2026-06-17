import { describe, it, expect } from "vitest";
import { parkDepthForRows, parkRowsForDepth, splitParkingPieces, edgeAbutsPaving } from "../src/workspaces/site-planner/lib/parking.js";

const SD = 18, AI = 24, MOD = 2 * SD + AI; // 60' double-loaded module (18 + 24 + 18)

describe("parkDepthForRows / parkRowsForDepth — double-loaded stepping (B69)", () => {
  it("steps one row at a time, double-loading an aisle before adding a new one", () => {
    // rows -> depth: 1:42, 2:60, 3:102, 4:120, 5:162, 6:180 (+18 / +42 / +18 / +42 …)
    expect([1, 2, 3, 4, 5, 6].map((n) => parkDepthForRows(n, SD, AI)))
      .toEqual([42, 60, 102, 120, 162, 180]);
  });
  it("is the inverse of parkRowsForDepth for n = 1..10", () => {
    for (let n = 1; n <= 10; n++)
      expect(parkRowsForDepth(parkDepthForRows(n, SD, AI), SD, AI)).toBe(n);
  });
  it("never returns fewer than one row", () => {
    expect(parkRowsForDepth(0, SD, AI)).toBe(1);
    expect(parkRowsForDepth(5, SD, AI)).toBe(1);
  });
});

describe("splitParkingPieces — split into double-loaded modules, not single rows (B130)", () => {
  it("splits an even field into 60' double-loaded modules", () => {
    expect(splitParkingPieces(120, SD, AI)).toEqual([60, 60]);       // 4 rows -> two modules
    expect(splitParkingPieces(180, SD, AI)).toEqual([60, 60, 60]);   // 6 rows -> three modules
  });
  it("adds at most one trailing single-loaded row for an odd remainder", () => {
    expect(splitParkingPieces(102, SD, AI)).toEqual([60, 42]);       // 3 rows -> module + one single-loaded row
    expect(splitParkingPieces(162, SD, AI)).toEqual([60, 60, 42]);   // 5 rows -> two modules + one single row
  });
  it("never makes one row + a full aisle per row (the old bug): only the lone leftover is single-loaded", () => {
    const pieces = splitParkingPieces(162, SD, AI);
    expect(pieces.filter((p) => p === MOD)).toHaveLength(2);         // full double-loaded modules
    expect(pieces.filter((p) => p !== MOD)).toHaveLength(1);         // at most one single-loaded leftover
  });
  it("preserves total depth exactly (no pavement gained or lost on split)", () => {
    for (const h of [102, 120, 150, 162, 180, 240, 137.5])
      expect(splitParkingPieces(h, SD, AI).reduce((a, b) => a + b, 0)).toBeCloseTo(h, 6);
  });
  it("folds a sub-row remainder into the last module rather than dropping depth", () => {
    expect(splitParkingPieces(130, SD, AI)).toEqual([60, 70]);       // 120 + 10' (< one 18' row) folded
  });
  it("returns < 2 pieces (caller no-ops) when the field is one module or less", () => {
    expect(splitParkingPieces(60, SD, AI)).toEqual([60]);            // exactly one module
    expect(splitParkingPieces(42, SD, AI)).toEqual([]);              // single bay, less than a module
    expect(splitParkingPieces(0, SD, AI)).toEqual([]);
  });
  it("guards a degenerate (zero) module without looping", () => {
    expect(splitParkingPieces(100, 0, 0)).toEqual([]);
  });
});

describe("edgeAbutsPaving — curb suppression where pavement meets pavement (B130)", () => {
  const A = { id: "a", type: "parking", cx: 0, cy: 0, w: 100, h: 60, rot: 0 };

  it("no neighbours → no edge abuts (an isolated pad gets a full-perimeter curb)", () => {
    for (const [ax, sg] of [["y", 1], ["y", -1], ["x", 1], ["x", -1]])
      expect(edgeAbutsPaving(A, ax, sg, [])).toBe(false);
  });

  it("detects a paved pad flush against one edge (opening / continuous paving)", () => {
    const below = { id: "b", type: "paving", cx: 0, cy: 60, w: 100, h: 60, rot: 0 };
    expect(edgeAbutsPaving(A, "y", 1, [below])).toBe(true);   // shared edge → no curb
    expect(edgeAbutsPaving(A, "y", -1, [below])).toBe(false);
    expect(edgeAbutsPaving(A, "x", 1, [below])).toBe(false);
    expect(edgeAbutsPaving(A, "x", -1, [below])).toBe(false);
  });

  it("detects the seam between two stacked split modules (both sides suppress)", () => {
    const top = { id: "t", type: "parking", cx: 0, cy: -30, w: 100, h: 60, rot: 0 };
    const bot = { id: "b", type: "parking", cx: 0, cy: 30, w: 100, h: 60, rot: 0 };
    expect(edgeAbutsPaving(top, "y", 1, [top, bot])).toBe(true);   // top's inner edge meets bot
    expect(edgeAbutsPaving(bot, "y", -1, [top, bot])).toBe(true);  // bot's inner edge meets top
    expect(edgeAbutsPaving(top, "y", -1, [top, bot])).toBe(false); // outer perimeter keeps its curb
    expect(edgeAbutsPaving(bot, "y", 1, [top, bot])).toBe(false);
  });

  it("detects the seam between stacked modules under rotation (rot=90, the item-2 case)", () => {
    const p1 = { id: "p1", type: "parking", cx: 0, cy: 0, w: 100, h: 60, rot: 90 };
    const p2 = { id: "p2", type: "parking", cx: -60, cy: 0, w: 100, h: 60, rot: 90 };
    expect(edgeAbutsPaving(p1, "y", 1, [p1, p2])).toBe(true);
    expect(edgeAbutsPaving(p1, "y", -1, [p1, p2])).toBe(false);
  });

  it("ignores non-paved neighbours (landscape) and polygon pads", () => {
    const land = { id: "l", type: "landscape", cx: 0, cy: 60, w: 100, h: 60, rot: 0 };
    const poly = { id: "p", type: "paving", cx: 0, cy: 60, points: [{ x: -50, y: 30 }, { x: 50, y: 30 }, { x: 0, y: 90 }] };
    expect(edgeAbutsPaving(A, "y", 1, [land])).toBe(false);
    expect(edgeAbutsPaving(A, "y", 1, [poly])).toBe(false);
  });

  it("treats a clear gap as non-abutting (curb stays)", () => {
    const gap = { id: "g", type: "paving", cx: 0, cy: 95, w: 100, h: 60, rot: 0 }; // ~35' below A's edge
    expect(edgeAbutsPaving(A, "y", 1, [gap])).toBe(false);
  });
});
