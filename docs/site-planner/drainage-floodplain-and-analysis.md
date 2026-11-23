# Site Planner notes: drainage floodplain and analysis

_Moved verbatim out of `src/workspaces/site-planner/CLAUDE.md` (audit batch H, 2026-11-23). Nothing below was reworded, shortened or removed; the folder pointer now only signposts here. Root rules in `/CLAUDE.md` still apply._

- **`lib/detentionRules.js` `CITY_NOTES` (B2671236, 2026-11-12) — a city's own detention POLICY as an ADDITIVE readout note, never a rate and never a reviewer.** Baytown (detention per Ch. 109; straddles Harris/Chambers; Ch. 109 text NOT read, so no rate) and Mont Belvieu (Ord. 2022-020 adopts the Chambers DCM, strictest applies). `authorityForJurisdiction` pushes `{kind:"city-note"}` (same materially-inside gate as `city-criteria-unverified`; carries `name`, never `city`); it is in `AUTHORITY_DERIVED_OVERLAY_KINDS` so a reloaded check does not double it; the readout draws it in place of the generic "city's criteria aren't modeled" line. Do NOT make these `CITY_OVERLAYS` rows (that sets the primary reviewer). Guard: repo-root `test/` **cityDetentionNotes**.
- **⛔ Site Analysis = TRUSTED VERDICTS ONLY (B2117136, owner-approved 2026-10-05) — read before adding a check or a card.**
  A verdict (colour, amount, "None") is issued only by `siteChecks.js`'s declared `TRUSTED_CHECKS` registry, and only where the
  site's region is in that check's `regions` (FEMA + NWI: all; RRC wells + pipelines: TX). Everything else is a map-layer PILL
  (`siteLayerPills.js`) with no claim at all. Rules to keep: **(1)** the region gate is the strictest reading over sampled points of
  EVERY ring, and "Texas" means the box AND `TEXAS_OUTLINE` (the box holds Shreveport/Roswell/Lawton — the RRC knows nothing of
  them, so a green "None" there would be a false clean). **(2)** a failed/timed-out/malformed/truncated source is a `failed` row
  ("Couldn't check" + Retry) — never "None", never green, even with an older stored copy behind it. **(3)** the cache
  (`siteChecksRun.js`) stores MEASUREMENTS under a versioned key (`VERDICT_CACHE_VERSION`), never verdicts — severity is recomputed
  at read time from `CHECK_THRESHOLDS` (the one home for every radius/tolerance; `siteCheckRadius.js` is its boot-safe leaf).
  **(4)** flood/wetland numbers are AREA fractions through clipper on the real rings (save-and-except holes subtracted; 0.2% netted
  against the 100-yr first), never vertex sampling; FEMA publishes the all-clear as polygons, so uncovered ground is "Not fully
  mapped", never "None". **(5)** a "Checked for you" row is CLICK-TO-SHOW, never hover (B2117136 follow-up, owner: "you should click on it to show it permanently instead of a hover"): clicking a row turns its layer on through the SAME overlay key the Layers panel uses (persisted, in sync both ways) and opens its detail; clicking again turns it off. A "None" or "Couldn't check" row has nothing to draw, so it opens a plain note and touches no layer. There is no hover highlight and no dimming of other overlays — the old layer-focus module is deleted, do not bring a focus/dim copy of the overlay state back. The 100-/500-year rows share the `fema` layer and go on and off together. **(6)** the "Who governs" values are SHORT (`siteGoverns.js`: a city value like "Baytown, part ETJ"; the class split rides a second muted line) and a road's count is the length of the very array it lists, with names cleaned by `normalizeRoadName`. **(7) a polygon is CUT TO A 50 m WINDOW around the site before it is measured (`siteChecks.windowFeatures`, problem report 6cea9895) — FEMA answers much of Georgia with ONE county-scale Zone X polygon (702,524 vertices at Chehaw Rd), and measuring it whole froze the planner for 6 s; the measurement also runs in its own task, never in the response's continuation; the polygon queries themselves run in a worker (`siteChecksWorker.js` / `siteChecksTransport.js`, as `fetchArcgisJson`'s `fetchImpl`) that parses and cuts the 16 MB answer off the main thread (`featureWindow.js` is the one cut).** Guard: **siteChecksWindow** (the real answer, every number identical). Orchestrator:
  `siteScreen.js` (`runSiteScreen`; `runSiteAnalysis` is untouched). Guards: repo-root `test/` suites **siteChecks**,
  **siteChecksRun** (every failure path forced), **siteScreenModels**, and ui-audit **verify-site-analysis-trust** (real panel,
  mocked sources with known ground truth; TX + CO arms).
- **⛔ BAKED FEMA FLOOD TILES (B298400–B298402) — the shared model (`shared/gis/`) is the MODEL and the
  one line in it that must not move: A TILE IS A PICTURE, NEVER A NUMBER.** The flood layer can render
  from a per-county PMTiles archive under `public/flood/` — range-read off the same Cloudflare Pages
  origin that serves the app — instead of calling FEMA's `/export` on every pan. Behind
  `VITE_FLOOD_TILES`, **default OFF**. Four things to know before touching any of it:
  **(1) PARCEL-SCALE AUTHORITY IS UNCHANGED.** Tiles are generalised, so they answer the fast picture
  and nothing else; the screening / mitigation math still queries live FEMA, and every tile identify
  card says so. Never let a number a user acts on come off a tile.
  **(2) THE FALLBACK IS A PROPERTY OF A PURE FUNCTION, not a hope.** `resolveFloodSource` answers `live`
  for every way the fast path can be unavailable (flag off · no county · no archive · an archive that
  failed earlier · called with nothing), each with a stated reason. The runtime half is ONE terminal
  `_die()` in `floodTileLayer.js`, which tears the slot down through `layers.js`'s **shared `release`
  helper** and re-enters `syncOverlayLayers` so the raster branch takes over. A per-TILE miss is NOT
  that — an empty tile is the ordinary case.
  **(3) THE ABSENCE RULE DIFFERS BY SOURCE.** The build DROPS unshaded Zone X, so on tiles "no polygon"
  means *outside the mapped floodplain*; on the LIVE layer it means *no effective flood map here*
  (`identifyGap: "flood"`) — the opposite risk position. `floodAbsenceKindFor` is the one place that
  decides, and showing the live wording over a tile answer turns a clean result into a scare.
  **(4) ⛔ CLOUDFLARE PAGES DOES NOT DO HTTP BYTE SERVING — measured, and it refutes the design's own
  premise.** A ranged GET against a real Pages deployment returns **200 with the full body**, no
  `accept-ranges`, on EVERY asset (the 6 MiB archive, `manifest.json`, a plain JS bundle); the control
  through the same proxy returns 206 from other hosts. `pmtiles`' own `FetchSource` REFUSES that, so the
  layer would have thrown on its first read in production and fallen back to live FEMA **silently** —
  while the Vite dev server, which DOES honour Range, kept every test and the headless verifier green.
  The adaptive reader is the flood archive source module: 206 → ranged reads; 200-with-the-whole-body →
  keep it and serve every later read from memory, so the archive is fetched exactly once (concurrent
  cold reads deduped, buffer released by `forgetArchive`). `public/_headers` gives `/flood/*` — and the
  manifest, the same policy, so a refreshed vintage can never appear over stale tiles — an hour of hard
  cache plus a day of stale-while-revalidate. **Do not replace the source with a bare URL.**
  **(5) `floodTileLayer.js` IS LAZY BY CONSTRUCTION and must stay so** — it pulls `pmtiles` +
  `@mapbox/vector-tile` + `pbf` (its own 38 KB chunk). The Leaflet-free half is `floodTileDecode.js`
  (Leaflet needs a `window`, so anything beside it can only be tested through a browser — the
  `adminBoundaryData.js` split). `floodTileStyle.js` is the palette + the painter's draw order (a
  floodway must land ON TOP of the SFHA it sits inside) + the identify wording; `floodManifest.js` is one
  cached fetch of the build manifest, which is where the **NFHL vintage stamp** comes from — and that
  stamp may never disappear, it reports "unknown" instead (B1093's rule).
  The builder is the repo-root build-flood-tiles script (`npm run build:floodtiles`); its
  `--no-feature-limit --no-tile-size-limit` are deliberate, because tippecanoe's defaults DROP features
  out of dense tiles and a silently vanishing floodplain is the worst thing this layer could do.
  Guards: the repo-root `test/` suites **floodTiles** (48 — incl. reading the COMMITTED archives back and
  asserting the 25 MiB Cloudflare Pages per-file cap), **floodTileRender** (22, driven off the real
  Harris archive) and **floodArchiveSource** (9 — both measured host behaviours required to decode the
  same tile feature for feature), plus the ui-audit harness **verify-flood-tiles** (`npm run verify:floodtiles`).
  ⚠ That harness proves tiles PAINT and proves the fallback ENGAGES; it can never prove the live FEMA
  layer paints, because every `hazards.fema.gov` request from Chromium in this sandbox is
  `ERR_CONNECTION_RESET` — it detects that and says so rather than reporting the egress policy as a bug.
- **`buildingFloodExposure.js` (B1207) answers "is my building in the floodplain?" as a NUMBER** —
  per footprint: overlap by area and percent, the governing zone and its BFE. It **reuses** the
  B707/B712 `zonesFromFeatureCollection` + `gridIntersect` + `zoneWaterSurface` chain (never a second
  derivation, so it cannot disagree with the mitigation ledger's flood elevation), and it keeps four
  distinct honest-unknown states — `not checked` / `UNKNOWN` / `none mapped` / the answer — so a
  failed or un-run query can never read as a clean 0%. Rendered inside the Yield → Buildings
  `<Collapse>`, which is why it costs the default view nothing (PANEL-BREVITY).
- **Shallow rock + PDF printing (B2081251/B2081252):** `ssurgoBedrock.js` is the PURE half of the national `soil_bedrock` layer (SDM WFS map-unit polygons ⨝ SDA `muaggatt.brockdepmin`, classes under 20 / 20–40 / 40–60 in; a failure or axis-ambiguous answer throws — never an empty "clear" map; a null depth is unpainted, not "no rock"); its Leaflet half `bedrockLayer` lives in `evidenceLayers.js`. Not in `GIS_SOURCES` (that verifier is /query-shaped) — live arm is ui-audit **verify-ssurgo-bedrock**, app arm **verify-bedrock-paint**. `overlayVectorSvg.esriPrintFeatures` is the ONE rule that prints an `esriFeature` row's lines, points and polygons (default for the kind; `printGeometry:false` opts out). **GIS overlay ink has its OWN print treatment (B2135312):** `exportStyle.OVERLAY_PRINT` + `restyleExportClone`'s `[data-export-vector]` branch — lines >= 1 pt, opacity floor, a pale casing, physical point size; the plan-stroke retarget (0.6 pt) made layers that drew on screen invisible on a dark aerial. Guards: **esriPrintPosition** (known I-75 feature), ui-audit **verify-esri-print-position**. GDOT road data is NOT wired (host unreachable from the sandbox, layer index unknown): ui-audit **verify-gdot-road-data** discovers it.
- Terrain pipeline (B703–B706) — **LOADED ON DEMAND (B1095): `terrainLazy.js` is the ONE entry
  point** (`loadTerrain()` cached import + the synchronous `terrainNow()` the per-move cursor
  sample reads + the `contourHover` router); nothing on the boot path may static-import
  `terrainLayers.js` again, and `terrainGate.js` exists so the layer registry can read the zoom
  gate without dragging the pipeline back in. `contourTrace.js` holds the worker-only
  marching-squares tracer (the sole `d3-contour` consumer) — keep it out of `contours.js`.
  `demGrid.js` / `contours.js` / `flowField.js` (pure math,
  worker-safe) + `lercGrid.js` (the LERC codec, split out in B1042 so `lerc` stays OFF the boot
  bundle — static-imported by the worker, dynamic-imported on the main thread)
  + `terrainWorker.js` (the repo's first Web Worker — import list is test-guarded)
  + `terrainLayers.js` (Leaflet glue, grid LRU for the hover elevation readout);
  `elevation.js` — 3DEP getSamples (point readout + the ground-elevation sampler, survey-ft; the ditch cross-section tool that also used it was removed 2026-11-14; a caller
  signal NEVER disables the timeout — that is how a hung socket used to leave the readout
  in-flight forever). Cursor readouts (NEW-1/NEW-2): `contours.js` owns the pure hover
  HIT-TEST (`buildContourIndex`/`hitContour`) so the polylines stay `interactive:false`;
  `terrainLayers.js` owns the ONE transient hover label (its own sublayer + `setContourHover`,
  fed from each surface's EXISTING throttled cursor move — never a second listener; **B1140:** it is
  anchored at the CURSOR and OFFSET off it via `contours.hoverLabelPlacement`, flipping quadrant near
  a canvas edge and clearing a reserved bottom row, because painting it at the hit point put it under
  the pointer glyph — and the offset span must be `position:absolute`, or the marker div's line-box
  strut drifts it a few px and the edge arithmetic stops being exact) and
  `warmCursorGrid` (the cursor's lattice tile, pulled regardless of layer toggles and of the
  z16 gate — that gate is a cartography rule about 1-ft LINES, not a reason to refuse a POINT);
  `groundReadout.js` + `components/CursorChip.jsx` are the ONE composition + the ONE chip both
  surfaces paint (four honest existing-grade states — it may never render as ABSENCE — plus
  Prop from `proposedSurface.sampleProposedAt`, which walks the SAME `grid.owners` the B826
  earthwork rows price off, so chip and ledger cannot drift).
  `fbcdWse.js` — FBCDD Atlas-14 DRAFT WSE samplers (Fort Bend): 0.2% mosaic → `derivedWse02Ft`,
  per-watershed 100-yr multiplex → `derivedWse1pctFt` (B807). Its `onSample` hook reports ONE timing
  per raster to `drainageTiming.js` (B298563) — a group total cannot say WHICH county layer went slow.
- **⛔ `groundElevation.js` + `drainageTiming.js` (B298560–B298563) — THE DRAINAGE CHECK'S SLOWEST LEG,
  AND THE INSTRUMENT THAT WOULD HAVE FOUND IT. Read the first module's header before touching
  `checkDrainage`.** Measured live on the owner's signed-in Bain plan: the whole re-check cost 3.6–8.5 s
  and ONE call — a USGS 3DEP transect for BARE-EARTH GROUND ELEVATION, whose geometry parameter is
  **byte-identical run to run** — was 68–90% of it, at 997 / 5,761 / 7,702 ms for the same query.
  **Four things not to undo:** **(a)** the cache key is built from `elevation.profileQuery`, the SAME
  derivation that builds the URL, so a change to the georeference, the parcels or the transect rule is a
  MISS rather than a stale read — never loosen it to a rounded lat/lng or a site id, because serving
  elevation for the wrong ground is the whole failure mode; it lives in `gisCache`'s IndexedDB tier
  (TIER-BY-REBUILDABILITY — re-fetchable cache may never compete with saved plans in the ~5 MB store).
  **(b)** the transect starts at t=0 and the panel is NOT gated on it: `GROUND_PUBLISH_BUDGET_MS` (1.5 s)
  bounds how long the PUBLISH waits, `GROUND_TIMEOUT_MS` (8 s) bounds the REQUEST, and the late answer
  patches the number, the freshness dot and the remembered record in place. Four states, never fewer —
  `value` / `void` / `pending` / `unavailable` — and **NEVER a default elevation**, because an assumed
  ground surface is how a detention volume comes out confidently wrong. **(c)** the ↻ bypasses the cache
  as a FORCE REFRESH, not a blocking re-read (the owner needs both "the button corrects a wrong cached
  value" and "the press is fast"), and a cache hit is LOUD in the freshness hover with its age.
  **(d)** ⛔ **NEITHER MODULE MAY REJOIN THE SITE ROUTE'S STATIC GRAPH** — both are reached only by the
  dynamic `import()` inside `checkDrainage`; static they put 8.8 KB on the largest chunk and breached its
  ceiling. That is why the hover sentence travels WITH the state (`groundElev.note`) instead of the render
  calling back into the lib, and why the save-leg stamp in `cloudPushWithWatchdog` is gated on a ref.
  Guards: the repo-root `test/` suites **groundElevation** (28, incl. both source guards),
  **drainageTiming** (26) and **elevation**, plus the e2e spec **drainage-elevation-latency**
  (mutation-proven both ways: restoring the gate reddens the publish arm alone, removing the cache
  reddens the held-value arm alone).
- Detention outlet / routing / criteria tier (NEW-A, Phase A): `detentionCriteria.js` (the versioned
  jurisdiction criteria registry — cited outlet/geometry criteria, referencing `detentionRules.js` for
  the verified release/storm/freeboard facts; audit + overrides), `outletStructure.js` (per-pond
  orifice/weir/restrictor model + stage→discharge rating curve), `stageStorageDischarge.js` (pairs
  `pondGeom` storage with the outlet curve), `pondRouting.js` (modified-Puls reservoir routing proving
  Post ≤ Pre per storm), `receivingWater.js` (nearest NHDPlus HR receiving water for the outfall +
  easement flag). All pure/Node-tested.
- Public-data inputs tier (NEW-B, Phase B): `curveNumber.js` (SCS CN runoff), `soils.js` (SSURGO
  Soil Data Access — HSG + seasonal-high water table; SDA proxy-blocked in sandbox → live-verify),
  `tailwaterSource.js` (PR-N/O5 — the outfall receiving-water source ladder: district channel →
  FEMA InFRM est-BFE → USGS gauge → normal-depth → terrain channel-flowline, NEVER site grade;
  the grade placeholder deadlocked every pond, so `deriveTailwater` rejects any grade-equal
  candidate and returns UNKNOWN when no real below-grade source resolves),
  `groundwater.js` (wet-vs-dry pond feasibility from combined SSURGO + TWDB depth-to-water),
  `subsidence.js` (Harris-Galveston / Fort Bend subsidence-district cited flag registry),
  `pfdsClient.js` (NOAA Atlas-14 rainfall via the `functions/api/pfds.js` proxy — live-reachable),
  `twdbWells.js` (TWDB observation-wells interface, endpoint live-verify pending). All pure/Node-tested.
- Deal-screens tier (NEW-C, Phase C): `upstreamArea.js` (extends `flowField.js` D8 → flow-accumulation
  over the 3DEP DEM → upstream contributing area + the offsite-drainage "engineer's check" flag) +
  `regionalDetention.js` (regional-detention / fee-in-lieu cited registry + on-site-vs-fee buildable-SF
  comparison). Pure/Node-tested.
- Pond optimizer affordance (NEW-1, 2026-07-28): `pondOptimizeAffordance.js` — decides WHEN the
  optimizer is offered (POSSIBILITY only: drawn ring · known requirement · resolved split — NEVER
  verdict tone; the old tone coupling is what made the button vanish from an all-green panel) and
  whether a smaller basin is worth a line (`materialAlternative` → null means render NOTHING).
- Flood-level sensitivity (NEW-4): `wseSensitivity.js` — sweeps the SAME `evalAtWse` the live panel
  uses across criteria-configurable steps above the governing flood surface; absolute deltas only.
- Screening BFE (NEW-3 → completed): `screeningBfe.js` — the app's FIRST real hydrology + hydraulics
  (SCS unit-hydrograph peak, Manning normal depth over a terrain-sampled section). Every other
  "derived" WSE in this codebase reads FEMA's published number; this one computes one. **Now LIVE-WIRED**
  by `screeningBfeSite.js` (the four inputs: a D8 watershed delineated over a WIDE coarse 3DEP window,
  NOAA Atlas-14 rainfall via `pfdsClient`, SSURGO soils via `soils.js` + the `functions/api/soils.js`
  proxy, and a section from `channelSection.js`) — producing BOTH the 1% and the 0.2% (500-yr)
  elevations Waller ordinance §5.C(3) mandates, from ONE derivation. It reaches the panel as a
  `wseProviders` registry entry (`screening-bfe`), so the existing estimate row, provider labels and
  cross-provider delta render it with no new surface. `channelSection.js` also carries the
  watershed-TRUNCATION guard: a basin running off the terrain window returns an honest unknown rather
  than an understated flood level. `screeningDeclined` (B1089) is the ONE place the study's honest UNKNOWN becomes owner-facing copy:
  a short NAMED STATE for the visible line plus a REASON-SPECIFIC implication behind the fold — a flat
  reach says outright that screening has run out and a sealed H&H model is required (tied to §5.C(3)),
  while an unreachable source deliberately says the opposite. It is rendered by the est-BFE line, whose
  condition reads `bfeFt` only POSITIVELY: a committed estimate must never suppress the fact that a
  better method was tried and declined (that suppression WAS the B1089 bug).
  The §5.C(3) submittal trigger itself is a VERIFIED, firing rule —
  `floodplainRules.waller.bfeDataRequirement` + `bfeDataRequirementFor` / `atlas14Mandated`.
  **⛔ NEW-1 — THE ENGINE IS OFF THE BOOT PATH, AND `screeningBfeCopy.js` IS WHAT KEEPS IT THERE.**
  This engine runs in exactly ONE place — `checkDrainage`'s async block, on an unstudied Zone A site
  with no published or manual 1% surface — and yet every byte of it rode the Site route's critical
  path on every load of every site, because a handful of CONSTANTS and three pure COPY functions were
  exported from the same modules and are needed by the RENDER BODY. A static import of one export
  pulls the whole module (tree-shaking drops unused exports, never an export a sibling uses), so the
  render body's need for `screeningBfeHeadline` was enough to hoist the lot. `screeningBfeCopy.js` is
  the dependency-free LEAF holding the words (`screeningBfeHeadline` / `screeningDeclined` /
  `screeningStudyNote`), the constants (`NOT_MODELED` · `CLOMR_NOTE` · `SCREENING_DISCLAIMER` ·
  `WATERSHED_*` — the last two needed to build the terrain bounds BEFORE the engine is awaited) and
  the acres/lots threshold test (`BFE_DATA_REQUIREMENT` / `bfeDataLikelyRequired`, called every
  render). `screeningBfe.js` and `screeningBfeSite.js` re-export all of it, so no importer changed.
  Measured: **43.6 KB of source out of the largest chunk, −13.3 KB minified off BOTH the Site route
  and `largestChunkBytes`**; the engine now downloads concurrently with the three data pulls it needs,
  so the branch costs no wall-clock. **Three things not to undo:** the leaf may NEVER import the
  engine or anything that does (one edge back and the split silently buys nothing); the constants in
  `screeningBfe.js` are IMPORTED-then-re-exported, not forwarded with a bare `export … from`, because
  its own functions reference them in scope (the trap `titleReader.js` documents); and
  `floodplainMitigation.js` — also on the boot path — must take its two constants from the LEAF, never
  from the engine. Same shape as `terrainGate.js`/`terrainLazy.js`. Run the ui-audit bundle audit
  before pushing any change to these imports: lint, tests and build all stay green on the regression.
- Pond economics optimizer (NEW-D, Phase D): `pondOptimizer.js` — searches depth × placement pond
  configurations (deeper-smaller vs shallower-bigger, pond-cut-as-pad-fill dirt balance) under
  constraints (max depth, Phase-B groundwater ceiling, 30-ft maintenance berm, pipeline-corridor
  exclusions) and ranks by earthwork $, land-take acres, and buildable-SF recovered — reusing
  pondGeom/pondSizing machinery. Pure/Node-tested.
- Yield storage-truth tier (Cowork review B1019–B1028): `pondStageModel.js` is **THE** per-pond
  stage-storage / elevation-band representation — stage table, the declared non-overlapping
  detention/mitigation duty split, the outfall-invert split, both gravity-drain tests, and the
  prism-vs-extrusion delta. Detention, mitigation, drawdown, gravity and cut/fill all READ it;
  nothing re-derives storage from a footprint.
  **⛔ B236592 — IT IS MEMOISED, AND EVERY CLIPPER CALL BENEATH IT IS TOO. Read this before touching
  `pondStageModel.js` or `pondOffset.js`.** `drainFacts()` in `SitePlanner.jsx` is *deliberately*
  GATING rather than memoising, so with the Yield panel docked this model was rebuilt **156 times per
  pond per pan gesture** on ponds nobody had touched — 275,184 `offsetInward` executions in ONE pan,
  and **55,631 ms of a 55,760 ms gesture** inside clipper-lib's intersection sweep. Compounding it,
  `pondElevations` was re-derived *inside its own consumer* (`stageTable` asks once, and twice more
  per band via `areaAtElev`), so a 7-band pond paid the 29-execute pinch-off search 15 times for a
  constant — **that is the term that LOOKED superlinear, and it is a constant re-derived a linear
  number of times.** The fix is memoisation and **no formula was touched**: keyed on the ring's
  IDENTITY (the planner replaces `points` wholesale on edit, never mutates in place) plus det/opts by
  VALUE, so the key IS the inputs and a stale engineering number is impossible — which is the very
  property `drainFacts`'s gating comment exists to protect. Result **55,760 → 505 ms per pan** with
  the owner's surveyed rings untouched and the canvas byte-identical.
  **⚠ THE RESULTS ARE SHARED — read-only, like every memo in this tree** (`offsetInward` returns
  cached ring arrays; audited: every consumer measures them or maps them to a path string).
  **⛔ TWO THINGS THIS REFUTES, so they are not re-chased:** `interiorFitter` costs **0.5 ms** of that
  gesture and is EXONERATED (B221761's memo works); and **there is no superlinear per-vertex law** —
  collinear midpoint insertion, which raises vertex count while holding area, perimeter, bbox and the
  drawn path exactly, measures an exponent of **0.20**. Decimation preserved the bounding box but not
  the CONCAVITY that loads clipper, which is why `docs/perf/PERF-REAL-PLANS.md` §5.5 read a recurrence as a
  vertex law; §5.6 is the correction. Guards, all counting INVOCATIONS rather than milliseconds:
  the repo-root `test/` suites **pondViewIndependence** (mutation-checked 16 green → 4 red) and
  **pondStorageGoldenMaster** (78 assertions of EXACT equality — these numbers size his basins, so
  there is no tolerance), plus the ui-audit harnesses **count-pond-invocations** (`--assert`: a pan
  recomputes NO pond geometry, and the cached lookups must be OBSERVED so an empty report cannot pass
  as a clean one) and **profile-pond-ring**.
  **⛔ B221763 — AND THE POND LEDGER PASS ABOVE IT RESOLVES ONCE PER MODEL CHANGE TOO, gated on
  `lib/pondLedgerKey.js`.** B236592 made the leaves free and left the RECURRENCE: the render body
  still rebuilt every pond's ledger entry once per render — measured at **254 calls each** of
  `usablePondVolume` / `incrementalExcavationCf` / `excavationVolume` on one pan of a two-pond
  plan, and **0** after. The key is a **VALUE signature**, not a `useMemo` dep array, for two
  reasons that both matter: a hand-maintained dep list that misses one input is a stale
  engineering LEDGER (this item's own filed fear), and most of these inputs (`fmElev`, `pondAuto`,
  `detRegime`) are FRESH OBJECTS holding identical values every render, so `Object.is` calls them
  changed 100% of the time and a dep array would never have hit. The one input keyed by IDENTITY
  is the pond ELEMENT — safer than any field list, because it changes on edits to fields nobody
  thought to enumerate. `accumulatePondLedger` rides the same boundary via an identity cache.
  Guards: the repo-root `test/` suite **pondLedgerKey** (a planted change in EVERY declared input,
  GENERATED from `POND_LEDGER_INPUTS` so a new input with no fixture fails on the spot;
  mutation-proven three ways) and `count-pond-invocations --assert`, where `pondLedgerSignature`
  sits in `MUST_BE_PRESENT` so an empty report cannot pass as a clean one.
  Its consumers: `storageReconcile.js` (claimed
  service vs storage that physically exists — a hard FAIL on a double-count), `drawdownTime.js`
  (time-to-empty at the allowable release rate), `mitigationBands.js` (the 1-ft hydraulic-equivalence
  band ledger, fed by `floodplainMitigation`'s opt-in `bandSpans`), `floodAdministrator.js` (who
  governs the floodplain + the BFE implied by an FFE), `apronElevation.js` (the truck court, checked
  apart from the pad), `cutFillBalance.js` (borrow-driven vs genuine storage slack). All pure/Node-tested
  (one suite + one headless render harness, both named "yield-storage-review").
- `detentionRules.js` — Houston-MSA detention criteria as versioned rule records + the
  drainage-authority resolver, tier/regime assessors, pond auto-size solvers (B636–B642,
  code-labeled B629–B635; pure, injectable fetch/cache — mirror of `jurisdiction.js`). `pondGeom.js` holds
  `detentionStorage` (the pond stage/volume calc shared by panel, yield metrics, solver) plus the
  B708 anchored tier (`bandedStorage` / `usablePondVolume` — the ONE per-pond usable/dead split).
- Floodplain suite (B707–B712): `floodplainRules.js` / `floodplainMitigation.js` (compensating-storage
  engine, pure; incl. the NEW-1 Waller floodway-buffer screen + the NEW-2 Zone-A boundary-grade WSE
  estimator + the NEW-3 HAG proxy), `pondCriteriaRules.js` (berm/slope/freeboard criteria),
  `buildability.js` (FFE/LOMR-F; `when`-conditioned multi-basis rows + `suggestedFfe`),
  `pondSizing.js` (NEW-4 two-target pond sizing assistant over the B708 bands),
  `pondChangeSummary.js` (B909 round 4 — pure before/after delta rows + the atomic gap-proposal
  sentence for the persistent "what changed" card after ⚡ Design pond),
  `pondVerdict.js` (the ONE derivation of the pond inspector's detention + mitigation verdict rows:
  the headline NAMES its ledger, buildability + the over-provision "over-dug" state ride a demoted
  qualifier line, and the criteria-configurable over-provision slack `overdugAcFt` lives here —
  `ledgerBalancer.js` re-exports it and the print sheet reads it, so screen/print/balancer can't drift),
  `pondSectionModel.js` + `components/PondSection.jsx` (PR-L — the ONE developer-readable pond
  cross-section: pure geometry + collision-free labels → responsive SVG, used by BOTH the Optimize
  card and the pond inspector),
  surfaced via the **Drainage** module's collapsed verdict groups (B824 — ONE drainage home, moved
  out of Yield's old "Stormwater" section by the NEW-1 Drainage split, 2026-09-05: Analysis
  screens, Drainage decides, Yield reports what's left over — see the KEY DECISIONS entry in the
  root `/CLAUDE.md`). `SitePlanner.jsx`'s `DrainagePanel` (its own module-scope component, right
  after `YieldPanel`) owns the verdict strip, the detention/mitigation detail groups, buildability,
  and the buildings-in-floodplain check; `YieldPanel` keeps land use/coverage/costs and shows the
  pond only as one Land Use line linking into Drainage; Analysis keeps a one-line present/absent
  flood row (its own freshness stamp suppressed — SiteAnalysis.jsx) linking into Drainage too.
  Estimated-BFE providers for unstudied Zone A (B882): `wseProviders.js` (pure pluggable registry +
  precedence resolver: district → FEMA InFRM EBFE → grade) + `ebfe.js` (FEMA InFRM EBFE /identify
  sampler) + `hcfcdWse.js` (HCFCD MAAPnext WSE sampler, Harris) + `estimateChallenge.js` (the pure
  sanity-check / ±1 ft sensitivity band / cross-provider disagreement "challenge the estimate" layer).
- Yield-panel provenance (B895): `provenance.js` — the six-word SourceTag vocabulary (CODE/PLAN/
  SURVEY/ESTIMATE/YOURS/UNVERIFIED) + color-token map + `classifyWseSource`/`classifyVerified`
  (pure mappings from signals the engine already computes — WSE_PROVIDER_LABEL codes, the
  `pondAutoValues` `verified` flag — to a tag). Consumed by `components/SourceTag.jsx` (the
  right-aligned pill + Basis popover; the one-time "Sources ⓘ" legend component was
  removed unused, 2026-11), `components/WatchOutChip.jsx` (the one ⚠ item-specific-risk rendering), `components/
  ActionLink.jsx` (the accent-colored "do something" affordance, distinct from a passive tag), and
  `components/YieldFooterDisclaimer.jsx` (the ONE persistent screening disclaimer).
