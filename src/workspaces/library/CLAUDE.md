# Library workspace — folder pointer

The one and only file browser (B496). Internal id `library`, route `#/library`, teal accent
`--accent-library`. Browse projects → disciplines → files; clicking a file opens it in **Review**
via the Shell `onOpenReviewInDocReview` intent.

**Files**
- `Library.jsx` — workspace root (lazy chunk).
- `components/FileBrowser.jsx` — the browser UI (was Review's old landing screen, lifted here).

**Data layer:** none of its own — imports `reviewStore` / `autofiling` / `fileIndex` from
`/src/workspaces/doc-review/lib/` cross-workspace (project-scoped, canvas-independent). No new
backend/tables/keys. Root rules in `/CLAUDE.md`.

<!-- Keep this pointer current: if you rename/move/delete a key file in this folder, update the
     lines above in the same commit. The doc-pointer-audit check fails CI on a stale reference. -->
