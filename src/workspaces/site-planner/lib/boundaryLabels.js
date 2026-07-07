/* Pure label-placement helpers for the boundary overlays (B695) — county / city /
 * ETJ name labels at polygon anchors, zoom-gated and collision-dropped.
 *
 * Plain-English: given the cached boundary shapes (GeoJSON from vectorLayers.js),
 * pick one good anchor point per named area (the biggest polygon's centroid), then
 * greedily keep the most important labels that fit on screen without overlapping —
 * bigger areas win, colliding labels drop. All geometry math is here, Leaflet-free
 * and injectable, so it unit-tests in Node; the thin Leaflet glue (divIcon markers,
 * panes) lives in vectorOverlay.js.
 */

// "HOUSTON" → "Houston" (H-GAC publishes ALL-CAPS names). Mirrors jurisdiction.js's
// private titleCase so the identify and the labels render names identically.
export const titleCaseName = (s) => String(s).toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());

/* Signed shoelace area + centroid of one ring ([[x,y],...]). Degenerate rings
 * (area ~0) fall back to the vertex average so a sliver still gets an anchor. Pure. */
export function ringAreaCentroid(ring) {
  let a2 = 0, cx = 0, cy = 0;
  const n = ring.length;
  for (let i = 0; i < n; i++) {
    const [x0, y0] = ring[i], [x1, y1] = ring[(i + 1) % n];
    const cross = x0 * y1 - x1 * y0;
    a2 += cross;
    cx += (x0 + x1) * cross;
    cy += (y0 + y1) * cross;
  }
  const area = a2 / 2;
  if (Math.abs(area) < 1e-12) {
    let sx = 0, sy = 0;
    for (const [x, y] of ring) { sx += x; sy += y; }
    return { area: 0, cx: sx / n, cy: sy / n };
  }
  return { area, cx: cx / (6 * area), cy: cy / (6 * area) };
}

/* One anchor per feature: the centroid of its LARGEST ring (by |area| — Esri outer
 * rings dwarf their holes, so the outer wins). Returns { lng, lat, areaDeg } or null
 * for an empty geometry. Pure. */
export function featureAnchor(geometry) {
  const rings = (geometry && geometry.coordinates) || [];
  let best = null;
  for (const ring of rings) {
    if (!ring || ring.length < 3) continue;
    const r = ringAreaCentroid(ring);
    if (!best || Math.abs(r.area) > Math.abs(best.area)) best = r;
  }
  return best ? { lng: best.cx, lat: best.cy, areaDeg: Math.abs(best.area) } : null;
}

/* All label anchors for a FeatureCollection: one per NAME (a city split into several
 * polygons labels once, at its biggest piece). Nameless features are skipped —
 * an honest nothing beats an "undefined" on the map. Pure. */
export function labelAnchors(fc, { labelField, titleCase = false } = {}) {
  const byName = new Map();
  for (const f of (fc && fc.features) || []) {
    const raw = f.properties && f.properties[labelField];
    let name = raw == null ? "" : String(raw).trim();
    if (!name) continue;
    if (titleCase) name = titleCaseName(name);
    const anchor = featureAnchor(f.geometry);
    if (!anchor) continue;
    const prior = byName.get(name);
    if (!prior || anchor.areaDeg > prior.areaDeg) byName.set(name, { name, ...anchor });
  }
  return Array.from(byName.values());
}

// Axis-aligned rectangle overlap ({x,y} centers, w/h extents), with a gap so labels
// never touch even when they technically don't intersect.
const collide = (a, b, gap) =>
  Math.abs(a.x - b.x) * 2 < a.w + b.w + gap && Math.abs(a.y - b.y) * 2 < a.h + b.h + gap;

/* Greedy collision-drop label placement. Anchors are prioritized by on-map area
 * (bigger polygon → more important label — the metro view labels Harris before a
 * sliver county); each is projected to screen px via the injected `project(lng,lat)`
 * → {x,y}, kept only if it lands inside the viewport (small margin) and doesn't
 * collide with an already-kept label. Box size is estimated from the name length —
 * an estimate is fine, the `gap` absorbs the slack. Returns the kept anchors with
 * their screen boxes. Pure. */
export function placeLabels(anchors, { project, viewW, viewH, charW = 6.8, boxH = 15, gap = 6, margin = 20 } = {}) {
  const sorted = anchors.slice().sort((a, b) => b.areaDeg - a.areaDeg);
  const placed = [];
  for (const a of sorted) {
    const pt = project(a.lng, a.lat);
    if (!pt || !isFinite(pt.x) || !isFinite(pt.y)) continue;
    if (pt.x < -margin || pt.y < -margin || pt.x > viewW + margin || pt.y > viewH + margin) continue;
    const box = { x: pt.x, y: pt.y, w: Math.max(24, a.name.length * charW), h: boxH };
    if (placed.some((p) => collide(p.box, box, gap))) continue;
    placed.push({ ...a, box });
  }
  return placed;
}

/* Zoom gate for a source's labels ({min,max}, inclusive). Off outside the band —
 * county names are noise at parcel zoom (you're inside one county) and clutter at
 * continent zoom. Pure. */
export const labelsVisible = (labelZoom, zoom) =>
  !!labelZoom && typeof zoom === "number" && zoom >= labelZoom.min && zoom <= labelZoom.max;
