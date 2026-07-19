/* NEW-A1 — the versioned JURISDICTION DETENTION-CRITERIA REGISTRY.
 *
 * WHAT THIS IS: the single cited home for the pond-DESIGN + OUTLET-HYDRAULICS criteria
 * the Phase-A outlet / stage-storage-discharge / routing engines consume — allowable
 * release, the storm events a reviewer wants Post ≤ Pre proven at, freeboard, side
 * slope, the maintenance-berm ring, and the orifice / weir / restrictor discharge
 * coefficients — each carrying its provenance (governing manual + section + a
 * verified flag). It mirrors the GIS Source Registry (shared/gis/sources.js): keyed
 * rows, an authoritative provider, lastVerified dates, a `problems()` audit the CI
 * guard runs (test/detentionCriteria.test.js), and user-editable overrides.
 *
 * DEDUPE-FIRST (owner decision, this session): the release-rate / required-storm /
 * freeboard facts that are ALREADY primary-source-verified in detentionRules.js
 * (DETENTION_RULES — e.g. FBCDD §6.4.1 max release 0.125 cfs/ac, §6.4.7 freeboard
 * 1 ft, the 10/100-yr Post ≤ Pre events) are the SINGLE SOURCE OF TRUTH. This registry
 * REFERENCES them (via ruleFor(authorityRuleId)) rather than re-transcribing a second
 * copy that could drift — `criteriaFor` composes the rule-record facts with the outlet
 * + geometry criteria this registry adds. This registry's OWN data is the outlet
 * hydraulics + pond geometry the rule records don't carry, promoted from the B709
 * pondCriteriaRules placeholders to CITED rows (verified where a primary source backs
 * them, honestly verified:false where it doesn't).
 *
 * Keyed by JURISDICTION (coh / harris / fortbend / montgomery / chambers / waller /
 * bkdd / generic) — matching pondCriteriaRules.js + floodplainRules.js so one picker
 * drives all three — and each row names its DETENTION_RULES AUTHORITY id
 * (harris → hcfcd) for the reference lookup.
 *
 * Screening only — every value carries the SCREENING caveat and, until a human confirms
 * it against the primary manual, verified:false. Orifice/weir coefficients are STANDARD
 * open-channel hydraulics (verified as physics), but the JURISDICTION may specify its own
 * — an override always wins. Pure + Node-testable; no DOM/network. */
import { ruleFor, DETENTION_RULES, AUTHORITY_SHORT, SCREENING_CAVEAT } from "./detentionRules.js";

const LS = "planarfit:detentionCriteria:v1";

/* A provenance-carrying criterion value. `value` is the number/array; `verified` marks a
 * human-confirmed primary-source transcription; `section` cites the governing manual's
 * subsection (the row's governingManual supplies the manual name + url). `ref:true` means
 * the authoritative value lives in the DETENTION_RULES record — this row only labels it. */
const c = (value, verified, section, extra = {}) => ({ value, verified: !!verified, section: section || null, ...extra });

// Standard open-channel discharge coefficients (US customary, feet + cfs). These are
// PHYSICS, not jurisdiction placeholders, so they seed verified:true; a district that
// mandates a different coefficient overrides. Sharp-edged orifice Q = C·A·√(2g·h),
// C ≈ 0.6; broad-crested weir Q = C·L·h^1.5, C ≈ 3.33 (rectangular, US units).
const STD_ORIFICE_C = 0.6;
const STD_WEIR_C = 3.33;

// ---------------------------------------------------------------------------
// The registry. Task order: Waller, Brookshire–Katy DD, Fort Bend, Harris/HCFCD first.
// ---------------------------------------------------------------------------
export const DETENTION_CRITERIA = {
  waller: {
    key: "waller",
    label: "Waller County",
    authorityRuleId: "waller",
    provider: "Waller County (Subdivision & Development Regulations)",
    governingManual: {
      name: "Waller County Subdivision & Development Regulations (rev. 2023-12-06), Appendix E — Detention",
      section: "Appendix E, Volume Requirements",
      url: "https://www.co.waller.tx.us/upload/page/0263/Subdivision%20-%20Development%20Regulations%20REVISED_FINAL-12-06-2023.pdf",
      effectiveDate: "2023-12-06",
    },
    postLePre: true, // Small-Watershed / HEC-HMS hydrograph governs above the coefficient method
    lastVerified: "2026-07-18",
    criteria: {
      // Release / storms / freeboard reference the rule record where present, else a screening default.
      freeboardFt: c(1, false, "regional practice — verify with the County Engineer"),
      maxSideSlope: c(3, false, "3:1 interior — commonly cited; verify"),
      maintBermFt: c(30, false, "maintenance shelf — screening convention; verify"),
      orificeC: c(STD_ORIFICE_C, true, "sharp-edged orifice (standard hydraulics)"),
      weirC: c(STD_WEIR_C, true, "rectangular weir (standard hydraulics)"),
      drawdownMaxHr: null,
      gravityDrainFraction: null,
      requiredStorms: c([10, 100], false, "100-yr governs; 10-yr screening pair — verify"),
      rationalMethodMaxAcres: c(200, false, "NRCS/TxDOT screening rule of thumb — Rational method ceiling; verify vs the governing manual"),
    },
    note: "Waller publishes volumetric rates (0.55 ac-ft/ac floor .. 0.65 coefficient); the RATE proof (Post ≤ Pre) is hydrograph-derived above small sites — verify with the county engineer.",
  },

  bkdd: {
    key: "bkdd",
    label: "Brookshire–Katy Drainage District",
    authorityRuleId: "bkdd",
    provider: "Brookshire–Katy Drainage District",
    governingManual: {
      name: "Brookshire–Katy Drainage District Rules & Regulations (signed 2022-02-28) + Drainage & Detention Summary Tables template",
      section: "Detention = rate-match (no increase in post-development peak discharge, offsite areas included)",
      url: "https://www.bkdd.dst.tx.us/page/BKDD.RulesRegulations",
      effectiveDate: "2022-02-28",
    },
    postLePre: true, // the defining criterion — RATE control, no volumetric rate
    secondarySource: true,
    lastVerified: "2026-07-16",
    criteria: {
      freeboardFt: c(1, false, "1-ft freeboard from the 100-yr WSE — regional practice; verify"),
      maxSideSlope: c(3, false, "3:1 interior — commonly cited; verify"),
      maintBermFt: c(30, false, "maintenance shelf — screening convention; verify"),
      orificeC: c(STD_ORIFICE_C, true, "sharp-edged orifice (standard hydraulics)"),
      weirC: c(STD_WEIR_C, true, "rectangular weir (standard hydraulics)"),
      drawdownMaxHr: null,
      gravityDrainFraction: null,
      // Referenced from the BKDD rule record's designStorms [2,10,100] (single source of truth).
      requiredStorms: c([2, 10, 100], false, "Post ≤ Pre at the 2/10/100-yr storms (rule record; verify)", { ref: true }),
      rationalMethodMaxAcres: c(200, false, "NRCS/TxDOT screening rule of thumb — Rational method ceiling; verify vs the governing manual"),
    },
    note: "RATE-control district: detention is proven by hydrograph routing (Post ≤ Pre at 2/10/100-yr, offsite included), NOT a volumetric ac-ft/ac rule. The routing here is a SCREENING proxy; the district engineer's HEC-HMS governs.",
  },

  fortbend: {
    key: "fortbend",
    label: "Fort Bend County",
    authorityRuleId: "fortbend",
    provider: "Fort Bend County Drainage District (FBCDD)",
    governingManual: {
      name: "FBCDD Drainage Criteria Manual, Ch. 6 Storm Runoff Storage + Interim Atlas-14 DCM",
      section: "§6.4.1 (release rate) / §6.4.7 (freeboard) / Interim §5 (gravity drain)",
      url: "https://www.fortbendcountytx.gov/sites/default/files/document-central/document-central/drainage-district-documents/drainage-criteria-manual/60StormRunoffStorage.pdf",
      effectiveDate: "2020-01-01",
    },
    postLePre: true,
    lastVerified: "2026-07-05",
    criteria: {
      // These three REFERENCE the FBCDD rule record (verified transcriptions there).
      allowableReleaseCfsPerAc: c(0.125, true, "DCM §6.4.1 — max 100-yr release 0.125 cfs/ac", { ref: true }),
      freeboardFt: c(1, true, "DCM §6.4.7 — 1 ft above the 100-yr pond WSE", { ref: true }),
      gravityDrainFraction: c(0.5, true, "Interim §5 — ≥50% drains by gravity", { ref: true }),
      requiredStorms: c([10, 100], true, "Interim §4.a — Post ≤ Pre at the 10- and 100-yr", { ref: true }),
      rationalMethodMaxAcres: c(200, false, "NRCS/TxDOT screening rule of thumb — Rational method ceiling; verify vs the governing manual"),
      maxSideSlope: c(3, false, "3:1 interior — commonly cited; verify vs the DCM"),
      maintBermFt: c(30, false, "maintenance shelf — screening convention; verify"),
      orificeC: c(STD_ORIFICE_C, true, "sharp-edged orifice (standard hydraulics)"),
      weirC: c(STD_WEIR_C, true, "rectangular weir (standard hydraulics)"),
      drawdownMaxHr: null,
    },
    note: "FBCDD publishes both a volumetric rate (Table 6-1) and a 0.125 cfs/ac release cap; the routing proves Post ≤ Pre at 10/100-yr. Tailwater convention (§6.4.1/§6.4.5) can drown the outlet — see the hydraulic-regime gate.",
  },

  harris: {
    key: "harris",
    label: "Harris County (unincorporated) / HCFCD",
    authorityRuleId: "hcfcd",
    provider: "Harris County Flood Control District (PCPM) + HCED Infrastructure Regulations",
    governingManual: {
      name: "HCFCD Policy, Criteria & Procedure Manual (Rev. July 2019) + HCED Infrastructure Regulations (eff. 7/9/2019)",
      section: "PCPM detention + HCED outfall-type minimums / drawdown",
      url: "https://www.hcfcd.org/Resources/Technical-Manuals",
      effectiveDate: "2019-07-09",
    },
    postLePre: true,
    lastVerified: "2026-07-11",
    criteria: {
      // Harris HCED sizes restrictors with a sharp-edged orifice C ≈ 0.8 and a 4-day (96 h)
      // drawdown of the design volume — from pondCriteriaRules (B822), still verify:false
      // pending the primary text, but CITED to HCED now.
      orificeC: c(0.8, false, "HCED Infrastructure Regs — sharp-edged restrictor C ≈ 0.8 (verify vs primary)"),
      weirC: c(STD_WEIR_C, true, "rectangular weir (standard hydraulics)"),
      drawdownMaxHr: c(96, false, "HCED Infrastructure Regs — drawdown ≤ 4 days (96 h) (verify vs primary)"),
      // Freeboard + side slope reference the HCFCD Wet Bottom Basin geometry in the rule record.
      freeboardFt: c(1, false, "HCFCD Wet Bottom Basin guideline (rule record)", { ref: true }),
      maxSideSlope: c(3, false, "HCFCD Wet Bottom Basin guideline — 3:1 (rule record)", { ref: true }),
      maintBermFt: c(30, false, "maintenance shelf — screening convention; verify"),
      gravityDrainFraction: null,
      requiredStorms: c([10, 100], false, "PCPM rate method — 100-yr governs; 10-yr screening pair; verify"),
      rationalMethodMaxAcres: c(200, false, "NRCS/TxDOT screening rule of thumb — Rational method ceiling; verify vs the governing manual"),
    },
    note: "Unincorporated Harris uses HCED outfall-type volumetric minimums (storm-sewer 0.75 / roadside-ditch 1.0 ac-ft/ac); the PCPM rate method proves no peak increase. Restrictor sizing per HCED (C ≈ 0.8, 4-day drawdown).",
  },

  coh: {
    key: "coh",
    label: "City of Houston",
    authorityRuleId: "coh",
    provider: "City of Houston (IDM Ch. 9)",
    governingManual: {
      name: "City of Houston IDM Ch. 9 — Stormwater Detention (Supplement IDMS-2025-01)",
      section: "§9.2.01.H.3, Table 9.5",
      url: "https://www.houstonpermittingcenter.org/office-city-engineer/design-and-construction-standards",
      effectiveDate: "2026-06-01",
    },
    postLePre: true,
    lastVerified: "2026-07-05",
    criteria: {
      freeboardFt: c(1, false, "screening convention — verify vs IDM Ch. 9"),
      maxSideSlope: c(3, false, "3:1 interior — commonly cited; verify"),
      maintBermFt: c(30, false, "maintenance shelf — screening convention; verify"),
      orificeC: c(STD_ORIFICE_C, true, "sharp-edged orifice (standard hydraulics)"),
      weirC: c(STD_WEIR_C, true, "rectangular weir (standard hydraulics)"),
      drawdownMaxHr: null,
      gravityDrainFraction: null,
      requiredStorms: c([100], false, "100-yr governs detention; verify vs IDM Ch. 9"),
      rationalMethodMaxAcres: c(200, false, "NRCS/TxDOT screening rule of thumb — Rational method ceiling; verify vs the governing manual"),
    },
    note: "COH uses a volumetric rate (0.8 ac-ft/ac × proposed impervious ≤20 ac); the routing proves no peak increase. Verify outlet criteria against IDM Ch. 9.",
  },

  montgomery: {
    key: "montgomery",
    label: "Montgomery County",
    authorityRuleId: "montgomery",
    provider: "Montgomery County (Drainage Criteria Manual)",
    governingManual: {
      name: "Montgomery County Drainage Criteria Manual (adopted 2025-08-26)",
      section: "§6.3 (detention)",
      url: "https://www.mctx.org/",
      effectiveDate: "2025-08-26",
    },
    postLePre: true,
    lastVerified: "2026-07-05",
    criteria: {
      freeboardFt: c(1, false, "screening convention — verify vs MoCo DCM"),
      maxSideSlope: c(3, false, "3:1 interior — commonly cited; verify"),
      maintBermFt: c(30, false, "maintenance shelf — screening convention; verify"),
      orificeC: c(STD_ORIFICE_C, true, "sharp-edged orifice (standard hydraulics)"),
      weirC: c(STD_WEIR_C, true, "rectangular weir (standard hydraulics)"),
      drawdownMaxHr: null,
      gravityDrainFraction: null,
      requiredStorms: c([100], false, "zero-increase in peak flow + WSEL; verify vs MoCo DCM"),
      rationalMethodMaxAcres: c(200, false, "NRCS/TxDOT screening rule of thumb — Rational method ceiling; verify vs the governing manual"),
    },
    note: "MoCo requires zero increase in peak flow and WSEL; the routing proves Post ≤ Pre. Verify outlet criteria against the DCM.",
  },

  chambers: {
    key: "chambers",
    label: "Chambers County",
    authorityRuleId: "chambers",
    provider: "Chambers County (Drainage Criteria Manual)",
    governingManual: {
      name: "Chambers County Drainage Criteria Manual (Aug 9, 2005)",
      section: "§1.2.1 Zero-Impact policy",
      url: "https://www.montbelvieu.net/DocumentCenter/View/53/Drainage-Criteria-Manual-8-09-05",
      effectiveDate: "2005-01-01",
    },
    postLePre: true,
    lastVerified: "2026-07-05",
    criteria: {
      freeboardFt: c(1, false, "screening convention — verify vs county DCM"),
      maxSideSlope: c(3, false, "3:1 interior — commonly cited; verify"),
      maintBermFt: c(30, false, "maintenance shelf — screening convention; verify"),
      orificeC: c(STD_ORIFICE_C, true, "sharp-edged orifice (standard hydraulics)"),
      weirC: c(STD_WEIR_C, true, "rectangular weir (standard hydraulics)"),
      drawdownMaxHr: null,
      gravityDrainFraction: null,
      requiredStorms: c([100], false, "zero-impact policy at the 100-yr; verify"),
      rationalMethodMaxAcres: c(200, false, "NRCS/TxDOT screening rule of thumb — Rational method ceiling; verify vs the governing manual"),
    },
    note: "Chambers publishes no flat rate — strict zero-impact (no downstream peak or upstream WSEL increase). The routing proves Post ≤ Pre; volume is calculation-derived.",
  },

  generic: {
    key: "generic",
    label: "Generic / unknown",
    authorityRuleId: null,
    provider: "No jurisdiction matched",
    governingManual: { name: "No jurisdiction matched", section: null, url: null, effectiveDate: null },
    postLePre: true,
    lastVerified: "2026-07-18",
    criteria: {
      freeboardFt: c(1, false, "screening convention"),
      maxSideSlope: c(3, false, "3:1 interior — screening convention"),
      maintBermFt: c(30, false, "maintenance shelf — screening convention"),
      orificeC: c(STD_ORIFICE_C, true, "sharp-edged orifice (standard hydraulics)"),
      weirC: c(STD_WEIR_C, true, "rectangular weir (standard hydraulics)"),
      drawdownMaxHr: null,
      gravityDrainFraction: null,
      requiredStorms: c([10, 100], false, "screening default — no jurisdiction matched"),
      rationalMethodMaxAcres: c(200, false, "NRCS/TxDOT screening rule of thumb — Rational method ceiling; verify vs the governing manual"),
    },
    note: "No jurisdiction matched — screening conventions only. Confirm the reviewing authority and its criteria.",
  },
};

/* Return-period list a jurisdiction wants Post ≤ Pre proven at. References the
 * DETENTION_RULES record first (postLePreEvents like "atlas14-100yr" → 100, or a
 * numeric designStorms), else the registry row's requiredStorms. Pure. */
export function requiredStormsFor(jurKey, onDate = null) {
  const row = DETENTION_CRITERIA[jurKey] || DETENTION_CRITERIA.generic;
  const rule = row.authorityRuleId ? ruleFor(row.authorityRuleId, onDate) : null;
  const p = (rule && rule.params) || {};
  const fromEvents = Array.isArray(p.postLePreEvents)
    ? p.postLePreEvents.map(evYr).filter((n) => n != null)
    : Array.isArray(p.designStorms)
      ? p.designStorms.slice()
      : null;
  const storms = fromEvents && fromEvents.length ? fromEvents : (row.criteria.requiredStorms?.value || []);
  // De-dupe + sort ascending so the routing table reads 2 · 10 · 100.
  return [...new Set(storms)].filter((n) => Number.isFinite(n) && n > 0).sort((a, b) => a - b);
}

// "atlas14-100yr" | "100-yr" | 100 → 100. Pure.
function evYr(ev) {
  if (typeof ev === "number") return ev;
  const m = String(ev || "").match(/(\d+)\s*yr/i) || String(ev || "").match(/(\d+)$/);
  return m ? Number(m[1]) : null;
}

/* The composed, override-applied criteria for a jurisdiction — the ONE call the outlet /
 * routing engines make. Merges the DETENTION_RULES facts (release / storms / freeboard,
 * single source of truth) with this registry's outlet + geometry criteria, then folds in
 * a per-jurisdiction user override. Returns flat provenance carriers plus a resolved
 * `requiredStorms` array. `overrides` is the shape loadCriteriaOverrides returns (a
 * partial { [jurKey]: { [field]: value } }). Pure. */
export function criteriaFor(jurKey, { onDate = null, overrides = null } = {}) {
  const row = DETENTION_CRITERIA[jurKey] || DETENTION_CRITERIA.generic;
  const rule = row.authorityRuleId ? ruleFor(row.authorityRuleId, onDate) : null;
  const rp = (rule && rule.params) || {};
  const ov = (overrides && overrides[jurKey]) || {};

  // Release rate references the rule record's max release cap when present (FBCDD 0.125).
  const ruleRelease = rp.maxReleaseCfsPerAc != null ? rp.maxReleaseCfsPerAc : (row.criteria.allowableReleaseCfsPerAc?.value ?? null);
  const ruleFreeboard = rp.pondFreeboardFt != null ? rp.pondFreeboardFt : (row.criteria.freeboardFt?.value ?? 1);

  const pick = (field, ruleVal, defCarrier) => {
    if (ov[field] != null) return { value: ov[field], verified: false, source: "user override", overridden: true };
    if (ruleVal != null) return { value: ruleVal, verified: !!(defCarrier && defCarrier.verified), source: fmtSource(row, defCarrier), ref: !!(defCarrier && defCarrier.ref) };
    if (defCarrier) return { value: defCarrier.value, verified: defCarrier.verified, source: fmtSource(row, defCarrier), ref: !!defCarrier.ref };
    return null;
  };

  const cr = row.criteria;
  return {
    jurKey: row.key,
    label: row.label,
    authorityRuleId: row.authorityRuleId,
    governingManual: row.governingManual,
    postLePre: ov.postLePre != null ? !!ov.postLePre : !!row.postLePre,
    secondarySource: !!row.secondarySource,
    requiredStorms: Array.isArray(ov.requiredStorms) && ov.requiredStorms.length ? ov.requiredStorms : requiredStormsFor(jurKey, onDate),
    allowableReleaseCfsPerAc: pick("allowableReleaseCfsPerAc", ruleRelease, cr.allowableReleaseCfsPerAc),
    freeboardFt: pick("freeboardFt", ruleFreeboard, cr.freeboardFt),
    maxSideSlope: pick("maxSideSlope", null, cr.maxSideSlope),
    maintBermFt: pick("maintBermFt", null, cr.maintBermFt),
    orificeC: pick("orificeC", null, cr.orificeC),
    weirC: pick("weirC", null, cr.weirC),
    rationalMethodMaxAcres: pick("rationalMethodMaxAcres", null, cr.rationalMethodMaxAcres),
    drawdownMaxHr: cr.drawdownMaxHr ? pick("drawdownMaxHr", null, cr.drawdownMaxHr) : (ov.drawdownMaxHr != null ? { value: ov.drawdownMaxHr, verified: false, source: "user override", overridden: true } : null),
    gravityDrainFraction: cr.gravityDrainFraction ? pick("gravityDrainFraction", rp.gravityDrainFraction, cr.gravityDrainFraction) : null,
    caveat: SCREENING_CAVEAT,
  };
}

function fmtSource(row, carrier) {
  if (!carrier) return null;
  const man = row.governingManual?.name || row.provider || "";
  const sec = carrier.section ? ` — ${carrier.section}` : "";
  return `${man}${sec}`.trim() || null;
}

// ---------------------------------------------------------------------------
// Overrides — per-jurisdiction user edits, localStorage-backed (the pondCriteriaRules /
// buildabilityRules deep-merge pattern: a whole-object save must never freeze the other
// jurisdictions' cited values, and a future registry correction must still reach a user
// who edited one field). Pure aside from the injected store.
// ---------------------------------------------------------------------------
export function loadCriteriaOverrides(store) {
  try {
    const s = store || (typeof localStorage !== "undefined" ? localStorage : null);
    const v = s ? JSON.parse(s.getItem(LS)) : null;
    if (!v || typeof v !== "object") return {};
    const out = {};
    for (const [k, r] of Object.entries(v)) if (r && typeof r === "object") out[k] = { ...r };
    return out;
  } catch (_) { return {}; }
}
export function saveCriteriaOverrides(overrides, store) {
  try {
    const s = store || (typeof localStorage !== "undefined" ? localStorage : null);
    if (s) s.setItem(LS, JSON.stringify(overrides || {}));
  } catch (_) {}
}

// ---------------------------------------------------------------------------
// Audit (mirrors gis-sources' auditRegistry / tierProblems) — the CI guard the unit
// test runs. Every row must name its authority link (or be `generic`), carry a governing
// manual with a real URL + effectiveDate, a YYYY-MM-DD lastVerified, and every criterion
// value must be finite (or a finite array). An UNVERIFIED value is allowed — it just must
// declare itself (verified:false) so a placeholder can never masquerade as transcribed.
// Pure.
// ---------------------------------------------------------------------------
export function problems(registry = DETENTION_CRITERIA) {
  const out = [];
  const jurKeys = Object.keys(registry);
  for (const [key, row] of Object.entries(registry)) {
    if (row.key !== key) out.push(`${key}: row.key "${row.key}" doesn't match its map key.`);
    if (!row.label) out.push(`${key}: missing label.`);
    if (!row.provider) out.push(`${key}: missing provider.`);
    if (key !== "generic" && !row.authorityRuleId) out.push(`${key}: missing authorityRuleId (link to a DETENTION_RULES record).`);
    if (row.authorityRuleId && !DETENTION_RULES[row.authorityRuleId]) out.push(`${key}: authorityRuleId "${row.authorityRuleId}" is not a DETENTION_RULES key.`);
    if (!row.lastVerified || !/^\d{4}-\d{2}-\d{2}$/.test(row.lastVerified)) out.push(`${key}: lastVerified must be a YYYY-MM-DD date.`);
    const man = row.governingManual;
    if (!man || !man.name) out.push(`${key}: governingManual.name required.`);
    if (key !== "generic") {
      if (!man || !/^https:\/\//.test(man.url || "")) out.push(`${key}: governingManual.url must be an https:// URL.`);
      if (!man || !/^\d{4}-\d{2}-\d{2}$/.test(man.effectiveDate || "")) out.push(`${key}: governingManual.effectiveDate must be YYYY-MM-DD.`);
    }
    const cr = row.criteria || {};
    for (const [field, carrier] of Object.entries(cr)) {
      if (carrier == null) continue; // an explicitly-null criterion (not applicable here) is fine
      if (typeof carrier !== "object" || !("value" in carrier) || !("verified" in carrier)) {
        out.push(`${key}.${field}: must be a { value, verified, section } carrier.`);
        continue;
      }
      const v = carrier.value;
      const ok = Array.isArray(v) ? v.every((n) => Number.isFinite(n)) : Number.isFinite(v);
      if (!ok) out.push(`${key}.${field}: value must be finite (or an array of finite numbers).`);
    }
  }
  return out;
}

/* The jurisdiction keys, ordered as the picker should present them (task priority first). */
export const CRITERIA_JUR_KEYS = ["harris", "fortbend", "waller", "bkdd", "coh", "montgomery", "chambers", "generic"];

/* Map a resolved detention AUTHORITY id (DETENTION_RULES key) back to a criteria
 * jurisdiction key, so the existing jurisdiction detection auto-selects a row. Pure. */
const AUTHORITY_TO_JUR = { hcfcd: "harris", coh: "coh", fortbend: "fortbend", montgomery: "montgomery", chambers: "chambers", waller: "waller", bkdd: "bkdd" };
export function jurKeyForAuthority(authorityId) {
  return AUTHORITY_TO_JUR[authorityId] || (DETENTION_CRITERIA[authorityId] ? authorityId : "generic");
}

/* Short label for a criteria row's authority (badge copy). Pure. */
export function criteriaAuthorityShort(jurKey) {
  const row = DETENTION_CRITERIA[jurKey];
  return (row && (AUTHORITY_SHORT[row.authorityRuleId] || row.label)) || "Unknown";
}
