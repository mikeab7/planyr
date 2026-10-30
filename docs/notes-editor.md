# Notes box editor → BlockNote (NEW-1, owner decision 2026-10-30) — decision record, measured spike, staged plan

Tracking item: **B2562064** (`ledger/backlog/open/B2562064.md`). Read `docs/NOTES-CARRY-FORWARD.md` first; this file
adds only what the BlockNote swap needs.

## 1 · The decision (owner, verbatim intent)
Keep Planyr's own Notes canvas (boxes, drag by border, pan, placement, page header, box width/shrink). Stop
maintaining a hand-built rich-text and table editor inside each box: each box's content becomes a **BlockNote** editor
instance. Reason: the Notes bug stream (Excel/Word paste, table row fill, text sizing, formatting) is all editor
internals, and a maintained editor owns those.

## 2 · What BlockNote is, and the licence rules (hard)
BlockNote is a block editor built on Tiptap/ProseMirror. It provides tables (headers, split/merge, cell background
colour, cell text colour), a defined paste pipeline (`editor.pasteHTML`, a `pasteHandler` hook), JSON block storage,
undo/redo and keyboard handling, all maintained upstream.
- **Allowed:** `@blocknote/core`, `@blocknote/react`, and ONE UI package (`@blocknote/mantine`) — all **MPL-2.0**.
- **NEVER install or import any `@blocknote/xl-*` package** — those are **GPL-3.0** and would contaminate the app.
  (`package-lock.json` of the spike contains zero `xl-` entries; the day-one check is `grep -c "xl-" package-lock.json`.)
- No BlockNote cloud, no collaboration server, no hosted service. Consume from npm; never vendor or fork. Extend only
  through its schema / extension / `pasteHandler` API. Do not import `@blocknote/core/fonts/inter.css` — use Planyr's type.

## 3 · What the 2026-10-30 spike MEASURED (throwaway project, BlockNote 0.56.0, real Chromium)
**Install and bundle**
- `@blocknote/mantine@0.56.0` resolves **Mantine 9, which needs React 19.2**. Planyr is on **React 18.3.1**, so the UI
  package only installs with **`@mantine/core` and `@mantine/hooks` pinned to `^8.3.11`** (inside BlockNote's own peer
  range). Do not "fix" this by bumping React inside a Notes task.
- BlockNote 0.56 brings **`@tiptap/core` 3.32.x**; Planyr pins `^3.29.2`. Bump the Planyr `@tiptap/*` set to 3.32.x in
  the same commit or two copies ship.
- A bare `BlockNoteView` + Mantine bundles to **≈1.55 MB JS (≈445 KB gzip) + 235 KB CSS (≈37 KB gzip)** — the existing
  Notes editor engine is ≈460 KB, so while both exist the lazy Notes chunk roughly doubles. It must be its own lazy
  chunk and pass `ui-audit/perf-bundle-audit.mjs` (Site Planner / Schedule / Spreadsheet chunks must not grow).

**Paste — `editor.pasteHTML(html)` with NO pre-processing**

| Clipboard HTML | Kept natively | Lost / wrong → needs the pre-processor |
|---|---|---|
| Excel 3×3 (colspan, `background:` fill, bold, italic, `color:` text) | grid, merge (`colspan 2`), CSS fill, bold, italic, text colour | `&nbsp;` empty cell becomes a cell containing a space (not empty) |
| `bgcolor="#FFFF00"` attribute fill | — | **fill dropped** (`backgroundColor: default`) |
| `<font color="#C00000">` | — | **colour dropped** |
| Word table (`MsoTableGrid`, `<o:p>`, nested `<p>`) | grid, merge, `background:` fill, bold, italic, span colour | `<o:p>&nbsp;</o:p>` empty cell becomes a space |
| Word bullets (`MsoListParagraph`, `mso-list:`) | — | **no list**: two paragraphs reading `·         First bullet` (symbol glyph + nbsp padding) |

Not measured yet (do before claiming parity): real clipboard-event paste (as opposed to `pasteHTML`), `rowspan`,
Excel number formats, very large ranges, the Office-style paste-options flyout rewiring.

**Default schema (checked from `@blocknote/core` exports)** — styles: bold, italic, underline, strike, code,
textColor, backgroundColor. Blocks: paragraph, heading, quote, bullet / numbered / check / toggle list items, code
block, divider, table, image, file, audio, video. **Absent: font size, font family, sub/superscript, line spacing,
callout.** These are existing Notes features, so each one is either a custom BlockNote style/block (extension API) or an
owner decision to drop it.

## 4 · Why the swap is not a one-session change (the architecture mismatch)
BlockNote is "one editor instance per document". Notes today is **one Tiptap/ProseMirror document per page** (Tiptap
3.29.2 — **the module already stands on the ProseMirror engine BlockNote is built on**, so there is no engine to "adopt";
the change is replacing Planyr's own table / paste / formatting layer with BlockNote's). A box is a `noteAnchor` **node
inside that page document** (`content: "block+"`, node view with `contentDOM`). Everything below reads that nesting:
- page-wide persistence, version history, cloud merge / `judgeConflict`, the redline and side-by-side review;
- search + decorations, quick-open `docToText`, outline, Markdown export, print / HTML export (PDF-PARITY), templates;
- arrows between boxes, marquee / group move, resize, prune of empty boxes, flow migration, reading order;
- the formatting toolbar (`editor.isActive` on the page editor), slash menu, tab / list-indent / enter-inherit rules;
- **6 required CI gates and ≈60 `ui-audit` harnesses + ≈70 `test/notes*` suites** that type into / measure a box's
  `contentDOM` (`.github/ci-gates.yml`: placement, table click, table copy/paste, paste options, table fill, drag-pan,
  box-edge move).
The CI `build` check runs those gates, so a swap cannot merge half-done: the gates must be rewritten in the same PR.

## 5 · Recommended design (so the box SHELL does not change)
- Keep the `noteAnchor` shell (geometry, selection, border move, resize, marquee, arrows, page growth) exactly as is.
  Make the box **content** an **atom** with attributes `bn` (BlockNote block JSON) and `bnv` (format version), and mount
  one lazy `BlockNoteView` inside the node view (React root in the node view, mounted lazily for off-screen boxes).
- Page-level undo stays the outer history (`bn` commits as one node-attr change on blur / idle); **inside a focused box
  Ctrl+Z is BlockNote's own history** — which is exactly the contract the brief asks for.
- **Legacy → BlockNote on READ, never on write** — the established pattern (`lib/notesFlowMigration.js`, run in
  `NoteEditor.jsx`'s `initialDoc` before `useEditor`; the first real user edit writes the new format, gated by
  `hasUserInputRef` / B1662464). No one-shot DB migration. A box that fails conversion renders its **raw legacy text**
  with a visible "couldn't convert this box" state — an empty box is never acceptable (LOUD-FAILURE).
- Pure adapters from `bn` JSON for every consumer in §4 (Markdown, print HTML, plain text, redline `PlainNode`, prune).
- BlockNote chrome trimmed: no side menu / block drag handle (they fight the border-move affordance, constraint #37), a
  trimmed slash menu, CSS scoped to the box, Planyr tokens in both themes, solid fills, no opacity-as-hierarchy.
- Paste: one `pasteHandler` that pre-processes Office HTML (`bgcolor=`, `<font color>`, `&nbsp;` cells, `mso-list`
  paragraphs → real list items, `colspan`/`rowspan`) into clean HTML and calls `editor.pasteHTML`. The Office-style
  paste-options flyout (`lib/notesPasteModes.js`, B2494096) already exists on main: each option becomes a branch of
  this handler.

## 6 · Staged plan (each stage mergeable on its own)
0. **This record + B2562064** (done). 1. **Engine slice** — pinned deps (§3), lazy chunk, bundle gate, Planyr theme,
   pure `bn` format + version + legacy converter + "couldn't convert" state, Office-paste pre-processor with committed
   Excel / Word / Word-bullet fixtures and red-proof tests (fail on bare `pasteHTML`: the §3 table). Not wired to the
   page. **Sequence the paste half AFTER the in-flight "Notes paste: Word/OneNote tables and bullets" session merges** —
   its captured fixtures become these fixtures; building a parallel set first is the duplication the brief forbids. 2. **The swap** — §5, adapters, gate/harness rewrite, absorb the two in-flight Notes sessions' fixtures
   (paste: Word/OneNote tables and bullets; spacing popover and selection fill). 3. **Parity decisions** — font size /
   family, line spacing, sub/superscript, callout, toggle, task list, images (IDB-id), attachments, find: custom
   BlockNote extension or owner drops it. 4. **Retire** the custom table / paste / toolbar code once nothing references
   it (delete, don't leave dead code). 5. **Live**: signed-in planyr.io check on a throwaway notebook, WebKit phone
   check (`docs/PHONE-TESTING.md`), bundle comparison, V# recorded.

## 7 · Extending BlockNote here
Use the schema API (`BlockNoteSchema.create`, `createStyleSpec`, `createBlockSpec`) and the paste hook only. A feature
Notes has and BlockNote lacks is added as a style/block spec in `src/workspaces/notes/` — never by patching the
package. New packages: core / react / mantine only, never `xl-*`.
