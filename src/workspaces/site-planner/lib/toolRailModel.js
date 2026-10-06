/* toolRailModel.js — NEW-1 (right tool rail): the pure half of "show each tool's current size in the
 * rail without opening its menu". No React, no DOM — Node-testable.
 *
 * What lives here, and why it is not in the component:
 *   · the VALUE each ▾ pill shows (road width / parking stall) and the words around it — the hover
 *     tooltip and the screen-reader label say the same fact the pill shows, from one function, so the
 *     three can never disagree;
 *   · the dock-layout KIND the Building icon draws;
 *   · the HEADING spacing system. The owner's main complaint was that a heading floated midway between
 *     two groups. The rule is stated once, as numbers, and the browser harness measures the real DOM
 *     against them (ui-audit/verify-rail-values.mjs) — never the other way round.
 *
 * Values are read from the SAME fields the Standards panel edits (`settings.stallW/stallDepth`,
 * `settings.trailerW/trailerL`) and the same road state the Road menu writes (`roadWidth`,
 * `roadXSection`) — a second copy of any of them is the stale-copy defect the repo's
 * single-source-of-truth rule exists to prevent. Nothing here stores anything.
 */

const FT = "′"; // ′  the foot mark the rail already uses everywhere

/** 36 → "36′", 28.5 → "28.5′", 28.50 → "28.5′". Non-finite / non-positive → null (never "0′"). */
export function fmtFeet(n) {
  const v = +n;
  if (!Number.isFinite(v) || v <= 0) return null;
  const r = Math.round(v * 10) / 10;
  return `${Number.isInteger(r) ? r : r.toFixed(1)}${FT}`;
}

const bare = (s) => s.slice(0, -1); // "36′" → "36"

/** "9′×18′" — a stall's width × depth, or null if either is missing (the pill then shows plain ▾). */
export function fmtStall(w, d) {
  const a = fmtFeet(w), b = fmtFeet(d);
  return a && b ? `${a}×${b}` : null;
}

/**
 * The Road row's pill. A typed cross-section wins over the plain width (that is what the tool will
 * actually draw), so its curb-to-curb number is what shows.
 *   → { text, title, aria } | null
 */
export function roadPill({ roadWidth, xsectionWidth } = {}) {
  const xs = fmtFeet(xsectionWidth);
  if (xs) return { text: xs, title: `Road width: ${xs} (cross-section) · click to change`, aria: `Road presets, current width ${bare(xs)} feet, cross-section` };
  const w = fmtFeet(roadWidth);
  if (!w) return null;
  return { text: w, title: `Road width: ${w} · click to change`, aria: `Road presets, current width ${bare(w)} feet` };
}

/**
 * The Parking row's pill. Car parking shows the stall (W×D); with trailer parking remembered as the
 * row's kind it shows the trailer stall instead, because that is what a press of the row arms.
 */
export function parkingPill({ kind, stallW, stallDepth, trailerW, trailerL } = {}) {
  if (kind === "trailer") {
    const t = fmtStall(trailerW, trailerL);
    if (!t) return null;
    const [a, b] = [fmtFeet(trailerW), fmtFeet(trailerL)];
    return { text: t, title: `Trailer stall: ${a} × ${b} · click to change`, aria: `Parking type, trailer stall ${bare(a)} by ${bare(b)} feet` };
  }
  const s = fmtStall(stallW, stallDepth);
  if (!s) return null;
  const [a, b] = [fmtFeet(stallW), fmtFeet(stallDepth)];
  return { text: s, title: `Parking stall: ${a} × ${b} · click to change`, aria: `Parking type, stall ${bare(a)} by ${bare(b)} feet` };
}

/** Dock layout → the glyph the Building icon draws. Anything unknown draws the plain rectangle. */
export function dockGlyphKind(dock) {
  return dock === "cross" ? "cross" : dock === "single" ? "single" : "none";
}
export const DOCK_WORDS = { cross: "cross-dock, two sides", single: "single-load, one side", none: "no docks" };
export function buildingPill(dock) {
  const k = dockGlyphKind(dock);
  return { kind: k, title: `Dock layout: ${DOCK_WORDS[k]} · click to change`, aria: `Dock layout, current ${DOCK_WORDS[k]}` };
}

/* ── Heading spacing ───────────────────────────────────────────────────────────────────────────────
 * Everything is in CSS px and describes the DEFAULT 12px row. `ink` gaps are the visible white space
 * between the letters of two adjacent items, which is what the eye compares; box gaps are what CSS
 * sets. A text line's ink is shorter than its box, so both are modelled, and the browser harness
 * asserts the real boxes equal these (so the model cannot drift from the page).
 */
export const RAIL = Object.freeze({
  rowH: 27,          // a tool row's height — unchanged from before this item
  flexGap: 3,        // the rail's column gap between any two siblings — unchanged
  rowCapH: 8.7,      // Inter 12px cap-height, rounded; the ink inside a row
  hdrH: 12,          // heading line box
  hdrCapH: 7.6,      // Inter 10.5px cap-height
  hdrMarginTop: 22,  // visible white space ABOVE a heading is this + flexGap (+ ink insets)
  hdrMarginBottom: 4,
  hdrFirstMarginTop: 4,
});

/** Ink-to-ink white space (px) around a heading, plus the tool-to-tool reference. */
export function headingInkGaps(r = RAIL) {
  const rowInset = (r.rowH - r.rowCapH) / 2;
  const hdrInset = (r.hdrH - r.hdrCapH) / 2;
  return {
    toolToTool: rowInset + r.flexGap + rowInset,
    above: rowInset + r.flexGap + r.hdrMarginTop + hdrInset,
    below: hdrInset + r.hdrMarginBottom + r.flexGap + rowInset,
  };
}
