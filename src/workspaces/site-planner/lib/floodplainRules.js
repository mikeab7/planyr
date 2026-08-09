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
 *   floodwayBufferFt — (optional, NEW-1 Waller) the jurisdiction extends the floodway
 *                   prohibition to a BUFFER ZONE this many feet beyond the mapped
 *                   floodway boundary (Waller: 100 ft, Art. 5 §E). The engine screens
 *                   fill within the buffer as floodway-class (hard stop), computed as a
 *                   true distance test against the floodway rings — the flood EXTENT
 *                   itself (trigger bands, WSE sampling) is unchanged by the buffer.
 *   offsetScope   — what the offset must replace: "storage" (volume only) or
 *                   "storage_and_conveyance" (the county rule also offsets conveyance
 *                   reductions — large contiguous fringe fill can trigger a hydraulic /
 *                   no-rise analysis beyond the volume math)
 *   locationRule  — where the compensating cut must sit (plain-language screening copy)
 *   source/sourceDate/verified/note — provenance; unverified rules stamp every output.
 */
import { normCountyKey } from "../../../shared/gis/countyKeys.js";
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
    // NEW-4 — the offset is owed up to the pre-Atlas-14 500-yr surface, not the 100-yr line.
    offsetElevBasis: "02pct",
    offsetElevNote: "FBCDD Interim Atlas-14 Criteria §9: offset any reduction in floodplain storage within the EXISTING (pre-Atlas-14) 500-yr (0.2%) floodplain. A requirement computed off the 100-yr line understates the obligation.",
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
    label: "Waller County (unincorporated)",
    trigger: "1pct_plus_02pct",
    ratio: 1,
    floodwayPolicy: "prohibit_fill",
    floodwayBufferFt: 100,
    offsetScope: "storage",
    locationRule: "On the development site (Art. 5 §A(8): compensating storage “on the development site”) — no net fill up to the 500-year floodplain elevation.",
    source: "Waller County Flood Damage Prevention Ordinance, Art. 5 §A(8)/§A(9)/§C(3)/§E (effective 2/28/2013; Waller County participates in the NFIP). Owner primary-source pull 2026-07-15; §5.C(3) read verbatim from the county-posted ordinance 2026-07-29.",
    sourceDate: "2013-02-28",
    url: "https://www.co.waller.tx.us/upload/page/0265/Flood%20Damage%20Prevention%20Ordinance%20REVISED_FINAL-2021.pdf",
    verified: true,
    /* NEW-3 (B1057 completion) — the BFE/500-yr DATA-GENERATION requirement, as a rule that FIRES
     * rather than a sentence in a note. Read verbatim from the county's own adopted ordinance
     * 2026-07-29, which is why this record is `verified:true` where the generic 44 CFR 60.3(b)(3)
     * fallback in screeningBfe.js stays `verified:false`: the CFR binds the COMMUNITY and reaches a
     * developer only through the ordinance the community adopted — and Waller's adopted text has
     * now been read. Two things it settles that the CFR did not: Atlas 14 is MANDATED as the
     * hydrology (not one acceptable option among several), and the 500-YEAR elevation is required
     * alongside the base flood elevation. "if not otherwise provided" is exactly the unmapped-Zone-A
     * case — no published BFE means the developer generates one. */
    bfeDataRequirement: {
      citation: "Waller County Flood Damage Prevention Ordinance §5.C(3)",
      url: "https://www.co.waller.tx.us/upload/page/0265/Flood%20Damage%20Prevention%20Ordinance%20REVISED_FINAL-2021.pdf",
      source: "Waller County Flood Damage Prevention Ordinance, Section 5.C(3) (effective 2/28/2013; Waller County participates in the NFIP).",
      sourceDate: "2013-02-28",
      verified: true,
      lotsThreshold: 50,
      acresThreshold: 5,
      atlas14Required: true,
      requires02pct: true,
      quote:
        "Base flood elevation and 500-year floodplain elevation data shall be generated utilizing Atlas 14 for subdivision proposals and other proposed development including the placement of manufactured home parks and subdivisions which is greater than 50 lots or 5 acres, whichever is lesser, if not otherwise provided",
      plain:
        "Waller County requires this development to GENERATE base flood elevation AND 500-year floodplain elevation data using NOAA Atlas 14, and submit it with the proposal — the trigger is more than 50 lots or 5 acres, whichever is smaller. “If not otherwise provided” means it applies wherever no elevation is already published, which is the case in an approximate A zone.",
      note:
        "A submittal requirement, not a nicety: budget and schedule the sealed Atlas-14 study at the front of the project rather than discovering it in review. Planyr's screening elevations are a look-ahead at what that study will produce — never a substitute for it.",
    },
    note: "Art. 5 §A(8) (verbatim, search-triangulated + owner-read 2026-07-15): compensating floodplain storage volume “on the development site at a 1:1 ratio for any fill placed within these flood hazard areas (no net fill up to 500-year floodplain elevation)” — trigger extends to the SFHA AND the moderate (0.2% / 500-yr) flood hazard area. §E: encroachment/fill is prohibited in the regulatory floodway PLUS a 100-ft buffer zone (Waller-specific — modeled as floodwayBufferFt). §A(9): NO structural fill in the SFHA or the 500-yr band — open foundations (pier and beam) only (see the buildability record's fillToElevate: “prohibited”). §5.C(3) is modeled as the `bfeDataRequirement` record above (verbatim text + thresholds there) — it FIRES on this site rather than sitting in prose. VERSIONING: effective 2/28/2013 per the county-posted ordinance (the “REVISED_FINAL-2021” filename is a repost of that edition, not a later one). BKDD (B861): the Brookshire–Katy Drainage District is now DETECTED (its published boundary polygon) and MODELED (a rate-control record) — a site inside it shows an ADDITIVE drainage-district tier in the detention readout; the district's rate-control criteria are additive to this county floodplain record, never a replacement. Sandbox note: co.waller.tx.us blocks automated fetch (403) — transcription rests on the owner's 2026-07-15 pull + search-indexed verbatim text.",
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
  // NEW-4 — through the shared routing-key normaliser rather than a local `.toLowerCase()`, so
  // every county-keyed lookup in the app agrees on what a key IS (trim + case + underscores).
  ({ harris: "harris", fortbend: "fortbend", montgomery: "montgomery", chambers: "chambers", waller: "waller" }[
    normCountyKey(county)
  ] || "generic");

/* The zone classes a rule's trigger obligates (feeds computeMitigation). */
export const triggerClasses = (rule) =>
  rule && rule.trigger === "1pct_plus_02pct" ? ["1pct", "02pct"] : ["1pct"];

/* NEW-4 — the mitigation TRIGGER / OFFSET SURFACE: the flood ELEVATION the lost storage must be
 * replaced up to. This is a per-jurisdiction standard, NOT a hardcoded 100-yr line.
 *
 * The distinction the old code collapsed: `trigger` says WHICH MAPPED ZONES obligate mitigation
 * (the 1% SFHA, or the SFHA plus the 0.2% shaded band); `offsetElevBasis` says WHICH WATER SURFACE
 * the offset volume is measured to inside those zones. A rule can trigger on the 1% zone and still
 * owe the offset up to the 500-yr elevation — which is exactly the Fort Bend case:
 *
 *   FBC Interim Atlas-14 Criteria §9 — offset any reduction in floodplain storage within the
 *   EXISTING (pre-Atlas-14) 500-YR floodplain. Measuring to the 100-yr line UNDERSTATES the
 *   requirement, and on a design sitting +0.5% over the requirement the sign flips.
 *
 * A rule may declare `offsetElevBasis` explicitly. Absent that, it is inferred from the trigger: a
 * rule that reaches into the 0.2% band owes its offset to the 0.2% surface. Pure. */
export const mitigationOffsetBasis = (rule) => {
  if (rule && (rule.offsetElevBasis === "1pct" || rule.offsetElevBasis === "02pct")) return rule.offsetElevBasis;
  return rule && rule.trigger === "1pct_plus_02pct" ? "02pct" : "1pct";
};

/* The plain-English name of that surface, for the panel line that STATES which flood line the
 * requirement was computed from (NEW-4's visible half). Pure. */
export const offsetSurfaceLabel = (basis) => (basis === "02pct" ? "0.2% (500-yr) flood elevation" : "1% (100-yr) flood elevation");

/* The jurisdiction's own citation for its offset surface, so the panel names the authority AND the
 * rule rather than asserting a number. Pure. */
export function offsetSurfaceBasis(rule) {
  const basis = mitigationOffsetBasis(rule);
  return {
    basis,
    label: offsetSurfaceLabel(basis),
    authority: rule ? rule.label : null,
    source: rule ? rule.source : null,
    verified: rule ? rule.verified !== false : false,
    note: rule && rule.offsetElevNote ? rule.offsetElevNote : null,
  };
}

/* NEW-3 (B1057 completion) — the jurisdiction's own BFE/500-yr DATA-GENERATION requirement, when
 * its adopted ordinance has actually been read. Returns the record or null; a null means "no
 * jurisdiction text on file", NOT "no requirement" — the caller falls back to the generic NFIP
 * minimum (screeningBfe.BFE_DATA_REQUIREMENT, verified:false) and says so. Pure. */
export const bfeDataRequirementFor = (rule) => (rule && rule.bfeDataRequirement) || null;

/* Does the jurisdiction MANDATE Atlas 14 as the hydrology for that data? Waller §5.C(3) does, so a
 * regional-regression discharge can only ever be a labelled cross-check there. Pure. */
export const atlas14Mandated = (rule) => !!(rule && rule.bfeDataRequirement && rule.bfeDataRequirement.atlas14Required);

/* B790 — the county a rules key IMPLIES (lowercase display name), for the picker's
 * county-mismatch warning: a hand-picked "harris" rule on a site whose identify county
 * reads Fort Bend contradicts the map and should say so. `generic` implies no county
 * (never mismatches). Pure. */
export const floodJurCounty = (jurKey) =>
  ({ coh: "harris", harris: "harris", fortbend: "fort bend", montgomery: "montgomery", chambers: "chambers", waller: "waller" }[
    String(jurKey || "").toLowerCase()
  ] || null);
