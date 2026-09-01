/* Model workspace — Stage 2 (the ribbon): per-cell style (font/fill/alignment/border), format
 * painter, horizontal merge, and sort. Same identity-purity contract as modelSheetModel.test.js:
 * every no-op returns the SAME reference (`toBe`), never a fresh equal-looking object. */
import { describe, it, expect } from "vitest";
import {
  createSheet, setRaw, setNumberFormat, setCellStyle, applyBorder, clearFormatting,
  styleAt, formatAt, paintedStyleAt, applyPaintedStyle,
  mergeAt, mergeRange, unmergeAt, sortRange,
  insertRowAt, deleteRowAt, insertColumnAt, deleteColumn, migrateSheet,
} from "../src/workspaces/model/lib/sheetModel.js";

describe("setCellStyle", () => {
  it("applies a patch to every cell in a range, leaving cells outside it untouched", () => {
    let s = createSheet();
    s = setCellStyle(s, 0, 1, 0, 1, { bold: true });
    expect(styleAt(s, 0, 0)).toEqual({ bold: true });
    expect(styleAt(s, 1, 1)).toEqual({ bold: true });
    expect(styleAt(s, 2, 2)).toEqual({}); // outside the range
  });
  it("merges into an existing style — setting italic never disturbs an existing bold", () => {
    let s = createSheet();
    s = setCellStyle(s, 0, 0, 0, 0, { bold: true });
    s = setCellStyle(s, 0, 0, 0, 0, { italic: true });
    expect(styleAt(s, 0, 0)).toEqual({ bold: true, italic: true });
  });
  it("a null value in the patch REMOVES that key (the un-toggle case)", () => {
    let s = createSheet();
    s = setCellStyle(s, 0, 0, 0, 0, { bold: true, italic: true });
    s = setCellStyle(s, 0, 0, 0, 0, { bold: null });
    expect(styleAt(s, 0, 0)).toEqual({ italic: true });
  });
  it("a no-op patch (already exactly this value) returns the SAME sheet reference", () => {
    let s = createSheet();
    s = setCellStyle(s, 0, 0, 0, 0, { bold: true });
    const again = setCellStyle(s, 0, 0, 0, 0, { bold: true });
    expect(again).toBe(s);
  });
  it("removing every key on a cell drops its style entry entirely, not an empty {}", () => {
    let s = createSheet();
    s = setCellStyle(s, 0, 0, 0, 0, { bold: true });
    s = setCellStyle(s, 0, 0, 0, 0, { bold: null });
    expect(Object.keys(s.styles).length).toBe(0);
  });
  it("fill/color/align/valign/wrap/indent all round-trip through styleAt", () => {
    let s = createSheet();
    s = setCellStyle(s, 0, 0, 0, 0, { color: "#ff0000", fill: "#eeeeee", align: "center", valign: "middle", wrap: true, indent: 2 });
    expect(styleAt(s, 0, 0)).toEqual({ color: "#ff0000", fill: "#eeeeee", align: "center", valign: "middle", wrap: true, indent: 2 });
  });
});

describe("applyBorder", () => {
  it('mode "outline" only touches the PERIMETER of the range for each requested edge', () => {
    let s = createSheet();
    // A 3x3 selection (rows 0-2, cols 0-2); a TOP border only touches row 0's three cells.
    s = applyBorder(s, 0, 2, 0, 2, { edges: ["top"], style: "thin", mode: "outline" });
    expect(styleAt(s, 0, 0).border).toEqual({ top: "thin" });
    expect(styleAt(s, 0, 1).border).toEqual({ top: "thin" });
    expect(styleAt(s, 1, 0).border).toEqual(undefined); // interior row — untouched
    expect(styleAt(s, 2, 0).border).toEqual(undefined); // bottom row — a TOP border never reaches it
  });
  it('the double-bottom border ("total row" marker) is an outline bottom edge with style "double"', () => {
    let s = createSheet();
    s = applyBorder(s, 3, 3, 0, 4, { edges: ["bottom"], style: "double", mode: "outline" });
    for (let c = 0; c <= 4; c++) expect(styleAt(s, 3, c).border).toEqual({ bottom: "double" });
  });
  it('mode "all" touches every cell in the range, not just the perimeter — the grid/"All borders" button', () => {
    let s = createSheet();
    s = applyBorder(s, 0, 1, 0, 1, { edges: ["top", "right", "bottom", "left"], style: "thin", mode: "all" });
    expect(styleAt(s, 0, 0).border).toEqual({ top: "thin", right: "thin", bottom: "thin", left: "thin" });
    expect(styleAt(s, 1, 1).border).toEqual({ top: "thin", right: "thin", bottom: "thin", left: "thin" });
  });
  it('"No border" (style: null) clears an existing border without touching other style keys', () => {
    let s = createSheet();
    s = setCellStyle(s, 0, 0, 0, 0, { bold: true });
    s = applyBorder(s, 0, 0, 0, 0, { edges: ["top", "right", "bottom", "left"], style: "thin", mode: "all" });
    s = applyBorder(s, 0, 0, 0, 0, { edges: ["top", "right", "bottom", "left"], style: null, mode: "all" });
    expect(styleAt(s, 0, 0)).toEqual({ bold: true });
  });
  it("setting a top border twice with the same style is a no-op (same reference)", () => {
    let s = createSheet();
    s = applyBorder(s, 0, 0, 0, 0, { edges: ["top"], style: "thin", mode: "outline" });
    const again = applyBorder(s, 0, 0, 0, 0, { edges: ["top"], style: "thin", mode: "outline" });
    expect(again).toBe(s);
  });
  it("individual-edge toggles compose — top then bottom leaves both, not just the last one", () => {
    let s = createSheet();
    s = applyBorder(s, 0, 0, 0, 0, { edges: ["top"], style: "thin", mode: "outline" });
    s = applyBorder(s, 0, 0, 0, 0, { edges: ["bottom"], style: "double", mode: "outline" });
    expect(styleAt(s, 0, 0).border).toEqual({ top: "thin", bottom: "double" });
  });
});

describe("clearFormatting", () => {
  it("wipes style AND number format but leaves the cell's VALUE untouched", () => {
    let s = createSheet();
    s = setRaw(s, 0, 0, "1234");
    s = setCellStyle(s, 0, 0, 0, 0, { bold: true });
    s = setNumberFormat(s, 0, 0, 0, 0, "$#,##0");
    s = clearFormatting(s, 0, 0, 0, 0);
    expect(styleAt(s, 0, 0)).toEqual({});
    expect(formatAt(s, 0, 0)).toBe(null);
    expect(s.cells["c1:0"]).toBe("1234");
  });
  it("a no-op (nothing formatted) returns the same reference", () => {
    const s = createSheet();
    expect(clearFormatting(s, 0, 0, 0, 0)).toBe(s);
  });
});

describe("format painter (paintedStyleAt / applyPaintedStyle)", () => {
  it("captures a source cell's format+style and applies it to a target range, REPLACING (not merging into) the target's own look", () => {
    let s = createSheet();
    s = setCellStyle(s, 0, 0, 0, 0, { bold: true, color: "#ff0000", border: { bottom: "double" } });
    s = setNumberFormat(s, 0, 0, 0, 0, "$#,##0");
    // Target already has ITS OWN style — italic — which the paint must clear away.
    s = setCellStyle(s, 5, 5, 3, 3, { italic: true });
    const painted = paintedStyleAt(s, 0, 0);
    s = applyPaintedStyle(s, 5, 5, 3, 3, painted);
    expect(styleAt(s, 5, 3)).toEqual({ bold: true, color: "#ff0000", border: { bottom: "double" } });
    expect(formatAt(s, 5, 3)).toBe("$#,##0");
  });
  it("painting a plain (unformatted) source onto a styled target clears the target's style", () => {
    let s = createSheet();
    s = setCellStyle(s, 3, 3, 3, 3, { bold: true });
    const painted = paintedStyleAt(s, 0, 0); // an untouched, plain cell
    s = applyPaintedStyle(s, 3, 3, 3, 3, painted);
    expect(styleAt(s, 3, 3)).toEqual({});
    expect(formatAt(s, 3, 3)).toBe(null);
  });
});

describe("merge / unmerge (horizontal-only)", () => {
  it("merges a same-row multi-column range; mergeAt resolves any cell in the span to it", () => {
    let s = createSheet();
    s = mergeRange(s, 0, 0, 1, 3);
    expect(mergeAt(s, 0, 1)).toEqual({ r: 0, c1: 1, c2: 3 });
    expect(mergeAt(s, 0, 2)).toEqual({ r: 0, c1: 1, c2: 3 }); // interior column resolves to the same span
    expect(mergeAt(s, 0, 3)).toEqual({ r: 0, c1: 1, c2: 3 });
    expect(mergeAt(s, 0, 0)).toBe(null); // just outside the span
    expect(mergeAt(s, 1, 1)).toBe(null); // same columns, different row
  });
  it("a single-cell or multi-row selection is a no-op — horizontal merge only", () => {
    let s = createSheet();
    expect(mergeRange(s, 0, 0, 2, 2)).toBe(s); // one cell, nothing to merge
    expect(mergeRange(s, 0, 1, 1, 3)).toBe(s); // spans two ROWS — refused
  });
  it("merging never touches any cell's stored VALUE — unmerging restores exactly what was there", () => {
    let s = createSheet();
    s = setRaw(s, 0, 1, "left");
    s = setRaw(s, 0, 2, "middle");
    s = mergeRange(s, 0, 0, 1, 3);
    s = unmergeAt(s, 0, 2);
    expect(s.cells["c2:0"]).toBe("left");
    expect(s.cells["c3:0"]).toBe("middle");
    expect(mergeAt(s, 0, 1)).toBe(null);
  });
  it("a new merge overlapping an existing one on the same row replaces it, never leaves two", () => {
    let s = createSheet();
    s = mergeRange(s, 0, 0, 0, 2);
    s = mergeRange(s, 0, 0, 1, 4);
    expect(s.merges.length).toBe(1);
    expect(mergeAt(s, 0, 4)).toEqual({ r: 0, c1: 1, c2: 4 });
  });

  describe("interaction with row/column insert/delete", () => {
    it("inserting a row above a merge shifts the merge's own row down", () => {
      let s = createSheet();
      s = mergeRange(s, 2, 2, 0, 2);
      s = insertRowAt(s, 0);
      expect(mergeAt(s, 3, 1)).toEqual({ r: 3, c1: 0, c2: 2 });
      expect(mergeAt(s, 2, 1)).toBe(null);
    });
    it("deleting the merge's own row drops the merge", () => {
      let s = createSheet();
      s = mergeRange(s, 2, 2, 0, 2);
      s = deleteRowAt(s, 2);
      expect(s.merges.length).toBe(0);
    });
    it("deleting an INTERIOR column of a merge shrinks it without changing its endpoints", () => {
      let s = createSheet();
      s = mergeRange(s, 0, 0, 0, 3); // A..D
      s = deleteColumn(s, 1); // delete B (interior)
      expect(mergeAt(s, 0, 0)).toEqual({ r: 0, c1: 0, c2: 2 }); // now spans 3 columns, same anchor id
    });
    it("deleting the merge's ANCHOR column shrinks it from the left, dropping it if only 1 column would remain", () => {
      let s = createSheet();
      s = mergeRange(s, 0, 0, 0, 1); // A..B, exactly 2 columns
      s = deleteColumn(s, 0); // delete the anchor
      expect(s.merges.length).toBe(0); // collapsed to 1 column — dropped
    });
    it("inserting a column doesn't disturb an existing merge's id anchors", () => {
      let s = createSheet();
      s = mergeRange(s, 0, 0, 2, 4);
      s = insertColumnAt(s, 0); // insert well before the merge
      expect(mergeAt(s, 0, 3)).toEqual({ r: 0, c1: 3, c2: 5 }); // shifted right by the new column
    });
  });

  it("migrateSheet defaults `merges` to [] for a pre-ribbon blob, and round-trips a real one", () => {
    const s = createSheet();
    const fresh = migrateSheet({});
    expect(fresh.merges).toEqual([]);
    const withMerge = mergeRange(s, 0, 0, 0, 2);
    const migrated = migrateSheet(withMerge);
    expect(migrated.merges).toEqual(withMerge.merges);
  });
});

describe("sortRange", () => {
  function sheetWithColumn(values) {
    let s = createSheet();
    values.forEach((v, r) => { s = setRaw(s, r, 0, v); s = setRaw(s, r, 1, `row-${v}`); });
    return s;
  }
  it("sorts ascending by default, numbers before text, blanks always last", () => {
    let s = sheetWithColumn(["30", "10", "", "20"]);
    s = sortRange(s, 0, 3, 0, "asc");
    expect([s.cells["c1:0"], s.cells["c1:1"], s.cells["c1:2"], s.cells["c1:3"]]).toEqual(["10", "20", "30", undefined]);
  });
  it("descending reverses order but blanks STILL sort last (never flung to the top)", () => {
    let s = sheetWithColumn(["30", "10", "", "20"]);
    s = sortRange(s, 0, 3, 0, "desc");
    expect([s.cells["c1:0"], s.cells["c1:1"], s.cells["c1:2"], s.cells["c1:3"]]).toEqual(["30", "20", "10", undefined]);
  });
  it("moves the WHOLE row together — every column's value travels with its sort key", () => {
    let s = sheetWithColumn(["30", "10", "20"]);
    s = sortRange(s, 0, 2, 0, "asc");
    expect(s.cells["c1:0"]).toBe("10"); expect(s.cells["c2:0"]).toBe("row-10");
    expect(s.cells["c1:2"]).toBe("30"); expect(s.cells["c2:2"]).toBe("row-30");
  });
  it("format and style travel with the row too", () => {
    let s = sheetWithColumn(["30", "10"]);
    s = setNumberFormat(s, 0, 0, 0, 0, "$#,##0"); // the "30" row's own format
    s = setCellStyle(s, 0, 0, 0, 0, { bold: true });
    s = sortRange(s, 0, 1, 0, "asc"); // 10 moves to row 0, 30 to row 1
    expect(formatAt(s, 1, 0)).toBe("$#,##0");
    expect(styleAt(s, 1, 0)).toEqual({ bold: true });
    expect(formatAt(s, 0, 0)).toBe(null);
  });
  it("refuses (no-op) when a merge touches the sort range — never corrupts a merge's framing", () => {
    let s = sheetWithColumn(["30", "10", "20"]);
    s = mergeRange(s, 1, 1, 0, 1);
    const sorted = sortRange(s, 0, 2, 0, "asc");
    expect(sorted).toBe(s);
  });
  it("a single-row range is a no-op", () => {
    const s = sheetWithColumn(["30"]);
    expect(sortRange(s, 0, 0, 0, "asc")).toBe(s);
  });
});
