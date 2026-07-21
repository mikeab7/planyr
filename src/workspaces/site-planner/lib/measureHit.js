// measureHit.js — pure hit-testing + z-order cycling for on-canvas measurements (B910 / NEW-1).
//
// A measurement is { mode: "line"|"polyline"|"area"|"count", pts: [{x,y}, …] } (legacy
// distance measures carry { a, b } instead of pts). All geometry is in WORLD FEET; the
// caller passes a feet-space tolerance (the on-screen hit padding divided by pixels-per-foot),
// so the same forgiving buffer holds at every zoom.
//
// These helpers exist so a click can (a) resolve WHICH measurement a point lands on with a
// smaller-area-wins tie-break — a tiny measurement stacked on a big one stays reachable — and
// (b) cycle the selection down through everything under a repeated click. Kept pure + Node-
// testable (test/measureHit.test.js); the SitePlanner canvas closes over them in selectMeasure.

const hyp = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

// Vertices of a measurement, tolerating the legacy {a,b} distance shape.
export const measPoints = (m) => (m && m.pts ? m.pts : (m && m.a && m.b ? [m.a, m.b] : []));
export const measModeOf = (m) => (m && m.mode) || "line";

// Ring area magnitude (feet²) — used only to rank overlapping hits, so sign is dropped.
export function ringArea(pts) {
  if (!pts || pts.length < 3) return 0;
  let s = 0;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) s += (pts[j].x + pts[i].x) * (pts[j].y - pts[i].y);
  return Math.abs(s) / 2;
}

// Point-in-ring by ray casting (matches the canvas's ringHas).
export function pointInRing(p, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const yi = ring[i].y, xi = ring[i].x, yj = ring[j].y, xj = ring[j].x;
    if (((yi > p.y) !== (yj > p.y)) && (p.x < ((xj - xi) * (p.y - yi)) / (yj - yi) + xi)) inside = !inside;
  }
  return inside;
}

// Shortest distance from p to any segment of a polyline (Infinity for < 2 points).
export function distToPolyline(p, pts) {
  let best = Infinity;
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i + 1];
    const dx = b.x - a.x, dy = b.y - a.y, L2 = dx * dx + dy * dy || 1;
    let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / L2;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    best = Math.min(best, hyp(p, { x: a.x + t * dx, y: a.y + t * dy }));
  }
  return best;
}

// Indices of every measurement whose geometry sits within `tol` feet of point `p`, ordered
// smaller-area-first (lines/counts have no area → 0 → they sort ahead of area measurements),
// ties broken by array index so the cycle is stable across repeated clicks.
export function measuresUnderPoint(measures, p, tol) {
  const hits = [];
  (measures || []).forEach((m, i) => {
    const mode = measModeOf(m), pts = measPoints(m);
    if (mode === "count") {
      if (pts.some((q) => hyp(p, q) <= tol)) hits.push({ i, area: 0 });
    } else if (mode === "area") {
      if (pts.length >= 3 && (pointInRing(p, pts) || distToPolyline(p, [...pts, pts[0]]) <= tol)) hits.push({ i, area: ringArea(pts) });
    } else {
      if (pts.length >= 2 && distToPolyline(p, pts) <= tol) hits.push({ i, area: 0 });
    }
  });
  hits.sort((a, b) => a.area - b.area || a.i - b.i);
  return hits.map((h) => h.i);
}

// Pick the next selection given the ordered hit list and the currently-selected index: the
// smallest-area hit on a fresh click, or the next one underneath when the current selection is
// re-clicked (wraps at the end). Returns null when nothing is under the point.
export function nextMeasureSelection(order, currentI) {
  if (!order || !order.length) return null;
  const at = order.indexOf(currentI);
  return at >= 0 ? order[(at + 1) % order.length] : order[0];
}
