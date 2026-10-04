/* Which way the device faces, from whatever the platform offers. Pure — no window access — so the
 * three platform shapes are unit-testable away from a browser.
 *   iOS Safari   — `webkitCompassHeading`: degrees clockwise from magnetic north, already what we want.
 *   Android etc. — `deviceorientationabsolute` (or a `deviceorientation` with `absolute: true`):
 *                  `alpha` counter-clockwise from north, so heading = 360 − alpha. A plain relative
 *                  `deviceorientation` alpha is measured from an arbitrary start, NOT north, and is ignored.
 *   While moving — `coords.heading` (direction of travel), used only when no compass answer exists.
 * Returns degrees in [0, 360) or null — null means "draw no cone", never a guessed 0. */

export const MOVING_SPEED_MPS = 0.5; // below this a GPS "heading" is noise

const norm = (deg) => ((deg % 360) + 360) % 360;
const num = (v) => typeof v === "number" && Number.isFinite(v);

// event: a DeviceOrientationEvent-shaped object ({webkitCompassHeading, alpha, absolute}).
export function headingFromOrientation(event) {
  if (!event) return null;
  if (num(event.webkitCompassHeading)) return norm(event.webkitCompassHeading);
  if (event.absolute === true && num(event.alpha)) return norm(360 - event.alpha);
  return null;
}

// coords: GeolocationCoordinates-shaped ({heading, speed}).
export function headingFromCoords(coords) {
  if (!coords || !num(coords.heading)) return null;
  if (!num(coords.speed) || coords.speed < MOVING_SPEED_MPS) return null;
  return norm(coords.heading);
}

// Compass wins (it works standing still); travel direction is the fallback.
export function resolveHeading({ orientationHeading, coords } = {}) {
  if (num(orientationHeading)) return norm(orientationHeading);
  return headingFromCoords(coords);
}

// Shortest-arc blend so the cone never spins the long way round across north (359° → 1°).
export function smoothHeading(prev, next, k = 0.35) {
  if (!num(next)) return null;
  if (!num(prev)) return norm(next);
  const d = ((next - prev + 540) % 360) - 180;
  return norm(prev + d * k);
}
