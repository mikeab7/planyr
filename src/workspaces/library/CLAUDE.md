# Library workspace — folder pointer

The one and only file browser (B496). Internal id `library`, route `#/library`, teal accent
`--accent-library`. Browse projects → disciplines → files; clicking a file opens it in **Review**
via the Shell `onOpenReviewInDocReview` intent.

**Files**
- `Library.jsx` — workspace root (lazy chunk). Since B662 the per-project surface is ONE unified
  view (no Files/Folders tabs): the folder tree as the left rail + the file list on the right.
  With no project selected it renders the HOME surface (B668), not a pick-a-project note.
- `components/LibraryHome.jsx` — the landing Home (B668): Pinned folder/file cards + Recent
  drawings + project cards. Backed by the shared pin store (`/src/shared/pins/`, per-device,
  swap-ready API) and the recents list (`/src/shared/recents/`); ☆ pin toggles live on
  FolderTree rows + file cards. Tree expansion persists per project via the shared persisted
  id-set helper in `/src/shared/ui/` (B665 — collapsed by default).
- `components/FileBrowser.jsx` — the filing machinery (search + sort toolbar, badged list,
  whole-pane drop target, upload tray, needs-filing, refile/share/delete — the facet chips and
  bottom drop card were removed in B697/B699). `folderMode` swaps its left column for the real
  folder tree and filters the list by the selected folder (files place via the shared
  `resolveDrawingTarget`, superseded → 02. Archive); folder drops preserve the dropped subfolder
  structure (`matchDropPathToFolder`; unmatched → Needs filing). Cross-project browsing keeps
  the classic category tree (route-only since B700 — no in-pane "All projects" button).
- `components/FolderTree.jsx` — the per-project standard folder tree editor (B650): right-click
  → New folder / rename (inline) / move / delete with an enumerated delete-safety confirmation
  (header "＋ Category" buttons removed, B698); rows are drop targets (B699); the rail foot shows
  the honest Drive-mirror status — "Synced · N min ago" / progress / not-connected / loud error
  (B701). `embedded` mode = the unified view's left rail (selection, per-folder counts,
  publishes rows up).
- `lib/folders.js` — the folder-index store: reads/writes the tree in Supabase (`project_folders`,
  own-row RLS) and triggers the one-way Google Drive mirror via `/api/folders` (loops the server's
  20-op chunks with progress — the B662 502 fix). Also the B663 one-time organizer
  (`migrateAllProjects`/`migrateProjectFiles`): seeds every existing project + moves pre-tree
  Drive files into their tree folders; auto-runs once per account from `Library.jsx` (banner).

**Data layer:** file browsing imports `reviewStore` / `autofiling` / `fileIndex` from
`/src/workspaces/doc-review/lib/` cross-workspace. The **folder tree (B650)** adds its own index:
the `project_folders` table (SQL under `/src/workspaces/doc-review/db/`), the shared template +
tree logic in `/src/shared/folders/`, and the server-side Drive mirror at `/functions/api/folders.js`
(reconcile executor under `/server/storage/`). Root rules in `/CLAUDE.md`.

<!-- Keep this pointer current: if you rename/move/delete a key file in this folder, update the
     lines above in the same commit. The doc-pointer-audit check fails CI on a stale reference. -->
