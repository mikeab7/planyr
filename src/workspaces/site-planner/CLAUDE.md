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
- `layers.js` + `components/LayerPanel.jsx` — map-layer system; `coverage.js` (coverage engine);
  `arcgis.js`/`counties.js`/`layerRequest.js` — GIS plumbing; `gisCache.js` — screening cache;
  `vectorLayers.js` (pure vector engine — polygons AND lines — + boundary/pipeline registry) +
  `vectorOverlay.js` (cached boundary/pipeline/corridor render + identify + labels glue) +
  `boundaryLabels.js` (pure label math) — the B694/B695 tier; `basemaps.js` — the shared Esri/USGS
  aerial-source registry (B693). Pipelines (B751/B752): `pipelineCommodity.js` (commodity crosswalk +
  fixed hazard symbology + legend) + `pipelineCorridor.js` (pure assumed-easement buffer geometry).
- Site-plan overlay import (B72/B73/B747/B748/B749): `overlayPdf.js` (PDF+DXF raster, banded
  white-knockout, zoom-aware re-raster) + `overlayScale.js` (scale/trace math) + `overlayStorage.js`
  (Storage backup) + `dxf/` (worker parse via `dxf-parser` + entity→SVG render + true-units auto-scale)
  + `convertClient.js` (DWG→DXF through the B238 convert service, gated on `VITE_CONVERT_URL`).
- `supabase.js` / `auth.js` / `cloudSync.js` — cloud data + auth (shared across workspaces).
- `elementSync.js` / `elementRows.js` / `elementJournal.js` — the element-level sync engine, the
  rows↔model fold layer (incl. `foldJournal`), and the persisted pending-edit journal (NEW-F4:
  a failed commit survives a reload instead of being reverted by the rows-canonical refetch).
- `zOrder.js` — per-element `z` stacking key utilities (`nextZ`/`sortByZ`/`normalizeZ`/`ensureZ`, B671).
  `arrange.js` — pure z-order "Arrange" (`reorderByZ`/`arrangeFlags`, B820): Bring-to-Front/Send-to-Back
  over a peer set (a building reorders within its `Z_LAYER` band, a markup within the markup layer;
  a markup can also be sent behind the elements). Wired via `arrangeSel` + the right-click menus + the
  ⌘/Ctrl+]/[ chords in `SitePlanner.jsx`.
- `labelLayout.js` — LOD label tiering. `roadGeometry.js` — centerline road curves (pure).
- Terrain pipeline (B703–B706): `demGrid.js` / `contours.js` / `flowField.js` (pure math,
  worker-safe) + `terrainWorker.js` (the repo's first Web Worker — import list is test-guarded)
  + `terrainLayers.js` (Leaflet glue, grid LRU for the hover elevation readout);
  `elevation.js` — 3DEP getSamples (cross-section tool + point readout, survey-ft);
  `fbcdWse.js` — FBCDD Atlas-14 DRAFT WSE samplers (Fort Bend): 0.2% mosaic → `derivedWse02Ft`,
  per-watershed 100-yr multiplex → `derivedWse1pctFt` (B807).
- Deal-screens tier (NEW-C, Phase C): `upstreamArea.js` (extends `flowField.js` D8 → flow-accumulation
  over the 3DEP DEM → upstream contributing area + the offsite-drainage "engineer's check" flag) +
  `regionalDetention.js` (regional-detention / fee-in-lieu cited registry + on-site-vs-fee buildable-SF
  comparison). Pure/Node-tested.
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

**Conventions:** feet everywhere internal (convert only at the map boundary); theme tokens
never raw hex; inline editors never `window.prompt/confirm/alert`. See `/CLAUDE.md` KEY DECISIONS.

<!-- Keep this pointer current: if you rename/move/delete a key file in this folder, update the
     lines above in the same commit. The doc-pointer-audit check fails CI on a stale reference. -->
