# PERSISTENCE.md — the canonical save/sync write-path map (B639)

> **Part of the Persistence & Sync epic (B639).** This is the single place that answers "what writes
> user data, when, and what protects it from loss." It was built **AUDIT-FIRST** — every row and finding
> below was read out of the **current code** (not comments or backlog notes), and where a comment or a
> prior `B#` claim disagreed with the code, the **code reality is recorded and the discrepancy flagged**.
>
> **Generated 2026-07-04** by a parallel per-write-path code audit. It is a hand-maintained doc, not a
> generated file — when you change a write path, update its row + the affected invariant finding here in
> the same commit, and (per the epic's triage rule) **every new save/sync bug must name the invariant it
> violates**; if none fits, the invariant list is incomplete → amend it here first, then file the bug as a
> member of B639.
>
> Related: `docs/REFERENCE.md` (persistence internals), `PERSISTENCE_TEST_SCRIPT.md` (manual live script),
> `docs/test-data-loss.md`. Members of B639: B124, B125, B126, B134, B276, B314, B595, B596, B612.

---

## The invariants (every write path must satisfy these)

- **I1 — Tombstone the full cascade before the next flush.** Every deletion records tombstones for its
  entire cascade set (the item **and** its bonded children) *before* the write that removes it lands, so a
  later merge/pull/sync can't resurrect it (or raise a false "changed in another session" conflict).
- **I2 — Refresh the version token from the last write you observed.** Every writer reads its
  optimistic-concurrency token (the Supabase `version` column / the Gantt `__rev`) from the most recent
  successful write it actually saw land (or a fresh fetch) — never a stale in-memory guess.
- **I3 — No write may silently no-op.** A write that is blocked, rejected, or skipped must be observable
  (a status change, telemetry, or a thrown error) — never a swallowed result that reads as success.
- **I4 — Every failure surfaces visibly (LOUD-FAILURE).** A write that fails raises a user-visible signal
  (banner/badge) and/or telemetry — never a quiet degrade that looks like a save.

## Compliance matrix (audited 2026-07-04)

Legend: ✅ satisfied · ⚠️ partial / by-design gap · ❌ violated on this path. Detail per path below.

| Write path | I1 tombstone | I2 version token | I3 no silent no-op | I4 loud failure |
|---|---|---|---|---|
| Site Planner debounced autosave | ✅ | ✅ | ✅ | ✅ (sibling parcelDrawings push ⚠️) |
| pullCloud / cloud reconcile re-push | ⚠️ (whole-site) | ✅ | ❌ (`.catch(()=>{})`) | ❌ (heal re-push swallowed) |
| persistDrawings + raster IndexedDB stash | ⚠️ (non-atomic) | ✅ | ❌ | ❌ |
| beforeunload / visibility / forced-reload flush | ⚠️ | ✅ (keepalive by-design) | ❌ (keepalive budget) | ❌ (unmounting) |
| Schedule-module save (Gantt `hs-v1`) | n/a (whole-blob) | ✅ (non-atomic SELECT) | ⚠️ (skipSanity backups) | ✅ (skipSanity ⚠️) |
| useReviewPersistence (Doc Review autosave) | n/a (whole-blob) | ✅ (list gap) | ⚠️ (unload flush) | ✅ (unload flush ⚠️) |
| Tombstones + mergeSiteContent cascade | ✅ | ✅ (cloud) | ✅ | ✅ |
| Optimistic concurrency / version token + editor lock | ✅ (Site only) | ✅ | ⚠️ (keepalive) | ✅ |

## The write-path table

| # | Write path | Trigger | Debounce window | Version-token source | Tombstone awareness |
|---|---|---|---|---|---|
| 1 | **Site Planner debounced autosave** — `SitePlanner.jsx` autosave effect → `storage.js` `saveSite` → `cloudSync.js` `cloudUpsert` | React effect on any canvas-state edit (`parcels, els, measures, callouts, markups, settings, underlay, sheetOverlays, deletedIds`). `parcelDrawings` is deliberately OFF this effect (path #3). | Two-stage: **~50 ms** coalesced on-device mirror (the reload-safety net, B458) + **400 ms** cloud settle-tick. | Per-tab `siteVersions[id]` (`cloudSync.js`), = Supabase `sites.version`; advanced to `r.version` on each CAS success; `serializeSiteWrite` makes a queued write read the threaded-back token. | Full per-item cascade: `tombstone()` → `deletedIds`, in the save payload + effect deps, so a delete + its bonded children flush in the same cycle. |
| 2 | **pullCloud / cloud reconcile re-push** — `storage.js` `pullCloud` → `mergePulledSites` → `cloudUpsert` heal loop | Sign-in/`applyUser`, window focus/visibility regain, manual refresh, after a sharing change, project-cache warm. | **none / immediate** — synchronous fire-and-forget re-push loop right after the local cache write. (Per-id `serializeSiteWrite` queues, does not debounce.) | `siteVersions[id]` re-seeded by the `cloudList` at the top of the same `pullCloud`, so the re-push reads a just-fetched token. | Partial: honours item-level `deletedIds` via `mergeSiteContent`; **whole-site** deletion has no persisted tombstone (in-memory `recentlyDeleted` only). |
| 3 | **persistDrawings + raster IndexedDB stash** — `SitePlanner.jsx` `persistDrawings` → `saveSite` merge; `idbPut('raster:…')` | Any parcel-drawing mutation (attach/markup/delete/source). Raster `idbPut` fires alongside on rasterize. | Local `saveSite`: **immediate**. Cloud push: **800 ms** debounce. Raster `idbPut`: immediate fire-and-forget. | Local `lastSeenAt[id]` cross-tab fold; cloud `siteVersions[id]` via `pushSiteToCloud`→`loadSite`→`cloudUpsert`. Raster stash: none (content-keyed). | Delete tombstones via `deletedIds` on the **main** autosave, but the drawing-row removal flushes on **this** path first → non-atomic (see I1 finding). |
| 4 | **beforeunload / visibility / forced-reload flush** — `flushRegistry.js` `flushAll`; native `beforeunload`/`visibilitychange` → `flush()` | Tab hide/close (native listeners on each editor) and `chunkReload.js` forced reload (`flushAll` before `location.replace`). | **none / immediate** — the whole point is to beat the 400 ms / 600 ms autosave debounce. | Site `siteVersions[id]` / Review `reviewVersions[id]`; the keepalive branch (`keepaliveCasPush`) is fire-and-forget and by design can't advance its token from an unobserved write (boot re-reads it). | Carries `deletedIds` in the payload; `recentlyDeleted` blocks whole-plan resurrection. Full cascade not guaranteed (see I1). Review path: n/a. |
| 5 | **Schedule-module save (embedded Gantt `hs-v1`)** — `public/sequence/index.html` `attemptCloudSave` → `window.storage.set('hs-v1', …)`; `saveState.js` re-skins the badge | Every committed `data` change (the `[data]` effect). Plus fire-and-forget `skipSanity` backups before destructive ops; 20 s auto-retry on error. | **none / immediate** — undebounced cloud upsert on every change. (The 700 ms `fileSaveTimer` debounces only the optional local HTML-file mirror.) | Integer `__rev` embedded in the `hs-v1` JSON; each write re-reads the live cloud `__rev` (SELECT), stamps `cloudRev+1`, refreshes `knownRev` on success. **Non-atomic** read-then-write (TOCTOU) — no DB precondition. | n/a — whole-document blob; absence == deletion, so no separate tombstone ledger. |
| 6 | **useReviewPersistence (Doc Review autosave)** — `usePersistence.js` → `reviewStore.js` `upsertReview` | Any review edit (debounced); manual `saveNow`; unmount/hide flush; forced-reload keepalive. | Cloud write **600 ms** (`DEBOUNCE_MS`); local mirror immediate; flushes immediate. | Per-review `reviewVersions[id]` (`reviewStore.js`) = Supabase `version`; seeded by `loadReview`, advanced on CAS success; `serializeReviewWrite` prevents self-race. (`listReviews` does **not** select `version` — see discrepancy.) | n/a — whole-review jsonb snapshot (last-write-wins on the row via CAS); a deleted markup is simply absent. Review-**level** delete (`deleteReview`) is a separate path, uses orphan counters not tombstones. |
| 7 | **Tombstones + mergeSiteContent cascade** — `siteModel.js` `mergeSiteContent`; delete handlers in `SitePlanner.jsx` | A deliberate delete (`tombstone(ids)` from every wired delete handler). `mergeSiteContent` runs on cross-tab fold, boot pull, storage-event merge, take-over reconcile. | Local mirror immediate (~50 ms); cloud settle-tick 400 ms; per-id serialized. | Cloud writer only: `siteVersions[id]` + content baselines `siteContent`/`siteTombs` (thin-clobber guard, B459). Local `saveSite` has no token (last-write-wins + `lastSeenAt` + `recentlyDeleted`). | **This is the tombstone path.** `deletedIds` (capped 5000, deduped); `mergeSiteContent` unions and filters every id-bearing collection so a deleted item can't be resurrected. |
| 8 | **Optimistic concurrency / version token + editor lock** — `optimisticUpsert.js` `casUpsert`, `serializeWrites.js`, `presence/editorLock.js`, `multiTab.js` | Any Site Model / review write routes through `casUpsert`. The editor lock **gates** (not writes): a read-only/conflict tab suppresses the cloud push while the local mirror still saves. | CAS push 400 ms (site) / 600 ms (review); keepalive immediate; serializer adds no delay (queues same-id writes). | `siteVersions{}` / `reviewVersions{}` = Supabase `version`; conditional `UPDATE …eq('version',expected)` writing `version=expected+1`; 0-row match ⇒ conflict. | Site Planner: full cascade via `deletedIds` (I1 ✅). Doc Review: **no tombstone mechanism** — markup delete is blob last-write-wins protected only by the version number. |

---

## Per-path invariant findings (the AUDIT-FIRST detail)

### 1. Site Planner debounced autosave — ✅✅✅✅ (one sibling gap)
- **I1 ✅** — every drawn-collection delete routes through `tombstone()`→`deletedIds`; a building delete cascades to its bonded children (dog-ears/sidewalks/parking) in the **same** `tombstone()` call; `deletedIds` is an effect dep so tombstones land in the same `saveSite` payload as the removal.
- **I2 ✅** — `cloudUpsert` advances `siteVersions[id]=r.version` on success; `serializeSiteWrite` (B529) makes a queued autosave/flush wait so it reads the version the prior write threaded back (stops a tab racing *itself* into a false conflict).
- **I3 ✅** — the local mirror is **read-back verified** (every just-written id present **and** count) → a silent non-persist goes LOUD (`setLocalSaveFailed` + `save-verify-failed` telemetry). Blank-site early return still saves tombstone-only edits.
- **I4 ✅ / ⚠️ sibling** — local fail → red at-risk banner; cloud fail → 6 s watchdog banner; CAS conflict / thin-clobber → loud reload banner; device-full-but-cloud-ok → amber "saved to your account". **Gap:** the separate `parcelDrawings` push and several App-level one-shot `pushSiteToCloud(id).catch(()=>{})` calls swallow failures with no banner.

### 2. pullCloud / cloud reconcile re-push — ⚠️❌ (the loudest gap in the system)
- **I1 ⚠️** — honours item-level `deletedIds`, but whole-**site** deletion has no persisted tombstone (per-tab, reload-cleared `recentlyDeleted` only), so the re-push can resurrect a not-tombstoned whole-site delete once, cross-tab/device.
- **I2 ✅** — `cloudList` at the top of `pullCloud` re-seeds `siteVersions[id]` from each fetched row, so the re-push reads a fresh token.
- **I3 ❌ / I4 ❌ — the real finding:** the heal re-push loop discards every result via **`.catch(()=>{})`** (`storage.js:122`). A `{conflict:true}` / `{thinned:true}` / failure during a re-push is invisible to the user — the "loud reload-before-saving prompt" the `optimisticUpsert` contract promises **never fires on this path** (only interactive save paths surface it). `cloudUpsertCore` does emit `reportClientEvent` telemetry on conflict/thin/fail, but `keepaliveCloudPush`'s own thin-clobber check returns `false` with **no** telemetry — a genuinely silent no-op.

### 3. persistDrawings + raster IndexedDB stash — ⚠️❌❌ (silent parallel writer)
- **I1 ⚠️ (non-atomic)** — `deleteDrawing`'s immediate `persistDrawings`→`saveSite` flushes the drawing **removal without the tombstone**; the `deletedIds` tombstone lands only on the later main-autosave flush, and the 800 ms drawings cloud push never carries `deletedIds`. Single-id cascade (no children) so nothing is missed, but the *ordering* invariant is not met.
- **I3 ❌ / I4 ❌** — `persistDrawings` **discards** `saveSite`'s success boolean (no read-back, no banner) and the cloud push is `pushSiteToCloud(id).catch(()=>{})`. This parallel writer sidesteps the entire B458/B473/B592 verify-and-go-loud machinery the main autosave uses. (The rehydrate side *is* partly loud: `underlayLost` / "image not on this device" placeholder.)

### 4. beforeunload / visibility / forced-reload flush — ⚠️❌❌ (by design, backstopped by boot merge)
- **I2 ✅ (by design)** — the native path advances tokens normally; the keepalive branch is fire-and-forget and *cannot* read its response ("the page is leaving"), so it never advances a token from an unobserved write — the next boot re-reads `version` from cloud and reconciles.
- **I3 ❌ / I4 ❌** — multiple intentional silent no-op branches: `keepaliveCasPush` returns `false` when `expected==null` (a **never-yet-synced** row's forced-reload push is silently skipped), or when the payload exceeds the browser **~64 KB keepalive budget**; the native cloud write swallows failure (`.catch(()=>{})`); `flushAll` swallows every flusher error. The synchronous local save here does **not** run the B473 read-back verify. Loudness relies on a prior autosave already having surfaced + next-load boot recovery — acceptable only because the page is navigating away and the local mirror covers recovery.

### 5. Schedule-module save (Gantt `hs-v1`) — n/a ✅ ⚠️ ✅
- **I1 n/a** — single whole-document blob; a delete + its cascade commit atomically as one full-blob upsert (absence == deletion). Residual risk is the whole-blob-overwrite race with concurrent realtime suggestion inserts, mitigated by functional `setData` updaters.
- **I2 ✅ (non-atomic)** — every `storage.set` re-reads the live cloud `__rev` immediately before writing and stamps `cloudRev+1`; but it is a **SELECT-then-upsert (TOCTOU)** with no DB precondition, so a write landing between the SELECT and the upsert is not rejected. Best-effort, not a hard optimistic lock.
- **I3 ⚠️ / I4 ✅ ⚠️** — the **primary** autosave is safe & loud (sticky red `saveStatus='error'` that never auto-fades, 20 s retry, beforeunload confirm, stale banner). **Gap:** the four `skipSanity` backup writes (pre-restore/-delete/-import/-recascade) are `try{…}catch{}` fire-and-forget with the null return discarded → a blocked/failed pre-op backup silently no-ops. History snapshot/prune failures only `console.warn` once.

### 6. useReviewPersistence (Doc Review autosave) — n/a ✅ ⚠️ ✅
- **I2 ✅ (gap)** — `upsertReviewCore` reads `expected=reviewVersions[id]` and advances it on success; `serializeReviewWrite` prevents self-conflict (B528). **Gap:** `listReviews` does **not** select `version` (contrary to its comment), so a review reached via the list without a `loadReview` starts untracked and its first write takes the insert branch.
- **I3 ⚠️ / I4 ✅ (gap)** — the interactive `writeNow` surfaces every outcome (local/saving/saved/unsaved/conflict → red badge). Silent-capable exceptions: the unmount/hide flush `upsertReview(...).catch(()=>{})`, and `keepaliveCasPush` no-op when `expected==null` / over the 64 KB budget — all backed by the synchronous localStorage mirror.

### 7. Tombstones + mergeSiteContent cascade — ✅✅✅✅
- **I1 ✅ (caveats)** — every wired delete handler tombstones exactly its removed set in the same synchronous handler; `deletedIds` flushes with the removal. Caveat A: two cascade-detection functions coexist (`killSetWithChildren` via `forCourt/forTrailer/prevZone` vs keyboard-delete via `attachedTo`) — each internally consistent, but the "full cascade" is path-dependent. Caveat B: `MAX_TOMBSTONES=5000` slice could in theory drop the oldest tombstone past 5000 lifetime deletes.
- **I3 ✅ / I4 ✅** — writes are read-back verified; deliberate no-op branches (resurrection guard, blank-site skip, already-tombstoned) are by-design and lose no tombstone; a cross-tab merge that would drop a live item with no tombstone fires `merge-dropped-live` telemetry.

### 8. Optimistic concurrency / version token + editor lock — ✅✅⚠️✅
- **I2 ✅** — `casUpsert` returns the bumped version, callers store it; `makeWriteSerializer` forces a same-id second write to observe the threaded-back token (B528/B529). `keepaliveCasPush` can't read its response (page unloading) — acceptable, boot re-reads.
- **I3 ⚠️** — CAS 0-row ⇒ `{conflict:true}` reported; delete uses `.select('id')` so a 0-row RLS no-op is distinguishable and reported (`delete-zero-rows`, B372). Exception: `keepaliveCasPush` silently no-ops without fetch/url/anon/token/version/row or over the 64 KB budget (intentional last-ditch net).

---

## AUDIT-FIRST discrepancies (comments/claims vs. code reality)

1. **Tombstone coverage is BROADER than the comments say (stale comments).** `storage.js:52-56` and
   `siteModel.js:298-299` still claim "collections not yet wired to record a tombstone keep the old
   recoverable delete-can-reappear-once trade-off." **Code reality:** post-B556/B612, `tombstone()` now
   covers **every** id-bearing collection — els+bonded children, measures, callouts, markups, parcels,
   parcelDrawings, aprons, split sources, identify-lots. The comments **understate** current coverage and
   should be updated. (Remaining real I1 gaps are whole-**site** deletion and the id-less `underlay` scalar,
   not the drawn collections.)
2. **Optimistic concurrency is DORMANT on an un-migrated DB.** Whenever the Supabase `version` column is
   not migrated in, `casUpsert` returns `{degrade:true}` and the write falls back to a **plain
   last-write-wins upsert with no token** (`cloudSync.js:134-146`, `reviewStore.js:139`). CLAUDE.md / the
   file headers present B314 optimistic concurrency as the active guard, but whether the migration has run
   is not verifiable from code. On a migrated DB it is live; in degrade mode the whole version-token +
   stale-rejection story is inert (only the client-side thin-clobber content guard still protects sites).
3. **The version CAS guards the version NUMBER only, never content.** A stale tab at a *matching* version
   can still overwrite a fuller cloud row. Site Planner adds a separate content thin-clobber guard (B459).
   **Doc Review's `reviewStore` has no equivalent content guard**, so its "can't be silently clobbered"
   claim (`reviewStore.js:78-80`) holds only for a version bump, not a same-version thin blob overwrite.
4. **The Scheduler save is IMMEDIATE, not debounced; and there is no flush-on-close.** `saveState.js:9-11`
   says "debounced first-edit write" + "a flush on tab close." **Code reality:** the cloud upsert is
   undebounced (the only 700 ms debounce is the optional local HTML mirror), and the `beforeunload` handler
   only triggers the browser's native "unsaved changes" confirm — it performs **no** programmatic flush.
5. **The "never lost / LOUD, never silent" contract holds for the interactive autosave, NOT the flush
   paths.** `usePersistence.js:9` and `optimisticUpsert.js:8-12` promise no silent clobber and "never lost."
   The `beforeunload`/`visibility`/forced-reload flush and the `pullCloud` heal re-push both have genuinely
   silent no-op branches (`.catch(()=>{})`, keepalive `expected==null` / 64 KB budget) and skip the B473
   read-back verify — recoverable via the local mirror + next-load boot merge, but silent at write time.
6. **`persistDrawings` is a silent parallel writer.** Its docstring omits that it discards `saveSite`'s
   success boolean and swallows the cloud push error, so despite the standing LOUD-FAILURE rule this path
   has no verify and no loud surface, unlike the main autosave it sits beside.
7. **Minor doc drifts** worth fixing when nearby: `reviewStore.js` version tokens are populated by
   `loadReview` + successful writes **only**, not `listReviews` (which never selects `version`); the
   Doc Review save badge has a 5th `'conflict'` state the docstring omits; `fileNewReview` returns more
   fields than its `{ ok, id }` comment.

> **Net:** the **interactive Site Planner autosave + the tombstone/merge cascade are the strong core** —
> read-back verified, loud, full-cascade tombstoned. The **weaker edges** are the fire-and-forget *heal
> re-push* inside `pullCloud`, the *`persistDrawings`* parallel writer, and the *unload/keepalive* flushes
> — all backstopped by the synchronous local mirror + next-load boot merge, but each has a silent-no-op or
> non-loud branch. Those edges, plus the un-migrated-DB **degrade** mode, are the highest-value B639 targets.
