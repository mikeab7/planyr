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

/* NEW-21 (owner live-verify 2026-07-24) — the ONE mitigation-credit function EVERY consumer shares
 * (the site ledger, the Yield verdict, the pond-sizing optimizer, and the ⚡ Optimize card), so a pond's
 * "provided mitigation" can never be computed two different ways (the SHORT 0.0 verdict vs the card's
 * "already covers 0.2 ac-ft" — the exact contradiction the owner caught). A pond's below-WSE cut
 * (`bands.mitigationCandidateCf`) is compensating storage ONLY when the floodplain can actually use it:
 *
 *   (a) HYDRAULIC SEAL — a pond whose rim (top of bank) sits ABOVE the flood WSE is walled off by its
 *       own berm; the flood can't reach the cut, so it compensates for NOTHING (until an opening / weir
 *       through the berm on the flood side is modeled — not yet). reason "berm-sealed". A rim BELOW the
 *       WSE is overtopped by the flood, so the cut IS wetted and this gate does not fire.
 *   (b) ROLE — a Detention-only pond's below-flood cut is the mitigation CANDIDATE but is not CREDITED
 *       to the mitigation ledger until the owner designates the pond Mitigation or Hybrid (the NEW-8
 *       opt-in that stops the tool silently claiming one basin for both ledgers). reason "role-detention".
 *
 * Otherwise the full candidate credits (reason null). Returns { creditedCf, candidateCf, reason }. Pure. */
export function mitigationCredit(det, split) {
  const bands = split && split.bands;
  const candidateCf = bands && Number.isFinite(bands.mitigationCandidateCf) ? bands.mitigationCandidateCf : 0;
  if (!(candidateCf > 0)) return { creditedCf: 0, candidateCf: 0, reason: null };
  const el = (bands && bands.elevations) || {};
  // (a) berm seal: rim above the flood WSE → the berm keeps the flood out (no hydraulic connection).
  const sealed = !!split.bermed && Number.isFinite(el.tobElev) && Number.isFinite(el.wseFt) && el.tobElev > el.wseFt + 1e-6;
  if (sealed) return { creditedCf: 0, candidateCf, reason: "berm-sealed" };
  // (b) role: only a Mitigation/Hybrid pond credits its candidate to the mitigation ledger.
  const role = effectivePondRole(det, split).role;
  if (role !== "mitigation" && role !== "dual") return { creditedCf: 0, candidateCf, reason: "role-detention" };
  return { creditedCf: candidateCf, candidateCf, reason: null };
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
    // NEW-21 — WHY the largest below-flood cut earns no mitigation credit ("role-detention" |
    // "berm-sealed" | null), so the panel + verdict can explain the SHORT, not just show 0.0.
    mitGatedReason: null,
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
      // NEW-21 — the ONE shared credit gate (role + hydraulic seal), so the ledger, verdict,
      // optimizer, and card can never disagree on "provided mitigation".
      const mc = mitigationCredit({ role: p.role }, p);
      out.creditedMitCf += mc.creditedCf;
      if (mc.creditedCf > 0) out.creditedPondCount++;
      const uncredited = Math.max(0, mc.candidateCf - mc.creditedCf);
      out.uncreditedMitCf += uncredited;
      if (uncredited > 0 && mc.reason && out.mitGatedReason == null) out.mitGatedReason = mc.reason;
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
