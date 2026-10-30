/* Model workspace — autofit column width / row height (double-click a header border, the header
 * right-click menu, and Alt H O I / Alt H O A).
 *
 * ONE implementation, three callers: SheetView's double-click and menu, and ModelApp's key-tip
 * leaves. Pure over an injected `measure(text, font) -> px` so it unit-tests without a canvas;
 * `canvasMeasure` is the real one (a single lazily-created offscreen canvas).
 *
 * Column: the widest rendered value in that column, header included, plus cell padding.
 * Row: Excel's answer — a row grows to fit WRAPPED text (and an explicit new line from Alt+Enter),
 * and a taller font; an unwrapped row of ordinary text is the default height.
 */
import { displayFor } from "./sheetEngine.js";
import { colAt, mergeAt, styleAt, DEFAULT_ROW_H } from "./sheetModel.js";

export const CELL_FONT = "12.5px system-ui, sans-serif"; // must match the cell's rendered font in SheetView
const BASE_FONT_PX = 12.5;
const PAD_X = 12;      // 6px cell padding each side
const COL_PAD = 18;    // + breathing room (the historical value, unchanged)
const MIN_COL_W = 40;
const LINE_RATIO = 1.25;
const PAD_Y = 6;

let ctx2d = null;
export function canvasMeasure(text, font) {
  if (typeof document === "undefined") return 0; // no DOM (unit tests inject their own measure)
  if (!ctx2d) ctx2d = document.createElement("canvas").getContext("2d");
  ctx2d.font = font;
  return ctx2d.measureText(String(text ?? "")).width;
}

export const fontFor = (style) =>
  `${style?.italic ? "italic " : ""}${style?.bold ? "700 " : ""}${style?.fontSize || BASE_FONT_PX}px ${style?.fontFamily || "system-ui, sans-serif"}`;

/** Logical width (px) column `c` needs to show its widest value. */
export function autofitColumnWidth(sheet, evalResult, c, measure = canvasMeasure) {
  let maxW = MIN_COL_W;
  maxW = Math.max(maxW, measure(colAt(sheet, c)?.name || "", "600 12.5px system-ui, sans-serif"));
  for (let r = 0; r < sheet.rowCount; r++) {
    const text = displayFor(sheet, evalResult, r, c);
    if (!text) continue;
    // a multi-line cell is as wide as its longest line
    const w = String(text).split("\n").reduce((m, line) => Math.max(m, measure(line, fontFor(styleAt(sheet, r, c)))), 0);
    if (w > maxW) maxW = w;
  }
  return Math.ceil(maxW) + COL_PAD;
}

/** Lines `text` occupies in a box `maxW` wide: explicit new lines count, words wrap greedily, and
 *  one unbroken word wider than the box breaks across as many lines as it needs. */
export function wrappedLineCount(text, maxW, font, measure = canvasMeasure) {
  let lines = 0;
  for (const para of String(text).split("\n")) {
    if (para === "") { lines += 1; continue; }
    let line = "", n = 1;
    for (const word of para.split(" ")) {
      const trial = line ? `${line} ${word}` : word;
      if (measure(trial, font) <= maxW) { line = trial; continue; }
      if (line) { n += 1; line = word; } else line = word;
      const w = measure(word, font);
      if (w > maxW) { n += Math.ceil(w / maxW) - 1; line = ""; }
    }
    lines += n;
  }
  return Math.max(1, lines);
}

/** Logical height (px) row `r` needs. `colWidthOf(c)` is each column's logical width (a merged
 *  anchor sums its span). Never below the default row height. */
export function autofitRowHeight(sheet, evalResult, r, colWidthOf, measure = canvasMeasure) {
  let need = DEFAULT_ROW_H;
  for (let c = 0; c < sheet.columns.length; c++) {
    if (sheet.columns[c].hidden) continue;
    const text = displayFor(sheet, evalResult, r, c);
    const st = styleAt(sheet, r, c) || {};
    const size = st.fontSize || BASE_FONT_PX;
    const lineH = size * LINE_RATIO;
    if (!text) { need = Math.max(need, Math.ceil(lineH + PAD_Y)); continue; }
    const merge = mergeAt(sheet, r, c);
    if (merge && merge.c1 !== c) continue;
    let w = colWidthOf(c);
    if (merge) { w = 0; for (let k = merge.c1; k <= merge.c2; k++) w += colWidthOf(k); }
    const wraps = !!st.wrap;
    const hasNewline = String(text).includes("\n");
    const lines = wraps
      ? wrappedLineCount(text, Math.max(10, w - PAD_X - (st.indent || 0) * 14), fontFor(st), measure)
      : hasNewline ? String(text).split("\n").length : 1;
    need = Math.max(need, Math.ceil(lines * lineH + PAD_Y));
  }
  return need;
}
