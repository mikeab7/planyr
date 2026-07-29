# Site Planner workspace — folder pointer

Site yield analysis + layout. The mature workspace. Root rules in `/CLAUDE.md` still apply;
deep internals are in `/docs/REFERENCE.md` (Site Model, map-layer system, Supabase, GIS).

**Entry points**
- `SitePlannerApp.jsx` — workspace root (lazy-loaded chunk).
- `MapFinder.jsx` — map/site picker. `SitePlanner.jsx` — the hand-rolled SVG planner canvas.

**Key `lib/` (canonical, read-before-edit)**
- `siteModel.js` — the per-plan schema (`createSiteModel`, `SITE_MODEL_VERSION`); read via
  selectors, persist via `storage.js`. **Additive only** — bump the version, extend `migrate`.
- `storage.js` — thin model layer (migrate on read, merge+renormalize on save).
- `layers.js` + `components/LayerPanel.jsx` — map-layer system; `layerPrefs.js` (per-site Layers-panel
  toggle memory — NEW-1, sparse on/off overrides restored on open + persisted on toggle); `coverage.js` (coverage engine);
  `arcgis.js`/`counties.js`/`layerRequest.js` — GIS plumbing; `gisCache.js` — screening cache;
  `vectorLayers.js` (pure vector engine — polygons AND lines — + boundary/pipeline registry) +
  `vectorOverlay.js` (cached boundary/pipeline/corridor render + identify + labels glue) +
  `boundaryLabels.js` (pure label math) — the B694/B695 tier; `basemaps.js` — the shared Esri/USGS
  aerial-source registry (B693). Pipelines (B751/B752): `pipelineCommodity.js` (commodity crosswalk +
  fixed hazard symbology + legend) + `pipelineCorridor.js` (pure assumed-easement buffer geometry).
  Flood & drainage group (B1075–B1080, B1091): `floodGroup.js` — the pure group model (four
  provenance tiers, master-toggle state, and the honest empty-state copy: what FEMA actually
  reported, why a district isn't listed, the governing-district drainage line). `floodRowRelevance`
  is the ONE scoping gate — governing district → district county reach → the row's own declared
  `areaCounties` → the coverage engine's published-extent verdict — so a source that cannot cover
  this site is demoted (behind one collapsed line, WITH its reason), never silently listed.
  **B1091(×2), read before touching the scoping:** a district-vs-district exclusion requires an
  EXCLUSIVE answer (`governingDistrict().exclusive`) — a boundary containment, or a county answer
  whose rivals were each boundary-tested and cleanly excluded (`drainageDistrict.tested`). A bare
  county guess may only demote a district that cannot REACH the county; otherwise it fails open.
  And the county it reasons over is the site IDENTIFY county / `LayerPanel`'s `siteCounty` prop —
  **never the `county` prop**, which is the layer-registry key and defaults to Harris on every site.
  **B1091(×3): the group may never render BLANK.** Every other line here is conditional on a resolved
  drainage context, so a surface without one said nothing at all — `floodFactsNote` owns that state
  (not-checked / county-unresolved) and goes silent once the facts are in, so it can't accumulate.
  Related trap: **BOTH hosts stay mounted** (`SitePlannerApp` hides the inactive one with
  `display:none` to keep its map alive), so the DOM always holds TWO copies of this panel and the
  hidden one has no context. The inactive mode is now `inert` + `aria-hidden`, and each panel stamps
  `data-surface="planner"|"finder"` — **assert against the surface, never against page text.**
  Canvas identify (B1092; tolerance fixed in the NEW-3 strand — `hitFeature` applies the caller's
  slop to polygon ring EDGES as well as lines, two-pass so an exact containment still wins, because
  containment-only gave a 70 ft easement band a click target its own width and no more):
  `vectorLayers.hitFeature` / `identifyRows` are the pure half,
  `vectorOverlay`'s `group.identifyAt` the accessor, `layers.identifyOverlaysAt` the opt-in gate
  (`cfg.canvasIdentify`) — the planner's SVG canvas owns every click, so this is how a tap there
  reaches the same answer the map finder's Leaflet popover gives. `nhdFlowline.js` — the USGS NHD FType → plain-English
  crosswalk (336 → "canal / ditch"), the universal channel fallback's decoder. The BKDD
  (Brookshire–Katy Drainage District) endpoints live in the shared GIS source registry like every
  other source; `detentionRules.js` owns the district-aware `resolveDrainageContext`.
- Site-plan overlay import (B72/B73/B747/B748/B749): `overlayPdf.js` (PDF+DXF raster, banded
  white-knockout, zoom-aware re-raster) + `overlayScale.js` (scale/trace math) + `overlayStorage.js`
  (Storage backup) + `dxf/` (worker parse via `dxf-parser` + entity→SVG render + true-units auto-scale)
  + `convertClient.js` (DWG→DXF through the B238 convert service, gated on `VITE_CONVERT_URL`).
- **Colorado (NEW-5/7/8):** `coloradoRegions.js` is THE guard — a network-free site→state
  resolution (it must hold when every GIS endpoint is down, which is exactly when a site falls
  through to a default), the four drainage regimes (MHFD covers 6 of the 9 target counties;
  Larimer, Weld and El Paso each say outright they are NOT MHFD), the CWCB 2 CCR 408-1 statewide
  floodplain floor (stricter than FEMA on freeboard, critical facilities and floodway rise), and
  the `CAPABILITIES` matrix that makes an unwired capability render a NAMED "not available in
  Colorado yet" state. `computeRequiredDetention`'s `siteState` guard is its enforcement point and
  runs **before** the acreage check and the authority lookup, so a Texas authority forced onto a
  Colorado site still cannot price. `drawdownStatute.js` turns the existing drawdown number into
  C.R.S. 37-92-602(8) — and never reports "pass", because the screening figure is an optimistic
  lower bound. Colorado counties live in `counties.js` under `co_`-prefixed keys (both states have
  an El Paso and a Jefferson). **Any change here is gated on the Texas golden-master suite under test/.**
- `supabase.js` / `auth.js` / `cloudSync.js` — cloud data + auth (shared across workspaces).
- `elementSync.js` / `elementRows.js` / `elementJournal.js` — the element-level sync engine, the
  rows↔model fold layer (incl. `foldJournal`), and the persisted pending-edit journal (NEW-F4:
  a failed commit survives a reload instead of being reverted by the rows-canonical refetch).
  **B1094/B1098, read before touching the write path:** a bonded assembly (a host + everything
  `attachedTo` it) is ATOMIC on the wire. `flush()` first closes the assembly (`closeAssemblies`)
  so every member lands in ONE commit, then re-reads each op's bytes from the live canvas
  (`freshen`, via the injected `liveCollections()`) so a payload captured before a gesture can't
  reach the server — those two together are what stops a drag tearing a building off its truck
  court. Undo/redo is a gesture boundary: `applySnapshot` flushes against the SNAPSHOT (never
  `stateRef`, which React hasn't re-rendered yet). **B1099:** a genuine foreign row beats a pending
  DERIVED op — derived churn is never re-pushed over another writer — while a pending DIRECT user
  edit still wins and still toasts (the B673 matrix, unchanged). **B1097:** `rowsToModel` runs the
  SAME `normalizeBondedChildren` heal as `createSiteModel` — never wire a load-time repair to only
  one of the two read paths (the B1012 trap).
- `planClipboard.js` — the ONE general canvas clipboard (NEW-2/NEW-6): collect the current selection
  (elements expanded to their `attachedTo` assembly, so a building brings its truck court / trailer
  parking / dock zones / bump-outs), then paste with fresh ids, bonds remapped INSIDE the copy, and
  relative geometry preserved. A pasted parcel arrives INACTIVE by design (can't double-count site area).
- `standardsApply.js` + `userPrefs.js` + `components/StandardsBar.jsx` — Standards scope + retroactive
  apply. `standardsApply` is the pure engine (parcels are stamped → WRITE the value; elements
  resolve at render → CLEAR the per-element override) plus `applyAllStandards` — ONE Apply for the
  whole panel, counted in distinct OBJECTS — and `derivedPanelScope`, which reads (never writes)
  where the account already carries a default. `StandardsBar` is the panel's sticky footer: ONE
  scope + ONE Apply, replacing the per-field chip row that was most of the panel's height. `userPrefs` is the account-level store
  (`public.profiles.prefs` jsonb, own-row RLS — `db/user_prefs.sql`) behind the "All projects" scope,
  published into `planStyle`'s account layer (`setAccountStyleDefaults`). Precedence: built-in <
  account < project < per-object.
- `zOrder.js` — per-element `z` stacking key utilities (`nextZ`/`sortByZ`/`normalizeZ`/`ensureZ`, B671).
  `arrange.js` — pure z-order "Arrange" (`reorderByZ`/`arrangeFlags`, B820): Bring-to-Front/Send-to-Back
  over a peer set (a building reorders within its `Z_LAYER` band, a markup within the markup layer;
  a markup can also be sent behind the elements). Wired via `arrangeSel` + the right-click menus + the
  ⌘/Ctrl+]/[ chords in `SitePlanner.jsx`.
- `labelLayout.js` — LOD label tiering + the shared dimension-number zoom→font scale (`dimFontPx`, B911)
  + the quieter pond design-parameter tier (`pondParamLabelVisible`/`pondParamFontPx`, B1016 — the berm
  tag, floor/WS elevations and the rim-to-floor line reveal only when the band they measure reads on screen).
  `calloutLayout.js` — pure text-box/callout box geometry: auto-size or wrap-to-width (B913).
  `roadGeometry.js` — centerline road curves + junction primitives (pure): `teeGeometry` returns the
  ADDITIVE curb-return `wedges` a junction contributes. `roadNetwork.js` — the DISSOLVED road surface
  (clipper union of every connected strip + wedge → one region, one outline, per cluster) plus the
  curb-stripe trimmer. A road connection is a boolean union, NOT a patch painted over a seam — read
  roadNetwork.js's header before touching anything junction-shaped.
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
  `elevation.js` — 3DEP getSamples (cross-section tool + point readout, survey-ft; a caller
  signal NEVER disables the timeout — that is how a hung socket used to leave the readout
  in-flight forever). Cursor readouts (NEW-1/NEW-2): `contours.js` owns the pure hover
  HIT-TEST (`buildContourIndex`/`hitContour`) so the polylines stay `interactive:false`;
  `terrainLayers.js` owns the ONE transient hover label (its own sublayer + `setContourHover`,
  fed from each surface's EXISTING throttled cursor move — never a second listener) and
  `warmCursorGrid` (the cursor's lattice tile, pulled regardless of layer toggles and of the
  z16 gate — that gate is a cartography rule about 1-ft LINES, not a reason to refuse a POINT);
  `groundReadout.js` + `components/CursorChip.jsx` are the ONE composition + the ONE chip both
  surfaces paint (four honest existing-grade states — it may never render as ABSENCE — plus
  Prop from `proposedSurface.sampleProposedAt`, which walks the SAME `grid.owners` the B826
  earthwork rows price off, so chip and ledger cannot drift).
  `fbcdWse.js` — FBCDD Atlas-14 DRAFT WSE samplers (Fort Bend): 0.2% mosaic → `derivedWse02Ft`,
  per-watershed 100-yr multiplex → `derivedWse1pctFt` (B807).
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
- Pond economics optimizer (NEW-D, Phase D): `pondOptimizer.js` — searches depth × placement pond
  configurations (deeper-smaller vs shallower-bigger, pond-cut-as-pad-fill dirt balance) under
  constraints (max depth, Phase-B groundwater ceiling, 30-ft maintenance berm, pipeline-corridor
  exclusions) and ranks by earthwork $, land-take acres, and buildable-SF recovered — reusing
  pondGeom/pondSizing machinery. Pure/Node-tested.
- Yield storage-truth tier (Cowork review B1019–B1028): `pondStageModel.js` is **THE** per-pond
  stage-storage / elevation-band representation — stage table, the declared non-overlapping
  detention/mitigation duty split, the outfall-invert split, both gravity-drain tests, and the
  prism-vs-extrusion delta. Detention, mitigation, drawdown, gravity and cut/fill all READ it;
  nothing re-derives storage from a footprint. Its consumers: `storageReconcile.js` (claimed
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
  surfaced via the Yield → Stormwater collapsed verdict groups (B824 — ONE drainage home; the old Site Analysis sibling card was merged in and deleted; Analysis keeps a link row).
  Estimated-BFE providers for unstudied Zone A (B882): `wseProviders.js` (pure pluggable registry +
  precedence resolver: district → FEMA InFRM EBFE → grade) + `ebfe.js` (FEMA InFRM EBFE /identify
  sampler) + `hcfcdWse.js` (HCFCD MAAPnext WSE sampler, Harris) + `estimateChallenge.js` (the pure
  sanity-check / ±1 ft sensitivity band / cross-provider disagreement "challenge the estimate" layer).
- Grading/earthwork tier (B808/B809/B825/B826): `gradingRules.js` (per-surface-class slope registry
  with provenance) + `proposedSurface.js` (pure auto-grade engine: per-element planes, composite
  cut/fill lattice, balance assist, ADA-legal vs screening violations) + `mitigationHeatmap.js`
  (engine-truth cell painter — B809 fill-depth mode AND the B826 cut/fill diverging mode); earthwork
  rows live in Yield → "Earthwork cost (screening)"; mitigation prices fill at the proposed surface
  when it exists (`fp.surfaceAt`, labeled), flat pad as the fallback.
- Yield-panel provenance (B895): `provenance.js` — the six-word SourceTag vocabulary (CODE/PLAN/
  SURVEY/ESTIMATE/YOURS/UNVERIFIED) + color-token map + `classifyWseSource`/`classifyVerified`
  (pure mappings from signals the engine already computes — WSE_PROVIDER_LABEL codes, the
  `pondAutoValues` `verified` flag — to a tag). Consumed by `components/SourceTag.jsx` (the
  right-aligned pill + Basis popover), `components/SourcesLegend.jsx` (the one "Sources ⓘ" panel
  legend), `components/WatchOutChip.jsx` (the one ⚠ item-specific-risk rendering), `components/
  ActionLink.jsx` (the accent-colored "do something" affordance, distinct from a passive tag), and
  `components/YieldFooterDisclaimer.jsx` (the ONE persistent screening disclaimer).

- Export path (B1042): `exportSheet.js` is the ONE home for PDF/PNG/KMZ sheet composition, the
  B839 aerial tile Stitcher, and GIS raster/vector capture. It is **loaded on demand** (dynamic
  `import()` from `SitePlanner.jsx`, warmed when the File menu opens) and reads planner state
  through a `ctx` object rebuilt per call — add a key there, never a new closure capture. Its
  helpers (`printSheet.js`, `sheetFurniture.js`, `exportStyle.js`, `imagePdf.js`, `kmzExport.js`,
  `overlayVectorSvg.js`) must NOT gain a static importer on the boot path or they rejoin the
  critical-path chunk. `exportLabelScale.js` (B1085) is the ONE place that decides what scale the
  LABEL tier reasons at: the view on screen, the SHEET's own px-per-foot on an export pass — so
  declutter/LOD/collision, label sizes and stroke-zoom are a function of the plan and the paper,
  never of the live zoom. It IS on the boot path (SitePlanner imports it statically, ~1 KB pure). PDF-PARITY: `printMetricPairs`/`printStormwaterBars` deliberately stay in
  `SitePlanner.jsx` so screen and sheet read one derivation.

**Conventions:** feet everywhere internal (convert only at the map boundary); theme tokens
never raw hex; inline editors never `window.prompt/confirm/alert`. See `/CLAUDE.md` KEY DECISIONS.

<!-- Keep this pointer current: if you rename/move/delete a key file in this folder, update the
     lines above in the same commit. The doc-pointer-audit check fails CI on a stale reference. -->
