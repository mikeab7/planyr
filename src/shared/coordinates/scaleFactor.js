/* NEW-4 — GRID vs GROUND: surface the combined scale factor, and flag a survey that looks like it
 * is already in ground coordinates.
 *
 * THE FINDING THIS MODULE EXISTS FOR (audited, not assumed — see docs/COLORADO-AUDIT.md §4).
 * Planyr uses TWO different feet frames and, until now, never said so:
 *   • DRAWN geometry lives in the planner's own frame (site-planner/lib/mapLock.js) — a uniform
 *     scaling of spherical Mercator anchored at the SITE ORIGIN. That frame is ground-true at the
 *     site by construction, so every dimension the user draws is a ground distance.
 *   • SCREENING distances go through the state-plane grid (shared/coordinates) — proximityScreen.js
 *     projects rings and feature points to EPSG:2278 feet and measures there; coverage.js,
 *     fbcdWse.js, deedAlign.js and the thoroughfare ingest do the same.
 * So the app DOES assume grid feet are ground feet wherever it measures on the grid. In Texas that
 * assumption has been correct by accident: Houston sits near 50 ft, whose elevation factor is
 * 0.999998 — about 0.01 ft per mile, unmeasurable at screening. On the Front Range it is not:
 * Denver at ~5,280 ft has a combined factor near 0.99975, roughly 1.3 ft per mile, about nine
 * inches across a 3,000-ft site. Front Range surveys are routinely delivered in modified state
 * plane / ground coordinates with a project combined factor printed on the sheet.
 *
 * ⛔ WHAT THIS MODULE DELIBERATELY DOES NOT DO. It does not apply the factor. A half-applied scale
 * factor — some quantities corrected, others not — is worse than none, because the error stops
 * being a known constant and becomes untraceable. This module REPORTS: the grid factor, the
 * elevation factor, their product, what that is worth over a stated distance, and whether a
 * supplied survey looks like ground rather than grid. Applying it (a true ground/grid transform
 * with a project combined factor and a project origin) is filed and sized separately.
 *
 * Pure. No DOM, no network, Node-testable.
 */

import { gridScaleFactor, resolveZone } from "./statePlane.js";

const US_FT_M = 1200 / 3937;
const D2R = Math.PI / 180;
const GRS80_A = 6378137.0;
const GRS80_F = 1 / 298.257222101;
const E2 = GRS80_F * (2 - GRS80_F);

const num = (v) => (v != null && Number.isFinite(Number(v)) ? Number(v) : null);

/* The earth's geometric-mean radius of curvature at a latitude, in US survey feet — R = √(M·N),
 * the radius surveying practice uses for the elevation factor. (The flat 20,906,000 ft constant in
 * older references is this quantity at mid-latitude.) */
export function earthRadiusFt(lat) {
  const l = num(lat);
  if (l == null) return null;
  const s2 = Math.sin(l * D2R) ** 2;
  const rM = (GRS80_A * Math.sqrt(1 - E2)) / (1 - E2 * s2);   // √(M·N), metres
  return rM / US_FT_M;
}

/* ELEVATION FACTOR — the ratio that takes a distance measured on the ground at height h down to
 * the ellipsoid: EF = R / (R + h). Always ≤ 1 above the ellipsoid.
 *
 * `geoidSeparationFt` matters and is usually omitted: an orthometric (NAVD88) elevation is not an
 * ellipsoid height. Along the Front Range the geoid sits roughly 55–60 ft BELOW the ellipsoid, so
 * ignoring it overstates the elevation factor by about 3 parts per million — 0.015 ft per mile,
 * an order of magnitude smaller than the effect being measured, but not nothing. Pass it when the
 * survey states it; when it is null the result says the separation was not applied. */
export function elevationFactor({ elevationFt = null, lat = null, geoidSeparationFt = null } = {}) {
  const h = num(elevationFt);
  if (h == null) return null;
  const R = earthRadiusFt(lat == null ? 39.7 : lat);
  if (R == null) return null;
  const sep = num(geoidSeparationFt);
  const ellipsoidHt = sep == null ? h : h + sep;
  return {
    factor: R / (R + ellipsoidHt),
    radiusFt: R,
    orthometricFt: h,
    geoidSeparationFt: sep,
    ellipsoidHeightFt: ellipsoidHt,
    geoidApplied: sep != null,
  };
}

/* THE ONE CALL a surface makes: the combined (grid × elevation) factor for a site.
 *
 * Returns `known:false` with a named `missing` list rather than a plausible 1.0 when an input is
 * absent — a silent 1.0 is exactly the "correct by accident" behaviour this module exists to end.
 *
 * `perMileFt` is the number to actually SHOW: how far a mile of ground measures on the grid. It is
 * signed the way a reader expects — positive means the grid distance is SHORTER than the ground
 * distance, which is the normal case above the ellipsoid. */
export function combinedScaleFactor({ zone = null, state = null, county = null, lat = null, lon = null, elevationFt = null, geoidSeparationFt = null } = {}) {
  const z = zone || resolveZone({ state, county, lat, lon });
  const missing = [];
  if (!z) missing.push("state plane zone");
  if (num(lat) == null) missing.push("site latitude");
  if (num(elevationFt) == null) missing.push("site elevation");
  const grid = z && num(lat) != null ? gridScaleFactor(z, lat) : null;
  const elev = elevationFactor({ elevationFt, lat, geoidSeparationFt });
  if (!grid || !elev) {
    return {
      known: false, missing, zone: z || null,
      gridFactor: grid ?? null, elevationFactor: elev ? elev.factor : null, combined: null,
      reason: `combined scale factor not computable — ${missing.length ? `missing ${missing.join(", ")}` : "inputs unusable"}`,
    };
  }
  const combined = grid * elev.factor;
  return {
    known: true,
    zone: z,
    gridFactor: grid,
    elevationFactor: elev.factor,
    elevation: elev,
    combined,
    // A mile of GROUND distance, expressed on the grid, differs from 5,280 ft by this much.
    perMileFt: (1 - combined) * 5280,
    // The same thing over an arbitrary run — what the reader actually asks ("across my site?").
    deltaOver: (groundFt) => (num(groundFt) == null ? null : (1 - combined) * num(groundFt)),
    material: Math.abs(1 - combined) >= MATERIAL_THRESHOLD,
    note:
      `Grid ${grid.toFixed(7)} × elevation ${elev.factor.toFixed(7)} = combined ${combined.toFixed(7)}. ` +
      `Planyr measures drawn geometry on the ground at the site, and screening distances on the ${z.short} grid; ` +
      `the two differ by this factor. Planyr does NOT apply it — a survey in ground coordinates must be reconciled ` +
      `against the project combined factor on the survey sheet.` +
      (elev.geoidApplied ? "" : " Geoid separation was not supplied, so the elevation factor uses the orthometric height directly."),
  };
}

/* The threshold at which the difference stops being noise. 1 part in 20,000 is 0.26 ft per mile —
 * below a screening tool's honest resolution; at and above it, a 3,000-ft site moves by a
 * measurable amount and the reader must be told. Houston (≈2 ppm) sits far below it; Denver
 * (≈250 ppm) far above. */
export const MATERIAL_THRESHOLD = 1 / 20000;

/* GROUND-vs-GRID DETECTION for an imported survey.
 *
 * Given one or more pairs of corresponding measurements — the distance the SURVEY states between
 * two points, and the distance the same two points span on the GRID — the ratio survey÷grid is the
 * survey's own combined factor. If it sits at 1.0000 the survey is on the grid; if it matches the
 * site's computed combined factor the survey is in GROUND coordinates.
 *
 * Returns a verdict of "grid" | "ground" | "other-scale" | "unknown". "other-scale" is deliberate
 * and not a failure: a project can be scaled about a local origin with a factor the surveyor chose
 * rather than the one geometry implies, and saying "this is scaled, but not by the factor your
 * elevation predicts" is far more useful than forcing it into one of the two clean answers. */
export function detectSurveyFrame({ pairs = [], expectedCombined = null, tolerance = 2e-5 } = {}) {
  const ratios = (pairs || [])
    .map((p) => ({ survey: num(p.surveyFt), grid: num(p.gridFt) }))
    .filter((p) => p.survey != null && p.grid != null && p.grid > 0)
    .map((p) => p.survey / p.grid);
  if (!ratios.length) {
    return { verdict: "unknown", ratio: null, samples: 0, reason: "no corresponding survey/grid distance pairs supplied" };
  }
  const ratio = ratios.reduce((s, r) => s + r, 0) / ratios.length;
  const spread = Math.max(...ratios) - Math.min(...ratios);
  const exp = num(expectedCombined);
  // A survey stated on the grid reads 1.0; a ground survey reads 1/combined (ground distances are
  // LONGER than grid ones above the ellipsoid, so the ratio is above 1).
  const expectedGroundRatio = exp != null && exp > 0 ? 1 / exp : null;
  let verdict = "other-scale";
  if (Math.abs(ratio - 1) <= tolerance) verdict = "grid";
  else if (expectedGroundRatio != null && Math.abs(ratio - expectedGroundRatio) <= tolerance) verdict = "ground";
  return {
    verdict, ratio, samples: ratios.length, spread,
    expectedGroundRatio,
    perMileFt: (ratio - 1) * 5280,
    consistent: spread <= tolerance * 4,
    reason:
      verdict === "grid" ? "survey distances match grid distances — the survey is on state plane grid."
      : verdict === "ground" ? "survey distances exceed grid distances by the site's combined scale factor — the survey is in GROUND (modified state plane) coordinates."
      : "survey distances are scaled, but not by the factor this site's elevation predicts — read the combined factor and project origin off the survey sheet before reconciling.",
  };
}
