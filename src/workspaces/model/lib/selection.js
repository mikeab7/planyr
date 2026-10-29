/* Model workspace — THE selection model for whole rows, whole columns and the whole sheet.
 *
 * ⛔ ONE MODEL, NOT TWO (owner brief, 2026-10-29 — NEW-1/NEW-2 beside the Excel shortcuts block).
 * A selection is ONE rectangle `{ r1, r2, c1, c2 }` (r1/c1 = the anchor = the active cell). A "whole
 * column" is the rectangle that spans every row of the sheet, a "whole row" the one that spans every
 * column, "the whole sheet" both — represented as a RANGE, never as a Set of cell keys and never by
 * walking every possible cell. Clicking a column letter / row number, dragging across headers,
 * Shift+click, the corner box, Shift+Space, Ctrl+Space, Ctrl+A (second press), the Name Box ("C:C",
 * "5:5") and every structural key (Ctrl+- / Ctrl++, hide / unhide) all go through the helpers below,
 * so they cannot disagree about what "the whole column" means.
 *
 * Multi-range selection (Ctrl+click to add a second, separate row/column) is NOT supported: the
 * grid's selection is a single rectangle by design, and faking a second range would make every
 * range-wide command act on the wrong cells. A Ctrl+click on a header therefore behaves like a
 * plain click.
 *
 * Pure and DOM-free — unit-tested in the repo-root test/ suite modelSelection.
 */
import { colLetterName } from "./sheetModel.js";

const norm = (sel) => ({
  r1: Math.min(sel.r1, sel.r2), r2: Math.max(sel.r1, sel.r2),
  c1: Math.min(sel.c1, sel.c2), c2: Math.max(sel.c1, sel.c2),
});

export const lastRow = (sheet) => Math.max(0, sheet.rowCount - 1);
export const lastCol = (sheet) => Math.max(0, sheet.columns.length - 1);

/** Columns `a..b` in full (either order). Active cell = the first cell of the ANCHOR column `a`. */
export function wholeColumns(sheet, a, b = a) {
  const max = lastCol(sheet);
  return { r1: 0, r2: lastRow(sheet), c1: Math.max(0, Math.min(max, a)), c2: Math.max(0, Math.min(max, b)) };
}

/** Rows `a..b` in full (either order). Active cell = the first cell of the ANCHOR row `a`. */
export function wholeRows(sheet, a, b = a) {
  const max = lastRow(sheet);
  return { r1: Math.max(0, Math.min(max, a)), r2: Math.max(0, Math.min(max, b)), c1: 0, c2: lastCol(sheet) };
}

export function wholeSheet(sheet) {
  return { r1: 0, r2: lastRow(sheet), c1: 0, c2: lastCol(sheet) };
}

/** What the rectangle covers: "sheet" | "columns" | "rows" | "cells". A selection that reaches the
 *  sheet's last row counts as full-height even when it was made while padding rows existed (the
 *  header click selects to the padded bottom), so `>=` rather than `===`. */
export function selectionKind(sheet, sel) {
  const s = norm(sel);
  const fullH = s.r1 === 0 && s.r2 >= lastRow(sheet);
  const fullW = s.c1 === 0 && s.c2 >= lastCol(sheet);
  if (fullH && fullW) return "sheet";
  if (fullH) return "columns";
  if (fullW) return "rows";
  return "cells";
}

/** The sheet-clamped rectangle (a header selection may carry a padded bottom row). */
export function clampSelection(sheet, sel) {
  const s = norm(sel);
  return {
    r1: Math.min(s.r1, lastRow(sheet)), r2: Math.min(s.r2, lastRow(sheet)),
    c1: Math.min(s.c1, lastCol(sheet)), c2: Math.min(s.c2, lastCol(sheet)),
  };
}

/** Extending from a header (Shift+click, drag): the anchor is the selection's own first column/row
 *  `c1` / `r1` — the active cell — so Shift+click grows the run from where it began. */
export function extendFromHeader(sheet, sel, axis, index) {
  return axis === "col" ? wholeColumns(sheet, sel.c1, index) : wholeRows(sheet, sel.r1, index);
}

/** The Name Box text for a selection: "C:C" / "A:C" for whole columns, "5:5" / "2:7" for whole
 *  rows, "A:Z" for the whole sheet; `null` for a plain cell range (the caller shows the active
 *  cell's own address, unchanged). */
export function wholeSelectionLabel(sheet, sel) {
  const kind = selectionKind(sheet, sel);
  const s = clampSelection(sheet, sel);
  if (kind === "sheet") return `${colLetterName(0)}:${colLetterName(lastCol(sheet))}`;
  if (kind === "columns") return `${colLetterName(s.c1)}:${colLetterName(s.c2)}`;
  if (kind === "rows") return `${s.r1 + 1}:${s.r2 + 1}`;
  return null;
}

/** Name Box input "C:C", "A:C", "5:5", "2:7" (either order, case-insensitive) -> a whole
 *  column/row rectangle, or `null` when the text is not that shape or is out of the sheet. */
export function parseWholeAddress(text, sheet) {
  const t = String(text || "").trim().toUpperCase();
  let m = /^([A-Z]{1,3}):([A-Z]{1,3})$/.exec(t);
  if (m) {
    const toIdx = (s) => s.split("").reduce((n, ch) => n * 26 + (ch.charCodeAt(0) - 64), 0) - 1;
    const a = toIdx(m[1]), b = toIdx(m[2]);
    if (a < 0 || b < 0 || a > lastCol(sheet) || b > lastCol(sheet)) return null;
    return wholeColumns(sheet, Math.min(a, b), Math.max(a, b));
  }
  m = /^(\d{1,7}):(\d{1,7})$/.exec(t);
  if (m) {
    const a = Number(m[1]) - 1, b = Number(m[2]) - 1;
    if (a < 0 || b < 0 || a > lastRow(sheet) || b > lastRow(sheet)) return null;
    return wholeRows(sheet, Math.min(a, b), Math.max(a, b));
  }
  return null;
}

/** The header text for column `c` — ALWAYS the position's letter, recomputed from the index, never
 *  the column's stored `name` (Excel: a header is a label, not data; an insert or delete shifts the
 *  letters, and nothing a user can type changes them). */
export const columnHeaderLabel = (c) => colLetterName(c);
export const rowHeaderLabel = (r) => String(r + 1);

/** Excel's "current region" (the first Ctrl+A): the rectangle of contiguous non-empty cells around
 *  `(r, c)`, grown ring by ring until no neighbouring cell has content. `hasContent(r, c)` is the
 *  one question asked of the sheet. */
export function currentRegion(hasContent, rowCount, colCount, r, c) {
  let r1 = r, r2 = r, c1 = c, c2 = c;
  for (let guard = 0; guard < rowCount + colCount; guard++) {
    const nr1 = Math.max(0, r1 - 1), nr2 = Math.min(rowCount - 1, r2 + 1);
    const nc1 = Math.max(0, c1 - 1), nc2 = Math.min(colCount - 1, c2 + 1);
    let grew = false;
    const anyRow = (rr) => { for (let cc = nc1; cc <= nc2; cc++) if (hasContent(rr, cc)) return true; return false; };
    const anyCol = (cc) => { for (let rr = nr1; rr <= nr2; rr++) if (hasContent(rr, cc)) return true; return false; };
    if (nr1 < r1 && anyRow(nr1)) { r1 = nr1; grew = true; }
    if (nr2 > r2 && anyRow(nr2)) { r2 = nr2; grew = true; }
    if (nc1 < c1 && anyCol(nc1)) { c1 = nc1; grew = true; }
    if (nc2 > c2 && anyCol(nc2)) { c2 = nc2; grew = true; }
    if (!grew) break;
  }
  return { r1, r2, c1, c2 };
}

/** Ctrl+A: the current region first, the whole sheet on the next press (or at once when the active
 *  cell is blank with nothing around it — Excel does the same). */
export function selectAllStep(sheet, sel, hasContent) {
  if (selectionKind(sheet, sel) === "sheet") return wholeSheet(sheet);
  const region = currentRegion(hasContent, sheet.rowCount, sheet.columns.length, sel.r1, sel.c1);
  const s = clampSelection(sheet, sel);
  // the second press: the selection already covers the whole region (grown from ANY of its cells) -> everything
  const sameAsRegion = s.r1 <= region.r1 && s.r2 >= region.r2 && s.c1 <= region.c1 && s.c2 >= region.c2;
  const blankAlone = region.r1 === region.r2 && region.c1 === region.c2 && !hasContent(region.r1, region.c1);
  return blankAlone || sameAsRegion ? wholeSheet(sheet) : region;
}
