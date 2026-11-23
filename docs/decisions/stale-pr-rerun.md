# Re-running a failed build does nothing for a stale PR

_Backstory moved verbatim out of `/CLAUDE.md` (audit batch H, 2026-11-23). Nothing below was reworded, shortened or removed: the rule in force is still stated in `/CLAUDE.md`, and this file is the full text and history behind it._

---

**⛔ ONE MEASURED FACT THAT STILL APPLIES (B6867): RE-RUNNING A FAILED `build` DOES NOTHING FOR A PR THAT IS STALE AGAINST MAIN.** A
re-run replays the merge commit the run was created against — it does **not** recompute `refs/pull/<n>/merge` against main's tip.
A stuck PR needs a NEW PUSH — prefer `git fetch origin main && git merge origin/main` over an empty `Nudge CI` commit.
