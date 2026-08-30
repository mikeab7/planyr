/* lib/siteMetrics.js — the site's yield/coverage numbers as ONE pure function.
 *
 * PREREQUISITE EXTRACTION (site-metrics-extraction): these fields used to exist only as local
 * `let`/`const` bindings computed inline in SitePlanner.jsx's render body, read directly by
 * <YieldPanel>. Nothing else in the app could read them — in particular, a future financial-model
 * module (development pro-forma / yield-on-cost) that needs to react live to a redrawn building has
 * no way to ask "what does this site look like right now" without this. This module is that answer:
 * no React, no component state, no DOM — plain data in, a plain metrics object out. Importable from
 * anywhere in the app.
 *
 * SitePlanner.jsx calls this directly (still recomputing on every render that touches its inputs,
 * exactly as the inline version did) and destructures the result into the same local names it always
 * used — there is exactly ONE definition of each number, here.
 *
 * A `dissolvedParcelSqft` GIS-layer coverage.js — unrelated GIS-layer coverage math — is a
 * pre-existing name collision in this codebase; do not confuse the two.
 */
import { dissolvedParcelSqft } from "./polyClip.js";
import { detentionStorage } from "./pondGeom.js";
import { DOGEAR_W, DOGEAR_D } from "./dogEar.js";
import {
  SQFT_PER_ACRE, polyArea, ringOf, carStalls, trailerStalls, estStalls, estTrailers,
  curbAreaOf, isCenterlineRoad, roadStripArea, roadJunctionVerticesOf, roundaboutsForSite,
} from "./siteGeometry.js";

/**
 * @param {Array} elements   the full drawn-element model (`els`) — buildings, paving, parking,
 *                           trailer courts, roads, ponds, ...
 * @param {Array} parcels    the site's parcel records (active + inactive)
 * @param {Array} parcelOverlapPairs  `overlappingParcelPairs(parcels)` — passed in rather than
 *                           recomputed here so a caller that already has it (SitePlanner's own
 *                           B652 overlap-warning memo) pays for the O(n²) scan once, not twice.
 * @param {object} settings  the site's Standards/settings record
 * @returns a plain object — see the field list below.
 */
export function siteMetrics(elements, parcels, parcelOverlapPairs, settings) {
  const els = elements || [];
  const siteSqft = dissolvedParcelSqft(parcels, parcelOverlapPairs);

  // Road pavement area needs each road's junction fillets (roadJunctionVerticesOf) and any
  // roundabout it owns (roundaboutsForSite) — both pure functions of (els, settings), recomputed
  // here rather than threaded in as parameters so this function's signature stays
  // (elements, parcels, parcelOverlapPairs, settings) and nothing else. See lib/siteGeometry.js.
  const junctionVerts = roadJunctionVerticesOf(els);
  const sharpFor = (el) => (el && el.id != null ? junctionVerts.get(el.id) : undefined);
  const roundabouts = roundaboutsForSite(els, settings);
  const roundTrim = (el) => (el && roundabouts.trims.get(el.id)) || undefined;
  // A strip may override the global standards (e.g. a single-row trailer lot with its own cfg).
  const cfgOf = (el) => (el.cfg ? { ...settings, ...el.cfg } : settings);

  let bldg = 0, paving = 0, parkArea = 0, trailArea = 0, pondArea = 0, stalls = 0, trailers = 0;
  let bumpCount = 0, bumpArea = 0, bumpsUniform = true; // dog-ear / bump-out tally (counted within bldg)
  let providedDetCf = 0, pondCount = 0, maxPondDepthFt = 0; // provided detention across ALL ponds (cubic feet)
  els.forEach((e) => {
    // road area = its generated strip polygon + any roundabout annulus it owns
    const a = isCenterlineRoad(e) ? roadStripArea(e, settings, sharpFor(e), roundTrim(e), roundabouts.areaById.get(e.id)) : e.points ? polyArea(e.points) : e.w * e.h;
    // derived curbs count in the SF / impervious math (0 for non-paved types; a road's curb is already inside its strip area)
    const curb = curbAreaOf(e, els);
    if (e.type === "building") {
      bldg += a;
      if (e.dogEar) {
        bumpCount++; bumpArea += a;
        // Is this bump still the 55′×60′ default (so the summary can name the size)?
        const horiz = e.dogEar.side === "top" || e.dogEar.side === "bottom";
        if (Math.abs((horiz ? e.w : e.h) - DOGEAR_W) > 0.5 || Math.abs((horiz ? e.h : e.w) - DOGEAR_D) > 0.5) bumpsUniform = false;
      }
    }
    else if (e.type === "paving" || e.type === "sidewalk" || e.type === "road") paving += a + curb;
    else if (e.type === "parking") { parkArea += a + curb; stalls += e.points ? estStalls(a, settings) : carStalls(e.w, e.h, cfgOf(e)).count; }
    else if (e.type === "trailer") { trailArea += a + curb; trailers += e.points ? estTrailers(a, settings) : trailerStalls(e.w, e.h, cfgOf(e)).count; }
    else if (e.type === "pond") {
      pondArea += a;
      // Provided storage = the same stage/volume calc the pond panel shows, summed site-wide.
      const det = e.det || {};
      providedDetCf += detentionStorage(ringOf(e), det.depth ?? 8, det.freeboard ?? 1, det.slope ?? 3).vol;
      pondCount++;
      maxPondDepthFt = Math.max(maxPondDepthFt, det.depth ?? 8);
    }
  });
  // No bump/court de-double-count: the truck court's wall-length span is trimmed to the clear face
  // BETWEEN the corner bump-outs, so the court's paving area already excludes the bump footprint.
  // The bump itself is type "building", already counted in `bldg`.
  const impervious = bldg + paving + parkArea + trailArea;
  const cov = siteSqft ? (bldg / siteSqft) * 100 : 0;
  const impPct = siteSqft ? (impervious / siteSqft) * 100 : 0;
  const detPct = siteSqft ? (pondArea / siteSqft) * 100 : 0;
  const ratio = bldg ? stalls / (bldg / 1000) : 0;
  const open = Math.max(0, siteSqft - impervious - pondArea);
  const acresActive = siteSqft / SQFT_PER_ACRE;
  // FAR (floor-area ratio) = building SF ÷ GROSS site SF, matching `cov`'s denominator — this
  // codebase has no separate "net developable area" figure (nothing here subtracts easements /
  // floodplain / setback-encumbered ground into one buildable-acreage field), so gross siteSqft is
  // the only site-area concept FAR could reuse without inventing a second, un-audited one. Bump-outs
  // are IN the numerator, same as `bldg`/`cov` — `bldg` already includes them (see the dog-ear tally
  // above), and a FAR that excluded them would silently disagree with the coverage percent sitting
  // right next to it in the panel. Expressed as a bare ratio (e.g. 0.35), not a percentage.
  const far = siteSqft ? bldg / siteSqft : 0;

  return {
    siteSqft, bldg, paving, parkArea, trailArea, pondArea, stalls, trailers,
    bumpCount, bumpArea, bumpsUniform, providedDetCf, pondCount, maxPondDepthFt,
    impervious, cov, impPct, detPct, ratio, open, far, acresActive,
  };
}
