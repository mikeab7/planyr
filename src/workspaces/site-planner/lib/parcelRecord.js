/* The parcel RECORD's VOCABULARY — where a boundary came from, and the facts you can type on it.
 *
 * A lot pulled from a county identify arrives with an appraisal record: owner, account number, situs
 * address, stated acreage, the whole `attrs` blob. A lot the owner DREW — which is what you do when
 * the county service is down — arrived with geometry and nothing else, and there was no way to type
 * any of it in. Same for a lot promoted from a plotted deed. This module says what those fields are
 * and how honestly to label a boundary's origin.
 *
 * The rule the provenance exists to enforce: a plan that is later reviewed must never present a
 * hand-drawn boundary as though it came from the county. `parcelProvenance` answers that for every
 * parcel — including the ones already saved, which carry no `source` field at all.
 *
 * ⛔ THE AREA TIER IS DELIBERATELY NOT HERE — it lives in `parcelArea.js`, and the split is
 * load-bearing rather than tidiness. `polyClip.js` is on the boot path and needs `parcelExceptSqft`;
 * a module imported by BOTH the boot path and a lazy chunk is hoisted whole into their common
 * ancestor (tree-shaking drops unused exports, never exports used by a sibling chunk), so keeping
 * the vocabulary below in the same file would charge the Site route's boot chunk for every
 * provenance string and field label that only the lazily-loaded Parcel-record panel ever renders.
 * Re-exported at the foot so callers still have ONE name to reach for. Same rule as
 * `sheetFurniture.js` → `sheetFurnitureLayout.js`.
 *
 * Pure: no DOM, no React, no network. Unit-tested in test/parcelRecord.test.js.
 */

/* Where this boundary CAME FROM. `county` = a county GIS identify · `deed` = promoted from a
 * plotted metes-and-bounds description · `drawn` = digitized by hand. */
export const PARCEL_SOURCES = ["county", "deed", "drawn"];

/* The provenance of a parcel, including one saved before the field existed: a parcel carrying a
 * county appraisal record (`attrs`) or a county GIS key came from the county; anything else was
 * drawn. Never guesses `deed` — that is stamped only at promotion time (NEW-2), because a
 * deed-derived boundary is indistinguishable from a hand-drawn one after the fact. */
export function parcelProvenance(pc) {
  const s = pc && typeof pc.source === "string" ? pc.source : null;
  if (s && PARCEL_SOURCES.includes(s)) return s;
  return (pc && (pc.attrs || pc.gisKey)) ? "county" : "drawn";
}

/* How the provenance reads on screen. `short` rides the parcel row; `long` explains it. */
export const PROVENANCE_LABEL = {
  county: { short: "County record", long: "Boundary and details came from the county appraisal district." },
  deed: { short: "From deed", long: "Boundary plotted from a metes-and-bounds legal description, not from county mapping." },
  drawn: { short: "Drawn by hand", long: "Boundary digitized by hand — not a county record and not a survey." },
};
export const provenanceLabel = (pc) => PROVENANCE_LABEL[parcelProvenance(pc)] || PROVENANCE_LABEL.drawn;

/* The typed fields, in panel order. `county` marks the ones a county identify also fills, so the
 * panel can say when it is overriding a county value. */
export const PARCEL_FIELDS = [
  { key: "label", label: "Name", placeholder: "e.g. North tract", county: false },
  { key: "owner", label: "Owner", placeholder: "Owner of record", county: true },
  { key: "acct", label: "Account / ID", placeholder: "County account number", county: true },
  { key: "addr", label: "Situs address", placeholder: "Street address of the land", county: true },
];

/* Trim a typed text field to a stored value; an empty string is stored as null, never "", so a
 * cleared field reads the same as one that was never filled. */
export const cleanText = (v) => {
  const s = (v == null ? "" : String(v)).trim();
  return s ? s : null;
};

export { SQFT_PER_ACRE, parseAcres, parcelExceptSqft, parcelGrossSqft, parcelNetSqft, acreageComparison } from "./parcelArea.js";
