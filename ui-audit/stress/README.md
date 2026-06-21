# Scheduler stress harness

Adversarial input testing for the **Scheduler** date/cascade engine
(`public/sequence/index.html`). Run after touching any of the date math
(`addBD`, `difBD`, `calcEnd`, `cascadeDates`, `rollupParentDates`, `parseFlexDate`).

The engine lives inside a single in-browser-Babel HTML file and isn't importable, so
`scheduler-engine.mjs` is a **faithful copy** of those functions. The vitest suite
`test/schedulerEngine.test.js` runs the same checks on every `npm test` and includes an
**anti-drift** block that asserts the guard lines still exist in the real `index.html`.

## Files
- `scheduler-engine.mjs` — verbatim copy of the engine helpers (keep in sync).
- `stress-scheduler.mjs` — round 1: malformed / hostile date & graph inputs; reports
  CRASH / HANG / WRONG. `node ui-audit/stress/stress-scheduler.mjs`
- `stress-scheduler2.mjs` — round 2: predecessor parsing, the four constraint types,
  and cascade/rollup performance at scale. `node ui-audit/stress/stress-scheduler2.mjs`
- `check-babel.mjs` — extracts the inline `<script type="text/babel">` and runs it
  through esbuild's JSX loader to confirm it still compiles after an edit (a fast
  stand-in for a live browser when the sandbox won't keep a preview server alive).
- `smoke-sequence.mjs` — loads `/sequence/` in headless Chromium to confirm the page
  renders the Gantt. Needs `playwright` installed and a running `vite preview`.

## What it found (2026-06-21) — all fixed
1. **CRASH** — orphaned `parentId` (child points at a missing task) threw in
   `rollupParentDates`, taking down the whole recompute. → guarded.
2. **CRASH** — one malformed date string (`addBD`/`difBD` → `fd()` → `toISOString()`)
   threw `Invalid time value`. → invalid dates are now a no-op.
3. **HANG** — no upper bound on duration; a typed/pasted huge value looped per business
   day (1e9 ≈ 13 min frozen tab). → iteration capped (`MAX_BD_STEPS`) + input clamp.
4. **WRONG** — fractional duration over-counted; `parseFlexDate` accepted impossible
   dates (`2/31` → silently rolled to Mar 3; `-5/-5/-5` → `"NaN-NaN-05"`). → truncate +
   reject non-finite parts and impossible calendar dates.

## Round 2 (2026-06-21) — all fixed
5. **HANG** — `rollupParentDates` re-scanned every task on each convergence pass and
   made O(depth) passes → O(n²·depth) blow-up (~11s at 1000 levels deep). → index
   children once + process parents deepest-first (settles in one pass). 1000-deep:
   11,163ms → ~54ms. Output proven identical to the original on 40 random trees.
6. **CRASH** — `buildGanttSVG` dereferenced `t.name.length`; a nameless task crashed
   the Gantt PDF/print exhibit. → coerce name; also filter unparseable dates so one bad
   value can't poison the exhibit's min/max into NaN geometry.
