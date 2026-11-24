/* The drainage check's INVALIDATION SIGNATURE — pure (audit batch G2 step 4, B2671311; moved verbatim out of SitePlanner.jsx).
 *
 * The drainage facts (jurisdiction, flood, soils, terrain) are fetched once on request; the answer stays valid while the checked geometry
 * does not change. This string changes whenever it does: parcel COUNT + area, a coarse centroid in feet, the georef origin (so a pure
 * TRANSLATION across a jurisdiction line also invalidates it), and the coarse envelope of the fill/pond elements that DEFINE the flood-fetch
 * envelope (B712). The coarse rounding (50 ft) is deliberate: a nudge never re-prompts, a real move always does.
 * Pure on purpose: no React, no DOM, no fetch. `test/drainageSignature.test.js` pins it against the pre-move inline implementation. */
import { FM_FILL_TYPES } from "./floodFootprintMemo.js";
import { ringOf } from "./siteGeometry.js";

/** Mean of every active parcel vertex, as [x, y] feet ([0, 0] when there is none). */
export function drainCentroidOf(active) {
  return active.length
    ? active.flatMap((p) => p.points).reduce((s, pt, _i, arr) => [s[0] + pt.x / arr.length, s[1] + pt.y / arr.length], [0, 0])
    : [0, 0];
}

/** Coarse envelope of the fill / pond elements: "<count>@<minX>,<minY>,<maxX>,<maxY>" in 50-ft cells. */
export function drainElsSignature(els) {
  let n = 0, minX = 0, minY = 0, maxX = 0, maxY = 0, first = true;
  for (const e of els) {
    if (!FM_FILL_TYPES.has(e.type) && e.type !== "pond") continue;
    let r; try { r = ringOf(e); } catch (_) { continue; }
    if (!r || r.length < 3) continue;
    n++;
    for (const pt of r) {
      if (first) { minX = maxX = pt.x; minY = maxY = pt.y; first = false; continue; }
      if (pt.x < minX) minX = pt.x; if (pt.x > maxX) maxX = pt.x;
      if (pt.y < minY) minY = pt.y; if (pt.y > maxY) maxY = pt.y;
    }
  }
  return n + "@" + [minX, minY, maxX, maxY].map((v) => Math.round(v / 50)).join(",");
}

/** The whole signature the planner compares against the one stored with a check. */
export function drainSignature({ activeCount, siteSqft, centroid, origin, elsSig }) {
  return activeCount + ":" + Math.round(siteSqft) + ":" +
    Math.round(centroid[0] / 50) + "," + Math.round(centroid[1] / 50) + ":" +
    (origin ? `${origin.lat.toFixed(4)},${origin.lon.toFixed(4)}` : "nogeo") + ":" + elsSig;
}
