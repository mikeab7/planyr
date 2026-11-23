# Working on Notes: read docs/NOTES-CARRY-FORWARD.md

_Backstory moved verbatim out of `/CLAUDE.md` (audit batch H, 2026-11-23). Nothing below was reworded, shortened or removed: the rule in force is still stated in `/CLAUDE.md`, and this file is the full text and history behind it._

---

**⛔ WORKING ON NOTES? READ `docs/NOTES-CARRY-FORWARD.md` FIRST — before the module pointer, before
the code.** It is the one file that makes starting a FRESH session on this module cheap: the eight
instrument traps that have each produced a confident FALSE finding about working code, the one
fixture that finds real bugs (simplifying it hides them — measured), the storage keys and the
standing SQL health check, the verification bar, and the three recurring bug families to suspect
first. **It exists because the alternative was tried and failed:** everything a fresh session
needed lived only in one long-running session's memory, so continuing always looked cheaper than
starting — until that session was re-reading ~500k tokens of history on every dispatch. A
carry-forward filed anywhere a session does not automatically read is the same mistake.
**When a new instrument trap or bug family turns up, it goes in that file in the SAME commit** —
never left in a session.
