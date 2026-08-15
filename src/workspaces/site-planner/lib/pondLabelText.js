// NEW-1 — the pond MAP label's area text. One tiny pure module, because the owner's rule about
// what that label says needs somewhere it can be ASSERTED rather than grepped.
//
// WHAT CHANGED, AND WHY IT IS A REVERSAL
// --------------------------------------
// The pond label used to read, on two lines:
//
//     Detention Pond
//     footprint 6.58 ac · 286,648 sf
//
// The second line was authored under PR-Q/O4's "no bare acreage on a pond map label" rule: the
// word "footprint" said WHICH area the number measured (the drawn outer-toe outline, not the
// water surface), and the square footage rode along beside it. The owner has now overruled that
// for the MAP LABEL specifically (2026-08-06, verbatim: "get rid of footprint and get rid of
// square feet, leave the acreage"). So the line is now just:
//
//     Detention Pond
//     6.58 ac
//
// The disambiguation O4 was protecting is not lost, it moved: the pond's NOUN sits on the line
// directly above ("Detention Pond" / "Mitigation Pond" / "Existing Detention Pond"), the parcel
// badge still reads "Parcel 15.35 ac" so a big parcel acreage can never be mistaken for a pond's,
// and the pond INSPECTOR still spells out Water area / Berm ring / Land take in full. O4's rule
// therefore still holds everywhere it was actually load-bearing — the panel headers and the parcel
// chip — and is deliberately NOT applied to this one line. Do not "restore" it without the owner.
//
// A knock-on the fit ladder cares about: this line is now a single ATOM, so it has no `stacked`
// or `abbrev` rung of its own (there is nothing to break onto two lines and nothing to drop).
// That is fine and expected — the ladder's reflow rungs stay reachable for the pond's "Holds …
// ac-ft usable · …′ rim to floor" line and for any other multi-part line — but it means a pond
// label that used to reflow now simply FITS, which is the whole point of the trim.
//
// Pure + dependency-free so the unit test drives the real builder, and so the canvas and the
// exported sheet cannot drift (PDF-PARITY: both go through the one `labelCands` build that calls
// these, and there is no second copy of the string to fall out of step).

const SQFT_PER_ACRE = 43560;

// Match SitePlanner's `f2` exactly — 2dp, locale-grouped. Kept local (like every other lib here)
// rather than reaching back into the component.
const f2 = (n) => (Math.round(n * 100) / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** The pond's area line: acreage only. `sf` is the drawn footprint area in square feet. */
export const pondAreaLabelLine = (sf) => `${f2((Number(sf) || 0) / SQFT_PER_ACRE)} AC`;

/**
 * The expansion-mode increment line (B139/B157): how much ground a pond gained or lost against
 * its baseline. Same trim as above — acreage only, no "footprint", no square feet — because it is
 * a line of the SAME label and leaving the old construction on it would read as an oversight.
 * Uses a true minus sign (−), matching the rest of the planner's numeric chrome.
 */
export const pondAreaDeltaLine = (deltaSf) => {
  const n = Number(deltaSf) || 0;
  return `${n >= 0 ? "+" : "−"}${f2(Math.abs(n) / SQFT_PER_ACRE)} AC`;
};
