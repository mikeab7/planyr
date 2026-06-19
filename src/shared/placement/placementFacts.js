/* Placement-readiness facts (B181 / NEW-2).
 *
 * At filing/index time the title-block read pass captures more than discipline, so the
 * later "Place on map" cascade (B182 / NEW-3) can pick its method WITHOUT reopening the
 * file. These are cheap to capture during the read pass that auto-filing already does.
 *
 * Pure data shape only — no detection logic lives here (that's the backend title-block
 * reader). This module defines the contract both sides agree on, plus tiny helpers so a
 * file that was filed before the backend existed still has a well-formed (all-absent)
 * facts object rather than `undefined` scattered through the cascade.
 */

/* The per-drawing facts. Every sub-fact carries `present` so "we looked and found none"
 * is distinct from "never captured" (captured:false) — the silent-failure rule applies
 * to placement just as it does to GIS layers. */
export function emptyPlacementFacts() {
  return {
    captured: false,                         // has the backend read this file yet?
    embeddedCoords: { present: false, crs: null },          // real-world coords in the file (GeoPDF / georef)
    scaleBar: { present: false, drawnLenPx: null, realLenFt: null }, // a graphic scale bar
    statedScale: { present: false, text: null, feetPerInch: null },  // title-block scale text ("1\"=100'")
    northArrow: { present: false, orientationDeg: null },   // north arrow + which way it points
    boundary: { present: false },            // a visible parcel/property boundary to fit to
    dimensions: [],                          // labeled dims: [{ valueFt, p1:{x,y}, p2:{x,y} }] (on-sheet endpoints)
  };
}

export const PLACEMENT_FLAG_KEYS = [
  "embeddedCoords", "scaleBar", "statedScale", "northArrow", "boundary", "dimensions",
];

/* Merge captured facts over the empty shape so a partial capture (or a legacy row with
 * no facts) is always a complete, safe object. Arrays replace; sub-objects shallow-merge. */
export function mergePlacementFacts(base, patch) {
  const out = base ? { ...base } : emptyPlacementFacts();
  if (!patch) return out;
  for (const k of Object.keys(patch)) {
    const v = patch[k];
    if (Array.isArray(v)) out[k] = v.slice();
    else if (v && typeof v === "object") out[k] = { ...(out[k] || {}), ...v };
    else out[k] = v;
  }
  return out;
}

/* The longest labeled dimension (resize-invariant baseline preference, NEW-3 rung 3:
 * "prefer the longest available baseline — a 2 ft error over a 240 ft face is <1%; over
 * a 24 ft bay it's 8%"). Returns the dimension with the greatest real-world value, or null. */
export function longestDimension(facts) {
  const dims = (facts && facts.dimensions) || [];
  let best = null;
  for (const d of dims) if (d && d.valueFt > 0 && (!best || d.valueFt > best.valueFt)) best = d;
  return best;
}
