/* NEW-1 (B1105) — THE MHFD DETENTION ENGINE: ruleType `volume-curve`.
 *
 * WHAT THIS IS. Every Texas rule in `detentionRules.js` is a RATE method: one published number of
 * ac-ft per acre, multiplied by an area. That shape cannot express how the Mile High Flood District
 * sizes detention, which is why B1105 exists as a separate item rather than a seed row. MHFD sizes
 * by FULL SPECTRUM DETENTION — two structurally different volumes stacked in one basin:
 *
 *   WQCV  Water Quality Capture Volume. A water-QUALITY requirement. A function of imperviousness
 *         and the drain time the designer ELECTS (12, 24 or 40 hours). USDCM Volume 3, Chapter 3.
 *   EURV  Excess Urban Runoff Volume. The volume/FLOOD piece — the difference between developed and
 *         pre-developed runoff volume over the range of storms that make pervious ground run off
 *         (roughly the 2-year and up). A function of imperviousness AND the NRCS hydrologic soil
 *         group. UDFCD "Determination of the EURV for Full Spectrum Detention" memorandum.
 *   100-yr The flood-control event, which sits ON TOP of the full-spectrum volume and is settled by
 *         hydrograph ROUTING, not by a volume curve at all.
 *
 * ⛔ WQCV AND EURV ARE NEVER COLLAPSED INTO ONE NUMBER. They answer different questions, they are
 * reviewed by different criteria, and a designer can satisfy one while failing the other. This
 * module therefore models a rule as a LIST OF NAMED COMPONENTS, each carrying its own curve, its own
 * inputs, its own evidence state and its own citation — plus a GOVERNING TOTAL derived from them.
 * That component list IS the `volume-curve` ruleType. (Build requirement, B1105.)
 *
 * ─────────────────────────────────────────────────────────────────────────────────────────────────
 * ⛔ READ THIS BEFORE ADDING A NUMBER — WHY THE CURVES ARE `null` TODAY.
 *
 * The coefficients are NOT in this file, and their absence is deliberate and load-bearing. Every
 * primary source (mhfd.org, mhfd.specialdistrict.org, old.mhfd.org, fcgov.com, denvergov.org) is
 * unreachable from the build environment — the egress gateway answers 403 to CONNECT for all of
 * them, and the fetch tooling 403s on every host including unrelated ones, so this is an
 * environment limit and not a bad URL. Web search reaches the open web but returns a MODEL SUMMARY
 * of a page rather than its text, and two independent search reads of the SAME EURV memorandum
 * returned two DIFFERENT coefficient sets. That disagreement is the proof that these numbers cannot
 * be responsibly transcribed at second hand.
 *
 * So the shipped rule carries `transcribed: false` and `curve: null` on the volume components, and
 * the calculator returns a per-component `unavailable` NAMING the document and table it needs. An
 * approximated detention volume — a plausible number a developer might actually buy land on — is
 * the exact failure this whole body of work exists to prevent, and it is worse than no number.
 *
 * The calculator itself is REAL and fully tested: `wqcvDepthIn` / `eurvDepthIn` compute correct
 * volumes from a supplied curve, and the suite proves that against synthetic curves. When someone
 * with a browser reads USDCM Vol. 3 Table 3-2 and the EURV memorandum, dropping the coefficients in
 * is a DATA edit — one object literal per component, no code change and no new dispatch. That is
 * rules-as-data doing its job: the engine is finished, the transcription is the open task
 * (`OWNER-TODO.md`).
 * ─────────────────────────────────────────────────────────────────────────────────────────────────
 *
 * SCOPE — six counties, and not one more. MHFD's members are Adams, Arapahoe, Boulder, Broomfield,
 * Denver, Douglas and Jefferson; six of those are Planyr target counties. LARIMER, WELD and EL PASO
 * ARE NOT MEMBERS and each runs its own criteria manual (Larimer County / Fort Collins–Loveland;
 * Weld County / Greeley; El Paso County / Colorado Springs DCM). They keep the hard "not available
 * in Colorado yet" guard, unchanged. Nothing here may generalise to them: a plausible MHFD number
 * on a Larimer site is a worse outcome than shipping nothing, so membership is an explicit
 * allow-list (`MHFD_MEMBER_COUNTIES`) that a caller must match POSITIVELY, never a fallback.
 *
 * Loaded on demand with the rest of the Colorado tier (`SitePlanner`'s `coTier`) — a Texas user
 * downloads none of it. Pure. No React, no DOM, no network. Node-testable.
 */

/* MHFD's member counties, as county SLUGS (the `coloradoRegions.js` slug form). Douglas is a
 * genuine member but not a Planyr target county; it is listed because membership is a fact about
 * the district, and `targetCounties` records which of them Planyr actually routes. */
export const MHFD_MEMBER_COUNTIES = ["adams", "arapahoe", "boulder", "broomfield", "denver", "douglas", "jefferson"];
export const MHFD_TARGET_COUNTIES = ["adams", "arapahoe", "boulder", "broomfield", "denver", "jefferson"];

/* The three counties that must NEVER reach this module. Named explicitly, and asserted in the
 * suite, so the exclusion is a tested fact rather than an assumption about who calls us. */
export const NON_MHFD_CO_COUNTIES = ["larimer", "weld", "elpaso"];

const AC_FT_PER_ACRE_INCH = 1 / 12; // 1 watershed inch over 1 acre = 1/12 ac-ft
const round4 = (n) => Math.round(n * 10000) / 10000;

export const MHFD_CAVEAT =
  "Screening estimate — confirm with your engineer and the reviewing jurisdiction.";

/* The ONE visible panel line for an MHFD site, and it lives HERE rather than in `SitePlanner.jsx`
 * for a bundle reason that is worth stating: it can only ever render once this chunk has landed
 * (the branch is gated on a flag this module sets), so putting the literal on the boot path would
 * make every Texas user download Colorado prose to show a line they can never see —
 * `ui-audit/verify-colorado-guard.mjs` asserts exactly that, in both directions. Carried ON the
 * carrier (`panelLine`) so the carrier stays self-describing. */
const MHFD_PANEL_LINE = "full spectrum — WQCV + EURV; size in the district workbook.";

/* The SUBJECT of the verdict strip's one-line detention row — "MHFD WQCV + EURV".
 *
 * Composed here, on the carrier, for the same bundle reason as MHFD_PANEL_LINE: the district name and
 * the component short names are Colorado data, and deriving them inside `yieldVerdicts.js` (which IS
 * on the boot path, because the row must render instantly) put that filtering and joining in the
 * eager bundle for a string only a Colorado site can ever see. The flood-control component is
 * excluded: the row names the two VOLUMES a reader has to size, not the routed event above them. */
function verdictSubjectFor(rec, components) {
  const named = (components || []).filter((c) => c.required !== false && c.role !== "flood-control").map((c) => c.short).filter(Boolean);
  return `${rec.authorityShort} ${named.length ? named.join(" + ") : "criteria"}`;
}

/* Why a component cannot produce a number. These are NAMED states, not a generic failure: each one
 * implies a different next action, and the panel says which. */
export const BLOCK_REASONS = {
  SOURCE_UNREACHABLE: "source-unreachable",
  SOURCE_CONFLICT: "source-conflict",
  REQUIRES_ROUTING: "requires-routing",
  NEEDS_INPUT: "needs-input",
};

// ---------------------------------------------------------------------------
// The rule record — versioned data, newest first, exactly like DETENTION_RULES.
// ---------------------------------------------------------------------------

/* Provenance, stated once and referenced by every component. `verified` describes the STRUCTURE
 * (which documents govern, which variables each component depends on, what the drain-time options
 * are, how the pieces combine) — that much is corroborated across several independent documents.
 * It does NOT describe the coefficients, which are `transcribed: false` per component. Keeping
 * those two claims apart is the point: "we know the method" and "we know the numbers" are
 * different statements and this repo has been burned by conflating them. */
export const MHFD_SOURCES = {
  storage: {
    name: "MHFD (formerly UDFCD) Urban Storm Drainage Criteria Manual (USDCM), Volume 2, Chapter 12 — Storage (September 2017)",
    section: "Ch. 12 Storage — full spectrum detention, release rates, outlet configuration",
    url: "https://www.mhfd.org/files/473699ead/12_Storage.pdf",
  },
  wqcv: {
    name: "USDCM Volume 3, Chapter 3 — Calculating the WQCV and Volume Reduction",
    section: "Ch. 3 — WQCV as a function of imperviousness and the elected 12/24/40-hour drain time (the WQCV equation, its drain-time coefficient table, and the imperviousness-vs-WQCV figure)",
    url: "https://www.mhfd.org/files/bfea52e86/Chapter-3-Calculating-the-WQCV-and-Volume-Reduction.pdf",
  },
  eurv: {
    name: "UDFCD Technical Memorandum — Determination of the Excess Urban Runoff Volume (EURV) for Full Spectrum Detention",
    section: "EURV depth in watershed inches — power-curve fits by imperviousness and NRCS hydrologic soil group",
    url: "https://www.mhfd.org/files/2cf25e4fe/UDFCD_EURV_Determination_Memorandum.pdf",
  },
  fullSpectrum: {
    name: "UDFCD — Full Spectrum Detention to Control Stormwater Runoff (2007)",
    section: "Capture and slow release of the EURV, with the flood-control event above it",
    url: "https://www.mhfd.org/files/f555cf09f/Full-Spectrum-Detention-2007.pdf",
  },
  workbook: {
    name: "MHFD-Detention Workbook — Technical Reference Manual (March 2022)",
    section: "The district's own sizing workbook — what a reviewer expects a submittal to be built in",
    url: "https://mhfd.specialdistrict.org/files/12df6448a/Detention-Basin-Design-Workbook.pdf",
  },
  orifice: {
    name: "UDFCD Technical Memorandum — Orifice Plate Sizing for EURV & WQCV",
    section: "Outlet plate sizing for the WQCV and EURV release",
    url: "https://old.mhfd.org/wp-content/uploads/2019/12/UDFCD-orifice-sizing-memorandum.pdf",
  },
};

/* The single sentence every untranscribed component carries, so the reason a number is missing is
 * never mysterious and never reads as a bug. */
const UNREACHABLE_TEXT =
  "The coefficients have not been transcribed: MHFD's own document host is unreachable from " +
  "Planyr's build environment, and a second-hand reading is not good enough for a volume a site " +
  "gets designed around.";

const CONFLICT_TEXT =
  "The coefficients have not been transcribed: two independent secondary readings of this " +
  "memorandum returned DIFFERENT coefficient sets, so neither can be trusted. The primary " +
  "memorandum is required.";

export const MHFD_DETENTION_RULES = {
  mhfd: [
    {
      id: "mhfd-usdcm-full-spectrum-2017",
      authority: "mhfd",
      authorityLabel: "Mile High Flood District",
      authorityShort: "MHFD",
      /* What `ruleBadge` shows where a rate method shows "0.65 ac-ft/ac". Carried as DATA on the
       * record — not derived in `detentionRules.ruleBadge`, which is on the boot path — so the string
       * and its composition stay in this lazily-loaded module. Never a per-acre number: a
       * full-spectrum volume has none, and inventing one is the failure this whole item guards. */
      badgeMethod: "full spectrum (WQCV + EURV)",
      // The ruleType that makes this item a new engine rather than a new row. A `volume-curve` rule
      // has NO `rateAcFtPerAc` — there is no per-acre number to show, and inventing one to fill the
      // existing badge would be a fabrication. `ruleBadge` handles that (see detentionRules.js).
      ruleType: "volume-curve",
      effectiveDate: "2017-09-01", // USDCM Vol. 2 Ch. 12 "Storage", September 2017 edition
      verifiedOn: "2026-07-29",
      // STRUCTURE verified from corroborating secondary reads; COEFFICIENTS not transcribed.
      // See the header. `secondarySource` is the repo's existing flag for exactly this state.
      secondarySource: true,
      structureVerified: true,
      coefficientsTranscribed: false,
      provenanceNote:
        "Which documents govern, which variables each component depends on, the 12/24/40-hour " +
        "drain-time election, and how the components stack are corroborated across several " +
        "independent sources. The coefficient tables are NOT transcribed — every primary host is " +
        "egress-blocked from this environment. Confirm every number against the primary manual.",
      source: MHFD_SOURCES.storage,
      params: {
        // How the components stack into the governing requirement.
        combine: "full-spectrum",
        combineNote:
          "Full spectrum detention stacks the components in one basin rather than adding three " +
          "independent ponds: the WQCV occupies the lowest zone and drains over the elected " +
          "12/24/40 hours, the EURV is captured and released slowly above it, and the " +
          "flood-control event routes through the volume above that. The governing REQUIRED " +
          "volume is therefore set by the components together, which is why no single AC-FT/AC " +
          "rate can express it.",
        memberCounties: MHFD_MEMBER_COUNTIES,
        targetCounties: MHFD_TARGET_COUNTIES,
        components: [
          {
            id: "wqcv",
            label: "Water quality capture volume",
            short: "WQCV",
            // The ROLE keeps the two volumes distinct in every readout. A water-quality volume and
            // a flood volume are not interchangeable and must never be summed into "detention".
            role: "water-quality",
            required: true,
            depends: ["imperviousness", "drainTimeHr"],
            // The drain-time election is a real, corroborated part of the method and it is what the
            // C.R.S. 37-92-602(8) reconciliation keys off — so it is DATA here even though the
            // coefficients are not.
            drainTimeOptionsHr: [12, 24, 40],
            drainTimeNote:
              "The designer elects the WQCV drain time; a longer drain time is a larger required " +
              "volume and better treatment. MHFD publishes a coefficient per option.",
            // The equation SHAPE the manual publishes: a drain-time coefficient times a cubic in
            // imperviousness, giving a depth in watershed inches. `wqcvDepthIn` implements it. The
            // coefficients that fill it are absent — see the header.
            curveForm: "drainTimeCoeff × (c3·i³ + c2·i² + c1·i + c0), depth in watershed inches, i = imperviousness as a fraction",
            curve: null,
            transcribed: false,
            blocked: {
              reason: BLOCK_REASONS.SOURCE_UNREACHABLE,
              text: UNREACHABLE_TEXT,
              need: "USDCM Volume 3, Chapter 3 — the WQCV equation and its drain-time coefficient table.",
            },
            source: MHFD_SOURCES.wqcv,
          },
          {
            id: "eurv",
            label: "Excess urban runoff volume",
            short: "EURV",
            role: "flood-volume",
            required: true,
            depends: ["imperviousness", "hydrologicSoilGroup"],
            curveForm: "per-soil-group power fits in imperviousness, area-weighted by the NRCS hydrologic soil group split; depth in watershed inches",
            curve: null,
            transcribed: false,
            blocked: {
              reason: BLOCK_REASONS.SOURCE_CONFLICT,
              text: CONFLICT_TEXT,
              need: "The UDFCD EURV Determination Memorandum — the per-soil-group coefficients and exponents, and the rainfall range they are valid over.",
            },
            source: MHFD_SOURCES.eurv,
          },
          {
            id: "storm100",
            label: "100-year flood-control volume",
            short: "100-yr",
            role: "flood-control",
            required: true,
            depends: ["routing"],
            // Not a curve at all, and saying so is the honest answer rather than a gap. This is why
            // the component model carries a `method` and not just a curve.
            method: "routing",
            curve: null,
            transcribed: false,
            blocked: {
              reason: BLOCK_REASONS.REQUIRES_ROUTING,
              text:
                "The flood-control volume above the full-spectrum zone is settled by routing a " +
                "hydrograph through the basin and its outlet, not by a volume curve — so it is not " +
                "a coefficient Planyr could look up. It comes out of the district's workbook.",
              need: "A routed design in the MHFD-Detention Workbook (or an equivalent model).",
            },
            source: MHFD_SOURCES.storage,
          },
        ],
        // Release rates and outlet configuration: named, cited, NOT transcribed. Recorded as
        // structure so a reader learns what governs, with no number to mistake for a criterion.
        release: {
          transcribed: false,
          blocked: {
            reason: BLOCK_REASONS.SOURCE_UNREACHABLE,
            text: UNREACHABLE_TEXT,
            need: "USDCM Volume 2, Chapter 12 — allowable release rates.",
          },
          note:
            "MHFD sets allowable release rates in USDCM Volume 2, Chapter 12. Planyr does not " +
            "carry them, so it cannot check post-vs-pre release for an MHFD site.",
          source: MHFD_SOURCES.storage,
        },
        outlet: {
          transcribed: false,
          blocked: {
            reason: BLOCK_REASONS.SOURCE_UNREACHABLE,
            text: UNREACHABLE_TEXT,
            need: "USDCM Volume 2, Chapter 12 + the UDFCD orifice-plate sizing memorandum — required outlet configuration.",
          },
          note:
            "Full spectrum detention needs a specific outlet: a WQCV plate zone, an EURV release " +
            "above it, and the flood-control opening above that. The configuration is not " +
            "transcribed, so Planyr's outlet model must not be applied to an MHFD basin.",
          source: MHFD_SOURCES.orifice,
        },
        // A genuinely actionable fact that needs no coefficient: MHFD publishes the workbook a
        // submittal is expected to be built in, so "take this to the workbook" is a real answer.
        workbook: {
          required: true,
          note:
            "MHFD publishes its own MHFD-Detention Workbook and reviewers expect a submittal sized " +
            "in it. Size the basin there with your engineer.",
          source: MHFD_SOURCES.workbook,
        },
        // See `municipalOverlayNote` below — being inside the district does not settle whose
        // criteria are final.
        municipalOverlay: {
          possible: true,
          note:
            "MHFD's manual is what member jurisdictions adopt and review against, but the CITY or " +
            "COUNTY is the permitting authority and a member city may layer stricter local " +
            "criteria on top. Denver publishes its own combined manual. Confirm the operative " +
            "criteria with the reviewing jurisdiction before sizing.",
          knownOwnManual: ["denver"],
          source: {
            name: "Denver — Urban Storm Drainage Criteria Manual (the city's own combined manual, published alongside the district's)",
            section: "Municipal amendments layered on the district criteria",
            url: "https://denvergov.org/files/assets/public/v/2/doti/documents/permits/sspr-stormsanitary/urban-storm-drainage-manual.pdf",
          },
        },
      },
    },
  ],
};

/* Newest record effective on `onDate` — same seam and same semantics as `detentionRules.ruleFor`. */
export function mhfdRuleFor(onDate = null) {
  const recs = MHFD_DETENTION_RULES.mhfd;
  const date = onDate || "9999-12-31";
  for (const r of recs) if (r.effectiveDate <= date) return r;
  return null; // asked for a date before the oldest record — honest null, never a guess
}

const slug = (c) =>
  String(c || "")
    .toLowerCase()
    .replace(/^co_/, "")
    .replace(/\b(city|and|county|of)\b/g, "")
    .replace(/[^a-z]/g, "");

/* Is this county an MHFD member? A POSITIVE allow-list match, never a fallback — an unrecognised
 * county is `false`, which routes to the unchanged Colorado guard. */
export const isMhfdCounty = (county) => MHFD_MEMBER_COUNTIES.includes(slug(county));

// ---------------------------------------------------------------------------
// The curve math. Real, pure, and tested — it is the DATA that is missing, not this.
// ---------------------------------------------------------------------------

/* A watershed depth in inches over `acres` → ac-ft. */
export const depthInToAcFt = (depthIn, acres) =>
  depthIn == null || acres == null ? null : round4(depthIn * AC_FT_PER_ACRE_INCH * acres);

/* WQCV depth in watershed inches.
 *
 * `curve` is the DATA the manual publishes:
 *   { drainTimeCoeff: { 12: a12, 24: a24, 40: a40 }, cubic: [c0, c1, c2, c3] }
 * evaluated as drainTimeCoeff[t] × (c3·i³ + c2·i² + c1·i + c0) with `i` a fraction 0..1.
 *
 * Returns null — never a fallback number — for an absent curve, an unknown imperviousness, or a
 * drain time the record does not publish a coefficient for. */
export function wqcvDepthIn(curve, impFrac, drainTimeHr) {
  if (!curve || !curve.cubic || !curve.drainTimeCoeff) return null;
  if (impFrac == null || !Number.isFinite(impFrac)) return null;
  const a = curve.drainTimeCoeff[String(drainTimeHr)] ?? curve.drainTimeCoeff[drainTimeHr];
  if (a == null || !Number.isFinite(a)) return null;
  const i = Math.min(1, Math.max(0, impFrac));
  const [c0 = 0, c1 = 0, c2 = 0, c3 = 0] = curve.cubic;
  const depth = a * (c3 * i * i * i + c2 * i * i + c1 * i + c0);
  return depth >= 0 ? round4(depth) : 0;
}

/* EURV depth in watershed inches.
 *
 * `curve` is the DATA the memorandum publishes: a power fit per NRCS hydrologic soil group,
 *   { bySoilGroup: { A: {coeff, exp}, B: {coeff, exp}, CD: {coeff, exp} } }
 * evaluated as Σ over groups of fraction_g × coeff_g × i^exp_g, with `i` a fraction 0..1.
 *
 * `hsg` is the soil split as fractions, e.g. { A: 0.25, B: 0.75 } or a single group name "B".
 * Fractions that do not sum to 1 are normalised; an empty/unknown split returns null. Returns null
 * for any missing input — an EURV that silently assumes a soil group is exactly the plausible wrong
 * number this module refuses to produce. */
export function eurvDepthIn(curve, impFrac, hsg) {
  if (!curve || !curve.bySoilGroup) return null;
  if (impFrac == null || !Number.isFinite(impFrac)) return null;
  const split = normalizeHsg(hsg);
  if (!split) return null;
  const i = Math.min(1, Math.max(0, impFrac));
  let depth = 0;
  for (const [group, frac] of Object.entries(split)) {
    const fit = curve.bySoilGroup[group];
    if (!fit || !Number.isFinite(fit.coeff) || !Number.isFinite(fit.exp)) return null; // a missing group is unknown, not zero
    depth += frac * fit.coeff * Math.pow(i, fit.exp);
  }
  return depth >= 0 ? round4(depth) : 0;
}

/* Soil split → normalised fractions keyed the way the memorandum groups them (A · B · CD). C and D
 * are combined because the published fits combine them; passing "C" or "D" resolves to CD. */
export function normalizeHsg(hsg) {
  if (hsg == null) return null;
  if (typeof hsg === "string") {
    const g = hsg.trim().toUpperCase();
    const key = g === "A" ? "A" : g === "B" ? "B" : g === "C" || g === "D" || g === "CD" || g === "C/D" ? "CD" : null;
    return key ? { [key]: 1 } : null;
  }
  if (typeof hsg !== "object") return null;
  const acc = {};
  let total = 0;
  for (const [k, v] of Object.entries(hsg)) {
    const n = Number(v);
    if (!Number.isFinite(n) || n <= 0) continue;
    const g = String(k).trim().toUpperCase();
    const key = g === "A" ? "A" : g === "B" ? "B" : g === "C" || g === "D" || g === "CD" || g === "C/D" ? "CD" : null;
    if (!key) continue;
    acc[key] = (acc[key] || 0) + n;
    total += n;
  }
  if (!total) return null;
  for (const k of Object.keys(acc)) acc[k] = acc[k] / total;
  return acc;
}

// ---------------------------------------------------------------------------
// The calculator.
// ---------------------------------------------------------------------------

/* Evaluate ONE component against the site inputs. Always returns a carrier with a NAMED state —
 * never a bare number and never a silent null:
 *   state "computed"     acFt is a real number
 *         "needs-input"  the curve exists but a site input is missing (says which)
 *         "unavailable"  the curve is not transcribed / the component is not a curve at all
 */
function evalComponent(comp, { acres, impFrac, hsg, drainTimeHr }) {
  const base = {
    id: comp.id,
    label: comp.label,
    short: comp.short,
    role: comp.role,
    required: comp.required !== false,
    depends: comp.depends || [],
    source: comp.source || null,
    acFt: null,
    depthIn: null,
  };

  if (!comp.transcribed || !comp.curve) {
    return {
      ...base,
      state: "unavailable",
      reason: comp.blocked ? comp.blocked.reason : BLOCK_REASONS.SOURCE_UNREACHABLE,
      why: comp.blocked ? comp.blocked.text : UNREACHABLE_TEXT,
      needs: comp.blocked ? comp.blocked.need : null,
      method: comp.method || null,
    };
  }

  // Transcribed: the input side can still be short, and that is a DIFFERENT state with a different
  // cure (enter a test-fit / pick a soil group) than a missing criterion.
  const missing = [];
  if (comp.depends.includes("imperviousness") && impFrac == null) missing.push("imperviousness (enter a test-fit)");
  if (comp.depends.includes("drainTimeHr") && drainTimeHr == null) missing.push("the elected WQCV drain time (12, 24 or 40 hours)");
  if (comp.depends.includes("hydrologicSoilGroup") && !normalizeHsg(hsg)) missing.push("the NRCS hydrologic soil group split");
  if (missing.length) {
    return { ...base, state: "needs-input", reason: BLOCK_REASONS.NEEDS_INPUT, why: `Needs ${missing.join(" and ")}.`, needs: missing.join("; ") };
  }

  const depthIn =
    comp.id === "wqcv" ? wqcvDepthIn(comp.curve, impFrac, drainTimeHr)
    : comp.id === "eurv" ? eurvDepthIn(comp.curve, impFrac, hsg)
    : null;
  if (depthIn == null) {
    // A transcribed curve that still cannot evaluate (e.g. a drain time with no published
    // coefficient) is LOUD, never a zero.
    return {
      ...base,
      state: "unavailable",
      reason: BLOCK_REASONS.SOURCE_UNREACHABLE,
      why: `The ${comp.short} curve is present but does not cover these inputs — no coefficient for this combination.`,
      needs: comp.blocked ? comp.blocked.need : null,
    };
  }
  return { ...base, state: "computed", depthIn, acFt: depthInToAcFt(depthIn, acres) };
}

/* THE MHFD requirement.
 *
 * Returns a carrier in the SAME vocabulary `computeRequiredDetention` uses, so every existing
 * consumer keeps working and no new `kind` has to be wired into the UI (a new kind would fall
 * through every render branch — the exact defect class this session found in the verdict strip):
 *
 *   kind "point"        every required component computed → `requiredAcFt` is the governing total
 *        "unavailable"  at least one required component could not → `requiredAcFt` is null
 *
 * and in BOTH cases `components` carries the per-component detail, so WQCV and EURV are always
 * presented distinctly (B1105 build requirement) whether or not a total exists.
 *
 * `rateAcFtPerAc` is ALWAYS null: a full-spectrum volume has no per-acre rate, and back-computing
 * one to fill the Texas badge would invent a criterion MHFD does not publish.
 */
export function computeMhfdDetention({
  acres = null,
  impPct = null,
  hsg = null,
  drainTimeHr = null,
  county = null,
  onDate = null,
  rule = null,
} = {}) {
  const rec = rule || mhfdRuleFor(onDate);
  if (!rec) {
    return unavailableCarrier(null, [], {
      basis: "no MHFD criteria record effective on this date",
      flags: ["no-criteria-modeled"],
    });
  }
  const p = rec.params || {};

  // Membership is checked POSITIVELY when a county is supplied. A county that is not a member must
  // never receive an MHFD answer, so this refuses rather than falling back.
  if (county != null && !isMhfdCounty(county)) {
    return unavailableCarrier(rec, [], {
      basis: `${slug(county) || "this county"} is not a Mile High Flood District member county`,
      headline: "Detention criteria not yet available in Colorado",
      flags: ["colorado-not-wired", "not-mhfd-member", "no-criteria-modeled"],
    });
  }

  const impFrac = impPct == null || !Number.isFinite(Number(impPct)) ? null : Number(impPct) / 100;
  const elected = electedDrainTimeHr(rec, drainTimeHr);
  const components = (p.components || []).map((c) => evalComponent(c, { acres, impFrac, hsg, drainTimeHr: elected }));

  const requiredComps = components.filter((c) => c.required);
  const allComputed = requiredComps.length > 0 && requiredComps.every((c) => c.state === "computed");

  const drainTime = {
    electedHr: elected,
    optionsHr: wqcvDrainTimeOptions(rec),
    elected: drainTimeHr != null,
    note: (p.components || []).find((c) => c.id === "wqcv")?.drainTimeNote || null,
  };

  if (!allComputed) {
    const blockedShort = requiredComps.filter((c) => c.state !== "computed").map((c) => c.short);
    return unavailableCarrier(rec, components, {
      basis: `${rec.authorityShort} full spectrum detention — ${blockedShort.join(" + ")} not available`,
      headline: "MHFD detention criteria not yet carried in full",
      flags: ["colorado-mhfd", "volume-curve", "components-incomplete"],
      drainTime,
    });
  }

  // Full spectrum stacks in ONE basin: the governing volume is the total of the stacked zones, and
  // the combine rule is carried so a reader can see how it was reached rather than trusting a sum.
  const totalAcFt = round4(requiredComps.reduce((s, c) => s + (c.acFt || 0), 0));
  return {
    kind: "point",
    requiredAcFt: totalAcFt,
    bandAcFt: null,
    rateAcFtPerAc: null, // a full-spectrum volume has NO per-acre rate — never fabricate one
    basis: `${rec.authorityShort} full spectrum detention: ${requiredComps.map((c) => `${c.short} ${c.acFt}`).join(" + ")} AC-FT`,
    panelLine: `${rec.authorityShort} ${MHFD_PANEL_LINE}`,
    verdictSubject: verdictSubjectFor(rec, components),
    components,
    governingTotal: { acFt: totalAcFt, state: "computed", combine: p.combine || "full-spectrum", note: p.combineNote || null },
    drainTime,
    rule: rec,
    governing: null,
    flags: ["colorado-mhfd", "volume-curve"],
    workbook: p.workbook || null,
    municipalOverlay: p.municipalOverlay || null,
    release: p.release || null,
    outlet: p.outlet || null,
    caveat: MHFD_CAVEAT,
  };
}

/* The unavailable carrier — the SAME shape the Texas Colorado guard returns, extended with the
 * component detail. Keeping the shape identical is what lets one render path serve both. */
function unavailableCarrier(rec, components, { basis, headline = null, flags = [], drainTime = null } = {}) {
  const p = (rec && rec.params) || {};
  return {
    kind: "unavailable",
    requiredAcFt: null,
    bandAcFt: null,
    rateAcFtPerAc: null,
    basis,
    headline: headline || "Detention criteria not yet available in Colorado",
    // Only an MHFD answer gets the MHFD line; a refused non-member county keeps the plain guard copy.
    panelLine: rec && !(flags || []).includes("not-mhfd-member") ? `${rec.authorityShort} ${MHFD_PANEL_LINE}` : null,
    verdictSubject: rec && !(flags || []).includes("not-mhfd-member") ? verdictSubjectFor(rec, components) : null,
    components: components || [],
    governingTotal: { acFt: null, state: "unavailable", combine: p.combine || null, note: p.combineNote || null },
    drainTime,
    rule: rec,
    governing: null,
    flags,
    workbook: p.workbook || null,
    municipalOverlay: p.municipalOverlay || null,
    release: p.release || null,
    outlet: p.outlet || null,
    caveat: MHFD_CAVEAT,
  };
}

/* The drain-time options the record publishes. */
export function wqcvDrainTimeOptions(rule = null) {
  const rec = rule || mhfdRuleFor(null);
  const wqcv = ((rec && rec.params && rec.params.components) || []).find((c) => c.id === "wqcv");
  return (wqcv && wqcv.drainTimeOptionsHr) || [];
}

/* The drain time in force: the designer's election when it is one the record publishes, else null.
 * Deliberately NOT defaulted to 40 hours. A silent default would drive both the required volume and
 * the statutory drawdown check off a number nobody chose. */
export function electedDrainTimeHr(rule, drainTimeHr) {
  if (drainTimeHr == null) return null;
  const n = Number(drainTimeHr);
  return wqcvDrainTimeOptions(rule).includes(n) ? n : null;
}

// ---------------------------------------------------------------------------
// C.R.S. 37-92-602(8) reconciliation — where the two Colorado features must AGREE.
// ---------------------------------------------------------------------------

/* Colorado is the one state where drawdown is a LAW, not a readout (`drawdownStatute.js`):
 *
 *     ≥ 97% of a 5-year storm's runoff released within  72 hours
 *     ≥ 99% of runoff from events exceeding the 5-year within 120 hours
 *
 * MHFD's method meanwhile asks the designer to HOLD water on purpose — the WQCV over an elected
 * 12/24/40 hours, and the EURV on a deliberately slow release above it. Those two requirements pull
 * in opposite directions, so a Colorado MHFD site can satisfy its drainage criteria and still be an
 * out-of-priority diversion. This function is what makes the two features agree instead of
 * contradicting each other, which is a B1105 build requirement.
 *
 * ⛔ IT USES THE STATUTE MODULE'S VOCABULARY, NOT ITS OWN: "fail" | "not-ruled-out" | "unknown", and
 * it can never return "pass"/"complies". `drawdownStatute.js` refuses to say "pass" because the
 * screening drawdown is an optimistic lower bound; a second module that said "complies" about the
 * same statute would be a direct contradiction on screen. Asserted in the suite.
 *
 *   drainTimeHr        the elected WQCV drain time (12 | 24 | 40 | null)
 *   statuteAssessment  the `assessStatutoryDrawdown()` result, when one exists (may be null)
 *   rule               the MHFD record (defaults to the current one)
 */
export function reconcileMhfdDrawdown({ drainTimeHr = null, statuteAssessment = null, rule = null } = {}) {
  const rec = rule || mhfdRuleFor(null);
  const elected = electedDrainTimeHr(rec, drainTimeHr);
  // The statute's own limits, read from the statute record when it is supplied so the two features
  // cannot drift apart on the numbers. Falls back to nothing — never to a hardcoded 72.
  const tests = (statuteAssessment && statuteAssessment.statute && statuteAssessment.statute.tests) || [];
  const fiveYr = tests.find((t) => t.id === "five-year") || null;
  const limitHr = fiveYr ? fiveYr.withinHr : null;

  const rows = [];

  // WQCV — the one term Planyr can actually reason about, because the ELECTION is data even though
  // the volume coefficients are not.
  if (elected == null) {
    /* Nothing elected yet. Rather than a bare "pick one" — which would leave the statute question
     * unanswered and require a UI control for a value that drives nothing else today — answer for
     * EVERY option the record publishes. That is a complete answer whichever the engineer picks,
     * and it assumes nothing: a silently defaulted drain time would drive a statutory verdict off a
     * number nobody chose, which is the worse failure. If one option were to breach the limit, this
     * row would say so and name it. */
    const opts = wqcvDrainTimeOptions(rec);
    if (limitHr == null || !opts.length) {
      rows.push({ id: "wqcv", label: "WQCV drain time", verdict: "unknown", electedHr: null, limitHr, options: opts, reason: "The statutory limit is not available to compare against." });
    } else {
      const over = opts.filter((h) => h > limitHr);
      rows.push({
        id: "wqcv",
        label: "WQCV drain time",
        verdict: over.length ? "fail" : "not-ruled-out",
        electedHr: null,
        limitHr,
        options: opts,
        allOptions: true,
        reason: over.length
          ? `A ${over.join("- or ")}-hour WQCV drain time would be past the ${limitHr}-hour statutory limit — elect one of ${opts.filter((h) => h <= limitHr).join(" or ")} hours.`
          : `All ${opts.length} options (${opts.join(", ")} hours) sit inside the ${limitHr}-hour statutory limit, so the water-quality zone does not breach it whichever your engineer elects.`,
      });
    }
  } else if (limitHr == null) {
    rows.push({
      id: "wqcv",
      label: "WQCV drain time",
      verdict: "unknown",
      electedHr: elected,
      limitHr: null,
      reason: "The statutory limit is not available to compare against.",
    });
  } else {
    const over = elected > limitHr;
    rows.push({
      id: "wqcv",
      label: "WQCV drain time",
      verdict: over ? "fail" : "not-ruled-out",
      electedHr: elected,
      limitHr,
      reason: over
        ? `A ${elected}-hour WQCV drain time is past the ${limitHr}-hour statutory limit on its own.`
        : `A ${elected}-hour WQCV drain time sits inside the ${limitHr}-hour statutory limit — the water-quality zone alone does not breach it.`,
    });
  }

  // EURV / full-spectrum release — the term that could genuinely collide with the statute, and the
  // one Planyr cannot yet size. Saying "unknown, and this is the one to check" is the honest answer;
  // reporting the WQCV result as the whole answer would be the contradiction.
  rows.push({
    id: "eurv",
    label: "Full-spectrum (EURV) release",
    verdict: "unknown",
    electedHr: null,
    limitHr,
    reason:
      "The EURV is captured and released slowly above the water-quality zone, and Planyr does not " +
      "carry its release criteria — so the drawdown of the FULL basin is not known here. This is " +
      "the term to check against the statute, not the WQCV election.",
    needs: "USDCM Volume 2, Chapter 12 release rates + the EURV memorandum.",
  });

  // The measured site drawdown, when the statute module has one, is the authority — it beats any
  // reasoning from the elected drain time, and a real failure there governs the headline.
  const measured = statuteAssessment && statuteAssessment.applies ? statuteAssessment.verdict : null;
  const anyFail = rows.some((r) => r.verdict === "fail") || measured === "fail";
  const anyUnknown = rows.some((r) => r.verdict === "unknown") || measured === "unknown" || measured == null;
  const verdict = anyFail ? "fail" : anyUnknown ? "unknown" : "not-ruled-out";

  return {
    applies: true,
    verdict,
    rows,
    measuredVerdict: measured,
    limitHr,
    citation: (statuteAssessment && statuteAssessment.statute && statuteAssessment.statute.citation) || "C.R.S. 37-92-602(8)",
    headline:
      verdict === "fail"
        ? "MHFD sizing conflicts with the Colorado drawdown statute"
        : verdict === "unknown"
          ? "MHFD drawdown vs the statute — not yet checkable"
          : "MHFD drawdown statute not ruled out",
    // The standing caveat, in the statute module's own terms: inside the limit is NOT compliance.
    note:
      "MHFD asks you to hold water; Colorado water law asks you to let it go. A result inside the " +
      "limit means non-compliance is not ruled out — never that the design complies.",
    contradiction: false,
  };
}

/* NEW-1 (B1105) — the panel's "Assumptions & method ▸" notes, composed HERE rather than in
 * `SitePlanner.jsx`, for the same reason as `MHFD_PANEL_LINE` above and then some.
 *
 * Every one of these lines is Colorado prose that can ONLY render once this chunk has landed (the
 * branch that emits them is gated on a flag this module sets), so building them in the planner put
 * their string literals and their formatting logic on the BOOT PATH — where they cost every Texas
 * user bytes to show text they can never see. That breached `bundle.siteRouteJsBytes` by a hair on
 * CI, and the standing rule is that a feature which breaches a budget ships with a matching
 * optimization rather than a raised ceiling. Moving them here IS that optimization, and it is the
 * architecturally correct home regardless: the carrier now describes its own presentation.
 *
 * Returns `[{ key, text }]` for the caller to map straight onto its note primitive — no JSX, no DOM,
 * still pure. WQCV and EURV get one line EACH (B1105's build requirement: never collapsed), and each
 * names the document it is waiting on. */
/* ONE call for everything the panel needs from this module, so the planner holds a single lazy-tier
 * call site instead of three. Each of those three separately repeated the county-resolution
 * expression and its own closure on the BOOT PATH; collapsing them is both simpler and smaller,
 * which is what the site-route bundle budget needed. Returns null for a non-MHFD carrier. */
export function mhfdPanelBag({ carrier = null, county = null, statuteAssessment = null } = {}) {
  if (!carrier || !(carrier.flags || []).includes("colorado-mhfd")) return null;
  const jurisdiction = mhfdJurisdictionNote(county, carrier.rule);
  const drawdown = reconcileMhfdDrawdown({ drainTimeHr: carrier.drainTime ? carrier.drainTime.electedHr : null, statuteAssessment, rule: carrier.rule });
  return { jurisdiction, drawdown, notes: mhfdMethodNotes({ carrier, jurisdiction, drawdown }) };
}

export function mhfdMethodNotes({ carrier = null, jurisdiction = null, drawdown = null } = {}) {
  if (!carrier) return [];
  const out = [];
  const fmt1 = (n) => (n == null ? null : (Math.round(n * 10) / 10).toFixed(1));
  for (const c of carrier.components || []) {
    const value = c.state === "computed" && c.acFt != null
      ? `: ${fmt1(c.acFt)} AC-FT`
      : ` · ${c.state === "needs-input" ? "needs input" : "not carried"}`;
    out.push({
      key: `mhfd-comp-${c.id}`,
      text: `${c.short} — ${String(c.label || "").toLowerCase()}${value}. ${c.why || ""}${c.needs ? ` Needs: ${c.needs}` : ""}`.trim(),
    });
  }
  // The statute reconciliation — the one place the two Colorado features must AGREE rather than
  // contradict. It borrows the statute module's vocabulary, so it can never read "complies".
  if (drawdown) {
    out.push({
      key: "mhfd-statute",
      text: `${drawdown.citation}: ${(drawdown.rows || []).map((r) => `${r.label} — ${r.reason}`).join(" ")} ${drawdown.note}`,
    });
  }
  // The audit answer: being inside the district is NOT the same as knowing the final rule.
  if (jurisdiction && jurisdiction.text) out.push({ key: "mhfd-overlay", text: jurisdiction.text });
  if (carrier.workbook) out.push({ key: "mhfd-workbook", text: [carrier.workbook.note, carrier.workbook.source && carrier.workbook.source.name].filter(Boolean).join(" — ") });
  // Release rate and outlet configuration named as NOT carried, so Planyr's own Texas outlet model
  // is never quietly applied to a full-spectrum basin.
  if (carrier.release && !carrier.release.transcribed) out.push({ key: "mhfd-release", text: carrier.release.note });
  if (carrier.outlet && !carrier.outlet.transcribed) out.push({ key: "mhfd-outlet", text: carrier.outlet.note });
  if (carrier.rule && carrier.rule.provenanceNote) out.push({ key: "mhfd-provenance", text: carrier.rule.provenanceNote });
  return out.filter((n) => n.text);
}

/* The audit answer B1105 asked for, as data rather than prose in a commit message: being inside the
 * district does NOT settle whose criteria are final. Exposed so a surface can render the caveat
 * without re-deriving it, and so the suite can assert an MHFD answer never claims finality. */
export function mhfdJurisdictionNote(county = null, rule = null) {
  const rec = rule || mhfdRuleFor(null);
  const mo = (rec && rec.params && rec.params.municipalOverlay) || null;
  const s = slug(county);
  const ownManual = mo && (mo.knownOwnManual || []).includes(s);
  return {
    district: rec ? rec.authorityLabel : null,
    county: s || null,
    // The district manual is the FLOOR a member adopts, never provably the last word.
    districtIsFinal: false,
    cityOverlayMayApply: true,
    knownOwnManual: !!ownManual,
    text: ownManual
      ? "This county publishes its own combined storm-drainage manual on top of the district's — confirm which criteria govern with the reviewing jurisdiction."
      : "The district's manual is what member jurisdictions adopt, but the city or county is the permitting authority and may add stricter local criteria — confirm before sizing.",
    source: mo ? mo.source || null : null,
  };
}
