/* siteAnchor — the ONE answer to "where does this site's map marker (and its name tag) sit" (B<NEW-1>).
 *
 * THE BUG: the Map's site pin was drawn at `site.origin` — the frame origin the plan was created
 * around (typically where the first parcel was clicked, or a centroid/bbox centre at creation).
 * That point says nothing about the parcel's shape, so on a big irregular parcel (Katz, Rankin Rd —
 * a wide rectangle with a long tail and a notch) it can sit in the notch, on the neighbour's lots.
 *
 * THE FIX: derive the display point from the geometry — the pole of inaccessibility (centre of the
 * largest circle that fits in the land, always inside, `polylabel.js`) — but keep the plain area
 * centroid when it is already inside AND clear of the edge, so a convex parcel's pin does not move.
 *   · several parcels  → the largest live/active one by net area
 *   · save-and-except holes (`exceptions`) → never land in one
 *   · no usable parcel → the stored origin (nothing to derive from; callers can tell via `source`)
 * The stored origin is NEVER rewritten; this is computed at read time, memoised per geometry
 * (WeakMap on the ring array), so a pan/zoom re-render costs a lookup, not a search.
 *
 * Pure (no DOM/Leaflet). Unit-tested in test/siteAnchor.test.js.
 */
import { polylabel, polylabelWithHoles, signedDist, signedDistWithHoles } from "./polylabel.js";
import { polyArea } from "./polygonSplit.js";
import { parcelNetSqft } from "./parcelArea.js";
import { feetToLatLngPair as feetToLatLng } from "./mapLock.js";

// Same predicate as splitIntegrity.isLiveActive, inlined: that module pulls in clipper-lib.
const isLiveActive = (p) => !!(p && p.active !== false && !p.deletedAt && !p.deleted_at);

// The centroid is kept only while it is at least this fraction of the pole's clearance from the edge.
export const CENTROID_KEEP_FRACTION = 0.6;

const cache = new WeakMap();

function ringCentroid(ring) {
  let a = 0, cx = 0, cy = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const p = ring[j], q = ring[i];
    const f = p.x * q.y - q.x * p.y;
    a += f; cx += (p.x + q.x) * f; cy += (p.y + q.y) * f;
  }
  if (!a) return null;
  return { x: cx / (3 * a), y: cy / (3 * a) };
}

function holesOf(pc) {
  const ex = Array.isArray(pc && pc.exceptions) ? pc.exceptions : [];
  return ex.map((h) => (h && Array.isArray(h.pts) ? h.pts : Array.isArray(h) ? h : null)).filter((r) => r && r.length >= 3);
}

/** Feet-frame anchor for ONE polygon (outer ring + optional holes): inside, edge-clear. */
export function polygonAnchor(ring, holes = []) {
  if (!Array.isArray(ring) || ring.length < 3) return null;
  const pole = holes.length ? polylabelWithHoles(ring, holes) : polylabel(ring);
  if (!pole) return null;
  const dist = (p) => (holes.length ? signedDistWithHoles(p, ring, holes) : signedDist(p, ring));
  const c = ringCentroid(ring);
  if (c && Number.isFinite(c.x) && Number.isFinite(c.y)) {
    const dc = dist(c);
    if (dc > 0 && dc >= CENTROID_KEEP_FRACTION * dist(pole)) return c;
  }
  return pole;
}

/** Feet-frame anchor for a site's drawable parcels, or null when none has a usable ring. */
export function siteAnchorFeet(drawParcels) {
  let best = null, bestArea = -1;
  for (const pc of drawParcels || []) {
    if (!isLiveActive(pc) || !Array.isArray(pc.points) || pc.points.length < 3) continue;
    const area = parcelNetSqft(pc) || Math.abs(polyArea(pc.points));
    if (area > bestArea) { best = pc; bestArea = area; }
  }
  if (!best) return null;
  const hit = cache.get(best.points);
  if (hit && hit.ex === best.exceptions) return hit.out;
  const out = polygonAnchor(best.points, holesOf(best));
  cache.set(best.points, { ex: best.exceptions, out });
  return out;
}

/** {lat, lon, source} for the marker. `source` is "geometry" when derived from a parcel, "origin"
 * when only the stored point was available (no parcel, or no origin frame to place feet in). */
export function siteAnchorLatLon(site, drawParcels) {
  const o = site && site.origin;
  if (!o || !Number.isFinite(o.lat) || !Number.isFinite(o.lon)) return null;
  const f = siteAnchorFeet(drawParcels);
  if (f) {
    const [lat, lon] = feetToLatLng(f, o.lat, o.lon);
    if (Number.isFinite(lat) && Number.isFinite(lon)) return { lat, lon, source: "geometry" };
  }
  return { lat: o.lat, lon: o.lon, source: "origin" };
}
