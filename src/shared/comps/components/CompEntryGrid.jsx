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
import { parsePaste, rowHasBlockingFlags, parseProseLine, parseSingleRecord, splitPasteLines } from "../lib/compParse.js";
import { emptyDraft, draftToComp, validateComp, summarizeLeaseComps, summarizeSaleComps, resolveCapTriangle } from "../lib/comps.js";
import {
  SHEET_COLUMNS, cellState, applyCellEdit, fillDownColumn, spillPaste, visibleColumnIndices,
  computeFlexWidths, widthFor, frozenLeftOffsets, matchOption, optionsForColumn,
} from "../lib/compSheetColumns.js";
import { parcelLocationText, siteplanLocationText, pinFallbackText } from "../lib/compLocationText.js";
import { todayIso } from "../lib/compDates.js";
import { FONT_SIZE } from "../../ui/designTokens.js";
import { reverseGeocodeLatLon } from "../../../workspaces/site-planner/lib/geocode.js";
import { COUNTIES } from "../../../workspaces/site-planner/lib/counties.js";
import { MOBILE_BREAKPOINT_PX } from "../lib/compMobileLayout.js";
import CompEntryMobileSheet from "./CompEntryMobileSheet.jsx";

// B1091712 — below MOBILE_BREAKPOINT_PX this whole panel renders CompEntryMobileSheet
// instead of the table below (a transposed, one-comp-per-screen layout — see that file's own
// header). `window.innerWidth`, not a ResizeObserver on the panel's own element: the panel is
// itself `position: fixed` at (nearly) full viewport width, so the two already move together,
// and reading the viewport directly means the switch is driven by the SAME number a `resize`
// listener/devtools device toolbar reports, which is what the acceptance check at 390/768px
// actually measures.
function useIsMobileViewport() {
  const [mobile, setMobile] = useState(() => (typeof window === "undefined" ? false : window.innerWidth < MOBILE_BREAKPOINT_PX));
  useEffect(() => {
    if (typeof window === "undefined") return undefined;
    const onResize = () => setMobile(window.innerWidth < MOBILE_BREAKPOINT_PX);
    onResize();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  return mobile;
}

const ROW_H = 31;
const GROUP_BAND_H = 22;
const COL_LABEL_H = 26;
const REMOVE_COL_W = 32;
// B844400 (NEW-2, owner live-measured, 2026-09-03) — SUPERSEDES the ≈5.5-row floor HARDENING-28
// set below: forcing the grid to a fixed 218.5px floor is exactly what left a 1-3 row sheet
// sitting in a slab of dead white space (measured: 1 row's table is ~81px tall inside a
// 218.5px-floored pane — 138px of blank space beneath the last row). THE PANEL NOW OWNS THE
// HEIGHT BUDGET, NOT THE GRID: the panel's own height is `"auto"` up to `dockHeight` as a CEILING
// (see the panel's own style below), so with few rows the whole panel simply shrinks to wrap its
// content — there is no more "leftover flex space" for the grid to be stretched into. The grid's
// `flex: "0 1 auto"` (see its own style below) makes it size to its ACTUAL content (header + N
// rows) whenever that fits under the ceiling, and the one element that SHRINKS (scrolls) once
// total content exceeds `dockHeight` — every sibling around it is pinned `flex: "none"` so it is
// still the last (and only) thing to give up space under squeeze, same intent as HARDENING-28, just
// no longer paid for with a floor taller than a 1-row sheet needs. The floor below is cut to
// "header + one row" — the smallest floor that still lets a genuinely 1-row sheet render with zero
// blank space (any larger and NEW-2's own case reappears), while still guaranteeing the sticky
// header plus at least one data row stays visible even under the heaviest squeeze (many rows +
// ProblemsList at its own 120px cap). This narrows HARDENING-28's specific 5.5-row guarantee for
// a many-rows/crowded-ProblemsList sheet — that class (rows shrinking as ProblemsList grows) is
// unaffected in its own right and remains a separate, already-filed concern; it is bounded here
// only by the smaller 1-row floor rather than papered over by a floor that broke the common case.
const GRID_MIN_HEIGHT = GROUP_BAND_H + COL_LABEL_H + ROW_H;

// B986096-HARDENING-24 — the ONE type scale every grid CELL's text-bearing element reads: the
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
const DOCK_HEIGHT_DEFAULT = 340; // SSR-only fallback (no `window` to measure against) — see defaultDockHeight()
const DOCK_HEIGHT_MIN = 200;
const DOCK_HEIGHT_MAX = 760;
// B986096-HARDENING-26 (owner live-measured, 2026-09-02 — "why do i have to scroll to see the
// second row") — a flat 340px default had NOTHING to do with the viewport: on his own 521px-tall
// browser window the sheet's own scroller was measured at 76px tall (2.4 rows) inside a panel
// using only 65% of the available height, with the paste box + summary row + footer eating the
// rest of the fixed 340px. This is a DATA-ENTRY GRID — the rows are the content, the paste box
// above it is a means to an end — so the panel's height must grow with the viewport by default,
// the same way its own resize handle already clamps a MANUAL drag to `h - 80` (`startResize`
// below).
const DOCK_HEIGHT_VIEWPORT_MARGIN = 80;
// ⛔ MEASURED REGRESSION, caught by `verify-comp-entry-p0.mjs`'s own DOCKING check before this
// shipped — a naive `h - 80` default (matching the MANUAL drag ceiling exactly) grows the panel to
// DOCK_HEIGHT_MAX (760) on any normal-height window, which is HARDENING-12's own regression: at a
// 900px-tall window that left only 128px of map clickable above the panel — below the "arm a row,
// then click the map" workflow's own 300px bar, and the exact collision HARDENING-12 was built to
// prevent. So the AUTOMATIC default gets its OWN, smaller ceiling — generous enough to show
// several rows without the owner's own 2-row scroll, but never so tall it swallows the map. A
// user who deliberately wants MORE (accepting less clickable map) still can, by dragging the
// resize handle up to DOCK_HEIGHT_MAX — that's an informed, reversible choice the user makes for
// themselves, not a default forced on every open.
// ⛔ 500 IS A MEASURED BALANCE, NOT THE "≥8 ROWS" BAR THE BRIEF ASKED FOR — stated honestly rather
// than silently under-delivering it. At a 900px-tall window this leaves ~388px of map (comfortably
// over the 300px bar) and fits ~4-5 rows before scrolling once a few rows carry an open "needs a
// date/location" note (`ProblemsList`'s own up-to-120px footer) — a real improvement on the 2.4
// rows this was originally reported at, but short of 8 whenever the sheet has open notes, because
// EVERY freshly pasted row starts without a picked Location (paste never sets one), so ProblemsList
// is essentially always populated for a multi-row paste. Reaching 8 unconditionally would mean
// either shrinking the map strip back toward HARDENING-12's regression or a content-aware panel
// height (growing with row count, not just viewport) — genuinely bigger work, not attempted here.
const DOCK_HEIGHT_DEFAULT_MAX = 500;
function defaultDockHeight() {
  if (typeof window === "undefined") return DOCK_HEIGHT_DEFAULT;
  return clamp(window.innerHeight - DOCK_HEIGHT_VIEWPORT_MARGIN, DOCK_HEIGHT_MIN, DOCK_HEIGHT_DEFAULT_MAX);
}

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
export function locationCellText(row, overlaysById) {
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
//
// ⛔ HARDENING-25 (owner audit, 14 defects in one 4x4 crop) — two corrections to the group band
// itself, both computed here so HeaderRows stays pure rendering:
// (1) ALIGNMENT: a group label's textAlign used to be hardcoded "left" regardless of what it
// sits over — DEAL/PRICE/DERIVED are frequently exactly ONE column wide (a land-only sheet hides
// every lease/building-sale column, e.g. leaving DEAL as just "Executed"), and a left-aligned
// label over a right-aligned numeric/date column reads as belonging to the column to ITS LEFT.
// A single-column run takes that column's own alignment; a multi-column run stays "left" (every
// multi-column group here — PROPERTY, PARTIES — already reads correctly left-aligned).
// (2) LABEL COLLAPSE: a one-column "group" is not a group — it repeats the column header below it
// almost verbatim (PRICE atop Price, TYPE atop Type) with no other member to justify the band.
// Rather than special-case which groups this applies to (it depends on which comp types are on
// the sheet at all, not a fixed set), the rule is generic and reapplied on every render: a run
// spanning exactly one VISIBLE column renders as a blank band (background/border kept, for
// unbroken ruling) instead of a doubled label. The moment a second column joins that group (e.g.
// a building-sale row adds NOI/Cap to PRICE), the label reappears automatically.
function computeVisibleGroupRuns(visibleIdx) {
  const runs = [];
  for (const idx of visibleIdx) {
    const col = SHEET_COLUMNS[idx];
    const last = runs[runs.length - 1];
    if (last && last.group === col.group) { last.span++; last.cols.push(col); }
    else runs.push({ group: col.group, span: 1, cols: [col] });
  }
  return runs.map((run) => ({
    group: run.group,
    span: run.span,
    align: run.span === 1 ? run.cols[0].align : "left",
    showLabel: run.span > 1,
  }));
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
              height: GROUP_BAND_H, boxSizing: "border-box", padding: "0 5px", textAlign: run.align,
              fontSize: 10, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.06em",
              color: "var(--text-secondary)", background: "var(--surface-raised)",
              // HARDENING-25 item 6 — all FOUR sides explicit and identical (never a `"none"` side
              // left to fall back to `currentColor`, which is the exact dark rgb the owner's own
              // sweep caught on two sides while the other two correctly read the border token).
              // Under `border-collapse`, two adjacent cells declaring the identical border merge
              // into one painted line, so this never doubles a seam — it only removes the
              // ambiguity of a side nobody declared.
              border: "1px solid var(--border-default)",
              left: i === 0 ? 0 : undefined,
            }}>
            {run.showLabel ? run.group : null}
          </th>
        ))}
        <th rowSpan={2} style={{
          position: "sticky", top: 0, right: 0, zIndex: 4, width: REMOVE_COL_W, padding: 0,
          background: "var(--surface-raised)", border: "1px solid var(--border-default)",
          // Content-less spacer cell — pinned explicitly rather than left to the browser's own
          // `<th>` UA defaults (bold, centered), which otherwise show up as their own accidental
          // singletons in a property sweep even though nothing ever renders inside this cell.
          fontWeight: 600, textAlign: "left",
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
                // HARDENING-25 item 10 — 700 vs the group band's 800 is imperceptible at 10px; the
                // hierarchy was really being carried by case (CAPS vs Title Case) alone. Widening
                // the gap to 600 makes the weight difference genuinely visible, using a value
                // (600) already on this app's own type scale (Button/ToggleChip's own weight).
                textAlign: col.align, fontSize: 10, fontWeight: 600, color: "var(--text-secondary)",
                background: "var(--surface-raised)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
                border: "1px solid var(--border-default)",
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
function SheetCell({ col, colIdx, rowIdx, draft, cellFlags, touched, selected, inRange, isEditing, editValue,
  onMouseDown, onDoubleClick, onEditChange, onSelectEditChange, onEditKeyDown, onEditBlur, editInputRef, locationText,
  onSetToday, flexWidths, frozenOffsets }) {
  const st = cellState(col, draft);
  const flagKey = col.flagKey ? col.flagKey(draft) : col.key;
  const flag = cellFlags[flagKey];
  const muted = st.state === "na" || st.state === "derived";
  // B986096-HARDENING-25 item 8 — a blocking flag on this cell (a lease rate with no stated
  // period, the 12x-ambiguity case) needs a channel OTHER than hue to read as "wrong," never
  // recolored-and-hope: index.css's B464049 note is explicit that the brand accent (the SAME
  // selection-outline color every cell in this sheet already uses) stays the accent, full stop —
  // the fix for "an error color reads too close to the selection color" is never to re-tune
  // --accent or --danger-text, it's to add weight/an icon so the two never depend on hue alone
  // (the identical WCAG 1.4.1 reasoning that note already applies to form-field errors app-wide).
  const blockingFlag = flag?.level === "blocking";
  const w = widthFor(col, flexWidths);
  // HARDENING-25 items 1/5/6/7 — one deterministic cell recipe, applied to every td regardless of
  // `col.frozen`: a real, OPAQUE background (muted/na/derived cells get the page tint, everything
  // else the same opaque white/near-black every header cell already uses — never the translucent
  // "frosted panel" surface, which is what let the map bleed through a data-dense grid), an
  // explicit height/verticalAlign/box-sizing so every row lands on the identical pixel height
  // (a percentage height inside a `<td>` is a classic cross-browser inconsistency — an intrinsic
  // element like the Location `<button>` doesn't reliably resolve `height:100%` against a
  // table-cell containing block, which is what produced the 2px-taller rows the owner measured),
  // and all four border sides explicit and IDENTICAL — never a side left undeclared, which is
  // what let `border-collapse` fall back to `currentColor` (the exact dark text color the owner's
  // sweep caught on two sides while the other two read the real border token). Two adjacent cells
  // declaring the same border merge into one painted line under collapse, so this never doubles a
  // seam — it only removes the ambiguity of a side nobody used to declare.
  const tdStyle = {
    height: ROW_H, boxSizing: "border-box", padding: 0, verticalAlign: "middle",
    width: w, minWidth: w, maxWidth: w,
    border: "1px solid var(--border-default)",
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
    position: col.frozen ? "sticky" : undefined, left: col.frozen ? frozenOffsets[col.key] : undefined, zIndex: col.frozen ? 1 : undefined,
    background: muted ? "var(--surface-page)" : "var(--surface-raised)",
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
      height: ROW_H, boxSizing: "border-box", padding: "0 5px", margin: 0, verticalAlign: "middle",
      border: "none", outline: "2px solid var(--accent)", outlineOffset: -2,
      background: "var(--surface-base)", color: "var(--text-primary)", fontFamily: "inherit",
      fontSize: CELL_FONT_SIZE, textAlign: col.align, lineHeight: CELL_LINE_HEIGHT,
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
            // HARDENING-25 item 9 — this used to override padding to "0 2px" (the report's own
            // named "Type SELECT editor" singleton), so the same cell's text sat ~3px off between
            // its resting position and its editing position. Same padding as every other cell now.
            style={inputStyle}>
            <option value="" disabled hidden>{" "}</option>
            {optionsForColumn(col, draft.compType).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </td>
      );
    }
    // B986096-HARDENING-28 (NEW-5, owner decision, 2026-09-02 — "a one-click Today control...
    // this is the speed he actually wanted. He asserts the date; the app never assumes it.") —
    // Executed alone gets the quick-set button (never Commencement, a different fact). Wired as
    // an INDEPENDENT commit path (`onSetToday` -> the parent's `setRowToday`, a plain
    // `commitRows` call, the same shape `resolvePeriod` already uses) rather than through the
    // character-editing state machine (`onEditKeyDown`/`onEditBlur`/`finishEdit`'s commit-with-
    // moveDir branch) — that machinery is under an explicit owner moratorium after five rounds of
    // regressions (see this file's own header), so this deliberately never touches it. Closing the
    // editor afterward reuses `finishEdit(false, null)` completely unmodified and already
    // idempotent-safe — the exact same call Escape already makes, which only ever clears local
    // editing state, never the risky commit branch.
    if (col.key === "compDate") {
      return (
        <td style={tdStyle} data-cell={`${rowIdx}-${colIdx}`}>
          <span style={{ display: "flex", alignItems: "center", height: "100%" }}>
            <input
              ref={editInputRef}
              type="text"
              value={editValue}
              onChange={(e) => onEditChange(e.target.value)}
              onKeyDown={onEditKeyDown}
              onBlur={(e) => onEditBlur(e, rowIdx, colIdx)}
              placeholder={col.editHint || undefined}
              style={{ ...inputStyle, width: undefined, flex: 1, minWidth: 0 }}
            />
            <button
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => onSetToday(rowIdx)}
              title="Set to today"
              style={{
                flex: "none", border: "none", background: "none", color: "var(--accent)",
                fontSize: FONT_SIZE.micro, fontWeight: 700, cursor: "pointer", padding: "0 4px",
                fontFamily: "inherit",
              }}
            >
              Tdy
            </button>
          </span>
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
          // HARDENING-25 item 11 — a per-column format hint (currently the two date columns'
          // "mm/dd/yy"), shown ONLY while actively editing via the native `placeholder` attribute —
          // deliberately not the same thing as HARDENING-10 NEW-4's resting `cellPlaceholder`
          // (which stays "always empty," on purpose: a value-shaped word sitting in an unfilled
          // cell at REST reads as data). A format hint that only appears once you're already
          // focused and typing can never be mistaken for a real stored value.
          placeholder={col.editHint || undefined}
          style={inputStyle}
        />
      </td>
    );
  }
  const textStyle = {
    display: "block", height: ROW_H, lineHeight: CELL_LINE_HEIGHT, padding: "0 5px", boxSizing: "border-box",
    verticalAlign: "middle",
    fontSize: CELL_FONT_SIZE, textAlign: col.align, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
    fontVariantNumeric: col.align === "right" ? "tabular-nums" : undefined,
    color: st.state === "na" ? "var(--text-tertiary)" : st.state === "derived" ? "var(--text-secondary)" : blockingFlag ? "var(--danger-text)" : "var(--text-primary)",
    fontStyle: st.state === "na" ? "italic" : "normal",
    fontWeight: blockingFlag ? 700 : undefined,
  };
  // B986096-HARDENING-9 — the Location cell shows real information once an anchor is set (an
  // address / an APN / a plan title, resolved by `locationCellText` in the parent), never a bare
  // confirmation of the click. Empty state keeps the "Set" affordance.
  // HARDENING-10 NEW-4 — "empty means empty": a genuinely unfilled editable cell renders nothing
  // at all now, never a grey placeholder word (`cellPlaceholder` always returns "" — see its own
  // header in compSheetColumns.js). The em dash for a not-applicable cell is unaffected — that
  // comes from `st.text` itself ("—", set by `cellState`), not from this placeholder path.
  const cellText = col.key === "location"
    ? (locationText || <span style={{ color: "var(--text-tertiary)", verticalAlign: "middle" }}>Set</span>)
    : st.text || "";
  // HARDENING-25 item 8 (continued) — the non-hue channel itself: a small glyph ahead of the
  // value, present only on a genuinely blocking cell. `aria-hidden` because `hoverTitle` below
  // already carries the same reason as accessible text.
  // B986096-HARDENING-28 (NEW-1/NEW-2 follow-up, owner live-measured, 2026-09-02 — "let the row
  // itself carry its own quiet marker") — an empty Executed cell on an untouched row used to render
  // truly nothing at all ("empty means empty," HARDENING-10 NEW-4), which is correct for a real
  // stored VALUE but left no signal that the blankness is "not yet looked at" rather than a data
  // gap. The per-row quiet SENTENCE this used to live in (`ProblemsList`'s own now-removed
  // untouched branch) was the actual defect — it stacked one line per untouched row and are what
  // starved the grid of its own height as rows piled up. This is its replacement: a single muted
  // dot, in the cell itself, never a line in a growing list. It disappears the moment the row is
  // touched (the real per-row message in ProblemsList takes over) or the date is filled in.
  const quietUnfilled = col.key === "compDate" && !touched && !draft?.compDate;
  const cellContent = blockingFlag
    ? (<><span aria-hidden="true" style={{ marginRight: 3, verticalAlign: "middle" }}>⚠</span>{cellText}</>)
    : quietUnfilled
    ? <span aria-hidden="true" style={{ color: "var(--text-tertiary)", verticalAlign: "middle" }}>•</span>
    : cellText;
  // HARDENING-10 (message B NEW-3) — Title/Address and the two party columns are the ones real
  // values got cut off in ("Core5 Industrial Partners"); a hover reveals the untruncated value.
  // B850016 (NEW-10) — extended to `leaseAnnualRate` (still a fixed-width column; widening it
  // covers the common case but a rare long value can still clip) and `notes` (the one flex column
  // that deliberately shrinks first under pressure, per this file's own FLEX_NOTES comment, so it
  // clips the most often of any column here) — both are free-text/derived, exactly the class this
  // report says truncation is acceptable for AS LONG AS the full value stays reachable on hover.
  const isLongTextCol = col.key === "title" || col.key === "partyProvider" || col.key === "partyAcquirer"
    || col.key === "leaseAnnualRate" || col.key === "notes";
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
          // B986096-HARDENING-24 — `...textStyle` carries the grid's real font-size/line-height/
          // color/fontWeight; a trailing `font: "inherit"` shorthand here used to run AFTER that
          // spread and reset every one of those longhand properties back to "inherit from the
          // ancestor <td>" — which has no font-size of its own, so it kept climbing the tree to the
          // bare <table> (16px). PR #1349/HARDENING-25 independently touched this same line but its
          // `font: "inherit"` survived the merge with only `color`/`fontWeight` patched back
          // afterward — fontSize/lineHeight were still silently reset. Only `fontFamily` needs the
          // explicit "inherit" a <span> gets for free (a <button> is a form control and does not
          // inherit it by default) — textStyle's own fontWeight (now blockingFlag-driven) rides
          // through the spread unmodified, so it never needs restating here.
          style={{ ...textStyle, width: "100%", border: "none", background: "transparent", cursor: "pointer", fontFamily: "inherit" }}
        >
          {cellContent}
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
      {/* NEW-6/NEW-7 (owner report, 2026-09-02 — "why are there not dropdowns shown on things
          that have dropdowns") — a choice cell (Type/Unit/Per/Basis, and any future select
          column) was plain text at rest, indistinguishable from a free-text or numeric cell
          until clicked. A trailing caret is the standard "this opens a menu" affordance; it's
          added ONLY for a select cell showing a real, chosen-looking value — never on a "na"
          (em-dash — genuinely not applicable to this row's type) one — and pinned to the cell's
          own right edge via flex, independent of how long the value text is, so it survives even
          the narrowest choice column (Unit). This is also what makes Basis read IDENTICALLY to
          Type/Unit/Per at rest — nothing in this file ever special-cased Basis; the one resting
          representation for a choice cell, applied uniformly, is this row/caret span, always a
          `<span>` here, never a live `<select>` (a native `<select>` only ever mounts while the
          cell is actually being edited — the same as every other kind of cell).
          B1119282 (×2, owner live-click measurement, 2026-09-03) — an earlier round gave Unit
          this same caret on a non-land row while it was still `editableFor`-gated to land only,
          so the caret claimed a choice that a real click could not reach at all (no `<select>`
          ever mounted). That's fixed at the SOURCE now, not papered over here: Unit is a genuine
          `state === "editable"` select on every row (compSheetColumns.js's `optionsFor` — land
          gets AC/SF, everything else gets the one real option, SF), so this condition is back to
          exactly what it was before that patch — `st.state === "editable"` alone — and it is
          honest again: every cell carrying this caret really does mount a `<select>` on click. */}
      {col.kind === "select" && st.state === "editable" ? (
        <span style={{ ...textStyle, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 3 }}>
          <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", verticalAlign: "middle" }}>{cellContent}</span>
          <span aria-hidden="true" style={{ flex: "none", fontSize: FONT_SIZE.micro, color: "var(--text-tertiary)", verticalAlign: "middle" }}>▾</span>
        </span>
      ) : (
        <span style={textStyle}>
          {cellContent}
        </span>
      )}
    </td>
  );
}

/* ---- averages (Lease/Land/Bldg sale), folded into the ONE footer line, never a band of their
 * own — NEW-3 (owner report, 2026-09-03): a bare "3 comps" strip directly under the grid repeated
 * the count the footer already gives, more usefully, and on a short window clipped to a
 * featureless white sliver with no readable text ("what is the white sliver at the bottom for" —
 * the answer is it shouldn't exist as its own band). The averages themselves are real, computed
 * facts and stay — they just ride the same status line as the ready/issue count now (built in the
 * footerMsg computation below), rather than a second line. Always names a lease average's basis. */
function compAverageParts(rows) {
  if (!rows.length) return [];
  const comps = rows.map((r) => draftToComp(r.draft));
  const lease = summarizeLeaseComps(comps);
  const land = summarizeSaleComps(comps, "land");
  const bldg = summarizeSaleComps(comps, "building_sale");
  const parts = [];
  // NEW-5 (owner decision) — an undated row is excluded from every average, never blended in;
  // the exclusion count joins the parenthetical the same way "(2, unweighted)" already does.
  if (lease.headline) {
    const basis = lease.headlineBasis.toUpperCase();
    const weight = lease.headline.weighted ? "SF-weighted" : "unweighted";
    const excl = lease.undatedCount ? `, ${lease.undatedCount} undated excluded` : "";
    parts.push(`Lease avg $${lease.headline.avg.toFixed(2)}/SF/yr ${basis} (${lease.headline.count}, ${weight}${excl})`);
  }
  if (land.count) parts.push(`Land avg $${land.avg.toFixed(2)}/SF (${land.count}${land.undatedCount ? `, ${land.undatedCount} undated excluded` : ""})`);
  if (bldg.count) parts.push(`Bldg sale avg $${bldg.avg.toFixed(2)}/SF (${bldg.count}${bldg.undatedCount ? `, ${bldg.undatedCount} undated excluded` : ""})`);
  return parts;
}

/* ---- problems: full sentences below the sheet, naming the row, never a dot on a cell -------- */
function ProblemsList({ rows, onResolvePeriod, attemptedSave }) {
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
    // NEW-2 — a row nobody has touched yet, and Save hasn't been pressed, stays QUIET: no line
    // here at all. B986096-HARDENING-28 (NEW-1/NEW-2 follow-up) — the untouched case used to
    // render its own muted line PER ROW, which is what starved the grid's own height as rows
    // piled up (measured: 8 untouched rows → 8 stacked lines → the grid shrank from 154px to
    // 101px). The ambient footer already states the aggregate count ("N missing an Executed
    // date and/or a Location") in ONE line, and the cell itself now carries a quiet dot
    // (`SheetCell`'s `quietUnfilled`) — nothing is lost, the list just stops growing with row
    // count. Only a TOUCHED row (or one Save was attempted on) gets a real line here.
    if (!rowHasBlockingFlags(cellFlags) && missing.length && (row.touched || attemptedSave)) {
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
  return <div style={{ flex: "none", padding: "8px 10px", display: "flex", flexDirection: "column", gap: 6, borderTop: "1px solid var(--border-default)", maxHeight: 120, overflowY: "auto" }}>{items}</div>;
}

function clamp(n, lo, hi) { return Math.max(lo, Math.min(hi, n)); }

// NEW-2 — stamps `touched: true` on the rows named by `ids`, leaving every other row's object
// reference untouched. Used by every DIRECT sheet-edit path (a cell commit, fill-down, an
// Excel-style spill-paste, clearing a range, resolving the rate/period ambiguity) so their rows
// stop reading as "freshly parsed" the moment the user actually acts on them. Deliberately NEVER
// called from the textarea's own smart-parse commit path (`commitText`) — those rows are exactly
// the untouched ones this rule exists to keep quiet.
function markTouched(rows, ids) {
  if (!ids || !ids.length) return rows;
  const idSet = new Set(ids);
  return rows.map((r) => (idSet.has(r._id) ? { ...r, touched: true } : r));
}

export default function CompEntryGrid({ rows, onRowsChange, armedRowId, onArm, onFocusAnchor, onSave, onCancel, saving, saveError, overlaysById }) {
  const isMobile = useIsMobileViewport();
  // B850016 (NEW-9) — arming a row's Location cell ("Set") has nowhere to go on desktop either:
  // the docked panel can still cover most of the map at a short window (measured 71% of a
  // 1191x521 viewport), so the "click the map" banner it shows sits on top of the map it's
  // pointing at. Mirrors CompEntryMobileSheet's own `minimized` — collapse to a slim strip the
  // instant a row is armed (pin OR "Comp from parcel", both go through the same `armedRowId`),
  // freeing the map underneath, and restore full view — rows/edits untouched, this is a pure
  // render branch, never a data path — the instant it's disarmed (a pick lands, Cancel, or Esc).
  const [minimizedForPlacement, setMinimizedForPlacement] = useState(false);
  // useLayoutEffect (not useEffect) so the switch lands before paint — an armed row must never
  // render the full-height panel over the map for even one visible frame.
  useLayoutEffect(() => { setMinimizedForPlacement(!!armedRowId); }, [armedRowId]);
  const [pasteText, setPasteText] = useState("");
  const [lastPasteText, setLastPasteText] = useState(null);
  const [lastCommitSummary, setLastCommitSummary] = useState(null);
  const [showPastedText, setShowPastedText] = useState(false);
  const [lastSingleParse, setLastSingleParse] = useState(null);
  // B1063904 — a merge the parser refused because two lines disagreed on a field (MERGE SAFETY).
  // Distinct from `lastSingleParse`: that one offers "Split one row per line" as the escape hatch
  // from a DEFAULT merge; this one offers the inverse — "Merge into one comp" — because the
  // default here was already NOT to merge, and the user may still want to override it.
  const [lastSplitParse, setLastSplitParse] = useState(null);
  const lastCommitRef = useRef(null); // duplicate-paste-event guard, unchanged from round 5
  // NEW-2 — "have they pressed Save" is the OTHER trigger (besides row.touched) that upgrades a
  // quiet incompleteness note into the full validateComp sentence; see ProblemsList.
  const [attemptedSave, setAttemptedSave] = useState(false);
  // NEW-3 (owner report, 2026-09-02 — "why does it populate a second row unnecessarily") — every
  // paste APPENDS to the sheet, which is correct (collecting comps from several broker emails is
  // the real workflow) but it was SILENT about it: an empty-looking textarea plus a fresh paste
  // read as "here is my one comp," not "here is one more." `lastPasteRowIds` names exactly which
  // rows the MOST RECENT paste (or paste-derived transform — Split/Merge below) added, so the
  // summary line can say so and Undo can remove precisely those rows, nothing else.
  const [lastPasteRowIds, setLastPasteRowIds] = useState(null);

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
      // ⛔ B844400/NEW-4 (owner report, 2026-09-03) — REMOVES the HARDENING-10 NEW-3
      // `.showPicker()` call this effect used to make unconditionally on every select-cell open.
      // Root-caused with an instrumented probe (a capturing `window` keydown listener + a raw CDP
      // keypress): once the native OS picker popup is open, a subsequent letter keystroke reaches
      // NO page-level JS listener at all — not React's delegated handler, not the native
      // AT_TARGET listener HARDENING-15 attaches, not even a capture-phase `window` listener. The
      // browser's own popup owns the keystroke entirely as chrome-level UI, the same mechanism
      // this file's own HARDENING-13 comment already named for the Tab-after-picking case. That
      // makes "click a choice cell, then type" (the owner's exact repro) unfixable at the JS layer
      // as long as the popup auto-opens: the keystroke the owner types never reaches this app at
      // all, matching the reported "type 'A' — nothing, type '8' — nothing" precisely.
      // Un-instrumented, the same probe against a FOCUSED-BUT-CLOSED select (`.focus()` alone, no
      // `showPicker()`) shows the letter DOES reach the page and the native `<select>` changes its
      // own value via its own built-in type-ahead — confirmed live, not reasoned: `onGridKeyDown`'s
      // and `onEditKeyDown`'s own deliberate `matchOption` jump (added this same item) additionally
      // guarantee the result rather than depend on that native behavior alone. The trade: a select
      // cell no longer visually pops its list open on the FIRST click — it still enters edit mode
      // (focused, outlined, immediately typeable/arrow-able) in that one click, same as before;
      // seeing the list itself now takes one more click (a genuine click landing on the now-mounted,
      // already-focused `<select>`, which is native, no JS needed) or Enter/F2 re-opening it. That
      // is a real, deliberate narrowing of HARDENING-10 NEW-3's "one click reaches an editable
      // state" win — argued because a swallowed keystroke silently discarding what the owner typed
      // is worse than one extra click for a mouse user who wants to browse the list visually.
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

    const { rows: parsedRows, mode, splitReason } = parsePaste(text);
    setLastPasteText(text);
    setShowPastedText(false);
    const lineCount = splitPasteLines(text).length;
    if (!parsedRows.length) {
      setLastSingleParse(null);
      setLastSplitParse(null);
      setLastPasteRowIds(null);
      setLastCommitSummary(`Nothing recognized in ${lineCount} pasted line${lineCount === 1 ? "" : "s"}.`);
      return;
    }
    const newRows = parsedRows.map(draftFromParsedRow);
    const sheetTotal = rows.length + newRows.length;
    commitRows([...rows, ...newRows]);
    setLastSingleParse(mode === "single" ? { raw: text, rowIds: newRows.map((r) => r._id) } : null);
    setLastSplitParse(mode === "split" ? { raw: text, rowIds: newRows.map((r) => r._id) } : null);
    setLastPasteRowIds(newRows.map((r) => r._id));
    // NEW-3 — every paste has to SAY what it did: "Added N — M in the sheet," never a silent
    // append. `mode === "split"` still leads with WHY it became several rows instead of one
    // (B1063904's MERGE SAFETY refusal reason) ahead of the same added/total accounting.
    const addedWord = `Added ${newRows.length} comp${newRows.length === 1 ? "" : "s"}`;
    const totalWord = `${sheetTotal} in the sheet`;
    setLastCommitSummary(mode === "split" ? `${splitReason} ${addedWord} — ${totalWord}.` : `${addedWord} — ${totalWord}.`);
    setSelection({ row: rows.length, col: 0 });
  };

  // NEW-3 — removes exactly the rows the most recent paste (or Split/Merge transform) added,
  // never anything the user has entered since. A no-op once those ids are already gone (e.g. the
  // user already deleted one by hand) — `.filter` simply finds nothing left to remove for it.
  const undoLastPaste = () => {
    if (!lastPasteRowIds || !lastPasteRowIds.length) return;
    const idSet = new Set(lastPasteRowIds);
    const remaining = rows.filter((r) => !idSet.has(r._id));
    commitRows(remaining);
    setLastCommitSummary(`Removed ${lastPasteRowIds.length} comp${lastPasteRowIds.length === 1 ? "" : "s"} — ${remaining.length} in the sheet.`);
    setLastPasteRowIds(null);
    setLastSingleParse(null);
    setLastSplitParse(null);
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
    setLastPasteRowIds(multiRows.map((r) => r._id)); // Undo still refers to whatever this paste currently holds
  };
  // B1063904 — the inverse of a MERGE-SAFETY split: forces the same raw paste through
  // `parseSingleRecord` (bypassing the collision check), replacing the split rows with one merged
  // row. Only reachable from a split the parser itself just produced, so `raw` is always the exact
  // text that was refused — never a re-guess.
  const mergeIntoOneComp = () => {
    if (!lastSplitParse) return;
    const { raw, rowIds } = lastSplitParse;
    const idSet = new Set(rowIds);
    const remaining = rows.filter((r) => !idSet.has(r._id));
    const merged = parseSingleRecord(raw);
    if (!merged) return;
    const newRow = draftFromParsedRow(merged);
    commitRows([...remaining, newRow]);
    setLastSplitParse(null);
    setLastPasteRowIds([newRow._id]); // Undo still refers to whatever this paste currently holds
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
    const activeDraft = draftOverride || rows[row].draft;
    const st = cellState(colDef, activeDraft);
    if (st.state !== "editable") return;
    // B844400/NEW-4 (owner report, 2026-09-03) — a select's value is a fixed option, not typed
    // text, so a printable keypress can't seed it character-for-character the way a text/number
    // cell does. It used to just ignore the keypress outright and open at the CURRENT value; now
    // it jumps straight to the first option whose label/value starts with the pressed character
    // (matchOption — the same prefix rule applyCellEdit already uses when a select cell is typed
    // OVER), mirroring the spreadsheet type-ahead the rest of the grid already implies. A
    // non-matching character (or no character at all — a click, F2, Enter) opens at the current
    // value, same as before. `optionsForColumn` resolves the row's OWN option set (B1119282 ×2 —
    // Unit's options now vary by comp type), never the column's static fallback list.
    const matchedOption = colDef.kind === "select" && initial
      ? matchOption(optionsForColumn(colDef, activeDraft.compType), initial) : null;
    const startValue = colDef.kind === "select" ? (matchedOption ?? (st.raw ?? "")) : initial != null ? initial : (st.raw ?? "");
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
      // NEW-2 — a committed cell edit is exactly "the user has edited that row and moved off it."
      const nextRows = rows.map((r, i) => (i === target.row ? { ...r, draft: newDraft, cellFlags: nextFlags, touched: true } : r));
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
        // B986096-HARDENING-23 (owner live-report, 2026-09-02) — "Enter does not close the
        // editor" on a single-row grid, or on the last row: reported as low-severity but real —
        // "it makes the grid feel broken because nothing visibly happens." The clamp itself
        // (computeDestination's row-axis has nowhere else to go) is correct and necessary; the
        // defect is reopening the SAME cell with the value that was just typed INTO it — there is
        // nothing left to enter, so the reopen buys nothing HARDENING-10 NEW-3's "land the next
        // cell in edit mode" was actually for (a genuinely different destination), and it makes a
        // successful commit look like a no-op. Only reopen when the destination is a different
        // cell; a same-cell clamp now closes normally, exactly like Tab wrapping to a non-editable
        // destination or Escape already do.
        const samecell = dest.row === target.row && dest.col === target.col;
        if (!samecell && destRow && cellState(destColDef, destRow.draft).state === "editable") {
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
    // B844400/NEW-4 (owner report, 2026-09-03) — a select-kind cell that's ALREADY open (reached
    // by a click, which enters edit immediately per HARDENING-10) relied entirely on the browser's
    // OWN native `<select>` type-ahead for a further keypress to jump the value — measured
    // unreliable (it silently did nothing, matching the owner's "type 'A' — nothing" report).
    // Deliberate, matchOption-driven type-ahead closes it the same way `beginEdit`'s own initial
    // seeding does (see its header): jump to the first option whose label/value starts with the
    // typed character, then commit it exactly as `onSelectEditChange` already does for a real
    // native change — picking an option IS the complete action here, same as any other route into
    // it. A non-matching character is a no-op (never guesses), same "never silently wrong" rule
    // `applyCellEdit`/`matchOption` already follow elsewhere in this sheet.
    else if (editingRef.current && e.key.length === 1 && !(e.metaKey || e.ctrlKey) && !e.altKey) {
      const colDef = SHEET_COLUMNS[editingRef.current.col];
      if (colDef.kind === "select") {
        const compType = rows[editingRef.current.row]?.draft.compType;
        const matched = matchOption(optionsForColumn(colDef, compType), e.key);
        if (matched != null) { e.preventDefault(); onSelectEditChange(matched); }
      }
    }
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
    // choice cell gets a focused, immediately typeable `<select>` (B844400/NEW-4 removed the
    // auto-`showPicker()` this comment used to describe — see the edit-open layout effect's own
    // header for why).
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
    if (end > start) {
      commitRows(markTouched(fillDownColumn(rows, selection.col, [start, end]), rows.slice(start, end + 1).map((r) => r._id)));
      return;
    }
    if (start === 0) return; // Excel's single-cell Ctrl+D: copy the row ABOVE
    commitRows(markTouched(fillDownColumn(rows, selection.col, [start - 1, start]), [rows[start]._id]));
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
      return { ...r, draft: colDef.setValue(r.draft, ""), cellFlags: nextFlags, touched: true };
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
      // B1120976 (NEW-1/B1113714) — every sibling branch above calls preventDefault() before
      // acting; this one didn't. beginEdit() seeds the new input's React state with e.key and
      // focuses it synchronously (the `editing` useLayoutEffect), all before this handler
      // returns — so with the keydown's default action left unprevented, the browser's own
      // native character-insertion then lands the SAME keystroke a second time into the
      // now-focused input, doubling it. (Independently identified in this same spot by B1119282's
      // owner brief — one fix, landed here first via B1120976; the two sessions agreed.)
      e.preventDefault();
      beginEdit(selection.row, selection.col, e.key, false);
    }
  };

  const onGridPaste = (e) => {
    if (!selection || editing) return; // editing input handles its own native paste
    const text = e.clipboardData?.getData("text/plain");
    if (!text) return;
    e.preventDefault();
    // NEW-2 — an Excel-style paste landed DIRECTLY on the sheet (as opposed to the textarea's own
    // smart-parse commit) is a deliberate, cell-targeted edit — every row it lands on or creates
    // counts as touched. Diffed by object identity: a row `spillPaste` didn't touch keeps the same
    // `.draft` reference, so this only marks the rows that actually changed (or are brand new).
    const nextRows = spillPaste(rows, selection.row, selection.col, text, () => emptyDraft(null), newRowId);
    const touchedIds = nextRows.filter((r, i) => !rows[i] || rows[i].draft !== r.draft).map((r) => r._id);
    commitRows(markTouched(nextRows, touchedIds));
  };

  const removeRow = (id) => commitRows(rows.filter((r) => r._id !== id));
  // NEW-5 — the Executed cell's one-click "Today" quick-set (see SheetCell's own header for why
  // this is a deliberately INDEPENDENT commit path rather than going through the moratoriumed
  // editing-input machinery). `finishEdit(false, null)` — the discard branch, identical to what
  // Escape already calls — closes whichever cell the sheet had open, since clicking Today only
  // ever happens while that same cell is mid-edit.
  const setRowToday = (rowIdx) => {
    const row = rows[rowIdx];
    if (!row) return;
    commitRows(rows.map((r, i) => (i === rowIdx ? { ...r, draft: { ...r.draft, compDate: todayIso() }, touched: true } : r)));
    finishEdit(false, null);
  };
  const resolvePeriod = (rowId, period) => {
    commitRows(rows.map((r) => {
      if (r._id !== rowId) return r;
      const nextFlags = { ...r.cellFlags };
      delete nextFlags.leaseRatePeriod;
      return { ...r, draft: { ...r.draft, leaseRatePeriod: period }, cellFlags: nextFlags, touched: true };
    }));
  };
  // B1091712 — the mobile sheet's one commit path for every field row, addressed by row id
  // rather than the desktop cell-editing state machine's (row, col) grid coordinates (there's no
  // grid selection/navigation to seed it from on a one-comp-per-screen layout). Same shape as
  // `finishEdit`'s own commit branch above: apply, clear that cell's flag, mark the row touched,
  // and go through `commitRows` so Ctrl/Cmd+Z on a desktop-resized-narrow session still works.
  const commitFieldEdit = (rowId, col, rawValue) => {
    const row = rows.find((r) => r._id === rowId);
    if (!row) return;
    const newDraft = applyCellEdit(col, row.draft, rawValue);
    const flagKey = col.flagKey(row.draft);
    const nextFlags = { ...row.cellFlags };
    delete nextFlags[flagKey];
    commitRows(rows.map((r) => (r._id === rowId ? { ...r, draft: newDraft, cellFlags: nextFlags, touched: true } : r)));
  };

  function rowIsReady(row) {
    return !rowHasBlockingFlags(row.cellFlags) && validateComp(draftToComp(row.draft)).length === 0;
  }
  const readyRows = rows.filter(rowIsReady);
  const blockingCount = rows.filter((r) => rowHasBlockingFlags(r.cellFlags)).length;
  // ⛔ HARDENING-13 (B986096, owner P0 live-test, "the footer used to name the reason, now it
  // just says '1 blocking'") — `missingCount` counts ANY row with a validateComp error, blocking
  // or not — a row can appear in both counts.
  // ⛔ NEW-5 (owner decision, 2026-09-02) — `validateComp` no longer flags a missing Executed
  // date (see its own header in comps.js), so `missingCount` is now ENTIRELY about Location — the
  // one field still required to save. The old three-way "missing date / missing location / missing
  // both" split (HARDENING-22) is gone with it: keeping it would have gone on naming a "missing an
  // Executed date" problem for rows that are, per the very same render, already counted as READY
  // — a genuinely contradictory message, not a stale comment. A row without a date is still
  // visible (the quiet dot in its own Executed cell, `SheetCell`'s `quietUnfilled`) — it's just
  // no longer a blocker, so it no longer belongs in this line at all.
  const missingLocationCount = rows.filter((r) => validateComp(draftToComp(r.draft)).length > 0).length;
  // NEW-3 — the count (and, when there's anything to say, the averages) now ride the SAME line as
  // the ready/issue status — see compAverageParts's own header for why the separate "N comps"
  // strip is gone. All-ready keeps the old, already-count-led phrasing verbatim; the issues case
  // adds the count explicitly ahead of "N ready" since "N of M ready" no longer states the total.
  let footerMsg = "";
  if (rows.length > 0) {
    const countWord = `${rows.length} comp${rows.length === 1 ? "" : "s"}`;
    const segments = [];
    if (blockingCount === 0 && missingLocationCount === 0) {
      segments.push(`${countWord} ready`);
    } else {
      const issues = [];
      if (blockingCount > 0) issues.push(`${blockingCount} rate${blockingCount === 1 ? "" : "s"} need${blockingCount === 1 ? "s" : ""} a period`);
      if (missingLocationCount > 0) issues.push(`${missingLocationCount} missing a Location`);
      segments.push(`${countWord} · ${readyRows.length} ready — ${issues.join(", ")}`);
    }
    segments.push(...compAverageParts(rows));
    footerMsg = `${segments.join(" · ")}.`;
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
    // A saved height is the user's own deliberate resize — always honored. With nothing saved yet
    // (first open, or a fresh device), default to most of the viewport rather than a flat 340px.
    return Number.isFinite(saved) && saved > 0 ? saved : defaultDockHeight();
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

  // B1091712 — the paste box (the ONLY way rows land on this sheet by hand, rather than a
  // map pick) is shared verbatim between the desktop table and the mobile transposed layout below
  // — one implementation, so a paste behaves identically regardless of which layout is showing.
  const pasteBoxNode = (
    <div style={{ flex: "none", padding: "10px 14px", borderBottom: "1px solid var(--border-default)" }}>
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
      {/* NEW-3 — "the box is an inbox, the grid is the set," said once, always visible (not tied
          to any one paste) so it's read BEFORE a cleared box gets mistaken for a cleared sheet
          rather than after. */}
      <div style={{ marginTop: 4, fontSize: 10, color: "var(--text-tertiary)" }}>
        Every paste adds rows to the sheet below — clearing this box never clears them.
      </div>
      {/* B986096-HARDENING-28 (NEW-1 follow-up) — the panel is a fixed-height flex column and
          ONLY the grid below has `flex:1`; every sibling here competes for the SAME fixed
          budget, so an unbounded one directly steals the grid's own share. This line's text is
          assembled from several parts (a split reason + the add/undo summary + link buttons)
          and can run long — capped to ~2 lines so it can never balloon further, the same
          defensive shape as the pasted-text preview below it. */}
      {lastCommitSummary && (
        <div style={{ marginTop: 4, fontSize: 10.5, color: "var(--text-secondary)", maxHeight: 32, overflowY: "auto" }}>
          {lastCommitSummary}
          {lastPasteRowIds && lastPasteRowIds.length > 0 && (<> · <button onClick={undoLastPaste} style={linkBtnStyle}>Undo</button></>)}
          {lastPasteText && (<> · <button onClick={() => setShowPastedText((v) => !v)} style={linkBtnStyle}>{showPastedText ? "Hide pasted text" : "Show pasted text"}</button></>)}
          {lastSingleParse && (<> · <button onClick={switchToOnePerLine} style={linkBtnStyle}>Split one row per line</button></>)}
          {lastSplitParse && (<> · <button onClick={mergeIntoOneComp} style={linkBtnStyle}>Merge into one comp</button></>)}
        </div>
      )}
      {showPastedText && lastPasteText && (
        <div style={{ marginTop: 4, fontSize: 10.5, color: "var(--text-secondary)", background: "var(--surface-raised)", border: "1px solid var(--border-default)", borderRadius: 6, padding: "6px 8px", whiteSpace: "pre-wrap", maxHeight: 90, overflowY: "auto" }}>
          {lastPasteText}
        </div>
      )}
    </div>
  );

  if (isMobile) {
    return createPortal(
      <CompEntryMobileSheet
        rows={rows}
        overlaysById={overlaysById}
        locationCellText={locationCellText}
        onCommitField={commitFieldEdit}
        onSetToday={setRowToday}
        onResolvePeriod={resolvePeriod}
        armedRowId={armedRowId}
        onArm={onArm}
        onFocusAnchor={onFocusAnchor}
        onSave={(readyForSave) => { setAttemptedSave(true); onSave(readyForSave); }}
        onCancel={onCancel}
        saving={saving}
        saveError={saveError}
        readyRows={readyRows}
        rowIsReady={rowIsReady}
        pasteBox={pasteBoxNode}
      />,
      document.body,
    );
  }

  // NEW-9 — collapse the whole panel to a thin bottom strip while a row is armed for a map pick,
  // so the map above it is actually clickable (measured: the docked panel alone still covered
  // 71% of the map at 1191x521). `rows`/`onRowsChange` are the parent's own state (CompsPanel),
  // never local to this component, so nothing here is lost by unmounting the full panel —
  // clicking Cancel or landing a pick just flips `minimizedForPlacement` back via the effect above.
  if (minimizedForPlacement) {
    return createPortal(
      <div
        data-comp-entry-panel="1" data-comp-entry-minimized="1"
        onPointerDown={(e) => e.stopPropagation()}
        style={{
          position: "fixed", left: 16, right: 16, bottom: 12, zIndex: 2700,
          background: "var(--warn-bg)", border: "1px solid var(--warn-border)", borderRadius: 12,
          padding: "10px 14px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12,
          boxShadow: "0 -8px 28px rgba(28,25,20,0.18), 0 -2px 8px rgba(28,25,20,0.08)", // design-exempt: matches the full panel's own un-tokenized shadow below — no shadow token exists yet
        }}>
        <span style={{ fontSize: 12, color: "var(--warn-text)" }}>
          Click the map above to drop the pin — or click <strong>Comp from parcel</strong> on the map toolbar to anchor to a lot instead. Press Esc to cancel.
        </span>
        <button onClick={() => onArm(null)} style={{ flex: "none", border: "none", background: "none", color: "var(--warn-text)", textDecoration: "underline", fontFamily: "inherit", fontSize: 12, cursor: "pointer", padding: 0 }}>
          Cancel
        </button>
      </div>,
      document.body,
    );
  }

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
        // HARDENING-25 item 1 — this used to be `--surface-overlay`, the app's "frosted floating
        // panel" surface (rgba .94, deliberately translucent everywhere else it's used). That's
        // right for a legend or a toolbar, but this panel's whole content IS a dense data grid —
        // the point of a grid is that you can read every cell without the map's own imagery/street
        // labels bleeding through it. `--surface-raised` is the same token every header cell in
        // the grid already uses, opaque in both themes.
        // NEW-2 — the panel now SHRINKS TO FIT its own content, `dockHeight` acting as a CEILING
        // (`maxHeight`) rather than a fixed height: a 1-row sheet renders a 1-row-tall panel, and
        // the panel only grows toward `dockHeight` as more rows genuinely need the room. See
        // GRID_MIN_HEIGHT's own header above for the rest of the height-budget story.
        position: "fixed", left: 16, right: 16, bottom: 12, width: "auto",
        height: "auto", maxHeight: dockHeight, zIndex: 2600, display: "flex", flexDirection: "column",
        background: "var(--surface-raised)", border: "1px solid var(--border-default)", borderRadius: 12,
        boxShadow: "0 -8px 28px rgba(28,25,20,0.18), 0 -2px 8px rgba(28,25,20,0.08)", // design-exempt: shadow points UP (the panel sits at the bottom of the viewport) — no shadow token exists yet
      }}>
      {/* NEW-2 — every sibling around the grid is pinned `flex: "none"` (natural size, never
          grow, never shrink) so the grid is the ONE element that absorbs a genuine squeeze once
          total content exceeds `dockHeight` — same intent as HARDENING-28, now paid for by the
          panel shrinking to content instead of a floor forced onto the grid regardless of row count. */}
      <div onPointerDown={startResize} title="Drag to resize"
        style={{ flex: "none", height: 6, margin: "-1px -1px 0", borderRadius: "12px 12px 0 0", cursor: "ns-resize", background: "var(--border-default)" }} />
      <div style={{ flex: "none", display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 14px", borderBottom: "1px solid var(--border-default)" }}>
        <span style={{ fontSize: 13, fontWeight: 700 }}>Paste comps</span>
        <button onClick={onCancel} aria-label="Close"
          style={{ border: "none", background: "transparent", color: "var(--text-secondary)", fontFamily: "inherit", fontSize: CLOSE_ICON_FONT_SIZE, cursor: "pointer", padding: 2 }}>✕</button>
      </div>

      {pasteBoxNode}

      {/* NEW-9 (B850016) — the armed banner used to render HERE, inside the full panel, which is
          exactly the "click the map" instruction sitting on top of the map it's pointing at
          (HARDENING-12's dock-to-bottom fix shrank the overlap but never closed it at a short
          window — measured 71% of a 1191x521 viewport still covered). `armedRowId` truthy now
          always routes to the `minimizedForPlacement` branch above BEFORE this ever paints (see
          its own header comment), so this branch is unreachable by construction and was removed
          rather than left as a second, driftable copy of the same banner text. Escape still
          disarms from anywhere (CompsPanel's own window keydown listener), unchanged. */}

      {rows.length === 0 ? (
        <div style={{ flex: "none", fontSize: 12, color: "var(--text-secondary)", padding: "24px 14px", textAlign: "center" }}>
          Paste a few comps above to get started.
        </div>
      ) : (
        <div
          ref={gridRef}
          tabIndex={0}
          role="grid"
          onKeyDown={onGridKeyDown}
          onPaste={onGridPaste}
          style={{ flex: "0 1 auto", minHeight: GRID_MIN_HEIGHT, overflow: "auto", outline: "none" }}>
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
                      draft={row.draft} cellFlags={row.cellFlags} touched={!!row.touched}
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
                      onSetToday={setRowToday}
                      flexWidths={flexWidths} frozenOffsets={frozenOffsets}
                    />
                    );
                  })}
                  <td style={{
                    position: "sticky", right: 0, width: REMOVE_COL_W, height: ROW_H, boxSizing: "border-box",
                    padding: 0, textAlign: "center", verticalAlign: "middle",
                    background: "var(--surface-raised)", border: "1px solid var(--border-default)",
                    scrollMarginTop: GROUP_BAND_H + COL_LABEL_H,
                  }}>
                    <button onClick={() => removeRow(row._id)} title="Remove" aria-label="Remove comp"
                      style={{ border: "none", background: "transparent", color: "var(--danger-text)", fontFamily: "inherit", cursor: "pointer", fontSize: CLOSE_ICON_FONT_SIZE, padding: 0, height: ROW_H, lineHeight: CELL_LINE_HEIGHT, verticalAlign: "middle" }}>✕</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <ProblemsList rows={rows} onResolvePeriod={resolvePeriod} attemptedSave={attemptedSave} />

      <div style={{ flex: "none", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, padding: "10px 14px", borderTop: "1px solid var(--border-default)" }}>
        <span style={{ fontSize: 10.5, color: "var(--text-secondary)" }}>{footerMsg}</span>
        <span style={{ display: "flex", gap: 8 }}>
          <Button size="sm" variant="ghost" onClick={onCancel} disabled={saving}>Close</Button>
          {/* NEW-2 — pressing Save is the OTHER trigger that upgrades every row's quiet
              incompleteness note into the full message, so a row Save skipped over (it only ever
              saves the READY rows) explains itself instead of staying silently quiet forever. */}
          <Button size="sm" onClick={() => { setAttemptedSave(true); onSave(readyRows); }} disabled={saving || readyRows.length === 0}>
            {saving ? "Saving…" : `Save ${readyRows.length || ""} comp${readyRows.length === 1 ? "" : "s"}`.trim()}
          </Button>
        </span>
      </div>
      {saveError && <div style={{ fontSize: 12, color: "var(--danger-text)", padding: "0 14px 10px" }}>{saveError}</div>}
    </div>,
    document.body,
  );
}
