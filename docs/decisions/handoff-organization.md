# How the handoff is organised

_Backstory moved verbatim out of `/CLAUDE.md` (audit batch H, 2026-11-23). Nothing below was reworded, shortened or removed: the rule in force is still stated in `/CLAUDE.md`, and this file is the full text and history behind it._

---

**🗂 How this handoff is organized (keep it token-lean — owner rule, 2026-07-02).**
`CLAUDE.md` holds only what EVERY session needs to orient: the standing rules, how to
talk to Michael, the architecture spine, the KEY DECISIONS, and the workflow. The bulky
reference material moved to on-demand docs — **read one only when the task touches it:**
- **`docs/SHIPPED.md`** — the full catalog of shipped-and-verified features (history).
- **`docs/ROADMAP.md`** — what's not built yet (read when planning new work).
- **`docs/REFERENCE.md`** — deep implementation detail (Site Model schema, layer/GIS
  plumbing, Supabase DDL/RLS, persistence internals, the sandbox Playwright quirk).
- **`docs/VERIFICATION-TRIAGE-2026-11-11.md`** (+ `.json`) — the 2026-11-11 sort of every pending `V#` into A (a session can do it: harness named) / B (only Michael: deduplicated sittings) / C (dead paper). **Start here when working the pending verification queue**; re-read each item's live text first — it is a snapshot.
- **`docs/ACTIVE-AREAS.md`** — the weekly "where people are working" sweep's ledger: one section per `sites.county` key (counts + parcels/tax/zoning/water/site-killers checklist + open `B#`s), REPLACED each sweep. Read it when choosing which county to harden next.
- **`docs/DATA.md`** — the data bible: entity ownership, invariants, one-answer functions,
  causal units, the failure contract, the destructive-action contract (read below).
- **`docs/AGENT-RULES.md`** — the verification, measurement, and merge rules already paid for
  by real incidents on this repo (a false bug filed, a working feature reported broken, a
  wrong number written into the backlog, a gate quietly weakened to go green). **Must be read
  before judging whether any change works.**
