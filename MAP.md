# MAP.md — Planyr codebase map

> **Generated 2026-07-05 @ `a76211f` by `scripts/build-map.mjs` — do not hand-edit the inventory.**
> This file is committed so project-knowledge sync indexes it and a session can orient without
> cold-searching the repo. Each entry: **path** — one-line responsibility, then its exported symbols.
>
> **Regenerate it in the SAME commit whenever you add/remove/rename a file or change a primary
> export** (`node scripts/build-map.mjs`); CI runs `--check` and fails the build on drift. The
> one-line responsibilities are the human-value column — the script **preserves** them across
> regenerations (keyed by path); a new file arrives as `TODO — describe` and `--check` fails until
> it is filled in. Only the inventory (paths + exports) is drift-checked; descriptions are not diffed.
>
> Module owners: **infra** (shell/entry), **shared lib** (`src/shared/*`), **Site Planner**
> (incl. Cost/yield takeoff), **Schedule** (`src/workspaces/scheduler` + the `public/sequence`
> iframe), **Doc Review**, **Library**. `/server` is listed as folder structure only (below) —
> never its contents or secrets.

_184 source files mapped._

## infra

- **`src/app/chunkReload.js`** — Stale-chunk-after-deploy recovery: vite:preloadError listener, cache-busting reloadFresh, cooldown/stuck loop guard, flushAll on unload
  - _exports_: `arrivedViaFreshReload`, `clearReloadGuard`, `hasReloadParam`, `installChunkReloadGuard`, `isChunkLoadError`, `recoveryStage`, `RELOAD_COOLDOWN_MS`, `RELOAD_GUARD_KEY`, `RELOAD_PARAM`, `reloadFresh`, `shouldReloadAfterPreloadError`, `stripReloadParam`
- **`src/app/ErrorBoundary.jsx`** — Per-workspace React class error boundary: contains render crashes, detects chunk-load errors, offers cache-busting reload vs mid-deploy 'try again'
  - _exports_: `default (ErrorBoundary)`
- **`src/app/flushRegistry.js`** — Cross-workspace flush-before-navigate registry: registerFlush/flushAll give each live workspace one synchronous local-save + keepalive cloud push before a forced reload
  - _exports_: `_flushers`, `flushAll`, `registerFlush`
- **`src/app/modulePrefetch.js`** — Warm non-active workspace chunks on idle/hover and prefetch the heavy /sequence/ Gantt iframe doc so tab switches feel instant
  - _exports_: `prefetchModule`, `prefetchOnIdle`
- **`src/app/route.js`** — Hash-route model: parseRoute/buildHash for {module,projectId,cross}, slug maps, useHashRoute hook with merge-navigate, INITIAL_HASH_EMPTY resume flag
  - _exports_: `buildHash`, `DEFAULT_MODULE`, `INITIAL_HASH_EMPTY`, `MODULE_BY_SLUG`, `parseRoute`, `readRoute`, `sameRoute`, `SLUG_BY_MODULE`, `useHashRoute`
- **`src/app/Shell.jsx`** — App shell: auth state, hash-driven module switching, lazy workspace registry with per-id ErrorBoundary+Suspense, account pill/dropdown, cross-workspace intents
  - _exports_: `default (Shell)`
- **`src/main.jsx`** — Entry point: installs client-error telemetry + chunk-reload guard, retires old GIS service worker, renders Shell inside ThemeProvider/StrictMode
  - _exports_: _(none)_

## shared lib

- **`src/shared/brand/BrandMark.jsx`** — Planyr coral isometric-stack logo as inline theme-aware SVG: favicon/mark/auto variants plus optional 'planyr' wordmark lockup
  - _exports_: `default (BrandMark)`
- **`src/shared/brand/tokens.js`** — Planyr brand palette constants (coral tier faces, linework, surfaces, wordmark colors) mirroring the CSS --coral-* vars for inline-styled chrome
  - _exports_: `BRAND`, `default`
- **`src/shared/cloud/optimisticUpsert.js`** — Optimistic-concurrency (id,version) compare-and-swap upsert for sites/doc_reviews: casUpsert, keepaliveCasPush, missing-column degrade, typed conflict interpreters
  - _exports_: `casUpsert`, `interpretCas`, `interpretInsert`, `isMissingColumn`, `isMissingVersionColumn`, `keepaliveCasPush`
- **`src/shared/cloud/serializeWrites.js`** — Per-key write serializer: makeWriteSerializer chains same-key cloud writes in order so a tab can't race itself into a false version conflict
  - _exports_: `makeWriteSerializer`
- **`src/shared/coordinates/index.js`** — Shared EPSG:2278 Texas South Central project grid: unit helpers plus Lambert Conformal Conic projectToGrid/gridToProject validated against pyproj
  - _exports_: `FT_PER_M`, `ftToAcres`, `gridToProject`, `makePoint`, `metersToFeet`, `PROJECT_CRS`, `projectToGrid`, `SQFT_PER_ACRE`
- **`src/shared/files/detailRefs.js`** — Parses CAD detail/section callout bubbles ("5/A-3") and detail definition anchors from positioned PDF page text so the Stitcher can drop clickable detail hotspots
  - _exports_: `normSheet`, `parseDetailAnchors`, `parseDetailRefs`
- **`src/shared/files/disciplineSplit.js`** — Splits a multi-discipline combined PDF into contiguous discipline segments and filing sets (prefix-first, sticky-smoothed) and builds a page-partition filing plan
  - _exports_: `buildFilingPlan`, `resolvePageDiscipline`, `smoothDisciplines`, `splitByDiscipline`
- **`src/shared/files/docxText.js`** — Dependency-free browser .docx-to-plain-text reader (native ZIP central-directory walk + deflate-raw inflate + WordprocessingML flatten) feeding the legal-description parser
  - _exports_: `documentXmlToText`, `docxToText`, `readDeedFile`
- **`src/shared/files/edgeGeomMatch.js`** — Vector match-line seam fitter: PCA line-fit of drawn linework across two adjacent sheets returning ordered endpoint pairs for the similarity solve, fail-open
  - _exports_: `fitEdgeLine`, `matchSeamEdges`, `orderEndpoints`
- **`src/shared/files/fileFacts.js`** — Pure file-fact view-model: normalizes review rows, classifies spatial vs reference doc class, and drives the Library category tree, saved views, facets and needs-filing holding area
  - _exports_: `browseFiles`, `buildFileFacts`, `CATEGORIES`, `categoryFor`, `categoryOf`, `classifyDocClass`, `createIndexProvider`, `deriveTree`, `DOC_CLASS`, `docRecency`, `FACETS`, `FILE_STATE`, `FILE_STATES`, `fileState`, `getSavedView`, `groupByDiscipline`, `holdingArea`, `isReference`, `isSpatial`, `needsFiling`, `nodeMatch`, `onMap`, `runView`, `SAVED_VIEWS`, `stateOf`, `stubIndexProvider`, `subcategoryOf`, `toFileFact`
- **`src/shared/files/legendUnion.js`** — Unions per-sheet legend symbol entries into one deduped composite key (dedupe by normalized meaning, keep first symbol, track source sheets)
  - _exports_: `legendFromPlaced`, `unionLegendEntries`
- **`src/shared/files/matchLineFit.js`** — Pixel-accurate raster match-line fitter for scanned sheets: 1-D morphology to isolate dashed line then RANSAC near-horizontal fit plus cross-correlation slide-refine, fail-safe
  - _exports_: `colProfile`, `fitMatchLine`, `isolateLinePoints`, `ransacLine`, `rowClose`, `rowOpen`, `slideRefine`
- **`src/shared/files/matchProject.js`** — Deterministic browser project matcher: searches sheet text for each named project's name/address/parcel/job identifiers, noisy-or scores, confident-single-else-needs-filing decision
  - _exports_: `decide`, `matchProjectInText`, `scoreProjectInText`
- **`src/shared/files/ocrMatchLines.js`** — Recovers "MATCH LINE ... SHEET N" labels from raster scans by OCRing the page at 0/90/270 orientations and mapping found labels back to page space for autoStitch
  - _exports_: `framePointToPage`, `OCR_ORIENTATIONS`, `recoverMatchLines`
- **`src/shared/files/rasterCompare.js`** — Pure revision-compare pipeline core: registers rev B onto rev A, nearest-neighbor resamples B into A's grid, then diffs two binaries into change codes and regions
  - _exports_: `compareBinaries`, `resampleBinary`
- **`src/shared/files/rasterDiff.js`** — Pure raster diff engine: classifies each pixel unchanged/removed/added with tolerance dilation and clusters changed pixels into navigable change regions for compare-versions
  - _exports_: `classifyDiff`, `clusterChanges`, `DIFF_ADDED`, `DIFF_BG`, `DIFF_REMOVED`, `DIFF_SAME`, `diffRasters`, `dilate2D`
- **`src/shared/files/rasterRegister.js`** — Pure raster registration for revision compare: layered coarse-translation and ink-bbox similarity fits scored by ink agreement, plus manual 2-point rotation-recovering fallback
  - _exports_: `coarseOffset`, `detectAnchors`, `inkBBox`, `manualRegister`, `registerRasters`
- **`src/shared/files/scaleBarRead.js`** — Pure graphic scale-bar reader: clusters horizontal bar segments + nearby numeric ticks into a feet-per-unit calibration when no scale text exists
  - _exports_: `clusterBars`, `readScaleBar`, `tickLinearity`, `ticksNearBar`
- **`src/shared/files/sheetGroups.js`** — Pure auto-grouping of pages into logical sheets by contiguous sheet-code runs + shared plan type, with adjacent-duplicate-number cleanup
  - _exports_: `consecutiveCodes`, `groupKey`, `groupSheets`, `markAdjacentDuplicateNumbers`, `parseSheetCode`, `tileBaseTitle`
- **`src/shared/files/sheetMeta.js`** — Pure positional sheet reader: reconstructs text lines to extract title-block band, sheet title/number, match-lines, notes, detail refs for grouping/stitching/calibration
  - _exports_: `detectTitleBlock`, `drawingAreaOf`, `edgeOf`, `parseMatchLines`, `readSheetMeta`, `readSheetTitle`, `reconstructLines`, `titleCandidates`
- **`src/shared/files/sheetNotes.js`** — Pure notes/legend block reader plus multi-sheet aggregateNotes that pins every note once and flags ones that vary by sheet
  - _exports_: `aggregateNotes`, `parseNotes`
- **`src/shared/files/sheetScale.js`** — Pure stated-scale parser reading engineer/architectural/ratio/NTS callouts from sheet text into feet-per-paper-inch
  - _exports_: `parseSheetScale`
- **`src/shared/files/sheetTitleSet.js`** — Set-aware sheet-title refinement: demotes cross-page boilerplate (project/client/firm stamps) and known project names so each page keeps its own title; tiled-run titles protected by drawing-type words
  - _exports_: `candidateFrequency`, `DRAWING_TYPE_WORD`, `isStopText`, `projectStopTexts`, `refineSheetTitles`
- **`src/shared/files/titleBlockParse.js`** — Pure deterministic title-block field reader: discipline/item classification, sheet number, issue date, revision, stated scale for free auto-filing
  - _exports_: `classifyDiscipline`, `disciplineFromSheetNumber`, `DISCIPLINES`, `findDates`, `issueDate`, `latestDate`, `parseRevision`, `parseSheetNumber`, `readTitleBlockText`
- **`src/shared/files/uploadQueue.js`** — Pure upload-queue model for the Project Files drop-zone: per-file status lifecycle, active/recently-filed split, and a bounded concurrency pool
  - _exports_: `dropItemsToEntries`, `entryToFiles`, `flattenEntries`, `hasPendingDemote`, `isAcceptedFile`, `makeQueueItem`, `makeQueueItems`, `makeUploadId`, `partitionAccepted`, `QUEUE_STATUS`, `RECENT_BEAT_MS`, `RECENT_COLLAPSE_AT`, `runPool`, `splitQueue`
- **`src/shared/folders/folderTemplate.js`** — Canonical default project folder template (B650) — the one 133-folder tree every new project is scaffolded from.
  - _exports_: `FOLDER_TEMPLATE`, `TEMPLATE_VERSION`
- **`src/shared/folders/folderTree.js`** — Pure folder-tree ops (B650): flatten/treeify/validate/move-cycle guard/seed-row builder, shared by the Library editor + the Drive mirror.
  - _exports_: `buildSeedRows`, `childrenOf`, `countTemplate`, `descendantIds`, `flattenTemplate`, `liveRows`, `nextOrder`, `padPrefix`, `resolveDrawingTarget`, `stripPrefix`, `subtreeIds`, `suggestNextNumberedName`, `treeify`, `validateFolderName`, `wouldCreateCycle`
- **`src/shared/formula/formula.js`** — Excel-style formula engine (tokenize/parse/evaluate) powering scheduler user-defined columns; no eval, structured [Column] refs, byte-synced into the Sequence iframe
  - _exports_: `BLANK`, `compareValues`, `DEFAULT_CALENDAR`, `errVal`, `evaluateFormula`, `extractRefs`, `formatValue`, `FORMULA_ERRORS`, `FormulaError`, `FUNCTION_HELP`, `FUNCTION_NAMES`, `FUNCTIONS`, `isBlank`, `isDate`, `isErrVal`, `isFormulaError`, `isoToSerial`, `makeDate`, `numToGeneralStr`, `parse`, `parseFormula`, `parseLooseDate`, `planFormulaColumns`, `serialToISO`, `serialToYMD`, `toBool`, `toDateSerial`, `tokenize`, `toNumber`, `toStr`, `weekdayOf`, `ymdToSerial`
- **`src/shared/geometry/pasteGeom.js`** — Pure paste-at-cursor placement math: bbox center plus translate so a pasted copy drops centered under the cursor, shared by both canvases
  - _exports_: `bboxCenter`, `centerOn`
- **`src/shared/gis/gisProxyCore.js`** — Pure shared core for the same-origin GIS imagery cache proxy: host allowlist, base64url service-URL packing, cache-key hashing, TTL freshness
  - _exports_: `ALLOWED_GIS_HOST_RE`, `b64urlDecode`, `b64urlEncode`, `cacheKey`, `DEFAULT_TTL_MS`, `freshness`, `parseUpstream`, `proxyServiceUrl`
- **`src/shared/gis/parcelSnapshotBuild.js`** — Pure county parcel snapshot transforms: strip to UI-read fields and quantize polygon coordinates into a compact gzippable GeoJSON FeatureCollection
  - _exports_: `buildSnapshotFC`, `KEEP_FIELDS`, `leanFeature`, `leanProps`, `quantizeGeometry`
- **`src/shared/gis/sources.js`** — Versioned GIS source registry: per-layer service URLs, fields, coverage, production/exception tier, and known-truth fixtures with CI tier/shape audits
  - _exports_: `ANALYSIS_KEYS`, `auditRegistry`, `DETENTION_KEYS`, `GIS_SOURCES`, `gisSource`, `JURISDICTION_KEYS`, `looksNonProduction`, `NON_PRODUCTION_URL_PATTERNS`, `outFieldsFor`, `tierProblems`, `VALID_TIERS`
- **`src/shared/ids.js`** — Collision-resistant element-id minter: per-tab random letter salt + seedAbove counter so no two tabs mint a tombstoned id (B591)
  - _exports_: `createIdMinter`, `randomIdSalt`
- **`src/shared/markup/geometry.js`** — Pure unit-agnostic point math for all markup surfaces: length, shoelace area, arc-midpoint, point-in-poly, clamped centroid, snap45, projToSeg, bbox
  - _exports_: `bboxOf`, `centroidOf`, `dist`, `midOfPath`, `pathLength`, `pointInPoly`, `polyArea`, `projToSeg`, `rot2`, `snap45`
- **`src/shared/markup/hitTest.js`** — Shared JS-picker hit-testing: pickMarkup click selection (nearest, smallest-interior-wins) and hitEditPath vertex/edge grab for the selected markup
  - _exports_: `hitEditPath`, `hitMarkup`, `pickMarkup`, `pickMarkupIndex`, `scoreMarkup`
- **`src/shared/markup/markupModel.js`** — Cross-host markup accessors reconciling Site Planner a/b + centre-box vs Document Review pts list: ptsOf/setPts/translate/bbox + load-path sanitize
  - _exports_: `bboxOfMarkup`, `boxCorners`, `isClosed`, `minPtsOf`, `ptsOf`, `sanitizeMarkup`, `sanitizeMarkups`, `setPts`, `translate`
- **`src/shared/markup/MarkupRenderer.jsx`** — Pure SVG renderer for one markup of any kind (measures, shapes, text, callout, cloud, dimension, arrows) given viewport scale + ftPerUnit
  - _exports_: `default (MarkupRenderer)`
- **`src/shared/markup/measure.js`** — Measure engine: turns distance/polylength/perimeter/area/count markups into real feet/acres via the ftPerUnit unit-scale seam; labels + rollup totals
  - _exports_: `canCommitMeasure`, `measureLabel`, `measureValue`, `MIN_MEASURE_PTS`, `rollup`
- **`src/shared/markup/PropertyPanel.jsx`** — Pure schema-driven property panel: renders color/number/range/bool/enum controls for the selected markup from schemaForMarkup, emits canonical-key onChange
  - _exports_: `default (PropertyPanel)`
- **`src/shared/markup/propertySchema.js`** — Bridges tool-matrix property columns to a live markup: canonical-key readProp/writeProp reconciling Site Planner legacy field names, schemaForMarkup builder
  - _exports_: `readProp`, `schemaForMarkup`, `toolIdForMarkup`, `writeProp`
- **`src/shared/markup/selection.js`** — Shared selection logic: marquee box normalize/crossing/window tests, Ctrl/Shift modifier rules, nextSelection set math, and neutral chrome dimensions/grips
  - _exports_: `boxContains`, `boxesIntersect`, `cornerGrips`, `hasSelMod`, `marqueeHits`, `nextSelection`, `normBox`, `pickInMarquee`, `SEL`, `selMods`
- **`src/shared/markup/SelectionChrome.jsx`** — Neutral hue-free selection chrome SVG: light-casing-under-dark-line outline plus solid corner grips or faint marquee fill, legible on aerial imagery
  - _exports_: `default (SelectionChrome)`
- **`src/shared/markup/toolRegistry.js`** — Post-commit arm policy (site reverts to Select, doc/stitch reuse) + Site Planner mline/mrect tool-id alias mapping to canonical matrix ids
  - _exports_: `ARM_POLICY`, `canonicalToolId`, `hostToolId`, `nextToolAfterCommit`, `SITE_TOOL_ALIAS`
- **`src/shared/markup/tools.matrix.js`** — Single-source-of-truth tool matrix: property columns, draw modes, per-workspace tool rows + pure accessors; drives the panel and generates tool tests
  - _exports_: `CATEGORIES`, `columnMeta`, `DRAW_MODES`, `isClosedTool`, `measureTools`, `PROPERTY_COLUMNS`, `propsForTool`, `TOOL_MATRIX`, `toolById`, `toolsForWorkspace`, `WORKSPACES`
- **`src/shared/placement/fitToBoundary.js`** — Fit-to-boundary solver: one similarity transform (Procrustes correspondence or OBB fallback) landing a drawing ring on held survey feet with RMS-fraction confidence
  - _exports_: `CONFIDENT_FRAC`, `fitToBoundary`
- **`src/shared/placement/placementFacts.js`** — Placement-readiness facts contract: empty/merge helpers + longest-dimension picker for facts captured at filing time so the cascade never reopens the file
  - _exports_: `emptyPlacementFacts`, `longestDimension`, `mergePlacementFacts`, `PLACEMENT_FLAG_KEYS`
- **`src/shared/placement/placeOnMap.js`** — Place-on-map cascade: walks embedded/fit-boundary/measure/manual rungs best-to-fallback, choosing a method from facts and surfacing every skipped rung's reason
  - _exports_: `choosePlacement`, `METHOD`, `RUNGS`
- **`src/shared/placement/verifyPlacement.js`** — Placement calibration + auto-verification: derive feet-per-unit from a labeled dimension, grade measured-vs-label percent off, and cross-check two scales for non-uniform stretch
  - _exports_: `calibrateFromDimension`, `CROSS_DISAGREE_PCT`, `crossCheckScales`, `VERIFY_OK_PCT`, `VERIFY_WARN_PCT`, `verifyDimension`
- **`src/shared/presence/editorLock.js`** — Single-active-editor lock over Web Locks API: one tab edits per project, others go read-only, with cross-tab yield bus and steal-based takeover, degrading open
  - _exports_: `createEditorLock`, `lockRole`
- **`src/shared/presence/multiTab.js`** — Multi-tab presence over BroadcastChannel: detect the same project open in another same-browser tab to warn of edit conflicts, with pure summarize/prune heartbeat helpers
  - _exports_: `createMultiTabPresence`, `PRESENCE_CHANNEL`, `PRESENCE_HEARTBEAT`, `PRESENCE_TTL`, `pruneStale`, `summarizePresence`
- **`src/shared/profile/useProfile.js`** — useProfile hook: load signed-in user's profiles row and expose a never-blank display name / first name / org / initial fallback chain plus save+reload
  - _exports_: `default`, `displayNameFor`, `firstNameFor`, `initialFor`, `orgFor`, `useProfile`
- **`src/shared/projects/projectModel.js`** — Pure project-model helpers: collapse site records into one project per site-group, name-match suggest, dropdown filter, and relative-time formatting for the breadcrumb switcher
  - _exports_: `filterProjects`, `groupProjects`, `normalizeProjectName`, `relTime`, `suggestNameMatch`
- **`src/shared/projects/projects.js`** — Live project list for the breadcrumb switcher: groups the RLS-scoped site store, warms an empty on-device cache via cloud pull, and rename/delete a site-group project
  - _exports_: `deleteProject`, `filterProjects`, `groupProjects`, `listProjects`, `normalizeProjectName`, `relTime`, `renameProject`, `suggestNameMatch`, `warmProjectsIfEmpty`
- **`src/shared/telemetry/clientErrors.js`** — Client error+event telemetry: window/rejection/preload sources insert into anon INSERT-only Supabase client_errors with dedup, rate/session caps, tab-id stamping, fail-safe
  - _exports_: `buildErrorRow`, `decideReport`, `DUP_MS`, `errorSignature`, `extractMessage`, `extractStack`, `installClientErrorTelemetry`, `RATE_MAX`, `RATE_WINDOW_MS`, `reportClientError`, `reportClientEvent`, `SESSION_MAX`, `setTelemetryModule`, `TAB_ID`
- **`src/shared/theme/palette.js`** — JS mirror of index.css theme tokens as concrete light/dark hex for the SVG canvas and Markup viewer where var() cannot resolve; paletteFor(resolved) selector
  - _exports_: `paletteFor`, `PALETTES`
- **`src/shared/theme/ThemePicker.jsx`** — Light/Dark/System theme picker UI reading useTheme, mounted in signed-in Settings and the signed-out header gear, styled purely from theme tokens
  - _exports_: `default (ThemePicker)`
- **`src/shared/theme/ThemeProvider.jsx`** — Light/dark/system theme context: persists choice to localStorage, drives data-theme on <html>, live OS-flip listener, usePalette()
  - _exports_: `ThemeProvider`, `usePalette`, `useTheme`
- **`src/shared/ui/AnchoredMenu.jsx`** — Portal-to-body dropdown/flyout that escapes rail stacking-context + overflow clipping; rect-anchored fixed positioning, click-away + Esc
  - _exports_: `default (AnchoredMenu)`
- **`src/shared/ui/AppHeader.jsx`** — Shared two-row chrome: Row1 brand/breadcrumb/cloud-badge/auth, Row2 module tabs+toolbar, fullscreen F-key, phone sideways-scroll, cross-tab conflict banner
  - _exports_: `default (AppHeader)`, `MODULE_ACCENT`
- **`src/shared/ui/CloudSyncBadge.jsx`** — App-wide cloud-sync glyph driven by real saveState (synced/saving/offline/readonly/error/local); loud never-vanish error via crash boundary + retry popover
  - _exports_: `CloudBadgeBoundary`, `cloudBadgeView`, `default (CloudSyncBadge)`
- **`src/shared/ui/moduleAccent.js`** — MODULE_ACCENT: single source of truth for per-workspace accent hexes (Site/Schedule/Review/Library) as pure React-free constants
  - _exports_: `MODULE_ACCENT`
- **`src/shared/ui/ModuleLoader.jsx`** — Per-module assembling skeleton loader: Site parcel-draws itself, Gantt bars/milestones/playhead animate; 250ms show-delay, reduced-motion fallback
  - _exports_: `default (ModuleLoader)`, `SHOW_DELAY_MS`
- **`src/shared/ui/moduleLoaderTheme.js`** — Pure loader theming: resolves a module id to accent+skin-kind+caption (LOADER_SKINS), never-throw fallback, SHOW_DELAY_MS constant
  - _exports_: `LOADER_SKINS`, `resolveLoaderTheme`, `SHOW_DELAY_MS`
- **`src/shared/ui/ProjectBreadcrumb.jsx`** — Row-1 Dashboard/Project breadcrumb + switcher dropdown: search, recents, New project, inline rename/delete kebab, at-risk-save surfacing, cloud-cache warm
  - _exports_: `default (ProjectBreadcrumb)`
- **`src/shared/ui/RotationStepper.jsx`** — The one app-wide rotation control: type-to-set 2dp field + spinner nudges, wrap to [0,360), fine Shift+Arrow, invalid-flash-revert, locked-disable
  - _exports_: `default (RotationStepper)`, `formatDeg`, `normalizeDeg`, `parseRotationInput`
- **`src/shared/ui/statusTokens.js`** — STATUS_TOKENS: single project-lifecycle status palette (color/glyph/map-pin tier/opacity/z) with monotonic salience rules; statusToken() + darken()
  - _exports_: `darken`, `STATUS_TOKENS`, `statusToken`
- **`src/shared/ui/ToolRail.jsx`** — Shared Bluebeam-style vertical icon rail: presentational items list (tool/header/divider/spacer/node), active-tool accent highlight, theme-token chrome
  - _exports_: `default (ToolRail)`, `RailButton`
- **`src/shared/viewport/viewportTransform.js`** — Pure shared pan/zoom engine for both canvases: world<->screen, cursor-anchored zoom, fitView, NaN-safe clamps, pinch, Bluebeam pan/tool collision rule
  - _exports_: `clampNum`, `distance`, `fitView`, `midpoint`, `panBy`, `pinchZoom`, `screenToWorld`, `shouldPan`, `worldToScreen`, `zoomAround`

## Site Planner

- **`src/workspaces/site-planner/components/AuthPanel.jsx`** — Account modal: signed-out sign-in/sign-up/reset + set-new-password, signed-in Profile/Team/Settings tabs, focus-trapped
  - _exports_: `default (AuthPanel)`
- **`src/workspaces/site-planner/components/LayerPanel.jsx`** — Shared map-layer toggle UI (both finder + planner): checkbox/opacity/status/vintage per layer + coverage relevance picker
  - _exports_: `default (LayerPanel)`
- **`src/workspaces/site-planner/components/ParcelDrawing.jsx`** — Immutable PDF/JPEG backdrop markup canvas: pen/line/box/text/measure tools with scale calibration, 0..1 pixel-relative coords
  - _exports_: `default (ParcelDrawing)`
- **`src/workspaces/site-planner/components/SiteAnalysis.jsx`** — Site Analysis panel: presence-first environmental/regulatory screening of active parcels with honest present/none/unknown/unavailable states
  - _exports_: `default (SiteAnalysis)`
- **`src/workspaces/site-planner/components/SiteReviewModal.jsx`** — Legacy-site migration wizard: step through on-device sites to save-to-cloud, keep-on-device, or discard one by one
  - _exports_: `SiteReviewModal`
- **`src/workspaces/site-planner/components/TeamPanel.jsx`** — Team workspace management tab: roster, invite-by-email, role changes, rename/delete/leave team via RLS-scoped teams.js
  - _exports_: `default (TeamPanel)`
- **`src/workspaces/site-planner/lib/appraisal.js`** — Pure CAD-attribute curation: regex-maps raw county/TxGIO parcel columns to labelled owner/value/acreage/use rows for both panels
  - _exports_: `APPR_FIELDS`, `apprAll`, `apprRows`, `apprVal`, `findAttr`, `prettyKey`
- **`src/workspaces/site-planner/lib/arcgis.js`** — Esri ArcGIS REST client: bounded parcel identify (query+identify fallback, multi-county eager race) and lon/lat↔State-Plane-feet conversion
  - _exports_: `aerialPlacement`, `BACKUP_GRACE_MS`, `featureToParcel`, `feetToLatLng`, `geoJsonToEsriFeature`, `getLayerInfo`, `humanizeError`, `identifyAtPoint`, `identifyParcelAcross`, `identifyParcelDetailed`, `identifyParcelEager`, `isQueryCapabilityError`, `largestRingLngLat`, `listLayers`, `lngLatFeatureToParcel`, `lngLatRingToFeet`, `outerRingsLngLat`, `PARCEL_FETCH_TIMEOUT_MS`, `ParcelFetchError`, `queryAtPoint`, `queryFeatures`, `resolveLayerUrl`
- **`src/workspaces/site-planner/lib/auth.js`** — Thin Supabase Auth wrappers: signUp/signIn/signOut/reset/updatePassword, getUser, onAuthChange with pinned redirect origin
  - _exports_: `getUser`, `onAuthChange`, `resetPassword`, `signIn`, `signOut`, `signUp`, `updatePassword`
- **`src/workspaces/site-planner/lib/bootResume.js`** — Pure boot-resume decisions: gate URL/pointer reconciliation until auth+cloud pull settles, pick which saved plan to resume into
  - _exports_: `initialBootResolved`, `mayReconcileUrl`, `pickResumeTarget`
- **`src/workspaces/site-planner/lib/buildingGrid.js`** — Pure structural column-grid + dock-door layout: uniform in-band bays, pinned speed bays, doors avoiding column lines
  - _exports_: `computeBuildingGrid`, `divideSpan`, `GRID_DEFAULTS`, `placeDockDoors`, `resolveGridSettings`
- **`src/workspaces/site-planner/lib/buildingProps.js`** — Pure tiered building-property rules: sf-driven clear-height + slab-thickness defaults with per-building manual overrides
  - _exports_: `autoClearHeight`, `autoSlab`, `DEFAULT_BUILDING_RULES`, `effectiveBuildingProps`, `evalTier`, `fmtClearHeight`, `fmtSlab`, `normalizeRules`
- **`src/workspaces/site-planner/lib/cloudSync.js`** — RLS-scoped Supabase site read/write: per-tab version CAS + thin-clobber guard, keepalive push, delete-tombstone reconcile
  - _exports_: `_siteContent`, `_siteTombs`, `_siteVersions`, `clearSiteVersions`, `cloudDelete`, `cloudList`, `cloudUpsert`, `fetchSiteForReconcile`, `interpretDelete`, `keepaliveCloudPush`, `noteLocalContent`, `wouldThinClobber`
- **`src/workspaces/site-planner/lib/conceptName.js`** — Default plan naming: bijective base-26 Concept A/B/.../AA sequence continuing past the highest existing concept per site
  - _exports_: `conceptLettersToNumber`, `nextConceptName`, `numberToConcept`, `parseConceptIndex`
- **`src/workspaces/site-planner/lib/costTakeoff.js`** — Priced road takeoff: FC-FC asphalt paving (SY, pan-trimmed) + both-side curb (LF by type) rolled up at user unit prices
  - _exports_: `costRollup`, `CURB_TYPE_META`, `CURB_TYPES`, `DEFAULT_PAN_WIDTH`, `roadCurbedSides`, `roadCurbType`, `roadPanWidth`, `roadQuantities`, `SF_PER_SY`
- **`src/workspaces/site-planner/lib/counties.js`** — County parcel/GIS registry: CAD endpoints, TxGIO statewide fallback, jurisdiction utility layers, click-routing bboxes, tax-unit resolver
  - _exports_: `candidateCountiesForPoint`, `COUNTIES`, `COUNTIES_MAP`, `detectField`, `FEET_WKID`, `JURISDICTION_LAYERS`, `resolveTaxRates`, `SNAPSHOT_COUNTIES`, `STATEWIDE_KEYS`, `STATEWIDE_PARCEL_LAYER`, `statewideFallbackFor`, `TAX_RATE_SOURCES`
- **`src/workspaces/site-planner/lib/coverage.js`** — Picker-only layer coverage engine: reproject regional service extents vs viewport to flag in-view/empty/out-of-coverage plus relevance prefs
  - _exports_: `_resetCoverageCache`, `_resetRelevancePrefs`, `boundsFromLeaflet`, `boundsIntersect`, `bufferBounds`, `computeCoverage`, `COVERAGE_STATE`, `DEFAULT_RADIUS_MI`, `DEFAULT_RELEVANCE`, `displayCoverage`, `esriExtentToBounds`, `getCachedExtent`, `getNearbyRadiusMiles`, `getRelevanceMode`, `isRegional`, `LAYER_SCOPE`, `layerScope`, `normalizeMode`, `normalizeRadius`, `prefetchExtents`, `regionCoverage`, `RELEVANCE_MODES`, `setLayerExtent`, `setNearbyRadiusMiles`, `setRelevanceMode`, `srPointToLatLon`, `subscribeRelevance`
- **`src/workspaces/site-planner/lib/deedAlign.js`** — Deed-to-parcel basis-of-bearings fix: rigid rotate+translate best-fit overlay plus theoretical grid-convergence fallback
  - _exports_: `CONFIDENT_FRAC`, `describeRotation`, `gridConvergenceDeg`, `openRing`, `ringCentroid`, `rotatePointsAbout`, `solveDeedAlignment`
- **`src/workspaces/site-planner/lib/detentionRules.js`** — Houston-MSA detention criteria as versioned rule-records + drainage-authority resolver, analysis-tier / hydraulic-regime assessors, and pond auto-size solvers; no volume ships without its rule record
  - _exports_: `assessAnalysisTier`, `assessHydraulicRegime`, `authorityForJurisdiction`, `computeRequiredDetention`, `COUNTY_AUTHORITY`, `deadStoragePoolDepthFt`, `DETENTION_RULES`, `DETENTION_SOURCES`, `governingRequirement`, `interpolateCurve`, `MUNICIPAL_OVERLAYS`, `PARCEL_DISTRICT_TYPES`, `pondDefaultsFor`, `rateFromImpervious`, `resolveDrainageAuthority`, `resolveDrainageContext`, `ruleBadge`, `ruleFor`, `SCREENING_CAVEAT`, `screenOutfall`, `solvePondDepth`, `solvePondExpansion`, `SQFT_PER_ACRE`, `TIER_THRESHOLDS`, `WATERSHED_OVERLAYS`
- **`src/workspaces/site-planner/lib/dimSlide.js`** — Pure geometry constraining a footprint dimension callout to slide along the long axis, off dog-ear bumps, with collision AABB
  - _exports_: `clampDimOffset`, `DIM_POS_F_DEFAULT`, `DIM_POS_F_ROAD`, `dimNumberBox`, `dimSlideRange`
- **`src/workspaces/site-planner/lib/dockZones.js`** — Building-anchored dock-zone stack geometry: outward court/trailer/buffer chain, catalog layers, dock-side axes, stranded-zone pruning
  - _exports_: `catalogDepthDefault`, `DOCK_ZONES`, `dockSidesFor`, `footprintAxes`, `footprintDepth`, `footprintLength`, `layoutStack`, `layoutZone`, `layoutZoneByKind`, `MAX_DOCK_ZONES`, `pruneStrandedZones`, `strandedZoneIds`, `usableCourtSpan`, `ZONE_CATALOG`, `zoneDepthDefault`, `zoneDepthDefaults`
- **`src/workspaces/site-planner/lib/dogEar.js`** — Corner bump-out geometry: box placement flush at a dock-wall corner, resize round-trip, and sidewalk span extension it causes
  - _exports_: `bumpSidewalkSide`, `DOGEAR_D`, `DOGEAR_W`, `dogEarGeom`, `dogEarSize`, `isDogEarSide`, `sidewalkSpanForBumps`
- **`src/workspaces/site-planner/lib/easementRules.js`** — Editable per-jurisdiction utility-easement width rules (placeholder, verify-flagged) persisted in localStorage with county default mapping
  - _exports_: `DEFAULT_EASEMENT_RULES`, `defaultJurForCounty`, `loadEasementRules`, `saveEasementRules`
- **`src/workspaces/site-planner/lib/easements.js`** — Easement domain logic: type catalog, label, and derive drawn ring from centerline/boundary/parcel-edge input modes with area
  - _exports_: `buildParcelEdgeStrip`, `DEFAULT_EASEMENT_ATTRS`, `deriveEasementRing`, `EASEMENT_TYPES`, `easementArea`, `easementColor`, `easementLabel`, `easementType`, `ringArea`
- **`src/workspaces/site-planner/lib/edgeRuns.js`** — Group parcel boundary edges into logical sides (runs) by bearing tolerance, with per-run length, midpoint, and shared setback value
  - _exports_: `bearingDelta`, `edgeRuns`, `runOfEdge`, `runSetbackValue`, `segBearing`
- **`src/workspaces/site-planner/lib/elevation.js`** — USGS 3DEP bare-earth DEM sampling: profile elevations along a polyline (metres to survey-ft) plus ditch-depth screening stats
  - _exports_: `DEP_URL`, `ditchStats`, `sampleProfile`
- **`src/workspaces/site-planner/lib/evidenceLayers.js`** — View-driven Leaflet utility-evidence overlays (OSM Overpass power/hydrants + Mapillary detections) with SWR cache and per-layer status
  - _exports_: `fetchOverpass`, `mapillaryLayer`, `mapillaryToken`, `overpassLayer`, `setMapillaryToken`, `subscribeMapillaryToken`
- **`src/workspaces/site-planner/lib/exportStyle.js`** — Pure print stroke-weight retargeting: convert authored screen-pixel line widths to zoom-independent physical drafting points for PDF/PNG export
  - _exports_: `PRINT_WEIGHTS`, `printStrokeWidth`, `PT_PER_CENTI_INCH`, `sheetFitScale`
- **`src/workspaces/site-planner/lib/geocode.js`** — Shared address geocoder (Esri World primary, Nominatim fallback) with honest hit/not-found/service-down return contract, used by map and planner
  - _exports_: `geocodeAddress`
- **`src/workspaces/site-planner/lib/gisCache.js`** — Browser-local stale-while-revalidate cache for GIS responses: L1 memo plus byte-capped oldest-evicted localStorage, age-aware, injectable store/clock
  - _exports_: `createGisCache`, `formatAge`, `gisCache`, `isStale`, `NS`
- **`src/workspaces/site-planner/lib/gisFetch.js`** — Resilient ArcGIS fetch substrate: honest error taxonomy, timeout plus jittered-backoff retry, auto GET-to-POST for long geometry, pLimit concurrency pool
  - _exports_: `backoffMs`, `classifyGisError`, `fetchArcgisJson`, `GIS_FETCH_RETRIES`, `GIS_FETCH_TIMEOUT_MS`, `GIS_MAX_GET_URL`, `gisErrorMessage`, `GisFetchError`, `pLimit`
- **`src/workspaces/site-planner/lib/history.js`** — Pure undo/redo snapshot stack for the planner canvas: keyOf-based no-op dedup, explicit live-state compare, drop-on-abort drag transactions
  - _exports_: `createHistoryStack`
- **`src/workspaces/site-planner/lib/image.js`** — Read an image File to a data URL with natural dimensions, downscaling large screenshots to JPEG to fit the localStorage scenario budget
  - _exports_: `loadAndDownscaleImage`
- **`src/workspaces/site-planner/lib/imagePdf.js`** — Pure dependency-free JPEG-to-one-page-PDF wrapper at an exact physical page size, so exports carry no browser print-dialog chrome
  - _exports_: `jpegToPdf`
- **`src/workspaces/site-planner/lib/jurisdiction.js`** — Registry-driven ArcGIS jurisdiction/road-authority identify (city/ETJ/county intersect + nearest-road maintainer) over the SWR cache with map-overlay styling
  - _exports_: `buildIdentifyParams`, `countyAtPoint`, `ETJ_SOURCES`, `etjSourcesForPoint`, `formatHighway`, `identifyJurisdiction`, `identifyRoadAuthority`, `identifySource`, `JURISDICTION_SOURCES`, `normalizeFeature`, `polylineDistMeters`, `polylineLengthMeters`, `ROAD_AUTHORITY_COLORS`, `ROAD_AUTHORITY_LEGEND`, `ROAD_MAINT_AGENCY`, `roadAuthority`, `roadAuthorityStyle`, `roadDisplayName`, `simplifyRing`
- **`src/workspaces/site-planner/lib/labelLayout.js`** — Pure label level-of-detail plus collision engine: line-dropping by priority, greedy overlap resolution, leader overflow, and dimension-callout zoom gates
  - _exports_: `boxesOverlap`, `boxOf`, `buildingLabelLines`, `DETAIL_LABEL_MIN_PX`, `detailLabelVisible`, `DIM_CALLOUT_MIN_PPF`, `dimCalloutVisible`, `fitLines`, `layoutLabels`, `suppressedDimIds`
- **`src/workspaces/site-planner/lib/layerRequest.js`** — Pure map-layer request shaping: esri dynamic/image/feature layer option builders plus transient-retry policy, with coverage barred from narrowing requests
  - _exports_: `dynamicLayerOptions`, `featureLayerOptions`, `featureRetryDecision`, `imageLayerOptions`, `isTransientStatus`, `TRANSIENT_STATUS`
- **`src/workspaces/site-planner/lib/layers.js`** — Shared GIS overlay registry + syncOverlayLayers: probes/adds/removes esri-leaflet raster & feature layers, retry/backoff, B445 cache-proxy with direct-agency fallback, per-layer status + vintage
  - _exports_: `ALL_LAYERS`, `attachFeatureRetry`, `defaultOverlayState`, `EVIDENCE`, `fetchWithRetry`, `JLAYERS`, `JURISDICTION_LAYERS`, `jurisdictionFor`, `JURISDICTIONS`, `LAYER_VINTAGE`, `layerVintage`, `probeService`, `STATEWIDE`, `syncOverlayLayers`, `withTileRetry`
- **`src/workspaces/site-planner/lib/localDb.js`** — IndexedDB async key/value store (get/put/delete/deleteByPrefix + durable persist), self-healing open, no-op fallback where IDB is unavailable; durable home for the version-history ring and cached rasters
  - _exports_: `idbAvailable`, `idbDelete`, `idbDeleteByPrefix`, `idbGet`, `idbPersist`, `idbPut`
- **`src/workspaces/site-planner/lib/mapillaryClient.js`** — Leaflet-free Mapillary request shaping: builds bbox map_features URL (same-origin token-injecting proxy, or direct Graph API with a user token) and filters to pole/hydrant detections
  - _exports_: `mapillaryRequestUrl`, `MLY_FIELDS`, `MLY_LIMIT`, `MLY_PROXY_PATH`, `pickDetections`
- **`src/workspaces/site-planner/lib/metesAndBounds.js`** — Pure metes-and-bounds engine: parses Texas deed bearing/distance calls (curves, SAVE-AND-EXCEPT tracts) to planner-feet paths, closure/misclosure, polyline offset/buffer, ring overlap
  - _exports_: `arcChordPoints`, `bufferPolyline`, `callsToPath`, `misclosure`, `offsetPolyline`, `parseCalls`, `parseTracts`, `pathCloses`, `ringsOverlap`, `VARA_FT`
- **`src/workspaces/site-planner/lib/overlayAlign.js`** — Pure overlay alignment math: image-point-to-world, scale-about-a-point, 2-point and least-squares Procrustes similarity transforms (scale+rotate+translate) with RMS residual
  - _exports_: `alignOverlaySimilarity`, `applySimilarityToOverlay`, `imagePointToWorld`, `scaleOverlayAbout`, `similarityTransform`, `solveSimilarityLSQ`
- **`src/workspaces/site-planner/lib/overlayPdf.js`** — Site-plan overlay rasterizer: lazily reuses Doc Review PDF.js to render a dropped PDF/image page to a white-knockout PNG data URL, reads its scale note, classifies sheet size, rebuilds from stored bytes
  - _exports_: `isPdfFile`, `openOverlayFile`, `rasterizePage`, `rasterizeStoredPdf`
- **`src/workspaces/site-planner/lib/overlayPrint.js`** — Pure DOM-free print/export selection for placed site-plan overlays: filters src-bearing visible overlays, drives the 'Print overlay' checkbox visibility and the export compositing pass
  - _exports_: `hasPrintableOverlay`, `isOverlayPrintable`, `printableOverlays`
- **`src/workspaces/site-planner/lib/overlayScale.js`** — Pure drawing-scale helpers: engineer scale-note parsing, standard sheet detection, feet-per-point conversions, viewport-sanity auto-scale guard, and Bluebeam-style page=real distance/preset scale entry
  - _exports_: `chooseOverlayScale`, `COMMON_SCALES`, `detectSheet`, `feetPerInchForPreset`, `feetPerInchFromPair`, `ftPerPointForScale`, `matchScalePreset`, `PAGE_UNIT_TO_IN`, `PAGE_UNITS`, `parseDistanceInput`, `parseScaleNote`, `parseSheetScale`, `POINTS_PER_INCH`, `REAL_UNIT_TO_FT`, `REAL_UNITS`, `SCALE_PRESETS`, `scaleForFtPerPoint`
- **`src/workspaces/site-planner/lib/overlayStorage.js`** — Supabase Storage I/O for overlay/parcel-drawing/aerial-underlay source files (uid-first RLS keys, upload/download/delete), fallback-safe to inline raster when logged-out/oversize/error
  - _exports_: `BUCKET`, `deleteOverlayObject`, `downloadOverlayBytes`, `downloadOverlayDataUrl`, `fileKind`, `overlayKey`, `parcelDrawingKey`, `siteUnderlayKey`, `uploadOverlayFile`, `uploadParcelDrawingFile`, `uploadUnderlayDataUrl`
- **`src/workspaces/site-planner/lib/parcelDisplay.js`** — Shared parcel-outline display layers for map and planner: styleable esri vector layer, image-export layer for query-disabled TxGIO, Drive-snapshot geoJSON layer, add/remove cursors
  - _exports_: `ADD_CURSOR`, `makeParcelDisplayLayer`, `makeParcelImageLayer`, `makeParcelLayer`, `makeSnapshotLayer`, `PARCEL_MINZOOM`, `parcelDisplayIsImageOnly`, `REMOVE_CURSOR`
- **`src/workspaces/site-planner/lib/parcelQuery.js`** — Shared parcel ID/address lookup: SQL-injection-safe where-clause builder with county scoping and primary-CAD to statewide-TxGIO outage fallback plus circuit-breaker health recording
  - _exports_: `buildParcelWhere`, `isDefaultLookupUrl`, `lookupParcels`, `okField`
- **`src/workspaces/site-planner/lib/parcelSnapshot.js`** — Client loader for nightly Drive county parcel-snapshot cache: IndexedDB-held SWR download, pure viewport-filter/point-in-lot hit-test so a flaky county server never blanks the map
  - _exports_: `_resetSnapshots`, `ensureSnapshot`, `featureAtPoint`, `featureBbox`, `featuresForView`, `getSnapshot`, `onSnapshotChange`, `snapshotEnabled`, `snapshotVintage`
- **`src/workspaces/site-planner/lib/parking.js`** — Pure parking-layout math: rows-to-depth, split into double-loaded modules, explode into stall-row/aisle bands, curb-adjacency test
  - _exports_: `edgeAbutsPaving`, `explodeParkingBands`, `parkDepthForRows`, `parkRowsForDepth`, `PAVED_NEIGHBOR_TYPES`, `splitParkingPieces`
- **`src/workspaces/site-planner/lib/planStyle.js`** — Shared element style tokens (fills/strokes/weight/pattern per surface type), style resolver, paint z-order, element feet ring outline
  - _exports_: `byZ`, `elRingFeet`, `elStyle`, `toHex6`, `TYPE`, `typeStyle`, `zOrder`
- **`src/workspaces/site-planner/lib/polyClip.js`** — Pure polygon intersection-AREA via ear-clip triangulation + Sutherland–Hodgman; pairwise active-parcel overlap detection for the B652 double-count warning
  - _exports_: `overlappingParcelPairs`, `PARCEL_OVERLAP_TOL`, `polyIntersectArea`, `triangulate`
- **`src/workspaces/site-planner/lib/polygonSplit.js`** — Pure parcel-split geometry: straight-line cut pairing all crossings for concave lots, plus bent-polyline path cut
  - _exports_: `nearestPointOnSeg`, `polyArea`, `segLineIntersect`, `splitPolygonByLine`, `splitPolygonByPath`
- **`src/workspaces/site-planner/lib/pondGeom.js`** — Pond expansion label placement (deepest added-ground point) and stage contour rings with elevation/depth labels
  - _exports_: `addedAreaLabelPoint`, `autoContourInterval`, `contourLabelPoint`, `detentionStorage`, `pointInRing`, `pondContours`
- **`src/workspaces/site-planner/lib/pondOffset.js`** — Robust inward polygon offset via clipper-lib for pond grading contours: pinch-off, basin split, max inscribed reach
  - _exports_: `maxInwardOffset`, `offsetInward`, `ringsArea`
- **`src/workspaces/site-planner/lib/printSheet.js`** — Pure single-SVG print sheet composer: page geometry, buildings table, metrics band, title block, export filename builder
  - _exports_: `buildBuildingTableSvg`, `buildPrintSheetSvg`, `formatDateStamp`, `pageSize`, `printSheetLayout`, `sanitizeFilename`, `sheetFileName`
- **`src/workspaces/site-planner/lib/profile.js`** — Signed-in user profile I/O against Supabase public.profiles (load/upsert first/last/org, mirrors names to auth metadata)
  - _exports_: `loadProfile`, `saveProfile`
- **`src/workspaces/site-planner/lib/registerGisSw.js`** — Boot-time unregister of the retired browser GIS imagery service worker (superseded by server-side Drive cache), fail-safe
  - _exports_: `retireGisSw`
- **`src/workspaces/site-planner/lib/roadClasses.js`** — Road design classes and civil min-radius thresholds (AASHTO speed formula, default arc radius per class, per-plan overrides)
  - _exports_: `classDefaultRadius`, `classMinRadius`, `DEFAULT_ROAD_CLASS`, `ROAD_CLASS_SEEDS`, `roadClassesOf`, `roadClassOf`, `speedMinRadius`
- **`src/workspaces/site-planner/lib/roadGeometry.js`** — Pure centerline road geometry: tessellate clicked alignment into arc fillets/smooth splines/sharp corners, min radius of curvature
  - _exports_: `DEFAULT_ARC_RADIUS`, `DEFAULT_TESS_DEG`, `minRadiusOfCurvature`, `polylineLength`, `roadCenterline`, `roadMinRadius`
- **`src/workspaces/site-planner/lib/sharing.js`** — Project team sharing: stamp/clear team_id on a group's sites, doc_reviews, and file_facts then re-pull the local cache
  - _exports_: `makeProjectPrivate`, `shareProject`
- **`src/workspaces/site-planner/lib/sheetFurniture.js`** — Map sheet furniture: graphic scale bar and two-tone north arrow, output-unit sized with no-occlude corner placement, screen + export
  - _exports_: `buildScreenFurnitureSvg`, `buildSheetFurnitureSvg`, `chooseFurnitureCorners`, `furnitureLayout`, `furnitureMetrics`, `northArrowPlate`, `pickScaleBar`, `scaleBarPlate`, `screenFurniturePlates`
- **`src/workspaces/site-planner/lib/siteAnalysis.js`** — Registry-driven environmental/regulatory screen of active-parcel rings (flood, wetlands, wells, pipelines, jurisdiction, road, zoning) with silent-error present/absent/unknown/unavailable states over the SWR cache
  - _exports_: `ANALYSIS_SOURCES`, `analyzeSource`, `buildAnalysisParams`, `buildJurisdictionFinding`, `buildQueryUrl`, `buildRoadFinding`, `classifyFlood`, `classifyStatus`, `deriveZoning`, `isSFHA`, `normalizeAttrs`, `pipelineSummary`, `representativeRing`, `ringCentroid`, `ringsBBox`, `ringsSignature`, `runSiteAnalysis`, `simplifyRing`, `wetlandSummary`, `zoneSummary`
- **`src/workspaces/site-planner/lib/siteModel.js`** — Canonical per-plan Site Model schema v10: createSiteModel/migrate, semantic selectors, cross-copy union merge with delete-tombstones, and bonded-child/dog-ear/road-centerline load-time repairs
  - _exports_: `activeParcelsOf`, `ANNOTATION_KINDS`, `annotationsOf`, `bondedChildRot`, `buildingNumbers`, `constraintsOf`, `contentCount`, `createSiteModel`, `crossSectionsOf`, `developableArea`, `EASEMENT_KINDS`, `easementsOf`, `elementsOf`, `exclusionZonesOf`, `isBuilding`, `lineageConflicts`, `mergeSiteContent`, `migrate`, `parcelAncestors`, `parcelChildrenMap`, `parcelDescendants`, `parcelDisplayInfo`, `parcelDrawingsOf`, `parcelOutline`, `parcelsOf`, `quarterOffset`, `rectRoadEndpoints`, `roadStripBBox`, `roadTravelWidth`, `setbacksOf`, `sheetOverlaysOf`, `SITE_MODEL_VERSION`, `STATUS_META`, `STATUSES`, `statusOf`, `teamShareOf`, `toMs`, `utilitiesOf`, `UTILITY_KINDS`
- **`src/workspaces/site-planner/lib/sourceHealth.js`** — Per-source circuit breaker for county parcel servers: track consecutive failures, open/cooldown/half-open, filter healthy candidates, and decide the honest statewide-backup badge
  - _exports_: `filterHealthyCandidates`, `isSourceOpen`, `isStatewideBackup`, `recordSourceResult`, `resetSourceHealth`, `SOURCE_COOLDOWN_MS`, `SOURCE_FAIL_THRESHOLD`, `sourceCooldownMs`
- **`src/workspaces/site-planner/lib/storage.js`** — Multi-site persistence layer: localStorage primary with per-user cloud mirror, content-union pull merge, per-tab resurrection guards, and an IndexedDB-backed version-history ring
  - _exports_: `_recentlyDeleted`, `_resetHistoryForTest`, `activeUid`, `AUTOSAVE_KEY`, `backupNow`, `clearCloudCache`, `clearHistory`, `clearRecentlyDeleted`, `deleteSite`, `deleteSiteGroup`, `discardLegacySite`, `getCurrentSiteId`, `getVersion`, `groupOf`, `importLegacyIntoCloud`, `importOneSiteToCloud`, `initHistoryStore`, `isCloudActive`, `isEmptySite`, `keepaliveFlushSite`, `legacySitesList`, `listVersions`, `loadAutosave`, `loadPlansOfGroup`, `loadSite`, `loadSitesList`, `mergePulledSites`, `migrateOldAutosave`, `migrateScenarios`, `migrateSiteGroups`, `noteLocalContent`, `pendingLegacyCount`, `pendingLegacySites`, `pruneMigratedLegacy`, `pullCloud`, `pushModelToCloud`, `pushSiteToCloud`, `reconcileSiteFromCloud`, `renameSiteGroup`, `saveAutosave`, `saveSite`, `scheduleLinkOf`, `setActiveUser`, `setCurrentSiteId`, `setScheduleLink`, `siteNameOf`, `snapshotVersion`, `stageLegacySite`, `storage`, `summarizeVersion`
- **`src/workspaces/site-planner/lib/supabase.js`** — Supabase anon client factory from build-time env, connection/health test, and synchronous access-token read for the keepalive cloud push
  - _exports_: `connectionInfo`, `currentAccessToken`, `supabase`, `supabaseConfigured`, `supabaseRest`, `testConnection`
- **`src/workspaces/site-planner/lib/teams.js`** — Team-workspace I/O over the anon Supabase client: create/list teams, roster + role management, email invites and claim, all RLS-scoped with SECURITY DEFINER RPC preferred paths
  - _exports_: `cancelInvite`, `claimInvites`, `createTeam`, `currentIdentity`, `deleteTeam`, `inviteByEmail`, `leaveTeam`, `listInvites`, `listMembers`, `listMyTeams`, `removeMember`, `renameTeam`, `setRole`
- **`src/workspaces/site-planner/lib/titleReader.js`** — Client-side title-commitment reader: sends an uploaded PDF to the Claude API with a Schedule-B JSON schema to extract exceptions plus the metes-and-bounds legal description
  - _exports_: `fileToBase64`, `getKey`, `KEY_LS`, `readTitlePDF`, `setKey`
- **`src/workspaces/site-planner/lib/vectorLayers.js`** — Pure registry-driven vector GIS engine for FEMA flood + NWI wetlands: paged ArcGIS pull, Esri-to-GeoJSON, Douglas-Peucker simplify, risk symbology, vector-vs-image decision, SWR cache
  - _exports_: `buildQueryUrl`, `buildVectorQuery`, `decideVectorOrImage`, `featuresToGeoJson`, `fetchCached`, `fetchVectorFeatures`, `simplifyGeoJson`, `styleFor`, `VECTOR_SOURCES`
- **`src/workspaces/site-planner/MapFinder.jsx`** — Leaflet map finder: aerial basemaps + labels, GIS overlay panel, eager county/statewide parcel identify, and status-pinned site markers for picking/opening sites
  - _exports_: `default (MapFinder)`
- **`src/workspaces/site-planner/SitePlanner.jsx`** — Hand-rolled SVG planner canvas: parcels, buildings, roads, parking, docks, easements, overlays, measurements, dimensions, cost takeoff, elevation, and autosave with version history
  - _exports_: `default (SitePlanner)`
- **`src/workspaces/site-planner/SitePlannerApp.jsx`** — Site Planner workspace root: boots migrations + history hydration, owns map/plan mode and active-site routing, shared overlay/layer state, cloud pull + legacy-import flow
  - _exports_: `default (App)`

## Schedule

- **`public/sequence/index.html`** — Self-contained Sequence/Schedule iframe app: spreadsheet with an Excel-like formula engine, dependency-graph task scheduling, Gantt + PDF export, Supabase cloud-save/history, suggestions review queue, site-linked
  - _exports_: `_cpMeasure`, `_formulaBuiltinMap`, `_pfCostRef`, `_pfDateRef`, `_pfNumOrBlank`, `activeEffectiveCols`, `addBD`, `addCalendarMonths`, `addD`, `addMonths`, `AddNoteComposer`, `addWorkdays`, `App`, `approxTextPx`, `AutomationPanel`, `avatarColor`, `barLabelText`, `buildFormulaRowColumns`, `buildGanttSVG`, `buildHolidaySet`, `buildPDFHtml`, `calcEnd`, `cascadeDates`, `celebrateTaskComplete`, `Cell`, `cleanEmailBody`, `colArray`, `colLabel`, `collectCountable`, `collectNonBlank`, `collectNums`, `collectNumsKind`, `collectRefs`, `compareValues`, `compareValuesSafe`, `computeDisplayHealth`, `computeFormulaValues`, `computeRolledHealth`, `constrainedStartFrom`, `ContactPicker`, `ContactsPanel`, `datedif`, `defaultStartFor`, `depAnchors`, `DepCell`, `dif`, `difBD`, `durTooltip`, `effectiveColsOf`, `ErrorBoundary`, `errVal`, `escapeHtml`, `escapeRegExp`, `estLabelWidth`, `evalBinary`, `evalCall`, `evalNode`, `evaluateFormula`, `extractRefs`, `extraHolidaySet`, `fd`, `fdLocal`, `ferr`, `Field`, `fitCaptionFs`, `fmtBarDate`, `fmtD`, `fmtPreds`, `fmtTaskDuration`, `formatDateToken`, `formatNumberSection`, `formatNumberToken`, `FormatPanel`, `formatValue`, `formulaCalendar`, `formulaColsOf`, `formulaColToColDef`, `FormulaColumnEditor`, `formulaColumnNames`, `FormulaError`, `formulaToday`, `ganttNameWeight`, `GanttView`, `getInitials`, `GridColumnsChooser`, `GridHeaderMenu`, `GridView`, `HealthColHeader`, `HealthColHeaderIcon`, `HealthDropMenu`, `HealthPicker`, `HistoryPanel`, `InlineDate`, `isBlank`, `isBuiltinFormulaName`, `isDate`, `isErrVal`, `isFormulaError`, `isLeap`, `isoToSerial`, `isoWeekNum`, `isValidColor`, `isWorkingSerial`, `layoutExhibitCols`, `loadExportPrefs`, `looseEqual`, `makeDate`, `MasterView`, `matchesCriteria`, `matchIndex`, `mkt`, `need`, `networkDays`, `normPreds`, `noteISO`, `NoteRow`, `NotesColHeader`, `noteShortMD`, `NotesModal`, `notifyRowsDeleted`, `nthWeekday`, `num1`, `numToGeneralStr`, `parse`, `parseCriteriaOperand`, `parseDurationInput`, `parseFlexDate`, `parseFormula`, `parseLooseDate`, `parsePreds`, `pd`, `PDFExportModal`, `placeGanttLabel`, `planFormulaColumns`, `ProjContextMenu`, `ProjDropdown`, `raiseIfErr`, `readGridCfg`, `rebuildHEALTH`, `recomputeAfterStructureChange`, `RenameModal`, `renumberTasks`, `resolveDuration`, `resolveLabelAlign`, `resolveTaskSpan`, `rollForwardToWorkday`, `rollupParentDates`, `roundAwayFromZero`, `Row`, `sameFamily`, `saveExportPrefs`, `SegBtn`, `serialToISO`, `serialToYMD`, `SettingsPanel`, `sgqAvatarColor`, `SgqCascadePicker`, `SgqChangeRow`, `sgqChildrenOf`, `sgqConfClass`, `SgqCrumb`, `sgqCrumbOf`, `SgqDot`, `sgqFmtDate`, `sgqInitials`, `showToast`, `sortByVisualOrder`, `splitFormatSections`, `SplitView`, `startForEnd`, `StatusHeaderDropdown`, `StatusPicker`, `stepVisibleColIdx`, `stripFormatLiterals`, `SuccessorPromptModal`, `SuggestionsView`, `TaskContextMenu`, `taskDurUnit`, `taskDurValue`, `textFormat`, `toBool`, `toDateSerial`, `Toggle`, `tokenize`, `toNumber`, `toShortDate`, `toStr`, `TYPE_RANK`, `validatePredEdit`, `valueFamily`, `weekdayOf`, `weekNum`, `wildcardToRegExp`, `workdaysBetween`, `writeGridCfg`, `writeLabelAlign`, `yearFrac`, `ymdToSerial`
- **`src/workspaces/scheduler/components/LinkSchedulePanel.jsx`** — Suggest-and-confirm panel to create-or-link a schedule to an unlinked Site Planner project; never auto-links
  - _exports_: `default (LinkSchedulePanel)`
- **`src/workspaces/scheduler/components/ScheduleToolbar.jsx`** — Lifted embedded-Gantt action toolbar (view toggle, review inbox, zoom, export, panels) that displays iframe-reported state and posts planar:* commands
  - _exports_: `ScheduleActions`, `ScheduleCenter`
- **`src/workspaces/scheduler/lib/gridColNav.js`** — Pure keyboard column-navigation that steps the grid cursor across VISIBLE columns in display order, skipping hidden ones
  - _exports_: `snapToVisible`, `stepVisibleCol`, `stepVisibleColByIdx`, `visibleColMasterIdxs`
- **`src/workspaces/scheduler/lib/navState.js`** — Pure null-safe parse/sanitize of the embedded scheduler's postMessage nav-state and derive current/site-linked project for the breadcrumb
  - _exports_: `deriveCurrentProject`, `findBySiteId`, `parseNavState`, `sanitizeProjects`
- **`src/workspaces/scheduler/lib/saveState.js`** — Pure map of the embedded Gantt's reported save status (saving/error/offline/synced) onto the shared CloudSyncBadge, never a false-green
  - _exports_: `scheduleSaveState`
- **`src/workspaces/scheduler/Scheduler.jsx`** — Scheduler workspace root: embeds the standalone Gantt iframe, bridges nav/toolbar/save/link over postMessage into the shell header
  - _exports_: `default (Scheduler)`

## Doc Review

- **`src/workspaces/doc-review/components/ReviewsBar.jsx`** — Reviews filing dropdown: link to project, set discipline/item/revision/date/name, and open or delete saved reviews
  - _exports_: `default (ReviewsBar)`
- **`src/workspaces/doc-review/DocReview.jsx`** — Document Review core: PDF.js viewer with immutable backdrop, measure/redline tools on an SVG overlay, calibrate, undo, cloud persistence
  - _exports_: `default (DocReview)`
- **`src/workspaces/doc-review/lib/arrange.js`** — Pure Bluebeam-style Arrange z-order helpers reordering one markup among its same-page peers without disturbing other sheets
  - _exports_: `ARRANGE_MODES`, `arrangeFlags`, `reorderWithinPage`
- **`src/workspaces/doc-review/lib/autofiling.js`** — Auto-filing provider: Tier-1 free browser title-block read, AI /api/file fallback for scanned sheets; never auto-guesses a project
  - _exports_: `autofile`, `AUTOFILE_ENABLED`, `autofilingProvider`, `createAutofilingProvider`, `encodeProjects`, `interpretResponse`
- **`src/workspaces/doc-review/lib/autosavePlan.js`** — Pure per-tick autosave gating for useReviewPersistence: decides consumeEcho/markDirty/mirror/scheduleSave from load/enabled/empty/suspended
  - _exports_: `planAutosave`
- **`src/workspaces/doc-review/lib/autoStitch.js`** — Pure match-line auto-stitch: builds sheet seam adjacency and places sheets via similarity solve, leaving unresolved ones for manual Align
  - _exports_: `autoPlaceGroup`, `buildAdjacency`, `detectedEndpointsFor`, `MAX_STITCH_SCALE`, `oppositeSide`, `seamEndpointsFor`
- **`src/workspaces/doc-review/lib/compareRegister.js`** — Revision-compare browser glue: rasterize+binarize two PDF pages, run the pure register/resample/diff core on budgeted rasters
  - _exports_: `binImageData`, `compareBinaries`, `comparePdfPages`, `resampleBinary`
- **`src/workspaces/doc-review/lib/fileIndex.js`** — Pure auto-filing file-facts view-model: filing decision to Postgres index row, and merge stored placement/needs-filing facts onto review rows
  - _exports_: `factsRowToPatch`, `mergeFactsIntoReviews`, `toFactsRow`
- **`src/workspaces/doc-review/lib/localRead.js`** — Tier-1 free local title-block read: extract every page text (OCR scanned pages), classify per-page, pick majority discipline, emit multi-discipline filing decision
  - _exports_: `localTitleBlockRead`
- **`src/workspaces/doc-review/lib/matchLineRefine.js`** — Stitcher raster match-line refinement: fit true seam line in pixels, remap neighbor placement onto anchor line and slide to connect crossing linework
  - _exports_: `binarizeImageData`, `fitSeamLine`, `plausibleRefine`, `refineGroupPlacements`, `refineSeamPlacement`
- **`src/workspaces/doc-review/lib/ocg.js`** — Pure PDF optional-content (layer) helpers: flatten pdf.js OCG config to Layers-panel rows and re-derive visibility after a radio-group toggle
  - _exports_: `deriveLayerVisibility`, `ocgLayerList`
- **`src/workspaces/doc-review/lib/ocr.js`** — Scanned-sheet OCR runner: lazy CDN-pinned Tesseract worker renders no-text pages and converts word bboxes into page-unit positioned items
  - _exports_: `createOcrRunner`, `extractWords`, `ocrScaleFor`, `wordsToItems`
- **`src/workspaces/doc-review/lib/parseLength.js`** — parseFeet: validate a human-typed real-world length to feet for manual Calibrate, rejecting scale ratios and bare fractions instead of coercing
  - _exports_: `parseFeet`
- **`src/workspaces/doc-review/lib/pdf.js`** — pdf.js setup + load/render helpers for doc-review: asset wiring, polyfill, text/positioned-item extraction, double-buffered region render, OCR/stitch/compare raster
  - _exports_: `extractAllPagesText`, `extractPageItems`, `extractPageText`, `firstPagesText`, `loadPdf`, `renderInto`, `renderPageToImage`, `renderPageToImageData`, `renderPageToOcrCanvas`
- **`src/workspaces/doc-review/lib/pdfSplit.js`** — Byte-level PDF split by filing plan: lazily use pdf-lib to carve one clean per-discipline PDF from a combined set, no page dropped
  - _exports_: `partFileName`, `splitPdfByPlan`
- **`src/workspaces/doc-review/lib/renderBudget.js`** — Pure canvas backing-store budget math: two-layer backdrop/detail density, visible-region tiling and device-pixel rect rounding under a 24MP cap
  - _exports_: `BACKDROP_PX_BUDGET`, `backdropDensity`, `backingPixels`, `backingScale`, `CANVAS_PX_BUDGET`, `DETAIL_DENSITY_CAP`, `DETAIL_DENSITY_TARGET`, `deviceRect`, `tileCovers`, `visibleRegion`
- **`src/workspaces/doc-review/lib/reviewStore.js`** — Document Review cloud persistence I/O: Supabase doc_reviews + file-facts index, Drive-first byte storage, filing/re-filing, localStorage flush mirror
  - _exports_: `BUCKET`, `clearDraft`, `clearReviewVersions`, `cloudConfigured`, `cloudReady`, `composeTitle`, `currentUid`, `deleteFromDrive`, `deleteReview`, `DISCIPLINES`, `downloadFromDrive`, `downloadSource`, `fileNewReview`, `fmtDocDate`, `getShareLink`, `isStoredSource`, `keepaliveFlushReview`, `listFileFacts`, `listProjects`, `listReviews`, `loadReview`, `markReviewPlaced`, `MAX_BYTES`, `newReviewId`, `newSourceId`, `pushFileToDrive`, `readDraft`, `reconcile`, `refileReview`, `REVIEW_SCHEMA`, `setProjectStatus`, `STATUS_META`, `STATUSES`, `statusOf`, `storeSource`, `uploadLargeToDrive`, `uploadSource`, `upsertFileFacts`, `upsertReview`, `writeDraft`
- **`src/workspaces/doc-review/lib/sessionBytes.js`** — In-memory session-lifetime FIFO cache of dropped source Files by srcId so a backdrop reopens while its upload is still keyless
  - _exports_: `_clearSessionBytes`, `cacheSourceBytes`, `getSourceBytes`, `hasSourceBytes`, `SESSION_BYTES_CAP`
- **`src/workspaces/doc-review/lib/sheetRead.js`** — Browser bridge from pdf.js to pure sheet engines: reads/groups pages, derives per-group stated/scale-bar calibration, flags not-to-scale sheets, with dormant OCR seam
  - _exports_: `groupCalibration`, `isNotToScale`, `readAndGroup`, `readSheets`, `SCALE_BAR_MIN_CONFIDENCE`, `scaleBarCalibration`, `statedCalibration`
- **`src/workspaces/doc-review/lib/sourceState.js`** — Single owner of source-unavailable taxonomy (too-large/oversize/not-stored/signed-out/fetch-failed) plus the banner and file-warn copy each state maps to
  - _exports_: `classifySource`, `CLOUD_FILE_LIMIT_MB`, `fileWarn`, `sourceUnavailableMessage`
- **`src/workspaces/doc-review/lib/stitchDedupe.js`** — Pure placed-sheet de-duplication: isPlaced no-op guard plus dedupePlaced collapse of exact (srcId,pageNum) repeats keeping the world-frame first instance
  - _exports_: `dedupePlaced`, `isPlaced`, `placedKey`
- **`src/workspaces/doc-review/lib/stitchGeom.js`** — Pure stitch geometry: similarity fwd/inv/solveM, sheet bbox, degenerate-align guards, reference-set + not-aligned-badge classifiers, and captured-origin pan
  - _exports_: `alignBadgeMetrics`, `alignBaselinesDegenerate`, `fwd`, `inv`, `isReferenceSet`, `measureOverUnaligned`, `MIN_ALIGN_BASE`, `panTo`, `sheetBBox`, `sheetContains`, `solveM`
- **`src/workspaces/doc-review/lib/takeoff.js`** — Re-export shim forwarding measure/geometry/markup-model symbols to the shared markup engine so legacy doc-review import paths still resolve
  - _exports_: `canCommitMeasure`, `centroidOf`, `dist`, `measureLabel`, `measureValue`, `midOfPath`, `MIN_MEASURE_PTS`, `pathLength`, `pointInPoly`, `polyArea`, `rollup`, `sanitizeMarkup`, `sanitizeMarkups`
- **`src/workspaces/doc-review/lib/usePersistence.js`** — useReviewPersistence hook: first-edit debounced cloud save + synchronous localStorage mirror, honest save badge, conflict/read-only lockout, unload flush
  - _exports_: `canCloudSave`, `docSaveState`, `useReviewPersistence`
- **`src/workspaces/doc-review/Stitcher.jsx`** — Multi-sheet stitcher: load PDFs onto one world canvas, two-point assisted align, auto-stitch/calibrate/crop, cross-seam measure, undo, cloud-persisted review
  - _exports_: `default (Stitcher)`

## Library

- **`src/workspaces/library/components/FileBrowser.jsx`** — Library main surface: category tree + facet row + badged file list, drop-to-autofile queue with discipline split, needs-filing triage, delete and Drive share-link
  - _exports_: `default (FileBrowser)`
- **`src/workspaces/library/components/FolderTree.jsx`** — Library per-project folder-tree editor (B650): add / inline-rename / move / delete + the enumerated delete-safety modal + Drive-mirror status.
  - _exports_: `default (FolderTree)`
- **`src/workspaces/library/lib/folders.js`** — Client folder-index store (B650): Supabase tree CRUD (own-row RLS) + idempotent template seed + the one-way Drive-mirror trigger via /api/folders.
  - _exports_: `addFolder`, `ensureSeeded`, `listFolders`, `migrateAllProjects`, `migrateProjectFiles`, `moveDriveFileToFolder`, `moveFolder`, `planFolderDelete`, `renameFolder`, `syncFoldersToDrive`, `trashSubtree`
- **`src/workspaces/library/Library.jsx`** — Library workspace root: AppHeader chrome + FileBrowser wired to project route/auth, opening a clicked file into Review via the Shell onOpenReviewInDocReview intent
  - _exports_: `default (Library)`

## server (structure only — contents & secrets deliberately not mapped)

```
server/
  auth/
  convert/
  filing/
  oauth/
  storage/
    backends/
    db/
```
