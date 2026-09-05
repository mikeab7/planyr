# The 2026-08-06 merge outage — why no pull request could merge, and what now prevents it

**Status:** cause identified with evidence, fix shipped (B6864–B6867). Corrected 2026-08-07
(B226400 — the 30-minute lag is incident-scoped, not standing; §2, §3, §4) and guarded against
recurrence of the *shape* rather than the instance (B226401 — §3).
**Symptom:** seven open pull requests (#928, #930–#935), every one showing
`build — Expected — Waiting for status to be reported`, Required. Auto-merge armed on all of them and
unable to fire. No merge control offered to anyone — the owner verified this by toggling auto-merge
off and on on #931: with it on GitHub offers only "Disable auto-merge", with it off only "Enable
auto-merge (squash)". There is no merge button and no bypass while a required context is unreported.

---

## 1. What it was not

Each of these produces the identical symptom, so each was checked rather than assumed.

| Hypothesis | Verdict | Evidence |
|---|---|---|
| A `paths` / `paths-ignore` filter on the build trigger skips docs-only pushes | **Refuted** | `.github/workflows/build.yml` has no `paths` or `paths-ignore` key at any level. Its trigger block is `push: [main]`, `pull_request: [main]`, `workflow_dispatch` — unfiltered. |
| A `concurrency` group with `cancel-in-progress` cancels the run for a superseded SHA | **Refuted** | No `concurrency:` key anywhere in `build.yml`. No run in the last 30 has conclusion `cancelled`. |
| The workflow runs on `push` but not `pull_request`, so nothing binds to the PR | **Refuted** | Both triggers present; runs 2338–2342 are all `event: pull_request`. |
| Merge conflicts prevent GitHub computing the merge ref, so no run can be created | **Refuted** | All seven report `mergeable_state: blocked`, none `dirty`. Run 2342's log shows the merge ref was created and checked out: `HEAD is now at 8956fb18 Merge 72653cee… into fee9a018…`. |
| The reported check name differs from the job id | **Refuted** | Job id is `build`; the API reports `"job_name":"build"`; the ruleset requires `build`. |
| "Require branches to be up to date" starving PRs against a moving main | **Not the blocker** | Could not read the ruleset toggle from this session (no rulesets-API token). It is not what is blocking: every open PR reports `blocked`, none reports `behind`, and all seven sit on main's current tip `fee9a018`. |

**GitHub Actions itself was healthy**, as the owner said. Runs are created and started in the same
second (`created_at == run_started_at`) and finish in about 60 seconds.

---

## 2. What it actually was — two faults, and neither alone explains it

### Stage A — the mint gate was a ratchet

`scripts/check-mint.mjs` failed a build on two grounds. `TAKEN` — the id is genuinely held by main or
a peer branch — is a real collision and is correct. `BELOW` was not:

> an id is rejected if it is at or below `claimedMax`, the single highest id across `origin/main` ∪
> every in-flight peer branch, on the theory that it "was minted against a stale view, so the next
> merge will very likely take it".

Verbatim from run 2342, the build for PR #935:

```
⛔ MINT GATE FAILED — this branch claims backlog ids someone else already holds (B779).
   B3005 is at or below the claimed high-water mark B25005 — minted against a stale view; the next merge will take it.
   … B3006 … B3007 … B3008 … B3009 … B3010 …
   → renumber this branch's new B# ids starting at B25006
   V1503 is at or below the claimed high-water mark V9000 …
```

**B3005 collided with nothing.** It was rejected purely for being below a number another branch had
picked. And the only remedy the gate offers — renumber upward — *raises the mark for every other
in-flight branch*, which must then renumber higher still. That is a positive feedback loop with no
fixed point.

Measured that day: `origin/main`'s highest id was **B1449**. The claimed mark had reached **B25005**,
and while this fix was being written it passed **B100002** — over 98,000 ids of pure inflation, not
one of them a real collision. One PR's ids moved six times:
`B1467 → B1479 → B1501 → B1601 → B1801 → B3001 → B9001`.

### Stage B — that afternoon, the run was created about 30 minutes after the push

This is the half that turned a bad rule into an outage, and it is the half every previous session
misread — including, at first, this one.

During the incident a push did not produce its `pull_request` workflow run promptly. Measured on
PR #931: the `Nudge CI` commit `94c4efb` was pushed at **22:29:23Z**, and its `build` check run did
not start until **22:59:27Z** — **thirty minutes later**. The same gap appears on #933 (pushed
22:29, build 22:59) and on runs 2338/2339, whose `pull_request` runs were created 29 and 34 minutes
after `workflow_dispatch` runs had already completed on the same SHAs.

During that half-hour the PR shows exactly what the owner saw: the required context reads
`Expected — Waiting for status to be reported`, with no merge control available. Looking at a PR
inside that window is indistinguishable from a check that will never report, which is why this was
repeatedly diagnosed as permanent suppression. **It is a delay, not a suppression.**

> **⚠ CORRECTED 2026-08-07 (B226400) — THE LAG IS INCIDENT-SCOPED, NOT A PROPERTY OF THIS
> REPOSITORY.** The measurements above are real and are kept: that afternoon, runs genuinely took
> half an hour to appear. What was wrong was the *tense*. This document went on to state the delay
> as a standing fact — "the ~30-minute delay between a push and its workflow run is GitHub-side,
> nothing in this repository can shorten it" — and that sentence, read the next day, is false.
>
> Measured 2026-08-07 from the owner's signed-in session, eight samples across both event types:
>
> | Event | SHA | Pushed / committed | Run started | Lag |
> |---|---|---|---|---|
> | push → main | `87f0438` | 00:52:01Z | 00:52:04Z | **3 s** |
> | push → main | `020265f` | 00:37:10Z | 00:37:14Z | **4 s** |
> | push → main | `fdcb02d` | 00:29:05Z | 00:29:09Z | **4 s** |
> | push → main | `ad09957` | 00:21:12Z | 00:21:15Z | **3 s** |
> | push → main | `cd9c94c` | 00:12:51Z | 00:12:56Z | **5 s** |
> | PR #932 synchronize | `5f89818c` | 00:26:55Z | 00:27:06Z | **11 s** |
> | PR #939 opened | `a45af00` | 00:18:01Z | 00:18:27Z | **26 s** |
> | PR #940 opened | `4edf282` | 00:34:10Z | 00:34:54Z | **44 s** |
>
> **Method, and where each figure is exact.** For a squash merge GitHub creates the merge commit at
> the moment it merges, so that commit's **committer** timestamp on `origin/main` *is* the push
> moment — the five push rows are exact. For a `pull_request` event the committer timestamp is when
> the commit was written locally, which precedes the push by however long the session spent between
> the two, so those three rows are **upper bounds**. Every figure is therefore at or above the true
> lag, and the largest of them is 44 seconds. Repro: compare each merge commit's committer timestamp
> on `origin/main` against its `build` run's `run_started_at`.
>
> So the correct statement is **incident-scoped**: during the four-hour Actions outage of 2026-08-06
> and the backlog it left behind, run creation lagged pushes by about half an hour. Ordinarily it is
> seconds. This matters for the advice in §4, which used to tell you to sit through half an hour of
> `Expected` on faith.

### Why the two together are lethal

Per pull request, the loop ran like this:

1. Mint ids against a freshly fetched `main` — correct at push time.
2. Push. Wait for the run to be created (that afternoon, ~30 minutes).
3. The run fails on `check-mint`, because during the wait other sessions pushed higher ids and the
   high-water mark moved past yours.
4. Renumber upward, push, go to 2 — raising the mark for everyone else on the way past.

**The ratchet had no fixed point at ANY period, and that is the claim that survives the correction
above.** The old rule passed a branch only if its new ids were strictly above `claimedMax`, the
highest id held by *any other* in-flight branch. For two branches A and B that reads: A is green iff
`a > b`, and B is green iff `b > a`. **Both conditions cannot hold at once** — at most one branch in
the whole in-flight set can be green, and the moment a red one takes the only remedy the rule
offers, it becomes the maximum and turns the green one red. With `n` branches in flight, `n − 1` are
red by construction, and every attempt to fix one breaks another. Merging is the only exit, and
merging requires being green when your build actually runs.

This is period-independent, which is what makes it the stronger statement. **Set the delivery lag to
the three seconds we now measure and the same rule still livelocks** — it would simply have burned
through its ninety-eight thousand ids in minutes instead of hours. The lag is not what made the rule
unsatisfiable; it only decided how stale each verdict was on arrival, and how long the loop ran
before a human noticed. Any rule that requires *every* participant to hold the strict maximum of a
quantity they collectively define has no solution, at any speed.

An earlier session had already measured the lag and written it into #931's description. Its
conclusion — *"the final block was chosen ~850 clear of the mark so it survives the lag rather than
races it"* — is the ratchet, correctly reasoned from a correct observation, and it is the tell: the
only move the rule allows is to escape upward, and that is the move that starves everyone else. Note
that it treats the problem as a race to be outrun, which is exactly the mistake the period-
independent argument corrects — there was no lead large enough, because the finish line is defined
by wherever the other runners are.

**A four-hour Actions infrastructure outage** earlier that day (main's own push run failed at
"Set up job"; a `workflow_dispatch` sat 15 minutes with no runner) is what let seven branches
accumulate in flight at once. It had recovered by 21:19Z. It seeded the pile-up; it did not cause it.

---

## 3. The fix

### The ratchet is gone (`scripts/idBlocks.mjs`, `scripts/check-mint.mjs`)

`BELOW` is removed. `TAKEN` — a proven, present collision — stays fatal, and
`test/idUniqueness.test.js` still fails the build if two active items share a number. An unclaimed id
is now green regardless of what any other branch happened to pick, so **the 30-minute lag becomes
harmless**: an id that was unclaimed at push time is still unclaimed half an hour later.

In its place, each branch gets its own **reserved block** of ids — a pure function of the branch
name, so two sessions minting at the same instant draw from disjoint ranges and cannot pick the same
number. There is **no allocator**: nothing is handed out, nothing is stored, no service is consulted.
That is deliberate, and it is what answers the two failure modes an allocator would add — it cannot
be a single point of failure, and it cannot hand two sessions the same block in a race.

The full argument against the design, including where it concedes a real cost, is the **steel-man**
in the header of `scripts/idBlocks.mjs`. `test/idBlocks.test.js` proves the central property four
ways, including the exact race that broke the repo.

An id outside your block is now **reported, never fatal** — the seven PRs blocked that day all hold
ad-hoc numbers, and failing them would have been one more renumber round.

### The outage class cannot silently recur (`ui-audit/required-check-audit.mjs`)

A required status check is a contract between the ruleset (on GitHub) and the workflows (in this
repo), and the two drift independently with nothing watching. `.github/required-checks.json` is the
committed copy of that contract, and the guard runs in the ordinary required build asserting:

1. **name agreement** — every required context is actually produced by a job that runs on
   `pull_request` into `main`. A one-word job rename otherwise arms a silent repo-wide outage;
2. **docs-only reachability** — every required context still reports when a PR changes only
   documentation. This was the owner's leading hypothesis, and while it was not the cause, a
   backlog renumber is docs-only by construction and a `paths:` filter is one edit away.

When a filter is genuinely wanted, the failure message names the standard remedy: keep the filter on
the expensive job and add a companion job with the **same check name** that runs when the filter
excludes everything and reports success immediately. It never suggests dropping the required check
or removing the ruleset. `test/requiredChecks.test.js` mutation-checks the guard both ways — the real
repo passes, and deliberately broken copies (renamed job, `paths` filter, push-only trigger, wrong
base branch) each go red.

### What is *not* fixed, stated plainly

**Delivery time is GitHub's, and it is not a constant.** Ordinarily a run appears within seconds of
the push — measured 2026-08-07 across eight consecutive pushes, 3–5 s for a push to `main` and under
a minute for a `pull_request` event (table in §2). When Actions is degraded, as it was on
2026-08-06, it can stretch to half an hour. Nothing in this repository shortens either case.

**What has changed is that neither case costs anything.** The gate's verdict no longer depends on
what other branches did while you waited: an id unclaimed at push time is still unclaimed half an
hour later, so a slow run produces the same answer as a fast one. That is the whole point of
removing the ratchet, and it is why the correction in §2 changes no conclusion in this document —
only the advice in §4.

**Also not fixed, and deliberately so:** the gate still *reads* peer branches, to name the branch you
would have overlapped with. That is reporting, not judgement — a peer-held id is an advisory
(B36051), never fatal. The invariant that keeps it that way is now a guard rather than a memory:
`ui-audit/lib/mintFatality.mjs` + `test/mintFatality.test.js` (B226401) fail the build if any fatal
mint verdict is ever again a function of an aggregate of peer state.

---

## 4. Recovering a PR that is already stuck

> **⚠ CORRECTED 2026-08-06, minutes after this shipped — the first version of this section was WRONG,
> and it was tested rather than assumed, which is the only reason the error was caught.**
>
> It said: *"a PR's next build picks it up automatically … no rebase is needed … what is needed is one
> re-trigger: re-run the failed `build` workflow, or push any commit."* The re-run half is false. It
> was tried on four stuck PRs (#931, #932, #933, #934) as soon as the fix reached main, and **all four
> failed again** — with the message `B9001 is at or below the claimed high-water mark B209509`, which
> is wording the corrected gate **no longer contains**. Proof, not inference: the re-run executed the
> OLD `check-mint.mjs`.
>
> **A re-run replays the merge commit the run was created against.** It does not recompute
> `refs/pull/<n>/merge` against main's current tip, so a PR whose only problem is that main has moved
> gets nothing from a re-run — it faithfully reproduces the old failure, which reads as "the fix
> didn't work" when what actually happened is that the fix was never in the tree being built.

**A stuck PR needs a NEW PUSH — nothing else will do.** Any new commit on the branch causes GitHub to
recompute the merge ref against main's current tip, and *that* build runs the corrected gate. The two
forms that work:

```
git fetch origin main && git merge origin/main    # then push — also brings the new gate into the branch
git commit --allow-empty -m "Rebuild against main" && git push
```

Prefer the merge: it puts the corrected `check-mint.mjs` into the branch itself, so the pre-push hook
and CI agree. Expect a conflict in `BACKLOG.md` (main's copy moved), and resolve it by keeping both
sides' items — **do not renumber anything to resolve it.**

Then **give the run time to appear before concluding anything.** *(Restated 2026-08-07, B226400 —
the earlier wording said "a PR showing `Expected` for the first half hour is normal", which was true
during the incident and is misleading on an ordinary day.)* Normally the run starts within seconds,
so:

- **under a minute or two of `Expected` is just delivery.** Do nothing.
- **longer than that is worth LOOKING at, not waiting out.** Check whether the run exists at all
  (`actions_list list_workflow_runs` for the branch); if runs are being created but sitting unstarted
  across the whole repository, Actions is backed up and half an hour is again the right expectation.
- **whatever the answer, do not renumber.** Renumbering in response to a slow check is what produced
  six rounds of it, and under the current gate it cannot help — the verdict does not change with
  time.

Do not clear a backlog by disabling the required check or merging something whose build has not
actually passed.

---

## 5. The last trap on the way out — auto-merge freezes the commit message when it is ARMED

**Added 2026-08-07 (B225984), after the very first PR recovered by §4 landed on `main` announcing
ids that name no heading anywhere.**

PR #931 followed §4 exactly: merged `main` in, took its reserved block, renumbered **once**,
corrected its commit subject, corrected its PR title, went green, and auto-merged. The squash
commit on `main`, `fdcb02d`, reads:

```
Add one pond and the pan gets slow … (B3001/B3002 · B3003 · B3004 · B1449 ×2 — V1501/V1502)
```

`B3001` was the **third of six** ratchet-era renumbers, abandoned hours earlier. The **files** that
merged are correct — `### B221760`–`### B221763`, `### V23408`/`### V23409` — so the id space is
sound and `test/idUniqueness.test.js` is green. Only the line a human reads is wrong.

**Cause: GitHub captures the squash title and body at the moment auto-merge is ARMED, not when it
fires.** #931 armed auto-merge early, while its ids still read `B3001`. Every later renumber updated
the branch, the headings, the commit subject and the PR title; none of them touched GitHub's stored
copy. Proof by elimination — the title at merge time was `B221760/B221761 · B221762 · B221763 —
V23408/V23409`, and the merged files match it, yet the commit says `B3001`; that string existed in
exactly one place, the PR title several hours before.

**Remedy, and it is one step: after any PR title change, disable auto-merge and re-enable it.**
Re-arming re-snapshots the message. Renumbering always changes the title, so this fires precisely on
the branches §4 sends here.

**Why there is no guard.** `check-mint`'s announcement check (B779) already proves the ids a branch
*announces* are ids it *filed* — and on #931 it worked, rejecting the stale subject before the push.
It cannot see this message, because this message never passed through the branch. The obvious
after-the-fact guard — scan `main`'s log for ids with no heading — needs full history, and
`actions/checkout` fetches depth 1, so in CI it would scan one commit, pass, and rot into a permanent
green. That is the failure mode **VIEW-INDEPENDENT-ONCE §6** names. Run by hand once, across all 59
commits this clone holds, `fdcb02d` is the only offender.

**`B3001`–`B3004` and `V1501`/`V1502` are burned** — they name this work in main's history and must
never be filed against a different feature. Reserved blocks anchor above main's maximum, so
`next-id` cannot hand out a number that low; the burn is recorded so the reasoning outlives the tool.
