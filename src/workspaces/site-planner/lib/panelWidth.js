/* panelWidth — the docked left panel's width, and the width it RESERVES in the layout.
 *
 * B2154768 (owner 2026-10-07: "it does make the map kind of shake when I expand the left panel"). Dragging the
 * grip wrote `startW + (clientX − startX)`. On a Windows display scaled 125%/150% the pointer reports FRACTIONAL
 * CSS px, so the panel — and with it the canvas's left edge, hence the Leaflet container — landed on a fraction
 * of a pixel that changed every frame. Leaflet snaps its tile lattice to whole device pixels relative to that
 * container, so the aerial hopped between sub-pixel phases and the drawing, welded to it (B1141), hopped too.
 * That fix snapped the width to a whole number of CSS px that is also a whole number of device px.
 *
 * NEW-2 (2026-10-08, "the shake itself seems better but is only there now if you're paying attention") — TWO
 * things were still wrong, both measured in PIXELS rather than element rects:
 *   1. The owner's display has NO small such step. His window reports devicePixelRatio ≈ 2.15 (innerWidth 1191 on
 *      a 2560 panel); the smallest whole-CSS-px run that is also whole device px is 20 CSS px (43 device), past
 *      the old search limit and its float tolerance (Chrome reports 2.1500000953674316), so the rule fell back to
 *      1 CSS px and did nothing. Every layer re-snapped on every drag step.
 *   2. The canvas edge needs BOTH units whole, not either one. Measured at 2.15: on a whole-DEVICE-px edge the
 *      drawing shifted ±0.45 device px in step with how far the edge sat from a whole CSS px (the SVG root's box
 *      is pixel-snapped in CSS px); on a whole-CSS-px edge it held perfectly still except for the shapes drawn
 *      snapped to the DEVICE grid (crisp building edges, corner markers), which jumped a device pixel.
 * A notch of 20 px would make the panel edge itself visibly notchy, so the two jobs are split: the panel PAINTS at
 * the width the pointer asks for (`snapPanelWidth`, whole CSS px), while the room it RESERVES in the row — and so
 * the canvas's left edge — moves only in whole notches (`panelFlowWidth`). The leftover (< one notch) paints over
 * the canvas's left edge. The basemap's box no longer follows the panel at all (SitePlanner `geoDockX`), so the
 * canvas edge is the only thing left that moves, and it moves only on a grid where nothing re-snaps. */

export const PANEL_MIN_W = 240;
export const PANEL_MAX_W = 620;
export const MAX_NOTCH_CSS = 40;   // 1.925× (110% zoom on 175%) needs 40; anything coarser falls back to whole CSS px
const NOTCH_TOL = 1e-4;            // device px — Chrome reports DPR as a float32 (2.15 → 2.1500000953674316)

/** Smallest n (1..max) with n × dpr a whole number of device px (within float noise) — 1 when none exists. */
export function cssStepForDpr(dpr, max = MAX_NOTCH_CSS) {
  const d = Number.isFinite(dpr) && dpr > 0 ? dpr : 1;
  for (let n = 1; n <= max; n++) { const v = n * d; if (Math.abs(v - Math.round(v)) < NOTCH_TOL) return n; }
  return 1;
}

/** The width the panel PAINTS at: whole CSS px, inside the grip's range. */
export function snapPanelWidth(raw, _dpr = 1, min = PANEL_MIN_W, max = PANEL_MAX_W) {
  const w = Number.isFinite(raw) ? raw : min;
  return Math.max(Math.ceil(min), Math.min(Math.floor(max), Math.round(w)));
}

/** The width the panel RESERVES in the row: `w` floored to the notch (whole CSS AND whole device px), never more
 *  than `w`, so the panel can only ever overlap the canvas, never leave a gap beside it. */
export function panelFlowWidth(w, dpr = 1) {
  const v = Number.isFinite(w) ? w : PANEL_MIN_W;
  const n = cssStepForDpr(dpr);
  return Math.floor(v / n) * n;
}
