# Owner product constraint #1

_Backstory moved verbatim out of `/CLAUDE.md` (audit batch H, 2026-11-23). Nothing below was reworded, shortened or removed: the rule in force is still stated in `/CLAUDE.md`, and this file is the full text and history behind it._

---

1. **(2026-09-05) Tasks do not need an owner.** Michael does not assign a responsible party to
   every task, and a high count of unassigned tasks is normal usage, not a defect. Never build a
   prompt, nag, required field, default value, or validation that pushes an owner onto a task,
   and never present an unassigned count as a number that should come down. Setting an owner
   only has to be reachable and round-trip correctly.
