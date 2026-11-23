# Site Planner notes: persistence sync and plans

_Moved verbatim out of `src/workspaces/site-planner/CLAUDE.md` (audit batch H, 2026-11-23). Nothing below was reworded, shortened or removed; the folder pointer now only signposts here. Root rules in `/CLAUDE.md` still apply._

- `siteModel.js` — the per-plan schema (`createSiteModel`, `SITE_MODEL_VERSION`); read via
  selectors, persist via `storage.js`. **Additive only** — bump the version, extend `migrate`.
- `storage.js` — thin model layer (migrate on read, merge+renormalize on save).
- **`siteStatus.js` (B843792, NEW-1 — "one site entity with a role") now also owns `role`** —
  "pursuit" (the existing pipeline) vs "tracked" (market intel only: a comp, or a note like
  "quoting $6/ft, nothing transacted"). Every existing site defaults to "pursuit" with zero bytes
  written (unlike `status`, role has no legacy-vs-fresh split to make). `SitePlannerApp.jsx`'s
  `siteGroups` (the map's Sites list) filters to `role === "pursuit"` by default — a tracked site
  never pollutes the owner's pipeline; `MapFinder.jsx`'s own `pursuitSites` memo re-asserts the
  same filter at the point of use (B1165440, defense-in-depth — an adversarial review of PR 1424
  found tracked sites in the Pursuit group on planyr.io) rather than trusting the caller alone, so
  the guard holds even if a future caller of this component ever forgets to pre-filter. Flipping a
  site's role later needs no re-entry: `storage.setSiteGroupRole` → `db/set_site_group_role.sql`,
  the SAME one-atomic-statement-over-the-group shape `rename_site_group.sql` uses.
  **⛔ B1181104 — AND THAT RPC MUST STAMP `data.updatedAt`, not just the outer SQL `updated_at`
  column — this is the ACTUAL root cause of B1156864's Sites-list recurrence, found only after
  B1165440's defense-in-depth filter still failed live.** `mergeSiteContent` (siteModel.js)
  resolves every scalar field — role included — from whichever side of a pull-vs-local merge has
  the newer jsonb-INTERNAL `updatedAt`, keeping the LOCAL side on a tie (B559). The RPC originally
  bumped only the outer column, so a role flip through it was invisible to that comparison — any
  client holding a locally-cached copy could get stuck on the pre-flip role forever, no matter how
  many times the RPC ran. B1156864's OWN live verification (flipping `trk8eef7db4d0`
  tracked→pursuit→tracked to prove the RPC works) is what planted this trap on the very rows the
  review then found broken. See `docs/DATA.md`'s ROLE row for the full mechanism and the fix
  (stamp `data.updatedAt`, same convention `nextUpdatedAt()` already uses) — proven with the real
  `mergeSiteContent`, not theorized (the repo-root `test/` suite's B1181104 case). A comp's owning
  site is `comps.project_id` (the comps db folder's own schema header explains why that column —
  not a new one — supersedes into this role); `db/site_role_unify_backfill_20260905.sql` is the
  one-time migration that attached the three pre-existing live comps to sites (creating a new
  "tracked" one for each, since none matched an existing site's location within half a mile).
  **⛔ B1165441 (NEW-2/NEW-3) — that backfill was a SNAPSHOT, not a MECHANISM: it judged the comps
  that existed the day it ran and nothing else.** `storage.resolveOrCreateTrackedSiteForComp` (in
  this same `lib/storage.js`; called from the Leasing Comps save flow whenever a comp has no
  owning site, see `shared/CLAUDE.md` → comps/ for that half) is the real, ongoing runtime path —
  it matches against `loadSitesList()` (the SAME 0.5mi radius the backfill used, against sites of
  EVERY role so a second deal on an already-tracked property attaches to it instead of minting a
  duplicate, then an exact normalized-title fallback) and mints a new "tracked" site only when
  nothing plausible matches. The owner must never have to create a site before recording a deal.
- **⛔ `lib/historyCarry.js` (NEW-1, 2026-11-13, owner: "do I lose the ability to do the control Z whenever I get out of the page?") — UNDO HISTORY SURVIVES LEAVING A PLAN.** The planner remounts per plan (`key=siteId:loadEpoch`), which used to discard `histRef`. Measured on main first: plan switch = lost, reload = lost, module switch (Site → Schedule → Site) = already kept (the planner stays mounted behind the other module). Now: on unmount the stacks are STASHED per (account, plan) — in memory (8 plans, the stack's own 80 steps, redo kept) plus a short IndexedDB tail (`undo:v1:<scope>:<planId>`, newest 15 steps, ≤ ~1.5 MB, 8 plans, 3 days, overlay rasters never written, shared collections written once) — and on mount the same plan's stack is ADOPTED (`history.adopt`, refused if the stack already holds anything). **STALE-HISTORY GUARD:** carried frames are trusted only while the plan still hashes (`carryKeyOf`: the planner's `histKey` with overlay `src` blanked) to what it was when they were saved; `checkCarried` in `SitePlanner.jsx` verifies lazily — on the first undo / redo / new edit and on any content change before then — and DROPS (never replays) them on a mismatch. Never synced; a failed IDB write is silent ("no history after a reload"). **Measured: an IndexedDB write started in `pagehide` does not reliably commit on a real reload, so the settled-edit save (1.5 s after the last history change) is what a reload relies on; pagehide / hidden are only best effort.** A frame carried from disk has no raster, so `applySnapshot` grafts the live overlay `src` by id (`graftOverlaySrc`). Guards: repo-root `test/` **historyCarry**; e2e **undo-survives-leaving-plan** (a, c, d, e red on main; b is the already-working control); live ui-audit **verify-undo-carry-live**.
- **⛔ `lib/gestureSave.js` + the autosave effect (B217540 ×2) — A GESTURE IN FLIGHT IS NOT A SAVE POINT, and the cost of an edit follows the DEVICE STORE, not the plan.** `planarfit:sites:v1` holds EVERY plan, so each autosave parses and rewrites all of them; the effect used to do that on every pointer-move frame of a drag (29 whole-store writes in one 40-frame drag). It now defers while `drag.current` is set (re-checking by a 120 ms ref poll) and runs the ordinary save when the gesture ends, **with a 5 s expiry** so a stuck `drag.current` can never switch autosave off. `storage.js`'s `siteExistsLocally` / `readBackSite` answer "is this new?" / "did it land?" from the last write **only while `localStorage` still holds exactly that string** (any other writer → the full read, so the B473/B592 cross-tab check is unchanged). Three sibling fixes belong to the same finding: the shared names module's `planNameOf` rides the project-name index (it re-parsed the whole store per render), `roadNetwork.js` memoises `dissolveRings`/`clipPolylineOutside` on exact ring values, `writeHistoryAll` serialises the ring once. **The one remaining O(store) cost per save — the native `setItem` of the blob — is GONE as of B2165120 (per-plan storage entries, `lib/planStore.js`, below).** **B217540 ×3 (2026-10-08) took the rest of the per-edit floor off:** `storage.js`'s `readSharedStore` + `sitesSnapshot.js` (a save/load parses only when the bytes changed under it — SHARED plan objects, read-only, `plainCopy` the one you change), `plansToJson` (a one-plan edit stringifies one plan), the autosave settle tick skipping a write the mirror already made (`sitesWriteStillCurrent`), `siteListLight`'s byte-exact memo, and `roadNetwork.collapseRingSpikes`' incremental drift bound; instrument **perf-edit-switch** (`npm run perf:editswitch`), guards **storageSharedReads** · **ringDriftIncremental** · **editSwitchVerdict**; account: `docs/perf/PERF-EDIT-CYCLE.md` §6. Instrument: the repo-root ui-audit harness **perf-edit-cycle** (`npm run perf:editcycle`; the owner's real plan is its committed fixture; its budget is a JSON beside it); account: `docs/perf/PERF-EDIT-CYCLE.md`. Guards (counts, not times): repo-root `test/` suites **gestureSave** · **storageFastPath** · **roadNetworkCache** · **namesIndexCache** and the e2e spec **gesture-save-deferral**.
- **⛔ `lib/planStore.js` (B2165120, legacy entry retired by B2200384) — EVERY PLAN HAS ITS OWN DEVICE-STORAGE SLOT, AND THERE IS NO WHOLE-LIBRARY COPY. Read its header and `docs/DATA.md` §2 inv. 17 before touching anything that reads or writes the on-device plans.** `<store>:p:<planId>` per plan + a ~100-byte `<store>:idx` (marker, change stamp, `legacyRetired`, and `migrating`/`del` only mid-move); **an edit writes one entry and the index, flat in library size.** `storage.js` is a thin façade (`readSharedStore`, `writeSite`, `removeSite`, `writeSites`); **no other module may touch the keys** (grep-guarded). Rules to keep: **(1) the move from the old whole-library entry is PLAN BY PLAN** — entry written → read back and compared → dropped from the legacy text (a smaller rewrite needs no room; measured in real Chromium), so the peak extra room is ONE plan; the index is written first in a `migrating` state and a crash resumes; entries win over the legacy copy; reads mid-move are entries ∪ the rest. **(2) retiring** the entry on an already-split device: read back every entry, count against the legacy plans, recover (never drop) a plan only the legacy entry holds unless known-deleted, then remove it + the ledger (`plan-store-legacy-retired`); any doubt keeps it (`plan-store-legacy-kept`). **(3) NOTHING EVER DELETES AN ENTRY BECAUSE THE LEGACY ENTRY LACKS IT** (the old ledger inference did, on failing-mirror devices — production-measured; the mirror/ledger are gone). **(4) the one-way re-adopt:** a legacy entry that reappears on a retired device (an older tab) is folded in per plan (`mergeSiteContent`, tombstones respected) and removed (`plan-store-legacy-readopted`); it stays one release. **(5) no kill switch, no mirror, no revert to an older build** once a device is retired; the un-split path remains for an unrecognised index and the harness-only `window.__PLANYR_PLANSTORE_UNSPLIT`. **Harnesses read the library through `window.__planyrSitesRaw(key)`** (the shared `sitesRawView` module under `src/shared/storage/`, installed under automation only; unit tests use the sitesView helper in the repo-root `test/helpers/`) — never the raw `planarfit:sites:*` key, which no longer exists after the move. **Making room (B2200385):** only when not even one plan's entry fits, `storage.makeRoomForPlanStore` frees (first) a verifying legacy entry, then the history ring once IndexedDB holds a read-back-compared copy (`relocateHistoryToIdb`), then declared-rebuildable caches, and the move resumes. Guards: repo-root `test/` **planStore** (the owner's real plans smu1t5vcp73y + sms4zs8unbkg padded to 143, flat per-edit cost with the un-split layout as red-proof, retire, tight-device incremental move, crash/resume, re-adopt) + **planStoreRoom** + **storageFastPath** · **storageSharedReads**; e2e **plan-store-retire**; ui-audit **verify-plan-store** (`--retire`, `--tight`; `--live https://planyr.io` signs in as the test account), **verify-plan-store-room** and **perf-plan-store-scaling** (`npm run perf:planstore`).
- **`lib/planMint.js` + `planStore.refuseWrite` (B2639168, 2026-11-03) — A REFUSED DEVICE WRITE IS NEVER SILENT, AND A CREATE THE DEVICE REFUSED NEVER NAVIGATES.** `runMint` (pure: save → make room once → retry the same id → `{ok, navigate, reason, message}`) is how `duplicatePlan`, `newPlanSameParcel` and `newSiteFromMap` mint; a refusal raises the failure banner ("…nothing was saved"), pushes nothing and opens nothing (`goPlanChecked` is the only navigation; `newBlankSite` keeps `goPlan` — a lazy blank has no record). `describePushFailure`: `pushSiteToCloud`'s `"missing"` = no local record, not a cloud failure. `requestPlanStoreRoom` runs `makeRoom` once per page load (`force` = a user Retry). Guards: repo-root `test/` **duplicateRefusedLoud**; e2e **duplicate-refused-loud**; live V2083840.
- **⛔ `projectName.js` (B1415–B1418) — A PROJECT'S NAME HAS ONE AUTHORITATIVE VALUE PER GROUP, and every
  plan's `site` field is a DERIVED MIRROR of it. Read it before touching any rename path.** The name was
  denormalized across a group's plans with nothing keeping the copies in agreement, so a rename that ran
  while some plans weren't cached locally left those plans holding the old name — and they RE-PUBLISHED it
  on their next save (proven in production: group `smrp1wrgg6u5` split Silvestri/Sylvestri for four days,
  the straggler saved seventeen minutes AFTER the rename). Three things hold the invariant up and removing
  any one re-opens it: **(1)** `siteRenamedAt` (schema v13) is the FACT that decides which copy is current —
  **never re-derive the winner from `updatedAt`**, which on the owner's own data is a coin flip; **(2)** the
  rename is ONE server-side statement over the GROUP (`cloudSync.cloudRenameGroup` → `db/rename_site_group.sql`),
  keyed on `coalesce(data->>'groupId', id)` and **never on the `group_id` COLUMN**, which is a mirror known to
  drift from the jsonb; **(3)** the authority is resolved at BOTH seams — `loadSitesList`/`loadSite` on the way
  out, and **`saveSite` as the write choke point**, which is what stops a stale in-memory model being written
  (and therefore pushed) with the old name. `repairSplitProjectNames()` is the idempotent load-time converger;
  a legacy group with no stamp and no majority is REPORTED, never guessed at. Guards: the repo-root `test/`
  suites **projectName** (23, against the real production rows) and **storage**, plus the e2e spec
  **project-rename** (mutation-checked). UI trap it also closes: `ProjectBreadcrumb`'s `editingWhere` is NOT
  redundant with `editingId` — one project id addresses two inline editors (its list row and the crumb-level
  rename), and keyed on the id alone BOTH mount with `autoFocus`, the second stealing focus from the first,
  whose `onBlur` commits and closes it in the same frame.
  **⛔ B1440976 (2026-09-09) — A FOURTH SEAM WAS MISSING: THE PULL-VS-LOCAL CONTENT MERGE, and it is
  the one that actually bit in production.** `siteModel.mergeSiteContent(local, cloudRow)` — run by
  `mergePulledSites` on EVERY cloud pull — picked `site`/`siteRenamedAt` as ordinary scalars, from
  whichever side had the newer-or-tied generic `updatedAt`. But `rename_site_group()` (and its
  pre-migration fallback in `cloudRename.js`) deliberately stamp `data.siteRenamedAt` WITHOUT
  bumping `data.updatedAt` — exactly the same shape B1181104 found and fixed for `role`, except
  role's fix (bump `data.updatedAt` in the RPC) does not apply here, because a rename's whole point
  is that it has its OWN dedicated stamp instead. The result: any device holding a locally-cached
  copy of a plan from BEFORE a rename made elsewhere kept the OLD name on every later pull, forever
  — with no split to catch, because `mergeSiteContent` discarded the losing side's `site` AND its
  `siteRenamedAt` together, so `reconcileGroupNames` saw unanimous (wrong) agreement and had nothing
  left to reconcile. `mergeSiteContent` now resolves `site`/`siteRenamedAt` through the same
  `nameAuthority` the list/read paths already trust, so a stamped rename wins the merge regardless
  of which side `updatedAt` favors for everything else. Proven against real production shapes the
  same way B1181104 was — see the repo-root `test/` suite **siteModel**'s sibling case — not just
  reasoned about. Do not
  "fix" a recurrence by bumping `data.updatedAt` in `rename_site_group.sql` instead — that treats
  the symptom on one write path and leaves the merge still ignorant of the stamp it was designed to
  honor.
  **⛔ NEW-1 (2026-09-10) — AND THE STAMP ITSELF WAS BEING WRITTEN EMPTY, WHICH MAKES EVERY RULE
  ABOVE MOOT ON THE ROWS IT HIT.** B1440976 taught the merge to READ the stamp; this is about the
  stamp not being there to read. `createSiteModel` normalises an unknown `siteRenamedAt` to an
  explicit `null` (correct in memory), `cloudSync.siteRowFor` sends the whole model as `data`, and a
  cloud write REPLACES the row's jsonb — so any device whose cached copy predated a rename wrote
  that null over the rename's own stamp. Measured on `planyr_production` 2026-09-10: **64 of 116
  rows carried a present-but-EMPTY marker, 34 a real number, 18 no key at all.** A key that is
  present and null is a WRITE, not an absence — nothing absent-by-default produces it. And it is not
  theoretical: Silvestri (`smrp1wrgg6u5`) was renamed 2026-07-31T19:23:15.307Z, four of its five
  live plans still carry that exact stamp, and plan `sms9c5oc7jnt` carries JSON null with
  `updated_at` five days LATER. `nameAuthority` lost a stamped voter and fell back to the legacy
  majority rule — the coin flip the marker exists to replace. **Two halves, and neither alone is
  enough:** the client now OMITS a marker it does not know
  (`projectName.normalizeRenameStampForWrite`, applied in `slimForCloud`) — but omitting still
  erases, because the write replaces the whole jsonb — so `db/sites_rename_stamp_guard.sql` (a
  BEFORE UPDATE trigger) makes the row keep what it already holds: **an UPDATE carrying no real
  stamp may neither clear a stamped row's marker nor change its project name.** The name half is
  not extra scope — preserving the stamp alone would let a stale name inherit the rename's own
  timestamp and win a two-plan tie on `updatedAt`. **Do NOT "harden" this into refusing an OLDER
  stamp:** `renameSiteGroup` computes its stamp from the plans THIS device has cached, so a
  genuinely later rename can legitimately carry a smaller number, and refusing it would silently
  freeze a project's name — worse than what it would prevent. Guards: the repo-root `test/` suite
  **renameStampIntegrity** (mutation-proven — every assertion was required to go red against the
  untouched source first) and `db/test/sites_rename_stamp_guard.test.sql` (8 checks, run green
  against production 2026-09-10, and red — cases 1-3 — before the trigger existed).
  **⛔ B1584832 ("NEW-2", 2026-09-12) — THE GUARD STOOD DOWN ON MOST OF THE TABLE, because "no valid
  stamp" is the guard's own no-op case.** Re-measured 2026-09-12: 88 of 125 rows (52 present-but-empty
  + 36 no key at all) carried nothing the trigger could reason about — growth since the 2026-09-10
  count, not a discrepancy. Owner-approved (verbatim: "Yes proceed with the backfill"), RUN against
  production the same day: `db/rename_stamp_backfill_20260912.sql` supersedes the 2026-09-10 one-row
  proposal (folds it in as Tier 1 — transcribe a sibling's real stamp where one exists, still exactly
  the Silvestri row) and additionally seeds the other 87 from their OWN `updated_at` (Tier 2 — no group
  anywhere held a stamp for them, so there is nothing to transcribe). All 125 rows now carry a valid
  stamp; re-run the census in that file's header to confirm before touching either script again.
  **⛔ NOT closed by this: `rename_site_group` still stamps `p_renamed_at` from the CLIENT's clock**,
  so a device whose clock runs behind the server can still lose a genuine rename to this backfill's
  Tier-2 seed under a recency-based guard (NEW-1's concurrent change). Filed, not fixed, as B1584833 —
  read that file's own header before treating the backfill as the whole story.
- **⛔ A PLAN'S NAME: ONE WRITER, ONE SIGNAL (NEW-1, B2671215, owner 2026-11-10: "when I hit enter, it should immediately change the name").** `storage.saveSite` announces a plan's own `name` on the shared sites-list event (the names store's 2 s index is cleared only by that signal — a plan rename used to announce nothing, so the crumb / plan menu kept the old name until something else re-rendered) AND refuses to let a content save move it: only `saveSite(partial, { planRename: true })` — the plan menu's one `renamePlan` — changes the `name` of a record the store already holds (the planner's autosave sends `...metaRef.current`, a render-time COPY of the name, and used to write the old one back over a fresh rename). A new rename door passes the flag; never add `name` to a content save. Library file titles patch the list before their save (`FileBrowser.commitRename`). Guards: repo-root `test/` **planRenameInstant**; e2e **plan-rename-instant** (first-paint probe, red on the old source); ui-audit **measure-rename-delay** (before/after numbers), live **verify-rename-instant-live**.
- **⛔ A RENAME THAT REACHED THIS DEVICE BUT NOT THE CLOUD WARNS — IT NEVER LOOKS FINE (NEW-1, B2671215 follow-up, owner 2026-11-11: "I should get a warning banner saying the save didn't go through. It shouldn't show that everything's working").** The new name STAYS on screen (the device copy has it). `lib/renameSyncNotice.js` owns the ONE pair of sentences — plan: "Rename didn't save to the cloud. Your other devices still see the old name."; project (can be partial, B1048400): "Rename didn't fully save to the cloud. Your other devices may still see the old name." — never a status code or server words (`cloudRename.js` / `renameSiteGroup` hand back plain `error` and the raw text on `rawError`). The banner is `SitePlannerApp`'s `cloud-write-failure-banner` (+ Retry, + the cloud badge reads "error"), raised by `pushLoud` (a plan) and `renameSite` (a project) and recorded in the durable log (the shared cloud write-failure log module: ONE record per plan/group+kind, `clearCloudWriteFailuresFor`). **It clears by itself**: `cloudSync.onSiteSynced` (every success path of the header write announces `{name, site}` it pushed; an older push with the old name settles nothing), the browser's `online` event, or Retry → `reconcileBannerWithLog` (log empty → banner gone, else re-worded over what is left). **A dead sign-in is not a cloud outage**: `isAuthExpiredError` → the shared `getApiToken({ refresh: true })` (dynamic import — a static one adds a Site-route chunk and fails the allowlist) → renewed: one retry; refused: the shell's own "You were signed out" notice speaks and NO second banner is raised (the record stays in the log; there is deliberately no auto-replay on sign-in, it would race the pull). **`ProjectBreadcrumb` uses the host's `onRenameProject` even when uncontrolled** (the uncontrolled `storeRename` wrote the cloud rows but raised no banner, toasted the raw error and left the badge green); a writer that raised the banner returns `bannered: true` and the toast/notice is skipped. Guards: repo-root `test/` **renameCloudFailure**; live ui-audit **verify-rename-cloud-failure-live** (12 of 46 red on 488f2e4).
- `supabase.js` / `auth.js` / `cloudSync.js` — cloud data + auth (shared across workspaces).
- `elementSync.js` / `elementRows.js` / `elementJournal.js` — the element-level sync engine, the
  rows↔model fold layer (incl. `foldJournal`), and the persisted pending-edit journal (NEW-F4:
  a failed commit survives a reload instead of being reverted by the rows-canonical refetch).
  **B1094/B1098, read before touching the write path:** a bonded assembly (a host + everything
  `attachedTo` it) is ATOMIC on the wire. `flush()` first closes the assembly (`closeAssemblies`)
  so every member lands in ONE commit, then re-reads each op's bytes from the live canvas
  (`freshen`, via the injected `liveCollections()`) so a payload captured before a gesture can't
  reach the server — those two together are what stops a drag tearing a building off its truck
  court. Undo/redo is a gesture boundary: `applySnapshot` flushes against the SNAPSHOT (never
  `stateRef`, which React hasn't re-rendered yet). **B1098(×2), the trap that re-tore it once:** a
  remote row arriving MID-GESTURE is turned into a canvas instruction with its payload FROZEN at
  arrival and parked in `pendingRemoteRef` — replaying that across an undo puts pre-undo geometry
  back on the restored canvas, and the next diff commits the re-torn canvas. So an applied snapshot
  is the AUTHORITY: `applySnapshot` drops buffered upserts (keeping buffered REMOVEs — a remote
  tombstone is not undone by a local undo) and calls `noteLocalAuthority()`, which bumps
  `elementSync`'s local-authority EPOCH; every serialization put on the wire carries its epoch, and
  `applyRemoteRow` keeps an own echo from an OLDER epoch off the canvas while still adopting its
  rev. Never widen that suppression to foreign rows or to the current epoch — the B672 stale-seed
  re-true depends on both still upserting. **B1099:** a genuine foreign row beats a pending
  DERIVED op — derived churn is never re-pushed over another writer — while a pending DIRECT user
  edit still wins and still toasts (the B673 matrix, unchanged). **B1097:** `rowsToModel` runs the
  SAME `normalizeBondedChildren` heal as `createSiteModel` — never wire a load-time repair to only
  one of the two read paths (the B1012 trap). **B1113 — which ledger wins on a load:** rows are
  canonical for an element the server already has (`reconcile(..., {afterSeed:true})` →
  `onRowsCanonical`), local wins only for one the server has NEVER seen; and the bonded heal runs
  AFTER the journal / never-synced folds in `refetchReplace`, never before — a fold can otherwise
  substitute a stale copy back over a healed row. Full rule in `/CLAUDE.md` → ROWS-CANONICAL-ON-SEED.
  **B1115:** an all-rejected batch backs off exponentially and, after `maxRejectStreak`, stops and
  emits `client-stale` — never re-queue a rejected batch on the plain debounce. **B1116, the
  subtlest one yet:** the B1099 derived-yield rule is gated on `foreignAuthor(row)` — an op must
  NEVER stand down against this tab's OWN earlier write (on an undo every bonded child conflicts
  with the move being undone, and yielding left 11 of 12 ops silent while the host's landed). And a
  batch that lands only PARTLY across an assembly is never settled: `processResults` re-enqueues
  every refused member of a partly-accepted assembly and emits `assembly-split`. The server half —
  all-or-nothing group commit — is `db/commit_elements_atomic.sql`, **applied to production and
  rollback-verified 2026-07-29**. **B1117:** the client passes `p_atomic: true` for a batch that
  spans more than one member of one assembly (`batchSpansAssembly`); `applied:false` means NOTHING
  landed — including ops whose own status reads `ok` — so `onAtomicRollback` re-queues the WHOLE
  batch, adopting only the fresh REVS, never the json. The two modes return DIFFERENT wire shapes
  (atomic → an object, plain → a bare array); `elementApi` normalises both. A project without the
  migration answers a 3-arg call with PGRST202, so `elementApi` latches a fallback to the 2-arg
  call — never let that error reach the engine as a write failure. **B1120, the one that made B1116/
  B1117 INERT in production for a release:** the engine's `commit` adapter in `SitePlanner.jsx` MUST
  be `(ops, opts) => commitElements(supabase, siteId, ops, opts)`. A fixed-arity `(ops) => …` silently
  drops `{ atomic }`, so every batch goes out as the plain 2-arg RPC at HTTP 200 with nothing to
  notice. `commitElements` now returns `sentAtomic` (what went ON THE WIRE) + `fellBack`, and the
  engine reports `element-atomic-request-lost` when intent ≠ reality — gated on `sentAtomic !== true`,
  because a fixed-arity adapter reports `undefined`, not `false`. **Test the REQUEST BODY through the
  real transport**, never through a mock `commit` that accepts more parameters than the shipped
  adapter does — that mismatch is exactly what shipped a dead feature green. **B1118:** the load-time heal's `exempt` set — a repaired element must diff and COMMIT, or
  rows-canonical-on-seed adopts the torn rows straight back over the repair.
  **⛔ B377888 — DELETE WINS IS THE RULE FOR delete-vs-EDIT AND THE WRONG RULE FOR delete-vs-CREATE.**
  A delete whose base predates the row's existence is a decision about a row that no longer exists, and
  re-issuing it kills something it was never about (measured: three deletes re-applied to rows 1.75 s old
  on `smsdrvzr9gzx`). There is no `created_at` to read, so two client observations stand in, and the
  SECOND is the one that catches it: `births` (a live row for a key the shadow never held, recorded
  BEFORE the pending branch in `applyRemoteRow`) and **`remoteOnly` — keys the SHADOW learned from a
  remote row that the CANVAS never showed.** `reconcile` mints a delete for exactly one reason,
  shadow-has/collections-lack, and cannot tell a user deleting something from a row that arrived and was
  dropped on the way to the canvas; such a delete has no base at all, and is refused with the row handed
  BACK. Asked at THREE seams, because `opFor` sends at the shadow's CURRENT rev — so a delete whose
  shadow was advanced while it queued is **accepted in silence with no conflict anywhere**: in the diff,
  before the op is built, and after a refusal (plus the unload keepalive, which has no result handler).
  Guard: the repo-root `test/` suite **deleteVsCreate** (both directions, every seam, with the two controls).
  **⛔ B1341 STAGE 2 — GROUP CAS, and it is NOT B1117 with a longer name.** B1117 made a CALL atomic;
  two calls can each be internally atomic and still disagree, because every per-row rev guard passes
  while a SIBLING moves underneath you. `assemblyDigest.js` is the GROUP REVISION — `id:rev` pairs of
  an assembly's LIVE members, sorted, comma-joined — **DERIVED, never stored**: a `group_rev` column
  would be a second copy of a fact the row revs already carry, which is the defect this family is made
  of. `db/commit_elements_group_cas.sql` adds a 4th defaulted `p_groups`; a mismatch refuses the call
  WHOLE (`{applied:false, groupConflict:[…]}`, nothing written) and null/empty delegates to the 3-arg
  form so no client in the wild changes. `groupCas.js` is the kill switch and **ships OFF** — read at
  CALL time, so it can be thrown without a reload. Two things not to undo: the digest covers **every
  live member, not the written subset** (a subset digest asks the question the per-row guard already
  answers — and a test that missed this passed on a deliberately wrong build until the mutation check
  caught it), and `elementApi`'s PGRST202 latch degrades to the 3-arg **ATOMIC** call, never to the
  per-row path. Guards: `db/test/commit_elements_group_cas.test.sql` (self-rolling-back, run against
  the real database, mutation-proven) + the repo-root `test/` suite **assemblyGroupCas** (23, incl.
  the real request body). Live-verify: **V179984**.
  **⛔ B420256 — A COMMIT RESULT NAMES AN ID; AN OP NAMES A (kind, id).** The PK is (site_id, kind, id)
  because legacy pre-salt ids are reused across collections, so one id can name two LIVE rows — the
  owner's Katz plan holds `e6327` as both `el` and `markup`, written by one batch. Two settle paths keyed
  results by `r.id` alone under the comment *"ids are unique within a batch"*, so the second `set()`
  overwrote the first and each op got the OTHER's rev and status, silently. **The fix is NOT
  `skey(r.kind, r.id)` — there is no `r.kind`:** `commit_elements` builds every result from `v_id` alone,
  so keying on a field the server never sends would miss on EVERY op and break the whole write path. The
  RPC guarantees ORDER instead (one result per op, in op order; `flush` builds `ops = batch.map(opFor)`),
  so `pairCommitResults` pairs POSITIONALLY and **verifies** the pairing — ids must agree, and kinds too
  whenever a returned `row` names one — falling back to a per-id FIFO and reporting
  `element-results-unaligned` when a response breaks that contract. Guard: the repo-root `test/` suite
  **elementResultPairing** (7, proven 5-red pre-fix, with two deliberate controls). Live-verify: **V215200**.
  **B377891:** `selfUid` is a GETTER here and in `editorNames.js` — a snapshot taken before auth
  resolves is null for the whole session, which silently disabled B1116's and B1099's foreign-author
  gates and made `createNameResolver` invent "a teammate" for the owner's own second tab.
- **⛔ `deletePlan.js` (NEW-1/B743×2) — THE one decision behind EVERY delete entry point. Read it before
  touching any delete path.** "Delete does nothing" came back three times because it was never one bug:
  `deleteSel` opened with a bare `if (!sel) return;` — a silent no-op with no message and no telemetry,
  reachable from four ordinary states (a multi-selection of exactly ONE · a stale `multi` left behind by a
  successful delete · the same left behind by `applySnapshot` · a selection pointing at something already
  gone) from any of sixteen call sites. Each earlier pass closed one ROUTE to that hole instead of filling
  it. Three invariants, all machine-enforced: **(1) DELETE IS UNCONDITIONAL** — anything visibly selected
  is deletable, PINNED included (pinning guards a drag, never a deliberate Delete); **(2) the target is the
  UNION of `multi` and `sel` at ANY count** — there is no count-dependent branch left, so a one-item marquee
  behaves exactly like a five-item one; **(3) SILENCE IS IMPOSSIBLE** — nothing removed returns a reason and
  an owner-facing `message` the caller MUST show. Two rules that are easy to undo by accident: every delete
  clears **BOTH** selection stores (`setSel(null); setMulti([])`, in `deleteSel` **and** in `applySnapshot`),
  and a bonded cascade is **downward only** (a building takes its assembly, a truck court takes only itself
  — the old multi branch resolved to the assembly ROOT and silently took the building). Every entry point
  names itself via `DELETE_ENTRIES` and reports `delete-attempt` / `delete-outcome` through the
  `client_errors` channel (B1215), so the next report is a query, not an investigation. Guards: the
  repo-root `test/` suite **deletePlan** (38 tests incl. a source guard on the wiring) and the e2e spec
  **delete-unconditional** (9 tests, proven red on the pre-fix build).
- **⛔ PLAN OPEN / SWITCH STALL, round 3 (B2225425) — four mechanisms, read `/docs/perf/PERF-PLAN-OPEN.md` round 3 before touching any.** (1) `siteModel.READ_NORMALIZE` is the ONE read-normalization table both read paths run; the rows seed (`refetchReplace`) applies it to what it shows and commits what it changed (exempt from rows-canonical) instead of adopting the raw row back — never let a seed replace an element its normalized canvas already shows. (2) `tileLifecycle.paceTileLoads` bounds aerial tiles in flight so a whole grid never answers in one main-thread burst. (3) `framingPoints` / `framedViewFor` (module scope in `SitePlanner.jsx`) are the ONE framing derivation for `fit()` AND the first render, seeded from `lastMeasuredCanvas` — a GUESS only; the boot framing still measures and still owns the reveal (constraint #8). (4) `warmSeedCaches` asks the parcel anchors/pair overlaps in MessageChannel slices before the seed (never timers — the owner measures in a hidden tab). Also `PriorityToolbar`'s width cache. Instrument: ui-audit **perf-plan-open** (every heartbeat gap, classed task/queue, tile counts, commits); guard: repo-root `test/` **planOpenRound3**.
- **⛔ PLANNER SAVES ON SWITCH / HIDE / SIGN-OUT (B2233521) — `lib/saveDedupe.js`.** Every flush in `SitePlanner.jsx` (switch, persist-on-leave, page hide) goes through `saveLive`: **`mayWriteForAccount` — a plan opened under an account is never written into another account's or the signed-out store** (signing out used to copy the open plan into the signed-out store), and `writeIsRedundant` skips a flush of exactly the last write (a switch wrote the plan being left twice). The autosave mirror is gated the same way. **Not shipped, measured:** keeping the previous plan mounted (hidden) across a switch — no win in the rig, three adjacent cases worse; see `/docs/perf/PERF-PLAN-OPEN.md` round 4 before trying it again. Guards: repo-root `test/` **planSwitchSaves**; ui-audit **verify-plan-switch-writes** (real edits on two plans, every write recorded, reload + sign-out — run it on any change to switching or saving).
- **⛔ FIRST OPEN OF A PLAN / THE LARGER PLAN / THE APP OPENED FRESH (B2156160, round 5) — `lib/roadNetBuild.js` + three small rules; account `/docs/perf/PERF-PLAN-OPEN.md` round 5.** (1) The dissolved road network (`roadNetSteps`, formerly the body of `SitePlanner`'s `roadNet` memo) is a GENERATOR with `yield;` between units of work and two drivers: the memo runs it to the end (`driveSteps`), `warmSeedCaches` → `warmRoadNet` → `warmRoadNetFromEls` runs it in ~8 ms MessageChannel slices BEFORE the rows seed, so the clipper work is already in the by-value caches (`dissolveRingsSteps` / `clipPolylineOutside` / `roadSurfaceRing`) when the render asks. A warm-up that disagrees with the render only misses the cache; **never put a second implementation of the steps anywhere**. (2) `roadSurfaceRing` is cached by value; the dissolve/clip caches were enlarged (a clear at the cap throws a warm-up away). (3) The Map mode (`SitePlannerApp`'s second AppHeader + the whole MapFinder) is built when FIRST shown, then stays mounted (keep-alive unchanged); `MapFinder` defers its saved-site pin rebuild while hidden (`visibleNowRef` + the `[visible]` layout effect), and `ProjectBreadcrumb` builds its project rows only while open. **Price, measured and stated:** the first Map click after the app opened on a plan now builds the map (ui-audit **perf-plan-open** `open-map-after-reload`). Not fixed, named in the doc: the planner's first mount (render + commit, one ~250–400 ms React task at 2×) and `loadSitesList`'s whole-library read per sites refresh (B2165120 territory). Guards: repo-root `test/` **roadNetWarm** (the warm-up leaves the render NO cache miss on the owner's real Bolt-on and Richfield rows, and is sliced; red control), **planOpenRound3**, **contentVisibility**; instrument ui-audit **perf-plan-open** (`first-open`, `reload-onto-plan`, `open-map-after-reload`, `--cpu 2`).
- **⛔ THE APP OPENED FRESH ON AN OWNER-SIZED DEVICE (B2236000, round 6) — four "already proven" memories; read `/docs/perf/PERF-PLAN-OPEN.md` round 6 before touching any.** (1) `storage.loadSitesList` remembers each plan's MODEL against the store's shared object for that plan (`listModelOf`), still returning a fresh array of fresh top-level copies every call (refreshSites' identity contract); the cloud pull's merge reads the same models. (2) `siteModel.normalizedEls` remembers an element list the passes returned UNTOUCHED (`CLEAN_ELS`, `elsListIsClean`), and `unionById` / the merge's tombstone filter hand back the input array when nothing changed, so a list stays recognisable through a merge with a slim cloud header. (3) `lib/elsProof.js` carries that fact across a reload, keyed by build + the plan's exact stored text (`planStore.textOf`); `planStore.writeMap` keeps the shared object of a plan whose text did not change. (4) the version-history ring hydrates in idle time (`scheduleHistoryHydration`), re-writes IndexedDB only when the merge added something, serialises each snapshot once (`historyRingJson`), and writes IndexedDB in idle time. ⛔ All four rely on the house rule that a model's collections are never mutated in place — the list models are deep-frozen under test (repo-root `test/` **sitesListCache**). Plus: the page's FIRST planner mount waits (≤1.5 s) for `SitePlanner.warmPlanForMount` and is applied in a transition (`SitePlannerApp`, `plannerWarmPending`). Instrument: ui-audit **perf-plan-open** `--owner-store` (the owner-measured device size) + `first-switch-after-reload`; the owner's own cold-load instrument is the ui-audit snippet **owner-popup-heartbeat**.
