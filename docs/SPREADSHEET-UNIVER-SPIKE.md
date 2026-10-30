# Spreadsheet on Univer — spike report

*Written 2026-10-30 for Michael. Backlog item **B2557488**, live check **V2008256**. This is a trial, not a replacement: nothing about the grid you use today has changed, and only you can see the new one.*

## The short answer

**Univer can carry the Spreadsheet, and it fixes the exact kind of bug that cost you the afternoon — but it is not Excel either, and moving over would be a real project (roughly 12–16 sessions), not a switch flip.**

- **What it fixes, with real keystrokes in a real browser:** Ctrl+Z while typing, a bare letter just typing (no fullscreen), row numbers and column letters that can't be edited, clicking a header to select the whole row or column (plus drag, Shift+click and the corner box), Ctrl+click for a second range, drag-selecting past the edge (it scrolls in all four directions), clearing a cell without the neighbour's text jumping, copy / paste / cut with formulas following, Excel's own clipboard, the fill handle, F2, F4, Alt+Enter, Ctrl+Enter, Ctrl+D / Ctrl+R, Ctrl+A twice, undo / redo across all of it.
- **What it does not give you, because the free build doesn't have it:** indent (the cell has no indent at all), Ctrl+1, the Ctrl+Shift number-format keys, Shift+Space / Ctrl+Space, Ctrl+9 / Ctrl+0, Ctrl+Plus / Ctrl+Minus, Ctrl+; and Ctrl+5, and the Alt key-tips. Univer can be extended, so these are buildable, but they are work — they are the same keys you just fought to get right in the old grid.
- **One place it is *different* from Excel on purpose:** dragging an already-selected row or column header **moves** it (Excel only does that with Shift held).
- **What it costs:** the first time you flip the switch your browser downloads about 1.8 MB of compressed code (more only if needed); the sheet takes a couple of seconds to appear instead of under one; Planyr's own formula engine is 3–4× faster than Univer's (both are well under a second at 5,000 formulas); the project's build now needs a lot more memory.
- **What stays safe:** with the switch off the old grid is **byte-for-byte identical** (screenshots compared against the build before this work). Saving goes through exactly the same path as today. Nothing of yours was touched — every test used throwaway data on the test account.

**My recommendation:** use it for a week on a real model of your own (File ▾ → *Try the new grid*), then decide. If the Excel-key gaps and the load time are tolerable, follow the cutover plan below. If not, the whole thing can be deleted cleanly (see *Turning it off for good*).

## What is in the box (plain English)

- **The switch.** *File ▾ → Try the new grid* appears **only** if the app confirms you are the owner (the same check the admin page uses). Everyone else sees exactly today's menu. Your choice is remembered per device; default is off.
- **The grid.** Univer draws the sheet on a *canvas* (a single picture the browser paints, rather than thousands of little page elements). That is why it is fast on big sheets and also why the old tests that read cell text off the page can't be reused as-is.
- **The bridge.** A translator between Planyr's saved workbook and Univer's. It is tested to give back *exactly* what it was given for every field the model stores, using the real fixture files plus a workbook that uses every field. Things Univer can't hold are carried in a side pocket (a "sidecar": column ids, indent values, the exact text you typed, and so on) so nothing is lost; the few things that genuinely can't survive are reported in plain words on screen instead of vanishing.
- **Saving.** An edit in Univer is converted back to a Planyr workbook after a third of a second and handed to the *same* save routine as every other edit — same device copy, same cloud upload, same file-mode and org-workbook paths. The "different copy saved in the cloud" bar did not appear in any run.
- **Project names.** `Site.Acres`, `Plan.Building1.SF`, `Comp.<title>.RentPSF` work **exactly as typed** — Univer accepts the dots in names, so no renaming was needed. They recompute when the site changes and are never saved into your workbook as names of their own.
- **Licence and cost.** Only the free, open-source Univer packages (version pinned; nothing from the paid "Pro" family, no licence key, no Univer server, no call to any Univer website — the run watched the network and saw none). Excel / CSV import and export stay on the existing path; Univer's own file converters are not used.
- **Look.** The colours come from Planyr's own theme. Univer's own toolbar, formula bar and sheet tabs are used for the spike, so the Planyr flat strip is *not* matched; see "What could not be matched".

## Excel-parity checklist

Run with real keystrokes and mouse (never fake key events) against the real component; the grid is a canvas, so state is read back through Univer's own programming interface (its "facade"). Result tally: 29 work · 14 are not in the free build · 1 differs from Excel. Items driven through that interface rather than the toolbar (merge, freeze, filter, sort, formats, wrap, sizes, hide) test that the *engine* does it, not that each toolbar button is wired — I looked at the toolbar and right-click menus (Start / Formulas / Data / View; Copy, Paste Special, Clear, Insert, Delete, Hide, Width, Fit-for-data, Freeze, Sort are all there) but did not click every button.

| Checklist item | Result | What the run saw |
|---|---|---|
| Ctrl+Z while typing in a cell undoes the typing only; after you commit, one Ctrl+Z undoes the cell as one step | **Works** | typing undone to "ab" with the sheet untouched; the committed cell undid as ONE step |
| A bare letter with a cell selected starts typing (never triggers the app's F fullscreen or any one-letter shortcut) | **Works** | typed "foo" into the cell; document.fullscreenElement stayed null |
| Row numbers and column letters cannot be edited by any route | **Works** | double-clicking a column letter or a row number opens no editor (0 edit events); the labels are painted by the grid and have no stored text |
| Click a header selects the whole row/column; drag and Shift+click extend; the corner box selects all | **Works** | column click, drag C→E, Shift+click G, row click and the corner box all select the right ranges |
| (extra) Dragging an already-selected header | **Differs from Excel** | column C was MOVED by dragging its selected header (C1 was "cherry", now "null") — Excel only moves it with Shift held |
| Ctrl+click adds a second, separate range | **Works** | A1 and C3 selected together |
| Drag-select past the visible edge autoscrolls in all four directions | **Works** | right to col 25, down to row 47, left to col 0, up to row 13 |
| Text spills over empty neighbours; clearing a cell never moves the text beside it | **Works** | label spills (271 px of ink in the empty neighbour); clearing A5 left B5's pixels identical |
| Increase / decrease indent on any cell | **Not in the free build** | no indent control in the toolbar or menus and no indent command in @univerjs/sheets-ui 1.3.1 (the cell model has no indent field); Planyr's indent values are carried in the bridge sidecar but not drawn. (has-shortcut-api) |
| Ctrl+B bold | **Works** | toggles on and off |
| Ctrl+I italic | **Works** | italic on |
| Ctrl+U underline | **Works** | underline on |
| Ctrl+5 strikethrough | **Not in the free build** | no effect (style stays "none"): Ctrl+5 is not bound |
| Ctrl+1 Format Cells dialog | **Not in the free build** | no Format Cells dialog (Univer formats from the toolbar and the number-format menu) |
| Ctrl+Shift+$ currency | **Not in the free build** | no binding: number format stayed "" |
| Ctrl+Shift+% percent | **Not in the free build** | no binding: number format stayed "" |
| Ctrl+Shift+! number | **Not in the free build** | no binding: number format stayed "" |
| Ctrl+Shift+~ general | **Not in the free build** | no binding: number format stayed "" |
| Ctrl+Shift+# date | **Not in the free build** | no binding: number format stayed "" |
| Ctrl+Shift+& outline border, Ctrl+Shift+_ remove border | **Not in the free build** | no binding for border shortcuts |
| Ctrl+A twice (data region, then everything) | **Works** | first press A1:C5, second press everything |
| Shift+Space (row) and Ctrl+Space (column) | **Not in the free build** | neither chord changes the selection (Shift+Space and Ctrl+Space are not bound; use the header click) |
| Ctrl+Shift+Arrow | **Works** | selected A1:A5 |
| Ctrl+Plus / Ctrl+Minus (insert / delete) | **Not in the free build** | Ctrl+Plus / Ctrl+Minus are not bound (insert and delete are in the right-click menu) |
| Ctrl+9 / Ctrl+0 (hide row / column) | **Not in the free build** | no Ctrl+9 / Ctrl+0 binding (hide is in the header right-click menu) |
| F2 | **Works** | F2 kept the text and appended ("alphaX") |
| F4 | **Works** | =A1 → =$A$1 |
| Alt+Enter | **Works** | "a⏎b" in one cell (Univer stores the break as a carriage return; the bridge saves it as a newline) |
| Ctrl+Enter | **Works** | A7:A9 all 7 |
| Ctrl+D and Ctrl+R | **Works** | A2:A4 = 1 and C1:E1 = alpha |
| Ctrl+; (today's date) | **Not in the free build** | Ctrl+; is not bound |
| Alt key-tips (Alt H O I …) — expected missing | **Not in the free build** | pressing Alt on its own shows no key-tip badges; Alt H O I does nothing |
| Copy / paste inside the sheet with formatting; one value pasted into a whole range | **Works** | "alpha" pasted with its bold; one value pasted into D6:D9 |
| Paste from Excel (a real Excel HTML clipboard) with formatting | **Works** | 13 cells pasted from an Excel HTML clipboard (first row ["Item","Cost","Share",null]); the header arrived bold on a rgb(255,255,0) fill |
| Cut moves the cell and the formulas pointing at it follow | **Works** | A1 moved to G1 and B3 now reads =G1+A2 |
| Fill handle: drag and double-click | **Works** | drag filled the series [3,4]; double-click filled [1,1] |
| Merge / unmerge, freeze panes, filter, sort | **Works** | merge/unmerge, freeze [2,1], filter, sort desc [5,4,3,2,1] |
| Number formats (currency, percent, date), wrap text, row / column resize and autofit, hidden rows and columns | **Works** | display $1.00 · 200.0% · 01/03/1900; wrap, width 200, height 40, autofit 120, hidden row+col |
| Find / replace | **Works** | Ctrl+F opens the Univer find panel |
| Insert / delete rows and columns, several sheet tabs with rename — each reaching the saved workbook | **Works** | saved sheets ["Sheet1","Renamed"]; column ids ["c1","c27","c2"] follow their columns; "beta" kept its column id after the row delete |
| Undo / redo across all of the above | **Works** | 12× Ctrl+Z restored the starting sheet exactly; 12× Ctrl+Y returned to the final state |
| (extra) Site.* / Plan.* / Comp.* project names resolve and recompute | **Works** | dotted names evaluate ([25,100001,"#N/A","#NAME?"]), recompute on change ([40,100001]), and are never saved as the workbook's own names |
| (extra) No request to any Univer host | **Works** | 0 requests to any Univer host during the whole run |


"Not in the free build" means the key demonstrably did nothing in the run (or the control does not exist). A harness that can only see "nothing happened" cannot tell *unbound* from *bound but broken*, so read these as "does not work today".

## What carried over cleanly, and what did not

**Carried over (proven by the round-trip test on real files):** every value and formula exactly as typed; number formats; bold / italic / underline / strike, font, size, text and fill colour, alignment, wrap, thin and double borders; horizontal merges; frozen panes; row heights and column widths; hidden rows and columns; named ranges (per sheet); sheet tabs, order and names; the stable column ids; the "dismissed inconsistency" and "imported formula I couldn't translate" markers.

**Does not carry or needs work — said plainly:**
- **Indent** — Planyr keeps the number, Univer cannot draw it.
- **File mode, org workbooks** — wired through the same save routine, but **not exercised** in this spike (the live run used an ordinary project workbook). Treat as untested.
- **Formula-consistency flags and the Inconsistencies panel, trace precedents / dependents, "General" fit, the sheet zoom, the command palette, the Alt key-tips, the old Find bar and Name Manager** — all of these live in the old grid's own code and read its selection; with Univer on they are hidden. Univer has its own zoom slider, find panel and name box; it has no equivalent of the consistency flags or the trace arrows that I could see.
- **Filters** — Univer's filter works, but Planyr does not store filter state in the workbook (it didn't before either), so a filter is gone on reload.
- **Vertical merges** made in Univer, formulas written with `[Column]` names, a typed date such as `1/15/2027` (Univer treats it as text until you give it a date format), and formatting *inside* a cell (mixed bold in one cell) — reported on screen when a save would lose them.
- **Export while typing** — the Excel / CSV export in the header reads the saved workbook; an edit made in the last third of a second before you click it would be missed.
- **Dark theme** — wired to follow the app theme but only the light theme was looked at.
- **Phone / touch** — not tried.

**Planyr's 93 commands (the registry the old grid's keys, palette, ribbon and menus all run):**
- *Have a Univer equivalent (toolbar, right-click menu or key):* undo / redo, format painter, clear formatting, bold / italic / underline / strike, horizontal and vertical alignment, wrap, merge, percent / currency / decimals, borders, insert / delete rows and columns, freeze, sort, filter, find, sheet add / duplicate / rename / delete, copy / cut / paste, fill right, clear, hide / unhide, column width and autofit, zoom, Autosum (Formulas tab).
- *Need wiring to a Univer action:* Excel / CSV import and export (kept in Planyr's header and working through the saved workbook), Name Manager, number-format dialog, insert date / time, copy-above, repeat-last, previous / next sheet, cancel-cut.
- *Not in the free build or Planyr-only (would have to be built on Univer):* indent ±, the Excel key set listed above, Alt key-tips, the "blue input / black formula" colour convention toggle, formula-consistency flags, trace arrows, the command palette.

## The numbers

All measured on this one machine, same Chromium, production builds (never the dev server). Median of 3 runs; raw runs are in the script output.

**Size** (`npm run build` on the branch vs on `origin/main` at `3ba5c0c`; sizes from `dist/.vite/manifest.json`, gzip level 9):

| | Before | After |
|---|---|---|
| The grid code itself (one lazy file, loaded only when the switch is on) | — | **1.78 MB compressed** (6.8 MB unpacked) |
| About 200 small language-pattern files Univer can load on demand | — | 3.2 MB compressed *in total*, none needed at start |
| Everything new, all files | — | 4.9 MB compressed / 17.9 MB unpacked (+18 KB of styles) |
| Start-up file every page loads | 160 KB | 162 KB (a list of the new file names) |
| Production build time / peak memory | 39 s / 2.0 GB | 66–77 s / 3.4–3.6 GB |

Univer rides its own lazy file (the Spreadsheet was already lazy); the only importer of it is the Spreadsheet's own chunk, by a dynamic import, and a test pins that. Every route's own downloaded code grew by 4.4 KB (that file-name list) and nothing else. **The build needed code changes to survive:** Node's default memory limit (about 2 GB) is below what the build now needs, so `npm run build` and the three performance scripts that run their own build now pass a 4 GB limit. The performance budget gate would have failed on total size and largest file; both were *ratcheted* (recorded with a reason) rather than hidden — the branch's own growth is +11.3 MB total and +4.5 MB for the largest file (the recorded move also includes drift that was already on main). I did **not** split the file to make the number look better; the repo's rules forbid that, and it would not make anything load faster.

**Recalc — 5,000 dependent formulas** (`node ui-audit/measure-univer-vs-old.mjs`, section A; Planyr's engine re-evaluates the whole workbook on each edit, Univer recalculates only what depends on the edit):

| | Planyr engine | Univer |
|---|---|---|
| Deep chain (each formula uses the one above), first calculation | 193 ms | 717 ms (includes loading the sheet) |
| …after changing the first cell | 113 ms | 285 ms |
| Wide (5,000 formulas on one shared input), first calculation | 253 ms | 966 ms |
| …after changing the shared input | 189 ms | 400 ms |

Both are fast enough that you would not feel either at this size. Univer runs on the page's main thread here; it can run its engine in a background worker, which I did not try.

**Memory** (`--sections B`; JS memory after a forced clean-up, minus the same page with a blank workbook):

| Workbook | Old grid | Univer |
|---|---|---|
| Largest real fixture in the repo (tiny, 26 cells) | +1 MB | +2.3 MB |
| 5,000 rows × 12 columns plus a formula per row | +21 MB | +31 MB |

(Univer's fixed cost of simply existing is not in these deltas.)

**First paint** (`--sections C`; a 1,000-row × 12-column sheet; navigation to first readable value, localhost):

| Old grid (the whole app + the Spreadsheet chunk) | Univer (its page + its chunk + engine + first calc) |
|---|---|
| 0.69 s | 2.2 s |

These are against localhost, so the real internet adds the download. The live run records the real click-to-ready time and bytes on planyr.io (see below).

## Live check on planyr.io (V2008256)

{{LIVE}}

## Cutover plan (if you decide to go)

Estimated **12–16 sessions**, in this order — gaps first, because they are what you will notice, and retirement last:

1. **Harden the save path** (1–1.5): flush edits before export, tab switch and unmount; live-verify file mode and org workbooks; confirm the Planyr undo stack and Univer's undo agree.
2. **Fill the Excel-key gaps as one Planyr plugin on Univer** (2): Ctrl+1 and number-format dialog, the Ctrl+Shift format keys, Shift+Space / Ctrl+Space, Ctrl+9 / 0, Ctrl+Plus / Minus, Ctrl+;, Ctrl+5, copy-above, Alt key-tips.
3. **Decide indent** (1): draw it as paragraph indent in the cell, or drop the feature.
4. **Fix the header-drag-moves difference** (0.5) and the load time — prune the unused language files, try the background worker (1).
5. **Look** (1–3): keep Univer's toolbar with the Planyr theme (cheap) or drive a Planyr-styled toolbar from Univer's interface (the flat strip you approved).
6. **Port the Planyr-only features** (2–3): consistency flags and panel, trace arrows, command palette, name manager — on Univer's interface.
7. **One formula engine** (1–2): today Planyr's engine feeds Excel export, the audit tools and the numbers elsewhere; with Univer on screen the two could disagree on edge cases. Pick one and test the Excel export against it.
8. **Rewrite the tests that read cells off the page** (~2): the canvas has no cells to query; they move to Univer's interface (the parity checklist is the pattern).
9. **Dogfood, then default on, then delete the old grid** (1–2): `SheetView.jsx`, `sheetModel.js`'s grid parts and the old engine only once nothing reads them.

## What argues against cutover

- **Weight and speed to appear:** ~1.8 MB first download and ~2 s to show a 1,000-row sheet, against under a second today.
- **The Excel keys you just won are mostly *not* there** and would be rebuilt as plugin code — that is the same kind of work as before, just on someone else's foundation.
- **A canvas grid is invisible to screen readers and to the page-reading tests** the repo relies on.
- **Two formula engines** until step 7, and a different function set (it is richer, but `[Column]` references and Planyr-only functions are not understood).
- **A young, fast-moving dependency** (1.x, many presets and Pro-only extras). Charts, pivots, printing, history and live collaboration are paid; none are needed today, but you asked not to pay, so they are off the table.
- **It moves columns when you drag a selected header** — a small thing, and exactly the sort of surprise that started this.
- **The saved format stays Planyr's**, which is the safe choice, but it means every Univer-only feature (rich text in a cell, vertical merges, data validation) has nowhere to live without changing the model.

## Turning it off for good

`File ▾ → Use the regular grid` per device. To remove it from the code: delete `components/UniverSheet.jsx`, `univerSheet.css`, `lib/univerBridge.js`, `univerTheme.js`, `univerSwitch.js`, the `univerSwitch` lines in `ModelApp.jsx` and `FileMenu.jsx`, the six `@univerjs/*` + `rxjs` entries in `package.json`, and restore the two budget baselines from the ratchet log in `ui-audit/perf-budgets.json`. `SheetView.jsx` and `sheetModel.js` were never touched.

## Commands used

- Round trip: `npx vitest run test/modelUniverBridge.test.js test/modelUniverSwitch.test.js`
- Checklist: `node ui-audit/verify-univer-parity.mjs` (starts the stand-alone host in `ui-audit/univer-sandbox/` itself)
- Old grid unchanged: `node ui-audit/verify-univer-switch-off-identical.mjs <baseline-url> <branch-url>` and `node ui-audit/verify-spreadsheet-flat-chrome.mjs <url>`
- Live: `E2E_LOGIN_KEY=… node ui-audit/verify-univer-live.mjs https://planyr.io`
- Numbers: `node ui-audit/measure-univer-vs-old.mjs --runs 3` (after `npm run build` and `npx vite build --config ui-audit/univer-sandbox/vite.config.mjs`); sizes: the manifest + gzip snippet in this doc's history; budget: `node ui-audit/perf-bundle-audit.mjs --as-pr --compare .perf/base-stats.json`
