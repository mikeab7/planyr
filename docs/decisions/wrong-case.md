# Named rule WRONG-CASE

_Backstory moved verbatim out of `/CLAUDE.md` (audit batch H, 2026-11-23). Nothing below was reworded, shortened or removed: the rule in force is still stated in `/CLAUDE.md`, and this file is the full text and history behind it._

---

- **WRONG-CASE** — **WHEN A USER SAYS A FEATURE "NEVER WORKS" AND IT DEMONSTRABLY WORKS IN THE CASE YOU
  TESTED, YOU TESTED THE WRONG CASE. Go and find the case they are in. Do not close the loop on your own
  fixture.** (B548064–B548066, 2026-08-14, owner-instructed after the sixth report of one symptom.)
  1. **THE CASE IT COMES FROM, and the cost is the argument.** "Send to back / layers never work" was
     reported **six times** and "fixed" **four times** — B421, B820, B671, B293072/B293073 — and **every
     one of those fixes was correct**. All four tested MARKUP AGAINST MARKUP, which already worked before
     any of them. His case was a markup over a **BUILDING**: two markups share a band, so "back" moves
     within it and the picture changes, while a markup over a building is a question about the OTHER band
     — which the command could not address at all. It ran, changed nothing visible, and **greyed itself**,
     which reads as "already done".
  2. **THE VARIABLE IS NEVER THE COMMAND — IT IS WHAT THE COMMAND IS BEING ASKED ABOUT.** Before writing a
     fixture for a reported symptom, write down what is DIFFERENT about the reporter's scene: what is
     underneath, what is selected, what is on top, how many, how big, which band. A fixture built to make
     the mechanism observable is usually built to make that difference disappear.
  3. **A HARNESS FOR A REPORTED SYMPTOM CARRIES A PRECONDITION THAT REFUSES TO REPORT A SCORE** unless the
     reported configuration is really present. `verify-markup-over-building.mjs` asserts the markup is
     painted over the building AND that a point exists where the app's own hit stack holds both, and
     throws otherwise. Without that, a tidy fixture reports PASS on a dead implementation — which is
     precisely what happened four times. (Same shape as DRIVER-SCROLL-IS-NOT-APP-SCROLL §6's known-good
     arm: prove the instrument can see the thing before believing its verdict.)
  4. **AND THE PROCESS HALF, which is where this actually failed: A LIVE CHECK MUST STATE A CLOSURE
     CONDITION SOMEONE OTHER THAN THE OWNER CAN MEET.** V91632 said *"only he knows which objects he
     tried"* — not a blocker, a check nobody but him could close, so four sessions closed it on the case
     they could think of. A named `Blocker:` (`auth` / `real-data` / `live-GIS`) is the LEGITIMATE form:
     it names a configuration someone can obtain and leaves every step runnable. Deferring to what is in
     the owner's head names nothing. Every `V###` gets concrete steps with a **named expected result per
     step**. Guard: `test/verificationClosability.test.js`, whose mutation check flags V91632's real
     sentence verbatim and clears an honest `Blocker:` item.
  5. **RELATION TO THE NEIGHBOURING RULES, so this is not read as a duplicate.** ATTEMPT-BEFORE-YOU-PARK
     says a Claude-doable check may not be deferred; **STANDING RULE #2** says an owner-reported symptom
     may not be closed on a null. **Both were followed here** — V91632 was run, by the cohort, on his real
     plan, and it passed honestly. Neither asks *was the check pointed at the case that was reported?*
