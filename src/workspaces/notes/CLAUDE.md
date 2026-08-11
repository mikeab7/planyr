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
- `components/IntegrityBanner.jsx` — the bar for the two findings nothing could previously mention (a note in two projects; a note that had lost its place). **Its own lazy chunk** — it renders only when something is actually wrong, so its bytes have no business on the rail's first paint.
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
- **⛔ NOTHING MAY EXIST WITHOUT A HOME — the reachability guarantee, and the two merge holes
  that broke it (B342992).** A real note went unreachable in the owner's account: 215 revisions
  of Bain meeting notes, healthy in storage AND in the cloud, with **no node in either tree and
  nothing in the bin naming it.** Not destroyed — unreachable, which is worse, because nothing
  could say so. Root cause was **`mergeTrees`, twice**, and neither hole is visible in a
  hand-read (both were found by a randomised sweep):
  1. **A DELETE TOOK MORE THAN IT NAMED.** The merge lifted out every id in a bin entry and
     returned BEFORE recursing — so a page the *other* device had added under the deleted
     parent was neither kept live nor carried into the bin. **Rule 5** now says a delete's scope
     is exactly the ids its entry names; anything else is RESCUED to the top level of its
     branch's project and reported through `onRescue`.
  2. **THE OTHER SIDE'S COPY WAS LOOKED UP BY POSITION.** Re-parenting a page on one device made
     the merge blind to that page's copy on the other, and every child it had gained there went
     with it — **no bin involved at all**. Counterparts are now found by **id, anywhere in the
     tree**.
  Belt to those braces: `sweepOrphans` refuses to destroy a body that still has words in it,
  `unreachableNotes` looks for the property being violated on every load, and `adoptUnreachable`
  heals it — **guessing nothing**, which is why there is deliberately **no title-keyed
  "Recovered" container** (see the next bullet). Guards: the repo-root `test/` suite
  **notesReachability** (minimal cases + a 6,000-merge property across five seeds) and the
  headless **verify-notes-project-integrity**. Recovery lives in `lib/notesScan.js` + `adoptUnreachable` (`lib/notesModel.js`).
- **⛔ AND A TITLE IS NEVER LOAD-BEARING FOR IDENTITY OR REACHABILITY.** Asked directly — *is the
  note unreachable BECAUSE it has no title?* — and the answer is **no**, proven across five falsy
  values and eleven paths. The reason every node in his live tree carries a title is not a filter
  eating the empty ones: **no path can mint one**, and since B342992 that is true at the one
  constructor (`makePage`) rather than at each caller, which is what let `"   "` through. Nothing
  here may key, index, dedupe or drop on a title. Identity is the id.
- **A BLOCK THAT STAYS WHERE YOU PUT IT (B342993, `lib/notesAnchorNode.js`).** Double-click blank
  space and a **real positioned node** lands at the point pressed — its position is two numbers on
  the node, so it cannot crawl as you type, cannot leak alignment onto the next paragraph, leaves
  no padding paragraphs, and rides the document into storage, sync and the PDF. **Read that file's
  header before touching it**: this is the FOURTH round, and the previous check passed on the wrong
  property. It inserts **before the document's last block**, deliberately — appending leaves a
  blank line ProseMirror restores and cannot be deleted away. Proof is geometric, in
  **verify-notes-anchor-zoom**: the rendered rect against the clicked coordinates.
  - **⛔ AND THE FIFTH ROUND (B350000/B350001) KILLED THREE MORE WAYS IT MOVED, all of them
    measured on the owner's own window rather than argued.** (a) **NO CLAMPING BAND.** Everything
    right of about the three-quarter mark was pushed flush to the right margin — a click at
    x=1010 and a click at x=900 both produced a block at x=884, a silent slide of up to 126 px,
    and the clamped number was WRITTEN TO STORAGE. The left edge is the thing he chose, so it is
    kept unconditionally and the WIDTH is spent instead (`placeAnchor`). There was a second floor
    hiding under the first: a `min-width: 120px` in the stylesheet, which quietly undid the
    narrowing — a placement rule and a stylesheet floor cannot both own the width. (b) **NO
    VERTICAL NUDGE:** a click at y=470 landed at 461; there is now no vertical clamp at all and
    the page grows to hold the block (`anchorExtent`). (c) **THE GESTURE USED TO MOVE THE EDGE IT
    THEN MEASURED AGAINST** — the first press of a double-click below the last line adds a line
    (that is what clicking under text means everywhere else), which pushed the content's bottom
    edge down, so the double-click decided it was on content and declined: no block, and the
    added line left behind. The question is now asked against the document as the person FOUND
    it (`matBottomRef`). His own acceptance test is the guard: a 20 px sweep across the full
    width, asserting stored left equals click x minus editor left at every step, with the same
    exactness demanded vertically and the result read back out of storage.
  - **AND A PRESS INSIDE A BLOCK IS CONTENT (B350004).** His original complaint — *"it keeps
    wanting to just go to wherever there is text on the left"* — was still live and was NOT the
    same bug: the mat's "is this blank space?" test measures the last FLOW child, and an anchored
    block is out of flow, so every block below the text was, to the mat, empty page. It swallowed
    the press and sent the caret to the end of the document. Verified as a REAL failure with a
    real mouse in a foreground tab before it was touched, and re-verified after.
- **HOW BIG THE WRITING IS (B342994, `lib/notesZoom.js`).** Ctrl+wheel and Ctrl+=/−/0 scale the
  **document**, never the app; the browser's own zoom is suppressed for those gestures so the two
  cannot fight; the level is per-scope, persisted, and does not sync (a comfortable size belongs to
  the screen you are at). CSS `zoom`, not a transform — the text must RE-WRAP and the caret must
  stay the browser's own.
- **A COPY NEVER CHANGES PROJECT — four files, one rule.** A note was copied into an unrelated
  pursuit and nobody was told; it was found by hand a week later under a "from a project you
  deleted" heading. **A page's `projectId` is a property of the PAGE, never of whoever happens to
  be looking at it.** So `copyPageWithin` (`lib/notesModel.js`) is the ONE copy op and **takes no
  project argument at all** — the copy lands as the source's next sibling wearing the source
  root's project, or it is REFUSED and named. There is deliberately no way to say "put the copy
  over there", because a caller that could would eventually pass the project it happens to be
  showing. The conflict park in `Notes.jsx` goes through it and **says so on screen at the moment
  it happens**. Guards: the repo-root `test/` suites **notesProjectIntegrity** (the decisions) and
  **notesTwoClientConflict** (two real store instances against an in-memory server that owns `rev`
  like the deployed trigger — the resulting store, the exact page count AND every page's project),
  plus the headless harness **verify-notes-project-integrity** under `ui-audit/`. All three are
  mutation-proven: reverting the copy op to take a viewer's project turns 9 rows red with the exact
  reported fingerprint.
  - `lib/notesDuplicates.js` — PURE detector: word-pair Dice similarity over normalised text.
    ⛔ Same project is never a finding (copying inside a project is ordinary), an empty page is
    never a finding, and **the BIN counts** — both real copies were binned before anyone looked.
  - `lib/notesScan.js` — the storage half, **lazily imported** (nothing on the rail's first paint
    needs it): `scanNoteDuplicates` and `unreachableNotes`. The second answers a defect found in
    the owner's own account — a body whose tree node had gone, swept off the device on every load
    and re-downloaded on every sync, reachable from nowhere. `sweepOrphans` now **refuses to
    destroy a body that still has words in it** and reports what it kept.
    - **⛔ A FINDING IS ONLY REPORTED IF SOMEBODY CAN ACT ON IT (B350003).** The bar told him
      *"One note appears in 2 different projects… “Coordination” in Grand Port · “Page 1” in a
      project that no longer exists (in the bin)"* — one copy already binned, the other's project
      deleted a week earlier. **Nothing to do, and Dismiss the only exit**, which is how you teach
      somebody to dismiss the one that will one day be real. So `scanNoteDuplicates` no longer
      walks the bin and drops copies in projects that are gone; the PURE detector
      (`notesDuplicates.js`) is unchanged and still compares whatever it is handed, because a
      deliberate forensic pass over everything is a different question from a banner. A finding
      can also now be ENDED from the bar — keep this one, or keep both and stop being told
      (`duplicateKey`, remembered per account). ⛔ An unknown project list passes `null`, never
      `[]`: "the lookup failed" and "there are no projects" are opposite facts, and letting the
      first wear the second's clothes would silently suppress a real finding.
  - **THE BIN YOU CAN JUDGE (B350002, `collectBinFacts` in `lib/notesStore.js`).** Twenty-one
    entries, sixteen of them called "Untitled page", showing a name and a countdown and nothing
    else — so the only way to find out what one WAS, was to restore it into the live tree and
    delete it again. Each row now carries the WORDS (borrowed from the first page in the cascade
    that has any), the project it came from, when it went and how big it is; **"Read it" opens it
    read-only without restoring it**; and one action clears the empty ones. ⛔ **The row and the
    reader are ONE walk** (B357012): DEV COORDINATION is a container with no row in `notes_pages`
    at all, its words live in its child, and the list read the child while the reader opened the
    parent — so the row said "656 characters" and Read it showed a bare heading. `collectBinFacts`
    now builds the preview, the count and the reader's page list from the same reads, and the
    reader renders every page in the entry that has words. ⛔ Four project
    states, not two: a live project · "Not in a project" · one that no longer exists · and an
    entry binned before the bin recorded where a page came from, which says so rather than
    claiming the note belonged nowhere.
  - `lib/notesProjectFiling.js` + `lib/notesProjectLink.js` + `lib/notesKeys.js` — "what is this
    project holding?", answerable from a route where Notes is **not mounted**, because the thing
    that deletes a project is the shared header breadcrumb. The account is passed in EXPLICITLY
    (reading whatever scope happened to be set would answer with the signed-out tree). ⛔ All three
    are **leaves**, and that is measured, not stylistic: routing that dynamic import through
    `notesStore.js` cost the Notes route 12 KB and through `notesModel.js` 9 KB.
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
- `lib/notesBlockKeys.js` — **Backspace at the START of a block takes ONE predictable step, at
  EVERY block boundary** (B36051, then B291536 which made it true everywhere rather than in one
  place — **its header carries the full table of what the key does at each boundary; read that
  before touching it**). The first report: a pasted, right-aligned line in the middle of an
  Outlook signature merged into the spacer paragraph above it on one keypress, so *"a whole
  chunk moves to the left"*. The recurrence — *"the backspace still acts funny in certain
  spots"* — was LISTS, where one press un-nested an item AND merged it, or merged upward, left
  an empty orphan bullet and re-levelled a child. And the boundary nobody had looked at was
  worse than either: one press at the start of a paragraph following a **picture deleted the
  picture**. So it is a table now, not a special case: `blockStartAction` is PURE and decides
  which single step applies (unit-tested by the repo-root `test/` suite **notesBlockKeys**), and it claims the
  key at a priority ABOVE Tiptap's `ListKeymap` — whose Backspace runs once per list type over a
  `forEach` that does not stop at the first one to act, and which dissolved BOTH levels of a
  mixed checklist/bullet list in one press. Driven end to end by the
  headless harness **verify-notes-backspace** under `ui-audit/`, which asserts the resulting document TREE for every
  boundary and is mutation-proven.
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

**TIER 1 — the table stakes (NEW-1…NEW-7).** Seven features the category treats as given, all
landed together. What each one is, and the ONE decision inside it that is not obvious:
- `lib/notesSlashMenu.js` + `components/NoteSlashMenu.jsx` — **type `/` and name the block**
  (NEW-1). ⛔ The whole feature is a rule about when NOT to fire: the `/` must be at the start of
  the block or after whitespace, and what follows must have no spaces and stay short — which is
  what makes `and/or`, `w/o`, `24/7` and every pasted URL inert. It is a **reading of the
  document**, recomputed per transaction, so backspacing past the `/` simply stops matching and
  leaves the character the user typed exactly where it was; there is no marker node to clean up.
  ↑↓/Enter/Esc are claimed above the default keymap.
- `lib/notesQuickOpen.js` + `components/QuickOpen.jsx` — **Ctrl/⌘+K jumps to a note by name**
  (NEW-2). AUDIT-FIRST: **Ctrl+K was unbound** in this repo — the toolbar's link control is a
  button opening an inline field, with no shortcut — so nothing was displaced. FUZZY over titles
  (a subsequence, so `gpent` reaches Grand Port › Entitlements), falling **through to the existing
  full-text index** for body hits; nothing is re-indexed. Title hits always precede body hits. The
  shortcut is printed in the rail's search placeholder, because a keyboard affordance nobody can
  discover is one that does not exist. Lazy-loaded — it costs a note nothing until pressed.
- `lib/notesVersions.js` + `components/NoteHistory.jsx` — **version history with restore**
  (NEW-3). The bin protects a note somebody DELETED; this protects one somebody MANGLED.
  ⛔ **Restoring CREATES a version and destroys nothing** — the state being left is snapshotted
  and pinned first, so restoring the wrong one is itself undoable (`planRestore`, pure).
  Retention is denser-recent / coarser-older and the NEWEST row is pinned unconditionally.
  ⛔ Snapshots live in **IndexedDB, never localStorage** (TIER-BY-REBUILDABILITY), and are
  **device-local in this version** — a stated limit, not an oversight; it needs no schema change
  and cannot fight the server-owned `rev`.
- `lib/notesTasks.js` — **every unticked checklist line, across every note** (NEW-4), shown in the
  rail's third view. ⛔ Ticking one goes **through the open editor** when that note is on screen
  (`registerOpenNoteDoc` on the store) — writing its JSON round the back of the editor is a
  silent-loss bug by construction. The key is index **and** text, and the index is trusted only
  while it still describes the row the rollup showed.
- `lib/notesAttachNode.js` + `lib/notesFileMeta.js` — **any file, not just pictures** (NEW-5).
  ⛔ It rides the PICTURE tier — same IndexedDB store, same cloud table, same bucket, same purge
  cascade — rather than a second blob tier. The account-side change is one migration,
  `db/notes_attachments.sql`. `assetIdsInDoc` (not `imageIdsInDoc`) is what every delete path must
  ask, or a deleted page leaves its files behind forever. It survives Markdown (embedded under a
  size cap, NAMED above it) and Print (name · type · size).
- `lib/notesOutline.js` + `components/NoteOutline.jsx` — **the note's headings, as navigation**
  (NEW-6). PURE over the document; its `pos` values restate ProseMirror's own size rule and the
  unit test resolves every one against the real schema. **Absent, not empty**, when there are no
  headings. It sits to the RIGHT of a left-aligned sheet, so showing it cannot shift the text.
- `lib/notesCalloutNode.js` + `lib/notesToggleNode.js` — **callouts and foldable sections**
  (NEW-7). A callout stores a TONE NAME, never a colour, so screen / paper / Markdown each draw
  it their own way — and the five tones are GitHub's five, so the export is `> [!NOTE]` rather
  than an HTML approximation. A toggle is the browser's own `<details>`; the document owns the
  fold as an attribute, and ⛔ **`docToHtml` opens every one before serialising**, so a folded
  section can never print as missing text.
- `db/notes_attachments.sql` — the migration NEW-5 needs: relax the `notes-images` bucket's
  image-only MIME list and add `name` + `kind` to `notes_images`. Same "committed as a record"
  discipline as `notes_cloud_sync.sql`.

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
