/* THE per-pond STAGE-STORAGE / ELEVATION-BAND representation (Cowork yield review, NEW-1/3/5/6).
 *
 * The review's cross-cutting build note: detention, mitigation, drawdown, gravity-drain and
 * cut/fill must all read ONE per-pond elevation model rather than each re-deriving storage from
 * footprints. This module IS that model. It sits directly on top of pondGeom's proven primitives
 * (`volumeBetween` → robust clipper inward offsets + average-end-area slabs), so a band here can
 * never disagree with `bandedStorage` / `detentionStorage` — it is the same integral, sliced.
 *
 * What it adds over pondGeom:
 *   stageTable        — the pond's storage as a stack of 1-ft (configurable) elevation bands from
 *                       the achievable floor to the top of bank: area at each end, band volume,
 *                       cumulative volume. Everything below reads THIS.
 *   dutySplit         — the NEW-1 non-overlapping duty split for a pond that serves BOTH duties:
 *                       a MITIGATION band from the floor up to the governing flood elevation, and a
 *                       DETENTION band stacked strictly above it. Overlap is impossible by
 *                       construction (the bands share one boundary elevation), and the function
 *                       reports the boundary so the panel can name it.
 *   outfallSplit      — NEW-6: storage above vs below the outfall INVERT. Below-invert volume is
 *                       dead (it cannot gravity-drain), so it is excluded from mitigation credit
 *                       entirely and it is what the 50%-gravity detention test is measured against.
 *   gravityTests      — NEW-6: the two jurisdictional tests. FBC Interim Atlas-14 — at least 50% of
 *                       DETENTION storage must drain by gravity outfall. FBC §5.02(h)(1) —
 *                       MITIGATION storage must FULLY gravity-drain (pumps not allowed).
 *   prismVsExtrusion  — NEW-5: the honesty delta between the naive footprint × depth extrusion and
 *                       the real sloped-prism-with-freeboard volume. The prism number is what the
 *                       app already uses; this surfaces HOW MUCH a straight-down read would have
 *                       over-stated, so an over-optimistic pond is visible instead of silently
 *                       inflating an OK.
 *
 * LOUD-FAILURE: every function returns `null` (or a `known:false` payload) when the facts it needs
 * are missing — an unanchored pond, an unknown invert, an unknown flood elevation. It never
 * substitutes a zero or a guess for a fact it does not have.
 *
 * Pure: world-feet geometry in, cubic feet + ft-NAVD88 out. No React, no DOM, Node-testable.
 */
import { polyArea } from "./polygonSplit.js";
import { offsetInward, ringsArea, maxInwardOffset } from "./pondOffset.js";
import { volumeBetween } from "./pondGeom.js";

const EPS = 1e-6;
export const CF_PER_ACFT = 43560;
export const SQFT_PER_ACRE = 43560;

const detOf = (det = {}) => ({
  depth: det.depth != null ? det.depth : 8,
  freeboard: det.freeboard != null ? det.freeboard : 1,
  slope: det.slope != null ? det.slope : 3,
});

/* The pond's KEY ELEVATIONS, resolved once (the same precedence bandedStorage uses):
 *   tobElev     drawn top of bank (the anchor — null means the pond is unanchored)
 *   waterSurfElev  design water surface = tob − freeboard
 *   floorElev   achievable floor = tob − min(design depth, what the footprint can grade to)
 * Returns null when unanchored — never a fabricated datum. Pure. */
export function pondElevations(ring, det = {}) {
  const tob = det.tobElev;
  if (tob == null || !Number.isFinite(tob)) return null;
  if (!Array.isArray(ring) || ring.length < 3) return null;
  const { depth, freeboard, slope } = detOf(det);
  const maxDepth = slope > 0 ? maxInwardOffset(ring) / slope : 0;
  const achievableDepth = Math.min(depth, maxDepth);
  return {
    tobElev: tob,
    waterSurfElev: tob - freeboard,
    floorElev: tob - achievableDepth,
    designDepthFt: depth,
    achievableDepthFt: achievableDepth,
    maxDepthFt: maxDepth,
    freeboardFt: freeboard,
    slopeRatio: slope,
    pinched: depth > maxDepth + 0.05,
  };
}

/* THE stage table: the pond's storage sliced into `bandFt` elevation bands from the achievable
 * floor up to the design WATER SURFACE (storage above the water surface is freeboard, which by
 * definition holds nothing at design stage — including it would be exactly the over-count NEW-5
 * exists to stop). Bands run BOTTOM-UP so `cumCf` reads as "storage available at this stage".
 *
 * Each band: { loFt, hiFt, midFt, areaLoSf, areaHiSf, volCf, cumCf }.
 * The final band's `cumCf` equals detentionStorage(...).vol for the same pond (same integral).
 *
 * Returns null when the pond is unanchored (no top-of-bank elevation) — the caller must fall back
 * to a labeled estimate, never silently to gross. Pure. */
export function stageTable(ring, det = {}, { bandFt = 1 } = {}) {
  const el = pondElevations(ring, det);
  if (!el) return null;
  const step = bandFt > 0 ? bandFt : 1;
  const bottom = el.floorElev, top = el.waterSurfElev;
  const bands = [];
  let cum = 0;
  if (top > bottom + EPS) {
    for (let lo = bottom; lo < top - EPS; lo += step) {
      const hi = Math.min(lo + step, top);
      const volCf = volumeBetween(ring, det, lo, hi) || 0;
      cum += volCf;
      bands.push({
        loFt: lo,
        hiFt: hi,
        midFt: (lo + hi) / 2,
        areaLoSf: areaAtElev(ring, det, lo),
        areaHiSf: areaAtElev(ring, det, hi),
        volCf,
        cumCf: cum,
      });
    }
  }
  return { bands, totalCf: cum, bandFt: step, ...el };
}

/* Wetted area (sf) of the basin at an absolute elevation — the drawn ring offset inward by
 * slope × (depth below top of bank). 0 at/below the pinch-off. Pure. */
export function areaAtElev(ring, det = {}, elevFt) {
  const el = pondElevations(ring, det);
  if (!el || !Number.isFinite(elevFt)) return 0;
  const down = el.tobElev - elevFt;
  if (down <= 0) return polyArea(ring);
  if (elevFt < el.floorElev - EPS) return 0;
  return ringsArea(offsetInward(ring, el.slopeRatio * down));
}

/* NEW-1 — the DUTY SPLIT: the explicit, non-overlapping vertical division of a pond that serves
 * both duties. The same acre-foot slice can never be credited to both, because the two bands are
 * defined by ONE shared boundary elevation:
 *
 *   ── design water surface ───────────────────────────┐
 *        DETENTION band  (boundary → water surface)    │ stacked above
 *   ── governing flood elevation (the boundary) ───────┤ ← declared, single, shared
 *        MITIGATION band (floor → boundary)            │ below
 *   ── achievable floor ───────────────────────────────┘
 *
 * `floodElevFt` is the governing flood surface at this pond (the jurisdiction's mitigation trigger
 * surface — see mitigationTriggerSurface in floodplainRules.js; the 500-yr line under FBC's Interim
 * Atlas-14 criteria, not automatically the 100-yr). Null → there is no flood at this pond, so the
 * whole column is detention and the mitigation band is a real 0 (not an unknown).
 *
 * Returns { boundaryElevFt, detentionCf, mitigationCf, totalCf, declared, overlapCf: 0 } — overlap
 * is reported as an explicit 0 so a caller can assert the invariant rather than assume it. Pure. */
export function dutySplit(ring, det = {}, { floodElevFt = null } = {}) {
  const el = pondElevations(ring, det);
  if (!el) return null;
  const totalCf = volumeBetween(ring, det, el.floorElev, el.waterSurfElev) || 0;
  if (floodElevFt == null || !Number.isFinite(floodElevFt)) {
    return {
      boundaryElevFt: null, declared: false,
      detentionCf: totalCf, mitigationCf: 0, totalCf, overlapCf: 0,
    };
  }
  // The boundary is CLAMPED into the pond's own column: a flood above the water surface leaves no
  // detention band, one below the floor leaves no mitigation band. Either way the two still sum to
  // the total exactly.
  const boundary = Math.max(el.floorElev, Math.min(floodElevFt, el.waterSurfElev));
  const mitigationCf = boundary > el.floorElev + EPS ? (volumeBetween(ring, det, el.floorElev, boundary) || 0) : 0;
  const detentionCf = el.waterSurfElev > boundary + EPS ? (volumeBetween(ring, det, boundary, el.waterSurfElev) || 0) : 0;
  return {
    boundaryElevFt: boundary,
    boundaryRequestedFt: floodElevFt,
    boundaryClamped: Math.abs(boundary - floodElevFt) > 0.01,
    declared: true,
    detentionCf, mitigationCf, totalCf,
    // By construction the bands share one boundary → zero overlap. Reported, not assumed.
    overlapCf: Math.max(0, detentionCf + mitigationCf - totalCf),
  };
}

/* NEW-6 — split the pond's storage ABOVE vs BELOW the outfall INVERT. Storage below the invert
 * cannot leave by gravity: it is DEAD storage. Two jurisdictional consequences ride this split
 * (see gravityTests), so it is computed once here.
 *
 * `outletInvertFt` null → `known:false`. That is the honest state for a pond with no outlet
 * modeled yet; the caller must say "invert not set", never assume the floor. Pure. */
export function outfallSplit(ring, det = {}, { outletInvertFt = null } = {}) {
  const el = pondElevations(ring, det);
  if (!el) return null;
  const totalCf = volumeBetween(ring, det, el.floorElev, el.waterSurfElev) || 0;
  if (outletInvertFt == null || !Number.isFinite(outletInvertFt)) {
    return { known: false, invertFt: null, aboveInvertCf: null, belowInvertCf: null, deadCf: null, gravityShare: null, totalCf };
  }
  const invert = Math.max(el.floorElev, Math.min(outletInvertFt, el.waterSurfElev));
  const belowInvertCf = invert > el.floorElev + EPS ? (volumeBetween(ring, det, el.floorElev, invert) || 0) : 0;
  const aboveInvertCf = el.waterSurfElev > invert + EPS ? (volumeBetween(ring, det, invert, el.waterSurfElev) || 0) : 0;
  return {
    known: true,
    invertFt: invert,
    invertRequestedFt: outletInvertFt,
    invertClamped: Math.abs(invert - outletInvertFt) > 0.01,
    aboveInvertCf,
    belowInvertCf,
    deadCf: belowInvertCf, // below the invert = dead storage (never mitigation-creditable)
    gravityShare: totalCf > EPS ? aboveInvertCf / totalCf : null,
    totalCf,
  };
}

// FBC Interim Atlas-14 criteria: at least 50% of DETENTION storage must drain by gravity outfall.
export const DEFAULT_MIN_GRAVITY_SHARE = 0.5;

/* NEW-6 — the two gravity-drain tests, run off one outfallSplit.
 *
 *   detention  — FBC Interim Atlas-14: ≥ `minGravityShare` (default 50%) of the DETENTION storage
 *                must drain by gravity outfall. Measured on the storage above the invert as a share
 *                of the detention duty band (not the whole pond — the mitigation band is tested by
 *                its own, stricter rule).
 *   mitigation — FBC §5.02(h)(1): mitigation storage must FULLY gravity-drain as floodwaters recede
 *                so full capacity is available for subsequent flood events. Pumps are NOT allowed.
 *                ANY mitigation volume below the invert fails, at any size above the tolerance.
 *
 * Both return `{ known, pass, ... }` — `known:false` (never a pass) when the invert is unset. Pure. */
export function gravityTests({ split, duty, minGravityShare = DEFAULT_MIN_GRAVITY_SHARE, tolCf = 1 } = {}) {
  if (!split || !duty) return null;
  if (!split.known) {
    return {
      known: false,
      detention: { known: false, pass: null, share: null, required: minGravityShare },
      mitigation: { known: false, pass: null, deadCf: null },
      reason: "outfall invert not set — gravity drainage cannot be screened",
    };
  }
  const invert = split.invertFt;
  const detBandCf = duty.detentionCf;
  const mitBandCf = duty.mitigationCf;
  // Detention gravity share: the part of the DETENTION band that sits above the invert.
  const detAboveCf = Math.max(0, Math.min(split.aboveInvertCf, detBandCf));
  const detShare = detBandCf > tolCf ? detAboveCf / detBandCf : null;
  // Mitigation dead volume: the part of the MITIGATION band that sits at/below the invert.
  const mitDeadCf = duty.boundaryElevFt != null && invert > duty.boundaryElevFt
    ? mitBandCf                                        // the whole mitigation band is under the invert
    : Math.max(0, Math.min(split.belowInvertCf, mitBandCf));
  return {
    known: true,
    invertFt: invert,
    detention: {
      known: detShare != null,
      pass: detShare == null ? null : detShare >= minGravityShare - 1e-9,
      share: detShare,
      required: minGravityShare,
      gravityCf: detAboveCf,
      bandCf: detBandCf,
      basis: "FBC Interim Atlas-14 criteria — at least 50% of detention storage must drain by gravity outfall.",
    },
    mitigation: {
      known: true,
      // "FULLY gravity-drain" — any dead mitigation volume above the tolerance fails.
      pass: mitBandCf <= tolCf ? true : mitDeadCf <= tolCf,
      deadCf: mitDeadCf,
      bandCf: mitBandCf,
      // Dead mitigation volume earns NO credit at all (it cannot be re-emptied for the next event).
      creditableCf: Math.max(0, mitBandCf - mitDeadCf),
      basis: "FBC Flood Damage Prevention Regs §5.02(h)(1) — mitigation storage must fully gravity-drain as floodwaters recede so full capacity is available for subsequent flood events; pumps are not allowed.",
    },
  };
}

/* NEW-5 — the naive-vs-real volume delta. `extrudedCf` is what a straight-down extrusion of the
 * drawn footprint would claim (footprint area × design depth — vertical walls, no freeboard taken
 * off the top); `prismCf` is the real sloped-prism storage the app computes. The delta is the
 * over-statement a footprint × depth read would have carried — worst on acute-cornered triangular
 * ponds, where the inward offset eats the corners fastest.
 *
 * `avgDepthFt` back-reports the prism volume divided by the TOP-OF-BANK footprint — the number a
 * reader can sanity-check against the drawn acreage (the review's "115.4 ac-ft on 7.92 ac = 14.6 ft"
 * catch). Pure. */
export function prismVsExtrusion(ring, det = {}) {
  const el = pondElevations(ring, det);
  if (!el) return null;
  const footprintSf = polyArea(ring);
  const extrudedCf = footprintSf * el.designDepthFt;
  const prismCf = volumeBetween(ring, det, el.floorElev, el.waterSurfElev) || 0;
  const deltaCf = extrudedCf - prismCf;
  return {
    footprintSf,
    footprintAc: footprintSf / SQFT_PER_ACRE,
    extrudedCf,
    prismCf,
    deltaCf,
    deltaPct: extrudedCf > EPS ? deltaCf / extrudedCf : null,
    // Average depth of the REAL prism over the top-of-bank footprint — the reader's sanity check.
    avgDepthFt: footprintSf > EPS ? prismCf / footprintSf : null,
    designDepthFt: el.designDepthFt,
    achievableDepthFt: el.achievableDepthFt,
    freeboardFt: el.freeboardFt,
    slopeRatio: el.slopeRatio,
    pinched: el.pinched,
  };
}

/* Assemble the WHOLE per-pond model in one call — the shape every downstream consumer (site
 * reconciliation, drawdown, mitigation banding, cut/fill) reads, so no consumer re-derives storage
 * from a footprint. Returns null when the pond is unanchored. Pure. */
export function pondStageModel(ring, det = {}, { floodElevFt = null, outletInvertFt = null, bandFt = 1, minGravityShare = DEFAULT_MIN_GRAVITY_SHARE, id = null, name = null } = {}) {
  const stage = stageTable(ring, det, { bandFt });
  if (!stage) return null;
  const duty = dutySplit(ring, det, { floodElevFt });
  const split = outfallSplit(ring, det, { outletInvertFt });
  const gravity = gravityTests({ split, duty, minGravityShare });
  const prism = prismVsExtrusion(ring, det);
  return { id, name, stage, duty, outfall: split, gravity, prism, totalCf: stage.totalCf };
}
