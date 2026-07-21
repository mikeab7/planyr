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
- `coordinates/` — the EPSG:2278 ↔ WGS84 projection (shared coordinate spine). Read-only
  screening use today; grow additively, not a planner rewrite.
- `files/` — `chunkedUpload.js` (any-size chunked Drive upload via /api/uploads/* — pure chunk
  math + the retry/resume loop, B409 rework) + `uploadQueue.js` (the upload-tray queue model).
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
- `projects/`, `profile/`, `cloud/`, `presence/`, `telemetry/`, `gis/`, `geometry/`, `placement/`.

**Convention:** shared logic is pure and unit-tested; per-host state/wiring stays in the workspace.

<!-- Keep this pointer current: if you rename/move/delete a key file in this folder, update the
     lines above in the same commit. The doc-pointer-audit check fails CI on a stale reference. -->
