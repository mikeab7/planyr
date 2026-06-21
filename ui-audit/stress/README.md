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

## Round 3 (2026-06-21) — the load/deserialize path, all fixed
A different angle: the one place untrusted data enters — a corrupt Supabase `data`
jsonb row or a hand-edited `<script id="planar-data">` block. `stress-scheduler3.mjs`
ran the full load pipeline `ensureContacts(normalizeIds(ensureHolidays(normalizeToV6(d))))`
on 24 malformed shapes and found **13 crash modes**, all in the first/undefended
normalizer. A throw here bricks the scheduler — the load `catch` re-runs `normalizeToV6`
on the seed, so a malformed seed hangs forever on the loader.
7. **CRASH ×13** — null/missing/array `projects`; null/string projects; missing,
   null, object, or numeric `tasks`; null tasks; a null contact name; a non-string
   `responsibleParty`. → `normalizeToV6`/`normalizeIds` now skip null/garbage projects
   and coerce `tasks` to an array (mirroring the guards the sibling normalizers already
   used); `ensureContacts` `String()`-coerces names and `responsibleParty`. Good data is
   unchanged (every project + task preserved).

## Round 4 (2026-06-21) — interface boundary + extreme values
Two more angles: the schedule↔shell postMessage bridge, and rendering with a
valid-but-extreme date.
8. **SECURITY/ROBUSTNESS** — both message handlers (`index.html` and `Scheduler.jsx`)
   checked `m.source` but **not `e.origin`**, so a cross-origin embedder could drive
   state-mutating commands (switch project, open dashboard, create a project) or spoof
   the breadcrumb's project list. → both now require `e.origin === window.location.origin`
   (the iframe is always same-origin, so legit messages are unaffected).
9. **SLOW** — `buildGanttSVG`'s month-header loop was unbounded; a valid-but-extreme end
   date (e.g. a typo'd year 9999) built ~95,700 month cells + a huge SVG. → capped at
   12,000 months (1000 years), far beyond any real schedule.

## Round 5 (2026-06-21) — tree-editing ops + custom-status settings
- **Tree editing is robust by construction.** There is no drag-to-reparent for tasks
  (row drag-drop only reorders columns); indent reparents to a preceding sibling,
  outdent to the grandparent — neither can form a cycle — and paste id-remapping is
  correct. The downstream (`sortByVisualOrder`/`renumberTasks`/`cascade`/`rollup`) is
  cycle/orphan-hardened from earlier rounds. No fix needed.
10. **CRASH** — `rebuildHEALTH` ran in an effect on every settings change but iterated
    `customHealth` and `healthLabelOverrides` unguarded; a corrupt non-array, a null
    custom-status entry, or non-object overrides threw — uncaught in the effect, breaking
    the app. → coerce to array, skip null/garbage entries, guard the overrides object.
