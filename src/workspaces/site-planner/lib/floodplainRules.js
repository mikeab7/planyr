/* Per-jurisdiction floodplain-MITIGATION rules (compensating storage owed when fill
 * lands in the regulatory floodplain) — B707. EDITABLE and seeded with values clearly
 * marked `verified:false` — these are NOT authoritative transcriptions. Each
 * jurisdiction's real requirement lives in its floodplain ordinance / drainage
 * criteria manual; the user confirms and edits here (easementRules.js pattern).
 * Stored in localStorage so edits persist per device.
 *
 * Never flip `verified` to true without pulling the CURRENT ordinance text and
 * recording `source` + `sourceDate` alongside it.
 *
 * Schema per jurisdiction:
 *   trigger       — which mapped band obligates mitigation when filled:
 *                     "1pct"            → the 1%-annual-chance (100-yr) SFHA only
 *                     "1pct_plus_02pct" → SFHA plus the 0.2% (500-yr) shaded band
 *                                         (incl. AO/AH sheet-flow/ponding zones)
 *   ratio         — compensating-storage volume per volume of fill (1 = zero-net-fill)
 *   floodwayPolicy— "prohibit_fill": fill/structures in the regulatory FLOODWAY are
 *                   not mitigable at any ratio — a hard stop, not a volume price
 *   offsetScope   — what the offset must replace: "storage" (volume only) or
 *                   "storage_and_conveyance" (the county rule also offsets conveyance
 *                   reductions — large contiguous fringe fill can trigger a hydraulic /
 *                   no-rise analysis beyond the volume math)
 *   locationRule  — where the compensating cut must sit (plain-language screening copy)
 *   source/sourceDate/verified/note — provenance; unverified rules stamp every output.
 */
const LS = "planarfit:floodplainRules:v1";

export const DEFAULT_FLOODPLAIN_RULES = {
  coh: {
    label: "City of Houston",
    trigger: "1pct_plus_02pct",
    ratio: 1,
    floodwayPolicy: "prohibit_fill",
    offsetScope: "storage",
    locationRule: "On-site (or as the City's Ch. 19 administration allows) — cut must be hydraulically connected at flood stages.",
    source: "COH Code of Ordinances Ch. 19 (Floodplain), as amended eff. 9/1/2018 — fill triggers extend to the 0.2% (500-yr) floodplain.",
    sourceDate: "2018-09-01",
    verified: false,
    note: "Placeholder transcription — VERIFY against the current Municode Ch. 19 text before relying on the trigger band or ratio.",
  },
  harris: {
    label: "Harris County (unincorporated)",
    trigger: "1pct",
    ratio: 1,
    floodwayPolicy: "prohibit_fill",
    offsetScope: "storage_and_conveyance",
    locationRule: "Hydraulically equivalent offset within the same watershed / on the same property — verify placement with HCFCD.",
    source: "Harris County Regulations of Floodplain Management eff. 1/1/2018 + HCFCD Policy Criteria & Procedure Manual (2019 Atlas-14 ed.).",
    sourceDate: "2019-01-01",
    verified: false,
    note: "Placeholder — VERIFY current county regs + PCPM. The county offsets CONVEYANCE reductions too: large contiguous fringe fill can require a hydraulic / no-rise analysis beyond this volume screen.",
  },
  fortbend: {
    label: "Fort Bend County",
    trigger: "1pct", ratio: 1, floodwayPolicy: "prohibit_fill", offsetScope: "storage",
    locationRule: "Verify placement rules with the county engineer.",
    source: "Fort Bend County drainage criteria (not yet transcribed).",
    sourceDate: null, verified: false,
    note: "Placeholder (1% @ 1:1) — VERIFY with the Fort Bend County Drainage District criteria.",
  },
  montgomery: {
    label: "Montgomery County",
    trigger: "1pct", ratio: 1, floodwayPolicy: "prohibit_fill", offsetScope: "storage",
    locationRule: "Verify placement rules with the county engineer.",
    source: "Montgomery County drainage criteria (not yet transcribed).",
    sourceDate: null, verified: false,
    note: "Placeholder (1% @ 1:1) — VERIFY with the Montgomery County DCM.",
  },
  chambers: {
    label: "Chambers County",
    trigger: "1pct", ratio: 1, floodwayPolicy: "prohibit_fill", offsetScope: "storage",
    locationRule: "Verify placement rules with the county engineer.",
    source: "Chambers County floodplain order (not yet transcribed).",
    sourceDate: null, verified: false,
    note: "Placeholder (1% @ 1:1) — VERIFY with Chambers County.",
  },
  waller: {
    label: "Waller County",
    trigger: "1pct", ratio: 1, floodwayPolicy: "prohibit_fill", offsetScope: "storage",
    locationRule: "Verify placement rules with the county engineer.",
    source: "Waller County floodplain order (not yet transcribed).",
    sourceDate: null, verified: false,
    note: "Placeholder (1% @ 1:1) — VERIFY with Waller County.",
  },
  generic: {
    label: "Generic / unknown",
    trigger: "1pct", ratio: 1, floodwayPolicy: "prohibit_fill", offsetScope: "storage",
    locationRule: "Verify placement rules with the reviewing authority.",
    source: "No jurisdiction matched.",
    sourceDate: null, verified: false,
    note: "Placeholder — no jurisdiction matched; VERIFY locally.",
  },
};

const clone = () => JSON.parse(JSON.stringify(DEFAULT_FLOODPLAIN_RULES));

// `store` is injectable for Node tests (defaults to the browser's localStorage; absent
// there, loads/saves quietly fall back to the seeds — same guard as easementRules.js).
export function loadFloodplainRules(store) {
  try {
    const s = store || (typeof localStorage !== "undefined" ? localStorage : null);
    const v = s ? JSON.parse(s.getItem(LS)) : null;
    return v ? { ...clone(), ...v } : clone();
  } catch (_) { return clone(); }
}
export function saveFloodplainRules(rules, store) {
  try {
    const s = store || (typeof localStorage !== "undefined" ? localStorage : null);
    if (s) s.setItem(LS, JSON.stringify(rules));
  } catch (_) {}
}

/* Best-guess rules key from the RESOLVED drainage authority (detentionRules.js ids) —
 * richer than a bare county guess because the drainage identify already separates COH
 * (city + ETJ) from unincorporated Harris. User can override in the UI (B74 pattern). */
export const defaultFloodJurForAuthority = (authorityId) =>
  ({
    coh: "coh",
    hcfcd: "harris",
    fortbend: "fortbend",
    montgomery: "montgomery",
    chambers: "chambers",
    waller: "waller",
    // Municipal adopt-by-reference overlays sit inside their county's floodplain regime.
    missouricity: "fortbend",
    magnolia: "montgomery",
  }[authorityId] || "generic");

/* County fallback for plans that haven't run the drainage identify (county comes from
 * the plan header). Harris county alone can't distinguish COH from unincorporated —
 * default to the county rule and let the picker/identify refine it. */
export const defaultFloodJurForCounty = (county) =>
  ({ harris: "harris", fortbend: "fortbend", montgomery: "montgomery", chambers: "chambers", waller: "waller" }[
    String(county || "").toLowerCase()
  ] || "generic");

/* The zone classes a rule's trigger obligates (feeds computeMitigation). */
export const triggerClasses = (rule) =>
  rule && rule.trigger === "1pct_plus_02pct" ? ["1pct", "02pct"] : ["1pct"];
