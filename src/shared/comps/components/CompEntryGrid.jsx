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
import { useState, useRef, useEffect, useLayoutEffect, useMemo } from "react";
import { createPortal } from "react-dom";
import { Button } from "../../ui/controls.jsx";
import { parsePaste, rowHasBlockingFlags, parseProseLine, splitPasteLines } from "../lib/compParse.js";
import { emptyDraft, draftToComp, validateComp, summarizeLeaseComps, summarizeSaleComps, resolveCapTriangle } from "../lib/comps.js";
import {
  SHEET_COLUMNS, cellState, applyCellEdit, fillDownColumn, spillPaste, visibleColumnIndices,
  computeFlexWidths, widthFor, frozenLeftOffsets,
} from "../lib/compSheetColumns.js";
import { parcelLocationText, siteplanLocationText, pinFallbackText } from "../lib/compLocationText.js";
import { reverseGeocodeLatLon } from "../../../workspaces/site-planner/lib/geocode.js";
import { COUNTIES } from "../../../workspaces/site-planner/lib/counties.js";

const ROW_H = 31;
const GROUP_BAND_H = 22;
const COL_LABEL_H = 26;
const REMOVE_COL_W = 32;

let _rowSeq = 0;
function newRowId() { return `row${Date.now()}_${_rowSeq++}`; }

// B986096-HARDENING-9 — a county's own registry entry names its state, so the Location cell's
// "County, ST" fallback never has to guess a state from how the county KEY happens to be spelled.
function countyEntry(key) {
  const rec = key ? COUNTIES[key] : null;
  if (!rec) return null;
  return { name: rec.label ? rec.label.split(" ·")[0].trim() : null, state: rec.state || null };
}

function locationCacheKey(anchor) {
  return anchor && typeof anchor.lat === "number" && typeof anchor.lon === "number"
    ? `${anchor.lat.toFixed(6)},${anchor.lon.toFixed(6)}`
    : null;
}

/** The Location cell's display text for ONE row — three anchor kinds, three identities (see
 * compLocationText.js's header). A pin resolves through the row's OWN cache
 * (`row.locationCache = {key, text, resolving}`, populated async by the effect in
 * CompEntryGrid), falling back to `pinFallbackText` (synchronous, never blank) while that's
 * pending or unavailable. */
function locationCellText(row, overlaysById) {
  const anchor = row.draft.anchor;
  if (!anchor) return null;
  if (anchor.kind === "parcel") return parcelLocationText(anchor, (key) => countyEntry(key)?.name);
  if (anchor.kind === "site_plan") return siteplanLocationText(anchor, overlaysById) || pinFallbackText(anchor, countyEntry);
  // pin
  const key = locationCacheKey(anchor);
  if (row.locationCache?.key === key && row.locationCache.text) return row.locationCache.text;
  return pinFallbackText(anchor, countyEntry);
}

export function draftFromParsedRow(parsed) {
  return { _id: newRowId(), draft: { ...emptyDraft(null), ...parsed.draft }, cellFlags: parsed.cellFlags || {} };
}

// B986096-HARDENING-9 ("hide unused columns entirely") — the group band's colSpans must be
// recomputed from whatever's actually VISIBLE, not the full column list, or a band would span
// past the columns it now covers (Michael's screenshot: "PROPERTY spans past its own columns").
function computeVisibleGroupRuns(visibleIdx) {
  const runs = [];
  for (const idx of visibleIdx) {
    const col = SHEET_COLUMNS[idx];
    const last = runs[runs.length - 1];
    if (last && last.group === col.group) last.span++;
    else runs.push({ group: col.group, span: 1 });
  }
  return runs;
}

/* ---- sticky header: group band over column labels ------------------------------------------ */

function HeaderRows({ visibleIdx, flexWidths, frozenOffsets }) {
  const groupRuns = computeVisibleGroupRuns(visibleIdx);
  return (
    <thead>
      <tr>
        {groupRuns.map((run, i) => (
          <th key={run.group + i} colSpan={run.span}
            style={{
              position: "sticky", top: 0, zIndex: i === 0 ? 3 : 2,
              height: GROUP_BAND_H, boxSizing: "border-box", padding: "0 5px", textAlign: "left",
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
        {visibleIdx.map((idx, i) => {
          const col = SHEET_COLUMNS[idx];
          const w = widthFor(col, flexWidths);
          return (
            <th key={col.key}
              style={{
                position: "sticky", top: GROUP_BAND_H, zIndex: col.frozen ? 4 : 2,
                left: col.frozen ? frozenOffsets[col.key] : undefined, width: w, minWidth: w, maxWidth: w,
                height: COL_LABEL_H, boxSizing: "border-box", padding: "0 5px",
                textAlign: col.align, fontSize: 10, fontWeight: 700, color: "var(--text-secondary)",
                background: "var(--surface-raised)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
                borderBottom: "1px solid var(--border-default)", borderRight: "1px solid var(--border-default)",
              }}
              title={col.fullLabel || col.label}>
              {col.label}
            </th>
          );
        })}
      </tr>
    </thead>
  );
}

/* ---- one data cell ---------------------------------------------------------------------------
 * At rest: plain text, right-aligned + tabular-nums for numbers, no border. Selected: an outline
 * appears. Editing: a real <input> (or a native date input) fills the cell exactly. */
function SheetCell({ col, colIdx, rowIdx, draft, cellFlags, selected, inRange, isEditing, editValue,
  onMouseDown, onDoubleClick, onEditChange, onEditKeyDown, onEditBlur, editInputRef, locationText,
  flexWidths, frozenOffsets }) {
  const st = cellState(col, draft);
  const flagKey = col.flagKey ? col.flagKey(draft) : col.key;
  const flag = cellFlags[flagKey];
  const muted = st.state === "na" || st.state === "derived";
  const w = widthFor(col, flexWidths);
  const tdStyle = {
    height: ROW_H, boxSizing: "border-box", padding: 0,
    width: w, minWidth: w, maxWidth: w,
    borderRight: "1px solid var(--border-default)", borderBottom: "1px solid var(--border-default)",
    position: col.frozen ? "sticky" : undefined, left: col.frozen ? frozenOffsets[col.key] : undefined, zIndex: col.frozen ? 1 : undefined,
    background: col.frozen ? "var(--surface-overlay)" : muted ? "var(--surface-raised)" : "var(--surface-overlay)",
    outline: selected ? "2px solid var(--accent)" : inRange ? "1px solid var(--accent)" : "none",
    outlineOffset: -1,
    cursor: st.state === "na" ? "default" : st.state === "action" ? "pointer" : "cell",
  };
  if (isEditing) {
    // B986096-HARDENING-8 (owner live-tested, "TYPE / UNIT / PER / BASIS take a SELECT") — a
    // select-kind column used to fall through to the same plain text input as everything else,
    // relying on `applyCellEdit`'s loose text-matching to resolve whatever was typed. A real
    // <select> is the correct control for a closed set of options — no typing/matching needed,
    // and it can never land on a value the column doesn't recognize.
    const inputStyle = {
      width: col.key === "notes" ? "max(100%, 260px)" : "100%", // NEW-3 — Notes widens while editing rather than staying pinned to its rest width
      height: "100%", boxSizing: "border-box", padding: "0 5px", margin: 0,
      border: "none", outline: "2px solid var(--accent)", outlineOffset: -2,
      background: "var(--surface-base)", color: "var(--text-primary)", fontFamily: "inherit",
      fontSize: 12, textAlign: col.align,
    };
    if (col.kind === "select") {
      return (
        <td style={tdStyle} data-cell={`${rowIdx}-${colIdx}`}>
          <select
            ref={editInputRef}
            value={editValue}
            onChange={(e) => { onEditChange(e.target.value); }}
            onKeyDown={onEditKeyDown}
            onBlur={onEditBlur}
            style={{ ...inputStyle, padding: "0 2px" }}>
            <option value="" disabled hidden>{" "}</option>
            {col.options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </td>
      );
    }
    return (
      <td style={tdStyle} data-cell={`${rowIdx}-${colIdx}`}>
        <input
          ref={editInputRef}
          type="text"
          value={editValue}
          onChange={(e) => onEditChange(e.target.value)}
          onKeyDown={onEditKeyDown}
          onBlur={onEditBlur}
          style={inputStyle}
        />
      </td>
    );
  }
  const textStyle = {
    display: "block", height: "100%", lineHeight: `${ROW_H}px`, padding: "0 5px", boxSizing: "border-box",
    fontSize: 12, textAlign: col.align, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
    fontVariantNumeric: col.align === "right" ? "tabular-nums" : undefined,
    color: st.state === "na" ? "var(--text-tertiary)" : st.state === "derived" ? "var(--text-secondary)" : flag?.level === "blocking" ? "var(--danger-text)" : "var(--text-primary)",
    fontStyle: st.state === "na" ? "italic" : "normal",
  };
  // B986096-HARDENING-9 — the Location cell shows real information once an anchor is set (an
  // address / an APN / a plan title, resolved by `locationCellText` in the parent), never a bare
  // confirmation of the click. Empty state keeps the "Set" affordance; the whole cell is still
  // the click target either way (no separate button — HARDENING-9's "click target is the text
  // itself" requirement is already how every action-kind cell has always worked here).
  // HARDENING-10 NEW-4 — "empty means empty": a genuinely unfilled editable cell renders nothing
  // at all now, never a grey placeholder word (`cellPlaceholder` always returns "" — see its own
  // header in compSheetColumns.js). The em dash for a not-applicable cell is unaffected — that
  // comes from `st.text` itself ("—", set by `cellState`), not from this placeholder path.
  const cellText = col.key === "location"
    ? (locationText || <span style={{ color: "var(--text-tertiary)" }}>Set</span>)
    : st.text || "";
  // HARDENING-10 (message B NEW-3) — Title/Address and the two party columns are the ones real
  // values got cut off in ("Core5 Industrial Partners"); a hover reveals the untruncated value.
  const isLongTextCol = col.key === "title" || col.key === "partyProvider" || col.key === "partyAcquirer";
  const hoverTitle = col.key === "location" ? locationText : flag?.reason || (isLongTextCol && st.text ? st.text : undefined);
  return (
    <td style={tdStyle} data-cell={`${rowIdx}-${colIdx}`}
      onMouseDown={(e) => onMouseDown(rowIdx, colIdx, e.shiftKey)}
      onDoubleClick={() => onDoubleClick(rowIdx, colIdx)}
      title={hoverTitle}>
      <span style={textStyle}>
        {cellText}
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
    // B986096-HARDENING-7 — "if all three are entered and they disagree, flag it - do not
    // silently recompute and overwrite what he typed." Live-computed every render (never stored
    // in cellFlags — it's a fact about the CURRENT three values, not a one-time parse verdict).
    if (draft.compType === "building_sale") {
      const tri = resolveCapTriangle(draft);
      if (tri.disagreement) {
        const stated = (tri.disagreement.statedCapRate * 100).toFixed(2);
        const implied = (tri.disagreement.impliedCapRate * 100).toFixed(2);
        items.push(
          <div key={`${row._id}-captri`} style={{ fontSize: 10.5, color: "var(--warn-text)" }}>
            Row {i + 1} — Price, NOI and Cap don't reconcile: stated cap {stated}%, but NOI ÷ Price implies {implied}%. Nothing was changed automatically.
          </div>,
        );
      }
    }
  });
  if (!items.length) return null;
  return <div style={{ padding: "8px 10px", display: "flex", flexDirection: "column", gap: 6, borderTop: "1px solid var(--border-default)", maxHeight: 120, overflowY: "auto" }}>{items}</div>;
}

function clamp(n, lo, hi) { return Math.max(lo, Math.min(hi, n)); }

export default function CompEntryGrid({ rows, onRowsChange, armedRowId, onArm, onFocusAnchor, onSave, onCancel, saving, saveError, overlaysById }) {
  const [pasteText, setPasteText] = useState("");
  const [lastPasteText, setLastPasteText] = useState(null);
  const [lastCommitSummary, setLastCommitSummary] = useState(null);
  const [showPastedText, setShowPastedText] = useState(false);
  const [lastSingleParse, setLastSingleParse] = useState(null);
  const lastCommitRef = useRef(null); // duplicate-paste-event guard, unchanged from round 5

  // B986096-HARDENING-9 — reverse-geocode a dropped pin's lat/lon into a street address, cached
  // on the ROW (`row.locationCache = {key, text, resolving}`) rather than re-fetched on every
  // render, and self-invalidating: `key` is the anchor's OWN lat/lon, so a re-anchored row's
  // stale cache simply stops matching and a fresh resolve kicks off — no separate invalidation
  // step needed. `rowsRef`/`onRowsChangeRef` stay current so the async completion patches the
  // LATEST rows array rather than a stale closure over whatever `rows` were at effect-fire time.
  const rowsRef = useRef(rows);
  rowsRef.current = rows;
  const onRowsChangeRef = useRef(onRowsChange);
  onRowsChangeRef.current = onRowsChange;
  useEffect(() => {
    rows.forEach((row) => {
      const anchor = row.draft.anchor;
      if (!anchor || anchor.kind !== "pin") return;
      const key = locationCacheKey(anchor);
      if (!key || row.locationCache?.key === key) return; // already resolved, or already in flight, for this exact position
      onRowsChangeRef.current(rowsRef.current.map((r) => (r._id === row._id ? { ...r, locationCache: { key, text: null, resolving: true } } : r)));
      reverseGeocodeLatLon(anchor.lat, anchor.lon).then((ans) => {
        onRowsChangeRef.current(rowsRef.current.map((r) => {
          if (r._id !== row._id) return r;
          // The anchor may have moved on (re-picked, or the row deleted and a new one reusing
          // nothing) by the time this resolves — only apply a response that still matches.
          if (r.draft.anchor?.kind !== "pin" || locationCacheKey(r.draft.anchor) !== key) return r;
          return { ...r, locationCache: { key, text: ans?.label || null, resolving: false } };
        }));
      });
    });
  }, [rows]);

  // B986096-HARDENING-9 — which columns are actually shown, given the comp types currently on
  // the sheet. Navigation (Tab/arrows) and rendering both read this; the pure column MODEL
  // (fillDownColumn/spillPaste/applyCellEdit/cellState) is untouched and keeps indexing the FULL
  // SHEET_COLUMNS array, so hiding a column never changes what a cell edit or a paste means.
  const visibleIdx = useMemo(() => visibleColumnIndices(rows), [rows]);

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

  // HARDENING-10 NEW-5 — the sheet must fit its container with ZERO horizontal scroll rather than
  // a hand-tuned static width budget. `gridRef` is the actual scrolling element the table sits
  // in; its measured content width (not an assumed viewport number) is what the four `flexKey`
  // columns divide up via `computeFlexWidths` — real measurement rather than replaying the
  // dialog's own `min(1560px, calc(100vw - 32px))` CSS in JS, so it stays correct through any
  // future change to that CSS, a scrollbar, or a narrower window.
  const [containerWidth, setContainerWidth] = useState(0);
  const gridMounted = rows.length > 0; // the grid <div> only exists once there's a row to show
  useLayoutEffect(() => {
    const el = gridRef.current;
    if (!el || typeof ResizeObserver === "undefined") return undefined;
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect?.width;
      if (typeof w === "number") setContainerWidth(w);
    });
    ro.observe(el);
    setContainerWidth(el.clientWidth);
    return () => ro.disconnect();
  }, [gridMounted]);

  const flexWidths = useMemo(() => {
    const fixedTotal = visibleIdx.reduce((s, idx) => {
      const col = SHEET_COLUMNS[idx];
      return col.flexKey ? s : s + col.width;
    }, 0);
    // One hairline border per visible column + the pinned remove-row column, so the computed
    // total lands AT the real available width rather than a hair over it.
    const borderAllowance = visibleIdx.length + 2;
    const availableForFlex = containerWidth - fixedTotal - REMOVE_COL_W - borderAllowance;
    return computeFlexWidths(availableForFlex);
  }, [containerWidth, visibleIdx]);
  const frozenOffsets = useMemo(() => frozenLeftOffsets(visibleIdx, flexWidths), [visibleIdx, flexWidths]);

  useLayoutEffect(() => {
    if (editing && editInputRef.current) {
      editInputRef.current.focus();
      // HTMLSelectElement has no .select() (text-selection) method — guard it, or opening a
      // TYPE/UNIT/PER/BASIS cell via double-click/F2 throws instead of opening the dropdown.
      if (editing.selectAll && typeof editInputRef.current.select === "function") editInputRef.current.select();
      // HARDENING-10 NEW-3 — a single click now enters edit immediately; for a choice cell
      // (Type/Unit/Per/Basis) "entering edit" has to mean the menu is already open, or it's still
      // two clicks (focus, then open) to reach a value. `.showPicker()` is the real API for that —
      // feature-detected (Safari < 16.4 lacks it; the select still works, just opens on a second
      // click there) and wrapped, because it throws outside a user-activation window and a
      // `useLayoutEffect` firing after an async commit is not guaranteed to still be inside one.
      if (typeof editInputRef.current.showPicker === "function") {
        try { editInputRef.current.showPicker(); } catch { /* not user-activated, or unsupported here — falls back to a focused, closed select */ }
      }
    }
  }, [editing]);

  useEffect(() => {
    if (!selection) return;
    const el = gridRef.current?.querySelector(`[data-cell="${selection.row}-${selection.col}"]`);
    el?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [selection]);

  // Keep selection in bounds when rows are added/removed (never point at a row that no longer
  // exists) AND when a column that was selected stops being visible (e.g. the only building_sale
  // row is removed and Price/NOI/Cap disappear out from under the selection) — snap to the
  // nearest visible column rather than pointing at a hidden one. Bails out (same `sel` reference)
  // when nothing actually needs to change, so this never fires an extra render on every keystroke
  // just because `rows`/`visibleIdx` are new array instances.
  useEffect(() => {
    setSelectionState((sel) => {
      if (!rows.length) return null;
      if (!sel) return { row: 0, col: visibleIdx[0] ?? 0 };
      const row = clamp(sel.row, 0, rows.length - 1);
      const col = visibleIdx.includes(sel.col) ? sel.col : (visibleIdx[0] ?? 0);
      if (row === sel.row && col === sel.col) return sel;
      return { row, col };
    });
  }, [rows.length, visibleIdx]);

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
    // HARDENING-10 NEW-3 (owner, verbatim: "it shouldn't be type your own, then press control
    // enter or the Apple key plus enter or click add. It should just be enter.") Shift+Enter still
    // inserts a literal newline — the textarea's own native behavior for plain Enter, which this
    // now intercepts instead — so a hand-typed multi-line abstract can still be entered.
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); commitTyped(); }
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
    // A select's value is a fixed option, not typed text — a printable keypress opens the
    // dropdown at its CURRENT value rather than seeding it with the pressed character.
    const startValue = colDef.kind === "select" ? (st.raw ?? "") : initial != null ? initial : (st.raw ?? "");
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
      const nextRows = rows.map((r, i) => (i === target.row ? { ...r, draft: newDraft, cellFlags: nextFlags } : r));
      commitRows(nextRows);
      if (moveDir) {
        const dest = computeDestination({ row: target.row, col: target.col }, moveDir);
        setSelection(dest);
        // HARDENING-10 NEW-3 — "Enter commits and moves down [into edit]. Tab commits and moves
        // right [into edit]." Land the NEXT cell straight into edit mode too, so a fast paste-free
        // entry never needs a second click — mirrors `nextRows` (the just-committed values), not
        // the stale `rows` closure, so a Type edit that changes which columns apply resolves
        // against what the destination row now actually is.
        const destRow = nextRows[dest.row];
        const destColDef = SHEET_COLUMNS[dest.col];
        if (destRow && cellState(destColDef, destRow.draft).state === "editable") beginEdit(dest.row, dest.col, null, true);
      } else {
        setSelection({ row: target.row, col: target.col });
      }
    } else if (moveDir) {
      moveSelectionFrom({ row: target.row, col: target.col }, moveDir);
    } else {
      setSelection({ row: target.row, col: target.col });
    }
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
  // Column movement walks the VISIBLE index list, not a raw +1/-1 on SHEET_COLUMNS — a hidden
  // column (Rule: "hide unused columns entirely") is not a stop Tab/arrows should ever land on.
  // Pure (no state write) so `finishEdit` can compute where Tab/Enter is ABOUT to land and decide
  // whether to re-enter edit mode there, before actually moving the selection.
  const computeDestination = (from, { axis, delta, wrap }) => {
    let { row, col } = from;
    if (axis === "row") {
      row = clamp(row + delta, 0, rows.length - 1);
    } else {
      const pos = visibleIdx.indexOf(col);
      let nextPos = (pos === -1 ? 0 : pos) + delta;
      if (wrap) {
        if (nextPos < 0) { nextPos = visibleIdx.length - 1; row = clamp(row - 1, 0, rows.length - 1); }
        else if (nextPos > visibleIdx.length - 1) { nextPos = 0; row = clamp(row + 1, 0, rows.length - 1); }
      } else {
        nextPos = clamp(nextPos, 0, visibleIdx.length - 1);
      }
      col = visibleIdx[nextPos];
    }
    return { row, col };
  };
  const moveSelectionFrom = (from, opts) => { setSelection(computeDestination(from, opts)); };
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
    // B986096-HARDENING-8 (owner live-tested, "clicking a cell does not focus it") — a <td> has
    // no default focus target, so a plain click never moved DOM focus off the paste textarea;
    // every keystroke kept landing there instead of reaching the grid's own onKeyDown, which is
    // what made the whole sheet read as non-editable ("type 2, it becomes 22" was literally two
    // keystrokes accumulating in the never-blurred paste box, not a grid bug). The grid must hold
    // real focus the instant a cell is clicked, same as finishEdit already restores it after a commit.
    gridRef.current?.focus();
    if (shiftKey && selection && selection.col === col) { extendRangeTo(row); return; }
    setSelection({ row, col });
    // HARDENING-10 NEW-3 (owner measured: a single click only ever focused a bare, non-editable
    // DIV — a double-click was needed to reach an editor at all, "four clicks for one value").
    // ONE click now goes straight to edit for anything editable — a text cell gets a caret, a
    // choice cell opens its menu (via the showPicker effect above). Location stays select-only on
    // a single click (it is an ACTION cell, not text — Enter/double-click still runs the picker,
    // unchanged) so a stray click never arms the map-pick flow by accident.
    const colDef = SHEET_COLUMNS[col];
    if (colDef.kind === "action") return;
    if (cellState(colDef, rows[row].draft).state === "editable") beginEdit(row, col, null, true);
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
      // B986096-HARDENING-8 — "or" read as a choice when Executed and Location are each
      // independently required (validateComp checks both unconditionally); a row missing either
      // (or both) landed on the same wording. "and/or" says a row could be missing one or both,
      // without implying only one is ever needed.
      if (missingCount > 0) parts.push(`${missingCount} missing an Executed date and/or a Location`);
      footerMsg = `${readyRows.length} of ${rows.length} ready — ${parts.join(", ")}.`;
    }
  }

  const [pos, setPos] = useState(() => {
    const w = typeof window !== "undefined" ? window.innerWidth : 1560;
    return { x: Math.max(16, (w - 1560) / 2), y: 60 };
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
        // B986096-HARDENING-9 (owner rule, "take it to near-full viewport") — was 1200px (1191px
        // measured on his 1600px screen after borders), 370px narrower than it needed to be for a
        // sheet whose whole point is not scrolling sideways for important fields.
        position: "fixed", left: pos.x, top: pos.y, width: "min(1560px, calc(100vw - 32px))",
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
            placeholder="Paste a broker email or an Excel block — it parses immediately. Or type your own and press Enter (Shift+Enter for a new line)."
            rows={2}
            style={{ flex: 1, boxSizing: "border-box", padding: "8px 10px", fontSize: 12, borderRadius: 8, fontFamily: "inherit", border: "1px solid var(--border-default)", background: "var(--surface-base)", color: "var(--text-primary)", resize: "vertical" }}
          />
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
            <HeaderRows visibleIdx={visibleIdx} flexWidths={flexWidths} frozenOffsets={frozenOffsets} />
            <tbody>
              {rows.map((row, rowIdx) => (
                <tr key={row._id}>
                  {visibleIdx.map((colIdx) => {
                    const col = SHEET_COLUMNS[colIdx];
                    return (
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
                      locationText={col.key === "location" ? locationCellText(row, overlaysById) : undefined}
                      flexWidths={flexWidths} frozenOffsets={frozenOffsets}
                    />
                    );
                  })}
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
