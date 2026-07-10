/* Deed ↔ parcel alignment — the basis-of-bearings correction (B-align).
 *
 * WHY a plotted deed doesn't sit on the county parcel:
 * A metes-and-bounds legal description is plotted by dead-reckoning its bearings
 * (metesAndBounds.callsToPath) as azimuths measured from the plan's "up", which is
 * TRUE north — the county GIS parcel (lon/lat, linearized north-up in arcgis.js) and
 * the aerial are true-north-up. But a Texas survey almost always states its bearings
 * on Texas State Plane GRID north (via GPS/NAD83), or on an older "record" bearing —
 * NOT true north. Grid north differs from true north by the meridian convergence
 * angle: ~1.5° in the Houston/Katy area. Plotted raw, the deed therefore lands
 * rotated ~1.5° from the parcel, which fans out to ~90 ft of drift over a 3,300-ft
 * line — exactly the "it doesn't line up" a developer sees.
 *
 * This module corrects that rotation two ways:
 *   • solveDeedAlignment(deedRing, parcelRing) — the EMPIRICAL fix: the rigid
 *     rotation + translation (deed shape PRESERVED, never scaled/distorted) that best
 *     overlays the plotted deed onto the held county parcel. Works for ANY basis of
 *     bearings (grid, record, magnetic) because it reads the correction straight off
 *     the two outlines rather than assuming which north the deed used.
 *   • gridConvergenceDeg(lat, lon) — the THEORETICAL fallback for when there's no
 *     parcel to fit to: the exact grid-north-vs-true-north angle at the site, from the
 *     shared EPSG:2278 projection. Rotating a grid-referenced deed by this angle brings
 *     it onto the true-north plan.
 *
 * Rigid (scale LOCKED to 1) on purpose: the deed's surveyed bearings and distances are
 * the ground truth here; we only spin + shift the whole traverse to sit on the parcel.
 * We never rubber-sheet it to match a generalized GIS outline — that would corrupt the
 * very measurements the deed exists to carry. (Contrast fitToBoundary.js, which solves a
 * full SIMILARITY incl. scale, for landing a scanned drawing whose plot size is unknown.)
 */
import { projectToGrid, gridToProject } from "../../../shared/coordinates/index.js";

// residual / characteristic-size ratio at or below which a fit is called "confident".
export const CONFIDENT_FRAC = 0.02; // 2%

// Widest rotation the empirical fit will consider, in degrees. A basis-of-bearings
// correction is ALWAYS physically small: grid convergence is ~1.5° near Houston (up to
// ~2–3° at the Texas zone edges), and an old magnetic/record basis adds at most a handful
// of degrees. So the real answer lives well under ~15°, while the nearest spurious
// rotational alias of a near-square / roughly-symmetric outline is at 45/90/180°. Searching
// the full ±180° let that alias win — a shape whose deed polygon differs a little from the
// generalized county outline could score a LOWER nearest-vertex RMS tens of degrees away
// than at the true ~1.5°, so the deed swung grossly off-angle (the B625 recurrence). Bounding
// the sweep to ±20° sits cleanly in the gap: it still finds any legitimate correction, but a
// deed that only "fits" past 20° is either the wrong tract or a mis-plot and is reported
// not-confident rather than force-rotated. Caller may override via opts.maxRotDeg.
export const MAX_ALIGN_ROT_DEG = 20;

/* Drop a duplicated closing vertex (first ≈ last) and any non-finite points so vertex
 * counts and centroids compare cleanly. Returns an open ring of {x,y}. */
export function openRing(ring) {
  const pts = (ring || []).filter((p) => p && Number.isFinite(p.x) && Number.isFinite(p.y)).map((p) => ({ x: p.x, y: p.y }));
  if (pts.length > 1) {
    const a = pts[0], b = pts[pts.length - 1];
    if (Math.hypot(a.x - b.x, a.y - b.y) < 1e-9) pts.pop();
  }
  return pts;
}

/* Plain vertex centroid of a ring (the pivot the rigid fit rotates about). */
export function ringCentroid(ring) {
  let x = 0, y = 0;
  for (const p of ring) { x += p.x; y += p.y; }
  const n = ring.length || 1;
  return { x: x / n, y: y / n };
}

/* Shoelace area magnitude (sign-independent) — used only for a characteristic size. */
function ringArea(ring) {
  let a = 0;
  for (let i = 0; i < ring.length; i++) {
    const p = ring[i], q = ring[(i + 1) % ring.length];
    a += p.x * q.y - q.x * p.y;
  }
  return Math.abs(a) / 2;
}

/* Evenly subsample a ring down to at most `max` points, so the O(n·m) angle search
 * stays cheap even against a finely-digitized county outline (hundreds of vertices). */
function subsample(ring, max) {
  if (ring.length <= max) return ring;
  const out = [];
  for (let i = 0; i < max; i++) out.push(ring[Math.floor((i * ring.length) / max)]);
  return out;
}

/* Rotate `pts` by `deg` about `pivot`, in the planner/screen frame (y grows DOWN, so a
 * positive angle reads as a clockwise turn on screen — the same sense metesAndBounds
 * uses for azimuth). Shared by the fit and the manual "nudge the deed" control. */
export function rotatePointsAbout(pts, deg, pivot) {
  const t = (deg * Math.PI) / 180, c = Math.cos(t), s = Math.sin(t);
  return (pts || []).map((p) => {
    const dx = p.x - pivot.x, dy = p.y - pivot.y;
    return { x: pivot.x + (c * dx - s * dy), y: pivot.y + (s * dx + c * dy) };
  });
}

/* Symmetric nearest-vertex RMS distance (ft) between two point sets — a
 * correspondence-free, vertex-count-independent measure of how well two outlines
 * overlay (each point's distance to the nearest point in the other set, both ways). */
function symmetricRms(A, B) {
  const nearest2 = (p, set) => {
    let best = Infinity;
    for (const q of set) { const d = (p.x - q.x) ** 2 + (p.y - q.y) ** 2; if (d < best) best = d; }
    return best;
  };
  let se = 0, n = 0;
  for (const p of A) { se += nearest2(p, B); n++; }
  for (const q of B) { se += nearest2(q, A); n++; }
  return n ? Math.sqrt(se / n) : Infinity;
}

/* Solve the rigid rotation + translation (scale LOCKED to 1) that best overlays the
 * plotted deed ring onto a held county parcel ring. Both rings are {x,y} in the planner's
 * y-DOWN feet frame (+x east, +y SOUTH — north renders up but is −y; see the file header
 * and metesAndBounds). Strategy: translate the deed centroid onto the parcel centroid, then
 * sweep the rotation about that point for the lowest symmetric nearest-vertex RMS — a coarse
 * sweep BOUNDED to ±maxRotDeg (default MAX_ALIGN_ROT_DEG), then a fine refine clamped to that
 * same window. The window is deliberately narrow because a basis-of-bearings correction is
 * always small; searching wider let a near-symmetric outline snap to a 45/90/180° alias.
 * A reversed winding needs NO wide sweep — symmetricRms compares point SETS, so a ring
 * digitized the opposite way round is the same set and its optimum is still the small angle.
 *
 * Returns { ok, rotDeg, pivot, residualFt, charLenFt, residualFrac, confident, apply,
 * reason }. `apply(pt)` maps ANY deed point (boundary ring OR centerline) to its
 * aligned position, so the caller transforms the whole encumbrance with one map. ok:false
 * only when a ring is too small to form a shape. */
export function solveDeedAlignment(deedRing, parcelRing, opts = {}) {
  const D = openRing(deedRing), P = openRing(parcelRing);
  if (D.length < 3 || P.length < 3) {
    return { ok: false, confident: false, reason: "Need at least 3 boundary points on both the deed and the parcel." };
  }
  const Cd = ringCentroid(D), Cp = ringCentroid(P);
  const charLen = Math.sqrt(ringArea(P)) || 1;
  const maxPts = opts.maxPts || 96;
  const ds = subsample(D, maxPts), ps = subsample(P, maxPts);
  // deed subsample translated so its centroid sits on the parcel centroid
  const centered = ds.map((p) => ({ x: p.x - Cd.x + Cp.x, y: p.y - Cd.y + Cp.y }));
  const evalAt = (deg) => symmetricRms(rotatePointsAbout(centered, deg, Cp), ps);

  const maxRot = Number.isFinite(opts.maxRotDeg) ? Math.abs(opts.maxRotDeg) : MAX_ALIGN_ROT_DEG;
  let best = { deg: 0, rms: Infinity };
  for (let d = -maxRot; d <= maxRot; d += 1) { const r = evalAt(d); if (r < best.rms) best = { deg: d, rms: r }; }
  const lo = Math.max(-maxRot, best.deg - 1), hi = Math.min(maxRot, best.deg + 1);
  for (let d = lo; d <= hi; d += 0.02) { const r = evalAt(d); if (r < best.rms) best = { deg: d, rms: r }; }

  const rotDeg = best.deg;
  const t = (rotDeg * Math.PI) / 180, c = Math.cos(t), s = Math.sin(t);
  // apply: rotate a deed point about the DEED centroid, then shift Cd → Cp. Algebraically
  // identical to the centroid-align-then-rotate-about-Cp used in the search above.
  const apply = (pt) => {
    const dx = pt.x - Cd.x, dy = pt.y - Cd.y;
    return { x: Cp.x + (c * dx - s * dy), y: Cp.y + (s * dx + c * dy) };
  };
  const residualFrac = best.rms / charLen;
  return {
    ok: true,
    rotDeg,
    pivot: { x: Cd.x, y: Cd.y },
    residualFt: best.rms,
    charLenFt: charLen,
    residualFrac,
    confident: residualFrac <= (opts.confidentFrac != null ? opts.confidentFrac : CONFIDENT_FRAC),
    apply,
    reason: null,
  };
}

/* Grid-north-vs-true-north convergence at a site, in degrees, from the shared EPSG:2278
 * projection. POSITIVE = State Plane grid north lies EAST of true north (the Houston/Katy
 * case, ~+1.5°). Because metesAndBounds plots a grid azimuth β as if it were the true
 * azimuth, and trueAzimuth = gridAzimuth + convergence, rotating the whole deed by
 * +convergence (a clockwise-on-screen turn) brings a grid-referenced description onto the
 * true-north plan. Returns 0 for non-finite input. */
export function gridConvergenceDeg(lat, lon) {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return 0;
  const p = projectToGrid(lat, lon);
  const up = gridToProject({ x: p.x, y: p.y + 1000 }); // a point 1000 ft due GRID-north
  const dLat = up.lat - lat;
  const dLon = (up.lon - lon) * Math.cos((lat * Math.PI) / 180); // east component, in degrees
  return (Math.atan2(dLon, dLat) * 180) / Math.PI; // angle of grid-north east of true north
}

/* A plain-language description of a rotation magnitude/direction, for the honest read-out
 * ("rotated 1.55° clockwise to match the county parcel"). Screen-frame: +deg = clockwise. */
export function describeRotation(deg) {
  const d = ((deg + 180) % 360 + 360) % 360 - 180; // fold to (−180, 180]
  const mag = Math.abs(d);
  if (mag < 0.01) return "left as drawn (already aligned)";
  return `${mag.toFixed(2)}° ${d >= 0 ? "clockwise" : "counter-clockwise"}`;
}
