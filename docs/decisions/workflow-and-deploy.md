# Workflow and deploy (full history)

_Backstory moved verbatim out of `/CLAUDE.md` (audit batch H, 2026-11-23). Nothing below was reworded, shortened or removed: the rule in force is still stated in `/CLAUDE.md`, and this file is the full text and history behind it._

---

## Workflow & deploy
- **Branch per workstream; `main` is the protected, always-working, deployed line.
  No direct commits to `main` from here on.**
- Branch naming: `doc-review/<feature>`, `site-planner/<feature>`. Branch from the
  latest `main`; merge the latest `main` back into long-lived branches as you go.
- **Merge often** — the longer a branch drifts, the larger the eventual merge
  conflict. Per-workspace work in separate folders rarely conflicts; keep edits to
  genuinely shared files (the coordinate module, the shell) small.
- **Land work via pull requests; require a passing build check to merge.** The GitHub
  Actions workflow runs the build on every PR (a green "it builds" check) and on
  pushes to `main`; the deploy job is gated to `main` only.
- **"Commit" means take it LIVE — the whole chain, no stopping, no asking.** When the
  owner says "commit" (or "ship it", "make it live"), do _all_ of: stage → `git commit`
  → push the branch → open the PR into `main` → merge it (enable auto-merge if a check
  must go green first). Merging to `main` is what ships it. Do **not** stop at a local
  commit, and do **not** ask "want me to open the PR?" — opening and merging the PR is
  part of what "commit" already authorized. The only acceptable stop short of live is a
  hard blocker (merge conflict, red required check, protection that rejects the merge) —
  report _that_, not a request for permission.
- **⛔ THE CLAUDE CODE WEB SESSION HARNESS DEFAULTS EVERY NEW PR TO DRAFT — THAT DEFAULT DOES
  NOT APPLY HERE, AND THE SESSION THAT OPENS THE PR IS THE ONE THAT MARKS IT READY, EVERY TIME,
  BY HAND (B781760 → B793696 → B914448/B914449 → B934400/B934401, 2026-08-26 through
  2026-08-31).** The harness instruction to open PRs as draft lives outside this repo — not in
  `CLAUDE.md`, not in any file here, not editable from a session — so a session that reads only
  "commit means ship it live" above, with nothing telling it who un-drafts the PR, can stall on
  exactly this collision.
  **THE HISTORY, briefly, because it explains why this rule is written so bluntly.** A text rule
  alone lost this collision four times — #1157, #1162, #1166 and #1180 each sat as a green,
  conflict-free PR parked in draft, waiting for a button the owner was never going to press. That
  is what `.github/workflows/pr-auto-ready.yml` was built to fix automatically (B781760), and it
  **never once succeeded on a real PR.** `markPullRequestReadyForReview` and
  `enablePullRequestAutoMerge` both came back FORBIDDEN ("Resource not accessible by integration")
  for `GITHUB_TOKEN` in this repo, confirmed on real PRs under every credential/setting
  combination there was to try (B793696): "Workflow permissions: Read and write" (on), "Allow
  GitHub Actions to create and approve pull requests" (on), and the installed "Claude" GitHub App
  (mechanically unusable from a workflow — it can only act as that App if it holds the App's
  private key, and Anthropic, not this repo, holds this one). **The credential question (a PAT or
  a self-owned GitHub App) is UNDECIDED, not declined — correction, B1266592, 2026-09-06.** An
  earlier version of this section said the owner "reviewed the full evidence 2026-08-31 and
  declined" that fix; he did not — he pushed back asking why this wasn't being fixed properly,
  said he wanted "set it and forget it," and asked what the automation was even for, and the offer
  of a self-owned GitHub App was left open and unanswered. On 2026-09-06 he confirmed only that he
  is fine with the workflow being deleted, which is a separate question from the credential one.
  Reading that same evidence on 2026-08-31, he then went further and had the workflow removed
  outright (B934400/B934401): a permanently red job that cannot do either of its two jobs is worse
  than no job, because it trains sessions to wave off red checks as environmental. **This was NOT
  the risk being imagined away — it was tried for five days, confirmed dead by three separate live
  re-tests, and removed because it never worked, not because the collision it was built for stopped
  mattering.** The credential question stays open and moot while no workflow exists to hold one.
  **`pr-auto-ready.yml` is DELETED. There is no automation here, and none is coming back without a
  fresh, explicit owner go-ahead.** So, plainly:
  - **The session that opens a PR is the one that marks it ready and arms the merge, every time,
    as a normal, expected part of shipping "commit" — not a workaround, the standing way this
    gets done.** Right after opening the PR, call the GitHub MCP tools directly:
    `update_pull_request` with `draft:false`, then `enable_pr_auto_merge`.
  - **The sanctioned way to ask the owner to look before a PR merges is the `hold` label (still a
    real label in this repo's label list) or a `<!-- keep-draft -->` marker in the PR body.**
    Nothing reads either automatically any more — the session opening the PR checks for one of
    them itself, on its OWN PR, before calling `update_pull_request(draft:false)`, and leaves the
    PR in draft if either is present.
  - **If drafts start silently parking again, the fix is a DETECTOR, not another actuator and not
    a PAT** — a read-only workflow that notices a still-draft `claude/*` PR with a green `build`
    check and turns a check red about it needs no elevated token, because it only reads. Do not
    rebuild `pr-auto-ready.yml`'s mutating shape without a fresh, explicit owner go-ahead.
  It only ever *enables* auto-merge; the required `build` check (below, and the nudge-commit
  note that follows it) still has to go green before anything actually merges.
- **⛔ AFTER ANY CHANGE TO A PR TITLE — which every renumber causes — DISABLE AND RE-ENABLE
  AUTO-MERGE. GitHub snapshots the squash commit message when auto-merge is ARMED, not when it
  fires, and a later title edit does NOT update that frozen copy (B225984, 2026-08-07).** PR #931
  armed auto-merge while its ids read `B3001–B3004`, was renumbered three more times, merged with
  a correct title and correct files — and `main` still carries `fdcb02d`, whose subject announces
  **retired ids that name no heading anywhere**. That is the #865/#866 defect arriving through the
  one door B779's announcement check cannot see: that check guards the commit **you** push, and
  this message never passed through your branch. Re-arming is the whole remedy; it costs two API
  calls. **No machine guard exists for this and one was deliberately not built** — scanning `main`'s
  log needs full history, and CI checks out depth 1, so the guard would pass trivially and rot green
  (the failure mode VIEW-INDEPENDENT-ONCE §6 names). The reasoning is on B225984 so it is not
  re-litigated.
- **The required `build` check often does NOT auto-start on a PR you open via the GitHub
  MCP / automation — un-stick it yourself with a nudge commit; NEVER hand this to Michael.**
  GitHub suppresses `pull_request`/`push` workflow triggers for PRs opened or pushed by the
  automation's app token, so the required `build` check sits **"Expected — Waiting for status
  to be reported"** and **auto-merge waits forever** (it will NOT merge on its own). A
  `workflow_dispatch` build _runs_ but its check does **not** satisfy the required context, and
  a direct merge is rejected with `Required status check "build" is expected`. **Fix:** after
  opening the PR + enabling auto-merge, push a tiny **empty nudge commit** to the PR branch
  (`git commit --allow-empty -m "Nudge CI" && git push`) — that fires the real `pull_request`
  build, it passes in ~40s, and the armed auto-merge then completes on its own with zero owner
  involvement. This is a known, self-serviceable hiccup — **do the nudge automatically as part
  of shipping; do NOT report it as a blocker.** (Learned 2026-06-22 on PR #274.)
  **⚠ THE ROOT-CAUSE EXPLANATION ABOVE — "GitHub suppresses the trigger for the automation's app
  token" — IS UNVERIFIED, NOT RE-MEASURED SINCE THAT ONE 2026-06-22 OBSERVATION. Measure again before
  citing it as settled fact, or before repeating it in a brief as an established second cause of a
  stuck PR.** A brief circulating 2026-08-31 relayed exactly this claim while flagging itself that it
  was repeating this note, not a fresh check. `docs/incidents/CI-REQUIRED-CHECK.md` separately found a case
  where what looked like permanent suppression was actually a temporary delay (B226400) — the same
  kind of mistake this claim invites if treated as proven. The operational fix — push the nudge commit
  — stays safe and cheap regardless of which explanation is true, so keep doing that; just don't
  restate the app-token-suppression mechanism itself as proven.
  **⛔ AND READ THE RIGHT ENDPOINT BEFORE CONCLUDING THE CHECK NEVER STARTED (measured 2026-08-14, and this
  session got it wrong twice before checking).** `pull_request_read method=get_status` returns the COMMIT
  STATUS API; this repo's `build` reports a **CHECK RUN**. So `{"state":"pending","total_count":0}` there is
  the NORMAL reading for a run that is queued or in progress, and it is **NOT evidence that the trigger was
  suppressed**. Acting on it cost two unnecessary `Nudge CI` commits and a hunt through `build.yml` for a
  `paths:` filter that does not exist — while three runs were already `in_progress` for those very shas. The
  authoritative read is the CHECK RUN, and there is a purpose-built endpoint for it that this session
  only found on its third attempt: **`pull_request_read method=get_check_runs`** returns the head
  commit's check runs directly — a handful of lines, no pagination, no matching on `head_sha`. Prefer
  it. `actions_list method=list_workflow_runs event=pull_request` matched on `head_sha` answers the
  same question but returns tens of thousands of characters and has to be parsed out of a file.
  Nudge on the absence of a RUN, never on `total_count: 0`.
  **⚠ AND WHEN A NUDGE IS GENUINELY OWED, PREFER MERGING `origin/main` OVER AN EMPTY COMMIT** — it
  fires the same real push event AND refreshes a branch that has drifted, so it fixes the stale-merge
  case at the same time.
  **(Retired 2026-11-23, audit Batch C: `npm run safe-merge`, `resolve-ledgers.mjs`, the `planyr-ledger` merge driver, the
  post-merge regen hook, `install-hooks.mjs`/`npm run hooks:install` and the pre-push mint gate are all deleted — the ledger lives on
  its own branch, so `BACKLOG.md`/`VERIFICATION.md` are not on main and a branch never touches the generated indexes.)** To bring a
  branch up to date use a plain `git fetch origin main && git merge origin/main`; `MAP.md` / `BACKLOG_OPEN.md` /
  `docs/UI-INVENTORY.md` carry git's built-in `merge=union` in `.gitattributes` (no install step), and the touch guard stops a PR
  from carrying them anyway.
  **⚠ CHECK `mergeable_state` FIRST — a "dirty" (merge-conflicted) PR silently swallows EVERY nudge
  (learned 2026-07-06 on PR #518).** GitHub only creates `pull_request` build runs against the PR's
  test-MERGE ref; while the PR conflicts with `main` that ref can't exist, so nudges, close/reopen —
  nothing fires, with no error anywhere. Four nudges did nothing; merging `origin/main` into the branch
  fixed it instantly. So: nudge once → if `actions_list` shows NO run for the branch, fetch the PR
  (`pull_request_read get`) and look at `mergeable_state` BEFORE nudging again — `dirty` means resolve
  the conflict first (main moves fast here), then the next push fires CI on its own.
  **⚠ One nudge is often NOT enough, and a PR never merges itself — BABYSIT it to `merged:true`
  (learned 2026-06-27 on PR #379).** Automation-token pushes (PR-open + a single nudge) frequently
  still don't fire the `pull_request` build — recent PRs have needed **two** `Nudge CI` commits — so
  after nudging, **verify a run actually appeared** (`actions_list list_workflow_runs` for the branch
  / `pull_request_read get_status`) and **nudge again** if not. Separately, `main` moves fast (many
  concurrent sessions) so a PR often goes `mergeable_state:dirty` on `BACKLOG*.md`/`VERIFICATION*.md`
  — resolve by merging `origin/main` in (keep both sides' done-entries; renumber only a genuinely
  colliding new B#/V#), re-run the gate, push. **Poll every ~150s while a PR is open** (webhooks do
  NOT deliver CI-success / merge / conflict transitions — always re-fetch), never on a 20-min idle tick.
- **⛔ BEFORE PUSHING A FIX FOR A CI FAILURE, RUN `npm run ci-parity` — NEVER APPROXIMATE CI BY HAND
  (2026-09-02, owner-approved after the third CI-vs-local mismatch in a week: B927104, the
  2026-08-31 bundle night, PR #1323).** It runs every gate the required `build` check runs, in the
  same order, reading them from `.github/ci-gates.yml` (which `.github/workflows/build.yml` itself
  calls via this same command — one list, not two that can drift). It reproduces CI's environment
  too — the same build-time env vars, the pinned Chromium revision for the visual-regression gate —
  and if a real secret (`VITE_SUPABASE_URL`/`VITE_SUPABASE_ANON_KEY`) is absent locally it says so
  LOUDLY and substitutes the documented dummy rather than silently measuring something CI doesn't.
  `--list` shows the gate order with nothing run; `--skip-install` skips `npm ci` (loud, deviates).
  **THE REQUIRED `build` CHECK IS NOW PARALLEL LANES (2026-11-23, audit Batch C).** `build` is a small aggregator job over
  `detect` · `static` · `vitest` (3 shards) · `build-app` (uploads `dist/`) · `browser` (4 shards, downloads `dist/`); each lane runs
  `npm run ci-parity -- --lane <name> [--shard i/n]` against the SAME `.github/ci-gates.yml`, and `ui-audit/lib/ciGates.mjs` `LANES`
  says which gate runs where (an unlisted gate lands in `static`). A bare `npm run ci-parity` still runs every gate serially.
  The check's name is still exactly `build`, and it goes red if ANY lane fails (`test/ciGates.test.js` runs its verdict script).
  Pushes to main are keyed per commit (they no longer queue); PRs still cancel superseded pushes.
  See `scripts/ci-parity.mjs`'s own header for what it deliberately doesn't cover and why.
  **NOTES GATES SPLIT (owner decision 2026-11-23):** only five `verify-notes-*` gates stay in the required check (placement surface,
  clipboard regression bank, box copy vs text copy, overlap rule, Ctrl+A scope — `REQUIRED_NOTES_GATES` in `ciGates.mjs`); the other 13
  run as lane `notes-extra` in `.github/workflows/notes-gates.yml` (nightly, on demand, and on PRs touching `src/workspaces/notes/**`) —
  NOT required, so a red nightly there is a "go look". A bare `npm run ci-parity` still runs all 18. Do not call a moved gate "a required build step".
- **Deploy = Cloudflare Pages (production), serving planyr.io.** Because the suite is one
  app with an in-app workspace switcher, "seeing both live" is one URL — you switch tabs
  inside it. (The old GitHub Pages deploy was retired — see "Retire the old GitHub Pages
  deploy pipeline — ✅ DONE" near the end of this file; GitHub Actions now only runs the
  build status check, it doesn't publish.)
- **`functions/` (repo root) is the Cloudflare Pages Functions directory — it deploys
  automatically with every build, no `wrangler.toml` and no env-var change needed.** Any file
  under it becomes a server-side route at the matching path (`functions/api/files.js` →
  `/api/files`, `functions/gis-proxy/[[path]].js` → `/gis-proxy/*`), and it's where a request
  that needs to run somewhere CORS doesn't apply — a county GIS host with no
  `Access-Control-Allow-Origin` header, a Drive upload — belongs. `functions/gis-proxy/`
  (NEW-1, 2026-09-24) is a plain same-origin relay for a hard-coded allow-list of hosts
  (`ALLOWED_HOSTS` in that file) — a new host must be added there before a
  county can be wired through it; see `docs/STATEWIDE-PARCELS.md`'s "GIS pass-through" section.
  This is a **different** mechanism from the B445 `/api/gis-cache/` proxy (Drive-backed raster
  imagery caching, its own regex allow-list) — don't conflate the two.
- **⛔ A LIVE MEASUREMENT ON planyr.io IS ONLY VALID IF THE DEPLOYED CHUNK HASH IS READ IN THE SAME
  CALL AS THE ASSERTION (owner correction, 2026-09-03, B1112449/B1112450 false-alarm recurrence).**
  A browser tab can silently keep serving a pre-deploy cached bundle — content-hashed chunk
  filenames (`AppHeader-<hash>.js`) are meant to be cached long-term, so a STALE tab's own reload
  can reload the SAME stale chunks rather than fetch the new deploy; two tabs opened at different
  times can each be on a genuinely different build with no visible sign of it. The case this
  produced: a "still broken after the fix shipped" report was measured in a tab on the pre-fix
  bundle, while a DIFFERENT tab (used minutes earlier to confirm an unrelated part of the same fix)
  was already on the new one — the mismatch went unnoticed because neither check read its own chunk
  hash. **The fix is procedural, not architectural: whenever a live check's PASS/FAIL claim matters,
  read the served chunk hash (Network tab, or `document.querySelectorAll('script[src]')`) in the
  SAME observation as the behavior being asserted** — never assume a reload guarantees a fresh
  bundle, and never let one tab's confirmed-fresh reading vouch for a different tab.
- **Per-branch preview URLs** (seeing an unmerged branch live without merging to `main`)
  are a separate, optional Cloudflare concern — not required to build or to see both
  workspaces. (Don't conflate this with PR status checks, which are a separate GitHub
  Actions concern.)
- End commit messages with the session link the harness provides. Don't include the
  model identifier in commits/PRs/code.
