# Three-state lifecycle

_Backstory moved verbatim out of `/CLAUDE.md` (audit batch H, 2026-11-23). Nothing below was reworded, shortened or removed: the rule in force is still stated in `/CLAUDE.md`, and this file is the full text and history behind it._

---

**⏳ THREE-STATE LIFECYCLE (B645): items move 🔲 Open → ⏳ Verify → ✅ Done, not straight to Done.** A
`Verify: sandbox` item (green build + the right unit/headless self-test proves it) goes straight to Done. A
**`Verify: live`** item — the **LIVE-VERIFY** classes: timing/race, concurrency / multi-writer, GIS endpoint
behavior, zoom-/data-density-dependent rendering, PDF/export parity, or a real-project-data repro — is
implemented this session but then **parks in the new `## ⏳ Verify` section** (with a matching `V###` in
`VERIFICATION.md`) until a live check confirms it; moving it straight to Done is a protocol violation. A
**recurring** report re-opens the ORIGINAL `B#` (`Recurrence:` line + `(×N)` in the title) — never a new
number (**DEDUPE-FIRST**). Every item carries a `Verify:` field and one or more `#tags` from the legend at
the top of `BACKLOG.md`.
