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
import { identityCache } from "./pureCache.js";

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

/* NEW-21/NEW-26 (owner live-verify 2026-07-24) — the ONE mitigation-credit function EVERY consumer
 * shares (the site ledger, the Yield verdict, the pond-sizing optimizer, and the ⚡ Optimize card), so a
 * pond's "provided mitigation" can never be computed two different ways (the SHORT 0.0 verdict vs the
 * card's "already covers 0.2 ac-ft" — the exact contradiction the owner caught).
 *
 * NEW-26 (owner directive, supersedes the NEW-21 berm-seal + role gates): a pond's below-WSE cut
 * (`bands.mitigationCandidateCf`) is compensating storage BY DEFAULT, because every detention pond is
 * HYDRAULICALLY CONNECTED to the floodplain through its own OUTFALL — the same outlet the pond drains
 * through. During a flood the receiving water backs IN through that outlet and occupies the below-WSE
 * storage, so it compensates like any open flood storage. This holds regardless of the pond's berm (the
 * flood reaches the cut through the outfall, not over the berm) and regardless of the pond's detention/
 * mitigation ROLE (the physics doesn't care what we labeled it). The credit is ZERO in exactly two cases:
 *
 *   (a) OUTLET GATED — the outfall carries a flap valve / backflow preventer (or the connection is
 *       deliberately closed), so the flood can't back in. reason "outlet-gated". `split.outletGated`.
 *   (b) NO OUTFALL — the pond has no outlet to the floodplain at all (an isolated pit). reason
 *       "no-outfall". `split.hasOutfall === false` (default is CONNECTED — an unmarked pond credits).
 *
 * ⚠ The connected DEFAULT is an ASSUMPTION (some districts require a dedicated opening or restrict in-pond
 * mitigation credit — BKDD Rules 22-01, ASSUMED until the code text lands); the caller flags it in the
 * verdict / card (the "credited cut … engineer confirms" note). The accessible band is the below-WSE
 * candidate reachable through the outfall invert (storage above the invert / permanent pool, below the
 * governing WSE) — the per-slice foot-for-foot refinement is a later hook. Returns
 * { creditedCf, candidateCf, reason }. Pure. */
export function mitigationCredit(det, split) {
  const bands = split && split.bands;
  const candidateCf = bands && Number.isFinite(bands.mitigationCandidateCf) ? bands.mitigationCandidateCf : 0;
  if (!(candidateCf > 0)) return { creditedCf: 0, candidateCf: 0, reason: null };
  // (a) a gated outfall (flap valve) keeps the flood out — no backflow, no in-pond compensating storage.
  if (split.outletGated || (det && det.outletGated)) return { creditedCf: 0, candidateCf, reason: "outlet-gated" };
  // (b) genuinely no outfall to the floodplain (an isolated pit). Default (undefined) is CONNECTED.
  if (split.hasOutfall === false) return { creditedCf: 0, candidateCf, reason: "no-outfall" };
  // Connected through the outfall (the default) → the below-WSE storage IS compensating storage.
  return { creditedCf: candidateCf, candidateCf, reason: null };
}

/* ── NEW-1 / B1032 — THE EXCLUSIVE DUTY ALLOCATION ────────────────────────────────────────────
 *
 * THE BUG THIS EXISTS TO PREVENT (Tsakiris / Concept A, owner report 2026-07-28): the panel read
 * Detention 63.4 of 33.8 AND Mitigation 29.6 of 0.2 on a SINGLE pond that holds 63.4 ac-ft — the
 * same 29.6 ac-ft credited to both ledgers. Root cause: R1 removed the flood WSE as a permanent
 * floor under `usableCf` (a pond recovers to normal tailwater between storms, so the below-flood
 * void IS available for the design storm) but left `bands.mitigationCandidateCf` spanning those
 * same elevations. The two numbers stopped being exclusive, and B834's partition property test was
 * amended at the same time to assert exclusivity ONLY under `coincidentStorm:true` — so nothing
 * failed. The invariant "credited mitigation ≤ below-WSE volume" would NOT have caught it either
 * (29.6 ≤ 29.6): the invariant that bites is detention + mitigation + dead ≤ the pond's gross.
 *
 * THE RULE. A pond's storage is partitioned into four EXCLUSIVE, non-negative bands that always
 * sum to its gross:
 *   deadCf        permanently occupied by water (below the permanent pool / normal tailwater)
 *   mitigationCf  the below-flood void DEDICATED to compensating storage
 *   detentionCf   everything the detention ledger counts
 *   unusedCf      void that neither ledger counts (a below-flood band a coincident-storm policy
 *                 bars from detention and nothing dedicated to mitigation)
 *
 * The below-flood void band can serve EITHER duty but never both, so it is assigned once:
 *   • a pond whose owner-declared purpose is MITIGATION dedicates the whole band (that is the
 *     basin's job) — detention then counts only the above-flood band, the original B708 split;
 *   • every other pond dedicates only what the site's remaining mitigation REQUIREMENT needs
 *     (`needCf`) and keeps the rest for detention, so a detention pond is never told it is short
 *     0.2 ac-ft while 29 ac-ft of usable below-flood cut sits right there;
 *   • under a COINCIDENT-storm policy detention cannot use the band at all, so dedicating it
 *     costs detention nothing;
 *   • a GATED or ABSENT outfall (mitigationCredit) blocks the dedication entirely — the flood
 *     can't reach the cut — and the band falls back to detention.
 * Pure. `split` is a usablePondVolume result (+ the stamped facts); `needCf` is the site's
 * still-unmet mitigation requirement in cubic feet (0 / null = nothing left to dedicate). */
export function allocatePondDuty(det, split, { needCf = 0 } = {}) {
  const grossCf = split && Number.isFinite(split.grossCf) ? split.grossCf : 0;
  const usableCf = split && Number.isFinite(split.usableCf) ? split.usableCf : 0;
  const bands = split && split.bands;
  const base = {
    grossCf, belowFloodVoidCf: 0, creditableCf: 0,
    deadCf: Math.max(0, grossCf - usableCf), detentionCf: usableCf, mitigationCf: 0, unusedCf: 0,
    uncreditedMitCf: 0, reason: null, dedicated: false,
  };
  // No elevation bands (unanchored / estimate / gross mode) → nothing to split: detention counts
  // its usable column, mitigation credits nothing. Never a fabricated below-flood credit.
  if (!bands || split.mode !== "anchored") return base;
  const belowFloodVoidCf = Number.isFinite(bands.mitigationCandidateCf) ? bands.mitigationCandidateCf : 0;
  const aboveWseCf = Number.isFinite(bands.aboveWseCf) ? bands.aboveWseCf : usableCf;
  // How much of the below-flood void the DETENTION column is currently counting: the whole band
  // under the default (recovered) policy, zero under a coincident-storm policy.
  const detClaimCf = Math.max(0, usableCf - aboveWseCf);
  const credit = mitigationCredit(det, split);
  const creditableCf = credit.creditedCf;
  const role = effectivePondRole(det, split).role;
  const need = Number.isFinite(needCf) && needCf > 0 ? needCf : 0;
  const dedicateCf = role === "mitigation" ? creditableCf : Math.min(creditableCf, need);
  const detentionCf = usableCf - Math.min(dedicateCf, detClaimCf);
  // The dead band is what is left of gross once BOTH void bands are removed — so a coincident
  // policy (which parks the below-flood void outside `usableCf`) can't misreport it as dead.
  const deadCf = Math.max(0, grossCf - aboveWseCf - belowFloodVoidCf);
  const unusedCf = Math.max(0, grossCf - deadCf - detentionCf - dedicateCf);
  return {
    grossCf, belowFloodVoidCf, creditableCf,
    deadCf, detentionCf, mitigationCf: dedicateCf, unusedCf,
    uncreditedMitCf: Math.max(0, belowFloodVoidCf - dedicateCf),
    // WHY a below-flood cut earns no (or partial) mitigation credit, so the panel can explain the
    // SHORT instead of showing a bare 0.0. "counted-as-detention" is the NEW-1 state: the void is
    // real but the detention ledger is already counting it.
    reason: dedicateCf >= belowFloodVoidCf - 1e-6 ? null
      : credit.reason ? credit.reason
      : detClaimCf > 0 ? "counted-as-detention"
      : "not-required",
    dedicated: dedicateCf > 0,
    // The DECLARED vertical split: the governing flood WSE divides the dedicated compensating-
    // storage band (below) from the detention band (above). A dedication without a boundary
    // elevation is exactly the "undeclared split" storageReconcile refuses to pass, so the
    // allocation states it rather than leaving the reconciler to guess.
    boundaryElevFt: dedicateCf > 0
      ? (bands.elevations && Number.isFinite(bands.elevations.wseFt) ? bands.elevations.wseFt
        : Number.isFinite(split.wseFt) ? split.wseFt : null)
      : null,
    role,
  };
}

/* NEW-2 (B221763) — the site fold is memoised on the ENTRIES ARRAY'S IDENTITY plus the requirement
 * by VALUE, the same key shape B236592 used one level down. It is called twice per render (the
 * geometry-only fold and the duty fold) and was therefore running 254 times per pan on a two-pond
 * plan; now that the render body resolves its entries once per model change, the fold rides that
 * same boundary. The precondition is `identityCache`'s: the entries array is REBUILT, never mutated
 * in place. Callers that pass a freshly-derived array (`entries.filter(...)`) legitimately miss and
 * recompute — a cache may only ever save work, never change an answer. */
const ledgerMemo = identityCache(4);

/* `entries` are pondSplitFor results + bookkeeping. `mitigationRequiredCf` is the site's
 * mitigation REQUIREMENT: ponds dedicate below-flood void against it in order until it is met, so
 * no pond over-dedicates storage the detention ledger could have used (NEW-1 / B1032). */
export function accumulatePondLedger(entries = [], opts = {}) {
  const { mitigationRequiredCf = null } = opts;
  const hit = ledgerMemo.get(entries, String(mitigationRequiredCf));
  if (hit !== undefined) return hit;
  return ledgerMemo.set(entries, String(mitigationRequiredCf), accumulatePondLedgerUncached(entries, mitigationRequiredCf));
}

function accumulatePondLedgerUncached(entries, mitigationRequiredCf) {
  const out = {
    pondCount: entries.length,
    grossCf: 0,
    usableCf: 0,
    deadCf: 0,
    mitCandidateCf: 0,
    // NEW-26 — candidate (below-WSE) cut is CREDITED to the mitigation Provided ledger
    // BY DEFAULT: every detention pond is hydraulically connected to the floodplain
    // through its own outfall, so the flood backs in and the below-flood storage
    // compensates. Credit is withheld ONLY when the outfall is gated or absent (see
    // mitigationCredit). Neither role nor berm gates any more. Crediting NEVER touches
    // usableCf/deadCf — the exclusive bands already partition each pond's gross exactly
    // once (no double-count).
    creditedMitCf: 0,
    uncreditedMitCf: 0,
    creditedPondCount: 0,
    // NEW-26 — WHY a below-flood cut earns no mitigation credit ("outlet-gated" |
    // "no-outfall" | null), so the panel + verdict can explain the SHORT, not just show 0.0.
    mitGatedReason: null,
    // NEW-1 (B1032) — void that NEITHER ledger counts (a below-flood band a coincident-storm
    // policy bars from detention with nothing dedicated to mitigation). Surfaced, never silent.
    unusedCf: 0,
    excavationCf: 0,
    unknownIds: [],
    pondFullyInundated: false,
    unanchoredInTrigger: 0,
    anchoredNoWseInTrigger: 0,
    autoAnchored: 0,
    // Each entry + its `duty` (the exclusive allocation below). NEVER the caller's array — the
    // fold is pure, and `otherLedger` folds (a subset, a different remaining need) must not
    // rewrite the shared entries' allocation.
    perPond: entries.map((p) => ({ ...p })),
  };
  // NEW-1 (B1032) — the site's still-unmet mitigation requirement, spent down pond by pond as the
  // below-flood void is DEDICATED. Null (requirement unknown / not yet screened) dedicates nothing:
  // an unknown requirement must never silently move volume off the detention ledger.
  let remainingNeedCf = Number.isFinite(mitigationRequiredCf) && mitigationRequiredCf > 0 ? mitigationRequiredCf : 0;
  for (const p of out.perPond) {
    out.grossCf += p.grossCf || 0;
    out.excavationCf += p.excavationCf || 0;
    if (p.autoAnchored) out.autoAnchored++;
    if (p.factsKnown === false) {
      out.unknownIds.push(p.id);
      continue;
    }
    // NEW-1 (B1032) — the ONE exclusive duty split. `usableCf`/`deadCf` are NO LONGER read raw off
    // the split (that is what let the same acre-foot land in both ledgers): detention gets what the
    // allocation leaves it after any dedication to compensating storage.
    const alloc = allocatePondDuty({ role: p.role, outletGated: p.outletGated }, p, { needCf: remainingNeedCf });
    p.duty = alloc; // stamped on the COPY, so the per-pond rows / reconciliation read the SAME numbers
    out.usableCf += alloc.detentionCf;
    out.deadCf += alloc.deadCf;
    out.unusedCf += alloc.unusedCf;
    if (p.mode === "anchored" && p.bands) {
      out.mitCandidateCf += alloc.belowFloodVoidCf;
      out.creditedMitCf += alloc.mitigationCf;
      remainingNeedCf = Math.max(0, remainingNeedCf - alloc.mitigationCf);
      if (alloc.mitigationCf > 0) out.creditedPondCount++;
      out.uncreditedMitCf += alloc.uncreditedMitCf;
      if (alloc.uncreditedMitCf > 0 && alloc.reason && out.mitGatedReason == null) out.mitGatedReason = alloc.reason;
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
    out.unusedCf = null;
  }
  return out;
}
