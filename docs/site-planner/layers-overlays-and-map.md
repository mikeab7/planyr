# Site Planner notes: layers overlays and map

_Moved verbatim out of `src/workspaces/site-planner/CLAUDE.md` (audit batch H, 2026-11-23). Nothing below was reworded, shortened or removed; the folder pointer now only signposts here. Root rules in `/CLAUDE.md` still apply._

- **`lib/pasteImage.js` (B2207872) — Ctrl+V a clipboard image = a new overlay.** Pure: `imageFileFromClipboard`, `pastedImageName` ("Pasted image", "Pasted image 2"…). `SitePlanner.jsx`: a window `paste` listener feeds the ONE `addOverlayFile` (no second overlay path); the Ctrl+V keydown defers the internal element/overlay paste one tick (`keyPasteTimerRef`) and does NOT `preventDefault`, so an image on the clipboard can cancel it. Guards: repo-root `test/` **pasteImage**; e2e **paste-image-overlay**.
- **`lib/siblingOverlays.js` (B2200992) — an overlay on one plan is an OPTION on every sibling plan of the site (owner constraint #11, amended 2026-10-08).** Pure: which sibling records are offered (`offerable`/`foreignOverlaysFor`: stored, not the aerial/map backdrop, not already held by (storageKey, page)), the copy (`makeForeignCopy`: FRESH id, never `idbKey`/`src`/heal flags, `sharedFrom` stamp) and `planForeignCopy` (fresh re-read, `resolveClipFrame`, readability probe — every refusal named). `fetchSiblingPlans` is the one READ-ONLY query (id / group_id / `data->>groupId`); **nothing here writes a sibling plan.** `SitePlanner.jsx`: `showForeignOverlay`, and `removeOverlay` → `releaseOverlayAssets` (ref-count includes the siblings; unknown ⇒ release nothing). Guards: repo-root `test/` **siblingOverlays**; live: ui-audit **verify-sibling-overlays** (V1620096). The Overlays-panel rows wait on the panel rebuild PR.
- **⛔ `lib/overlayHeal.js` (B2244016) + `db/project_follow_sharing.sql` (B2244017/B2244018) — SHARING A PROJECT SHARES ITS OVERLAYS (owner constraint #21), AND A REFUSED DOWNLOAD IS NEVER "FILE GONE".** Storage answers an RLS refusal with the same 400 as a missing object, so the rehydrate loop may persist the `storageKey: null` heal ONLY for a key in the reader's OWN folder (`mayHealMissingOverlay`); anything else is the terminal `denied` (retry), never a write — a teammate's client used to erase the owner's pointers in the owner's shared plan (12 records on production, files intact; restore is the owner's call, `db/overlay_pointer_restore_proposal.sql`). Reading is DERIVED by additive SELECT policies, never by rewriting `team_id`: a Site-tab overlay file is readable when the caller can read a live plan naming it AND its origin plan (third path segment, uploader bound) — no fallback for a missing origin (plan-id squatting); Map/Comps overlays, their rasters and comps follow `can_read_via_project`. Guards: repo-root `test/` **overlayHealGuard**; `db/test/project_follow_sharing.test.sql` (as `authenticated`, rolled back, mutation-proven); live ui-audit **verify-shared-overlay-access** (two pinned test accounts, V1671200).
- **⛔ `layerZoomGate.js` (B323424/B323425) — THE ONE ANSWER TO "IS THIS ROW ACTUALLY DRAWING RIGHT
  NOW?", and the reason it is shared rather than a note on the contour row.** A checked layer that a
  zoom gate suppresses looked exactly like a broken one: the owner ticked *"Contour lines (1 ft)"*
  below the z16 gate and sat for a minute believing the feature had failed. The panel DID carry
  *"Zoom in to ≥ 16 to load"* — **static helper text that renders identically whether the layer is
  drawing or not, under a checkbox that says ON. That is the defect, not the fix.** Four live states
  (`off` · `drawing` · `dormant-zoom` · `dormant-blank`) computed from the ACTUAL current zoom; the
  row renders dormant with a **hollow** status dot (every live state is a filled dot) and one live
  line — `Not showing at this zoom — zoom in 3 levels` — that **IS the fix**: clicking it takes the
  map just past that layer's gate. No legend, no key. **Three things not to undo:** **(a)** the gate
  is asked BEFORE coverage — below it the layer never queried anything, so *"no data in this area"*
  would be a fabrication; **(b)** `featureLayerOptions` passes `minZoom: cfg.minZoom ?? 10` to
  Leaflet, so **every `esriFeature` layer is gated at 10 whether its row says so or not** and Leaflet
  suppresses it SILENTLY — those rows showed a green "loaded" dot over an empty map, which is worse
  than the case that was reported; **(c)** the kind-gated rows DECLARE their `minZoom` in the registry
  and `evidenceLayers.js` imports its two constants from here, because the dangerous failure is the
  panel and the map holding two different numbers. **B323425, the sibling defect:** the gate must be
  answered ONCE, at the zoom the plan actually opens at — a plan opens on the default view (≈ z17.25)
  and the whole-site framing drops it 120 ms later, so a layer admitted in that window fetched,
  painted, and was then correctly cleared (*"contours paint, then disappear about two seconds after
  load"*). `SitePlanner`'s `layerGateReady` latch defers every ADD until the framed view is committed.
  Guards: the repo-root `test/` suite **layerZoomGate** (24, which reads the real registry, the real
  terrain gate, the real `minVectorZoom` and the real Leaflet default and fails on any drift), the
  e2e spec **layer-zoom-dormant** (6, proven red pre-fix on a selector that exists on both builds),
  and the repo-root ui-audit instrument **diagnose-layer-gate-flash**. ⚠ That harness can watch the terrain
  layer ASK but never ANSWER — 3DEP is `ERR_CONNECTION_RESET` from Chromium here — and it says so
  rather than scoring itself; the paint-then-vanish half is **V121985**.
  **`layerHiddenToast.js` (B2112576)** is the on-map companion: pure once-per-crossing toast decision (+ the "Zoom in" target) over the same gates; shared by BOTH surfaces through `lib/useLayerHiddenToast.js` (the project canvas in `SitePlanner.jsx` AND the overview in `MapFinder.jsx`) over the shared toast stack. Guards: **layerHiddenToast** + e2e **layer-hidden-toast**.
- **⛔ THE IMAGERY & LAYERS PANEL IS TWO PANES (NEW-1, owner-approved mockup round 3, 2026-10-20) — `components/LayerPanel.jsx` over the pure `lib/layerPanelModel.js`.** Left: the group list (Map Base · Topography · Jurisdictions · Flood & Drainage · Utilities · Environmental · Access; a dropdown on a phone; last group remembered per device, `planyr:layerPanelGroup`); right: the selected group's rows. **A row is ONE line** (checkbox · swatch · name · status dot · ▾) with NO persistent text under it — the ▾ opens ONE inline dropdown (`dropdownPlan` is the order: "Too far out to draw" + Zoom In · Opacity · layer settings · Draw above plan · legend/ramp · ⓘ). The header carries ▾ collapse, the **Hide Layers** pill and the ⋯ menu (Turn all layers off · "no data here" Show/Dim/Hide + nearby range · the one screening-data line). Rules to keep: **(1) Hide Layers is session-only and non-destructive** — `lib/layerHide.js` is a store, never saved; hosts persist from the RAW `overlays` and paint/identify/coverage/export from `overlaysDrawn` (`useDrawnOverlays` → `layerPanelModel.drawnOverlaysOf`, identity-stable when nothing is filtered — B385040), so a checkbox, `layerOverrides` and undo never see it; turning a layer ON ends the hide. **(2) LOCATION SCOPE (supersedes the old out-of-state reveal list): a row whose source cannot serve the site is NOT RENDERED** — `states` plus a declared `regions: [...]` for the Houston-area sources — REAL boundaries, not a circle (B2436066, `lib/serviceAreas.js` over the generated `lib/serviceAreaData.js`, rebuilt by the repo-root build-service-areas script): `harris` (HCFCD Channels & ROW) · `houston` (City of Houston limits + ETJ: storm / wastewater / water / hydrants) · `bkdd` (Brookshire–Katy Drainage District); only the growth-fault STUDY extent keeps a circle (`houston_metro`). **The rule reads ONLY the point + state both hosts pass (plan origin / finder view centre) — never a county the host identified, because the planner's county is null when the identify names two counties or has not resolved, and null fails open (that was the planner-vs-finder split).** The geometry loads by dynamic import (`useServiceAreas`); a point-less scope (no state AND no coordinates), unloaded geometry or an undeclared area fails OPEN; a layer ON where its row is hidden stays in saved state but is not drawn. **A row declares its state scope as `states: [...]` (only there) or `statesNot: [...]` (everywhere EXCEPT — the four EIA Pipelines rows are `statesNot: ["TX"]`, the RRC row is `states: ["TX"]`), and a LOCATED point no state holds (off the US, `siteState` null) is positively "somewhere else": it hides every `states` row and keeps the `statesNot` ones (B2479568, owner 2026-10-29: Texas Pipelines were offered in Tennessee/Kentucky). Since the AMENDMENT (same day, "you need to check every state") `siteState` names ALL 50 states + DC, so Ohio is "OH" and Shreveport is "LA" — see the `siteRegion.js` entry. The state is read from the point by `layerAvailableHere` itself, so the planner and the finder cannot disagree. Guards: repo-root `test/` **layerLocationScope** (red on 793f75e), **layerStateCoverage**; ui-audit **verify-layers-location-scope** (both surfaces; `--live`-capable).** **(3) Merge groups are registry tags** (`MERGE_GROUPS`: Water & Sewer, Electric, Fire Hydrants, **`counties_cities`**, **`pipelines`**) — a pairwise `mergeWith` is gone; the corridor is a setting of Pipelines (`settingOf`, same `txrrc_pipe_easement` key and `widthFt`, so a saved corridor-on plan still draws); the Mapillary token lives in Fire Hydrants' dropdown. **(4) Contour Interval** (1/2/5/10 ft, device pref `planyr:contourInterval`) is a FLOOR (`minInterval`) under the automatic `pickInterval`, passed to the terrain worker; cache/in-flight keys carry `:ci<N>` for N>1 (the default key is unchanged); the index line is every 5th interval. **(5) Labels are renamed only — layer ids and overlay keys never change.** **(5b) Polish round (2026-10-20, rows rule superseded by B2436064 ×2, owner 2026-10-27):** NO row reserves a swatch slot — the name starts ONE `SPACE.sm` gap after the checkbox on EVERY row (on or off, with or without a map colour; `CHECK_GAP`), so names align by construction; the layer's colour chip (`Swatch`, renders nothing otherwise) follows the NAME, only on an ON row with a map colour; Flood & Drainage has NO "sources that don't cover this site" line (`floodRowRelevance` still scopes the rows, the excluded ones are just not listed); **a row's ▾ holds the SAME parts off or on (NEW-2, B2448032): Opacity · settings (Contour Interval, the Pipelines corridor, the Mapillary token) · Draw above plan · key / ramp · the small ⓘ (glyph only, no "About this layer" text) — only the status line and "Too far out to draw" wait for the row to be on; changing Opacity, ticking Draw above plan or the Easement corridor on an OFF row turns it ON (`wakeRow`, ends Hide Layers), the Contour Interval stays a standing preference and never does. Per-layer OPACITY belongs to the PROJECT (B2448033, owner 2026-10-29) — see the `layerOpacity.js` entry below.** Guard: repo-root `test/` **imageryLayersPolish**; e2e **layers-dropdown-off-opacity**. **(5c) (B2436064/B2436065, owner 2026-10-21):** a one-pixel `layer-pane-divider` (border token) sits between the group list and the rows; a row's checkbox → name gap was cut 27 → 18 (superseded by (5b): now one `SPACE.sm` gap, no slot); **NO row is ever faded** — "Layers with no data here" is Show / Hide only (a stored `dim` reads as Show) and a zoom-gated row differs only by its hollow dot. Guards: **layerRowsNeverFaded**, **layerServiceAreas**; e2e **layers-card-divider-gap**; live ui-audit **verify-layers-areas-live**. **(6) Unchanged by design:** the stacking model (no z-index in the panel), coverage/relevance, zoom gates, per-site layer memory, `LazyPanel` loading, status-dot semantics. **(7) THE CARD IS THE PANEL AND NOTHING ELSE ON BOTH HOSTS (B2391216 ×2, owner 2026-10-21 "this doesnt look like what you mocked up").** The planner host once rendered four things UNDER the panes (Evidence tools · Easement rules · an AI-corridor placeholder · a footer sentence) because only `LayerPanel` had been rebuilt; they are gone. **The five evidence tools (trace overhead electric, route electric / water service, infer water main, ditch cross-section) were REMOVED by owner decision 2026-11-14 (NEW-1: "nobody uses the utility tracing tools and they are not really tested") — there is no Utility Evidence rail section and no `rail-ev-*` control, and they must not come back without his ask.** (They had moved from this card to the right rail on 2026-10-21; production held zero markups of kind `traced` / `infwater` / `utilRoute`, so nothing was migrated — `siteModel.dropRetiredMarkups`, run by `READ_NORMALIZE.markups`, silently drops any such record an old draft or device copy still carries. The map LAYERS in `lib/evidenceLayers.js` — OSM power, OSM hydrants, Mapillary poles & hydrants, bedrock — and the Mapillary token in Fire Hydrants' ▾ are NOT those tools and stay.) The jurisdiction Easement rules editor is the Easement ▾ menu's `easement-rules-toggle` disclosure (the one way in; the route tools' path into it is gone). A new control for the planner never goes under the card. City Names mounts on the planner through the shared `attachPlaceNames` (`lib/cityNamesPref.js`, device pref `planyr:cityNames`), the label rows carry a live status dot like every other row, and on a phone the View chip stacks above the card (the pair did not fit side by side). Guards: e2e **layers-card-two-pane-only** (red on c542ffc), **utility-evidence-removed** (red on the pre-removal build: the rail has no Utility Evidence heading / `rail-ev-*`; the Easement tool still draws and its rules editor still opens; a plan carrying retired markups loads clean); repo-root `test/` **siteModel** (`dropRetiredMarkups`); ui-audit **verify-layers-card-parity** (`--live` signs in, uses a throwaway LOCATED plan, deletes it). Guards: repo-root `test/` **layerPanelV2Guards**, **layerConsolidation**, **layerOpacityCoverage**, **activateNeverMoves**; e2e **imagery-layers-panel** (Hide/Show byte-identical plan, interval changes the drawn line count, corridor width changes the band), **layers-panel-legibility**, **layers-panel-scroll-and-state** (driven through the shared e2e layers-panel helper module); ui-audit **verify-imagery-layers-panel** (both surfaces × phone/desktop × light/dark, known-good + known-bad overlap arms, location arms GA/Harris/CO) over `imagery-layers-harness`. Also: terrain lines carry `window.__terrainStats` under E2E only.
- **⛔ `lib/layerOpacity.js` + `lib/layerOpacityStore.js` + `db/project_layer_opacity.sql` (B2448033, owner 2026-10-29) — A LAYER'S OPACITY BELONGS TO THE PROJECT, ONE ROW PER PROJECT, NEVER COPIED ONTO A PLAN.** Every plan of a project draws each layer at the project's opacity; changing it in any plan changes it for all; a new plan inherits it; on/off stays per plan (`layerOverrides`). The home is `public.project_layer_opacity (owner_id, group_id, opacity jsonb)` — `group_id = coalesce(data->>'groupId', id)` of the plan the caller names (never the drifting `group_id` column), both derived server-side from a plan the caller can reach; RLS on with NO policies, the only doors are `get_/set_project_layer_opacity(p_site_id …)` (SECURITY DEFINER, access = the plan's own sharing: owner/team read; owner, or a teammate while the plan is not `share_locked`, write; `P0002` = plan not in the cloud yet → keep the patch and retry; `42501` = view-only). **The merge rule IS the write shape: the client sends a PATCH of only the layers it changed (`{fema:0.6}` sets, `{fema:null}` = back to default), merged into the CURRENT row in one statement — never the whole map, so a stale device cannot revert a layer it did not touch.** Sparse (only layers off their registry default), registry-sanitised on read and write, a removed layer's key nulled on the next write, absent = default (no backfill). The store keeps a small device mirror (so the first paint is right; it is only ever written back as a patch) + a 600 ms trailing writer + a refresh on open / focus / tab visible; **signed out = this device only**. `SitePlanner.jsx` bridges it in the same effects as `layerOverrides` (opacity tracked only while that planner is the ACTIVE one — the map finder shares `overlays` and writes no project). An opacity change is NOT an undo step (it never was). Orphan rows of a deleted project are inert (nothing reads them). Do NOT add a per-plan `layerOpacity` field or copy the value into the plan record — that is the project-name split again. Guards: repo-root `test/` **projectLayerOpacity** (mutation-proven), e2e **layer-opacity-per-project** (red on 793f75e0), `db/test/project_layer_opacity.test.sql` (18 cases, run against production 2026-10-29); live ui-audit **verify-layer-opacity-per-project-live** (V1929392).
- `layers.js` + `components/LayerPanel.jsx` — map-layer system; `layerPrefs.js` (per-site Layers-panel
  toggle memory — NEW-1, sparse on/off overrides restored on open + persisted on toggle).
  **⛔ B385040 — `applyOnOverrides` / `applyAboveOverrides` ARE IDENTITY-STABLE, and that is load-bearing
  rather than an optimisation.** Three effects in `SitePlanner.jsx` key off the `overlays` OBJECT
  identity, one of which clears its intervals and idle callbacks and then re-stages and RE-ADDS the
  whole Leaflet overlay stack. Both functions preserved each INNER layer state's identity and then
  allocated a fresh OUTER map every call, so `applySnapshot`'s unconditional restore rebuilt every GIS
  layer on **every Ctrl+Z** — the owner's *"the screen flashes on every ctrl z"*. Fixed at BOTH ends
  deliberately: the pure functions return the INPUT when nothing moved (so no caller can trip it), and
  `applySnapshot` skips the setState entirely when `overridesSig`/`aboveSig` already match
  `prevLayerSig`/`prevAboveSig`. **⛔ IT IS UNOBSERVABLE WITHOUT THE INSTRUMENT** — the layer SET is
  byte-identical either side of the defect, so `window.__plannerLayers()` reports `identityEpoch`
  (incremented by the `[overlays]` effect itself); mutation-proven at 2 → 4 across two undos.
  Same restore also FILTERS `sel`/`multi` against the snapshot instead of blanking them, so a
  still-valid selection survives an undo (B743's no-stale-ref invariant is met more strictly, not
  waived). Guards: the repo-root `test/` suite **undoLayerStability** + the e2e spec
  **undo-dock-plan-menu**. `coverage.js` (coverage engine);
  `arcgis.js`/`counties.js`/`layerRequest.js` — GIS plumbing; **`gisCache.js` — the screening cache;
  its persistent tier lives in `localDb.js`'s IndexedDB store, NOT localStorage (B1427 — a disposable
  cache was crowding saved plans out of the ~5 MB cap; see /CLAUDE.md → TIER-BY-REBUILDABILITY). Two
  consequences to know: `read()` is L1-ONLY and synchronous, so a cold miss means "not resident yet",
  not "not stored" — use `readAsync`/`warm`, which is why `exportSheet.js` warms the frame's terrain
  tiles before its sync capture; and the budget (512 KB/entry, 3 MB total) is B1162's, unchanged —
  it stopped competing, it did not get bigger.**
  `vectorLayers.js` (pure vector engine — polygons AND lines — + boundary/pipeline registry) +
  `vectorOverlay.js` (cached boundary/pipeline/corridor render + identify + labels glue) +
  `boundaryLabels.js` (pure label math) — the B694/B695 tier; `basemaps.js` — the shared Esri/USGS
  aerial-source registry (B693). Pipelines (B751/B752): `pipelineCommodity.js` (commodity crosswalk +
  fixed hazard symbology + legend) + `pipelineCorridor.js` (pure assumed-easement buffer geometry).
  Flood & drainage group (B1075–B1080, B1091): `floodGroup.js` — the pure group model (four
  provenance tiers, master-toggle state, and the honest empty-state copy: what FEMA actually
  reported, why a district isn't listed, the governing-district drainage line). `floodRowRelevance`
  is the ONE scoping gate — governing district → district county reach → the row's own declared
  `areaCounties` → the coverage engine's published-extent verdict — so a source that cannot cover
  this site is demoted (behind one collapsed line, WITH its reason), never silently listed.
  **B1091(×2), read before touching the scoping:** a district-vs-district exclusion requires an
  EXCLUSIVE answer (`governingDistrict().exclusive`) — a boundary containment, or a county answer
  whose rivals were each boundary-tested and cleanly excluded (`drainageDistrict.tested`). A bare
  county guess may only demote a district that cannot REACH the county; otherwise it fails open.
  And the county it reasons over is the site IDENTIFY county / `LayerPanel`'s `siteCounty` prop —
  **never the `county` prop**, which is the layer-registry key and defaults to Harris on every site.
  **B1091(×3): the group may never render BLANK.** Every other line here is conditional on a resolved
  drainage context, so a surface without one said nothing at all — `floodFactsNote` owns that state
  (not-checked / county-unresolved) and goes silent once the facts are in, so it can't accumulate.
  Related trap: **BOTH hosts stay mounted** (`SitePlannerApp` hides the inactive one with
  `display:none` to keep its map alive), so the DOM always holds TWO copies of this panel and the
  hidden one has no context. The inactive mode is now `inert` + `aria-hidden`, and each panel stamps
  `data-surface="planner"|"finder"` — **assert against the surface, never against page text.**
  **Flood-zone MEANING (B1235–B1237, B1241) — `floodZone.js` is the CLASSIFIER and
  `floodZoneCopy.js` is the WORDS, and that split is load-bearing.** In FEMA's NFHL both variants
  of Zone X carry `FLD_ZONE = "X"`; only `ZONE_SUBTY` separates the 500-year band (a real
  constraint — COH Ch.19's FFE rule, Fort Bend §9, Waller §A(8)) from the all-clear. `floodZone.js`
  turns a polygon into one of eight named variants, read on the site route by the mitigation
  ledger, the screening analysis and the map paint. **Its subtype vocabulary comes from FEMA's own
  layer-28 renderer, not from a guess:** five X subtypes beyond `0.2 PCT` are painted in the 0.2%
  class (`1 PCT DEPTH LESS THAN 1 FOOT` and `1 PCT DRAINAGE AREA LESS THAN 1 SQUARE MILE` alone are
  54k polygons nationally), and future-conditions and levee-reduced X are their own classes and are
  NOT the 0.2% band — do not narrow any of it back to a substring match. `floodZoneCopy.js` holds
  every user-facing sentence (the answer-first headline — `No mapped floodplain · FEMA Zone X
  (unshaded)`, the word **MAPPED** being load-bearing), the representable no-data / unreachable
  states (absence is never a falsy zone), the FIPS + FIRM-panel provenance, and the Layers-panel
  verdict. **⛔ It is reached ONLY by dynamic import** (the lazy hover path + `LayerPanel`'s own
  loader): a static edge from the boot path hoists all of it into the site-route chunk, which is
  what paid for this work shipping at all. Guard: the ui-audit harness **flood-group-verify**
  (64 checks on the real rendered panel + readout, fixtures read from the live FEMA service).
  **Point symbology + hover identify (NEW-1/NEW-2), read before touching how a layer paints or
  answers:** `mapSymbols.js` owns the `pointToLayer` circleMarker factory — a GeoJSON POINT built
  WITHOUT one gets Leaflet's default `L.marker`+`L.Icon.Default`, whose PNG never resolved under the
  bundler, so substations painted as broken-image glyphs labelled "Mark"; it also repairs
  `L.Icon.Default`'s paths as a safety net. `EL.featureLayer` is now constructed in exactly ONE
  place (`layers.buildFeatureLayer`) and the point-symbology guard test fails if that stops being
  true or if an `L.geoJSON` loses its `pointToLayer`. Hover answers split by how a layer PAINTS:
  vector layers get a tooltip whose wording is `featureHover.js` (registry `hoverIdentify` /
  `hoverTitle` / `hoverSource` / `hoverFields`, matching evidenceLayers' OSM copy); the
  RASTER-painted layers hold no features at all, so they ask the service via `rasterIdentify.js`
  (pure — capability gate, request, readout, debounced/cancelling controller, an honest state for
  every outcome) plus `rasterIdentifyMap.js` (leaflet wiring + the direct-then-proxy transport that
  gets past a no-CORS host). The planner reaches BOTH through the canvas, never Leaflet events.
  **⚠ Both hover paths are DELIBERATELY off the boot bundle** — `rasterIdentifyLazy.js` and
  `featureHoverAttach.js` are dynamic-imported (at layer-toggle time / first need) because the
  repo's bundle-budget audit (in the ui-audit folder) charges the Site route for anything static,
  and this feature breached two ceilings before the split. **Do not "tidy" either back into a
  static import.** Run that audit before pushing any map change — lint, tests and build can all be
  green while it fails, which is exactly how it went red in CI on PR #860.
  Canvas identify (B1092; tolerance fixed in the NEW-3 strand — `hitFeature` applies the caller's
  slop to polygon ring EDGES as well as lines, two-pass so an exact containment still wins, because
  containment-only gave a 70 ft easement band a click target its own width and no more):
  `vectorLayers.hitFeature` / `identifyRows` are the pure half,
  `vectorOverlay`'s `group.identifyAt` the accessor, `layers.identifyOverlaysAt` the opt-in gate
  (`cfg.canvasIdentify`) — the planner's SVG canvas owns every click, so this is how a tap there
  reaches the same answer the map finder's Leaflet popover gives. `nhdFlowline.js` — the USGS NHD FType → plain-English
  crosswalk (336 → "canal / ditch"), the universal channel fallback's decoder. The BKDD
  (Brookshire–Katy Drainage District) endpoints live in the shared GIS source registry like every
  other source; `detentionRules.js` owns the district-aware `resolveDrainageContext`.
- Site-plan overlay import (B72/B73/B747/B748/B749): `overlayPdf.js` (PDF+DXF raster, banded
  white-knockout, zoom-aware re-raster) + the shared overlay scale/trace math (`src/shared/overlay/`) + `overlayStorage.js`
  **⛔ B251136/B251137 — `chooseOverlayRasterScale` QUANTISES THE RE-RASTER SCALE TO AN OCTAVE
  LADDER AND ROUNDS **UP**, and `SitePlanner.jsx` CACHES the rungs. Read both headers before
  touching either.** Measured on the owner's real Bain overlay (1728 × 2592 pt, both his Bain
  plans carry the same PDF): a wheel notch is ×1.12 and the old rule retained a hi-res only within
  10%, so **every notch past the gate re-rendered the whole page** at up to 5461 × 8192 px — 179 MB
  of RGBA, on the main thread, a **1,738 ms freeze** against **0 ms** for the identical raster with
  the PDF backing removed. Three things not to undo: **(a)** the ladder rounds UP, so the chosen
  scale is `>= min(want, cap)` — the exact scale the old continuous rule picked — at every zoom and
  page size; that inequality is what makes this safe against a sheet the owner has deliberately
  zoomed into, and it is a PROOF, not a perceptual judgement (PERCEPTUAL-PARITY's relaxation is for
  detail he *cannot* see, which is the opposite case). **(b)** a zoom-out drops the DISPLAY, never
  the rung — the old code revoked, and a zoom sweep is out AND back by definition, so every return
  trip paid the whole render again. The cache holds the ENCODED blob (~3.5 MB), is LRU-bounded per
  overlay, and is the ONLY owner of an object URL. **(c)** the completion tick that retries a
  re-raster dropped by `hiresBusy` is GATED on real work having been done — ungated it is an
  infinite loop for an overlay whose bytes cannot be fetched. Guards, both COUNTS rather than
  durations: the repo-root `test/` suites **overlayRerasterCount** (which replays the pre-fix rule
  verbatim as a mutation check) and **rerasterProbe**, plus the ui-audit battery
  **zoom-reraster-arms** (`npm run perf:reraster`, `--assert` for the per-arm budget). ⚠ The
  battery needs a Supabase-configured build — with no config the client returns null WITHOUT
  issuing a request and the whole path dies silently; its `pdfDeliveryFault` refuses such a run.
  (Storage backup) + `dxf/` (worker parse via `dxf-parser` + entity→SVG render + true-units auto-scale)
  + `convertClient.js` (DWG→DXF through the B238 convert service, gated on `VITE_CONVERT_URL`).
  **The ONE overlay engine now lives in `src/shared/overlay/` (NEW-1; see its CLAUDE.md): the crop model (rect | poly, image px) for BOTH overlay systems, the placement math (geo + canvas — rotate/scale/align), and the raster sizing.** Do not add a second copy here.
  The crop model is shared: (rect | poly, image px);
  the Site tab's "Crop…" (`components/OverlayCropDialog.jsx`, B1838704) reuses the shared
  `ImageCropTool`, clips via `cropClipShapeScreen` → an SVG `<clipPath>` (what the export clone
  carries), and every write goes through `setOverlayCrop` (B2254629: Lock no longer gates crop — it only blocks direct map drags). The modal shell is the shared `CropModal` (portaled to `<body>`, B2254624) and the pre-placement crop opens in it too (B2448817). **Nothing the crop draws may exist outside `crop-canvas` (B2448816):** the rectangle's outline / grips go through the shared crop-chrome geometry module (cropChrome, under shared/sitePlans/lib — cut to the area, grips slide inward) — never position crop chrome from the raw screen rect again; guard: the verify-crop-contained ui-audit harness + the cropChrome unit test. `crop` is in
  the history signature — without it a crop edit is silently not undoable.
  **`overlayOrder.js` `visibleReferenceRows(sheetOverlays, origin)` (B2217648) is what the Overlays panel and View ▾ LIST** — the map-captured snapshot (`fromMap`) on a located plan stays in the data (print fallback, calibration) but is not a row; a hand-dropped image and an origin-less snapshot always show. Any redesigned panel must read the list through it. Guards: repo-root `test/` **visibleReferenceRows** + ui-audit **verify-map-snapshot-row**.
  **`overlayOrder.js` (NEW-2) is the ONE draw-order model for placed references** — a two-BAND
  split (`below` the plan, the unchanged default, vs an explicitly promoted `above`), the
  band-grouped array that IS the draw order bottom→top, the panel's front-first listing, and the
  identity-on-no-op reorder / promote mutators. Front/back move within a band; crossing the plan is
  only ever the explicit `aboveParcel` toggle, so "bring to front" can never silently lift a
  backdrop over the property line. Screen, References panel and right-click menu all read it.
- **⛔ The OVERLAYS panel (NEW-1 redesign, owner-approved 2026-10-08) — `components/OverlaysPanel.jsx` + `lib/overlayPanelModel.js`.** A list of rows (thumbnail · name · sub-line · eye · padlock · ⋯), ONE open at a time, whose open row has PLACEMENT / CROP / APPEARANCE. `OverlaysPanel.jsx` is presentational, module-scope components only, and every action is a callback into `SitePlanner.jsx`'s EXISTING overlay functions through ONE handler table (`overlayPanelHandlers`) — never a second implementation. `overlayPanelModel.js` is the pure rule set: **the scale ratio (1" = N') exists ONLY for a PDF** (`ftPerPx = S/72`); an image shows none, a DXF shows "Drawing units", the map capture has no Placement at all. **"Not scaled" is the additive field `unscaled: true`**, written only when the size came from the size-to-fit fallback (or after "Size to view"); every trace / match / typed scale writes `unscaled: false` (`scaledPatch`); an overlay with no field — every one that existed before — reads as SCALED, so nothing is migrated or rewritten, and a re-add (`reuseId`) carries the flag across. **The look (owner spec 2026-10-08, restyle after the first cut was rejected):** two sizes (`FONT_SIZE.control` / `.label`) in four (size, weight) pairs only — values/buttons/ratio 400, row NAME 500, section labels 600 uppercase, sub-lines 400; nothing at 700; ONE accent (Site green; selected Draws segment is a dark neutral) and no orange anywhere. **The layout reads the panel's OWN box, never window width:** the scale group MEASURES itself (ResizeObserver + the labels' natural width) and is one row of three or one column of three — never 2 + 1; **rotation (NEW-1, B2400416, 2026-10-21) is `Rotation · round DIAL · number box ▲▼` on one line with "Turn 90° counterclockwise" / "Turn 90° clockwise" under it (spelled out, never "left"/"right"): the dial is `RotationDial` (a `role="slider"`; 0° = up, clockwise positive; a drag writes live at 0.1°, Shift snaps 15°, ONE undo step per drag), the pure maths + the one-undo-step controller are `lib/rotationDial.js`, the two 90° buttons (`QuarterTurns`, B2382048) are ALWAYS one compact left-aligned row sized to their own text — never stacked — whose label steps down by a measurement of the row's own box (`data-label` full → short → compact → icons: "Turn 90° …" → "90° …" → no icons → the two arrows alone, never cut off); the ▲▼ are drawn SVG (the panel allows exactly two text sizes); everything works on a LOCKED overlay. CROP (NEW-2, B2400417) is a SWITCH in the heading (`overlay-crop-switch-<id>`): off = the heading alone; on = a picture of the sheet (outside dimmed, kept area dashed Site green, `CropPicture`) + Adjust (`overlay-crop-open`); there is NO Reset and no shape text — clearing the shape in the editor is the one reset. Switching off keeps the shape as `crop.off` (below), so on brings the same shape back; a switch ON with no shape opens the editor, and closing it leaves the switch off (the switch is derived from `hasCrop`).** **There is no "Non-standard sheet" note (B2382049; `o.sheet` data stays). Set scale (B2382050) is a Preset | Custom switch — Preset = the dropdown (no Custom entry, "Choose a scale" placeholder), Custom = ONE short fixed-width box `1" = [N] '` (the ' always visible beside it; warning only on unreadable text, which stays until edited / Esc) read by `overlayScale.parseTypedScale`; which segment opens first is `overlayPanelModel.scaleEntryPlan`; root constraint #35.** Guards: repo-root `test/` **rotationDial**, **overlayCropOff**, **overlaysPanelRender**, **overlayScale**; e2e **overlay-dial-crop-switch**, **overlay-turns-scale**; live ui-audit **verify-overlay-dial-crop-live** (V1826720); older crop harnesses drive the panel through the shared overlay-crop-panel helper in the ui-audit lib folder. Reorder = `overlayOrder.js` `moveOverlayStep` / `dropOverlay` (within a band; HTML5 drag on a fine pointer only, ⋯ → Move up/down is the touch and keyboard path); **`storage.js` `contentSig` now includes the overlay ID ORDER** — it used to sort by id, so a reorder-only change was invisible to the boot re-push and never reached the cloud. A row may carry `foreign: { planName }` (an overlay added on another plan; rendered hidden-style, eye → `onShowForeign`) — no data source exists yet. The four trim-by-feet fields live INSIDE `OverlayCropDialog.jsx`; there is ONE crop control. Like the Parcels panel, the header has no detach icon (double-click the header floats/docks it). Guards: repo-root `test/` **overlayPanelModel**, **overlaysPanelRender**, **overlayReorderSync** (red on the pre-fix `contentSig`); ui-audit **verify-overlays-panel-layout** (240/300/400/520/620 docked + floating + phone; asserts the (size, weight) pairs, no orange, row-or-stack, open row fits at 1366×768; `--broken --expect-red` proves it can fail) and **verify-overlays-panel-behaviour**.
- **⛔ PARCELS IN FRONT (B2370480, owner constraint #27) — the ONE mode-gated exception to the model below, in `mapStack.js`'s "PARCELS IN FRONT" block.** `parcelsOnTop(state)` (Land panel open · Pick county lots · Draw / Split / Combine / Edit corners) → `SitePlanner.jsx`'s `parcelsFront`: the plan's setback rings + parcels (`parcelTierNodes`, built once) render after the annotations (`data-parcel-tier="top"`, a `data-parcel-tier-slot` marker left in the normal place), the county lots on offer mount in `parcelPickPane` hosted in an in-SVG foreignObject under them (`data-parcel-pick-band`; `parcelDisplay`/`parcelLotLabelLayer` take an optional `pane`), the GIS line host sinks (`lineHostZ`), and `handleIdentifyCapture` routes every Pick-county-lots press to `onBgDown`. Render order only — nothing stored; `exportSheet.js` puts the group back in its slot (PDF-PARITY). Guards: repo-root `test/` **parcelsInFront**; e2e **parcels-in-front** (red on 654ca32); live V1801008 (passed 2026-10-20, ui-audit **verify-parcels-in-front-live**).
- **⛔ NEW-1 (B1205) — `mapStack.js` is THE map stacking model, and it is the ONLY place a draw
  order is decided.** Bottom→top: basemap → references → GIS AREA fills → parcel → setback →
  elements → references promoted above the plan (B1198) → **GIS AREA fills the user LIFTED** →
  GIS LINE strokes → labels → handles.
  **The load-bearing rule: FILLED area layers draw UNDER the site elements; LINE/stroke layers draw
  OVER them** — a contour crossing a building is a hairline, a floodplain fill over one buries it.
  That DEFAULT is what makes the owner's contours-behind-buildings case a zero-interaction case, and
  it must stay the default. There is deliberately **no mode, no shortcut and no FREE-FORM z-order UI**
  (no front/back, up/down, or per-layer number). Every GIS source **declares**
  `role: "area" | "line" | "point"` — never inferred at render time — and a service publishing both
  splits via `roleLayers` (FEMA zones vs boundaries; BKDD watersheds vs streams/BFE): one panel row,
  one opacity, one lift toggle, two export requests.
  **⛔ THE ESCAPE HATCH IS *ORDER*, NOT OPACITY — this CORRECTS what B1205/B1206 shipped saying.**
  Opacity cannot fix occlusion for a layer drawn UNDER the elements: the building still covers it, and
  fading it only dims the parts you could already see. So the hatch is the per-layer **"Show above
  plan"** toggle (`abovePlanControl`, default OFF, one implementation and one `aboveRow` call site for
  all three row shapes) which lifts ONE layer's AREA half into the `gisAreaFront` tier. Per-layer
  opacity stays (B1206, same `opacityControl` everywhere) — it is just not the answer to "I can't see
  through my plan", and no copy may say it is. Persisted per plan as the site model's own sparse
  `layerAbove` map (`layerPrefs.js`, the `layerOverrides` twin) with its own undo frame.
  **The trap to know:** Leaflet keeps every pane inside `_mapPane`, which carries the pan transform and
  so its own stacking context, so **no z-index can lift a pane above the planner SVG** — the line band
  is hosted OUTSIDE the map in a sibling box (`geoTopWrapRef`/`geoTopPaneRef`). **The LIFTED band is
  hosted differently ON PURPOSE:** a `<foreignObject>` at the plan SVG's `data-gis-front-band` anchor
  (`geoFrontWrapRef`/`geoFrontPaneRef`), because a fill dropped into the map-top host beside the line
  band would paint over the labels and over B1197's handle layer and hide the grip you are dragging.
  ⛔ Do not "simplify" it back into the top host. All three hosts' transforms are written in the SAME
  statement as the wrap's (VIEWPORT-STABLE; `setWrapTransform`), and the in-SVG one additionally
  counter-translates the registration shift so it is not nudged onto the imagery twice.
  Because Leaflet fixes a pane at construction, flipping the lift is a tear-down-and-re-add:
  `bandKey` (resolved PANE NAMES, not the flag, so a surface that collapses the bands rebuilds
  nothing) drives it, through the ONE `release` helper the toggle-off path uses.
  PDF-PARITY lives in `exportSheet.js`, which composites the same THREE bands — `under` at the
  backdrop anchor, `front` INTO the plan's own `data-gis-front-band` group, `over` after the plan.
  **Known deviation:** the handle layer is inside the plan SVG, so the LINE band paints above it —
  bounded (the band is `pointer-events:none`, and a hairline crossing a handle can never make one
  unreachable) and owned by **B1208**; do not "fix" it by moving the handle group out of the SVG
  without moving its pointer plumbing, or every drag loses the moves that pass over a handle.
  Guards: the repo-root `test/` suites **mapStack**, **layerAbovePlan** and **layerOpacityCoverage**,
  plus the e2e spec **map-layer-stacking** (whose lift case is mutation-checked three ways: hosting
  the band outside the SVG, rendering it after the handle layer, and dropping its transform mirror
  each turn it red).
- **⛔ `lib/aerialSnapshot.js` (NEW-1, 2026-11-05) — A LOCATED PLAN'S STORED MAP SNAPSHOT ("Aerial backdrop", `fromMap`) IS THE AERIAL, SO IT IS DRAWN UNDER THE GIS FILLS, NEVER OVER THEM.** With the Map Base set to Off it used to be an SVG image in the planner canvas — above the backdrop map — and painted an opaque rectangle (the capture's size, ~1.8× the parcel on the owner's Academy plan) over every GIS AREA fill: "Zoning and Future Land Use cut out around the site". Now `snapshotHostedInMap` (located + basemap off + aerial shown) → an `L.imageOverlay` in `mapStack.PANE_SNAPSHOT` (z 150, under every GIS pane; bounds from `snapshotBounds`, the same feet → lat/lon round trip as the tiles and the print), and `renderSheetOverlay` asks `snapshotDrawnInCanvas` (an UNLOCATED plan keeps the canvas image — no backdrop map, no GIS layers). The print already laid the snapshot under the GIS overlays; only the screen drifted (PDF-PARITY). Do not draw a located plan's snapshot in the SVG again. Guards: repo-root `test/` **aerialSnapshot**; e2e **gis-fill-under-snapshot** (pixel arm with a known-good fill-off reading; red on the pre-fix canvas image); live ui-audit **diagnose-gis-fill-hole** (point-by-point service truth vs loaded vs painted).
- **⛔ GIS AREA FILLS PAINT OVER DEFAULT-BAND REFERENCES (B2671190 ×2, 2026-11-06 — the second pass; the snapshot fix above did not fix the owner's case).** With the Map Base ON his Academy plan still showed a crisp unfilled rectangle reaching east toward the airport: a hand-dropped PNG reference (added 2026-10-29), drawn in the plan SVG, ABOVE the backdrop map that hosted every area pane. The first session had ruled it out as "references sit above fills by design" — that design was the defect. Now `mapStack.MAP_STACK` is basemap → reference → gisArea → parcel …, and the area panes (`PANE_AREA`, `PANE_AREA_LABEL`) are mounted in a foreignObject at the plan SVG's `data-gis-area-band` anchor (`AREA_BAND_ATTR`) rendered right after `overlayBands.below` — hosted exactly like the lifted band (pane-transform mirror, gesture mirror, `anchorInverseCss`), `pointer-events: none` on every descendant (stylesheet). The export inserts the `under` band INTO that group (`exportSheet.js` `underInto`; PDF-PARITY). A reference promoted "above the plan" still clears the fills; the fills still sit under the parcel and elements. Trade-off, said plainly: a dropped site-plan drawing is now tinted where a fill crosses it. Guards: repo-root `test/` **gisFillOverReference**, **mapStack**, **anchorInverseHosts**; e2e **gis-fill-over-reference** (Map Base on, opaque reference, building + sheet order; red on 49b8f32, `got 0,255,0`), **map-layer-stacking**, **gis-front-band-pan** (default band glued to the basemap at rest and mid-pan); live ui-audit **diagnose-gis-fill-hole** `--ref` (the owner's exact PNG placement; 257/365 unpainted on 49b8f32).
- **Wide-zoom political boundaries (NEW-1):** `adminBoundaryGate.js` is the leaf gate (imports
  nothing) — the zoom CEILING (`ADMIN_BOUNDARY_MAX_ZOOM` 12 — revised 2026-09-29 from 7: state lines survive through metro zoom, countries still stop at 7; parcels draw at 14) plus the cached dynamic import, exactly
  the `terrainGate.js` / `terrainLazy.js` shape and for the same reason. **This is the repo's first
  MAX-zoom gate** — every other one (`TERRAIN_MIN_ZOOM`, the registry's `minZoom` fields) means
  "appear once you zoom IN"; boundaries are orientation furniture and run the other way, so don't
  "fix" it to a minZoom. `adminBoundaryData.js` is the pure half (delta decoder + `ADMIN1_MIN_ZOOM`,
  the inner band where states join countries) — split out because a module that imports Leaflet
  needs a `window` and can then only be tested through a browser. `adminBoundaryLayer.js` is the
  Leaflet glue: own pane at z-index 250 (above tiles, BELOW the vector-overlay pane and every
  marker), `pointer-events:none`, canvas renderer, and it stamps `data-levels` on its pane so a
  headless check has something of ours to assert against. **⛔ Nothing on the boot path may
  static-import `adminBoundaryLayer.js`** — the Site route had 0.7 KB of budget headroom when this
  landed, so a static edge is a CI failure, not a style note. The geometry is
  `public/geo/admin-boundaries.json` (Natural Earth 1:110m, simplified + delta-encoded by the
  repo-root script build-admin-boundaries), a public/ ASSET rather than a module precisely so it is
  charged against no bundle budget. 1:110m admin-1 is **US states only** — Canada and Mexico read at
  the country level by design. Guards: ui-audit verify-admin-boundaries (network + rendered pixels)
  + the repo-root `test/` suite adminBoundaries. From zoom 8 the state lines come from a second asset,
  `public/geo/admin1-detail.json` (NE 1:10m US, coast edges stripped so no state line cuts the bay,
  shared borders drawn once; build script build-admin-detail), fetched lazily only then; `admin1Style`
  makes the line quieter at 8+ and again at 10+.
- **City names (NEW-2, 2026-09-29):** `placeNamesGate.js` (leaf: band 3..13, gone at 14 = parcels; cached
  dynamic import) · `placeNamesData.js` (pure: tiers, opacity, collision `layoutLabels`) · `placeNamesLayer.js`
  (own canvas in pane z260, below the vector pane, `pointer-events:none`, stamps `data-count`/`data-names`).
  Own dataset (`public/geo/place-names.json` backbone + `place-names-towns.json`, fetched only at zoom >= 9;
  build script build-place-names) rather than Esri's Boundaries_and_Places tiles, which draw their own
  boundary lines and would double up with the state outlines. The finder's "City names" row is separate
  from "Road names" (Esri transportation tiles, no city names). Guards: the repo-root `test/` suite placeNames
  + ui-audit verify-place-names.
- **Zoom animation of our own canvases (B1978048):** Leaflet animates tiles/markers/its renderers on a zoom but NOT a hand-drawn
  canvas (it moves state to the end view at once; its stock canvas renderer CSS-scales the bitmap 1×→2× then snaps back). Both
  lazy layers (`placeNamesLayer.js`, `adminBoundaryLayer.js`) therefore draw their own canvas and re-project every frame through
  `zoomTracker.js` (lerp start view → end view, progress read off a hidden `leaflet-zoom-animated` sentinel so it shares the tiles'
  exact transition clock). Never put a text/hairline canvas in a Leaflet-scaled renderer, and never transform these canvases.
  Labels also fade and use collision hysteresis (`layoutLabels` `held`; priority is order-independent). Guards: test/placeNames +
  the mid-zoom sections of verify-place-names / verify-admin-boundaries (real Leaflet markers as the oracle).
- **B1141/B1142 — the drawing is WELDED to the basemap, and the weld is MEASURED, never assumed.**
  `mapLock.js` (`tileNwFeet` / `basemapWrapPoint` / `registrationShift` / `sanitizeShift`) computes how
  far the drawing sits from the imagery; `SitePlanner` applies it as a CSS translate on the SVG canvas
  **only**. Three rules to keep: **(1)** the reference is a real TILE's rect versus its own z/x/y — not
  `map.project`, which disagrees with the raster lattice by a scaled sub-pixel at any fractional zoom
  (the fallback to the projection is only for "no tile on screen"). **(2)** never fold the shift into
  `view.offX/offY` — that would destroy the exactly-reversible pan V478 proved, and `p2f` reads the
  SVG's own bounding box so the CSS translate already corrects the readout AND every placed point.
  **(3)** the re-centre trigger must watch the map CONTAINER (`clientWidth/Height` + a cached-size
  check), not just the canvas: the container is the canvas plus twice the overscan, and the overscan
  follows the DRAWABLE ELEMENT COUNT, so it resizes on its own as culling changes with zoom (measured
  121 px of misregistration when unwatched). A shift larger than the sub-pixel range is a MODEL
  disagreement — `sanitizeShift` refuses it loudly rather than masking it. The shift is deliberately
  NOT mirrored into the export (the sheet has no such quantisation). Gate:
  the repo-root ui-audit harness **diagnose-pointer-accuracy** (tile-grid ground truth, readout AND placed point, three
  device pixel ratios incl. 2.15) plus **diagnose-map-lock** — both repo-root ui-audit harnesses.
- **`landingView.js` (NEW-1) — WHERE THE MAP OPENS, derived from the user's own sites, never hardcoded
  and deliberately NOT a setting.** `MapFinder` used to create its map on `COUNTIES_MAP.harris`, so every
  account on earth opened over Houston. Three cases: no located sites → the continental US · one → that
  site's AREA · more → the DENSEST CLUSTER (single-linkage at 50 mi, most sites wins, ties to the most
  recently updated). **Single-linkage is load-bearing, not incidental** — Waller to Chambers is further
  apart than the threshold and only chains into one market through the Harris sites between them. The fit
  is padded, FLOORED and clamped to a metro/county ceiling, so a single project never opens on its own
  lot. Pure (no Leaflet/DOM/React). The component's half is two latches — `landedRef` / `userMovedRef`,
  keyed on real INPUT rather than Leaflet's `movestart` (our own `setView` fires that) — so a
  late-arriving cloud site list can never yank a camera the user is already driving. The Layers-panel
  jurisdiction reads `counties.countyForView`, **never `candidateCountiesForPoint(...)[0]`**, whose
  out-of-bbox answer is harris-first BY CONTRACT for click routing. Guards: the repo-root `test/` suites
  **landingView** (incl. a source guard against a fixed county coming back) and **counties**, plus the
  ui-audit harness **verify-landing-view** (three seeded accounts in a real browser).
- `tileBudget.js` / `tileLifecycle.js` — the tile-memory tier: pure policy (overscan, keepBuffer,
  cache ceiling, which tiles to evict) and the Leaflet-bound half (`preserveTilesAcrossSetView`,
  `boundTileCache`/`capTileCache`, `releaseLayer`). **NEW-6: `MapFinder` uses them too now.** The
  Map view has its OWN Leaflet map and is never unmounted (`SitePlannerApp` hides it with
  `display:none` on purpose), so its two tile layers and its DUPLICATE set of esri raster overlays
  grew for the whole session; they are now capped, squeezed while hidden, and the 45 s overlay
  re-probe is gated on `visible`. All EVICTION — nothing caps what is drawn, and `detectRetina` is
  untouched (the owner has ruled out any retina downgrade).
- Export path (B1042): `exportSheet.js` is the ONE home for PDF/PNG/KMZ sheet composition, the
  B839 aerial tile Stitcher, and GIS raster/vector capture. It is **loaded on demand** (dynamic
  `import()` from `SitePlanner.jsx`, warmed when the File menu opens) and reads planner state
  through a `ctx` object rebuilt per call — add a key there, never a new closure capture. Its
  helpers (`printSheet.js`, `sheetFurnitureLayout.js`, `exportStyle.js`, `imagePdf.js`,
  `kmzExport.js`, `overlayVectorSvg.js`) must NOT gain a static importer on the boot path or
  they rejoin the critical-path chunk. **NEW-1 — `sheetFurniture.js` is SPLIT in two, and the
  reason generalises:** the canvas needs the drawing PRIMITIVES (scale bar, north arrow,
  metrics, `screenFurniturePlates`, `calibBadgePlacement`) so those stay on the boot path,
  while the corner-placement + SVG-string tier the SHEET alone uses moved to
  `sheetFurnitureLayout.js`. A module imported by BOTH the boot path and a lazy chunk is
  hoisted whole into their common ancestor — tree-shaking drops unused exports, never
  exports used by a sibling chunk — so a mixed-tier module silently charges the Site route
  for export-only code. Split by tier, don't hope for shaking.
  **NEW-1 (B2127664) — EDITABLE MARKUPS IN THE PDF.** The compose screen's "Flatten markups" toggle (OFF by default,
  per-USER in `profiles.prefs.exportPrefs`, never per plan) makes `exportPDF` lift every annotation-class node
  (neutral markups · callouts/text boxes · measurements — NOT easements/encumbrances/utility routes, which are site data)
  out of the cloned SVG AFTER `restyleExportClone` (`annotationExtract.js`) and write it as a native PDF annotation with an
  explicit appearance stream (`pdfAnnotations.js` pure core → `imagePdf.jpegToPdf({annotations})`). The geometry is the
  clone's own primitives, never re-derived from the model, so the picture and the annotations cannot drift. Base-14
  Helvetica (not embedded), `Tz`-squeezed to the browser's measured widths — read the B2127664 deviations list before
  promising more. Guards: repo-root `test/` suite **pdfAnnotations** (incl. a second-library round-trip) + ui-audit
  **verify-pdf-markup-annotations** (real compose flow, poppler render parity, known-good arm).
  **NEW-1/NEW-2 (2026-10-19, B2264688 ×2 / B2326896) — WHAT STAYS IN THE PAGE (SUPERSEDED 2026-10-20 by the B2384528 paragraph below; kept as history).** `annotationExtract.js` pins an object into the page only if it is
  BEHIND the plan (`behindEls`) or later page content overlaps it in plan space (top-down pass); a promoted reference or lifted GIS layer never
  pins a markup, an empty `data-gis-front-band` is not content. Buildings (`isBuilding`, with their `data-label-for` nodes) lift too, as
  `family: "building"` Polygons — held to the stricter flattened-picture bar (references/GIS DO pin a building), and a parcel acreage chip over
  a lifted building travels inside its appearance. **B2352496 — a building and its corner bump-outs are ONE annotation:** `lib/buildingOutline.js` (`bumpOutsOf` = the grading layer's pad-member rule, `buildingOutlineRing` = the one union ring, taken in the host's own frame) feeds the Polygon's vertices; every bump-out node is a member of its host's entry in `annotationExtract` (judged per member at its own paint position, written in last-member order); a stacked label's tspans stay separate lines in the appearance. Guards: repo-root `test/` **buildingOutline**. Guards: repo-root `test/` suite **annotationExtract** (a fake SVG DOM, since vitest has no jsdom)
  + ui-audit **verify-pdf-annotation-pins** (local preview or signed-in live).
  **⛔ B2326896 ×2 / B2384528 (2026-10-20, owner constraint #28) — EVERY DRAWN SITE ELEMENT IS AN ANNOTATION, AND /Annots ORDER IS THE STACKING.** The old pin test compared axis-aligned BOUNDING BOXES; on a real plan the buildings and truck courts are ROTATED, so every tilted court's box swallowed its building and all five buildings on the owner's Bain plan stayed in the page while the square throwaway harness passed (WRONG-CASE). Now `annotationExtract` lifts every element (one per building + bump-outs, one per dissolved road network — `data-road-cluster` — one per other element, labels inside their own element), every markup kind (easements too), callout and measurement, writes them in paint order, and judges overlap on REAL painted shapes (clipper intersection, `paintShapes`/`shapesOverlap`). The ONLY pin left: an element a reference drawing promoted above the plan really covers (+ the cascade, + a multi-member straddle); each returns in `pinned` with its reason and rides the export's warning list. A lifted GIS band pins nothing (frame-wide raster) and is said in `notes`. A parcel acreage chip a lifted element would cover is its own "Parcel label" Stamp. A gradient fill (pond water) is written as its mean colour. Guards: repo-root `test/` **annotationExtractRealistic** (replays the real export clone of the ui-audit lib **realisticSitePlan** — the owner's Bain plan + extras — through the extractor; RED on the pre-fix code; regenerate the fixture with ui-audit **capture-realistic-clone**) + ui-audit **verify-pdf-site-elements** (real compose flow, every type, the second-library (pdfjs) read-back, the MuPDF drag proxy in ui-audit tools **pdf_move_proxy**, parity; `--live`). **B2431296/B2431297 (owner constraint #33): NO `/Contents` on a site element, parcel label or measurement and no `/T "Planyr"` — PDFium (Chrome/Edge) pops its own 200×200 note box for any non-empty `/Contents` and ignores a file's `/Popup`; only a typed markup comment / a callout's text is `/Contents`. A translucent measurement fill is appearance-only (Bluebeam paints a stored `/IC` solid on rebuild) and the page carries a `/VP` + `/Measure` scale (`pdfAnnotations.viewportEntry`). Guards: repo-root `test/` **pdfHoverAndRegen**; ui-audit **verify-pdf-hover-popup** (headed Chrome under xvfb; known-good arm).** **B2143584 ×2 (NEW-2):** measurements are native — `/IT /PolygonDimension | /LineDimension | /PolyLineDimension` + a `/Measure` RL dictionary (`measureDictFor`: the sheet's ft-per-point, Planyr's units read off its own label) so a viewer that regenerates on a move redraws the value; a count stays a Stamp (moved, never redrawn).
  **B2143584 — the `/AP` stream is only what shows UNTIL a viewer REGENERATES the annotation (Bluebeam/Acrobat on any edit), so every key a regenerating viewer reads must agree with it:** FreeText `/C` is the box FILL (border in `/DA` `RG`, never `/IC`), a translucent fill's opacity is `/CA`, a cloud's `/BE /I` comes from the scallop pitch, a two-point measurement's number is its `/Cap` caption. Guards: **pdfAnnotations** (regeneration block) + ui-audit **verify-pdf-annotation-regeneration** (MuPDF `update()` drift).
  **B765985 — the compose screen.** Picking a print frame no longer downloads straight off the
  canvas: `components/PrintCompose.jsx` (also lazy, its own chunk, warmed alongside the export
  chunk) is a dedicated full-screen surface for paper size (incl. ARCH C/D, ANSI C/D),
  orientation, an explicit engineering scale, the title block and content toggles — the on-canvas
  step now only positions the crop. `lib/printScale.js` (pure, boot-safe, no deps) is the
  scale math: the standard scale ladder, a scale's implied frame footprint
  (`frameFootprintForScale` = plan-box inches × ft/inch), and the never-silently-rescale fit
  check (`checkScaleFits`). PDF-PARITY here is structural, not asserted: `exportSheet.js`'s
  `buildComposedSheet()` returns the ONE `sheetSvg` string that both the compose screen's live
  `<img>` preview and the final PDF's rasterizer consume — there is no second render path.
  `exportLabelScale.js` (B1085) is the ONE place that decides what scale the
  LABEL tier reasons at: the view on screen, the SHEET's own px-per-foot on an export pass — so
  declutter/LOD/collision, label sizes and stroke-zoom are a function of the plan and the paper,
  never of the live zoom. It IS on the boot path (SitePlanner imports it statically, ~1 KB pure). PDF-PARITY: `printMetricPairs`/`printStormwaterBars` deliberately stay in
  `SitePlanner.jsx` so screen and sheet read one derivation.
  **⛔ A MODEL-BUILT EXPORT DECIDES ITS OWN CONTENTS; A CANVAS DISPLAY TOGGLE NEVER DOES.**
  `kmzExport.js` gated its dock doors on `settings.showDocks`, the View ▾ checkbox — so a
  drawing-legibility preference decided what went into a file for a different audience, and turning
  dock doors on to check a layout silently changed an exported KMZ; the map viewer's multi-site
  export read each SAVED site's remembered toggle, so one file varied with what someone had on
  screen when they last saved plan #3. `settings` is read there only for MODEL facts (door
  o.c./width, building rules) that determine where a thing physically is.
  **⛔ AND DOCK DOORS ARE NOT AN OPTION — THEY ALWAYS EXPORT, as ONE RUN PER DOCK SIDE (a line
  carrying the door count and the o.c.), never a point per door.** Two owner decisions, and they are
  different from each other: the reported defect was the PIN PER DOOR (on his Bain plan, 209 of 261
  placemarks — Google Earth opened under a blanket of pins), and the fix for that is the RUN; once
  the runs existed he chose the DEFAULT — *"Dock doors should just show by default in the export —
  that's the behaviour I want, not an option to turn on… no toggle."* So there is deliberately **no
  `includeDockDoors` flag and no checkbox**: a flag nothing sets is a decision left half-made, and it
  is exactly what a later session would wire a control to. The **dimension lines are a different
  question** and stay off (`includeDimensions`, default OFF since B684 — *"they clutter a 3D
  walkthrough"*); the owner declined a control for those too. On the CANVAS the same rule already
  holds — "Show dock doors" left the View menu, and `contentVisibility.normalizeRetiredToggles`
  restores a plan saved with `showDocks: false` so retiring the control cannot strand one.
  **The deliberate exception, which is not the same defect:** `exportSheet.js`'s PDF/PNG path CLONES
  the live `<svg>` and so inherits every display toggle by construction — that artifact is the
  drawing on paper for the same audience, set by the user while looking at the drawing they are
  printing. Guards: the repo-root `test/` suites **kmzExport** (which sweeps every model-built export
  module for the whole class of toggle rather than for the dock doors alone, and pins that no
  dock-door flag exists) and **contentVisibility** (which sweeps the workspace for anything that
  WRITES the retired toggle, so the control cannot return by the side door).
