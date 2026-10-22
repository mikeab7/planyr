/* Review's cursor, in one pure place (NEW-4 / B2426785; docs/DESIGN.md "Cursor convention").
 *
 * WHY THIS IS A LIB: the markup overlay SVG is pointer-events:none, so every press and move lands on ONE
 * viewport div carrying ONE cursor. What that cursor says therefore has to be DERIVED from what is under
 * the pointer (and which gesture is live) — it cannot be set on the object, because there is no object to
 * set it on. Everything here is a function of state, never of a ref read at render time.
 *
 *   gripCursorFor     — the cursor for ONE vertex grip of a selected markup. Two-point boxes (rect / ellipse /
 *                       cloud / snapshot) get a DIRECTIONAL resize cursor computed from where the grip sits
 *                       relative to the opposite corner — points are stored in DRAG ORDER, so index 0 is not
 *                       "top-left". Every other vertex (line / polyline / polygon / arc / callout / …) moves.
 *   vertexGripAt      — which vertex (if any) of a markup is under a page point, at a screen-pixel tolerance.
 *                       The ONE rule the press (onDown) and the hover (onMove) both use, so the cursor never
 *                       promises a grip the press will not grab.
 *   viewportCursor    — the viewport div's cursor from the live state.
 */

/** Two-point markups drawn as a box: the two points are OPPOSITE CORNERS. */
export const BOX_KINDS = new Set(["rect", "ellipse", "cloud", "snapshot"]);
/** Freehand ink has no vertex grips (the press moves the whole stroke). */
const NO_GRIPS = new Set(["pen", "highlight"]);

/** Screen-pixel radius of a vertex grip — the SAME number the press uses. */
export const GRIP_TOL_PX = 8;

/** Directional cursor for grip `idx` of a two-point box, from the grip's position relative to the other corner. */
export function gripCursorFor(kind, pts, idx) {
  if (!BOX_KINDS.has(kind) || !Array.isArray(pts) || pts.length < 2 || !pts[idx]) return "move";
  const q = pts[idx], o = pts[idx === 0 ? 1 : 0];
  const dx = q.x - o.x, dy = q.y - o.y;
  const EPS = 1e-6;
  const ax = Math.abs(dx) < EPS, ay = Math.abs(dy) < EPS;
  if (ax && ay) return "move";
  if (ax) return "ns-resize";
  if (ay) return "ew-resize";
  // y grows downward on the page: same sign on both axes ⇒ the grip is the SE or NW corner ⇒ the \ diagonal.
  return dx * dy > 0 ? "nwse-resize" : "nesw-resize";
}

/** Index of the vertex of `m` within `tolPx` screen pixels of page point `p`, or -1. */
export function vertexGripAt(m, p, scale, tolPx = GRIP_TOL_PX) {
  if (!m || !m.pts || !m.pts.length || NO_GRIPS.has(m.kind) || !p) return -1;
  const s = scale || 1;
  for (let i = 0; i < m.pts.length; i++) {
    const q = m.pts[i];
    if (Math.hypot((p.x - q.x) * s, (p.y - q.y) * s) <= tolPx) return i;
  }
  return -1;
}

/** The cursor of the grip under `p` on markup `m`, or null when no grip is there. */
export function gripHoverCursor(m, p, scale, tolPx = GRIP_TOL_PX) {
  const i = vertexGripAt(m, p, scale, tolPx);
  return i < 0 ? null : gripCursorFor(m.kind, m.pts, i);
}

/** The viewport's cursor. Priority is "what a press would do right now":
 *    a live pan → grabbing · a live move/vertex gesture → its own cursor (held for the whole gesture) ·
 *    an open Calibrate length box → the arrow (canvas presses are ignored) · Add Leader armed → crosshair ·
 *    a grip under the pointer (Select) → its cursor · pan mode (Pan tool / Space) → grab ·
 *    Select: a markup under the pointer → move, empty sheet → grab (a drag pans) · any armed tool → crosshair. */
export function viewportCursor({ tool = "select", panning = false, panMode = false, dragCursor = null,
  hoverGrip = null, hoverMarkup = false, addLeader = false, calibrating = false } = {}) {
  if (panning) return "grabbing";
  if (dragCursor) return dragCursor;
  if (calibrating) return "default";
  if (addLeader) return "crosshair";
  if (tool === "select" && hoverGrip) return hoverGrip;
  if (panMode) return "grab";
  if (tool === "select") return hoverMarkup ? "move" : "grab";
  return "crosshair";
}

/** dataTransfer.dropEffect for a dragover on a surface whose drop only opens FILES: a copy for a real
 *  file drag, "none" for anything else (a Review tab being reordered) so the cursor does not promise a drop. */
export function fileDropEffect(types) {
  const t = types ? Array.from(types) : [];
  return t.includes("Files") ? "copy" : "none";
}
