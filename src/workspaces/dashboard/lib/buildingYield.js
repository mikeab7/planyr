/* buildingYield — a minimal, dependency-free gross building SF sum from raw element rows
 * (B1161793, NEW-2 — the Pursuits card's Yield column, the figure the owner compares two deals
 * on).
 *
 * Deliberately NOT `site-planner/lib/siteMetrics.js` (the real yield engine — FAR, coverage,
 * parking, detention). That module transitively imports `clipper-lib` via `pondGeom.js`/
 * `polyClip.js`, one of `vite.config.js`'s MAP_VENDOR packages — pulling it into the Dashboard's
 * own bundle would repeat the exact bundle-bloat mistake `cloudSync.js`'s own header warns
 * against (+323 KB measured on an unrelated route, the one time this was tried). Buildings on a
 * real plan don't overlap each other, so a plain additive area sum — no boolean union needed —
 * is both correct and entirely clipper-free.
 */

function rectAreaSqft(el) {
  return Math.abs((el?.w || 0) * (el?.h || 0));
}

// Plain shoelace formula — rotation doesn't change a polygon's area, so unlike a rendered
// footprint this needs no rotation transform.
function polyAreaSqft(points) {
  if (!Array.isArray(points) || points.length < 3) return 0;
  let a = 0;
  for (let i = 0; i < points.length; i++) {
    const p1 = points[i], p2 = points[(i + 1) % points.length];
    if (!p1 || !p2) return 0;
    a += p1.x * p2.y - p2.x * p1.y;
  }
  return Math.abs(a) / 2;
}

/** `elements` — raw element `data` payloads (kind="el" site_elements rows) for ONE plan. Returns
 * the gross building footprint SF: the sum of every `type === "building"` element's own area. */
export function grossBuildingSqft(elements) {
  let sum = 0;
  for (const e of elements || []) {
    if (!e || e.type !== "building") continue;
    sum += Array.isArray(e.points) ? polyAreaSqft(e.points) : rectAreaSqft(e);
  }
  return sum;
}

/** `rows` — `[{site_id, data}]` raw element rows, possibly spanning several plans. Returns
 * `{ [siteId]: grossBuildingSqft }`. */
export function yieldBySite(rows) {
  const bySite = new Map();
  for (const r of rows || []) {
    if (!r || !r.site_id || !r.data) continue;
    if (!bySite.has(r.site_id)) bySite.set(r.site_id, []);
    bySite.get(r.site_id).push(r.data);
  }
  const out = {};
  for (const [siteId, elements] of bySite) out[siteId] = grossBuildingSqft(elements);
  return out;
}
