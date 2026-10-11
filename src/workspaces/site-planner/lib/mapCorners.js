/* mapCorners — WHERE the Site canvas's passive/active corner furniture sits, decided in ONE place.
 *
 * Owner, 2026-10-08 (NEW-1/NEW-2 of the "site map furniture" block): the north arrow, the "Scaled · county GIS" badge
 * and the coordinate chip drifted over the docked left panel while it was dragged, and the help "?", scale bar and
 * zoom stack floated at odd heights instead of sitting in the bottom-right corner.
 *
 * THE CAUSE OF THE DRIFT (measured, not guessed): the docked panel PAINTS at `leftWidth` (whole CSS px) but RESERVES
 * only `panelFlowWidth` (a notch whole in CSS AND device px — 20 CSS px at the owner's ≈2.15× display, see
 * lib/panelWidth.js). The canvas box therefore reaches left UNDER the panel by `leftOverlap` (0..one notch), and every
 * left-anchored item positioned against that box (`left: 14`) was painted partly under — or, being higher in z-order
 * than the panel, partly OVER — the panel's right edge. And because the box edge moves in whole notches while the panel
 * edge moves continuously, those items also jumped in steps.
 *
 * THE FIX: every left-anchored item is offset by `paneInset` (= the overlap while a docked column exists), so its
 * screen position is `panel edge + margin` on every frame — the same edge the panel itself paints at. Pure and
 * Node-testable; SitePlanner.jsx is the only caller.
 *
 * Bottom-right: one flex container owns the order and spacing of scale bar · help · zoom stack on a shared baseline
 * (so nothing can overlap by construction). Phone (`narrow`) keeps its own vertical arrangement — see SitePlanner.jsx. */

/** The one small, even margin from the pane's bottom/left (bottom-left group) and bottom/right (bottom-right group). */
export const MAP_CORNER_PX = 12;
/** Gap between neighbours inside the bottom-right group. */
export const MAP_CORNER_GAP_PX = 8;
/** The coordinate chip is decorative telemetry: below this width it yields (hides) rather than overlap a control. */
export const CURSOR_CHIP_MIN_W_PX = 110;

/** How far the left-anchored furniture is pushed right of the canvas box's own left edge. Zero unless a desktop
 *  docked column is actually in flow (a floating/portaled panel steals no layout width; a phone panel overlays). */
export function paneInsetFor({ narrow, docked, overlap }) {
  if (narrow || !docked) return 0;
  return Number.isFinite(overlap) && overlap > 0 ? overlap : 0;
}

/** Width of the desktop bottom-right group: scale bar · help · zoom stack with `gap` between neighbours. */
export function cornerGroupWidth({ scaleBarW = 0, helpW = 0, zoomW = 0, gap = MAP_CORNER_GAP_PX }) {
  const parts = [scaleBarW, helpW, zoomW].filter((w) => w > 0);
  return parts.reduce((a, w) => a + w, 0) + gap * Math.max(0, parts.length - 1);
}

/** The coordinate chip's fit beside the bottom-right group on the SAME bottom row. It truncates first (its coordinate
 *  span already ellipsises ahead of the elevation readout) and, when even the minimum does not fit, hides.
 *  `visW` is the VISIBLE pane width (canvas box minus the inset). */
export function cursorChipFit({ visW, groupW, corner = MAP_CORNER_PX, gap = MAP_CORNER_GAP_PX, minW = CURSOR_CHIP_MIN_W_PX }) {
  const avail = Math.floor(visW - corner - corner - groupW - gap);
  if (!(avail >= minW)) return { show: false, maxWidth: 0 };
  return { show: true, maxWidth: avail };
}

/* ── Rect predicates (used by the unit test AND by the ui-audit harnesses, so both judge the same way) ── */
const EPS = 0.5;
export const rectOf = (r) => ({ left: r.left, top: r.top, right: r.right ?? r.left + r.width, bottom: r.bottom ?? r.top + r.height });
/** `inner` lies fully inside `outer` (within half a pixel — sub-pixel snapping is not a defect). */
export function rectInside(inner, outer, eps = EPS) {
  const a = rectOf(inner), b = rectOf(outer);
  return a.left >= b.left - eps && a.right <= b.right + eps && a.top >= b.top - eps && a.bottom <= b.bottom + eps;
}
/** Overlap area of two rects, ignoring a sub-`eps` kiss. */
export function rectOverlap(x, y, eps = EPS) {
  const a = rectOf(x), b = rectOf(y);
  const w = Math.min(a.right, b.right) - Math.max(a.left, b.left);
  const h = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
  return w > eps && h > eps ? w * h : 0;
}
