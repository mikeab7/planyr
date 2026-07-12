/* Buildability pathway (B710) — the ROADMAP "finished-floor-vs-base-flood" item.
 * For an industrial product the floodplain question isn't just volumes: can a
 * slab-on-grade tilt-wall pad be permitted at all, by what pathway, at what FFE?
 *
 * Three screens, all copy-first and provider-fed by B707's WSE inputs:
 *   1. Required FFE — per-jurisdiction rule. Two shapes now (B759):
 *        • SINGLE basis  { basis, plusFt }              (COH & Harris seed).
 *        • MULTI  basis  { bases:[{ basis, plusFt, label }] } — take the MAX
 *          over every computable basis ("more restrictive controls"; Fort Bend
 *          §3.02(b)). Bases whose WSE input isn't supplied yet surface as
 *          `pendingBases` copy — NEVER fabricated (LOUD-FAILURE).
 *      Non-residential DRY-FLOODPROOFING alternatives exist under the NFIP —
 *      noted in copy, never modeled here.
 *   2. Foundation pathway — is fill-to-elevate allowed (with mitigation) or
 *      restricted (LOMR pathway commonly required)?
 *   3. LOMR-F flag — a pad in the 1% floodplain usually needs the fill +
 *      CLOMR-F/LOMR-F pathway to exit the SFHA; copy only, no timeline math.
 * Plus the wetlands cross-flag (floodplain ∩ NWI wetlands → Section 404 note),
 * sourced from the EXISTING wetlands finding — no new fetch.
 *
 * Provenance (B759/B760, closed 2026-07-12): the Fort Bend & Harris subsection
 * lettering below was CONFIRMED against the primary regulation PDFs (Harris
 * fpmregs-effect190709.pdf; FBC-Flood-Damage-Prevention-Regulations_10-08-24_signed.pdf),
 * owner-read 2026-07-12 (PR #594). That read also surfaced the one value fix:
 * Fort Bend's FIRM-BFE FFE basis is +2.0 ft per §5.02(c)(1) of the signed
 * 10-08-2024 regs (the old +1.5 came from the superseded 2023-09 18-in rule).
 *
 * Editable/verified pattern (easementRules.js); keys match floodplainRules.js. */
const LS = "planarfit:buildabilityRules:v1";

export const DEFAULT_BUILDABILITY_RULES = {
  coh: {
    label: "City of Houston",
    ffeRule: { basis: "wse02pct", plusFt: 2 },
    fillToElevate: "allowed_with_mitigation",
    pathwayNote: "COH Ch. 19: fill is permitted with zero-net-fill mitigation; the pad elevates on fill.",
    verified: false,
    source: "COH Code of Ordinances Ch. 19 (eff. 9/1/2018) — FFE at the 0.2% (500-yr) WSE + 2 ft.",
    sourceDate: "2018-09-01",
    note: "Placeholder — VERIFY current Municode text. NFIP non-residential dry-floodproofing alternatives exist; noted, not modeled.",
  },
  harris: {
    label: "Harris County (unincorporated)",
    // §4.07(b)(1): FFE = 24 in above the 0.2% (500-yr) WSE (CONFIRMED, B760).
    ffeRule: { basis: "wse02pct", plusFt: 2 },
    fillToElevate: "restricted",
    pathwayNote:
      "Harris County §4.07(b)(9): “No fill may be used to elevate structures in the 1 percent floodplain” — a slab-on-grade pad is restricted; elevate on open foundations / piers or vented walls, and the LOMR pathway is commonly required to exit the SFHA.",
    verified: true,
    source: "Harris County Regulations for Floodplain Management, eff. 7/9/2019 (Atlas-14 ed.) §4.07(b)(1) / (b)(9).",
    sourceDate: "2019-07-09",
    note:
      "§4.07(b)(1): FFE = 24 in above the 0.2% (500-yr) WSE, OR 12 in above the nearest street crown, whichever is higher (crown alternate is copy, not modeled). Zone specials (copy, not modeled): floodway / Zone V lowest member = 500-yr WSE + 36 in; Zone AO = slab at depth number + 36 in; Zone A = slab at highest-adjacent-grade + 6 ft; critical facilities + 36 in. NFIP non-residential dry-floodproofing alternatives exist; noted, not modeled. Subsection lettering confirmed against the primary fpmregs-effect190709.pdf (owner-read 2026-07-12).",
  },
  // Fort Bend takes the MOST RESTRICTIVE (highest) FFE across six bases per Regs
  // §3.02(b) ("more restrictive controls" = take the MAX) — B759. The 500-yr
  // (wse02pct) basis is provider-fed (manual entry or the FBCDD Atlas-14 DRAFT
  // watershed-study raster) and the FIRM-BFE (wse1pct) basis computes from NFHL;
  // the rest surface as pending copy until their WSE is supplied (B763 / user entry).
  fortbend: {
    label: "Fort Bend County",
    ffeRule: {
      bases: [
        { basis: "atlas14_100yr", plusFt: 2, label: "Atlas-14 100-yr WSE" },
        { basis: "pre_atlas14_100yr", plusFt: 2.5, label: "pre-Atlas-14 100-yr WSE / legacy pond" },
        { basis: "wse02pct", plusFt: 2, label: "pre-Atlas-14 500-yr WSE" },
        // §5.02(c)(1) (signed 10-08-2024): "Two (2) feet above the Base Flood Elevation
        // as determined in the effective FIS and FIRM data". Was +1.5 from the superseded
        // 2023-09 18-in rule — under max-of that understated required FFE by 0.5 ft
        // whenever the FIRM basis governed.
        { basis: "wse1pct", plusFt: 2, label: "FEMA FIRM BFE" },
        { basis: "zone_a_est_bfe", plusFt: 4, label: "Zone A estimated BFE (no data)" },
        { basis: "site", plusFt: 2, label: "outside SFHA: pond 100-yr WSE / top of curb / natural ground" },
      ],
    },
    fillToElevate: "allowed_with_mitigation",
    pathwayNote:
      "Fort Bend County: fill-to-elevate is allowed with mitigation — the pad elevates on fill, but fill that reduces floodplain storage or conveyance needs a 1:1 hydraulically-equivalent offset in the same watershed, full H&H modeling, and a County-Engineer floodplain-development permit ($150 fee). The fill + CLOMR-F/LOMR-F pathway to exit the SFHA is unchanged.",
    verified: true,
    source:
      "FBC Flood Damage Prevention Regs (signed 10-08-2024) §3.02(b), §5.01 & §5.02(c); FBCDD Interim Atlas-14 Criteria §2 (eff. 2020-01-01, rev. 9/2021).",
    sourceDate: "2024-10-08",
    note:
      "FFE = the HIGHEST of six bases (§3.02(b) more-restrictive-controls): Atlas-14 100-yr WSE +2.0 (§5.02(c)(2)); pre-Atlas-14 100-yr WSE / legacy-pond max ponding +2.5; pre-Atlas-14 500-yr WSE +2.0; FEMA FIRM BFE +2.0 (§5.02(c)(1)); Zone-A estimated BFE +4.0; outside-SFHA §5.01 +2.0 over the highest of {detention-pond 100-yr WSE, top of curb, natural ground}. §5.01(c)(3) additionally requires the lowest floor 1.0 ft above any down-gradient roadway or down-gradient drainage restraint (copy, not modeled — needs the roadway profile). The 500-yr (wse02pct) and 1% FIRM (wse1pct) bases compute today; the Atlas-14 / pre-Atlas-14 / Zone-A / site bases surface as pending until their WSE is supplied. NFIP non-residential dry-floodproofing alternatives exist; noted, not modeled. Subsection lettering confirmed against the primary FBC-Flood-Damage-Prevention-Regulations_10-08-24_signed.pdf (owner-read 2026-07-12).",
  },
  montgomery: { label: "Montgomery County", ffeRule: null, fillToElevate: null, pathwayNote: null, verified: false, source: "Not yet transcribed.", sourceDate: null, note: "No FFE rule modeled — VERIFY with the county." },
  chambers: { label: "Chambers County", ffeRule: null, fillToElevate: null, pathwayNote: null, verified: false, source: "Not yet transcribed.", sourceDate: null, note: "No FFE rule modeled — VERIFY with the county." },
  waller: { label: "Waller County", ffeRule: null, fillToElevate: null, pathwayNote: null, verified: false, source: "Not yet transcribed.", sourceDate: null, note: "No FFE rule modeled — VERIFY with the county." },
  generic: { label: "Generic / unknown", ffeRule: null, fillToElevate: null, pathwayNote: null, verified: false, source: "No jurisdiction matched.", sourceDate: null, note: "No FFE rule modeled — VERIFY locally." },
};

const clone = () => JSON.parse(JSON.stringify(DEFAULT_BUILDABILITY_RULES));

export function loadBuildabilityRules(store) {
  try {
    const s = store || (typeof localStorage !== "undefined" ? localStorage : null);
    const v = s ? JSON.parse(s.getItem(LS)) : null;
    if (!v) return clone();
    // PER-JURISDICTION deep merge: a whole-object save must not freeze the OTHER
    // jurisdictions' seeds, and a future seed correction / new field must still
    // reach users who edited one rule (a top-level spread would shadow it forever).
    const out = clone();
    for (const [k, r] of Object.entries(v)) out[k] = { ...(out[k] || {}), ...(r || {}) };
    return out;
  } catch (_) { return clone(); }
}
export function saveBuildabilityRules(rules, store) {
  try {
    const s = store || (typeof localStorage !== "undefined" ? localStorage : null);
    if (s) s.setItem(LS, JSON.stringify(rules));
  } catch (_) {}
}

export const LOMR_NOTE =
  "Pad likely needs the fill + CLOMR-F/LOMR-F pathway to exit the SFHA (FEMA review runs months) — even a compliant elevated pad stays “in the floodplain” for lenders and insurance until the LOMR-F issues.";
export const WETLANDS_404_NOTE =
  "Likely waters of the U.S. — USACE Section 404 (the federal Clean Water Act dredge/fill permit) may govern channel or wetland work.";

/* Basis → which field in the inputs bag supplies its water-surface elevation.
 * This is the ONE B759 basis→input map; panel and print read the same source. */
const BASIS_INPUT = {
  wse1pct: "wse1pctFt",
  wse02pct: "wse02Ft",
  atlas14_100yr: "atlas14Wse100Ft",
  pre_atlas14_100yr: "preAtlas100Ft",
  zone_a_est_bfe: "zoneAEstBfeFt",
  site: "siteBasisFt",
};

/* Human copy for a basis when the rule row carries no label of its own (used by
 * the single-basis unknownReason and as a fallback in the multi-basis listing). */
const BASIS_COPY = {
  wse1pct: "1% water-surface elevation (BFE)",
  wse02pct: "0.2% (500-yr) water-surface elevation",
  atlas14_100yr: "Atlas-14 100-yr WSE",
  pre_atlas14_100yr: "pre-Atlas-14 100-yr WSE / legacy pond",
  zone_a_est_bfe: "Zone A estimated BFE",
  site: "outside-SFHA site basis (pond 100-yr WSE / top of curb / natural ground)",
};

/* Pull a basis's WSE from the bag, honestly: an absent or non-finite value reads
 * as null (never a fabricated 0) so the caller can surface it as pending. */
function inputForBasis(basis, bag) {
  const key = BASIS_INPUT[basis];
  if (!key) return null;
  const v = bag[key];
  return v == null || !isFinite(v) ? null : v;
}

/* Required FFE from the rule + the WSE providers (B707/B759 inputs). Returns
 * { requiredFfeFt, basis, plusFt, governingBasis, pendingBases, unknownReason }.
 * requiredFfeFt is null with a reason when no governing WSE is available.
 *
 * The rule's `ffeRule` may be EITHER:
 *   • { basis, plusFt }                  — single basis (COH & Harris; unchanged).
 *   • { bases:[{ basis, plusFt, label }] } — multi basis: FFE = MAX over every
 *     COMPUTABLE basis (input present). Bases whose input is null surface in
 *     `pendingBases` as copy (never fabricated). If NO basis is computable the
 *     required FFE is null and `unknownReason` lists what's needed. Pure. */
export function requiredFfe(rule, inputs = {}) {
  const bag = {
    wse1pctFt: null, wse02Ft: null, atlas14Wse100Ft: null,
    preAtlas100Ft: null, zoneAEstBfeFt: null, siteBasisFt: null,
    ...inputs,
  };
  if (!rule || !rule.ffeRule) {
    return { requiredFfeFt: null, basis: null, plusFt: null, governingBasis: null, pendingBases: [], unknownReason: "no FFE rule modeled for this jurisdiction — verify locally" };
  }
  const ffeRule = rule.ffeRule;

  // Multi-basis (B759): take the MAX over every computable basis.
  if (Array.isArray(ffeRule.bases)) {
    let best = null; // { basis, plusFt, label, requiredFfeFt }
    const pendingBases = [];
    for (const b of ffeRule.bases) {
      const wse = inputForBasis(b.basis, bag);
      if (wse == null) { pendingBases.push({ basis: b.basis, label: b.label, plusFt: b.plusFt }); continue; }
      const ffe = wse + b.plusFt;
      if (best == null || ffe > best.requiredFfeFt) best = { basis: b.basis, plusFt: b.plusFt, label: b.label, requiredFfeFt: ffe };
    }
    if (best == null) {
      const needed = ffeRule.bases.map((b) => b.label || BASIS_COPY[b.basis] || b.basis).join("; ");
      return { requiredFfeFt: null, basis: null, plusFt: null, governingBasis: null, pendingBases, unknownReason: `no water-surface elevation available for any FFE basis — need one of: ${needed}` };
    }
    return {
      requiredFfeFt: best.requiredFfeFt,
      basis: best.basis,
      plusFt: best.plusFt,
      governingBasis: { basis: best.basis, plusFt: best.plusFt, label: best.label },
      pendingBases,
      unknownReason: null,
    };
  }

  // Single-basis (existing; back-compat).
  const { basis, plusFt } = ffeRule;
  const wse = inputForBasis(basis, bag);
  if (wse == null) {
    return {
      requiredFfeFt: null, basis, plusFt, governingBasis: null, pendingBases: [],
      unknownReason: basis === "wse02pct"
        ? "0.2% (500-yr) water-surface elevation not entered — the FFE rule measures from it"
        : basis === "wse1pct"
          ? "1% water-surface elevation (BFE) unavailable"
          : `${BASIS_COPY[basis] || basis} not available — the FFE rule measures from it`,
    };
  }
  return { requiredFfeFt: wse + plusFt, basis, plusFt, governingBasis: null, pendingBases: [], unknownReason: null };
}

/* The full buildability screen. Inputs are FACTS the caller already holds (no
 * fetches here): the pad FFE (plan or element), the WSE providers, whether any
 * building footprint intersects the 1% floodplain, and whether the site's wetlands
 * finding is PRESENT. Returns readout-ready flags; copy is exported once above so
 * panel/print never drift. Pure. */
export function assessBuildability({
  rule = null,
  padFfeFt = null,
  padIsAuto = false,
  wse1pctFt = null,
  wse02Ft = null,
  atlas14Wse100Ft = null,
  preAtlas100Ft = null,
  zoneAEstBfeFt = null,
  siteBasisFt = null,
  buildingIn1pct = false,
  floodplainPresent = false,
  wetlandsPresent = false,
} = {}) {
  const req = requiredFfe(rule, { wse1pctFt, wse02Ft, atlas14Wse100Ft, preAtlas100Ft, zoneAEstBfeFt, siteBasisFt });
  let ffeStatus;
  let shortByFt = null;
  if (req.requiredFfeFt == null) ffeStatus = rule && rule.ffeRule ? "unknown" : "no_rule";
  else if (padFfeFt == null || !isFinite(padFfeFt)) { ffeStatus = "unknown"; req.unknownReason = "pad / finished-floor elevation not entered"; }
  // NEW-3 — when no pad was entered, the caller defaults it to the AUTO code-minimum FFE
  // (this same requiredFfeFt). That's not a verified pass: it's the rule dictating the floor,
  // so it reads "meets code minimum (assumed)" — distinct from a pad the user actually set.
  else if (padIsAuto) ffeStatus = "assumed";
  else if (padFfeFt >= req.requiredFfeFt - 1e-9) ffeStatus = "pass";
  else { ffeStatus = "short"; shortByFt = req.requiredFfeFt - padFfeFt; }

  const flags = [];
  if (rule && rule.verified === false) flags.push("rule_unverified");

  return {
    ffe: { status: ffeStatus, requiredFfeFt: req.requiredFfeFt, basis: req.basis, plusFt: req.plusFt, governingBasis: req.governingBasis, pendingBases: req.pendingBases, shortByFt, unknownReason: req.unknownReason },
    pathway: rule && rule.fillToElevate ? { fillToElevate: rule.fillToElevate, note: rule.pathwayNote } : null,
    lomr: buildingIn1pct ? { note: LOMR_NOTE } : null,
    wetlands404: floodplainPresent && wetlandsPresent ? { note: WETLANDS_404_NOTE } : null,
    flags,
  };
}
