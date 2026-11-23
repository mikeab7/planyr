# STANDING RULE #3: one task per session, cost per task

_Backstory moved verbatim out of `/CLAUDE.md` (audit batch H, 2026-11-23). Nothing below was reworded, shortened or removed: the rule in force is still stated in `/CLAUDE.md`, and this file is the full text and history behind it._

---

**⛔ STANDING RULE #3 — ONE TASK PER SESSION; COST PER TASK, NOT MODEL TIER (owner rule, 2026-08-15, after a
review found unrelated work being grafted onto long-running sessions because a container happened to be
warm).** **WHY, stated plainly:** every turn re-sends the whole accumulated conversation, so a long session
pays for its entire history on every subsequent tool call. Unrelated work grafted onto it is therefore
charged at the long session's context price while sharing none of its context — pure waste, and it's the
dispatcher's doing, not the session's.
**(A) ONE TASK PER SESSION.** A session takes one item, ships it, and stops (clause B). If new work
arrives that doesn't depend on what this session has already learned, do **not** accept it — say so plainly
and tell the dispatcher to open a new session. **THE TEST, verbatim: would a fresh session have to
REDISCOVER something this session already knows?** If yes — it built a fixture, a harness, a reproduction,
a measurement rig the new work needs — continuing is correct and cheaper. If no, it is a new session. A
warm container is NOT a reason. Convenience is never a reason.
**(B) STOP WHEN DONE.** Don't idle on new work once the PR merges and the follow-ups are filed — an open
session invites exactly the grafting (A) forbids. **ARCHIVING IS NOT YOURS.** A Claude Code session cannot
archive any claude.ai/code session, itself included — no tool reaches the sidebar. Never write that you
archived, will archive, or that the session "can now be archived", and never ask Michael to archive. End at
merged + verified; the dispatching chat archives. (This is STANDING RULE #2's never-park discipline turned
on the session itself; it doesn't restate that rule, it cross-references it.)
**(C) MODEL SELECTION — Sonnet is the default.** Use Sonnet for implementation work: a well-specified item
with a known defect and a stated expected result. Reserve Opus for a root-cause hunt that has **already
defeated one attempt**, or where the session must reconcile contradictory evidence rather than execute a
plan. Worked example: the B1121 memory hunt earned Opus because it had to reconcile the owner's own
recording against its own harness and catch its instrument lying twice; a parcel-naming fix, an aerial
reword, and a layering fix did not, because each had a measured defect and a stated expected result.
**(D) THE BRIEF IS THE CHEAPEST PART.** Everything already measured belongs in the brief, including the
approaches already ruled out and WHY. A few hundred tokens of specification routinely saves a session from
rediscovering a dead end at full price. A brief that says what to do without saying what has already been
tried is an incomplete brief.
