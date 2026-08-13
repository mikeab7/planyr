/* NEW-1 — THE SCREENING STUDY'S WORDS AND CONSTANTS, split out so the ENGINE can leave the boot
 * path. Read this header before "tidying" any of it back into `screeningBfe.js` or
 * `screeningBfeSite.js`.
 *
 * ─── WHY THIS FILE EXISTS ────────────────────────────────────────────────────────────────────
 * The screening-BFE engine (`screeningBfe.js` + `screeningBfeSite.js` + `upstreamArea.js` +
 * `channelSection.js`) is the app's only real hydrology + hydraulics derivation, and it runs in
 * exactly ONE place: inside `checkDrainage`'s async block, gated on an unstudied Zone A site with
 * no published or manual 1% surface. That is a rare branch behind an explicit user action — and
 * yet every byte of the engine rode the Site route's boot bundle on every load, for every site,
 * because a handful of CONSTANTS and three pure COPY functions were exported from the same
 * modules and are needed by the render body.
 *
 * A static import of one export pulls the whole module (tree-shaking drops unused exports, never
 * exports a sibling still uses), so the render body's need for `screeningBfeHeadline` was enough
 * to hoist the entire engine onto the critical path. Splitting the leaf out is what lets
 * `SitePlanner.jsx` keep the words statically and reach the MATH through a dynamic `import()`.
 *
 * This is the same shape as `terrainGate.js` / `terrainLazy.js` and `titleKey.js` /
 * `titleReader.js` already use in this folder, and for the same reason.
 *
 * ⛔ THE RULE: nothing in this file may import the engine, or anything that imports the engine.
 * It is a LEAF — pure strings, numbers, and arithmetic over an already-computed result object. The
 * moment it gains an edge back into `screeningBfe.js`, the engine is on the boot path again and
 * the split silently buys nothing (the bundle audit in the ui-audit folder is what notices).
 *
 * The result objects these functions read are produced by the engine, but reading a plain object
 * needs no code from the module that built it — which is precisely why this split is possible. */

/* What a screening estimate does NOT do. Returned with every result so a call site cannot quietly
 * present the number without them. Owner brief: "Name what is NOT modeled, explicitly and visibly." */
export const NOT_MODELED = [
  "no field survey — the channel shape is sampled from public terrain data, not surveyed",
  "no bridges or culverts — a constriction raises the real water surface, sometimes by feet",
  "no ineffective-flow areas — every part of the section is assumed to carry water",
  "no floodway encroachment analysis",
  "no stream-gauge calibration",
  "steady uniform flow (normal depth), not a backwater profile",
];

/* B1089 — the ONE wording of the screening disclaimer. It was written out independently in
 * `screeningBfeSite.screeningStudyNote` and in `floodplainMitigation.EST_SCREENING_BFE_NOTE`, so the
 * same sentence shipped three times. Composing from here is PANEL-BREVITY rule 5 (state a fact once)
 * doing double duty as a bundle optimization — and it means the disclaimer can never drift between
 * the two surfaces that show it. */
export const SCREENING_DISCLAIMER =
  "SCREENING ONLY — not engineering-grade and not a substitute for a sealed engineer's study.";

/* The regulatory pathway a developer-derived BFE runs through when it changes the mapped
 * floodplain. Reused verbatim from the B710 lineage rather than forked — one sentence, one home. */
export const CLOMR_NOTE =
  "A developer-derived flood elevation that changes the mapped floodplain goes to FEMA as a CLOMR before construction and a LOMR after it, on a sealed engineer's study.";

/* The storms this module derives. The ordinance names both; the app has a field for both. */
export const SCREENING_STORMS = [
  { key: "wse1pct", returnPeriodYr: 100, label: "1% (100-yr)" },
  { key: "wse02pct", returnPeriodYr: 500, label: "0.2% (500-yr)" },
];

/* Manning's n for the composite (channel + overbank) screening section. A real study surveys and
 * calibrates roughness per subsection; a single composite value is the screening floor, and it is
 * named in NOT_MODELED. Deliberately the engine's own channel default so there is one number. */
export const SECTION_HALF_WIDTH_FT = 500;

/* The WIDE, COARSE terrain request the watershed is delineated over. Zoom 12 gives roughly 200-ft
 * ground cells through the same `gridRequest` snapping the site DEM uses, and the pad reaches far
 * enough either side of the site to contain a site-scale basin's divides — while staying well
 * inside demGrid's MAX_GRID ceiling. Coarse on purpose: delineation wants REACH, the cross-section
 * wants RESOLUTION, and they are fetched separately.
 *
 * ⛔ These two live HERE, not beside the engine, because `SitePlanner.jsx` builds the wide bounds
 * BEFORE it awaits the engine — it needs the numbers on the boot path to issue the terrain fetch
 * that the engine then consumes. Moving them back into `screeningBfeSite.js` re-hoists the engine. */
export const WATERSHED_GRID_ZOOM = 12;
export const WATERSHED_PAD_DEG = 0.09; // ~6 miles each way — a ~12 × 12-mile delineation window

/* The NFIP minimum standard that makes a development submit base flood elevation data, and the
 * pure test for whether it bites on this site.
 *
 * ⛔ These live in the LEAF, not beside the engine, for the same reason as everything else here:
 * `SitePlanner.jsx`'s render body calls `bfeDataLikelyRequired` on every render, and while it was
 * exported from `screeningBfe.js` that one call kept the whole engine on the boot path. It answers
 * a THRESHOLD question about acres and lots — it runs no hydrology and needs none. */
export const BFE_DATA_REQUIREMENT = {
  citation: "44 CFR 60.3(b)(3)",
  url: "https://www.ecfr.gov/current/title-44/chapter-I/subchapter-B/part-60/subpart-A/section-60.3",
  lotsThreshold: 50,
  acresThreshold: 5,
  verified: false, // the CFR text is quoted; whether THIS county adopted it verbatim is not
  quote:
    "all new subdivision proposals and other proposed developments (including proposals for manufactured home parks and subdivisions) greater than 50 lots or 5 acres, whichever is the lesser, include within such proposals base flood elevation data",
  plain:
    "In an approximate A zone with no published flood elevation, the NFIP minimum standard most communities adopt makes a development over 50 lots or 5 acres (whichever is smaller) submit base flood elevation data with the proposal. Confirm the exact wording in this county's own floodplain ordinance.",
};

export function bfeDataLikelyRequired({ acres = null, lots = null, inApproximateAZone = false, requirement = null } = {}) {
  if (!inApproximateAZone) return null;
  const rec = requirement || BFE_DATA_REQUIREMENT;
  const a = Number.isFinite(acres) ? acres : null;
  const l = Number.isFinite(lots) ? lots : null;
  if (a == null && l == null) return null;
  const acresThreshold = Number.isFinite(rec.acresThreshold) ? rec.acresThreshold : BFE_DATA_REQUIREMENT.acresThreshold;
  const lotsThreshold = Number.isFinite(rec.lotsThreshold) ? rec.lotsThreshold : BFE_DATA_REQUIREMENT.lotsThreshold;
  const overAcres = a != null && a > acresThreshold;
  const overLots = l != null && l > lotsThreshold;
  if (!overAcres && !overLots) return null;
  return {
    likely: true,
    by: overAcres && overLots ? "both" : overAcres ? "acres" : "lots",
    // The measured value that tripped it, so the panel can say WHY without recomputing.
    acres: a, lots: l,
    jurisdictional: !!requirement,
    ...rec,
  };
}

/* The visible one-line verdict. Reads an already-computed result object; computes nothing. */
export function screeningBfeHeadline(result, femaFt = null) {
  if (!result) return null;
  if (!result.ok) {
    const why = result.missing?.length ? result.missing[0] : (result.reason || "inputs incomplete");
    return { known: false, text: `Screening flood level unavailable — ${why}.` };
  }
  const v = result.wse1pctFt;
  if (v == null) return { known: false, text: "Screening flood level unavailable — the 1% flow overtops the sampled section." };
  const d = Number.isFinite(femaFt) ? Math.round((v - femaFt) * 10) / 10 : null;
  return {
    known: true,
    wse1pctFt: v,
    wse02pctFt: result.wse02pctFt,
    deltaFt: d,
    text: d == null
      ? `Screening 1% ≈ ${v.toFixed(1)}′`
      : `Screening 1% ≈ ${v.toFixed(1)}′ · ${d >= 0 ? "+" : ""}${d.toFixed(1)}′ vs ${femaFt.toFixed(1)}′`,
  };
}

/* NEW-1 (B1089) — THE DECLINE STATE, as a NAMED STATE plus a reason-specific implication.
 *
 * Why this exists: the honest UNKNOWN this engine returns was only reachable through the hover on
 * the accept-gated estimate row, and that row renders ONLY when no elevation has been committed. On
 * the one site that motivated the whole feature — Tsakiris, which already carries a committed
 * grade-derived estimate — the study ran, declined, and said NOTHING. Same defect class as B1036's
 * silent zero: the app knowing something and not saying it. It lands hardest exactly where it
 * matters most, because the terrain that defeats a screening method is the terrain that most needs
 * a sealed study.
 *
 * PANEL-BREVITY: `state` is a SHORT named state for the visible line (rule 3 — a named state beats
 * a sentence explaining the state); `detail` is the behind-the-fold reason + implication.
 *
 * THE IMPLICATION IS REASON-SPECIFIC ON PURPOSE. "Flat ground with no defined channel" genuinely
 * means screening methods have run out and an engineer's H&H model is required — and on a Waller
 * site that is the SAME sealed Atlas-14 study §5.C(3) already demands, so the two are connected
 * rather than left for the reader to join up. An unreachable data source means nothing of the kind;
 * it means try again. Asserting "you need an engineer" for a network timeout would be a lie.
 *
 * The sentences are COMPOSED from the shared fragments below rather than written out per branch —
 * each phrase ships in the bundle ONCE. That is also PANEL-BREVITY rule 5 (state a fact once) doing
 * double duty as a bundle optimization: B1089 first landed 0.2 KB over `largestChunkBytes`, and the
 * budget is met by de-duplicating the copy, never by dropping a fact. */
const D_TRIED = "Planyr's screening study was attempted here and";
const D_STANDS = "No elevation was derived from it, so any flood level shown above rests on its original source, unchallenged.";
const D_SEALED = "A sealed engineering (H&H / Atlas-14) study is what settles the value.";

export function screeningDeclined(result) {
  if (!result || result.ok) return null;
  const why = (result.missing?.length ? result.missing : [result.reason || "inputs incomplete"]).join("; ");
  const has = (re) => re.test(why);
  const mk = (reason, state, body) => ({ reason, state, detail: `${body} (${why}.)` });

  // Ordered most-specific first: a truncated watershed and a flat reach are different diagnoses.
  if (has(/could not run:/i)) {
    // Deliberately NOT the sealed-study implication: an outage is not a finding about the site.
    return mk("unreachable", "data sources unreachable",
      `${D_TRIED} could not run at all — a data-availability problem, not a finding about this site. Press ↻ Re-check to try again. ${D_STANDS}`);
  }
  if (has(/runs past the edge/i)) {
    return mk("watershed-truncated", "watershed larger than the terrain window",
      `${D_TRIED} DECLINED: the land draining to this reach runs past the edge of the available terrain window, so the contributing area it could measure is only a LOWER BOUND — a flood level derived from it would be understated, which is worse than no number. ${D_STANDS} ${D_SEALED}`);
  }
  if (has(/flat|no measurable amount|flow direction/i)) {
    return mk("flat-reach", "flat reach, no defined channel",
      `${D_TRIED} DECLINED: the ground across this reach falls no measurable amount over the sampled run and no channel direction can be determined. That is the honest limit of the method, not a data outage. TERRAIN LIKE THIS IS EXACTLY WHERE SCREENING RUNS OUT AND AN ENGINEER'S SEALED H&H MODEL IS REQUIRED — and where Waller County applies that is the same Atlas-14 study §5.C(3) already demands with the submittal, so it is one piece of work, not two. ${D_STANDS}`);
  }
  return mk("inputs-missing", "inputs unavailable", `${D_TRIED} could not answer. ${D_STANDS} ${D_SEALED}`);
}

/* The BEHIND-THE-FOLD note for the screening study: method, live inputs, the uncertainty RANGE and
 * what is NOT modelled — or, when it could not run, the named missing inputs. This is the text the
 * panel hangs on a hover / disclosure, which is why it may be long where the visible line may not
 * (PANEL-BREVITY: honesty stays REACHABLE, brevity applies to the DEFAULT VIEW). Returns "" when
 * there is nothing to say, so a caller can concatenate it unconditionally. Pure. */
export function screeningStudyNote(result) {
  if (!result) return "";
  // B1089 — DELEGATE. The decline wording has exactly one home (screeningDeclined); a second copy
  // here would be the same fact stated twice, in the bundle and on the screen.
  if (!result.ok) return ` ${screeningDeclined(result).detail}`;
  const band = result.band1pctFt || {};
  const rangeTxt = band.loFt != null && band.hiFt != null && band.hiFt > band.loFt
    ? `${band.loFt.toFixed(1)}′–${band.hiFt.toFixed(1)}′`
    : band.openEnded ? "open-ended (one end of the range overtops the sampled section)" : "no spread at this section";
  const i = result.inputs || {};
  return ` PLANYR SCREENING STUDY (Atlas 14): 1% ≈ ${result.wse1pctFt?.toFixed(1)}′, 0.2% (500-yr) ≈ ${result.wse02pctFt != null ? `${result.wse02pctFt.toFixed(1)}′` : "not solvable at this section"}; RANGE on the 1% ${rangeTxt} — read the range, not the midpoint. Inputs: a ${i.areaAcres} ac contributing watershed delineated from USGS 3DEP terrain, NOAA Atlas 14 rainfall (${i.rainfall1pctIn}″ / ${i.rainfall02pctIn}″ over 24 hr), SSURGO soil group ${i.hsg || "—"}, time of concentration ${i.tcMin} min, channel grade ${(i.slopeFtPerFt * 100).toFixed(2)}%, and a cross-section sampled from that same terrain. ${result.notModeled.map((n) => n.charAt(0).toUpperCase() + n.slice(1)).join(". ")}. ${result.clomrNote} ${SCREENING_DISCLAIMER}`;
}
