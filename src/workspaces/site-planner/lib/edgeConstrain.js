// edgeConstrain.js — pure helpers for the "start a measurement / line on a parcel boundary, then
// hold Shift to lock its direction RELATIVE to that boundary" behavior (NEW — perpendicular /
// parallel / 45° off the property line, the setback-measurement analogue of the page-absolute
// Shift lock). Bluebeam's Shift snaps to page 90°/45°; this snaps to the same increments but in
// the frame of the edge you started on, so "perpendicular to the property line" is one press.
//
// All geometry is in WORLD FEET. Kept pure + Node-testable (test/edgeConstrain.test.js); the
// SitePlanner canvas closes over these when a draw gesture begins on a parcel edge.

// Nearest point on segment [a,b] to p, with the parametric position t∈[0,1] and the distance.
export function projectToSegment(p, a, b) {
  const dx = b.x - a.x, dy = b.y - a.y, L2 = dx * dx + dy * dy;
  if (L2 === 0) return { pt: { x: a.x, y: a.y }, t: 0, dist: Math.hypot(p.x - a.x, p.y - a.y) };
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / L2;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const pt = { x: a.x + t * dx, y: a.y + t * dy };
  return { pt, t, dist: Math.hypot(p.x - pt.x, p.y - pt.y) };
}

/* NEW-2(d) — THE tolerance for that magnet, in WORLD FEET, from the live pixels-per-foot.
 *
 * A pure screen-pixel tolerance feels the same at every zoom, which is why it is the right
 * primary. But it is UNBOUNDED in feet as you zoom out: 12 px is a couple of feet at a working
 * zoom and about 70 ft at the overview zoom real layout is done at — so the first point of a
 * measurement could be yanked tens of feet onto a nearby property line with nothing on screen
 * to say so. That is exactly the shape of the owner's report that a placed point lands "five,
 * ten, fifteen feet from where I'm actually clicking", and it is a far larger effect than the
 * one-pixel transform offset the same report also contains.
 *
 * So: screen tolerance, CAPPED in the world — the same idiom the road-connect magnet already
 * uses (`ROAD_CONNECT_MAX_FT`); the boundary magnet simply never got one. Holding Alt still
 * bypasses the snap entirely. The SPLIT tool's separate boundary snap is deliberately NOT
 * capped: a split has to land ON the line, so being pulled there is the intent, not a surprise.
 */
export const EDGE_LOCK_PX = 12;
export const EDGE_LOCK_MAX_FT = 10;
export const edgeLockTolFt = (ppf) => Math.min(EDGE_LOCK_PX / (Number(ppf) > 0 ? Number(ppf) : 1), EDGE_LOCK_MAX_FT);

// Find the closest parcel-boundary edge to `p` within `tolFt`. Returns the point projected ONTO
// that edge (so a measurement can literally begin on the property line) plus the edge's absolute
// direction angle (radians) — or null when no boundary is close enough. `parcels` are
// { points:[{x,y}…] } CLOSED rings, so every consecutive pair plus the closing pair is an edge.
export function nearestBoundaryEdge(p, parcels, tolFt) {
  let best = null;
  for (const pc of parcels || []) {
    const pts = pc && pc.points;
    if (!pts || pts.length < 2) continue;
    const n = pts.length;
    for (let i = 0; i < n; i++) {
      const a = pts[i], b = pts[(i + 1) % n];
      if (!a || !b) continue;
      const pr = projectToSegment(p, a, b);
      if (pr.dist <= tolFt && (!best || pr.dist < best.dist)) {
        best = { dist: pr.dist, pt: pr.pt, ang: Math.atan2(b.y - a.y, b.x - a.x), a, b, parcelId: pc.id };
      }
    }
  }
  return best;
}

// Constrain the segment anchor→cursor to the nearest `stepRad` multiple measured RELATIVE to
// `baseAng` (the anchor edge's direction). With stepRad = 45° this yields parallel (along the
// edge), perpendicular (90° off it — the setback case), and the four 45° diagonals. Only the
// direction is snapped; the distance from the anchor is preserved. A zero-length segment returns
// the anchor unchanged.
export function constrainToEdgeAngle(anchor, cursor, baseAng, stepRad = Math.PI / 4) {
  const dx = cursor.x - anchor.x, dy = cursor.y - anchor.y;
  const r = Math.hypot(dx, dy);
  if (r === 0) return { x: anchor.x, y: anchor.y };
  const rel = Math.atan2(dy, dx) - baseAng;
  const snapped = Math.round(rel / stepRad) * stepRad;
  const ang = baseAng + snapped;
  return { x: anchor.x + r * Math.cos(ang), y: anchor.y + r * Math.sin(ang) };
}
