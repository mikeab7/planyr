# Library workspace — folder pointer

The one and only file browser (B496). Internal id `library`, route `#/library`, teal accent
`--accent-library`. Browse projects → disciplines → files; clicking a file opens it in **Review**
via the Shell `onOpenReviewInDocReview` intent.

**Files**
- `Library.jsx` — workspace root (lazy chunk). Since B659 the per-project surface is ONE unified
  view (no Files/Folders tabs): the folder tree as the left rail + the file list on the right.
- `components/FileBrowser.jsx` — the filing machinery (facets, list, drop zone, upload tray,
  needs-filing, refile/share/delete). `folderMode` swaps its left column for the real folder tree
  and filters the list by the selected folder (files place via the shared `resolveDrawingTarget`,
  superseded → 02. Archive). Cross-project ("All projects") keeps the classic category tree.
- `components/FolderTree.jsx` — the per-project standard folder tree editor (B650): add / rename
  (inline) / move / delete with an enumerated delete-safety confirmation; shows Drive-mirror
  status + chunked-sync progress. `embedded` mode = the unified view's left rail (selection,
  per-folder counts, publishes rows up).
- `lib/folders.js` — the folder-index store: reads/writes the tree in Supabase (`project_folders`,
  own-row RLS) and triggers the one-way Google Drive mirror via `/api/folders` (loops the server's
  20-op chunks with progress — the B659 502 fix). Also the B660 one-time organizer
  (`migrateAllProjects`/`migrateProjectFiles`): seeds every existing project + moves pre-tree
  Drive files into their tree folders; auto-runs once per account from `Library.jsx` (banner).

**Data layer:** file browsing imports `reviewStore` / `autofiling` / `fileIndex` from
`/src/workspaces/doc-review/lib/` cross-workspace. The **folder tree (B650)** adds its own index:
the `project_folders` table (SQL under `/src/workspaces/doc-review/db/`), the shared template +
tree logic in `/src/shared/folders/`, and the server-side Drive mirror at `/functions/api/folders.js`
(reconcile executor under `/server/storage/`). Root rules in `/CLAUDE.md`.

<!-- Keep this pointer current: if you rename/move/delete a key file in this folder, update the
     lines above in the same commit. The doc-pointer-audit check fails CI on a stale reference. -->
