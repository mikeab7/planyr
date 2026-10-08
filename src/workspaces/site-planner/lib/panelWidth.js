/* panelWidth — the docked left panel's width, snapped so the canvas's left edge stays on the DEVICE-PIXEL grid.
 *
 * B2154768 (owner 2026-10-07: "it does make the map kind of shake when I expand the left panel"). Dragging the
 * grip wrote `startW + (clientX − startX)`. On a Windows display scaled 125%/150% the pointer reports FRACTIONAL
 * CSS px, so the panel — and with it the canvas's left edge, hence the Leaflet container — landed on a fraction
 * of a pixel that changed every frame. Leaflet snaps its tile lattice to whole device pixels relative to that
 * container, so the aerial hopped between sub-pixel phases (measured: 0.33 / 0.67 px steps in a repeating
 * three-frame cycle) and the drawing, which is welded to the tile lattice on purpose (B1141), hopped with it.
 *
 * The fix is to never ask the layout for a fractional device pixel: the width is a multiple of the smallest
 * whole number of CSS px that is also a whole number of DEVICE px (4 px at 125%, 2 px at 150%, 1 px at 100%/200%).
 * The canvas edge then has the SAME sub-pixel phase on every frame, so nothing re-snaps while dragging. */

export const PANEL_MIN_W = 240;
export const PANEL_MAX_W = 620;

/** Smallest n (1..max) with n × dpr a whole number of device px — 1 when dpr is unreadable or no such n exists. */
export function cssStepForDpr(dpr, max = 20) {
  const d = Number.isFinite(dpr) && dpr > 0 ? dpr : 1;
  for (let n = 1; n <= max; n++) { const v = n * d; if (Math.abs(v - Math.round(v)) < 1e-6) return n; }
  return 1;
}

/** Clamp to the grip's range AFTER snapping to the device-pixel step (the clamp bounds are themselves on the grid). */
export function snapPanelWidth(raw, dpr = 1, min = PANEL_MIN_W, max = PANEL_MAX_W) {
  const step = cssStepForDpr(dpr);
  const w = Number.isFinite(raw) ? raw : min;
  const lo = Math.ceil(min / step) * step, hi = Math.floor(max / step) * step;
  return Math.max(lo, Math.min(hi, Math.round(w / step) * step));
}
