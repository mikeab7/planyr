/* @planner-extract — the drainage CHECK flow of the Site Planner as a hook (audit batch G2 step 4a, B2671311, behaviour-identical move; Verify: live).
 * Holds the check's state (`drainCtx`, the supersede token, the one-attempt-per-key guard), the geometry signature the stored answer is compared against
 * (pure, in lib/drainageSignature.js) and `checkDrainage` itself (the lazy-loaded GIS pulls: jurisdiction, flood, BFE, soils, terrain, with their timers).
 * Everything the readout derives from the stored answer (`drainReadCtx` and below) stays in SitePlanner and reads these returned values.
 * No import back from SitePlanner.jsx. */
import { useState, useRef } from "react";
import { feetToLatLng } from "./arcgis.js";
import { resolveDrainageContext, slimDrainageContext } from "./detentionRules.js";
import { drainCentroidOf, drainElsSignature, drainSignature } from "./drainageSignature.js";
import { sampleEbfePoint } from "./ebfe.js";
import { canonEnv } from "./factRevalidation.js";
import { sampleWse02Point, sampleWse100Point } from "./fbcdWse.js";
import { FM_FILL_TYPES } from "./floodFootprintMemo.js";
import { bfeLinesFromFeatureCollection, crossSectionWselFromFeatureCollection, deriveBfeFromLines, floodGeoBbox, governingCrossSectionWsel, zonesFromFeatureCollection } from "./floodplainMitigation.js";
import { gisCache } from "./gisCache.js";
import { sampleMaapnextWse } from "./hcfcdWse.js";
import { resolvePfds } from "./pfdsClient.js";
import { CLOMR_NOTE, NOT_MODELED, WATERSHED_GRID_ZOOM, WATERSHED_PAD_DEG } from "./screeningBfeCopy.js";
import { polyArea, ringOf } from "./siteGeometry.js";
import { resolveSoils } from "./soils.js";
import { loadTerrain } from "./terrainLazy.js";
import { VECTOR_SOURCES, fetchCached } from "./vectorLayers.js";
export function useDrainageCheck({ drainSaveArmed, els, origin, parcels, setSettings, settings, siteSqft }) {
  const [drainCtx, setDrainCtx] = useState(null); // null | {busy,prev?} | {error,prev?} | {ctx, sig, multiParcel}
  const drainTok = useRef(0);
  const drainAutoAttempts = useRef(new Set()); // moved here from further down (checkDrainage clears it, and a hook's refs must exist before the handler that reads them); the auto-revalidation block below still reads it
  // Signature that must change whenever the checked geometry does — parcel COUNT + area
  // AND a coarse centroid (in feet) + the georef origin, so a pure TRANSLATION (drag the
  // whole parcel across a jurisdiction boundary, or re-georeference) also invalidates the
  // cached answer. Area+count alone would miss a translation (same shape, new place).
  const drainActive = parcels.filter((p) => p.active !== false && p.points && p.points.length >= 3);
  const drainCentroid = drainCentroidOf(drainActive);
  // B712: the fill/pond elements DEFINE the flood-fetch envelope + the mitigation footprints, so their coarse envelope joins the signature — fill
  // drawn or dragged beyond the checked envelope must surface the "re-check" hint, never screen against never-fetched flood zones as a silent all-clear.
  const drainElsSig = drainElsSignature(els);
  const drainSigNow = drainSignature({ activeCount: drainActive.length, siteSqft, centroid: drainCentroid, origin, elsSig: drainElsSig });
  const checkDrainage = async (opts = {}) => {
    const isAuto = opts && opts.auto === true; // B832 — auto-revalidation runs tag themselves (status line + the remembered record)
    // B874 — a manual ↻ is the escape hatch from a STALLED auto-refetch: clear the one-attempt-per-
    // key guard so the same target can be auto-retried later (and the manual pull itself always runs).
    if (!isAuto) drainAutoAttempts.current.clear();
    if (!origin) { setDrainCtx((prev) => ({ error: "This plan isn't georeferenced — bring the parcel in from the map first.", prev: prev?.ctx ? prev : prev?.prev })); return; }
    const act = parcels.filter((p) => p.active !== false && p.points && p.points.length >= 3);
    if (!act.length) { setDrainCtx((prev) => ({ error: "No parcel boundary on the plan yet.", prev: prev?.ctx ? prev : prev?.prev })); return; }
    const tok = ++drainTok.current; // a later click / boundary change supersedes this one
    const sig = drainSigNow;
    // Keep the prior good answer visible under a "checking…" hint rather than blanking
    // the whole readout (and don't lose it if this re-check then fails).
    setDrainCtx((prev) => ({ busy: true, auto: isAuto, prev: prev?.ctx ? prev : prev?.prev }));
    // NEW-4 — every leg of this check is timed, and the row goes to the same production sink the
    // performance recorder uses. `checkT0` is stamped BEFORE the lazy import below, so `total`
    // measures the check and not the check minus its own module load.
    const checkT0 = typeof performance !== "undefined" && performance.now ? performance.now() : Date.now();
    const [{ beginGroundElevation }, dtim] = await Promise.all([
      import("./lib/groundElevation.js"),
      import("./lib/drainageTiming.js"),
    ]);
    const { createDrainageTimer, buildDrainageTimingRow, reportDrainageTiming, wseLegName, armDrainageSaveLeg, SAVE_ATTRIBUTION_MS } = dtim;
    const timer = createDrainageTimer(undefined, checkT0);
    let drainGroundState = null;
    let drainCheckError = null;
    try {
      // The identify takes ONE ring — use the largest active parcel (flagged when several).
      const largest = act.reduce((b, p) => (polyArea(p.points) > polyArea(b.points) ? p : b), act[0]);
      const ring = largest.points.map((pt) => { const [la, ln] = feetToLatLng(pt, origin.lat, origin.lon); return [ln, la]; });
      // NEW-5 (2026-09-05, owner-reported) — the SAME whole-site containment fix `jurActiveRings`
      // already gives the header badge (B276752-755): a multi-parcel assemblage is a coin flip
      // weighted by lot size when only the largest parcel's ring is tested, so an ETJ that only
      // reaches the OTHER parcels was invisible to the drainage authority / detention-rate lookup
      // (Goose Creek's stored jurisdiction read `etj: []` while the header, testing every parcel,
      // correctly found Baytown's ETJ). Threaded into resolveDrainageContext below so the
      // detention rule and the header stop disagreeing about which parcels are in/out of a city.
      const rings = act.map((p) => p.points.map((pt) => { const [la, ln] = feetToLatLng(pt, origin.lat, origin.lon); return [ln, la]; }));
      const c = ring.reduce((s, [x, y]) => [s[0] + x / ring.length, s[1] + y / ring.length], [0, 0]);
      /* ⛔ NEW-1 / NEW-2 / NEW-3 — GROUND ELEVATION. Started HERE, at t=0, in parallel with every
       * GIS pull below rather than in front of them (B1442(d) did exactly this for three point
       * samplers and left this one out — same fix, same shape, same reason), and CACHED on the
       * exact request geometry so a repeat check pays nothing at all for a value that changes when
       * USGS re-flies a county. `state` is what the panel may publish immediately; `fresh` is the
       * late answer that patches it in. See lib/groundElevation.js for the whole rationale,
       * including why the explicit ↻ forces a refresh WITHOUT blocking on it. */
      timer.start("elev");
      const groundLeg = beginGroundElevation({
        lng: c[0], lat: c[1],
        force: !isAuto,                 // the ↻ is the "correct a wrong cached value" button
        cache: gisCache,
        onFetchSettled: ({ ms }) => timer.mark("elev", ms),
      });
      const groundStatePromise = groundLeg.state;
      /* `resolveDrainageContext` asks for the ground sample inside its own parallel batch; give it
       * the already-in-flight answer instead of starting a second one. Past the publish budget
       * this resolves to null and the context publishes WITHOUT site grade — an honest
       * `ground-elevation-missing`, never a fabricated elevation — and the patch below fills it. */
      const sampleGround = async () => {
        const st = await groundStatePromise;
        return st && st.status === "value" ? st.ft : null;
      };
      // B707/B712: the NFHL polygon pull rides this same explicit click (house
      // rule: never auto-fetch on an edit), the B96 SWR cache, and the same
      // drainSigNow staleness clock. Envelope = active parcels + the drawn
      // fill/pond elements (fill can sit outside a parcel), padded so an
      // edge-touching zone isn't clipped. Zones convert to site feet ONCE here
      // (origin is stable per check; an origin change flips the sig).
      const bboxPts = [];
      for (const p of act) for (const pt of p.points) bboxPts.push(pt);
      for (const e of els) {
        if (!FM_FILL_TYPES.has(e.type) && e.type !== "pond") continue;
        try { const r = ringOf(e); if (r && r.length >= 3) for (const pt of r) bboxPts.push(pt); } catch (_) { /* a road mid-edit can lack corners */ }
      }
      let mnX = Infinity, mnY = Infinity, mxX = -Infinity, mxY = -Infinity;
      for (const pt of bboxPts) { if (pt.x < mnX) mnX = pt.x; if (pt.x > mxX) mxX = pt.x; if (pt.y < mnY) mnY = pt.y; if (pt.y > mxY) mxY = pt.y; }
      const llA = feetToLatLng({ x: mnX, y: mnY }, origin.lat, origin.lon);
      const llB = feetToLatLng({ x: mxX, y: mxY }, origin.lat, origin.lon);
      const fmBbox = isFinite(mnX) ? floodGeoBbox([[[llA[1], llA[0]], [llB[1], llB[0]]]]) : null;
      // B755 fix (Bain live-verify, 2026-07-18) — TWO rounds:
      // (1) The BFE-line/cross-section derivation (deriveBfeFromLines /
      // governingCrossSectionWsel) will accept a contour within its own search radius, but
      // fmBbox's default 0.001° pad (~350-450 ft depending on latitude) only reaches the
      // immediate site edge — on the real Bain plan the nearest usable S_BFE lines sit
      // farther from the fill footprint than that pad, so the fetch returned zero lines and
      // the field stayed "no published BFE" even though FEMA publishes usable lines nearby.
      // Widen JUST the linear-feature pull to actually cover the engine's own search radius;
      // the zone polygon (fmBbox, large-area features that don't need this) and the DEM grid
      // (kept tight on purpose — an oversized elevation pull is wasted bytes) are unchanged.
      // (2) Confirmed live: even with round (1) deployed, the Bain reach's nearest usable
      // line measured ~2980 ft from the site's reference point — past the derivation
      // engine's OLD 2500 ft cap, so the fetch now succeeded but the engine still rejected
      // the result. Round (2) raised the engine's own maxLineDistFt/maxGapFt/maxDistFt (see
      // floodplainMitigation.js) to 5000/10000/5000 ft; this pad is bumped in step so the
      // fetch stays ahead of the engine's new ceiling (never the bottleneck again).
      const BFE_SEARCH_PAD_DEG = 0.04;
      const bfeSearchBbox = isFinite(mnX) ? floodGeoBbox([[[llA[1], llA[0]], [llB[1], llB[0]]]], BFE_SEARCH_PAD_DEG) : null;
      // Failure isolation (the channel-state pattern): a flood-geometry outage
      // must never nuke the whole drainage check — it reads "failed" (an honest
      // UNKNOWN downstream), never a fabricated all-clear.
      const floodGeoP = fmBbox
        ? fetchCached(VECTOR_SOURCES.fema, fmBbox, { cache: gisCache })
            .then((r) => ({
              zones: zonesFromFeatureCollection(r.data, { lat: origin.lat, lon: origin.lon }),
              ts: r.ts ?? null,
              truncated: !!(r.data && r.data.truncated),
              state: "loaded",
            }))
            .catch(() => ({ zones: [], ts: null, truncated: false, state: "failed" }))
        : Promise.resolve({ zones: [], ts: null, truncated: false, state: "empty" });
      // B755: FEMA Base Flood Elevation LINES (S_BFE) — the same explicit click, same
      // SWR cache, a WIDER envelope (bfeSearchBbox, see above). On most AE reaches the
      // zone polygon carries no BFE, so these whole-foot contour lines are the only
      // published source; we interpolate one at the fill to DERIVE a screening BFE. A
      // failure reads honestly (no lines → no derived value → the existing "no published
      // BFE" UNKNOWN), never a fake clear.
      const bfeLinesP = bfeSearchBbox
        ? fetchCached(VECTOR_SOURCES.bfeLines, bfeSearchBbox, { cache: gisCache })
            .then((r) => ({ ...bfeLinesFromFeatureCollection(r.data, { lat: origin.lat, lon: origin.lon }), ts: r.ts ?? null, state: "loaded" }))
            .catch(() => ({ lines: [], excludedDatum: 0, excludedUnit: 0, total: 0, ts: null, state: "failed" }))
        : Promise.resolve({ lines: [], excludedDatum: 0, excludedUnit: 0, total: 0, ts: null, state: "empty" });
      // B762: FEMA regulatory cross-sections (S_XS) — the governing 1% water-surface
      // elevation (WSEL_REG) at the nearest stream reach. Same explicit click + SWR cache,
      // same widened envelope as the BFE lines (governingCrossSectionWsel's own
      // maxDistFt=2500 ft has the identical fetch-vs-search-radius mismatch).
      const crossSectionsP = bfeSearchBbox
        ? fetchCached(VECTOR_SOURCES.crossSections, bfeSearchBbox, { cache: gisCache })
            .then((r) => ({ ...crossSectionWselFromFeatureCollection(r.data, { lat: origin.lat, lon: origin.lon }), ts: r.ts ?? null, state: "loaded" }))
            .catch(() => ({ sections: [], excludedDatum: 0, total: 0, ts: null, state: "failed" }))
        : Promise.resolve({ sections: [], excludedDatum: 0, total: 0, ts: null, state: "empty" });
      // B808 — the site-extent bare-earth DEM grid (one small LERC decode) rides the same
      // explicit click. Failure isolation: an outage reads state "failed" and the engine
      // falls back to the labeled flat median — never a silent flat price.
      const siteGridP = fmBbox
        ? loadTerrain().then((t) => t.fetchSiteGrid({ west: fmBbox.w, south: fmBbox.s, east: fmBbox.e, north: fmBbox.n }))
            .then((r) => ({ grid: r.grid, req: r.req, state: "loaded" }))
            .catch(() => ({ grid: null, req: null, state: "failed" }))
        : Promise.resolve({ grid: null, req: null, state: "empty" });
      // B874 — BOUND the whole pull: a black-holed fetch (no resolve, no reject) would otherwise
      // leave `busy` stuck true forever (one half of the stuck-refresh class). Race the group
      // against a 30 s timeout that REJECTS → the outer catch sets a terminal error state (↻ to
      // retry), never an indefinite spinner. The per-source .catch()es still handle plain outages.
      const DRAIN_FETCH_TIMEOUT_MS = 30000;
      let drainTimeoutId = null;
      // NEW-4 — one leg per source, all started already; `leg` only stamps when each settles, so
      // the timing costs nothing and cannot change the ordering it is measuring.
      const leg = (name, p) => { timer.start(name); return p.then((v) => { timer.end(name); return v; }, (e) => { timer.end(name); throw e; }); };
      timer.start("gis");
      const [ctx, floodGeo, bfeLines, xs, siteGrid] = await Promise.race([
        Promise.all([
          leg("ctx", resolveDrainageContext({ lng: c[0], lat: c[1], ring, rings }, { sampleGround })),
          leg("flood", floodGeoP),
          leg("bfeLines", bfeLinesP),
          leg("xs", crossSectionsP),
          leg("siteGrid", siteGridP),
        ]).then((r) => { if (drainTimeoutId) clearTimeout(drainTimeoutId); timer.end("gis"); return r; }),
        new Promise((_, reject) => { drainTimeoutId = setTimeout(() => reject(new Error("flood-data source timed out — ↻ Re-check")), DRAIN_FETCH_TIMEOUT_MS); }),
      ]);
      if (tok !== drainTok.current) return;
      // Representative point for the derived BFE: the centroid of the fill footprints
      // (where mitigation is priced), else the largest parcel's centroid — same site-
      // feet frame the BFE lines converted into.
      const bfeFillPts = [];
      for (const e of els) {
        if (!FM_FILL_TYPES.has(e.type)) continue;
        try { const r = ringOf(e); if (r && r.length >= 3) for (const pt of r) bfeFillPts.push(pt); } catch (_) { /* mid-edit */ }
      }
      const bfePtSrc = bfeFillPts.length ? bfeFillPts : largest.points;
      const bfePt = bfePtSrc.reduce((s, p) => ({ x: s.x + p.x / bfePtSrc.length, y: s.y + p.y / bfePtSrc.length }), { x: 0, y: 0 });
      floodGeo.demGrid = siteGrid; // B808 — { grid, req, state }; stays in-memory only (never slimmed)
      floodGeo.derivedBfe = bfeLines.lines.length ? deriveBfeFromLines({ point: bfePt, lines: bfeLines.lines }) : null;
      floodGeo.bfeLineFlags = { datumExcluded: bfeLines.excludedDatum, unitExcluded: bfeLines.excludedUnit, total: bfeLines.total, usable: bfeLines.lines.length, state: bfeLines.state };
      // B762 — governing 1% WSEL from the nearest stream reach's cross-sections (stream-
      // matched by WTR_NM). Ranks BELOW a manual BFE, ABOVE the interpolated BFE-line value.
      floodGeo.derivedXsWsel = xs.sections.length ? governingCrossSectionWsel({ point: bfePt, sections: xs.sections }) : null;
      floodGeo.xsFlags = { datumExcluded: xs.excludedDatum, total: xs.total, usable: xs.sections.length, state: xs.state };
      // B770/V279 + B807 wiring — the DRAFT WSEs from FBCDD's Atlas-14 watershed-study
      // rasters (0.2% county-wide mosaic; 1% per-watershed multiplex), sampled at the
      // same representative point the derived BFE uses. Fort Bend sites only (the study
      // covers that county; elsewhere the call is a guaranteed no-data). Failure
      // isolation PER VALUE: an outage reads that value's state "failed" (an honest
      // UNKNOWN downstream — surfaced on the card), never a fabricated value and never
      // poisoning the sibling sample; an out-of-coverage point reads "empty". Neither
      // value ever overwrites a manual entry (precedence in computeMitigation — the 1%
      // is the LAST rung) and both always carry the DRAFT label.
      floodGeo.derivedWse02 = null;
      floodGeo.wse02Flags = { state: "not-applicable" };
      floodGeo.derivedWse100 = null;
      floodGeo.wse100Flags = { state: "not-applicable" };
      if ((ctx?.authority?.jurisdiction?.county || []).some((c) => /fort\s*bend/i.test(String(c)))) {
        const [wLat, wLng] = feetToLatLng(bfePt, origin.lat, origin.lon);
        // NEW-4 — per-RASTER timings (`wse:FortBend_500YR_WSE`, `wse:Willow_100YR_Existing_WSE`,
        // …), which is the granularity the owner's own PerformanceResourceTiming timeline had and
        // the app did not. `wse` is the group's wall clock.
        const onSample = ({ service, ms }) => { const n = wseLegName(service); if (n) timer.mark(n, ms); };
        timer.start("wse");
        const [r02, r100] = await Promise.allSettled([sampleWse02Point(wLat, wLng, { onSample }), sampleWse100Point(wLat, wLng, { onSample })]);
        timer.end("wse");
        if (r02.status === "fulfilled") {
          floodGeo.derivedWse02 = r02.value != null ? { wseFt: r02.value, source: "fbcdd-wse02-draft" } : null;
          floodGeo.wse02Flags = { state: r02.value != null ? "loaded" : "empty" };
        } else {
          floodGeo.wse02Flags = { state: "failed" };
        }
        if (r100.status === "fulfilled") {
          floodGeo.derivedWse100 = r100.value != null ? { wseFt: r100.value.wseFt, source: "fbcdd-wse100-draft", watershed: r100.value.watershed } : null;
          floodGeo.wse100Flags = { state: r100.value != null ? "loaded" : "empty" };
        } else {
          floodGeo.wse100Flags = { state: "failed" };
        }
        if (tok !== drainTok.current) return; // superseded while sampling
      }
      // B882 — FEMA/USGS InFRM Estimated BFE (EBFE / Base Level Engineering). For a FEMA
      // Zone A / unstudied "no published BFE" area, InFRM publishes an ENGINEERED screening
      // flood surface — a far better estimated BFE than the grade-@-boundary guess it
      // replaces. Sampled at the SAME representative point, ANY county (InFRM is FEMA Region 6
      // / Gulf-central, not nationwide — out of coverage returns null → the caller falls back
      // to the grade estimate). Bounded (8 s via the sampler's AbortController, inside the
      // B874 30 s race) + cached per location. Failure isolation: an outage reads state
      // "failed" (→ grade fallback), NEVER a fabricated value. Layer 17 → estimated 1% BFE;
      // layer 21 → the 0.2% (500-yr) WSE that fills the currently-blank field off Fort Bend.
      /* ⛔ NEW-4(d) — "Also would be great to reduce how long that check takes." The three
       * point-samplers below were STARTED one after another because they were WRITTEN one after
       * another: MAAPnext was nested inside EBFE's block and the screening study followed both, so
       * an unstudied-Zone-A site in Harris paid three bounded round trips end to end when none of
       * the three depends on any other — every one of them samples the SAME `bfePt`.
       * The fix is deliberately the smallest one that is provably equivalent: START the promises
       * here and `await` them exactly where they were awaited before. Not one guard, assignment,
       * `tok` check or failure branch below moves, so there is no reordering to reason about — a
       * promise simply begins running when it is created. `.catch(() => {})` on a SEPARATE handle
       * marks each rejection handled, because a `tok` supersede can return before the await and an
       * un-awaited rejection would otherwise surface as an unhandled one. */
      const zoneAUnstudied = (floodGeo.zones || []).some((z) => z.unstudiedA && z.zone === "A");
      const inHarris = ctx?.authority?.jurisdiction?.state !== "GA" && ctx?.authority?.jurisdiction?.state !== "CA" // NEW-1 — Harris County, GEORGIA is not Texas's Harris (and no California county is either)
        && (ctx?.authority?.jurisdiction?.county || []).some((c) => /harris/i.test(String(c)));
      const [ptLat, ptLng] = feetToLatLng(bfePt, origin.lat, origin.lon);
      const ebfeP = zoneAUnstudied ? leg("ebfe", sampleEbfePoint(ptLat, ptLng)) : null;
      const maapP = zoneAUnstudied && inHarris ? leg("maapnext", sampleMaapnextWse(ptLat, ptLng)) : null;
      if (ebfeP) ebfeP.catch(() => {});
      if (maapP) maapP.catch(() => {});
      floodGeo.ebfe = null;
      floodGeo.ebfeFlags = { state: "not-applicable" };
      if (zoneAUnstudied) {
        try {
          const e = await ebfeP;
          const covered = e && (e.bfe1pctFt != null || e.wse02Ft != null);
          floodGeo.ebfe = covered ? { bfe1pctFt: e.bfe1pctFt ?? null, wse02Ft: e.wse02Ft ?? null, source: "fema-ebfe" } : null;
          floodGeo.ebfeFlags = { state: covered ? "loaded" : "empty" };
        } catch (_) {
          floodGeo.ebfeFlags = { state: "failed" }; // → grade fallback, honest UNKNOWN
        }
        if (tok !== drainTok.current) return; // superseded while sampling
        // B882 (scope note 2) — HCFCD MAAPnext model WSE (Harris County local-district provider).
        // Sampled behind the SAME provider interface; in Harris it OUTRANKS EBFE (enforced there).
        // The WSE endpoints are provisional (sandbox can't confirm the raster names — V363), so
        // the sampler is a no-op until they're filled; wired now so Harris activates by config.
        floodGeo.maapnext = null;
        floodGeo.maapnextFlags = { state: "not-applicable" };
        if (inHarris) {
          try {
            const m = await maapP;
            const covered = m && (m.wse1pctFt != null || m.wse02Ft != null);
            floodGeo.maapnext = covered ? { wse1pctFt: m.wse1pctFt ?? null, wse02Ft: m.wse02Ft ?? null, source: "hcfcd-maapnext" } : null;
            floodGeo.maapnextFlags = { state: covered ? "loaded" : (m ? "empty" : "not-configured") };
          } catch (e) {
            /* NEW-1 — a DECLARED outage is its own state, distinct from a one-off failure. On a
             * Harris site this is the governing WSE provider, and MAAPnext usually runs HIGHER
             * than the effective FIRM, so the estimate the site DOES get is likely low. That has
             * to reach the user in words; it may never look like "no flood data here". */
            floodGeo.maapnextFlags = e && e.outage
              ? { state: "unavailable", since: e.outage.since, symptom: e.outage.symptom, impact: e.outage.impact, replacement: e.outage.replacement }
              : { state: "failed" };
          }
          if (tok !== drainTok.current) return; // superseded while sampling
        }
      }
      // NEW-1 (B1057 completion) — PLANYR'S OWN SCREENING STUDY. Everything above reads somebody
      // else's published or modelled number; this DERIVES one, and it is the only rung that can
      // answer at all where nobody publishes anything. It rides the same explicit user action (the
      // house fetch rule: never view-driven), the same 30 s outer race, and the same per-source
      // failure isolation — an outage reads as an honest UNKNOWN naming the input that is missing,
      // never a fabricated elevation.
      //
      // Gated to unstudied Zone A with no published/manual 1% surface: exactly the "if not
      // otherwise provided" case Waller §5.C(3) addresses, and the only case where the cost of
      // three extra point fetches buys anything the app doesn't already have.
      floodGeo.screeningBfe = null;
      floodGeo.screeningBfeFlags = { state: "not-applicable" };
      if (zoneAUnstudied) {
        const sLat = ptLat, sLng = ptLng;
        timer.start("screening");
        try {
          // The WIDE, COARSE delineation window — the SAME 3DEP sampler as the site DEM, a
          // different extent (a site-envelope grid would delineate a few acres of a basin that
          // really runs for miles, and hand back a confidently understated discharge).
          const wideBounds = {
            west: sLng - WATERSHED_PAD_DEG, east: sLng + WATERSHED_PAD_DEG,
            south: sLat - WATERSHED_PAD_DEG, north: sLat + WATERSHED_PAD_DEG,
          };
          // NEW-1 — the engine is fetched CONCURRENTLY with the three data pulls it needs, and
          // awaited only where its first function is called. Moving it off the boot path therefore
          // costs this branch no wall-clock: the module download overlaps network round-trips that
          // were already happening. Started BEFORE the `await` below on purpose — kick it off, then
          // let it ride. A failed chunk fetch rejects at the await and lands in the existing catch,
          // which reports it as the named LOUD-FAILURE "could not run" state like any other outage.
          const enginePromise = import("./lib/screeningBfeSite.js");
          const [wideR, pfdsR, soilsR] = await Promise.allSettled([
            loadTerrain().then((t) => t.fetchSiteGrid(wideBounds, { zoom: Math.min(WATERSHED_GRID_ZOOM, t.siteGridZoom(sLat)) })),
            resolvePfds({ lat: sLat, lng: sLng }),
            resolveSoils({ lat: sLat, lng: sLng }),
          ]);
          const wide = wideR.status === "fulfilled" ? wideR.value : null;
          const pfds = pfdsR.status === "fulfilled" && pfdsR.value?.ok ? pfdsR.value : null;
          const soils = soilsR.status === "fulfilled" && soilsR.value?.ok ? soilsR.value : null;
          const { terrainInputsForScreeningBfe, atlas14Depths, screeningBfeForSite } = await enginePromise;

          const terrain = terrainInputsForScreeningBfe({
            sectionGrid: siteGrid?.grid || null,
            sectionReq: siteGrid?.req || null,
            watershedGrid: wide?.grid || null,
            watershedReq: wide?.req || null,
            siteRingsLatLng: act.map((p) => p.points.map((pt) => feetToLatLng(pt, origin.lat, origin.lon))),
            lat: sLat,
          });
          const result = screeningBfeForSite({
            terrain,
            rainfall: atlas14Depths(pfds ? pfds.table : null),
            hsg: soils ? soils.soils.hsg : null,
          });
          floodGeo.screeningBfe = {
            ...result,
            sources: {
              rainfall: pfds ? pfds.source : null,
              soils: soils ? soils.source : null,
              hsg: soils ? soils.soils.hsg : null,
              watershedGrid: wide ? "3DEP (wide delineation window)" : null,
            },
          };
          floodGeo.screeningBfeFlags = { state: result.ok ? "loaded" : "incomplete" };
        } catch (e) {
          // LOUD-FAILURE: a throw is recorded as an explicit {ok:false} RESULT, not just a flag, so
          // the panel's provenance hover states it in the same place it states every other outcome
          // — never a quiet no-op that reads as "nothing to worry about here".
          const reason = e && e.message ? e.message : String(e);
          floodGeo.screeningBfe = { ok: false, stage: "fetch", missing: [`the screening study could not run: ${reason}`], notModeled: NOT_MODELED, clomrNote: CLOMR_NOTE, screening: true };
          floodGeo.screeningBfeFlags = { state: "failed", reason };
        }
        timer.end("screening");
        if (tok !== drainTok.current) return; // superseded while sampling
      }
      const checkedAt = Date.now();
      // B832 — an AUTO run that came back materially DEGRADED (the authority lookup
      // was unavailable, or the flood pull failed where the remembered check had it
      // loaded) shows its honest live state but must NOT overwrite the good remembered
      // snapshot — degraded sources fall to last-good. A manual ↻ keeps today's
      // replace-always behavior (the user explicitly asked for a fresh pull).
      const prevLC = settings.drainage?.lastCheck || null;
      const autoDegraded = isAuto && (
        (ctx?.authority?.flags || []).includes("jurisdiction-unavailable")
        || (ctx?.flood?.state === "failed" && prevLC?.flood?.state === "loaded")
      );
      /* NEW-2(b) / NEW-4 — the GROUND-ELEVATION STATE rides the published context, and the panel
       * is NOT gated on it. `groundState` is whatever was publishable at this moment: the cached
       * value (instant), or an honest `pending` if the transect blew its publish budget. It is
       * carried as a four-state object beside the bare number so a consumer can tell "still
       * loading" from "3DEP has no value here" from "the service failed" — an unresolved number
       * must read as UNRESOLVED, never as zero and never as a dash that looks like an answer. */
      const groundState = await groundStatePromise;
      // NEW-4 — the app's OWN work: the gap between the last network response and the publish.
      // The owner measured 1,029 / 1,654 ms of it and it is recorded on B1353, which owns moving
      // these engines off the main thread. This is a GAP IN THE NETWORK TIMELINE, which is solid;
      // it is deliberately not called a main-thread blocking figure (FOREGROUND-OR-VOID).
      timer.mark("calc", timer.sinceNetwork());
      const ctxOut = { ...ctx, groundElev: groundState, floodGeo };
      setDrainCtx({ ctx: ctxOut, sig, multiParcel: act.length > 1, checkedAt, auto: isAuto, degraded: autoDegraded });
      // B832 — remember WHAT this check fetched (the raw feet envelope + the two
      // point-sample anchors) so auto-revalidation can tell "moved inside the fetched
      // area" (numbers recompute live, no fetch) from "outgrew it" (refetch). JSON-safe.
      const groundPt = largest.points.reduce((s, p) => ({ x: s.x + p.x / largest.points.length, y: s.y + p.y / largest.points.length }), { x: 0, y: 0 });
      const fetchRec = {
        // B874 — canonEnv rounds OUTWARD so the stored env always CONTAINS the measured geometry.
        // The old Math.round shrank it (min↑ / max↓), so a fresh load with zero edits read
        // "outgrew the fetched envelope" and the refresh spinner stuck ambiently forever.
        env: isFinite(mnX) ? canonEnv({ mnX, mnY, mxX, mxY }) : null,
        anchorPt: { x: Math.round(bfePt.x), y: Math.round(bfePt.y) },
        groundPt: { x: Math.round(groundPt.x), y: Math.round(groundPt.y) },
        mode: isAuto ? "auto" : "manual",
      };
      // B750 "remember it": persist a slim summary (no bulky geometry) so the readout
      // survives a reload without re-hitting the (flaky) county GIS. Rides the existing
      // settings autosave — no schema change. (B832: skipped for a degraded AUTO run.)
      if (!autoDegraded) setSettings((sx) => ({ ...sx, drainage: { ...(sx.drainage || {}), lastCheck: { ...slimDrainageContext(ctxOut), sig, checkedAt, fetch: fetchRec } } }));
      /* NEW-2(b) — THE LATE ELEVATION. Either the transect was still in flight when the panel
       * published, or the ↻ forced a refresh underneath a cached value. Patch the number (and the
       * remembered record) in place when it lands; a superseded check never writes. */
      const freshFetch = await groundLeg.fresh;
      if (freshFetch) {
        const fresh = await freshFetch;
        if (tok === drainTok.current) {
          setDrainCtx((prev) => (prev && prev.ctx && prev.sig === sig
            ? { ...prev, ctx: { ...prev.ctx, groundElevFt: fresh.ft, groundElev: fresh } }
            : prev));
          if (!autoDegraded) {
            setSettings((sx) => {
              const lc = sx.drainage?.lastCheck;
              if (!lc || lc.sig !== sig) return sx; // a newer check owns the record now
              return { ...sx, drainage: { ...(sx.drainage || {}), lastCheck: { ...lc, groundElevFt: fresh.ft ?? null } } };
            });
          }
        }
        drainGroundState = fresh;
      } else {
        drainGroundState = groundState;
      }
    } catch (e) {
      if (tok === drainTok.current) setDrainCtx((prev) => ({ error: String((e && e.message) || e), prev: prev?.prev }));
      drainCheckError = String((e && e.message) || e);
    } finally {
      /* NEW-4 — ONE row per check, through the SAME production sink the recorder uses, and the
       * SAVE leg is armed for the cloud push this check is about to trigger. Never throws. */
      timer.mark("total", timer.elapsed());
      let drainRowSent = false;
      const emit = () => {
        if (drainRowSent) return;
        drainRowSent = true;
        try {
          reportDrainageTiming(buildDrainageTimingRow({ legs: timer.legs(), auto: isAuto, ground: drainGroundState }));
        } catch (_) { /* an instrument may never break the thing it measures */ }
      };
      // The SAVE leg belongs to the cloud push this check is about to trigger, so wait for it —
      // but only for the attribution window. A save that never comes (signed out, nothing
      // changed, a degraded auto run) must NOT cost the row: an absent report and a zero-cost
      // save look identical to a reader, which is precisely the ambiguity B265536 exists to kill.
      if (!drainCheckError) {
        drainSaveArmed.current = true;
        armDrainageSaveLeg((ms) => { timer.mark("save", ms); emit(); });
      }
      setTimeout(() => { drainSaveArmed.current = false; emit(); }, SAVE_ATTRIBUTION_MS + 250);
    }
  };
  return { drainAutoAttempts, drainCtx, setDrainCtx, drainTok, drainActive, drainCentroid, drainElsSig, drainSigNow, checkDrainage };
}
