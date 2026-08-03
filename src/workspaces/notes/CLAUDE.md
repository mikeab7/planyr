# Notes workspace — folder pointer

A OneNote-shaped note-taking module: **notebook › section › page** in a left rail, a rich-text
**document** page beside it. Internal id `notes`, route `#/notes`, magenta-plum accent
`--accent-notes`. Notebooks bind to a **project** (or stay **loose** and are visible from inside
every project). Root rules in `/CLAUDE.md`.

**The decision everything else follows from:** the **document model** (ProseMirror JSON) is what
persists — never Markdown. Markdown cannot express a merged table cell, a text colour, a font
size, a highlight or a checked task, so storing it would cap the editor at what Markdown can
spell. Markdown is an **export**, and an honest one: `docToMarkdown` returns the list of
constructs that needed an HTML fallback so the UI can name them.

**The second decision, and it is just as load-bearing:** a page's **pictures are not in the
document**. Notes live in localStorage, which is a few megabytes for the whole origin — base64
would let *two phone photos* exhaust it and break every save in every notebook after that. So the
document holds an image **ID** and the bytes live in **IndexedDB**, behind the same one storage
seam. Do not "simplify" an image back into the document model.

**A notebook BELONGS to a project — and nothing can become unreachable (B1374).** Created inside a
project it binds to it with no extra step; created from the Dashboard it is **loose**, and a loose
notebook shows up **everywhere**, inside every project included. Entering a project lands you in that
project's notebooks (the scope is never sticky), and **one click widens to every notebook you have** —
that click is what makes "unreachable" impossible rather than unlikely, so do not remove it. The full
rule, including what migrates and how the bind rides the cloud sync, is written out in the header of
`lib/notesStore.js`; read it there rather than re-deriving it.

**Files**
- `Notes.jsx` — workspace root (lazy chunk). Owns the TREE, the BIN, search, export, print, the
  project SCOPE, and the storage-error banner. Three load-bearing details: the editor is pulled by `lazy()` **from this
  file** so the tree paints before the engine downloads; `<NoteEditor key={activePageId}>` — the
  remount per page is a bug fix, not a style choice; and the print serializer is reached by a
  **dynamic** `import()` only, because it pulls the schema and the schema pulls the engine.
- `components/NotesTree.jsx` — the left rail, in three views (**Notebooks · Recent · Bin**).
  A row shows its **name and nothing else**: Add / Rename / Move / Export / Delete live on a
  **right-click menu** (B1367), reachable from the keyboard with the context-menu key or
  Shift+F10. Rename is still an inline field (Enter commits, Esc cancels), delete still asks
  with an inline "Delete? ✓ ✕" row and still bins — **no `window.prompt`/`confirm`/`alert`
  anywhere** (house rule). The row's key handler answers Enter/Space and the menu keys and
  **nothing else** — Delete and Backspace are permanently unhandled here (B1366), because
  hovering is not intent. Esc in the search box clears the query.
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
- `lib/notesModel.js` — PURE tree schema + every structural op, page **timestamps**, the project
  **binding** (`visibleNotebooks` · `notebooksInScope` · `setNotebookProject`), and the
  **bin**. `deleteNode` is a SOFT delete: it lifts the node into `tree.trash`, still computes the
  FULL cascade of orphaned page ids (TOMBSTONE-DELETES) and stamps it on the entry; `restoreNode` /
  `purgeTrashEntry` / `expiredTrashIds` are the rest of the 30-day lifecycle.
- `lib/notesStore.js` — **the ONE storage seam.** Keys `planyr:notes:tree:v1:<scope>`,
  `planyr:notes:page:v1:<scope>:<pageId>` and (B1291) `planyr:notes:sync:v1:<scope>`, scope = user id
  or `local`. The tree holds no bodies, so a keystroke's autosave never rewrites the whole notebook.
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
- `lib/notesTabKey.js` — **Tab belongs to the DOCUMENT while the caret is in it** (B1392). A
  low-priority FALLBACK: the table's next-cell and the list's indent/outdent are asked first and
  still win; this catches only what they decline — a plain paragraph, an empty page, the first
  item of a list — which is where Tab used to escape into Chrome's toolbar mid-sentence. It keeps
  a deliberate keyboard-trap escape: **Escape releases the next Tab**, and the editor's accessible
  name says so.
- `lib/notesSearchHighlight.js` — search marking as ProseMirror **decorations** (never marks: it
  must not write into the document), plus stepping between matches.
- `lib/notesMarkdown.js` — PURE Markdown export + `docToText` (what body search reads) +
  `imageIdsInDoc` (the one answer to "which pictures does this page need?").
- `lib/notesDocHtml.js` — document → HTML through the **editor's own** `DOMSerializer`, so the
  print sheet cannot drift from the screen (PDF-PARITY by construction, not by discipline).
- `lib/notesPrint.js` — the print/PDF sheet: pure document builder + the hidden-iframe driver. Its
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
cascade and the bin round trip · this pointer.
