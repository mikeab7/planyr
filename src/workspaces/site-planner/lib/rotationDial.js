/* rotationDial — the pure half of the Overlays panel's ROTATION DIAL (NEW-1, 2026-10-21).
 *
 * The dial is a small circle with a needle: 0° = straight up, positive = CLOCKWISE (the same sense the
 * overlay turns on the map and the same sense as the panel's number box and "Turn 90° clockwise").
 * Everything that is arithmetic lives here so it is unit-tested without a browser; the component only
 * reads the pointer, calls these, and writes the result through the panel's one patch handler.
 *
 *   dialAngleFromPoint  pointer position → degrees (null at the exact centre: no direction)
 *   dialDragAngle       the angle a drag writes: rounded to 0.1°, Shift snaps to 15° steps, wrapped
 *                       through 0/360 (359.96° is 0°, never "360")
 *   dialKeyDelta        the keyboard step: ±1°, Shift ±15°
 *   createDialDrag      ONE undo step per drag, however many pointer moves it takes
 *
 * Rotation is always stored in [0, 360); `normalizeDeg` is the same wrap the number box uses. */
import { normalizeDeg } from "../../../shared/ui/RotationStepper.jsx";

export const DIAL_TICKS = Object.freeze([0, 90, 180, 270]);
export const DIAL_SNAP_DEG = 15;
export const DIAL_FINE_STEP = 1;

// Wrap into [0, 360) THEN round to `digits` decimals (the modulo of a double leaves residue like 11.100000000000023,
// so rounding must come last), folding a rounded-up 360 back to 0 — the dial never shows or stores 360.
function wrapRound(deg, digits) {
  const k = 10 ** digits;
  const r = Math.round(normalizeDeg(deg) * k) / k;
  return r >= 360 ? 0 : r;
}

/** Pointer (px, py) → degrees about the dial centre (cx, cy). 0 = up, clockwise positive, in [0, 360).
 *  Screen y grows downward, so "up" is −y: atan2(dx, −dy). Returns null at the centre itself. */
export function dialAngleFromPoint(cx, cy, px, py) {
  const dx = px - cx, dy = py - cy;
  if (!Number.isFinite(dx) || !Number.isFinite(dy)) return null;
  if (dx === 0 && dy === 0) return null;
  return normalizeDeg((Math.atan2(dx, -dy) * 180) / Math.PI);
}

/** Snap an angle to the nearest multiple of `step` degrees (default 15), wrapped into [0, 360). */
export function snapDeg(deg, step = DIAL_SNAP_DEG) {
  return normalizeDeg(Math.round(deg / step) * step);
}

/** The angle a drag writes for a raw pointer angle: Shift → 15° steps, otherwise rounded to 0.1°.
 *  Rounding happens BEFORE the wrap so 359.96 → 360.0 → 0 (the dial never shows or stores 360). */
export function dialDragAngle(rawDeg, { shift = false } = {}) {
  if (!Number.isFinite(rawDeg)) return null;
  if (shift) return snapDeg(rawDeg);
  return wrapRound(rawDeg, 1);
}

/** Keyboard on the focused dial: ArrowRight/Up = +1° (clockwise), ArrowLeft/Down = −1°, Shift ×15. 0 = not ours. */
export function dialKeyDelta(key, shift = false) {
  const sign = key === "ArrowRight" || key === "ArrowUp" ? 1 : key === "ArrowLeft" || key === "ArrowDown" ? -1 : 0;
  if (!sign) return 0;
  return sign * (shift ? DIAL_SNAP_DEG : DIAL_FINE_STEP);
}

/** The rotation after a keyboard step, wrapped and trimmed of float residue. */
export function dialKeyAngle(current, key, shift = false) {
  const d = dialKeyDelta(key, shift);
  if (!d) return null;
  return wrapRound((Number(current) || 0) + d, 1);
}

/** `current` turned by `delta` degrees (±1 from the arrows, ±90 from the quarter-turn buttons), wrapped into
 *  [0, 360) and trimmed to hundredths so repeated steps never drift on float residue. */
export function stepRotation(current, delta) {
  return wrapRound((Number(current) || 0) + delta, 2);
}

/** The needle's far end for a rotation, in a viewBox centred on (c, c) with the needle `len` long. */
export function needleEnd(deg, c, len) {
  const a = (normalizeDeg(deg) * Math.PI) / 180;
  return { x: c + len * Math.sin(a), y: c - len * Math.cos(a) };
}

/** ONE UNDO STEP PER DRAG. `pushHistory` runs once, lazily, on the first move that actually changes the
 *  rotation (a press that lands on the current angle writes nothing and leaves no empty frame); every move
 *  after that patches with `hist: false`. `patch(deg, hist)` is the panel's one rotation writer.
 *  `getRotation` is read live so a second drag starts from wherever the first one ended. */
export function createDialDrag({ getRotation, pushHistory, patch }) {
  let pushed = false;
  let active = false;
  const write = (deg) => {
    if (deg == null) return false;
    if (deg === normalizeDeg(Number(getRotation()) || 0)) return false;
    if (!pushed) { pushHistory(); pushed = true; }
    patch(deg, false);
    return true;
  };
  return {
    down(deg) { pushed = false; active = true; return write(deg); },
    move(deg) { return active ? write(deg) : false; },
    up() { const had = pushed; active = false; pushed = false; return had; },
    get active() { return active; },
  };
}
