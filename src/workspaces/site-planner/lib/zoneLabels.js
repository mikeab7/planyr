/* Zone-code labels for an area layer (B2573312 NEW-3, DeSoto / Olive Branch zoning) — the pure half, shared by the screen (`zoneLabelLayer.js`) and the
 * printed sheet (`exportSheet.js`) so the two cannot drift (PDF-PARITY).
 *
 * THE RULES (owner, 2026-10-30): ONE label per polygon (its LARGEST part), CENTRED INSIDE it, hidden when the polygon is too small on screen to hold the text,
 * never overlapping another label. Code only — the district name stays in the click card and the legend.
 *
 *   • WHERE: the pole of inaccessibility of the largest part (`polylabel.js`) — the centre of the biggest circle that fits, so it is always inside the polygon
 *     (the old tooltip sat at Leaflet's centroid, which lands outside an L-shaped lot) — worked out once per geometry in a local METRE frame (`labelSpotOf`),
 *     because a zoom changes pixels per metre and nothing else.
 *   • TOO SMALL: the text box must fit INSIDE the part at that point (`rectInside`: exact, against the real ring and its holes), checked cheaply first —
 *     a circle that holds the box's diagonal accepts at once, a circle smaller than the box's short side rejects at once.
 *   • NEVER OVERLAPPING: biggest polygons place first; a label whose box touches an already-placed one is dropped (`layoutZoneLabels`).
 * Pure: no Leaflet, no DOM. Unit-tested in test/zoneLabels.test.js. */

import { polylabelWithHoles, signedDistWithHoles } from "./polylabel.js";

const M_PER_DEG = 111320;

/* The parts of a GeoJSON polygon / multipolygon as [{ outer: [[lng,lat]…], holes: [[[lng,lat]…]…] }]. */
export function partsOf(geom) {
  if (!geom) return [];
  const polys = geom.type === "Polygon" ? [geom.coordinates] : geom.type === "MultiPolygon" ? geom.coordinates : [];
  const out = [];
  for (const p of polys) if (Array.isArray(p) && p[0] && p[0].length >= 3) out.push({ outer: p[0], holes: p.slice(1).filter((h) => h && h.length >= 3) });
  return out;
}

/* A ring in local metres east / north of (lng0, lat0), open (the closing duplicate dropped). */
function toMetres(ring, lng0, lat0, kx) {
  const out = ring.map(([lng, lat]) => ({ x: (lng - lng0) * kx, y: (lat - lat0) * M_PER_DEG }));
  const a = out[0], b = out[out.length - 1];
  if (out.length > 3 && a.x === b.x && a.y === b.y) out.pop();
  return out;
}
const ringAreaM2 = (r) => { let a = 0; for (let i = 0, j = r.length - 1; i < r.length; j = i++) a += r[j].x * r[i].y - r[i].x * r[j].y; return Math.abs(a / 2); };

const spotCache = new WeakMap();
/* The label spot of a geometry: { lng, lat, r, areaM2, ring, holes, cx, cy, lat0, lng0, kx } — r the clear radius in metres, `ring`/`holes` the part in the
 * metre frame (kept for the exact fit test), or null for a degenerate shape. Memoised per geometry object. */
export function labelSpotOf(geom) {
  if (!geom || typeof geom !== "object") return null;
  if (spotCache.has(geom)) return spotCache.get(geom);
  let best = null;
  for (const part of partsOf(geom)) {
    const first = part.outer[0];
    if (!Number.isFinite(first[0]) || !Number.isFinite(first[1])) continue;
    const lng0 = first[0], lat0 = first[1], kx = M_PER_DEG * Math.cos(lat0 * Math.PI / 180);
    const ring = toMetres(part.outer, lng0, lat0, kx);
    const a = ringAreaM2(ring);
    if (!(a > 0) || (best && a <= best.a)) continue;
    best = { a, ring, holes: part.holes.map((h) => toMetres(h, lng0, lat0, kx)), lng0, lat0, kx };
  }
  let spot = null;
  if (best) {
    const c = polylabelWithHoles(best.ring, best.holes);
    if (c && Number.isFinite(c.x) && Number.isFinite(c.y)) {
      const r = signedDistWithHoles(c, best.ring, best.holes);
      if (r > 0) spot = { lng: best.lng0 + c.x / best.kx, lat: best.lat0 + c.y / M_PER_DEG, r, areaM2: best.a, ring: best.ring, holes: best.holes, cx: c.x, cy: c.y };
    }
  }
  spotCache.set(geom, spot);
  return spot;
}

/* The size of a label's text box in px: caps in a bold sans run about 0.64 em a character; +4 for the halo. The SAME estimate on screen and in the PDF. */
export function textBox(text, fontPx = 11) {
  return { w: Math.ceil(String(text).length * fontPx * 0.64) + 4, h: Math.ceil(fontPx * 1.3) };
}

/* Does the segment a→b cross the box [x0,x1]×[y0,y1] (or lie inside it)? Liang–Barsky. */
function segHitsBox(ax, ay, bx, by, x0, y0, x1, y1) {
  let t0 = 0, t1 = 1;
  const dx = bx - ax, dy = by - ay;
  for (const [p, q] of [[-dx, ax - x0], [dx, x1 - ax], [-dy, ay - y0], [dy, y1 - ay]]) {
    if (p === 0) { if (q < 0) return false; continue; }
    const t = q / p;
    if (p < 0) { if (t > t1) return false; if (t > t0) t0 = t; } else { if (t < t0) return false; if (t < t1) t1 = t; }
  }
  return true;
}
function pointIn(ring, x, y) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i], b = ring[j];
    if ((a.y > y) !== (b.y > y) && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}
/* Is the box centred on (cx, cy), half-sizes (hw, hh) metres, wholly inside the outer ring and clear of every hole? EXACT: no edge of any ring crosses it,
 * and its centre is inside the land. */
export function rectInside(ring, holes, cx, cy, hw, hh) {
  const x0 = cx - hw, x1 = cx + hw, y0 = cy - hh, y1 = cy + hh;
  if (!pointIn(ring, cx, cy)) return false;
  for (const h of holes || []) if (pointIn(h, cx, cy)) return false;
  for (const r of [ring, ...(holes || [])]) {
    for (let i = 0, j = r.length - 1; i < r.length; j = i++) if (segHitsBox(r[j].x, r[j].y, r[i].x, r[i].y, x0, y0, x1, y1)) return false;
  }
  return true;
}

/* Does `text` fit at this spot at `pxPerM`? Cheap tests first, the exact one only for the in-between sizes. */
export function labelFits(spot, box, pxPerM) {
  if (!spot || !(pxPerM > 0)) return false;
  const hw = box.w / 2 / pxPerM, hh = box.h / 2 / pxPerM;   // half-sizes in metres
  if (Math.min(hw, hh) > spot.r) return false;               // not even the short side fits the biggest circle
  if (Math.hypot(hw, hh) <= spot.r) return true;             // the whole diagonal fits the circle
  return rectInside(spot.ring, spot.holes, spot.cx, spot.cy, hw, hh);
}

/* Place the labels. `items` = [{ key, text, x, y, spot, pxPerM }] (x / y: the spot in the caller's pixel space). `view` = { x0, y0, x1, y1 } keeps a label
 * whose centre is inside it (the whole box with `contain`). Returns [{ key, text, x, y, w, h }] — biggest polygon first, a label that touches a placed one dropped. Pure. */
export function layoutZoneLabels(items, { view, fontPx = 11, gap = 2, contain = false } = {}) {
  const order = (items || []).filter((it) => it && it.text && it.spot && Number.isFinite(it.x) && Number.isFinite(it.y)).sort((a, b) => b.spot.areaM2 - a.spot.areaM2 || String(a.key).localeCompare(String(b.key)));
  const placed = [];
  for (const it of order) {
    const box = textBox(it.text, fontPx);
    // on screen a label whose centre is in view stays (the map edge may clip it, as every map label is); on the SHEET (`contain`) the whole text box must be inside the printed frame — a half-cut code on the page edge reads as an error
    if (view && (contain
      ? (it.x - box.w / 2 < view.x0 || it.x + box.w / 2 > view.x1 || it.y - box.h / 2 < view.y0 || it.y + box.h / 2 > view.y1)
      : (it.x < view.x0 || it.x > view.x1 || it.y < view.y0 || it.y > view.y1))) continue;
    if (!labelFits(it.spot, box, it.pxPerM)) continue;
    const x0 = it.x - box.w / 2 - gap, x1 = it.x + box.w / 2 + gap, y0 = it.y - box.h / 2 - gap, y1 = it.y + box.h / 2 + gap;
    let clash = false;
    for (const p of placed) if (x0 < p.x1 && x1 > p.x0 && y0 < p.y1 && y1 > p.y0) { clash = true; break; }
    if (clash) continue;
    placed.push({ key: it.key, text: it.text, x: it.x, y: it.y, w: box.w, h: box.h, x0, x1, y0, y1 });
  }
  return placed.map(({ key, text, x, y, w, h }) => ({ key, text, x, y, w, h }));
}
