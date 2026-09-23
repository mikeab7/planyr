# Notes — what a fresh session needs to know

> **⛔ READ THIS BEFORE TOUCHING `src/workspaces/notes/`.** It exists to make starting a NEW
> session the CHEAP option. **Default to a new session per task, on Sonnet;** continue an existing
> one only when it holds a rig this file cannot replace (a live reproduction, a measurement bench,
> a half-built harness). A warm container is not a reason.
>
> **⛔ WHY IT EXISTS, stated plainly because the failure is the point.** The project rule is one
> task per session, then archive. It was ignored for a week: everything went into one session,
> which ended up re-reading roughly **half a million tokens of history on every dispatch**. The
> justification each time was that a fresh session would have to rediscover too much — and that
> was TRUE, because everything a fresh session needed lived only in the old one's memory. Writing
> it down somewhere a session does not read is the same mistake wearing a different hat. So it
> lives HERE, in the repo, and `CLAUDE.md` points at it.
>
> **⛔ KEEP IT CURRENT.** A new instrument trap or bug family gets added to this file **in the same
> commit that discovers it** — never left in a session's memory. That is the whole mechanism.

---

## 1 · Instrument traps — these produced FOUR false findings. Check them before reporting anything.

Every one of these made a harness confidently report something untrue about working code. The
general form is the repo's named rule **DRIVER-SCROLL-IS-NOT-APP-SCROLL clause 6**: *point a probe
at a case whose answer is already known, and require it to report that known answer, before
trusting it on the unknown case.*

1. **Container scroll shifts every client rect.** *"The block crawls while you type"* was the page
   scrolling. Scroll the container to top before comparing rendered geometry, or compare against
   the container rather than the viewport.
2. **Synthetic events do not move the native caret.** A simulated click cannot judge
   caret-follows-click.
3. **A gesture needs a REAL press** — `pointerdown` + `mousedown`, a short hold, then `pointerup`.
   `element.click()` does not drive the place/drag paths. A truncated sequence leaves the commit
   un-fired and looks exactly like *"resize does not save"*; that cost two rounds. Use
   `ui-audit/lib/pressFeature.mjs`.
4. **Never trust a synthetic keystroke.** Drive real key input (`page.keyboard.press`, CDP
   `Input.dispatchKeyEvent`) or press the control that does the job, and **a command call must
   never stand in for a keystroke** — that proves the command, not the binding.
   > **⛔ CORRECTED HERE against the repo's own measurement.** The carry-forward this file was
   > written from said *"keyboard events do not register at all in this app."* That is overstated,
   > and the precise version matters because it names what to do instead. Measured (see
   > **SYNTHETIC-KEYS-DONT-EDIT** in `CLAUDE.md` for the full table): the handler is bound to
   > `window`, and `new KeyboardEvent(…)` defaults to **`bubbles: false`**, which a real key event
   > never does — so a synthetic event dispatched on `document` or `document.body` never reaches
   > it, while the same event with `{ bubbles: true }`, or dispatched on `window`, works fine. The
   > app never checks `isTrusted`. It is one missing option, and it fails in **total silence**.
   > Two further gates swallow the key by design: a **focused field**, and an **inactive planner**.
5. **A selection must be a real `Range` inside the editor.** `execCommand("selectAll")` then
   clicking a toolbar button applies nothing.
6. **Read the STORED document, not the screen.** Resize looked perfect on screen while saving
   nothing (B434417 — *rendered 300, stored 180, 180 after a reload*). Persistence claims are read
   from storage, then **re-read after a reload**.

**Six more of the same species came from our own harnesses**, not from the app: reads landing
before the 600 ms save debounce; comparing against the wrong baseline (hand-authored seed bytes
rather than the editor's own serialisation); a fixture that already contained the thing asserted
absent; and **twice** picking the option that means *do nothing* — choosing `Lines: Single` when
single was already the default, and a colour swatch that was `Default`, i.e. remove.

Two more found since, each worth its own line because each returned a confident wrong verdict:

7. **Polling misses a state the app restores within a frame.** The drag-narrows defect was invisible
   to five reads 60 ms apart and obvious to a `requestAnimationFrame` sampler. A transient reflow
   is still a reflow. See `ui-audit/measure-notes-drag-width.mjs`.
8. **A driver option that is silently ignored is indistinguishable from a broken feature.**
   `page.mouse.click` accepts `button`/`clickCount`/`delay` and **drops `modifiers`** (that option
   belongs to `locator.click`), so every Shift+click replaced the selection instead of extending
   it and the harness reported *"the group drag moves only one box"* about working code.
9. **A BOX'S TOP-LEFT CORNER IS THE DRAG GRIP, NOT ITS CONTENT (2026-08-28).** A harness that
   clicks `boxEl.x + 10, boxEl.y + 10` to "enter" an anchored box is aiming at
   `.planyr-anchor-grip` (`left: 3px; top: 4px; width: 12px; height: 20px` in `NoteEditor.jsx`'s
   `EditorStyles` — it was 9×14 when this trap was written), which has its OWN mousedown handling
   for dragging the box and never reaches
   `focusFromMat` at all. This produced a completely convincing false positive: a caret that
   looked permanently stuck on "click a different row inside an already-entered box", an
   every-other-click toggle in the trace, and a plausible-sounding root cause in the app's own
   selection-vs-editing state machine — all from one bad pair of coordinates. The tell was an
   `elementFromPoint` check at the intended click coordinate (which correctly resolved inside
   the box's content) not matching what a mousedown-capture trace on `window` actually saw
   (nothing, for the corner clicks). **Click the box's actual visible content** (the center of a
   real cell/word), never a fixed offset from the box's own bounding rect corner.
   > **⛔ AMENDED 2026-09-08 (NOTES-FREE-PLACEMENT) — the trap is NARROWER now but is NOT gone.**
   > The whole box body is a drag surface, so the grip is no longer the only way to move a box and
   > the two behave the same on a press that travels. What is unchanged, and is why this stays:
   > the grip still owns its own press, still sits at the box's top-left, and still is not content
   > — so a fixed offset from the corner is still not a way to reach a word.

10. **A DRAG THAT LEAVES ITS OWN ELEMENT STOPS BEING DELIVERED TO IT (2026-09-08).** A body drag
   wired with `pointerdown` + `pointermove` on the box, capturing the pointer only once a movement
   THRESHOLD was crossed, moved nothing at all — because a 150px drag leaves a 180px box within a
   few pixels, and `pointermove` stops targeting an element the pointer is no longer over. The
   gesture never reached its own threshold. It reads exactly like the defect being fixed (the box
   does not move, silently), and it reported as one. **Capture the pointer at the PRESS**, and use
   the threshold only to decide whether the gesture COUNTS as a drag; capturing does not swallow
   the press, so a deferred drag can still coexist with a `mousedown` handler that selects.
11. **A HARNESS THAT KEEPS PRESSING THE SAME BOX ENDS UP INSIDE IT (2026-09-08).** The two-stage
   model means press 1 selects and press 2 puts the caret IN the box — so a harness that clicks a
   box to select it, then runs several gestures in sequence, is measuring a box in EDITING state by
   the second gesture, where a body drag correctly stands down in favour of text selection. Four
   consecutive "the drag does nothing" rows came from that and from nothing else. Open a fresh page
   per case, or drive the grip, which drags unconditionally.
12. **⛔ CORRECTED SAME DAY (NEW-8): A CLICK IN THE MAT CREATES NOTHING — IT ARMS A CARET, AND THE
   FIRST CHARACTER MAKES THE NOTE.** This entry originally read "a click in the mat now creates a
   note, so click away is not a neutral act", which was true for about six hours and is exactly the
   kind of stale instruction that costs a session. What survives is the reason it was written: a
   count that reads 1 before and 1 after can still be a DIFFERENT box, so compare the stored
   document as a STRING or compare identities — never counts. And the new rule has its own trap in
   the other direction: a harness that presses and expects a node without typing will report the
   correct behaviour as "the placement gesture has stopped working". `ui-audit/lib/pressFeature.mjs`
   sends the committing keystroke for you.

13. **A CONTROL THAT LIVES IN THE "More" SHEET READS AS *MISSING*, NOT AS *BROKEN* (2026-09-08,
   NOTES-TOOLBAR-STATE).** The first run of `verify-notes-font-control.mjs` reported the three
   alignment buttons as exposing "no state at all". They expose it fine — they simply are not
   rendered until the More sheet is open, and a closed toolbar has nothing to query. Same
   species as trap 9 and as DRIVER-SCROLL-IS-NOT-APP-SCROLL §6: **the harness's own question
   produced the reading.** Open the sheet for the read (every control on the bar stops
   `mousedown`, so the selection survives) — and ASSERT that it survived rather than assuming,
   which is what that harness's `snapshot()` now does.
14. **A "MIXED" FIXTURE IS ONLY MIXED IN THE DIMENSIONS YOU ACTUALLY VARIED (2026-09-08).** The
   same harness graded Block style, Line spacing and both list toggles as "guessing" because
   they reported the same value on its uniform and its mixed range. They were right: both of its
   blocks were plain paragraphs in no list, so those four properties genuinely agreed across
   both ranges. **A table that grades N properties needs a fixture that disagrees in all N** —
   otherwise the honest answers fail and the real defects hide among them. The fixture now
   varies list membership, block style, alignment, line spacing, every mark, font, size and
   colour at once.
15. **AND THE OLDEST ONE IN THIS REPO, WHICH STILL COST A ROUND TODAY: THE HARNESS MEASURED A
   BUNDLE THAT DID NOT CONTAIN THE FIX (2026-09-08).** A paste fix read as "still broken" — the
   run that reported it was driving a `dist/` built before the fix was written. It is the local
   twin of the repo's own live-measurement rule (a deployed chunk hash must be read in the same
   call as the assertion): **rebuild, then measure, and treat a fix that "changed nothing at
   all" as a build-staleness suspect before a code suspect.**
16. **A GUARD CAN PASS WHILE THE MECHANISM BEHIND IT IS DEAD (2026-09-08, and this one shipped).**
   A VIEWPORT-STABLE compensation read `dom.offsetLeft` to detect a layout shift. That value is
   ALWAYS 0 for the editor body — its offsetParent is a wrapper inside the sheet, not the scroller
   — so the delta was always 0 and the effect never once ran. Its harness was green because every
   case pointed at it had the sheet centred and growing rightward, where there is no shift to
   compensate. **Point a new guard at the one scene it exists for, and prove it RED there**, or it
   is measuring nothing. Measured tell: the sheet's padding went 40px → 236px while the watched
   value read 0 both times.
17. **A SCROLL DEFECT IS INVISIBLE ON A PAGE THAT CANNOT SCROLL (2026-09-08).** Two sections
   asserting "the view does not move" stayed green on a build that moved the view 362px, because
   their fixtures were short enough to fit. Only a note long enough for the pane to scroll, already
   scrolled, caught it. Any harness asserting scroll invariance needs a VACUITY GUARD that fails if
   there was no scroll available to lose.
18. **A HARNESS EDIT IS CODE AND CAN BE THE BUG (2026-09-08).** Adapting a suite to a changed model
   (a press no longer creates a note; the first keystroke does) meant adding a committing keystroke
   after every press — and one of those presses was the double-click-to-select-a-WORD case, where
   the keystroke typed over the very selection being asserted. The harness then correctly reported
   a defect that existed only in itself. **Diff failure IDENTITIES against a baseline build, never
   counts**: that is what separated three real regressions from twelve pre-existing ones here.

16. **A DRAG THAT STARTS INSIDE AN EXISTING SELECTION IS A DRAG-AND-DROP, NOT A NEW SELECTION
   (2026-09-09).** Caught by a harness contradicting ITSELF: "two genuinely different colours go
   indeterminate" failed in the suite and PASSED when the same two runs were driven alone. The
   difference was the PRECEDING gesture — the new drag's mousedown landed inside the range the
   last one had left selected, so the browser began dragging that text instead of selecting. It
   is silent, it can MOVE content, and every assertion after it describes a selection nobody
   made. **Click once to collapse before every drag, and then PROVE what got selected**
   (`document.getSelection().toString()` must contain both endpoints) rather than assuming.
17. **THE BASELINE FOR A "WAS THIS ALREADY BROKEN ON MAIN?" CHECK MUST INCLUDE UNTRACKED FILES
   (2026-09-09) — and getting this wrong nearly filed one of our own regressions as someone
   else's.** `git stash push -- src/` does NOT stash untracked files, so a NEW module added by
   the work under test stays on disk and is counted in the "clean main" measurement. That is how
   the design-drift ceiling read 580 on "untouched main" when the real number was a passing 572:
   the new file was in both arms. **Use `git stash push -u`**, and treat any baseline that is
   itself failing as a claim to verify rather than a relief.
18. **A COORDINATE COMPUTED FROM `getBoundingClientRect()` CAN LAND OUTSIDE THE TEST'S OWN
   VIEWPORT, AND `elementsFromPoint` GOES SILENT THERE RATHER THAN ERRORING (B1555152, ×2 live-verify
   investigation, 2026-09-11).** A re-test placing a box lower on the page than the fixture had
   before (to probe an interaction with an unrelated PR's new "below the sheet's body" click
   branch) computed a click position whose `y` was **past the 950px viewport height passed to
   `newContext`** — `.planyr-anchor`'s own out-of-flow, absolutely-positioned geometry made this
   easy to do by accident, since nothing about the number LOOKS wrong (it is a plausible, in-range
   CSS pixel value; only comparing it against the viewport's own height reveals the problem).
   `document.elementsFromPoint(x, y)` at such a point returned an **empty array** — no error, no
   warning — and a synthetic mouse click at the same coordinates hit nothing, which read, for one
   round, exactly like the reported defect (a click that fails to select a box). **The tell:**
   compare the computed `y` against the viewport height BEFORE clicking, or — more robustly —
   `scrollIntoView({ block: "center" })` the target first and re-measure its rect AFTER scrolling,
   never trust a rect computed before a scroll that was supposed to happen. Same species as
   DRIVER-SCROLL-IS-NOT-APP-SCROLL, the mirror direction: that rule is about a DRIVER scrolling
   when a human would not have; this is about a TEST failing to scroll when a human driving a real
   mouse would have had to. `ui-audit/verify-notes-box-selection.mjs`'s Attack 15 now asserts the
   pre-click hit-test stack explicitly (`elementsFromPoint(...).some(el => el.closest(".planyr-
   anchor"))`) before trusting a click's result, specifically so this can't happen silently again.
19. **DEPLOY-TIMING QUESTIONS ("was production actually current at the moment of a live-verify")
   HAVE A DIRECT ANSWER: THE GITHUB CHECKS API ON THE COMMIT SHA, NOT AN INFERENCE FROM A BROWSER
   CHUNK HASH (B1555152 ×2, 2026-09-11).** The owner's live-measurement rule (read the served chunk
   hash in the same call as the assertion) is the right tool for catching a STALE BROWSER TAB, but
   it cannot by itself answer "had Cloudflare even finished deploying this commit yet" — that
   answer lives server-side. `GET /repos/{owner}/{repo}/commits/{sha}/check-runs` returns each
   commit's "Cloudflare Pages" check with `status`/`conclusion`/`completed_at` directly, for ANY
   commit sha, not just the PR head — walk it forward through every merge between the commit in
   question and the report's timestamp to reconstruct exactly which commit was actually live at
   any given moment. This settled a live-verify dispute in minutes that would otherwise have relied
   on guessing from "roughly how long Cloudflare usually takes": the fix's own deploy completed 2
   minutes after merge, 52 minutes before the report that failed to reproduce it, definitively
   ruling out a slow/delayed build as the explanation.

20. **A BLIND "CLICK AWAY TO DESELECT" COORDINATE CAN HIT APP CHROME, NOT THE CANVAS (B1555152 ×3,
   2026-09-12).** `page.mouse.click(50, 50)` — meant to deselect a box before a reload — actually
   navigated the whole app to a DIFFERENT workspace (`#/site`) in a narrow 1191×465 test viewport,
   because at that size the row-1/row-2 navigation chrome occupies exactly that corner. Every
   subsequent `waitForSelector` then timed out looking for Notes elements that were no longer
   mounted at all, which reads like "the page broke" rather than "the test clicked the wrong
   thing." **Use `Escape` (or a coordinate proven, in the same run, to resolve to the canvas via
   `elementFromPoint`) to deselect/deactivate, never a fixed low-coordinate blind click** — the
   safe corner at one window size is a nav tab at another.
21. **A GENERIC `.container p` SELECTOR CAN MATCH THE WRONG PARAGRAPH THE MOMENT A GESTURE REORDERS
   THE DOM (B1555152 ×3, 2026-09-12).** A repro seeded ONE flow paragraph, then placed a box via the
   real double-click-and-type gesture — and `addNoteAnchorAt` deliberately inserts the new anchor
   BEFORE the document's last block (see `lib/notesAnchorNode.js`'s own header on why appending
   leaves an unremovable blank line). With only one flow paragraph, that paragraph WAS the last
   block, so the real placement moved it after the new box in DOM order — and
   `document.querySelector(".ProseMirror p")` then matched the BOX's own paragraph instead of the
   flow text, silently comparing the wrong node across the whole rest of the script. **A lookup
   for "the flow text" must match by its actual TEXT CONTENT, never by DOM position** — position is
   exactly what a real placement gesture is entitled to change.
22. **A HARNESS ASSERTION CAN GO STALE THE MOMENT A LATER, DELIBERATE FEATURE SHIPS AGAINST THE SAME
   ELEMENT (B1555152 ×3, 2026-09-12).** `verify-notes-box-selection.mjs`'s Attack 1 ("hovering a box
   reveals nothing at all") and part of Attack 8 ("the controls went away with the selection") both
   dated to before B1370544 made the drag grip a permanent HOVER affordance
   (`.planyr-anchor:hover .planyr-anchor-grip`, unconditional on `[data-selected]`, specifically so a
   box you just typed into stays movable without pressing Escape first). Both assertions failed
   **deterministically**, not intermittently, once anything hovered the box — Attack 1 because a
   fresh box was hovered directly, Attack 8 because the mouse pointer was still resting on the box
   from the two clicks that selected/entered it, left there when the test checked "no controls" after
   deselecting via Escape. Neither failure had anything to do with whatever change a session touching
   this file happened to be making. **The tell that separates "a real regression" from "the harness
   is stale": diff the actual product code the harness is exercising** (here, the box-selection
   binding for one and only `NoteEditor.jsx`'s CSS for the other) **against what the failing
   assertion is really about** — if the code path the fix touched has nothing to do with the failing
   assertion's own subject, look for a later shipped feature the assertion never got updated for
   before assuming a regression. Fixed by narrowing both assertions to the real, current, documented
   invariant (hover reveals the grip alone on an unselected box; a genuine deselect only needs the
   ring/handles gone once the pointer is moved away) rather than reasserting a stronger claim the
   product no longer makes.

23. **⛔ A FEATURE'S FOOTPRINT CAN BE ARITHMETICALLY IDENTICAL TO THE ONE YOU ARE RULING OUT — ASK
   THE GESTURE, NOT THE SCROLLER (NEW-1/NEW-2, the canvas pan, 2026-09-12).** A harness proving
   "a drag that starts on a page edge grip resizes the page and does NOT also pan it" judged that
   by the scroller's own delta, and reported a **false failure on two of the four grips against a
   build where nothing was wrong**. `beginWidthDrag`/`beginHeightDrag` move the scroller ON PURPOSE
   for the LEFT and TOP edges, so the page's edge stays under the pointer while it grows
   (VIEWPORT-STABLE). Measured: a 70px leftward drag on the left grip widens the sheet 579→649 and
   sets `scrollLeft` to exactly **70** — which is, to the pixel, what a pan of that same gesture
   would also have produced. The two are indistinguishable by their footprint and always will be,
   at every delta, because the compensation is defined as the size change and the size change is
   defined as the pointer's travel. **The discriminator has to be something only ONE of the two
   mechanisms writes**: the pan sets `data-panning="1"` on the mat for exactly as long as it runs,
   so the harness reads that attribute MID-DRAG instead of reasoning backwards from where the
   scroller ended up. **And that read needs its own known-good arm** — a check that passes by
   seeing `null` passes identically if it can never see the attribute at all, for every grip,
   forever; `verify-notes-pan.mjs` §5 therefore points the identical read at a gesture that MUST
   arm it before believing any of the four that must not.
24. **⛔ A GESTURE THAT RETURNS TO ITS OWN ORIGIN MEASURES ZERO TRAVEL, AND "WHAT DID THIS PRESS
   MEAN" READ AT MOUSE-UP WILL CALL THAT A CLICK (NEW-1, 2026-09-12).** `gestureOutcome` decides
   place-vs-drag from the straight-line distance between the press and the release — correct for a
   rubber band, which nobody returns to its own starting corner, and **wrong the moment the same
   press became a PAN**, because dragging a map out and back is an ordinary thing to do and would
   have left a stray note at the end of every round trip. The hole was always there for the
   marquee; it was simply never reachable. **A gesture that has committed to a meaning must LATCH
   it** (`latchGesture`) rather than be re-derived from its endpoints. Worth checking wherever a
   gesture's meaning is computed from a start/end pair instead of from the path.

25. **⛔ THE PAGE IS `note-sheet`; `note-body` IS THE TEXT INSIDE IT — AND MEASURING THE INNER ONE
   CERTIFIED A VISIBLY BROKEN PAGE AS 46/46 GREEN (B1605664 ×2 / B1609185, 2026-09-15).** The
   fix under test moved the ProseMirror body with a `transform`. A transform is a paint-time
   offset that changes no layout, so the TEXT slid down inside a page whose own top edge never
   moved and whose bottom edge crept up — exactly the defect being fixed. Measured on the
   deployed build at 1191×465, top grip dragged down 40 on a fresh page:
   `note-sheet` top **150 → 150**, bottom **578 → 538** ✗ · `note-body` top **267 → 307**, bottom
   **481 → 481** ✓. **Both numbers are honest; they describe different boxes**, and the harness
   only ever asked the inner one. **Any claim about what a PERSON sees an edge, a margin or a
   page boundary do is a claim about `note-sheet`** — the white surface with the border and the
   four edge grips on it. `note-body` answers questions about the text.
   - **THE CHEAP GUARD, and it is the one this file exists to hand you:** before trusting a rect,
     ask what is immediately ABOVE its top edge. Grey mat above and page below means you are on
     the page's real boundary; page above means you are on something inside it. That single probe
     separates the two elements and would have caught this on the first run. It is now a standing
     known-good arm in `ui-audit/verify-notes-page-height.mjs` §16, beside a liveness arm (a known
     scroll must move both of the page's edges by exactly that much).
   - **AND THE ASYMMETRY THAT LET IT THROUGH is DRIVER-SCROLL-IS-NOT-APP-SCROLL §6's, verbatim:**
     every discipline here proves a guard can go RED on known-broken code, and nothing forces a
     probe to go GREEN on known-good code. Both known-good arms above stayed green on the broken
     build — which is what localised the fault to the product rather than to the probe.
26. **⛔ "THE OPPOSITE EDGE HOLDS" IS A PROMISE ABOUT THE DRAG, SO READ IT WITH THE BUTTON STILL
   DOWN (B1609184, 2026-09-15).** A top-edge grow now ends with a deliberate scroll that brings
   the dragged edge back into reach, which moves both edges on screen AFTER the gesture is over.
   Two existing arms asserted the hold at RELEASE and went red on a correct build — they were
   asserting that the settle does not happen. Take the mid-gesture reading for the pointer
   promise and a separate post-release reading for whatever the settle is supposed to do. (This
   is not FOREGROUND-OR-VOID §6's trap in reverse: that one is about a reading between the two
   presses of a double-click changing the gesture's own timing budget. A drag has no such budget,
   so a mid-drag rect costs nothing.)
27. **⛔ AN AUTO-SCROLL TRIGGER MEASURED AGAINST THE SCROLLER'S OWN EDGE FIRES DURING ORDINARY,
   DELIBERATE DRAGS (B1344630, 2026-09-15).** A width/height grip drag needed to keep growing the
   page once the pointer reached the browser window's edge (a real mouse cannot move further, and
   nothing was scrolling the mat to let the drag continue). The first draft measured the pointer's
   distance to `scroller.getBoundingClientRect()` — but `note-mat` sits BELOW the toolbar and
   BESIDE the Pages rail, real window space the pointer can still move into, not a screen
   boundary. `verify-notes-page-height.mjs` §16 caught it immediately: a plain, controlled 60px
   test drag (nowhere near any real edge) reported "moved −82, asked −60," because the pointer had
   merely crossed into the toolbar's own row. **Measure against `window.innerWidth`/`innerHeight`
   for "can the real mouse move further," never a descendant element's own box** — the same
   distinction FOREGROUND-OR-VOID draws between a tab's OWN visibility and a container's.
28. **⛔ A SCROLL-FOLLOWS-THE-DRAG FIX FOR ONE EDGE CAN BREAK "THE OPPOSITE EDGE HOLDS" FOR THE
   OTHER (B1344630, 2026-09-15).** The TOP height grip's own growing case scrolls the mat by
   exactly the same amount `minHeight` grows, so the two cancel and the BOTTOM edge visibly holds
   — a real, working, load-bearing trick (see trap 26 and `heightTopPadRef`'s own header). Copying
   that trick onto the BOTTOM edge's auto-scroll (so its own grip stays under the pointer past the
   window's bottom) has nothing to cancel against: scrolling always shifts the WHOLE viewport, so
   the TOP edge — which this drag is supposed to hold fixed — visibly slid too (measured: −171px
   on a drag that asked for +60). **A scroll-compensation trick that cancels for one edge does not
   generalise to the opposite edge for free; each edge's own invariant has to be re-derived, not
   assumed.** Caught by the same §16 sweep, which is why it runs the full four-case matrix (both
   edges, both directions) rather than just the one case a change happens to touch.
29. **⛔ A HARNESS CONTEXT LEFT OPEN BETWEEN SECTIONS CAN STALE A LATER SECTION'S OWN MEASUREMENT
   (B1344626, 2026-09-15) — FOREGROUND-OR-VOID, ONE DOOR FURTHER.** A `ResizeObserver`-driven
   value (the mat's own proportional bottom padding) read correctly in isolation but read a
   STALE, pre-layout number (offsetHeight ~472 instead of the settled 774) inside the real
   harness — reproducibly, not flakily. Root cause: an earlier section's `page`/`browserContext`
   was never closed before the next section opened its own, so two Chromium tabs were open at
   once and the newer one was not reliably the foregrounded one. FOREGROUND-OR-VOID already covers
   a background tab's OWN clock and pixels; this is the same failure arriving through a THIRD
   channel, `ResizeObserver` delivery, which can stall for a tab that never became the active one
   in the first place. **Close every `page.context()` a section opens before the next section
   opens its own** — the existing per-section `await page.context().close()` calls in this repo's
   own harnesses exist for exactly this, and a section that skips it is not merely untidy.

30. **⛔ TWO FAKE "COMPUTERS" IN A TEST SHARE ONE INDEXEDDB UNLESS EACH GETS ITS OWN `IDBFactory`
   (NEW-1, 2026-09-16).** `test/notesTwoClientConflict.test.js` and `test/notesConflictDefer.test.js`
   simulate two separate devices via `fake-indexeddb/auto` + a hand-rolled per-window
   `localStorage` — but `fake-indexeddb/auto` installs ONE global `indexedDB`, so before this was
   fixed every "computer" the harness opened silently shared one fake database. Invisible for two
   years of image/version-history tests because nothing in them compared what one "device" wrote
   against what another read back — until the per-paragraph merge's base snapshot (stored in
   IndexedDB, keyed only by account scope + page id, exactly as it would be on one real device)
   started reading a SIBLING "computer"'s own record as if it were this device's own history,
   manufacturing false conflict resolutions in the test alone. Two real computers never share an
   IndexedDB at all, so this was purely a fixture gap, not a product one — but it is exactly the
   shape trap 2's fixture-simplification rule warns about, one tier down: `openWindow` now hands
   each window its OWN `new IDBFactory()` and `focus(w)` swaps `globalThis.indexedDB` along with
   `globalThis.localStorage`; `reopenWindow` (a same-device RELOAD, not a new computer) reuses the
   SAME factory as the window it is reloading, matching how a real browser reload keeps IndexedDB
   intact. **Any future two-"device" test in this module must open its own `IDBFactory` per
   device** — a shared one will silently leak whichever feature next reads/writes IndexedDB
   per-account rather than per-tab.

31. **⛔ SKETCH MODE'S DOUBLE-CLICK RACE, AND THE THREE UNRELATED TRAPS IT TOOK TO CLOSE IT
   (B1683296/B1683297/B1683298, 2026-09-16, owner report: "double-click no longer works to
   create new text boxes").** His own diagnostic used SYNTHETIC (untrusted) events, and its own
   header said so plainly: "the possibility that a TRUSTED double-click fails for some
   additional reason is NOT ruled out." It didn't rule it out because the real defect needed a
   REAL, trusted double-click to reproduce at all — every synthetic-dispatch variant tried in
   this session (a bare `dblclick`, a full down/up/down/up/dblclick sequence) came back green.
   **The real mechanism, found only with `page.mouse.dblclick`/two real separate presses:** a box
   still uncommitted and never typed into is DISCARDED unconditionally on the very first press
   (via the label field losing focus), while its REPLACEMENT was gated entirely on the browser
   recognising a native `dblclick` — two real presses 900ms apart never raise one, so the box
   vanished and nothing replaced it. Fixed (B1683296) by RELOCATING the untouched pending box to
   the next press's point instead of discarding it, so a single press is already enough — no
   dependence on native double-click timing survives at all.
   **Verifying that fix (building NEW-2's own box-count test matrix) walked straight into two
   MORE, completely unrelated, pre-existing defects — both invisible until a box could actually
   be relocated under the cursor:**
   - **A press that does not turn into a drag still called the FULL redraw, `paint()`, instead of
     `paintSelection()` (B1683297).** `select()`'s own header already names the trap
     ("a redraw would destroy the element that has DOM focus") — `onPointerUp`'s no-op fallback
     simply never followed it. Destroying and rebuilding the box's `<g>` on every plain click lost
     whatever had focus AND broke the browser's own double-click recognition (element identity,
     not just screen position, factors into whether two clicks form a native `dblclick`) —
     double-clicking an already-selected, already-committed box to reopen it silently stopped
     working, with no error and no console signal.
   - **POINTER CAPTURE RETARGETS `click`/`dblclick`, NOT JUST `pointerup` (B1683297, same fix).**
     `onPointerDown` arms a potential drag with `drawSlot.setPointerCapture(e.pointerId)` for any
     press ON a node; once captured, the derived compatibility `click`/`dblclick` events'
     `e.target` becomes the CAPTURING element (`drawSlot`, a plain DIV) rather than whatever the
     cursor is actually over. `onDoubleClick` read `e.target` directly, so `target.closest(
     "[data-sketch-node]")` always missed and a "reopen this box" gesture minted a BRAND NEW box
     on top of it instead. Fixed by resolving through `document.elementFromPoint(e.clientX,
     e.clientY)` first, falling back to `e.target` only if that fails — the standard remedy for
     this exact pointer-capture gotcha, and now the only correct way to read a double-click's
     target anywhere pointer capture might be live.
   - **A stray "click and type" placement caret (`NoteEditor.jsx`'s `pendingPlace`) survives a
     press on ANY embedded, node-view-owned input (B1683298).** `focusFromMat`'s own comment
     already states the intended rule — "ANY press forgets an armed caret" — but the
     `el.closest("input, textarea, select, button, a")` early return ran BEFORE the
     `cancelPendingPlace()` call, not after, so a press landing on a sketch box's own label field
     (a real `<input>`, embedded in the document like any node view's overlay) skipped
     cancellation entirely. A caret armed by an earlier, unrelated click on blank note-body space
     then survived indefinitely and hijacked the FIRST character typed into the sketch box — via
     the window-capture keydown handler's own "a real field outranks an armed caret" check, which
     could not save it either, because a node view's overlay input is structurally `dom.contains
     (active)` and therefore counts as "inside the editor," not as the outranking field it was
     written for. Fixed by moving `cancelPendingPlace()` before the input exclusion — it is
     side-effect-free beyond clearing that one piece of state, so nothing about how the input
     itself handles the press changes.
   **The shape worth generalising: NONE of the three defects above is specific to sketch mode.**
   The first two apply to any node view that lets you re-select/re-open something by clicking it;
   the third applies to ANY node view with its own embedded `<input>`/`<textarea>` (a picture
   caption, a table cell editor, a future callout field). If a similar "press on my own control
   did nothing" report ever surfaces on a DIFFERENT node view, check these three mechanisms before
   assuming a new bug: (a) does a no-op press call `paint()`/an equivalent full redraw instead of
   a selection-only repaint; (b) does anything read `e.target` on `click`/`dblclick` without first
   checking whether a `pointerdown` on that same gesture called `setPointerCapture`; (c) does
   `focusFromMat` (or anything else gating on "did the user click a real control") get bypassed by
   an input embedded IN the document rather than genuinely external to it.

32. **⛔ ENTRY 31's OWN FIX DID NOT CLOSE THE WHOLE CLASS, AND CALIBRATE `page.mouse` AGAINST A KNOWN
   CASE BEFORE TRUSTING IT ON AN UNKNOWN ONE (B1683296 ×2, 2026-09-17).** Entry 31's relocate fix
   only reaches a press on bare canvas WHILE A BOX IS ALREADY OPEN — the far more common case, a
   plain double-click when NOTHING is pending at all (the very first box on a page, or any box
   after the last one was closed), had NO fallback whatsoever and depended 100% on the browser's
   own `dblclick` recognition, with zero instrumentation proving that recognition actually happens.
   Michael's own follow-up report was exactly this case, on a real page, and it was genuinely still
   broken. **The fix is the identical shape as entry 31's, one gesture earlier:** reconstruct the
   pair from two `pointerdown`s (`isSketchDoubleTap`, mirroring `site-planner/lib/doubleTap.js`'s
   own `DBLTAP_MS`/`DBLTAP_PX` rather than importing them across workspaces), so creating the FIRST
   box no longer needs native recognition either.
   **⛔ AND THE CALIBRATION THAT MADE THE TEST HONEST, WHICH IS WORTH KEEPING FOR ANY FUTURE
   DOUBLE-CLICK TEST IN THIS REPO:** `page.mouse.down()` + `.up()`, called TWICE, **never** forms a
   native `dblclick` in this Chromium/CDP sandbox — measured at every gap from 150ms to 700ms, all
   ten came back `false`. Only the single combined `page.mouse.dblclick()` call reliably produces
   one. This matters two ways: **(a)** a harness proving "no native dblclick formed, and the fix
   still works" does NOT need an artificially slow (900ms-class) gap to make that true here — any
   ordinary two-press sequence already proves it, and a shorter gap is a STRONGER, more general
   test (it stays within the fix's own intended time budget rather than testing an edge case
   outside it); **(b)** conversely, a harness that wants to confirm the PRE-EXISTING fast native
   path still works must use `page.mouse.dblclick()` specifically — two separate down/up calls,
   however fast, will never exercise that path in this sandbox at all. Same species as
   DRIVER-SCROLL-IS-NOT-APP-SCROLL §6: point the instrument at a case whose answer is already
   knowable (does a two-press sequence raise `dblclick` here, yes or no) before trusting it on the
   unknown one.

33. **⛔ A “SETTLED FACT” IN A REVIEW DOCUMENT IS AN UNTESTED CLAIM WEARING A CONCLUSION'S CLOTHES, AND THIS ONE COST FOUR ROUNDS (B1393 ×4, 2026-09-18).** `REVIEW-2026-09-08`'s finding F5 stated: *“Double-clicking inside the page body selects a word, which is correct text behaviour. So the create gesture only fires in the grey mat outside the sheet.”* It reads as a boundary condition somebody established. **Nobody ever drove it.** Every subsequent round consequently fixed, reviewed and verified the grey-MAT path — correctly, and on a surface the owner was not pressing on — while he went on reporting *“it doesn't work, at all.”* The tell, and it generalises: **the report and the premise disagreed, and the premise won four times without once being measured.** When a symptom survives rounds of real fixes, stop re-reading the code and go and re-derive the SCOPE sentence everybody is standing on — the one phrased as background rather than as a finding, because that is the one with no test under it. (Sibling of WRONG-CASE, one level up: that rule is about testing the wrong CASE, this is about inheriting the wrong PREMISE about where the feature even lives.)
34. **⛔ AND THE TRAP-18 INSTANCE THAT CAUGHT ITSELF THE SAME DAY, worth one line because it shows the guard working.** A brand-new harness's grey-mat known-good arm went red against code nothing had touched. Its press point was `sheetRight + 60` — **x=1554 in a 1500px viewport**, where `elementsFromPoint` returns an EMPTY ARRAY rather than erroring, so the click landed on nothing. On a WIDE page the sheet is pinned near the right edge (measured: mat 268→1500, sheet 594→1494), so “just outside the sheet on the right” is off the edge of the world while the real mat sits on the LEFT. **Because that arm's answer was known independently, the run declared itself VOID instead of printing a score** — which is the entire argument for known-good arms in one incident.

35. **⛔ A FIXTURE CAN STRADDLE ONLY ONE SIDE OF A BOUNDARY AND LOOK EXHAUSTIVE WHILE DOING IT (B1801040, 2026-09-19).** `verify-notes-page-width.mjs`'s Case 20 was written for the previous round of the SAME gesture and is a good instrument — every step of a slow real-mouse drag, deliberately uneven, both grips, both directions, three starting widths, every frame sampled. It was green while the owner was still watching his page slide, because its three starting widths — unpinned 580, Wide 900, a custom 717 — **all sit at or above the natural card width, and that is exactly the band in which the defect cannot occur.** Three arms, one side of the line. The give-away is that every arm reported a clean **0.00**, not a small noisy number: a real instrument pointed at a real surface usually reports *something*, and a column of identical zeros is worth one minute of "could this fixture reach the case at all?" before it is worth trusting. **The general form: when a defect's magnitude is a function of some quantity (here `paneWidth − 2 × gutter − pageWidth`, the mat's own slack), the fixture has to cross that quantity's zero, not merely vary on one side of it.** It is DRIVER-SCROLL-IS-NOT-APP-SCROLL §6 one level up — that clause is about a probe whose QUESTION was never about the thing; this is a probe whose question was right and whose SAMPLE never contained an instance. Cheapest counter, and it is what found this: map the defect against the variable (here, six stored widths from 440 to 900) before choosing which two or three to keep. The map also hands you the mechanism for free — the drift came out as exactly the slack, at every width, which named the cause before a line of the fix was written.

36. **⛔ A GRIP THAT SPANS THE WHOLE SHEET HAS ITS CENTRE BELOW THE GLASS, AND THE VISIBLE BOX IS
   THE **MAT'S**, NOT THE WINDOW'S (NEW-1/NEW-2, 2026-09-21).** The width grips run the full height
   of the page, so on any note with real content in it `boundingBox()` returns a rect 2,000px tall
   whose midpoint is off the bottom of a 950px window. Pressing there does nothing, in silence, and
   **40 of 46 matrix rows came back red on the first run with "the drag committed nothing" — every
   one of them the instrument.** Fixing the vertical half then exposed the horizontal one: a grip
   panned to x=217 reads as comfortably on screen, and `elementsFromPoint` there answers
   `#notes-tree`, because the Pages rail owns the left ~268px of the window and the grip had been
   panned clean underneath it. **Intersect the target with the MAT on both axes and REFUSE if
   nothing is left** (`gripBox` in `verify-notes-width-matrix.mjs` throws, naming how far outside
   it sat). Trap 18 and DRIVER-SCROLL-IS-NOT-APP-SCROLL §4, arriving through a grip instead of a
   row.

37. **⛔ THE HARNESS'S OWN SETUP PAN, INSIDE THE RECORDING WINDOW, IS REPORTED AS THE APP MOVING
   THE CONTENT (NEW-2, 2026-09-21).** Making room for a drag (panning so the grip is not against
   the glass) is legitimate setup — but it moves everything painted on the canvas, which is
   precisely what the recorder exists to notice. Called from inside the drag helper it produced
   **240px of "content movement" at one window and 111.63px at another**, on three rows, about a
   build that was correct. Setup happens BEFORE the recorder starts, always. The species is
   DRIVER-SCROLL-IS-NOT-APP-SCROLL in its purest form, and it is worth noting that the harness
   built to find "the page moved when it should not" failed by moving the page itself.

38. **⛔ A PER-FRAME POINTER READING PAIRED WITH A PER-FRAME GEOMETRY READING STRADDLES A MOVE —
   AND BUDGETING FOR THAT COSTS EXACTLY THE SENSITIVITY YOU NEED (NEW-2, 2026-09-21).** To ask
   "did the page outrun the finger" you need both quantities on one clock. Recording the pointer in
   the `pointermove` handler and the width on the next rAF does not give you that, and the obvious
   patch — allow one frame's worth of pointer travel — **is not a loosened threshold but it is a
   loss of sensitivity, and it is largest exactly where the gesture is fastest.** Measured: on a
   three-step flick one frame carries ~100px of pointer, which hid a 140px jump completely, so
   `origin/main`'s grab-jump was CAUGHT in the slow rows (~5px frames) and MISSED in the flick rows.
   One defect, one instrument, invisible purely because of how fast the hand moved. **Read both in
   the same handler, and offset the pointer series by ONE MOVE** — React's state update lands a
   move later, so same-index pairs report a harmless lag that flips into a phantom LEAD the instant
   the gesture reverses (a clean 4.67px "lead", exactly one step, on a build that tracked perfectly).

39. **⛔ THREE FIXTURE TRAPS THAT EACH PRODUCED A FALSE FAILURE IN ONE SESSION, grouped because
   they share a cause: the app's own SAVE DEBOUNCE outliving the assertion (NEW-2, 2026-09-21).**
   (a) Reading `localStorage` immediately after a drag reports the PREVIOUS width — "the drag
   committed nothing", for every row, on a build where the drag was fine. Poll until it changes.
   (b) Resetting a fixture between arms by rewriting `localStorage` and reloading does not hold:
   the debounce writes the previous arm's box back, so a second arm found TWO matching boxes and
   `find` picked the older one — *"off by 185px"* about a correct placement. **A fresh page per
   arm**, and assert on a page that has held exactly one box in its life. (c) A wheel zoom is
   PROPORTIONAL, so "N notches" is not a level: 6, 12 and 24 notches of 240 all landed on the 10%
   floor, and three arms printed "(10%)" while claiming 50%, 25% and 10%. Use the keyboard ladder
   when you need an exact level.

40. **⛔ AND THE ONE THAT IS NOT A TRAP BUT A LIMIT, NAMED SO IT IS NOT SCORED EITHER WAY: A TARGET
   CAN BE TOO SMALL TO AIM AT (NEW-1, 2026-09-21).** The blank paper a double-click needs is the
   sheet's own side padding, ~34 workspace px — which is 34 screen px at 100% and **3.4px at 10%
   zoom**. An arm that clicks there and finds no box is reporting the ZOOM, not the placement, and
   an arm that quietly skips it is hiding a gap. `verify-notes-canvas` computes the strip's width
   at each level and either asserts it or prints it under **"NOT EXERCISED HERE"** with the
   measured number. The same discipline covers a real touchscreen pinch, which a driver cannot
   raise honestly at all.

41. **⛔ `note-sheet`'S OWN TOP EDGE IS NOT THE PLACEMENT SURFACE'S TOP EDGE — THE TITLE BAND SITS
   BETWEEN THEM, AND IT MEASURES ~117px ON A FRESH PAGE (NEW-1, 2026-09-22).** A harness that
   computes "20px from the sheet's own top edge" as a double-click target is aiming at the TITLE
   INPUT's own area, not blank paper. It is not caught by `focusFromMat`'s
   `el.closest("input, ...")` guard either — the point can land in the sheet's own padding
   around the title, which is not the input element itself, so the press still reaches the
   blank-space placement path and creates a box, just at a wildly different position than
   clicked (measured: 102px off, on a fresh page). **Measure from `[data-testid="note-body"]`'s
   own rect for any "blank paper" point, never from `[data-testid="note-sheet"]`'s** — the sheet
   is the whole card (title band included); the body is the actual placement surface
   `placeBlockAt`'s coordinate math is relative to. `ui-audit/verify-notes-in-sheet-placement.mjs`
   uses `bodyRect()` for exactly this reason.
42. **⛔ A BOX'S TOP-LEFT CORNER IS STILL THE DRAG GRIP (trap 9, RE-CONFIRMED HERE) — AND A
   SINGLE `page.mouse.dblclick()` ON AN UNSELECTED BOX CAN RACE REACT'S OWN STATE FLUSH BETWEEN
   ITS TWO PRESSES (NEW-1, 2026-09-22).** The two-stage select/enter model has no timing
   requirement at all — ANY second press on an already-selected box enters it — but
   `page.mouse.dblclick()`'s two presses can land close enough together that press 2's handler
   reads `selRef.current` before press 1's `setSelection` has committed, which a real human's
   naturally-spaced double-click never races. Drive "select, then enter an UNSELECTED box" as
   two ordinary `page.mouse.click()` calls with a real gap (~100ms) between them, not one
   `dblclick()` — it exercises the identical app behaviour with no timing assumption baked into
   the assertion.

See also `ui-audit/TRAPS.md`, and the named rules **FOREGROUND-OR-VOID** (a background tab cannot
be measured — not its clock, not its pixels) and **COUNT-EVERY-KIND**.

---

## 2 · The fixture that finds real bugs

Michael's Richfield **"Utilities"** outline. **Simplifying it hides the defects** — that is not a
caution, it is measured: all 17 existing Tab/Shift+Tab cases passed before AND after the B519680
fix, because every one used a FLAT list where an item has no indentable ancestor.

```
MUD 377                                              (1)
  Active                                             (2)
  Engineer - Pape Dawson                             (2)
    Dustin O'Neal                                    (3)  ← SMALLER FONT than its siblings
      P: 713-428-2400                                (4)
      doneal@pape-dawson.com                         (4)  ← autolinked
  MUD ATTORNEY: BRIAN YATES                          (2)
Water Authority: Northwest Regional Water Authority  (1)
Sanitary:                                            (1)
  Discharge Permit may be 18 months                  (2)
```

The Shift+Tab bug only appears with an **uneven sibling subtree** like this: the branch that moved
sat BESIDE the pressed line, not under it. Live copy: `ui-audit/diagnose-notes-outdent.mjs`.

---

## 3 · Data facts

**Font and size, as stored (2026-09-08).** A `textStyle` mark's `fontFamily` holds the source's
RAW stack string — Word writes `"Calibri",sans-serif`, the palette writes `Calibri, Candara,
sans-serif`, and **those are the same typeface**; compare with `notesFontFamily.js`'s
`familyKey` (first family, unquoted, lower-cased), never with `===`. A `fontSize` is normalised
to **px at the paste boundary** (`fontSizePx` — 11pt is stored as `14.67px`), because
`parseFloat("11pt")` is 11 and made an 11pt run and an 11px run read as the same "11". **Notes
already saved keep whatever they hold** — there is no migration and no repair pass; the owner
was explicit that rewriting existing formatting is a separate decision he has not made, so the
DISPLAY path resolves units too rather than the stored data being touched.

**Local keys** — `planyr:notes:tree:v1:<uid>` · `planyr:notes:page:v1:<uid>:<pageId>` ·
`planyr:notes:sync:v1:<uid>` (`<uid>` is the user id, or `local` when signed out).
**Cloud** — `notes_trees` (ONE row, `data` jsonb) · `notes_pages` · `notes_images`.

The tree carries **`pages`**, **`trash`**, and **`tombs`** (deletion receipts). A purged id in
`tombs` is correct; **a purged id in `pages` is the resurrection bug** (B357011 / B364016).

**Standing health check — `live_but_purged` must always be 0:**

```sql
with live as (
  select p->>'id' id from public.notes_trees, jsonb_array_elements(data->'pages') p
)
select (select rev from public.notes_trees)                     as rev,
       (select count(*) from live)                              as live_count,
       (select count(*) from live
          join public.notes_pages np on np.id = live.id
         where np.purged_at is not null)                        as live_but_purged,
       (select jsonb_array_length(data->'trash') from public.notes_trees) as trash;
```

**Scratch-page hygiene on his account:** create one, use it, **bin AND purge it**, restore his
counts, **never purge one of his rows**, and match a bin row **by its preview text rather than its
position**.

---

## 4 · The verification bar that actually held

- **Measure, do not eyeball** — numbers in the reply, not adjectives.
- Ask **"could this check pass while the feature is still broken?"** The resize bug is the
  canonical shape: it rendered correctly and stored nothing.
- **An audit that finds nothing is a FAILED audit**, not a clean bill of health.
- **Adversarial passes earn their keep.** Attacking our own selection fix found two defects a
  confirming test sailed past: the ring lost on re-render, and Escape handled twice so one press
  did both stages.
- **Prove a new guard goes RED before trusting it green** — preferably by pointing it at untouched
  code, which is stronger than planting a synthetic defect.

---

## 5 · The recurring bug families — suspect these first

-1. **⛔ A FIX THAT MOVES A DEFECT RATHER THAN REMOVING IT — AND THE TELL IS THAT THE SAME LINE HAS
   NOW CARRIED THREE RULES (added 2026-09-08).** The sheet's horizontal alignment went: centre until
   anything grows, then flush left (killed a 48px jump, made the left gutter ZERO so half the
   feature became unreachable) → centre while it fits (restored the gutter, brought the jump back,
   measured at 48px by the owner's own acceptance harness) → pin the left edge where centring would
   put an ungrown page and grow only rightward (both, because the left edge stopped being a function
   of the width). **When a fix's justification is the defect the previous fix caused, you are
   trading, not fixing.** Look for the formulation where the two properties stop competing — here,
   making the quantity that was moving independent of the quantity that was changing.
   ⛔ **AND IT RECURRED THROUGH A NEW DOOR (NEW-1, the page-width-by-hand feature, 2026-09-11) —
   same defect, same shared variable, a completely different feature this time.** Feeding a width
   PIN into `naturalSheetWidth` — the exact baseline `matPadX` (the page's left gutter) is centred
   against — reproduced the identical "centring splits the new width across both edges" signature
   from scratch: committing a right-edge drag from 580→780 jumped the LEFT edge 100px left in the
   same instant, half the width gained. **The lesson generalises past alignment specifically: ANY
   variable that is both "the baseline a layout anchor is computed from" and "a size a feature
   wants to change" will move the anchor the moment that feature ships**, whether the change comes
   from centring logic, a pin, or anything else that lands on the same shared number. The fix was
   the same shape as round 2b's: give the new feature its OWN baseline (`pinnedPageWidth`, feeding
   only `sheetGrowWidth`, the already-proven ADDITIVE growth path) rather than editing the one
   `matPadX` already depends on. Before writing to a "natural width"/"baseline" constant this
   module already treats as authoritative, grep every reader of it — `matPadX` is the one that
   bites, and it is not the one function whose name mentions width.

0. **⛔ A RULE SHIPPED ON SOME OF ITS EDGES AND CLAMPED ON THE REST (added 2026-09-08,
   NOTES-FREE-PLACEMENT).** The page-grows-to-fit feature grew RIGHT and DOWN and floored LEFT and
   UP, and shipped, and read as working — because everything anybody tried first happened to go
   right or down. The owner found it in one gesture. **The tell is an asymmetric pair of helpers:**
   `anchorExtentX`/`anchorExtent` existed and `anchorExtentLeft`/`anchorExtentTop` did not, so the
   only available answer on two of four edges was a clamp. Whenever you add a rule with a
   direction in it, write down all of its directions and check each one; a single-direction check
   is exactly what shipped last time. Same species as **B539648** (the page grew down but crushed
   content sideways) and **B421490** (the vertical half existed, the horizontal half did not) —
   three instances now, all in this one feature.

0b. **⛔ A TOOLBAR CONTROL THAT ANSWERS "WHAT IS AT ONE POSITION" WHEN IT WAS ASKED "WHAT IS IN
   THIS SELECTION" (NOTES-TOOLBAR-STATE, 2026-09-08).** `editor.getAttributes()` /
   `editor.isActive()` answer about the caret. For a RANGE they either read `$from` (so the
   first run's value is presented as the whole selection's) or, for marks, return true only if
   the mark covers the WHOLE range (so half-bold text reports a confident **false**,
   indistinguishable from no bold at all). Both are guesses, and both look completely correct in
   the code. **Every readout goes through `lib/notesMixedSelection.js`** — `selectionFontSizes`,
   `selectionFontFamilies`, `selectionMarkPresence`, `selectionMarkAttrs`, `selectionAlignments`,
   `selectionListKinds`, `formatDisplayValue`, `togglePressed`. **A bespoke mixed-check written
   for one control is the defect, not the fix:** Font size was made correct in isolation
   (B1139216) and eleven other controls stayed wrong for months, because nothing about a private
   check in one control says anything about the next one. Guard: `ui-audit/verify-notes-font-
   control.mjs` puts EVERY control through uniform · caret · mixed and prints the table.
   ⛔ **AND `aria-pressed={active ? "true" : undefined}` IS A TWO-STATE ANSWER TO A THREE-STATE
   QUESTION** — it gave Bold/Italic/Underline/Strikethrough no exposed state at all when off.
   Measured on the pre-fix build: those four DO report `pressed=true` on genuinely bold text
   (the positive case works), and report NOTHING when off or mixed. Use `togglePressed`'s
   `"true"/"false"/"mixed"` for both the accessible state and the paint, from one value.

0c. **⛔ A CONTROL THAT REPORTS WHETHER A MARK IS STORED, WHEN THE USER NEEDS THE RESOLVED VALUE
   (NEW-7/NEW-8/NEW-9, 2026-09-09).** Sibling of 0b, and the one it does not cover: 0b is about
   a RANGE disagreeing with itself; this is about a SINGLE run being reported by its storage
   rather than by what it looks like. Three instances, all measured on his own note: a run with
   no font mark read **"Default"**, which names no typeface (*"There's always a name to it"*); a
   `color: inherit` mark painted NO swatch while an identical-looking run with no mark painted
   the default one, and the pair reported as MIXED; and the size and spacing boxes answered
   **"Size"** and **"Spacing"** — category labels for text that is plainly being rendered at some
   real size and spacing. **`inherit` is not a colour. An absent mark is still a value.** Route
   every readout through `lib/notesResolvedValue.js`, and resolve what CSS owns (the default
   typeface, size and ink) off the LIVE DOM in a layout effect — never a hard-coded copy of a
   token, which is wrong in the other theme immediately. Guard:
   `ui-audit/verify-notes-font-control.mjs` §3b, red-proven on untouched main.
   ⛔ **AND THE HIGHLIGHT BUTTON'S SWATCH IS A VACUITY TRAP**: with no highlight it paints the
   colour it WOULD apply, so a "real yellow highlight" arm reports yellow whether the feature
   works or not. Use a colour the button does not default to.

1. **A GLOBAL KEY BINDING LEAKING INTO TEXT.** Escape handled twice (B434418); the arrow-nudge
   swallowed arrows while typing (B519681). The guard is a **PROPERTY** — every globally-bound key
   is inert when the caret is in editable text — asserted by a source sweep in
   `test/notesKeyScope.test.js`, **not one test per key**. Verify it still exists as a property.
   `Escape` is a named exemption (`UNGATED_KEYS`), and that is a rule rather than a hole.
2. **A CLAMP WITH NO FLOOR.** *"Do not slide the box, narrow it to fit"* crushed boxes to a sliver
   at the right edge (B539648) **and** — the same clamp, in the one path that item did not touch —
   narrowed a box while it was being dragged (B583008). **The rule: a minimum size, and past it the
   canvas EXTENDS AND SCROLLS**, exactly as it already does downward. When you find one instance,
   grep for every other caller of the same clamp before closing it.
3. **HOUSEKEEPING UNDOING THE EDIT.** `deriveBlockSizes` runs on every transaction; it saw a
   brand-new empty block, decided its runs disagreed, and nulled the size — which is why Enter
   stopped carrying formatting (B583010). **Anything that "corrects" the document on every
   transaction is a suspect**, and an `appendTransaction` is the first place to look.
4. **A SIBLING'S HEIGHT CHANGE SHIFTS CONTENT UNDER AN IN-PROGRESS GESTURE (B649376, reopened
   2026-08-28).** The Table toolbar group only renders `{inTable && (...)}`, so the instant the
   caret enters a table the toolbar wraps to an extra row (measured: **38.9px → 74.8px**, a
   35.9px delta on the real Silvestri note) and the sheet below it — the table included — is
   pushed down by that exact delta, mid-drag, under a pointer that has not moved. Measured as
   his *"it just jumps and flashes"*: the native selection never extended across cells at all,
   it stayed collapsed and hopped between wrong text nodes as the content slid out from under
   the drag. **Any conditionally-rendered CHROME sitting above a draggable/scrollable surface
   is a suspect** — grep for `{inX && (` near a toolbar/rail before assuming a drag bug is in
   the drag code itself. Fixed with a `ResizeObserver` folding the measured delta into the
   surface's own `transform` (VIEWPORT-STABLE) — **not `scrollTop`**, which silently no-ops on
   a note too short to have scroll slack (exactly this fixture).
   ⛔ **AND THAT FIX SHIPPED, PASSED ITS OWN GUARD, AND STILL REACHED PRODUCTION BROKEN — because
   a `ResizeObserver` alone is a PASSIVE, AFTER-THE-FACT mechanism, not the synchronous
   `useLayoutEffect` VIEWPORT-STABLE actually calls for.** A `requestAnimationFrame` sampler
   (the shipped guard only ever sampled every ~45ms, 2–3 frames apart, and never caught this)
   found a real one-frame gap on the very build that had "fixed" it: the frame where the toolbar
   first measures its taller height still has the mat's `transform` empty and the content already
   down by the full delta, and only the NEXT frame corrects it. One visible frame is exactly
   *"it just jumps and flashes"*; under load, mid-drag, or however the owner's real machine
   scheduled the ResizeObserver notification, that gap can stretch far past one frame. **The
   fix that held:** compute `inTable` inline (the same boolean `NoteToolbar` uses) and measure +
   compensate in a `useLayoutEffect` keyed on it — a layout effect runs after the DOM mutation
   commits but before paint, in the SAME render as the toolbar's extra row, so there is no frame
   in which one is true and the other is not. The `ResizeObserver` stays only as a fallback for
   OTHER causes of the same resize (a window resize changing button wrap, a webfont loading),
   sharing one height baseline so the two paths never double-count.
   ⛔ **AND SCROLL SLACK CHANGES NOTHING ABOUT WHETHER THIS WORKS, WHICH IS WORTH PROVING
   EXPLICITLY RATHER THAN ASSUMING** (an owner correction after the frame-race fix landed,
   pointing out his own report had the scroller pinned at maximum scroll — no slack left, the
   exact condition B649376's ORIGINAL `scrollTop` attempt failed under). Measured: pin
   `note-mat.scrollTop = note-mat.scrollHeight` before the gesture (on this fixture that pins it
   at 0, since the note is too short to scroll at all) and run the SAME frame sampler both
   entering (toolbar grows) and — the mirror case, which moves content the OTHER way —
   leaving (toolbar shrinks). Both hold at zero race frames with the `transform`-based fix; both
   show exactly 1/60 race frames on the pre-fix `ResizeObserver`-only build. The `transform`
   approach was never scroll-dependent (unlike the very first `scrollTop` attempt this item
   already rejected), but a claim like that is only worth as much as the harness that checks it —
   see `verify-notes-table-select.mjs` sections 5–6.
   ⛔ **AND A "COMPENSATED" CHECK THAT PARSES THE `transform` STRING IS ITS OWN TRAP.** The first
   version of the max-scroll check called a frame "uncompensated" whenever `mat.style.transform`
   read `""` — correct for the GROWING direction (an empty transform there really is no
   compensation) but WRONG for the SHRINKING direction, whose correct SETTLED state is net-zero,
   i.e. an EMPTY transform. That version reported the shrink case red on the FIXED build (a false
   failure). The fix: compare the visible position (`tableTop`/a paragraph's `getBoundingClientRect
   ().top`) against its OWN settled value at the end of the sampling window, never against what a
   specific CSS property happens to read — VIEWPORT-STABLE is about the picture staying put, not
   about which mechanism does it.
   ⛔ **REOPENED A THIRD TIME (B831600 ×3, 2026-08-28/29) — STILL OPEN. Read this before touching
   this code again; the mechanism is measured on production, not reproduced anywhere this repo can
   check it, and that gap is itself the finding.**
   **THE MECHANISM, AS MEASURED ON PRODUCTION** (owner's own instrumented `pointerdown`/
   `pointermove`/`pointerup`/`click` listeners plus a whole-ancestor-chain transform walk, same
   build, same session, minutes apart): **the GROW is uncompensated and the SHRINK is compensated
   — the opposite of what a sandbox rebuild of the same commit shows.** Fresh page load, table
   never touched: `transform` chain reads `none` throughout. Click into a cell: toolbar 38.924 →
   74.775px, content moves the full 35.851px down, chain STILL `none` — the compensation never
   fires on entry at all. Click back out to a plain paragraph: toolbar returns to 38.924px, and
   `translateY(35.8503px)` NOW appears on the mat, holding the content at its shifted position —
   the shrink is fully (over-)compensated, and the note settles PERMANENTLY about one toolbar row
   lower than where it opened. Repeated table entries after the first behave correctly (this
   matches round 2's own fix working "from the second interaction onward"), so the defect is
   specifically about the very first grow of a freshly mounted note.
   **WHAT WAS RULED OUT, each with the evidence, so a future session does not re-walk the same
   ground:**
   - **Nesting depth** — the owner's own original theory, explicitly retracted after further
     production instrumentation on a fresh top-level scratch table showed the SAME failure
     (uncompensated grow) once the table had never been touched in that page session. His words:
     *"I WAS WRONG ABOUT THE NESTING... It is not [the variable]."* A prior draft of this file said
     otherwise; that framing is superseded by this entry.
   - **His exact document structure** — rebuilt field-by-field from the real stored ProseMirror
     JSON he pulled off his own page (node types, `attrs`, the `bulletList > listItem > bulletList
     > listItem > table` chain, no `attrs` object on the table, 4 rows × 1 col) and driven with a
     real drag: zero drift in this sandbox, every time.
   - **Block `fontSize` attrs + `textStyle` marks** — his cells carry a block-level `fontSize` (10
     for the header row, 9 for the rest) AND a per-run `textStyle` mark storing the size as a
     STRING WITH A UNIT (`'10pt'`/`'9pt'`) — Outlook's own paste unit. Theorized to interact with
     `deriveBlockSizes`'s `appendTransaction` (family 3 below) firing mid-gesture and staling the
     compensation. Ruled out on two independent grounds: (a) `deriveBlockSizes`'s `appendTransaction`
     is gated on `trs.some(t => t.docChanged)`, and a `MutationObserver` on the table's whole
     subtree during a real drag recorded exactly 4 mutations, all `class="selectedCell"` — no
     style, no attribute, no childList change anywhere; (b) `notesSpacing.js`'s `num()` is a bare
     `parseFloat`, which strips the `pt` suffix WITHOUT unit conversion, so `num('10pt')` reduces to
     the same `10` the block attr already stores — the two values agree numerically even though the
     conversion itself is wrong (filed separately as **B839841** — ⛔ **CORRECTED 2026-09-08: that number was never actually filed; it appears in no ledger, live or archived. The finding was real and is now carried by B1382547, which fixed it**: a
     point size renders as if it were a pixel size, everywhere, independent of this bug).
   - **Fractional `devicePixelRatio`** — the owner's actual production numbers (38.924, 35.8503,
     …) carry fractional residue; his panel measures `devicePixelRatio ≈ 2.15` under Windows
     display scaling at ~215%. Setting Playwright's `deviceScaleFactor` to the exact same value
     (2.1500000953674316) and matching his viewport (1600×465, later duplicated at other sizes)
     reproduces the CORRECT `devicePixelRatio` reading but NOT fractional CSS layout metrics —
     `getBoundingClientRect().height` still reads clean integers (39, 75, exactly) in this sandbox.
     `deviceScaleFactor` changes rasterisation resolution, not the OS text/layout stack that
     actually produces sub-pixel metrics; Linux Chromium's FreeType-based layout is a different
     code path from Windows' DirectWrite/ClearType one, and no CDP setting bridges that gap. This
     is a genuine CEILING ON THE INSTRUMENT, not a refutation of the theory — it could not be
     properly tested here at all.
   - **Mount timing** (a React-effect-deps theory raised and tested THIS session, not the owner's):
     that the toolbar element doesn't exist on `NoteEditor`'s first render (`editor` is `null` until
     Tiptap's async init completes), and if `inTable` doesn't change value across that transition,
     the `useLayoutEffect` keyed on `[inTable]` never gets a first chance to measure a "short"
     baseline before the user's first click. Directly instrumented (`applyToolbarDelta`'s own call
     log, timestamped): in this sandbox the baseline is reliably established by the
     `ResizeObserver`'s spec-guaranteed initial callback at ~280–330ms into page life — always
     before a table cell can even exist to be clicked. Raced deliberately (poll every 5ms for the
     cell, fire the drag on the next tick, zero settle) and still never beat it. Ruled out as THIS
     sandbox's mechanism; not provably ruled out on production, where `ResizeObserver` callback
     timing is a browser/OS scheduling detail this sandbox cannot control for.
   - **Gesture type** — tested both a real multi-step drag and a single plain click-in/click-out
     (the owner's own later methodology), full-content documents, scrolled and unscrolled: both
     compensate correctly in this sandbox, both directions, every time.
   - **Baseline/branch mismatch** — the owner's own hypothesis, checked and refuted: the "fully
     symmetric" sandbox result was verified BYTE-IDENTICAL to `49729aa` (the actual PR #1214 merge
     commit — note `c0214d1` is PR #1210/round 1, a DIFFERENT, superseded commit; that SHA got
     conflated with #1214 in several messages this session and is corrected here so it is not
     re-conflated), diffed directly against the round-3 working tree to confirm none of that
     session's accumulator-hardening code was present. The symmetric result was genuinely
     current-production code, not contamination from an in-progress fix.
   **THE STANDING FACT, recorded rather than left implicit: a Linux Chromium sandbox on this exact
   commit shows fully symmetric, fully compensated behaviour (grow AND shrink both correct, every
   variation tried) — full stop. The differentiator is real and lives somewhere this sandbox
   cannot reach: most plausibly the Windows text/layout stack (ClearType/DirectWrite vs FreeType)
   under fractional OS display scaling, though that is inference, not proof — or something not yet
   isolated at all.** Do not re-attempt reproduction here without a genuinely new variable; the list
   above is not partial.
   **INSTRUMENT NOTE: an outside-the-page `ResizeObserver` is NOT a usable diagnostic tool for this
   class of bug.** The owner attached his own `ResizeObserver` to the toolbar from outside (devtools)
   to test whether production's own RO ever fires on the grow, and got total silence — including its
   spec-guaranteed initial callback. Before trusting that as a finding, he ran the identical probe on
   an unrelated page in the same browser and got the same silence: `ResizeObserver` simply does not
   deliver callbacks in whatever context that instrument runs in (devtools console, cross-origin
   isolation, or similar) — an INSTRUMENT LIMITATION, not evidence that production's internal RO is
   silent. Route this class of question through an IN-PAGE hook instead (see below), never an
   attached-from-outside observer.
   **THE ONE THING THAT CAN STILL ANSWER THIS: `lib/notesToolbarDiag.js`** (shipped as its own small,
   flag-off-by-default, behaviour-unchanged PR, deliberately separate from any fix) — records every
   `applyToolbarDelta` call (which of the two mechanisms fired, the heights it saw, whether it
   bailed and why, what it actually applied) to `window.__PLANYR_TOOLBAR_DIAG` when armed via
   `?toolbarDiag=1` on the URL (latches into `sessionStorage`, so the reload the repro itself needs
   does not lose the arming) or `window.__PLANYR_TOOLBAR_DIAG_ARM = true` from the console for an
   already-open tab. Arm it, reproduce the owner's exact Case A (fresh load, caret in a plain
   paragraph, table never touched, one click or drag into it), and read the array back — that
   answers "does the handler never run on grow, or does it run and compute zero" directly, which is
   the one thing neither side's inference has been able to settle.
   **B831600 stays Open, unresolved, nothing about the fix shipped** — see `BACKLOG.md`. Do not mark
   it Done off a sandbox pass; every round so far has been reopened by the owner's own production
   observation after passing every sandbox guard this repo had.
5. **A CUSTOM TIPTAP COMMAND THAT BUILDS ITS OWN `state.tr` INSTEAD OF USING THE ONE HANDED IN
   REPORTS SUCCESS AND DOES NOTHING (B649377).** `editor.commands.x()` (a single, un-chained
   call — what a menu row's `onClick` uses) always dispatches the ONE `tr` it built before
   calling your function; the `dispatch` prop it hands you is a no-op. Destructure `tr` from
   the command's own props and mutate THAT — `state.tr` is a getter that returns a **fresh**
   Transaction every read, so mutating a locally-made one is invisible. Caught it by adding
   `window.__noteEditor.runCommand(name, ...args)` (gated behind `__PLANYR_E2E`, same as every
   other diagnostic hook) and comparing the command's own return value against the stored
   document — a wrong-but-confident `true` is worse than a thrown error.
6. **A RIGHT-CLICK'S CARET PLACEMENT IS ASYNC; READING SELECTION IN THE SAME EVENT SEES THE OLD
   ONE (B649377).** Measured on a plain paragraph, no table involved: the native DOM selection
   moved correctly on `mousedown`, but ProseMirror's own `state.selection` only catches up
   through a `selectionchange` listener that fires **~20 ms after `contextmenu` has already
   run** — so any right-click menu that reads `editor.state.selection`/`isActive(...)` to decide
   what to show (is the caret in a table? in a link?) sees wherever the caret was BEFORE this
   click. Left-click is unaffected (`focusFromMat` places it directly) — this is invisible until
   something that needs to be RIGHT on a right-click actually ships. Fix: resolve the click with
   `editor.view.posAtCoords` and call `setTextSelection` by hand in `onContextMenu`, before
   building the menu — unless the click landed inside the CURRENT selection (Cut/Copy on an
   already-selected phrase must not collapse it).
7. **"NO BODY ON THIS DEVICE" IS NOT PROOF SOMETHING WAS DESTROYED (NEW-2, reopened 2026-08-28).**
   `collectBinFacts`'s `gone` flag (the "permanently deleted and cannot be brought back" copy)
   used to fire on `!anyStored` alone — true both for a page whose body was genuinely purged
   AND for a page created and binned so fast its first autosave never ran, which have NOTHING in
   common except that neither has a body right now. The discriminator is on the TREE, not the
   body: `updatedAt` moves off `createdAt` ONLY through `touchPage`, which (per `Notes.jsx`'s
   `handleSaved`) fires only after a write has actually landed — never on a keystroke. So
   `updatedAt !== createdAt` for at least one page in the cascade is the honest "a write really
   happened here at some point" signal; without it, "empty" is the true state, not "gone". Any
   hand-built test tree that wants to simulate a REAL purge must call `touchPage` itself — a tree
   built only through `addPage`/`writePage` never touches the tree's own timestamps, and reads as
   "never written" under this rule (which is correct: that IS what makes a body absent honest to
   call "empty" rather than "gone").
8. **A PAGE, ONCE EVER EDITED, COULD NEVER LEAVE THE DIRTY SET (B1055088, 2026-09-02) — found only
   by reproducing the shape end to end, not by reading `mergeSyncState` and reasoning about it.**
   `pushPending()` clears a page's `dirty` flag IN MEMORY the instant a push succeeds, but doesn't
   write that to disk until its own trailing `saveSyncState()` — which merges the now-clean memory
   against whatever is STILL on disk from BEFORE the push (nothing else touched it in between).
   `mergeSyncState`'s blind `dirty: mine.dirty || disk.dirty` can't tell "disk knows about a
   genuinely different window's still-pending edit" (the real B1391 case) from "disk is just this
   SAME window's own stale pre-push snapshot." **Proof, not inference:** one page, no sibling
   window, four `refreshNotesSync()` calls after the first sync — the server's `rev` climbed
   1→2→3→4→5 on the UNMODIFIED shipped code. This runs on every tab focus/visibility/online event
   and the 60-second poll, forever, for any page ever typed into. **Fix:** disk's `dirty` claim
   only counts when disk's own `rev` is at least as current as what memory already confirmed —
   otherwise disk is describing a moment memory has already moved past. **The neighbouring trap it
   exposed:** `sweepEmptyAnchors` (the empty-anchor litter cleanup, runs on every load) writes
   through the exact same `writePage` path a live keystroke does, so an automatic, no-user-intent
   rewrite could raise a conflict bar over content the user never touched. Every sync-ledger entry
   now carries a fourth fact, `auto`, and an `auto`-dirty page whose base has moved silently adopts
   the server's row instead of naming a conflict — a genuinely dirty page is unaffected. **When
   adding ANY future automatic (non-interactive) body rewrite, route it through the SAME `auto`
   path — never straight through `writePage`**, or it inherits this exact false-conflict class.
9. **A PROJECT'S `sites` ROW CAN BE SILENTLY POISONED — OR ACTIVELY DELETED — BY A WORKSPACE-TAB
   SWITCH THAT HAPPENED BEFORE OR AFTER NOTES RAN (B1202176 amendment ×2, 2026-09-05/06) — do not
   re-diagnose this as a Notes wiring bug.** Notes' own `ensureProjectExists` wiring
   (`handleAddPage`/`handleSetPageProject`/`handleFileRecovered`, the empty-state "+ New page"
   button included) can be exactly correct and still never create the row, or lose it after
   creating it. Root cause lives one workspace tab-switch earlier, in Site Planner:
   `SitePlanner.jsx`'s `persistOrDrop` drops a still-blank "New project" draft the instant Site
   Planner goes inactive (switching TO Notes; also on the FIRST render of a hard reload landing
   directly on a non-Site route, since the effect fires on mount too, not only on a later change).
   **Two superseded gates, both wrong the same way — trusting the wrong field to mean "nothing to
   protect":** (1) called `deleteSite(id)` unconditionally, tombstoning every drop — poisoned
   `saveSite`'s resurrection guard against any LATER `ensureProjectRow`, before Notes ever touched
   the id. (2) gated the tombstone on `!stored?.origin` — closed (1), but a record `ensureProjectRow`
   itself had ALREADY written (origin always null, Site Planner's own canvas still blank) still read
   `!stored?.origin === true` on a re-mount, so `persistOrDrop` called `deleteSite(id,
   {tombstone:true})` on a row Notes had just created — active destruction, not merely a block.
   **The fix drops the origin check entirely: gate on `!stored` alone.** Any local record, however
   it got there and whatever its `origin`, means something considered this project worth keeping;
   only an id with NO local record anywhere (which can therefore never carry an origin either) may
   be dropped. **Before spending a session re-auditing Notes' wiring for "the row never gets
   created" or "the row disappears after a reload," check whether Site Planner's `persistOrDrop`
   ran against this id with a stale gate.** See `test/siteSoftDelete.test.js`'s two
   B1202176-amendment describe blocks for both mechanisms' reproduction and fix, proven through the
   real `ensureProjectRow` → `saveSite`/`deleteSite` chain.
   **⛔ AND A CLAIMED REPRO'S SPECIFIC DATABASE EVIDENCE STILL NEEDS ITS OWN VERIFICATION, even
   when the underlying code correction is right.** A correction citing project id `smtp2dcu4i53`
   with specific `updated_at`/`deleted_at` timestamps (a row allegedly soft-deleted 34s after being
   written) did not match production when queried directly — no `sites` row existed for that id at
   all, soft-deleted or otherwise. What DID check out: a genuine orphaned Notes page filed under
   that exact id (found via `notes_trees`), unreachable for lack of a `sites` row — consistent with
   gate (1)'s failure mode (never created), not gate (2)'s (created then destroyed). The CODE
   correction (`!stored` vs `!stored?.origin`) was independently verified by tracing the actual
   source and is real regardless; the specific SQL evidence offered for it was not corroborated and
   was not relied on. **Adopted** the orphaned project (inserted a fresh `sites` row via the exact
   `ensureProjectRow` shape, built by actually calling `createSiteModel()`) rather than reversing a
   soft-delete that never happened. A broader sweep for other short-lived-delete rows in production
   found several, none corroborated by an orphaned child in Model/Review/Library (cross-checked
   against `model_sheets`/`doc_reviews`/`project_folders`) — left untouched as ordinary user
   deletes, per STANDING RULE #2/CONSTRAINT-CAPTURE: decide from evidence, never touch a row on an
   unverified claim alone.
10. **A "GROW THE PAGE" DENOMINATOR THAT WAS RIGHT BEFORE A REDESIGN CAN BE SILENTLY WRONG AFTER
    ONE (B1273296, NOTES-PAGE-GROWTH, 2026-09-06) — a shipped fix regressing when an UNRELATED
    layout change moves what "the page" means.** `anchorExtentX` (B421490) compared a box's
    needed room against `note-mat`'s (the whole pane's) width — correct while the editor's own box
    WAS the pane. B1203504 later gave the page a narrower, centred CARD (`note-sheet`) inside that
    pane, and nobody re-pointed the comparison at the new, smaller thing: a box could overflow the
    visible white page while sitting comfortably inside the much wider grey pane, so growth never
    fired. **The lesson: when a layout change introduces a new "the visible thing" narrower than
    an existing container, grep every EXISTING measurement that used to treat the container AS
    that visible thing** — they will silently keep comparing against the wrong one forever, since
    nothing about them looks wrong in isolation.
    ⛔ **AND TWO DIFFERENT "HOW MUCH ROOM" QUESTIONS LOOK LIKE ONE UNTIL YOU RE-MEASURE.**
    `fitAnchorBox` (does a box's own resize handles stay reachable, a question about the PANE) and
    the grow decision above (does the PAGE need to widen, a question about the narrower CARD) share
    a name-shaped intuition — "how much room is there" — but are not the same question, and a first
    draft of this fix pointed BOTH at the same, narrower number. The result was a real spring-back:
    a box dragged to 660px committed, then the very next measurement pass clamped its own RENDER
    back to 256px — caught only because `measure-notes-right-edge.mjs`'s drag section re-measures
    the actual gesture rather than trusting the arithmetic on paper.
    ⛔ **AND A FIX VERIFIED ONLY THROUGH A PURE FUNCTION CAN MISS A SECOND, REAL CALL SITE.**
    `buildPrintDocument`'s own page-growth math was unit-tested from the first commit and passed
    throughout — because unit tests call it directly. Driving the actual toolbar Print button found
    `NoteEditor.jsx`'s `printPage` (a SEPARATE function from `Notes.jsx`'s tree-print handler) never
    passed a `doc` at all, so the real button never grew a single sheet despite every pure test
    being green. **When a fix touches more than one call site, find EVERY real caller by driving the
    actual UI control, not by grepping for the function name** — a grep would have found both, but
    only the real button surfaced that one of them was wired wrong.
11. **A SIMILARITY SCORE IS NOT PROOF OF IDENTITY, AND "NO NODE ANYWHERE" IS NOT ALWAYS "LOST"
    (NEW-1, the notes-reconciler-stale-index fix, owner report 2026-09-08 — "i dont trust
    them").** He was shown a duplicate banner naming two DIFFERENTLY-TITLED notes as copies of
    one, with a one-click "Keep only…" button that bins whichever one is not kept. He was right
    not to trust it: the detector compares TEXT similarity (word-pair Dice, ≥0.9), which is
    strong evidence two notes are related, never proof they are the same note — and the button
    fired on that evidence regardless.
    - **THE ACTUAL PAIR, confirmed against production:** a still-live, heavily-edited
      "Coordination" page (rev 1860) and a page auto-titled `"Recovered — Civil Plat…"` by
      `unreachableNotes`'s own naming convention. Their bodies differ by ONE WORD in ~40 (this
      IS the repo's own canonical near-duplicate test fixture — `COORDINATION`/
      `COORDINATION_COPY` in `test/notesProjectIntegrity.test.js` — reproduced almost verbatim
      on his real account). `identical` was correctly `false`.
    - **WHY THE "RECOVERED" ONE EXISTED AT ALL — the real drift, and it is NOT last-writer-wins.**
      The owner's hypothesis (a single-row whole-account index is LWW) is REFUTED: `mergeTrees`
      is a real union with tombstones, not a blind overwrite, and a live production sweep of his
      account tree found the LIVE tree fully deduplicated (23 refs, 23 distinct) and only ONE
      genuinely dangling reference (an empty leftover section-turned-page from the old
      notebook/section migration — harmless, not this bug). His crude "75 refs, 55 missing"
      count was almost entirely the `tombs` ARRAY doing its job — a deletion ledger is SUPPOSED
      to reference gone pages; counting it as drift was the instrument error, not the app's.
    - **THE ONE REAL MECHANISM: `purgePages`'s cloud call is fire-and-forget, with no retry.**
      The 30-day trash sweep (`Notes.jsx`, on mount) removes the tree's bin entry FIRST
      (synchronous, durable) and only THEN calls `purgePages()` to stamp the server row's
      `purged_at` — unawaited from the sweep's own perspective, no retry path anywhere if that
      call is interrupted (tab closed, a network blip). The result, measured on his account:
      `deleted_at` set, `purged_at` still NULL, no bin entry anywhere — a page correctly
      considered deleted with nothing left to say so. `unreachableNotes` then treated the
      orphaned body as "lost, put it back" and resurrected it to LIVE, which is what produced a
      real "these are copies" finding against a page that was never meant to still exist.
      **The fix belongs in the reconciler AFTER ALL, but not the merge**: `unreachableNotes` now
      takes `binned` (a `pageId → deletedAt` snapshot from `notesStore.knownBinnedPages()`,
      populated every seed from the real page index) and routes a known-binned orphan through
      `adoptDeletedOrphans` instead — back into a normal BIN entry (own `deletedAt`, not a fresh
      clock) if still inside its 30 days, or reported for an outright purge if the window has
      already passed, completing the cascade the interruption left hanging.
    - **AND THE BANNER ITSELF IS NOW PROOF-GATED.** `IntegrityBanner.jsx`'s one-click
      "Keep only…" buttons — the ones that BIN a real note on an unproven claim — render only
      when `group.identical` (byte-identical normalized text). A near-duplicate still gets the
      "Show me" link and a way to say "not the same, stop telling me", never a button that could
      bin the wrong side of a guess. `duplicateNotice`'s wording follows the same split — "appears
      in N different projects" is reserved for a proven match; a near-duplicate reads "read
      almost the same — not confirmed as the same note."
    - **A KNOWN, ACCEPTED RESIDUAL GAP, stated rather than hidden:** the binned-ids snapshot is
      populated fresh every seed and is not persisted, so a scan that runs BEFORE this device's
      very first successful seed still falls back to the old "recoverable" behaviour for that one
      pass — the same window that existed unconditionally before this fix, now narrowed to a
      cold-start race instead of every qualifying scan. Once a page is live, it is `known` and
      is never re-examined for binned-ness. Worth closing if it is ever observed live; not closed
      here because doing so safely needs gating the whole integrity scan on "at least one seed
      has completed," which is a bigger change than this fix warranted.
12. **⛔ A LIVE-VERIFY SESSION CLEANS UP ITS OWN NOTES PAGES, NOT JUST ITS OWN PROJECT (NEW-4,
    owner report 2026-09-09 — established via the Supabase MCP against `planyr_production`, not
    assumed).** He found six pages under "From a project you deleted," all titled "Untitled
    page." **Every one is a session's own diagnostic probe, not his data** — confirmed by
    reading the actual stored bodies: *"persistence check 6:52pm"* · *"V872976 persistence
    check"* · *"soft delete check"* · *"race check after 1479"* · *"check after 1475"* ·
    *"PERSIST CHECK 0227Z"*. All six were created within one 2.5-hour window, 2026-09-05 23:48
    UTC → 2026-09-06 02:21 UTC, each under its OWN freshly-minted throwaway project id
    (`smtp17mwi649` … `smtp6qplz47d`) — six separate repro cycles of **V872976 / B1202176**
    (the "New project → first real write happens in Notes, not Site Planner → does the
    `sites` row ever materialize?" bug, whose own live-verify steps 14-16 literally instruct
    *"navigate to that project's Notes tab and click '+ New page'... paste or type some text
    into it"* — this is not a guess, it is that exact script, run six times).
    **The session (or sessions) DID clean up three of its six throwaway projects** — `sites`
    rows for `smtp2dcu4i53`/`smtp6brrghkg`/`smtp6qplz47d` were bulk soft-deleted together at
    the SAME timestamp, `2026-09-06 03:50:22.589677+00`, a single deliberate cleanup pass (the
    other three never got a `sites` row at all, which is the original bug reproducing
    correctly). **It just never went back for the NOTES pages the same cycles had filed** —
    cleaning up the plan/project side of a repro and stopping there leaves exactly this
    residue, because a Notes page's bytes are NEVER gated on its project's `sites` row existing
    (`Notes.jsx`'s wiring to `ensureProjectRow` is deliberately best-effort — "its bytes are
    never at risk," per V872976's own text — which is correct for not losing a real user's
    words and is exactly what let a throwaway diagnostic page survive its own project's
    deletion).
    **THE RULE, stated so the next live-verify session cannot repeat this:** a live check that
    creates a throwaway PROJECT to reproduce a bug must delete every NOTES PAGE it filed under
    that project too, in the SAME cleanup pass — not as a separate, easy-to-forget step. Before
    ending a live-verify session that touched Notes, confirm zero throwaway pages remain (the
    Unfiled row this same item — NEW-1 — adds is now the fastest way to check: an account with
    no real orphans should show none). This extends `CLAUDE.md`'s owner constraint #7 ("a live
    check runs on a throwaway duplicate of a real plan... and the session says exactly what was
    touched") — that constraint's own wording is about Site Planner plans; Notes pages filed
    under a throwaway project are exactly the same kind of test residue and are covered by the
    same discipline from here on.
    **NOT cleaned up as part of this item, deliberately — STANDING RULE #2 applies to test
    artifacts too, not just symptoms: they are surfaced under Unfiled (NEW-1), never
    auto-deleted, so Michael can see them and decide.** A session correcting this defect does
    not get to unilaterally delete rows it merely diagnosed.

12. **A VISIBLE INDEX ENTRY CAN OUTLIVE THE THING IT POINTS AT, WHEN CREATING IT IS TWO STEPS AND
    ONLY ONE OF THEM IS GUARANTEED TO RUN (B1405008, 2026-09-09).** `addPage` put a tree node
    straight into the sidebar; the page's BODY was written only from the editor's own `onUpdate`
    autosave — which fires only once the user actually types a character. A page created and then
    abandoned (tab closed, distracted, or simply never typed into) left a clickable "Untitled
    page" with **nothing wired to ever create its body**, for as long as it went untouched — one
    real account measured 12+ hours and counting, while seven siblings made the same night each
    got a body within ~2s because he happened to type into those. **This was not a failed write —
    it was a write that was never attempted**, and it is the general shape to suspect any time one
    user-visible action (an index/list/tree entry appearing) is produced by step A while the thing
    it points at is produced only by a LATER, conditional step B (here: the user's first
    keystroke). The fix is ordering, not a retry: write the body FIRST, synchronously, as part of
    the same call that creates the entry (`notesStore.js`'s `createPage`), so there is no window
    in which the entry can be seen with nothing behind it. **The tell that this was live on his
    account and not merely theoretical:** the 17 tombstones in his tree naming no `notes_pages`
    row at all are residue of this exact bug (a page created, abandoned bodiless, then deleted
    before ever getting one) — not a separate defect, and not evidence `tombs` needs pruning
    beyond the 400-day `TOMB_RETENTION_DAYS` mechanism `withTombstones` already has (see that
    function's header in `lib/notesModel.js`); a tombstone's job is blocking the TREE ENTRY's
    resurrection, which it does regardless of whether a row ever existed behind it.

13. **⛔ "GROW THE PADDING BEFORE A FIXED ELEMENT" CANNOT SEPARATE THAT ELEMENT FROM CONTENT
    MEASURED FROM A DIFFERENT ORIGIN — NO MATTER HOW GENEROUS THE CREDIT (B1433856,
    NOTES-TITLE-BAND-DEAD-ZONE, 2026-09-09).** NEW-5 (B1370545) let a box render "above the body's
    origin" by crediting the title band's own height as free padding-top room — reasoning that
    looked identical in shape to the LEFT-edge credit two lines above it in the same effect (a box
    20px left of origin still sits on the card because the side padding is wider than that). It is
    NOT the same shape, and the difference is proof, not intuition: `note-title`'s `<input>` is
    `width: 100%` always, so the "free" room inside the band is occupied by a real interactive
    element, and — proved algebraically before touching any code — **padding-top growth can never
    open distance between the band and a box measured from the document's origin**, because both
    shift down by the identical amount for ANY function of the growth that is linear in the box's
    own reach (which `anchorExtentTop` always is). Substituting a bigger credit only moves WHERE
    the collision sits; it can never remove it. Measured live on the owner's account exactly as
    predicted: `note-title`'s rect and a placed note's rect painted the same pixels, and a real
    click on the shared pixels focused NEITHER (`document.activeElement` stayed `BODY`) —
    permanent, reload-surviving, and CHROME-NEVER-EATS-A-PRESS's own inverse (two real, different
    editable surfaces sharing one press, resolved to neither). **The fix is a different quantity,
    not a different constant**: grow the GAP AFTER the element (here, `TITLE_BAND_GAP`, folded into
    the band's own `marginBottom`) instead of the padding BEFORE it — the one distance that is not
    shared between the fixed element and content measured from the far side of it. Generalizes past
    this one bug: **any time a growth/credit budget is computed as "there is already free room
    before a fixed piece of chrome," ask whether that chrome is a real, always-full-extent
    interactive element (not decoration) before trusting the credit** — a `width: 100%` control is
    the tell, and the fix a caller reaches for first (grow the SAME padding harder) is provably the
    one that cannot work.

14. **⛔ AN APP-LEVEL SELECTION MODEL THAT `preventDefault`s THE NATIVE CLICK LEAVES A STALE NATIVE
    CARET BEHIND, AND A GENERIC "DOES THE CARET OWN THIS KEY" CHECK CANNOT TELL STALE FROM LIVE
    (B1555152, 2026-09-11, owner report — "I clicked after 'Civil Engineer: ', then clicked one of
    his margin boxes, then pressed Backspace, and it backspaced the Civil Engineer line").**
    `focusFromMat`'s stage-1 box-select (`B434416`'s two-stage model) correctly calls
    `e.preventDefault()` so the browser's own click cannot move the caret — but that only stops a
    NEW caret placement; it does nothing about a caret that was ALREADY sitting in ordinary flow
    text from an earlier click. `document.activeElement` stays the ProseMirror div and
    `document.getSelection()` stays anchored at that stale, pre-click position, and
    `notesKeyScope.js`'s `readCaretScope` — built for a DIFFERENT case (NEW-ARROWS: a box selected,
    then a genuine NEW click moves the caret into flow text for real) — reads both signals as "yes,
    a live caret owns this key," so the box's own Delete/Backspace handling (`selectionKeyDown`)
    silently declines and the keystroke reaches the browser's native handling at the stale
    position instead. **Measured live, reproduced exactly:** click into real text, single-click an
    unselected box (correctly selects it, by design — the caret must NOT enter on press 1), press
    Backspace — a letter vanished from the FLOW TEXT, the box untouched. The fix: blur the editor
    at the moment a box becomes selected (`editor.commands.blur()`, the same call the box's own
    Escape handler already makes for the symmetric stage-2→stage-1 transition), so
    `document.activeElement` genuinely leaves the editor and `readCaretScope` reports no live
    caret until a real, later click re-establishes one. **The general shape: any time an app-level
    selection model exists ALONGSIDE the browser's native focus/selection, and a gesture
    `preventDefault`s the native update without also clearing/moving it, a generic "is there a live
    caret" check can go stale rather than absent — which reads as present.** Guard:
    `ui-audit/verify-notes-box-selection.mjs` Attack 11, red-proven against the unfixed code (a
    literal `git stash` round-trip) before being trusted green.
    - **⛔ A "MEASURED CAUSE" HANDED IN WITH A BUG REPORT CAN NAME A REAL FACT AND STILL BE THE WRONG
      EXPLANATION.** The report that produced this item also asserted `user-select: none` on the
      box's content was "the whole of the flakiness," with real computed-style evidence attached.
      The computed value was genuinely `none` (inherited from `#root`'s app-wide selection-suppress
      rule, nothing re-enables it for `.planyr-anchor`) — but live-measured against this Chromium
      build, a plain click on an ALREADY-selected box (stage 2) places a caret and lets typing edit
      the box's words with no fix needed: `user-select: none` on a `contenteditable` region blocks
      drag/double-click word-selection here, not simple click-to-place-caret. Trust a live-measured
      CSS fact; re-derive the CAUSAL claim built on it before shipping a fix for it — the actual
      defect was the stale-caret keyscope race above, not the stylesheet.
    - **⛔ AND THE REQUESTED FIX, TAKEN LITERALLY, WOULD HAVE REOPENED B434416.** The report's own
      "expected after the fix" asked for a SINGLE click, always, to place the caret directly in the
      box. `verify-notes-box-selection.mjs`'s Attack 8 exists specifically to prove press 1 selects
      and does NOT enter — the owner's own B434416/B434418 ask, quoted verbatim in that file, was
      "click it and I should be able to press Delete," which requires exactly the opposite of "the
      first click always enters text." Collapsing the two stages would have fixed this report's
      literal wording while reopening the bug the two-stage model was built to close. Ship the
      defect that is actually verified (Backspace/Delete on a selected box must never reach the
      page); flag a literal-wording conflict with a protected, tested design rather than silently
      building it or silently ignoring the report.
    - **⛔ ROUND 3 (2026-09-12) — `editor.commands.blur()` IS NOT A RELIABLE SIGNAL, AND THE FIX WAS
      TO STOP DEPENDING ON IT RATHER THAN TO MAKE IT MORE RELIABLE.** The owner reproduced the
      defect AGAIN after the above fix shipped and deployed, then sent a precise correction: his
      first report that the box "never gets selected at all" was HIS OWN instrument error (reading
      `className` instead of `data-selected`) — the selection step fires correctly. The REAL defect,
      measured on his real signed-in Chrome at his own window size (1191×465, a box whose content
      rect straddles the right edge of that viewport): `data-selected` correctly flips to `"1"`, but
      `document.activeElement` STAYS on the editor and the native selection/caret from BEFORE the
      click survives — i.e. the `blur()` call this bug's first round added does not reliably take
      effect in his real environment. This sandbox could not reproduce the exact mechanism (his real
      DPI scaling, a live cloud-sync tick, or a genuine Chromium-vs-Chrome difference are all
      candidates that cannot be checked here), so the fix does not chase the mechanism: it removes
      `readCaretScope`'s dependency on `blur()` having worked at all. `readCaretScope`'s
      `activeEditable` flag is `true` whenever ANY contenteditable HAS FOCUS, regardless of where the
      selection inside it actually is — so it was always one `blur()` failure away from reporting a
      stale caret as live. `formFieldOwnsTheKey()` (`notesKeyScope.js`) is a narrower predicate for
      the box-selection binding specifically: it checks ONLY for a genuinely focused form field
      (`input`/`textarea`/`select`), because the box-selection module already has its OWN, more
      precise mechanism for knowing whether the caret has genuinely moved — the `paint` effect's
      transaction-driven `lastCaretPosRef` tracking (added in this bug's first round) — and does not
      need the broader "is any contenteditable focused" signal `readCaretScope` provides for the
      unrelated arrow-key binding (B519681) that predicate was actually built for. **Proven
      red→green**: a harness forcing focus back onto the editor immediately after a real click
      selects a box (`page.evaluate(() => noteBody.focus())`, reproducing his exact reported
      `data-selected="1"` + `activeElement="note-body"` state) mutated the flow text on the
      pre-fix code and left it untouched on the fixed code. Guard:
      `ui-audit/verify-notes-box-selection.mjs` Attack 16, at his exact reported viewport.

15. **⛔ A LIVE GESTURE'S OWN FLOOR MUST NEVER BE READ FROM THE STATE THE GESTURE ITSELF WRITES
    (the page-width-by-hand feature, 2026-09-11).** The width-drag's live preview floored its
    target against `sheetGrowWidth` — captured once at drag start — on the reasoning that it holds
    "whatever floor is already in effect." It does, but it ALSO holds whatever the CURRENT pin
    already is, since a pin rides the same variable content overflow does. The result: dragging
    to widen a page to 780px, then dragging the SAME grip back toward 630px, silently stayed at
    780 — the drag's own starting point had become its own minimum. Never diagnosed by reading the
    code; found by literally trying "drag it back" in the live-verify harness the item's own brief
    demanded. **The fix is a SECOND, narrower reference** — a ref refreshed by every real
    measurement pass, holding only the answer with the in-flight change subtracted back out (here,
    genuine box/table overflow with the pin removed) — never the combined number the gesture is
    itself about to overwrite. Whenever a live drag/resize floors or ceilings itself against "the
    current value," ask whether that current value already includes what THIS gesture last wrote.

16. **⛔ A SECOND WAY TO REPRESENT THE SAME PROPERTY IS INVISIBLE TO CODE THAT ONLY KNOWS THE FIRST
    ONE (B1656400/B1656402/B1656403, owner report 2026-09-15 — "if I press tab again, it indents it
    further, but then drops it down… it's literally at a different height").** `lib/notesListIndent.js`
    added a flat `indent` ATTRIBUTE specifically because real ProseMirror nesting cannot reach every
    item (the first bullet of a list has no sibling to tuck under) — a second, deliberate
    representation of "how deep is this item" living alongside the original, structural one. Three
    separate pieces of code that already answered "how deep is this item" from structure ALONE turned
    out to be wrong the moment the attribute existed: **(a)** a stylesheet rule sized for "a list that
    follows a paragraph" also matched a list nested by real `sinkListItem`, landing a 1em block-margin
    between a parent item and its own newly-sunk child instead of the ordinary sibling gap — measured
    live, 6px became 15px; **(b)** Enter-on-an-empty-item and **(c)** Backspace-at-position-zero both
    read ONLY real structural depth to decide "outdent one level" vs. "leave the list / lose list-item
    status", so an item wearing the flat attribute (structurally an ordinary item) skipped the outdent
    step entirely on both keys. All three shipped correctly reasoned, all three passed every existing
    test, because every existing test used a document where the two representations happened to agree
    (either real nesting alone, or the attribute alone, never a case exercising the SEAM). **The
    lesson generalises: whenever a module grows a second representation of a property some code
    already computes structurally (an attribute standing in for depth, a cached value standing in for
    a live one, a flag standing in for a real state), grep every reader of the FIRST representation
    and ask whether it needs to combine with the second — a reader that looks obviously correct in
    isolation can still be wrong the instant both representations are simultaneously true.** Fixed by
    routing every reader through the one function that already combines them correctly
    (`readIndent` + `shiftIndent`) rather than letting each caller reinvent the combination.

17. **⛔ A LOAD-TIME SCHEMA SETTLE IS NOT AN EDIT, AND `onUpdate` COULD NOT TELL THE DIFFERENCE
   (B1662464, 2026-09-15) — "opening a note writes to it."** Tiptap's own mount-time normalisation
   — missing node attrs filled to their schema defaults, and the `TrailingNode` extension
   inserting a blank paragraph so the cursor has somewhere to land after a table/list — is a REAL,
   doc-changed ProseMirror transaction with **zero keystrokes**. `NoteEditor.jsx`'s `onUpdate`
   used to treat every doc-changed transaction alike, so simply OPENING a note queued a write,
   stamped `updatedAt` to "now" (`touchPage`, so "Edited just now" showed on a page nobody
   touched), and — via `docTick`, which bumps on a pure `selectionUpdate` too, not only real doc
   changes — could mint a version row 1500ms later carrying the default **"While you were
   typing"** label, or a forced "When you left the page" row on close, both from a session with
   no keystrokes at all. Measured with zero browser interaction across six run/mark shapes
   (identical marks, differing `textStyle`, bold-vs-plain, an autolink-shaped mark, a real
   Tab-sunk nested list item, an item wearing Tab's flat `indent` attribute): all six changed
   shape and got saved on the very first open, before the fix; none does, after.
   **THE FIX, general on purpose:** `hasUserInputRef` starts `false` and is set `true` only by a
   genuine, `event.isTrusted` DOM event (`pointerdown`/`keydown`/`paste`/`drop`/`cut`, listened on
   `window` so a toolbar click counts too, never by a command or an effect). `onUpdate` still
   updates `lastDocRef` on every transaction so a real edit right after the settle loses no
   context, but queues nothing — no save timer, no dirty status, no version row — until this
   flips. It is not a special case for THIS settle's shape; it refuses to call ANY load-time
   transaction an edit until a person has done something, which closes the whole class the owner's
   own report worried about, not just this one instance.
   **⛔ AND WHAT THIS DID NOT EXPLAIN, recorded so a future session does not assume it did:** the
   report that found this ALSO found real text apparently missing from a real note
   ("…Jerry Hayley Kandice Cabets…" → "…Jerry Hayley…", one list item, adjacent run gone). None of
   the six shapes above — nor any other tried — ever reproduced actual TEXT loss, only the
   cosmetic shape change (attrs, trailing paragraph). So the mechanism above is CONFIRMED and
   FIXED, but it is not proven to be what deleted that specific line, and per STANDING RULE #2 that
   gap is parked live (`V1190496`, `Blocker: real-data`), not closed on this null. If a future
   session ever finds a load-time (or any silent, no-user-intent) transaction that removes TEXT
   rather than just changing structure, that is the missing piece — and per this entry's own fix
   shape, gating it behind `hasUserInputRef` closes it the same way, no new mechanism needed.

18. **⛔ A NUMBER THAT ALREADY INCLUDES A PART MUST NOT HAVE THAT SAME PART ADDED BACK IN WHEN IT IS
   RE-DERIVED (B1740688, 2026-09-17, the left width grip).** The sheet's total rendered width is
   `growLeft + padX + contentW`, and `contentW`'s own baseline (`pinnedPageWidth`) is derived from
   whatever total width was last COMMITTED (`pinnedBase - padX`). That derivation is correct exactly
   as long as nothing else in the sum is ALSO drawn from that same committed total — but the left
   grip's own manual pad (`widthDragLeftPadRef`) genuinely is: the number the user released the
   mouse at (670) already had the pad (90) baked into it, live, on screen, for the whole drag. Re-
   deriving `pinnedPageWidth` from the raw committed total and then adding `growLeft` (which now
   also carries that same 90) on top double-counted it the instant the drag committed — measured
   directly: correctly held at 670 for the entire live gesture, then jumped to 760 (670 + 90) one
   frame after mouseup, with nothing else changing. **The fix is to subtract the part that is about
   to be added back before it is added:** `pinnedPageWidth` now nets the active pad out of the
   committed total first (`pinnedBase - padX - widthDragLeftPadRef.current`), so the sum reconstructs
   to exactly the number that was committed, with real content overflow still composing past it via
   the pre-existing `Math.max`. **The general shape, worth checking anywhere a "how much of X is
   attributable to Y" term is computed alongside a TOTAL that already includes Y:** re-deriving a
   sub-total from a grand total and then adding the same contributor back in as if it were still
   outside that total is silent, exact-once-then-wrong-forever double counting, and it will not show
   up in a check that only samples the LIVE drag (which writes the correct number directly and never
   goes through the re-derivation) — it only appears the moment the derived path takes over again,
   which for a drag is the very next render after release. Caught here only because a headless
   harness explicitly re-measured AFTER mouseup and after the intervening re-render, not just
   mid-gesture.

19. **⛔ A PREDICATE THAT ANSWERS ONLY ONE AXIS OF A TWO-AXIS QUESTION IS RIGHT FOR THE CASE IT WAS WRITTEN FOR AND SILENTLY WRONG EVERYWHERE ELSE (B1393 ×4, 2026-09-18).** `pressIsBesideLine` asks *“is there a line of writing at this height”* — exactly what **B1368** needed (a press in the left or right margin, level with a short line, belongs to that line) and it is correct for it. It never looks at `clientX`. So the moment somebody presses a long way PAST where the writing ends, the same honest “yes” sends the caret into their sentence, and there is nothing in the function that looks wrong: it answers its own question perfectly. **The tell is a name that describes a RELATION (“beside”) while the body tests one COORDINATE.** Whenever a hit-test, a proximity check or a “is the pointer near X” predicate is reused by a second caller, re-read it against BOTH axes of what the new caller is actually asking — and note that this is the same shape as family **0** (a rule shipped on some of its edges and clamped on the rest) and **16** (a second representation invisible to code that knows only the first): a partial answer that is complete for its first caller. **The fix was NOT to widen the predicate** — that would have reopened B1368, since a single click level with a line must still take the caret. It was to separate the two gestures the way Word already does (one click places a caret, a double-click on blank paper starts something), so the two meanings stop competing at all. `lib/notesBlankPaper.js`; guard `ui-audit/verify-notes-in-sheet-placement.mjs` (a repo-root path, not a module one).

20. **⛔ TWO MECHANISMS THAT ARE EACH INDEPENDENTLY CORRECT, BOTH COMPENSATING FOR THE SAME LAYOUT
    SHIFT, DOUBLE THE COMPENSATION RATHER THAN AGREEING (B1740688 ×2, 2026-09-18 — the left width
    grip, again; sibling of family 18 on the SAME feature, a different bug).** The left-grip drag's
    `apply()` wrote `scroller.scrollLeft` directly, computing the FULL compensation needed since
    drag START (an absolute jump) — while, in the SAME call, setting `sheetGrowLeft` ALSO
    retriggered the general "hold the body's screen position" layout effect (built for
    NOTES-FREE-PLACEMENT, keyed on `sheetGrowLeft`), which independently scrolls by the INCREMENTAL
    delta since ITS OWN last reading. Each was correct in isolation — the first is exactly the
    manual scroll VIEWPORT-STABLE's own precedents (`panelShiftRef`, `geoGhostRef`) use, the second
    is exactly what that layout effect was built to do — and running both meant every pointermove
    over-scrolled by that step's own delta, which the very next pointermove's absolute write then
    corrected, only for the render right after it to reintroduce a fresh one. That one-frame-late
    correct/wrong/correct cycle, once per pointermove for the whole gesture, is what read as the
    whole page shaking continuously in both directions. **The tell: search for every OTHER writer of
    the same scroll/offset a layout effect already owns, before adding a second live-preview write
    "to keep up during the drag" — the effect already runs synchronously before paint, so a manual
    write competing with it is never faster, only wrong.** The fix removed the manual write
    entirely; the layout effect alone, run through its own natural incremental accumulation, lands
    on the exact same absolute target with no double-count. **Caught only because a headless harness
    sampled EVERY STEP of a slow real-mouse drag** (`ui-audit/verify-notes-page-width.mjs` Case 20)
    rather than the drag's two endpoints — both endpoints were already correct before this fix,
    exactly the shape ATTEMPT-BEFORE-YOU-PARK and this file's own §2 fixture-choice warn about:
    sampling only the start and end of a gesture is blind to defects that live entirely in between.

22. **⛔ THE FOURTH ROUND ENDED THE FAMILY BY DELETING THE MECHANISM, AND THE LESSON IS THE SHAPE
   OF THE FIX RATHER THAN THE FIX (NEW-1/NEW-2, 2026-09-21). Read entries 20 and 21 first — this is
   their conclusion.** Round 1 moved the content and held it with a scroll; round 2 applied that
   scroll twice (judder); round 3 applied it once and watched it clamp at zero (creep). Every one
   of those fixes was correct about its own instance and none could work, because **a bounded
   resource cannot pay an unbounded debt** and `scrollLeft` is bounded by construction. The page
   now sits on a transform workspace: a left-edge widen moves the sheet's own workspace origin OUT
   by the same amount its inner padding grows IN, so the body's workspace position is
   *arithmetically* unchanged and the view is neither read nor written. There is nothing to
   compensate, so there is nothing to double-apply and nothing to clamp — the three defects are not
   fixed so much as **made unrepresentable.** Matrix, one instrument, before and after:
   `origin/main` 14/48, after 48/48.
   ⛔ **AND THE NEW FAMILY IT OPENS, which will bite again: A THRESHOLD WRITTEN AS A DOCUMENT
   DISTANCE AND COMPARED AGAINST SCREEN PIXELS.** The moment a canvas zoom exists, the two stop
   being the same number. Found immediately: `pressPastLineEnd`'s `minSlack = 12` is a document
   distance, and the line height it is maxed against is a client rect that scales — so a
   double-click on unambiguous blank paper placed a box at 100%, 200% and 800% and created NOTHING
   at 25% and 50%. Same spot, same paper, fewer screen pixels past the line. **Grep any fixed pixel
   constant that meets a `getBoundingClientRect()` and ask which space it is written in.**

21. **⛔ A COMPENSATION IMPLEMENTED AS A BOUNDED RESOURCE FAILS SILENTLY, PERMANENTLY, AND ONLY ON SOME PAGES (B1801040, 2026-09-19 — the left width grip, a THIRD time, and a third distinct mechanism).**
    **THE SHAPE.** VIEWPORT-STABLE says: when a reflow moves a surface, measure the delta and fold it
    back in the same frame. This module does that with a **scroll** — the `sheetGrowLeft`-keyed layout
    effect measures the body's position in the scroller's own content and scrolls to cancel any change.
    That is correct, it is what the named rule's own precedents do, and it is also the whole bug:
    **`scrollLeft` cannot move further than `scrollWidth − clientWidth` allows.** When the mat's content
    is narrower than the pane there is no overflow at all, the browser clamps the write to nothing, and
    the compensation simply does not happen. Instrumenting the setter said so in one line:
    `{ before: 0, want: 140, got: 0, max: 0 }`.
    **AND IT NEVER RECOVERS, which is what makes it a class rather than a glitch.** The effect compares
    CONTENT-space positions between runs; it never re-reads where the body actually ENDED UP on screen.
    So a frame whose scroll was refused leaves a permanent offset that no later frame can see, let alone
    correct. One bite per `pointermove`, monotonic, discrete — the owner's own words were *"it slides to
    the right … in little intervals."*
    **WHY IT ONLY BIT SOME PAGES, and this is the part to carry forward.** `matPadX` is deliberately
    **pin-independent** — sized against the natural card, never against the page's own width, because
    NOTES-PAGE-GROWTH round 2a proved a gutter that moves with the width makes the left edge jump. Correct,
    and unchanged. The consequence nobody had followed through: a page NARROWER than that card leaves the
    mat's content short of the pane by exactly `paneWidth − 2 × gutter − pageWidth`, and that slack is
    precisely how far the words slide before any scroll becomes possible. Measured, 138px left-grip widen:
    440 → **+140** · 505 → **+75** · 560 → **+20** · 580/717/900 → **0**.
    **THE FIX SHAPE, and it is family -1's prescription applied literally:** stop trading, and find the
    formulation where the two quantities are not competing. The blank margin is spent out of the mat's own
    **gutter** first (`matSidePads`, lib/notesPageWidth.js), so the body's content-space position does not
    move at all and there is nothing for a scroll to hold — a clamp cannot lose what was never asked for.
    Only past the gutter does the scroll take over, and the mat's right padding is topped up by exactly the
    slack at that point, so the room always exists. `matPadX` itself is NOT written to (that variable is
    family -1's own named trap); only the mat's RENDERED padding derives from `sheetGrowLeft`.
    **THE GENERALISABLE QUESTION, worth asking of any VIEWPORT-STABLE compensation in this repo:** the
    mechanism holding the surface still — is it BOUNDED, and does anything check that it delivered? A
    scroll, a clamp, a `min`/`max`, a floored padding, a capped translate all are. If the answer is yes and
    nothing re-reads the achieved result, the compensation has a silent-failure band, and the fixture that
    would find it has to cross that band's edge (instrument trap 35). The vertical twin
    (`heightTopPadRef`'s scroll trick) has the identical shape and has not been audited for it.
    **AND THE HONEST NOTE ON THE TWO ROUNDS BEFORE THIS ONE:** B1740688 (the pad double-counted on commit)
    and B1775312 (two mechanisms both compensating, every frame) were each real, each correctly fixed, and
    each confirmed working — the owner said so himself about the second. Neither is a recurrence. **Three
    different defects, one feature, one symptom the user reports the same way every time.** When a symptom
    survives a fix the user agrees worked, look for the mechanism the previous one was MASKING, not for a
    mistake in the previous fix.

---

## 6 · Where the rest lives

- `src/workspaces/notes/CLAUDE.md` — the module pointer: every file, and the decision behind it.
  Auto-loads when you work in that folder.
- `CLAUDE.md` → **Engineering rules** — the named rules invoked by name in briefs.
- `ui-audit/` — the harnesses. The systematic one is `sweep-notes.mjs`; **a sweep that reports
  nothing is a failed sweep** and says so in its own output.

## 7 · The mat's gesture model, in one table (NEW-1/NEW-2, 2026-09-12)

Four meanings now compete for one press on the note canvas. The rule reads in this order, and the
ORDER is the point — distance first, so the placement path (broken four separate times, and guarded
by `verify-notes-anchor-soak`'s byte-identical property) is reached by exactly the presses it always
was, Shift or no Shift:

| the press | what it means |
|---|---|
| does not travel past `DRAG_SLOP` (4px) | **place** — arms the caret; the first character makes the note. Unchanged, and unchanged with Shift held too. |
| travels, no modifier | **pan** — the mat's own `scrollLeft`/`scrollTop`, one-to-one with the pointer |
| travels, Shift held | **select** — the rubber band; every box it touches, replacing the selection |
| starts on one of the four sheet edge grips | **resize the page** — the grip's `pointerdown` calls `preventDefault()`, which suppresses the compat `mousedown`, so `focusFromMat` never runs at all |

Pure decisions in `lib/notesMarquee.js` (`gestureOutcome`, `latchGesture`, `panTarget`), wiring in
`NoteEditor.jsx`'s `beginBlankGesture`, guard in `ui-audit/verify-notes-pan.mjs` at **1191×465,
which is his real window**. Two things that window changes and a taller one hides: the mat's own box
runs past the bottom of the viewport (measured 606 against 465), so ~140px of it is clipped and the
sheet's BOTTOM edge grip is unreachable until the mat is scrolled; and `elementsFromPoint` past the
viewport returns an **empty array** rather than erroring (trap 18).

**⛔ AND A STANDING PRE-EXISTING RED, recorded so it is not mistaken for a regression.**
`verify-notes-anchor-soak.mjs` fails **13 checks on untouched `origin/main`** (proven 2026-09-12 on a
separate `git worktree` checkout of `origin/main` — not `git stash`, per trap 17 — built and served
independently; head and base failure IDENTITIES diff to nothing). It is harness staleness of trap 22's
exact shape: the soak presses a GRID of points, many of which land on the white sheet, where two
later, deliberate features now route the press elsewhere (`onSheet` + beside a line → the caret,
B1368; `onSheet` + below the content → `focusEndOfSheet`, B1550976) instead of creating a block — so
"14 presses, 6 blocks" is the app being correct. A 14th check, *"A SECOND PRESS AT THE SAME SPOT TYPES
INTO IT"*, is separately **flaky on base and head alike** (the harness's own typed markers lose
characters — `FIRSTSECOND` came back as `FRSTSECOND`/`FSTSECOND`); it appears and disappears across
consecutive runs of the SAME build, so diff identities, never counts. Carried by **B1597762**.
