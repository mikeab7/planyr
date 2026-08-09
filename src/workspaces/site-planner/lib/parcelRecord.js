/* The parcel RECORD — the facts about a lot that are not its geometry (NEW-2 / NEW-3).
 *
 * A lot pulled from a county identify arrives with an appraisal record: owner, account number,
 * situs address, stated acreage, the whole `attrs` blob. A lot the owner DREW — which is what you
 * do when the county service is down — arrived with geometry and nothing else, and there was no
 * way to type any of it in. Same for a lot promoted from a plotted deed. This module is the one
 * place that says what those fields are, where a value comes from, and how honestly to label it.
 *
 * The rule the provenance exists to enforce: a plan that is later reviewed must never present a
 * hand-drawn boundary as though it came from the county. `parcelProvenance` answers that for every
 * parcel — including the ones already saved, which carry no `source` field at all.
 *
 * Pure: no DOM, no React, no network. Unit-tested in test/parcelRecord.test.js.
 */
import { polyArea } from "./polygonSplit.js";

export const SQFT_PER_ACRE = 43560;

/* Where this boundary CAME FROM. `county` = a county GIS identify · `deed` = promoted from a
 * plotted metes-and-bounds description · `drawn` = digitized by hand. */
export const PARCEL_SOURCES = ["county", "deed", "drawn"];

/* The provenance of a parcel, including one saved before the field existed: a parcel carrying a
 * county appraisal record (`attrs`) or a county GIS key came from the county; anything else was
 * drawn. Never guesses `deed` — that is only ever stamped at promotion time (NEW-2), because a
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

/* The typed fields, in panel order. `key` is the parcel property; `county` marks the ones a county
 * identify also fills, so the panel can say when it is overriding a county value. */
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

/* A typed acreage. Accepts "12.50", "12.5 ac", "12,50"-free plain numbers; anything that isn't a
 * positive finite number is null (never 0 — 0 would read as "the county says zero acres"). */
export function parseAcres(v) {
  if (v == null || v === "") return null;
  const n = Number(String(v).replace(/[^0-9.\-]/g, ""));
  return Number.isFinite(n) && n > 0 ? n : null;
}

/* MEASURED acreage — what the drawn geometry actually encloses, minus any save-and-except holes
 * carried on the parcel (NEW-2). This is the number every area consumer must use. */
export function parcelNetSqft(pc) {
  if (!pc || !Array.isArray(pc.points) || pc.points.length < 3) return 0;
  const gross = Math.abs(polyArea(pc.points));
  const holes = parcelExceptSqft(pc);
  return Math.max(0, gross - holes);
}
export const parcelGrossSqft = (pc) =>
  (pc && Array.isArray(pc.points) && pc.points.length >= 3) ? Math.abs(polyArea(pc.points)) : 0;

/* Total area of the save-and-except carve-outs recorded on a parcel. `exceptions` is a list of
 * {pts, label} rings in the same feet frame as `points`. */
export function parcelExceptSqft(pc) {
  const ex = (pc && Array.isArray(pc.exceptions)) ? pc.exceptions : [];
  let sum = 0;
  for (const h of ex) {
    const ring = h && Array.isArray(h.pts) ? h.pts : Array.isArray(h) ? h : null;
    if (ring && ring.length >= 3) sum += Math.abs(polyArea(ring));
  }
  return sum;
}

/* The two acreages a parcel can quote, and whether they agree.
 *   measured — what the geometry encloses (net of exceptions)
 *   stated   — what the deed / county / the owner SAYS it is (`statedAcres`, typed or promoted)
 * They are deliberately kept apart: a deed-called 12.50 and a drawn 12.43 are both true, and the
 * difference is information — hiding it behind one number is what this exists to prevent.
 * `diffFrac` is null when there is nothing to compare. */
export function acreageComparison(pc) {
  const measured = parcelNetSqft(pc) / SQFT_PER_ACRE;
  const stated = parseAcres(pc && pc.statedAcres);
  const diffFrac = stated && measured > 0 ? Math.abs(measured - stated) / stated : null;
  return {
    measured: measured > 0 ? measured : null,
    stated,
    diffFrac,
    // Same bands the county geometry check already uses, so the two read consistently.
    agreement: diffFrac == null ? null : diffFrac <= 0.02 ? "match" : diffFrac <= 0.05 ? "close" : "off",
  };
}
