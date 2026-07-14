/* NEW-10 / B830 (pond-roles branch) — the ledger balancer: rank the screening moves
 * that close the detention and mitigation ledgers TOGETHER. Pure — SitePlanner builds
 * the inputs (it owns the memos and context); this module never mutates them and never
 * edits the plan. Every move is a proposal: the one deliberate exception to
 * propose-only is the BERM move's apply payload (owner amendment, chat NEW-13 —
 * "I wanna be able to click something to include the berm height"): the payload
 * describes the per-pond TOB targets; the CLICK that applies it still happens in the
 * UI, with undo, provenance, and × restore.
 *
 * Move labels are ONE line (≤110 chars, unit-test-asserted); the teaching/derivation
 * copy rides `info` (the ⓘ hover). Deltas carry null where a number can't honestly be
 * computed — never a fabricated 0.
 */
import { usablePondVolume } from "./pondGeom.js";
import { computeRequiredDetention, computePumpedCredit } from "./detentionRules.js";
import { effectivePondRole } from "./pondLedger.js";

export const BERM_MAX_RAISE_FT = 4; // screening convention — no published berm-height cap is modeled yet (label it)
const AC_FT = 43560;

const f0 = (n) => Math.round(n).toLocaleString("en-US");
const f1 = (n) => (Math.round(n * 10) / 10).toFixed(1);
const f2 = (n) => (Math.round(n * 100) / 100).toFixed(2);
const short = (s, n = 22) => {
  const t = String(s || "").trim();
  return t.length > n ? t.slice(0, n - 1) + "…" : t;
};

/* Over-dug threshold (shared with the Yield Balance row): beyond required +
 * max(1 ac-ft, 10%) the extra cut buys nothing. */
export const overdugAcFt = (providedAcFt, requiredAcFt) =>
  Math.max(0, providedAcFt - requiredAcFt - Math.max(1, requiredAcFt * 0.1));

/* A pond raised by a berm of height h: the floor stays, the top of bank and the water
 * surface rise together (same freeboard), depth grows by h. Screening: the footprint
 * is held fixed (the berm builds outward/upward off the existing bank line). */
const pondUsableAt = (p, hFt) => {
  const det = {
    ...p.det,
    depth: (Number.isFinite(p.det?.depth) ? p.det.depth : 8) + hFt,
    tobElev: p.det?.tobElev != null && Number.isFinite(p.det.tobElev) ? p.det.tobElev + hFt : p.det?.tobElev ?? null,
  };
  const u = usablePondVolume(p.ring, det, { wseFt: p.wseFt ?? null, estimatePoolDepthFt: p.estPoolDepthFt ?? null });
  return u.usableCf ?? 0;
};

/* NEW-13 — solve the smallest berm height H (one H, applied jointly to every eligible
 * pond) such that site usable meets the requirement. One shared H means each pond's
 * added volume is naturally proportional to its water-surface area — that IS the
 * documented distribution rule. Eligibility: detention-serving role (detention/dual),
 * OUTSIDE the trigger floodplain (berming below the WSE is levee-adjacent hydraulics —
 * excluded, engineer territory), known split facts, a real ring. Pure. */
export function solveBermRaise({ ponds = [], deficitCf, maxRaiseFt = BERM_MAX_RAISE_FT } = {}) {
  const eligible = [], excluded = [];
  for (const p of ponds) {
    if (!p.ring || p.ring.length < 3) continue;
    if (p.factsKnown === false) { excluded.push({ id: p.id, name: p.name, reason: "unknown-split" }); continue; }
    if (p.inTrigger) { excluded.push({ id: p.id, name: p.name, reason: "floodplain-fringe" }); continue; }
    const eff = effectivePondRole({ role: p.role }, p);
    if (eff.role === "mitigation") { excluded.push({ id: p.id, name: p.name, reason: "mitigation-role" }); continue; }
    eligible.push(p);
  }
  if (!eligible.length || !(deficitCf > 0)) return { ok: false, partial: false, hFt: null, gainCf: 0, perPond: [], eligible, excluded };
  const gainAt = (h) => eligible.reduce((a, p) => a + (pondUsableAt(p, h) - pondUsableAt(p, 0)), 0);
  const perPondAt = (h) => eligible.map((p) => ({
    id: p.id, name: p.name,
    addCf: pondUsableAt(p, h) - pondUsableAt(p, 0),
    tobTargetFt: p.det?.tobElev != null && Number.isFinite(p.det.tobElev) ? Math.round((p.det.tobElev + h) * 100) / 100 : null,
    depthTargetFt: (Number.isFinite(p.det?.depth) ? p.det.depth : 8) + h,
  }));
  const maxGain = gainAt(maxRaiseFt);
  if (maxGain < deficitCf) {
    // The cap can't close the site — still report the capped move honestly (partial).
    return { ok: false, partial: maxGain > 0, hFt: maxRaiseFt, gainCf: maxGain, perPond: perPondAt(maxRaiseFt), eligible, excluded };
  }
  let lo = 0, hi = maxRaiseFt;
  for (let i = 0; i < 20; i++) {
    const mid = (lo + hi) / 2;
    if (gainAt(mid) >= deficitCf) hi = mid; else lo = mid;
  }
  const hFt = Math.min(maxRaiseFt, Math.ceil(hi * 10) / 10); // build to a 0.1-ft convention
  return { ok: true, partial: false, hFt, gainCf: gainAt(hFt), perPond: perPondAt(hFt), eligible, excluded };
}

/* The ranked move list. Inputs:
 *   detention:  { requiredAcFt, providedUsableAcFt, rateAcFtPerAc|null, acres }
 *   mitigation: { requiredAcFt|null, providedAcFt|null }
 *   ponds:      pondSplitFor entries + { name, ring, det } (det already detWithAuto'd)
 *   parcels:    [{ id, name, acres, active }]
 *   buildings:  [{ id, name, areaSf, courtSf, ring }]
 *   criteriaRule, detRule, reqInputs (+authorityId inside), earthPerCy, maxPondDepthFt
 * Returns { detGapAcFt, mitGapAcFt, mitOverAcFt, bermExcluded, moves } — moves ranked by
 * ac-ft of gap closed, non-destructive first, top 8. */
export function rankLedgerMoves({
  detention = {},
  mitigation = {},
  ponds = [],
  parcels = [],
  buildings = [],
  criteriaRule = null,
  detRule = null,
  reqInputs = null,
  earthPerCy = null,
  maxPondDepthFt = 8,
  returnPeriodYr = 100,
} = {}) {
  const reqAcFt = Number.isFinite(detention.requiredAcFt) ? detention.requiredAcFt : null;
  const provUsable = Number.isFinite(detention.providedUsableAcFt) ? detention.providedUsableAcFt : null;
  const detGapAcFt = reqAcFt != null && provUsable != null ? Math.max(0, reqAcFt - provUsable) : 0;
  const mitReq = Number.isFinite(mitigation.requiredAcFt) ? mitigation.requiredAcFt : null;
  const mitProv = Number.isFinite(mitigation.providedAcFt) ? mitigation.providedAcFt : null;
  const mitGapAcFt = mitReq != null && mitProv != null ? Math.max(0, mitReq - mitProv) : 0;
  const mitOverAcFt = mitReq != null && mitProv != null ? overdugAcFt(mitProv, mitReq) : 0;
  const moves = [];
  let bermExcluded = [];

  // 1) Shrink over-dug mitigation ponds back to required + margin (dirt saved, 1:1 —
  //    the below-WSE band is pure cut). Largest credited pond first.
  if (mitOverAcFt > 0.05) {
    const credited = ponds
      .filter((p) => p.factsKnown !== false && p.mode === "anchored" && p.bands && p.bands.mitigationCandidateCf > 0
        && effectivePondRole({ role: p.role }, p).role !== "detention")
      .sort((a, b) => b.bands.mitigationCandidateCf - a.bands.mitigationCandidateCf);
    let remainingCf = mitOverAcFt * AC_FT;
    for (const p of credited) {
      if (remainingCf < 0.05 * AC_FT) break;
      const shrinkCf = Math.min(p.bands.mitigationCandidateCf, remainingCf);
      remainingCf -= shrinkCf;
      const cy = shrinkCf / 27;
      const cost = earthPerCy != null ? cy * earthPerCy : null;
      moves.push({
        kind: "shrink-overdug", id: p.id,
        label: `Shrink ${short(p.name)} toward required+10% — saves ~${f0(cy)} cy of cut${cost != null ? ` (~$${f0(cost)})` : ""}`,
        info: `The mitigation ledger is over-dug by ~${f2(mitOverAcFt)} ac-ft beyond required + margin — cut past the requirement earns no credit. Shallowing/shrinking this pond's below-WSE band by ${f2(shrinkCf / AC_FT)} ac-ft keeps the ledger covered and saves the dirt. Screening: 1 ac-ft of below-WSE cut = 1 ac-ft of credit. The tool proposes — redraw the pond to take it.`,
        deltas: { detAcFt: 0, mitAcFt: -(shrinkCf / AC_FT), dirtCy: -Math.round(cy), costUsd: cost != null ? -Math.round(cost) : null, buildingSf: null },
        confirmFlags: [], destructive: false,
        score: shrinkCf / AC_FT,
      });
    }
  }

  // 2) NEW-13 — the one-click berm: smallest joint H that closes the detention gap.
  if (detGapAcFt > 0.01 && ponds.length) {
    const s = solveBermRaise({ ponds, deficitCf: detGapAcFt * AC_FT });
    bermExcluded = s.excluded;
    if ((s.ok || s.partial) && s.perPond.length) {
      const gainAcFt = s.gainCf / AC_FT;
      const n = s.perPond.length;
      const fbNote = criteriaRule?.minFreeboardFt != null ? `Freeboard is preserved (${criteriaRule.minFreeboardFt}′ min per ${criteriaRule.label || "criteria"}).` : "Freeboard is preserved.";
      moves.push({
        kind: "berm-raise", id: "berm-joint",
        label: `⛰ Berm +${f1(s.hFt)}′ on ${n} upland pond${n > 1 ? "s" : ""} → +${f2(gainAcFt)} ac-ft usable${s.ok ? " (site closes)" : " (partial)"}`,
        info: `Auto-solved: one +${f1(s.hFt)}′ berm on every eligible upland detention pond ${s.ok ? "closes" : "cuts into"} the ${f2(detGapAcFt)} ac-ft detention gap. One shared height means each pond adds volume in proportion to its area (the distribution rule). Clamped to +${f1(BERM_MAX_RAISE_FT)}′ (screening convention — no published berm cap modeled). ${fbNote} The berm itself is FILL above grade — it joins the earthwork balance (B833) and may block conveyance; floodplain-fringe ponds are excluded (berming below the WSE is levee-adjacent hydraulics — engineer territory). Applying sets each pond's top of bank with "berm — auto-solved" provenance; × on the field restores auto.`,
        deltas: { detAcFt: gainAcFt, mitAcFt: 0, dirtCy: null, costUsd: null, buildingSf: null },
        confirmFlags: ["berm-is-fill", "engineer-confirm"], destructive: false,
        apply: { hFt: s.hFt, perPond: s.perPond },
        score: Math.min(gainAcFt, detGapAcFt) * 1.05, // cheapest real move — smallest disturbance, no yield lost
      });
    }
  }

  // 3) Phase out / deactivate a parcel — the requirement shrinks at the current rate.
  const activeParcels = parcels.filter((p) => p.active !== false && Number.isFinite(p.acres) && p.acres > 0);
  if (detGapAcFt > 0.01 && activeParcels.length >= 2 && reqAcFt != null && Number.isFinite(detention.acres) && detention.acres > 0) {
    const effRate = Number.isFinite(detention.rateAcFtPerAc) ? detention.rateAcFtPerAc : reqAcFt / detention.acres;
    for (const p of activeParcels) {
      const delta = p.acres * effRate;
      moves.push({
        kind: "deactivate-parcel", id: p.id,
        label: `Phase out ${short(p.name)} (${f2(p.acres)} ac) — req −${f2(delta)} ac-ft at the current rate`,
        info: `Deactivating this parcel removes its ${f2(p.acres)} acres from the drainage area, cutting the requirement by ~${f2(delta)} ac-ft at the effective rate of ${f2(effRate)} ac-ft/ac${Number.isFinite(detention.rateAcFtPerAc) ? "" : " (derived: required ÷ acres — the rule's own rate wasn't a single point)"}. Screening only — phasing changes yield, access, and the site plan itself. The tool proposes; toggle the parcel in the Parcel panel to take it.`,
        deltas: { detAcFt: Math.min(delta, detGapAcFt), mitAcFt: null, dirtCy: null, costUsd: null, buildingSf: null },
        confirmFlags: [], destructive: true,
        score: Math.min(delta, detGapAcFt) * 0.7,
      });
    }
  }

  // 4) Convert a building + its court to a bermed basin — usable gained, sf lost,
  //    and the requirement falls with the impervious rate (point rules only).
  if (detGapAcFt > 0.01 && buildings.length && reqInputs && reqInputs.authorityId) {
    const synthDet = {
      depth: maxPondDepthFt,
      freeboard: criteriaRule?.minFreeboardFt ?? 1,
      slope: criteriaRule?.maxSideSlope ?? 3,
    };
    for (const b of buildings) {
      if (!b.ring || b.ring.length < 3) continue;
      const u = usablePondVolume(b.ring, synthDet, {});
      const sf = (b.areaSf || 0) + (b.courtSf || 0);
      let reqDelta = null;
      if (Number.isFinite(reqInputs.impPct) && Number.isFinite(reqInputs.acres) && reqInputs.acres > 0 && sf > 0) {
        const newImp = Math.max(0, reqInputs.impPct - (sf / (reqInputs.acres * AC_FT)) * 100);
        const r2 = computeRequiredDetention({ ...reqInputs, impPct: newImp });
        if (r2 && r2.kind === "point" && Number.isFinite(r2.requiredAcFt) && reqAcFt != null) reqDelta = r2.requiredAcFt - reqAcFt;
      }
      const gain = u.usableCf / AC_FT + (reqDelta != null ? -reqDelta : 0);
      moves.push({
        kind: "convert-building", id: b.id,
        label: `Convert ${short(b.name)}+court to a basin — +${f2(u.usableCf / AC_FT)} ac-ft, −${f0(sf / 1000)}k sf`,
        info: `Replacing this building and its court with a bermed basin at the site pond pattern (${f1(synthDet.depth)}′ deep, ${synthDet.slope}:1 sides, ${f1(synthDet.freeboard)}′ freeboard) stores ~${f2(u.usableCf / AC_FT)} ac-ft usable${reqDelta != null ? ` and drops the requirement by ~${f2(-reqDelta)} ac-ft (impervious falls with the roof/paving)` : ""}. It costs ${f0(sf)} sf of yield — the most expensive move here; ranked accordingly. The tool proposes; redrawing the plan is your call.`,
        deltas: { detAcFt: Math.min(gain, detGapAcFt), mitAcFt: null, dirtCy: null, costUsd: null, buildingSf: -Math.round(sf) },
        confirmFlags: [], destructive: true,
        score: Math.min(gain, detGapAcFt) * 0.5,
      });
    }
  }

  // 5) Pumped-system what-if — the pump rate that closes the gap (rate-method screening).
  if (detGapAcFt > 0.01 && reqInputs && Number.isFinite(reqInputs.impPct) && Number.isFinite(reqInputs.acres) && reqInputs.acres > 0) {
    const creditAt = (cfs) => {
      const c = computePumpedCredit({ acres: reqInputs.acres, impPct: reqInputs.impPct, gravityReleaseCfs: 0, pumpRateCfs: cfs, returnPeriodYr });
      return Number.isFinite(c.creditedAcFt) ? c.creditedAcFt : 0;
    };
    const gdf = detRule?.params?.gravityDrainFraction;
    // FBCDD Interim §5: ≥ gravityDrainFraction of the volume must drain by gravity —
    // the pumped share can serve at most (1 − gdf) of the requirement.
    const capAcFt = gdf != null && reqAcFt != null ? (1 - gdf) * reqAcFt : null;
    const targetAcFt = capAcFt != null ? Math.min(detGapAcFt, capAcFt) : detGapAcFt;
    if (targetAcFt > 0.01) {
      let hi = 1;
      while (creditAt(hi) < targetAcFt && hi < 4096) hi *= 2;
      let cfs, credit;
      if (creditAt(hi) < targetAcFt) { cfs = hi; credit = creditAt(hi); } // self-capped by the method
      else {
        let lo = 0;
        for (let i = 0; i < 24; i++) { const mid = (lo + hi) / 2; if (creditAt(mid) >= targetAcFt) hi = mid; else lo = mid; }
        cfs = hi; credit = creditAt(hi);
      }
      const clampNote = capAcFt != null && detGapAcFt > capAcFt ? ` — FBCDD caps pumped share at ${f2(capAcFt)}` : "";
      if (credit > 0.01) {
        moves.push({
          kind: "pumped-system", id: "pump",
          label: `Pumped outfall ≈ ${f1(cfs)} cfs — credits ~${f2(credit)} ac-ft (rate-method)${clampNote}`,
          info: `${detRule?.params?.gravityDrainNote ? detRule.params.gravityDrainNote + " " : ""}A pump running at rated capacity raises the allowable release, shrinking required storage by ~${f2(credit)} ac-ft on the Modified-Rational screen. Pumps cycle, need power and redundancy, and reviewers treat pumped systems as an exception — engineer-confirm before relying on this. The tool proposes only.`,
          deltas: { detAcFt: Math.min(credit, detGapAcFt), mitAcFt: null, dirtCy: null, costUsd: null, buildingSf: null },
          confirmFlags: gdf != null ? ["engineer-confirm", "fbcdd-gravity-rule"] : ["engineer-confirm"], destructive: false,
          score: Math.min(credit, detGapAcFt) * 0.6,
        });
      }
    }
  }

  moves.sort((a, b) => (b.score - a.score) || ((a.destructive ? 1 : 0) - (b.destructive ? 1 : 0)));
  return { detGapAcFt, mitGapAcFt, mitOverAcFt, bermExcluded, moves: moves.slice(0, 8) };
}
