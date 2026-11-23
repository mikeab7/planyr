# Site Planner notes: interaction and hit testing

_Moved verbatim out of `src/workspaces/site-planner/CLAUDE.md` (audit batch H, 2026-11-23). Nothing below was reworded, shortened or removed; the folder pointer now only signposts here. Root rules in `/CLAUDE.md` still apply._

- **⛔ `lib/plannerCursors.js` (B2391600/B2391601, owner-approved cursor convention 2026-10-20) — ONE place for what the pointer looks like in the planner AND the Map view.** Convention: idle default · clickable pointer · movable body move (a LOCKED thing is pointer, never move) · empty pannable surface grab (grabbing while panning) · any ARMED draw/place/pick mode crosshair over EVERYTHING · vertex grips move · resize grips directional and FOLLOWING the object's rotation, built from the grip's own axes (`gripCursor(sx, sy, rotDeg)` — the old centre→corner angle gave ew on every corner of a long warehouse) · rotate grips `ROTATE_CURSOR` · disabled default (never pointer, never not-allowed) · busy progress · hover-only layers inherit. How it is enforced, not remembered: (1) the canvas root carries `data-cursor-mode` (`cursorMode` in `SitePlanner.jsx`: pan / identify / remove / armed — the armed set INCLUDES the pick modes `addLeaderFor`, `ovAlignBase`, `mergePick`, `attachFor`, `alignFor`, trace/pob/route/xsec/calibrate) and `plannerCursorCss` turns every descendant's cursor into the mode's with a stylesheet `!important`, so a new object type cannot forget to ask; (2) `drag.current.mode` → `dragCursorFor` pins the drag's cursor at the document root for the WHOLE gesture (cleared on pointerup/cancel/blur/Escape/hidden tab; every mode is classified — `test/plannerCursors`); (3) the Map has ONE cursor owner (`mapBaseCursor` + `setMapCursor`, `data-cursor-owned` makes every Leaflet feature inherit; never assign `container.style.cursor`), and site pins/polygons + a placed plan image go inert while a pin is armed / Select parcels is on (`sitesInert`, `blockSelect`); (4) the stylesheet also makes every disabled control default and native checkboxes/selects pointer. Guards: repo-root `test/` **plannerCursors**; e2e **planner-cursors**, **map-cursors** (computed cursor under the real pointer; red on 2500b00); live ui-audit **verify-planner-cursors-live** (signed in, deletes its throwaway plan). A lot's body PANS outside Edit parcels, so it says grab, not move (`parcelBodyCursor`).
- **`lib/clipBridge.js` (B2382272) — every canvas copy ALSO lands on the SYSTEM clipboard as a Planyr-marked JSON payload, so Ctrl+V pastes the elements even when a stale screenshot sat there.** The `paste` listener in `SitePlanner.jsx` parses the payload BEFORE looking for an image (pasteImage rule otherwise unchanged); a refused write warns loudly and lets the in-app copy win. Reference overlays keep their own internal copy. Guards: repo-root `test/` **clipBridge**; e2e **copy-paste-system-clipboard**; live V1810656.
- **⛔ A RIGHT-CLICK ALONG A LINE OPENS THE OBJECT'S FULL MENU — never a one-row stub (B1067 ×2, owner 2026-10-22).** `onCanvasVtxContextCapture` hands an edge hit to `onElContext` / `onMarkupContext` / `onMeasureContext` (a corner still opens the vertex menu; a parcel in Edit parcels keeps its small edge menu); each re-derives the clicked edge through `contextEdgeFor` (selected or not) and the menu leads with **Add control point**, and for an unlocked centerline road **Add a T-intersection here** (testid `road-branch-here`, starts at the clicked point on the drawn centerline) — the old standalone Road section is gone. Do not reintroduce a separate edge-only menu for these layers. Guards: e2e **road-context-menu** (red on b1b12e8); live V1808976.
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
- **⛔ `dragGate.js` — THE click-vs-drag gate. Every `drag.current` that MOVES existing geometry
  carries it (`...startGate(e)`), and it is applied in ONE place: the top of `onMove`, above every
  mode branch.** The owner's report — *"I intend to just click on something to select it, it
  actually also moves it, a couple feet or a pixel or two"* — was a missing test: the move branch
  wrote new positions on the FIRST pointermove, so a pixel of tremor was a committed move, and the
  ambient flush-snap (tolerance up to 20 ft) could then pull the element onto a neighbour's edge —
  the "couple of feet", and why it was intermittent. Four rules: **(a) TRAVEL ONLY, NEVER DURATION**
  — the pan path's tap test pairs slop with a 400 ms limit, which is right for "tap or pan" and
  wrong here; copying it ships the mirror-image bug (a slow, careful press that starts dragging),
  so the module holds no clock and a unit test fails if it acquires one. **(b)** the undo frame is
  pushed on the ARMING frame (`histOnArm`), never on the press — `pushHistory()` on pointer-down is
  what filled Ctrl+Z with no-op frames — and `cancelActiveMove` must not `drop()` a frame that was
  never pushed. **(c) THE REBASE IS OPT-OUT, and the two cases are not interchangeable:** a MOVE
  carries a grab offset so rebasing it is invisible, while a POINT drag (`vertex` / `elVertex` /
  `measureVertex` / `mkVertex` / `easeVertex` / `roadVtx` / `roadEnd`) writes the pointer's own
  position — rebased, it trails the cursor for the whole gesture and a road endpoint lands OUTSIDE
  the snap-and-connect magnet, so those pass `{ rebase: false }`. **(d)** release paths that WRITE
  or WARN are gated on `dragArmed(d)` too, so a click cannot prune an apron, weld a junction or
  flash a civil-radius warning. `pan` / `draw` / `mkDraw` / `marquee` are deliberately UNGATED (they
  create geometry or move the camera; a slop gate would change what they mean). Guards: the
  repo-root `test/` suite **dragGate** (the pure rule + a wiring guard over every drag start, both
  mutation-proven red) and the e2e spec **click-never-moves** (all four cases proven red on the
  pre-fix build, where a tremor click moved a building 771.43 → 774.29 ft).
