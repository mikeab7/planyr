# Document Review workspace — folder pointer

User-facing name **"Review"** (internal id stays `doc-review`, route `/markup`, data field
`markups`). Open one drawing + mark it up. Root rules in `/CLAUDE.md`; persistence + filing
internals in `/docs/REFERENCE.md` (Document Review persistence section).

**Entry points**
- `DocReview.jsx` — workspace root (lazy chunk). `Stitcher.jsx` — multi-sheet stitch/align.

**Key `lib/`**
- `reviewStore.js` — all persistence I/O (Supabase `doc_reviews` + Drive-first file storage);
  `usePersistence.js` — the data-loss hook (first-edit save, honest badge, flush on unload).
- `localRead.js` / `autofiling.js` / `fileIndex.js` — Tier-1 plain-code title-block read +
  auto-filing (never auto-guesses). `sheetRead.js` / `autoStitch.js` / `ocr.js` — drop-a-set
  auto-group/stitch/crop/calibrate pipeline (Tesseract OCR for scanned sheets). `stitchGeom.js` —
  pure stitch geometry + the align-gate classifiers (`isReferenceSet`/`alignBadgeMetrics`, B630/B632);
  `stitchDedupe.js` — collapse duplicate placed sheets (B633). `takeoff.js` — measure rollup.
- `components/ReviewsBar.jsx` — project/discipline/item/revision filing UI. The file *browser* is
  now its own **Library** workspace (`/src/workspaces/library/`, B496); the storage data layer
  (`reviewStore`/`autofiling`/`fileIndex`) stays here and Library imports it cross-workspace.

**Model rule:** the imported drawing is an **immutable backdrop**; measurements/markups/massing
live on editable layers over it — never write back the engineer's geometry. Shared markup engine
is in `/src/shared/markup/`. Heavy CAD/PDF parsing belongs in Web Workers.

<!-- Keep this pointer current: if you rename/move/delete a key file in this folder, update the
     lines above in the same commit. The doc-pointer-audit check fails CI on a stale reference. -->
