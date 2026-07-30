/* Where the Map view OPENS — derived from the user's own saved sites, never hardcoded
 * and never a preference (NEW-1).
 *
 * The defect this replaces: `MapFinder` created its Leaflet map with
 * `COUNTIES_MAP.harris` as "the default landing view (no pre-picked county)", so EVERY
 * account — a brand-new one in Denver, Phoenix or Atlanta — opened over Houston, Texas.
 * That reads as broken software.
 *
 * The rule, three cases:
 *   1. NO located sites  → the whole continental US. The honest empty state: the user has
 *      no work to show, so show them the country and let them search or click in.
 *   2. EXACTLY ONE site  → that site's AREA at metro scale (not its parcel).
 *   3. MORE THAN ONE     → the DENSEST CLUSTER of their sites, so one distant outlier
 *      cannot drag the camera. The owner's real distribution today — 26 sites around
 *      Houston (Harris / Fort Bend / Waller / Chambers) and exactly ONE in Weld County,
 *      Colorado — must land on HOUSTON, with Colorado simply not pulling the view. If
 *      Colorado ever becomes the denser market, the landing view follows on its own with
 *      no action from anyone.
 *
 * ZOOM — the standing instruction is "make sure it's appropriately zoomed out." The fit is
 * deliberately NOT tight: the cluster's bounds are fitted with generous padding AND the
 * result is clamped so the landing view can never land closer than a metro / county-scale
 * reading, even when every site sits within a mile of the next. Err toward too wide: this
 * is a prospecting surface first and a resume surface second.
 *
 * Everything here is PURE — no Leaflet, no DOM, no React — so the clustering and the zoom
 * clamp are unit-testable on their own (`test/landingView.test.js`). The component's only
 * job is to hand over the viewport size and apply the answer ONCE, on open.
 */

/* Continental-US envelope (WGS84). Deliberately the lower 48 only: fitting Alaska would
 * push the view out to a hemisphere and make the empty state read as a globe. */
export const CONUS_BOUNDS = { south: 24.4, west: -124.8, north: 49.4, east: -66.9 };

/* Two sites within this distance read as ONE market. 50 miles is a metro's working radius —
 * Katy to Baytown is inside it, Houston to Weld County is not, by three orders of magnitude. */
export const CLUSTER_RADIUS_MI = 50;

/* The landing view may never zoom in past this — a metro / county-scale reading. A single
 * saved project must NOT open zoomed to that parcel; the user has to see the market and its
 * surroundings. (Matches the county entries' own `zoom: 11` metro framing.) */
export const LANDING_MAX_ZOOM = 11;

/* Never below the map's own floor (`MapFinder` creates the map with `minZoom: 3`). */
export const LANDING_MIN_ZOOM = 3;

/* Padding, as a fraction of the viewport PER SIDE, left around the fitted bounds. Generous
 * on purpose — with the floor() below it is what makes the view err wide rather than tight. */
export const LANDING_PAD_FRAC = 0.18;

const TILE_PX = 256;                 // Web Mercator tile size, the unit Leaflet's zoom is defined in
const EARTH_RADIUS_MI = 3958.7613;
const MERCATOR_LAT_LIMIT = 85.05112878;

const rad = (deg) => (deg * Math.PI) / 180;
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const finite = (n) => typeof n === "number" && Number.isFinite(n);

/* Great-circle distance in statute miles. */
export function milesBetween(a, b) {
  const dLat = rad(b.lat - a.lat);
  const dLon = rad(b.lon - a.lon);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_MI * Math.asin(Math.min(1, Math.sqrt(s)));
}

/* The Site Model's located records only. A blank-planner site has no `origin`, and a
 * sanitized/husk record can carry a non-finite one — neither may vote on where the map opens.
 * Accepts either a Site Model record (`{origin:{lat,lon}, updatedAt}`) or a bare point. */
export function locatedPoints(sites) {
  const out = [];
  (Array.isArray(sites) ? sites : []).forEach((s, i) => {
    if (!s) return;
    const o = s.origin || s;
    const lat = o.lat, lon = o.lon != null ? o.lon : o.lng;
    if (!finite(lat) || !finite(lon)) return;
    if (Math.abs(lat) > MERCATOR_LAT_LIMIT) return;
    const at = Number(s.updatedAt);
    out.push({ lat, lon, at: Number.isFinite(at) ? at : 0, i, id: s.id != null ? s.id : null });
  });
  return out;
}

/* Group located sites into markets by a simple distance threshold.
 *
 * Single-linkage (transitive: A–B and B–C put all three together) is the RIGHT shape here
 * and not an accident of implementation — it is what makes the owner's Houston sites ONE
 * market. Waller to Chambers is ~75 miles apart, further than the threshold, but the Harris
 * County sites between them chain the two ends together, exactly as a person would read it.
 * Colorado has nothing within a chain's reach of Texas, so it stays its own group.
 *
 * Returns groups sorted by what should win the camera: most sites, then most recently
 * updated, then first-seen order (so the answer is deterministic for a given input).
 */
export function clusterSites(sites, radiusMi = CLUSTER_RADIUS_MI) {
  const pts = locatedPoints(sites);
  const parent = pts.map((_, i) => i);
  const find = (i) => { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; } return i; };
  const union = (a, b) => { const ra = find(a), rb = find(b); if (ra !== rb) parent[Math.max(ra, rb)] = Math.min(ra, rb); };
  for (let i = 0; i < pts.length; i++) {
    for (let j = i + 1; j < pts.length; j++) {
      if (milesBetween(pts[i], pts[j]) <= radiusMi) union(i, j);
    }
  }
  const byRoot = new Map();
  pts.forEach((p, i) => {
    const r = find(i);
    if (!byRoot.has(r)) byRoot.set(r, { points: [], newestAt: 0, first: i });
    const g = byRoot.get(r);
    g.points.push(p);
    if (p.at > g.newestAt) g.newestAt = p.at;
  });
  return [...byRoot.values()]
    .map((g) => ({ points: g.points, count: g.points.length, newestAt: g.newestAt, first: g.first }))
    .sort((a, b) => (b.count - a.count) || (b.newestAt - a.newestAt) || (a.first - b.first));
}

/* The winning market: most sites, ties broken by the most recently updated site in the
 * group. Null when the user has nothing located yet. */
export function densestCluster(sites, radiusMi = CLUSTER_RADIUS_MI) {
  const groups = clusterSites(sites, radiusMi);
  return groups.length ? groups[0] : null;
}

/* Lat/lng envelope of a set of points. */
export function boundsOf(points) {
  if (!points || !points.length) return null;
  let south = Infinity, north = -Infinity, west = Infinity, east = -Infinity;
  points.forEach((p) => {
    if (p.lat < south) south = p.lat;
    if (p.lat > north) north = p.lat;
    const lon = p.lon != null ? p.lon : p.lng;
    if (lon < west) west = lon;
    if (lon > east) east = lon;
  });
  return { south, west, north, east };
}

export const boundsCenter = (b) => [(b.south + b.north) / 2, (b.west + b.east) / 2];

/* Web Mercator y, in the projection's own units (−π … π across the world). */
const mercY = (lat) => {
  const phi = rad(clamp(lat, -MERCATOR_LAT_LIMIT, MERCATOR_LAT_LIMIT));
  return Math.log(Math.tan(Math.PI / 4 + phi / 2));
};

/* The (fractional) zoom at which `bounds` fits inside a viewport of `width`×`height`,
 * with `padFrac` of each dimension left empty per side. Degenerate bounds (one point, or
 * every site on top of the next) give an unbounded fit — that is exactly the case the
 * caller's max-zoom clamp exists to catch, so we return Infinity rather than pretend. */
export function fitZoom(bounds, { width = 1024, height = 768, padFrac = LANDING_PAD_FRAC } = {}) {
  if (!bounds) return Infinity;
  const usableW = Math.max(64, width * (1 - 2 * padFrac));
  const usableH = Math.max(64, height * (1 - 2 * padFrac));
  const lonFrac = (bounds.east - bounds.west) / 360;
  const latFrac = (mercY(bounds.north) - mercY(bounds.south)) / (2 * Math.PI);
  const zx = lonFrac > 0 ? Math.log2(usableW / (TILE_PX * lonFrac)) : Infinity;
  const zy = latFrac > 0 ? Math.log2(usableH / (TILE_PX * latFrac)) : Infinity;
  return Math.min(zx, zy);
}

/* Fit + clamp in one step: floor to Leaflet's integer zoom steps (erring WIDE, never
 * tight) and hold the result between the map's floor and the metro-scale ceiling. */
export function clampedFitZoom(bounds, opts = {}) {
  const minZoom = opts.minZoom != null ? opts.minZoom : LANDING_MIN_ZOOM;
  const maxZoom = opts.maxZoom != null ? opts.maxZoom : LANDING_MAX_ZOOM;
  const z = fitZoom(bounds, opts);
  if (!Number.isFinite(z)) return maxZoom;         // one point / a pinhead cluster → metro floor
  return clamp(Math.floor(z), minZoom, maxZoom);
}

/* THE ANSWER: where the map opens for this user, right now.
 *
 * `{ center: [lat, lng], zoom, source, count, bounds }` — `source` is "empty" when the
 * account has nothing located (the continental-US view) and "sites" otherwise; `count` is
 * how many of the user's sites are in the market that won the camera. Both are for
 * telemetry / tests, not for display.
 */
export function landingView(sites, opts = {}) {
  const radiusMi = opts.radiusMi != null ? opts.radiusMi : CLUSTER_RADIUS_MI;
  const best = densestCluster(sites, radiusMi);
  if (!best) {
    return {
      center: boundsCenter(CONUS_BOUNDS),
      zoom: clampedFitZoom(CONUS_BOUNDS, opts),
      source: "empty",
      count: 0,
      bounds: CONUS_BOUNDS,
    };
  }
  const bounds = boundsOf(best.points);
  return {
    center: boundsCenter(bounds),
    zoom: clampedFitZoom(bounds, opts),
    source: "sites",
    count: best.count,
    bounds,
  };
}
