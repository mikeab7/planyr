# Named rule LIVE-VERIFY

_Backstory moved verbatim out of `/CLAUDE.md` (audit batch H, 2026-11-23). Nothing below was reworded, shortened or removed: the rule in force is still stated in `/CLAUDE.md`, and this file is the full text and history behind it._

---

- **LIVE-VERIFY** — These classes can only be *confirmed* live, so they file `Verify: live` and park in
  `## ⏳ Verify` until seen working: timing / race bugs · concurrency / multi-writer · GIS endpoint
  behavior · zoom- or data-density-dependent rendering · PDF / export parity · anything whose repro
  cites real project data. Each class maps to ≥1 e2e harness spec (`e2e/`, B278/B280/B281) so the manual
  live gate shrinks over time.
