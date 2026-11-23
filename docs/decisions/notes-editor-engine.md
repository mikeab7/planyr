# Notes editor engine, Tiptap, paste pipeline

_Backstory moved verbatim out of `/CLAUDE.md` (audit batch H, 2026-11-23). Nothing below was reworded, shortened or removed: the rule in force is still stated in `/CLAUDE.md`, and this file is the full text and history behind it._

---

**Touching the Notes editor ENGINE, its Tiptap version, or the paste pipeline (owner decision 2026-11-05, B2671191 — the BlockNote
swap is REJECTED, Notes stays on Tiptap)? READ `docs/notes-editor.md` FIRST** — the closing decision, the free-OSS-only rule (no Tiptap
Pro/Cloud), how to upgrade the `@tiptap/*` set (one exact version, 3.33.0), the audit of every Planyr-owned editor piece vs upstream,
and the **clipboard regression bank** (`ui-audit/verify-notes-paste-bank.mjs`, a required build step): a paste bug becomes a fixture
in `test/fixtures/clipboard-bank/` first, red, then a fix.
