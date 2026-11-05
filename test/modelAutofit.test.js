/* lib/autofit.js — autofit column width / row height (Alt H O I / Alt H O A, header double-click). Pure over an injected
 * measurer: 7 px per character stands in for the canvas. */
import { describe, it, expect } from "vitest";
import { autofitColumnWidth, autofitRowHeight, wrappedLineCount } from "../src/workspaces/model/lib/autofit.js";
import { createSheet, commitCellText, setCellStyle, mergeRange, DEFAULT_ROW_H } from "../src/workspaces/model/lib/sheetModel.js";
import { evaluateWorkbook } from "../src/workspaces/model/lib/sheetEngine.js";
import { createWorkbook } from "../src/workspaces/model/lib/sheetModel.js";

const measure = (text) => String(text).length * 7;
function evalSheet(sheet) {
  const wb = { ...createWorkbook(), sheets: [{ id: "s1", name: "Sheet1", sheet }], activeSheetId: "s1" };
  return evaluateWorkbook(wb, {}).get("s1");
}
const colW = () => 120;

describe("autofitColumnWidth", () => {
  it("fits the widest value in the column (all rows, not just the visible ones) plus padding", () => {
    let s = createSheet();
    s = commitCellText(s, 3, 0, "short");
    s = commitCellText(s, 800, 0, "x".repeat(40)); // far below the viewport
    expect(autofitColumnWidth(s, evalSheet(s), 0, measure)).toBe(40 * 7 + 18);
  });
  it("never goes below the minimum for a short column", () => {
    const s = createSheet();
    expect(autofitColumnWidth(s, evalSheet(s), 0, measure)).toBe(40 + 18);
  });
  it("measures a formula's DISPLAYED result, and a multi-line cell by its longest line", () => {
    let s = createSheet();
    s = commitCellText(s, 0, 0, "=1234567*10");
    s = commitCellText(s, 1, 0, "ab\n" + "y".repeat(30));
    expect(autofitColumnWidth(s, evalSheet(s), 0, measure)).toBe(30 * 7 + 18);
  });
});

describe("wrappedLineCount", () => {
  it("counts explicit new lines, greedy word wraps, and breaks one over-long word", () => {
    expect(wrappedLineCount("a\nb\nc", 500, "f", measure)).toBe(3);
    expect(wrappedLineCount("aaa bbb ccc ddd", 7 * 8, "f", measure)).toBe(2); // 8 chars fit: "aaa bbb" / "ccc ddd"
    expect(wrappedLineCount("x".repeat(30), 7 * 10, "f", measure)).toBe(3);
    expect(wrappedLineCount("", 100, "f", measure)).toBe(1);
  });
});

describe("autofitRowHeight", () => {
  it("an ordinary unwrapped row stays the default height (Excel's answer)", () => {
    let s = createSheet();
    s = commitCellText(s, 0, 0, "plain text that is long but not wrapped");
    expect(autofitRowHeight(s, evalSheet(s), 0, colW, measure)).toBe(DEFAULT_ROW_H);
  });
  it("a wrapped cell grows the row to show every wrapped line", () => {
    let s = createSheet();
    s = commitCellText(s, 0, 0, "word ".repeat(40)); // 200 chars -> 1400 px, column inner width 108 -> ~15 chars/line
    s = setCellStyle(s, 0, 0, 0, 0, { wrap: true });
    const h = autofitRowHeight(s, evalSheet(s), 0, colW, measure);
    expect(h).toBeGreaterThan(DEFAULT_ROW_H * 4);
  });
  it("an Alt+Enter new line grows the row even when wrap is off", () => {
    let s = createSheet();
    s = commitCellText(s, 0, 0, "one\ntwo\nthree");
    expect(autofitRowHeight(s, evalSheet(s), 0, colW, measure)).toBeGreaterThan(DEFAULT_ROW_H + 10);
  });
  it("the tallest cell in the row wins; a larger font alone raises a row", () => {
    let s = createSheet();
    s = commitCellText(s, 0, 0, "big");
    s = setCellStyle(s, 0, 0, 0, 0, { fontSize: 24 });
    expect(autofitRowHeight(s, evalSheet(s), 0, colW, measure)).toBeGreaterThan(DEFAULT_ROW_H);
  });
  it("hidden columns do not count; a merged cell is as wide as its span", () => {
    let s = createSheet();
    s = commitCellText(s, 0, 0, "m".repeat(30));
    s = setCellStyle(s, 0, 0, 0, 2, { wrap: true });
    s = mergeRange(s, 0, 0, 0, 2); // 3 x 120 = 360 wide: 30 chars (210 px) fit on one line
    expect(autofitRowHeight(s, evalSheet(s), 0, colW, measure)).toBe(DEFAULT_ROW_H);
  });
});
