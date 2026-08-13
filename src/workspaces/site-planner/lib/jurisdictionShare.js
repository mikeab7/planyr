/* ═══════════════════════════════════════════════════════════════════════════════════════════════
 * jurisdictionShare — HOW MUCH OF THIS SITE IS IN THAT JURISDICTION, BY AREA.
 *
 * ⛔ NEW-2 — A JURISDICTION SHARE IS AN AREA FRACTION ON THE REAL RING. VERTEX / POINT SAMPLING
 * IS NOT A SHARE, AND THE TWO DISAGREE BY ENOUGH TO CHANGE THE ANSWER.
 *
 * Measured on the owner's own sites (re-measured here 2026-08-12 against the published boundaries,
 * which is why this module exists rather than a comment):
 *   • Goose Creek, southern parcel `e1454746tcmstb` — **13 of 24 vertices (54%)** land inside
 *     Baytown's full-purpose polygons; the parcel is **96.7% inside them BY AREA**.
 *   • Grand Port, parcel `e1454605dvngtd` — **32 of 46 vertices (70%)** inside Baytown's
 *     limited-purpose annexation; **99.1% BY AREA**.
 * A vertex census measures how the SURVEYOR distributed vertices; it does not measure land. On a
 * ring whose vertices cluster along one basin edge it is not even a biased estimate — it is a
 * different quantity.
 *
 * THREE RULES THIS MODULE ENFORCES, all of them from the same 2026-08-12 measurement:
 *
 *  1. **HOLES ARE PART OF THE POLYGON.** Baytown's main body (OID 1368) carries **18 interior
 *     rings** — unincorporated islands inside the city. A containment test that reads only the
 *     outer ring reports land as in-city that is not. `esriPolygons` splits ESRI's flat `rings`
 *     array into outer/hole by orientation (ESRI publishes outers clockwise, holes
 *     counter-clockwise) and nests each hole under the outer that contains it; every area and
 *     every point test below subtracts them.
 *
 *  2. **THE TOLERANCE TRAVELS WITH THE ANSWER.** A share computed from geometry the server
 *     generalised is a claim about a smoothed boundary, not about the boundary. Every result
 *     carries the `toleranceM` it was computed at, and `shareConfidence` REFUSES to state a share
 *     once the smear could move it by more than `SHARE_MAX_UNCERTAINTY` — a bound computed from
 *     the geometry itself (see that function; the test is on the SHARE, not on a distance, and the
 *     first draft got that wrong in a way that refused exactly the split sites this item is about).
 *     The app asks for the boundary AS PUBLISHED, so in practice `toleranceM` is 0 and the guard is
 *     the thing that keeps a future generalised source honest.
 *
 *  3. **THE SUBJECT IS DISSOLVED FIRST.** The owner's Goose Creek plan carries seventeen active
 *     parcel records over the same ground — historic splits and duplicates that overlap. A share
 *     summed parcel by parcel double-counts that overlap: those records total **717.3 acres** and
 *     dissolve to **296.4 acres** of real land (Grand Port: five records, 414.8 acres, dissolving
 *     to 107.2). The whole-site share is therefore computed against the UNION of the active rings,
 *     the same dissolved footprint `siteAnalysis` screens against; per-parcel shares are reported
 *     separately and are never summed into it.
 *
 * Pure: no network, no DOM, no Leaflet. Geometry in lon/lat, projected to local metres about a
 * stated reference point (a site is a few km across, so a local equirectangular projection is
 * exact to well under the tolerances anything here reports).
 * ═══════════════════════════════════════════════════════════════════════════════════════════════ */

import ClipperLib from "clipper-lib";

/* Clipper is an INTEGER engine. Metres × 1000 = millimetres, which is four orders of magnitude
 * finer than any published boundary and still far inside the 2^53 integer range for a site. */
const SCALE = 1000;
export const SQM_PER_ACRE = 4046.8564224;

/* WGS84 metres per degree at a latitude (Snyder's series). Used only to project a few km of
 * ground into a local plane — never for a coordinate transform anything is stored in. */
export function metresPerDegree(lat) {
  const p = (lat * Math.PI) / 180;
  return {
    lat: 111132.92 - 559.82 * Math.cos(2 * p) + 1.175 * Math.cos(4 * p) - 0.0023 * Math.cos(6 * p),
    lon: 111412.84 * Math.cos(p) - 93.5 * Math.cos(3 * p) + 0.118 * Math.cos(5 * p),
  };
}

/* Project a lon/lat ring into local metres about `ref` ([lon, lat]). */
export function toLocal(ring, ref) {
  const m = metresPerDegree(ref[1]);
  return ring.map(([lon, lat]) => [(lon - ref[0]) * m.lon, (lat - ref[1]) * m.lat]);
}

// Signed shoelace area of a ring, in the ring's own units. Positive = counter-clockwise.
export function signedArea(ring) {
  let a = 0;
  for (let i = 0; i < ring.length; i++) {
    const [x1, y1] = ring[i], [x2, y2] = ring[(i + 1) % ring.length];
    a += x1 * y2 - x2 * y1;
  }
  return a / 2;
}

// Even-odd point-in-ring. `ring` is [[x, y], …] in any consistent frame.
export function pointInRing([px, py], ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if ((yi > py) !== (yj > py) && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/* ⛔ RULE 1 — ESRI's `rings` is a FLAT array of outers AND holes, distinguished only by winding.
 * Returns [{ outer, holes: [] }, …]. A hole whose containing outer cannot be identified is kept
 * against the largest outer that contains its first vertex; one that is inside nothing is dropped
 * (a malformed publish) rather than silently promoted to land. */
export function esriPolygons(geometry) {
  const rings = (geometry && geometry.rings) || [];
  const outers = [], holes = [];
  for (const r of rings) {
    if (!r || r.length < 3) continue;
    (signedArea(r) < 0 ? outers : holes).push(r);
  }
  const polys = outers.map((outer) => ({ outer, holes: [] }));
  for (const h of holes) {
    let best = null, bestArea = Infinity;
    for (const p of polys) {
      if (!pointInRing(h[0], p.outer)) continue;
      const a = Math.abs(signedArea(p.outer));
      if (a < bestArea) { best = p; bestArea = a; }
    }
    if (best) best.holes.push(h);
  }
  /* A layer that publishes everything counter-clockwise (no outer found at all) would otherwise
   * report zero area for every feature. Treat the rings as outers rather than as holes — a
   * silent zero is the one answer that reads as a confident "not in this jurisdiction". */
  if (!polys.length && holes.length) return holes.map((outer) => ({ outer, holes: [] }));
  return polys;
}

// A ring list (the app's own parcels) → the same polygon shape, each ring its own outer.
export const ringsAsPolygons = (rings) => (rings || []).filter((r) => r && r.length >= 3).map((outer) => ({ outer, holes: [] }));

/* Area of a polygon set in square metres, holes subtracted. `ref` anchors the projection. */
export function polygonAreaSqM(polys, ref) {
  let a = 0;
  for (const p of polys || []) {
    a += Math.abs(signedArea(toLocal(p.outer, ref)));
    for (const h of p.holes || []) a -= Math.abs(signedArea(toLocal(h, ref)));
  }
  return Math.max(0, a);
}

// ---- clipper plumbing -------------------------------------------------------------------------
const toPath = (ring, ref) => toLocal(ring, ref).map(([x, y]) => ({ X: Math.round(x * SCALE), Y: Math.round(y * SCALE) }));
const pathsArea = (paths) => {
  let a = 0;
  for (const path of paths) a += ClipperLib.Clipper.Area(path);
  return Math.abs(a) / (SCALE * SCALE);
};

/* ⛔ EACH POLYGON IS RESOLVED ON ITS OWN BEFORE ANY UNION, and the fill rules are not
 * interchangeable. A polygon's own holes are an EVEN-ODD fact (outer minus holes); a set of
 * polygons that OVERLAP is a NON-ZERO one. Resolving the whole set even-odd is the trap: the
 * owner's Grand Port plan carries the same 100-acre parcel THREE times (historic duplicates), and
 * even-odd cancels an odd overlap to nothing — it measured his 207-acre site at 0.0 acres. So:
 * per-polygon difference (even-odd) first, then one non-zero union of the results, whose
 * orientation clipper itself has already made consistent. */
export function normalizePolys(polys, ref) {
  const parts = [];
  for (const p of polys || []) {
    if (!p || !p.outer || p.outer.length < 3) continue;
    if (!(p.holes || []).length) { parts.push([toPath(p.outer, ref)]); continue; }
    const c = new ClipperLib.Clipper();
    c.AddPath(toPath(p.outer, ref), ClipperLib.PolyType.ptSubject, true);
    for (const h of p.holes) c.AddPath(toPath(h, ref), ClipperLib.PolyType.ptClip, true);
    const out = new ClipperLib.Paths();
    c.Execute(ClipperLib.ClipType.ctDifference, out, ClipperLib.PolyFillType.pftEvenOdd, ClipperLib.PolyFillType.pftEvenOdd);
    parts.push(out);
  }
  if (!parts.length) return new ClipperLib.Paths();
  const u = new ClipperLib.Clipper();
  for (const set of parts) u.AddPaths(set, ClipperLib.PolyType.ptSubject, true);
  const merged = new ClipperLib.Paths();
  u.Execute(ClipperLib.ClipType.ctUnion, merged, ClipperLib.PolyFillType.pftNonZero, ClipperLib.PolyFillType.pftNonZero);
  return merged;
}

/* The UNION of a polygon set, as an area in square metres. This is the dissolved-footprint
 * primitive rule 3 needs — a site whose parcel records overlap must not be measured by summing
 * them. */
export function unionAreaSqM(polys, ref) {
  if (!polys || !polys.length) return 0;
  return pathsArea(normalizePolys(polys, ref));
}

/* Area (m²) of subject ∩ clip. Both sides are dissolved first, so overlapping subject parcels and
 * a jurisdiction published as several adjacent polygons both measure once. */
export function intersectionAreaSqM(subject, clipPolys, ref) {
  if (!subject || !subject.length || !clipPolys || !clipPolys.length) return 0;
  const clip = new ClipperLib.Clipper();
  clip.AddPaths(normalizePolys(subject, ref), ClipperLib.PolyType.ptSubject, true);
  clip.AddPaths(normalizePolys(clipPolys, ref), ClipperLib.PolyType.ptClip, true);
  const out = new ClipperLib.Paths();
  clip.Execute(ClipperLib.ClipType.ctIntersection, out, ClipperLib.PolyFillType.pftNonZero, ClipperLib.PolyFillType.pftNonZero);
  return pathsArea(out);
}

/* Shortest distance (metres) from any subject vertex to any boundary segment of the clip set.
 * This is the quantity rule 2 weighs the tolerance against: a smear of ±T can only change the
 * answer where the boundary is within T of the land being measured. */
const segsOf = (polys, ref) => {
  const segs = [];
  for (const p of polys || []) for (const r of [p.outer, ...(p.holes || [])]) {
    if (!r || r.length < 2) continue;
    const l = toLocal(r, ref);
    for (let i = 0; i < l.length; i++) segs.push([l[i], l[(i + 1) % l.length]]);
  }
  return segs;
};
const ptSegDist = (v, a, b) => {
  const dx = b[0] - a[0], dy = b[1] - a[1], l2 = dx * dx + dy * dy;
  let t = l2 ? ((v[0] - a[0]) * dx + (v[1] - a[1]) * dy) / l2 : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(v[0] - (a[0] + t * dx), v[1] - (a[1] + t * dy));
};
/* ⛔ SEGMENT TO SEGMENT, NOT VERTEX TO SEGMENT. A vertex-only sweep is not a distance between two
 * boundaries: where the OTHER side's vertex is the nearest point (a boundary corner poking at a
 * long straight lot line — exactly the shape of a strip annexation beside a rectangular tract) it
 * reports a distance that can be several times the real one. A fixture asserting "the nearest
 * limited-purpose polygon is ~37 m away, and does NOT touch" is only a fixture if that number is
 * the real gap, so both directions are swept. */
const segSegDist = (p1, p2, q1, q2) =>
  Math.min(ptSegDist(p1, q1, q2), ptSegDist(p2, q1, q2), ptSegDist(q1, p1, p2), ptSegDist(q2, p1, p2));

export function distanceToBoundaryM(subject, clipPolys, ref) {
  const A = segsOf(subject, ref), B = segsOf(clipPolys, ref);
  if (!A.length || !B.length) return Infinity;
  let best = Infinity;
  for (const [a1, a2] of A) {
    const axmin = Math.min(a1[0], a2[0]), axmax = Math.max(a1[0], a2[0]);
    const aymin = Math.min(a1[1], a2[1]), aymax = Math.max(a1[1], a2[1]);
    for (const [b1, b2] of B) {
      // bbox reject: if the boxes are already further apart than the best, the segments are too
      const dx = Math.max(0, Math.max(axmin - Math.max(b1[0], b2[0]), Math.min(b1[0], b2[0]) - axmax));
      const dy = Math.max(0, Math.max(aymin - Math.max(b1[1], b2[1]), Math.min(b1[1], b2[1]) - aymax));
      if (Math.hypot(dx, dy) >= best) continue;
      const d = segSegDist(a1, a2, b1, b2);
      if (d < best) best = d;
    }
  }
  return best;
}

/* Total length (m) of clip boundary running within `band` metres of the subject — the only part
 * of the boundary a generalisation of that size could move across the land being measured. */
export function boundaryLengthNearM(subject, clipPolys, ref, band) {
  const A = segsOf(subject, ref), B = segsOf(clipPolys, ref);
  if (!A.length || !B.length) return 0;
  let len = 0;
  for (const [b1, b2] of B) {
    const l = Math.hypot(b2[0] - b1[0], b2[1] - b1[1]);
    if (!l) continue;
    let near = false;
    for (const [a1, a2] of A) { if (segSegDist(a1, a2, b1, b2) <= band) { near = true; break; } }
    if (near) len += l;
  }
  return len;
}

/* ⛔ RULE 2 — WHEN A SHARE MAY BE STATED, and the test is on the SHARE, not on a distance.
 *
 * `toleranceM` is what the geometry was generalised at (0 = as published). The first draft of this
 * refused whenever the tolerance was a tenth of the DISTANCE to the boundary, which is wrong in
 * the commonest case of all: a boundary that runs THROUGH the site has distance zero, so that rule
 * refused every split site — the ones this whole item is about — while passing sites nowhere near
 * a line, where a share is trivially 0 or 1 and nobody needed a guard.
 *
 * The honest bound is the one the geometry gives: a smear of ±T can only move the boundary across
 * a band of area T × L, where L is the length of that boundary running near the land. So the share
 * is uncertain by at most T·L / A, and that is what is compared against — a number in the same
 * units as the answer it qualifies. Exact geometry (T = 0) is always confident, by construction. */
export const SHARE_MAX_UNCERTAINTY = 0.02;
export function shareConfidence(toleranceM, boundaryLenM, areaSqM, max = SHARE_MAX_UNCERTAINTY) {
  const t = Number(toleranceM) || 0;
  if (t <= 0) return { confident: true, uncertainty: 0, reason: null };
  if (!(areaSqM > 0)) return { confident: true, uncertainty: 0, reason: null };
  const u = (t * (Number(boundaryLenM) || 0)) / areaSqM;
  if (u > max) {
    return {
      confident: false,
      uncertainty: u,
      reason: `boundary generalised to ${t} m; across the ${Math.round(boundaryLenM)} m of it that runs by this land that is ±${(u * 100).toFixed(1)}% of the share — more than the ${(max * 100).toFixed(0)}% this may be stated to`,
    };
  }
  return { confident: true, uncertainty: u, reason: null };
}

/* THE ANSWER. `subject` and `clipPolys` are polygon sets ({outer, holes}); `ref` is the lon/lat
 * the projection is anchored at (the site origin). Returns the share plus every fact behind it,
 * so nothing downstream has to re-derive one — including the refusal, which is a state, never a
 * silent zero. */
export function areaShare(subject, clipPolys, ref, opts = {}) {
  const toleranceM = Number(opts.toleranceM) || 0;
  const totalSqM = opts.totalSqM != null ? opts.totalSqM : unionAreaSqM(subject, ref);
  const insideSqM = intersectionAreaSqM(subject, clipPolys, ref);
  const distanceM = opts.skipDistance ? Infinity : distanceToBoundaryM(subject, clipPolys, ref);
  const nearLenM = toleranceM > 0 ? boundaryLengthNearM(subject, clipPolys, ref, Math.max(toleranceM, 1)) : 0;
  const conf = shareConfidence(toleranceM, nearLenM, totalSqM, opts.maxUncertainty);
  const share = totalSqM > 0 ? Math.min(1, insideSqM / totalSqM) : 0;
  return {
    share: conf.confident ? share : null,
    rawShare: share,
    insideSqM, totalSqM,
    insideAcres: insideSqM / SQM_PER_ACRE,
    totalAcres: totalSqM / SQM_PER_ACRE,
    toleranceM, distanceM, nearLenM,
    uncertainty: conf.uncertainty,
    confident: conf.confident,
    refusedReason: conf.reason,
  };
}

/* Point containment against a polygon set, holes honoured — the fixture case rule 1 exists for
 * (a point inside one of Baytown's 18 interior rings is NOT in the city). */
export function pointInPolygons(pt, polys) {
  for (const p of polys || []) {
    if (!pointInRing(pt, p.outer)) continue;
    if ((p.holes || []).some((h) => pointInRing(pt, h))) continue;
    return true;
  }
  return false;
}

/* ⛔ THE Y-SIGN, TAKEN FROM THE DATA RATHER THAN FROM AN ASSUMPTION. The planner's feet frame is
 * SCREEN-DOWN-POSITIVE (`mapLock.feetToLatLngPair` subtracts y from the reference Mercator
 * ordinate), so a LARGER y is further SOUTH. Getting this backwards silently mirrors every site
 * north-to-south and therefore flips every jurisdiction answer on it, with no error anywhere. It
 * is asserted from a real conversion rather than restated as a comment: `southIsLargerY` converts
 * two points through the app's own projection and reports which way round it came out. */
export function southIsLargerY(project) {
  const north = project({ x: 0, y: -1000 });
  const south = project({ x: 0, y: 1000 });
  return { southIsLargerY: south[0] < north[0], latAtLargeY: south[0], latAtSmallY: north[0] };
}
