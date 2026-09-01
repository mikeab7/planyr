/* Model workspace — the ribbon's responsive collapse math (Stage 2, B1007281).
 *
 * The owner's brief, verbatim: his real window is ~729 CSS px wide (he browses at ~215% page
 * zoom), and "a ribbon that only works at 1400px is a ribbon he cannot use." A real Excel-style
 * Home tab (Clipboard/Font/Borders/Alignment/Number/Cells/Sort&Filter) simply doesn't fit in
 * 729px of anything but icons — so GROUPS collapse into a trailing "More ▾" popover as the
 * available width shrinks, lowest-priority group first, exactly how Excel's own ribbon degrades
 * a window narrower than its groups' gallery of buttons.
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

// The real Home-tab groups, in display order. `width` is a generous estimate of the group's own
// natural inline width (icon buttons ~26px, dropdown triggers wider — see Ribbon.jsx for the
// actual controls each renders); `priority` decides collapse order, LOWEST collapsing first.
// Font and Clipboard are the two things kept visible the longest — a spreadsheet with no Bold
// button at all reads as broken in a way a spreadsheet with no visible Sort button does not.
// Display order matches the owner's own reading order (Stage 2 visual pass): Clipboard, Font,
// Alignment, Number, Borders, Cells, Sort & Filter — Borders sits AFTER Number here (display),
// while its `priority` still keeps it visible longer than Cells/Sort&Filter as width shrinks
// (collapse order and display order are independently decided — see computeRibbonLayout above).
export const RIBBON_GROUPS = [
  { key: "clipboard", label: "Clipboard", width: 62, priority: 6 },
  { key: "font", label: "Font", width: 300, priority: 7 },
  { key: "alignment", label: "Alignment", width: 288, priority: 3 },
  { key: "number", label: "Number", width: 268, priority: 4 },
  { key: "borders", label: "Borders", width: 112, priority: 5 },
  { key: "cells", label: "Cells", width: 238, priority: 2 },
  { key: "sortfilter", label: "Sort & Filter", width: 124, priority: 1 },
];
export const MORE_BUTTON_WIDTH = 46;
