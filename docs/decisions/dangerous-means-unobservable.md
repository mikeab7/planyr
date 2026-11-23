# Named rule DANGEROUS-MEANS-UNOBSERVABLE

_Backstory moved verbatim out of `/CLAUDE.md` (audit batch H, 2026-11-23). Nothing below was reworded, shortened or removed: the rule in force is still stated in `/CLAUDE.md`, and this file is the full text and history behind it._

---

- **DANGEROUS-MEANS-UNOBSERVABLE** — **When work is called DANGEROUS, NAME WHAT IS MISSING that makes it so.
  If the answer is "nothing can observe whether it is correct", that gap is itself a DEFECT — and it is
  usually the more valuable thing to fix.** (Owner rule, 2026-08-08, verbatim: *"I'm not really worried about
  any path just because one is dangerous. I don't know that that's a good reason. If it is dangerous, then,
  like, we should probably be fixing it in the first place because why is it dangerous?"* He was right and he
  overruled the framing.)
  **THE CASE IT COMES FROM.** B1449 (smooth zoom) was called too dangerous to ship for weeks, and the stated
  reason was that at rest `renderView.ppf === view.ppf`, so a correct implementation and a broken one produce
  IDENTICAL output in every existing test, e2e spec and pixel harness. **That is not a property of the
  refactor — it is a hole in the harness.** The repo could not observe MID-GESTURE rendering at all, and that
  hole bites every future interaction change, not just that one. So "it is dangerous" was never a reason to
  avoid the work; it was a reason to **build the missing instrument first**, which was already step 1 of the
  plan and is worth having on its own merits.
  **HOW TO APPLY IT, three steps:** (a) write down the specific observation the guards cannot make — not
  "this is risky" but *"no check in this repo can distinguish X from Y"*; (b) build that instrument and
  **prove it goes RED on a deliberately wrong build** (a guard nobody has seen fail is a guard that rots
  green — VIEW-INDEPENDENT-ONCE §6 names the same failure mode); (c) then do the work. If the instrument
  cannot be built, THAT is the honest blocker to report — never the vague "dangerous".
  **Do not confuse this with genuine caution.** Irreversible/destructive actions and real product decisions
  still stop for the owner. This rule is about ENGINEERING risk that is really an observability gap.
