/* NEW-1 — SITE STORAGE RECONCILIATION: claimed service vs. storage that physically exists.
 *
 * The bug this exists to catch (Bain / Concept A, Cowork review): the Yield panel reported
 * Detention 150.9 of 76.7 "OK" and Mitigation 98.2 of 97.7 "OK" over four ponds whose TOTAL
 * physical storage is 206.3 ac-ft. 150.9 + 98.2 = 249.1 ac-ft of claimed service against 206.3
 * ac-ft that exists — a 42.8 ac-ft gap — and both checks still rendered green.
 *
 * Two independent ledgers (detention above the flood, mitigation below it) each summed correctly
 * on its own terms while together over-committing the same water. This module is the cross-check
 * that no single-ledger accumulator can perform: it sums COUNTED detention plus COUNTED mitigation
 * across all ponds and compares the total to TOTAL PHYSICAL STORAGE. When the claim exceeds the
 * physical, it returns a hard FAIL naming the overlap volume and the specific ponds involved.
 *
 * Per pond, it also runs the DECLARED-SPLIT invariant: a pond serving both duties must declare an
 * explicit vertical split (mitigation band from the pond bottom up to the governing flood
 * elevation, detention band stacked strictly above it — pondStageModel.dutySplit), and the two
 * bands must be non-overlapping by construction. A pond that claims both duties WITHOUT a declared
 * boundary elevation is itself a finding ("undeclared") even if the arithmetic happens to close:
 * an undeclared split is a double-count waiting to happen, not a passing design.
 *
 * LOUD-FAILURE: an UNKNOWN input (a pond whose split facts were not restored) poisons the verdict
 * to `state:"unknown"` — never a silent pass. A reconciliation that cannot see every pond cannot
 * certify that nothing is double-counted.
 *
 * Pure: cubic feet in, cubic feet out. Node-testable.
 */

const CF_PER_ACFT = 43560;
// An acre-foot residue inside display precision (1 dp) is not a real overlap — a FAIL must name a
// volume the reader can actually see on the panel, never a rounding crumb.
export const OVERLAP_TOL_CF = 0.05 * CF_PER_ACFT;

/* Per-pond entry shape (built by the caller from the pond ledger + pondStageModel):
 *   { id, name,
 *     physicalCf,        total storage the pond physically holds (floor → design water surface)
 *     detentionCountedCf, the volume CREDITED to the detention ledger for this pond
 *     mitigationCountedCf,the volume CREDITED to the mitigation ledger for this pond
 *     boundaryElevFt,    the declared duty-split elevation (null = not declared)
 *     known }            false → this pond's facts are unknown; poisons the site verdict
 */
export function reconcilePond(p = {}) {
  const physicalCf = num(p.physicalCf);
  const detCf = num(p.detentionCountedCf) ?? 0;
  const mitCf = num(p.mitigationCountedCf) ?? 0;
  if (p.known === false || physicalCf == null) {
    return { id: p.id ?? null, name: p.name ?? null, state: "unknown", physicalCf, detentionCf: detCf, mitigationCf: mitCf, claimedCf: detCf + mitCf, overlapCf: null, declared: !!p.boundaryElevFt || p.boundaryElevFt === 0, boundaryElevFt: num(p.boundaryElevFt) };
  }
  const claimedCf = detCf + mitCf;
  const overlapCf = claimedCf - physicalCf;
  const bothDuties = detCf > OVERLAP_TOL_CF && mitCf > OVERLAP_TOL_CF;
  const boundaryElevFt = num(p.boundaryElevFt);
  const declared = boundaryElevFt != null;
  const state = overlapCf > OVERLAP_TOL_CF ? "over"
    : bothDuties && !declared ? "undeclared"
    : "ok";
  return { id: p.id ?? null, name: p.name ?? null, state, physicalCf, detentionCf: detCf, mitigationCf: mitCf, claimedCf, overlapCf: Math.max(0, overlapCf), bothDuties, declared, boundaryElevFt };
}

/* The SITE reconciliation. Returns:
 *   state        "ok" | "fail" | "unknown"
 *   physicalCf   total storage that physically exists across all ponds
 *   claimedCf    counted detention + counted mitigation, summed across all ponds
 *   overlapCf    claimedCf − physicalCf when positive (the unreconciled gap), else 0
 *   ponds        per-pond results (above)
 *   offenders    the ponds implicated in the failure — over-claiming ponds first, then any pond
 *                serving both duties without a declared vertical split
 *   message      one plain sentence naming the overlap volume and the ponds involved
 *
 * `state:"fail"` is a HARD fail: the caller must render it as a FAIL, not an OK. Pure. */
export function reconcileStorage(entries = []) {
  const ponds = entries.map(reconcilePond);
  const unknown = ponds.filter((p) => p.state === "unknown");
  let physicalCf = 0, claimedCf = 0, detentionCf = 0, mitigationCf = 0;
  for (const p of ponds) {
    if (p.state === "unknown") continue;
    physicalCf += p.physicalCf || 0;
    claimedCf += p.claimedCf || 0;
    detentionCf += p.detentionCf || 0;
    mitigationCf += p.mitigationCf || 0;
  }
  if (unknown.length) {
    return {
      state: "unknown", ponds, unknownIds: unknown.map((p) => p.id),
      physicalCf: null, claimedCf: null, detentionCf: null, mitigationCf: null, overlapCf: null,
      offenders: [], undeclared: [],
      message: `Storage cannot be reconciled: ${unknown.length} pond${unknown.length === 1 ? "'s" : "s'"} storage split is unknown — re-check the flood data.`,
    };
  }
  const overlapCf = claimedCf - physicalCf;
  const overPonds = ponds.filter((p) => p.state === "over");
  const undeclared = ponds.filter((p) => p.state === "undeclared");
  const siteOver = overlapCf > OVERLAP_TOL_CF;
  const state = siteOver || overPonds.length ? "fail" : undeclared.length ? "fail" : "ok";
  // Name the specific ponds: the ones over-claiming on their own storage first (they are the
  // provable double-counts), then, when the site total over-commits without any single pond doing
  // so, every pond carrying both duties (the site-level overlap has to live among them).
  let offenders = overPonds;
  if (!offenders.length && siteOver) offenders = ponds.filter((p) => p.bothDuties);
  if (!offenders.length && siteOver) offenders = ponds.filter((p) => p.claimedCf > OVERLAP_TOL_CF);
  return {
    state,
    ponds,
    unknownIds: [],
    physicalCf, claimedCf, detentionCf, mitigationCf,
    overlapCf: Math.max(0, overlapCf),
    offenders,
    undeclared,
    message: reconcileMessage({ state, overlapCf, offenders, undeclared, physicalCf, claimedCf }),
  };
}

function reconcileMessage({ state, overlapCf, offenders, undeclared, physicalCf, claimedCf }) {
  if (state === "ok") return null;
  const names = (list) => list.map((p) => p.name || p.id || "a pond").join(", ");
  if (overlapCf > OVERLAP_TOL_CF) {
    const who = offenders.length ? ` — ${names(offenders)}` : "";
    return `Detention and mitigation together claim ${acft(claimedCf)} ac-ft of storage, but only ${acft(physicalCf)} ac-ft physically exists. ${acft(overlapCf)} ac-ft is counted twice${who}.`;
  }
  if (undeclared.length) {
    return `${names(undeclared)} serve${undeclared.length === 1 ? "s" : ""} both detention and mitigation without a declared vertical split. Set the flood elevation that divides the two bands so the same storage cannot be credited twice.`;
  }
  return "Storage does not reconcile.";
}

const acft = (cf) => (Math.round((cf / CF_PER_ACFT) * 10) / 10).toFixed(1);
const num = (v) => (v != null && Number.isFinite(Number(v)) ? Number(v) : null);
