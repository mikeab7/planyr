/* Per-jurisdiction floodplain-MITIGATION rules (compensating storage owed when fill
 * lands in the regulatory floodplain) — B707. EDITABLE and mostly seeded with
 * placeholder values marked `verified:false` — those are NOT authoritative
 * transcriptions. Each jurisdiction's real requirement lives in its floodplain
 * ordinance / drainage criteria manual; the user confirms and edits here
 * (easementRules.js pattern). Stored in localStorage so edits persist per device.
 *
 * EXCEPTION — the Fort Bend (B758) and Harris (B760) records ship `verified:true`:
 * their values were triangulated from verbatim search-indexed official text (FDPR /
 * Interim Atlas-14 Criteria / county floodplain regs) + owner verification, and the
 * exact subsection lettering was then CONFIRMED against the primary regulation PDFs
 * (owner-read 2026-07-12, PR #594): Harris §4.07(e); Fort Bend §5.02(h)(1)/(h)(2).
 *
 * Never flip `verified` to true without pulling the CURRENT ordinance text (or
 * triangulating verbatim official text) and recording `source` + `sourceDate` alongside it.
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
    trigger: "1pct_plus_02pct",
    ratio: 1,
    floodwayPolicy: "prohibit_fill",
    offsetScope: "storage_and_conveyance",
    locationRule: "Hydraulically equivalent offset within the same watershed / on the same property — placement per HCFCD / HCED.",
    source: "Harris County Regulations for Floodplain Management & Infrastructure Regulations, eff. 7/9/2019 (Atlas-14 ed.); §4.07(e) 1:1 offset.",
    sourceDate: "2019-07-09",
    verified: true,
    note: "§4.07(e): 1:1 hydraulically-equivalent offset for a storage/conveyance reduction from fill in the 1% (100-yr) SFHA AND the 0.2% (500-yr) floodplain incl. shaded Zone X, within the same watershed. Coastal-area exemption: tidally-influenced reaches inside the mapped coastal boundary are exempt from the 500-yr offset. The county offsets CONVEYANCE reductions too: large contiguous fringe fill can require a hydraulic / no-rise analysis beyond this volume screen. Subsection lettering confirmed against the primary fpmregs-effect190709.pdf (owner-read 2026-07-12).",
  },
  fortbend: {
    label: "Fort Bend County",
    trigger: "1pct_plus_02pct",
    ratio: 1,
    floodwayPolicy: "prohibit_fill",
    offsetScope: "storage_and_conveyance",
    locationRule: "Hydraulically-equivalent compensating storage in the SAME watershed — on the same property / sub-watershed, or a County-Engineer-approved alternate location.",
    source: "FBC Flood Damage Prevention Regs §5.02(h)(1) (adopted 3/4/2014, am. 10/8/2024) + FBCDD Interim Atlas-14 Criteria §9 (eff. 2020-01-01, rev. 9/2021).",
    sourceDate: "2024-10-08",
    verified: true,
    note: "Trigger is a storage/conveyance REDUCTION from SFHA fill (not literally any fill): a 1:1 hydraulically-equivalent offset, volume-total method (no HCFCD elevation-increment table). Pre-FIRM single-family-lot exemption per §5.02(h)(2). FBCDD Interim Atlas-14 Criteria §9 extends the offset to any storage reduction in the pre-Atlas-14 500-yr (0.2%) floodplain. Subsection lettering confirmed against the primary FBC-Flood-Damage-Prevention-Regulations_10-08-24_signed.pdf (owner-read 2026-07-12).",
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
    if (!v) return clone();
    // PER-JURISDICTION deep merge: a whole-object save must not freeze the OTHER
    // jurisdictions' seeds, and a future seed correction / new field must still
    // reach users who edited one rule (a top-level spread would shadow it forever).
    const out = clone();
    for (const [k, r] of Object.entries(v)) out[k] = { ...(out[k] || {}), ...(r || {}) };
    return out;
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

/* B790 — the county a rules key IMPLIES (lowercase display name), for the picker's
 * county-mismatch warning: a hand-picked "harris" rule on a site whose identify county
 * reads Fort Bend contradicts the map and should say so. `generic` implies no county
 * (never mismatches). Pure. */
export const floodJurCounty = (jurKey) =>
  ({ coh: "harris", harris: "harris", fortbend: "fort bend", montgomery: "montgomery", chambers: "chambers", waller: "waller" }[
    String(jurKey || "").toLowerCase()
  ] || null);
