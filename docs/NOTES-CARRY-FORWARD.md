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

---

## 6 · Where the rest lives

- `src/workspaces/notes/CLAUDE.md` — the module pointer: every file, and the decision behind it.
  Auto-loads when you work in that folder.
- `CLAUDE.md` → **Engineering rules** — the named rules invoked by name in briefs.
- `ui-audit/` — the harnesses. The systematic one is `sweep-notes.mjs`; **a sweep that reports
  nothing is a failed sweep** and says so in its own output.
