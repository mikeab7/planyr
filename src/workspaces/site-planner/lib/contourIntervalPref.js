/* Contour Lines — the INTERVAL (1 / 2 / 5 / 10 ft), a DEVICE-LEVEL preference (NEW-1, Imagery &
 * Layers redesign).
 *
 * WHY DEVICE, not per-site: `layerOverrides` is a sparse boolean map read by undo frames, merges and
 * the cloud row, so a number there would be a new site-model field for a presentation taste (the
 * roadNamesPref.js reasoning). The interval is "how finely do I like my contours drawn" — it follows
 * the person on this browser, across every plan and the map finder.
 *
 * One module-level store with a subscription so the Layers row (which shows the value), the terrain
 * layer (which traces it) and a second mounted surface all see one answer. Every storage access is
 * guarded — a blocked or empty store yields the 1-ft default. */
import { normalizeContourInterval, DEFAULT_CONTOUR_INTERVAL } from "./layerPanelModel.js";

export const CONTOUR_INTERVAL_KEY = "planyr:contourInterval";

let current = null;
const subs = new Set();

function read() {
  try {
    const raw = typeof localStorage !== "undefined" ? localStorage.getItem(CONTOUR_INTERVAL_KEY) : null;
    return normalizeContourInterval(raw == null ? DEFAULT_CONTOUR_INTERVAL : raw);
  } catch (_) { return DEFAULT_CONTOUR_INTERVAL; }
}

export function getContourInterval() {
  if (current == null) current = read();
  return current;
}

export function setContourInterval(v) {
  const next = normalizeContourInterval(v);
  if (next === getContourInterval()) return next;
  current = next;
  try { if (typeof localStorage !== "undefined") localStorage.setItem(CONTOUR_INTERVAL_KEY, String(next)); } catch (_) { /* per-viewer convenience only */ }
  subs.forEach((cb) => { try { cb(next); } catch (_) { /* a subscriber must never break the write */ } });
  return next;
}

export function subscribeContourInterval(cb) { subs.add(cb); return () => subs.delete(cb); }
export function _resetContourInterval() { current = null; } // tests only
