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
