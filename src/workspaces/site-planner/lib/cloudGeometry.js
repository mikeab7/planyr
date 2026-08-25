/* Revision-cloud markup geometry (NEW-1) — pure, unit-agnostic scallop math.
 *
 * A cloud is a closed polygon (its vertices `pts`, same shape as a Polygon markup) whose outline is
 * drawn as a chain of outward-bulging arcs instead of straight edges — the Bluebeam "revision cloud"
 * convention every architect/GC/consultant already reads. This module is the ONE place that turns a
 * vertex ring + an arc size into that outline. SitePlanner's PDF export clones the live SVG rather
 * than re-rendering (see `exportSheet.js`), so whatever this produces on screen is automatically what
 * prints — there is no second render path to keep in sync (PDF-PARITY).
 *
 * Arc size must be supplied in the SAME units as `pts` — feet, when called from the Site Planner
 * (never pixels: a cloud has to look identical at every canvas zoom and scale correctly against the
 * plan's scale bar). This module doesn't know or care which space it's in — the caller projects
 * feet→screen once (as it already does for every other markup kind) and passes the already-projected
 * points plus a screen-space radius; `cloudScallopPath` just turns points into a path string.
 */

// Small/Medium/Large presets (arc radius, feet) — the numeric field can hold any value in between.
export const CLOUD_ARC_PRESETS = { small: 1.5, medium: 3, large: 6 };
export const CLOUD_ARC_MIN_FT = 0.5;
export const CLOUD_ARC_MAX_FT = 30;
export const CLOUD_ARC_DEFAULT_FT = CLOUD_ARC_PRESETS.medium;

/** Clamp/validate a user-typed arc size to a sane real-world range; a bad value falls back to the
 *  default rather than drawing a degenerate (zero/negative/absurdly large) scallop. */
export function clampCloudArcFt(ft) {
  const n = Number(ft);
  if (!Number.isFinite(n)) return CLOUD_ARC_DEFAULT_FT;
  return Math.min(CLOUD_ARC_MAX_FT, Math.max(CLOUD_ARC_MIN_FT, n));
}

/* How many scallops fit one edge. Arcs are distributed EVENLY across the edge — never a run of
 * arcs at exactly the requested size plus one short leftover arc at the corner — by picking an arc
 * COUNT first (nearest whole number to edge/2·arcSize, at least 1) and dividing the edge length by
 * that count for the actual per-arc chord. The gap between the requested size and the real chord is
 * therefore spread thin across every arc on the edge instead of dumped on the last one — which is
 * what "remainder absorbed, so spacing reads even" means. */
export function edgeScallopCount(edgeLen, arcSize) {
  if (!(edgeLen > 0) || !(arcSize > 0)) return 0;
  return Math.max(1, Math.round(edgeLen / (2 * arcSize)));
}

/* n evenly-spaced points from a→b inclusive (n+1 points: both endpoints plus n-1 interior ones). */
function edgeScallopPoints(a, b, n) {
  const pts = [];
  for (let i = 0; i <= n; i++) pts.push({ x: a.x + (b.x - a.x) * (i / n), y: a.y + (b.y - a.y) * (i / n) });
  return pts;
}

/* The scalloped outline of a closed ring, as an SVG path `d` string. `pts` is the polygon's real
 * vertices (≥3, any space — feet or already-projected screen px, see header); `arcSize` is a radius
 * in that same space. Every arc bulges OUTWARD: the sweep flag is decided ONCE from the ring's
 * overall signed area (not per-edge — a per-edge test flips sign on a self-touching concave corner,
 * which a per-ring test never sees because it looks at the whole loop's winding). A degenerate input
 * (< 3 usable points) returns "" so the caller can skip rendering rather than draw garbage; a very
 * short edge still gets exactly one arc sized to it (the loop is never broken into a straight
 * segment — a cloud is ALWAYS a closed ring of arcs, per spec). */
export function cloudScallopPath(pts, arcSize) {
  const ring = (pts || []).filter((p) => p && Number.isFinite(p.x) && Number.isFinite(p.y));
  if (ring.length < 3) return "";
  let area2 = 0;
  for (let i = 0; i < ring.length; i++) {
    const p = ring[i], q = ring[(i + 1) % ring.length];
    area2 += p.x * q.y - q.x * p.y;
  }
  const sweep = area2 >= 0 ? 1 : 0; // outward bulge; the opposite constant for a CW vs CCW-wound ring
  const r = arcSize > 0 ? arcSize : 1;
  let d = "";
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i], b = ring[(i + 1) % ring.length];
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    const n = edgeScallopCount(len, r) || 1;
    const seg = edgeScallopPoints(a, b, n);
    if (i === 0) d += `M ${seg[0].x} ${seg[0].y}`;
    for (let k = 1; k < seg.length; k++) d += ` A ${r} ${r} 0 0 ${sweep} ${seg[k].x} ${seg[k].y}`;
  }
  return d + " Z";
}

/* Ramer–Douglas–Peucker simplification for a freehand-drawn cloud outline: reduces a dense
 * pointer-move trail to a small vertex set the user can still reshape by hand afterward (the same
 * vertex idiom as every other editable path here), while keeping the drawn silhouette. `tol` is in
 * the same units as `pts`. Endpoints are always kept. Pure; no dependency on the ring being closed —
 * the caller closes the loop (a cloud is always a closed ring, per spec). */
export function simplifyPath(pts, tol) {
  const arr = (pts || []).filter((p) => p && Number.isFinite(p.x) && Number.isFinite(p.y));
  if (arr.length < 3 || !(tol > 0)) return arr;
  const distToSeg = (p, a, b) => {
    const dx = b.x - a.x, dy = b.y - a.y, L2 = dx * dx + dy * dy;
    if (!L2) return Math.hypot(p.x - a.x, p.y - a.y);
    let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / L2;
    t = Math.max(0, Math.min(1, t));
    return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
  };
  const rdp = (list) => {
    if (list.length < 3) return list;
    const a = list[0], b = list[list.length - 1];
    let maxD = -1, idx = -1;
    for (let i = 1; i < list.length - 1; i++) {
      const d = distToSeg(list[i], a, b);
      if (d > maxD) { maxD = d; idx = i; }
    }
    if (maxD > tol) {
      const left = rdp(list.slice(0, idx + 1));
      const right = rdp(list.slice(idx));
      return [...left.slice(0, -1), ...right];
    }
    return [a, b];
  };
  return rdp(arr);
}

/** Cloud metadata defaults stamped on every newly-created cloud (Bluebeam parity: Subject/Comment/
 *  Status/Label/Layer + auto Author/Created/Modified). `now` and `author` are injected (never read
 *  from a clock/identity global here) so this stays pure and testable. */
export const CLOUD_STATUS_OPTIONS = ["None", "Accepted", "Rejected", "Cancelled", "Completed"];
export function cloudMetaDefaults(nowIso, author = "You") {
  return {
    subject: "Cloud",
    comment: "",
    author,
    createdAt: nowIso,
    modifiedAt: nowIso,
    status: "None",
    label: "",
    layer: "",
  };
}
