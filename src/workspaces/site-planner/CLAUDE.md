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
  `vectorLayers.js` (pure vector engine + boundary registry) + `vectorOverlay.js` (cached boundary
  render / identify / labels glue) + `boundaryLabels.js` (pure label math) — the B694/B695 tier;
  `basemaps.js` — the shared Esri/USGS aerial-source registry (B693).
- `supabase.js` / `auth.js` / `cloudSync.js` — cloud data + auth (shared across workspaces).
- `labelLayout.js` — LOD label tiering. `roadGeometry.js` — centerline road curves (pure).
- Terrain pipeline (B703–B706): `demGrid.js` / `contours.js` / `flowField.js` (pure math,
  worker-safe) + `terrainWorker.js` (the repo's first Web Worker — import list is test-guarded)
  + `terrainLayers.js` (Leaflet glue, grid LRU for the hover elevation readout);
  `elevation.js` — 3DEP getSamples (cross-section tool + point readout, survey-ft).
- `detentionRules.js` — Houston-MSA detention criteria as versioned rule records + the
  drainage-authority resolver, tier/regime assessors, pond auto-size solvers (B636–B642,
  code-labeled B629–B635; pure, injectable fetch/cache — mirror of `jurisdiction.js`). `pondGeom.js` holds
  `detentionStorage` (the pond stage/volume calc shared by panel, yield metrics, solver) plus the
  B708 anchored tier (`bandedStorage` / `usablePondVolume` — the ONE per-pond usable/dead split).
- Floodplain suite (B707–B712): `floodplainRules.js` / `floodplainMitigation.js` (compensating-storage
  engine, pure), `pondCriteriaRules.js` (berm/slope/freeboard criteria), `buildability.js` (FFE/LOMR-F),
  surfaced via `components/FloodMitigationCard.jsx` + the Yield drainage readout.

**Conventions:** feet everywhere internal (convert only at the map boundary); theme tokens
never raw hex; inline editors never `window.prompt/confirm/alert`. See `/CLAUDE.md` KEY DECISIONS.

<!-- Keep this pointer current: if you rename/move/delete a key file in this folder, update the
     lines above in the same commit. The doc-pointer-audit check fails CI on a stale reference. -->
