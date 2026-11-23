# Named rule TOMBSTONE-DELETES

_Backstory moved verbatim out of `/CLAUDE.md` (audit batch H, 2026-11-23). Nothing below was reworded, shortened or removed: the rule in force is still stated in `/CLAUDE.md`, and this file is the full text and history behind it._

---

- **TOMBSTONE-DELETES** — Every removal path records tombstones for its **FULL cascade set** before the
  next flush, so a merge / sync can't resurrect the deleted item (or raise a false "changed in another
  session" conflict). Applies to every delete handler, not just the obvious one. (B276 / B556 / B596 / B612.)
