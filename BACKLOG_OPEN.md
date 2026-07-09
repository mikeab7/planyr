# BACKLOG_OPEN.md — open + verify index

> **Generated from `BACKLOG.md` by `scripts/build-backlog-index.mjs` — do NOT hand-edit.**
> One line per Open / Verify item so project-knowledge sync indexes the live open list and a
> chat session can see what's already filed without opening the 200 KB backlog. Regenerate it
> in the SAME commit as any `BACKLOG.md` edit; CI runs `--check` and fails the build on drift.
> _58 open · 40 awaiting live verification._

## 🔲 Open

| B# | Title | Module | Tags | Verify |
|---|---|---|---|---|
| B741 | Orphaned / misfit selection handles on angled elements | [Site Planner] | #site-planner #selection #ui | live |
| B739 | GIS overlay layers (floodplain / wetlands / etc.) are absent from the PDF/PNG export | [Site Planner / GIS · export] | #site-planner #export #gis | live |
| B735 | AnchoredMenu portal + click-away backdrop can linger over the newly-active workspace when a menu is left open and the user navigates via browser Back/Forward | [App Shell / UI] | #ui #infra | live |
| B720 | Canonical thoroughfare-segment data model + jurisdiction registry | [Site Planner / GIS · data model] | #thoroughfare #gis #persistence #coordinates | live |
| B721 | Ingestion adapter #1: City of Houston Major Thoroughfare & Freeway Plan (MTFP) | [Site Planner / GIS · ingestion] | #thoroughfare #gis | live |
| B722 | Config-driven ingestion adapters: surrounding jurisdictions (Harris · Fort Bend · Pearland · Montgomery · H-GAC) | [Site Planner / GIS · ingestion] | #thoroughfare #gis | live |
| B723 | Map layer: "Thoroughfare Plan" overlay | [Site Planner / GIS · map layer] | #thoroughfare #gis #site-planner #ui | live |
| B724 | Parcel analysis: frontage detection + ROW-dedication estimate | [Site Planner / analysis] | #thoroughfare #site-planner #yield #gis | live |
| B725 | Auto-generated entitlement issues from thoroughfare-plan exposure | [Site Planner / entitlements] | #thoroughfare #entitlements #site-planner | live |
| B726 | Thoroughfare-plan versioning + data-freshness tracking | [Site Planner / GIS · data ops] | #thoroughfare #entitlements #gis #infra | live |
| B691 | Fort Bend 1-ft contours layer dead: browser CORS-blocks `arcgisweb.fortbendcountytx.gov` — route it through the server-side GIS proxy | [Site Planner / GIS] | #site-planner #gis | live |
| B663 | ONE-TIME migration: every existing project gets the standard tree + existing files move into their tree folders in Drive | [Library / storage] | #library #drive | — |
| B662 | Unified Library: the folder tree IS the view, and files live inside it (+ the live-502 chunked Drive sync fix) | [Library / Doc Review / storage] | #library #drive #persistence | — |
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
| B744 | "Drop site plan" overlay hint sticks after a drag leaves the window; make it non-obscuring | [Site Planner] | #site-planner #ui | ⏳ live — awaiting |
| B742 | Delete on a road silently no-ops for many clicks, then suddenly works | [Site Planner] | #site-planner #road #selection #persistence #ui | ⏳ live — awaiting |
| B743 | Harden the shared element-delete path so no element type can silently no-op | [Site Planner] | #site-planner #selection #persistence #testing | ⏳ live — awaiting |
| B740 | Shift-click multi-select + shared property editing (opacity/style) | [Site Planner] | #site-planner #selection #ui #markup | ⏳ live — awaiting |
| B738 | Satellite/aerial basemap missing from PDF/PNG export (plan prints on a blank white background) | [Site Planner] | #site-planner #export #gis | ⏳ live — awaiting |
| B737 | Unify the ParcelDrawing overlay onto the shared per-object style model (fill/weight/dash/opacity + capability-driven panel) | [Site Planner / Markup] | #site-planner #markup #selection | ⏳ live — awaiting |
| B719 | Road curb/border drawn far too thick: size it to a true 6″ (0.5′) curb, to scale | [Site Planner] | #site-planner #road #ui | ⏳ live — awaiting |
| B734 | Account dropdown opens pinned to the top-left corner instead of under the account pill | [App Shell / UI] | #ui #infra | ⏳ live — awaiting |
| B717 | Poppable / floating left panels + always-visible icon rail for the Site Planner | [Site Planner / UI] | #site-planner #ui | ⏳ live — awaiting |
| B715 | Site acreage double-counts overlapping active parcels: DISSOLVE the rings so shared ground counts once (Martini 176.6 → ~88.6 ac) | [Site Planner / Yield · Analysis] | #site-planner #yield | ⏳ live — awaiting |
| B716 | Clean up phantom drawn parcels on the Martini site (`smqsfzqc72pw`): soft-deleted 2 attr-less outlines + 1 degenerate dup sliver → ~88.6 ac | [Site Planner / data] | #site-planner #persistence | ⏳ live — awaiting |
| B707 | Floodplain mitigation engine: rules matrix + elevation-based compensating-storage volume | [Site Planner / Stormwater] | #site-planner #gis #pond | ⏳ live — awaiting |
| B712 | Floodplain surfacing & integration: mitigation/buildability card, combined detention readout, inputs, cost lines, print | [Site Planner] | #site-planner #ui #yield #export #gis | ⏳ live — awaiting |
| B703 | Elevation layer painted Houston terrain as one flat green sheet — replaced with view-relative DRA ground relief | [Site Planner / GIS] | #site-planner #gis | ⏳ live — awaiting |
| B704 | 1-ft labeled contour lines, client-generated from the raw 3DEP DEM in a Web Worker | [Site Planner / GIS] | #site-planner #gis #perf | ⏳ live — awaiting |
| B705 | Drainage flow-direction arrows (which way the site sheets) | [Site Planner / GIS] | #site-planner #gis | ⏳ live — awaiting |
| B706 | Hover ground-elevation readout on the cursor coordinate chips | [Site Planner] | #site-planner #gis #ui | ⏳ live — awaiting |
| B699 | Whole content pane is the drop target; drag-onto-folder files into it; ONE empty state; folder drops preserve your subfolder structure | [Library / storage] | #library #files #filing #drive | ⏳ live — awaiting |
| B701 | Honest Drive-sync footer: backend-driven resting status, "Synced · N min ago", loud failure | [Library / storage] | #library #drive #persistence | ⏳ live — awaiting |
| B695 | Name the boundaries: hover/click identify + zoom-gated county/city name labels | [Site Planner / map] | #site-planner #gis #ui | ⏳ live — awaiting |
| B694 | County / city / ETJ boundary layers ride the cached vector tier: instant paint, no 503 stalls | [Site Planner / GIS] | #site-planner #gis #perf | ⏳ live — awaiting |
| B693 | Aerial basemap control: honest disabled state without a placement; folded into the shared panel as a Basemap group (Off / Aerial / USGS) | [Site Planner] | #site-planner #ui #gis | ⏳ live — awaiting |
| B692 | ROOT-CAUSE fix for the B690 husk-parcel crash: sanitize the model funnel so a null/points-less entry can never be manufactured, persisted, or re-ingested | [Site Planner / model] | #site-planner #persistence | ⏳ live — awaiting |
| B687 | Dropping into a selected Library folder files it there (folder pick wins over auto-sort) | [Library / Doc Review / storage · drive] | #library #files #filing #drive #doc-review | ⏳ live — awaiting |
| B685 | Library upload was PDF-only; accept ANY file type | [Library / Doc Review] | #library #files #filing #doc-review | ⏳ live — awaiting |
| B684 | Export to Google Earth (KMZ) via right-click, in both the map viewer and the canvas | [Site Planner / Map] | #site-planner #export #coordinates | ⏳ live — awaiting |
| B682 | Dragging a parcel's acreage label spawns a "bunch of copies" (id-less parcels + value-based union merge) | [Site Planner] | #site-planner #persistence #selection | ⏳ live — awaiting |
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
| B673 | Element-level sync, phase 4/5: loud-conflict surface + delete/edit matrix | [Site Planner] | #site-planner #ui #persistence | ⏳ live — awaiting |
| B674 | Element-level sync, phase 5/5: remove the edit lock — multi-writer cutover + presence pill | [Site Planner / Shell] | #site-planner #ui #persistence | ⏳ live — awaiting |
| B714 | Sharing a project silently REVERTS: any ordinary save from the owner's open tab overwrote `sites.team_id` back to null, locking the collaborator out | [Site Planner / Review / teams · RLS] | #site-planner #persistence #auth | ⏳ live — awaiting |

## By tag

- **#auth** — B483, B676, B714
- **#compare** — B471
- **#coordinates** — B720, B684
- **#doc-review** — B484, B471, B423, B422, B413, B411, B409, B406, B364, B267, B268, B269, B273, B180, B181, B183, B20, B38, B687, B685, B667, B659
- **#drive** — B663, B662, B629, B409, B699, B701, B687
- **#entitlements** — B725, B726
- **#export** — B739, B738, B712, B684
- **#files** — B180, B181, B182, B183, B699, B687, B685, B675, B668, B664, B659
- **#filing** — B411, B364, B273, B699, B687, B685, B664, B659
- **#gis** — B739, B720, B721, B722, B723, B724, B726, B691, B629, B370, B309, B178, B171, B147, B13, B95, B738, B707, B712, B703, B704, B705, B706, B695, B694, B693
- **#infra** — B735, B726, B408, B406, B179, B63, B734, B675, B669
- **#library** — B663, B662, B699, B701, B687, B685, B676, B668, B664, B659
- **#markup** — B423, B422, B267, B268, B740, B737
- **#perf** — B495, B484, B479, B704, B694, B669
- **#persistence** — B720, B662, B648, B499, B495, B483, B474, B479, B163, B128, B134, B20, B38, B742, B743, B716, B701, B692, B682, B676, B667, B673, B674, B714
- **#pond** — B707
- **#road** — B742, B719
- **#scheduler** — B495, B408, B255, B644
- **#selection** — B741, B742, B743, B740, B737, B682, B651
- **#site-planner** — B741, B739, B723, B724, B725, B691, B629, B553, B499, B484, B474, B479, B423, B406, B370, B309, B182, B183, B178, B177, B171, B163, B147, B115, B13, B131, B95, B744, B742, B743, B740, B738, B737, B719, B717, B715, B716, B707, B712, B703, B704, B705, B706, B695, B694, B693, B692, B684, B682, B651, B673, B674, B714
- **#stitching** — B413
- **#testing** — B269, B63, B743
- **#thoroughfare** — B720, B721, B722, B723, B724, B725, B726
- **#ui** — B741, B735, B723, B115, B744, B742, B740, B719, B734, B717, B712, B706, B695, B693, B669, B668, B658, B673, B674
- **#yield** — B724, B553, B715, B712, B651
