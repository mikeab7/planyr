# Done folders are write-only

_Backstory moved verbatim out of `/CLAUDE.md` (audit batch H, 2026-11-23). Nothing below was reworded, shortened or removed: the rule in force is still stated in `/CLAUDE.md`, and this file is the full text and history behind it._

---

**📦 The `done` folders of the ledger (`ledger/backlog/done`, `ledger/verification/done`) are write-only archives — do NOT read them wholesale** unless looking
up a specific past item (`npm run ledger -- show B123`); the old `docs/archive/*-DONE.md` files no longer exist.
