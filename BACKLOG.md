# Planyr — Backlog

Single source of truth for bugs and feature requests. Repo: `planyr` (product: **Planyr**).

> *"Single source of truth"* = the one file everyone trusts for what's done and what's left, so status never has to be tracked in anyone's head or in a chat thread.

---

## How this file works — Claude Code, read this first

- **On each run:** address every item under **🔲 Open**. Skip everything under **✅ Done** — it's already handled. Do **not** action anything under **🕓 Later / Roadmap** unless it's been moved up to Open.
- **IDs are permanent, and only minted here — at filing time.** The next ID = the highest existing `B#` in this file + 1. Never renumber or reuse a number, even after items are done.
- **Items pasted from another chat are "blind" to this file** and may carry provisional `NEW-#` (or stale/colliding `B#`) labels — treat those as scratch references only and assign the real next `B#` when filing.
- **Before filing, dedupe.** If an arriving item already exists here (reported from another chat), merge it into the existing item or skip it — never create a duplicate or a colliding ID.
- **When you finish an item:** move its whole block from 🔲 Open to ✅ Done, flip `[ ]` to `[x]`, and append a one-line note — what changed, the date, and the PR/commit if there is one.
- **Always commit after editing this file or finishing a fix** — never leave the working tree dirty. A fix that isn't committed doesn't count as done.
- **Never delete items.** Completed ones stay in ✅ Done as a record.
- **If an item is ambiguous,** don't guess. Mark it `[?]`, add your question inline, and leave it in Open.
- **Bracket tags** like `[Site Planner]` mark the module. `(bug)` / `(feature)` / `(task)` marks the type.

---

## 🔲 Open

### B13 — Refine B11 county resolution: precise boundaries + per-area jurisdiction `[Site Planner / map]` (feature)
`[ ]` Follow-up to **B11** (shipped in PR #13) — two interim simplifications captured here so they aren't forgotten. Neither is urgent; both are screening-only conveniences today and degrade gracefully.
- **Coarse bbox pre-filter → real point-in-county.** B11 routes a parcel click to a CAD service using *approximate* per-county bounding boxes (a coarse screen; the CAD that actually returns a lot is the source of truth, with a fall-back to querying all counties). Fine for the 3 configured counties (Harris / Fort Bend / Chambers), but as more counties are added, switch to true point-in-county boundary polygons so the pre-filter stays accurate and cheap. **(STILL OPEN.)**
- **Layers panel jurisdiction is hardcoded to Harris/Houston.** ~~With no county pre-picked, the map's Layers panel defaults to the Harris/Houston jurisdiction…~~ **DONE** — the map Layers panel jurisdiction now follows the map's current area.
> Progress 2026-06-15 (this PR): **point 2 done** — the map's Layers panel jurisdiction is no longer hardcoded to Harris; `MapFinder` resolves `viewCounty` from the view centre via `candidateCountiesForPoint` on every `moveend`, so the correct utility overlays are offered outside Houston (falls back to Harris when the centre is outside all configured counties; per-site jurisdiction still follows the opened site's county). **Point 1** (true point-in-polygon county boundaries vs. the bbox pre-filter) remains open — the bbox screen is still adequate for the 3 configured counties, so this is deferred until more counties are added.

---

## 🐞 Bug audit — 2026-06-15 (overnight sweep)

Systematic read-through of the whole codebase (5 parallel audits, each finding verified against the source). Severity/confidence noted per item. Items tagged **🔧 fixed in audit PR** were fixed in the same PR that added this section; the rest are triaged for review. IDs are permanent (B15+).

### B15 — Import JSON drops callouts & markups, and leaves stale ones on the canvas `[Site Planner]` (bug) — DATA-LOSS, high
`[x]` 🔧 fixed in audit PR. `importJSONFile` (SitePlanner.jsx ~2459) set parcels/els/measures/settings/underlay but **not** `callouts`/`markups`, although `exportJSON` writes them. Result: (a) imported callouts/markups are discarded; (b) the currently-open plan's callouts/markups aren't reset, so they bleed into the imported plan and get persisted on the next autosave. Fix: `setCallouts(d.callouts || [])` + `setMarkups(d.markups || [])` in import (symmetric with export).

### B16 — `isBlankSite` ignores `markups` → markup/encumbrance-only sites are silently deleted on leave `[Site Planner]` (bug) — DATA-LOSS, high
`[x]` 🔧 fixed in audit PR. `isBlankSite` (SitePlanner.jsx ~795) omits `markups`, so a site whose only work is drawn markups or a plotted metes-and-bounds **encumbrance** is treated as blank: the autosave guard skips it and `persistOrDrop` *deletes* the un-located record on unmount. Fix: include `markups` in `isBlankSite` and in the autosave guard object.

### B17 — Doc Review local mirror saved without `updatedAt`; `reconcile` compares mismatched fields `[Document Review]` (bug) — DATA-LOSS risk, high
`[x]` 🔧 fixed in audit PR. `buildSnapshot` (DocReview.jsx/Stitcher.jsx) omits `updatedAt`, so `flushLocal()→writeDraft` mirrors a record whose `data.updatedAt` is stale/absent; `reconcile` then compares cloud `updatedAt` vs draft `_localAt` (different events/clocks) and can let a stale local draft shadow a newer cloud copy. Fix: stamp `updatedAt: Date.now()` in `buildSnapshot` so the mirror and the cloud `data` carry a consistent timestamp.

### B18 — Last-debounce-window edits flush local-only and are lost when `pullCloud` blind-replaces on next login `[Site Planner]` (bug) — DATA-LOSS, high
`[ ]` The beforeunload/visibility/unmount/site-switch flushes call `saveSite` (local cache) but **never** `pushSiteToCloud`; `pullCloud` then *replaces* the per-user cache wholesale on next login, discarding any edit made in the final ~400 ms before close that the debounced cloud push missed. Fix options: make `pullCloud` merge by `updatedAt` (keep the newer side), and/or push on `pagehide` via `fetch(..., {keepalive:true})`/`sendBeacon`. (Bigger change — left for review.)

### B19 — Resume-on-mount re-saves the just-loaded review with a fresh `updatedAt` `[Document Review]` (bug) — correctness, medium
`[ ]` `loadSingleReview`/`loadStitch` set state → the debounce deps change → autosave writes the loaded snapshot back with `updatedAt: now`, so a resume can stamp stale data as newest and (multi-tab) clobber a newer cloud edit. Fix: a `suspendSave` ref set during programmatic load, early-returning from the autosave effect for that tick.

### B20 — `setProjectStatus` rewrites every plan in the group via `cloudUpsert` (strips inline underlay, heavy, clobber risk) `[Document Review]` (bug) — correctness, medium
`[ ]` Flipping a project's status from the library round-trips each site row's whole `data` through `cloudUpsert`, which `slimForCloud`-strips any still-inline `data:` underlay and bumps `updated_at` on every plan (can clobber a concurrent edit). Cloud copies are usually already slimmed so true loss is unlikely, but a status dropdown shouldn't rewrite full site blobs. Fix: a minimal status-only write (jsonb patch/RPC) or guard the underlay before re-upsert.

### B21 — Down overlay re-probes & repaints the error banner every 45 s forever; background errors share the click-instruction slot `[Site Planner / map]` (bug) — correctness, high
`[x]` 🔧 fixed in audit PR. `PROBE_TTL` (40 s) < the 45 s re-probe interval, so a genuinely-down enabled layer re-probes and re-fires `onError` every tick, repainting the bottom-left banner indefinitely; that banner is also the only `err` slot, so a background layer hiccup masks the "click a lot" guidance until a user action clears it. Fix: de-duplicate identical error toasts and auto-clear background layer errors after a timeout.

### B22 — Rapid parcel clicks race → duplicate selection + leaked highlight polygon `[Site Planner / map]` (bug) — correctness, medium
`[x]` 🔧 fixed 2026-06-15 (branch `site-planner/map-gis-robustness`) — defensive: `handleClick` now removes any pre-existing hilite for a key before overwriting (no orphaned `L.polygon`) and dedupes the `selected` entry by key (no double-counted acreage). NOTE: in the current code the toggle check runs AFTER the `await`, so two clicks resolve sequentially into a correct toggle and the described double-add doesn't actually reproduce — these guards close the theoretical gap without an in-flight ref that would drop a legitimate second-lot click. `handleClick` is async with no sequence guard; two fast clicks on the same lot can both take the "add" branch (the toggle check runs before the first `await` resolves), producing a duplicate `selected` entry (double-counted acreage) and an orphaned `L.polygon` left on the map. Fix: guard with an in-flight ref / request id, and remove any pre-existing hilite for a key before overwriting.

### B23 — `ditchStats` returns `NaN` profile distance for a single elevation sample `[Site Planner]` (bug) — correctness, high
`[x]` 🔧 fixed in audit PR. elevation.js only guards `length === 0`; with exactly one sample, `i/(n-1) = 0/0 = NaN` flows into the cross-section profile/labels. Fix: treat `< 2` samples as insufficient (`return null`), letting the caller's "no samples" path handle it.

### B24 — `measureLabel` prints `"NaN"` / can crash on degenerate measurement points `[Document Review]` (bug) — correctness, medium
`[x]` 🔧 fixed in audit PR. takeoff.js `measureLabel`/`measureValue` have no finite/length guard; an empty `distance` markup dereferences `m.pts[0].x` (throws) and short polys can render `"NaN ft/ac"`. Fix: guard missing/short `pts` and non-finite values.

### B25 — Metes-and-bounds: curve calls silently parsed as straight chords; no unreadable-call flagging `[Site Planner]` (bug) — correctness, high
`[ ]` `CALL_RE` has no `radius`/`arc`/`delta`/`chord` handling; given a curve call it matches the chord bearing+distance and dead-reckons it as a straight segment, with no `dropped`/`unparsed` signal — so the traverse is silently wrong and the UI can't warn. (Roadmap already wants "parse curves; flag unreadable.") Fix: detect curve calls and either tessellate the arc or return `{unparsed:true, raw}` so callers can flag them.

### B26 — Metes-and-bounds: parser gaps (dash-DMS unparsed, deg>90 accepted, loose closure floor) `[Site Planner]` (bug) — correctness, medium
`[ ]` (a) The header advertises `S 12-15 W` but the DMS separator classes exclude `-`, so dash-separated bearings return `[]` (silently dropped). (b) The degrees group `[0-9]{1,3}` accepts a quadrant bearing > 90° (e.g. `N 145 E`) and plots it. (c) `pathCloses` floors tolerance at `max(25, 2%·perim)` so a small lot can be declared "closed" with a 25-ft misclosure, hiding parse errors. Fix: add `-` to the separator classes; reject/flag `deg>90`; drop/shrink the absolute closure floor and always surface the misclosure.

### B27 — Enter-to-commit power-line trace uses stale `tracePts`/`traceMode` `[Site Planner]` (bug) — correctness, medium
`[x]` 🔧 fixed in audit PR. The keydown effect closes over `traceMode`/`tracePts` but they're not in its dep array, so pressing Enter to finish a trace reads stale values (often `[]`). Fix: add `traceMode`/`tracePts` to the effect deps (double-click already worked because it's a fresh prop).

### B28 — `mergeRings` collinear-cleanup threshold is area-based (scale-dependent) `[Site Planner]` (bug) — correctness, medium
`[ ]` The corner test `Math.abs(cross) > 1` compares twice-triangle-area in ft² (scales with edge length), so on long edges a real slight bend can be dropped (or noise kept), distorting a merged parcel boundary/acreage. Fix: threshold the *perpendicular distance* `|cross|/hypot(c−a)` against a small foot tolerance.

### B29 — Parking +/− shrink guard ignores per-field `cfg` overrides `[Site Planner]` (bug) — correctness, medium
`[ ]` `parkBand()`/`canShrink` use global `settings.stallDepth/aisle`, but `growParking` uses `cfgOf(el)`; for a field with per-element cfg the on-canvas − handle is enabled/disabled against the wrong row size (guard disagrees with the actual op). Fix: compute the band from `cfgOf(el)` in the guard too.

### B30 — Markup/measure minimum size is in feet, not pixels → silently discarded when zoomed out `[Site Planner]` (bug) — minor, medium
`[ ]` The `dist(a,b) >= 2` / `w,h >= 2` minimums are world-feet; at low ppf a deliberate multi-pixel drag can be < 2 ft and the markup/measure is dropped with no feedback. Fix: make the minimum pixel-based (scale by view ppf).

### B31 — Two-point Split returns null when both crossings share an edge `[Site Planner]` (bug) — minor, low
`[ ]` `if (lo.i === hi.i) return null` uses only the extreme-`t` hits, so a valid straight cut across a concave parcel (whose first/last crossings land on the same edge while valid interior crossings exist) silently no-ops. Fix: when `lo.i === hi.i`, pick the two crossings with distinct edge indices that yield two ≥3-vertex rings.

### B32 — Undo stack polluted by `pushHistory` on no-op edits `[Site Planner]` (bug) — minor, high
`[ ]` `beginEditCallout` and the dock/type `onChange` handlers call `pushHistory()` before/without an actual change, so cancelling a callout edit or reselecting the same dropdown value adds an undo frame (first Ctrl+Z appears to do nothing). Fix: push history only when a mutation is actually applied.

### B33 — Doc Review redline shapes (rect/cloud/text) are unselectable except at corner points `[Document Review]` (bug) — minor, high
`[ ]` `hitTest` measures distance only to stored vertices; rect/cloud store two corners and text one point, so clicking an edge or body never selects them (hard to select/delete redlines). Fix: shape-aware hit testing (point-in-rect, distance-to-segment, text bbox).

### B34 — Doc Review single-viewer `render()` calls `setScale` internally → re-entrant render race `[Document Review]` (bug) — correctness, medium
`[ ]` In fit-to-width mode `render` calls `setScale(s)` then keeps drawing; the `scale` change re-fires the render effect, so two renders run and `dims`/canvas can briefly mismatch the overlay. Fix: compute fit scale in a separate effect; keep `render` a pure draw at a concrete scale.

### B35 — `listProjects` status display is fragile (newest-row-wins; fallback drops status) `[Document Review]` (bug) — minor, medium
`[ ]` Status is read from whichever group row sorts first by `updated_at`, and if the `status:data->>status` select errors the fallback query omits status so every project shows the default "active" — silently misreporting lifecycle. Fix: resolve status group-consistently and surface "unknown" rather than defaulting to active on a failed status read.

### B36 — Map/GIS minor robustness `[Site Planner / map]` (bug) — minor
`[ ]` Grouped low-severity items: (a) statewide TxGIO (Chambers) can mislabel a Harris/FB lot's `county` when the real CAD returns nothing (ties to B13 pt 1 — true point-in-county); (b) evidence-layer (OSM/Mapillary) opacity slider flattens per-feature `fillOpacity`; (c) `featureToParcel`/`largestRingLngLat` pick the largest ring by |area| ignoring winding (a big hole can win on multipart) and use a vertex-average instead of polygon centroid for the recenter/projection origin; (d) the documented multi-county straddle "merge" is unimplemented (only `hits[0]` used); (e) no `AbortController` on address search / evidence fetches → a slow response can apply after a newer action.

### B37 — Cloud/auth hardening `[Site Planner / auth]` (bug) — low/minor
`[x]` 🔧 partially fixed in audit PR. (a) **fixed:** `cloudDelete` now scopes by `user_id` AND `id` (was RLS-only). (b) **fixed:** the autosave cloud push had no `.catch`, leaving the save badge stuck on "Saving…" on a rejected upsert. (c) **fixed:** `metaRef` omitted `county`, so a save whose merge-base lacked county could normalize it to null — now self-contained. (d) **left for review:** `pullCloud` failure on login surfaces an empty library instead of an error; `testConnection` rejects valid custom Supabase domains.

### B38 — SQL/RLS & data-integrity audit (mostly clean) `[Document Review / DB]` (bug) — minor
`[ ]` A dedicated schema/RLS pass **verified the new code is sound**: both `doc_reviews` and the `sites`/storage policies are owner-scoped (all 4 verbs, `to authenticated`, no `public`/anon/admin), the bucket is private, every client storage path hardcodes uid as the leading segment (so `(storage.foldername(name))[1]` RLS can't be bypassed), both migrations are idempotent, the `(user_id,id)` PK matches every `onConflict`, and the `doc_date` empty-string→`null` boundary holds. Remaining minors: (a) **storage orphaning** — `uploadSource` uses `upsert:true` on a path derived from current project/discipline, so re-filing + re-uploading a source leaves the old object behind (key in `sources[]` is overwritten, so cleanup can't find it); fix by keying objects on the immutable `srcId` only, or deleting the prior key first. (b) `upsertReview`'s pre-migration fallback never **back-fills** the index columns for rows saved before the migration (a later normal edit self-heals that row; values always live in `data` jsonb meanwhile); the fallback regex (`/column|.../`) is also broad. (c) `setProjectStatus` writes rows back through `cloudUpsert` without `createSiteModel` normalization (lossless passthrough, but a status edit could also heal a legacy row if normalized). (`deleteReview` user-scoping — fixed in the audit PR alongside B37a.)

### B39 — PDF.js documents are never `destroy()`'d → growing memory leak across a review session `[Document Review]` (bug) — leak, high
`[ ]` `loadPdf` returns a `PDFDocumentProxy` (worker + retained ArrayBuffer); every replacement just overwrites `pdfRef.current` / `pdfs[].doc` (openFile, load, resetSingle, resetStitch, loadStitch) with no `.destroy()`, and there's no unmount cleanup. A repo-wide grep for `.destroy()` in doc-review is empty. Heavy construction sets leak MBs per open; the stitcher holds N docs at once. Fix: destroy the prior doc before replacing, destroy each removed/replaced source in the stitcher, and add an unmount effect that destroys the live doc(s). (Deferred from the audit PR only to avoid editing files a parallel agent was reading — will fix in the consolidated pass.)

### B40 — Superseded PDF render tasks are never cancelled `[Document Review]` (bug) — perf, high
`[ ]` `renderPageToCanvas` creates `page.render(...)` and only awaits its promise; `render()` discards the stale *result* via the `renderTok` token but never calls `task.cancel()`. Rapid page/zoom changes pile up overlapping renders and can hit PDF.js's "cannot use the same canvas during multiple render operations" (throw/torn output). Fix: return the `RenderTask`, keep a ref, `cancel()` before starting a new one and on unmount; treat `RenderingCancelledException` as a no-op.

### B41 — Global keydown effects have no deps array → re-subscribe on every render (hot path) `[Document Review]` (bug) — perf, high
`[ ]` DocReview.jsx and Stitcher.jsx register their `keydown` listener in an effect with no dependency array (the `}); // eslint-disable-line` pattern), so the handler is removed+re-added after *every* render — and `onPointerMove`→`setCursor` re-renders dozens of times/second while drawing. Fix: register once with `[]` and read `draft`/`sel`/handlers from refs inside `onKey`.

### B42 — `SitePlannerApp` rebuilds `siteGroups` (a Map over all sites) every render `[Site Planner]` (bug) — perf, medium
`[ ]` `const siteGroups = (() => { … })()` runs unconditionally each render, allocating a fresh array passed as the `sites` prop to `MapFinder` — O(n) per render and a referential-stability hazard that defeats child memoization. Fix: `useMemo(…, [sites, activeSiteId])`. (Safe, small — will fix in the consolidated pass.)

### B43 — `applyUser` auth-event handling has no sequence guard → races on fast auth transitions `[Site Planner / auth]` (bug) — correctness, medium
`[ ]` `applyUser` is async (`setActiveUser` → `await pullCloud` → `refreshSites`); overlapping auth events (INITIAL_SESSION→SIGNED_IN, or fast sign-out/in) can interleave so `prevUid.current`/`clearCloudCache` run out of order and clear/point at the wrong user's cache. Fix: capture a monotonic token before the await and bail stale completions (the file already uses a `live` guard elsewhere).

### B44 — Doc Review async refresh/flush lack in-flight guards `[Document Review]` (bug) — minor
`[ ]` (a) `useReviewPersistence`'s unmount cleanup unconditionally fires a cloud `upsert` on every single↔stitch mode toggle (wasteful double-write even when nothing changed) — gate on a dirty flag. (b) `ReviewsBar` re-runs `listReviews()+listProjects()` on every `signedIn` flip while open and has no in-flight guard, so a slow resolution can clobber newer state; (c) `ProjectLibrary.fileDrop` calls `refresh()` in `finally` even if the drawer closed, and overlapping refreshes can interleave. Fix: split outside-click vs fetch effects and add an `ignore`/AbortController guard; `useCallback` the refreshers.

### B45 — Stitcher keeps large PNG data URLs for every placed sheet in state `[Document Review]` (bug) — perf, medium
`[ ]` `renderPageToImage` returns `canvas.toDataURL("image/png")` at scale 2 and each placed sheet stores that multi-MB base64 string in `placed[].href`; reloads/re-binds regenerate them without releasing the old ones (data URLs can't be revoked). Fix: use `canvas.toBlob` + `URL.createObjectURL`, track and `revokeObjectURL` on remove/replace/unmount.

### B46 — `LayerPanel` Mapillary token desyncs across its two instances `[Site Planner]` (bug) — minor
`[ ]` The token is seeded once via `useState(() => mapillaryToken())` in each `LayerPanel` (map + planner both render one); typing in one doesn't update the other's local `tok`, and an externally-set token isn't reflected on reopen. Fix: lift the token to shared state (alongside `overlays`) or read from a subscribable source.
> Progress 2026-06-15: deferred from the map/GIS robustness PR — minor. Clean fix = either lift the token to shared app state (thread alongside `overlays`) or add a tiny pub/sub in `evidenceLayers.js` (`setMapillaryToken` notifies listeners; each `LayerPanel` subscribes via an effect and updates its `tok`). Left Open for that small refactor.

### B47 — ArcGIS `where`-clause hardening (LIKE wildcards + auto-detected field names) `[Site Planner]` (bug) — security, medium
`[x]` 🔧 fixed 2026-06-15 (branch `site-planner/map-gis-robustness`) — **part (b)**: the parcel-lookup `where` builder now validates `idField`/`addrField` against `/^[A-Za-z0-9_.]+$/` before interpolating, so a hostile/compromised (or user-pasted) layer's metadata can't inject a field name that escapes the `scopeWhere` county confinement. **Part (a)** — escaping `%`/`_` LIKE wildcards via an `ESCAPE` clause — is **deferred** (must verify Harris/FBCAD accept `ESCAPE` before shipping; low risk — read-only public data). A security pass found the rest of the app **clean** (Supabase queries are parameterized with no injection surface; RLS/storage policies sound; secrets handled correctly; all text/SVG render paths are React-escaped). The one item: the parcel-lookup `where` builder escapes the user *value*'s quotes (`'`→`''`, blocks the realistic breakout) but (a) does not escape LIKE wildcards `%`/`_` (a value of `%` enumerates rows — minor, public read-only data; the statewide TxGIO/Chambers layer is still confined by `scopeWhere`), and (b) interpolates `idField`/`addrField` **unescaped** — and those come from live layer metadata (or a user-pasted "Service / layer URL"), so a hostile/compromised endpoint could inject a field name that defeats the `scopeWhere` county confinement. Read-only/public so not critical. Fix: validate the detected field name against an identifier allowlist (`/^[A-Za-z0-9_.]+$/` and/or `meta.fields.some(f=>f.name===idField)`) before interpolating, and escape `%`/`_` with an `ESCAPE` clause (verify the CAD datasources accept `ESCAPE` before shipping — don't break Harris/FBCAD search).

### B48 — Client-side Anthropic key (title reader) + reusable HTML-escape helper `[Site Planner]` (bug) — note, low
`[ ]` `lib/titleReader.js` instantiates the Anthropic SDK in the browser with `dangerouslyAllowBrowser:true` and the user's own key from `localStorage` (`planarfit:anthropicKey`). This is the documented BYO-key, no-backend pattern (not a committed/bundled secret), but the key is localStorage-resident and reachable by any script on the origin. Acceptable for a personal tool; harden later by moving the call behind the planned `/server` (key stays server-side) or keeping it in memory only. Also: `printPDF`'s `esc` helper only escapes `&`/`<` (fine for its text/title contexts today) — make it also escape `"`/`>` before reusing it in any attribute/style context.

### B49 — Document Review file-input validation `[Document Review]` (bug) — crash/correctness
`[x]` 🔧 partially fixed in audit PR. (a) **fixed:** the single-sheet viewer's open/drop accepted ANY file and read the whole thing into memory via `arrayBuffer()` before failing (OOM risk on a huge/non-PDF drop) — now validated by type + non-zero size before `loadPdf`, mirroring the stitcher. (b) **left for review:** the stitcher sniffs only by `.pdf` extension, and its multi-file load loop is in a single `try`, so one bad file silently skips the rest — wrap each `loadPdf` per-file and size-check.

### B50 — Export/print & prompt robustness `[Site Planner]` (bug) — minor
`[x]` 🔧 partially fixed in audit PR. (a) **fixed:** the per-edge setback `window.prompt` treated an empty/whitespace confirm as `0` (`+""===0`) instead of cancelling — now requires a non-blank numeric. (b) **left for review:** `exportPNG` swallows raster failures (an `image.onerror` rejects with no `.catch`/feedback; `canvas.toBlob`→null silently produces no download) and `printPDF` can leave a stranded blank print window if serialization throws after `window.open` — wrap both in try/catch with a user alert (and `win.close()` on failure). `titleReader` base64-encodes with no size/type guard. (Export filename sanitization, object-URL revocation, empty-state guards, and calibration numeric guards were all audited and are clean.)

### B51 — Stitcher async handlers have no in-flight guard → re-entrant interleave corrupts placed sheets `[Document Review]` (bug) — data-loss, high
`[ ]` `openFiles`/`addSheet`/`bindSource`/`loadStitch` each `setBusy(true)…await…finally setBusy(false)` but none *reads* busy as a re-entrancy guard, and they mix functional updates (`addSheet`: `setPlaced(arr=>[...arr,…])`) with snapshot overwrites (`loadStitch`: `setPlaced(out)`). Clicking "add sheet" while a load is mid-await lets the load's blind `setPlaced(out)` clobber the just-added sheet. Fix: `busyRef` guard at the top of each, or disable the tray/open while busy; prefer functional updates / reconcile rather than overwrite.

### B52 — Doc Review load/open paths lack a cancellation token → opening B while A loads mixes the two `[Document Review]` (bug) — correctness, high
`[ ]` `loadStitch` (Stitcher) and `openReview`→`loadSingleReview`→`fetchSourceBytes` (DocReview) run long await chains (download + loadPdf + render) and then unconditionally `setState` (reviewId, meta, markups, pdfRef, placed) with no "is this still the requested review?" check. Open review A then B quickly and A's late resolution overwrites B's PDF/sheets while ids/markups are B's — and the autosave then persists the mix under the wrong id. Fix: capture a token (the requested `rec.id`) in a ref and bail before each post-await `setState` if superseded (mirror the single-sheet `renderTok` pattern). Related to B19.

### B53 — In-planner `identifyAt` lacks a token → second click shows/adds the wrong parcel `[Site Planner]` (bug) — correctness, medium
`[x]` 🔧 fixed 2026-06-15 (branch `site-planner/map-gis-robustness`): `identifyAt` captures an `identifyTok` at call start and bails before `setIdentifyRes` if a newer click superseded it (matches the single-sheet `renderTok` pattern). `identifyAt` (SitePlanner) sets `{busy:true}`, awaits `resolveLayerUrl`/`queryAtPoint`, then unconditionally `setIdentifyRes({attrs,ring,…})`. Clicking P2 before P1 resolves lets P1 overwrite P2's result, so the panel/`addIdentifiedParcel` use the wrong lot. (Distinct code path from the already-logged MapFinder `handleClick` race, B22.) Fix: a token captured at call start, checked before the post-await `setState`.

### B54 — `pullCloud` overwrites the per-user cache with `{}` when a cloud fetch errors `[Site Planner]` (bug) — data-loss-shaped, medium
`[ ]` `cloudList` returns `[]` on *error* (cloudSync.js), so `pullCloud` can't tell "no sites" from "fetch failed" and blind-writes an empty map to the per-user cache; signing in while offline/unreachable thus shows "no sites" and wipes the local cloud cache to empty (data safe in Supabase, but a scary empty state that the user might start recreating into). Fix: have `cloudList` throw/return a status on error; `pullCloud` must skip the cache overwrite on error and surface a "couldn't load" state. (Sharpens B18/B37d into a concrete fix.)

### B55 — Fire-and-forget promises without `.catch` → unhandled rejections; async continuations touch torn-down objects `[Document Review / Site Planner]` (bug) — minor
`[ ]` `uploadSource(...).then(...)` (DocReview + Stitcher), the `usePersistence` unmount/visibility `flush()` cloud upsert, and the `probeService(...).then(...)` overlay continuation all lack `.catch`, so a rejected Storage/DB/network call is an unhandled rejection. The `probeService` continuation also does `lyr.addTo(map)` after the await with no map-teardown guard (can throw if the map was removed mid-probe). Fix: add `.catch(()=>{})` to the fire-and-forget calls (matching the `pushSiteToCloud(...).catch` convention) and guard `addTo` with `map._loaded`.

### B56 — Assorted async UX/robustness `[Site Planner / Document Review]` (bug) — minor
`[ ]` Grouped: (a) `goAddress` double-submit — Enter isn't gated by `busy` (only the Go button is), so two geocodes can race the `flyTo`; (b) transient `overlapWarn` messages each schedule their own `setTimeout(()=>setOverlapWarn(""))` with the id discarded, so a stale clear blanks a newer warning (and `runXSection` has no in-flight guard); (c) `setProjectStatus` upserts group rows serially and ignores per-row failure, returning `ok:true` even if one plan kept the old status (inconsistent group status) — use `Promise.allSettled` and report partial failure; (d) the evidence layers drop `moveend` events that arrive while a fetch is in flight (no trailing-edge refresh), so the last view may never load; (e) the doc-review mutation handlers (`del`/`onStatus`/`fileDrop`) call `refresh()` after an await with no open/mounted guard.

### B57 — Coordinate/units consistency (core verified clean) `[Site Planner]` (bug) — low
`[ ]` A dedicated units/coordinate audit **verified the core is sound** — `FT_PER_DEG` usage (365223 lat, `×cos(lat)` lon), lat/lng argument order at every call boundary, the aerial aspect/`ftPerPxY` stretch, `ppfToZoom` Mercator inversion, the doc-review takeoff unit-squaring (px²→ft²), metes-and-bounds az/quadrant math, and the north-up Y-flip are all correct, and the 365223 equirectangular model is a true-ground ~0.3% approximation (not Mercator inflation). Three low-severity items: (a) the underlay **Calibrate** applies a single diagonal-derived scalar to both axes, so it mis-sizes a divergent-axis *from-map* underlay (disable Calibrate when `underlay.fromMap`, or derive per-axis factors); (b) `FT_PER_M = 1/0.3048` is the **international** foot while the CRS is labeled `us-ft`/EPSG:2278 (~2 ppm, cosmetic); (c) address-search ingests true EPSG:2278 feet while map-click/identify use the 365223 equirectangular feet (~0.3% diff for the same lot) — unify the ingestion paths to prevent future drift.

### B58 — Ditch cross-section drops no-data DEM samples without preserving position → wrong pond depth `[Site Planner]` (bug) — correctness, high
`[ ]` `sampleProfile` (elevation.js) does `.filter(v=>isFinite(v))`, discarding position; `ditchStats` then assumes uniform spacing (`d = i/(n-1)*lenFt`) and takes `bankFt = (elevFt[0]+elevFt[n-1])/2`. 3DEP commonly returns no-data over water/low ground, so surviving samples aren't evenly spaced — the profile x-axis is distorted, and if the true endpoints were no-data the "bank" is taken from interior points, so `depthFt` (the headline number applied to the pond's available depth) is wrong. (Distinct from the B23 1-sample NaN.) Fix: map each sample to its fractional position BEFORE filtering; treat leading/trailing no-data as missing banks rather than substituting interior points.

### B59 — Parking render/count/panel ignore per-element `cfg` → "Drive aisle on the far side" toggle is inert `[Site Planner]` (bug) — correctness, high
`[ ]` The renderer, metrics, and panel all call `carStalls(el.w, el.h, settings)` with the GLOBAL settings, never `cfgOf(el)`, so a parking field's per-element `cfg` (notably `flipDepth`, and side-parking strips created with `cfg`) has no visual/count effect — the panel's "Drive aisle on the far side" checkbox writes `cfg.flipDepth` but nothing reads it for drawing. Trailer rendering correctly uses `el.cfg`, so it's an inconsistency. Fix: use `cfgOf(el)` (which merges `{...settings, ...el.cfg}`) in the three `carStalls(...)` call sites.

### B60 — Detention bottom area spuriously non-zero when the basin over-tapers `[Site Planner]` (bug) — correctness, medium
`[ ]` `detentionStorage`'s `areaAt(down)` returns `offsetPolygon(ring, slope*down)` area; when `slope*depth` exceeds the footprint's inradius, `offsetPolygon` yields an inverted (flipped) ring rather than null, and the self-check uses `polyArea` (abs value), so a bogus positive "bottom" passes. Result: overestimated prismoidal volume and the "Basin tapers to a point — reduce depth/slope" guard (`aBottom===0`) never fires. Fix: detect collapse via a signed-area sign flip (or offset distance ≥ inradius) and return 0.

### B61 — Two-click road drawn shorter than it is wide mis-assigns the length/cross axis `[Site Planner]` (bug) — minor
`[ ]` Road creation sets `w:len, h:roadWidth+2*curb`, but downstream infers the cross axis from `min(w,h)` (curb render `el.w>=el.h`; `roadTravel` `min`; resize `el.h<=el.w`). A stubby road (`len < cross`) has `w<h`, so curbs draw on the wrong edges and the length/width fields control the swapped axis. Fix: tag an explicit length axis at creation and key rendering/resize off it (or clamp `len>=cross`).

### B62 — Utility-route corridor leaves a visible gap to the fitting pad `[Site Planner]` (bug) — minor, cosmetic
`[ ]` `buildUtilRoute` buffers `pts=[source, entry]` where `entry` is on the wall, but the pad sits outside the wall (`entry + normal*(padSize/2+3)`), so the drawn corridor never reaches the pad. Fix: include the pad center in the route (`pts=[source, entry, padC]`) before buffering. (Math/easement-width/overlap checks are otherwise correct.)

<!-- Filed 2026-06-15 from a parallel chat's backlog (its provisional B13–B16 were reassigned here; B1–B12 + protocol deduped against existing items, which already shipped). -->

### B63 — Parallel-session merge safety: branch → PR → green-build gate `[repo / workflow]` (task)
`[ ]` Guardrail so two concurrent Claude Code sessions can't silently break `main`. git already catches *same-line* collisions (it refuses — the safe, loud case); the real risk is two sessions editing *different but interdependent* files → clean merge, broken app, which only re-building the **combined** result catches. **Active practice (already followed; make it explicit in CLAUDE.md):** each session works on its own branch, never commits to `main`; finishes via a PR; before merge, restacks on the latest `main` and re-runs the build, merging only if green; one PR per backlog item where practical. The *enforced* GitHub branch-protection half is parked under 🕓 Later (needs a paid plan on this private repo + a one-time owner toggle).

### B64 — Clicking into a site is unreliable / won't register `[Site Planner / map]` (bug) `[?]`
`[ ]` Intermittently, clicking a saved site on the map to open it does nothing — the click never registers and you can't get into the planner. Repro and fix the click/hit handling so opening a site is reliable every time. `[?]` confirm whether this is clicking a *saved-site marker to enter the planner* vs. a *parcel to select*; likely shares a root cause with the already-logged click races (B22 parcel-click race) — check marker hit-area / overlapping panes / the select-mode guard. Needs a runtime repro to fix confidently.

### B65 — White flashing on zoom/pan and general redraw `[Site Planner / map]` (bug)
`[ ]` With a site loaded, zooming/panning flashes white repeatedly — the view appears to clear to white between redraws instead of holding the previous frame (frequent, not one-off). Make the render path retain the prior frame / paint onto a stable backdrop. Likely suspects: the Leaflet basemap/aerial tile layer, or the SVG/canvas re-rasterizing the imported backdrop on every interaction. Perceived-quality but very visible. Needs a runtime repro.

### B66 — Top-left Site Planyr dropdown renders behind the lower header row `[global UI]` (bug)
`[ ]` Clicking the top-left module control opens its dropdown *behind* the second header row (a z-index/stacking problem), so it can't be used. Quick fix: raise the menu's z-index above the lower bar. NOTE: B10 (header consolidation → product-switcher) shipped but deliberately left the shell bar and planner context bar as **two physical rows**, so this stacking bug likely persists — verify against the current header and fix the z-index.

---

## 🕓 Later / Roadmap

*Deliberately deferred. Do **not** action these unless moved up to 🔲 Open.*

- **Enforced merge gate via GitHub branch protection** (the settings half of **B63**): require a PR + a passing build check + "branch up to date before merging" on `main`, plus repo auto-merge. On the **private** repo this only *enforces* on a paid plan (GitHub Pro+); on Free the rules save but don't block — so B63's branch → PR → green discipline is the backstop until then. Keep it a manual owner toggle rather than granting the Claude Code app admin rights on a credential-bound repo.

---

## ✅ Done

### B1 — Sign-up form: missing fields `[auth]` (bug)
`[x]` Sign-up must collect **First name**, **Last name**, and **Organization/Company**. These fields are currently absent.
> Done 2026-06-14 (PR #10). First/Last/Organization added to the sign-up form, stored in Supabase `user_metadata` via `signUp` `options.data`; the signed-in account view now greets by name + org.

### B2 — Account control: placement & styling `[global UI]` (bug)
`[x]` Move the sign-in / sign-out control to the **top-right** (standard web-app convention) and clean up its styling. Current placement and formatting are rough.
> Done 2026-06-14 (PR #10). Account control moved to the shell header (top-right, global across workspaces) and restyled as an avatar+name pill; the old bottom-right pill was removed and the auth modal now lives in the shell.

### B3 — Brand spelling: global `[global]` (bug)
`[x]` Product name is **Planyr**. Replace both wrong spellings everywhere they appear: "Planar" (a-r) and "Planner" (normal spelling). Includes the module label: **"Site Planner" → "Site Planyr."**
> Done 2026-06-14 (rename PR #7 + PR #10 + PR #11). All user-facing brand marks are now "Planyr" / "Site Planyr": shell brand, module tab, map + planner headers, export/print labels, export-error text, and the tax label ("Combined rate" → "total tax rate"). The last stray "Site Planner" (Document Review help text) was fixed in PR #11. **Exception:** the browser-tab title keeps "Industrial Site Planner" as a descriptive tagline, per the owner's call (see "item two" decision, 2026-06-14). Internal identifiers, folder/file paths, and the `planarfit:*` localStorage cache keys are intentionally unchanged (not user-facing; renaming the cache keys would orphan saved data).

### B4 — Parcel selection doesn't reset on return to map `[Site Planner]` (bug)
`[x]` Repro: select parcels → "plan these N parcels" → work in the planner → back out to map. Currently the parcels stay selected and the map is still in select-parcels mode. Expected: returning to the map **clears the committed parcels** and **exits select-parcels mode** back to the normal map state.
> Done 2026-06-14 (PR #10). MapFinder now clears highlights/selection and exits select-parcels mode via an effect that fires whenever the map becomes visible again.

### B5 — Multi-select + merge parcels `[Site Planner]` (feature)
`[x]`
- **Shift+click multi-select** (Bluebeam-style): click a parcel, hold Shift, click others to add to the selection; Shift+clicking a selected parcel de-selects it (toggle).
- With multiple selected, two ways to merge into one: (a) right-click → **"Merge parcels"** context menu, and (b) a **"Merge parcels"** button in the right-hand parcel tool panel.
- **Terminology locked to "Merge"** — remove any "Combine/Combined" labels project-wide.
- This is a *working* merge on the editable layer (geometry for test-fit/yield), **not** a recorded legal consolidation. Button copy must not imply a county filing.
> Done 2026-06-14 (PR #10). Shift-click toggles multi-select in the Select tool; merge via a right-click context menu and a "Merge parcels" button in the parcel panel; the old Combine tool was removed and all user-facing labels say "Merge". Copy states it's a working merge for test-fit, not a recorded consolidation. (Residual non-user-facing leftovers: an unused `combine` icon-glyph key and two code comments — cosmetic, no user impact.)

### B6 — Auto-parking returns wrong dimension after sidewalk resize + delete `[Site Planner]` (bug)
`[x]` Repro: place building → add 30-ft sidewalk → parking within sidewalk → expand sidewalk to 30 ft → delete parking → click "add parking" → tool produced a ~135-ft parking field. Expected: "add parking" drops a **fixed-depth** field every time, regardless of surrounding geometry. Fixed depth is the spec, so the bug is that **something overrides the depth constant with a measured value**. Trace where the parking field's depth is assigned; confirm it can't be contaminated by adjacent or just-deleted geometry (the resized sidewalk and the gap left by the deleted parking are prime suspects).
> Done 2026-06-14 (PR #10). `addParkingRowSide` now offsets by the sidewalk's true *thickness* (`swThick`, which resolves the correct axis) instead of a raw `w`/`h` read that could pick up the sidewalk's *run* (~wall length); the row depth stays the fixed `stallDepth + aisle` constant and can't be contaminated by adjacent or just-deleted geometry.

### B7 — Project lifecycle status on map markers `[Site Planner / map]` (feature)
`[x]` Right-click a project marker to set its status. Lifecycle: **Pursuit → Active → On Hold → Complete → Dead** (see B8 for the full state set and visuals). Core of this item:
- Right-click marker → menu of states, current one checked. Mirror the same control in the project detail panel if one exists.
- **Status is a real field** on the project record in Supabase — persists across devices, stays private per the existing row-level security (each user sees only their own).
- **New projects default to Pursuit.**
- Companion features: **filter by status** (toggle each state on/off — "hide Complete" and "hide Dead" will be the common ones), a **legend**, and **pipeline counts** (e.g., "4 Pursuit · 6 Active · 2 On Hold · 11 Complete · 5 Dead").
> Done 2026-06-14 (this PR — B7–B12 batch). `status` added to the Site Model (`SITE_MODEL_VERSION` 2→3; new sites default to "pursuit"; pre-feature records migrate to "active"), exposed via a `statusOf` selector with ordered `STATUSES` + `STATUS_META`. It persists inside the model `data` — i.e. the `sites.data` jsonb in Supabase, so it syncs across devices and stays private under the existing RLS, with **no DB migration / no dedicated column**. Set a site's status by right-clicking its map marker **or** a saved-sites list row (current state checked); applied to the whole site group. Companion legend + per-state show/hide filters + live pipeline counts live in the saved-sites panel.

### B8 — Lifecycle states & marker visuals `[Site Planner / map]` (feature)
`[x]` The five states and how each marker reads. Use two redundant cues — **color + shape/glyph** — so status stays legible for colorblind users and on a busy basemap:
- **Pursuit** — amber, dashed ring (tentative, uncommitted).
- **Active** — green, solid (the live work; should grab the eye).
- **On Hold** — slate/indigo blue, solid ring, pause "‖" glyph (alive but paused; revivable). Lean slate/indigo rather than sky-blue so it doesn't vanish over blue water on the basemap.
- **Complete** — gray, muted, small check ✓ (done; recedes).
- **Dead** — hollow gray, dimmest, faint ✕, no fill (didn't proceed; kept for the record). **Not red** — red reads as urgent/alert; a dead deal is inert.
- Live (green) should pop; both Complete and Dead recede into the background, with shape/glyph telling them apart.
> Done 2026-06-14 (this PR — B7–B12 batch). Markers carry two redundant cues exactly per spec: Pursuit amber/dashed-ring, Active green/solid (pops), On Hold slate-indigo/pause-‖, Complete gray/muted-check-✓ (recedes), Dead hollow-gray/faint-✕/no-fill (recedes; not red). Glyph distinguishes Complete from Dead.

### B9 — Wire this backlog into CLAUDE.md `[repo / workflow]` (task)
`[x]` Add a line to the repo's `CLAUDE.md` telling future runs to check `BACKLOG.md` on every run — work the **🔲 Open** section, skip **✅ Done**. This closes the loop so the backlog is consulted automatically, without anyone having to point at it each time.
> Done 2026-06-14 (PR #11). `CLAUDE.md` opens with a callout pointing every run at `BACKLOG.md` (work 🔲 Open, skip ✅ Done), disambiguated from the ops "Deferred / maintenance backlog" section near the end of that file.

### B10 — Consolidate the two header rows into one bar with a module switcher `[global UI]` (feature)
`[x]` The Site Planner currently stacks **two** header rows that repeat information: row 1 is `Planyr | Site Planner | Document Review` (top-level module tabs); row 2 is `‹ Map | Site Planyr | Houston ColdPort ▾ › Plan 1 ▾ | undo/redo | Snap 10' | Saved ✓ | File ▾`. The brand and the active module name both appear twice.
- **Collapse to a single top bar.** Switch modules via a **product-switcher dropdown** — the standard multi-product pattern (think Atlassian/Google Workspace): brand logo + current module name on the far left with a chevron; clicking it reveals the other modules (Site Planner, Document Review, and later Project Scheduling, Cost Estimating). This replaces the row of flat tabs.
- **Recommended one-row layout:** `[▾ Planyr · Site Planyr]  ‹ Map › Houston ColdPort ▾ › Plan 1 ▾   ·   [undo] [redo] [fit] · Snap 10' · Saved/Cloud ✓ · [account] · File ▾`. (Map → Project → Plan reads as a breadcrumb — the trail showing where you are in the hierarchy.)
- Honor **B3** spelling here: row 1 still shows the old "Site Planner" — the rebuilt bar must use **Planyr / Site Planyr**.
- Removing the county selector (see **B11**) frees additional header space, reinforcing this consolidation.
> Done 2026-06-14 (this PR — B7–B12 batch). The shell's flat module tabs are now a **product-switcher dropdown** (brand + current module + chevron → menu built from the `WORKSPACES` registry, active one marked); the duplicated brand/module mark was removed from the planner header so brand/module appears exactly once. Global account control unchanged. Note: the shell bar and the planner context bar remain two physical rows — the dedup + switcher are the substance of B10; a single physical row is a later polish.

### B11 — Remove the county pre-selection gate; click anywhere, auto-resolve the county `[Site Planner / map]` (feature)
`[x]` Today the user must pick a county (e.g., Harris vs. Fort Bend) *before* clicking a parcel. Remove that gate — the user should be able to pan/click **anywhere** and select any parcel without choosing a county first; the unnecessary upfront choice just adds friction.
- Parcel geometry is published per **county appraisal district (CAD)** — the county agency that maintains the parcel map and ownership data (Harris County Appraisal District, Fort Bend Central Appraisal District, etc.). So "click anywhere" means the backend must **resolve which county the clicked point falls in** (point-in-county lookup) and route the parcel query to that county's CAD service automatically.
- Handle the **county-boundary case** gracefully (a click near a line, or a multi-parcel selection that straddles two counties → query both services and merge results).
- This also removes the county dropdown from the header, feeding **B10**.
> Done 2026-06-14 (this PR — B7–B12 batch). County gate removed. The map resolves every configured CAD county's parcel layer up front; a click is auto-routed via `candidateCountiesForPoint` (coarse per-county bbox pre-filter, padded so borders overlap → a straddle click queries both) + `identifyParcelAcross` (parallel point-identify across candidates, first hit wins, a down county is skipped not fatal, no match fails gracefully — no parcel, no crash). The selected parcel's resolved county rides into the planner hand-off so the saved site still records its county. The county dropdown is gone from the map header. **Interim:** the Layers panel defaults to the Harris/Houston jurisdiction (same as the prior app default) so the Houston utility overlays stay available with no county picked — per-area jurisdiction resolution is a future refinement.

### B12 — Rename the "start / import" entry point to describe what it does `[Site Planner]` (task)
`[x]` There's a control (current label rendered to me as "skip-point" — **needs confirmation of exact label/location**) that is the on-ramp where you **bring in a survey or a site and start editing** — i.e., drop a surveyed drawing or pick a site and begin a new working session on the editable layer above it. The current wording doesn't communicate that.
- **Goal:** rename it to plainly describe the action. Candidates, depending on exactly what it does: **"New Site,"** **"Start New,"** **"Import & Edit,"** **"Drop a Survey,"** or **"New Plan."** If it's specifically the *alternative* to selecting existing parcels (start from a survey/blank instead), **"Start Blank"** or **"Start from Survey"** fit.
- **`[?]` resolved:** the control was confirmed to be the map's **"Skip — blank canvas"** button, which opens an empty (un-located) planner — it does NOT import a survey today.
> Done 2026-06-14 (this PR — B7–B12 batch). Relabeled the "Skip — blank canvas" button to **"Start blank"** with a tooltip ("Start a new blank plan without selecting parcels"). Behavior unchanged (opens an empty planner; no survey-import was added — that would be a separate, larger item if wanted).

### B14 — Document Review project library: link reviews/files to Projects + browseable folders `[Document Review]` (feature)
`[x]` Link saved Document Review reviews/files to the existing **Project/Site** records (the entity that anchors Site Planner plans, e.g. "Houston ColdPort") and give them a browseable folder structure. Browser-only + existing Supabase.
- **Lifecycle status** reused from the Site Model (pursuit/active/onhold/complete/dead — already shipped in B7/B8); files stay attached regardless of status.
- Each review/file carries a **project link, discipline** (Survey / Civil / Architectural / Landscape / Environmental / CAD / Geotech / Other), **item/type, revision, and date**; the name defaults to **"\<Project\> - \<Item\> - YYYY.MM.DD"** (each piece editable).
- **Storage** organized as `<uid>/project-<id>/<discipline>/<file>` (uid first so the existing private-per-user RLS is unchanged).
- **File-explorer drawer:** project (+ status badge, editable) → discipline folder → files newest-first → click to open in the viewer/stitcher; **drag-drop** a PDF onto a project or discipline to file it.
> Done 2026-06-15 (PR #15, branch `doc-review/project-library`). New `doc_reviews` index columns (`project_id`/`item`/`revision`/`doc_date`) + a `ProjectLibrary` drawer + a project/discipline filing UI in the Reviews menu, all in the doc-review workspace. Projects + their lifecycle status are read from (and written back to) the Site Planner `sites` — one source of truth, no parallel store. Status is NOT re-added (it already exists per B7/B8). Migration `src/workspaces/doc-review/db/project_library.sql`. `upsertReview`/`listReviews` fall back to the core columns if that migration hasn't run yet, so saving never regresses.
