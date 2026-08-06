# Notes workspace — folder pointer

A note-taking module with exactly **TWO CONCEPTS: a project, and PAGES THAT CAN HOLD
SUBPAGES.** Internal id `notes`, route `#/notes`, magenta-plum accent `--accent-notes`. A
**top-level page belongs to a project** (or to the named "Not in a project" home); a subpage's
project is its root's, derived. Root rules in `/CLAUDE.md`.

> **⛔ SUPERSEDED — the four-level `project › notebook › section › page` model is GONE (B1420,
> 2026-08-05), and this note exists so a future session does not rebuild it from a stale
> comment.** The owner decided it himself: *"so i dont need a project to have multiple
> notebooks i dont think, like grand port being its own notebook is great as long as i can
> have subpages there."* **The project IS the notebook.** There is no notebook layer to pick
> and no separate species called a "section" — "Entitlements" is not a different KIND of
> thing from "Bonding", it is simply a page that has pages under it, and **anything can have
> children at any depth**. That is precisely what OneNote structurally cannot do, so do not
> reintroduce the distinction by the back door: no `kind` field, no depth ceiling, no
> "container" flag. `addNotebook` / `addSection` / `moveSection` / `moveNotebook` /
> `setNotebookProject` / `visibleNotebooks` / `notebooksInScope` / `notebookToMarkdown` are
> all deleted. The one-way migration off the old shape is the ONLY code that may mention a
> notebook or a section; its rules are written out in the header of `lib/notesModel.js`.

**The decision everything else follows from:** the **document model** (ProseMirror JSON) is what
persists — never Markdown. Markdown cannot express a merged table cell, a text colour, a font
size, a highlight or a checked task, so storing it would cap the editor at what Markdown can
spell. Markdown is an **export**, and an honest one: `docToMarkdown` returns the list of
constructs that needed an HTML fallback so the UI can name them.

**The second decision, and it is just as load-bearing:** a page's **pictures are not in the
document**. Notes live in localStorage, which is a few megabytes for the whole origin — base64
would let *two phone photos* exhaust it and break every save in every note after that. So the
document holds an image **ID** and the bytes live in **IndexedDB**, behind the same one storage
seam. Do not "simplify" an image back into the document model.

**A PAGE BELONGS TO A PROJECT — and nothing can become unreachable (B1374, amended by B1420).**
Created inside a project it is filed there with no extra step; created from the Dashboard it
belongs to no project. **Inside a project the rail shows that project's pages and nothing else,
with NO project badge on any row** — everything on screen belongs to where you are standing, so
a badge has nothing to say. **The Dashboard is the all-projects view**: every project's pages,
grouped under the project's name, no-project group last, and that heading is the ONE place a
project label belongs. It is one click from the header crumb on every screen, which is what
keeps B1374's "nothing can become unreachable" guarantee true now that the in-rail scope switch
is gone. The full rule, including what migrates and how the filing rides the cloud sync, is
written out in the header of `lib/notesStore.js`; read it there rather than re-deriving it.

**Files**
- `Notes.jsx` — workspace root (lazy chunk). Owns the TREE, the BIN, search, export, print, the
  PROJECT LIST (loaded honestly — see B1419/B482 in its header), and the storage-error banner.
  It also **persists the one-way migration** on the first load that sees the old four-level
  shape, so the new shape rides the cloud tree blob rather than being re-derived forever. Three
  load-bearing details: the editor is pulled by `lazy()` **from this
  file** so the tree paints before the engine downloads; `<NoteEditor key={activePageId}>` — the
  remount per page is a bug fix, not a style choice; and the print serializer is reached by a
  **dynamic** `import()` only, because it pulls the schema and the schema pulls the engine.
- `components/NotesTree.jsx` — the left rail, in three views (**Pages · Recent · Bin**). ONE
  row component at every depth — there is no notebook row and no section row. The **header
  block is TWO rows** (B1420): search + a quiet `＋ Page`, then the view tabs. What went, and
  must not creep back: the full-width primary-filled "New notebook" button (loudest thing in
  the panel, for one of the rarest actions), the project/all **scope switch** (the Dashboard is
  the all-projects view and its crumb is already on screen), the Bin tab's permanent **count**
  (it lives inside the Bin view, where it is the point), and the per-row **timestamp column**
  (now the row's hover title; Recent is where recency is the point). The rail **opens the path
  to the current page and leaves the rest collapsed**, and never auto-collapses a branch you
  opened. A row shows its **name and nothing else**: New subpage / Rename / Move / Belongs to /
  Export / Print / Delete live on a **right-click menu** (B1367), reachable from the keyboard
  with the context-menu key or Shift+F10; **dragging a row onto another files it under that
  page**, and onto a project's group heading lifts it back to the top level. Rename is still an
  inline field (Enter commits, Esc cancels), delete still asks with an inline "Delete? ✓ ✕" row
  (naming how many pages the subtree takes) and still bins — **no `window.prompt`/`confirm`/
  `alert` anywhere** (house rule). The row's key handler answers Enter/Space, Left/Right and the
  menu keys and **nothing else** — Delete and Backspace are permanently unhandled here (B1366),
  because hovering is not intent. Esc in the search box clears the query.
- `components/NoteEditor.jsx` — one page: title, toolbar, find bar, document. The sheet is
  **left-aligned, not centred** (B1369 — centring read as "my text is over on the right" on a
  wide monitor), and the whole pane is a **mat that forwards a press to the caret** (B1368 —
  clicking below or beside the text used to do nothing). **The only module on this route that
  imports the React editor binding.** Its header documents the two bugs the live
  checks caught (a page switch inside the save debounce losing the last edit; reopening a note with
  a table crashing on `setContent` against a torn-down instance) — read it before changing the save
  path. There must never be a "sync content on pageId change" effect; the search effect there is
  decorations-only and guards `isDestroyed`, which is the bar any new effect has to clear.
- `components/NoteToolbar.jsx` — formatting bar, **grouped by frequency**: what you reach for while
  writing on the row, the long tail behind **More**. Every active state is read from
  `editor.isActive(...)`, never mirrored into React state; every control cancels `mousedown` so the
  caret survives a click. Holds the module's only literal colours — the text/highlight **content**
  palette, which must not be theme tokens. Text colour and highlight draw **different glyphs**
  (B1370 — they were the same "A" twice); **font size is on the row**, not in More (B1371 — a
  control nobody can find is one that does not exist); and the table button opens a
  **drag-to-size grid** (B1372), never a fixed 3×3 and never a dialog. It re-declares the two shared control radii locally
  instead of importing the shared `shared/ui/controls` primitives: that import makes the bundler
  hoist a third shared chunk onto the **Site** route and the perf audit goes red.
- `lib/notesModel.js` — PURE page-tree schema + every structural op, page **timestamps**, the
  project filing (`pagesInScope` · `projectGroups` · `setPageProject` · `projectOfPage`), the
  **bin**, and **the one-way migration off the superseded four-level shape — read its header
  before touching anything here.** `movePage` is the ONE move (reorder · nest · lift to top) and
  it REFUSES a move into a page's own subtree. `deleteNode` is a SOFT delete: it lifts the node
  into `tree.trash`, computes the FULL cascade of its whole SUBTREE at every depth
  (TOMBSTONE-DELETES) and stamps it on the entry; `restoreNode` / `purgeTrashEntry` /
  `expiredTrashIds` are the rest of the 30-day lifecycle.
- `lib/notesStore.js` — **the ONE storage seam.** Keys `planyr:notes:tree:v1:<scope>`,
  `planyr:notes:page:v1:<scope>:<pageId>` and (B1291) `planyr:notes:sync:v1:<scope>`, scope = user id
  or `local`. The tree holds no bodies, so a keystroke's autosave never rewrites every note.
  Also the image API and the **ceilings** (`MAX_IMAGE_BYTES`, `MAX_NOTEBOOK_IMAGE_BYTES`), enforced
  HERE so no intake path can bypass them, and `purgePages` — the ONE place a note's bytes are
  actually destroyed (body **and** images). **Read its header for `ROWS-CANONICAL-ON-SEED`, the
  Notes edition** — which copy of a note wins is written down there, not left to accident.
- `lib/notesCloud.js` — **the cloud tier UNDER the seam (B1291), and the only file that may talk to
  Supabase.** The store's public surface did not change when sync landed; this is what grew behind
  it, reached by a cached dynamic `import()` for the same bundle reason as the image DB. Two halves:
  the PURE decisions (`mergeTrees` · `planPageSeed` · `planImageSync` · `planAdoption`) and the
  transport, which takes the client as a parameter so a test can hand it a fake. **`rev` is
  server-owned** — a `notes_touch_rev` trigger bumps it, so a push sends the GUARD `.eq("rev", base)`
  and never a rev of its own; zero rows back is a CONFLICT, never a retry. Nothing hard-deletes:
  `deleted_at` = binned (body intact, so a restore works on the other machine), `purged_at` = gone.
- `db/notes_cloud_sync.sql` — the APPLIED DDL, committed as a record (production, 2026-07-31,
  migration `notes_cloud_sync_b1291`). Three own-row-RLS tables + the private `notes-images` bucket.
- `lib/notesImageDb.js` — the raw IndexedDB tier under the image store, and the local CACHE in front
  of the cloud bucket. Nothing else may import it.
- `lib/notesImageIntake.js` — a pasted/dropped file → a downscaled, re-encoded data URL. GIF and
  SVG pass through untouched (a canvas would silently flatten them).
- `lib/notesImageNode.js` — the `noteImage` schema node + the paste/drop plugin + the node view
  that draws the **visible broken-image state** when the bytes are gone.
- **SKETCH MODE — four files, and ONE rule that makes them make sense.** *The **CANVAS** owns
  everything: each **box owns its own text AND its own position**, and the arrows are an explicit
  list of `{from,to}` box references.* There is no second representation, so there is nothing to
  keep in sync and nothing to arbitrate. **Double-clicking an empty spot makes a box right there
  and puts the caret in it** (it works while you are writing somewhere else — the press takes
  focus); the toolbar's **Box** button turns words you already wrote into a box; **dragging from a
  box's dot onto another box draws an arrow** (no mode to turn on first, and an explicit ↗ Arrow
  button is the keyboard route); boxes stay draggable; and **deleting a box takes every arrow that
  named it, at either end** (TOMBSTONE-DELETES — `removeBox` is the only way a box is destroyed and
  it reports what it took). A box is a short **label** plus an optional longer **body**, both
  authored IN the box and both always drawn — screen and paper carry the same thing. And it is a
  **node in the ProseMirror schema**, not a store beside it — which is what makes it persist, sync,
  print and export with no new plumbing. If a change starts wanting a second store, that is the
  wrong branch.
  - **⛔ SUPERSEDED, and the history is kept rather than deleted:** the rule above REPLACES *"the
    OUTLINE owns content, the CANVAS owns only position"* (B1400 as first shipped, 2026-08-03;
    project doc `claude/decision-2026-08-03-notes-sketch-mode-outline-owns-content-canvas-owns-position.md`).
    That design made you type an indented outline into a textarea — an indent-and-caret **syntax**
    you had to learn before a single box appeared. The owner used it and rejected it. **The outline
    pane is gone and must not come back** (two authoring paths is the accumulation PANEL-BREVITY
    forbids). An ordering is still *derived* from the arrows for the Markdown export and the
    accessible name — derived, on demand, owned by nobody. A sketch **saved** under the old shape
    (`outline` + `positions`) still opens: `normalizeSketch` migrates it on read, arrows and all.
  - `lib/notesSketchModel.js` — PURE: the five edits (add · edit · move · connect · delete-with-
    cascade), the layout, the derived ordering, and the one-time migration off the old shape.
  - `lib/notesSketchRender.js` — the ONE drawing builder, used by `renderHTML` **and** the node
    view. **No colours at all** — class names only, so the same drawing themes on screen and
    prints black on white. PDF-PARITY by construction; the only screen/paper difference is the
    grip you drag an arrow out of, which carries no content.
  - `lib/notesSketchNode.js` — the `noteSketch` schema node + the node-view shell + the `boxSelection`
    command behind the toolbar's Box button.
  - `lib/notesSketchEditor.js` — the interactive half (double-click to create, in-box fields, drag,
    arrow drag), behind a **cached dynamic import** for the same bundle reason as `notesCloud.js`: a
    note with no sketch never downloads it. A sketch paints from the pure spec first and becomes
    interactive after.
- `lib/notesBlockKeys.js` — **Backspace at the START of a block undoes a formatting difference
  BEFORE it restructures anything** (B36051). Registered ABOVE the default keymap. The report it
  closes: a pasted, right-aligned line in the middle of an Outlook signature merged into the
  spacer paragraph above it on one keypress, so *"a whole chunk moves to the left"*. Now the
  first press clears the alignment and stops; the second does the ordinary join, by which point
  the join is visible rather than a surprise.
- `lib/notesPastePlain.js` — **paste JUST the text** (B36051), Word's "Keep Text Only". ⛔ The
  DEFAULT PASTE IS UNCHANGED — the owner asked for an *option*, so this WATCHES the paste
  (`handlePaste` returns false) rather than intercepting it. Two ways in: **Ctrl/Cmd+Shift+V**,
  and the **paste-options chip** that appears at the paste point after a paste that actually
  carried formatting (plus the same choice on the document's right-click menu). Plain means
  plain: every mark dropped, every block reduced to a paragraph, and **paragraph breaks kept**
  so a multi-line paste does not collapse into one line. Pure and unit-tested —
  `plainTextToContent` / `sliceCarriesFormatting` / `textOfNode` / `tidyPastedFragment` touch
  no DOM. **THREE MODES, Word's** (amendment 3): `source` (the default, unchanged) · `merge`
  (drops fonts, point sizes, colours, highlights and alignment; KEEPS bold, italic, underline,
  links, lists and headings) · `text` (Ctrl+Shift+V). Picking one re-transforms the just-pasted
  RANGE in place as one undo step — it never re-pastes. ⛔ **Collapsing `&nbsp;`-only spacer
  paragraphs and unwrapping single-column layout tables is STRUCTURAL SANITISATION, not
  formatting, so it happens in `transformPasted` and applies to ALL THREE modes** — that
  structure is broken input, not a style choice. And a multi-block paste with the caret in a
  list lands AFTER the list, never nested inside the item (an Outlook signature four levels
  deep inside one bullet is the report it closes).
- `lib/notesTabKey.js` — **Tab belongs to the DOCUMENT while the caret is in it** (B1392, and
  B1392 ×2 which made it true in EVERY context rather than usually — **its header carries the
  full table of what Tab does in each one; read that before touching it**, and note that the
  destructive case it closed was a selected picture or sketch being REPLACED by a tab
  character). A
  low-priority FALLBACK: the table's next-cell and the list's indent/outdent are asked first and
  still win; this catches only what they decline — a plain paragraph, an empty page, the first
  item of a list — which is where Tab used to escape into Chrome's toolbar mid-sentence. It keeps
  a deliberate keyboard-trap escape: **Escape releases the next Tab**, and the editor's accessible
  name says so.
- `lib/notesSearchHighlight.js` — search marking as ProseMirror **decorations** (never marks: it
  must not write into the document), plus stepping between matches.
- `lib/notesMarkdown.js` — PURE Markdown export (`pageToMarkdown` carries a branch out with
  **nesting as heading depth**, lossless for content; past Markdown's six levels the heading
  clamps and a trail line states where the page sits, which the exporter REPORTS) + `docToText`
  (what body search reads) +
  `imageIdsInDoc` (the one answer to "which pictures does this page need?").
- `lib/notesDocHtml.js` — document → HTML through the **editor's own** `DOMSerializer`, so the
  print sheet cannot drift from the screen (PDF-PARITY by construction, not by discipline).
- `lib/notesPrint.js` — the print/PDF sheet: pure document builder + the hidden-iframe driver.
  There is no section heading to print any more, so paper carries each page's **trail** — the
  same "where does this sit?" the rail shows by indentation (PDF-PARITY). Its
  CSS is a deliberate mirror of `NoteEditor.jsx`'s `EDITOR_CSS`; change one, change both.
- `lib/notesTime.js` — how a note's age is written, once. `null` means unknown and renders as
  nothing — a migrated page never claims a time it does not have.
- `lib/notesExtensions.js` — the ONE declaration of what a note may contain.

**Guards that will fail the build if you break them** (the `notesModule` suite under `test/`): the
eight-place workspace registration checklist · theme-token-only chrome in the three JSX surfaces ·
no dialog boxes · the editor split (nothing on the static path imports `@tiptap/*`, and the print
serializer only by dynamic import) · `indexedDB` reached only through `notesImageDb.js` · the image
ceilings living on the store · the mirrored control-radius scale still matching the shared
`controls` primitives · every schema node and mark having a case in the exporter · the delete
cascade and the bin round trip · the project a page belongs to (the Shell binds the account to
the project store; the header is handed its project; no caption describes a failed lookup as
data) · this pointer. The structural collapse itself is driven end to end against the owner's
own reported data in the headless notes harness under `ui-audit/`, §25 — migration, idempotence, the two-notebook
merge, nesting, re-parenting, drag-to-nest, the subtree delete and restore, and the
PANEL-BREVITY before/after for the whole rail.
