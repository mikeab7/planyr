# The backlog is the single source for open bugs

_Backstory moved verbatim out of `/CLAUDE.md` (audit batch H, 2026-11-23). Nothing below was reworded, shortened or removed: the rule in force is still stated in `/CLAUDE.md`, and this file is the full text and history behind it._

---

**📋 The BACKLOG (`ledger/backlog/` on the `ledger` branch) = the single source of truth for open bugs & feature requests — KEEP IT LEAN.** Every run,
work the **🔲 Open** items (`npm run ledger -- list open --b`). **The moment an item ships, MOVE it that same
session: `npm run ledger -- move B<id> done`** (or `verify` for a `Verify: live` item) — never mark it done in place, and no PR is involved.
A new B# is assigned by `npm run ledger -- add backlog …` (see the LEDGER block).
(Product backlog; distinct from the "Deferred / maintenance backlog" near the end of this file.)
