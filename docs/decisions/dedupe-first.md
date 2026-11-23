# Named rule DEDUPE-FIRST

_Backstory moved verbatim out of `/CLAUDE.md` (audit batch H, 2026-11-23). Nothing below was reworded, shortened or removed: the rule in force is still stated in `/CLAUDE.md`, and this file is the full text and history behind it._

---

- **DEDUPE-FIRST** — Search **Open, ⏳ Verify, AND Done** (`^### B` headings + `#tags` + symbols; grep
  `BACKLOG_OPEN.md` for the live set) before minting a `B#`. A matching prior item gets the recurrence
  treatment (back to Open, `Recurrence:` line, `(×N)` title) — never a fresh number. When you DO mint,
  get the number from **`npm run next-id`** (B755) — never grep the archives for the max.
