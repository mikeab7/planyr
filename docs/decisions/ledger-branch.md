# The ledger lives on its own git branch

_Backstory moved verbatim out of `/CLAUDE.md` (audit batch H, 2026-11-23). Nothing below was reworded, shortened or removed: the rule in force is still stated in `/CLAUDE.md`, and this file is the full text and history behind it._

---

**🧾 THE LEDGER LIVES ON ITS OWN GIT BRANCH, `ledger` — RECORDS NEED NO PULL REQUEST AND NO BUILD (NEW-1, owner
decision 2026-11-05). This section overrides every older sentence in this file or in `docs/` that says to file,
edit, move or mint a `B#`/`V#` in a PR, to append to `BACKLOG.md`/`VERIFICATION.md`, or to use the `docs/archive/*-DONE.md`
files (which no longer exist). NO SESSION OPENS A LEDGER-ONLY PR AGAIN.**
**WHY:** after every live check a session opened a ledger-only PR and waited a full build — burning session and watcher
tokens and delaying the close of a task — for a change that cannot break anything. Product code, workflows and this file
stay on `main` behind the required `build` exactly as before; this changes WHERE records live, not WHAT is recorded.
**MEASURED before it was built (2026-11-05, this environment):** a plain `git push` of a non-`claude/` branch lands; the only
ruleset ("Protect Main") includes just `~DEFAULT_BRANCH`, so `ledger` is unprotected; a second fresh clone fetched and pushed
it; a stale clone's push was refused "fetch first" and landed after fetch+retry; **two sessions racing the same instant on
the real remote both landed with different ids.** (The sandbox proxy lets you create/push branches but NOT delete them.)
- **Layout (unchanged, just elsewhere):** ONE file per entry — `ledger/backlog/<open|bug-audit|verify|later|done>/B<id>.md`,
  `ledger/verification/<pending|checklist|done>/V<id>.md`, each exactly the old `### B<id> — title …` block, plus
  `ledger/<kind>/_frame.md` (the prose, legend and section markers). The branch is parented on main's history, so
  `git log -- ledger/backlog/done/B123.md` shows an entry's FULL history. **`main` has no `ledger/`, no `BACKLOG.md`, no
  `VERIFICATION.md`** (both are gitignored local views: `npm run ledger -- render`). `.github/ledger-branch.json` on main is the
  marker that tells the tools (`isBranchMode`, `scripts/lib/ledger.mjs`) the ledger is on a branch. **Never delete an entry.**
- **READ — cold start, ONE command:** `npm run ledger -- list open` (every Open + Verify heading; ~3 s on the full ledger).
  It checks the branch out (shallow) into `.ledger/` — gitignored; never commit it, never hand-edit and force-push — and
  re-fetches when the copy is over 10 minutes old (`--fresh` forces it). Also: `list verify|pending|done [--b|--v]`,
  `show B123`, `status`. **Grep `^### B` in `.ledger/ledger/backlog/open` / `…/verify`, or read `BACKLOG_OPEN.md` on main
  (a nightly-refreshed index; may lag a day — the branch is the truth).** The `done` folders are write-only: look up ONE id
  (`show B123`), never read a folder wholesale. **⛔ Never slurp a whole tracking folder to find one thing.**
- **WRITE — straight to the branch, no PR (each command fetches, writes, commits, pushes; a lost race is REDONE from the new tip):**
  `npm run ledger -- add backlog --file entry.md` (or `--stdin`; heading `### B? — title` or `### NEW-1 — title`; add
  `--state verify|…`) · `add verification --file …` · `put B123 --file …` (replace text) · `move B123 verify|done|open …
  [--file new-text.md]` (a rename; edit the text in the same step) · `mint --b 1 --v 1` (reserve ids as stub entries when you must
  cite a number before the entry is written) · `inbox` · `push -m "…"` (land hand-edits you made inside `.ledger/`). Output is the
  assigned id; commit-message-style `-m` is optional.
- **IDS ARE MINTED BY THE PUSH ITSELF.** `add` computes `max+1` from the tip it just fetched and the push is the
  compare-and-swap: if another session landed first, the push is refused, the whole write is redone from the new tip and the
  id recomputed — so two sessions on two containers can never hold the same id. **The old rules are RETIRED: reserved blocks
  by branch name, `--against-main`/peer scans, late-binding the number, `check-mint` (deleted 2026-11-23), the `BELOW`/`TAKEN`
  verdicts.** `npm run next-id` is advisory only (it prints the ledger branch's next free numbers). Keep the provisional `NEW-#`
  label in code and tests as before; **cite the real id in the PR title/commit once `ledger add` has printed it, and file
  the entry no later than the moment you open the PR** (the record check below will name a merged id with no record).
- **LIFECYCLE is unchanged** (🔲 Open → ⏳ Verify → ✅ Done; `Verify: live` items park in `verify` with a `V###`; a recurrence
  re-opens the original `B#`; DEDUPE-FIRST) — only the mechanism: `npm run ledger -- move B<id> <state>` instead of a block move
  inside a PR. The record is finished the moment `ledger` has it; **you do not wait for a build to close a task.**
- **A CHAT RECORDS ITS OWN LIVE VERIFY DIRECTLY (the 2026-09-01 rule, now pointed at the branch).** A Cowork/claude.ai chat
  with a shell runs the commands above. A chat with only the GitHub connector commits straight to branch `ledger`
  (`create_or_update_file` / `push_files` with `branch: "ledger"`): to update or move an EXISTING entry, write its new text at
  the new path and delete the old path (one commit via `push_files` where possible); to file a NEW entry, create
  `ledger/inbox/backlog-<slug>.md` or `ledger/inbox/verification-<slug>.md` (a free-form name can never collide — the next
  session that writes the ledger, or `npm run ledger -- inbox`, gives it its real id and files it; a first line `state: done`
  picks a non-default state). **A chat with NO push access at all hands the entry text to a Claude Code session in the dispatch brief, which
  files it with `ledger add`.** Never to `main`; the commit message names the chat and the `V#`/`B#` it closes; record only what was observed.
- **STRAGGLERS:** a PR opened before the move may still edit `ledger/` on main. The touch guard LETS IT MERGE (failing it would
  strand its records) and `.github/workflows/ledger-forward.yml` copies those edits onto the branch (adds, edits, moves; a
  colliding new id is renumbered and reported; a diverged edit is reported, never overwritten; a bare deletion is never
  forwarded). A straggler that conflicts with main's deletion of `ledger/` is resolved by dropping its `ledger/` files and re-filing
  them with the commands above (`npm run ledger -- import-delta <base> <tip>` replays a branch's `ledger/` edits for you).
- **WHAT REPLACED "the fix and its record merge together":** `.github/workflows/ledger-record-check.yml` (every push to main + nightly)
  reads merged commit subjects and WARNS about any `B#`/`V#` they cite that has no entry on the branch
  (`npm run ledger -- record-check --since "3 days ago"` locally). It never blocks a merge. **A record check warning is an
  instruction: file the record.**
- **DATA CHECKS moved off the required build** (a bad record must never fail an unrelated code PR): `ledger check`, the tag-legend
  guard, the verification-queue ceiling and the id-uniqueness / conflict-marker / closability tests run in
  `.github/workflows/ledger-health.yml` (scheduled; red = go look at the ledger) and on demand with `npm run test:ledger`.
  `ledger add|put|move` themselves refuse an entry whose heading disagrees with its filename or whose path is invalid.
- **Acceptance tests:** `test/ledgerBranch.test.js` (two parallel writers both land with unique ids — real child processes AND a
  deterministic lost race; red-proofed by disabling the retry), `test/ledgerBranchMode.test.js`. Code: `scripts/lib/ledgerBranch.mjs`
  (transactions, retry, inbox, import), `scripts/lib/ledger.mjs` (`ledgerRoot` — the one seam every reader goes through).
  Never reintroduce a shared append point on `main`.
