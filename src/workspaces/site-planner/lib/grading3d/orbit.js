/* The 3D viewer's CAMERA (owner-only grading layer; NEW-1, 2026-11-11). PURE — no three.js, so the clamps are tests on numbers.
 *
 * Orbit (left drag), pan (right drag / shift-drag), zoom (wheel), with the clamps the owner asked for: "you can't flip under the model or
 * lose it". The camera looks at `target` from `dist` away, `az` around the vertical axis (0 = standing south of the site, looking north),
 * `el` above the horizon. `el` is held between EL_MIN and EL_MAX (never under the block, never past straight down); the distance between
 * a close-up and a few site-widths; the target inside the model's box grown a little — so the model can never leave the screen. */
export const FOV_DEG = 38;
export const EL_MIN = 0.09;              // ~5° above the horizon: the ground plane is always seen from above
export const EL_MAX = 1.53;              // ~88°: nearly straight down, never flipped
export const DEFAULT_AZ = 0.42, DEFAULT_EL = 0.62;

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

/* bounds: { cx, cy, cz, radius, minX, maxX, minY, maxY, minZ, maxZ } — the model's box in world units (Y already stretched). */
export function frame(bounds, aspect = 1.6, fovDeg = FOV_DEG) {
  const fov = (fovDeg * Math.PI) / 180;
  const fitV = bounds.radius / Math.sin(fov / 2);
  const fitH = bounds.radius / Math.sin(Math.atan(Math.tan(fov / 2) * Math.max(0.4, aspect)));
  const dist = Math.max(fitV, fitH) * 0.9;
  return { az: DEFAULT_AZ, el: DEFAULT_EL, dist, tx: bounds.cx, ty: bounds.cy, tz: bounds.cz, distMin: bounds.radius * 0.08, distMax: bounds.radius * 6 };
}
export function clampState(s, bounds) {
  const pad = bounds.radius * 0.35;
  return {
    ...s,
    el: clamp(s.el, EL_MIN, EL_MAX),
    dist: clamp(s.dist, s.distMin, s.distMax),
    tx: clamp(s.tx, bounds.minX - pad, bounds.maxX + pad),
    ty: clamp(s.ty, bounds.minY - pad, bounds.maxY + pad),
    tz: clamp(s.tz, bounds.minZ - pad, bounds.maxZ + pad),
  };
}
export function cameraPosition(s) {
  const ce = Math.cos(s.el);
  return { x: s.tx + s.dist * ce * Math.sin(s.az), y: s.ty + s.dist * Math.sin(s.el), z: s.tz + s.dist * ce * Math.cos(s.az) };
}
/* Left-drag: dx to the right swings the model with the pointer (the camera goes the other way); dragging DOWN lifts the camera toward straight-down and
 * dragging up lowers it toward the horizon (the OrbitControls convention). */
export function orbitBy(s, dxPx, dyPx, bounds, k = 0.0058) {
  return clampState({ ...s, az: s.az - dxPx * k, el: s.el + dyPx * k }, bounds);
}
/* Right-drag / shift-drag: slide the target in the screen plane. The ground moves under the pointer. */
export function panBy(s, dxPx, dyPx, viewportH, bounds, fovDeg = FOV_DEG) {
  const perPx = (2 * s.dist * Math.tan((fovDeg * Math.PI) / 360)) / Math.max(1, viewportH);
  const rx = Math.cos(s.az), rz = -Math.sin(s.az);                          // screen-right on the ground
  const fx = -Math.sin(s.az), fz = -Math.cos(s.az);                         // screen-up on the ground (away from the camera)
  const up = Math.sin(s.el);                                                // dragging up moves the ground up the screen: along the ground, scaled by the tilt
  return clampState({ ...s, tx: s.tx - dxPx * perPx * rx + dyPx * perPx * fx * up, tz: s.tz - dxPx * perPx * rz + dyPx * perPx * fz * up }, bounds);
}
export function zoomBy(s, wheelDelta, bounds, k = 0.0016) {
  return clampState({ ...s, dist: s.dist * Math.exp(wheelDelta * k) }, bounds);
}
/* The bounds of a model whose Y is scaled by `stretch`. */
export function boundsOf(box, stretch = 1) {
  const minY = box.minY * stretch, maxY = box.maxY * stretch;
  const cx = (box.minX + box.maxX) / 2, cz = (box.minZ + box.maxZ) / 2, cy = (minY + maxY) / 2;
  const radius = Math.hypot(box.maxX - box.minX, maxY - minY, box.maxZ - box.minZ) / 2;
  return { minX: box.minX, maxX: box.maxX, minY, maxY, minZ: box.minZ, maxZ: box.maxZ, cx, cy, cz, radius };
}
