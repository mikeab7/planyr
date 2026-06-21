import { describe, it, expect } from "vitest";
import {
  fwd, inv, solveM, sheetBBox,
  MIN_ALIGN_BASE, alignBaselinesDegenerate, sheetContains, measureOverUnaligned, panTo,
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

  // B300 — the degenerate baseline that the guard now rejects. WITHOUT the guard, solveM's
  // `hypot()||1` masks the zero and returns a runaway transform that flings the sheet.
  it("B300: solveM on a collapsed moving baseline yields a runaway scale (why the guard exists)", () => {
    const M = solveM({ x: 0, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 0 }, { x: 100, y: 0 }); // coincident moving clicks
    expect(Math.hypot(M.A, M.B)).toBeGreaterThan(50); // garbage ×100 scale
  });

  it("B300: alignBaselinesDegenerate flags a collapsed moving OR reference baseline; passes healthy ones", () => {
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

  // B301 — a measurement over a sheet still flagged aligned:false should warn; over the
  // aligned base it should not, and an aligned sheet (or no sheets) never warns.
  it("B301: measureOverUnaligned warns only over a not-yet-aligned sheet", () => {
    const base = { M: { ...ID }, baseW: 200, baseH: 100, aligned: true };
    const fresh = { M: { ...ID, e: 300 }, baseW: 200, baseH: 100, aligned: false };
    const placed = [base, fresh];
    expect(measureOverUnaligned(placed, [{ x: 50, y: 50 }, { x: 150, y: 50 }])).toBe(false); // both over the base
    expect(measureOverUnaligned(placed, [{ x: 50, y: 50 }, { x: 350, y: 50 }])).toBe(true);  // one point over the fresh sheet
    expect(measureOverUnaligned([base], [{ x: 50, y: 50 }])).toBe(false);                    // only aligned sheets
    expect(measureOverUnaligned([], [{ x: 0, y: 0 }])).toBe(false);                          // no sheets → no warning
  });

  // B325 — the pan crash. The setView updater used to read drag.current INSIDE the deferred
  // updater; a gesture aborted (pointerup / pointercancel / blur-recovery) before React ran
  // the updater nulled the ref → "Cannot read properties of null (reading 'panX')" thrown in
  // the render phase → the whole stitcher hit the error boundary. The fix captures the origin
  // into a local and closes over it (panTo). These tests pin both the math and the contract.
  describe("B325: panTo (pan from a captured drag origin)", () => {
    const view = { panX: 40, panY: 40, zoom: 0.4 };
    const origin = { sx: 100, sy: 100, panX: 40, panY: 40 };

    it("translates the view by the pointer delta from the captured origin", () => {
      expect(panTo(view, origin, 130, 160)).toEqual({ panX: 70, panY: 100, zoom: 0.4 }); // +30, +60
      expect(panTo(view, origin, 100, 100)).toEqual({ panX: 40, panY: 40, zoom: 0.4 });  // no move
      expect(panTo(view, origin, 70, 40)).toEqual({ panX: 10, panY: -20, zoom: 0.4 });   // negative delta
    });

    it("preserves other view fields (zoom) it doesn't touch", () => {
      expect(panTo({ ...view, zoom: 2.5 }, origin, 130, 160).zoom).toBe(2.5);
    });

    it("survives the drag ref being nulled mid-gesture (the captured origin is what's read)", () => {
      const dragRef = { current: { sx: 100, sy: 100, panX: 40, panY: 40 } };
      const d = dragRef.current;                       // capture, exactly as onMove now does
      const updater = (v) => panTo(v, d, 130, 160);    // close over the captured origin
      dragRef.current = null;                          // gesture aborted before React flushes the updater
      expect(() => updater(view)).not.toThrow();
      expect(updater(view)).toEqual({ panX: 70, panY: 100, zoom: 0.4 }); // still correct
    });

    it("documents the bug: the OLD pattern (reading the ref in the updater) throws once it's null", () => {
      const dragRef = { current: { sx: 100, sy: 100, panX: 40, panY: 40 } };
      const oldUpdater = (v) => ({ ...v, panX: dragRef.current.panX + (130 - dragRef.current.sx) });
      dragRef.current = null;                          // the abort that used to crash the stitcher
      expect(() => oldUpdater(view)).toThrow(/panX/);
    });
  });
});
