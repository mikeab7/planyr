# Model workspace (user-facing "Spreadsheet") — folder pointer

Internal id `model`, route slug `spreadsheet`. One workbook per project (`model_sheets`), several per
Organization (`org_model_sheets`), and — NEW-1 — a **Library file opened as a workbook** ("file mode").

**Open an uploaded Excel / CSV (file mode).** A Library `.xlsx/.xls/.xlsm/.csv` row opens HERE (the Shell
routes it; `FileBrowser` right-click says "Open in Spreadsheet"; the File menu has "Open Excel or CSV
file…"). ONE source of truth: the Library file's stored bytes ARE the document — no second copy in a table.
- `lib/spreadsheetKind.js` — name → kind, `savesInPlace`, `xlsxNameFor`, `SpreadsheetFileError`. Dependency-free on purpose (the Shell and Library import it).
- `lib/spreadsheetFile.js` — bytes → workbook + "what didn't carry over" notes. Runs in `lib/spreadsheetWorker.js` (import discipline pinned by the repo-root `test/` suite **spreadsheetFileWiring**); `lib/spreadsheetClient.js` is the main-thread half (timeout, main-thread fallback). Uses `xlsxIO.js` (ExcelJS), `csvIO.js`, SheetJS for old `.xls`, `xlsxInspect.js` (encrypted / charts / pivots / macros detection; `stripNonCellParts` = the retry ExcelJS needs for any workbook with a chart).
- `lib/fileWorkbook.js` — the open/save RULES (pure, injected I/O). Only a real `.xlsx` saves in place (new stored version, the upload kept as the prior version; one version per editing session). `.xls/.xlsm/.csv` get a new `.xlsx` Library file beside them and the original links to it (`spreadsheetCopyId`). `lib/fileWorkbookStore.js` is the real I/O (reviewStore + the worker).
- `lib/useFileWorkbook.js` + `lib/fileDraft.js` — load / debounced save / status, and the on-device safety copy of unsaved edits. `lib/activeFile.js` — which file each place is showing. `components/FileBar.jsx` — file bar, "won't carry over" banner, open-failure panel.
- In file mode ModelApp's project load / write-through / cloud push are skipped (`fileMode`) — never let them write a file's cells into a project slot.
- Tests: repo-root `test/` **spreadsheetFile**, **spreadsheetFileWorkbook**, **spreadsheetFileWiring** (real fixtures in `test/fixtures/spreadsheet/`).

**Chrome is FLAT and edge to edge (NEW-1, B2517376, owner-approved mockup 2026-10-29).** The toolbar (`components/Ribbon.jsx`), the formula bar (`components/FormulaBar.jsx`), the grid (`components/SheetView.jsx`) and the sheet-tab strip (`components/TabStrip.jsx`) are full-width strips with single hairlines — no floating card, margin, rounded corners or shadow anywhere. Do not bring the card back. Guard: the repo-root ui-audit harness named verify-spreadsheet-flat-chrome.

**Selection is a LIST OF RANGES and drag-select autoscrolls (NEW-1/NEW-2, B2530688/B2530689, 2026-10-29).** `components/SheetView.jsx` holds one gesture engine for every press that extends a range (cell drag, column/row header drag, fill handle): the pointer maps to a row/column from scroll offsets (never the DOM under it — the grid is virtualised) and a rAF loop scrolls while the pointer is at/past ANY edge, even held still.
- `lib/selectionModel.js` — the pure selection model: `{r1,r2,c1,c2,extra?}` (the four fields = the ACTIVE range, `extra` = earlier ranges); Ctrl+click adds / removes a cell, Shift extends only the newest range, `applyToRanges` makes a multi-range command one undo step. Commands Excel refuses on several ranges (copy, paste, insert/delete, freeze, sort, merge) show `MULTI_SELECTION_MESSAGE`, never a silent no-op.
- `lib/dragSelect.js` — pure pointer → cell mapping (`cellAtPoint`, frozen-pane aware) and the edge-speed ramp (`edgeVelocity`, `autoscrollStep`).
- Tests: repo-root `test/` **modelSelectionModel**, **modelDragSelect**; e2e **model-selection-drag-ctrl**. Do not go back to per-cell `mouseenter` selection or to ending a drag on `mouseleave`.

<!-- Keep this pointer current: if you rename/move/delete a key file in this folder, update the lines above in the same commit.
     The doc-pointer-audit check fails CI on a stale reference. -->
