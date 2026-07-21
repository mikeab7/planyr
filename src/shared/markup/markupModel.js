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
/* A Site Planner callout persists as { tip|tips, box, noLeader? } rather than a `pts` array —
 * `tip` is the legacy single-leader field, `tips` an array for N leaders (B919 multi-leader map port).
 * Recognized regardless of `kind` so Site Planner's own `callouts` collection (which never sets
 * a `.kind` field) can flow through the same accessors as Document Review's callout markups. */
const usesTipBox = (m) => m && !Array.isArray(m.pts) && !usesAB(m) && !isCentreBox(m) &&
  m.box && Number.isFinite(m.box.x) && Number.isFinite(m.box.y) &&
  (m.tip || Array.isArray(m.tips) || m.noLeader === true);

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
  if (usesTipBox(m)) {
    const tips = Array.isArray(m.tips) ? m.tips : (m.tip ? [m.tip] : []);
    return [...tips, m.box];
  }
  return [];
}

/** Write a new vertex list back, in whichever form the markup already uses. A centre-box
 *  is left untouched (its geometry is edited via grips, not a vertex list). */
export function setPts(m, pts) {
  if (usesAB(m)) return { ...m, a: pts[0], b: pts[1] };
  if (isCentreBox(m)) return m;
  if (usesTipBox(m)) {
    const tips = pts.slice(0, -1);
    const box = pts[pts.length - 1];
    const out = { ...m, box, noLeader: tips.length === 0 };
    delete out.tip;
    delete out.tips;
    if (tips.length === 1) out.tip = tips[0];
    else if (tips.length > 1) out.tips = tips;
    return out;
  }
  return { ...m, pts };
}

/* Callout N-LEADER model (B909/NEW-2): pts = [...tips, box] — every point but the last is a
 * leader's target ("tip"), the last point is the text-box anchor. A single point (no leader,
 * a plain text label — Bluebeam's behaviour once the last leader is removed) and the legacy
 * exactly-2-point [tip, box] shape are both just N=0 and N=1 of this SAME shape, so no data
 * migration is needed: every callout ever saved already fits this model unchanged. */
export function calloutParts(m) {
  const pts = ptsOf(m);
  if (!pts.length) return { tips: [], box: null };
  if (pts.length === 1) return { tips: [], box: pts[0] };
  return { tips: pts.slice(0, -1), box: pts[pts.length - 1] };
}

/** Add a new leader at `pt`, targeting the box from a new direction. Box stays the last point. */
export function addCalloutLeader(m, pt) {
  const pts = ptsOf(m);
  if (!pts.length) return setPts(m, [pt]);
  const box = pts[pts.length - 1];
  return setPts(m, [...pts.slice(0, -1), pt, box]);
}

/** Remove leader `tipIndex` (0-based, into the tips-only list). Removing the last remaining
 *  leader is allowed and leaves a plain box-only text label (Bluebeam default). A no-op for an
 *  out-of-range index (including the box's own index — the box is never removable this way). */
export function removeCalloutLeader(m, tipIndex) {
  const pts = ptsOf(m);
  if (tipIndex < 0 || tipIndex >= pts.length - 1) return m;
  return setPts(m, [...pts.slice(0, tipIndex), ...pts.slice(tipIndex + 1)]);
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
  if (usesTipBox(m)) {
    out.box = { x: m.box.x + dx, y: m.box.y + dy };
    if (m.tip) out.tip = { x: m.tip.x + dx, y: m.tip.y + dy };
    if (Array.isArray(m.tips)) out.tips = m.tips.map((p) => ({ x: p.x + dx, y: p.y + dy }));
    return out;
  }
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
