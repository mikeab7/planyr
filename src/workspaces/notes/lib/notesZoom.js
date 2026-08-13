/* notesZoom — how big the writing is, decided once (NEW-3).
 *
 * PURE. The steps, the clamp, what a wheel notch or a keystroke means, and where the level is
 * persisted. No DOM, no React — so every rule below is a unit test rather than something you
 * have to open a browser to find out.
 *
 * ⛔ THE DOCUMENT ZOOMS, THE APP DOES NOT. This scales the written page and nothing else: not
 * the rail, not the toolbar, not the header. That is the whole point — the browser's own page
 * zoom already scales everything together, and doing it again would just be a second, worse
 * copy of a control the browser has. What it does not have is "make the WRITING bigger and
 * leave my navigation where it is".
 *
 * ⛔ AND THE BROWSER'S ZOOM IS SUPPRESSED FOR THESE GESTURES, deliberately. Ctrl+wheel and
 * Ctrl+= are the browser's shortcuts too, so leaving them alone would mean one gesture
 * quietly doing two contradictory things — the app scaling the sheet while Chrome scales the
 * app around it. The host calls `preventDefault`; that is not incidental, it is the feature.
 */

/** The steps, in the order the keyboard walks through them. Ratios people recognise from
 *  every other document tool rather than a smooth slider: a level you can name is a level you
 *  can get back to. */
export const ZOOM_STEPS = [0.5, 0.67, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3];
export const ZOOM_DEFAULT = 1;
export const ZOOM_MIN = ZOOM_STEPS[0];
export const ZOOM_MAX = ZOOM_STEPS[ZOOM_STEPS.length - 1];

/** Where the level lives. Per SCOPE, like every other notes key, so two accounts on one
 *  machine do not inherit each other's eyesight. */
export const ZOOM_KEY_BASE = "planyr:notes:zoom:v1";
export const zoomKey = (scope) => `${ZOOM_KEY_BASE}:${scope || "local"}`;

const clamp = (z) => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, z));

/** Read a stored level back, refusing anything that is not a real number in range — a corrupt
 *  value must land on 100%, never on an unreadable page. */
export function normalizeZoom(value) {
  const n = typeof value === "number" ? value : parseFloat(value);
  if (!Number.isFinite(n) || n <= 0) return ZOOM_DEFAULT;
  return clamp(n);
}

/** The next step up or down. Snaps onto the ladder from anywhere, so a level restored from an
 *  older build (or nudged by a wheel) still steps to a recognisable number. */
export function stepZoom(current, direction) {
  const z = normalizeZoom(current);
  if (direction > 0) return ZOOM_STEPS.find((s) => s > z + 1e-6) ?? ZOOM_MAX;
  return [...ZOOM_STEPS].reverse().find((s) => s < z - 1e-6) ?? ZOOM_MIN;
}

/** What a Ctrl+wheel notch means. Proportional rather than a fixed step, so a trackpad's many
 *  small deltas feel continuous and a mouse's one big detent still moves a useful amount —
 *  the same reasoning as the planner's own wheel zoom. */
export function zoomForWheel(current, deltaY, { deltaMode = 0 } = {}) {
  if (!Number.isFinite(deltaY) || deltaY === 0) return normalizeZoom(current);
  // A "line" or "page" delta is a different unit entirely; normalise it to pixels first.
  const px = deltaMode === 1 ? deltaY * 16 : deltaMode === 2 ? deltaY * 400 : deltaY;
  const factor = Math.exp(-px / 400);
  return clamp(normalizeZoom(current) * factor);
}

/** What a keystroke means, or null when this is not one of ours and must be left alone.
 *  ⛔ `Ctrl+0` RETURNS TO 100%, NOT TO "THE LEVEL YOU STARTED THE SESSION AT". Reset means one
 *  known place, the same one every time, in every application anybody has ever used. */
export function zoomForKey(current, { key, ctrlKey, metaKey, shiftKey, altKey } = {}) {
  if (!(ctrlKey || metaKey) || altKey) return null;
  if (key === "0") return ZOOM_DEFAULT;
  // The unshifted keys are "=" and "-"; a keyboard where "+" needs Shift sends "+" instead,
  // and a numeric keypad sends "Add"/"Subtract". All of them mean the same thing.
  if (key === "=" || key === "+" || key === "Add") return stepZoom(current, +1);
  if (key === "-" || key === "_" || key === "Subtract") return stepZoom(current, -1);
  if (shiftKey) return null;
  return null;
}

/** "125%" — how the level is said out loud, once, so the control and any test agree. */
export const zoomLabel = (z) => `${Math.round(normalizeZoom(z) * 100)}%`;

/** ⛔ KEEP THE SAME WRITING UNDER THE EYE ACROSS A STEP (VIEWPORT-STABLE).
 *
 *  Zooming a document that scrolls will, left alone, throw the reader somewhere else: the
 *  content above the viewport gets taller or shorter, so the same `scrollTop` now points at a
 *  different paragraph. The fix is not a guess — the anchor's distance from the top of the
 *  scroller is a known quantity before and after, so the new scroll position is arithmetic.
 *
 *  `anchorOffset` is the anchor's offset from the TOP OF THE CONTENT (unzoomed), and
 *  `viewportOffset` is where it was sitting on screen. Returns the scrollTop that puts it
 *  back in the same place. */
export function scrollTopAfterZoom({ anchorOffset, viewportOffset, from, to }) {
  const a = Number.isFinite(anchorOffset) ? anchorOffset : 0;
  const v = Number.isFinite(viewportOffset) ? viewportOffset : 0;
  const f = normalizeZoom(from);
  const t = normalizeZoom(to);
  if (f === t) return null;                       // nothing moved; do not touch the scroller
  return Math.max(0, a * t - v);
}
