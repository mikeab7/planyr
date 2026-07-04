# Library workspace — folder pointer

The one and only file browser (B496). Internal id `library`, route `#/library`, teal accent
`--accent-library`. Browse projects → disciplines → files; clicking a file opens it in **Review**
via the Shell `onOpenReviewInDocReview` intent.

**Files**
- `Library.jsx` — workspace root (lazy chunk); a Files/Folders tab switch.
- `components/FileBrowser.jsx` — the browser UI (was Review's old landing screen, lifted here).
- `components/FolderTree.jsx` — the per-project standard folder tree editor (B645): add / rename
  (inline) / move / delete with an enumerated delete-safety confirmation; shows Drive-mirror status.
- `lib/folders.js` — the folder-index store: reads/writes the tree in Supabase (`project_folders`,
  own-row RLS) and triggers the one-way Google Drive mirror via `/api/folders`.

**Data layer:** file browsing imports `reviewStore` / `autofiling` / `fileIndex` from
`/src/workspaces/doc-review/lib/` cross-workspace. The **folder tree (B645)** adds its own index:
the `project_folders` table (SQL under `/src/workspaces/doc-review/db/`), the shared template +
tree logic in `/src/shared/folders/`, and the server-side Drive mirror at `/functions/api/folders.js`
(reconcile executor under `/server/storage/`). Root rules in `/CLAUDE.md`.

<!-- Keep this pointer current: if you rename/move/delete a key file in this folder, update the
     lines above in the same commit. The doc-pointer-audit check fails CI on a stale reference. -->
