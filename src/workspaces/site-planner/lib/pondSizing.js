/* NEW-4 (pond purpose + sizing assistant) — the design-forward direction of the B708
 * banded machinery: instead of only AUDITING a drawn pond, solve what it would take
 * for an ANCHORED pond to meet its two banded targets:
 *
 *   below the flood WSE  — mitigation-candidate volume ≥ the mitigation target
 *                          (solve the floor: deepen; else grow the footprint)
 *   above the flood WSE  — usable detention ≥ the detention target
 *                          (solve top of bank: a berm raise, freeboard preserved)
 *
 * Everything prices through the SAME pondGeom bands (bandedStorage/usablePondVolume,
 * via volumeBetween) the audit rows use, so the assistant can never disagree with the
 * ledger. Screening conventions ride the existing precedents: the 0.1-ft berm build
 * convention and the labeled BERM_MAX_RAISE_FT clamp (ledgerBalancer), the pinch-off
 * ceiling maxInwardOffset/slope (pondGeom), and the berm-as-fill feedback loop —
 * raising the TOB inside the trigger floodplain builds a fill prism below the WSE
 * that INCREASES the mitigation requirement the pond is trying to meet; one
 * fixed-point pass folds it back (bermFillVolume × ratio), per the owner's spec.
 *
 * Honesty rules (LOUD-FAILURE):
 *   • no WSE → the assistant REFUSES with the reason — it never designs off gross.
 *   • an ESTIMATED WSE (NEW-2 est-boundary-grade) runs, but the result carries
 *     estimated:true so every consumer stamps it.
 *   • a target the geometry can't reach at these side slopes reports the geometric
 *     ceiling ("this footprint can't reach the target at N:1 slopes"), never an
 *     impossible depth.
 * Pure — the caller (SitePlanner) owns context and memos; nothing here mutates. */
import { bandedStorage, bermFillVolume } from "./pondGeom.js";
import { maxInwardOffset } from "./pondOffset.js";
import { BERM_MAX_RAISE_FT } from "./ledgerBalancer.js";

const AC_FT = 43560;
const EST_PROVIDERS = new Set(["est-boundary-grade", "est-ebfe", "est-fbcdd", "est-maapnext"]); // B882 — every estimate provider stamps

const detOf = (det = {}) => ({
  depth: Number.isFinite(det.depth) ? det.depth : 8,
  freeboard: Number.isFinite(det.freeboard) ? det.freeboard : 1,
  slope: Number.isFinite(det.slope) ? det.slope : 3,
});

// Uniform scale of a ring about its centroid — the "grow the footprint" candidate
// geometry (screening: the drawn shape grows in place; the owner redraws for real).
export function scaleRing(ring, factor) {
  if (!Array.isArray(ring) || ring.length < 3 || !(factor > 0)) return ring;
  let cx = 0, cy = 0;
  for (const p of ring) { cx += p.x; cy += p.y; }
  cx /= ring.length; cy /= ring.length;
  return ring.map((p) => ({ x: cx + (p.x - cx) * factor, y: cy + (p.y - cy) * factor }));
}

const ringAreaSf = (ring) => {
  let a = 0;
  for (let i = 0; i < ring.length; i++) {
    const p = ring[i], q = ring[(i + 1) % ring.length];
    a += p.x * q.y - q.x * p.y;
  }
  return Math.abs(a) / 2;
};

const bandsAt = (ring, det, wseFt) => bandedStorage(ring, det, { wseFt });

/* Solve the smallest design depth (det.depth, TOB held) whose below-WSE
 * mitigation-candidate band meets targetCf. Bounded by the pinch-off ceiling
 * maxDepth = maxInwardOffset/slope. Returns
 *   { ok, depthFt?, addCf, ceilingCf?, maxDepthFt? } — ok:false carries what the
 * geometry CAN reach so the caller reports the ceiling honestly. */
export function solveMitigationDepth({ ring, det, wseFt, targetCf }) {
  const { depth, slope } = detOf(det);
  const maxDepthFt = slope > 0 ? maxInwardOffset(ring) / slope : 0;
  const candAt = (d) => {
    const b = bandsAt(ring, { ...det, depth: d }, wseFt);
    return b ? b.mitigationCandidateCf : 0;
  };
  const now = candAt(depth);
  if (now >= targetCf) return { ok: true, depthFt: depth, addCf: 0, maxDepthFt };
  const ceilingCf = candAt(maxDepthFt);
  if (ceilingCf < targetCf) return { ok: false, depthFt: null, addCf: Math.max(0, ceilingCf - now), ceilingCf, maxDepthFt };
  let lo = depth, hi = maxDepthFt;
  for (let i = 0; i < 24; i++) {
    const mid = (lo + hi) / 2;
    if (candAt(mid) >= targetCf) hi = mid; else lo = mid;
  }
  const depthFt = Math.min(maxDepthFt, Math.ceil(hi * 2) / 2); // half-foot convention (B640)
  return { ok: true, depthFt, addCf: candAt(depthFt) - now, maxDepthFt };
}

/* Solve the smallest uniform footprint growth whose below-WSE band meets targetCf at
 * the CURRENT design depth. Reports added acres (screening — the owner redraws). */
export function solveMitigationGrow({ ring, det, wseFt, targetCf, maxFactor = 3 }) {
  const candAt = (f) => {
    const b = bandsAt(scaleRing(ring, f), det, wseFt);
    return b ? b.mitigationCandidateCf : 0;
  };
  if (candAt(1) >= targetCf) return { ok: true, factor: 1, addAcres: 0 };
  if (candAt(maxFactor) < targetCf) return { ok: false, factor: null, addAcres: null };
  let lo = 1, hi = maxFactor;
  for (let i = 0; i < 24; i++) {
    const mid = (lo + hi) / 2;
    if (candAt(mid) >= targetCf) hi = mid; else lo = mid;
  }
  const baseSf = ringAreaSf(ring);
  return { ok: true, factor: hi, addAcres: (baseSf * (hi * hi - 1)) / AC_FT };
}

/* Solve the smallest TOB raise h (floor HELD: depth grows with the TOB, the
 * ledgerBalancer pondUsableAt convention) whose above-WSE usable band meets
 * targetCf. Clamped at maxRaiseFt (screening convention, labeled). */
export function solveTobRaise({ ring, det, wseFt, targetCf, maxRaiseFt = BERM_MAX_RAISE_FT }) {
  const { depth } = detOf(det);
  const usableAt = (h) => {
    const d2 = { ...det, depth: depth + h, tobElev: det.tobElev + h };
    const b = bandsAt(ring, d2, wseFt);
    return b ? b.usableCf : 0;
  };
  const now = usableAt(0);
  if (now >= targetCf) return { ok: true, hFt: 0, addCf: 0 };
  const capCf = usableAt(maxRaiseFt);
  if (capCf < targetCf) return { ok: false, hFt: maxRaiseFt, addCf: Math.max(0, capCf - now), partial: capCf > now };
  let lo = 0, hi = maxRaiseFt;
  for (let i = 0; i < 24; i++) {
    const mid = (lo + hi) / 2;
    if (usableAt(mid) >= targetCf) hi = mid; else lo = mid;
  }
  const hFt = Math.min(maxRaiseFt, Math.ceil(hi * 10) / 10); // 0.1-ft build convention
  return { ok: true, hFt, addCf: usableAt(hFt) - now };
}

/* The assistant. Inputs (site feet / ft NAVD88 / CUBIC FEET):
 *   ring, det           — the pond as drawn (det already detWithAuto'd; needs tobElev)
 *   wseFt, wseProvider  — the governing flood WSE at the pond + its provider tag
 *   inTrigger           — pond intersects a trigger-class flood zone
 *   gradeFt             — existing grade at the pond (berm-as-fill reference)
 *   mitTargetCf         — below-WSE volume THIS pond should supply (site required
 *                         minus what other credited ponds already provide)
 *   detTargetCf         — usable volume this pond should supply (same construction)
 *   mitRatio            — the jurisdiction's compensating-storage ratio (per NEW-1)
 * Returns { ok, reason?, estimated, bands, mitigation, detention, actions } where
 * each band block is { targetCf, providedCf, shortCf, covered } and actions is an
 * ordered list of { kind, label, ... } screening moves. Pure. */
export function sizePondForTargets({
  ring = null,
  det = null,
  wseFt = null,
  wseProvider = null,
  inTrigger = false,
  gradeFt = null,
  mitTargetCf = 0,
  detTargetCf = 0,
  mitRatio = 1,
  maxRaiseFt = BERM_MAX_RAISE_FT,
} = {}) {
  if (!Array.isArray(ring) || ring.length < 3) return { ok: false, reason: "no pond footprint", estimated: false, actions: [] };
  if (det == null || det.tobElev == null || !isFinite(det.tobElev)) {
    return { ok: false, reason: "pond not anchored — set a top-of-bank elevation first", estimated: false, actions: [] };
  }
  if (wseFt == null || !isFinite(wseFt)) {
    // Never design off gross: with no water surface there are no bands to solve.
    return { ok: false, reason: "flood WSE unknown — enter a BFE (or accept the boundary-grade estimate) first", estimated: false, actions: [] };
  }
  const estimated = EST_PROVIDERS.has(wseProvider);
  const { depth, freeboard, slope } = detOf(det);
  const bands = bandsAt(ring, det, wseFt);
  const mit0 = bands ? bands.mitigationCandidateCf : 0;
  const use0 = bands ? bands.usableCf : 0;

  const actions = [];
  let mitTarget = Math.max(0, mitTargetCf || 0);
  const detTarget = Math.max(0, detTargetCf || 0);

  // Fully-inundated pond: the design storm already fills it — usable is ZERO and no
  // floor work changes that. Lead with the TOB fix, not a delta table.
  const fullyInundated = wseFt >= det.tobElev - 1e-9;
  let tob = null;
  if (detTarget > use0) {
    tob = solveTobRaise({ ring, det, wseFt, targetCf: detTarget, maxRaiseFt });
    // Berm-as-fill feedback (the fixed-point pass): a raised TOB above existing grade
    // inside the trigger floodplain is NEW fill; the prism below the WSE displaces
    // flood storage and raises the mitigation requirement this pond is solving.
    if (tob.hFt > 0 && inTrigger && gradeFt != null && isFinite(gradeFt)) {
      const tobNow = det.tobElev;
      const bermTopAfter = tobNow + tob.hFt;
      // Only the INCREMENTAL prism is new fill: from max(grade, current TOB) up to the
      // raised TOB (an already-bermed bank's existing prism is B833's pricing, not ours).
      const bermBase = Math.max(gradeFt, tobNow);
      const bermH = Math.max(0, bermTopAfter - bermBase);
      const belowWseH = Math.min(bermH, Math.max(0, wseFt - bermBase));
      const prismCf = belowWseH > 0 ? bermFillVolume(ring, belowWseH, slope) : null;
      if (prismCf != null && prismCf > 0) {
        mitTarget += prismCf * (Number.isFinite(mitRatio) ? mitRatio : 1);
        tob = { ...tob, bermFillBelowWseCf: prismCf };
      }
    }
  }

  const mitShort = Math.max(0, mitTarget - mit0);
  let deepen = null, grow = null;
  if (mitShort > 0) {
    deepen = solveMitigationDepth({ ring, det, wseFt, targetCf: mitTarget });
    if (!deepen.ok) grow = solveMitigationGrow({ ring, det: { ...det, depth: deepen.maxDepthFt ?? depth }, wseFt, targetCf: mitTarget });
  }

  // Assemble ordered actions (plain payloads; the caller renders copy + deltas).
  if (fullyInundated) {
    actions.push({
      kind: "inundated",
      label: `usable detention is ZERO — the flood WSE sits at/above the top of bank; raise the TOB first`,
    });
  }
  if (tob && tob.hFt > 0) {
    actions.push({
      kind: "raise-tob",
      hFt: tob.hFt,
      addCf: tob.addCf,
      partial: tob.ok === false,
      bermFillBelowWseCf: tob.bermFillBelowWseCf ?? null,
      maxRaiseFt,
    });
  }
  if (deepen && deepen.ok && deepen.depthFt > depth) {
    actions.push({ kind: "deepen", depthFt: deepen.depthFt, addCf: deepen.addCf, maxDepthFt: deepen.maxDepthFt });
  }
  if (deepen && !deepen.ok) {
    actions.push({
      kind: "pinch-off",
      maxDepthFt: deepen.maxDepthFt,
      ceilingCf: deepen.ceilingCf,
      slope,
      label: `this footprint can't reach the mitigation target at ${slope}:1 slopes — floor pinches off at ${deepen.maxDepthFt.toFixed(1)}′`,
    });
    if (grow && grow.ok && grow.addAcres > 0) actions.push({ kind: "grow", addAcres: grow.addAcres, factor: grow.factor });
    if (grow && !grow.ok) actions.push({ kind: "grow-infeasible" });
  }

  return {
    ok: true,
    estimated,
    fullyInundated,
    bands: bands ? { usableCf: use0, mitigationCandidateCf: mit0, poolDeadCf: bands.poolDeadCf, grossCf: bands.grossCf } : null,
    mitigation: { targetCf: mitTarget, providedCf: mit0, shortCf: mitShort, covered: mitShort <= 0 },
    detention: { targetCf: detTarget, providedCf: use0, shortCf: Math.max(0, detTarget - use0), covered: detTarget <= use0 },
    freeboardFt: freeboard,
    actions,
  };
}

/* B909/B910 — apply sizePondForTargets' proposed actions onto a pond element, mirroring
 * the SAME choices the Sizing assistant's manual Apply chips make (SitePlanner.jsx):
 *
 *   - raise-tob (detention): floor HELD, so raising the top of bank by hFt adds hFt to
 *     depth (and stamps tobBerm provenance).
 *   - deepen (mitigation): an ABSOLUTE target depth from the pond's CURRENT tobElev —
 *     solveMitigationDepth holds det.tobElev fixed while it searches.
 *   - pinch-off + grow: when deepening alone can't reach the mitigation target, deepen
 *     to the geometric ceiling (pinchA) and grow the footprint by the solved factor;
 *     the ceiling depth applies even when the grow is itself infeasible, so a partial
 *     gain from digging is never left on the table.
 *
 * ⚠ raise-tob and deepen/pinch-off must come from SEPARATE sizePondForTargets calls
 * against the pond's ACTUAL state at each step, never combined from one shared solve.
 * Side-slope offsets are measured DOWN FROM the top of bank, so raising the TOB changes
 * the below-WSE candidate volume at any fixed floor elevation — solveMitigationDepth's
 * absolute depthFt, solved against the pre-raise tobElev, does NOT land where intended
 * once tobElev has actually moved (confirmed by direct measurement — a plausible-looking
 * "add the deltas" formula silently under-delivers the mitigation target). The caller
 * (SitePlanner.jsx `designPond`) therefore runs a TWO-PASS solve for a pond that needs
 * both: solve + apply detention (mitTargetCf: 0) first, then re-invoke
 * sizePondForTargets against the UPDATED pond (detTargetCf: 0) so the mitigation remedy
 * is computed — and applied — against what the pond actually is now, never stale deltas.
 * This function itself only ever needs to apply ONE growth-type remedy per call under
 * that calling convention; if both kinds are ever passed together anyway, deepen/pinch-
 * off's absolute depth wins (applied after raise-tob) rather than silently combining two
 * numbers that don't add.
 *
 * `actions` is sizePondForTargets' own `.actions` array; `el` is a rect
 * ({cx,cy,w,h,rot}) or polygon ({points}) pond element — never mutated, a patched copy
 * is returned. Pure. */
export function applyPondSizingActions(el, actions = []) {
  let out = el;
  const raiseA = actions.find((a) => a.kind === "raise-tob");
  const deepenA = actions.find((a) => a.kind === "deepen");
  const growA = actions.find((a) => a.kind === "grow");
  const pinchA = actions.find((a) => a.kind === "pinch-off");

  if (raiseA) {
    const det0 = out.det || {};
    if (Number.isFinite(det0.tobElev)) {
      const newTob = Math.round((det0.tobElev + raiseA.hFt) * 100) / 100;
      const newDepth = (Number.isFinite(det0.depth) ? det0.depth : 8) + raiseA.hFt;
      out = { ...out, det: { ...out.det, tobElev: newTob, depth: newDepth, tobBerm: { h: raiseA.hFt, applied: newTob } } };
    }
  }
  if (deepenA) out = { ...out, det: { ...out.det, depth: deepenA.depthFt } };
  else if (pinchA) out = { ...out, det: { ...out.det, depth: pinchA.maxDepthFt } };
  if (growA) {
    out = el.points
      ? { ...out, points: scaleRing(el.points, growA.factor) }
      : { ...out, w: out.w * growA.factor, h: out.h * growA.factor };
  }
  return out;
}
