# Owner product constraint #5

_Backstory moved verbatim out of `/CLAUDE.md` (audit batch H, 2026-11-23). Nothing below was reworded, shortened or removed: the rule in force is still stated in `/CLAUDE.md`, and this file is the full text and history behind it._

---

5. **(2026-09-05) Project creation is deliberately LAZY.** Never create a `sites` row for every
   abandoned "New project" click — the row is materialized only by a module's first real write.
   (See B1160480, B1202176.)
