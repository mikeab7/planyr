/* Model workspace — the ribbon's responsive collapse math (Stage 2, B1007281; re-grouped for the
 * Stage 2 ICONOGRAPHY pass, B1020608-FOLLOWUP).
 *
 * The owner's brief, verbatim: his real window is ~729 CSS px wide (he browses at ~215% page
 * zoom), and "a ribbon that only works at 1400px is a ribbon he cannot use." A real Excel/Sheets-
 * style Home tab simply doesn't fit in 729px of anything but icons — so GROUPS collapse into ONE
 * trailing "…" popover as the available width shrinks, lowest-priority group first, exactly how
 * Excel's own ribbon degrades a window narrower than its groups' gallery of buttons. The owner's
 * follow-up correction: the old collapse rendered one small trigger PER collapsed group (several
 * ragged little icon buttons trailing the row); it now collapses into a SINGLE "…" trigger whose
 * one popover stacks every collapsed group's own content — Ribbon.jsx's job, this file only says
 * which groups are in vs. out.
 *
 * Kept pure and DOM-free so the collapse decision is provable without mounting anything —
 * Ribbon.jsx (the component) does nothing but measure its own container width and hand it here.
 * `computeRibbonLayout` is generic (tested against synthetic groups); `RIBBON_GROUPS` below is
 * the real, tuned inventory Ribbon.jsx actually renders — its width numbers are estimates that
 * get corrected by live-browser measurement (see PR notes), never by re-deriving the algorithm.
 */

/** Decide which groups fit inline at `containerWidth` and which collapse into the trailing
 *  "More ▾" popover. `groups` is `[{key, width, priority}]` in DISPLAY order (left to right);
 *  `reserveForMore` is the width to hold open for the "More ▾" trigger itself, charged ONLY once
 *  something has actually collapsed (a ribbon that fits everything needs no trailing button).
 *
 *  Collapse order is lowest `priority` first; a tie breaks toward collapsing the group that sits
 *  FURTHER RIGHT in the display order first (keeps the leftmost of equal-priority groups on
 *  screen longest) — deterministic either way, so the same inputs always produce the same
 *  layout, which is what makes this testable without a browser. */
export function computeRibbonLayout(containerWidth, groups, reserveForMore = 0) {
  if (!Array.isArray(groups) || groups.length === 0) return { visibleKeys: [], overflowKeys: [] };
  const width = Number.isFinite(containerWidth) ? containerWidth : 0;
  const overflow = new Set();
  const totalOf = () => {
    let sum = 0;
    for (const g of groups) if (!overflow.has(g.key)) sum += g.width;
    return sum + (overflow.size > 0 ? reserveForMore : 0);
  };
  const collapseOrder = groups
    .map((g, i) => ({ ...g, _idx: i }))
    .sort((a, b) => (a.priority - b.priority) || (b._idx - a._idx));
  let i = 0;
  while (totalOf() > width && i < collapseOrder.length) { overflow.add(collapseOrder[i].key); i++; }
  return {
    visibleKeys: groups.filter((g) => !overflow.has(g.key)).map((g) => g.key),
    overflowKeys: groups.filter((g) => overflow.has(g.key)).map((g) => g.key),
  };
}

// The real Home-tab groups, in display order (the owner's own grouping, verbatim from the
// ICONOGRAPHY brief): Actions (undo/redo + paint/clear) | Font face (family+size) | Font style
// (B/I/U/S) | Colour (text+fill) | Alignment (incl. wrap/indent/merge) | Number | Borders |
// Cells (insert/delete/freeze) | Sort & Filter. `width` is a generous estimate of the group's own
// natural inline width PLUS its own leading divider (icon buttons are a uniform 26px now —
// CONTROL_H.md — so a group's own content is close to `26 * buttonCount + 3 * (buttonCount-1)`
// gaps; dropdown triggers with a text label are wider; every visible group after the first is
// preceded by a divider — 1px rule + 8px margin each side, DIVIDER_FOOTPRINT below — so each
// width folds that in too rather than let computeRibbonLayout under-count the real rendered row
// and risk the exact overflow this mechanism exists to prevent; see Ribbon.jsx for the actual
// controls each renders). `priority` decides collapse order, LOWEST collapsing first. Font style
// (Bold/Italic/Underline/Strike) and Actions are kept visible longest — a spreadsheet with no
// Bold button at all reads as broken, and Undo/Redo are the two controls used every single edit.
// Number and Borders (currency/% and the subtotal/total border convention) are the next to go,
// ahead of the geometry-only groups (Font face, Colour, Alignment, Cells, Sort & Filter) that a
// narrow window can live without for a moment behind "…".
const DIVIDER_FOOTPRINT = 17; // 1px rule + 8px margin each side (docs/DESIGN.md's divider rule)
export const RIBBON_GROUPS = [
  { key: "actions", label: "Actions", width: 116 + DIVIDER_FOOTPRINT, priority: 9 },
  { key: "fontface", label: "Font", width: 166 + DIVIDER_FOOTPRINT, priority: 4 },
  { key: "fontstyle", label: "Bold / Italic / Underline / Strike", width: 116 + DIVIDER_FOOTPRINT, priority: 8 },
  // STAGE 3 (NEW-2) added a third control (the auto-colour toggle, a plain 26px icon button +
  // its own 3px gap) to this group — 59 -> 88.
  { key: "color", label: "Colour", width: 88 + DIVIDER_FOOTPRINT, priority: 3 },
  { key: "alignment", label: "Alignment", width: 233 + DIVIDER_FOOTPRINT, priority: 2 },
  { key: "number", label: "Number", width: 237 + DIVIDER_FOOTPRINT, priority: 6 },
  { key: "borders", label: "Borders", width: 87 + DIVIDER_FOOTPRINT, priority: 5 },
  { key: "cells", label: "Cells", width: 90 + DIVIDER_FOOTPRINT, priority: 1 },
  // Stage 3, formula-auditing (NEW-1/NEW-2, owner brief 2026-09-03) — Trace Precedents/
  // Dependents/Remove Arrows (3 icon buttons + an occasional "L2" level readout, sized into the
  // width for the widest state) + the Inconsistencies toggle (1 icon button + its own count
  // badge, which overlays rather than adding width). Priority 2, tied with Alignment: a real
  // auditing tool the owner asked for by name ("the single most useful auditing tool in Excel"),
  // so it survives longer than the structural-editing/naming groups as the window narrows.
  { key: "audit", label: "Formula Auditing", width: 130 + DIVIDER_FOOTPRINT, priority: 2 },
  // Stage 3 pt 2 (NEW-1) — a single icon button opening the Name Manager (list/search/jump,
  // rename, retarget, delete, plus the "define from selection" fast path — see
  // components/NameManager.jsx). Placed after Cells: a real spreadsheet's structural-editing
  // tools (Cells) matter more moment to moment than naming a range, but naming still earns a
  // spot ahead of Sort & Filter (the LOWEST-priority group, still first to collapse — a
  // pre-existing checkpoint test pins that). Tied with Cells at priority 1 so it collapses
  // before Cells but strictly after Sort & Filter as the window narrows.
  { key: "names", label: "Names", width: 26 + DIVIDER_FOOTPRINT, priority: 1 },
  { key: "sortfilter", label: "Sort & Filter", width: 87 + DIVIDER_FOOTPRINT, priority: 0 },
];
export const MORE_BUTTON_WIDTH = 26 + DIVIDER_FOOTPRINT;
