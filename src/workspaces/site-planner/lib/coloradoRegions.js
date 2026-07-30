/* NEW-5 / NEW-7 / NEW-8 — COLORADO: who governs, what Planyr knows, and — the load-bearing part —
 * what Planyr does NOT know and must therefore refuse to answer.
 *
 * ⛔ THE RULE THIS MODULE ENFORCES (owner constraint, and the single worst outcome this whole body
 * of work exists to prevent): a Colorado site may never render a Texas-derived number. Not a
 * fallback, not a blank that reads as zero, not a plausible band. Where a capability is not wired
 * for Colorado, the surface shows a hard, named "not available in Colorado yet" state.
 *
 * Detention is the headline case. It is NOT a missing constant — it is a different FORMULA SHAPE.
 * Every Texas rule in detentionRules.js is a rate method: some ac-ft per acre, multiplied by area.
 * MHFD sizes by WQCV (Water Quality Capture Volume — a function of imperviousness and the chosen
 * 12/24/40-hour drain time) plus EURV (Excess Urban Runoff Volume), combined as Full Spectrum
 * Detention. You cannot express that as a seed row; it needs a new ruleType with its own
 * calculator, and Larimer, Weld and El Paso each need their own treatment again. That work is
 * filed and sized, deliberately out of scope here — which is exactly why the guard below is IN
 * scope here.
 *
 * FOUR REGULATORY REGIMES ACROSS NINE COUNTIES, not one. Six of the nine are MHFD; the other
 * three each run their own criteria manual.
 *
 * Pure. No React, no DOM, no network. Node-testable.
 */

/* Where is this site? Geography, not a GIS identify — and it lives in its own tiny module
 * (`siteRegion.js`) rather than here, because everything BELOW this line is prose a Texas user
 * should never download. The guard keys off `siteState`, so that half must stay synchronous and
 * on the boot path; this file is loaded on demand once a site resolves to Colorado. Re-exported
 * boot path; this file is loaded on demand once a site resolves to Colorado.
 *
 * It is deliberately NOT re-exported from here: a re-export entangles the two tiers, and the
 * bundler then has to hoist the synchronous half into the shared entry chunk to satisfy both
 * importers. Import `siteState` from `./siteRegion.js` directly. */

/* The long-form WHY behind the detention guard's one visible line. It lives here, with the rest of
 * the Colorado prose, rather than in `detentionRules.js`: it is ⓘ content, and putting it on the
 * boot path meant every Texas user downloaded it. `computeRequiredDetention`'s carrier names this
 * constant in `detailFrom`, so the link is explicit rather than implied. */
export const COLORADO_DETENTION_DETAIL =
  "Planyr's detention engine models Texas rate-method criteria (ac-ft per acre × site area). " +
  "Colorado sizes detention differently — the Mile High Flood District by WQCV plus EURV under " +
  "Full Spectrum Detention, and Larimer, Weld and El Paso each under their own criteria manual — " +
  "so there is no honest way to convert one into the other. Nothing is shown rather than " +
  "something wrong. Size detention with your engineer against the reviewing jurisdiction's manual.";

/* NEW-1 (B1105) — the MHFD-specific detail, for the ONE regime that now has an engine.
 *
 * It says something different from the blanket detail above, and the difference is the whole point:
 * on an MHFD site Planyr names the two volumes, the drain-time election and the district workbook,
 * and checks the drawdown statute — it is the coefficient TABLES it is missing, not the method. On a
 * Larimer, Weld or El Paso site nothing at all is modeled and `COLORADO_DETENTION_DETAIL` still
 * applies verbatim. Never show this one outside MHFD. */
export const MHFD_DETENTION_DETAIL =
  "This site is in the Mile High Flood District, which sizes detention by Full Spectrum Detention: " +
  "a water-quality volume (WQCV, set by how much of the site is paved and the 12-, 24- or 40-hour " +
  "drain time your engineer elects) plus a separate flood volume (EURV, which also depends on the " +
  "soil), with the 100-year event routed above both. Planyr carries the method, the district's own " +
  "sizing workbook and the Colorado drawdown-statute check, but NOT the district's coefficient " +
  "tables — their document host is unreachable from Planyr, and a second-hand number is not good " +
  "enough for a volume you would design a site around. So the components are named and no volume " +
  "is invented. Size it in the MHFD workbook with your engineer.";

/* ---------------------------------------------------------------------------
 * The four Colorado drainage regimes.
 *
 * `detentionModeled` is THREE-VALUED as of B1105, and the three values are the whole scope of that
 * item: `"partial"` for MHFD (the `volume-curve` engine in `mhfdDetention.js` is wired — method,
 * components, drain-time election, workbook and the drawdown-statute reconciliation — with the
 * coefficient tables still untranscribed), and hard `false` for Larimer, Weld and El Paso, which
 * keep the original "not available in Colorado yet" guard untouched.
 *
 * ⛔ DO NOT GENERALISE MHFD TO THE OTHER THREE. They are not district members and each publishes its
 * own criteria manual. A plausible MHFD number on a Larimer, Weld or El Paso site is a worse outcome
 * than showing nothing, so `detentionModeled: false` there is a deliberate, tested boundary — not a
 * TODO waiting for someone to feel generous. `detentionMethod` records WHAT would have to be built,
 * so the gap stays legible rather than mysterious.
 * ------------------------------------------------------------------------- */
export const CO_DRAINAGE_REGIMES = {
  mhfd: {
    id: "mhfd",
    label: "Mile High Flood District",
    short: "MHFD",
    aka: "formerly UDFCD (Urban Drainage and Flood Control District)",
    counties: ["adams", "arapahoe", "boulder", "broomfield", "denver", "douglas", "jefferson"],
    criteria: "MHFD Urban Storm Drainage Criteria Manual (USDCM), Volumes 1–3",
    // B1105 — the one regime with an engine. See `mhfdDetention.js`; "partial" because the METHOD is
    // wired and the district's coefficient TABLES are not (every primary host is egress-blocked).
    detentionModeled: "partial",
    detentionEngine: "mhfdDetention.js",
    detentionMethod:
      "Full Spectrum Detention: WQCV (Water Quality Capture Volume — a function of imperviousness " +
      "and the selected 12/24/40-hour drain time) plus EURV (Excess Urban Runoff Volume). This is a " +
      "different formula SHAPE from Planyr's Texas rate method (ac-ft per acre × area), so it has " +
      "its own `volume-curve` calculator rather than a new rate row.",
    detentionState:
      "Wired as a volume-curve rule: WQCV and EURV are carried as distinct components with their own " +
      "citations, the 12/24/40-hour drain-time election is reconciled against C.R.S. 37-92-602(8), " +
      "and the district workbook is named. The coefficient tables are NOT transcribed, so no volume " +
      "is computed yet — the components report which document each one needs.",
    note:
      "MHFD is a regional district covering seven counties, but the CITY or COUNTY is still the " +
      "permitting authority — MHFD's manual is what they adopt and review against. Verify the local " +
      "adoption and any local amendments with the reviewing jurisdiction.",
  },
  larimer: {
    id: "larimer",
    label: "Larimer County / Fort Collins–Loveland",
    short: "Larimer",
    counties: ["larimer"],
    criteria: "Larimer County Stormwater Design Standards; City of Fort Collins and City of Loveland each publish their own criteria within their limits.",
    detentionModeled: false,
    detentionMethod: "Own criteria manual — release-rate and volume standards differ from MHFD's and are not transcribed.",
    note: "Larimer County is NOT in the Mile High Flood District. Do not apply MHFD criteria here — B1105 wired MHFD only, and this regime keeps the hard 'not available in Colorado yet' guard on purpose.",
  },
  weld: {
    id: "weld",
    label: "Weld County / Greeley",
    short: "Weld",
    counties: ["weld"],
    criteria: "Weld County drainage criteria; City of Greeley publishes its own stormwater criteria within its limits.",
    detentionModeled: false,
    detentionMethod: "Own criteria manual — not transcribed.",
    note: "Weld County is NOT in the Mile High Flood District. B1105 wired MHFD only; this regime keeps the hard 'not available in Colorado yet' guard on purpose.",
  },
  elpaso: {
    id: "elpaso",
    label: "El Paso County / Colorado Springs",
    short: "El Paso",
    counties: ["elpaso"],
    criteria: "El Paso County / City of Colorado Springs Drainage Criteria Manual (DCM), Volumes 1–2.",
    detentionModeled: false,
    detentionMethod: "Own DCM — not transcribed.",
    note: "El Paso County is NOT in the Mile High Flood District. The county and the City of Colorado Springs jointly maintain the DCM. B1105 wired MHFD only; this regime keeps the hard 'not available in Colorado yet' guard on purpose.",
  },
};

/* County (slug) → regime id, for the nine counties Planyr targets. Douglas is listed on the MHFD
 * regime record because it genuinely is a member county, but it is not a Planyr target county and
 * so has no row here — the regime's `counties` list is the fact, this map is the routing. */
export const CO_COUNTY_REGIME = {
  adams: "mhfd", arapahoe: "mhfd", boulder: "mhfd", broomfield: "mhfd",
  denver: "mhfd", jefferson: "mhfd",
  larimer: "larimer", weld: "weld", elpaso: "elpaso",
};

const slug = (c) => String(c || "").toLowerCase().replace(/^co_/, "").replace(/\b(city|and|county|of)\b/g, "").replace(/[^a-z]/g, "");

/* The regime governing a Colorado county, or null for one Planyr has not mapped. Accepts either a
 * plain county name ("El Paso", "Jefferson County") or an app routing key ("co_elpaso"). */
export function coloradoRegimeFor(county) {
  const id = CO_COUNTY_REGIME[slug(county)];
  return id ? CO_DRAINAGE_REGIMES[id] : null;
}

/* ---------------------------------------------------------------------------
 * NEW-7 — Colorado's STATEWIDE floodplain floor (CWCB, 2 CCR 408-1).
 *
 * This is a genuine finding and it cuts the other way from the detention gap: Colorado is
 * STRICTER than FEMA, statewide, in three specific ways, whereas in Texas freeboard is purely a
 * local-ordinance matter. So a Colorado site has a known minimum even before the local ordinance
 * is read — which is exactly the opposite of "we know nothing here".
 *
 * `verified` is true for the substance and `secondarySource` records how: the CWCB's own adopted
 * rules PDF returned HTTP 403 to this environment, so the values were triangulated from the rule
 * text as published through the Colorado Secretary of State CCR and Cornell LII mirrors. Confirm
 * the subsection lettering against the primary PDF before relying on a citation.
 * ------------------------------------------------------------------------- */
export const CO_STATE_FLOOD_STANDARD = {
  id: "cwcb-2ccr408-1",
  authority: "Colorado Water Conservation Board (CWCB)",
  citation: "2 CCR 408-1 — Rules and Regulations for Regulatory Floodplains in Colorado",
  verified: true,
  secondarySource: true,
  verifiedOn: "2026-07-29",
  appliesTo: "Every community in Colorado — a statewide FLOOR beneath the local floodplain ordinance, not a substitute for it.",
  standards: [
    {
      id: "freeboard",
      label: "Freeboard",
      value: 1,
      unit: "ft",
      text: "A minimum of one foot of freeboard above the 100-year (1% annual chance) flood elevation for the lowest floor of new, substantially damaged and substantially improved structures. Non-residential structures may floodproof to the same elevation instead of elevating.",
      stricterThanFema: true,
      femaBaseline: "NFIP requires the lowest floor at or above the BFE — no freeboard.",
    },
    {
      id: "critical-facilities",
      label: "Critical facilities",
      value: 2,
      unit: "ft",
      text: "New and substantially changed CRITICAL FACILITIES must be elevated or floodproofed to two feet above the 100-year flood elevation. Four categories: essential services, hazardous materials, at-risk populations, and facilities vital to restoring normal services.",
      stricterThanFema: true,
      femaBaseline: "NFIP sets no separate critical-facility standard.",
    },
    {
      id: "floodway-rise",
      label: "Floodway designation rise",
      value: 0.5,
      unit: "ft",
      text: "Floodways delineated from newly studied reaches, revised studies, or physical map revisions involving the local government use a one-half-foot (six-inch) rise criterion.",
      stricterThanFema: true,
      femaBaseline: "FEMA's default floodway criterion is a one-foot surcharge.",
    },
  ],
  note:
    "This is a FLOOR. Individual Colorado communities commonly adopt more, and a hazardous-materials " +
    "or at-risk-population building can be a Critical Facility even on an industrial site — check the " +
    "category before assuming the one-foot standard governs. Verify with the local floodplain administrator.",
};

/* ---------------------------------------------------------------------------
 * NEW-8 — THE CAPABILITY GUARD.
 *
 * One table, one question: for THIS capability in THIS state, may Planyr show a number?
 * `wired: false` is never a silent blank — it carries the copy a surface renders instead.
 * ------------------------------------------------------------------------- */
export const CAPABILITIES = {
  detentionVolume: {
    label: "Detention volume required",
    TX: { wired: true },
    /* B1105 — the CO record is now REGIME-KEYED, and the base record is still the hard guard.
     *
     * `byRegime` is consulted only when the caller passes a POSITIVELY resolved regime id, so the
     * base `wired: false` remains the answer for: a Colorado site whose regime has not resolved (the
     * lazy tier has not landed, or every GIS endpoint is down), an unmapped county, and — the case
     * this scoping exists to protect — Larimer, Weld and El Paso, which have no `byRegime` row at all
     * and therefore fall to the base record unchanged. Adding a regime here is the ONLY way to turn
     * detention on for it; there is no path by which one leaks on. */
    CO: {
      wired: false,
      headline: "Detention criteria not yet available in Colorado",
      detail:
        "Planyr's detention engine models Texas rate-method criteria (ac-ft per acre × area). " +
        "Colorado sizes detention differently — MHFD by WQCV + EURV under Full Spectrum Detention, " +
        "and Larimer, Weld and El Paso each under their own criteria manual — so there is no honest " +
        "way to convert. No detention volume is shown for a Colorado site. Size it with your engineer " +
        "against the reviewing jurisdiction's manual.",
      byRegime: {
        mhfd: {
          wired: "partial",
          headline: "MHFD detention: the method is carried, the district's tables are not",
          detail: MHFD_DETENTION_DETAIL,
        },
      },
    },
  },
  floodplainMitigation: {
    label: "Compensating storage / floodplain mitigation",
    TX: { wired: true },
    CO: {
      wired: false,
      headline: "Compensating-storage rules not yet available in Colorado",
      detail:
        "The mitigation engine prices fill against a per-jurisdiction trigger band and offset ratio. " +
        "Those records exist for the Texas jurisdictions only; no Colorado ordinance has been " +
        "transcribed, so no mitigation volume is shown.",
    },
  },
  requiredFfe: {
    label: "Required finished floor elevation",
    TX: { wired: true },
    CO: {
      wired: "partial",
      headline: "Colorado FFE uses the CWCB statewide floor only",
      detail:
        "Colorado has a statewide minimum — one foot of freeboard above the 100-year flood, two feet " +
        "for critical facilities (CWCB, 2 CCR 408-1). Planyr applies that floor. It does NOT yet carry " +
        "the local floodplain ordinance for any Colorado jurisdiction, and local rules are frequently " +
        "stricter, so treat the number as a minimum, not the requirement.",
    },
  },
  drainageAuthority: {
    label: "Reviewing drainage authority",
    TX: { wired: true },
    CO: {
      wired: "partial",
      headline: "Colorado drainage authority is named, not priced",
      detail:
        "Planyr identifies which of the four Colorado regimes governs — MHFD, Larimer, Weld or " +
        "El Paso — but carries none of their detention criteria.",
    },
  },
  detentionDrawdown: {
    // The one Colorado capability that is MORE wired than Texas: see drawdownStatute.js.
    label: "Detention drawdown",
    TX: { wired: true },
    CO: { wired: true },
  },
  taxRates: {
    label: "Taxing jurisdictions and rates",
    TX: { wired: "partial" },
    CO: {
      wired: false,
      headline: "Tax units not available in Colorado",
      detail: "The tax-unit resolver mines Texas CAD parcel attributes; the Colorado parcel schemas are not mapped.",
    },
  },
  utilityEasements: {
    label: "Utility easement widths",
    TX: { wired: "partial" },
    CO: {
      wired: false,
      headline: "Easement standards not available in Colorado",
      detail: "The easement-width rules are seeded per Texas jurisdiction only.",
    },
  },
  thoroughfarePlan: {
    label: "Thoroughfare plan / ROW widths",
    TX: { wired: "partial" },
    CO: {
      wired: false,
      headline: "Thoroughfare plan not available in Colorado",
      detail: "The thoroughfare spine carries a City of Houston ingestion config only; no Colorado jurisdiction is wired.",
    },
  },
  subsidence: {
    label: "Subsidence district",
    TX: { wired: true },
    CO: {
      wired: false,
      headline: "Not applicable in Colorado",
      detail: "The subsidence registry covers the Harris-Galveston and Fort Bend subsidence districts, which are Texas entities with no Colorado counterpart.",
      notApplicable: true,
    },
  },
};

/* The one call a surface makes. Returns a stable shape whatever the answer, so a caller can render
 * it without branching on undefined:
 *   { id, label, state, wired: true|false|"partial", available, headline, detail, notApplicable }
 *
 * An UNKNOWN state (a site with no coordinates, or one outside both envelopes) is treated as
 * available — that is the pre-Colorado world, where every site was Texas, and it keeps a
 * coordinate-less Texas plan working exactly as before. The guard fires on a POSITIVE Colorado
 * answer, never on the absence of one. */
export function capabilityFor(id, state, { regime = null } = {}) {
  const cap = CAPABILITIES[id];
  if (!cap) return { id, label: id, state: state || null, regime: null, wired: true, available: true, headline: null, detail: null, notApplicable: false };
  const st = state === "CO" ? "CO" : state === "TX" ? "TX" : null;
  const rec = st ? cap[st] : null;
  if (!rec) return { id, label: cap.label, state: st, regime: null, wired: true, available: true, headline: null, detail: null, notApplicable: false };
  /* B1105 — a regime override applies ONLY on a positive match against a declared `byRegime` row.
   * An absent regime, an unknown one, or one with no row (Larimer / Weld / El Paso) keeps `rec`
   * exactly as it was, so every pre-B1105 call site is bit-for-bit unchanged. */
  const rid = regime == null ? null : String(regime).toLowerCase();
  const over = rid && rec.byRegime ? rec.byRegime[rid] : null;
  const eff = over ? { ...rec, ...over } : rec;
  return {
    id,
    label: cap.label,
    state: st,
    regime: over ? rid : null,
    wired: eff.wired,
    available: eff.wired !== false,
    headline: eff.headline || null,
    detail: eff.detail || null,
    notApplicable: eff.notApplicable === true,
  };
}

/* NOTE — there is deliberately no `capabilityAtSite(id, point)` convenience here. It would make
 * this module import `siteRegion.js`, which the SYNCHRONOUS half already imports; the bundler then
 * has to hoist that shared module into the entry chunk, putting it on every route's critical path
 * for the sake of one wrapper. Callers compose the two: `capabilityFor(id, siteState(pt))`. */

/* Everything Colorado does NOT have, for the one place that should enumerate it honestly (the
 * audit doc, a settings panel, a release note) rather than each surface discovering it alone. */
export function coloradoGaps() {
  return Object.entries(CAPABILITIES)
    .map(([id, cap]) => ({ id, label: cap.label, ...cap.CO }))
    .filter((c) => c.wired !== true)
    .map((c) => ({
      id: c.id, label: c.label, wired: c.wired, headline: c.headline, detail: c.detail,
      notApplicable: c.notApplicable === true,
      /* B1105 — a capability can now be a gap STATEWIDE while being partly wired for one regime, and
       * an enumeration that hid that would misreport both halves. `partialFor` names the regimes that
       * do better than the base record; everything not listed gets the base (hard) answer. */
      partialFor: c.byRegime ? Object.keys(c.byRegime).filter((r) => c.byRegime[r].wired !== false) : [],
    }));
}
