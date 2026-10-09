/* canvasBox — the planner canvas's coordinate box, taken from its REAL measured rect.
 *
 * NEW-1 (owner report 2026-10-06: "as I resize the left menu, it literally shrinks everything
 * else on the site"). The canvas SVG is `width="100%" height="100%"` with
 * `viewBox="0 0 size.w size.h"` and the default `preserveAspectRatio` ("xMidYMid meet"). For years
 * `size` was FLOORED at 320 × 360 (`Math.max(320, r.width)`), so the moment the map pane got
 * narrower than 320 CSS px — a wide docked panel on a laptop-width or zoomed browser window — the
 * viewBox became wider than the element and the browser scaled the WHOLE drawing down to fit:
 * measured scale 0.79 at a 252-px pane, 0.475 at 152, 0.16 at 52, proportional to the pane width,
 * with `view.ppf` (and so the scale-bar label) unchanged. Same trap vertically under 360 tall.
 *
 * The rule: the viewBox IS the element's box, 1:1, at every size, so the drawing's screen scale is
 * always exactly `view.ppf`. The floor only ever existed to dress up a never-laid-out container,
 * and that guard now lives where it belongs — every FRAMING call site refuses a degenerate raw rect
 * itself (B1234400 / B1574432) — so the box only needs to stay positive.
 */

/** Smallest coordinate extent we ever hand the SVG — positive so no view maths divides by zero. */
export const CANVAS_MIN_PX = 1;

/** The canvas box from a measured rect (`getBoundingClientRect()` / ResizeObserver `contentRect`). */
export function canvasBox(rect) {
  const rawW = Number.isFinite(rect?.width) ? rect.width : 0;
  const rawH = Number.isFinite(rect?.height) ? rect.height : 0;
  return { w: Math.max(CANVAS_MIN_PX, rawW), h: Math.max(CANVAS_MIN_PX, rawH), rawW, rawH };
}

/** Same box, or the previous one when nothing changed (a functional `setSize` bail).
 *  B2233521 — and the previous one when the rect has NO AREA AT ALL: a 0 × 0 box is not a size, it is a planner that is not laid out (hidden
 *  behind the map view with `display:none`, or a kept planner detached from the page — lib/plannerKeepAlive.js). Taking it as the size made
 *  every hide/show a resize — a re-render at a degenerate box, the basemap re-synced, a whole tile grid re-requested — for a canvas whose real
 *  size never changed. A real pane, however narrow, has area and still passes straight through. */
export function nextCanvasSize(prev, rect) {
  const b = canvasBox(rect);
  if (prev && !(b.rawW > 0) && !(b.rawH > 0)) return prev;
  return prev && prev.w === b.w && prev.h === b.h && prev.rawW === b.rawW && prev.rawH === b.rawH ? prev : b;
}

/** Padding for a fit-to-content framing: the asked-for margin, shrunk on a narrow pane so the
 *  content always keeps at least half of the shorter side (a fixed 60-px margin on a 100-px pane
 *  would leave a negative drawable width). */
export function framePad(w, h, want = 60) {
  const short = Math.max(CANVAS_MIN_PX, Math.min(w, h));
  return Math.max(0, Math.min(want, short / 4));
}

/** Below this a left-edge change is layout noise, not a panel moving (the compensation threshold). */
export const EDGE_EPS = 0.01;

/** The canvas's left edge relative to its offset parent, EXACT (fractional). `Math.round(offsetLeft)` was
 *  the B2154768 shake: a fractional-wide panel (fractional pointer coords on a scaled Windows display) moved
 *  the edge by a fraction, the pan was corrected by the rounded integer, and the ±0.5 residual flipped per frame. */
export function canvasEdgeLeft(rectLeft, parentLeft) {
  const a = Number.isFinite(rectLeft) ? rectLeft : 0, b = Number.isFinite(parentLeft) ? parentLeft : 0;
  return a - b;
}
