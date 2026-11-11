/* lib/driveGrade.js (NEW-1, 2026-11-11, owner-only grading layer, constraint #25) — A DRIVE TIES INTO THE ROAD'S GRADE AT THE PROPERTY LINE.
 *
 * The owner's screenshot (Georgia Test Site › Concept A): the 30-ft entrance drive off Chehaw Rd was graded at about the truck-court
 * elevation (high 780s) all the way to the property line while the road and the ground at the line sit near 805, so its side slopes cut a
 * deep channel and the flag read "54 ft past the property line". A drive is not a plane tilted off a building wall: it starts at the ROAD and
 * climbs/falls to the court or lot it serves.
 *
 * THE RULE (every number a Standards value, `GRADING_DRIVE_DEFAULTS` — nothing hard-coded in the engine):
 *   • the tie-in is where the drive's centerline meets the PROPERTY LINE; its elevation is the EXISTING ground there ("road 805.2");
 *   • a short near-flat LANDING at the road (default 50 ft at no more than 2 %), then ONE constant grade to meet the court / lot edge
 *     elevation, then the normal pavement plane takes over (the court's own plane, untouched);
 *   • a drive whose total change is within the landing grade over its whole length is one constant grade (no break to invent);
 *   • a drive too short to make the change within the max drive grade (default 8 %) is still drawn at the grade it needs and says so with
 *     ONE plain flag ("Drive too steep to reach the road") — it never cuts past the line to hide it.
 * Pure, no DOM, feet and ft NAVD88. Screening only. */
import ClipperLib from "clipper-lib";
import { pointInRing } from "./pondGeom.js";

export const GRADING_DRIVE_DEFAULTS = Object.freeze({
  driveMaxGradePct: 8,     // the steepest constant grade a drive may run (a Standards value; the panel gear edits it)
  driveLandingFt: 50,      // the near-flat landing at the road
  driveLandingPct: 2,      // …at no more than this grade
});
export const DRIVE_SNAP_FT = 8;            // a drive that ENDS this close inside the line (or at it) ties in at the nearest point of the line
export const DRIVE_TARGET_REACH_FT = 15;   // the far end must touch (or be this close to) a graded court / lot to be a drive at all
const EPS = 1e-9;

const insideAny = (pt, rings) => { for (const r of rings) if (r && r.length >= 3 && pointInRing(pt, r)) return true; return false; };

/* Intersection of segment p→q with segment a→b → { t (along p→q), u (along a→b) } or null. */
function segHit(p, q, a, b) {
  const rx = q.x - p.x, ry = q.y - p.y, sx = b.x - a.x, sy = b.y - a.y;
  const den = rx * sy - ry * sx;
  if (Math.abs(den) < EPS) return null;
  const t = ((a.x - p.x) * sy - (a.y - p.y) * sx) / den, u = ((a.x - p.x) * ry - (a.y - p.y) * rx) / den;
  return t >= -EPS && t <= 1 + EPS && u >= -EPS && u <= 1 + EPS ? { t: Math.min(1, Math.max(0, t)), u } : null;
}
/* Nearest point on any ring's edge to pt → { x, y, d } | null. */
function nearestOnRings(pt, rings) {
  let best = null;
  for (const r of rings) {
    if (!r || r.length < 3) continue;
    for (let i = 0; i < r.length; i++) {
      const a = r[i], b = r[(i + 1) % r.length], ex = b.x - a.x, ey = b.y - a.y, L2 = ex * ex + ey * ey;
      const t = L2 < EPS ? 0 : Math.max(0, Math.min(1, ((pt.x - a.x) * ex + (pt.y - a.y) * ey) / L2));
      const x = a.x + ex * t, y = a.y + ey * t, d = Math.hypot(pt.x - x, pt.y - y);
      if (!best || d < best.d) best = { x, y, d };
    }
  }
  return best;
}

/* Where a road's centerline ties into the property line. `pts` = the centerline (≥ 2 points), `parcelRings` = the property lines.
 * One end must lie OUT on the road side (outside every property line, or within DRIVE_SNAP_FT inside of one) and the other end inside; the
 * tie is the first crossing walking in from that end. A road that crosses the whole site (both ends outside), lies wholly inside, or is
 * not near a line is NOT a drive → null (nothing about it changes).
 * Returns { tie: {x,y}, path: [tie, …centerline points to the far end], tieEnd: 0 | n−1, far: {x,y} }. */
export function driveTieOf(pts, parcelRings, { snapFt = DRIVE_SNAP_FT } = {}) {
  if (!Array.isArray(pts) || pts.length < 2 || !Array.isArray(parcelRings) || !parcelRings.length) return null;
  const rings = parcelRings.filter((r) => r && r.length >= 3);
  if (!rings.length) return null;
  const n = pts.length;
  const found = [];
  for (const end of [0, n - 1]) {
    const seq = end === 0 ? pts : pts.slice().reverse();   // seq[0] is the road-side end
    const farPt = seq[seq.length - 1];
    if (!insideAny(farPt, rings)) continue;                 // the far end must be on the site
    let tie = null, rest = null;
    if (!insideAny(seq[0], rings)) {
      // walk in from the outside end; the first crossing whose far side (a foot on) is on the site is the tie
      outer: for (let i = 0; i + 1 < seq.length; i++) {
        const p = seq[i], q = seq[i + 1], L = Math.hypot(q.x - p.x, q.y - p.y);
        if (L < EPS) continue;
        const hits = [];
        for (const r of rings) for (let k = 0; k < r.length; k++) {
          const h = segHit(p, q, r[k], r[(k + 1) % r.length]);
          if (h) hits.push(h.t);
        }
        hits.sort((a, b) => a - b);
        for (const t of hits) {
          const c = { x: p.x + (q.x - p.x) * t, y: p.y + (q.y - p.y) * t };
          const ahead = { x: c.x + ((q.x - p.x) / L) * 1, y: c.y + ((q.y - p.y) / L) * 1 };
          if (insideAny(ahead, rings) || Math.hypot(q.x - c.x, q.y - c.y) < 1 && insideAny(q, rings)) { tie = c; rest = seq.slice(i + 1); break outer; }
        }
      }
    } else {
      // the end is inside but lies on / hugs the line: tie at the nearest point of the line, provided the ground just past it is off the site
      const nr = nearestOnRings(seq[0], rings);
      if (nr && nr.d <= snapFt) {
        const dx = nr.x - seq[0].x, dy = nr.y - seq[0].y, d = Math.hypot(dx, dy);
        const ux = d > 0.01 ? dx / d : 0, uy = d > 0.01 ? dy / d : 0;
        const beyond = d > 0.01 ? { x: nr.x + ux * 3, y: nr.y + uy * 3 } : null;
        // exactly on the line the direction is the road's own heading outward
        const h = beyond || (() => { const a = seq[0], b = seq[1], L = Math.hypot(b.x - a.x, b.y - a.y) || 1; return { x: a.x - ((b.x - a.x) / L) * 3, y: a.y - ((b.y - a.y) / L) * 3 }; })();
        if (!insideAny(h, rings)) { tie = { x: nr.x, y: nr.y }; rest = d > 0.5 ? seq : seq.slice(1); }
      }
    }
    if (tie && rest && rest.length) found.push({ tie, path: [tie, ...rest], tieEnd: end, far: farPt });
  }
  if (found.length !== 1) return null;                      // none, or a road tied into the line at BOTH ends: not a drive
  const f = found[0];
  let len = 0;
  for (let i = 0; i + 1 < f.path.length; i++) len += Math.hypot(f.path[i + 1].x - f.path[i].x, f.path[i + 1].y - f.path[i].y);
  return len > 1 ? f : null;
}

/* The profile of a drive: landing, then one constant grade. `lengthFt` from the tie to the far end; `zTie` = the road (existing ground at the
 * line), `zEnd` = the court / lot edge it meets. Returns { lengthFt, zTie, zEnd, landingFt, landingGrade, grade, gradePct, tooSteep,
 * maxGradePct, z(s) } — grades are rise per foot walking AWAY from the road (+ climbs, − falls). */
export function driveProfile({ lengthFt, zTie, zEnd, landingFt = GRADING_DRIVE_DEFAULTS.driveLandingFt, landingPct = GRADING_DRIVE_DEFAULTS.driveLandingPct,
  maxGradePct = GRADING_DRIVE_DEFAULTS.driveMaxGradePct } = {}) {
  if (!(lengthFt > 0) || !Number.isFinite(zTie) || !Number.isFinite(zEnd)) return null;
  const delta = zEnd - zTie;
  let landing = Math.min(Math.max(0, landingFt), lengthFt), sL, g;
  if (lengthFt <= landingFt + EPS || Math.abs(delta) / lengthFt <= landingPct / 100 + EPS) {
    // nothing to break: too short for a landing, or the whole change fits inside the landing grade — one constant grade
    sL = g = delta / lengthFt;
    landing = lengthFt <= landingFt + EPS ? lengthFt : landing;
  } else {
    sL = Math.sign(delta) * landingPct / 100;
    g = (delta - sL * landing) / (lengthFt - landing);
  }
  const zLand = zTie + sL * landing;
  const z = (s) => (s <= 0 ? zTie : s <= landing ? zTie + sL * s : s < lengthFt ? zLand + g * (s - landing) : zEnd);
  return {
    lengthFt, zTie, zEnd, landingFt: landing, landingGrade: sL, grade: g, gradePct: g * 100, zLand,
    maxGradePct, tooSteep: Math.abs(g) * 100 > maxGradePct + 1e-6, z,
  };
}

/* A drive's elevation at a point: the profile at the point's station along the centerline path (nearest segment; before the tie it holds the
 * road's elevation, past the far end the court's). */
export function driveZAt(path, profile) {
  const segs = [];
  let acc = 0;
  for (let i = 0; i + 1 < path.length; i++) {
    const a = path[i], b = path[i + 1], L = Math.hypot(b.x - a.x, b.y - a.y);
    if (L < EPS) continue;
    segs.push({ a, ux: (b.x - a.x) / L, uy: (b.y - a.y) / L, L, s0: acc });
    acc += L;
  }
  return (pt) => {
    let best = null, bd = Infinity;
    for (const g of segs) {
      const t = Math.max(0, Math.min(g.L, (pt.x - g.a.x) * g.ux + (pt.y - g.a.y) * g.uy));
      const d = Math.hypot(pt.x - (g.a.x + g.ux * t), pt.y - (g.a.y + g.uy * t));
      if (d < bd) { bd = d; best = g.s0 + t; }
    }
    return profile.z(best == null ? 0 : best);
  };
}

/* Where the drive's labels go: the tie-in spot, and the grade tag + arrow along the constant-grade stretch. */
export function driveLabelPoints(path, profile) {
  const at = (s) => {
    let acc = 0;
    for (let i = 0; i + 1 < path.length; i++) {
      const a = path[i], b = path[i + 1], L = Math.hypot(b.x - a.x, b.y - a.y);
      if (s <= acc + L || i === path.length - 2) { const t = L > 0 ? Math.max(0, Math.min(1, (s - acc) / L)) : 0; return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }; }
      acc += L;
    }
    return path[0];
  };
  const L = profile.lengthFt, s0 = profile.landingFt >= L ? 0 : profile.landingFt;
  const mid = s0 + (L - s0) * 0.5;
  return { tie: path[0], tagAt: at(mid), arrowFrom: at(s0 + (L - s0) * 0.3), arrowTo: at(s0 + (L - s0) * 0.7), at };
}

/* The part of a drive's footprint that lies ON THE SITE. The drawn road runs out into the right-of-way (often to the far lane); only what is inside
 * the property line is graded — past the line the only work is the tie-in itself, at the road's own elevation. Clipped against the property
 * lines; the largest piece wins (a drive that clips to several pieces keeps the one holding its far end). Returns a ring, or null. */
export function driveRingOnSite(ring, parcelRings, farPt = null) {
  if (!Array.isArray(ring) || ring.length < 3) return null;
  const SC = 100, toP = (r) => r.map((p) => ({ X: Math.round(p.x * SC), Y: Math.round(p.y * SC) }));
  const c = new ClipperLib.Clipper();
  c.AddPath(toP(ring), ClipperLib.PolyType.ptSubject, true);
  for (const r of parcelRings || []) if (r && r.length >= 3) c.AddPath(toP(r), ClipperLib.PolyType.ptClip, true);
  const sol = new ClipperLib.Paths();
  c.Execute(ClipperLib.ClipType.ctIntersection, sol, ClipperLib.PolyFillType.pftNonZero, ClipperLib.PolyFillType.pftNonZero);
  const rings = sol.map((path) => path.map((q) => ({ x: q.X / SC, y: q.Y / SC }))).filter((r) => r.length >= 3);
  if (!rings.length) return null;
  const area = (r) => { let a = 0; for (let i = 0; i < r.length; i++) { const p = r[i], q = r[(i + 1) % r.length]; a += p.x * q.y - q.x * p.y; } return Math.abs(a / 2); };
  if (farPt) { const hold = rings.filter((r) => pointInRing(farPt, r)); if (hold.length) return hold.sort((a, b) => area(b) - area(a))[0]; }
  return rings.sort((a, b) => area(b) - area(a))[0];
}
