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
 * NOT NEEDED HERE, and why: GridView's scroll-anchor-preservation effects (:9965-10025) exist
 * because ROW_H can change (a Format-panel slider) and the row COUNT can shrink (collapsing a
 * group) out from under the current scroll position mid-session. Neither happens to a sheet —
 * ROW_H is fixed and rowCount only ever grows (typing past the end extends it) — so scrolling
 * stays stable with no anchor math at all. If a future session adds variable row heights or
 * row deletion that can shrink the sheet while scrolled into what used to be its middle, THAT
 * is when this file needs GridView's anchor-preservation mechanism, not before.
 *
 * ALSO NOT DONE: horizontal virtualization. Every column renders regardless of scroll — fine
 * for an underwriting model's few dozen columns; a sheet with hundreds would need it too.
 *
 * ⛔ B891184-FOLLOWUP (live production findings, 2026-08-31): four things this file did not
 * do, all fixed here. (1) It seeded the in-cell editor from a column's `formula` field, which
 * no longer exists — formulas are per-cell now (sheetModel.js's header explains why). (2) It
 * never distinguished a number/date from text, so every value rendered flush left like a
 * label — Excel right-aligns numbers/dates for exactly the reason PANEL-BREVITY exists for
 * text: it's how you tell at a glance what a column holds. (3) A long text label hard-clipped
 * at its own column edge even with the neighbour cell completely empty — Excel spills text
 * across empty neighbours, which is the difference between a pro-forma's row labels being
 * readable and not. (4) Ctrl+C/V, Ctrl+D and the Ctrl+Home/End/Arrow "block jump" keys — muscle
 * memory for anyone who lives in a spreadsheet — did nothing at all.
 */
import { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";
import { colAt, rawAt, usedRangeEnd } from "../lib/sheetModel.js";
import { displayFor, displayKindFor } from "../lib/sheetEngine.js";
import { ctrlArrowTarget } from "../lib/sheetOps.js";

export const ROW_H = 26;
export const HEADER_H = 30;
const BUF = 6;
const DEFAULT_COL_W = 120;
const ROW_HEADER_W = 44;

/** Move a column index by `dir`, never past the sheet's bounds — Tab/Shift+Tab and the
 *  Right/Left arrows all share this so wrapping to the next/previous row stays consistent. */
function stepCol(colCount, c, dir) { return Math.max(0, Math.min(colCount - 1, c + dir)); }

const TEXT_ALIGN = { number: "right", date: "right", bool: "center", error: "left", text: "left", blank: "left" };

export default function SheetView({
  sheet, evalResult, totalRows,
  selRange, setSelRange,
  onCommit, onBlankRange, onRenameColumn, onAddColumn,
  onCopy, onPaste, onFillDown,
}) {
  const outerRef = useRef(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportH, setViewportH] = useState(400);
  const [edit, setEdit] = useState(null);      // { r, c } | null
  const [editValue, setEditValue] = useState("");
  const inputRef = useRef(null);
  const dragRef = useRef(null);                // { r, c } anchor while mouse-dragging a range
  const [renaming, setRenaming] = useState(null); // colIndex | null

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
  const colOffsets = useMemo(() => {
    const offs = [ROW_HEADER_W];
    for (const c of cols) offs.push(offs[offs.length - 1] + (c.width || DEFAULT_COL_W));
    return offs;
  }, [cols]);
  const totalW = colOffsets[colOffsets.length - 1];

  const startIdx = Math.max(0, Math.floor(scrollTop / ROW_H) - BUF);
  const endIdx = Math.min(totalRows, startIdx + Math.ceil(viewportH / ROW_H) + BUF * 2);
  const visibleRowIdxs = [];
  for (let r = startIdx; r < endIdx; r++) visibleRowIdxs.push(r);

  const r1 = selRange ? Math.min(selRange.r1, selRange.r2) : 0;
  const r2 = selRange ? Math.max(selRange.r1, selRange.r2) : 0;
  const c1 = selRange ? Math.min(selRange.c1, selRange.c2) : 0;
  const c2 = selRange ? Math.max(selRange.c1, selRange.c2) : 0;
  const activeR = selRange ? selRange.r1 : 0;
  const activeC = selRange ? selRange.c1 : 0;

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
      return; // leave every other Ctrl/Cmd chord (the app's own undo/redo) alone
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

  // Precompute, per VISIBLE row, which cells are genuinely empty — text spill (item 11) needs
  // to know how many empty cells sit to the right of an overflowing label, and alignment needs
  // the resolved kind of every rendered cell. Cheap: bounded by the virtualized row window x
  // column count, never the whole sheet.
  const rowCells = useMemo(() => {
    const map = new Map();
    for (const r of visibleRowIdxs) {
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
  }, [sheet, evalResult, startIdx, endIdx, cols]);

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
      <div style={{ position: "relative", height: HEADER_H + totalRows * ROW_H, width: totalW, minWidth: "100%" }}>
        {/* Header row — sticky vertically, scrolls horizontally with the body via the shared container. */}
        <div style={{ position: "sticky", top: 0, zIndex: 2, display: "flex", height: HEADER_H, width: totalW, background: "var(--surface-raised)", borderBottom: "1px solid var(--border-default)" }}>
          <div style={{ flex: `0 0 ${ROW_HEADER_W}px`, borderRight: "1px solid var(--border-default)" }} />
          {cols.map((col, c) => (
            <div
              key={col.id}
              data-testid={`model-col-header-${c}`}
              onDoubleClick={() => setRenaming(c)}
              onClick={() => setSelRange({ r1: 0, r2: totalRows - 1, c1: c, c2: c })}
              style={{
                flex: `0 0 ${col.width || DEFAULT_COL_W}px`,
                display: "flex", alignItems: "center", gap: 4, padding: "0 8px", cursor: "pointer",
                borderRight: "1px solid var(--border-default)",
                background: c >= c1 && c <= c2 ? "var(--surface-selected, rgba(59,107,255,0.08))" : "transparent",
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
            </div>
          ))}
          <button
            type="button"
            data-testid="model-add-column"
            onClick={onAddColumn}
            title="Add column"
            style={{ flex: "0 0 34px", border: "none", borderRight: "1px solid var(--border-default)", background: "transparent", color: "var(--text-tertiary)", fontSize: 16, cursor: "pointer" }}
          >+</button>
        </div>

        {/* Rows — absolutely positioned so only the visible slice ever renders (BUF = 6, same as
            GridView). A row past the real sheet.rowCount is blank PADDING: typing into it is what
            grows the sheet, mirroring GridView's emptyPad. */}
        {visibleRowIdxs.map((r) => {
          const inRowRange = r >= r1 && r <= r2;
          const row = rowCells.get(r);
          return (
            <div key={r} style={{ position: "absolute", top: HEADER_H + r * ROW_H, left: 0, display: "flex", height: ROW_H, width: totalW }}>
              <div style={{ flex: `0 0 ${ROW_HEADER_W}px`, display: "flex", alignItems: "center", justifyContent: "flex-end", paddingRight: 6, borderRight: "1px solid var(--border-default)", borderBottom: "1px solid var(--border-subtle, var(--border-default))", fontSize: 11, color: "var(--text-tertiary)", background: "var(--surface-raised)" }}>{r + 1}</div>
              {cols.map((col, c) => {
                const isActive = r === activeR && c === activeC;
                const isSel = inRowRange && c >= c1 && c <= c2;
                const isEditing = edit && edit.r === r && edit.c === c;
                const cell = row ? row[c] : { display: "", kind: "blank", empty: true };
                // Text spill (item 11): a left-aligned (text) cell whose content overflows its
                // own column extends visually across consecutive EMPTY cells to its right —
                // Excel's rule for a long row label beside blank cells. Numbers/dates never
                // spill (they right-align and clip instead, matching Excel). The spilled span
                // is `pointer-events: none` so the empty cells underneath stay their own real
                // click targets — spilling is purely visual, never a merge.
                let spillCols = 0;
                if (row && cell.kind === "text" && !cell.empty && !isEditing) {
                  for (let cc = c + 1; cc < cols.length && row[cc] && row[cc].empty; cc++) spillCols++;
                }
                const spillWidth = spillCols > 0 ? cols.slice(c, c + spillCols + 1).reduce((sum, cc2) => sum + (cc2.width || DEFAULT_COL_W), 0) : null;
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
                    style={{
                      position: "relative",
                      flex: `0 0 ${col.width || DEFAULT_COL_W}px`,
                      boxSizing: "border-box",
                      display: "flex", alignItems: "center",
                      justifyContent: TEXT_ALIGN[cell.kind] === "right" ? "flex-end" : TEXT_ALIGN[cell.kind] === "center" ? "center" : "flex-start",
                      padding: isEditing ? 0 : "0 8px",
                      borderRight: "1px solid var(--border-default)",
                      borderBottom: "1px solid var(--border-subtle, var(--border-default))",
                      outline: isActive ? "2px solid var(--accent-model)" : "none",
                      outlineOffset: -1,
                      background: isEditing ? "var(--surface-page)" : isSel ? "var(--surface-selected, rgba(43,95,191,0.10))" : "transparent",
                      fontSize: 12.5, color: cell.kind === "error" ? "var(--danger)" : "var(--text-primary)",
                      whiteSpace: "nowrap", overflow: spillCols > 0 ? "visible" : "hidden", textOverflow: "ellipsis",
                      fontVariantNumeric: "tabular-nums",
                      cursor: "cell",
                      userSelect: isEditing ? "text" : "none",
                      zIndex: spillCols > 0 ? 1 : "auto",
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
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
}
