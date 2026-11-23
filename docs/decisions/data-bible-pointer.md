# Touching persistence, sync, undo or delete: read docs/DATA.md

_Backstory moved verbatim out of `/CLAUDE.md` (audit batch H, 2026-11-23). Nothing below was reworded, shortened or removed: the rule in force is still stated in `/CLAUDE.md`, and this file is the full text and history behind it._

---

**⛔ TOUCHING PERSISTENCE, SYNC, UNDO, OR DELETE? READ `docs/DATA.md` FIRST.** It is the single
place that answers who owns a fact and how it may change — the entity table, the numbered
invariants (each with the test that proves it), the short list of "one-answer" functions
(`isOwnWrite`, `assemblyIntegrity`, `nameAuthority`, …) that must never grow a second
implementation, and why. Written 2026-09-01 after a multi-round false-conflict/data-ownership bug
family; §7 of that file names exactly what was already fixed by prior sessions so it is not
re-diagnosed a ninth time.
