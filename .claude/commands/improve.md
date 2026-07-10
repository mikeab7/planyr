---
description: Run one batched "debug & improve" lap — fix backlog items end-to-end, ship live, batch owner questions
---

# /improve — one autonomous debug-and-improve session

You are running **one batched lap** of Planyr's self-improvement loop. The goal: pick the most
worthwhile open work, **fix it completely**, **verify it**, **ship it live**, keep the tracking
files honest, and work through **multiple items** — only stopping when you've gathered ~10
questions for the owner or there's nothing actionable left.

Read `CLAUDE.md` first if anything below is unclear — its standing rules win over this file.

## Ground rules (non-negotiable — from CLAUDE.md)

- **Fix it and ship it THIS session.** No diagnosis-only, no band-aid, no "added to backlog for
  later." Implement *every* part of an item, including the hard/real one, then verify it.
- **"Commit" = take it live.** stage → commit → push → open PR into `main` → nudge → auto-merge.
  Merging to `main` is what ships it to planyr.io.
- **Move shipped items, don't mark-done-in-place.** The moment an item ships, move its WHOLE block
  from `BACKLOG.md` → `BACKLOG-DONE.md` (and a fully-passed `VERIFICATION.md` item → `VERIFICATION-DONE.md`).
- **Never read `BACKLOG-DONE.md` / `VERIFICATION-DONE.md`** except to look up one specific past item.
- Next `B#`/`V#` = highest across BOTH the live and the done file, +1 — **get it with `npm run next-id`**
  (prints `Next free → B### · V###` from disk, zero model tokens; never grep the archives for the max).
- **Plain-English to the owner in chat;** technical in commits/PRs/code/backlog. Never put the model
  identifier in commits/PRs/code.

## The lap

### 0. Sync
- `git fetch origin`
- Work on branch **`claude/app-loops-debug-hukhfz`** (create from latest `main` if it doesn't exist).
- Merge the latest `main` into the branch so you're not drifting.

### 1. Pick work (highest value first)
- **Grep, don't slurp — these files are large (hundreds of KB).** Reading a whole tracking
  file into context to find one item is the biggest avoidable token burn in this repo.
  - List open backlog headings only: `Grep pattern "^### B" path BACKLOG.md output_mode content`
    (a few KB of titles) — **bugs and improvements/features both count**.
  - List due verification headings: `Grep pattern "^### V.*⏳" path VERIFICATION.md output_mode content`
    for the `⏳` items you can drive in a headless browser here.
  - **Then `Read` only the ONE block** you decide to work on (use the heading's line number as
    `offset` with a small `limit`). Never `Read` the whole `BACKLOG.md`/`VERIFICATION.md`.
  - The `*-DONE.md` archives are write-only — never read them except to look up one past ID.
- Choose the highest-value item that is **actionable now**. An item is NOT actionable if it is:
  blocked on an owner decision, blocked on an external dependency / owner-supplied input
  (a 2nd test account, a heavy PDF, a SQL run, a key), or genuinely too large to finish in one lap.
  For each non-actionable-but-valuable item, see step 5 (batch a question) instead of forcing it.

### 2. Fix it fully
- Implement the complete change. Match surrounding code style. Respect the KEY DECISIONS in
  `CLAUDE.md` (theme tokens not raw hex; no `window.prompt/confirm/alert` edits — inline editors only;
  private-by-default; status palette rules; brand spelling "Planyr").

### 3. Verify (the quality gate — run in this order)
```
npm run lint
node ui-audit/gis-source-audit.mjs
node ui-audit/doc-pointer-audit.mjs
npm test
npm run build
```
- Then, for any UI-affecting change, drive it headless:
  `npx vite preview --host --port 4173 &` then run the matching `ui-audit/verify-*.mjs`.
  **Write a new `ui-audit/verify-<thing>.mjs` if none exists** for what you changed.
- **Every Chromium launch MUST pass `--ignore-certificate-errors`** (sandbox TLS-proxy quirk),
  e.g. `chromium.launch({ executablePath: EXEC, args: ["--no-sandbox", "--ignore-certificate-errors"] })`.
- Self-tests run **logged-out** (sandbox blocks sign-in). For any path you can only confirm
  signed-in / cloud / on the live edge, add a numbered `V###` entry to `VERIFICATION.md` recording
  what you DID verify and the precise signed-in steps still pending — this is mandatory, every time.

### 4. Ship it live
- **Merge `origin/main` into the branch RIGHT BEFORE pushing** (`git fetch origin main && git merge
  origin/main`) — `main` moves fast (multiple concurrent sessions), so syncing late minimizes the
  conflict window. Keep `BACKLOG`/`VERIFICATION` edits to one tight block — that's where fast-main collides.
- `git add -A && git commit` with a clear, technical message ending in the harness session link.
- `git push -u origin claude/app-loops-debug-hukhfz` (retry up to 4× with backoff on network errors).
- Open a PR into `main` (use a PR template if one exists; describe only the diff). Enable auto-merge.

### 4b. Ship & babysit the PR — DO NOT fire-and-forget (learned on PR #379)
A PR does NOT merge itself here. Two recurring stalls, both self-fixable — drive the PR to
`merged: true` yourself:
- **The required `build` check often never starts.** Automation-token pushes (PR-open + a *single*
  nudge) frequently don't trigger the `pull_request` workflow — the cohort's PRs have needed **two**
  `Nudge CI` commits. So: push an empty nudge (`git commit --allow-empty -m "Nudge CI" && git push`),
  then **verify a run actually appeared** (`actions_list list_workflow_runs` for the branch /
  `pull_request_read get_status`). If none after the next poll, **nudge again** (≥2). Never assume.
- **Merge conflicts with fast-moving `main`** (`mergeable_state: dirty`/`behind`) — usually in
  `BACKLOG*.md`/`VERIFICATION*.md`. Resolve: `git fetch origin main && git merge origin/main`, keep
  BOTH sides' done-entries (renumber only if you minted a NEW B#/V# that main also took), re-run the
  quality gate, push.
- **Poll cadence:** while a PR is open and unmerged, schedule the next check at **~150s** (cache-aware,
  matches CI timescale) — NOT 20 min. Webhooks do NOT deliver CI-success / merge / conflict
  transitions, so always re-fetch fresh PR state each poll. Loop: re-fetch → fix dirty → re-nudge if
  no run → wait → repeat until `merged: true`. Only THEN start the next item.
- Only stop short of live for a TRUE hard blocker (a red `build` after a real fix, branch protection
  rejecting the merge) — report *that* plainly; the nudge/conflict dance is NOT a blocker.

### 5. Bookkeeping
- Move the shipped item's whole block from `BACKLOG.md` → `BACKLOG-DONE.md`.
- Update `VERIFICATION.md` (add the pending signed-in `V###`, or move a fully-passed item to
  `VERIFICATION-DONE.md`).
- Keep `OWNER-TODO.md` current (remove anything the owner has since done).

### 6. Batch owner questions — DON'T STOP, log and continue
When an item needs the owner's **decision or input**, append it to `OWNER-TODO.md` under a section:

```
## ❓ From the improve loop
- [ ] (Q#) <plain-English question or input needed> — re: B### <one-line why>
```

Number questions sequentially (Q1, Q2, …) continuing from any already present — the count must
**persist here across laps** (each lap is a fresh run with no memory). Then go back to step 1 and
pick the next actionable item.

### 7. Stop conditions
End this lap when **either**:
- the `## ❓ From the improve loop` batch in `OWNER-TODO.md` has reached **~10 questions**, or
- there are **no more actionable items** (everything left is owner-gated / blocked / too large).

Then, in **plain English** in chat, summarize: what shipped this lap (with B# and one line each),
what's now live on planyr.io, and the batched questions awaiting the owner (read them back from
`OWNER-TODO.md`). State plainly whether there's anything left on the owner's side.

## Safety rails — never cross these
- **Never** re-mint `GOOGLE_REFRESH_TOKEN` (would take Drive filing offline).
- **Never** delete a live Supabase project (refs `lyeqzkuiwngunutlkkmi`, `ksetjztkplttbcehyicv`);
  renaming a display label is cosmetic/safe, deletion is irreversible data loss.
- **Never** inline a non-anon secret into the browser bundle (no `VITE_` for server secrets).
- **Never** push to any branch other than `claude/app-loops-debug-hukhfz` without explicit permission.
- Interrupt the owner mid-loop **only for a critical failure** — won't build, won't render, or a
  shipped feature visibly crashing. Otherwise batch it as a question and keep going.
