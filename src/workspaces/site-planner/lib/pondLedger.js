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
export function accumulatePondLedger(entries = []) {
  const out = {
    pondCount: entries.length,
    grossCf: 0,
    usableCf: 0,
    deadCf: 0,
    mitCandidateCf: 0,
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
      out.mitCandidateCf += p.bands.mitigationCandidateCf || 0;
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
  }
  return out;
}
