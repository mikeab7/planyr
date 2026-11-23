# Site Planner notes: rendering view and performance

_Moved verbatim out of `src/workspaces/site-planner/CLAUDE.md` (audit batch H, 2026-11-23). Nothing below was reworded, shortened or removed; the folder pointer now only signposts here. Root rules in `/CLAUDE.md` still apply._

- **`lib/easementLabelPlacement.js` (B2198432) — WHERE an easement's name (+ selected-state area line) sits and how it is rotated.** Rides the longest straight run of a strip's centerline (a boundary easement: its longest ring edge), upright by modulo-fold into [-90, 90), shrunk toward the existing label floor and then area-dropped to stay inside the strip's width; a shape under 1.5:1 keeps the old horizontal-at-centroid label byte for byte. Decided in label space (`labelPpf`), scaled by `labelK`, so the PDF clone prints the same. Easement-only — parcel/building/pond labels do not use it. Guards: repo-root `test/` **easementLabelPlacement** + e2e **easement-label-orient** (red on the pre-fix render). **`lib/easementLabelPull.js` (B2203856/B2203857) is its sibling: an easement label PULLED OFF the strip** — `labelPull {dx,dy,angle}` (feet offset from the inline anchor + screen angle) and `showArea` (area line OFF by default) stored ON the easement markup, so a move/reshape carries the label and it saves/undoes/dies with it. `resolveEasementLabel` is the ONE answer (inline or pulled: position, size, hit box, leader to the nearest centerline/outline point) for the render, the hit target, the selection outline + rotate grip (handle layer) and the drag starters (`easeLabelMove`/`easeLabelRot`, both through the click-vs-drag gate). An unselected easement's label press is forwarded to the strip (CHROME-NEVER-EATS-A-PRESS); right-click → the label's own menu (Show/Hide area, Snap back to strip). Guards: **easementLabelPull** + e2e **easement-label-pull**; live: ui-audit **verify-easement-label-pull** (V1622960).
- **`lib/canvasBox.js` (B2174224) — the canvas's viewBox IS its measured box, never floored.** A 320×360 floor made the browser shrink the whole drawing whenever a wide docked panel left the map pane narrower than 320 (or the window shorter than 360). Every `setSize` goes through `nextCanvasSize`; degenerate boxes are refused at the framing sites, not by a floor. Guards: the repo-root `test/` suite **canvasBox** + ui-audit **verify-panel-resize-scale** (real grip drag, six window sizes, red on the pre-fix build).
- **`lib/panelWidth.js` (B2154768 ×2) + `lib/hatchAnchor.js` (B2202960) — nothing outside the panel may change while the docked left panel is dragged, measured in PIXELS.** (1) The basemap box (and its two band hosts) reaches left under the docked column by `geoDockX` (`mapLock.mapBoxInset`/`mapBoxCenterX`), so a docked-panel drag/open/close never resizes, pans or re-requests Leaflet — FEMA's labels re-flowed and every tile seam re-blended at 2.15× before. (2) The panel PAINTS at `leftWidth` (whole CSS px) but RESERVES `panelFlowWidth` (a notch whole in CSS AND device px — 20 px at the owner's ≈2.15×), so the SVG canvas edge never re-snaps; the leftover overlaps the canvas edge. (3) Every `<pattern>` is translated to the render view's feet origin (`hatchPatternTransform`), so stripes are pinned to the ground, not the canvas corner. Guards: repo-root `test/` suites **panelWidth**, **hatchAnchor**, **mapLock**, **pixelSteady** + ui-audit **verify-panel-resize-steady** (pixel phase: exact equality per layer at 1/1.25/1.5/2.15×; `getBoundingClientRect` alone cannot see this — it read 0.00 on the shaking build).
- **⛔ SHEET FURNITURE PRINTS ABOVE THE SITE, AND IS ITS OWN OBJECT (B1934529 ×2, NEW-1 2026-10-27, owner: "the issue is that it's printing under").** The printed BUILDINGS / SF table, scale bar and north arrow are `sheetFurniture.js` plates placed by `sheetFurnitureLayout.js` (the table via `buildingsPlate`, in the emptiest corner — top-right on the owner's plan, as on screen; it has NO band of its own, an earlier cut that gave it one was retracted). In the editable PDF every site element is an annotation and annotations ALWAYS paint above the page picture, so a plate left in the page was painted over by the pond / a trailer strip ("ng 3"). Rule: `buildExportSvgRaw` tags each plate `data-furniture-kind="buildings-table|scale-bar|north-arrow"`; `buildComposedSheet`'s annotate branch lifts every tagged plate into a `family: "sheet-furniture"` **Stamp** (`pdfAnnotations.js`; no `/Contents`, `/F 4`) appended AFTER every site annotation (so it paints above them — the stacking the flattened sheet and the screen already have) and only removes the plate from the page once its annotation exists (LOUD-FAILURE note otherwise). Flatten ON / PNG / preview: the furniture group is appended after everything, so it is already on top. A new plate must carry a kind tag or it stays in the page, under the site. Guards: repo-root `test/` **furnitureOnTop**; ui-audit **verify-sheet-furniture-on-top** (real Download PDF, MuPDF pixel proof `tools/pdf_furniture_cover.py` with a stacked-below known-good arm, 6 papers × 2 orientations) and **probe-buildings-table-on-main** (the red proof against a pre-fix build).
- **`lib/mapCorners.js` (B2206704–B2206706) — WHERE the canvas's corner furniture sits.** `paneInset` (the docked panel's paint overlap, `panelWidth.js`) offsets every LEFT-anchored item (north arrow, Scaled badge, coordinate chip, Standards toast) so it tracks the panel's painted edge, never the wider canvas box; desktop's bottom-right is ONE flex container (scale bar · help · zoom, `MAP_CORNER_PX` margin; phone keeps its own layout); the chip truncates first/hides (`cursorChipFit`). Scale-bar plate padding lives in `sheetFurniture.scaleBarPlate` (end-label margin). Guards: repo-root `test/` **mapCorners**; ui-audit **verify-panel-resize-steady** (per-frame containment, helper in ui-audit/lib) + **verify-map-corners**.
- **⛔ Planner perf questions start from `window.__plannerPerf()` (`lib/plannerPerf.js`, LoAF script attribution, owner-only, armed with `?planyrDiag=1`), not from a guess** — it says whether the last minute's long frames were the page's CODE (blocked) or a wait on DRAWING (`verdict`), which scripts ran, the timers firing > 1/s and which grading layers were up; a perfcap `freezeVia: "render"` is a drawing wait, `"task"` is code (NEW-1, 2026-11-01). Live instrument: ui-audit **diagnose-grading-frames-live**; guard: repo-root `test/` **plannerFrameCost**.
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
- `releaseCanvas.js` (NEW-5) — hand an offscreen canvas's backing store back the moment its pixels
  have been consumed. Canvas pixels are renderer/GPU memory, not JS heap, and the GC barely feels
  them (measured ~555 MB of tab against a ~134 MB heap, with this idiom appearing NOWHERE in the
  tree). Call it only AFTER the last `toDataURL` / `toBlob` / `getImageData` / copying `drawImage`,
  and never on a canvas you are handing to a caller or one that is on screen. **Deliberately
  duplicated in `doc-review/lib/` rather than shared** — a module reachable from both routes gets
  hoisted into its own chunk and breaches the Site route's chunk budget; keep the two identical.
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
  the class, **detect-view-recompute**. Enumeration: `/docs/perf/PERF-VIEW-INDEPENDENCE.md`.
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
  **⛔ `Settings → Interface → Smooth zoom` is the off switch, and it has moved TWICE — do not move
  it again without reading why.** B1449 put it in the plan menu; **B286000** moved it to the
  on-canvas `View ▾` menu; the owner still could not find it, and the corrected rule is that
  **View ▾ is a per-DRAWING display menu** while this follows the DEVICE across every plan and every
  project. Its one home is now the Interface section of Settings, beside the display theme
  (the shared `ui/` Interface-settings component, rendered by BOTH Settings homes — the signed-in account panel
  and the signed-out header gear — so they cannot disagree). The persisted value lives in
  the shared `prefs/` smooth-zoom module (same `planarfit:smoothZoom` key, same default ON, one writer + a
  subscription); the planner SUBSCRIBES, because the control is now outside the component, and keeps
  the half only it can do — `disarmViewAnchor()` on turn-off, hung off the subscription so a change
  from the modal, the gear or another tab all disarm. ⛔ There must be exactly ONE switch; the
  repo-root `test/` suite **smoothZoomHome** counts occurrences in both directions, and the e2e spec
  **smooth-zoom-settings** drives the real control. It gates the ZOOM anchor only — the pan anchor
  is never gated on it.
- **⛔ `featureEditZoom.js` (B312544 · B335984 · NEW-1) — WHEN THE ON-BUILDING `+`/`−` CONTROLS MAY
  EXIST. `FEAT_BTN_MIN_PX` (B225) asks whether the BUILDING has room to seat the cluster; a 900 ft
  industrial building clears that at almost any zoom a site plan is read at, so on the owner's
  109-acre Bain plan the controls armed with the whole site in the viewport, at full size, over the
  two largest objects on the drawing — while the bump-out they place was a few pixels wide. The
  second gate asks whether the EDIT is legible. Both must pass; neither replaces the other.
  **⛔ THE VALUE IS OWNER-SET AND MUST NOT BE RE-DERIVED — THREE VALUES HAVE SHIPPED AND THE FIRST
  TWO WERE BOTH DERIVED FROM THE 55 ft BUMP-OUT AND BOTH CAME IN LATE.** #990 required 44 px across
  it (a minimum-TOUCH-TARGET figure, and the bump-out is not the touch target); #994 required the
  disc's own outer width, 19.75 px ÷ 55 ft = 0.359 px/ft; the owner sent BOTH back. The live floor
  is **0.25 px per foot — 4 FEET PER PIXEL — STATED, not computed**, with both failed derivations
  named in the module header so a future session that finds it arbitrary is reading the record of
  why re-deriving fails. `FEAT_CTRL_R` / `FEAT_CTRL_STROKE` are still exported and the cluster still
  renders from them (that is the CONTROL's size, a real fact) but they no longer feed the threshold,
  and neither does `DOGEAR_W`. Building 3 on his plan renders about 197 px at the floor.
  **⛔ AND THE GATE IS NO LONGER PURELY ABSOLUTE — say so, do not "restore" it.** An absolute px/ft
  floor puts a bigger share of a SMALLER screen under the building: at 0.359 Building 3 was about a
  third of his 1600 px monitor's canvas and closer to half of his 1191 px laptop's. So the floor is
  the EARLIER of the owner-set 0.25 px/ft and a **VIEWPORT CAP** — the zoom at which
  `FEAT_EDIT_REF_SPAN_FT` (800 ft, a CONSTANT) would reach a quarter of the canvas width. **It is
  still SITE-size independent**, which is the property that was actually asked for: nothing reads
  the plan, the site, the selected building or any drawn geometry, so a 30-acre and a 900-acre site
  on one screen arm at the identical zoom. The cap binds below 800 px of canvas and nowhere above.
  **The B312544 defect cannot return through it at any width, and that is a proof:** whole-site zoom
  is itself `canvasW ÷ siteSpanFt`, so both sides scale with the canvas and the cap sits a CONSTANT
  1.48× tighter than the overview on his Bain frontage, on a phone exactly as on a monitor.
  Above the floor the controls ramp to full strength over the next 35% of zoom (a fade, not a pop)
  and are **fully clickable the whole time** — opacity is presentation, never a hit-test gate. It is
  asked with `rppf` and `size.w`, never `view.ppf`. Guards: the repo-root `test/` suite
  **featureEditZoom** (which replays ALL THREE superseded rules as mutation checks and fails if the
  floor ever equals either failed derivation again) and the e2e spec **feature-edit-zoom** (a real
  wheel gesture either side of the floor **in force on the canvas the browser opened** — the
  viewport half is a function of a measured canvas, which no source reading can evaluate — plus a
  real `elementFromPoint` hit test on each faded disc).
- **⛔ `contentVisibility.js` (B442688) — WHAT THE DRAWING IS SHOWING RIGHT NOW, and the one rule that
  makes it safe: HIDE NEVER DELETES.** The owner's View menu used to toggle ORNAMENT (dock doors,
  column grid, dimension callouts, area lines); what he reaches for is *"being able to hide a whole
  set of stuff … And when I say remove, I don't mean remove, I just mean hide temporarily."* So the
  menu leads with content GROUPS — a tri-state **Elements** master over per-type rows (the Layers
  panel's "Show all flood & drainage" shape, same `{all, any, onCount, ids}` object, asserted against
  `LayerPanel`'s own `floodMaster` so the two cannot become two mechanisms), plus one row each for
  parcels, markups, measurements and callouts. **The predicate is applied ONLY where `cullToView`
  already is** — `drawEls` · `drawParcels` · `drawMarkupsZ` · `measureBands` · `calloutBands` —
  because "drawn ≠ exists" is a rule this codebase already relies on and hiding is that rule with a
  different predicate. **⛔ The metrics pass (`els.forEach` → bldg/paving/parkArea/pondArea/stalls/
  providedDetCf, and `dissolvedParcelSqft(parcels…)`) iterates the MODEL and must never read a draw
  set** — that is what keeps every number identical, and it is the ONE thing to check before adding a
  consumer. Storage is `settings.hidden`, SPARSE and naming only what is hidden, so an untouched plan
  gains no keys. Three traps it closes, each found by the harness rather than by reading: the acreage
  BADGE is built from `parcels` (not `drawParcels`) so a group must hide its chrome explicitly; the
  handle layer renders from `sel`/`multi`, so hiding must clear a selection into the group or grips
  float over nothing; and the three MARQUEE passes read the raw model, so a box-select would
  otherwise return invisible objects that the next Delete would take. `normalizeRetiredToggles`
  restores `showDocks` on load — deleting a shipped control STRANDS any plan saved with it off.
  **⛔ B3296 — AND THE SEAM THE PREDICATE NEVER REACHED, which is the part to read before adding a
  render pass.** The owner unchecked Roads and the roads stayed on his drawing. `drawEls` was filtered
  correctly — every road's own node left the canvas — but a road's PAVEMENT is drawn ONCE per connected
  cluster by the dissolved network (`roadNetwork.js`), from a `roadNet` memo over `els` that no
  visibility filter reached. **`roadNet` reads `els` rather than `drawEls` DELIBERATELY** (a culled
  neighbour still shapes a curb return), so it can never inherit the cull's filter and must ask
  `elHidden` for itself — as must its junction wedges, stripe cuts, cluster pairs and the
  `roadRadiusFlags` review chrome. Hiding and CULLING are different statements; keep the two filters
  distinct. **⛔ The harness certified this green**, because a feature census counts REGISTRATIONS and
  this is INK drawn on behalf of several features at once — the guard is now the ui-audit **ink census** helper,
  which attributes every painted node (reading `data-road-cluster`) and reports what it cannot attribute
  rather than dropping it. PDF-parity is asserted on the REAL built sheet, not argued from the clone.
  **⛔ B494048–B494051 — AND THE AUDIT B3296 FORCED, whose SECOND HALF is the one to read.** The
  question "who else reads the whole model where the drawing wants the visible subset" is answered
  once, per call site, in **`hiddenContentReads.js`**: 47 bindings produce one of six artefact kinds
  (a picture · a merged surface · the print crop · a click target · a snap magnet · an extent), and
  each carries a verdict. **10 must-filter; 37 are CORRECT unfiltered and are recorded as such** —
  the yield metrics, `checkDrainage`, `gsInputs`, the saved record, the undo frame, the KMZ, the
  bonded heal, `elNeighbors`, and `parcelStreets`, a REGULATORY answer that may not move because a
  checkbox was unticked. **Filtering one of those would be a worse bug than B3296 was**, which is why
  "we checked this and it is right" is written down rather than left as silence. Five more seams were
  wrong and are fixed through `visibleEls`/`visibleParcels`/`visibleMeasures`: `fit` (Zoom to fit),
  `devExtent`+`exportFeetExtent` (the PRINT CROP — PDF-PARITY), and three MAGNETS (the ambient
  flush-snap, `connectableRoads`, `snapToBoundary`). Click targets were checked and are correct BY
  CONSTRUCTION. ⚠ `fit` also frames the AERIAL, which on a real plan is wider than the drawing, so
  that defect was invisible to the owner and its harness arm needs the raster removed to see it.
  Guards: the repo-root `test/` suite **hiddenContentReads** (whose mutation check replays the REAL
  pre-B3296 `roadNet` body from git) and the ui-audit enumerator **audit-hidden-content-reads**,
  which **refuses to report a clean result unless `--teeth` first finds the known defect on the
  pre-fix tree**, plus the harness **verify-hidden-content-behaviour** (5/5, both new arms
  mutation-proven, every arm carrying a vacuity guard).
  Guards: the repo-root `test/` suite **contentVisibility** (34, incl. the CI-runnable seam sweep naming
  `drawEls` · `roadNet` · `roadRadiusFlags`) and the ui-audit harness
  **verify-content-visibility** (47/47 on the owner's real Silvestri + Bain plans; mutation-proven —
  filtering `els` one seam earlier leaves the canvas PIXEL-IDENTICAL and takes Buildings from
  62.13 ac to 0.00 ac, which no visual test in this repo could see). Live-verify: **V237632**.
- `zOrder.js` — per-element `z` stacking key utilities (`nextZ`/`sortByZ`/`normalizeZ`/`ensureZ`, B671;
  `withMissingZ`/`migrateBandForce`, B1788912 — see NEW-1 below).
  `arrange.js` — pure z-order "Arrange" (`reorderByZ`/`arrangeFlags`, B820): Bring-to-Front/Send-to-Back
  over a peer set. Wired via `arrangeSel` + `arrangePeers` + the right-click menus + the ⌘/Ctrl+]/[
  chords in `SitePlanner.jsx`.
  **⛔ NEW-1/NEW-2 — FOUR FAMILIES ORDER, AND THEY ORDER THE SAME WAY. Read this before touching a
  context menu or the callout render.** The owner's *"the layers / order feature doesn't work at all"*
  was three separate holes, none of which a state read could see: **(a) CALLOUTS AND TEXT BOXES WERE
  OUTSIDE THE MODEL ENTIRELY** — rendered from the raw `callouts` array, so they had no `z`, no band,
  no menu rows and no chord, and two overlapping text boxes could not be reordered by any means the
  app offered. They now use the measurement model verbatim (`calloutBands` + `behindEls` + `setCalloutBand`),
  and a plan saved with no `z` still orders correctly because `byZAsc` falls back to (0, id).
  **(b) THE ARRANGE GROUP VANISHED when the object was alone in its band** (`af.count > 1`), which on a
  real plan is most elements — one pond, one paving pad — so right-clicking them offered no ordering
  rows and no reason. The rows are now always present, GREYED with a stated reason; `arrangeSel` flashes
  the same reason for the chord. **(c) THE MARKUP PEER SET WAS THE WHOLE `markups` ARRAY** while the
  render splits on `behindEls`, so the flags could grey a markup that was at the front of everything it
  could reach. `arrangePeers` is now the ONE peer-set resolver for all four families — never re-derive one.
  The three menus that share a shape build their rows from ONE `arrangeGroup` helper; the element menu
  keeps its own `arrRow` (different menu component, different header style) and is asserted separately.
  **⛔ B316864 — SUPERSEDED 2026-09-19 (B1788912, NEW-1). Kept as HISTORY below; it is not the live
  rule.** Owner decision reversing it, verbatim, in `/CLAUDE.md`'s owner-constraints entry 10:
  *"I mean I feel like whatever I draw should be at the top so I can never lose anything when I draw
  it, I'm assuming that's how bluebeam works"* — told plainly the consequence (a parking field drawn
  after a building paints over the building) and chose it anyway. **The type-layer rule described in
  this paragraph is GONE**: elements now stack in plain creation order (their own `z`), resolved by
  the SAME `planStyle.zOrder` seam this paragraph names, but that function no longer reads a type
  table or `bandForce` at all — see planStyle.js's own SUPERSEDED Z_LAYER block for the current
  `zOrder`/`byZ`. `bandForceOf`/`EL_BANDS` no longer exist; a legacy `bandForce` value is migrated to
  an ordinary z on load (`zOrder.js`'s `migrateBandForce`, called from `siteModel.createSiteModel`).
  An element's Arrange peer set is now the WHOLE plan (`arrangeSel`'s `peers = els`), so "Force on top
  of everything" needed no separate mechanism to survive the reversal — it already IS ordinary Bring
  to Front. The dissolved `roadNet` no longer excludes anything by `bandForce` (every centerline road
  is a network member again); its composite now takes its cluster's NEWEST member's z as its own
  paint position (`roadNet`'s own `zKey`, NO-ONE-OWNS-A-COMPOSITE) rather than always painting first.
  A NEW rule travels with the reversal: while an element is selected (or a road-network cluster has a
  selected member), it paints above every other element (`SitePlanner.jsx`'s `elPaintItems.lifted`) —
  ephemeral render-order only, never a written `z`. Existing plans RE-STACK on next open (accepted).
  History, for what the type-layer rule was and why it existed — **THE OWNER ANSWERED THE CROSS-BAND
  QUESTION, AND THE ANSWER WAS BOTH HALVES.** It used to be an `{ open: … }` cell on the capability
  table (*"paving over a building"*); it became `crossBand: yes` for all six element types. **The
  DEFAULT did not move** — `road → paving → pond → parking → building` was absolute for every
  untouched element, and ordinary Arrange stopped at the band edge — but an explicit **"Force on top
  of everything"** row lifted ONE element across it, reversibly. It resolved in **`planStyle.zOrder`**
  (`bandForceOf` / `EL_BANDS`), the single function every band question already asked, so there was no
  second stacking mechanism and a forced element got its own Arrange peer group for free. The shape
  was BORROWED from the `behindEls` toggle markups / measurements / callouts carry and from
  `overlayOrder.js`'s `aboveParcel`. Two things this used to protect, now moot: a road forced out of
  its band was excluded from the DISSOLVED `roadNet`, and `bandForce` was ignored unless it named a
  known band.
  **⛔ B548064/B548065 — AND THE CASE FOUR FIXES NEVER DROVE: A MARKUP OVER A BUILDING. Read this before
  touching `arrange.js` or building a fixture for an ordering report.** The three ANNOTATION families
  (markups · callouts/text boxes · measurements) carry a `behindEls` band, and `arrangeSel` used to
  reorder within the object's OWN band only — so on a markup over a building, **Send to Back sent it to
  the back of a band that is entirely above the elements**, nothing moved on screen, and the row then
  **greyed itself**, which reads as completion. The operation he wanted lived two rows lower under a
  different name. `arrangeAcrossBands` / `arrangeBandFlags` make the four modes address the WHOLE stack:
  "back" crosses the band, "backward" steps across the edge exactly one place, the forward pair mirror
  it, and a row greys only at a true end (`"Already behind everything on the plan."`). A deed crossing
  carries its save-and-except group. **⛔ ELEMENTS ARE DELIBERATELY EXCLUDED — B316864's absolute type
  bands and its one explicit "Force on top of everything" row are unchanged**, because an element's band
  is an engineering statement while an annotation's is pure presentation. **B548065 is its inseparable
  half:** paint order is hit-test order, so a markup sent behind an element is unreachable across the
  whole overlap — a SELECTED behind-band annotation therefore keeps the right-click wherever it paints,
  and the covering element's menu grows a **"Behind this"** group (`featuresBeneath`, read at menu-OPEN
  time because the menu paints over the point) with one row to lift it back and one to select it.
  ⛔ The fixture is the whole lesson (`/CLAUDE.md` → **WRONG-CASE**): a scene whose markups do not overlap
  an element reports PASS on a dead implementation. Guards: the repo-root `test/` suites
  **arrangeAcrossBands** (the pre-fix rule replayed as the mutation check) and **markupBehindReach**, the
  e2e spec **markup-behind-building**, and the ui-audit harness **verify-markup-over-building** (the
  owner's real Bain plan, the markup DRAWN WITH THE REAL TOOL, 18/18 — **12 red pre-fix**, with two
  preconditions that refuse to report a score unless the markup really is over the building).
  Live-verify: **V302432 / V302433**.
  Guards: the repo-root `test/` suite **elementBandForce** (which REPLAYS the pre-fix comparator, so a
  default that drifts goes red; mutation-proven three ways) plus the ui-audit harnesses
  **audit-element-parity** (58/58) and **verify-v91632-real-plan** (the owner's real Bain plan). Guards: the repo-root `e2e/` declaration table **elementCapabilities.table** (a new
  selectable type cannot ship without answering every capability), the repo-root `test/` suite
  **elementCapabilities** (proven red four ways on the pre-fix source) and the ui-audit harness
  **audit-element-parity** (right-clicks one of every kind on a deliberately OVERLAPPING fixture and
  reads paint order from the DOM — a tidy fixture reports PASS on a dead implementation).
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
  the hottest application function in the profile (`docs/perf/PERF-POND.md`). The cache's lifetime IS the ring's —
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
  **`trailerRows.js` (B2160240–B2160242) — the pure rules for a trailer parking ROW's label and stall spec.** The label's lines carry
  `keepLine` (the COUNT): `labelLayout`'s `takeLines`/`fitLines` drop every other line first, and that kept line alone may spill across
  a strip too thin for a line rather than vanish — never drop it back to "last line goes first" (a shallow upper row lost its number).
  `labelHidden` is the user's per-row, label-only hide (menu "Hide label" + Properties) and is deliberately NOT `noLabel`, a bond role
  tag the copy/heal paths strip. Stall depth/width/lane are per-row `cfg` overrides (floors 8/6/0 ft, far under any real stall); a row
  drawn shallower than the standard adopts the drawn depth. Guards: repo-root `test/` **trailerRows**, e2e **trailer-row-labels**, ui-audit **verify-trailer-row-labels**.
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
  the vertex average it replaced). **B2225424: a binary heap search plus a coordinate-keyed cache behind the identity WeakMap — a plan open re-seeds parcels into new arrays with the same points, and the identity cache alone paid the whole search (345–763 ms on Concept A) on every open; account + rig: `/docs/perf/PERF-PLAN-OPEN.md`; guard repo-root `test/` **polylabelPerf**.** Guards: the repo-root `test/` suite **parcelDeclutter** + the ui-audit harness
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
  production snapshot `test/fixtures/weldParcelProduction.json`, site `sms7v3ua7ksy`) + (its browser harness was retired with the role UI — see the Parcels rework entry).
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
  **`roadDeco.js` (B1783376 ×2, 2026-10-15) — WHERE A ROAD'S DECORATION MAY PAINT at a junction.** Band fills, lane seams and texture END at the throat (a lateral cut where the curb returns leave a side road's edges; across the throat span of a through road), never run on along the strip beside the fillet — that straight tint boundary was the "line between the road and the curve". `roadNetSteps` returns `decoDomains` (strip ∖ cuts ∖ pads, world feet, evenodd) and `renderElPx` clips to it; an OUTSIDE-curb band is clipped to everything except its cluster's region. Face-of-curb stripes end at the same cut and continue around every return (`siteGeometry.teeJunctionCurbStripes` / `driveJunctionCurbStripes`, inset on the PAVEMENT side via `insetArcTowardCorner`). **`roadJunctions.armStraightRun` (B2276177) runs on through vertices that render no corner and offers `soft` (the run past a mild bend) to `nodeJunction`'s bounded fallback — a tee corner shrinks, it is never silently square on one side.** Guards: repo-root `test/` **roadDeco**, **teeBothCorners**; e2e **road-junction-deco-seam**, **road-tee-both-corners** (both red on the untouched build).
  **B1783376 ×3 (the LINEWORK at a drive entering a pad):** a curb return's face-of-curb is a TRUE-CIRCLE arc (`siteGeometry.returnArcStripe`, ≤ 1.5° chords) that starts exactly on the straight stripe and ends exactly on the pad face (`roadDeco.trimPolylineOutsideRings` — float, never the clipper grid, which tilts a short chord), and `roadNetBuild`'s stripe pass JOINS it to the straight stripe (`roadDeco.snapPieceEnd`), so a drive's curb is ONE polyline per side and a tee's side stripe ends exactly where the through road's begins — no 3 ft chord overlap, no jog, no tick into the pad. Each side road's stripes end at THEIR OWN return's tangent (`junctionMouthCuts().side`, one half-width bar per tangent; the full-width cut stays for band fills), and a road's own tee/drive wedges no longer clip its own stripe. **A field a drive tees into has its mouth cut out of its OWN ink by the mouth's two tangent points, exactly** (`roadNetwork.edgeInkPieces`, `net.mouths`): the pad outline AND each stall row's outline (`rectBandOutlineCutPolylines`; it used to draw a line across the mouth) — polygon clipping is ill-conditioned along the tangent line, and the two disagreed by feet on a rotated pad. A cluster whose roads do not share one edge style strokes each piece of the OUTLINE in its OWNING road's style (`roadDeco.splitEdgeByOwner`, `data-edge-road`, SitePlanner `roadEdgeOwners` — model + settings only), so a drive narrower than its trunk no longer wears the trunk's weight/colour on its arcs. Guards: repo-root `test/` **junctionLinework** (every rotation; the owner's real plans), e2e **road-junction-linework** (red on the untouched build; reads rendered pixels), live ui-audit **verify-junction-linework-live** (V1717056).
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
  **⛔ B1645792 — `teeGeometry` HAS EXACTLY ONE LIVE CALLER (`driveJunctionsOf`, a road tee-ing into
  a parking field / truck court / paving pad), and its wedge builder used to anchor the SIDE
  (driveway) reach to `f.tan2` — a point on the driveway's THEORETICAL long-edge line, extended
  infinitely — pushed perpendicular by a small fixed `deepS`.** Road-to-road tees moved to
  `nodeJunction` (above) after B1011 and never hit this: the "through" side there carries REAL
  pavement width, so a side road's own flat end cap (`etOpenButt`, perpendicular to its centerline,
  not to `tan2`'s line) lands somewhere inside that wide strip by sheer overlap — a coincidence of a
  wide target, not a fix. A pad target is deliberately zero-width (`phT: 0` — its own fill is never
  unioned with the road's), so it has no such headroom: at an oblique approach the two corners are
  NOT symmetric about the flat cap (measured, 36 ft drive into a pad edge at 45°: one corner's
  `tan2` lands ~9 ft further INTO the strip than the cap, the other ~9 ft BEHIND it, on the side the
  strip's own polygon never reaches), so past roughly 40° the wedge on that side dissolved as its
  own disconnected island — a knife-edge notch where the strip's real, now-exposed flat cap met the
  pad's edge at a raw angle, with a hard, unfilleted corner on the other side. **Fix:** anchor the
  wedge to the driveway's REAL cap corner (`T - inS*phS`, the same point `roadStripRing`'s own flat
  cap uses), reach a small tuck past it into the strip, then take the CONVEX HULL of every candidate
  point (the arc is convex outward by construction, so the hull leaves the true curve untouched and
  only fills in whatever straight backing is needed to bridge to the real cap — ahead of `tan2` or
  behind it, no case split needed). Swept 0–89° across five widths/radii/pad sizes, incl. connecting
  a few feet from a pad corner and a rotated pad: every case is one simple, connected region.
  Guards: the repo-root `test/` suite **roadDriveJunctionFillet** (pure geometry, mutation-proven
  RED on the unpatched wedge) and the e2e spec **road-drive-junction-fillet** (the oblique case —
  the existing **road-drive-connect** spec only ever drove a PERPENDICULAR connect, exactly the
  symmetric case this defect never shows on; WRONG-CASE applies). PDF-PARITY holds by construction, unchanged:
  `exportSheet.buildExportSvg` clones the live `<svg>` rather than re-deriving road geometry.
  **⛔ B1645792 (×2) — THE HULL ABOVE ALSO FLATTENED THE ARC IT WAS SUPPOSED TO PRESERVE, AND
  COULD LEAVE A THIN THROAT NOTCH — because mixing the fillet arc into the SAME hull as the
  cap-reach points lets the hull draw a straight shortcut edge across the arc whenever the reach
  points sit farther out than the curve does (measured: a road-to-pad return collapsing to 2
  surviving arc points out of 24). `restoreArcOnHull` (`roadGeometry.js`) walks the hull's own
  vertices afterward and splices the true arc back in wherever the hull skipped over it — this can
  only move the boundary INWARD onto the real curve, never outward, so it cannot open a new gap —
  but it is **verified simple (`isSimplePolygon`) and DISCARDED, falling back to the plain hull, the
  instant it fails** (measured self-intersecting on a handful of angle/pad-size combinations during
  development). Scoped to `deepT === 0` — the ONLY live case — because `back1` (≈`tan1`) stops
  matching `arc[0]` once `deepT > 0`, and splicing against a non-matching anchor reopened a
  hair-thin sliver on the road-to-road (`nodeJunction`-adjacent but unrelated) generic library test.
  The near-perpendicular throat notch gets the same treatment: `T` (the tee point) joins the SAME
  hull (never a separate merged piece — two pieces sharing one vertex pinch into a visible cusp
  instead of real overlap) and is verified/discarded the same way. Guard: the same
  **roadDriveJunctionFillet** suite's new "NEW-1 (B1645792 amendment)" block (a point-in-polygon
  throat-notch scan + an arc-vertex-survival check, both confirmed RED against the merged `0f17770`
  fix before this amendment existed).
  **B1664512 — `teeGeometry`'s ONE live caller now accepts a POLYGON target, not just a rect.**
  `polygonEdges`/`polygonContainsPoint`/`polygonDepthBehind` (`roadGeometry.js`) are the polygon
  analogues of `rectEdges`/`rectContainsPoint`/a rect's own `w`/`h`, in the exact shape
  `nearestRectEdge` already consumes — `driveJunctionsOf` (the render), `driveTargetKind`/
  `driveTargetsOf` (which targets exist) and `findDriveConnect` (the weld-time magnet) all branch on
  `Array.isArray(el.points)` to reach for these instead. `polygonContainsPoint` is a real ray-cast
  (correct on a concave ring); `rectContainsPoint`'s half-plane shortcut would silently misjudge one.
