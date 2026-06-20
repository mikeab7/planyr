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
### V76 — Document Review editing batch: undo/redo, Calibrate validation, toolbar, sheet paging, label position (B303–B307) ✅ (self-verified headless — fully done, browser-only, no signed-in check needed)
- **Added** 2026-06-20 · **Cadence** once (acceptance) · **Last checked** 2026-06-20 ✅ (headless **Chromium-1228** on the built app, `vite preview`, logged-out — these are browser-only editing features, no auth path). Re-applied + re-verified after merging `main`'s viewer batch (B288–B296).
- **✅ Self-verified 2026-06-20 (`ui-audit/verify-b303-b307.mjs`, 17/17 checks, 0 page errors)** on a generated 4-sheet PDF (`ui-audit/make-sample-pdf.mjs` — the owner's real sets live on `mikeab7-patch-1`, B269, off this branch), covering BOTH the single-sheet viewer and the Stitcher:
  - **B303 undo/redo** — draw a rect → Ctrl-Z removes it → Ctrl-Shift-Z and Ctrl-Y each restore it; ↶/↷ disabled before any edit; Stitcher: draw distance → Ctrl-Z undoes. (Also extended to undo `main`'s B293 move + text-edit.)
  - **B304 Calibrate validation** — inline box opens (no `window.prompt`); **"1/8" rejected + stays uncalibrated**, "1:240" rejected as a ratio, **"100" → sheet calibrated**; same in the Stitcher.
  - **B305 toolbar** — Open/Stitch/Library compute `white-space:nowrap`, single 25px line, no wrapping.
  - **B306 paging** — Next 1/4→2/4; → / ← keys page 3/4 / 2/4.
  - **B307 label** — horizontal distance label at x≈454 (midpoint ≈450), not pts[0] (~250).
- **Sandbox browser:** use **`chromium-1228`** (pdf.js v6 render needs `Map.prototype.getOrInsertComputed`, absent in `chromium-1194`) — same note as V72.
- **Why fully done logged-out:** all five are browser-only editing features (no cloud/auth path); the resulting state rides the already-verified doc-review save path.
### V75 — Doc Review stitch + markup safety guards: degenerate-align reject, unaligned-sheet flag/warn, ≥3-pt Area/Perimeter (B300 / B301 / B302) ✅ (self-verified headless — fully done, no signed-in check needed)
- **Added** 2026-06-20 · **Cadence** once (bug-fix acceptance) · **Last checked** 2026-06-20 ✅ (headless Chromium-1228 on the built app, `vite preview`, logged-out — the stitch/markup core is browser-only) · **Next check** — none required (all three are auth-independent client logic).
- **Steps:** Document Review (**Markup**). **B302:** open a PDF → **Area** → click **2** points + Enter or double-click ⇒ nothing commits (takeoff stays "No measurements yet"); click **3** points + Enter ⇒ one area commits. **Then Stitch sheets ▸**, open a multi-page PDF, add two sheets. **B301:** the 2nd sheet shows an amber **"Not aligned — click Align"** overlay + a panel chip; drawing a Distance/Area over it raises **"…isn't aligned yet — Align it first…"**. **B300:** click **Align** on the 2nd sheet and click the two moving-sheet points on ~the same spot ⇒ banner **"Those two points are too close together…"** and the sheet **does not move**; a real Align (distinct points) then succeeds and clears the flag.
- **✅ Self-verified 2026-06-20** (`ui-audit/verify-b300-b302.mjs`, headless **chromium-1228**, logged-out, screenshot `ui-audit/screens/b300-b302.png`): **14/14 checks** — 2-pt Area commits nothing / 3-pt commits one; 2nd sheet flagged + measure-over-it warns; degenerate Align banner fires and the sheet's `<g transform>` is **unchanged** (not flung); valid Align clears the flag; **0 page JS errors**. (Same chromium-1228 requirement main's V72 documents — 1194 lacks `Map.prototype.getOrInsertComputed` and throws mid-render.)
- **Deterministic logic** — `solveM` + the `alignBaselinesDegenerate` guard, `sheetContains` / `measureOverUnaligned`, and `canCommitMeasure` (now gating **both** Enter/`finishDraft` and double-click/`onDbl`, so a 2-point area can't slip in either way) — is covered by **18 unit tests** (`test/stitchGeom.test.js` 8, `test/takeoff.test.js` +2 for B302), all green. lint 0 · build green.

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

### V72 — Doc Review single-sheet zoom / pan / navigation + drawing-correctness + markup editing (B288–B296) ✅ (self-verified headless — fully done, no signed-in check needed)
- **Added** 2026-06-20 · **Cadence** once (acceptance) · **Last checked** 2026-06-20 ✅ (headless **Chromium-1228** on the built app, `vite preview`, logged-out, generated 2-page Letter PDF) · **Next check** — none (pure Markup-canvas interaction; opening a local PDF + drawing needs no auth or cloud path).
- **✅ Self-verified 2026-06-20 (`ui-audit/verify-docreview-viewer.mjs`, 13/13 checks, 0 page errors):** **B288** wheel/Ctrl/pinch zooms in (canvas 1054→1212px) **cursor-anchored** (point under the cursor drifted **0.4px**). **B290** the **+** button zooms holding the **viewport centre** fixed (drifted 0.6px). **B289** the **Pan** tool drag scrolls the viewport by the exact drag delta (Δ = 110,70 for a 110,70 drag). **B292** switching Sheet 1→2 **keeps** the zoom (1454px both, no snap to fit-width). **B295** **Fit page** fits the whole sheet (602×780 inside an 1078×804 viewport) where plain **Fit** (width) overflows height (h=1364). **B291 (HIGH)** Count: 3 clicks + double-click finishes with **3** dots, not 5 — the double-click's two phantom pointerdowns are stripped. **B293** a placed Rect **drags** to a new position (x 181→301 for a +120px drag); a Text note is **created** through an inline `<input>` (no `window.prompt`) and **re-edited** on double-click (HELLO→WORLD). lint **0 errors** · **563 tests** · build green.
- **B294 (drop a PDF onto the open document)** is the one item not in the headless harness — a synthetic HTML5 file-drop with a real `File` is awkward to dispatch — but it's a two-line reuse of the already-proven `openFile` path (the same path the file input + the empty-state drop use), so it's covered by code + those existing checks. **B296 (one-decimal linear measures)** is a pure-function change covered by a unit test (`test/takeoff.test.js`).
- **📌 Correction to the V63/V65 note that "the sandbox Chromium can't run pdf.js":** the OLDER `chromium-1194` build throws `Map.prototype.getOrInsertComputed is not a function` during `page.render`, but the newer **`chromium-1228`** build (`/opt/pw-browsers/chromium-1228/chrome-linux64/chrome`) runs pdf.js fine — so Doc Review's PDF **raster** path (and anything downstream of it) **is** headless-verifiable now by pointing `PW_CHROME` at 1228. Future Doc-Review verifications should use 1228.

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

### V69 — Production error telemetry → Supabase `client_errors` (B279) ✅ (capture pipeline self-verified headless; SQL run + live cloud-insert verified 2026-06-20)
- **Added** 2026-06-20 · **Cadence** once (acceptance) · **Last checked** 2026-06-20 ✅ (headless Chromium on the built app, `vite preview`, logged-out; re-run clean after merging latest `main`).
- **✅ Self-verified headless (`ui-audit/verify-telemetry.mjs`, 6/6):** firing a synthetic window `error`, `unhandledrejection`, and `vite:preloadError` each produced exactly one captured row with the right `source` tag (read back via the `window.pfTelemetry` diagnostic handle); a **duplicate** error within the 10s window was **suppressed** (storm guard); the **build id** (git short SHA) was baked into the rows; and the page **stayed alive with no crash/navigation** after firing them (fail-safe). lint **0 errors** · **587 tests** (12 new) · build green.
- **✅ Live cloud-insert verified 2026-06-20 (Cowork — signed-in browser + Supabase dashboard):** ran `src/shared/telemetry/client_errors.sql` once in the Supabase SQL editor → `public.client_errors` created with all 10 columns, **RLS enabled**, a single **INSERT-only** policy (`anyone can log a client error` `[a]`) and **0 SELECT/UPDATE/DELETE** policies (clients write, never read it back). Then on **planyr.io** (production build, Supabase env baked in) fired probes via `window.pfTelemetry.reportClientError`: the **signed-in** probe landed a row stamped with the real account UID `b147d90d…` and `build` = git short SHA `113e820` (matches `main` HEAD — not "dev"), `module` = `site-planner`; and an **anonymous** insert (issued as the `anon` role — the same role a logged-out browser uses) landed with **`user_id` null**. RLS accepted the anon write with no rejection — logging that doesn't depend on a session is the whole point. Both rows read back via the dashboard. (Probe rows are tagged `build='cowork-probe'` / message `cowork live probe …` and can be deleted any time.)
- **Deterministic logic** — the storm guard (`decideReport`: dup-suppression + per-minute cap + window reset), row shaping (`buildErrorRow`), and message/stack extraction + truncation — is covered by **12 unit tests** (`test/clientErrors.test.js`), all green.

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

### V64 — Deliberate Group tool + snap-aligns-only + per-session snap + per-plan delete (B261 / B262 / B263 / B264) ✅ (self-verified headless — fully done, no signed-in check needed)
- **Added** 2026-06-20 · **Cadence** once (acceptance) · **Last checked** 2026-06-20 ✅ (headless Chromium on the built app, `vite preview`, logged-out, two seeded plans) · **Next check** — none (pure planner-canvas / header-menu UI; no auth or cloud path involved).
- **Harness:** `ui-audit/verify-b261-b264.mjs` (seeds a plan with a building + parking field, and a second site with two plans; boots the planner logged-out; drives the SVG canvas + the Plan ▾ menu; captures console/page errors; screenshots `screens/b261-groups.png` + `b264-plan-delete.png`).
- **✅ Self-verified 2026-06-20 (15/15 checks, 0 page errors):** **B263** — fresh session shows **"Snap off"** and no global `localStorage:planarfit:snap`; toggling writes `sessionStorage` only. **B262** — with snap ON, dragging the building flush against the parking then away left the parking untouched (Δ=0px — no implicit bond). **B261** — Shift-click both → **Group** → the "⊞ Group" box renders **with no resize handles** (a group just stays together; it never scales as a whole — owner clarification) → dragging one member moved **both** (108px each) → **Ungroup** removed the box → members then moved independently again. **B264** — a 2-plan site → ✕ armed an inline "Delete …?" confirm (no browser dialog) → Delete removed the **current** plan and switched to its sibling (it did NOT resurrect) → the lone remaining plan has no ✕. lint **0 errors** · **537 tests** · build green.

### V63 — Dropped overlay sizes sanely + "Size to view" rescue (B260) ✅ (self-verified headless — image path; ⏳ one real-browser PDF drop)
- **Added** 2026-06-20 · **Cadence** once (acceptance) · **Last checked** 2026-06-20 ✅ (headless Chromium on the built app, `vite preview`, logged-out) · **Next check** — a real-browser drop of an actual landscape **PDF** that carries both a plan scale and a vicinity/key-map scale, to confirm the scale-read guard fires end-to-end (the sandbox Chromium can't run pdf.js — `getOrInsertComputed` — so the PDF *raster* path couldn't be exercised headless here).
- **Harness:** `ui-audit/verify-overlay-fix.mjs` — seeds a 26.33-ac parcel + Katy origin (aerial on), logged-out.
- **✅ Fresh drop is sane:** dropping an **image** runs the real `addOverlayFile` path → the overlay lands **535 px** wide on a 1440 px view (≈60% fit), never splattered, no error dialog (`screens/verify-A-image-drop.png`).
- **✅ Rescue works:** a seeded **mis-scaled** overlay (simulated 1″=600′ misread, **14279×9519 px** — the reported "title block all over the map") shrinks to **535 px** with one click of the new **"Size to view"** button (`screens/verify-B-before.png` → `verify-B-after.png`).
- **Deterministic logic** (the ≤4×/≥0.04× viewport scale guard, fit fallback, reasons) is covered by `test/overlayScale.test.js` (`chooseOverlayScale`, 7 cases) — all green.
- **⏳ Remaining:** the one real-browser PDF drop above; everything else is fully self-verified.

### V62 — Scheduler bug-fix batch: Export-modal focus + boots clean (B247–B253) ✅ (self-verified headless — fully done, no signed-in check needed)
Harness `ui-audit/verify-scheduler-bugfixes.mjs` (serves `public/`, drives `/sequence/` in headless Chromium). Result **ALL PASS**: the board renders (so the **B247** module-scope hoist didn't break module eval and the **B251** render-nudge doesn't loop), the Export → "Header / Cover" Title field accepts "ALTA & Topo Survey — Phase 2" typed **character-by-character with focus retained and the full value intact** (B247 fixed — pre-fix it remounted per keystroke), and **0 real console/page errors** (no "Maximum update depth"). Syntax of the in-browser-Babel block also re-checked clean via `ui-audit/jsxcheck-sequence.mjs`. B248 (HTML-export escaping), B249 (status-delete guard/reassign), B250 (import normalization) are pure data-logic mirroring already-shipped patterns and ride the same clean boot; B252 (undo cap) and B253 (today already-fresh) need no UI check. No signed-in check needed — none of these touch auth.

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

### V56 — Bluebeam vertex editing + cartographic detention pond (B230 / B231) ✅ (self-verified headless — fully done, no signed-in check needed)
- **Added** 2026-06-20 · **Cadence** once (acceptance) · **Last checked** 2026-06-20 ✅ (headless Chromium on the built app, vite preview, logged-out, live Harris-county aerial) · **Next check** — none (pure UI; no auth/cloud path involved)
- **Harness:** `ui-audit/verify-b221-b222.mjs` (seeds a parcel + a **polygon detention pond** → boots into the planner → drives the SVG canvas to select / Shift-click an edge / hover / right-click / Delete, asserting the DOM + capturing console errors + screenshots).
- **✅ B230 (Bluebeam vertex editing):** after selecting the pond — **0** old "+" midpoint handles, **4** square vertex handles. **Shift+click an edge → 4→5** vertices, with the candidate-insertion dot shown **while Shift is held**; **edge-hover with no Shift also shows the dot**. **Right-click a vertex → portal "Delete control point" menu → 5→4.** **Delete key → 4→3**, then repeated deletes **stop at 3** (polygon minimum guard). The corner-vs-edge tie-break (a corner right-click always offers Delete, never Add) was the one bug found here and fixed before merge. Screenshots `ui-audit/screens/b221-pond-selected.png` + `b221-after-edits.png` show squares only, no plus marks. **0 console errors.** (Polygon element exercised; the same shared layer drives parcels / measures / markup poly-line / easements.)
- **✅ B231 (cartographic pond):** `#grad-water` radial gradient exists with stops **`#2F6675` (deep center) → `#5B97A5` (edge)**; the pond fill uses `url(#grad-water)`; **no `#pat-water`** wavy pattern; the **`#2C5D6B`** constant-width teal outline is present (no orange); the label uses **Inter** + slate fill **`#0E2E36`** reading "Detention Pond / 2.14 ac · 93,100 sf" with a white halo. Screenshot eyeballed — steel-teal body with a deeper center, crisp teal edge, no hatch. **0 console errors.**

### V55 — Building-anchored dock-zone stack + Dock Features panel reorg (B228 / B229 / B239 / B242 / B246) ✅ (self-verified headless — fully done, no signed-in check needed)
- **Added** 2026-06-20 · **Cadence** once (feature acceptance) · **Last checked** 2026-06-20 ✅ (headless Chromium on the built app, vite preview, logged-out, non-located demo site) · **Next check** — none (pure planner-canvas/panel UI; no auth/cloud path involved)
- **Harness:** `ui-audit/verify-dock-zones.mjs` (seeds a 600′×300′ cross-dock building → boots the planner → selects the building → drives the Dock features panel; captures console/page errors; screenshots `screens/dock-zones-full.png` + `dock-zones-deepbuffer.png`).
- **✅ Result (all checks passed, 0 page errors):** the stack "+" walks out **truck court → trailer parking → buffer** (cross-dock → 2 of each), in the correct **outward order** (court nearest the wall, buffer farthest); "+" reads "All zones" and disables at the full stack. **Inline buffer depth 15→40 grew the band** while the outer zones stayed flush. **Building resize 600→760 kept every zone attached, full-width and flush** (the rewritten `refitChildren` relayout). The LIFO "−" peeled **buffer → trailer → court** in order. **Car parking (ends)** added a separate parking field outside the stack. Screenshots confirm the panel layout (add-controls on top: stack +/−, car parking, visually-distinct bump-outs; the outward zone list with inline depths + LIFO −; the footprint/dock-doors summary at the bottom).
- **✅ B239 regression (owner-reported "can't add the 50′ trailer parking anymore"):** focused repro on a cross-dock building with a court on the RIGHT only — selecting the truck court now shows **"＋ Add trailer parking"** (the per-side plus that B229 had removed), which adds the trailer on the **right side only** (count 1, not both); selecting that trailer shows **"＋ Add buffer"**, which adds it. **0 page errors.** Confirms the per-zone add workflow is restored independent of the building-level unit "+/−".
- **✅ B242 on-building controls + uniform panel:** `verify-dock-zones.mjs` (rebased on latest `main`) drives BOTH surfaces — the **panel** "＋/−" walk the stack on **both** dock sides (court→trailer→buffer, 2 each, then peel back), and the **on-canvas "＋/−" pair on the building** adds a court on **one** side, walks it to trailer, then removes it (per-side). Car parking adds on the non-dock ends. Panel rows are uniform (Dock zones / Car parking / Bump-outs, consistent square ＋/− aligned right). **0 page errors** (`dock-zones-full.png` / `dock-zones-oncanvas.png` / `dock-zones-parking.png`).
- **✅ B246 employee-side build-out:** on a non-dock side the 1st on-canvas "＋" restores the **sidewalk**, the 2nd adds the **first parking row**, the 3rd **deepens the field by another row** (27px → 38px on screen) — car parking now grows unlimited rows like the dock stack, and the sidewalk is back. **0 page errors.**
- **Note:** logged-out is the full story here — the dock-zone stack is local planner geometry (no auth/cloud branch), so no separate signed-in check is owed.

### V49 — Header cleanup + cartographic furniture restyle (B218 / B219) ✅ (self-verified headless — fully done, no signed-in check needed)
- **Added** 2026-06-20 · **Cadence** once (acceptance) · **Last checked** 2026-06-20 ✅ (headless Chromium on the built app, vite preview, logged-out, live Harris-county aerial) · **Next check** — none (pure UI; no auth/cloud path involved)
- **Harness:** `ui-audit/verify-new1to2.mjs` (seeds a located demo site → boots into the planner → asserts the header + furniture DOM, captures console/page errors, screenshots the header and both furniture corners).
- **✅ B218 (dead header controls removed):** on **both** the Site and Schedule modules the header has **0** `[aria-label="Menu"]` (hamburger) and **0** `[aria-label="Settings"]` (gear); the planyr wordmark + Site/Schedule/Markup tabs still render; Row 1 reflows clean (logo left, account right — no orphaned padding). **0 console errors.**
- **✅ B219 (cartographic north arrow + scale bar):** the on-screen furniture renders as the two-tone surveyor's needle (**2 `<path>` halves, 0 `<circle>`** — no compass rose) + the thin segmented bar (6 `<rect>` = plate + 4 segments + north plate) with **FEET** + **N** labels on the new subtle warm plate (`rgba(249,248,244,0.84)`); corner screenshots confirm both read as clean cartographic furniture, legible over busy aerial imagery. Shared `lib/sheetFurniture.js` primitives, so the print/PNG export inherits the same look. **0 console errors.**

### V46 — Schedule Gantt brackets + task-fill + configurable columns (B210 / B211 / B212) ✅ self-verified headless · ⏳ one signed-in cloud check
- **Added** 2026-06-19 · **Cadence** once (feature acceptance) · **Last checked** 2026-06-19 ✅ (headless Chromium, static-served `public/sequence/`, logged-out seed) · **Next check** — one signed-in cloud round-trip (below)
- **Harness:** `ui-audit/verify-sequence.mjs` (renders the embedded Schedule app, captures console/page errors, probes bar colors, screenshots). **Note for future sessions:** the Schedule app's CDN deps (React/Babel/Supabase) **are reachable** in this environment — serve `public/` statically and load `/sequence/` (the app falls back to its embedded `__PLANAR_DATA__` seed when logged-out). JSX-only syntax pre-check: `ui-audit/jsxcheck-sequence.mjs` (esbuild).
- **✅ B210 (summary brackets):** probe found **36 navy bracket elements**; detail screenshot confirms a thin span + straight-down leg (no triangle), label above in level-navy. Depth ramp navy `#2B3340→#46506A→#6E7790`, thickness 7/5/4, legs by row-height fraction.
- **✅ B211 (task fill):** probe found **11 solid + 24 outlined** gray task bars and **0** old health-colored bars — status is fill-only (hollow/partial/solid), bars all one gray hue; row-background still carries red/paused. Purple `SS` dependency line untouched.
- **✅ B212 (configurable columns):** "⊞ Columns" chooser opens; adding **Budget**/**Actual** makes them appear (header count 9→11); right-click header → context menu with **Insert column ▸** submenu; **per-project independence holds** — Budget on *Goose Creek* is absent on *Bee Sand Development* and persists on return. Both menus portal-mounted. 0 runtime errors throughout.
- **⏳ Steps for the one signed-in check (B212 cloud persistence):** sign in on planyr.io → Schedule → a project → **⊞ Columns** → show **Budget** (and reorder/resize a column) → **reload the page**. **Expect:** the column change is still there after reload (it persists via the same `setData`→`cloudSync` path as task edits). Try a second project: its columns are independent. **Why ⏳:** the sandbox proxy blocks sign-in, so logged-out self-tests can't exercise the cloud write — but logged-out the app shows the "changes will not save" banner, so persistence is never silently lost. Low-risk (same write path as task edits, already proven), but worth one signed-in confirmation.

### V45 — Site Analysis: constraint queries resolve + click-to-show-on-map (B189 / B190) ✅ (self-verified, headless, with live GIS data)
- **Added** 2026-06-19 · **Cadence** once (feature acceptance) · **Last checked** 2026-06-19 ✅ (headless Chromium on the production build, live USFWS/FEMA/TxRRC endpoints) · **Next check** —
- **Steps:** Site Planner with a located, active parcel → left rail **⚐ Analysis**. (1) Each constraint category resolves to **Present / None found** (NOT "UNKNOWN / Failed to execute query"). (2) On a resolved card, click **◍ Map** → the matching GIS overlay turns on, the view frames to the parcel, and the button reads **◉ On map**; click again to hide. UNKNOWN/info/no-source categories (e.g. Road authority, Contamination) show **no** Map toggle.
- **Expect:** Floodplain, Wetlands, Pipelines, Oil & gas wells all execute. Before the fix, Wetlands + Pipelines (+ the below-the-fold Oil & gas) returned "Failed to execute query." → UNKNOWN; now they resolve.
- **✅ Self-verified 2026-06-19 (`ui-audit/verify-analysis.mjs`, headless, logged-out):** seeded a located site over Sheldon Lake. Result: **Floodplain = PRESENT (Zone AE)**, **Wetlands = PRESENT (Lake, Freshwater Forested/Shrub Wetland)**, **Pipelines = NONE FOUND**, **Oil & gas = NONE FOUND** — zero "Failed to execute query." Clicking Wetlands **◍ Map** flipped to **◉ On map** and added the NWI overlay (`leaflet-image-layer` count 0→1), framed to the parcel (screenshot `ui-audit/screens/analysis-verify.png`). Root causes were per-source field bugs (NWI joined-layer table-qualified fields; TxRRC `OPERATOR`/`COMMODITY` and `LEASE_NAME` don't exist), each confirmed live (HTTP 400 old fields → 200 with real features) before patching.
- **Note:** self-test runs logged-out; the screen works the same signed-in (it reads the same active-parcel rings). A signed-in click-through is a nice-to-have, not a blocker — the GIS query path is auth-independent.

### V44 — Jurisdictions overlay: county / city / ETJ / MUD boundary tiles actually paint (B176) ✅ (self-verified headless, fresh session 2026-06-19)
- **Added** 2026-06-19 · **Cadence** once (feature acceptance) · **Last checked** 2026-06-19 (✅ PASS, headless — fresh session; all four hosts reachable incl. the previously-blocked MUD host) · **Next check** — none (closed)
- **Steps (on https://planyr.io, logged-out is fine):** Map finder (or planner) → **Layers** panel → **Jurisdictions** group. Toggle each of: **County boundaries**, **City limits**, **City ETJ (Houston region)**, **MUD / water districts**. Zoom into the Katy / Fort Bend area for MUD; zoom to ~county level for County boundaries.
- **Expect:** County lines paint statewide; City limits + ETJ paint across the Houston region; **MUD paints statewide (TCEQ source) — incl. both Harris AND Fort Bend**. Each layer's status dot goes green ("loaded"); a layer whose host is down shows a quiet "failed" dot (never wrong data). Confirm the "has-jurisdiction ≠ serves utilities" caption shows under the group.
- **★ Key check (owner's use case):** pick a parcel you KNOW is in a MUD (Harris OR Fort Bend) → toggle MUD → its boundary should contain the parcel. This is the "verify against a known-MUD parcel" gate from B176. **MUD source is the statewide TCEQ layer via HARC** (`harcags.harcresearch.org/.../TCEQ_Water_Districts/MapServer`).
- **✅ Self-verified 2026-06-19 (headless, fresh session, `npm ci && npm run build` + `vite preview`, logged-out) — `gis-verify/jurisdictions-overlay-verify.mjs`:** booted the map finder, opened **Layers → Jurisdictions**, toggled all four layers ON, zoomed out over the Katy / Cypress / Fort Bend MUD belt, and recorded every in-app network response per host + each layer's status dot. **RESULT: PASS — all four return HTTP 200 and their dots read "loaded":**
  - **County** (`services.arcgis.com` org `KTcxiTD9dsQw4r7Z`) — 38 requests, all 200 (JSON) · dot **loaded**
  - **City limits** (`feature.geographic.texas.gov`) — 14 requests, all 200 (JSON) · dot **loaded**
  - **City ETJ** (`services.arcgis.com` org `su8ic9KbA7PYVxPS`) — 38 requests, all 200 (JSON) · dot **loaded**
  - **MUD** (`harcags.harcresearch.org`) — 3 requests, all 200 (the `?f=json` probe **and** the `image/png` export) · dot **loaded** — the host that needed the egress-allowlist change is reachable from a fresh session, exactly as the handoff predicted.
  Zero page exceptions; the only console noise is the expected benign cross-origin probe message. Screenshot `gis-verify/jurisdictions-tiles-verify.png` shows county lines statewide, city + ETJ across the Houston region, and MUD polygons blanketing the Katy / Fort Bend suburbs (Harris **and** Fort Bend) — the owner's known-MUD case.
- **Corroboration (raw from-sandbox endpoint probes):** county 842 KB · city 2.1 MB · ETJ 1.35 MB geojson; MUD 24 KB PNG `export` — all HTTP 200, non-empty. The V44 "next session" handoff is now **CLOSED**.

### V40 — Scheduling grid: ↓ from last task → "+ New task" highlighted; Enter creates task + opens name edit ⏳
- **Added** 2026-06-18 · **Cadence** once (feature acceptance) · **Last checked** — · **Next check** on next session with browser
- **Steps:** Open scheduling app (`/sequence/index.html`). With a project open and tasks visible: (1) Click the last task row to select it. (2) Press ↓ — the "+ New task" row should get a blue left border, blue text, and light-blue background. (3) Press ↓ again — nothing should happen (stays on "+ New task"). (4) Press ↑ — focus returns to the last task (no blue on "+ New task"). (5) Press ↓ to return to "+ New task", then press **Enter** — a new task row is created AND the name input opens immediately with cursor focus. (6) Confirm ↑ from a non-last task still moves to the row above (existing behavior not broken).
- **Expect:** Blue highlight on the sentinel row, Enter creates task + auto-opens name edit, up-arrow exits sentinel to last real task.
- **Note:** Browser verification was punted in the *original* session because the Schedule app's CDN deps looked blocked. **Correction (2026-06-19, V46):** those CDNs **are reachable** in this environment — the Schedule app IS headless-verifiable by static-serving `public/` and loading `/sequence/` (it falls back to its embedded seed when logged-out). Use `ui-audit/verify-sequence.mjs` as the template; this V40 keyboard-nav case can now be driven headless on a future run rather than waiting for production.

### V39 — Easement drawing tool: 3 input modes + attributes + metes import (B150–B153) ✅ (self-verified) / ⏳ (signed-in persistence)
- **Added** 2026-06-18 · **Cadence** once (feature acceptance) · **Last checked** 2026-06-18 ✅ (headless Chromium on the production build) · **Next check** —
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

### V4 — Site-plan overlay tool: drop → scale → align → reload (B72 / B73, main) ⏳
- **Added** 2026-06-16 · **Cadence** once · **Last checked** — · **Next check** 2026-06-16
- **Steps:** Left rail → **Overlay** → drag a site-plan PDF onto the map. Move / scale /
  rotate / opacity. Try **Trace a length** and **Align to map** (click drawing points then
  the matching map points → Apply). Reload the page; on another device if possible.
- **Expect:** The sheet places, manipulates, and aligns; **Align to map** captures clicks
  on the drawing itself; the overlay **persists across reload** (re-fetches the PDF from
  Storage and re-rasterizes when signed in). This was shipped UNVERIFIED — confirm on the
  preview/prod.

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

### V9 — Attach & mark up a drawing on a parcel (B67) ⏳
- **Added** 2026-06-16 · **Cadence** once (feature acceptance) · **Last checked** — · **Next check** 2026-06-16
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

### V13 — ★ Persistence: saved work must never disappear (B124 / B125) ⏳ — HIGH PRIORITY
- **Added** 2026-06-16 · **Cadence** once (data-safety acceptance) + on-change · **Last checked** — · **Next check** 2026-06-16
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

### V15 — ★ Persistence ROOT FIX: a thinner copy can't erase a fuller one + Version history (B126) ⏳ — HIGH PRIORITY
- **Added** 2026-06-16 · **Cadence** once (data-safety acceptance) + on-change · **Last checked** — · **Next check** 2026-06-16
- **▶ Full step-by-step script:** **`PERSISTENCE_TEST_SCRIPT.md`** (T1–T11, with paste-in Console helpers and a results table) — run that end-to-end and record the outcome back here. The summary below is the short form.
- **Why this matters:** B124 stopped whole *sites* vanishing, but buildings could still disappear *inside* a
  site because sync kept whichever whole copy was saved last — so a copy with fewer buildings could overwrite
  a fuller one (a stale tab, a second device, a hiccup mid-load). B126 makes sync **merge** the two copies
  (every building in either is kept) and adds **automatic local backups** you can restore from.
- **Steps (signed in, on planyr.io):**
  1. **Merge keeps both (two-tab test — the headline):** open the same site in **two browser tabs**. In tab A
     add **building X**; in tab B (don't reload it) add **building Y**. Let both reach **"Synced ✓"**.
     **Reload both tabs** → **both X and Y are present** in each — neither tab's copy erased the other's.
  2. **Version history restore:** **Plan ▾ → Version history…** → a dialog lists earlier automatic backups
     (timestamp · N buildings). Click **Restore** on an earlier one → the canvas returns to that version and
     re-saves. Re-open Version history → the version you just replaced is now **also** listed (a restore is
     itself reversible).
  3. **De-dupe sanity:** make a few edits that change the building/element count → each appears as its own
     version; a pure move (no count change) does **not** spam a new version.
- **Expect:** a building drawn in any copy is **never lost to a sync**; the count never silently drops; Version
  history lists and restores prior versions, reversibly. (Backdrop aerials/images may need re-dropping after a
  restore — geometry is always restored in full.)
- **If it fails:** **CRITICAL** class (data) — if a building still disappears on a sync/reload, flag it
  immediately with the exact step + browser console; do **not** log-and-move-on.
- **Update 2026-06-16 (B127):** the first run found **no data loss** but one rough edge — two open tabs
  could **disagree until reload** (the durable store briefly held the thinner copy). That's now **fixed**:
  a stale tab's save **folds into** the store (never thins it) and open tabs **live-sync** via `storage`
  events. **Re-run T5/T6 to confirm:** (a) after the two-tab divergent edits, **both tabs converge while
  still open** (no reload needed), and (b) the durable `sites:v1` always holds the **union** (never the
  thinner copy), so any reload shows the full set.

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

### V20 — GIS layers survive a CORS-blocked health-check (B129 / PR #60) ✅
- **Added** 2026-06-16 · **Cadence** once (feature acceptance) · **Last checked** 2026-06-17 (real Chromium/Playwright on planyr.io) · **Next check** —
- **Result 2026-06-17 — VERIFIED in a real browser.** See the full evidence in **B129** (now Done):
  - **FEMA flood zones — renders.** `/export?f=image` → HTTP 200 `image/png`; the `<img>` paints the
    standard NFHL symbology (teal Zone AE / orange floodway / red boundaries) along the bayous; host is
    CORS-clean (`Access-Control-Allow-Origin` on metadata, `/export`, and the OPTIONS preflight). **Caveat:**
    NFHL 27/28 are source-gated to `minScale ~1:36,112`, so flood zones only draw at ~zoom 14+; at
    city-wide zoom the export is a blank transparent PNG (expected, not a failure).
  - **Wetlands (NWI) — does NOT render, but the cause is an agency OUTAGE, not CORS.** The USFWS host
    returns **HTTP 500 across its whole catalog** (confirmed three ways). PR #60's resilience held up — the
    app stays alive and shows a quiet per-layer "failed" dot; no alarming toast, no dropped-layer cascade.
    The message text is now honest ("service is not responding…") instead of esri's misleading CORS line.
- **RESOLVED by B133 / V26 (2026-06-17):** rather than wait for `fwspublicservices` to recover, NWI was pointed
  at the live sibling raster host `fwsprimary.wim.usgs.gov` and **verified rendering in a real browser** — see V26.
  (The old `fwspublicservices` host is still 500; this trigger is superseded.)

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

### V26 — NWI wetlands restored from the live `fwsprimary` raster host (B133) ⚠️ SUPERSEDED by V27
- ⚠️ **Superseded 2026-06-17 by V27 / B135.** This verified the raster *renders + 200 + CORS*, but the source
  was a **100 m-per-pixel raster**, so in real use wetlands painted as coarse **blocks**, not true shapes (owner-spotted).
  B135 switched to the crisp **vector** MapServer; see **V27**. Kept here as the honest record of what shipped first.
- **Added** 2026-06-17 · **Cadence** once (bugfix acceptance) · **Last checked** 2026-06-17 (real Chromium/Playwright — esri-leaflet imageMapLayer over Sheldon Lake) · **Next check** —
- **Result 2026-06-17 — VERIFIED in a real browser.** Follow-up to B129 / V20 (the NWI outage). The old
  `fwspublicservices` host is **still HTTP 500**; the live data the official USFWS Wetlands Mapper draws sits on the
  sibling host **fwsprimary.wim.usgs.gov**, but at a different path **and as a pre-rendered RASTER ImageServer**
  (`/server/rest/services/Wetlands_Raster/ImageServer`), not the old dynamic vector MapServer — so the fix is an
  esri **imageMapLayer** (`kind:"esriImage"`, like 3DEP), **not** the one-line host swap the hand-off assumed.
  - **Renders.** esri-leaflet's `imageMapLayer` paints the standard NWI symbology (navy open water = Sheldon Lake,
    greens = vegetated wetlands) over Sheldon Lake at zoom 14 — screenshot `gis-verify/wetlands-fwsprimary-verified.png`.
  - **Network 200.** the `exportImage` request → HTTP **200 `image/png`**; the service metadata fetch → **200** JSON.
  - **CORS-clean cross-site (the flagged 403 risk DISPROVEN).** the host **reflects any Origin** in
    `Access-Control-Allow-Origin` (verified for `https://planyr.io`, localhost, and an arbitrary origin), so it loads
    from our origin with no refusal. The earlier out-of-band 403 did not reproduce.
  - **Reproduce:** `node gis-verify/wetlands-verify.mjs` (serves `gis-verify/wetlands-verify.html` from the repo
    root on :8000; uses the installed esri-leaflet, identical to the app). NB: this sandbox's egress proxy MITMs TLS
    with an "Anthropic Egress Gateway" CA the bundled headless Chromium doesn't trust, so the driver sets
    `ignoreHTTPSErrors` — an **environment artifact only**; real planyr.io users reach fwsprimary's genuine public
    USGS cert directly, no proxy.
- **Re-check trigger (🌐, no browser needed):** `curl -s -o /dev/null -w '%{http_code}\n' -H 'Origin: https://planyr.io'
  'https://fwsprimary.wim.usgs.gov/server/rest/services/Wetlands_Raster/ImageServer/exportImage?bbox=-10597000,3485000,-10589000,3493000&bboxSR=102100&imageSR=102100&size=10,10&f=image'`
  should return **200**. If it 500s/403s, NWI is down again and the B129 honest "service unavailable" path covers it.

### V27 — NWI wetlands render as crisp VECTOR polygons (Mapper look), not raster blocks (B135) ✅
- **Added** 2026-06-17 · **Cadence** once (bugfix acceptance) · **Last checked** 2026-06-17 (real Chromium/Playwright — esri-leaflet dynamicMapLayer over Sheldon Lake) · **Next check** —
- **Result 2026-06-17 — VERIFIED in a real browser.** Fixes V26/B133's coarse-raster blocks. The crisp vector
  polygons the official Mapper draws live in the staging service `…/server/rest/services/Test/Wetlands_gdb_split/MapServer`
  (layer 0 empty; data in layer 1 = CONUS_East, layer 2 = CONUS_West). `STATEWIDE.wetlands` is now a `kind:"dynamic"`
  esri **dynamicMapLayer** with `layers:[1,2]`, like FEMA.
  - **Renders crisp.** the `…/export?…layers=show:1,2&f=image` request → HTTP **200 `image/png`** with **true-shape
    polygons + NWI class labels** (PFO1A / PSS1A / PUBH…), navy open water = Sheldon Lake — screenshot
    `gis-verify/wetlands-fwsprimary-vector-verified.png`. No 100 m blocks.
  - **CORS-clean** (echoes `Access-Control-Allow-Origin: https://planyr.io`); metadata fetch → 200 JSON.
  - **Reproduce:** `node gis-verify/wetlands-verify.mjs` (vector variant). Same egress-proxy `ignoreHTTPSErrors`
    caveat as V26 — environment artifact only; real planyr.io users hit the genuine USGS cert directly.
  - **Confirmed in the LIVE app — planyr.io, not just a test harness (2026-06-17):** drove production headless
    (`node gis-verify/app-live-verify.mjs`) — ticked **Wetlands (NWI)** in the Layers panel and zoomed to NE Houston.
    Every wetland request the app issued went to the new **Wetlands_gdb_split** vector source (NOT the old raster, so
    the deploy is fresh) and returned **200** (metadata JSON + multiple `/export` `image/png` tiles, up to ~52 KB), and
    the map painted crisp labeled polygons (PFO1A / PSS1A / PUBHh) + blue open water with the USFWS credit — screenshot
    `gis-verify/app-wetlands-planyrio.png`. So production is wired to the vector source and renders end-to-end.
- **Re-check trigger (🌐, no browser needed):** `curl -s -o /dev/null -w '%{http_code}\n' -H 'Origin: https://planyr.io'
  'https://fwsprimary.wim.usgs.gov/server/rest/services/Test/Wetlands_gdb_split/MapServer/export?bbox=-10594500,3487000,-10591500,3490000&bboxSR=102100&imageSR=102100&size=10,10&layers=show:1,2&f=image'`
  should return **200**. **Also watch the `Test/` path** — it's USFWS staging and may be renamed when their production
  `Wetlands/MapServer` is repopulated; if this 404/500s, NWI shows the honest "service unavailable" (B129) until re-pointed.

### V28 — ★ Boot fix: no stale-plan flash on reload; signed-in resume shows the latest (B134) ⏳ — HIGH PRIORITY, SIGNED-IN ONLY (the "limit")
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

### V30 — Detention pond "Expand this pond" mode (B139) ✅
- **Added** 2026-06-17 · **Cadence** once (feature acceptance) · **Self-verified 2026-06-17** (headless Chromium, logged-out preview build) · supersedes V25
- **Steps (driven):** Start blank → draw a Detention Pond → select it. (1) Panel shows a primary **"Expand this pond"** button (no "Lock as existing pond"), footprint reads **Width / Length** (not Depth), and the generic lock now reads **"📌 Pin"**. (2) Click **Expand this pond** → enters mode ("EXPANDING · EXISTING LOCKED"), a dashed ghost appears, steppers **Push banks out (ft)** / **Dig deeper (ft)**, Existing/Proposed rows, **Storage gained +0.00 ac-ft**, Reset/Done. (3) Push banks out 40′ → footprint grows uniformly with the ghost inset evenly on all four sides → **+18.33 ac-ft**. (4) Dig deeper +6′ → **85.17 ac-ft**. (5) Reset to existing → gain 0, stepper 0. (6) Done → exits mode, "Expand this pond" returns, pond keeps the new size. (7) 📌 Pin → toggles to 📌 Unpin.
- **Expect:** every step above; gain = proposed − existing via the same depth/slope math; zero console/page errors.
- **Result 2026-06-17 — ✅ PASS.** All steps observed in the running app (screenshots captured); zero console/page errors. Residual: a **signed-in** pass that the baseline/ghost survive a cloud reload (sandbox runs logged-out) — low risk, it rides on the existing `el.det` persistence.

### V32 — Pond acre labels (B140) + measurement vertex editing (B141) + text-box hit area (B142) ✅
- **Added** 2026-06-17 · **Cadence** once (feature acceptance) · **Self-verified 2026-06-17** (headless Chromium, logged-out preview build)
- **Steps (driven) + result — ✅ PASS, zero console/page errors:**
  - **B140:** draw a Detention Pond → on-canvas label reads **"3.60 ac · 156,730 sf"** (acres + sf, was sf-only). Enter Expand mode + push banks out → label becomes **"3.60 ac · 156,730 sf" / "+1.18 ac · +51,599 sf"** (existing total + added increment).
  - **B141:** Measure ▾ → Area → draw a region (**166,530 sf · 3.82 ac · 1,644′ perim**) → Select it → draggable vertex squares + edge **＋** handles appear; dragging one vertex recomputed it to **257,958 sf · 5.92 ac · 2,202′ perim**.
  - **B142:** create a text box, type, Enter → Select tool → click empty (deselects: stroke 1.4, panel gone) → click the box (**reselects**: stroke 2, "Text box" panel opens); clicking the text glyphs also selects. `pointerEvents="all"` makes a no/transparent-fill box clickable across its whole area.
- **Note:** the B142 *default-fill* case already worked before the fix (could not reproduce the original "nothing happens"); the fix hardens the no-fill case. A **signed-in** reload pass for the pond label persistence still rides on existing `el.det` persistence.

### V33 — Text box: Enter = newline, click-away / Esc finishes (Bluebeam-style) (B143) ✅
- **Added** 2026-06-17 · **Cadence** once (feature acceptance) · **Self-verified 2026-06-17** (headless Chromium, logged-out preview)
- **Steps + result — ✅ PASS, zero console errors:** Text tool → click to place → type "Line1", **Enter**, "Line2" → still editing, textarea value = "Line1\nLine2" (Enter now makes a newline, was commit). **Click away +80 px** → editor closes and commits **two lines** (previously you were stuck in the editor at any distance). New box → type → **Esc** → finishes, keeps the text. Place a box and click away **without typing** → the empty box is removed.
- **Expect:** matches Bluebeam — text box is multi-line; you finish by clicking away or pressing Esc.

### V45 — Site Analysis tool: presence-first screen of the active parcels, honest unknowns (B147 v1) ✅  *(was a duplicate "V44"; renumbered V45 — the Jurisdictions item keeps V44, which code + BACKLOG-DONE reference by number)*
- **Added** 2026-06-19 · **Cadence** once (feature acceptance) · **Self-verified 2026-06-19** (headless Chromium, logged-out, built `dist/` via vite preview)
- **Steps (driven):** `gis-verify/site-analysis-verify.mjs` seeded a **georeferenced Katy parcel** (origin 29.786/-95.83, one ACTIVE parcel) and resumed into the planner, opened the new **"⚐ Analysis"** left-rail tab, waited for the screen to run, then read back the rendered findings + screenshot (`gis-verify/site-analysis-verify.png`).
- **Expect:** every category renders grouped + presence-first with a distinct state; **live** sources (FEMA flood, TxDOT/TxGIO jurisdiction) return real results; **unreachable** sources read **UNKNOWN** (never a fabricated "none"); the pending TCEQ/EPA row reads "source not connected"; zoning is derived from the jurisdiction.
- **Result 2026-06-19 — ✅ PASS:** **Floodplain = PRESENT "Zone AE, X"** (live FEMA NFHL, "just now"); **Jurisdiction = County Fort Bend / City Katy**; **Road authority = State (TxDOT) · City**; **Zoning = "Within Katy — city zoning applies"** (derived); and the sandbox-blocked **Wetlands / Pipelines / Oil & gas wells = UNKNOWN ("Failed to execute query")** — the silent-error guard held (no false "none found"); **Environmental contamination = Not connected**. The "1 constraint present" banner showed; zero page errors. Residual: a real-display / signed-in pass + verifying the not-yet-`verified` sources' /query (to upgrade their empty → confident "none") are logged as the B147 remaining tranche.

### V43 — Aerial basemap requests HiDPI/retina tiles so imagery renders sharp (B169/B170) ✅
- **Added** 2026-06-19 · **Cadence** once (fix acceptance) · **Self-verified 2026-06-19** (headless Chromium, `deviceScaleFactor` 1 vs 2, over a Katy/Houston parcel)
- **Steps (driven):** `gis-verify/retina-basemap-verify.mjs` booted the map finder twice — once at `deviceScaleFactor: 1` (standard display) and once at `2` (HiDPI/"retina") — and recorded the **zoom level of every Esri World_Imagery tile actually requested** plus each tile's HTTP status.
- **Expect:** with `detectRetina:true`, the retina run requests tiles **one zoom level higher** than the standard run (2× pixel density, downsampled = sharp); both runs load tiles with no failures (no gray-tile/coverage regression).
- **Result 2026-06-19 — ✅ PASS:** DPR 1 requested **z11** tiles (35 tiles, all HTTP 200); DPR 2 requested **z12** tiles (96 tiles, all HTTP 200) → `detectRetina` engaged, higher-density tiles fetched, **0 failed/gray tiles** at either density. **Residual (NOT a Michael to-do):** the *visible* sharpness gain is invisible in the sandbox (its `devicePixelRatio = 1`), so eyeballing it on a real retina/4K display would be the final confirmation — but the mechanism (higher-density tile request) is proven engaged here, which is the fix.

### V45 — Project Files drawer opens from Row 1; saved-views/cascade engine (B180–B183) ⏳ signed-in pass due
- **Added** 2026-06-19 · **Cadence** once (feature acceptance) · **Self-verified 2026-06-19** (headless Chromium, logged-out preview build), signed-in list pass still owed
- **Self-verified (logged-out) — ✅ PASS, no errors from this code:** confirmed the new **🗂 Files** pill renders in **Row 1** (next to the project name, NOT a fourth tab) and opens the **Project Files** drawer in **BOTH** workspaces — the **Markup** (Document Review) module **and** the **Site Planner** (Plan mode, the planner's `centerContent` — added 2026-06-19 after the owner reported the pill was missing from the Site workspace where he was working; note Row 1 is intentionally empty on the Site Planner's *map finder*, so the pill shows once a plan is open). Logged-out both correctly show the **"Sign in to browse your project files"** gate (`ui-audit/screens/files-siteplanner.png`). The only console errors were pre-existing GIS CORS noise — unrelated. Engine is covered by **33 unit tests** (`fileFacts` 15, `placeOnMap` 10, `verifyPlacement` 8); full suite **318 tests** + lint 0 + build green; doc-review lazy chunk split intact.
- **⏳ Owed (signed-in, can't run in-sandbox — auth is CORS-blocked here, never a Michael to-do):** with a signed-in account that has filed reviews (B14/B180), confirm: the drawer lists files grouped by **discipline**; **saved-view chips** ("All surveys", "Title commitments", "Civil set", "Reference docs", "Needs filing") filter correctly; the **cross-project** toggle widens a per-project view; each file shows its **document-class tag** (spatial / reference / spatial+reference for title commitments) and **Filed/On-map** badge; **drop a PDF** files it under the active project; **"Place on map"** on a spatial file shows the cascade plan (today: lands on **manual calibration** and lists why the higher rungs are skipped, since the auto-filing backend isn't wired — that's the expected honest state).
- **Note:** the auto-filing index (title-block read → placement facts), the NEW-3 rung-1/2 geometry, and the NEW-4 auto-probe data source all wait on the backend tranche by design (stubbed behind `createIndexProvider`); this V45 covers only the shipped browser-first tranche.

### V42 — Added-detention area label seats on the NEW ground, not the whole-pond centre (B157) ✅
- **Added** 2026-06-18 · **Cadence** once (feature acceptance) · **Self-verified 2026-06-18** (headless Chromium, logged-out preview build) · refines V32/B140
- **Steps (driven):** seeded two ponds already in Expand mode (`det.baseline` set) and zoomed to fit — (P1) a **one-sided** expansion (existing basin on the left, new strip on the right) and (P2) a **concentric** "push banks out" expansion (existing basin centred → new ring all around, so the whole-pond centroid stays inside the old pond). Read back every on-canvas label `<text>` with its screen centre.
- **Expect:** each pond shows its **existing** area centred over the old basin **and** a separate **"+X.XX ac · +Y sf"** label seated on the new ground (never stacked at the whole-pond centre); correct footprint sf/ac; zero console/page errors.
- **Result 2026-06-18 — ✅ PASS** (re-run after the owner wording change — labels now read **"Existing Detention Pond"** and **"Additional Detention"**). P1: **"Existing Detention Pond · 1.10 ac · 48,000 sf"** over the left basin, **"Additional Detention · +0.73 ac · +32,000 sf"** to its right over the new strip (added.x 773 > existing.x 558). P2: **"Existing Detention Pond · 0.66 ac · 28,800 sf"** centred in the old basin, **"Additional Detention · +1.18 ac · +51,200 sf"** out on the new ring (**183 px** off the centre — the case where a centroid would otherwise land inside the existing pond). Both labels ride the shared label engine; **zero console/page errors** (screenshot captured). Residual: a **signed-in** cloud-reload pass rides on the existing `el.det` persistence (sandbox runs logged-out) — low risk.

---

## ✅ Verified / ❌ Failed — history
_Move items here with the date and who/what checked them._

### V24 — Parking "Split rows/aisles": double-loaded modules, not single rows (B130) ✅
- **Added** 2026-06-17 · **Checked** 2026-06-17 — self-verified, headless Chromium (first run of the
  in-session self-verification flow above) · **Cadence** once
- **Steps:** Loaded the branch-preview build (= the code now on `main`) and **planyr.io** in headless
  Chromium → "Start blank" → planner → drew a Car Parking field with the mouse → selected it → read
  the panel + button text → clicked **"Split rows/aisles"** → zoomed in and screenshotted the striping.
- **Result ✅:**
  - Button reads **"Split rows/aisles"**; the old **"Split into rows"** label is gone.
  - Panel reports the right defaults — **510 stalls @ 9′×18′, 90°, 24′ aisle**.
  - Zoomed view shows the **double-loaded** pattern: stall rows pair around one **shared dashed drive
    aisle** (an aisle every *other* gap), not one aisle per row.
  - App loads cleanly (HTTP 200) on both planyr.io and the preview; the split runs without errors.
  - Backed by 10 unit tests (`test/parking.test.js`) on the split math.
- **Not covered (tracked in `BACKLOG.md` B130, still open):** free-field longest-edge auto-orientation;
  the fuller curb rule. Sign-in paths untested (proxy blocks auth — logged-out run).

### V25 — Parking B130 follow-ons: free-field orientation + full-perimeter curb (B130) ✅
- **Added** 2026-06-17 · **Checked** 2026-06-17 — self-verified, headless Chromium (local preview of the built artifact) · **Cadence** once
- **Steps:** "Start blank" → planner → zoomed in → drew a **tall** Car Parking field (item 2), drew an **isolated** field and split it (item 3); screenshotted at high zoom.
- **Result ✅:**
  - **Item 2:** a tall-drawn field runs its stall rows + dashed aisles along the **long (vertical) edge** (double-loaded), not short stacked rows.
  - **Item 3:** an isolated pad shows a grey **6″ curb band around the full perimeter** (confirmed at high zoom on a corner); a split field stays **continuous with no curbs at the internal seams**.
  - Backed by 6 unit tests (`edgeAbutsPaving`) · lint 0 · 191 tests · build green.
- **Decision recorded:** no curb against the bare building face (B70 stands; owner-confirmed 2026-06-17). Sign-in paths untested (proxy blocks auth — logged-out run).

### V31 — Leader lines: a label too wide for its shape is pulled outside with a connector (B121 round 2b) ✅
- **Added** 2026-06-17 · **Checked** 2026-06-17 — self-verified, headless Chromium (local preview of the built artifact) · **Cadence** once
- **Steps:** "Start blank" → planner → drew a **small** building (~131′×131′) and a **large** one (~686′×486′) with the Building tool; screenshotted the drawing area.
- **Result ✅:**
  - The **small** building's label ("Building 1 / 17,274 sf / 131′×131′") is lifted **outside, just above the square**, with a thin leader back to it and a white halo so it reads on the paper — it no longer overflows/crams the tiny shape.
  - The **large** building keeps its label **inside, centred**, with no leader.
  - The same shot incidentally confirmed **B122** numbering ("Building 1" / "Building 2") and **B123**'s stack (square footage on its own line) rendering correctly.
  - Backed by unit tests (leader placement + inside-stays-inside) · lint 0 · 204 tests · build green.
- **Not covered (logged-out headless limits):** a very busy/crowded layout, and labels near the top viewport edge (the leader points up) — eyeball on a real dense plan when convenient. Sign-in paths untested (proxy blocks auth).

### V34 — Measurement-grade scale bar + north arrow in print/export and on screen (B144 / B145) ✅
- **Added** 2026-06-17 · **Checked** 2026-06-17 — self-verified, headless Chromium (built artifact via `vite preview`) · **Cadence** once (fix acceptance)
- **Steps:** "Start blank" → planner → drew two buildings with the Building tool → (a) **File ▾ → Print / pick frame… → Print** and captured the actual print page; (b) **File ▾ → Export PNG** and captured the downloaded PNG; (c) screenshotted the on-screen canvas corners.
- **Result ✅:**
  - **Print/PDF page:** scale bar sits fully inside the sheet with clearance on every side, snapped to a round **0 / 125 / 250** with a **FEET** label, alternating black/white segments, ticks with numbers centered under them, on a translucent legibility plate — **no clipping** (the old "500 runs off the edge / 0 floats above the bar" is gone). North arrow is a **modest, clean filled arrow + "N"** on the same plate, anchored top-left inside the safe area — no oversized compass rose.
  - **PNG export:** same furniture, anchored to the export frame (north top-left, scale bottom-right), nothing clipped.
  - **On screen:** the live canvas shows the same measurement-grade scale bar (bottom-right) and north arrow (bottom-left) on plates — consistent with the print, sized modestly for the screen.
  - Backed by **18 unit tests** (`test/sheetFurniture.test.js`) · lint 0 · **222 tests** · build green; `SitePlannerApp`/`DocReview` lazy chunks intact.
- **Not covered:** a print over a **live aerial** backdrop (logged-out + sandbox tiles) and signed-in paths (proxy blocks auth) — both orthogonal to the furniture, which composites above whatever backdrop is present.

### V35 — Road dimension tracks a resize; roads resize in 1′ steps (B146 increment 1) ✅
- **Added** 2026-06-17 · **Checked** 2026-06-17 — self-verified, headless Chromium (local preview of the built artifact) · **Cadence** once
- **Steps:** "Start blank" → Road tool (free draw) → dragged a road rectangle → selected it → read the red dimension → dragged the bottom-right corner handle straight down to widen the road → re-read the dimension.
- **Result ✅:** the red travel-width callout updated **live from 170′ → 428′** as the road was widened (before the fix it read a frozen `travelW` and stayed at 170′), and the value is a clean integer (1′ steps). Backed by the `roadTravelWidth` unit test · lint 0 · 205 tests · build green.
- **Not covered:** a signed-in cloud-reload pass is untested (logged-out run). *(Increment 2 — the interactive move/edit — is now built + verified; see V36.)*

### V36 — Interactive dimension callouts: drag to move + click road number to edit width (B146 increment 2) ✅
- **Added** 2026-06-17 · **Checked** 2026-06-17 — self-verified, headless Chromium (local preview of the built artifact) · **Cadence** once (feature acceptance)
- **Steps:** "Start blank" → drew a building, selected it, grabbed its red dimension and dragged it up out of the shape; then drew a road, selected it, clicked the red travel-width **number** and accepted the prompt with a new value.
- **Result ✅:**
  - **Auto-declutter:** the dimension number renders OUTBOARD of its line, clear of the centred "Building N / sf / dims" label (no more red number printing over the sq-ft).
  - **Drag-to-move:** the building's **"314′"** dimension dragged freely up out of the shape, leaving a **dashed red leader** pointing back to the edge it measures; the offset persists on the element.
  - **Click-to-edit road width:** clicking the road's **"199′"** number opened the prompt (seeded "199"); entering **30** resized the road to a **30′** travel width and the callout updated to "30′".
  - lint 0 · 223 tests · build green; `SitePlannerApp` lazy chunk intact.
- **Not covered:** signed-in cloud-reload of a moved dimension untested (logged-out run, but `dimOffset` rides the normal Site Model persistence). *(The width editor's `prompt()` is now replaced by an inline editor — see V37.)*

### V37 — Edits happen inline on the canvas, never in a dialog box (owner rule) ✅
- **Added** 2026-06-17 · **Checked** 2026-06-17 — self-verified, headless Chromium (local preview of the built artifact) · **Cadence** once (rule acceptance)
- **Why:** owner: dialog-box edits are "horrible UI." Replaced the three `window.prompt` edit dialogs (road travel width, per-edge setback, overlay trace length) with one shared inline `numEdit` `<input>` overlay; rule recorded in CLAUDE.md.
- **Steps:** "Start blank" → Road tool → drew a road → selected it → clicked the red travel-width **number** → (verified no dialog) typed **30** → Enter.
- **Result ✅:** clicking the number opened a small **inline input box on the canvas** at the dimension (accent border, seeded "199") — **no browser dialog fired** (Playwright `dialog` event count = 0; one `foreignObject input` present). Typing **30** + Enter resized the road to a **30′** travel width and closed the editor. Commit-on-Enter / click-away and Esc-to-cancel wired.
- **Not covered:** the per-edge **setback** and overlay **trace-length** editors use the same component (so they inherit the behavior) but weren't separately driven; a native `window.confirm` still guards *deleting* a parcel drawing (a destructive confirmation, not an edit) — left as-is.

### V38 — Markup tools: Bluebeam-style rotate/resize boxes + vertex-edit lines/polys (B147) ✅
- **Added** 2026-06-17 · **Checked** 2026-06-17 — self-verified, headless Chromium (built artifact via `vite preview`) · **Cadence** once (feature acceptance)
- **Steps:** "Start blank" → (a) **Rectangle** tool, drew a box, then with Select dragged a corner grip and the rotate handle; (b) **Polyline** tool, clicked 3 points + Enter, then dragged the middle vertex.
- **Result ✅:**
  - **Rectangle:** on select it shows **4 corner grips + 4 edge grips + a rotate handle** on a stem above the top edge. Dragging the bottom-right corner resized it (width 300 → 410 px). Dragging the rotate handle rotated it (`transform` `rotate(0…)` → `rotate(53…)`); all grips track the rotation. The on-screen rotation matched the headline "rotate a rectangle" ask.
  - **Polyline:** on finish it shows **3 vertex grips + 2 ＋ add-point handles** (correctly none past the open path's last point). Dragging the middle vertex moved it (points string updated).
  - Box geometry also settable precisely via the new panel **Width / Height** + **Rotation°** fields. Zero console/page errors from the change (only the unrelated FBCAD GIS-host CORS error, a known down host).
  - lint 0 · **225 tests** · build green; `SitePlannerApp` lazy chunk intact.
- **Not covered (logged-out headless limits):** ellipse rotate/resize and polygon/line vertex edits weren't separately screenshotted, but they ride the exact same code paths (MK_BOX_KINDS / MK_VERTEX_KINDS) proven here; signed-in cloud-reload of an edited markup untested (markups ride the normal Site Model persistence).

### V39 — Multipart parcel: clicking the smaller tract now selects ALL parts (B151) ✅
- **Added** 2026-06-18 · **Checked** 2026-06-18 — self-verified, headless Chromium against the local `dist/` build (logged-out) · **Cadence** once (bug-fix acceptance)
- **Steps:** "＋ Select parcels" → `setView` on the **west (smaller) tract** of Pearland account `0440520000010` ("TRS 3 & 5", a two-tract parcel) at zoom 17 → clicked the meat of that west tract.
- **Result ✅:**
  - Both HCAD and TxGIO returned account `0440520000010` (2 rings); the on-map highlight is now a **2-subpath multipolygon** whose bbox spans the **full 1326×664 ft** parcel — i.e. **both** tracts light up, including the one clicked (before the fix only the larger east tract did — `gis-verify/pearland-mp-clickwest.png`).
  - Selection card reads **"1 PARCEL · 14.78 AC · DEL PAPA"** — full acreage, correctly counted as a single parcel (was 8.12 AC, east-only). Screenshot `gis-verify/pearland-FIXED-clickwest.png`; script `gis-verify/pearland-fix-verify.mjs`.
  - lint 0 · 230 tests · build green; `SitePlannerApp` lazy chunk intact.
- **Not covered:** the in-planner identify (`addIdentifiedParcel`) and address/account lookup (`importFeature`) paths got the same multipart fix but were verified by code + unit tests, not a separate click-through; a signed-in cloud-reload pass is untested (logged-out run, but parcels ride the normal Site Model persistence).

### V40 — Delete removes the selected element on the first press (B154) ✅
- **Added** 2026-06-18 · **Checked** 2026-06-18 — self-verified, headless Chromium (built artifact via `vite preview`) · **Cadence** once (bugfix acceptance)
- **Steps:** "Start blank" → drew two buildings far apart. (A) **baseline:** clicked one → pressed **Delete** once. (B) **reported flow:** clicked a tool/panel button (**Pan**, then **Select**) to move focus off the canvas, then clicked a building and pressed **Delete** once *with no settle delay* (stresses the stale-listener window).
- **Result ✅:**
  - **A baseline:** 2 → 1 — a single Delete removed the selected building.
  - **B from a panel control:** 2 → 1 — one immediate Delete removed exactly one building (previously this was the "needs two presses" case). Reliable across runs.
  - Zero console/page errors.
  - lint 0 · **230 tests** · build green; `SitePlannerApp` lazy chunk intact.
- **Typing guard (code-verified, not regressed):** the bail-when-a-field-is-focused guard is pre-existing (`document.activeElement` is INPUT/SELECT/TEXTAREA → return); this change only **appended** `contentEditable`, so the "Delete while editing a field must not nuke canvas elements" behavior is unchanged. (A live headless guard test was flaky only because reliably focusing the right panel input in the built UI was finicky — not a behavior gap.)

### V41 — Grab an unfilled markup shape by its INTERIOR, not just the border line (B155 increment 1) ✅
- **Added** 2026-06-18 · **Checked** 2026-06-18 — self-verified, headless Chromium (built artifact via `vite preview`) · **Cadence** once (fix acceptance)
- **Why:** owner-reported — selecting a markup rectangle was "kinda difficult, you have to grab exactly on the line." Cause: closed shape markups (`rect`/`ellipse`/`polygon`) rendered `fill:"none"` with selection on the element's own `onPointerDown`, so only the painted 2px stroke was a click target. Fix: `pointerEvents:"all"` on those shapes (same technique B142 used for text/callout boxes) so the **whole interior** is a hit target even when unfilled. Applied in `SitePlanner.jsx` and `components/ParcelDrawing.jsx` (the Box tool).
- **Steps (Site Planner):** "Start blank" → **Rectangle** tool (R) → dragged an unfilled box → **Escape** (deselect) → clicked the rectangle's **interior centre** (not the border).
- **Result ✅:** the drawn `<rect>` carries `pointer-events="all"` with `fill="none"` (interior is a hit target). Selection handles (the rotate `circle[r="6"]`) read **1 after draw → 0 after Escape → 1 after the interior click** — i.e. clicking inside the empty box re-selected it; the "MARKUP · RECT" panel opened (Fill opacity at 0, confirming it's unfilled). Screenshot `/tmp/b150-after-interior-click.png` shows the selected unfilled box with grips. lint 0 errors · **230 tests** · build green; `SitePlannerApp` / `DocReview` lazy chunks intact.
- **Not covered:** **ParcelDrawing's** identical one-attribute change (the Box on a parcel drawing) wasn't separately driven — it needs a real drawing attached + rasterized (V9's flow), which is awkward logged-out; it's the same `pointerEvents="all"` edit on an analogous `fill:"none"` rect whose move handler already `stopPropagation`s, so low-risk by analogy. Doc Review's rect interior-select was already shipped under B33. The broader B155 tranche (shared `hitTest`, screen-space tolerance, forgiving line/polyline hit area, z-order tie-break, hover preview B156) is **not** in this increment — still ⏳ in BACKLOG B155/B156.

### V47 — Parcel active-state inheritance (B213) + edge-run setbacks (B214) + fanned dimensions (B215) ✅
- **Added** 2026-06-19 · **Checked** 2026-06-19 — self-verified, headless Chromium against the local `dist/` build (logged-out) · **Cadence** once (feature + bugfix acceptance)
- **Steps:** seeded a project with an **active** parcel whose east side is digitized as **3 near-collinear segments** (6 edges total → 4 logical sides) + an **inactive** parcel + two boundary easements (one anchored to the inactive parcel, one free) → opened it from the breadcrumb → Zoom-to-fit → read the canvas, then selected the active parcel and toggled the setback editor. Script `ui-audit/verify-edge-runs.mjs`.
- **Result ✅ (7/7):**
  - **B213:** exactly **1 acreage chip** and **1 setback line** render (the inactive parcel draws neither); the easement **anchored to the inactive parcel is hidden** while the free easement still shows (1 easement polygon). Screenshot `ui-audit/screens/edge-runs-1-loaded.png`.
  - **B214:** selecting the parcel shows **one setback pill per SIDE — 4 pills (S, the 3-segment E run, N, W), not 6** (`edge-runs-2-selected-byside.png`); the **"Per segment"** toggle switches to **6 pills**, one per edge (`edge-runs-3-persegment.png`); toggling back returns to 4. Editing a side pill writes the canonical per-edge `pc.setbacks` for every segment in the run (offsetPolygon miters the joints into one continuous line).
  - **B215:** the run-length boundary dimension (outboard) and the setback value pill (inboard) are **fanned 25 px apart** — never stacked/occluded — and there are exactly **4 run-length dims** (one per side), not one per segment.
  - lint 0 errors · **394 tests** (12 new in `test/edgeRuns.test.js`, post-merge with `main`) · build green; `SitePlannerApp` / `DocReview` lazy chunks intact.
- **Not covered (logged-out headless limits):** the Alt-click single-segment override on a side pill and signed-in cloud-reload of an edited setback weren't separately driven — both ride the same `setEdgeSetback`/Site-Model persistence paths proven by the unit tests + the per-segment toggle here.

### V48 — Edge-run setbacks on IRREGULAR parcels: concave inward placement + gentle-curve grouping (B216) ✅
- **Added** 2026-06-19 · **Checked** 2026-06-19 — self-verified, headless Chromium against the local `dist/` build (logged-out) · **Cadence** once (edge-case hardening acceptance)
- **Steps:** seeded six irregular parcels — a concave **L-shape**, a **flag lot** (narrow pole into a wide flag), a **tight curved frontage** (~15°/segment), a **gentle curved frontage** (~1.6°/segment, a 50 ft bulge over 900 ft), a **dense 12-vertex survey boundary**, and a **triangle** — opened each from the breadcrumb, fit, selected the parcel, and read the on-canvas setback pills + run-length dimensions. Script `ui-audit/verify-edge-runs-irregular.mjs`.
- **Result ✅ (19/19):**
  - **Concave inward placement (B215 fix):** on the L-shape (**6/6**) and flag lot (**8/8**) every setback pill lands on the **INTERIOR** side of its edge and every run-length dim on the EXTERIOR — including the notch edges where the old "toward the centroid" logic threw pills outside the lot. Verified by point-in-ring against the rendered polygon. Screenshots `ui-audit/screens/irregular-Lshape.png`, `irregular-flagLot.png`.
  - **Gentle-curve grouping (B214 fix):** the shallow 16-segment arc frontage groups into **4 sides** (one setback pill for the whole curve), not 17 — `irregular-gentleCurve.png`. A **tight** curve correctly stays per-segment (13 sides) — `irregular-curvedFront.png` — since it isn't one straight side.
  - **No NaN** positions on any shape; the dense survey boundary's near-collinear segments collapse to **8** clean sides; the triangle reads **3**.
  - lint 0 errors · **411 tests** (14 in `test/edgeRuns.test.js`) · build green; the original **B213–B215 acceptance still 7/7** (`ui-audit/verify-edge-runs.mjs`).
- **Not covered (logged-out headless limits):** signed-in cloud-reload of an edited irregular-parcel setback (rides the same Site-Model persistence as the V46/V47 cases); self-touching / zero-area degenerate rings (guarded by `offsetPolygon` + the `edgeRuns` degenerate-input unit tests, not separately driven in-browser).

### V50 — Map-finder Esri imagery no longer over-zooms to the gray "Map data not yet available" placeholder on retina (B220) ✅
- **Added** 2026-06-20 · **Checked** 2026-06-20 — self-verified, headless Chromium against the local `dist/` build (logged-out) · **Cadence** once (bugfix acceptance)
- **Steps:** booted the **map finder** over a Katy parcel (29.786, −95.83) at **deviceScaleFactor 1 (standard)** and **2 (retina)**, fit to the parcel, then wheel-zoomed in deep (toward maxZoom 21) with the labels overlay on, recording the `{z}` of every `World_Imagery` (imagery) and `World_Transportation` (labels) tile actually requested + any past-native / placeholder-sized responses. Script `gis-verify/mapfinder-overzoom-verify.mjs`.
- **Result ✅ (4/4):**
  - **Imagery clamped:** max imagery tile zoom requested = **z19 at BOTH densities** (DSF 1 and DSF 2). Pre-fix the retina run requested **z20** (one past Esri's native z19 = the gray placeholder); now it clamps to z19 and Leaflet upscales past that.
  - **Deep zoom genuinely reached:** z19 imagery tiles were requested (at DSF 2, getting a z19 URL requires map zoom ≥ 18, since detectRetina adds +1 to the z18 clamp) — so the test exercised the over-zoom range, not a trivial pass.
  - **Labels aligned:** max labels (World_Transportation) tile zoom = **z19** at both densities — the reference overlay no longer diverges above the imagery ceiling (the "labels float over gray" tell is gone).
  - **No placeholders:** **0** past-native / placeholder-sized responses across both runs.
  - lint 0 errors · **414 tests** · build green; `SitePlannerApp` / `DocReview` lazy chunks intact.
- **Not covered (logged-out headless limits):** the visible *sharpness* gain of detectRetina is invisible at the sandbox's effective DPR and is best eyeballed on Michael's own retina/4K display (the higher-density tile request is proven engaged here and in V43); the planner-canvas backdrop was already fixed + verified under B182.

### V51 — Row color fill no longer hides the Gantt bars (B222) ✅
- **Added** 2026-06-20 · **Checked** 2026-06-20 — self-verified, headless Chromium against the standalone `public/sequence/` app (logged-out seed) · **Cadence** once (bugfix acceptance)
- **Steps:** intercepted the seed so the active project's first **leaf** task carries a row fill (`rowColor:#c7d2fe` Indigo) from first render, then probed every `<div>`'s computed background. Script `ui-audit/verify-rowfill-bars.mjs`.
- **Result ✅:** the fill paints the **row bands** (grid + Gantt rows — `rowBands:2`) while **no bar-sized element shares the fill** (`barCollisions:0`); the filled leaf's own bar keeps its neutral identity — `bg rgb(148,163,184)` (`#94a3b8`) with the new **slate hairline edge** `rgb(71,85,105)` (`#475569`, 1px). Visual: the filled "Begin DD" row shows the Indigo tint with its marker fully visible on top (`ui-audit/screens/rowfill-bars-crop.png`). The summary brackets (navy) and milestone diamonds were de-coupled from `rowColor` in the same pass.
- **Not covered (logged-out limits):** none material — the fix is render-only (no persistence); the PDF/Print export path (`buildGanttSVG`) already never colored bars from `rowColor`, so it had no collision to fix.

### V52 — Schedule prefetch + the themed "assembling" loader (B223 + B224) ✅
- **Added** 2026-06-20 · **Checked** 2026-06-20 — self-verified, headless Chromium against the local `dist/` build (logged-out) · **Cadence** once (feature + perf acceptance)
- **Steps:** loaded the built shell, waited for idle, then navigated to the **Schedule** tab; also reloaded with `prefers-reduced-motion: reduce` emulated. Script `ui-audit/verify-loader-prefetch.mjs`.
- **Result ✅:**
  - **B223 prefetch:** after boot-idle a `<link rel="prefetch" href="/sequence/">` is injected (warms the heavy iframe doc); hover-intent on the tab warms it too (same idempotent `prefetchModule`). Virtualization + in-session layout memoization were confirmed already present (`GridView`/`GanttView` windowing), so the prefetch is the net-new win.
  - **B224 loader:** navigating to Schedule shows the loader (`role="status"`, `aria-label="Assembling schedule…"`) — a Gantt assembling itself: ghost name column, zebra bands, **12 task elements painted the `#7F77DD` accent**, milestone diamonds, and the playhead sweep — then it cross-fades out once the iframe posts its first nav-state. Screenshot `ui-audit/screens/loader-schedule.png`.
  - **Reduced-motion:** with `prefers-reduced-motion`, the loader still renders but the cascade + sweep are dropped — **0 animated bars, no playhead** (`ui-audit/screens/loader-reduced-motion.png`).
  - 0 boot console errors; lint 0 · **419 tests** (5 new in `test/moduleLoaderTheme.test.js`) · build green; the `Scheduler` / `SitePlannerApp` / `DocReview` lazy chunks intact.
- **Not covered (logged-out limits):** the signed-in path is identical (the loader/prefetch are auth-agnostic shell chrome); the Site-Planner skin (`#1D9E75` footprints) shares the one engine + is unit-tested, shown on the SitePlannerApp chunk's first load.

### V53 — Building feature-edit buttons hide when the on-screen footprint is too small; show only on the selected/hovered building (B225 + B226) ✅
- **Added** 2026-06-20 · **Checked** 2026-06-20 — self-verified, headless Chromium against the local `dist/` build (logged-out) · **Cadence** once (bug + feature acceptance)
- **Steps:** seeded one **400′×300′ cross-dock building** in a parcel, resumed into the planner. **B225:** selected it, then swept the wheel zoom from large to tiny, and at each step measured the building footprint rect's on-screen px **and** counted the drawn feature-add buttons (the +/− circles with an "Add …"/"Remove this" `<title>`), comparing to the count predicted by the per-axis rule. **B226:** with nothing selected, moved the cursor off the building, onto it, and off again, counting buttons each time. Script `ui-audit/verify-b225-b226.mjs`.
- **Result ✅ (all checks passed):**
  - **B225 size-gate (per-axis):** **8** buttons while the footprint was large (494×370 … 127×95px); **2** (the long-side sidewalk buttons only) at **81×60px** — height < 72 ≤ width, so the cramped short-end + corner buttons correctly drop while the long-side ones persist (the overlap/"also check" case, handled without a collapse menu); **0** once tiny (≤ 64×48px) — no spill, no cluster. The drawn count matched the rule predicted from the measured px at **every** non-ambiguous step. Screens: `b225-zoomed-in.png`, `b225-partial-longside.png`, `b225-zoomed-out.png`.
  - **B226 selected-or-hovered:** nothing-selected & not-hovering = **0** buttons; hovering the building = **8** (revealed by hover alone — `b226-hover.png` shows the add-buttons with NO selection grips); moving off = **0**. So the buttons appear on the ONE active building only, gated by the same size rule.
  - lint 0 errors · **414 tests** · build green; `SitePlannerApp` lazy chunk intact.
- **Not covered (logged-out headless limits):** none material — the feature is purely client-side geometry/render; no auth or network path involved. The map's **Building Pin + Progress Arc** (`MapFinder.jsx`) are a separate component and were deliberately left untouched (still visible at every zoom).

### V54 — Redesigned Site Yield panel: composition donut + legend + grouped rows (B227) ✅
- **Added** 2026-06-20 · **Checked** 2026-06-20 — self-verified, headless Chromium against the local `dist/` build (logged-out) · **Cadence** once (feature acceptance)
- **Steps:** seeded two logged-out sites and opened the **Yield** tab. **Seed A (spec example):** a 29.25-ac parcel with a 226,576-sf building + paving only, no pond → coverage 18 %, impervious 31 %. **Seed B:** added a parking field + a detention pond. Read back the donut arcs' `stroke-dasharray`, the legend, the KPI cards, and the grouped rows; also toggled the header to confirm collapse/expand. Script `ui-audit/verify-yield.mjs` (+ a collapse probe).
- **Result ✅:**
  - **Donut closes:** the four arcs' lengths sum to **100.0 % of the circumference** in BOTH seeds — the ring always closes (open is the clamped remainder). Seed A paints Building 18 / Paving 13 / Open 69 with **no detention arc**; Seed B paints all four incl. the dusty-blue detention slice (18 / 11 / 66 / 5). Center reads the site acreage over "acres".
  - **Legend ↔ rows agree:** legend %s match the detail rows (Coverage 18 % = donut Building; Impervious − Coverage = Paving; Detention %). The **Detention legend row always renders even at 0 %** with the muted hollow zero-state swatch (`#DCE5EB`/`#C2D2DC`) — a zeroed share is present-and-zero, never hidden.
  - **KPI abbreviation:** the **Building card shows `227k`** while the **Building detail row shows the full `226,576 sf`** — exactly the requested split.
  - **Grouped rows wired live:** Land / Building / Parking / Stormwater each render with their semantic dot; Seed B's Parking group reads **Car stalls 220 · 0.97/1k sf** (proves the rows carry live engine values, not placeholders).
  - **Collapse preserved:** clicking the "SITE YIELD" header hides the body and clicking again restores it (grouped rows visible → hidden → visible).
  - **0 page errors** in either seed; screenshots `ui-audit/screens/yield-panel.png` + `yield-panel-detention.png`. lint 0 · **436 tests** · build green; `SitePlannerApp` lazy chunk intact.
- **Not covered (logged-out limits):** none material — the panel is presentational and reads engine outputs the planner computes locally (no auth, no persistence change); the signed-in path renders the identical component from the same values.

### V57 — Map finder: address search recenter + parcel info, shared status tokens, left-rail rework, layer vintage (B232–B236) ✅
- **Added** 2026-06-20 · **Checked** 2026-06-20 — self-verified, headless Chromium against the local `dist/` build (logged-out, this-device seed) · **Cadence** once (bugfix + feature acceptance)
- **Steps:** seeded 7 sites across all five statuses into `planarfit:sites:v1`, booted the map finder, then asserted pins/chips/rail/layers and drove the address search. Script `ui-audit/verify-b232-b236.mjs` (21/21, re-run on the merged build).
- **Result ✅:**
  - **B234 tokens:** the five pins paint in the new status colors (Pursuit `#378ADD`, Active `#639922`, On Hold `#BA7517`, Complete `#888780`, Dead `#E24B4A`); the module accents `#EF9F27`/`#1D9E75` are confirmed **absent** from pins.
  - **B235 rail:** the type-to-filter box narrows the list (and surfaces a match inside a collapsed group); Complete/Dead collapse by default and expand on click; the Active chip narrows the map **7→2 pins** and the header shows `2/7`.
  - **B236 vintage:** toggling FEMA on shows the low-weight **"as of: Effective date varies by FIRM panel"** stamp, distinct from the refreshed-age.
  - **B232/B233 address search:** searching **"19630 Crossbranch Dr, Katy, TX"** recentered the map on the parcel and produced a **"📍 CROSSBRANCH"** info card (Account 1403613 · 0.27 ac measured · land/improvement/total values · land use · legal) with the parcel highlighted + "Plan this site →".
  - 0 uncaught page errors; lint 0 · **448 tests** · build green; lazy chunk split intact.
- **Not covered (logged-out limits):** the live geocode (Esri) + county parcel identify happened to be reachable from the sandbox here (the Crossbranch card is real data); on a network where they're blocked, B232/B233 degrade to the honest "couldn't find that address" / "source unavailable" states (same script branch exercises this). Cloud-synced sites (signed-in) render through the identical `statusOf`/token path.

### V59 — New Planyr coral favicon/app icon + BrandMark in the header (B240 + B241) ✅
- **Added** 2026-06-20 · **Checked** 2026-06-20 — self-verified, headless Chromium against the local `dist/` build (logged-out) · **Cadence** once (feature acceptance)
- **Steps:** generated the raster set with `node brand/generate-icons.mjs`, then ran `node ui-audit/verify-brand-icons.mjs` against a `vite preview` of the production `dist/` build. It (a) decodes `public/favicon.ico` + `public/apple-touch-icon.png` and asserts their structure, and (b) screenshots the running app header. Also eyeballed large renders of `brand/planyr-favicon.svg` + `brand/planyr-mark.svg`, the 48px ICO frame, and the 180px apple-touch tile. (Re-verified post-merge on top of the B230–B239 main.)
- **Result ✅ (all checks passed):**
  - **Icons render the full three-tier coral stack — not blank, not clipped.** The favicon SVG and the 48px `.ico` frame show the simplified solid stack on the dark rounded tile (transparent corners); the 180px apple-touch shows the same on a dark full-bleed tile (iOS masks the corners); the full display mark shows the gridded base · glass middle · wireframe top. (An earlier render clipped at the bottom because headless caps usable viewport height — fixed in the generator by rendering tall and cropping; re-verified.)
  - **`favicon.ico` carries 16/32/48 PNG-embedded frames**; **`apple-touch-icon.png` is 180×180.**
  - **Served correctly:** `vite preview` returns **200** for `favicon.svg` (image/svg+xml), `favicon.ico` (image/x-icon), `apple-touch-icon.png` (image/png), and `planyr-mark.svg`. Built `dist/index.html` references resolve to `./favicon.svg` / `./favicon.ico` / `./apple-touch-icon.png` under the root deploy.
  - **Header (B241):** the logo slot renders `<BrandMark>` — the coral floating stack + "planyr" wordmark (`#F4F1E9`) on the dark chrome — at 20px; the per-module accent still drives the Site/Schedule/Markup tabs + breadcrumb. Screenshot `ui-audit/screens/brand-header.png`.
  - lint 0 errors · **481 tests** · build green; `AppHeader` shared chunk intact.
- **Live-tab caveat (the one real-world check left):** favicons cache aggressively, so after the deploy to planyr.io a **hard-refresh** is the only reliable confirmation the tab shows the new icon — a stale open tab keeping the old icon is **not** proof of failure. The artwork, raster structure, and serving are all verified above.

### V60 — Print now downloads a Planyr-composed PDF (no browser print dialog): white bg, exact page size, no injected chrome (B243) ✅
- **Added** 2026-06-20 · **Checked** 2026-06-20 — self-verified, headless Chromium against the local `dist/` build (logged-out) · **Cadence** once (bug acceptance)
- **Steps:** two harnesses. **(1) Pipeline** `ui-audit/verify-pdf-export.mjs` — ran the EXACT browser export path (compose the real `buildPrintSheetSvg` sheet → `<img>`+canvas raster at 300 DPI → JPEG → the real `jpegToPdf`) for **Letter-landscape** and **Tabloid-landscape**, with a synthetic plan carrying a `feDropShadow` filter + an embedded `<image>`; validated each PDF with `pdfjs`. **(2) Real app** `ui-audit/verify-pdf-download.mjs` — drove the BUILT app: seeded a 2-building site, opened the planner, **File ▾ → Download PDF / pick frame… → Download PDF**, and captured the ACTUAL downloaded file.
- **Result ✅ (all checks passed):**
  - **Real download, no pop-up:** clicking **Download PDF** saved `2026.06.20 Mesa Logistics - Plan 1.pdf` — a valid `%PDF`, **numPages 1**, page **exactly 792×612 pt (Letter landscape)** — with **ZERO pop-up windows** opened (the old `about:blank` print window is gone) and **0** console/page errors. Because Planyr builds the PDF itself and hands it over as a download, there is **no browser print dialog**, so the date/time header, `about:blank` footer, and page number simply cannot appear.
  - **White, not cream:** all four paper-margin corners sample white; **no cream FIELD** (≤1 stray warm pixel out of 8k–17k sampled = a JPEG chroma-edge artifact, not a background). The screen page colour `#f4f1ea` is forced white for the PDF (both the sheet fill and the plan-clone background rect).
  - **Exact page size, fills the sheet:** Letter→**792×612 pt**, Tabloid→**1224×792 pt** — the page IS the chosen size (no Letter-on-Tabloid float), content fills it edge-to-edge.
  - **Fidelity preserved:** the embedded raster keeps the **building drop-shadow** (`feDropShadow`) and the **aerial `<image>`** — effects the old browser-print relied on the browser to render — plus the title block, north arrow, scale bar, dimension labels, the BUILDINGS table, and the footer metric strip, all crisp at 300 DPI. Visual: `ui-audit/screens/live-download-page.jpg` (real-app output) + `pdf-export-letter.jpg`.
  - **+10 unit tests** (`test/imagePdf.test.js`: byte-accurate xref, MediaBox in points, DCTDecode embed, title escaping). lint **0** · **496 tests** · build green (re-verified after merging the latest `main`); the existing live print harness (`verify-print-live.mjs`) still passes with the renamed menu item; `SitePlannerApp` lazy chunk intact.
- **Not covered (logged-out headless limits):** a signed-in export with a LIVE cross-origin aerial basemap actually inlined (here `origin:null`, so no basemap fetch). That path reuses the same time-boxed `inlineImages` the old print + PNG export used; on this PDF path it **drops** a CORS-blocked image (white canvas, vector plan still exports) rather than tainting the canvas — best eyeballed once on a signed-in site with the aerial on.
