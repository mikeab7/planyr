/* NEW-1 (B1057 completion) — the LIVE WIRING of the screening-BFE engine: the layer that turns a
 * real site (its terrain grid, its footprint, its rainfall) into the four inputs
 * `screeningBfe.js` needs, and runs it for BOTH storms the Waller ordinance requires.
 *
 * ─── WHY BOTH STORMS, AND WHY ATLAS 14 IS NOT A CHOICE HERE ──────────────────────────────────
 * Waller County Flood Damage Prevention Ordinance §5.C(3) (eff. 2013-02-28), verbatim:
 *
 *     "Base flood elevation and 500-year floodplain elevation data shall be generated utilizing
 *      Atlas 14 for subdivision proposals and other proposed development including the placement
 *      of manufactured home parks and subdivisions which is greater than 50 lots or 5 acres,
 *      whichever is lesser, if not otherwise provided"
 *
 * Three things follow, and this module honours all three:
 *   1. ATLAS 14 IS MANDATED. The rainfall driving the hydrology comes from NOAA Atlas 14 (PFDS),
 *      the same source `detentionRules` design storms already use — so the screening flood level
 *      and the detention numbers on the same panel cannot be driven by different rainfall. A
 *      regional-regression discharge would be a CROSS-CHECK only, never the answer in Waller.
 *   2. THE 500-YEAR IS ALSO REQUIRED. Both the 1% (100-yr) and the 0.2% (500-yr) elevations are
 *      produced from ONE derivation, so the app's "BFE (1% WSE)" and "0.2% (500-yr) WSE" fields
 *      can never disagree about method, section, slope or watershed.
 *   3. THE THRESHOLD FIRES ON THE SITE. `floodplainRules.bfeDataRequirementFor` + the engine's
 *      `bfeDataLikelyRequired` decide whether the >50-lot / >5-acre trigger bites here.
 *
 * ─── THE FOUR INPUTS AND WHERE EACH NOW COMES FROM ───────────────────────────────────────────
 *   watershed  → upstreamArea.js D8 flow-accumulation + delineation over the 3DEP DEM grid
 *   rainfall   → pfdsClient.resolvePfds (NOAA Atlas 14, via the /api/pfds same-origin proxy)
 *   section    → channelSection.cutSection over that SAME DEM grid (no second terrain path)
 *   soils (CN) → soils.resolveSoils (SSURGO HSG) — and when SSURGO can't be reached, the result
 *                is an explicit UNKNOWN naming the missing input, never a guessed curve number.
 *
 * LOUD-FAILURE is the whole point of this file. Every stage that can fail returns a named missing
 * input, and `screeningBfeForSite` returns `{ ok:false, missing:[…] }` rather than any elevation
 * it did not compute. There is no default rainfall, no default soil group, no assumed channel.
 *
 * Pure — no DOM, no network. The caller performs the fetches and injects their results. */
import { screeningBfe, NOT_MODELED, CLOMR_NOTE, SCREENING_DISCLAIMER } from "./screeningBfe.js";
import { flowAccumulation, contributingAcres } from "./upstreamArea.js";
import { channelCell, flowBearing, channelSlope, cutSection, gridCellFt, siteMaskFromLatLngRings, upstreamEdgeFlags } from "./channelSection.js";
import { computeTimeOfConcentration } from "./timeOfConcentration.js";
import { designStormDepthIn } from "./pfdsClient.js";

/* The storms this module derives. The ordinance names both; the app has a field for both. */
export const SCREENING_STORMS = [
  { key: "wse1pct", returnPeriodYr: 100, label: "1% (100-yr)" },
  { key: "wse02pct", returnPeriodYr: 500, label: "0.2% (500-yr)" },
];

/* Manning's n for the composite (channel + overbank) screening section. A real study surveys and
 * calibrates roughness per subsection; a single composite value is the screening floor, and it is
 * named in NOT_MODELED. Deliberately the engine's own channel default so there is one number. */
export const SECTION_HALF_WIDTH_FT = 500;

/* The WIDE, COARSE terrain request the watershed is delineated over (see the two-extents note
 * below). Zoom 12 gives roughly 200-ft ground cells through the same `gridRequest` snapping the
 * site DEM uses, and the pad reaches far enough either side of the site to contain a site-scale
 * basin's divides — while staying well inside demGrid's MAX_GRID ceiling. Coarse on purpose:
 * delineation wants REACH, the cross-section wants RESOLUTION, and they are fetched separately. */
export const WATERSHED_GRID_ZOOM = 12;
export const WATERSHED_PAD_DEG = 0.09; // ~6 miles each way — a ~12 × 12-mile delineation window

/* ─── WHY TWO GRID EXTENTS, AND WHY THAT IS STILL ONE TERRAIN PATH ───────────────────────────
 * The section and the watershed want opposite things from the same 3DEP data.
 *
 *   • THE SECTION needs RESOLUTION. The site DEM the drainage check already fetches is ~3 m
 *     cells over the site envelope — right for a channel cross-section, where a few feet of bank
 *     shape moves the answer.
 *   • THE WATERSHED needs REACH. A creek crossing a 64-acre tract drains land for miles upstream.
 *     Accumulating flow over the SITE envelope alone would return the handful of acres inside the
 *     fetched window and hand back a confidently understated discharge — worse than no number.
 *     So the watershed is delineated over a WIDE, COARSE request through the SAME `fetchSiteGrid`
 *     / `demGrid` sampler: same service, same decoder, same units, a different extent.
 *
 * And when even the wide window is not enough — some border cell still drains through the channel
 * crossing — the delineated area is a LOWER BOUND, and `upstreamEdgeFlags` catches it. That case
 * returns an explicit UNKNOWN naming the truncation rather than an elevation computed from a
 * fraction of the real basin. A basin that big is a sealed-study problem, not a screening one.
 *
 * `sectionGrid`/`sectionReq` — the fine site DEM (`floodGeo.demGrid`).
 * `watershedGrid`/`watershedReq` — the wide coarse DEM; omit and the fine grid is used for both,
 *   which will normally trip the truncation guard and say so.
 * `siteRingsLatLng` — the site footprint as [[ [lat,lng], … ], …].
 *
 * Returns { ok:true, areaAcres, station, slopeFtPerFt, channel:{…}, section:{…}, watershed:{…} }
 * or { ok:false, missing:[…] } — one named entry per input that could not be derived. Pure. */
export function terrainInputsForScreeningBfe({
  sectionGrid = null, sectionReq = null,
  watershedGrid = null, watershedReq = null,
  siteRingsLatLng = null, lat = null,
  halfWidthFt = SECTION_HALF_WIDTH_FT, sectionSamples = 81,
} = {}) {
  const usable = (g) => !!(g && g.values && g.mask && g.width > 0 && g.height > 0);
  if (!usable(sectionGrid) || !sectionReq) {
    return { ok: false, missing: ["bare-earth terrain grid (the drainage check's 3DEP DEM did not load)"] };
  }
  const secCellFt = gridCellFt(sectionReq, lat);
  if (!(secCellFt > 0)) return { ok: false, missing: ["terrain grid cell size"] };

  const missing = [];
  const sec = { values: sectionGrid.values, mask: sectionGrid.mask, width: sectionGrid.width, height: sectionGrid.height, cellFt: secCellFt };

  // ── WHERE the channel crosses the site (fine grid, so the section is cut in the right place).
  const secAcc = flowAccumulation(sec);
  const secSiteMask = siteMaskFromLatLngRings(sectionReq, siteRingsLatLng, sec.width, sec.height);
  const cell = channelCell({ acc: secAcc, mask: sec.mask, width: sec.width, height: sec.height }, secSiteMask);
  if (cell < 0) {
    return { ok: false, missing: ["a channel crossing on this site (no drainable cell inside the footprint)"] };
  }

  // ── THE WATERSHED, the longitudinal slope, AND THE FLOW BEARING: the wide grid where one was
  // fetched. All three are REACH-SCALE properties, and this ordering is not cosmetic — it is the
  // fix for a defect a real-data run caught (`ui-audit/verify-screening-bfe-live.mjs` at a Waller
  // point): taking the bearing from the FINE grid returned null outright, because on flat
  // Gulf-Coast ground an ~8-ft LiDAR cell is very often a D8 pit with no downhill neighbour at all.
  // That is the same lesson `flowField.js` already records in its header — "raw per-cell D8 at
  // sparse sample points reads as random on near-flat Houston terrain" — and the same reason a
  // channel GRADE measured over a few hundred feet of fine LiDAR is mostly noise. So the direction
  // the water runs is read at reach scale and the SECTION is then cut on the fine grid at the
  // site's own crossing, which is the only thing the fine grid is actually better at.
  const wideOk = !!(usable(watershedGrid) && watershedReq);
  const wReq = wideOk ? watershedReq : sectionReq;
  const wSrc = wideOk ? watershedGrid : sectionGrid;
  const wCellFt = gridCellFt(wReq, lat);
  const wide = { values: wSrc.values, mask: wSrc.mask, width: wSrc.width, height: wSrc.height, cellFt: wCellFt };

  let areaAcres = null, truncated = false, wCell = -1, slope = null, bearing = null;
  if (!(wCellFt > 0)) {
    missing.push("watershed grid cell size");
  } else {
    const wAcc = flowAccumulation(wide);
    const wSiteMask = siteMaskFromLatLngRings(wReq, siteRingsLatLng, wide.width, wide.height);
    wCell = channelCell({ acc: wAcc, mask: wide.mask, width: wide.width, height: wide.height }, wSiteMask);
    if (wCell < 0) {
      missing.push("the site footprint does not fall on the watershed terrain grid");
    } else {
      areaAcres = contributingAcres(wAcc, wCell, wCellFt);
      truncated = !!upstreamEdgeFlags(wide)[wCell];
      slope = channelSlope(wide, wCell);
      // Both grids are Web Mercator with x→east and y→south, so a unit bearing transfers between
      // them unchanged. Fall back to the fine grid only if the reach itself yields no direction.
      bearing = flowBearing(wide, wCell) || flowBearing(sec, cell);
      if (!(areaAcres > 0)) missing.push("contributing watershed area (no delineable basin from the terrain grid)");
      if (truncated) {
        missing.push(
          "the contributing watershed runs past the edge of the available terrain window — the delineated area is a LOWER BOUND, so no honest flood elevation can be derived from it here"
        );
      }
      if (!slope) missing.push("channel slope (the reach falls no measurable amount over the sampled run)");
    }
  }
  if (!bearing) missing.push("channel flow direction (the terrain reads flat or void at the crossing)");

  // ── THE SECTION: cut on the FINE grid, at the site's own crossing, across the reach bearing.
  const section = bearing ? cutSection(sectionGrid, sectionReq, cell, bearing, { halfWidthFt, samples: sectionSamples, cellFt: secCellFt, lat }) : null;
  if (bearing && (!section || !section.ok)) missing.push(section && section.reason ? section.reason : "ground cross-section across the channel");

  if (missing.length) {
    return { ok: false, missing, channelCell: cell, areaAcres: areaAcres > 0 ? Math.round(areaAcres * 100) / 100 : null, watershedTruncated: truncated };
  }

  return {
    ok: true,
    areaAcres: Math.round(areaAcres * 100) / 100,
    station: section.station,
    slopeFtPerFt: slope.slopeFtPerFt,
    channel: { cell, cellFt: Math.round(secCellFt * 100) / 100, bearing, slope },
    section: { bedFt: section.bedFt, sectionTopFt: section.sectionTopFt, reliefFt: section.reliefFt, halfWidthFt: section.halfWidthFt, voidCount: section.voidCount, samples: section.station.length },
    watershed: {
      cell: wCell,
      cellFt: Math.round(wCellFt * 100) / 100,
      wideGrid: wideOk,
      truncated: false,
      runFt: Math.round(slope.runFt),
    },
  };
}

/* ─── STAGE 2: the rainfall pair, straight off the Atlas 14 table ─────────────────────────────
 * `pfdsTable` is `resolvePfds(...).table`. Returns { in1pct, in02pct, missing:[…] }. A depth the
 * table doesn't carry is reported missing, never substituted. Pure. */
export function atlas14Depths(pfdsTable, { durationLabel = "24-hr" } = {}) {
  const missing = [];
  const in1pct = pfdsTable ? designStormDepthIn(pfdsTable, 100, durationLabel) : null;
  const in02pct = pfdsTable ? designStormDepthIn(pfdsTable, 500, durationLabel) : null;
  if (!(in1pct > 0)) missing.push("100-year rainfall depth (NOAA Atlas 14)");
  if (!(in02pct > 0)) missing.push("500-year rainfall depth (NOAA Atlas 14) — required by Waller §5.C(3) alongside the base flood elevation");
  return { in1pct: in1pct > 0 ? in1pct : null, in02pct: in02pct > 0 ? in02pct : null, missing };
}

/* ─── THE COMPOSED, LIVE-INPUT SCREENING BFE ─────────────────────────────────────────────────
 * Runs `screeningBfe` once per storm over ONE set of derived inputs, so the 1% and the 0.2%
 * elevations share a watershed, a section, a slope and a curve number by construction.
 *
 * Returns
 *   { ok:true, storms:{ wse1pct:{…}, wse02pct:{…} }, wse1pctFt, wse02pctFt, inputs, notModeled,
 *     clomrNote, atlas14:true, screening:true }
 * or { ok:false, missing:[…], notModeled, clomrNote } — an explicit unknown naming every input it
 * lacks. A storm that fails its own hydraulics (e.g. the flow overtops the sampled section) is
 * carried as that storm's `{ ok:false, reason }`, not hidden and not extrapolated. Pure. */
export function screeningBfeForSite({
  terrain = null,               // terrainInputsForScreeningBfe(...) result
  rainfall = null,              // atlas14Depths(...) result
  hsg = null, cn = null, impPct = 0, cover = "openSpaceGood",
  manningN = undefined, tcMin = null,
} = {}) {
  const missing = [];
  if (!terrain || !terrain.ok) missing.push(...((terrain && terrain.missing) || ["terrain inputs"]));
  if (!rainfall || rainfall.missing?.length) missing.push(...((rainfall && rainfall.missing) || ["NOAA Atlas 14 rainfall"]));
  if (cn == null && !hsg) missing.push("soil hydrologic group (SSURGO) — needed for the runoff curve number");
  if (missing.length) return { ok: false, missing, notModeled: NOT_MODELED, clomrNote: CLOMR_NOTE, screening: true };

  // Time of concentration: the SAME engine the detention side uses, over the delineated basin and
  // the measured channel grade — so the two readouts on one panel share their Tc convention.
  const slopePct = terrain.slopeFtPerFt * 100;
  const tc = Number.isFinite(tcMin) && tcMin > 0
    ? { tcMin, source: "caller" }
    : computeTimeOfConcentration({ areaAcres: terrain.areaAcres, impPct, slopePct });
  const tcVal = tc && Number.isFinite(tc.tcMin) ? tc.tcMin : null;
  if (!(tcVal > 0)) {
    return { ok: false, missing: ["time of concentration"], notModeled: NOT_MODELED, clomrNote: CLOMR_NOTE, screening: true };
  }

  const common = {
    areaAcres: terrain.areaAcres, cn, hsg, impPct, cover, tcMin: tcVal,
    station: terrain.station, slopeFtPerFt: terrain.slopeFtPerFt,
    ...(manningN != null ? { manningN } : {}),
  };
  const storms = {};
  for (const s of SCREENING_STORMS) {
    const rainfallIn = s.returnPeriodYr === 100 ? rainfall.in1pct : rainfall.in02pct;
    storms[s.key] = { ...screeningBfe({ ...common, rainfallIn, returnPeriodYr: s.returnPeriodYr }), label: s.label, returnPeriodYr: s.returnPeriodYr, rainfallIn };
  }

  const anyOk = SCREENING_STORMS.some((s) => storms[s.key].ok);
  if (!anyOk) {
    // Both storms failed for the same physical reason (an overtopped section is the common one) —
    // surface it as the honest reason rather than a fabricated elevation.
    const first = storms.wse1pct;
    return {
      ok: false,
      stage: first.stage || "hydraulics",
      reason: first.reason || null,
      missing: first.missing || null,
      overtops: !!first.overtops,
      storms,
      notModeled: NOT_MODELED, clomrNote: CLOMR_NOTE, screening: true,
    };
  }

  return {
    ok: true,
    screening: true,
    atlas14: true,
    wse1pctFt: storms.wse1pct.ok ? storms.wse1pct.wseFt : null,
    wse02pctFt: storms.wse02pct.ok ? storms.wse02pct.wseFt : null,
    band1pctFt: storms.wse1pct.ok ? storms.wse1pct.bandFt : null,
    band02pctFt: storms.wse02pct.ok ? storms.wse02pct.bandFt : null,
    storms,
    inputs: {
      areaAcres: terrain.areaAcres,
      slopeFtPerFt: terrain.slopeFtPerFt,
      tcMin: Math.round(tcVal * 10) / 10,
      hsg: hsg || null,
      cn: cn ?? null,
      impPct,
      rainfall1pctIn: rainfall.in1pct,
      rainfall02pctIn: rainfall.in02pct,
      section: terrain.section,
    },
    notModeled: NOT_MODELED,
    clomrNote: CLOMR_NOTE,
  };
}

/* The one-line plain-English summary for the panel — VERDICT + NUMBER, nothing else (PANEL-BREVITY:
 * method, inputs and the uncertainty band belong behind the fold). `femaFt` is whatever value the
 * app is otherwise governing by, so the delta is the headline. Pure. */
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

/* The BEHIND-THE-FOLD note for the screening study: method, live inputs, the uncertainty RANGE and
 * what is NOT modelled — or, when it could not run, the named missing inputs. This is the text the
 * panel hangs on a hover / disclosure, which is why it may be long where the visible line may not
 * (PANEL-BREVITY: honesty stays REACHABLE, brevity applies to the DEFAULT VIEW). Returns "" when
 * there is nothing to say, so a caller can concatenate it unconditionally. Pure. */
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

export default screeningBfeForSite;
