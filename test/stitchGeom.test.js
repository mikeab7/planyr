import { describe, it, expect } from "vitest";
import {
  fwd, inv, solveM, sheetBBox, degenerateAlign, pointInSheet, overUnaligned, MIN_BASELINE,
} from "../src/workspaces/doc-review/lib/stitchGeom.js";

const near = (a, b, p = 6) => { expect(a.x).toBeCloseTo(b.x, p); expect(a.y).toBeCloseTo(b.y, p); };

describe("stitchGeom — fwd/inv similarity round-trip", () => {
  it("inv undoes fwd for an arbitrary similarity matrix", () => {
    const M = { A: 1.3 * Math.cos(0.4), B: 1.3 * Math.sin(0.4), e: 120, f: -45 }; // scale 1.3, +0.4 rad
    const p = { x: 73, y: 19 };
    near(inv(M, fwd(M, p)), p);
  });
});

describe("stitchGeom — solveM maps the two click pairs exactly", () => {
  it("lands b1→A1 and b2→A2 (with the implied scale + rotation)", () => {
    const b1 = { x: 0, y: 0 }, b2 = { x: 100, y: 0 };
    const A1 = { x: 50, y: 50 }, A2 = { x: 50, y: 150 }; // 100 long, rotated +90°, scale 1
    const M = solveM(b1, b2, A1, A2);
    near(fwd(M, b1), A1);
    near(fwd(M, b2), A2);
    expect(Math.hypot(M.A, M.B)).toBeCloseTo(1, 6); // unit scale
  });

  it("captures a pure scale change", () => {
    const M = solveM({ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 0, y: 0 }, { x: 30, y: 0 });
    expect(Math.hypot(M.A, M.B)).toBeCloseTo(3, 6); // 30 / 10
  });

  // The exact failure B300 guards against: two coincident clicks on the moving sheet make
  // |b2−b1| = 0, masked to 1 by `lb || 1`, so the transform inherits the reference baseline
  // as a raw scale — here ×100 with the sheet flung to e/f = −500.
  it("blows up (×100, e/f = −500) on a coincident moving-sheet baseline", () => {
    const M = solveM({ x: 5, y: 5 }, { x: 5, y: 5 }, { x: 0, y: 0 }, { x: 100, y: 0 });
    expect(Math.hypot(M.A, M.B)).toBeCloseTo(100, 4); // runaway scale
    expect(M.e).toBeCloseTo(-500, 4);
    expect(M.f).toBeCloseTo(-500, 4);
  });
});

describe("stitchGeom — degenerateAlign (the B300 guard)", () => {
  const A1 = { x: 0, y: 0 }, A2 = { x: 100, y: 0 };
  const b1 = { x: 0, y: 0 }, b2 = { x: 80, y: 60 }; // 100-unit moving baseline

  it("accepts a well-separated pair", () => {
    expect(degenerateAlign(b1, b2, A1, A2)).toBe(false);
  });
  it("rejects a coincident (or sub-threshold) moving-sheet baseline", () => {
    expect(degenerateAlign(b1, { ...b1 }, A1, A2)).toBe(true);            // identical points
    expect(degenerateAlign(b1, { x: 0.5, y: 0 }, A1, A2)).toBe(true);     // < MIN_BASELINE apart
  });
  it("rejects a coincident reference baseline", () => {
    expect(degenerateAlign(b1, b2, A1, { ...A1 })).toBe(true);
  });
  it("uses MIN_BASELINE = 1 as the floor", () => {
    expect(MIN_BASELINE).toBe(1);
    expect(degenerateAlign(b1, { x: 1.0001, y: 0 }, A1, A2)).toBe(false); // just over the floor
    expect(degenerateAlign(b1, { x: 0.9999, y: 0 }, A1, A2)).toBe(true);  // just under
  });
});

describe("stitchGeom — sheetBBox / pointInSheet", () => {
  const s = { baseW: 100, baseH: 60, M: { A: 1, B: 0, e: 40, f: 20 } }; // identity, translated

  it("sheetBBox is the translated page rectangle", () => {
    expect(sheetBBox(s)).toEqual({ minX: 40, maxX: 140, minY: 20, maxY: 80 });
  });
  it("pointInSheet is true inside the footprint, false outside", () => {
    expect(pointInSheet(s, { x: 90, y: 50 })).toBe(true);   // inside
    expect(pointInSheet(s, { x: 39, y: 50 })).toBe(false);  // left of it
    expect(pointInSheet(s, { x: 90, y: 81 })).toBe(false);  // below it
  });
});

describe("stitchGeom — overUnaligned (the B301 guard)", () => {
  // sheet 0 = anchor [0..100]×[0..100]; sheet 1 placed to the right [140..240]×[0..100]
  const anchor = { baseW: 100, baseH: 100, M: { A: 1, B: 0, e: 0, f: 0 }, aligned: true };
  const later = (aligned) => ({ baseW: 100, baseH: 100, M: { A: 1, B: 0, e: 140, f: 0 }, aligned });

  it("flags a point over a not-yet-aligned later sheet", () => {
    const placed = [anchor, later(false)];
    expect(overUnaligned(placed, { x: 180, y: 50 })).toBe(true);  // inside sheet 1
  });
  it("does NOT flag a point over the anchor (index 0 is always aligned)", () => {
    const placed = [anchor, later(false)];
    expect(overUnaligned(placed, { x: 50, y: 50 })).toBe(false);  // inside sheet 0
  });
  it("does NOT flag once the later sheet is aligned", () => {
    const placed = [anchor, later(true)];
    expect(overUnaligned(placed, { x: 180, y: 50 })).toBe(false);
  });
  it("does NOT flag empty world space", () => {
    const placed = [anchor, later(false)];
    expect(overUnaligned(placed, { x: 1000, y: 1000 })).toBe(false);
  });
});
