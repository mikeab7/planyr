/* NEW-1 (parcel properties unreachable, 2026-10-14) — WHICH LOT A DOUBLE-CLICK ON EMPTY LAND IS ABOUT.
 *
 * A parcel is grabbable only by its boundary line (B420): its interior is pointer-inert so a press inside
 * a lot reaches whatever is drawn there, or pans the map. That is right for a single click, and it is why
 * the owner's "if I double-click the parcel it doesn't really do anything" was literally true — a
 * double-click inside a lot resolved to nothing at all. So the canvas root asks THIS only when the hit
 * stack holds no feature: the smallest live lot containing the point (a split child over its parent, a
 * small lot drawn inside a big one). A single click is untouched.
 *
 * Pure: parcels in, an id (or null) out. `skip` is a Set of ids that must never answer (superseded split
 * parents, hidden content). */
import { pointInRing } from "./ringMath.js";

const ringArea = (pts) => {
  let a = 0;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) a += (pts[j].x + pts[i].x) * (pts[j].y - pts[i].y);
  return Math.abs(a / 2);
};

export function parcelAtPoint(parcels, pt, { skip } = {}) {
  if (!Array.isArray(parcels) || !pt || !Number.isFinite(pt.x) || !Number.isFinite(pt.y)) return null;
  let best = null, bestA = Infinity;
  for (const pc of parcels) {
    if (!pc || !Array.isArray(pc.points) || pc.points.length < 3) continue;
    if (skip && skip.has(pc.id)) continue;
    if (!pointInRing(pt, pc.points)) continue;
    const a = ringArea(pc.points);
    if (a < bestA) { best = pc.id; bestA = a; }
  }
  return best;
}
