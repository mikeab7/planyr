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

/* NEW-3 (B1034) — the MARGIN PERCENTAGE FLOOR. Below this requirement a percentage margin is
 * noise, not information (a 0.2 ac-ft mitigation requirement against 29.6 ac-ft provided rendered
 * "+18420%"), so the panel drops the percentage and states the absolute against the requirement.
 * CRITERIA-CONFIGURABLE by design — never an inline constant at a UI call site. A screening
 * readability convention, so ASSUMED: no code publishes one. */
const MARGIN_PCT_FLOOR = () => c(1.0, false, "screening readability floor — below this required volume a percentage margin is meaningless, so the absolute delta is shown instead. No code publishes one.");

/* NEW-4 — the flood-level SENSITIVITY steps: how far above the governing flood water surface the
 * "what if the flood level is higher than we think?" sweep reaches, in feet. This is an
 * UNDERWRITING question, not a design one — in unstudied Zone A the flood level is an estimate
 * standing in for a number FEMA never published, and on a flat site a foot of it can be the whole
 * mitigation obligation. Criteria-configurable (never an inline constant) because a jurisdiction
 * with a published freeboard/uncertainty convention should sweep to ITS number; no code publishes
 * a screening sensitivity range, so all eight seed the same unverified default. */
const WSE_SENSITIVITY = () => c([0, 1, 2, 5], false, "screening sensitivity sweep above the governing flood water surface (ft) — no code publishes an uncertainty range for an estimated Zone A flood level; these steps show how fast the obligation moves, they are not a design allowance.");

/* R1 (dead-storage-vs-tailwater) — the COINCIDENT-STORM design policy. Does the jurisdiction
 * require the pond's design storm to be assumed COINCIDENT with the receiving flood (so the
 * 100-yr flood WSE permanently floors the usable detention band — usable is only the storage
 * ABOVE the flood), or does the pond RECOVER to normal (dry-weather) tailwater between storms
 * (the whole recovered water column is usable detention; the flood is only a routing / outfall
 * condition)? Stored as a numeric flag so it passes the finite-value audit: 0 = non-coincident,
 * 1 = coincident. ASSUMED non-coincident (0, verified:false) until the governing code text lands
 * — the honest default (a pond does recover between storms unless the code says otherwise) — and
 * the assumption is stated in the verdict line whenever it drives a number. */
const COINCIDENT_ASSUMED = (target) =>
  c(0, false, `coincident-storm design policy (${target}). ASSUMED non-coincident: the pond recovers to normal (dry-weather) tailwater between storms, so the whole recovered column is usable detention and the 100-yr flood WSE is only a routing / outfall condition. Stated in the verdict; swap to VERIFIED when the code text lands.`);

/* NEW-27 (owner directive 2026-07-24) — the PUMPED-SHARE design policy: the fraction of the
 * allowable release a jurisdiction lets a PUMP provide (the rest must leave by gravity). The
 * owner should NEVER be asked to type a pump discharge he doesn't know — the allowed pump rate is
 * DERIVED as this share × the allowable release (see pumpAllowance()). Pumped detention is an
 * EXCEPTION most reviewers allow only with engineer-confirmed reliability + backup power, so the
 * derived rate is a screening CEILING, not an approval. ASSUMED (verified:false) until the
 * governing code text lands; stated wherever it drives a number. (TxDOT-outfall cases — a pump
 * discharging to a TxDOT facility — additionally invoke the TxDOT Houston District Pumped Discharge
 * Criteria (July 2025), a named search target not yet encoded as its own row.) */
const PUMPED_SHARE_ASSUMED = (pct, target) =>
  c(pct, false, `pumped share of the allowable release — ASSUMED ${pct}% (${target}). Pumped detention is a reviewer exception; the derived rate is a screening ceiling, not an approval — the engineer confirms reliability + backup power. Swap to VERIFIED when the code text lands.`);

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
      name: "Waller County Subdivision & Development Regulations (rev. 2023-12-06), Appendix E — Drainage Criteria Manual, Sec 5 (Detention Facilities)",
      section: "Appendix E DCM Sec 5 — Detention Facilities (INDUSTRIAL; the rural 5-ac-lot ditch-drained exemption per the 2023 Item 15 memo does NOT apply)",
      url: "https://www.co.waller.tx.us/upload/page/0263/Subdivision%20-%20Development%20Regulations%20REVISED_FINAL-12-06-2023.pdf",
      effectiveDate: "2023-12-06",
    },
    postLePre: true, // Small-Watershed / HEC-HMS hydrograph governs above the coefficient method
    lastVerified: "2026-07-24",
    criteria: {
      // Release / storms / freeboard reference the rule record where present, else a screening default.
      // Citation TARGET named (cowork 2026-07-24): the quantitative detention criteria live in Appendix E
      // DCM Sec 5; full text not machine-reachable (co.waller.tx.us 403), so these stay ASSUMED (verify:false).
      freeboardFt: c(1, false, "Appendix E DCM Sec 5 (Detention Facilities) — value pending confirmation; verify with the County Engineer"),
      maxSideSlope: c(3, false, "3:1 interior — Appendix E DCM Sec 5 pending; commonly cited, verify"),
      maintBermFt: c(30, false, "maintenance shelf — screening convention; verify"),
      orificeC: c(STD_ORIFICE_C, true, "sharp-edged orifice (standard hydraulics)"),
      weirC: c(STD_WEIR_C, true, "rectangular weir (standard hydraulics)"),
      drawdownMaxHr: null,
      gravityDrainFraction: null,
      requiredStorms: c([10, 100], false, "100-yr governs; 10-yr screening pair — verify"),
      rationalMethodMaxAcres: c(200, false, "NRCS/TxDOT screening rule of thumb — Rational method ceiling; verify vs the governing manual"),
      tcFloorMin: c(10, false, "screening Tc floor — many manuals use 5–10 min"),
      tcDefaultSlopePct: c(1.0, false, "flat-industrial-site screening default — grade not resolved from DEM"),
      tcUrbanAdjustment: c(0.4, false, "Kirpich paved-channel adjustment at full imperviousness — commonly cited"),
      tcFlowPathKFactor: c(1.5, false, "L≈k·√area screening factor — no traced flow path"),
      screeningPondDepthFt: c(8, false, "typical screening pond depth — estimates land take from a volume shortfall only, never sizes a pond"),
      // NEW-2 — the OVER-PROVISION slack: how far past the required volume is normal
      // freeboard-and-rounding headroom rather than dirt that buys nothing. CRITERIA-
      // CONFIGURABLE by design (never an inline constant at a UI call site); the defaults
      // match the shipped site-level mitigation rule, required + max(1 ac-ft, 10%). No code
      // publishes an over-provision tolerance — this is a screening convention, so ASSUMED.
      overdugSlackAcFt: c(1.0, false, "screening over-provision tolerance (absolute) — no code publishes one; matches the shipped mitigation ledger's required + max(1 ac-ft, 10%) rule"),
      overdugSlackPct: c(10, false, "screening over-provision tolerance (percent of required) — no code publishes one; matches the shipped mitigation ledger's required + max(1 ac-ft, 10%) rule"),
      marginPctFloorAcFt: MARGIN_PCT_FLOOR(),
      wseSensitivityStepsFt: WSE_SENSITIVITY(),
      coincidentStorm: COINCIDENT_ASSUMED("Waller Appendix E DCM Sec 5 + BKDD Rules & Regulations 22-01 pending"),
      pumpedShareOfReleasePct: PUMPED_SHARE_ASSUMED(50, "code silent on pumped detention; regional Houston-MSA screening practice ~50%. Named search targets: Waller Appendix E DCM Sec 5 + BKDD Rules & Regulations 22-01"),
    },
    note: "Waller publishes volumetric rates (0.55 ac-ft/ac floor .. 0.65 coefficient); the RATE proof (Post ≤ Pre) is hydrograph-derived above small sites — verify with the county engineer.",
  },

  bkdd: {
    key: "bkdd",
    label: "Brookshire–Katy Drainage District",
    authorityRuleId: "bkdd",
    provider: "Brookshire–Katy Drainage District",
    governingManual: {
      name: "BKDD Rules & Regulations 22-01 (adopted 2022-02-22, board-signed 2022-02-28) + Order Amending 2023-03-27 (procedural only) + Master Drainage Plan (2023-06-20)",
      section: "Rules 22-01 FULL TEXT READ (owner-supplied signed PDFs, 2026-07-24): detention volume §5.C, geometry §5.B, pumped §5.B.7, outfall/tailwater §5.D, storms §3, floodplain §1.B/§Art-VI-1.B. The 3-27-23 amendment is PROCEDURAL ONLY (permit-application expiration) — zero technical changes, so 22-01 is the technical authority.",
      url: "https://www.bkdd.dst.tx.us/page/BKDD.RulesRegulations",
      effectiveDate: "2022-02-28",
    },
    postLePre: true, // the defining criterion — RATE control (zero net increase, §5.D.1)
    secondarySource: false, // VERIFIED against the primary signed document (owner-read full text 2026-07-24)
    lastVerified: "2026-07-24",
    criteria: {
      // VERIFIED against BKDD Rules & Regulations 22-01 full text (owner-supplied signed PDF, read 2026-07-24).
      freeboardFt: c(1, true, "BKDD Rules 22-01 §5.B.4.f (dry) / §5.B.5.e (wet) — twelve inches (12\") above the maximum WSE"),
      maxSideSlope: c(3, true, "BKDD Rules 22-01 §5.B.2 / §5.B.5.b — 3:1 minimum interior side slope (steeper needs structural walls + fencing + sealed geotech, §5.B.6)"),
      // §5.B.2 Table C (single property owner) is DEPTH+SLOPE dependent (bkddMaintBermWidthFt); the flat
      // screening value here is the single-owner deep-basin maximum (20 ft, >9 ft deep). Public/multi-owner
      // basins run 15–30 ft (Table D). Reconciling the CONSUMER (optimizer land-take) to the depth table is B999.
      maintBermFt: c(20, true, "BKDD Rules 22-01 §5.B.2 Table C (single-owner) — 20 ft for basins >9 ft deep (or >6 ft at 3:1); 10–15 ft shallower. Public/multi-owner up to 30 ft (Table D §5.B.3). Concrete paved parking/drives may share the single-owner berm (§5.B.2 note)."),
      orificeC: c(0.8, true, "BKDD Rules 22-01 §5.D.2 — outlet orifice discharge coeff C = 0.8, ≥6 in diameter (restrictor pipe ≥6 in, §5.D.3)"),
      weirC: c(STD_WEIR_C, true, "rectangular weir (standard hydraulics); BKDD §5.D.4 uses a Cipoletti weir Q=3.367·B·H^1.5 for >100-yr emergency overflow"),
      drawdownMaxHr: null,
      gravityDrainFraction: null,
      // §3.B — improvements designed for the 2/10/100-yr storms (NOAA Atlas 14 mandatory, §1.A).
      requiredStorms: c([2, 10, 100], true, "BKDD Rules 22-01 §3.B — designed for the 2/10/100-yr storms; NOAA Atlas 14 mandatory (§1.A)", { ref: true }),
      rationalMethodMaxAcres: c(200, true, "BKDD Rules 22-01 §5.C.2 — Small-Watershed/Malcom's method ≤200 ac; HEC-HMS + Atlas 14 required >200 ac (§5.C.3); Rational method <200 ac (Table A)"),
      tcFloorMin: c(10, true, "BKDD Rules 22-01 Table B — Tc = L/(V·60)+10, or 10·A^0.1761+15 for sewered areas; basin Tc = 0 (§5.B.1)"),
      tcDefaultSlopePct: c(1.0, false, "flat-industrial-site screening default — grade not resolved from DEM"),
      tcUrbanAdjustment: c(0.4, false, "Kirpich paved-channel adjustment at full imperviousness — commonly cited"),
      tcFlowPathKFactor: c(1.5, false, "L≈k·√area screening factor — no traced flow path"),
      screeningPondDepthFt: c(8, false, "typical screening pond depth — estimates land take from a volume shortfall only, never sizes a pond"),
      // NEW-2 — the OVER-PROVISION slack: how far past the required volume is normal
      // freeboard-and-rounding headroom rather than dirt that buys nothing. CRITERIA-
      // CONFIGURABLE by design (never an inline constant at a UI call site); the defaults
      // match the shipped site-level mitigation rule, required + max(1 ac-ft, 10%). No code
      // publishes an over-provision tolerance — this is a screening convention, so ASSUMED.
      overdugSlackAcFt: c(1.0, false, "screening over-provision tolerance (absolute) — no code publishes one; matches the shipped mitigation ledger's required + max(1 ac-ft, 10%) rule"),
      overdugSlackPct: c(10, false, "screening over-provision tolerance (percent of required) — no code publishes one; matches the shipped mitigation ledger's required + max(1 ac-ft, 10%) rule"),
      marginPctFloorAcFt: MARGIN_PCT_FLOOR(),
      wseSensitivityStepsFt: WSE_SENSITIVITY(),
      // §5.D.2/§5.D.3 — outfall design head H = 100-yr facility WSE MINUS the 25-YR receiving-ditch WSE
      // (or the orifice centroid for a roadside ditch / storm sewer). So the basin is NOT designed
      // coincident with the 100-yr receiving flood — the receiving tailwater is the 25-yr level.
      coincidentStorm: c(0, true, "BKDD Rules 22-01 §5.D.2/§5.D.3 — outfall design head = 100-yr facility WSE minus the 25-YR receiving-ditch WSE; the basin is NOT designed coincident with the 100-yr receiving flood (25-yr receiving tailwater). VERIFIED non-coincident."),
      // §5.B.7.g — no more than 50% of basin capacity may be pumped (75% to a TxDOT ditch with TxDOT approval).
      pumpedShareOfReleasePct: c(50, true, "BKDD Rules 22-01 §5.B.7.g — no more than 50% of basin capacity may be pumped; gravity outflow required for the volume above pumped storage. EXCEPTION: discharge to a TxDOT ditch with TxDOT approval up to 75% (Tsakiris fronts I-10/TxDOT). Lead+lag pumps; lead ≤50% of max allowable, combined ≤ allowable (§5.B.7.a)."),
      // NEW (owner full-text payload 2026-07-24) — VERIFIED rows the registry didn't carry:
      minDetentionRateAcFtPerAc: c(0.65, true, "BKDD Rules 22-01 §5.C.2/§5.C.3 — in no case shall the detention storage rate be less than 0.65 ac-ft per acre (hard floor, all methods). Coefficient Method (Storage = 0.65 × modified-cover ac) only for <5 ac commercial / <10 ac residential, and NOT allowed with pumped detention (§5.B.7.j)"),
      emergencySpillwayRequired: c(1, true, "BKDD Rules 22-01 §5.B.4.e (dry) / §5.B.5.d (wet) / §5.B.7.d (pumped) — every basin shall have an emergency spillway designed to pass the 100-yr release rate within the freeboard"),
      sedimentWqRequired: c(0, true, "NOT required — BKDD Rules 22-01 has no sediment / water-quality-volume provision (full text code-searched 2026-07-24). County / TCEQ remain separate questions"),
    },
    note: "RATE-control district (zero net increase, §5.D.1), VERIFIED against Rules 22-01 full text (owner-read 2026-07-24). Detention proven by hydrograph routing (Post ≤ Pre at 2/10/100-yr, offsite included) with a 0.65 ac-ft/ac hard floor (§5.C); the routing here is a SCREENING proxy, the district engineer's HEC-HMS governs. Floodplain fill (100-yr AND 500-yr) needs compensating storage per Waller County (Art VI §1.B). Deeper model reconciliations (25-yr outfall head, 500-yr mitigation banding, Table-C berm consumer, spillway warning, full §5.B.7 pump formulas) are backlogged B999–B1004 with the code text.",
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
      tcFloorMin: c(10, false, "screening Tc floor — many manuals use 5–10 min"),
      tcDefaultSlopePct: c(1.0, false, "flat-industrial-site screening default — grade not resolved from DEM"),
      tcUrbanAdjustment: c(0.4, false, "Kirpich paved-channel adjustment at full imperviousness — commonly cited"),
      tcFlowPathKFactor: c(1.5, false, "L≈k·√area screening factor — no traced flow path"),
      screeningPondDepthFt: c(8, false, "typical screening pond depth — estimates land take from a volume shortfall only, never sizes a pond"),
      // NEW-2 — the OVER-PROVISION slack: how far past the required volume is normal
      // freeboard-and-rounding headroom rather than dirt that buys nothing. CRITERIA-
      // CONFIGURABLE by design (never an inline constant at a UI call site); the defaults
      // match the shipped site-level mitigation rule, required + max(1 ac-ft, 10%). No code
      // publishes an over-provision tolerance — this is a screening convention, so ASSUMED.
      overdugSlackAcFt: c(1.0, false, "screening over-provision tolerance (absolute) — no code publishes one; matches the shipped mitigation ledger's required + max(1 ac-ft, 10%) rule"),
      overdugSlackPct: c(10, false, "screening over-provision tolerance (percent of required) — no code publishes one; matches the shipped mitigation ledger's required + max(1 ac-ft, 10%) rule"),
      marginPctFloorAcFt: MARGIN_PCT_FLOOR(),
      wseSensitivityStepsFt: WSE_SENSITIVITY(),
      maxSideSlope: c(3, false, "3:1 interior — commonly cited; verify vs the DCM"),
      maintBermFt: c(30, false, "maintenance shelf — screening convention; verify"),
      orificeC: c(STD_ORIFICE_C, true, "sharp-edged orifice (standard hydraulics)"),
      weirC: c(STD_WEIR_C, true, "rectangular weir (standard hydraulics)"),
      drawdownMaxHr: null,
      coincidentStorm: COINCIDENT_ASSUMED("FBCDD DCM Ch. 6 coincident-storm / tailwater provision pending"),
      pumpedShareOfReleasePct: PUMPED_SHARE_ASSUMED(50, "bounded by FBCDD Interim §5's ≥50% gravity-drain rule (VERIFIED), so the pumped share is at most 50% of the release; the ceiling itself is ASSUMED. FBCDD DCM Ch. 6 / Interim §5"),
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
      tcFloorMin: c(10, false, "screening Tc floor — many manuals use 5–10 min"),
      tcDefaultSlopePct: c(1.0, false, "flat-industrial-site screening default — grade not resolved from DEM"),
      tcUrbanAdjustment: c(0.4, false, "Kirpich paved-channel adjustment at full imperviousness — commonly cited"),
      tcFlowPathKFactor: c(1.5, false, "L≈k·√area screening factor — no traced flow path"),
      screeningPondDepthFt: c(8, false, "typical screening pond depth — estimates land take from a volume shortfall only, never sizes a pond"),
      // NEW-2 — the OVER-PROVISION slack: how far past the required volume is normal
      // freeboard-and-rounding headroom rather than dirt that buys nothing. CRITERIA-
      // CONFIGURABLE by design (never an inline constant at a UI call site); the defaults
      // match the shipped site-level mitigation rule, required + max(1 ac-ft, 10%). No code
      // publishes an over-provision tolerance — this is a screening convention, so ASSUMED.
      overdugSlackAcFt: c(1.0, false, "screening over-provision tolerance (absolute) — no code publishes one; matches the shipped mitigation ledger's required + max(1 ac-ft, 10%) rule"),
      overdugSlackPct: c(10, false, "screening over-provision tolerance (percent of required) — no code publishes one; matches the shipped mitigation ledger's required + max(1 ac-ft, 10%) rule"),
      marginPctFloorAcFt: MARGIN_PCT_FLOOR(),
      wseSensitivityStepsFt: WSE_SENSITIVITY(),
      coincidentStorm: COINCIDENT_ASSUMED("HCFCD PCPM / HCED coincident-storm provision pending"),
      pumpedShareOfReleasePct: PUMPED_SHARE_ASSUMED(50, "owner recollection: HCFCD allows ~50% of detention outflow to be pumped. Named search targets: HCFCD Policy, Criteria & Procedure Manual + 2016 Supplemental Guidelines (pumped-detention allowance)"),
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
      tcFloorMin: c(10, false, "screening Tc floor — many manuals use 5–10 min"),
      tcDefaultSlopePct: c(1.0, false, "flat-industrial-site screening default — grade not resolved from DEM"),
      tcUrbanAdjustment: c(0.4, false, "Kirpich paved-channel adjustment at full imperviousness — commonly cited"),
      tcFlowPathKFactor: c(1.5, false, "L≈k·√area screening factor — no traced flow path"),
      screeningPondDepthFt: c(8, false, "typical screening pond depth — estimates land take from a volume shortfall only, never sizes a pond"),
      // NEW-2 — the OVER-PROVISION slack: how far past the required volume is normal
      // freeboard-and-rounding headroom rather than dirt that buys nothing. CRITERIA-
      // CONFIGURABLE by design (never an inline constant at a UI call site); the defaults
      // match the shipped site-level mitigation rule, required + max(1 ac-ft, 10%). No code
      // publishes an over-provision tolerance — this is a screening convention, so ASSUMED.
      overdugSlackAcFt: c(1.0, false, "screening over-provision tolerance (absolute) — no code publishes one; matches the shipped mitigation ledger's required + max(1 ac-ft, 10%) rule"),
      overdugSlackPct: c(10, false, "screening over-provision tolerance (percent of required) — no code publishes one; matches the shipped mitigation ledger's required + max(1 ac-ft, 10%) rule"),
      marginPctFloorAcFt: MARGIN_PCT_FLOOR(),
      wseSensitivityStepsFt: WSE_SENSITIVITY(),
      coincidentStorm: COINCIDENT_ASSUMED("City of Houston IDM Ch. 9 coincident-storm provision pending"),
      pumpedShareOfReleasePct: PUMPED_SHARE_ASSUMED(25, "City of Houston IDM Ch. 9 restricts pumped detention more tightly; conservative screening ceiling ASSUMED. Named search target: City of Houston Infrastructure Design Manual Ch. 9 (Stormwater Detention) pumped-detention provisions"),
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
      tcFloorMin: c(10, false, "screening Tc floor — many manuals use 5–10 min"),
      tcDefaultSlopePct: c(1.0, false, "flat-industrial-site screening default — grade not resolved from DEM"),
      tcUrbanAdjustment: c(0.4, false, "Kirpich paved-channel adjustment at full imperviousness — commonly cited"),
      tcFlowPathKFactor: c(1.5, false, "L≈k·√area screening factor — no traced flow path"),
      screeningPondDepthFt: c(8, false, "typical screening pond depth — estimates land take from a volume shortfall only, never sizes a pond"),
      // NEW-2 — the OVER-PROVISION slack: how far past the required volume is normal
      // freeboard-and-rounding headroom rather than dirt that buys nothing. CRITERIA-
      // CONFIGURABLE by design (never an inline constant at a UI call site); the defaults
      // match the shipped site-level mitigation rule, required + max(1 ac-ft, 10%). No code
      // publishes an over-provision tolerance — this is a screening convention, so ASSUMED.
      overdugSlackAcFt: c(1.0, false, "screening over-provision tolerance (absolute) — no code publishes one; matches the shipped mitigation ledger's required + max(1 ac-ft, 10%) rule"),
      overdugSlackPct: c(10, false, "screening over-provision tolerance (percent of required) — no code publishes one; matches the shipped mitigation ledger's required + max(1 ac-ft, 10%) rule"),
      marginPctFloorAcFt: MARGIN_PCT_FLOOR(),
      wseSensitivityStepsFt: WSE_SENSITIVITY(),
      coincidentStorm: COINCIDENT_ASSUMED("Montgomery County DCM §6.3 coincident-storm provision pending"),
      pumpedShareOfReleasePct: PUMPED_SHARE_ASSUMED(50, "code silent on pumped detention; regional Houston-MSA screening practice ~50%. Named search target: Montgomery County Drainage Criteria Manual"),
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
      tcFloorMin: c(10, false, "screening Tc floor — many manuals use 5–10 min"),
      tcDefaultSlopePct: c(1.0, false, "flat-industrial-site screening default — grade not resolved from DEM"),
      tcUrbanAdjustment: c(0.4, false, "Kirpich paved-channel adjustment at full imperviousness — commonly cited"),
      tcFlowPathKFactor: c(1.5, false, "L≈k·√area screening factor — no traced flow path"),
      screeningPondDepthFt: c(8, false, "typical screening pond depth — estimates land take from a volume shortfall only, never sizes a pond"),
      // NEW-2 — the OVER-PROVISION slack: how far past the required volume is normal
      // freeboard-and-rounding headroom rather than dirt that buys nothing. CRITERIA-
      // CONFIGURABLE by design (never an inline constant at a UI call site); the defaults
      // match the shipped site-level mitigation rule, required + max(1 ac-ft, 10%). No code
      // publishes an over-provision tolerance — this is a screening convention, so ASSUMED.
      overdugSlackAcFt: c(1.0, false, "screening over-provision tolerance (absolute) — no code publishes one; matches the shipped mitigation ledger's required + max(1 ac-ft, 10%) rule"),
      overdugSlackPct: c(10, false, "screening over-provision tolerance (percent of required) — no code publishes one; matches the shipped mitigation ledger's required + max(1 ac-ft, 10%) rule"),
      marginPctFloorAcFt: MARGIN_PCT_FLOOR(),
      wseSensitivityStepsFt: WSE_SENSITIVITY(),
      coincidentStorm: COINCIDENT_ASSUMED("Chambers County DCM coincident-storm provision pending"),
      pumpedShareOfReleasePct: PUMPED_SHARE_ASSUMED(50, "code silent on pumped detention; regional Houston-MSA screening practice ~50%. Named search target: Chambers County Drainage Criteria Manual"),
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
      tcFloorMin: c(10, false, "screening Tc floor — many manuals use 5–10 min"),
      tcDefaultSlopePct: c(1.0, false, "flat-industrial-site screening default — grade not resolved from DEM"),
      tcUrbanAdjustment: c(0.4, false, "Kirpich paved-channel adjustment at full imperviousness — commonly cited"),
      tcFlowPathKFactor: c(1.5, false, "L≈k·√area screening factor — no traced flow path"),
      screeningPondDepthFt: c(8, false, "typical screening pond depth — estimates land take from a volume shortfall only, never sizes a pond"),
      // NEW-2 — the OVER-PROVISION slack: how far past the required volume is normal
      // freeboard-and-rounding headroom rather than dirt that buys nothing. CRITERIA-
      // CONFIGURABLE by design (never an inline constant at a UI call site); the defaults
      // match the shipped site-level mitigation rule, required + max(1 ac-ft, 10%). No code
      // publishes an over-provision tolerance — this is a screening convention, so ASSUMED.
      overdugSlackAcFt: c(1.0, false, "screening over-provision tolerance (absolute) — no code publishes one; matches the shipped mitigation ledger's required + max(1 ac-ft, 10%) rule"),
      overdugSlackPct: c(10, false, "screening over-provision tolerance (percent of required) — no code publishes one; matches the shipped mitigation ledger's required + max(1 ac-ft, 10%) rule"),
      marginPctFloorAcFt: MARGIN_PCT_FLOOR(),
      wseSensitivityStepsFt: WSE_SENSITIVITY(),
      coincidentStorm: COINCIDENT_ASSUMED("no jurisdiction matched — confirm the reviewing authority's coincident-storm provision"),
      pumpedShareOfReleasePct: PUMPED_SHARE_ASSUMED(50, "no jurisdiction matched; regional Houston-MSA screening practice ~50%. Confirm the reviewing authority's pumped-detention policy"),
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
  // ⛔ B877440 — captured BEFORE the generic fallback, so it distinguishes "the caller had no
  // resolved jurisdiction at all" (auto-detect found nothing, no manual override) from "the user
  // explicitly picked Generic / unknown from the selector" (jurKey === "generic" is a real key
  // lookup below, not this fallback). Additive field only — every existing numeric field below is
  // unchanged for every caller, modeled or not.
  const noCriteriaOnFile = jurKey == null;
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
    noCriteriaOnFile,
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
    tcFloorMin: pick("tcFloorMin", null, cr.tcFloorMin),
    tcDefaultSlopePct: pick("tcDefaultSlopePct", null, cr.tcDefaultSlopePct),
    tcUrbanAdjustment: pick("tcUrbanAdjustment", null, cr.tcUrbanAdjustment),
    tcFlowPathKFactor: pick("tcFlowPathKFactor", null, cr.tcFlowPathKFactor),
    screeningPondDepthFt: pick("screeningPondDepthFt", null, cr.screeningPondDepthFt),
    overdugSlackAcFt: pick("overdugSlackAcFt", null, cr.overdugSlackAcFt),
    overdugSlackPct: pick("overdugSlackPct", null, cr.overdugSlackPct),
    marginPctFloorAcFt: pick("marginPctFloorAcFt", null, cr.marginPctFloorAcFt),
    wseSensitivityStepsFt: pick("wseSensitivityStepsFt", null, cr.wseSensitivityStepsFt),
    coincidentStorm: pick("coincidentStorm", null, cr.coincidentStorm),
    pumpedShareOfReleasePct: pick("pumpedShareOfReleasePct", null, cr.pumpedShareOfReleasePct),
    minDetentionRateAcFtPerAc: pick("minDetentionRateAcFtPerAc", null, cr.minDetentionRateAcFtPerAc),
    emergencySpillwayRequired: pick("emergencySpillwayRequired", null, cr.emergencySpillwayRequired),
    sedimentWqRequired: pick("sedimentWqRequired", null, cr.sedimentWqRequired),
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
/* ⛔ B877440 — `null` for an authority with no criteria row, never the silent "generic" fallback.
 * In practice `authorityId` here is only ever set once a real DETENTION_RULES authority has
 * already resolved (see detentionRules.resolveDrainageAuthority), so this branch is a safety net,
 * not the main path — but it must not manufacture a fake jurisdiction key either. */
export function jurKeyForAuthority(authorityId) {
  return AUTHORITY_TO_JUR[authorityId] || (DETENTION_CRITERIA[authorityId] ? authorityId : null);
}

/* Short label for a criteria row's authority (badge copy). Pure. */
export function criteriaAuthorityShort(jurKey) {
  const row = DETENTION_CRITERIA[jurKey];
  return (row && (AUTHORITY_SHORT[row.authorityRuleId] || row.label)) || "Unknown";
}

/* R1 — resolve a criteriaFor() result's coincident-storm carrier into a plain
 * { coincident, verified, source } the pond split + verdict line read. The stored flag is
 * numeric (0 = non-coincident, the honest default; >0 = coincident), interpreted here as a
 * boolean. `verified:false` means the policy is ASSUMED and the verdict must say so. Pure. */
export function coincidentStormPolicy(criteria) {
  const car = criteria && criteria.coincidentStorm;
  return {
    coincident: !!(car && Number(car.value) > 0),
    verified: !!(car && car.verified),
    source: (car && car.source) || null,
  };
}

/* NEW-27 — DERIVE the allowed pump discharge from the criteria (never ask the user for a CFS he
 * doesn't know). `allowedPumpCfs` = pumpedShareOfReleasePct% × the pond's allowable release
 * (`releaseRateCfs`). A finite `overrideCfs` (an optional advanced user entry) wins and is flagged
 * `overridden`. `verified:false` means the share is ASSUMED and the caller must say so. Returns
 * { sharePct, derivedCfs, overrideCfs, allowedPumpCfs, overridden, verified, source, label }.
 * `sharePct` is null when the jurisdiction carries no pumped-share row (no derivation possible).
 * Pure. */
export function pumpAllowance(criteria, { releaseRateCfs = null, overrideCfs = null } = {}) {
  const car = criteria && criteria.pumpedShareOfReleasePct;
  const sharePct = car && Number.isFinite(car.value) ? car.value : null;
  const rel = Number.isFinite(releaseRateCfs) ? releaseRateCfs : null;
  const derivedCfs = sharePct != null && rel != null ? Math.round((sharePct / 100) * rel * 100) / 100 : null;
  const override = Number.isFinite(overrideCfs) && overrideCfs >= 0 ? overrideCfs : null;
  return {
    sharePct,
    derivedCfs,
    overrideCfs: override,
    allowedPumpCfs: override != null ? override : derivedCfs,
    overridden: override != null,
    verified: !!(car && car.verified),
    source: (car && car.source) || null,
    label: (criteria && criteria.label) || null,
  };
}

/* BKDD Rules 22-01 §5.B.2 Table C (single property owner) / §5.B.3 Table D (public / multi-owner) —
 * the maintenance-berm width is DEPTH + SIDE-SLOPE dependent, not a flat number. Pure lookup, used by
 * the pond land-take math (B999 wires the consumer). Returns the berm width in feet.
 *   Single-owner (Table C):  <3.0 ft → 10 ; 3.1–6.0 → 15 ; 6.1–9.0 → (3:1) 20 / (4:1) 15 ; >9.0 → 20
 *   Public/multi (Table D):  15 base, up to 30 for a deep (>9 ft) 3:1 basin
 * `sideSlope` is the run in an N:1 slope (3 or 4). Pure. */
export function bkddMaintBermWidthFt(depthFt, sideSlope = 3, { multiOwner = false } = {}) {
  const d = Number.isFinite(depthFt) ? depthFt : 0;
  const flatter = Number.isFinite(sideSlope) && sideSlope >= 4; // 4:1 or flatter
  if (multiOwner) {
    // Table D — public / multi-owner basins: 15 ft base, 30 ft for a deep 3:1 basin.
    if (d > 9.0 && !flatter) return 30;
    return d > 6.0 ? 20 : 15;
  }
  // Table C — single property owner.
  if (d <= 3.0) return 10;
  if (d <= 6.0) return 15;
  if (d <= 9.0) return flatter ? 15 : 20; // 6.1–9.0: 3:1 → 20, 4:1 → 15
  return 20; // >9.0 ft → 20 (either slope)
}
