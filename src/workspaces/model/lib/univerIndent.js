/* Model workspace — indent for the Univer grid (NEW-1; docs/SPREADSHEET-UNIVER-SPIKE.md "Cutover plan" step 3).
 *
 * Univer 1.x has no indent: its cell style has no indent field and @univerjs/sheets-ui has no indent command. It does
 * have a per-cell PADDING (`pd`) that its renderer honours — for plain text, for text that spills across empty
 * neighbours and for shrink-to-fit — and `pd` is on the short list of style keys Univer's commands keep (a custom style
 * field is silently stripped by SetRangeValues; measured). So an indent is:
 *
 *   · STORED as the cell's own `pd.l` — `2 + 14·N` for indent N (1..15), ONE number on the cell's style. A style travels
 *     with its cell through insert/delete rows and columns, sort, drag, fill, copy/paste and the format painter, which
 *     is exactly why it is NOT kept in the sidecar (a position-keyed entry would have to be chased across every one of
 *     those). The bridge maps it ⇄ Planyr's `styles[key].indent` (univerBridge.js) — one number, no second copy.
 *   · DRAWN by a render-time interceptor (installUniverIndent below) that projects the stored number onto the READING
 *     SIDE only, from the cell's alignment and column width, every time the cell is painted. So an alignment change or a
 *     column resize can never leave a stale padding behind, and one Increase Indent click is exactly one undo step (a
 *     single SetRangeValues command).
 *
 * The numbers are the old grid's (cellTextLayout.js: one step = INDENT_STEP_PX, the reading side only, the total clamped
 * so text can never be pushed out of its own column), so a sheet indented in either grid looks the same in both.
 *
 * Pure parts first (unit-tested in test/modelUniverIndent.test.js); `installUniverIndent` is the only part that touches
 * Univer, and it receives every Univer symbol it needs from UniverSheet.jsx (this file imports nothing from @univerjs,
 * so it loads in the unit tests and the lazy-chunk rule — only UniverSheet.jsx imports @univerjs/* — still holds). */
import { INDENT_STEP_PX } from "./cellTextLayout.js";

/** Same cap as the old grid (`sheetModel.MAX_INDENT`) — kept as its own constant so this file stays free of the model. */
export const UNIVER_MAX_INDENT = 15;
/** Univer's own default horizontal padding (`DEFAULT_PADDING_DATA`): what a cell with no indent keeps. */
export const UNIVER_BASE_PAD_PX = 2;
/** Room kept for the cell's border and the grid line so the padding can never reach the far edge of the column. */
const EDGE_ALLOWANCE_PX = 4;
/** The command ids a key / key-tip binding can use (the Excel-keys session binds Alt H 6 / Alt H 5 to these). */
export const INDENT_COMMAND_IDS = { increase: "planyr.sheet.command.increase-indent", decrease: "planyr.sheet.command.decrease-indent" };

// Univer's horizontal-alignment enum, as plain numbers (same convention as univerBridge.js).
const HT_CENTER = 2, HT_RIGHT = 3;

/** Any value → a whole indent 0..15 (junk, negatives and fractions can never reach the renderer). */
export function clampIndent(v) {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.max(0, Math.min(UNIVER_MAX_INDENT, n)) : 0;
}

/** The indent a Univer cell style holds (0 when it has none): `pd.l` above Univer's own 2 px, in whole steps. */
export function indentOfStyle(style) {
  const l = style && style.pd && style.pd.l;
  return typeof l === "number" && l > UNIVER_BASE_PAD_PX ? clampIndent((l - UNIVER_BASE_PAD_PX) / INDENT_STEP_PX) : 0;
}

/** The Univer style fragment that STORES an indent (`pd: null` clears it — Univer's own way to remove a field). */
export function storedIndentStyle(n) {
  const k = clampIndent(n);
  return { pd: k ? { l: UNIVER_BASE_PAD_PX + k * INDENT_STEP_PX } : null };
}

/** One Increase (+1) / Decrease (−1) step from a cell's OWN level, capped at 0..15 (the old grid's `adjustIndent`). */
export function stepIndent(current, delta) {
  return clampIndent(clampIndent(current) + delta);
}

/**
 * The horizontal padding (px) Univer should draw a cell with, or null when the cell has no indent (it is then left
 * exactly as Univer would draw it). Excel's rule, as in the old grid: the inset is on the READING side only — left for
 * left-aligned / general text, right for right-aligned, none for centred — and the total can never exceed the column,
 * so a deep indent in a narrow column leaves the text no room (clipped) and never draws it outside the column.
 *   align — Univer `ht` (1 left, 2 center, 3 right, 0/undefined general)
 *   width — the column's width in px (undefined: no clamp)
 */
export function indentPadding({ indent, align, width }) {
  const n = clampIndent(indent);
  if (!n) return null;
  const wanted = n * INDENT_STEP_PX;
  const room = Number.isFinite(width) ? Math.max(0, width - 2 * UNIVER_BASE_PAD_PX - EDGE_ALLOWANCE_PX) : wanted;
  const extra = Math.min(wanted, room);
  if (align === HT_CENTER) return { l: UNIVER_BASE_PAD_PX, r: UNIVER_BASE_PAD_PX };
  if (align === HT_RIGHT) return { l: UNIVER_BASE_PAD_PX, r: UNIVER_BASE_PAD_PX + extra };
  return { l: UNIVER_BASE_PAD_PX + extra, r: UNIVER_BASE_PAD_PX };
}

/**
 * The style a cell is DRAWN with: its own style plus the indent padding. Returns the same object when there is nothing
 * to do (no indent), so the common cell costs a single property read per paint.
 */
export function styleForRender(style, width) {
  if (!style) return style;
  const pad = indentPadding({ indent: indentOfStyle(style), align: style.ht, width });
  if (!pad) return style;
  return { ...style, pd: { t: 0, b: 2, ...(style.pd || {}), ...pad } };
}

/**
 * Cells a ± click changes, as a SetRangeValues matrix: every cell of every selected range, each stepped from its OWN
 * level (an empty cell is indented too, as in Excel). `styleAt(r, c)` answers the cell's raw Univer style (or null);
 * `bounds` is { rows, cols } of the sheet so a whole-column / whole-sheet selection stays inside it.
 * Returns { matrix, changed } — `matrix[r][c] = { s: { pd } }`, `pd: null` removes the indent at level 0.
 */
export function indentPatch(ranges, delta, styleAt, bounds) {
  const matrix = {};
  let changed = 0;
  const rows = bounds && bounds.rows != null ? bounds.rows : Infinity;
  const cols = bounds && bounds.cols != null ? bounds.cols : Infinity;
  for (const rg of ranges || []) {
    const r2 = Math.min(rg.endRow, rows - 1), c2 = Math.min(rg.endColumn, cols - 1);
    for (let r = Math.max(0, rg.startRow); r <= r2; r++) {
      for (let c = Math.max(0, rg.startColumn); c <= c2; c++) {
        if (matrix[r] && matrix[r][c]) continue;                 // two overlapping ranges: step a cell once
        const cur = indentOfStyle(styleAt(r, c));
        const next = stepIndent(cur, delta);
        if (next === cur) continue;
        (matrix[r] || (matrix[r] = {}))[c] = { s: storedIndentStyle(next) };
        changed++;
      }
    }
  }
  return { matrix, changed };
}

/** The two toolbar icons — the old Ribbon's (components/Ribbon.jsx IconIndentInc / IconIndentDec), as plain SVG data. */
export const INDENT_ICONS = {
  increase: { lines: [[3, 5, 21, 5], [11, 9, 21, 9], [11, 15, 21, 15], [3, 19, 21, 19]], arrow: "3 10 7 12 3 14" },
  decrease: { lines: [[3, 5, 21, 5], [11, 9, 21, 9], [11, 15, 21, 15], [3, 19, 21, 19]], arrow: "7 10 3 12 7 14" },
};

/**
 * Wire indent into a live Univer: the render interceptor, the two commands and the two Start-tab buttons.
 * Everything Univer-shaped arrives in `deps` (UniverSheet.jsx imports it), so nothing here imports @univerjs.
 *   deps.univerAPI, deps.injector                         — the facade and the root injector
 *   deps.SheetInterceptorService, INTERCEPTOR_POINT, InterceptorEffectEnum, SetRangeValuesCommand, ICommandService,
 *   deps.CommandType, deps.IconManager, deps.createElement — Univer / React symbols
 * Returns { dispose, run(delta) } (`run` is what the two commands call; exposed for the harness).
 */
export function installUniverIndent(deps) {
  const {
    univerAPI, injector, SheetInterceptorService, INTERCEPTOR_POINT, InterceptorEffectEnum,
    SetRangeValuesCommand, ICommandService, CommandType, IconManager, createElement,
  } = deps;
  const disposers = [];
  const commands = injector.get(ICommandService);

  // 1. DRAW: every paint of a cell that carries `ind` goes through here and gets the reading-side padding.
  const interceptors = injector.get(SheetInterceptorService);
  disposers.push(interceptors.intercept(INTERCEPTOR_POINT.CELL_CONTENT, {
    id: "planyr.indent.render",
    effect: InterceptorEffectEnum.Style,
    priority: 100,
    handler: (cell, context, next) => {
      const base = cell || context.rawData;
      if (!base || base.s == null) return next(cell);
      const style = typeof base.s === "string" ? context.workbook.getStyles().get(base.s) : base.s;
      if (!style || !indentOfStyle(style)) return next(cell);
      const drawn = styleForRender(style, context.worksheet.getColumnWidth(context.col));
      return next({ ...base, s: drawn });
    },
  }));

  // 2. CHANGE: one SetRangeValues command for the whole selection = one undo step.
  const run = (delta) => {
    const fWb = univerAPI.getActiveWorkbook();
    const fWs = fWb && fWb.getActiveSheet();
    if (!fWs) return false;
    const sel = fWs.getSelection();
    const ranges = ((sel && sel.getActiveRangeList && sel.getActiveRangeList()) || []).map((r) => r.getRange());
    if (!ranges.length) return false;
    const ws = fWb.getWorkbook ? fWb.getWorkbook().getSheetBySheetId(fWs.getSheetId()) : null;
    const styles = fWb.getWorkbook().getStyles();
    const styleAt = (r, c) => { const cell = ws.getCellRaw(r, c); return cell && cell.s != null ? (typeof cell.s === "string" ? styles.get(cell.s) : cell.s) : null; };
    const { matrix, changed } = indentPatch(ranges, delta, styleAt, { rows: ws.getRowCount(), cols: ws.getColumnCount() });
    if (!changed) return true;
    return commands.syncExecuteCommand(SetRangeValuesCommand.id, { unitId: fWb.getId(), subUnitId: fWs.getSheetId(), value: matrix });
  };
  for (const [key, delta] of [["increase", 1], ["decrease", -1]]) {
    disposers.push(commands.registerCommand({ id: INDENT_COMMAND_IDS[key], type: CommandType.COMMAND, handler: () => run(delta) }));
  }

  // 3. BUTTONS: Start tab, the "layout" group beside alignment, the old Ribbon's icons.
  const iconNames = {};
  for (const key of ["increase", "decrease"]) {
    const spec = INDENT_ICONS[key];
    const name = `PlanyrIndent${key === "increase" ? "Inc" : "Dec"}Icon`;
    iconNames[key] = name;
    // Univer draws a toolbar icon through its IconManager (not the component registry) and hands it className / style.
    const Icon = ({ className, style }) => createElement("svg", { className, style, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round", strokeLinejoin: "round" },
      ...spec.lines.map(([x1, y1, x2, y2], i) => createElement("line", { key: i, x1, y1, x2, y2 })),
      createElement("polyline", { key: "a", points: spec.arrow }));
    disposers.push(injector.get(IconManager).register(name, Icon));
  }
  const buttons = [
    ["decrease", "Decrease indent", { row: 1, column: 4 }, 4],
    ["increase", "Increase indent", { row: 2, column: 4 }, 5],
  ];
  for (const [key, title, gridLayout, order] of buttons) {
    univerAPI.createMenu({ id: INDENT_COMMAND_IDS[key], action: INDENT_COMMAND_IDS[key], icon: iconNames[key], title, tooltip: title, order, gridLayout })
      .appendTo("ribbon.start.layout");
  }
  return { run, dispose: () => disposers.forEach((d) => { try { d && d.dispose && d.dispose(); } catch (_) { /* disposing */ } }) };
}
