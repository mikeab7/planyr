# Planyr — Shipped & verified (history)

Moved out of `CLAUDE.md` 2026-07-02 to keep the always-loaded handoff lean. This is the catalog of work that is DONE and live. Read a section only when you need the history of that specific feature.

## DONE & VERIFIED
### Site Planner (mature)
- Geographic basemap refactor; shared layer state; Site-model schema/migration/selectors.
- New-site data-loss fix: first-edit persistence, honest save badge, `beforeunload` flush.
- Layer-status: error-body parsing, per-layer status dots, no zero-size exports, wetlands
  on a single host, ~45s self-heal re-probe.
- Houston water/wastewater/storm on the City's `geogimstest` host via `layers=show:<sublayer IDs>`.
- **Layer coverage engine + coverage-aware picker (B283/B284).** Layers tagged national/
  statewide/regional; a regional layer's published `fullExtent` (from the `?f=json` probe,
  reprojected via the shared EPSG:2278 grid) is intersected with the view so the panel says
  **"No data in this area"** instead of a silent blank (the COH-blank-outside-Houston confusion).
  A **Relevance** control (Show all/Dim/Hide) + **nearby-range** slider dim/collapse out-of-coverage
  layers — **list ordering/visibility only, never the map** (hard rule: the request builders in
  `lib/layerRequest.js` take no coverage input). Fails open. Mapillary renamed "Poles & hydrants
  from street imagery" + gated "needs setup" (B285/B286); jurisdiction vectors retry transient
  5xx with backoff (B287). `lib/coverage.js`.
- **Level-of-detail tiering for fine-infra labels (B149, incl. the 2026-06-23 sidewalk amendment).**
  At site-overview zoom the sidewalk/landscape/buffer **width labels** and the paving/road red **width
  dimensions** are illegible clutter, so they're **detail tier**: gated by `detailLabelVisible(featureFt,
  ppf)` in `lib/labelLayout.js` — the existing `dimCalloutVisible`/`DIM_CALLOUT_MIN_PPF` gate as the
  floor, refined by B149's self-tuning min-on-screen-length rule (`featureFt*ppf ≥ DETAIL_LABEL_MIN_PX`,
  **30 px**, calibrated to the planner's ppf-8 zoom cap so a 5′ strip reveals at ppf ~6 with headroom).
  The thin strip **geometry stays** (only the label/dimension drops — a ~1 px strip popping in/out would
  flicker). Building footprint dims stay **site tier** (`dimCalloutVisible`); building name/SF + the
  site-summary chip are **overview tier** (never zoom-gated). Headless-verified V119
  (`ui-audit/verify-b149-sidewalk-lod.mjs`).

### Supabase backend (built, Phases 1–4)
- Phase 1 cloud Postgres; Phase 2 email/password auth; Phase 3 RLS (sites private by default);
  Phase 4 cloud save/load + cross-device sync. No migration of old browser-stored sites (intentional).
- User profiles (B297/B298) — signup first/last name persists to a queryable **`public.profiles`**
  table (one row per `auth.uid()`, private RLS, a `handle_new_user` signup trigger copying signup
  metadata + a backfill). Header pill shows the **name** (never blank: First Last → first → last →
  metadata → email) + **account dropdown** (Profile/Settings/Sign out). Reuses the anon client +
  session, no new keys. Migration `src/workspaces/site-planner/db/profiles.sql` (idempotent).

### Multi-workspace foundation
- Monorepo restructure via **PR #3** (clean `main`): shell, workspace folders, coordinate stub,
  `/server` placeholder; Site Planner moved in unchanged. Build passes; real lazy-chunk split.
- **Cross-module project connections — a schedule linked to a site (B493; also CLOSED B477).** A
  project = a Site Planner **site group** (`group_id`); Site↔Review already share it. This wires the
  **Schedule** in too: the canonical pairing lives on the schedule project (`linkedSiteId`/`Name`,
  free in the `hs-v1` blob), mirrored as a lightweight HINT onto the Site Model
  (`scheduleProjectId`/`Name`, **schema v9**, additive) so the Site Planner sees "has a schedule"
  without booting the iframe (the two live in **separate backends** — the Shell brokers the mirror).
  **Payoff = the top-header tabs carry the project:** `Scheduler.jsx` honors the routed `projectId`
  (`planar:nav-select-by-site` activates the linked schedule; the active schedule pushes its
  `linkedSiteId` back via `onProjectChange`). Land on an unlinked site → `LinkSchedulePanel`
  resolution card (**suggest-and-confirm**, never auto-links: same-named suggestion + manual pick +
  "Create a schedule for this site"). Bridge: `public/sequence/index.html` (nav-state carries the
  link; inbound `nav-select-by-site`/`nav-link`/`nav-create-linked`; outbound `link-changed`),
  `scheduler/lib/navState.js` (`findBySiteId`), `shared/projects/projectModel.js` (`suggestNameMatch`),
  `storage.js` (`setScheduleLink`/`scheduleLinkOf`), 📅 chip in `ProjectBreadcrumb.jsx`. Headless
  `verify-cross-module-link.mjs` (wrapper path); the live cross-iframe round-trip (Schedule's own
  Supabase, unreachable in the sandbox) is **V152**. **Follow-up fix B561** removed a Site→Schedule
  switch regression (flashing/placeholder/raw-id/false-conflict) by making the route↔iframe sync
  directional (the iframe→route push-up only adopts into an *empty* route; user picks carry up via a
  one-shot `selectSchedule`), holding the routed name as last-known-good, never surfacing the raw
  `group_id`, and no-opping the carry-in when the schedule is already active. Harness now 11/11; V172.

### Document Review — cloud persistence
- Persists to the **existing Supabase backend** (reuses the anon client + auth session, no new
  keys), single sheet + stitched set. **Postgres `public.doc_reviews`** holds the work layer
  (markups, measurements, calibration, stitch transforms, takeoff, source-file refs) as `data`
  jsonb, RLS private like `public.sites`; **source PDFs** in a private Storage bucket
  `doc-review-files` at `<uid>/<reviewId>/<srcId>.pdf`. Migration `src/workspaces/doc-review/db/doc_reviews.sql`.
  *(Update: since **B207 is live**, `storeSource` now files PDFs to **Google Drive first** and uses this
  Supabase bucket only as the fallback — see "Two backends" below. The work layer + RLS are unchanged.)*
- Copies the Site Planner data-loss pattern (persist on first edit, honest badge, sync localStorage
  mirror + beforeunload/visibility/unmount flush, resume-last-review). **Oversize (≥50 MB free-tier)
  PDFs:** work layer still saves, file flagged "re-drop on load" (banner single / dashed placeholder
  + drop-to-rebind stitcher). All inside the doc-review lazy chunk.

### Document Review — project library (B14)
- Reviews/files filed under existing Project/Site records (a "project" = a Site Planner site group;
  name=`site`, id=`group_id`). Each review carries `project_id`, `discipline` (Survey/Civil/
  Architectural/Landscape/Environmental/CAD/Geotech/Other), `item`, `revision`, `doc_date`; name
  defaults to `"<Project> - <Item> - YYYY.MM.DD"` (editable in the Reviews menu).
- **Lifecycle status REUSED, not re-added** — lives on the Site Model (`sites.data ->> status`;
  pursuit/active/onhold/complete/dead, per B7/B8); the library reads projects+status from `sites`
  and writes back via the planner's `cloudUpsert` (one source of truth).
- **`ProjectLibrary` drawer:** project (+ editable status badge) → discipline folder → files
  newest-first → click to open; drag-drop a PDF onto a project/discipline to file it; unlinked
  reviews under "Unfiled". Storage paths `<uid>/project-<id>/<discipline>/<srcId>.pdf` (uid first →
  Storage RLS unchanged). Additive migration `src/workspaces/doc-review/db/project_library.sql`;
  `upsertReview`/`listReviews` fall back to core columns until it's run.

### Document Review — auto-filing: PLAIN CODE first, AI fallback (B299 + B312) — LIVE (Tier 1 default-on)
- **Tier 1 (B312, LIVE, default-on, FREE)** — plain code in the browser, no tokens/cloud/key. For
  any PDF with a text layer, `extractPageText` (pdf.js, from B267) → pure parsers in `src/shared/files/`:
  `titleBlockParse.js` (discipline keywords incl. **ALTA**, latest-date, sheet #, revision) +
  `matchProject.js` (`matchProjectInText`, reusing "never auto-guess") → `doc-review/lib/localRead.js`
  (`localTitleBlockRead`). `autofileReady = true` so the drawer auto-files: **confident match →
  auto-route; else → active project / holding tray.** 53 unit tests; real-sheet accuracy = **V79**.
- **Tier 2 (B299, AI fallback, gated dormant)** — `autofile` (`lib/autofiling.js`) is local-first,
  reaching AI only when Tier 1 finds **no text** (scanned/image-only) **and** `VITE_AUTOFILE_ENABLED`
  is on. Server-side title-block read (`server/filing/`, Cloud Run — key never reaches the browser)
  reads the PDF with the Claude API, **matches to a named project** (parcel/job#/address/name,
  **never auto-guesses**), returns a filing decision (auto-route+name, or "needs filing" holding area)
  **plus placement facts** in the same read. **Reader** mirrors client `titleReader.js` but calls the
  Messages API over raw `fetch` (injectable, like `server/convert/aps.js`); **Matcher** is pure + lists
  its matched signal. `POST /file` (PDF + `X-Planyr-Projects` base64 header) / `GET /health`, honest
  statuses; `Dockerfile` + `README.md`.
- **File-facts index in Supabase Postgres, NOT /server** (`doc-review/db/file_facts.sql`,
  `public.file_facts`, RLS like `doc_reviews`) — one row per filed drawing so the library answers
  "project → discipline → latest set" without re-reading the PDF. Client: index provider
  `doc-review/lib/autofiling.js` fills the `capturePlacementFacts` seam (B181) + `autofile`;
  `lib/fileIndex.js` + `reviewStore.upsertFileFacts/listFileFacts` persist it.
- **Gated dormant (like the APS DWG fallback; NOTE Drive storage itself is now LIVE — B207):**
  `backendReady` reflects `VITE_AUTOFILE_ENABLED`; proxy
  `functions/api/file.js` 503s until `DOC_FILING_URL` is set → drawer files manually as before
  (404/503 = graceful skip). **Owner deploy:** `gcloud run deploy server/filing/` + `ANTHROPIC_API_KEY`
  + `DOC_FILING_URL` + `VITE_AUTOFILE_ENABLED=1` + run `db/file_facts.sql` once. (V74.)

### Document Review — drop a set → auto-group, auto-stitch, crop, auto-calibrate (B335–B339) — LIVE
- **Headline UX:** drop a multi-page set into the Stitcher → pages are read, **grouped into logical
  sheets** ("Grading Plan · C-5–C-7 · 3 sheets"); clicking a group **auto-stitches** every page,
  **crops** title blocks so drawings butt cleanly, **auto-calibrates** from the stated scale.
  "All pages" toggle + 2-point manual Align remain the safety net.
- **Positional reader (B336):** pure `src/shared/files/sheetMeta.js` (+ pdf.js `extractPageItems`) —
  per page finds the title-block band, sheet title, stated scale (reuses B267 `parseSheetScale`), and
  match-line labels with position+orientation; REUSES the B312 `titleBlockParse` (a positional superset,
  not a second reader). Pipeline + per-group calibration in `doc-review/lib/sheetRead.js`, with a dormant
  injectable OCR seam.
- **Grouping (B335)** `src/shared/files/sheetGroups.js`; **auto-stitch (B337)** `doc-review/lib/autoStitch.js`
  (seam graph → existing `solveM`, B300; label-less sheets → manual Align pre-seeded with detected
  endpoints); **crop + pinned composite key (B338)** + **per-group auto-calibrate (B339)** in `Stitcher.jsx`.
- **Scanned-sheet OCR (B352, owner-requested):** a no-text-layer drawing reads too — `doc-review/lib/ocr.js`
  renders to canvas, runs **Tesseract.js** (WASM worker), converts per-word boxes into the SAME page-unit
  items `sheetMeta` consumes (identical group/stitch/crop/calibrate pipeline). Lazy (worker spins up only
  for no-text pages; WASM + English model from a pinned CDN — jsDelivr; pixels never leave the browser).
  7 unit + 15 stress tests + LIVE headless V93 (`verify-b352-ocr.mjs`).
- **Markup-sidebar parity (B266 + B348):** the single-sheet **Markup** sidebar now shows each sheet's
  **real # + title** (B266) and **collapses into the same logical sheets** (B348), reusing
  `readSheetMeta`/`groupSheets`/`statedCalibration` (no duplicate modules); no-title-block page falls
  back to "Sheet N" (gated on `meta.titleBlock || meta.sheetNumber`). Verified V88
  (`ui-audit/verify-markup-sheet-labels.mjs`).
- **Remaining CV tails → B340** (Later/Roadmap): graphic scale-bar reading, geometric edge-line stitch
  fallback, legend symbol-union. Common case (vector + scanned-via-OCR) shipped. 30 unit tests; headless
  V87 (`ui-audit/verify-b335-b339.mjs`).

### Document Review — stitcher notes/legend capture + click-to-detail "cloud" (B350) — LIVE
- **Notes/legend survive the crop, aggregated across the set.** Auto-crop (B338) hides the title-block
  band where notes/legends live. Pure `src/shared/files/sheetNotes.js` (`parseNotes` finds each
  `GENERAL/GRADING/KEYED NOTES`/`LEGEND`/`ABBREVIATIONS` block; `aggregateNotes` merges placed sheets,
  dedupes boilerplate, **flags a note that differs by sheet** with its tag) → the pinned **Composite key**
  gains an expandable "Notes & legend · N" section.
- **Click a detail callout → it pops up (Bluebeam-style) without leaving the drawing.** Pure
  `src/shared/files/detailRefs.js` reads callout **bubbles** (detail id over sheet code "5 / A-3", plus
  inline/keyword forms — conservative: a plain fraction can't match) + **definitions** (`DETAIL 5`,
  `SECTION A-A`). Callouts render as clickable hotspot rings → a floating **cloud popup** renders the
  referenced sheet (reused or on-demand), centered on the named detail, pan/zoomable; honest fallback
  when the target isn't in the set. Toolbar **Details** toggle; hotspots grab clicks only in Pan mode.
- Both REUSE the B336 reader (`readSheetMeta` → each page carries `notes`/`detailRefs`/`detailAnchors`;
  placed sheets persist them). 14 unit tests; V92 headless (`ui-audit/verify-b350.mjs`).

### Document Review — robust labels on text-dense (general-notes / specs) sheets (B378/B379) — LIVE
- A structural general-notes set labelled atrociously (body boilerplate as the title, a body
  cross-reference read as the sheet number on several rows, false "·≈" auto-cal). All from one
  mismatch: the reader was tuned for a drawing (sparse plan + one dense title-block strip); a notes
  sheet (wall-to-wall text, no drawing area) breaks every assumption. Fixed at the **shared** reader
  so the Markup sidebar AND the Stitcher both benefit:
  - **Title scorer** (`sheetMeta.readSheetTitle`) now prefers **short + large type** (height-dominant
    score, ≤7-word/≤48-letter cap) + a **boilerplate filter** — so "GENERAL NOTES" wins over the
    copyright/legend prose it used to lose to.
  - **Sheet number** is read from the **title-block zone only** (`readSheetMeta` → band, else the
    right/bottom edge strip when a dense sheet defeats the density-based band detector), never the
    whole-page body — so a cross-ref ("SEE DWG S202") can't masquerade as the sheet's own number.
    `reconstructLines` now **splits a row on a large horizontal gap** so a title-block title can't
    merge into a far-left body line. `markAdjacentDuplicateNumbers` (sheetGroups) clears a number
    that repeats on an adjacent page. Sidebar uses a `trustedTitle` gate (band OR zone-number OR
    text-page corroboration) → real title, else item, else number, else "Sheet N".
  - **B379:** `readSheetMeta` flags a **`textDense`** sheet (notes/specs/legend title, or a prose-
    saturated drawing area); `statedCalibration` returns 0 for it — a pure-text sheet is left
    uncalibrated, never silently mis-scaled off a stray body scale string. Real plan sheets unchanged.
  - +10 unit tests (1153 green); headless **V104** (`ui-audit/verify-notes-sheet-labels.mjs`, 9/9).

### Shared markup engine + Bluebeam-parity refinement loop (B423 umbrella — B424…B432)
All tools in both workspaces (and the Stitcher) flow through one shared engine in
`src/shared/markup/`. The matrix, the tests, and the loop driver are:

- **`src/shared/markup/tools.matrix.js`** is the machine-checkable spec. One row per tool;
  `TOOL_MATRIX`, `PROPERTY_COLUMNS`, `propsForTool`, `toolsForWorkspace`. **⛔ This file is NEVER
  edited to make a failing test green** — a red test means the CODE is behind the spec; fix the
  code.
- **`e2e/markup-tools.spec.js`** is the loop's verifier (B278 harness, NEW-9). Two sections:
  - **Section A — matrix ↔ propertySchema conformance (no auth, no browser):** for every tool row
    in `toolsForWorkspace("doc")`, asserts `schemaForMarkup({kind: id}).map(s=>s.key).sort()`
    equals `propsForTool(id).sort()`. If the property panel drifts from the matrix, CI catches it
    here before any browser is opened.
  - **Section B — per-tool rail arm (auth-gated):** clicks each tool's `data-testid="tool-<id>"`
    button and asserts `aria-pressed="true"`. Gracefully skips when the tool rail is not visible
    (no PDF open / B280 fixture not yet seeded). Grows one `test.describe` per matrix row as
    draw+panel assertions are wired in.
- **Loop driver (each session):** run `npm run lint && npm test && npm run build` + scan
  `e2e/markup-tools.spec.js` for red or skipped-pending rows. A red row in Section A = property
  schema drifted → update `propertySchema.js` to match the matrix. A red row in Section B = the
  rail button or its `data-testid` is missing → fix the ToolRail registration. Add a new draw
  or panel assertion when a tool gains verified behavior (B432 rule: assertions land with the code,
  never before and never after).
- **Sub-items shipped (B424–B431):** pure modules (`geometry.js`, `markupModel.js`, `measure.js`,
  `hitTest.js`, `propertySchema.js`), `MarkupRenderer.jsx`, `PropertyPanel.jsx`, host wiring,
  DocReview parity tools (Line/Polyline/Polygon/Ellipse/Arc/Dimension/Pen/Highlight/Eraser/
  Snapshot), property-set completion, Count in Site Planner, vtx-drag handles, Shift snap,
  ParcelDrawing inline calibrate. B432 (NEW-9) closes the umbrella.
- **Shared SELECTION layer (B587/B588; in-code labels read the provisional B569/B570).** On top of the engine sits one shared selection model:
  `shared/markup/selection.js` (pure — `pickInMarquee` crossing/window box-test, `nextSelection`
  with Ctrl/⌘=toggle · Shift=add · plain=replace, `cornerGrips`) + `shared/markup/SelectionChrome.jsx`
  (the ONE neutral hue-free chrome — light casing under a dark line + grips, tokens `--sel-casing`/
  `--sel-line`). Both workspaces consume it for multi-select (Ctrl/⌘ + Shift-click), the **Marquee**
  rail tool (a `mode` row in `tools.matrix.js`, `data-testid="tool-marquee"`), multi-move, and
  multi-delete. Selection STATE/wiring stays per-host (different coordinate spaces); only the
  logic/visual is shared. Site Planner covers els+markups+measures; **parcels keep their merge
  interaction** (the one sanctioned divergence). Single-select keeps its resize/rotate handles.


---

# Deferred / maintenance backlog
Low-priority cleanup items captured here so they aren't lost. Nothing in this section
is urgent or blocking — the app is healthy; pick these up when convenient.

## Retire the old GitHub Pages deploy pipeline — ✅ DONE
**Status: done (mid-2026).** The redundant GitHub Pages deploy was removed; Cloudflare
Pages is now the sole publisher of planyr.io.

**What was done:**
- The combined build+deploy workflow `.github/workflows/deploy.yml` was reduced to a
  build-only check and renamed `.github/workflows/build.yml`. Removed: the `deploy`
  job (`actions/deploy-pages`), the `actions/configure-pages` + `actions/upload-pages-
  artifact` steps, the `pages: write` / `id-token: write` permissions, the `pages`
  concurrency group, and a stale feature-branch push trigger.
- **Kept:** the `build` job (lint + test + build) — still the required "it builds"
  status check that gates merges into `main`. The required-check context is the *job*
  name `build` (unchanged), so renaming the file/workflow did not disturb the merge
  gate. Nothing publishes from GitHub Actions anymore.
- **Verified safe for production:** there is no Cloudflare workflow file in this repo —
  Cloudflare Pages deploys via its own GitHub App connection (the "Cloudflare Pages"
  check on PRs comes from that App, not a workflow), so removing the Pages deploy
  cannot affect the live planyr.io site.

**One optional manual step left (GitHub UI, owner only):** the old github.io test site
stops *updating* immediately (nothing deploys to it now) but keeps *serving* its
last-published copy until GitHub Pages is switched off. To fully take it down: repo
Settings → Pages → Source → "None". Harmless to leave as-is — just stale.

**Baseline reference:** after the repo rename, commit `b593a28` triggered a successful
Cloudflare production build serving planyr.io — so Cloudflare auto-deploy is known-good
independent of the (now-removed) GitHub Pages workflow.
