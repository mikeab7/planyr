/* v3 D1 (owner 2026-07-22) — INWARD berm geometry (outer-toe model).
 *
 * The polygon the user DRAWS is the FIXED OUTER TOE of the berm = the outer limit of all
 * disturbance. It never moves and NOTHING is computed or drawn outside it (this replaces the
 * old C4 model, where the drawn ring was the water and a maintenance berm grew OUTWARD).
 *
 * When the rim (top of bank) rises `h` ft above existing grade, the berm occupies a ring INSIDE
 * the boundary: from the outer toe the exterior face rises inward at the berm's exterior slope to
 * the crest, so the CREST (top of bank) is the toe ring offset INWARD by `extSlope · h`. Inside
 * the crest the interior face descends at the pond's interior side slope to the bottom. Net
 * effect: as the berm grows the water surface + usable bottom SHRINK inward — diminishing returns
 * — until a hard GEOMETRIC CEILING where the crest ring pinches to nothing (the exterior faces
 * meet): that height is the true maximum berm this footprint can carry.
 *
 * Pure geometry only — world-feet in, numbers/rings out; no React, no DOM, no storage math (the
 * volume integration reuses pondGeom by feeding it the crest ring this module returns). The
 * exterior berm slope is a fixed screening default here (Standards-adjustable later); the interior
 * slope stays the pond's own `det.slope`. */
import { offsetInward, ringsArea, maxInwardOffset } from "./pondOffset.js";
import { polyArea } from "./polygonSplit.js";

// Exterior berm face run:rise (screening default). A 3:1 embankment is the common civil default;
// kept separate from the interior side slope so a future Standards value can differ.
export const EXT_BERM_SLOPE = 3;
const EPS_FT = 0.02;

/* The geometric ceiling: the tallest berm this fixed footprint can carry before the crest ring
 * pinches to a point/line (the exterior faces meet). Beyond it the pond has closed in on itself.
 * = the maximum inward offset of the toe ring / the exterior slope. Feet. 0 for a bad ring. */
export function geometricMaxBermFt(toeRing, extSlope = EXT_BERM_SLOPE) {
  if (!Array.isArray(toeRing) || toeRing.length < 3 || !(extSlope > 0)) return 0;
  return maxInwardOffset(toeRing) / extSlope;
}

/* The crest (top-of-bank) ring(s) when the berm rises `bermH` ft above grade: the toe ring offset
 * inward by `extSlope · bermH`. Returns an ARRAY of rings (offsetInward can split a concave
 * footprint or, past the geometric ceiling, PINCH to `[]`). `bermH <= 0` → the toe ring itself. */
export function crestRingForBerm(toeRing, bermH, extSlope = EXT_BERM_SLOPE) {
  if (!Array.isArray(toeRing) || toeRing.length < 3) return [];
  if (!(bermH > EPS_FT)) return [toeRing.map((p) => ({ x: p.x, y: p.y }))];
  return offsetInward(toeRing, extSlope * bermH);
}

/* The single LARGEST crest ring — the effective top-of-bank the storage integrator (pondGeom's
 * detentionStorage / bandedStorage on this ring) treats as the pond's rim. `null` when the berm
 * has pinched the footprint closed. Most basins stay a single ring; a split footprint keeps the
 * dominant pool for the screening volume (the areas below still sum all rings). */
export function crestTopRing(toeRing, bermH, extSlope = EXT_BERM_SLOPE) {
  const rings = crestRingForBerm(toeRing, bermH, extSlope);
  if (!rings.length) return null;
  let best = rings[0], bestA = polyArea(rings[0]);
  for (let i = 1; i < rings.length; i++) { const a = polyArea(rings[i]); if (a > bestA) { bestA = a; best = rings[i]; } }
  return best;
}

/* True once the berm is tall enough that the crest ring has pinched off (footprint closed). */
export function bermPinched(toeRing, bermH, extSlope = EXT_BERM_SLOPE) {
  if (!(bermH > EPS_FT)) return false;
  return crestRingForBerm(toeRing, bermH, extSlope).length === 0;
}

/* The open-water surface area (sf) at the crest when the berm rises `bermH` ft — the toe area
 * shrunk inward by the berm. Monotonically DECREASES as `bermH` grows (the D1 invariant). 0 once
 * the footprint has pinched closed. */
export function bermWaterAreaSf(toeRing, bermH, extSlope = EXT_BERM_SLOPE) {
  const rings = crestRingForBerm(toeRing, bermH, extSlope);
  return rings.length ? ringsArea(rings) : 0;
}

/* The berm-ring footprint area (sf): the annulus INSIDE the toe, between the drawn boundary and
 * the crest. = drawn footprint − water surface. Grows as the berm rises; water + berm ring always
 * sum to the fixed drawn footprint. */
export function bermRingAreaSf(toeRing, bermH, extSlope = EXT_BERM_SLOPE) {
  if (!Array.isArray(toeRing) || toeRing.length < 3) return 0;
  return Math.max(0, polyArea(toeRing) - bermWaterAreaSf(toeRing, bermH, extSlope));
}

/* v3 D5 (owner 2026-07-22) — the DRAINAGE cap on berm height. There is no user "max berm" input;
 * the cap is COMPUTED. Runoff must reach the pond by gravity, so the design water surface can't
 * climb above the lowest grade in the pond's tributary area (minus an inflow head allowance) —
 * above that the low ground can no longer drain in. controllingInflowElevFt is that lowest
 * controlling grade (a screening proxy: min terrain grade along the pond's contributing edge);
 * gradeAtPondFt is the pond's own existing grade. Returns the drainage-capped berm height (ft),
 * or `null` when the controlling grade is unknown (no terrain data) — then only the geometric
 * ceiling binds. inflowHeadFt is an adopted-criteria default (Standards, EST). Pure. */
export const INFLOW_HEAD_ALLOWANCE_FT = 0.5;
export function drainageBermCapFt({ controllingInflowElevFt = null, gradeAtPondFt = null, freeboardFt = 1, inflowHeadFt = INFLOW_HEAD_ALLOWANCE_FT } = {}) {
  if (!Number.isFinite(controllingInflowElevFt) || !Number.isFinite(gradeAtPondFt)) return null;
  const maxWseFt = controllingInflowElevFt - inflowHeadFt; // above this, low ground can't drain in
  const maxRimFt = maxWseFt + (Number.isFinite(freeboardFt) ? freeboardFt : 1);
  return Math.max(0, maxRimFt - gradeAtPondFt);
}

/* PR-O/O2 — the HARD berm cap is the GEOMETRIC ceiling ALONE. The drainage (gravity-inflow) limit is
 * NOT a hard cap: berming above it is standard practice WITH inlets through the berm to convey runoff.
 * So it rides along as an ADVISORY (`drainageAdvisoryFt`) surfaced when the berm exceeds it — the ONE
 * shared rule the design evaluator and the optimizer both read, so they can never disagree (was: the
 * drainage cap hard-capped the optimizer at 0.0 while the design showed only an advisory chip). A null
 * geometric cap (no footprint pinch known) leaves nothing binding. Pure. */
export function bindingBermCap({ drainageCapFt = null, geometricCapFt = null } = {}) {
  const geo = Number.isFinite(geometricCapFt) && geometricCapFt > 0 ? geometricCapFt : null;
  return { capFt: geo, binding: geo != null ? "geometry" : "none", drainageAdvisoryFt: Number.isFinite(drainageCapFt) ? drainageCapFt : null };
}

/* PR-O/O2 — the ONE shared gravity-inflow rule: is the rim above the surface-drainage level (so it
 * needs inlets through the berm)? Both the evaluator and the optimizer call this, so their berm stance
 * is identical by construction. Pure. `drainageCapHFt` is the drainage-capped berm HEIGHT above grade
 * (from drainageBermCapFt); `bermHFt` is the design/proposed berm height. */
export const INLETS_THROUGH_BERM_NOTE =
  "assumes inlets through the berm convey runoff into the pond (standard practice above the surface-drainage level)";
export function bermNeedsInlets({ bermHFt = null, drainageCapHFt = null, tol = 0.05 } = {}) {
  return Number.isFinite(bermHFt) && Number.isFinite(drainageCapHFt) && bermHFt > drainageCapHFt + tol;
}

/* The full inward split at one berm height: the fixed footprint, the (shrunk) water surface, the
 * berm-ring annulus, the crest ring(s) for rendering, whether it has pinched, and the geometric
 * ceiling. One call for the panel rows (D2) + the on-plan ring (D3). Pure. */
export function inwardBermSplit(toeRing, bermH, { extSlope = EXT_BERM_SLOPE } = {}) {
  const footprintSf = Array.isArray(toeRing) && toeRing.length >= 3 ? polyArea(toeRing) : 0;
  const crestRings = crestRingForBerm(toeRing, bermH, extSlope);
  const waterSf = crestRings.length ? ringsArea(crestRings) : 0;
  return {
    footprintSf,
    waterSf,
    bermRingSf: Math.max(0, footprintSf - waterSf),
    crestRings,
    pinched: bermH > EPS_FT && crestRings.length === 0,
    geometricMaxBermFt: geometricMaxBermFt(toeRing, extSlope),
  };
}
