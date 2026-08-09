/* A parcel's MEASURED AREA — the one derivation every acreage consumer reads.
 *
 * ⛔ SPLIT BY TIER, deliberately, and this is the `sheetFurniture.js` rule applied again: a module
 * imported by BOTH the boot path and a lazy chunk is hoisted whole into their common ancestor —
 * tree-shaking drops unused exports, never exports used by a sibling chunk. `polyClip.js` (boot
 * path — it is the site-area function) needs `parcelExceptSqft`, and the canvas badge and Boundary
 * section need `parcelNetSqft`. The parcel RECORD's vocabulary (provenance labels, the typed-field
 * list) is needed only by the lazily-loaded panel — so it lives in `parcelRecord.js`, and keeping
 * the two apart is what stops those strings riding the Site route's boot chunk.
 *
 * Pure. Unit-tested in test/parcelRecord.test.js.
 */
import { polyArea } from "./polygonSplit.js";

export const SQFT_PER_ACRE = 43560;

/* A typed acreage. Accepts "12.50", "12.5 ac", a bare number; anything that isn't a positive finite
 * number is null — never 0, which would read as "the record says zero acres". */
export function parseAcres(v) {
  if (v == null || v === "") return null;
  const n = Number(String(v).replace(/[^0-9.\-]/g, ""));
  return Number.isFinite(n) && n > 0 ? n : null;
}

/* Total area of the save-and-except carve-outs recorded on a parcel (NEW-2). `exceptions` is a list
 * of {pts, label} rings in the same feet frame as `points`. */
export function parcelExceptSqft(pc) {
  const ex = (pc && Array.isArray(pc.exceptions)) ? pc.exceptions : [];
  let sum = 0;
  for (const h of ex) {
    const ring = h && Array.isArray(h.pts) ? h.pts : Array.isArray(h) ? h : null;
    if (ring && ring.length >= 3) sum += Math.abs(polyArea(ring));
  }
  return sum;
}

export const parcelGrossSqft = (pc) =>
  (pc && Array.isArray(pc.points) && pc.points.length >= 3) ? Math.abs(polyArea(pc.points)) : 0;

/* MEASURED acreage — what the drawn geometry encloses, minus any save-and-except holes. THE number
 * every area consumer must use: the canvas badge, the parcel list, the Boundary section, the print
 * ledger, and `dissolvedParcelSqft`, off which every yield / coverage / detention figure is built. */
export function parcelNetSqft(pc) {
  if (!pc || !Array.isArray(pc.points) || pc.points.length < 3) return 0;
  return Math.max(0, parcelGrossSqft(pc) - parcelExceptSqft(pc));
}

/* The two acreages a parcel can quote, and whether they agree.
 *   measured — what the geometry encloses (net of exceptions)
 *   stated   — what the deed / county / the owner SAYS it is
 * Kept apart on purpose: a deed-called 12.50 and a drawn 12.43 are both true, and the difference is
 * information — collapsing them into one number is what this exists to prevent. `diffFrac` is null
 * when there is nothing to compare, so a missing stated acreage can never read as a match. */
export function acreageComparison(pc) {
  const measured = parcelNetSqft(pc) / SQFT_PER_ACRE;
  const stated = parseAcres(pc && pc.statedAcres);
  const diffFrac = stated && measured > 0 ? Math.abs(measured - stated) / stated : null;
  return {
    measured: measured > 0 ? measured : null,
    stated,
    diffFrac,
    // The same bands the county geometry check uses, so the two read as one idea.
    agreement: diffFrac == null ? null : diffFrac <= 0.02 ? "match" : diffFrac <= 0.05 ? "close" : "off",
  };
}
