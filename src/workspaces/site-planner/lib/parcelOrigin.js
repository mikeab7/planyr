/* WHERE A PARCEL CAME FROM, in the words the Parcels list and the parcel page use (NEW-2).
 *
 * One pure answer, shared by the row's second line, the page's source chip and the page's Source
 * section, so they can never disagree:
 *
 *   combined — made by Combine. DERIVED FROM THE COMBINE SNAPSHOT (`pc.combined.from`), never from
 *              a stored flag: a tract has no county attrs and no `source`, so the old provenance
 *              rule read it as "Drawn by hand". (Goose Creek Phase II "Parcel 1" was the OWNER'S GUESS for a combine result and is NOT one: it has no combine record and correctly reads "Drawn" — never force it.) Every
 *              combined parcel already on a real site carries the snapshot, so it reads right
 *              without any migration.
 *   county   — a lot pulled from the county appraisal district (attrs / gisKey / source:"county").
 *   deed     — promoted from a plotted metes-and-bounds deed.
 *   drawn    — digitised by hand.
 *
 * Pure: no DOM, no React.
 */
import { countyRecord } from "./appraisal.js";

/* THE ONE provenance rule (parcelRecord.js's `parcelProvenance` delegates here). It lives in THIS
 * boot-safe leaf, not in parcelRecord.js, because the Parcels list reads it on the planner's boot
 * path and parcelRecord.js is deliberately lazy-only (its header explains the chunk-hoist trap). */
const SOURCES = ["county", "deed", "drawn"];
export function originKind(pc) {
  const s = pc && typeof pc.source === "string" ? pc.source : null;
  if (s && SOURCES.includes(s)) return s;
  if (combinedCount(pc) > 0) return "combined";
  if (pc && (pc.attrs || pc.gisKey)) return "county";
  /* A piece cut by Split is what the lot it was cut from was. */
  const parent = pc && pc.splitFrom && pc.splitFrom.from;
  if (parent && parent !== pc) { const k = originKind(parent); if (k !== "unknown") return k === "combined" ? "unknown" : k; }
  /* "Drawn" needs POSITIVE evidence (a `source: "drawn"` stamped when the outline was digitised). A lot
   * saved before that stamp, with no county record and no combine/deed trail, could be anything — say
   * nothing rather than guess (B2191xxx NEW-3: a Combined parcel read "Drawn" because nothing proved it
   * otherwise and "drawn" was the default). */
  return "unknown";
}

export const ORIGIN_CHIP = { combined: "Combined", county: "From the county", deed: "From deed", drawn: "Drawn", unknown: null };

/* How many original lots a combined parcel was made from (0 when it is not a combined parcel). */
export const combinedCount = (pc) => {
  const from = pc && pc.combined && Array.isArray(pc.combined.from) ? pc.combined.from : [];
  return from.length;
};

/* "Harris County · HCAD" (the registry label) -> "Harris CAD". Null when there is no county. */
export function cadNameOf(countyLabel) {
  if (!countyLabel) return null;
  const head = String(countyLabel).split("·")[0].replace(/\bcounty\b/i, "").trim();
  return head ? `${head} CAD` : null;
}

/* @returns { kind, chip, line, count }
 *   line — the row's short second line: "Combined from 3 lots" · "Harris CAD · 045-123-000-0012" · "Drawn" */
/* "Combined from 3 lots" when EVERY source is a county lot, otherwise "Combined from 3 parcels". */
export function combinedLine(pc) {
  const from = pc && pc.combined && Array.isArray(pc.combined.from) ? pc.combined.from : [];
  const n = from.length;
  const allCounty = n > 0 && from.every((f) => originKind(f) === "county");
  return `Combined from ${n} ${allCounty ? (n === 1 ? "lot" : "lots") : (n === 1 ? "parcel" : "parcels")}`;
}

/* The account a county lot is known by: the county's own attribute bag first (the identify-time `pc.acct`
 * was the internal OBJECTID on HCAD's schema), the stamped value only as the fallback. */
export function accountOf(pc, { idField = null } = {}) {
  if (!pc) return null;
  if (pc.attrs) return countyRecord(pc.attrs, { acct: pc.acct, idField }).account;
  return pc.acct || null;
}

export function parcelOrigin(pc, { cadName = null, idField = null } = {}) {
  const count = combinedCount(pc);
  const kind = count > 0 ? "combined" : originKind(pc);
  let line;
  if (kind === "combined") line = combinedLine(pc);
  else if (kind === "county") line = [cadName, accountOf(pc, { idField })].filter(Boolean).join(" · ") || "From the county";
  else if (kind === "deed") line = "From a deed";
  else if (kind === "drawn") line = "Drawn";
  else line = ""; // unknown — no source line rather than a guess
  return { kind, chip: ORIGIN_CHIP[kind] || null, line, count };
}
