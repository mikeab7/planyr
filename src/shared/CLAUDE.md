# `src/shared/` — cross-workspace modules (folder pointer)

Code used by more than one workspace. Keep edits here small and additive — a change ripples
into every consumer. Root rules in `/CLAUDE.md`; deep detail in `/docs/REFERENCE.md`.

**Subfolders**
- `markup/` — the ONE shared markup/measure/selection engine. `tools.matrix.js` is the
  machine-checkable spec (**never edit it to make a test green** — fix the code). Pure modules:
  `geometry.js`, `markupModel.js`, `measure.js`, `hitTest.js`, `propertySchema.js`, `selection.js`,
  `markupStyle.js` (per-object style + kind-keyed fallback, shared by renderer + draft preview, B736);
  `textWrap.js` (callout text wrap + box-fit measurement — greedy word-wrap, force-break on an
  unbroken long word, `calloutBoxMetrics` sizes the box to the longest actual line; heuristic +
  real-`<canvas>` measurers, B909); renderers `MarkupRenderer.jsx`, `PropertyPanel.jsx`,
  `SelectionChrome.jsx`.
- `coordinates/` — the shared coordinate spine. `index.js` is the original hardcoded EPSG:2278
  projection — **leave it alone**; `statePlane.js` (NEW-3) is the multi-zone engine beside it
  (TX South Central 2278 · CO North 2231 · CO Central 2232, per-county resolution incl. the
  documented Broomfield decision) and reproduces `index.js` **bit-for-bit** for Texas, which is
  what makes Colorado additive rather than a refactor — the statePlane suite asserts that with `Object.is`. `scaleFactor.js` (NEW-4) reports the grid × elevation combined factor and detects a
  ground-coordinate survey; it deliberately never APPLIES the factor. Read-only screening use
  today; grow additively, not a planner rewrite.
  **⛔ B290241/B290242 — `statePlane.js`'s FIRST production consumer is `deedAlign.gridConvergenceDeg`,
  and two things it learned the hard way.** (a) **A CONVERGENCE OR A DISTANCE MUST COME FROM THE
  SITE'S OWN ZONE** — γ = n·(λ − λ₀) is a function of the cone constant and central meridian, the two
  things that change when you leave the zone, so asking `index.js` (hardcoded EPSG:2278) for a
  Colorado bearing answered **−2.885°** where Colorado North answers **+0.378°**: 75 ft of deed drift
  across a 1,320 ft run, announced in a toast as a confident number. (b) **`slugCounty` STRIPS THE
  `co_` ROUTING PREFIX** — a plan persists `co_denver`, not `denver`, and without the strip
  `zoneForCounty` matched nothing and `resolveZone` fell through to the coarse point envelope, which
  this file's own comment says cannot separate the interleaved Front Range counties (Denver resolved
  to NORTH). Keep it in step with the Colorado regions module's slug (site-planner `lib/`). `resolveZone` returns an honest **null**
  outside every modelled zone and callers must refuse rather than rotate — 0 is a real answer here
  ("on the central meridian"), so it may never double as a sentinel. **Still unconsumed and worth
  knowing before you cite them as working:** `scaleFactor.js` (B290250) and, outside the deed path,
  the multi-zone engine — the site-planner's proximity screen still measures every screening distance
  through the Texas cone, which over-reports Colorado by **1.93%** (B290247).
- `files/` — `chunkedUpload.js` (any-size chunked Drive upload via /api/uploads/* — pure chunk
  math + the retry/resume loop, B409 rework) + `uploadQueue.js` (the upload-tray queue model).
  `middleTruncate.js` — split a label into head + a PINNED tail, so a list of names that differ only
  at the end ("… - p1" … "- p32") stays readable when it doesn't fit; plain CSS ellipsis cuts exactly
  the distinguishing part. Rendered by `ui/MiddleTruncate.jsx` (flexbox, not measurement — correct at
  any width, through a rail drag or a zoom, with no measure/re-render loop).
  Pure PDF/sheet parsers: `titleBlockParse.js`, `sheetMeta.js`, `sheetTitleSet.js`
  (set-aware sheet-title refinement — cross-page boilerplate + known-project demotion, B659),
  `sheetGroups.js`, `sheetNotes.js`, `detailRefs.js`, `matchProject.js`, `sheetScale.js`,
  `matchLineFit.js`, `ocrMatchLines.js`. The B340 auto-assembly CV engines (pure; the browser extraction seam is
  dormant, verified live): `scaleBarRead.js` (graphic scale-bar → ft/unit), `edgeGeomMatch.js`
  (vector match-line edge fit), `legendUnion.js` (union sheet legends into the composite key).
  The **deed-import readers** that feed the Site Planner metes-and-bounds plotter: `docxText.js`
  (.docx + the `readDeedFile` dispatcher), `docText.js` (legacy binary .doc, OLE/CFB), and
  `pdfText.js` (PDF embedded text layer, lazily loaded). `deedTextReflow.js` is the shared
  wrapped-line-rejoin pdfText.js and `deedOcr.js` both use.
  **⛔ B768160 — a SCANNED deed PDF (no text layer) is now handled too, via OCR, not just refused.**
  `pdfText.js`'s "looks scanned" error carries a `.scanned` marker; the Site Planner workspace's
  `readDeeds` routes that case to `deedOcr.js` (a lazy-loaded Tesseract engine — never a static
  import, so it and its canvas-render sibling `pdfRaster.js` (a SEPARATE setup from `pdfText.js`'s
  text-only one) never ride the boot bundle). `deedOcr.js` never plots from OCR output directly —
  it PRE-FILLS the same editable paste box, with low-confidence tokens highlighted
  (`ocrConfidence.js` + the workspace's own paste-box component) and a targeted repair pass
  (`deedOcrRepair.js`, pure/Node-tested — THENCE/COMMENCING/BEGINNING fuzzy correction, DMS
  punctuation, quadrant-glyph and doubled-degree-sign fixes, a lost-decimal-point distance flag).
  The closure error every deed path already computes is the SAFETY NET: when a plotted OCR'd
  traverse doesn't close, `ocrConfidence.culpritCalls` names the specific course(s) most likely at
  fault instead of just drawing a wrong polygon. **AUDIT-FIRST finding, worth knowing before
  touching the site-planner workspace's metes-and-bounds parser:** the real construct set a
  recorded deed exercises (curves with a chord bearing + radius/central-angle/arc, "passing at …
  for a total distance of", a parenthetical offset note, a monument "bears" tie call, SAVE AND
  EXCEPT, a numbered "following N courses" sub-list) was already handled correctly by the SAME
  parser every non-OCR path uses — proven against a construct-coverage fixture in the repo-root
  `test/` suite. What was genuinely missing was a wrapped-line REFLOW step for OCR text (a course
  that word-wraps across several printed lines splits into unparseable fragments unless rejoined
  first — `pdfText.js` already solved this for a text-layer PDF; `deedOcr.js` needed the same fix,
  now shared via `deedTextReflow.js`). Measured recognition (a synthetic degraded-scan fixture
  driven end to end in headless Chromium via the repo-root `ui-audit/` harness): 100% bearing
  recovery / 0.6 ft misclosure at a realistic photocopy-scan degradation level; a harsher stress
  level drops per-character accuracy sharply but the CLOSURE CHECK catches it loudly (900+ ft
  misclosure) rather than silently plotting a wrong boundary — which is the whole point of never
  auto-plotting OCR output.
- **⛔ `ui/AppHeader.jsx` + `ui/ProjectBreadcrumb.jsx` — NAVIGATION WINS, and it is the ROW-1 ZONE
  FLEXES that decide it (NEW-2). Read this before changing any of the three.** The owner could not
  switch plans on a laptop: *"the unincorporated / city of Houston / ETJ / Harris County chip is too
  big and it covers it."* He reproduced it — the pill overlapped the plan chip's box by a sliver,
  and `elementFromPoint` along the chip's right edge returned THE PILL'S TEXT SPAN for the last
  stretch of it, **the ▾ caret included**. **NOT a z-index or overlay problem** (the pill is
  `position: static`, `z-index: auto`): plain flex overflow. The cause was `left: flex 1 | centre:
  0 1 auto (max 40%) | right: flex 1` — basis-0 side zones take an EQUAL SHARE regardless of what
  they hold, so navigation was handed less than the breadcrumb needed while the pill sat under its
  cap and never shrank, and the centre's `overflow: hidden` clipped nothing because the pill was not
  over-wide *for its zone*. The rule is now one-directional: **LEFT `0 1 auto` (max 60%)** takes the
  width it needs and shrinks only after the centre has collapsed · **CENTRE `1 1 0%`** takes what is
  LEFT OVER, so its width never depends on its own content · **RIGHT `0 0 auto`** (the account
  controls were never the contended pair). **The stated cost: the badge is centred in the space that
  remains, not in the window.** `CRUMB_MIN_W` is the ONE floor both crumbs read — the site-planner's
  plan chip imports it, because two floors that can drift is how one of the pair becomes squeezable
  again — and the crumb ROW is shrinkable (`0 1 auto`): while it was `flex: none` the zone's
  `overflow: hidden` clipped the last crumb's caret off, the same lost click by another route. The
  phone layout is untouched (the row scrolls sideways there).
  **⛔ B384064 AMENDS THAT STATED COST — "the badge is centred in the space that remains, not in the
  window" WAS the behaviour and is no longer.** The owner: *"now the jurisdiction is not centered"* —
  measured on Clay & Porter at 1600 px, the chip's centre sat 94 px right of the window's, PERFECTLY
  centred inside a slot that was itself off-centre. **Not a regression from the label change (B367296):
  a leftover-space slot has always positioned the chip relative to the side groups, so the chip's
  position has always depended on the project and plan names — proven by measurement, the offset moves
  156.7 px with the BREADCRUMB and 0.0 px with the LABEL.** The centre slot is now taken OUT OF FLOW
  (`left: 50%` + `translateX(-50%)` in a `position: relative` row) — deliberately NOT by giving the two
  side groups an equal flex-basis, which is the exact rule B371361 removed. Its width is MEASURED
  (`ui/headerCenterFit.js`: `rowW − 2 × (max(leftW, rightW) + gap)`, read in a LAYOUT effect off a
  `ResizeObserver`), because out of flow nothing else stops it running back over the plan chip. **Three
  verdicts, never two:** `centered` · `tight` (a wide breadcrumb in a narrow window — back in flow,
  off-centre but readable, which beats a sliver) · `unmeasured` (LOUD-FAILURE, kept DISTINCT so a header
  that stopped measuring cannot hide behind a plausible-looking `tight`); `data-center-mode` publishes
  which is live. The in-flow slack is held by an inert spacer — a growing right zone would measure the
  whole remainder and poison its own bound. Guards: the repo-root `test/` suites
  **headerNavPriority** (source guards on all three flexes + the shared floor) and **headerCenterSlot**
  (the pure bound + all three verdicts + source guards), and the ui-audit harnesses
  **verify-header-center** (the {shortest, longest} label × {shortest, longest} breadcrumb matrix at
  four widths, mutation-proven — 41 of 86 checks red pre-fix) and **verify-header-nav-clickable** — a real `elementFromPoint` sweep of every point of each
  chip's box at 1024/1280/1440/1600, mutation-proven (201/201 points lost pre-fix at 1280 AND 1440).
  ⚠ A CENTRE-ONLY hit test passes on this defect; so does a short jurisdiction string at any width.
- **⛔ `keyboard/keyScope.js` — WHICH SURFACE OWNS THE KEYBOARD, and the correction B3297 made to it.**
  Read its header first; it holds the eight-arm measurement that produced the rule. The one thing to know
  before touching it: **a guard may only refuse a key the focused control can actually use.** A `<select>`
  is a `PICKER`, not a text field, and a range input is a `SLIDER` — neither does anything with Delete or
  Backspace, and both used to swallow them, which is how the owner ended up unable to delete a selected
  area measurement while its inspector was open. What each control consumes is declared in the planner's
  its key-contract module (`CONTROL_CONSUMES`, in the site-planner workspace's `lib/`), and everything not on that short list passes; B746/V258's
  undo-on-a-slider carve-out falls out of the rule rather than being a special case. **`TEXT_ENTRY_TAGS`
  is the one scope that keeps the whole keyboard and must stay that way** — it is the guard B464048 built
  to stop a Backspace destroying a building, and the ui-audit harness **verify-delete-key-scope** re-proves that defect dead
  on every run. The `FIELD` LATCH is likewise narrowed: `data-field-group` marks every value row, so a row
  whose only control is a slider or a dropdown is NOT a typing row.
- `theme/palette.js` — JS mirror of the CSS theme tokens (keep in sync; SVG/canvas can't use
  `var()`). `ui/statusTokens.js` — the single project-status palette source. `ui/controls.jsx` —
  shared control primitives (Button/ToggleChip/IconButton/Field/Section/MenuItem) + the one
  radius/padding/type scale; token-driven, an `accent` prop keeps each module's hue (B657-5B).
  `ui/ColorField.jsx` + pure `ui/colorRecents.js` — the color control: a current-colour CHIP that
  opens a compact picker popover (palette grid → divider → RECENTLY USED, hidden when empty →
  a quiet "Custom…" row that opens the native OS wheel, the only way to reach an off-palette
  colour). The recents list is ONE shared, persisted MRU across every picker, and records exactly
  ONE entry per picking SESSION (`notePick`/`commitPick`) — the live wheel fires per shade, so
  recording each one used to fill the row with intermediates.
  `ui/AnchoredMenu.jsx` — the portal-to-body clamped flyout (placement math is pure, unit-tested
  `ui/anchoredMenuPlacement.js` — `placeMenu`, which hides rather than corner-pins a
  zero-sized/`display:none` anchor, B734). `ui/FloatingPanel.jsx` +
  `ui/PanelChrome.jsx` + pure `ui/floatingPanel.js` — the NEW-1 poppable-panel primitive (a
  left-rail panel detached into a draggable card over the map; clamp/persist/pan-isolation math
  is pure + unit-tested, host wiring lives in the Site Planner workspace).
- `gis/` also holds the two newest cross-workspace pieces, both pure and both worth reading before you
  touch a county or the flood layer. **County ROUTING KEYS (B298403): normalise at the MAP, never at the
  call site.** Two production plans stored `"Harris"`; every `MAP[county]` lookup missed them and, because
  a missing key is `undefined` and every call site has a `|| fallback`, rendered a confident WRONG answer.
  So the county-keyed config maps are wrapped rather than each reader patched — patching readers one at a
  time is HOW the class existed. **⛔ Not the same vocabulary as `floodGroup.countyKey`**, which slugs a
  DISPLAY NAME to letters-only and would turn `co_larimer` into `colarimer`; here whitespace is REMOVED
  (the underscore is a state prefix), so `"Fort Bend"` → `fortbend`.
  **BAKED FEMA FLOOD TILES (B298400–B298402): the model, the drop rule, the tiles-vs-live decision, and the
  NFHL vintage stamp.** ⛔ THE LINE THAT MUST NOT MOVE: **a tile is a PICTURE, never a NUMBER** — tiles are
  generalised, so parcel-scale authority stays with the live FEMA query and the mitigation math never reads
  a tile. The fallback is a property of the pure decision function (every unavailable path answers `live`,
  with a reason), and the ABSENCE RULE differs by source: on tiles "no polygon" means *outside the mapped
  floodplain*, on the live layer it means *no effective flood map here* — opposite risk positions, decided
  in one place. Renderers live in the site-planner workspace; nothing here imports Leaflet.
- `folders/` — the canonical per-project folder tree (B650): `folderTemplate.js` (the one default
  12-category template) + `folderTree.js` (pure flatten / treeify / validate / seed-row builder).
  Shared by the Library editor + the server Drive-mirror; the server-side reconcile executor lives
  under `/server/storage/` and the mirror route under `/functions/api/`.
- `thoroughfare/` — the Thoroughfare-Plan data spine (B720–B721): `classification.js` (canonical
  road-class enum + `normalizeClassification` / `normalizeStatus`), `ingestTransform.js` (pure
  ArcGIS-feature → `thoroughfare_segments` row: crosswalk + Chapter-42 width resolution + WGS84 /
  EPSG:2278 EWKT geometry, reusing `../coordinates`), and `houston.js` (the City of Houston MTFP
  jurisdiction config — endpoint, field map, crosswalk, §42-122 ROW standards). Shared by the DB
  CHECK, ingestion (B721/B722; the runnable adapter lives under `server/ingest/`), the overlay
  legend (B723), and parcel analysis (B724). The Postgres schema lives under the site-planner
  workspace's `db/` folder.
- `storage/` — the device-storage tier (B1427–B1429), governed by /CLAUDE.md → **TIER-BY-REBUILDABILITY**.
  `storageCensus.js` is the per-TIER, per-CLASS census — localStorage bytes + `navigator.storage.estimate`,
  a key→class registry where **every class declares a rehydration source**, and tier-labelled telemetry
  facts. **⛔ The two tiers are NEVER summed** (~5 MB hard cap vs a gigabyte quota; conflating them is what
  mis-diagnosed the crisis). `storageReclaim.js` acts on those declarations and nothing else — it refuses
  the whole pass if a class claims to be reclaimable with no way back, so a reference image with no cloud
  copy survives any pressure (B474). `originStore.js` is a dependency-free IndexedDB accessor and
  `StoragePanel.jsx` the UI — **mounted from the Site route's plan menu, NOT from `AuthPanel` or the
  header gear**: those land in the entry chunk every route downloads, and even a lazy stub there cost
  +0.8 KB on all four routes and breached the Notes route's ceiling in CI. **⛔ Nothing here may import a workspace module** — this is chrome on every
  route, so a module shared with the planner's boot path gets hoisted into a chunk every route downloads
  (measured: importing `gisCache` put 11.3 KB on a plain Site load and breached three bundle budgets).
  That is why the cache is cleared by NAMESPACE and told about it through a window event.
- `viewport/` — the ONE pan/zoom model both canvases drive. `viewportTransform.js` is the math
  (`worldToScreen`/`screenToWorld`/`zoomAround`/`pinchZoom`/`fitView`) — leave its semantics alone,
  the Site Planner and Markup both depend on them meaning the same thing.
  **`viewAnchor.js` (B1449) is the ANCHORED RENDER, and it is the generalisation of B1440's pan
  increment to a zoom.** Geometry is emitted at a HELD view and one group transform —
  `translate(tx ty) scale(k)`, `k = view.ppf / anchor.ppf` — carries it to where the live view wants
  it, so a gesture writes one attribute instead of re-emitting ~1,200 host elements. Three things to
  know before touching it: **(a)** the composition is EXACT and that is a proof, not a pixel diff
  (`anchoredEqualsDirect`, plus the repo-root `test/` suite **viewAnchor**); **(b)** at `k === 1` it emits B1440's
  byte-identical bare `translate` — the pan path is unchanged BY CONSTRUCTION and must stay so;
  **(c)** `ANCHOR_MAX_K` bounds how far the picture may scale before the caller re-bakes, because
  mid-gesture the strokes and type are the anchor's, scaled (the trade the owner accepted).
  `wheelZoomFactor` is the proportional wheel→zoom factor that replaced a sign-only `deltaY < 0 ?
  1.12 : 1/1.12` — a real mouse detent is preserved to the bit, a trackpad becomes continuous.
  **⛔ Its correctness is INVISIBLE AT REST** (`renderView.ppf === view.ppf` there), so the guard is the
  ui-audit gate **verify-midgesture-zoom** — `npm run perf:midzoom`, which fails unless the clean
  run is green AND both deliberate mutants go red.
- **`telemetry/` — error + performance reporting, and two rules worth knowing before you touch it.
  ⛔ FIRST: AUTOMATED RUNS DO NOT WRITE TO PRODUCTION (B270912).** `networkReportSuppression(win)` gates
  the NETWORK write only — the `_recent` ring, `pfTelemetry.recent()` and the IndexedDB capture store all
  still work under test, because several harnesses assert against exactly those. **The detector is
  `navigator.webdriver`, NOT `__PLANYR_E2E`**, and that is measured rather than stylistic: `docs/PERF-PLAN-SWITCH.md`
  §1's "every performance harness sets it" is true of the ui-audit perf harnesses and **false of the e2e
  suite — 62 of 81 specs never set it**, including the top producer of three of the five loudest sources,
  so a flag-only gate would have silenced 19 specs and left every top row untouched. The flag is a second
  door; the gate FAILS OPEN (never silence a real user over a throwing property read). **⛔ The opt-in
  `__PLANYR_TELEMETRY_NETWORK` is not optional plumbing** — `verify-capture-pipe`, including the anti-rot
  arms that prove a BROKEN delivery is loud, runs under automation and would be disabled by its own fix;
  its five arms now guard both directions and are mutation-proven in both. A suppressed send is counted
  APART from an undelivered one (`delivery().suppressed`, `pfRec.state().suppressed`) and the owner's
  button has its own `local` state — an automated run must never claim the server is unreachable.
  **⛔ SECOND: THE SINK REPORTS ITS OWN OUTCOME (B265536); it used to swallow every write failure**, which made
  the recorder able to fail in total silence and made the owner's "that felt slow just now" button
  show ✓ for rows that never left the machine. `clientErrors.sink` returns `{ok, error, attempts}`,
  keeps `lastSend`/`delivery` on `window.pfTelemetry`, retries **once** (one, not a queue), never
  throws into the app, and **never reports its own failure through itself** — that is a loop over a
  broken pipe. `perfRecorderHandle` splits TAKEN from DELIVERED: `requestPerfCapture` answers the
  first, `perfCaptureDelivery` the second, and the button's ✓ waits for the second. `perfCapture.js`
  owns the privacy ALLOWLIST (never a denylist) and the encoder — whose frame floor is a LADDER, not
  a wall (B265541: on a real stall nearly every frame also costs an `fx` pair, and the old wall threw
  the whole episode away on exactly the captures worth having). Proof + what is still unproven:
  `/docs/CAPTURE-PIPE.md`; the layer-arm standing note: `/docs/PERF-LAYERS.md`. Guards: the repo-root
  `test/` suites **capturePipe**, **perfRecorder**, **perfInstrument**, **clientErrors**, plus the
  ui-audit harness **verify-capture-pipe** (`npm run perf:capturepipe`), whose `rejected` arm is the
  anti-rot one — before B265536 it was un-failable.
  **⛔ THIRD: THE TABLE HAS RETENTION NOW, AND ITS RUN LOG IS NOT OPTIONAL DECORATION (B270913).**
  `client_errors_retention.sql` is the applied policy — **90 days** for an ordinary row, **365 days**
  for a perf capture whose `kind` is `"manual"` (the owner pressing "that felt slow just now" is the
  rarest and highest-value row in the table). Both numbers are chosen so the policy **deletes nothing
  today**: 0 of ~5,300 rows are older than 90 days. Which is exactly the trap — a job that silently
  never runs looks identical to one that correctly had nothing to delete, for months. So every run
  writes a row to `public.client_errors_retention_runs` **including a run that deleted nothing** (a
  0/0 row is an EMPTY report; no row at all is an ABSENT one), and
  `public.client_errors_retention_status` names which you have: `never-run` · `stale` · `ok`. **Do
  not "simplify" the insert behind an `if deleted > 0`** — that single change re-creates the entire
  failure mode. Two things to know if you touch the predicate: the manual classifier reads the
  encoder's literal output (`"kind":"manual"` in a `source='event:perfcap'` message) by REGEX rather
  than a `::jsonb` cast, because a cast raises and one malformed row would abort the whole nightly
  delete; and `prune_client_errors` is SECURITY **INVOKER** with EXECUTE revoked from
  `public`/`anon`/`authenticated`, because a definer-rights delete function is a hole. Guard: the
  repo-root `test/` suite **clientErrorsRetention**, which runs the SHIPPED `.sql` files verbatim
  against a real Postgres (PGlite, devDependency only) and mutation-checks both clauses.
  **⛔ AND THE FOLLOW-UP READER (B369536): `client_errors_retention_check.sql` is `select`-ONLY, and
  that is load-bearing.** V84560 proved the job FIRES (three unattended runs, all 0/0); nothing has
  yet proved the DELETE matches anything, because the first row is not eligible until **2026-09-18**.
  Until then "the delete works" and "the delete matches nothing" still read identically — the same
  indistinguishability one layer in. The reader answers it in one paste, and its sharpest column is
  `ordinary_missed`: any ordinary row older than 90 days **at the moment the last run ran** that is
  still here means the job fires and deletes nothing. **⛔ NEVER call `prune_client_errors()` by hand
  to "check on it"** — a hand-run writes a byte-identical row, manufacturing the very evidence the
  check is waiting for; that is why the reader contains no mutating statement and why an off-schedule
  deletion can never raise its verdict above `WAIT`. Guard: **clientErrorsRetentionCheck**, which
  produces all five verdicts from a seeded database and mutation-proves the FAIL one.
- **`prefs/` + `ui/InterfaceSettings.jsx` — SETTINGS THAT ARE ABOUT THE APP, NOT ABOUT A DRAWING
  (NEW-1/NEW-4).** `prefs/smoothZoom.js` owns the smooth-zoom preference: one key
  (`planarfit:smoothZoom` — the prefix stays, renaming it would silently reset the setting for
  anyone who turned it off), one default (ON), one writer, and a subscription that fires for a
  same-tab change AND for another tab on the device. It is a module rather than a prop **because
  the control lives outside the planner** (in the Settings modal the Shell mounts, and in the
  signed-out header gear) while the behaviour lives inside it — the planner subscribes and keeps
  the half only it can do, `disarmViewAnchor()` on turn-off. `ui/InterfaceSettings.jsx` is the ONE
  Interface section both Settings homes render (display theme + smooth zoom), so the two can never
  disagree; ⛔ there must be exactly one smooth-zoom switch in the app, counted in both directions
  by the repo-root `test/` suite **smoothZoomHome**. Dependency-free and small by construction —
  this lands in the entry chunk every route downloads.
- `comps/` — Leasing Comps (B711328): a comp (land sale / building sale / lease) is its own entity,
  never a project type — optionally references a project, never requires one, and is visible on the
  map regardless. `lib/comps.js` is the pure model (the $/SF derivations, the lease NNN/gross
  basis-normalization rule — never blended into one number — and the empty-field-hide render rule);
  `lib/compsStore.js` is the Supabase CRUD (`public.comps`, team-read/owner-write RLS — narrower than
  a shared site plan on purpose); `lib/compMarkerIcon.js` is the pure map-marker spec;
  `components/CompsPanel.jsx` is the lazy-loaded side panel, self-contained (fetches its own data,
  current user and team list). Anchored by a pin drop OR a real parcel selection — wired into the
  Site Planner's map finder by REUSING its existing parcel-select flow, not a second identify
  pipeline. `db/comps.sql` — applied to production; `db/comps_lease_size.sql` — adds `lease_size_sf`
  (leased area, SF) to LEASE comps (B647824), applied; without it a lease comp's $/SF rate has no
  total rent and any cross-comp average can only be an unweighted mean — `summarizeLeaseComps`
  SF-weights each NNN/gross group when every comp in it has a size, falling back to the previous
  unweighted mean, explicitly flagged, when any comp in the group is missing it (never silently
  blends the two). `db/comps_lease_free_rent.sql` — adds `lease_free_rent_months` (B832385); once
  free rent exists, a comp's derived total is FACE rent only — `compFieldRows` labels it
  `"Total annual rent (face)"` rather than computing an effective/net-of-abatement figure, which
  the owner hasn't asked for. `db/comps_party_fields.sql` — adds `comp_party_provider` /
  `comp_party_acquirer` (B832390): ONE shared axis across all three comp types (never six
  per-type columns), labeled per type by `lib/comps.js`'s `partyLabels(compType)` — lease =
  Owner/Developer + Tenant, land = Seller + Buyer, building sale = Seller + Buyer/User.
  Every migration in `db/` (incl. the party-fields/free-rent ones this bullet used to flag as
  unapplied) is live on production, confirmed by column read against project `lyeqzkuiwngunutlkkmi`.
  `lib/partySuggest.js` is the pure party-name suggestion logic
  (`collectPartyNames`/`matchPartyNames` — loose substring match, suggests only, never forces or
  merges near-spellings) behind `components/PartyNameField.jsx`'s accessible combobox (B832391) —
  a DELIBERATE second, independent combobox implementation from the map toolbar's
  `PlaceSearchField` (that one drives a debounced network geocode; this one filters an in-memory
  array synchronously — reusing its plumbing would import complexity with no use here). `db/test/comps_rls.test.sql` is a self-rolling-back RLS proof, run live via the
  Supabase MCP.
  **Entry (B849232/B849233, 2026-09-01) — paste-into-the-grid, drafts reserved for import.**
  `lib/compParse.js` is the pure parser behind the create surface: one pasted prose line or a
  whole tab-delimited spreadsheet block both resolve through one generic-extraction step, each
  cell carrying a `null`/`"soft"`/`"blocking"` uncertainty verdict — soft when the guess is fully
  visible in the shown value (a k/m-suffixed number), blocking when it isn't (a lease rate with no
  stated period, 12x either way) — never resolved by inference, only refused with a reason.
  `components/CompEntryGrid.jsx` is the paste-box-over-a-row-grid UI (replaces the old
  one-comp-at-a-time create form) — a portaled overlay card, not the docked 232px rail, because
  that's the panel's REAL measured width (not the ~380px the feature was scoped against) and a
  multi-column grid needs more room than either widening the shared rail constant or a
  permanently-scrolled 232px card could give it without touching the site-planner map finder's
  own layout (owned this same week by a sibling site-plan-overlay session). `emptyDraft`/
  `draftToComp`/`compToDraft` moved from `CompsPanel.jsx` into `lib/comps.js` so the grid and the
  single-comp edit form (still reachable — editing one already-saved comp, as opposed to batch
  creation) share one conversion. Row-click-highlights-map and the "＋ Location" per-row map pick
  both reuse the SAME `pendingCompAnchor` single slot the map finder already threads through
  `CompsPanel`, plus one new small `onFocusAnchor` callback prop on `<CompsPanel>` (a
  `mapRef.current.flyTo` one-liner) — deliberately the map finder's only touch for this feature.
  **⛔ B986096 — FOUR OWNER-MEASURED HARDENING ROUNDS on `CompEntryGrid.jsx`/`compParse.js`, all
  fixed; read before touching either file.** (1) Shape detection: an ambiguous multi-line paste
  defaults to ONE record (`detectPasteShape` — spreadsheet → labeled-single-record → completeness
  fraction), because "one pasted line = one row" is wrong for the dominant real shape (a lease
  abstract spans many lines). `extractUnlabeledLine` tries every detector per line rather than
  returning after the first match — first-match-wins is per FIELD, never per LINE. (2) The entry
  card is NEVER a full-viewport modal — a backdrop blocks `elementFromPoint` on the very map
  buttons its own banner tells you to click; it's a small `position:fixed` draggable card only.
  (3) Field coverage: EVERY column in `comps.sql`/`comps_lease_escalation.sql` must be reachable
  somewhere on the card — audit the form against the schema before changing either.
  **(4) ⛔ ROUND 4 (owner rule, "STOP PATCHING THE GRID — the grid is the wrong container"): THE
  SHARED-COLUMN ROW GRID IS GONE.** One CARD per comp now, laid out for its own type only — a
  land card never renders lease-only fields. Every field carries a visible uppercase label (the
  shared `Field` primitive, `stacked`); a derived value (Annual rent, $/SF) is its own labelled
  READ-ONLY cell (`DerivedField`), never a floating unlabeled number. Corner-badge flag dots are
  GONE — a blocking problem is a full-width sentence with quick-resolve buttons
  (`BlockingPeriodNotice`), a soft one is its own amber sentence (`SoftNotices`, generic over
  whatever `compParse.js` flagged). Numbers display comma-formatted while resting and raw while
  focused (`NumberField`) — the stored draft value is untouched either way. **The commit path was
  ALSO rewritten, closing a real "one record, three rows" bug**: `onChange` is now a PLAIN state
  update — no more "parse on any embedded newline," which was the fragile mechanism a duplicate/
  fragmented browser event (or a repeated accidental paste) could fire more than once for what the
  user experienced as one action. There are exactly two commit paths now — a real clipboard
  `paste`, or an explicit Add-button/Ctrl+Enter action for hand-typed text — plus a `lastCommitRef`
  dedupe guard against a literal duplicate. A plain Enter inserts a literal newline like an
  ordinary textarea; it no longer commits anything. `detectCompType` also gained two lease-only
  signals that don't require an accompanying `/mo`/`/yr` — a bare `TI:`/`TI $` mention and a bare
  `$X/SF` figure — closing the "typed Land on text that says NNN, TI and months" class at its
  root, including for the per-line list shape, not just the single-record whole-text join.
  **⛔ ROUND 6 (owner rule, "should read more like an excel, thats hard on my eyes"): THE CARD
  LAYOUT IS ALSO GONE.** `CompEntryGrid.jsx` is now a real SPREADSHEET — plain-text cells on
  hairline gridlines (no input boxes at rest, an outline only on the selected/editing cell), a
  sticky two-row header (a group band over column labels), 31px rows, one frozen leading column
  (Title / Address), real keyboard grid nav (Tab/Shift-Tab/Enter/arrows/typing-replaces),
  fill-down (Ctrl/Cmd+D), Excel-style paste-and-spill into a selected cell, undo (Ctrl/Cmd+Z), and
  a summary footer row. The pure column model — `lib/compSheetColumns.js` — is the one place that
  decides which column means what per comp type; read ITS OWN header before touching either file,
  because it documents a mistake made TWICE in one session and the rule that closes the whole
  class: **EVERY column exists on EVERY row (a cell that doesn't apply renders grey with an em
  dash, never a different column set) AND a derived column's header must be a UNIT that is true
  for every row it is not greyed on — two comp types producing different units are two different
  columns, never one slot reused because it's usually empty.** (The first cut merged a lease's
  annualized rate and a sale's price/size into one "$/SF" slot; renaming the header fixed the
  words and left the conflation itself intact. There are TWO DERIVED columns now — Net Effective
  was removed from the sheet in ROUND 7 below: `$/SF or $/AC` — land/building sale, following the
  row's OWN recorded size unit, `landPricePerAreaUnit` in comps.js, never converted to SF first —
  and `$/SF/yr` — lease only, printing its NNN/GROSS basis inline, because a rate on a gross
  lease and one on an NNN lease are exactly as incomparable as each other.) EXECUTION and
  COMMENCEMENT are two real, separate date columns (`comp_date` / `lease_commencement_date`,
  `db/comps_lease_commencement.sql`) — **⛔ ROUND 7 REVERSED the round-6 "soft-flagged stand-in":
  a commencement-only paste now leaves `comp_date` genuinely EMPTY** (owner: comp_date drives
  every recency filter/sort, and the stand-in was fabricating a FUTURE execution date on his own
  real paste). `validateComp`'s existing "Executed date is required." is what asks for it now.
  `netEffectiveLeaseRate` (comps.js) is computed, never stored, from rate/term/escalation/
  free-rent/TI — it parses `lease_term`'s free text via `parseLeaseTermYears` and returns null
  (never a wrong number) when the term can't be read; still used by the comp DETAIL view
  (`compFieldRows`), just no longer a SHEET column (owner: "still remove"). A structured numeric
  term-months column (for reliable future sort/filter) is real follow-up work, deliberately not
  built this round.
  A lease comp records LEASED SF only (`lease_size_sf`) — a separate "whole building SF for
  context" field is a real, distinct idea, also deliberately not built this round.
  **⛔ ROUND 7 (B986096-HARDENING-7/8/9) — the sheet round 6 shipped was LIVE-TESTED and found
  COMPLETELY NON-EDITABLE, and the fix generalizes: read `CompEntryGrid.jsx`'s header before
  trusting any sandbox-only pass on this file again.** `onCellMouseDown` never called
  `gridRef.current?.focus()`, so DOM focus never left the paste textarea and every keystroke
  landed there instead of the grid — the owner's "type 2, it becomes 22" was two keystrokes
  accumulating in a never-blurred textarea, not a parser bug. **This passed every unit test, the
  build, eslint and the design-drift audit — none of those can see that a click never moved
  focus.** Also fixed the same pass: `kind:"select"` columns (Type/Unit/Per/Basis) now render a
  REAL `<select>` while editing (there were previously zero `<select>` elements anywhere in the
  dialog); dates display mm/dd/yy and accept flexible typed input (`lib/compDates.js`'s
  `formatDateDisplay`/`parseTypedDate` — a native `<input type=date>` cannot accept "June 1
  2027", so date cells are a plain text input with this parser on commit) while STORAGE stays
  ISO always; `compSheetColumns.js`'s `visibleColumnIndices(rows)` hides a column from the WHOLE
  SHEET when no current row's type uses it (Price/NOI/Cap never take up room on an all-lease
  sheet) — this is a DIFFERENT axis from "every column exists on every ROW", which is unchanged;
  the Location cell shows a real identity (`lib/compLocationText.js` — a reverse-geocoded
  address for a pin via the site-planner map finder's own address-geocoder module, which grew a
  `reverseGeocodeLatLon` sibling to its existing forward `geocodeAddress` (no new dependency),
  cached on the row and keyed to the anchor's own lat/lon so a re-anchor self-invalidates it; an
  APN for a parcel; a site-plan overlay's own title for a site_plan point — never one substituted
  for another) instead of a bare "Pin"/"2 parcels" confirmation. County derivation (the map
  finder's own `resolveCompCounty`, shared by the pin-drop AND site-plan-pin anchor paths) now
  LOGS and FLAGS (`comps.js`'s `anchorCountyFlag`, a soft sheet warning) a genuine resolution
  miss instead of silently persisting `county: null` forever — a comp has no load-time self-heal
  for this the way a planned site does. Cap rate + NOI on
  building sales (`bldg_noi`/`bldg_cap_rate`, `db/comps_cap_triangle.sql`) are a TRIANGLE — enter
  any two of {Price, NOI, Cap}, the third derives via `comps.js`'s `resolveCapTriangle` and
  renders read-only/tinted; all three given and disagreeing (>5bp) is flagged, never silently
  recomputed over. `bldg_cap_rate` is a DECIMAL FRACTION internally (0.0575), typed/shown as a
  percentage (5.75%) — deliberately different from `lease_escalation_pct`'s raw-percentage
  convention (3.5); the column's own get/set pair is the one place that conversion happens.
  **⛔ ROUND 8 (B986096-HARDENING-10) — round 7 passed every sandbox check AGAIN and the owner
  LIVE-TESTED it AGAIN (two reports), finding the sheet still slow and visually inconsistent —
  read this before touching column order/width/align/label or the click-to-edit model.**
  (1) **`compType` IS NOW `SHEET_COLUMNS[0]`, `frozen: true`, its own one-column `TYPE` group** —
  "choose deal first because it will inform the rest." Its `setValue` also defaults
  `landSizeUnit` to `"ac"` when switching to Land and nothing was chosen yet (never overwrites an
  existing choice); `spillPaste`'s row-extension path defaults a spilled-past-the-end blank row's
  Type to the row above's (batch-of-one-kind). (2) **ONE alignment rule, asserted GENERICALLY in
  the repo-root `test/` suite **compSheetColumns**, not per-column:** `kind` of `number`/`date`/`derived` → `align:
  "right"`; everything else → `"left"`. A column violating this is a test failure, not a style
  choice. `leaseTerm` used to render "126 mo" (a unit baked into a numeric cell, which is why it
  was left-aligned) — its `getValue`/`setValue` now convert to/from bare months
  (`monthsFromTermText`, module-private) at the cell boundary, mirroring `bldgCapRate`'s
  %-vs-fraction split, while the STORED `lease_term` field stays free text (a real term can be
  "10 yr + 2x5 options", which a bare-months field can't hold — a value that doesn't reduce to a
  leading number shows empty, never a wrong guess). (3) **A unit lives in the HEADER, never both
  places** — `Term (mo)`, `Free (mo)`, `Escal (%)`, `TI ($/SF)`, `Cap (%)` are the relabeled
  headers; `bldgCapRate`'s cell dropped its inline "%" to match. (4) **`cellPlaceholder` now
  ALWAYS returns `""`** — no more per-type party-role placeholder words ("Owner/Developer",
  "Tenant"); the em dash for a not-applicable cell is a SEPARATE mechanism (`cellState`'s `na`
  branch) and is untouched — kept, because blank-because-N/A must stay visually distinct from
  blank-because-unfilled. (5) **`emptyDraft`'s `leaseRatePeriod`/`leaseRateExpense` default to
  `""`, not `"annual"`/`"nnn"`** (`comps.js`) — a blank row must not pre-assert a basis; the
  existing "no period blocks the derived rate" gate only works because "unset" is now genuinely
  unset. (6) **Single click enters edit immediately** (`CompEntryGrid.jsx`'s `onCellMouseDown`
  now calls `beginEdit` for anything `cellState` reports `editable`, not just `setSelection`) —
  no more intermediate "selected but not editing" state, closing "four clicks for one value." A
  select-kind cell's dropdown OPENS on that same click via a feature-detected `.showPicker()` in
  the focus effect (now a `useLayoutEffect`, so it still runs inside the click's own user-gesture
  window — a plain `useEffect` risks firing after that window closes and `showPicker()` throwing).
  Tab/Enter after a commit lands the DESTINATION cell straight into edit mode too when it's
  editable (computed against the just-committed row, not the stale pre-commit `rows` closure).
  (7) **The sheet fits its container with ZERO horizontal scroll, COMPUTED rather than guessed —
  two hand-tuned static width budgets were each tried and both overflowed by 170-200px.**
  `computeFlexWidths(availableForFlex)` (pure, in `compSheetColumns.js`) divides whatever room is
  actually left over among the four `flexKey` columns (`title`, `partyProvider`, `partyAcquirer`,
  `notes`): Notes shrinks first, down to its own floor; only once it's at floor do the other three
  share the remaining squeeze, proportional to their own room, Title getting the largest share of
  any surplus. Every column has a floor it never crosses, even if that means the total exceeds a
  genuinely tiny container (an inherent limit, not a bug). `CompEntryGrid.jsx` measures the real
  available width via a `ResizeObserver` on the grid's own scrolling element (never assumed from
  `window.innerWidth` or replayed from the dialog's own CSS `calc()`), and `widthFor`/
  `frozenLeftOffsets` (also pure, also in `compSheetColumns.js`) turn that into each column's
  actual rendered width and the two frozen columns' (Type, Title) cumulative sticky `left` offset.
  Title/Landlord/Tenant cells additionally carry a `title=` attribute with the untruncated value.
  (8) Plain Enter now commits the paste box (was Ctrl/Cmd+Enter); the "Add" button is gone as no
  longer the required commit path; Shift+Enter still inserts a literal newline.
  **⛔ NONE OF THIS WAS LIVE-BROWSER VERIFIED WHEN SHIPPED** (no reachable browser at all, signed
  in or out, from the shipping session) — round 6 ALSO passed every sandbox check and was then
  found non-editable on first live use, so treat round 8 as unconfirmed until `VERIFICATION.md`'s
  `V556720` records a real pass, not as "probably fine because the tests are green."
  KML import (B849233) is a SEPARATE staging table, `db/comp_import_drafts.sql`
  (`public.comp_import_drafts`, owner-only RLS — no team visibility at all, unlike `comps` itself,
  until promoted) — `lib/kmlImport.js` is the pure, hand-rolled Placemark parser (a Point is a
  point; a Polygon becomes an area-weighted centroid, `polygonCentroid`, never a vertex average)
  feeding `lib/compDrafts.js` (row<->model) + `lib/compDraftsStore.js`
  (`promoteDraft` — the moment `comps`' strict constraints get enforced; a draft that fails them
  stays a draft, with the reason written back onto the row). `components/CompDraftsPanel.jsx` is
  the review/promote surface, reachable ONLY from the KML import button — hand entry never creates
  a row here. `db/test/comp_import_drafts_rls.test.sql` — the same self-rolling-back proof shape,
  9/9 passed live against production.
- `projects/`, `profile/`, `cloud/`, `presence/`, `gis/`, `geometry/`, `placement/`.

**Convention:** shared logic is pure and unit-tested; per-host state/wiring stays in the workspace.

<!-- Keep this pointer current: if you rename/move/delete a key file in this folder, update the
     lines above in the same commit. The doc-pointer-audit check fails CI on a stale reference. -->
