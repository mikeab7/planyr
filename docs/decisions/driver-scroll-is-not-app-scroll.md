# Named rule DRIVER-SCROLL-IS-NOT-APP-SCROLL

_Backstory moved verbatim out of `/CLAUDE.md` (audit batch H, 2026-11-23). Nothing below was reworded, shortened or removed: the rule in force is still stated in `/CLAUDE.md`, and this file is the full text and history behind it._

---

- **DRIVER-SCROLL-IS-NOT-APP-SCROLL** — **AN AUTOMATION TOOL THAT SCROLLS TO REACH AN OFF-SCREEN TARGET
  CANNOT BE USED TO MEASURE SCROLL BEHAVIOUR. In a VIRTUALISED list, "the first rendered row" is NOT
  "a row on screen."** (B463922, 2026-08-13 — the sixth instrument failure of the day, and the first
  that survived long enough to be reported to the owner as a finding about his product.)
  1. **THE CASE.** `diagnose-grid-view-anchor.mjs` clicked the fold triangle on the FIRST RENDERED row
     of the scheduler grid. A virtualiser renders a buffer of rows ABOVE the viewport, so that toggle
     sat 75 px off screen; Playwright — like every browser driver — scrolls a target into view before
     clicking it, **through CDP, where a patched `scrollTop` setter cannot see it.** The harness then
     reported its own scroll as the app throwing the edited row 477 px down the screen and out of view.
  2. **⛔ "PROGRAMMATIC SCROLL WRITES: 0" IS THE TELL, NOT THE CORROBORATION.** That reading was taken
     as proof the app was innocent of *causing* the scroll, and used to argue the row was "abandoned".
     It actually meant the scroll came from OUTSIDE the page's JavaScript entirely. Whenever a
     container moves with no app write, the first two suspects are **the driver** and **the browser** —
     not a subtle app defect.
  3. **THE DISCRIMINATOR IS ONE LINE: drive the same control from inside the page.** `.click()` in page
     JS performs no actionability scroll. Same toggle, same build: driver click **+477 px**, page-JS
     click **−24 px**, a click on a toggle genuinely inside the viewport **−48 px** — and a target
     BELOW the viewport moved it the other way (+459). **Magnitude and sign follow where the target
     sat**, which is the driver's signature.
  4. **THE RULE.** Inside a scroll container, click only what a human could actually see. Enforced by
     `ui-audit/lib/visibleClick.mjs`: `visibleClick` proves the target is inside the container's
     viewport BEFORE clicking and THROWS if it is not, naming how far outside it sat;
     `installScrollWitness` + `assertNoDriverScroll` catch the same lie from the other side (the
     container moved during an action with no app write → the measurement is void). Pure verdict
     unit-tested in `test/visibleClick.test.js`; the refusal path is re-proved against the real app on
     every run of `ui-audit/verify-grid-row-hold.mjs`, aimed at the very toggle that produced the false
     finding — a guard nobody has seen fail is not a guard.
  5. **IT WILL BITE AGAIN ON ANY VIRTUALISED LIST** — the scheduler grid, the Gantt, the Library file
     list, any future long table. It is not specific to scrolling either: a driver's actionability
     scroll changes what is on screen, so ANY geometry read taken across it is suspect. Sibling of
     FOREGROUND-OR-VOID (a background tab cannot be measured) and SYNTHETIC-KEYS-DONT-EDIT (a
     synthetic keystroke does not mutate the plan): three ways for a harness to believe its own
     instrument.
  6. **⛔ AND THE FOURTH WAY, WHICH IS THIS RULE ONE STEP FURTHER: THE HARNESS'S OWN *QUERY* PRODUCED
     THE READING. POINT A PROBE AT A CASE WHOSE ANSWER IS ALREADY KNOWN, AND REQUIRE IT TO REPORT THAT
     KNOWN ANSWER, BEFORE TRUSTING IT ON THE UNKNOWN CASE.** (B532112, 2026-08-14, owner-adopted.)
     Clauses 1–5 are *the harness's own ACTION* changed what it then measured; this is *the harness's
     own QUESTION* was never about the thing it claims. Same species, same remedy shape as clause 3 —
     ask a second, known way and compare the two answers.
     - **⛔ WHY THIS REPO DID NOT ALREADY HAVE IT, and it is the sharpest part: EVERY DISCIPLINE HERE
       PROVES A GUARD CAN GO *RED* ON KNOWN-BROKEN CODE, AND NOTHING FORCES A PROBE TO GO *GREEN* ON
       KNOWN-GOOD CODE.** The teeth proof (NO-ONE-OWNS-A-COMPOSITE), the mutation check,
       `mintGateE2E`'s rejection path, VIEW-INDEPENDENT-ONCE §6's never-OBSERVED failure — all of them
       guard the red side. **That asymmetry is not incidental: it is exactly why both failures below
       landed on the unguarded side**, each reporting a defect in code that was correct.
     - **THE TWO CASES**, from one session's aerial-backdrop diagnostic: a page-wide
       `document.querySelectorAll('label input[type=range]')` swept in a slider belonging to a
       DIFFERENT panel and reported the row as carrying a control it does not have; and a control that
       only renders once its row is SELECTED was read COLLAPSED, reporting a working row broken. A
       third the same day is the same species one level up — a position check compared the empty state
       against the OCCUPIED one and reported those two branches' *intended* difference as a regression.
     - **WHAT CAUGHT ALL THREE was a known-good arm sitting beside the unknown ones** — it stayed green
       while the others failed, which is what localised each fault to the probe rather than to the app.
       **It was there by luck of the question's shape, not by rule.** That is what this clause fixes.
     - **THE CHECKABLE FORM, because a caution rots and a check does not:** a harness asserting a
       property must carry **at least one arm whose expected value is known INDEPENDENTLY of the code
       under test**, and must FAIL if that arm does not report its known value. **A run that exercises
       only the unknown arms is VACUOUS and must say so rather than print a score.** The vocabulary
       already exists — `MUST_BE_PRESENT` in `count-pond-invocations`, the vacuity guards in
       `verify-hidden-content-behaviour` — this makes it the default rather than a per-harness habit.
     - Scope every query to the element under test, and put a surface into the state the assertion is
       about before measuring it. (The two precedent harnesses this clause originally cited,
       `verify-aerial-empty-state-copy.mjs` and `diagnose-aerial-backdrop-row.mjs`, were retired with
       the UI/data model they guarded — B848736 folded the standalone aerial card into the unified
       References list, so both a distinct empty-state heading and a distinct `underlay` field to seed
       stopped existing.)
