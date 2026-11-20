/* WHERE A PLACE NAME GOES, AT ANY ZOOM (NEW-1, owner 2026-11-05). Pure — no Leaflet, no DOM; the caller supplies the projection.
 *
 * The old rule put each name at the centre of its polygon's biggest piece and switched names off above zoom 13. At working zoom a city's centre is off the screen (Sugar Land is
 * bigger than the view), so NOTHING named the ground the site stands on. Here every name is placed in the part of its polygon that is ON SCREEN:
 *   • the polygon is clipped to the view; the name sits at the roomiest point of the largest visible piece (the pole of inaccessibility, holes respected — an ETJ with its
 *     cities cut out never gets its name printed inside the cut-out);
 *   • a polygon that fills most of the view parks its name in a band near the top (`band`), clear of the middle of the screen where the site is drawn;
 *   • the label's whole box is kept inside the view, so a name is never cut off at an edge;
 *   • one name per place (the biggest visible piece wins) and two names never overlap (bigger visible area wins).
 * Also exports the font ladder, so the name grows as you zoom in. */
import { polylabelWithHoles } from "./polylabel.js";
import { geometryBox } from "./boundaryPaint.js";

/* Name size (px) by zoom: 11 at the metro view, growing to 16 at parcel scale. */
export const labelFontPx = (zoom) => (typeof zoom !== "number" ? 11 : Math.max(11, Math.min(16, 11 + (zoom - 11) * 1.0)));
/* The box a name takes at that size (px), a conservative estimate — the pill's own padding included. */
export const labelBoxPx = (text, fontPx) => ({ w: Math.max(28, String(text).length * fontPx * 0.62 + 16), h: fontPx + 8 });

const polygonsOf = (g) => !g ? [] : g.type === "Polygon" ? [g.coordinates || []] : g.type === "MultiPolygon" ? (g.coordinates || []) : [];

/* Sutherland–Hodgman: a ring ([[x,y]…]) clipped to the rectangle [x0,y0,x1,y1]. Returns a ring (possibly empty). */
export function clipRingToRect(ring, x0, y0, x1, y1) {
  let pts = ring.length > 1 && ring[0][0] === ring[ring.length - 1][0] && ring[0][1] === ring[ring.length - 1][1] ? ring.slice(0, -1) : ring.slice();
  const edges = [
    [(p) => p[0] >= x0, (a, b) => { const t = (x0 - a[0]) / (b[0] - a[0]); return [x0, a[1] + t * (b[1] - a[1])]; }],
    [(p) => p[0] <= x1, (a, b) => { const t = (x1 - a[0]) / (b[0] - a[0]); return [x1, a[1] + t * (b[1] - a[1])]; }],
    [(p) => p[1] >= y0, (a, b) => { const t = (y0 - a[1]) / (b[1] - a[1]); return [a[0] + t * (b[0] - a[0]), y0]; }],
    [(p) => p[1] <= y1, (a, b) => { const t = (y1 - a[1]) / (b[1] - a[1]); return [a[0] + t * (b[0] - a[0]), y1]; }],
  ];
  for (const [inside, cut] of edges) {
    if (!pts.length) break;
    const out = [];
    for (let i = 0; i < pts.length; i++) {
      const cur = pts[i], prev = pts[(i + pts.length - 1) % pts.length];
      const ci = inside(cur), pi = inside(prev);
      if (ci) { if (!pi) out.push(cut(prev, cur)); out.push(cur); } else if (pi) out.push(cut(prev, cur));
    }
    pts = out;
  }
  return pts;
}
const areaOf = (ring) => { let a = 0; for (let i = 0; i < ring.length; i++) { const p = ring[i], q = ring[(i + 1) % ring.length]; a += p[0] * q[1] - q[0] * p[1]; } return Math.abs(a) / 2; };
const inRing = (ring, x, y) => { let c = false; for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) { const a = ring[i], b = ring[j]; if ((a[1] > y) !== (b[1] > y) && x < ((b[0] - a[0]) * (y - a[1])) / (b[1] - a[1]) + a[0]) c = !c; } return c; };
const toXY = (ring) => ring.map((p) => ({ x: p[0], y: p[1] }));

/* The anchors for a FeatureCollection's features in the current view.
 *   nameOf(feature) → the text to print ("" to skip)
 *   project(lng, lat) → { x, y } view pixels
 *   viewW, viewH       the view in px
 *   bounds             { w, s, e, n } the view in lng/lat (an optional cheap pre-filter; without it every ring is projected)
 *   band               [from, to] fractions of the view height where a polygon that fills the view parks its name (default [0.1, 0.26])
 *   maxPieces          cap on how many visible pieces are examined (largest first)
 * Returns [{ name, x, y, areaPx, big }] — one per name, the centre of its label in view px. */
export function viewAnchors(features, { nameOf, project, viewW, viewH, bounds = null, band = [0.1, 0.26], maxPieces = 120 } = {}) {
  const pieces = [];
  for (const f of features || []) {
    const name = nameOf ? nameOf(f) : "";
    if (!name) continue;
    const box = f.geometry ? geometryBox(f.geometry) : null;
    if (bounds && box && (box[0] > bounds.e || box[2] < bounds.w || box[1] > bounds.n || box[3] < bounds.s)) continue;
    for (const rings of polygonsOf(f.geometry)) {
      // project only the rings whose own box meets the view
      const px = [];
      for (const r of rings) {
        if (!r || r.length < 3) continue;
        if (bounds) {
          let w = Infinity, s = Infinity, e = -Infinity, n = -Infinity;
          for (const p of r) { if (p[0] < w) w = p[0]; if (p[0] > e) e = p[0]; if (p[1] < s) s = p[1]; if (p[1] > n) n = p[1]; }
          if (w > bounds.e || e < bounds.w || s > bounds.n || n < bounds.s) continue;
        }
        const pr = [];
        for (const p of r) { const q = project(p[0], p[1]); if (q && isFinite(q.x) && isFinite(q.y)) pr.push([q.x, q.y]); }
        if (pr.length >= 3) px.push(pr);
      }
      if (!px.length) continue;
      // even-odd: a ring inside an odd number of the others is a hole
      const depth = px.map((r, i) => px.reduce((n, o, j) => (j !== i && inRing(o, r[0][0], r[0][1]) ? n + 1 : n), 0));
      const holes = [];
      px.forEach((r, i) => { if (depth[i] % 2 === 1) { const c = clipRingToRect(r, 0, 0, viewW, viewH); if (c.length >= 3) holes.push(toXY(c)); } });
      px.forEach((r, i) => {
        if (depth[i] % 2 === 1) return;
        const c = clipRingToRect(r, 0, 0, viewW, viewH);
        if (c.length < 3) return;
        const areaPx = areaOf(c);
        if (areaPx < 30) return;
        pieces.push({ name, ring: c, holes, areaPx });
      });
    }
  }
  // one piece per name — the biggest visible one
  const best = new Map();
  for (const pc of pieces) { const b = best.get(pc.name); if (!b || pc.areaPx > b.areaPx) best.set(pc.name, pc); }
  const top = [...best.values()].sort((a, b) => b.areaPx - a.areaPx).slice(0, maxPieces);
  const out = [];
  for (const pc of top) {
    let ring = pc.ring, big = false;
    if (pc.areaPx >= 0.55 * viewW * viewH) { // fills the view: park the name in the top band, off the middle of the screen
      const c = clipRingToRect(pc.ring, 0, band[0] * viewH, viewW, band[1] * viewH);
      if (c.length >= 3 && areaOf(c) > 200) { ring = c; big = true; }
    }
    const pole = polylabelWithHoles(toXY(ring), pc.holes);
    if (!pole || !isFinite(pole.x) || !isFinite(pole.y)) continue;
    out.push({ name: pc.name, x: pole.x, y: pole.y, areaPx: pc.areaPx, big });
  }
  return out;
}

/* Keep the whole label box inside the view (an anchor near an edge is nudged in), then drop any label that would overlap a bigger one.
 * `anchors` are viewAnchors' output; `textOf(anchor)` the printed text; `fontPx` the size. Returns the kept anchors with their final `x`,`y` and `box`. */
export function placeNames(anchors, { textOf, fontPx, viewW, viewH, gap = 4, taken = [] } = {}) {
  const kept = [];
  const hit = (a, b) => Math.abs(a.x - b.x) * 2 < a.box.w + b.box.w + gap && Math.abs(a.y - b.y) * 2 < a.box.h + b.box.h + gap;
  for (const a of anchors.slice().sort((p, q) => q.areaPx - p.areaPx)) {
    const box = labelBoxPx(textOf ? textOf(a) : a.name, fontPx);
    if (box.w > viewW - 8) continue; // a name wider than the view cannot be shown whole
    const x = Math.min(viewW - box.w / 2 - 4, Math.max(box.w / 2 + 4, a.x)), y = Math.min(viewH - box.h / 2 - 4, Math.max(box.h / 2 + 4, a.y));
    const cand = { ...a, x, y, box };
    if (kept.some((k) => hit(k, cand)) || taken.some((k) => hit({ ...k, box: k.box }, cand))) continue;
    kept.push(cand);
  }
  return kept;
}
