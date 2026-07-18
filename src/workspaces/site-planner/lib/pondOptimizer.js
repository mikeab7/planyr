/* NEW-D1 — pond economics optimizer. Given a required detention volume + the site constraints,
 * it searches alternative pond configurations and ranks them by what actually matters to a deal:
 * earthwork $, land-take acres, and buildable-SF recovered — using the SAME volume/excavation
 * machinery the ledger uses (pondGeom), so an alternative can never quote a volume the rest of
 * the app disagrees with.
 *
 * The search axes (screening):
 *   • deeper-smaller vs shallower-bigger — for each candidate DEPTH, solve the footprint scale
 *     that just holds the required volume (a deep basin needs less land but more $/cy and can
 *     pinch off; a shallow one needs more land). Bounded by max depth, the Phase-B GROUNDWATER
 *     ceiling (a wet pond can't go below the water table for dry storage), and the geometric
 *     pinch-off (maxInwardOffset/slope).
 *   • placement variants — the caller may pass alternative base rings (a pond in a different
 *     corner); each is searched over the depth axis.
 *   • pond-cut-as-pad-fill dirt balance — the basin excavation can fill the building pad; a
 *     candidate whose cut ≈ the pad's fill need hauls the least dirt (the balance metric).
 *   • hard placement constraints — a candidate footprint overlapping a pipeline corridor / setback
 *     exclusion ring (RRC corridors, screening) is rejected.
 *
 * Screening only — the owner redraws the winner for real; costs are user-supplied (never
 * fabricated). LOUD-FAILURE: a depth/footprint that can't reach the target is reported
 * infeasible, never a fudged volume. Pure + Node-testable; no DOM/network. */
import { detentionStorage, excavationVolume, pointInRing } from "./pondGeom.js";
import { scaleRing } from "./pondSizing.js";
import { offsetOutward, ringsArea, maxInwardOffset } from "./pondOffset.js";

const SQFT_PER_ACRE = 43560;
const CF_PER_CY = 27;
const num = (v) => (Number.isFinite(v) ? v : null);

const detOf = (det = {}) => ({
  freeboard: Number.isFinite(det.freeboard) ? det.freeboard : 1,
  slope: Number.isFinite(det.slope) ? det.slope : 3,
});

// Screening ring-overlap: bounding boxes touch AND a vertex of one sits inside the other.
function ringsOverlapScreen(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length < 3 || b.length < 3) return false;
  const bb = (r) => r.reduce((o, p) => ({ mnX: Math.min(o.mnX, p.x), mnY: Math.min(o.mnY, p.y), mxX: Math.max(o.mxX, p.x), mxY: Math.max(o.mxY, p.y) }), { mnX: Infinity, mnY: Infinity, mxX: -Infinity, mxY: -Infinity });
  const A = bb(a), B = bb(b);
  if (A.mxX < B.mnX || B.mxX < A.mnX || A.mxY < B.mnY || B.mxY < A.mnY) return false;
  return a.some((p) => pointInRing(p, b)) || b.some((p) => pointInRing(p, a));
}

/* Solve the smallest footprint SCALE that holds `requiredCf` at design `depthFt` (freeboard +
 * slope from det), via bisection over the scale factor. Returns { scale, achievedCf } or null
 * when even `maxScale` can't reach the target at this depth (a too-deep basin pinches off before
 * it holds the volume). Pure. */
export function solveScaleForVolume(ring, det, depthFt, requiredCf, { minScale = 0.15, maxScale = 4, iters = 30 } = {}) {
  const { freeboard, slope } = detOf(det);
  const volAt = (s) => detentionStorage(scaleRing(ring, s), depthFt, freeboard, slope).vol;
  if (volAt(maxScale) < requiredCf) return null; // can't reach the target even at the largest footprint
  if (volAt(minScale) >= requiredCf) return { scale: minScale, achievedCf: volAt(minScale) };
  let lo = minScale, hi = maxScale;
  for (let i = 0; i < iters && hi - lo > 1e-3; i++) {
    const mid = (lo + hi) / 2;
    if (volAt(mid) >= requiredCf) hi = mid; else lo = mid;
  }
  return { scale: hi, achievedCf: volAt(hi) };
}

/* Evaluate ONE candidate (a base ring + a design depth) into its economics. Returns a metrics
 * object or { feasible:false, reason } when a constraint kills it. Pure. */
export function evaluateCandidate({ ring, det, depthFt, requiredCf, maxDepthFt = 20, groundwaterMaxDepthFt = null, maintBermFt = 30, padFillNeedCf = 0, earthworkPerCy = null, coverageRatio = 0.4, baseLandTakeAc = null, forbiddenRings = [] } = {}) {
  const { freeboard, slope } = detOf(det);
  const depthCap = Math.min(num(maxDepthFt) ?? 20, groundwaterMaxDepthFt != null ? groundwaterMaxDepthFt : Infinity);
  if (depthFt > depthCap + 1e-9) return { feasible: false, depthFt, reason: groundwaterMaxDepthFt != null && depthFt > groundwaterMaxDepthFt ? "below the groundwater ceiling (wet pond)" : "deeper than the max depth" };
  const solved = solveScaleForVolume(ring, det, depthFt, requiredCf);
  if (!solved) return { feasible: false, depthFt, reason: `footprint can't hold the target at ${depthFt}′ (pinches off at ${slope}:1)` };
  const footprint = scaleRing(ring, solved.scale);
  // Geometric pinch-off guard: the achievable depth of THIS footprint.
  const footprintMaxDepth = slope > 0 ? maxInwardOffset(footprint) / slope : 0;
  if (depthFt > footprintMaxDepth + 0.1) return { feasible: false, depthFt, reason: "footprint pinches off before this depth" };
  for (const fr of forbiddenRings || []) {
    if (ringsOverlapScreen(footprint, fr)) return { feasible: false, depthFt, reason: "footprint overlaps a pipeline corridor / setback exclusion" };
  }
  const bermRingArr = maintBermFt > 0 ? offsetOutward(footprint, maintBermFt) : [footprint];
  const bermRing = (bermRingArr && bermRingArr[0]) || footprint;
  const landTakeAc = ringsArea([bermRing]) / SQFT_PER_ACRE;
  const excCf = excavationVolume(footprint, { depth: depthFt, slope });
  const excCy = Math.round(excCf / CF_PER_CY);
  // Cost from the DISPLAYED cy (shown-cy × price), so the readout never shows a cost that
  // doesn't match its quantity × unit price.
  const earthworkCost = num(earthworkPerCy) != null ? Math.round(excCy * earthworkPerCy) : null;
  // Dirt balance: the basin cut can fill the pad. netCf > 0 = surplus cut to export; < 0 = fill
  // still needed (import). The best balance is the smallest |imbalance|.
  const netCf = excCf - (num(padFillNeedCf) ?? 0);
  const dirtImbalanceCy = Math.abs(netCf) / CF_PER_CY;
  const buildableSfDelta = baseLandTakeAc != null ? Math.round((baseLandTakeAc - landTakeAc) * SQFT_PER_ACRE * coverageRatio) : null;
  const r = (n, p = 2) => Math.round(n * 10 ** p) / 10 ** p;
  return {
    feasible: true,
    depthFt,
    scale: r(solved.scale, 3),
    achievedAcFt: r(solved.achievedCf / SQFT_PER_ACRE, 3),
    landTakeAc: r(landTakeAc, 3),
    excavationCy: Math.round(excCy),
    earthworkCost,
    netDirtCy: Math.round(netCf / CF_PER_CY),
    dirtImbalanceCy: Math.round(dirtImbalanceCy),
    buildableSfDelta,
    footprint,
  };
}

/* THE optimizer. Searches depth × placement candidates, filters infeasible, ranks by buildable-SF
 * recovered (land efficiency) with earthwork + dirt-balance metrics exposed. Returns
 * { base, alternatives:[…ranked], best, tags:{bestBuildable, cheapest, bestBalance}, caveat } or
 * { ok:false } when nothing is feasible. Pure. */
export function optimizePond({
  baseRing, det = {}, requiredCf,
  maxDepthFt = 20, groundwaterMaxDepthFt = null, maintBermFt = 30, padFillNeedCf = 0,
  costs = {}, forbiddenRings = [], candidateRings = null, coverageRatio = 0.4,
  depthsFt = [6, 8, 10, 12, 15, 18],
} = {}) {
  if (!Array.isArray(baseRing) || baseRing.length < 3) return { ok: false, reason: "no pond footprint" };
  if (!(num(requiredCf) > 0)) return { ok: false, reason: "no required detention volume" };
  const earthworkPerCy = num(costs.earthworkPerCy);
  // Base land-take (the pond as drawn at its current depth) — the buildable-SF-delta reference.
  const { slope } = detOf(det);
  const baseDepth = Number.isFinite(det.depth) ? det.depth : 8;
  const baseBermArr = maintBermFt > 0 ? offsetOutward(baseRing, maintBermFt) : [baseRing];
  const baseLandTakeAc = ringsArea([(baseBermArr && baseBermArr[0]) || baseRing]) / SQFT_PER_ACRE;

  const rings = (Array.isArray(candidateRings) && candidateRings.length ? candidateRings : [baseRing]);
  const alternatives = [];
  const rejected = [];
  rings.forEach((ring, ri) => {
    for (const d of depthsFt) {
      const c = evaluateCandidate({ ring, det, depthFt: d, requiredCf, maxDepthFt, groundwaterMaxDepthFt, maintBermFt, padFillNeedCf, earthworkPerCy, coverageRatio, baseLandTakeAc, forbiddenRings });
      if (c.feasible) alternatives.push({ ...c, placement: ri });
      else rejected.push({ placement: ri, depthFt: d, reason: c.reason });
    }
  });
  if (!alternatives.length) return { ok: false, reason: "no feasible configuration under the constraints", rejected, baseLandTakeAc: Math.round(baseLandTakeAc * 1000) / 1000 };

  // Rank by buildable-SF recovered desc (fall back to smallest land-take when delta is null).
  alternatives.sort((a, b) => (b.buildableSfDelta ?? -a.landTakeAc) - (a.buildableSfDelta ?? -b.landTakeAc) || a.landTakeAc - b.landTakeAc);
  const bestBuildable = alternatives[0];
  const cheapest = earthworkPerCy != null ? alternatives.reduce((a, c) => (c.earthworkCost < a.earthworkCost ? c : a), alternatives[0]) : null;
  const bestBalance = alternatives.reduce((a, c) => (c.dirtImbalanceCy < a.dirtImbalanceCy ? c : a), alternatives[0]);

  return {
    ok: true,
    base: { landTakeAc: Math.round(baseLandTakeAc * 1000) / 1000, depthFt: baseDepth, slope },
    alternatives,
    best: bestBuildable,
    tags: {
      bestBuildable: keyOf(bestBuildable),
      cheapest: cheapest ? keyOf(cheapest) : null,
      bestBalance: keyOf(bestBalance),
    },
    rejected,
    caveat: "Screening optimizer — the owner redraws the chosen configuration; costs are user-supplied, groundwater ceiling from the soils/well screen (Phase B), pipeline corridors are ASSUMED screening bands (field-verify easements).",
  };
}

const keyOf = (c) => (c ? `${c.placement}:${c.depthFt}` : null);
