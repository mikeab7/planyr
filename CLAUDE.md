# CLAUDE.md — Planyr Project Handoff

Complete handoff for any future session. Read top to bottom to orient. This merges
two tracks of work: the mature **Site Planner** (basemap, GIS layers, Supabase
backend) and the newly-started **Document Review** module (foundation just
scaffolded). Last updated mid-2026.

> **⛔ STANDING RULE #1 — when Michael drops in a problem, FIX IT AND SHIP IT this session. Never log-and-defer.**
> A bug report or change request = **fix it, verify it, and merge it live this same session.** Parking it in
> `BACKLOG.md` for "a future session" turns his one request into homework he has to chase — the opposite of
> what he wants. The backlog is ONLY for what genuinely can't be done now (blocked on a decision, an external
> dependency, or too large to finish this run) — never a parking lot for his requests. Even if he says "add it
> to the backlog," read the intent: he wants it **handled** — file it for the record **and fix it the same
> session.** Default to action. The one acceptable reason to leave something merely filed is a hard blocker —
> then say so plainly, don't go quiet. Several at once → fix them all; if one is genuinely too big, fix the
> rest and flag that one with its specific blocker. (Owner rule, 2026-06-19.)
>
> **Finish the WHOLE job — no diagnosis-only, no band-aid, no half.** "Fix it" means implement **every** part,
> including the harder/real one: go through the code, make the actual change, and verify it (build green + the
> right self-test/headless check). A diagnosis or a backlog note is never a substitute for the work. If Michael
> picks a multi-part option ("do both"), do **every** part before reporting — don't ship part 1 and describe
> part 2. "Bigger/riskier" is NOT a reason to defer — it's a reason to do it carefully (own branch, verify,
> merge). Stop early ONLY for a true blocker: a hard technical blocker, a destructive/irreversible action
> needing confirmation, or a genuine either/or product decision only Michael can make; a fix too large for one
> session is itself a blocker — raise it with a plan, never a silent stop after the easy half. (Owner rule,
> 2026-06-19, after a session shipped only the quick half.)
>
> **📋 `BACKLOG.md` = the single source of truth for open bugs & feature requests — KEEP IT LEAN.** Every run,
> work the **🔲 Open** items. **The moment an item ships, MOVE its whole block to `BACKLOG-DONE.md` that same
> session — never mark it done in place** (marking-done-in-place is exactly what bloated this file). The next
> B# = highest `B#` across **both** files + 1. (Product backlog; distinct from the "Deferred / maintenance
> backlog" near the end of this file.)
>
> **🔍 `VERIFICATION.md` = the live-browser test checklist — KEEP IT LEAN too.** Every run, scan it and
> **verify any ⏳/due items yourself in a headless browser** (Chromium/Playwright is in the environment — see
> "🤖 Self-verification" there), then record the result. **The moment an item fully passes with nothing
> pending, MOVE it to `VERIFICATION-DONE.md`** (same archiving discipline as the backlog). The session that
> ships a UI change drives the live app itself rather than defer it. **Michael does NOT self-test — never wait
> on him or hand him a test to-do**; if no browser is reachable, log the item and move on (after CI-green +
> build-green). Self-tests run **logged-out** (the sandbox blocks sign-in), so auth-only features (cloud sync)
> still need a signed-in check. **⛔ STANDING RULE — when you ship a UI change with any path you CANNOT verify
> here (auth-only / cloud / signed-in-only / needs the live edge), you MUST add a numbered `V###` entry to
> `VERIFICATION.md` for that check, every time, unprompted.** A `⏳` note buried in the BACKLOG item is NOT a
> substitute: `VERIFICATION.md` is the single canonical list of "builds green but never clicked," and it's the
> only place a browser-equipped teammate looks for the click-through. The entry records what you DID verify
> (lint/test/build/headless) **and** the precise signed-in steps still pending — so the gap is visible, not lost.
> (Owner rule, 2026-06-26, after a session captured an auth-only check only in the backlog and nearly skipped
> the verification log.) **Interrupt Michael only for a CRITICAL failure** — won't build, won't render,
> or a shipped feature visibly crashing. (Recurring 🌐 endpoint-liveness checks still run from any session.)
>
> **📦 `BACKLOG-DONE.md` / `VERIFICATION-DONE.md` are write-only archives — do NOT read them** unless looking
> up a specific past item; they are historical record only, and exist so the two live files above stay small.

## How to talk to me (Michael) — IMPORTANT, applies to every reply
Michael is an industrial real-estate developer, not a software engineer. In chat,
explain everything in plain English — the way you'd explain it to a smart person who
doesn't write code. This is a standing rule, not a one-off.
- **Lead with what it means for me or the product** — what I'll see, do, or get — not
  how it's built.
- **No bare jargon, but teach me a little.** Never leave me to decode a term cold. DO
  deliberately drop in the occasional real technical term so I build up the vocabulary
  over time — just always pair it with its plain meaning the first time it appears,
  e.g. "a service worker (a small background helper in your browser that quietly keeps
  copies of things so they load instantly next time)" or "caching (remembering the last
  copy so it loads fast)". A term here and there with its meaning = good; a wall of
  unexplained acronyms (SWR, blob store, raster, IndexedDB, RLS…) = not.
- **When you offer options, describe each by what actually happens for me and the real
  trade-off**, not by the technique. Make the difference between options concrete
  ("this one makes the wetlands map itself pop up instantly, even when the county
  server is down; that one only remembers a little 'worked 5 min ago' label").
- **Plainer, not vaguer.** Simpler words, but stay honest and precise. If you're unsure
  or a thing is risky, say so in plain terms.
- If I seem confused, it usually means the explanation had too much jargon — re-explain
  in simpler terms, don't just repeat.
- **Whenever we discuss merging, shipping, or "making it live," end by stating plainly
  whether there's anything left for _me_ to do** — e.g. "nothing on your end, it's done"
  or "the one thing I need from you is X." Don't leave me to ask. (Browser click-throughs
  in `VERIFICATION.md` are the Claude cohort's job, never mine — those never count as my to-do.)
- **📋 Keep `OWNER-TODO.md` current and SURFACE it whenever I ask "what's left / what do I
  still need to do" (owner rule, 2026-06-27).** It's the single list of things only _I_ can do
  — decisions, inputs you need from me (a 2nd test account, a heavy PDF, a big file), and quick
  account housekeeping. Add to it the moment something lands on my plate; remove an item once I've
  done it. Read it back to me in plain English when I ask. (Distinct from `VERIFICATION.md`, which
  is the cohort's click-throughs, never mine.)
- **If a step is on MY side, HAND ME THE FILE — never just name a repo path (owner rule,
  2026-06-22).** When I need to run a SQL file, upload something, or paste something into a
  console, deliver the actual file(s) to me directly (the harness `SendUserFile` tool), in the
  order I should use them, with the one-line "do this first" note. I don't know where things are
  saved in the repo and shouldn't have to hunt. Make my part copy-paste / one-click easy.

This plain-language rule is about how you talk **to me** in chat. Keep commit messages,
PR descriptions, code comments, and the backlog technical and precise as usual.

## What Planyr is
A proprietary, TestFit-style web app for industrial real estate site work, built by
Michael (industrial developer, Dallas/Houston). It is becoming a multi-workspace
suite: the existing **Site Planner** (site yield analysis and layout) plus a new
Bluebeam-style **Document Review** workspace for reviewing construction drawings and
surveys.

The two workspaces are **one product, not two apps.** They share a single
real-world coordinate system, so work flows between them (a parsed deed lands on the
planner's map; an engineer's drawing overlays the planner's layout).

## Architecture
- **One product, multiple workspaces.** Each workspace is its own folder/module. The
  app shell switches between them; you do not run two separate apps.
- **Lazy-loaded workspaces.** A workspace's code loads only when opened, so Document
  Review never slows the Site Planner. (Verified: `SitePlannerApp` and `DocReview`
  are separate lazy chunks.)
- **Shared coordinate spine.** One real-world coordinate system underpins everything:
  **EPSG:2278 — NAD83 / Texas State Plane, South Central zone, US survey feet**
  (correct for the Houston/Katy area). This is what lets a deed polygon, an overlay,
  and the site layout all live in the same space. `src/shared/coordinates/` now has a
  **real EPSG:2278 ↔ WGS84 projection** (`projectToGrid`/`gridToProject`, Lambert
  Conformal Conic, validated vs pyproj <1e-4°); its first consumer is the **layer
  coverage engine** (B283), which reprojects each GIS service's published extent to
  test whether its data reaches the view. This is a **read-only screening use** — the
  Site Planner still keeps its own per-site feet frame for drawn geometry; grow the
  shared grid additively, not via a big-bang planner rewrite.
- **Document Review layer model.** The imported drawing is an **immutable backdrop**
  (a fixed background, never altered). The user's measurements, markups, test-fit
  massing, and parsed polygons live on **editable layers stacked over it.** "Editing
  CAD" here means building your own analysis layer over the engineer's drawing —
  never altering or writing back their geometry.
- **Heavy work off the main thread.** CAD/PDF parsing and large geometry ops belong
  in **Web Workers** (background threads) so the UI never freezes.
- **Monorepo.** One repository (`planyr`), a folder per workspace, plus a
  walled-off `/server`. Repo count buys nothing on performance; isolation comes from
  module boundaries + lazy-loading inside the one repo.

## Repository layout (after the foundation restructure)
```
src/
  main.jsx                # renders the shell
  index.css               # global styles
  app/
    Shell.jsx             # shell: lazy-loading workspace registry + header switcher
  workspaces/
    site-planner/         # all existing Site Planner code (moved here, history preserved)
      SitePlannerApp.jsx  # was App.jsx
      MapFinder.jsx, SitePlanner.jsx, components/, lib/
    doc-review/
      DocReview.jsx       # "Document Review (coming soon)" placeholder
  shared/
    coordinates/          # project-grid stub (EPSG:2278); minimal interface; not yet wired
server/                   # placeholder README only — NOT built or deployed; backend + secrets later
```
- Build command: `npm run build` → output `dist/`. Dev: `npm run dev`.
- `vite.config` has `base: "./"` (for the GitHub Pages subpath); works unchanged at a
  domain root too.

## Workflow & deploy
- **Branch per workstream; `main` is the protected, always-working, deployed line.
  No direct commits to `main` from here on.**
- Branch naming: `doc-review/<feature>`, `site-planner/<feature>`. Branch from the
  latest `main`; merge the latest `main` back into long-lived branches as you go.
- **Merge often** — the longer a branch drifts, the larger the eventual merge
  conflict. Per-workspace work in separate folders rarely conflicts; keep edits to
  genuinely shared files (the coordinate module, the shell) small.
- **Land work via pull requests; require a passing build check to merge.** The GitHub
  Actions workflow runs the build on every PR (a green "it builds" check) and on
  pushes to `main`; the deploy job is gated to `main` only.
- **"Commit" means take it LIVE — the whole chain, no stopping, no asking.** When the
  owner says "commit" (or "ship it", "make it live"), do _all_ of: stage → `git commit`
  → push the branch → open the PR into `main` → merge it (enable auto-merge if a check
  must go green first). Merging to `main` is what ships it. Do **not** stop at a local
  commit, and do **not** ask "want me to open the PR?" — opening and merging the PR is
  part of what "commit" already authorized. The only acceptable stop short of live is a
  hard blocker (merge conflict, red required check, protection that rejects the merge) —
  report _that_, not a request for permission.
- **The required `build` check often does NOT auto-start on a PR you open via the GitHub
  MCP / automation — un-stick it yourself with a nudge commit; NEVER hand this to Michael.**
  GitHub suppresses `pull_request`/`push` workflow triggers for PRs opened or pushed by the
  automation's app token, so the required `build` check sits **"Expected — Waiting for status
  to be reported"** and **auto-merge waits forever** (it will NOT merge on its own). A
  `workflow_dispatch` build _runs_ but its check does **not** satisfy the required context, and
  a direct merge is rejected with `Required status check "build" is expected`. **Fix:** after
  opening the PR + enabling auto-merge, push a tiny **empty nudge commit** to the PR branch
  (`git commit --allow-empty -m "Nudge CI" && git push`) — that fires the real `pull_request`
  build, it passes in ~40s, and the armed auto-merge then completes on its own with zero owner
  involvement. This is a known, self-serviceable hiccup — **do the nudge automatically as part
  of shipping; do NOT report it as a blocker.** (Learned 2026-06-22 on PR #274.)
  **⚠ One nudge is often NOT enough, and a PR never merges itself — BABYSIT it to `merged:true`
  (learned 2026-06-27 on PR #379).** Automation-token pushes (PR-open + a single nudge) frequently
  still don't fire the `pull_request` build — recent PRs have needed **two** `Nudge CI` commits — so
  after nudging, **verify a run actually appeared** (`actions_list list_workflow_runs` for the branch
  / `pull_request_read get_status`) and **nudge again** if not. Separately, `main` moves fast (many
  concurrent sessions) so a PR often goes `mergeable_state:dirty` on `BACKLOG*.md`/`VERIFICATION*.md`
  — resolve by merging `origin/main` in (keep both sides' done-entries; renumber only a genuinely
  colliding new B#/V#), re-run the gate, push. **Poll every ~150s while a PR is open** (webhooks do
  NOT deliver CI-success / merge / conflict transitions — always re-fetch), never on a 20-min idle tick.
- **Deploy = Cloudflare Pages (production), serving planyr.io.** Because the suite is one
  app with an in-app workspace switcher, "seeing both live" is one URL — you switch tabs
  inside it. (The old GitHub Pages deploy was retired — see "Retire the old GitHub Pages
  deploy pipeline — ✅ DONE" near the end of this file; GitHub Actions now only runs the
  build status check, it doesn't publish.)
- **Per-branch preview URLs** (seeing an unmerged branch live without merging to `main`)
  are a separate, optional Cloudflare concern — not required to build or to see both
  workspaces. (Don't conflate this with PR status checks, which are a separate GitHub
  Actions concern.)
- End commit messages with the session link the harness provides. Don't include the
  model identifier in commits/PRs/code.

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
- **Shared SELECTION layer (B585/B586; in-code labels read the provisional B569/B570).** On top of the engine sits one shared selection model:
  `shared/markup/selection.js` (pure — `pickInMarquee` crossing/window box-test, `nextSelection`
  with Ctrl/⌘=toggle · Shift=add · plain=replace, `cornerGrips`) + `shared/markup/SelectionChrome.jsx`
  (the ONE neutral hue-free chrome — light casing under a dark line + grips, tokens `--sel-casing`/
  `--sel-line`). Both workspaces consume it for multi-select (Ctrl/⌘ + Shift-click), the **Marquee**
  rail tool (a `mode` row in `tools.matrix.js`, `data-testid="tool-marquee"`), multi-move, and
  multi-delete. Selection STATE/wiring stays per-host (different coordinate spaces); only the
  logic/visual is shared. Site Planner covers els+markups+measures; **parcels keep their merge
  interaction** (the one sanctioned divergence). Single-select keeps its resize/rotate handles.

## KEY DECISIONS (must persist)
- **Theming: light / dark / system + the text-hierarchy rule (owner rule, 2026-06-21).** The app
  has three themes — **Light / Dark / System** — driven by `data-theme` on `<html>` + CSS tokens
  in `src/index.css`, mirrored to JS for the SVG canvas in `src/shared/theme/palette.js` (var()
  can't be used in SVG attributes / canvas export — keep the two in sync). **Chrome themes WITH
  the app** (light theme = light chrome) — never a permanently-dark bar over a light app (the
  constant pupil readjustment is the worst case for eye strain). **Build text hierarchy through
  weight, size, and uppercase letter-spacing — NEVER by fading text toward the background.**
  Low-contrast gray body/label text is **disallowed** (eye strain in bright offices); subtle grays
  are correct ONLY for borders, the drafting grid, and the semantic "Complete" status badge. New UI
  must reference **theme tokens, never raw hex**, and clear **WCAG AA (≥ 4.5:1)** for body text on
  its surface in **both** themes. This is now **machine-enforced**: `ui-audit/contrast-audit.mjs`
  (parses the real `index.css`) + `test/contrast.test.js` fail CI if any defined token pair drops
  below its floor — so a palette edit can't silently re-introduce a low-contrast pair. Text/icon ON
  the global accent fill uses **`--on-accent`** (white in light, near-black in dark — the dark accent
  is too light for white); saving/unsaved/offline labels use **`--warn-text`** (AA amber). The common
  trap (the B341 regression): a chrome-region component that **hardcodes a color instead of a token**
  reads fine until the chrome flips theme — always repoint to tokens. **The Light/Dark/System picker
  lives in the row-1 Settings gear (⚙) popover** (`AppHeader`), reachable signed-out; the "System"
  live OS listener is in `ThemeProvider`, independent of where the control mounts. (B316–B320, B341, B342)
- **Project-status palette + map markers (owner rules, B433/B434; the single source is
  `src/shared/ui/statusTokens.js`, mirrored to the `--status-*` CSS vars in `index.css`).** Three
  standing rules govern how a deal stage looks, everywhere (map pins, left-rail chips, list markers,
  section headers, the status menu):
  1. **Map markers are always solid-filled with a white keyline — never a transparent/hollow primary
     marker on the aerial** (a thin hollow ring vanishes over green imagery). The zoomed-out marker is
     the **precision pin** (`sitePinIcon`, B434): a color **bulb** on a short **stalk** seated over a
     **ground ring**, the ring center being the anchor (it sits exactly on the site coordinate). Progress
     (derived from status until a real `progress_pct` lands — B161/B163) folds into the ground-ring
     **sweep** (pursuit 10 · active 60 · onhold 30 · complete 100 · dead 0).
  2. **Status salience is MONOTONIC, Pursuit loudest → Dead quietest** — size + opacity track importance;
     settled stages (Complete, Dead) are smaller + dimmed. Never invert this.
  3. **RED is reserved for genuine alert/error** (the `--danger` CSS token — cloud-off badge, a failed
     layer dot, a destructive ×), **never an inert state.** Dead is therefore neutral **gray** (✕ +
     strike), the same gray as Complete (distinguished by glyph + strike, not hue). Active is **blue**
     (not green — green blends into green imagery and coral+green is the red-green-colorblind confusion
     pair); Pursuit is **coral**. Pursuit/Active are glyphless solid discs; the colorblind-safe glyph
     (‖/✓/✕) rides only on the settled stages.
- **No dialog-box edits — inline editors only (owner rule, 2026-06-17).** NEVER edit a value
  with `window.prompt`/`confirm`/`alert` (owner: "that is horrible UI"). Editing a number/text
  on the canvas must use an **inline editor in place** — e.g. the shared `numEdit` inline
  `<input>` overlay in `SitePlanner.jsx` (road width, per-edge setback, overlay trace length) or
  the callout `foreignObject` `<textarea>`. Commit on Enter / click-away, cancel on Esc. Applies
  to any new editing affordance.
- **Brand spelling — Planyr (P-L-A-N-Y-R).** Human-readable text → **Planyr** (capital
  P); package name + technical identifiers → lowercase `planyr`. Michael often
  says/dictates "Planner" (or "Planner Fit") — read these as the brand **Planyr** (and
  the old name **Planar_Fit**), not the literal word "planner." Don't reintroduce a
  "Planner"/"Planar" spelling for the brand.
- **Module naming — the Document Review workspace is user-facing "Review" (owner rule, B418, 2026-06-23).**
  The canonical **user-facing** name for this module is **"Review"** — the row-2 tab, the loader caption, the
  empty-state heading, and the error-boundary label all say "Review". The **internal id stays `doc-review`**,
  the folder is `src/workspaces/doc-review/`, the route is `/markup`, and the data-model field is `markups` —
  none of those change (renaming them would orphan routes/storage). The module accent token is
  **`--accent-review`** (JS mirror `accentReview`), amber **#EF9F27** (B419). Historical names **"Markup"**
  and **"Document Review"** mean this same Review module — don't treat them as separate features.
  Distinct from this: the Site Planner's **"Markup line/rect"** drawing tools are their own thing — leave
  their labels alone.
  - **⚠ UPDATE (B496, 2026-06-27): "Library" is now its OWN top-level workspace, NOT the Review module.**
    The file browser (`FileBrowser`, was Review's landing screen) was lifted into a dedicated **Library** tab
    (`src/workspaces/library/`, internal id `library`, route `#/library`, teal accent `--accent-library`
    **#0E7490** / JS `accentLibrary`). Review is now purely "open one drawing + mark it up" — with nothing
    open it shows a "No drawing open" empty state with a **Browse the Library** button. Clicking a file in
    Library opens it in Review via the existing Shell `onOpenReviewInDocReview` intent. The file-storage
    **data layer (`reviewStore`/`autofiling`/`fileIndex`) stays in `doc-review/lib`** (project-scoped,
    canvas-independent) and Library imports it cross-workspace — no new backend/tables/keys. So pre-B496
    text below that calls `FileBrowser` "the Document Review landing surface" now means the **Library**
    tab. **(B542 update:)** the Site Planner's old slide-over `ProjectFilesDrawer` + its row-1
    **🗂 Files** button were **removed as redundant** once the Library tab shipped — `ProjectFilesDrawer.jsx`
    is deleted and the Library tab is the one and only file browser now.
- **Private by default.** Any future sharing or shared workspaces default to private;
  sharing is always a deliberate, explicit act — never automatic.
- **No admin / cross-user data access.** Deliberately omitted, for customer trust and
  liability. Do not add a "god-mode" admin view.
- **Secrets stay in env/secrets, never committed.** Covers Supabase keys, the Autodesk
  APS key, and Google Drive credentials. The Supabase **anon key is RLS-protected and
  safe to ship in the client**; the Supabase **service_role key and all third-party
  API keys must stay server-side only** and never reach the browser.
- **Logged-in users' data lives in the cloud.**
- **Monorepo, one repo, folder per workspace.** The `/server` folder's secrets and
  deploy pipeline are walled off from the public GitHub Pages deploy, so no
  credential can ride along to a live URL.
- **DWG handling (Document Review):** Michael normally receives DWG (and PDF) and will
  not ask consultants for DXF. The tool auto-converts DWG → DXF on the backend. Start
  with free **LibreDWG** + a hard-failure fallback to **Autodesk APS Model Derivative**
  (~$0.30/file, pay-as-you-go). Optional later verification layer (proxy-object
  pre-screen, header/extents sanity checks, embedded-preview diff) decides when to
  pay. Reserve **ODA** (~$6k first yr / $3.6k/yr) or **Apryse** (~$10k+/yr) only for
  high volume or to keep files off third-party clouds. (Pricing mid-2026 — re-verify.)
- **Auto-filing never auto-guesses.** Files matched confidently to one of the 4 named
  projects (via title block + aliases) are auto-routed and auto-named; no-match /
  multi-match / low-confidence files go to a "needs filing" holding area with
  one-click confirm. A misfiled drawing is worse than an unfiled one.

## DEFERRED (with reasons — waiting creates no rework debt)
- Per-site sharing, shared team workspaces, and a possible commercial/SaaS direction.
  The selling question reshapes the sharing/workspace model, so design these together
  if/when selling becomes real.
- Planner single-reducer rewrite (state-management refactor) — deliberately deferred.
- AI corridor scan — parked.
- **Rebrand the `planarfit:*` localStorage keys → `planyr:*`** (leftover from the
  Planar_Fit→Planyr rename). Deferred because these are client-side storage keys:
  renaming them in code without a migration would orphan every existing user's saved
  sites/settings. Do it with a one-time read-old → write-new migration so nothing is lost.

## ROADMAP / NOT YET BUILT
Two parallel tracks now.

### Track 1 — Site Planner (continue maturing)
1. **GIS layer caching** — next immediate item. Stale-while-revalidate: load
   last-known-good copy instantly, refresh in background, always show data age,
   screening-only. Makes layers fast and resilient.
2. Tier 1 "site-killer" features: storm outfall, then sanitary sewer, fire flow,
   finished-floor-vs-base-flood, environmental screen (TCEQ LPST / EPA),
   entitlement/zoning status.
3. Tier 2: earthwork / cut-fill, soils.
4. Tier 3: swept-path, driveway access.
5. Tier 4: the buildable-area / cost verdict engine (reads the whole Site Model via
   `developableArea()`, currently a stub).

### Track 2 — Document Review (new module)
Build the **browser-only** tranche first (no backend, no credentials), then the
**backend** tranche.
- **Browser-only:** PDF review core (PDF.js viewer, multi-sheet nav, calibrate-to-
  scale, measure tools — distance/area/perimeter/count, basic redline, takeoff rollup
  into the yield panel) → semi-automatic match-line stitching → metes-and-bounds →
  polygon (parse calls incl. curves; flag unreadable calls; require one tie to the
  ground for the Point of Beginning).
- **Cloud persistence (DONE):** the browser-only tranche now saves/loads its reviews
  (single sheet + stitched sets, with their PDFs) to the **existing Supabase** backend
  — see DONE & VERIFIED. This reuses the user-data backend (Supabase), NOT the
  `/server` CAD/filing backend below; keep the two distinct.
- **Backend tranche** (needs `/server`; distinct from the existing Supabase backend):
  auto-filing + index → DWG conversion pipeline (LibreDWG → APS) → overlay & version
  compare → markup-list and flattened marked-up PDF export.
- **Auto-filing detail:** drop a file → read its title block → match against the 4
  named projects (+ aliases: address, parcel, job number) → auto-route and auto-name
  into a central drive (likely Google Drive). A lightweight index/database stores
  facts per file (project, discipline, sheet, revision, date) so files are queryable
  without re-reading them.

### Document Review — roadmap additions
- Drag-and-drop to open: drop PDF/drawing files onto the screen to load them for
  viewing (browser-only, low effort). NOTE: distinct from the auto-filing system
  (drop → read title block → file into Drive), which is the backend feature already
  on the roadmap. Two different things, two timelines.
- Multi-sheet stitcher: assisted alignment (built — `Stitcher.jsx`, 2-point pairwise
  align); **automatic match-line detection — BUILT (B337)**: drop a set → it auto-groups
  (B335) + auto-stitches from match-line labels + auto-calibrates (B339) + crops title
  blocks (B338); the 2-point manual Align stays the safety net (pre-seeded when a seam is
  detected). **Scanned sheets read via OCR too (B349).** The remaining CV tails (scale-bar,
  geometric edge-match, legend symbol-union) → B340. Near-automatic once DWG conversion lands.
- Revision compare: add a revision to a discipline set and compare the two
  (overlay/diff) — confirm against the existing overlay/version-compare item.
- ★ North-star: "map → drawings → latest set" — from the Site Planner map, click a
  project → Drawings → pick a discipline (e.g., Landscaping) → see the latest
  revision's full set, already stitched. Depends on the filing system + file index,
  the stitcher (the **auto-group + auto-stitch** half is now built — B335–B339), and
  project nav on the map. The convergence point; build once those exist.

## KNOWN ISSUES
- Houston utilities ride on the City's `geogimstest` **TEST** host — works, but could
  change without notice.
- Storm-sewer service name still needs confirming once the COH services are up.
- GIS layer status: honest per-layer status + ~45s self-heal re-probe; at last note
  roughly 10 of 14 layers were live.

## Two backends — don't conflate
Two layers that talk **over the network** — one for **data**, one for **compute**. Never
conflate them.

1. **Supabase — the data / auth / storage layer (BUILT).** Cloud Postgres, email/password
   auth, row-level security, and cloud save/load of site data **and** Document Review state
   (the `doc_reviews` table + the `doc-review-files` Storage bucket, same anon client +
   private-by-default RLS). The **frontend talks to Supabase directly with the anon key** —
   which is safe to ship in the browser **because RLS protects it** (a request can only
   ever see/write the signed-in user's own rows). This is the **permanent home for user
   data**; little custom server code.
2. **The server-side compute/integration tier — two delivery shapes, DIFFERENT deploy status.**
   Don't lump them: the **Drive storage backend is LIVE on the edge**; the **heavy CAD/AI compute
   is built in-repo but not yet deployed** to Cloud Run.
   - **✅ LIVE & DEPLOYED — Google Drive storage (bytes I/O).** The storage backend
     (`server/storage/`, B206–B209 / B207) runs **IN the same-origin Cloudflare Pages Function**
     `functions/api/files.js` — Drive byte-I/O is light (multipart upload/download over `fetch`),
     so it needs no container, and same-origin means no CORS. It is the live home for Document
     Review source PDFs: `reviewStore.storeSource` files **Drive-first**, with Supabase Storage as
     the fallback. The Planyr-key↔Drive-file-id map persists in **Supabase Postgres**
     (`server/storage/db/drive_files.sql`, own-row RLS) so the stateless Function can't lose it;
     the queryable **file-facts index** also lives in Supabase (`doc-review/db/file_facts.sql`),
     not Drive. The one-time OAuth *consent* callback is a sibling Pages Function
     (`functions/api/auth/google/*`); `functions/api/drive/selftest.js` is a guarded round-trip
     smoke test. **Provisioned + owner-verified 2026-06-22 in Cloudflare Pages Production:**
     `GOOGLE_CLIENT_ID/SECRET/REFRESH_TOKEN` + `PLANYR_STORAGE_BACKEND=drive` + `SUPABASE_URL/ANON_KEY`.
     Drive **removes the Supabase 50 MB-per-file ceiling** on the happy path. **⛔ Do NOT re-mint
     `GOOGLE_REFRESH_TOKEN`** — a fresh consent no longer matches the deployed secret and would take
     Drive filing offline.
   - **⏳ Built in-repo, NOT yet deployed — Cloud Run.** Scale-to-zero containers (idle = free; a
     request spins one up) for work that genuinely needs a container or a server-only key:
     - **DWG→DXF conversion** — **LibreDWG** primary (free, native binary compiled into the
       container image), **Autodesk APS Model Derivative** fallback for hard LibreDWG failures
       (dormant behind `APS_ENABLED`, **off** until the APS account is provisioned; a LibreDWG
       failure with APS off returns an explicit error, never a silent success). Code:
       `server/convert/` (B238). LibreDWG needs a real container (native binary + filesystem) —
       exactly why this is Cloud Run and not a Pages Function.
     - **Tier-2 AI auto-filing title-block read** — `server/filing/` (B299): reads a dropped
       drawing's title block with the Claude API (key **server-side only**), matches it to a named
       project (**never auto-guesses**), returns a filing decision + placement facts. Dormant
       behind `ANTHROPIC_API_KEY` / `DOC_FILING_URL` / `VITE_AUTOFILE_ENABLED` (the not-yet-deployed
       proxy `functions/api/file.js` 503s → the drawer files manually, no regression). NOTE:
       **Tier-1 auto-filing (B312, plain code in the browser) is LIVE default-on** — this AI tier is
       only the scanned/image-only fallback.

   **All third-party secrets stay server-side only** — the APS key, the **Anthropic read key**
   (auto-filing), the **Google credentials** (Drive), and the Supabase **service-role** key. They live
   in the Cloudflare Pages env as **encrypted secrets read only by the server-side `functions/api/*`
   handlers** (or on Cloud Run) — **never inlined into the public browser bundle** (never a `VITE_`
   var). The only Supabase key that reaches the frontend is the RLS-protected **anon** key.

So the **data** backend (Supabase) and the **Drive storage** backend (the `functions/api/files.js`
Pages Function) are **LIVE**; the **Cloud Run** compute — DWG→DXF conversion + the Tier-2 AI filing
read — is built in-repo but **not yet deployed**. Keep the **data**, **storage**, and **heavy-compute**
layers distinct when reasoning about what exists.

---

# Technical reference (preserved implementation detail)
Deeper specifics behind the summaries above. Paths reflect the monorepo layout
(`src/workspaces/site-planner/…`).

## Playwright / ui-audit in the sandbox
All screenshot harnesses live in `ui-audit/` and target the Vite preview server on
`:4173` (`npm run build && npx vite preview`). One non-obvious sandbox quirk:

**Always pass `--ignore-certificate-errors` to Chromium.** The sandbox routes
outbound HTTPS through a TLS inspection proxy. Node.js trusts it (system cert store);
Chromium does not — every tile request fails with `ERR_CERT_AUTHORITY_INVALID` and
the basemap renders gray. The flag is already set in `capture.mjs` and
`verify-markers.mjs`. Add it to any new Playwright harness you write:
```js
chromium.launch({ executablePath: EXEC, args: ["--no-sandbox", "--ignore-certificate-errors"] })
```
The allowed-domain list (`*.arcgisonline.com`, etc.) is configured at the environment
level and works fine once Chromium trusts the proxy cert.

**`statusOf(site)` reads `site.status` (top level), not `site.data.status`.** When
seeding localStorage for verification, put `status: "active"` directly on the site
object. Sites loaded through `loadSitesList()` → `createSiteModel()` get the field
normalized automatically, but raw localStorage seeds bypass that path.

## Stack
Vite + React 18, plain JS/JSX, inline styles, the `PAL` drafting palette, terse
comments. Map = Leaflet + esri-leaflet. Planner canvas = hand-rolled SVG. **Units:
feet everywhere internal; convert only at the map boundary.**

## Site Model (`src/workspaces/site-planner/lib/siteModel.js`)
Canonical per-plan schema; read via selectors, persist via storage — never a parallel
store. `createSiteModel`, `SITE_MODEL_VERSION = 2`. Persisted fields stay flat +
back-compatible (no field renames), additive buckets:
```
{ schemaVersion, id, groupId, site, name, updatedAt,
  origin:{lat,lon}|null, county,
  parcels[], underlay, settings,
  els[],                         // drawn layout elements
  markups[],                     // flat: neutral annotations + semantic shapes
  measures[], callouts[],
  elevation:{ crossSections[] },
  constraints:{ liveLayers[] } } // RESERVED: per-site layer memory (not yet wired)
```
`els`/`markups` stay flat; **selectors classify by meaning:** `constraintsOf`
(easements = markup kind `encumbrance`; setbacks derived from parcels; liveLayers),
`utilitiesOf` (`utilRoute|traced|infwater`), `annotationsOf`
(line/rect/ellipse/polygon/polyline + measures + callouts), `crossSectionsOf`,
`setbacksOf`, `parcelsOf`, `elementsOf`, `developableArea` (**stub** for the future
synthesis). **Conformance:** add data as new model fields (additive), bump
`SITE_MODEL_VERSION`, extend `migrate`, expose via a selector.

`storage.js` is a thin layer over the model: `loadSite`/`loadSitesList` migrate on
read; `saveSite` merges the partial and re-normalizes via `createSiteModel` (additive,
lossless, idempotent).

## Map-layer system (`src/workspaces/site-planner/lib/layers.js` + `components/LayerPanel.jsx`)
One source of truth used across the planner. Layer `kind`s: `dynamic` (esri
`dynamicMapLayer` image — FEMA, NWI, TxRRC, jurisdiction utilities, COH hydrants),
`esriImage` (esri `imageMapLayer` — USGS 3DEP elevation/hillshade), `esriFeature`
(vector `featureLayer` — HIFLD transmission, non-interactive), `overpass` and
`mapillary` (live, view-driven vectors in `lib/evidenceLayers.js`).
- **Geographic planner:** a non-interactive Leaflet Web-Mercator basemap + shared
  overlays sit behind the transparent feet-based SVG, anchored to the site `origin`.
  Geometry/metrics stay in feet; `ppfToZoom` + canvas-centre→latlng lock the basemap.
  Feet↔deg uses the Mercator sphere base (**≈365223 ft/deg, both axes**) so drawn
  geometry overlays the aerial sub-pixel.
- **Health/diagnostics:** `probeService` parses the service JSON (HTTP 200 + `.error`
  = failed) and surfaces the server message; per-layer status dots
  (loading/loaded/empty/failed); no zero-size export; `fetchWithRetry` + tile retry
  with backoff; ~45s self-heal re-probe.
- **Houston COH utilities** (`counties.js` JURISDICTION_LAYERS.harris): host
  `geogimstest.houstontx.gov/arcgis/rest` (folders `HW/Water_gx`, `HW/WasteWater_gx`,
  `TDO/UN_Stormwater`) — the only CORS-clean host. Sublayers pinned via `layers:`
  (water `0,1`; wastewater `2,6`; storm `22,23,24,904`) or defaults render meters,
  not mains. Trunk lines scale-gated to ~≥1:40k; coverage is City-of-Houston-only.
- **Site-engineering tools** (planner Layers control → Evidence tools): electric &
  water service routing (`buildUtilRoute`), pond detention calculator
  (`detentionStorage`, 3:1 taper, prismoidal volume), editable easement-rule table
  (`lib/easementRules.js`, VERIFY placeholders), ditch cross-section
  (`lib/elevation.js`, 3DEP `getSamples`) feeding `el.det.availDepth`. All elevation
  output labeled "screening only — verify with survey."
- **Mapillary token is a secret** — `import.meta.env.VITE_MAPILLARY_TOKEN` (CI secret)
  or a user-entered localStorage value. Never commit it.
- **Print/PNG caveat:** the SVG clone can't capture live Leaflet basemap/overlay
  tiles (cross-origin canvas). With the basemap off, the captured screenshot underlay
  still prints.

## Supabase (`src/workspaces/site-planner/lib/supabase.js`, `auth.js`, `cloudSync.js`)
Config from build-time env only (`VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`;
gitignored, Actions secrets — see build.yml). Connection test hits `/auth/v1/health`
with the apikey (the PostgREST root is secret-key-only under the new key model — a
publishable/anon key correctly 401s there). Auth = email+password via `auth.js` +
`components/AuthPanel.jsx`. Phase 4: logged in → per-user local cache
(`planarfit:sites:cloud:<uid>`) pulled on login + writes mirror to the `sites` table;
logged out → legacy `planarfit:sites:v1`. Save badge reflects the real cloud write.
No migration of legacy sites (recreate manually).

**Supabase org/project naming convention (resolved — closes the "Planar vs Planyr" confusion; B407).**
ONE app, so the **org carries the brand** and **projects are named by environment** (deployment-
lifecycle stage), never by feature — this keeps the set readable as the commercial/VC direction adds
environments and avoids the redundant "Planyr / Planyr" nesting:
- **Organization = `Planyr`.**
- **Live (production) project = `planyr-production`**, AWS `us-east-1` — serves planyr.io; its
  dashboard label was the old "Site Planar" until the owner renamed it to this convention (2026-06-23).
- **`planyr-staging` reserved** for a future second-environment project (not yet created).

**Renaming a Supabase org/project display label is COSMETIC — no rebuild, nothing breaks** (the safety
fact that pairs with the build-time-env gotcha above). The connection is bound to the **immutable
20-char project ref** baked into `VITE_SUPABASE_URL` (`https://<ref>.supabase.co`) and the **anon
key** — renaming the org or project changes **neither the ref, the URL, nor the key**, so cloud
save/load/auth keep working with **no redeploy**. Only creating a *different* project (a new ref) or
rotating keys would force a rebuild of the build-time env.

**⚠ There are TWO live Supabase projects, not one — match the `ref` before renaming/deleting ANYTHING.**
The suite currently spans two *separate* Supabase projects (different immutable refs), so "the spare
Planar project" is almost certainly NOT spare:
- **Main app (Site Planner + Document Review)** → ref **`lyeqzkuiwngunutlkkmi`**, set via the Cloudflare
  `VITE_SUPABASE_URL` build env (tables `public.sites`, `public.doc_reviews`, `public.profiles`, …).
- **Scheduler (the embedded `/sequence/` app)** → a DIFFERENT ref **`ksetjztkplttbcehyicv`**,
  **hardcoded** in `public/sequence/index.html` (its own anon key; tables `planar_data` /
  `planar_history` / `planar_suggestions`).

So the second dashboard project ("Planar", AWS `us-west-2`) is most likely the **Scheduler's live
backend — its data is the schedule history, not a leftover.** **Owner-action checklist (do NOT delete
on assumption):** in Supabase → each project's **Project Settings → API / project URL**, read its 20-char
ref and match against BOTH refs above. A project matching **either** ref is LIVE → rename it for what it
*is* (the Scheduler's is **not** `planyr-staging`; name it e.g. `planyr-scheduler`), **never delete it**.
Only a project matching **neither** ref is genuinely unused (then repurpose as `planyr-staging` or
delete). Renaming stays cosmetic/safe (above); **deleting a live project is irreversible data loss.**

**Open architectural question (not yet decided):** the Scheduler riding its OWN Supabase project,
separate from the main app, predates the one-product direction. Whether to consolidate it onto the main
project (one backend) or keep it split and just name them per-component is a future decision — recorded
here so the two-project reality isn't mistaken for a stray duplicate to be cleaned up.

**Table schema** (one row per plan; `data` jsonb = serialized Site Model):
```sql
create table public.sites (
  id text not null, user_id uuid not null default auth.uid() references auth.users(id),
  group_id text, site text, name text, county text,
  updated_at timestamptz not null default now(), data jsonb not null,
  primary key (id) );
  -- NOTE: live PK is single-column (id) — verified against planyr-production 2026-06-23.
  -- The table was CREATED with primary key (user_id, id); db/team_sharing.sql later changed
  -- it to (id) so one row exists per project regardless of which teammate edits it. user_id
  -- is KEPT as the creator/owner column and is the RLS predicate (never part of the PK now).
  -- Upserts must therefore target onConflict "id" (with a "user_id,id" fallback only for a
  -- not-yet-migrated DB) — never "user_id,id" alone, which 42P10s on the live schema.
```
**RLS (private-by-default; applied in the dashboard):**
```sql
alter table public.sites enable row level security;
create policy "Users select own sites" on public.sites for select to authenticated using ((select auth.uid()) = user_id);
create policy "Users insert own sites" on public.sites for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "Users update own sites" on public.sites for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "Users delete own sites" on public.sites for delete to authenticated using ((select auth.uid()) = user_id);
```
No anon policy, no admin/cross-user policy (deferred by decision).

**User profiles (`lib/profile.js`, `shared/profile/useProfile.js`, `db/profiles.sql`; B297/B298).**
Names captured at signup live in a queryable `public.profiles` table (one row per
`auth.uid()`) — NOT just auth `user_metadata` — so they're the scalable foundation for the
B2B direction (org/role/prefs later). `signUp` still seeds `options.data` (first/last/org);
a **`handle_new_user` SECURITY DEFINER trigger** on `auth.users insert` copies those into
`profiles` (trigger route avoids the client follow-up-insert race), and a one-time backfill
seeds rows for pre-existing users. RLS is the same own-row private-by-default shape as
`public.sites` (`auth.uid() = id`; select/insert/update; no delete — `on delete cascade`).
`profile.js` = pure I/O (`loadProfile`/`saveProfile`, reuses the anon client + session, no
new keys); `useProfile(user)` = the hook → `{ profile, loading, displayName, firstName, org,
initial, reload, save }` with a never-blank display chain (First Last → first → last →
metadata → email; pure `displayNameFor`/`firstNameFor`/`initialFor`, unit-tested). The Shell
pill reads it and opens an account dropdown (`AnchoredMenu` portal); `AuthPanel` is a tabbed
Profile/Settings panel (Profile edits name/org → `profiles`; Settings hosts Change password,
reusing `updatePassword`). Run `db/profiles.sql` once in the SQL editor (idempotent).
```sql
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  first_name text, last_name text, org text,
  updated_at timestamptz not null default now() );
-- RLS: 3 own-row policies (select/insert/update) keyed on auth.uid() = id.
-- Trigger handle_new_user() inserts the row from raw_user_meta_data on signup; + backfill.
```

## Document Review persistence (`src/workspaces/doc-review/lib/reviewStore.js`, `usePersistence.js`)
Reuses the SAME Supabase client/session (imports `site-planner/lib/supabase.js` +
`auth.js`); no second client/keys. A "review" is `kind:'single'|'stitch'`; the work
layer (markups, calibration, stitch transforms, measures, takeoff, source-file refs)
is the `data` jsonb, with source PDFs in the private `doc-review-files` bucket at
`<uid>/<reviewId>/<srcId>.pdf`. `reviewStore.js` = I/O (upsert/load/list/delete +
upload/download + the localStorage mirror); `usePersistence.js` = the data-loss hook
(debounced first-edit save, honest badge, synchronous mirror + beforeunload/visibility/
unmount flush). 50 MB+ files skip Storage (`oversize`), flagged "re-drop on load"; the
work layer still saves. Reload re-fetches PDFs and re-applies transforms/markups. Full
migration (table + RLS + bucket + Storage policies) in `doc-review/db/doc_reviews.sql`.
```sql
create table public.doc_reviews (
  id text not null, user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  title text, kind text, project text, discipline text,
  updated_at timestamptz not null default now(), data jsonb not null,
  primary key (id) );
-- NOTE: live PK is single-column (id) — same story as public.sites: CREATEd with
-- primary key (user_id, id), migrated to (id) by db/team_sharing.sql (verified against
-- planyr-production 2026-06-23). user_id stays the owner column + RLS predicate; upserts
-- target onConflict "id" (with a "user_id,id" fallback only for a not-yet-migrated DB).
-- RLS: same 4 own-rows policies as public.sites (private by default).
-- Storage bucket 'doc-review-files' (private, 50 MB cap): 4 own-folder policies on
-- storage.objects keyed by (storage.foldername(name))[1] = auth.uid()::text.
```
**Project library (B14):** `reviewStore.js` also has `listProjects` (Site groups +
status from `sites`), `setProjectStatus` (writes back via the Site Planner's
`cloudUpsert`), and `fileNewReview` (drag-drop filing); `components/ProjectLibrary.jsx`
is the explorer drawer; `components/ReviewsBar.jsx` does the project/discipline/item/
revision/date filing UI + the `"<Project> - <Item> - YYYY.MM.DD"` default name. Index
columns `project_id/item/revision/doc_date` + object paths `<uid>/project-<id>/
<discipline>/<srcId>.pdf` come from `doc-review/db/project_library.sql` (additive;
`upsert`/`list` degrade to the core columns until it's run). Lifecycle status is reused
from the Site Model, never duplicated.

## Counties / GIS plumbing
`lib/counties.js` — county presets (Harris/Fort Bend/Chambers) + `JURISDICTION_LAYERS`
+ State Plane EPSG:2278. `lib/arcgis.js` — ArcGIS REST client, `feetToLatLng` /
`lngLatRingToFeet` (FT_PER_DEG_LAT = 365223, Mercator-sphere base), aerial export.
County/city GIS hosts move and stop often — rely on the probe + honest error
surfacing, never hardcode-and-assume.

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
