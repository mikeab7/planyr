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
  blends the two). `db/test/comps_rls.test.sql` is a self-rolling-back RLS proof, run live via the
  Supabase MCP.
- `projects/`, `profile/`, `cloud/`, `presence/`, `gis/`, `geometry/`, `placement/`.

**Convention:** shared logic is pure and unit-tested; per-host state/wiring stays in the workspace.

<!-- Keep this pointer current: if you rename/move/delete a key file in this folder, update the
     lines above in the same commit. The doc-pointer-audit check fails CI on a stale reference. -->
