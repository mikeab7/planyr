/* rowLayout.js — pure row-offset math behind SheetView's variable-row-height virtualization
 * (Stage 1). DOM-free so the search/offset logic is provable without mounting the component. */
import { describe, it, expect } from "vitest";
import { createSheet, setRowHeight, DEFAULT_ROW_H } from "../src/workspaces/model/lib/sheetModel.js";
import { buildRowOffsets, rowAtOffset, visibleRowRange } from "../src/workspaces/model/lib/rowLayout.js";

describe("buildRowOffsets", () => {
  it("with no overrides, every row is DEFAULT_ROW_H apart — matches the old fixed-height math", () => {
    const s = createSheet();
    const offsets = buildRowOffsets(s, 10);
    for (let r = 0; r <= 10; r++) expect(offsets[r]).toBe(r * DEFAULT_ROW_H);
  });

  it("a taller row pushes every subsequent row's offset down by the extra height", () => {
    let s = createSheet();
    s = setRowHeight(s, 2, DEFAULT_ROW_H * 3); // row 2 is 3x tall
    const offsets = buildRowOffsets(s, 5);
    expect(offsets[0]).toBe(0);
    expect(offsets[1]).toBe(DEFAULT_ROW_H);
    expect(offsets[2]).toBe(DEFAULT_ROW_H * 2);          // row 2 starts here
    expect(offsets[3]).toBe(DEFAULT_ROW_H * 2 + DEFAULT_ROW_H * 3); // row 3 starts after row 2's extra height
    expect(offsets[5]).toBe(offsets[4] + DEFAULT_ROW_H);
  });

  // B1007280 — sheet zoom. Every row's height scales by the SAME factor `zoom` multiplies in
  // at, so the offset table is just the unzoomed one times zoom, uniformly — proven at the
  // three levels the owner's brief named explicitly: 50%, 100% (the default, already covered
  // above), and 200%.
  describe("zoom (B1007280)", () => {
    it("at 50% zoom, every offset is exactly half the unzoomed value", () => {
      let s = createSheet();
      s = setRowHeight(s, 2, DEFAULT_ROW_H * 3); // keep a variable-height row in the mix
      const base = buildRowOffsets(s, 5);
      const half = buildRowOffsets(s, 5, 0.5);
      for (let r = 0; r <= 5; r++) expect(half[r]).toBeCloseTo(base[r] * 0.5, 10);
    });

    it("at 100% zoom (the default), passing 1 explicitly matches omitting the argument entirely", () => {
      let s = createSheet();
      s = setRowHeight(s, 2, DEFAULT_ROW_H * 3);
      expect(buildRowOffsets(s, 5, 1)).toEqual(buildRowOffsets(s, 5));
    });

    it("at 200% zoom, every offset is exactly double the unzoomed value", () => {
      let s = createSheet();
      s = setRowHeight(s, 2, DEFAULT_ROW_H * 3);
      const base = buildRowOffsets(s, 5);
      const doubled = buildRowOffsets(s, 5, 2);
      for (let r = 0; r <= 5; r++) expect(doubled[r]).toBeCloseTo(base[r] * 2, 10);
    });

    it("visibleRowRange over zoomed offsets still finds the correct row for a zoomed scrollTop — the virtualization window is never off by zoom", () => {
      const s = createSheet();
      // At 200% zoom every row is 2*DEFAULT_ROW_H tall; a scrollTop of exactly row 10's zoomed
      // top must resolve to row 10, not row 5 (what it would be misread as at 1x) or row 20
      // (double-applying the zoom).
      const offsets = buildRowOffsets(s, 1000, 2);
      const scrollTop = 10 * DEFAULT_ROW_H * 2;
      const { startIdx } = visibleRowRange(offsets, scrollTop, 400, 0);
      expect(startIdx).toBe(10);
    });
  });

  // B1007282 — AutoFilter (Sort & Filter). A filtered-out row gets ZERO height rather than being
  // removed from the offset table entirely — this IS the whole filter mechanism (see the
  // function's own header): every row still has an index, it just takes no space.
  describe("hiddenRows (B1007282 — AutoFilter)", () => {
    it("a hidden row contributes zero height — the next row's top is unchanged", () => {
      const s = createSheet();
      const offsets = buildRowOffsets(s, 5, 1, new Set([2]));
      expect(offsets[2]).toBe(offsets[3]); // row 2 takes no space at all
      expect(offsets[3]).toBe(2 * DEFAULT_ROW_H); // rows 0,1 still counted normally
    });
    it("hiding several rows compounds — the total height drops by exactly their combined height", () => {
      const s = createSheet();
      const base = buildRowOffsets(s, 10);
      const filtered = buildRowOffsets(s, 10, 1, new Set([1, 3, 5]));
      expect(filtered[10]).toBe(base[10] - 3 * DEFAULT_ROW_H);
    });
    it("no hiddenRows argument (the default) behaves exactly as before — every row its own height", () => {
      const s = createSheet();
      expect(buildRowOffsets(s, 10, 1, null)).toEqual(buildRowOffsets(s, 10));
    });
    it("hiding works together with zoom — a hidden row is zero regardless of zoom level", () => {
      const s = createSheet();
      const offsets = buildRowOffsets(s, 5, 2, new Set([0]));
      expect(offsets[0]).toBe(0);
      expect(offsets[1]).toBe(0); // row 0 hidden — row 1 still starts at the very top
      expect(offsets[2]).toBe(DEFAULT_ROW_H * 2); // row 1 alone, at its real zoomed height
    });
    it("visibleRowRange skips straight past a run of hidden rows with no gap in the visible window", () => {
      const s = createSheet();
      const hidden = new Set([2, 3, 4]);
      const offsets = buildRowOffsets(s, 20, 1, hidden);
      // Scrolled to the very top: rows 0,1 visible, then 2-4 take zero space, then row 5 sits
      // right where row 2 would otherwise have started.
      const { startIdx, endIdx } = visibleRowRange(offsets, 0, DEFAULT_ROW_H * 3, 0);
      expect(offsets[startIdx]).toBe(0);
      expect(endIdx).toBeGreaterThan(5); // the window reaches real (non-hidden) rows past the hidden run
    });
  });
});

describe("rowAtOffset", () => {
  it("finds the exact row whose top is a hit", () => {
    const offsets = [0, 26, 52, 78, 104];
    expect(rowAtOffset(offsets, 52)).toBe(2);
  });
  it("finds the row CONTAINING an offset that isn't exactly a row's top", () => {
    const offsets = [0, 26, 52, 78, 104];
    expect(rowAtOffset(offsets, 40)).toBe(1); // between row1's top(26) and row2's top(52)
  });
  it("clamps to the last row for an offset past the end", () => {
    const offsets = [0, 26, 52, 78, 104];
    expect(rowAtOffset(offsets, 99999)).toBe(3); // 4 rows, last index 3
  });
  it("y=0 is always row 0", () => {
    expect(rowAtOffset([0, 26, 52], 0)).toBe(0);
  });
  it("an empty row range returns 0 by convention (callers guard rowCount>0 before rendering)", () => {
    expect(rowAtOffset([0], 0)).toBe(0);
  });
});

describe("visibleRowRange — the buffered virtualization window", () => {
  it("with fixed-height rows, reproduces the old floor(scrollTop/ROW_H)-BUF math", () => {
    const s = createSheet();
    const offsets = buildRowOffsets(s, 1000);
    const buf = 6;
    const targetRow = 10;
    const scrollTop = targetRow * DEFAULT_ROW_H;
    const { startIdx, endIdx } = visibleRowRange(offsets, scrollTop, 400, buf);
    expect(startIdx).toBe(Math.max(0, targetRow - buf));
    expect(endIdx).toBeGreaterThan(startIdx);
    expect(endIdx).toBeLessThanOrEqual(1000);
  });

  it("never renders past the real row count even with a huge viewport", () => {
    const s = createSheet();
    const offsets = buildRowOffsets(s, 20);
    const { startIdx, endIdx } = visibleRowRange(offsets, 0, 100000, 6);
    expect(startIdx).toBe(0);
    expect(endIdx).toBe(20);
  });

  it("minIdx floors the window so it never starts inside a frozen row band", () => {
    const s = createSheet();
    const offsets = buildRowOffsets(s, 100);
    // Scrolled to the very top (scrollTop=0), but rows 0-2 are frozen (rendered separately as
    // sticky elements — see SheetView.jsx) — the scrolling window must start at row 3, not row 0.
    const { startIdx } = visibleRowRange(offsets, 0, 400, 6, 3);
    expect(startIdx).toBe(3);
  });

  it("a zero-row scope (every row is frozen) renders nothing scrolling, not a crash", () => {
    expect(visibleRowRange([0], 0, 400, 6, 0)).toEqual({ startIdx: 0, endIdx: 0 });
  });

  it("a tall overridden row widens the visible window to cover fewer ROWS for the same pixels", () => {
    let s = createSheet();
    for (let r = 0; r < 10; r++) s = setRowHeight(s, r, 200); // every visible row is huge
    const offsets = buildRowOffsets(s, 20);
    const { startIdx, endIdx } = visibleRowRange(offsets, 0, 400, 0);
    // 400px / 200px-tall rows ≈ 2 rows visible, not the ~15 a fixed 26px height would give
    expect(endIdx - startIdx).toBeLessThan(5);
  });
});
