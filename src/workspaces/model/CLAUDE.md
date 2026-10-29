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

**A cell's text starts in ONE place (NEW-1, B2525584).** `lib/cellTextLayout.js` is the single source for the text inset (`cellPadX`) and for which cells may spill across empty neighbours (`canSpill`); both paths in `SheetView.jsx` use it, so clearing or refilling the cell beside a label never moves the label. Guards: repo-root `test/` **cellTextLayout**; e2e **model-clear-cell-layout**.

**Chrome is FLAT and edge to edge (NEW-1, B2517376, owner-approved mockup 2026-10-29).** The toolbar (`components/Ribbon.jsx`), the formula bar (`components/FormulaBar.jsx`), the grid (`components/SheetView.jsx`) and the sheet-tab strip (`components/TabStrip.jsx`) are full-width strips with single hairlines — no floating card, margin, rounded corners or shadow anywhere. Do not bring the card back. Guard: the repo-root ui-audit harness named verify-spreadsheet-flat-chrome.

**Drag-select autoscroll (NEW-1, B2452528).** Every range-extending gesture in `components/SheetView.jsx` (cell drag, column-header drag, row-header drag, fill handle) rides ONE session, `beginRangeDrag`: window pointer listeners + a rAF loop, the cell under the pointer found by coordinates against the full offset tables (a virtualised, un-rendered row is still reachable), the grid scrolling while the pointer sits at/past an edge even when held still. Pure geometry: `lib/dragAutoscroll.js`. Do not go back to per-cell `onMouseEnter` or ending the drag on `onMouseLeave`, and do not add `setPointerCapture` (it retargets the click and breaks double-click-to-edit). Guards: repo-root `test/` **modelDragAutoscroll**; e2e **model-drag-autoscroll**; live ui-audit **verify-spreadsheet-drag-autoscroll-live**. The Schedule grid and Notes tables do not share this code.

<!-- Keep this pointer current: if you rename/move/delete a key file in this folder, update the lines above in the same commit.
     The doc-pointer-audit check fails CI on a stale reference. -->

- **Undo while typing (B2535792):** `lib/undoKeyScope.js` decides who owns Ctrl+Z/Y (a text control or an open cell editor owns it; the sheet stack only fires otherwise) and `lib/cellEditHistory.js` is the cell editor's own undo (nothing left → abandon back to the original value). ModelApp's window listener must keep asking `undoKeyOwner` before it calls `undo()`/`redo()`. Guards: repo-root `test/` **modelCellEditorUndo**; e2e **model-cell-editor-undo**.
