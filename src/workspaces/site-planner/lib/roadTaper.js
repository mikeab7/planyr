/* lib/roadTaper.js — TAPER WHERE TWO ROADS OF DIFFERENT WIDTHS MEET END TO END (NEW-1, owner choice 2026-11-10).
 *
 * THE DEFECT. A road ending where a narrower (or wider) road begins used to be two constant-width strips that simply
 * overlapped: the joint showed a stepped edge and, at a bend, a wedge where the two edges did not line up.
 *
 * THE RULE (owner: "taper end-to-end — the wider road narrows smoothly into the narrower one over a set length, so the
 * pavement is one continuous piece with no notch"). Where exactly two roads' endpoints coincide and their widths differ, the
 * WIDER road's last stretch narrows, symmetrically about its centerline, down to the narrower road's width, so both edges
 * meet the narrow road's edges at the joint. Same width = nothing changes. A tee, a three-arm node, a loop close and a
 * roundabout are not tapers.
 *
 * DERIVED, NEVER STORED. Whether a road tapers, to what width and at which end is a pure function of the roads (`roadTapersOf`,
 * below) — move, resize or disconnect either road and the taper follows or disappears with no migration. The ONLY stored
 * fact is the owner's own override of the LENGTH, `road.taper = { s?: ft, e?: ft }` on the wider road (absent = the default
 * below), which is additive and read nowhere else.
 *
 * HOW IT REACHES THE DRAWING. The plan's one per-road geometry side-channel is the `trim` object `roundaboutsForSite` hands to
 * every consumer of a road's strip (`roadStripRing`, `roadCurbLines`, the paved-area number, the dissolved network). The
 * taper rides on it as `trim.taper` — so the screen, the paved-area figure, the PDF and the print all read ONE answer.
 *
 * Pure: world feet in, world feet out. Unit-tested in test/roadTaper.test.js. */
import ClipperLib from "clipper-lib";
import { offsetPolylineMiterLimit } from "./metesAndBounds.js";
import { roadSurfaceRing } from "./roadNetwork.js";
import { designatedRowFt } from "./roadCrossSection.js";
import { convexHull } from "./roadGeometry.js";
import { boundedCache, pointsSignature } from "./pureCache.js";

/* Default taper: 10 ft of length per foot each edge steps in (the standard low-speed lane-width transition, L = W·S²/60 at
 * ~25 mph ≈ 10·W), never shorter than TAPER_MIN_FT so a 2-ft step still reads as a taper and not a notch. */
export const TAPER_RATIO = 10;
export const TAPER_MIN_FT = 20;
export const TAPER_MAX_FT = 1000;      // the most an owner-typed length is honoured at (an absurd value is clamped, not drawn)
const WIDTH_EPS_FT = 0.05;             // a width difference under this is "the same width"
const STRAIGHT_COS = Math.cos((1.5 * Math.PI) / 180);   // consecutive dense segments within 1.5° of each other are one straight run
const OVERLAP_FT = 0.3;                // the taper polygon reaches this far back into the body so the union has no hairline seam
const MITER_LIMIT = 2;                 // matches ROAD_JOIN_MITER_LIMIT: a wedge's outside corner is mitered up to here, bevelled beyond
const SCALE = 100;

const isRoad = (x) => !!x && x.type === "road" && Array.isArray(x.pts) && x.pts.length >= 2 && !x.attachedTo;
const curbOf = (r) => (Number.isFinite(r && r.curb) ? r.curb : 0.5);
const travelHalfOf = (r) => Math.max(0, (+r.travelW || 0) / 2);
const outerHalfOf = (r) => travelHalfOf(r) + curbOf(r);
const rowHalfOf = (r) => { const f = designatedRowFt(r.xsection); return f != null && f > 0 ? f / 2 : null; };
const unit = (a, b) => { const dx = b.x - a.x, dy = b.y - a.y, L = Math.hypot(dx, dy); return L > 1e-9 ? { x: dx / L, y: dy / L } : null; };
const lenOf = (pts) => { let L = 0; for (let i = 1; i < pts.length; i++) L += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y); return L; };

/* ---- 1. WHICH ENDS TAPER (pure over the roads) ---------------------------------------------------------------------- */
const EMPTY = Object.freeze({ byRoad: new Map(), joints: [] });
const memo = new WeakMap();

/* `{ byRoad: Map<roadId, { s?: Plan, e?: Plan }>, joints: [...] }`.
 *   Plan  = { lenFt, reqFt, auto, deltaFt, otherId, otherEnd, outerHalf, travelHalf, rowHalf|null }
 *           — `lenFt` is the requested length clamped to the wider road's last drawn segment; the geometry clamps again to the
 *           straight stretch it can really use. `outerHalf` / `travelHalf` / `rowHalf` are the NARROW road's half widths the
 *           wide road's back-of-curb, face-of-curb and ROW lines narrow TO.
 *   joint = { key, wideId, narrowId, wideEnd, narrowEnd, P, dirWide, dirNarrow, halfW }   (dirs are neighbour → joint) */
export function roadTapersOf(els, coincideFt = 0.75) {
  if (!Array.isArray(els)) return EMPTY;
  const hit = memo.get(els);
  if (hit && hit.tol === coincideFt) return hit.v;
  const v = compute(els, coincideFt);
  memo.set(els, { tol: coincideFt, v });
  return v;
}

function compute(els, tol) {
  const roads = els.filter(isRoad);
  if (roads.length < 2) return EMPTY;
  const ends = [];
  for (const r of roads) {
    ends.push({ r, key: "s", i: 0, nb: 1 });
    ends.push({ r, key: "e", i: r.pts.length - 1, nb: r.pts.length - 2 });
  }
  const near = (a, b) => Math.hypot(a.r.pts[a.i].x - b.r.pts[b.i].x, a.r.pts[a.i].y - b.r.pts[b.i].y) <= tol;
  const byRoad = new Map(), joints = [];
  for (const a of ends) {
    const others = ends.filter((b) => b !== a && near(a, b));
    if (others.length !== 1) continue;                       // a lone end, a three-arm node, or a loop close: not a taper
    const b = others[0];
    if (b.r.id === a.r.id) continue;
    if (a.r.id > b.r.id || (a.r.id === b.r.id && a.key > b.key)) continue;   // each pair once
    if (ends.filter((c) => c !== b && near(b, c)).length !== 1) continue;
    if (a.r.roundabout || b.r.roundabout) continue;          // a roundabout owns that end
    const oa = outerHalfOf(a.r), ob = outerHalfOf(b.r), ta = travelHalfOf(a.r), tb = travelHalfOf(b.r);
    const dOut = oa - ob, dTr = ta - tb;
    if (Math.abs(dOut) <= WIDTH_EPS_FT && Math.abs(dTr) <= WIDTH_EPS_FT) continue;   // equal widths: nothing to do
    const wideIsA = Math.abs(dOut) > WIDTH_EPS_FT ? dOut > 0 : dTr > 0;
    const W = wideIsA ? a : b, N = wideIsA ? b : a;
    const delta = Math.max(Math.abs(dOut), Math.abs(dTr));
    const custom = W.r.taper && Number.isFinite(+W.r.taper[W.key]) && +W.r.taper[W.key] > 0 ? Math.min(+W.r.taper[W.key], TAPER_MAX_FT) : null;
    const reqFt = custom != null ? custom : Math.max(TAPER_MIN_FT, TAPER_RATIO * delta);
    const P = W.r.pts[W.i], nbW = W.r.pts[W.nb];
    const segLen = Math.hypot(P.x - nbW.x, P.y - nbW.y);
    if (!(segLen >= 1)) continue;                            // no stretch to taper along
    const plan = {
      lenFt: Math.min(reqFt, segLen), reqFt, auto: custom == null, deltaFt: delta,
      otherId: N.r.id, otherEnd: N.key,
      outerHalf: outerHalfOf(N.r), travelHalf: travelHalfOf(N.r), rowHalf: rowHalfOf(N.r),
    };
    const cur = byRoad.get(W.r.id) || {};
    cur[W.key] = plan;
    byRoad.set(W.r.id, cur);
    const dirWide = unit(nbW, P), PN = N.r.pts[N.i], dirNarrow = unit(N.r.pts[N.nb], PN);
    if (!dirWide || !dirNarrow) continue;
    joints.push({
      key: [`${a.r.id}:${a.i}`, `${b.r.id}:${b.i}`].sort().join("|"),
      wideId: W.r.id, narrowId: N.r.id, wideEnd: W.key, narrowEnd: N.key,
      P: { x: P.x, y: P.y }, dirWide, dirNarrow, halfW: plan.outerHalf,
    });
  }
  return byRoad.size ? { byRoad, joints } : EMPTY;
}

/* ---- 2. THE WEDGE AT AN ANGLED JOINT -------------------------------------------------------------------------------- */
/* The pavement that closes the OUTSIDE corner where the tapered end (now exactly `h` per side at the joint) meets the narrow
 * road at an angle, mitred up to the repo's stated miter limit and bevelled beyond it. Built as the convex hull of both arms'
 * cross-sections AT the joint, a foot of each arm's body, and the miter tip — the inside corner is already covered by the
 * two strips overlapping, and every hull point on that side lies inside one of them, so nothing overshoots there. */
export function taperJointCover(P, dirA, dirB, h) {
  if (!P || !dirA || !dirB || !(h > 0)) return null;
  const cloud = [];
  const back = 1;
  for (const d of [dirA, dirB]) {
    const n = { x: -d.y, y: d.x };
    cloud.push({ x: P.x - d.x * back + n.x * h, y: P.y - d.y * back + n.y * h });
    cloud.push({ x: P.x - d.x * back - n.x * h, y: P.y - d.y * back - n.y * h });
    cloud.push({ x: P.x + n.x * h, y: P.y + n.y * h });
    cloud.push({ x: P.x - n.x * h, y: P.y - n.y * h });
  }
  const tA = dirA, tB = { x: -dirB.x, y: -dirB.y };          // travel directions through the joint
  const cross = tA.x * tB.y - tA.y * tB.x;
  if (Math.abs(cross) > 1e-3) {
    const s = cross > 0 ? -1 : 1;                           // turning left → the outside is the right-hand side
    const nA = { x: -tA.y, y: tA.x }, nB = { x: -tB.y, y: tB.x };
    const k = 1 + (nA.x * nB.x + nA.y * nB.y);
    if (k > 1e-6) {
      const tip = { x: P.x + (s * h * (nA.x + nB.x)) / k, y: P.y + (s * h * (nA.y + nB.y)) / k };
      if (Math.hypot(tip.x - P.x, tip.y - P.y) <= h * MITER_LIMIT + 1e-6) cloud.push(tip);
    }
  }
  return convexHull(cloud);
}

/* ---- 3. THE GEOMETRY ON A ROAD'S DENSE CENTERLINE -------------------------------------------------------------------- */
const straightRun = (dense, fromEnd) => {
  const n = dense.length;
  let run = 0, prev = null;
  for (let k = 0; k < n - 1; k++) {
    const i = fromEnd ? n - 1 - k : k, j = fromEnd ? i - 1 : i + 1;
    const d = unit(dense[i], dense[j]);
    if (!d) continue;
    if (prev && d.x * prev.x + d.y * prev.y < STRAIGHT_COS) break;
    run += Math.hypot(dense[j].x - dense[i].x, dense[j].y - dense[i].y);
    prev = d;
  }
  return run;
};

function pointAtArc(dense, s) {
  let acc = 0;
  for (let i = 1; i < dense.length; i++) {
    const L = Math.hypot(dense[i].x - dense[i - 1].x, dense[i].y - dense[i - 1].y);
    if (acc + L >= s - 1e-9 || i === dense.length - 1) {
      const t = L > 0 ? Math.max(0, Math.min(1, (s - acc) / L)) : 0;
      return { x: dense[i - 1].x + (dense[i].x - dense[i - 1].x) * t, y: dense[i - 1].y + (dense[i].y - dense[i - 1].y) * t };
    }
    acc += L;
  }
  return dense[dense.length - 1];
}

function sliceArc(dense, s0, s1) {
  const out = [pointAtArc(dense, s0)];
  let acc = 0;
  for (let i = 1; i < dense.length; i++) {
    acc += Math.hypot(dense[i].x - dense[i - 1].x, dense[i].y - dense[i - 1].y);
    if (acc > s0 + 1e-6 && acc < s1 - 1e-6) out.push(dense[i]);
  }
  out.push(pointAtArc(dense, s1));
  return out.filter((p, i) => i === 0 || Math.hypot(p.x - out[i - 1].x, p.y - out[i - 1].y) > 1e-6);
}

/* What the dense centerline can actually taper: each requested length clamped to the straight stretch that reaches the end
 * (a taper never runs round a fillet), and the two ends together to the road's length. `field` picks which narrow width the
 * edge in question narrows to; an end whose narrow road has none of it (a ROW line against a road with no designated ROW)
 * is left out, so that edge simply stays as it was. */
export function resolveTaper(dense, plan, field) {
  if (!plan || !Array.isArray(dense) || dense.length < 2) return null;
  const total = lenOf(dense);
  if (!(total > 1)) return null;
  const pick = (p) => (p && Number.isFinite(p[field]) && p[field] >= 0 ? p : null);
  const S = pick(plan.s), E = pick(plan.e);
  let Ls = S ? Math.min(S.lenFt, straightRun(dense, false)) : 0;
  let Le = E ? Math.min(E.lenFt, straightRun(dense, true)) : 0;
  if (Ls + Le > total * 0.999) { const f = (total * 0.999) / (Ls + Le); Ls *= f; Le *= f; }
  if (Ls < 0.5) Ls = 0;
  if (Le < 0.5) Le = 0;
  if (!Ls && !Le) return null;
  const sS = Ls, sE = total - Le;
  const body = sE - sS > 0.25 ? sliceArc(dense, sS, sE) : null;
  const dirS = Ls ? unit(dense[0], pointAtArc(dense, Ls)) : null;
  const dirE = Le ? unit(pointAtArc(dense, sE), dense[dense.length - 1]) : null;
  return { total, Ls, Le, sS, sE, body, dirS, dirE, hnS: S ? S[field] : null, hnE: E ? E[field] : null, P0: dense[0], P1: dense[dense.length - 1], cutS: Ls ? pointAtArc(dense, sS) : null, cutE: Le ? pointAtArc(dense, sE) : null };
}

const toPath = (ring) => ring.map((p) => ({ X: Math.round(p.x * SCALE), Y: Math.round(p.y * SCALE) }));
const fromPath = (path) => path.map((c) => ({ x: c.X / SCALE, y: c.Y / SCALE }));

const planSig = (p) => ["s", "e"].map((k) => (p && p[k] ? `${p[k].lenFt.toFixed(3)}/${p[k].outerHalf.toFixed(3)}/${p[k].travelHalf.toFixed(3)}` : "-")).join("|");
const ringCache = boundedCache(200);

/* The tapered pavement ring (back of curb): the constant-width body, plus a polygon at each tapering end that narrows
 * from the full width to the narrow road's, unioned into one outline. null when nothing tapers (the caller keeps its
 * ordinary ring). `halfWide` = this road's own back-of-curb half width. */
export function taperedStripRing(dense, width, plan) {
  const t = resolveTaper(dense, plan, "outerHalf");
  if (!t) return null;
  const key = `${width}#${pointsSignature(dense)}#${planSig(plan)}`;
  const hit = ringCache.get(key);
  if (hit !== undefined) return hit;
  return ringCache.set(key, buildRing(t, width / 2));
}
function buildRing(t, hw) {
  try {
    const paths = [];
    if (t.body) { const r = roadSurfaceRing(t.body, hw * 2); if (r) paths.push(toPath(r)); }
    const quad = (P0, cut, d, hn) => {
      const n = { x: -d.y, y: d.x };
      const back = { x: cut.x + d.x * OVERLAP_FT, y: cut.y + d.y * OVERLAP_FT };   // INTO the body, which lies beyond the cut
      return [
        { x: P0.x + n.x * hn, y: P0.y + n.y * hn }, { x: cut.x + n.x * hw, y: cut.y + n.y * hw },
        { x: back.x + n.x * hw, y: back.y + n.y * hw }, { x: back.x - n.x * hw, y: back.y - n.y * hw },
        { x: cut.x - n.x * hw, y: cut.y - n.y * hw }, { x: P0.x - n.x * hn, y: P0.y - n.y * hn },
      ];
    };
    if (t.Ls && t.dirS) paths.push(toPath(quad(t.P0, t.cutS, t.dirS, t.hnS)));
    if (t.Le && t.dirE) {
      // the end polygon is built the same way mirrored: from the far end's centre back toward its cut
      const d = { x: -t.dirE.x, y: -t.dirE.y };
      paths.push(toPath(quad(t.P1, t.cutE, d, t.hnE)));
    }
    if (!paths.length) return null;
    // every path the same way round, or NonZero fill cancels the overlap of two opposite-wound polygons instead of uniting them
    const wound = paths.map((p) => (ClipperLib.Clipper.Orientation(p) ? p : p.slice().reverse()));
    const clip = new ClipperLib.Clipper();
    clip.AddPaths(wound, ClipperLib.PolyType.ptSubject, true);
    const sol = new ClipperLib.Paths();
    clip.Execute(ClipperLib.ClipType.ctUnion, sol, ClipperLib.PolyFillType.pftNonZero, ClipperLib.PolyFillType.pftNonZero);
    let best = null, bestA = -1;
    for (const p of sol) { if (!p || p.length < 3) continue; const a = Math.abs(ClipperLib.Clipper.Area(p)); if (a > bestA) { bestA = a; best = p; } }
    if (!best) return null;
    const r = fromPath(ClipperLib.Clipper.Area(best) < 0 ? best.slice().reverse() : best);
    return r.length >= 3 ? r : null;
  } catch {
    return null;
  }
}

/* One edge of a tapered road: the centerline offset by `sign · hw` along the body and narrowing to `sign · (narrow half)` at
 * each tapering end — the face-of-curb lines (`field` "travelHalf") and the ROW lines ("rowHalf"). Read left to right in the
 * same order as `offsetPolylineMiterLimit` (start → end). null when this edge does not taper (or cannot be built). */
export function taperedOffset(dense, plan, hw, sign, field) {
  const t = resolveTaper(dense, plan, field);
  if (!t) return null;
  const at = (p, d, h) => ({ x: p.x - d.y * sign * h, y: p.y + d.x * sign * h });
  const line = [];
  if (t.Ls && t.dirS) line.push(at(t.P0, t.dirS, t.hnS));
  if (t.body) {
    const off = offsetPolylineMiterLimit(t.body, sign * hw);
    if (!off) return null;
    line.push(...off);
  } else {
    if (t.Ls && t.dirS) line.push(at(t.cutS, t.dirS, hw));
    if (t.Le && t.dirE && (!t.Ls || Math.hypot(t.cutE.x - t.cutS.x, t.cutE.y - t.cutS.y) > 0.01)) line.push(at(t.cutE, t.dirE, hw));
  }
  if (t.Le && t.dirE) line.push(at(t.P1, t.dirE, t.hnE));
  return line.length >= 2 ? line : null;
}

/* The same for an edge at an ARBITRARY offset (a designed cross-section's band edges and lane seams): at a tapering end the offset
 * shrinks in the same proportion the road's face-of-curb does (narrow half ÷ this road's own half), so the whole section narrows
 * with the pavement instead of leaving a sidewalk band hanging at the wide road's offset. */
export function taperedOffsetScaled(dense, plan, off, wideTravelHalf) {
  if (!plan || !(wideTravelHalf > 0) || !Number.isFinite(off) || !off) return null;
  const scale = (p) => (p ? { ...p, scaled: (Math.abs(off) * p.travelHalf) / wideTravelHalf } : p);
  return taperedOffset(dense, { s: scale(plan.s), e: scale(plan.e) }, Math.abs(off), Math.sign(off), "scaled");
}
