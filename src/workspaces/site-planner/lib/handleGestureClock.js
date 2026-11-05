/* handleGestureClock — "a placement-handle drag JUST ended" (NEW-2 follow-up, B2163346).
 *
 * Releasing a move/scale/rotate drag over the map makes the browser dispatch a `click` to the common ancestor of the press and
 * the release — i.e. the Leaflet map itself — and MapFinder's map-level click treats an unclaimed click as "background: deselect
 * the armed site plan". Net effect (measured live on planyr.io, a real mouse drag via the browser driver): every handle drag
 * disarmed the overlay the instant it was released, so the handles vanished after each resize/rotate and had to be re-armed
 * from the panel. The image's OWN click already stops propagation (B848496 NEW-2); a handle gesture's release did not.
 *
 * `markGestureEnd()` is called by the handles on release; the map's background-click handler asks `gestureJustEnded()` and
 * ignores that one click. Pure (an injectable clock), no DOM. The window is short on purpose: a genuine background click a
 * moment later still deselects.
 */
export const GESTURE_CLICK_GRACE_MS = 400;
let lastEnd = -Infinity;
export function markGestureEnd(now = Date.now()) { lastEnd = now; }
export function gestureJustEnded(now = Date.now(), graceMs = GESTURE_CLICK_GRACE_MS) { return now - lastEnd >= 0 && now - lastEnd < graceMs; }
export function _resetGestureClock() { lastEnd = -Infinity; }
