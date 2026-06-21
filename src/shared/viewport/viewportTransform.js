/* Shared viewport transform engine (B329).
 *
 * ONE pan/zoom model for every canvas in the app. The Site Planner map and the
 * Document Review ("Markup") sheet both drive their viewport through these pure
 * functions, so "zoom toward the cursor" and "pan by a screen delta" mean exactly
 * the same thing in both places and can never quietly drift apart. This is the
 * single implementation the two modules share — neither rolls its own.
 *
 * A `view` is { scale, tx, ty }:
 *   scale = pixels per world-unit  (feet in the Site Planner; PDF page-units in Markup)
 *   tx,ty = where the world origin (0,0) sits, in viewport screen pixels
 *
 *   screen = world * scale + t        (worldToScreen)
 *   world  = (screen - t) / scale     (screenToWorld)
 *
 * This is identical to the Site Planner's long-standing { ppf, offX, offY } — that
 * module maps ppf→scale, offX→tx, offY→ty and gets byte-for-byte the same numbers.
 *
 * Pure + framework-agnostic on purpose: no React, no DOM, fully unit-testable. The
 * per-module event wiring (which DOM element, pointer capture, etc.) stays in each
 * host; only the math + the pan/tool collision rule live here.
 */

// Clamp to [lo,hi]. Finite-SAFE on purpose: a NaN input (e.g. a 0/0 pinch ratio
// from two fingers landing on the same pixel) returns `lo` instead of poisoning the
// result with NaN. This is the single chokepoint that guarantees `scale` is always a
// finite, in-range number — which in turn keeps every screenToWorld coordinate finite,
// so a measured markup can never serialize to `null` (JSON.stringify turns NaN→null)
// and silently lose a user's work. ±Infinity already clamp correctly via Math.min/max.
export const clampNum = (n, lo, hi) => (Number.isNaN(+n) ? lo : Math.max(lo, Math.min(hi, +n)));

// Coerce a screen-space scalar (a pointer/anchor coord or a pan delta) to a finite
// number. Pointer coords are always finite in practice; this just guarantees a stray
// NaN anchor (null bounding rect, mid-mount) can't leak into tx/ty and poison the view.
const fin0 = (n) => (Number.isFinite(n) ? n : 0);

// world point -> screen pixels (relative to the viewport's top-left).
export const worldToScreen = (v, p) => ({ x: p.x * v.scale + v.tx, y: p.y * v.scale + v.ty });

// screen pixels (relative to the viewport's top-left) -> world point.
// `v.scale || 1` is a no-op for any real view (a valid scale is a nonzero finite
// number) but stops a degenerate scale of 0 / NaN from dividing a coordinate to
// Infinity / NaN — which would corrupt to `null` on save. Defense in depth: our own
// emit functions already keep scale finite & ≥ min, so this only ever guards a
// hand-built or not-yet-initialized view.
export const screenToWorld = (v, p) => ({ x: (p.x - v.tx) / (v.scale || 1), y: (p.y - v.ty) / (v.scale || 1) });

/* Zoom by `factor` about a screen-space anchor (ax,ay), holding the world point
 * currently under that anchor fixed — the cursor-anchored zoom both canvases use.
 * Pass the viewport-centre as the anchor for the +/- buttons. The new scale is
 * clamped to [min,max]; when the clamp bites, the anchored world point still stays
 * put (we re-derive the offset from the clamped scale). */
export function zoomAround(v, factor, ax, ay, min = 0.02, max = 8) {
  const x = fin0(ax), y = fin0(ay);
  const w = screenToWorld(v, { x, y });
  const scale = clampNum(v.scale * factor, min, max);
  return { scale, tx: x - w.x * scale, ty: y - w.y * scale };
}

// Pan by a screen-pixel delta (a drag). Scale is unchanged.
export const panBy = (v, dx, dy) => ({ scale: v.scale, tx: v.tx + fin0(dx), ty: v.ty + fin0(dy) });

/* Fit a world-space box (boxW×boxH world units) inside a viewport (vw×vh px) with
 * `pad` px of margin, centred. mode 'width' fits the width only (height may overflow);
 * 'page' fits the whole box (min of the two). Returns a fresh view. */
export function fitView(boxW, boxH, vw, vh, { pad = 12, min = 0.02, max = 8, mode = "page" } = {}) {
  // Sanitize every input to a finite, sane value so a NaN/Infinity box or viewport
  // (a half-measured sheet, a 0×0 container mid-mount) can't emit a NaN view.
  const fin = (n, d) => (Number.isFinite(n) ? n : d);
  const safeW = Math.max(1, fin(boxW, 1)), safeH = Math.max(1, fin(boxH, 1));
  const W = Math.max(0, fin(vw, 0)), H = Math.max(0, fin(vh, 0));
  const sw = (W - pad * 2) / safeW;
  const sh = (H - pad * 2) / safeH;
  const scale = clampNum(mode === "width" ? sw : Math.min(sw, sh), min, max);
  return { scale, tx: (W - safeW * scale) / 2, ty: (H - safeH * scale) / 2 };
}

/* Bluebeam pan/tool collision rule — given a pointerdown, should it start a PAN
 * instead of the active tool's action?
 *   • middle-mouse (button 1) → always pans, whatever the tool
 *   • Space held               → temporary hand-pan over any tool
 *   • the Pan/hand tool        → pans
 *   • Select on EMPTY canvas   → pans;  Select on an object → select/move it (not a pan)
 *   • any drawing/measure tool → draws, never pans
 * `button` is the pointer/mouse button (0 left, 1 middle). */
export function shouldPan({ button = 0, spaceHeld = false, tool = "select", onObject = false } = {}) {
  if (button === 1) return true;
  if (spaceHeld) return true;
  if (tool === "pan") return true;
  if (tool === "select") return !onObject;
  return false;
}

/* ---- two-finger touch pinch (B331) ---- */
// Midpoint + distance between two screen points (viewport-relative). A pinch gesture is
// described by its midpoint moving + the finger distance changing frame to frame.
export const midpoint = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
export const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

/* Apply one frame of a two-finger pinch. Zoom by `factor` (= currentFingerDist /
 * previousFingerDist) about the gesture's PREVIOUS midpoint (so the sheet under the
 * fingers stays under them), then translate so that anchored world point follows the
 * fingers to the CURRENT midpoint — i.e. a pinch both zooms AND pans, like every map.
 * `prevMid`/`currMid` are viewport-relative screen points. This is the touch counterpart
 * of `zoomAround` (which the wheel/trackpad-pinch path already uses). */
export function pinchZoom(v, prevMid, currMid, factor, min = 0.02, max = 8) {
  const w = screenToWorld(v, { x: fin0(prevMid.x), y: fin0(prevMid.y) }); // world point under the fingers last frame
  const cx = fin0(currMid.x), cy = fin0(currMid.y);
  const scale = clampNum(v.scale * factor, min, max);
  return { scale, tx: cx - w.x * scale, ty: cy - w.y * scale };
}
