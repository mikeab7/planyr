# Document Review workspace — folder pointer

User-facing name **"Review"** (internal id stays `doc-review`, route `/markup`, data field
`markups`). Open one drawing + mark it up. Root rules in `/CLAUDE.md`; persistence + filing
internals in `/docs/REFERENCE.md` (Document Review persistence section).

**Entry points**
- `DocReview.jsx` — workspace root (lazy chunk). `Stitcher.jsx` — multi-sheet stitch/align.

**Key `lib/`**
- **⛔ `layerVisibilityReads.js` (B503184) — WHAT "HIDDEN" MEANS IN THIS WORKSPACE, and it is NOT the
  planner's model. Read this before porting anything from the site-planner audit.** Markups carry **no
  visibility concept at all** — the shared markup engine has no `hidden`, no per-object filter, no
  layer assignment — so the planner's question ("which reads of our collection forget the visibility
  predicate", B3296 / B494048) is **degenerate here: there is no predicate to forget.** What markups
  have is the PAGE, and every path that matters is already page-scoped on purpose (`pageMarks`,
  `eraseInBox`'s `m.page !== page`, B569's selection net, `arrange.js` deriving same-page peers from
  the global array it is deliberately handed). Those, and the ones that are correctly WHOLE-document
  (the takeoff `rollup`, the saved snapshot, undo state), are recorded there **with their reasons** —
  so a later session can tell "checked and right" from "nobody looked". Doc Review also has **no
  export/print path, no thumbnails and no text search**, so four of the audit's artefact categories
  have no subject here at all.
  **The ONE real hide is the PDF optional-content ("layer") toggle (B490)** — it hides part of the
  immutable BACKDROP, pdf.js does the hiding via the `OptionalContentConfig` handed to `page.render`,
  and nothing is persisted (group ids are per-load refs). So our code can only get it wrong by
  rendering without that config **or by serving a CACHED raster made before the toggle**, and it was
  the second: `renderDetail`'s `tileCovers` short-circuit asks "does my tile cover this view at this
  scale" and knows nothing about content changing underneath it, so the sharp tile — which paints ON
  TOP of the backdrop — kept showing the switched-off layer **at rest, not only on zoom** (backdrop 0
  blue px, tile above it 579,121). ⛔ Every other change to what the tile should contain already
  invalidates it (new document · page/size change · clear); **visibility must too.** Guards: the
  repo-root `test/` suite **docReviewLayerVisibility** (source guard + the render-path table covering
  every `page.render` call site + a mutation check against the pinned pre-fix commit) and the ui-audit
  harness **verify-pdf-layer-hiding** (`npm run verify:pdflayers`, 10/10, red on unmodified main).
  ⚠ Whether the owner's own drawings carry layers at all is **unknown from the sandbox** — his PDFs'
  bytes are not reachable there — which is why the fixture is a hand-built two-layer PDF and why
  **V287376's first step is "does the Layers button ever appear?"**.
- `reviewStore.js` — all persistence I/O (Supabase `doc_reviews` + Drive-first file storage);
  `usePersistence.js` — the data-loss hook (first-edit save, honest badge, flush on unload).
- `lastDoc.js` — per-PROJECT "last document reviewed" map + legacy-pointer fallback and the
  `resolveResume` boot-candidate ordering (B667; pointers are captured at first render and
  writes arm only after boot — the resume self-clobber fix).
- `localRead.js` / `autofiling.js` / `fileIndex.js` — Tier-1 plain-code title-block read +
  auto-filing (never auto-guesses). `sheetRead.js` / `autoStitch.js` / `ocr.js` — drop-a-set
  auto-group/stitch/crop/calibrate pipeline (Tesseract OCR for scanned sheets). `stitchGeom.js` —
  pure stitch geometry + the align-gate classifiers (`isReferenceSet`/`alignBadgeMetrics`, B630/B632);
  `stitchDedupe.js` — collapse duplicate placed sheets (B633). `takeoff.js` — measure rollup.
- `stitchLoadState.js` / `sheetOpenState.js` — the two "never answer a user with silence" decisions,
  pure so they can be asserted away from pdf.js, a canvas and a clock. `stitchLoadState` is the
  stitcher's honest status line (phase + real counts; **the old fixed "Rendering…" string could and did
  outlive the work it named**) plus the deferred-add QUEUE: a click that lands while `loadStitch` holds
  the canvas is remembered and replayed, never dropped by a bare early return. `sheetOpenState` is the
  Review "Opening <sheet>…" chip's three-way decision — arrived / genuinely failed / past the backstop —
  which replaced a bare `renderedPage !== page` whose only exit was one success line, so every bail and
  every swallowed throw left the chip up forever AND the sheet pinned at 0.35 opacity.
- `releaseCanvas.js` (NEW-5) — hand an offscreen canvas's backing store back once its pixels have
  been consumed. This workspace is the biggest producer of them: `pdf.js`'s `renderInto` runs on a
  throttle DURING a continuous pan, so a minute of panning used to leave hundreds of full-density
  buffers to the GC — and canvas pixels are renderer/GPU memory the GC barely feels. Released after
  the copying `drawImage` / `toBlob` / `getImageData`; the OCR raster is released by `ocr.js` (its
  real owner) rather than by the module that rendered it. A byte-identical copy lives in the site
  planner's `lib/` — **deliberately duplicated, not shared**: a module reachable from both routes
  is hoisted into its own chunk and breaches the Site route's chunk budget. Keep the two identical.
- `components/ReviewsBar.jsx` — project/discipline/item/revision filing UI. The file *browser* is
  now its own **Library** workspace (`/src/workspaces/library/`, B496); the storage data layer
  (`reviewStore`/`autofiling`/`fileIndex`) stays here and Library imports it cross-workspace.

**Click contract (B1190, mirrors the planner's B1188):** the Properties rail section's OPEN/CLOSED state
is `propsOpen`, a boolean only `openMarkupProps` / `closeMarkupProps` write (double-click, a freshly-drawn
markup, the ✕, Escape). **Selection chooses the BODY only** — with nothing selected the section holds its
ground on a "Nothing selected" state rather than vanishing. Never reintroduce a marker that has to match
`sel`, and never add an effect keyed on `sel` that writes the open state: that pairing is the bug, and
the repo-root `test/` suite **clickContract** fails the build on it. That suite also reads this file's own
`TOOLS` registry, so **a new markup tool must be declared** in `REVIEW_CLICK_CONTRACT` or
`REVIEW_NON_MARKUP_TOOLS` (the repo-root shared **clickContract.table** under `e2e/`). Live guard: the
e2e spec **review-click-contract**.

**Model rule:** the imported drawing is an **immutable backdrop**; measurements/markups/massing
live on editable layers over it — never write back the engineer's geometry. Shared markup engine
is in `/src/shared/markup/`. Heavy CAD/PDF parsing belongs in Web Workers.

<!-- Keep this pointer current: if you rename/move/delete a key file in this folder, update the
     lines above in the same commit. The doc-pointer-audit check fails CI on a stale reference. -->
