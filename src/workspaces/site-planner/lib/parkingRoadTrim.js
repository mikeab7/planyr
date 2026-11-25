/* lib/parkingRoadTrim.js — a car or trailer parking field that a ROAD cuts into is TRIMMED to the road like a designed lot (NEW-1, owner 2026-11-24).
 *
 * Owner, verbatim: "I like where the parking expansion feature goes, where it just doesn't populate over an existing road. However … I'd like it to kind of curve
 * off and trace the road … to where it just becomes like a proper design." And: "there needs to be a connecting road. If the main road is blocking it off, it's not
 * going to connect to that main road … we would have the aisles connecting to each other."
 *
 * Before this, a road crossing a field removed the stalls it covered more than 15% of (parkingApproach.throughDrivesOf) and nothing else: the field still painted
 * its full rectangle of pavement under the road, and the dropped stalls read as a jagged staircase. Approved mockup: mockups/parking-trace-road-v3.png (+ the 14-layout sheet parking-trace-road-v3-scenarios.png).
 *
 * WHAT THIS DECIDES, so nobody re-derives it:
 *   • WHICH ROADS TRIM. A centerline road whose ends are both away from the field (an end on / in the field is a drive JUNCTION — parkingApproach's corridors
 *     own that, and a driveway into the lot is its way in, never trimmed against) and whose KEEP-OUT reaches a stall. The keep-out is the road's pavement,
 *     joined with its right-of-way band when one is designated, grown by the plan's PARKING SETBACK (`parkSetbackFor`, below). A road with a setback trims
 *     any field whose stalls fall inside it, even one it only runs alongside ("parking should never really be like right against the roads"). A road with
 *     none (an internal auto drive aisle) trims only when it really CUTS the field — covers more than TRIM_CUT_FRACTION (15%, the old through-road rule)
 *     of a stall — and a skim leaves the field byte-for-byte what it was.
 *   • THE RIGHT-OF-WAY (owner, 2026-11-24: "make sure it accounts for the road's right of way, not just the road itself"). A designated ROW
 *     (`designatedRowFt(road.xsection)`, the same number the ROW lines and the road panel read — so editing it re-trims the parking) is part of the keep-out,
 *     and the setback is measured from the ROW line. An invalid ROW (`rowMarginFt` null — the canvas draws no ROW line either) is ignored.
 *   • WHICH STALLS GO. Every stall the keep-out covers more than TRIM_TOUCH_FRACTION (2%) of is dropped: whole stalls stay, partial ones go.
 *   • THE EDGE. The field's outline follows the road: the rectangle minus the keep-out, plus any kept stall.
 *   • ISLANDS. Inside that outline, the cells of dropped stalls are landscape islands (corners rounded to ISLAND_NOSE_FT, a curb nose); everything else
 *     (aisles, kept stalls) is pavement. A row the trim breaks keeps only runs of MIN_RUN_CAR (3) stalls or more — no orphan stall or two; an aisle is paved
 *     only from its way in to the last stall it serves; a scrap the road strands across itself with under SPLIT_PIECE_SHARE of the main piece is dropped.
 *   • THE CONNECTING AISLE. When the trim cuts off at least one drive aisle of a field with two or more aisles, a cross aisle (one aisle width, snapped out to
 *     whole stalls) runs straight across the field, square to the aisles, just inside where the first aisle is cut — so every aisle meets it and traffic
 *     loops instead of dead-ending at the planting strip. It spans the outermost aisles only (never a stub over the outer rows). A road through the middle
 *     makes one on each side. The stalls it crosses are dropped (paved, not islands).
 *   • EVERY STALL KEPT CAN BE DRIVEN TO (owner, 2026-11-24: "there's no way to get into two of those spots"). A stall is kept only if the aisle it faces is
 *     open (not in the keep-out) across the stall's whole width AND that stretch of aisle connects to a way in: a field end it runs out to, or the
 *     connecting aisle when that itself reaches a field end through some aisle. A stall with no aisle facing it (an outer single row served from outside the
 *     field, a single trailer row against a wall) is not judged. An unreachable stall becomes a landscape island, never pavement nobody can use.
 *   • NOTHING IS STORED. The field stays one rectangle the person moves and resizes as always; this is DERIVED from (els, settings) once per model change in
 *     roadNetBuild / siteMetrics (VIEW-INDEPENDENT-ONCE), so moving the road or the field recomputes it, undo restores it, and the drawing, the count and the
 *     paved area all read the one answer.
 *
 * Pure: field-LOCAL feet out (origin = the field's top-left corner, x along `w`, y along `h` — the frame carStalls / trailerStalls lay their bands in).
 */
import ClipperLib from "clipper-lib";
import { carStalls, trailerStalls, roadDenseCenterline } from "./siteGeometry.js";
import { roadSurfaceRing } from "./roadNetwork.js";
import { designatedRowFt, rowMarginFt } from "./roadCrossSection.js";

export const TRIM_CUT_FRACTION = 0.15;    // a road "cuts" a field once it covers more than this of some stall (the old through-road removal rule)
export const TRIM_TOUCH_FRACTION = 0.02;  // once it cuts, a stall it covers more than this of is dropped (whole stalls only)
export const MIN_AISLE_GAP_FT = 10;       // a stretch of the field's depth no stall row covers, at least this deep, is a drive aisle (as parkingApproach.aislesOf)
export const MIN_RUN_CAR = 3;             // a trim-broken car row keeps a run only of at least this many stalls
export const MIN_RUN_TRAILER = 2;         // …a trailer row, this many trailers
export const ISLAND_NOSE_FT = 3;          // corner radius of a planted island's nose
export const SPLIT_PIECE_SHARE = 0.25;    // a piece the road cuts off stays only with at least this share of the biggest piece's stalls
const END_SNAP_FT = 6;                    // a road end within this of the field is a junction, not a crossing (as throughDrivesOf)
const SC = 100;                           // Clipper integer scale: 0.01 ft

const rad = (d) => (d * Math.PI) / 180;

/* PARKING SETBACK FROM A ROAD (owner, 2026-11-24: "parking should never really be like right against the roads … you would have overhang";
 * 2026-11-25: "we don't even need multiple road types. We can just say keep parking 5 feet off of roads … a plan-wide setting. I don't want to
 * introduce too much complexity"). ONE plan-wide number, `settings.parkSetbackFt` (Standards → Roads, "Keep parking off roads"), default 5 ft,
 * the same for every road: the planted strip between a road (its ROW line when one is set, else its back of curb) and the first stall. 0 = stalls may
 * come right up to the curb. No per-road or per-class value (both were built 2026-11-24 and retired the next day at his word). */
export const PARK_SETBACK_DEFAULT_FT = 5;
export function parkSetbackFor(_road, settings) {
  const v = settings && settings.parkSetbackFt != null && settings.parkSetbackFt !== "" ? +settings.parkSetbackFt : NaN;
  return Number.isFinite(v) && v >= 0 ? v : PARK_SETBACK_DEFAULT_FT;
}

/** a rect car-parking or trailer-parking field (a free-drawn ring has no stall layout) */
export const isRectStallField = (el) => !!el && (el.type === "parking" || el.type === "trailer") && !el.points
  && typeof el.cx === "number" && typeof el.cy === "number" && el.w > 0 && el.h > 0;

/** the field's local frame (same as parkingApproach.rectFrame — duplicated here only to keep this leaf free of an import cycle) */
export function fieldFrame(el) {
  const r = rad(el.rot || 0), c = Math.cos(r), s = Math.sin(r);
  return {
    toLocal: (p) => { const dx = p.x - el.cx, dy = p.y - el.cy; return { x: c * dx + s * dy + el.w / 2, y: -s * dx + c * dy + el.h / 2 }; },
    toWorld: (l) => { const dx = l.x - el.w / 2, dy = l.y - el.h / 2; return { x: el.cx + dx * c - dy * s, y: el.cy + dx * s + dy * c }; },
  };
}

/** The ROW band of a centerline road with a designated right-of-way (world ring), or null when none is designated. Same centerline the pavement is built from. */
export function rowRingOf(road, settings, sharpAt, trim) {
  const ft = designatedRowFt(road && road.xsection);
  if (rowMarginFt(road && road.xsection) == null) return null;   // not designated, or bands reach past the ROW line (invalid — the canvas draws no ROW either)
  if (!(ft > 0) || !road || !Array.isArray(road.pts) || road.pts.length < 2) return null;
  const dense = roadDenseCenterline(road, settings, sharpAt, trim);
  return roadSurfaceRing(dense, ft) || null;
}

/** The field's stall layout as CELLS: { kind, count, pitch, aisleW, cells:[{band,k,x0,x1,y0,y1}], aisles:[{y0,y1}] } | null.
 *  The layout is the renderer's own (carStalls / trailerStalls), so a dropped cell is exactly a stall the canvas would have drawn. */
export function stallFieldLayout(el, settings) {
  if (!isRectStallField(el)) return null;
  const s = el.cfg ? { ...settings, ...el.cfg } : settings || {};
  const car = el.type === "parking";
  const L = car ? carStalls(el.w, el.h, s) : trailerStalls(el.w, el.h, s);
  const pitch = car ? L.pitch : L.tw;
  if (!(pitch > 0)) return null;
  const cells = [];
  L.bands.forEach((b, band) => {
    for (let k = 0; k < (b.n || 0); k++) cells.push({ band, k, x0: k * pitch, x1: (k + 1) * pitch, y0: b.y, y1: b.y + b.depth });
  });
  const spans = L.bands.filter((b) => b.n > 0).map((b) => [b.y, b.y + b.depth]).sort((a, b) => a[0] - b[0]);
  const aisles = [];
  let at = 0;
  for (const [y0, y1] of spans) { if (y0 - at >= MIN_AISLE_GAP_FT) aisles.push({ y0: at, y1: y0 }); at = Math.max(at, y1); }
  if (el.h - at >= MIN_AISLE_GAP_FT) aisles.push({ y0: at, y1: el.h });
  const aisleW = car ? (+s.aisle || 24) : (+s.trailerAisle || 0) || 60;
  return { kind: car ? "car" : "trailer", count: L.count, pitch, aisleW, cells, aisles };
}

/* ---------------- Clipper plumbing (local feet ↔ integer paths) ---------------- */
const toPath = (ring) => ring.map((p) => ({ X: Math.round(p.x * SC), Y: Math.round(p.y * SC) }));
const fromPath = (path) => path.map((q) => ({ x: q.X / SC, y: q.Y / SC }));
const rectRing = (x0, y0, x1, y1) => [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }];
function boolOp(type, subj, clip) {
  const c = new ClipperLib.Clipper();
  if (subj.length) c.AddPaths(subj, ClipperLib.PolyType.ptSubject, true);
  if (clip.length) c.AddPaths(clip, ClipperLib.PolyType.ptClip, true);
  const out = new ClipperLib.Paths();
  c.Execute(type, out, ClipperLib.PolyFillType.pftNonZero, ClipperLib.PolyFillType.pftNonZero);
  return out;
}
const union = (a, b = []) => boolOp(ClipperLib.ClipType.ctUnion, a, b);
const minus = (a, b) => (b.length ? boolOp(ClipperLib.ClipType.ctDifference, a, b) : a);
const meet = (a, b) => boolOp(ClipperLib.ClipType.ctIntersection, a, b);
const areaOf = (paths) => paths.reduce((s, p) => s + ClipperLib.Clipper.Area(p), 0) / (SC * SC);   // holes are negative → net area
function grow(paths, ft) {
  const co = new ClipperLib.ClipperOffset(2, 0.25 * SC);
  co.AddPaths(paths, ClipperLib.JoinType.jtRound, ClipperLib.EndType.etClosedPolygon);
  const out = new ClipperLib.Paths();
  co.Execute(out, ft * SC);
  return out;
}
const clean = (paths) => paths.filter((p) => p.length >= 3 && Math.abs(ClipperLib.Clipper.Area(p)) > 0.25 * SC * SC);

/** even-odd point-in-paths (paths in local feet) */
function insideRings(p, rings) {
  let inside = false;
  for (const r of rings) {
    for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
      const a = r[i], b = r[j];
      if ((a.y > p.y) !== (b.y > p.y) && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
    }
  }
  return inside;
}
/** the pieces of segment a→b inside `rings` (even-odd), each [{x,y},{x,y}] */
export function clipSegmentToRings(a, b, rings) {
  const ts = [0, 1];
  const dx = b.x - a.x, dy = b.y - a.y;
  for (const r of rings) {
    for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
      const p = r[j], q = r[i], ex = q.x - p.x, ey = q.y - p.y;
      const den = dx * ey - dy * ex;
      if (Math.abs(den) < 1e-12) continue;
      const t = ((p.x - a.x) * ey - (p.y - a.y) * ex) / den, u = ((p.x - a.x) * dy - (p.y - a.y) * dx) / den;
      if (t > 0 && t < 1 && u >= 0 && u <= 1) ts.push(t);
    }
  }
  ts.sort((x, y) => x - y);
  const at = (t) => ({ x: a.x + dx * t, y: a.y + dy * t });
  const out = [];
  for (let i = 0; i + 1 < ts.length; i++) {
    if (ts[i + 1] - ts[i] < 1e-6) continue;
    if (insideRings(at((ts[i] + ts[i + 1]) / 2), rings)) {
      const last = out[out.length - 1];
      if (last && Math.abs(last.t1 - ts[i]) < 1e-9) last.t1 = ts[i + 1]; else out.push({ t0: ts[i], t1: ts[i + 1] });
    }
  }
  return out.filter((s) => (s.t1 - s.t0) * Math.hypot(dx, dy) > 0.5).map((s) => [at(s.t0), at(s.t1)]);
}

/** The pieces of a (local-feet) ring that survive the trim's road buffer — for the curb bands drawn outside the field's faces. */
export function ringMinusTrim(ring, trim) {
  if (!trim || !trim.bufferPaths || !trim.bufferPaths.length) return [ring];
  return clean(minus([toPath(ring)], trim.bufferPaths)).map(fromPath);
}

/* Where the drive aisles dead-end against the keep-out, and the connecting aisles that rejoin them → [{ x0, x1 }] (local, along w).
 * Each blocked stretch of an aisle leaves a dead end on each side of it that does not run out of the field: the runs to its LEFT dead-end at its start, the runs
 * to its RIGHT at its finish. One connecting aisle serves every left-facing dead end (just before the EARLIEST of them, so every aisle reaches it), one every
 * right-facing dead end (just after the LATEST). A road cutting one end of the field makes one; a road crossing the middle makes one on each side of it. */
function connectingAislesOf(lay, w, openRings) {
  if (!lay.aisles || lay.aisles.length < 2) return [];
  const step = Math.max(0.5, Math.min(2, w / 400));
  const deadL = [], deadR = [];                                    // x where a run heading +x stops / a run heading −x stops
  for (const a of lay.aisles) {
    const yc = (a.y0 + a.y1) / 2;
    let blk = null;
    const close = (xEnd) => {
      if (blk.x0 > step) deadL.push(blk.x0);                       // something open before this block runs into it
      if (xEnd < w - step) deadR.push(xEnd);                       // …and something open after it
      blk = null;
    };
    for (let x = step / 2; x < w; x += step) {
      const open = insideRings({ x, y: yc }, openRings);
      if (!open && !blk) blk = { x0: x - step / 2 };
      if (open && blk) close(x - step / 2);
    }
    if (blk) close(w);
  }
  const span = Math.ceil(lay.aisleW / lay.pitch - 1e-6) * lay.pitch;
  const out = [];
  if (deadL.length) {
    const edge = Math.min(...deadL);
    const x0 = Math.floor((edge - lay.aisleW) / lay.pitch + 1e-6) * lay.pitch;
    if (x0 >= -1e-6 && x0 + span <= w + 1e-6) out.push({ x0, x1: x0 + span });
  }
  if (deadR.length) {
    const edge = Math.max(...deadR);
    const x1 = Math.ceil((edge + lay.aisleW) / lay.pitch - 1e-6) * lay.pitch;
    if (x1 - span >= -1e-6 && x1 <= w + 1e-6 && !out.some((c) => c.x0 < x1 && c.x1 > x1 - span)) out.push({ x0: x1 - span, x1 });
  }
  return out;
}

/* The outer rings of `paths` (with any holes inside them) that contain at least one kept stall's centre. Clipper returns outers and holes flat; a hole is
 * assigned to the outer that contains its first point. */
function keepPiecesWith(paths, kept, atLeast = 1, shareOfLargest = 0) {
  const rings = paths.map((p) => ({ p, r: fromPath(p), outer: ClipperLib.Clipper.Orientation(p) }));
  const outers = rings.filter((x) => x.outer), holes = rings.filter((x) => !x.outer);
  const counted = outers.map((o) => ({ o, n: kept.filter((c) => insideRings({ x: (c.x0 + c.x1) / 2, y: (c.y0 + c.y1) / 2 }, [o.r])).length }));
  const most = Math.max(0, ...counted.map((x) => x.n));
  const out = [];
  for (const { o, n } of counted) {
    if (n < atLeast || n < shareOfLargest * most) continue;
    out.push(o.p);
    for (const hl of holes) if (insideRings(hl.r[0], [o.r])) out.push(hl.p);
  }
  return out;
}

/* The open runs [xa, xb] of each aisle's centreline through `openRings`, and which of them connect to a way in (a field end, or the connecting aisle once
 * that reaches a field end through some aisle). → [{ aisle, runs:[{xa, xb, ok}] }] */
function aisleRunsOf(lay, w, openRings, crosses) {
  const step = Math.max(0.5, Math.min(2, w / 400));
  const out = lay.aisles.map((a) => {
    const yc = (a.y0 + a.y1) / 2, runs = [];
    let start = null;
    for (let x = 0; x <= w + 1e-9; x += step) {
      const xx = Math.min(Math.max(x, 0.01), w - 0.01);
      const open = insideRings({ x: xx, y: yc }, openRings);
      if (open && start == null) start = x;
      if (!open && start != null) { runs.push({ xa: start, xb: x - step }); start = null; }
    }
    if (start != null) runs.push({ xa: start, xb: w });
    return { aisle: a, runs };
  });
  const atEnd = (r) => r.xa <= step + 1e-6 || r.xb >= w - step - 1e-6;
  const meets = (r, c) => r.xa <= c.x1 + 1e-6 && r.xb >= c.x0 - 1e-6;
  const live = crosses.filter((c) => out.some((o) => o.runs.some((r) => atEnd(r) && meets(r, c))));
  for (const o of out) for (const r of o.runs) r.ok = atEnd(r) || live.some((c) => meets(r, c));
  return { list: out, step };
}

/**
 * ⛔ THE ONE ANSWER to "how does this field trim to the roads that cut it?" — read by roadNetBuild (the drawing) and siteMetrics (the count and paved area).
 *   `roads` — visible centerline roads; `stripOf(road)` — the road's pavement ring (world feet), the same strip the renderer paints;
 *   `rowOf(road)` — its designated-ROW band (world ring) or null (`rowRingOf`).
 * Returns null when no road cuts the field (the field is untouched), else
 *   { roadIds, removed:[{band,k}], crosses:[{x0,x1}], lot:[ring], paved:[ring], islands:[ring], lines:[[a,b]], bufferPaths, pavedArea, lotArea } — rings in LOCAL feet.
 */
export function roadTrimOf(el, settings, roads, stripOf, rowOf) {
  const lay = stallFieldLayout(el, settings);
  if (!lay || !lay.cells.length) return null;
  const f = fieldFrame(el), w = el.w, h = el.h;
  const near = (l) => l.x > -END_SNAP_FT && l.x < w + END_SNAP_FT && l.y > -END_SNAP_FT && l.y < h + END_SNAP_FT;
  const cellPath = (c) => toPath(rectRing(c.x0, c.y0, c.x1, c.y1));
  const cellArea = (c) => (c.x1 - c.x0) * (c.y1 - c.y0) || 1;

  const keepOuts = [];
  const touched = new Set();
  for (const r of roads || []) {
    if (!r || r.type !== "road" || !Array.isArray(r.pts) || r.pts.length < 2 || r.attachedTo) continue;
    if (near(f.toLocal(r.pts[0])) || near(f.toLocal(r.pts[r.pts.length - 1]))) continue;   // a drive junction, not a crossing
    const strip = stripOf ? stripOf(r) : null;
    if (!strip || strip.length < 3) continue;
    const row = rowOf ? rowOf(r) : null;
    const rings = [strip, ...(row && row.length >= 3 ? [row] : [])].map((ring) => ring.map((p) => f.toLocal(p)));
    const xs = rings.flat().map((p) => p.x), ys = rings.flat().map((p) => p.y);
    const bx0 = Math.min(...xs), bx1 = Math.max(...xs), by0 = Math.min(...ys), by1 = Math.max(...ys);
    const pad = parkSetbackFor(r, settings);
    if (bx1 + pad <= 0 || bx0 - pad >= w || by1 + pad <= 0 || by0 - pad >= h) continue;
    const back = parkSetbackFor(r, settings);
    const kp0 = union(rings.map(toPath));
    const kp = back > 0 ? grow(kp0, back) : kp0;                   // the keep-out: pavement (+ ROW) + the road's parking setback
    let cuts = false;
    const hits = [];
    for (const c of lay.cells) {
      if (c.x1 <= bx0 - back || c.x0 >= bx1 + back || c.y1 <= by0 - back || c.y0 >= by1 + back) continue;
      const fr = areaOf(meet([cellPath(c)], kp)) / cellArea(c);
      /* With a setback, a stall inside it is a stall against the road — the road trims the field even if it only runs alongside. With none (an internal
       * drive aisle), only a road that really CUTS the field (covers > TRIM_CUT_FRACTION of a stall) trims; a skim leaves it exactly as it was. */
      if (fr > (back > 0 ? TRIM_TOUCH_FRACTION : TRIM_CUT_FRACTION)) cuts = true;
      if (fr > TRIM_TOUCH_FRACTION) hits.push(`${c.band}:${c.k}`);
    }
    if (!cuts) continue;
    keepOuts.push({ roadId: r.id, paths: kp });
    hits.forEach((k) => touched.add(k));
  }
  if (!keepOuts.length) return null;

  const rectP = [toPath(rectRing(0, 0, w, h))];
  const bufferPaths = union(keepOuts.flatMap((k) => k.paths));
  /* A piece of the field the road cuts off is part of the lot only if it is a real parking area of its own: at least a short row of whole stalls AND at
   * least SPLIT_PIECE_SHARE of the biggest piece's. A pocket of a few stalls stranded across the road (reached only past the field's end) is dropped — a civil
   * plan would not stripe it, and it would otherwise earn a connecting aisle of its own. A road straight through the middle leaves two real halves: both stay. */
  const minRunAll = lay.kind === "car" ? MIN_RUN_CAR : MIN_RUN_TRAILER;
  const untouched = lay.cells.filter((c) => !touched.has(`${c.band}:${c.k}`));
  const openP = keepPiecesWith(clean(minus(rectP, bufferPaths)), untouched, minRunAll, SPLIT_PIECE_SHARE);
  const openRings = openP.map(fromPath);

  const crosses = connectingAislesOf(lay, w, openRings);
  /* A connecting aisle runs between the OUTERMOST aisles only — it links aisles; carried on over the outer rows to the field's edge it would be a stub serving
   * nothing, and those outer rows keep their stalls (they face an aisle that is still open there). */
  const ay0 = Math.min(...lay.aisles.map((a) => a.y0)), ay1 = Math.max(...lay.aisles.map((a) => a.y1));
  for (const x of crosses) { x.y0 = ay0; x.y1 = ay1; }
  const inCross = (c) => crosses.some((x) => c.x1 > x.x0 + 1e-6 && c.x0 < x.x1 - 1e-6 && c.y1 > x.y0 + 1e-6 && c.y0 < x.y1 - 1e-6);
  const { list: aisleRuns, step: aisleStep } = aisleRunsOf(lay, w, openRings, crosses);
  const reachable = (c) => {
    const facing = aisleRuns.filter((o) => Math.abs(o.aisle.y0 - c.y1) < 0.01 || Math.abs(o.aisle.y1 - c.y0) < 0.01);
    if (!facing.length) return true;                              // served from outside the field — not judged here
    return facing.some((o) => o.runs.some((r) => r.ok && r.xa <= c.x0 + 0.01 && r.xb >= c.x1 - 0.01));
  };
  const state = new Map();                                        // "band:k" → "keep" | "island" | "cross"
  for (const c of lay.cells) {
    const key = `${c.band}:${c.k}`;
    const onLot = insideRings({ x: (c.x0 + c.x1) / 2, y: (c.y0 + c.y1) / 2 }, openRings);   // not on a dropped scrap across the road
    state.set(key, touched.has(key) || !onLot ? "island" : inCross(c) ? "cross" : !reachable(c) ? "island" : "keep");
  }
  /* A row the trim breaks up keeps only runs worth parking in: a run of fewer than MIN_RUN stalls left between the road, a connecting aisle or an island is
   * planted (a civil plan ends a row on a landscape island, it does not leave one or two orphan stalls). A band no road touched is never judged. */
  const minRun = lay.kind === "car" ? MIN_RUN_CAR : MIN_RUN_TRAILER;
  const byBand = new Map();
  for (const c of lay.cells) { if (!byBand.has(c.band)) byBand.set(c.band, []); byBand.get(c.band).push(c); }
  for (const cells of byBand.values()) {
    cells.sort((p, q) => p.k - q.k);
    if (cells.every((c) => state.get(`${c.band}:${c.k}`) === "keep")) continue;
    let run = [];
    const flush = () => { if (run.length && run.length < minRun) run.forEach((c) => state.set(`${c.band}:${c.k}`, "island")); run = []; };
    for (const c of cells) { if (state.get(`${c.band}:${c.k}`) === "keep") run.push(c); else flush(); }
    flush();
  }
  const removed = [], islandCells = [], keptCells = [], kept = [];
  for (const c of lay.cells) {
    const st = state.get(`${c.band}:${c.k}`);
    if (st === "keep") { keptCells.push(cellPath(c)); kept.push(c); continue; }
    removed.push({ band: c.band, k: c.k });
    if (st === "island") islandCells.push(cellPath(c));
  }
  /* An aisle is paved only as far as it does something: from its way in (a field end, the connecting aisle) to the farthest stall it serves. A stretch past that
   * — a stub dead-ending at the planting strip — is planted. */
  for (const o of aisleRuns) {
    const serves = kept.filter((c) => Math.abs(o.aisle.y0 - c.y1) < 0.01 || Math.abs(o.aisle.y1 - c.y0) < 0.01);
    for (const r of o.runs) {
      if (!r.ok) { islandCells.push(toPath(rectRing(r.xa, o.aisle.y0, r.xb, o.aisle.y1))); continue; }
      const left = r.xa <= aisleStep + 1e-6, right = r.xb >= w - aisleStep - 1e-6;
      if (left && right) continue;
      const mine = serves.filter((c) => c.x0 >= r.xa - 0.01 && c.x1 <= r.xb + 0.01);
      const xsNeed = [...mine.flatMap((c) => [c.x0, c.x1]), ...crosses.filter((x) => r.xa <= x.x1 + 1e-6 && r.xb >= x.x0 - 1e-6).flatMap((x) => [x.x0, x.x1])];
      const lo = left ? r.xa : Math.min(...xsNeed, r.xb), hi = right ? r.xb : Math.max(...xsNeed, r.xa);
      if (lo > r.xa + 0.01) islandCells.push(toPath(rectRing(r.xa, o.aisle.y0, lo, o.aisle.y1)));
      if (hi < r.xb - 0.01) islandCells.push(toPath(rectRing(hi, o.aisle.y0, r.xb, o.aisle.y1)));
    }
  }
  const crossP = crosses.map((x) => toPath(rectRing(x.x0, x.y0, x.x1, x.y1)));
  /* The lot is the part of the field on THIS side of the road: a piece the road cuts off with no stall left on it is not part of the lot at all. */
  const lotAll = clean(union(openP, keptCells));
  const lotP = keepPiecesWith(lotAll, kept);
  /* Planted area = the island cells and dead aisle, never a connecting aisle; its corners are rounded (an island nose is a curb radius, not a square corner).
   * The world outside the lot joins it before the rounding so an island's edge ON the lot edge stays straight. */
  const outsideP = minus([toPath(rectRing(-1e4, -1e4, w + 1e4, h + 1e4))], lotP);
  const plantedRaw = union(minus(union(islandCells), crossP), outsideP);
  const planted = minus(grow(grow(plantedRaw, -ISLAND_NOSE_FT), ISLAND_NOSE_FT), crossP);
  const pavedP = clean(minus(lotP, planted));
  const islandsP = clean(meet(lotP, planted));
  const paved = pavedP.map(fromPath);
  const lines = [];
  for (const a of lay.aisles) { const yc = (a.y0 + a.y1) / 2; lines.push(...clipSegmentToRings({ x: 0, y: yc }, { x: w, y: yc }, paved)); }
  for (const x of crosses) { const xc = (x.x0 + x.x1) / 2; lines.push(...clipSegmentToRings({ x: xc, y: x.y0 }, { x: xc, y: x.y1 }, paved)); }
  return {
    roadIds: keepOuts.map((k) => k.roadId), removed, crosses: crosses.map(({ x0, x1, y0, y1 }) => ({ x0, x1, y0, y1 })),
    lot: lotP.map(fromPath), paved, islands: islandsP.map(fromPath), lines,
    bufferPaths, pavedArea: areaOf(pavedP), lotArea: areaOf(lotP),
  };
}

/** a trim's ring list as one SVG path `d`, mapping local feet → px with `toPx` */
export const ringsPathD = (rings, toPx) => (rings || []).map((r) => r.map((p, i) => { const q = toPx(p); return `${i ? "L" : "M"}${q.x.toFixed(2)},${q.y.toFixed(2)}`; }).join("") + "Z").join("");
