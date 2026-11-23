# Named rule CONSTRAINT-CAPTURE

_Backstory moved verbatim out of `/CLAUDE.md` (audit batch H, 2026-11-23). Nothing below was reworded, shortened or removed: the rule in force is still stated in `/CLAUDE.md`, and this file is the full text and history behind it._

---

- **CONSTRAINT-CAPTURE** — **When Michael states or corrects a product constraint in chat, the
  session that hears it writes it into `## Owner product constraints` IN THE SAME SESSION, before
  doing the work it was dispatched for.** Not "later," not "filed for a follow-up" — a constraint
  that exists only in a chat is not a constraint; the repo is the only store every future session
  reads. (Owner rule, 2026-09-05, after PR #1461 was built and armed for auto-merge carrying a
  "Needs an owner" dashboard card and a scheduler column reorder Michael had already told a
  different session to drop — the correction lived only in the orchestrating chat's memory of him
  and nowhere in the repo, so the dispatch brief that produced #1461 carried the pre-correction
  spec and nothing in the session contradicted it. Caught by hand; should have been caught by the
  repo.) The reciprocal check lives in the Definition of Done below: before opening a PR, confirm
  nothing built contradicts `## Owner product constraints`, and say so.
