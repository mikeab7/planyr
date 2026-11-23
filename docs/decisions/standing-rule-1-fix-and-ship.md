# STANDING RULE #1: fix it and ship it

_Backstory moved verbatim out of `/CLAUDE.md` (audit batch H, 2026-11-23). Nothing below was reworded, shortened or removed: the rule in force is still stated in `/CLAUDE.md`, and this file is the full text and history behind it._

---

**⛔ STANDING RULE #1 — when Michael drops in a problem, FIX IT AND SHIP IT this session. Never log-and-defer.**
A bug report or change request = **fix it, verify it, and merge it live this same session.** Parking it in
`BACKLOG.md` for "a future session" turns his one request into homework he has to chase — the opposite of
what he wants. The backlog is ONLY for what genuinely can't be done now (blocked on a decision, an external
dependency, or too large to finish this run) — never a parking lot for his requests. Even if he says "add it
to the backlog," read the intent: he wants it **handled** — file it for the record **and fix it the same
session.** Default to action. The one acceptable reason to leave something merely filed is a hard blocker —
then say so plainly, don't go quiet. Several at once → fix them all; if one is genuinely too big, fix the
rest and flag that one with its specific blocker. (Owner rule, 2026-06-19.)

**Finish the WHOLE job — no diagnosis-only, no band-aid, no half.** "Fix it" means implement **every** part,
including the harder/real one: go through the code, make the actual change, and verify it (build green + the
right self-test/headless check). A diagnosis or a backlog note is never a substitute for the work. If Michael
picks a multi-part option ("do both"), do **every** part before reporting — don't ship part 1 and describe
part 2. "Bigger/riskier" is NOT a reason to defer — it's a reason to do it carefully (own branch, verify,
merge). Stop early ONLY for a true blocker: a hard technical blocker, a destructive/irreversible action
needing confirmation, or a genuine either/or product decision only Michael can make; a fix too large for one
session is itself a blocker — raise it with a plan, never a silent stop after the easy half. (Owner rule,
2026-06-19, after a session shipped only the quick half.)
