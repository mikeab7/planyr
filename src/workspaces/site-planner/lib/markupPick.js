// markupPick.js — pure hit-testing + z-stack cycling for Site Planner markups (B920 / B921).
//
// The Site Planner picks markups SVG-natively (the browser's hit-testing over DOM paint order +
// each node's `pointerEvents`), which the shared imperative picker (src/shared/markup/hitTest.js)
// deliberately does NOT own for this surface — see its header note. Two things still need the
// stack in PURE JS, independent of the DOM, and this sibling of measureHit.js (B910) provides them:
//
//   • B920 / NEW-1 — the ONE fill-and-lock-aware rule the DOM render also follows: a CLOSED markup
//     grabs by its whole INTERIOR when it is FILLED (fillOpacity > 0 or a hatch is visible), OR
//     simply UNLOCKED — the ordinary case (draw a shape, click inside it to select it, exactly like
//     every other drawing tool). Only a LOCKED + unfilled shape keeps the original B920 stroke-only
//     grab: locking is the explicit signal a shape is a passive backdrop reference, and the reported
//     case was exactly that — a locked, whole-site invisible boundary that must not blanket clicks on
//     the roads under it (2026-07-21). A freshly drawn, unlocked polygon is not that case, and B920's
//     fix had made it unselectable by interior click too (2026-09-07 owner report). The canvas render
//     sets pointerEvents "all" vs "stroke" off the very same rule, so the declarative hit area and
//     this predicate agree by construction.
//   • B921 / NEW-2 — repeat-click / Alt-click must CYCLE down through every markup under the pointer
//     so a covered shape is always reachable. Smaller-area-first (a small markup on a big one wins,
//     matching the shared picker's B374 rule), array index breaks ties so the cycle is stable.
//
// All geometry is in WORLD FEET; the caller passes a feet-space tolerance (screen px ÷ pixels-per-
// foot), so the grab feel is identical at every zoom. Pure + Node-testable (test/markupPick.test.js).

import { pointInRing, ringArea } from "./ringMath.js";

const hyp = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const DEG = Math.PI / 180;
// NEW-1 (2026-09-07) — see the header note above: filled, OR unlocked, grabs by the whole body.
const grabsWholeBody = (m) => (m.fillOpacity || 0) > 0 || (!!m.hatch && m.hatch !== "none") || !m.locked;

// Ring area magnitude (feet²) — used only to RANK overlapping hits, so the sign is dropped.
// One implementation, in ringMath.js; re-exported because callers and tests import it here.
export { ringArea };

// Point-in-ring by ray casting — the ONE implementation, in ringMath.js (the canvas reads the
// same one). Re-exported because callers and tests import it from here.
export { pointInRing };

// Shortest distance from p to any segment of an OPEN polyline (Infinity for < 2 points).
export function distToPolyline(p, pts) {
  if (!pts || pts.length < 2) return Infinity;
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

// Shortest distance from p to a CLOSED ring's outline (includes the closing edge).
export function distToRing(p, ring) {
  return (!ring || ring.length < 2) ? Infinity : distToPolyline(p, [...ring, ring[0]]);
}

// The four rotated corners (feet) of a box markup ({ cx, cy, w, h, rot° }).
export function boxCorners(m) {
  const cx = m.cx, cy = m.cy, hw = (m.w || 0) / 2, hh = (m.h || 0) / 2;
  const cos = Math.cos((m.rot || 0) * DEG), sin = Math.sin((m.rot || 0) * DEG);
  const corner = (dx, dy) => ({ x: cx + dx * cos - dy * sin, y: cy + dx * sin + dy * cos });
  return [corner(-hw, -hh), corner(hw, -hh), corner(hw, hh), corner(-hw, hh)];
}

// An ellipse markup sampled to a ring, so point-in / stroke-distance reuse the polygon path.
export function ellipseRing(m, seg = 48) {
  const cx = m.cx, cy = m.cy, rx = (m.w || 0) / 2, ry = (m.h || 0) / 2;
  const cos = Math.cos((m.rot || 0) * DEG), sin = Math.sin((m.rot || 0) * DEG);
  const out = [];
  for (let i = 0; i < seg; i++) {
    const a = (i / seg) * Math.PI * 2, lx = rx * Math.cos(a), ly = ry * Math.sin(a);
    out.push({ x: cx + lx * cos - ly * sin, y: cy + lx * sin + ly * cos });
  }
  return out;
}

// A markup's clickable geometry + whether its BODY captures (the B920 rule in ONE place, so the
// DOM render and this picker never diverge): { ring, path, closed, filled, area } | null.
//   - polygon/rect/ellipse — closed; `filled` follows the shared visible-fill rule (B920).
//   - line/polyline — open paths (stroke hit only), area 0.
//   - encumbrance/easement — semantic markups whose bodies already grab in the DOM
//     (pattern fill / pointerEvents "all"), so they are always `filled`.
export function markupHitModel(m) {
  if (!m) return null;
  switch (m.kind) {
    case "line": return { path: [m.a, m.b], closed: false, filled: false, area: 0 };
    case "polyline": return { path: m.pts || [], closed: false, filled: false, area: 0 };
    case "polygon":
    case "cloud": return { ring: m.pts || [], closed: true, filled: grabsWholeBody(m), area: ringArea(m.pts || []) };
    case "rect": return { ring: boxCorners(m), closed: true, filled: grabsWholeBody(m), area: Math.abs((m.w || 0) * (m.h || 0)) };
    case "ellipse": return { ring: ellipseRing(m), closed: true, filled: grabsWholeBody(m), area: Math.abs(Math.PI * (m.w || 0) * (m.h || 0) / 4) };
    case "encumbrance":
    case "easement": return { ring: m.pts || [], closed: true, filled: true, area: ringArea(m.pts || []) };
    default: return null;
  }
}

// Sum of consecutive segment lengths (feet) — the open-path twin of `ringPerimeter` below.
function polylineLength(pts) {
  if (!pts || pts.length < 2) return 0;
  let L = 0;
  for (let i = 1; i < pts.length; i++) L += hyp(pts[i - 1], pts[i]);
  return L;
}

// Perimeter (feet) of a closed ring, including the closing edge back to the first vertex.
function ringPerimeter(ring) {
  if (!ring || ring.length < 2) return 0;
  let L = 0;
  for (let i = 0; i < ring.length; i++) L += hyp(ring[i], ring[(i + 1) % ring.length]);
  return L;
}

// NEW-3 — a closed markup's user-facing SIZE: area (feet²) + perimeter (feet). Reads off the SAME
// ring `markupHitModel` already builds for hit-testing (m.pts for polygon/cloud, the rotated
// corners for rect, the sampled boundary for ellipse) — never a second geometry derivation, so this
// can't disagree with what's drawn or with what the hit test already ranks by. Returns null for a
// kind with no closed interior (an open path, or a kind not offered this readout).
export function closedMarkupSize(m) {
  const g = markupHitModel(m);
  if (!g || !g.closed || !g.ring || g.ring.length < 2) return null;
  return { area: g.area, perimeter: ringPerimeter(g.ring) };
}

// NEW-3 — an open markup's user-facing LENGTH (feet), off the SAME path the renderer draws
// (m.a/m.b for a line, m.pts for a polyline). Returns null for a closed kind.
export function openMarkupLength(m) {
  const g = markupHitModel(m);
  if (!g || g.closed) return null;
  return polylineLength(g.path);
}

// Does feet-point `p` land on markup `m` within `tol` feet? Returns { area } (the ranking key) or
// null. Honours the B920 rule: an unfilled closed shape hits on its stroke only, never its interior.
export function markupUnderPoint(m, p, tol) {
  const g = markupHitModel(m);
  if (!g) return null;
  if (g.closed) {
    const ring = g.ring;
    if (!ring || ring.length < 3) return null;
    if (g.filled) {
      if (pointInRing(p, ring) || distToRing(p, ring) <= tol) return { area: g.area };
    } else if (distToRing(p, ring) <= tol) {
      return { area: g.area }; // B920: unfilled → stroke + tolerance only
    }
    return null;
  }
  const path = g.path;
  return (path && path.length >= 2 && distToPolyline(p, path) <= tol) ? { area: 0 } : null;
}

// The ids of every markup under `p`, ordered smaller-area-first (array index breaks a tie), so a
// small shape stacked on a big one is reached first and the cycle is stable across repeated clicks.
export function markupsUnderPoint(markups, p, tol) {
  const hits = [];
  (markups || []).forEach((m, i) => {
    if (!m || m.id == null) return;
    const h = markupUnderPoint(m, p, tol);
    if (h) hits.push({ id: m.id, area: h.area, i });
  });
  hits.sort((a, b) => a.area - b.area || a.i - b.i);
  return hits.map((h) => h.id);
}

// Given the ordered under-point stack and the currently-selected id, the NEXT id to select: the
// smallest-area hit on a fresh pick, or the one underneath when the current selection is re-picked
// (wraps at the end). Returns null when nothing is under the point.
export function nextMarkupSelection(order, currentId) {
  if (!order || !order.length) return null;
  const at = order.indexOf(currentId);
  return at >= 0 ? order[(at + 1) % order.length] : order[0];
}
