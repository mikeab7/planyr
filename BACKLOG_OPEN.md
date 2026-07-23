# BACKLOG_OPEN.md — open + verify index

> **Generated from `BACKLOG.md` by `scripts/build-backlog-index.mjs` — do NOT hand-edit.**
> One line per Open / Verify item so project-knowledge sync indexes the live open list and a
> chat session can see what's already filed without opening the 200 KB backlog. Regenerate it
> in the SAME commit as any `BACKLOG.md` edit; CI runs `--check` and fails the build on drift.
> _67 open · 110 awaiting live verification._

## 🔲 Open

| B# | Title | Module | Tags | Verify |
|---|---|---|---|---|
| B966 | `verify-pond-roles-ledger.mjs` harness drifted: its logged-out seed no longer triggers the detention/ledger-balancer render (17 stale assertions) | [Site Planner / tests] | #site-planner #testing #yield | sandbox |
| B954 | v3 post-ship audit: spec-violations + polish (PR-B) | [Site Planner / yield · pond] | #site-planner #yield #pond #ui | live |
| B950 | v3 post-ship audit: 5 critical Yield + Pond fixes (PR-A) | [Site Planner / yield · pond] | #site-planner #yield #pond #ui | live |
| B944 | v3 UI SPEC Part A: Yield panel redesign (PR 2) (×2) | [Site Planner / yield] | #site-planner #yield #ui | live |
| B943 | v3 UI SPEC Part B: Pond properties inspector redesign (PR 1) | [Site Planner / pond] | #site-planner #pond #ui #yield | live |
| B937 | Pond inspector: collapsed-group summaries were ellipsizing at panel width (B934 follow-up) | [Site Planner / yield · pond] | #site-planner #yield #pond #ui | sandbox |
| B936 | FINAL UI SPEC Part B: Yield-panel verdict strip + number format (PR 2) | [Site Planner / yield] | #site-planner #yield #ui | live |
| B934 | FINAL UI SPEC Part A: condensed Detention-Pond inspector (At-a-glance table + watch-out chips + four collapsed groups) | [Site Planner / yield · pond] | #site-planner #yield #pond #ui | live |
| B916 | Project sharing model: one grant per grantee, module-visibility mask, viewer-only v1 | [Backend / Sharing] | #infra #auth #persistence | — |
| B917 | Share entry points, unified project-level dialog, and read-only client (viewer) mode | [Global / UI] | #ui #infra #auth | — |
| B908 | Scheduler indent→outdent round-trip leaves the task's Start/Finish shifted by one business day | [Scheduler] | #scheduler | live |
| B906 | Floodplain-mitigation "anchored pond, WSE unknown" warning may not clear after a fresh Re-check (or may name a different pond) | [Site Planner / yield · floodplain] | #site-planner #yield #floodplain #pond | live |
| B818 | Meeting-cadence Gantt view + loud row-state banners (the visual half of NEW-3) | [Scheduler] | #scheduler #entitlements #gantt #export | live |
| B810 | Terrain honesty: provenance line + structure-masked flow arrows + canopy/vintage disclosure | [Site Planner / terrain · GIS] | #site-planner #gis #ui #export | live |
| B778 | Tighten the migrated `planar_*` tables off wide-open anon RLS | [Infra / Scheduler] | #infra #scheduler #auth | live |
| B776 | Special-district layers: ESD, TIRZ (+ audit LID/FWSD coverage of the TCEQ row) | [Site Planner / GIS] | #site-planner #gis | live |
| B777 | Subsidence district boundaries (HGSD + Fort Bend SD) | [Site Planner / GIS] | #site-planner #gis | live |
| B752 | Pipeline layer: crisp vector rendering + commodity styling + click-identify (replace raster at working zoom) | [Site Planner / GIS] | #site-planner #gis #export | live |
| B753 | Pipeline easement screening corridor (assumed buffer off centerline) | [Site Planner / GIS] | #site-planner #gis | live |
| B735 | AnchoredMenu portal + click-away backdrop can linger over the newly-active workspace when a menu is left open and the user navigates via browser Back/Forward | [App Shell / UI] | #ui #infra | live |
| B722 | Config-driven ingestion adapters: surrounding jurisdictions (Harris · Fort Bend · Pearland · Montgomery · H-GAC) | [Site Planner / GIS · ingestion] | #thoroughfare #gis | live |
| B723 | Map layer: "Thoroughfare Plan" overlay | [Site Planner / GIS · map layer] | #thoroughfare #gis #site-planner #ui | live |
| B724 | Parcel analysis: frontage detection + ROW-dedication estimate | [Site Planner / analysis] | #thoroughfare #site-planner #yield #gis | live |
| B725 | Auto-generated entitlement issues from thoroughfare-plan exposure | [Site Planner / entitlements] | #thoroughfare #entitlements #site-planner | live |
| B726 | Thoroughfare-plan versioning + data-freshness tracking | [Site Planner / GIS · data ops] | #thoroughfare #entitlements #gis #infra | live |
| B663 | ONE-TIME migration: every existing project gets the standard tree + existing files move into their tree folders in Drive | [Library / storage] | #library #drive | — |
| B662 | Unified Library: the folder tree IS the view, and files live inside it (+ the live-502 chunked Drive sync fix) | [Library / Doc Review / storage] | #library #drive #persistence | — |
| B650 | Per-project standard folder tree, user-editable in-app, with continuous one-way sync to Google Drive | [Doc Review / Library / storage · drive-integration / persistence] | — | — |
| B648 | Persistence & Sync epic: one umbrella + a canonical write-path doc | [Site Planner / Persistence] | #persistence | live |
| B629 | Drive-backed county PARCEL snapshot cache so outages stop breaking the map | [Site Planner / GIS] | #site-planner #gis #drive | — |
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
| B406 | Shared team workspaces: invite by email, share a project with a team | [Site Planner + Doc Review] | #site-planner #doc-review #infra | — |
| B370 | Migrate the remaining MAP-DISPLAY layer endpoints into the GIS source registry | [Site Planner / Platform] | #site-planner #gis | — |
| B364 | Enable the scanned / image-only + DWG reading path for the no-text-layer minority | [Doc Review] | #doc-review #filing | — |
| B309 | Retire client-side Mapillary token paths once the proxy lands | [Site Planner] | #site-planner #gis | — |
| B267 | Auto-calibrate a sheet from its stated scale callout | [Doc Review / Markup] | #doc-review #markup | — |
| B268 | Independent scale cross-check against on-sheet geometry (verify the stated scale) | [Doc Review / Markup] | #doc-review #markup | — |
| B269 | Remove the uploaded sample drawing PDFs from GitHub (test fixtures, not for `main`) | [Doc Review / repo hygiene] | #doc-review #testing | — |
| B273 | Filing-workflow practice: read a dropped file's title block → propose its project / discipline / sheet / date | [Doc Review / filing] | #doc-review #filing | — |
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
| B134 | Edits silently lost on reload; app loads a stale earlier state | [Persistence] | #persistence | — |
| B20 | `setProjectStatus` rewrites every plan in the group via `cloudUpsert` (strips inline underlay, heavy, clobber risk) | [Document Review] | #doc-review #persistence | — |
| B38 | SQL/RLS & data-integrity audit (mostly clean) | [Document Review / DB] | #doc-review #persistence | — |
| B63 | Parallel-session merge safety: branch → PR → green-build gate | [repo / workflow] | #infra #testing | — |
| B95 | Jurisdiction → development-consequence summary | [Site Planner / GIS] | #site-planner #gis | — |

## ⏳ Verify — awaiting live confirmation

| B# | Title | Module | Tags | Verify |
|---|---|---|---|---|
| B974 | Pond section geometry: correct berm slope, unambiguous depth dimension, no earthwork numbers on the drawing (PR-M) | [Site Planner / yield · pond] | #site-planner #yield #pond #ui | ⏳ live — awaiting |
| B973 | Rebuild the pond cross-section diagram: developer-readable section, no label collisions (PR-L) | [Site Planner / yield · pond] | #site-planner #yield #pond #ui | ⏳ live — awaiting |
| B972 | Floodway gate is over-classified and over-strict; three-tier 44 CFR 60.3 ladder + drainage-district GIS ingest (PR-K) | [Site Planner / yield · pond · floodplain] | #site-planner #yield #pond #floodplain #gis #ui | ⏳ live — awaiting |
| B971 | Rip out throat-widening: drive/road→court connection is a CONSTANT-WIDTH drive + two corner fillets (no funnel/wings/pinch/seam) | [Site Planner / drawing] | #site-planner #road #ui | ⏳ live — awaiting |
| B970 | "Engineering assumptions" section must start COLLAPSED on every load (PR-J, PR-I I2 follow-up) | [Site Planner / yield · pond] | #site-planner #yield #pond #ui | ⏳ live — awaiting |
| B969 | Pond panel: COMPUTE, don't interrogate (progressive disclosure + no blank engineering inputs) (PR-I) | [Site Planner / yield · pond] | #site-planner #yield #pond #ui | ⏳ live — awaiting |
| B968 | Wire the buildable envelope into the ACTUAL Optimize path + verdict (PR-H, live-path fix of B967) | [Site Planner / yield · pond] | #site-planner #yield #pond #floodplain #ui | ⏳ live — awaiting |
| B967 | Buildability GATES the verdict; Optimize never over-promises (PR-G) | [Site Planner / yield · pond] | #site-planner #yield #pond #floodplain #ui | ⏳ live — awaiting |
| B965 | Pond inspector residuals: status headline usable == the "Usable detention" row · em-dash sweep of the sizing assistant · non-monotonic peak solve applies (PR-F) | [Site Planner / yield · pond] | #site-planner #yield #pond #ui | ⏳ live — awaiting |
| B842 | Un-ghosted late `invalidateSize` on the Site map / MapFinder reveal (possible one-frame tile flash on map↔plan flip + workspace-tab return) | [Site Planner / Map] | #site-planner #ui #perf | ⏳ live — awaiting |
| B964 | Malformed curb-return geometry on the road/drive→truck-court connection (spiky/star apron + seam) | [Site Planner / drawing] | #site-planner #road #ui | ⏳ live — awaiting |
| B963 | Inward berm geometry (outer-toe model) + function-based pond label + computed berm cap (PR-D) | [Site Planner / yield · pond] | #site-planner #yield #pond #ui | ⏳ live — awaiting |
| B961 | Road connect engages at the target's OUTER CURB EDGE, not just the hidden centerline (NEW-3) | [Site Planner / drawing] | #site-planner #road #ui | ⏳ live — awaiting |
| B960 | Seamless road-to-road weld: no leftover seam/curb line across an end-to-end join (NEW-2) | [Site Planner / drawing] | #site-planner #road #ui | ⏳ live — awaiting |
| B959 | Truck-court connection: WB-62 driveway return (~50 ft, no compound curve) + NEVER pave over the building (NEW-1) | [Site Planner / drawing] | #site-planner #road #ui | ⏳ live — awaiting |
| B958 | v3 post-ship audit: Optimize created a 2nd pond + mitigation-card-at-0 + number/berm inconsistencies (PR-E) | [Site Planner / yield · pond] | #site-planner #yield #pond #ui | ⏳ live — awaiting |
| B957 | v3 post-ship audit: Optimize-applies bug fix + berm-height cap + FFE/gravity screening chips + on-plan berm ring (PR-C) | [Site Planner / yield · pond] | #site-planner #yield #pond #ui | ⏳ live — awaiting |
| B956 | Remember Layers-panel toggle state per site (restore enabled GIS overlays on load) | [Site Planner / Layers] | #site-planner #gis #persistence #ui | ⏳ live — awaiting |
| B955 | Connect roads to parking drives + truck-court drives (type-aware intersection) | [Site Planner / drawing] | #site-planner #road #ui | ⏳ live — awaiting |
| B953 | Clean T-intersection at a road tee: curb return radii + widened throat + merged pavement | [Site Planner / drawing] | #site-planner #road #ui | ⏳ live — awaiting |
| B951 | Element-label collision must also avoid parcel-area badges (B121 round 4) | [Site Planner / labels] | #site-planner #ui | ⏳ live — awaiting |
| B952 | Deleting a Library file leaves a stray map Reference; make the two features' independence clear | [Site Planner + Library / references] | #site-planner #library #files #ui | ⏳ live — awaiting |
| B947 | Callout border rounds into a bubble when zoomed out; render as a rectangle at every zoom | [Site Planner + Doc Review / Callouts] | #markup #site-planner #doc-review #ui | ⏳ live — awaiting |
| B948 | Callout double-click is now LOCATION-based: text area edits text, border opens Properties | [Site Planner + Doc Review / Callouts] | #markup #site-planner #doc-review #ui #selection | ⏳ live — awaiting |
| B945 | Snap-and-connect road endpoints (magnet + clean junction) | [Site Planner / drawing] | #site-planner #road #ui | ⏳ live — awaiting |
| B946 | Auto-fix sub-minimum road radius: fix, don't just warn | [Site Planner / drawing] | #site-planner #road #ui | ⏳ live — awaiting |
| B928 | Rail / menu / tool chrome audit-and-fix pass, both themes, screenshot-verified | [App-wide / UI] | #ui | ⏳ live — awaiting |
| B914 | Review resume leaks one project's last loose PDF (its "upload didn't finish" banner) onto every OTHER project's Review tab | [Doc Review] | #doc-review #persistence #ui | ⏳ live — awaiting |
| B918 | Callout text overflows its box in Document Review | [Doc Review] | #markup #doc-review | ⏳ live — awaiting |
| B919 | Add / remove leaders on a callout, Bluebeam-style | [Site Planner / Doc Review] | #markup #site-planner #doc-review | ⏳ live — awaiting |
| B911 | Parcel/edge dimension labels stay oversized on zoom-out (don't declutter or scale like building dims) | [Site Planner] | #site-planner #ui | ⏳ live — awaiting |
| B912 | Editable dimension length: single-click to select, double-click to edit the length inline | [Site Planner] | #site-planner #ui #selection | ⏳ live — awaiting |
| B913 | Resizable text boxes / callouts (horizontal width handles + text wrap) | [Site Planner] | #site-planner #ui #markup | ⏳ live — awaiting |
| B909 | Detention + mitigation: ONE unified one-click "⚡ Design pond" on the Yield panel (novice-proof) | [Site Planner / yield · pond] | #site-planner #yield #pond #ui | ⏳ live — awaiting |
| B907 | Civil-engineering roadmap #7: tie detention SIZING to LAND TAKE + EARTHWORK $ | [Site Planner / Pond] | #site-planner #pond | ⏳ live — awaiting |
| B905 | Civil-engineering upgrade #3: COMPUTED time of concentration (Kirpich), replacing the hard-coded 15-min screening assumption | [Site Planner / Pond] | #site-planner #pond | ⏳ live — awaiting |
| B904 | Civil-engineering upgrade #2 (STAGE 1 of 2): NRCS Type III design-storm hyetograph + Rational-vs-NRCS method-by-area guardrail | [Site Planner / Pond] | #site-planner #pond | ⏳ live — awaiting |
| B903 | Civil-engineering upgrade #1: MULTI-STAGE OUTLET + ALL-STORMS-AT-ONCE Post ≤ Pre (a single orifice could silently fail a storm it wasn't sized for) | [Site Planner / Pond] | #site-planner #pond #ui | ⏳ live — awaiting |
| B902 | Make pond detention design genuinely ONE-CLICK: AUTO-SUGGEST the allowable release (pre-development peak) so "Propose outlet" is never a dead greyed button | [Site Planner / Pond] | #site-planner #pond #ui | ⏳ live — awaiting |
| B901 | Pond outlet flow: "Allowable release (cfs)" could never be CLEARED (typing appended/stuck), and a removed outlet could resurrect on reload | [Site Planner / Pond] | #site-planner #pond #ui | ⏳ live — awaiting |
| B900 | Proposing a detention-pond outlet crashed the whole Site workspace: `ReferenceError: React is not defined`, and the crash PERSISTED across reload | [Site Planner / Pond] | #site-planner #pond #ui | ⏳ live — awaiting |
| B888 | Pond economics optimizer: ranked deeper-smaller vs shallower-bigger configurations (earthwork $ / land-take / buildable-SF) | [Site Planner] | #site-planner #yield #pond #grading | ⏳ live — awaiting |
| B885 | Deal screens: upstream/offsite drainage flag (3DEP flow-accumulation) + regional-detention/fee-in-lieu registry | [Site Planner] | #site-planner #yield #floodplain #gis | ⏳ live — awaiting |
| B884 | Public-data inputs for detention/pond screening: NOAA Atlas-14 rainfall + SSURGO soils + TWDB wells + subsidence districts + Curve-Number | [Site Planner] | #site-planner #yield #floodplain #pond #gis | ⏳ live — awaiting |
| B882 | Estimated BFE for FEMA Zone A / unstudied areas from FEMA InFRM EBFE + HCFCD MAAPnext (pluggable provider registry) + a "challenge the estimate" layer | [Site Planner / GIS · floodplain] | #site-planner #gis #floodplain #yield #ui | ⏳ live — awaiting |
| B883 | Detention outlet structure + release-rate proof (Post ≤ Pre routing) + cited jurisdiction criteria registry + NHD receiving-water | [Site Planner] | #site-planner #yield #floodplain #pond #gis | ⏳ live — awaiting |
| B880 | Setback offset line "messes up" on zoom-out: scale its dash + stroke with zoom and drop it when the inset goes sub-pixel | [Site Planner] | #site-planner #ui #selection | ⏳ live — awaiting |
| B879 | Header: drop the school district (ISD) from the jurisdiction badge + fix the Row-1 breadcrumb/badge overlap at narrow widths | [Site Planner] | #site-planner #ui #gis | ⏳ live — awaiting |
| B878 | Re-verify buildability-quiet-state (B868) + site-based-FFE (B869) AFTER B874 lands live — do NOT patch blind | [Site Planner] | #site-planner #yield #floodplain #testing | ⏳ live — awaiting |
| B868 | Buildability regression: outside-floodplain suppression lost, stale "SET BFE" chip, duplicate-basis copy | [Site Planner] | #site-planner #yield #floodplain #entitlements | ⏳ live — awaiting |
| B870 | Sizing-assistant suggestions become one-click applicable (apply-gated, preview, atomic undo — never silent auto) | [Site Planner] | #site-planner #yield #pond #floodplain | ⏳ live — awaiting |
| B871 | Berm materialization: an applied TOB raise becomes modeled dirt with full downstream propagation | [Site Planner] | #site-planner #yield #pond #floodplain #grading | ⏳ live — awaiting |
| B865 | Suppress password-manager autofill on inline grid editors | [Scheduler] | #scheduler #ui | ⏳ live — awaiting |
| B860 | Facts pass auto-recompute: kill the manual Re-check for stale math | [Site Planner / yield · GIS] | #site-planner #yield #gis #perf #persistence | ⏳ live — awaiting |
| B861 | BKDD: auto-detect the district boundary + transcribe its rate-control rule records | [Site Planner / stormwater · GIS] | #site-planner #floodplain #yield #gis | ⏳ live — awaiting |
| B862 | Yield readout overhaul: verdict-first hierarchy, required-vs-provided bars, caveat consolidation | [Site Planner / yield] | #site-planner #yield #ui #export #floodplain | ⏳ live — awaiting |
| B839 | Export aerial reuses cached basemap tiles instead of a slow on-demand render (fixes the timeout that blanked the PDF) | [Site Planner] | #site-planner #export #gis #perf #stitching | ⏳ live — awaiting |
| B840 | Interim: aerial-specific inline timeout + retry + Esri↔USGS source fallback on export | [Site Planner] | #site-planner #export #gis | ⏳ live — awaiting |
| B837 | Left-rail panel switch flashes the basemap and jumps the site sideways | [Site Planner / Map + UI] | #site-planner #ui #perf | ⏳ live — awaiting |
| B863 | One-time cascade-drift sweep over hs-v1 (677 tasks): every fossil surfaced for owner ruling, then repaired | [Scheduler / data] | #scheduler #persistence #testing | ⏳ live — awaiting |
| B864 | Scheduler meeting-body lost to a multi-writer clobber: bound tasks kept an ORPHANED meetingBodyId (election date at risk on reload) | [Scheduler / persistence] | #scheduler #persistence #infra | ⏳ live — awaiting |
| B836 | Cascade-drift guard on load: flag non-pinned tasks whose stored dates ≠ engine dates (LOUD-FAILURE) | [Scheduler] | #scheduler #testing #persistence | ⏳ live — awaiting |
| B832 | Drainage facts auto-revalidate; the ↻ button becomes an override, not a gate | [Site Planner / yield · GIS] | #site-planner #yield #gis #persistence #perf | ⏳ live — awaiting |
| B821 | Map flashes/blanks on single- & double-click: docked-panel resize → un-ghosted `setView` tile-wipe | [Site Planner / Map] | #site-planner #ui #perf | ⏳ live — awaiting |
| B691 | Fort Bend 1-ft contours layer dead: browser CORS-blocks `arcgisweb.fortbendcountytx.gov` — route it through the server-side GIS proxy (×2) | [Site Planner / GIS] | #site-planner #gis | ⏳ live — awaiting |
| B820 | Site Planner element/markup z-order "Arrange": Bring to Front / Forward / Send Backward / to Back via right-click + ⌘/Ctrl+]/[ chords, plus "Send behind buildings" for markups | [Site Planner / markup] | #site-planner #markup #selection #ui | ⏳ live — awaiting |
| B816 | Meeting-bound tasks: snap to cadence, auto-roll on miss, derived agenda deadline | [Scheduler] | #scheduler #entitlements #gantt #perf #export | ⏳ live — awaiting |
| B802 | 0.2% (500-yr) WSE: name the missing FIS input, label the Atlas-14 basis distinction, flag a below-1% derived value | [Site Planner / GIS · yield] | #site-planner #floodplain #yield #ui | ⏳ live — awaiting |
| B791 | File deletes bypass Drive trash: PERMANENT delete with no recovery window | [Doc Review / storage] | #doc-review #drive #persistence | ⏳ live — awaiting |
| B792 | Review delete-safety: same-name re-upload cross-wires two reviews; delete permanently destroys the markup layer; a network blip renders an empty Library | [Doc Review / Library] | #doc-review #library #persistence #drive #files | ⏳ live — awaiting |
| B793 | Planner: an edit whose cloud commit failed is silently reverted by the reload refetch | [Site Planner / Persistence] | #site-planner #persistence | ⏳ live — awaiting |
| B789 | Per-source `timeoutMs` override in the GIS screening-fetch registry (FEMA flood answered at ~9.5 s, past the 9 s default) | [Site Planner / GIS] | #site-planner #gis #floodplain | ⏳ live — awaiting |
| B787 | Re-point Chambers County parcels at CCAD's own live public service (ChambersCADPublic) | [Site Planner / GIS] | #site-planner #gis | ⏳ live — awaiting |
| B784 | Site-plan overlay stuck on "Loading drawing…" forever when its Storage object is missing | [Site Planner / overlay] | #site-planner #persistence #files | ⏳ live — awaiting |
| B785 | Overlay keeps a dead `storageKey`; the download layer couldn't tell "file gone" from "network blip" | [Site Planner / overlay] | #site-planner #persistence #files | ⏳ live — awaiting |
| B786 | `doc-review-files` bucket allowed only `application/pdf`, so image/CAD overlays silently failed to back up | [Site Planner / storage config] | #site-planner #persistence #files #infra | ⏳ live — awaiting |
| B812 | The single-tab false "another window" toast BURST on a building resize (survived B759×2 + B811) — own-echo-by-rev | [Site Planner / persistence] | #site-planner #persistence #infra | ⏳ live — awaiting |
| B811 | A resized building's bonded sidewalk / paving "separates" (snaps back) when a stale refetch re-seeds the shadow | [Site Planner / persistence] | #site-planner #persistence #infra | ⏳ live — awaiting |
| B759 | False "someone else edited this in another tab" pop-up while actively editing in ONE tab (×2) | [Site Planner / persistence] | #site-planner #persistence #infra | ⏳ live — awaiting |
| B757 | Deliberately-deleted PLAN can resurrect on reload/sign-in when its cloud delete never landed (offline / transient) — no DURABLE record-delete tombstone | [Site Planner / Persistence] | #site-planner #persistence | ⏳ live — awaiting |
| B756 | DATA LOSS: a new signed-in site created from the map ("Plan N parcels →") silently loses ALL its parcels | [Site Planner / persistence] | #site-planner #persistence #infra | ⏳ live — awaiting |
| B625 | Metes-and-bounds deed rotates grossly off-angle on "Align to county parcel" (×2) | [Site Planner] | #site-planner #coordinates #gis | ⏳ live — awaiting |
| B751 | Detention: make the HCFCD-channel-drainage + reviewing-agency assumptions transparent AND user-overridable, and remember the last drainage check | [Site Planner / GIS · yield] | #site-planner #gis #yield #persistence | ⏳ live — awaiting |
| B747 | Overlay tool accepts CAD files: client-side DXF import with true-units auto-scale | [Site Planner] | #site-planner #files | ⏳ live — awaiting |
| B748 | Wire DWG into the overlay via the B238 conversion service (gated live, never a dead end) | [Site Planner / server] | #site-planner #files #infra | ⏳ live — awaiting |
| B745 | Vector / thin-line GIS map layers (transmission, road-authority, county/city/ETJ boundaries, contours, drainage arrows, OSM/Mapillary) now composite into the PDF/PNG export | [Site Planner / GIS · export] | #site-planner #export #gis | ⏳ live — awaiting |
| B746 | Ctrl+Z doesn't always work; make it Bluebeam-style when drawing an element | [Site Planner / Doc Review] | #site-planner #doc-review #selection #markup #ui #persistence | ⏳ live — awaiting |
| B742 | Delete on a road silently no-ops for many clicks, then suddenly works | [Site Planner] | #site-planner #road #selection #persistence #ui | ⏳ live — awaiting |
| B743 | Harden the shared element-delete path so no element type can silently no-op | [Site Planner] | #site-planner #selection #persistence #testing | ⏳ live — awaiting |
| B738 | Satellite/aerial basemap missing from PDF/PNG export (plan prints on a blank white background) | [Site Planner] | #site-planner #export #gis | ⏳ live — awaiting |
| B737 | Unify the ParcelDrawing overlay onto the shared per-object style model (fill/weight/dash/opacity + capability-driven panel) | [Site Planner / Markup] | #site-planner #markup #selection | ⏳ live — awaiting |
| B716 | Clean up phantom drawn parcels on the Martini site (`smqsfzqc72pw`): soft-deleted 2 attr-less outlines + 1 degenerate dup sliver → ~88.6 ac | [Site Planner / data] | #site-planner #persistence | ⏳ live — awaiting |
| B707 | Floodplain mitigation engine: rules matrix + elevation-based compensating-storage volume | [Site Planner / Stormwater] | #site-planner #gis #pond | ⏳ live — awaiting |
| B712 | Floodplain surfacing & integration: mitigation/buildability card, combined detention readout, inputs, cost lines, print | [Site Planner] | #site-planner #ui #yield #export #gis | ⏳ live — awaiting |
| B699 | Whole content pane is the drop target; drag-onto-folder files into it; ONE empty state; folder drops preserve your subfolder structure | [Library / storage] | #library #files #filing #drive | ⏳ live — awaiting |
| B701 | Honest Drive-sync footer: backend-driven resting status, "Synced · N min ago", loud failure | [Library / storage] | #library #drive #persistence | ⏳ live — awaiting |
| B692 | ROOT-CAUSE fix for the B690 husk-parcel crash: sanitize the model funnel so a null/points-less entry can never be manufactured, persisted, or re-ingested | [Site Planner / model] | #site-planner #persistence | ⏳ live — awaiting |
| B684 | Export to Google Earth (KMZ) via right-click, in both the map viewer and the canvas | [Site Planner / Map] | #site-planner #export #coordinates | ⏳ live — awaiting |
| B682 | Dragging a parcel's acreage label spawns a "bunch of copies" (id-less parcels + value-based union merge) | [Site Planner] | #site-planner #persistence #selection | ⏳ live — awaiting |
| B675 | Planyr MCP connector: read-only `/api/mcp/<token>` endpoint gives Claude live cross-project context | [functions/api/mcp] | #infra #files | ⏳ live — awaiting |
| B676 | Library pins follow the ACCOUNT (Supabase cloud sync) instead of per-device | [Library] | #library #persistence #auth | ⏳ live — awaiting |
| B669 | Keep-alive module switching: visited workspaces stay mounted (hidden), switching is instant | [Shell / all modules] | #ui #perf #infra | ⏳ live — awaiting |
| B668 | Library Home: pinned folders/files + recent drawings + project cards | [Library] | #library #ui #files | ⏳ live — awaiting |
| B667 | Review remembers the last document PER PROJECT (+ the resume self-clobber fix) | [Doc Review] | #doc-review #persistence | ⏳ live — awaiting |
| B664 | Drag a whole FOLDER onto the Library and it auto-files every PDF inside it | [Library / storage] | #library #files #filing | ⏳ live — awaiting |
| B651 | Parcel split double-counts acreage; make split REPLACE the parent (parent + children can never both be active) | [Site Planner] | #site-planner #yield #selection | ⏳ live — awaiting |
| B659 | Sheet reader + file organizer revamp: rotated/offset pages, set-aware titles, left-edge & vertical title blocks, title-first grouping, date-first names | [Doc Review / Library] | #doc-review #library #files #filing | ⏳ live — awaiting |
| B673 | Element-level sync, phase 4/5: loud-conflict surface + delete/edit matrix | [Site Planner] | #site-planner #ui #persistence | ⏳ live — awaiting |
| B674 | Element-level sync, phase 5/5: remove the edit lock — multi-writer cutover + presence pill | [Site Planner / Shell] | #site-planner #ui #persistence | ⏳ live — awaiting |
| B714 | Sharing a project silently REVERTS: any ordinary save from the owner's open tab overwrote `sites.team_id` back to null, locking the collaborator out | [Site Planner / Review / teams · RLS] | #site-planner #persistence #auth | ⏳ live — awaiting |

## By tag

- **#auth** — B916, B917, B778, B483, B676, B714
- **#compare** — B471
- **#coordinates** — B625, B684
- **#doc-review** — B484, B471, B423, B422, B413, B411, B406, B364, B267, B268, B269, B273, B180, B181, B183, B20, B38, B947, B948, B914, B918, B919, B791, B792, B746, B667, B659
- **#drive** — B663, B662, B629, B791, B792, B699, B701
- **#entitlements** — B818, B725, B726, B868, B816
- **#export** — B818, B810, B752, B862, B839, B840, B816, B745, B738, B712, B684
- **#files** — B180, B181, B182, B183, B952, B792, B784, B785, B786, B747, B748, B699, B675, B668, B664, B659
- **#filing** — B411, B364, B273, B699, B664, B659
- **#floodplain** — B906, B972, B968, B967, B885, B884, B882, B883, B878, B868, B870, B871, B861, B862, B802, B789
- **#gantt** — B818, B816
- **#gis** — B810, B776, B777, B752, B753, B722, B723, B724, B726, B629, B370, B309, B178, B171, B147, B13, B95, B972, B956, B885, B884, B882, B883, B879, B860, B861, B839, B840, B832, B691, B789, B787, B625, B751, B745, B738, B707, B712
- **#grading** — B888, B871
- **#infra** — B916, B917, B778, B735, B726, B406, B179, B63, B864, B786, B812, B811, B759, B756, B748, B675, B669
- **#library** — B663, B662, B952, B792, B699, B701, B676, B668, B664, B659
- **#markup** — B423, B422, B267, B268, B947, B948, B918, B919, B913, B820, B746, B737
- **#perf** — B495, B484, B479, B842, B860, B839, B837, B832, B821, B816, B669
- **#persistence** — B916, B662, B648, B499, B495, B483, B474, B479, B163, B128, B134, B20, B38, B956, B914, B860, B863, B864, B836, B832, B791, B792, B793, B784, B785, B786, B812, B811, B759, B757, B756, B751, B746, B742, B743, B716, B701, B692, B682, B676, B667, B673, B674, B714
- **#pond** — B954, B950, B943, B937, B934, B906, B974, B973, B972, B970, B969, B968, B967, B965, B963, B958, B957, B909, B907, B905, B904, B903, B902, B901, B900, B888, B884, B883, B870, B871, B707
- **#road** — B971, B964, B961, B960, B959, B955, B953, B945, B946, B742
- **#scheduler** — B908, B818, B778, B495, B865, B863, B864, B836, B816
- **#selection** — B948, B912, B880, B820, B746, B742, B743, B737, B682, B651
- **#site-planner** — B966, B954, B950, B944, B943, B937, B936, B934, B906, B810, B776, B777, B752, B753, B723, B724, B725, B629, B499, B484, B474, B479, B423, B406, B370, B309, B182, B183, B178, B177, B171, B163, B147, B115, B13, B95, B974, B973, B972, B971, B970, B969, B968, B967, B965, B842, B964, B963, B961, B960, B959, B958, B957, B956, B955, B953, B951, B952, B947, B948, B945, B946, B919, B911, B912, B913, B909, B907, B905, B904, B903, B902, B901, B900, B888, B885, B884, B882, B883, B880, B879, B878, B868, B870, B871, B860, B861, B862, B839, B840, B837, B832, B821, B691, B820, B802, B793, B789, B787, B784, B785, B786, B812, B811, B759, B757, B756, B625, B751, B747, B748, B745, B746, B742, B743, B738, B737, B716, B707, B712, B692, B684, B682, B651, B673, B674, B714
- **#stitching** — B413, B839
- **#testing** — B966, B269, B63, B878, B863, B836, B743
- **#thoroughfare** — B722, B723, B724, B725, B726
- **#ui** — B954, B950, B944, B943, B937, B936, B934, B917, B810, B735, B723, B115, B974, B973, B972, B971, B970, B969, B968, B967, B965, B842, B964, B963, B961, B960, B959, B958, B957, B956, B955, B953, B951, B952, B947, B948, B945, B946, B928, B914, B911, B912, B913, B909, B903, B902, B901, B900, B882, B880, B879, B865, B862, B837, B821, B820, B802, B746, B742, B712, B669, B668, B673, B674
- **#yield** — B966, B954, B950, B944, B943, B937, B936, B934, B906, B724, B974, B973, B972, B970, B969, B968, B967, B965, B963, B958, B957, B909, B888, B885, B884, B882, B883, B878, B868, B870, B871, B860, B861, B862, B832, B802, B751, B712, B651
