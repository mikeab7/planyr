/* NEW-3 — an INDEPENDENT SCREENING ESTIMATE of the base flood elevation, to sit beside FEMA's.
 *
 * ─── AUDIT-FIRST: what this codebase already did, and why this is not it ──────────────────────
 * The Bain BFE field's "derived (cross-sections)" tag (B856 lineage) is REAL but it is a DATA
 * READ, not a derivation:
 *   • crossSectionWselFromFeatureCollection() reads FEMA's own `WSEL_REG` attribute off the S_XS
 *     regulatory cross-section layer, and governingCrossSectionWsel() picks the nearest one;
 *   • deriveBfeFromLines() interpolates between FEMA's published S_BFE contour lines;
 *   • estimateZoneAWse() samples EXISTING GROUND along the Zone A boundary and takes a statistic —
 *     a topographic proxy for a water surface, with no flow in it at all. (That is the number
 *     carrying Tsakiris's entire mitigation obligation, sitting about a quarter foot above grade.)
 * So the app had NO hydrology and NO hydraulics. Every "derived" WSE in it is FEMA's number
 * surfaced from a different layer, or a ground-elevation proxy. This module is therefore genuinely
 * new engine work; what it REUSES is the presentation side — the multi-source WSE picker, the
 * provider labels, the data-age chips — so the two answers can stand side by side.
 *
 * ─── What an engineer does, and which half of it this is ─────────────────────────────────────
 * A civil engineer determining a flood level runs (1) HYDROLOGY — how much water arrives — then
 * (2) HYDRAULICS — how deep it stands in this channel. This does both, at SCREENING fidelity:
 *
 *   HYDROLOGY: the NRCS/SCS dimensionless unit hydrograph peak,
 *        Qp = PRF · A · Q / Tp,     Tp = 0.5·D + 0.6·Tc,   D ≈ 0.133·Tc
 *   with A in square miles, Q the SCS curve-number runoff DEPTH in inches (curveNumber.js —
 *   already in this codebase and already used by the detention engine), and Tc from Kirpich
 *   (timeOfConcentration.js — likewise). Rainfall is NOAA Atlas 14 (pfdsClient.js — already
 *   proxied and reachable at /api/pfds).
 *
 *   WHY ATLAS 14 AND NOT USGS StreamStats. The brief allowed either. Atlas 14 wins on three
 *   counts: its rainfall is ALREADY fetched and cached by this app for the design storms, so this
 *   adds no new external dependency or egress path; the runoff half (CN, Tc, contributing area
 *   via upstreamArea.js's D8 accumulation over the 3DEP grid) is likewise already built and
 *   already agrees with the detention numbers on the same panel; and a rainfall-runoff path stays
 *   consistent with the site-scale watersheds this tool actually screens, where regional
 *   regression equations are at their weakest. StreamStats remains the better source for a large
 *   gauged basin, and is the natural next provider behind this same interface.
 *
 *   UNCERTAINTY IS PHYSICAL, NOT INVENTED. The band comes from the PEAK RATE FACTOR: 484 is the
 *   standard NRCS value; flat Gulf-Coast watersheds are routinely analysed at ~284 (the flatter
 *   the basin, the broader and lower the hydrograph peak). Running both ends brackets the answer
 *   with a real modelling choice rather than an arbitrary ±%.
 *
 *   HYDRAULICS: a NORMAL-DEPTH (slope-conveyance) solve — Manning's equation over the surveyed
 *   cross-section, bisecting the water-surface elevation until conveyance carries Qp. The brief
 *   named this the acceptable screening floor and a 1-D standard-step backwater solve as better;
 *   this session implements NORMAL DEPTH. It is stated as such everywhere it surfaces, and the
 *   section geometry comes from the 3DEP terrain sampler this codebase already uses for per-cell
 *   berm heights, so the cross-section is real ground, not an assumed trapezoid.
 *
 * ─── HONESTY REQUIREMENTS (non-negotiable — this is a regulated number) ──────────────────────
 *   • SCREENING, never engineering-grade, never a substitute for a sealed study. The label is
 *     baked into the result object so no call site can drop it.
 *   • NOT_MODELED is returned WITH every answer and is meant to be displayed, not footnoted.
 *   • LOUD-FAILURE: no terrain, no delineable watershed, no rainfall → { ok:false, missing:[…] }.
 *     There is no code path in this file that returns an elevation it did not compute. B1036
 *     shipped for exactly this defect class (an unpriceable term reading as a confident zero);
 *     reintroducing it in a new module would be worse than not building the module.
 *
 * Pure; no DOM, no network — the caller injects rainfall, the section, and the watershed. */
import { runoffDepthIn, compositeCn } from "./curveNumber.js";

/* NRCS peak rate factors. 484 is the standard dimensionless-unit-hydrograph value; ~284 is the
 * widely-applied flat/coastal value (Gulf Coast, Houston MSA). The pair is the uncertainty band. */
export const PRF_STANDARD = 484;
export const PRF_FLAT_COASTAL = 284;

/* Manning's n, screening defaults. A real study surveys and calibrates these. */
export const MANNING_N = {
  channel: 0.035,      // natural stream, some weeds/stones
  overbank: 0.08,      // brush / trees on the floodplain fringe
};

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

/* The regulatory pathway a developer-derived BFE runs through when it changes the mapped
 * floodplain. Reused verbatim from the B710 lineage rather than forked — one sentence, one home. */
/* B1089 — the ONE wording of the screening disclaimer. It was written out independently in
 * `screeningBfeSite.screeningStudyNote` and in `floodplainMitigation.EST_SCREENING_BFE_NOTE`, so the
 * same sentence shipped three times. Composing from here is PANEL-BREVITY rule 5 (state a fact once)
 * doing double duty as a bundle optimization — and it means the disclaimer can never drift between
 * the two surfaces that show it. */
export const SCREENING_DISCLAIMER =
  "SCREENING ONLY — not engineering-grade and not a substitute for a sealed engineer's study.";

export const CLOMR_NOTE =
  "A developer-derived flood elevation that changes the mapped floodplain goes to FEMA as a CLOMR before construction and a LOMR after it, on a sealed engineer's study.";

/* ─── WHY THIS IS NOT OPTIONAL WHERE THE ORDINANCE HAS BEEN READ ─────────────────────────────
 * UPDATE (NEW-3, 2026-07-29): for WALLER COUNTY this is no longer open research. The county's own
 * adopted Flood Damage Prevention Ordinance §5.C(3) (eff. 2/28/2013) was read verbatim and is
 * modeled as a VERIFIED, FIRING rule in floodplainRules.waller.bfeDataRequirement. It goes further
 * than the CFR minimum below in two ways that change the engine's job: it MANDATES NOAA Atlas 14
 * as the hydrology, and it requires the 500-YEAR elevation alongside the base flood elevation.
 * Callers should prefer `floodplainRules.bfeDataRequirementFor(rule)` and fall back to the generic
 * record below only where no adopted ordinance text is on file for the jurisdiction.
 *
 * The record below therefore stays the GENERIC NFIP-minimum fallback, and stays `verified:false`
 * on purpose — it is the federal floor, not any particular county's adopted text.
 *
 * RESEARCH, sourced — and deliberately NOT asserted as settled law in product copy.
 *
 * 44 CFR 60.3(b)(3) is the NFIP minimum floodplain-management standard for a community whose map
 * shows approximate A zones — a special flood hazard area with NO published water-surface
 * elevation and no identified floodway. It requires the community to insist that
 *
 *     "all new subdivision proposals and other proposed developments (including proposals for
 *      manufactured home parks and subdivisions) greater than 50 lots or 5 acres, whichever is
 *      the lesser, include within such proposals base flood elevation data."
 *
 * and 60.3(b)(4) separately requires the community to "obtain, review and reasonably utilize" any
 * BFE and floodway data available from a Federal, State or other source when regulating
 * development in those A zones.
 *
 * WHAT THAT MEANS FOR A SITE LIKE TSAKIRIS: on a tract well over five acres in unstudied Zone A,
 * a BFE determination is very likely a SUBMITTAL REQUIREMENT rather than a nicety — which moves
 * this whole feature from convenience to critical path.
 *
 * TWO HONEST CAVEATS, both load-bearing:
 *   1. 44 CFR 60.3 binds the COMMUNITY, not the developer directly. It takes effect through the
 *      local ordinance the community adopted, and a community may adopt stricter terms. So the
 *      operative text is the county's / city's own floodplain ordinance, not the CFR.
 *   2. This is research to CONFIRM WITH THE COUNTY, not a legal conclusion. Product copy must
 *      present it as "commonly adopted, confirm locally" — never as a determination.
 * Source: 44 CFR 60.3(b)(3)–(b)(4), https://www.ecfr.gov/current/title-44/chapter-I/subchapter-B/part-60/subpart-A/section-60.3 */
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

/* Does the BFE-data threshold bite on this site? ONE engine, two provenances: pass the
 * jurisdiction's own `requirement` record (floodplainRules.bfeDataRequirementFor) and the answer
 * is a VERIFIED ordinance determination; omit it and the generic NFIP-minimum record applies as
 * unverified research. There is deliberately no second code path for the county case.
 *
 * Returns null when it cannot be answered honestly (no acreage/lot count, or the site isn't in an
 * approximate A zone — a studied zone already HAS a published elevation, so nothing is triggered).
 * The returned `verified` flag is the record's own, so a call site can never present unconfirmed
 * research as settled law. */
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

const num = (v) => (Number.isFinite(v) ? v : null);
const r2 = (v) => (Number.isFinite(v) ? Math.round(v * 100) / 100 : null);

/* ─── HYDROLOGY ──────────────────────────────────────────────────────────────────────────────
 * Peak discharge for the contributing watershed, NRCS dimensionless unit hydrograph.
 *   Qp = PRF · A(mi²) · Q(in) / Tp(hr),  Tp = 0.5·D + 0.6·Tc,  D = 0.133·Tc
 * Returns { ok, qCfs, bandCfs:{loCfs,hiCfs}, runoffIn, tpHr, method, inputs } or
 *         { ok:false, missing:[…] } — never a discharge it could not compute. */
export function screeningPeakDischarge({
  areaAcres = null,
  cn = null,
  hsg = null, impPct = null, cover = "openSpaceGood",
  tcMin = null,
  rainfallIn = null,
  returnPeriodYr = 100,
  prf = PRF_STANDARD,
  prfBand = [PRF_FLAT_COASTAL, PRF_STANDARD],
} = {}) {
  const missing = [];
  const A = num(areaAcres);
  if (!(A > 0)) missing.push("contributing watershed area (no delineable basin from the terrain grid)");
  const P = num(rainfallIn);
  if (!(P > 0)) missing.push(`${returnPeriodYr}-year rainfall depth (NOAA Atlas 14)`);
  const tc = num(tcMin);
  if (!(tc > 0)) missing.push("time of concentration");

  // The curve number may be given directly or composed from soils + imperviousness.
  let curveNo = num(cn);
  // compositeCn returns { cn, perviousCn } — take the number, don't coerce the object to null.
  if (curveNo == null && hsg != null) curveNo = num(compositeCn({ group: hsg, impPct: num(impPct) ?? 0, cover })?.cn);
  if (!(curveNo > 0)) missing.push("curve number (soil hydrologic group)");

  if (missing.length) return { ok: false, missing, method: "scs-uh-peak" };

  const Q = runoffDepthIn(P, curveNo);
  if (!(Q > 0)) {
    // Real, and worth saying out loud: at this rainfall the curve number produces no runoff.
    return { ok: false, missing: ["runoff depth is zero at this rainfall and curve number — nothing to route"], method: "scs-uh-peak" };
  }
  const tcHr = tc / 60;
  const dHr = 0.133 * tcHr;          // unit rainfall duration
  const tpHr = 0.5 * dHr + 0.6 * tcHr; // time to peak
  const aMi2 = A / 640;
  const qAt = (factor) => (factor * aMi2 * Q) / tpHr;

  const band = (Array.isArray(prfBand) ? prfBand : [prf, prf]).map(qAt).sort((a, b) => a - b);
  return {
    ok: true,
    method: "scs-uh-peak",
    methodLabel: "NRCS dimensionless unit hydrograph (peak rate factor), SCS curve-number runoff, Kirpich time of concentration, NOAA Atlas 14 rainfall",
    qCfs: r2(qAt(prf)),
    bandCfs: { loCfs: r2(band[0]), hiCfs: r2(band[band.length - 1]) },
    runoffIn: r2(Q),
    tpHr: r2(tpHr),
    inputs: { areaAcres: r2(A), cn: r2(curveNo), tcMin: r2(tc), rainfallIn: r2(P), returnPeriodYr, prf },
  };
}

/* ─── CROSS-SECTION GEOMETRY ─────────────────────────────────────────────────────────────────
 * Wetted area + wetted perimeter of a station-elevation section at a water-surface elevation.
 * `station` is [{ offsetFt, elevFt }] left→right. Pure trapezoidal integration over the wetted
 * sub-segments, so an arbitrary real (3DEP-sampled) shape works, not just a trapezoid. */
export function sectionAtWse(station, wseFt) {
  if (!Array.isArray(station) || station.length < 2 || !Number.isFinite(wseFt)) return null;
  const pts = station
    .filter((p) => p && Number.isFinite(p.offsetFt) && Number.isFinite(p.elevFt))
    .sort((a, b) => a.offsetFt - b.offsetFt);
  if (pts.length < 2) return null;

  let area = 0, perim = 0, topWidth = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i + 1];
    const da = wseFt - a.elevFt;   // depth at the left node (negative = dry)
    const db = wseFt - b.elevFt;
    const dx = b.offsetFt - a.offsetFt;
    if (dx <= 0) continue;
    if (da <= 0 && db <= 0) continue;                       // wholly dry
    if (da > 0 && db > 0) {                                 // wholly wet
      area += ((da + db) / 2) * dx;
      perim += Math.hypot(dx, b.elevFt - a.elevFt);
      topWidth += dx;
      continue;
    }
    // Partially wet: interpolate the waterline crossing.
    const t = da / (da - db);                               // fraction along the segment to the crossing
    const xw = t * dx;
    if (da > 0) {                                           // wet on the left
      area += (da / 2) * xw;
      perim += Math.hypot(xw, da);
      topWidth += xw;
    } else {                                                // wet on the right
      const wx = dx - xw;
      area += (db / 2) * wx;
      perim += Math.hypot(wx, db);
      topWidth += wx;
    }
  }
  if (!(area > 0) || !(perim > 0)) return null;
  return { areaSf: area, perimeterFt: perim, topWidthFt: topWidth, hydraulicRadiusFt: area / perim };
}

/* Manning discharge (US customary) for a section at a water-surface elevation. */
export function manningDischarge(station, wseFt, { manningN = MANNING_N.channel, slopeFtPerFt } = {}) {
  const geom = sectionAtWse(station, wseFt);
  if (!geom || !(manningN > 0) || !(slopeFtPerFt > 0)) return null;
  const q = (1.486 / manningN) * geom.areaSf * Math.pow(geom.hydraulicRadiusFt, 2 / 3) * Math.sqrt(slopeFtPerFt);
  return { qCfs: q, ...geom, velocityFps: q / geom.areaSf };
}

/* ─── HYDRAULICS ─────────────────────────────────────────────────────────────────────────────
 * Normal-depth solve: bisect the water-surface elevation until Manning's conveyance carries qCfs.
 * Returns { ok, wseFt, depthFt, … } or { ok:false, reason } — including the honest "this section
 * overtops before it can carry the flow", which is a real screening answer, not a failure to hide. */
export function normalDepthWse({ station = [], qCfs = null, slopeFtPerFt = null, manningN = MANNING_N.channel, iters = 60 } = {}) {
  const pts = (station || []).filter((p) => p && Number.isFinite(p.offsetFt) && Number.isFinite(p.elevFt));
  if (pts.length < 2) return { ok: false, reason: "no cross-section geometry" };
  if (!(qCfs > 0)) return { ok: false, reason: "no peak discharge to route" };
  if (!(slopeFtPerFt > 0)) return { ok: false, reason: "no channel slope (the water surface can't be solved on a flat or unknown grade)" };
  if (!(manningN > 0)) return { ok: false, reason: "no roughness value" };

  const elevs = pts.map((p) => p.elevFt);
  const bedFt = Math.min(...elevs);
  const topFt = Math.max(...elevs);
  if (!(topFt > bedFt)) return { ok: false, reason: "the sampled section is flat — no channel to solve in" };

  const qAt = (wse) => {
    const m = manningDischarge(pts, wse, { manningN, slopeFtPerFt });
    return m ? m.qCfs : 0;
  };
  // If the section is full to its highest point and still can't carry the flow, say so: the real
  // water surface is above the sampled ground and this method cannot see how far.
  if (qAt(topFt) < qCfs) {
    return { ok: false, reason: "the flow overtops the sampled cross-section — a wider section or a backwater model is needed", overtops: true, bedFt: r2(bedFt), sectionTopFt: r2(topFt) };
  }

  let lo = bedFt, hi = topFt;
  for (let i = 0; i < iters && hi - lo > 1e-4; i++) {
    const mid = (lo + hi) / 2;
    if (qAt(mid) >= qCfs) hi = mid; else lo = mid;
  }
  const m = manningDischarge(pts, hi, { manningN, slopeFtPerFt });
  if (!m) return { ok: false, reason: "the section could not be solved at the routed discharge" };
  return {
    ok: true,
    method: "normal-depth",
    methodLabel: "Manning normal depth (slope-conveyance) over a terrain-sampled cross-section — steady uniform flow, not a backwater profile",
    wseFt: r2(hi),
    depthFt: r2(hi - bedFt),
    bedFt: r2(bedFt),
    areaSf: r2(m.areaSf),
    topWidthFt: r2(m.topWidthFt),
    velocityFps: r2(m.velocityFps),
    manningN,
    slopeFtPerFt,
  };
}

/* ─── THE COMPOSED SCREENING BFE ─────────────────────────────────────────────────────────────
 * Hydrology → hydraulics → a labelled water-surface elevation with an uncertainty band.
 * Returns { ok:true, wseFt, bandFt:{loFt,hiFt}, grade, method, inputs, notModeled, clomrNote }
 *      or { ok:false, stage, missing|reason, notModeled } — an explicit UNKNOWN state, always. */
export function screeningBfe({
  // hydrology
  areaAcres = null, cn = null, hsg = null, impPct = null, cover = "openSpaceGood",
  tcMin = null, rainfallIn = null, returnPeriodYr = 100,
  prf = PRF_STANDARD, prfBand = [PRF_FLAT_COASTAL, PRF_STANDARD],
  // hydraulics
  station = [], slopeFtPerFt = null, manningN = MANNING_N.channel,
} = {}) {
  const hydrology = screeningPeakDischarge({ areaAcres, cn, hsg, impPct, cover, tcMin, rainfallIn, returnPeriodYr, prf, prfBand });
  if (!hydrology.ok) {
    return { ok: false, stage: "hydrology", missing: hydrology.missing, notModeled: NOT_MODELED, clomrNote: CLOMR_NOTE };
  }
  const mid = normalDepthWse({ station, qCfs: hydrology.qCfs, slopeFtPerFt, manningN });
  if (!mid.ok) {
    return { ok: false, stage: "hydraulics", reason: mid.reason, overtops: !!mid.overtops, hydrology, notModeled: NOT_MODELED, clomrNote: CLOMR_NOTE };
  }
  // The band: route the low and high peak-rate-factor discharges through the same section. An end
  // that overtops is reported as null (open-ended), never clamped to look tighter than it is.
  const lo = normalDepthWse({ station, qCfs: hydrology.bandCfs.loCfs, slopeFtPerFt, manningN });
  const hi = normalDepthWse({ station, qCfs: hydrology.bandCfs.hiCfs, slopeFtPerFt, manningN });

  return {
    ok: true,
    screening: true, // never engineering-grade; call sites must label it
    wseFt: mid.wseFt,
    depthFt: mid.depthFt,
    bedFt: mid.bedFt,
    bandFt: { loFt: lo.ok ? lo.wseFt : null, hiFt: hi.ok ? hi.wseFt : null, openEnded: !lo.ok || !hi.ok },
    method: "scs-uh-peak + normal-depth",
    methodLabel: `${hydrology.methodLabel}; ${mid.methodLabel}`,
    hydrology,
    hydraulics: mid,
    notModeled: NOT_MODELED,
    clomrNote: CLOMR_NOTE,
  };
}

export default screeningBfe;
