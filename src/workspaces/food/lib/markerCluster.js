/* markerCluster — pure grid clustering for the food map (NEW-5).
 *
 * At the owner's real pin density a metro-wide view is "a solid mass of grey circles" (his
 * words, looking at a screenshot). Leaflet.markercluster exists but is a DOM-marker library —
 * this map deliberately renders on canvas (see FoodMap.jsx's header) because the snapshot query
 * can return up to a couple thousand points, so pulling in a whole clustering library built
 * around individual `<div>` icons would fight the very reason canvas was chosen. A grid bucket
 * is the simple, well-understood alternative: divide the current screen into `cellPx`-wide
 * squares, and any two points landing in the same square become one cluster. No dependency,
 * easy to reason about, and it only ever GROUPS what canvas would have painted anyway.
 *
 * `project(lat, lon) -> [x, y]` is injected (Leaflet's `map.latLngToContainerPoint`) so this
 * stays pure and unit-testable without a browser.
 */

/** Priority order for a cluster's displayed kind when it mixes logged/unlogged/manual pins —
 *  the same "logged places render differently from ones I haven't" the individual pins use,
 *  extended so a cluster is never mistaken for "nothing here I've been to yet" when it holds a
 *  manual pin or a logged place. */
const KIND_PRIORITY = { manual: 2, logged: 1, unlogged: 0 };

export function dominantKind(kinds) {
  let best = "unlogged";
  for (const k of kinds) {
    if ((KIND_PRIORITY[k] ?? -1) > KIND_PRIORITY[best]) best = k;
  }
  return best;
}

/** items: [{ lat, lon, kind: 'logged'|'unlogged'|'manual', ...rest }]
 *  Returns [{ x, y, lat, lon, count, kind, items }] — singletons (count === 1) carry their one
 *  original item back out unchanged (via `items[0]`) so the caller doesn't need a second lookup
 *  to render/select it exactly as before clustering existed. */
export function clusterPoints(items, project, cellPx) {
  if (!items || items.length === 0) return [];
  const cell = Math.max(1, cellPx || 60);
  const buckets = new Map();
  for (const item of items) {
    const [x, y] = project(item.lat, item.lon);
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    const key = `${Math.floor(x / cell)}:${Math.floor(y / cell)}`;
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push({ ...item, x, y });
  }
  const clusters = [];
  for (const bucket of buckets.values()) {
    const count = bucket.length;
    const sumX = bucket.reduce((s, p) => s + p.x, 0);
    const sumY = bucket.reduce((s, p) => s + p.y, 0);
    const sumLat = bucket.reduce((s, p) => s + p.lat, 0);
    const sumLon = bucket.reduce((s, p) => s + p.lon, 0);
    clusters.push({
      x: sumX / count, y: sumY / count,
      lat: sumLat / count, lon: sumLon / count,
      count, kind: dominantKind(bucket.map((p) => p.kind)),
      items: bucket,
    });
  }
  return clusters;
}
