/* canvasGuess — the planner canvas's last MEASURED box, remembered across page loads (B2233521, round 5). Pure: storage and window geometry are passed in.
 *
 * WHY. Within a session `lastMeasuredCanvas` (SitePlanner.jsx) makes a plan switch's first render the one that is kept: the view starts at the framing the boot
 * framing is about to compute, so nothing is re-rendered. A page that has just been opened had no such memory, so its first render ran at a placeholder box and the
 * default view and the boot framing then re-rendered EVERY element at the real view — a second full render of the plan inside the cold load (~250 ms at 2× on Bolt-on,
 * measured). The measurement is now stored with the window geometry it was taken in and offered as the guess ONLY when this window has the same size and pixel ratio.
 *
 * IT IS A GUESS, NEVER A MEASUREMENT. The boot framing still measures the real box, still owns the reveal (owner constraint #8 — the canvas stays hidden until `fit()`
 * runs against a measured box) and re-frames exactly as before when the guess was wrong, so a stale / foreign / corrupt entry costs what the placeholder cost and no more.
 */
export const CANVAS_GUESS_KEY = "planarfit:canvasGuess:v1";

const finite = (n) => typeof n === "number" && Number.isFinite(n);
const sigOf = (m, g) => JSON.stringify([m.box, m.dockX, m.toastCx, g.vw, g.vh, g.dpr]);

/** The window geometry a measurement is only valid in. */
export const geometryOf = (win) => (win ? { vw: win.innerWidth, vh: win.innerHeight, dpr: win.devicePixelRatio || 1 } : null);

/** Read the remembered guess for THIS window, or null. Returns `{ guess, sig }` (sig = what is already stored, so an unchanged measurement is not re-written). */
export function readCanvasGuess(storage, geom) {
  try {
    if (!storage || !geom) return null;
    const raw = storage.getItem(CANVAS_GUESS_KEY);
    if (!raw) return null;
    const o = JSON.parse(raw);
    if (!o || o.vw !== geom.vw || o.vh !== geom.vh || o.dpr !== geom.dpr) return null;
    const b = o.box;
    if (!b || !(b.w > 1) || !(b.h > 1) || !finite(b.rawW) || !finite(b.rawH) || !finite(o.dockX) || !(o.toastCx === null || finite(o.toastCx))) return null;
    const guess = { box: { w: b.w, h: b.h, rawW: b.rawW, rawH: b.rawH }, dockX: o.dockX, toastCx: o.toastCx };
    return { guess, sig: sigOf(guess, geom) };
  } catch (_) { return null; }   // a hint: unreadable / foreign storage means "no guess", exactly the old behaviour
}

/** Remember a full measurement. Returns the signature now stored (pass it back as `lastSig`), writing only when the measurement changed. Never throws. */
export function writeCanvasGuess(storage, geom, m, lastSig) {
  try {
    if (!storage || !geom || !m || !m.box || !(m.box.w > 1) || !(m.box.h > 1) || !finite(m.dockX)) return lastSig;
    const sig = sigOf(m, geom);
    if (sig === lastSig) return lastSig;
    storage.setItem(CANVAS_GUESS_KEY, JSON.stringify({ ...geom, box: m.box, dockX: m.dockX, toastCx: m.toastCx }));
    return sig;
  } catch (_) { return lastSig; }   // a full / blocked store only costs the next page load its guess
}
