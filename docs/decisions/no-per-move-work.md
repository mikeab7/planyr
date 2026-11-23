# Named rule NO-PER-MOVE-WORK

_Backstory moved verbatim out of `/CLAUDE.md` (audit batch H, 2026-11-23). Nothing below was reworded, shortened or removed: the rule in force is still stated in `/CLAUDE.md`, and this file is the full text and history behind it._

---

- **NO-PER-MOVE-WORK** — **No feature may add per-pointer-move work to the planner.** A pan move, a wheel-zoom step and a drag
  move rebuild no grading surface, post no worker job, re-encode no picture, and commit React about once per move; whatever a
  gesture changes is rebuilt ONCE, at the release (owner 2026-10-30: "improve the speed of the software"; B2596704–B2596708).
  **The budgets, as numbers** (owner's Concept A on the real Chehaw ground, grading + contours + cut/fill + paper on, production
  build, CPU throttled 4×, 1913×1000 at DSF 2.15 — `ui-audit/planner-perf-budget.json`): pan ≤ 16 ms of main-thread work per
  move · a zoom step's picture ≤ 1.5 s, never re-running the surface · mode switch ≤ 3 s · open → picture ≤ 4 s · no task
  > 50 ms outside `runChunked` slices. **The last two are NOT met today** (B2596707 / B2596708; ratcheted, so they may not get
  worse). Measure with `npm run perf:planner:profile` (the cost table, `docs/perf/PLANNER-SPEED-ROUND.md`); the COUNTS are a
  required build gate (`node ui-audit/verify-planner-perf.mjs --counts`, red on the pre-fix engine, VOID unless its known-slow
  `?perfMutant=1` arm fails); the timings run on demand (`npm run perf:planner`) before shipping anything that touches render or
  grading. A memo keyed on an object rebuilt every move (a Map, a fresh array) IS per-move work — key it on a value.
