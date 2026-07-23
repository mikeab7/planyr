/* PR-G — the BUILDABLE ENVELOPE: the intersection of the hard physical limits a
 * detention-pond design must live inside, plus the soft geotech screen. Optimize NEVER
 * produces a design outside the hard envelope; the top-line GREEN verdict REQUIRES the
 * required volume be met by a design entirely inside it. Pure — the caller (SitePlanner)
 * owns context/memos; nothing here mutates or fetches.
 *
 *   (a) inflow drainage cap  — SOFT (PR-O/O2): a rim above the elevation the tributary site can
 *                              drain into by gravity is ALLOWED with inlets through the berm to
 *                              convey runoff (standard practice) — an advisory, never a hard block.
 *                              This is the ONE gravity-inflow rule the design evaluator AND the
 *                              optimizer share, so they can never disagree (was: a hard cap here
 *                              while the design showed only an advisory chip).
 *   (c) outfall / tailwater  — the low-flow outlet invert must sit AT/ABOVE the 100-yr
 *                              receiving-water (tailwater) elevation; storage below it is
 *                              DEAD (no gravity discharge, so it earns no detention credit). HARD.
 *   (d) max excavation depth — SOFT: a water depth beyond the screen (default 12 ft)
 *                              warns of groundwater / dewatering, never a hard block.
 *
 * PR-K — the FLOODWAY case is no longer a hard geometric cap. A mapped regulatory floodway
 * (NFHL ZONE_SUBTY = "FLOODWAY") does NOT prohibit fill: 44 CFR 60.3(d)(3) allows fill/berm
 * WITH a no-rise certification (an engineering study proving the work adds zero rise to the
 * 100-yr flood level). So a berm in the floodway is BUILDABLE, but it raises a REQUIREMENT
 * that keeps the verdict amber until the study is provided — it never caps the rim or blocks
 * the solver. Approximate Zone A and the 1% fringe (Zone AE outside a floodway) allow fill
 * with compensating storage and don't belong here at all (the caller handles that debt via
 * the mitigation ledger).
 *
 * Elevations are feet NAVD88; depths are feet. A `null`/non-finite input simply doesn't
 * constrain (unknown ≠ violated) — LOUD-FAILURE is the caller's job (it surfaces the
 * missing-fact banners); this layer only judges the facts it's given.
 */

const F1 = (n) => (Math.round(n * 10) / 10).toFixed(1);

/* PR-K — the plain-English definition of a no-rise certification, spelled out inline the
 * first time the term appears (owner copy rule). Reused by the requirement label + chip. */
export const NO_RISE_CERT_DEF =
  "a no-rise certification (an engineering study showing the berm adds zero rise to the 100-yr flood level)";

// Soft geotech screen: water deeper than this likely sits below seasonal groundwater.
export const DEFAULT_MAX_EXCAV_DEPTH_FT = 12;
// A design is judged "at" a cap within this tolerance (survey/rounding noise).
export const ENVELOPE_TOL_FT = 0.05;

/* The highest top-of-bank ELEVATION a buildable design may reach — the intersection of
 * every hard rim limit. Any finite input caps it; null inputs don't constrain. Returns
 * null when nothing constrains the rim (the caller then falls back to its own clamp).
 * PR-K: the floodway is NOT a rim cap — a floodway berm is allowed with a no-rise cert, so
 * only the physical drainage / geometric ceilings bound the rim here. */
export function rimCapElevFt({ drainageCapElevFt = null, geometricCeilingElevFt = null } = {}) {
  const caps = [];
  if (Number.isFinite(drainageCapElevFt)) caps.push(drainageCapElevFt);
  if (Number.isFinite(geometricCeilingElevFt)) caps.push(geometricCeilingElevFt);
  return caps.length ? Math.min(...caps) : null;
}

/* Assess a concrete design against the envelope.
 * Returns { buildable, hard[], soft[], requirements[] } where each entry is { code, label }.
 * `buildable` is false iff any HARD limit (a or c) is violated. Soft (d) never blocks.
 * PR-K: a floodway berm is a REQUIREMENT (no-rise cert), not a hard block — the design is
 * buildable, but a top-line green verdict must wait on the requirement being cleared. The
 * caller keeps the verdict amber while `requirements` is non-empty. */
export function assessBuildability({
  tobElev = null,
  gradeFt = null,
  floorElev = null,
  inFloodway = false,
  drainageCapElevFt = null,
  tailwaterFt = null,
  outletInvertFt = null,
  waterDepthFt = null,
  maxExcavDepthFt = DEFAULT_MAX_EXCAV_DEPTH_FT,
  tol = ENVELOPE_TOL_FT,
} = {}) {
  const hard = [];
  const soft = [];
  const requirements = [];

  // (b) floodway berm — a rim bermed above existing grade inside a MAPPED regulatory floodway.
  // NOT a hard cap: fill is allowed here with a no-rise certification (44 CFR 60.3(d)(3)). It's a
  // REQUIREMENT that keeps the verdict amber until the study is provided; the solver may still berm.
  if (inFloodway && Number.isFinite(tobElev) && Number.isFinite(gradeFt) && tobElev > gradeFt + tol) {
    requirements.push({
      code: "floodway-no-rise",
      label: `The berm sits in a mapped regulatory floodway, so it needs ${NO_RISE_CERT_DEF}. Net-excavation ponds often qualify; plan on the study before this is approvable.`,
    });
  }

  // (a) inflow drainage cap — SOFT advisory (PR-O/O2): a rim above the surface-drainage level is
  // allowed WITH inlets through the berm to convey runoff (standard practice). Same rule the design
  // chip uses, so the evaluator and the optimizer agree — never a hard block that contradicts the chip.
  if (Number.isFinite(drainageCapElevFt) && Number.isFinite(tobElev) && tobElev > drainageCapElevFt + tol) {
    soft.push({
      code: "drainage-inlets",
      // O1 — grammatically complete: the elevation is a labeled clause, not a bare number as a noun.
      label: `Rim ${F1(tobElev)}′ is above ${F1(drainageCapElevFt)}′, the highest rim the site drains into by surface flow; above it, plan on inlets through the berm to convey runoff into the pond (standard practice).`,
    });
  }

  // (c) outfall / tailwater — the low-flow outlet invert below the 100-yr receiving water.
  const invert = Number.isFinite(outletInvertFt) ? outletInvertFt : floorElev;
  if (Number.isFinite(tailwaterFt) && Number.isFinite(invert) && invert < tailwaterFt - tol) {
    hard.push({
      code: "outfall-tailwater",
      label: `Outlet ${F1(invert)}′ is below the 100-yr receiving water ${F1(tailwaterFt)}′: can't discharge by gravity. Needs a pump station, a higher outfall, or a shallower pond.`,
    });
  }

  // (d) deep excavation — SOFT: warn only, never block.
  if (Number.isFinite(waterDepthFt) && Number.isFinite(maxExcavDepthFt) && waterDepthFt > maxExcavDepthFt + tol) {
    soft.push({
      code: "deep-excavation",
      label: `Pond ${F1(waterDepthFt)}′ deep: likely below seasonal groundwater. Expect a wet bottom / dewatering and a side-slope review.`,
    });
  }

  return { buildable: hard.length === 0, hard, soft, requirements };
}

/* PR-K — one flat AMBER sentence for a floodway (or other) REQUIREMENT that blocks a green
 * verdict without capping the design: names the requirement(s), no "make it buildable" escape
 * list (the design already IS buildable — it just needs the certification). Pure copy. */
export function requirementNote({ requirements = [] } = {}) {
  return requirements.map((r) => r.label).join(" ");
}

/* The AMBER "not buildable as drawn" heading (G2): the volume is met but only by a design
 * that breaks a hard limit. Never GREEN. Pure copy. */
export function unbuildableHeading({ requiredAcFt = null } = {}) {
  const y = Number.isFinite(requiredAcFt) ? `${F1(requiredAcFt)} ac-ft` : "required";
  return `Meets the ${y} volume, but not buildable as drawn`;
}

/* The make-it-buildable options sentence (G2/G3). Pure copy. */
export function makeItBuildableOptions({ extraAcres = null } = {}) {
  const enlarge = Number.isFinite(extraAcres) && extraAcres > 0 ? `enlarge the pond by ~${F1(extraAcres)} ac` : "enlarge the pond";
  return `To make it buildable: ${enlarge}, add a second basin, raise the outfall or add a pump, or provide inlets through the berm.`;
}

/* One flat AMBER sentence for the Optimize toast / persistent card (G3): reasons + options. */
export function unbuildableNote({ hard = [], extraAcres = null } = {}) {
  const reasons = hard.map((h) => h.label).join(" ");
  return `${reasons ? reasons + " " : ""}${makeItBuildableOptions({ extraAcres })}`;
}
