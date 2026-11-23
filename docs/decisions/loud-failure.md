# Named rule LOUD-FAILURE

_Backstory moved verbatim out of `/CLAUDE.md` (audit batch H, 2026-11-23). Nothing below was reworded, shortened or removed: the rule in force is still stated in `/CLAUDE.md`, and this file is the full text and history behind it._

---

- **LOUD-FAILURE** — No silent failure path. Every write / fetch / parse that can fail must surface the
  failure visibly (a banner, a telemetry event, a thrown error) — never a silent no-op or a swallowed
  `catch` that reads as success. When in doubt, crash loudly over degrading quietly. (The B209 / B595 /
  B610 class: a "saved ✓" that didn't save is exactly the bug this rule exists to prevent.)
