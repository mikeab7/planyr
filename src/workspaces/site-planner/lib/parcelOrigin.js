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
/* THE ONE provenance rule (parcelRecord.js's `parcelProvenance` delegates here). It lives in THIS
 * boot-safe leaf, not in parcelRecord.js, because the Parcels list reads it on the planner's boot
 * path and parcelRecord.js is deliberately lazy-only (its header explains the chunk-hoist trap). */
const SOURCES = ["county", "deed", "drawn"];
export function originKind(pc) {
  const s = pc && typeof pc.source === "string" ? pc.source : null;
  if (s && SOURCES.includes(s)) return s;
  if (combinedCount(pc) > 0) return "combined";
  return (pc && (pc.attrs || pc.gisKey)) ? "county" : "drawn";
}

export const ORIGIN_CHIP = { combined: "Combined", county: "From the county", deed: "From deed", drawn: "Drawn" };

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
export function parcelOrigin(pc, { cadName = null } = {}) {
  const count = combinedCount(pc);
  const kind = count > 0 ? "combined" : originKind(pc);
  let line;
  if (kind === "combined") line = `Combined from ${count} lot${count === 1 ? "" : "s"}`;
  else if (kind === "county") line = [cadName, pc && pc.acct].filter(Boolean).join(" · ") || "From the county";
  else if (kind === "deed") line = "From a deed";
  else line = "Drawn";
  return { kind, chip: ORIGIN_CHIP[kind] || ORIGIN_CHIP.drawn, line, count };
}
