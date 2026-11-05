/* lib/driveTarget.js — the LEAF half of road → parking/paving drive junctions: "can a road connect to this?" and "is this road END touching that target?".
 *
 * Split out of roadJunctions.js (B2498961) so `siteModel.js`'s bonded-child heal can ask the SAME two questions (to let a drive follow a field the heal re-seated —
 * lib/driveFollow.js) without importing the whole junction/fillet engine (and siteGeometry behind it) into the boot graph. roadJunctions.js re-exports both names, so
 * every existing importer is untouched; there is still exactly ONE target predicate and ONE touch test. Pure, depends only on roadGeometry.js. */
import { rectEdges, nearestRectEdge, polygonEdges, polygonContainsPoint } from "./roadGeometry.js";

// Same coincidence tolerance `driveJunctionsOf` has always used for "is this endpoint on that edge."
export const DRIVE_TEE_SNAP_FT = 6;

/* ⛔ NEW-1 (road → parking, every approach) — ONE PREDICATE FOR "CAN A ROAD CONNECT TO THIS?", read by BOTH the connect gesture
 * (SitePlanner.jsx `driveTargetKind` / `driveTargetsOf`) and the geometric fallback below.
 *
 * They used to disagree. The gesture accepted any visible parking / paving element, bonded to a building or not; the geometric
 * fallback (what rebuilds the junction when a road's stored `driveTee` is missing or stale — a field moved or re-laid, a pasted
 * copy with fresh ids, a road drawn overlapping it without the snap) EXCLUDED anything with `attachedTo`. Employee parking is
 * very often bonded to a building, so a bonded field connected at placement and then LOST its junction the moment the stored
 * tee went stale. Measured on main by test/driveParkingMatrix.test.js: every bonded cell with no stored tee had no junction.
 * Returns "parking" | "truckcourt" | null — the kind that picks car or truck geometry (a drive into a car field never gets the
 * truck flare). A target needs a real footprint: a rect (cx/cy/w/h) or a free-drawn ring of 3+ points. */
export function driveTargetKindOf(el) {
  if (!el || el.id == null) return null;
  const shaped = Array.isArray(el.points) ? el.points.length >= 3 : (typeof el.cx === "number" && el.w > 0 && el.h > 0);
  if (!shaped) return null;
  return el.type === "parking" ? "parking" : el.type === "paving" ? "truckcourt" : null;
}
// Every drive-target element on the plan — the candidate pool GEOMETRIC detection searches when a road carries no (or a stale) `driveTee`.
export function drivePaveTargets(els) {
  return (els || []).filter((e) => driveTargetKindOf(e));
}

export function targetEdges(T) {
  const isPoly = Array.isArray(T.points) && T.points.length >= 3;
  if (!isPoly && !(typeof T.cx === "number" && T.w > 0 && T.h > 0)) return null;
  const edges = isPoly ? polygonEdges(T.points) : rectEdges(T.cx, T.cy, T.w, T.h, T.rot || 0);
  return edges.length ? { isPoly, edges } : null;
}

// Best (endpoint, hit) for road S against ONE candidate target T — the exact proximity test the
// connect gesture (and the pre-extraction code) already used: within DRIVE_TEE_SNAP_FT of an edge,
// or literally inside/on the target.
export function bestHitAgainst(S, T, onlyIdx) {
  const te = targetEdges(T);
  if (!te) return null;
  const { isPoly, edges } = te;
  const containsPoint = (p) => (isPoly ? polygonContainsPoint(p, T.points) : rectContainsPointLocal(p, edges));
  let best = null;
  for (const idx of onlyIdx == null ? [0, S.pts.length - 1] : [onlyIdx]) {
    const h = nearestRectEdge(S.pts[idx], edges, { facingOnly: false });
    if (h && (h.dist <= DRIVE_TEE_SNAP_FT || containsPoint(S.pts[idx])) && (!best || h.dist < best.hit.dist)) {
      best = { ei: idx, hit: h, edges, isPoly };
    }
  }
  return best;
}
// Local copy of roadGeometry.js's rectContainsPoint — avoids importing it just for this one check
// (targetEdges/bestHitAgainst already import everything else this module needs from roadGeometry.js).
function rectContainsPointLocal(P, edges) {
  if (!P || !Number.isFinite(P.x) || !Number.isFinite(P.y) || !Array.isArray(edges) || edges.length < 3) return false;
  return edges.every((e) => (e.outN.x * (P.x - e.mid.x) + e.outN.y * (P.y - e.mid.y)) <= 1e-6);
}

