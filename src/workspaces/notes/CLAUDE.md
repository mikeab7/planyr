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

**Files**
- `Notes.jsx` — workspace root (lazy chunk). Owns the TREE, search, export, and the storage-error
  banner. Two load-bearing details: the editor is pulled by `lazy()` **from this file** so the tree
  paints before the engine downloads, and `<NoteEditor key={activePageId}>` — the remount per page
  is a bug fix, not a style choice.
- `components/NotesTree.jsx` — the left rail. Inline rename (Enter commits, Esc cancels) and an
  inline "Delete? ✓ ✕" row — **no `window.prompt`/`confirm`/`alert` anywhere** (house rule).
- `components/NoteEditor.jsx` — one page: title, toolbar, document. **The only module on this
  route that imports the editor engine.** Its header documents the two bugs the live checks
  caught (a page switch inside the save debounce losing the last edit; reopening a note with a
  table crashing on `setContent` against a torn-down instance) — read it before changing the
  save path or adding any "sync content on pageId change" effect. There must never be one.
- `components/NoteToolbar.jsx` — formatting bar. Every active state is read from
  `editor.isActive(...)`, never mirrored into React state; every control cancels `mousedown` so
  the caret survives a click. Holds the module's only literal colours — the text/highlight
  **content** palette, which must not be theme tokens. It re-declares the two shared control
  radii locally instead of importing the shared `shared/ui/controls` primitives: that import makes the bundler hoist
  a third shared chunk onto the **Site** route and the perf audit goes red.
- `lib/notesModel.js` — PURE tree schema + every structural op. `deleteNode` returns the FULL
  cascade of orphaned page ids (TOMBSTONE-DELETES); the caller clears every one.
- `lib/notesStore.js` — **the ONE storage seam.** Keys `planyr:notes:tree:v1:<scope>` and
  `planyr:notes:page:v1:<scope>:<pageId>`, scope = user id or `local`. The tree holds no bodies,
  so a keystroke's autosave never rewrites the whole notebook. Cloud sync is a change **here and
  nowhere else**.
- `lib/notesMarkdown.js` — PURE Markdown export + `docToText` (what body search reads).
- `lib/notesExtensions.js` — the ONE declaration of what a note may contain.

**Guards that will fail the build if you break them** (the `notesModule` suite under `test/`): the
eight-place workspace registration checklist · theme-token-only chrome in the three JSX surfaces ·
no dialog boxes · the editor split (nothing on the static path imports `@tiptap/*`) · the mirrored
control-radius scale still matching the shared `controls` primitives · every schema node and mark having a
case in the exporter · the delete cascade · this pointer.
