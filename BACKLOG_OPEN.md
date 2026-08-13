# BACKLOG_OPEN.md — open + verify index

> **Generated from `BACKLOG.md` by `scripts/build-backlog-index.mjs` — do NOT hand-edit.**
> One line per Open / Verify item so project-knowledge sync indexes the live open list and a
> chat session can see what's already filed without opening the 200 KB backlog. Regenerate it
> in the SAME commit as any `BACKLOG.md` edit; CI runs `--check` and fails the build on drift.
> _181 open · 407 awaiting live verification._

## 🔲 Open

| B# | Title | Module | Tags | Verify |
|---|---|---|---|---|
| B434416 | A text box had no SELECTED state at all, so "click it and press Delete" could not work | [Notes] | #notes #ui | live |
| B434417 | Resizing a box never saved: the gesture committed the width the box already had, while rendering the one you dragged to | [Notes] | #notes #ui #persistence | live |
| B434418 | Every affordance appeared on hover | [Notes] | #notes #ui | sandbox |
| B421488 | A box's delete button was visible, correctly labelled, and impossible to click | [Notes] | #notes #ui | sandbox |
| B421489 | Deleting a box could not be undone | [Notes] | #notes #ui | sandbox |
| B421490 (×3) | A box could hang off the page, where its controls were unreachable | [Notes] | #notes #ui | sandbox |
| B421491 | "Edited 2 Jul 2025 ago" | [Notes] | #notes #ui | sandbox |
| B421492 | Opening History crushed the page to a sliver | [Notes] | #notes #ui | sandbox |
| B421493 | A re-file into another project did not travel between computers | [Notes] | #notes #sync | live |
| B421494 | Marquee-select several boxes and move them together | [Notes] | #notes #ui | sandbox |
| B435538 | A write must say WHO did it and WHAT OPERATION it was part of | [Site Planner / data] | #site-planner #persistence #infra | live |
| B420257 | "create hit a live row (should be impossible)" fired twice in 36 hours, and it is NOT the duplicate-id collision | [Site Planner] | #site-planner #sync #persistence | live |
| B400176 | A renamed note left the sidebar until a reload, because the stored tree lagged the screen by 400 ms | [Notes] | #notes #sync #persistence | live |
| B400177 | The box width handle resized against a STALE left edge, so resizing a box you had moved gave the wrong width | [Notes] | #notes #ui | sandbox |
| B393171 | `main`'s four-metric bundle drift: attributed, and STOPPED at the third ratchet by the item's own rule | [Infra / CI · perf] | #infra #perf | sandbox |
| B393173 | The Anthropic SDK ships 144 KB to the browser for one API call, with the user's key in the page | [Site Planner / build · security] | #infra #perf #files | sandbox |
| B367298 | The header's centre zone cannot hold the longest jurisdiction labels, so the tail ellipsises below ~1100 px | [Site Planner / UI] | #site-planner #ui | sandbox |
| B342996 (×2) | A device whose tree is 98 revisions STALE is also flagged dirty, so a merge lets it overwrite newer titles | [Notes] | #notes #sync | live |
| B329408 | `main`'s required build is RED on the performance budget, and it has been for at least three commits | [Infra / CI · perf] | #infra #perf #testing | sandbox |
| B298759 | Version history is DEVICE-LOCAL, so losing the machine loses the history | [Notes] | #notes #persistence #sync | sandbox |
| B296224 | EVERY PR APPENDS TO THE SAME FIVE LEDGER FILES, so a PR that sits for an hour conflicts BY CONSTRUCTION — with zero source conflicts | [Infra / CI] | #infra #testing | sandbox |
| B295168 | The site-route chunk guard snapshots AFTER its own gesture, so it reports input-driven chunks as boot-path ones | [Infra / Testing] | #infra #testing #perf | sandbox |
| B287058 | `SitePlanner.jsx` is 27,146 lines with 206 `useState` in ONE component: extraction by STATE OWNERSHIP | [Site Planner] | #site-planner #perf #infra | sandbox |
| B287059 | The clipper-lib polygon offsetting that sized 55,631 ms of a 55,760 ms gesture runs on the MAIN THREAD | [Site Planner] | #site-planner #perf #pond | live |
| B297909 | The Site route's largest chunk is ~30 KB into a 32 KB band, and the measured payback is the References panel | [Site Planner / perf] | #site-planner #perf | sandbox |
| B290245 | The Colorado CAPABILITY GUARD has no production call site: eight declared gaps render nothing | [Site Planner / Colorado] | #site-planner #gis #entitlements | sandbox |
| B290246 | Colorado's statewide FFE floor (CWCB 2 CCR 408-1) is carried as a record and applied to nothing | [Site Planner / floodplain] | #site-planner #floodplain #entitlements | live |
| B290247 | Site Analysis distances on a Colorado site are over-reported by 1.93% — the Texas projection measures them | [Site Planner / coordinates] | #site-planner #coordinates #gis | live |
| B290248 | Colorado water law is absent from every surface: a permanent-pool pond can be drawn with no warning | [Site Planner / pond] | #site-planner #pond #entitlements #floodplain | sandbox |
| B290249 | `drawdownHours` returns 0 for a zero volume, contradicting its own stated contract | [Site Planner / pond] | #site-planner #pond #yield | sandbox |
| B290250 | Nothing tells a Colorado user whether a distance is GRID or GROUND, and `scaleFactor.js` has no consumer | [Site Planner / coordinates] | #site-planner #coordinates | sandbox |
| B280402 | The parcel acreage badge is armed by the cursor merely RESTING on it, so it takes press 2 of a double-click | [Site Planner / selection] | #site-planner #selection #ui #parcel | live |
| B280403 | The instrument that answers "why did it fail on HIS machine" could not be armed on his machine | [Infra / Testing] | #infra #testing | sandbox |
| B286001 | Mid-gesture, line weights and text do NOT counter-scale: deliberate, deferred, and filed so closing B1449 cannot bury it | [Site Planner / UI] | #site-planner #perf #ui | live |
| B280400 | The stub's double-click works ONCE: a second one on the same feature fails back to the pre-fix signature | [Site Planner / selection] | #site-planner #selection #ui #road | live |
| B280401 | Harness rule: a probe that observes the middle of a gesture has changed the gesture | [Infra / Testing] | #infra #testing | sandbox |
| B278576 | A road stub 6×12 px across will not open Properties: press 2 addressed a DIFFERENT road, because the feature is SMALLER THAN ITS OWN CHROME | [Site Planner / selection] | #site-planner #selection #ui #road | live |
| B278577 | The min-radius review flag's corner dot is WIDER THAN A SHORT ROAD, ate the press, and re-cut the alignment on a double-click | [Site Planner / roads] | #site-planner #selection #ui #road | sandbox |
| B267536 | The pond outlet + detention family: 20 e2e cases per lane, red for 18 days, and NOT ONE of them was an engineering defect | [Site Planner / Infra] | #site-planner #yield #testing #infra | live |
| B267537 | The drift gate's own fixture pinned two rows of a ledger designed to shrink, so the guard fails the first time the ledger does its job | [Infra / CI] | #infra #testing | sandbox |
| B267538 | A full `local` sweep in a dev sandbox reports SEVEN "NEW REGRESSIONS" that are nothing of the kind, and the ledger has no record of which machine it was calibrated on | [Infra / CI] | #infra #testing | live |
| B267539 | A guard that measures a DURATION fails on healthy code: the pond per-vertex bound sampled each arm once, in the millisecond band where noise lives | [Site Planner / Infra] | #testing #perf #infra #site-planner | sandbox |
| B266081 | 29 + 32 e2e cases are red and now have an owner, a lane and a line in the repo | [Infra / CI] | #infra #testing #site-planner #yield | live |
| B255200 | The app records ITSELF now: an always-on performance recorder with a self-calibrating trigger and an owner-reported button | [Platform / Infra] | #perf #infra #site-planner #testing #persistence | live |
| B251136 | The one cost path never measured: a PDF-backed sheet overlay re-renders its whole page at 8192 px on ZOOM, and every wheel notch in the band paid for a new one | [Site Planner / Infra] | #site-planner #perf #infra #testing | sandbox |
| B251137 | The fix: a re-raster ladder plus a per-rung cache, so crossing the zoom gate costs one page render instead of one per wheel notch — and zooming back in costs none | [Site Planner] | #site-planner #perf | live |
| B242544 | The Layers panel could not scroll: a percentage max-height resolved to `none`, so the card grew past the map and the list below the fold was unreachable | [Site Planner / UI] | #site-planner #ui #gis | sandbox |
| B242545 | Colorado's oil & gas layer: the authoritative ECMC endpoint is IDENTIFIED but unreachable from here, so the slot stays a named gap rather than a guess | [Site Planner / GIS] | #gis #site-planner | — |
| B1422 (×2) | Colorado was a Texas registry with Colorado sites pointed at it: 38 of 43 sources returned zero | [Site Analysis / GIS] | #gis #site-planner #coordinates | — |
| B233152 | The double-click audit certified a pond NOBODY COULD CLICK: three independent holes, each of which alone makes the suite green over a dead feature | [Site Planner / Infra] | #site-planner #testing #infra #selection | — |
| B227888 | The pond result, split: is it pond COUNT or ring COMPLEXITY? | [Site Planner / Infra] | #site-planner #perf #infra #testing | live |
| B227476 | The Quiddity plan, landed: the SLOW half of the owner's own A/B | [Site Planner / Infra] | #site-planner #perf #infra #testing | sandbox |
| B227477 | The A/B, run: the slow plan is ELEVEN TIMES the main-thread work of the fast one | [Site Planner / Infra] | #site-planner #perf #infra #testing | live |
| B227478 | The raster hypothesis for Bain, retired by IDENTITY rather than by statistics | [Site Planner / Infra] | #site-planner #perf #infra | sandbox |
| B227479 | "Too many elements" is refuted by the owner's own pair, and it is 270× off | [Site Planner / Infra] | #site-planner #perf #infra #ui | sandbox |
| B227472 | The real Bain and Sylvestri plans, landed from Supabase — and the synthesised stand-in deleted | [Site Planner / Infra] | #site-planner #perf #infra #testing | sandbox |
| B227473 | The overlay's 1.5° rotation costs about half of what having the overlay at all costs | [Site Planner / Infra] | #site-planner #perf #infra #testing | live |
| B227474 | The first plan with annotations anybody has ever measured — and the tier costs real render work | [Site Planner / Infra] | #site-planner #perf #infra #testing #ui | live |
| B227475 | What the real censuses do to the 304-layer question: the compositor layer count is not a function of the scene | [Site Planner / Infra] | #site-planner #perf #infra | sandbox |
| B221760 | "Add one detention pond and it lags": measured, attributed, and the leading hypothesis killed | [Site Planner / Infra] | #site-planner #perf #pond #infra #testing | live |
| B221761 | A pond's label re-solved its fit against the pond's interior on every frame of every pan | [Site Planner / UI] | #site-planner #perf #pond #ui | live |
| B217537 | The enumerated violations, fixed in measured priority order | [Site Planner] | #site-planner #perf #road #pond | live |
| B217540 | Dragging ONE building re-migrates and re-serialises the ENTIRE plan, dozens of times | [Site Planner / Persistence] | #site-planner #perf #persistence | sandbox |
| B217541 | The coordinate readout is frozen through a wheel zoom | [Site Planner] | #site-planner #ui #coordinates | sandbox |
| B209568 | Nobody had ever measured Bain: a fixture that CONTAINS the suspect, and the raster hypothesis killed with a number | [Site Planner / Infra] | #site-planner #perf #infra #testing | live |
| B209569 | Every plan he actually works in can be measured now, permanently — not just the one that happened to be committed | [Site Planner / Infra] | #site-planner #perf #infra #testing | live |
| B209570 | What Bain actually is, next to what we have been measuring all along | [Site Planner / Infra] | #site-planner #perf #infra | sandbox |
| B6864 | Seven PRs, none mergeable, nothing red: the required check was a livelock between a ratchet and a 30-minute lag | [Infra / CI] | #infra #testing | live |
| B6865 | A required status check that can never report is a repo-wide outage that looks like nothing is wrong — so assert the contract in the build | [Infra / CI] | #infra #testing | sandbox |
| B6866 | Reserved B#/V# blocks per session: no allocator, no high-water mark, and a test that two concurrent allocations cannot overlap | [Infra / CI] | #infra #testing | sandbox |
| B6867 | Unblock the seven PRs without bypassing anything | [Infra / CI] | #infra #testing | live |
| B1448 | The 2.2-second post-draw tail, attributed: it is 453 ms, more than half of it idle, and the number it was named after measured something else | [Infra / Testing] | #infra #testing #perf #site-planner | live |
| B1440 | The export builds its own view at export time, so a pan can be ONE transform instead of 1,200 re-emitted nodes | [Site Planner / UI] | #site-planner #perf #ui #export | live |
| B1441 | The pixel bar is now about what the owner can SEE, not about whether the file changed | [Infra / Testing] | #infra #testing #perf #ui | sandbox |
| B1442 | The flood/drainage check is manual only, and its freshness is a light | [Site Planner / Yield] | #site-planner #yield #floodplain #perf #ui | live |
| B1443 | WHAT IS STILL BLOCKING US: every render constraint scored REAL / TEST-DEBT / OWNER-SETTABLE, and the render-architecture call taken | [Site Planner / Infra] | #site-planner #perf #infra #testing #ui | sandbox |
| B1350 (×3) | The dock-door leaves: 424 nodes that cannot be collapsed, and NOT for the reason first recorded | [Site Planner / UI] | #site-planner #perf #ui | sandbox |
| B1435 | Every browser-performance design principle, scored against this code, with a ranked table | [Site Planner / Infra] | #site-planner #perf #ui #infra #testing | live |
| B1436 | A SESSION-SHAPED probe: the axes B1432 deliberately froze, and the instrument fixed so the floor stops blocking the answer | [Site Planner / Infra] | #site-planner #perf #infra #testing | live |
| B1437 | The column grid and dock doors were re-solved for every building on every frame of every pan | [Site Planner / UI] | #site-planner #perf #ui | live |
| B1438 | The app measures its own SPEED in production now, so this is never a guess again | [Site Planner / Shell] | #infra #perf #site-planner #ui | live |
| B1432 | The interaction-count axis, MEASURED: the same gesture after 1,000 gestures costs what it cost at zero | [Site Planner / Infra] | #site-planner #perf #infra #testing #gis | live |
| B1433 | Think outside the JS profile: the compositor/raster hypothesis, TESTED rather than deferred — and it comes back clean | [Site Planner / Map] | #site-planner #perf #gis #infra | live |
| B1434 | No mechanism named, so no fix shipped: the shape and size of what is actually left | [Site Planner / Map] | #site-planner #perf #gis | sandbox |
| B1121 (×3) | Map memory accumulates over a session until the site lags; a hard reload only helps briefly | [Site Planner / Map] | #site-planner #perf #gis | live |
| B1431 | The four seconds nobody could account for, ATTRIBUTED: a boot timeline with named phases | [Infra / Testing] | #infra #testing #perf #site-planner | sandbox |
| B1385 | The landing page's coverage claim undersold the product four to one, and it advertised a module that does not exist | [Landing / marketing] | #ui | sandbox |
| B1382 | A road tee could not be SLID along its host: the connect path re-welded it to the control point it was already on | [Site Planner / roadGeometry] | #site-planner #road #ui | — |
| B1383 | The tee position IS the road's bearing, and nothing showed him what that bearing was | [Site Planner / roadGeometry · UI] | #site-planner #road #ui | — |
| B1359 | The drawing↔basemap registration layout effect is the largest named item in a zoom frame | [Site Planner / UI] | #site-planner #perf #ui | live |
| B1360 | The wheel zoom cannot reach 30 fps without taking the VIEW out of every coordinate | [Site Planner / UI] | #site-planner #perf #ui | live |
| B1349 | Five lazily-split chunks are pulled at BOOT anyway, on an idle page with no gesture | [Infra / Build] | #infra #perf #gis #site-planner | sandbox |
| B1351 | Hoist the inspector panel's 1,084 JSX tags out of the canvas component behind memoised children | [Site Planner / UI] | #site-planner #perf #ui | live |
| B1353 | Move `detentionRules` / `floodplainMitigation` / `mhfdDetention` behind a Web Worker | [Site Planner / Pond] | #site-planner #perf #pond #floodplain | live |
| B1341 | One assembly, one revision: make a partial apply unrepresentable in the DATABASE, not only in the client | [Site Planner / Persistence] | #site-planner #persistence #sync #infra | live |
| B1318 | Link a note to a site, a plan element, or a Library file | [Notes] | #notes #library #site-planner | live |
| B1208 | Lift the handle layer above the GIS line band, together with its pointer plumbing | [Site Planner / UI] | #site-planner #ui #selection #gis | live |
| B1163 | `perf-harness.mjs`'s `siteRouteChunks` check can never pass as written: it compares FETCHED chunks against a STATIC allowlist | [Infra / Testing] | #testing #infra #perf | sandbox |
| B1126 | "Computed but never RENDERED" is a class, and the ratchet only catches half of it: the unmounted-JSX half has no guard | [Site Planner / Yield] | #ui #yield #testing | sandbox |
| B1106 | Ground vs grid: a real project-coordinate transform (combined factor + project origin on the site model) | [Platform / geo] | #coordinates | sandbox |
| B1064 | Finish the SitePlannerApp split: extract SitePlanner's panels into lazily-loaded child components (the remaining ~750 KB that dynamic imports provably cannot move) | [Infra / Build] | #infra #perf #site-planner | live |
| B1063 | The reference scenario now issues 513 aerial tile requests where the committed floor was 182 — a 2.8× jump that landed with the map-side perf merge, not with any bundle work | [Site Planner / map] | #site-planner #perf #gis | live |
| B998 | NEW-28: consolidate ALL flood information into ONE "Flood" panel (FEMA zones + floodway + governing WSEs + check state/vintage + governing district + downstream implications) | [Site Planner / yield · floodplain] | #site-planner #yield #floodplain #ui | live |
| B1000 | BKDD outfall/gravity feasibility should use the 25-YR receiving WSE, not the 100-yr (§5.D.2/§5.D.3) | [Site Planner / stormwater · pond] | #site-planner #yield #pond #floodplain | live |
| B1001 | BKDD floodplain fill: compensating storage must band against the 500-YR too, not just the 100-yr (Art VI §1.B) | [Site Planner / stormwater · floodplain] | #site-planner #yield #pond #floodplain | live |
| B1002 | BKDD maintenance-berm land-take should use the depth+slope Table C, not a flat width (§5.B.2 Table C / §5.B.3 Table D) | [Site Planner / stormwater · pond] | #site-planner #yield #pond | sandbox |
| B1003 | BKDD emergency spillway: warn when a pond lacks a spillway allowance; model it (§5.B.4.e/§5.B.5.d/§5.B.7.d) | [Site Planner / stormwater · pond] | #site-planner #yield #pond | sandbox |
| B1004 | BKDD pumped-discharge FORMULAS + TxDOT-ditch 75% auto-switch (§5.B.7.a/§5.B.7.b) | [Site Planner / stormwater · pond] | #site-planner #yield #pond | sandbox |
| B993 | Right-size an OVERSIZED pond: the optimizer only closes shortfalls, never proposes SHRINKING a pond to give land/dirt back | [Site Planner / stormwater · pond] | #site-planner #yield #pond | — |
| B994 | NEW-24: Buildability strip reads "not checked yet" on a fresh load of an already-checked plan, until a manual ↻ (though flood data is fresh) | [Site Planner / yield · persistence] | #site-planner #yield #floodplain #persistence | live |
| B995 | NEW-25: the Optimize card's pond-section band label reads "mitigation 63.9 ac-ft" while the CREDITED mitigation is 0.0 (berm-sealed) — a contradicting pair | [Site Planner / pond · ui] | #site-planner #yield #pond #ui | live |
| B986 | Criteria registry (R-PRINCIPLE): every detention/mitigation criteria value carries jurisdiction + citation + VERIFIED/ASSUMED, researched per-jurisdiction (folds R2/R3/R5/R7) | [Site Planner / stormwater · floodplain] | #site-planner #yield #pond #floodplain | live |
| B985 | NEW-20: Re-check gives no feedback; first-load of a drawn plan should auto-check; pond callout too bulky | [Site Planner / yield · ui] | #site-planner #yield #ui | — |
| B988 | REMAINING criteria-truth critique items (backlog per R-PRINCIPLE: implement what the governing code requires, cited; flag assumptions; no generic best-practice as a site rule) | [Site Planner / stormwater · floodplain] | #site-planner #yield #pond #floodplain | — |
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
| B484 | Renderer freezes (~30 s main-thread stalls): PDF title-block reading, heavy map/parcel ops, and panel/rail scrolling (×3) | [Doc Review + Site Planner / perf] | #doc-review #site-planner #perf | live |
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
| B443248 | A successor of a SUMMARY row was scheduled off the summary's collapsed START, not its real FINISH | [Schedule] | #scheduler #gantt | ⏳ live — awaiting |
| B443249 | A predecessor that drives NOTHING looked identical to one that does | [Schedule] | #scheduler #ui | ⏳ live — awaiting |
| B443250 | A pinned start that beats its predecessor chain won silently | [Schedule] | #scheduler #ui | ⏳ live — awaiting |
| B447472 | `assembly_digest()` had no kind predicate, so the two sides of the group revision digested DIFFERENT MEMBER SETS | [Site Planner / Persistence] | #site-planner #persistence #sync #infra | ⏳ live — awaiting |
| B442688 | The View menu toggled ORNAMENT when what he reaches for is hiding a CLASS of content | [Site Planner / UI] | #site-planner #ui | ⏳ live — awaiting |
| B435536 | An easement's label rendered at a fixed screen size, so it dwarfed the easement it named | [Site Planner] | #site-planner #ui #markup | ⏳ live — awaiting |
| B435537 | Baytown's flood ordinance, transcribed: the higher of the 500-year and BFE + 24 in | [Site Planner / drainage] | #site-planner #floodplain #gis | ⏳ live — awaiting |
| B420256 | One id can name TWO live rows, and the commit results were keyed by id alone | [Site Planner] | #site-planner #sync #persistence | ⏳ live — awaiting |
| B407328 | The screening hydrology engine rode the boot path of every page load | [Site Planner / perf] | #site-planner #perf #floodplain | ⏳ live — awaiting |
| B393168 | `BT_City_Limit` is THREE jurisdiction classes in one layer; only `FEATURE='CITY'` is full purpose | [Site Planner / GIS] | #site-planner #gis | ⏳ live — awaiting |
| B393169 | A jurisdiction share must be an AREA fraction on the real ring, at stated tolerance, with the polygon class named | [Site Planner / GIS] | #site-planner #gis #testing | ⏳ live — awaiting |
| B393170 | Grand Port read "unincorporated, no ETJ" and is neither; Goose Creek's split is asserted by area | [Site Planner / GIS] | #site-planner #gis #testing | ⏳ live — awaiting |
| B393172 | A plain selection click pushed an undo entry that changed nothing | [Site Planner] | #site-planner #selection #ui | ⏳ live — awaiting |
| B391072 (×3) | A purged note reappeared in the LIVE list hours later, because rule 0 was CONDITIONAL | [Notes] | #notes #sync #persistence | ⏳ live — awaiting |
| B391077 | Marquee-select several boxes and move them together | [Notes] | #notes #ui | ⏳ live — awaiting |
| B391078 | Sweep the whole Notes module rather than following his reports | [Notes / Testing] | #notes #testing | ⏳ live — awaiting |
| B385040 | Every Ctrl+Z tore down and re-added the whole GIS layer stack | [Site Planner / Layers] | #site-planner #gis #ui #perf | ⏳ live — awaiting |
| B385041 | A building's dock walls moved because you resized it | [Site Planner / dockZones] | #site-planner #ui | ⏳ live — awaiting |
| B385042 | The plan switcher stated the current plan's name three times | [Site Planner / UI] | #site-planner #ui | ⏳ live — awaiting |
| B384064 | The header centre slot was centred on the LEFTOVER space, not on the header | [Site Planner / Shell] | #site-planner #ui | ⏳ live — awaiting |
| B377891 | Stop telling the owner his teammate deleted his work when it was his own second tab | [Site Planner / UI] | #site-planner #ui #auth #sync | ⏳ live — awaiting |
| B371360 | The +/− zoom gate is STILL too late, and the third value is OWNER-SET plus a viewport term | [Site Planner / UI] | #site-planner #ui #selection | ⏳ live — awaiting |
| B371361 | The jurisdiction pill covered the plan switcher at laptop width and ate its caret | [Site Planner / Shell] | #site-planner #ui | ⏳ live — awaiting |
| B366384 | Sharing an ALREADY-SHARED project reported "this project isn't in the cloud yet" — a row COUNT read as EXISTENCE | [Site Planner / teams] | #site-planner #auth #sync | ⏳ live — awaiting |
| B366385 | The sharing pointer never SURVIVED a pull, so every "is this shared?" indicator was blank at once | [Site Planner / teams] | #site-planner #auth #sync #persistence | ⏳ live — awaiting |
| B366386 | Sharing a MULTI-PLAN project keyed on the drifting `group_id` COLUMN — the rename bug's shape, still latent | [Site Planner / teams] | #site-planner #auth #sync | ⏳ live — awaiting |
| B366387 | The project switcher carried a second "All projects" button inches from the first | [Shared UI] | #ui | ⏳ live — awaiting |
| B366388 | The switcher's second rename, and the hover-gated kebab that made removing it unsafe | [Shared UI] | #ui #testing | ⏳ live — awaiting |
| B366389 (×2) | The Rename/Delete glyphs were a text pencil beside a colour emoji, and the sweep that followed | [Shared UI] | #ui | ⏳ live — awaiting |
| B367296 | The jurisdiction badge joins a GOVERNING authority and a merely-adjacent city with the same separator | [Site Planner] | #site-planner #gis #floodplain #ui | ⏳ live — awaiting |
| B367297 | The floodplain administrator's city was recovered by PARSING the jurisdiction badge | [Site Planner] | #site-planner #floodplain #gis | ⏳ live — awaiting |
| B369536 | The retention policy has never DELETED anything, and until 2026-09-18 that is indistinguishable from a DELETE that matches nothing | [Platform / Infra] | #infra #persistence #testing | ⏳ live — awaiting |
| B364016 (×2) | Delete forever STILL did not stick, and now the purged note came back into the LIVE list | [Notes] | #notes #sync #persistence | ⏳ live — awaiting |
| B357011 | EMPTYING THE BIN DID NOT STICK: a stale window resurrected every purged entry and pushed it to the cloud | [Notes] | #notes #sync #persistence | ⏳ live — awaiting |
| B350000 | Everything right of about the three-quarter mark was CLAMPED to the right margin, and the clamped number was written to storage | [Notes] | #notes #ui #export | ⏳ live — awaiting |
| B350002 | The bin cannot be judged: 21 entries, 16 of them "Untitled page", and no way to see what one was without restoring it | [Notes] | #notes #ui | ⏳ live — awaiting |
| B350003 | The duplicate banner reported a finding nobody could act on: a copy in the bin, in a project that was already deleted | [Notes] | #notes #ui | ⏳ live — awaiting |
| B342992 | A real note is unreachable: a body with no tree node, in local AND cloud | [Notes] | #notes #sync #persistence | ⏳ live — awaiting |
| B335985 | The Google Earth export emitted one placemark per dock door, and inherited a canvas display toggle to decide | [Site Planner / export] | #site-planner #export #ui | ⏳ live — awaiting |
| B326416 | New projects are born shared with your team (site plans only), and NOTHING that already exists changes | [Site Planner / teams · RLS] | #site-planner #auth #persistence #infra | ⏳ live — awaiting |
| B326417 | A shared plan the owner wants left alone: the per-plan view-only lock | [Site Planner / teams · RLS] | #site-planner #auth #ui | ⏳ live — awaiting |
| B326418 | The switch: turn the shared default off, in Team settings, in one click | [Site Planner / teams · UI] | #site-planner #ui #auth | ⏳ live — awaiting |
| B326419 | An existing project can never become shared by any ordinary write path — deny-by-default in Postgres | [Site Planner / teams · RLS] | #auth #infra #persistence #testing | ⏳ live — awaiting |
| B323424 | A zoom-gated layer that is ON but not drawing looks identical to one that is broken | [Site Planner / Layers] | #gis #site-planner #ui | ⏳ live — awaiting |
| B323425 | Contours paint, then disappear about two seconds after load | [Site Planner / Layers] | #gis #site-planner #perf | ⏳ live — awaiting |
| B312545 | Settings had no information architecture: change password was the front door | [Platform / UI] | #ui #auth | ⏳ live — awaiting |
| B286000 (×2) | The smooth-zoom toggle is an INTERFACE preference, and neither the plan menu nor the View menu is where one belongs | [Site Planner / UI] | #site-planner #ui #perf | ⏳ live — awaiting |
| B315712 | A synced note can be written into a different project than the one it belongs to | [Notes] | #notes #sync #persistence | ⏳ live — awaiting |
| B315716 | A note whose tree node is lost is swept off the device on every load and re-downloaded on every sync, reachable from nowhere | [Notes] | #notes #persistence #sync | ⏳ live — awaiting |
| B316864 | The owner ANSWERED the type-layer question: the default stays absolute, and one explicit action can force an element across it | [Site Planner / elements] | #site-planner #ui #selection #export #persistence | ⏳ live — awaiting |
| B316865 | A right-click was swallowed by hover-armed parcel chrome, so right-clicking his pond opened the PARCEL menu — with "Delete parcel" in it | [Site Planner / selection] | #site-planner #ui #selection | ⏳ live — awaiting |
| B304177 | Every clipboard and plan-integrity harness counted the wrong thing: | [data-el-id] | #infra #testing #selection #site-planner | ⏳ live — awaiting |
| B298756 | Notes took pictures and nothing else; a PDF, an XLSX or a DWG could not be attached | [Notes] | #notes #files #persistence #export | ⏳ live — awaiting |
| B298758 | A note had no way to say "this bit matters", and no way to fold a section away | [Notes] | #notes #ui #export | ⏳ live — awaiting |
| B298560 | The bare-earth elevation transect is re-fetched from USGS on every check, for a byte-identical query, at 1 to 7.7 seconds a time | [Site Planner / Yield] | #site-planner #yield #floodplain #perf #gis | ⏳ live — awaiting |
| B298561 | The panel waits 1 to 7.7 seconds on the elevation call for answers that landed in 145 ms | [Site Planner / Yield] | #site-planner #yield #floodplain #perf #ui | ⏳ live — awaiting |
| B298562 | A third-party call with no latency budget and no loud state | [Site Planner / Yield] | #site-planner #yield #floodplain #gis #ui | ⏳ live — awaiting |
| B298563 | The check's own cost is invisible to the production recorder | [Platform / Infra] | #perf #infra #site-planner #yield #testing | ⏳ live — awaiting |
| B298401 | The flood layer can draw from a baked per-county archive instead of calling FEMA on every pan | [Site Planner / GIS] | #gis #floodplain #perf #site-planner | ⏳ live — awaiting |
| B286309 | An unsettled FFE must render as the fallback authority, never as a blank | [Site Planner] | #floodplain #yield | ⏳ live — awaiting |
| B291536 | Backspace at the start of a LIST ITEM restructured a whole region in one press | [Notes] | #notes #ui | ⏳ live — awaiting |
| B286308 | TxGIO and the City of Baytown DISAGREE about whether Grand Port is inside the city | [Site Planner] | #gis #site-planner #floodplain | ⏳ live — awaiting |
| B286304 | Wire Baytown's own boundary layers, and stop trusting one ETJ aggregator | [Site Planner] | #gis #site-planner #floodplain | ⏳ live — awaiting |
| B286305 | Baytown could never govern the floodplain, and NOTHING said so | [Site Planner] | #floodplain #yield #gis | ⏳ live — awaiting |
| B286306 | Add the City of Katy's own ETJ layer | [Site Planner] | #gis #site-planner | ⏳ live — awaiting |
| B286307 | Evaluate BaytownParcels as a parcel source for Baytown-area sites | [Site Planner] | #gis #site-planner | ⏳ live — awaiting |
| B287056 | The chunk-load recovery decides between THREE outcomes and records NONE of them | [App Shell / Infra] | #infra #testing | ⏳ live — awaiting |
| B287057 | Every perf report must name its ROUTE and its PHASE, because the worst blocks are in a lane nobody had attributed | [Infra / Telemetry] | #infra #perf #testing | ⏳ live — awaiting |
| B287060 | One dead chunk became two hours of telemetry: the terrain lazy-loader retried on EVERY pointer move | [Site Planner / Infra] | #site-planner #infra #perf #testing | ⏳ live — awaiting |
| B297904 | A plan started without the map could NEVER be georeferenced, so a boundary drawn during a county outage was stranded in blank space forever | [Site Planner / coordinates] | #site-planner #coordinates #gis | ⏳ live — awaiting |
| B297905 | A plotted deed could not become the parcel, so with the county map down the best boundary in hand was stuck as a markup | [Site Planner / parcel] | #site-planner #parcel #gis | ⏳ live — awaiting |
| B297906 | A hand-drawn parcel had geometry and nothing else, and a county-pulled one could not be corrected | [Site Planner / parcel] | #site-planner #parcel #ui | ⏳ live — awaiting |
| B297907 | A county outage produced a banner and nothing else, leaving the owner on a map that would not give him a lot | [Site Planner / MapFinder] | #site-planner #gis #ui | ⏳ live — awaiting |
| B297908 | The acreage badge sits at the parcel's dead centre — measured against B280402/B280403, and NOT a defect | [Site Planner / parcel] | #site-planner #selection #parcel | ⏳ live — awaiting |
| B290240 | Unincorporated land was told "Texas counties have no zoning" in every state, including Colorado | [Site Planner / entitlements] | #site-planner #entitlements #gis | ⏳ live — awaiting |
| B290243 | The Colorado 72-hour drawdown statute returned a soft pass on a plan with no pond at all | [Site Planner / pond] | #site-planner #pond #floodplain | ⏳ live — awaiting |
| B295008 | A click that drifts a pixel MOVES the element — up to a couple of feet once the flush-snap catches a neighbour | [Site Planner / interaction] | #site-planner #selection #ui | ⏳ live — awaiting |
| B295009 | Every plain click on an element burns an undo frame, so Ctrl+Z "does nothing" several times in a row | [Site Planner / interaction] | #site-planner #selection #ui | ⏳ live — awaiting |
| B280704 | A city-limit STRADDLE must be stated with its share, and the remainder named | [Site Planner] | #gis #site-planner #floodplain | ⏳ live — awaiting |
| B280705 | The "regional" ETJ layer carries 34 cities, and the app read every other city's ETJ as "no ETJ" | [Site Planner] | #gis #site-planner #floodplain | ⏳ live — awaiting |
| B280706 | Jurisdiction varies WITHIN a site, and every number downstream assumes it cannot | [Site Planner] | #floodplain #yield #site-planner | ⏳ live — awaiting |
| B280707 | Per-parcel floodplain rules: make the yield ledger able to hold more than one jurisdiction | [Site Planner / yield · floodplain] | #site-planner #yield #floodplain | ⏳ live — awaiting |
| B276576 | The app booted behind a render-blocking Google Fonts stylesheet; the landing page's fix was never carried across | [Infra / UI] | #infra #ui #perf #testing | ⏳ live — awaiting |
| B276752 | Containment is a WHOLE-SITE question, and the badge was asking one lot | [Site Planner] | #gis #site-planner #floodplain | ⏳ live — awaiting |
| B276753 | An unresolved jurisdiction must be first-class END TO END, not just in the badge | [Site Planner] | #floodplain #gis #yield | ⏳ live — awaiting |
| B276754 | A regression fixture per jurisdiction SHAPE, driving the WHOLE chain | [Site Planner] | #testing #gis #site-planner | ⏳ live — awaiting |
| B276755 | The identify query 404s past a URL ceiling, and a 404 reads as "nothing here" | [Site Planner] | #gis #site-planner #floodplain | ⏳ live — awaiting |
| B276448 | The one genuine cross-lane e2e failure was a spec B50010 had deliberately obsoleted the day before | [Site Planner / Canvas] | #testing #infra #site-planner | ⏳ live — awaiting |
| B276449 | A flood spec was the last caller pinned to the pre-B1236 FEMA wording | [Site Planner / Flood] | #testing #floodplain #site-planner | ⏳ live — awaiting |
| B276450 | The contour hover's worst-case ceiling was never well-posed: replaced with the invariant it was reaching for, not loosened | [Site Planner / Terrain] | #testing #grading #site-planner | ⏳ live — awaiting |
| B270912 | The recorder was drowning its own signal: 89% of production telemetry came from automated runs | [Platform / Infra] | #perf #infra #testing | ⏳ live — awaiting |
| B265536 | The recorder's production path, PROVEN — and the telemetry sink that swallowed every write failure | [Platform / Infra] | #perf #infra #testing #persistence | ⏳ live — awaiting |
| B221763 | The pond LEDGER is rebuilt in the render body, per pond, ~127 times a pan gesture | [Site Planner / UI] | #site-planner #perf #pond #yield #ui | ⏳ live — awaiting |
| B236592 | A static pond re-derived its whole stage-storage model 156 times per pond per pan | [Site Planner / UI] | #site-planner #perf #pond #yield #ui | ⏳ live — awaiting |
| B230080 | The canvas clipboard is destroyed by a plan switch, so nothing could be copied between plans of one site | [Site Planner / UI] | #site-planner #selection #ui #coordinates | ⏳ live — awaiting |
| B779 | Concurrent-mint B#/V# collisions: catch loudly at PR time + prevent by late-binding (×3) | [repo / tooling · workflow] | #infra | ⏳ live — awaiting |
| B50008 | A double-click opens Properties for nothing on a busy plan: the reconstructed double-tap is budgeted on a WALL CLOCK | [Site Planner / UI] | #site-planner #selection #ui #perf | ⏳ live — awaiting |
| B50009 | The native double-click fallback is dead for every feature: the first press re-renders the node, so the event retargets to the bare `<svg>` | [Site Planner / UI] | #site-planner #selection #ui | ⏳ live — awaiting |
| B209506 | An edge-only sliver must never be the headline jurisdiction | [Site Planner] | #gis #site-planner #floodplain | ⏳ live — awaiting |
| B209507 | A failed lookup must never render as an absence | [Site Planner] | #gis #site-planner #floodplain | ⏳ live — awaiting |
| B209508 | The floodplain administrator must refuse to settle on an incomplete jurisdiction | [Site Planner] | #floodplain #gis #yield | ⏳ live — awaiting |
| B209502 | Route a point to its county by GEOMETRY, never by bounding box | [Site Planner] | #gis #site-planner | ⏳ live — awaiting |
| B209503 | The Houston metro is nine counties; the registry had four | [Site Planner] | #gis #site-planner | ⏳ live — awaiting |
| B209504 | Five layers reported dead across six industrial sites: what is actually true | [Site Planner] | #gis #site-planner | ⏳ live — awaiting |
| B208960 | Stitch: clicking a sheet row does nothing, silently, because a saved-set load holds a gate with no progress and no failure surface | [Doc Review / stitching] | #doc-review #stitching #ui | ⏳ live — awaiting |
| B208961 | Stitch: "Rendering…" never clears — a fixed string, for the whole of a load, over an empty canvas | [Doc Review / stitching] | #doc-review #stitching #ui | ⏳ live — awaiting |
| B208962 | The Review URL lands in a full-screen room with no doors: no logo, no breadcrumb, no module tabs | [Doc Review / stitching] | #doc-review #stitching #ui | ⏳ live — awaiting |
| B208965 | The "Opening A227…" toast never dismisses — and the sheet under it stays dimmed | [Doc Review] | #doc-review #ui | ⏳ live — awaiting |
| B208966 | No visible zoom control in Review: it is in the DOM, several hundred pixels below the fold of the rail's own scroll | [Doc Review] | #doc-review #ui | ⏳ live — awaiting |
| B1392 (×2) | Tab was defined in SOME contexts, not ALL — "the tab doesn't always work correctly" | [Notes / editor] | #notes #ui | ⏳ live — awaiting |
| B36052 | A peer branch holding your number is an ADVISORY, not a build failure | [Infra / tooling] | #infra #testing | ⏳ live — awaiting |
| B36050 | Remove the Recent view; the rail is Pages and Bin | [Notes / UI] | #notes #ui | ⏳ live — awaiting |
| B36051 | Paste, properly: Word's three modes, its icons, and the Outlook signature that broke a real note | [Notes / editor] | #notes #ui | ⏳ live — awaiting |
| B1393 (×2) | "i still cant double click and type SOMEWHERE" — CLICK AND TYPE, Word's, because focus is not placement — and the single-click claim was checked before it was believed | [Notes] | #notes #ui | ⏳ live — awaiting |
| B1427 | A re-fetchable cache was crowding the owner's saved work out of a 5 MB store | [Site Planner / storage] | #persistence #gis #site-planner #perf | ⏳ live — awaiting |
| B1428 | The "Retry device save" button could not succeed | [Site Planner / storage] | #persistence #ui #site-planner | ⏳ live — awaiting |
| B1429 | Neither store reported its size, so this failure was invisible until it was a banner | [Site Planner / Shell / storage] | #persistence #infra #ui | ⏳ live — awaiting |
| B1421 | Two "production" flood layers were dead at every point, and the weekly drift job could not see them | [Site Analysis / GIS] | #gis #floodplain #testing #infra | ⏳ live — awaiting |
| B1423 | The Layers panel and the map chrome were fighting, and the chrome was winning | [Site Planner / UI] | #site-planner #ui #gis | ⏳ live — awaiting |
| B1424 | Ten layers on and the plan was the least legible thing on the screen | [Site Planner / UI] | #site-planner #ui #gis | ⏳ live — awaiting |
| B1425 | A reload lost the project, and a hash edit left the old project on screen under the new URL | [Site Planner / routing] | #site-planner #ui #auth | ⏳ live — awaiting |
| B1420 | Collapse the Notes hierarchy: THE PROJECT IS THE NOTEBOOK, and a page can hold pages | [Notes / model · UI] | #notes #ui #persistence #sync | ⏳ live — awaiting |
| B482 (×2) | A signed-in user's PROJECT LIST is empty on any route that never mounts the Site Planner, and every project name in that session is wrong | [Cross-module / projects] | #ui #sync #auth #notes | ⏳ live — awaiting |
| B1419 | The Notes rail captioned a FAILED LOOKUP as if it were the owner's data | [Notes / UI] | #notes #ui | ⏳ live — awaiting |
| B1414 | The right rail's Parcel flyout carried three of the eleven parcel actions, and "Parcel" named two different things on opposite sides of the screen | [Site Planner / parcel · UI] | #site-planner #ui #selection | ⏳ live — awaiting |
| B1415 | A project's name had no single home: it was copied onto every plan, and nothing kept the copies in agreement | [Site Planner / persistence] | #site-planner #persistence #sync | ⏳ live — awaiting |
| B1416 | A rename only reached the plans this browser happened to have cached, and said nothing when it didn't | [Site Planner / persistence] | #site-planner #persistence #sync | ⏳ live — awaiting |
| B1417 | Repair the project already split by this bug, and keep it repaired | [Site Planner / persistence] | #site-planner #persistence #sync | ⏳ live — awaiting |
| B1418 | Let a project be renamed where the owner actually looks for it | [Site Planner / UI] | #site-planner #ui | ⏳ live — awaiting |
| B1401 | Larimer County rode the whole-state composite: 1.5 s per view, a truncated draw, and a false "server is slow" banner | [Site Planner / MapFinder · GIS] | #site-planner #gis #perf | ⏳ live — awaiting |
| B1402 | One URL carried two health policies, and the same endpoint was added to the map twice | [Site Planner / MapFinder · GIS] | #site-planner #gis #perf | ⏳ live — awaiting |
| B1403 | A truncated parcel draw looked exactly like a complete one | [Site Planner / MapFinder · GIS] | #site-planner #gis | ⏳ live — awaiting |
| B1404 | The parcel acreage chip could not be deleted, and its drag was behind a gate that could only be opened from behind itself | [Site Planner / UI] | #site-planner #ui #selection | ⏳ live — awaiting |
| B1405 | Right-click a road end, get a real roundabout | [Site Planner / roadGeometry] | #site-planner #road #ui | ⏳ live — awaiting |
| B1400 | Sketch mode (×2): REBUILT the authoring surface — double-click anywhere, type in the box, drag an arrow | [Notes / sketch] | #notes #ui #export | ⏳ live — awaiting |
| B1391 | A FALSE CONFLICT: one person, one account, two windows — and the app said someone else was editing his note | [Notes / sync] | #notes #sync #persistence | ⏳ live — awaiting |
| B1384 | The landing page rendered with NO VISIBLE TEXT: every word was gated on a vendor animation library | [Landing / marketing] | #ui | ⏳ live — awaiting |
| B1377 | One-time repair: re-tag the orphaned pieces and restore the sidewalks they cost | [Site Planner / siteModel] | #site-planner #persistence | ⏳ live — awaiting |
| B1374 | Notes were not where the project was: a notebook's project binding existed, was never surfaced, and could never be changed | [Notes] | #notes #ui #persistence #sync | ⏳ live — awaiting |
| B1373 | A machine left open across a deploy serves a STALE BUILD and silently hides whole modules | [Infra / App shell] | #infra #ui #testing | ⏳ live — awaiting |
| B1352 | Convert `renderElPx` from a module-level function to a `React.memo` component | [Site Planner / UI] | #site-planner #perf #ui | ⏳ live — awaiting |
| B1356 | Shrinking the trailer parking pulled it in from BOTH ends: the model stored a SPAN with no ANCHOR | [Site Planner / dockZones] | #site-planner #ui | ⏳ live — awaiting |
| B1355 | Measurements print as giant dots with no number, because the export inherits the screen's zoom level-of-detail | [Site Planner / export] | #site-planner #export #ui #markup | ⏳ live — awaiting |
| B1344 | The perf harness cannot reproduce the owner's slowness: the benchmark that certifies the render path never runs it | [Infra / Testing] | #infra #testing #perf #site-planner | ⏳ live — awaiting |
| B1345 | Stall striping has no geometry level-of-detail: 1,550 DOM nodes finer than one pixel | [Site Planner / UI] | #site-planner #perf #ui | ⏳ live — awaiting |
| B1346 | REFUTED: a pan does NOT commit two full renders per frame | [Site Planner / UI] | #site-planner #perf #ui #testing | ⏳ live — awaiting |
| B1342 | Every Gantt task name renders ABOVE its bar; the on-bar centred label is removed | [Scheduler / Gantt] | #scheduler #gantt #export #ui | ⏳ live — awaiting |
| B1343 | Jumping into Schedule inside a project landed on the dashboard: the route carried the project, the Scheduler ignored it | [Cross-module / navigation] | #scheduler #ui #sync | ⏳ live — awaiting |
| B1340 (×2) | The bonded-assembly tear, at the root: a bonded child's FULL GEOMETRY — position AND span — is DERIVED | [Site Planner / Persistence] | #site-planner #persistence #sync | ⏳ live — awaiting |
| B1327 | Double-clicking a building does not open Properties: the parcel acreage badge eats the press | [Site Planner] | #site-planner #selection #ui | ⏳ live — awaiting |
| B1328 | A measurement can be layered: send it behind the plan, order it against its peers | [Site Planner] | #site-planner #ui #markup #export | ⏳ live — awaiting |
| B1329 | Zoom is slow: the wheel was the one uncoalesced gesture, and every view change rendered twice | [Site Planner] | #site-planner #perf #ui | ⏳ live — awaiting |
| B1330 | Four render-cost wins with provably complete inputs, plus the last unbounded cache | [Site Planner] | #site-planner #perf | ⏳ live — awaiting |
| B1331 | The 278 MB tab: instrument the two retention suspects, cap only what the number justifies | [perf / memory] | #perf #site-planner | ⏳ live — awaiting |
| B1291 | Notes belong in the cloud: the tree, the bodies AND the pictures sync to Supabase | [Notes / sync] | #notes #sync #persistence #auth | ⏳ live — awaiting |
| B1314 | A note could not be printed or turned into a PDF | [Notes] | #notes #export | ⏳ live — awaiting |
| B1254 | Per-layer "Show above plan": opacity was never the escape hatch, and could not have been | [Site Planner / layers panel] | #site-planner #gis #ui | ⏳ live — awaiting |
| B1253 | The map's landing view was hardcoded to Houston for EVERY account — it is now derived from the user's own sites | [Site Planner / MapFinder] | #site-planner #ui #gis | ⏳ live — awaiting |
| B1235 | Shaded and unshaded Zone X were collapsed into one answer, and the 500-year fill trigger missed 54,000 real polygons | [Site Planner / flood] | #site-planner #gis #floodplain #yield | ⏳ live — awaiting |
| B1236 | "Flood Hazard Zones: 08069c_2802 / Type: X" over an empty map: a correct answer in its most confusing possible form | [Site Planner / flood] | #site-planner #gis #floodplain #ui | ⏳ live — awaiting |
| B1237 | Which county's FIRM answered was never said, and a county-line site can be covered by two | [Site Planner / flood] | #site-planner #gis #floodplain | ⏳ live — awaiting |
| B1239 | "Not available in Colorado yet" reads as "this app has nothing for you here" | [Standards / detention] | #site-planner #yield #entitlements | ⏳ live — awaiting |
| B1241 | "No data" must never look like "no floodplain" — the third state | [Site Planner / flood] | #site-planner #gis #floodplain #ui | ⏳ live — awaiting |
| B1214 | The user can now OVERRIDE which boundary is Front, Side, Street side and Rear | [Site Planner / parcel] | #site-planner #ui | ⏳ live — awaiting |
| B1205 | GIS layers draw UNDER the site elements, so contours placed under a building disappear — one fixed semantic stacking order for the whole map | [Site Planner / layers] | #site-planner #gis #ui | ⏳ live — awaiting |
| B1206 | Per-layer opacity is the one escape hatch in the fixed stacking model, so every toggleable GIS layer must expose it in the same place | [Site Planner / layers panel] | #site-planner #gis #ui | ⏳ live — awaiting |
| B1207 | "Is my building in the floodplain?" is a computation, not a picture — answer it as a number in the Yield panel | [Site Planner / Analysis · yield] | #site-planner #floodplain #yield | ⏳ live — awaiting |
| B1189 | The planner CRASHES to the error boundary when Escape follows the Properties rail click within ~200 ms (runaway render loop) | [Site Planner / UI] | #site-planner #ui #perf | ⏳ live — awaiting |
| B1190 | Document Review's markup inspector still derives its visibility from the selection (the B1188 defect, other workspace) | [Doc Review / Markup] | #doc-review #markup #selection #ui | ⏳ live — awaiting |
| B1204 | The setback chip RE-COUPLED to the setback line's colour: white plate, green border, green text | [Site Planner / parcel] | #site-planner #ui | ⏳ live — awaiting |
| B1197 | A resize handle that falls under the parcel line is drawn behind it AND cannot be grabbed, so the object can't be resized from that corner | [Site Planner / references · UI] | #site-planner #ui #selection | ⏳ live — awaiting |
| B1198 | References had no way to be brought in front of the plan at all | [Site Planner / references] | #site-planner #ui #persistence | ⏳ live — awaiting |
| B1191 | The PARCELS panel still spoke in fifteen geometric SIDES, not the four setbacks a zoning ordinance writes | [Site Planner / parcel · UI] | #site-planner #ui | ⏳ live — awaiting |
| B1192 | Default parcel + setback colour: indigo → the property-line green #34E802, with a casing so it survives green ground | [Site Planner / parcel · design] | #site-planner #ui | ⏳ live — awaiting |
| B216 (×2) | Harden edge-run setbacks for IRREGULAR parcels: concave inward placement + gentle-curve grouping — and now TIGHT-curve chip grouping | [Site Planner] | #site-planner #ui | ⏳ live — awaiting |
| B1184 | The PARCELS panel listed "Edge 18, Edge 19 … Edge 32" — thirty-odd identical 25′ inputs for one boundary | [Site Planner / parcel] | #site-planner #ui | ⏳ live — awaiting |
| B1185 | Every parcel vertex drew a large blue handle, so a digitized curve became a chain of overlapping squares that hid the geometry | [Site Planner / parcel] | #site-planner #ui #selection | ⏳ live — awaiting |
| B1186 | The parcel acreage badge floated off the parcel, labelling the neighbour's land | [Site Planner / parcel] | #site-planner #ui | ⏳ live — awaiting |
| B1187 | Parcel + setback default to indigo, and the setback chip's border and numerals go black | [Site Planner / parcel · design] | #site-planner #ui | ⏳ live — awaiting |
| B1173 (×2) | Fullscreen dropped both header rows, so switching project or plan meant leaving it | [Shell / UI] | #ui #site-planner #doc-review | ⏳ live — awaiting |
| B1175 | A plain click on the canvas jumps the map a full panel width | [Site Planner] | #site-planner #ui #selection | ⏳ live — awaiting |
| B1156 | `f` now goes to REAL fullscreen, not just a hidden header | [Shell / UI] | #ui #site-planner | ⏳ live — awaiting |
| B1157 | Dragging a polygon vertex lagged: every pointer move re-ran a 13,700-line render body | [Site Planner] | #site-planner #perf | ⏳ live — awaiting |
| B1158 | The yield/drainage derivation ran on every render even with no panel open | [Site Planner / Yield] | #yield #perf #site-planner | ⏳ live — awaiting |
| B1160 | No canvas backing store was ever released, anywhere in the tree | [Platform / perf] | #perf #infra #doc-review #site-planner | ⏳ live — awaiting |
| B1161 | MapFinder keeps a second Leaflet map that never got the B1121 tile cap | [Site Planner / map] | #perf #gis #site-planner | ⏳ live — awaiting |
| B1162 | Two GIS caches grew without bound, and one could never evict its biggest entries | [Site Planner / GIS] | #perf #gis #site-planner | ⏳ live — awaiting |
| B1155 | Where a road SPLITS on a curve the branch never resolved into one surface: the outline stepped and one armpit got NO curb return at all | [Site Planner / roadGeometry] | #site-planner #road #ui | ⏳ live — awaiting |
| B1152 | You can pin the zoom at which a measurement's label appears, per measurement and as a project default | [Site Planner / measure] | #site-planner #ui #markup | ⏳ live — awaiting |
| B1153 | A measurement's numbers are redrawn as a proper drawing annotation: one headline value, a subordinate detail line, a real chip, and per-edge dimensions | [Site Planner / measure] | #site-planner #ui #markup #export | ⏳ live — awaiting |
| B1141 | Screen→ground transform sat ~1 CSS px off the imagery; hover and click now ride ONE welded transform | [Site Planner / GIS] | #site-planner #gis #coordinates | ⏳ live — awaiting |
| B1142 | The basemap re-centre never watched its own container, so the aerial could sit TENS of pixels off the drawing | [Site Planner / Map] | #site-planner #gis #coordinates | ⏳ live — awaiting |
| B1131 | Hovering an electric line, substation or pipeline must say what it is | [Site Planner / layers] | #site-planner #gis #ui | ⏳ live — awaiting |
| B1132 | State and country outlines on the zoomed-out map | [Site Planner / map] | #site-planner #ui #gis #perf | ⏳ live — awaiting |
| B1105 | Colorado detention sizing: a new `ruleType` + calculator per regime (MHFD WQCV+EURV, then Larimer / Weld / El Paso) | [Standards / detention] | #yield #floodplain | ⏳ live — awaiting |
| B1123 | A spurious `alongLen` pins the trailer parking so it stops following its truck court | [Site Planner / dockZones] | #site-planner #ui | ⏳ live — awaiting |
| B1124 | Duplicating a building does not remap `forCourt`, so the copy's trailer bonds to the ORIGINAL building's court | [Site Planner / duplicate] | #site-planner #persistence | ⏳ live — awaiting |
| B1122 | Elements visibly come undone from the aerial DURING a map drag | [Site Planner / Map] | #site-planner #gis #coordinates | ⏳ live — awaiting |
| B1120 | The client never sent `p_atomic` in production, so B1116/B1117 did nothing | [Site Planner / sync] | #site-planner #sync #persistence #testing | ⏳ live — awaiting |
| B1118 | The heal misses a whole-assembly translation, because reach scales with the host | [Site Planner / Site Model] | #site-planner #persistence | ⏳ live — awaiting |
| B1113 | A stale local cache still wins on load, for a SUBSET of an assembly, dribbled across transactions | [Site Planner / sync] | #site-planner #sync #persistence | ⏳ live — awaiting |
| B1114 | `strandedFromHost` missed a large-but-not-absurd displacement | [Site Planner / Site Model] | #site-planner #persistence | ⏳ live — awaiting |
| B1115 | A rejected commit hot-loops at ~1 RPC/second with no backoff and no give-up | [Site Planner / sync] | #site-planner #sync #perf | ⏳ live — awaiting |
| B1111 | Colorado county GIS registry: nine counties, a statewide fallback tier, and state-scoped click routing | [Platform / gis] | #gis #coordinates | ⏳ live — awaiting |
| B1103 | Colorado floodplain: the CWCB statewide floor, and the 72-hour drawdown statute as a real pass/fail | [Standards / flood] | #floodplain #pond | ⏳ live — awaiting |
| B1104 | The Colorado capability guard: no Texas-derived number, no silent fallback, no blank that reads as zero | [Standards / detention] | #yield #floodplain #ui | ⏳ live — awaiting |
| B1101 | The Standards footer's `Project \| All` toggle looked like one axis with Apply and was two — three explicitly named actions, a pending draft, and a footer that stops slicing the settings list | [Site Planner / standards] | #site-planner #ui #persistence | ⏳ live — awaiting |
| B1093 | "Select parcels: off" strands the user: clicking a parcel does nothing, with no feedback | [Site Planner / parcelSelect] | #site-planner #selection #ui | ⏳ live — awaiting |
| B1095 | Hover ANY contour to read its elevation, not just the labelled every-5-ft index lines | [Site Planner / GIS] | #site-planner #gis #ui | ⏳ live — awaiting |
| B1096 | The ground-elevation readout must ALWAYS show a state (it silently vanished), and must also show PROPOSED elevation + cut/fill | [Site Planner / GIS · grading] | #site-planner #gis #grading #ui | ⏳ live — awaiting |
| B1091 (×3) | Non-governing district rows in the Flood & drainage group — the scoping named the governing district BACKWARDS — and then the group could go SILENT again | [Site Planner / layers panel · GIS] | #site-planner #gis #floodplain #ui | ⏳ live — awaiting |
| B1092 | The BKDD easement identify never fires on the planner canvas: identify was wired for the map finder only | [Site Planner / GIS] | #site-planner #gis #floodplain | ⏳ live — awaiting |
| B1089 | The screening study fails SILENTLY on the exact sites it was built for: a committed estimate suppressed its honest unknown | [Site Planner / floodplain · ui] | #site-planner #floodplain #ui | ⏳ live — awaiting |
| B1087 | Contour labels double-stamp and go stale: a superseded terrain compute still paints into the live group | [Site Planner / GIS] | #site-planner #gis #ui | ⏳ live — awaiting |
| B1088 | Contour lines and labels re-roll on every pan/zoom: anchor the DEM grid to a fixed tile lattice and label deterministically | [Site Planner / GIS] | #site-planner #gis #ui | ⏳ live — awaiting |
| B1085 | An export sheet inherited the LIVE declutter tier, so a PDF taken while zoomed OUT silently shipped with a building unlabelled | [Site Planner / export] | #site-planner #export #ui | ⏳ live — awaiting |
| B1086 | The committed frame-time budget was seeded from a browser session whose tab was hidden, where Chrome suspends rAF entirely | [Infra / Perf] | #infra #perf #testing | ⏳ live — awaiting |
| B1074 | Waller floodplain: flip the BFE-data requirement to VERIFIED against the county's own ordinance, and make the 5-acre trigger FIRE | [Site Planner / jurisdiction] | #site-planner #floodplain #entitlements | ⏳ live — awaiting |
| B1057 | Independent screening estimate of the base flood elevation, beside FEMA's | [Site Planner / floodplain] | #floodplain #site-planner #gis | ⏳ live — awaiting |
| B1075 | Register the Brookshire–Katy Drainage District (BKDD) as a first-class GIS source family | [Site Planner / GIS] | #site-planner #gis #floodplain | ⏳ live — awaiting |
| B1076 | "Flood & Drainage" layer group: one master toggle, district auto-scoping, provenance tiers | [Site Planner / layers panel] | #site-planner #gis #ui #floodplain | ⏳ live — awaiting |
| B1079 | Per-source `timeoutMs` + cache-proxy routing for COLD-START map services (BKDD's first call takes 16.5–18.3 s) | [Site Planner / GIS] | #site-planner #gis #infra | ⏳ live — awaiting |
| B1080 | Drainage context must be district-aware, not HCFCD-only | [Site Planner / GIS · yield] | #site-planner #gis #yield #floodplain | ⏳ live — awaiting |
| B1070 | Standards carried an Apply and a scope row per SETTING; the owner asked for one of each for the whole panel | [Site Planner / standards] | #site-planner #ui #persistence | ⏳ live — awaiting |
| B1073 | Trailer parking was structurally locked to the truck court's length | [Site Planner / dockZones] | #site-planner #ui | ⏳ live — awaiting |
| B1083 | Free draw is gone from the Road tool; "Custom width…" keeps an off-preset road reachable | [Site Planner / road] | #site-planner #road #ui | ⏳ live — awaiting |
| B1067 | Branch a road off another with a right-click, tee'd at the point you clicked | [Site Planner / SitePlanner] | #site-planner #road #ui | ⏳ live — awaiting |
| B1068 | A line's name label can ride the CENTRE line, not only beside or inside it | [Site Planner / SitePlanner] | #site-planner #ui #road | ⏳ live — awaiting |
| B1042 | NEW-9 step 3: split the SitePlannerApp monolith (1,711,381 bytes — 55% of all JS, on the critical path) | [Infra / Build] | #infra #perf #site-planner | ⏳ live — awaiting |
| B1060 | Standards only seeds NEW objects: no way to apply a standard to what's already drawn, and no cross-project default | [Standards] | #site-planner #ui #persistence | ⏳ live — awaiting |
| B1053 | The pond Optimize / design-pond affordance vanished from the pond inspector | [Site Planner / pond] | #pond #ui #site-planner | ⏳ live — awaiting |
| B1054 | The Yield / pond panel had become a wall of text | [Site Planner / yield] | #yield #ui #site-planner | ⏳ live — awaiting |
| B1056 | Flood-level sensitivity: show how the obligation moves as the WSE varies | [Site Planner / yield · floodplain] | #yield #floodplain #site-planner | ⏳ live — awaiting |
| B1050 | NEW-1: the link-schedule panel trapped the user — pressing Dashboard did not dismiss it | [Scheduler / route-sync] | #scheduler #ui | ⏳ live — awaiting |
| B1065 | the link-schedule surface could be dismissed away permanently, stranding a project with no way to link a schedule | [Scheduler / navState] | #scheduler #ui | ⏳ live — awaiting |
| B1066 | rebuild the link-schedule surface as the Schedule tab's EMPTY STATE, not a modal | [Scheduler / LinkSchedulePanel] | #scheduler #ui | ⏳ live — awaiting |
| B1052 | Roads carried control points the owner never placed: every connect SPLICED a vertex in and nothing ever took one back out | [Site Planner / roadGeometry] | #site-planner #road #ui | ⏳ live — awaiting |
| B1043 | NEW-1: drawn elements drift off the aerial on N–S pan, cumulatively — the feet frame and the basemap used inconsistent latitude models | [Site Planner / Map] | #site-planner #gis #coordinates #perf | ⏳ live — awaiting |
| B1045 | NEW-3: GIS overlays load off the critical path — the map is interactive before the data arrives | [Site Planner / Map] | #site-planner #gis #perf | ⏳ live — awaiting |
| B1046 | NEW-4: progressive slowdown is per-gesture allocation CHURN, not retention — the anti-flash ghost cloned the entire overscanned tile container | [Site Planner / Map] | #site-planner #perf | ⏳ live — awaiting |
| B1047 | NEW-5: viewport culling for the feet-frame SVG — a FRAME-TIME fix, with the export deliberately exempt | [Site Planner / Map] | #site-planner #perf #export | ⏳ live — awaiting |
| B1048 | NEW-6: overlay lifecycle — raster tiles now released on toggle-off, superseded fetches aborted on pan, identical requests deduped | [Site Planner / Map] | #site-planner #gis #perf | ⏳ live — awaiting |
| B1049 | NEW-7: tile footprint — adaptive overscan, retina gated by zoom band, tiles reused across a same-grid commit, bounded cache | [Site Planner / Map] | #site-planner #gis #perf | ⏳ live — awaiting |
| B1040 | NEW-8: standing performance budget + regression harness, gated in CI | [Infra / QA] | #infra #perf #testing | ⏳ live — awaiting |
| B1038 | NEW-2: wall sidewalks drift off the bump-out-extended side on a HOST RESIZE (only re-laid on bump-out add/delete/resize) | [Site Planner / refitChildren] | #site-planner #selection | ⏳ live — awaiting |
| B1039 | NEW-3: side parking drifts off the sidewalk it should be flush against (stale `perpGap` replayed by `fitKid`) | [Site Planner / refitChildren] | #site-planner #selection | ⏳ live — awaiting |
| B1032 | NEW-1: the SAME below-flood storage was credited to BOTH the detention and the mitigation ledger (Tsakiris: 29.65 ac-ft counted twice, reported as 12.2) | [Site Planner / stormwater · pond] | #site-planner #yield #pond #floodplain | ⏳ live — awaiting |
| B1036 | NEW-5 (owner amendment): a pond-berm contribution to the mitigation REQUIREMENT that cannot be priced looked identical to a confident zero | [Site Planner / stormwater · floodplain] | #site-planner #yield #pond #floodplain | ⏳ live — awaiting |
| B1030 | NEW-1: the pond's detention verdict row headlined "Buildable" and never named its own ledger | [Site Planner / pond · ui] | #site-planner #pond #yield #ui #floodplain | ⏳ live — awaiting |
| B1031 | NEW-2: a per-pond detention ledger provided ~2× over rendered as a clean green pass, with no over-dug state | [Site Planner / pond · ui] | #site-planner #pond #yield #ui #grading | ⏳ live — awaiting |
| B1019 | NEW-1: Yield reported Detention OK and Mitigation OK while the two together claimed 42.8 ac-ft MORE storage than the ponds physically hold | [Site Planner / yield · pond] | #site-planner #yield #pond #floodplain | ⏳ live — awaiting |
| B1020 | NEW-2: the panel printed a between-storms recovery assumption but gave the reader nothing to evaluate it with (no drawdown time) | [Site Planner / yield · pond] | #site-planner #yield #pond | ⏳ live — awaiting |
| B1021 | NEW-3: mitigation was compared as a lump sum, so a total that ties could hide every foot of the offset being at the wrong elevation | [Site Planner / stormwater · floodplain] | #site-planner #yield #pond #floodplain | ⏳ live — awaiting |
| B1022 | NEW-4: the mitigation trigger elevation was effectively hardcoded to the 100-yr line instead of following the jurisdiction | [Site Planner / stormwater · floodplain] | #site-planner #yield #floodplain | ⏳ live — awaiting |
| B1023 | NEW-5: surface the delta between a naive footprint×depth read and the real sloped-prism volume | [Site Planner / yield · pond] | #site-planner #yield #pond | ⏳ live — awaiting |
| B1024 | NEW-6: split each pond's storage above vs below the outfall invert and run the two gravity-drain tests | [Site Planner / stormwater · pond] | #site-planner #yield #pond #floodplain | ⏳ live — awaiting |
| B1025 | NEW-7: a +97% surplus and a +0.5% surplus rendered identical green OK chips | [Site Planner / yield · ui] | #site-planner #yield #ui | ⏳ live — awaiting |
| B1026 | NEW-8: the panel showed three candidate floodplain authorities but never said whose rule produced the FFE | [Site Planner / yield · floodplain] | #site-planner #yield #floodplain #entitlements | ⏳ live — awaiting |
| B1027 | NEW-9: Buildability tested only the building pad, hiding a truck court sitting ~4 ft lower | [Site Planner / yield · floodplain] | #site-planner #yield #floodplain | ⏳ live — awaiting |
| B1028 | NEW-10: a 197% detention overbuild read as slack when it was borrow-driven | [Site Planner / yield · grading] | #site-planner #yield #pond #grading | ⏳ live — awaiting |
| B1029 | The Buildability DETAIL rows were built every render and never displayed anywhere — every FFE honesty line has been silently invisible since the group was deleted | [Site Planner / yield · ui] | #site-planner #yield #floodplain #ui | ⏳ live — awaiting |
| B1017 | Junction outline-cut polylines were DOUBLE-ROTATED: stray element-coloured lines projected outside rotated rect elements | [Site Planner / renderElPx] | #site-planner #road #drive #export | ⏳ live — awaiting |
| B1016 | Pond BERM-height and FLOOR-elevation numbers painted at a fixed size at site-overview zoom, out-shouting the building dimensions | [Site Planner / pond] | #site-planner #pond #ui #yield | ⏳ live — awaiting |
| B1007 | Detention criteria keyed off the FLOODPLAIN county, not the drainage AUTHORITY — so BKDD's VERIFIED criteria (B999) never surfaced on a Brookshire–Katy site | [Site Planner / stormwater · floodplain] | #site-planner #yield #pond #floodplain | ⏳ live — awaiting |
| B1005 | NEW-1: clamp the curb-return fillet to the DRIVE WIDTH (the reach = R) so oblique tees stop scooping | [Site Planner / road] | #site-planner #road #drive | ⏳ live — awaiting |
| B1006 | NEW-2: flatten the junction pavement to ONE opaque tone; one continuous curb line (kill the faint curved seam) | [Site Planner / road] | #site-planner #road #ui | ⏳ live — awaiting |
| B1010 | Connect debris judged by DISTANCE let a 3.4 ft stub carrying a 37° bend through, starving the corner and mis-aiming the junction | [Site Planner / road] | #site-planner #road | ⏳ live — awaiting |
| B1011 | A tee that lands ON a bend in the through road was solved as if the through road were straight | [Site Planner / roadGeometry] | #site-planner #road | ⏳ live — awaiting |
| B1015 | The new corner tag sprawled across the plan and its "Fix" printed on top of its own label — and the corner still drew as a blob because the OLD auto-fixer's clamped radius was baked into the vertex | [Site Planner / roadGeometry] | #site-planner #road #ui | ⏳ live — awaiting |
| B1014 | Three clicks made a road, but nothing on the canvas said how to END it — and the instinctive Esc threw the draft away | [Site Planner / SitePlanner] | #site-planner #road #ui | ⏳ live — awaiting |
| B1013 | A corner near a road's END had half its approach taken away by a clamp meant for shared legs, then the app flagged the geometry instead of fixing it | [Site Planner / roadGeometry] | #site-planner #road | ⏳ live — awaiting |
| B1012 | The road cleanup ran on only ONE of the two read paths, so it did nothing on a signed-in element-synced plan | [Site Planner / sync] | #site-planner #road #sync | ⏳ live — awaiting |
| B1009 | Junction pavement ran UNDER buildings, the target's outline was ruled across the drive mouth, and a corner clamped below its civil minimum said nothing | [Site Planner / road] | #site-planner #road #drive | ⏳ live — awaiting |
| B1008 | NEW-3: collapse near-duplicate road vertices at connect/insert time + a one-shot load migration that dedupes stored `pts` (index-aligned with `vtx`) | [Site Planner / road] | #site-planner #road | ⏳ live — awaiting |
| B999 | BKDD Rules 22-01 criteria-truth: flip the registry's Brookshire–Katy row ASSUMED → VERIFIED from the owner-supplied signed full text (freeboard, storms, orifice C, pumped share, coincident/tailwater, +0.65 floor, +spillway, +sediment) | [Site Planner / stormwater · floodplain] | #site-planner #yield #pond #floodplain | ⏳ live — awaiting |
| B997 | NEW-27: pumped detention must NOT ask the user for an outflow CFS — derive the allowed pump rate from a per-jurisdiction pumped-share criterion, with an optional override | [Site Planner / stormwater · pond] | #site-planner #yield #pond | ⏳ live — awaiting |
| B996 | NEW-26: mitigation credit must be CONNECTED-by-default (the flood backs in through the pond's own outfall), gated only on an explicitly gated / absent outfall — supersedes the B990 berm-seal + role gates | [Site Planner / stormwater · pond] | #site-planner #yield #pond #floodplain | ⏳ live — awaiting |
| B990 | NEW-21: mitigation credit was computed TWO ways (verdict SHORT 0.0 vs Optimize card "already covers 0.2") | [Site Planner / stormwater · pond] | #site-planner #yield #pond #floodplain | ⏳ live — awaiting |
| B992 | NEW-23: the per-pond "holds" chip showed the inward-crest gross, not the drawn-ring total the explainer uses (mismatched pair) | [Site Planner / yield · pond] | #site-planner #yield #pond #ui | ⏳ live — awaiting |
| B983 | NEW-18: a mitigation shortfall hung the one-click ⚡ Optimize, which can't reliably close mitigation (button honesty) | [Site Planner / stormwater] | #site-planner #yield #pond | ⏳ live — awaiting |
| B982 | NEW-17: pond berm fill in the mapped floodplain reads ~0 in the mitigation requirement (outward-vs-inward geometry) | [Site Planner / stormwater · floodplain] | #site-planner #yield #pond #floodplain | ⏳ live — awaiting |
| B987 | R1: pond recovers to NORMAL (dry-weather) tailwater between storms, not the 100-yr level — dead storage = below NORMAL tailwater | [Site Planner / stormwater · pond] | #site-planner #yield #pond #floodplain | ⏳ live — awaiting |
| B984 | NEW-19: the flood-data header and the WSE-driven numbers now read ONE truth (no "not checked" over definite remembered numbers) | [Site Planner / yield · persistence] | #site-planner #yield #floodplain #persistence | ⏳ live — awaiting |
| B989 | Drive/road → court junctions: WIDTH-cap the curb return + ONE seamless "mouth" cover (kill the oblique balloon/scoop/notch/blotch) | [Site Planner / road] | #site-planner #road #drive | ⏳ live — awaiting |
| B980 | NEW-15: the detention explainer no longer claims "none counts" over a pond that counts 34.0 of 63.9 (partial vs total dead) | [Site Planner / yield · ui] | #site-planner #yield #pond #ui | ⏳ live — awaiting |
| B981 | NEW-16: a trace mitigation requirement (0.01 ac-ft) rendered as a red SHORT "0.0 of 0.0" — materiality floor + display invariant | [Site Planner / yield · ui] | #site-planner #yield #pond #floodplain #ui | ⏳ live — awaiting |
| B978 | Grading engine: balance-optimal finished-floor float (DECISION 3) + net earthwork residual (DECISION 2) | [Site Planner / yield · pond · floodplain] | #site-planner #yield #pond #floodplain #ui | ⏳ live — awaiting |
| B977 | Map/panel storage+depth consistency (O3) + label every acreage (O4) | [Site Planner / yield · pond] | #site-planner #yield #pond #ui | ⏳ live — awaiting |
| B976 | Pond buildability copy + berm rule: fix the garbled drainage warning (O1) and UNIFY the design-vs-optimizer berm stance (O2) | [Site Planner / yield · pond] | #site-planner #yield #pond #ui | ⏳ live — awaiting |
| B975 | Outfall TAILWATER source ladder + never-grade root-cause fix + Drainage district surfaced (PR-N / grading DECISION 4 + FOLD IN + PR-O O5) | [Site Planner / yield · pond · floodplain · gis] | #site-planner #yield #pond #floodplain #gis #ui | ⏳ live — awaiting |
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
| B409 (×2) | Unlimited-size file uploads: chunked Drive upload through the Worker proxy (replaces the CORS-dead browser-direct path) | [Doc Review / storage] | #doc-review #drive | ⏳ live — awaiting |
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
| B743 | Harden the shared element-delete path so no element type can silently no-op (×2) | [Site Planner] | #site-planner #selection #persistence #testing #ui | ⏳ live — awaiting |
| B1215 | Instrument every delete attempt and outcome, so "delete is broken" is one query instead of a guessing game | [Site Planner / telemetry] | #site-planner #selection #infra #testing | ⏳ live — awaiting |
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
| B672 (×2) | Element-level sync, phase 3/5: realtime read path + rejoin refetch (read cutover; blob frozen) | [Site Planner] | #site-planner #persistence | ⏳ live — awaiting |
| B673 | Element-level sync, phase 4/5: loud-conflict surface + delete/edit matrix | [Site Planner] | #site-planner #ui #persistence | ⏳ live — awaiting |
| B674 | Element-level sync, phase 5/5: remove the edit lock — multi-writer cutover + presence pill | [Site Planner / Shell] | #site-planner #ui #persistence | ⏳ live — awaiting |
| B714 | Sharing a project silently REVERTS: any ordinary save from the owner's open tab overwrote `sites.team_id` back to null, locking the collaborator out | [Site Planner / Review / teams · RLS] | #site-planner #persistence #auth | ⏳ live — awaiting |
| B1166 | The address-search parcel card was a wall of text: a metes-and-bounds Legal blob made it taller than the map | [Site Planner / MapFinder] | #ui #gis #site-planner | ⏳ live — awaiting |
| B1167 | Sign-up and password-reset copy never said who the email comes from | [Site Planner / AuthPanel] | #auth #ui #site-planner | ⏳ live — awaiting |
| B1195 | A building's truck court and side parking carried a DIFFERENT building's length, overhanging it by ~195 ft | [Site Planner / dockZones] | #site-planner #ui #persistence | ⏳ live — awaiting |
| B1196 | Address search showed the OWNER'S MAILING address instead of the situs — and that wrong address became the site NAME | [Site Planner / MapFinder] | #site-planner #gis #ui | ⏳ live — awaiting |

## By tag

- **#auth** — B916, B917, B778, B483, B377891, B366384, B366385, B366386, B326416, B326417, B326418, B326419, B312545, B1425, B482, B1291, B676, B714, B1167
- **#compare** — B471
- **#coordinates** — B290247, B290250, B1422, B217541, B1106, B297904, B230080, B1141, B1142, B1122, B1111, B1043, B625, B684
- **#doc-review** — B484, B471, B423, B422, B413, B411, B406, B364, B267, B268, B269, B273, B180, B181, B183, B20, B38, B208960, B208961, B208962, B208965, B208966, B1190, B1173, B1160, B947, B948, B914, B918, B919, B791, B792, B409, B746, B667, B659
- **#drive** — B663, B662, B629, B1017, B1005, B1009, B989, B791, B792, B409, B699, B701
- **#entitlements** — B290245, B290246, B290248, B818, B725, B726, B290240, B1239, B1074, B1026, B868, B816
- **#export** — B1440, B818, B810, B752, B350000, B335985, B316864, B298756, B298758, B1400, B1355, B1342, B1328, B1314, B1153, B1085, B1047, B1017, B862, B839, B840, B816, B745, B738, B712, B684
- **#files** — B393173, B180, B181, B182, B183, B298756, B952, B792, B784, B785, B786, B747, B748, B699, B675, B668, B664, B659
- **#filing** — B411, B364, B273, B699, B664, B659
- **#floodplain** — B290246, B290248, B1442, B1353, B998, B1000, B1001, B994, B986, B988, B906, B435537, B407328, B367296, B367297, B298560, B298561, B298562, B298401, B286309, B286308, B286304, B286305, B290243, B280704, B280705, B280706, B280707, B276752, B276753, B276755, B276449, B209506, B209507, B209508, B1421, B1235, B1236, B1237, B1241, B1207, B1105, B1103, B1104, B1091, B1092, B1089, B1074, B1057, B1075, B1076, B1080, B1056, B1032, B1036, B1030, B1019, B1021, B1022, B1024, B1026, B1027, B1029, B1007, B999, B996, B990, B982, B987, B984, B981, B978, B975, B972, B968, B967, B885, B884, B882, B883, B878, B868, B870, B871, B861, B862, B802, B789
- **#gantt** — B818, B443248, B1342, B816
- **#gis** — B290245, B290247, B242544, B242545, B1422, B1432, B1433, B1434, B1121, B1349, B1208, B1063, B810, B776, B777, B752, B753, B722, B723, B724, B726, B629, B370, B309, B178, B171, B147, B13, B95, B435537, B393168, B393169, B393170, B385040, B367296, B367297, B323424, B323425, B298560, B298562, B298401, B286308, B286304, B286305, B286306, B286307, B297904, B297905, B297907, B290240, B280704, B280705, B276752, B276753, B276754, B276755, B209506, B209507, B209508, B209502, B209503, B209504, B1427, B1421, B1423, B1424, B1401, B1402, B1403, B1254, B1253, B1235, B1236, B1237, B1241, B1205, B1206, B1161, B1162, B1141, B1142, B1131, B1132, B1122, B1111, B1095, B1096, B1091, B1092, B1087, B1088, B1057, B1075, B1076, B1079, B1080, B1043, B1045, B1048, B1049, B975, B972, B956, B885, B884, B882, B883, B879, B860, B861, B839, B840, B832, B691, B789, B787, B625, B751, B745, B738, B707, B712, B1166, B1196
- **#grading** — B276450, B1096, B1031, B1028, B888, B871
- **#infra** — B435538, B393171, B393173, B329408, B296224, B295168, B287058, B280403, B280401, B267536, B267537, B267538, B267539, B266081, B255200, B251136, B233152, B227888, B227476, B227477, B227478, B227479, B227472, B227473, B227474, B227475, B221760, B209568, B209569, B209570, B6864, B6865, B6866, B6867, B1448, B1441, B1443, B1435, B1436, B1438, B1432, B1433, B1431, B1349, B1341, B1163, B1064, B916, B917, B778, B735, B726, B406, B179, B63, B447472, B369536, B326416, B326419, B304177, B298563, B287056, B287057, B287060, B276576, B276448, B270912, B265536, B779, B36052, B1429, B1421, B1373, B1344, B1160, B1086, B1079, B1042, B1040, B864, B786, B812, B811, B759, B756, B748, B1215, B675, B669
- **#library** — B1318, B663, B662, B952, B792, B699, B701, B676, B668, B664, B659
- **#markup** — B423, B422, B267, B268, B435536, B1355, B1328, B1190, B1152, B1153, B947, B948, B918, B919, B913, B820, B746, B737
- **#notes** — B434416, B434417, B434418, B421488, B421489, B421490, B421491, B421492, B421493, B421494, B400176, B400177, B342996, B298759, B1318, B391072, B391077, B391078, B364016, B357011, B350000, B350002, B350003, B342992, B315712, B315716, B298756, B298758, B291536, B1392, B36050, B36051, B1393, B1420, B482, B1419, B1400, B1391, B1374, B1291, B1314
- **#parcel** — B280402, B297905, B297906, B297908
- **#perf** — B393171, B393173, B329408, B295168, B287058, B287059, B297909, B286001, B267539, B255200, B251136, B251137, B227888, B227476, B227477, B227478, B227479, B227472, B227473, B227474, B227475, B221760, B221761, B217537, B217540, B209568, B209569, B209570, B1448, B1440, B1441, B1442, B1443, B1350, B1435, B1436, B1437, B1438, B1432, B1433, B1434, B1121, B1431, B1359, B1360, B1349, B1351, B1353, B1163, B1064, B1063, B495, B484, B479, B407328, B385040, B323425, B286000, B298560, B298561, B298563, B298401, B287057, B287060, B276576, B270912, B265536, B221763, B236592, B50008, B1427, B1401, B1402, B1352, B1344, B1345, B1346, B1329, B1330, B1331, B1189, B1157, B1158, B1160, B1161, B1162, B1132, B1115, B1086, B1042, B1043, B1045, B1046, B1047, B1048, B1049, B1040, B842, B860, B839, B837, B832, B821, B816, B669
- **#persistence** — B434417, B435538, B420257, B400176, B298759, B255200, B217540, B1341, B994, B916, B662, B648, B499, B495, B483, B474, B479, B163, B128, B134, B20, B38, B447472, B420256, B391072, B366385, B369536, B364016, B357011, B342992, B326416, B326419, B315712, B315716, B316864, B298756, B265536, B1427, B1428, B1429, B1420, B1415, B1416, B1417, B1391, B1377, B1374, B1340, B1291, B1198, B1124, B1120, B1118, B1113, B1114, B1101, B1070, B1060, B984, B956, B914, B860, B863, B864, B836, B832, B791, B792, B793, B784, B785, B786, B812, B811, B759, B757, B756, B751, B746, B742, B743, B716, B701, B692, B682, B676, B667, B672, B673, B674, B714, B1195
- **#pond** — B287059, B290248, B290249, B221760, B221761, B217537, B1353, B1000, B1001, B1002, B1003, B1004, B993, B995, B986, B988, B954, B950, B943, B937, B934, B906, B290243, B221763, B236592, B1103, B1053, B1032, B1036, B1030, B1031, B1019, B1020, B1021, B1023, B1024, B1028, B1016, B1007, B999, B997, B996, B990, B992, B983, B982, B987, B980, B981, B978, B977, B976, B975, B974, B973, B972, B970, B969, B968, B967, B965, B963, B958, B957, B909, B907, B905, B904, B903, B902, B901, B900, B888, B884, B883, B870, B871, B707
- **#road** — B280400, B278576, B278577, B217537, B1382, B1383, B1405, B1155, B1083, B1067, B1068, B1052, B1017, B1005, B1006, B1010, B1011, B1015, B1014, B1013, B1012, B1009, B1008, B989, B971, B964, B961, B960, B959, B955, B953, B945, B946, B742
- **#scheduler** — B908, B818, B778, B495, B443248, B443249, B443250, B1342, B1343, B1050, B1065, B1066, B865, B863, B864, B836, B816
- **#selection** — B280402, B280400, B278576, B278577, B233152, B1208, B393172, B371360, B316864, B316865, B304177, B297908, B295008, B295009, B230080, B50008, B50009, B1414, B1404, B1327, B1190, B1197, B1185, B1175, B1093, B1038, B1039, B948, B912, B880, B820, B746, B742, B743, B1215, B737, B682, B651
- **#site-planner** — B435538, B420257, B367298, B287058, B287059, B297909, B290245, B290246, B290247, B290248, B290249, B290250, B280402, B286001, B280400, B278576, B278577, B267536, B267539, B266081, B255200, B251136, B251137, B242544, B242545, B1422, B233152, B227888, B227476, B227477, B227478, B227479, B227472, B227473, B227474, B227475, B221760, B221761, B217537, B217540, B217541, B209568, B209569, B209570, B1448, B1440, B1442, B1443, B1350, B1435, B1436, B1437, B1438, B1432, B1433, B1434, B1121, B1431, B1382, B1383, B1359, B1360, B1349, B1351, B1353, B1341, B1318, B1208, B1064, B1063, B998, B1000, B1001, B1002, B1003, B1004, B993, B994, B995, B986, B985, B988, B966, B954, B950, B944, B943, B937, B936, B934, B906, B810, B776, B777, B752, B753, B723, B724, B725, B629, B499, B484, B474, B479, B423, B406, B370, B309, B182, B183, B178, B177, B171, B163, B147, B115, B13, B95, B447472, B442688, B435536, B435537, B420256, B407328, B393168, B393169, B393170, B393172, B385040, B385041, B385042, B384064, B377891, B371360, B371361, B366384, B366385, B366386, B367296, B367297, B335985, B326416, B326417, B326418, B323424, B323425, B286000, B316864, B316865, B304177, B298560, B298561, B298562, B298563, B298401, B286308, B286304, B286306, B286307, B287060, B297904, B297905, B297906, B297907, B297908, B290240, B290243, B295008, B295009, B280704, B280705, B280706, B280707, B276752, B276754, B276755, B276448, B276449, B276450, B221763, B236592, B230080, B50008, B50009, B209506, B209507, B209502, B209503, B209504, B1427, B1428, B1423, B1424, B1425, B1414, B1415, B1416, B1417, B1418, B1401, B1402, B1403, B1404, B1405, B1377, B1352, B1356, B1355, B1344, B1345, B1346, B1340, B1327, B1328, B1329, B1330, B1331, B1254, B1253, B1235, B1236, B1237, B1239, B1241, B1214, B1205, B1206, B1207, B1189, B1204, B1197, B1198, B1191, B1192, B216, B1184, B1185, B1186, B1187, B1173, B1175, B1156, B1157, B1158, B1160, B1161, B1162, B1155, B1152, B1153, B1141, B1142, B1131, B1132, B1123, B1124, B1122, B1120, B1118, B1113, B1114, B1115, B1101, B1093, B1095, B1096, B1091, B1092, B1089, B1087, B1088, B1085, B1074, B1057, B1075, B1076, B1079, B1080, B1070, B1073, B1083, B1067, B1068, B1042, B1060, B1053, B1054, B1056, B1052, B1043, B1045, B1046, B1047, B1048, B1049, B1038, B1039, B1032, B1036, B1030, B1031, B1019, B1020, B1021, B1022, B1023, B1024, B1025, B1026, B1027, B1028, B1029, B1017, B1016, B1007, B1005, B1006, B1010, B1011, B1015, B1014, B1013, B1012, B1009, B1008, B999, B997, B996, B990, B992, B983, B982, B987, B984, B989, B980, B981, B978, B977, B976, B975, B974, B973, B972, B971, B970, B969, B968, B967, B965, B842, B964, B963, B961, B960, B959, B958, B957, B956, B955, B953, B951, B952, B947, B948, B945, B946, B919, B911, B912, B913, B909, B907, B905, B904, B903, B902, B901, B900, B888, B885, B884, B882, B883, B880, B879, B878, B868, B870, B871, B860, B861, B862, B839, B840, B837, B832, B821, B691, B820, B802, B793, B789, B787, B784, B785, B786, B812, B811, B759, B757, B756, B625, B751, B747, B748, B745, B746, B742, B743, B1215, B738, B737, B716, B707, B712, B692, B684, B682, B651, B672, B673, B674, B714, B1166, B1167, B1195, B1196
- **#stitching** — B413, B208960, B208961, B208962, B839
- **#sync** — B421493, B420257, B400176, B342996, B298759, B1341, B447472, B420256, B391072, B377891, B366384, B366385, B366386, B364016, B357011, B342992, B315712, B315716, B1420, B482, B1415, B1416, B1417, B1391, B1374, B1343, B1340, B1291, B1120, B1113, B1115, B1012
- **#testing** — B329408, B296224, B295168, B280403, B280401, B267536, B267537, B267538, B267539, B266081, B255200, B251136, B233152, B227888, B227476, B227477, B227472, B227473, B227474, B221760, B209568, B209569, B6864, B6865, B6866, B6867, B1448, B1441, B1443, B1435, B1436, B1432, B1431, B1163, B1126, B966, B269, B63, B393169, B393170, B391078, B366388, B369536, B326419, B304177, B298563, B287056, B287057, B287060, B276576, B276754, B276448, B276449, B276450, B270912, B265536, B36052, B1421, B1373, B1344, B1346, B1120, B1086, B1040, B878, B863, B836, B743, B1215
- **#thoroughfare** — B722, B723, B724, B725, B726
- **#ui** — B434416, B434417, B434418, B421488, B421489, B421490, B421491, B421492, B421494, B400177, B367298, B280402, B286001, B280400, B278576, B278577, B242544, B227479, B227474, B221761, B217541, B1440, B1441, B1442, B1443, B1350, B1435, B1437, B1438, B1385, B1382, B1383, B1359, B1360, B1351, B1208, B1126, B998, B995, B985, B954, B950, B944, B943, B937, B936, B934, B917, B810, B735, B723, B115, B443249, B443250, B442688, B435536, B393172, B391077, B385040, B385041, B385042, B384064, B377891, B371360, B371361, B366387, B366388, B366389, B367296, B350000, B350002, B350003, B335985, B326417, B326418, B323424, B312545, B286000, B316864, B316865, B298758, B298561, B298562, B291536, B297906, B297907, B295008, B295009, B276576, B221763, B236592, B230080, B50008, B50009, B208960, B208961, B208962, B208965, B208966, B1392, B36050, B36051, B1393, B1428, B1429, B1423, B1424, B1425, B1420, B482, B1419, B1414, B1418, B1404, B1405, B1400, B1384, B1374, B1373, B1352, B1356, B1355, B1345, B1346, B1342, B1343, B1327, B1328, B1329, B1254, B1253, B1236, B1241, B1214, B1205, B1206, B1189, B1190, B1204, B1197, B1198, B1191, B1192, B216, B1184, B1185, B1186, B1187, B1173, B1175, B1156, B1155, B1152, B1153, B1131, B1132, B1123, B1104, B1101, B1093, B1095, B1096, B1091, B1089, B1087, B1088, B1085, B1076, B1070, B1073, B1083, B1067, B1068, B1060, B1053, B1054, B1050, B1065, B1066, B1052, B1030, B1031, B1025, B1029, B1016, B1006, B1015, B1014, B992, B980, B981, B978, B977, B976, B975, B974, B973, B972, B971, B970, B969, B968, B967, B965, B842, B964, B963, B961, B960, B959, B958, B957, B956, B955, B953, B951, B952, B947, B948, B945, B946, B928, B914, B911, B912, B913, B909, B903, B902, B901, B900, B882, B880, B879, B865, B862, B837, B821, B820, B802, B746, B742, B743, B712, B669, B668, B673, B674, B1166, B1167, B1195, B1196
- **#yield** — B290249, B267536, B266081, B1442, B1126, B998, B1000, B1001, B1002, B1003, B1004, B993, B994, B995, B986, B985, B988, B966, B954, B950, B944, B943, B937, B936, B934, B906, B724, B298560, B298561, B298562, B298563, B286309, B286305, B280706, B280707, B276753, B221763, B236592, B209508, B1235, B1239, B1207, B1158, B1105, B1104, B1080, B1054, B1056, B1032, B1036, B1030, B1031, B1019, B1020, B1021, B1022, B1023, B1024, B1025, B1026, B1027, B1028, B1029, B1016, B1007, B999, B997, B996, B990, B992, B983, B982, B987, B984, B980, B981, B978, B977, B976, B975, B974, B973, B972, B970, B969, B968, B967, B965, B963, B958, B957, B909, B888, B885, B884, B882, B883, B878, B868, B870, B871, B860, B861, B862, B832, B802, B751, B712, B651
