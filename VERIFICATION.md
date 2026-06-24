# VERIFICATION.md — live-browser test checklist

Some changes pass every check we can run **without a browser** — `npm run lint`,
`npm test`, `npm run build`, and server-side endpoint calibration — but still need a
human (or a Claude coworker with a real browser) to confirm they actually work **in the
running app**. This file is the running list of those, so nothing that "builds green but
was never clicked" quietly ships broken.

> **Production app:** https://planyr.io (Cloudflare Pages, deploys from `main`).
> **This is the runtime counterpart to `BACKLOG.md`.** An item can be `[x]` done in the
> backlog and still ⏳ unverified here — the code landed; the click-through hasn't.

> ## ⚠️ Testing policy (updated 2026-06-17 — read this)
> **Michael does NOT click through to test things himself. Ever.** Don't wait on him, don't ask
> him to verify, don't end a turn expecting him to go look.
> **Claude self-verifies in a headless browser — in the same session, no separate "cohort."**
> A headless Chromium is available in the environment (see "🤖 Self-verification" below), so a
> session that ships a UI change should **drive the live app itself** and record the result rather
> than file the click-through for someone else. The working rhythm:
> - After a change is **CI-green + build-green**, **run the headless-browser check yourself**, then
>   record the outcome here (✅/❌ + date). Don't punt it.
> - **Only if no browser is reachable** (rare), log the item below and move on — never block on Michael.
> - **Do NOT surface "these N are unverified" to Michael as a to-do for him.**
> - **Only interrupt Michael for a genuinely CRITICAL problem** — the app won't build, won't render
>   (blank screen), or a shipped feature is visibly crashing in production. Everything else: note it
>   here, keep moving.
>
> ### 🤖 Self-verification — how (proven 2026-06-17 against planyr.io + per-branch preview URLs)
> Write a short Playwright script and run it with Node:
> - Browsers live at `PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers`; the module is the global
>   `/opt/node22/lib/node_modules/playwright` (require it by absolute path).
> - The sandbox egress proxy intercepts TLS, so launch with `args:['--ignore-certificate-errors']`
>   **and** `newContext({ ignoreHTTPSErrors: true })`, or `page.goto` throws `ERR_CERT_AUTHORITY_INVALID`.
> - **Logged-out only:** that proxy also CORS-blocks the Supabase auth handshake, so self-tests run in
>   **this-device (logged-out) mode** — full coverage for the planner/drawing tools, but anything that
>   *requires* sign-in (cloud save/sync) still needs a signed-in check elsewhere.
> - Enter the planner via **"Start blank"**; drive the SVG canvas with `page.mouse` (CDP mouse events
>   fire React's pointer handlers); `page.screenshot({clip})` then read the PNG back to eyeball it.

---

## How to use this — Claude Code / coworkers, read on every run

1. **Scan the 🔲 list below** — items waiting to be confirmed in the running app. Per the testing
   policy above, do **not** hand this list to Michael as his to-do; only escalate a **critical**
   (won't build / won't render / crashing) issue.
2. **Verify it yourself in a headless browser** (see "🤖 Self-verification" above): run the
   **Steps**, compare to **Expect**, then record the outcome — flip ⏳→✅ (or ❌ with a note),
   set `Last checked`, and bump `Next check` by the `Cadence`. Prefer doing this in the same session
   that shipped the change.
3. **Only if no browser is reachable:** leave the item logged here and move on — don't block on
   Michael. Do **not** mark anything ✅ from reading the code — confirming-in-the-running-app is the
   entire point of this file.
4. **Endpoint-liveness items (tagged 🌐) are the exception** — a `curl`/REST probe, runnable
   without a browser. Run those when due.
5. Keep it honest: a ❌ stays ❌ with the date and what broke until it's re-fixed and re-run.

`CLAUDE.md` points every session here, so this list is consulted automatically.

---

## 🔲 Needs verification
### V131 — B409: large files (>~100 MB) upload to Drive via the browser-direct resumable path ⏳ (code shipped + unit-tested; needs ONE signed-in ≥100 MB Drive round-trip)
- **Added** 2026-06-24 · **Cadence** once (bug-fix + deploy acceptance) · **Last checked** — · **Next check** — the signed-in steps below, on planyr.io. **Claude cohort / a signed-in human, never a logged-out sandbox.**
- **What changed.** A >50 MB PDF used to flag "over the 50 MB … couldn't be stored online" and write no Drive row (its bytes fell back to Supabase and were rejected). Now files >50 MB take a **browser-direct resumable** path: `reviewStore.uploadLargeToDrive()` inits a Drive resumable session (Pages Function `functions/api/files/resumable.js`), **PUTs the bytes straight to Google** (never through the Worker, so neither the ~100 MB request-body limit nor the 128 MB memory cap applies — multi-GB works), then commits the Planyr-key↔Drive-id map. ≤50 MB is untouched (proven multipart path); a new `too-large` source state replaces the legacy "oversize" wording; re-dropping a previously-oversize file re-stores it in place (same srcId → markups stay attached).
- **✅ Already proven without sign-in.** +9 unit tests (resumable request shapes incl. the cross-origin `Origin` binding; the `too-large` state/copy/warn); `selftest.js` gained a resumable round-trip step (`?mb=N`) so the transport can't silently regress on the deploy. lint 0 · build green.
- **⏳ The one live confirm owed (signed-in — the sandbox can't sign in OR reach Google Drive, exactly like V117/V118).** On planyr.io, signed in: drop a **≥100 MB** PDF (e.g. the owner's "GPL - Civil IFP 2026.06.19.pdf", ~125 MB) into a Document Review project. **Expect:** it uploads to Drive (the browser→Google cross-origin resumable PUT succeeds), a `drive_files` row is written, the file lands in the `project-<id>/<discipline>` tree, and there is **no** "couldn't be stored online" banner. Then reload and confirm the file re-opens from Drive. **If it fails:** capture the browser console + network tab on the PUT (a CORS/Origin rejection is the most likely live-only failure) and log ❌ here.

### V130 — B411(a) + B411(c): OCR scanned sheets in filing + big-combined-set split ⏳ (OCR wiring + date fix unit-tested; needs a signed-in pass on REAL compressed scans / big sets)
- **Added** 2026-06-24 · **Cadence** once (feature/bug acceptance) · **Last checked** — · **Next check** — the signed-in steps below, on planyr.io. **Claude cohort / a signed-in human, never Michael.**
- **What changed.** (a) The free local filing read now **OCRs image-only pages** (`localRead.localTitleBlockRead` reusing the Stitcher's B352 Tesseract runner) so a scanned drawing classifies instead of dropping to the holding tray — best-effort, capped at 24 pages, a page OCR can't read stays no-text (worst case = today's holding tray, never a misfile). (b) The date picker now prefers the **issue/revision** date (next to IFC/IFP/ISSUED/REV) over a base "DATE" — fully unit-tested, no live check needed. (c) Big combined sets (GPL Civil 125 MB, Jacintoport MEP 13.6 MB, full Mesa COH) couldn't be pulled in-session (Drive connector caps at 10 MB).
- **✅ Already proven without sign-in.** +13 unit tests (6 OCR-fallback wiring incl. whole-scan / mixed set / empty-OCR / thrown-seam graceful-degrade / disabled; 7 issueDate). lint 0 · 1435 tests · build green. The OCR runner itself is already LIVE + proven in the Stitcher (B352).
- **⏳ The live confirm owed (signed-in — needs the owner's REAL compressed scans + Drive; the sandbox can't run Tesseract on real files OR pull big Drive files).** On planyr.io, signed in: (1) drop a **scanned/image-only** drawing (e.g. "2023.11.06 Mesa - Electrical B1.pdf") and confirm it now **auto-files** (project + discipline + the right issue date) instead of landing in the holding tray — i.e. Tesseract reads the real compressed scan well enough to classify. (2) Drop a **big combined multi-discipline set** and confirm it splits into separate per-discipline PDFs AND that scanned pages within it file via the new OCR path. **If OCR can't read a given scan:** that's not a regression (it still goes to the holding tray) — note which file + what the title block looks like so the reader can be tuned. **Coupled with B413's blocker #1** (same Tesseract-on-compressed-scans reliability question).

<!-- V128 (B438 browser-side GIS imagery service worker) was SUPERSEDED by V129/B439 — the
     browser SW was retired in favour of the server-side Drive-backed cache. No production check
     needed for the SW itself — B438 HAD shipped (PR #326), so gis-sw.js is now a
     self-unregistering tombstone that removes the deployed worker on next navigation. -->
### V129 — B439: GIS imagery cache, server-side (Drive-backed) ✅ VERIFIED LIVE on planyr.io (backend end-to-end); ⏳ only an in-app visual glance remains
- **What changed.** Raster (export-image) layers now route through a same-origin Cloudflare Function `/api/gis-cache/*` that fetches the agency server-side, keeps a durable copy in Google Drive, serves it instantly (survives outage), refreshes in the background (SWR), and **fails open** (302 → agency). Client one-shot falls back to the direct agency URL if the proxy isn't serving, so a layer always renders. Age via the proxy `?meta=1` sidecar → existing onStatus `{ts,stale}` panel badge. Browser SW (B438) retired. Default on; `VITE_GIS_PROXY=0` kill switch.
- **Verified (sandbox/Node).** Pure core `gisProxyCore.test.js` (15) + handler `gisCacheHandler.test.js` (12, in-memory Drive + fake fetch + clock): cache miss→fetch+serve+store, hit-fresh→serve-without-refetch, hit-stale→serve+background-refresh, fail-open 302 (no creds / agency error / unreachable), meta age, origin/host guards. The route imports cleanly in Node. Full suite 1417 · lint 0 · build green.
- **Live bring-up finding (2026-06-24) + FIX.** The Function deploys + responds on both the branch preview and production (curl `…/api/gis-cache/svc/<b64>?…&meta=1` → `{"cached":false}` 200; host allow-list accepts FEMA). But the first cut **failed open on every request** (302 → agency, nothing cached). Root cause, isolated with a temporary `?diag=1` probe on the preview: **`hazards.fema.gov` returns 403 to Cloudflare's default server-side User-Agent but 200 to a browser-like UA** (`defStatus:403` vs `uaStatus:200, image/png`). Fix: every upstream fetch (miss-path serve, background refresh) now sends a browser `User-Agent` (`UPSTREAM_HEADERS`); regression-tested (`gisCacheHandler` UA test, 28 total). The gov-host-blocks-datacenter-IP fear was disproven — it's purely the UA.
- **✅ VERIFIED LIVE on production (2026-06-24, post #329).** Direct curl against `planyr.io` after the UA fix deployed: a real FEMA export request returned **HTTP 200 `image/png`** (not a 302 fail-open), and the follow-up `…&meta=1` returned **`{"cached":true,"ts":1782323572872,"ageMs":6792,"stale":false}`** — proving the whole chain end-to-end: server-side fetch (UA fix) → **store in Google Drive** → serve from the durable copy → age tracking. The cache genuinely fills + serves on production.
- **Why still ⏳ (narrowed to a visual glance).** The backend is proven; the one thing curl can't show is the **in-app render** — that esri-leaflet, pointed at the proxy, paints the layer and the panel shows the "as of …" age. Owner glance on `planyr.io`: turn on FEMA/wetlands, confirm the layer paints + the age label appears; (optional) block the agency host in devtools → the last-good copy still shows. The client path has a unit-tested one-shot fallback to the direct agency URL, so worst case is today's behavior, never a broken layer. Cadence: once. Last checked: backend VERIFIED LIVE; in-app visual pending owner glance.
### V127 — B432 + e2e loop hardening: matrix↔schema conformance + per-tool rail + live CI green ✅ VERIFIED LIVE (CI run 28100509947, ~1 min, green; @claude issue #323 auto-closed)
- **What changed.** `e2e/markup-tools.spec.js` Section A: pure-JS conformance loop — for every doc-workspace tool (non-mode), asserts `schemaForMarkup({kind})` keys match the matrix row's `properties[]`. Section B: per-tool `getByTestId("tool-<id>")` + `aria-pressed="true"` assertions; gracefully skips when the rail isn't visible. Loop driver in CLAUDE.md. **Plus the B280-live hardening this session:** (1) sign in ONCE via `storageState` (`auth.setup.js`) + CI workers 1→4 — **31 min → ~1 min**; (2) signIn submits via **Enter** (the form has two "Sign in" buttons + the `auth-submit` testid isn't on the live build — Enter is deploy-independent); (3) `openModule` retries through a transient post-sign-in overlay; (4) `the Review workspace mounts` falls back to the tab-current signal when `doc-review-root` isn't deployed yet; (5) the e2e **job now fails honestly** on a red suite (was masked green by `set +e`).
- **Verified.** Live CI run **28100509947** against planyr.io: **green in ~1 min**, and the auto-`@claude` issue (#323) was **auto-closed** by the green run — proving the close-on-green path (i.e. a real pass, not masked). Local logged-out: lint 0, 22 passed + 22 skipped.
- **B436 update — per-tool ARM now executes for real (CI run 28102406142, green ~45s).** The fixture-PDF load landed, so Section B opens a drawing and **every deployed tool genuinely arms** against production (arc/dimension/pen/highlight/eraser/snapshot/count/… all `aria-pressed=true` ✓; 39 passed). Two notes: (a) the cold first wave was **flaky** (rail render >30 s under 4-worker PDF.js cold start) → bumped the per-tool group timeout to 60 s + rail wait to 45 s; (b) **`callout` is the one tool that skips** — it's in the matrix for `doc` but missing from the Review rail (real drift the loop caught) → filed **B437**. Cadence: once per engine change. Last checked: 2026-06-24, live green (per-tool arm verified).

### V126 — B431: vertex drag handles, Shift snap, ParcelDrawing inline calibrate ✅ build + lint + 1390 tests green; ⏳ signed-in round-trip
- **What changed.** (1) DocReview: vertex grip circles render at each vertex of the selected markup; dragging a grip moves only that vertex. (2) Holding Shift while drawing with a two-point tool (Line, Rect, Ellipse, Dimension, Calibrate) snaps the endpoint to the nearest 45°. (3) ParcelDrawing's `window.prompt("Length of this line in feet…")` replaced with an inline `numEdit` box positioned at the scale-line's midpoint.
- **Why ⏳.** Vertex handles + Shift snap need a loaded PDF; ParcelDrawing calibrate needs a parcel with an attached drawing — both require sign-in.
- **Steps / Expect.** (A) Sign in → Review → drop PDF → draw a Line → click to select it → small white circles appear at the two endpoints → drag one endpoint → line reshapes, old position undoable. (B) Arm Line → click start → hold Shift + move → preview snaps to 0°/45°/90°/135°. (C) Site Planner → open a site with a parcel drawing → open the drawing → arm "Scale" → draw a line → an inline popup appears at the midpoint asking "Length (ft)" → type 100 → Enter → scale set (no browser dialog). Cadence: once. Last checked: —.

### V125 — B429: Arc, Dimension, Pen, Highlight, Eraser, Snapshot tools in DocReview ✅ build + lint + 1390 tests green; ⏳ signed-in draw round-trip
- **What changed.** Six new tools added to DocReview tool rail and drawing engine: Arc (3-point quadratic Bézier), Dimension (line + witness ticks + calibrated label), Pen (freehand stroke), Highlight (wide translucent freehand), Eraser (drag-box removes Pen/Highlight only), Snapshot (dashed region + camera emoji). `TOOL_DEFAULTS` stamps Highlight with yellow + high opacity. `eraseInBox` prunes freehand markups by point intersection. All render via `MarkupRenderer.jsx`.
- **Why ⏳.** Tool rail only renders when a PDF is open; logged-out smoke confirms no JS crash but cannot exercise drawing. Arrow = arrowhead toggle on Line (property panel, already testable in V124).
- **Steps / Expect.** Sign in → Review → drop PDF → arm **Arc** → click 2 pts → click a 3rd pt on the curve → arc commits automatically. Arm **Dimension** → drag end-to-end → line with witness ticks + length label appears. Arm **Pen** → press-drag a freehand path → releases and commits a stroke. Arm **Highlight** → sweep across text → wide translucent yellow stroke. Arm **Eraser** → drag box over a Pen stroke → stroke removed, other markups untouched. Arm **Snapshot** → drag a box → dashed rect with camera icon commits. Cadence: once. Last checked: —.

### V124 — B428: arrowheads, text props (italic/underline/align), polylength tool ✅ build + lint clean; ⏳ one signed-in draw round-trip
- **What changed.** `MarkupRenderer.jsx` now renders inline arrowhead triangles on `line`/`polyline` when `arrowStart`/`arrowEnd` properties are set. Text rendering wired for `italic`, `underline`, `align` (left/center/right). Polylength tool added to DocReview tool rail (zig-zag icon, multi-click path, measures total run length).
- **Why ⏳.** Tool rail only renders when a PDF is loaded; logged-out smoke confirms no JS crash but cannot exercise drawing.
- **Steps / Expect.** Sign in → Review → drop PDF → arm Polylength → click 3+ points → double-click → teal polyline with total length label. Select a line → set Arrow End in property panel → arrowhead appears at end. Arm Text → click → type → toggle Italic + Underline + change Align → text re-renders with those styles. Cadence: once. Last checked: —.

### V123 — B426/B427: shared MarkupRenderer + PropertyPanel + 4 new DocReview tools (Line/Polyline/Polygon/Ellipse) ✅ build + 1390 tests + lint clean; logged-out smoke clean (no JS crash); ⏳ one signed-in draw+property round-trip
- **What changed.** `src/shared/markup/MarkupRenderer.jsx` (pure SVG renderer, 12 kinds) and `src/shared/markup/PropertyPanel.jsx` (inline property editor driven by the matrix) created. DocReview.jsx wired to use both: SVG layer now `<MarkupRenderer>` instead of inline `draw()`, property panel appears at bottom of left panel when a markup is selected. Four new drawing tools added to DocReview: Line (two-point drag), Polyline (multi-click, open), Polygon (multi-click, snap-to-close), Ellipse (two-point bounding box). `propStyle` sticky defaults for per-tool style inheritance.
- **Why ⏳.** The tool rail only renders when a PDF is loaded; logged-out headless smoke can only confirm no JS crash, not that tools draw. The formal per-tool E2E assertions (B432/NEW-9) cover this in CI once the auth-gated suite is wired.
- **Steps / Expect.** Sign in → open Review → drop a PDF → arm Line → drag → release → a red line appears. Arm Polygon → click 4 points → click first dot → polygon closes. Select a markup → property panel appears in left panel (shows Stroke, Line weight, Dash, Opacity). Change stroke color → markup re-renders in the new color. Polyline and Ellipse draw correctly. Cadence: once. Last checked: —.


### V122 — Live PK is single-column `id`; docs corrected + degrade-branch upserts repointed (B280 follow-up) ✅ seed ran clean on planyr-production (fixture row present), docs+code fix lint/test/build-green; ⏳ one signed-in cloud-save round-trip on a version-less DB to exercise the new fallback
- **What changed.** A Cowork session with live-DB access confirmed (via `pg_constraint`) that
  `public.sites` AND `public.doc_reviews` have **`PRIMARY KEY (id)`** on planyr-production — NOT the
  `(user_id, id)` the docs claimed. That drift had already been migrated in by `db/team_sharing.sql`
  (PK `(user_id,id)→(id)` so one row per project survives a teammate edit); `user_id` stays the
  owner column + RLS predicate. Fixed three things: (1) the two `CLAUDE.md` "Table schema" blocks
  now say `primary key (id)` with a note; (2) the **degrade-branch** plain-upserts in `cloudSync.js`
  (`sites`) and `reviewStore.js` (`doc_reviews`) were keyed on `onConflict:"user_id,id"` alone —
  which 42P10s on the live single-column PK — now they try `"id"` first and fall back to
  `"user_id,id"` only for a genuinely pre-migration DB, mirroring `upsertFileFacts`' existing pattern;
  (3) the B280 seed (`e2e/seed/seed.sql`) was already made constraint-independent.
- **Why ⏳.** The degrade branch only fires when the `version` column is absent; on production the
  column exists, so the fixed path is dormant there (the primary `casUpsert` already keys on `id`).
  The seed itself is ✅ confirmed live. The owed check is one signed-in save against a DB lacking the
  `version` column, to watch the new id-first fallback succeed — low priority (latent-path hardening).
- **Steps / Expect.** Sign in → edit a site → Save shows "Saved" (cloud write ok). On a version-less
  DB the network call upserts with `onConflict=id` and does not 42P10. Cadence: once. Last checked: —.

### V120 — Paste-at-cursor + the "Review" rename (B417/B418/B419) ✅ rename + tokens + paste-math headless-verified; ⏳ one live copy→paste click-through
- **Added** 2026-06-23 · **Cadence** once (acceptance) · **Branch** `claude/gifted-shannon-ycachr` · headless harness `ui-audit/verify-b417-b419.mjs` **11/11**, lint 0 · 1282 unit tests · build green.
- **✅ Verified headless this session (logged-out):** the module **tab now reads "Review"** (no stale "Library"/"Markup" tab); the renamed accent tokens resolve at runtime (`--accent-review` → #EF9F27, `--accent-review-text` → #8A5410) and the old `--accent-markup*` names are gone (no orphans); the Review module mounts and its active tab uses the review accent text color; the Site Planner's Ctrl+V wiring is live and the empty-clipboard fallback no-ops without crashing. The paste **placement math** (`centerOn`/`bboxCenter`, the shared helper both canvases call) is unit-tested (`test/pasteGeom.test.js`, 9 cases).
- **⏳ Pending one live click-through (real browser, planyr.io or a preview — Claude cohort's job, NEVER Michael's):** the actual interactive copy→paste. Selecting a canvas element via *synthetic* pointer events isn't reliable headless (the pointerdown reaches the canvas but React's element-selection doesn't always engage), so the end-to-end gesture couldn't be driven in the sandbox.
  - **Site Planner steps:** open a plan with a building → click it → ⌘/Ctrl+C → move the mouse elsewhere on the canvas → ⌘/Ctrl+V. **Expect:** the copy drops **centered under the cursor** (snap-aware); a zoom/pan between copy and paste doesn't misplace it; repeated Ctrl+V restamps at the current cursor each time; Ctrl+D still duplicates at the old fixed offset.
  - **Review steps:** open a PDF, draw a markup (rect/cloud/measure/text) → select it → ⌘/Ctrl+C (or +X to cut) → move the mouse → ⌘/Ctrl+V. **Expect:** copy/cut/paste now exist (they didn't before) and the pasted markup lands **under the cursor** on the current sheet; the PDF backdrop is untouched.

### V118 — Shared team workspaces end-to-end (B406) ✅ DB migration verified live in prod; ⏳ signed-in UI round-trip owed
- **Added** 2026-06-22 · **Cadence** once (acceptance) · **DB schema ✅ verified 2026-06-22** against the **production** Supabase `lyeqzkuiwngunutlkkmi` (read-only check): 3 `team_id` columns on sites/doc_reviews/file_facts, `sites` PK collapsed to `id`, 12 RLS policies across the three tables, `is_team_member`/`is_team_admin` helpers present, plus `profiles`/`teams`/`team_members`/`team_invites` tables.
- **⏳ Signed-in UI round-trip (auth-gated — the sandbox can't sign in, so a real signed-in browser is needed):** on planyr.io, signed in as user A — Account menu → **Team** → create a team, **invite** user B by email. As user B (same email): sign in → land on the team automatically (invite auto-claimed). As A: open a project → **Project Files → Share…** → share with the team. As B: confirm the project's plans + reviews appear and are editable; a simultaneous A+B edit surfaces the **"reload before saving"** conflict (not a silent clobber); a **member** cannot delete a shared project (only owner/admin); A → **Make private** removes B's access on next pull. Existing private projects stay private throughout.
- **Still gated on:** running `doc-review/db/team_storage.sql` (phase 3) before "B opens A's shared **PDF**" passes; the rest works without it.

### V117 — Signed-in: files OPEN from the Library browser now that Drive is live, and each failure names its precise cause (B405 + B207) ⏳ (logic unit-tested + Drive env owner-verified live; needs one signed-in click-through)
- **Added** 2026-06-23 · **Cadence** once (bug-fix + deploy acceptance) · **Last checked** — · **Next check** — the signed-in steps below, on planyr.io. **Claude cohort's job, never Michael's.**
- **Context:** B405 split the Document Review file-open failure into a precise four-state banner (oversize / not-stored / fetch-failed / signed-out) and removed a SILENT no-banner path; B207's Google Drive storage backend is now LIVE (owner-verified env in Cloudflare Production, 2026-06-22, deploy `912de2b`). The owner reported "opening any file fails" earlier — that root cause is a LIVE storage/auth class the sandbox can't reach, so a signed-in pass is the real confirmation that files actually OPEN again.
- **Steps (signed in, on planyr.io):**
  1. **Library → import a fresh PDF** into a project → **reload the page** → click it. **Expect:** the PDF renders (sheets show), no banner.
  2. **Click an existing/older entry.** **Expect:** it renders; if its bytes genuinely aren't available, the banner now names the **precise** state ("…wasn't stored — re-open to upload", "…couldn't load just now", etc.) — **never** the old blank screen or one-size "Couldn't fetch", and **"Re-open file…"** re-uploads + keeps the markups bound.
  3. **Intentionally-oversize (>50 MB) file.** **Expect:** the **oversize** banner that names the **50 MB per-file cloud limit** — not "Couldn't fetch".
  4. **B207 Drive re-confirm:** drop a fresh PDF into Project Files. **Expect:** no **"Drive copy failed"** warn, and a new row in the Supabase `drive_files` table (the Planyr-key↔Drive-id map). *(Already passed 2026-06-20; this is a post-deploy re-confirmation, optional.)*
- **✅ Already proven without sign-in:** the rename is headless-verified (`ui-audit/verify-b404-library-tab.mjs`, 4/4 — the "Library" tab activates + the workspace mounts clean); the banner taxonomy logic is locked by **15 unit tests** (`test/sourceState.test.js` — `classifySource`/`sourceUnavailableMessage`/`fileWarn`, each state distinct, no silent path); the Drive backend is unit-tested (`test/driveClient.test.js`, `test/idStoreSupabase.test.js`, `test/storageAdapter.test.js`) and its env is owner-verified live. The only piece left is the **signed-in render** (the sandbox CORS-blocks Supabase auth, so a logged-out self-test can't open a cloud-stored file).
- **NB (do NOT escalate to Michael unless CRITICAL):** if step 1 (a brand-new file) also fails to open, that points at a Supabase Storage bucket/RLS provisioning gap (`doc-review-files`) or the Drive read path — note it here with the exact symptom; only a blank-screen/crash in production is a Michael-interrupt.

### V103 — Restore the compact, app-wide cloud-sync badge in AppHeader Row 1 (B373) ✅ (self-verified headless — every state rendered + the live header wiring; one optional signed-in eyeball on the real cloud round-trip)
- **Added** 2026-06-22 · **Cadence** once (feature acceptance) · **Last checked** 2026-06-22 ✅ (headless **Chromium-1194**, `vite` dev, two harnesses, all checks pass) · **Next check** — one optional signed-in eyeball (below); the sandbox proxy blocks sign-in.
- **✅ Component states (`ui-audit/verify-new1-cloud-badge.mjs`, 20/20):** the real `CloudSyncBadge` rendered in every state — **synced** (quiet green cloud-check, not loud), **saving** (amber, pulsing), **offline** (amber, not loud), **error** (LOUD red cloud-slash + ring; clicking opens a popover that surfaces what failed and a **Retry now** that fires the handler), **local** (muted device glyph), **null** (renders nothing). The core guardrail is proven: a failed save is visually distinct from "all good" on glyph + color + loudness.
- **✅ Never silently vanishes (the headline ask):** a deliberately-crashing child inside the badge's own error boundary falls back to the **loud error glyph**, not to blank — the exact "silent unmount" that made the old indicator disappear is now impossible.
- **✅ Live header wiring + survives switches (`ui-audit/verify-new1-header-integration.mjs`, 5/5):** with a project open, the badge is present in the real Row-1 header showing the honest **on-device** state logged-out (NOT a fake green "synced"); switching to Markup with nothing loaded correctly **hides** it (idle = nothing to sync); switching back to Site **restores** it (live state, never stale).
- **⏳ Optional signed-in eyeball (not blocking):** on planyr.io, sign in, open a project, make an edit with the network briefly off → confirm the badge cycles **saving (pulse) → synced (green check)**, and on a forced failure goes **loud red** with a working Retry. Headless can't reach signed-in (proxy blocks auth); each state's *rendering* is already browser-proven above and the state mapping is unit-locked (`test/cloudSyncBadge.test.js`), so this is a visual nicety only.
### V102 — A deleted site STAYS deleted — no reappear mid-session or after reload (B372) ✅ (self-verified headless, logged-out — the actual bug; ⏳ one optional signed-in cloud-error-banner eyeball)
- **Added** 2026-06-22 · **Cadence** once (bug-fix acceptance) · **Last checked** 2026-06-22 ✅ (headless **Chromium**, built app, `vite preview`, logged-out — `ui-audit/verify-b372-delete-durable.mjs`, **6/6**) · **Next check** — one optional **signed-in** eyeball below; the sandbox CORS-blocks Supabase auth.
- **✅ Self-verified 2026-06-22 (the exact repro, asserted on the store source-of-truth + the rendered list):** boot into the planner for **HOLLISTER** (so its planner is mounted), go **Back to map** (it stays mounted, hidden), **right-click its card → Delete project… → Delete**. Result: HOLLISTER is removed and **not resurrected** by the unmounting planner's flush; it **does not reappear mid-session** after a list refresh (open Schiel → back to map); and it's **still gone after a hard reload**, with Schiel preserved. **0 page errors.** **Proven to have teeth:** with the storage guard disabled the harness FAILS exactly as the owner reported (`store ids = [s2,s1]`, the card returns, survives reload).
- **Why logged-out is representative of the bug:** the resurrection was a `saveSite()` write-back from the unmounting planner into the SAME store the app uses; the fix is a per-tab delete tombstone at that `saveSite` chokepoint — auth-independent. Also covered by **9 unit tests** (`test/deletePersistence.test.js`).
- **⏳ Optional signed-in eyeball (NOT owed from Michael; not blocking):** on planyr.io, signed in, with the network briefly throttled/offline, delete a site and confirm that *if the cloud delete actually errors* a red **"Couldn't delete … — it may reappear when you reload"** banner shows and the list re-syncs honestly (rather than a fake success). The decision logic (`interpretDelete`) is unit-locked; this is a visual confirm of the loud path only.

### V101 — Site Analysis: honest source states + authoritative RRC wells/pipelines (B366/B367/B368/B369) ✅ resilience self-verified headless + sandbox coverage; ⏳ one CI / planyr.io run of the RRC coverage fixtures
- **Added** 2026-06-22 · **Cadence** once (acceptance) · **Last checked** 2026-06-22 ✅ (headless **Chromium-1228**, built app, `vite preview`, logged-out) · **Next check** — the RRC live coverage fixtures (below), runnable from any session where `gis.rrc.texas.gov` is reachable (CI / planyr.io) — **NOT Michael's job**.
- **✅ Resilience + honest states self-verified 2026-06-22 (`gis-verify/site-analysis-resilience-verify.mjs`, 11/11, 0 page errors; screenshots `gis-verify/resilience-*.png`, regenerated by the harness — gitignored):** with every ArcGIS `/query` forced to **HTTP 503**, the panel surfaces the honest **"HTTP 503 — temporarily unavailable"** with a **↻ Retry** control, shows **no** "network or CORS" text anywhere, and a previously-cached source shows its **last-good value + "couldn't refresh (as of …)"** (stale-while-revalidate, B367) instead of blanking. A source whose host is unreachable reads **UNAVAILABLE**, never a false **"None found"** (the silent-error guard) — confirmed on the RRC wells/pipelines rows (RRC is off the sandbox allow-list).
- **✅ Live coverage/schema verify in-sandbox (`gis-verify/gis-source-coverage-verify.mjs`):** FEMA NFHL, USFWS NWI, TxGIO city, TxDOT county/road, H-GAC/Austin/Fort Worth ETJ — all **reachable, schema intact, coverage fixtures met** (e.g. Galveston SFHA 230, Sheldon Lake wetlands 530). The RRC rows correctly report **unreachable** here (host not allow-listed) — expected.
- **Deterministic logic** — the retry/backoff/timeout/GET→POST + honest taxonomy (`test/gisFetch.test.js` 15), the unavailable/stale/fallback finding states + RRC fields/URLs (`test/siteAnalysis.test.js`), and the registry tier-guard + no-inline-URL + 14-vs-8,014 coverage-fixture guards (`test/gisSources.test.js` 10) — is locked by **1129 unit tests**, all green.
- **⏳ The one live confirm owed (CI / planyr.io — Claude/CI, never Michael):** run `node gis-verify/gis-source-coverage-verify.mjs` where RRC is reachable and confirm the **Chambers County wells ≥ 1000** + **Mont Belvieu (Grand Port) well ≥ 1** + **Chambers pipelines ≥ 1000** fixtures PASS (they FAIL on the retired Harris-County source — the 14-vs-8,014 false-clean). The weekly **`.github/workflows/gis-drift.yml`** runs exactly this and opens a `@claude` issue on regression, so this closes itself on the next scheduled run (or a manual Actions → Run workflow). Optional signed-in eyeball: planyr.io → Grand Port → **Analysis** → Oil & gas wells now reads a real count (was a false "None found").

### V100 — Active project carries across modules + the file browser is the Markup landing (Work Items A & B) ✅ self-verified headless; ⏳ one signed-in confirm of a real drop categorizing
- **Added** 2026-06-22 · **Cadence** once (acceptance) · **Last checked** 2026-06-22 ✅ (headless **Chromium**, built app, `vite preview` — `ui-audit/verify-project-inherit.mjs` **11/11** + `ui-audit/verify-file-browser.mjs` **10/10**) · **Next check** — on planyr.io, **signed in**: select Mesa → **Markup** → drop a real **civil** PDF. **Expect:** it lands under **Drawings ▸ Civil** with the right badges (or in **Needs filing** with a count if low-confidence), and switching to **Site** and back keeps Mesa + the browser.
- **✅ What the headless runs prove (logged-out + seeded-session):** the active project lives in the URL hash (`#/project/<id>/<module>`), so it **survives Site↔Schedule↔Markup switches, a deep link, and refresh** — Markup shows the project (with a **Private lock**) instead of "Select a project"; no-project → "pick a project". The Document Review **landing is the file browser** (canonical category tree + facet row — All · On the map · Reference · **Needs filing(n)** — + persistent drop strip), NOT the old empty "Open or drop" canvas; **light AND dark** both render cleanly. The tree/state/category derivation is exhaustively **unit-tested** (`test/fileFacts.test.js`, 31 tests incl. 20 new) and `test/route.test.js` (19).
- **Why ⏳:** the file list + the drop→file→index round-trip are **sign-in + cloud gated** (the sandbox CORS-blocks Supabase), so the structure/IA/inheritance are proven headless but a real PDF *populating* Drawings ▸ Civil needs one signed-in click-through. **Owner step (once):** run `src/workspaces/doc-review/db/file_facts_category.sql` in the Supabase SQL editor so `category`/`state` persist (until then they're derived client-side — the tree still works, no regression).

### V99 — Signed-in: a dropped PDF auto-files into the NEW discipline folders (B360) ⏳ (reader accuracy measured on real drawings; needs the signed-in click-through)
- **Added** 2026-06-21 · **Cadence** once (acceptance) · **Last checked** — · **Next check** — on planyr.io, **signed in**: Document Review → **Files** → drop one of the owner's real vector PDFs (a Jacintoport or Mesa set). **Expect:** it routes to the right **project** and lands in the correct **new discipline folder** (Architectural / Structural / Civil / Mechanical / Electrical / Plumbing / Landscape / Fire Alarm / Fire Sprinkler, per the 2026-06-21 taxonomy), auto-named `"<Project> - <Item> - YYYY.MM.DD"`; a low/ambiguous or image-only sheet lands in the **holding tray** for one-click confirm, never misfiled.
- **Why ⏳:** the reader accuracy is now **measured on the owner's real drawings** (project **8/8**, discipline **6/7** — see V79's 2026-06-21 note), the new taxonomy is unit-tested + builds, and the never-auto-guess gate is stress-tested (`test/titleBlockStress.test.js`). The only piece left is the **sign-in-gated drop UI** round-trip (the sandbox can't sign in). Tier-1 is browser-only — no deploy gate.

### V98 — Bump-out resize persistence (B362) + bonded-child rotation repair (B363) ✅ self-verified headless; ⏳ one signed-in confirm on the real Jacintoport
- **Added** 2026-06-21 · **Cadence** once (bug-fix acceptance) · **Last checked** 2026-06-21 ✅ (headless **Chromium-1228**, built app, `vite preview`, logged-out — `ui-audit/verify-b362-b363.mjs`, **6/6 checks**) · **Next check** — a **signed-in** look at the actual cloud site `smqdxst8pf3g` ("Jacintoport"): open it on planyr.io and confirm (a) the assembly is no longer ~1° off the building, and (b) re-sizing a bump-out and then re-sizing the host keeps the bump's size. (Cloud sites are sign-in-gated; the sandbox CORS-blocks Supabase auth, so the real diverged record can't be loaded logged-out.)
- **✅ What the headless run proves on the same code path:** seeds a Jacintoport-shaped site (host at 0°, four bonded children — sidewalk / truck court / two bump-outs — drifted to 359.035° AND positioned for 359.035°, one bump carrying a user size of 80×70), resumes into the planner, makes one edit to fire the autosave, and reads the persisted Site Model back: **all four drifted children snapped to 0°** (re-anchored — the B363 repair runs in `createSiteModel`, the live load path too), the correctly-bonded child is untouched, and **the user-sized bump kept 80×70** (B362 — not reset to the 55×60 default). Clean boot, no genuine JS errors.
- **Why logged-out is representative:** the repair + the bump-sizing are pure feet-space model logic (`lib/siteModel.js` `normalizeBondedRotations`, `lib/dogEar.js`) exercised by the real bundle here; the localStorage store is the same code path used signed-in. Also covered by **17 unit tests** (`test/dogEar.test.js` 5 + `test/bondedRotation.test.js` 6).
### V97 — Markup header de-clutter + truthful save "cloud" chip (B357–B360) ✅ (self-verified headless, logged-out; one optional signed-in eyeball on the green "Saved" state)
- **Added** 2026-06-21 · **Cadence** once (header redesign acceptance) · **Last checked** 2026-06-21 ✅ (headless **Chromium-1228**, built app, `vite preview`, logged-out) · **Next check** — one optional signed-in eyeball (below); the sandbox proxy blocks sign-in.
- **✅ Self-verified 2026-06-21 (`ui-audit/verify-header-redesign.mjs`, after = PASS, 0 page errors; before/after screenshots in `ui-audit/screens/header-*`):**
  - **B358 — no cry-wolf:** the empty Markup header (nothing open) shows **no save chip at all** — the old "● Not saved" is gone; once a PDF is open (logged-out) it reads the honest **"On this device"**.
  - **B357 — row hierarchy:** measured row heights are **`[35, 44]`** (Row 2 taller than Row 1); the duplicate project title is gone from the centre zone.
  - **B359 — Library retired:** no "📁 Library" button in **either** the single-sheet header or the Stitcher toolbar.
  - **B360 — Reviews relocated:** the "Reviews ▾" button now resolves inside **Row 2** (tools), not Row 1.
- **↪ Superseded by V103/B373:** this Row-2 "cloud" chip has since been **retired** — the app-wide Row-1 `CloudSyncBadge` is the single save indicator now (no second chip competing in the Markup header). The "failed-write-is-loud / no-cry-wolf" contract it locked migrated from `test/reviewsBadge.test.js` to `test/cloudSyncBadge.test.js` (the `chipFor` truth-table → `cloudBadgeView` + `docSaveState`). The row-hierarchy / Library-retired / Reviews-relocated parts of V97 below still stand.
- **⏳ Optional signed-in eyeball (not blocking):** on planyr.io, sign in, open a Markup review, make an edit → confirm the chip cycles **Saving… → ✓ Saved** (green cloud-check). Headless can't reach signed-in (proxy blocks auth); the logic is unit-locked, so this is a visual nicety only.
- **NB (not a bug to fix here):** the separate **"⊘ Cloud off"** pill is the Shell's auth control when Supabase isn't configured for the build — it shows in the sandbox preview but on a cloud-configured planyr.io it's the Sign-in/account pill. If it's visible in production, the cloud env vars aren't wired into that deploy (a config item).
### V90 — Site-plan overlay "hide" (eye toggle) persists across reload (B343) ✅ logged-out + signed-in-reload-shape self-verified headless; ⏳ one signed-in confirm
- **Added** 2026-06-21 · **Cadence** once (bug-fix acceptance) · **Last checked** 2026-06-21 ✅ (headless **Chromium**, built app, `vite preview`, logged-out — two harnesses, all checks pass) · **Next check** — a **signed-in** confirm on planyr.io (cloud sync is sign-in-gated; the sandbox CORS-blocks Supabase auth logged-out).
- **✅ Self-verified 2026-06-21 (`ui-audit/verify-overlay-delete-hide.mjs` + `ui-audit/verify-overlay-hide-stripped.mjs`):** hiding a placed overlay removes it from the map but keeps it LISTED (recoverable); the hidden state PERSISTS across reload (`visible:false` in the record); Show brings it back. The second harness uses the exact **signed-in reload shape** — raster stripped (`src:null`) + `storageKey` + `visible:false` — and confirms it renders NOTHING (no image, no "Loading…" placeholder) and stays hidden, so it can't "reappear". Backed by **8 unit tests** in `test/storage.test.js` locking the signed-in cloud round-trip of `visible` (save/load · `createSiteModel` normalize · `mergeSiteContent` both directions · `mergePulledSites` local-hidden-wins / cloud-already-hidden / re-push · rehydrate spread). lint 0 · 810 tests · build green.
- **⏳ Signed-in confirm owed:** sign in on planyr.io → open a plan with a real PDF site-plan overlay → click the eye to hide it → reload. **Expect:** it stays hidden (and stays listed in the Overlay panel, recoverable). This is the only path the sandbox can't drive (Supabase auth is CORS-blocked logged-out); the persistence logic is otherwise proven by the unit tests + the data-layer round-trip. Context: the underlying fix has been LIVE in `main` since commit `b66774b` (the overlay delete/visibility work), so this is an acceptance re-confirm, not a first verification.

### V85 — Doc Review file-classification + canvas-memory + on-map-badge fixes (B326 / B327 / B328 + B40 amendment) — B327/B40 ✅ self-verified headless; B326/B328 ⏳ — checked on planyr.io 2026-06-21: not yet deployed, re-run post-deploy
- **Added** 2026-06-21 · **Cadence** once (bug-fix acceptance) · **Last checked** 2026-06-21 ✅ (headless **Chromium-1228**, built app, `vite preview`, logged-out, generated 3-page E-size PDF) · **Next check** — a **signed-in** look at the Project Files drawer (B326/B328 below — it shows "Sign in to browse your project files" logged-out, so its UI can't be driven in the sandbox).
- **⏳ B326/B328 — checked on planyr.io 2026-06-21 (Cowork, signed-in): NOT YET DEPLOYED.** Ran B326 live — filed an untitled holding drawing under the **CAD** discipline → it stayed **"reference · ○ filed"** (no green **spatial** tag, no **"Place on map"** button) and the **On-the-map docs** view stayed empty: the pre-fix behavior. Cause confirmed by scanning the **live JS bundle** — the deployed Files-drawer chunk loads (its `On-the-map docs` / `spatial + reference` strings are present) but it does **not** contain CAD in the spatial set (the NEW-1 `["Survey","Civil","Architectural","Landscape","CAD"]`), so the B326 build isn't on planyr.io yet. `main` is correct (CAD ∈ `SPATIAL_DISCIPLINES`),
- **✅ B327 self-verified in a real browser (`ui-audit/verify-b322-b40.mjs`):** open an **E-size** sheet (2448×1584 pt) at **2× DPR**, zoom to the **600% max**, and read the actual canvas backing store → **6090×3940 = 24.0 MP** (exactly the ~24 MP budget), while the CSS box stays **14688px** wide (base×scale preserved, so markups still line up). Pre-fix this allocated ~140 MP / ~533 MB and risked an OOM tab crash. Also numerically unit-tested (`test/renderBudget.test.js`) for scales 0.5–6 × dpr 1–3.
- **✅ B40 amendment self-verified (same harness):** **0** "Cannot use the same canvas during multiple render operations" errors across 12 rapid sheet-switches + zooms (the race the amendment closes by checking `isStale()` before `page.render()`), and the canvas still renders healthy after the churn. (Environmental note: the sandbox proxy CORS-blocks the Site Planner's Houston GIS probes — `mycity2.houstontx.gov` — which is unrelated network noise, not an app error; same caveat as V82.)
- **⏳ B326 (CAD → spatial) — signed-in check owed:** sign in → Markup → **Files** → file a drawing under the **CAD** discipline. **Expect:** it shows the green **spatial** tag, has a **"Place on map"** button, and appears under the **"On-the-map docs"** saved view (not "Reference docs"). (Logic is unit-tested in `test/fileFacts.test.js`; only the drawer render needs the live eyeball, and the drawer is sign-in-gated.)
- **⏳ B328 (Filed → On-map badge) — signed-in check owed:** sign in → file a spatial drawing → click **"Place on map"** and confirm. **Expect:** reopening Files shows that file's badge as **"● on map"** (was permanently stuck on "○ filed"). (`listReviews` now surfaces `placed`; `markReviewPlaced` writes it; both verified by code + unit tests, but the cloud round-trip needs a signed-in session the sandbox can't reach.)

### V83 — Stitch: measuring over an un-aligned sheet is now BLOCKED, not just warned (B316) ✅ (self-verified headless — fully done, no signed-in check needed)
- **Added** 2026-06-21 · **Cadence** once (acceptance) · **Last checked** 2026-06-21 ✅ (headless **Chromium-1228**, built app, `vite preview`, logged-out, generated 2-page Letter PDF) · **Next check** — none (pure Stitch-canvas behavior; no auth/cloud path). Owner call: "don't let it measure on uncalibrated things."
- **✅ Self-verified 2026-06-21 (`ui-audit/verify-b300-b302.mjs`, all checks pass, 0 page errors):** a Distance drawn over a not-yet-aligned 2nd sheet is **refused** — the block banner "Align that sheet before measuring on it" appears and **0** distance lines are committed (B301 had shown a soft warning but still committed the measurement). The B300 degenerate-align reject + B302 ≥3-pt Area guards still pass; a valid Align still clears the flag. lint **0** · **743 tests** · build green.

### V81 — Optimistic concurrency: a stale save is rejected with a "reload" prompt (B314) ⏳ — one signed-in two-session check (migration is RUN ✅)
- **Added** 2026-06-20 · **Cadence** once (acceptance) · **Last checked** — · **Next check** a signed-in two-session run.
- **✅ Migration RUN (owner, 2026-06-20):** `src/workspaces/site-planner/db/optimistic_concurrency.sql` was run in Supabase — the `version` column now exists on `sites` + `doc_reviews`, so the guard goes ACTIVE on this deploy (before the deploy, old code simply ignores the new column — harmless).
- **Steps (signed in, two browser tabs on the SAME project):** in tab A move Building 1; let it save ("Synced ✓"). In tab B (opened before A's save) move Building 1 differently and save. **Expect:** tab B's save is **rejected** with a loud blue banner "this project was changed in another session — reload before saving" + a **Reload** button (NOT a silent overwrite); Reload → B gets A's change and B's edit merges in (nothing lost).
- **✅ Logic self-verified (no live DB needed):** `test/cloudConcurrency.test.js` (16 cases) proves the whole compare-and-swap matrix — conflict on a stale version, success+bump, degrade when un-migrated, brand-new insert, unique-violation→conflict, never-throws, and that a *different* missing column can't disable the guard. The browser/cloud conflict path can't be driven logged-out (the sandbox blocks sign-in), so the signed-in click-through above is owed.

### V79 — Auto-filing reads the title block with PLAIN CODE (no AI/tokens) and files itself (B312) ✅ (logic exhaustively unit-tested + headless boot clean; ⏳ real-sheet accuracy on the owner's drawings)
- **Added** 2026-06-20 · **Cadence** once (acceptance) · **Last checked** 2026-06-20 ✅ (headless Chromium on the built app, `vite preview`, logged-out — drawer opens, new modules evaluate, 0 errors) · **Next check** — a signed-in drop of a **real construction sheet** (the owner's KG B1 ARCH + Jacintoport Fire-Sprinkler sets, or any vector PDF): drop it in Markup → **Files** and confirm it (a) routes to the right **project** (the title block names it), (b) gets the right **discipline/item** (ALTA→Survey/ALTA Survey, grading→Civil, fire sprinkler, etc.), (c) takes the **latest date** off the sheet, and (d) anything it can't confidently match lands in the **holding tray** (never misfiled). This is the real-world-accuracy check the unit tests can't make — it depends on how the owner's actual title blocks are worded.
- **Why ⏳ only on accuracy:** the deterministic logic is **fully unit-tested** (53 tests — `test/titleBlockParse.test.js` parsing/dates/discipline/sheet/revision; `test/matchProject.test.js` name/parcel/job# match + ambiguity + no-false-match; `test/autofiling.test.js` local-first vs AI-fallback tiering). The only thing that needs a live look is whether the keyword table + name-match fire correctly on the owner's specific drawings; the drop UI is signed-in only (sandbox blocks sign-in). **No tokens, no cloud, no key** for this path — it runs entirely in the browser, so there's no deploy gate.
- **✅ Self-verified headless (`ui-audit/verify-b299-autofiling.mjs`, logged-out):** the Files drawer opens; `titleBlockParse` / `matchProject` / `localRead` (lazy pdf.js) evaluate in a real browser with **0 page/console errors** (no chunk regression). The on-by-default auto-fill is safe by construction: confident match → auto-route; else → today's behavior (active project / holding tray).
- **✅ 2026-06-21 (B360) — real-sheet accuracy MEASURED on the owner's actual drawings.** Drive was re-authed to michael@planyr.io, so the readers were scored against the Jacintoport + Mesa sets via `node ui-audit/score-filing.mjs` (ground truth = the descriptive filename). **8 readable sheets: project 8/8, discipline 6/7, date 3/6, revision 3/5.** The corpus drove real reader fixes (weighted-dominance discipline, consistent-separator dates, "ISSUE FOR CONSTRUCTION"→IFC, no "REVISIONS"→"Rev S"), each locked with a real-snippet unit test; remaining misses are ground-truth nuances (sheet date vs package date; mixed-revision package) or image-only scans (no text layer → the dormant Tier-2 AI/OCR path). The remaining ⏳ is only the **signed-in drop UI** round-trip on planyr.io (the sandbox can't sign in); the reader accuracy itself is now confirmed on real sheets.

### V77 — Street-imagery (Mapillary) layer served via the server-side proxy for all visitors (B308) ✅ client-side self-verified headless; ⏳ one LIVE confirm on planyr.io Production
- **Added** 2026-06-21 · **Cadence** once (acceptance) · **Last checked** 2026-06-21 ✅ (headless Chromium on the built app, `vite preview`, logged-out — the client side) · **Next check** — the LIVE confirm below, on planyr.io Production after the next deploy (the owner has already set the `MAPILLARY_TOKEN` secret).
- **Why a live check is needed:** the proxy is a Cloudflare **Pages Function** — it runs ONLY in the Cloudflare runtime, not under `vite preview`/the sandbox. So the "imagery actually renders" half can only be confirmed on the deployed site. Everything client-side IS self-verified (below).
- **✅ Self-verified headless 2026-06-21** (`gis-verify/mapillary-proxy-verify.mjs`): toggling **"Poles & hydrants from street imagery"** with **no pasted token** → the layer loads (no token gate; reads "Works automatically"), fires its request to the **same-origin `/api/mapillary/map_features`**, with **0 token leaks** (`access_token`/`MLY` in **no** request URL), **no** direct `graph.mapillary.com` call, graceful degrade where the proxy isn't present (preview), **0 JS errors**. Bundle grep: **0 `MLY|` token literals + 0 `VITE_MAPILLARY_TOKEN` in `dist/`**. Plus **10 unit tests** (`test/mapillaryProxy.test.js`: allow-list, Origin check, limit-clamp, and the client default carrying no token).
- **⏳ LIVE confirm (on planyr.io, logged-out is fine):** open the map → **Layers → Poles & hydrants from street imagery** ON → zoom to **≥ 16** over a covered urban area (e.g. downtown Houston). **Expect:** pole/hydrant dots paint; in DevTools → Network, the only Mapillary traffic is to **`/api/mapillary/…`** (same-origin) and the **`MLY|…` token appears nowhere** in the page source, the JS bundle, or any request URL. Also confirm a per-branch **preview** URL (which has no secret) degrades gracefully — the layer just shows "not available", no error. (If the owner later adds `MAPILLARY_TOKEN` to the Cloudflare **Preview** env, previews will show it too.) This closes **B308**.

### V74 — Auto-filing: drop a drawing → it reads the title block → files itself (B299) ✅ (self-verified headless — dormant-path no-regression proven; ⏳ deploy-gated live read + signed-in round-trip)
- **Added** 2026-06-20 · **Cadence** once (acceptance) · **Last checked** 2026-06-20 ✅ (headless Chromium on the built app, `vite preview`, logged-out) · **Next check** — after the owner provisions the Cloud Run `server/filing/` service + `ANTHROPIC_API_KEY` + `DOC_FILING_URL` + `VITE_AUTOFILE_ENABLED=1` + runs `db/file_facts.sql`: sign in on planyr.io → Markup → **Files** → drop a real construction sheet (e.g. the KG B1 / Jacintoport sets) and confirm it reads the title block, routes to the right project + discipline, auto-names it, and a low/ambiguous match lands in the holding area for one-click confirm.
- **Why mostly ⏳:** the read needs the server-side `ANTHROPIC_API_KEY` (never in the browser) + the deployed Cloud Run service, and the drop UI is signed-in only (the sandbox proxy blocks sign-in). So the live read + the signed-in drop→read→file→index round-trip can't run headless here — they're the deploy-gated checks. The **deterministic logic is fully covered** by 52 unit tests (`test/docFiling.test.js` — reader request shape, refusal/error handling, matcher confident-vs-needs-filing, HTTP status codes; `test/autofiling.test.js` — provider gating, graceful skip, file-facts merge).
- **✅ Self-verified 2026-06-20 (`ui-audit/verify-b299-autofiling.mjs`, headless, logged-out):** the Project Files drawer opens from the Markup Row-1 **Files** button, the new `autofilingProvider` + `fileIndex` imports evaluate in a real browser (the doc-review lazy chunk loads), **0 page/console errors**, and auto-filing is **dormant by default** (`backendReady` false → the drawer shows no live "it files itself" behavior) — i.e. the wiring is in place with **zero regression** to today's manual filing.

### V73 — Account names (profiles table) + identity-pill dropdown (B297 / B298) ✅ (signed-in UI self-verified headless via seeded session; ⏳ one live cloud round-trip)
- **Added** 2026-06-20 · **Cadence** once (acceptance) · **Last checked** 2026-06-20 ✅ (headless Chromium on the built app, `vite preview`; signed-in UI exercised with a seeded local Supabase session) · **Next check** — one signed-in click-through on planyr.io after the migration is run.
- **⚠ Owner prerequisite (one-time):** run `src/workspaces/site-planner/db/profiles.sql` in the Supabase SQL editor (creates the `profiles` table + `handle_new_user` trigger + RLS + backfill). Until then, saving a profile will error and names fall back to signup metadata/email (no crash).
- **Harness:** `ui-audit/verify-b297-b298.mjs`. supabase-js reads its session from `localStorage` with **no network**, so seeding a well-formed far-future session drives the **real signed-in UI** despite the sandbox's logged-out-only auth proxy.
- **✅ Self-verified headless (14/14, 0 JS errors):** the Row-1 pill shows the user's name ("Mike Abbott"); clicking it opens the account dropdown with **Profile / Settings / Sign out** + the account email + the **organization**; **Esc closes it**; **Profile** opens the modal pre-filled (First/Last/Org) with a **Save profile** action; **Settings** shows **Change password**. Logged-out, the pill is **"Sign in"** and opens the modal → Sign up shows the **First/Last name** fields. Screenshots `ui-audit/screens/b298-account-dropdown.png`, `b297-profile-modal.png`, `b298-settings-tab.png`, `b297-signup-form.png` (gitignored).
- **Deterministic logic** — the never-blank display chain (`displayNameFor`/`firstNameFor`/`orgFor`/`initialFor`) — is covered by **10 unit tests** (`test/profileDisplay.test.js`), all green.
- **⏳ Needs one signed-in click-through on planyr.io** (the real cloud round-trip — table read/write — can't run in the sandbox; auth is CORS-blocked there): sign up a brand-new account with a first/last name → confirm the pill shows the name and a `profiles` row exists; edit the name under **Profile → Save** and reload → confirm it persisted (read back from the table, not just metadata); confirm **Change password** under Settings works. (Claude cohort's job, never Michael's.)

### V71 — Coverage-aware Layers picker: relevance modes + Mapillary rename/gating + jurisdiction-vector retry (B283–B287) ✅ (self-verified headless — fully done; ⏳ one optional signed-in note)
- **Added** 2026-06-20 · **Cadence** once (feature acceptance) · **Last checked** 2026-06-20 ✅ (headless Chromium on the built app, `vite preview`, logged-out, live HCFCD + H-GAC ETJ extents) · **Next check** — none required (the coverage path is auth-independent; a signed-in eyeball on planyr.io where the City-of-Houston `geogimstest` host is reachable would also show the COH water/sewer/storm layers dim outside the city — they fail-open as "available" from the sandbox because that host isn't on the egress allowlist).
- **Steps:** Map finder (or planner) → **Layers** panel. (1) A **"Relevance"** control reads **Show all / Dim / Hide** (Dim default) with a **"nearby range"** slider. (2) The street-imagery layer reads **"Poles & hydrants from street imagery"** (not "Mapillary detections"), with a plain sublabel + a small **"Source: Mapillary"** note; toggling it (no token) reads **"Not configured…"**, a gray needs-setup dot — not a red failure. (3) Pan well **north out of Houston** → regional layers (HCFCD, City ETJ, COH utilities) sink/gray with **"No data in this area"**; the map itself still renders whatever each source returns.
- **✅ Self-verified 2026-06-20** (`gis-verify/coverage-picker-verify.mjs`, headless, logged-out, screenshot `gis-verify/coverage-picker-verify.png`): **Relevance control + nearby-range slider render** (Dim default); **rename + plain sublabel + "Source: Mapillary"** present and the old "Street-level detections" name gone; toggling the tokenless layer reads **"Not configured"** (no red failure); **panning north flipped 2 regional layers to "No data in this area"** — HCFCD via the **EPSG:2278 State-Plane** reprojection path and H-GAC ETJ via the **Web-Mercator** path (their `?f=json` extents were fetched from `www.gis.hctx.net` + `services.arcgis.com`), **0 page JS errors**.
- **Deterministic logic** — scope tagging, the EPSG:2278↔WGS84 projection (vs pyproj <1e-4°), extent reprojection for all three SR families, in/out/unknown + fail-open, the three display states, the HARD-RULE request-spec coverage-independence, the FeatureServer retry/backoff policy, and the relevance prefs — is covered by **46 unit tests** (`test/coverage.test.js` 27, `test/layerRequest.test.js` 10, `test/coordinates.test.js` projection 9), all green.
- **⏳ Optional:** a signed-in / on-planyr.io run where `geogimstest.houstontx.gov` is reachable, to watch the **COH water/sewer/storm** layers themselves dim outside the city (logged-out from the sandbox their host isn't allowlisted, so they correctly **fail open** as available rather than dim — no wrong hiding, just no positive demo of those four specifically).

### V70 — Opening a file from the global Project Files panel opens it in Markup on the FIRST click (B282) ✅ (self-verified headless — no-crash + mount/remount proven; ⏳ signed-in first-click open)
- **Added** 2026-06-20 · **Cadence** once (acceptance) · **Last checked** 2026-06-20 ✅ (headless Chromium on the built app, `vite preview`, logged-out) · **Next check** — one **signed-in** run on planyr.io (the file-list + open are auth-gated; the sandbox proxy blocks sign-in).
- **Steps (signed-in, on planyr.io):** make sure **Markup** hasn't been opened yet this session → Site → open a project (e.g. Jacintoport) → top-bar **🗂 Files** → click a filed document (e.g. the MEP set). **Expect:** it switches to **Markup** and the document **opens on the first click** (sheets render), and the breadcrumb shows the project (not "Select a project"). Previously the first click landed on the empty "Open or drop a construction PDF" placeholder and only a second click worked.
- **✅ No crash + clean mount/remount (headless, `ui-audit/verify-new1.mjs`):** Document Review mounts with the new `docIntent` prop + ref capture + intent-consuming effect + hardened `openReview` + error banner, and re-mounts after a tab switch-away/back, with **zero JS errors**. This gates the runtime risk in the patch.
- **⏳ Signed-in first-click open:** the global Files panel only lists files when signed in (cloud), and opening fetches the review row + PDF over the network — neither runs logged-out, so the actual first-click open is the one live check. Low-risk (the open now rides the proven `navIntent`-style cross-workspace intent; the in-workspace open path was already working).

### V68 — Overlay delete persists across reload + per-overlay visibility toggle (B276 / B277) ✅ (self-verified headless — fully done; ⏳ optional signed-in cross-device confirm)
- **Added** 2026-06-20 · **Cadence** once (acceptance) · **Last checked** 2026-06-20 ✅ (headless Chromium on the built app, `vite preview`, logged-out, seeded image overlay) · **Next check** — optional: signed-in, delete an overlay on device A and confirm it does NOT reappear on device B (the cloud-merge resurrection path; its merge logic is unit-tested, so low-risk).
- **Steps:** Site Planner with a placed site-plan overlay → left rail **Overlay**. (B277) Click the **eye** on the overlay row → it leaves the map but stays listed; reload → still hidden; click the eye again → it returns. (B276) Click **✕ Remove** → it's gone; reload → it stays gone (does not come back).
- **✅ Self-verified 2026-06-20 (`ui-audit/verify-overlay-delete-hide.mjs`, 13/13 checks, 0 dialogs):** **B277** — hide removes the overlay `<image>` from the canvas but keeps the panel row; the hidden state survives reload (record persists `visible:false`); show restores it. **B276** — delete removes it, survives reload, and the stored record carries the `deletedIds` tombstone (the mechanism that stops a cloud/2-tab merge from resurrecting it). Screens `overlay-1-shown.png` / `overlay-2-hidden.png` / `overlay-3-deleted.png`.
- **Why fully done logged-out:** the bug + fix live in the shared Site Model + `mergeSiteContent` (auth-independent); the signed-in cloud path uses the SAME merge (unit-tested — B276 cases in `test/storage.test.js`). The ⏳ above is a belt-and-suspenders cross-device click, not a new mechanism.

### V67 — Doc Review (Markup) auto-calibrates a sheet from its stated scale (B267) ✅ (self-verified headless on the owner's real sets — fully done for vector PDFs; ⏳ OCR slice pending a scanned sample)
- **Added** 2026-06-20 · **Cadence** once (acceptance) · **Last checked** 2026-06-20 ✅ (headless Chromium on the built app, `vite preview`, logged-out, the owner's real KG B1 ARCH + Jacintoport FS sets from branch `mikeab7-patch-1`) · **Next check** — optional: a signed-in run on planyr.io confirming an auto-cal persists across reload; and the OCR path once a scanned sample exists.
- **Steps:** Markup → open a multi-sheet PDF → watch the sheet list + the takeoff badge.
- **✅ Architectural set auto-calibrates:** KG B1 (19 sheets) — **17 sheets auto-calibrated** from their stated architectural scales (1/16″=1′-0″, 1/4″=1′-0″, …), the **2 no-scale cover/notes sheets stay "not calibrated"**, and an auto sheet's badge reads **"scale from sheet: 1/16″=1′-0″ · verify"** (distinct amber, not a silent green). Sidebar shows **·≈** on auto sheets. `ui-audit/verify-new3-autoscale.mjs`.
- **✅ NOT-TO-SCALE set is flagged, not calibrated:** Jacintoport FS (9 sheets) — all badge **"marked NOT TO SCALE"**, none auto-calibrated.
- **✅ No cross-document bleed:** opening a second file resets calibrations — **0 stale ·≈ markers** carried from the prior file (a bug found + fixed during this verification).
- **⏳ Pending:** the **OCR fallback** for scanned/raster sheets (B267 remaining) — no scanned sample on hand to drive it; the owner's two sets are vector, which the shipped embedded-text path covers.
### V66 — Project Files persistent drop-zone + processing queue (B270) ⏳ (active group self-verified headless; ⏳ signed-in check for the filed-row demote)
- **Added** 2026-06-20 · **Cadence** once (acceptance) · **Last checked** 2026-06-20 (partial — see below).
- **✅ Self-verified headless (logged-out, real component in a real browser):** mounted the real `ProjectFilesDrawer` with `signedIn` and drove a **mixed 3-file pick** (2 PDFs + 1 PNG) in one action → the tray showed **"PROCESSING · 3"** (Amendment A: one independent row per file, not a batch row), the PNG became a clear **"Not a PDF — only PDFs can be filed."** rejection row with a Dismiss ×, the two PDFs showed **Retry** buttons, and there were **0 JS / console errors and no `window.alert`**. The existing `ui-audit/verify-files-refile.mjs` also still PASSes (drawer mounts cleanly with the new imports/components). Screenshot captured (`ui-audit/screens/upload-tray.png`, gitignored).
- **⏳ Needs a signed-in click-through on planyr.io** (the success path requires a real cloud filing, which needs sign-in — the sandbox proxy blocks auth logged-out): confirm that on a successful file the row turns to the muted green **done** state, **stays visible**, then after ~3s **demotes** into a collapsible **"Recently filed · N"** group (subtle slide/fade, not an abrupt removal); that the trail **collapses by default once it has >3 entries** and the **Clear** button empties it; and that a no-project drop lands as a **needs_filing** row whose **Triage** jumps to the holding area. (This is the Claude cohort's job, never Michael's.)
- **Deterministic logic** — the two-group derived view (`splitQueue`), demote timing (`hasPendingDemote`), multi-file/rejection (`makeQueueItems`/`isAcceptedFile`), the collapse threshold, and the concurrency pool (`runPool`, max-in-flight asserted) — is covered by **12 unit tests** (`test/uploadQueue.test.js`), all green.

### V65 — Doc Review (Markup) sheets render crisp on HiDPI, not blurry (B265) ✅ (self-verified headless — mechanism proven; ⏳ optional live retina eyeball)
- **Added** 2026-06-20 · **Cadence** once (acceptance) · **Last checked** 2026-06-20 ✅ (headless Chromium on the built app, `vite preview`, logged-out, generated 1-page PDF, driven at deviceScaleFactor 1 and 2) · **Next check** — optional: open a real structural/general-notes sheet on planyr.io on a Retina/HiDPI display and confirm note text is sharp at fit-to-page.
- **Steps:** Markup tab → open/drop a PDF → read note text at fit-to-page, then zoom in.
- **✅ Backing store honours devicePixelRatio:** at **deviceScaleFactor 2** the canvas backing store renders **2.000×** the on-screen size (1054→2108 px) — a dense, crisp bitmap instead of an upscaled 1× one; at **deviceScaleFactor 1** it's **1.000×** (never worse than before). `ui-audit/verify-new2-dpr.mjs`.
- **✅ No overlay regression:** the on-screen (CSS) size is **identical across both densities** (1054×1364) and `renderPageToCanvas` returns the same `dims.w/h` as before, so markups/measurements land unchanged.
- **⏳ Optional live confirm:** the crispness *gain* only manifests on real HiDPI hardware; one eyeball on a Retina display on planyr.io would close it fully. Low-risk.

### V63 — Dropped overlay sizes sanely + "Size to view" rescue (B260) ✅ (self-verified headless — image path; ⏳ one real-browser PDF drop)
- **Added** 2026-06-20 · **Cadence** once (acceptance) · **Last checked** 2026-06-20 ✅ (headless Chromium on the built app, `vite preview`, logged-out) · **Next check** — a real-browser drop of an actual landscape **PDF** that carries both a plan scale and a vicinity/key-map scale, to confirm the scale-read guard fires end-to-end (the sandbox Chromium can't run pdf.js — `getOrInsertComputed` — so the PDF *raster* path couldn't be exercised headless here).
- **Harness:** `ui-audit/verify-overlay-fix.mjs` — seeds a 26.33-ac parcel + Katy origin (aerial on), logged-out.
- **✅ Fresh drop is sane:** dropping an **image** runs the real `addOverlayFile` path → the overlay lands **535 px** wide on a 1440 px view (≈60% fit), never splattered, no error dialog (`screens/verify-A-image-drop.png`).
- **✅ Rescue works:** a seeded **mis-scaled** overlay (simulated 1″=600′ misread, **14279×9519 px** — the reported "title block all over the map") shrinks to **535 px** with one click of the new **"Size to view"** button (`screens/verify-B-before.png` → `verify-B-after.png`).
- **Deterministic logic** (the ≤4×/≥0.04× viewport scale guard, fit fallback, reasons) is covered by `test/overlayScale.test.js` (`chooseOverlayScale`, 7 cases) — all green.
- **⏳ Remaining:** the one real-browser PDF drop above; everything else is fully self-verified.

### V61 — County parcel fetch survives a county-server outage (TxGIO statewide fallback) (B244 / B245) ✅ (self-verified headless — fully done; ⏳ optional signed-in confirm)
- **Added** 2026-06-20 · **Cadence** once (acceptance) · **Last checked** 2026-06-20 ✅ (headless Chromium on the built app, `vite preview`, logged-out, live HCAD + TxGIO; FBCAD simulated down) · **Next check** — optional: a signed-in click-through on planyr.io (the resilience path is auth-independent, so logged-out coverage is representative).
- **Harness:** `gis-verify/fbcad-outage-fallback-verify.mjs` — intercepts the **`gis.fbcad.org`** host as **HTTP 503** to reproduce the real 2026-06-19 FBCAD outage, then enters Select-parcels, recenters on Sugar Land (Fort Bend), and clicks a lot.
- **✅ No freeze + correct fallback:** the click **selected a real parcel from the statewide TxGIO layer (prop_id 40594, county "FORT BEND") in ~1.2 s** — HCAD answered empty, FBCAD's 503 was intercepted and never froze the tab (the old behavior hung ~45 s with no answerer). Confirms the 8 s `AbortController` timeout + the candidate fallback.
- **✅ Honest provenance:** the amber **"Statewide backup source — Fort Bend county's own parcel server is unavailable …"** notice rendered on the map (`gis-verify/fbcad-outage-fallback-verified.png`), so a possibly-staler backup is never mistaken for the county's own record.
- **Deterministic logic** (timeout classification, circuit-breaker open/cooldown/reset, county-scoped where-clause, TxGIO field normalization) is covered by unit tests (`test/arcgis.test.js`, `test/sourceHealth.test.js`, `test/parcelQuery.test.js`, `test/appraisal.test.js`, `test/counties.test.js`) — all green.
- **⏳ Optional:** repeat once on planyr.io while signed in (no behavior difference expected — the parcel fetch path doesn't depend on auth).

### V58 — Schedule module recovers after a deploy instead of dead-ending (B239) ✅ (self-verified headless — fully done) · ⏳ one optional production click-through
- **Added** 2026-06-20 · **Cadence** once (acceptance) · **Last checked** 2026-06-20 ✅ (headless Chromium on the built app, `vite preview`, logged-out) · **Next check** — one optional live confirm on planyr.io after deploy (steps below)
- **Harness:** `ui-audit/diagnose-scheduler.mjs` (three scenarios: normal click, stale-but-recoverable chunk, permanently-missing chunk) + `ui-audit/verify-chunk-reload.mjs` (the B221 guard contract).
- **✅ A (module not broken):** clicking **Schedule** on a fresh load mounts the `/sequence/` iframe and the embedded Gantt renders **44 task rows** — confirms the failure was never the Scheduler/iframe code, only the chunk-fetch recovery.
- **✅ B (stale chunk recovers):** a `Scheduler-<hash>.js` that 404s once then succeeds → the `vite:preloadError` guard performs a **cache-busting** reload and lands in the module (no error screen).
- **✅ C (chunk permanently missing):** the boundary surfaces **"A new version of Planyr is ready"** (no reload loop), and clicking the single primary **"Reload to update"** does a real cache-busting reload — captured nav trail `"/" → "/?_r=<ts>" → "/"` (param added to force fresh HTML, then stripped on the recovered load). `verify-chunk-reload.mjs` still **3/3** (reload-once · cooldown holds · re-arms).
- **⏳ Optional live confirm:** on planyr.io, open the app in a tab, deploy a new build, then (in the still-open tab) click into **Schedule** — expect it to self-heal (auto cache-busting reload) and land in the Gantt, not the error screen. Low-risk (the recovery path is fully headless-verified); worth one real-deploy click if convenient.

### V46 — Schedule Gantt brackets + task-fill + configurable columns (B210 / B211 / B212) ✅ self-verified headless · ⏳ one signed-in cloud check
- **Added** 2026-06-19 · **Cadence** once (feature acceptance) · **Last checked** 2026-06-19 ✅ (headless Chromium, static-served `public/sequence/`, logged-out seed) · **Next check** — one signed-in cloud round-trip (below)
- **Harness:** `ui-audit/verify-sequence.mjs` (renders the embedded Schedule app, captures console/page errors, probes bar colors, screenshots). **Note for future sessions:** the Schedule app's CDN deps (React/Babel/Supabase) **are reachable** in this environment — serve `public/` statically and load `/sequence/` (the app falls back to its embedded `__PLANAR_DATA__` seed when logged-out). JSX-only syntax pre-check: `ui-audit/jsxcheck-sequence.mjs` (esbuild).
- **✅ B210 (summary brackets):** probe found **36 navy bracket elements**; detail screenshot confirms a thin span + straight-down leg (no triangle), label above in level-navy. Depth ramp navy `#2B3340→#46506A→#6E7790`, thickness 7/5/4, legs by row-height fraction.
- **✅ B211 (task fill):** probe found **11 solid + 24 outlined** gray task bars and **0** old health-colored bars — status is fill-only (hollow/partial/solid), bars all one gray hue; row-background still carries red/paused. Purple `SS` dependency line untouched.
- **✅ B212 (configurable columns):** "⊞ Columns" chooser opens; adding **Budget**/**Actual** makes them appear (header count 9→11); right-click header → context menu with **Insert column ▸** submenu; **per-project independence holds** — Budget on *Goose Creek* is absent on *Bee Sand Development* and persists on return. Both menus portal-mounted. 0 runtime errors throughout.
- **⏳ Steps for the one signed-in check (B212 cloud persistence):** sign in on planyr.io → Schedule → a project → **⊞ Columns** → show **Budget** (and reorder/resize a column) → **reload the page**. **Expect:** the column change is still there after reload (it persists via the same `setData`→`cloudSync` path as task edits). Try a second project: its columns are independent. **Why ⏳:** the sandbox proxy blocks sign-in, so logged-out self-tests can't exercise the cloud write — but logged-out the app shows the "changes will not save" banner, so persistence is never silently lost. Low-risk (same write path as task edits, already proven), but worth one signed-in confirmation.

### V40 — Scheduling grid: ↓ from last task → "+ New task" highlighted; Enter creates task + opens name edit ⏳
- **Added** 2026-06-18 · **Cadence** once (feature acceptance) · **Last checked** — · **Next check** on next session with browser
- **Steps:** Open scheduling app (`/sequence/index.html`). With a project open and tasks visible: (1) Click the last task row to select it. (2) Press ↓ — the "+ New task" row should get a blue left border, blue text, and light-blue background. (3) Press ↓ again — nothing should happen (stays on "+ New task"). (4) Press ↑ — focus returns to the last task (no blue on "+ New task"). (5) Press ↓ to return to "+ New task", then press **Enter** — a new task row is created AND the name input opens immediately with cursor focus. (6) Confirm ↑ from a non-last task still moves to the row above (existing behavior not broken).
- **Expect:** Blue highlight on the sentinel row, Enter creates task + auto-opens name edit, up-arrow exits sentinel to last real task.
- **Note:** Browser verification was punted in the *original* session because the Schedule app's CDN deps looked blocked. **Correction (2026-06-19, V46):** those CDNs **are reachable** in this environment — the Schedule app IS headless-verifiable by static-serving `public/` and loading `/sequence/` (it falls back to its embedded seed when logged-out). Use `ui-audit/verify-sequence.mjs` as the template; this V40 keyboard-nav case can now be driven headless on a future run rather than waiting for production.

### V39 — Easement drawing tool: 3 input modes + attributes + metes import (B150–B153) ✅ (self-verified) / ✅ (signed-in persistence)
- **Added** 2026-06-18 · **Cadence** once (feature acceptance) · **Last checked** 2026-06-20 ✅ (signed-in persistence, Cowork/real Chrome) · **Next check** —
- **✅ Signed-in persistence VERIFIED 2026-06-20 (Cowork — real signed-in Chrome on planyr.io, acct mikeabmab@live.com, cloud ON; deployed bundle SitePlannerApp-BuRTao7i.js).** Drew a centerline easement ("50′ Pipeline Esmt", 50′ width, hatched + color-coded, 40,375 sf) on a signed-in throwaway site. It saved as a `markups[]` entry (kind=`easement`) and **re-rendered on the canvas after a full reload + reopen-from-finder**. The signed-in residual is cleared.
- **Steps:** Site Planner → right rail **Easement** (▾ picks mode + default width/type). (1) **Centerline+width:** click a path, double-click/Enter → a strip of the set width appears, hatched + color-coded. (2) **Element** panel shows the easement attributes — change **Type** (the portal dropdown), edit **Width** (strip re-offsets), toggle **Status** (proposed → dashed) and **Restricts buildings/paving**; drag a centerline dot to reshape. (3) **Boundary polygon** mode: click points, close on the first dot. (4) **Offset from parcel edge** mode: with a parcel present, click its edges then **Create easement ⏎** → a one-sided inset strip. (5) **File ▾ → Title reader / metes & bounds…**, paste a legal description, **Plot as easement →**, click the POB. (6) **Yield** panel shows the **Easements** rows (gross / restrict buildings / restrict paving).
- **Expect:** each mode draws + labels + areas; the type dropdown floats above the rail (not clipped); width edits re-offset live; proposed renders dashed; the metes import spawns an editable easement.
- **✅ Self-verified 2026-06-18 (headless Chromium on `npm run build` + `vite preview`, logged-out):** centerline strip drawn (1 easement polygon); attributes panel auto-opened; portal **Type** dropdown opened and swapping to Sanitary Sewer relabeled it; boundary easement drawn (2 total); parcel drawn → parcel-edge hit-target was the topmost element at the click → strip created (3 total); metes-and-bounds "Plot as easement →" + POB click created an easement (panel shown, **0 page errors**); Yield shows the Easements row. Screenshots eyeballed (hatched, color-coded, label + area).
- **⏳ Still needs a SIGNED-IN check (cloud sync):** self-tests run logged-out (sandbox proxy blocks auth), so confirm an easement **persists across reload/devices when signed in** — it rides the existing `markups[]` Supabase save path (same as other markups, already proven), so this is a low-risk confirmation, not a new mechanism.

### V1 — Jurisdiction & road-authority identify (B93 / B94) ✅
- **Added** 2026-06-16 · **Cadence** once (feature acceptance) · **Last checked** 2026-06-17 ✅ · **Next check** done
- **Steps:** On planyr.io open a georeferenced site (or bring a parcel in from the map).
  Right panel → **🔍 Identify parcel** → click a lot → **⚖︎ Jurisdiction & road authority**.
- **Expect:** County / City (or "Unincorporated") / ETJ / Road maint. rows each render with
  a data-age. A City-of-Houston lot reads **Houston / Harris**; an unincorporated lot near
  Houston reads **Unincorporated + "Houston ETJ"**; the road row shows an authority (e.g.
  **State (TxDOT) · City**). **No CORS or network errors in the browser console.**
- **If it fails:** most likely a CORS block — a GIS host must allow the planyr.io origin.
  Note the failing host from the console. The feature degrades to honest "unknown"/error
  text, so a failure is visible, not silent.
- **2026-06-16 — data path verified live** (Node, calling the shipped functions against
  the production endpoints): downtown Houston → **Houston / Harris**, not in ETJ, road
  **City**; Spring → **unincorporated + Houston ETJ + Harris**; Sugar Land → **Fort Bend**.
  Field maps, normalization, the ETJ constant and county-key mapping are all correct
  against live data. **The browser layer was the only ⏳ — now ✅ too.**
- **✅ VERIFIED LIVE 2026-06-17 on planyr.io** (headless Chromium, logged-out). (1) **CORS/data
  from the planyr.io origin:** ran the feature's four GIS queries in-page for a downtown-Houston
  point — county `services.arcgis.com` → **200 "Harris"**, city `feature.geographic.texas.gov`
  (TxGIO) → **200 "Houston"**, ETJ COHGIS → **200, 0 features** (in-city, correctly not in ETJ),
  road TxDOT → **200, maint-agency 4 = City**. No CORS block from the production origin. (2)
  **On-screen render end-to-end:** brought a Houston Heights parcel in from the map → planner →
  **🔍 Identify parcel** → clicked the lot → **⚖︎ Jurisdiction & road authority** → the panel
  rendered **County: Harris · City: Houston · ETJ: not in Houston ETJ · Road maint.: City**, each
  with a data-age ("just now") and the "Screening only — verify with the jurisdiction" disclaimer.
  Screenshot evidence captured. The B93/B94 feature is shipped + working in the live app.
- **2026-06-17 — ETJ upgraded from Houston-only → regional, verified from the planyr.io origin.**
  Swapped the ETJ source to **H-GAC's regional layer** (all metro cities' ETJ). In-browser fetch
  from the planyr.io origin: Spring/Aldine → **Houston**, SW of Sugar Land → **Richmond** (HTTP 200,
  CORS-clean). So ETJ now covers the whole 13-county metro, not just Houston. (Post-deploy, the
  on-screen ETJ row reads e.g. "Richmond ETJ" for a non-Houston unincorporated lot; county/city/road
  were already statewide.)
- **2026-06-17 — ETJ extended to Austin + DFW, region-routed (data + CORS verified from origin).**
  ETJ is now a bbox-scoped list; a click only queries the metro it falls in, so **Houston still fires
  exactly one ETJ query** (unit test asserts this). Wired clean AGOL layers: **Austin** (City of Austin
  2-/5-mile ETJ) and **Fort Worth** (City of Fort Worth ETJ; Dallas is landlocked, ~no ETJ). Verified
  from the planyr.io origin: both CORS-clean + return features at real ETJ points (Austin: Del Valle /
  NW edge; Fort Worth: Alliance / SW). **Still ⏳ — on-screen click-through for an Austin/DFW lot:**
  the planner's parcel-identify there needs a working county CAD; do a live click in an Austin or
  Fort Worth ETJ area once the new build deploys, and confirm the ETJ row names the city.

### V2 — GIS stale-while-revalidate cache + data-age (B96) ⏳
- **Added** 2026-06-16 · **Cadence** once · **Last checked** — · **Next check** 2026-06-16
- **Steps:** Enable an OSM/Overpass evidence layer on the map, let it load, then **reload
  the page** with the same view.
- **Expect:** On reload the layer paints **instantly from cache** (no blank wait) and the
  Layers panel shows a **"refreshed Xm ago"** age that keeps counting; a background refresh
  swaps in fresh data. Confirms the cache survives reload (the old in-memory map did not).

### V3 — County-label correction on the statewide fallback (B36a) ⏳
- **Added** 2026-06-16 · **Cadence** once · **Last checked** — · **Next check** 2026-06-16
- **Steps:** Select a parcel that the statewide TxGIO source answers (a Fort Bend or border
  lot where the county CAD is slow/down). Open it into the planner.
- **Expect:** The saved site records the **true county** (Harris / Fort Bend), not a
  mislabeled "Chambers". Hard to force on demand — opportunistic; verify when a border/FB
  lot is handy.

### V5 — Opening a saved site is reliable (B64) ⏳
- **Added** 2026-06-16 · **Cadence** on-change + monthly · **Last checked** — · **Next check** 2026-07-16
- **Steps:** Open a saved site, zoom/pan to find its pin, then click it to enter the planner
  — repeatedly, especially right after a zoom.
- **Expect:** The open registers **every time** (no dropped click). A mitigation shipped but
  is UNVERIFIED; if it still drops, that confirms the map-level hit-test fallback is needed.

### V6 — No white flashing on zoom/pan (B65) ⏳
- **Added** 2026-06-16 · **Cadence** on-change + monthly · **Last checked** — · **Next check** 2026-07-16
- **Steps:** Open a site and zoom/pan hard, including big zoom jumps.
- **Expect:** No repeated white flash between frames (the paper backdrop holds). A partial
  fix shipped UNVERIFIED; if it persists, re-enable zoom animation / double-buffer next.

### V8 — UI/UX overhaul batch: parcel state + chrome (B97–B107) ⏳
- **Added** 2026-06-16 · **Cadence** once (feature acceptance) · **Last checked** — · **Next check** 2026-06-16
- Shipped code-verified + build-green, NOT browser-checked. Cohort to confirm each in the running app:
  - **B100 active/inactive** — in the planner, select a parcel → Parcel panel → **◯ Inactive**; expect it
    to render **dimmed + dashed**, drop out of Site area / coverage / FAR / detention, and the Yield panel
    to read "Excludes 1 inactive parcel." Toggle back to **✓ Active** restores it. New parcels start Active.
  - **B99 lock** — the always-on 🔒 badge is gone from the saved-parcel list; Lock/Unlock still works from
    the Parcel panel and a locked parcel can't be dragged/reshaped.
  - **B97 layers panel** — on map + planner, the **Map layers / Utility evidence / jurisdiction** group
    headers collapse on click (chevron + "N on" count), state persists across reload; panel fits without
    scrolling.
  - **B106 sites panel** — "Your sites · N" header collapses (persists); per-row **crosshair reveals on
    hover** (no inline delete button at all, per B168); zero-count status chips are hidden.
  - **B104 map header** — only **one** "Site Planyr" brand shows (shell header); the map bar reads
    "Find a site" + search + Start blank, no duplicate lockup.
  - **B167 + B168 map card** ✅ self-verified 2026-06-19 (headless, logged-out, `ui-audit/verify-mapcard.mjs`):
    no "Drag to move the map" bubble on load; project cards carry **no inline ✕**; **right-clicking a card
    (or map marker) opens one menu** with the five statuses (current checked) + a red **Delete project…**
    that routes through the existing confirm modal. Re-confirm signed-in that delete actually removes the site.
  - **B107 left tabs** — order reads **Yield · Parcel · Element · Aerial · Overlay · Setup**.
- **If any fails:** none are critical (no data risk) — log ❌ here with what looked wrong; fixes are small.

### V7 — 🌐 GIS endpoint liveness (no browser needed) ✅
- **Added** 2026-06-16 · **Cadence** monthly · **Last checked** 2026-06-16 (all 4 → HTTP 200 + fields: county 12 / city 11 / etj 6 / road 133) · **Next check** 2026-07-16
- **Steps (any session, curl):** probe each source root for HTTP 200 + JSON:
  - County `https://services.arcgis.com/KTcxiTD9dsQw4r7Z/arcgis/rest/services/Texas_County_Boundaries/FeatureServer/0?f=json`
  - City `https://feature.geographic.texas.gov/arcgis/rest/services/City_Boundaries/Texas_City_Boundaries/MapServer/0?f=json`
  - ETJ `https://services.arcgis.com/NummVBqZSIJKUeVR/arcgis/rest/services/COH_ETJ_view/FeatureServer/1?f=json`
  - Road `https://services.arcgis.com/KTcxiTD9dsQw4r7Z/arcgis/rest/services/TxDOT_Roadway_Inventory/FeatureServer/0?f=json`
- **Expect:** all 200 with a `fields` array. County/city GIS hosts move occasionally — if one
  404s/moves, re-point its row in `src/workspaces/site-planner/lib/jurisdiction.js`.

### V9 — Attach & mark up a drawing on a parcel (B67) ✅ attach + sheet-picker + cloud persistence / ⏳ markup-draw not driver-testable
- **Added** 2026-06-16 · **Cadence** once (feature acceptance) · **Last checked** 2026-06-20 ✅ (Cowork + owner did the OS file-pick) · **Next check** —
- **✅ Mostly VERIFIED 2026-06-20 (Cowork signed-in + owner did the OS file-pick).** Selected Parcel 1 → Parcel panel → **＋ Attach a drawing** → picked a 2-page PDF: the **"Pick a sheet" dialog listed both pages**; chose p.1 and the sheet **rasterized as an immutable backdrop named "<file> — p.1"** (saved to `parcelDrawings[]` with a cloud `storageKey`). After a **full reload + reopen-from-finder** the drawing **reloaded from the cloud and the backdrop re-rasterized** in the editor (Pen / Line / Box / Text / Measure / Scale toolbar all present). So attach → multi-page sheet-pick → rasterized backdrop → save-with-parcel → cross-reload persistence are confirmed live, signed-in.
- **⏳ Not directly driven:** drawing markups on the sheet + their persistence — the markup editor's draw interactions don't register through the browser-automation layer (drags read as clicks; text placement doesn't focus), the same input limit hit on the planner canvas (not an app bug). Markup persistence rides the same `markups[]` cloud path already proven for the easement (V39), so it's covered by analogy; a human drawing one markup + reload would fully close it.
- **NB (tooling):** the parcel-drawing file `<input>` can't be filled programmatically (synthetic upload doesn't stick; the native file dialog is suppressed under automation), so this attach needs a real OS file-pick by a human — relevant for future verification runs.
- **Steps:** Open a site, select a **parcel** → Parcel panel → **"＋ Attach a drawing (PDF / JPG)"**
  → pick a real **multi-page** engineering PDF (then also a JPEG). For the multi-page PDF a
  **"Pick a sheet"** dialog should list every page — choose one. Draw with **Pen / Line / Box /
  Text**, recolour, **Select** + **Delete**, **zoom (wheel) + pan (drag in Select)**, click
  **Done**, reopen the drawing, then **reload the page**.
- **Richer markup (increment 2c) — also verify:** in **Select**, **drag an existing markup** to
  reposition it (cursor shows move); **double-click a Text** markup to edit it. Click **Scale**,
  draw a line along a known dimension, enter its length in feet → then **Measure**: draw lines and
  confirm they label the **real length in feet** (teal chip); the scale + markups persist on reload.
- **Expect:** the **chosen** sheet rasterizes as an **immutable backdrop** (named "<file> — p.N");
  markups stay **locked to the drawing** through zoom/pan (stored pixel-relative); multiple
  drawings list under the parcel; markups **persist** across reopen + reload (signed in, same
  device). `ui-audit/screens/parcel-drawing.png` shows the modal headless (an SVG stand-in, not a
  real PDF) — this step confirms it with a real file, including the page-picker.
- **Cross-device (increment 2b, landed 2026-06-16) — please test:** signed in, attach a drawing on
  device A; on **device B** (or after clearing local cache) open the same site + drawing → the
  backdrop should **rebuild from cloud Storage** ("Loading the drawing from the cloud…", then it
  appears with its markups). The source file is uploaded to the private `doc-review-files` bucket at
  `<uid>/parcel-drawings/<siteId>/<drawingId>.<ext>`; on reopen without a local raster it re-fetches +
  re-rasterizes the stored sheet. Deleting a drawing removes its stored object. **Fallback:** logged
  out / >50 MB / upload error → keeps the local raster + the old "re-attach" placeholder cross-device
  (markups always persist), so nothing regresses.
- **Increment 2a (multi-page sheet picker) also landed** — verify the "Pick a sheet" dialog lists all
  pages and attaches the chosen one.

### V10 — Snap defaults OFF; toggle + Alt hold-to-suppress (B114) ⏳
- **Added** 2026-06-16 · **Cadence** once (feature acceptance) · **Last checked** — · **Next check** 2026-06-16
- **Steps:** (0) Open **any** site — incl. an existing one made before this change — and confirm the
  toolbar pill reads **`Snap off`** (grey dot) and dragging a road up against trailer parking does
  **not** stick to its edge (it lands where you drop it). (1) Press **S** (cursor on the canvas, not
  in a text field) → pill flips to **`Snap 10′`** (green dot); now the road flush-snaps to the edge.
  (2) **Hold Alt** and drag it to a deliberate ~15-ft gap and drop — with snap on, Alt still places
  it freely for that one move; release Alt and snapping is back. (3) Click the toolbar **Snap** pill —
  same toggle as S. (4) Turn snap on, **switch to another site / reload the page** → snap stays **on**
  (the choice persists); turn it off → stays off. (5) With snap on, resize a box / rotate it (grid /
  15° steps) vs. Alt-held (smooth/free).
- **Expect:** Snap starts **OFF for every site** (free movement is the default, even on old sites that
  had snap baked in). The **S** key, the pill, and the Setup checkbox all toggle one **global**
  preference that persists across sites/reloads. Alt suppresses snapping for just that one drag and
  re-enables on release; "off" fully disables grid snap, neighbour flush-snap, resize-to-grid and
  rotate-to-15°. **Shift-drag still bonds to a neighbour** (the green +) regardless of the toggle.
- **If it fails:** none critical (no data risk) — log ❌ here with what looked wrong.

### V11 — Phone layout (B113) + "Cloud off" affordance (B111) ⏳
- **Why ⏳:** verified headless at 390×844 (`planner-mobile.png`, `planner-mobile-tools.png`,
  `planner-mobile-panel.png`) but real touch + rotation want a live click-through.
- **Steps (B113, on a phone or a ~390px-wide window):** open a site in the planner. The canvas
  should fill the width (not a sliver). Tap the orange **"✎ Tools"** button (bottom-right) → the tool
  palette **slides in from the right**; pick a tool → it **auto-closes** so you can draw; tap the dim
  backdrop to dismiss it. Tap a left-rail button (Yield/Parcel/…) → its panel **overlays** the canvas;
  tap the same button to close. Rotate to landscape and back. The top header should **scroll
  sideways**, not wrap onto two lines.
- **Expect:** at desktop width everything is exactly as before (the mobile styles are width-gated).
- **Steps (B111):** load a build with **no Supabase env** (cloud unconfigured). The top-right account
  corner should show a muted **"⊘ Cloud off"** pill (not empty); click it → a popover explains work is
  saved on this device only. (A configured build still shows the normal Sign in / account button.)

### V12 — Site Planner measurement tools: Length / Polylength / Area (B116) ⏳
- **Added** 2026-06-16 · **Cadence** once (feature acceptance) · **Last checked** — · **Next check** 2026-06-16
- **Steps:** Open a site in the Site Planner. Right rail → **Measure** (the `▾` opens the mode menu:
  **Length / Polylength / Area**). (1) **Length:** click two points → expect a teal line labeled the
  real distance in feet (e.g. `462′`). (2) **Polylength:** click several points along a path, then
  **double-click or Enter** to finish → expect the running path length in feet. (3) **Area:** click
  points around a region, close by clicking the first dot (or double-click) → expect a filled polygon
  labeled **`<sf> sf · <ac> ac · <perim>′ perim`** (e.g. `12,300 sf · 0.28 ac · 462′ perim`). Then
  with **Select**, click a measurement to select it and use the **×** to delete it. Press **Esc**
  mid-draw → the in-progress measurement cancels.
- **Calibration path:** drop an **aerial/screenshot** underlay but do **not** calibrate it → with the
  Measure tool active, expect the **"⚠ Underlay isn't calibrated — distances may be wrong"** banner and
  measurement labels rendered in **amber with a ⚠**. Calibrate the underlay (Aerial ▾ → Calibrate) →
  labels return to normal (teal) and read true feet.
- **Expect:** all three modes draw, label, select, and delete; labels persist across reopen + reload
  (signed in); the amber/⚠ uncalibrated warning behaves as above. This shipped code-verified +
  build-green (B116 was already implemented in `SitePlanner.jsx`; only the mode names were aligned to
  Length/Polylength/Area) — this step confirms it in the running app.
- **If it fails:** not critical (no data risk) — log ❌ here with what looked wrong.

### V13 — ★ Persistence: saved work must never disappear (B124 / B125) — durability ✅ / resume-into-planner ❌ — HIGH PRIORITY
- **Added** 2026-06-16 · **Cadence** once (data-safety acceptance) + on-change · **Last checked** 2026-06-20 (Cowork, signed-in) · **Next check** on-change
- **2026-06-20 (Cowork — real signed-in Chrome on planyr.io, cloud ON; deployed bundle SitePlannerApp-BuRTao7i.js, Supabase HTTP 200 each boot, no console errors):**
  - **✅ Data durability (the critical part):** drew 3 buildings on a signed-in throwaway site; "Synced ✓"; the site + every element survived **~6 reloads** and reopened intact from the finder. Work never disappeared on its own.
  - **❌ Resume-into-planner (step 2):** every reload — **soft (F5) AND hard (Ctrl+Shift+R)**, on a brand-new site AND an established/reopened site — lands on the **map/finder**, NOT the open planner. Confirmed at the storage layer: `currentSite:v1` holds the open site's id going *into* the reload, and boot **nulls it** and shows the finder; even force-setting `currentSite:v1` in localStorage then reloading still nulled it → finder. No crash, no data loss — but it contradicts the written "resume straight into the planner, NOT bounced to the map" expectation. (Matches the prior "reload bounces NEW sites to finder" note, but now reproduces for established sites too.)
  - Steps 4 (DevTools offline) & 5 (signed-out→sign-in bridge) not run: the offline toggle isn't drivable via the browser tools, and re-sign-in requires a password Cowork won't enter. Worth a manual pass.
- **Why this matters:** this is the fix for the owner-reported data-loss scare — work vanishing on its
  own a couple minutes after a reload. Root cause: `pullCloud` rebuilt the local cache from the cloud
  list **alone** and silently dropped any not-yet-synced local site; the resume then couldn't find the
  open site and bounced to the map. Confirm in a real browser that saved work is now durable.
- **Steps (signed in, on planyr.io):**
  1. Sign in. Open or create a site, add a **building**; wait for the header badge to read **"Synced ✓"**.
  2. **Reload** → you **resume straight into the planner** on that site (NOT bounced to the map) and the
     building is still there.
  3. **Switch to another browser tab for ~2–3 minutes, then return** (refocus the Planyr tab) → the site
     + building must **still be there** and you are **not** bounced to the map. (This is the exact
     "disappears on its own" trigger — a background re-sign-in event firing the cloud re-pull.)
  4. **Forced not-yet-synced repro (DevTools):** Network tab → **Offline**. Add another building → a
     **loud red banner** ("your last change didn't reach the cloud … **Retry now**") appears and the badge
     reads Offline/Unsaved. **Reload while still offline** → the building is **still there** (not dropped).
     Go back **Online** → it syncs (badge → "Synced ✓") and the red banner clears.
  5. **On-device → account bridge:** while **signed out**, create a site (saved on this device only).
     **Sign in** → a blue banner "You have N site(s) saved on **this device** that aren't in your account
     yet" appears; click **"Bring them into my account"** → the site joins the account list and the banner
     clears. The signed-out copy is **kept** (non-destructive).
- **Expect:** work **never disappears on its own**; reload resumes the open site; a failed cloud save is
  **loud** (red banner + Retry), never silent; the on-device import copies sites into the account without
  deleting the originals. No data is lost across reload, tab-refocus, offline, or sign-in/out.
- **If it fails:** this is the one **CRITICAL** class — if saved work still vanishes, flag it immediately
  (note the exact step + the browser console), don't just log-and-move-on.

### V14 — Draw-tool rail: scrolls to the bottom on desktop + denser rows (B117 / B118) ⏳
- **Added** 2026-06-16 · **Cadence** once (fix acceptance) · **Last checked** — · **Next check** 2026-06-16
- **Steps:** Open a site in the Site Planner on a normal laptop-height window (a ~13–15″ screen is the case
  that overflowed — not a tall external monitor). Look at the dark right-hand tool rail (**Tools / Site
  elements / Shapes / Measure / Annotate**). (1) **Reach the bottom (B117):** scroll the rail → expect it to
  scroll cleanly all the way to the last row, so the **Shapes** group and **Measure / Annotate** below it are
  reachable; nothing is stranded off-screen with no scrollbar. (2) **Density (B118):** the two-line buttons
  (Building / Car Parking / Road / Paving / Trailer Parking / Detention Pond, plus Measure) read tighter —
  less vertical padding and the small grey sub-label ("single-load", "drive / court", "24′ travel",
  "back-in storage", "detention basin") one step smaller — and the whole **Site elements** group should now
  fit without scrolling on a standard laptop.
- **Expect:** every tool in the rail is reachable at any window height; the rail reads as one consistent,
  denser column with rows still comfortably clickable (~40px); the **▾** preset menus (dock layout / parking
  rows / road width / measure mode) still open and pick correctly. The phone layout (narrow width, B113) is
  unchanged — the rail still slides in as an overlay there.
- **If it fails:** not critical (no data risk) — log ❌ here with the window height and what was unreachable or mis-sized.

### V16 — Rail/header dropdowns open fully visible, not clipped behind the rail (B127) ⏳
- **Added** 2026-06-17 · **Cadence** once (fix acceptance) · **Last checked** — · **Next check** 2026-06-17
- **Why:** the Measure mode menu (and the other rail/header flyouts) used to paint **behind / clipped by** the
  tool rail after B117 made the rail scroll (`overflow:auto`). Fix = render every such menu in a **portal** at the
  document root (`src/shared/ui/AnchoredMenu.jsx`), so it escapes the rail's clipping + stacking context. Needs a
  real browser to confirm it now floats above everything and still picks correctly.
- **Steps (planyr.io, desktop):** Open a site in the Site Planner.
  1. **Measure ▾** (the caret next to the Measure tool's mode label) → the menu opens **fully visible**, above the
     rail **and** above the map's +/– zoom-control rail to its left; **Length / Polylength / Area** are all clickable
     and selecting one updates the tool's sub-label. (This is the exact NEW-3 repro.)
  2. Repeat for the other rail flyouts — **Boundary ▾**, **Building ▾** (dock layout), **Car Parking ▾** (rows),
     **Road ▾** (width): each opens to the left of the rail, fully on-screen, nothing clipped; picking an option works.
  3. Header menus — **Site ▾**, **Plan ▾**, **File ▾**: each opens below its button, fully visible above the canvas;
     typing in the Site/Plan **name field** still works (focus lands in the input); **File ▾ → Import JSON…** still
     opens the file picker.
  4. **Click-away + scroll:** clicking anywhere off an open menu closes it; with a menu open, the rail can't be left in
     a half-open state. On a **short laptop-height window**, the menus still land on-screen (clamped into the viewport),
     not cut off at the top/bottom.
  5. **Phone width (~390px):** open the slide-in tool rail (✎ Tools) → Measure ▾ still opens above everything and is
     usable.
- **Expect:** no dropdown is ever clipped or hidden behind the rail / zoom rail; all open above the map; every option
  selects; placement + widths look the same as before (just no longer cut off).
- **If it fails:** not critical (no data risk) — log ❌ here with the menu, window size, and what was clipped/mispositioned.

### V17 — Parking hugs the building: orientation + outward growth (B119 / B120) ⏳
- **Added** 2026-06-16 · **Cadence** once (feature acceptance) · **Last checked** — · **Next check** 2026-06-16
- **Steps:** Open a site, draw a **building**, select it, and add a **parking** row on one side (the
  per-side "add parking" control). (1) **Orientation (B119):** the **first stall row should sit directly
  against the building face**, with the **24′ drive aisle on the outside** (not the aisle against the
  wall). (2) **Growth (B120):** press the parking **＋** repeatedly — the field should grow **outward,
  away from the building**, one row at a time, depth reading **42 → 60 → 102 → 120 → 162 → 180′**
  (double-loads the aisle before adding a new one); **−** reverses it. (3) The element panel's **"Drive
  aisle on the far side"** checkbox should start **checked** and still flip the layout if unticked.
- **Expect:** stalls hug the wall, aisle outboard, field grows away from the building, +/− steps match the
  sequence. Shipped code-verified + build-green (152 tests pass); this confirms it on screen.
- **If it fails:** not critical (no data risk) — log ❌ here with what looked wrong.

### V18 — Auto-numbered building labels: "Building N" + renumber-on-delete (B122) ✅
- **Added** 2026-06-16 · **Cadence** once (feature acceptance) · **Last checked** 2026-06-17 ✅
- **Steps:** Open a site in the Site Planner. Place a **Building** → its label reads **"Building 1"**
  (above its sf and dimensions). Place a second and third → they read **"Building 2"** then
  **"Building 3"** in placement order. Now **delete "Building 2"** → expect the old "Building 3" to
  re-label **immediately** as "Building 2" (numbers stay contiguous 1…N, no gap). Add another → it
  appends as the next number. A site with a **single** building still reads "Building 1".
- **Identity check (the important one):** give a building attached **parking** or a **bump-out**, then
  delete a *lower-numbered* building so this one renumbers. Confirm the attached pieces stay attached and
  nothing re-points — attachment binds to the hidden stable id, not the visible number, so a renumber
  must never detach or mis-link anything.
- **Expect:** every visible building label updates in one pass on delete; non-building elements
  (car parking, paving, roads, detention ponds, sidewalks) are unaffected; bump-out pieces don't get
  their own number.
- **Result ✅ (2026-06-17, self-verified headless Chromium on the built artifact):** drew three buildings
  → labelled **Building 1 / 2 / 3** in placement order; selected the **middle** one (Building 2) and
  deleted it → the former **Building 3 renumbered to Building 2** (same 156,735 sf / 457′×343′ — identity
  unchanged), leaving a contiguous {1, 2} with no gap. Screenshot eyeballed; the static 4-line stack
  (name / sf / dims) rendered correctly too. (Attached-piece identity on renumber wasn't separately driven,
  but identity is keyed on the stable `el.id`, which the delete leaves untouched.)
- **If it fails:** not critical (no data risk) — log ❌ here with what looked wrong.

### V19 — Site element labels: no overlap pile; level-of-detail on zoom-out (B121 increment 1) ⏳
- **Added** 2026-06-16 · **Cadence** once (feature acceptance) · **Last checked** — · **Next check** 2026-06-16
- **Steps:** Open a site and lay out adjacent elements (a big building, a narrow trailer strip beside it,
  a detention pond, a couple of sidewalks). (1) **Zoomed in:** each element shows its full centred label
  (name + sf/count + dimensions) as before. (2) **Zoom out:** labels should *thin out*, not pile up — the
  dimensions line drops first, then the area line, leaving the name; the **narrow trailer strip** should
  drop to just its name (or hide) rather than spilling a 3-line label past its ~50′ width. (3) **Crowd
  test:** push several labelled elements close together and confirm their centred labels no longer
  overprint into an unreadable stack — a lower-priority label yields (shrinks or disappears) to the
  bigger / building label rather than stacking on top. Zoom back in → the hidden labels return.
- **Expect:** no two centred element-name labels overprint at any zoom; buildings / bigger elements keep
  their labels; nothing crashes; non-labelled elements (paving / parking / roads) are unaffected.
- **Known-not-yet (increment 2 — do NOT fail for these):** the **red edge-dimension ticks** ("300′",
  "638′") are still a separate layer and may overlap the centred names; no leader lines yet. Tracked under B121.
- **If it fails:** not critical (no data risk) — log ❌ here with what looked wrong (especially a label
  that vanished when it had room, or a pile that remained).

### V21 — Building label is a 4-line stack; square footage persists on zoom-out (B123) ⏳
- **Added** 2026-06-16 · **Cadence** once (feature acceptance) · **Last checked** — · **Next check** 2026-06-16
- **Steps:** Open a site, draw a **building** (rectangle), and add a **bump-out** or two (the purple ＋ at a
  dock corner). Its label should read as a 4-line stack: **"Building N"** / **"198,000 sf"** (its own line) /
  **"(incl. 2 bump-outs)"** / **"300′ × 638′"**. (1) **Wording:** the bump-out line reads **"(incl. 2
  bump-outs)"** — not the old "+2 bump-outs" — and there is **no** parenthetical line on a building with no
  bump-outs. (2) **Zoom out:** the **dimensions** line drops first, then the **(incl. …)** line, leaving
  **name + square footage** down to fairly small sizes; the square footage should **outlast** the dimensions
  (the old behavior dropped sf too early). Only at extreme zoom-out does it fall back to just the name.
- **Expect:** square footage no longer vanishes early; the 4 lines appear in that order; the parenthetical is
  conditional; the sf matches the yield panel's building total. Non-building labels are unaffected.
- **If it fails:** not critical (no data risk) — log ❌ here with what looked wrong (e.g. sf still dropping
  before the dimensions, or wrong wording).

### V22 — Red edge-dimension callouts hide when zoomed out (B121 round 2a) ⏳
- **Added** 2026-06-16 · **Cadence** once (feature acceptance) · **Last checked** — · **Next check** 2026-06-16
- **Steps:** Open a site with a building / road / paving element (these carry the red short-side dimension
  tick, e.g. "300′" / "24′"). (1) **Working zoom:** the red dimension callout shows exactly as before.
  (2) **Zoom out** until the site is small on screen → the red dimension ticks **drop away** (rather than
  shrinking into illegible marks that overlap the centred name labels). (3) **Zoom back in** → they return.
- **Expect:** at normal/zoomed-in working zoom nothing changed; only when zoomed out (past ~0.18 px/ft) do the
  red dimension callouts hide. The centred name/sf labels are governed separately (B121 increment 1) and are
  unaffected by this gate.
- **Known-not-yet (do NOT fail for these):** at working zoom the dimension callouts can still overlap a
  centred name on very crowded layouts (not yet in the collision pool), there's no explicit show/hide toggle,
  and no leader lines — all tracked under B121 increment 2.
- **If it fails:** not critical (no data risk) — log ❌ here (e.g. dims vanishing at working zoom = threshold
  too high; still piling when zoomed out = gate not applied).

### V23 — Warning toasts: a newer message isn't blanked early by an older one (B56b) ⏳
- **Added** 2026-06-17 · **Cadence** once (bugfix) · **Last checked** — · **Next check** 2026-06-17
- **Steps:** Trigger two bottom-banner warnings in quick succession. (1) Pop a long one (finish a metes/POB
  **encumbrance** plot, ~9 s banner) then immediately a shorter one (e.g. Calibrate with no underlay, or start a
  utility route with no building) — confirm the **second message stays up its own full time** and isn't wiped a
  few seconds early by the first one's timer. (2) Open a sticky instructional prompt right after a transient
  warning (utility routing → **"Now click the building to serve."**) — it should **persist until you act**, not
  auto-clear from the prior timer. (3) Start a ditch **cross-section**, then click again to begin a second while
  the first is still sampling — the second click is ignored (no double run / flicker).
- **Expect:** the visible warning always reflects the latest message for its own duration; sticky prompts persist
  until the next action; no cross-section double-run.
- **If it fails:** not critical (cosmetic/UX, no data risk) — log ❌ here with what looked wrong.

### V24 — "Print overlay" toggle includes the site-plan overlay in the print/export, exactly as shown (B131) ⏳
- **Added** 2026-06-17 · **Cadence** once (feature acceptance) · **Last checked** — · **Next check** 2026-06-17
- **Steps:** Open a site, left rail → **Overlay** → drop a site-plan PDF and place / scale / rotate it (set
  opacity < 1 so the aerial shows through). Export menu → **Print / pick frame…**. In the print-frame toolbar,
  confirm a **"Print overlay"** checkbox appears between Orientation and Print (and is **absent** when no overlay
  is loaded). (1) Leave it **checked** → **Print** → the overlay appears in the print/PDF preview at the **same
  position, scale, rotation and opacity** as on screen, **above** the aerial, with **no** selection handles or
  outline. (2) Re-open, **uncheck** it → **Print** → the overlay is gone but parcels / massing / metrics print
  normally. (3) Repeat with an **aerial underlay** present (open a parcel from the map first) — the overlay is
  honored both ways (it used to silently vanish whenever an underlay existed). (4) Export menu → **Export PNG** →
  the visible overlay is included in the image.
- **Expect:** checkbox shown only when an overlay is loaded; defaults to match on-screen visibility (checked);
  checked = WYSIWYG overlay in the output; unchecked = no overlay; editor chrome (handles, the "re-add me"
  placeholder) never prints; PNG export includes the visible overlay.
- **If it fails:** not critical (export-only, no data risk) — log ❌ here with what looked wrong (overlay missing
  when checked, handles printing, or wrong position / scale / rotation / opacity).

### V25 — Detention pond expansion: lock-as-existing baseline + storage gained (B132) ⚠️ SUPERSEDED by V30 / B139
- ⚠️ **Superseded 2026-06-17 by V30 / B139.** The "Lock as existing pond" button this verified was replaced by the **"Expand this pond"** mode (B139) — that exact flow no longer exists. The detention math + dashed ghost it checked live on and were re-verified under V30. No action; kept for history.
- **Added** 2026-06-17 · **Cadence** once (feature acceptance) · **Last checked** — · **Next check** 2026-06-17
- **Steps:** Open a site, draw a **Detention Pond** (rectangle or click-points irregular). Select it → the right
  panel's **Detention storage** section now ends with a **"Lock as existing pond"** button. (1) Click it → a toast
  confirms the lock and a faint **dashed ghost** of the current outline appears under the pond. (2) Drag a corner /
  edit a vertex to **enlarge** the footprint (and/or raise **Total depth**) → an **"Expansion vs. existing"** box
  shows **Existing storage**, **Proposed storage**, and a green **"Storage gained +X.XX ac-ft"** (plus cf) that
  updates live as you drag. (3) **Shrink** the pond below the baseline → the line flips to red **"Storage lost"**.
  (4) **Clear** → ghost and the comparison box disappear; depth/freeboard/slope are retained. (5) Save, reload the
  site → the locked baseline (ghost + numbers) persists. (6) **Rotate** the pond before locking, then enlarge → the
  ghost stays aligned to the real (rotated) original outline, not offset.
- **Expect:** the gain equals proposed − existing computed with the SAME depth/slope method (so it's apples-to-
  apples); ghost lands exactly on the original outline for both rectangle and irregular ponds, rotated or not;
  numbers and ghost survive reload; "screening only — confirm with your civil engineer" caveat shown.
- **If it fails:** not critical (screening estimate, no data-loss risk) — log ❌ here with what looked wrong (ghost
  offset/rotated, gain number not updating, baseline lost on reload).

### V28 — ★ Boot fix: no stale-plan flash on reload; signed-in resume shows the latest (B134) ❌ / BLOCKED — HIGH PRIORITY, SIGNED-IN ONLY (the "limit")
- **❌ / can't-confirm 2026-06-20 (Cowork — real signed-in Chrome on planyr.io, cloud ON; deployed bundle SitePlannerApp-BuRTao7i.js, Supabase HTTP 200, no console errors).** The premise of this test — a signed-in reload that *resumes into the planner* — **doesn't happen**: every reload (soft + hard) lands on the **finder**, and `currentSite:v1` is nulled on boot even when force-set (see V13). So the "no stale/thin plan flash on resume" can't be exercised — there's no resume to flash. Data is intact and reopenable. This needs the underlying resume-into-planner behavior fixed first (see V13/V28 cross-ref) before the flash question is even reachable.
- **Added** 2026-06-17 · **Cadence** once (data-display acceptance) + on-change · **Last checked** — · **Next check** 2026-06-17
- **Why a signed-in coworker must run this — the one thing this session could NOT self-verify.** The fix lives entirely on the **signed-in boot path**: `SitePlannerApp` bumps a `loadEpoch` after `applyUser`'s `pullCloud`, folded into the planner's `key`, so the keyed planner re-reads the freshly-merged cloud copy instead of lingering on the stale pre-auth one. Per the testing policy at the top of this file, the sandbox egress proxy **CORS-blocks the Supabase auth handshake**, so the in-session headless run is **logged-out only** — it confirmed the build (lint 0 · 197 tests · build green) and that logged-out behavior is byte-identical (the fix is gated to the signed-in branch; `loadEpoch` stays 0), but the actual signed-in resume can't be exercised here.
- **Already confirmed live (no browser):** shipped via **PR #103** → `main` and **deployed** — planyr.io serves `index-DVWCJQ1q.js` / `SitePlannerApp-BUX0faXJ.js`; cloud still ON (Supabase URL baked in); Version history + "Retry now" intact.
- **Steps (SIGNED IN, on planyr.io):**
  1. Sign in. Open a site and add several **buildings** so the plan is materially bigger than its last cloud copy; wait for the header badge to read **"Synced ✓"**.
  2. **Hard-reload** (`Ctrl+Shift+R`) — several times — watching the canvas the instant it paints.
  3. **Expect:** it resumes **straight into the latest plan** (full building count) with **no flash of an older/thinner version first** and **no bounce to the map**. (The bug being fixed: a split-second older copy painted on load, then "came back on its own.")
  4. **"Disappears on its own" trigger:** switch to another tab for ~2–3 min, then return / refocus the Planyr tab → still the latest plan, no flash, no bounce.
  5. **Two-source sanity:** if this device's local cache holds a thinner copy than the cloud, boot must still end on the **fuller merged** copy, never the thin one.
- **Expect:** at no point does an older / thinner plan appear, even for one frame; the resumed plan is always the newest merged copy. This is the **display half (cause #5)** of the persistence data-loss work.
- **If it fails:** **data-display class** — if an older plan still flashes or sticks on reload, record the exact step + the browser console + whether the badge read "Synced ✓" first, and flag it (don't log-and-move-on).
- **Cross-refs:** **V13 / V15** (the durability halves — B124 / B126, work must never actually disappear), **B134** (this fix's item — its causes #3/#4, work that never reaches any store, remain open), **B125** (the still-open honest save-status / `beforeunload` guardrail for that never-saved case), **B136** (the one-time SCHIEL recovery).

### V29 — Fort Bend parcels are clickable, not just visible (B137) ✅
- **Added** 2026-06-17 · **Cadence** once (bugfix) · **Last checked** 2026-06-17 ✅ · **Next check** done
- **✅ VERIFIED LIVE 2026-06-17 on planyr.io** (headless Chromium, logged-out). Geocoded to Sugar Land (Fort
  Bend), entered **Select parcels**, clicked a lot → it **selected on the first click**: the selection card
  read **"1 parcel · 0.34 ac · Highway 90A"** with the orange highlight, and **"No parcel right there" never
  fired**. The browser console confirmed `gis.fbcad.org/serverarcgis2/.../layers` was **CORS-blocked /
  unreachable** (FBCAD down, as at fix time) — so the lot selected **purely via the statewide TxGIO fallback**,
  which is exactly the B137 fix. Screenshot evidence captured. (Signed-in county-label relabel — B36a / V3 —
  still rides the same code path; not re-exercised here since auth is CORS-blocked in the sandbox.)
- **Steps:** Map view → "＋ Select parcels" → pan to a **Fort Bend** area (e.g. Sugar Land / Rosenberg /
  Richmond) and zoom in until purple parcel outlines paint. (1) Click directly on a lot → it should
  **select** (orange highlight + the selection card shows acreage), NOT pop "No parcel right there." (2)
  Click it again → it deselects. (3) Confirm a **Harris** lot still selects exactly as before (no regression).
  (4) Plan the selected Fort Bend lot → the planner hand-off should record **county = fortbend** (the B36a
  relabel runs because the hit came via the statewide TxGIO layer).
- **Expect:** any displayed Fort Bend outline is selectable; Harris unchanged; the saved site's county reads
  Fort Bend. Works even though FBCAD's own host may be down — the statewide TxGIO layer answers the click.
- **Note:** FBCAD (`gis.fbcad.org/serverarcgis2`) was returning HTTP 503 at fix time; if it comes back up the
  county CAD will answer first and TxGIO stays the fallback — either way the lot must select.
- **If it fails:** if a clearly-outlined Fort Bend lot still won't select, that's a real regression — log ❌
  here with the coordinate; otherwise note what looked off (no data risk).

### V45 — Project Files drawer opens from Row 1; saved-views/cascade engine (B180–B183) ⏳ signed-in pass due
- **Added** 2026-06-19 · **Cadence** once (feature acceptance) · **Self-verified 2026-06-19** (headless Chromium, logged-out preview build), signed-in list pass still owed
- **Self-verified (logged-out) — ✅ PASS, no errors from this code:** confirmed the new **🗂 Files** pill renders in **Row 1** (next to the project name, NOT a fourth tab) and opens the **Project Files** drawer in **BOTH** workspaces — the **Markup** (Document Review) module **and** the **Site Planner** (Plan mode, the planner's `centerContent` — added 2026-06-19 after the owner reported the pill was missing from the Site workspace where he was working; note Row 1 is intentionally empty on the Site Planner's *map finder*, so the pill shows once a plan is open). Logged-out both correctly show the **"Sign in to browse your project files"** gate (`ui-audit/screens/files-siteplanner.png`). The only console errors were pre-existing GIS CORS noise — unrelated. Engine is covered by **33 unit tests** (`fileFacts` 15, `placeOnMap` 10, `verifyPlacement` 8); full suite **318 tests** + lint 0 + build green; doc-review lazy chunk split intact.
- **⏳ Owed (signed-in, can't run in-sandbox — auth is CORS-blocked here, never a Michael to-do):** with a signed-in account that has filed reviews (B14/B180), confirm: the drawer lists files grouped by **discipline**; **saved-view chips** ("All surveys", "Title commitments", "Civil set", "Reference docs", "Needs filing") filter correctly; the **cross-project** toggle widens a per-project view; each file shows its **document-class tag** (spatial / reference / spatial+reference for title commitments) and **Filed/On-map** badge; **drop a PDF** files it under the active project; **"Place on map"** on a spatial file shows the cascade plan (today: lands on **manual calibration** and lists why the higher rungs are skipped, since the auto-filing backend isn't wired — that's the expected honest state).
- **Note:** the auto-filing index (title-block read → placement facts), the NEW-3 rung-1/2 geometry, and the NEW-4 auto-probe data source all wait on the backend tranche by design (stubbed behind `createIndexProvider`); this V45 covers only the shipped browser-first tranche.

## ✅ Verified / ❌ Failed — history
_Move items here with the date and who/what checked them._

### V41 — Grab an unfilled markup shape by its INTERIOR, not just the border line (B155 increment 1) ✅
- **Added** 2026-06-18 · **Checked** 2026-06-18 — self-verified, headless Chromium (built artifact via `vite preview`) · **Cadence** once (fix acceptance)
- **Why:** owner-reported — selecting a markup rectangle was "kinda difficult, you have to grab exactly on the line." Cause: closed shape markups (`rect`/`ellipse`/`polygon`) rendered `fill:"none"` with selection on the element's own `onPointerDown`, so only the painted 2px stroke was a click target. Fix: `pointerEvents:"all"` on those shapes (same technique B142 used for text/callout boxes) so the **whole interior** is a hit target even when unfilled. Applied in `SitePlanner.jsx` and `components/ParcelDrawing.jsx` (the Box tool).
- **Steps (Site Planner):** "Start blank" → **Rectangle** tool (R) → dragged an unfilled box → **Escape** (deselect) → clicked the rectangle's **interior centre** (not the border).
- **Result ✅:** the drawn `<rect>` carries `pointer-events="all"` with `fill="none"` (interior is a hit target). Selection handles (the rotate `circle[r="6"]`) read **1 after draw → 0 after Escape → 1 after the interior click** — i.e. clicking inside the empty box re-selected it; the "MARKUP · RECT" panel opened (Fill opacity at 0, confirming it's unfilled). Screenshot `/tmp/b150-after-interior-click.png` shows the selected unfilled box with grips. lint 0 errors · **230 tests** · build green; `SitePlannerApp` / `DocReview` lazy chunks intact.
- **Not covered:** **ParcelDrawing's** identical one-attribute change (the Box on a parcel drawing) wasn't separately driven — it needs a real drawing attached + rasterized (V9's flow), which is awkward logged-out; it's the same `pointerEvents="all"` edit on an analogous `fill:"none"` rect whose move handler already `stopPropagation`s, so low-risk by analogy. Doc Review's rect interior-select was already shipped under B33. The broader B155 tranche (shared `hitTest`, screen-space tolerance, forgiving line/polyline hit area, z-order tie-break, hover preview B156) is **not** in this increment — still ⏳ in BACKLOG B155/B156.
