# Audit — one source of truth for shared data (B1953792)

Scope: every fact more than one surface can show or change, **except names** (owned by
`src/shared/names/*`, B1953200). Method: read-only code audit by module (Site Planner + shared stores ·
Scheduler + Dashboard · Review/Library/Notes/Model/Food · repo-wide pattern grep for seeded `useState`,
module caches, persisted derived fields, identity-by-name, cross-tab listeners), 2026-09-29. Every **A**
below rests on code read at the cited lines; none was speculative. Verdicts: **A** a user can see a stale
or conflicting value (fix) · **B** intentional snapshot (labelled) · **C** cache with correct invalidation.
Fix column = backlog item (each has a red-proof test). Status is kept current on the items, not here.

Groups → items: **G1** B1953793 shared prefs/rules/pins · **G2** B1953794 site-planner calc ·
**G3** B1953795 scheduler/dashboard · **G4** B1953796 review/library/model/food · **G5** B1953797 plan
header merge + Model site reads.

## A — fix

| # | Fact | Copies / writers → readers | User-visible failure | Fix |
|---|---|---|---|---|
| G1-1 | Account prefs bag `profiles.prefs` (sitesPanel pins/order, planStandards, newProjectSharing, dashboard keys) | 3 in-memory copies (`MapFinder` acctPrefs, `SitePlanner` userPrefs, `ProjectBreadcrumb` ref); all write via `savePrefsRaw` = whole-bag upsert | Pin in header never shows on Map panel; a later Map collapse deletes the pin; a stale tab reverts the Dashboard layout / "since last here" mark | B1953793 |
| G1-2 | Flood / easement rule tables | `SitePlanner` seeds once from localStorage, writers save whole map | Tab B's "verified" tick reverts tab A's Harris ratio | B1953793 |
| G1-3 | Pinned FOLDER label | `pinStore.label` snapshot at pin time; `LibraryHome` FolderCard renders it | Renamed folder still shows old name on Library Home | B1953793 |
| G2-1 | Floodplain mitigation memo | `_mitMemo` key omits `floodwayBufferFt` | Switching Fort Bend→Waller serves stale unbuffered floodway acres (and export) | B1953794 |
| G2-2 | Easement jurisdiction | `jurKey` = seed-once copy of county, override not persisted | County heal fixes county but easement panel / water-line width stay on the wrong jurisdiction; picked override lost on reload | B1953794 |
| G2-3 | Building COUNT | Dashboard counts every `type==="building"`; planner excludes dog-ear bump-outs | "6 buildings" vs "2 buildings" | B1953794 |
| G2-4 | Representative plan of a project | Dashboard = newest cloud `updated_at` (header only); Map = first by local `updatedAt` | Edit only Concept B: Map shows B, Dashboard row shows A's yield | B1953794 |
| G2-5 | Plan thumbnail | `sites.thumbnail_svg` refreshed only on non-skipped header push; element edits skip | Recent-plans card shows an old picture | B1953794 |
| G3-1 | "Has a schedule" flag | `data.scheduleProjectId` mirror of `schedules.linkedSiteId`; unlink/move/delete never clear it | Calendar icon stays on the old project | B1953795 |
| G3-2 | Task "complete" | `health==="green"` vs `percentComplete`, leaf writers never sync; readers disagree | Pill green + Gantt solid but grid/master % = 0; typing 100% on overdue task stays red | B1953795 |
| G3-3 | Since-you-were-last-here snapshot | keyed by positional `task.id` (renumbered on insert) | False "slipped" rows; click opens wrong task | B1953795 |
| G3-4 | Schedule health / needs-attention | Dashboard heuristic (7-day) vs grid rule engine (3-day, custom rules); stamp only written while Scheduler open | Two Dashboard cards disagree; under-reports while Scheduler closed | B1953795 |
| G3-5 | Agenda items | `useState` seed, whole-list overwrite, no cross-tab | Item added in tab A lost by tab B | B1953795 |
| G3-6 | Owner ↔ contact link | name strings; cascade case-sensitive, picker case-insensitive | Contact rename misses a task; duplicate contact respawns | B1953795 |
| G4-1 | Doc `folderId` / `sourceFile` / stitch `orgScope` | autosave snapshot omits them; `casUpsert` replaces `data` wholesale | Open a filed doc, draw once → Library moves it out of its folder | B1953796 |
| G4-2 | Filing facts (`file_facts` vs `doc_reviews`) | facts written only by Library upload/refile; Review bar, refile, delete change reviews only | Stays in "Needs filing"; MCP counts wrong project / deleted docs | B1953796 |
| G4-3 | Signed-out Model workbook | keyed by `local` scope, never adopted on sign-in | Workbook blank after sign-in | B1953796 |
| G4-4 | Model `Comp.*` names | comps fetched once per project | Edited lease rate not reflected / `#NAME?` | B1953796 |
| G4-5 | Food manual pin identity | list keys by name, map/wishlist by name+lat+lon | Two same-name pins merge in list | B1953796 |
| G4-6 | Org workbook name | content save re-sends `name` from local state | Stale tab's edit reverts another tab's rename | B1953796 |
| G4-7 | Library file list | fetched on mount only; duplicate check uses it | Second copy filed across tabs | B1953796 |
| G4-8 | `comps.county`; deletion gate | sync RPC updates lat/lon only; gate checked once per project | Comp county stale after overlay moves; deleted project stays writable in another tab | B1953796 |
| G5-1 | Plan header `settings`/`origin` | no inbound path; conflict re-pushes this tab's whole header | Tab B's setback edit silently reverts tab A's jurisdiction | B1953797 |
| G5-2 | Model `Site.Acres`/`Plan.Building.SF` | read local slim header (no parcels/els) on a device that never opened the plan | `#REF!` or last week's numbers | B1953797 |

## B — intentional snapshots (labelled; not touched)
`scheduleProjectName` / `linkedSiteName` (write-once name hints; names session) · `parcel.attrs` county record at add time + split-child inheritance · `sinceLastHere` plan diff baseline and `stampedAt` · version history / `planar_history` / `parcel.gisKey` · `settings.floodMitigation.jurKey` and `drainage.authorityId` as explicit overrides · `settings.printPreparedBy` · `doc_reviews.project`/`title` (project-name copies, names session) · dashboard prefs mirrors as offline fallback · the single global `currentSite` pointer (tie-break only).

## C — caches with correct invalidation (cited)
Building SF / coverage / parking / acreage: one pure `siteMetrics`, memoized on `[els, parcels, overlaps, settings]`, read by canvas, Yield and `printMetricPairs` (export rebuilds `exportCtx()` per call) · Map/Sites acreage `siteBoundaryInfo` · jurisdiction badge `jurBadgeCache` (ring signature) · drainage `lastCheck` (`drainSigNow` + `drainFreshness`) · `restored.county` heal · `_pondFactsMemo`/pondGeom memos (input-keyed) · project list/breadcrumb/switcher (`onProjectsChanged` + `storage` + focus) · pins (row upserts + focus refetch) · `profileRowCache` reads (30 s TTL, every write invalidates) · smoothZoom pref · Notes scope (derived from root; sibling-window listener) · Shell route/project · Dashboard (remounts per visit) · Library Home file cards resolve live docs · scheduler parent rollups (`recomputeSchedule`), parent health (`computeRolledHealth`), module globals rebuilt in the data effect · Master report identity by `projId` (#1849 — no name-keyed remnant found) · contacts cascade across schedules (single store `settings.contacts`) · comps site_plan lat/lon RPC.

## Cross-tab liveness inventory (who listens today)
`storage` handlers: ProjectBreadcrumb, `projects.js onProjectsChanged` (names, Model, Notes, Scheduler subscribe), `pinStore`, `smoothZoom`, `notesStore`, `SitePlanner` (skipped when cloud active), `SitePlannerApp`, `storage.js onSiteModelChanged`. BroadcastChannel: presence only. **No listener** (fixed or argued in the items above): agenda, org workbook index, account prefs mirror, Library sort/open cats (view prefs — accepted), `newProjectSharing` ctx, `coverage` prefs, `colorRecents` (low, view-only — accepted as B).

---

# Part 2 — copies in OTHER DATABASE TABLES and jsonb blobs (B2064896, 2026-10-04)

Part 1 above found stale copies held in component state. The 2026-09-29 live check then found copies the
component-state guard cannot see: values stored in a second TABLE (`schedules.linked_site_name`,
`doc_reviews.project`). This pass inventories **every column of every `public` table and every jsonb blob**
(`sites.data`, `schedules.data`, `doc_reviews.data`, `planar_data`, `site_plan_overlays`, notes/model blobs),
and — new — compares each stored copy with its source **in production data** (read-only). Instruments:
`npm run drift-report` (`scripts/drift-report.sql`, 25 checks, one SELECT) and the manifest
`scripts/denormalisedCopies.json`, which `test/denormalisedCopies.test.js` enforces in CI.

**State of PR #1892 (B1991040/B1991041 — names in `schedules` / `doc_reviews`) when this ran:** open, build
in progress, conflicted against main. Not duplicated here: its code and backfill files are its own. The
manifest entries that depend on it (`C01`, `C07`, `C26`) carry `pendingOn: PR #1892`, and the test fails the
moment their evidence lands without the marker being deleted.

## Production drift, before → after (read-only `drift-report.sql`, 2026-10-04)

| Check | Copy → source | Verdict | Drifted / total **before** | **After** |
|---|---|---|---|---|
| D01 | `schedules.linked_site_name` → `sites.site` | A | 1 / 7 | 0 after #1892's backfill |
| D03 | `schedules.linked_site_id` → a live project | B | 1 / 8 (schedule 24 → deleted project) | reported, kept (restore re-attaches) |
| D04 | `sites.data.scheduleProjectId` ↔ schedules' links | A | 4 / 22 | converges on next Dashboard load; backfill below |
| D05 | `sites.data.scheduleProjectName` → `sites.site` | B | 1 / 14 | never displayed — labelled |
| D06 | `doc_reviews.project` → `sites.site` | A | 1 / 14 | 0 after #1892's backfill |
| D07 | `doc_reviews` cols ↔ `data` | C | 1 / 36 (an empty draft) | harmless |
| D08 | `file_facts` item/revision/date/discipline → `doc_reviews` | A | 4 / 9 | 0 after backfill (blanks only) |
| D09 | `file_facts.source_file` ↔ `data.sourceFile` | C | 0 / 9 conflicting (8 are a blank review side) | n/a |
| D10 | `site_plan_overlays.doc_title/doc_date` → review | B | 1 / 1 | an editable name — override stays |
| D11 | `site_plan_overlays.project_id` → review's | B | 1 / 1 | different fact (Map "Site" vs Library filing) |
| D12 | child `team_id` → project's `team_id` | B | 6 / 22 | **owner decision** (OWNER-TODO.md) |
| D13 | `sites` cols ↔ `data` | C | 0 / 86 | — |
| D14 | `sites.site` across a project's plans | A (names, B1953200) | 0 / 57 | — |
| D15 | `sites.data.status` across a project's plans | **A** | **1 / 57** (8 South: pursuit vs active) | 0 after backfill |
| D16 | role / dates across a project's plans | C | 0 / 57 | — |
| D17 | `sites.thumbnail_svg` older than its plan | C | 9 / 59 | event-driven refresh |
| D18 | `sites.updated_at` ↔ `data.updatedAt` | C | 1 / 86 | different things (server touch vs client edit) |
| D19 | `sites.data.els` ↔ `site_elements` rows | C | 0 / 86 | rows canonical |
| D20 | `project_folders` name/trashed ↔ `drive_*` | C | 315 / 9297 | Drive mirror lag, readers use `name/trashed` |
| D21 | folder rows of a deleted project | B | 3276 / 9468 | purged with the project (30 d) |
| D22 | `food_dishes.place_id` → visit | C | 0 / 8 | DB trigger |
| D23 | `profiles.email` → `auth.users.email` | A (latent) | 0 / 9 | trigger added |
| D24 | `planar_data` blob → `schedules.data` | B | 5 / 10 | frozen legacy after the flip |
| D25 | `recovery_*` tables | B | — / 6 tables | intentional backups, listed |

The "after" column for the backfilled items is proven on a copy of the data in the PR (see
`src/workspaces/site-planner/db/single_source_backfill_20261004.sql`, which has a read-only preview and
is **not** applied by hand).

## Verdicts for the copies found in this pass

**A — fixed (a user can see a stale or conflicting value):**
- **A1 project status split (D15)** — status is project-level but written by a per-plan loop with no atomic
  RPC, so a partial write left one project `pursuit` on one plan and `active` on another; Map and Dashboard
  answered from the element-recency plan, breadcrumb/Library/MCP from the newest header. Fix: ONE answer,
  `projectModel.groupStatusOf` (newest plan header wins), now read by Map `siteGroups`, Dashboard
  `groupProjectsByGroupId` and breadcrumb `groupProjects`. (B2064897)
- **A2 "has a schedule" hint (D04)** — `sites.data.scheduleProjectId` was healed only while the Schedule tab
  was open. Fix: the Dashboard, which already reads the schedule rows on every visit, heals the hint from
  them (`planHintHealFromRows`). (B2064898)
- **A3 filing facts (D08)** — `file_facts` kept blank item/revision/date where the review had values and MCP
  output showed the blanks. Fix: `applyReviewTruth` takes the review's value first; backfill fills blanks only.
  (B2064899)
- **A4 profile email (D23, latent)** — copy written by the insert trigger only. Fix: update trigger
  `sync_profile_email` + non-destructive backfill. (B2064900)
- **A5/A6 names in `schedules` / `doc_reviews` (D01/D06)** — #1892 (B1991040); this pass only measures them.

**B — intentional, labelled:** `sites.data.scheduleProjectName` (write-once hint, never shown) ·
`schedules.linked_site_id` to a deleted project (kept so a restore re-attaches) · overlay `doc_title`
(user-editable name; an explicit override stays an override), `doc_date`, `project_id`, `locked` (separate
stores by owner constraint 11) · child `team_id` (sharing is per object, owner decision 2026-08-09; **the six
differing rows are a product question, not a copy to sync** — see OWNER-TODO.md) · `planar_data` legacy blob ·
`problem_reports.user_email/build/route` (point-in-time) · folder rows of a deleted project (until purge) ·
**`recovery_*` snapshot tables** (intentional backups — `recovery_20260822_*`, `recovery_20260905_*`,
`recovery_b1160480_*`, `recovery_20260912_*`; never read by the app).

**C — caches with a cited invalidation** (each entry names its evidence line in the manifest): `sites`
column mirrors (trigger + one writer) · `doc_reviews` columns ↔ blob (one upsert) · `file_facts.source_file`
(loadReview fills the blank side) · `sites.thumbnail_svg` (refresh after every push) · `sites.updated_at`
vs `data.updatedAt` (different facts) · `sites.data.els` (rows canonical) · `project_folders.drive_*`
(server-only mirror) · `food_dishes.place_id` (trigger).

**Counts: A 6 (4 fixed here, 2 by #1892) · B 11 · C 11.**

## Adversarial pass — what was tried to break the conclusion

Triggers (`information_schema.triggers`), SECURITY DEFINER RPCs that write a copy (`rename_site_group`,
`reconcile_site_group_name`, `set_site_group_role`, `set_project_team*`, `schedules_decompose_from_planar_data`,
`handle_new_user`, `folder_set_drive_meta`, `commit_site_plan_overlay_placement`) and Pages Functions were
read for a write that fans a value out. Findings: `set_project_team` updates `sites` only — reviews, overlays,
comps and notes keep their own `team_id` (D12; deliberate); `rename_site_group`/`reconcile_site_group_name`
touch `updated_at` but not `data.updatedAt` (D18; different facts); no trigger writes a value into a second
table except the two already declared (`food_dishes` place id, `sites` site mirror). No jsonb field in
`schedules.data` / `doc_reviews.data` / `site_plan_overlays` duplicates a value that another table owns beyond
those in the manifest. **Passes: 3** (inventory + production drift → fixes + re-run → adversarial trigger/RPC/
function read, which found D12 and D18 and no new A).
