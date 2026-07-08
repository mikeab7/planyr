/* Buildability pathway (B710) — the ROADMAP "finished-floor-vs-base-flood" item.
 * For an industrial product the floodplain question isn't just volumes: can a
 * slab-on-grade tilt-wall pad be permitted at all, by what pathway, at what FFE?
 *
 * Three screens, all copy-first and provider-fed by B707's WSE inputs:
 *   1. Required FFE — per-jurisdiction rule (COH & unincorporated Harris seed:
 *      0.2% WSE + 2 ft; verified:false — VERIFY current text). Non-residential
 *      DRY-FLOODPROOFING alternatives exist under the NFIP — noted in copy, never
 *      modeled here.
 *   2. Foundation pathway — is fill-to-elevate allowed (with mitigation) or
 *      restricted (LOMR pathway commonly required)?
 *   3. LOMR-F flag — a pad in the 1% floodplain usually needs the fill +
 *      CLOMR-F/LOMR-F pathway to exit the SFHA; copy only, no timeline math.
 * Plus the wetlands cross-flag (floodplain ∩ NWI wetlands → Section 404 note),
 * sourced from the EXISTING wetlands finding — no new fetch.
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
    ffeRule: { basis: "wse02pct", plusFt: 2 },
    fillToElevate: "restricted",
    pathwayNote: "Harris County: fill-to-elevate is restricted in the 1% floodplain — a slab-on-grade pad commonly requires the LOMR pathway.",
    verified: false,
    source: "Harris County Regulations of Floodplain Management (eff. 1/1/2018).",
    sourceDate: "2018-01-01",
    note: "Placeholder — VERIFY current county regs. NFIP non-residential dry-floodproofing alternatives exist; noted, not modeled.",
  },
  // No modeled FFE rule for the remaining counties — an honest "verify locally"
  // beats a fabricated elevation rule (the silent-error principle).
  fortbend: { label: "Fort Bend County", ffeRule: null, fillToElevate: null, pathwayNote: null, verified: false, source: "Not yet transcribed.", sourceDate: null, note: "No FFE rule modeled — VERIFY with the county." },
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

/* Required FFE from the rule + the WSE providers (B707's inputs). Returns
 * { requiredFfeFt, basis, plusFt, unknownReason } — requiredFfeFt null with the
 * reason when the governing WSE isn't available. Pure. */
export function requiredFfe(rule, { wse1pctFt = null, wse02Ft = null } = {}) {
  if (!rule || !rule.ffeRule) return { requiredFfeFt: null, basis: null, plusFt: null, unknownReason: "no FFE rule modeled for this jurisdiction — verify locally" };
  const { basis, plusFt } = rule.ffeRule;
  const wse = basis === "wse02pct" ? wse02Ft : wse1pctFt;
  if (wse == null || !isFinite(wse)) {
    return {
      requiredFfeFt: null, basis, plusFt,
      unknownReason: basis === "wse02pct"
        ? "0.2% (500-yr) water-surface elevation not entered — the FFE rule measures from it"
        : "1% water-surface elevation (BFE) unavailable",
    };
  }
  return { requiredFfeFt: wse + plusFt, basis, plusFt, unknownReason: null };
}

/* The full buildability screen. Inputs are FACTS the caller already holds (no
 * fetches here): the pad FFE (plan or element), the WSE providers, whether any
 * building footprint intersects the 1% floodplain, and whether the site's wetlands
 * finding is PRESENT. Returns readout-ready flags; copy is exported once above so
 * panel/print never drift. Pure. */
export function assessBuildability({
  rule = null,
  padFfeFt = null,
  wse1pctFt = null,
  wse02Ft = null,
  buildingIn1pct = false,
  floodplainPresent = false,
  wetlandsPresent = false,
} = {}) {
  const req = requiredFfe(rule, { wse1pctFt, wse02Ft });
  let ffeStatus;
  let shortByFt = null;
  if (req.requiredFfeFt == null) ffeStatus = rule && rule.ffeRule ? "unknown" : "no_rule";
  else if (padFfeFt == null || !isFinite(padFfeFt)) { ffeStatus = "unknown"; req.unknownReason = "pad / finished-floor elevation not entered"; }
  else if (padFfeFt >= req.requiredFfeFt - 1e-9) ffeStatus = "pass";
  else { ffeStatus = "short"; shortByFt = req.requiredFfeFt - padFfeFt; }

  const flags = [];
  if (rule && rule.verified === false) flags.push("rule_unverified");

  return {
    ffe: { status: ffeStatus, requiredFfeFt: req.requiredFfeFt, basis: req.basis, plusFt: req.plusFt, shortByFt, unknownReason: req.unknownReason },
    pathway: rule && rule.fillToElevate ? { fillToElevate: rule.fillToElevate, note: rule.pathwayNote } : null,
    lomr: buildingIn1pct ? { note: LOMR_NOTE } : null,
    wetlands404: floodplainPresent && wetlandsPresent ? { note: WETLANDS_404_NOTE } : null,
    flags,
  };
}
