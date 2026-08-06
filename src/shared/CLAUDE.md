# `src/shared/` — cross-workspace modules (folder pointer)

Code used by more than one workspace. Keep edits here small and additive — a change ripples
into every consumer. Root rules in `/CLAUDE.md`; deep detail in `/docs/REFERENCE.md`.

**Subfolders**
- `markup/` — the ONE shared markup/measure/selection engine. `tools.matrix.js` is the
  machine-checkable spec (**never edit it to make a test green** — fix the code). Pure modules:
  `geometry.js`, `markupModel.js`, `measure.js`, `hitTest.js`, `propertySchema.js`, `selection.js`,
  `markupStyle.js` (per-object style + kind-keyed fallback, shared by renderer + draft preview, B736);
  `textWrap.js` (callout text wrap + box-fit measurement — greedy word-wrap, force-break on an
  unbroken long word, `calloutBoxMetrics` sizes the box to the longest actual line; heuristic +
  real-`<canvas>` measurers, B909); renderers `MarkupRenderer.jsx`, `PropertyPanel.jsx`,
  `SelectionChrome.jsx`.
- `coordinates/` — the shared coordinate spine. `index.js` is the original hardcoded EPSG:2278
  projection — **leave it alone**; `statePlane.js` (NEW-3) is the multi-zone engine beside it
  (TX South Central 2278 · CO North 2231 · CO Central 2232, per-county resolution incl. the
  documented Broomfield decision) and reproduces `index.js` **bit-for-bit** for Texas, which is
  what makes Colorado additive rather than a refactor — the statePlane suite asserts that with `Object.is`. `scaleFactor.js` (NEW-4) reports the grid × elevation combined factor and detects a
  ground-coordinate survey; it deliberately never APPLIES the factor. Read-only screening use
  today; grow additively, not a planner rewrite.
- `files/` — `chunkedUpload.js` (any-size chunked Drive upload via /api/uploads/* — pure chunk
  math + the retry/resume loop, B409 rework) + `uploadQueue.js` (the upload-tray queue model).
  `middleTruncate.js` — split a label into head + a PINNED tail, so a list of names that differ only
  at the end ("… - p1" … "- p32") stays readable when it doesn't fit; plain CSS ellipsis cuts exactly
  the distinguishing part. Rendered by `ui/MiddleTruncate.jsx` (flexbox, not measurement — correct at
  any width, through a rail drag or a zoom, with no measure/re-render loop).
  Pure PDF/sheet parsers: `titleBlockParse.js`, `sheetMeta.js`, `sheetTitleSet.js`
  (set-aware sheet-title refinement — cross-page boilerplate + known-project demotion, B659),
  `sheetGroups.js`, `sheetNotes.js`, `detailRefs.js`, `matchProject.js`, `sheetScale.js`,
  `matchLineFit.js`, `ocrMatchLines.js`. The B340 auto-assembly CV engines (pure; the browser extraction seam is
  dormant, verified live): `scaleBarRead.js` (graphic scale-bar → ft/unit), `edgeGeomMatch.js`
  (vector match-line edge fit), `legendUnion.js` (union sheet legends into the composite key).
  The **deed-import readers** that feed the Site Planner metes-and-bounds plotter: `docxText.js`
  (.docx + the `readDeedFile` dispatcher), `docText.js` (legacy binary .doc, OLE/CFB), and
  `pdfText.js` (PDF embedded text layer, lazily loaded).
- `theme/palette.js` — JS mirror of the CSS theme tokens (keep in sync; SVG/canvas can't use
  `var()`). `ui/statusTokens.js` — the single project-status palette source. `ui/controls.jsx` —
  shared control primitives (Button/ToggleChip/IconButton/Field/Section/MenuItem) + the one
  radius/padding/type scale; token-driven, an `accent` prop keeps each module's hue (B657-5B).
  `ui/ColorField.jsx` + pure `ui/colorRecents.js` — the color control: a current-colour CHIP that
  opens a compact picker popover (palette grid → divider → RECENTLY USED, hidden when empty →
  a quiet "Custom…" row that opens the native OS wheel, the only way to reach an off-palette
  colour). The recents list is ONE shared, persisted MRU across every picker, and records exactly
  ONE entry per picking SESSION (`notePick`/`commitPick`) — the live wheel fires per shade, so
  recording each one used to fill the row with intermediates.
  `ui/AnchoredMenu.jsx` — the portal-to-body clamped flyout (placement math is pure, unit-tested
  `ui/anchoredMenuPlacement.js` — `placeMenu`, which hides rather than corner-pins a
  zero-sized/`display:none` anchor, B734). `ui/FloatingPanel.jsx` +
  `ui/PanelChrome.jsx` + pure `ui/floatingPanel.js` — the NEW-1 poppable-panel primitive (a
  left-rail panel detached into a draggable card over the map; clamp/persist/pan-isolation math
  is pure + unit-tested, host wiring lives in the Site Planner workspace).
- `folders/` — the canonical per-project folder tree (B650): `folderTemplate.js` (the one default
  12-category template) + `folderTree.js` (pure flatten / treeify / validate / seed-row builder).
  Shared by the Library editor + the server Drive-mirror; the server-side reconcile executor lives
  under `/server/storage/` and the mirror route under `/functions/api/`.
- `thoroughfare/` — the Thoroughfare-Plan data spine (B720–B721): `classification.js` (canonical
  road-class enum + `normalizeClassification` / `normalizeStatus`), `ingestTransform.js` (pure
  ArcGIS-feature → `thoroughfare_segments` row: crosswalk + Chapter-42 width resolution + WGS84 /
  EPSG:2278 EWKT geometry, reusing `../coordinates`), and `houston.js` (the City of Houston MTFP
  jurisdiction config — endpoint, field map, crosswalk, §42-122 ROW standards). Shared by the DB
  CHECK, ingestion (B721/B722; the runnable adapter lives under `server/ingest/`), the overlay
  legend (B723), and parcel analysis (B724). The Postgres schema lives under the site-planner
  workspace's `db/` folder.
- `storage/` — the device-storage tier (B1427–B1429), governed by /CLAUDE.md → **TIER-BY-REBUILDABILITY**.
  `storageCensus.js` is the per-TIER, per-CLASS census — localStorage bytes + `navigator.storage.estimate`,
  a key→class registry where **every class declares a rehydration source**, and tier-labelled telemetry
  facts. **⛔ The two tiers are NEVER summed** (~5 MB hard cap vs a gigabyte quota; conflating them is what
  mis-diagnosed the crisis). `storageReclaim.js` acts on those declarations and nothing else — it refuses
  the whole pass if a class claims to be reclaimable with no way back, so a reference image with no cloud
  copy survives any pressure (B474). `originStore.js` is a dependency-free IndexedDB accessor and
  `StoragePanel.jsx` the UI — **mounted from the Site route's plan menu, NOT from `AuthPanel` or the
  header gear**: those land in the entry chunk every route downloads, and even a lazy stub there cost
  +0.8 KB on all four routes and breached the Notes route's ceiling in CI. **⛔ Nothing here may import a workspace module** — this is chrome on every
  route, so a module shared with the planner's boot path gets hoisted into a chunk every route downloads
  (measured: importing `gisCache` put 11.3 KB on a plain Site load and breached three bundle budgets).
  That is why the cache is cleared by NAMESPACE and told about it through a window event.
- `projects/`, `profile/`, `cloud/`, `presence/`, `telemetry/`, `gis/`, `geometry/`, `placement/`.

**Convention:** shared logic is pure and unit-tested; per-host state/wiring stays in the workspace.

<!-- Keep this pointer current: if you rename/move/delete a key file in this folder, update the
     lines above in the same commit. The doc-pointer-audit check fails CI on a stale reference. -->
