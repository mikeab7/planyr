/* Proximity screening core — public-data screening PHASE 2 (reused by later phases:
 * power / rail distance). Pure geometry. Answers "how close is the nearest mapped
 * feature to the site, and how many are within a buffer" — measured in the shared
 * EPSG:2278 project grid (US survey feet), so distances are real ground distances,
 * not degrees.
 *
 * The parcel footprint is one or more WGS84 rings ([[ [lng,lat], ... ], ...]); the
 * features are the points a proximity /query returned (each an [lng,lat]). A feature
 * INSIDE the footprint reads as 0 ft (on/under the site). Everything here is pure and
 * Node-tested; the fetch + interpretation live in siteAnalysis.js.
 */
import { projectToGrid } from "../../../shared/coordinates/index.js";

// A [lng,lat] pair → project-grid feet {x,y}. NB projectToGrid takes (lat, lon).
export function toGrid([lng, lat]) {
  return projectToGrid(lat, lng);
}

// A WGS84 ring → grid-feet points.
export function ringToGridFt(ring) {
  return (ring || []).map(toGrid);
}

// Ray-casting point-in-polygon on a feet ring. Pure.
export function pointInRingFt(p, ringFt) {
  let inside = false;
  for (let i = 0, j = ringFt.length - 1; i < ringFt.length; j = i++) {
    const a = ringFt[i], b = ringFt[j];
    if (!a || !b) continue;
    const intersect = (a.y > p.y) !== (b.y > p.y) &&
      p.x < ((b.x - a.x) * (p.y - a.y)) / ((b.y - a.y) || 1e-12) + a.x;
    if (intersect) inside = !inside;
  }
  return inside;
}

// Distance (feet) from a point to a segment [a,b]. Pure.
export function distPointSegFt(p, a, b) {
  const dx = b.x - a.x, dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return Math.hypot(p.x - a.x, p.y - a.y);
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

// Min distance (feet) from a feet-point to a set of feet-rings; 0 if inside any ring.
export function distPointToRingsFt(p, ringsFt) {
  for (const ring of ringsFt) if (ring.length >= 3 && pointInRingFt(p, ring)) return 0;
  let best = Infinity;
  for (const ring of ringsFt) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const d = distPointSegFt(p, ring[i], ring[j]);
      if (d < best) best = d;
    }
  }
  return best;
}

// Do segments a1a2 and b1b2 intersect? Orientation test (feet coords). Pure.
export function segmentsIntersectFt(a1, a2, b1, b2) {
  const o = (p, q, r) => Math.sign((q.y - p.y) * (r.x - q.x) - (q.x - p.x) * (r.y - q.y));
  const on = (p, q, r) => Math.min(p.x, r.x) <= q.x && q.x <= Math.max(p.x, r.x) &&
    Math.min(p.y, r.y) <= q.y && q.y <= Math.max(p.y, r.y);
  const o1 = o(a1, a2, b1), o2 = o(a1, a2, b2), o3 = o(b1, b2, a1), o4 = o(b1, b2, a2);
  if (o1 !== o2 && o3 !== o4) return true;
  if (o1 === 0 && on(a1, b1, a2)) return true;
  if (o2 === 0 && on(a1, b2, a2)) return true;
  if (o3 === 0 && on(b1, a1, b2)) return true;
  if (o4 === 0 && on(b1, a2, b2)) return true;
  return false;
}

// Min distance (feet) between two segments; 0 if they intersect. Pure.
export function distSegSegFt(a1, a2, b1, b2) {
  if (segmentsIntersectFt(a1, a2, b1, b2)) return 0;
  return Math.min(
    distPointSegFt(a1, b1, b2), distPointSegFt(a2, b1, b2),
    distPointSegFt(b1, a1, a2), distPointSegFt(b2, a1, a2),
  );
}

// Min distance (feet) from a polyline path (feet points) to a set of feet-rings; 0 if the
// line crosses/touches the parcel (a vertex inside, or a segment crossing an edge). Pure.
export function distPathToRingsFt(pathFt, ringsFt) {
  if (!pathFt || pathFt.length === 0) return Infinity;
  for (const p of pathFt) for (const ring of ringsFt) if (ring.length >= 3 && pointInRingFt(p, ring)) return 0;
  let best = Infinity;
  for (let k = 0; k < pathFt.length - 1; k++) {
    const a = pathFt[k], b = pathFt[k + 1];
    for (const ring of ringsFt) {
      for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const d = distSegSegFt(a, b, ring[i], ring[j]);
        if (d < best) best = d;
        if (best === 0) return 0;
      }
    }
  }
  // A single-vertex "path" (degenerate) falls back to point distance.
  if (pathFt.length === 1) return distPointToRingsFt(pathFt[0], ringsFt);
  return best;
}

// Feet distance from one feature to the parcel: point (lngLat) OR polyline (paths). Null if no
// usable geometry. Pure — projection via toGrid (guards non-finite / throws).
export function featureDistFt(f, ringsFt) {
  if (!ringsFt.length) return Infinity;
  const finite2 = (a) => Array.isArray(a) && Number.isFinite(a[0]) && Number.isFinite(a[1]);
  try {
    if (Array.isArray(f && f.paths) && f.paths.length) {
      let best = Infinity;
      for (const path of f.paths) {
        const pf = (path || []).filter(finite2).map(toGrid).filter((g) => Number.isFinite(g.x) && Number.isFinite(g.y));
        if (pf.length) best = Math.min(best, distPathToRingsFt(pf, ringsFt));
      }
      return Number.isFinite(best) ? best : null;
    }
    if (finite2(f && f.lngLat)) {
      const g = toGrid(f.lngLat);
      return Number.isFinite(g.x) && Number.isFinite(g.y) ? distPointToRingsFt(g, ringsFt) : null;
    }
  } catch (_) { return null; }
  return null;
}

/* Nearest-feature screen. `rings` = parcel WGS84 rings; `features` = [{ lngLat:[lng,lat],
 * attrs }]. Returns { count, nearestFt, nearest, ranked } where `ranked` is the features
 * sorted nearest-first with a `distFt` each (bad/missing coords are skipped, never 0). Pure. */
export function screenProximity(rings, features = []) {
  const ringsFt = (rings || []).map(ringToGridFt).filter((r) => r.length >= 3);
  const ranked = [];
  for (const f of features) {
    const distFt = featureDistFt(f, ringsFt); // point OR polyline; null = no usable geometry
    if (distFt == null) continue;
    ranked.push({ ...f, distFt });
  }
  ranked.sort((a, b) => a.distFt - b.distFt);
  return {
    count: ranked.length,
    nearestFt: ranked.length ? ranked[0].distFt : null,
    nearest: ranked.length ? ranked[0] : null,
    ranked,
  };
}

/* A screening distance for display (feet in, human string out). On-site → "on/under the
 * site"; under a mile → rounded feet; else miles to 0.1. Pure. NB the raw feet stay in
 * code; only this human string is shown. */
export function fmtDistFt(ft) {
  if (ft == null || !Number.isFinite(ft)) return "";
  if (ft <= 25) return "on/under the site";
  if (ft < 5280) return `~${Math.round(ft / 50) * 50} ft`;
  return `~${(ft / 5280).toFixed(1)} mi`;
}
