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
- `layers.js` + `components/LayerPanel.jsx` — map-layer system; `layerPrefs.js` (per-site Layers-panel
  toggle memory — NEW-1, sparse on/off overrides restored on open + persisted on toggle); `coverage.js` (coverage engine);
  `arcgis.js`/`counties.js`/`layerRequest.js` — GIS plumbing; `gisCache.js` — screening cache;
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
  (Storage backup) + `dxf/` (worker parse via `dxf-parser` + entity→SVG render + true-units auto-scale)
  + `convertClient.js` (DWG→DXF through the B238 convert service, gated on `VITE_CONVERT_URL`).
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
- `bondRemap.js` — the ONE id-bearing bond inventory (`attachedTo` · `forCourt` · `forTrailer` ·
  `prevZone`) + the remap rule EVERY copy path must use (B1124). Both copy paths used to remap only
  `attachedTo`, so a duplicated building's trailer parking stayed bonded to the ORIGINAL building's
  truck court — and `relayoutSide` walks the chain from the court, so that trailer was never laid out
  at all ("hovering by itself"). Rule: a reference inside the copied set is remapped; one outside it
  is DROPPED, never left dangling to a foreign element. A non-string value is an inert legacy flag,
  not a bond. `siteModel.normalizeCrossHostBonds` is the load-time repair for plans already copied,
  and it must run BEFORE `normalizeZoneAlongLen` (which needs a walkable chain to judge a pin against).
- `planClipboard.js` — the ONE general canvas clipboard (NEW-2/NEW-6): collect the current selection
  (elements expanded to their `attachedTo` assembly, so a building brings its truck court / trailer
  parking / dock zones / bump-outs), then paste with fresh ids, bonds remapped INSIDE the copy, and
  relative geometry preserved. A pasted parcel arrives INACTIVE by design (can't double-count site area).
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
  ring was drawn while the boundary beside it had full standards. Both the ring AND its dimension
  chip read this one derivation; the defaults ARE the historic look (weight 1.25, `dashed` = "7 6"),
  and `parcelDefaultStyle` stamps `sbStroke`/`sbWeight`/`sbDash` only when they DIFFER from it, so an
  upgraded plan gains no keys and renders unchanged.
- `zOrder.js` — per-element `z` stacking key utilities (`nextZ`/`sortByZ`/`normalizeZ`/`ensureZ`, B671).
  `arrange.js` — pure z-order "Arrange" (`reorderByZ`/`arrangeFlags`, B820): Bring-to-Front/Send-to-Back
  over a peer set (a building reorders within its `Z_LAYER` band, a markup within the markup layer;
  a markup can also be sent behind the elements). Wired via `arrangeSel` + the right-click menus + the
  ⌘/Ctrl+]/[ chords in `SitePlanner.jsx`.
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
  (`footprintLabelLine`) and must never be pre-joined — a joined string has no rungs left to take.
  Guards: the repo-root `test/` suites **labelFitLadder** (the invariant, over a battery of hostile shapes,
  plus a source guard that the ring/`mustLabel` keys still reach `layoutLabels`) and **pondLabelFit** (the
  real Goose Creek / Tsakiris / Bain rings), plus the ui-audit harness **verify-pond-label-fit** (the real
  plan, a zoom sweep, and the exported sheet — PDF-PARITY).
  `calloutLayout.js` — pure text-box/callout box geometry: auto-size or wrap-to-width (B913).
  `roadGeometry.js` — centerline road curves + junction primitives (pure): `teeGeometry` returns the
  ADDITIVE curb-return `wedges` a junction contributes. `roadNetwork.js` — the DISSOLVED road surface
  (clipper union of every connected strip + wedge → one region, one outline, per cluster) plus the
  curb-stripe trimmer. A road connection is a boolean union, NOT a patch painted over a seam — read
  roadNetwork.js's header before touching anything junction-shaped.
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
  nothing re-derives storage from a footprint. Its consumers: `storageReconcile.js` (claimed
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
  helpers (`printSheet.js`, `sheetFurniture.js`, `exportStyle.js`, `imagePdf.js`, `kmzExport.js`,
  `overlayVectorSvg.js`) must NOT gain a static importer on the boot path or they rejoin the
  critical-path chunk. `exportLabelScale.js` (B1085) is the ONE place that decides what scale the
  LABEL tier reasons at: the view on screen, the SHEET's own px-per-foot on an export pass — so
  declutter/LOD/collision, label sizes and stroke-zoom are a function of the plan and the paper,
  never of the live zoom. It IS on the boot path (SitePlanner imports it statically, ~1 KB pure). PDF-PARITY: `printMetricPairs`/`printStormwaterBars` deliberately stay in
  `SitePlanner.jsx` so screen and sheet read one derivation.

**Conventions:** feet everywhere internal (convert only at the map boundary); theme tokens
never raw hex; inline editors never `window.prompt/confirm/alert`. See `/CLAUDE.md` KEY DECISIONS.

<!-- Keep this pointer current: if you rename/move/delete a key file in this folder, update the
     lines above in the same commit. The doc-pointer-audit check fails CI on a stale reference. -->
