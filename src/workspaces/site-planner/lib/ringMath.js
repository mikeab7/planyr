/* The ONE even-odd ray-cast point-in-ring test for `{x,y}` rings (feet space).
 *
 * This existed EIGHT times — SitePlanner.jsx twice (`pointInRing` and `ringHas`, thirty lines
 * apart), plus pondGeom, roadNetwork, footprintEdit, measureHit, markupPick and easements — as
 * the same loop with the same formula and only the local variable names moving around. Two of
 * the eight guarded a degenerate ring and six did not, which is the usual shape of a rule that
 * was copied rather than shared: the guard was added where a caller happened to hit it.
 *
 * Every one of those copies lives in the Site route's chunk, so the duplication was charged to
 * the route's download budget eight times over. Folding them is the B50008–B50011 branch's
 * bundle-budget payback, not a tidy-up — see docs/PERF-BUDGETS.md.
 *
 * The degenerate guard is the strictest of the two that had one (footprintEdit's), and it is a
 * superset of the behaviour the unguarded copies had for a real ring: a ring of 0, 1 or 2 points
 * ray-casts to `false` anyway (no crossing, or two crossings that cancel), so the guard changes
 * nothing for valid input and only replaces a throw on null with the answer the predicate already
 * gave for every other empty case.
 *
 * Leaf module ON PURPOSE: it imports nothing, so it can be shared by every module in the Site
 * chunk without dragging a heavier neighbour (pondGeom is 39 KB) into anyone's import graph.
 */
export function pointInRing(pt, ring) {
  if (!Array.isArray(ring) || ring.length < 3) return false;
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i].x, yi = ring[i].y, xj = ring[j].x, yj = ring[j].y;
    if (((yi > pt.y) !== (yj > pt.y)) && (pt.x < ((xj - xi) * (pt.y - yi)) / (yj - yi) + xi)) inside = !inside;
  }
  return inside;
}

/* Shoelace area MAGNITUDE (feet²) of a `{x,y}` ring — orientation-independent, so a ring wound
 * either way reports the same number and a hole never ranks negative.
 *
 * Four copies of this existed (measureHit, markupPick, easements, parcelOffset) in two algebraic
 * spellings — the cross-product shoelace and its trapezoid rearrangement — that agree exactly on
 * every ring either was given. Same story as pointInRing above: three guarded a degenerate ring
 * and one did not, and for a ring of fewer than three points the sum is zero anyway, so the guard
 * is the answer the loop already produced.
 *
 * ⛔ Not the same thing as `arcgis.js`'s `ringArea`, which takes `[x, y]` PAIRS and deliberately
 * returns a SIGNED area — winding is how that module tells an outer boundary from a hole. Leave
 * those two apart; folding them would silently drop the sign that ring selection depends on.
 */
export function ringArea(ring) {
  if (!Array.isArray(ring) || ring.length < 3) return 0;
  let a = 0;
  for (let i = 0; i < ring.length; i++) {
    const p = ring[i], q = ring[(i + 1) % ring.length];
    a += p.x * q.y - q.x * p.y;
  }
  return Math.abs(a) / 2;
}

/* Closest point on the FINITE segment a→b to `p` (feet space), clamped to the segment (never
 * extrapolated past either endpoint). Distinct from footprintEdit.js's `projectOntoLine`, which
 * projects onto an INFINITE line — a dock-wall corner is meant to slide arbitrarily far along its
 * wall, but a control point inserted between two existing ring vertices must never land outside
 * them.
 *
 * B872/NEW-5 — inserting a control point on an existing straight edge is geometrically a no-op
 * (same two flanking vertices, same line), but a caller that snaps the click point by rounding x
 * and y INDEPENDENTLY can nudge it a hair off that line: invisible on an axis-aligned edge, a small
 * kink — and a measurable polygon-area change — on an angled one (the snap grid isn't aligned to
 * the edge's bearing). Re-projecting the (already snapped) point through this puts it exactly back
 * on the edge, so the insert is a true no-op regardless of what the snap did to it.
 */
export function projectOntoSegment(a, b, p) {
  const dx = b.x - a.x, dy = b.y - a.y, L2 = dx * dx + dy * dy;
  if (L2 < 1e-9) return { x: a.x, y: a.y };
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / L2));
  return { x: a.x + dx * t, y: a.y + dy * t };
}
