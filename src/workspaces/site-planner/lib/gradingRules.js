/* Grading-standards registry (B825) — per-surface-class slope limits for site-civil
 * screening: building pad, dock apron / truck court, trailer + car parking, drive
 * aisles, the paved drainage floor, landscape tie-downs, and swales.
 *
 * DESIGN RULES (the detentionRules.js / pondCriteriaRules.js house discipline):
 *   • Records are DATA with provenance, never bare code constants (B709/B771):
 *     every limit carries verified / basis / source / sourceDate / note.
 *   • SCOPE BOUNDARY — SURFACE CLASSES only. Pond-INTERIOR geometry (side slopes,
 *     freeboard, maintenance berms) lives in pondCriteriaRules.js (B709); never
 *     double-cover a limit in both registries.
 *   • ENCODING — one consistent choice: percent-published limits ride minSlopePct /
 *     maxSlopePct (percent units, 1 = 1%). Ratio-published limits (the 3:1 / 4:1
 *     landscape case) keep the PUBLISHED H:V form in maxSlopeRatio /
 *     preferredSlopeRatio (n in n:1 — SMALLER n is STEEPER, the same convention as
 *     pondCriteriaRules.maxSideSlope); validateSlopeAgainstRule converts ratio →
 *     percent (100/n) at the seam so ALL validation happens in ONE unit (percent).
 *   • basis: 'published' | 'planyr-screening-convention' — a convention value is
 *     NEVER implied-published: verified:false and source:null (or a cite when one
 *     exists), and the UI must caption it as a Planyr convention.
 *   • legalClass:true marks a LEGAL requirement (ADA/TAS): the UI must flag its
 *     violations as legal (--danger), not stylistic; screening-convention
 *     violations are advisory (--warn-text).
 *
 * Record schema:
 *   { id, label, appliesTo,                    // appliesTo — plain-English surface description
 *     minSlopePct?, maxSlopePct?,              // percent encoding (most records)
 *     maxSlopeRatio?, preferredSlopeRatio?,    // ratio encoding (landscape only)
 *     curbedFlowLineMinPct?,                   // pavedMinimum extra: curbed flow line
 *     verified, legalClass,
 *     basis: 'published' | 'planyr-screening-convention',
 *     source: {name, section, url, url2?, shortCite?} | null,  // url2 = 2nd primary (TAS); shortCite drives chipLabel
 *     sourceDate: 'YYYY-MM-DD' | null,         // date last checked against the source
 *     note }
 *
 * Screening only — confirm final grading with your civil engineer. Pure, no DOM. */

const EPS = 1e-9; // the checkPondCriteria comparison epsilon

export const GRADING_RULES = {
  buildingPad: {
    id: "buildingPad",
    label: "Building pad",
    appliesTo: "the building slab footprint (graded flat at FFE)",
    minSlopePct: 0,
    maxSlopePct: 0,
    verified: false,
    legalClass: false,
    basis: "planyr-screening-convention",
    source: null,
    sourceDate: null,
    note: "Held flat at the finished-floor elevation — the B805 auto-FFE seed supplies the plane elevation. Planyr screening convention, not a published standard.",
  },
  dockApron: {
    id: "dockApron",
    label: "Dock apron / truck court",
    appliesTo: "dock aprons and truck courts (the dock-stack maneuvering pavement)",
    minSlopePct: 1,
    maxSlopePct: 2,
    verified: false,
    legalClass: false,
    basis: "planyr-screening-convention",
    source: null,
    sourceDate: null,
    note: "The plane breaks at FFE − dockDropFt (B713, default 4.0′ — floodplainMitigation.effectivePadElev) and falls 1–2% AWAY from the building; that slope behavior is consumed by the future B826 proposed-surface engine. Planyr screening convention.",
  },
  trailerParking: {
    id: "trailerParking",
    label: "Trailer parking",
    appliesTo: "trailer storage / trailer parking stalls",
    minSlopePct: 1,
    maxSlopePct: 2,
    verified: false,
    legalClass: false,
    basis: "planyr-screening-convention",
    source: null,
    sourceDate: null,
    note: "Trailers must not roll or rack — hold the field to a gentle 1–2%. Planyr screening convention.",
  },
  carParkingAccessible: {
    id: "carParkingAccessible",
    label: "Accessible car parking (ADA/TAS)",
    appliesTo: "accessible parking stalls AND their access aisles — every direction",
    maxSlopePct: 2, // no minSlopePct — the standard publishes only a cap (drainage minimums are the pavedMinimum screen)
    verified: true,
    legalClass: true,
    basis: "published",
    source: {
      name: "ADA 2010 Standards for Accessible Design (DOJ) + 2012 Texas Accessibility Standards (TDLR TAS)",
      section: "§502.4 Parking Spaces — Floor or Ground Surfaces",
      url: "https://www.ada.gov/law-and-regs/design-standards/2010-stds/",
      url2: "https://www.tdlr.texas.gov/tas/2012tas.htm",
      shortCite: "ADA/TAS §502.4",
    },
    sourceDate: "2026-07-14",
    note: "The standard's exact wording is a 1:48 maximum (≈2.08%); 2.0% is the universally-specified round-down cap. Applies to stalls AND access aisles, in ALL directions. LEGAL requirement — violations are legal, not stylistic.",
  },
  carParkingGeneral: {
    id: "carParkingGeneral",
    label: "Car parking (general)",
    appliesTo: "standard (non-accessible) car parking fields",
    minSlopePct: 1,
    maxSlopePct: 3,
    verified: false,
    legalClass: false,
    basis: "planyr-screening-convention",
    source: null,
    sourceDate: null,
    note: "1% minimum is the inherited paved drainage floor (see pavedMinimum); 3% is a comfort target, not a published cap. Planyr screening convention.",
  },
  driveAisles: {
    id: "driveAisles",
    label: "Drive aisles",
    appliesTo: "drive aisles and internal circulation lanes",
    minSlopePct: 1,
    maxSlopePct: 5,
    verified: false,
    legalClass: false,
    basis: "planyr-screening-convention",
    source: null,
    sourceDate: null,
    note: "1% drainage floor to a 5% circulation comfort cap. Planyr screening convention.",
  },
  pavedMinimum: {
    id: "pavedMinimum",
    label: "Paved-surface drainage minimum",
    appliesTo: "any paved surface (fallback drainage minimum)",
    minSlopePct: 1,
    curbedFlowLineMinPct: 0.5,
    verified: false,
    legalClass: false,
    basis: "planyr-screening-convention",
    source: null,
    sourceDate: null,
    note: "1.0% minimum grade on paved surfaces so sheet flow moves; 0.5% minimum along a CURBED flow line (the curb concentrates the water). Planyr screening convention.",
  },
  landscapeTieDown: {
    id: "landscapeTieDown",
    label: "Landscape tie-down slopes",
    appliesTo: "landscape / grass tie-down slopes between graded planes and existing ground",
    maxSlopeRatio: 3, // n in n:1 H:V — SMALLER n is STEEPER (the pondCriteriaRules.maxSideSlope convention)
    preferredSlopeRatio: 4, // 4:1 preferred — mowable
    verified: false,
    legalClass: false,
    basis: "planyr-screening-convention",
    source: null,
    sourceDate: null,
    note: "3:1 H:V maximum tie-down, 4:1 preferred for mowability. Kept in the PUBLISHED ratio form; validateSlopeAgainstRule converts to percent (100/n) at the seam. Planyr screening convention.",
  },
  swales: {
    id: "swales",
    label: "Swales",
    appliesTo: "grass / roadside swale longitudinal flow lines",
    minSlopePct: 0.5,
    verified: false,
    legalClass: false,
    basis: "planyr-screening-convention",
    source: null,
    sourceDate: null,
    note: "0.5% minimum LONGITUDINAL grade so a swale actually drains. Planyr screening convention.",
  },
};

/* Per-jurisdiction override seam — shape { [authorityId]: { [classId]: partialRecord } },
 * merged over the base record by a future gradingRuleFor(classId, override, {jurisdiction})
 * extension, so per-authority records land WITHOUT reshaping this module. Jurisdiction keys
 * will match floodplainRules.js / pondCriteriaRules.js so one picker drives all three.
 * Empty for now — exported so the seam is real and testable. */
export const JURISDICTION_OVERRIDES = {};

/* Numeric limit fields an element-level override may replace. Provenance (verified,
 * legalClass, basis, source, sourceDate) can NEVER be overridden — an owner nudge
 * doesn't change the law or mint authority. */
const OVERRIDABLE = ["minSlopePct", "maxSlopePct", "maxSlopeRatio", "preferredSlopeRatio", "curbedFlowLineMinPct"];

/* Shallow-merge an element's explicit grade override over a registry rule — numeric
 * limits only; null/undefined override values are ignored. Result carries
 * overridden:true + overrideKeys. Inputs never mutated; a no-op override returns the
 * SAME rule object (referential equality keeps memoization cheap). Pure. */
export function mergeGradeOverride(rule, override) {
  if (!rule || !override) return rule || null;
  const keys = OVERRIDABLE.filter((k) => override[k] != null);
  if (!keys.length) return rule;
  const out = { ...rule, overridden: true, overrideKeys: keys };
  for (const k of keys) out[k] = override[k];
  return out;
}

/* Registry lookup + optional override merge. Unknown classId → honest null — never a
 * fabricated default rule (LOUD-FAILURE), even when an override is passed. Pure. */
export function gradingRuleFor(classId, gradeOverride = null) {
  const rule = GRADING_RULES[classId] || null;
  if (!rule) return null;
  return gradeOverride ? mergeGradeOverride(rule, gradeOverride) : rule;
}

/* Validate a slope (percent) against a rule. Ratio limits convert to percent HERE —
 * the one seam — so every comparison happens in one unit. Epsilon 1e-9 (the
 * checkPondCriteria pattern). Returns
 *   { ok:true,  violation:null, bound:null, limitPct:null }            — conforms
 *   { ok:false, violation:'legal'|'screening', bound:'min'|'max', limitPct } — breach
 *   { ok:null,  violation:null, bound:null, limitPct:null, unknown:true }   — no rule /
 *     non-finite slope: an honest unknown, never a silent pass (LOUD-FAILURE). Pure. */
export function validateSlopeAgainstRule(slopePct, rule) {
  if (!rule || !Number.isFinite(slopePct)) {
    return { ok: null, violation: null, bound: null, limitPct: null, unknown: true };
  }
  const maxPct = rule.maxSlopePct != null ? rule.maxSlopePct
    : rule.maxSlopeRatio != null ? 100 / rule.maxSlopeRatio
    : null;
  if (maxPct != null && slopePct > maxPct + EPS) {
    // Only a max can be a LEGAL breach (ADA/TAS caps); mins are drainage screening.
    return { ok: false, violation: rule.legalClass ? "legal" : "screening", bound: "max", limitPct: maxPct };
  }
  if (rule.minSlopePct != null && slopePct < rule.minSlopePct - EPS) {
    return { ok: false, violation: "screening", bound: "min", limitPct: rule.minSlopePct };
  }
  return { ok: true, violation: null, bound: null, limitPct: null };
}

/* Percent formatter — the detentionRules.ruleBadge bandNum precedent: integers get one
 * decimal so a band reads "1.0–2.0%" and the ADA chip reads exactly "≤2.0%". */
const pctNum = (n) => (Number.isInteger(n) ? n.toFixed(1) : String(n));

/* The short-cite chip string ("freeboard 1′ — FBCDD DCM §6.4.7" style):
 * "≤2.0% — ADA/TAS §502.4" · "1.0–2.0% — Planyr convention" · an overridden rule
 * reads "— owner override" (the ⓘ popover still shows the base cite). Pure. */
export function chipLabel(rule) {
  if (!rule) return "";
  const min = rule.minSlopePct, max = rule.maxSlopePct;
  let constraint;
  if (rule.maxSlopeRatio != null) {
    constraint = `≤${rule.maxSlopeRatio}:1${rule.preferredSlopeRatio != null ? ` (${rule.preferredSlopeRatio}:1 preferred)` : ""}`;
  } else if (min === 0 && max === 0) {
    constraint = "flat (0%)";
  } else if (min != null && max != null) {
    constraint = `${pctNum(min)}–${pctNum(max)}%`;
  } else if (max != null) {
    constraint = `≤${pctNum(max)}%`;
  } else if (min != null) {
    constraint = `≥${pctNum(min)}%`;
  } else {
    return ""; // a rule with no limit encodes nothing — no chip
  }
  const sourcePart = rule.overridden
    ? "owner override"
    : rule.basis === "published"
      ? (rule.source && (rule.source.shortCite || rule.source.name)) || "published"
      : "Planyr convention";
  return `${constraint} — ${sourcePart}`;
}
