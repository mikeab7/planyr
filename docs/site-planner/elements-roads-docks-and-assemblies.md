# Site Planner notes: elements roads docks and assemblies

_Moved verbatim out of `src/workspaces/site-planner/CLAUDE.md` (audit batch H, 2026-11-23). Nothing below was reworded, shortened or removed; the folder pointer now only signposts here. Root rules in `/CLAUDE.md` still apply._

- **⛔ `lib/trailerOverRoads.js` (B2586592, owner order 2026-11-05) — TRAILER PARKING ALWAYS DRAWS ABOVE ROADS: the one owner-ordered exception to newest-on-top (root constraint 10), a RENDER-ORDER rule only.** `liftTrailersOverRoads` is one linear pass over the already z-sorted paint list (the trailer moves to just above the highest road / road cluster that painted above it; no stored z is ever written; roads keep their place against everything else; only `type === "trailer"` gets it). Seams: `SitePlanner.jsx` `elPaintItems` (normal AND lifted list — the print clone, PDF annotation order and hit-test follow the canvas DOM), `planThumbnail.js`, `kmzExport.js` (`sortElsForPaint`). Arrange stays live and `arrangeRuleNote` says why Bring to Front on a road / Send to Back on a trailer can't change this pair. Never widen it to another type pair. Guards: repo-root `test/` **trailerOverRoads**; e2e **trailer-over-roads**; live ui-audit **verify-trailer-over-roads-live** (V2035648).
- **⛔ `lib/parkingApproach.js` + `lib/roadJunctions.js` (B2498960, owner 2026-10-29: "cleanly connect roads to employee parking … all the different angles of attack") — HOW A ROAD MEETS A CAR FIELD, OUTSIDE AND INSIDE.** Outside = `driveJunctionsOf` (curb returns); inside = `parkingApproach` (stalls, aisles, outline). Rules to keep: **(1) ONE target predicate** `driveTargetKindOf` — the connect gesture (`driveTargetsOf`) and the geometric fallback read it; a field bonded to a building is a target (the fallback used to refuse `attachedTo`, so a stale `driveTee` lost the junction). **(2) Each END of a road finds its own target** (`driveTee` + `driveTee2`; same field at both ends = one junction); records are only the user's kind / radius choice, geometry decides the rest; the Road panel writes a record WITH its `targetId`. **(3) Skim:** a drive within `SKIM_MAX_PHI_DEG` (10°) of the face, or whose corner lies past its own far end, builds NO return (B1756546; sweep the repo-root `test/` suite **roadSkimSweep**). **(4) `keepOut`**: nothing of a drive runs on past the face plane beside the field. **(5) Stalls are CELLS of `carStalls`** (band `i`, column `k`); a drive on a ROW side removes the cells its footprint covers >15% up to the first aisle (`stallClipOf`, `roadNet.stallClips`); the renderer draws each band as KEPT RUNS (`keptRuns`); the Properties "Stalls" and the Yield (`siteMetrics`) read the SAME answer through `fieldInsidesOf` — never count stalls a second way. **(6) Aisles are read off the bands** (`aislesOf`), because `carStalls.aisles` lists only between-row aisles and a single-loaded bay's lane is leftover depth. **(7) Aisle snap** (`aisleSnapFor`, in `findDriveConnect`): an END-face landing within half-an-aisle + 6 ft centres on the aisle and never re-aims a last leg more than 8°. **(8) A road through the field** removes the stalls under it and cuts the outline at both crossings; **a drive along the aisle-mouth face** opens every aisle (outline mouth + a curb cut in the road's stripe + pad-cut). **(9) ⛔ THE APP DOES NOT SHOW WHAT THE ROWS SAY:** `createSiteModel` re-seats bonded children on open (Tsakiris `e52duuwgj` moves 5 ft), so test a real plan THROUGH `createSiteModel`, never on raw rows. **(10) ⛔ A ROAD FOLLOWS ITS FIELD (B2498961, owner constraint #48):** `lib/driveFollow.js` `followDrives(base, prev, next)` — a road whose `driveTee`/`driveTee2` names a field it touches carries its connected END (last control point only, same edge / same spot along it) when that field moves for ANY reason, and lets go past `DRIVE_FOLLOW_MAX_FT` (100 ft), on a fold-back or a leg shorter than the road is wide; locked roads never follow. Two seams only: the end of `siteModel.normalizeBondedChildren` (the heal, both read paths) and `SitePlanner.jsx` `setEls` (a wrapper over `setElsRaw`; undo/redo, remote rows, loads and restores use `setElsRaw` and are never re-interpreted; `startGate` carries `followBase` so a drag is measured from where it began). The target predicate and touch test live in the leaf `lib/driveTarget.js` (re-exported by `roadJunctions.js`). **A road the OWNER drags (a control point of its own, NEW-1 2026-11-10 / B2671214) is the gesture's, not the rule's: `ownedByGesture` — any control point at neither its base spot nor its follow spot — makes `followDrives` leave the road as written, so a dropped end never snaps back to the base.** Guards: repo-root `test/` **driveFollow**, **roadEndDropStays**; e2e **drive-follows-parking**, **road-end-drop-stays**; live ui-audit **verify-drive-follows-parking-live** (V1967152), V2115873. Not built: rounded stall-row ends beside an aisle mouth (B2498962). Guards: repo-root `test/` **driveParkingMatrix** (the approach matrix, red 132 on main; its helper is the driveMatrix module in the test helpers folder), **parkingApproach**, **driveParkingRealPlans** (Tsakiris 2026-10-29), **roadSkimSweep**; e2e **road-parking-approach** (real tools); live ui-audit **verify-road-parking-approach-live** (V1949184; the ui-audit render-drive-cases and render-plan-fixture scripts draw the cases to PNGs — the PICTURE found a defect no metric did).
- **⛔ Road TAPER at a width change (NEW-1, 2026-11-10, root constraint #55) — `lib/roadTaper.js`.** Two roads whose endpoints coincide with different widths: the WIDER road's end narrows to the narrow road's width (strip, face-of-curb lines, ROW lines when both designate a ROW, a designed section's band edges scale with it). DERIVED, never stored: `roadTapersOf(els)` → `{ byRoad, joints }`, delivered as `trim.taper` by `siteGeometry.roundaboutsForSite` (the plan's one per-road geometry side-channel — `roadStripRing` / `roadCurbLines` read it, so the canvas, `siteMetrics`' paved area, the dissolved network and the export agree); the only stored field is the typed length `road.taper = { s?, e? }`, written by `SitePlanner.jsx` `setRoadTaper` from the Properties "Taper" section (shown only on a road with a tapered joint). An angled joint's outside corner is `taperJointCover` via `roadNetBuild.weldJunctionsOf` (equal-width welds keep `weldCoverPolygon`). Gotcha: union paths with opposite winding under NonZero CANCEL — `buildRing` winds every path the same way. Outside-curb sidewalk bands taper by the same ratio; lane seams are clipped to the tapered strip. Guards: repo-root `test/` **roadTaper**; e2e **road-taper**.
- **Drive-in ramp (B2566544–B2566547, owner 2026-10-30) — `lib/driveInRamp.js` is every rule; the element is `type: "driveInRamp"`, `attachedTo` its building, `ramp: { side, at, width, gradePct, riseIn?, layout, dir, door, wings }`.** **No bollard dots (owner 2026-11-24, recurrence of the 2026-11-06 report): the ramp draws no dot anywhere and Properties has no Bollards switch; an old stored `bollards` is ignored; guard `test/rampNoDots.test.js`.** **A new ramp sits FLUSH against the corner bump-out, or the building end when there is none (owner 2026-11-24): the corner "+" and the stranded-ramp heal both read `pickRampSpot({ L, W, where, taken, bumps })` (no door-module snap at the corner; a ramp already there is pushed past, flush against it); turning a flush ramp along the wall or back keeps it flush (`flushEndOf` / `flushRampAt` / `fitAlongTheWall`'s `flushEnd`); guard `test/rampFlushDefault.test.js`.** A drive-in door is a grade-level overhead door on a dock-high wall with a concrete ramp climbing from the apron to the FFE (length = rise ÷ grade; wing walls); on a non-dock wall it is a door MARKER only. The small slate "+" — one beside each purple corner "+" of a dock wall (two per dock wall; NONE at the wall's middle by the pair — owner 2026-11-02), OUTSIDE the walls via `lib/buildingButtons.js` — adds one (`addRamp(b, side, "start"|"end")`, the end of the belt by that corner); the box is a DERIVED cache re-fitted from the host by `refitRamps` at the `setEls` seam, and a bonded-wall scan must skip `driveInRamp` (the `type !== "driveInRamp"` filters).
  **⛔ A RAMP IS NEVER LEFT OFF ITS BUILDING (B2671194, owner 2026-11-06 — Academy › Concept A Building 4: two ramps placed against a ~918-ft wall at 850.84 stayed behind, ~66 ft past the end, when it became 784):** `at` is an absolute distance from the wall's start, so `lib/driveInRamp.js` `reseatRamps(base, prev, next, ctx)` runs at the `setEls` seam BEFORE `refitRamps`: a ramp in the nearer half of the wall it was placed against keeps its distance from that end (start ramps stay, end ramps move with the end), then is clamped onto the wall; a re-seated ramp that lands on another ramp of the wall is DROPPED (the belt is derived from the ramps that exist, so the door modules come back; the seam queues the id and tombstones it); a write that changed the ramp's own `at` is the owner's choice and is not followed. A drag measures from `followBase` (so shrinking then growing back restores the ramp). The same function is the on-open HEAL (an effect in `SitePlanner.jsx`, never mid-gesture): a ramp whose door centre is past a wall end goes FLUSH against the bump-out / wall end at that end through `pickRampSpot` — the ONE answer the "+" button (`planRampAt`) also reads (2026-11-24; before, both snapped to the corner door module). Undo/redo/loads use `setElsRaw` and are never re-interpreted. Guards: repo-root `test/` **rampFollowsWall** (Building 4's real numbers; red on the pre-fix seam); e2e **drive-in-ramp** (the real planner shortens / lengthens / undoes / reloads; red on the pre-fix build); live ui-audit **verify-ramp-follows-wall-live**.
  **Defaults: 16 ft wide, 8 %, straight-in, 12×14 door, wings on, rise = the PLAN's dock height (`settings.floodMitigation.dockDropFt` × 12, 48 in) until the owner overrides `riseIn`** — a 4-ft rise at 8 % is 50 ft. Flags (amber): grade > 10 %, straight-in longer than the court in front, crossing an element / the setback, past the wall end.
  **It displaces dock doors (`dockDoorRun`'s 6th argument — canvas, door count and "· N drive-in" share it) and is a PAD MEMBER under grading** (owner-only, only while grading is on): a plane from apron grade (host FFE − rise) at the low end to the FFE at the door (`proposedSurface.buildPlanes`, precedence over its court, exempt from seam bending). The estimate has no dock items, so there is no ramp cost line. Guards: repo-root `test/` **driveInRamp**; e2e **drive-in-ramp**; live ui-audit **verify-drive-in-ramp-live** (V2015200).
- **⛔ PAVING SETBACK (owner-approved mockup 2026-11-09) — `lib/pavingSetback.js`, `pc.pavingSetbacks` (second per-edge array, ABSENT = not added; starts at 0, NEVER derived from the building setback; same sections; limits car/trailer parking, truck courts/paving and roads — NOT sidewalks or buildings; a drive whose end lies outside the site may cross the line).** Panel = `SetbackSections.jsx` (`paving` + `onAddPaving` props); line = dotted `PAL.paving` beside the building ring in `parcelTierNodes`; conflicts = a 120 ms trailing-debounced scan in `SitePlanner.jsx` (`pavingFlags`, review chrome `data-export="skip"`, zero cost until a parcel adds paving). Corner insert/delete shift the array (`shiftPavingOn*`), a split carries it (cut edge = 0). Guards: repo-root `test/` **pavingSetback**, **pavingSetbackWiring**; e2e **paving-setback**.
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
  **⛔ B377890 — AND WHAT THE HEAL MUST NOT DO. A heal that meets a state it cannot repair has two honest
  options: repair it, or say so.** It had a third — quietly produce *a* layout and report success — and
  it took it: a truck court was deleted, `normalizeCrossHostBonds` dropped its trailer's `forCourt` as
  "dangling", `normalizeStrandedZones` read the orphan as a chain HEAD, and the trailer was laid flush
  against the dock wall 135 ft inboard (exactly the missing court's depth) under an
  `assembly-tear-healed`. B1124's rule is SPLIT on the fact it was always about: a bond naming a REAL
  element on the WRONG host is still re-pointed; a bond naming NOTHING is a MISSING SIBLING and both the
  bond and the geometry are left alone. `assemblyIntegrity` returns **`unhealable`** — deliberately
  separate from `tears`, so "we fixed it" and "we cannot fix it" can never become one number — carrying
  `missingBondSiblings` (bookkeeping) and **`impossibleStacks` (GEOMETRY: a trailer row first in the
  stack on a wall with no truck court)**. The geometric one is load-bearing: after the old pass tidied
  the dangling reference away, every bond in the plan was coherent and the drawing was impossible, so
  any check reading the bonds would have passed. Guards: the repo-root `test/` suite **assemblyMissingSibling** and the
  e2e spec **assembly-missing-sibling** (the LOAD seam persists what it decides, so only a browser
  proves the plan on disk), both mutation-proven on the owner's real Building 3 rows.
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
- **⛔ `dockZones.js` — WHICH WALLS ARE LOADED IS *STORED*, NOT RE-DERIVED ON EVERY READ (B385041).**
  `dockSidesFor` opened with `el.w >= el.h ? ["top","bottom"] : ["left","right"]`, so shrinking a
  cross-dock building past square rotated the entire dock assembly 90° MID-DRAG — and with `>=`, one
  foot either side of square flipped it and flipped it back. `el.dockAxis` (`"x"` = top/bottom,
  `"y"` = left/right) is stamped once and never re-derived: at CREATION, by the load-time
  `healDockAxes` (which stamps the axis a plan CURRENTLY RENDERS, so no existing plan moves), and in
  `refitChildren` — the one funnel every building resize goes through — from the PRE-resize
  footprint. A stored `dockSide` is the more specific statement and WINS on an established building;
  ⛔ the `established` gate is not ceremony — a legacy record can carry a `dockSide` that disagrees
  with what it renders, and honouring it unconditionally on load would strand (and therefore prune)
  the zones bonded to the walls the plan actually shows. `rotateDockAxisPatch` is the DELIBERATE way
  to turn the face (Properties → Loading → click a wall on the wall picker, `lib/loadingWalls.js` `wallClickPatch`), which has to exist now that a
  resize cannot do it by accident. B548's contract (depth/length readouts, massing panel, column
  grid, dock-door count) holds against the STORED value for free, because they all read
  `dockSidesFor`. **B416/B417 are the CONSEQUENCE of the old flip, not duplicates — they still prune
  stranded zones and are untouched; they simply almost never fire now.** Guards: the repo-root
  `test/` suite **dockOrientation** (which replays the pre-fix rule as the mutation check) + the e2e
  spec **undo-dock-plan-menu** (real edge-grip drags, the dock face read off the painted
  `data-dock-apron` band; mutation-proven 4/4 red).
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
- **`loadingWalls.js` (B2144160–B2144168, Building panel rethink) — the Loading wall picker's pure half:** the little rotated plan's geometry (`wallPickerLayout`, labels upright, never over the rectangle or the north arrow), what a wall click does (`wallClickPatch` — loading is one wall or an OPPOSITE pair, never an L), the words (`loadingSummary`/`loadedWallsLabel`, from `dockSideCompassLabel`) and the bump-outs a change strands (`strandedBumpIds`, two per loaded wall). `SitePlanner.jsx`'s `applyBuildingLoading` is the one writer. Outline width/opacity are element props `strokeWidth`/`strokeOpacity` resolved by `planStyle.elStyle` (`weight` follows `strokeWidth`; `strokeWidthSet` is null until someone sets one, so a road's zoom-derived curb stroke stays automatic). Guards: repo-root `test/` **loadingWalls**, **outlineStyle**; e2e **building-panel-rethink**.
- **`wallRows.js` + `loadingWalls.js` `wallPickerLayout` (B2224784–B2224790 v2; Building panel v3 — "Docks & walls") — the section is ONE STRIP per wall.** `wallRows.js` (pure) decides the rows (`wallRowPlan`: dock · rear · ends — EVERY wall is its own row; a stored `b.dockStacksLinked` is ignored), the strip (`stripPlan`: bar length ∝ the wall's total depth on ONE scale for the whole building, pieces ≥ a minimum split by depth; `pieceLabel` `135′` / `×2`, `pieceTooltip`, `pieceShowsIcon`, `legendKinds`), what the end-of-row add control offers (`addOptions` = the allowed SET; `orderedAddOptions` = the same set ordered, first entry = the LEFTMOST icon; every entry is its OWN 22-wide icon button on the wall's row — the layer's legend swatch (the strip piece's fill) with its `WallKindIcon`, NO word, aria-label / title carry the full name, after a plus glyph that is not a button, NO ▾ and no menu — B2651024 ×2, 2026-11-04, owner: "Put every option on the row as its own icon, no ▾"): dock wall court → trailer → buffer → sidewalk; any other wall empty → sidewalk · sidewalk → parking · parking (or sidewalk > parking) → parking = ONE MORE ROW through `growEmployeeSide`, the on-map "+" ladder, never a second implementation · sidewalk > parking > buffer → road · sidewalk > buffer → parking; `WallAddControl` is a plain module-scope row of buttons (`data-testid="wall-add-<kind>"`, group `wall-add-group`, glyph `wall-add-plus`); the row fits ONE line by arithmetic, not by eye: `STRIP.FULL` is 66 and `ADD_GROUP` / `addGroupWidth` (lib/wallRows.js) hold the head + gaps + five-icon width so head 58 + 2 gaps + strip 66 + five icons 130 = the 266-wide phone sheet (repo-root `test/` **wallRows** proves it for every stack ≤ 3 deep; a strip that needs more than FULL to hold its pieces may squeeze, never the icons). `KIND_LABEL.sidewalk` is "Sidewalk", never "Walk". `growParking` / `addSideParkPieceBeyond` repack the flush buffer / road in the same history frame; `WallRows` opens the parking box when the ROW count rises. A buffer BETWEEN sidewalk and parking is not representable and is not wanted — owner 2026-11-04: "Parking between the sidewalk and the buffer is fine" (B2651026 closed). Guard: e2e **wall-parking-buildup** (real build-up + wall-state matrix at rot 0 / 315 on a rear, end and dock wall, EVERY offered icon pressed, the row measured at desktop and phone width via `rowFit` in the e2e helpers) and **wall-add-control**), **what the bin does (`planDockPieceRemoval` / `applyDockPieceRemoval`: ONLY that piece — everything outside keeps its depth and moves in; the one forced exception is a court's own trailer parking)** and the trailer-parking arithmetic (`trailerSpec`, `trailerPatchRows/RowDepth/Aisle`: `zd` = Σ row depths + ⌊rows/2⌋ × aisle = exactly the band · aisle · band `trailerStalls` draws; v3 **per-row depths** ride the zone as `trailerRowDepths` — absent ⇒ every row uses the single depth, so old plans load unchanged; `trailerCfg(…, side)` stamps `trailerFlip` on a top/right wall so row 1 is always against the court). **A dock wall's chain may be headed by a court-less layer** (`findHeadIn` in `SitePlanner.jsx`: a `noFit` stack member stamped `stackSide` whose inboard neighbour is gone — the survivors of a binned court); it is bonded with no dangling `prevZone`, so the load-time heal (`normalizeStrandedZones` sees a genuine head) leaves it alone — proven in repo-root `test/` **dockPieceRemovalHeal**. `components/WallKindIcon.jsx` is the ONE icon set (strip · legend · edit box; inks + the piece text/edge colours live in `planStyle.js` `WALL_KIND_INK`/`WALL_PIECE_*`); a piece's fill is its layer's `elStyle` colour so the strip and the canvas always match. the shared `NumberBox` frame (src/shared/ui) is the one-box number control (value · unit · ▲▼) used by `NumInput boxed` and `RotationStepper boxed`; `Collapse`'s `headerRight` sits BESIDE the toggle button. `wallPickerLayout(b, {bumps})` draws the building to scale with each bump-out; bump-outs are one line under the picker (`bumpSummary` + an `edit` link), not a dock-row chip. `SitePlanner.jsx`: module-scope `WallRows` / `LoadingWallPicker` / `PadElevRow` / `LineSample`, and per-wall handlers that take the row's `sides` (`setWallLayerDepth`, `setTrailerRows`, `setTrailerRowDepth`, `setTrailerAisle`, `removeWallLayer`, `addWallLayer`, `toggleBumpEnd`, `toggleBumpCorner`, `setBumpSize`, `buildingMetrics`) — never fan an edit out across every dock / end wall again. **Repeat trailer rows + per-layer extent (B2268800):** the dock `+` always offers Trailer parking (a repeat row is its own chain element — `planTrailerRowAdd`, no `forCourt`); a layer added to a dock wall inherits the previous layer's along-wall LENGTH + POSITION (`inheritExtentFields`, over the existing `alongLen/alongAnchor/alongOff`), never its depth; the edit box NO LONGER edits a layer's extent (NEW-1, 2026-11-03: no Length / Align / Full length on any wall — a layer is shortened by dragging its end HANDLE on the map, owner: "typing a number gives no control over which side moves"; the DockLayerPanel's Length stepper is untouched). `layerExtentPatch` / `wallExtentAfter` / `layerAlignOf` stay as pure, tested helpers; **a Walk or Buffer on a rear / end wall is DERIVED from the wall span, so `refitChildren`'s wall-strip branch stamps `extentFieldsFor(...)` onto it when a USER resize changes its run along the wall (otherwise the relayout re-derives the full wall and the dragged end snaps back — measured; red-proof in e2e **wall-layer-handles**)**. **Rear / end walls (B2268801):** the SAME three keys on a Walk / Buffer / Road / Trailer layer (`dogEar.wallStripBoxFor` for strips + buffer, `flushKidBoxFor` for road + wall trailer, resolved against the extended-side span; `extentFieldsFor` / `layerAlignOf` / `wallExtentAfter` are the edit-box model; parking keeps its own `sideParkFit` run); a rear/end trailer row is a flush wall layer tagged `wallTrailer` (never a dock-chain member; `impossibleStacks` skips it). Guards: **trailerRowRepeat**, **wallExtentRearEnd**, e2e **trailer-row-repeat** / **wall-extent-rear-end**, live **verify-wall-add-control-live** (replaced verify-trailer-row-repeat / verify-wall-extent-rear-end, which typed lengths), e2e **wall-add-control** / **wall-layer-handles** (every layer kind × dock / rear / end wall × rot 0 / 315, both ends; helpers `addWallLayer` / `dragWallLayerEnd` in the shared e2e helpers and the ui-audit lib's wallLayerDrive module). **The one-line edit box (NEW-1): swatch · name · numbers · bin; trailer with one row = Rows + Depth ("Depth", never "Row 1"); two or more = Rows, then Row 1 · Row 2 · Aisle on a second line.** `STRIP.FULL` is 118 so the longest named button ("+ Parking ▾") fits the row on ONE line at the 290-wide panel and the ~266-wide phone sheet. Guards: repo-root `test/` **wallRows**, **dockPieceRemovalHeal**, **siteColourDefaults**, e2e **building-panel-v2** / **building-panel-v3**; live: ui-audit **verify-building-panel-v2** (V1643888). **The inspector header's ⋯ menu (NEW-2) is module-scope `InspectorMoreMenu` over `AnchoredMenu` with `swallowOutsidePress` — the press that closes it does nothing else; never a bare `<details>` for a menu.** Guard: e2e **inspector-more-menu**.

## The assembly engine is pure (audit batch G3)
The dock / wall-kid / ramp relayout engine that used to live inside the `SitePlanner` component is `lib/assemblyOps.js`: pure functions of the element array (zone chains, wall strips, side parking, dog-ears, `relayoutSideIn`, `refitChildrenIn`, `resyncBondedRot`). The few that read the live `settings` take it as an explicit last argument (`…In` names); the component keeps thin wrappers with the old signatures. Never import back from `SitePlanner.jsx`; unit tests are `test/assemblyOps.test.js`.
