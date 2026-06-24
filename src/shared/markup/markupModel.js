/* Shared markup DATA-MODEL accessors (B423 / NEW-2).
 *
 * Both workspaces store a markup as a plain JSON object, but they don't store geometry the
 * same way: the Site Planner keeps a Line as { a, b } and a box (rect/ellipse) as a centre
 * + size + rotation { cx, cy, w, h, rot }, while Document Review keeps everything as a flat
 * `pts` vertex list. This module is the ONE place that reconciles those shapes, so the
 * shared renderer / hit-test / interaction code can read any markup without caring which
 * host wrote it. Reading is universal; writing (`setPts`) targets the vertex-list form and
 * leaves the Site Planner's centre-box editing to its existing grips (migrated later).
 *
 * Pure: depends only on geometry + the tool matrix (the closed-shape source of truth).
 */
import { rot2, bboxOf } from "./geometry.js";
import { isClosedTool } from "./tools.matrix.js";

/* A Site Planner Line persists as { a, b } rather than a `pts` array. */
const usesAB = (m) => m && m.kind === "line" && m.a && m.b && !Array.isArray(m.pts);
/* A Site Planner box persists as a centre + size (+ optional rotation). */
const isCentreBox = (m) => m && Number.isFinite(m.cx) && Number.isFinite(m.w) && !Array.isArray(m.pts) && !m.a;

/** The four rotated corners of a centre-box markup, world coordinates. */
export function boxCorners(m) {
  const hw = (m.w || 0) / 2, hh = (m.h || 0) / 2, rot = m.rot || 0;
  return [[-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh]].map(([lx, ly]) => {
    const p = rot2(lx, ly, rot);
    return { x: (m.cx || 0) + p.x, y: (m.cy || 0) + p.y };
  });
}

/** The defining vertices of any markup, normalized to a { x, y }[] regardless of host form. */
export function ptsOf(m) {
  if (!m) return [];
  if (usesAB(m)) return [m.a, m.b];
  if (Array.isArray(m.pts)) return m.pts;
  if (isCentreBox(m)) return boxCorners(m);
  return [];
}

/** Write a new vertex list back, in whichever form the markup already uses. A centre-box
 *  is left untouched (its geometry is edited via grips, not a vertex list). */
export function setPts(m, pts) {
  if (usesAB(m)) return { ...m, a: pts[0], b: pts[1] };
  if (isCentreBox(m)) return m;
  return { ...m, pts };
}

/* Minimum vertices a kind needs to be a valid shape. Closed rings need 3; everything
 * point-based needs at least 2 (a single click is a marker/text/count, handled by 1). */
const MIN_PTS = { polygon: 3, area: 3, perimeter: 3, text: 1, callout: 1, count: 1, snapshot: 2 };
export function minPtsOf(kind) {
  if (kind in MIN_PTS) return MIN_PTS[kind];
  return 2;
}

/** True if the kind draws a closed ring (delegates to the matrix — one source of truth). */
export const isClosed = (kind) => isClosedTool(kind);

/** Axis-aligned bounding box of any markup → { x, y, w, h }. */
export function bboxOfMarkup(m) {
  if (isCentreBox(m)) return bboxOf(boxCorners(m));
  return bboxOf(ptsOf(m));
}

/** Translate a whole markup by (dx, dy) — moves vertex lists, a/b, and a centre-box centre. */
export function translate(m, dx, dy) {
  const out = { ...m };
  if (usesAB(m)) { out.a = { x: m.a.x + dx, y: m.a.y + dy }; out.b = { x: m.b.x + dx, y: m.b.y + dy }; return out; }
  if (Array.isArray(m.pts)) { out.pts = m.pts.map((p) => ({ x: p.x + dx, y: p.y + dy })); return out; }
  if (isCentreBox(m)) { out.cx = (m.cx || 0) + dx; out.cy = (m.cy || 0) + dy; return out; }
  return out;
}

/* Normalize ONE markup loaded from storage into a render-safe shape. A persisted review is
 * just JSON — it can arrive partial or corrupted (a hand-edited row, an older/newer schema,
 * or a coordinate a degenerate gesture turned non-finite, which JSON.stringify rewrote to
 * `null`). The render/hit-test/takeoff code assumes each markup has a string `kind`, an
 * array of finite-coordinate `pts`, and (for text) a string `text`; one violation used to
 * crash the WHOLE overlay. This is the load-path validation boundary: drop junk points, fill
 * required fields, losslessly preserve everything else. Returns null for an unsalvageable
 * entry (no kind) so the caller can filter it out. (Moved from takeoff.js; B423.) */
export function sanitizeMarkup(m) {
  if (!m || typeof m.kind !== "string") return null;
  const pts = Array.isArray(m.pts)
    ? m.pts.filter((p) => p && Number.isFinite(p.x) && Number.isFinite(p.y)).map((p) => ({ x: p.x, y: p.y }))
    : [];
  const out = { ...m, pts };
  if (m.kind === "text") out.text = typeof m.text === "string" ? m.text : "";
  return out;
}

/** Sanitize a loaded markups array (drops unsalvageable entries). Safe on non-arrays. */
export const sanitizeMarkups = (arr) => (Array.isArray(arr) ? arr.map(sanitizeMarkup).filter(Boolean) : []);
