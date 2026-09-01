/* Model workspace — the sheet surface itself: row virtualization, keyboard nav, rectangular
 * selection, inline editing. The MECHANISM (not the component) is lifted from the Schedule
 * module's GridView (public/sequence/index.html) per the build brief — startIdx/endIdx from
 * scrollTop/ROW_H with a BUF of extra rows either side (:9706-9709), blank padding rows past
 * the data (:9706 emptyPad), rectangular {r1,r2,c1,c2} selection with a drag anchor and
 * shift-arrow extend (:6671-6689, :9733-9738), and commit-and-advance on Enter/Tab
 * (:10173-10184). GridView itself (973 lines, ~132 task.* property accesses, tree-aware drag
 * reorder) was NOT reused — a sheet cell has none of that shape, so this is a fresh, much
 * smaller component built the same way.
 *
 * NOT DONE, and why: horizontal virtualization. Every column renders regardless of scroll —
 * fine for an underwriting model's few dozen (to low hundreds of) columns; a sheet with
 * thousands would need it too.
 *
 * ⛔ B891184-FOLLOWUP (live production findings, 2026-08-31): formulas/formats are per-cell,
 * numbers/dates right-align, long text spills across empty neighbours, Ctrl+C/V/D and the
 * Ctrl+Home/End/Arrow block-jump keys all work — see git history for that pass.
 *
 * ⛔ STAGE 1 (owner report, 2026-09-01 — "this should be a full blown model") adds, all in this
 * file: VARIABLE ROW HEIGHT virtualization (rows used to all be one fixed height, so "row r's
 * top" was one multiplication; now it's a running total — see lib/rowLayout.js, kept pure and
 * DOM-free so the offset/search math is unit-tested without mounting this component);
 * DRAG-RESIZE for both column width and row height, with a live LOCAL preview during the drag
 * (never touching the sheet model / undo stack until mouseup — dragging one pixel must not mint
 * 40 undo frames) and DOUBLE-CLICK to autofit (a column measures its own widest rendered value
 * via canvas text metrics; a row — every cell here is still single-line, "wrap text" is a
 * Stage 2 item — resets to the default height, exactly what Excel's own row-autofit does when
 * there is no wrapped content to measure); FREEZE PANES (top rows / left columns), built with
 * CSS `position: sticky` rather than a 4-pane synced-scroll rig: a frozen ROW is rendered
 * separately from the virtualized scrolling rows below (in normal flow, sticky top, never
 * absolutely positioned — sticky and absolute don't compose on the SAME element), while a
 * frozen COLUMN is just `position: sticky; left` on that one cell, inside ANY row (frozen or
 * scrolling) — the row-header gutter itself is ALWAYS sticky-left (a pre-existing gap this pass
 * also closes: row numbers used to scroll away horizontally, which Excel never does, freeze or
 * not); and RIGHT-CLICK CONTEXT MENUS on cells/row headers/column headers (ContextMenu.jsx) for
 * insert/delete row/column and freeze toggles — the toolbar buttons for the SAME actions are a
 * Stage 2 item, so Stage 1 exposes them here first.
 */
import { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";
import { colAt, rawAt, usedRangeEnd, rowHeightAt, DEFAULT_ROW_H } from "../lib/sheetModel.js";
import { displayFor, displayKindFor } from "../lib/sheetEngine.js";
import { ctrlArrowTarget } from "../lib/sheetOps.js";
import { buildRowOffsets, visibleRowRange } from "../lib/rowLayout.js";
import ContextMenu from "./ContextMenu.jsx";

export const ROW_H = DEFAULT_ROW_H;
export const HEADER_H = 30;
const BUF = 6;
const DEFAULT_COL_W = 120;
const ROW_HEADER_W = 44;
const RESIZE_HANDLE_PX = 6;

/** Move a column index by `dir`, never past the sheet's bounds — Tab/Shift+Tab and the
 *  Right/Left arrows all share this so wrapping to the next/previous row stays consistent. */
function stepCol(colCount, c, dir) { return Math.max(0, Math.min(colCount - 1, c + dir)); }

const TEXT_ALIGN = { number: "right", date: "right", bool: "center", error: "left", text: "left", blank: "left" };

// A single shared, offscreen canvas for autofit's text-width measurement — Stage 1's "double-
// click to autofit a column" needs to know how wide the widest RENDERED value in that column
// actually is, and canvas 2D's measureText is the standard DOM-free-of-layout way to ask that
// without inserting a probe element for every candidate cell. Created lazily (once) since a
// canvas costs nothing until actually used, and this module can be imported where no DOM exists
// (tests) without constructing one.
let measureCtx = null;
function measureTextWidth(text, font) {
  if (typeof document === "undefined") return 0; // no-DOM environment (unit tests) — never used there
  if (!measureCtx) measureCtx = document.createElement("canvas").getContext("2d");
  measureCtx.font = font;
  return measureCtx.measureText(String(text ?? "")).width;
}
const CELL_FONT = "12.5px system-ui, sans-serif"; // must match the cell's own rendered font below

export default function SheetView({
  sheet, evalResult, totalRows,
  selRange, setSelRange,
  onCommit, onBlankRange, onRenameColumn, onAddColumn,
  onCopy, onPaste, onFillDown,
  onInsertRowAt, onDeleteRowAt, onInsertColumnAt, onDeleteColumnAt,
  onSetColumnWidth, onSetRowHeight, onSetFreeze,
}) {
  const outerRef = useRef(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportH, setViewportH] = useState(400);
  const [edit, setEdit] = useState(null);      // { r, c } | null
  const [editValue, setEditValue] = useState("");
  const inputRef = useRef(null);
  const dragRef = useRef(null);                // { r, c } anchor while mouse-dragging a range
  const [renaming, setRenaming] = useState(null); // colIndex | null
  const [contextMenu, setContextMenu] = useState(null); // { point:{x,y}, items } | null
  // Live LOCAL preview during a column/row drag-resize — see the file header for why this is
  // never routed through the sheet model / undo stack until the drag actually ends.
  const [colResizePreview, setColResizePreview] = useState(null); // { colIndex, width } | null
  const [rowResizePreview, setRowResizePreview] = useState(null); // { rowIndex, height } | null
  const dragStateRef = useRef(null); // the in-flight drag's own start point, read by the window listeners

  useLayoutEffect(() => {
    const el = outerRef.current;
    if (!el) return undefined;
    const measure = () => setViewportH(el.clientHeight);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const cols = sheet.columns;
  const freezeRows = Math.min(sheet.freezeRows || 0, sheet.rowCount);
  const freezeCols = Math.min(sheet.freezeCols || 0, cols.length);

  const colWidthAt = useCallback((c) => (colResizePreview && colResizePreview.colIndex === c ? colResizePreview.width : (cols[c]?.width || DEFAULT_COL_W)), [cols, colResizePreview]);
  const rowHAt = useCallback((r) => (rowResizePreview && rowResizePreview.rowIndex === r ? rowResizePreview.height : rowHeightAt(sheet, r)), [sheet, rowResizePreview]);

  const colOffsets = useMemo(() => {
    const offs = [ROW_HEADER_W];
    for (let c = 0; c < cols.length; c++) offs.push(offs[offs.length - 1] + colWidthAt(c));
    return offs;
  }, [cols, colWidthAt]);
  const totalW = colOffsets[colOffsets.length - 1];

  // Row offsets, honouring any live resize preview — same cumulative-offset shape colOffsets
  // already used for columns, now needed for rows too since a row's height can vary.
  const rowOffsets = useMemo(() => {
    const offs = new Array(totalRows + 1);
    let y = 0;
    for (let r = 0; r < totalRows; r++) { offs[r] = y; y += rowHAt(r); }
    offs[totalRows] = y;
    return offs;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sheet.rowHeights, totalRows, rowResizePreview]);

  const { startIdx, endIdx } = visibleRowRange(rowOffsets, scrollTop, viewportH, BUF, freezeRows);
  const visibleRowIdxs = [];
  for (let r = startIdx; r < endIdx; r++) visibleRowIdxs.push(r);
  const frozenRowIdxs = [];
  for (let r = 0; r < freezeRows; r++) frozenRowIdxs.push(r);

  const r1 = selRange ? Math.min(selRange.r1, selRange.r2) : 0;
  const r2 = selRange ? Math.max(selRange.r1, selRange.r2) : 0;
  const c1 = selRange ? Math.min(selRange.c1, selRange.c2) : 0;
  const c2 = selRange ? Math.max(selRange.c1, selRange.c2) : 0;
  const activeR = selRange ? selRange.r1 : 0;
  const activeC = selRange ? selRange.c1 : 0;

  // Keep the active cell on screen after keyboard navigation — a frozen row/column is ALWAYS
  // visible by construction, so this only ever needs to move the scrolling body. Without this,
  // arrow-key navigation on a 1000-row sheet could move the logical selection somewhere the
  // user can no longer see (Stage 1 grew the sheet enough that this is no longer a corner case).
  useLayoutEffect(() => {
    const el = outerRef.current;
    if (!el || edit) return;
    // A frozen row/column is ALWAYS visible (sticky) — moving the active cell into one never
    // needs a scroll. Moving into the SCROLLING region might land somewhere off-screen, so:
    // reveal it just past the frozen band's reserved space, or just inside the far edge.
    if (activeR >= freezeRows) {
      const cellTop = HEADER_H + rowOffsets[activeR], cellBottom = HEADER_H + rowOffsets[activeR + 1];
      const frozenBandBottom = el.scrollTop + HEADER_H + rowOffsets[freezeRows];
      if (cellTop < frozenBandBottom) el.scrollTop = cellTop - HEADER_H - rowOffsets[freezeRows];
      else if (cellBottom > el.scrollTop + el.clientHeight) el.scrollTop = cellBottom - el.clientHeight;
    }
    if (activeC >= freezeCols) {
      const cellLeft = colOffsets[activeC], cellRight = colOffsets[activeC + 1];
      const frozenBandRight = el.scrollLeft + colOffsets[freezeCols];
      if (cellLeft < frozenBandRight) el.scrollLeft = cellLeft - colOffsets[freezeCols];
      else if (cellRight > el.scrollLeft + el.clientWidth) el.scrollLeft = cellRight - el.clientWidth;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeR, activeC]);

  const commitEdit = useCallback((advance) => {
    if (!edit) return;
    onCommit(edit.r, edit.c, editValue);
    setEdit(null);
    // The <input> being edited is about to unmount; return focus to the sheet itself so
    // keyboard nav keeps working (a keydown on document.body would never bubble through
    // this component's own div, since body isn't a descendant of it).
    outerRef.current?.focus();
    if (advance === "down") setSelRange({ r1: Math.min(totalRows - 1, edit.r + 1), r2: Math.min(totalRows - 1, edit.r + 1), c1: edit.c, c2: edit.c });
    else if (advance === "up") setSelRange({ r1: Math.max(0, edit.r - 1), r2: Math.max(0, edit.r - 1), c1: edit.c, c2: edit.c });
    else if (advance === "right") { const c = stepCol(cols.length, edit.c, 1); setSelRange({ r1: edit.r, r2: edit.r, c1: c, c2: c }); }
    else if (advance === "left") { const c = stepCol(cols.length, edit.c, -1); setSelRange({ r1: edit.r, r2: edit.r, c1: c, c2: c }); }
    else setSelRange({ r1: edit.r, r2: edit.r, c1: edit.c, c2: edit.c });
  }, [edit, editValue, onCommit, setSelRange, totalRows, cols.length]);

  const cancelEdit = useCallback(() => { setEdit(null); outerRef.current?.focus(); }, []);

  const startEdit = useCallback((r, c, seed) => {
    const col = colAt(sheet, c);
    if (!col) return;
    setSelRange({ r1: r, r2: r, c1: c, c2: c });
    setEdit({ r, c });
    setEditValue(seed != null ? seed : rawAt(sheet, r, c));
  }, [sheet, setSelRange]);

  const cellClick = (r, c, e) => {
    outerRef.current?.focus();
    if (edit) commitEdit(null);
    if (e.shiftKey && selRange) setSelRange({ r1: selRange.r1, r2: r, c1: selRange.c1, c2: c });
    else setSelRange({ r1: r, r2: r, c1: c, c2: c });
    dragRef.current = { r, c };
  };
  const cellMouseEnter = (r, c) => { if (dragRef.current) setSelRange({ r1: dragRef.current.r, r2: r, c1: dragRef.current.c, c2: c }); };
  const stopDrag = () => { dragRef.current = null; };

  const jumpTo = (r, c) => setSelRange({ r1: r, r2: r, c1: c, c2: c });

  const onKeyDown = (e) => {
    // The header's rename <input> is a DESCENDANT of this div, so every key it doesn't
    // itself consume bubbles up here — without this guard, typing a column name also fired
    // this sheet's own type-to-edit on the active CELL, and that cell editor's `autoFocus`
    // stole focus away from the rename box, which then blurred and committed itself shut
    // after the very first keystroke.
    if (renaming != null) return;
    if (edit) {
      if (e.key === "Enter") { e.preventDefault(); commitEdit(e.shiftKey ? "up" : "down"); }
      else if (e.key === "Tab") { e.preventDefault(); commitEdit(e.shiftKey ? "left" : "right"); }
      else if (e.key === "Escape") { e.preventDefault(); cancelEdit(); }
      return;
    }
    const shift = e.shiftKey, meta = e.ctrlKey || e.metaKey;
    if (meta) {
      const k = e.key.toLowerCase();
      // Ctrl+Home / Ctrl+End — Excel's "go to A1" / "go to the last used cell". Ctrl+Arrow —
      // the "block jump" to the edge of the current run of occupied cells. All three are
      // navigation, not the app-level Ctrl+Z/Y this component deliberately leaves alone below.
      if (e.key === "Home") { e.preventDefault(); jumpTo(0, 0); return; }
      if (e.key === "End") {
        e.preventDefault();
        const used = usedRangeEnd(sheet);
        if (used) jumpTo(used.row, used.col);
        return;
      }
      if (e.key === "ArrowDown" || e.key === "ArrowUp" || e.key === "ArrowLeft" || e.key === "ArrowRight") {
        e.preventDefault();
        const dr = e.key === "ArrowDown" ? 1 : e.key === "ArrowUp" ? -1 : 0;
        const dc = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
        const hasContent = (rr, cc) => rawAt(sheet, rr, cc) !== "";
        const target = ctrlArrowTarget(hasContent, sheet.rowCount, cols.length, activeR, activeC, dr, dc);
        if (shift) setSelRange({ r1: activeR, c1: activeC, r2: target.r, c2: target.c });
        else jumpTo(target.r, target.c);
        return;
      }
      if (k === "c") { e.preventDefault(); onCopy(r1, r2, c1, c2); return; }
      if (k === "v") { e.preventDefault(); onPaste(activeR, activeC, r1, r2, c1, c2); return; }
      if (k === "d") { e.preventDefault(); onFillDown(r1, r2, c1, c2); return; }
      return; // leave every other Ctrl/Cmd chord (the app's own undo/redo, Find, name-box Go To) alone
    }
    if (e.key === "ArrowDown" || e.key === "ArrowUp" || e.key === "ArrowLeft" || e.key === "ArrowRight") {
      e.preventDefault();
      const dr = e.key === "ArrowDown" ? 1 : e.key === "ArrowUp" ? -1 : 0;
      const dc = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
      if (shift) {
        const base = selRange || { r1: 0, r2: 0, c1: 0, c2: 0 };
        setSelRange({ r1: base.r1, c1: base.c1, r2: Math.max(0, Math.min(totalRows - 1, base.r2 + dr)), c2: stepCol(cols.length, base.c2, dc) });
      } else {
        const nr = Math.max(0, Math.min(totalRows - 1, activeR + dr));
        const nc = stepCol(cols.length, activeC, dc);
        setSelRange({ r1: nr, r2: nr, c1: nc, c2: nc });
      }
      return;
    }
    if (e.key === "Tab") { e.preventDefault(); const c = stepCol(cols.length, activeC, shift ? -1 : 1); setSelRange({ r1: activeR, r2: activeR, c1: c, c2: c }); return; }
    if (e.key === "Enter") { e.preventDefault(); const r = Math.max(0, Math.min(totalRows - 1, activeR + (shift ? -1 : 1))); setSelRange({ r1: r, r2: r, c1: activeC, c2: activeC }); return; }
    if (e.key === "F2") { e.preventDefault(); startEdit(activeR, activeC, null); return; }
    if (e.key === "Delete" || e.key === "Backspace") { e.preventDefault(); onBlankRange(r1, r2, c1, c2); return; }
    if (e.key.length === 1) { e.preventDefault(); startEdit(activeR, activeC, e.key); }
  };

  const renameCommit = (colIndex, name) => { onRenameColumn(colIndex, name); setRenaming(null); };

  // ---- drag-resize (column width / row height) — a live LOCAL preview while dragging; the
  // real mutator (and its one undo frame) fires ONCE, on mouseup. ----
  const startColResize = useCallback((e, colIndex) => {
    e.preventDefault(); e.stopPropagation();
    const startWidth = colWidthAt(colIndex);
    dragStateRef.current = { kind: "col", colIndex, startX: e.clientX, startWidth };
    const onMove = (ev) => {
      const st = dragStateRef.current;
      if (!st) return;
      setColResizePreview({ colIndex: st.colIndex, width: st.startWidth + (ev.clientX - st.startX) });
    };
    const onUp = (ev) => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      const st = dragStateRef.current;
      dragStateRef.current = null;
      setColResizePreview(null);
      if (st) onSetColumnWidth(st.colIndex, st.startWidth + (ev.clientX - st.startX));
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }, [colWidthAt, onSetColumnWidth]);

  const startRowResize = useCallback((e, rowIndex) => {
    e.preventDefault(); e.stopPropagation();
    const startHeight = rowHAt(rowIndex);
    dragStateRef.current = { kind: "row", rowIndex, startY: e.clientY, startHeight };
    const onMove = (ev) => {
      const st = dragStateRef.current;
      if (!st) return;
      setRowResizePreview({ rowIndex: st.rowIndex, height: st.startHeight + (ev.clientY - st.startY) });
    };
    const onUp = (ev) => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      const st = dragStateRef.current;
      dragStateRef.current = null;
      setRowResizePreview(null);
      if (st) onSetRowHeight(st.rowIndex, st.startHeight + (ev.clientY - st.startY));
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }, [rowHAt, onSetRowHeight]);

  // Double-click autofit. Column: measure every ROW's rendered text in that column (not just
  // the visible slice — a value off-screen must still count) via canvas metrics, size to the
  // widest plus padding. Row: reset to the default height — every cell here is single-line
  // (no wrap yet — Stage 2), so there is nothing else to fit to, exactly Excel's own answer for
  // an unwrapped row.
  const autofitColumn = useCallback((colIndex) => {
    let maxW = 40; // floor: never autofit narrower than a short header needs
    const headerW = measureTextWidth(cols[colIndex]?.name || "", "600 12.5px system-ui, sans-serif");
    maxW = Math.max(maxW, headerW);
    for (let r = 0; r < sheet.rowCount; r++) {
      const text = displayFor(sheet, evalResult, r, colIndex);
      if (!text) continue;
      const w = measureTextWidth(text, CELL_FONT);
      if (w > maxW) maxW = w;
    }
    onSetColumnWidth(colIndex, Math.ceil(maxW) + 18); // + cell padding (8px each side) + a little breathing room
  }, [cols, sheet, evalResult, onSetColumnWidth]);

  const autofitRow = useCallback((rowIndex) => { onSetRowHeight(rowIndex, DEFAULT_ROW_H); }, [onSetRowHeight]);

  // ---- context menus ----
  const closeMenu = () => setContextMenu(null);
  const freezeLabel = (freezeRows > 0 || freezeCols > 0) ? "Unfreeze panes" : null;

  const openCellMenu = (e, r, c) => {
    e.preventDefault();
    const inSel = r >= r1 && r <= r2 && c >= c1 && c <= c2;
    if (!inSel) setSelRange({ r1: r, r2: r, c1: c, c2: c });
    const rr1 = inSel ? r1 : r, rr2 = inSel ? r2 : r, cc1 = inSel ? c1 : c, cc2 = inSel ? c2 : c;
    const items = [
      { key: "copy", label: "Copy", onClick: () => onCopy(rr1, rr2, cc1, cc2) },
      { key: "paste", label: "Paste", onClick: () => onPaste(rr1, cc1, rr1, rr2, cc1, cc2) },
      "divider",
      { key: "insRowAbove", label: "Insert row above", onClick: () => onInsertRowAt(r) },
      { key: "insRowBelow", label: "Insert row below", onClick: () => onInsertRowAt(r + 1) },
      { key: "insColLeft", label: "Insert column left", onClick: () => onInsertColumnAt(c) },
      { key: "insColRight", label: "Insert column right", onClick: () => onInsertColumnAt(c + 1) },
      "divider",
      { key: "delRow", label: rr2 > rr1 ? "Delete rows" : "Delete row", onClick: () => { for (let i = rr2; i >= rr1; i--) onDeleteRowAt(i); } },
      { key: "delCol", label: cc2 > cc1 ? "Delete columns" : "Delete column", onClick: () => { for (let i = cc2; i >= cc1; i--) onDeleteColumnAt(i); }, disabled: cols.length - (cc2 - cc1 + 1) < 1 },
      { key: "clear", label: "Clear contents", onClick: () => onBlankRange(rr1, rr2, cc1, cc2) },
      "divider",
      freezeLabel
        ? { key: "unfreeze", label: freezeLabel, onClick: () => onSetFreeze(0, 0) }
        : { key: "freeze", label: "Freeze panes", onClick: () => onSetFreeze(r, c) },
    ];
    setContextMenu({ point: { x: e.clientX, y: e.clientY }, items });
  };

  const openRowMenu = (e, r) => {
    e.preventDefault();
    setSelRange({ r1: r, r2: r, c1: 0, c2: cols.length - 1 });
    const items = [
      { key: "insAbove", label: "Insert row above", onClick: () => onInsertRowAt(r) },
      { key: "insBelow", label: "Insert row below", onClick: () => onInsertRowAt(r + 1) },
      { key: "del", label: "Delete row", onClick: () => onDeleteRowAt(r) },
      { key: "autofit", label: "Row height: autofit", onClick: () => autofitRow(r) },
      "divider",
      freezeLabel
        ? { key: "unfreeze", label: freezeLabel, onClick: () => onSetFreeze(0, 0) }
        : { key: "freezeTop", label: "Freeze top row", onClick: () => onSetFreeze(1, freezeCols) },
    ];
    setContextMenu({ point: { x: e.clientX, y: e.clientY }, items });
  };

  const openColMenu = (e, c) => {
    e.preventDefault();
    setSelRange({ r1: 0, r2: totalRows - 1, c1: c, c2: c });
    const items = [
      { key: "insLeft", label: "Insert column left", onClick: () => onInsertColumnAt(c) },
      { key: "insRight", label: "Insert column right", onClick: () => onInsertColumnAt(c + 1) },
      { key: "del", label: "Delete column", onClick: () => onDeleteColumnAt(c), disabled: cols.length <= 1 },
      { key: "autofit", label: "Column width: autofit", onClick: () => autofitColumn(c) },
      "divider",
      freezeLabel
        ? { key: "unfreeze", label: freezeLabel, onClick: () => onSetFreeze(freezeRows, 0) }
        : { key: "freezeFirst", label: "Freeze first column", onClick: () => onSetFreeze(freezeRows, 1) },
    ];
    setContextMenu({ point: { x: e.clientX, y: e.clientY }, items });
  };

  // Precompute, per rendered row (frozen + visible virtualized), which cells are genuinely
  // empty — text spill needs to know how many empty cells sit to the right of an overflowing
  // label, and alignment needs the resolved kind of every rendered cell. Cheap: bounded by the
  // rendered row window x column count, never the whole sheet.
  const rowCells = useMemo(() => {
    const map = new Map();
    const idxs = [...frozenRowIdxs, ...visibleRowIdxs];
    for (const r of idxs) {
      if (r >= sheet.rowCount) { map.set(r, null); continue; }
      const row = cols.map((col, c) => {
        const display = displayFor(sheet, evalResult, r, c);
        const kind = displayKindFor(sheet, evalResult, r, c);
        return { display, kind, empty: display === "" };
      });
      map.set(r, row);
    }
    return map;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sheet, evalResult, startIdx, endIdx, freezeRows, cols]);

  // One row's cells, shared by BOTH the frozen (sticky, normal-flow) and scrolling (absolute,
  // virtualized) render paths below — everything about a row is identical between the two
  // except how the ROW ITSELF is positioned (see the file header for why sticky/absolute can't
  // both apply to one element). `posStyle` supplies that one difference.
  const renderRowCells = (r, posStyle, rowZ) => {
    const inRowRange = r >= r1 && r <= r2;
    const row = rowCells.get(r);
    const h = rowHAt(r);
    return (
      <div key={r} style={{ ...posStyle, left: 0, display: "flex", height: h, width: totalW, zIndex: rowZ }}>
        <div
          data-testid={`model-row-header-${r}`}
          onContextMenu={(e) => openRowMenu(e, r)}
          style={{
            flex: `0 0 ${ROW_HEADER_W}px`, position: "sticky", left: 0, zIndex: 2,
            display: "flex", alignItems: "center", justifyContent: "flex-end", paddingRight: 6,
            borderRight: "1px solid var(--border-default)", borderBottom: "1px solid var(--border-subtle, var(--border-default))",
            fontSize: 11, color: "var(--text-tertiary)", background: "var(--surface-raised)",
          }}
        >
          {r + 1}
          <div
            onMouseDown={(e) => startRowResize(e, r)}
            onDoubleClick={() => autofitRow(r)}
            title="Drag to resize, double-click to autofit"
            style={{ position: "absolute", left: 0, right: 0, bottom: -RESIZE_HANDLE_PX / 2, height: RESIZE_HANDLE_PX, cursor: "row-resize" }}
          />
        </div>
        {cols.map((col, c) => {
          const isActive = r === activeR && c === activeC;
          const isSel = inRowRange && c >= c1 && c <= c2;
          const isEditing = edit && edit.r === r && edit.c === c;
          const cell = row ? row[c] : { display: "", kind: "blank", empty: true };
          const frozenCol = c < freezeCols;
          // Text spill: a left-aligned (text) cell whose content overflows its own column
          // extends visually across consecutive EMPTY cells to its right — Excel's rule for a
          // long row label beside blank cells. Numbers/dates never spill (they right-align and
          // clip instead, matching Excel). The spilled span is `pointer-events: none` so the
          // empty cells underneath stay their own real click targets — spilling is purely
          // visual, never a merge.
          let spillCols = 0;
          if (row && cell.kind === "text" && !cell.empty && !isEditing) {
            for (let cc = c + 1; cc < cols.length && row[cc] && row[cc].empty; cc++) spillCols++;
          }
          const w = colWidthAt(c);
          const spillWidth = spillCols > 0 ? (() => { let sum = w; for (let k = 1; k <= spillCols; k++) sum += colWidthAt(c + k); return sum; })() : null;
          return (
            <div
              key={col.id}
              data-testid={isActive ? "model-active-cell" : undefined}
              data-row={r}
              data-col={c}
              data-kind={cell.kind}
              onMouseDown={(e) => { e.preventDefault(); cellClick(r, c, e); }}
              onMouseEnter={() => cellMouseEnter(r, c)}
              onDoubleClick={() => startEdit(r, c, null)}
              onContextMenu={(e) => openCellMenu(e, r, c)}
              style={{
                position: frozenCol ? "sticky" : "relative",
                left: frozenCol ? colOffsets[c] : undefined,
                zIndex: frozenCol ? 1 : (spillCols > 0 ? 1 : "auto"),
                flex: `0 0 ${w}px`,
                boxSizing: "border-box",
                display: "flex", alignItems: "center",
                justifyContent: TEXT_ALIGN[cell.kind] === "right" ? "flex-end" : TEXT_ALIGN[cell.kind] === "center" ? "center" : "flex-start",
                padding: isEditing ? 0 : "0 8px",
                borderRight: "1px solid var(--border-default)",
                borderBottom: "1px solid var(--border-subtle, var(--border-default))",
                outline: isActive ? "2px solid var(--accent-model)" : "none",
                outlineOffset: -1,
                background: isEditing ? "var(--surface-page)" : isSel ? "var(--surface-selected, rgba(43,95,191,0.10))" : "var(--surface-page)",
                fontSize: 12.5, color: cell.kind === "error" ? "var(--danger)" : "var(--text-primary)",
                whiteSpace: "nowrap", overflow: spillCols > 0 ? "visible" : "hidden", textOverflow: "ellipsis",
                fontVariantNumeric: "tabular-nums",
                cursor: "cell",
                userSelect: isEditing ? "text" : "none",
              }}
            >
              {isEditing ? (
                <input
                  ref={inputRef}
                  autoFocus
                  value={editValue}
                  onChange={(e) => setEditValue(e.target.value)}
                  // Caret at the END on focus, never select-all: type-to-edit already
                  // seeds editValue with JUST the typed character (the "replace" half of
                  // the contract), so selecting it here would make the VERY NEXT keystroke
                  // replace that seed instead of continuing after it — e.g. typing
                  // "1000000" landed as "000000" (the seed "1" selected, then "0"
                  // overwrote it) before this was measured in a real browser.
                  onFocus={(e) => { const len = e.target.value.length; e.target.setSelectionRange(len, len); }}
                  style={{ width: "100%", height: "100%", boxSizing: "border-box", border: "none", padding: "0 7px", font: "inherit", fontVariantNumeric: "tabular-nums", background: "transparent", color: "inherit", textAlign: "inherit" }}
                />
              ) : spillCols > 0 ? (
                <span style={{ position: "absolute", left: 8, top: 0, height: "100%", display: "flex", alignItems: "center", width: spillWidth - 16, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", pointerEvents: "none" }}>{cell.display}</span>
              ) : cell.display}
              {c < cols.length && (
                <div
                  onMouseDown={(e) => startColResize(e, c)}
                  onDoubleClick={() => autofitColumn(c)}
                  title="Drag to resize, double-click to autofit"
                  style={{ position: "absolute", top: 0, bottom: 0, right: -RESIZE_HANDLE_PX / 2, width: RESIZE_HANDLE_PX, cursor: "col-resize" }}
                />
              )}
            </div>
          );
        })}
      </div>
    );
  };

  return (
    <div
      ref={outerRef}
      tabIndex={0}
      data-testid="model-sheet"
      onMouseUp={stopDrag}
      onMouseLeave={stopDrag}
      onKeyDown={onKeyDown}
      onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}
      style={{ flex: 1, minHeight: 0, overflow: "auto", position: "relative", background: "var(--surface-page)", outline: "none" }}
    >
      {/* width+minWidth, not Math.max(totalW, "100%") — that mixes a number with a CSS percent
          string, which Number("100%") coerces to NaN and React then rejects the whole style
          ("`NaN` is an invalid value for the `width` css style property"), measured live. */}
      <div style={{ position: "relative", height: HEADER_H + rowOffsets[totalRows], width: totalW, minWidth: "100%" }}>
        {/* Header row — sticky vertically, scrolls horizontally with the body via the shared
            container; individual FROZEN-column cells within it are ALSO sticky-left (below). */}
        <div style={{ position: "sticky", top: 0, zIndex: 3, display: "flex", height: HEADER_H, width: totalW, background: "var(--surface-raised)", borderBottom: "1px solid var(--border-default)" }}>
          <div style={{ flex: `0 0 ${ROW_HEADER_W}px`, position: "sticky", left: 0, zIndex: 2, borderRight: "1px solid var(--border-default)", background: "var(--surface-raised)" }} />
          {cols.map((col, c) => {
            const frozenCol = c < freezeCols;
            const w = colWidthAt(c);
            return (
              <div
                key={col.id}
                data-testid={`model-col-header-${c}`}
                onDoubleClick={() => setRenaming(c)}
                onClick={() => setSelRange({ r1: 0, r2: totalRows - 1, c1: c, c2: c })}
                onContextMenu={(e) => openColMenu(e, c)}
                style={{
                  position: frozenCol ? "sticky" : "relative",
                  left: frozenCol ? colOffsets[c] : undefined,
                  zIndex: frozenCol ? 1 : "auto",
                  flex: `0 0 ${w}px`,
                  display: "flex", alignItems: "center", gap: 4, padding: "0 8px", cursor: "pointer",
                  borderRight: "1px solid var(--border-default)",
                  background: c >= c1 && c <= c2 ? "var(--surface-selected, rgba(59,107,255,0.08))" : "var(--surface-raised)",
                  fontSize: 12.5, fontWeight: 600, color: "var(--text-primary)",
                }}
              >
                {renaming === c ? (
                  <input
                    autoFocus
                    defaultValue={col.name}
                    onBlur={(e) => renameCommit(c, e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); renameCommit(c, e.target.value); } if (e.key === "Escape") setRenaming(null); }}
                    style={{ width: "100%", font: "inherit", fontWeight: 600, border: "1px solid var(--accent)", borderRadius: 4, padding: "1px 4px" }}
                  />
                ) : (
                  <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{col.name}</span>
                )}
                <div
                  onMouseDown={(e) => startColResize(e, c)}
                  onDoubleClick={() => autofitColumn(c)}
                  title="Drag to resize, double-click to autofit"
                  style={{ position: "absolute", top: 0, bottom: 0, right: -RESIZE_HANDLE_PX / 2, width: RESIZE_HANDLE_PX, cursor: "col-resize" }}
                />
              </div>
            );
          })}
          <button
            type="button"
            data-testid="model-add-column"
            onClick={onAddColumn}
            title="Add column"
            style={{ flex: "0 0 34px", border: "none", borderRight: "1px solid var(--border-default)", background: "transparent", color: "var(--text-tertiary)", fontSize: 16, cursor: "pointer" }}
          >+</button>
        </div>

        {/* Frozen rows — ALWAYS rendered (never virtualized: there are only ever a handful),
            normal document flow, each sticky at its own resting top so it stays pinned right
            below the header as the body scrolls underneath it. */}
        {frozenRowIdxs.map((r) => renderRowCells(r, { position: "sticky", top: HEADER_H + rowOffsets[r] }, 2))}

        {/* Scrolling rows — the existing virtualized window, absolutely positioned at each
            row's real offset; a row past the real sheet.rowCount is blank PADDING: typing into
            it is what grows the sheet, mirroring GridView's emptyPad. */}
        {visibleRowIdxs.map((r) => renderRowCells(r, { position: "absolute", top: HEADER_H + rowOffsets[r] }, "auto"))}
      </div>

      {contextMenu && <ContextMenu point={contextMenu.point} items={contextMenu.items} onClose={closeMenu} />}
    </div>
  );
}
