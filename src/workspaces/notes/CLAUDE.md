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
- **⛔ A PURGE IS A TOMBSTONED FACT, NOT AN ABSENCE (B357011, then B364016) — read this before
  touching the bin or the merge.** He emptied the bin; the cloud tree went to **rev 991** with one
  entry. A tab still on **rev 966** with unpushed edits reloaded, came back with **all 23 entries**,
  and **pushed the resurrection up as rev 992**, overwriting the good state. The cause is
  structural: the tree merge is a **UNION**, in which an addition wins and a deletion is the
  ABSENCE of an entry — and absence loses to any copy that still has one. `purgeTrashEntry` records
  the entry id and every page id it named in a tombstone ledger carried IN THE TREE, and **rule 0**
  of `mergeTrees` honours it before every other rule. Four things not to undo:
  1. **Rule 0 runs FIRST.** Rule 1 lifts a live node out when a bin entry names it, and a
     resurrected entry would do exactly that to a page somebody had since restored.
  2. **It shares rule 5's body**, so a child added under a purged parent afterwards is still
     RESCUED — B342992's defect must not arrive through the new door.
  3. **An entry is filtered by the ids it NAMES, not only its own.** Two devices deleting the same
     note mint two DIFFERENT entry ids, so purging one leaves the other still naming pages whose
     bytes are destroyed. That is the zombie state, and only the fuzz found it.
  4. **⛔ RULE 0 IS UNCONDITIONAL — it must run on BOTH paths that adopt a tree (B391072 ×3).** The
     seed MERGES when this device owes an edit and ADOPTS WHOLESALE when it does not, and rule 0
     lived only in the merge. The adopt path took the server's tree with no filter at all and
     discarded this device's ledger in the same breath, so any client holding a pre-purge tree
     could put a purged page back and every other device would adopt it. Measured: absent at tree
     rev 1061, back in the LIVE list at 1211, gone again at 1274 — a rule that heals itself
     eventually is a rule that is conditional. The adopt path is now a merge against a local side
     that is nothing but the LEDGER, so it reuses rules 0 and 5 rather than growing a second copy,
     and a filtered result is pushed back up.
  5. **AND A LIVE PAGE WHOSE BODY THE SERVER SAYS IS PURGED IS LIFTED OUT AND TOMBSTONED** — its
     children rescued — because a note that cannot be opened, restored or explained must not render.
  6. **⛔ `migrate` MUST PASS `raw.tombs` THROUGH — this is the one that shipped broken (B364016).**
     It built a fresh object and then asked *that* object for its tombstones, so the ledger was
     destroyed on every read, and every read goes through `migrate`. Rule 0 was correct and
     completely inert: purge a page, reload, and it came back **in the LIVE list** as a note with
     nothing in it, then pushed to the cloud.
  **⛔ AND THE REASON NOTHING CAUGHT THAT: the tests never went through storage.** The whole suite,
  including a 6,000-merge fuzz, worked on in-memory trees — so a purge-then-RELOAD on ONE client was
  not a case anybody had. Every case now round-trips through the real store and the fuzz reloads
  between rounds. The zombie clean-up accepts the server's `purged_at` as its ONLY evidence ("no
  body on this device" is a different claim). Guards: the repo-root `test/` suite **notesBinPurge**,
  mutation-proven in both directions.
  - **AND A DIFFERENCE THAT IS ONLY LITTER IS NOT A DISAGREEMENT (B364018).** A conflict prompt
    appeared on a note nobody had edited, because the one-time clean-up had removed ten empty blocks
    on one device and not yet on the other. `judgeConflict` discounts empty blocks — the CLEAN copy
    wins and is pushed — while a real edit, an edit made inside a block, and a block holding a
    picture all still raise one.
- **⛔ THE STORED TREE IS NEVER STALER THAN THE SCREEN (B400176) — read this before touching how the
  tree is saved.** The rail renders from React state; the cloud sync reads `localStorage`. `Notes.jsx`
  wrote the stored copy on a **400 ms debounce**, so for that window the two disagreed — and the sync
  does not merely READ that copy, it decides from it. `seed()` asks `sync.treeDirty` (only true once
  `writeTree` has run) to decide whether this device owes anything, concludes it is CLEAN inside the
  window, and **adopts the account's tree wholesale** over the top; `pushPending` pushes
  `readTreeRaw()`, so the edit is skipped rather than merely late. Reported as a renamed note leaving
  the sidebar until a reload; the same window loses a brand-new page outright (measured with a real
  keyboard: rail 3, disk 2). So **`persistTree` writes through** — the debounce delayed a LOCAL write
  while the network push was already debounced separately inside `writeTree`, so removing it costs no
  traffic, and the per-keystroke cost is measured rather than argued
  (the **measure-tree-write** harness under `ui-audit/`: 0.007 ms on his notebook, 1.167 ms on one fifty times its size,
  against a 2 ms budget). **And every tree mutator reads `treeNow()`, never the render's `tree`** —
  fourteen of sixteen closed over a stale copy. Guards: the repo-root `test/` suite **notesTreeWriteThrough** (two real
  store instances, the loss demonstrated then each op proven to survive a seed), the headless
  **verify-notes-rename-live** under `ui-audit/` (real keyboard), and a source guard in **notesModule** that
  pins the shape — a reintroduced timer looks correct to every test that waits before reading.
  - **AND THE NAME COMES FROM WHOEVER TYPED IT LAST, NOT FROM WHOEVER IS LOCAL (B342996 ×2).**
    `mergeTrees` rule 3 was an unconditional "the local title wins", justified by the merge only
    running when this device owes an edit — which says nothing about ANOTHER page's name, or about
    which name is newer. A rename therefore could not travel between two machines in either
    direction: the stale side reverted it AND pushed the old name back up. ⛔ **PLACEMENT IS
    DELIBERATELY UNCHANGED** — parent and sibling order stay on rule 4 (local wins), which the
    reachability fuzz and the project-integrity suites are built around.
  - **⛔ AND A RENAME HAS ITS OWN CLOCK, SEPARATE FROM THE EDIT CLOCK (B342996 ×3, owner decision).**
    The first fix made `renameNode` stamp `updatedAt`, because that was the only stamp a node had.
    It works for the merge and lies to the reader: `updatedAt` is what the page header renders as
    **Last edited**, so a note nobody had written a word in for months claimed it was edited today
    because somebody fixed its title. There are now THREE independent stamps, each answering exactly
    one question — `updatedAt` (the TEXT changed; rendered; moved only by `touchPage`), `renamedAt`
    (the TITLE changed) and `filedAt` (the PROJECT changed). The last two are never rendered and are
    read only to settle their own conflict. ⛔ **ABSENT IS OLDEST, NEVER NEWEST**: every node written
    before these fields existed has neither, and reading a missing stamp as "just now" would let a
    machine that has never renamed anything win every disagreement by default. With neither side
    stamped the old rule stands (local wins) and `mergeTrees` says so.
    ⛔ **AND THE DEFECT THIS FOUND, which was nowhere near the merge:** `migratePageNode` rebuilds
    every node from a NAMED FIELD LIST and every read of the tree goes through it, so the two new
    stamps were written correctly, **destroyed on the next read**, and the merge then compared two
    absent stamps, called it a tie and kept local — indistinguishable from the old behaviour, in
    total silence. **If you add a per-node field, add it to `migratePageNode` in the SAME commit.**
- **⛔ A NODE VIEW'S CLOSURE `node` IS THE NODE AS IT WAS BUILT — never read `node.attrs` in a handler
  (B400177).** `update(next)` re-styles the element and does NOT rebind `node`, so the width handle,
  which measured from `num(node.attrs.x)`, resized against the box's OLD left edge once the box had
  been dragged: a drag asking for 90 more produced 34 LESS. Live geometry (`getBoundingClientRect`)
  cannot go stale, so that is what both handles ask, and the move drag's two dead `node.attrs` reads
  were deleted rather than left as a trap. The handle also keeps its GRAB OFFSET now, like the move
  drag does — without it the right edge re-seated under the cursor on press (asked 90, got 86). ⛔ It
  was found by DRIVING the control with a real mouse after it was reported as "present but not
  behaviour-verified"; the shipping test had located it in the DOM and never used it.
- **⛔ A BOX IS A THING YOU SELECT, ONENOTE-STYLE — and nothing appears on hover (B434416/B434418).**
  The owner: *"if I click on the box, I should be able to just press delete, but it doesn't seem like
  I can ever even click on the box."* Measured, and he was exactly right: after a press the element
  carried the class `planyr-anchor` and **nothing else**. There was no such thing as a selected box,
  so Delete had nothing to act on and every affordance had to hang off the pointer being over it.
  **Press 1 SELECTS** (the caret does not enter — the box is the thing you have hold of) · **press 2
  ENTERS it** · **Escape backs out to selected** · **Escape again deselects** · arrows nudge, Delete
  removes in one undoable step, click-away clears. A press on empty page still places a new box.
  ⛔ Two traps this cost, both invisible to a confirming test: the selection ring is an attribute on
  an element the EDITOR owns, so blurring rebuilt the node view and dropped it (it is repainted on
  every transaction now); and the key rule was bound in TWO places, so one Escape ran it twice and
  left editing *and* deselected in the same keystroke.
- **⛔ A GESTURE COMMITS ITS OWN RECORD, NEVER `dom.style` (B434417) — read this before touching any
  drag here.** Resize committed `parseFloat(dom.style.width)` at pointer-up. The DOM is not the
  gesture's memory: anything that re-renders the node view between the last move and the release
  rewrites that style from the node's CURRENT attrs, after which the fallback wrote the 180px
  default. On his signed-in account a sync tick does exactly that. **Measured on his account:
  rendered 300, stored 180, 180 after a reload** — so the box went on rendering at the size he
  dragged to and the change evaporated on reload. His word for it was *"dog shit"*, and the reason
  is that it looked like it worked. The MOVE drag had the identical `dom.style.left` hazard and was
  fixed in the same pass. ⛔ **AND THE HARNESS THAT SHIPPED IT WAS GREEN AND DID READ STORAGE** — it
  passed because a signed-out sandbox has nothing that re-renders mid-gesture. The check was right
  and its CONDITIONS were unreachable; `verify-notes-box-selection` now forces that re-render on
  every run.
- **SELECT SEVERAL BOXES AND MOVE THEM TOGETHER (B421494, `lib/notesMarquee.js`).** A press on blank
  page already meant "place a box", so one gesture had to learn two meanings: the boundary is
  DISTANCE and it is decided at **mouse-UP** — deciding at mouse-down is impossible and deciding at
  first-move is worse, because a one-pixel tremor would silently change what the gesture meant.
  Proven at 0px, 1px and either side of the threshold, on both axes and diagonally. Boxes it TOUCHES
  are caught; Shift toggles; a group drag applies ONE delta clamped against the whole set's bounding
  box (clamping per box DEFORMS the arrangement); arrows nudge; Delete removes all of it as one undo
  step. ⛔ Placement now completes on mouse-UP, which flipped a row in **verify-press-drive**'s
  documented table — that harness exists so a change to what drivers may rely on is announced rather
  than discovered.
- **⛔ THE SYSTEMATIC SWEEP — the **sweep-notes** harness under `ui-audit/`; run it before believing this module is
  well.** The owner asked for it by name: *"you need to loop and debug everything about this
  module."* It ENUMERATES controls from the DOM rather than listing them (a list rots the day
  somebody adds a control), asks six GENERIC questions of everything — does it throw · does Ctrl+Z
  restore the document byte-for-byte · does redo re-apply · does a toggle toggle · does anything
  paint outside the sheet · does the stored copy agree with the screen — and NAMES what it did not
  cover. Its first run found five real defects: a delete button buried under its own box's text
  (**B421488** — visible, labelled, unclickable, and invisible to every existing check because they
  clicked through an element handle rather than a pixel), a box delete that could not be undone
  (**B421489**), a box hanging off the page with unreachable controls (**B421490**), *"Edited 2 Jul
  2025 ago"* on every note older than two months (**B421491**), and the History panel crushing the
  page to a 156px sliver (**B421492**). ⛔ **A SWEEP THAT REPORTS NOTHING IS A FAILED SWEEP** and it
  says so in its own output.
- **A BOX CAN BE DELETED AND RESIZED, AND A PRESS THAT DOES NOT MOVE WRITES NOTHING (B391073).** A
  box had a grab handle and no way to remove it and no way to change its width; both are now on the
  box, both revealed by SELECTING it (B434418 moved them off hover), and neither reaches paper. ⛔ **Only the
  WIDTH is settable** — a box's height is its words, and a fixed height can only be honoured by
  clipping them. ⛔ **A press with no movement commits nothing at all** — not a transaction, not an
  undo frame — and the drag keeps its grab offset and re-reads the editor's box on every move, so a
  page scrolling underneath the gesture cannot move the box. Both were removed as candidate causes
  of a reported click-jump that could NOT be reproduced with a real mouse (25/25 across three window
  sizes); the item is instrumented rather than closed.
- **A TITLE MAY BE BLANK WHILE YOU TYPE AND MAY NEVER SETTLE BLANK (B391074).** `renameNode` used to
  coerce a blank name to the default, and the title field is a CONTROLLED input that writes on every
  keystroke — so backspacing a name to nothing wrote the default straight back and you could not
  clear the field. The default now lands on COMMIT (`commitTitle`, when the field is left) and the
  rail shows a dimmed placeholder (`displayTitle`) that is never written back.
- **A SKETCH NEVER GOES INSIDE AN ANCHORED BOX (B391075).** Measured: inside one it gets 156 px, and
  its own three buttons are ~190 px of content, so they spilled outside the panel — the "labels
  overlap their own buttons" report — with the drawing's words squeezed to one character a line. A
  box's width is a choice about a column of TEXT. `boxSelection` places the sketch after the box, and
  the panel additionally cannot overflow whatever container it is in.
- **⛔ "SINGLE" WAS 1.65, SO THE CONTROL LOOKED INERT (B532640/B532641, owner report 2026-08-14).**
  He asked *"is this a line spacing issue?"* and he was right twice over. **(a)** Measured: 15px
  text in a **24.75px** line box — a ratio of **1.65**, where Word and OneNote call ~**1.15**
  single. The loosest setting in the control's own list was also its DEFAULT, so picking "Single"
  changed nothing. The scale is rebased (`Default · Single=1.15 · 1.15→1.3 · 1.5 · Double`) and
  every named value above Single is asserted looser than it. Rows went **24.75 → 17.25px**, about
  30% less vertical space per line. ⛔ **Existing notes REFLOW tighter, deliberately, and he was
  told** — the alternative (stamping 1.65 onto every old paragraph to freeze them) writes a
  setting nobody chose into thousands of blocks. **(b) ⛔ AND THE CSS LOOKED CORRECT THE WHOLE
  TIME, which is why reading it never found this:** the stylesheet already used a proportional
  multiplier, but the size a person picks lands on an **inline span** while the **block** stays at
  the default — and a block's line box can never be shorter than its own font's **strut**. So a
  paragraph whose every word was 11px still rendered at 24.75px. **Bigger text grew the row; smaller
  text could not shrink it.** The block now carries its own size when its runs all agree
  (`blockFontSize`, applied by `deriveBlockSizes` as an **appendTransaction** so it holds for every
  document, not only for text typed today). Measured after: 11px paragraph → **12.64px** row, where
  proportional is 12.65; mixed sizes on one line still take the **tallest run**. Instrument:
  **measure-notes-spacing** under `ui-audit/`, which reports RENDERED ROW HEIGHTS — the owner's
  instruction was *"verify with a measurement, not by eye."* ⛔ The number lives ONCE, as `SINGLE`;
  the print sheet **interpolates the literal** because paper has no theme and the round-two suite
  rightly forbids a CSS custom property in it. **⛔ AND NO BACKTICKS IN A COMMENT INSIDE
  `PRINT_CSS`** — it is a template literal, one backtick ends the string and the module stops
  parsing. Sixth time in this repo.
- **⛔ AND ONE ACTION FOR A WHOLE NOTE: COMFORTABLE / COMPACT (B532642).** His goal was *"save
  space and see more information on screen"*, which a per-paragraph control makes him do a line at
  a time. ⛔ **THE DENSITY LIVES ON THE DOCUMENT, NOT ON THE TREE**, through ProseMirror's own
  `setDocAttribute` — so it is saved, synced, printed and exported for free, exactly as this
  module's stated principle promises, and it touches NO tree code. That is the whole reason it was
  safe: it was first deferred on the ground that it needed a per-note field (tree schema,
  `migratePageNode`, the cloud merge — the very thing that caused B342996 ×3 the same day), and
  that reasoning turned out to be wrong about the mechanism. **A blocker that dissolves when you
  check it was never a blocker.** Measured end to end: a row 17.25 → 15.30px, still 15.30 after a
  reload, and the printed sheet carries it with no CSS custom property.
- `lib/notesSpacing.js` — **HOW FAR APART THE LINES ARE (B391076).** A BLOCK property on paragraph
  and heading, never a text style: half a line cannot be one-and-a-half spaced. Written into the
  markup by one attribute (three that each wrote `style` would overwrite one another), so it saves,
  syncs and prints with no second stylesheet. ⛔ The control is **one glyph wide** because the
  formatting row is full at a laptop width and a normal-width select re-broke the no-wrap guard —
  PANEL-BREVITY, paid for rather than added.
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
  - **⛔ AND THE SIXTH ROUND COLLAPSED THE TWO GESTURES INTO ONE (B357008/B357009), because the
    "intermittency" had a mechanical explanation and it was ONE bug, not two.** *(a)* A
    double-click committed an **empty** block the instant it was pressed — five presses with
    nothing typed produced five nodes in storage, all surviving a reload. *(b)* An empty block
    draws nothing and **still occupies its box and still takes the press**, so the second attempt
    at a spot you already tried lands inside the first attempt's invisible leftover and appears
    to do nothing. That is the whole of *"it works intermittently"*: it fails exactly where you
    already tried once and gave up. *(c)* A single click in open page sent the caret to the
    nearest text position, which on a mostly-empty page is a LONG JUMP — *"it goes still goes all
    the way to the left."*
    **So: an empty block is PROVISIONAL** (`lib/notesAnchorPrune.js` — the editor drops one when
    the caret leaves, on blur and on Escape; `writePage` prunes it so a crash or a closed tab
    cannot carry one out either), **it is VISIBLY outlined while it exists**, and **a press in
    blank space places the caret where you pressed** — with the nearest-text-position path kept
    only for a press genuinely beside a line, measured against where that position actually is.
    **There is no separate double-click handler any more**, and that removal is the point: one
    gesture, one rule, no invisible document state choosing between them. Guards: the repo-root
    `test/` suite **notesAnchorPrune** and the soak harness **verify-notes-anchor-soak** (three
    window sizes including his ~520-tall one; presses that type nothing must leave the stored
    document BYTE-IDENTICAL).
  - **⛔ AND DRIVE IT WITH A REAL MOUSE — A SYNTHETIC CLICK REACHES NOTHING HERE (B364017).** The
    placement is on `mousedown`, and a synthetic `click`/`dblclick` produces no `mousedown` at
    all, so it does nothing while the right element is under the cursor and the editor is
    focused. That cost a false *"the gesture has regressed to nothing"* report on a build where
    the real mouse worked 32 times out of 32. This is **SYNTHETIC-KEYS-DONT-EDIT on the mouse**:
    use the press driver **pressFeature** under `ui-audit/lib/`, and **verify-press-drive** re-measures the whole verdict
    table every run, so the day the wiring moves again it says so rather than a harness reporting
    a working feature as broken.
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
- **⛔ WHY TAB "SOMETIMES DOESN'T WORK", ANSWERED WITH A MEASUREMENT (B454480).** The report was one
  word — *"sometimes"* — so it was INSTRUMENTED rather than guessed at: **audit-notes-tab** under
  `ui-audit/` drives a real Tab in fourteen contexts on a fixture shaped like his own note (a
  bulleted list with a nested sub-list and an autolinked email in it), captures the caret's node
  chain and depth at the moment of the press, and judges by the STORED document. **Tab is right in
  every context but one, and that one was structural: a bullet tucks under the bullet ABOVE it, and
  the first bullet has none.** All three failing rows were that same fact — the first top-level
  bullet, the first bullet of the nested list, and a range whose start is a first item. ⛔ The
  instrument itself needed correcting
  twice before it could be believed: it could not tell *"did nothing"* from *"moved the caret"* (so
  it called Tab-between-table-cells a defect), and its node column read `p` for all twenty-eight
  rows because `closest` with a selector list returns the NEAREST match. The measured table is
  pinned, so any change to Tab announces itself.
- **⛔ TYPING AND FORMATTING, ATTACKED (B454481) — and what it actually found.** **audit-notes-formatting**
  under `ui-audit/` applies · removes · re-applies · undoes every mark, block conversion, alignment,
  list type, link and spacing setting, at a caret AND across a selection, **judged on the STORED
  document** — plus his hardest ask, twenty mixed operations undone back to a byte-identical
  document. **Sixty checks, and nothing wrong with the app.** ⛔ What it did find is SIX defects in
  ITSELF, every one of which produced a confident false report: a fixture that put marks on the
  paragraph instead of the text node (20 findings), reads that raced the 600 ms save debounce (16
  findings — the wait now lives INSIDE the reader so a caller cannot skip it), a baseline compared
  against hand-authored seed bytes rather than the editor's own serialisation (11), a spacing option
  that was the DEFAULT (3), a colour swatch that was "Default", i.e. REMOVE (2), and a fingerprint
  that recorded `level` and `textAlign` but not `lineHeight`, so it was blind to the property it was
  judging (3). ⛔ **A fingerprint blind to the property under test is worse than no fingerprint** —
  it returns a confident wrong answer. Read that file's header before adding a case to it.
- **⛔ AND WHAT TAB DOES ON A FIRST ITEM, SETTLED (NEW-TAB, owner decision 2026-08-13): TAB CHANGES
  THE LEVEL OF THE CURRENT ITEM; IT NEVER CREATES A NODE THE USER DID NOT TYPE.** The three
  `nothing` rows above are now an indent. Where real nesting can happen it still does, unchanged;
  where it cannot, the item's own `indent` attribute goes up by one — same nodes, same order, same
  parents, one number different. **The option that was refused, so it is not re-proposed:** mint an
  empty parent bullet and sink into it. It gets the picture right and puts a bullet with no words
  in it into the document, which then has to be exported, printed, counted, outlined, searched and
  deleted by hand — the litter this module has spent six rounds removing. Shift+Tab is `n − 1`, and
  at `n === 0` the attribute renders NOTHING, so an indent/outdent pair leaves the stored document
  **byte-identical** (asserted, on the bytes, in both halves of the guard). Markdown carries the
  level as indentation, which is how Markdown spells nesting, so the export is not lossy.
  See `lib/notesListIndent.js` (the rule) and `lib/notesIndentLevel.js` (the pure reader, split out
  because the Markdown exporter is on the static path and may not pull the engine).
- `lib/notesListIndent.js` — the `indent` attribute on `listItem`/`taskItem` and the two keys that
  move it. **Registered ABOVE the list keymap** (priority 200) and declines whenever
  `can().sinkListItem(...)` says real nesting is possible — that `can()` IS the boundary between the
  two mechanisms. Above rather than below because an item sitting at level 2 by attribute is, to
  ProseMirror, an ordinary first item, so `liftListItem` would lift it clean out of its list while
  it still owed two outdents.
- `lib/notesIndentLevel.js` — the pure half: `readIndent`, the ceiling, and the markup
  (`margin-left` **on the item**, so the bullet moves with its words). Renders nothing at level 0,
  which is the clause the byte-identical round-trip rests on.
- **⛔ AND ONE KEYPRESS BELONGS TO THE CARET WHENEVER THERE IS ONE (B519681, `lib/notesKeyScope.js`).**
  The owner: *"the direction keys on my keyboard arent working."* His prior was right in shape and
  one level off in detail. The box-nudge binding (B421494) is on the `window`, armed only while a
  box selection exists, and it declined for `input, textarea, select` — **the document is a
  contenteditable DIV, which is none of those**, and was excluded deliberately on the argument that
  clicking into the document clears the box selection on the way. **Measured: it does not.** With a
  box selected and the caret then in ordinary flow text, every arrow moved the BOX and left the
  caret alone — reachable in three clicks, and invisible once you have looked away from the selected
  box, which is the whole profile of an intermittent input bug. ⛔ **The guard is the PROPERTY, not a
  key list** (his instruction, after the second leak): every global `keydown` binding in this module
  must ask `keysBelongToTheCaret()`, asserted by a SOURCE SWEEP in the repo-root `test/` suite
  **notesKeyScope**, so the next binding somebody adds is covered by construction. Exemptions are
  named individually with a reason and are checked to still exist. The behavioural half is
  **audit-notes-arrows** under `ui-audit/` — 7 contexts × 14 keys, real keystrokes, four independent
  observations per press (caret · box · document · scroll) plus `defaultPrevented` read off the real
  event. ⛔ The marquee case the window binding exists for is UNAFFECTED and that is measured, not
  assumed: the press that starts a band is `preventDefault`ed, so focus is on `<body>` and there is
  no caret to own the key.
- **⛔ AND AN ANCESTOR IS NOT A SELECTION (B519680) — a REGRESSION IN B512672, reported by the owner
  with a screenshot an hour after it merged.** *"I'm trying to press shift tab to promote MUD
  ATTORNEY … but it takes Dustin O'Neal, the phone number, and the email with it."* Those three are
  not its descendants, they are its **nephews** — which is the tell, because only an ANCESTOR moving
  can drag a branch that sits beside the pressed line. Cause: `itemsInSelection` asked
  `doc.nodesBetween(from, to)` for every `listItem`, and **`nodesBetween` visits every node whose
  range CONTAINS the position**, so a collapsed caret in a level-three bullet returned that bullet
  AND its parent AND its grandparent. Measured before any fix: Tab on one line produced
  `Active [indent=1]` **and `MUD 377 [indent=1]`**. The rule now: **an item moves when the selection
  is inside ITS OWN text, not merely somewhere beneath it** — collect TEXTBLOCKS and map each to its
  NEAREST indentable ancestor. **Structure only, never geometry** (he asked for that explicitly,
  having noticed the odd line out carries a smaller font). ⛔ **The coverage hole is the more useful
  finding:** all 17 cases passed before AND after the fix, because every one used a FLAT list where
  an item has no indentable ancestor — depth was the variable that mattered and nothing had any.
  Fixture and diff harness: **diagnose-notes-outdent** under `ui-audit/`.
- `lib/notesKeyScope.js` — the one predicate above, plus the measured two states it separates.
  ⛔ **AND `UNGATED_KEYS` — ESCAPE IS NEVER GATED (B539653), which is a rule rather than a hole.**
  The gate exists so a binding cannot steal a key the person typing NEEDS; a caret has no use for
  Escape. Gating it broke the two-stage box gesture: Escape #1 backs out of editing, Escape #2
  deselects — and **after #1 the editor still HOLDS FOCUS** (measured at every step:
  `activeElement` is the ProseMirror div, `isContentEditable` true), so #2 was declined forever
  and a box could not be deselected from the keyboard. ⛔ The FIRST attempt assumed the blur had
  landed and only required focus inside the selection's own host; it changed nothing, because
  focus never left. **Reasoning about the state twice cost two builds; probing it took one.** It
  does not reopen B434418's "handled twice" — the mat's Escape was deleted then, so there is still
  exactly one handler.
- **⛔ RIGHT-CLICK IS WORD'S MENU, AND NOTHING DESTRUCTIVE SITS UNDER THE POINTER (B539651).** *"the
  delete option shouldn't just be shown, like, anytime I click on the box… I should only be able to
  use the keystroke to delete or a right click and then delete option. And then the right click
  should have the normal formatting option, like it's a Word document or an email… Just copy
  Word."* The delete × is **gone from the box**; selecting one shows the ring and the resize handle
  and nothing else. Delete/Backspace still removes it, and `Delete this box` is last and separated
  on the box's right-click menu. **The items are a TABLE, not markup**, which is what lets the
  document menu and the box menu be one component — a box's menu is the document's PLUS its own
  action, because right-clicking a box is still right-clicking inside text. ⛔ Every row cancels
  `mousedown` or the command acts on a selection the menu already stole, and that failure is
  SILENT. ⛔ Cut/copy go through the browser's own editing command deliberately: the async
  Clipboard API needs a permission a menu click cannot ask for, and a refusal there is a silent
  no-op — `execCommand` reports, so a refusal names the shortcut that always works. Harness:
  **verify-notes-context-menu**, 26 checks, real right-clicks, judged on the stored document.
- **⛔ AND A HANDLE THAT DID NOT DRAG IS TRANSPARENT (B539652)** — CHROME-NEVER-EATS-A-PRESS clause
  4 in its purest form. The resize handle only EXISTS once the box is selected, so press 1 of the
  two-stage gesture summons it and press 2, at the same point, lands on chrome that was not there
  when the gesture began: type into box A, then B, then A again, and the markers come back in the
  wrong boxes. **The fix is at the RESOLVER (clause 5)**: a press on the handle that did not drag
  forwards to the box and puts the caret where it landed. A press that DID drag is a resize and is
  untouched. It was PRE-EXISTING and proven so — the same check failed identically with the day's
  other changes stashed out — and closing it took `verify-notes-anchor-zoom` to **40/40** for the
  first time.
- **⛔ THE RIGHT EDGE GROWS THE PAGE; IT DOES NOT CRUSH THE BOX (B539648).** He photographed a box
  rendering *"literally one character wide"* against the right margin, and **named the cause as an
  instruction of his own**: when the block used to JUMP LEFT he asked for *"if it will not fit,
  NARROW the block to the space available."* Right about not sliding, **wrong about narrowing with
  no floor** — `ANCHOR_MIN_WIDTH` was 32 px, about two characters, so a press near the margin left
  a few pixels and the box became them. The floor is **160 px** now (≈20 characters, close to the
  180 default), and past it **the page grows sideways and scrolls** — `anchorExtentX`, the
  horizontal twin of `anchorExtent`, whose ABSENCE was the bug: vertically the sheet had always
  stretched to hold a block past the bottom, horizontally there was no equivalent, so the only way
  to keep a block on the sheet was to squeeze it. The resize drag is no longer capped at the page
  edge either. ⛔ **His original acceptance test is untouched and still passes** — the LEFT EDGE is
  never moved; raising the floor spends the PAGE's width, never the block's position. ⛔ **And the
  room is measured from the SCROLLER, never from the editor's own width** — reading `dom.clientWidth`
  makes a real feedback loop (fit narrows → extent widens → the wider element becomes "the room"),
  and it SETTLED on a stable wrong number rather than oscillating, which is worse because it looks
  correct. Instrument: **measure-notes-right-edge** under `ui-audit/`, running his own sweep.
- `lib/notesSaveState.js` — **ONE SAVE INDICATOR, WHERE EVERY OTHER MODULE PUTS IT (B539649).** He
  photographed two: a `SAVED` pill in the note header and a sync line in a footer under the rail,
  while the app-wide `CloudSyncBadge` said the same thing in `AppHeader` Row-1. *"Literally, all the
  modules should show that save icon in the exact same place."* The Site Planner, the Scheduler and
  Doc Review had all retired their local chips for that badge; **Notes was the one module that never
  did.** Both local surfaces are gone and this normaliser feeds the shared badge, in the same shape
  as doc-review's `docSaveState`. ⛔ **LOUD-FAILURE survives the footer's removal** — the storage
  line still decides the wording once, in `notesStorageLine`, and now rides the badge's `saveDetail`
  instead of being painted twice. Measured: Notes and the Site Planner render it at the identical
  position. **Library feeds nothing and that is right** — a file browser has no document to save.
- `lib/notesTabKey.js` — **Tab belongs to the DOCUMENT while the caret is in it** (B1392, and
  B1392 ×2 which made it true in EVERY context rather than usually — **its header carries the
  full table of what Tab does in each one; read that before touching it**, and note that the
  destructive case it closed was a selected picture or sketch being REPLACED by a tab
  character). A
  low-priority FALLBACK: the indent extension, the table's next-cell and the list's
  indent/outdent are all asked first and still win; this catches only what they decline — a plain
  paragraph, an empty page — which is where Tab used to escape into Chrome's toolbar mid-sentence. It keeps
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
