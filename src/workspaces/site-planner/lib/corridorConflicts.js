/* NEW-11/B831 (pond-roles branch) — ponds/basins vs easement + pipeline corridors.
 *
 * Excavating a basin over a pipeline needs operator approval and can force a
 * relocation — easements already restrict buildings/paving, but ponds had no check.
 * Pure geometry: rings in planner feet (the caller reprojects the [lon,lat]
 * corridor bands with lngLatRingToFeet before calling). Overlaps are gross-of-
 * overlap (screening) via polyIntersectArea, with a bbox prefilter — corridor
 * strips are vertex-heavy and triangle∩triangle is O(n²).
 *
 * B826 seam (do NOT build yet): the proposed-surface cut/fill CELLS will reuse this
 * ring-based API for the same screen (cell rects in, same intersect) — keep the
 * signature ring-only so that lands without rework.
 */
import { polyIntersectArea } from "./polyClip.js";

const bboxOf = (ring) => {
  let mnX = Infinity, mnY = Infinity, mxX = -Infinity, mxY = -Infinity;
  for (const p of ring) { if (p.x < mnX) mnX = p.x; if (p.x > mxX) mxX = p.x; if (p.y < mnY) mnY = p.y; if (p.y > mxY) mxY = p.y; }
  return { mnX, mnY, mxX, mxY };
};
const bboxesTouch = (a, b) => a.mnX <= b.mxX && b.mnX <= a.mxX && a.mnY <= b.mxY && b.mnY <= a.mxY;

/* ponds: [{ id, ring }] · easements: [{ id, ring, label }] · corridorRings: [[{x,y},…]]
 * → [{ pondId, easementSf, corridorSf, totalSf, easementIds }] — only entries whose
 * total overlap clears minSf (a sliver isn't a finding). Pure. */
export function pondEncumbranceConflicts({ ponds = [], easements = [], corridorRings = [], minSf = 400 } = {}) {
  const eas = easements.filter((e) => e.ring && e.ring.length >= 3).map((e) => ({ ...e, bbox: bboxOf(e.ring) }));
  const cors = corridorRings.filter((r) => r && r.length >= 3).map((r) => ({ ring: r, bbox: bboxOf(r) }));
  const out = [];
  for (const p of ponds) {
    if (!p.ring || p.ring.length < 3) continue;
    const pb = bboxOf(p.ring);
    let easementSf = 0, corridorSf = 0;
    const easementIds = [];
    for (const e of eas) {
      if (!bboxesTouch(pb, e.bbox)) continue;
      const a = polyIntersectArea(p.ring, e.ring);
      if (a > 0) { easementSf += a; easementIds.push(e.id); }
    }
    for (const c of cors) {
      if (!bboxesTouch(pb, c.bbox)) continue;
      corridorSf += polyIntersectArea(p.ring, c.ring);
    }
    const totalSf = easementSf + corridorSf;
    if (totalSf >= minSf) out.push({ pondId: p.id, easementSf, corridorSf, totalSf, easementIds });
  }
  return out;
}
