import { describe, it, expect } from "vitest";
import { flowArrows, d8Direction } from "../src/workspaces/site-planner/lib/flowField.js";
import { M_TO_FT } from "../src/workspaces/site-planner/lib/elevation.js";

const grid = (width, height, fn) => {
  const values = new Float32Array(width * height);
  const mask = new Uint8Array(width * height).fill(1);
  for (let j = 0; j < height; j++) for (let i = 0; i < width; i++) values[j * width + i] = fn(i, j);
  return { values, mask, width, height };
};

const OPTS = { cellMeters: 1, groundK: 1, spacingCells: 8, minSlope: 0.0008 };

// ---------------------------------------------------------------------------
// THE SIGN-CONVENTION TESTS. Grid y grows SOUTH (screen down); dir must point
// DOWNHILL in that same space. An uphill or y-flipped arrow passes every other
// test and silently lies on the map — these two pins are the guard.
describe("flowArrows — direction sign convention (y-down screen space)", () => {
  it("ground falling to the EAST -> arrows point east (dir ~ 0)", () => {
    const g = grid(40, 40, (i) => 100 - i * 0.1);
    const arrows = flowArrows(g, OPTS);
    expect(arrows.length).toBeGreaterThan(0);
    for (const a of arrows) {
      expect(Math.cos(a.dir)).toBeGreaterThan(0.999); // unit vector ~ (+1, 0)
      expect(Math.abs(Math.sin(a.dir))).toBeLessThan(0.001);
    }
  });
  it("ground falling to the SOUTH -> arrows point down-screen (dir ~ +PI/2)", () => {
    const g = grid(40, 40, (_, j) => 100 - j * 0.1);
    const arrows = flowArrows(g, OPTS);
    expect(arrows.length).toBeGreaterThan(0);
    for (const a of arrows) {
      expect(Math.sin(a.dir)).toBeGreaterThan(0.999); // unit vector ~ (0, +1) = south
      expect(Math.abs(Math.cos(a.dir))).toBeLessThan(0.001);
    }
  });
  it("slope magnitude is dimensionless ft/ft with the ground-meter conversion", () => {
    // dz = 0.1 ft per 1-mercator-meter cell, groundK 0.868 -> ground cell 0.868 m
    const g = grid(40, 40, (i) => 100 - i * 0.1);
    const [a] = flowArrows(g, { ...OPTS, groundK: 0.868 });
    expect(a.slope).toBeCloseTo(0.1 / (0.868 * M_TO_FT), 4);
  });
});

// ---------------------------------------------------------------------------
describe("flowArrows — no invented directions", () => {
  it("flat ground with sub-threshold noise -> NO arrows", () => {
    const g = grid(40, 40, (i, j) => 100 + 0.001 * Math.sin(i * 7 + j * 13));
    expect(flowArrows(g, OPTS)).toEqual([]);
  });
  it("a void in the sample window suppresses that arrow only", () => {
    const g = grid(40, 40, (i) => 100 - i * 0.1);
    const all = flowArrows(g, OPTS).length;
    // Cover the sample point at (20,20) — spacing 8 puts lattice points on 4+8k.
    for (let j = 18; j <= 22; j++) for (let i = 18; i <= 22; i++) g.mask[j * 40 + i] = 0;
    const arrows = flowArrows(g, OPTS);
    expect(arrows.length).toBeLessThan(all);
    expect(arrows.length).toBeGreaterThan(0);
    expect(arrows.some((a) => a.px === 20.5 && a.py === 20.5)).toBe(false);
  });
  it("arrows sit on the spacing lattice, clear of the margin", () => {
    const g = grid(64, 64, (i) => 100 - i * 0.1);
    const arrows = flowArrows(g, { ...OPTS, spacingCells: 16, marginCells: 8 });
    expect(arrows.length).toBeGreaterThan(0);
    for (const a of arrows) {
      // lattice starts at max(margin, window) = 8, then steps by the spacing
      expect((a.px - 0.5 - 8) % 16).toBe(0);
      expect(a.px - 0.5).toBeGreaterThanOrEqual(8);
      expect(a.py - 0.5).toBeGreaterThanOrEqual(8);
    }
  });
});

// ---------------------------------------------------------------------------
describe("d8Direction — the future flow-accumulation seed", () => {
  it("points at the steepest of 8 neighbors (diagonal distance respected)", () => {
    // center 10; east neighbor 9 (drop 1/cell); SE neighbor 8.9 (drop 1.1/(cell*sqrt2) = 0.78)
    const g = grid(3, 3, () => 10);
    g.values[1 * 3 + 2] = 9;    // east
    g.values[2 * 3 + 2] = 8.9;  // south-east
    const d = d8Direction(g.values, g.mask, 3, 3, 1, 1, 1);
    expect(d).toMatchObject({ dx: 1, dy: 0 });
    expect(d.slope).toBeCloseTo(1, 6);
  });
  it("a pit or flat cell drains nowhere (null — never a random direction)", () => {
    const flat = grid(3, 3, () => 5);
    expect(d8Direction(flat.values, flat.mask, 3, 3, 1, 1, 1)).toBeNull();
    const pit = grid(3, 3, (i, j) => (i === 1 && j === 1 ? 1 : 5));
    expect(d8Direction(pit.values, pit.mask, 3, 3, 1, 1, 1)).toBeNull();
  });
  it("a void cell (or all-void neighbors) yields null", () => {
    const g = grid(3, 3, (i) => 10 - i);
    g.mask[1 * 3 + 1] = 0;
    expect(d8Direction(g.values, g.mask, 3, 3, 1, 1, 1)).toBeNull();
  });
});
