# `src/shared/` — cross-workspace modules (folder pointer)

Code used by more than one workspace. Keep edits here small and additive — a change ripples
into every consumer. Root rules in `/CLAUDE.md`; deep detail in `/docs/REFERENCE.md`.

**Subfolders**
- `markup/` — the ONE shared markup/measure/selection engine. `tools.matrix.js` is the
  machine-checkable spec (**never edit it to make a test green** — fix the code). Pure modules:
  `geometry.js`, `markupModel.js`, `measure.js`, `hitTest.js`, `propertySchema.js`, `selection.js`;
  renderers `MarkupRenderer.jsx`, `PropertyPanel.jsx`, `SelectionChrome.jsx`.
- `coordinates/` — the EPSG:2278 ↔ WGS84 projection (shared coordinate spine). Read-only
  screening use today; grow additively, not a planner rewrite.
- `files/` — pure PDF/sheet parsers: `titleBlockParse.js`, `sheetMeta.js`, `sheetGroups.js`,
  `sheetNotes.js`, `detailRefs.js`, `matchProject.js`, `sheetScale.js`.
- `theme/palette.js` — JS mirror of the CSS theme tokens (keep in sync; SVG/canvas can't use
  `var()`). `ui/statusTokens.js` — the single project-status palette source.
- `projects/`, `profile/`, `cloud/`, `presence/`, `telemetry/`, `gis/`, `geometry/`, `placement/`.

**Convention:** shared logic is pure and unit-tested; per-host state/wiring stays in the workspace.

<!-- Keep this pointer current: if you rename/move/delete a key file in this folder, update the
     lines above in the same commit. The doc-pointer-audit check fails CI on a stale reference. -->
