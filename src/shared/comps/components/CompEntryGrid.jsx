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
import { emptyDraft, draftToComp, validateComp, validAnchor, summarizeLeaseComps, summarizeSaleComps, resolveCapTriangle } from "../lib/comps.js";
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

// B986096-HARDENING-20 — the ONE type scale every grid CELL's text-bearing element reads: the
// display span, the Location action button, and every open editor (input/select). A <span>
// naturally inherits font from its ancestors; a bare <button>/<input>/<select> does NOT (the
// browser gives form controls their own UA font), so before this constant existed the Location
// button silently fell through to the ancestor <table>'s own default (16px, since nothing between
// them ever set a font-size) instead of the grid's 12px. Every cell reads this constant now, so
// the value can't drift out of step with itself a second time.
const CELL_FONT_SIZE = 12;
const CELL_LINE_HEIGHT = `${ROW_H}px`;
// The row-remove icon and the panel's own header Close icon are chrome (not a grid cell), sized
// deliberately larger than body text for a comfortable click target — but still ONE named
// constant, so the two ✕ glyphs in this panel share a real decision instead of two independently
// hand-typed literals (13 and 14) that had drifted apart with nothing tying them together.
const CLOSE_ICON_FONT_SIZE = 13;

// HARDENING-12 — the bottom-docked panel's remembered height (device-local, not per-plan; see
// the dockHeight state in CompEntryGrid for why this is a dock rather than a free x/y position).
const DOCK_HEIGHT_KEY = "planyr:compEntryDockHeight";
const DOCK_HEIGHT_DEFAULT = 340;
const DOCK_HEIGHT_MIN = 200;
const DOCK_HEIGHT_MAX = 760;

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
  onMouseDown, onDoubleClick, onEditChange, onSelectEditChange, onEditKeyDown, onEditBlur, editInputRef, locationText,
  flexWidths, frozenOffsets }) {
  const st = cellState(col, draft);
  const flagKey = col.flagKey ? col.flagKey(draft) : col.key;
  const flag = cellFlags[flagKey];
  const muted = st.state === "na" || st.state === "derived";
  const w = widthFor(col, flexWidths);
  const tdStyle = {
    height: ROW_H, boxSizing: "border-box", padding: 0,
    width: w, minWidth: w, maxWidth: w,
    // B986096-HARDENING-20 — the two-row sticky header (HeaderRows, GROUP_BAND_H + COL_LABEL_H
    // tall) sits on top of the scroll container's content, not inside its scrollable flow. Any
    // scroll-into-view — the browser's own for a focused/clicked cell near the top, or a script's
    // — only knows the container's raw client area, not that the header visually covers the top
    // slice of it, so it can (and, measured, reliably does) land a target row with its top edge
    // hidden BEHIND the sticky header while still reporting itself "in view." A click landing in
    // that band then hits the header, not the cell, with no error anywhere — reproduced with a
    // plain Playwright `.click()` (its own standard actionability scroll, not a synthetic one)
    // timing out after retrying against "<th title=\"Executed\">…</th> intercepts pointer events"
    // on a grid tall enough to need scrolling. `scroll-margin-top` is the standard fix for exactly
    // this sticky-header class of bug: it tells every scroll-into-view mechanism (native focus,
    // keyboard nav, Tab, or an automation driver) to leave clearance for the header rather than
    // scrolling a row flush to the container's raw top edge.
    scrollMarginTop: GROUP_BAND_H + COL_LABEL_H,
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
      fontSize: CELL_FONT_SIZE, textAlign: col.align,
    };
    if (col.kind === "select") {
      return (
        <td style={tdStyle} data-cell={`${rowIdx}-${colIdx}`}>
          <select
            ref={editInputRef}
            value={editValue}
            // HARDENING-13 — a select commits the instant its value changes; see
            // onSelectEditChange's own header in the parent for why this differs from the plain
            // text/number input's onEditChange (which only tracks in-progress typing).
            onChange={(e) => { onSelectEditChange(e.target.value); }}
            onKeyDown={onEditKeyDown}
            onBlur={(e) => onEditBlur(e, rowIdx, colIdx)}
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
          onBlur={(e) => onEditBlur(e, rowIdx, colIdx)}
          style={inputStyle}
        />
      </td>
    );
  }
  const textStyle = {
    display: "block", height: "100%", lineHeight: CELL_LINE_HEIGHT, padding: "0 5px", boxSizing: "border-box",
    fontSize: CELL_FONT_SIZE, fontWeight: 400, textAlign: col.align, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
    fontVariantNumeric: col.align === "right" ? "tabular-nums" : undefined,
    color: st.state === "na" ? "var(--text-tertiary)" : st.state === "derived" ? "var(--text-secondary)" : flag?.level === "blocking" ? "var(--danger-text)" : "var(--text-primary)",
    fontStyle: st.state === "na" ? "italic" : "normal",
  };
  // B986096-HARDENING-9 — the Location cell shows real information once an anchor is set (an
  // address / an APN / a plan title, resolved by `locationCellText` in the parent), never a bare
  // confirmation of the click. Empty state keeps the "Set" affordance.
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
  // ⛔ HARDENING-12 (B986096, owner P0 live-test) — an ACTION cell (Location) is a real, focusable
  // `<button>` now, not a bare `<span>` inside a `<td>` — the owner tested it with
  // `cell.querySelector('button')` and `role`/`tabindex` reads, and it was none of those. A real
  // button gets Tab-reachability, Enter/Space activation, and the repo's global
  // `button:focus-visible` ring (index.css) for free — no bespoke focus styling needed here.
  // `onMouseDown` (renamed `onMouseDown` prop) already arms the row on the FIRST click as of this
  // round (`onCellMouseDown` in the parent) — a double-click still works too (`onDoubleClick`
  // below), since re-arming an already-armed row, or re-focusing an already-anchored one, is a
  // harmless no-op.
  if (st.state === "action") {
    return (
      <td style={{ ...tdStyle, padding: 0 }} data-cell={`${rowIdx}-${colIdx}`} title={hoverTitle}>
        <button
          type="button"
          tabIndex={selected ? 0 : -1}
          onMouseDown={(e) => onMouseDown(rowIdx, colIdx, e.shiftKey)}
          onDoubleClick={() => onDoubleClick(rowIdx, colIdx)}
          // B986096-HARDENING-20 — `...textStyle` carries the grid's real font-size/line-height/
          // color; a trailing `font: "inherit"` shorthand used to run AFTER that spread and reset
          // every one of those longhand properties back to "inherit from the ancestor <td>" — which
          // has no font-size of its own, so it kept climbing the tree to the bare <table> (16px).
          // Only `fontFamily` needs the explicit "inherit" a <span> gets for free (a <button> is a
          // form control and does not inherit it by default); `fontWeight` is spelled out too so
          // nothing here depends on the browser's own form-control default agreeing with the grid.
          style={{ ...textStyle, width: "100%", border: "none", background: "transparent", cursor: "pointer", fontFamily: "inherit", fontWeight: 400 }}
        >
          {cellText}
        </button>
      </td>
    );
  }
  return (
    <td style={tdStyle} data-cell={`${rowIdx}-${colIdx}`}
      // ⛔ HARDENING-12 (B986096, owner P0 live-test) — a `<td>`'s content (a plain `<span>`) is
      // not focusable, so on an unmodified mousedown the BROWSER'S OWN default focus behavior
      // (clearing focus, since the mousedown target isn't a focusable element) ran immediately
      // after `beginEdit` mounted the cell's `<input>` and moved focus there — the input's own
      // `onBlur` then fired `finishEdit`, closing the edit the same click opened it, before any
      // typed character could land. `preventDefault()` here is the standard fix (every grid
      // library with click-to-edit cells does this) — it suppresses the browser's own default
      // mousedown action WITHOUT touching our own explicit `.focus()` calls, which still run.
      tabIndex={selected ? 0 : -1}
      onMouseDown={(e) => { e.preventDefault(); onMouseDown(rowIdx, colIdx, e.shiftKey); }}
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

  // ⛔ HARDENING-14 (B986096, owner P0 live-test, "focusable elements in the entire table: 2 ...
  // Cells need to be focusable so the grid can be driven from the keyboard end to end") — a roving
  // tabindex: the SELECTED cell carries `tabIndex={0}` (a real Tab stop), every other cell carries
  // `tabIndex={-1}` (programmatically focusable, never a stop on the page's own Tab order — the
  // same pattern Excel Online / Google Sheets use, so Tab still only needs to move focus INTO and
  // OUT OF the grid as one stop; arrow keys move the selection). This effect is what makes DOM
  // focus actually FOLLOW selection rather than staying on the grid's outer container `<div>` —
  // `onGridKeyDown` still fires regardless of which descendant holds focus (keydown bubbles), so
  // this changes what `document.activeElement` reports, not what arrow/Tab/Enter already did.
  useEffect(() => {
    if (!selection) return;
    const cellEl = gridRef.current?.querySelector(`[data-cell="${selection.row}-${selection.col}"]`);
    cellEl?.scrollIntoView({ block: "nearest", inline: "nearest" });
    // Only steal DOM focus when it's already somewhere INSIDE the grid (a click on a cell, an
    // arrow/Tab keypress, or finishEdit's own `gridRef.current?.focus()` after a commit) — never
    // when a fresh paste just created rows while the paste textarea still holds focus. Without this
    // guard, committing a paste (which sets `selection` but leaves focus in the textarea) yanked
    // focus into the sheet, so a SECOND paste landed on the grid's own Excel-style spill-paste
    // instead of the textarea's smart-parse — breaking "paste several comps in a row."
    if (!editing && gridRef.current?.contains(document.activeElement)) {
      // The Location cell's focusable element is the <button> nested inside its <td> (buttons are
      // natively focusable without a tabIndex prop); every other cell's tabIndex lives on the <td>
      // itself.
      const focusEl = cellEl?.querySelector("button") || cellEl;
      focusEl?.focus?.();
    }
  }, [selection, editing]);

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
  // B986096-HARDENING-19 — `draftOverride` lets a caller that already holds a FRESHER draft than
  // `rows` (the render closure) seed the editor from it. `finishEdit`'s own auto-reopen is exactly
  // that caller: it just committed `nextRows` via `commitRows`, but `commitRows` is a `setState` —
  // `rows` itself won't reflect it until the next render — so reading `rows[row].draft` here would
  // seed the freshly reopened editor from the STALE, pre-commit value. That was invisible whenever
  // the reopened destination was a genuinely different cell (its own value never changed by this
  // commit), but for a REOPEN ONTO THE SAME CELL — Enter on a single-row grid, or on the last row,
  // where `computeDestination`'s row-axis clamp has nowhere else to go — it silently redisplayed
  // the value the user had just typed OVER, and a subsequent click-away (a natural next action once
  // the value already looks committed) recommitted that stale value, reverting the edit outright.
  const beginEdit = (row, col, initial, selectAll, draftOverride) => {
    const colDef = SHEET_COLUMNS[col];
    if (colDef.kind === "derived" || colDef.kind === "action") return;
    const st = cellState(colDef, draftOverride || rows[row].draft);
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
    let reopened = false;
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
        // against what the destination row now actually is. (HARDENING-19: this eligibility check
        // always read `nextRows` correctly — it's `beginEdit`'s own VALUE SEEDING below that read
        // stale `rows` until now; see `draftOverride`.)
        const destRow = nextRows[dest.row];
        const destColDef = SHEET_COLUMNS[dest.col];
        // B986096-HARDENING-19 — WHEN `dest` CLAMPS BACK TO THE SAME CELL (a single-row grid, or
        // Enter on the LAST row — computeDestination's row-axis clamp has nowhere else to go), the
        // trailing `gridRef.current?.focus()` below used to run unconditionally, synchronously
        // stealing DOM focus from the OLD, still-mounted `<input>` before React ever committed this
        // reopen. That synchronous focus-out fires the old input's real `onBlur` — bound to this
        // exact (row, col) — INSIDE this same call stack, and because HARDENING-17's guard only
        // checks "does this blur's (row, col) still match the current session", a same-cell reopen
        // is a false positive: it looks current (same coordinates) but is actually the brand-new
        // session `beginEdit` just opened. That let a second `finishEdit` fire re-entrantly, closing
        // the reopen it was nested inside and — via HARDENING-15/16's own "trust the blurring
        // input's live DOM value" fallback — re-committing whatever the OLD input's DOM still held.
        // Root-caused with an instrumented `editing`-state trace: the destination showed "editable",
        // `beginEdit` genuinely ran, `setEditing({...})` was genuinely called — and the cell still
        // rendered closed, because a second, re-entrant `setEditing(null)` from that nested
        // `finishEdit` call was the LAST write in the same React 18 batch. `beginEdit`'s own
        // `useEffect([editing])` already focuses (and selects) the freshly reopened input the moment
        // React commits it, so this trailing focus-the-grid call was never needed on a reopen in the
        // first place — skipping it here removes the only thing that blurred the old input
        // synchronously, closing the whole class rather than special-casing "same cell."
        if (destRow && cellState(destColDef, destRow.draft).state === "editable") {
          beginEdit(dest.row, dest.col, null, true, destRow.draft);
          reopened = true;
        }
      } else {
        setSelection({ row: target.row, col: target.col });
      }
    } else if (moveDir) {
      moveSelectionFrom({ row: target.row, col: target.col }, moveDir);
    } else {
      setSelection({ row: target.row, col: target.col });
    }
    if (!reopened) gridRef.current?.focus();
  };

  const onEditChange = (v) => { editValueRef.current = v; setEditValue(v); };
  // ⛔ HARDENING-13 (B986096, owner P0 live-test, "changing Type does not rebuild the column
  // set") — the column-set reactivity itself was never broken (`visibleColumnIndices` already
  // recomputes off `rows` on every change); a SELECT cell's change never actually REACHED `rows`
  // until something else blurred it, because `onEditChange` alone only updates the in-progress
  // edit value, same as a text field mid-typing. That's the right contract for a text field (more
  // characters may still be coming) but wrong for a select — picking an option IS the complete,
  // deliberate action, there's nothing further to type. Measured live: Tab immediately after
  // picking an option (a natural next move) failed to commit at all — the native OS picker
  // `.showPicker()` opens on entry apparently still owns the keystroke — so a real next action
  // could silently leave the picked value uncommitted with no visible sign anything was wrong.
  // A select now commits the instant its value changes, closing that gap outright rather than
  // depending on whatever the user happens to do next.
  const onSelectEditChange = (v) => { editValueRef.current = v; setEditValue(v); finishEdit(true, null); };
  const onEditKeyDown = (e) => {
    // B986096-HARDENING-19 — a REAL, trusted Enter/Tab is dispatched to `onEditKeyDown` TWICE: once
    // by HARDENING-15's native, target-attached listener (AT_TARGET, fires first) and once by
    // React's own `onKeyDown` prop below (bubble phase, fires after — a real keypress genuinely
    // bubbles). `finishEdit`'s `editHandledRef` guard was meant to make the second call a safe
    // no-op, but `beginEdit`'s auto-reopen (HARDENING-10 NEW-3) resets that SAME ref to `false` for
    // the freshly-opened session — so whenever the first call's commit lands on an editable
    // destination (the common case), the guard is disarmed again before the second call arrives,
    // and that second call re-fires `finishEdit` for the NEW session with `editValueRef.current`
    // still holding whatever `beginEdit` just seeded it with, silently overwriting the value the
    // user just typed. Measured with an instrumented trace: typing "5/1/26" over an existing
    // "3/14/26", pressing Enter once, produced TWO `finishEdit` commits — the second re-applying a
    // stale value onto the row the first commit had just corrected. Deduping on `editHandledRef`
    // can't fix this without breaking the reopen's own future commit (that ref legitimately needs
    // to be armed again for the NEW session). The actual duplicate is two listeners observing the
    // SAME physical key event, so dedupe on the EVENT itself — `e.nativeEvent` for React's call and
    // the bare event for the native listener's call are the identical underlying object for a real
    // dispatch, so stamping it here makes the second call a genuine no-op regardless of what
    // `editHandledRef` does in between. A synthetic, non-bubbling dispatch (SYNTHETIC-KEYS-DONT-EDIT
    // territory, and CYCLE 5's own reproduction) only ever reaches one listener, so it stamps and
    // returns exactly once — zero behavior change there.
    const native = e.nativeEvent || e;
    if (native.__compGridKeyHandled) return;
    native.__compGridKeyHandled = true;
    if (e.key === "Enter") { e.preventDefault(); finishEdit(true, { axis: "row", delta: 1 }); }
    else if (e.key === "Tab") { e.preventDefault(); finishEdit(true, { axis: "col", delta: e.shiftKey ? -1 : 1, wrap: true }); }
    else if (e.key === "Escape") { e.preventDefault(); finishEdit(false, null); }
  };
  // ⛔ HARDENING-15 (B986096, owner cycle-5 P0, "Enter still discards, 5th cycle — root-caused
  // this time") — React's `onKeyDown` prop is BUBBLE-PHASE and ROOT-DELEGATED (React 17+ attaches
  // one native listener at the app root, not on each element), so it only fires once the native
  // keydown event actually BUBBLES back up to that root. A real keypress always bubbles; the
  // `KeyboardEvent` constructor's OWN default is `bubbles: false`, so a synthetic test event built
  // without explicitly setting `bubbles: true` never reaches `onEditKeyDown` at all — the
  // already-named SYNTHETIC-KEYS-DONT-EDIT trap, and the reason 4 prior rounds' "add an Enter
  // branch" fixes never moved the owner's own reproduction. **The owner's cycle-5 A/B/C isolation
  // is the proof, read precisely: Tab (Run A) "commits" NOT via this handler's Tab branch — the
  // native Tab keydown's DEFAULT ACTION (browser-built-in focus-move to the next tabbable element)
  // fires regardless of `bubbles` (default actions occur at dispatch time, independent of the
  // bubble phase), and THAT focus loss fires a genuine native `focusout`, which — unlike a
  // synthetic KeyboardEvent — bubbles UNCONDITIONALLY by spec no matter what caused it. So Run A
  // actually commits through `onEditBlur`, not through this Enter/Tab branch at all — and Run C
  // (Enter) has no such native side-effect to fall back on, so it silently reaches nothing.** A
  // capture-phase listener on an ancestor "confirming the keydown is observed" is fully consistent
  // with this, not evidence against it: capture-phase dispatch walks DOWN to the target regardless
  // of `bubbles` (only the BUBBLE-phase return trip is skipped for a non-bubbling event), so an
  // ancestor capture listener sees the event while React's root-delegated bubble-phase listener on
  // the same target never does.
  // THE FIX: a plain native `addEventListener("keydown", ...)` attached DIRECTLY on the editing
  // input/select element itself. Per the DOM dispatch algorithm, a listener registered on the
  // TARGET element fires at the AT_TARGET phase unconditionally — regardless of `bubbles` and
  // regardless of the `capture` flag used to register it — because AT_TARGET always happens; only
  // the phases before/after it (capturing down from the root, bubbling back up) depend on the
  // event's own properties. This makes Enter/Tab/Escape work correctly for ANY dispatch, synthetic
  // or real, closing the class outright rather than re-explaining it a sixth time. Zero behavior
  // change for a genuine keypress: it already reached `onEditKeyDown` via React's normal bubble
  // delegation, so this listener fires FIRST (AT_TARGET precedes the later bubble phase) and
  // `finishEdit`'s existing `editHandledRef` guard makes the ensuing second (React) call from that
  // same real keypress a safe no-op — the guard already existed for exactly this kind of
  // double-invocation, unrelated to this fix.
  // A ref, not the function itself, is what the listener below actually calls — attaching the
  // listener only happens when `editing` toggles, but `rows` (and anything else `onEditKeyDown`/
  // `finishEdit` close over) can change WHILE a cell stays open (e.g. an unrelated row's
  // reverse-geocode resolving mid-edit); routing every call through this ref, reassigned on every
  // render, keeps the native listener from ever acting on a stale closure — the same `*Ref` pattern
  // this file already uses for `rowsRef`/`onRowsChangeRef` above.
  const onEditKeyDownRef = useRef(onEditKeyDown);
  onEditKeyDownRef.current = onEditKeyDown;
  useEffect(() => {
    const el = editInputRef.current;
    if (!editing || !el) return undefined;
    const handler = (e) => onEditKeyDownRef.current(e);
    el.addEventListener("keydown", handler);
    return () => el.removeEventListener("keydown", handler);
  }, [editing]);
  // ⛔ HARDENING-15 (NEW-1, "blur discards the edit") — investigated live under every realistic
  // interaction (a real click on another cell, a real click on the map, a JS `.blur()` call after
  // `execCommand('insertText', …)` typing, both as separate steps and in one synchronous block) and
  // none reproduced a discard — every one committed the typed value correctly. The one thing that
  // DID reproduce it: setting the input's `.value` through the raw property setter WITHOUT
  // dispatching a real `input` event first (bypassing React's `onChange` entirely, so
  // `editValueRef.current` — populated only by `onEditChange` — stays at whatever it was before,
  // and blur commits THAT stale value). That specific technique is inconsistent with this cycle's
  // own Run A (which read back the CORRECTLY typed value via the same "type, then a differentiated
  // final action" setup), so it does not fully explain the report as given — but the class of bug
  // it describes (a value entered without React ever observing it) is real and worth closing
  // regardless of which exact technique produced it here. `onEditBlur` now reads the input's own
  // live DOM value at the moment of blur as a fallback should it ever disagree with the tracked
  // ref, rather than trusting the ref unconditionally — belt-and-suspenders, zero behavior change
  // for the (already-working) real-typing / real-click-away / real-blur-call paths measured above.
  //
  // ⛔ B986096-HARDENING-17 — A LATE BLUR FROM AN ALREADY-SUPERSEDED SESSION MUST NOT COMMIT INTO
  // WHATEVER SESSION REPLACED IT. Root-caused via a ground-truth instrumented trace (console logs
  // on beginEdit/finishEdit/onEditKeyDown, not guessing), not reproducible from code reading alone.
  // Tab/Enter with a `moveDir` commits the current cell, then — per the HARDENING-10 "land the next
  // cell in edit mode" feature — immediately calls `beginEdit` on the DESTINATION cell, which resets
  // the shared `editingRef`/`editHandledRef`/`editValueRef` for the NEW session. React then unmounts
  // the OLD input (replaced by the new one), and the browser fires a native `blur` on it — but that
  // blur fires AFTER `beginEdit` already repointed the shared refs to the new cell. The safety net
  // above (read the blurring input's own live DOM value if it disagrees with the ref) then read the
  // OLD input's leftover typed text, wrote it into `editValueRef` — which `finishEdit` now applies to
  // the NEW session's cell, not the one that was actually blurring. Measured: typing "7/4/26" into
  // Executed, pressing Tab, landed "7,426" on Price (the auto-opened destination) while Executed
  // itself reverted to empty. This is a DIFFERENT defect from every "Enter discards" report this
  // module's history documents — it needs a `moveDir`-triggered auto-reopen onto an EDITABLE
  // destination cell to manifest at all, so it never showed up testing a single commit in isolation.
  // Fix: each `<input>`/`<select>`'s `onBlur` is bound with the (row, col) it was rendered for
  // (`SheetCell`'s own `rowIdx`/`colIdx` props, fixed for that render) — a blur whose (row, col)
  // no longer matches the CURRENTLY active `editingRef.current` belongs to a session that has
  // already been closed and superseded, and is now a pure no-op: no ref mutation, no commit. A
  // genuine, still-current blur (row/col still matches) is untouched — same behavior as before.
  const onEditBlur = (e, forRow, forCol) => {
    if (!editingRef.current || editingRef.current.row !== forRow || editingRef.current.col !== forCol) return;
    const domVal = e?.target?.value;
    if (typeof domVal === "string" && domVal !== editValueRef.current) editValueRef.current = domVal;
    finishEdit(true, null);
  };

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
    // choice cell opens its menu (via the showPicker effect above).
    // ⛔ HARDENING-12 (owner P0 live-test) — Location used to stay select-only on a single click,
    // requiring a double-click to arm the map-pick flow. The owner clicked it four times across
    // two page loads and nothing happened, because there was no visible affordance telling him a
    // SECOND click was needed. A single click now arms immediately, matching every other cell.
    const colDef = SHEET_COLUMNS[col];
    if (colDef.kind === "action") { triggerAction(row, col); return; }
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
      e.preventDefault();
      // HARDENING-16 — a cell reached by keyboard (Tab into the grid, then arrows) and never
      // clicked is SELECTED but not editing, and Enter here used to only move the selection down
      // — silently doing nothing else, which read as "Enter is dead" to a keyboard-only user who
      // had not yet discovered F2. A click already opens the editor immediately (HARDENING-10), so
      // this makes Enter reach the same first-touch state F2 does, rather than requiring a second,
      // undiscoverable key just to start typing.
      if (cellState(colDef, rows[selection.row].draft).state === "editable") {
        beginEdit(selection.row, selection.col, null, true);
      } else {
        moveSelection({ axis: "row", delta: 1 });
      }
      return;
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
  // ⛔ HARDENING-13 (B986096, owner P0 live-test, "the footer used to name the reason, now it
  // just says '1 blocking'") — two fixes. (1) `missingCount` used to EXCLUDE a blocking row, so a
  // row that was BOTH missing a period AND missing Executed/Location silently dropped the second
  // problem from the footer's own summary line entirely (still visible in `ProblemsList` below,
  // but the one-line count is what's glanced at). It now counts ANY row with a validateComp
  // error, blocking or not — a row can appear in both counts. (2) "N blocking" said nothing about
  // WHAT was blocking; there is currently exactly one blocking case (a lease rate with no stated
  // period, the 12x ambiguity) so the count now names it directly.
  const missingCount = rows.filter((r) => validateComp(draftToComp(r.draft)).length > 0).length;
  // B986096-HARDENING-22 (owner live-report, 2026-09-02 — a row correctly missing ONLY a Location
  // read as "did my typed Executed date not save?", costing a real diagnostic round before an
  // instrumented trace showed compDate had been correct the whole time) — the combined "and/or"
  // count named EITHER cause for every row, so a row missing just one read identically to a row
  // missing both. Split into the two independent, single-cause counts HARDENING-8's own comment
  // already established validateComp checks unconditionally, and name each on its own — never
  // combined into one ambiguous phrase — falling back to the original "and/or" wording only for
  // the genuinely-ambiguous case (rows missing both, mixed with rows missing just one).
  const missingDateOnly = rows.filter((r) => !r.draft?.compDate && validAnchor(r.draft?.anchor)).length;
  const missingLocationOnly = rows.filter((r) => r.draft?.compDate && !validAnchor(r.draft?.anchor)).length;
  const missingBoth = missingCount - missingDateOnly - missingLocationOnly;
  let footerMsg = "";
  if (rows.length > 0) {
    if (blockingCount === 0 && missingCount === 0) footerMsg = `${readyRows.length} comp${readyRows.length === 1 ? "" : "s"} ready.`;
    else {
      const parts = [];
      if (blockingCount > 0) parts.push(`${blockingCount} rate${blockingCount === 1 ? "" : "s"} need${blockingCount === 1 ? "s" : ""} a period`);
      if (missingBoth > 0) parts.push(`${missingBoth} missing an Executed date and/or a Location`);
      if (missingDateOnly > 0) parts.push(`${missingDateOnly} missing an Executed date`);
      if (missingLocationOnly > 0) parts.push(`${missingLocationOnly} missing a Location`);
      footerMsg = `${readyRows.length} of ${rows.length} ready — ${parts.join(", ")}.`;
    }
  }

  // ⛔ HARDENING-12 (B986096, owner P0 live-test) — this used to float near the TOP of the
  // viewport at near-full width and up to 88% of the viewport height, which is exactly where the
  // map needs to be clickable for the "arm a row, then click the map" workflow this panel exists
  // to drive. Measured on the owner's own page: the card covered 72% of the map, all of it the
  // TOP, leaving only a sliver at the bottom reachable. It now DOCKS to the bottom edge instead
  // of floating — the map above it stays clickable at any panel height — and the height is a
  // resize handle (drag the top edge) rather than free x/y positioning, since a docked panel has
  // nothing to reposition horizontally. The height is remembered per device (not per plan) so it
  // doesn't reset every time the panel reopens.
  const [dockHeight, setDockHeight] = useState(() => {
    if (typeof window === "undefined") return DOCK_HEIGHT_DEFAULT;
    const saved = Number(window.localStorage?.getItem(DOCK_HEIGHT_KEY));
    return Number.isFinite(saved) && saved > 0 ? saved : DOCK_HEIGHT_DEFAULT;
  });
  const dockHeightRef = useRef(dockHeight);
  dockHeightRef.current = dockHeight;
  const startResize = (e) => {
    if (e.button != null && e.button !== 0) return;
    e.preventDefault();
    const sy = e.clientY;
    const startH = dockHeightRef.current;
    const move = (ev) => {
      const h = typeof window !== "undefined" ? window.innerHeight : 800;
      const next = clamp(startH + (sy - ev.clientY), DOCK_HEIGHT_MIN, Math.min(DOCK_HEIGHT_MAX, h - 80));
      setDockHeight(next);
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      try { window.localStorage?.setItem(DOCK_HEIGHT_KEY, String(dockHeightRef.current)); } catch { /* private mode / quota — height just won't persist */ }
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  const linkBtnStyle = { border: "none", background: "none", color: "var(--accent)", cursor: "pointer", padding: 0, textDecoration: "underline", fontSize: 10.5 };
  const range = currentRange();

  return createPortal(
    <div
      data-comp-entry-panel="1"
      onPointerDown={(e) => e.stopPropagation()}
      style={{
        // B986096-HARDENING-9 (owner rule, "take it to near-full viewport") — was 1200px (1191px
        // measured on his 1600px screen after borders), 370px narrower than it needed to be for a
        // sheet whose whole point is not scrolling sideways for important fields.
        // HARDENING-12 — docked to the BOTTOM edge (see dockHeight's own comment above) rather
        // than floating near the top, so the map above it stays clickable at any height.
        position: "fixed", left: 16, right: 16, bottom: 12, width: "auto",
        height: dockHeight, zIndex: 2600, display: "flex", flexDirection: "column",
        background: "var(--surface-overlay)", border: "1px solid var(--border-default)", borderRadius: 12,
        boxShadow: "0 -8px 28px rgba(28,25,20,0.18), 0 -2px 8px rgba(28,25,20,0.08)", // design-exempt: shadow points UP (the panel sits at the bottom of the viewport) — no shadow token exists yet
      }}>
      <div onPointerDown={startResize} title="Drag to resize"
        style={{ height: 6, margin: "-1px -1px 0", borderRadius: "12px 12px 0 0", cursor: "ns-resize", background: "var(--border-default)" }} />
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 14px", borderBottom: "1px solid var(--border-default)" }}>
        <span style={{ fontSize: 13, fontWeight: 700 }}>New comps</span>
        <button onClick={onCancel} aria-label="Close"
          style={{ border: "none", background: "transparent", color: "var(--text-secondary)", fontFamily: "inherit", fontSize: CLOSE_ICON_FONT_SIZE, cursor: "pointer", padding: 2 }}>✕</button>
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
          {/* HARDENING-12 — "the map stays fully usable" was true only once the panel stopped
              covering the top of it (see the dock change above); now docked to the bottom, the
              map above this panel is clickable. Escape is now a real way out, not just Cancel.
              HARDENING-13 — arming Location now also arms the map's own pin-drop mode (the
              parent's `onArmMapPin`), so the NEXT click on the map is already listening — no
              separate "Drop a pin" click needed first. "Comp from parcel" stays a real
              alternative (anchor to an actual lot instead of a raw point), reached the same way
              it always was, from the map's own toolbar. */}
          Click the map above to drop the pin — or click <strong>Comp from parcel</strong> on the map toolbar to anchor to a lot instead.{" "}
          <button onClick={() => onArm(null)} style={{ border: "none", background: "none", color: "inherit", textDecoration: "underline", cursor: "pointer", padding: 0, marginLeft: 4 }}>Cancel</button>
          {" "}or press Esc.
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
                      onSelectEditChange={onSelectEditChange}
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
                    scrollMarginTop: GROUP_BAND_H + COL_LABEL_H,
                  }}>
                    <button onClick={() => removeRow(row._id)} title="Remove" aria-label="Remove comp"
                      style={{ border: "none", background: "transparent", color: "var(--danger-text)", fontFamily: "inherit", cursor: "pointer", fontSize: CLOSE_ICON_FONT_SIZE, padding: 0, lineHeight: CELL_LINE_HEIGHT }}>✕</button>
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
