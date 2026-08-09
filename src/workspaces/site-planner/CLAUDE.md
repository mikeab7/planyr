# Site Planner workspace — folder pointer

Site yield analysis + layout. The mature workspace. Root rules in `/CLAUDE.md` still apply;
deep internals are in `/docs/REFERENCE.md` (Site Model, map-layer system, Supabase, GIS).

**Entry points**
- `SitePlannerApp.jsx` — workspace root (lazy-loaded chunk).
- `MapFinder.jsx` — map/site picker. `SitePlanner.jsx` — the hand-rolled SVG planner canvas.

**Key `lib/` (canonical, read-before-edit)**
- `siteModel.js` — the per-plan schema (`createSiteModel`, `SITE_MODEL_VERSION`); read via
  selectors, persist via `storage.js`. **Additive only** — bump the version, extend `migrate`.
- `storage.js` — thin model layer (migrate on read, merge+renormalize on save).
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
- `layers.js` + `components/LayerPanel.jsx` — map-layer system; `layerPrefs.js` (per-site Layers-panel
  toggle memory — NEW-1, sparse on/off overrides restored on open + persisted on toggle); `coverage.js` (coverage engine);
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
  white-knockout, zoom-aware re-raster) + `overlayScale.js` (scale/trace math) + `overlayStorage.js`
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
  **`overlayOrder.js` (NEW-2) is the ONE draw-order model for placed references** — a two-BAND
  split (`below` the plan, the unchanged default, vs an explicitly promoted `above`), the
  band-grouped array that IS the draw order bottom→top, the panel's front-first listing, and the
  identity-on-no-op reorder / promote mutators. Front/back move within a band; crossing the plan is
  only ever the explicit `aboveParcel` toggle, so "bring to front" can never silently lift a
  backdrop over the property line. Screen, References panel and right-click menu all read it.
- **⛔ NEW-1 (B1205) — `mapStack.js` is THE map stacking model, and it is the ONLY place a draw
  order is decided.** Bottom→top: basemap → GIS AREA fills → references → parcel → setback →
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
- **`buildingFloodExposure.js` (B1207) answers "is my building in the floodplain?" as a NUMBER** —
  per footprint: overlap by area and percent, the governing zone and its BFE. It **reuses** the
  B707/B712 `zonesFromFeatureCollection` + `gridIntersect` + `zoneWaterSurface` chain (never a second
  derivation, so it cannot disagree with the mitigation ledger's flood elevation), and it keeps four
  distinct honest-unknown states — `not checked` / `UNKNOWN` / `none mapped` / the answer — so a
  failed or un-run query can never read as a clean 0%. Rendered inside the Yield → Buildings
  `<Collapse>`, which is why it costs the default view nothing (PANEL-BREVITY).
- **⛔ NEW-1 — A MANIPULATION HANDLE IS CHROME: it belongs in the ONE always-on-top handle layer,
  never in the content pass that draws its object.** `SitePlanner.jsx` renders every handle set
  (`handleNodes`, `parcelHandles`, `elPolyHandles`, `markupHandles`, `calloutHandles`,
  `measureHandles`, `overlayChrome`, the add-nodes) from a single `data-handle-layer="1"` group
  that is the LAST child of the feet-space transform. In SVG a later sibling both paints over and
  hit-tests ahead of everything before it, so that one position buys visibility and grabbability
  together — there is no second hit-test rule to keep in sync. Authoring a grip inline next to its
  object is what buried the reference overlay's corner grip under the parcel line (ungrabbable, so
  the overlay could not be resized from that corner) and had the same trap waiting under the
  callout and measurement grips. Guards: the repo-root `test/` suite **handleLayerOrder** (source
  order + the ex-inline drag-starters) and the e2e spec **references-handle-layer** (real render:
  every grip answers `elementsFromPoint`, with parcel geometry proven to be stacked underneath).
- **Colorado (NEW-5/7/8):** `coloradoRegions.js` is THE guard — a network-free site→state
  resolution (it must hold when every GIS endpoint is down, which is exactly when a site falls
  through to a default), the four drainage regimes (MHFD covers 6 of the 9 target counties;
  Larimer, Weld and El Paso each say outright they are NOT MHFD), the CWCB 2 CCR 408-1 statewide
  floodplain floor (stricter than FEMA on freeboard, critical facilities and floodway rise), and
  the `CAPABILITIES` matrix that makes an unwired capability render a NAMED "not available in
  Colorado yet" state. `computeRequiredDetention`'s `siteState` guard is its enforcement point and
  runs **before** the acreage check and the authority lookup, so a Texas authority forced onto a
  Colorado site still cannot price. `drawdownStatute.js` turns the existing drawdown number into
  C.R.S. 37-92-602(8) — and never reports "pass", because the screening figure is an optimistic
  lower bound. Colorado counties live in `counties.js` under `co_`-prefixed keys (both states have
  an El Paso and a Jefferson). **Any change here is gated on the Texas golden-master suite under test/.**
  **B1105 — `mhfdDetention.js` is the MHFD engine and the `volume-curve` ruleType.** WQCV (water
  QUALITY) and EURV (FLOOD volume) are **distinct components**, each with its own role, inputs,
  evidence state and citation — never one merged number — plus the routed 100-yr. **The coefficients
  are deliberately `null` / `transcribed:false`:** every primary MHFD host is egress-blocked here and
  two secondary reads of the EURV memo returned DIFFERENT coefficient sets, so the components name the
  document each needs instead of computing a volume (`OWNER-TODO.md` is the unblock). The MATH is real
  and tested against synthetic curves, so transcribing is a DATA edit — never fabricate a coefficient,
  and never a `rateAcFtPerAc` (a full-spectrum volume has no per-acre rate). **⛔ SCOPE: MHFD ONLY.**
  Larimer, Weld and El Paso keep the hard guard, enforced TWICE on independent facts — the
  `computeRequiredDetention` seam is fail-CLOSED (needs a positive `coRegime === "mhfd"` **and** an
  injected `coDetention`; anything else runs the original guard byte-for-byte) and
  `computeMhfdDetention` re-checks county membership itself. The repo-root coloradoGuard suite's
  scope-boundary test goes red if anyone generalises it. `reconcileMhfdDrawdown` borrows
  `drawdownStatute.js`'s vocabulary (`fail`/`not-ruled-out`/`unknown`) and may **never** say
  "complies" — two modules contradicting each other about one statute on one screen is the failure it
  prevents. **B1129:** the regime falls back to the plan's SAVED county when GIS is down (identified
  county still wins) — the guard must hold with every endpoint dead, which is when defaults bite.
  **B1127, the trap to remember:** `yieldVerdicts.detentionVerdict` had NO branch for
  `kind:"unavailable"`, so it fell to `loadingRow` and every Colorado site read "Detention: checking
  flood data" forever while 26 unit tests and the bundle harness passed. **A new `kind` with no render
  branch is a silent spinner** — wire the branch in the same commit. Guards live in ui-audit:
  verify-colorado-guard (bytes, both directions) + verify-b1105-mhfd-panel (pixels, asserted on the
  `data-surface="planner"` host's innerText, so a zero-height or hidden node fails).
- **⛔ B1189 — AN EFFECT THAT WRITES STATE MUST DEPEND ON VALUES, NEVER ON A STATE OBJECT'S IDENTITY.**
  The drawing↔basemap registration layout effect listed `[view, size, origin, geoOverscan]` while reading
  only NUMBERS out of the first three. `setSize`'s updater ALLOCATES when the measured width differs from
  the state it is applied to, and React re-applies a retained updater against its base state on every
  later render — so a panel close left every render minting a fresh `{w,h}` holding the SAME numbers, the
  effect re-ran on identity alone, its `setRegShift` scheduled another render, and fifty round trips later
  React aborted the whole planner to the error boundary. Depend on `view.ppf/offX/offY`, `size.w/h`,
  `origin.lat/lon` — and **guard a dispatch rather than relying on a no-op updater**: a `setState` that
  returns the same value is still a DISPATCH, and React only skips scheduling it when the fiber has no
  other pending work, which during a panel reflow it always has. **Do NOT re-chase this as a `setSize`
  ping-pong** — that lead was measured and refuted (both writers reported the same width; five dispatches
  across a fifty-render loop), and quantising `size` would put a whole pixel of slop into view maths the
  pointer-accuracy harness asserts to a quarter of a pixel. Guards: the e2e spec **panel-escape-race**
  (the real race, proven red on pre-fix) plus the repo-root `test/` suite **errorBoundaryRecovery** (the
  boundary's bounded self-heal, which is the second, independent half — a measurement loop may never be
  able to take the planner down).
- **B1122 — the basemap transform MUST be written in a LAYOUT effect.** The SVG feet-frame and the
  Leaflet basemap are driven from ONE value (`view.offX/offY/ppf`); they never disagreed about WHERE
  to be, only about WHEN. Writing `wrap.style.transform` from a passive `useEffect` paints one frame
  of separation per pan frame — the owner's "grab the map and sling it and the buildings move
  separately and then sling back". Keep EVERY `wrap.style.transform` write pre-paint, and do NOT
  "fix" a recurrence by shortening the 160 ms commit debounce: that narrows the window without
  closing it and reads as fixed on a slow drag while still slinging on a flick. Guard:
  the repo-root `test/` suite `panLockInvariant` (2 of its 4 cases go red on the passive-effect model). This is
  VIEWPORT-STABLE in `/CLAUDE.md`, which the effect predated and violated.
- **Wide-zoom political boundaries (NEW-1):** `adminBoundaryGate.js` is the leaf gate (imports
  nothing) — the zoom CEILING (`ADMIN_BOUNDARY_MAX_ZOOM` 7) plus the cached dynamic import, exactly
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
  + the repo-root `test/` suite adminBoundaries.
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
- `releaseCanvas.js` (NEW-5) — hand an offscreen canvas's backing store back the moment its pixels
  have been consumed. Canvas pixels are renderer/GPU memory, not JS heap, and the GC barely feels
  them (measured ~555 MB of tab against a ~134 MB heap, with this idiom appearing NOWHERE in the
  tree). Call it only AFTER the last `toDataURL` / `toBlob` / `getImageData` / copying `drawImage`,
  and never on a canvas you are handing to a caller or one that is on screen. **Deliberately
  duplicated in `doc-review/lib/` rather than shared** — a module reachable from both routes gets
  hoisted into its own chunk and breaches the Site route's chunk budget; keep the two identical.
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
- **⛔ `jurisdiction.js` — WHICH JURISDICTION A SITE IS IN, and three things that are easy to get wrong
  (B276752–B276755, from the owner's 28-site portfolio sweep). Read before touching the header pill or
  anything that feeds the floodplain administrator.**
  **(1) CONTAINMENT IS A WHOLE-SITE QUESTION.** A site is an assemblage — twelve of the owner's
  twenty-eight are multi-parcel — and the identify used to reduce it to `representativeRing`, the single
  LARGEST lot, then ask which city THAT centroid was in. On an assemblage that is a coin flip weighted by
  lot size: Tsakiris printed a bare "City of Katy" off two of nine parcels, and Goose Creek's biggest lot
  is outside Baytown while six of its sixteen are inside. `parcelProbePoints` probes EVERY active parcel
  (largest first to 98% of drawn area, hard cap 16) and the answer is FOUR states — `in` / `partial` /
  `none` / `unknown` — never two. `sampled` (coverage target met) and `truncated` (hard cap hit first) are
  different: only `truncated` forbids a whole-site claim, and conflating them prints "part in City of
  Pearland" across 8 South's nineteen lots, every one of which is inside Pearland.
  **(2) AN UNKNOWN MAY NEVER LEAD.** A city appears in the lead slot ONLY on a positive containment
  answer. With containment unknown the pill says "City limits · couldn't check" and every ring city is
  demoted to "· touches" — a failed lookup rendered as a positive answer is exactly the reported
  "City of Baytown" defect. `hasContainmentMeta` keeps this from firing on a legacy bare fixture, which
  is the same collapse in the opposite direction.
  **(3) AN ETJ IS DEDUPED AGAINST THE CITY LIMITS THAT HOLD THE SITE, NEVER THE RING UNION — AND NOT
  AT ALL ON A SPLIT SITE.** Deduping against every touching city let a Houston frontage sliver suppress
  the Houston ETJ on four sites (Kennedy Greens, JFK, Katz, Pinnacle) — showing a jurisdiction the
  tooltip calls "unlikely to govern" INSTEAD of the Ch. 19 authority that sets the finished floor. And
  on a **partial** site the same city's ETJ is exactly what governs the part its limits do not cover,
  so suppressing it there re-creates the silence (Goose Creek read "part unincorporated" while all 8 of
  those lots sit in Baytown's own ETJ).
  **(4) B280704 — A SPLIT'S REMAINDER IS MEASURED, NEVER ASSUMED, AND THE SHARE IS PART OF THE ANSWER.**
  The first cut of the split label hardcoded "part unincorporated". At Goose Creek that is false — 6 of
  14 lots are in Baytown's limits and the other 8 in its ETJ, none unincorporated — and calling ETJ land
  unincorporated drops the city's floodplain standard out of the FFE comparison. The remainder is
  resolved in order: its own city's ETJ · another city's ETJ · couldn't check · no ETJ published ·
  genuinely unincorporated. The COUNT rides the lead because "part in" cannot tell one lot of fourteen
  from thirteen of fourteen, and it comes from the same probe as the split so the words and the number
  cannot disagree.
  **(5) B280705 — A "REGIONAL" LAYER'S COVERAGE IS A CLAIM; CHECK IT.** H-GAC's ETJ mosaic says it covers
  the 13-county region and carries **34 cities** — Baytown, Katy, Humble, La Porte, Deer Park,
  Friendswood, League City, Galveston and Tomball are absent. A missing city's ETJ read identically to no
  ETJ. Sources declare a `roster`; `etjCoverageFor` returns `not-mapped` outside it and the badge says
  *"no ETJ published for City of X"*. Baytown has its own registry row (`etj_baytown`); ~70 other cities
  are still uncovered but now say so. Re-check with the ui-audit harness **audit-etj-coverage**.
  **(6) B280706 — JURISDICTION VARIES *WITHIN* A SITE, and every yield number assumes it cannot.** A
  split site is a THIRD administrator state: not `unresolved` (the answer is known) and not `settled`
  (there are two). The panel refuses one site-wide FFE and names the split. **Per-parcel FFE numbers are
  NOT built** — the whole ledger is site-wide by construction — and that gap is owned by **B280707**,
  not implied. Half-doing it would put two contradictory floors on one drawing.
  **⛔ AND THE ONE THAT LOOKED LIKE FLAKINESS AND WAS NOT: `simplifyRing` BOUNDS VERTICES, WHICH IS THE
  WRONG QUANTITY.** `services.arcgis.com` answers a /query past ~2 KB of query string with an HTML **404**,
  and a 404 decodes as "this layer has nothing here" — so county and ETJ came back EMPTY on any finely
  digitised boundary, deterministically in the vertex count (Will Clayton 2325 chars → 404; Bain 1512 →
  200, same service, seconds apart). B209507's "measurably flaky ETJ source" was this. `fitIdentifyParams`
  now rounds coordinates to 6 dp and walks the vertex ladder down until the URL fits `MAX_QUERY_URL`.
  Do not "simplify" it back to a vertex cap, and do not switch to POST — the B445 cache proxy is
  GET-addressed, so a POST body silently bypasses the cache.
  Guards: the repo-root `test/` suites **jurisdiction** (96) and **jurisdictionShapes** (10 — real parcel
  geometry through the real query builder against RECORDED real agency answers, one fixture per
  jurisdiction SHAPE, mutation-checked two ways), plus the live ui-audit harness
  **verify-jurisdiction-portfolio** (all 28 of the owner's sites against the live services; its fixtures
  are re-recorded by the sibling harness **record-jurisdiction-shapes**). ⚠ A hand-written badge fixture tests
  the FORMATTER only — both real mislabels were produced UPSTREAM of it, by what the identify asked and
  how it read the answer, and 96 green formatter tests passed through both.
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
- **⛔ `assemblyIntegrity.js` (B1340) — THE bonded-assembly invariant, and the reason this bug family
  is closed rather than patched a ninth time. Read it before touching any write, echo or revert path.**
  A bonded child's world position is REDUNDANT: it is derived from its host across the wall, and only
  bounded (by wall overlap) along it. That fact is stored twice — host row and child row — and the N+1
  rows are written, revved, accepted-or-refused, echoed, journaled, folded and healed INDEPENDENTLY, so
  some interleaving always lands one without the other. **Eight merged PRs each closed one interleaving
  and it kept coming back**; the enumeration on B1340 lists twenty-two paths, ELEVEN of which bypass the
  atomic group commit by construction (the unload keepalive sends `dirty` with no closure, no `freshen`
  and no atomic flag; every realtime upsert applies ONE row; `onRowsCanonical` can adopt four of eight
  children; `mergeSiteContent` unions per id and can pair a NEW host with an OLD child). So the fix is
  not more atomicity — it is removing the redundancy at every seam. `assemblyIntegrity(els)` runs the
  EXISTING derivation (`siteModel.normalizeBondedChildren`) and returns the healed list plus `repairs`
  and `tears`. **The detector IS the healer's own diff** — never write a second "where should this child
  be", that is the next bug in this family. Identity-preserving on a coherent plan, so it is free to run
  everywhere. Seams in `SitePlanner.jsx`: `assemblyGuard` at **canvas** (one effect over `els`, covering
  every mutation, so a new write path cannot skip it) · **undo/redo** (`applySnapshot`, because a
  snapshot can have been RECORDED torn) · **commit** (`reconcileElems`) and **flush-override** (what the
  engine's `freshen` re-reads) — those two are what make a torn assembly **unpersistable** · **load**
  (`refetchReplace`) · **post-commit** (`elementSync`'s `afterCommit` hook, once per settled batch,
  which can never throw into the write path). The on-device load seam lives in **`storage.js`**
  (`bondedHealWatch`), NOT in the planner: a route-level read normalizes the record before the planner
  mounts, so a detector inside the planner is outrun by the very repair it reports — measured, not
  assumed. **Two traps worth knowing:** the heal was never PERSISTED (a planted tear rendered correctly
  and was still on disk four seconds later — hence `loadSite(id, { persistHeal: true })`), and
  `applyRemoteRow`'s derived-yield branch was missing the `foreignAuthor` gate B1116 gave its
  commit-result twin, so a tab could stand down against its OWN earlier write. **LOUD by contract:**
  every repair reports ids + delta (`assembly-tear-detected` / `-healed` / `-persisted`), because a
  silent self-heal is why this shipped as fixed eight times. Guards: the repo-root `test/` suite
  **assemblyIntegrity** (28, incl. all six required races, each proven red with the write seam disabled)
  and the e2e spec **assembly-tear-detector**, which measures BEFORE any reload — a reload heals this
  bug, so any check that reloads first proves nothing.
- `bondRemap.js` — the ONE id-bearing bond inventory (`attachedTo` · `forCourt` · `forTrailer` ·
  `prevZone`) + the remap rule EVERY copy path must use (B1124). Both copy paths used to remap only
  `attachedTo`, so a duplicated building's trailer parking stayed bonded to the ORIGINAL building's
  truck court — and `relayoutSide` walks the chain from the court, so that trailer was never laid out
  at all ("hovering by itself"). Rule: a reference inside the copied set is remapped; one outside it
  is DROPPED, never left dangling to a foreign element. A non-string value is an inert legacy flag,
  not a bond. `siteModel.normalizeCrossHostBonds` is the load-time repair for plans already copied,
  and it must run BEFORE `normalizeZoneAlongLen` (which needs a walkable chain to judge a pin against).
- **`dogEar.js` `sideParkAlongRun` + `siteModel.js` `normalizeHostRuns` — the ONE answer to "is this
  along-wall run USER INTENT?" (NEW-1).** A run LONGER than the wall it hugs is never intent, it is staleness:
  every gesture that can set one clamps it to the wall, so an over-length run can only have come from a longer
  host (a resize, or a copy of a longer building). The canvas refit (`relayoutWallKids`) and the load-time heal
  both call the SAME pure rule, and only a gesture aimed AT THAT FIELD (`pinAllowed` — B1123's `userResize` by
  another name) may pin one. **The trap this closes:** `relayoutWallKids` runs on a host resize with the NEW host
  box and the OLD child boxes, so a field faithfully TRACKING the old span measured different from the new one,
  was read as hand-positioned, and had the pre-resize run stamped onto `sideParkFit` — the owner's Weld plan
  carries `sideParkFit { run: 708.58 }` on a 577 ft building. `normalizeHostRuns` is the load-time half: it
  re-lays any dock-zone chain member or side-parking row that disagrees with its host through the same
  `layoutZoneByKind` / `wallKidBox` the canvas uses.
  **⛔ B1340 (×2), 2026-07-31 — "PRESERVE ONCE TOUCHED" IS GONE, and this replaces the old rule that a
  run which FITS is left completely alone.** That clause survived B1340's position work and produced the
  owner's Sylvestri report: building `e1454731yyuqqs` had its depth taken 220 → 200, its sidewalks
  correctly followed to 260 (200 + a 60 ft bump projection) and its end PARKING fields sat at 205
  against that same wall — 80 against 259 on the building beside it — with PERFECT perpendicular
  offsets, so B1340's derived-position work was holding and only the SPAN had gone stale. A run is
  derivable from its host exactly as a position is, so it is derived on the same schedule: **no stamp ⇒
  the run and the along-wall centre are the span default, in EITHER direction**; a `sideParkFit` stamp
  is the ONLY intent that counts, it is written ONLY by a gesture aimed at that field (`pinFrom` /
  `pinAllowed`), and it is RE-CLAMPED to the host's current wall on every host change. Dragging a field
  back onto the default CLEARS the stamp. B1039's hand-positioned field therefore still survives every
  refit — it is now RECORDED rather than inferred from geometry, which is the whole difference between
  intent and staleness. Migration is deliberate and one-way: a legacy unstamped short run is re-derived
  on the next open, LOUDLY (`assembly-tear-detected`, span half). Fixtures + guards:
  the repo-root fixture **ui-audit/fixtures/weld-concept-a.json** (the owner's real rows — the defect IS the
  fixture, do not "fix" the numbers), the repo-root `test/` suite **hostRunHeal** and the e2e spec
  **dock-zone-host-run**.
- **⛔ `dockZones.js` — A BONDED ZONE'S SPAN IS *ANCHORED*, AND THAT IS ONE FIELD, NOT TWO (NEW-1).**
  `layoutZoneByKind` builds the zone centre as `b.c + u·center + tan·alongShift`, and for a long time
  the ONLY along-wall term there was `alongShift` — the B492 corner-bump-out trim. The LENGTH came
  from the user (`alongLen`) and the CENTRE did not, so shrinking a zone moved BOTH ends inward by
  half the reduction (the owner's *"when I shrink the trailer parking, it shrinks from both sides"*).
  The override is therefore an ANCHORED span — `alongLen` + **`alongAnchor`** (−1 / 0 / +1: which end
  is held) + **`alongOff`** (feet from the chain default's matching reference) — resolved by
  `anchoredAlongSpan`, which **COMPOSES with the bump-out trim rather than replacing it** and
  RE-CLAMPS instead of sliding off the wall. Three rules: **(a)** an absent anchor is 0 and renders
  byte-identically, so there is no migration — never "helpfully" default one; **(b)** the anchor
  travels with the length at EVERY layout site — the canvas (`relayoutSide` / `courtBumpOpts`) and all
  three `siteModel` heals — because B1340's tear detector IS the healer's own diff, so a heal that
  re-centred would report a permanent tear against a correct canvas; **(c)** a dropped `alongLen`
  drops its anchor with it. B1123's two intent gates still decide WHETHER a gesture may pin; this only
  adds WHERE. **Side parking already worked this way** (`dogEar.sideParkAlongRun` stores
  `{ run, alongShift }`) — do not "unify" it away. Guards: the repo-root `test/` suite
  **zoneAlongAnchor** (mutation-checked 15 ways) and the e2e spec **dock-zone-anchor**, both driving
  the owner's real rows in **ui-audit/fixtures/sylvestri-concept-d.json**.
- **`appraisal.js` `situsAddress` / `situsKey` / `siteNameFromParcel` — the SITUS ladder (NEW-2).** The address a
  card, a plan NAME and a parcel search resolve is the LAND's, never the owner's mailing address. It is an ORDERED
  ladder (every key tested against "says situs" before any key is tested against the generic `address` catch-all),
  not one alternation — Weld County lists `ADDRESS1` (Forestar's Arlington head office) before `SITUS`, and
  "first matching key wins" named a Colorado plan after a Texas office. **Nothing in `ADDRESS1` says "mail", so a
  mail/owner key exclusion alone does not close this**; the precedence does, plus a refusal of numbered address
  LINES on the generic rung. No situs → NULL, and the callers fall back to what the user searched. `MapFinder`,
  `SitePlanner`'s identify and `counties.detectField` all share it — do not reintroduce a local `ADDR_RE`.
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
- `planClipboard.js` — the ONE general canvas clipboard (NEW-2/NEW-6): collect the current selection
  (elements expanded to their `attachedTo` assembly, so a building brings its truck court / trailer
  parking / dock zones / bump-outs), then paste with fresh ids, bonds remapped INSIDE the copy, and
  relative geometry preserved. A pasted parcel arrives INACTIVE by design (can't double-count site area).
  **⛔ NEW-1 — `planClipboardStore.js` HOLDS THE PAYLOAD, AT MODULE SCOPE, AND THAT IS THE WHOLE POINT.**
  The owner could not copy a polygon between two plans of one site, and coverage was never the problem
  (`CLIP_KINDS` already had every drawn kind): the payload was a `useRef` INSIDE `SitePlanner`, which
  `SitePlannerApp` mounts keyed on the plan id, so a plan switch remounted the component and destroyed
  the copy. Module scope is above EVERY remount boundary at once — the plan-switch key, the `loadEpoch`
  bump, a workspace switch, an error-boundary reset — rather than above the one that happened to be
  found; hoisting into `SitePlannerApp` state would have fixed one and left the rest to be rediscovered.
  **The overlay clipboard moved WITH it**; leaving one behind is how the two Ctrl+V paths diverge again.
  **The coordinate decision is `resolveClipFrame`, and it is explicit, not accidental:** clipboard
  geometry is feet in the SOURCE plan's frame, `origin` is per-RECORD and can differ between siblings,
  so a cross-plan paste RE-PROJECTS through the `mapLock` projection and lands on the same GROUND
  position it had — real-world SIZE is never rescaled (each plan's feet are ground-true at its own
  origin, so a copied building must not shrink), and the ignored grid-scale term is MEASURED and the
  paste REFUSED, loudly and by name, when it would smear the set past `CLIP_FRAME_MAX_SMEAR_FT` or when
  the two frames cannot be related at all (exactly one plan has a map origin). A same-plan paste is
  untouched and still lands at the cursor (B417). Guards: the repo-root `test/` suite
  **planClipboardLifetime** (incl. a source guard that the payload is not owned by the component again)
  and the e2e spec **clipboard-survives-plan-switch** — the mount boundary IS the thing under test, so
  a unit test on the module cannot substitute (mutation-checked: make the payload die with the mount
  and all four cases go red).
- `standardsApply.js` + `userPrefs.js` + `components/StandardsBar.jsx` — Standards commit model +
  retroactive apply. `standardsApply` is the pure engine (parcels are stamped → WRITE the value;
  elements resolve at render → CLEAR the per-element override) plus `applyAllStandards` — ONE Apply
  for the whole panel, counted in distinct OBJECTS — plus the **pending DRAFT** model (NEW-2:
  `EMPTY_STD_DRAFT` / `withParcelDraft` / `withTypeDraft` / `draftParcelValue` / `draftTypeValue` /
  `draftDirty` / `mergeDraftIntoSettings`). The `Project | All` scope toggle is **gone** — it read as
  one axis with Apply and was two (where a value is STORED vs pushing it onto what is DRAWN).
  `StandardsBar` is now a real footer BELOW the panel's scrolling body (a sibling of the scroll
  container in both the docked host and `FloatingPanel`'s new `footer` slot — never sticky INSIDE
  the list, which sliced the row at the bottom of the scrollport in half) carrying three named
  actions: **Apply to this plan (N)** · **Save for this plan** · **Save for all projects**. Because
  "Save for this plan" is explicit, a field edit can no longer silently commit: edits land in the
  draft, the footer shows a quiet "Unsaved changes" + Discard, and the draft is persisted per plan
  in `sessionStorage` so closing the panel / reloading can't throw it away. `planStyle`'s PREVIEW
  layer (`setPreviewStyleDefaults`) is how the canvas shows an uncommitted draft — **visual only:
  `parcelDefaultStyle` deliberately ignores it, so an uncommitted value can never be stamped into
  geometry.** `userPrefs` is the account-level store (`public.profiles.prefs` jsonb, own-row RLS —
  `db/user_prefs.sql`) behind "Save for all projects", published into `planStyle`'s account layer
  (`setAccountStyleDefaults`). Precedence: built-in < account < project < draft (preview) < per-object.
- `planStyle.js` also owns the **setback line's** resolved style (NEW-1: `setbackLineStyle` /
  `setbackDashArray` / `SETBACK_LINE`) — colour, weight and dash were hardcoded at the one place the
  ring was drawn while the boundary beside it had full standards. The defaults ARE the historic look
  (weight 1.25, `dashed` = "7 6"), and `parcelDefaultStyle` stamps `sbStroke`/`sbWeight`/`sbDash` only
  when they DIFFER from it, so an upgraded plan gains no keys and renders unchanged.
  **⛔ The dimension CHIP does NOT read that derivation — `setbackChipStyle(ink)` is its own, and it
  takes NO parcel (NEW-1).** The chip is a white plate whose border and numerals are the
  `--canvas-chip-ink` token and track NOTHING on the parcel; decoupling them from the line is the
  whole point (owner: *"the setback is orange, and then the chip … the text is orange. I'd like that
  to all be … black."*). It was re-coupled once, by a `pc.sbStroke || ink` fallback that read black
  only until someone set a setback colour — so the moment the line default moved indigo → green
  (B1192) the chip went green on the live map. Never reintroduce a per-parcel value at that render
  site; the LINE keeps its override, the chip never follows it. Guards: the repo-root `test/` suite
  **setbackChipInk** (property + source guard, both mutation-checked) + the ui-audit harness
  **verify-setback-chip-ink** (computed colours, an arbitrary line colour beside an untouched one).
- **`measureStyle.js` + `measureLabel.js` — measurements, brought up to par with every other object.**
  Measurements were the last drawn object with NO style of their own (the colour was hardcoded to
  `PAL.accent` at the one place they were painted), no per-object label control, and a run-on
  one-line label. `measureStyle.js` is the ONE resolver — per-measurement stroke/weight/dash/fill/
  fillOpacity, the Standards defaults STAMPED at creation (`measureDefaultStyle`, the
  `parcelDefaultStyle` mechanic, so Standards → Measurements applies retroactively through
  `standardsApply.applyMeasureStandard`), and the per-measurement label-reveal zoom
  (`measureLabelVisible` / `measureLabelThreshold`, defaulting to the shared `dimCalloutVisible`
  floor). **⛔ The uncalibrated AMBER override must stay** — it beats the user's colour because it
  is a correctness signal ("not real feet yet"), not decoration; a selected measurement likewise
  always shows its label. `measureLabel.js` is the pure PRESENTATION half: one dominant headline
  with the detail subordinate, the area unit chosen by magnitude (sf below an acre, ac above —
  never both at equal weight), one feet convention (the prime mark), and `measureSegments` for the
  per-edge dimensions. The summary CHIP is laid out by `labelLayout.layoutLabels` (its boxes then
  become obstacles for the element-label pass) and carries `data-print-chip="measure"`, so
  `exportSheet`'s one attribute-keyed restyle prints it exactly like a parcel acreage chip.
  **⛔ NEW-1 — `measureSheet.js` is how a measurement renders on a SHEET, and the principle it
  encodes generalises: AN EXPORT IS A DOCUMENT, NOT A SCREENSHOT.** `buildExportSvg` CLONES the live
  `<svg>` and strips only `data-export="skip"`, so an export is by construction exactly what was on
  screen — which meant it inherited the canvas's level-of-detail decisions. On the owner's Sylvestri
  print that produced a length measurement as two fat discs joined by a stub with no number anywhere:
  the VALUE was zoom-gated (below the gate at whole-site zoom, so never in the DOM to clone) and the
  endpoint discs had NO gate and constant screen-px sizing. Three rules now: **(1)** a measurement's
  value renders regardless of every zoom gate on an export (`measureLabelVisible`'s `sheet` option) —
  the per-measurement reveal zoom governs the CANVAS ONLY; **(2)** the vertex discs are an EDITING
  AFFORDANCE (`data-export="skip"`) and an open run gets real drafting terminators instead
  (`terminatorTicks`), while a COUNT's numbered markers are CONTENT and keep printing; **(3)** the
  INVARIANT — a measurement never prints its geometry without its value — is enforced on the clone
  (`enforceMeasureValueOnSheet`, LOUD-FAILURE), so a measurement that somehow loses its number is
  OMITTED rather than printed as anonymous marks. **The general test when adding a gate: does it ask
  "is the user zoomed in enough" (screen declutter → lift it on the sheet) or "is there physical room
  on the SHEET" (`detailLabelVisible`/`pondParamLabelVisible`, already re-evaluated at the sheet's own
  scale by `exportLabelScale.js` → keep it)?** Guards: the repo-root `test/` suite **measureSheet**
  and the e2e spec **measure-export-lod** (which builds the REAL sheet through
  `window.__plannerExportSvg` — the defect is invisible to any source reading, it exists only in the
  clone; mutation-checked both ways).
- **`parcelTruncation.js` (NEW-3)** — did a parcel query come back CUT SHORT? ArcGIS answers any query
  with at most `maxRecordCount` features and sets `exceededTransferLimit`; esri-leaflet does NOT page,
  so a truncated answer draws an authoritative-looking parcel layer with an unknown number of lots
  missing. Measured: one view-sized bbox against the Colorado composite returned exactly 2000 features
  with the flag true, and nothing said so. Split out of `parcelDisplay.js` (which imports Leaflet and
  so cannot be unit-tested). The two paths that PAGE — `vectorLayers.js` and the nightly snapshot
  builder — already handled the flag and are untouched.
- **`counties.js` — ONE URL MUST NOT CARRY TWO HEALTH POLICIES (NEW-2).** `STATEWIDE_KEYS` answers "is
  this KEY the statewide pseudo-county"; for the display hang-guard that is the wrong question. The
  composite is exempt because pulling it leaves nothing to see or click — a property of the ENDPOINT.
  A county PARKED on a composite (Waller, and four Colorado counties) resolves to the same URL and used
  to get the opposite policy: the guard fired on the county-keyed copy, the breaker opened, and the
  banner claimed a server was slow while pointing at that same host. Ask `isStatewideLayerUrl(url)`.
  `sharedLayerUrlConflicts()` is the dev-time + CI assertion that no two entries share a NON-statewide
  URL; `MapFinder.addDisplay` dedupes displays by RESOLVED URL, so the same endpoint is never added
  twice and non-owner keys are aliases that must never remove the shared layer.
- **⛔ `doubleTap.js` + `featureTarget.js` (B50008–B50010) — THE DOUBLE-CLICK, and both halves of its
  contract had shipped broken. Read them before touching selection or the click contract.** B750/B935
  declare the rule (single click selects, double click opens Properties) and it was never wrong; its two
  IMPLEMENTATIONS were. **(1) `doubleTap.js` — the budget is the GESTURE's clock, never the app's.**
  `isDoubleTap` compared `Date.now()` read INSIDE the handler, and on the owner's Bain plan press 2's
  handler began **307 ms after its own event fired** against a 350 ms budget, so an ordinary 150 ms
  double-click measured ~450 ms and was silently discarded — the busier the plan, the more often. Use
  `e.timeStamp` (stamped at event creation) for both the stored value and the comparison; **⛔ never
  "fix" a recurrence by raising `DBLTAP_MS`**, which hides the cause and makes a deliberate
  click-pause-click misfire as an edit. **(2) `featureTarget.js` — the native `dblclick` never reaches
  the feature's node.** A click's target is the common ancestor of its down and up targets, so press 1
  selects, React re-renders, and press 2's click/dblclick collapse to the root `<svg>`; every `<g>`-level
  `onDoubleClick` is unreachable in exactly the case it exists for. The gesture is therefore resolved AT
  THE ROOT by hit-testing the point (`onBgDouble` → `resolveDoubleClickTarget`), using the browser's own
  `elementsFromPoint` so a second geometric hit-test can never disagree with the one that picked the
  press. Every feature's outermost group stamps `data-feature="<kind>:<id>"`; the handle layer is
  skipped; **`featureDoubleAction` is the ONE decision per family** and both routes call it — two copies
  had already drifted (`onElDouble` opened Properties for a LOCKED element while `startMoveEl` refused).
  **(3) A dimension NUMBER over its own body forwards to the body** (`pressIsOverElementBody`): a road's
  width number is anchored to the centreline midpoint, so a double-click aimed at the road could not miss
  it and the inline width chip swallowed the gesture. Fixed once in the shared dispatch, never
  special-cased for road.
  **(4) B233153 — A HANDLE IS TRANSPARENT TO IDENTIFICATION, and this REPLACES the rule that a handle on
  top owns the press.** Captured live on the owner's Bain plan: press 1 on a detention pond SELECTS it,
  which mounts that pond's own 18×18 `vtx-handle` hit squares, and one lands exactly on the point already
  pressed — so press 2 hit a grip **the first press had created**, the tap could not pair, the native
  dblclick retargeted, and `resolveDoubleClickTarget` answered `null`. Silent, every time. A grip is chrome
  belonging to the selected feature, never a feature, so it is now SKIPPED — closing every element type that
  renders grips at once rather than special-casing the pond. **⛔ IDENTIFICATION ONLY: grips keep their own
  `pointerEvents` and `onPointerDown`, and a vertex must still drag.** The variable that hid this for months
  was **VERTEX COUNT against handle size at the probe point**, not shape — a four-vertex fixture ring keeps
  its grips at four distant corners, so six realistic pond variants all certified green.
  **(5) B278576 — A FEATURE SMALLER THAN ITS OWN CHROME, and the clause (4) does not reach.** (4) makes
  the resolver look THROUGH the handle layer, which answers *"what is beneath this grip"*. It cannot answer
  *"what is this GESTURE about"*, and those coincide only while the feature is bigger than the chrome it
  summons. Captured on the owner's Bain plan: a road stub whose whole body is **6×12 CSS px** wearing a 12 px
  endpoint handle — press 1 selected it, press 2 addressed **a different, larger road**, and the open panel
  vanished. **The control separates this from (4):** on a LARGE road, a press point covered by its own
  endpoint handle still resolves to the road and still opens Properties, so the handle is not the
  differentiator — the **SIZE RATIO** is. Fix: `gestureAnchorTarget` — **while a double-click is in flight,
  the feature press 1 selected WINS the hit test at that point**, gated on the native double-click's own
  `DBLTAP_MS`/`DBLTAP_PX` (borrowed from `doubleTap.js`, never a second copy). It is asked FIRST and wins
  OUTRIGHT; a tie-break still loses to whatever the stack puts on top, which IS the failure. The two facts it
  needs come from their one honest source each: `lastPressRef` (stamped in the **capture phase** at the canvas
  root, because a press EATEN BY CHROME never reaches a feature handler) and `gestureAnchorRef` (a layout
  effect on `sel`), with **press 1 keeping the anchor for the whole gesture** so chrome that steals press 2
  cannot hand the gesture to itself. **(5b) B278577 — the same rule on REVIEW chrome:** the min-radius flag's
  7 px corner dot is wider than that stub, and it swallowed the press outright AND ran `fixRoadRadiusFor` on
  press 2, **silently re-cutting the alignment**. The DOT sits on the road so it identifies AS the road and
  forwards the press; the LABEL PILL sits in clear space so it keeps the one-click Fix and claims no feature.
  ⚠ Owner-facing trade: the dot no longer fixes on one click.
  Guards: the repo-root `test/` suites **doubleTap** and **featureTarget** (45, incl. the owner's captured
  stack verbatim; pre-fix rule ⇒ 4 red), the e2e specs **dblclick-properties** (all four cases
  mutation-checked red on the pre-fix build) and **chrome-swallows-press** (the B233153 pair — the
  grip-covered double-click, plus the vertex-drag regression guard, which COUNTS moved vertices because a
  press falling through an inert grip moves the whole pond and passes any "it changed" check), and the
  ui-audit harness **audit-doubleclick-properties** (every element type × every markup kind × three easement
  modes, in `centres` / `--labels` / `--locked` — `--labels` primes the selection first, because a
  detail-tier dimension number does not EXIST until its element is selected; **HALF FIVE** finds a point
  where a feature's own grip lands over its own body and double-clicks there; pre-fix ⇒ 39 red).
  **Two instruments this bug bought, and neither is optional:** `window.__plannerHitTarget(x, y)`
  (E2E-gated, read-only — the app's OWN resolution asked MID-GESTURE; a harness re-implementing the rule
  tests its own copy of it), and the **two-press invariant**, the only probe shape that can see chrome which
  does not exist until the gesture is half-finished. ⛔ And a harness must stamp `clickCount` 1 then 2 or
  Chromium synthesises **no native `dblclick` at all** — two bare down/up pairs leave the whole root-resolver
  path unexercised behind a full green score, which is exactly how this survived.
- **⛔ `pureCache.js` + `viewCull.js`'s `cullRectFor` — VIEW-INDEPENDENT-ONCE (`/CLAUDE.md`), the two
  mechanisms a fix in that class uses. Read the rule before adding a memo here.** The cull rect is
  **LATCHED**, not re-derived: it was a continuous function of `view`, so `cullToView` re-filtered the
  whole model every pan frame and returned THE SAME SET in a fresh array, which then missed every memo
  downstream (`drawEls`/`drawElsZ`/`drawParcels`/`drawMarkupsZ`). A lattice snap was tried first and
  measured at 60 → 19 recomputes — a step function still steps — so `cullRectFor` keeps the rect it
  already holds while the true viewport is **proven inside it** (always a superset, so it can draw more
  and never drop something visible) and re-arms on a far enough pan and always on a zoom. Returning
  `prev` **by identity** is half the fix; a fresh object with equal numbers invalidates everything.
  `pureCache.js` is for pure leaves that have no hook to hang a memo on — a signature cache
  (`roadGeometry.roadCenterlineTagged`, bypassed when a caller passes the un-keyable `shareAt`) and a
  WeakMap identity cache (`metesAndBounds.offsetPolyline` / `bufferPolyline`), whose precondition is
  that the keyed array is treated as IMMUTABLE. Guards: the repo-root `test/` suites **pureCache**,
  **recomputeProbe** and **viewIndependentRegistry**, the ui-audit gate **verify-view-independent**
  (a counter — every visual test in this repo passes on this defect), and the instrument that finds
  the class, **detect-view-recompute**. Enumeration: `/docs/PERF-VIEW-INDEPENDENCE.md`.
- **⛔ THE VIEW ANCHOR (B1440 pan · B1449 zoom) — `renderView` / `rppf` are the frame the RENDER BODY
  reasons at, and `view` is the frame everything ELSE does. Read the shared `viewport/` module
  **viewAnchor** before touching either.** During a gesture the emitted geometry is pinned at an ANCHOR view and
  one group transform (`translate(tx ty) scale(k)`) carries it, so a pan or a wheel notch writes one
  attribute instead of re-emitting the plan. **The split is mechanical, not case-by-case:** every
  `view.ppf` in the RENDER BODY — including `makeLabelFrame`, the cull rect and every `el.w * ppf` —
  is `rppf`; every one in a HANDLER or an EFFECT stays `view.ppf` (a hit tolerance is about where the
  pointer is NOW). Mixing them is the whole failure mode: geometry at the anchor with labels, LOD
  gates and stroke weights at the live zoom, and the group scaling one of them again.
  **⛔ AND IT IS INVISIBLE AT REST — `rppf === view.ppf` there, so a correct build and a broken one
  are byte-identical to every unit test, e2e spec and pixel harness in this repo.** That blindness
  is why this sat unshipped for weeks as "dangerous", and closing it was the first deliverable
  (`/CLAUDE.md` → DANGEROUS-MEANS-UNOBSERVABLE). Guards: the repo-root `test/` suites **viewAnchor**
  (the exactness proof + the wheel factor, mutation-checked), **panAnchor** (the source split) and
  **midGestureZoom**, plus the ui-audit gate **verify-midgesture-zoom** (`npm run perf:midzoom` —
  drives a real wheel gesture, captures the frame MID-gesture, and fails unless the clean run is
  green AND both deliberate mutants go red). The owner-facing A/B is **zoom-smoothness-ab**
  (`npm run perf:zoomab`), which records the same gesture with the anchor on and off.
  **The on-canvas `View ▾` menu → Smooth zoom** is the off switch (`components/ViewMenu.jsx`; moved
  there from the plan menu by **B286000** — a per-device rendering preference does not belong in a
  plan-scoped flyout, and the owner could not find it there. Same `smoothZoom` localStorage key,
  same default, same `disarmViewAnchor()` on turn-off; `SitePlanner`'s `applySmoothZoom` is the one
  place that decides, so the card renders state and owns no copy of the rule). It gates the ZOOM anchor only — the pan anchor is never
  gated on it.
- `zOrder.js` — per-element `z` stacking key utilities (`nextZ`/`sortByZ`/`normalizeZ`/`ensureZ`, B671).
  `arrange.js` — pure z-order "Arrange" (`reorderByZ`/`arrangeFlags`, B820): Bring-to-Front/Send-to-Back
  over a peer set (a building reorders within its `Z_LAYER` band, a markup within the markup layer;
  a markup can also be sent behind the elements). Wired via `arrangeSel` + the right-click menus + the
  ⌘/Ctrl+]/[ chords in `SitePlanner.jsx`.
- **⛔ `labelLayout.js` also holds the GEOMETRY level-of-detail tier (B1345) — read it before "tidying"
  a stall band back into N `<line>`s.** Every other tier here gates a LABEL; this one is the only one
  that touches drawn geometry, and it is a change of REPRESENTATION, never decimation: below
  `STALL_PITCH_MIN_PX` on-sheet pitch the N per-stall dividers become the N subpaths of ONE `<path>`
  (`segmentsPath`) — identical coordinates, identical stroke, same rasteriser. On the owner's real plan
  that is **−1,550 nodes, 63% of the canvas DOM**, and the drag frame median HALVED at 4× throttle.
  Three things not to undo: **(a)** the gate is measured on the LABEL FRAME (`px / lfK`, the
  `FEAT_BTN_MIN_PX` precedent) so an EXPORT decides at the sheet's scale — get that wrong and a
  wide-zoom PDF silently loses its stalls; **(b)** an SVG `<pattern>` is NOT an equivalent and was
  measured as wrong (Chromium rasterises a tile once and repeats it, so a non-integer pitch accumulates
  sub-pixel phase error — up to 30/255); **(c)** the DOCK-DOOR LEAVES deliberately do NOT collapse
  (up to 23/255 — **and NOT because the fill is semi-transparent, which was the recorded cause until
  2026-08-06 and is refuted: fold both arms fully OPAQUE and the difference does not move. It is that
  Chromium does not rasterise a `<rect>` and a rectangular `<path>` to the same antialiased edge, at
  ANY zoom, folded or not — so no gate saves it.** B1350 is CLOSED with the 424 nodes left behind;
  the instrument is the ui-audit harness **diagnose-dock-leaf-fold**).
  Guards: the repo-root `test/` suite **geometryLod** (incl. source guards on both call sites and on the
  rejected door half) and the ui-audit harness **verify-stall-lod-parity** (two real builds compared
  pixel by pixel via its own dependency-free PNG decoder, plus the exported sheet — PDF-PARITY).
- `labelLayout.js` — LOD label tiering + the shared dimension-number zoom→font scale (`dimFontPx`, B911)
  + the quieter pond design-parameter tier (`pondParamLabelVisible`/`pondParamFontPx`, B1016 — the berm
  tag, floor/WS elevations and the rim-to-floor line reveal only when the band they measure reads on screen).
  **`labelFitLadder.js` is THE fit decision (NEW-1/NEW-2) — `labelLayout` consumes it, never forks it.**
  Two rules it exists to keep. **(1) FIT and COLLISION are different axes and must stay apart.** A fit
  failure may only RELOCATE or SHORTEN a label — the ladder (`inline → stacked → abbrev →
  outside-with-leader`) always ends in a reachable `outside` rung, so "too wide" can never blank a label.
  Losing a COLLISION may still hide one (that is B121/B951 declutter, and it is correct) — except for a
  `mustLabel` element (a pond), which walks its outside placement around and outward until it clears and
  is never left unnamed. `layoutLabels` tracks this as `fittedSomewhere`; do not collapse the two paths
  back together, because conflating them is exactly what made Goose Creek's southern pond go silent.
  **(2) A POLYGON is measured against its real INTERIOR, not its bounding box** — `interiorFitter`
  rasterises the ring and enumerates the maximal inscribed rectangles, so an irregular pond is never told
  it has room it does not have, and a label can SLIDE inside that room to dodge an obstacle. Every polygon
  candidate therefore passes `ring`/`ringOrigin`/`ringPpf`; rect elements pass none and keep the bounding
  box as their interior (behaviour unchanged). **Rung order is TRIED, not PREFERRED** — the chosen rung is
  whichever first FITS the measured interior, so a long shallow pond keeps the single wide line while a
  tall narrow one stacks; never "always stack". A reflowable line is authored as `{parts, sep, keep}`
  and must never be pre-joined — a joined string has no rungs left to take. On a pond label the one
  remaining reflowable line is the stage-storage line (`Holds … ac-ft usable · …′ rim to floor`); it is
  what keeps the `stacked`/`abbrev` rungs exercised, so do not remove it without replacing that coverage.
  `pondLabelText.js` — **what the pond MAP label SAYS: its name, then a bare acreage, and nothing else**
  (NEW-1, owner 2026-08-06 — "get rid of footprint and get rid of square feet, leave the acreage"). This
  deliberately **overrides PR-Q/O4's "no bare acreage" rule for this one line**; O4 still governs the panel
  headers and the parcel badge, where it was actually load-bearing. Read that module's header before
  "restoring" the old `footprint … ac · … sf` form. The pond INSPECTOR is untouched and keeps its full
  Water area / Berm ring / Land take split.
  **⛔ B217539 — `layoutLabels` IS A MEMO WRAPPER; `layoutLabelsSolve` IS THE PASS. Read this before
  adding a call site or "tidying" the indirection away.** The greedy COLLISION sweep ran from the render
  body and re-derived the same placements every frame — measured at **370 executions on one pure pan**,
  for two distinct answers. Every input is a screen box baked at the pan ANCHOR (B1440), so a pan cannot
  change one of them. `layoutLabels` now keys a VALUE SIGNATURE and returns the SAME Map on a hit
  (**370 → 2 solves**, the label pass 36.3 → 9.8 ms per gesture, output byte-for-byte identical).
  Three things not to undo: **(a)** the memo lives in the LIBRARY, not in two `useMemo`s — a component
  memo cannot work here (`labelCands` and the obstacle arrays are fresh arrays holding identical values
  every render, so `Object.is` says "changed" 100% of the time — the B221763 trap), and a third caller
  would otherwise reintroduce the defect silently; **(b)** `ring` is keyed by IDENTITY, never contents —
  hashing thousands of vertices per frame costs more than the scan it saves, and the planner replaces
  `points` wholesale on edit so an edited pond cannot be served its old placement; **(c)** the returned
  Map is SHARED — read-only, like every memo in this tree. **Not fixed here, and not claimed:**
  `inlineLines` (2,590×) and `pondLabelText.pondAreaLabelLine` (372×) are reached from the label-CANDIDATE
  construction in the render body (`SitePlanner.jsx:13878`), a different path. Guards: the repo-root
  `test/` suite **labelLayoutMemo** (counter + memoised-equals-unmemoised over the owner's real rings,
  mutation-proven both ways) and the ui-audit gate **verify-view-independent** (registry entry
  `layoutLabelsSolve`, `max: 2` = the two call sites, pinned to a source assertion). No visual test can
  see this class — the picture is identical when broken.
  **NEW-2/B221761 — `interiorFitter(ring).spots(w, h, want)` IS MEMOISED, and the reason is worth knowing
  before you touch it.** The fit question is asked in FEET (`layoutLabels` divides the screen size by `ppf`
  first) and a pan is a pure translation at constant scale (B1440), so during a drag the ring, the ppf, the
  lines and the type metrics are bit-for-bit identical frame to frame — every frame re-asked the same
  question and re-scanned thousands of inscribed rectangles for the same answer. **A pond is the only
  element type handed a `ring` AND marked `mustLabel`**, so it was the only one paying: measured at
  16.7 → 93.4 ms of "Label layout & collision" per pan gesture going 0 → 16 ponds, and `labelFitLadder` was
  the hottest application function in the profile (`docs/PERF-POND.md`). The cache's lifetime IS the ring's —
  `fitterCache` is a WeakMap keyed on the ring array, so an edited pond arrives as a NEW array and gets a
  new fitter and **can never be placed against its old interior**. The returned array is SHARED: read-only.
  Guards: the repo-root `test/` suites **labelFitLadder** (the invariant, over a battery of hostile shapes,
  plus a source guard that the ring/`mustLabel` keys still reach `layoutLabels`), **pondLabelFit** (the
  real Goose Creek / Tsakiris / Bain rings), **pondLabelText** (the label's wording, driving the real
  builder) and **labelFitMemo** (memoised === un-memoised, position for position, over the owner's own
  Goose Creek and Bain geometry; mutation-checked two ways), plus the ui-audit harnesses
  **verify-pond-label-fit** (the real plan, a zoom sweep, the rendered label text read back off the DOM,
  and the exported sheet — PDF-PARITY) and **diagnose-pond-pan** (the paired before/after probe this was
  found with).
  `calloutLayout.js` — pure text-box/callout box geometry: auto-size or wrap-to-width (B913).
- **Parcel-chrome declutter trio (NEW-1/NEW-2/NEW-3) — the FIXED-SIZE sibling of the label engine above.**
  `labelLayout` reflows labels; these three govern the chrome that CANNOT reflow, whose count is set by how
  finely the boundary was digitized rather than by how much room the screen has.
  `setbackChips.js` — `setbackChipRuns`: contiguous edges sharing a setback VALUE, broken where the running
  signed heading spreads past ~50°, collapse into ONE labelled run anchored on its LONGEST edge. Distinct
  from `edgeRuns.js` (the ±7° geometric-SIDE model, which still drives run-length dims + B912 side resizing
  and is deliberately untouched): a filleted corner is a dozen geometric sides but one thing to label.
  `screenDeclutter.js` — `spaceOut` (greedy min-separation thinning, grid-hashed) + `cornerTurns` (per-vertex
  corner-ness). ONE helper, reused by the setback chips, the side-length dims AND the vertex handles — never
  fork a second one. Display-only and re-decided every frame off the live zoom, so zooming in reveals detail.
  `polylabel.js` — pole of inaccessibility; the parcel acreage badge's anchor (always inside the ring, unlike
  the vertex average it replaced). Guards: the repo-root `test/` suite **parcelDeclutter** + the ui-audit harness
  **verify-parcel-declutter** (the Weld County curved-corner repro, with screenshots).
  **`setbackRoles.js` is the REGULATORY tier ABOVE both of those (B1191) — read it before touching how a
  setback is edited.** A zoning ordinance names FOUR setbacks (Front / Side / Street side / Rear); the two
  geometric groupers still produced fifteen rows on the owner's real parcel. It auto-assigns a role to EVERY
  edge from frontage geometry (street abutment → front → corner street side → rear → side), the user's own
  assignment in `pc.roles` always wins, and `roleGroups` is the four-row panel model. **A role is a LABEL
  and never an input to a measurement** — nothing here writes a setback VALUE, which is what keeps the
  NON-NEGOTIABLE ("no site's computed buildable area may change") true by construction. Street side is only
  ever assigned from real road geometry, never guessed. Roles reason over runs built from a FLAT value
  vector on purpose, so typing a setback can't reshuffle the labels. `parcelOffset.js` holds the setback
  ring's inward offset + `lineIntersect`, lifted out of `SitePlanner.jsx` unchanged so the buildable envelope
  is provable in a unit test. Guards: the repo-root `test/` suite **setbackRoles** (which runs the REAL
  production snapshot `test/fixtures/weldParcelProduction.json`, site `sms7v3ua7ksy`) + the ui-audit harness
  **verify-setback-roles** (that same geometry, driven in a browser: default tier, auto-assignment,
  correction, one-input-many-sides, role chips, and the ring proven identical across all of it).
  **`roundabout.js` (NEW-5) — a roundabout at a road TERMINUS, and it is real rather than decorative
  in three specific ways.** (1) The pavement math knows: `roundaboutArea` is the ANNULUS (the island
  is landscaped, so counting it would overstate impervious cover — which is what detention is priced
  off), and `legTrimFor` shortens each approach leg by the HALF-CHORD √(R²−half²), not the radius, so
  the strip's square end face lands ON the arc across its full width instead of leaving a lens-shaped
  void that closes as a phantom hole. (2) The curb engine knows: the circulatory roadway is emitted as
  arc SECTORS whose UNION is the annulus — union-only, the one op `dissolveRings` is proven on — so the
  central island falls out as a genuine PolyTree hole and the whole thing is one region with one
  continuous outline. (3) The design vehicle decides the size: `roundaboutDiameterFor` is
  2·(turning radius) + one circulatory width, clamped into the class's published FHWA/NCHRP band, so an
  auto aisle, a fire lane and a WB-67 truck route get three different circles — and `public` takes a
  FIXED band value because its `minRadius` is a horizontal CURVE radius, not a turning radius, and
  feeding it to the formula gives a 390 ft circle on a site road. ⛔ A curb return's closing polygon
  must run through the CORNER, never straight between the two tangent points: a direct chord passes
  inside the fillet circle, self-intersects, and the union silently drops the ring — the return then
  floats as its own island. Bonded by construction: `el.roundabout = {end, d}` stores no position, so
  moving the road re-derives everything. Guards: the repo-root `test/` suite **roundabout** and the
  e2e spec **road-roundabout** (which DRAWS the road with the tool — a seeded road never resolves the
  initial view fit, so every screen coordinate comes out NaN).
  `roadGeometry.js` — centerline road curves + junction primitives (pure): `teeGeometry` returns the
  ADDITIVE curb-return `wedges` a junction contributes. `roadNetwork.js` — the DISSOLVED road surface
  (clipper union of every connected strip + wedge → one region, one outline, per cluster) plus the
  curb-stripe trimmer. A road connection is a boolean union, NOT a patch painted over a seam — read
  roadNetwork.js's header before touching anything junction-shaped.
  **NEW-1/NEW-2 — THE ROAD IS THE CURVE, NOT ITS CHORDS. Two rules, one root cause.**
  **(a)** Anything that hit-tests, projects onto, or branches off a road must go through
  `projectToRoadCenterline` (or `roadCenterlineTagged`, which pairs the dense polyline with the
  control-point segment that owns each piece of it) — NEVER `projToSeg` over `el.pts`. A chord cuts
  the corner, so on the truck-route default radius the drawn pavement stands ~36 ft off the nearest
  chord on a 40 ft road: the old right-click hit test could not reach it at any zoom, and
  `startRoadBranch` welded branches to points the road does not pass through.
  **(b)** A junction VERTEX renders SHARP. `roadJunctionVerticesOf` (SitePlanner) collects every
  vertex another road tees onto and feeds it to `roadDenseCenterline`'s `sharpAt`, because a
  junction is where two centerlines MEET and a centerline fillet carries the road clear of the node
  the branch hangs off. The junction then owns ALL the rounding at that node, including the through
  road's own turn — which is what `nodeJunction`'s `roundOwnCorner` is for; without it the road's
  own mitered corner is the one square corner in an intersection full of curb returns. Both are
  no-ops on a collinear junction vertex, so the ordinary straight tee is untouched.
  **⛔ Do NOT verify anything here against a two-straight-roads mock** — on a straight road the chord
  IS the road and every defect in this family is invisible. The repo-root `test/` suite
  **roadCurvedJunction**, the e2e spec **road-split-curved** and the ui-audit harness
  **verify-road-split-curved** all drive the owner's real geometry (Goose Creek "Plan 1 (copy)" +
  Tsakiris / Concept A), and the harness shoots every junction twice — the second pass at reduced
  fill opacity, where a residual stacked edge shows and full opacity hides it.
- Terrain pipeline (B703–B706) — **LOADED ON DEMAND (B1095): `terrainLazy.js` is the ONE entry
  point** (`loadTerrain()` cached import + the synchronous `terrainNow()` the per-move cursor
  sample reads + the `contourHover` router); nothing on the boot path may static-import
  `terrainLayers.js` again, and `terrainGate.js` exists so the layer registry can read the zoom
  gate without dragging the pipeline back in. `contourTrace.js` holds the worker-only
  marching-squares tracer (the sole `d3-contour` consumer) — keep it out of `contours.js`.
  `demGrid.js` / `contours.js` / `flowField.js` (pure math,
  worker-safe) + `lercGrid.js` (the LERC codec, split out in B1042 so `lerc` stays OFF the boot
  bundle — static-imported by the worker, dynamic-imported on the main thread)
  + `terrainWorker.js` (the repo's first Web Worker — import list is test-guarded)
  + `terrainLayers.js` (Leaflet glue, grid LRU for the hover elevation readout);
  `elevation.js` — 3DEP getSamples (cross-section tool + point readout, survey-ft; a caller
  signal NEVER disables the timeout — that is how a hung socket used to leave the readout
  in-flight forever). Cursor readouts (NEW-1/NEW-2): `contours.js` owns the pure hover
  HIT-TEST (`buildContourIndex`/`hitContour`) so the polylines stay `interactive:false`;
  `terrainLayers.js` owns the ONE transient hover label (its own sublayer + `setContourHover`,
  fed from each surface's EXISTING throttled cursor move — never a second listener; **B1140:** it is
  anchored at the CURSOR and OFFSET off it via `contours.hoverLabelPlacement`, flipping quadrant near
  a canvas edge and clearing a reserved bottom row, because painting it at the hit point put it under
  the pointer glyph — and the offset span must be `position:absolute`, or the marker div's line-box
  strut drifts it a few px and the edge arithmetic stops being exact) and
  `warmCursorGrid` (the cursor's lattice tile, pulled regardless of layer toggles and of the
  z16 gate — that gate is a cartography rule about 1-ft LINES, not a reason to refuse a POINT);
  `groundReadout.js` + `components/CursorChip.jsx` are the ONE composition + the ONE chip both
  surfaces paint (four honest existing-grade states — it may never render as ABSENCE — plus
  Prop from `proposedSurface.sampleProposedAt`, which walks the SAME `grid.owners` the B826
  earthwork rows price off, so chip and ledger cannot drift).
  `fbcdWse.js` — FBCDD Atlas-14 DRAFT WSE samplers (Fort Bend): 0.2% mosaic → `derivedWse02Ft`,
  per-watershed 100-yr multiplex → `derivedWse1pctFt` (B807).
- Detention outlet / routing / criteria tier (NEW-A, Phase A): `detentionCriteria.js` (the versioned
  jurisdiction criteria registry — cited outlet/geometry criteria, referencing `detentionRules.js` for
  the verified release/storm/freeboard facts; audit + overrides), `outletStructure.js` (per-pond
  orifice/weir/restrictor model + stage→discharge rating curve), `stageStorageDischarge.js` (pairs
  `pondGeom` storage with the outlet curve), `pondRouting.js` (modified-Puls reservoir routing proving
  Post ≤ Pre per storm), `receivingWater.js` (nearest NHDPlus HR receiving water for the outfall +
  easement flag). All pure/Node-tested.
- Public-data inputs tier (NEW-B, Phase B): `curveNumber.js` (SCS CN runoff), `soils.js` (SSURGO
  Soil Data Access — HSG + seasonal-high water table; SDA proxy-blocked in sandbox → live-verify),
  `tailwaterSource.js` (PR-N/O5 — the outfall receiving-water source ladder: district channel →
  FEMA InFRM est-BFE → USGS gauge → normal-depth → terrain channel-flowline, NEVER site grade;
  the grade placeholder deadlocked every pond, so `deriveTailwater` rejects any grade-equal
  candidate and returns UNKNOWN when no real below-grade source resolves),
  `groundwater.js` (wet-vs-dry pond feasibility from combined SSURGO + TWDB depth-to-water),
  `subsidence.js` (Harris-Galveston / Fort Bend subsidence-district cited flag registry),
  `pfdsClient.js` (NOAA Atlas-14 rainfall via the `functions/api/pfds.js` proxy — live-reachable),
  `twdbWells.js` (TWDB observation-wells interface, endpoint live-verify pending). All pure/Node-tested.
- Deal-screens tier (NEW-C, Phase C): `upstreamArea.js` (extends `flowField.js` D8 → flow-accumulation
  over the 3DEP DEM → upstream contributing area + the offsite-drainage "engineer's check" flag) +
  `regionalDetention.js` (regional-detention / fee-in-lieu cited registry + on-site-vs-fee buildable-SF
  comparison). Pure/Node-tested.
- Pond optimizer affordance (NEW-1, 2026-07-28): `pondOptimizeAffordance.js` — decides WHEN the
  optimizer is offered (POSSIBILITY only: drawn ring · known requirement · resolved split — NEVER
  verdict tone; the old tone coupling is what made the button vanish from an all-green panel) and
  whether a smaller basin is worth a line (`materialAlternative` → null means render NOTHING).
- Flood-level sensitivity (NEW-4): `wseSensitivity.js` — sweeps the SAME `evalAtWse` the live panel
  uses across criteria-configurable steps above the governing flood surface; absolute deltas only.
- Screening BFE (NEW-3 → completed): `screeningBfe.js` — the app's FIRST real hydrology + hydraulics
  (SCS unit-hydrograph peak, Manning normal depth over a terrain-sampled section). Every other
  "derived" WSE in this codebase reads FEMA's published number; this one computes one. **Now LIVE-WIRED**
  by `screeningBfeSite.js` (the four inputs: a D8 watershed delineated over a WIDE coarse 3DEP window,
  NOAA Atlas-14 rainfall via `pfdsClient`, SSURGO soils via `soils.js` + the `functions/api/soils.js`
  proxy, and a section from `channelSection.js`) — producing BOTH the 1% and the 0.2% (500-yr)
  elevations Waller ordinance §5.C(3) mandates, from ONE derivation. It reaches the panel as a
  `wseProviders` registry entry (`screening-bfe`), so the existing estimate row, provider labels and
  cross-provider delta render it with no new surface. `channelSection.js` also carries the
  watershed-TRUNCATION guard: a basin running off the terrain window returns an honest unknown rather
  than an understated flood level. `screeningDeclined` (B1089) is the ONE place the study's honest UNKNOWN becomes owner-facing copy:
  a short NAMED STATE for the visible line plus a REASON-SPECIFIC implication behind the fold — a flat
  reach says outright that screening has run out and a sealed H&H model is required (tied to §5.C(3)),
  while an unreachable source deliberately says the opposite. It is rendered by the est-BFE line, whose
  condition reads `bfeFt` only POSITIVELY: a committed estimate must never suppress the fact that a
  better method was tried and declined (that suppression WAS the B1089 bug).
  The §5.C(3) submittal trigger itself is a VERIFIED, firing rule —
  `floodplainRules.waller.bfeDataRequirement` + `bfeDataRequirementFor` / `atlas14Mandated`.
- Pond economics optimizer (NEW-D, Phase D): `pondOptimizer.js` — searches depth × placement pond
  configurations (deeper-smaller vs shallower-bigger, pond-cut-as-pad-fill dirt balance) under
  constraints (max depth, Phase-B groundwater ceiling, 30-ft maintenance berm, pipeline-corridor
  exclusions) and ranks by earthwork $, land-take acres, and buildable-SF recovered — reusing
  pondGeom/pondSizing machinery. Pure/Node-tested.
- Yield storage-truth tier (Cowork review B1019–B1028): `pondStageModel.js` is **THE** per-pond
  stage-storage / elevation-band representation — stage table, the declared non-overlapping
  detention/mitigation duty split, the outfall-invert split, both gravity-drain tests, and the
  prism-vs-extrusion delta. Detention, mitigation, drawdown, gravity and cut/fill all READ it;
  nothing re-derives storage from a footprint.
  **⛔ B236592 — IT IS MEMOISED, AND EVERY CLIPPER CALL BENEATH IT IS TOO. Read this before touching
  `pondStageModel.js` or `pondOffset.js`.** `drainFacts()` in `SitePlanner.jsx` is *deliberately*
  GATING rather than memoising, so with the Yield panel docked this model was rebuilt **156 times per
  pond per pan gesture** on ponds nobody had touched — 275,184 `offsetInward` executions in ONE pan,
  and **55,631 ms of a 55,760 ms gesture** inside clipper-lib's intersection sweep. Compounding it,
  `pondElevations` was re-derived *inside its own consumer* (`stageTable` asks once, and twice more
  per band via `areaAtElev`), so a 7-band pond paid the 29-execute pinch-off search 15 times for a
  constant — **that is the term that LOOKED superlinear, and it is a constant re-derived a linear
  number of times.** The fix is memoisation and **no formula was touched**: keyed on the ring's
  IDENTITY (the planner replaces `points` wholesale on edit, never mutates in place) plus det/opts by
  VALUE, so the key IS the inputs and a stale engineering number is impossible — which is the very
  property `drainFacts`'s gating comment exists to protect. Result **55,760 → 505 ms per pan** with
  the owner's surveyed rings untouched and the canvas byte-identical.
  **⚠ THE RESULTS ARE SHARED — read-only, like every memo in this tree** (`offsetInward` returns
  cached ring arrays; audited: every consumer measures them or maps them to a path string).
  **⛔ TWO THINGS THIS REFUTES, so they are not re-chased:** `interiorFitter` costs **0.5 ms** of that
  gesture and is EXONERATED (B221761's memo works); and **there is no superlinear per-vertex law** —
  collinear midpoint insertion, which raises vertex count while holding area, perimeter, bbox and the
  drawn path exactly, measures an exponent of **0.20**. Decimation preserved the bounding box but not
  the CONCAVITY that loads clipper, which is why `docs/PERF-REAL-PLANS.md` §5.5 read a recurrence as a
  vertex law; §5.6 is the correction. Guards, all counting INVOCATIONS rather than milliseconds:
  the repo-root `test/` suites **pondViewIndependence** (mutation-checked 16 green → 4 red) and
  **pondStorageGoldenMaster** (78 assertions of EXACT equality — these numbers size his basins, so
  there is no tolerance), plus the ui-audit harnesses **count-pond-invocations** (`--assert`: a pan
  recomputes NO pond geometry, and the cached lookups must be OBSERVED so an empty report cannot pass
  as a clean one) and **profile-pond-ring**.
  **⛔ B221763 — AND THE POND LEDGER PASS ABOVE IT RESOLVES ONCE PER MODEL CHANGE TOO, gated on
  `lib/pondLedgerKey.js`.** B236592 made the leaves free and left the RECURRENCE: the render body
  still rebuilt every pond's ledger entry once per render — measured at **254 calls each** of
  `usablePondVolume` / `incrementalExcavationCf` / `excavationVolume` on one pan of a two-pond
  plan, and **0** after. The key is a **VALUE signature**, not a `useMemo` dep array, for two
  reasons that both matter: a hand-maintained dep list that misses one input is a stale
  engineering LEDGER (this item's own filed fear), and most of these inputs (`fmElev`, `pondAuto`,
  `detRegime`) are FRESH OBJECTS holding identical values every render, so `Object.is` calls them
  changed 100% of the time and a dep array would never have hit. The one input keyed by IDENTITY
  is the pond ELEMENT — safer than any field list, because it changes on edits to fields nobody
  thought to enumerate. `accumulatePondLedger` rides the same boundary via an identity cache.
  Guards: the repo-root `test/` suite **pondLedgerKey** (a planted change in EVERY declared input,
  GENERATED from `POND_LEDGER_INPUTS` so a new input with no fixture fails on the spot;
  mutation-proven three ways) and `count-pond-invocations --assert`, where `pondLedgerSignature`
  sits in `MUST_BE_PRESENT` so an empty report cannot pass as a clean one.
  Its consumers: `storageReconcile.js` (claimed
  service vs storage that physically exists — a hard FAIL on a double-count), `drawdownTime.js`
  (time-to-empty at the allowable release rate), `mitigationBands.js` (the 1-ft hydraulic-equivalence
  band ledger, fed by `floodplainMitigation`'s opt-in `bandSpans`), `floodAdministrator.js` (who
  governs the floodplain + the BFE implied by an FFE), `apronElevation.js` (the truck court, checked
  apart from the pad), `cutFillBalance.js` (borrow-driven vs genuine storage slack). All pure/Node-tested
  (one suite + one headless render harness, both named "yield-storage-review").
- `detentionRules.js` — Houston-MSA detention criteria as versioned rule records + the
  drainage-authority resolver, tier/regime assessors, pond auto-size solvers (B636–B642,
  code-labeled B629–B635; pure, injectable fetch/cache — mirror of `jurisdiction.js`). `pondGeom.js` holds
  `detentionStorage` (the pond stage/volume calc shared by panel, yield metrics, solver) plus the
  B708 anchored tier (`bandedStorage` / `usablePondVolume` — the ONE per-pond usable/dead split).
- Floodplain suite (B707–B712): `floodplainRules.js` / `floodplainMitigation.js` (compensating-storage
  engine, pure; incl. the NEW-1 Waller floodway-buffer screen + the NEW-2 Zone-A boundary-grade WSE
  estimator + the NEW-3 HAG proxy), `pondCriteriaRules.js` (berm/slope/freeboard criteria),
  `buildability.js` (FFE/LOMR-F; `when`-conditioned multi-basis rows + `suggestedFfe`),
  `pondSizing.js` (NEW-4 two-target pond sizing assistant over the B708 bands),
  `pondChangeSummary.js` (B909 round 4 — pure before/after delta rows + the atomic gap-proposal
  sentence for the persistent "what changed" card after ⚡ Design pond),
  `pondVerdict.js` (the ONE derivation of the pond inspector's detention + mitigation verdict rows:
  the headline NAMES its ledger, buildability + the over-provision "over-dug" state ride a demoted
  qualifier line, and the criteria-configurable over-provision slack `overdugAcFt` lives here —
  `ledgerBalancer.js` re-exports it and the print sheet reads it, so screen/print/balancer can't drift),
  `pondSectionModel.js` + `components/PondSection.jsx` (PR-L — the ONE developer-readable pond
  cross-section: pure geometry + collision-free labels → responsive SVG, used by BOTH the Optimize
  card and the pond inspector),
  surfaced via the Yield → Stormwater collapsed verdict groups (B824 — ONE drainage home; the old Site Analysis sibling card was merged in and deleted; Analysis keeps a link row).
  Estimated-BFE providers for unstudied Zone A (B882): `wseProviders.js` (pure pluggable registry +
  precedence resolver: district → FEMA InFRM EBFE → grade) + `ebfe.js` (FEMA InFRM EBFE /identify
  sampler) + `hcfcdWse.js` (HCFCD MAAPnext WSE sampler, Harris) + `estimateChallenge.js` (the pure
  sanity-check / ±1 ft sensitivity band / cross-provider disagreement "challenge the estimate" layer).
- Grading/earthwork tier (B808/B809/B825/B826): `gradingRules.js` (per-surface-class slope registry
  with provenance) + `proposedSurface.js` (pure auto-grade engine: per-element planes, composite
  cut/fill lattice, balance assist, ADA-legal vs screening violations) + `mitigationHeatmap.js`
  (engine-truth cell painter — B809 fill-depth mode AND the B826 cut/fill diverging mode); earthwork
  rows live in Yield → "Earthwork cost (screening)"; mitigation prices fill at the proposed surface
  when it exists (`fp.surfaceAt`, labeled), flat pad as the fallback.
- Yield-panel provenance (B895): `provenance.js` — the six-word SourceTag vocabulary (CODE/PLAN/
  SURVEY/ESTIMATE/YOURS/UNVERIFIED) + color-token map + `classifyWseSource`/`classifyVerified`
  (pure mappings from signals the engine already computes — WSE_PROVIDER_LABEL codes, the
  `pondAutoValues` `verified` flag — to a tag). Consumed by `components/SourceTag.jsx` (the
  right-aligned pill + Basis popover), `components/SourcesLegend.jsx` (the one "Sources ⓘ" panel
  legend), `components/WatchOutChip.jsx` (the one ⚠ item-specific-risk rendering), `components/
  ActionLink.jsx` (the accent-colored "do something" affordance, distinct from a passive tag), and
  `components/YieldFooterDisclaimer.jsx` (the ONE persistent screening disclaimer).

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
  for export-only code. Split by tier, don't hope for shaking. `exportLabelScale.js` (B1085) is the ONE place that decides what scale the
  LABEL tier reasons at: the view on screen, the SHEET's own px-per-foot on an export pass — so
  declutter/LOD/collision, label sizes and stroke-zoom are a function of the plan and the paper,
  never of the live zoom. It IS on the boot path (SitePlanner imports it statically, ~1 KB pure). PDF-PARITY: `printMetricPairs`/`printStormwaterBars` deliberately stay in
  `SitePlanner.jsx` so screen and sheet read one derivation.

- **`lib/numEditBox.js` + `components/NumEditField.jsx` (NEW-1) — the canvas's ONE inline numeric
  editor, and the rule that it may never be bigger than the control it edits.** Clicking a setback
  chip turns THAT CHIP into the field: same footprint, same type scale, same corner, and the static
  chip is suppressed while its editor is open, so the number can never be on screen twice. The
  editor is SHARED (road width · element dimension · overlay trace length · aerial calibration); a
  caller with no chip gets the FLOATING fallback — same styling, brought to chip scale, OFFSET off
  the anchor so it doesn't sit on the geometry being measured. Three things not to undo: **(a)** the
  chip metrics live in `numEditBox.js`, not at the render site, so plate and field cannot drift;
  **(b)** the field is `display:block` — an `<input>` is inline-level, so inside a `<foreignObject>`
  the line-box strut drifts it several px below the plate (measured; the same trap B1140 hit with the
  contour hover label); **(c)** `input[type=number]` spinners are suppressed app-wide in the
  global stylesheet (repo-root `src/`) and replaced by ArrowUp/ArrowDown — the UA chevrons are bigger than the digits on a pill this size.
  Guards: the repo-root `test/` suite **numEditInPlace** + the ui-audit harness
  **verify-numedit-inplace** (real browser, two zooms × both themes, all three floating callers,
  with the parcel grips proven still clickable while the editor is open).

**Conventions:** feet everywhere internal (convert only at the map boundary); theme tokens
never raw hex; inline editors never `window.prompt/confirm/alert`. See `/CLAUDE.md` KEY DECISIONS.

<!-- Keep this pointer current: if you rename/move/delete a key file in this folder, update the
     lines above in the same commit. The doc-pointer-audit check fails CI on a stale reference. -->
