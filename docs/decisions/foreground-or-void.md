# Named rule FOREGROUND-OR-VOID

_Backstory moved verbatim out of `/CLAUDE.md` (audit batch H, 2026-11-23). Nothing below was reworded, shortened or removed: the rule in force is still stated in `/CLAUDE.md`, and this file is the full text and history behind it._

---

- **FOREGROUND-OR-VOID** — **A BACKGROUND TAB CANNOT BE MEASURED: NOT ITS CLOCK, AND NOT ITS PIXELS.
  A browser-driving harness MUST assert `document.visibilityState === "visible"` BEFORE it measures
  ANYTHING — time or geometry — and FAIL LOUDLY if it is not.** (Owner rule, 2026-08-09, filed with
  both measurements that produced it. **ONE precondition rather than two rules, deliberately: one
  cause produces both failures, and a harness must not be able to satisfy it by halves.**)
  0. **⛔ CLAUSE 2 — GEOMETRY, AND IT IS THE MORE DANGEROUS OF THE TWO. Any DOM measurement taken
     after a VIEW CHANGE on a background tab is void, because rAF is SUSPENDED and the drawing never
     repaints.** Measured on the owner's live tab at `visibilityState === "hidden"`: `requestAnimation
     Frame` **did not fire once** when raced against a MessageChannel loop for two full seconds. A CDP
     wheel then updated the app's STATE correctly — `data-view-ppf` and `data-render-ppf` both
     0.0501 → 0.1062, a clean 2× zoom in — while the pond's DOM geometry **did not move at all**:
     centre (892.9, 248), width 143.4 px, identical to three wheel gestures earlier, to one decimal
     place. **A throttled timer gives you a wrong NUMBER; a suspended rAF gives you a wrong PICTURE
     THAT IS INTERNALLY CONSISTENT** — boxes, positions, sizes and hit tests all agree with each other
     and all describe a view the app already left, and the app's own state attributes will confirm the
     view you asked for. Anything built on `elementFromPoint`, `getBoundingClientRect` or a screenshot
     inherits it silently. **It cost a false lead before it was caught:** an apparent anchored-zoom
     defect (a wheel-out at pointer x=900 leaving the drawing at x=104, moving AWAY from the pointer)
     was flagged against **B1449 / B258992 / V56000** and is **REFUTED — a stale frame, not a broken
     anchor. The anchored-zoom work is not implicated; do not re-open it on that evidence.**
     **THE rAF LIVENESS PROBE IS PART OF THE ASSERTION, not an extra:** race one rAF against a
     MessageChannel loop, because it catches the case `visibilityState` cannot — a tab that claims to
     be visible while its frame loop is wedged anyway.
  1. **CLAUSE 1 — TIMING.** A probe of one double-click gesture on the owner's real plan reported **3,156 ms and
     2,992 ms**. The tab was `document.visibilityState === "hidden"` throughout (it was being driven
     from another tab) and the harness paced itself with `setTimeout`, which Chrome CLAMPS in a hidden
     tab. It was timing the clamp. **The control — same gesture, same build, same tab, same hidden
     state, ONLY the pacing primitive changed to a MessageChannel yield: 138–182 ms** end to end, 13–63
     ms of synchronous handler time. Four elements measured honestly: 111 / 138 / 154 / 182 ms. There
     was never a multi-second interaction cost to chase.
  2. **WHY IT IS A GUARD AND NOT A NOTE.** This trap's FIRST appearance produced an obvious failure and
     cost one round of probing. This one produced a **plausible number** — self-consistent, repeatable,
     in the right units, off by a factor of twenty — that reached the owner and was on its way onto two
     perf backlog items. A wrong number that looks right is strictly more dangerous than a crash, and
     nothing downstream can tell them apart, so the check belongs at the source.
  3. **MACHINE-ENFORCED, because a rule nobody's code consults is not a guard.**
     `ui-audit/lib/tabTiming.mjs` — **`assertMeasurable(page, harness)`** is the one precondition
     (visibility THEN rAF liveness, both throwing and both named), plus `pacedWait` (a MessageChannel
     loop; unthrottled, and the drop-in for a `waitForTimeout` INSIDE a timed section) and
     `timingProvenance`. **Wired into ALL 347 ui-audit harnesses that drive a browser — universal, not
     a list.** The first version named the 28 that read a clock; clause 2 swept in nearly all the rest
     for a real reason rather than a loose heuristic — almost every harness here clicks "Zoom to fit"
     and then measures a bounding box, which is exactly the pattern that returns a stale frame. So
     `test/tabTiming.test.js` requires it of every harness that launches Chromium, and requires the
     call to NAME itself so a failure says which run is void. **There is no list left to rot, and a new
     harness cannot be written without it.**
  4. **An "unreadable" visibility state is refused too** — a harness that cannot check cannot vouch.
  5. **⛔ AND AN INSTRUMENT BUILT TO ANSWER "WHY DID IT FAIL ON HIS MACHINE" HAS TO BE ARMABLE ON HIS
     MACHINE (B280403).** A read-only diagnostic hook shipped gated on `window.__PLANYR_E2E` — read
     ONCE AT MOUNT by an effect with `[]` deps — so it was unreachable on the owner's signed-in
     production tab, which is the only place the defect it was built for exists. The session that
     needed it armed the flag by hand and forced a remount by switching plans and back; that is
     folklore, not a feature. **Rule: gate a diagnostic at CALL time, never at mount, and give it a
     way in that needs no console — `?planyrDiag=1` (latched into `sessionStorage`, so an in-app
     navigation does not disarm it mid-diagnosis) or the session key.** The boundary that makes this
     safe and must not be widened: arming exposes READ-ONLY answers, writes nothing, changes no
     behaviour, and is session-scoped. It is not a debug mode and may never gate anything that
     mutates. (`lib/diagArm.js`; guards in `test/diagArm.test.js`.)
  6. **⛔ AND ITS SIBLING: A PROBE THAT OBSERVES THE MIDDLE OF A GESTURE HAS CHANGED THE GESTURE.**
     A reading taken BETWEEN the two presses of a double-click costs hundreds of ms and pushes the
     pair past `DBLTAP_MS` — at which point it is two clicks, not a double-click, and it will
     "reproduce" failures that mean nothing. Measured: a 900 ms read between presses manufactured
     exactly such a failure and nearly became a bug report. **So a harness either takes its reading
     only at the END of the gesture, or it MEASURES the press-to-press interval from the events' own
     `timeStamp`s and asserts it is inside the budget** — never assumes it. The deliberate exception
     is the TWO-PRESS INVARIANT, which is a single press followed by a question and does not claim to
     be a double-click. `audit-doubleclick-properties` now measures and asserts its own gap, and that
     assertion caught a defect in ITSELF on its first run (it was timing deselect→press-1, not
     press-1→press-2), which is the argument for measuring rather than assuming in one line.
