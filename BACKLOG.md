# Planyr — Backlog

Single source of truth for bugs and feature requests. Repo: `planyr` (product: **Planyr**).

> *"Single source of truth"* = the one file everyone trusts for what's done and what's left, so status never has to be tracked in anyone's head or in a chat thread.

---

## How this file works — Claude Code, read this first

- **On each run:** address every item under **🔲 Open**. Do **not** action anything under **🕓 Later / Roadmap** unless it's been moved up to Open. **⏳ Verify** items are already implemented and only awaiting a live check — they **park**, they never block a session (see the lifecycle below). Completed items live in `BACKLOG-DONE.md` — do not read it unless looking up a specific past item.
- **IDs are permanent.** The next B# = highest `B#` across **both** `BACKLOG.md` and `BACKLOG-DONE.md` + 1. Never renumber or reuse a number, even after items are done.
- **Items pasted from another chat are "blind" to this file** and may carry provisional `NEW-#` (or stale/colliding `B#`) labels — treat those as scratch references only and assign the real next `B#` when filing. When you file a chat item, add an **`Origin: filed <date> from chat`** line so its provisional `NEW-#` resolves to the real `B#` later.
- **Before filing, DEDUPE-FIRST.** Search **Open, ⏳ Verify, AND Done** (`^### B` headings) before minting a `B#`. If an arriving report matches an existing item, do **NOT** create a new number — apply the **recurrence rule** below instead.
- **Bracket tags** like `[Site Planner]` mark the module. `(bug)` / `(feature)` / `(task)` marks the type. **`#tags`** (from the legend below) mark the theme — every Open / ⏳ Verify item carries one or more.
- **Always commit after editing this file or finishing a fix** — never leave the working tree dirty. A fix that isn't committed doesn't count as done.
- **Regenerate `BACKLOG_OPEN.md` in the SAME commit as any `BACKLOG.md` edit** (`node scripts/build-backlog-index.mjs`). It is the small, committed, chat-readable index of every Open/Verify item (B#, title, module, tags, Verify status) — **derived, never hand-edited**. CI runs `--check` and fails the build if it drifts from this file.
- **Never delete items.** Completed ones stay in `BACKLOG-DONE.md` as a record.
- **If an item is ambiguous,** don't guess. Mark it `[?]`, add your question inline, and leave it in Open.

### Item lifecycle — 🔲 Open → ⏳ Verify → ✅ Done (three states, B636)

Items no longer jump straight from Open to Done on a sandbox pass — live-only bugs (dependency arrows, export furniture sizing, …) kept boomeranging back. Every item carries a **`Verify:` field**:

- **`Verify: sandbox`** (the default) — a green build + the right unit/headless self-test is sufficient proof. On completion, move the whole block straight to `BACKLOG-DONE.md`.
- **`Verify: live`** — the fix can only be *confirmed* in the live app. **Mandatory `live` classes:** timing/race bugs · concurrency / multi-writer · GIS endpoint behavior · zoom- or data-density-dependent rendering · PDF / export parity · anything whose repro cites real project data. (This is the **LIVE-VERIFY** rule in `CLAUDE.md`.) After implementing, move the block to the **⏳ Verify** section with a dated note; it moves to Done **only after** a verification note is appended (date · method — Cowork or Michael on planyr.io · observed result). **Moving a `live` item straight to Done is a protocol violation.**

⏳ Verify items **park** — they never block a session; the session that implements one keeps going.

### Recurrence — a fix that didn't stick does NOT get a new number (B636)

When a new report matches an existing **Done or ⏳ Verify** item (search titles, tags, symbols): do **NOT** mint a new `B#`. **Move the original block back to 🔲 Open**, append a `Recurrence: <date> — <one-line report>` line, and add a visible count to the title, e.g. `(×3)`. Non-sticking fixes become visible on the one ID instead of scattering across new numbers.

### Theme tags (legend) — a tag may be used only if it appears here (B638)

Add a new tag to this legend **in the same commit** you first use it (this prevents tag sprawl; CI's `build-backlog-index --check` fails on an off-legend tag):

`#persistence` `#gis` `#gantt` `#export` `#site-planner` `#doc-review` `#scheduler` `#selection` `#pond` `#drive` `#testing` `#ui` `#markup` `#infra` `#auth` `#perf` `#files` `#compare` `#stitching` `#yield` `#filing` `#library` `#road` `#coordinates`

### Item template

<pre>
### B### — &lt;title&gt; `[Module]` (bug|feature|task) #tag1 #tag2  *(provenance note)*
`[ ]` &lt;one-line summary&gt;
- Verify: sandbox            # or `live` — see the mandatory-live classes above
- Origin: filed &lt;date&gt; from chat   # only when filed from a pasted chat item
- &lt;details…&gt;
</pre>

---

## 🔲 Open

### B671 — Element-level sync, phase 2/5: per-element write path in cloudSync (edit lock still ON; dual-write bridge) `[Site Planner]` (feature) #site-planner #persistence  *(owner brief 2026-07-06, arrived as "NEW-2"; minted **B671** — renumbered from a provisional B667 on merge-in of `origin/main`: a concurrent module-nav session took B665–B669, so the 5-phase element-sync program is **B670–B674**. Branch `claude/site-elements-schema-sync-4p2x5b`.)*
`[ ]` Rewrite the save side from whole-doc saves to per-element commits (via the B670 `commit_elements` RPC) while the single-tab edit lock stays on — single writer makes this phase safe to ship alone.
- Verify: sandbox            # the engine is fully unit-testable with injected I/O; a V-entry covers the live dual-write parity spot-check
- Origin: filed 2026-07-06 from chat
- **Diff-based committer** (`lib/elementSync.js`): a shadow map of last-committed elements keyed by (kind,id), diffed at the central autosave effect — covers all ~68 scattered `setEls` call sites, undo/redo (snapshot restore re-commits as a normal edit, rev check and all — NO special case), paste, generation, and prunes by construction. Commit boundaries: gesture end via a `flushGesture()` hook at the four `drag.current = null` sites (+ a settle re-poll for Esc-cancel paths), create/delete immediate, ~750ms per-element trailing debounce for in-progress text / live pickers; a group drag commits all moved elements as ONE batch RPC.
- **Rev-guarded LWW:** every commit sends expected rev; a conflict adopts the RPC's returned current row and re-commits local data on top (last-write-wins), emitting a typed conflict event B673 consumes. Per-SITE serialized in-tab queue (reuses `serializeWrites.js`) → two rapid commits to the same element can never interleave — retires the known in-tab write-write race class (B528/B529). Dirty queue + backoff (1s→30s, then 'failed'); LOUD-FAILURE via the existing badge (saving / syncing(n) / retrying / failed) + `reportClientEvent`; keepalive flush on unload.
- **z_index:** explicit within-type-layer tiebreak — the `Z_LAYER` type table stays; `z` replaces ARRAY POSITION as the stable tiebreak, so render/hit-test/"Building N" numbering inherit via z-sorted arrays. `SITE_MODEL_VERSION` 11→12 (additive `ensureZ` = idx*1024, exactly the B670 SQL backfill rule). `nextZ`/renormalize in `lib/zOrder.js`.
- **Dual-write amendment (sequencing):** the whole-doc blob save keeps running UNCHANGED this phase — reads stay on the blob until B672 flips them; killing blob writes now would serve stale data cross-device. The blob-save + deletedIds/union-merge kill moves to B672's read cutover.
- DEDUPE-FIRST: net-new (see B670).

### B672 — Element-level sync, phase 3/5: realtime read path + rejoin refetch (read cutover; blob frozen) `[Site Planner]` (feature) #site-planner #persistence  *(owner brief 2026-07-06, arrived as "NEW-3"; minted **B672** — see B671's renumber note.)*
`[ ]` Subscribe each open site to its element rows and apply changes live; with the lock still on, read-only tabs now update in real time — a user-visible win that ships before multi-writer does.
- Verify: live               # cross-tab propagation is a multi-session timing class (LIVE-VERIFY) → parks in ⏳ Verify → V220
- Origin: filed 2026-07-06 from chat
- One Realtime channel per open site (`postgres_changes` filtered to its site_id). Apply rule is idempotent: apply an incoming row iff incoming.rev > local rev — own committed changes echoing back are a harmless no-op. Tombstoned rows remove the element from canvas. Elements in the local dirty queue keep their local data and commit through the normal rev-checked path.
- **Full refetch + replace on EVERY join/rejoin** (initial load, reconnect, tab wake via visibilitychange) — never trust event gaps. Measure-before-patch if timing weirdness shows.
- Load reads rows + the slim header, not the blob. **Kill list:** blob load path; doc-level conflict detection + the false-conflict banner (the B558/B596/B460 class — retired BY ARCHITECTURE); the thin-clobber guard + content-sig re-push (they'd false-block / perma-re-push the newly-slim header — must die in the SAME commit as header slimming); the storage-event union fold for cloud-active (signed-out keeps it). `deletedIds` keeps serving the header-side collections (sheetOverlays/parcelDrawings/crossSections) + signed-out mode; element ids stop being written to it.
- Backfill re-runs at deploy (its only-if-older guards make that safe) + `sites.data_backup` one-time copy = the frozen ~30-day rollback blob.
- DEDUPE-FIRST: net-new (see B670); B127/B90 (Done) were the localStorage-era cross-tab folds this replaces for signed-in use.

### B673 — Element-level sync, phase 4/5: loud-conflict surface + delete/edit matrix `[Site Planner]` (feature) #site-planner #ui #persistence  *(owner brief 2026-07-06, arrived as "NEW-4"; minted **B673** — see B671's renumber note.)*
`[ ]` No overwrite is ever silent — both sides of a collision get told. Whole-element granularity; no field-level merging inside one element.
- Verify: live               # conflict paths are inherently two-session timing (LIVE-VERIFY) → ⏳ Verify → V221 (fully reachable only once B674 unlocks same-browser concurrency; cross-device races reachable before that)
- Origin: filed 2026-07-06 from chat
- **Matrix:** edit-vs-edit → second committer wins; the losing tab toasts "⟨element⟩ was also just edited by ⟨name⟩ — your version was kept" + zoom-to-element; the overwritten tab (an incoming foreign rev for an element it authored within ~15s) toasts "⟨name⟩ changed ⟨element⟩ you just edited — their version is showing" + zoom-to. Editing a deleted element → commit hits a tombstone → toast "⟨element⟩ was deleted by ⟨name⟩" + **Restore** action (clears the tombstone, writes your data, new rev). Deleting a just-edited element → the delete re-applies against the new rev and proceeds (delete wins — intuitive); the editor's tab gets the standard removal + supersede notice. Create-vs-create: impossible by construction (per-tab salted ids, B591) — assert, don't handle.
- **Attribution:** updated_by uid → display name via profiles/useProfile for self; for teammates via the existing `list_team_members` roster RPC (profiles RLS is own-row-only; a foreign uid can only occur on a team site; a foreign echo on a private site is your own uid on another device → "you (another window)").
- **Toast component** (`src/shared/ui/Toast.jsx`, reusable): non-blocking, auto-dismiss with hover-hold, optional action button, theme tokens only, salience by solid fill + weight (never faded text), stack cap + "+n more".
- `zoomToElement`: factor a `frameToBBox` helper out of `frameToActiveParcels` (no per-element zoom exists today — verified).
- DEDUPE-FIRST: net-new (see B670); B455 (Done) demanded loud+BLOCKING conflict handling under the old whole-doc model — this is its per-element successor, non-blocking by design because nothing is lost (LWW + both sides told + Restore).

### B674 — Element-level sync, phase 5/5: remove the edit lock — multi-writer cutover + presence pill `[Site Planner / Shell]` (feature) #site-planner #ui #persistence  *(owner brief 2026-07-06, arrived as "NEW-5"; minted **B674** — see B671's renumber note.)*
`[ ]` Cutover: remove the single-tab edit-lock gate — all tabs and users edit concurrently through the rev-checked path.
- Verify: live               # the full multi-writer matrix is inherently multi-session (LIVE-VERIFY) → ⏳ Verify → V222+
- Origin: filed 2026-07-06 from chat
- **Escape hatch:** default-on code constant + localStorage override `planyr.multiwriter=off` forcing the old lock behavior client-side — NO new build-time env var (the Cloudflare env-at-build failure pattern; don't create a third instance of it).
- **Presence:** Supabase Realtime Presence on the existing per-site element channel, tracking uid/name/session (display name only — never the email). Header pill "N here" with names on hover, rendered through AppHeader's existing `saveSlot` slot.
- **The brief's amendment flag, resolved:** it says to amend "the banner-collapse/presence-pill item filed from the edit-lock-banner session" — **that item does not exist anywhere** (swept `^### B` headings + full text of BACKLOG.md / BACKLOG-DONE.md / BACKLOG_OPEN.md + git log). Nothing to amend; its presence-pill half IS this item; its read-only-banner half is dead under multi-writer. Closest filed relatives, all Done: B313 (multi-tab "only one tab can edit" warning — suppressed for the planner under multi-writer via a `multiEditOk` prop; doc-review keeps it), the B464–B468/B480 read-only-lockout cluster (retired with the lock).
- **Kill list, final:** the planner's signed-in lock gating + takeover flow + read-only banner (the `editorLock.js` MODULE stays — doc-review consumes it, and it still serves the `multiwriter=off` hatch + signed-out mode), any remaining cloud-active doc-save / union-merge remnants. The frozen blob backup column stays ~30 days post-cutover (OWNER-TODO carries the drop date).
- **Mandatory Cowork live matrix on planyr.io**, two authenticated sessions: (1) A moves a building → lands in B within ~2s; (2) A deletes, B sees the removal; (3) A and B edit the same element inside the window → second wins, BOTH toasts fire with correct names; (4) B edits an element A deleted → Restore works end-to-end; (5) B goes offline, edits, reconnects → dirty queue flushes with rev checks, rejoin refetch consistent; (6) refresh mid-edit loses nothing; (7) three sessions simultaneously; (8) paste/generate a 30-element group → ONE batch, no half-applied state; (9) regressions: the old conflict banner never appears anywhere, and deleted elements never resurrect after reload — tested explicitly against a site with pre-migration deletedIds history.
- DEDUPE-FIRST: net-new (see B670).

### B663 — ONE-TIME migration: every existing project gets the standard tree + existing files move into their tree folders in Drive `[Library / storage]` (task — owner-requested migration) #library #drive  *(owner 2026-07-05 — "i want all the existing projects to have this folder structure, this can be a one time migration. also go ahead and place the existing files in appropriate folders"; first minted **B660**, RENUMBERED to **B663** on the same merge-in as B662; **B663** = B662 + 1; branch `claude/planyr-folder-drive-sync-0k8h0t`)*
`[ ]` **SHIPPED this session — pending the signed-in live run (V215).** The first time the Library opens signed-in, a one-time organizer runs across **every** project in the account, with a live banner + Retry-on-error (LOUD-FAILURE):
- **Per project:** idempotent template seed (`ensureSeeded`, existing) → chunked Drive mirror (`syncFoldersToDrive`, B662) → **chunked FILE moves**: the server pages the caller's `drive_files` keys (`idStore.listByPrefix`), parses each `<uid>/project-<pid>/<discipline>/<name>` key (`parseFiledKey` — the stored key already carries project + discipline, so NO review records are opened), resolves the tree target through the SAME shared resolver uploads use (now slug-tolerant: `site-plans` ≡ "02. Site Plans"), reads the file's current Drive parents (`driveClient.parentsOf`) and **re-parents in place by file id** (names, share links, read-back untouched — downloads resolve by id). `migrateFilesToTree` in `server/storage/folderMirror.js`; `/api/folders action:"migrate-files"` (8 files/request); client loops (`migrateProjectFiles` / `migrateAllProjects` in `library/lib/folders.js`).
- **Safety:** idempotent end-to-end (already-in-tree files skip on a cheap parents check → safe to re-run; the once-per-account marker `planyr:treeMigrateV1:<uid>` only avoids waste); `project-unfiled/…` holding-area files are deliberately NOT moved (no auto-guess); a file whose tree folder isn't mirrored yet stays put (skipped, counted); per-file errors carry real text and don't stop the rest.
- **Ship note:** all existing files land in `01. Current` (the migration can't know superseded-ness from keys); the demote-moves-to-Archive physical move remains the B659 follow-on. lint 0 · 2,561 tests (10 new) · build green.
- **🔍 Adversarially reviewed (2026-07-05, 2 dimensions × verify): 14 findings CONFIRMED (deduped to 8 root causes), all addressed same-session.** The theme: the migration must NEVER write its permanent done-marker over a false success, and one bad file must never wedge the rest. Fixed: (1-HIGH) a blipped `drive_files` page read returned `[]` = "end of list" → the walk reported COMPLETE + wrote the marker with files never moved — `listByPrefix` now returns null and the chunk fails loudly; (2-HIGH) a transiently-failed/empty project list wrote the marker over "All 0 projects organized" — zero projects now writes NO marker and claims nothing; (3-HIGH) one poisoned file 502'd its chunk and every retry died at the same spot — per-file errors now ride along (chunk stays ok, cursor advances, final report lists them) and a dangling mapping (Drive 404) self-heals by deleting the stale row; (4) a skipped file-phase after a successful mirror no longer counts as success; (5) the per-instance run guard blocked a second ACCOUNT on the same mounted Library — now per-uid; (6) the round cap could restart at 0 forever — replaced with a stall guard + a 500-round backstop; (7) an account switch mid-run stops the walk and blocks the marker write (identity pinned start-to-finish); (8) the signed-out skip message no longer masquerades as "Drive isn't connected".
> **Dedup:** the execution of B662's "migrate PRE-tree uploads" follow-on + the all-projects scaffold backfill in one owner-requested pass. Reuses the B662 resolver/chunk-loop/endpoint patterns wholesale — no parallel system.

### B662 — Unified Library: the folder tree IS the view, and files live inside it (+ the live-502 chunked Drive sync fix) `[Library / Doc Review / storage]` (feature + bug — B650 follow-on) #library #drive #persistence  *(owner-dropped 2026-07-05 with a live 502 screenshot on the first real seed — "it's already breaking … let's wire them together … folders should be the primary view … I don't know that I even need a file view"; first minted **B659**, RENUMBERED to **B662** on merge-in of `origin/main` — a concurrent session took B659 (sheet-reader revamp) + B658 (landing copy) + V212/V213; **B662** = highest real B# across both files (B661, the re-renumbered parcel item) + 1; branch `claude/planyr-folder-drive-sync-0k8h0t`)*
`[ ]` **SHIPPED this session — pending the signed-in + live-Drive click-through (V214; V208/V209 re-run).** Three legs, all owner-requested in one report:
- **(a) The live 502 (bug in B650's first release, fixed):** the first real 133-folder seed (GREENS BAYOU) died mid-mirror — 65 of 133 folders reached Drive, then the platform killed the single overlong request and the badge showed a bare "HTTP 502". **Fix:** the mirror now syncs in **chunks of 20 ops per request** and the client **loops rounds with live progress** ("Mirroring… 65 of 133"); the reconcile was already resumable-by-design (every completed folder persists its Drive id), so the loop picks up exactly where it stopped — never duplicates. Errors now surface as **real text + a Retry**, never a naked status code (LOUD-FAILURE). Executor `maxOps` + deferred-not-errored out-of-chunk moves unit-tested (`test/folderMirror.test.js`). ⚠ Greens Bayou's remaining 68 folders self-heal on the next open/sync after this deploys.
- **(b) Files WIRED into the tree (the "natural next step"):** a dropped PDF's bytes now land **inside the project's standard tree in Drive** — `02. Design → 01. Drawings → <discipline> → 01. Current` — via one shared resolver (`resolveDrawingTarget`, `src/shared/folders/folderTree.js`) used by BOTH the server upload targeting (`/api/files` + the B409 resumable path; `treeParentForUpload` + an additive `parentFolderId` through `adapter.save`/`driveBackend.put`) and the on-screen placement, so the screen and Drive can't disagree. Tree not seeded / not yet mirrored / no project → the flat legacy path (never a blocked upload). Unknown discipline → the Drawings folder (visible, never hidden); superseded → `02. Archive` (display; physical Drive move of a demoted file = follow-on below).
- **(c) Folders = THE Library view (owner UI call):** the per-project Files/Folders tab split is **gone** — one unified explorer: the editable, Drive-mirrored folder tree as the left rail (selection filters the list; rolled-up per-folder counts), the file list + drop zone + upload tray + Needs-filing on the right (`FileBrowser folderMode` + `FolderTree embedded`; `Library.jsx` rewired). Archive folders ARE the superseded view (checkbox hidden in folder mode). Cross-project "All projects" keeps the classic category list (a folder tree is per-project) via a facet-row "⊞ All projects" switch. The owner floated *"maybe the file view should just be the Review module"* — resolved as: Review keeps "open one drawing + mark up"; the Library keeps browsing/filing, now tree-first. lint 0 · 2,551 tests · build green · logged-out E2E smoke on the unified surface.
- **Follow-ons (small, filed not lost):** physically move a demoted (superseded) file's Drive object to `02. Archive` when it's replaced (display already correct); ~~migrate PRE-tree uploads' bytes into the tree~~ **DONE — B663** (the owner asked for it same-day); drop-onto-a-selected-folder manual filing; **folder-delete → optional file-RECORD cascade** (today the modal says truthfully that entries re-shelve under Drawings and stay until deleted individually — trashed Drive files remain openable by id, so nothing breaks; a real cascade needs keep-bytes-in-trash delete semantics, deliberately NOT bolted on same-session); **cross-tab sync race** (two TABS mirroring the same fresh project can still double-create empty folders — the in-tab race is closed by the single-flight below; full fix = a conditional drive_id persist in the RPC that lets the loser roll back its duplicate).
- **🔍 Adversarially reviewed (2026-07-05, 3 dimensions × verify): 8 findings CONFIRMED, all addressed same-session:** (1-HIGH) a blipped `project_folders` read returned `[]` → empty plan → **false "Mirrored to Google Drive"** — `list()` now returns null and every consumer (sync / plan-delete / migrate) fails LOUDLY; (2) overlapping sync loops double-created Drive folders — per-project **single-flight with a trailing re-run** (edits mid-pass are never lost); (3) **refile now moves the Drive bytes** to the confirmed discipline (`file-move` action + `moveKeyToTree`; failure → a visible amber notice, and the B663 migration **respects any in-tree placement** so it can't yank a refiled file back); (4) folder-delete's entry-lingering made explicit in the modal + filed as the cascade follow-on above; (5) server folder reads now carry `sort_order` so server/client resolve identical sibling order; (6) deleting the selected folder no longer strands a ghost selection (sanitize effect); (7) free-typed unicode disciplines can't crash the upload fetch (`headerSafe`); (8) folder-rail clicks exit the Needs-filing view.
> **Dedup:** B650's own follow-on (fold-in, not a new system) — reuses its resolver/mirror/store end-to-end. The unified view REPLACES the B650-era Files/Folders tabs and generalizes **B496**'s Library surface; **B180**'s "folders are saved views" survives as the facet chips + cross-project browse over the same list. Auto-filing (**B312**/B299/B411) is UNCHANGED — it still picks the discipline; the tree is now where its decision lands. Upload paths (**B409** resumable + B207 multipart) both target the tree.

### B653 — Split Setup into Standards + a canvas View menu `[Site Planner / Setup + UI]` (feature) #site-planner #ui  *(owner brief 2026-07-05, arrived as "NEW-1"; minted **B653** = highest real B# across both files (B652) + 1)*
`[ ]` Setup currently mixes three different kinds of control: **view toggles** (show dock doors / column grid / dimensions / areas), **drawing behavior** (grid, snap), and **element-type defaults** (structural grid, parking, trailers, dock zones, roads, colors). Split it: (1) view toggles + grid/snap move to an **eye-icon View menu on the canvas** — which also kills the Snap duplication with the top bar; (2) what remains renames to **"Standards"**, organized per element type, with the explainer *"starting values for new elements — editable per element."*
- Verify: sandbox
- Origin: filed 2026-07-05 from chat
- **Cross-link both ways:** "default" placeholders in element inspectors link to Standards; a "Set as default" affordance in Properties writes back to Standards and says so.
- Dedup checked: B101/B102/B602 (Done) touched Setup *content*, not this reorganization; B262/B263 (Done) fixed snap *semantics*, not its placement.

### B654 — Merge Aerial + Overlay into one References panel `[Site Planner / references]` (feature) #site-planner #ui  *(owner brief 2026-07-05, arrived as "NEW-2"; minted **B654**)*
`[ ]` Aerial underlay (image + calibrate + trace) and Site-plan overlay (PDF/image, white knocked out) are near-duplicate features with jargon names. Merge into one **"References" panel**: a single "Add reference…" flow with **shared calibration**, and per-reference **opacity / knockout / above-below / lock** controls.
- Verify: sandbox
- Origin: filed 2026-07-05 from chat
- The Review tab keeps its redline/takeoff job but **reuses the same import + calibration components** (shared modules, not a copy).
- Dedup checked: **B73 (Open)** — "calibrate the overlay to the drawing scale" — is the calibration-behavior half of this and should land as part of the shared calibration flow (cross-reference; both IDs stay). B461/B462/B574/B577/B578 (Done) polished the old Overlay panel this merge replaces.

### B655 — Detention sizing card in the pond inspector, with a pumped-outfall toggle `[Site Planner / detention]` (feature) #site-planner #pond #yield  *(owner brief 2026-07-05, arrived as "NEW-3"; minted **B655**)*
`[ ]` Surface required-vs-provided sizing **at the pond itself**: a sizing card in the pond inspector with editable screening inputs — drainage area (default = the parcel), impervious % (auto from the plan, as Yield's STORMWATER already computes), a design-storm picker, and allowable release rate → **required vs. provided with a pass/fail delta**, screening-level like the existing volume note. **Pumped outfall:** an "Outfall: Gravity / Pumped" toggle + a constant discharge rate (cfs/gpm) credited against required volume.
- Verify: sandbox
- Origin: filed 2026-07-05 from chat
- **AUDIT-FIRST discrepancy — the brief's premise ("nothing computes required storage") is stale:** B636/B637 shipped authority-rule required-vs-provided in the Yield panel STORMWATER group, and **B640 already wired "⇱ Size for required detention" next to "Expand this pond"** — the brief's last bullet ("wire Expand this pond to the pass/fail target") is DONE. Genuinely new here: **(a)** the per-pond inspector card (vs the site-level Yield rollup); **(b)** user-editable screening inputs — drainage-area override, design-storm picker, allowable release rate (a rate-based release computation beside B636's fixed authority coefficients, same carry-the-rule-record discipline: every number states its source/assumptions); **(c)** the **pumped-outfall credit** — nothing in B636–B642 models a pumped system (cross-ref **B641** outfall tiers; note the B639 interaction: a pump makes gravity tailwater moot, so Regime B's drowned-outlet warning must not fire against a pumped pond — state the assumption on the card, never silently credit).
- Build ON `detentionRules.js` / `pondGeom.js` — no parallel math.

### B656 — Properties inspector follows selection instead of occupying a rail tab `[Site Planner / UI]` (feature) #site-planner #ui #selection  *(owner brief 2026-07-05, arrived as "NEW-4"; minted **B656**)*
`[ ]` "Element" occupies a rail slot that sits empty when nothing is selected, and opening any other panel **hides a selected element's properties** (repro: select pond → click Yield → properties gone). Make the properties inspector a **companion surface that appears on selection and coexists with the informational panels**; the rail keeps only true destinations (Insights, Parcels, References, Standards).
- Verify: sandbox
- Origin: filed 2026-07-05 from chat
- Sequencing: the target rail list assumes B654 (References) + B653 (Standards) — land those first or adjust the naming here.
- Small-screen care: B556 (Done) showed an auto-opening properties panel buries the canvas on a phone — the companion surface needs an explicit small-screen behavior, not a blanket auto-open.

### B657 — Terminology & consistency pass `[App-wide / UI]` (task) #ui  *(owner brief 2026-07-05, arrived as "NEW-6"; minted **B657**)*
`[ ]` One sweep to make names and chrome agree across the app: **(1)** Parcel panel says "Boundary tool (right rail)" but the rail says "Parcel" (residual of B570's Boundary→Parcel rename); **(2)** visible "Detention Pond" vs accessibility label "Detention Basin" vs Yield legend "Detention" — pick one term; **(3)** breadcrumb flips Map (Site) ↔ Dashboard (other tabs) and Concept vanishes off-Site; **(4)** File menu leads with "Export JSON" — say "Export project file"; **(5)** three palettes across tabs (orange Site, purple Schedule, teal Review/Library) — converge on one design language.
- Verify: sandbox
- Origin: filed 2026-07-05 from chat
- ⚠ Item (5) must respect the KEY DECISIONS module accents (`--accent-review` #EF9F27, `--accent-library` #0E7490, `MODULE_ACCENT` in `src/shared/ui/moduleAccent.js`): "converge" = one coherent design language (typography, spacing, control anatomy, shared tokens), NOT deleting the deliberate per-module accents without an owner decision. The contrast audit (`ui-audit/contrast-audit.mjs`) gates any palette change.

### B650 — Per-project standard folder tree, user-editable in-app, with continuous one-way sync to Google Drive `[Doc Review / Library / storage · drive-integration / persistence]` (feature — umbrella, multi-phase)  *(owner brief 2026-07-04, arrived as "NEW-1"; first filed **B645**, RENUMBERED to **B650** on merge-in of `origin/main` — PR #493 took B645–B649 for the backlog-infra + persistence-epic batch; **B650** = highest real B# across both files (B649) + 1. The code/tests/branch keep the same feature but all self-references were bumped B645→B650. Branch `claude/planyr-folder-drive-sync-0k8h0t`. Deduped against the Drive / storage-adapter / auto-filing / file-index cluster — this FOLDS INTO the existing storage adapter + Supabase file-index rather than adding a parallel one; see the **Dedup** note.)*
`[ ]` Give every Planyr project a standard folder tree the user can edit in-app (**add / rename / move / delete** folders), and mirror that structure **continuously** into the user's Google Drive so the two never drift. **Planyr is the source of truth (authoritative); Drive is a live mirror that follows every structural change.**
> **✅ CODE SHIPPED this session (branch `claude/planyr-folder-drive-sync-0k8h0t`) — lint 0 · 2,484 tests (53 new) · build green · logged-out E2E smoke passing; hardened by an adversarial code review (10 findings found + all fixed: a React remount that broke inline rename, a false-"empty" delete confirmation, a dropped move-under-a-same-pass-create, a create-persist-failure duplicate, a double-seed race, drive_* column-lock, dup-name validation). REMAINING = the signed-in + live-Drive click-through only → `VERIFICATION.md` V208 (scaffold/template/independence) + V209 (sync-in-place + delete-safety); the owner ran `project_folders.sql` 2026-07-05 (schema verified live in prod — table, RLS ×4, unique index, guard trigger, SECURITY DEFINER RPC all present).** **⚠ Recurrence 2026-07-05 (×1, owner screenshot):** the FIRST real seed hit a live **502** — the one-request mirror died mid-flight at 65/133 folders. Root-caused + FIXED same session as part of **B659** (chunked resumable sync + honest error + progress); see that item. What shipped, end-to-end:
> - **Data model:** `src/workspaces/doc-review/db/project_folders.sql` (own-row RLS; structure columns client-written, `drive_*` mirror columns server-written — disjoint, no conflict).
> - **Canonical template + pure tree logic:** `src/shared/folders/folderTemplate.js` (the exact 133-folder tree) + `folderTree.js` (flatten / treeify / validate / move-cycle guard / `buildSeedRows`).
> - **Client store:** `src/workspaces/library/lib/folders.js` — reads/writes the tree in Supabase (instant, authoritative), idempotent template seed, debounced Drive-sync trigger, graceful signed-out/Drive-off skips.
> - **UI:** `src/workspaces/library/components/FolderTree.jsx` (add / **inline** rename / move / delete + the **enumerated** delete-safety modal + Drive-mirror status), mounted behind a Files/**Folders** tab in `Library.jsx`.
> - **Server mirror (one-way, by stored Drive id):** pure planner `server/storage/folderReconcile.js` + executor `server/storage/folderMirror.js` + REST store `server/storage/folderStoreSupabase.js` + route `functions/api/folders.js`; new `driveClient.createSubfolder` (eager empty folders) + `trash` (recoverable delete). Gated 503 when Drive is off (tree still lives in Supabase — no regression).
> - **Scaffolding hook:** `SitePlannerApp.newSiteFromMap` seeds + syncs on project creation (dynamic import, off the planner chunk); the Folders tab also lazy-seeds on first open (covers blank-then-edited projects).
> - **Delete safety:** non-empty delete → `plan-delete` enumerates the exact Drive folders + files → confirm → soft-delete rows → mirror moves them to **Drive trash** (recoverable ~30 days), never a silent/permanent wipe.
- **Model — Supabase authoritative, Drive mirrors (REUSE, don't parallelize):**
  - Each project's folder tree lives in **Supabase Postgres as the project's folder index** — the SAME index auto-filing queries against for file facts. Scaffolding, file-drop routing, and structure sync share this one model. Attach it to the existing library index (`doc-review/db/project_library.sql` / `file_facts.sql`), keyed on the project = the Site Planner site-group (`project_id` = `sites.group_id`); a new `project_folders` table (own-row RLS, same pattern as `drive_files.sql`) holds one row per folder with its parent, name, order, and **Drive folder id**. Do NOT spin up a parallel structure.
  - Drive holds a **mirror** of that structure. **Reject the lazy/virtual-only approach** where Drive folders materialize only when a file first lands in them: an empty folder created in Planyr must appear as an **empty folder in Drive, immediately.** ⚠ This is a real CHANGE to today's Drive backend, which is **path-keyed + lazy** — `server/storage/backends/driveBackend.js` / `driveClient.js` currently ensure a folder only when a file is put into it, via `client.folderId(folderPath)`. The new work adds **eager folder creation** + **id-keyed reconcile** on top of that same client (below).
  - Sync direction is **one-way, Planyr → Drive.** Watching Drive for external changes and pulling them back is **out of scope.**
- **Scaffolding on project creation:** when a user creates a project, seed it from **one canonical default template** (below) — auto-create the full empty folder skeleton. Each new project is an **independent copy**: editing it later never touches the template or any other project. Editing the template itself applies to **new projects only** and must **never retroactively restructure existing projects** (same non-silent-mutation discipline used elsewhere — a template edit silently rearranging live projects is the exact failure to avoid).
- **Continuous sync — every structural change reconciles to Drive:** create, rename, move/reparent, and delete of any folder propagates to the Drive mirror.
  - **Store each folder's Drive folder id in the Supabase index and reconcile BY ID, never by path/name.** Rename and move must act on the **existing Drive folder in place** (`driveClient.update(fileId, { addParents, removeParents, name })` — the Drive client already exposes exactly this). ⚠ Path-matching creates a NEW folder and orphans the old one on every rename — **do not do this.**
  - All mirrored folders are **app-created**, so this stays within the existing **`drive.file` OAuth scope** (Planyr can only see/touch the files+folders it created — confirmed in `server/storage/README.md`: "the app makes its own `Planyr/…` folder tree"). No broader Drive permission is needed.
- **Delete safety (decision made — crash-severity leg):** deleting a Planyr folder that already has synced files removes **real user documents from Drive** — a silent-data-loss risk, the highest-severity bug class. Required behavior:
  - Non-empty deletes are allowed, but only behind a **loud, explicit confirmation that enumerates exactly what will be removed from Drive** — list the files and subfolders that will disappear, so the user never blindly confirms. **Never mirror a destructive delete silently.**
  - **Recommended extra guard (owner to confirm):** mirror the delete as a **move to Drive's trash** (recoverable ~30 days) rather than a permanent delete, so a mistaken confirmation is still recoverable. Confirm **trash vs. hard-delete** with the owner before shipping the delete path.
- **Default template content (finalized — ship EXACTLY this):**
  - Top level, **12 categories** numbered `01.`–`12.`: `01. Hillwood` / `02. Design` / `03. Sustainability` / `04. Governmental` / `05. General Contractor` / `06. Insurance` / `07. Financing` / `08. Land` / `09. Testing Contractor` / `10. Utilities` / `11. Close-Out` / `12. Bldg Acq`.
  - **Subfolders:**
    - **01. Hillwood:** `01. Correspondence` / `02. Project Directory & Invoices` / `03. Development Schedule` / `04. Outline Specifications` / `05. Pursuit Budgets` / `06. Development Budgets` / `07. Financial Models` / `08. Media` / `09. Development Checklist` / `10. DPO - Investment Summary` / `11. Purchase & Sale Agreements` / `12. Ground Lease` / `13. Entity Docs - SPE` / `14. Joint Venture` / `15. Photos` / `16. Legal` / `17. Market Research` / `18. Marketing` / `19. Approvals` / `20. Financing`
    - **02. Design:** `01. Drawings` / `02. Specifications` / `03. Contracts` / `04. Reports & Studies` / `05. Correspondence` / `06. Invoices`
      - **02. Design → 01. Drawings** holds **9 discipline subfolders:** `01. Exhibits` / `02. Site Plans` / `03. Architectural` / `04. Structural` / `05. Civil` / `06. Landscape` / `07. Mechanical` / `08. Electrical` / `09. Plumbing`. **Each of the 9 contains `01. Current` and `02. Archive`.** (`02. Specifications` is a **sibling** of `01. Drawings`, NOT nested inside it.)
    - **03. Sustainability:** `01. Correspondence` / `02. Contracts` / `03. Scorecards & Budgets` / `04. LEED`
    - **04. Governmental:** `01. Correspondence` / `02. Permits` / `03. Zoning` / `04. DRC Meeting` / `05. Economic Development` / `06. Impact Fees` / `07. Ordinances` / `08. Development Agreement` / `09. Energy Code - COMcheck` / `10. Fire Department` / `11. OpEx` / `12. Taxes - Incentives`
    - **05. General Contractor:** `01. Correspondence` / `02. Preliminary Pricing` / `03. Bids` / `04. Contracts & Change Orders` / `05. Pay Apps & Invoices` / `06. Meeting Minutes` / `07. Schedules` / `08. Safety` / `09. Submittals` / `10. Monthly Reports` / `11. Weather Logs`
    - **06. Insurance:** `01. Builders Risk` / `02. Certs of Insurance` / `03. Factory Mutual`
    - **07. Financing:** `01. Correspondence` / `02. Lender's Inspector` / `03. Draw Requests` / `04. Tax Certs` / `05. Appraisals` / `06. Loan Closing Checklist` / `07. Alternative Financing`
    - **08. Land:** `01. Seller Due Diligence` / `02. CCRs - Park Assoc` / `03. Closing Stmts` / `04. Geotech Rpt` / `05. Environmental` / `06. Wetland - Stream` / `07. Flood Plain - FEMA` / `08. Survey & Legal Descriptions` / `09. Plat & Easements` / `10. Special Warranty Deed` / `11. Title Rev - Commitment` / `12. Ag Lease` / `13. Labor Study`
    - **09. Testing Contractor:** `01. Contract` / `02. Reports`
    - **10. Utilities:** `01. Correspondence` / `02. Electric` / `03. Gas` / `04. Water` / `05. Sewer` / `06. Telecom`
    - **11. Close-Out:** `01. Proj Team` / `02. Permits` / `03. Inspections - Acceptance Ltrs` / `04. Documents` / `05. Arch - Civil - Struc - MEP` / `06. Construction` / `07. Warranties` / `08. O&M Info` / `09. Prop Mgmt Support Docs` / `10. Lessons Learned`
    - **12. Bldg Acq:** ship as an **empty top-level category** (no subfolders defined).
- **Naming conventions (every level):**
  - **Zero-padded two-digit prefix + period + space** (`01. ` … `20. `). Padding is **required, not cosmetic:** clients that sort names as plain text (Drive web, mobile) would otherwise order them `1, 10, 11, … 2, 3`. Padding keeps numeric order correct everywhere.
  - **`01. Current` / `02. Archive`** — deliberately NOT "superseded" ("superseded" is the AEC term for a drawing replaced by a newer revision; too much jargon for general users). Numbered so **Current sorts above Archive.**
- **Ship scope / known gaps — do NOT block on these:** ship exactly the folders above. Three categories were only partly visible in source and ship **intentionally short, left user-extensible:** **Land** (14–18 unknown → ship 01–13), **Close-Out** (11 unknown → ship 01–10), **Bldg Acq** (contents unknown → ship empty).
- **Verification (two paths — auth-only/live-Drive, so NOT sandbox-verifiable → own `V###` entries):**
  1. **Scaffolding + template + per-project independence:** create a project → confirm the full tree materializes in **both** Planyr and Drive; edit one project's tree → confirm the template and other projects stay untouched.
  2. **Continuous sync + delete safety:** rename / move / delete folders in Planyr → confirm Drive mirrors each **in place** (renames don't orphan or duplicate); confirm a non-empty delete triggers the **enumerated confirmation** and (if adopted) lands in **Drive trash.** Live-Drive behavior — verify against a **real connected Drive account**, not the sandbox.
- **Dependencies:** builds on the in-progress Google Drive storage-adapter + Supabase file-index work. **Locate and REUSE the existing storage adapter rather than adding a parallel one.**

> **Dedup (checked against both BACKLOG files + roadmap + code — NO true duplicate exists; overlaps folded in / flagged below):**
> - **⚠ B180 — Project Files repository / saved-views tagged index (Library tab) — PRIMARY DESIGN TENSION, an owner-level product reversal, do NOT silently override.** B180 deliberately decrees *"folders are saved views over a tagged index, **never** a hand-maintained tree"* and has **no Drive mirror.** This item introduces exactly the opposite mechanism: a **user-editable literal folder tree** — but as the **physical Drive filing structure** (the canonical directory layout the user's documents actually live in on Drive), NOT the in-app browse metaphor. **This brief (owner, 2026-07-04) is itself the decision that partly reverses B180's "queries-not-trees" stance for the physical filing taxonomy;** B180's saved views survive as the **in-app query/browse layer** on top. Surface the reversal **explicitly** to the implementer — reuse the Library surface + `fileFacts` index as the host, don't build a parallel browser and don't quietly contradict B180.
> - **B14 — shipped per-project explorer (browseable Project Library)** — EVOLVE, don't duplicate. B14 shipped a per-project explorer whose "folders" are a **FIXED discipline set** (Survey / Civil / Architectural / …) over Supabase-Storage paths, no user-editing, no Drive mirror. This item **generalizes** B14's fixed folders into an **arbitrary user-editable tree** and adds the Drive-mirror leg — reference B14 as the existing explorer this grows from.
> - **B206 / storage adapter + B207 Drive backend** (`server/storage/adapter.js`, `backends/driveBackend.js`, `backends/driveClient.js`, `functions/api/files.js`) — REUSE + EXTEND, don't fork. B206's rule: the app references files ONLY by opaque Planyr keys and is given zero Drive-folder-path awareness. The adapter already models a Planyr "folder" concept (`save/list/move` take a `folder`) and the Drive client already ensures folders (`folderId(path)`) + moves/renames **in place** (`update(...)`). Today that is **path-keyed + lazy**; this item adds a **Drive-folder-mirror layer** — **eager empty-folder creation** + **id-keyed reconcile** (persist each folder's Drive id) — on the SAME client. Do NOT build a second Drive client.
> - **B181 — file-facts index** (`src/shared/placement/placementFacts.js`; `doc-review/db/file_facts.sql`, `file_facts_category.sql`, `project_library.sql`; `server/storage/db/drive_files.sql`) — REUSE, don't fork. The folder index is a NEW table (own-row RLS, `drive_files.sql` pattern) inside THIS index; the item's own model ("the same index auto-filing queries against") says so.
> - **B273 — filing-workflow router (read title block → propose project / discipline / destination)** — FOLD-IN target. Today it auto-generates a `project-<id>/<discipline>` tree; define the standard user-editable tree, then point B273's router at it. Merge the filing logic, don't duplicate it. (`doc-review/lib/autofiling.js`; Tier-1 **B312** live, Tier-2 AI **B299**.)
> - **B411 — auto-filing residual gaps** — CROSS-REFERENCE: a synced folder tree consumes the same auto-filing decisions, so keep them merged; note its flagged **Drive-connector 10 MB download cap** as a real constraint on syncing large sets.
> - **B409 — large-file resumable Drive upload** (`reviewStore.uploadLargeToDrive`, `functions/api/files/resumable.js`) — REUSE the uploader/adapter, don't build a second one. It's the Drive WRITE path already writing into the live `project-<id>/<discipline>` Drive tree; the mirror's folder creation/writes go through this exact adapter + B207's `driveClient`.
> - **Library workspace** (`src/workspaces/library/` — `Library.jsx`, `FileBrowser.jsx`; **B496**) — the in-app **folder editor** (add/rename/move/delete) surfaces HERE (the one and only file browser since the Site Planner `ProjectFilesDrawer` was retired, **B542**). Today's flat path scheme `<uid>/project-<id>/<discipline>/<srcId>.pdf` becomes the deep canonical tree.
> - **B629 — Drive-backed county parcel snapshot cache** — CROSS-REFERENCE only (different feature: county parcel data in a SHARED service Drive, not the user's own per-project tree). REUSE only its proven Drive-folder write/sync mechanics — **same Google OAuth creds + shared-folder pattern + `drive.file` scope, no new secret** (`GOOGLE_CLIENT_ID/SECRET/REFRESH_TOKEN`; ⛔ do NOT re-mint the refresh token).
> - **B371 — GIS screening cache Phase 2 (regional snapshot)** — WEAK prior-art only: the "keep a synced copy on a schedule" pattern over layer data, not user files. No functional overlap.

### B648 — Persistence & Sync epic: one umbrella + a canonical write-path doc `[Site Planner / Persistence]` (epic — standing umbrella) #persistence  *(chat "NEW-4" 2026-07-04; minted **B648** — RENUMBERED from a provisional **B639** on merge-in of `origin/main`, which took B636–B644 for the Detention-engine batch; the scripts/tests/build.yml/CLAUDE-rule labels for this cluster keep the provisional B636–B640; branch `claude/backlog-infra-verify-gates-xsdxsi`)*
`[~]` **Umbrella grouping the smeared save/sync history so it's workable as one theme.** The concrete deliverable — **`docs/PERSISTENCE.md`** (a table of EVERY write path + the invariants every path must satisfy, built AUDIT-FIRST from current code) — shipped this session. Members remain individually workable; this umbrella stays Open as long as any member is open.
- Verify: live  *(the write-path behaviours are the LIVE-VERIFY concurrency / multi-writer class; the DOC itself is sandbox-verified, but any code change to a member path needs the per-member live check.)*
- Origin: filed 2026-07-04 from chat
- **Members** (each gains a `Part of: B648` line): B124, B125, B126, B134, B276, B314, B595, B596, B612.
- **AUDIT-FIRST discrepancies flagged (also recorded in `docs/PERSISTENCE.md`):**
  - (a) the chat brief cited **B127** as a persistence member — B127 is actually the *"measure-type dropdown renders behind/clipped by the rail"* **UI** bug, **not** persistence; excluded from the epic.
  - (b) the brief named two recent truck-court items ("tombstone cascade" + "in-tab write-write race") — the tombstone-cascade item is **B612**; there is **no separately-filed "in-tab write-write race" B#** — that symptom (the false *"changed in another session"* loop) is **B612's own other half**, tied to **B314** (reject stale saves / optimistic concurrency) + **B595** (count-only read-back blind to a same-count drop). Recorded as reality rather than minted as a phantom number.
- **Triage rule:** every new save/sync bug files as a member of B648 and must name the invariant (**I1–I4** in `docs/PERSISTENCE.md`) it violates. If none fits, the invariant list is incomplete → amend `docs/PERSISTENCE.md` first, then file.

### B629 — Drive-backed county PARCEL snapshot cache so outages stop breaking the map `[Site Planner / GIS]` (feature — multi-phase) #site-planner #gis #drive  *(owner-requested 2026-07-03 — "I keep having this [Chambers GIS down] issue … cache a copy of the entire Chambers County CAD and just update it … same for Fort Bend … we've got a Google Drive with 32 gigs"; scope refined to "all except Harris" → Chambers + Waller + Fort Bend. Minted **B629** = highest real B# across both files (B628) + 1; plan `/root/.claude/plans/okay-um-i-mean-elegant-haven.md`; branch `claude/chambers-county-gis-down-ttqfnv`.)*
`[ ]` **Phase 1 TURNED ON — all three snapshots built, uploaded to Drive, and served by `/api/parcel-cache`.** Only the **V199 live click-through** (real browser on planyr.io) remains before this moves to Done. A lot draws + selects from Planyr's saved copy even with the county server 100% down.
- **UPDATE 2026-07-04 (turn-on + Waller pagination fix):** triggered the nightly builder (`workflow_dispatch`) — Fort Bend **385,212** · Chambers **38,293** · Waller **48,740** now live on the endpoint (`/api/parcel-cache/svc/<county>?meta=1` → `cached:true`). Fixing a Waller undercount (26k vs the true ~48.7k) exposed a real paging bug in the county-poly POST leg: the loop broke on the first `batch.length < PAGE` short page, so a transient mid-pull page under 2000 rows ended the pull early and dropped ~half the county. `pageProvider` now pages by the server's OWN `exceededTransferLimit` flag and advances the offset by the rows **actually** returned — so a short page no longer stops it. +3 regression tests (`parcelSnapshotBuilder.test.js`) replaying the exact short-page scenario; full Waller dry-run confirms 48,740. (`pageProvider` made fetch-injectable for the test.)
- **UPDATE 2026-07-04 (B661 — first labeled B650, then B658, renumbered on collisions):** the Chambers/Waller source is fixed. The state parcel `/query` went dark on BOTH hosts (feature.tnris.org 503 · feature.geographic.texas.gov 400 "operation not supported" — the B627 outage), so the builder now pulls from the **AGO-hosted StratMap 2025 FeatureServer** (query-enabled, independent host), scoped by the **county polygon** (that layer has no county field). Verified live: Chambers 38,293 · Waller 48,741 · Fort Bend on FBCAD unchanged. Source-resilient (ordered candidate list + keep-last-good); TxGIO /query kept as a preferred-when-healthy fallback.
- **Why:** Chambers + Waller ride the flaky State/TxGIO service (its `/query` keeps going down — B627); Fort Bend is reliable-source insurance. Measured sizes (compressed): Chambers ~5–10 MB · Waller ~5 MB · Fort Bend ~76 MB → ~0.3% of the 32 GB Drive. Harris (1.55 M parcels / ~600 MB) is EXCLUDED (too big for the browser).
- **Architecture (reuses, not parallel systems):** a nightly builder writes a per-county snapshot to a shared `Planyr/parcelcache` Drive folder (same creds + shared-folder pattern as the B445 imagery cache; no new secret, no per-user auth); a read-through Pages Function `functions/api/parcel-cache` serves it (404-on-miss → client falls back to live); the client loads it into IndexedDB (B474) and feeds it into the EXISTING `optimisticHitAt`/`outerRingsLngLat` click path + a magenta `L.geoJSON` display layer, so no new click logic. Small counties (Chambers/Waller) load whole; Fort Bend is tiled (**Phase 2**, not yet wired).
- **Shipped + verified this session (Phase 1a):** `functions/api/parcel-cache/{[[path]],_handler}.js` (serve; 14 tests) · `lib/parcelSnapshot.js` (client loader + IndexedDB SWR; 13 tests) · `shared/gis/parcelSnapshotBuild.js` (pure strip+quantize transform; 7 tests) · `lib/parcelDisplay.js` `makeSnapshotLayer` · `MapFinder.jsx` wiring (warm on select-mode, snapshot display layer, promote-a-cached-hit when live returns nothing, "Cached copy · as of <date>" badge + banner) · `counties.js` (new **Waller** entry + `SNAPSHOT_COUNTIES`) · `scripts/build-parcel-snapshot.mjs` (builder — **dry-run proven against LIVE FBCAD**: 2000 parcels → strip/quantize → 0.3 MB gz) · `.github/workflows/parcel-snapshot.yml` (nightly cron + @claude-issue-on-failure). lint 0 · 2275 tests · build green. Safe/inert: `ensureSnapshot` just 404s until a snapshot exists → identical to today.
- **REMAINING to go live (Phase 1b):** ~~(1) OWNER adds the Drive secrets~~ **DONE** (Cowork 2026-07-04) · ~~(2) confirm the Chambers/Waller source~~ **DONE** (B661 → AGO StratMap; first labeled B650, renumbered on collisions) · ~~(3) trigger the workflow to seed the snapshots~~ **DONE** (all three live on the endpoint). **Only (4) the live in-browser click-through = `V199` remains** (needs a real browser — Cowork's job).
- **Phase 2 (deferred, additive):** Fort Bend z12 tile pyramid (`featuresForView`/`featureAtPoint` tile backing + the builder tiling leg + the `markDown` outage-swap). The Phase-1 loader interface is tile-agnostic.

> **B630–B633 (Cowork brief 2026-07-03, NEW-1..4 — the JACINTOPORT "⚠ Not aligned" wall)
> shipped this session; full blocks archived in `BACKLOG-DONE.md`.** In short: a non-tileable,
> scale-less set no longer shows the align gate (B630 reference-set classifier + steer), NOT-TO-SCALE
> sheets drop the align nag (B631), the overlay is clamped so it can't blanket a sheet at low zoom
> (B632), and duplicate placed sheets are de-duped on add + on load (B633, 14→8 on the owner's set).
> Signed-in re-persist verification → **V200**. Branch `claude/stitch-not-aligned-overlay-s2wbdx`.

### B553 — Surface drawn landscaping in the yield breakdown (own line, kept pervious) `[Site Planner / yield]` (enhancement — product call) #site-planner #yield  *(found 2026-06-27 by the round-12 deep yield audit; minted **B553** = highest real B# (B552) + 1)*
`[?]` **The deep yield/metrics audit (area/coverage/parking/impervious/detention/units) came back CLEAN — no wrong numbers.** The one judgment call: `landscape` elements (green buffer strips, `SitePlanner.jsx` yield loop ~L4602-4630) are NOT in the metric loop, so they fall into the "open/green" leftover and aren't broken out. This is **correct for the math** (landscaping is pervious → rightly excluded from impervious/coverage; rightly part of open/green), so it is NOT a wrong number — it's a **presentation choice**. **Owner question (in OWNER-TODO):** break landscaping out as its own "Landscaped SF" line (keep it pervious)? Default = leave as-is (numbers already correct).
- **⚠ Do NOT** apply the round-12 hunt's first-pass "count landscape as impervious" idea — landscaping is pervious; that would overstate impervious % and distort detention sizing (a wrong number where there isn't one today).
- **If owner picks "break it out":** small additive change — add a `landArea` accumulator in the yield loop (`e.type === "landscape"`), show it as a pervious line in the composition breakdown; impervious/coverage/detention formulas UNCHANGED. No persistence migration.

### B499 — Harden the LOAD-time self-heal for the OTHER bonded children (sidewalk / dock-zone stack / side-parking) `[Site Planner / Site Model]` (task — hardening) #site-planner #persistence  *(spun out of the B498 sweep 2026-06-27; minted **B499**)*
`[ ]` B498 made `createSiteModel` re-flush `dogEar` children to the host's current edge on load. The same stale-edge class could in principle affect the other bonded children if a host is ever resized by a path that skips the live `refitChildren` re-anchor — but **no stale record has been observed** for these (the Jacintoport truck court re-anchored correctly), so this is hardening, not a confirmed live bug.
- **Why deferred (real blocker — would risk load-time churn on CORRECT records):** unlike dog-ears (whose `dogEarGeom` IS the placement fn, so re-deriving a correct bump yields itself → provably idempotent), the others aren't placed by a single pure function. A sidewalk's stored box is the product of `fitKid` ratio-scaling + sibling pushes + `perpGap` + `sidewalkFullRunPatch`; a dock-zone's of `layoutZoneByKind` + stored `zd` depths + `courtOpts`. Re-running only the pure helper on load could rewrite a correctly-placed element (sub-foot churn → dirty flag, cloud re-saves, possible visible shift) on every load. Shipping safely needs an idempotency proof across the existing record corpus. **Side-parking** is worse: its live `fitKid` ratio-scales from an OLD-host snapshot that doesn't exist on disk, and there's no pure full-run helper — a model-layer re-anchor would mean porting the stateful wall-kid + rotated-stall layout. Too large to land safely this run.
- **Plan when picked up:** lift `sidewalkFullRunPatch`+`sidewalkSpanForBumps` and `dockZones.layoutZoneByKind`/`relayoutSide` into pure modules the model imports (like `dogEar.js`); add a wall-strip + `normalizeDockZones` pass after the dog-ear re-flush; write idempotency tests that widen a host on-disk-only and assert each child re-flushes flush AND that a correct record returns unchanged (object identity). Add a pure `parkingRowFullRunPatch` (mirror of `sidewalkFullRunPatch`) to fold side-parking into the same pass.

### B495 — Schedule module: instant first paint (stale-while-revalidate local cache) `[Scheduler / perf]` (enhancement, follow-on to B494) #scheduler #perf #persistence  *(surfaced fixing B494 2026-06-27; minted **B495** — renumbered from a provisional B494 after a concurrent `main` took B493 for the cross-module-link feature)*
`[ ]` The embedded scheduler's boot does `await window.storage.get("hs-v1")` — a pure Supabase round-trip with NO local cache (`public/sequence/index.html`) — and `data` stays null (so the shell loader shows) until it resolves. B494 made the loader's READY signal reliable + bounded, but the genuine first-load still waits on that network call. Stale-while-revalidate would make repeat loads near-instant: cache the last-loaded `hs-v1` in localStorage (write it on every successful `get`/`set`), paint from it synchronously on boot so `data` is available immediately, then reconcile against the authoritative cloud read. **Care required (why deferred):** the scheduler has load-bearing concurrency/version guards (`__rev`/`knownRev`/stale-block) and a documented two-tab-fight sensitivity, and it's under active concurrent development — only replace the local view with the cloud read when the user hasn't edited yet (guard the reconcile), and verify it can't lose an in-progress edit or confuse the save guard. Own focused pass.

### B483 — A 100%-full localStorage boots the app signed-out (auth-token refresh write fails) `[Auth / Storage]` (bug — hardening; low real-world risk post-B474) #auth #persistence  *(Cowork signed-in verification 2026-06-26, "NEW-4"; minted **B483** = highest real B# (B482) + 1)*
`[ ]` **Repro:** fill localStorage to a literal ~100% (Cowork's snippet B + a fine-grained top-up), then reload → the app boots **signed-out** (header "Sign in", empty site list) because Supabase's session-token refresh can't write to a full localStorage. Self-heals once space is freed; data intact.
- **Why low real-world risk now:** B474 moved the heavy rasters off localStorage into IndexedDB, so in real use localStorage sits ~700 KB even with big images — a literal 100%-full localStorage is essentially only reachable by an artificial fill. B473's amber "saved to your account" path itself behaved correctly throughout.
- **Fix (when picked up):** ensure a device-full condition can't drop the auth session — e.g. proactively evict our own large caches (gis cache / history mirror) on a QuotaExceededError to keep headroom for the Supabase auth write, or keep the session in memory so a failed localStorage refresh-write doesn't sign the user out. Deferred (edge + self-healing + low real-world likelihood post-B474); filed for the record.

### B484 — Renderer freezes (~30 s main-thread stalls): PDF title-block reading, heavy map/parcel ops, and panel/rail scrolling (×2) `[Doc Review + Site Planner / perf]` (task — perf) #doc-review #site-planner #perf  *(Cowork signed-in verification 2026-06-26, "NEW-5"; minted **B484**)*
`[ ]` **Observed:** repeated multi-second tab-unresponsive stalls while the Review module reads a dropped PDF's title block on import, and during statewide-parcel selection / map zoom over a new area. Didn't fail a test, but it's a real responsiveness issue (and slowed the signed-in pass).
- Verify: live
- Recurrence: 2026-07-05 — owner repro (chat "NEW-7", DEDUPE-FIRST fold — same ~30 s unpaintable-page symptom, same module): on a **nearly empty plan**, repeatedly scrolling the left panel or right rail intermittently blocks the renderer (page unpaintable 30 s+, DOM still responsive) — hit ~3× in 20 min in Chrome. **New trigger class:** no PDF intake or heavy parcel op in flight, so this points at **scroll-tied paint/layout work (scroll handlers)** — profile that path specifically; it may be a distinct cause sharing the symptom (keep under this ID unless profiling proves otherwise, then spin off with a cross-ref).
- **Cause:** the vector title-block read (pdf.js `extractPageText`/`extractPageItems` + the pure parsers) runs on the MAIN thread on import (OCR for scanned sheets is already in a worker — B352 — but the vector-text path isn't); heavy parcel geometry/render also blocks.
- **Fix (when picked up):** move the PDF title-block read + heavy geometry off the main thread (Web Worker / chunked yielding) per the CLAUDE.md "heavy work off the main thread" rule, so the tab stays responsive during PDF intake and parcel loads. Larger task — deferred, filed.
- **Partial mitigation shipped (B664, 2026-07-05):** the Review rail's sheet scan now reads the ON-SCREEN page first then spirals outward (the label you're looking at fills in immediately on a 50-page set) and yields a macrotask between pages (no long main-thread hog during intake). Remaining when picked up: the Worker offload above + pre-rasterising ADJACENT sheets so a rail jump swaps instantly (the owner's "improve overall speed" ask, 2026-07-05 — the switch currently shows the dimmed previous sheet + an "Opening…" chip until the new raster lands, B660).

### B474 — Move the Site Planner on-device cache off the 5 MB localStorage cap onto IndexedDB `[Site Planner / Persistence]` (enhancement) #site-planner #persistence  *(spun out of B473 Shipment 2, 2026-06-25; owner: "do the best long-term solution now")*
`[~]` Give the on-device cache **gigabytes (IndexedDB)** instead of localStorage's hard ~5 MB. Data-safety is already fixed (B473 Shipment 1: cloud authoritative + dead-store purge + history byte-cap + raster-shed), so this is future-proofing — done carefully, NOT a drop-in swap.
- **`[x]` Stage A (SHIPPED) — version-history ring → IndexedDB.** The biggest local store (~1.6 MB) and the SAFE one (a one-way backup, never read for cross-tab coordination). New `lib/localDb.js` (promisified IndexedDB kv; no-ops when IndexedDB is unavailable). In `storage.js` the ring is an in-memory cache (`historyMem`, the synchronous source of truth) written through to IndexedDB (uncapped → undo depth no longer byte-throttled) + a byte-capped localStorage fallback; `initHistoryStore()` (called from `SitePlannerApp`) hydrates + merges + one-time-migrates the old localStorage ring. Public API unchanged + synchronous (`snapshotVersion`/`listVersions`/`getVersion`/`backupNow`). IndexedDB-ABSENT path is byte-for-byte the old behavior — the 1565 existing tests prove it. +6 unit tests (`test/historyIdb.test.js`, fake-indexeddb) · lint 0 · **1571 tests** · build green · headless **V139** (`ui-audit/verify-b474-history-idb.mjs`, 7/7: ring lands in IndexedDB + survives reload).
- **`[~]` Stage B — heavy RASTERS → IndexedDB (the actual cap pressure), NOT the cross-tab-coordinated map.** Investigation (2026-06-26) found the literal sites map is tiny (geometry, kilobytes) and bound to the two-window guard; the thing that fills the cap is the attached IMAGES. So the safe path moves rasters to IndexedDB and leaves the small map + its guard untouched.
  - **`[x]` Underlay raster → IndexedDB (SHIPPED).** Stashed on drop (`idbPut("raster:<siteId>:underlay", …)` in `onUnderlayFile`); the persisted record drops the heavy data-URL `src` via `dropIdbBackedSrc` in `writeSites` (proactive off-cap, conditional on an `idbKey` so non-backed rasters keep `src` — safe), rehydrated on load by a new effect in `SitePlanner.jsx`. Fixes the ONE raster with no recovery path (it used to need a re-drop after a strip). +2 unit tests (`saveFallbackCloud.test.js`) · lint 0 · **1573 tests** · build green · headless **V141** (`ui-audit/verify-b474-underlay-idb.mjs`, 7/7: stash → off-cap record → rehydrate after reload).
  - **`[x]` sheetOverlays / parcelDrawings → IndexedDB (SHIPPED).** Stashed on creation (`addOverlayFile` / `addDrawingFromRaster`, keyed `raster:<siteId>:overlay|drawing:<id>`); the rehydrate effects now try **IndexedDB first** (fast, offline) and fall back to cloud Storage (cross-device); `dropIdbBackedSrc` slims them off the cap on persist. +1 unit test; headless **V142** (`ui-audit/verify-b474-overlay-idb.mjs`, 7/7 — overlay stash → off-cap record → rehydrate after reload). Drawings share the identical pattern (storage unit-tested; same rehydrate code, parcel-attach path).
  - **`[ ]` The live sites-MAP itself stays on localStorage (deferred).** Its two-window guard (B127/B314) needs synchronous cross-tab visibility + the `storage`-event merge; moving it = a BroadcastChannel rebuild (`src/shared/presence/` — the editor lock already serializes editing) + two-window/signed-in testing. Not worth the risk now that the cap is non-binding — **owner agreed**. Cloud (Supabase) stays the single source of truth.

### B479 — Persistence "state-of-the-art" perf refactors (the deferred tail of the B485 review) `[Site Planner / Persistence]` (enhancement/perf) #site-planner #persistence #perf  *(spun out of the B485 adversarial review, 2026-06-26; renumbered **B478→B479** on merge — a concurrent `main` (#368) took B478 for the resume-into-planner fix; these are the findings the verifiers marked fixNow=false — real but larger/riskier than a same-session patch, NOT data-loss. B485 shipped all the data-loss + honesty fixes.)*
`[ ]` Quality/perf upgrades to the IndexedDB persistence layer. None is a correctness bug; each is a worthwhile optimization once it can be done carefully (its own branch + verification).
- **`[ ]` Per-site IndexedDB history keys, not one full-ring blob (#25/#28).** `writeHistoryAll` JSON-serializes the ENTIRE multi-site version ring to a single IndexedDB key on every snapshot (O(all history) per save). Move to per-site keys (`history:<siteId>`) so each write is O(one site). Medium risk (touches the hydrate/merge/migrate path); needs the fake-indexeddb suite extended.
- **`[ ]` Store rasters as native Blobs, not base64 data-URL strings (#27).** ~33% size + memory overhead + structured-clone cost; Blobs are the idiomatic IndexedDB image store. Requires object-URL lifecycle management (create on read, `revokeObjectURL` on unmount/replace) in the rehydrate effects — the reason it's deferred.
- **`[ ]` Don't let raster rehydration re-fire the autosave/cloud-push (#29).** On reload, `setUnderlay`/`setSheetOverlays` adding `src` back triggers the autosave effect → a redundant local write (B460's contentSig already suppresses the cloud RE-push, so this is local churn, not loss). Guard rehydrate-driven setState from the edit-driven path.
- **`[ ]` Honest "space left" UI via `StorageManager.estimate()` (#34) + amber self-clear after space is freed (#33).** Today "device full" is only learned by catching QuotaExceededError after a write fails; `navigator.storage.estimate()` could show usage proactively, and the amber "saved to your account" banner could self-clear once space returns instead of waiting for the next edit/Retry.
- **`[ ]` `mergeHistory` dedup by `at`+`sig`, not `at` alone (#32/#35).** Two genuinely-different snapshots sharing one millisecond collapse to one on merge. Tiny, but doing it right also needs `getVersion` to disambiguate same-`at` rows (it currently keys on `at` only) — so it's a small paired change, not a one-liner.

### B471 — Revision compare (current vs. previous version), state-of-the-art `[Doc Review / compare]` (feature) — umbrella, IN PROGRESS #doc-review #compare  *(owner-dropped 2026-06-25 "plan that … like Procore but state of the art"; planned + approved; minted **B471** = highest real B# across both files (B470) + 1 — renumbered from a provisional B464 that a concurrent `main` took for the read-only-lockout cluster while this was in flight; plan: `/root/.claude/plans/for-document-review-if-luminous-lampson.md`)*
`[ ]` Compare two revisions of the same drawing and **see exactly what changed** — color-wash overlay
(removed one color / added another / unchanged dimmed), an auto **change-list** that finds/counts/jumps
to every change, smart **text/dimension diff** on vector PDFs, and **flattened compare-PDF export**.
Owner decisions: pick versions from BOTH the filed library (it already tracks revisions) AND ad-hoc;
color-wash is the core view (swipe/fade/side-by-side deferred); all three "beat-Procore" layers in scope.
- `[x]` **Phase-1 CORE engines — DONE this session (branch `claude/wizardly-mccarthy-oi8xl7`), 24 unit tests, lint 0, build green, lazy chunks intact.** All PURE + Node-tested; reuse-not-rewrite (registration is `overlayAlign.solveSimilarityLSQ` + `matchLineFit`). Code tagged **B471**:
  - `src/shared/files/rasterDiff.js` — 2-D dilation (tolerance), per-pixel classify (removed/added/unchanged), connected-components → navigable change regions. 10 tests incl. the 1px-jitter-must-not-flag guard.
  - `src/shared/files/rasterRegister.js` — coarse-offset (profile cross-corr, reuses `slideRefine`) + ink-bbox similarity (`solveSimilarityLSQ`) + ink-agreement confidence gate + manual 2-point fallback (`manualRegister`). 8 tests incl. honest low-confidence → manual.
  - `src/shared/files/rasterCompare.js` — pure register→resample→diff pipeline (`compareBinaries`). 6 tests incl. "a shift registers away to ~zero changes; a real addition still surfaces."
  - `src/workspaces/doc-review/lib/compareRegister.js` — browser glue (PDF render + binarize via existing `renderPageToImageData`/`binarizeImageData`), re-exports the pure core.
- `[ ]` **Phase 1 UI (NEXT):** `CompareView.jsx` (a `mode:"compare"` in DocReview) — color-wash canvas over rev A + change-list panel (click → recenter via `centerOn`) + manual-align mode; ad-hoc "Compare ▸" entry; `kind:'compare'` persistence (additive, no migration). Reuses `renderBudget`/`viewportTransform`/`MarkupRenderer`.
- `[ ]` **Phase 2:** library entry (FileBrowser "Compare revisions") + multi-sheet pairing (`comparePairing.js` via `sheetGroups`).
- `[ ]` **Phase 3:** semantic text/dimension diff (`semanticDiff.js`, vector PDFs, reuses `extractPageItems`).
- `[ ]` **Phase 4:** flattened compare-PDF export.
- `[ ]` **Phase 5 (optional):** swipe / fade+blink / side-by-side views.
- Verification ahead: `ui-audit/verify-compare.mjs` (headless, seed two PDFs via `make-sample-pdf.mjs`).

<!-- 2026-06-25: owner-dropped read-only-lockout cluster "NEW-1…NEW-7" (one chat; SUPERSEDES the earlier
     NEW-1/2/3 block in the same chat — filed from THIS block only, no double-enter). Highest real B#
     across both files was B463, so minted **B464–B470**. Per STANDING RULE #1 all seven were filed AND
     fixed the SAME session on branch `claude/exciting-wright-yb6ruz` — full [x] blocks live in
     BACKLOG-DONE.md. lint 0 · 1528 tests (+11) · build green · headless V (`ui-audit/verify-readonly-takeover.mjs`, 7/7).
     AUDITED-FIRST per the brief, and FLAGGED a contradiction: on current main (post-B458/B455) a read-only
     tab's LOCAL mirror + version snapshots run UNCONDITIONALLY (only the CLOUD push is gated), so the
     report's "snapshots froze / nothing persisted anywhere" is NOT reproducible on current main — it
     predates B458 (shipped earlier 2026-06-25, the immediate-mirror fix). The green-indicator-while-
     read-only (NEW-2) WAS reproducible in code and is fixed.
       • B464 (NEW-1) read-only tab no longer silently non-syncing — LOUD actionable banner; EXTENDS B455/B458.
       • B465 (NEW-2) headerSaveState gained a "readonly" badge state (amber lock) — never green while not saving.
       • B466 (NEW-3) editorLock.takeOver() (Web Locks steal + cross-tab bus yield) + "Take over editing here" force-push.
       • B467 (NEW-4) Restore verifies the pre-restore backup persisted + is lock-gated (a read-only tab can't Restore).
       • B468 (NEW-5) reportClientEvent → public.client_errors: readonly enter/leave/takeover, save-suppressed,
         cloud-conflict, cloud-write-failed, delete-zero-rows (tab-id stamped); EXTENDS B279, no schema change.
       • B469 (NEW-6) probeService direct-first → proxy-on-CORS-failure through the existing B445 proxy (Fort Bend).
       • B470 (NEW-7) pdf.worker Trusted Types warning — triaged benign (no enforced CSP in the repo), no code change.
     Deduped/folded, not duplicated: B464/B466 EXTEND B455 (lockout) + B458 (immediate mirror); B468 EXTENDS
     B279; B469 reuses B445; NONE is a re-file of B313/B314/B459. Three live checks (signed-in indicator
     read-only state, telemetry rows, Fort-Bend-parcel no-CORS) are logged in VERIFICATION.md for Cowork. -->

<!-- 2026-06-25: owner-dropped trio "NEW-1/NEW-2/NEW-3" (overlay right-click menu + "align to base" +
     replace the rotation slider with a numeric stepper). Highest real B# across both files was B460, so
     minted **B461 / B462 / B463**. Deduped: B463 is NOT B428 (property-set completion — that added
     stroke/fill/text controls, never a rotation control); it REUSES the B431 element NumInput+spinner
     pattern as the shared widget. B461 EXTENDS the B421 Arrange context menu (does not duplicate it) +
     reuses the B158/B127 right-click-menu+portal pattern. B462 reuses the existing align primitive
     (`overlayAlign.solveSimilarityLSQ` + the SitePlanner building→parcel `alignToParcelEdge`), not a
     second one. Distinct from B422 (named markup Layers, parked).
       • **B463 (NEW-3) — SHIPPED this session** per STANDING RULE #1; full [x] block lives in
         BACKLOG-DONE.md (branch `claude/wizardly-mccarthy-oi8xl7`). The one rotation SLIDER in the app
         (the Site Planner overlay "Rotate") is retired for a shared numeric stepper; the markup +
         element rotation NumInputs now use the same widget. lint 0 · 1517 tests (+11) · build green ·
         headless V (`ui-audit/verify-b463-rotation-stepper.mjs`, 12/12).
       • **B461 (NEW-1) + B462 (NEW-2) — SHIPPED this session** per STANDING RULE #1; full [x] blocks
         live in BACKLOG-DONE.md (branch `claude/wizardly-mccarthy-oi8xl7`). The flagged assumption
         ("'overlay' = Document Review's overlay & version-compare surface") was WRONG against the code —
         Document Review has no overlay/version-compare surface yet — so the owner was asked which surface
         and **chose the Site Planner's site-plan overlays** (`sheetOverlays`). B461 = a portalled
         right-click menu (Copy / Duplicate / Paste / Bring-to-front / Send-to-back / Lock / Align-to-base /
         Delete) on the canvas overlay + its panel row, count-verified Delete, ref-counted shared source on
         Duplicate/Paste, Ctrl+C/V/D parity. B462 = "Align to base edge" reusing the building→parcel
         `snapParallel`/`segDist` primitive (click a parcel boundary → the overlay snaps parallel to it).
         lint 0 · 1517 tests · build green · headless V (`ui-audit/verify-b461-b462-overlay-menu.mjs`, 13/13). -->

<!-- 2026-06-24: owner-dropped data-loss + deploy-hygiene batch "NEW-1…NEW-9" (one chat, tied to the
     8 South / Plan 1 building-loss that happened DURING a stale-chunk deploy crash). Highest real B#
     across both files was B448, so minted **B449–B457**. Per STANDING RULE #1 the eight CODE items
     (B449–B456) were filed AND shipped the SAME session on branch `claude/youthful-volta-ns1n75` —
     full [x] blocks live in BACKLOG-DONE.md. lint 0 · 1468 tests · build green · lazy chunks intact.
     Three brief premises were CORRECTED against real code (flagged, not silently followed): NEW-5
     (B453) boot reconciliation already union-merges → became verify+regression-test; NEW-4 (B452) the
     local flush already runs → the real gap was the keepalive CLOUD push; NEW-1 (B449) the prescribed
     `/* → index.html` catch-all would CAUSE the masking → used a no-catch-all `_redirects` (hash routing).
     Live-edge paths (Cloudflare 404, deploy-escape screen, survive-forced-reload, the read-only lockout)
     are delegated to Cowork on preview/prod — see VERIFICATION.md; NOT marked done on the sandbox alone.
       • B449 (NEW-1) `public/_redirects` (+`404.html`) — missing /assets/* now 404s honestly, no SPA catch-all.
       • B450 (NEW-2) chunk-recovery "stuck" escape (`recoveryStage`) when the fresh build is ALSO missing the chunk.
       • B451 (NEW-3) Vite `base:"/"` for the Cloudflare root deploy.
       • B452 (NEW-4) keepalive cloud push on a forced reload (`flushRegistry` + version-guarded `keepaliveCasPush`).
       • B453 (NEW-5) verified boot reconciliation already unions local mirror ∪ cloud; locked with a regression test.
       • B454 (NEW-6) written root cause — ruled out CAS-bypass; most-likely conflict-then-strand, closed by B452+B455.
       • B455 (NEW-7) conflict loud+blocking · Web Locks single-active-editor read-only lockout · 6s save watchdog.
       • B456 (NEW-8) Version History real building counts + content summary + distinguishable timestamps. -->

<!-- 2026-06-24: owner-reported (screenshot) — the Site-plan overlay panel "does not allow anything to
     actually be dropped in, should work like enterprise software". Highest real B# across both files was
     B444, so minted **B445**. Per STANDING RULE #1 filed AND fixed + headless-verified
     (V131, `ui-audit/verify-overlay-dnd.mjs`, 7/7) + shipped the SAME session on branch
     `claude/hopeful-turing-1x24sg` — full [x] block lives in BACKLOG-DONE.md.
       • B445 — the canvas already had a working onDrop→addOverlayFile, but no drag affordance + the left
         panel (where the cursor goes) wasn't a drop target + the browser default swallowed off-target
         drops. Fix = panel is now a dashed-border dropzone w/ hover highlight, a full-canvas "drop to
         place" hint during a drag, and a window-level guard against the browser opening the dropped PDF.
         Reused `addOverlayFile` + the Doc-Review FileBrowser dropzone pattern; theme tokens only.
     lint 0 errors · 1425 tests · build green. -->
<!-- 2026-06-24: owner-dropped trio "NEW-1/NEW-2/NEW-3" — the Document Review open/switch state &
     feedback bugs (drop gives no signal · switching files loses state · backdrop vanishes mid-upload).
     Highest real B# across both files was B445, so minted **B446 / B447 / B448**. Per STANDING RULE #1
     all three were filed AND fixed + verified the SAME session on branch `claude/vibrant-pascal-wkg50i`
     — full [x] blocks live in BACKLOG-DONE.md.
       • B446 (NEW-1) — a GAP in B294 (drop-over-open) + the docIntent/B405 open paths, NOT a duplicate:
         B294 wired the drop handler but the "Opening…" text only rendered in the empty state, so the
         drop-over-open and Files-panel/openReview paths showed no loading signal. Added a canvas-level
         "Opening <name>…" overlay (data-testid="opening-overlay") driven by `busy`, set on EVERY entry
         path (openFile / openReview / loadSingleReview). openErr/err now fire on every no-op/null/invalid
         branch (null drop, non-PDF reject, loadReview→null) so an open is never silent. Headless V131
         (`ui-audit/verify-open-feedback.mjs`, 6/6, logged out).
       • B447 (NEW-2) — a GAP in B52 (load-supersede token) + the resume effect: B52 stops a late load
         landing on the wrong review, but a switch never FLUSHED the outgoing review's pending write, and
         openReview didn't reconcile with the local mirror — so the cancelled debounce left the last edit
         only in localStorage and a switch-back loaded the stale cloud copy (the "forgets which file"
         clobber). Fix: openReview `await saveNow()` (flush outgoing) THEN `reconcile(loadReview, readDraft)`
         (incoming picks up its newer local mirror), exactly like resume. The lazy-mount resume effect was
         confirmed to already stand down for an in-workspace switch (booted-once + projectId + bootDocIntent
         guards). Auth-only (two saved cloud reviews) → signed-in live check logged V131.
       • B448 (NEW-3) — net-new safety net under B447: a session byte cache (pure `lib/sessionBytes.js`,
         5 unit tests) keyed by srcId holds the dropped File, so a switch/reload BEFORE the Drive/Supabase
         upload resolves (source still keyless) re-opens the backdrop from memory instead of the re-drop
         banner / a blank canvas. `fetchSourceBytes` checks the cache before classifySource/Drive/Supabase.
         Logged-out render-from-cache verified V131; the keyless-mid-upload path's signed-in confirm logged.
     lint 0 errors · 1434 tests · build green. -->

<!-- 2026-06-24: owner-reported trio (screenshot + voice) on the parcel-MERGE banner — "NEW-1/NEW-2/NEW-3".
     Highest real B# across both files was B441, so minted **B442 / B443 / B444**. Per STANDING RULE #1
     all three were filed AND fixed + headless-verified (`ui-audit/verify-merge-banner.mjs`, 6/6) +
     shipped the SAME session on branch `claude/gallant-euler-sk8kwd` — full [x] blocks live in BACKLOG-DONE.md.
       • B442 (NEW-1) — merge/easement banner buttons were unclickable (canvas grab-cursor + pan bled
         through) because the banner had no z-index over the SVG (`zIndex:1`). Fix = `zIndex:6` + a
         defensive stopPropagation; same guard applied to the sibling easement banner. Deduped: NOT B271
         (interrupted-gesture recovery), NOT B441 (MapFinder identify latency).
       • B443 (NEW-2) — Shift-click multi-select "needed several tries": B420 makes a parcel interior
         click-through, so a body Shift-click fell to `onBgDown` and started a marquee instead of a
         merge-toggle. Fix = onBgDown ray-casts the parcel under a shift-press and toggles it; the
         vertex-insert capture handler yields to a merge-pick on a neighbor.
       • B444 (NEW-3) — the "4 parces selected" garble was a SYMPTOM of B442 (canvas painting over the
         behind-z-index banner), not a flex bug; resolved by B442's z-index, hardened with nowrap + a span.
     lint 0 errors · 1421 tests · build green. -->

<!-- 2026-06-24: owner-dropped trio "NEW-1/NEW-2/NEW-3" (status-marker palette + the precision-pin
     map marker + drop the saved-row element count). Highest B# was B422 when filed, but a concurrent
     `main` (#321, the Shared markup engine batch) took B423–B432 while this was in flight, so
     renumbered to **B433 / B434 / B435** = the real next free band. Per STANDING RULE #1 all three
     were filed AND fixed + headless-verified
     (V123, `ui-audit/verify-precision-pin.mjs`, 18/18) + shipped the SAME session on branch
     `claude/stoic-albattani-8bmtp0` — full [x] blocks live in BACKLOG-DONE.md.
       • B433 (NEW-1) — AMENDS B234 (the shared status tokens, edited IN PLACE — not a parallel set) +
         touches B320 (dark `--status-*`). Mostly already LIVE via B365 (coral Pursuit / blue Active /
         fixed salience were drafted against the pre-B365 baseline); the residual shipped here = Dead
         off red → gray, a dedicated `--danger` alert-red token (cloud-off badge / failed-layer dot /
         delete × repointed to it), glyphless Pursuit/Active solid discs, solid (not hollow) Dead, and
         the chip/section-header discs. `ProjectLibrary.jsx STATUS_COLOR` was already gone (no dup to
         reconcile). The three standing rules were added to CLAUDE.md (KEY DECISIONS).
       • B434 (NEW-2) — AMENDS B161 (the marker shape), depends on B433. `buildingPinIcon`→`sitePinIcon`
         (bulb + stalk + ground ring, ring-center anchor); B161's progress arc was restored as the
         ground-ring sweep (it had been silently dropped by B365's shield), same status-derived source.
         Superseded `verify-b365-markers.mjs`.
       • B435 (NEW-3) — net-new; dropped the ` · N elem` suffix from the left-rail site rows.
     Deduped: B433 is the residual of B365 (not a re-file); B434 replaces B161's shape (progress kept).
     lint 0 errors · 1335 tests · build green. -->

<!-- 2026-06-24: B439 (rename/delete from the breadcrumb switcher) + B440 (the Schedule iframe-bridge
     half) were filed AND built + verified the SAME session per STANDING RULE #1 — full [x] blocks live
     in BACKLOG-DONE.md (branch `claude/beautiful-archimedes-0qjr3w`). Site (uncontrolled) path proven
     headless 7/7 (`ui-audit/verify-b439-b440-project-manage.mjs`) + 4 store unit tests; the Schedule
     (controlled/bridge) path is symmetric command-plumbing reusing the embedded app's existing
     renameProject/deleteProject — it can't boot headless in the offline sandbox (CDN + its own backend
     blocked), so it's logged for a signed-in live check in VERIFICATION.md. The brief's "verify first"
     was confirmed: the embedded scheduler ALREADY had internal renameProject/deleteProject, so B440 was
     just plumbing (+ a skipConfirm flag so the breadcrumb's inline confirm doesn't double-prompt). -->

### B423 — Shared markup/measure tool engine + Bluebeam-parity refinement loop `[Site Planner + Doc Review / Markup]` (umbrella) #site-planner #doc-review #markup  *(owner-dropped 2026-06-23 as the "Shared Markup/Measure Tool Engine" brief; first minted B421 but RENUMBERED to **B423** on merge-in of main — the concurrent PR #320 had already taken B421 (Arrange) + B422 (Layers); B423 = highest real B# across both files (B422) + 1; plan — `/root/.claude/plans/planyr-shared-tidy-avalanche.md`)*
One shared markup/measure engine in `src/shared/markup/` that BOTH workspaces (and the Stitcher) consume, bringing every tool to Bluebeam-equivalent behavior, plus a committed machine-checkable tool×property matrix + an automated tester so future tool work converges on its own. The brief's "NEW-#" are scratch labels; real filed IDs are B424+. Owner decisions locked: tools RIGHT / properties LEFT in both; Arrow = an arrowhead toggle on Line; verifier = the full cloud rig (B278/B280/B281) built first. Sub-items, in dependency order:
- `[x]` **B424 (NEW-1) — the tool×property matrix as data. DONE this session.** (see BACKLOG-DONE.md)
- `[x]` **B425 (NEW-2) — the shared engine's PURE layer. DONE this session.** (see BACKLOG-DONE.md)
- `[x]` **B426 (NEW-2 cont./NEW-3) — shared `MarkupRenderer.jsx` + `PropertyPanel.jsx` + host wiring; DocReview gains left property panel.** DONE 2026-06-24 (branch `claude/determined-shannon-p7unj4`, commit 5842a78). (see BACKLOG-DONE.md)
- `[x]` **B427 (NEW-4) — Document Review parity tools: Line, Polyline, Polygon, Ellipse.** DONE same commit as B426. (see BACKLOG-DONE.md)
- `[x]` **B428 (NEW-5) — property-set completion to the matrix in both (stroke/width/style/opacity, fill+fill-opacity, full text controls, set-as-default, Reuse mode, keep inline Calibrate).** DONE 2026-06-24 (branch `claude/determined-shannon-p7unj4`, commit 192c63a). (see BACKLOG-DONE.md)
- `[x]` **B429 (NEW-6) — new tools: Arc, Dimension, Pen, Highlight, Eraser (pen/highlight only), Snapshot; Arrow = arrowhead toggle on Line.** DONE 2026-06-24 (branch `claude/determined-shannon-p7unj4`). (see BACKLOG-DONE.md)
- `[x]` **B430 (NEW-7) — Count as a first-class measure in the Site Planner.** DONE 2026-06-24 (branch `claude/determined-shannon-p7unj4`, commit 285836b). (see BACKLOG-DONE.md)
- `[x]` **B431 (NEW-8) — unified interaction model + edit handles (reuse `shouldPan`; convert ParcelDrawing's residual `window.prompt` calibrate to inline `numEdit`).** DONE 2026-06-24 (branch `claude/determined-shannon-p7unj4`). (see BACKLOG-DONE.md)
- `[x]` **B432 (NEW-9) — per-tool matrix assertions extending the B278 suite, landed as each tool row lands; encode the loop driver into CLAUDE.md.** DONE 2026-06-24 (branch `claude/determined-shannon-p7unj4`). (see BACKLOG-DONE.md)
- **Prereq harness (Phase 0):** `[x]` **B278 (Playwright e2e — built, smoke green) + B281 (CI auto-`@claude` loop — built) DONE this session** (see BACKLOG-DONE.md). `[x]` **B280 (seeded test account) — DONE by owner 2026-06-24** (account + seed.sql + the 3 CI secrets `E2E_EMAIL`/`E2E_PASSWORD`/`E2E_BASE_URL` are live); the auth-gated loop now runs in CI. (see BACKLOG-DONE.md)

<!-- B438 (browser-side GIS imagery cache: service worker + IndexedDB) was SUPERSEDED mid-session by
     B445 (server-side, Drive-backed cache) on the owner's call "I don't want it to live in the browser"
     — a per-browser cache doesn't follow you between computers + isn't the professional home for
     outage resilience. The SW/IndexedDB code was retired (gis-sw.js → self-unregistering tombstone;
     gisImageCache.js/gisSwRules.js deleted). Both B438 (superseded) + B445 (shipped) blocks live in
     BACKLOG-DONE.md. (Renumbered B439→B445 on 2026-06-24: a concurrent session had also minted B439
     for the breadcrumb rename/delete feature — see BACKLOG-DONE.md B439/B440 — so this GIS item took
     the next free B# to clear the collision.) -->

### B422 — Named markup Layers (show / hide / lock / rename / reorder) `[Doc Review / Markup]` (feature) — ROADMAP STUB, design pass required before build #doc-review #markup  *(owner-dropped 2026-06-23 as "NEW-2"; minted **B422**)*
`[ ]` **PARKED — file only, do NOT build yet (a design pass must land first).** CAD-/Bluebeam-style named layers for the markup surface: group markups into named layers ("Existing", "Demo", "My redlines", "GC's markups"), each with show/hide, lock, rename, delete, and reorder. Distinct from & complementary to the Arrange z-order ops (**B421**, shipped): Arrange controls draw order **within** a layer; Layers organize the whole sheet. Strategic value is organizational — isolate one reviewer's markups, lock an as-built, separate civil from architectural — which maps onto the multi-reviewer / multi-customer direction.
- **Why it can't be a quick handoff (the open design questions):**
  - **Data-model change + migration.** Each markup gains a `layerId`; the review gains a `layers` collection (`id, name, visible, locked, order`). Old saved reviews migrate on load — markups with no `layerId` fold into a default "Markup" layer. Use the existing version-bump + `migrate` discipline (same pattern as the Site Model `SITE_MODEL_VERSION` migrations), not an ad-hoc reshape.
  - **Active-layer concept.** New markups land on the active layer → needs a clear, always-visible indicator of which that is.
  - **Render + hit-testing.** The render path filters out hidden layers; `hitTest` (B33) must skip markups on hidden OR locked layers so you can't grab what you can't edit.
  - **Arrange interplay.** B421's four reorder ops become "arrange **within** the active layer" — reuse them, don't fork.
  - **New UI surface.** A Layers panel in the right rail (alongside Takeoff); reuse the portal-menu pattern (`AnchoredMenu`/B127) for per-layer menus.
  - **Delete-layer is a "silence is a crash" hazard.** Deleting a layer must force an explicit choice for its markups (reassign to another layer vs. delete with the layer) via a loud confirmation — never silently drop markups.
- **Next step before any code:** a design pass — a Layers-panel mockup **plus** a written data-model + migration proposal — reviewed and approved first. Do NOT assign to a build session until that lands.

<!-- 2026-06-23: owner-dropped bug "NEW-1" (live) — a parcel grabbed by its empty INTERIOR, not just its
     boundary/setback, so a press in the open interior near (but not on) a footprint selected the LOT
     instead of letting you work on a building sitting there. Highest real B# across both files was B419
     (B416 Split-a-parcel, B417 paste-at-cursor/trailer-parking, B418 building-depth/"Review" label, B419
     token rename — all taken by concurrent PRs #313/#314/#316 while this was in flight), so minted
     **B420** = the next free ID. (The branch/commits/harness/code tags first read B417 per the
     collision-renumber convention, renamed to B420 on the merge-in of main.) Deduped: net-new — the
     INVERSE of B155/B156 (those make small markup-shape interiors grabbable, correct for annotations; a
     parcel is a CONTAINER, so boundary-grab is the right inverse, not a contradiction). LAYERS ON
     B310/B311 (does not replace them): their click-vs-drag intent + "Select parcels" toggle are keyed on
     startMoveParcel, which now simply fires from the boundary hit-stroke instead of the whole fill.
     Reuses B146's fat-invisible-hit-stroke; NOT B213 (inactive parcels already draw no setback line).
     Per STANDING RULE #1 filed AND fixed + headless-verified the SAME session on branch
     `claude/vigilant-cerf-6rvxga` — full [x] block lives in BACKLOG-DONE.md.
     FIX (boundary-only hit model, SitePlanner.jsx): the visible parcel <polygon> is now
     pointerEvents="none" (its fill never grabs, even with a translucent fill toggled on) + a companion
     transparent fat hit-stroke (rgba(0,0,0,0.001), 12 px, pointerEvents="stroke") on the same ring is the
     only grab target; the setback outline gets the same fat hit-stroke (owner: "boundary OR setback"); a
     shared onParcelContext opens the menu from either. Interior = click-through → falls to whatever
     element is painted on top, else the background pan. ~12 px is zoom-independent because f2p already
     projects feet→screen pixels (matches the existing easement-edge picker's flat 12). Preserved +
     re-verified: B310/B311, Shift-merge, align-edge pick, unlocked drag-to-move, B230 vertex editing
     (hit-tests at the svg root, independent of the fill). B311 tooltip reworded "click a lot" → "click a
     lot's edge or setback line" (label only). New regression harness
     `ui-audit/verify-b420-parcel-boundary-grab.mjs` 7/7; repointed verify-b310-b311 / verify-edge-runs /
     verify-edge-runs-irregular off the now-dead interior / `pointer-events="all"` selectors → all green,
     plus verify-b221-b222 / verify-parcel-split-control / verify-b383-add-parcel /
     verify-parcel-resilience still pass. lint 0 · 1320 tests · build green. -->

### B413 — Auto-stitch scanned, scale-less survey sheets that carry NO match-line text `[Doc Review / stitching]` (feature) #doc-review #stitching  *(owner-dropped 2026-06-23 with a real upload "get it to stitch these together correctly"; owner picked approach (A) "build the real OCR auto-stitch"; minted **B413** = highest B# (B412) + 1; IN PROGRESS)*
`[ ]` **Phase 1 (foundation) BUILT + unit-tested (`src/shared/files/ocrMatchLines.js`, 8 tests); NOT yet wired into the live stitch — see remaining blockers below. Do NOT present a topology-only placement as "aligned" (a wrong stitch is worse than an unstitched one).** The owner's GPL topo slice (C-2/C-3/C-4, "TOPO SURVEY I/II/III", NOT TO SCALE, FOR REFERENCE ONLY, 9-item text layer) carries its "MATCH LINE … SHEET N" labels only in the RASTER — so `autoPlaceGroup` (B337) gets nothing.
- **DONE — OCR match-line recovery design, proven on the real pages.** `recoverMatchLines(passes, dims)` runs `parseMatchLines` in EACH orientation pass's own upright frame, then maps the label centre back to page space to pick the edge (`framePointToPage`). Verified against real Tesseract reads: C-2's bottom "MATCH LINE ~ SHEET 2" → side bottom; C-4's left (rotated 90°) "MATCH LINE ~ SHEET 2" → side left. Adjacency for the L-layout (C-2 over C-3, C-4 right of C-3) is fully recoverable.
- **✅ DONE (2026-06-23) — blocker #3, the hard CV tail: pixel-precise seam alignment. BUILT, tested, wired, proven seamless on the owner's real C-2/C-3 scans.** New pure module `src/shared/files/matchLineFit.js` (1-D horizontal CLOSE bridges the dashes → OPEN drops text/crossing strokes → RANSAC fits the line over the full width, with a span guard so a short horizontal note can't masquerade as the seam) + browser glue `doc-review/lib/matchLineRefine.js` (`refineGroupPlacements`: BFS the seam graph, re-derive each neighbor's matrix from the REAL match line via `solveM`, then `slideRefine` connects the crossing linework). Handles the ~1° inter-sheet skew (recovered −0.938° on the real pair, matching a Python reference exactly) and the inset/dashed line. Wired into `Stitcher.jsx` (`renderPageToImageData` → binarize → refine) as a **best-effort, fail-safe** pass: any sheet it can't fit confidently — or whose correction isn't a plausible nudge (`plausibleRefine`) — keeps its label-based placement, so it only ever improves a seam, never breaks one. 24 unit tests; verified end-to-end through the real exported functions on the actual sheets (seamless composite). Removes the old "topology-only ⇒ keep aligned:false" limitation for any set that reaches the refiner.
- **REMAINING blockers (only the RECOGNITION layer that feeds the now-working aligner; needed for fully-automatic on these specific compressed scans):**
  1. **OCR reliability/perf.** Tesseract on these COMPRESSED scans is inconsistent across scale/orientation/PSM (a label read at one render setting is missed at another) and OCR-ing every sparse page at 3 orientations is slow. Needs tuning (edge-band crops at a fixed legible scale, per-orientation PSM) + a conservative trigger (only a sparse-text drawing with no text match-lines) and likely a worker budget. Until labels are read, `autoPlaceGroup` builds no adjacency → the aligner isn't invoked → sheet stays manual-Align.
  2. **Sequence-target resolution.** Labels reference by SEQUENCE ("SHEET 2" = the 2nd sheet = C-3), not the "C-3" code — `autoStitch.buildAdjacency` keys on `sheetNumber`, so a numeric target must resolve to the Nth group member (prototyped, not yet in code).
- **Honest note for the owner:** the seamless-join ENGINE is done and proven on your sheets. For it to run hands-free on these "FOR REFERENCE ONLY / NOT TO SCALE" compressed scans, the app must also reliably recognize which scanned sheet neighbors which (blockers #1–#2 above). A vector CAD set (or sheets whose match-line text + numbers read cleanly) auto-stitches AND now gets the pixel-perfect seam today.

<!-- 2026-06-23: owner-dropped pair "NEW-1/NEW-2" (with screenshots) — trailer parking generated on a
     building's NON-dock sides + the building "depth" reading the truck-court depth. First minted B416/B417,
     but a concurrent `main` (PR #313) took **B416** for the Split-a-parcel control while this was in flight,
     so **renumbered B417** (trailer on non-dock sides) + **B418** (building depth reference) — the real next
     free IDs. (The branch `claude/exciting-allen-i2eq2k`, PR #314, the commits, and the code/test tags + the
     `ui-audit/verify-b416-b417.mjs` harness still read B416/B417, per the collision-renumber convention.)
     Per STANDING RULE #1 BOTH were filed AND fixed + unit-tested + headless-verified (V120) the SAME session
     — full [x] blocks live in BACKLOG-DONE.md. Root cause (evidence-first, the filed hypothesis was off):
     a dock-zone stack stays pinned to the side it was created on, so a reshape / dock-preset change stranded
     the court→trailer→buffer on a now-non-dock side; the named legacy opp-trailer suspect was already dead
     code (removed). lint 0 · 1285 tests · build green. Deduped: net-new. -->

<!-- 2026-06-23: owner-dropped bug "NEW-1" (live) — "no way to reach the Split tool; the 'Split a parcel'
     control is not shown on screen." Highest B# across both files was B415, so minted **B416** = the next
     free ID. Deduped: net-new — NOT B128 (concave-cut split GEOMETRY, intact), NOT B96 (the shared
     Enter/double-click finisher), NOT B130 (which created the rail "Boundary" menu). Per STANDING RULE #1
     filed AND fixed + headless-verified the SAME session on branch `claude/affectionate-wright-gf3kgt` —
     full [x] block lives in BACKLOG-DONE.md.
     GROUNDED THE REPORT FIRST: the rail Boundary ▾ → Split a parcel was NEVER deleted (unchanged since
     2026-06-21 per git blame; scenario A passed on the UNFIXED build), so none of the three suspected
     failure shapes held. Real cause = a discoverability regression from B383: parcel ops (＋ Add parcel,
     Merge) were surfaced into the Parcel PANEL, but Split — the inverse of Merge — was left only in the
     rail. FIX: added "✂ Split a parcel" to the Parcel panel beside Merge (same selectTool("split"), no
     second pipeline; rail menu kept). Smoke-tested the full activate→capture→finish→commit split live.
     Regression guard `ui-audit/verify-parcel-split-control.mjs` (rail + panel reachability + e2e cut)
     11/11. 1273 tests · lint 0 · build green. -->

<!-- 2026-06-23: owner-dropped chat pair "NEW-1/NEW-2" — the Document Review drawing render vs Bluebeam
     (white flash on zoom + softer linework on big sheets). First minted B412/B413, but a concurrent
     `main` (PR #311) took **B412** (title-block reader) + **B413** (auto-stitch surveys) while this was
     in flight, so **renumbered B414** (NEW-1, the flash) + **B415** (NEW-2, the sharpness) — the real
     next free IDs. Per STANDING RULE #1 BOTH were filed AND fixed + unit-tested + headless-verified the
     SAME session on branch `claude/confident-edison-lpbco9` — full [x] blocks live in BACKLOG-DONE.md.
     Deduped: net-new; B415 SUPERSEDES the whole-page raster path B247/B265/B327/B329 (extends it, not a
     fork). Headless harness `ui-audit/verify-b414-b415-render.mjs` 11/11 (detail 2.00× vs would-be
     whole-page 0.95× = 2.11× sharper; backdrop never re-rasters on zoom; detail never blanks through a
     settle) + the B329 viewport harness still 13/13. 1273 tests · lint 0 · build green. -->

### B411 — Auto-filing residual gaps after the multi-discipline split (B410) `[Doc Review / auto-filing]` (bug/task) #doc-review #filing  *(spun off from B410, 2026-06-23; minted **B411** = B410 + 1)*
`[ ]` Three honest gaps surfaced while testing real Drive files against the new splitter (B410, shipped) — none blocks the shipped feature, but each is a real recognition weakness:
- **(a) Scanned/image-only sets read as nothing in FILING.** A no-text-layer drawing (e.g. "2023.11.06 Mesa - Electrical B1.pdf") has no embedded text, so the local read returns nothing and the file lands in the holding tray. OCR already exists in the STITCHER (B352, `doc-review/lib/ocr.js`, Tesseract); wire that same OCR into the filing read (`localRead.js`) so scanned sheets classify too. Bigger lift (renders pages to canvas), so it's its own item.
- **(b) Date sometimes grabs an old BASE date over the issue/revision date.** "Mesa - Site Plan 2025.09.17.pdf" filed with `2023-04-07`; the latest-date picker isn't preferring the issue/rev date in the title block. Tighten the date selection (prefer a date adjacent to "ISSUED/REV/IFC", and weight the title-block zone).
- **(c) Big combined sets weren't validated here — Drive connector caps downloads at 10 MB.** The richest split cases (GPL Civil IFP 125 MB, Jacintoport MEP 13.6 MB, full Mesa COH sets) couldn't be pulled in-session. Needs a signed-in spot-check on planyr.io (drop a big combined set → expect separate per-discipline PDFs) or a higher-limit fetch path.

### B409 — Large files (>~100 MB) now upload to Drive via a browser-direct resumable path — no more silent "oversize" `[Doc Review / storage]` (bug) #doc-review #drive  *(owner-dropped 2026-06-23 as "NEW-1"; minted **B409** = highest B# across both files (B408) + 1)*
`[ ]` **Code shipped on branch `claude/quirky-galileo-dm786x` — lint 0 · 1238 tests · build green. ONE step left: a signed-in, deployed ≥100 MB Drive round-trip to confirm the live browser→Google CORS PUT (the sandbox can't sign in or reach Drive — same live-verify gate as B405/B406).** Deduped: net-new — NOT B405 (that's the file-OPEN/read-back taxonomy; this is the WRITE/upload path) and NOT B207 (the Drive cutover, which this completes for big files).
- **Repro (owner, signed in):** a ~125 MB civil PDF ("GPL - Civil IFP 2026.06.19.pdf", 125,176,019 B) flagged "over the 50 MB … couldn't be stored online" and wrote **no** drive_files row; the bytes fell back to Supabase and were rejected as oversize, so the owner's only copy is a manual My Drive upload, not the app's `project-<id>/<discipline>` tree.
- **Root cause (code-confirmed):** `functions/api/files.js` buffered the whole upload in the Cloudflare Worker (`request.arrayBuffer()` → capped by the ~100 MB request-body limit + 128 MB memory) **and** `driveClient.create()` used `uploadType=multipart` (Google's ≤5 MB path) — so a 100 MB+ file could reach neither backend.
- **Fix (additive + regression-safe — only files >50 MB take the new path; ≤50 MB untouched on the proven multipart path, Supabase fallback preserved so behaviour is never worse than today):**
  - `driveClient.createResumableSession()` mints a Drive **resumable** session bound to the browser's `Origin` (for the cross-origin PUT); `createViaResumable()` is the server-side variant (selftest + future server use).
  - New Pages Function `functions/api/files/resumable.js`: `POST` = init (returns the pre-authorized session URL), `PUT` = commit (records the Planyr-key↔Drive-id map). Same Supabase-auth + drive-backend gating as `/api/files`.
  - Client `reviewStore.uploadLargeToDrive()`: init → **PUT bytes straight to Google (never through the Worker)** → commit; `storeSource()` routes >50 MB blobs to it, so neither the body limit nor the memory cap applies (multi-GB works).
  - **Distinct message (part b):** `sourceState` adds a `too-large` state ("re-open to upload — large files now go to Drive"), separate from the legacy 50 MB "oversize" wording; `fileWarn` gets a matching large-file warn.
  - **Recovery (part c):** re-dropping a previously-oversize file re-stores it to Drive **in place** (same `srcId`/`reviewId` → markups stay attached). DocReview already re-stored on open; the Stitcher's `bindSource` now does too. (No bulk byte-migration is possible — oversize bytes were never stored anywhere — so the re-drop, which now works, IS the migration.)
  - **Guard (part a):** `selftest.js` gains a resumable round-trip step (`?mb=N`) so the large-file transport can't regress on the deploy. +9 unit tests (resumable request shapes incl. the `Origin` binding; `too-large` state/copy/warn).

<!-- 2026-06-23: owner-dropped logging task "NEW-1" — record the agreed Supabase org/project naming
     convention in CLAUDE.md so the "Planar vs Planyr" confusion is documented as resolved and future
     env work references the right project. Highest B# was B405 when filed, but a concurrent `main`
     (PR #305/#306) took **B406** for Shared team workspaces while this was in flight, so **renumbered
     to B407** (the real next free ID). Deduped: net-new (no existing Open/Done item covered Supabase
     naming). The owner had already applied the Supabase-side rename himself (org → Planyr, live
     project → planyr-production), so the only work left was the doc — per STANDING RULE #1 it was not
     merely logged but DONE the same session: the convention + the "renaming a display label is
     cosmetic; the client rides the immutable 20-char project ref in VITE_SUPABASE_URL, so no rebuild"
     safety fact were written into CLAUDE.md's "## Supabase" section (beside the build-time-env gotcha).
     A mid-session code check then found the **Scheduler hardcodes a DIFFERENT project ref
     (`ksetjztkplttbcehyicv`) than the main app (`lyeqzkuiwngunutlkkmi`)**, so the doc was corrected to
     flag that the us-west-2 "Planar" project is most likely the Scheduler's LIVE backend (match refs
     before any delete), NOT a deletable spare. README "Deploy secrets" names Supabase only via "the
     anon key" → nothing to reconcile. Doc-only, no code paths. Full [x] block in BACKLOG-DONE.md
     (branch `claude/blissful-hopper-zcijkh`). -->

### B408 — Decide &, if chosen, consolidate the Scheduler onto the main Supabase project `[Infra / Scheduler]` (task) — DECISION-GATED #infra #scheduler  *(filed 2026-06-23 as the follow-up to B407; minted **B408**)*
`[?]` **Open — BLOCKED on an owner decision; do NOT start any data migration until Michael chooses.** The suite runs on TWO separate Supabase projects: the main app (Site Planner + Doc Review) on ref `lyeqzkuiwngunutlkkmi` (via the Cloudflare `VITE_SUPABASE_URL` build env), and the **Scheduler** (`/sequence/`) on a DIFFERENT ref `ksetjztkplttbcehyicv`, **hardcoded** in `public/sequence/index.html` (tables `planar_data` / `planar_history` / `planar_suggestions`, own anon key). This split predates the "one product" direction — see CLAUDE.md "## Supabase" → the two-project note (B407).
- **The decision (Michael's call):** **consolidate** the Scheduler onto the main project (one backend + one auth/RLS surface; the natural fit for the one-product direction and the new team-sharing work) — OR **keep them split on purpose** and just NAME them per-component (`planyr-production` for the main app, e.g. `planyr-scheduler` for the Scheduler). Both are valid; consolidation is more work and carries live-data risk.
- **Why this is not a same-session fix (the blocker):** if "consolidate" wins it is a real **live-data migration** — stand up `planar_*` tables + RLS on the main project, copy existing rows with zero loss, repoint the Scheduler's ref/key (ideally off the hardcode and onto the build env like the main app), and cut over with a rollback path. A planned migration over production schedule data, not a quick edit — the genuine "needs a decision + too large for one run" case the backlog exists for.
- **Scope when greenlit (consolidate path):** (1) `planar_*` table + RLS parity on the main project; (2) one-time data copy + row-count verify; (3) repoint the Scheduler (prefer env over the hardcode); (4) keep the old project read-only as a fallback until confirmed; (5) flip the CLAUDE.md two-project note to "consolidated". **If "keep split" wins:** no migration — just finish B407's rename-by-ref cleanup (name each project for what it is) and close this.

### B406 — Shared team workspaces: invite by email, share a project with a team `[Site Planner + Doc Review]` (feature) #site-planner #doc-review #infra  *(2026-06-22; "B-TEAM" in the cowork handoff. Filed B365 in-session, but a concurrent `main` had taken B365–B405 — renumbered to the real next free B#406. PR #305 title still says B365.)*
`[ ]` **Shipping — code merged via PR #305; DB phase-2 migrated + verified in PRODUCTION (`lyeqzkuiwngunutlkkmi`); remaining owner step: run `team_storage.sql` (phase 3) for shared-PDF reads.**
Lets a team share a workspace: invite people by email (activates on signup/sign-in even if they had no account yet), admins vs members, and a project stays **private until deliberately shared** (and can revert to private). Additive + private-by-default preserved — a row with `team_id IS NULL` behaves exactly as before.
- **DB (done + verified in prod):** `db/profiles.sql` (email mirror), `db/teams.sql` (teams/team_members/team_invites + `is_team_member`/`is_team_admin` SECURITY-DEFINER helpers + `claim_team_invites`/`list_team_members` RPCs + signup auto-claim), `db/team_sharing.sql` (`team_id` on sites/doc_reviews/file_facts; PK `(user_id,id)`→`(id)`; RLS rewritten to "own OR shared-with-my-team", delete = owner-or-team-admin). Verified end-state: 3 `team_id` cols, `sites` PK = `id`, 12 RLS policies, both helpers present. Pre-flight done (snapshot tables `backup_*_20260622`; 0 dup ids) — **drop the backup tables once confirmed good.**
- **DB (still to run):** `doc-review/db/team_storage.sql` (phase 3) — extra Storage SELECT policy so teammates can open each other's **shared review PDFs**. Until run, that one sub-path is inert (graceful); everything else works.
- **Client:** `optimisticUpsert.casUpsert` updates by `(id,version)` only + stamps `user_id` on INSERT only (creator never re-stamped on a teammate edit); `cloudSync`/`reviewStore` carry `team_id`, delete by id (RLS scopes), team_id-missing graceful degrade; `siteModel` `teamId`/`ownerId` + `teamShareOf` (SITE_MODEL_VERSION→8); `storage.mergePulledSites` doesn't re-push teammates' rows; `lib/teams.js` + `lib/sharing.js`; `SitePlannerApp` claims invites on sign-in; **UI** = Team tab (`TeamPanel`) + account-menu entry, Share-with-team control in the Project Files drawer.
- **Left:** run `team_storage.sql`; signed-in live check (create team / invite / accept / share / concurrent-edit conflict / member-can't-delete) — auth-only, so not headless-testable in the sandbox. See VERIFICATION V118.

<!-- 2026-06-23: owner-dropped COMBINED chat brief (it explicitly supersedes three earlier separate briefs —
     the Markup→Library rename, "open any file fails", and the standalone oversize-banner-copy item — so filed
     from the combined version to avoid double-filing; deduped: no existing Open item covered these). Highest
     B# across both files was B400 when filed, but a concurrent `main` (#297) took B401–B403 for a Scheduler/
     Export batch while this was in flight, so **renumbered B404–B405** (the real next free IDs); the brief's
     B207 item was an AMENDMENT (no new B#). Per STANDING RULE #1 both new items were filed AND fixed + verified
     + merged the SAME session (branch `claude/brave-brown-jb1n2l`) — full [x] blocks live in BACKLOG-DONE.md:
       • B404 (NEW-1) — module tab "Markup" → "Library" (label ONLY; route id `doc-review`/`/markup`, storage
         keys, and the amber accent token names unchanged). The only user-facing "Markup" string was the tab;
         the SitePlanner "Markup line/rect" tool hints are a different feature, left alone. Finish-the-job tail:
         ~15 ui-audit harnesses selected the tab by visible text → repointed to "Library". New
         `verify-b404-library-tab.mjs` 4/4 + repointed `verify-new1-header-integration` 5/5.
       • B405 (NEW-2) — the Files-browser "open any file fails" was ONE conflated banner + a SILENT missing-source
         path. Grounded against real code FIRST: the brief's "the browser reshape drops storageKey/driveKey"
         hypothesis was REFUTED at the open hop (`openReview` → `loadReview(row.id)` re-fetches the full Postgres
         record by id, so the lightweight browser row is never the src) — flagged, not rebuilt. Real fix = a
         4-state taxonomy (oversize / not-stored / fetch-failed / signed-out) in new pure `lib/sourceState.js`
         (15 unit tests), wired through `DocReview.fetchSourceBytes` + the FileBrowser/drawer warns. The
         universal-failure ROOT is a LIVE storage/auth class the logged-out sandbox can't reproduce (most likely
         the `doc-review-files` bucket/RLS unprovisioned, or legacy keyless rows) → a signed-in deploy pass is
         pending (cohort/owner), but the code now names every cause precisely + offers a working re-open recovery
         regardless.
     B207 AMENDMENT (no new B#): the brief assumed Drive was at "scaffold", but the repo already had it
     CODE-COMPLETE + TESTED (advanced past the brief by a concurrent session) — confirmed by a full ground-truth
     read and the B207 entry below was updated to match; the one remaining step is the owner's Google/Cloudflare
     provisioning. lint 0 · 1228 tests · build green. -->

<!-- 2026-06-22: owner-dropped chat batch (exported Gantt QUALITY) — arrived NEW-1..NEW-4, first minted
     B393–B396, but a CONCURRENT session shipped its OWN B393–B396 (Gantt labels + curved connectors) to
     `main` while this was in flight, so **renumbered B397–B400**. Per STANDING RULE #1 filed AND fixed +
     headless-verified (V115, 12/12) + merged the SAME session on branch `claude/gifted-hypatia-na62be`:
     B397 (vertical rules behind bars), B398 (one continuous left edge), B399 (light two-tier Year▸Month
     header + weighted year>quarter>month grid rules, owner-art-directed), B400 (viewBox fit-to-width +
     Move/zoom drag-pan in the preview). The owner approved ELBOW connectors here, but the concurrent
     session had already settled connectors with later, more-informed owner feedback ("the serpentine ones
     were fine, I preferred those, revert — they just weren't bound to the bars"), so on owner confirmation
     this session the elbow work was DROPPED and main's curved-bound connectors (their B396) kept. Full [x]
     blocks in BACKLOG-DONE.md. -->

<!-- 2026-06-22: owner-dropped chat trio "NEW-1/NEW-2/NEW-3" — Gantt label alignment + uniform ink,
     printed-Gantt missing names, and serpentine dependency arrows. First minted B390/B391/B392, but a
     concurrent `main` (PR #293, the PDF/Print Exhibit table-layout batch below) took B390/B391/B392
     while this was in flight, so **renumbered B393 / B394 / B395** (the real next free IDs). Deduped:
     all NET-NEW — no existing item covered Gantt label alignment / in-chart PDF names / orthogonal
     connectors; the prior "NEW-1"s (B383/B385–B388) were Site-Planner or Schedule-toolbar items, and
     the B390–B392 collision is the exhibit batch (a different surface). Per STANDING RULE #1 all three
     were filed AND fixed + headless-verified + shipped the SAME session (branch
     `claude/zen-ramanujan-14sak9`) — they share ONE label/render pass in GanttView + buildGanttSVG, so
     landed together. Full [x] blocks live in BACKLOG-DONE.md; headless harness V114
     (`ui-audit/verify-gantt-labels-deps.mjs`, all checks across right/center/left). -->

<!-- 2026-06-22: owner feedback right after B393/B394/B395 shipped — "the serpentine things were fine,
     i preferred those, revert, the issue was just that they weren't bound to anything". Minted **B396**:
     reverted B395's orthogonal elbow back to the curved bézier in both render paths AND fixed the real
     defect (the curves floated at the row mid-line; now bound to each bar's vertical center). Full [x]
     block in BACKLOG-DONE.md; verified via the updated V114 harness. -->

<!-- 2026-06-22: owner-dropped chat batch (PDF/Print Exhibit table layout) — three items from one
     screenshot+voice note. Filed B385/B386/B387, **renumbered B390/B391/B392** — concurrent `main`
     (PRs #290/#291/#292) took B385–B389 while this was in flight, so B390–B392 are the real next free
     IDs (branch commit/PR titles still read B385/B386/B387). Per STANDING RULE #1 all three were filed
     AND fixed + headless-verified (V113, 10/10) + merged via PR #293 the SAME session on branch
     `claude/practical-edison-ggcm1k` — full [x] blocks live in BACKLOG-DONE.md:
       • B390 (bug)  — exhibit columns mis-sized: oversized Task-Name gap + truncated Start/End/Dur.
                       Split table used table-layout:fixed at hardcoded ~50% width with fixed per-column
                       px and Name at w:null (absorbed the slack → the gap; dates clipped in the
                       too-narrow fixed cols). Replaced with a content-fit model (pure approxTextPx +
                       layoutExhibitCols); dates/dur never flex.
       • B391 (feat) — year-boundary divider lines on the exhibit Gantt (month lines were hidden behind
                       the opaque row bands). Heavier slate line at each Jan 1, drawn over the bands;
                       January labels emphasized.
       • B392 (feat) — drag-to-resize columns in the preview (mirrors the live grid's col-resize),
                       reflowing live + persisted (data.exportColWidths) + a Reset.
     Deduped: net-new. B392 RECONCILED with B160 (see its note) — complementary, not a dup. -->

<!-- 2026-06-22: owner-dropped chat item — "put the light v dark option under profile settings".
     Minted **B389**. Per STANDING RULE #1 fixed + headless-verified (V112, 7/7) the SAME session on
     branch `claude/inspiring-bohr-46gql9` — full [x] block in BACKLOG-DONE.md.
     WHAT SHIPPED: the Light/Dark/System picker moved from the row-1 ⚙ gear into account → Settings
     (AuthPanel), next to Change password. Extracted a shared `src/shared/theme/ThemePicker.jsx`
     (one picker, used by both the Settings panel and the gear). The row-1 gear is KEPT only when
     signed out (`{!accountActive && <SettingsMenu/>}`) so a logged-out visitor can still switch
     (B342 preserved) without duplicating it for signed-in users. Pure relocation — ThemeProvider /
     data-theme / System listener unchanged. lint 0 · 1201 tests · build green; B387/B388 harnesses
     still green (the logged-out gear they rely on is preserved). -->

<!-- 2026-06-22: owner-dropped chat item "NEW-2" — lift Schedule's toolbar up into the unified
     AppHeader so Schedule has ONE header like Site/Markup (built on the B387 center slot). Filed
     B386, **renumbered B388** — a concurrent `main` (PRs #289/#290) took B385/B386 while this was in
     flight, so B387/B388 are the real next free IDs (branch commit titles still say B385/B386).
     Owner GREENLIT building it the same session, so per STANDING RULE #1 it was fixed + headless-
     verified (V111, 17/17) on branch `claude/inspiring-bohr-46gql9` — full [x] block in BACKLOG-DONE.md.
     WHAT SHIPPED: the embedded Gantt app's action toolbar now renders up in the shell's Row-2 header —
     Grid/Split/Gantt + review inbox in B387's `toolbarCenter`; zoom/export/save/history/contacts/
     automation/format/settings in `toolbarContent`. The feared popover-anchoring blocker was
     UNFOUNDED: the embedded app already renders its panels as self-positioned fixed modals/drawers
     (never anchored to buttons), so lifting the trigger buttons is clean — buttons post `planar:*`
     commands, panels still open in the iframe. The B203 bridge was extended (planar:toolbar-state +
     command messages), strict same-origin guards kept, iframe stays source-of-truth (badge = reported
     count, never fabricated). `.in-iframe .app-header{display:none}` hides the whole in-embed header
     (re-widening what B381 narrowed); standalone /sequence/ untouched (inShell-gated). Two settings
     gears kept separate (B342 vs Schedule view); "share" = the existing Contacts control. SUPERSEDES
     B381's harness `verify-schedule-toolbar.mjs` (retired). New `ScheduleToolbar.jsx`; edits to
     Scheduler.jsx + index.html. lint 0 · 1201 tests · build green · JSX OK · lazy chunks intact. -->

<!-- 2026-06-22: owner-dropped chat item "NEW-1" — add an optional CENTER toolbar zone to AppHeader
     Row 2 (a third slot between the module tabs and the right toolbar, mirroring how Row 1 centers
     the project name). Filed B385, **renumbered B387** — concurrent `main` (PR #289) took B385 while
     this was in flight; canonical IDs for this pair are B387 + B388. Per STANDING RULE #1 it was fixed +
     headless-verified (V110, 9/9) the SAME session on branch `claude/inspiring-bohr-46gql9` — full [x]
     block lives in BACKLOG-DONE.md.
     WHAT SHIPPED: a new optional `toolbarCenter` ReactNode prop on AppHeader. When provided, Row 2
     becomes 3 zones — tabs (flex:1) | center group (shrink) | toolbar (flex:1 end) — center TRULY
     centered like Row 1 (mid-x 719 vs 720); it wraps on narrow widths and never overlaps. Absent
     (Site/Markup) → the original 2-zone layout renders byte-for-byte unchanged. Generic + additive;
     B388 (the Schedule toolbar lift) is its first consumer. Deduped: net-new — NOT the CloudSyncBadge
     "NEW-1" (a Row-1 saveState concern), NOT the Markup toolbarContent move. lint 0 · 1201 tests ·
     build green · AppHeader/Scheduler/SitePlannerApp lazy chunks intact. -->

<!-- 2026-06-22: cross-chat "NEW-1" — Schedule Gantt drew phantom dependency arrows into empty
     space, pointing at unscheduled (blank-date) tasks. First filed B385, **renumbered B386** — a
     concurrent `main` (PR #289) took B385 for the Site Planner parcel-identify feature while this
     was in flight, so B386 is the real next free ID. Filed AND fixed + headless-verified (V109) +
     SHIPPED the same session per STANDING RULE #1 — merged to `main` via PR #290 (branch
     `claude/gifted-rubin-0adp7h`). Full [x] block lives in BACKLOG-DONE.md. -->

<!-- 2026-06-22: owner-dropped chat item "NEW-1" — add an "Add parcel" front-door to the Parcel
     left-hand panel so you never have to back out to the map to assemble more land. Highest B#
     across both files was B382, so minted **B383** (+ filed the deferred "Add by address" stretch
     as **B384**, still Open). Per STANDING RULE #1 B383 was filed AND fixed + headless-verified
     (V108, 14/14) + merged the SAME session on branch `claude/determined-volta-hzjxmc` — full [x]
     block lives in BACKLOG-DONE.md.
     WHAT SHIPPED: a primary **＋ Add parcel** control (accent chip) at the top of the Parcel
     `Section` opens an `AnchoredMenu` with (1) "Identify from county GIS" (arms the existing
     `identifyMode`; disabled-copy gate when `origin` is null) and (2) "Draw a new boundary"
     (`selectTool("parcel")`, always enabled — the no-GIS-frame fallback). The standalone
     "🔍 Identify parcel" toggle was CONSOLIDATED into that menu (no duplicate entry point); the
     armed-status row (the off-switch) + the identify result card / ＋ Add to plan / ⚖︎ Jurisdiction
     stay intact as the body of that path. Pure surfacing — reuses `addIdentifiedParcel` /
     `setParcels` / `identifyMode` / the parcel draw tool (no new add pipeline; same single-pipeline
     rule as B232/B233); added parcels keep `locked:true` (B99).
     Deduped: net-new. NOT B233 (that's the *map's* address→select+info card), NOT B231/B36c (the
     multipart-import pipeline it reuses), NOT B99/B100 (the lock/active model it inherits). lint 0
     · 1201 tests · build green · `SitePlannerApp` lazy chunk intact. B384 (Add by address) left Open
     by design — the geocode logic lives in MapFinder and needs a clean extraction, not a rush. -->

<!-- 2026-06-22: owner follow-up on B383 — "it should work like the map select parcel tool where the
     parcel boundaries light up and you can easily click to add one or multiple." Minted **B385**.
     Per STANDING RULE #1 filed AND fixed + headless-verified (V108 extended, 22/22) the SAME session
     on branch `claude/determined-volta-hzjxmc` — full [x] block in BACKLOG-DONE.md.
     WHAT SHIPPED: the "Identify from county GIS" path now behaves like the map's Select-parcels tool —
     while it's armed, the county parcel OUTLINES light up on the aerial (the SAME magenta esri-leaflet
     `makeParcelLayer`, extracted to shared `lib/parcelDisplay.js` so map + planner share one source),
     and each CLICK adds that lot straight to the plan (one or many); a re-click toggles a just-added
     lot off; a drag pans (click-vs-drag resolved in onUp, mirroring B310). The old preview-card-then-
     "＋ Add to plan" button is gone — the card now shows the just-added lot's appraisal + the kept
     jurisdiction lookup. Reuses the single add path (`parcelsFromRings`) + the existing query; outlines
     load at zoom ≥14 like the map (a "zoom in" hint below). Deduped: the headline-UX completion of B383
     (same item family), NOT B233 / B231. lint 0 · 1201 tests · build green · lazy chunk intact. -->

<!-- 2026-06-22: cross-chat "NEW-1" — the Schedule Gantt/timeline toolbar was reduced to a single
     floating Columns button (timeline zoom, Contacts, Export PDF/print, Version History, the
     Grid/Split/Gantt view switcher, Automation, Settings, Review all gone). First filed B380,
     renumbered **B381** — concurrent main (PR #284) took B380 for the Schedule render-crash fix while
     this was in flight, so B381 is the real next free ID. Per STANDING RULE #1 filed AND fixed +
     headless-verified (V106, 15/15) + merged the SAME session on branch `claude/vigilant-newton-rovl4l`
     — full [x] block lives in BACKLOG-DONE.md.
     ROOT CAUSE (hidden, NOT deleted): the Schedule module embeds /sequence/ in an iframe; the shell's
     Row-1 breadcrumb takes over project nav, so the sequence app hides its own duplicated nav when
     `.in-iframe`. But the rule was `.in-iframe .app-header{display:none}` — it hid the ENTIRE header,
     and the whole action toolbar lives in that header. Only the in-grid Columns button (in GridView,
     not the header) survived — exactly the reported symptom. Handlers were intact throughout; a pure
     CSS over-reach.
     FIX (public/sequence/index.html): narrowed the rule to hide ONLY the duplicated branding/nav —
     the logo (new .hdr-logo class), .hdr-mode (Dashboard/Projects toggle) and .hdr-project (project
     picker), all provided by the shell breadcrumb via the B203 postMessage bridge. The action toolbar
     is visible again, original position + original handlers. Restored exactly the shipped set — the
     brief's speculative fit-to-view / today-jump / status-filter controls do NOT exist in this app, so
     none were invented (no rebuild-from-guess).
     Verified: V106 `ui-audit/verify-schedule-toolbar.mjs` 15/15 (zoom % changes 17→33, Contacts opens
     — proven not no-ops); Site + Markup checked, NOT affected (not iframes; they use the shell's
     toolbarContent slot, which `.in-iframe` can't reach). lint 0 · tests green · build green ·
     `Scheduler` lazy chunk intact.
     Deduped: NET-NEW, the completion of B203 (DONE) — B203 bridged the NAV half of the same hidden
     header; B381 restores the ACTION-TOOLBAR half it left dark. NOT a dup of main's B380 (a separate
     Schedule render-crash race in Scheduler.jsx — different file, different cause), nor B341 (chrome
     token regressions), nor the Markup toolbarContent move. -->

<!-- 2026-06-22: cross-chat diagnosis brief "NEW-1" — intermittent render crash on Schedule load
     ("Cannot read properties of undefined"), caught by the workspace ErrorBoundary (the non-chunk
     "Try again" variant), recovers on re-render. Highest B# across both files was B379, so minted
     **B380**. Per STANDING RULE #1 filed AND fixed + headless-verified (V105, regression net proven
     to FAIL with the guard off) the SAME session on branch `claude/relaxed-dijkstra-sokq4a` — full
     [x] block lives in BACKLOG-DONE.md.
     ROOT CAUSE confirmed by reproduction, not guessed: the Schedule shell derives its breadcrumb's
     current project with `projects.find(p => p.id === activeId)` over the project list bridged from
     the embedded /sequence/ iframe (the brief's #1 candidate, Scheduler.jsx). The embedded app can
     transiently post a sparse/not-yet-resolved list (an `undefined`/null entry) during its own data
     load; one such entry makes `p.id` throw inside the Scheduler's render → the workspace boundary.
     A pure re-render recovers because the steady-state list is well-formed. (The brief's other
     candidates — AppHeader/ProjectBreadcrumb p.id/p.name, useProfile/displayName — were verified
     already null-safe; the deref that actually throws is the Scheduler's `.find`.)
     FIX (guard at the source, not optional-chaining everywhere): new pure `scheduler/lib/navState.js`
     — `parseNavState` validates + `sanitizeProjects` coerces the inbound list to plain `{id,name}`
     objects (drops the throwing entries) and `deriveCurrentProject` never throws / never returns
     undefined; Scheduler.jsx routes the message + current-project derivation through them; one
     data-entry guard in the shared `ProjectBreadcrumb` (`.filter(Boolean)`) hardens its own `p.id`/
     `p.name` map for any controlled caller. NOT a chunk fix (not B221/B239) and NOT an ErrorBoundary
     auto-retry — the race is removed so a genuine future crash still stays visible.
     Deduped: net-new. NOT B221/B239 (stale-chunk family — the brief's two tells rule that out), NOT
     B315 (undo-after-move stale-ref race, a different surface). 12 new unit tests
     (`test/schedulerNavState.test.js`), 1198 green, lint 0, build green, `Scheduler` lazy chunk
     intact; existing `verify-schedule-picker.mjs` still 8/8 (no regression). -->

<!-- 2026-06-22: owner report "the sheet labeling is atrocious" (a structural general-notes set)
     arrived with a two-item investigation brief (NEW-1 garbage labels, NEW-2 false auto-calibration).
     Highest B# across both files was B373, so minted **B378–B379**. Per STANDING RULE #1 BOTH were
     filed AND fixed + headless-verified (V104) the SAME session on branch `claude/ecstatic-maxwell-6y8aq1`
     — full [x] blocks live in BACKLOG-DONE.md:
       • B378 (NEW-1) — text-dense sheets labelled garbage: body boilerplate as the title, a body
         cross-reference ("S202") read as the sheet number on several rows, weak sidebar gate. Fixed
         the shared `sheetMeta` reader — title scorer now prefers short+large type (+ boilerplate
         filter), the sheet number is read from the title-block ZONE only (band, else edge strip),
         `reconstructLines` splits on a large horizontal gap so a title can't merge into a body line,
         a `trustedTitle` sidebar gate, and a `markAdjacentDuplicateNumbers` dedup. SHIPPED.
       • B379 (NEW-2) — a pure-text notes/specs sheet auto-calibrated off a stray body scale string.
         Added a `textDense` classification; `statedCalibration` returns 0 for it (leaves it
         uncalibrated, never silently mis-scaled). SHIPPED.
     +10 unit tests, 1153 green · lint 0 errors · build green · `DocReview` lazy chunk intact ·
     headless `ui-audit/verify-notes-sheet-labels.mjs` 9/9 + the B266/B348, B335–B339, B350 markup
     harnesses still green. -->

<!-- 2026-06-22: owner-dropped chat item — "the fact that I don't have an easy way to delete this little
     triangle that I put there is insane … go through all the tools and figure out what we need to debug."
     The "triangle" was an UNCALIBRATED Area measurement (its label falls back to "set scale"). Highest B#
     across both files was B373, so minted **B374–B377**. Per STANDING RULE #1 all filed AND fixed +
     headless-verified + shipped the SAME session (branch `claude/youthful-mccarthy-xjcotz`) — full [x]
     blocks live in BACKLOG-DONE.md:
       • B374 (bug) — the Area's FILLED interior was a DEAD click target (DocReview hitTest tested area by
         vertex/segment only, while rect/cloud already had an interior test, B33), so the triangle couldn't
         be selected to delete it. Added area point-in-poly to hitTest (reusing the now-exported
         takeoff.pointInPoly) + a smaller-shape tie-break + the perimeter/area closing edge. SHIPPED.
       • B375 (feature) — added an on-canvas × delete on the selected markup (deletion had been keyboard-only
         + a button buried in the collapsible Takeoff panel). SHIPPED.
       • B376 (feature) — the Takeoff list now lists + deletes EVERY markup (not just measures); the Stitcher
         — which had NO committed-measure delete at all — gets a deletable measure list. SHIPPED.
       • B377 (bug, found while verifying) — the B352 Tesseract OCR worker threw "logger is not a function" on
         every no-text page (defaultMakeWorker passed logger:undefined, clobbering Tesseract's default no-op);
         defaulted it to a no-op. Stitcher harness uncaught JS errors 13 → 0. SHIPPED.
     Verified: `verify-delete-markup.mjs` 10/10 + `verify-stitch-delete-measure.mjs` ALL PASS (chromium-1228,
     0 page errors); no regression (V72 13/13, B300–B302 green, V88 green). lint 0 · 1144 tests · build green. -->

<!-- 2026-06-22: coworker live-investigation brief (Site Analysis GIS failures on Grand Port /
     Mont Belvieu) arrived as NEW-1..NEW-4. Highest B# across both files was B365, so minted
     **B366–B369**. Per STANDING RULE #1 all four were filed AND fixed + verified + (about to be)
     merged the SAME session on branch `claude/nice-cori-ghm37q` — full [x] blocks live in
     BACKLOG-DONE.md:
       • B366 (NEW-1) — screening resilience + honest error taxonomy: a shared resilient ArcGIS
         fetch (timeout + jittered-backoff retry + GET→POST), a concurrency pool (3) that ends the
         burst, and a new UNAVAILABLE state (retryable, Retry control) — never the misleading
         "network or CORS". SHIPPED.
       • B367 (NEW-2) — GIS screening cache: keep last-good on a failed refresh + "couldn't refresh"
         age badge (stale-while-revalidate), never blank a layer. The existing roadmap "GIS layer
         caching" item, Phase 1. SHIPPED. (Phase 2 = regional snapshot → B371, Later.)
       • B368 (NEW-3) — repointed Wells/Pipelines from the Harris-County republication (Chambers
         14-vs-8,014 false-clean) to the authoritative statewide **RRC** service (wells L1, pipes L13);
         Wetlands pinned as a registered monitored-exception. SHIPPED.
       • B369 (NEW-4) — GIS Source Registry (`src/shared/gis/sources.js`) + a CI tier/inline-URL guard
         + live coverage/schema fixtures (the 14-vs-8,014 catch) + a weekly @claude drift workflow.
         SHIPPED for the analysis+jurisdiction surface. (Map-display-layer migration tail → B370, Open.)
     Deduped: NEW-2 folded into the existing "GIS layer caching" roadmap item (not a duplicate). lint 0
     · 1129 tests · build green · `SitePlannerApp` lazy chunk intact · headless V101 11/11. RRC's own
     live coverage fixtures run in CI / on planyr.io (host not on the sandbox egress allow-list). -->

### B370 — Migrate the remaining MAP-DISPLAY layer endpoints into the GIS source registry `[Site Planner / Platform]` (task) — the tail of B369 #site-planner #gis  *(filed 2026-06-22; minted **B370**)*
`[ ]` **Open.** B369 made `src/shared/gis/sources.js` the single source of truth for the **Site Analysis screen + jurisdiction identify** endpoints (zero inline URLs there, CI-guarded). The **map-display** layers — the Leaflet/esri-leaflet tile + vector overlays in `lib/layers.js`, `lib/counties.js` (`JURISDICTION_LAYERS`, incl. the COH `geogimstest` host), `lib/evidenceLayers.js`, `lib/vectorLayers.js` — still hold their service URLs inline. Migrate them into the registry too, so the tier-guard (no `/Test/`/`geogimstest` without an acknowledged exception) and the drift/coverage checks cover the **whole** GIS surface, not just the screen.
- **Why not done in the B366–B369 session:** the map-tile path is a **separate, large surface** (many layers across 4 files) and is explicitly **out of the reported bug's blast radius** — the brief notes map tiles load as `<img>` (no CORS, no screening logic) and says to leave them alone. Rushing a live-map-wide URL refactor into the same session risked breaking a working map with no fast headless way to re-verify every layer. Filing it as its own focused pass (own branch, per-layer verify) is the safe call, not a silent omission.
- **Plan:** add map-layer rows to the registry (reuse the same `tier`/`provider`/`coverage` shape); repoint `layers.js`/`counties.js`/`evidenceLayers.js`/`vectorLayers.js` to read `serviceUrl` from the registry; extend `ui-audit/gis-source-audit.mjs`'s inline-URL scan to those files; re-verify the map renders every layer (the existing `gis-verify/coverage-picker-verify.mjs` + a tile-load check). The known COH `geogimstest` **TEST** host (a long-standing KNOWN ISSUE) becomes a registered `monitored-exception` — finally machine-tracked.

<!-- 2026-06-22: owner-dropped chat item "NEW-1" — a deleted site (HOLLISTER) reappears (delete not
     persisting), both on reload (path A) AND mid-session without a reload (path B). First filed B366,
     renumbered **B372** — a concurrent `main` (PR #277) took B366–B371 (GIS Site Analysis resilience +
     source registry) while this was in flight, so B372 is the real next free ID. **Filed AND fixed +
     headless-verified + pushed THIS session per STANDING RULE #1** (branch `claude/cool-ride-pm0m2l`) —
     full [x] block in BACKLOG-DONE.md.
     KEPT AS ONE ITEM (owner said split only if path B has an independent cause): both paths share ONE
     root cause — the site you delete from the map is the one whose planner is still MOUNTED (you opened
     it, then went Back to map; it renders hidden, not unmounted). Deleting it unmounts that planner,
     whose persist-on-leave / beforeunload flush fired AFTER the delete and RE-WROTE the row → it returns
     mid-session on the next list refresh (B), and pullCloud's heal-the-split then re-pushes that
     local-only row to the cloud so it survives a reload too (A). Explains "only that project" — it's the
     one he had open. Deduped — NOT a dup of B276 (per-ITEM overlay tombstones inside one site) nor B127
     (cross-tab stale-write fold); this is whole-SITE delete durability + a loud cloud-delete failure.
     Fix: a per-tab delete tombstone in storage.js (saveSite refuses to re-create a deleted, absent row —
     the single chokepoint every resurrection path funnels through), deleteSite returns the cloud result,
     the App AWAITS it and shows a LOUD banner + re-pulls on a genuine cloud-delete error, and cloudDelete
     uses `.select()` so a 0-row no-op is distinguishable from a real removal. 9 new unit tests +
     headless V102 (`ui-audit/verify-b372-delete-durable.mjs`, 6/6, proven to FAIL with the guard off). -->

<!-- 2026-06-21: cross-chat "NEW-1" — redesign the project-status MAP markers for correct visual
     hierarchy (Pursuit was a thin dashed cool-blue hollow outline that vanished into the aerial while
     Complete shouted). Minted **B365** (a concurrent `main` took B362–B364 — bump-out resize, bonded-child
     rotation, scanned/DWG — while this was in flight, so B365 is the real next free ID; renumbered from a
     first-filed B362). Filed AND shipped + headless-verified (19/19, V98) THIS session per STANDING RULE #1
     — full [x] block in BACKLOG-DONE.md
     (branch `claude/trusting-cori-rkn2x3`). Deduped — NET-NEW, a redesign of (not a dup of): B161 (the
     building-marker shape kept; its inverted hollow-dashed Pursuit treatment replaced), B234 (the shared
     status token set — extended IN PLACE, the single source of truth the item asked for), B163/B236 (the
     progress-arc encoding — a separate concern, untouched). Re-hued statusTokens.js (Pursuit→coral,
     Active→blue-not-green) + index.css --status-* mirrors (contrast-audit green both themes); rebuilt
     MapFinder.jsx buildingPinIcon (solid fill, white halo, size tiers, SVG flag/pulse/pause/check glyphs,
     z-order by importance, fixed hit box); Dead hidden by default. -->

### B364 — Enable the scanned / image-only + DWG reading path for the no-text-layer minority `[Doc Review]` (feature) #doc-review #filing  *(2026-06-21, follow-up to B360's corpus tuning — owner asked to note it)*
`[~]` **Scanned/image-only half SHIPPED 2026-07-05 (browser OCR, no server needed — owner "take care of B364"); the REMAINING scope is the two owner-gated Cloud Run deploys below.**
- **✅ Shipped — the scanned path reads in the BROWSER, free:** the item's premise had gone stale (AUDIT-FIRST): since filing, B411a wired the shared Tesseract OCR runner (B352) into the Tier-1 FILING read, and B659 rebuilt the reader engines (viewport-transformed coordinates, set-aware titles, OCR-noise rejections). This session closed the last gap — the **Review rail** (`DocReview.scanSheets`) now runs the same OCR runner over no-text pages (lazy worker, capped 24 pages like the filing read, token-guarded, visible "Reading scanned sheets… n/m" note, honest "recognition unavailable" note when the engine can't load — LOUD-FAILURE, and a page OCR can't read stays a truthful "Sheet N"). **Verified on the owner's REAL scanned set** (Mesa Electrical B1 — the exact file the item cites as extracting "~nothing"): headless run of the built app reads "ELECTRICAL BUILDING 1 SITE PLAN · E-1", "…POWER PLAN · E-3", "…PANEL SCHEDULES PLAN · E-5" — every sheet number E-1…E-5, 3/5 titles clean (residual: OCR noise can still win a title on a dense page; numbers unaffected). Colon-label/bracketed-note title rejections added from this run's findings.
- **⏳ Remaining (owner-gated — needs accounts/keys Claude cannot provision; parked in OWNER-TODO "Deferred"):**
  - **Tier-2 AI read** (B299 `server/filing/`) for the rare scan the free path can't read: `gcloud run deploy` + `ANTHROPIC_API_KEY` + `DOC_FILING_URL` + `VITE_AUTOFILE_ENABLED=1`. The proxy 503s until then (graceful skip) — purely additive.
  - **DWG → DXF** (B238 `server/convert/`, LibreDWG → APS) so a `.dwg` drop can be read at all; a `.dwg` today is loudly rejected ("Not a PDF"), never silently dropped.
Both are walled-off compute (Cloud Run); keys server-side only. Until deployed, the browser path covers scanned sets and `.dwg` holds safely as export-a-PDF.

### B309 — Retire client-side Mapillary token paths once the proxy lands `[Site Planner]` (task) — depends on B308 #site-planner #gis  *(arrived as coworker-chat "NEW-2" 2026-06-20; first filed B304 then renumbered **B309** — concurrent `main`'s Doc Review batch took B303–B307)*
`[~]` **Partly done via B308 (2026-06-21).** The same-origin proxy is now the DEFAULT path and the in-app `MLY|…` box is already reframed as an **optional power-user override** (no token entry required). **Remaining, only AFTER B308 is confirmed live on Production:** drop the now-dead `VITE_MAPILLARY_TOKEN` read in `evidenceLayers.mapillaryToken()` (a baked VITE var would re-expose a token — the audit finding), and make the final call on the override box (keep as advanced, or remove). Held until B308's live confirm so the only working path isn't removed before the proxy is proven.
> **Dedup:** the cleanup half of B308; strictly **depends on B308 verified live**. Net-new.

<!-- 2026-06-20: owner-dropped batch (chat) NEW-1..NEW-3 — Document Review STITCH + MARKUP safety
     guards. Minted **B300–B302** (highest B# across both files was B299 after concurrent `main`'s
     B288–B299 batches landed; my first-filed B288–B290 collided with main's single-sheet-viewer
     B288–B296, then a second filing at B299–B301 collided with main's auto-filing **B299** (PR #222),
     so renumbered to the next clear band **B300–B302** — the rules forbid two items sharing a number).
     **Filed AND fixed + headless-verified + pushed THIS session** (branch
     `claude/admiring-hypatia-xjv8a1`), per Standing Rule #1 — full [x] blocks live in BACKLOG-DONE.md:
       • B300 (NEW-1) — Stitcher Align had no degenerate-baseline guard; coincident clicks flung the
         sheet because solveM's `Math.hypot(vb)||1` masked a zero baseline → extreme transform. FIXED.
       • B301 (NEW-2) — measuring over a not-yet-aligned sheet silently used the composite (sheet-1)
         scale. FIXED — per-sheet `aligned` state + visual flag + a warn-on-measure banner.
       • B302 (NEW-3) — a 2-point Area (0 sf) / 2-point Perimeter (single segment) was committable via
         Enter AND double-click. FIXED — both finish paths now need ≥3 pts via `canCommitMeasure`.
     Deduped — all net-new: NOT duplicates of main's single-sheet-viewer **B288–B296** (zoom/pan/markup-
     edit on the SAME DocReview.jsx, a different concern — the stitcher + the measure-commit guards are
     untouched there) nor its auto-filing **B299** (server-side title-block read), nor B181/B182/B183
     (the *map* placement cascade) or B130/B131 (parking). B300/B301 added a pure `lib/stitchGeom.js`
     (extracted from Stitcher.jsx so the transform math is unit-testable); B302 extended `lib/takeoff.js`
     and tightened main's B291 double-click finish to the same ≥3 gate. lint 0 · build green · headless
     `ui-audit/verify-b300-b302.mjs` 14/14 (chromium-1228, per main's V72 note). -->

<!-- 2026-06-20: owner-dropped batch (chat) NEW-1..NEW-9 — Document Review SINGLE-SHEET (Markup) viewer
     interaction: zoom/pan/navigation + drawing correctness + markup editing. Minted **B288–B296**
     (renumbered from a first-filed B273–B281: by merge time concurrent `main` had consumed B273–B281
     outright — the Infra/E2E tranche B278/B280/B281 + telemetry B279, the data-integrity B274/B275, and
     filing/lockout B271–B273/B276/B277 — so two items would share a number, which the rules forbid; this
     batch lands at the next clear band **B288–B296**). NOTE: a SEPARATE, earlier 2026-06-20 batch already
     landed as B265–B269 (devicePixelRatio render, title-block sheet labels, scale-callout calibration,
     scale cross-check, fixture cleanup); same file (DocReview.jsx), different concern.
     Deduped before filing — none duplicate an existing Open or Done item:
       • B288/B289/B290 (wheel/ctrl/pinch zoom · drag-pan · cursor-anchored ±) — NO open item covers the
         single-sheet viewport nav. The Stitcher already ships exactly this (cursor-anchored `onWheel`
         L171 + pointer-drag pan L158/L168) — PORT it, adapted to DocReview's re-rasterize/scroll model
         (it redraws the PDF to a `<canvas>` at `scale` inside an `overflow:auto` scroller rather than
         transforming a fixed-res image, so anchor via `scrollLeft/Top`, not a pan/zoom matrix). Distinct
         from B265 (DONE — devicePixelRatio render fidelity, a different "blurry" bug). The pan work cross-
         references B271 (main: frozen grab/hand cursor after an interrupted gesture) — release
         pointer-capture + clear state on pointerup/pointercancel so we don't reintroduce it.
       • B291 (double-click phantom points) — net-new; takeoff-correctness, HIGH. Mirror the Site Planner
         finish path (`finishActiveDrawing()`/`removeLastVertex()` L2747/L2761; `finishMkPoly` already
         filters consecutive-coincident vertices L2066).
       • B293 (move + edit a placed markup) — ADJACENT to the open B155 (shared interior hit-testing) +
         B156 (hover highlight): B155 makes a markup SELECTABLE, B293 makes a selected one MOVABLE +
         (text) EDITABLE. B155's end-state vision already lists "interior drag moves / double-click edits";
         B293 ships that on the Doc Review surface now (B155's cross-surface shared-`hitTest` refactor stays
         open). B293 also moves Doc Review's text create/edit off `window.prompt` to an inline editor —
         satisfying the KEY DECISION "no dialog-box edits" rule + the B155 note (calibrate's prompt stays,
         tracked under B155).
       • B292/B294/B295/B296 — net-new, no overlap.
     Per STANDING RULE #1 filed AND fixed the same session, then SHIPPED via **PR #220 → `main`** (branch
     `claude/amazing-fermi-e2xul4`). Headless-verified 13/13 in a real browser (VERIFICATION **V72**,
     `ui-audit/verify-docreview-viewer.mjs`, 0 page errors) — incl. cursor-anchored wheel zoom (0.4px drift),
     exact drag-pan, the B291 phantom-point fix (3 dots not 5), markup move, and inline text create/edit;
     B296 has a unit test, B294 reuses the proven `openFile` path. lint 0 · 563 tests · build green. NB the
     older sandbox Chromium-1194 can't raster pdf.js (it throws `getOrInsertComputed`); the newer
     **chromium-1228** build runs it — Doc-Review headless checks must use 1228 (corrects the V63/V65
     "can't run pdf.js" note). These 9 are shipped — eligible to move to BACKLOG-DONE.md on a future pass. -->

<!-- 2026-06-20: owner-dropped chat batch NEW-1..NEW-4 (data-integrity / multi-session safety +
     overlay lifecycle). ALL FOUR fixed + shipped this session → BACKLOG-DONE.md. Numbers churned hard
     under a very hot `main`: the overlay pair landed as **B276** (delete persistence) + **B277**
     (visibility), merged via PR #217 (LIVE); the data-integrity pair — first filed B274/B275, briefly
     B297/B298 — was renumbered to **B314** (optimistic concurrency / reject stale saves) + **B313**
     (multi-tab warning) once `main`'s numbering reached B312. ✅ The B314 migration
     (src/workspaces/site-planner/db/optimistic_concurrency.sql) was RUN by the owner 2026-06-20, so the
     guard goes active on deploy; remaining is one signed-in two-session check — VERIFICATION V79. -->

<!-- 2026-06-20: owner-dropped batch (chat) NEW-1..NEW-4 for Document Review (Markup) — sheet labels,
     render fidelity, scale intelligence. Provisionally B246–B249; concurrent `main` repeatedly advanced
     and re-used every ID in between (dock-zone build-out, the Scheduler backlog + its B261–B264 renumber,
     the B260 overlay-scale bug), so this batch landed at the real next-free IDs after B264: **B265**
     (render fix, shipped) + **B266** (sheet labels) + **B267** (auto-calibrate) + **B268** (cross-check)
     + **B269** (sample-fixture cleanup). Deduped — Markup-facing siblings of an EXISTING tranche, REUSE
     not duplicate:
       • B266 (sheet labels from title block) ↔ B180/B181 title-block read pass; page.getTextContent() + detectSheet() (B73).
       • B267 (auto-calibrate from stated scale) ↔ B73's parseScaleNote/ftPerPointForScale (same feet-per-point unit as calByPage) — extend for architectural/ratio forms; ↔ B181.
       • B268 (cross-check vs graphic scale bar) ↔ B182/B183 (geometry-beats-printed-scale + "flag disagreement, never silently choose" already locked); B181 captures the scale-bar facts.
     **B265 (NEW-2, the PDF render-fidelity / devicePixelRatio bug) — FIXED, headless-verified (verify-new2-dpr.mjs, V65), SHIPPED via PR #205; full block in BACKLOG-DONE.md.**
     **Corpus in hand (blocker lifted):** owner supplied two real sets 2026-06-20 (KG B1 ARCH IFP 19pp @36×24″; Jacintoport Fire-Sprinkler IFC 9pp @42×30″; PR #207 / branch mikeab7-patch-1) — both vector text, real architectural scales (1/16″=1′-0″, 1/4″=1′-0″) + "NOT TO SCALE" + standard plot sizes — so B266/B267/B268 are ready to build/verify. OCR fallback required for scanned sheets (owner). B269 tracks removing the sample binaries after the features are verified. -->

<!-- ✅ B266 (Sheet sidebar labels — real sheet # + title, not "Sheet N") SHIPPED 2026-06-21 as a
     follow-up to #242, together with B348 (collapse the Markup sidebar into logical sheets). Built on
     #242's shared reader/grouping engines; full [x] blocks in BACKLOG-DONE.md. The OCR-for-scanned slice
     stays tracked under B267 (`[~]`) + #242's dormant OCR seam. -->

### B267 — Auto-calibrate a sheet from its stated scale callout `[Doc Review / Markup]` (feature) #doc-review #markup  *(arrived as "NEW-3" 2026-06-20; renumbered **B267**; batch B265–B269)*
`[~]` Detect a stated-scale callout and **auto-set that sheet's calibration**, replacing the **"Sheet N not calibrated — use Calibrate"** prompt (`DocReview.jsx`) when confidently found. **Per-sheet** (a set mixes scales; a sheet with no graphic scale stays uncalibrated, **never inherits a neighbour's**). **"NOT TO SCALE"/"AS NOTED"/unparseable → leave uncalibrated and say so explicitly** (*not present* ≠ *couldn't parse*).
- **✅ Shipped this session — embedded-text path (branch `claude/friendly-euler-hw8v1t`).** New **`parseSheetScale()`** (`overlayScale.js`) reads engineer's (1″=50′), **architectural fractional** (1/4″=1′-0″ → 4 ft/in), **ratio** (1:200), and explicit **NOT TO SCALE / AS NOTED** — each with its own sane range; the civil `parseScaleNote` is left untouched (Site Planner overlay). `pdf.js` `extractPageText()` reads the page text; `DocReview.jsx` runs a **background per-sheet scan** on open → fills `calByPage` (gated on `detectSheet()` standard plot size) + a new `calInfo {src,label}` driving the sidebar (·≈ auto / ·✓ manual) and the badge ("scale from sheet … verify" / "NOT TO SCALE" / "calibrated"). Per-sheet, never overwrites a manual/loaded cal, persisted; opening a different file resets cals (a cross-document bleed bug found + fixed during verification). **7 unit tests + verified on the owner's real sets** (`ui-audit/verify-new3-autoscale.mjs`, **V67**): KG B1 **17/19** auto-calibrated (no-scale cover left alone), Jacintoport all **NOT TO SCALE**, 0 bleed. lint 0 · 569 tests · build green.
- **⏳ Remaining slice — OCR fallback for scanned/raster sheets (owner: REQUIRED).** `extractPageText()` returns "" on a scanned page (the seam); the fallback (Tesseract.js in a Web Worker / server-side → rasterize → OCR → `parseSheetScale`) needs a **scanned sample** to build + verify (the owner's two sets are vector, so the shipped path covers them today). Kept `[~]` until OCR lands; shared OCR path with **B266**.
- **Design (as built):** extended `parseScaleNote`'s domain via a sibling `parseSheetScale` rather than loosening the civil 10–1000 floor (architectural ft/in fall below it). A title-block "SCALE: NOT TO SCALE" wins outright; otherwise a real numeric plan scale beats a stray "NTS" detail note. Gated on `detectSheet()` + labeled "from sheet scale — verify". Co-designs with **B268** (the geometry cross-check that catches a non-1:1 plot) / B181 / B182 / B183.

### B268 — Independent scale cross-check against on-sheet geometry (verify the stated scale) `[Doc Review / Markup]` (feature) — depends on B267 #doc-review #markup  *(arrived as "NEW-4" 2026-06-20; renumbered **B268**; batch B265–B269)*
`[ ]` After B267 sets a scale from text, **independently check** it by measuring a known on-sheet reference — primarily the **graphic scale bar** (the printed ruler), which survives plotting/resizing where stated-scale text doesn't. Agree within tolerance → **"verified"**; disagree → **surface loudly, make the user choose — never silently pick one** (silent wrong-calibration is crash-severity; it poisons every downstream takeoff). No scale bar → report **"no reference found"**, don't fail.
- **Decision recorded (owner's lean, matches the locked principle):** on disagreement **default to the scale bar (geometry) but flag it loudly**, one-click override to the stated scale — *not* a silent choice. Matches **B182** ("geometry beats printed scale") + **B183** ("flag disagreement as a distinct state, never silently average/choose"). Flip to "always force a manual pick" if preferred.
- **Reuse:** **B183** already shipped the cross-check *primitives* for the Site Planner cascade; this is the **Markup-canvas application** to scale-bar-vs-stated-scale. **B181** captures the scale-bar facts. The owner's sets also carry **labeled dimensions** ("38′-7 3/4″") — a second independent reference.
> **Ready to build (largest of the three).** Needs **graphic-scale-bar detection/measurement** (locate the printed ruler on the raster + read its annotated length — light CV), now testable on the owner's sets; depends on B267; ships *with* the loud-surface UI.

### B269 — Remove the uploaded sample drawing PDFs from GitHub (test fixtures, not for `main`) `[Doc Review / repo hygiene]` (task) #doc-review #testing  *(owner-requested 2026-06-20; renumbered **B269**; batch B265–B269)*
`[ ]` The owner uploaded two real construction sets as build/test fixtures — **"2025.06.30 KG B1 - ARCH IFP REDLINE.pdf"** (6.2 MB) + **"Jacintoport - Fire Sprinkler IFC.pdf"** (6.4 MB) — on branch **`mikeab7-patch-1`** (PR **#207**). Needed to build/verify **B266/B267/B268**, but **NOT for merging into `main`** (12 MB+ of binaries would bloat the repo history permanently). **Do NOT merge PR #207.**
- **Disposition:** keep the fixtures reachable until B266/B267/B268 are verified against them, **then close PR #207 + delete the `mikeab7-patch-1` branch** (or relocate fixtures to the private Supabase `doc-review-files` bucket). The owner plans to drop **more** sample files on the same branch for filing-workflow practice — same disposition.
> Tracked explicitly so the big binaries don't silently ride into `main` (owner ask).

### B273 — Filing-workflow practice: read a dropped file's title block → propose its project / discipline / sheet / date `[Doc Review / filing]` (task) #doc-review #filing  *(owner-requested 2026-06-20; minted **B273** — concurrent `main` took B270–B272 while this was in flight)*
`[ ]` The owner is dropping sample files specifically to **practice filing** them. Until the backend auto-filer (B180/B181) is deployed, demonstrate the *logic* in-session: for each dropped PDF, **read its title block** (reuse B266's title-block reader + the `extractPageText` / `parseSheetScale` plumbing already shipped for B267), extract **{project, discipline, sheet #, revision, doc date}**, and **propose the filing** — which project + discipline folder + the `"<Project> - <Item> - YYYY.MM.DD"` name — for one-click confirm. This serves the owner's practice request AND **exercises/validates the title-block reader** that B266 and the real auto-filer depend on. **No-auto-guess:** low-confidence / no-match → a "needs filing" proposal the owner confirms, never a silent route.
- **Heads-up (owner, 2026-06-20):** more sample files are incoming on `mikeab7-patch-1` for this — run the prototype on them (and the existing KG B1 / Jacintoport sets), report the proposed filing, don't auto-commit.
> **Dedup:** NOT a new filing system — a manual/prototype run of the **existing auto-filing spec (B180/B181)**; findings feed those. Distinct from **B270** (the persistent drop-zone + upload queue — the ingestion *plumbing*, already shipped); this is the title-block→routing *intelligence* on top. Dropped files follow **B269**'s fixture disposition (don't ride into `main`).

<!-- 2026-06-20: owner-dropped batch (chat) NEW-1..NEW-4 — the "deliberate Group" tranche for the Site
     Planner. Minted **B261–B264** (highest B# across both files was B246, so these are the real next free
     IDs). Deduped before filing: no prior OPEN item covers a Group tool / snap-alignment-only / snap-pref-
     stickiness / per-plan delete. The relevant prior art is the DONE **B114** (Shift-drag snap+bond + the
     S-key snap toggle) — B261 replaces its *bonding* half with an explicit Group, B262 strips the bond so
     snap only aligns, and B263 fixes the snap pref's global stickiness; B114's toggle + Alt-bypass survive.
     The owner-mentioned "earlier split-snap item" was that B114 family (done), not a separate open item.
     The still-open, owner-gated **B115** (keyboard-shortcuts pass) referenced the now-removed ⇧-drag bond
     gesture; its in-app shortcut table was updated here (B115 itself stays open for the deliberate remap
     pass). All four filed AND shipped this same session on branch `claude/eager-keller-1ueisx` — full
     blocks moved to BACKLOG-DONE.md; self-verified headless (ui-audit/verify-b261-b264.mjs, 14/14, 0 page
     errors), VERIFICATION **V64**. lint 0 · 537 tests · build green. -->
<!-- 2026-06-20: owner dropped his old "Planar — Engineering Backlog" (2026-05-26 code review, re-verified
     2026-06-19) for the **Scheduler** app (`public/sequence/index.html`), said "log this" + "don't worry
     about the email feature." Filed under `[Scheduler]` as B247–B259. The safe wins (B247–B253) were filed
     AND shipped this session → BACKLOG-DONE.md. Remaining below: B255 (a refactor); B256–B259 are
     gated/optional/project items under 🕓 Later / Roadmap. B254 (the 5s Snap/Free chip) was resolved —
     owner said leave it as-is (2026-06-20) → moved to BACKLOG-DONE.md. Email excluded per owner; the
     doc's already-shipped items (orig B2/B6/B8) were not re-filed. -->

### B255 — Collapse the duplicate indent/outdent + column-autosize functions `[Scheduler / code health]` (task) #scheduler  *(orig "M2"; minted **B255**)*
`[ ]` Two near-identical copies each of: indent/outdent — keyboard `indentTask`/`outdentTask` vs right-click `indentTaskById`/`outdentTaskById` — and column autosize — `autoSizeCol` (grid) vs `autoSizeMCol` (master). Merge each pair into one helper that takes the task id / column set as a parameter (keyboard passes `selectedId`, menu passes the ctx id). **Verify equivalence first** (the doc warns they may have drifted; if they have, decide which behaviour is canonical before merging) and verify keyboard vs menu produce identical results. Pure maintainability — no user-visible change — so it was kept *out* of the B247–B252 bug-fix shipment to isolate refactor risk on a live tool; pick it up as its own focused pass.

<!-- 2026-06-20: filed from chat (arrived as "NEW-1"/"NEW-2") — resilient county parcel fetch. Minted
     **B244** (NEW-1: resilient fetch + TxGIO statewide fallback) + **B245** (NEW-2: validate the ArcGIS
     response BODY, not just HTTP status) — concurrent `main` took B239–B243 while this was in flight, so
     B244/B245 are the real next free IDs after B243. Deduped before filing: B244 is the RESILIENCE layer
     on top of the already-done **B137** (which made TxGIO a queryable *candidate* — coverage); B244 adds
     the 8s AbortController timeout (the ~45s freeze fix), a per-source circuit breaker, honest "statewide
     backup" labeling, the search-side county-scoped fallback, and TxGIO field normalization. B245 extends
     **B233**'s "unavailable vs no-parcel" split down into the fetch layer (typed ParcelFetchError) and
     reuses the `probeService` body-parse principle (HTTP 200 + .error = failed). Distinct from **B36e**
     (AbortControllers on the busy-gated evidence-fetch path). Both filed AND shipped this same session —
     full blocks moved to BACKLOG-DONE.md; live headless verified with FBCAD simulated down → Fort Bend
     lot selected from TxGIO in 1.2s + backup notice shown (VERIFICATION V61). -->

<!-- 2026-06-20: owner-reported (chat, w/ 3 screenshots) that "Print" opens a blank `about:blank`
     window and routes through the BROWSER's print dialog — which stamps a date/time header, the
     about:blank URL, and a page number onto the output, bleeds a cream page background (more ink),
     and (Letter content dropped on a Tabloid sheet) doesn't fill the page. Filed **B243** (arrived
     as "NEW-1"; minted B228, renumbered **B243** — concurrent `main` took B228–B242 while this was
     in flight, so B243 is the real next free ID after B242).
     **Inspected the current print code first (as the owner asked):** the path ALREADY composes the
     whole sheet as ONE SVG at the exact page size (B200/B197/B201) — the only problem is the final
     DELIVERY step (`window.open` + `win.print()` hands it to the browser's print dialog; the cream
     is `PAL.paper` bleeding into the sheet fill + the plan-clone bg rect). Fix keeps the composition,
     replaces only the delivery: rasterize the sheet at 300 DPI → JPEG → a Planyr-built PDF download.
     **Deduped:** NO existing open item covers this (the owner-suspected dupes — "per-layer print
     inclusion list", "PDF export embedding plan data for re-importability" — do not exist as open
     items; JSON re-import already ships as Export JSON). RELATED: **B131** (overlay-in-print toggle,
     done) is PRESERVED — the `printOverlay` checkbox still gates the placed overlay in the export;
     **B50** (export/print robustness) is partly SUPERSEDED for the print path (the old "don't strand
     a blank Preparing… window" guard is moot — there's no window now). **B361/B160** are the
     *Scheduler* Gantt PDF/Print export (a different module), not this. Filed AND shipped this same
     session — moved to BACKLOG-DONE.md; browser-verified (VERIFICATION **V60**). -->

<!-- 2026-06-20: owner-reported (chat, with finished artwork + brief) the new Planyr coral brand
     mark — the favicon/app-icon swap + coral tokens/BrandMark component. Arrived as "NEW-1"/"NEW-2";
     provisionally B230/B231, but `main` advanced repeatedly during the work (B230–B239: Bluebeam
     vertex editing, detention pond, map-finder tranche, stale-chunk hardening, dock-zone fixes),
     so renumbered to the real next free IDs **B240/B241** at merge time. Deduped: no prior favicon/
     app-icon or brand-token/BrandMark item (B3 = brand *spelling*; B104/B10 = the unified-header
     consolidation that B241's logo slot plugs into — orthogonal). Both filed AND shipped this same
     session — moved to BACKLOG-DONE.md. Canonical artwork + the dependency-free icon generator live
     in brand/. -->

<!-- 2026-06-20: owner-reported (chat) "my scheduling module not working — this is obviously a huge
     deal." Filed B228, renumbered B239 — concurrent `main` took B228–B238 while this was in flight, so B239 is the real next free ID.
     Root cause confirmed = the SAME stale-chunk-after-deploy family as B221 (the open/returning tab
     holds a previous build's index.html → its content-hashed Scheduler-<hash>.js 404s after redeploy),
     NOT a Scheduler/iframe logic bug — ruled out: the embedded Gantt renders 44 task rows the instant
     its chunk loads (ui-audit/diagnose-scheduler.mjs). B221 already auto-reloads, but two recovery gaps
     let it still dead-end: (1) a plain location.reload() can be served the browser's OWN hard-cached
     stale index.html → same dead chunk → cooldown → error screen (the no-cache _headers can't retro-fix
     an already-cached HTML); (2) the ErrorBoundary's PRIMARY button was "Try again" (re-renders the same
     dead lazy import — a no-op for this error). Deduped against B221 (this hardens it, same family) and
     the PDF.js import() items (B72/B67/B180 — unrelated on-demand library loads). Filed AND shipped this
     same session — moved to BACKLOG-DONE.md: B239 (reloadFresh cache-busting reload + chunk-aware
     ErrorBoundary "A new version of Planyr is ready / Reload to update", in src/app/chunkReload.js +
     ErrorBoundary.jsx; _headers unchanged). Browser-verified (VERIFICATION V58). -->

<!-- 2026-06-20: filed from chat (arrived as "NEW-1"/"NEW-2"). Concurrent main took B227–B236 while
     this was in flight, so these renumbered to **B237** (two-backend architecture doc) + **B238**
     (DWG→DXF conversion service) — the real next free IDs after B236. Deduped before filing: NEW-1
     RECONCILED the existing "Two backends — don't conflate" section in CLAUDE.md in place (no
     duplicate section); NEW-2 ADDED server/convert/ to the ALREADY-EXISTING /server scaffold (the
     B206–B209 Drive storage layer was there — /server was not absent), reusing the shared
     no-silent-failure result.js. Both filed AND shipped this same session — full blocks moved to
     BACKLOG-DONE.md. -->

<!-- 2026-06-20: owner-dropped batch (chat) NEW-1..NEW-5 for the Site map finder. Renumbered twice
     under a hot `main` (B225–B229 → B230–B234 → **B232–B236**; concurrent PRs #188–#191 + #190
     took B225–B231). Filed AND shipped this same session on branch `claude/tender-goldberg-ax4n5w`
     — all five moved to BACKLOG-DONE.md: B232 (address search recenters — Esri geocoder biased to
     the map, replaces the no-bias Nominatim that returned nothing for bare street addresses), B233
     (address search selects the parcel + shows its appraisal info, reusing the click pipeline + the
     planner's appraisal labeller; source-unavailable ≠ no-parcel-here), B234 (one shared status-
     token set — color + glyph per state — across chips, list markers, and map pins; module accents
     confined to the tab row; amends B161's pins), B235 (left rail: chips-as-filters + type-to-filter
     + collapsible status groups, Complete/Dead collapsed by default; consumes B234), and B236
     (per-layer source-vintage stamp, distinct from refreshed-age; "vintage unknown" never
     fabricated; the ship-now half of B96's data-age surfacing). All self-verified headless (V57). -->

<!-- 2026-06-20: B230 (Bluebeam vertex editing — drop the always-on "+" midpoint handles; Shift-click /
     right-click an edge inserts a control point; right-click a vertex / Delete removes one; candidate
     dot on edge-hover; portal-mounted menu; built once in a shared layer for parcels / polygon elements /
     measures / markup poly-line / easements) + B231 (cartographic detention pond — radial steel-teal
     gradient, constant teal outline, no orange, no wavy hatch, Inter slate label). Both arrived as
     "NEW-1"/"NEW-2"; provisionally B221/B222, renumbered **B230/B231** — concurrent `main` (PRs #184/#186/
     #188/#189/#191) took B221–B229 (lazy-chunk recovery, Schedule fixes, building-button gating, Yield-
     panel redesign, dock-zone stack) while this was in flight, so B230/B231 are the real next free IDs
     after B229. Filed AND shipped this same session — moved to BACKLOG-DONE.md; self-verified headless
     (ui-audit/verify-b221-b222.mjs), V56. -->

<!-- 2026-06-20: B228 (building-anchored dock-zone stack with LIFO +/−) + B229 (Dock Features
     panel reorg) — owner-reported (chat), arrived as "NEW-1"/"NEW-2"; filed provisionally as
     B221/B222 but concurrent `main` took B221–B227 (PRs #186 lazy-chunk reload, #188 B225/B226
     feature-button visibility, #189 B227 yield panel, #184 B222–B224 Schedule) while this was in
     flight, so renumbered to the real next free IDs **B228/B229** at merge time. Filed AND shipped
     this same session — moved to BACKLOG-DONE.md. Deduped vs B71 (trailer curb) / B78 (stall-layout
     freeze) AND vs main's B225/B226 (#188 size-GATES these feature buttons — orthogonal: that's
     button visibility, this is the zone stack the buttons drive). REUSES the existing court /
     far-side-trailer / bump-out machinery rather than re-adding it. -->

<!-- 2026-06-20: owner-reported (chat, w/ screenshot) the building feature-edit buttons spill
     into an unreadable cluster past the footprint edges when zoomed out. Filed B225 (NEW-1:
     size-gate the buttons) + B226 (NEW-2: only on the selected/hovered building) — highest B#
     across both files was B220, so B225/B226 are the real next free IDs. Deduped: the buttons
     ALREADY rendered only on the selected building (never all), so NEW-2 folded into NEW-1 as
     ONE visibility rule (footprint-size gate AND selected-or-hovered, hover added). Both filed
     AND shipped this same session — moved to BACKLOG-DONE.md; browser-verified (VERIFICATION
     V53). -->

<!-- 2026-06-20: owner-reported (chat) "Document Review (and all lazy modules) fail to load after a
     deploy — Failed to fetch dynamically imported module." Arrived as "NEW-1"; provisionally B218,
     renumbered **B221** — concurrent `main` (PR #183) took B218 (dead header controls) + B219
     (map-furniture restyle) and a parallel session took B220 (map-finder over-zoom) while this was in
     flight, so B221 is the real next free ID after B220 (the branch's first commit + the PR say "B218").
     Root cause confirmed = the standard Vite stale-chunk-after-deploy problem (an open tab holds the
     previous build's index.html → references the old content-hashed chunk filenames, which 404 once the
     new deploy replaces them), NOT a DocReview logic bug and NOT a broken build. Deduped against the
     PDF.js import() items (B72/B67/B180 lazy-load a heavy library on demand — unrelated). Filed AND
     shipped this same session — moved to BACKLOG-DONE.md: B221 (global vite:preloadError reload-once
     guard with a sessionStorage loop-guard, in src/app/chunkReload.js + src/main.jsx, applied to every
     lazy workspace; Cloudflare public/_headers — no-cache HTML / immutable hashed assets). -->

<!-- 2026-06-20: B220 (map-finder Esri imagery over-zoom placeholder — recurrence of B182,
     the planner-canvas fix that missed the map-finder call site). Minted B218, renumbered
     B220 — concurrent `main` PR #183 took B218 (dead header controls) + B219 (map-furniture
     restyle) while this was in flight. Filed AND shipped this same session — moved to
     BACKLOG-DONE.md. -->

<!-- 2026-06-19: owner-reported (chat) "can't access my scheduling projects — this is imperative."
     Filed B203–B205 (arrived as B194–B196, but concurrent `main` #169–#172 minted B194–B202 for
     the project switcher / trailer labels / scale bar / print tranche, so renumbered to the real
     next free IDs at merge time). ALL THREE filed AND shipped this session — moved to
     BACKLOG-DONE.md: B203 (Schedule picker showed Site projects — CRITICAL data-access), B204
     (module-contextual home crumb: "Map" in Site, "Dashboard" in Schedule), and B205 (the owner
     clarified via screenshot that the "center map" he meant was the planner's redundant center
     "‹ Map" back-button — now that B204 renamed the breadcrumb crumb to "Map" there were two;
     removed the center one). -->

<!-- Filed 2026-06-19 from the Cowork storage-backend chat (arrived as "NEW-1".."NEW-4"). Provisionally
     B203–B206 (highest was B202 when filed), but concurrent `main` shipped B203/B204 (Schedule picker,
     home crumb) + filed B205 (center map) while this was in flight, so renumbered at merge time to the
     real next free IDs **B206–B209**. These are the /server file-storage tranche UNDER the file-filing
     UI (B180) + auto-filing. Per the owner: live Google Drive wiring is blocked on his manual Workspace
     + OAuth setup (being done in parallel with Cowork), so the architecture (B206), the link abstraction
     (B208), and the no-silent-failure contract (B209) are BUILT + tested now, with the Drive backend
     (B207) scaffolded behind them. Code in server/storage/ (walled off from the public Pages build); see
     server/storage/README.md for the exact env/credentials the Drive backend needs from Cowork. -->

<!-- 2026-06-23: B207 (Google Drive storage backend) — ✅ DONE, moved to BACKLOG-DONE.md. The code was
     already complete + unit-tested (a prior session advanced it past the brief's "scaffold"), and the owner
     CONFIRMED all Drive env vars present + deployed live in Cloudflare Pages Production — GOOGLE_CLIENT_ID /
     GOOGLE_CLIENT_SECRET / GOOGLE_REFRESH_TOKEN / PLANYR_STORAGE_BACKEND=drive / SUPABASE_URL /
     SUPABASE_ANON_KEY — verified 2026-06-22 against deploy 912de2b (green), with the temporary
     PLANYR_SELFTEST_TOKEN correctly removed. ⛔ DO NOT re-run the OAuth setup / re-mint GOOGLE_REFRESH_TOKEN:
     a fresh consent would mint a new token that no longer matches the deployed one and could take Drive
     filing offline. Only optional follow-up = a signed-in end-to-end re-confirmation (already passed
     2026-06-20). Full [x] block in BACKLOG-DONE.md. -->

### B180 — Project Files repository as a tagged-index with saved views `[Document Review / Files]` (feature) #doc-review #files  *(arrived as "NEW-1"; provisionally B176, renumbered **B180** — #159 took B176–B179)*
`[~]` A project-level **file repository** opened from **Row 1 (the project-name area), NOT a fourth module tab.** Rationale (owner): tabs are *workspaces* (modes of working — Site / Schedule / Markup); **Files is a shelf every workspace reaches into**, so it must be openable from inside any of them. "Folders" are **saved views over a tagged index, never a hand-maintained tree** — "All surveys", "All title commitments", "this project's civil set" are all *queries* against file facts. Two document classes: **spatial** (can live on the map — drawings, surveys, legal descriptions) vs **reference** (geotech, environmental, contracts — pulled and read, never a map object); a **title commitment is BOTH** (a reference document, but Schedule A's legal description feeds the boundary polygon and Schedule B's exceptions feed easement objects). Drawer: files grouped by discipline; per-file state **Filed** (automatic) vs **On map** (calibrated once); a **drop zone** (auto-file by title block) and a **"needs filing"** holding area with one-click confirm for low-confidence / no-match.
- **✅ Shipped this session (browser-first tranche, branch `claude/laughing-ritchie-k5narx`):**
  - **View-model engine** `src/shared/files/fileFacts.js` (pure, browser-free, **15 unit tests**): `classifyDocClass` (spatial / reference / **both** for title commitments + legal descriptions), `toFileFact`/`buildFileFacts` (normalizes the existing `listReviews` rows + defaults the NEW-2 placement facts), **`SAVED_VIEWS` + `runView`** (the saved-view query engine — per-project in the drawer, **cross-project by dropping the project filter**, same query), `groupByDiscipline`, `fileState` (Filed vs On-map), `needsFiling` (holding area), and the **index-provider interface** `createIndexProvider`/`stubIndexProvider` — the seam the auto-filing backend slots into with **no UI change** (`backendReady` flag keeps the UI honest about "auto-detected" vs "by hand").
  - **Drawer UI** `doc-review/components/ProjectFilesDrawer.jsx`, opened from **Row 1** (a 🗂 Files pill next to the project name in `DocReview.jsx`'s `centerContent`): saved-view chips, project picker + cross-project toggle, discipline groups, per-file **document-class tag** + **Filed/On-map** badge, a **drop zone** (files under the active project; auto-file-by-title-block flagged as backend), a **"needs filing"** holding area, and a **"Place on map"** action that runs the NEW-3 cascade (B182). lint 0 · **290 tests** · build green; the doc-review lazy chunk split still holds.
- **⏳ Follows the backend tranche (sanctioned by the owner's sequencing note — stubbed behind `createIndexProvider`, not deferred work):** the **auto-filing index itself** (drop → read title block → match against the named projects + aliases → auto-route/auto-name; low-confidence → the holding area) — this is the existing **auto-filing + lightweight-index** roadmap item and the **Google Drive auto-routing** item; **merge, do not duplicate.** Title-commitment → boundary polygon **reuses B25/B26's metes-and-bounds parser**; exceptions → easements **reuses B147's easements-as-first-class-objects** work. Privacy-first: **private by default** (rides the existing RLS).
> **Dedup:** generalizes **B14** (the `ProjectLibrary.jsx` explorer — project → discipline → files), which stays as the in-workspace explorer; B180 is the **saved-views / tagged-index** surface reachable from Row 1 and adds document-class + Filed/On-map state. Distinct from **B67** (parcel-attached *pixel-space* markup). The "drop to open a PDF for viewing" roadmap item is the low-effort sibling; the title-block auto-filing is the backend feature — two different timelines, kept separate.

### B181 — Capture placement-readiness flags in file facts at filing time `[Document Review / Files]` (feature) #doc-review #files  *(arrived as "NEW-2"; provisionally B177, renumbered **B181** — #159 took B176–B179)*
`[~]` At filing/index time, capture **more than discipline** so "Place on map" (B182) can pick its method **without reopening the file.** Per-drawing flags: **embedded real-world coordinates** present (+ source CRS); detectable **graphic scale bar** (yes/no + measured length + real length); **stated scale text** from the title block; **north arrow** present (+ orientation); visible **parcel/property boundary** present; **labeled dimensions** found (value + on-sheet endpoints). All cheap to capture during the title-block read pass.
- **✅ Shipped this session:** the **fact schema + contract** `src/shared/placement/placementFacts.js` (pure): `emptyPlacementFacts()` (every sub-fact carries `present` so **"looked, found none" ≠ "never captured"** — the silent-failure rule applied to placement), `PLACEMENT_FLAG_KEYS`, `mergePlacementFacts` (a partial/legacy capture is always a complete, safe object), and `longestDimension` (rung-3 baseline preference). Wired through `toFileFact` (every file fact carries a well-formed `placement`) and exercised by the cascade tests.
- **⏳ Follows the backend tranche (stubbed behind `createIndexProvider.capturePlacementFacts`):** the **actual capture** — the title-block read pass that fills these in — runs server-side as part of B180's auto-filing index. Until then the stub returns the empty shape and the cascade honestly lands on manual calibration (B183).
> **Dedup:** the capture piggybacks on B180's title-block read (one pass, not two). The scale-text parse reuses **B73's `parseScaleNote`/`detectSheet`** (`overlayScale.js`); embedded-coords/GeoPDF handling is B73's de-emphasized GeoPDF path.

### B182 — "Place on map" auto-placement cascade `[Site Planner / Files]` (feature) #site-planner #files  *(arrived as "NEW-3"; provisionally B178, renumbered **B182** — #159 took B176–B179)*
`[~]` On placing a filed drawing, walk methods **best → fallback** and **stop at the first that runs with confidence**; route every result through B183's verification before commit. Rungs: **(1) Embedded coordinates** → land exactly, no scaling (reproject to EPSG:2278); **(2) Fit to known boundary** → solve scale + rotation + translation in one affine/Helmert fit by matching the drawing's boundary to the held parcel/survey geometry — **preferred over any stated scale** (a printed scale is a claim about original plot size and breaks under "fit to page"/copier resize; geometry is ground truth); **(3) Measure a graphic** → scale bar or labeled dimension, drawn length ÷ annotated real value (resize-invariant), **prefer the longest baseline** (a 2 ft error over a 240 ft face is <1%; over a 24 ft bay it's 8%), use the north arrow for rotation then position to parcel; **(4) Manual calibration** → last resort (B183). Use the B181 flags to choose the rung; **never silently fall through a failed high rung without surfacing why.**
- **✅ Shipped this session:** the **cascade orchestrator** `src/shared/placement/placeOnMap.js` (pure, **10 unit tests**): `RUNGS` (the 4 rungs in priority order, each with an `evaluate(facts, ctx)`), `choosePlacement(facts, ctx)` → `{ method, label, detail, skipped:[{method,reason}], confident, reason }` — picks the best rung that runs **and lists every skipped higher rung with its reason** (the hard "no silent fall-through" rule), reads the B181 flags, prefers fit-to-boundary over stated scale, picks the **longest** dimension baseline, and carries the north-arrow rotation hint. Surfaced live in B180's drawer ("Place on map" → a plan panel naming the method + why higher ones were skipped).
- **✅ Shipped this session — rung-2 geometry:** the **fit-to-boundary solver** `src/shared/placement/fitToBoundary.js` (pure, **7 unit tests**): `fitToBoundary(source, target)` solves the one similarity (uniform scale + rotation + translation) that lands the drawing's boundary on the held parcel. Two paths — **equal vertex counts** → exact correspondence search (every index rotation × both winding directions, closed-form Procrustes per candidate, lowest landing error wins; recovers sub-foot fits even when the rings start at a different corner and run the opposite way); **unequal counts** → an oriented-bounding-box fallback (match centroids, scale by √area ratio, best principal-axis rotation by nearest-vertex distance) for a sane starting placement. Returns `{ ok, transform:{scale,rotDeg,apply}, residual, residualFrac, confident, method, reason }`; `residualFrac` over √area flags a **distorted (non-rigid)** drawing a rigid fit can't honor (CONFIDENT_FRAC = 2%), per the silent-failure rule. Self-contained (its own Procrustes mirroring B73's `solveSimilarityLSQ`, no shared→workspace import). This is the geometry the cascade invokes when `choosePlacement` returns the **fit-boundary** rung.
- **⏳ Still follows the backend tranche / EPSG spine:** **(1)** reprojection of embedded coords to EPSG:2278 (needs the coordinate spine wired, currently a stub in `src/shared/coordinates/`) and the **executor wiring** that takes the chosen rung's transform and actually repositions the overlay on the planner canvas; the **inputs** for rung 2 (the drawing's detected boundary + the held parcel geometry) come from B181's title-block read pass. **Rungs 3–4 already exist** as the live B72/B73 overlay machinery (`overlayScale.js` scale/trace, `overlayAlign.js` similarity/affine fit) — the cascade routes to them today. `choosePlacement`'s `ctx` (`canReproject`, `targetBoundary`) is the capability gate, so a rung only fires when its infra is present and otherwise reports *why* it's skipped.
> **Dedup:** this is the **decision layer over B72/B73**, not a second overlay engine. B72 = drop a PDF on the map + place by hand; B73 = scale calibration + trace + 2-point/N-point precise align (both shipped). B182 chooses *which* of those to apply automatically from the B181 facts. Severity: a confidently-wrong placement looks done and produces silently-wrong measurements — **placement accuracy is HIGH severity** (the silent-failure rule), which is why every skipped rung is surfaced and every result is verified (B183).

### B183 — Dimension-based calibration + auto-verification probe `[Site Planner / Document Review / Files]` (feature) #site-planner #doc-review #files  *(arrived as "NEW-4"; provisionally B179, renumbered **B183** — #159 took B176–B179)*
`[~]` Resolves the open "precise-align / trace-a-known-dimension" question — **answer: build it, and make it pull double duty.** **Calibration:** trace the two endpoints of a labeled dimension + type its value → derive scale (preferred over two arbitrary calibration points: it anchors to a value the drawing itself certifies); this is cascade rung 4. **Auto-verification:** after ANY placement method, find a labeled dimension, **measure it on the placed result, compare to the printed value, and surface a NUMBER** ("column grid measures 24.0 ft, label 24'-0" — 0.1% off") — not an eyeball confirmation. **Cross-check:** read two independent graphics (scale bar + a dimension, or two dimensions on different axes) and compare them **to each other**. Agreement → confident. Disagreement → **flag non-uniform scaling** (sheet stretched more in one axis, so no single uniform scale is valid) as a **distinct state — do NOT silently average the two.**
- **✅ Shipped this session:** the **calibration + verification primitives** `src/shared/placement/verifyPlacement.js` (pure, **8 unit tests**): `calibrateFromDimension` (rung-4 scale from a traced dimension), **`verifyDimension(measuredFt, labeledFt)`** → `{ pct, deltaFt, ok, severity:"ok|warn|bad", message }` (the probe that returns a number, with tight 1%/3% thresholds because takeoff rides on it), and **`crossCheckScales(samples)`** → `confident` (agree, reports the mean) / **`non-uniform`** (disagree → flags stretched-in-one-axis, **`meanScale:null` so it can never silently average**) / `insufficient`. The trace-a-known-dimension calibration itself already ships live in B73 (`overlayAlign.scaleOverlayAbout` + the canvas trace flow + Doc Review's calibrate-to-scale).
- **⏳ Follows the backend tranche:** the **auto-probe's data source** — automatically *finding* a labeled dimension to measure on the placed result — comes from B181's captured dimensions (read at filing time). Until then verification is available as the tested primitives (and can be driven by a hand-traced dimension); the auto-find runs once the title-block read pass lands. (A browser-only "trace a second dimension → cross-check" affordance on the live overlay is a small follow-on once the canvas flow is touched again.)
> **Dedup:** the calibration half is **B73's trace fallback** (don't rebuild it); B183 adds the **verification + cross-check** layer on top and is the function the B182 cascade calls after every placement. Reuses B73's `solveSimilarityLSQ` residual as the *rigid-fit* quality signal; `crossCheckScales` is the complementary *non-uniform-scale* signal (residual high **and** axes disagree → rubber-sheet needed, the B73 affine follow-on).

### B179 — Backend per-account exact tax fetch `[server]` (feature) — precision upgrade #infra  *(arrived as "NEW-4"; filed provisionally as B170, renumbered **B179** — concurrent `main` took B167–B175, so this is the real next free ID after B175. This is the "A" path of the old B165 A/B decision — built AFTER the browser "B" path, B176–B178, ships.)*
`[ ]` Per-county tax-office / appraisal-district account fetch that returns the **authoritative** taxing-unit list + rates matching the actual tax statement; upgrades the B177 panel from *screening* to *underwriting-grade*. **Server-side only** (lives in `/server`, the not-yet-built CAD/filing backend — keep distinct from Supabase). Per-county field mapping (same registry pattern as parcel-source naming in `lib/counties.js`). Credentials/keys stay server-side, never in the browser bundle (KEY DECISIONS).
- **Why a backend:** HCAD's jurisdiction-rate page + per-account record pages return **HTTP 403 to automated clients** and there's no public CORS-open per-parcel rate REST endpoint (confirmed 2026-06-19) — so authoritative rates can only be fetched server-side, where there's no CORS and the fetch can present a browser-like client.
- **Contract:** given county + account, return `{ units:[{name, rate}], total, asOf, source }`; the B177 panel swaps its screening rates for these and flips its header to "Verified · <tax office>, <year>." On failure, the panel stays on screening (never blank).
- **Acknowledged multi-session:** depends on standing up `/server` first; may span its own session — but implement, don't just file.
> **Supersedes the "A" half of B165.** Pluggable seam already exists (`TAX_RATE_SOURCES`/`resolveTaxRates`).

### B178 — Combined-rate choropleth `[Site Planner]` (feature) #site-planner #gis  *(arrived as "NEW-3"; filed provisionally as B169, renumbered **B178** — main took B167–B175. Build AFTER B176 + B177 land.)*
`[ ]` Optional map shading: color each parcel by its combined tax rate (light = low, dark = high) for across-area scanning. Click a shaded parcel → opens the **B177** tax-breakdown panel. Same screening caveat + data-age surfacing as every other GIS layer (rides `gisCache` SWR + honest per-layer status). Depends on B177's combined-rate derivation (which depends on B176's district overlays). Browser-only.
> **Dedup:** reuses the layer system (`lib/layers.js`) + `gisCache` (B96); not a parallel renderer.

### B177 — Parcel tax breakdown panel `[Site Planner]` (feature) #site-planner  *(arrived as "NEW-2"; filed provisionally as B168, renumbered **B177** — main took B167–B175. This is the browser/screening "B" panel of the old B165 A/B decision.)*
`[ ]` Click a parcel → a panel section listing **each taxing entity** with its **rate per $100 of taxable value** (Texas convention — not mills), combined rate at the bottom. Columns: entity + rate only (no annual-dollar column). **ISD stays as a line item** (largest component; the combined rate is wrong without it) even though school is dropped from the jurisdiction chips/overlay. **Highlight the MUD line** — it's the variable that drives the underwriting delta. Browser phase = entities spatially derived from the overlapping districts (reuse `identifyJurisdiction` in `lib/jurisdiction.js`; add MUD + ISD identify sources) + rates from published district rate tables → **screening**; header reads **"Screening · verify against tax statement."**
- **Builds on B176's identify/overlay sources.** The existing **Taxes** `Section` in `SitePlanner.jsx` (~L6441, fed by `resolveTaxRates`) is the seam — extend it, don't add a parallel panel. Likely folds into the future **Site Analysis** tool (B147) as its "tax" category once that lands; until then it lives in the parcel panel.
- **Rates data is the open risk (the old B165 blocker):** no verified machine-readable statewide district rate table is wired yet. Until one is, the panel **lists the entities it can derive and marks rates "screening source pending"** — it must NEVER fabricate a rate (KEY DECISIONS). B179 (backend) is the authoritative upgrade.
> **Supersedes the "B" panel half of B165.** (B176 — the jurisdictions overlay this builds on — shipped 2026-06-19; see `BACKLOG-DONE.md`.)

### B171 — Evaluate license-clean high-res imagery sources `[Site Planner]` (feature) #site-planner #gis  *(arrived as "NEW-3"; filed provisionally as B169, renumbered **B171** — concurrent `main` took B167 + B168 for unrelated map items, so with the paired B169 (diagnostic) + B170 (retina fix) this is the real next free ID)*  — GATED, do NOT action yet
`[ ]` **Gated on B169's finding + a confirmation step.** Only pick this up **if**, after B170's retina/HiDPI fix ships, the Esri World Imagery backdrop still looks **genuinely soft / stale** over the Houston metro on a real display. B169 showed the dominant blur causes were **(a) no HiDPI tiles and (b) the planner's fractional zoom — NOT a low-res source** (Esri World Imagery is ~0.3 m/px native at z19), so this evaluation should **not** start until B170 is confirmed insufficient by eye. Add a **selectable** high-res basemap from a source that permits **tracing/measuring/derivative work** (Planyr users draw + measure site geometry over the aerial — a hard licensing constraint).
- **Hard exclusion (licensing):** do **NOT** use **Google Maps satellite** (scraped `mt.google.com` tiles = TOS violation; even the paid Map Tiles API forbids tracing building outlines off satellite) or **Mapbox satellite** as the tracing backdrop (commercial derivative tracing needs a paid Commercial Satellite license). Both are ruled out for Planyr's core use case regardless of sharpness.
- **Candidate sources, in order:** (1) **Texas Imagery Service** (formerly TNRIS) state orthoimagery; (2) **Houston-metro county appraisal-district orthos** (public record, often 6-inch, very current); (3) **NAIP** (federal, public domain) as a national fallback. All are traceable + license-clean.
- **Verify each endpoint against a known Katy parcel** for coverage, resolution, and recency **before** wiring it in — don't assume availability (county/state GIS hosts move and stop often; rely on the existing probe + honest error surfacing).
- **Premium AEC imagery** (Nearmap / Vexcel / Maxar, properly licensed) is a **future paid-tier** upgrade, **not in scope** here.
- Treat **imagery age/source as surfaceable metadata** (consistent with the "always surface data age" principle for the GIS layers).
> **Dedup:** distinct from **B162** (street-label zoom gating) and **B65** (white-flash on zoom/pan); this is about the *imagery source/resolution itself*. Builds on the swappable-basemap registry that already exists (`BASEMAPS` in `MapFinder.jsx` — Esri + USGS today), so adding a source is a registry row + a picker entry, not bespoke plumbing.

### B163 — Project `progress_pct` field on data model `[Site Planner]` (task) #site-planner #persistence
`[ ]` Follow-on to B161 (Path A). Add `progress_pct SMALLINT NOT NULL DEFAULT 0 CHECK (progress_pct BETWEEN 0 AND 100)` to the projects/sites data model and wire it to the building marker's arc. Exact storage: either a column on the `sites` Supabase table via migration, or a field in the `Site Model` `data` jsonb. UI for editing (slider or inline input on the map pin or site list) TBD — scope separately. Until then, the arc continues to derive from status (Path B, B161).

### B147 — Site Analysis tool: multi-parcel constraint & context screen `[Site Planner / Site Analysis]` (feature) #site-planner #gis  *(arrived as "NEW-2"; minted **B147** — highest existing ID was B146, so this is the real next free ID. "NEW-2" is only a scratch label from the arriving chat — B120/B134/B145 also "arrived as NEW-2".)*
`[ ]` A dedicated **Site Analysis** tool (working name — module naming not finalized) that runs environmental, regulatory, and infrastructure screening against the **combined footprint of the selected parcels** and presents findings **grouped by category**, presence-first. This is the **single home** for the checks currently buried in the parcel-info popup and for the **Tier 1 "site-killer" roadmap** in CLAUDE.md — build it as ONE surface; do **NOT** spin up a parallel one (see the reconciliation flags below).
- **Input geometry:** the **dissolved union of the active parcels** (the "site") — never a centroid, click point, or single parcel. Reuse **B100**'s `activeParcelsOf` selector so the screened footprint matches the same parcels yield/coverage/detention already use; exclude inactive parcels. **DECIDED 2026-06-17 (Michael): screen the ACTIVE-only union** (not all selected parcels) — confirmed consistent with the yield/coverage/detention math, so no remaining ambiguity here.
- **Finding categories** (v1 = presence + the single most decision-relevant attribute; detail-on-expand):
  - **Floodplain** — FEMA NFHL (National Flood Hazard Layer = FEMA's digital flood maps). Zone designation(s) intersecting the site + rough extent. *(Maps to the Tier 1 "finished-floor vs. base-flood" item — reconcile, don't duplicate; reuses the FEMA overlay already wired in B129/B133.)*
  - **Wetlands** — USFWS NWI (National Wetlands Inventory = the federal desktop wetlands map). Presence + classification. **Hard caveat: screening only — NOT a jurisdictional delineation;** a consultant delineation + USACE verification is required for any real determination. *(Reuses the NWI overlay from B133/B135.)*
  - **Pipelines** — PHMSA NPMS (PHMSA = the federal pipeline-safety agency; NPMS = its National Pipeline Mapping System) + RRC. **Caveat: public NPMS is deliberately low-resolution for security** — a flag to trigger 811/one-call + operator outreach, never a precise alignment.
  - **Oil & gas features** — RRC (Railroad Commission of Texas — the state oil/gas regulator, despite the name). Well bores (active / plugged / abandoned) + surface locations. **Caveat: historic well locations can be inaccurate or unmapped;** an RRC records search (possibly a survey) is the real check. High relevance for Houston-area sites (orphaned wells).
  - **Environmental contamination** — TCEQ LPST (Texas Commission on Environmental Quality, Leaking Petroleum Storage Tank database) + EPA sites. *(Maps to the Tier 1 "environmental screen (TCEQ LPST / EPA)" item — reconcile, don't duplicate.)*
  - **Jurisdiction** — city limits / ETJ / county / road authority. **This is B93 (shipped) + B94 (open) re-homed as a SECTION here, not a standalone Identify-panel button or popup field** — the discoverability fix (see below).
  - **Zoning / entitlement** — jurisdiction-dependent; pulled from the jurisdiction context. **Note: City of Houston has NO zoning — don't build as if every jurisdiction has it;** ETJ-area and other cities vary. *(Maps to the Tier 1 "entitlement/zoning" item; the per-jurisdiction rules are B95's "development-consequence summary" — reconcile.)*
- **Presentation:** findings grouped by category, **presence-first** — a clear **present / not-present / unknown** state per category, detail on expand. **Each finding carries its own data source + data-age stamp + a category-specific screening caveat — NOT one blanket disclaimer.**
- **★ Silent-error principle (HIGH severity):** **"Unknown / source unavailable" is a DISTINCT state from "not present."** A failed or timed-out source must **never** render as "no constraint." Reuses the existing honest per-layer status (B96/B129) — surface the failure, don't swallow it.
- **Architecture reuse (no parallel system, no new credentials):** runs on the **existing generic ArcGIS-REST connector + source registry** (`lib/jurisdiction.js` / `lib/vectorLayers.js`) + the **GIS stale-while-revalidate cache (B96)** + honest per-layer status. Each new source (NFHL, NWI, NPMS, RRC, TCEQ/EPA) is **a registry row, not bespoke code.** Browser-only where the sources are public REST services.
> **Dedup / reconciliation — these are NOT new items; fold this work into / build it on top of them (each aware of the other, never a forked parallel surface):**
> - **B93 (jurisdiction identify — DONE, shipped + verified live) + B94 (road authority — open):** **re-home the jurisdiction/road-authority identify as a SECTION inside Site Analysis**, not the standalone "⚖︎ Jurisdiction & road authority" Identify-panel button it ships as today (and never a popup field). This is the **discoverability fix** the arriving note asks for — same engine, surfaced inside the analysis tool.
> - **CLAUDE.md Tier 1 "site-killer" roadmap** (storm outfall, sanitary sewer, fire flow, finished-floor-vs-base-flood, environmental screen, entitlement/zoning): these are **Site Analysis sections, not a parallel surface** — reconcile so they render in THIS tool. (Storm outfall / sanitary sewer / fire flow are infrastructure sections to add alongside the v1 categories above.)
> - **B95 (jurisdiction → development-consequence summary — DEFERRED):** its per-jurisdiction rules (who regulates platting, whether zoning applies, who reviews drainage/detention + fire flow, who permits access) feed the **Zoning/entitlement + Jurisdiction sections** here — the consequence layer surfaces *in* Site Analysis when it's picked up.
> - **B96 (GIS SWR cache — open):** the cache + honest-status mechanism this tool rides on; B96 stays the foundation (sequence accordingly).
> - **B98 (parcel-popup declutter — DONE) + B100 (active/inactive parcels — DONE):** **heavy analysis moves OUT of the parcel-info popup into Site Analysis; the popup keeps only lightweight parcel identity (owner/name, ID, area).** Input footprint = B100's active-parcel union (see Input geometry above).
> - **FEMA/NWI overlay layers (B129/B133/B135):** the Floodplain + Wetlands findings reuse those already-wired overlays as their data source — read them, don't re-plumb them.
> **★ v1 SHIPPED 2026-06-19 (branch `claude/trusting-allen-xatlua`) — the tool now exists as ONE surface; remaining categories are registry rows.** Built the whole Site Analysis surface on the existing infra (no parallel system, no new credentials): a new registry-driven connector `lib/siteAnalysis.js` rides the same SWR cache (B96) + the verified jurisdiction engine (B93/B94, `jurisdiction.js`) + EPSG:4326 boundary as the parcel identify, and a new `components/SiteAnalysis.jsx` panel opened from a new **"⚐ Analysis"** left-rail tab. It screens the **dissolved footprint of the ACTIVE parcels** (B100's `active !== false`, converted to lon/lat rings via `feetToLatLng`) as a single multipolygon intersect, and presents findings **presence-first, grouped by category**, each with its own source + data-age + a category-specific caveat (no blanket disclaimer).
> **★ The silent-error principle is enforced in code + unit-tested (HIGH severity):** a finding is `present` / `absent` / `unknown` / `info` / `pending`, and `classifyStatus` only reports a confident **"None found"** for a `verified` source returning empty — an unverified or errored source reads **UNKNOWN, never a fabricated all-clear**. Pending categories read **"source not connected"** (distinct from "none").
> **Categories wired in v1:** **Floodplain** (FEMA NFHL layer 28, `verified`), **Jurisdiction** (city/ETJ/county) + **Road authority** + **Zoning/entitlement** (derived: Houston→no zoning, other city→zoning likely, unincorporated→no county zoning) — all reusing `jurisdiction.js`. **Wetlands** (NWI staging split layers 1,2), **Oil & gas wells** + **Pipelines** (TxRRC via the Harris County GIS host) are wired but `verified:false` (their /query reliability is unconfirmed, so empty → honest unknown). **Environmental contamination** (TCEQ LPST / EPA) is a `pending` registry row (no confirmed CORS-clean endpoint yet) → reads "source not connected." Adding/verifying any source later = flipping a registry row, not new code.
> **Tests + verification:** new `test/siteAnalysis.test.js` (28 cases: geometry/query building, summarizers, the present/absent/unknown guard, multi-sublayer query, cache ride, jurisdiction-throw resilience, full orchestration order). lint **0 errors** · **285 tests** · build green · `SitePlannerApp` lazy chunk intact. **Self-verified headless on the built app** (`gis-verify/site-analysis-verify.{mjs,png}`): seeded a georeferenced Katy parcel → Analysis tab → **Floodplain = PRESENT "Zone AE, X"** (live FEMA), **Jurisdiction = Fort Bend / Katy**, **Road = State (TxDOT)·City**, **Zoning = "Within Katy — city zoning applies"** (live), and the sandbox-blocked Wetlands/Pipelines/Wells correctly read **UNKNOWN ("Failed to execute query")**, Environmental **"Not connected"** — the honest-state path confirmed.
> **🔲 Remaining (kept open — the additional-categories + polish tranche):** (1) **verify + flip** Wetlands / Pipelines / Oil&gas to confident `absent`-capable once their /query + correct sublayers are browser-confirmed (today they degrade to unknown, which is safe but conservative); (2) wire a real **TCEQ LPST / EPA** contamination source (the pending registry row); (3) add the **Tier-1 infrastructure sections** (storm outfall, sanitary sewer, fire flow) as registry rows in this same tool; (4) **re-home the in-Identify "⚖︎ Jurisdiction & road authority" button** fully into Site Analysis (today it still also lives on the point-identify result — kept to avoid regressing that flow); (5) signed-in/live planyr.io click-through (the sandbox proved the path with live FEMA + TxDOT, but a real-display pass is worth logging).

### B115 — Revisit keyboard shortcuts: memorability + let the owner remap them `[Site Planner / UI]` (task) — owner-gated #site-planner #ui
`[ ]` Owner note (2026-06-16): the planner's single-key shortcuts are hard to remember and Michael may want to change them — **park this for a deliberate pass with him; do NOT unilaterally rename keys.** Decide together: (a) whether the current assignments stay, (b) whether to make them **user-remappable** (a small settings screen + persisted overrides) vs. just keep a fixed, better-surfaced set, and (c) whether any are non-obvious / collide with muscle memory (e.g. **S** could read as "save"). Current bindings, for reference when picked up: **V** Select · **H** Pan (+ hold **Space** = temp pan) · **S** toggle Snap (new, B114) · **Q** Callout · **T** Text · **L** Line · **R** Rect · **E** Ellipse · **⇧P** Polygon · **⇧N** Polyline · **Ctrl/⌘ Z / ⇧Z / Y** undo/redo · **Ctrl/⌘ C / X / V / D** copy/cut/paste/duplicate · **Delete/⌫** delete · **Esc** cancel · **?** shortcuts panel; gestures **⇧-drag** bond-to-neighbour, **Alt-drag** bypass-snap (B114). All are already listed in-app under the **?** panel. No code change yet — awaiting the owner's preferences.

### B13 — Refine B11 county resolution: precise boundaries + per-area jurisdiction `[Site Planner / map]` (feature) #site-planner #gis
`[ ]` Follow-up to **B11** (shipped in PR #13) — two interim simplifications captured here so they aren't forgotten. Neither is urgent; both are screening-only conveniences today and degrade gracefully.
- **Coarse bbox pre-filter → real point-in-county.** B11 routes a parcel click to a CAD service using *approximate* per-county bounding boxes (a coarse screen; the CAD that actually returns a lot is the source of truth, with a fall-back to querying all counties). Fine for the 3 configured counties (Harris / Fort Bend / Chambers), but as more counties are added, switch to true point-in-county boundary polygons so the pre-filter stays accurate and cheap. **(STILL OPEN.)**
- **Layers panel jurisdiction is hardcoded to Harris/Houston.** ~~With no county pre-picked, the map's Layers panel defaults to the Harris/Houston jurisdiction…~~ **DONE** — the map Layers panel jurisdiction now follows the map's current area.
> Progress 2026-06-15 (this PR): **point 2 done** — the map's Layers panel jurisdiction is no longer hardcoded to Harris; `MapFinder` resolves `viewCounty` from the view centre via `candidateCountiesForPoint` on every `moveend`, so the correct utility overlays are offered outside Houston (falls back to Harris when the centre is outside all configured counties; per-site jurisdiction still follows the opened site's county). **Point 1** (true point-in-polygon county boundaries vs. the bbox pre-filter) remains open — the bbox screen is still adequate for the 3 configured counties, so this is deferred until more counties are added.
>
> **What this is (plain English, 2026-06-15) — the "county resolution" theme.** B13-pt1 + **B36(a)** + **B36(d)** are really one piece of work: *how the app decides which county's appraisal-district (CAD) service to query when you click the map.* Today it screens by approximate per-county **bounding boxes** — fine for interior clicks in the 3 configured counties (Harris / Fort Bend / Chambers). The gaps, all near a county border or when a 4th+ county is added: **B13-pt1** the bboxes overlap/approximate → replace with true county **boundary polygons** (point-in-polygon); **B36(a)** the statewide TxGIO fallback can mislabel a Harris/FB lot's `county` when the primary CAD returns nothing; **B36(d)** a click on a county line should query both CADs and merge (only the first hit is used today). **Needs a county-boundary GIS dataset** to load + test points against — a data-source decision, so it's **feature-scale, not a quick fix**, and **low urgency** (interior clicks in the current 3 counties are fine). When picked up: choose/confirm the boundary source first, then point-in-polygon resolution + straddle merge fall out of it.
>
> **Progress 2026-06-15 (branch `claude/festive-davinci-0oco2n`): the point-in-county primitive now exists.** B72 landed the verified TxDOT county-boundary layer, and `lib/jurisdiction.js` `countyAtPoint(lng,lat)` resolves the true county (cached) and maps it to a configured CAD key — exactly the dataset/primitive this item was waiting on. **Pt 1's routing SWAP is deliberately NOT done:** the existing parallel "query candidate CADs, answerer wins" identify is faster + more resilient than a blocking point-in-county lookup before every click, so replacing the bbox pre-filter would regress, not improve. The primitive is instead used additively for the **B36(a)** label correction (see B36's note). The data gap pt 1 cited is closed; the bbox pre-filter stays by choice.

### B128 — Import reported 3 sites but the account total rose by 2 — confirm all imports land `[Persistence]` (bug) — low, needs repro #persistence
`[ ]` From the V15 cohort run (T4, signed-in): the `importLegacyIntoCloud` banner said "**3** sites brought into your account" but the account count went **15→17** (not 18). Non-destructive (local copies kept) so **no loss**, but one import may not have landed. Investigate: a failed push counted optimistically, an id collision/dedupe, or just a stale display count. Needs a clean repro on throwaway sites — check `importLegacyIntoCloud`'s `copied/skipped/failed` against the actual account-list count, and confirm all three rows are queryable in `public.sites`.

### B131 — Clip a generated parking field to the parcel boundary `[Site Planner]` (feature) — large lift #site-planner  *(split out of B130; minted B131 — next after B130)*
`[ ]` When a parking field (and its double-loaded module fill) extends past the parcel / usable-area boundary, clip the generated stalls + aisles to that boundary instead of drawing and counting pavement outside it — so stall yield reflects only what actually fits on the site. Called out as **out of scope** in B130 (that layout engine fills a drawn rectangle; this trims the fill to an arbitrary boundary). Large lift: needs rectangle-vs-polygon clipping of the stall bands, a yield recount on the clipped set, partial-stall handling at the cut, and the curb rule re-applied to the clipped perimeter. Builds on the existing parking generator (`carStalls` / `lib/parking.js`) + the parcel / usable-area polygon.

### B134 — Edits silently lost on reload; app loads a stale earlier state `[Persistence]` (bug) — DATA-LOSS, critical #persistence  *(arrived as "NEW-2"; minted B133, renumbered B134 amid concurrent merges; its sibling SCHIEL-recovery item ultimately landed at B136)*
`[ ]` **Repro:** (1) open planyr.io, sign in; (2) load/build a Site Planner plan and make edits (e.g. add buildings until the plan is materially larger); (3) hard-reload with `Ctrl+Shift+R`. **Observed:** the plan reverts to an earlier saved state, recent edits gone, no error shown. **Expected:** after ANY reload (normal F5 or hard `Ctrl+Shift+R`), the most recent saved state loads intact — newer work is never silently replaced by an older state.
- Part of: **B648** (Persistence & Sync epic).
> **Diagnostic note:** `Ctrl+Shift+R` bypasses the HTTP cache but does NOT clear localStorage, IndexedDB, sessionStorage, or cookies. Work vanishing on a hard reload therefore means it was never durably saved (or the loader prefers a stale source) — the reload did not delete it. Isolate the layer first by testing F5 vs `Ctrl+Shift+R` vs a fresh tab vs tab-close; that tells you whether the gap is in-memory-only, local storage, service-worker cache (the background script that can cache the app), or cloud.
> **Candidate causes, rough priority** (confirm with the signed-in headless browser; capture network + console):
> 1. ~~**Supabase "Cloud off"**~~ — **RULED OUT 2026-06-17 (this session):** the live planyr.io shell bundle has the Supabase URL `lyeqzkuiwngunutlkkmi.supabase.co` baked in, so cloud IS configured/on. (`VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` are baked in at BUILD time, not runtime; a build missing them ships a cloud-off client that silently falls back to device-only storage — "has bitten twice" — but that is NOT the case on the current deploy.)
> 2. **Browser-storage quota** — if cloud is off and the app falls back to localStorage, a growing plan can cross the browser's ~5 MB local-storage cap and writes start throwing `QuotaExceededError`, silently dropping saves. Fits the symptom exactly (smaller plan saved, larger one did not). If so, move plan state to IndexedDB (far larger limit) and/or fix cloud.
> 3. **Save not firing / debounce race** — if autosave is debounced (waits for a pause in editing before writing), reloading before the timer fires loses the last edits. Flush on `visibilitychange`/`beforeunload` and on explicit navigation.
> 4. **Save firing but erroring silently** — the Supabase write returns 401/403 (expired auth token, or a row-level-security rule blocking the write), 409 (conflict), or a swallowed network error. Surface and log every save failure.
> 5. **Wrong load precedence / record mismatch** — newer work saved locally but on boot the loader fetches the cloud copy and the stale cloud version clobbers it (or vice versa); or edits save under a different plan id/version/key than the loader reads. Make load deterministic: newest-wins by timestamp, single source of truth.
> Likely lives in the shared cloud save/load layer, so fix it workspace-agnostically even though it surfaced in Site Planner.
> **Dedup / cross-refs — filed net-new: same SYMPTOM class as B124, but a fresh live recurrence that raises two UNINVESTIGATED root causes.** Same "data loss on reload" symptom as **B124** (Schiel/JFK), whose root cause (the `pullCloud` thin-merge + the two-store split) was found and fixed in **B126/B127**, with the loud-failure half in **B125** — and **★ corrected 2026-06-17 (this session): all of B124/B125/B126/B127 are MERGED (PRs #81/#83/#85/#89) AND DEPLOYED to live planyr.io** (the live `SitePlannerApp` chunk carries the B126 version-history key `planarfit:sites:history:v1` + the "Version history" dialog + the B125 "Retry now" banner; the shell has the Supabase URL baked in → **cloud is ON**). So the recurrence is **NOT unmerged code and NOT cloud-off — both ruled out**, which eliminates candidate #1 and #2's cloud-off premise. Refocus on the causes the shipped fixes do NOT cover: **#3** (the 10-building state never durably persisted — a debounced cloud push that didn't fire before the reload, so the loader fell back to the older 6-building cloud copy; B126's union-merge only recovers work that reached a store, not work that never persisted — the closest fit), **#4** (a silent save error — expired auth token / RLS 401–403 / 409), or **#5** (load precedence). Also overlaps the historical **B18** (last-debounce-window edits flush local-only) and **B54** (`pullCloud` overwrites the cache with `{}` on a fetch error). If the investigation pins the live cause to one of those, note it both here and there rather than re-fixing. The visible-status guardrail is **B125** (it would have surfaced this immediately); the SCHIEL recovery action is **B136**.
> **Progress 2026-06-17 (this session, branch `claude/nice-ptolemy-9j0u7g`): the load-precedence half (#5) is FIXED in code.** Root cause pinned in the boot sequence: `SitePlannerApp` renders the planner `key={activeSiteId}` and the planner snapshots its plan from storage **once at mount**; the first synchronous render runs BEFORE auth resolves (`activeUser` still null → reads the legacy/local store), so a signed-in user can paint a stale copy — and the authoritative copy that `applyUser`'s `pullCloud` merges in is a **same-tab `localStorage` write (fires no `storage` event)**, so the already-mounted planner never refreshes. Exactly the owner's "showed 6 buildings, then came back to 10 on its own." Fix: a `loadEpoch` bumped after the boot/sign-in pull and folded into the planner's `key`, forcing a one-time remount so the resumed plan re-reads the freshly-merged store. **Display/load-timing only — the save/merge/version-history logic is untouched, so it cannot worsen data safety** (worst case is a sub-second remount). lint 0 errors · 191 tests · build green · lazy split intact. **Still OPEN:** causes **#3 (never-persisted / debounce-flush gap)** and **#4 (silent save error)** — the true-loss cases where work never reached any store — need the visible/honest save-status + flush work tracked in **B125/NEW-3**. **Verification gap:** the sandbox browser can't sign in, so the signed-in boot path needs a signed-in click-through to confirm end-to-end; the change is gated to the signed-in resume branch, so logged-out behavior is unchanged. **The signed-in end-to-end browser confirmation is logged as VERIFICATION V28** — the "limit" this session couldn't self-run (sandbox can't sign in); a signed-in coworker runs it down.
> **Amendment 2026-06-30 — a DISTINCT sixth root cause in this same symptom family was found + fixed: B594/B595.** An owner report ("I drew a polyline and it disappeared") triggered a fresh adversarial audit that pinned a cause NOT in the #1–#5 list: drawn-element ids came from a per-tab counter that `ensureIdAbove` re-seeded only from parcels+els, so a freshly drawn markup could reuse a **tombstoned** id (after a reopen) or **collide** across two tabs — and `mergeSiteContent`'s tombstone filter then stripped the live item mid-session (then persisted the loss). Fixed by salting `uid()` (new `src/shared/ids.js`) + seeding `ensureIdAbove` from all collections+tombstones (**B594**), and the count-only read-back that let it pass silently was made membership-anchored (**B595**). This does not close #3/#4 (still the open debounce-flush / silent-error cases) but removes the most-likely real-world trigger of "work vanished on its own." Live two-tab signed-in repro = V185.
## 🎨 UI audit pass — 2026-06-16

Full UI workstream from `UI_AUDIT.md` (re-authored this session: the predecessor 58-item
audit lived only in a parallel chat and was never committed, and several of its findings
were already implemented on `main`, so it was redone against HEAD + headless screenshots in
`ui-audit/screens/`). The brief's "coordinate-with" B-numbers (B2/B3/B10/B15/B16/B18/B19) were
that chat's provisional numbers — reconciled in `UI_AUDIT.md` (they map to real B2/B3/B10/**B65**/**B66** + two net-new). **Renumbered on merge:** these were minted B93–B99 on the branch, but `main` had meanwhile spent B93–B107 on its own UI/GIS work, so they are **B108–B113** here — and a couple are now superseded by main's parallel changes (noted inline; the legend item was dropped entirely).

## 🐞 Bug audit — 2026-06-15 (overnight sweep)

Systematic read-through of the whole codebase (5 parallel audits, each finding verified against the source). Severity/confidence noted per item. Items tagged **🔧 fixed in audit PR** were fixed in the same PR that added this section; the rest are triaged for review. IDs are permanent (B15+).

> **✅ Fixed in PR #27 (2026-06-15).** The remaining net-new items not already covered by #19–#26:
> **B25** curve calls flagged `curve:true` + kept as a chord approximation + UI warns (tessellation still deferred); **B31** `splitPolygon` falls back to the widest distinct-edge crossing pair; **B61** two-click road clamps its length axis ≥ cross axis; **B37d** `testConnection` accepts custom Supabase domains; **B48** `printPDF` escape also handles `>`/`"`. (Items duplicated by the parallel PRs — B26/B28/B30/B32/B47/B54/B58/B59/B60/B29/B62 — were dropped, not re-landed. **B18** left open: the merge-by-`updatedAt` half is a deliberate trade-off best reviewed, not auto-applied.)
>
> **✅ Fixed in PR #29 (2026-06-15).** **B43** `applyUser` captures a monotonic token before its `await pullCloud` and bails stale completions, so overlapping auth events can't apply to the wrong user; **B46** the Mapillary token is now a same-tab pub/sub so both `LayerPanel` copies stay in sync; **B55** the `probeService(...)` overlay continuation gets a `.catch` and guards `addTo` with `map._loaded` (the `uploadSource`/flush halves shipped in #17).
>
> **Follow-up (this session).** Completed: **B18** (`pullCloud` keeps a strictly-newer local copy of a still-present cloud record — recovers a missed last-second push, no cross-device-delete resurrection; the `sendBeacon` alternative was unnecessary). Partial within grouped items (which stay `[ ]`): **B36(b)** evidence opacity re-renders so per-feature fill ratios survive the slider; **B56(a)** address-search Enter gated on `busy`; **B56(d)** evidence layers do a trailing-edge refresh for a view that moved mid-fetch; **B57(a)** manual Calibrate disabled for a from-map underlay; **B36(c)** parcel import now picks the outer ring + an area-weighted centroid (shared `largestRing`/`ringCentroid` helpers, deduped across the three parsers); **B57(c)** the account/address lookup projects via the same 365223 equirectangular model as map-click (was true EPSG:2278 feet, a ~0.3% size mismatch).
> Still open: **B36** (a/d/e — a/d are county-resolution that ties to **B13**, e is fetch AbortControllers), **B56** (b broad warn-timer refactor; c/e are doc-review), **B57** (b only — a cosmetic ~2 ppm foot-constant nicety), **B13**, and the doc-review items (parallel session's area).

### B20 — `setProjectStatus` rewrites every plan in the group via `cloudUpsert` (strips inline underlay, heavy, clobber risk) `[Document Review]` (bug) — correctness, medium #doc-review #persistence
`[ ]` Flipping a project's status from the library round-trips each site row's whole `data` through `cloudUpsert`, which `slimForCloud`-strips any still-inline `data:` underlay and bumps `updated_at` on every plan (can clobber a concurrent edit). Cloud copies are usually already slimmed so true loss is unlikely, but a status dropdown shouldn't rewrite full site blobs. Fix: a minimal status-only write (jsonb patch/RPC) or guard the underlay before re-upsert.
> Deferred 2026-06-15 (future reference): the clean "status-only write" needs a Postgres RPC / `jsonb_set` — a backend/migration change, same class as B47a's `ESCAPE`, so not done client-side. Low-risk in practice today: cloud `data` is already underlay-slimmed (the strip is usually a no-op), and the serial→parallel + partial-failure reporting landed in B56c. Revisit when the `/server` backend exists.

### B38 — SQL/RLS & data-integrity audit (mostly clean) `[Document Review / DB]` (bug) — minor #doc-review #persistence
`[ ]` A dedicated schema/RLS pass **verified the new code is sound**: both `doc_reviews` and the `sites`/storage policies are owner-scoped (all 4 verbs, `to authenticated`, no `public`/anon/admin), the bucket is private, every client storage path hardcodes uid as the leading segment (so `(storage.foldername(name))[1]` RLS can't be bypassed), both migrations are idempotent, the `(user_id,id)` PK matches every `onConflict`, and the `doc_date` empty-string→`null` boundary holds. Remaining minors: (a) **storage orphaning** — `uploadSource` uses `upsert:true` on a path derived from current project/discipline, so re-filing + re-uploading a source leaves the old object behind (key in `sources[]` is overwritten, so cleanup can't find it); fix by keying objects on the immutable `srcId` only, or deleting the prior key first. (b) `upsertReview`'s pre-migration fallback never **back-fills** the index columns for rows saved before the migration (a later normal edit self-heals that row; values always live in `data` jsonb meanwhile); the fallback regex (`/column|.../`) is also broad. (c) `setProjectStatus` writes rows back through `cloudUpsert` without `createSiteModel` normalization (lossless passthrough, but a status edit could also heal a legacy row if normalized). (`deleteReview` user-scoping — fixed in the audit PR alongside B37a.)
> Deferred 2026-06-15 (future reference): (a) the clean fix changes the Storage object-key scheme (or deletes the prior key on re-file) — migration/orphan implications, wants a live repro before shipping; an orphaned object only wastes quota, nothing breaks. (b)/(c) are trivial/self-healing (a later normal edit backfills the index columns / normalizes the row). Low urgency — pick up when storage cleanup is worth a dedicated pass.

### B63 — Parallel-session merge safety: branch → PR → green-build gate `[repo / workflow]` (task) #infra #testing
`[ ]` Guardrail so two concurrent Claude Code sessions can't silently break `main`. git already catches *same-line* collisions (it refuses — the safe, loud case); the real risk is two sessions editing *different but interdependent* files → clean merge, broken app, which only re-building the **combined** result catches. **Active practice (already followed; make it explicit in CLAUDE.md):** each session works on its own branch, never commits to `main`; finishes via a PR; before merge, restacks on the latest `main` and re-runs the build, merging only if green; one PR per backlog item where practical. The *enforced* GitHub branch-protection half is parked under 🕓 Later (needs a paid plan on this private repo + a one-time owner toggle).

### B73 — Calibrate the overlay to the drawing scale (default), with optional precise alignment `[Site Planner]` (feature) #site-planner
`[ ]` Get the **B72** map overlay to correct **real-world size** automatically from the drawing scale. Builds on B72 (which ships first, eyeballed); **position and rotation stay by-hand by default** ("just get it in the area, let me nudge it"). Why a separate calibration step exists: a site-plan PDF has a scale (how big to draw) but no coordinates (where / how rotated), and the scale math is exact only when the page is at its true plot size.
- **Default path — scale calibration.**
  - On import, try to **auto-read the scale notation** via **PDF text extraction** (site plans usually carry selectable text like `1"=100'` or `SCALE: 1"=100'`).
  - Before trusting it, **check the PDF page's physical dimensions against standard sheet sizes** (ARCH D 24×36, ANSI D 22×34, ARCH E, …). **Why it matters:** the scale is exact only at the true intended plot size — if someone shrank the sheet to letter paper, the "1 inch" assumption breaks and the scale comes out wrong. **Apply the detected scale silently only when the page is a recognizable plot size**, and show it in a small readout the user can **override**.
  - If the scale text can't be read, or the page isn't a recognizable plot size (likely shrunk), **don't guess** — surface a single scale control (dropdown of common civil scales `1"=20'/30'/40'/50'/60'/100'/200'` + free entry) and/or route to the trace fallback.
- **Fallback — trace a known dimension (always reliable).** User draws a line over a labeled dimension on the sheet (e.g. a building edge labeled `570' DEEP`) and enters its real length; the tool sets overlay scale so drawing-feet = map-feet. Sidesteps the page-size problem entirely — the backstop whenever auto-scale is missing or untrustworthy.
- **Optional precision — 2-point alignment (NOT the default).** Opt-in "**Align precisely**" action for when eyeballing position/rotation isn't good enough: click two known points on the overlay + the matching two on the map → solve a **similarity transform** (uniform scale + rotation + shift; moves/resizes as one rigid piece, no distortion). **3+ points → affine fit** (allows slight stretch/skew = rubber-sheeting). Show a **fit/residual readout** (how closely the clicked points landed on their targets) so the user can judge the result or re-pick.
- **GeoPDF — opportunistic only.** A GeoPDF carries embedded map coordinates (rare for civil site plans). If one happens to carry that reference, offer to **auto-place** at true location/scale/rotation; otherwise stay silent. De-emphasized.
- **Result.** However it's set, the final overlay lives in the project's **shared coordinate system (EPSG:2278)** so its geometry matches the GIS layers and the other workspaces.
> **Dedup / shared machinery.** Reuse, don't rebuild: the Document Review **calibrate-to-scale** measure tool and the **`Stitcher.jsx` 2-point pairwise align** (the precise-alignment math is the same similarity / affine fit), and relate to the existing underlay **Calibrate** — see **B57(a)**, which notes that calibrate's single diagonal-derived scalar mis-sizes a divergent-axis underlay, so derive the overlay's scale per the cleaner model here (per-axis / known-dimension), not one diagonal scalar. Distinct from **B67** (pixel-space parcel markup); built on **B72** (the map overlay itself).
> Progress 2026-06-15 (branch `claude/nice-dirac-029jok`, this session): **default scale path shipped.** On import the overlay reads the engineer's scale note from the PDF text (`parseScaleNote` — `1"=100'` / `SCALE: 1"=100'` / `1 inch = 100 ft`) and classifies the page against standard plot sizes (`detectSheet` — ANSI A–E, ARCH A–E1); when the page **is** a recognizable plot size **and** a scale was read, it's **auto-applied silently** to true real-world feet (`ftPerPx = S/72`, the points basis), otherwise it lands at the by-hand B72 default. The overlay panel gains a **Scale** control: detected sheet + read scale (with **Apply**), a common-civil-scale dropdown (`1"=10..200'`) + custom entry, and a live "now ≈ 1"=N′ · W′ wide" readout; non-standard pages are flagged "may be shrunk." The scale math lives in a pure, browser-free `lib/overlayScale.js` with **9 unit tests** (sheet detection both orientations, ANSI-D ≠ ARCH-D, note parsing + range guards, the points↔feet conversion). **lint 0 errors · 39/39 tests · build green.** ⏳ **UNVERIFIED in a browser.** **Still deferred (B73 stays `[ ]`):** the **trace-a-known-dimension** fallback and the opt-in **2-point similarity / 3+-point affine precise-align** (both need a canvas-click mode — a focused next increment), plus GeoPDF. Position/rotation stay by-hand per spec.
> Progress 2026-06-15 (same session, follow-up): **trace + 2-point precise-align shipped.** Per-overlay **Trace a length** (click two ends of a known dimension on the drawing → enter its real length → rescales, pinned at the first click) and **Align to map** (click two points on the drawing, then the matching two on the map → a **similarity transform** that moves + rotates + uniformly scales the sheet so those points land on the map). Both are opt-in canvas modes with an instruction bar + Esc/Cancel + on-canvas point markers; the default placement stays by-hand. The geometry is a pure, browser-free `lib/overlayAlign.js` with **7 unit tests** (similarity maps p1→q1 / p2→q2 with the right scale + rotation; trace pins its anchor; 2-pt align lands **both** drawing points on their map targets **even for a rotated overlay**). **lint 0 errors · 46/46 tests · build green.** ⏳ **UNVERIFIED in a browser.** **Only the optional extras remain (B73 stays `[ ]`):** **3+-point affine / rubber-sheeting** with a fit-residual readout, and **GeoPDF** auto-placement.
> Progress 2026-06-16 (same session): **N-point alignment + residual readout shipped.** "Align to map" is now pair-based — click a point on the drawing, then its spot on the map, repeat; **Apply** at ≥2 pairs. 2 pairs = the exact similarity; **3+ pairs = a least-squares best-fit** (closed-form Procrustes) robust to a sloppy click, reporting an **RMS fit residual** (ft) in a toast so a poor/distorted fit is visible. Math added to `lib/overlayAlign.js` (`solveSimilarityLSQ`, `applySimilarityToOverlay`) with **5 more unit tests** (exact 2-pt match; recovers a known scale+rotation from 4 points at ~0 residual; non-zero residual on a perturbed point; null guards; all points land via the fit on a rotated overlay). **lint 0 errors · 51/51 tests · build green.** ⏳ **UNVERIFIED in a browser.** **What's genuinely left (B73 stays `[ ]`):** **true affine / skew rubber-sheeting** — deliberately NOT rushed blind, because it needs the overlay to carry a full 2×3 matrix (a new render + manipulation path), a focused refactor rather than an additive change; and **GeoPDF** auto-placement (rare for civil plans; needs low-level PDF georef parsing). The new N-point residual already surfaces *when* affine would help.
> Fix 2026-06-16 (user reported "Align to map does not work at all"): **fixed — it now captures points.** Root cause: the calibration click-capture lived in the SVG-root `onBgDown`, but clicking the overlay / parcels / elements hit their own pointer handlers (which `stopPropagation`), so a point only registered on empty canvas — picking points *on the drawing itself* did nothing. Fix: while trace/align is active, a transparent full-canvas capture layer intercepts **every** click and turns it into a calibration point (no accidental move/selection). Apply stays an explicit button at ≥2 pairs. lint/test/build green; please re-test on the preview.

---

## 🐞 Bug audit follow-up — 2026-06-16 (net-new safe batch + feature-break sweep)

Two further audits (a "Cowork" cross-check and a feature-break sweep) were triaged against the
code at HEAD. **Most items were already fixed in B15–B73** (markups-only delete B16, JSON import
B15, cloud-flush B18, render-cancel B40/B34, error boundary + lint/test gate B68, RLS-scoped
delete B37a, etc.). The verified **net-new** items are fixed here on branch
`claude/blissful-babbage-liboyn`. **lint 0 errors · 39 tests · build green.** IDs B74+.

#### UI fuzz / adversarial-input sub-pass (same session, B87–B92)

A researched fuzz pass (boundary/overflow, type-confusion, concurrency, special-chars) found a
fresh cluster — fixed here.

### B95 — Jurisdiction → development-consequence summary `[Site Planner / GIS]` (task, downstream — DEFERRED) #site-planner #gis
`[ ]` Optional downstream layer: translate the raw boundary facts from **B93 / B94** into the questions that drive a deal — who regulates platting/subdivision (city directly / city-via-ETJ / county), whether zoning applies (Houston has none; most others do), who reviews drainage/detention and fire flow, which property-tax jurisdictions apply, and who issues the access permit (from B94).
- Plugs into the existing **verdict-engine** concept (the `developableArea()` synthesis stub); stays a **screening aid, not legal advice.**
- **Defer until B93 / B94 are solid.** Rules are per-jurisdiction and accrue over time — start with Houston plus the 2–3 most common cities and expand as hit.

---

## 🎨 UI/UX & parcel-interaction overhaul — 2026-06-16 (product walkthrough)

Filed from a product walkthrough of the map + planner chrome and the parcel-interaction
model. Provisional **NEW-1…NEW-8** were minted B93–B100, but **B93–B96 collided** with the
same-day GIS batch (PR #46, which had already shipped code under B93–B96); per the dedupe
protocol they are **renumbered B104–B107** here (B97–B100 were unique and keep their IDs; the
GIS batch keeps B93–B96). Deduped against existing items — **B10** (two-header consolidation +
product switcher) already shipped for the *planner* context bar and explicitly left "a single
physical row is a later polish," so **B104** is that remaining polish for the *map* view
(net-new, not a re-file); the rest have no existing Open counterpart. All eight are `[ ]` Open.

<!-- 2026-06-22: owner-dropped corrected chat batch (Scheduler PDF/Print Exhibit export quality) —
     amended NEW-1/NEW-2/NEW-4/NEW-5 (NEW-3 unchanged). Minted **B401/B402/B403**; the amended NEW-1
     folded into **B361** (its explicit home — "the continuous companion to B159's discrete selector").
     Per STANDING RULE #1 all four were filed AND fixed + headless-verified (V116, 16/16) + committed
     this session on branch `claude/vigilant-brown-5dqcog`. All touch ONE surface:
     public/sequence/index.html (buildGanttSVG + PDFExportModal + buildPDFHtml). Full [x] blocks live
     in BACKLOG-DONE.md:
       • B361 — export time-axis controls: a discrete Days/Wk/Mo/Qtr selector (sidebar) + a continuous
                Time −/+ (toolbar) wired to the SAME span state + Pan (renamed from Move, drags the
                time window, today-centered default) + FIXED the dead/intermittent floating toolbar
                (rebuilt as a pinned absolute overlay). Page Zoom + Fit kept.
       • B401 — the default time window auto-fits so every start/end label sits on the sheet (extend the
                frame, never move a label; capped at ~22% of span/side so a long label can't crush it).
       • B402 — dependency connectors stay CURVED but now terminate at 12 o'clock (descend into the bar/
                diamond TOP, clearing the endpoint date) + a vertical de-collision pass for co-dated names.
       • B403 — silently persist & restore ALL export-screen state (orientation/size/margins/columns/
                name-align/header/section-collapse/timescale/pan) via localStorage `planar:exportPrefs:v1`,
                synchronously, NO badge. Column width keeps riding data.exportColWidths (B392).
     B160 (the whole-split table-vs-chart divider ratio) left Open by design — distinct from B361's
     in-chart time axis; B392's per-column drag-resize already covers most of the need. -->

---

## ⏳ Verify — awaiting live confirmation

Implemented items whose `Verify: live` check is still pending. They **park here, never block** — a
browser-equipped teammate (Cowork) or Michael on planyr.io confirms them. An item leaves this section
**only** when a verification note (date · method · observed result) is appended, then it moves to
`BACKLOG-DONE.md`. If a report says a parked item is still broken, apply the **recurrence rule** (move it
back to 🔲 Open, `Recurrence:` line, `(×N)` title). Cross-reference: the live-browser click-throughs are
also tracked in `VERIFICATION.md` (`V###`) — that file is the canonical to-do list for the teammate; this
section is the backlog-side mirror so an item is never "done" until it's actually been seen working.

### B675 — Library pins follow the ACCOUNT (Supabase cloud sync) instead of per-device `[Library]` (feature — owner request) #library #persistence #auth  *(owner chat 2026-07-06 — "buildout and ship the pins being saved per account not computer"; follow-on to B668 which shipped pins as per-device v1 with the async, uid-first API built for exactly this swap. **B675** = highest real B# across both files (B674) + 1. Branch `claude/module-nav-project-persistence-ryftwj`.)*
`[x]` **IMPLEMENTED this session; parks in ⏳ Verify (Verify: live — cross-device sync is a concurrency/multi-writer + auth-only class, and the pin CRUD renders signed-in only) → V220.** Also **owner-gated**: the new `pins.sql` must be run once (OWNER-TODO) before any signed-in check.
- Verify: live
- Origin: filed 2026-07-06 from chat
- **DEDUPE-FIRST:** no prior cloud-pins item (grepped `pins` · `favorite` · `cloud sync` in Open/⏳ Verify/Done). B668 shipped the per-device v1; this is its planned cloud upgrade, not a recurrence.
- **What shipped:** new `src/shared/pins/db/pins.sql` — table `public.pins`, own-row RLS (4 policies mirroring `file_facts.sql`), PK `(user_id,type,target_id)`, `user_id default auth.uid()` so the client never sends it. Row-per-pin, no tombstones — an unpin is a real RLS-scoped DELETE that can't resurrect on another device. `pinStore.js` rewrite keeps the async uid-first API byte-for-byte (callers unchanged); DI cloud I/O (the `casUpsert`/`folderStoreSupabase` pattern) so it unit-tests against a fake client; signed-out stays the v1 localStorage bucket. One-time local→cloud migration (`migrateLocalPinsToCloud` + a per-account marker in `Library.jsx`, mirroring B663 `treeMigrateV1`): non-destructive, idempotent (upsert), copies this device's local pins up on first signed-in load. Cross-device refresh = refetch on sign-in + tab-focus/visibility (no realtime — pins are latency-insensitive).
- **🔍 Adversarially reviewed (2026-07-06, 5 dimensions × verify): 10 findings CONFIRMED (0 false positives), all fixed same-session.** Root cause: a swallowed cloud read error looked like an empty cloud. Fixes: `fetchPinsCloud` distinguishes a failed read from empty; a failed read now keeps the prior list (never blanks the Pinned section on an offline tab-focus) and is loud on telemetry; `togglePin` won't invert an unpin on a failed pre-read; the migration ABORTS on a read failure (never overwrites another device's pins) and never writes its done-marker unless it actually saw the cloud; a `checkIdentity` re-check stops the write loop on an account switch mid-run; oldest-first insertion preserves pin order; migration write failures are LOUD + retry in-session. All named rules honored (LOUD-FAILURE the central one).
- **Verified here (sandbox):** `test/pinStore.test.js` 23 green (incl. every hardening case) · full suite 2,700 green · build green · MAP regenerated · logged-out smoke green.
- **⏳ V220** = the signed-in cross-device pass (after the owner runs `pins.sql`): live schema check; pin persists across reload; a second signed-in browser sees the same pins; unpin propagates; migration copies local pins up on a fresh device; offline toggle reverts loudly and a tab-return on a flaky connection doesn't blank the list.

### B669 — Keep-alive module switching: visited workspaces stay mounted (hidden), switching is instant `[Shell / all modules]` (feature — owner request) #ui #perf #infra  *(owner chat 2026-07-05 — "it should be a cleaner switch between clicking on modules… it's almost like we start from nothing"; **B669** = highest real B# across both files (B668) + 1. Branch `claude/module-nav-project-persistence-ryftwj`.)*
`[x]` **IMPLEMENTED this session; parks in ⏳ Verify (Verify: live — timing/remount class per LIVE-VERIFY) → V219.** The Shell rendered exactly ONE workspace, so every tab click unmounted the outgoing module (open drawing, map view, file list, the booted ~692 KB Gantt iframe) and rebuilt the incoming one from scratch — chunk prefetch (B223) warmed only the CODE, never the state. That was the whole "starts from nothing" feel.
- Verify: live
- Origin: filed 2026-07-05 from chat
- **DEDUPE-FIRST:** no prior keep-alive / module-switch-speed item in Open / ⏳ Verify / Done (grepped `keep.?alive` · `module switch` · `remount` · `prefetch`). B223 (idle chunk prefetch) is the adjacent prior art — code-warming only; this is the missing state half.
- **What shipped:** `Shell.jsx` keeps every VISITED workspace mounted in an absolutely-positioned wrapper (`display:none` when inactive) — one ErrorBoundary per workspace (stable key, contained crashes) + one Suspense per wrapper (loader only on first visit). Every workspace gets `isActive`; a full gating audit makes hidden modules FOLLOW the route but never WRITE it (SitePlannerApp state→URL sync, Scheduler adopt-linked-site) and never own global input (SitePlanner canvas keys, DocReview + Stitcher window key handlers, AppHeader's window "f"/Esc fullscreen shortcut via an offsetParent visibility probe — four mounted headers would otherwise all toggle at once). display:none re-show fixes: MapFinder `invalidateSize` on re-activation (the clear-parcel-selection effect stays keyed on the map/plan MODE flip so a tab peek never wipes a selection); DocReview re-fits a PDF that loaded while hidden (clientWidth reads 0 under display:none → 900×600 fallback); an openReview-in-flight ref stops the new project-switch resume from racing a cross-workspace open; Library/Home do a cheap token-guarded revalidate on activation; Site re-reads the local site list.
- **e2e (new `e2e/module-keepalive.spec.js`, all green headless):** hidden workspace stays attached in the DOM; the Schedule iframe survives a switch away/back; "f" fullscreen scoped to the visible header only; stray keys with two hidden workspaces mounted are safe; `e2e/helpers.js` grew `moduleTab()` (visible-header filter — multiple mounted headers trip strict mode) and smoke/markup-tools now use it.
- **⏳ V219** = the signed-in checks: open drawing survives Review→Site→Review with no re-download; Scheduler keeps its booted Gantt across switches; Site does NOT re-pull cloud sites on tab-back.

### B668 — Library Home: pinned folders/files + recent drawings + project cards `[Library]` (feature — owner request) #library #ui #files  *(owner chat 2026-07-05 — "like File Explorer where I can pin to start stuff… favorites or pinned as the main menu instead of just having a massive place where I can drag folder or files"; **B668** = B667 + 1. Branch `claude/module-nav-project-persistence-ryftwj`.)*
`[x]` **IMPLEMENTED this session; parks in ⏳ Verify (Verify: live — pin CRUD + the folder click-through render signed-in only, which the sandbox proxy blocks) → V218.** The Library's no-project landing was a dead "Pick a project" note; it is now a File-Explorer-style home.
- Verify: live
- Origin: filed 2026-07-05 from chat
- **DEDUPE-FIRST:** no prior pin / favorite / star / recent item in Open / ⏳ Verify / Done (grepped `pin` · `favorite` · `star` · `recent` — only incidental hits: CSS `spin`, the Stitcher "pinned composite key" legend, the upload-tray "Recently filed" animation). Greenfield.
- **What shipped:** `LibraryHome.jsx` (Pinned folder/file cards — a pin whose target no longer resolves shows a LOUD "missing — unpin" state, never silently dropped; Recent = drawings recently OPENED in Review; Projects card grid; import stays inside a project — auto-filing never guesses). `src/shared/pins/pinStore.js` — per-device store (owner decision 2026-07-05: "this computer only" v1) with an async uid-keyed API so a cloud table can swap in without caller changes + same-tab/cross-tab change subscription. `src/shared/recents/recentDocs.js` — local opened-list, deliberately NOT `doc_reviews.updated_at` (moves on autosaves = "recently changed", not "recently opened"); stamped at both Review open choke points (single load + stitch handoff), deduped, cap 15. ☆ toggles on folder tree rows (quiet ★ marker when unhovered) + file cards; a pinned-folder click navigates to its project and selects the folder once the tree rows publish (ref survives the project-switch reset; a deleted folder falls back to "All files").
- **Owner decisions captured:** app reopens exactly where he left off (B666); pins per-computer for v1 with the upgrade path built in.
- **Verified here (sandbox):** unit `pinStore` (8) + `recentDocs` (6) green · full suite 2,672 green · build green · MAP.md regenerated.
- **⏳ V218** = the signed-in Library pass: pin a folder → Home card → click lands selected in the right project; pin/unpin a file from its card; recents populate after opening drawings in Review; AND the B665 click-through (tree opens collapsed, expansion remembered per project across a reload).

### B667 — Review remembers the last document PER PROJECT (+ the resume self-clobber fix) `[Doc Review]` (feature + bug — owner request) #doc-review #persistence  *(owner chat 2026-07-05 — "whatever I last reviewed, what the last document that I reviewed in that project should stay open too"; **B667** = B666 + 1. Branch `claude/module-nav-project-persistence-ryftwj`.)*
`[x]` **IMPLEMENTED this session; parks in ⏳ Verify (Verify: live — resume needs signed-in cloud loads; timing class) → V217.**
- Verify: live
- Origin: filed 2026-07-05 from chat
- **AUDIT-FIRST find — resume was self-clobbering (the real reason Review "started from nothing"):** the mount-time pointer writes (`lastSingleId` = this session's fresh blank id, `lastMode`="review") ran in declaration order BEFORE the boot effect read the keys back, so resume loaded a never-saved review and silently fell to the empty state on every reload. Same pattern in `Stitcher.jsx` (`lastStitchId`). Fixed structurally: the stored pointers are captured at FIRST RENDER (before any effect can write) and all pointer writes stay silent until boot resolves — no clobber window at all.
- **Per-project memory:** new map `planyr:docreview:lastDoc:v1` = `{ [projectId|""]: {id, mode} }` (`lib/lastDoc.js` — pure, 14 unit tests). Legacy globals keep being written and remain the fallback (migration = fallback, not a copy pass — existing devices resume day one). Boot resolves ordered candidates via `resolveResume` (URL project → that project's own entry first, then legacy, still guarded by `wrongProject` on the actually-loaded record — a project-matched entry now RESUMES where the guard used to drop to empty). Breadcrumb project switch inside Review lands on THAT project's last doc (flushes the outgoing doc first; a pending cross-workspace open intent or an in-flight open wins — no race).
- **DEDUPE-FIRST:** no prior per-project-resume item (grepped `lastSingleId` · `resume` · `wrongProject`); B478 (resume-into-planner) is the Site-side analogue, different surface.
- **Verified here (sandbox):** `test/lastDoc.test.js` 14 green · full suite green · build green.
- **⏳ V217** = signed-in: open doc X in project A and doc Y in project B → breadcrumb A↔B resumes each project's own doc; reload a deep link `#/project/A/markup` reopens X; reload with an empty hash reopens the exact doc last on screen (also covers the B666 module+project restore chain end-to-end).

### B664 — Drag a whole FOLDER onto the Library and it auto-files every PDF inside it `[Library / storage]` (feature) #library #files #filing  *(owner chat 2026-07-05 — "I'd still like a place where I can drag and drop a folder or files and Planyr automatically names and organizes them … wondering if I'll need an API or AI"; minted **B664** = highest real B# across both files (B663) + 1. Branch `claude/drag-drop-file-org-xh9z7y`.)*
`[x]` **IMPLEMENTED this session; parks in ⏳ Verify (Verify: live — the drop zone renders signed-in only + real-browser File System Entry API) → V216.** The Library already auto-named/organized dropped PDFs (Tier-1 plain-code title-block read, no AI/API for the common case; AI only as the scanned-sheet fallback), but a dropped **folder** did nothing — the handler only read `dataTransfer.files`, which is EMPTY for a folder. This adds real folder support.
- Verify: live
- Origin: filed 2026-07-05 from chat
- **DEDUPE-FIRST:** no prior folder-drop / recursion item in Open / ⏳ Verify / Done (grepped `folder drop` · `webkitdirectory` · `drag.?drop` · `folder.aware`). Prior drag-drop hits are single-PDF/site-overlay filing (B72, the old file-explorer drawer), never directory recursion — net-new.
- **Answers the owner's question ("will I need an API or AI?"):** no — the naming/organizing is already **plain code first** (`autofile` Tier 1 reads the PDF's embedded text + matches a project deterministically, free/instant/no tokens); AI (`server/filing/`, dormant) is only the fallback for scanned/image-only sheets with no text layer. This item is purely the missing **folder** intake, not a new AI dependency.
- **What shipped:**
  - **`src/shared/files/uploadQueue.js` (pure engine, unit-tested):** `dropItemsToEntries` (SYNC — pulls `webkitGetAsEntry` entries out of the drop event before the item list is neutered; reports `hasEntryApi` + `hasDirectory` + a flat-file fallback), `entryToFiles` (async recursive walk of one `FileSystemEntry`; reads a directory reader to exhaustion over its CHUNKED `readEntries`; never throws), `flattenEntries`, and `partitionAccepted` (split a folder's contents into PDFs-to-file vs. non-PDFs-to-skip).
  - **`FileBrowser.jsx`:** `onDrop` now folder-aware (a dropped folder recurses into subfolders; loose files keep the classic per-file path with rejection rows). New **"Choose a folder"** picker (`webkitdirectory`, set imperatively so React can't drop the non-standard attribute) alongside "Choose PDFs". A folder drop/pick files its PDFs and shows ONE honest grey summary ("Folder read — filing N PDFs · skipped M non-PDF files") instead of a red row per stray file.
- **Named rules:** LOUD-FAILURE (an unreadable entry is skipped, not a silent total loss; the queue rows + the skipped-count summary account for everything); MODULE-SCOPE-COMPONENTS (n/a — no new components).
- **Verified here (sandbox headless):** lint 0 · full unit suite green incl. 7 new folder-drop tests · `npm run build` green · MAP.md regenerated. **⏳ V216** = the signed-in planyr.io drag-a-real-folder + folder-picker click-through (the drop zone needs sign-in, which the sandbox proxy blocks).

### B658 — Replace landing-page copy with the approved buyer-voice deck `[Landing / marketing]` (task) #ui  *(owner brief 2026-07-05, arrived as "NEW-1"; minted **B658** = highest real B# across both files (B657) + 1. The brief's provisional "NEW-1" collides with B653's — scratch label only.)*
`[x]` **IMPLEMENTED this session (`public/landing/index.html` + root `index.html` meta); parks in ⏳ Verify (Verify: live — landing pages are a known stale-Cloudflare-cache risk) → V212.** Full verbatim swap of the marketing landing copy from feature-voice to the approved buyer-voice deck.
- Verify: live
- Origin: filed 2026-07-05 from chat
- **DEDUPE-FIRST:** no prior landing-copy item in Open / ⏳ Verify / Done (grepped `landing` · `copy deck` · `hero` · the old hero strings). The landing page's only prior touches were the "Night Datum" build + a11y pass (V180, `ui-audit/verify-landing*.mjs`) and the new-visitor front-door redirect — neither a copy rewrite.
- **What shipped, verbatim per the deck:**
  - **Hero:** H1 "Know what the dirt can do — before you tie it up." (coral 2nd line via the existing `.l2` treatment) · new buyer-voice subhead · single primary CTA "Plan a site free" → `/?app`. **Secondary CTA omitted** — the deck's "Watch it on a real parcel" is conditional on a demo asset, and none exists yet (the old "See the deed-to-schedule flow" ghost was removed; the flow is still reachable from the top-bar nav).
  - **New Problem block** directly under the hero ("Feasibility is where deals die slowly.").
  - **Module blocks replaced in place:** Site Planner ("From flyer to test fit before lunch."), Review ("The civil set, the ALTA, and the survey — one screen, measured and marked."), Schedule ("A schedule your lender reads without squinting.").
  - **New Cost Estimating block** after Schedule ("A number you can defend in the investment committee.") — see the accent note below.
  - **New Proof strip** (thin tracked-caps band, no icons) before the close: "Real county parcel data · FEMA & wetlands overlays · Jurisdiction-specific detention math · Survey-grade state-plane coordinates".
  - **Closing CTA** replaced: H2 "The next flyer that hits your inbox — answer it in an hour." + single CTA "Plan a site free →" (the old "Built by an industrial developer" close H2 + body were replaced by the deck's spare close).
  - **`<title>` / meta / OG / Twitter / JSON-LD** refreshed to the new hero voice on BOTH `public/landing/index.html` (title "Planyr — know what the dirt can do") and root `index.html` (the root `og:description` still carried the old "Draw the site. Get the yield. Same instant." hero line + a banned word).
  - **Banned-word sweep** (instantly / seamlessly / easily / powerful): none literally present; the stray "Instant" family was in the deck-replaced hero/title/Site-H2 plus one out-of-scope Spec row ("Instant yield on draw" → "Yield as you draw"). Whole-file grep now clean on both files.
- **⚠ FLAG for the owner — Cost Estimating is not a built module.** It has no workspace/route/accent of its own; the nearest real thing is the roadmapped "cost verdict engine" (`docs/ROADMAP.md`, Tier 4). Shipped the section because the owner-approved deck lists it verbatim and the mapping notes say to add a block when a deck module has no on-page home — but it pre-announces a not-yet-live module. Given no module accent exists, its eyebrow dot uses the **coral brand accent** (`--coral-mid`), not a new module color. Easy to pull or mark "coming soon" on one word from the owner.
- **Scope guardrails honored:** copy/content only — no layout redesign, module accents unchanged (Site green, Schedule purple, Review amber, Library teal, coral brand); the untouched Spine ("One coordinate system") + Library sections stay; nav labels + footer left alone; typographic em dashes / apostrophes / `·` separators preserved.
- **Verified here (sandbox headless):** `npm run build` green + `ui-audit/verify-landing.mjs` (desktop/tablet/phone, 8 scroll stops each) — `__landingReady` true, 0 page errors, new hero renders. **⏳ V212** = the live planyr.io/landing/ check after the Cloudflare deploy (stale-cache risk is exactly why this is `Verify: live`).

### B651 — Parcel split double-counts acreage; make split REPLACE the parent (parent + children can never both be active) `[Site Planner]` (bug) #site-planner #yield #selection  *(owner brief 2026-07-04, arrived as "NEW-1"; **B651** = highest real B# across both files (B650) + 1. Branch `claude/parcel-split-double-count-vk8f0j`. DEDUPE-FIRST — net-new: NOT B416 (Split-a-parcel discoverability / panel reachability, Done), NOT B128 (concave-cut split GEOMETRY, Done). Same feature area, different defect: those made the split tool reachable and its cut correct; this fixes what the split does to the parcel MODEL / active set.)*
`[x]` **IMPLEMENTED + headless-verified this session; parks in ⏳ Verify (Verify: live — repro cites real project data) → V210.** A split parcel and its children occupy the SAME ground, so any active set containing a parent AND a child double-counts that acreage (owner repro: Parcel 3, 16.40 ac → 2.52 + 13.87 ac children, all three active → Yield sums ≈ 31.8 ac).
- Verify: live
- Origin: filed 2026-07-04 from chat
- **AUDIT-FIRST reconciliation (code reality vs. the report):** the current `performSplit` (`SitePlanner.jsx`, since PR #444 / #468) already **replaced + tombstoned** the parent, so the exact "split tool leaves all three active" no longer reproduces via the cut tool on `main`. The owner's live ≈31.8 ac most plausibly came from **overlapping county parcels added separately** (a recently-subdivided tract where CAD still lists the parent + both children) or a **stale cached bundle** predating that fix — which is exactly why **B652 (the overlap warning) is the real catch-all** and was built alongside. This item still had a genuine gap vs. the owner's desired UX (the old code DELETED the parent instead of retaining it), so the split was re-architected from "delete parent" to "supersede parent."
- **What shipped (branch `claude/parcel-split-double-count-vk8f0j`; lint 0 · 2,526 tests (+21) · build green · lazy split intact · headless `ui-audit/verify-b651-b652-parcel-split.mjs` 14/14):**
  - **Split is now a REPLACEMENT via supersession** (`performSplit`): one op creates + activates the pieces as CHILDREN (each carries `parentId`) and marks the parent `active:false` (superseded, non-counting) — no longer deleted/tombstoned. Because the superseded parent is inactive, it drops out of every active-parcel area sum automatically (no yield-math change needed; the ~13 inline `active !== false` sums are untouched).
  - **Parent retained + nested** (`parcelOutline` in `siteModel.js`; Parcel panel): the superseded parent stays in the list, greyed + "· split", with its children indented under it. The **on-canvas** superseded outline is hidden (its active children occupy the same ground). Header "Parcels · N" counts CURRENT lots only (excludes superseded), so splitting one lot reads "Parcels · 2".
  - **Lineage naming** (`parcelDisplayInfo`, derived — not stored): Parcel 3 → 3A / 3B → 3A1 / 3A2 (letters odd depth, digits even), tracking the parent's current number; a street address still wins as the name.
  - **Mutual-exclusion guard** (`toggleParcelActive` + `lineageConflicts`): activating a parcel auto-deactivates its ancestors AND descendants (a parent covers its children's ground; siblings are disjoint), so a parent and its split children can never both be active.
  - **Schema:** `SITE_MODEL_VERSION` 10 → 11 (additive `parentId`; existing records migrate losslessly — missing = root, unchanged behavior). Fixtures/MAP regenerated.
- **⏳ V210 (live, signed-in + real project data):** on planyr.io, load a real project, split a real county parcel (e.g. Parcel 3, 16.40 ac); confirm Yield reads ~16.4 ac (not ~31.8), the parent shows greyed "· split" with 3A/3B nested, toggling the parent active deactivates the children, and the whole thing round-trips through cloud save/reload without resurrecting the parent as active. (The pure model + logged-out UI are headless-verified; the signed-in cloud path + owner-data repro are the remaining live gate.)

### B659 — Sheet reader + file organizer revamp: rotated/offset pages, set-aware titles, left-edge & vertical title blocks, title-first grouping, date-first names `[Doc Review / Library]` (bug — owner report "they both kinda suck… it always messes up in every file") #doc-review #library #files #filing  *(owner chat 2026-07-05 with a screenshot of the GPL Arch IFR review showing "GRAND PORT LOGISTICS" on nearly every rail row + "4 SHEETS · 44 PAGES"; **B659** = highest real B# across both files (B658) + 1 — renumbered from a provisional B653 on the origin/main merge-in: a concurrent owner-brief batch took B653–B658; code comments updated in the same commit. DEDUPE-FIRST — extends the B266/B348/B378/B412 reader line and the B180/B312 organizer line, but the root causes here (page /Rotate ignored, no cross-page signal, no left-edge/vertical title blocks, item-first grouping) are net-new. Branch `claude/sheet-reader-file-organizer-my485w`.)*
`[x]` **IMPLEMENTED + verified against the owner's REAL Drive sets this session; parks in ⏳ Verify (Verify: live — repro cites real project data) → V213.** Every file misread because of five compounding engine gaps; all five are fixed and the fix is retroactive (rail meta is recomputed on every open — nothing cached to invalidate).
- Verify: live
- Origin: filed 2026-07-05 from chat
- **Root causes found (AUDIT-FIRST, against 6 real sets downloaded from the owner's Drive — GPL, Jacintoport, Mesa ×3, Goose Creek ALTA):**
  1. **Page rotation/origin ignored** — `extractPageItems` read raw PDF text coordinates, but the owner's real files are stored rotated (GPL **180°**, Mesa mech/site + GC ALTA **270°**) or origin-shifted (Jacintoport MediaBox at −1296,−864), so every zone/band/title/number read looked at the wrong part of the page. Now every run is mapped through the **viewport transform** (what a human sees), any rotation/origin.
  2. **No cross-page signal** — the title block prints the PROJECT NAME/client/architect stamps LARGER than the sheet title, so the per-page "tallest line" pick returned "GRAND PORT LOGISTICS" on every sheet. New pure module `src/shared/files/sheetTitleSet.js`: per-page ranked `titleCandidates` + a set-level pass (`refineSheetTitles`) that demotes candidates repeating across ≥45% of pages (identity stamps) unless they carry a drawing-type word (tiled-run titles), and hard-drops the app's own KNOWN project names/aliases/addresses (`projectStopTexts`; wired in DocReview rail, Stitcher, via `readSheets({stopTexts})`).
  3. **Left-edge & vertical title blocks unreadable** — Powers Brown-style blocks (the GPL architect) put the number top-corner at 2× any type and run titles VERTICALLY. `detectTitleBlock` now knows **left** bands; `reconstructLines` reconstructs **rotated runs as columns** (true reading order, CCW bottom→top) and fuses **glyph-stacked** pseudo-vertical strings (the Mesa "O I C I 119641 T E" gibberish → real lines); wrapped multi-line titles join (incl. across interleaved small cells); a spatial **label-anchored number read** takes the code item NEAREST a "SHEET NUMBER/SHEET NO./DWG NO." caption (content-order joins read the plot timestamp "6/23/2026" as sheet "6"); whole-page prominent-code last resort (≥1.5× everything else) for blocks that print the number outside every strip.
  4. **Identity/stamp rows could win as titles** — new rejections: firm rows (INC/LLC/…ARCHITECTS/…ENGINEERING/…PLATTING endings), phones/web/email, "Suite N"/street addresses/city-state-zip/lone-state cells, TBPE/TBPLS registrations, "(A) PROJECT FOR …"/"PREPARED FOR …", the TX interim-review stamp ("PRELIMINARY — NOT FOR CONSTRUCTION… / CURRENT AS OF…"), data-field rows ("SITE AREA : 29.17 AC"), textual dates, mostly-single-letter shreds, and a leading glued sheet-code ("C-2 TOPO SURVEY I" → "TOPO SURVEY I").
  5. **Item-first grouping collapsed distinct sheets** — 44 arch pages sharing item "Architectural" with consecutive numbers became "4 SHEETS". `groupKey` is now **title-first** (with `tileBaseTitle` stripping trailing tile counters "III"/"AREA 2"/"(1 OF 4)" so real tiles still chain); the coarse item is only the no-title fallback; rail/tray labels (`displayTitle`) now show the sheet's OWN title.
- **Organizer half (Library):** list sorts by the DOCUMENT's date (`docRecency` — issue/revision date first, upload time tiebreak; "latest revision on top" was a lie under updatedAt-sorting), auto-names are **date-first** matching the owner's own convention (`composeTitle`/server `composeFiledName` → "2026.06.20 Katy Grand - Grading Plan"), rows show the captured **sheet number/range badge** (toFileFact now carries sheet_number/sheet_title), and a typed re-file discipline normalizes case-insensitively onto the canonical DISCIPLINES list (no more typo-minted duplicate subcategory nodes).
- **Verified in-sandbox:** corpus harness over the 6 real Drive sets — GPL reads "WALL SECTIONS AND DETAILS · A303–A306" + "FIRE MARSHAL · FM101" (was "GRAND PORT LOGISTICS" ×5, no numbers); Jacintoport 10/11 real titles + all numbers (was "SPEC OFFICE" stamps); Mesa mech full titles + numbers M101-A–M303-A (was single-letter gibberish, no numbers); GC ALTA full survey title ×4 (was "PLATTING"). Full suite 2,568 tests green (44 new across sheetTitleSet/sheetMeta/sheetGroups/fileFacts/docFiling); headless rail check on the real GPL split PDF (V213 sandbox half).
- **Known residuals (minor, logged honestly):** scanned/no-text sets (Mesa electrical) still show "Sheet N" until the B364 OCR path; a form-style cover (Jacintoport S-1 county checklist) can read a checklist heading as its title; 2 of 11 Jacintoport titles are partial fragments ("AND NOTES"-class) when a 3-line title defeats the join; the curated Folders tree (B650) and auto-filed flat Drive paths remain two disconnected taxonomies — that unification belongs to the open **B650** umbrella, not here.
- **⏳ V213 (live, signed-in):** see `VERIFICATION.md` V213 — reopen the owner's saved "2026.06.23 GPL - Arch IFR" review on planyr.io and confirm per-sheet rail titles + sane sheet count; spot-check Library date-first names, doc-date sort, and the sheet-number badge on a fresh drop.
### B644 — Scheduler embed: first COLD boot throws `Cannot read properties of null (reading 'projects')` + the loader overlay exceeds the 6s backstop (self-recovers) (×2) `[Scheduler / robustness]` (bug — first-paint hardening) #scheduler  *(Cowork live verification 2026-07-03, from V153; minted **B644** = highest real B# across both files (B643) + 1)*
`[x]` **IMPLEMENTED + headless-verified 2026-07-05; parks in ⏳ Verify (Verify: live — timing/race class) → V211.** Original report: the FIRST cold Site→Schedule switch on planyr.io threw a one-time `⚠️ This view failed to load — Cannot read properties of null (reading 'projects')` (~10.5s overlay, self-recovered on re-nav).
- Verify: live
- Recurrence: 2026-07-05 — owner repro (chat "NEW-5", DEDUPE-FIRST fold — same error string, same first-paint null-`projects` read): create a project via **Start blank → Schedule tab** → the same error renders **behind the connect-a-schedule modal**. Deterministic (not only the cold race); expected a clean empty state only.
- **Root cause (pinned by a live sandbox repro, not a guess):** NOT the render path — the `if (!data) return <loader/>` gate was already sound. The **shell→iframe nav bridge** (`planar:nav-select` / `nav-select-by-site` / `nav-link` / `nav-create-linked` / `nav-dashboard` / `nav-new` / rename / delete in `public/sequence/index.html`) queues `setData(d => …)` functional updaters when the shell announces the active project on a tab switch; before the async `hs-v1` load resolves `d` is **null**, and React runs the queued updater INSIDE the next `useState` mount — `Object.values(d.projects || {})` throws and lands App in the error boundary. Cold boot = the race version (the bridge message beats the slow cloud load); fresh project = the deterministic version (no schedule linked, load still pending). Captured stack: updater → `Object.useState` → `App`. The prior "sandbox can't boot the embed" blocker is stale — the repro serves the embed's CDN deps from local copies via request interception (see the harness).
- **Fix shipped (minimal, matches the in-file `planar:view-set` precedent):** one early gate in the nav-bridge handler — drop `planar-shell` messages until `latestData.current` exists (the shell re-posts nav intents on every tab switch and retries `nav-request`, so an early drop self-heals the moment the load lands — the already-documented pre-load no-op behavior, now applied to every branch) — plus null guards in the three bridge-called helpers (`addProject` / `renameProject` / `deleteProject`) so a future caller can't regress the class.
- **Sandbox-verified 2026-07-05:** `ui-audit/verify-b644-fresh-null.mjs` (new, self-contained — fetches the four CDN deps once via curl, serves them by request interception): pre-fix it reproduces the exact owner error + stack; post-fix it PASSES (embed renders, zero null-`projects` errors). `jsxcheck-sequence` OK · build green.
- **⏳ Pending live (V211):** (1) fresh project on planyr.io → Schedule tab = clean empty state + connect panel, no error flash; (2) the original cold-boot first switch (V153 path) no longer flashes the error; (3) observe whether the "Assembling schedule…" overlay still exceeds the 6s backstop on a true cold load — the loader-timing half is a separate observation this fix does not claim to change (relates B494/B495).

_(new `Verify: live` items land here after implementation.)_

## 🕓 Later / Roadmap

*Deliberately deferred. Do **not** action these unless moved up to 🔲 Open.*

### B641 — Outfall intelligence: flowline + design-tailwater sourcing `[Site Planner / Stormwater]` (feature — umbrella; tier-2/3 screening slice SHIPPED with B636–B640)  *(owner brief 2026-07-03, arrived as "NEW-6" roadmap; owner then asked for the tractable slice in-session; first filed **B634**, RENUMBERED to **B641** on merge-in of `origin/main` — concurrent sessions took B629–B635; B641 = highest real B# across both files (B640) + 1. Code/harness keep the provisional B629-batch labels — see the B636 note in BACKLOG-DONE.md.)*
`[ ]` Source the receiving system's flowline + design-storm tailwater to move Regime-A coverage (B632) from assumption to sourced band. Confidence tiers: **(1) HCFCD effective HEC-RAS model extraction** (channel-bottom + WSEL by storm at the nearest cross-section — highest confidence; BLOCKER: external model acquisition + a HEC-RAS parser, own workstream), **(2) LiDAR ditch-bottom for open ditches** (3DEP) — ✅ **first slice shipped 2026-07-03**: `screenOutfall()` samples a 3DEP cross-profile through the nearest HCFCD channel unit (`ditchStats` invert/bank/depth) and renders the value-of-information line in the Regime-A banner ("assumed shallow outfall vs measured ditch depth — here's what to pull to confirm"); never auto-credited, **(3) storm-sewer GIS inverts** (COH `UN_Stormwater` already wired; HGL/surcharge caveat: a deep pipe invert with a high hydraulic grade line is Regime B, not A — needs invert-field probing on the geogimstest host), **(4) adjacent-plan OCR via Document Review** (BLOCKER: rides auto-filing). Output pattern stays value-of-information: "assumed shallow outfall = X% coverage; if the receiving channel is deep and unsubmerged, ~Y% — worth Z sf; here's what to pull to confirm." This is the substance of the `docs/ROADMAP.md` Tier-1 "storm outfall" item (annotated there; the rate-rules half = B636).

### B623 — User-editable schedule conventions (working week, holidays, month/year roll behavior) `[Scheduler]` (feature)  *(owner-dropped 2026-07-02 as "NEW-3", filed to Later/Roadmap by owner instruction — do NOT build until moved up; provisionally NEW-3/"B617", renumbered **B623** on the `origin/main` merge-in that took B615–B620; B623 = highest real B# across both files (B622) + 1)*
`[ ]` **Roadmap — sequence AFTER B621/B622 (the duration model + finish lock, in-code labels `B615`/`B616`) prove out.** A settings surface letting the user edit the schedule's own date conventions, extending the existing holiday-selection UI to also cover: (a) the **working week** — e.g. enable **6-day weeks** (B621 hard-codes the week to 5 working days; this makes it editable), and optionally (b) the **month/year roll behavior** (the plain-forward roll B621 fixed). Reasonable extension since holiday selection already exists (`ensureHolidays` / `HOLIDAY_SET` in `public/sequence/index.html`). **Same loud/visible discipline as the rest of the schedule:** the working week and roll direction silently change every derived date, so any change must **re-run cascade and SURFACE the shifted dates** (before/after diff, same discipline as B621's migration), never move them quietly. Depends on the B621 duration model (week-factor is currently the hard-coded `DUR_WD_FACTOR.w = 5` + the weekend test inside `addBD`/`workdaysBetween`/`rollForwardToWorkday` — those become the parameterized seam) and the B622 conflict-surfacing pattern (reuse the banner/row-flag). **Do NOT parameterize the week inside B621** — that was deliberately deferred here.

### B371 — GIS screening cache Phase 2: regional Houston-metro snapshot / offline pre-cache `[Site Planner / Analysis]` (feature) — Phase 2 of B367  *(filed 2026-06-22; minted **B371**)*
`[ ]` **Later (gated behind B367 Phase 1, which shipped).** Phase 1 (B367) keeps the last-good answer per parcel+layer and never blanks a layer on a transient outage. Phase 2 is the owner's "cache most of Houston" idea: a **regional pre-cache/snapshot** of the Houston-metro source layers (+ a coverage mask), refreshed on a schedule, so a **never-seen** parcel with no features resolves **offline** to "No <layer> mapped (source vintage <date>)" instead of waiting on (or failing) a live query. Heavier — needs storage (a Supabase table or a static snapshot) + a refresh job + a coverage mask so "no features in the snapshot" is trustworthy only inside the cached extent. Deferred deliberately behind Phase 1 per the brief; pick up once Phase 1 proves out in the field.

### B340 — Auto-assembly CV tails behind the B335–B339 seams `[Doc Review / Stitch]` (feature) — the hard minority  *(filed 2026-06-21 as the deferred remainder of the B335–B339 batch; minted **B340** — a hot `main` took B325–B334)*
`[ ]` The B335–B339 headline flow (drop a set → auto-group → auto-stitch → crop → auto-calibrate) is **shipped + verified** for the common case — CAD vector PDFs with a real text layer. (Scanned-sheet **OCR** was the 4th tail and is now **DONE → B352**, shipped + verified this session.) Three computer-vision tails remain, deferred behind clean injectable seams because each needs vector-graphics analysis we can't yet headless-verify — and the manual-Align safety net already covers them:
  1. **Graphic scale-bar reading (B339 tail)** — when there's no stated scale text, measure the drawn scale bar to set `ftPerUnit`. Needs vector-graphics/CV analysis, not text.
  2. **Geometric edge-line match (B337 middle fallback)** — when match-line *labels* are missing, match the cut geometry across two sheets' edges. Today, label-less sheets correctly drop to the 2-point manual Align **pre-seeded** with detected seam endpoints (the spec's final safety net, already wired) — this is the CV step between labels and manual.
  3. **Legend symbol-union (B338 tail)** — extract each sheet's graphical legend entries and union them into the pinned Composite key (today the key lists the grouped plan + auto-scale; the crop + pinned panel ship). Needs symbol/vector extraction.
> Each is gated behind a seam exactly like the app's other not-yet-provisioned heavy compute (the AI title-block reader, the APS converter). Pick up when there's a way to verify (a CV pass we can headless-check). Coupled to the ★ north-star "map → drawings → latest set."
>
> **AMENDMENT 2026-07-03 (owner pulled the CV tails into active scope, Cowork brief) — the PURE ENGINES for all three now ship + are unit-tested; the browser EXTRACTION + live verification remain.** These reduce manual-Align on *real* plan sets; they do **NOT** fix the JACINTOPORT schedule-set wall (that was B630–B633). What landed this session:
> 1. **Graphic scale-bar reading** — `src/shared/files/scaleBarRead.js` (`readScaleBar` + `clusterBars`/`ticksNearBar`/`tickLinearity`), wired fail-open via `sheetRead.scaleBarCalibration` as a fallback in `groupCalibration` (stated scale still wins). Reads a drawn bar's geometry + tick labels → `feetPerUnit`; only applies on a high-confidence, feet-unit read, never over a stated/manual cal.
> 2. **Geometric edge-line match** — `src/shared/files/edgeGeomMatch.js` (`fitEdgeLine` PCA/total-least-squares + `orderEndpoints` + `matchSeamEdges`), wired fail-open via `autoStitch.seamEndpointsFor` (prefers a drawn seam's geometry over the rectangle edge; improve-only, keeps the pre-seeded 2-point net). The vector path complementing the raster fitter (`matchLineFit.js`, B413).
> 3. **Legend symbol-union** — `src/shared/files/legendUnion.js` (`unionLegendEntries` + `legendFromPlaced`), wired into the Stitcher Composite key (rendered only when non-empty).
> **STILL OPEN (why this stays here):** each engine consumes geometry that a **browser vector/CV extractor must supply** — the `scaleBar` fact, per-sheet `seamGeom`, and per-sheet `legendEntries` — and **nothing populates those seams yet**, so all three are **dormant / zero behavior change today** (dormant exactly like the OCR/APS seams). None can be headless-verified → the extraction + real-browser proof on the owner's sets is **V201**. Fail open throughout; never present a topology-only placement as "aligned."

### B256 — Scheduler recompute is O(n²); will lag past ~500 tasks `[Scheduler / perf]` (task)  *(orig "P2"; minted **B256**)*
`[ ]` `cascadeDates`/`rollupParentDates` re-filter the task list repeatedly on each edit; `depLines` calls `tasks.indexOf` inside its loop; `rolledHealthMap`/`progressMap` recurse with `.filter`. Fine at the current ~180 tasks; will start to feel laggy past ~500. Fix: build an `id → index` map and a `parent → children[]` map once per recompute and reuse them — behaviour-preserving. **Verify** every task's start/end/duration is byte-identical before/after on the real production dataset. Gated by board size → Later until a board actually grows that large.

### B257 — Optional: instant cross-device "newer version" banner via Supabase realtime `[Scheduler / cloud]` (feature)  *(orig "B2 follow-up"; minted **B257**)*
`[ ]` The version-stamp guard + 20s polling already ship and work (the "newer version — Reload" banner appears within ~20s). Optional upgrade: enable Supabase **realtime** on the Scheduler data table and subscribe to row changes so the banner shows within ~1s; keep the 20s poll as a fallback if the channel drops. Needs a one-line SQL toggle on the Supabase project (owner/dashboard) — an external dependency — and it's polish, not a bug, so it sits in Later.

### B258 — Incremental cleanup of inline styles / inner-defined helpers `[Scheduler / code health]` (task)  *(orig "P4"; minted **B258**)*
`[ ]` Standing, opportunistic cleanup: as each Scheduler panel is touched for other work, hoist any helper components defined inside their parent to module scope (props-only) and lift repeated literal `style={{…}}` objects to module consts; memoize hot row renderers. B247 (the `Field` hoist) was the user-visible tip of this. Do it incrementally as code is touched — explicitly **not** one big sweep (UI must stay identical at each step), which is why it lives here rather than as a discrete Open task.

### B259 — Scheduler off in-browser Babel → a real build step `[Scheduler / build]` (project)  *(orig "P1/M1"; minted **B259**)*
`[ ]` The entire Scheduler (`public/sequence/index.html`, ~9.6k lines) is compiled by `@babel/standalone` in the browser on every load. Project-level work: move to a real build step / modularize. **Entangled** with the file's ability to save its own data back into itself (the File System Access auto-save rewrites the `<script id="planar-data">` block inside the HTML), so any change must preserve self-save. Plan deliberately; not required for any other Scheduler item. Deferred by design.

### B272 — Rule out a main-thread stall from non-Workerized heavy parsing `[Core / Site Planner]` (bug, low priority)  *(owner-dropped 2026-06-20 via chat; arrived as "NEW-2"; minted **B272** — secondary hypothesis to B271)*
`[ ]` Secondary hypothesis for the same "unclickable canvas" symptom: heavy CAD/PDF parse (or other compute) running on the **main thread** instead of a Web Worker, jamming the tab. **Investigated 2026-06-20 (B271 session):** PDF parsing already runs **off** the main thread — PDF.js uses its worker (a separate `pdf.worker` chunk in the build); DWG→DXF conversion is a **backend** (`/server`) concern, never in the browser. The reported incident's symptom (a frozen grab/hand cursor + clicks swallowed, with **no** Chrome "Page Unresponsive — Wait/Exit" prompt) is the signature of stuck pointer state, not a CPU stall, and is fully explained + fixed by **B271**. **No actionable main-thread-stall bug found.** Per the owner's note this drops to **low priority** now that B271 resolves the lockout — kept here (not closed) so it stays on the radar. **Escalate only** if an actual stall is ever observed: then instrument long-task timing, reproduce with a large drawing, and move any straggler heavy compute into a Worker per the standing architecture rule.

- **Enforced merge gate via GitHub branch protection** (the settings half of **B63**): require a PR + a passing build check + "branch up to date before merging" on `main`, plus repo auto-merge. On the **private** repo this only *enforces* on a paid plan (GitHub Pro+); on Free the rules save but don't block — so B63's branch → PR → green discipline is the backstop until then. Keep it a manual owner toggle rather than granting the Claude Code app admin rights on a credential-bound repo.

- **B150 — Wire dedicated county appraisal districts (CADs) for the Austin & DFW metros** `[Site Planner / map]` (feature) — *filed 2026-06-18 as a later-feature note (owner asked to park it).* Today only **Harris / Fort Bend / Chambers** have dedicated CADs in `lib/counties.js` (`COUNTIES` + `COUNTIES_MAP`). Austin (Travis/**TCAD**, Williamson, Hays) and DFW (Tarrant/**TAD**, Dallas/**DCAD**, Denton, Collin) parcels currently work **only via the statewide TxGIO fallback** (B137) — coverage is complete (verified: Travis 835K, Tarrant 757K, Dallas 694K, Williamson/Hays/Denton/Collin all present) and returns owner/situs/market-value/acreage, but the statewide copy can **lag** a county's live CAD and carries a **thinner field set** than the district's own service. Wire each county's dedicated CAD (verify it publishes a reachable, **CORS-clean** parcel service first — same vetting as the ETJ sources; some counties publish cleanly, some don't) so Austin/DFW get the same first-class, most-current parcel/appraisal data Houston has via HCAD/FBCAD; add per-county bbox routing to `candidateCountiesForPoint` as each lands.
  - **Bundle the county-mislabel fix:** a parcel in a non-configured county is presently tagged `chambers` (the statewide source's key) because the **B36(a)** `countyAtPoint` relabel only maps to the 3 wired CAD keys — so an Austin/DFW lot saves with the wrong `county`. Record the **true** county name even when no dedicated CAD is wired (cosmetic today; matters for the saved Site Model + which jurisdiction defaults show).
  - Coupled to **B11 / B13 / B36 / B137** (the county-resolution theme). **Not urgent** — the statewide fallback keeps Austin/DFW functional meanwhile; pick up when the owner is actively working those metros (start with Travis, Tarrant, Dallas).

---

## ✅ Done

> Completed items have been archived to **`BACKLOG-DONE.md`** to keep this file fast to load.
> When finishing an item, append its block to `BACKLOG-DONE.md` (do not add it here).
> The next B# = highest `B#` across **both** files + 1.
