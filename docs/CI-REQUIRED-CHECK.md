# The 2026-08-06 merge outage — why no pull request could merge, and what now prevents it

**Status:** cause identified with evidence, fix shipped (B6864–B6867).
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

### Stage B — the run is created about 30 minutes after the push

This is the half that turns a bad rule into an outage, and it is the half every previous session
misread — including, at first, this one.

A push does not produce its `pull_request` workflow run promptly. Measured on PR #931: the
`Nudge CI` commit `94c4efb` was pushed at **22:29:23Z**, and its `build` check run did not start
until **22:59:27Z** — **thirty minutes later**. The same gap appears on #933 (pushed 22:29, build
22:59) and on runs 2338/2339, whose `pull_request` runs were created 29 and 34 minutes after
`workflow_dispatch` runs had already completed on the same SHAs.

During that half-hour the PR shows exactly what the owner saw: the required context reads
`Expected — Waiting for status to be reported`, with no merge control available. Looking at a PR
inside that window is indistinguishable from a check that will never report, which is why this was
repeatedly diagnosed as permanent suppression. **It is a delay, not a suppression.**

### Why the two together are lethal

Per pull request, the loop ran like this:

1. Mint ids against a freshly fetched `main` — correct at push time.
2. Push. Wait ~30 minutes for the run to be created.
3. The run fails on `check-mint`, because during those 30 minutes other sessions pushed higher ids
   and the high-water mark moved past yours.
4. Renumber upward, push, go to 2 — raising the mark for everyone else on the way past.

The feedback loop's period (~30 minutes) is far longer than the rate at which the mark advances, so
**no branch can ever satisfy a condition defined by a global maximum.** This is a livelock, not a
deadlock: every session was making progress, and none of it could ever converge. Nothing merged, so
no id range was ever released, so the mark only climbed.

An earlier session had already measured the lag and written it into #931's description. Its
conclusion — *"the final block was chosen ~850 clear of the mark so it survives the lag rather than
races it"* — is the ratchet, correctly reasoned from a correct observation. Escaping upward is the
only move the rule allows, and it is the move that starves everyone else.

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

The ~30-minute delay between a push and its workflow run is GitHub-side. Nothing in this repository
can shorten it. What has changed is that it no longer costs anything: the gate's verdict is now
stable over time, so waiting out the lag produces the same answer as being fast.

---

## 4. Recovering a PR that is already stuck

Once this fix is on `main`, a PR's next build picks it up automatically — GitHub builds
`refs/pull/<n>/merge`, which is the PR head merged into main's **current** tip, so no rebase is
needed to get the new gate.

What is needed is one **re-trigger**, because main moving does not itself create a PR run: re-run the
failed `build` workflow, or push any commit. Then wait out the delivery lag before concluding
anything — a PR showing `Expected` for the first half hour is normal and is not evidence of a fault.

Do not clear a backlog by disabling the required check or merging something whose build has not
actually passed.
