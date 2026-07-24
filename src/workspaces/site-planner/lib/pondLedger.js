/* Site-level pond-ledger accumulator (NEW-9, pond-roles branch).
 *
 * Pure fold of per-pond usable/dead splits (usablePondVolume results + the flood
 * facts they were computed from) into the site detention totals. Extracted from the
 * SitePlanner metrics loop so the honesty rule below is unit-testable.
 *
 * LOUD-FAILURE contract: an entry whose split facts are UNKNOWN (factsKnown:false —
 * a restored check whose slim record carries no facts for that pond) poisons the
 * site usableCf/deadCf/mitCandidateCf totals to null. The accumulator can never
 * emit a numeric "usable" that silently counts a gross-credited pond — that is the
 * exact fabrication that flipped a −54.73 ac-ft SHORT verdict into a +42.78
 * "surplus" on reload. Gross keeps summing regardless (a geometric fact of the
 * drawn ponds, independent of flood context).
 *
 * Entry shape (built by SitePlanner's pondSplitFor, which owns the memos/context):
 *   { id, mode, usableCf, deadCf, grossCf, bands,        // usablePondVolume result
 *     wseFt, inTrigger, estPoolDepthFt, factsKnown,      // the facts used
 *     anchoredTob, autoAnchored, excavationCf, role }    // bookkeeping
 */
export const POND_ROLES = ["detention", "mitigation", "dual"];
// NEW-4 (owner naming): the third purpose reads "Hybrid" everywhere the user sees it.
// The STORED enum stays "dual" — renaming the stored value would orphan saved ponds.
export const POND_ROLE_LABEL = { detention: "Detention", mitigation: "Mitigation", dual: "Hybrid" };
// D4 (owner 2026-07-22) — the on-screen NOUN follows the pond's RESOLVED purpose, so a mitigation
// pond is never labeled "Detention Pond". Used at every render site that names a specific pond
// (element header, section title, map label, Yield per-pond row, status/toast). The STORED element
// type/id stays "pond" — only the display string changes.
export const POND_DISPLAY_NAME = { detention: "Detention Pond", mitigation: "Mitigation Pond", dual: "Detention + Mitigation Pond" };
export function pondDisplayName(role) { return POND_DISPLAY_NAME[role] || POND_DISPLAY_NAME.detention; }
/* The display noun for a specific pond from its `det` + elevation `split` — resolves the effective
 * role (owner's explicit purpose, else the auto suggestion) and maps it to the noun. Pure. */
export function pondDisplayNameFor(det, split) { return pondDisplayName(effectivePondRole(det, split).role); }
export const ROLE_SHARE = 0.8; // ≥80% of volume below the WSE → mitigation-primary; ≥80% above → detention

/* NEW-8 — auto-suggest a pond's role from its elevation split. Screening share =
 * (gross − above-WSE) / gross, defined only when the pond is anchored WITH a known
 * flood WSE (otherwise there is no elevation evidence and the suggestion defaults
 * to detention with belowShare null — the caller says so). R1 — the share is the
 * flood-OCCUPANCY (below the flood WSE), so it reads `aboveWseCf` (the geometric
 * volume above the flood, independent of the coincident-storm policy), NOT `usableCf`
 * (which now floats with that policy). Pure. */
export function suggestPondRole(split) {
  const hasEvidence = split && split.mode === "anchored" && split.bands && split.wseFt != null && split.grossCf > 0;
  if (!hasEvidence) return { role: "detention", belowShare: null };
  const aboveWse = Number.isFinite(split.bands.aboveWseCf) ? split.bands.aboveWseCf : split.usableCf;
  const belowShare = Math.max(0, Math.min(1, 1 - aboveWse / split.grossCf));
  const role = belowShare >= ROLE_SHARE ? "mitigation" : belowShare <= 1 - ROLE_SHARE ? "detention" : "dual";
  return { role, belowShare };
}

/* NEW-8 — the effective role: the owner's explicit det.role wins; absent/null means
 * auto (never store the string "auto"). Pure. */
export function effectivePondRole(det, split) {
  const suggested = suggestPondRole(split);
  const owner = det && POND_ROLES.includes(det.role) ? det.role : null;
  return { role: owner || suggested.role, source: owner ? "owner" : "auto", suggested };
}

export function accumulatePondLedger(entries = []) {
  const out = {
    pondCount: entries.length,
    grossCf: 0,
    usableCf: 0,
    deadCf: 0,
    mitCandidateCf: 0,
    // NEW-8 — the role gate: candidate (below-WSE) volume is CREDITED to the
    // mitigation Provided ledger only from ponds whose effective role is
    // mitigation or dual; detention-role ponds' candidate volume stays visible
    // as uncredited. Role NEVER touches usableCf/deadCf — the exclusive bands
    // already partition each pond's gross exactly once (no double-count).
    creditedMitCf: 0,
    uncreditedMitCf: 0,
    creditedPondCount: 0,
    excavationCf: 0,
    unknownIds: [],
    pondFullyInundated: false,
    unanchoredInTrigger: 0,
    anchoredNoWseInTrigger: 0,
    autoAnchored: 0,
    perPond: entries,
  };
  for (const p of entries) {
    out.grossCf += p.grossCf || 0;
    out.excavationCf += p.excavationCf || 0;
    if (p.autoAnchored) out.autoAnchored++;
    if (p.factsKnown === false) {
      out.unknownIds.push(p.id);
      continue;
    }
    out.usableCf += p.usableCf || 0;
    out.deadCf += p.deadCf || 0;
    if (p.mode === "anchored" && p.bands) {
      const cand = p.bands.mitigationCandidateCf || 0;
      out.mitCandidateCf += cand;
      const eff = effectivePondRole({ role: p.role }, p);
      if (eff.role === "mitigation" || eff.role === "dual") {
        out.creditedMitCf += cand;
        if (cand > 0) out.creditedPondCount++;
      } else {
        out.uncreditedMitCf += cand;
      }
      if (p.bands.fullyInundated) out.pondFullyInundated = true;
    } else if (p.inTrigger) {
      // B822 — two DIFFERENT honesty states: anchored (manual or auto TOB) with an
      // unknown reach WSE, vs no anchor at all (distinct fix instructions).
      if (p.anchoredTob) out.anchoredNoWseInTrigger++;
      else out.unanchoredInTrigger++;
    }
  }
  if (out.unknownIds.length) {
    out.usableCf = null;
    out.deadCf = null;
    out.mitCandidateCf = null;
    out.creditedMitCf = null;
    out.uncreditedMitCf = null;
  }
  return out;
}
