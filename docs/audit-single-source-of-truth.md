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
