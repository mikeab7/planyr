/* Model workspace — what each Excel key DOES on the Univer grid (NEW-1, 2026-10-30).
 *
 * Imports Univer, so it rides the lazy UniverSheet chunk only (never an eager module). Every action is registered by
 * `./index.js` as a real Univer command (`planyr.excel.<id>`), so the shortcut service, the Alt key-tips and a test can all
 * run the SAME function, and it goes through Univer's command service like any toolbar button does.
 *
 * Rules every action follows:
 *  - It reaches the sheet through Univer's own commands / facade — never by writing cells behind its back — so the bridge's
 *    structural bookkeeping (column ids, sidecar) sees an insert / delete exactly as it sees one from the toolbar.
 *  - It is ONE undo step: the whole action runs inside one undo group (`inOneUndo`), however many Univer commands it takes.
 *  - A command Excel refuses on several selected ranges says so (`MULTI_SELECTION_MESSAGE`) instead of acting on one.
 *  - It never throws into the key handler: a failure is surfaced through `env.notice` (LOUD-FAILURE), not swallowed.
 */
import {
  ICommandService, IUndoRedoService, HorizontalAlign, VerticalAlign, BorderType, BorderStyleTypes, Dimension, RANGE_TYPE, CellValueType,
} from "@univerjs/presets";
import { MULTI_SELECTION_MESSAGE } from "../../../../shared/selection/rangeSelection.js";
import {
  NUMFMT_FOR, TODAY_PATTERN, TIME_PATTERN, dateSerial, timeFraction, INSERT_CHOICES, DELETE_CHOICES, structureKind, wholeLineRanges, NAV_ACTIONS, navPlan,
} from "./bindings.js";
import { promptChoice, promptNumber } from "./dialogs.js";
import { INDENT_COMMAND_IDS } from "../univerIndent.js";

const UNIVER = Object.freeze({
  strike: "sheet.command.set-range-stroke",
  bold: "sheet.command.set-range-bold", italic: "sheet.command.set-range-italic", underline: "sheet.command.set-range-underline",
  numfmtPanel: "sheet.operation.open.numfmt.panel", addDecimal: "sheet.command.numfmt.add.decimal.command", subDecimal: "sheet.command.numfmt.subtract.decimal.command",
  borderBasic: "sheet.command.set-border-basic",
  setSelections: "sheet.operation.set-selections",
  colAutoWidth: "sheet.command.set-col-auto-width",
  hAlign: "sheet.command.set-horizontal-text-align", vAlign: "sheet.command.set-vertical-text-align",
  mergeAll: "sheet.command.add-worksheet-merge-all", unmerge: "sheet.command.remove-worksheet-merge",
  clearAll: "sheet.command.clear-selection-all", clearContent: "sheet.command.clear-selection-content", clearFormat: "sheet.command.clear-selection-format",
  sortAsc: "sheet.command.sort-range-asc-ext", sortDesc: "sheet.command.sort-range-desc-ext", filter: "sheet.command.smart-toggle-filter",
  freezeSelection: "sheet.command.set-selection-frozen", freezeRow: "sheet.command.set-first-row-frozen", freezeCol: "sheet.command.set-first-column-frozen", unfreeze: "sheet.command.cancel-frozen",
  painter: "ui.operation.activate-format-painter",
});

const HEIGHT_OF_RANGE = (r) => r.endRow - r.startRow + 1;
const WIDTH_OF_RANGE = (r) => r.endColumn - r.startColumn + 1;
let groupSeq = 0;

/** Build every action for one mounted grid. `env` = { api, injector, host, notice(text) }. */
export function createActions(env) {
  const commands = () => env.injector.get(ICommandService);
  const run = (id, params) => commands().executeCommand(id, params);
  const notice = (text) => { if (env.notice) env.notice(text); };

  /** The current sheet, selection and active cell, read fresh on every call (never cached). */
  const here = () => {
    const wb = env.api.getActiveWorkbook();
    const ws = wb && wb.getActiveSheet();
    if (!ws) return null;
    const sel = ws.getSelection();
    const ranges = sel.getActiveRangeList().map((r) => ({ ...r.getRange() }));
    const cur = sel.getCurrentCell();
    const first = ranges[0] || { startRow: 0, startColumn: 0 };
    const active = cur ? { row: cur.actualRow, col: cur.actualColumn } : { row: first.startRow, col: first.startColumn };
    return { wb, ws, ranges, active, unitId: wb.getId(), sheetId: ws.getSheetId(), maxRows: ws.getMaxRows(), maxCols: ws.getMaxColumns() };
  };

  /** Run `fn` as ONE undo step, however many Univer commands it takes. */
  const inOneUndo = async (unitId, fn) => {
    const undo = env.injector.get(IUndoRedoService);
    const scope = undo.beginUndoRedoGroup(unitId, `planyr-excel-${++groupSeq}`, "append");
    try { return await fn(); } finally { scope.dispose(); }
  };
  const refuseMulti = (s) => { if (s.ranges.length > 1) { notice(MULTI_SELECTION_MESSAGE); return true; } return false; };
  const eachRange = (s, fn) => s.ranges.forEach((r) => fn(s.ws.getRange(r.startRow, r.startColumn, HEIGHT_OF_RANGE(r), WIDTH_OF_RANGE(r)), r));

  // ---- formats -------------------------------------------------------------------------------------------------------
  const applyNumfmt = (pattern) => async () => {
    const s = here(); if (!s) return;
    await inOneUndo(s.unitId, () => eachRange(s, (fr) => fr.setNumberFormat(pattern)));
  };
  const border = (type, style) => async () => {
    const s = here(); if (!s) return;
    await inOneUndo(s.unitId, () => run(UNIVER.borderBasic, { value: { type, style, color: "#000000" } }));
  };

  // ---- insert / delete ---------------------------------------------------------------------------------------------------
  const insertDelete = (mode) => async () => {
    const s = here(); if (!s) return;
    const kind = structureKind(s.ranges, s.maxRows, s.maxCols);
    if (kind === "multi") { notice(MULTI_SELECTION_MESSAGE); return; }
    if (kind === "none") return;
    if (kind === "sheet") { notice(`Select a row, a column or some cells to ${mode}.`); return; }
    const r = s.ranges[0];
    let choice;
    if (kind === "rows") choice = "row";
    else if (kind === "columns") choice = "column";
    else {
      choice = await promptChoice(env.host, mode === "insert"
        ? { title: "Insert", choices: INSERT_CHOICES, initial: "shift-right" }
        : { title: "Delete", choices: DELETE_CHOICES, initial: "shift-left" });
      if (!choice) return;                                  // cancelled: nothing changes
    }
    const cur = here(); if (!cur) return;                   // the selection may have moved while the prompt was open: use the one it was opened for
    const rows = HEIGHT_OF_RANGE(r), cols = WIDTH_OF_RANGE(r);
    const area = () => cur.ws.getRange(r.startRow, r.startColumn, rows, cols);
    await inOneUndo(cur.unitId, () => {
      if (choice === "row") return mode === "insert" ? cur.ws.insertRows(r.startRow, rows) : cur.ws.deleteRows(r.startRow, rows);
      if (choice === "column") return mode === "insert" ? cur.ws.insertColumns(r.startColumn, cols) : cur.ws.deleteColumns(r.startColumn, cols);
      if (mode === "insert") return area().insertCells(choice === "shift-right" ? Dimension.COLUMNS : Dimension.ROWS);
      return area().deleteCells(choice === "shift-left" ? Dimension.COLUMNS : Dimension.ROWS);
    });
  };

  // ---- selection -----------------------------------------------------------------------------------------------------------
  const selectLine = (axis) => async () => {
    const s = here(); if (!s || s.ranges.length === 0) return;
    const lines = wholeLineRanges(s.ranges, axis, s.maxRows, s.maxCols);
    const selections = lines.map((range, i) => {
      const r = { ...range, rangeType: axis === "row" ? RANGE_TYPE.ROW : RANGE_TYPE.COLUMN };
      const row = i === lines.length - 1 ? s.active.row : range.startRow, col = i === lines.length - 1 ? s.active.col : range.startColumn;
      return {
        range: r, style: null,
        primary: { startRow: Math.min(Math.max(row, r.startRow), r.endRow), endRow: Math.min(Math.max(row, r.startRow), r.endRow),
          startColumn: Math.min(Math.max(col, r.startColumn), r.endColumn), endColumn: Math.min(Math.max(col, r.startColumn), r.endColumn),
          actualRow: Math.min(Math.max(row, r.startRow), r.endRow), actualColumn: Math.min(Math.max(col, r.startColumn), r.endColumn), isMerged: false, isMergedMainCell: false },
      };
    });
    await run(UNIVER.setSelections, { unitId: s.unitId, subUnitId: s.sheetId, selections });
  };

  // ---- Home / End / Page keys (the free build moves the selection on none of them — see bindings.js `navPlan`) ----------------------
  const navigate = (action) => async () => {
    const s = here(); if (!s || s.ranges.length === 0) return;
    const range = s.ranges[s.ranges.length - 1];
    const visible = typeof s.ws.getVisibleRange === "function" ? s.ws.getVisibleRange() : null;
    const lastRow = typeof s.ws.getLastRow === "function" ? s.ws.getLastRow() : -1;
    const lastCol = typeof s.ws.getLastColumn === "function" ? s.ws.getLastColumn() : -1;
    const plan = navPlan(action, {
      active: s.active, range, maxRows: s.maxRows, maxCols: s.maxCols,
      used: lastRow >= 0 && lastCol >= 0 ? { row: lastRow, col: lastCol } : null,
      rowsPerPage: visible ? Math.max(1, visible.endRow - visible.startRow) : 20,
      colsPerPage: visible ? Math.max(1, visible.endColumn - visible.startColumn) : 8,
    });
    if (!plan) return;
    const { anchor, end } = plan;
    if (anchor.row === end.row && anchor.col === end.col) s.ws.getRange(end.row, end.col).activate();
    else {
      const r = { startRow: Math.min(anchor.row, end.row), endRow: Math.max(anchor.row, end.row), startColumn: Math.min(anchor.col, end.col), endColumn: Math.max(anchor.col, end.col), rangeType: RANGE_TYPE.NORMAL };
      await run(UNIVER.setSelections, { unitId: s.unitId, subUnitId: s.sheetId, selections: [{
        range: r, style: null,
        primary: { startRow: anchor.row, endRow: anchor.row, startColumn: anchor.col, endColumn: anchor.col, actualRow: anchor.row, actualColumn: anchor.col, isMerged: false, isMergedMainCell: false },
      }] });
    }
    // Scroll ONLY when the target is off screen: `scrollToCell` puts the cell at the view's origin, so calling it for a cell already in view
    // would shift the sheet under a person who just pressed Home.
    const v = typeof s.ws.getVisibleRange === "function" ? s.ws.getVisibleRange() : null;
    const inView = v && end.row >= v.startRow && end.row <= v.endRow && end.col >= v.startColumn && end.col <= v.endColumn;
    if (!inView && typeof s.ws.scrollToCell === "function") s.ws.scrollToCell(end.row, end.col);
  };

  // ---- date / time / copy above --------------------------------------------------------------------------------------
  const stamp = (serial, pattern) => async () => {
    const s = here(); if (!s) return;
    const cell = s.ws.getRange(s.active.row, s.active.col);
    await inOneUndo(s.unitId, () => {
      const had = cell.getNumberFormat();                   // a cell already formatted as a date / time keeps its format (Excel does)
      cell.setValue(serial());
      if (!had || /^general$/i.test(had)) cell.setNumberFormat(pattern);
    });
  };
  const copyAbove = (kind) => async () => {
    const s = here(); if (!s) return;
    const { row, col } = s.active;
    if (row === 0) { notice("There is no cell above to copy from."); return; }
    const src = s.ws.getRange(row - 1, col), dst = s.ws.getRange(row, col);
    const formula = src.getFormula();
    await inOneUndo(s.unitId, () => {
      if (kind === "formula" && formula) { dst.setValue(formula); return; }
      let v = src.getValue();
      if (v === null || v === undefined) { const d = src.getDisplayValue(); v = d === "" ? null : d; }
      if (v === null) { dst.clearContent(); return; }
      // keep the TYPE (text "00123" stays text, a number stays a number) rather than letting the editor re-parse it
      dst.setValue({ v, t: typeof v === "number" ? CellValueType.NUMBER : typeof v === "boolean" ? CellValueType.BOOLEAN : CellValueType.STRING });
    });
  };

  // ---- hide / unhide -----------------------------------------------------------------------------------------------------
  // Through the facade, by the rows / columns the selection SPANS: Univer's own selection-based hide commands only act on
  // a whole-row / whole-column selection (a cell selection hides nothing), but Excel's Ctrl+9 / Ctrl+0 hide the lines of any cell.
  const lines = (axis, hiding) => async () => {
    const s = here(); if (!s) return;
    await inOneUndo(s.unitId, () => s.ranges.forEach((r) => {
      if (axis === "row") (hiding ? s.ws.hideRows(r.startRow, HEIGHT_OF_RANGE(r)) : s.ws.showRows(r.startRow, HEIGHT_OF_RANGE(r)));
      else (hiding ? s.ws.hideColumns(r.startColumn, WIDTH_OF_RANGE(r)) : s.ws.showColumns(r.startColumn, WIDTH_OF_RANGE(r)));
    }));
  };
  const hide = (id) => async () => { const s = here(); if (!s) return; await inOneUndo(s.unitId, () => run(id)); };

  // ---- Alt-tree leaves that are not chords ---------------------------------------------------------------------------------
  const align = (axis, value) => async () => { const s = here(); if (!s) return; await inOneUndo(s.unitId, () => run(axis === "h" ? UNIVER.hAlign : UNIVER.vAlign, { value })); };
  const toggleWrap = async () => {
    const s = here(); if (!s) return;
    const on = s.ws.getRange(s.active.row, s.active.col).getWrap();
    await inOneUndo(s.unitId, () => eachRange(s, (fr) => fr.setWrap(!on)));
  };
  const autofitColumns = async () => { const s = here(); if (!s || refuseMulti(s)) return; await inOneUndo(s.unitId, () => run(UNIVER.colAutoWidth)); };
  const autofitRows = async () => {
    const s = here(); if (!s || refuseMulti(s)) return;
    const r = s.ranges[0];
    await inOneUndo(s.unitId, () => s.ws.autoResizeRows(r.startRow, HEIGHT_OF_RANGE(r)));
  };
  const sizePrompt = (axis) => async () => {
    const s = here(); if (!s || refuseMulti(s)) return;
    const r = s.ranges[0];
    const cur = axis === "column" ? s.ws.getColumnWidth(r.startColumn) : s.ws.getRowHeight(r.startRow);
    const n = await promptNumber(env.host, axis === "column"
      ? { title: "Column width", label: HEIGHT_OF_RANGE(r) && WIDTH_OF_RANGE(r) > 1 ? "Width (every selected column)" : "Width", value: Math.round(cur) }
      : { title: "Row height", label: HEIGHT_OF_RANGE(r) > 1 ? "Height (every selected row)" : "Height", value: Math.round(cur) });
    if (!n) return;
    const now = here(); if (!now) return;
    await inOneUndo(now.unitId, () => (axis === "column" ? now.ws.setColumnWidths(r.startColumn, WIDTH_OF_RANGE(r), n) : now.ws.setRowHeights(r.startRow, HEIGHT_OF_RANGE(r), n)));
  };
  const mergeCells = (center) => async () => {
    const s = here(); if (!s || refuseMulti(s)) return;
    await inOneUndo(s.unitId, async () => { await run(UNIVER.mergeAll); if (center) await run(UNIVER.hAlign, { value: HorizontalAlign.CENTER }); });
  };
  const sortBy = (id) => async () => { const s = here(); if (!s || refuseMulti(s)) return; await inOneUndo(s.unitId, () => run(id)); };
  const freezeToggle = async () => {
    const s = here(); if (!s || refuseMulti(s)) return;
    const frozen = s.ws.getFrozenRows() > 0 || s.ws.getFrozenColumns() > 0;
    await inOneUndo(s.unitId, () => run(frozen ? UNIVER.unfreeze : UNIVER.freezeSelection));
  };
  /** Open the TOOLBAR's own colour palette (Excel's H H / H F C open a gallery you then choose from). The toolbar item is a
   *  Radix dropdown whose "More" trigger opens on a primary-button pointerdown. */
  const openToolbarMenu = (commandId, label) => async () => {
    const item = document.querySelector(`[data-u-command="${commandId}"]`);
    const trigger = item && item.querySelector('button[aria-haspopup="menu"]');
    if (!trigger) { notice(`${label} isn't available in the toolbar right now.`); return; }
    trigger.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, cancelable: true, button: 0, ctrlKey: false, pointerType: "mouse", isPrimary: true }));
  };
  // Indent is the indent plugin's own command (B2572784, lib/univerIndent.js) — Alt H 5 / H 6 run THAT, in one undo group.
  const indent = (dir) => async () => { const s = here(); if (!s) return; await inOneUndo(s.unitId, () => run(INDENT_COMMAND_IDS[dir])); };

  const A = {
    // chords
    strikethrough: () => run(UNIVER.strike),
    "number-format-dialog": () => run(UNIVER.numfmtPanel),
    "currency-style": applyNumfmt(NUMFMT_FOR["currency-style"]),
    "percent-style": applyNumfmt(NUMFMT_FOR["percent-style"]),
    "number-comma-style": applyNumfmt(NUMFMT_FOR["number-comma-style"]),
    "numfmt-general": applyNumfmt(NUMFMT_FOR["numfmt-general"]),
    "numfmt-date": applyNumfmt(NUMFMT_FOR["numfmt-date"]),
    "border-outline": border(BorderType.OUTSIDE, BorderStyleTypes.THIN),
    "border-none": border(BorderType.NONE, BorderStyleTypes.THIN),
    "insert-date": stamp(() => dateSerial(), TODAY_PATTERN),
    "insert-time": stamp(() => timeFraction(), TIME_PATTERN),
    "copy-above-formula": copyAbove("formula"),
    "copy-above-value": copyAbove("value"),
    "insert-cells": insertDelete("insert"),
    "delete-cells": insertDelete("delete"),
    "hide-rows": lines("row", true), "unhide-rows": lines("row", false),
    "hide-columns": lines("column", true), "unhide-columns": lines("column", false),
    "select-row": selectLine("row"), "select-column": selectLine("column"),
    ...Object.fromEntries(Object.keys(NAV_ACTIONS).map((id) => [id, navigate(id)])),
    // Alt key-tip leaves (lib/keyTips.js ids) that are not chords
    bold: () => run(UNIVER.bold), italic: () => run(UNIVER.italic), underline: () => run(UNIVER.underline),
    "indent-decrease": indent("decrease"), "indent-increase": indent("increase"),
    "decimal-increase": () => run(UNIVER.addDecimal), "decimal-decrease": () => run(UNIVER.subDecimal),
    "thousands-toggle": applyNumfmt(NUMFMT_FOR["number-comma-style"]),
    "wrap-text": toggleWrap,
    "fill-color-menu": openToolbarMenu("sheet.command.set-background-color", "Fill colour"),
    "font-color-menu": openToolbarMenu("sheet.command.set-range-text-color", "Font colour"),
    "border-all": border(BorderType.ALL, BorderStyleTypes.THIN),
    "border-thick-box": border(BorderType.OUTSIDE, BorderStyleTypes.THICK),
    "format-painter": () => run(UNIVER.painter),
    "align-left": align("h", HorizontalAlign.LEFT), "align-center": align("h", HorizontalAlign.CENTER), "align-right": align("h", HorizontalAlign.RIGHT),
    "valign-top": align("v", VerticalAlign.TOP), "valign-middle": align("v", VerticalAlign.MIDDLE), "valign-bottom": align("v", VerticalAlign.BOTTOM),
    "merge-cells": mergeCells(false), "merge-center": mergeCells(true),
    "unmerge-cells": hide(UNIVER.unmerge),
    "insert-row": async () => { const s = here(); if (!s || refuseMulti(s)) return; const r = s.ranges[0]; await inOneUndo(s.unitId, () => s.ws.insertRows(r.startRow, HEIGHT_OF_RANGE(r))); },
    "insert-column": async () => { const s = here(); if (!s || refuseMulti(s)) return; const r = s.ranges[0]; await inOneUndo(s.unitId, () => s.ws.insertColumns(r.startColumn, WIDTH_OF_RANGE(r))); },
    "delete-row": async () => { const s = here(); if (!s || refuseMulti(s)) return; const r = s.ranges[0]; await inOneUndo(s.unitId, () => s.ws.deleteRows(r.startRow, HEIGHT_OF_RANGE(r))); },
    "delete-column": async () => { const s = here(); if (!s || refuseMulti(s)) return; const r = s.ranges[0]; await inOneUndo(s.unitId, () => s.ws.deleteColumns(r.startColumn, WIDTH_OF_RANGE(r))); },
    "autofit-column": autofitColumns, "autofit-row": autofitRows,
    "column-width": sizePrompt("column"), "row-height": sizePrompt("row"),
    "clear-all": hide(UNIVER.clearAll), "clear-formatting": hide(UNIVER.clearFormat), "clear-contents": hide(UNIVER.clearContent),
    "sort-asc": sortBy(UNIVER.sortAsc), "sort-desc": sortBy(UNIVER.sortDesc), "filter-toggle": sortBy(UNIVER.filter),
    "freeze-toggle": freezeToggle, "freeze-top-row": sortBy(UNIVER.freezeRow), "freeze-first-column": sortBy(UNIVER.freezeCol),
  };

  /** Run one action by id; a failure is shown, never swallowed. Resolves true when the action exists. */
  const runAction = async (id) => {
    const fn = A[id];
    if (!fn) return false;
    try { await fn(); } catch (err) {
      // eslint-disable-next-line no-console
      console.error(`Excel key "${id}" failed`, err);
      notice(`That command didn't work in the new grid (${id}).`);
    }
    return true;
  };
  return { actions: A, runAction, ids: Object.keys(A) };
}

export { UNIVER as UNIVER_COMMAND_IDS };
