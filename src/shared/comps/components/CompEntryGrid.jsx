/* CompEntryGrid — the paste-box-over-a-SHEET comp entry surface (B849232/NEW-1). Michael enters
 * comps in batches, copied out of broker emails; this is the review surface itself — parsed
 * values land straight in the sheet, no separate confirm step.
 *
 * ⛔ ROUND 6 REWRITE (B986096-HARDENING-6, owner rule 2026-09-01) — "should read more like an
 * excel, thats hard on my eyes... think about what other professional softwares do too." The
 * per-type CARD layout (round 5) was itself the problem: boxes-in-boxes, every value in its own
 * rounded bordered box, is the visual noise a real comp sheet (CompStak, Argus) doesn't have.
 * This is a real spreadsheet now:
 *   - NO input boxes at rest — a cell is plain text on the sheet's own surface with hairline
 *     gridlines; a visible outline appears ONLY on the selected/editing cell.
 *   - A sticky TWO-ROW header (a group band over the column labels) and 31px data rows.
 *   - EVERY column exists on EVERY row — a cell that doesn't apply to a row's comp type renders
 *     grey with an em dash, never a different column set. That is what lets a land row and a
 *     lease row line up under one header (`lib/compSheetColumns.js` is the pure column model —
 *     see its own header for the group-by-what-things-ARE correction this round also made).
 *   - Frozen leading column (Title / Address — "freeze through Title / address") via
 *     `position: sticky`, the rest scrolling horizontally underneath the sticky header.
 *   - Real keyboard grid navigation (Tab/Shift-Tab/Enter/arrows/typing-replaces), fill-down
 *     (Ctrl/Cmd+D), Excel-style paste-and-spill into the selected cell, and undo (Ctrl/Cmd+Z) —
 *     the actual reasons a broker prefers a sheet to a form, not decorative.
 *   - Uncertainty renders as a full sentence below the sheet, naming the ROW ("Row 1 — Rate has
 *     no period...") with quick-resolve buttons for the blocking case — never a dot/badge on a
 *     cell's corner.
 *   - A summary row: count, plus a lease weighted average (`summarizeLeaseComps`, unchanged) and
 *     sale $/SF averages, always naming which basis a lease average is on.
 *
 * The "one record, three rows" fix from round 5 is UNCHANGED here — the paste/Add commit path
 * below is the same `commitText`/dedupe-guard logic, only its OUTPUT target changed (rows in a
 * sheet, not cards).
 *
 * MODULE-SCOPE-COMPONENTS: every component here is defined at module scope.
 */
import { useState, useRef, useEffect } from "react";
import { createPortal } from "react-dom";
import { Button } from "../../ui/controls.jsx";
import { parsePaste, rowHasBlockingFlags, parseProseLine, splitPasteLines } from "../lib/compParse.js";
import { emptyDraft, draftToComp, validateComp, summarizeLeaseComps, summarizeSaleComps } from "../lib/comps.js";
import {
  SHEET_COLUMNS, GROUPS, cellState, cellPlaceholder, applyCellEdit, fillDownColumn, spillPaste,
} from "../lib/compSheetColumns.js";

const ROW_H = 31;
const GROUP_BAND_H = 22;
const COL_LABEL_H = 26;
const REMOVE_COL_W = 32;

let _rowSeq = 0;
function newRowId() { return `row${Date.now()}_${_rowSeq++}`; }

export function draftFromParsedRow(parsed) {
  return { _id: newRowId(), draft: { ...emptyDraft(null), ...parsed.draft }, cellFlags: parsed.cellFlags || {} };
}

function computeGroupRuns() {
  const runs = [];
  for (const col of SHEET_COLUMNS) {
    const last = runs[runs.length - 1];
    if (last && last.group === col.group) last.span++;
    else runs.push({ group: col.group, span: 1 });
  }
  return runs;
}
const GROUP_RUNS = computeGroupRuns();

function colLeftOffset(col) {
  return col.frozen ? 0 : undefined;
}

/* ---- sticky header: group band over column labels ------------------------------------------ */

function HeaderRows() {
  return (
    <thead>
      <tr>
        {GROUP_RUNS.map((run, i) => (
          <th key={run.group + i} colSpan={run.span}
            style={{
              position: "sticky", top: 0, zIndex: run.group === "PROPERTY" && SHEET_COLUMNS[0].group === run.group ? 3 : 2,
              height: GROUP_BAND_H, boxSizing: "border-box", padding: "0 6px", textAlign: "left",
              fontSize: 10, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.06em",
              color: "var(--text-secondary)", background: "var(--surface-raised)",
              borderBottom: "1px solid var(--border-default)", borderRight: "1px solid var(--border-default)",
              left: i === 0 ? 0 : undefined,
            }}>
            {run.group}
          </th>
        ))}
        <th rowSpan={2} style={{
          position: "sticky", top: 0, right: 0, zIndex: 4, width: REMOVE_COL_W,
          background: "var(--surface-raised)", borderBottom: "1px solid var(--border-default)", borderLeft: "1px solid var(--border-default)",
        }} />
      </tr>
      <tr>
        {SHEET_COLUMNS.map((col, i) => (
          <th key={col.key}
            style={{
              position: "sticky", top: GROUP_BAND_H, zIndex: col.frozen ? 4 : 2,
              left: colLeftOffset(col), width: col.width, minWidth: col.width, maxWidth: col.width,
              height: COL_LABEL_H, boxSizing: "border-box", padding: "0 6px",
              textAlign: col.align, fontSize: 10.5, fontWeight: 700, color: "var(--text-secondary)",
              background: "var(--surface-raised)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
              borderBottom: "1px solid var(--border-default)", borderRight: "1px solid var(--border-default)",
            }}
            title={col.label}>
            {col.label}{col.required ? " *" : ""}
          </th>
        ))}
      </tr>
    </thead>
  );
}

/* ---- one data cell ---------------------------------------------------------------------------
 * At rest: plain text, right-aligned + tabular-nums for numbers, no border. Selected: an outline
 * appears. Editing: a real <input> (or a native date input) fills the cell exactly. */
function SheetCell({ col, colIdx, rowIdx, draft, cellFlags, selected, inRange, isEditing, editValue,
  onMouseDown, onDoubleClick, onEditChange, onEditKeyDown, onEditBlur, editInputRef }) {
  const st = cellState(col, draft);
  const flagKey = col.flagKey ? col.flagKey(draft) : col.key;
  const flag = cellFlags[flagKey];
  const muted = st.state === "na" || st.state === "derived";
  const tdStyle = {
    height: ROW_H, boxSizing: "border-box", padding: 0,
    width: col.width, minWidth: col.width, maxWidth: col.width,
    borderRight: "1px solid var(--border-default)", borderBottom: "1px solid var(--border-default)",
    position: col.frozen ? "sticky" : undefined, left: colLeftOffset(col), zIndex: col.frozen ? 1 : undefined,
    background: col.frozen ? "var(--surface-overlay)" : muted ? "var(--surface-raised)" : "var(--surface-overlay)",
    outline: selected ? "2px solid var(--accent)" : inRange ? "1px solid var(--accent)" : "none",
    outlineOffset: -1,
    cursor: st.state === "na" || st.state === "action" ? "default" : "cell",
  };
  if (isEditing) {
    return (
      <td style={tdStyle} data-cell={`${rowIdx}-${colIdx}`}>
        <input
          ref={editInputRef}
          type={col.kind === "date" ? "date" : "text"}
          value={editValue}
          onChange={(e) => onEditChange(e.target.value)}
          onKeyDown={onEditKeyDown}
          onBlur={onEditBlur}
          style={{
            width: "100%", height: "100%", boxSizing: "border-box", padding: "0 5px", margin: 0,
            border: "none", outline: "2px solid var(--accent)", outlineOffset: -2,
            background: "var(--surface-base)", color: "var(--text-primary)", fontFamily: "inherit",
            fontSize: 10.5, textAlign: col.align,
          }}
        />
      </td>
    );
  }
  const textStyle = {
    display: "block", height: "100%", lineHeight: `${ROW_H}px`, padding: "0 6px", boxSizing: "border-box",
    fontSize: 10.5, textAlign: col.align, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
    fontVariantNumeric: col.align === "right" ? "tabular-nums" : undefined,
    color: st.state === "na" ? "var(--text-tertiary)" : st.state === "derived" ? "var(--text-secondary)" : flag?.level === "blocking" ? "var(--danger-text)" : "var(--text-primary)",
    fontStyle: st.state === "na" ? "italic" : "normal",
  };
  const placeholder = st.state === "editable" && !st.text ? cellPlaceholder(col, draft.compType) : "";
  return (
    <td style={tdStyle} data-cell={`${rowIdx}-${colIdx}`}
      onMouseDown={(e) => onMouseDown(rowIdx, colIdx, e.shiftKey)}
      onDoubleClick={() => onDoubleClick(rowIdx, colIdx)}
      title={flag?.reason}>
      <span style={textStyle}>
        {st.text || (placeholder ? <span style={{ color: "var(--text-tertiary)" }}>{placeholder}</span> : "")}
      </span>
    </td>
  );
}

/* ---- the count + averages footer — always names a lease average's basis --------------------- */
function SummaryRow({ rows }) {
  if (!rows.length) return null;
  const comps = rows.map((r) => draftToComp(r.draft));
  const lease = summarizeLeaseComps(comps);
  const land = summarizeSaleComps(comps, "land");
  const bldg = summarizeSaleComps(comps, "building_sale");
  const parts = [`${rows.length} comp${rows.length === 1 ? "" : "s"}`];
  if (lease.headline) {
    const basis = lease.headlineBasis.toUpperCase();
    const weight = lease.headline.weighted ? "SF-weighted" : "unweighted";
    parts.push(`Lease avg $${lease.headline.avg.toFixed(2)}/SF/yr ${basis} (${lease.headline.count}, ${weight})`);
  }
  if (land.count) parts.push(`Land avg $${land.avg.toFixed(2)}/SF (${land.count})`);
  if (bldg.count) parts.push(`Bldg sale avg $${bldg.avg.toFixed(2)}/SF (${bldg.count})`);
  return (
    <div style={{ padding: "6px 10px", fontSize: 10.5, color: "var(--text-secondary)", borderTop: "1px solid var(--border-default)", background: "var(--surface-raised)" }}>
      {parts.join(" · ")}
    </div>
  );
}

/* ---- problems: full sentences below the sheet, naming the row, never a dot on a cell -------- */
function ProblemsList({ rows, onResolvePeriod }) {
  const items = [];
  rows.forEach((row, i) => {
    const { cellFlags, draft } = row;
    const periodFlag = cellFlags.leaseRatePeriod;
    if (periodFlag?.level === "blocking") {
      const rate = draft.leaseRate || "0.00";
      items.push(
        <div key={`${row._id}-period`} style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", fontSize: 10.5, color: "var(--danger-text)" }}>
          <span>Row {i + 1} — Rate has no period, monthly and annual differ by 12x.</span>
          <Button size="sm" variant="danger" onClick={() => onResolvePeriod(row._id, "monthly")}>${rate}/SF/mo</Button>
          <Button size="sm" variant="danger" onClick={() => onResolvePeriod(row._id, "annual")}>${rate}/SF/yr</Button>
        </div>,
      );
    }
    Object.entries(cellFlags).forEach(([key, flag]) => {
      if (key === "leaseRatePeriod" && flag.level === "blocking") return; // already rendered above with buttons
      if (flag.level === "blocking") {
        items.push(<div key={`${row._id}-${key}`} style={{ fontSize: 10.5, color: "var(--danger-text)" }}>Row {i + 1} — {flag.reason}</div>);
      } else if (flag.level === "soft") {
        items.push(<div key={`${row._id}-${key}`} style={{ fontSize: 10.5, color: "var(--warn-text)" }}>Row {i + 1} — {flag.reason}</div>);
      }
    });
    const missing = validateComp(draftToComp(draft));
    if (!rowHasBlockingFlags(cellFlags) && missing.length) {
      items.push(<div key={`${row._id}-missing`} style={{ fontSize: 10.5, color: "var(--warn-text)" }}>Row {i + 1} — {missing.join(" ")}</div>);
    }
  });
  if (!items.length) return null;
  return <div style={{ padding: "8px 10px", display: "flex", flexDirection: "column", gap: 6, borderTop: "1px solid var(--border-default)", maxHeight: 120, overflowY: "auto" }}>{items}</div>;
}

function clamp(n, lo, hi) { return Math.max(lo, Math.min(hi, n)); }

export default function CompEntryGrid({ rows, onRowsChange, armedRowId, onArm, onFocusAnchor, onSave, onCancel, saving, saveError }) {
  const [pasteText, setPasteText] = useState("");
  const [lastPasteText, setLastPasteText] = useState(null);
  const [lastCommitSummary, setLastCommitSummary] = useState(null);
  const [showPastedText, setShowPastedText] = useState(false);
  const [lastSingleParse, setLastSingleParse] = useState(null);
  const lastCommitRef = useRef(null); // duplicate-paste-event guard, unchanged from round 5

  // Sheet selection state.
  const [selection, setSelectionState] = useState(rows.length ? { row: 0, col: 0 } : null);
  const [rangeStartRow, setRangeStartRow] = useState(null);
  const [editing, setEditing] = useState(null); // {row, col} | null
  const [editValue, setEditValue] = useState("");
  const editingRef = useRef(null);
  const editValueRef = useRef("");
  const editHandledRef = useRef(true);
  const gridRef = useRef(null);
  const editInputRef = useRef(null);
  const undoStackRef = useRef([]);

  useEffect(() => {
    if (editing && editInputRef.current) {
      editInputRef.current.focus();
      if (editing.selectAll) editInputRef.current.select();
    }
  }, [editing]);

  useEffect(() => {
    if (!selection) return;
    const el = gridRef.current?.querySelector(`[data-cell="${selection.row}-${selection.col}"]`);
    el?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [selection]);

  // Keep selection in bounds when rows are added/removed (never point at a row that no longer exists).
  useEffect(() => {
    if (!rows.length) { setSelectionState(null); return; }
    setSelectionState((sel) => (sel ? { row: clamp(sel.row, 0, rows.length - 1), col: sel.col } : { row: 0, col: 0 }));
  }, [rows.length]);

  const setSelection = (next) => { setRangeStartRow(null); setSelectionState(next); };

  // Every mutation to `rows` routes through here so Ctrl/Cmd+Z has something to pop —
  // cell edits, fill-down, spill-paste, a smart-parse commit, and row removal alike.
  const commitRows = (nextRows) => {
    undoStackRef.current.push(rows);
    if (undoStackRef.current.length > 50) undoStackRef.current.shift();
    onRowsChange(nextRows);
  };
  const undo = () => {
    const prev = undoStackRef.current.pop();
    if (prev) onRowsChange(prev);
  };

  /* ---- paste box above the sheet — unchanged commit path from round 5 ----------------------- */
  const commitText = (text) => {
    if (!text.trim()) return;
    const now = Date.now();
    const last = lastCommitRef.current;
    if (last && last.text === text && now - last.time < 800) return; // duplicate event guard
    lastCommitRef.current = { text, time: now };

    const { rows: parsedRows, mode } = parsePaste(text);
    setLastPasteText(text);
    setShowPastedText(false);
    const lineCount = splitPasteLines(text).length;
    if (!parsedRows.length) {
      setLastSingleParse(null);
      setLastCommitSummary(`Nothing recognized in ${lineCount} pasted line${lineCount === 1 ? "" : "s"}.`);
      return;
    }
    const newRows = parsedRows.map(draftFromParsedRow);
    commitRows([...rows, ...newRows]);
    setLastSingleParse(mode === "single" ? { raw: text, rowIds: newRows.map((r) => r._id) } : null);
    if (mode === "single" && newRows.length === 1) {
      setLastCommitSummary(`Read 1 comp from ${lineCount} pasted line${lineCount === 1 ? "" : "s"}`);
    } else {
      setLastCommitSummary(`Read ${newRows.length} comp${newRows.length === 1 ? "" : "s"} from ${lineCount} pasted line${lineCount === 1 ? "" : "s"}`);
    }
    setSelection({ row: rows.length, col: 0 });
  };

  const handlePaste = (e) => {
    const text = e.clipboardData?.getData("text/plain");
    if (!text) return;
    e.preventDefault();
    commitText(text);
    setPasteText("");
  };
  const handleChange = (e) => setPasteText(e.target.value);
  const commitTyped = () => { if (pasteText.trim()) { commitText(pasteText); setPasteText(""); } };
  const handleKeyDown = (e) => {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); commitTyped(); }
  };
  const switchToOnePerLine = () => {
    if (!lastSingleParse) return;
    const { raw, rowIds } = lastSingleParse;
    const idSet = new Set(rowIds);
    const remaining = rows.filter((r) => !idSet.has(r._id));
    const multiRows = splitPasteLines(raw).map(parseProseLine).filter(Boolean).map(draftFromParsedRow);
    commitRows([...remaining, ...multiRows]);
    setLastSingleParse(null);
  };

  /* ---- sheet cell editing -------------------------------------------------------------------- */
  const beginEdit = (row, col, initial, selectAll) => {
    const colDef = SHEET_COLUMNS[col];
    if (colDef.kind === "derived" || colDef.kind === "action") return;
    const st = cellState(colDef, rows[row].draft);
    if (st.state !== "editable") return;
    const startValue = initial != null ? initial : (st.raw ?? "");
    editHandledRef.current = false;
    editingRef.current = { row, col };
    editValueRef.current = startValue;
    setEditing({ row, col, selectAll: !!selectAll });
    setEditValue(startValue);
  };

  const finishEdit = (commit, moveDir) => {
    if (editHandledRef.current) return;
    editHandledRef.current = true;
    const target = editingRef.current;
    editingRef.current = null;
    setEditing(null);
    setEditValue("");
    if (!target) return;
    if (commit) {
      const colDef = SHEET_COLUMNS[target.col];
      const row = rows[target.row];
      const newDraft = applyCellEdit(colDef, row.draft, editValueRef.current);
      const flagKey = colDef.flagKey(row.draft);
      const nextFlags = { ...row.cellFlags };
      delete nextFlags[flagKey];
      commitRows(rows.map((r, i) => (i === target.row ? { ...r, draft: newDraft, cellFlags: nextFlags } : r)));
    }
    if (moveDir) moveSelectionFrom({ row: target.row, col: target.col }, moveDir);
    else setSelection({ row: target.row, col: target.col });
    gridRef.current?.focus();
  };

  const onEditChange = (v) => { editValueRef.current = v; setEditValue(v); };
  const onEditKeyDown = (e) => {
    if (e.key === "Enter") { e.preventDefault(); finishEdit(true, { axis: "row", delta: 1 }); }
    else if (e.key === "Tab") { e.preventDefault(); finishEdit(true, { axis: "col", delta: e.shiftKey ? -1 : 1, wrap: true }); }
    else if (e.key === "Escape") { e.preventDefault(); finishEdit(false, null); }
  };
  const onEditBlur = () => finishEdit(true, null);

  /* ---- navigation ----------------------------------------------------------------------------- */
  const moveSelectionFrom = (from, { axis, delta, wrap }) => {
    let { row, col } = from;
    if (axis === "row") {
      row = clamp(row + delta, 0, rows.length - 1);
    } else {
      col += delta;
      if (wrap) {
        if (col < 0) { col = SHEET_COLUMNS.length - 1; row = clamp(row - 1, 0, rows.length - 1); }
        else if (col > SHEET_COLUMNS.length - 1) { col = 0; row = clamp(row + 1, 0, rows.length - 1); }
      } else {
        col = clamp(col, 0, SHEET_COLUMNS.length - 1);
      }
    }
    setSelection({ row, col });
  };
  const moveSelection = (opts) => { if (selection) moveSelectionFrom(selection, opts); };

  const extendRangeTo = (targetRow) => {
    if (!selection) return;
    const anchor = rangeStartRow == null ? selection.row : rangeStartRow;
    setRangeStartRow(anchor);
    setSelectionState({ row: clamp(targetRow, 0, rows.length - 1), col: selection.col });
  };

  const currentRange = () => {
    if (!selection) return null;
    if (rangeStartRow == null) return [selection.row, selection.row];
    return [Math.min(rangeStartRow, selection.row), Math.max(rangeStartRow, selection.row)];
  };

  const triggerAction = (row, col) => {
    const colDef = SHEET_COLUMNS[col];
    if (colDef.key !== "location") return;
    const draft = rows[row].draft;
    if (draft.anchor) onFocusAnchor(draft.anchor);
    else onArm(rows[row]._id);
  };

  const onCellMouseDown = (row, col, shiftKey) => {
    if (editing) finishEdit(true, null);
    if (shiftKey && selection && selection.col === col) { extendRangeTo(row); return; }
    setSelection({ row, col });
  };
  const onCellDoubleClick = (row, col) => {
    const colDef = SHEET_COLUMNS[col];
    if (colDef.kind === "action") { triggerAction(row, col); return; }
    beginEdit(row, col, null, true);
  };

  const doFillDown = () => {
    if (!selection) return;
    const [start, end] = currentRange();
    if (end > start) { commitRows(fillDownColumn(rows, selection.col, [start, end])); return; }
    if (start === 0) return; // Excel's single-cell Ctrl+D: copy the row ABOVE
    commitRows(fillDownColumn(rows, selection.col, [start - 1, start]));
  };

  const clearRange = () => {
    if (!selection) return;
    const [start, end] = currentRange();
    const colDef = SHEET_COLUMNS[selection.col];
    if (colDef.kind === "derived" || colDef.kind === "action") return;
    commitRows(rows.map((r, i) => {
      if (i < start || i > end || !colDef.appliesTo(r.draft.compType)) return r;
      const flagKey = colDef.flagKey(r.draft);
      const nextFlags = { ...r.cellFlags };
      delete nextFlags[flagKey];
      return { ...r, draft: colDef.setValue(r.draft, ""), cellFlags: nextFlags };
    }));
  };

  const onGridKeyDown = (e) => {
    if (editing || !selection) return;
    const meta = e.metaKey || e.ctrlKey;
    if (meta && e.key.toLowerCase() === "z") { e.preventDefault(); undo(); return; }
    if (meta && e.key.toLowerCase() === "d") { e.preventDefault(); doFillDown(); return; }
    if (e.key === "Tab") { e.preventDefault(); moveSelection({ axis: "col", delta: e.shiftKey ? -1 : 1, wrap: true }); return; }
    if (e.key === "Enter") {
      const colDef = SHEET_COLUMNS[selection.col];
      if (colDef.kind === "action") { triggerAction(selection.row, selection.col); return; }
      e.preventDefault(); moveSelection({ axis: "row", delta: 1 }); return;
    }
    if (e.key === "ArrowDown") { e.preventDefault(); if (e.shiftKey) extendRangeTo(selection.row + 1); else moveSelection({ axis: "row", delta: 1 }); return; }
    if (e.key === "ArrowUp") { e.preventDefault(); if (e.shiftKey) extendRangeTo(selection.row - 1); else moveSelection({ axis: "row", delta: -1 }); return; }
    if (e.key === "ArrowRight") { e.preventDefault(); moveSelection({ axis: "col", delta: 1 }); return; }
    if (e.key === "ArrowLeft") { e.preventDefault(); moveSelection({ axis: "col", delta: -1 }); return; }
    if (e.key === "Delete" || e.key === "Backspace") { e.preventDefault(); clearRange(); return; }
    if (e.key === "F2") { e.preventDefault(); beginEdit(selection.row, selection.col, null, true); return; }
    if (e.key.length === 1 && !meta && !e.altKey) {
      const colDef = SHEET_COLUMNS[selection.col];
      if (colDef.kind === "action") { triggerAction(selection.row, selection.col); return; }
      beginEdit(selection.row, selection.col, e.key, false);
    }
  };

  const onGridPaste = (e) => {
    if (!selection || editing) return; // editing input handles its own native paste
    const text = e.clipboardData?.getData("text/plain");
    if (!text) return;
    e.preventDefault();
    commitRows(spillPaste(rows, selection.row, selection.col, text, () => emptyDraft(null), newRowId));
  };

  const removeRow = (id) => commitRows(rows.filter((r) => r._id !== id));
  const resolvePeriod = (rowId, period) => {
    commitRows(rows.map((r) => {
      if (r._id !== rowId) return r;
      const nextFlags = { ...r.cellFlags };
      delete nextFlags.leaseRatePeriod;
      return { ...r, draft: { ...r.draft, leaseRatePeriod: period }, cellFlags: nextFlags };
    }));
  };

  function rowIsReady(row) {
    return !rowHasBlockingFlags(row.cellFlags) && validateComp(draftToComp(row.draft)).length === 0;
  }
  const readyRows = rows.filter(rowIsReady);
  const blockingCount = rows.filter((r) => rowHasBlockingFlags(r.cellFlags)).length;
  const missingCount = rows.filter((r) => !rowHasBlockingFlags(r.cellFlags) && validateComp(draftToComp(r.draft)).length > 0).length;
  let footerMsg = "";
  if (rows.length > 0) {
    if (blockingCount === 0 && missingCount === 0) footerMsg = `${readyRows.length} comp${readyRows.length === 1 ? "" : "s"} ready.`;
    else {
      const parts = [];
      if (blockingCount > 0) parts.push(`${blockingCount} blocking`);
      if (missingCount > 0) parts.push(`${missingCount} need${missingCount === 1 ? "s" : ""} a date or a location`);
      footerMsg = `${readyRows.length} of ${rows.length} ready — ${parts.join(", ")}.`;
    }
  }

  const [pos, setPos] = useState(() => {
    const w = typeof window !== "undefined" ? window.innerWidth : 1200;
    return { x: Math.max(16, (w - 1200) / 2), y: 60 };
  });
  const posRef = useRef(pos);
  posRef.current = pos;
  const startDrag = (e) => {
    if (e.button != null && e.button !== 0) return;
    e.preventDefault();
    const sx = e.clientX, sy = e.clientY;
    const ox = posRef.current.x, oy = posRef.current.y;
    const move = (ev) => {
      const w = typeof window !== "undefined" ? window.innerWidth : 1200;
      const h = typeof window !== "undefined" ? window.innerHeight : 800;
      setPos({ x: Math.max(4, Math.min(w - 60, ox + ev.clientX - sx)), y: Math.max(4, Math.min(h - 40, oy + ev.clientY - sy)) });
    };
    const up = () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  const linkBtnStyle = { border: "none", background: "none", color: "var(--accent)", cursor: "pointer", padding: 0, textDecoration: "underline", fontSize: 10.5 };
  const range = currentRange();

  return createPortal(
    <div
      onPointerDown={(e) => e.stopPropagation()}
      style={{
        position: "fixed", left: pos.x, top: pos.y, width: "min(1200px, calc(100vw - 32px))",
        maxHeight: "min(88vh, 800px)", zIndex: 2600, display: "flex", flexDirection: "column",
        background: "var(--surface-overlay)", border: "1px solid var(--border-default)", borderRadius: 12,
        boxShadow: "0 16px 44px rgba(28,25,20,0.22), 0 3px 10px rgba(28,25,20,0.1)", // design-exempt: mirrors shared/ui/FloatingPanel.jsx's card shadow verbatim — no shadow token exists yet
      }}>
      <div onPointerDown={startDrag}
        style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 14px", borderBottom: "1px solid var(--border-default)", cursor: "move", userSelect: "none" }}>
        <span style={{ fontSize: 13, fontWeight: 700 }}>New comps</span>
        <button onPointerDown={(e) => e.stopPropagation()} onClick={onCancel} aria-label="Close"
          style={{ border: "none", background: "transparent", color: "var(--text-secondary)", fontSize: 14, cursor: "pointer", padding: 2 }}>✕</button>
      </div>

      <div style={{ padding: "10px 14px", borderBottom: "1px solid var(--border-default)" }}>
        <div style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
          <textarea
            value={pasteText}
            onChange={handleChange}
            onPaste={handlePaste}
            onKeyDown={handleKeyDown}
            placeholder="Paste a broker email or an Excel block — it parses immediately. Or type your own, then press Ctrl+Enter (⌘+Enter) or click Add."
            rows={2}
            style={{ flex: 1, boxSizing: "border-box", padding: "8px 10px", fontSize: 12, borderRadius: 8, fontFamily: "inherit", border: "1px solid var(--border-default)", background: "var(--surface-base)", color: "var(--text-primary)", resize: "vertical" }}
          />
          <Button size="sm" onClick={commitTyped} disabled={!pasteText.trim()}>Add</Button>
        </div>
        {lastCommitSummary && (
          <div style={{ marginTop: 6, fontSize: 10.5, color: "var(--text-secondary)" }}>
            {lastCommitSummary}
            {lastPasteText && (<> · <button onClick={() => setShowPastedText((v) => !v)} style={linkBtnStyle}>{showPastedText ? "Hide pasted text" : "Show pasted text"}</button></>)}
            {lastSingleParse && (<> · <button onClick={switchToOnePerLine} style={linkBtnStyle}>Split one row per line</button></>)}
          </div>
        )}
        {showPastedText && lastPasteText && (
          <div style={{ marginTop: 4, fontSize: 10.5, color: "var(--text-secondary)", background: "var(--surface-raised)", border: "1px solid var(--border-default)", borderRadius: 6, padding: "6px 8px", whiteSpace: "pre-wrap", maxHeight: 90, overflowY: "auto" }}>
            {lastPasteText}
          </div>
        )}
      </div>

      {armedRowId && (
        <div style={{ fontSize: 12, color: "var(--warn-text)", background: "var(--warn-bg)", borderBottom: "1px solid var(--warn-border)", padding: "6px 14px" }}>
          Now click <strong>Drop a pin</strong> or <strong>Comp from parcel</strong> on the map, then click the map — the location lands on the comp you picked. The map stays fully usable while you do this.{" "}
          <button onClick={() => onArm(null)} style={{ border: "none", background: "none", color: "inherit", textDecoration: "underline", cursor: "pointer", padding: 0, marginLeft: 4 }}>Cancel</button>
        </div>
      )}

      {rows.length === 0 ? (
        <div style={{ fontSize: 12, color: "var(--text-secondary)", padding: "24px 14px", textAlign: "center" }}>
          Paste a few comps above to get started.
        </div>
      ) : (
        <div
          ref={gridRef}
          tabIndex={0}
          role="grid"
          onKeyDown={onGridKeyDown}
          onPaste={onGridPaste}
          style={{ flex: 1, minHeight: 0, overflow: "auto", outline: "none" }}>
          <table style={{ borderCollapse: "collapse", tableLayout: "fixed" }}>
            <HeaderRows />
            <tbody>
              {rows.map((row, rowIdx) => (
                <tr key={row._id}>
                  {SHEET_COLUMNS.map((col, colIdx) => (
                    <SheetCell
                      key={col.key}
                      col={col} colIdx={colIdx} rowIdx={rowIdx}
                      draft={row.draft} cellFlags={row.cellFlags}
                      selected={!!selection && selection.row === rowIdx && selection.col === colIdx}
                      inRange={!!range && range[0] <= rowIdx && rowIdx <= range[1] && selection?.col === colIdx && !(selection.row === rowIdx)}
                      isEditing={!!editing && editing.row === rowIdx && editing.col === colIdx}
                      editValue={editValue}
                      onMouseDown={onCellMouseDown}
                      onDoubleClick={onCellDoubleClick}
                      onEditChange={onEditChange}
                      onEditKeyDown={onEditKeyDown}
                      onEditBlur={onEditBlur}
                      editInputRef={editInputRef}
                    />
                  ))}
                  <td style={{
                    position: "sticky", right: 0, width: REMOVE_COL_W, height: ROW_H, textAlign: "center",
                    background: "var(--surface-overlay)", borderBottom: "1px solid var(--border-default)", borderLeft: "1px solid var(--border-default)",
                  }}>
                    <button onClick={() => removeRow(row._id)} title="Remove" aria-label="Remove comp"
                      style={{ border: "none", background: "transparent", color: "var(--danger-text)", cursor: "pointer", fontSize: 13, padding: 0, lineHeight: `${ROW_H}px` }}>✕</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <SummaryRow rows={rows} />
      <ProblemsList rows={rows} onResolvePeriod={resolvePeriod} />

      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, padding: "10px 14px", borderTop: "1px solid var(--border-default)" }}>
        <span style={{ fontSize: 10.5, color: "var(--text-secondary)" }}>{footerMsg}</span>
        <span style={{ display: "flex", gap: 8 }}>
          <Button size="sm" variant="ghost" onClick={onCancel} disabled={saving}>Close</Button>
          <Button size="sm" onClick={() => onSave(readyRows)} disabled={saving || readyRows.length === 0}>
            {saving ? "Saving…" : `Save ${readyRows.length || ""} comp${readyRows.length === 1 ? "" : "s"}`.trim()}
          </Button>
        </span>
      </div>
      {saveError && <div style={{ fontSize: 12, color: "var(--danger-text)", padding: "0 14px 10px" }}>{saveError}</div>}
    </div>,
    document.body,
  );
}
