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

export const clampNum = (n, lo, hi) => Math.max(lo, Math.min(hi, n));

// world point -> screen pixels (relative to the viewport's top-left).
export const worldToScreen = (v, p) => ({ x: p.x * v.scale + v.tx, y: p.y * v.scale + v.ty });

// screen pixels (relative to the viewport's top-left) -> world point.
export const screenToWorld = (v, p) => ({ x: (p.x - v.tx) / v.scale, y: (p.y - v.ty) / v.scale });

/* Zoom by `factor` about a screen-space anchor (ax,ay), holding the world point
 * currently under that anchor fixed — the cursor-anchored zoom both canvases use.
 * Pass the viewport-centre as the anchor for the +/- buttons. The new scale is
 * clamped to [min,max]; when the clamp bites, the anchored world point still stays
 * put (we re-derive the offset from the clamped scale). */
export function zoomAround(v, factor, ax, ay, min = 0.02, max = 8) {
  const w = screenToWorld(v, { x: ax, y: ay });
  const scale = clampNum(v.scale * factor, min, max);
  return { scale, tx: ax - w.x * scale, ty: ay - w.y * scale };
}

// Pan by a screen-pixel delta (a drag). Scale is unchanged.
export const panBy = (v, dx, dy) => ({ scale: v.scale, tx: v.tx + dx, ty: v.ty + dy });

/* Fit a world-space box (boxW×boxH world units) inside a viewport (vw×vh px) with
 * `pad` px of margin, centred. mode 'width' fits the width only (height may overflow);
 * 'page' fits the whole box (min of the two). Returns a fresh view. */
export function fitView(boxW, boxH, vw, vh, { pad = 12, min = 0.02, max = 8, mode = "page" } = {}) {
  const safeW = Math.max(1, boxW), safeH = Math.max(1, boxH);
  const sw = (vw - pad * 2) / safeW;
  const sh = (vh - pad * 2) / safeH;
  const scale = clampNum(mode === "width" ? sw : Math.min(sw, sh), min, max);
  return { scale, tx: (vw - safeW * scale) / 2, ty: (vh - safeH * scale) / 2 };
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
  const w = screenToWorld(v, prevMid);          // world point under the fingers last frame
  const scale = clampNum(v.scale * factor, min, max);
  return { scale, tx: currMid.x - w.x * scale, ty: currMid.y - w.y * scale };
}
