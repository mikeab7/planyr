import { describe, it, expect } from "vitest";
import {
  fwd, inv, solveM, sheetBBox,
  MIN_ALIGN_BASE, alignBaselinesDegenerate, sheetContains, measureOverUnaligned,
} from "../src/workspaces/doc-review/lib/stitchGeom.js";

const ID = { A: 1, B: 0, e: 0, f: 0 };

describe("stitcher geometry (doc-review)", () => {
  it("fwd/inv round-trip through a non-trivial (scaled + rotated + translated) matrix", () => {
    const M = solveM({ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 10, y: 20 }, { x: 10, y: 220 }); // 90° rot, ×2
    const p = { x: 37, y: -19 };
    const back = inv(M, fwd(M, p));
    expect(back.x).toBeCloseTo(p.x, 6);
    expect(back.y).toBeCloseTo(p.y, 6);
  });

  it("solveM maps b1→A1 and b2→A2 (identity case)", () => {
    const M = solveM({ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 0, y: 0 }, { x: 10, y: 0 });
    expect(fwd(M, { x: 0, y: 0 }).x).toBeCloseTo(0, 9);
    expect(fwd(M, { x: 10, y: 0 }).x).toBeCloseTo(10, 9);
  });

  it("solveM recovers scale + rotation (b 100 long → A 200 long, rotated +90°)", () => {
    const A1 = { x: 5, y: 5 }, A2 = { x: 5, y: 205 };       // 200 long, pointing +y
    const M = solveM({ x: 0, y: 0 }, { x: 100, y: 0 }, A1, A2);
    expect(fwd(M, { x: 0, y: 0 }).x).toBeCloseTo(A1.x, 6);
    expect(fwd(M, { x: 0, y: 0 }).y).toBeCloseTo(A1.y, 6);
    expect(fwd(M, { x: 100, y: 0 }).x).toBeCloseTo(A2.x, 6);
    expect(fwd(M, { x: 100, y: 0 }).y).toBeCloseTo(A2.y, 6);
    expect(Math.hypot(M.A, M.B)).toBeCloseTo(2, 6);          // scale ×2
  });

  it("sheetBBox returns the world AABB of a placed page", () => {
    const bb = sheetBBox({ M: { ...ID, e: 10, f: 20 }, baseW: 200, baseH: 100 });
    expect(bb).toMatchObject({ minX: 10, minY: 20, maxX: 210, maxY: 120 });
  });

  // B288 — the degenerate baseline that the guard now rejects. WITHOUT the guard, solveM's
  // `hypot()||1` masks the zero and returns a runaway transform that flings the sheet.
  it("B288: solveM on a collapsed moving baseline yields a runaway scale (why the guard exists)", () => {
    const M = solveM({ x: 0, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 0 }, { x: 100, y: 0 }); // coincident moving clicks
    expect(Math.hypot(M.A, M.B)).toBeGreaterThan(50); // garbage ×100 scale
  });

  it("B288: alignBaselinesDegenerate flags a collapsed moving OR reference baseline; passes healthy ones", () => {
    const A1 = { x: 0, y: 0 }, A2 = { x: 100, y: 0 };
    expect(alignBaselinesDegenerate({ x: 0, y: 0 }, { x: 0, y: 0 }, A1, A2)).toBe(true);    // moving collapsed
    expect(alignBaselinesDegenerate({ x: 0, y: 0 }, { x: 100, y: 0 }, A1, A1)).toBe(true);  // reference collapsed
    expect(alignBaselinesDegenerate({ x: 0, y: 0 }, { x: 0.4, y: 0 }, A1, A2)).toBe(true);  // sub-threshold
    expect(alignBaselinesDegenerate({ x: 0, y: 0 }, { x: 100, y: 0 }, A1, A2)).toBe(false); // both healthy
    expect(MIN_ALIGN_BASE).toBeGreaterThan(0);
  });

  it("sheetContains tests the page rectangle through the sheet's transform", () => {
    const base = { M: { ...ID }, baseW: 200, baseH: 100, aligned: true };
    expect(sheetContains(base, { x: 50, y: 50 })).toBe(true);
    expect(sheetContains(base, { x: 250, y: 50 })).toBe(false);
    const offset = { M: { ...ID, e: 300 }, baseW: 200, baseH: 100, aligned: false }; // dropped 300 to the right
    expect(sheetContains(offset, { x: 350, y: 50 })).toBe(true);
    expect(sheetContains(offset, { x: 50, y: 50 })).toBe(false);
  });

  // B289 — a measurement over a sheet still flagged aligned:false should warn; over the
  // aligned base it should not, and an aligned sheet (or no sheets) never warns.
  it("B289: measureOverUnaligned warns only over a not-yet-aligned sheet", () => {
    const base = { M: { ...ID }, baseW: 200, baseH: 100, aligned: true };
    const fresh = { M: { ...ID, e: 300 }, baseW: 200, baseH: 100, aligned: false };
    const placed = [base, fresh];
    expect(measureOverUnaligned(placed, [{ x: 50, y: 50 }, { x: 150, y: 50 }])).toBe(false); // both over the base
    expect(measureOverUnaligned(placed, [{ x: 50, y: 50 }, { x: 350, y: 50 }])).toBe(true);  // one point over the fresh sheet
    expect(measureOverUnaligned([base], [{ x: 50, y: 50 }])).toBe(false);                    // only aligned sheets
    expect(measureOverUnaligned([], [{ x: 0, y: 0 }])).toBe(false);                          // no sheets → no warning
  });
});
