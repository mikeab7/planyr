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

**Cloud sync base (B2450528).** `model_sheets.data` is jsonb, which re-orders object keys, so workbooks are compared ONLY through `sheetModel.sheetsDiverge`/`canonicalJson` (sorted keys) — never raw `JSON.stringify`. The device keeps `{ baseVersion, dirty }` beside the stored workbook (`modelStore.readSyncMeta/writeSyncMeta`); `lib/modelSyncBase.js` `decideLoadSync` is the ONE decision of which copy wins at load. The red "different copy" bar is only for "dirty AND the cloud moved past the base". Only a person's edit (ModelApp's wrapped commit/undo/redo) marks dirty — a load's `reset` never does. Guard: repo-root `test/` **modelSyncBase**; live: the ui-audit harness named verify-spreadsheet-sync-base.

**A cell's text starts in ONE place (NEW-1, B2525584).** `lib/cellTextLayout.js` is the single source for the text inset (`cellPadX`) and for which cells may spill across empty neighbours (`canSpill`); both paths in `SheetView.jsx` use it, so clearing or refilling the cell beside a label never moves the label. Guards: repo-root `test/` **cellTextLayout**; e2e **model-clear-cell-layout**.

**Chrome is FLAT and edge to edge (NEW-1, B2517376, owner-approved mockup 2026-10-29).** The toolbar (`components/Ribbon.jsx`), the formula bar (`components/FormulaBar.jsx`), the grid (`components/SheetView.jsx`) and the sheet-tab strip (`components/TabStrip.jsx`) are full-width strips with single hairlines — no floating card, margin, rounded corners or shadow anywhere. Do not bring the card back. Guard: the repo-root ui-audit harness named verify-spreadsheet-flat-chrome.

<!-- Keep this pointer current: if you rename/move/delete a key file in this folder, update the lines above in the same commit.
     The doc-pointer-audit check fails CI on a stale reference. -->
