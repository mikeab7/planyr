/* lib/driveFollow.js — A DRIVE FOLLOWS THE PARKING FIELD (OR TRUCK COURT) IT IS CONNECTED TO ON A SMALL MOVE, AND LETS GO ON A BIG ONE (B2498961).
 *
 * OWNER DECISION, 2026-10-29 (dictated): "The road should move with the parking, like, slightly, though. If I move the building 200 feet,
 * then you can forget the road. But if I move the building and the parking, you know, 50 feet, then, yeah, keep it attached."
 *
 * THE RULE (pure — one function, `followDrives`, read by every seam that can move a field):
 *   • A road CONNECTED to a field is one whose `driveTee` / `driveTee2` record names it AND whose end touches it (`bestHitAgainst`, the same test the
 *     junction builder uses — a stale record on a road that is not touching anything is not a connection, so it never drags the road anywhere).
 *   • When that field's geometry changes — for ANY reason (the load-time heal re-seating a bonded field, dragging the field or the building it rides
 *     on, an arrow-key nudge, rotate / resize, a re-laid row) — the road's connected END follows: it keeps the same spot on the field's edge (the same
 *     edge, the same position along it; re-projected through the new size / angle). ONLY the road's last leg changes; every other control point stays
 *     exactly where it was drawn.
 *   • `DRIVE_FOLLOW_MAX_FT` (100 ft) of movement of the connection point lets go: the road stays exactly as drawn and the record naming that field is
 *     removed (the junction stops drawing; the road end is a clean square end). The threshold is measured from the gesture's BASE (the state when the drag
 *     began), not frame to frame, so the preview shows the road let go the moment the drag crosses it and re-follows if the owner drags back.
 *   • It also lets go, at any distance, when following would FOLD the last leg back on itself or leave it shorter than the road is wide — see `foldsBack`
 *     / `tooShort` below for the exact tests and why.
 *   • A LOCKED road never moves: within the threshold it stays connected (the junction recomputes from where it now meets); past it, it lets go.
 *   • Moving the ROAD itself never moves the field (follow only ever writes the road), and a road the gesture itself moved (a multi-select that holds both
 *     the road and the field) is left to the gesture — it travels with the selection and does not follow twice.
 *
 * `followDrives(base, prev, next, opts)` — three lists, because the answer depends on what the gesture STARTED from (`base`), what the previous write
 * produced (`prev`) and what this write wants (`next`). Outside a drag, `base === prev`. Identity-preserving: returns `next` itself when no road changes.
 * Pure over (lists) — no React, no DOM, no settings; roads are re-bboxed through the injected `restrip` (the planner's `reRoad`, the model's `roadStripBBox`).
 * Deliberately a LEAF (imports only roadGeometry + driveTarget): it is called from siteModel.js's heal, which must not drag the junction engine into boot. */
import { bestHitAgainst, driveTargetKindOf, targetEdges } from "./driveTarget.js";

/** the ONE threshold, in feet of movement of the connection point (owner's own examples: 50 ft keeps the road, 200 ft forgets it) */
export const DRIVE_FOLLOW_MAX_FT = 100;
/** a new last leg turning more than this far from the leg before it is a hairpin — the road would fold back on itself */
export const DRIVE_FOLLOW_HAIRPIN_DEG = 150;

const isRoad = (e) => !!e && e.type === "road" && Array.isArray(e.pts) && e.pts.length >= 2;
const RECORD_KEYS = ["driveTee", "driveTee2"];
const hasRecord = (r) => RECORD_KEYS.some((k) => r[k] && r[k].targetId != null);
const sameNum = (a, b) => a === b || (Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) < 1e-9);
const samePt = (a, b) => !!a && !!b && sameNum(a.x, b.x) && sameNum(a.y, b.y);
const sameGeom = (a, b) => {
  if (a === b) return true;
  if (Array.isArray(a.points) || Array.isArray(b.points)) {
    return Array.isArray(a.points) && Array.isArray(b.points) && a.points.length === b.points.length && a.points.every((p, i) => samePt(p, b.points[i]));
  }
  return sameNum(a.cx, b.cx) && sameNum(a.cy, b.cy) && sameNum(a.w, b.w) && sameNum(a.h, b.h) && sameNum(a.rot || 0, b.rot || 0);
};
const sameRoadPts = (a, b) => a === b || (Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((p, i) => samePt(p, b[i])));

/* WHERE the road end sits on the field, described in the field's OWN frame so it can be replayed on any later shape of that field.
 * Rect: the nearest side (axis + sign + signed offset from it — kept in FEET, so a resize carries the end with the face it sits on) and the position along
 * that side as a FRACTION of its length (so a longer / shorter field keeps the end at the same relative spot). Polygon: the nearest edge by index, the
 * fraction along it, the signed offset off it along its outward normal. */
function anchorOn(T, P) {
  if (Array.isArray(T.points) && T.points.length >= 3) {
    const te = targetEdges(T);
    if (!te) return null;
    let best = null;
    te.edges.forEach((e, i) => {
      const L = e.len || 1, t = Math.max(0, Math.min(1, ((P.x - e.a.x) * e.dir.x + (P.y - e.a.y) * e.dir.y) / L));
      const q = { x: e.a.x + e.dir.x * t * L, y: e.a.y + e.dir.y * t * L };
      const d = Math.hypot(P.x - q.x, P.y - q.y);
      if (!best || d < best.d) best = { d, i, t, off: (P.x - e.a.x) * e.outN.x + (P.y - e.a.y) * e.outN.y };
    });
    return best && { kind: "poly", n: T.points.length, i: best.i, t: best.t, off: best.off };
  }
  const rad = ((T.rot || 0) * Math.PI) / 180, c = Math.cos(rad), s = Math.sin(rad);
  const dx = P.x - T.cx, dy = P.y - T.cy, lx = c * dx + s * dy, ly = -s * dx + c * dy;   // field-local, centred
  const hw = T.w / 2, hh = T.h / 2;
  const alongX = Math.abs(hw - Math.abs(lx)) <= Math.abs(hh - Math.abs(ly));              // nearest side is an END face (x axis) …
  return alongX
    ? { kind: "rect", axis: "x", sign: lx < 0 ? -1 : 1, off: lx - (lx < 0 ? -hw : hw), frac: ly / T.h }
    : { kind: "rect", axis: "y", sign: ly < 0 ? -1 : 1, off: ly - (ly < 0 ? -hh : hh), frac: lx / T.w };
}
/* The same spot on the field's NEW shape, or null when it cannot be replayed (a polygon whose vertex count changed). */
function replay(T2, a) {
  if (!a) return null;
  if (a.kind === "poly") {
    if (!Array.isArray(T2.points) || T2.points.length !== a.n) return null;
    const te = targetEdges(T2);
    const e = te && te.edges[a.i];
    return e ? { x: e.a.x + e.dir.x * a.t * e.len + e.outN.x * a.off, y: e.a.y + e.dir.y * a.t * e.len + e.outN.y * a.off } : null;
  }
  if (Array.isArray(T2.points) || !(T2.w > 0) || !(T2.h > 0) || typeof T2.cx !== "number") return null;
  const hw = T2.w / 2, hh = T2.h / 2;
  const lx = a.axis === "x" ? a.sign * hw + a.off : a.frac * T2.w;
  const ly = a.axis === "y" ? a.sign * hh + a.off : a.frac * T2.h;
  const rad = ((T2.rot || 0) * Math.PI) / 180, c = Math.cos(rad), s = Math.sin(rad);
  return { x: T2.cx + lx * c - ly * s, y: T2.cy + lx * s + ly * c };
}

/* WHEN FOLLOWING IS OFF even though the move is small (owner: "say what you chose and why").
 *   • FOLDS BACK: the new last leg turns more than 150° from the leg before it (a hairpin), or — on a road whose only leg is the last — points more than
 *     90° off the way it was drawn. A road that doubles back on itself is not "the same road, slightly moved", it is a different, broken one; letting go
 *     leaves the owner's drawing intact and the end square, which he can re-connect in one gesture.
 *   • TOO SHORT: the new last leg is shorter than the road is wide. A leg shorter than the pavement it carries has no direction left to speak of (the curb
 *     return would swallow it), so the road is left as drawn rather than collapsed to a stub. */
function foldsBack(pts, i, newEnd) {
  const last = i === pts.length - 1, step = last ? -1 : 1, anchor = pts[i + step];
  const dirNew = { x: newEnd.x - anchor.x, y: newEnd.y - anchor.y }, dirOld = { x: pts[i].x - anchor.x, y: pts[i].y - anchor.y };
  const ang = (u, v) => { const lu = Math.hypot(u.x, u.y), lv = Math.hypot(v.x, v.y); return lu < 1e-9 || lv < 1e-9 ? 0 : (Math.acos(Math.max(-1, Math.min(1, (u.x * v.x + u.y * v.y) / (lu * lv)))) * 180) / Math.PI; };
  const before = pts[i + 2 * step];
  if (before) {
    // the road runs before → anchor → end; the turn at `anchor` is the angle between (anchor - before) and (end - anchor)
    const turn = ang({ x: anchor.x - before.x, y: anchor.y - before.y }, dirNew);
    return turn > DRIVE_FOLLOW_HAIRPIN_DEG;
  }
  return ang(dirNew, dirOld) > 90;
}
const tooShort = (pts, i, newEnd, travelW) => {
  const a = pts[i === pts.length - 1 ? i - 1 : i + 1];
  return Math.hypot(newEnd.x - a.x, newEnd.y - a.y) < Math.max(1, +travelW || 0);
};

/* What happens at ONE end of ONE road when the field it touches (in `base`) has become `T2`:
 *   { follow: Point } · { letGo: true } · { hold: true } (nothing changed) · null (the field is gone / cannot be replayed — leave the road alone) */
function endOutcome(road, i, T, T2, locked) {
  if (!T2 || !driveTargetKindOf(T2)) return null;
  if (sameGeom(T, T2)) return { hold: true };
  const P = road.pts[i], a = anchorOn(T, P);
  const np = replay(T2, a);
  if (!np || !Number.isFinite(np.x) || !Number.isFinite(np.y)) return null;
  if (Math.hypot(np.x - P.x, np.y - P.y) > DRIVE_FOLLOW_MAX_FT) return { letGo: true };
  if (locked) return { hold: true };
  if (foldsBack(road.pts, i, np) || tooShort(road.pts, i, np, road.travelW)) return { letGo: true };
  return { follow: np };
}

export function followDrives(base, prev, next, opts = {}) {
  if (!Array.isArray(next) || next === prev) return next;                // nothing was written this time
  const baseRoads = [];
  for (const e of base || []) if (isRoad(e) && !e.attachedTo && hasRecord(e)) baseRoads.push(e);
  if (!baseRoads.length) return next;
  const nextById = new Map(), prevById = new Map(), baseById = new Map();
  for (const e of next) if (e && e.id != null) nextById.set(e.id, e);
  for (const e of prev || []) if (e && e.id != null) prevById.set(e.id, e);
  for (const e of base || []) if (e && e.id != null) baseById.set(e.id, e);
  const patch = new Map();
  for (const B of baseRoads) {
    const nr = nextById.get(B.id), pr = prevById.get(B.id);
    if (!nr || !pr || !isRoad(nr)) continue;
    if (!sameRoadPts(pr.pts, nr.pts)) continue;                       // the gesture moved THIS road (a multi-select) — it keeps what the gesture wrote
    const ends = [0, B.pts.length - 1];
    const moves = new Map();                                          // end index → new point
    const letGoIds = new Set();                                       // target ids whose record is cleared
    for (const i of ends) {
      for (const key of RECORD_KEYS) {
        const rec = B[key];
        if (!rec || rec.targetId == null) continue;
        const T = baseById.get(rec.targetId);
        if (!T || !driveTargetKindOf(T) || !bestHitAgainst(B, T, i)) continue;   // not actually connected at this end in the base
        const out = endOutcome(B, i, T, nextById.get(rec.targetId), !!B.locked);
        if (!out || out.hold) continue;
        if (out.letGo) letGoIds.add(rec.targetId);
        else if (out.follow) moves.set(i, out.follow);
        break;                                                        // one record per end
      }
    }
    // The road as it SHOULD read: the base geometry with the following ends moved, and the base records with the let-go ones removed. Computing from the
    // BASE (not from `nr`) is what makes a drag reversible — back inside the threshold the record and the follow both come back.
    let pts = B.pts;
    if (moves.size) pts = B.pts.map((p, k) => (moves.has(k) ? { x: moves.get(k).x, y: moves.get(k).y } : p));
    const out = { ...nr };
    out.pts = pts === B.pts ? (sameRoadPts(nr.pts, B.pts) ? nr.pts : B.pts) : pts;
    for (const key of RECORD_KEYS) {
      if (B[key] == null) continue;
      if (letGoIds.has(B[key].targetId)) delete out[key];
      else if (out[key] == null && base !== prev) out[key] = B[key];   // inside a drag only: dragging back inside the threshold brings the record back (outside one, a missing record was the owner's choice)
    }
    const changed = !sameRoadPts(out.pts, nr.pts) || RECORD_KEYS.some((k) => (out[k] == null) !== (nr[k] == null));
    if (!changed) continue;
    patch.set(B.id, typeof opts.restrip === "function" && !sameRoadPts(out.pts, nr.pts) ? opts.restrip(out) : out);
  }
  if (!patch.size) return next;
  return next.map((e) => (e && patch.has(e.id) ? patch.get(e.id) : e));
}
