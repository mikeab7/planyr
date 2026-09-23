# Reliability programme (R0–R9) — status and durable brief

> **Read this file when picking up reliability-programme work (R2 onward).** It exists so the
> next session does not have to rediscover what R0/R1 already measured, and so the full R2–R9
> scope survives even though only R0+R1 shipped in the session that filed it. Cross-referenced
> from `BACKLOG.md` (**B1857904** — R1, shipped this session; **B1857905** — R2–R9, recorded and
> not started).

## What this is

A staged reliability programme for CI/test trustworthiness and (later) planner-state ownership,
prepared as an external brief on 2026-09-20 and dispatched for implementation on 2026-09-22/23.
The brief is long and opinionated about sequencing on purpose: it was written after an earlier,
shorter review produced a set of *"refinements"* correcting some of its own claims (see
"Important refinements to the original review" in the full text below) — e.g. the required build
**already runs visual regression**; the planner's hook counts are **textual occurrences, not an
AST measurement**; not all 300 `readFileSync`-using unit tests are inadequate; the nine known-red
entries are **seven CI + two local, with overlap**, not nine independent bugs. Treat corrections
like those as authoritative over the earlier, less careful framing they replace.

**Owner constraint carried into every stage (2026-09-22):** other Claude Code sessions work this
repo concurrently. Never disrupt, replace, revert, duplicate, or overwrite their work; branch in
isolation; inspect open PRs and current main for overlap before touching a path; preserve
concurrent changes when merging main in (never resolve a conflict by taking your whole file over
theirs). At dispatch time the named at-risk feature paths were: CAS 409 stale-write handling in
Concept A, Notes double-click placement, the side-parking extension grip snap, polygon crop, the
Row 2 box treatment, and Schedule cross-project task binding — treat that list as a *coordination
warning*, not proof of current PR state; re-check open PRs and recent main history before each
stage.

## R0 baseline — measured 2026-09-23, this session

- **Reviewed-brief commit:** `27671fa07ea186a638d563f84cd81ac87cfb0af0` (stale by the time of
  implementation, as the brief itself warns — "not a reason to restore old code").
- **Implementation commit (origin/main at session start):** `e692dde8385035e7d0cdda24a647960112a0b633`.
- **Open PRs at session start:** zero. The named at-risk features (Row 2 box treatment, side-parking
  grip snap, polygon crop, Notes click-to-connect) had already merged into main in the commits
  immediately preceding this session (`e6e77fd`, `68aa7c1`, `f8cf774`, `4681016`) — confirmed by
  `git log` and by there being no open PR to conflict with. No file-path overlap between this
  programme's R0/R1 changes (`scripts/lib/e2eDrift.mjs`, `scripts/e2e-drift-gate.mjs`,
  `test/e2eDriftGate.test.js`, `BACKLOG.md`, this doc) and any of the named at-risk feature files.
- **Node:** v22.22.2. **@playwright/test (locked):** 1.61.1 (`package-lock.json`). **vitest:** ^2.1.8
  (installed 2.1.9). `npm ci` installs cleanly; `node_modules` was not present at session start.
- **Secrets:** `VITE_SUPABASE_URL`/`VITE_SUPABASE_ANON_KEY` and `E2E_EMAIL`/`E2E_PASSWORD` are
  **absent** in this sandbox — `ci-parity.mjs` substitutes documented dummy values loudly; the e2e
  auth-gated lane is not runnable here (this is exactly the shape `auth.setup.js`'s "authenticate
  once" skip step exists to handle gracefully, and is the real-world case the R1 fix reproduces
  against — see below).
- **`npm run ci-parity -- --list`:** 20 gates read from `.github/ci-gates.yml`, in order (lint →
  scheduler syntax guard → required-check contract guard → GIS source registry guard → backlog
  tag-legend guard → doc-pointer freshness guard → verification-queue ceiling guard → e2e fixture
  drift guard → mint gate → unit tests → build → base-ref bundle snapshot → performance budget →
  Playwright install → preview server → signature-budget gate → visual regression). Confirms the
  brief's own correction: visual regression is already a required gate; R2's job is adding an
  *interaction* lane alongside it, not introducing pixel checking.
- **`e2e/known-red.json`:** 9 entries exactly as the brief characterizes — 7 `ci`-lane (5 marked
  `intermittent` with two-run evidence) + 2 `local`-lane, all in the electric-layer
  hover-identify / canvas-GIS-identify family, all reaching an external GIS host this sandbox
  cannot reach. Recorded debt, not newly reproduced failures — unchanged by this session.
- **B287058** (SitePlanner.jsx decomposition by state ownership) and **B217540** (drag
  re-migrates/re-serializes the whole plan) — both `BACKLOG.md`, both still **Open, not started**.
  B287058's own text is the decomposition *programme itself* (not merely its prerequisites); its
  Slice 6 (persisted model state) is explicitly blocked until B217540 ships. `perf:viewindep`'s
  registry-counter gate — the precondition for starting extraction at all — is green (14/14
  registered computations, each observed ≤ once per gesture). Neither item was touched this
  session (R6 is out of scope for R0/R1, and the brief's own ordering keeps planner-state work
  gated behind R2–R5).
- **`docs/incidents/PLAN-SITEPLANNER-DECOMPOSITION.md`:** already exists, already defines slices
  0 (registry pre-pass) → 1 (hover) → 2 (cursor/readout) → 3 (viewport) → 4 (chrome/layout) → 5
  (menus/drafts) → 6 (persisted model, last, gated on B217540). This **matches** the brief's
  claimed order (hover/cursor first, persisted model last) — nothing to reconcile there. Status:
  filed, deliberately not started.
- **`scripts/ci-parity.mjs`:** already supports `--list` (prints the gate list, runs nothing).
  Already substitutes loud dummy secrets when real ones are absent (`KNOWN_DUMMY_SECRETS` in
  `ui-audit/lib/ciGates.mjs`). Shells out via Bash (`spawnSync("bash", …)`) — no Windows-native
  path.
- **No prior art** for "release-complete" / "required contract manifest" / "filtered diagnostic
  run" anywhere in `scripts/`, `ui-audit/`, `test/`, `e2e/`, `docs/`, or `BACKLOG.md` — safe to
  introduce the vocabulary fresh (done narrowly in R1; the full contract-manifest system is R2).
- **Dedupe check (existing e2e-drift-gate / known-red items):** B267536 (pond/detention family,
  shipped), B267537 (drift gate's own fixture pinned two rows of a shrinking ledger, shipped),
  B267538 (a full local sweep over-reports "new regressions" in a loaded sandbox, Open,
  `Blocker: ci-run`), B266081 (the ledger/stopping-rule item, Open, tracks the 9 remaining rows).
  None of them names the skip-misclassification bug this session fixes; B1857904 is net-new.

## R1 — parser/status fix: **SHIPPED this session**

**Backlog:** B1857904. **Finding reproduced, independently, two ways:**

1. **Fresh capture against the locked runner.** An isolated `@playwright/test@1.61.1` run (three
   cases: a plain pass, a `test.skip()`, and a fail-then-retry-pass) produced, verbatim:
   `control-pass` → `ok:true, tests[0].status:"expected"`; `critical-skipped` →
   `ok:true, tests[0].status:"skipped", results:[{status:"skipped"}]` (**one** result, not an
   empty array); `control-retry` → `ok:true, tests[0].status:"flaky"`. `collectCases()` (pre-fix)
   reported these as `passed`, `passed`, `flaky` — the skip silently misclassified as a pass.
2. **The real fixture already in the repo.** `test/fixtures/playwright-report.sample.json` — a
   genuine capture, not hand-written — already carries a real skip: `auth.setup.js`'s
   "authenticate once" step, skipped whenever `E2E_EMAIL`/`E2E_PASSWORD` are absent (exactly this
   sandbox's condition). Nothing in `test/e2eDriftGate.test.js` had ever asserted on its status.
   Running `collectCases()` against it (pre-fix) returned `status: "passed"` for that case.

**Root cause:** `collectCases()` branched only on `spec.ok` (true for both a pass and a skip —
Playwright never counts a skip as a failure) and on `some(t.status === "flaky")`. It never checked
for `tests[].status === "skipped"`, so a skip fell through to the "passed" branch.

**Fix (`scripts/lib/e2eDrift.mjs`):** check `tests[].status` for an all-skipped spec **before** the
`spec.ok`/flaky branch. Narrow and additive — a real failure, a real pass, and a real flaky-retry
all classify exactly as before; only the skip case changes, from `passed` to `skipped`.

**Why it matters beyond a label:** `nextLedger()`'s `--update` path drops a ledger row the instant
its case reads `"passed"`. Pre-fix, a required case that merely **failed to run** (missing secret,
filtered project) — never one that genuinely passed — could have silently discharged a real
known-red row from the ledger with the underlying defect never re-checked. Post-fix, a skipped
ledgered case lands in `absent` (reported, not fatal, not treated as a fix) — the same bucket a
renamed-away case already used.

**Completeness signal added (`assessCompleteness()`, same file):** a pure function distinguishing a
full run from one narrowed by `--shard` (via `report.config.shard`) or `--grep`/`--project` (via
`report.config.argv` — **not** `config.grep`/`config.grepInvert`, which Playwright serializes to
`{}` in the JSON report regardless of whether a filter was passed; measured directly, both with and
without `--grep`, before relying on it). Wired into `scripts/e2e-drift-gate.mjs` as an **opt-in**
`--require-complete` flag and an always-printed status line — today's `ci`/`local` lanes are never
filtered, so this changes no existing verdict; it exists so a future required lane (R2) can demand
a full run without a second script. Deliberately **not** wired into `.github/workflows/e2e.yml` in
this PR — that is a CI-file change, left for the R2 packet that will actually consume it, per the
"narrowest safe" instruction for this stage.

**Tests added (`test/e2eDriftGate.test.js`):** the hand-written `report()` fixture helper's skip
shape was corrected to match the real capture (`ok:true`, one `"skipped"` result — it previously
modeled `ok:false, results:[]`, which does not occur in a real report and is exactly how this bug
went unnoticed by the existing "distinguishes a skipped case from a failed one" test). Added: a
direct assertion against the **already-committed real fixture**'s "authenticate once" row; a
regression test with an explicit mutation-proof comment; `compare()`/`nextLedger()` tests proving a
skipped ledgered case now lands in `absent` rather than falsely `stale`; a full suite of
`assessCompleteness()` tests including a pinned assertion that the real `e2e.yml` invocation reads
as `full`.

**Mutation proof performed:** reverted `collectCases()` to the pre-fix branching, re-ran the suite
— exactly the 3 targeted regression tests failed (`expected 'passed' to be 'skipped'` ×2,
`expected 'passed' not to be 'passed'`), all 39 others stayed green; restored the fix, all 42 green
again.

**Verification, this session:** `npm run lint` → 0 errors (36 pre-existing hook-dependency warnings,
none in touched files). `npm test` → 894 files / 18,260 tests, all green, no regressions. CLI
script exercised end-to-end against both the real fixture and a live filtered (`--shard=1/2`)
capture: default behavior unchanged (exit 0, new info lines only); `--require-complete` correctly
refuses a filtered run (exit 2, names the reason).

**Verify:** sandbox (unit tests + the mutation proof above are sufficient proof; no live-only
class from `CLAUDE.md`'s `LIVE-VERIFY` list applies to a parser/status fix with no UI surface).

## Stage gate — what must be true before R2 starts

Per the dispatch brief: *"Continue into R2 only after inspecting concurrent changes to the same CI
files and proving the chosen interaction tests reliable."* Concretely, before starting R2 a session
must:

1. Re-fetch `origin/main` and re-list open PRs; check specifically for any PR touching
   `.github/ci-gates.yml`, `.github/workflows/build.yml`, `.github/workflows/e2e.yml`,
   `playwright.config.js`, or `scripts/ci-parity.mjs` — R2 adds a new Playwright config and wires a
   new lane into the required build, so a collision here is real, not theoretical.
2. Build the small critical-interaction manifest (`REL-01` … `REL-09` in the original brief below)
   incrementally, and for **each** new spec, run it enough times (not once) to show it is not
   flaky before it goes anywhere near the required `build` check — a critical lane that is itself
   unreliable is worse than the gap it was meant to close.
3. Only then extend `.github/ci-gates.yml` / `playwright.critical.config.js` and wire completeness
   into the required build.

**Do not start** (until their own stated preconditions hold, independently of R2): planner state
extraction (R6 — gated on B217540 per the existing decomposition plan), persistence engine
rewrites, scheduler build migration (R8), schema changes, production data mutation, or a React
upgrade. None of these were touched this session.

## R2–R9 — recorded, not started

The full original brief is preserved below verbatim so no detail is lost between sessions. Treat
its file paths, line-count figures, and "reviewed commit" references as a **2026-09-20 snapshot**,
superseded by whatever R0 measures fresh at the start of whichever session picks up R2 — the brief
says this about itself ("Refresh changed facts only; do not restart a broad architecture audit").

<details>
<summary>Full original brief (2026-09-20) — click to expand</summary>

# Planyr reliability implementation brief

Prepared for Michael Butler and the Claude implementation agent · 20 September 2026

**Purpose:** reduce recurring user-visible defects by improving release evidence, testing state transitions, and separating ownership of application state. This is an implementation programme, with bounded work packets and acceptance criteria. It is not a recommendation to rewrite the application.

**Reviewed source:** `mikeab7/planyr`, commit `27671fa07ea186a638d563f84cd81ac87cfb0af0`. References and measurements below describe that commit, not whichever version happens to be live when this document is read. The local working checkout used to prepare this brief was older; current code was inspected through Git objects without replacing working files.

**Delivery state:** preparation only. No product changes, database changes, application deployment, or full application test run was performed. `evidence.json` and `reproduce-review.mjs` accompany the brief. Proposed scripts, configurations, test contracts, and work-packet labels are explicitly proposals; they do not already exist unless identified as existing.

## 1. Start here: instructions for Claude

1. Read this brief once, then work one packet at a time. Read current root and relevant folder instructions, including `CLAUDE.md` and any `AGENTS.md`; do not copy historical instructions blindly from this snapshot.
2. Fetch current `main`, record its SHA, preserve unrelated work, and create an isolated implementation branch. Compare the mapped files against the reviewed commit. Refresh changed facts only; do not restart a broad architecture audit.
3. Execute R0, then R1 and R2. These create trustworthy release protection. R3 and R4 follow; R5/R6 concern planner extraction. R7 is incremental type checking. R8 is scheduler build integration. R9 closes the programme against measured outcomes.
4. Use existing canonical modules and existing tests wherever possible. There are already 140 browser-spec files and extensive persistence tests. Do not build a second framework, save engine, keyboard router, or defect tracker.
5. Each packet ends with code, meaningful verification, an exact delivery state, and an updated progress record. Keep implementation PRs independently reviewable and revertible. A packet may require several PRs.
6. Do routine investigation, implementation, and testing autonomously once Michael dispatches this brief for implementation. Follow his actual authorization and repository delivery rules for commits, PRs, merges, and deployment. This preparation document itself is not evidence of approval for destructive production actions, data backfills, or a major rewrite.
7. Do not ask Michael to perform the browser testing. Use the repository's browser harnesses and isolated fixtures. If a required signed-in test cannot run, state the exact missing environment capability; finish independent work and do not represent simulated coverage as live database coverage.

### Important refinements to the original review

- The required build **already includes visual regression checks**. Add interaction protection alongside them; do not replace them.
- The planner's hook counts are **whole-file textual occurrences**, not an AST measurement of one component. File size indicates coupling risk; it does not prove a specific runtime bug.
- Of 881 unit-test files, 300 contain `readFileSync`. Some read fixtures and also execute real logic. Do not classify all 300 as inadequate or delete them in bulk.
- Nine recorded known-red entries represent **seven CI cases and two local cases**, with overlap between lanes. They are concentrated in GIS identification. They are recorded debt, not newly reproduced failures.
- The missing-case gate behavior is intentional in existing tests. Strengthening the release contract requires an explicit distinction between complete required runs and filtered diagnostic runs, not just changing one boolean.
- An existing planner decomposition programme already defines a safer order. **Use hover/cursor first and persisted model state last**, superseding the earlier conversational suggestion to begin with inspector/selection extraction.
- Existing production telemetry, local/cloud persistence, concurrency tests, performance probes, and visual baselines are assets to extend. None should be replaced merely because this brief proposes stronger guarantees.

## 2. Findings and confidence

| Finding | Evidence at reviewed commit | Confidence and limit |
|---|---|---|
| Full interaction suite is not in the PR gate manifest | `.github/ci-gates.yml` runs unit tests and visual checks; `.github/workflows/e2e.yml` schedules the broad suite at `30 13 * * 1-5` plus manual dispatch | Confirmed from configuration; live branch-protection settings and workflow runs were not inspected |
| Missing cases can leave drift comparison green | `scripts/lib/e2eDrift.mjs`, `compare`: `ok` depends on novel failures and stale exceptions, not absent cases | Reproduced by invoking production comparison code with a missing ledger case |
| Parser classifies a real skipped test as passed | `collectCases` prioritizes `spec.ok`; the real skipped case has `spec.ok: true` | Reproduced with Playwright 1.61.1, matching the reviewed lockfile; actual and parsed statuses are in `evidence.json` |
| Planner has broad shared state | `SitePlanner.jsx`: 33,924 lines; 264 `useState`, 106 `useEffect`, 187 `useRef` textual occurrences | Confirmed measurement; not a complexity score or causal proof by itself |
| Scheduler bypasses normal JSX build path | `public/sequence/index.html`: 18,904 lines, two `text/babel` blocks, runtime Babel CDN script | Confirmed; an existing syntax guard partially mitigates this |
| Hook defects are nonblocking | `eslint.config.js` keeps both hook rules at warning severity | Confirmed. Prior targeted lint of current planner using installed local tooling reported nine dependency warnings; that was not full locked-dependency CI |
| Some regression checks are implementation-text assertions | `test/bugHuntGuards.test.js`, B506/B507 saving rejection checks | Confirmed example; not a verdict on all source-reading tests |

The first two release changes address directly observed gaps. Architectural extraction is a preventative design change. Its benefit must be demonstrated through bounded behavior and recomputation evidence, not asserted from a smaller file.

## 3. Existing architecture and invariants to preserve

### Planner ownership map

| Responsibility | Existing implementation | Preserve |
|---|---|---|
| Workspace lifecycle, plan selection | `src/workspaces/site-planner/SitePlannerApp.jsx`, `SitePlanner.jsx` | Opening plan B must not receive delayed work belonging to A; keep-alive workspace behavior |
| Canonical plan shape and normalization | `lib/siteModel.js` | Additive schema evolution, migration of old plans, existing geometry and unit conventions |
| Local persistence and cloud merge coordination | `lib/storage.js`, `lib/localDb.js`, `lib/activeUser.js`, `lib/cloudSync.js` | User/account scoping, durable deletes, recovery, distinction between user work and disposable caches |
| Per-element write queue | `lib/elementSync.js`, `lib/elementApi.js`, `lib/elementRows.js`; `src/shared/cloud/serializeWrites.js` | Existing diff/shadow model, serialized writes, create/delete and gesture boundaries, conflict policy and visible errors |
| Keyboard and drafts | `lib/keyContract.js`, `lib/drafts.js`, `src/shared/keyboard/keyScope.js` | Field editing owns its keys; deliberate canvas deletion still works; undoing a draft differs from undoing committed geometry |
| View/model performance separation | `ui-audit/lib/viewIndependentRegistry.mjs`, recompute probes | Pan/zoom must not repeatedly recompute model-only geometry; every promised computation must remain observable |
| Project-name authority | `lib/projectName.js`, `siteModel.js`, storage/cloud seams | Dedicated rename stamps must survive stale caches and merge; do not substitute generic `updatedAt` |

Paths beginning `lib/` in this table are relative to `src/workspaces/site-planner/`.

### Nonnegotiable data behavior

- Persisted elements, IDs, coordinate values, group membership, and tombstones must not change because of a structural extraction.
- Seeded canonical rows must retain authority at the reconciliation seam. Moving state must not make stale local geometry overwrite a freshly seeded version.
- Deletions must include their existing cascade and durable tombstones. Reload, retry, or another tab must not resurrect intentionally deleted content.
- Preserve the actual conflict behavior already implemented by the engine. Its comments describe revision-aware retry with loud notification; do not silently replace that with a newly invented conflict policy.
- Never label work saved merely because a timeout elapsed or a request started. Preserve local-versus-cloud status semantics.
- One operation must create the intended history entry. Pointer previews must not become dozens of independent undo actions; redo after undo must be tested.
- No engineering-rate, geometry-algorithm, regulatory-source, or coordinate-system changes belong in this reliability programme.
- Keep existing `planarfit:*` storage keys unless a separately reviewed migration explicitly covers old installations. Renaming keys for cleanliness would orphan data.

### Scheduler boundary

`src/workspaces/scheduler/Scheduler.jsx` embeds `/sequence/` in an iframe and communicates through messages. The standalone scheduler lives in `public/sequence/index.html`; useful extracted logic already exists under `src/workspaces/scheduler/lib/` and `src/shared/schedule/`.

Build migration must retain the route, iframe lifetime, message origin checks, navigation confirmation, standalone behavior, and persisted data shape. Replacing the iframe or redesigning scheduler state is separate work and not required to stop runtime Babel compilation.

## 4. Target test architecture

Use four named coverage layers with different claims. A passed lower layer never implies a passed higher one.

| Layer | Environment | Required claim | Proposed enforcement |
|---|---|---|---|
| Logic and contracts | Node, injected storage/network/clock, existing Vitest | Canonical operations, merges, serialization and status interpretation work | Every source PR |
| Critical interactions | Built app, fresh browser contexts, synthetic plans, deterministic service responses | User actions produce correct model and UI state through real handlers | Every source PR |
| Database integration | Disposable local/test backend; isolated users and plan IDs | Real RPC, permissions, transactions, retries and competing writers behave correctly | Required for persistence/auth/schema changes; expand as environment becomes dependable |
| Live service/deployment checks | Deployed app and real GIS services | Deployed bytes and external integration remain healthy | Post-deploy and scheduled; explicitly separate from deterministic release suite |

Keep visual regression and performance budgets. They catch different failures. The proposed critical suite should initially be small enough to be dependable, then expand by risk. Do not promote all 140 specs at once.

### Critical interaction matrix

These are proposed stable contract IDs, not repository B/V numbers or existing tags.

| Contract | Setup and action | Required outcome | Existing starting points |
|---|---|---|---|
| `REL-01-save-reload` | Create synthetic plan, draw building, change dimension, wait for actual save completion, reload same plan | IDs, geometry, edited property and visible object survive; no unrelated objects changed | `test/storage.test.js`, `test/storageAdapter.test.js`, `e2e/fixtures/sites/dense-testfit.fixture.json` |
| `REL-02-undo-redo` | Move/resize a building with attached children, undo, redo | Exact semantic before/after geometry and attachment integrity; one intended history step | `e2e/ctrlz-undo.spec.js`, `e2e/undo-selection-only.spec.js`, `test/undoResurrectAllKinds.test.js` |
| `REL-03-field-key-scope` | Edit inspector, then Enter/Escape/Tab/blur/stepper and Backspace/Delete; separately select canvas object and delete | Field interaction never deletes geometry; intentional canvas deletion still works | `e2e/inspector-key-scope.spec.js`, `test/keyContract.test.js` |
| `REL-04-plan-switch` | Edit A, delay its write, switch to B, then release A's response | A's data reaches A; B stays unchanged; status belongs to the right plan; return to A and reload | `e2e/clipboard-survives-plan-switch.spec.js`, `test/elementSync.test.js` |
| `REL-05-draft-cancel` | Start multi-point markup; remove a vertex with undo, cancel draft, repeat and finish | Draft operations do not undo unrelated committed objects; finished shape has expected points | `e2e/ctrlz-undo.spec.js`, `test/drafts.test.js` |
| `REL-06-delete-reload` | Delete building plus its normal cascade, reload, undo where supported by existing history contract | No accidental survivors or resurrection; undo restores intended members | `test/deletePersistence.test.js`, `test/undoToBlankPersists.test.js` |
| `REL-07-export` | Export a fixture with visible/hidden markup and scale-sensitive arrows/hatches | Real downloadable artifact exists and contains expected content/scale; a clicked button alone is insufficient | `e2e/callout-arrow-export-scale.spec.js`, `e2e/hatch-pattern-export-scale.spec.js`, `test/exportStyle.test.js` |
| `REL-08-scheduler-edit` | Edit task, commit through each supported exit, reload, undo/redo as supported | Persisted field matches input; neighboring task unchanged; navigation bridge still works | `test/schedulerSaveQueue.test.js`, `test/schedulerSaveState.test.js`, `e2e/schedule-ownership.spec.js` |
| `REL-09-save-failure` | Inject local-write failure and cloud timeout/rejection, then recover and retry | Unsaved work remains; status never falsely promises durability; retry converges without duplication | `test/saveFallbackCloud.test.js`, `test/elementApi.test.js`, `test/elementSyncConvergence.test.js` |

For each row record whether the initial implementation is local-only, simulated cloud, or real backend. R2 can first gate REL-01/02/03/05/06 plus a bounded export case. R4 adds the asynchronous persistence cases. Do not label partially covered rows complete.

### Fixture and assertion rules

- Build on the existing deterministic fixture generator and loader (`scripts/build-fixtures.mjs`, `e2e/fixtures/index.js`). Use the dense test-fit fixture for bonded children; a single rectangle cannot verify assembly invariants.
- Select a fixture by its known plan ID. Several old tests read the first key in local storage; do not propagate that assumption into multi-plan tests.
- Use fresh browser contexts and unique backend IDs. Parallel tests must not edit the same seeded row, even if they share authentication state.
- Actions go through the real UI. Read-only model inspection may verify an outcome; direct model mutation cannot stand in for the action being tested.
- Poll an observable condition or wait on an explicit request barrier. Avoid fixed sleeps as proof of saving or stability.
- A localStorage assertion is appropriate only for the local path it actually represents. Cloud paths need real returned rows, revisions, or independent backend reads in the integration lane.
- Fail critical tests on unexpected `pageerror`; classify intentionally injected errors narrowly. Do not globally suppress console/network failures to make a suite green.
- At least one targeted mutation or pre-fix run must demonstrate that each new critical contract detects the original failure. Use an isolated temporary branch/build, restore it, and record what assertion failed. Do not ship deliberate defects.

## 5. R0 — reconcile current state and establish baseline

**Deliverable:** a short baseline record, current command results, and a chosen first implementation slice. This is bounded reconnaissance, not a new white paper.

Read current `.github/ci-gates.yml`, `scripts/ci-parity.mjs`, `ui-audit/lib/ciGates.mjs`, `.github/workflows/build.yml`, `.github/workflows/e2e.yml`, `playwright.config.js`, and the existing decomposition plan at `docs/incidents/PLAN-SITEPLANNER-DECOMPOSITION.md`.

1. Record source SHA, Node version, installed Playwright/Vitest versions, browser build, and whether environment variables are real, dummy, or absent. Never record secret values.
2. Run `npm run ci-parity -- --list`, then the real `npm run ci-parity` in a compatible environment. The script relies on Bash/Linux tooling; use the repository's CI environment rather than pretending Windows approximations are identical.
3. Run selected critical browser candidates and collect machine-readable results. Inventory auth dependencies and live network calls before making them required.
4. Recheck B287058's decomposition prerequisites and B217540's current status through targeted item lookup. Old statements that a performance gate was green are not current measurements.
5. Classify existing failures as product defect, stale test, environment issue, or not yet understood. Preserve raw evidence. A failure outside the packet is not permission to weaken checks.

**Exit:** the implementer can name the current baseline and the dependencies of R1/R2. If full CI cannot run, record precisely which checks remain unexecuted and proceed with independent parser work; do not claim the baseline is green.

## 6. R1 — make test results trustworthy

**Existing files:** `scripts/lib/e2eDrift.mjs`, `scripts/e2e-drift-gate.mjs`, `test/e2eDriftGate.test.js`, `e2e/known-red.json`, `.github/workflows/e2e.yml`.

The drift gate is useful: it separates new failures from recorded exceptions and detects ordinary exceptions that now pass. Keep those behaviors. Add a distinct execution-completeness contract rather than requiring every historical test in every diagnostic command.

### Implementation decisions

1. Capture reports from the installed Playwright version with pass, skip, expected-failure, unexpected-pass, failed, interrupted, timed-out, retry-pass, and setup/global-error cases. Use browser-free runner cases where possible. Commit small sanitized real-reporter fixtures for the parser tests.
2. Interpret result and expected statuses deliberately. `spec.ok` does not establish that a test executed successfully. Preserve project identity; the same spec in multiple projects must not collapse into one passing row because another project passed.
3. Introduce a proposed versioned required-contract manifest. It maps stable IDs to required projects/lanes. Avoid identity based on source line numbers: inserting a comment must not rename a release obligation. Use supported tags/annotations or a deliberate stable marker supported by the installed runner, and validate uniqueness.
4. Separate **full required run** from **filtered diagnostic run**. Only full required runs can produce a release-complete verdict. Diagnostic output must explicitly say it cannot satisfy the release contract.
5. Required contract absent, skipped, interrupted, or failing is non-green. Runner startup/setup failure, global errors, malformed JSON, zero executed cases, duplicate contract identities, and an unexpected incomplete shard set are also non-green.
6. If sharding is introduced, merge reports before completeness evaluation or validate a declared per-shard contract and aggregate every required shard. One shard must not green-light the whole suite.
7. Keep flaky outcomes visible. Begin critical suite acceptance with zero retries or treat retry-pass as non-green there; broader live-service diagnostics may retain their existing retry policy. Do not confuse a diagnostic retry with proof of stable behavior.
8. Translate legacy ledger identities explicitly if necessary. Preserve owning item, lane, and original evidence; do not erase debt through renaming.

### Required parser/gate tests

| Input | Expected release verdict |
|---|---|
| Every required contract passed, no unexpected error | Complete/pass |
| A required contract absent while an unrelated smoke test passes | Incomplete/fail |
| Required test skipped because auth unavailable | Incomplete/fail for authenticated lane |
| Required test passed after a retry | Flaky/non-green for critical lane |
| One project passed, another required project failed | Fail |
| Global/setup error, plus some passing tests | Fail |
| Empty or truncated report | Fail with actionable diagnostic |
| Filtered developer run | Diagnostic only, never release-complete |
| New non-ledger failure | Fail; retain existing drift behavior |
| Ordinary ledger case now passes | Require explicit ledger cleanup; retain existing behavior |

**Mutation proof:** remove a required test; mark it skipped; inject a global error; make one required project fail. Each must defeat the release verdict. This guards the guard itself.

**Rollback:** revert parser, contract and workflow changes together. Never leave a manifest that the deployed parser ignores. Preserve old diagnostic behavior where intentional; do not silently change every local workflow.

## 7. R2 — add the critical interaction lane to the existing required build

**Existing files:** `.github/ci-gates.yml`, `ui-audit/lib/ciGates.mjs`, `test/ciGates.test.js`, `playwright.config.js`, `e2e/helpers.js`, `e2e/auth.setup.js`, relevant existing specs.

**Proposed additions:** `playwright.critical.config.js`, a critical-contract manifest, and small dedicated specs only where reuse is impractical. Names are illustrative; follow current repository conventions.

- Keep the gate list in `.github/ci-gates.yml`. Do not create a competing hard-coded sequence in `build.yml` or a shell script that silently diverges from `ci-parity`.
- Run against the exact build produced in that job, using the existing preview server when practical. Match configured/unconfigured build shape intentionally; visual checks already distinguish truthy backend configuration.
- Isolate the critical project from the global signed-in setup dependency when it is intentionally local-only. A missing account must not prevent useful local interaction protection.
- Stub only external nondeterministic boundaries for this lane. Document stubbed endpoints and fail unexpected outbound dependencies. A stubbed persistence response proves UI handling, not actual database transactions.
- Wire the new completeness check from R1 after collecting the report. Preserve nonzero runner exit status and upload reports/traces even on failure.
- Keep the existing docs-only optimization limited to genuinely documentation-only diffs. Test/config/manifest changes are source changes and must run their relevant checks.
- If a new job rather than an existing gate is unavoidable, inspect/update the repository's required-check contract and live protection configuration. A new job is not automatically a required check. Prefer extending the existing required build to avoid that migration.

**Proposed runtime target:** measure current candidates first; aim for a small critical lane around five minutes on CI, not a promised SLA. Report actual duration and retry count. Increase coverage in bounded increments instead of hiding slow or flaky tests with broad skips.

**Acceptance:** intentionally break a critical user behavior on a throwaway branch and verify that the PR's actual required check becomes red. A local command failing is necessary but does not prove merge enforcement.

**Delivery:** record actual PR check context, run link, tested SHA, and proof that the successful verdict belongs to the final mergeable head. Do not rely on a prior head's green status after conflict resolution.

## 8. R3 — retire the remaining known failures and improve regression tests

The snapshot ledger contains seven CI entries and two local entries. The local entries overlap the CI raster-hover and unavailable-identify scenarios. Five CI entries are marked intermittent with prior run evidence. These distinctions matter; do not describe this as nine independent product bugs.

### Known-red work

- Inspect `e2e/canvas-gis-identify.spec.js` and `e2e/layer-point-hover-identify.spec.js` with their owning B266081 record.
- Add deterministic responses for point identity, redacted identity, raster identification, dark/light rendering, and unavailable-service behavior in the critical/product test lane as appropriate.
- Retain a separate live probe that checks whether the real GIS service still answers its expected contract. A stub cannot replace endpoint health monitoring.
- Run the original failing case, determine whether the product or test is wrong, fix the correct layer, then remove only verified obsolete ledger entries. Preserve historical reasons in the existing tracker.
- Add an owner and review/expiry date to any exception that remains. An expired exception should require explicit disposition; automatic expiration must not delete the test or its obligation.

### Source-assertion triage

Classify source-reading tests into (a) legitimate static architecture guard, (b) fixture-driven behavioral test, and (c) source-text proxy for runtime behavior. Prioritize category (c) in saving, keyboard scope, undo, and plan switching.

First example: the B506/B507 checks in `test/bugHuntGuards.test.js` assert the spelling of saving rejection handlers. Add an executed failure-path test with deferred promises and actual state/status outcomes. Keep the static guard until the new test proves the regression and the old guard's unique value has been assessed.

Do not chase a coverage percentage or eliminate all source matching. A ban on direct GIS URLs is a reasonable static rule; a regex proving that a callback exists is not proof the callback handles a user's action correctly.

**Acceptance:** each replaced proxy has a documented behavioral invariant, a discriminating red proof, and an executed green result. No net loss of an architectural rule. The ledger count drops only when evidence supports the drop.

## 9. R4 — strengthen persistence and asynchronous state-transition coverage

**Existing tests to inspect first:** `test/elementSync.test.js`, `test/elementSyncConvergence.test.js`, `test/elementSyncOwnWriteGate.test.js`, `test/elementSyncUnloadGuard.test.js`, `test/elementApi.test.js`, `test/storage.test.js`, `test/storageAdapter.test.js`, `test/deletePersistence.test.js`, `test/saveFallbackCloud.test.js`, `test/schedulerSaveQueue.test.js`.

The engine is already injectable: timers, clients, and clocks can be controlled. Extend those seams rather than introducing real-time sleeps or a second queue.

### Required interleavings

1. Begin save A1; edit again to A2 before A1 resolves; resolve A1; verify A2 remains dirty and is eventually saved.
2. Begin A's save; switch to B; deliver A success, failure, and retry responses separately. B must not acquire A's geometry or a misleading save status.
3. Delete a parent with bonded children while an older update is pending. Deliver the old response last; confirm the delete/tombstone contract still wins according to existing semantics.
4. Retry a timeout where the server may have committed. Verify existing operation/revision handling converges rather than blindly duplicating elements. Do not invent idempotency keys without tracing the actual API.
5. Two writers edit a synthetic plan. Verify the current conflict policy and user notification, not a new policy inferred from a test name.
6. Undo to an empty plan, save, reload, then receive a stale pull. The previous objects must not reappear.
7. Change account/workspace while asynchronous work is pending. Ensure callbacks retain the intended identity and subscriptions are disposed or safely ignored.
8. Fail local storage with cloud available, fail cloud with local available, then fail both. Verify the UI's durability claim and retention of unsaved work in every supported path.

Use a small explicit transition table as the test oracle. Derive expected states from the repository contract; do not copy the implementation's branching into the test. Add a few seeded operation sequences only after the basic cases are legible and deterministic.

### Database validation boundary

Use a disposable backend/test project and uniquely owned fixtures. Run actual RPC and RLS tests for persistence/schema changes. Existing SQL tests are under `src/workspaces/site-planner/db/test/` and `src/workspaces/scheduler/db/test/`; determine which are run by current CI rather than assuming the Node test glob executes SQL.

Do not run destructive seed scripts, migrations, or backfills against Michael's production account. Read current Supabase guidance and CLI help before choosing commands. A browser context isolates browser storage, not a shared database. Admin credentials stay in the runner environment and out of browser code and artifacts.

**Acceptance:** relevant interleavings are reproducible without wall-clock luck; cloud claims have backend evidence; unchanged durable data formats and normal single-user editing behavior are demonstrated.

## 10. R5 — investigate effect warnings and set a sustainable correctness gate

**Existing:** `eslint.config.js`; planner warning locations from the initial review included the viewport-related effect, autosave dependencies, a callback reading hidden groups, and a layout effect. Refresh diagnostics with the current locked toolchain before editing; line numbers move.

1. Inventory warnings and suppression comments only in the first touched module. Classify every warning as a genuine stale-state risk, intentional nonreactivity with an established mechanism, or analyzer limitation.
2. Fix the underlying lifecycle: stable callbacks, functional updates, narrowed effects, and correct subscription cleanup where appropriate. Do not append every suggested dependency blindly; that can cause save loops or expensive view-driven recomputation.
3. Test changed values, unmount/remount, plan switch, late responses, and repeated renders. Pair the bug-prevention assertion with a positive control proving legitimate actions still work.
4. Make `react-hooks/rules-of-hooks` an error after confirming baseline validity. Introduce dependency-error enforcement per repaired/extracted module, or a justified no-new-warning baseline keyed to stable context. Do not make a warning-count-only ratchet that hides a new warning when an unrelated one disappears.
5. Document narrow exceptions with the actual invariant and behavioral test. No blanket file-level disabling or growing suppression list as the completion strategy.

**Version constraint:** the reviewed app uses React 18.3.1. Current React documentation discusses APIs not available in this version. Do not introduce `useEffectEvent` or upgrade React as an incidental dependency of this programme. Use version-compatible designs.

**Acceptance:** no new hook warnings in touched code; actual defects are covered by behavioral tests; view-independent invocation counts and save semantics do not regress.

## 11. R6 — extract planner ownership in measured slices

The existing `docs/incidents/PLAN-SITEPLANNER-DECOMPOSITION.md` is the architectural starting point. It distinguishes view state, model state, and UI-local state, and names the data risks. Read it, refresh its prerequisites, and extend its existing owning item rather than filing a duplicate programme.

### Ordered slices

| Slice | Change | Required protection |
|---|---|---|
| 0 | Refresh the computation registry and baseline counts | Every relevant computation observed; no false pass caused by missing instrumentation |
| 1 | Hover state and hover presentation | Hover on/off and hidden-object behavior; pointer movement does not invalidate model computation |
| 2 | Cursor/readout state | Readout updates correctly while pan/zoom remains correct; coordinates preserve existing units |
| 3 | Viewport ownership | Pan, zoom, selection hit-testing, drag endpoints, map overlays, resize and keep-alive lifecycle |
| 4 | Panel/chrome-local state | Open/close, focus restoration, viewport/narrow width, no accidental model changes |
| 5 | Menus, drafts and tool state | Draft finish/cancel/undo and inspector keyboard contracts remain green |
| 6 | Persisted model ownership | R4 integration evidence, canonical seed, tombstone, save and history contracts; explicit reviewed design |

Calling a custom hook from the same giant parent does **not** by itself isolate renders: its state still rerenders that component. To claim reduced invalidation, establish a real component/subscription boundary and pass stable commands and narrowly selected values across it. Avoid a single broad context value that changes on every pointer move and rerenders every consumer.

Before a slice, write a compact ownership contract: state owned, writers, readers, lifetime/reset key, asynchronous work, cleanup, and the command/query surface. Avoid exporting raw setter collections or moving a closure into another file with all parent variables passed through.

Preserve identity for existing model records. Do not add competing persisted stores, dual-write new model formats, or change undo storage as scaffolding. Keep the deferred whole-planner single-reducer rewrite deferred.

### Measurement and acceptance

Existing commands: `npm run perf:viewindep`, `npm run perf:recompute`; tests `test/viewIndependentRegistry.test.js`, `test/recomputeProbe.test.js`. Use their documented environment requirements.

- Capture before/after counters for pan, zoom, element edit and panel open/close against the same fixture and environment.
- The existing programme requires no counter regression and at least one improvement to claim a performance win; a behavior-preserving move with no improvement is scaffolding and must be labeled that way.
- A computation disappearing from observation is a measurement failure, not an improvement.
- Keep geometry golden tests exact where the repository requires exact equality; do not widen tolerances to make extraction pass.
- Run the critical workflow suite and changed subsystem checks on the final head. For viewport work, include positive movement controls so a frozen canvas cannot pass a no-recomputation assertion.

Land one slice at a time. Avoid simultaneous edits to the planner's shared state region. Revert a failed structural slice as a unit; do not repair it through a cascade of unmeasured guard booleans.

## 12. R7 — introduce type checking at stable boundaries

**Goal:** catch invalid operation shapes and missing fields before runtime while preserving JavaScript delivery. No whole-repository conversion is required.

Proposed first boundary: a small pure module or operation/result contract adjacent to `elementRows.js`, `elementApi.js`, `keyContract.js`, or scheduler save state. Choose after inspecting import fan-out. Persisted schemas and runtime data still need validation; TypeScript annotations cannot validate a downloaded JSON object.

1. Add a locked TypeScript development dependency and a dedicated no-emit configuration if absent on current main.
2. Use JSDoc plus `allowJs`/`checkJs`, or convert a small leaf module to TypeScript if tooling already supports it. Be explicit about which files and imported dependencies enter the checking programme; `include` alone is not a firewall against imported files.
3. Model discriminated operation/result shapes, nullable/optional fields, plan identity, and the relevant units. Do not erase every mismatch with `any`, casts, or `@ts-ignore`.
4. Keep runtime import compatibility and browser bundling intact. Add the small typecheck command to the single CI gate manifest only when the initial scope is clean.
5. Prove the check catches a wrong operation kind, omitted required field, and invalid result handling in temporary negative cases. Retain executable behavioral tests.

**Acceptance:** the bounded scope passes a reproducible typecheck, deliberate shape errors fail, runtime behavior and bundles remain compatible, and unchecked scope is named honestly. Do not treat 100% typing as the completion criterion.

## 13. R8 — compile the scheduler at build time

This is a separate workstream after the gate improvements. Preserve the existing iframe and route while replacing runtime JSX compilation incrementally.

### First PR: characterize and extract pure logic

Inventory the two `text/babel` blocks, global declarations shared between them, script ordering, CDN globals, styles/assets, `/sequence/` direct-entry behavior, and the parent bridge. Existing scheduler engine tests and inline-sync tests encode important duplication constraints. Read them before moving definitions.

Start with one pure utility already shared or duplicated with a module. Execute the old and extracted behavior against existing fixtures, including dense schedules and predecessor/summary rollups. Keep the runtime behavior unchanged.

### Subsequent PR: establish the build entry

Inspect `vite.config.js` and Cloudflare routing before choosing a multi-page entry or dedicated scheduler bundle. A file under `public/` is copied; simply changing a script tag there to `type="module"` does not prove its JSX is compiled. Establish a real build entry and verify output assets and `/sequence/` routing in the built preview.

Move bootstrap code into compiled modules while maintaining equivalent initialization order. Keep a thin HTML shell. Update the old syntax guard only after the build demonstrably checks the same code; do not remove protection first.

### Required acceptance

- `/sequence/` works on direct load and refresh; the embedded workspace works after switching away and back.
- Shell and iframe agree on active schedule after load, reload, and delayed messages. A stale iframe response must not reopen the wrong project.
- Task edit, every supported commit/cancel exit, undo/redo, predecessor change, save/reload, dense rendering and export retain their behavior.
- Core scheduler startup succeeds when the Babel CDN is blocked, and the built output no longer needs runtime Babel for the migrated code.
- Existing route/bundle budgets and browser visual checks pass. No unrelated React version upgrade, iframe removal, or data schema migration is bundled into this change.

**Rollback:** preserve the ability to revert the build-entry PR and restore the previously working deployment without migrating stored schedules backward. Do not maintain two competing save implementations as a fallback.

## 14. R9 — verify reliability outcomes and close the programme

Feature counts, lines removed, and total tests added are not sufficient outcome measures. Use existing bug records and telemetry; avoid a new dashboard until a concrete need exists.

Track a small weekly table for four weeks after the initial gates land:

- User-visible defects that escaped release, grouped by saving, editing/keyboard, rendering, export, scheduler, and external service.
- Recurrences of an already fixed defect family, with the failed contract named.
- Critical contracts executed/passed/skipped, first-attempt pass rate, and retry-pass rate.
- Time spent repairing or bypassing the gate; false failures attributed to actual causes.
- Uncaught errors from relevant surfaces, with build identification, using existing `src/shared/telemetry/clientErrors.js` plumbing where supported. Verify fields before promising a deployment-level metric.
- Planner invocation counts for the fixed fixture as extraction proceeds.

Record a pre-change baseline if historical data permits. If it does not, say baseline unavailable and begin measurement; do not invent a numerical reduction target from memory. No automatic monitor was created by this brief.

### Completion is evidence, not a statement

The initial stabilization milestone is complete when R1/R2 are merged and demonstrably required, the critical suite has no silent omissions, R3's cases have explicit current dispositions, and critical persistence/keyboard regressions have executed protections. Architectural migration can then proceed slice by slice without calling the entire programme complete early.

Overall completion requires the agreed extraction scope, bounded typecheck and scheduler build work to be delivered, or a clearly documented scope decision that defers named packets. End every report with exact status: local, tested, committed, PR open, merged, deployed, and behavior verified. A merge does not prove deployment; deployed bytes do not prove behavior.

## 15. Sequencing, rollout, and rollback

Recommended dependency chain:

`R0 → R1 → R2 → R3/R4 → R5 → R6 slices 0–5 → R6 model slice only if prerequisites hold`

R7 can begin on a small stable leaf after R2; R8 can begin after its scheduler interaction protections exist. Do not combine R6 model ownership, a new persistence schema, and R8 in one PR. Expect multiple small PRs, not one omnibus patch; estimates should be made from R0 measurements rather than this document's length.

For every PR record:

1. Concrete trigger, prior outcome and corrected outcome.
2. Existing invariant preserved and new contract added.
3. Tests actually run, tested SHA, environment, and discriminating failure evidence.
4. Known limitations, including simulated versus real-backend coverage.
5. Revert unit and any compatibility consequences.
6. Merge and deployment evidence when those actions are authorized and performed.

Current repository policy at the reviewed commit prohibits branches from editing generated `MAP.md`, `BACKLOG_OPEN.md`, and `docs/UI-INVENTORY.md`. The regeneration workflow owns them. Use current backlog/inbox conventions and `safe-merge` guidance instead of reintroducing shared-ledger conflict churn. This is another reason not to follow the older checkout's instructions mechanically.

Do not approve visual baseline changes merely because pixels differ. Examine the diff and state the intended visual change; most reliability changes should not require broad baseline resets.

## 16. Research sources and version cautions

Repository evidence is pinned to the reviewed SHA. These official references were consulted on 20 September 2026; verify against installed versions when implementing.

- [Playwright retries](https://playwright.dev/docs/test-retries): distinguishes first-pass success from retry-pass/flaky outcomes. Use that distinction explicitly in gate policy.
- [Playwright isolation](https://playwright.dev/docs/browser-contexts): fresh contexts isolate browser state. They do not isolate shared backend rows; unique server-side fixtures remain necessary.
- [React effect dependency guidance](https://react.dev/learn/removing-effect-dependencies): restructure effects to reflect actual reactive dependencies instead of suppressing the linter. This app is React 18; examples using newer APIs need adaptation.
- [TypeScript checkJs](https://www.typescriptlang.org/tsconfig/checkJs.html): supports checking JavaScript alongside `allowJs`, enabling a bounded migration.
- [Supabase testing overview](https://supabase.com/docs/guides/local-development/testing/overview): distinguishes database-level tests from application-level tests and recommends independent application test data. Existing repository migrations and actual authorization semantics remain authoritative.

The Supabase markdown changelog endpoint could not be read through the research tool because of its content type. No Supabase upgrade, command, or migration is prescribed here on the strength of an unchecked changelog. Refresh relevant documentation and CLI help before any such implementation.

## 17. What has and has not been verified during preparation

Verified through source inspection and isolated execution: pinned source identity; gate configuration; source-size and test inventory measurements; current recorded known-red entries; missing-case comparison behavior; real browser-free Playwright report interpretation as captured in `evidence.json`; the existing state-ownership programme and representative persistence/interaction tests.

Not performed: complete application CI, authenticated browser runs, actual live GIS reproduction, database queries, schema/migration execution, deployment inspection, branch-protection API inspection, performance probe baseline refresh, or a production telemetry analysis. These are implementation packet obligations where relevant, not hidden assumptions behind the recommendations.

## 18. First-session deliverable

Claude's first implementation session should produce the refreshed R0 baseline and a narrow R1 PR: real reporter fixtures, explicit status handling, and tests for release completeness. If the required-manifest design needs more work, split it into the following PR; do not wedge all existing diagnostic runs by globally treating every historical absent case as fatal.

The next session should put a small proven interaction set into the existing required build. Only then start moving planner state. This ordering gives the structural work protection that the original codebase did not consistently have.

</details>

## Note on the brief's accompanying files

The brief refers to `evidence.json` and `reproduce-review.mjs` as accompanying attachments. **Neither was
uploaded to this session** — the brief itself says so, and no such files were received or executed here.
This session's R1 evidence was produced independently: a fresh isolated capture against the locked
`@playwright/test@1.61.1`, and direct execution of `collectCases()` against the real, already-committed
`test/fixtures/playwright-report.sample.json`. Both are reproducible from the commands in the R1 section
above and from `test/e2eDriftGate.test.js` itself.
