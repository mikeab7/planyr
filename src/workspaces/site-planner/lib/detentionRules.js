/* Detention rules engine (B629) + drainage-authority resolver + analysis-tier /
 * hydraulic-regime assessors + pond auto-size solvers (B630–B633, B635).
 *
 * WHAT THIS ANSWERS at screening: which authority reviews this parcel's drainage,
 * how much detention the rate method says it owes, what analysis tier the reviewer
 * will demand (rate-method vs full DIA), which hydraulic regime governs pond sizing
 * (flowline vs floodplain/tailwater), and how big a pond must be to satisfy it.
 *
 * DESIGN RULES (owner, 2026-07-03):
 *   • Rules are VERSIONED DATA RECORDS, never code constants: {id, authority,
 *     ruleType, effectiveDate, verifiedOn, source:{name,section,url}, params}.
 *     `ruleFor(authority, date)` picks the newest record effective on that date —
 *     Houston's June-2026 rewrite (flat 0.8 <20 ac) and its superseded 2019 curve
 *     coexist below, which is exactly the point.
 *   • NO volume is ever computed or displayed without carrying its rule record.
 *     Every result here is a carrier object with `rule`, `basis`, `flags`, and a
 *     screening caveat — a bare number is a defect (silent-failure class).
 *   • Band-typed authorities (no published flat rate / untranscribed tables) can
 *     NEVER emit a point estimate — structurally enforced in computeRequiredDetention.
 *     Band endpoints are PLANYR SCREENING BANDS (anchored on the spread of published
 *     MSA rates), never presented as authority-published numbers.
 *   • Ambiguity is surfaced, never defaulted: a parcel straddling a boundary or
 *     sitting in a review district populates `ambiguous`/`overlays`, and unknown
 *     facts (channel adjacency, missing BFE) travel as flags/unknowns.
 *
 * Mirrors the jurisdiction.js seams exactly: registry-fed endpoints (never inline —
 * machine-enforced by ui-audit/gis-source-audit.mjs), injectable {cache, fetchJson}
 * via identifySource, pure + Node-testable, no Leaflet/DOM.
 *
 * Screening only — never a design number. Confirm with your engineer and the
 * reviewing authority. */
import { GIS_SOURCES } from "../../../shared/gis/sources.js";
import {
  identifyJurisdiction,
  identifySource,
  normalizeFeature,
  polylineDistMeters,
} from "./jurisdiction.js";

const DAY = 24 * 3600 * 1000;
const FT_PER_M = 3.28084;
export const SQFT_PER_ACRE = 43560;

// ---------------------------------------------------------------------------
// Rule records — versioned data, newest first per authority.
// verifiedOn = the date a human last checked the rule against its source.
// secondarySource:true = verified against reputable secondary coverage (engineering
// firms / trade press), pending the manual PDF itself (see OWNER-TODO).
// ---------------------------------------------------------------------------
export const DETENTION_RULES = {
  hcfcd: [
    {
      id: "hcfcd-pcpm-atlas14-2021",
      authority: "hcfcd",
      authorityLabel: "Harris County Flood Control District",
      ruleType: "rate",
      effectiveDate: "2021-03-31",
      verifiedOn: "2026-07-03",
      source: {
        name: "HCFCD Policy, Criteria & Procedure Manual + Interim Guidelines and Criteria for Atlas 14 Implementation",
        section: "Detention rate (large tracts)",
        url: "https://www.hcfcd.org/Resources/Technical-Manuals",
      },
      params: {
        rateAcFtPerAc: 0.65,
        appliesTo: "tract", // the ENTIRE tract, not just impervious area
        drawdown: {
          volumeFraction: 0.8,
          dischargeFactor: 0.5,
          note: "drain time = 80% of max detention volume ÷ (0.5 × peak allowable discharge)",
        },
        pond: { sideSlope: 3, freeboardFt: 1, wetBottom: true }, // HCFCD Wet Bottom Basin guideline geometry — params, not hardcodes
      },
    },
  ],
  coh: [
    {
      id: "coh-idm9-2026",
      authority: "coh",
      authorityLabel: "City of Houston",
      ruleType: "tiered",
      effectiveDate: "2026-06-01",
      verifiedOn: "2026-07-05",
      // PRIMARY-SOURCE VERIFIED 2026-07-05 against the City's own signed document — the
      // IDM Supplement IDMS-2025-01 (Houston Public Works; City Engineer O. McFoy, P.E.;
      // eff. 2025-05-15; carried into the 2026 IDM edition). The flat-rate rewrite is real,
      // but the primary text corrected two things the trade coverage had blurred:
      //   (1) the 0.8 ac-ft/ac rate applies to PROPOSED IMPERVIOUS AREA (Table 9.5),
      //       NOT the gross tract — the engine used to multiply by tract acres; and
      //   (2) the single-family threshold is 15,000 SF (Tables 9.3/9.4), not 7,500 SF, and
      //       0.75 ac-ft/ac applies to impervious area IN EXCESS of the exemption.
      // effectiveDate kept at the 2026 mandatory-compliance date (the supplement allowed
      // early use from 2025-05-15). Verified from the signed PDF at
      // https://reduceflooding.com/wp-content/uploads/2025/05/Ch-9-IDM-Supplement-IDMS-2025.pdf
      source: {
        name: "City of Houston IDM Ch. 9 — Stormwater Detention (Supplement IDMS-2025-01, signed by the City Engineer 2025-05-15; carried into the 2026 IDM edition)",
        section: "§9.2.01.H.3, Table 9.5 (Detention Criteria 3); Tables 9.3/9.4 (single-family); §9.1.02.G (receiving jurisdiction governs)",
        url: "https://www.houstonpermittingcenter.org/office-city-engineer/design-and-construction-standards",
      },
      params: {
        flatRate: { maxAcres: 20, rateAcFtPerAc: 0.8, appliesTo: "impervious", note: "Table 9.5: 0.8 ac-ft/ac × PROPOSED impervious area of the tract (≤20 ac)" },
        redevelopmentCredit: { rateAcFtPerAc: 0.4, appliesTo: "removedImpervious", note: "Table 9.5 formula: Detention = (Ap × 0.8) − (Ae × 0.4); Ap = proposed impervious, Ae = existing impervious removed" },
        singleFamilyLot: { maxSf: 15000, imperviousPctExempt: 65, rateAbove: 0.75, appliesTo: "excessImpervious", note: "Tables 9.3/9.4: SFR tract ≤15,000 SF exempt at ≤65% impervious, else 0.75 ac-ft/ac × impervious IN EXCESS of 65% of tract" },
        largeTract: { minAcres: 20, defersTo: "hcfcd", conflictRateAcFtPerAc: 0.75, note: "Table 9.5: >20 ac follows the current HCFCD PCPM (0.65 min + impact analysis); COH minimum rate 0.75 ac-ft/ac" },
        grandfather: "projects in review before 2026-06-01 may qualify for the prior (2019) rules if approved before the deadline",
        appliesInEtj: true,
      },
    },
    {
      id: "coh-idm9-2019",
      authority: "coh",
      authorityLabel: "City of Houston",
      ruleType: "tiered",
      effectiveDate: "2019-07-09",
      verifiedOn: "2026-07-03",
      source: {
        name: "City of Houston IDM Ch. 9 — Table 9.3 / Fig. 9.2 Minimum Detention Rate (pre-2026 Atlas-14 curve; values read from the 2022 IDM edition, unchanged from 2019 until Supplement IDMS-2025-01 replaced it)",
        section: "§9.2.01.H.3, Table 9.3 — Minimum Detention Rate (1–20 ac, by % impervious)",
        url: "https://www.houstonpermittingcenter.org/media/7596/download",
      },
      params: {
        smallTract: { maxAcres: 1, rateAcFtPerAc: 0.75, appliesTo: "tract", note: "non-single-family" },
        singleFamilyLot: { maxSf: 7500, imperviousPctExempt: 65, rateAbove: 0.75 },
        midTract: {
          minAcres: 1,
          maxAcres: 20,
          // IDM Table 9.3 (the tabular form of Fig. 9.2) — minimum detention rate by %
          // impervious, TRANSCRIBED VERBATIM 2026-07-05 from the primary manual (media/7596,
          // the 2022 IDM; this curve was unchanged from the 2019 edition until IDMS-2025-01).
          // The published "0% – 51% → 0.75" flat floor is the clamped first point at 51%.
          // (Correction: the prior placeholder's 85→0.95 / 90→0.98 anchors were wrong; the
          //  manual's Table 9.3 reads 85→0.93 and 90→0.95.)
          curve: [
            [51, 0.75],
            [55, 0.78],
            [60, 0.81],
            [65, 0.83],
            [70, 0.86],
            [75, 0.88],
            [80, 0.91],
            [85, 0.93],
            [90, 0.95],
            [95, 0.97],
            [100, 0.98],
          ],
          transcribed: true,
        },
        largeTract: { minAcres: 20, defersTo: "hcfcd", conflictRateAcFtPerAc: 0.75 },
        appliesInEtj: true,
      },
    },
  ],
  fortbend: [
    {
      id: "fbcdd-dcm-atlas14-2020",
      authority: "fortbend",
      authorityLabel: "Fort Bend County Drainage District",
      ruleType: "table-band",
      effectiveDate: "2020-01-01",
      verifiedOn: "2026-07-05",
      // PRIMARY-SOURCE VERIFIED + TRANSCRIBED 2026-07-05 from the FBCDD DCM, Chapter 6
      // (Storm Runoff Storage), §6.4.1 / Table 6-1. IMPORTANT CORRECTION: the prior note
      // that the <50-ac rate lived in "figures 7-1-1…7-1-16" was WRONG — those figures are
      // the Brazos River water-surface profiles (Ch. 7, leveed areas). The real rate is the
      // numeric Table 6-1 (minimum detention rate by % impervious), read verbatim below.
      source: {
        name: "FBCDD Drainage Criteria Manual, Ch. 6 Storm Runoff Storage + Interim Atlas-14 DCM (eff. 2020-01-01, rev. Sep 2021 — §4.d: the <50-ac simplified method is unchanged by Atlas-14)",
        section: "§6.4.1 / Table 6-1 — Minimum Detention Rates for Drainage Areas Less Than 50 Acres",
        url: "https://www.fortbendcountytx.gov/sites/default/files/document-central/document-central/drainage-district-documents/drainage-criteria-manual/60StormRunoffStorage.pdf",
      },
      params: {
        // FBCDD Table 6-1: minimum detention rate (ac-ft per acre of DRAINAGE AREA), keyed
        // to % impervious. Linear: rate = 0.58 + 0.004 × %imp. Transcribed verbatim from the
        // manual. The simplified method is mandatory <50 ac and OPTIONAL 50–640 ac; ≥640 ac
        // requires HEC-HMS (→ pointMaxAcres). Rate × drainage area = required volume.
        table: {
          maxAcres: 50,
          pointMaxAcres: 640,
          figures: "Table 6-1 (§6.4.1)",
          rows: [[10, 0.62], [20, 0.66], [30, 0.70], [40, 0.74], [50, 0.78], [60, 0.82], [70, 0.86], [80, 0.90], [90, 0.94], [100, 0.98]],
          transcribed: true,
          appliesTo: "drainageArea",
        },
        screeningBand: false, // resolves to a POINT when impervious % is known; band only as an impervious-unknown / large-tract fallback
        bandAcFtPerAc: [0.62, 0.98], // Table 6-1 endpoints (10% … 100% impervious)
        releaseRateCfsPerAc: 0.125, // §6.4.1: max 100-yr release rate
        hecHmsAboveAcres: 640,
        tailwater: {
          convention:
            "assume tailwater at the top of the downstream end of the outlet pipe, or the depth at max release flowrate, whichever is HIGHER",
          note: "FBCDD's codified convention (§6.4.1/§6.4.5) — feeds the hydraulic-regime gate (B632)",
        },
      },
    },
  ],
  montgomery: [
    {
      id: "moco-dcm-2025",
      authority: "montgomery",
      authorityLabel: "Montgomery County",
      ruleType: "policy-band",
      effectiveDate: "2025-08-26",
      verifiedOn: "2026-07-05",
      source: {
        name: "Montgomery County Drainage Criteria Manual (adopted 2025-08-26; Halff Associates; Conroe NOAA Atlas-14 station)",
        section: "§6.3.6 (≤20 ac simplified) + Eq. 6-2 / Fig. 6-1; §6.3.1 general 0.55 min; §6.3.7 (>20 ac, 0.55 min)",
        url: "https://www.mctx.org/",
      },
      params: {
        // PRIMARY-SOURCE VERIFIED + TRANSCRIBED 2026-07-05 from the adopted DCM, §6.3.6.
        // The ≤20-ac simplified path is Eq. 6-2 (the readable form of Fig. 6-1), applied to
        // the CONTRIBUTING (developed) area: flat 0.35 ac-ft/ac at ≤25% impervious, else
        // rate = 0.0073 × %imp + 0.1667. Verified PDF (county revize CMS):
        // cms1files.revize.com/montgomerycountytx/MoCo Drainage Criteria Manual adopted 8-26-2025 Signed.pdf
        smallSite: {
          maxAcres: 20,
          belowPct: { maxPct: 25, rate: 0.35 },
          slope: 0.0073,
          intercept: 0.1667,
          transcribed: true,
          appliesTo: "contributingArea",
          note: "Eq. 6-2 (§6.3.6): rate ac-ft/ac × contributing area; flat 0.35 at ≤25% impervious",
        },
        screeningBand: false, // ≤20 ac resolves to a POINT when impervious % is known; band as the impervious-unknown / >20-ac fallback
        bandAcFtPerAc: [0.35, 0.9], // Eq. 6-2 endpoints: 0.35 (≤25% imp) … 0.90 (~100% imp)
        smallSiteMaxAcres: 20,
        largeSiteMinRate: 0.55, // §6.3.7 / §6.3.1: >20 ac follows the modeling path, 0.55 ac-ft/ac minimum
        zeroIncrease: ["peakFlow", "wsel"],
        atlasStation: "Conroe",
      },
    },
  ],
  chambers: [
    {
      id: "chambers-dcm-2005",
      authority: "chambers",
      authorityLabel: "Chambers County",
      ruleType: "policy-band",
      effectiveDate: "2005-01-01",
      verifiedOn: "2026-07-05",
      // PRIMARY-SOURCE VERIFIED 2026-07-05 (Chambers County DCM, Aug 9 2005, hosted by
      // Mont Belvieu): CONFIRMED there is NO published flat detention rate. §1.2.1 is a
      // strict "zero impact" policy (no downstream peak-flow or upstream WSEL increase);
      // detention is sized by calculation — §2.3.5 / §7.3 require "calculations establishing
      // the required detention storage volume" for <200-ac drainage areas (Exhibit 7-3), and
      // a flood-routing analysis at ≥200 ac. No ac-ft/ac rate appears anywhere in the manual.
      // (Ch. 7 body pp. 7-5..7-7 exceeded the text extractor; the negative rests on the
      // zero-impact policy + the analysis-only submittal requirements.) Keep as a band.
      source: {
        name: "Chambers County Drainage Criteria Manual (Aug 9, 2005; hosted via City of Mont Belvieu)",
        section: "§1.2.1 Zero-Impact policy; §7.3 Detention Analysis (≤200 ac) / §7.4 (>200 ac); Exhibit 7-3",
        url: "https://www.montbelvieu.net/DocumentCenter/View/53/Drainage-Criteria-Manual-8-09-05",
      },
      params: {
        screeningBand: true,
        bandAcFtPerAc: [0.5, 1.2], // wide — NO published flat rate exists
        noPublishedRate: true,
        zeroImpact: { maxStorm: "100-yr", note: "no downstream flow or upstream WSEL increase" },
        analysisMaxAcres: 200,
      },
    },
  ],
  waller: [
    {
      id: "waller-subdiv-2023",
      authority: "waller",
      authorityLabel: "Waller County",
      ruleType: "policy-band",
      effectiveDate: "2023-12-06",
      verifiedOn: "2026-07-03",
      // ⚠ INTENTIONALLY NOT re-verified 2026-07-05 (verifiedOn left at 2026-07-03). A research
      // pass over the primary regs (rev. 2023-12-06, Appendix E) reported that Waller DOES
      // publish detention rates — a "Coefficient Method" Storage = 0.65 × developed acres for
      // small sites (<5 ac commercial / <10 ac residential) and a 0.55 ac-ft/ac FLOOR on the
      // hydrograph (Malcom's) method — and that its TxDOT references are for materials/roadway
      // specs, NOT the detention rate. If confirmed, this record should flip noPublishedRate→
      // false, drop txdotDeference, and tighten the band toward 0.55–0.65. NOT applied here:
      // the web text extractor truncated Appendix E before the rate section, so the number
      // could NOT be read from the manual directly. OWNER-TODO: confirm & tighten.
      source: {
        name: "Waller County Subdivision & Development Regulations (rev. 2023-12-06)",
        section: "Appendix E (drainage) — zero-net-increase; §V/§VI detention (Coefficient / Malcom's) — rate section unverified, see note",
        url: "https://www.co.waller.tx.us/",
      },
      params: {
        screeningBand: true,
        bandAcFtPerAc: [0.4, 1.2], // the thinnest criteria in the MSA → the widest band (see note: likely tightens to 0.55–0.65 once confirmed)
        txdotDeference: true,
      },
    },
  ],
};

/* Municipal adopt-by-reference overlays — thin records pointing at a parent
 * authority (a registry row, not new code). The resolver maps these cities to
 * their overlay id; computeRequiredDetention dispatches through parentAuthority. */
export const MUNICIPAL_OVERLAYS = {
  missouricity: {
    id: "missouricity-adopt",
    authority: "missouricity",
    authorityLabel: "Missouri City",
    ruleType: "overlay",
    effectiveDate: "2022-06-20",
    verifiedOn: "2026-07-03",
    source: { name: "City of Missouri City IDM Ch. 7 (adopts county criteria with local amendments)", section: "Detention", url: "https://www.missouricitytx.gov/" },
    params: {
      redevelopment: { maxAcres: 20, rateAcFtPerAc: 0.75, appliesTo: "addedImpervious" },
      largeParent: { minAcres: 20, parentAuthorities: ["hcfcd", "fortbend"], parentBasis: "watershed drained to" },
    },
  },
  magnolia: {
    id: "magnolia-adopt",
    authority: "magnolia",
    authorityLabel: "City of Magnolia",
    ruleType: "overlay",
    effectiveDate: "2025-08-26",
    verifiedOn: "2026-07-03",
    source: { name: "City of Magnolia (adopts the Montgomery County DCM + 10% runoff-reduction)", section: "Detention", url: "https://www.cityofmagnolia.com/" },
    params: { parentAuthority: "montgomery", runoffReductionPct: 10 },
  },
};

/* Watershed-keyed overlay records (B635) — layered ON TOP of the jurisdiction
 * authority, resolved from the HCFCD Watershed layer. Flag-and-band until the
 * supplemental western-Harris criteria are transcribed exactly: these render as
 * warn-notes, they NEVER silently adjust the required number. */
export const WATERSHED_OVERLAYS = [
  {
    id: "hcfcd-upper-cypress-retention",
    match: /CYPRESS CREEK/i, // HCFCD WTSHNAME. The supplemental criteria apply to the UPPER
    // portion (the Cypress Creek overflow area) — the precise boundary is the separate
    // HCFCD/CypressCreekOverflow service; until that's wired (follow-up flagged here),
    // any Cypress Creek watershed hit surfaces the flag rather than staying silent.
    upperPortionOnly: true,
    authorityLabel: "HCFCD supplemental (Upper Cypress Creek)",
    verifiedOn: "2026-07-03",
    source: { name: "HCFCD supplemental western-Harris criteria", section: "Upper Cypress Creek retention", url: "https://www.hcfcd.org/Resources/Technical-Manuals" },
    params: { retentionAcFtPerAc: 0.17, giReductionAcFtPerAc: 0.2, transcribed: false },
    note: "Additional RETENTION may be required on top of detention (0.17 ac-ft/ac context; green-infrastructure techniques can reduce required detention by up to 0.20 ac-ft/ac). Exact applicability needs the supplemental criteria + the overflow-area boundary — verify with HCFCD.",
  },
  {
    id: "hcfcd-addicks-barker-retention",
    match: /ADDICKS|BARKER/i,
    authorityLabel: "HCFCD supplemental (Addicks/Barker)",
    verifiedOn: "2026-07-03",
    source: { name: "HCFCD supplemental western-Harris criteria", section: "Addicks/Barker reservoir watersheds", url: "https://www.hcfcd.org/Resources/Technical-Manuals" },
    params: { retentionAcFtPerAc: 0.17, giReductionAcFtPerAc: 0.2, transcribed: false },
    note: "Addicks/Barker reservoir watershed — supplemental retention requirements apply per HCFCD's western-Harris criteria (0.17 ac-ft/ac retention context). Verify with HCFCD.",
  },
];

export const SCREENING_CAVEAT =
  "Screening estimate — confirm with your engineer and the reviewing authority.";

// ---------------------------------------------------------------------------
// Rule lookup — the versioning seam. Newest record whose effectiveDate ≤ onDate.
// ---------------------------------------------------------------------------
export function ruleFor(authorityId, onDate) {
  const recs = DETENTION_RULES[authorityId];
  if (!recs || !recs.length) return MUNICIPAL_OVERLAYS[authorityId] || null;
  const date = onDate || new Date().toISOString().slice(0, 10);
  for (const r of recs) if (r.effectiveDate <= date) return r; // arrays are newest-first
  return null; // asked for a date before the oldest record — honest null, no guess
}

/* Clamped piecewise-linear interpolation over [[x, y], …] sorted by x. Pure. */
export function interpolateCurve(curve, x) {
  if (!curve || !curve.length) return null;
  if (x <= curve[0][0]) return curve[0][1];
  const last = curve[curve.length - 1];
  if (x >= last[0]) return last[1];
  for (let i = 0; i + 1 < curve.length; i++) {
    const [x0, y0] = curve[i], [x1, y1] = curve[i + 1];
    if (x >= x0 && x <= x1) return y0 + ((y1 - y0) * (x - x0)) / (x1 - x0 || 1);
  }
  return last[1];
}

/* The greater-of conflict rule ("more restrictive governs"). Candidates are
 * {authorityId, acFt, basis, rule}; returns {picked, reason, candidates}. Pure. */
export function governingRequirement(candidates) {
  const best = candidates.reduce((a, b) => (b.acFt > a.acFt ? b : a), candidates[0]);
  return { picked: best.authorityId, reason: "more restrictive governs", candidates };
}

const round2 = (n) => Math.round(n * 100) / 100;
// Carrier values keep 4 decimals (a 6,000-sf lot owes ~0.10 ac-ft — 2-decimal
// rounding would distort it); DISPLAY formatting is the UI's job.
const round4 = (n) => Math.round(n * 10000) / 10000;

/* Internal: a point-estimate carrier. */
function pointResult(acFt, rate, basis, rule, flags = [], governing = null) {
  return {
    kind: "point",
    requiredAcFt: round4(acFt),
    bandAcFt: null,
    rateAcFtPerAc: rate,
    basis,
    rule,
    governing,
    flags,
    caveat: SCREENING_CAVEAT,
  };
}
function bandResult(loHi, basis, rule, flags = []) {
  return {
    kind: "band",
    requiredAcFt: null,
    bandAcFt: [round4(loHi[0]), round4(loHi[1])],
    rateAcFtPerAc: null,
    basis,
    rule,
    governing: null,
    flags,
    caveat: SCREENING_CAVEAT,
  };
}

/* Published detention rate as a function of % impervious, for the transcribed band
 * authorities. Fort Bend FBCDD Table 6-1 → piecewise-linear interpolation over
 * table.rows (rate × drainage area). Montgomery DCM Eq. 6-2 → a flat 0.35 floor at
 * ≤25% impervious, a linear equation above (rate × contributing area). Size-gated to
 * the range where the simplified method is published; returns null outside that range,
 * or for authorities that publish no impervious-keyed rate (Chambers/Waller). Pure. */
export function rateFromImpervious(rule, impPct, acres = null) {
  const p = (rule && rule.params) || {};
  if (impPct == null) return null;
  if (p.table && p.table.transcribed && p.table.rows && p.table.rows.length) {
    // FBCDD Table 6-1 — simplified method published <50 ac, permitted to 640 ac; ≥640 → HEC-HMS.
    if (acres != null && p.table.pointMaxAcres != null && acres >= p.table.pointMaxAcres) return null;
    return round4(interpolateCurve(p.table.rows, impPct));
  }
  if (p.smallSite && p.smallSite.transcribed) {
    // Montgomery Eq. 6-2 — the ≤20-ac simplified path only.
    const s = p.smallSite;
    if (acres != null && s.maxAcres != null && acres > s.maxAcres) return null;
    if (s.belowPct && impPct <= s.belowPct.maxPct) return s.belowPct.rate;
    return round4(s.slope * impPct + s.intercept);
  }
  return null;
}

// ---------------------------------------------------------------------------
// computeRequiredDetention — the rate method, always carrying its rule record.
// ---------------------------------------------------------------------------
export function computeRequiredDetention({
  acres,
  impPct = null,
  authorityId,
  inCityLimits = false,
  drainsToHcfcdChannel = null, // true | false | null(unknown)
  singleFamily = false,
  lotSf = null,
  addedImperviousAcres = null,
  removedImperviousAcres = 0,
  onDate = null,
} = {}) {
  if (!(acres > 0)) return { kind: "none", requiredAcFt: null, bandAcFt: null, rateAcFtPerAc: null, basis: "no site area", rule: null, governing: null, flags: [], caveat: SCREENING_CAVEAT };
  const rule = ruleFor(authorityId, onDate);
  if (!rule) {
    return {
      kind: "unknown", requiredAcFt: null, bandAcFt: null, rateAcFtPerAc: null,
      basis: "no criteria modeled for this authority",
      rule: null, governing: null, flags: ["no-criteria-modeled"], caveat: SCREENING_CAVEAT,
    };
  }
  const imperviousAcres = impPct != null ? (acres * impPct) / 100 : null;
  const p = rule.params || {};

  // ---- band-typed records: a POINT when a transcribed rate applies, else a band ----
  if (rule.ruleType === "table-band" || rule.ruleType === "policy-band") {
    // Fort Bend (Table 6-1) and Montgomery (Eq. 6-2) publish a rate keyed to % impervious:
    // resolve to a point when impervious is known and the site is in the simplified range.
    const rate = rateFromImpervious(rule, impPct, acres);
    if (rate != null) {
      const src = rule.authority === "montgomery" ? "MoCo DCM Eq. 6-2" : "FBCDD Table 6-1";
      const basis = `${round2(rate)} ac-ft/ac (${src} at ${round2(impPct)}% impervious) × ${acres.toFixed(2)} ac`;
      return pointResult(rate * acres, rate, basis, rule, ["from-published-" + (p.table ? "table" : "formula")]);
    }
    // No point available → the honest screening band (structurally never a fabricated point).
    const [lo, hi] = p.bandAcFtPerAc;
    const flags = ["screening-band"];
    if (p.noPublishedRate || p.txdotDeference) flags.push("verify-with-county-engineer");
    const transcribed = (p.table && p.table.transcribed) || (p.smallSite && p.smallSite.transcribed);
    let why;
    if (transcribed && impPct == null) {
      flags.push("impervious-unknown");
      why = `spans the published rate range because impervious % isn't set — enter a test-fit for the exact ${p.table ? "Table 6-1" : "Eq. 6-2"} point`;
    } else if (transcribed) {
      flags.push("large-tract-modeling");
      why = `simplified rate method doesn't apply at ${round2(acres)} ac — full drainage modeling required${p.largeSiteMinRate ? ` (min ${p.largeSiteMinRate} ac-ft/ac)` : ""}`;
    } else {
      if ((p.table && !p.table.transcribed) || p.smallTableTranscribed === false) flags.push("table-unverified");
      why = `Planyr screening band — no published flat rate${p.table && !p.table.transcribed ? `; exact figures ${p.table.figures} pending transcription` : ""}`;
    }
    const basis = `${lo}–${hi} ac-ft/ac (${why}) × ${acres.toFixed(2)} ac`;
    return bandResult([lo * acres, hi * acres], basis, rule, flags);
  }

  // ---- municipal overlays: dispatch through the parent -------------------
  if (rule.ruleType === "overlay") {
    if (p.parentAuthority) {
      const parent = computeRequiredDetention({ acres, impPct, authorityId: p.parentAuthority, inCityLimits, drainsToHcfcdChannel, onDate });
      parent.flags = [...parent.flags, "municipal-overlay"];
      parent.basis += ` · via ${rule.authorityLabel} adopt-by-reference${p.runoffReductionPct ? ` (+${p.runoffReductionPct}% runoff-reduction requirement)` : ""}`;
      parent.overlayRule = rule;
      return parent;
    }
    // Missouri City-style: size-dependent parent, watershed-resolved.
    if (acres < (p.redevelopment?.maxAcres ?? 20)) {
      if (addedImperviousAcres != null) {
        const r = p.redevelopment.rateAcFtPerAc;
        return pointResult(r * addedImperviousAcres, r,
          `${r} ac-ft/ac × ${addedImperviousAcres.toFixed(2)} ac ADDED impervious (redevelopment, ${rule.authorityLabel})`, rule, ["municipal-overlay"]);
      }
      // Added-impervious not known (new development / not entered): fall back honestly.
      const r = p.redevelopment.rateAcFtPerAc;
      return pointResult(r * (imperviousAcres ?? acres), r,
        `${r} ac-ft/ac × ${(imperviousAcres ?? acres).toFixed(2)} ac impervious (screening — the ${rule.authorityLabel} rate applies to ADDED impervious on redevelopment; full impervious used here)`,
        rule, ["municipal-overlay", "added-impervious-unknown"]);
    }
    // ≥ 20 ac: parent is hcfcd|fortbend by watershed drained to — surfaced, not guessed.
    const candidates = (p.largeParent?.parentAuthorities || []).map((pa) => {
      const c = computeRequiredDetention({ acres, impPct, authorityId: pa, inCityLimits, drainsToHcfcdChannel, onDate });
      return { authorityId: pa, acFt: c.requiredAcFt ?? (c.bandAcFt ? c.bandAcFt[1] : 0), basis: c.basis, rule: c.rule, result: c };
    });
    return {
      kind: "unknown", requiredAcFt: null, bandAcFt: null, rateAcFtPerAc: null,
      basis: `≥${p.largeParent.minAcres} ac in ${rule.authorityLabel}: parent authority depends on the ${p.largeParent.parentBasis}`,
      rule, governing: { picked: null, reason: "parent authority unresolved (watershed drained to)", candidates },
      flags: ["municipal-overlay", "overlay-parent-ambiguous"], caveat: SCREENING_CAVEAT,
    };
  }

  // ---- hcfcd: flat rate on the whole tract --------------------------------
  if (authorityId === "hcfcd") {
    const r = p.rateAcFtPerAc;
    return pointResult(r * acres, r, `${r} ac-ft/ac × ${acres.toFixed(2)} ac (entire tract)`, rule);
  }

  // ---- coh: tier dispatch (record-shape driven, so 2019 and 2026 coexist) --
  if (authorityId === "coh") {
    if (singleFamily && lotSf != null && p.singleFamilyLot && lotSf < p.singleFamilyLot.maxSf) {
      const sf = p.singleFamilyLot;
      if (impPct != null && impPct <= sf.imperviousPctExempt) {
        return { kind: "none", requiredAcFt: 0, bandAcFt: null, rateAcFtPerAc: 0, basis: `single-family lot <${sf.maxSf.toLocaleString()} sf at ≤${sf.imperviousPctExempt}% impervious — no detention required`, rule, governing: null, flags: [], caveat: SCREENING_CAVEAT };
      }
      // 2026 IDM Tables 9.3/9.4: 0.75 ac-ft/ac applies to impervious IN EXCESS of the
      // exemption (65% of tract), not the whole tract. The 2019 record (no appliesTo) keeps
      // the simpler whole-tract screening basis. Impervious unknown → conservative + flagged.
      if (sf.appliesTo === "excessImpervious") {
        const exemptFrac = sf.imperviousPctExempt / 100;
        const excessAc = impPct != null ? Math.max(0, acres * (impPct / 100 - exemptFrac)) : acres;
        const flags = impPct == null ? ["impervious-unknown"] : [];
        const label = impPct != null
          ? `${excessAc.toFixed(4)} ac impervious above ${sf.imperviousPctExempt}% of tract`
          : `${acres.toFixed(2)} ac (impervious % unknown — conservative)`;
        return pointResult(sf.rateAbove * excessAc, sf.rateAbove, `${sf.rateAbove} ac-ft/ac × ${label} (single-family lot <${sf.maxSf.toLocaleString()} sf)`, rule, flags);
      }
      return pointResult(sf.rateAbove * acres, sf.rateAbove, `${sf.rateAbove} ac-ft/ac × ${acres.toFixed(2)} ac (single-family lot above ${sf.imperviousPctExempt}% impervious)`, rule);
    }
    const largeMin = p.largeTract?.minAcres ?? 20;
    // >20 ac defers to HCFCD. A record with NO mid-tract band (the 2026 flat-rate
    // record) has a gap at exactly the threshold — <20 is the flat rate, >20 defers,
    // but 20.00 itself would fall through to "unknown"; treat == threshold as large
    // there. The 2019 record's mid-tract curve covers 1–20 inclusive, so keep it
    // exclusive when a mid-tract band exists.
    if (acres > largeMin || (acres === largeMin && !p.midTract)) {
      // In city limits draining directly to an HCFCD channel, the codified conflict
      // rule takes the GREATER of HCFCD 0.65 × tract vs COH's impervious rate.
      // Unknown adjacency → both candidates, labeled.
      const hcfcdRule = ruleFor("hcfcd", onDate);
      const hRate = hcfcdRule.params.rateAcFtPerAc;
      const hcfcdCand = { authorityId: "hcfcd", acFt: round2(hRate * acres), basis: `${hRate} ac-ft/ac × ${acres.toFixed(2)} ac (entire tract)`, rule: hcfcdRule };
      const cRate = p.largeTract?.conflictRateAcFtPerAc ?? 0.75; // COH impervious rate — data-driven
      if (inCityLimits && imperviousAcres != null && drainsToHcfcdChannel !== false) {
        const cohCand = { authorityId: "coh", acFt: round2(cRate * imperviousAcres), basis: `${cRate} ac-ft/ac × ${imperviousAcres.toFixed(2)} ac impervious`, rule };
        const gov = governingRequirement([hcfcdCand, cohCand]);
        const picked = gov.candidates.find((c) => c.authorityId === gov.picked);
        const flags = drainsToHcfcdChannel === null ? ["channel-adjacency-unknown"] : [];
        if (rule.secondarySource) flags.push("secondary-source");
        // Pass the PUBLISHED rate (not a back-computed one — that renders as 0.7501960…).
        return pointResult(picked.acFt, gov.picked === "hcfcd" ? hRate : cRate,
          `greater-of: ${hcfcdCand.basis} vs ${cohCand.basis}`, picked.rule, flags, gov);
      }
      return pointResult(hcfcdCand.acFt, hRate, `>${largeMin} ac — ${p.largeTract?.note || "defers to HCFCD PCPM"}: ${hcfcdCand.basis}`, hcfcdRule);
    }
    if (p.flatRate && acres < p.flatRate.maxAcres) {
      // 2026 IDM Table 9.5: 0.8 ac-ft/ac × PROPOSED IMPERVIOUS AREA (not the gross tract),
      // minus a 0.4 ac-ft/ac credit for existing impervious removed on redevelopment.
      const r = p.flatRate.rateAcFtPerAc;
      const flags = rule.secondarySource ? ["secondary-source"] : [];
      // Impervious is the base; if the test-fit hasn't set it, fall back to the tract as a
      // conservative upper bound (impervious ≤ tract, so this never under-sizes) and flag it.
      const baseAc = imperviousAcres != null ? imperviousAcres : acres;
      if (imperviousAcres == null) flags.push("impervious-unknown");
      const credit = removedImperviousAcres > 0 && p.redevelopmentCredit ? p.redevelopmentCredit.rateAcFtPerAc * removedImperviousAcres : 0;
      const baseLabel = imperviousAcres != null ? `${baseAc.toFixed(2)} ac impervious` : `${baseAc.toFixed(2)} ac (full tract — impervious % unknown, conservative upper bound)`;
      const basis = `${r} ac-ft/ac × ${baseLabel}${credit ? ` − ${p.redevelopmentCredit.rateAcFtPerAc} × ${removedImperviousAcres.toFixed(2)} ac removed impervious` : ""}`;
      return pointResult(Math.max(0, r * baseAc - credit), r, basis, rule, flags);
    }
    if (p.smallTract && acres < p.smallTract.maxAcres) {
      const r = p.smallTract.rateAcFtPerAc;
      return pointResult(r * acres, r, `${r} ac-ft/ac × ${acres.toFixed(2)} ac (tract <${p.smallTract.maxAcres} ac, non-single-family)`, rule);
    }
    if (p.midTract) {
      // 2019 IDM Fig. 9.2 curve — approximate until transcribed (flagged).
      const ip = impPct != null ? impPct : 100; // no impervious known → conservative top of curve
      const r = interpolateCurve(p.midTract.curve, ip);
      const flags = p.midTract.transcribed ? [] : ["curve-approximate"];
      if (impPct == null) flags.push("impervious-unknown");
      return pointResult(r * acres, r, `~${round2(r)} ac-ft/ac (IDM Fig. 9.2 curve at ${round2(ip)}% impervious) × ${acres.toFixed(2)} ac`, rule, flags);
    }
  }

  // A rate-typed record for an authority this dispatcher doesn't know — honest unknown.
  return {
    kind: "unknown", requiredAcFt: null, bandAcFt: null, rateAcFtPerAc: null,
    basis: `criteria record ${rule.id} has no dispatch path`,
    rule, governing: null, flags: ["no-criteria-modeled"], caveat: SCREENING_CAVEAT,
  };
}

/* One formatter for the rule sub-note so panel/print never drift:
 * "HCFCD 0.65 ac-ft/ac · eff. Mar 2021 · verified Jul 2026". */
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const fmtYm = (iso) => {
  if (!iso) return "?";
  const [y, m] = iso.split("-").map(Number);
  return `${MONTHS[(m || 1) - 1]} ${y}`;
};
export function ruleBadge(rule, rateAcFtPerAc = null) {
  if (!rule) return "no rule record";
  const label = rule.authorityLabel || rule.authority;
  const rate =
    rateAcFtPerAc != null ? `${rateAcFtPerAc} ac-ft/ac` :
    rule.params?.rateAcFtPerAc != null ? `${rule.params.rateAcFtPerAc} ac-ft/ac` :
    rule.params?.bandAcFtPerAc ? `${rule.params.bandAcFtPerAc[0]}–${rule.params.bandAcFtPerAc[1]} ac-ft/ac screening band` :
    "";
  return [label, rate, `eff. ${fmtYm(rule.effectiveDate)}`, `verified ${fmtYm(rule.verifiedOn)}`]
    .filter(Boolean)
    .join(" · ");
}

// ---------------------------------------------------------------------------
// B631 — analysis tier: what drainage analysis will the reviewer demand?
// ---------------------------------------------------------------------------
export const TIER_THRESHOLDS = {
  // hcfcd/coh: >20 ac rides the HCFCD PCPM which requires an Impact Analysis
  // (drainage study) — the practical DIA line for screening.
  hcfcd: { diaAcres: 20 },
  coh: { diaAcres: 20 },
  montgomery: { diaAcres: 20, masterPlanAcres: 640 },
  chambers: { diaAcres: 200 },
  fortbend: { diaAcres: 50, note: "HEC-HMS modeling above 50 ac" },
};

const isSfhaZone = (z) => /^(A|V)/i.test(String(z || "").trim());

export function assessAnalysisTier({ acres = 0, authorityId = null, floodZones = [], channel = null } = {}) {
  const triggers = [];
  const unknowns = [];
  const zones = floodZones || [];
  if (zones.some((z) => isSfhaZone(z.zone))) {
    const names = [...new Set(zones.filter((z) => isSfhaZone(z.zone)).map((z) => `Zone ${z.zone}`))];
    triggers.push({ id: "floodplain", label: "Floodplain", detail: `${names.join(", ")} on site` });
  }
  if (zones.some((z) => /FLOODWAY/i.test(String(z.subtype || "")))) {
    triggers.push({ id: "floodway", label: "Floodway", detail: "regulatory floodway on site — strong DIA trigger" });
  }
  if (channel && channel.near === true) {
    triggers.push({
      id: "regulated-channel",
      label: "Regulated channel",
      detail: `HCFCD unit ${channel.unitNo || "?"}${channel.name ? ` (${channel.name})` : ""}${channel.distFt != null ? ` within ~${Math.round(channel.distFt)} ft` : ""} — adjacency screen, not a traced discharge path (B634)`,
    });
  } else if (!channel || channel.near == null) {
    unknowns.push({ id: "regulated-channel", label: "Channel adjacency unknown" });
  }
  const th = TIER_THRESHOLDS[authorityId];
  if (th && acres > th.diaAcres) {
    triggers.push({ id: "tract-size", label: "Tract size", detail: `${round2(acres)} ac > ${th.diaAcres} ac ${authorityId} threshold${th.note ? ` (${th.note})` : ""}` });
  }
  if (th && th.masterPlanAcres && acres > th.masterPlanAcres) {
    triggers.push({ id: "master-plan", label: "Master drainage plan", detail: `${round2(acres)} ac > ${th.masterPlanAcres} ac master-plan threshold` });
  }
  const tier = triggers.length ? "dia" : "rate";
  return {
    tier,
    label: tier === "dia" ? "Full drainage impact analysis (DIA) likely" : "Rate-method detention likely sufficient",
    triggers,
    unknowns,
  };
}

// ---------------------------------------------------------------------------
// B632 — hydraulic regime: which sizing driver applies BEFORE any coverage claim.
//   A (flowline-governed): outside SFHA / BFE well below grade → a deep outfall
//     is a real coverage saving.
//   B (floodplain/tailwater-governed): BFE within ~pond depth of ground → the
//     outlet is drowned in the design storm; BFE + mitigation govern; a deep
//     flowline must NOT be credited.
// ---------------------------------------------------------------------------
const BFE_SENTINEL_MIN = -9000; // NFHL publishes -9999 for "no static BFE"

export function assessHydraulicRegime({
  floodZones = [],
  groundElevFt = null,
  groundDatum = "NAVD88", // 3DEP bare-earth is NAVD88 (US survey feet)
  pondDepthFt = 8,
} = {}) {
  const zones = floodZones || [];
  const sfha = zones.filter((z) => isSfhaZone(z.zone));
  const out = { regime: "unknown", label: "", reasons: [], consequence: "", wetBottomWarning: false, elevations: null, flags: [] };

  if (!sfha.length) {
    out.regime = "A";
    out.label = "Regime A — flowline-governed";
    out.reasons.push("No Special Flood Hazard Area mapped on the site.");
    out.consequence = "A deep outfall could reduce detention footprint — worth confirming the receiving flowline (see B634).";
    return out;
  }

  const withBfe = sfha.filter((z) => z.staticBfeFt != null && z.staticBfeFt > BFE_SENTINEL_MIN);
  if (!withBfe.length) {
    out.regime = "unknown";
    out.label = "Regime unknown";
    out.reasons.push("regime unknown — floodplain present but no published BFE");
    out.consequence = "Zone A (no static BFE published): the governing water surface can't be established from the map alone — a flood study or the effective model is needed. Never assume a deep outfall helps here.";
    out.flags.push("no-published-bfe");
    return out;
  }

  // The GOVERNING (highest) BFE drives the regime — read its datum from the SAME zone
  // it came from, never from a different zone (a borrowed datum could mislabel feet).
  const governingZone = withBfe.reduce((a, z) => (z.staticBfeFt > a.staticBfeFt ? z : a), withBfe[0]);
  const bfeFt = governingZone.staticBfeFt;
  const bfeDatum = governingZone.vdatum || null;
  if (!bfeDatum) {
    out.regime = "unknown";
    out.label = "Regime unknown";
    out.flags.push("bfe-datum-unpublished");
    out.reasons.push(`BFE ${bfeFt.toFixed(1)} ft published WITHOUT a vertical datum — rejected rather than assumed (an elevation without its datum can be off by feet).`);
    out.consequence = "Confirm the BFE's datum (usually NAVD88) against the FIRM panel before comparing elevations.";
    return out;
  }
  if (groundElevFt == null) {
    out.regime = "unknown";
    out.label = "Regime unknown";
    out.reasons.push(`BFE ${bfeFt.toFixed(1)} ft ${bfeDatum} is published, but ground elevation is not sampled yet.`);
    out.consequence = "Sample site grade (3DEP) to compare against the BFE.";
    out.flags.push("ground-elevation-missing");
    out.elevations = { bfeFt, bfeDatum, groundFt: null, groundDatum, marginFt: null };
    return out;
  }

  const marginFt = groundElevFt - pondDepthFt - bfeFt; // >0 → basin floor sits above BFE
  out.elevations = { bfeFt, bfeDatum, groundFt: round2(groundElevFt), groundDatum, marginFt: round2(marginFt) };
  if (marginFt < 0) {
    out.regime = "B";
    out.label = "Regime B — floodplain / tailwater-governed";
    out.reasons.push(
      `BFE ${bfeFt.toFixed(1)} ft ${bfeDatum} is within the pond depth of site grade ${groundElevFt.toFixed(1)} ft ${groundDatum} (basin floor ≈ ${(groundElevFt - pondDepthFt).toFixed(1)} ft — ${Math.abs(marginFt).toFixed(1)} ft BELOW the BFE).`
    );
    out.consequence =
      "Outfall depth will not reduce detention here — the outlet is drowned during the design storm; BFE, top-of-bank and floodplain mitigation govern.";
    out.wetBottomWarning = true; // permanent pool below the static water surface stores nothing
    return out;
  }
  out.regime = "A";
  out.label = "Regime A — flowline-governed";
  out.reasons.push(
    `BFE ${bfeFt.toFixed(1)} ft ${bfeDatum} sits ${marginFt.toFixed(1)} ft below the basin floor (grade ${groundElevFt.toFixed(1)} ft ${groundDatum} − ${pondDepthFt} ft depth).`
  );
  out.consequence = "A deep outfall could reduce detention footprint — worth confirming the receiving flowline (see B634).";
  return out;
}

/* B634 tier-2 slice — LiDAR outfall screen for Regime A. Given the nearest HCFCD
 * channel + a 3DEP ditch profile through it (ditchStats shape from lib/elevation.js),
 * emit the value-of-information line. NEVER credits anything automatically. Pure. */
export function screenOutfall({ channel = null, ditch = null, siteGradeFt = null } = {}) {
  if (!channel || channel.near !== true) return null;
  const name = `${channel.unitNo || "HCFCD unit"}${channel.name ? ` (${channel.name})` : ""}`;
  if (!ditch || ditch.invertFt == null || !(ditch.depthFt > 0)) {
    return {
      headline: `Receiving channel ${name} is adjacent${channel.distFt != null ? ` (~${Math.round(channel.distFt)} ft)` : ""}.`,
      detail: "Its flowline depth is unsourced — if the channel is deep and unsubmerged in the design storm, a deep outfall could cut the detention footprint meaningfully. Worth pulling: the effective HEC-RAS section or LiDAR across the ditch (B634).",
      flags: ["outfall-unsourced"],
    };
  }
  const rel = siteGradeFt != null ? ` (~${Math.max(0, siteGradeFt - ditch.invertFt).toFixed(1)} ft below site grade)` : "";
  return {
    headline: `Receiving channel ${name}: LiDAR ditch bottom ≈ ${ditch.invertFt.toFixed(1)} ft NAVD88${rel}, ~${ditch.depthFt.toFixed(1)} ft deep at the sampled section.`,
    detail: "LiDAR bare-earth screening only — it reads the ditch bottom, not the design-storm water surface. If the design-storm tailwater is low (unsubmerged), a deep outfall could reduce the detention footprint; confirm the WSEL from the effective model before crediting anything (B634).",
    flags: ["lidar-screening"],
  };
}

// ---------------------------------------------------------------------------
// B633 — pond auto-size solvers. Inverse of detentionStorage(): find the expand
// offset (or depth) that hits the target volume. Volumes are CUBIC FEET at this
// boundary; ac-ft conversion belongs to the display layer. `volumeAt` is injected
// (the caller closes over expandPolygon/detentionStorage) so this stays pure and
// Node-testable with synthetic geometry.
// ---------------------------------------------------------------------------
export function solvePondExpansion({
  requiredCf,
  deadStorageCf = 0,
  volumeAt, // (expandFt) => {vol, feasible, maxDepth} | null when the geometry fails
  maxExpandFt = 2000,
  tolCf = 435.6, // ~0.01 ac-ft
  maxIter = 60,
} = {}) {
  const target = requiredCf + deadStorageCf;
  const at = (ft) => {
    const r = volumeAt(ft);
    return r == null ? null : r.vol;
  };
  const v0 = at(0);
  if (v0 == null) return { ok: false, reason: "geometry-failed", atFt: 0, bestCf: null };
  if (v0 >= target - tolCf) return { ok: false, reason: "already-sufficient", atFt: 0, bestCf: v0 };

  // Bracket by doubling. A null (self-intersecting / failed offset) mid-search is a
  // hard stop — the banks can't be pushed out cleanly past that offset on this shape.
  // The final probe is CLAMPED to maxExpandFt so the cap itself is always evaluated
  // before declaring no-bracket (a plain `step *= 2` can leap past the cap untested).
  let lo = 0, hi = null, best = v0, step = 5;
  while (true) {
    const probe = Math.min(step, maxExpandFt);
    const v = at(probe);
    if (v == null) return { ok: false, reason: "geometry-failed", atFt: probe, bestCf: best };
    best = Math.max(best, v);
    if (v >= target) { hi = probe; break; }
    lo = probe;
    if (probe >= maxExpandFt) break; // evaluated the cap and it's still short
    step *= 2;
  }
  if (hi == null) return { ok: false, reason: "no-bracket", atFt: maxExpandFt, bestCf: best };

  for (let i = 0; i < maxIter && hi - lo > 0.5; i++) {
    const mid = (lo + hi) / 2;
    const v = at(mid);
    if (v == null) { hi = mid; continue; } // shrink toward the working side
    if (v >= target) hi = mid;
    else lo = mid;
  }
  // Round UP to a whole foot (matches the expand-mode stepper granularity) and
  // re-verify the rounded offset actually meets the target.
  let expandFt = Math.ceil(hi);
  let vFinal = at(expandFt);
  if (vFinal == null || vFinal < target - tolCf) {
    expandFt += 1;
    vFinal = at(expandFt);
    if (vFinal == null || vFinal < target - tolCf) return { ok: false, reason: "geometry-failed", atFt: expandFt, bestCf: vFinal };
  }
  return { ok: true, expandFt, achievedCf: vFinal };
}

export function solvePondDepth({
  requiredCf,
  deadStorageCf = 0,
  volumeAtDepth, // (depthFt) => {vol, feasible, maxDepth}
  startDepthFt = 8,
  maxDepthFt = 40,
  tolCf = 435.6,
} = {}) {
  const target = requiredCf + deadStorageCf;
  const r0 = volumeAtDepth(startDepthFt);
  if (r0 && r0.vol >= target - tolCf) return { ok: false, reason: "already-sufficient", depthFt: startDepthFt, bestCf: r0.vol };
  // The footprint can only grade to maxDepth before opposing slopes meet — the
  // volume plateaus there. If the plateau is below target: slopes collapse first.
  const cap = r0 ? Math.min(maxDepthFt, r0.maxDepth) : maxDepthFt;
  const vCap = volumeAtDepth(cap);
  if (!vCap || vCap.vol < target - tolCf) {
    return { ok: false, reason: "slopes-collapse", maxUsableDepthFt: round2(cap), bestCf: vCap ? vCap.vol : null };
  }
  let lo = startDepthFt, hi = cap;
  for (let i = 0; i < 60 && hi - lo > 0.05; i++) {
    const mid = (lo + hi) / 2;
    const v = volumeAtDepth(mid);
    if (v && v.vol >= target) hi = mid;
    else lo = mid;
  }
  const depthFt = Math.ceil(hi * 2) / 2; // half-foot granularity, rounded up
  const vFinal = volumeAtDepth(Math.min(depthFt, cap));
  if (!vFinal || vFinal.vol < target - tolCf) return { ok: false, reason: "slopes-collapse", maxUsableDepthFt: round2(cap), bestCf: vFinal ? vFinal.vol : null };
  return { ok: true, depthFt: Math.min(depthFt, cap), achievedCf: vFinal.vol };
}

/* Per-authority pond geometry defaults (side slope, freeboard, wet-bottom) — from
 * the rule record's params, never hardcoded in the component. */
export function pondDefaultsFor(authorityId, onDate) {
  const rule = ruleFor(authorityId, onDate);
  return rule?.params?.pond || { sideSlope: 3, freeboardFt: 1 };
}

/* Regime-B dead storage: how deep the permanent pool sits in the basin. The pool
 * surface is the static water level ≈ BFE-adjacent water table; below it the basin
 * stores nothing creditable. Returns feet of pool depth (0..depth-freeboard), or
 * null when the elevations aren't established — the caller must REFUSE to solve
 * against a fabricated usable volume, never guess. */
export function deadStoragePoolDepthFt({ bfeFt = null, groundElevFt = null, depthFt = 8, freeboardFt = 1 } = {}) {
  if (bfeFt == null || groundElevFt == null) return null;
  const floorFt = groundElevFt - depthFt;
  const pool = bfeFt - floorFt; // static water surface above the basin floor
  return Math.max(0, Math.min(pool, depthFt - freeboardFt));
}

// ---------------------------------------------------------------------------
// The drainage-authority resolver (B629) — identifyJurisdiction + the queried
// TCEQ MUD layer (+ HCFCD channels & watersheds for Harris sites).
// ---------------------------------------------------------------------------

/* Identify-source rows, registry-fed (same shape identifySource consumes). The
 * composed url (serviceUrl + "/" + layerId) is registry-derived — no inline URL. */
export const DETENTION_SOURCES = {
  mud: {
    id: "mud",
    role: "mud",
    label: "MUD / water district",
    kind: "polygon",
    url: GIS_SOURCES.mud.serviceUrl + "/" + GIS_SOURCES.mud.layerId,
    fields: GIS_SOURCES.mud.fields,
    ttl: 30 * DAY,
    sourceName: GIS_SOURCES.mud.provider,
    note: "District boundary — a taxing/authority district, not proof of service. Screening only.",
  },
  hcfcdChannel: {
    id: "hcfcdChannel",
    role: "channel",
    label: "HCFCD channel (adjacency proxy)",
    kind: "line", // rides the buffered line path in buildIdentifyParams (frontage semantics)
    url: GIS_SOURCES.hcfcdChannels.serviceUrl + "/" + GIS_SOURCES.hcfcdChannels.layerId,
    fields: GIS_SOURCES.hcfcdChannels.fields,
    tolMeters: 90, // generous adjacency buffer; per-feature distance is re-measured below
    ttl: 30 * DAY,
    sourceName: GIS_SOURCES.hcfcdChannels.provider,
    note: "ADJACENCY screen — proximity to an HCFCD unit, never a traced discharge path (B634).",
  },
  hcfcdWatershed: {
    id: "hcfcdWatershed",
    role: "watershed",
    label: "HCFCD watershed",
    kind: "polygon",
    url: GIS_SOURCES.hcfcdWatersheds.serviceUrl + "/" + GIS_SOURCES.hcfcdWatersheds.layerId,
    fields: GIS_SOURCES.hcfcdWatersheds.fields,
    ttl: 30 * DAY,
    sourceName: GIS_SOURCES.hcfcdWatersheds.provider,
  },
  detFlood: {
    id: "detFlood",
    role: "flood",
    label: "FEMA flood zones",
    kind: "polygon",
    url: GIS_SOURCES.flood.serviceUrl + "/" + GIS_SOURCES.flood.layerId,
    fields: GIS_SOURCES.flood.fields,
    ttl: 7 * DAY,
    sourceName: GIS_SOURCES.flood.provider,
  },
};

/* TCEQ district TYPE codes whose engineers actually review parcel drainage / can
 * impose criteria. The layer ALSO carries county-blanket authorities (Coastal Water
 * Authority, Port of Houston, river/regional authorities, SWCDs) — without this
 * filter EVERY Harris point would read "in a district" (a false-flag machine). */
export const PARCEL_DISTRICT_TYPES = new Set(["MUD", "WCID", "LID", "DD", "FWSD", "SUD", "WID"]);

/* County (TxDOT CNTY_NM, lowercased) → detention authority id. */
export const COUNTY_AUTHORITY = {
  harris: "hcfcd",
  "fort bend": "fortbend",
  montgomery: "montgomery",
  chambers: "chambers",
  waller: "waller",
};

/* City (TxGIO city_name, lowercased) → municipal overlay id. */
const CITY_OVERLAYS = { "missouri city": "missouricity", magnolia: "magnolia" };

/* Pure mapping: jurisdiction facts → who reviews drainage. Straddles surface in
 * `ambiguous` (never silently defaulted); unmodeled cities keep the county
 * authority with an honest flag. */
export function authorityForJurisdiction({ city = [], etj = [], county = [], unincorporated = true } = {}) {
  const out = { primary: null, channelAuthority: null, overlays: [], ambiguous: [], flags: [] };
  const counties = county.map((c) => String(c).toLowerCase());
  const cities = city.map((c) => String(c).toLowerCase());
  const etjs = etj.map((c) => String(c).toLowerCase());

  if (counties.includes("harris")) out.channelAuthority = "hcfcd";

  if (counties.length > 1) {
    out.ambiguous.push({
      kind: "straddle",
      candidates: counties.map((c) => COUNTY_AUTHORITY[c] || null),
      detail: `Parcel straddles ${county.join(" + ")} — county criteria differ; both shown, none assumed.`,
    });
    return out;
  }
  const countyAuth = counties.length ? COUNTY_AUTHORITY[counties[0]] || null : null;
  if (cities.length > 1) {
    // Map each straddled city to its AUTHORITY id (Houston→coh, overlay cities→their
    // overlay id, otherwise the containing county's authority) so the UI can price
    // each candidate — raw city names would every one render "unknown".
    const cityAuth = (c) => (c === "houston" ? "coh" : CITY_OVERLAYS[c] || countyAuth || null);
    out.ambiguous.push({
      kind: "straddle",
      candidates: cities.map(cityAuth),
      detail: `Parcel straddles ${city.join(" + ")} city limits — reviewing city ambiguous.`,
    });
    return out;
  }

  if (counties.length && !countyAuth) out.flags.push("no-criteria-modeled");

  if (cities.includes("houston") || etjs.includes("houston")) {
    // COH IDM applies inside the city AND in its ETJ.
    out.primary = "coh";
    return out;
  }
  const overlayCity = cities.find((c) => CITY_OVERLAYS[c]);
  if (overlayCity) {
    out.primary = CITY_OVERLAYS[overlayCity]; // the thin overlay record dispatches to its parent
    out.overlays.push({ kind: "municipal", id: CITY_OVERLAYS[overlayCity], name: city[cities.indexOf(overlayCity)] });
    return out;
  }
  if (cities.length) {
    // A city we haven't modeled: the county criteria are the screening floor, flagged.
    out.primary = countyAuth;
    out.flags.push("city-criteria-unverified");
    return out;
  }
  out.primary = countyAuth; // unincorporated
  return out;
}

const shapeSourceState = (r, error) =>
  error ? "failed" : r && r.items && r.items.length ? "loaded" : "empty";

/* Resolve who reviews this parcel's drainage. Composes identifyJurisdiction (county /
 * city / ETJ — same cache) with the QUERIED TCEQ MUD layer. opts.{cache, fetchJson,
 * onStatus} thread through both, exactly like the jurisdiction identify. */
export async function resolveDrainageAuthority({ lng, lat, ring = null } = {}, opts = {}) {
  const geom = ring && ring.length >= 3 ? { ring } : { lng, lat };
  // Thread the ring into the jurisdiction identify too — otherwise county/city/ETJ
  // are point-at-centroid queries and a boundary straddle can NEVER be detected
  // (authorityForJurisdiction's straddle branch needs counties.length>1, which a
  // point query can't produce), and city/ETJ membership reads centroid-only.
  const jurOpts = geom.ring ? { ...opts, ring: geom.ring } : opts;
  const [jur, mudRes] = await Promise.all([
    identifyJurisdiction(lng, lat, jurOpts),
    identifySource(DETENTION_SOURCES.mud, geom, opts).fresh,
  ]);
  const auth = authorityForJurisdiction(jur);
  const out = {
    primaryReviewer: auth.primary ? { authorityId: auth.primary, rule: ruleFor(auth.primary) } : null,
    channelAuthority: auth.channelAuthority,
    overlays: [...auth.overlays],
    ambiguous: [...auth.ambiguous],
    flags: [...auth.flags],
    jurisdiction: jur,
    mud: { districts: [], state: shapeSourceState(mudRes, mudRes.error), ageMs: mudRes.ageMs, msg: mudRes.error ? String(mudRes.error.message || mudRes.error) : null },
    sources: [...jur.sources, { id: "mud", state: shapeSourceState(mudRes, mudRes.error), ageMs: mudRes.ageMs }],
    note: "Screening only — verify the reviewing authority before design. District and city criteria change.",
  };
  if (!mudRes.error) {
    const districts = mudRes.items
      .map((it) => normalizeFeature(DETENTION_SOURCES.mud, it.attrs))
      .filter((d) => PARCEL_DISTRICT_TYPES.has(String(d.type || "").toUpperCase()));
    out.mud.districts = districts;
    for (const d of districts) {
      out.overlays.push({ kind: "mud", name: d.name, type: d.typeDesc || d.type });
    }
    if (districts.length) out.flags.push("mud-district-present");
  }
  // The county lookup FAILING (outage) with no authority resolved is an unknown, not
  // an unincorporated-nowhere: flag it so the UI can say "couldn't resolve" instead
  // of silently showing no requirement at all (the silent-failure class).
  const roleFailed = (id) => jur.sources.some((s) => s.id === id && s.state === "failed");
  if (!out.primaryReviewer && !out.ambiguous.length && roleFailed("county")) {
    out.flags.push("jurisdiction-unavailable");
  }
  // A city/ETJ layer outage while the county resolved is subtler: the authority may
  // read as the county default only BECAUSE the city/ETJ query failed (a Houston
  // parcel could silently downgrade to HCFCD). Flag it so the UI caveats the result.
  if (out.primaryReviewer && !out.primaryReviewer.rule?.params?.appliesInEtj && (roleFailed("city") || roleFailed("etj"))) {
    out.flags.push("jurisdiction-partial");
  }
  return out;
}

/* Everything the Stormwater readout needs, one orchestrated call: authority + flood
 * facts + channel adjacency + watershed overlays (Harris) + ground elevation (via the
 * injected sampler — lib/elevation.js sampleProfile in the app; absent in tests).
 * Tier / regime / required-volume are NOT computed here — they're pure functions the
 * UI re-derives each render from this context + live metrics (zero refetch on edits). */
export async function resolveDrainageContext({ lng, lat, ring = null } = {}, opts = {}) {
  const geom = ring && ring.length >= 3 ? { ring } : { lng, lat };
  const authorityP = resolveDrainageAuthority({ lng, lat, ring }, opts);
  const floodP = identifySource(DETENTION_SOURCES.detFlood, geom, opts).fresh;
  const authority = await authorityP;
  const inHarris = authority.channelAuthority === "hcfcd";

  const [floodRes, chanRes, wsRes, groundElevFt] = await Promise.all([
    floodP,
    inHarris ? identifySource(DETENTION_SOURCES.hcfcdChannel, geom, opts).fresh : Promise.resolve(null),
    inHarris ? identifySource(DETENTION_SOURCES.hcfcdWatershed, geom, opts).fresh : Promise.resolve(null),
    opts.sampleGround ? opts.sampleGround({ lng, lat, ring }).catch(() => null) : Promise.resolve(null),
  ]);

  const zones = floodRes.error
    ? []
    : floodRes.items.map((it) => {
        const f = normalizeFeature(DETENTION_SOURCES.detFlood, it.attrs);
        return { zone: f.zone, subtype: f.subtype, staticBfeFt: f.elev != null && f.elev > BFE_SENTINEL_MIN ? f.elev : null, vdatum: f.vdatum || null };
      });

  let channel = { near: null, state: inHarris ? "unavailable" : "not-applicable" };
  if (chanRes && !chanRes.error) {
    let best = null;
    for (const it of chanRes.items) {
      const f = normalizeFeature(DETENTION_SOURCES.hcfcdChannel, it.attrs);
      let distM = Infinity;
      if (it.geometry) {
        const pts = ring && ring.length ? ring : [[lng, lat]];
        for (const [plng, plat] of pts) distM = Math.min(distM, polylineDistMeters(it.geometry, plng, plat));
      }
      // Retain the nearest unit's polyline so the outfall screen (B634) can check a
      // user cross-section actually crosses THIS channel before attributing it.
      if (!best || distM < best.distM) best = { unitNo: f.unitNo, name: f.name, type: f.type, distM, geometry: it.geometry || null };
    }
    channel = best
      ? { near: true, unitNo: best.unitNo, name: best.name, type: best.type, distFt: best.distM === Infinity ? null : Math.round(best.distM * FT_PER_M), geometry: best.geometry, state: "loaded" }
      : { near: false, state: "empty" };
  } else if (chanRes && chanRes.error) {
    channel = { near: null, state: "failed" }; // honest unknown — never "no channel"
  }

  let watershed = null;
  const watershedOverlays = [];
  if (wsRes && !wsRes.error && wsRes.items.length) {
    const names = [...new Set(wsRes.items.map((it) => normalizeFeature(DETENTION_SOURCES.hcfcdWatershed, it.attrs).name).filter(Boolean))];
    watershed = { names, state: "loaded", ageMs: wsRes.ageMs };
    for (const ov of WATERSHED_OVERLAYS) {
      if (names.some((n) => ov.match.test(n))) watershedOverlays.push(ov);
    }
  } else if (wsRes) {
    watershed = { names: [], state: wsRes.error ? "failed" : "empty", ageMs: wsRes.ageMs ?? null };
  }

  return {
    authority,
    flood: { zones, state: floodRes.error ? "failed" : zones.length ? "loaded" : "empty", ageMs: floodRes.ageMs },
    channel,
    watershed,
    watershedOverlays,
    groundElevFt,
    groundDatum: "NAVD88",
    note: SCREENING_CAVEAT,
  };
}
