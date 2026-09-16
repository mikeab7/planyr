/* lib/roadJunctions.js — road → paving/parking DRIVE junctions (B955/NEW-1, extracted B1703666).
 *
 * `driveJunctionsOf` used to live only inside `SitePlanner.jsx`, which meant every test that wanted
 * "the geometry the renderer actually produces" had to hand-copy its math (test/roadDriveJunctionFillet
 * .test.js's own `driveJunctionScenario`) — and that re-implementation is exactly how three rounds
 * (B1645792 and its two amendments) shipped a fully green suite while the deployed build stayed
 * broken: the test was never running the function the app runs. Pulling it out here, pure and
 * exported, means SitePlanner.jsx and the test suite call the IDENTICAL function — a drift between
 * "what the test checks" and "what the app does" can no longer exist for this code path.
 *
 * Pure: world feet in, world feet out. No React, no DOM. Depends only on roadGeometry.js (teeGeometry
 * + the rect/polygon edge primitives), siteGeometry.js (isCenterlineRoad, roadCurbWidth) and
 * roadClasses.js (roadClassOf, classReturnRadius) — the same pure tier SitePlanner.jsx already pulls
 * these from.
 *
 * ⛔ B1703665 NEW-2 — GEOMETRIC DETECTION, NOT JUST A STORED FLAG. The road-to-ROAD tee family
 * (`teeJunctionsOf`/`teeTargetOf`, siteGeometry.js) has never needed a stored flag to recognise a
 * junction — a side road's endpoint coincident with another road's interior vertex IS a tee, full
 * stop. The road-to-PAD family required `el.driveTee` to be stamped at connect time, and NOTHING
 * upgrades a road that already overlaps a pad's edge into a junction if that stamp is missing or
 * stale (an older connect predating this feature, a road nudged after connecting, one imported/
 * migrated, or simply drawn overlapping the pad without the snap gesture). Measured on the owner's
 * real plan: seven of eleven road-to-pad contacts were PLAIN BUTT JOINTS WITH NO RETURN ANYWHERE —
 * `driveJunctionsOf`'s very first line (`if (!S.driveTee) continue`) skipped every one of them before
 * any geometry was ever asked. The fix mirrors `teeTargetOf` exactly: when a road's own stored
 * `driveTee` doesn't resolve (or is absent), fall back to a GEOMETRIC search over every Paving/
 * Parking-typed element on the plan, using the SAME proximity test (`dist <= DRIVE_TEE_SNAP_FT` or
 * literal containment) the connect gesture itself already uses to decide "this endpoint is on that
 * pad's edge." An explicit stored `driveTee` still WINS when present (it carries a user's kind /
 * return-radius override) — this only widens WHICH targets are considered when nothing was stored,
 * and it can only ever ADD a junction, never remove the explicit-connect path. */
import {
  teeGeometry, rectEdges, nearestRectEdge, polygonEdges, polygonContainsPoint, polygonDepthBehind,
  roadEdgeCrossing,
} from "./roadGeometry.js";
import { isCenterlineRoad, roadCurbWidth } from "./siteGeometry.js";
import { roadClassOf, classReturnRadius } from "./roadClasses.js";

// Same coincidence tolerance `driveJunctionsOf` has always used for "is this endpoint on that edge."
export const DRIVE_TEE_SNAP_FT = 6;

const roadOuterHalf = (el) => Math.max(0, (+el.travelW || 0) / 2) + roadCurbWidth(el); // centerline → back-of-curb

// How far a road RUNS from vertex `i` in direction `step` (+1/-1) along its own polyline, and the
// first point far enough away to give an honest tangent (skips sub-tolerance vertex clutter — see
// SitePlanner.jsx's own history of this exact function for why: a run of near-duplicate connect-drag
// vertices used to starve the curb-return reach clamp to a couple of feet).
export const VERTEX_NOISE_FT = 1.5;
const RUN_CAP_FT = 1000;
export function roadRunFrom(pts, i, step, noiseFt = VERTEX_NOISE_FT) {
  const noise = noiseFt > 0 ? noiseFt : VERTEX_NOISE_FT;
  let dist = 0, far = null;
  for (let k = i + step; k >= 0 && k < pts.length; k += step) {
    const prev = pts[k - step], cur = pts[k];
    dist += Math.hypot(cur.x - prev.x, cur.y - prev.y);
    if (!far && Math.hypot(cur.x - pts[i].x, cur.y - pts[i].y) > noise) far = cur;
    if (dist >= RUN_CAP_FT) break;
  }
  return { dist, far: far || pts[i + step] || pts[i] };
}
// The tangent-read scale for a road: half its travel width, floored at the bare noise tolerance.
export const roadTangentNoise = (el) => Math.max(VERTEX_NOISE_FT, (+(el && el.travelW) || 0) / 2);

export const DRIVE_RETURN_SEED = { parking: 15, truckcourt: 24 }; // B1005 — tidy default; teeGeometry caps the return REACH to R itself, so a small seed reads as a rounded corner. Editable up per-junction for a real WB-62 turn.
// How far a junction's curb return may run along the through edge before it would reach a BUILDING.
export const BUILDING_CLEAR_FT = 2; // stop this far short, so the curb line never kisses the wall
export function buildingRunLimit(els, P, u, nOpen, reach) {
  let pos = Infinity, neg = Infinity;
  for (const b of els || []) {
    if (!b || b.type !== "building" || b.points || !(b.w > 0) || !(b.h > 0) || typeof b.cx !== "number") continue;
    const rad = ((b.rot || 0) * Math.PI) / 180, c = Math.cos(rad), sn = Math.sin(rad);
    let sMin = Infinity, sMax = -Infinity, tMax = -Infinity, tMin = Infinity;
    for (const [lx, ly] of [[-b.w / 2, -b.h / 2], [b.w / 2, -b.h / 2], [b.w / 2, b.h / 2], [-b.w / 2, b.h / 2]]) {
      const dx = b.cx + (lx * c - ly * sn) - P.x, dy = b.cy + (lx * sn + ly * c) - P.y;
      const sa = dx * u.x + dy * u.y, ta = dx * nOpen.x + dy * nOpen.y;
      if (sa < sMin) sMin = sa; if (sa > sMax) sMax = sa;
      if (ta < tMin) tMin = ta; if (ta > tMax) tMax = ta;
    }
    if (tMax <= 0 || tMin > reach) continue;                 // behind the edge, or clear of the return's depth
    if (sMax > 0) pos = Math.min(pos, sMin > 0 ? sMin : 0);  // straddles the junction → no room at all
    if (sMin < 0) neg = Math.min(neg, sMax < 0 ? -sMax : 0);
  }
  return { pos: Math.max(0, pos - BUILDING_CLEAR_FT), neg: Math.max(0, neg - BUILDING_CLEAR_FT) };
}

// Every Paving/Parking-typed element on the plan — the candidate pool GEOMETRIC detection searches
// when a road carries no (or a stale) `driveTee`. A target must still be attached to nothing (not
// itself bonded to a host) — same constraint an explicit connect already implies.
function drivePaveTargets(els) {
  return (els || []).filter((e) => e && (e.type === "paving" || e.type === "parking") && !e.attachedTo && e.id != null);
}

function targetEdges(T) {
  const isPoly = Array.isArray(T.points) && T.points.length >= 3;
  if (!isPoly && !(typeof T.cx === "number" && T.w > 0 && T.h > 0)) return null;
  const edges = isPoly ? polygonEdges(T.points) : rectEdges(T.cx, T.cy, T.w, T.h, T.rot || 0);
  return edges.length ? { isPoly, edges } : null;
}

// Best (endpoint, hit) for road S against ONE candidate target T — the exact proximity test the
// connect gesture (and the pre-extraction code) already used: within DRIVE_TEE_SNAP_FT of an edge,
// or literally inside/on the target.
function bestHitAgainst(S, T) {
  const te = targetEdges(T);
  if (!te) return null;
  const { isPoly, edges } = te;
  const containsPoint = (p) => (isPoly ? polygonContainsPoint(p, T.points) : rectContainsPointLocal(p, edges));
  let best = null;
  for (const idx of [0, S.pts.length - 1]) {
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

/* B955/NEW-1 — road → parking-drive / truck-court junctions for the clean-intersection render. Reads
 * el.driveTee when present (kind + any per-junction returnR/flare override survive); otherwise finds
 * the connect GEOMETRICALLY, the same way a road-to-road tee always has (B1703665 NEW-2 — see this
 * module's header). Returns [{ sideId, targetId, kind, geom }]. Pure over (els, settings). */
export function driveJunctionsOf(els, settings) {
  const out = [];
  const byId = new Map((els || []).map((e) => [e.id, e]));
  const paveTargets = drivePaveTargets(els);
  for (const S of els || []) {
    if (!isCenterlineRoad(S) || S.attachedTo) continue;
    const stored = S.driveTee ? byId.get(S.driveTee.targetId) : null;
    let T = stored, found = stored ? bestHitAgainst(S, stored) : null;
    if (!found) {
      // Stored target missing/stale, or no driveTee at all — search every paving/parking element on
      // the plan geometrically, exactly as teeTargetOf does for a road-to-road tee. The nearest valid
      // hit across every candidate wins.
      for (const cand of paveTargets) {
        if (cand === stored) continue; // already tried above
        const hit = bestHitAgainst(S, cand);
        if (hit && (!found || hit.hit.dist < found.hit.dist)) { found = hit; T = cand; }
      }
    }
    if (!T || !found) continue;
    const { ei, hit, edges, isPoly } = found;
    const P = S.pts[ei];                                            // the road's welded endpoint
    // NEW-1 — run ALONG the drive's polyline (skipping sub-tolerance vertex clutter) rather than
    // trusting the adjacent vertex; see roadRunFrom.
    const sideRun = roadRunFrom(S.pts, ei, ei === 0 ? 1 : -1, roadTangentNoise(S));
    const sideDir = { x: sideRun.far.x - P.x, y: sideRun.far.y - P.y };
    // B1611841 (NEW-2) — resolve the junction at the pad FACE the road actually crosses, never at
    // the raw endpoint (see roadGeometry.js's roadEdgeCrossing for why).
    const crossing = roadEdgeCrossing(sideRun.far, P, edges);
    const junctionEdge = crossing ? crossing.edge : hit.edge;
    const junctionPt = crossing ? crossing.pt : P;
    const insideRunFt = Math.hypot(P.x - junctionPt.x, P.y - junctionPt.y);
    // An explicit stored driveTee's `kind` always wins (matches the pre-extraction contract exactly:
    // "truckcourt" only on an exact match, "parking" otherwise) — it is the user's own connect-time
    // choice. Only when nothing was stored for THIS target does the target's own type decide.
    const kind = S.driveTee && S.driveTee.targetId === T.id
      ? (S.driveTee.kind === "truckcourt" ? "truckcourt" : "parking")
      : (T.type === "paving" ? "truckcourt" : "parking");
    const clsDrive = roadClassOf(settings, S.roadClass);
    const Rclass = classReturnRadius(clsDrive);
    const storedReturnR = S.driveTee && S.driveTee.targetId === T.id ? S.driveTee.returnR : 0;
    const Rseed = storedReturnR > 0
      ? storedReturnR
      : (kind === "truckcourt" ? Math.max(Rclass, DRIVE_RETURN_SEED.truckcourt) : Rclass);
    const flare = S.driveTee && S.driveTee.targetId === T.id && S.driveTee.flare > 0 ? S.driveTee.flare : 0;
    const perpDepth = isPoly
      ? polygonDepthBehind(T.points, junctionPt, { x: -junctionEdge.outN.x, y: -junctionEdge.outN.y })
      : (junctionEdge.axis === "y" ? T.h : T.w);
    const edgeRunPos = (junctionEdge.b.x - junctionPt.x) * junctionEdge.dir.x + (junctionEdge.b.y - junctionPt.y) * junctionEdge.dir.y;
    const edgeRunNeg = (junctionPt.x - junctionEdge.a.x) * junctionEdge.dir.x + (junctionPt.y - junctionEdge.a.y) * junctionEdge.dir.y;
    const obstacle = buildingRunLimit(els, junctionPt, junctionEdge.dir, junctionEdge.outN, Rseed);   // NEW-4 — never under a building
    const geom = teeGeometry({
      T: { x: junctionPt.x, y: junctionPt.y }, throughDir: junctionEdge.dir, sideDir,
      phT: 0, phS: roadOuterHalf(S),
      R: Math.min(Rseed, Math.max(1, perpDepth)), flare, curbT: 0.5, curbS: roadCurbWidth(S),
      throughAvailPos: Math.max(0, Math.min(edgeRunPos, obstacle.pos)),
      throughAvailNeg: Math.max(0, Math.min(edgeRunNeg, obstacle.neg)),
      sideAvail: Math.max(0, sideRun.dist - insideRunFt),
    });
    if (geom) out.push({ sideId: S.id, targetId: T.id, kind, geom });
  }
  return out;
}
