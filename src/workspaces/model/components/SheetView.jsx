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
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { colAt, rawAt, usedRangeEnd, rowHeightAt, DEFAULT_ROW_H, styleAt, mergeAt, isFormulaText } from "../lib/sheetModel.js";
import { displayFor, displayKindFor, displayColorFor } from "../lib/sheetEngine.js";
import { ctrlArrowTarget } from "../lib/sheetOps.js";
import { buildRowOffsets, visibleRowRange, rowAtOffset } from "../lib/rowLayout.js";
import { MIN_ZOOM, MAX_ZOOM, DEFAULT_ZOOM, zoomFromWheelDelta, zoomStepButton } from "../lib/sheetZoom.js";
import { RADIUS } from "../../../shared/ui/radius.js";
import { SPACE, CONTROL_H } from "../../../shared/ui/designTokens.js";
import AnchoredMenu from "../../../shared/ui/AnchoredMenu.jsx";
import { menuPanelStyle } from "../../../shared/ui/controls.jsx";
import ContextMenu from "./ContextMenu.jsx";

// B1007281 — AutoFilter (Sort & Filter). One column header's own filter trigger + checkbox
// popover. `allowed` is the column's current filter (a Set of DISPLAY-value strings still
// shown) or `null` (no filter — every value shown); the unique-value list is built lazily (only
// while the popover is open) by scanning that column's own displayed text, capped at 2000 rows —
// generous for an underwriting model, cheap because it only runs on open, not on every render.
function FilterMenu({ colIndex, sheet, evalResult, allowed, onSetFilter }) {
  const [open, setOpen] = useState(false);
  const anchorRef = useRef(null);
  const values = useMemo(() => {
    if (!open) return [];
    const set = new Set();
    const cap = Math.min(sheet.rowCount, 2000);
    for (let r = 0; r < cap; r++) {
      const v = displayFor(sheet, evalResult, r, colIndex);
      if (v !== "") set.add(v);
    }
    return [...set].sort((a, b) => a.localeCompare(b));
  }, [open, sheet, evalResult, colIndex]);
  const isChecked = (v) => !allowed || allowed.has(v);
  return (
    <span style={{ position: "relative", display: "inline-flex" }}>
      <button
        type="button" ref={anchorRef} data-testid={`model-col-filter-${colIndex}`} title="Filter this column"
        onMouseDown={(e) => e.stopPropagation()}
        onClick={(e) => { e.stopPropagation(); setOpen((o) => !o); }}
        style={{ marginLeft: 2, border: "none", background: "transparent", cursor: "pointer", color: allowed ? "var(--accent-model)" : "var(--text-tertiary)", fontSize: 10, padding: "0 2px", flex: "none" }}
      >▾</button>
      <AnchoredMenu open={open} onClose={() => setOpen(false)} anchorRef={anchorRef} placement="below-left" width={180} panelStyle={menuPanelStyle}>
        <div style={{ padding: 6 }}>
          <button
            type="button"
            onClick={() => onSetFilter(colIndex, null)}
            style={{ display: "block", width: "100%", textAlign: "left", padding: "4px 6px", border: "none", background: "transparent", cursor: "pointer", font: "inherit", fontSize: 11.5, fontWeight: 700, color: "var(--accent-model)" }}
          >Select all</button>
          <div style={{ maxHeight: 220, overflowY: "auto", marginTop: 2 }}>
            {values.map((v) => (
              <label key={v} style={{ display: "flex", alignItems: "center", gap: 6, padding: "3px 6px", fontSize: 12, cursor: "pointer" }}>
                <input
                  type="checkbox" checked={isChecked(v)}
                  onChange={() => {
                    const next = new Set(allowed || values);
                    if (next.has(v)) next.delete(v); else next.add(v);
                    onSetFilter(colIndex, next.size >= values.length ? null : next);
                  }}
                />
                <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{v}</span>
              </label>
            ))}
            {values.length === 0 && <div style={{ padding: "4px 6px", fontSize: 11.5, color: "var(--text-tertiary)" }}>No values</div>}
          </div>
        </div>
      </AnchoredMenu>
    </span>
  );
}

export const ROW_H = DEFAULT_ROW_H;
// Stage 2 visual pass — the header BAND reads as its own chrome tier partly through being a
// touch taller than a data row (CONTROL_H.md, 26, vs. the data rows' CONTROL_H.sm-matched 22) —
// Excel's own column-header row is taller than an ordinary data row for exactly this reason.
export const HEADER_H = CONTROL_H.md;
const BUF = 6;
const DEFAULT_COL_W = 120;
const ROW_HEADER_W = 44;
const RESIZE_HANDLE_PX = 6;
const FILL_HANDLE_PX = 7;

/** Move a column index by `dir`, never past the sheet's bounds — Tab/Shift+Tab and the
 *  Right/Left arrows all share this so wrapping to the next/previous row stays consistent. */
function stepCol(colCount, c, dir) { return Math.max(0, Math.min(colCount - 1, c + dir)); }

const TEXT_ALIGN = { number: "right", date: "right", bool: "center", error: "left", text: "left", blank: "left" };

function zoomBtnStyle(enabled) {
  return {
    flex: "none", height: 22, minWidth: 22, padding: "0 4px", border: "none",
    borderRadius: RADIUS.pill, background: "transparent", font: "inherit", fontSize: 11.5,
    fontWeight: 700, color: enabled ? "var(--text-secondary)" : "var(--text-tertiary)",
    cursor: enabled ? "pointer" : "default",
  };
}

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
  zoom = DEFAULT_ZOOM, onZoomChange,
  // B1007282 — AutoFilter (Sort & Filter). A Set of row indices to render at ZERO height — see
  // rowLayout.js's buildRowOffsets for why this is the whole filter mechanism, no second
  // "which rows are visible" system. `null`/omitted (the vast majority of renders — filtering is
  // opt-in) behaves exactly as before.
  hiddenRows = null,
  onSelectionSettled,
  // B1007281 — AutoFilter. `filterOn` shows a filter trigger on every column header;
  // `columnFilters` is a Map<colIndex, Set<allowed display values>> (a column absent from the
  // map is unfiltered); `onSetColumnFilter(colIndex, allowedOrNull)` commits one column's choice.
  filterOn = false, columnFilters = null, onSetColumnFilter,
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
  // B1007280 — a scroll position to restore, in LOGICAL (unzoomed) coordinates plus the
  // viewport-relative cursor point that anchored it, set by the wheel handler and consumed by
  // the layout effect below the moment `zoom` (a prop, changed by the parent) actually lands.
  const pendingZoomAnchorRef = useRef(null);
  // Stage 2 visual pass — which column/row HEADER the pointer is over, for a hover affordance on
  // chrome (owner: "the row-number gutter and column-header band... should read as chrome — a
  // subtly different surface, muted text... and a hover state"). Bounded to one row + one column
  // of header cells (never O(rows×cols) — data cells don't get this treatment), so plain React
  // state is cheap here where it would not be for a per-DATA-cell hover.
  const [hoverCol, setHoverCol] = useState(null);
  const [hoverRow, setHoverRow] = useState(null);
  // The fill handle (the small grabbable square at the selection's bottom-right corner) — drag
  // downward to extend the TOP row of the current selection down through the rows the drag
  // covers, reusing the exact same fillDown the Ctrl+D shortcut already calls. `fillTo` is the
  // live target row while dragging, for the handle's own visual feedback; the drag never touches
  // the sheet model until mouseup, same discipline as the column/row resize drags above.
  const fillDragRef = useRef(null); // { r1, c1, c2 } — the SOURCE range's top row + column span
  const [fillTo, setFillTo] = useState(null); // target row index while dragging, or null
  const fillToRef = useRef(null); // mirrors fillTo — read at drag-end, where React state would be stale

  useLayoutEffect(() => {
    const el = outerRef.current;
    if (!el) return undefined;
    const measure = () => setViewportH(el.clientHeight);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Ctrl/Cmd+wheel zooms the SHEET, never the whole browser page (B1007280, owner verbatim:
  // "ctrl zoom should be captured by the spreadsheet not the webpage"). React's own `onWheel`
  // prop is attached PASSIVE by default (React 17+, for scroll performance), so
  // `e.preventDefault()` inside a React wheel handler cannot actually stop the browser's
  // native page-zoom — this has to be a real, non-passive DOM listener attached directly to
  // the scrolling element. Scoped to the grid's own container only, so the toolbar/formula bar
  // above it are untouched — Ctrl+wheel there still does whatever the browser normally does.
  const zoomRef = useRef(zoom);
  useEffect(() => { zoomRef.current = zoom; }, [zoom]);
  useEffect(() => {
    const el = outerRef.current;
    if (!el || !onZoomChange) return undefined;
    const onWheel = (e) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      e.preventDefault();
      const oldZoom = zoomRef.current;
      const newZoom = zoomFromWheelDelta(oldZoom, e.deltaY);
      if (newZoom === oldZoom) return;
      // Anchor on the cursor — the LOGICAL point under it stays under it, the same feel as a
      // map or image viewer's Ctrl/Cmd+wheel zoom, never a jump back to the top-left corner.
      const rect = el.getBoundingClientRect();
      const cursorX = e.clientX - rect.left, cursorY = e.clientY - rect.top;
      pendingZoomAnchorRef.current = {
        logicalX: (el.scrollLeft + cursorX) / oldZoom,
        logicalY: (el.scrollTop + cursorY) / oldZoom,
        cursorX, cursorY,
      };
      onZoomChange(newZoom);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [onZoomChange]);

  // Correct the scroll position the moment the new `zoom` prop has actually landed and this
  // component has re-rendered with it — synchronously, before paint (a passive `useEffect`
  // here would run one frame too late, the same reasoning as the active-cell scroll effect
  // below). This has to run on EVERY zoom change, not only a wheel-triggered one: zooming
  // changes the content's total rendered size, so a raw `scrollTop` pixel value left untouched
  // no longer points at the same LOGICAL area — at a big enough zoom-OUT it can point past the
  // new (smaller) content entirely, which is exactly what happened before this existed: zoom
  // in near the bottom of the sheet, then hit the 100% reset button, and row 0 vanished from
  // the DOM because the untouched scrollTop was now far past the shrunk content's height.
  // Two cases: the wheel handler above sets a precise CURSOR anchor (the point under the
  // cursor stays under it); every other trigger (the +/−/reset buttons) has no cursor to
  // anchor on, so it rescales the CURRENT scroll position by the zoom ratio instead — the
  // top-left of what's presently on screen stays anchored, which is the closest thing to "stay
  // where I was looking" a button click can mean.
  const prevZoomRef = useRef(zoom);
  useLayoutEffect(() => {
    const el = outerRef.current;
    const prevZoom = prevZoomRef.current;
    prevZoomRef.current = zoom;
    const anchor = pendingZoomAnchorRef.current;
    pendingZoomAnchorRef.current = null;
    if (!el || zoom === prevZoom) return;
    if (anchor) {
      el.scrollLeft = anchor.logicalX * zoom - anchor.cursorX;
      el.scrollTop = anchor.logicalY * zoom - anchor.cursorY;
    } else if (prevZoom > 0) {
      const ratio = zoom / prevZoom;
      el.scrollLeft = el.scrollLeft * ratio;
      el.scrollTop = el.scrollTop * ratio;
    }
  }, [zoom]);

  const cols = sheet.columns;
  const freezeRows = Math.min(sheet.freezeRows || 0, sheet.rowCount);
  const freezeCols = Math.min(sheet.freezeCols || 0, cols.length);

  // B1007280 — sheet zoom (Ctrl/Cmd+wheel, or the corner control). `colWidthAt`/`rowHAt` stay
  // LOGICAL (the stored/dragged value, independent of zoom — exactly what a resize commit and
  // autofit's own text measurement need); `renderColW`/`renderRowH` are the RENDERED pixel size
  // — logical × zoom — and are the only things every offset/layout/sticky calculation below
  // touches, so virtualization and freeze-pane positioning stay correct at any zoom level by
  // construction (same offsets, just built from bigger or smaller numbers) rather than needing
  // a separate scale-corrected code path. HEADER_H/ROW_HEADER_W scale too — Excel's own zoom
  // scales its headers along with the grid, not just the cells. RESIZE_HANDLE_PX deliberately
  // does NOT scale — a resize grab strip needs to stay a comfortably clickable target at 50%
  // zoom, not shrink along with everything else.
  const headerH = HEADER_H * zoom;
  const rowHeaderW = ROW_HEADER_W * zoom;

  const colWidthAt = useCallback((c) => (colResizePreview && colResizePreview.colIndex === c ? colResizePreview.width : (cols[c]?.width || DEFAULT_COL_W)), [cols, colResizePreview]);
  // A filtered-out row is height 0 regardless of any stored/dragged height — checked FIRST, so
  // a resize preview mid-drag on a row that's simultaneously hidden (can't happen via the UI
  // today, but the precedence should still be unambiguous) never un-hides it.
  const rowHAt = useCallback((r) => (hiddenRows && hiddenRows.has(r) ? 0 : (rowResizePreview && rowResizePreview.rowIndex === r ? rowResizePreview.height : rowHeightAt(sheet, r))), [sheet, rowResizePreview, hiddenRows]);
  const renderColW = useCallback((c) => colWidthAt(c) * zoom, [colWidthAt, zoom]);
  const renderRowH = useCallback((r) => rowHAt(r) * zoom, [rowHAt, zoom]);

  const colOffsets = useMemo(() => {
    const offs = [rowHeaderW];
    for (let c = 0; c < cols.length; c++) offs.push(offs[offs.length - 1] + renderColW(c));
    return offs;
  }, [cols, renderColW, rowHeaderW]);
  const totalW = colOffsets[colOffsets.length - 1];

  // Row offsets, honouring any live resize preview — same cumulative-offset shape colOffsets
  // already used for columns, now needed for rows too since a row's height can vary. Built from
  // the LOCAL renderRowH (already hiddenRows-aware, see above) so a filtered row's zero height
  // is reflected here too — offsets and rendering must never disagree about a row's height.
  const rowOffsets = useMemo(() => {
    const offs = new Array(totalRows + 1);
    let y = 0;
    for (let r = 0; r < totalRows; r++) { offs[r] = y; y += renderRowH(r); }
    offs[totalRows] = y;
    return offs;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sheet.rowHeights, totalRows, rowResizePreview, zoom, hiddenRows]);

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
      const cellTop = headerH + rowOffsets[activeR], cellBottom = headerH + rowOffsets[activeR + 1];
      const frozenBandBottom = el.scrollTop + headerH + rowOffsets[freezeRows];
      if (cellTop < frozenBandBottom) el.scrollTop = cellTop - headerH - rowOffsets[freezeRows];
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
  // B1007281 — Format Painter. `stopDrag` is the one place every click-OR-drag selection on the
  // sheet finishes (a plain click and a drag-to-select both end here), so it's the natural hook
  // for "a new selection just settled" — ModelApp uses it to apply an armed painter's captured
  // look to whatever the user just clicked or dragged across, a no-op otherwise.
  const stopDrag = () => { dragRef.current = null; onSelectionSettled?.(); };

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
  // Drag deltas arrive in real SCREEN pixels (mouse movement); the stored width/height is
  // LOGICAL (zoom-independent), so a drag at 200% zoom must add only HALF the screen-pixel
  // delta to the logical value — otherwise resizing at a non-100% zoom would silently double
  // or halve what a column measures at 100% the next time it's opened.
  const startColResize = useCallback((e, colIndex) => {
    e.preventDefault(); e.stopPropagation();
    const startWidth = colWidthAt(colIndex);
    dragStateRef.current = { kind: "col", colIndex, startX: e.clientX, startWidth };
    const onMove = (ev) => {
      const st = dragStateRef.current;
      if (!st) return;
      setColResizePreview({ colIndex: st.colIndex, width: st.startWidth + (ev.clientX - st.startX) / zoom });
    };
    const onUp = (ev) => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      const st = dragStateRef.current;
      dragStateRef.current = null;
      setColResizePreview(null);
      if (st) onSetColumnWidth(st.colIndex, st.startWidth + (ev.clientX - st.startX) / zoom);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }, [colWidthAt, onSetColumnWidth, zoom]);

  const startRowResize = useCallback((e, rowIndex) => {
    e.preventDefault(); e.stopPropagation();
    const startHeight = rowHAt(rowIndex);
    dragStateRef.current = { kind: "row", rowIndex, startY: e.clientY, startHeight };
    const onMove = (ev) => {
      const st = dragStateRef.current;
      if (!st) return;
      setRowResizePreview({ rowIndex: st.rowIndex, height: st.startHeight + (ev.clientY - st.startY) / zoom });
    };
    const onUp = (ev) => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      const st = dragStateRef.current;
      dragStateRef.current = null;
      setRowResizePreview(null);
      if (st) onSetRowHeight(st.rowIndex, st.startHeight + (ev.clientY - st.startY) / zoom);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }, [rowHAt, onSetRowHeight, zoom]);

  // The fill handle (Stage 2 visual pass — owner: "the little square at the selection's
  // bottom-right... must be visible and grabbable"). Drag DOWN from the selection's current
  // bottom-right corner; on release, fillDown copies the selection's TOP row down through
  // wherever the drag ended — the exact same mutator Ctrl+D already calls, so there is only ever
  // one "fill down" behavior in this app, reached two ways. No live dashed-outline preview (a
  // real Excel affordance) — the target row highlights instead, a smaller but still genuinely
  // informative "this is where it'll land" cue while dragging; a live full preview is real,
  // scoped follow-up, not required for the handle to be functional.
  const startFillDrag = useCallback((e) => {
    e.preventDefault(); e.stopPropagation();
    const source = { r1, c1, c2 };
    fillDragRef.current = source;
    fillToRef.current = r2;
    setFillTo(r2);
    const el = outerRef.current;
    const onMove = (ev) => {
      if (!fillDragRef.current || !el) return;
      const rect = el.getBoundingClientRect();
      const y = ev.clientY - rect.top + el.scrollTop - headerH;
      const row = Math.max(source.r1, Math.min(totalRows - 1, rowAtOffset(rowOffsets, y)));
      fillToRef.current = row;
      setFillTo(row);
    };
    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      const src = fillDragRef.current;
      const target = fillToRef.current;
      fillDragRef.current = null;
      fillToRef.current = null;
      setFillTo(null);
      if (src && target != null && target > r2) onFillDown(src.r1, target, src.c1, src.c2);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }, [r1, r2, c1, c2, rowOffsets, headerH, totalRows, onFillDown]);

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
        const color = displayColorFor(sheet, evalResult, r, c);
        const style = styleAt(sheet, r, c);
        // Stage 2 visual pass — a HOOK for Stage 3's formula/input colour convention (blue =
        // input, black = plain, green = cross-sheet reference): a `data-formula` marker on every
        // cell now, so that work drops in as a style-only change with no new plumbing. Not yet
        // consumed for colour here — cellStyle.color (an explicit user override) still wins.
        const isFormula = isFormulaText(sheet.cells[`${col.id}:${r}`]);
        return { display, kind, empty: display === "", color, style, isFormula };
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
    const h = renderRowH(r);
    // B1007282 — a filtered-out row renders NOTHING (rowOffsets already gave it zero pixels of
    // space, so there is nowhere for a DOM node to go, and building one would be pure waste).
    if (h === 0) return null;
    // Stage 2 visual pass — the freeze-pane BOUNDARY needs to be visible on its own (owner:
    // "you can tell the frozen region from the scrolling one"), not just inferred from content
    // no longer moving. A shadow reads as "this edge sits ABOVE the layer below it," which a
    // plain border line doesn't convey — exactly the depth cue Excel's own freeze line uses.
    const isLastFrozenRow = freezeRows > 0 && r === freezeRows - 1;
    // The fill handle's own live feedback (Stage 2 visual pass) — a dashed outline around the
    // row the drag currently targets, in place of a full live-preview of the values themselves.
    const isFillTarget = fillTo != null && r === fillTo;
    return (
      <div key={r} style={{ ...posStyle, left: 0, display: "flex", height: h, width: totalW, zIndex: rowZ, boxShadow: isLastFrozenRow ? "0 2px 4px -1px rgba(0,0,0,0.18)" : undefined, outline: isFillTarget ? "2px dashed var(--accent-model)" : undefined, outlineOffset: -1 }}> {/* design-exempt: no shadow-color token yet repo-wide (matches the zoom control's own shadow below) */}
        <div
          data-testid={`model-row-header-${r}`}
          onContextMenu={(e) => openRowMenu(e, r)}
          onMouseEnter={() => setHoverRow(r)}
          onMouseLeave={() => setHoverRow((h) => (h === r ? null : h))}
          style={{
            flex: `0 0 ${rowHeaderW}px`, position: "sticky", left: 0, zIndex: 2,
            display: "flex", alignItems: "center", justifyContent: "flex-end", paddingRight: SPACE.sm,
            // Grid-line hierarchy: a STRONGER rule separates the gutter (chrome) from the data
            // grid than the hairlines BETWEEN data cells use.
            borderRight: "2px solid var(--border-strong)", borderBottom: "1px solid var(--border-default)",
            fontSize: 11 * zoom, fontWeight: inRowRange ? 700 : 400,
            // "You are here": the row(s) inside the current selection tint, the same accent wash
            // the data cells themselves carry, so the eye can find the active row without hunting.
            color: inRowRange ? "var(--accent-model-text)" : "var(--text-tertiary)",
            background: inRowRange ? "var(--accent-model-soft)" : (hoverRow === r ? "var(--hover-chrome)" : "var(--surface-page)"),
            cursor: "default",
          }}
        >
          {r + 1}
          <div
            className="model-resize-handle"
            onMouseDown={(e) => startRowResize(e, r)}
            onDoubleClick={() => autofitRow(r)}
            title="Drag to resize, double-click to autofit"
            style={{ position: "absolute", left: 0, right: 0, bottom: -RESIZE_HANDLE_PX / 2, height: RESIZE_HANDLE_PX, cursor: "row-resize" }}
          />
        </div>
        {cols.map((col, c) => {
          // STAGE 2 — horizontal merge (B1007281; see sheetModel.js's file header for the scope
          // decision). A cell inside a merge's span that ISN'T the anchor renders NOTHING: the
          // anchor's own box below is widened to cover the whole span, so it visually occupies
          // exactly the space these cells would have — no separate "merged placeholder" element,
          // and no special click-resolution needed either (there's simply nothing else there to
          // click; a mousedown anywhere in the span lands on the anchor's own div).
          const merge = mergeAt(sheet, r, c);
          if (merge && merge.c1 !== c) return null;
          const isActive = r === activeR && c === activeC;
          const isSel = inRowRange && c >= c1 && c <= c2;
          const isEditing = edit && edit.r === r && edit.c === c;
          const cell = row ? row[c] : { display: "", kind: "blank", empty: true, style: {} };
          const cellStyle = cell.style || {};
          const frozenCol = c < freezeCols;
          // Text spill: a left-aligned (text) cell whose content overflows its own column
          // extends visually across consecutive EMPTY cells to its right — Excel's rule for a
          // long row label beside blank cells. Numbers/dates never spill (they right-align and
          // clip instead, matching Excel). The spilled span is `pointer-events: none` so the
          // empty cells underneath stay their own real click targets — spilling is purely
          // visual, never a merge. A merged anchor never spills — it already owns real width.
          let spillCols = 0;
          if (!merge && row && cell.kind === "text" && !cell.empty && !isEditing) {
            for (let cc = c + 1; cc < cols.length && row[cc] && row[cc].empty; cc++) spillCols++;
          }
          const w = merge ? (() => { let sum = 0; for (let k = merge.c1; k <= merge.c2; k++) sum += renderColW(k); return sum; })() : renderColW(c);
          const spillWidth = spillCols > 0 ? (() => { let sum = w; for (let k = 1; k <= spillCols; k++) sum += renderColW(c + k); return sum; })() : null;
          // Explicit style overrides the kind-based default alignment; an ABSENT valign still
          // means vertically CENTERED — this app's own existing default for every cell, not
          // Excel's "bottom" (see Ribbon.jsx's AlignmentGroup for why that distinction matters).
          const hAlign = cellStyle.align || TEXT_ALIGN[cell.kind];
          const vAlign = cellStyle.valign === "top" ? "flex-start" : cellStyle.valign === "bottom" ? "flex-end" : "center";
          const border = cellStyle.border || {};
          const edgeCSS = (token) => (token === "double" ? `${3 * zoom}px double var(--text-primary)` : token === "thin" ? `${1.5 * zoom}px solid var(--text-primary)` : "1px solid var(--border-default)");
          // Explicit colour wins outright; an erroring cell always reads as danger regardless of
          // any number-format colour; otherwise the number format's own colour tag (negative
          // red) applies; the plain default last.
          const textColor = cellStyle.color || (cell.kind === "error" ? "var(--danger)" : (cell.color || "var(--text-primary)"));
          return (
            <div
              key={col.id}
              data-testid={isActive ? "model-active-cell" : undefined}
              data-row={r}
              data-col={c}
              data-kind={cell.kind}
              data-selected={isSel ? "true" : undefined}
              data-merged={merge ? "true" : undefined}
              data-formula={cell.isFormula ? "true" : undefined}
              onMouseDown={(e) => { e.preventDefault(); cellClick(r, c, e); }}
              onMouseEnter={() => cellMouseEnter(r, c)}
              onDoubleClick={() => startEdit(r, c, null)}
              onContextMenu={(e) => openCellMenu(e, r, c)}
              style={{
                position: frozenCol ? "sticky" : "relative",
                left: frozenCol ? colOffsets[c] : undefined,
                zIndex: frozenCol ? 1 : (spillCols > 0 || merge ? 1 : "auto"),
                // Freeze-pane BOUNDARY (Stage 2 visual pass) — see the row-boundary shadow above
                // for why a shadow, not a border line, is the right depth cue; this is the same
                // treatment on the last frozen COLUMN's own right edge.
                boxShadow: (freezeCols > 0 && c === freezeCols - 1) ? "2px 0 4px -1px rgba(0,0,0,0.18)" : undefined, // design-exempt: no shadow-color token yet repo-wide
                flex: `0 0 ${w}px`,
                boxSizing: "border-box",
                display: "flex", alignItems: vAlign,
                justifyContent: hAlign === "right" ? "flex-end" : hAlign === "center" ? "center" : "flex-start",
                padding: isEditing ? 0 : `0 ${(SPACE.sm + (cellStyle.indent || 0) * 14) * zoom}px`,
                borderTop: border.top ? edgeCSS(border.top) : undefined,
                borderLeft: border.left ? edgeCSS(border.left) : undefined,
                borderRight: border.right ? edgeCSS(border.right) : "1px solid var(--border-default)",
                borderBottom: border.bottom ? edgeCSS(border.bottom) : "1px solid var(--border-default)",
                outline: isActive ? "2px solid var(--accent-model)" : "none",
                outlineOffset: -1,
                // Stage 2 visual pass — a crisp 2px accent border on the ACTIVE cell (above) plus
                // a soft translucent accent wash across the REST of a multi-cell selection, the
                // same two-layer convention Excel/Sheets use. `--accent-model-soft` (index.css)
                // replaces the old rgba() fallback that was never actually a token.
                background: isEditing ? "var(--surface-raised)" : isSel ? "var(--accent-model-soft)" : (cellStyle.fill || "var(--surface-raised)"),
                fontSize: (cellStyle.fontSize || 12.5) * zoom, color: textColor,
                fontFamily: cellStyle.fontFamily || undefined,
                fontWeight: cellStyle.bold ? 700 : undefined,
                fontStyle: cellStyle.italic ? "italic" : undefined,
                textDecoration: [cellStyle.underline && "underline", cellStyle.strike && "line-through"].filter(Boolean).join(" ") || undefined,
                whiteSpace: cellStyle.wrap ? "normal" : "nowrap",
                wordBreak: cellStyle.wrap ? "break-word" : undefined,
                overflow: spillCols > 0 ? "visible" : "hidden", textOverflow: "ellipsis",
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
                <span style={{ position: "absolute", left: 8 * zoom, top: 0, height: "100%", display: "flex", alignItems: "center", width: spillWidth - 16 * zoom, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", pointerEvents: "none" }}>{cell.display}</span>
              ) : cell.display}
              {c < cols.length && (
                <div
                  className="model-resize-handle"
                  onMouseDown={(e) => startColResize(e, c)}
                  onDoubleClick={() => autofitColumn(c)}
                  title="Drag to resize, double-click to autofit"
                  style={{ position: "absolute", top: 0, bottom: 0, right: -RESIZE_HANDLE_PX / 2, width: RESIZE_HANDLE_PX, cursor: "col-resize" }}
                />
              )}
              {/* The fill handle — Stage 2 visual pass. Lives at the SELECTION's bottom-right
                  corner (r2,c2), not every cell's, and only when nothing is being edited (a live
                  edit has its own input box occupying the cell). */}
              {r === r2 && c === c2 && !edit && (
                <div
                  data-testid="model-fill-handle"
                  onMouseDown={startFillDrag}
                  title="Drag to fill down"
                  style={{
                    position: "absolute", right: -FILL_HANDLE_PX / 2 - 1, bottom: -FILL_HANDLE_PX / 2 - 1,
                    width: FILL_HANDLE_PX, height: FILL_HANDLE_PX,
                    background: "var(--accent-model)", border: "1px solid var(--surface-raised)",
                    cursor: "crosshair", zIndex: 3,
                  }}
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
      // Stage 2 visual pass (owner: "the whole thing floats edge to edge with no framing... it
      // should read as a document inside the app"). A contained card: the panel radius + a
      // border + a margin against the app's own page backdrop (ModelApp's root, `--surface-page`)
      // — the sheet itself (and its chrome bands) sit on `--surface-raised`, one tier up.
      style={{
        flex: 1, minHeight: 0, overflow: "auto", position: "relative", outline: "none",
        margin: SPACE.md, background: "var(--surface-raised)",
        border: "1px solid var(--border-default)", borderRadius: RADIUS.lg,
      }}
    >
      {/* Stage 2 visual pass — resize-handle hover affordance. A plain inline `style` prop can't
          express `:hover`; this is the one static, render-once stylesheet for it (never a
          per-handle React state, which would cost nothing per hover but is still the wrong tool
          for a purely decorative cue on what can be hundreds of resize strips). Token-driven
          (`var(--accent-model)`/`var(--hover-chrome)`), so it stays theme-correct without being
          scanned as a raw literal (there is no color HERE — the class only selects, the token
          reference lives in the CSS value, exactly like index.css's own `.gbtn:hover` family). */}
      <style>{`
        .model-resize-handle:hover { background: var(--hover-chrome); }
      `}</style>
      {/* width+minWidth, not Math.max(totalW, "100%") — that mixes a number with a CSS percent
          string, which Number("100%") coerces to NaN and React then rejects the whole style
          ("`NaN` is an invalid value for the `width` css style property"), measured live. */}
      <div style={{ position: "relative", height: headerH + rowOffsets[totalRows], width: totalW, minWidth: "100%" }}>
        {/* Header row — sticky vertically, scrolls horizontally with the body via the shared
            container; individual FROZEN-column cells within it are ALSO sticky-left (below).
            Grid-line hierarchy (Stage 2 visual pass): a STRONGER rule under the whole band. */}
        <div style={{ position: "sticky", top: 0, zIndex: 3, display: "flex", height: headerH, width: totalW, background: "var(--surface-page)", borderBottom: "2px solid var(--border-strong)" }}>
          <div style={{ flex: `0 0 ${rowHeaderW}px`, position: "sticky", left: 0, zIndex: 2, borderRight: "2px solid var(--border-strong)", background: "var(--surface-page)" }} />
          {cols.map((col, c) => {
            const frozenCol = c < freezeCols;
            const w = renderColW(c);
            const inColRange = c >= c1 && c <= c2;
            return (
              <div
                key={col.id}
                data-testid={`model-col-header-${c}`}
                onDoubleClick={() => setRenaming(c)}
                onClick={() => setSelRange({ r1: 0, r2: totalRows - 1, c1: c, c2: c })}
                onContextMenu={(e) => openColMenu(e, c)}
                onMouseEnter={() => setHoverCol(c)}
                onMouseLeave={() => setHoverCol((h) => (h === c ? null : h))}
                style={{
                  position: frozenCol ? "sticky" : "relative",
                  left: frozenCol ? colOffsets[c] : undefined,
                  zIndex: frozenCol ? 1 : "auto",
                  flex: `0 0 ${w}px`,
                  display: "flex", alignItems: "center", gap: 4, padding: `0 ${8 * zoom}px`, cursor: "pointer",
                  borderRight: "1px solid var(--border-default)",
                  // "You are here" tint (same accent wash as the data cells + row gutter) beats
                  // a chrome hover, which beats the plain muted chrome resting state.
                  background: inColRange ? "var(--accent-model-soft)" : (hoverCol === c ? "var(--hover-chrome)" : "var(--surface-page)"),
                  fontSize: 12.5 * zoom, fontWeight: 600,
                  color: inColRange ? "var(--accent-model-text)" : "var(--text-secondary)",
                }}
              >
                {renaming === c ? (
                  <input
                    autoFocus
                    defaultValue={col.name}
                    onBlur={(e) => renameCommit(c, e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); renameCommit(c, e.target.value); } if (e.key === "Escape") setRenaming(null); }}
                    style={{ width: "100%", font: "inherit", fontWeight: 600, border: "1px solid var(--accent)", borderRadius: RADIUS.sm, padding: "1px 4px" }}
                  />
                ) : (
                  <>
                    <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{col.name}</span>
                    {filterOn && (
                      <FilterMenu
                        colIndex={c} sheet={sheet} evalResult={evalResult}
                        allowed={columnFilters ? columnFilters.get(c) : null}
                        onSetFilter={onSetColumnFilter}
                      />
                    )}
                  </>
                )}
                <div
                  className="model-resize-handle"
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
        {frozenRowIdxs.map((r) => renderRowCells(r, { position: "sticky", top: headerH + rowOffsets[r] }, 2))}

        {/* Scrolling rows — the existing virtualized window, absolutely positioned at each
            row's real offset; a row past the real sheet.rowCount is blank PADDING: typing into
            it is what grows the sheet, mirroring GridView's emptyPad. */}
        {visibleRowIdxs.map((r) => renderRowCells(r, { position: "absolute", top: headerH + rowOffsets[r] }, "auto"))}
      </div>

      {contextMenu && <ContextMenu point={contextMenu.point} items={contextMenu.items} onClose={closeMenu} />}

      {/* B1007280 — the zoom control. `position: fixed` (not absolute/sticky) so it floats over
          the corner regardless of the sheet's own scroll — a fixed-position element ignores an
          ancestor's scroll offset entirely, which is exactly "always visible" without any of
          freeze panes' sticky-offset bookkeeping. Excel's own zoom slider lives in the same
          corner for the same reason: a view control, reachable without hunting through a menu,
          that never competes with the grid it controls for space. */}
      {onZoomChange && (
        <div
          data-testid="model-zoom-control"
          style={{
            position: "fixed", bottom: 12, right: 16, zIndex: 20,
            display: "flex", alignItems: "center", gap: 2, padding: 3,
            borderRadius: RADIUS.pill, border: "1px solid var(--border-default)",
            background: "var(--surface-raised)",
            boxShadow: "0 1px 4px rgba(0,0,0,0.16)", // design-exempt: no shadow-color token yet repo-wide (AnchoredMenu's own popPanel carries the identical gap)
          }}
        >
          <button
            type="button" data-testid="model-zoom-out" title="Zoom out"
            disabled={zoom <= MIN_ZOOM}
            onClick={() => onZoomChange(zoomStepButton(zoom, -1))}
            style={zoomBtnStyle(zoom > MIN_ZOOM)}
          >−</button>
          <button
            type="button" data-testid="model-zoom-level" title="Reset to 100%"
            onClick={() => onZoomChange(DEFAULT_ZOOM)}
            style={{ ...zoomBtnStyle(true), width: 46, fontVariantNumeric: "tabular-nums" }}
          >{Math.round(zoom * 100)}%</button>
          <button
            type="button" data-testid="model-zoom-in" title="Zoom in"
            disabled={zoom >= MAX_ZOOM}
            onClick={() => onZoomChange(zoomStepButton(zoom, 1))}
            style={zoomBtnStyle(zoom < MAX_ZOOM)}
          >+</button>
        </div>
      )}
    </div>
  );
}
