/* Buildability pathway (B710) — the ROADMAP "finished-floor-vs-base-flood" item.
 * For an industrial product the floodplain question isn't just volumes: can a
 * slab-on-grade tilt-wall pad be permitted at all, by what pathway, at what FFE?
 *
 * Three screens, all copy-first and provider-fed by B707's WSE inputs:
 *   1. Required FFE — per-jurisdiction rule. Two shapes now (B759):
 *        • SINGLE basis  { basis, plusFt }              (COH & Harris seed).
 *        • MULTI  basis  { bases:[{ basis, plusFt, label, when? }] } — take the MAX
 *          over every computable basis ("more restrictive controls"; Fort Bend
 *          §3.02(b)). Bases whose WSE input isn't supplied yet surface as
 *          `pendingBases` copy — NEVER fabricated (LOUD-FAILURE).
 *          NEW-1 (Waller): a base may carry `when` — a location condition evaluated
 *          against caller-supplied ctx flags (in1pct / in02pct / zoneANoBfe):
 *            "in_1pct"       — applies unless ctx says the building is NOT in the 1%
 *                              floodplain (unknown ⇒ applies: max-of stays conservative).
 *            "in_02pct_only" — applies unless ctx says the building IS in the 1%
 *                              (there the stricter in_1pct row governs anyway).
 *            "zone_a_no_bfe" — applies ONLY when ctx.zoneANoBfe === true (this basis
 *                              MANUFACTURES a requirement from grade — never assumed).
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
  // Waller (NEW-1): Art. 5 §B(2) nonresidential — lowest floor ≥ 500-yr WSE + 2 ft when
  // the structure is in the 1% floodplain; ≥ 500-yr WSE + 1 ft when in the 500-yr band
  // only. §D(5): an A Zone with no depth number → slab ≥ highest adjacent grade + 4 ft
  // (the section lives under the AO/AH standards but is written as the A-Zone catch-all —
  // placement transcribed as found). Max-of across the applicable bases.
  waller: {
    label: "Waller County (unincorporated)",
    ffeRule: {
      bases: [
        { basis: "wse02pct", plusFt: 2, label: "500-yr WSE (structure in the 1% floodplain)", when: "in_1pct" },
        { basis: "wse02pct", plusFt: 1, label: "500-yr WSE (500-yr band only)", when: "in_02pct_only" },
        { basis: "hag", plusFt: 4, label: "highest adjacent grade (Zone A, no depth number)", when: "zone_a_no_bfe" },
      ],
    },
    fillToElevate: "prohibited",
    pathwayNote:
      "Waller County Art. 5 §A(9): NO structural fill in the SFHA or the 500-yr band — open foundations (pier and beam) only. Slab-on-grade in the mapped 100-yr or 500-yr floodplain is a non-starter in unincorporated Waller — keep structures out of both bands (no fill-to-elevate / LOMR-F pathway).",
    verified: true,
    source:
      "Waller County Subdivision & Development Regulations (REVISED FINAL 12-06-2023), Appendix B Item 8 (p. B-10): structures in the 100-yr floodplain elevated ≥ 2.0 ft ABOVE THE 500-YEAR flood elevation; structures in the 500-yr zone ≥ 1.0 ft above the 500-yr elevation. Corroborated by §3.6.5 (pp. 10–11): minimum first-floor elevations must be identified for structures within the 100-yr AND 500-yr boundaries. Cross-checks the older Flood Damage Prevention Ordinance Art. 5 §B(2)/§D(5)/§A(9) (2009). CONFIRMED against the current (12-06-2023) regulations 2026-07-24 (cowork browser research, B986).",
    sourceDate: "2026-07-24",
    note:
      "FFE keys to the 500-YEAR WSE, not BFE + freeboard. FFE = the HIGHEST applicable basis: 500-yr WSE + 2.0 when the structure is in the 1% floodplain (Appendix B Item 8); 500-yr WSE + 1.0 when in the 500-yr band only; Zone A with no depth number → slab ≥ highest adjacent grade + 4.0 (Flood Damage Prevention Ord. §D(5) — the A-Zone catch-all; transcribed as found). CONFIRMED against the current 12-06-2023 Subdivision & Development Regulations — the earlier versioning ambiguity is resolved. §C(3): developments >50 lots or >5 ac must generate BFE/500-yr elevations via an Atlas-14 study — Planyr's numbers are screening ahead of that study; the County Engineer administers best-available data. 'Acceptable Outfall' (Sec 2.1, p. 1): a point where stormwater can be released without causing erosion or sedimentation, as determined by the developer's engineer and approved by the County. DETENTION: Waller's rural-residential detention exemption (2023 Item 15 memo amending Appendix E Sec V) applies ONLY to residential 5+ acre-lot ditch-drained subdivisions — NOT industrial; industrial detention criteria live in Appendix E 'Drainage Criteria Manual' Sec 5 (Detention Facilities), quantitative values still pending confirmation. Brookshire–Katy Drainage District may separately govern detention near Katy (target: BKDD Rules & Regulations 22-01, signed 2-28-22, + Order Amending 3-27-23 + Master Drainage Plan 6-20-23 — pending). Sandbox note: co.waller.tx.us blocks automated fetch (403); this transcription rests on the cowork agent's 2026-07-24 browser read + the owner's 2026-07-15 pull. NFIP non-residential dry-floodproofing alternatives exist; noted, not modeled.",
  },
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
  hag: "hagFt", // NEW-3 — highest adjacent grade (screening proxy: max 3DEP grade along the footprint perimeter)
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
  hag: "highest adjacent grade (3DEP screening proxy)",
};

/* NEW-1 (Waller) — does a `when`-conditioned base row apply, given the caller's
 * location ctx? Unknown flags stay conservative for the WSE rows (max-of governs)
 * but the grade-derived zone_a_no_bfe row applies only on explicit evidence. */
function baseApplies(when, ctx = {}) {
  if (!when) return true; // unconditioned rows (every pre-NEW-1 record) are unchanged
  if (when === "in_1pct") return ctx.in1pct !== false;
  if (when === "in_02pct_only") return ctx.in1pct !== true && ctx.in02pct !== false;
  if (when === "zone_a_no_bfe") return ctx.zoneANoBfe === true;
  return true; // an unrecognized condition must not silently erase a rule row
}

/* Pull a basis's WSE from the bag, honestly: an absent or non-finite value reads
 * as null (never a fabricated 0) so the caller can surface it as pending. */
function inputForBasis(basis, bag) {
  const key = BASIS_INPUT[basis];
  if (!key) return null;
  const v = bag[key];
  return v == null || !isFinite(v) ? null : v;
}

/* Required FFE from the rule + the WSE providers (B707/B759 inputs). Returns
 * { requiredFfeFt, basis, plusFt, governingBasis, losingBases, pendingBases, unknownReason }.
 * requiredFfeFt is null with a reason when no governing WSE is available.
 *
 * The rule's `ffeRule` may be EITHER:
 *   • { basis, plusFt }                  — single basis (COH & Harris; unchanged).
 *   • { bases:[{ basis, plusFt, label, when? }] } — multi basis: FFE = MAX over every
 *     APPLICABLE (see baseApplies) and COMPUTABLE basis (input present). Bases whose
 *     input is null surface in `pendingBases` as copy (never fabricated); bases whose
 *     `when` condition fails are skipped entirely (not pending — the rule doesn't bind
 *     there). Computable non-governing bases land in `losingBases` (NEW-3 tooltip).
 *     If NO basis is computable the required FFE is null and `unknownReason` lists
 *     what's needed. Pure. */
export function requiredFfe(rule, inputs = {}, ctx = {}) {
  const bag = {
    wse1pctFt: null, wse02Ft: null, atlas14Wse100Ft: null,
    preAtlas100Ft: null, zoneAEstBfeFt: null, siteBasisFt: null, hagFt: null,
    ...inputs,
  };
  if (!rule || !rule.ffeRule) {
    return { requiredFfeFt: null, basis: null, plusFt: null, governingBasis: null, losingBases: [], pendingBases: [], unknownReason: "no FFE rule modeled for this jurisdiction — verify locally" };
  }
  const ffeRule = rule.ffeRule;

  // Multi-basis (B759): take the MAX over every applicable computable basis.
  if (Array.isArray(ffeRule.bases)) {
    let best = null; // { basis, plusFt, label, requiredFfeFt }
    const computable = []; // every applicable basis that priced (governing + losers)
    const pendingBases = [];
    for (const b of ffeRule.bases) {
      if (!baseApplies(b.when, ctx)) continue; // the rule row doesn't bind at this location
      const wse = inputForBasis(b.basis, bag);
      if (wse == null) { pendingBases.push({ basis: b.basis, label: b.label, plusFt: b.plusFt }); continue; }
      const ffe = wse + b.plusFt;
      computable.push({ basis: b.basis, plusFt: b.plusFt, label: b.label, requiredFfeFt: ffe });
      if (best == null || ffe > best.requiredFfeFt) best = computable[computable.length - 1];
    }
    if (best == null) {
      const listed = ffeRule.bases.filter((b) => baseApplies(b.when, ctx));
      // NEW-3 — dedupe the "need one of" list by the underlying INPUT each basis reads, so two
      // rows that measure from the same water surface (e.g. Waller's two 500-yr WSE bases) collapse
      // to one line instead of demanding "500-yr WSE" twice. Names the input (BASIS_COPY), not the
      // location-qualified label, since the input is what the user must supply.
      const seen = new Set();
      const neededList = [];
      for (const b of (listed.length ? listed : ffeRule.bases)) {
        const key = BASIS_INPUT[b.basis] || b.basis;
        if (seen.has(key)) continue;
        seen.add(key);
        neededList.push(BASIS_COPY[b.basis] || b.label || b.basis);
      }
      return { requiredFfeFt: null, basis: null, plusFt: null, governingBasis: null, losingBases: [], pendingBases, unknownReason: `no water-surface elevation available for any FFE basis — need one of: ${neededList.join("; ")}` };
    }
    return {
      requiredFfeFt: best.requiredFfeFt,
      basis: best.basis,
      plusFt: best.plusFt,
      governingBasis: { basis: best.basis, plusFt: best.plusFt, label: best.label },
      losingBases: computable.filter((c) => c !== best),
      pendingBases,
      unknownReason: null,
    };
  }

  // Single-basis (existing; back-compat).
  const { basis, plusFt } = ffeRule;
  const wse = inputForBasis(basis, bag);
  if (wse == null) {
    return {
      requiredFfeFt: null, basis, plusFt, governingBasis: null, losingBases: [], pendingBases: [],
      unknownReason: basis === "wse02pct"
        ? "0.2% (500-yr) water-surface elevation not entered — the FFE rule measures from it"
        : basis === "wse1pct"
          ? "1% water-surface elevation (BFE) unavailable"
          : `${BASIS_COPY[basis] || basis} not available — the FFE rule measures from it`,
    };
  }
  return { requiredFfeFt: wse + plusFt, basis, plusFt, governingBasis: null, losingBases: [], pendingBases: [], unknownReason: null };
}

/* NEW-3 — the suggested pad FFE for the empty Pad/FFE field: the jurisdictional code
 * minimum, offered (never auto-committed) with its basis spelled out. Distinct from
 * requiredFfe in TWO honesty rules:
 *   • anyBuildingInTrigger === false → the county flood-ordinance FFE doesn't bind a
 *     building outside the mapped floodplain — say so instead of suggesting a number.
 *     (null/undefined = unknown → suggest normally; max-of stays conservative.)
 *   • the result names whether an ESTIMATED WSE (NEW-2 est-boundary-grade) or the HAG
 *     screening proxy fed the governing basis, so the stamp can never drop off.
 * Pure. */
export const OUTSIDE_FLOODPLAIN_FFE_NOTE =
  "No county FFE rule applies outside the mapped floodplain — drainage-criteria / pond-WSE checks may still govern; verify locally.";
// NEW-4 — the site-based screening pad is EXPLICITLY not a rule. Its provenance copy must never
// read as an ordinance minimum (the reviewing agency still sets the binding FFE).
export const SITE_BASED_FFE_NOTE =
  "Good-practice screening from your pond's design water surface — not an ordinance minimum; the reviewing agency sets the final FFE.";

/* NEW-4 — the site-basis screening pad, used ONLY when no ordinance FFE rule binds the
 * structure (e.g. every building outside the mapped floodplain). It is the MAX of:
 *   • pond 100-yr / design WSE + governing freeboard (BKDD 1 ft where the district applies), and
 *   • highest adjacent grade + a good-practice margin (seeded +1 ft, editable in Advanced).
 * This mirrors BKDD's Design Report template (Lowest FFE vs Maximum Allowable pond WSE). An
 * unanchored pond can't supply a design WSE — the basis reports UNAVAILABLE with the resolving
 * action rather than a guess (LOUD-FAILURE). Pure. */
export function siteBasisFfe({ pondDesignWseFt = null, pondFreeboardFt = 1, freeboardSource = null, hagFt = null, hagMarginFt = 1, pondAnchored = null, pondWseEstimated = false } = {}) {
  const cands = [];
  if (pondDesignWseFt != null && isFinite(pondDesignWseFt)) {
    const fb = isFinite(pondFreeboardFt) ? pondFreeboardFt : 1;
    cands.push({ key: "pond", ffe: pondDesignWseFt + fb, label: `pond design WSE + ${fb}′ freeboard${freeboardSource ? ` (${freeboardSource})` : ""}`, estimated: !!pondWseEstimated });
  }
  if (hagFt != null && isFinite(hagFt)) {
    const m = isFinite(hagMarginFt) ? hagMarginFt : 1;
    cands.push({ key: "hag", ffe: hagFt + m, label: `highest adjacent grade + ${m}′ margin`, estimated: false });
  }
  if (!cands.length) {
    return { requiredFfeFt: null, governingLabel: null, governingKey: null, losingBases: [], estimated: false, unavailableReason: pondAnchored === false ? "set the pond's top-of-bank elevation first — an unanchored pond has no design water surface to measure from" : "no pond design water surface or adjacent grade available yet" };
  }
  const best = cands.reduce((a, c) => (c.ffe > a.ffe ? c : a), cands[0]);
  return { requiredFfeFt: Math.round(best.ffe * 100) / 100, governingLabel: best.label, governingKey: best.key, losingBases: cands.filter((c) => c !== best), estimated: !!best.estimated, unavailableReason: null };
}

export function suggestedFfe({ rule = null, inputs = {}, ctx = {}, anyBuildingInTrigger = null, estimatedBases = [], site = null } = {}) {
  const req = requiredFfe(rule, inputs, ctx);
  const estSet = new Set(estimatedBases || []);
  const ordinanceBinds = anyBuildingInTrigger !== false && req.requiredFfeFt != null;
  // The site basis is computed once and reused: it's the SUGGESTION when no ordinance binds, and
  // demotes to the popover (`site`) when an ordinance rule governs. DEDUPE-FIRST — one derivation.
  const sb = site ? siteBasisFfe(site) : null;
  if (ordinanceBinds) {
    return {
      applies: true, note: null, basisKind: "ordinance", ...req,
      estimated: estSet.has(req.governingBasis ? req.governingBasis.basis : req.basis),
      site: sb, // demoted to the popover — the ordinance minimum supersedes
    };
  }
  // NEW-4 — no ordinance requirement binds → the site-based screening tier (distinct provenance).
  if (sb && sb.requiredFfeFt != null) {
    return {
      applies: true, basisKind: "site", note: SITE_BASED_FFE_NOTE,
      requiredFfeFt: sb.requiredFfeFt, basis: "site", plusFt: null,
      governingBasis: { basis: "site", label: sb.governingLabel },
      losingBases: sb.losingBases, pendingBases: [], unknownReason: null,
      estimated: sb.estimated, site: sb,
    };
  }
  // Outside the floodplain but no usable site basis (e.g. unanchored pond) → the honest
  // unavailable state carrying the resolving action, never a number.
  if (anyBuildingInTrigger === false) {
    return { applies: false, basisKind: "none", note: OUTSIDE_FLOODPLAIN_FFE_NOTE, requiredFfeFt: null, governingBasis: null, losingBases: [], pendingBases: [], unknownReason: sb ? sb.unavailableReason : null, estimated: false, site: sb };
  }
  // Inside the floodplain but the ordinance requirement isn't computable yet → the prior behavior
  // (surface pending bases / unknown), with the site basis available in the popover.
  return {
    applies: false, note: null, basisKind: "ordinance", ...req,
    estimated: false, site: sb,
  };
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
  hagFt = null, // NEW-3 — highest-adjacent-grade proxy (Waller §D(5) basis)
  buildingIn1pct = false,
  buildingIn02pct = null, // NEW-1 — tri-state ctx for `when`-conditioned bases (null = unknown)
  zoneANoBfe = null,
  floodplainPresent = false,
  wetlandsPresent = false,
  anyBuildingInTrigger = null, // NEW-3 — false ⇒ every building sits OUTSIDE the mapped floodplain
} = {}) {
  // NEW-3 — the outside-floodplain SHORT-CIRCUIT (mirrors suggestedFfe, closing the split-brain
  // where the verdict/chip path kept demanding a WSE while the suggestion path already said
  // "outside — no rule binds"). When every building is outside the mapped floodplain, no county
  // FFE ordinance binds the structure, so we surface the quiet no-rule verdict instead of an
  // input demand — never a "SET BFE" call to action, never a phantom "need one of …" list. The
  // §A(9)-class pathway hard-stop copy is retained (it still governs structural fill). A
  // null/undefined flag means "unknown" → evaluate normally (max-of stays conservative).
  if (anyBuildingInTrigger === false) {
    return {
      ffe: { status: "no_rule", requiredFfeFt: null, basis: null, plusFt: null, governingBasis: null, pendingBases: [], shortByFt: null, unknownReason: null, outsideFloodplain: true, note: OUTSIDE_FLOODPLAIN_FFE_NOTE },
      pathway: rule && rule.fillToElevate ? { fillToElevate: rule.fillToElevate, note: rule.pathwayNote } : null,
      lomr: null, // no building in the 1% floodplain → no LOMR-F pathway note
      wetlands404: floodplainPresent && wetlandsPresent ? { note: WETLANDS_404_NOTE } : null,
      flags: rule && rule.verified === false ? ["rule_unverified"] : [],
    };
  }
  const req = requiredFfe(
    rule,
    { wse1pctFt, wse02Ft, atlas14Wse100Ft, preAtlas100Ft, zoneAEstBfeFt, siteBasisFt, hagFt },
    { in1pct: buildingIn1pct === true ? true : buildingIn1pct === false ? false : null, in02pct: buildingIn02pct, zoneANoBfe: zoneANoBfe === true },
  );
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
