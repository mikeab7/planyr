# A Cowork session records its own live verify

_Backstory moved verbatim out of `/CLAUDE.md` (audit batch H, 2026-11-23). Nothing below was reworded, shortened or removed: the rule in force is still stated in `/CLAUDE.md`, and this file is the full text and history behind it._

---

**⛔ STANDING RULE — A COWORK SESSION RECORDS ITS OWN LIVE VERIFY, DIRECTLY (owner decision, 2026-09-01:
"I'm okay with the chat writing to the repo … implement the new rule so you can write that yourself").**
When a Cowork session verifies something live — on Michael's own browser, against production — it
commits the result straight into the ledger (since 2026-11-05 the `ledger` BRANCH — see the LEDGER block for how a chat with a
shell, a chat with only the GitHub connector, and a chat with no push access each do it) itself, instead of
relaying it to a Claude Code session to type in. This **supersedes the inbox-then-drain path above for
new checks** — `verification-inbox/` (archived 2026-11-23 to `docs/history/verification-inbox/`, four stale August files) is history only. Claude Code still
owns every line of product code; this is recording, never building. **Why:** a session spun up purely
to transcribe one paragraph is the most expensive possible way to write it, and the hand-off fails
open — 79 completed live checks once piled up unrecorded because the courier didn't always get sent.
**Guardrails:** ledgers and docs only, never product code or a workflow file · never hand-edit a
script-generated, drift-checked file (`MAP.md`, `BACKLOG_OPEN.md`) · records go to the `ledger` branch, which has no
required checks and no bundle base to disturb (committing to `main` is for code/docs only, and never while
another session is mid-measurement against it — moving the base mid-flight caused the 2026-08-31 double revert) · the commit message names the Cowork session and the
`V#`/`B#` it closes · record only what was observed, never what a session reported.
