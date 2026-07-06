# BACKLOG_OPEN.md — open + verify index

> **Generated from `BACKLOG.md` by `scripts/build-backlog-index.mjs` — do NOT hand-edit.**
> One line per Open / Verify item so project-knowledge sync indexes the live open list and a
> chat session can see what's already filed without opening the 200 KB backlog. Regenerate it
> in the SAME commit as any `BACKLOG.md` edit; CI runs `--check` and fails the build on drift.
> _53 open · 10 awaiting live verification._

## 🔲 Open

| B# | Title | Module | Tags | Verify |
|---|---|---|---|---|
| B672 | Element-level sync, phase 3/5: realtime read path + rejoin refetch (read cutover; blob frozen) | [Site Planner] | #site-planner #persistence | live |
| B673 | Element-level sync, phase 4/5: loud-conflict surface + delete/edit matrix | [Site Planner] | #site-planner #ui #persistence | live |
| B674 | Element-level sync, phase 5/5: remove the edit lock — multi-writer cutover + presence pill | [Site Planner / Shell] | #site-planner #ui #persistence | live |
| B663 | ONE-TIME migration: every existing project gets the standard tree + existing files move into their tree folders in Drive | [Library / storage] | #library #drive | — |
| B662 | Unified Library: the folder tree IS the view, and files live inside it (+ the live-502 chunked Drive sync fix) | [Library / Doc Review / storage] | #library #drive #persistence | — |
| B655 | Detention sizing card in the pond inspector, with a pumped-outfall toggle | [Site Planner / detention] | #site-planner #pond #yield | sandbox |
| B656 | Properties inspector follows selection instead of occupying a rail tab | [Site Planner / UI] | #site-planner #ui #selection | sandbox |
| B657 | Terminology & consistency pass | [App-wide / UI] | #ui | sandbox |
| B650 | Per-project standard folder tree, user-editable in-app, with continuous one-way sync to Google Drive | [Doc Review / Library / storage · drive-integration / persistence] | — | — |
| B648 | Persistence & Sync epic: one umbrella + a canonical write-path doc | [Site Planner / Persistence] | #persistence | live |
| B629 | Drive-backed county PARCEL snapshot cache so outages stop breaking the map | [Site Planner / GIS] | #site-planner #gis #drive | — |
| B553 | Surface drawn landscaping in the yield breakdown (own line, kept pervious) | [Site Planner / yield] | #site-planner #yield | — |
| B499 | Harden the LOAD-time self-heal for the OTHER bonded children (sidewalk / dock-zone stack / side-parking) | [Site Planner / Site Model] | #site-planner #persistence | — |
| B495 | Schedule module: instant first paint (stale-while-revalidate local cache) | [Scheduler / perf] | #scheduler #perf #persistence | — |
| B483 | A 100%-full localStorage boots the app signed-out (auth-token refresh write fails) | [Auth / Storage] | #auth #persistence | — |
| B484 | Renderer freezes (~30 s main-thread stalls): PDF title-block reading, heavy map/parcel ops, and panel/rail scrolling (×2) | [Doc Review + Site Planner / perf] | #doc-review #site-planner #perf | live |
| B474 | Move the Site Planner on-device cache off the 5 MB localStorage cap onto IndexedDB | [Site Planner / Persistence] | #site-planner #persistence | — |
| B479 | Persistence "state-of-the-art" perf refactors (the deferred tail of the B485 review) | [Site Planner / Persistence] | #site-planner #persistence #perf | — |
| B471 | Revision compare (current vs. previous version), state-of-the-art | [Doc Review / compare] | #doc-review #compare | — |
| B423 | Shared markup/measure tool engine + Bluebeam-parity refinement loop | [Site Planner + Doc Review / Markup] | #site-planner #doc-review #markup | — |
| B422 | Named markup Layers (show / hide / lock / rename / reorder) | [Doc Review / Markup] | #doc-review #markup | — |
| B413 | Auto-stitch scanned, scale-less survey sheets that carry NO match-line text | [Doc Review / stitching] | #doc-review #stitching | — |
| B411 | Auto-filing residual gaps after the multi-discipline split (B410) | [Doc Review / auto-filing] | #doc-review #filing | — |
| B409 | Large files (>~100 MB) now upload to Drive via a browser-direct resumable path — no more silent "oversize" | [Doc Review / storage] | #doc-review #drive | — |
| B408 | Decide &, if chosen, consolidate the Scheduler onto the main Supabase project | [Infra / Scheduler] | #infra #scheduler | — |
| B406 | Shared team workspaces: invite by email, share a project with a team | [Site Planner + Doc Review] | #site-planner #doc-review #infra | — |
| B370 | Migrate the remaining MAP-DISPLAY layer endpoints into the GIS source registry | [Site Planner / Platform] | #site-planner #gis | — |
| B364 | Enable the scanned / image-only + DWG reading path for the no-text-layer minority | [Doc Review] | #doc-review #filing | — |
| B309 | Retire client-side Mapillary token paths once the proxy lands | [Site Planner] | #site-planner #gis | — |
| B267 | Auto-calibrate a sheet from its stated scale callout | [Doc Review / Markup] | #doc-review #markup | — |
| B268 | Independent scale cross-check against on-sheet geometry (verify the stated scale) | [Doc Review / Markup] | #doc-review #markup | — |
| B269 | Remove the uploaded sample drawing PDFs from GitHub (test fixtures, not for `main`) | [Doc Review / repo hygiene] | #doc-review #testing | — |
| B273 | Filing-workflow practice: read a dropped file's title block → propose its project / discipline / sheet / date | [Doc Review / filing] | #doc-review #filing | — |
| B255 | Collapse the duplicate indent/outdent + column-autosize functions | [Scheduler / code health] | #scheduler | — |
| B180 | Project Files repository as a tagged-index with saved views | [Document Review / Files] | #doc-review #files | — |
| B181 | Capture placement-readiness flags in file facts at filing time | [Document Review / Files] | #doc-review #files | — |
| B182 | "Place on map" auto-placement cascade | [Site Planner / Files] | #site-planner #files | — |
| B183 | Dimension-based calibration + auto-verification probe | [Site Planner / Document Review / Files] | #site-planner #doc-review #files | — |
| B179 | Backend per-account exact tax fetch | [server] | #infra | — |
| B178 | Combined-rate choropleth | [Site Planner] | #site-planner #gis | — |
| B177 | Parcel tax breakdown panel | [Site Planner] | #site-planner | — |
| B171 | Evaluate license-clean high-res imagery sources | [Site Planner] | #site-planner #gis | — |
| B163 | Project `progress_pct` field on data model | [Site Planner] | #site-planner #persistence | — |
| B147 | Site Analysis tool: multi-parcel constraint & context screen | [Site Planner / Site Analysis] | #site-planner #gis | — |
| B115 | Revisit keyboard shortcuts: memorability + let the owner remap them | [Site Planner / UI] | #site-planner #ui | — |
| B13 | Refine B11 county resolution: precise boundaries + per-area jurisdiction | [Site Planner / map] | #site-planner #gis | — |
| B128 | Import reported 3 sites but the account total rose by 2 — confirm all imports land | [Persistence] | #persistence | — |
| B131 | Clip a generated parking field to the parcel boundary | [Site Planner] | #site-planner | — |
| B134 | Edits silently lost on reload; app loads a stale earlier state | [Persistence] | #persistence | — |
| B20 | `setProjectStatus` rewrites every plan in the group via `cloudUpsert` (strips inline underlay, heavy, clobber risk) | [Document Review] | #doc-review #persistence | — |
| B38 | SQL/RLS & data-integrity audit (mostly clean) | [Document Review / DB] | #doc-review #persistence | — |
| B63 | Parallel-session merge safety: branch → PR → green-build gate | [repo / workflow] | #infra #testing | — |
| B95 | Jurisdiction → development-consequence summary | [Site Planner / GIS] | #site-planner #gis | — |

## ⏳ Verify — awaiting live confirmation

| B# | Title | Module | Tags | Verify |
|---|---|---|---|---|
| B675 | Planyr MCP connector: read-only `/api/mcp/<token>` endpoint gives Claude live cross-project context | [functions/api/mcp] | #infra #files | ⏳ live — awaiting |
| B676 | Library pins follow the ACCOUNT (Supabase cloud sync) instead of per-device | [Library] | #library #persistence #auth | ⏳ live — awaiting |
| B669 | Keep-alive module switching: visited workspaces stay mounted (hidden), switching is instant | [Shell / all modules] | #ui #perf #infra | ⏳ live — awaiting |
| B668 | Library Home: pinned folders/files + recent drawings + project cards | [Library] | #library #ui #files | ⏳ live — awaiting |
| B667 | Review remembers the last document PER PROJECT (+ the resume self-clobber fix) | [Doc Review] | #doc-review #persistence | ⏳ live — awaiting |
| B664 | Drag a whole FOLDER onto the Library and it auto-files every PDF inside it | [Library / storage] | #library #files #filing | ⏳ live — awaiting |
| B658 | Replace landing-page copy with the approved buyer-voice deck | [Landing / marketing] | #ui | ⏳ live — awaiting |
| B651 | Parcel split double-counts acreage; make split REPLACE the parent (parent + children can never both be active) | [Site Planner] | #site-planner #yield #selection | ⏳ live — awaiting |
| B659 | Sheet reader + file organizer revamp: rotated/offset pages, set-aware titles, left-edge & vertical title blocks, title-first grouping, date-first names | [Doc Review / Library] | #doc-review #library #files #filing | ⏳ live — awaiting |
| B644 | Scheduler embed: first COLD boot throws `Cannot read properties of null (reading 'projects')` + the loader overlay exceeds the 6s backstop (self-recovers) (×2) | [Scheduler / robustness] | #scheduler | ⏳ live — awaiting |

## By tag

- **#auth** — B483, B676
- **#compare** — B471
- **#doc-review** — B484, B471, B423, B422, B413, B411, B409, B406, B364, B267, B268, B269, B273, B180, B181, B183, B20, B38, B667, B659
- **#drive** — B663, B662, B629, B409
- **#files** — B180, B181, B182, B183, B675, B668, B664, B659
- **#filing** — B411, B364, B273, B664, B659
- **#gis** — B629, B370, B309, B178, B171, B147, B13, B95
- **#infra** — B408, B406, B179, B63, B675, B669
- **#library** — B663, B662, B676, B668, B664, B659
- **#markup** — B423, B422, B267, B268
- **#perf** — B495, B484, B479, B669
- **#persistence** — B672, B673, B674, B662, B648, B499, B495, B483, B474, B479, B163, B128, B134, B20, B38, B676, B667
- **#pond** — B655
- **#scheduler** — B495, B408, B255, B644
- **#selection** — B656, B651
- **#site-planner** — B672, B673, B674, B655, B656, B629, B553, B499, B484, B474, B479, B423, B406, B370, B309, B182, B183, B178, B177, B171, B163, B147, B115, B13, B131, B95, B651
- **#stitching** — B413
- **#testing** — B269, B63
- **#ui** — B673, B674, B656, B657, B115, B669, B668, B658
- **#yield** — B655, B553, B651
