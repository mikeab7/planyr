# Notes editor engine — Tiptap stays; Planyr owns less of it (NEW-1 / B2671191, owner decision 2026-11-05)

Tracking item: **B2671191** (on the `ledger` branch: `npm run ledger -- show B2671191`). It supersedes **B2562064** (the BlockNote swap),
which the owner withdrew. Read `docs/NOTES-CARRY-FORWARD.md` first; this file holds the engine decision, the upstream audit and the
paste bank.

## 1 · The closing decision: the BlockNote swap is REJECTED
Owner, 2026-11-05: *"I just want to see it get better."* His complaint underneath (2026-10-30) was that the Notes editor needs constant
work and he wants to stand on maintained open-source code instead of owning it. He pays for nothing: **free open-source only, bundled
from npm** — no Tiptap Pro, no Tiptap Cloud, no paid extension, no hosted service.

Why BlockNote was the wrong way to get that (measured in the 2026-10-30 spike, throwaway project, BlockNote 0.56.0, real Chromium):
- **React.** `@blocknote/mantine` pulls Mantine 9, which needs React 19.2; Planyr is on React 18.3.1 (it only installed with Mantine pinned to 8).
- **A second Tiptap.** BlockNote brought `@tiptap/core` 3.32.x beside Planyr's pin — two copies, or a forced bump.
- **Weight.** ≈ 445 KB gzip (≈ 1.55 MB raw) of JS + 37 KB gzip of CSS on top of an editor engine that was already ≈ 460 KB.
- **Features Notes has and BlockNote's schema does not:** font size, font family, sub/superscript, line spacing, callout.
- **The document model.** A box is a `noteAnchor` node inside ONE page-wide ProseMirror document; per-box editor instances would change
  saving, version history, cross-device merge, conflict review, search, Markdown/print export, arrows between boxes and ≈ 70 suites.
- **It is Tiptap with a UI on top, and Notes already runs on Tiptap/ProseMirror.** The maintained code the owner wants is the engine
  underneath, which he already has. The gain is in *using more of it and owning less beside it*, not in swapping the shell.

**Do not change the document model.** Boxes stay nodes in one page-wide document; `notesExtensions.js` stays the one declaration.

## 2 · Rules for the engine
- **Free, MIT, from npm only.** `@tiptap/*` at ONE exact version across the whole set (the packages peer-depend on each other's exact
  version, so `package.json` pins `3.33.0` with no caret — a caret re-creates the ERESOLVE conflict the first time one package ships).
  `@tiptap/core` is declared directly because Notes imports it directly.
- **Never** `@tiptap/pro-*`, a Tiptap Cloud/Collab provider, or any `@blocknote/*`.
- **Upgrading:** change all `@tiptap/*` together, delete their entries from `package-lock.json` and `npm install` (npm cannot re-resolve the
  exact-version peers in place), diff the old and new `src/` of the packages Notes touches (`core`, `extension-table`, `extension-text-style`,
  `extension-list`, `extensions`, `react`), run the full suite, `ui-audit/verify-notes-engine-contract.mjs` and the paste bank. The 3.29.2 → 3.33.0
  upgrade is the worked example (§4).
- **Before writing editor code:** check §5 for an upstream piece that does it. A Planyr piece that duplicates a maintained one is deleted or
  becomes an `.extend()` of it. A Planyr behaviour the owner has decided is kept even if upstream does something different.

## 3 · What the 2026-10-30 spike found, and where Planyr stands (the bank checks every row)
Stock paste (BlockNote's `pasteHTML` with no pre-processing) lost the following. The **bank** (§6) pastes a fixture for each through the real
paste path and judges the stored document:

| Spike loss | Planyr before this work | Now |
|---|---|---|
| `bgcolor="#FFFF00"` fill on a cell | Already handled where it is meant to be: a plain paste imports **no** foreign cell shading (decided — `notesTableFill.js`, `notesPasteModes.js`); *Values and Source Formatting* (E) / *Formatting only* (R) bring it in via `sourceFill`, which reads `bgcolor` | Unchanged; pinned both ways by `spike-bgcolor-attr` |
| `<font color=… face=…>` | **Lost** (no parse rule matches `<font>`) — a real bug | `<font>` → `<span style>` in the paste pre-pass (`notesOfficeStyle.js`) |
| Empty cell arrives as a space (`&nbsp;`, `<o:p>&nbsp;</o:p>`) | Already correct | Pinned by `spike-excel-nbsp-cell`, `spike-word-o-p-cell` |
| Word bullets arrive as `·` paragraphs | Already correct (`notesOfficeLists.js`) | Pinned by `spike-word-bullets` (bullet + numbered list) |

The bank found two more on unmodified main, neither in the spike: **Excel writes a whole-cell format as a class** (`.xl65 { font-weight:700;
color:#C00000 }` in the head `<style>`), so a bold header or red cell arrived plain; and **`background:yellow`** (a standard colour *name*, which is
how Excel writes the standard fills) read as "no fill", so *Values and Source Formatting* dropped every standard-colour cell. Both fixed.

## 4 · The upgrade, 3.29.2 → 3.33.0 — what touched Notes
Read from a diff of the packages' `src/` (the tarballs ship no changelog). The full suite passes on 3.33.0 with the same single pre-existing
failure as unmodified main (`resolveLedgers` → "parses the REAL committed MAP.md", the generated `MAP.md` is stale — unrelated).
- **`@tiptap/extension-list` — ListKeymap gained a Tab.** At the start of a paragraph right after a list it moves the paragraph INTO the list's
  last item. That contradicts the owner-pinned Tab table (`notesTabKey.js`: a plain paragraph gets a real tab; Tab never re-parents a node) —
  measured on the upgraded build. The kit's `listKeymap` is switched off and `NoteListKeymap = ListKeymap.extend(…)` is added back without the Tab.
- **`@tiptap/extension-table`** — `Table.addNodeView()` now always builds `options.View` and the resize plugin gets `View: null`, so the
  `addNodeView` override Notes carried is gone (`View: NoteTableView`). `TableView.update` recreates the view when table attributes change. New
  `preserveCellSelectionOnContextMenu` — checked against Ctrl+click multi-cell selections (engine contract arm C). `deleteRow`/`deleteColumn`
  keep the caret in the table. Empty `colspan`/`rowspan` of 1 are no longer rendered.
- **`@tiptap/extension-text-style`** — FontFamily / FontSize / Color / BackgroundColor / LineHeight refuse a value that could end its CSS
  declaration (`isValidCSSStyleValue`: no `;` `{` `}`). Notes' own FontFamily/FontSize re-definitions now use it too (arm D).
- **`@tiptap/react`** — `handleMobileEnter`, `ReactWidgetRenderer`, node-view selection tracker: additive; the phone check covers Enter.
- Unchanged for Notes: `core` commands, Highlight, TextAlign, Sub/Superscript, TaskItem, `extensions`.

## 5 · The audit — every Planyr-owned editor piece, and why it is kept
Decision codes: **(a)** upstream now does it → deleted, use upstream · **(b)** upstream does most of it → extend upstream, no parallel copy ·
**(c)** Planyr-only → kept. "Owner" = an owner-decided behaviour an upstream swap would change (kept, and said so).

| Piece | Lines | Decision | Notes |
|---|---:|:-:|---|
| StarterKit, Highlight, TextAlign, Sub/Superscript, TaskList/TaskItem, Table/Cell/Header/Row | upstream | (a) | Already upstream; nothing parallel. |
| `TextStyleKit` (Color, FontFamily, FontSize) | upstream | (a) | Used as shipped; BackgroundColor and LineHeight switched off (below). |
| FontFamily / FontSize `.extend` in `notesExtensions.js` | ~45 | (b) | Upstream reads only the run's own style. Notes also reads an inherited family/size (NEW-5) and converts points to px (NEW-4). Moving that to the paste pre-pass would change non-paste HTML parses and has no node-DOM test; kept as an `.extend`. |
| `lineHeight` (block attribute) in `noteSpacing` | in 690 | (c) Owner | Upstream `LineHeight` is a per-run **mark**; Notes stores line spacing on the **block** (half a line cannot be one-and-a-half spaced). Different stored document → kept. |
| `NoteTableView` | 22 (was ~60) | (b) | Was a copy of upstream `TableView`; now a subclass that clears the stale `width`/`min-width` upstream still leaves (re-confirmed on 3.33.0). |
| `NoteTable` (`keep` attribute), `NoteTableRow` | 16 | (b) | Extensions of upstream with one attribute / one node view. |
| `NoteListKeymap` | 8 | (b) | `ListKeymap` minus the new Tab (§4). |
| `notesTableColumns.js` normaliser | 146 | (c) | Widening one column must not squeeze the rest; undo rides the same step. No upstream. |
| `notesTableFill.js` (cell fill, header row on ANY row) | 266 | (c) Owner | Upstream cells have no `background`, and `toggleHeaderRow` is first-row only. |
| `notesTableMultiSelect.js` (Ctrl+click cells) | 242 | (c) | `CellSelection` is one rectangle upstream. |
| `notesTableRowHeight.js`, `notesTableRowStyle.js` | 243 + 306 | (c) | Row height drag, size reaching empty cells, new rows inheriting. |
| `notesTableClipboard.js`, `notesTableToText.js`, `notesTablePicture.js`, `notesTableWidth.js` | 178+158+161+100 | (c) | Table copy/cut as TSV, convert to text, draw to PNG, widths. |
| Paste pipeline: `notesPastePlain.js`, `notesPasteModes.js`, `notesTablePaste.js`, `notesOfficeLists.js`, `notesFakeBullets.js`, `notesPasteInherit.js`, **`notesOfficeStyle.js`** | 509+351+441+373+191+119+109 | (c) | Upstream has no Office-HTML normaliser; the paste-options flyout is a Planyr feature. |
| `NoteSlashMenu` / `notesSlashMenu.js` | 247+89 | (c) Owner | `@tiptap/suggestion` (MIT) is a regex-on-text-before-caret plus a plugin state machine; Notes' trigger is a pure reading of the document, narrow on purpose (`and/or`, `24/7` and pasted URLs are inert) and unit-tested. Swapping changes when the menu opens. |
| `notesImageNode.js`, `notesAttachNode.js` | 281+268 | (c) | Upstream Image/FileHandler store a URL or data URI; Notes stores an IndexedDB id (localStorage budget). |
| `notesToggleNode.js` | 145 | (c) | `@tiptap/extension-details` would rename the stored node (`noteToggle`) — a document-model change. |
| `notesCalloutNode.js` | 87 | (c) | No upstream. |
| `ensureNoteAnchorIds` (in `notesAnchorNode.js`) | ~30 | (c) | `@tiptap/extension-unique-id` is MIT but adds a dependency to the lazy Notes chunk (which must not grow) to replace a short command; Notes' ids must be minted outside undo history with deterministic migration ids. |
| `notesAnchorNode.js`, `notesAnchorPrune.js`, `notesArrows.js`, `notesBoxResize.js`, `notesMarquee.js`, `notesBlankPaper.js`, `notesViewport.js`, `notesPageWidth.js`, `notesPageHeight.js`, `notesKeyScope.js` | ~3,060 | (c) | The box canvas. No upstream concept. |
| `notesTabKey.js`, `notesListIndent.js`, `notesBlockKeys.js`, `notesEnterInherit.js`, `notesIndentLevel.js` | 199+237+310+117+178 | (c) Owner | Tab / Enter / Backspace behaviours the owner decided and pinned; upstream list keymap's Backspace/Delete run below these. |
| `notesSearchHighlight.js` | 159 | (c) | No free upstream search extension is published (`@tiptap/extension-search-and-replace` does not exist on npm). |
| `notesMixedSelection.js`, `notesResolvedValue.js`, `notesFormatPalette.js`, `notesFontFamily.js` | 200+102+80+65 | (c) | Toolbar state: upstream `getAttributes` reports the first mark, not "mixed". |
| `NoteToolbar.jsx`, `NoteEditor.jsx`, `NoteSlashMenu.jsx`, `PasteIcons.jsx` | 1,936 + 6,361 + 89 + 154 | (c) | UI and canvas wiring over upstream commands. |
| Dead code deleted | −5 | (a) | `fitAnchorWidth`, `TOGGLE_TITLE_PLACEHOLDER` (no importer anywhere). |

**Planyr-owned editor code** is the 49 files listed in `scripts/notes-editor-loc.mjs` (`node scripts/notes-editor-loc.mjs --base origin/main`).
Before: **19,292** lines. After: **19,308**. Net **+16**, which is two different movements:
- **−109 lines of owned code with identical behaviour** — the `TableView` copy and its `addNodeView` override (−106 in `notesTableColumns.js`,
  +2 net in `notesExtensions.js` for the subclass, the list-keymap guard and the comments), the two dead exports (−5), and the shared
  `classRules` reader replacing a second copy of the same regex.
- **+125 lines of new behaviour the bank and the upgrade demanded** — `notesOfficeStyle.js` (+109: class-written bold/italic/underline/strike/colour
  and `<font>`), named-colour fills and `classRules` in `notesTablePaste.js` (+11), the pre-pass call (+5).
The honest reading: the *copies* of upstream are gone, and the editor now carries one new Planyr-only piece because the clipboard formats Office
writes are Planyr's to normalise. Nothing the audit could replace was left in place.

## 6 · The paste regression bank
`ui-audit/lib/pasteBank.mjs` (the fixtures, the expectations, the judge) · `ui-audit/verify-notes-paste-bank.mjs` (the driver — a **required step of the
`build` check**, `.github/ci-gates.yml`) · `test/notesPasteBank.test.js` (in `npm test`: completeness, and the judge's teeth).
- **What is in it:** every fixture in `test/fixtures/clipboard-tables` (OneNote desktop/web, Word, Outlook, Excel, Google Sheets, nested/one-column/
  fragment/merged variants), `clipboard-lists` (Word/OneNote outlines), and `clipboard-bank` (the spike cases, a Word bullet + numbered list, an Excel
  range with a merged cell, a filled cell, an empty cell, a bold cell and a coloured-text cell).
- **How it judges:** each is pasted through a real `ClipboardEvent` carrying a `DataTransfer` with the fixture's exact bytes — onto an empty line
  inside a box and onto armed blank paper — and the **stored document** is read for rows, columns, merges, fills, empty cells (strictly empty: not a
  space), marks, text colours and list nesting. Decided behaviour is pinned: a plain paste imports no foreign shading; the *Values and Source
  Formatting* option does, and is judged separately.
- **It can fail:** a teeth arm runs the judge on an empty document and VOIDS the run if any fixture survives; a known-good arm (plain text lands) VOIDS
  the run if a paste is invisible to the harness. `test/notesPasteBank.test.js` fails when a fixture is committed to any of the three directories with no
  entry, and unit-tests the judge on hand-built documents (a space in an empty cell, a lost merge, a lost bold, a lost colour, a `·` paragraph).
- **2026-11-10 additions:** `browser-block-styles` (the REAL Chrome clipboard for a red serif page, captured by `ui-audit/capture-chrome-copy.mjs`; red/serif/16px on each `<p>`) and `word-class-font` (Word desktop, document font in `p.MsoNormal`, a highlighter) — both red on the previous main. `ui-audit/verify-notes-paste-menu.mjs` (also a required `build` step) drives the paste-options menu's Ctrl tap / keys / mouse and judges what Keep Source / Merge / Keep Text Only / Values keep, with `checkPasteOption` in `ui-audit/lib/pasteBank.mjs`.
- **Adding a clipboard:** drop `<name>.html` + `<name>.txt` in `test/fixtures/clipboard-bank/`, add an entry (`kind` + `expect`) to its `bank.json`, run
  `node ui-audit/verify-notes-paste-bank.mjs` against `vite preview`. A bug report that arrives as a clipboard becomes a fixture first, red, then a fix.
- **Red on unmodified main (`3faee5d`, Tiptap 3.29.2), the final bank: 56 passed, 6 failed** — three bugs, each on both landings: `<font color face>` lost
  its colour and typeface (`spike-font-color`); an Excel range's class-written bold and red text arrived plain (`excel-mixed-cells`); and the `yellow`
  fill was dropped by *Values and Source Formatting* (`excel-mixed-cells`). **After: 62 passed, 0 failed.**

## 7 · The engine contract
`ui-audit/verify-notes-engine-contract.mjs` (also a required `build` step) pins what Notes relies on from Tiptap so an upgrade cannot change a decided
behaviour silently: A Tab after a list · B column-width undo leaves no stale `<col>` width · C a right-click keeps a Ctrl+click multi-cell selection · D a
stored font value with a `;` adds no CSS declaration. Known-good arms VOID the run.
