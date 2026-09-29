/* cropHistory — the crop tool's in-session undo/redo, as pure functions (NEW-4, B<PENDING>).
 *
 * The tool used to keep a polygon-only undo stack in a ref: Ctrl+Z worked in Polygon mode, did
 * nothing in Rectangle mode, and there was no redo and no button. This is the shared model both
 * shapes now use. A snapshot is whatever the tool needs to put the picture back —
 * `{ mode, draft, pts, closed }` — and this module never looks inside one: it only orders them.
 *
 * Push clears the redo branch (a new action after an undo forgets the undone future, the standard
 * editor contract). `undoHistory`/`redoHistory` take the CURRENT snapshot so the step just left
 * lands on the opposite stack, and return null when there is nothing to step to — never a
 * half-formed result the caller could apply.
 */
export const HIST_CAP = 100; // an in-session recovery aid, not a persisted history

export const emptyHistory = () => ({ past: [], future: [] });

export function pushHistory(h, snap) {
  const past = [...h.past, snap];
  if (past.length > HIST_CAP) past.shift();
  return { past, future: [] };
}

export function undoHistory(h, current) {
  if (!h.past.length) return null;
  return {
    snap: h.past[h.past.length - 1],
    history: { past: h.past.slice(0, -1), future: [...h.future, current] },
  };
}

export function redoHistory(h, current) {
  if (!h.future.length) return null;
  return {
    snap: h.future[h.future.length - 1],
    history: { past: [...h.past, current], future: h.future.slice(0, -1) },
  };
}

export const canUndo = (h) => h.past.length > 0;
export const canRedo = (h) => h.future.length > 0;

// Zoom slider ↔ scale. Zoom is multiplicative, so the slider is logarithmic: equal travel is an
// equal zoom RATIO (a linear slider would spend nearly all its length between 1× and 16×).
export function scaleToSlider(scale, min, max) {
  const s = Math.min(max, Math.max(min, scale));
  return Math.log(s / min) / Math.log(max / min);
}
export function sliderToScale(t, min, max) {
  const c = Math.min(1, Math.max(0, t));
  return min * Math.pow(max / min, c);
}
