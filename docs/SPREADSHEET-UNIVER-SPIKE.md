# Spreadsheet on Univer — spike report

*Written 2026-10-30 for Michael. Backlog item **B2557488**, live check **V2008256**. This is a trial, not a replacement: nothing about the grid you use today has changed, and only you can see the new one.*

## The short answer

**Univer can carry the Spreadsheet, and it fixes the exact kind of bug that cost you the afternoon — but it is not Excel either, and moving over would be a real project (roughly 12–16 sessions), not a switch flip.**

- **What it fixes, with real keystrokes in a real browser:** Ctrl+Z while typing, a bare letter just typing (no fullscreen), row numbers and column letters that can't be edited, clicking a header to select the whole row or column (plus drag, Shift+click and the corner box), Ctrl+click for a second range, drag-selecting past the edge (it scrolls in all four directions), clearing a cell without the neighbour's text jumping, copy / paste / cut with formulas following, Excel's own clipboard, the fill handle, F2, F4, Alt+Enter, Ctrl+Enter, Ctrl+D / Ctrl+R, Ctrl+A twice, undo / redo across all of it.
- **What the free build did not give you, and what has happened since:** Ctrl+1, the Ctrl+Shift number-format keys, Shift+Space / Ctrl+Space, Ctrl+9 / Ctrl+0, Ctrl+Plus / Ctrl+Minus, Ctrl+; and Ctrl+5, and the Alt key-tips were all missing in the spike run and have since been built as ONE Planyr plugin on Univer's own command and shortcut services (`src/workspaces/model/lib/univerExcelKeys/`, cutover step 2) — see the Alt paths below.
- **Header drag now matches Excel (fixed 2026-10-30, B2577680):** a plain drag on a row or column header — selected or not — extends the selection; only **Shift+drag** moves the row or column. It was the one place Univer differed from Excel on purpose.
- **What it costs:** the first time you flip the switch your browser downloads about 1.8 MB of compressed code (more only if needed); the sheet takes a couple of seconds to appear instead of under one; Planyr's own formula engine is 3–4× faster than Univer's (both are well under a second at 5,000 formulas); the project's build now needs a lot more memory.
- **What stays safe:** with the switch off the old grid is **byte-for-byte identical** (screenshots compared against the build before this work). Saving goes through exactly the same path as today. Nothing of yours was touched — every test used throwaway data on the test account.

**My recommendation:** use it for a week on a real model of your own (File ▾ → *Try the new grid*), then decide. If the Excel-key gaps and the load time are tolerable, follow the cutover plan below. If not, the whole thing can be deleted cleanly (see *Turning it off for good*).

## What is in the box (plain English)

- **The switch.** *File ▾ → Try the new grid* appears **only** if the app confirms you are the owner (the same check the admin page uses). Everyone else sees exactly today's menu. Your choice is remembered per device; default is off.
- **The grid.** Univer draws the sheet on a *canvas* (a single picture the browser paints, rather than thousands of little page elements). That is why it is fast on big sheets and also why the old tests that read cell text off the page can't be reused as-is.
- **The bridge.** A translator between Planyr's saved workbook and Univer's. It is tested to give back *exactly* what it was given for every field the model stores, using the real fixture files plus a workbook that uses every field. Things Univer can't hold are carried in a side pocket (a "sidecar": column ids, the exact text you typed, and so on) so nothing is lost; the few things that genuinely can't survive are reported in plain words on screen instead of vanishing.
- **Saving.** An edit in Univer is converted back to a Planyr workbook after a third of a second and handed to the *same* save routine as every other edit — same device copy, same cloud upload, same file-mode and org-workbook paths. The "different copy saved in the cloud" bar did not appear in any run.
- **Project names.** `Site.Acres`, `Plan.Building1.SF`, `Comp.<title>.RentPSF` work **exactly as typed** — Univer accepts the dots in names, so no renaming was needed. They recompute when the site changes and are never saved into your workbook as names of their own.
- **Licence and cost.** Only the free, open-source Univer packages (version pinned; nothing from the paid "Pro" family, no licence key, no Univer server, no call to any Univer website — the run watched the network and saw none). Excel / CSV import and export stay on the existing path; Univer's own file converters are not used.
- **Look.** The colours come from Planyr's own theme, and since 2026-10-30 (B2574352 / B2574353) the header is **one flat, left-aligned strip**: Univer's tab row (Start / Formulas / Data / View) is folded into a "Start ▾" dropdown at the far left and the chosen tab's tools sit left-packed beside it, above the formula bar. It is Univer's own `collapsed` ribbon layout (a preset option, no fork, nothing hidden by hand) flattened by CSS — square, no pill, no shadow. Measured: Univer's default header is two strips, 76 px; this is one strip, 40 px (the old Planyr Ribbon strip is 33 px). Undo and redo are curved arrows (Univer's icon registry accepts a replacement by name; the old Ribbon's glyphs are right-angle elbows, so they were not reused). Univer's formula bar, sheet tabs and zoom are still its own. Guard: `ui-audit/verify-univer-header.mjs` (red on the previous header). Remaining Look work: see cutover step 5.

## Excel-parity checklist

Run with real keystrokes and mouse (never fake key events) against the real component; the grid is a canvas, so state is read back through Univer's own programming interface (its "facade"). Result tally (after the Excel-keys plugin, 2026-10-30): every row now reads Works (the plugin took 13 rows from "not in the free build"; indent, B2572784, and header drag, B2577680, were closed by the two sessions that ran beside it). Before the plugin it was 29 · 14 · 1. Items driven through that interface rather than the toolbar (merge, freeze, filter, sort, formats, wrap, sizes, hide) test that the *engine* does it, not that each toolbar button is wired — I looked at the toolbar and right-click menus (Start / Formulas / Data / View; Copy, Paste Special, Clear, Insert, Delete, Hide, Width, Fit-for-data, Freeze, Sort are all there) but did not click every button.

| Checklist item | Result | What the run saw |
|---|---|---|
| Ctrl+Z while typing in a cell undoes the typing only; after you commit, one Ctrl+Z undoes the cell as one step | **Works** | typing undone to "ab" with the sheet untouched; the committed cell undid as ONE step |
| A bare letter with a cell selected starts typing (never triggers the app's F fullscreen or any one-letter shortcut) | **Works** | typed "foo" into the cell; document.fullscreenElement stayed null |
| Row numbers and column letters cannot be edited by any route | **Works** | double-clicking a column letter or a row number opens no editor (0 edit events); the labels are painted by the grid and have no stored text |
| Click a header selects the whole row/column; drag and Shift+click extend; the corner box selects all | **Works** | column click, drag C→E, Shift+click G, row click and the corner box all select the right ranges |
| (extra) Dragging an already-selected header | **Works** (was: Differs from Excel) | fixed 2026-10-30 (B2577680): a plain drag extends the selection (C → C:E, C1 stays "cherry"); **Shift+drag** moves the column or row, as in Excel; the border still resizes and a double-click still autofits. Gate in `lib/univerHeaderMove.js` in front of Univer's own header-move permission check — no package patched. Checks `header-drag-moves`, `-rows`, `header-shift-drag-moves`, `header-resize-autofit` in `ui-audit/verify-univer-parity.mjs` |
| Ctrl+click adds a second, separate range | **Works** | A1 and C3 selected together |
| Drag-select past the visible edge autoscrolls in all four directions | **Works** | right to col 25, down to row 47, left to col 0, up to row 13 |
| Text spills over empty neighbours; clearing a cell never moves the text beside it | **Works** | label spills (271 px of ink in the empty neighbour); clearing A5 left B5's pixels identical |
| Increase / decrease indent on any cell | **Works** (built on Univer, B2572784) | the free build has no indent field and no indent command, but its cell style has a padding (`pd`) that the renderer honours and its commands keep. Planyr stores the indent as `pd.l = 2 + 14·N` on the cell's own style, draws it on the reading side only (left / right / none for centred, clamped to the column) with a render interceptor, and adds Decrease / Increase Indent buttons on the Start tab with the old Ribbon's icons plus two bindable command ids (`planyr.sheet.command.decrease-indent` / `.increase-indent`). Pixel-sampled in the parity run: the painted left edge moves +14 / +28 per click and back, one Ctrl+Z per click, the saved workbook says indent 2, right-aligned text insets on the right, centred is unchanged, a long label still spills, a deep indent in a narrow column never leaves it, and the indent follows its cell through a column insert, an edit and a copy / paste. Live check: V2028480. |
| Ctrl+B bold | **Works** | toggles on and off |
| Ctrl+I italic | **Works** | italic on |
| Ctrl+U underline | **Works** | underline on |
| Ctrl+5 strikethrough | **Works** | added by the Planyr Excel-keys plugin (NEW-1): line-through on, one Ctrl+Z removes it, a second Ctrl+5 toggles it off; also fires inside the cell editor like Ctrl+B/I/U |
| Ctrl+1 Format Cells dialog | **Works** | opens Univer's number-format panel (Format types, Confirm / Cancel) — the plugin binds the key to Univer's own panel; Alt H N does the same |
| Ctrl+Shift+$ currency | **Works** | `$#,##0.00` on every cell of the selection (A1 shows $1.00); one Ctrl+Z restores the sheet exactly |
| Ctrl+Shift+% percent | **Works** | `0%` (Excel's own); one undo step |
| Ctrl+Shift+! number | **Works** | `#,##0.00`; one undo step |
| Ctrl+Shift+~ general | **Works** | back to General (A1 shows 1); one undo step |
| Ctrl+Shift+# date | **Works** | `d-mmm-yy`; one undo step |
| Ctrl+Shift+& outline border, Ctrl+Shift+_ remove border | **Works** | outline of A1:B2 puts top+left on A1 and bottom+right on B2 only, nothing inside; Ctrl+Shift+_ clears it; each one undo step |
| Ctrl+A twice (data region, then everything) | **Works** | first press A1:C5, second press everything |
| Shift+Space (row) and Ctrl+Space (column) | **Works** | one cell → the whole row / whole column; a 2×2 block → both rows / both columns whole |
| Ctrl+Shift+Arrow | **Works** | selected A1:A5 |
| Ctrl+Plus / Ctrl+Minus (insert / delete) | **Works** | a whole row or column inserts / deletes at once; on cells Excel's shift prompt appears (Shift cells right / down / Entire row / Entire column; letter accelerators; Enter = default, Esc = nothing changes); the numpad keys too; two separate ranges are refused in Excel's words; each one undo step |
| Ctrl+9 / Ctrl+0 (hide row / column), Ctrl+Shift+9 / Ctrl+Shift+0 (unhide) | **Works** | row 3 and column C hid; the unhide chords un-hid them across a selection spanning them; each hide one undo step |
| F2 | **Works** | F2 kept the text and appended ("alphaX") |
| F4 | **Works** | =A1 → =$A$1 |
| Alt+Enter | **Works** | "a⏎b" in one cell (Univer stores the break as a carriage return; the bridge saves it as a newline) |
| Ctrl+Enter | **Works** | A7:A9 all 7 |
| Ctrl+D and Ctrl+R | **Works** | A2:A4 = 1 and C1:E1 = alpha |
| Ctrl+; (today's date), Ctrl+Shift+; (the time) | **Works** | a real date value (Excel serial, `m/d/yyyy`) and a real time-of-day (`h:mm AM/PM`), not text; a cell already formatted keeps its format; one undo step |
| Alt key-tips (Alt H O I …) | **Works** | Alt alone shows the key-tip strip and badges on the toolbar buttons; Esc backs out one level; the Alt keyup is cancelled so Windows browsers don't focus their menu bar; Alt+Enter stays a chord. Every path in the shared table runs (see below) |
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


**The Alt paths that now run on the Univer grid** (the table is the SAME one the old grid and the Keyboard Shortcuts page use — `lib/keyTips.js` — so there is one list, true for both): H O I / H O A autofit column / row · H O W / H O H width / height (a number prompt) · H B A / N / O / T borders · H H fill colour and H F C font colour (open the toolbar's own palette) · H A L / C / R and T / M / B alignment · H W wrap · H M M / C / U merge, merge & centre, unmerge · H I R / C and H D R / C insert / delete row / column · H E A / F / C clear all / formats / contents · H S S / O / F sort A→Z, Z→A, filter · W F F / R / C freeze · H 0 / H 9 decimals · H K comma · H P percent · H 1 / 2 / 3 bold / italic / underline · H N number-format panel. **One honest limit:** Univer's colour palette (Alt H H and Alt H F C) opens and is then driven with the arrow keys and Enter — Excel's gallery, not a typed letter. **Keys of the old grid with no Univer equivalent yet, named and not silent** (`UNIVER_UNSUPPORTED_CHORDS` in `bindings.js`, unit-tested): Alt+= AutoSum, F4 repeat-last outside the editor, Shift+F11, Ctrl+PgUp / PgDn (the host's tab switching), Ctrl+S (the host save path). Browser-level effects — Ctrl+0 / Ctrl+Plus / Ctrl+Minus not zooming the page — are a `preventDefault` a headless browser cannot show; the live check records what it can and says so.

"Not in the free build" means the key demonstrably did nothing in the run (or the control does not exist). A harness that can only see "nothing happened" cannot tell *unbound* from *bound but broken*, so read these as "does not work today".

## What carried over cleanly, and what did not

**Carried over (proven by the round-trip test on real files):** every value and formula exactly as typed; number formats; bold / italic / underline / strike, font, size, text and fill colour, alignment, wrap, thin and double borders; horizontal merges; frozen panes; row heights and column widths; hidden rows and columns; named ranges (per sheet); sheet tabs, order and names; the stable column ids; the "dismissed inconsistency" and "imported formula I couldn't translate" markers.

**Does not carry or needs work — said plainly:**
- **Indent** — now drawn (B2572784, see the table row above). The sidecar no longer carries it: the number lives on the Univer cell style so it follows its cell through every structural edit.
- **File mode, org workbooks** — wired through the same save routine; the spike's live run used an ordinary project workbook. Exercised by `ui-audit/verify-univer-save-live.mjs` (B2577681, V2033376): see *Save path* below for the dated result.
- **Formula-consistency flags and the Inconsistencies panel, trace precedents / dependents, the command palette, the Name Manager and the input / formula colour convention** — **PORTED 2026-10-31 (B2586720, cutover step 6; live check V2035776)** as one Planyr plugin on Univer's own services (`lib/univerTools/`, `components/UniverTools.jsx`). They read cells through the bridge (the old grid's own pure rules, unchanged, run on the Planyr workbook built from Univer's live state) and write through Univer commands, one undo step each. See *Planyr-only tools on Univer* below. Still hidden / different: "General" fit, the sheet zoom, the old Find bar (Univer's own zoom slider, find panel and name box do those jobs).
- **Filters** — Univer's filter works, but Planyr does not store filter state in the workbook (it didn't before either), so a filter is gone on reload.
- **Vertical merges** made in Univer, formulas written with `[Column]` names, a typed date such as `1/15/2027` (Univer treats it as text until you give it a date format), and formatting *inside* a cell (mixed bold in one cell) — reported on screen when a save would lose them.
- **Export while typing** — **RESOLVED 2026-10-30 (B2577681).** Export, the grid toggle, hiding the module tab, closing a file, changing project / workbook / file, reloading and closing the page now all flush the grid first (`lib/univerSave.js`; see *Save path* below). Export reads the up-to-date workbook straight from the flush instead of the saved copy a render behind it.
- **Dark theme** — the first cut was wired to follow the app theme but only the light theme had been looked at, and it was unreadable in dark (B2566048, owner report 2026-10-30). Fixed and now guarded: Univer's gray scale never flips direction (its dark mode picks the other end of it) and its canvas is painted through a colour inversion, so `lib/univerTheme.js` builds a per-mode theme and writes the canvas-facing steps as the pre-image of that inversion; `UniverSheet.jsx` rebuilds it on every light/dark flip. `ui-audit/verify-univer-theme-contrast.mjs` (sandbox) and `verify-univer-theme-live.mjs` (signed in) measure the pixels in both themes, mounted and flipped while open.
- **Phone / touch** — not tried.

**Planyr's 93 commands (the registry the old grid's keys, palette, ribbon and menus all run):**
- *Have a Univer equivalent (toolbar, right-click menu or key):* undo / redo, format painter, clear formatting, bold / italic / underline / strike, horizontal and vertical alignment, wrap, merge, percent / currency / decimals, borders, insert / delete rows and columns, freeze, sort, filter, find, sheet add / duplicate / rename / delete, copy / cut / paste, fill right, clear, hide / unhide, column width and autofit, zoom, Autosum (Formulas tab).
- *Need wiring to a Univer action:* Excel / CSV import and export (kept in Planyr's header and working through the saved workbook), Name Manager, number-format dialog, insert date / time, copy-above, repeat-last, previous / next sheet, cancel-cut.
- *Not in the free build or Planyr-only (built on Univer, all done):* the Excel key set listed above, Alt key-tips, the "blue input / black formula" colour convention toggle, formula-consistency flags, trace arrows, the command palette, the Name Manager.

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

**Passed on planyr.io, 2026-10-30, build `9430619`** (the merge commit; the served build id was read in the same call as every assertion), signed in as the test account on a throwaway project that was deleted afterwards and re-read as gone (`node ui-audit/verify-univer-live.mjs https://planyr.io`).

- **The gate, both sides.** The real `is_admin()` answer for the test account is `false`: the File menu has no "Try the new grid" row, a stored "on" does nothing, and **no Univer file is requested at all**. With that one answer replaced by `true` for that one browser (a visibility switch, not a security boundary — data access is still the test account's own), the row appears.
- **Mount.** Click to a working grid: **about 1–2 seconds, network included**; the switch downloaded **3 files, 1.67 MB compressed** (6.8 MB unpacked) — only after the click.
- **Keyboard, on the real page.** 18 of 18 checks of the subset pass (Ctrl+Z while typing, bare letter, fixed headers, header selection, Ctrl+click, Ctrl+B/I/U, Ctrl+A twice, F2, F4, Alt+Enter, Ctrl+Enter, Ctrl+D/R, copy / paste, cut with formulas following, fill handle, undo / redo).
- **Saving.** A value typed in Univer reached the **same cloud row** the regular grid uses, in Planyr's own shape (stable column ids, text as typed, `=A1+A2` as a formula); no "different copy" bar; switching back showed the value in the regular grid and forgot the device choice.
- **Project names.** `=Site.Acres` and `=Plan.Building1.SF` arrived as typed and showed **exactly what the regular grid showed**. On the throwaway plan both grids answer with an error (`#REF!` / `#NAME?`, because that plan has no origin or element rows), so this proves the two grids agree and fail loudly the same way; the *numeric* answers are covered by the sandbox run (names evaluate and recompute) and the repo's project-reference tests, **not** by a live number.
- **Found while running it, both harness faults, not product faults:** the undo check pressed more undos than it had edits (on the real page that reached back into its own setup), and the names check demanded numbers where the plan yields errors. Both were fixed in the harness and the run repeated clean.

**What it did not and cannot prove:** it ran as the test account with the owner check answered "yes" for that browser; no session can sign in *as you*, so the real owner switch on your own account is yours to try. Nothing is needed from you for the check itself.

## Cutover plan (if you decide to go)

Estimated **12–16 sessions**, in this order — gaps first, because they are what you will notice, and retirement last:

1. ~~**Harden the save path** (1–1.5)~~ **DONE 2026-10-30 (B2577681)** — see *Save path* below.
2. **Fill the Excel-key gaps as one Planyr plugin on Univer** (2) — **DONE 2026-10-30 (B2573632):** Ctrl+1 and number-format dialog, the Ctrl+Shift format keys, Shift+Space / Ctrl+Space, Ctrl+9 / 0, Ctrl+Plus / Minus, Ctrl+;, Ctrl+5, copy-above, Alt key-tips. 33 strict checks in `ui-audit/lib/univerExcelKeysChecks.mjs`, every one red on the build before the plugin.
3. **Decide indent** (1): ✅ DONE (owner: keep and draw it) — B2572784; stored as the cell's own padding, drawn by a render interceptor, buttons + command ids on the Start tab.
4. ~~**Fix the header-drag-moves difference** (0.5)~~ **DONE 2026-10-30 (B2577680).** The load time — prune the unused language files, try the background worker (1) — is still open.
5. **Look** (1–3): *header done 2026-10-30 — one flat left-aligned strip with the tab dropdown, curved undo / redo (B2574352 / B2574353); Univer's own toolbar is kept, themed and flattened.* Still open: the formula bar, the sheet-tab strip and any Planyr-only toolbar items other cutover steps add.
6. ~~**Port the Planyr-only features** (2–3)~~ **DONE 2026-10-31 (B2586720; live V2035776 pending):** consistency flags and panel, trace arrows, command palette, name manager and the colour convention — on Univer's interface.
7. **One formula engine** (1–2): today Planyr's engine feeds Excel export, the audit tools and the numbers elsewhere; with Univer on screen the two could disagree on edge cases. Pick one and test the Excel export against it.
8. **Rewrite the tests that read cells off the page** (~2): the canvas has no cells to query; they move to Univer's interface (the parity checklist is the pattern).
9. **Dogfood, then default on, then delete the old grid** (1–2): `SheetView.jsx`, `sheetModel.js`'s grid parts and the old engine only once nothing reads them.

## Planyr-only tools on Univer (cutover step 6 — B2586720, 2026-10-31)

One plugin, `src/workspaces/model/lib/univerTools/` (+ `components/UniverTools.jsx`), installed by ONE call in `UniverSheet.jsx` and disposed with it. It imports nothing from `@univerjs` — Univer's services arrive by injection — so the "only UniverSheet.jsx imports Univer" rule and its unit tests still hold. **One rule set, two grids:** the old grid's pure libraries run unchanged on the Planyr workbook the bridge builds from Univer's live state (`snapshot()`), so a flag, an arrow, a colour or a name means exactly what it means on the old grid, and the saved workbook format does not change.

| Tool | Drawn / shown by | Written through |
|---|---|---|
| **Consistency flags** | a `SheetInterceptorService` CELL_CONTENT interceptor adds Univer's own corner marker (top-left triangle; one colour per kind) to each flagged cell; the same `InconsistencyPanel` lists them, a row jumps the selection | Dismiss = a Planyr mutation (`planyr.tools.mutation.set-dismissed`) on the bridge sidecar with its inverse pushed on Univer's undo stack — one Ctrl+Z restores marker, flag and the saved key; saved as `sheet.dismissedInconsistencies["<colId>:<row>"]`, the old grid's key |
| **Trace precedents / dependents** | toolbar buttons start / step it for the active cell (a second click = one level further); a `SheetExtension` on the sheet component draws dot + dashed range box + arrow to the dependent's edge in sheet coordinates (scrolls and zooms with the cells), labels for links that leave the sheet; a status strip names level / truncation | a view only, never stored; Escape or any edit that can change dependencies clears it |
| **Command palette** | Ctrl+K (stays THE palette) opens the same `CommandPalette` component fed the registry's commands | every row runs through `ICommandService`: tool command → Excel-keys plugin (`planyr.excel.<id>`) → a Univer-native id → the tools' number-format command. A registry command with no route is NAMED in `PALETTE_UNAVAILABLE` with its reason (a unit test fails otherwise) |
| **Name Manager** | the same `NameManager` component | define / retarget / delete = Univer's `SetDefinedNameCommand` / `RemoveDefinedNameCommand`, local to the sheet, with the id shape the bridge loads; rename also rewrites the formulas (the old grid's `renameName` rule) inside the same undo group — one Ctrl+Z reverts name and formulas. Saved as `sheet.names` through the bridge, as before |
| **Input / formula colours** | the same interceptor sets the text colour: typed input blue, cross-sheet link green, ordinary formula keeps the text colour; a colour the person set always wins; ON by default (as before), toggle on the Formulas tab, same per-project preference key | nothing — a drawing choice, never written into cells |

The seven buttons sit first in the Formulas tab of the one header strip (so they stay visible at 1440 px; Start's tools already overflow there). **Honest limits:** clicking a cross-sheet trace label does not navigate (canvas labels are not clickable; the old grid's were DOM); cells filled by Univer's fill handle carry a "shared formula" id and no formula text, so they colour as ordinary formulas (never green); no palette rows for Copy / Cut / Paste (the browser clipboard needs a real keypress), sheet duplicate / rename, import / export, and the top / double-bottom border rows (reasons in `PALETTE_UNAVAILABLE`).

**Checks:** `test/modelUniverTools.test.js` (22: the old rules through the Univer-side keys, dismissal key byte-compatibility incl. the bridge round-trip, trace shapes, name ids vs the bridge's, palette coverage, wiring guards); parity-harness `tools-*` checks in `ui-audit/lib/univerToolsChecks.mjs` (real clicks / keys; canvas pixels for marker, arrow and text colour; facade + the saved workbook; one undo step each) — all seven **red on the build without the plugin**, green with it; the same checks run on the real app as section **T** of `verify-univer-live.mjs` (V2035776). The two existing parity checks that measure DARK ink (`spill-and-clear`, `indent`) now start with the colour convention off, because it is on by default and recolours typed text.

## Save path (cutover step 1 — B2577681, 2026-10-30)

How an edit travels: Univer edit → `lib/univerSave.js` (debounce 300 ms, the echo guard, and a synchronous **flush**) → `UniverSheet`'s `onChange` → `ModelApp.onUniverChange` → the ONE `commit` (write-through, cloud push, file mode, org workbooks as today).

- **The gap that was open:** an edit sat inside Univer for up to 300 ms before it was a Planyr workbook. Export, a grid toggle, a hidden tab, closing a file, a project change and the page closing could all miss it — and the unmount path flushed *after* marking itself disposed, which made its own flush a no-op.
- **Now every way out flushes first** — `flushUniver()` in `ModelApp` is synchronous and idempotent and returns the workbook as it is now: **Export** (xlsx and csv read that, a failed flush stops the export with a message — never a stale file) · **the grid toggle** (also commits text still typed in an open cell editor) · **hiding the module tab** · **Close file** · **project / org workbook / file change** (a layout-effect cleanup, which runs before the load that replaces the workbook and before the file hook's "upload what I'm leaving" step) · **unmount** · **`beforeunload`, `pagehide`, tab hidden**.
- **An urgent flush persists synchronously** (React does not render before a closing page dies): the local copy and the dirty mark are written in the same call — the same safety net the regular grid's write-through gives — so the next open pushes it (`decideLoadSync` "push-local"), and the red "different copy" bar is not raised. A grid that is going away because the project changed saves into the project it was *showing*, never into the one being opened, and starts that project's upload at once (best effort — the regular push effect for it is cancelled by the change).
- **A save that fails is loud:** the controller reports it (status badge → error, a message, a telemetry row `model-univer-save-failed`), keeps the edit pending, and the next flush retries it.
- **Echo guard with two saves in flight:** a queue of what was emitted but has not yet come back down as the `workbook` prop, so the grid is never rebuilt to the *older* of two quick saves.
- **Undo:** the regular grid's Ctrl+Z after switching back from Univer takes **one step per committed Univer edit** (each flush is one `commit`; a burst inside one debounce window is one step; flushing again with nothing new adds none). Univer's own history lives only as long as the Univer grid is mounted — switching away discards it, while Planyr's stack keeps going — so Ctrl+Z in Univer never reaches back past the switch. Univer's own undo/redo are mutations like any edit, so they flow out as new commits and the two stacks stay in agreement about *content* (neither tries to replay the other's frames).
- **Guards:** `test/modelUniverSave.test.js` (controller red-proofs incl. the old unmount order reproduced, wiring); `ui-audit/verify-univer-save-path.mjs` (real Chromium, real keys, leaving INSIDE the debounce window — export, idempotent, unmount, a real navigation and a real reload, two quick saves, mid-typing, a failing snapshot); `ui-audit/verify-univer-save-live.mjs` (signed in on planyr.io, debounce frozen so only the flush can save: toggle, Export re-read with ExcelJS, module tab, project change, reload, Ctrl+Z, a Library `.xlsx` in file mode, an org workbook).

- **Live result (2026-10-30, planyr.io build `d9a0082`, test account, V2033376 run 2): every arm PASSED** — header drag (5 checks), toggle, Export (.xlsx re-read), module tab, project change, reload, regular-grid Ctrl+Z (one step per committed Univer edit), a Library `.xlsx` in file mode (saved in place, reopened with the edit in the regular grid, original kept byte for byte), and an org workbook. The org arm first FAILED and found a bug that is not Univer's — a new org workbook never uploaded its edits in either grid (B2584320, fixed in the same session).

## What argues against cutover

- **Weight and speed to appear:** ~1.8 MB first download and ~2 s to show a 1,000-row sheet, against under a second today.
- **The Excel keys you just won are mostly *not* there** and would be rebuilt as plugin code — that is the same kind of work as before, just on someone else's foundation.
- **A canvas grid is invisible to screen readers and to the page-reading tests** the repo relies on.
- **Two formula engines** until step 7, and a different function set (it is richer, but `[Column]` references and Planyr-only functions are not understood).
- **A young, fast-moving dependency** (1.x, many presets and Pro-only extras). Charts, pivots, printing, history and live collaboration are paid; none are needed today, but you asked not to pay, so they are off the table.
- ~~**It moves columns when you drag a selected header**~~ — fixed (B2577680): a plain drag extends, Shift+drag moves, as in Excel.
- **The saved format stays Planyr's**, which is the safe choice, but it means every Univer-only feature (rich text in a cell, vertical merges, data validation) has nowhere to live without changing the model.

## Turning it off for good

`File ▾ → Use the regular grid` per device. To remove it from the code: delete `components/UniverSheet.jsx`, `univerSheet.css`, `lib/univerBridge.js`, `univerTheme.js`, `univerSwitch.js`, the `univerSwitch` lines in `ModelApp.jsx` and `FileMenu.jsx`, the six `@univerjs/*` + `rxjs` entries in `package.json`, and restore the two budget baselines from the ratchet log in `ui-audit/perf-budgets.json`. `SheetView.jsx` and `sheetModel.js` were never touched.

## Commands used

- Round trip: `npx vitest run test/modelUniverBridge.test.js test/modelUniverSwitch.test.js`
- Checklist: `node ui-audit/verify-univer-parity.mjs` (starts the stand-alone host in `ui-audit/univer-sandbox/` itself)
- Old grid unchanged: `node ui-audit/verify-univer-switch-off-identical.mjs <baseline-url> <branch-url>` and `node ui-audit/verify-spreadsheet-flat-chrome.mjs <url>`
- Live: `E2E_LOGIN_KEY=… node ui-audit/verify-univer-live.mjs https://planyr.io`
- Numbers: `node ui-audit/measure-univer-vs-old.mjs --runs 3` (after `npm run build` and `npx vite build --config ui-audit/univer-sandbox/vite.config.mjs`); sizes: the manifest + gzip snippet in this doc's history; budget: `node ui-audit/perf-bundle-audit.mjs --as-pr --compare .perf/base-stats.json`
