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
- `stress-scheduler.mjs` — hammers the engine with malformed / hostile / boundary
  inputs and reports CRASH / HANG / WRONG findings. `node ui-audit/stress/stress-scheduler.mjs`
- `smoke-sequence.mjs` — loads `/sequence/` in headless Chromium to confirm the page
  still compiles + renders the Gantt. Needs `playwright` installed and a running
  `vite preview` (`npm run build && npx vite preview --port 4173`).

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
