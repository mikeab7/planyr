/* The Setbacks section's COMPACT summary + the sketch's label placement (NEW-1, B2191xxx).
 *
 *   summarizeSetbacks(sections) — the ONE common value ("Setback 25 ft · all sections") and the few
 *       sections that differ from it. A parcel whose sections all share a value shows only the one
 *       line; a section with mixed edges always counts as a difference.
 *   layoutSectionLabels(items, opts) — one label per section, placed so no two labels overlap and
 *       none leaves the sketch. A section too short to hold a label gets none (it is labelled while
 *       it is hovered or selected, via `force`). Pure: no DOM, no React.
 *
 *   pickVertexDots(pts, breaks) — which vertices get a button in "Split or join sections" (NEW-1,
 *       2026-11-06). A digitised curve has a dozen vertices inside a few viewBox units, so a dot on every
 *       vertex buried the real corners (the owner could not find the north/south corner on the Academy
 *       lot). Every current BREAK is always offered (it is the only way to join), the rest are the sharpest
 *       turns first, none closer than DOT_MIN_GAP to another dot, and not near-collinear ones.
 *
 * Sketch space is the SVG viewBox (y down). Every number here is a viewBox unit, never CSS pixels.
 */

/* @returns { common: number|null, others: section[] } — `common` is the setback covering the most
 * boundary length (ties → the larger value), `others` the sections whose value is not it. */
export function summarizeSetbacks(sections) {
  const list = Array.isArray(sections) ? sections : [];
  const byValue = new Map();
  for (const s of list) {
    if (s.value == null) continue;
    byValue.set(s.value, (byValue.get(s.value) || 0) + (s.lengthFt || 0));
  }
  let common = null, best = -1;
  for (const [v, len] of byValue) if (len > best || (len === best && v > common)) { best = len; common = v; }
  return { common, others: list.filter((s) => s.value == null || s.value !== common) };
}

const polyLen = (pts) => { let l = 0; for (let i = 1; i < pts.length; i++) l += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y); return l; };

/* Point + unit tangent at fraction t of a polyline. */
export function pointOnPolyline(pts, t) {
  const total = polyLen(pts);
  if (!(total > 0)) return { x: pts[0].x, y: pts[0].y, tx: 1, ty: 0 };
  let want = total * Math.min(1, Math.max(0, t));
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i], l = Math.hypot(b.x - a.x, b.y - a.y);
    if (want <= l || i === pts.length - 1) {
      const u = l > 0 ? Math.min(1, want / l) : 0;
      return { x: a.x + (b.x - a.x) * u, y: a.y + (b.y - a.y) * u, tx: l > 0 ? (b.x - a.x) / l : 1, ty: l > 0 ? (b.y - a.y) / l : 0 };
    }
    want -= l;
  }
  return { x: pts[0].x, y: pts[0].y, tx: 1, ty: 0 };
}

const overlaps = (a, b, pad = 1.5) => !(a.x + a.w + pad <= b.x || b.x + b.w + pad <= a.x || a.y + a.h + pad <= b.y || b.y + b.h + pad <= a.y);
const T_STEPS = [0.5, 0.36, 0.64, 0.24, 0.76, 0.12, 0.88];
const OFFSETS = [13, 22, -13, -22];

/* @param items [{ key, pts (sketch-space polyline), text, force? }]  `force` = place even when the
 *        section is short (the selected / hovered one).
 * @param opts { width, height (the viewBox), charW (text width per char), boxH, minLen, centre }
 * @returns Map key → { x, y, w, h } (x,y = box centre) for every placed label; unplaced keys are absent. */
export function layoutSectionLabels(items, { width = 300, height = 150, charW = 6.6, boxH = 14, minLen = 26, centre = null, avoid = [] } = {}) {
  const out = new Map();
  const placed = avoid.slice();
  const cen = centre || { x: width / 2, y: height / 2 };
  const order = (items || []).map((it) => ({ it, len: polyLen(it.pts) }))
    .sort((a, b) => (b.it.force ? 1 : 0) - (a.it.force ? 1 : 0) || b.len - a.len);
  for (const { it, len } of order) {
    if (!it.pts || it.pts.length < 2) continue;
    if (len < minLen && !it.force) continue;
    const w = Math.max(14, String(it.text).length * charW + 6), h = boxH;
    let hit = null;
    search: for (const off of OFFSETS) {
      for (const t of T_STEPS) {
        const p = pointOnPolyline(it.pts, t);
        // inward normal = the side facing the sketch centre
        let nx = -p.ty, ny = p.tx;
        if ((cen.x - p.x) * nx + (cen.y - p.y) * ny < 0) { nx = -nx; ny = -ny; }
        const cx = p.x + nx * off, cy = p.y + ny * off;
        const box = { x: cx - w / 2, y: cy - h / 2, w, h };
        if (box.x < 1 || box.y < 1 || box.x + box.w > width - 1 || box.y + box.h > height - 1) continue;
        if (placed.some((o) => overlaps(box, o))) continue;
        hit = box; break search;
      }
    }
    if (hit) { placed.push(hit); out.set(it.key, { x: hit.x + hit.w / 2, y: hit.y + hit.h / 2, w: hit.w, h: hit.h }); }
  }
  return out;
}

export const DOT_MIN_GAP = 12;
export const DOT_MIN_TURN_DEG = 6;

/* Turn of the sketch outline at vertex i, degrees 0..180. */
function sketchTurn(pts, i) {
  const n = pts.length, a = pts[(i - 1 + n) % n], p = pts[i], b = pts[(i + 1) % n];
  const ax = p.x - a.x, ay = p.y - a.y, bx = b.x - p.x, by = b.y - p.y;
  if (!(Math.hypot(ax, ay) > 1e-9) || !(Math.hypot(bx, by) > 1e-9)) return 0;
  let d = ((Math.atan2(by, bx) - Math.atan2(ay, ax)) * 180) / Math.PI;
  while (d > 180) d -= 360;
  while (d <= -180) d += 360;
  return Math.abs(d);
}

/* @param pts sketch-space ring (open, viewBox units) @param breaks vertex indices that are section starts
 * @returns [{ i, isBreak }] ascending by vertex index. */
export function pickVertexDots(pts, breaks, { minGap = DOT_MIN_GAP, minTurn = DOT_MIN_TURN_DEG } = {}) {
  const n = Array.isArray(pts) ? pts.length : 0;
  if (!n) return [];
  const brk = [...new Set((breaks || []).filter((v) => Number.isInteger(v) && v >= 0 && v < n))].sort((a, b) => a - b);
  const placed = brk.map((i) => ({ i, isBreak: true }));
  const isBrk = new Set(brk);
  const cand = [];
  for (let i = 0; i < n; i++) if (!isBrk.has(i)) { const t = sketchTurn(pts, i); if (t >= minTurn) cand.push({ i, t }); }
  cand.sort((a, b) => b.t - a.t || a.i - b.i);
  for (const c of cand) {
    if (placed.every((d) => Math.hypot(pts[d.i].x - pts[c.i].x, pts[d.i].y - pts[c.i].y) >= minGap)) placed.push({ i: c.i, isBreak: false });
  }
  return placed.sort((a, b) => a.i - b.i);
}
