# Named rule AUDIT-FIRST

_Backstory moved verbatim out of `/CLAUDE.md` (audit batch H, 2026-11-23). Nothing below was reworded, shortened or removed: the rule in force is still stated in `/CLAUDE.md`, and this file is the full text and history behind it._

---

- **AUDIT-FIRST** — Before patching, instrument and reconcile the prior `B#` claims against the ACTUAL
  code. Build understanding from what the code does now, not from what a comment / backlog note says it
  does. Where they disagree, record the code reality and **flag the discrepancy**. (Stops you "fixing" a
  bug a prior B# already fixed, or trusting a stale claim.)
