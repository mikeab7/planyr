/* Model workspace — the sheet's own zoom level (B1007280, owner verbatim: "ctrl zoom should be
 * captured by the spreadsheet not the webpage").
 *
 * Ctrl+wheel (Cmd+wheel on Mac) over the grid used to zoom the whole BROWSER PAGE — every
 * control in the toolbar, the formula bar, the whole app chrome, right along with the sheet.
 * That matters more here than in most of this app: the owner runs his browser at roughly 215%
 * page zoom, which is why his window reads as only ~729 CSS px wide and why the toolbar
 * overflows in the first place — a spreadsheet that hijacks the ONE zoom gesture people reach
 * for reflexively, and applies it to the wrong thing, makes that problem worse every time he
 * uses it. The fix is a SHEET-OWN zoom: it scales the grid's rows/columns/text, never the
 * chrome around it, and it is captured only over the grid itself (the toolbar/formula bar are
 * untouched — Ctrl+wheel there still does whatever the browser normally does).
 *
 * Kept pure and DOM-free here so the clamp/step math is unit-tested without mounting anything;
 * the wheel-event wiring (which needs a real, non-passive DOM listener — see SheetView.jsx's
 * own note on why a React onWheel prop can't preventDefault a page zoom) lives there.
 */

export const MIN_ZOOM = 0.5;
export const MAX_ZOOM = 2;
export const DEFAULT_ZOOM = 1;

export function clampZoom(z) {
  const n = Number(z);
  if (!Number.isFinite(n)) return DEFAULT_ZOOM;
  return Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, n));
}

/** One wheel tick's worth of zoom change, from the SIGNED pixel delta a real `wheel` event
 *  reports (negative = scrolled up/away = zoom IN, matching every zoom-on-scroll convention in
 *  this app and every map/image viewer). Exponential rather than linear so a mouse wheel's
 *  large, sparse deltas and a trackpad's small, frequent ones both feel proportionate — a
 *  trackpad's 600 small ticks across a gesture end up at roughly the same zoom a mouse wheel's
 *  6 large ticks would, rather than the trackpad crawling or the mouse wheel overshooting. */
export function zoomFromWheelDelta(current, deltaY) {
  const factor = Math.pow(1.0015, -deltaY);
  return clampZoom(current * factor);
}

/** One click of a +/− zoom button — a fixed, predictable 10% step (Excel's own zoom-button
 *  granularity), unlike the wheel's continuous factor. */
export function zoomStepButton(current, dir) {
  return clampZoom(current + dir * 0.1);
}

const KEY_PREFIX = "planyr:model:zoom:v1:";

/** The zoom level is a VIEW preference, not sheet data — it never rides the undo stack and
 *  never syncs to the cloud (two people looking at the same underwriting model have no reason
 *  to share a zoom level, any more than two browser tabs share a browser-zoom setting). Kept
 *  per-project in localStorage instead, the same tier `TIER-BY-REBUILDABILITY` (CLAUDE.md)
 *  reserves for small, per-device UI state — this is a handful of bytes, nothing to budget. */
export function readZoom(projectId) {
  if (!projectId || typeof localStorage === "undefined") return DEFAULT_ZOOM;
  try {
    const raw = localStorage.getItem(KEY_PREFIX + projectId);
    return raw == null ? DEFAULT_ZOOM : clampZoom(JSON.parse(raw));
  } catch (_) {
    return DEFAULT_ZOOM;
  }
}

export function writeZoom(projectId, zoom) {
  if (!projectId || typeof localStorage === "undefined") return;
  try { localStorage.setItem(KEY_PREFIX + projectId, JSON.stringify(clampZoom(zoom))); } catch (_) { /* best-effort */ }
}
