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

/* Nearest-feature screen. `rings` = parcel WGS84 rings; `features` = [{ lngLat:[lng,lat],
 * attrs }]. Returns { count, nearestFt, nearest, ranked } where `ranked` is the features
 * sorted nearest-first with a `distFt` each (bad/missing coords are skipped, never 0). Pure. */
export function screenProximity(rings, features = []) {
  const ringsFt = (rings || []).map(ringToGridFt).filter((r) => r.length >= 3);
  const ranked = [];
  for (const f of features) {
    const ll = f && f.lngLat;
    if (!Array.isArray(ll) || !Number.isFinite(ll[0]) || !Number.isFinite(ll[1])) continue;
    let g;
    try { g = toGrid(ll); } catch (_) { continue; }
    if (!Number.isFinite(g.x) || !Number.isFinite(g.y)) continue;
    const distFt = ringsFt.length ? distPointToRingsFt(g, ringsFt) : Infinity;
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
