/* Contour PAINT-TIME helpers — the MAIN-THREAD half of the terrain pipeline (B704).
 *
 * The marching-squares tracer moved to `contourTrace.js` (B1093) because it is worker-only
 * and is the only consumer of `d3-contour`; keeping the two halves in one module put that
 * whole dependency on the Site route's boot bundle for nothing. Nothing here imports it.
 *
 * What lives here: the ONE label formatter, the tile-seam join, the label display filter,
 * the ONE composition every renderer paints — and the NEW-1 hover hit-test, which is how a
 * cursor can name any contour while the polylines stay `interactive:false`.
 *
 * Pure — no Leaflet, no DOM; unit-tested in plain node.
 */
import { WEB_MERC_R, mercYToLat, groundScale } from "./demGrid.js";

/* THE ONE PLACE a contour label's text is built. The unit is appended HERE and only
 * here, so no code path can ever produce "150 ft ft" by concatenating twice.
 * (test/terrainLattice.test.js guards the rendered output against a doubled unit.) */
export function contourLabelText(level) {
  if (level == null || level === "") return "";
  const n = Number(level);
  if (!Number.isFinite(n)) return "";
  return `${Number.isInteger(n) ? n : Math.round(n * 10) / 10} ft`;
}

/* Stitch polylines whose endpoints coincide — the two halves of one contour that the
 * tile clip cut at a shared lattice edge. Coordinates are [lat, lng]; `eps` matches the
 * 1e-6° rounding the worker applies. Closed rings pass through untouched. Pure. */
export function joinSeams(lines, eps = 2e-6) {
  const out = [], open = [];
  for (const ln of lines) {
    if (!ln || ln.length < 2) continue;
    const a = ln[0], b = ln[ln.length - 1];
    if (a[0] === b[0] && a[1] === b[1]) out.push(ln);
    else open.push(ln);
  }
  // Chain in a CANONICAL order, not arrival order. Where three or more endpoints meet (a
  // saddle), which pair chains would otherwise depend on which tile resolved first — and
  // "depends on network timing" is precisely the class of bug this whole change removes.
  const rank = (ln) => `${ln[0][0]},${ln[0][1]}|${ln[ln.length - 1][0]},${ln[ln.length - 1][1]}|${ln.length}`;
  const byRank = (x, y) => (rank(x) < rank(y) ? -1 : rank(x) > rank(y) ? 1 : 0);
  open.sort(byRank);
  out.sort(byRank);
  const bucket = new Map();
  const key = (p) => `${Math.round(p[0] / eps)}|${Math.round(p[1] / eps)}`;
  open.forEach((ln, i) => {
    for (const [p, end] of [[ln[0], 0], [ln[ln.length - 1], 1]]) {
      const k = key(p);
      let l = bucket.get(k);
      if (!l) bucket.set(k, l = []);
      l.push({ i, end });
    }
  });
  const near = (p) => {
    const bx = Math.round(p[0] / eps), by = Math.round(p[1] / eps);
    const hits = [];
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        const l = bucket.get(`${bx + dx}|${by + dy}`);
        if (l) for (const r of l) hits.push(r);
      }
    }
    return hits;
  };
  const meets = (p, r) => Math.abs(p[0] - r[0]) <= eps && Math.abs(p[1] - r[1]) <= eps;
  const used = new Array(open.length).fill(false);
  for (let i = 0; i < open.length; i++) {
    if (used[i]) continue;
    used[i] = true;
    let chain = open[i].slice();
    for (const forward of [true, false]) {
      for (let guard = 0; guard < 256; guard++) {
        const tip = forward ? chain[chain.length - 1] : chain[0];
        let hit = null;
        for (const ref of near(tip)) {
          if (used[ref.i]) continue;
          const cand = open[ref.i];
          if (meets(tip, ref.end === 0 ? cand[0] : cand[cand.length - 1])) { hit = ref; break; }
        }
        if (!hit) break;
        used[hit.i] = true;
        const seg = hit.end === 0 ? open[hit.i] : open[hit.i].slice().reverse(); // starts at the joint
        chain = forward ? chain.concat(seg.slice(1)) : seg.slice(1).reverse().concat(chain);
      }
    }
    out.push(chain);
  }
  return out;
}

/* The DISPLAY filter over already-anchored labels (never the chooser).
 *  1. dedupe by (level, tileKey, anchor) — one contour cannot stamp twice even if a
 *     superseded compute slipped a duplicate artifact through;
 *  2. drop a label of the SAME level sitting within `minSepDeg` of one already kept —
 *     this is what keeps two tiles from both labelling the metre either side of a seam;
 *  3. cap the total, for DOM sanity only.
 * Ordering is by (tileKey, level, anchor) — ground-anchored, so the surviving set does
 * not depend on which order the tiles happened to resolve in. Pure. */
export const LABEL_CAP = 60;                // DOM sanity bound only
export const LABEL_MIN_SEP_CELLS = 260;     // two tiles must not both label either side of a seam

export function pickLabels(labels, { minSepDeg = 0, cap = LABEL_CAP } = {}) {
  const id = (l) => `${l.tileKey || ""}|${l.level}|${l.anchor || ""}`;
  const sorted = labels.slice().sort((a, b) => (id(a) < id(b) ? -1 : id(a) > id(b) ? 1 : 0));
  const seen = new Set(), out = [];
  for (const lab of sorted) {
    const k = id(lab);
    if (seen.has(k)) continue;
    seen.add(k);
    if (minSepDeg > 0) {
      const kx = Math.cos((lab.ll[0] * Math.PI) / 180);
      const crowded = out.some((o) => o.level === lab.level &&
        Math.hypot((o.ll[1] - lab.ll[1]) * kx, o.ll[0] - lab.ll[0]) < minSepDeg);
      if (crowded) continue;
    }
    out.push(lab);
    if (out.length >= cap) break;
  }
  return out;
}

// ---------------------------------------------------------------------------
// NEW-1 — HOVER HIT-TESTING. Only the sparse every-5-ft INDEX lines carry a permanent
// label, so four out of every five contours were unreadable. The lines themselves are
// deliberately `interactive:false` (B704: thousands of 1-ft polylines with Leaflet hit
// areas is the perf cliff), so the answer is a hit-test IN JS over the composed geometry
// — the picture stays a plain canvas paint, and the cursor still gets an answer.
//
// The index is a flat spatial bucket over the composed lat/lng lines: a cursor probe
// touches a handful of buckets instead of every segment in view. B1088's fixed world
// lattice is what makes a hit STABLE — the same ground is always traced from the same
// cells, so the line under the cursor carries the same elevation from one frame to the
// next. Pure (no Leaflet, no DOM) so it unit-tests in plain node.

export const HOVER_TOL_PX = 6;        // how close the cursor must come to a line, in CSS px
export const DOUBLE_STAMP_PX = 40;    // an index label this close already answers — don't stamp twice
const INDEX_CELL_DEG = 0.001;         // ~110 m — a bucket holds a handful of segments at z17
const BIG_SEG_CELLS = 32;             // a segment spanning more than this goes in the always-scanned list

/* Closest point on segment a→b to p, all in DEGREES with longitude pre-scaled by
 * cos(lat) so a degree of longitude and a degree of latitude compare as equal ground.
 * Returns { d, lat, lng } — d in scaled degrees. */
function segDist(pLat, pLng, a, b, kx) {
  const ax = a[1] * kx, ay = a[0], bx = b[1] * kx, by = b[0];
  const px = pLng * kx, py = pLat;
  const dx = bx - ax, dy = by - ay;
  const len2 = dx * dx + dy * dy;
  let t = len2 === 0 ? 0 : ((px - ax) * dx + (py - ay) * dy) / len2;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const qx = ax + t * dx, qy = ay + t * dy;
  return { d: Math.hypot(px - qx, py - qy), lat: qy, lng: qx / kx };
}

/* Bucket index over composed contour lines ([{ coords: [[lat,lng],…], level, isIndex }]).
 * Returns { cellDeg, cells: Map<string, seg[]>, big: seg[], count } where a seg is
 * { a, b, level, isIndex }. Pure. */
export function buildContourIndex(lines, { cellDeg = INDEX_CELL_DEG } = {}) {
  const cells = new Map(), big = [];
  let count = 0;
  const put = (k, seg) => {
    let l = cells.get(k);
    if (!l) cells.set(k, l = []);
    l.push(seg);
  };
  for (const ln of lines || []) {
    const coords = ln && ln.coords;
    if (!coords || coords.length < 2) continue;
    for (let i = 0; i < coords.length - 1; i++) {
      const a = coords[i], b = coords[i + 1];
      const seg = { a, b, level: ln.level, isIndex: !!ln.isIndex };
      count++;
      const i0 = Math.floor(Math.min(a[0], b[0]) / cellDeg), i1 = Math.floor(Math.max(a[0], b[0]) / cellDeg);
      const j0 = Math.floor(Math.min(a[1], b[1]) / cellDeg), j1 = Math.floor(Math.max(a[1], b[1]) / cellDeg);
      if ((i1 - i0 + 1) * (j1 - j0 + 1) > BIG_SEG_CELLS) { big.push(seg); continue; }
      for (let i2 = i0; i2 <= i1; i2++) for (let j2 = j0; j2 <= j1; j2++) put(`${i2}|${j2}`, seg);
    }
  }
  return { cellDeg, cells, big, count };
}

/* The contour line under the cursor, or null. `tolDeg` is the search radius in degrees
 * of LATITUDE (the caller converts HOVER_TOL_PX through the live map scale, so the
 * tolerance is a constant number of screen pixels at every zoom). Returns
 * { level, isIndex, ll: [lat, lng] (the closest point ON the line), distDeg }. Pure. */
export function hitContour(index, lat, lng, tolDeg) {
  if (!index || !(tolDeg > 0) || !Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  const kx = Math.max(1e-6, Math.cos((lat * Math.PI) / 180));
  const { cellDeg, cells, big } = index;
  // Longitude spans more cells than latitude for the same ground distance — widen by 1/kx.
  const i0 = Math.floor((lat - tolDeg) / cellDeg), i1 = Math.floor((lat + tolDeg) / cellDeg);
  const j0 = Math.floor((lng - tolDeg / kx) / cellDeg), j1 = Math.floor((lng + tolDeg / kx) / cellDeg);
  let best = null;
  const consider = (seg) => {
    const r = segDist(lat, lng, seg.a, seg.b, kx);
    if (r.d > tolDeg) return;
    // Ties (a cursor equidistant from two lines) resolve by LEVEL, so the answer under a
    // resting cursor cannot depend on segment order — the same determinism rule as B1087.
    if (!best || r.d < best.distDeg - 1e-12 ||
      (Math.abs(r.d - best.distDeg) <= 1e-12 && seg.level < best.level)) {
      best = { level: seg.level, isIndex: seg.isIndex, ll: [r.lat, r.lng], distDeg: r.d };
    }
  };
  for (let i = i0; i <= i1; i++) {
    for (let j = j0; j <= j1; j++) {
      const l = cells.get(`${i}|${j}`);
      if (l) for (const seg of l) consider(seg);
    }
  }
  for (const seg of big) consider(seg);
  return best;
}

/* THE ONE composition of a painted contour view, shared by every consumer so screen and
 * test can't drift. `parts` is [{ tile, data }] — one per lattice tile in the cover, in
 * any order and possibly containing a duplicate (a superseded artifact that slipped
 * through). Returns exactly what a renderer needs:
 *   { lines: [{ coords, level, isIndex }], labels: [{ ll, level, text }] }
 * The guarantees this function OWNS, and that test/terrainLattice.test.js exercises
 * against a real captured 3DEP tile:
 *   - one label per (level, tileKey, anchor) — a doubled artifact cannot stamp twice;
 *   - label text carries the unit exactly once (contourLabelText is the only formatter);
 *   - output is identical however the parts are ordered — no re-roll on tile timing;
 *   - halves of one contour cut at a shared lattice edge come back as ONE polyline. */
export function composeContourPaint(parts, { cap = LABEL_CAP, minSepCells = LABEL_MIN_SEP_CELLS } = {}) {
  const byLevel = new Map();
  const labels = [];
  let cellMeters = 0, lat = 0;
  for (const { tile, data } of parts || []) {
    const c = data && data.contours;
    if (!tile || !c || !c.levels) continue;
    if (tile.cellMeters > cellMeters) cellMeters = tile.cellMeters;
    if (tile.bbox) lat = mercYToLat((tile.bbox.ymin + tile.bbox.ymax) / 2);
    for (const lv of c.levels) {
      let e = byLevel.get(lv.level);
      if (!e) byLevel.set(lv.level, e = { level: lv.level, isIndex: lv.isIndex, lines: [] });
      for (const line of lv.lines) e.lines.push(line);
    }
    for (const lab of c.labels || []) labels.push({ ...lab, tileKey: tile.key });
  }
  const lines = [];
  for (const e of [...byLevel.values()].sort((a, b) => a.level - b.level)) {
    for (const coords of joinSeams(e.lines)) lines.push({ coords, level: e.level, isIndex: e.isIndex });
  }
  // Minimum label separation is expressed in CELLS of the band's fixed grid, so it is a
  // property of the ground, not of the window the user happens to have open.
  const minSepDeg = cellMeters
    ? (minSepCells * cellMeters * groundScale(lat) * 180) / (Math.PI * WEB_MERC_R) : 0;
  return {
    lines,
    labels: pickLabels(labels, { minSepDeg, cap })
      .map((l) => ({ ll: l.ll, level: l.level, text: contourLabelText(l.level) })),
  };
}
