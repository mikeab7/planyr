/* lib/parkingApproach.js — how a road meets a CAR PARKING field's INSIDE (NEW-1, road → employee parking, every approach).
 *
 * `roadJunctions.js` owns the OUTSIDE of the junction (the curb returns where the drive's curb meets the field's face). This module owns what
 * the field itself has to do about the drive — the things a civil plan shows and the raw rect never did:
 *
 *   • AISLE SNAP   — a road that lands on a field's END face (the face the aisles open on) is centred on the aisle it is aimed at, so the drive and
 *                    the aisle read as one corridor instead of an entrance a few feet off. Rect fields only (a free-drawn field has no stall layout).
 *   • STALL GAP    — a road that lands on a ROW side (the long face a stall row backs onto) has to cross that row to reach the aisle. The stalls its
 *                    pavement passes through are REMOVED: not drawn, and not counted (the field's stall total drops by exactly that many).
 *   • THROUGH      — a road that crosses the field wholesale removes the stalls under it the same way, and interrupts the field's outline where it crosses.
 *   • PERIMETER    — a drive running ALONG the face the aisles dead-end onto opens every aisle's mouth in the field's outline there.
 *
 * Pure: world feet in, world feet out. No React, no DOM. The stall layout is `siteGeometry.carStalls` itself (the renderer's own), so what is removed here
 * is exactly the stall the canvas would have drawn — never a second layout. Stalls are CELLS: band `i`, column `k` → the rect [k·pitch, (k+1)·pitch] ×
 * [band.y, band.y + band.depth] in the field's local frame (origin = top-left corner, x along `w`, y along `h`).
 *
 * WHAT IS DECIDED HERE, stated so nobody re-derives it:
 *   - A stall is REMOVED when the drive's footprint covers more than STALL_HIT_FRACTION (15%) of its cell. A 26 ft road in a 24 ft aisle overlaps each
 *     row by 1.5 ft = 8% of a stall: that is the aisle, not a crossing, and removes nothing. A road crossing a row removes whole stalls, never half of one.
 *   - A drive that lands on an END face removes NO stalls: it lies in the aisle (after the snap). A road wider than its aisle simply butts the rows' ends.
 *   - A drive that lands on a face whose first band is an AISLE (flipDepth, or a single-loaded bay) removes none either — it has arrived.
 *   - A drive within ~10° of the face (a skim, roadJunctions SKIM_MAX_PHI_DEG) crosses nothing and removes nothing.
 */
import { carStalls } from "./siteGeometry.js";

export const AISLE_SNAP_EXTRA_FT = 6;      // a landing within (half the aisle + 6 ft) of an aisle's centreline snaps to it
export const END_FACE_TOL_FT = 1.0;        // "on the end face": within this of local x = 0 or x = w
export const ROW_FACE_TOL_FT = 1.0;        // "on a side face": within this of local y = 0 or y = h
export const STALL_HIT_FRACTION = 0.15;    // share of a stall's cell the drive must cover to remove it
export const MIN_ROW_CROSS_SIN = 0.17;     // a drive flatter than this (sin of the angle to the face; ~10°) crosses no row

const rad = (d) => (d * Math.PI) / 180;

/** a rect parking field with a stall layout (a free-drawn ring has none — only an estimate) */
export const isRectParking = (el) => !!el && el.type === "parking" && !el.points && typeof el.cx === "number" && typeof el.cy === "number" && el.w > 0 && el.h > 0;

export function stallLayoutOf(el, settings) {
  if (!isRectParking(el)) return null;
  return carStalls(el.w, el.h, el.cfg ? { ...settings, ...el.cfg } : settings);
}

/* THE AISLES OF A FIELD, read off its BANDS — every stretch of the field's depth no stall row covers, at least MIN_AISLE_GAP_FT deep. `carStalls.aisles` lists only the
 * aisles BETWEEN two rows of a full module; a field that is not a whole number of modules (the owner's 220×42 employee field is ONE row plus a 24 ft lane, 18 + 24)
 * keeps its lane as the leftover depth, which `carStalls` never reports as an aisle — and a drive into it has an aisle to reach and snap to all the same. */
export const MIN_AISLE_GAP_FT = 10;
export function aislesOf(L, h) {
  if (!L) return [];
  const bands = L.bands.filter((b) => b.n > 0).map((b) => [b.y, b.y + b.depth]).sort((a, b) => a[0] - b[0]);
  const out = [];
  let at = 0;
  for (const [y0, y1] of bands) { if (y0 - at >= MIN_AISLE_GAP_FT) out.push({ y0: at, y1: y0 }); at = Math.max(at, y1); }
  if (h - at >= MIN_AISLE_GAP_FT) out.push({ y0: at, y1: h });
  return out;
}

/** the field's local frame: origin top-left, x along w, y along h (what `carStalls` lays its bands in) */
export function rectFrame(el) {
  const r = rad(el.rot || 0), c = Math.cos(r), s = Math.sin(r);
  return {
    toLocal: (p) => { const dx = p.x - el.cx, dy = p.y - el.cy; return { x: c * dx + s * dy + el.w / 2, y: -s * dx + c * dy + el.h / 2 }; },
    toWorld: (l) => { const dx = l.x - el.w / 2, dy = l.y - el.h / 2; return { x: el.cx + dx * c - dy * s, y: el.cy + dx * s + dy * c }; },
    dirToLocal: (v) => ({ x: c * v.x + s * v.y, y: -s * v.x + c * v.y }),
  };
}

/** the aisle a landing on the END face is aimed at → { pt (world, on the face, on the aisle's centreline), aisleIndex, movedFt } | null */
export function snapToAisle(el, settings, pt) {
  const L = stallLayoutOf(el, settings);
  const aisles = aislesOf(L, el && el.h);
  if (!L || !aisles.length || !pt) return null;
  const f = rectFrame(el), l = f.toLocal(pt);
  const onLeft = Math.abs(l.x) <= END_FACE_TOL_FT, onRight = Math.abs(l.x - el.w) <= END_FACE_TOL_FT;
  if (!onLeft && !onRight) return null;
  let best = null;
  aisles.forEach((a, i) => {
    const mid = (a.y0 + a.y1) / 2, d = Math.abs(l.y - mid);
    if (d <= (a.y1 - a.y0) / 2 + AISLE_SNAP_EXTRA_FT && (!best || d < best.d)) best = { d, mid, i };
  });
  if (!best) return null;
  return { pt: f.toWorld({ x: onLeft ? 0 : el.w, y: best.mid }), aisleIndex: best.i, movedFt: best.d };
}

/** The aisle snap a CONNECT GESTURE may apply — `snapToAisle` plus the one rule that keeps it from wrecking a road: it never RE-AIMS the drive's last leg by more than
 *  SNAP_MAX_TURN_DEG. `from` is the road vertex behind the landing (null when there is none — a road started on the field). On the owner's Tsakiris drive the last leg
 *  after a 50 ft corner is 37 ft long; sliding its end 7.6 ft sideways turns it 11.6° and the corner arc has no room left (it kinks), so there the placement is left
 *  exactly where the person put it — the snap is a convenience for a straight approach, never a reason to bend one. */
export const SNAP_MAX_TURN_DEG = 8;
export function aisleSnapFor(el, settings, pt, from) {
  const sn = snapToAisle(el, settings, pt);
  if (!sn) return null;
  if (from && Number.isFinite(from.x) && Number.isFinite(from.y)) {
    const a = Math.atan2(pt.y - from.y, pt.x - from.x), b = Math.atan2(sn.pt.y - from.y, sn.pt.x - from.x);
    let d = Math.abs(a - b) % (2 * Math.PI); if (d > Math.PI) d = 2 * Math.PI - d;
    if ((d * 180) / Math.PI > SNAP_MAX_TURN_DEG) return null;
  }
  return sn;
}

/* ---- convex clipping (Sutherland–Hodgman) — the cell and the corridor are both convex quads ---- */
const areaOf = (r) => { let s = 0; for (let i = 0; i < r.length; i++) { const q = r[(i + 1) % r.length]; s += r[i].x * q.y - q.x * r[i].y; } return Math.abs(s) / 2; };
function clipConvex(subject, clip) {
  let out = subject;
  const ccw = ((clip[1].x - clip[0].x) * (clip[2].y - clip[0].y) - (clip[1].y - clip[0].y) * (clip[2].x - clip[0].x)) > 0;
  for (let i = 0; i < clip.length && out.length; i++) {
    const a = clip[i], b = clip[(i + 1) % clip.length];
    const inside = (p) => { const cr = (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x); return ccw ? cr >= -1e-9 : cr <= 1e-9; };
    const hit = (p, q) => { const d1 = (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x), d2 = (b.x - a.x) * (q.y - a.y) - (b.y - a.y) * (q.x - a.x); const t = d1 / (d1 - d2); return { x: p.x + (q.x - p.x) * t, y: p.y + (q.y - p.y) * t }; };
    const input = out; out = [];
    for (let j = 0; j < input.length; j++) {
      const p = input[j], q = input[(j + 1) % input.length], pi = inside(p), qi = inside(q);
      if (pi && qi) out.push(q); else if (pi && !qi) out.push(hit(p, q)); else if (!pi && qi) { out.push(hit(p, q)); out.push(q); }
    }
  }
  return out;
}
export const overlapFraction = (cell, corridor) => { const c = clipConvex(cell, corridor); return c.length >= 3 ? areaOf(c) / (areaOf(cell) || 1) : 0; };

/** every stall cell of a rect field, in the field's LOCAL frame: [{ band, k, ring:[4 local pts] }] (callers filter by bbox) */
function cellsIn(L, xr, yr) {
  const out = [];
  L.bands.forEach((b, bi) => {
    if (b.y + b.depth < yr[0] || b.y > yr[1]) return;
    const k0 = Math.max(0, Math.floor(xr[0] / b.pitch)), k1 = Math.min(b.n - 1, Math.floor(xr[1] / b.pitch));
    for (let k = k0; k <= k1; k++) {
      const x0 = k * b.pitch, x1 = (k + 1) * b.pitch, y0 = b.y, y1 = b.y + b.depth;
      out.push({ band: bi, k, ring: [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }] });
    }
  });
  return out;
}

/** The corridor each drive that lands on a ROW SIDE of field `el` cuts through the row(s) in front of the aisle: [{ roadId, ring (world), removed:[{band,k}] }].
 *  `junctions` = `driveJunctionsOf` rows (any target — filtered here). */
export function driveCorridorsOf(el, settings, junctions) {
  const L = stallLayoutOf(el, settings);
  if (!L || !L.bands.length) return [];
  const f = rectFrame(el), out = [];
  for (const j of junctions || []) {
    if (!j || j.targetId !== el.id || (j.geom && j.geom.skim)) continue;
    const J = f.toLocal(j.junctionPt);
    const d = f.dirToLocal({ x: -j.sideU.x, y: -j.sideU.y });              // into the field, local
    const top = Math.abs(J.y) <= ROW_FACE_TOL_FT && d.y > 0, bottom = Math.abs(J.y - el.h) <= ROW_FACE_TOL_FT && d.y < 0;
    if (!top && !bottom) continue;                                           // an end face (or a corner): the drive lies in the aisle — nothing to remove
    const sin = Math.abs(d.y);
    if (sin < MIN_ROW_CROSS_SIN) continue;
    const toAisle = aislesOf(L, el.h).map((a) => (top ? a.y0 : el.h - a.y1)).filter((v) => v > -1e-6).sort((a, b) => a - b);
    const depth = toAisle.length ? toAisle[0] : el.h;                        // to the first aisle, or across a single-loaded field
    if (depth <= 0.5) continue;                                              // an aisle on the face itself: the drive has arrived
    const hw = j.halfS, n = { x: -d.y, y: d.x };
    const len = (depth + hw * Math.abs(n.y)) / sin + 0.5;                    // far enough that BOTH of the strip's edges have reached the aisle
    /* The corridor is the drive's own straight strip carried on into the field — and at an OBLIQUE approach the strip's acute side enters the field BEFORE
     * the line through the junction square to the drive's axis, so the corridor starts `hw` behind it (cells only exist inside the field, so the extra
     * reach behind the face selects nothing it should not). */
    const lead = 2 * hw + 1, S = { x: J.x - d.x * lead, y: J.y - d.y * lead }, total = len + lead;
    const ring = [
      { x: S.x + n.x * hw, y: S.y + n.y * hw }, { x: S.x + n.x * hw + d.x * total, y: S.y + n.y * hw + d.y * total },
      { x: S.x - n.x * hw + d.x * total, y: S.y - n.y * hw + d.y * total }, { x: S.x - n.x * hw, y: S.y - n.y * hw },
    ];
    const xs = ring.map((p) => p.x), ys = ring.map((p) => p.y);
    const removed = [];
    for (const c of cellsIn(L, [Math.min(...xs), Math.max(...xs)], [Math.min(...ys), Math.max(...ys)])) {
      if (overlapFraction(c.ring, ring) > STALL_HIT_FRACTION) removed.push({ band: c.band, k: c.k });
    }
    out.push({ roadId: j.sideId, ring: ring.map((p) => f.toWorld(p)), removed });
  }
  return out;
}

/** Roads that cross field `el` wholesale (both ends outside it, some of the road inside): [{ roadId, removed:[{band,k}] }].
 *  `stripOf(road)` → the road's pavement ring (world) — the real strip the renderer draws. */
export function throughDrivesOf(el, settings, roads, stripOf, snapFt = 6) {
  const L = stallLayoutOf(el, settings);
  if (!L) return [];
  const f = rectFrame(el), out = [];
  const inside = (l) => l.x > 0 && l.x < el.w && l.y > 0 && l.y < el.h;
  const nearOrIn = (l) => l.x > -snapFt && l.x < el.w + snapFt && l.y > -snapFt && l.y < el.h + snapFt;   // an endpoint on / in the field is a junction (driveCorridorsOf), not a crossing
  for (const r of roads || []) {
    if (!r || !Array.isArray(r.pts) || r.pts.length < 2 || r.attachedTo) continue;
    const a = f.toLocal(r.pts[0]), b = f.toLocal(r.pts[r.pts.length - 1]);
    if (nearOrIn(a) || nearOrIn(b)) continue;
    let crosses = false;
    for (let i = 0; i + 1 < r.pts.length && !crosses; i++) {
      const p = f.toLocal(r.pts[i]), q = f.toLocal(r.pts[i + 1]), n = Math.max(2, Math.ceil(Math.hypot(q.x - p.x, q.y - p.y) / 2));
      for (let k = 1; k < n; k++) if (inside({ x: p.x + ((q.x - p.x) * k) / n, y: p.y + ((q.y - p.y) * k) / n })) { crosses = true; break; }
    }
    if (!crosses) continue;
    const strip = stripOf ? stripOf(r) : null;
    if (!strip || strip.length < 3) continue;
    const ls = strip.map((p) => f.toLocal(p));
    const xs = ls.map((p) => p.x), ys = ls.map((p) => p.y);
    const removed = [];
    for (const c of cellsIn(L, [Math.min(...xs), Math.max(...xs)], [Math.min(...ys), Math.max(...ys)])) {
      let hit = 0; const N = 5;
      for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) {
        const u = (i + 0.5) / N, v = (j + 0.5) / N, p = { x: c.ring[0].x + (c.ring[1].x - c.ring[0].x) * u, y: c.ring[0].y + (c.ring[3].y - c.ring[0].y) * v };
        if (pointInPoly(p, ls)) hit++;
      }
      if (hit / (N * N) > STALL_HIT_FRACTION) removed.push({ band: c.band, k: c.k });
    }
    out.push({ roadId: r.id, removed });
  }
  return out;
}
function pointInPoly(p, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i].x, yi = ring[i].y, xj = ring[j].x, yj = ring[j].y;
    if ((yi > p.y) !== (yj > p.y) && p.x < ((xj - xi) * (p.y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** The stalls of field `el` that a drive takes: `{ base, removed:[{band,k}], count, set:Set("band:k"), corridors:[world rings] }` | null for a non-rect field.
 *  `through` = the throughDrivesOf rows for this field (computed where the road strips are known). */
export function stallClipOf(el, settings, junctions, through) {
  const L = stallLayoutOf(el, settings);
  if (!L) return null;
  const corridors = driveCorridorsOf(el, settings, junctions);
  const set = new Set(), removed = [];
  const take = (list) => { for (const r of list) { const key = `${r.band}:${r.k}`; if (!set.has(key)) { set.add(key); removed.push({ band: r.band, k: r.k }); } } };
  corridors.forEach((c) => take(c.removed));
  (through || []).forEach((t) => take(t.removed));
  return { base: L.count, removed, count: Math.max(0, L.count - removed.length), set, corridors: corridors.map((c) => c.ring) };
}

/** a band's KEPT stalls as contiguous runs [{k0, k1}] (inclusive) — each run is drawn as its own row, with its own end walls at a gap */
export function keptRuns(n, set, band) {
  const runs = [];
  let start = -1;
  for (let k = 0; k <= n; k++) {
    const kept = k < n && !(set && set.has(`${band}:${k}`));
    if (kept && start < 0) start = k;
    if (!kept && start >= 0) { runs.push({ k0: start, k1: k - 1 }); start = -1; }
  }
  return runs;
}

/** The mouths a drive running ALONG a field's END face opens in its outline: one per aisle the drive's span covers. Returns [{ a, b }] (world points ON the face).
 *  `roads` = centerline roads. A drive "runs along" the face when its centreline is parallel to it (within 4°), lies OUTSIDE the field with its near curb
 *  touching (or lapping up to 2 ft over) the face, and its span overlaps the aisle's opening. */
export const PERIMETER_PARALLEL_DEG = 4;
export function perimeterMouthsOf(el, settings, roads, halfOf) {
  const L = stallLayoutOf(el, settings);
  const aisles = aislesOf(L, el && el.h);
  if (!L || !aisles.length) return [];
  const f = rectFrame(el), out = [], sinTol = Math.sin(rad(PERIMETER_PARALLEL_DEG));
  for (const r of roads || []) {
    if (!r || !Array.isArray(r.pts) || r.pts.length < 2 || r.attachedTo) continue;
    const hw = halfOf(r);
    for (let i = 0; i + 1 < r.pts.length; i++) {
      const p = f.toLocal(r.pts[i]), q = f.toLocal(r.pts[i + 1]);
      const dx = q.x - p.x, dy = q.y - p.y, len = Math.hypot(dx, dy);
      if (len < 1) continue;
      if (Math.abs(dx) / len > sinTol) continue;                              // not parallel to a face that runs along local y
      const x = (p.x + q.x) / 2;
      for (const faceX of [0, el.w]) {
        const out_ = faceX === 0 ? -x : x - el.w;                             // how far the centreline sits OUTSIDE this face
        if (out_ <= 0) continue;
        const curbGap = out_ - hw;                                            // 0 = the near curb is on the face
        if (curbGap < -2 || curbGap > 4) continue;
        const lo = Math.min(p.y, q.y), hi = Math.max(p.y, q.y);
        const o0 = f.toWorld({ x: faceX, y: 0 }), o1 = f.toWorld({ x: faceX + (faceX === 0 ? -1 : 1), y: 0 });
        const outN = { x: o1.x - o0.x, y: o1.y - o0.y };                          // unit, out of the field at this face
        for (const a of aisles) {
          if (a.y1 < lo || a.y0 > hi) continue;                               // the drive does not pass this aisle's opening
          const y0 = Math.max(a.y0, lo), y1 = Math.min(a.y1, hi);
          if (y1 - y0 < 1) continue;
          out.push({ a: f.toWorld({ x: faceX, y: y0 }), b: f.toWorld({ x: faceX, y: y1 }), roadId: r.id, outN, half: hw });
        }
      }
    }
  }
  return out;
}

/** ⛔ THE ONE ANSWER to "what does each car field do about the roads around it?" — read by the renderer's road network (roadNetBuild) AND by the Yield total
 * (siteMetrics), so the stalls drawn and the stalls counted cannot disagree.
 *   `junctions` — `driveJunctionsOf(els, settings)`;  `roads` — the centerline roads that count (the caller has already dropped hidden ones);
 *   `stripOf(road)` — the road's pavement ring;  `halfOf(road)` — centreline → back-of-curb;  `isHidden(el)` — a hidden field is not part of the picture.
 * Returns Map<fieldId, { clip (stallClipOf | null), through:[{roadId,removed}], perimeter:[{a,b,roadId}] }> for the fields where something happens. */
export function fieldInsidesOf({ els, settings, junctions, roads, stripOf, halfOf, isHidden }) {
  const out = new Map();
  for (const T of els || []) {
    if (!isRectParking(T) || (isHidden && isHidden(T))) continue;
    const js = (junctions || []).filter((dj) => dj.targetId === T.id);
    const through = throughDrivesOf(T, settings, roads, stripOf);
    const perimeter = perimeterMouthsOf(T, settings, roads, halfOf);
    if (!js.length && !through.length && !perimeter.length) continue;
    out.set(T.id, { clip: js.length || through.length ? stallClipOf(T, settings, js, through) : null, through, perimeter });
  }
  return out;
}

/** the number of stalls the plan's car field `el` really has once its drives are cut through it (a free-drawn ring has only an estimate: null) */
export const effectiveStallCount = (inside, el, settings) => {
  const L = stallLayoutOf(el, settings);
  if (!L) return null;
  const r = inside && inside.get(el.id);
  return r && r.clip ? r.clip.count : L.count;
};
