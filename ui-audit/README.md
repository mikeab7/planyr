# ui-audit — UI screenshot harness

Dev tooling for the UI workstream (see `../UI_AUDIT.md`). **Not** part of the app
build or deploy.

- `capture.mjs` — drives a headless Chromium (Playwright) over `vite preview` and
  writes screenshots to `screens/`. It seeds a representative all-element-types site
  into `localStorage` so the app boots straight into the planner — no Supabase
  credentials and no map tiles required.
- `screens/` — the captured screenshots (a point-in-time snapshot; re-run to refresh).

## The speed program's instruments (B1344–B1360)

Four tools, and it matters which question each one answers:

- `perf-harness.mjs` — the budget run. Adds `--long-session` (B1357): the identical reference
  gestures at t=0 and after each round of a realistic session workload, with two arms
  (`--arm hold` = the plan never changes, so anything that moves is RETENTION; `--arm grow` = elements
  are added, which sizes LOAD), a noise floor measured in the run itself, and a verdict that says
  `unsustained` or `inconclusive` rather than guessing. Protocol in `lib/longSession.mjs`,
  decision layer unit-tested in `test/longSession.test.js`.
- `diagnose-zoom-cost.mjs` — WHERE a frame's time goes, not just how long it is: Chrome's own
  script / recalc-style / layout accounting with paint as a stated residual, `--profile` for a
  per-function CPU profile, `--mutate` for a page-side A/B (the drop-shadow question, B1354),
  `--open-panel` to measure with an inspector docked, and `--gesture wheel|drag|hover`.
- `diagnose-pan-commits.mjs` — how many React commits and DOM writes ONE pan frame costs.
- `verify-stall-lod-parity.mjs` — the pixel bar. Two builds, five zoom rungs plus the exported
  sheet, byte-identical or one unit of 255. Any render change in this program passes it first.

⚠ Every one of these has been wrong at least once in a way that looked right. Read the
MEASUREMENT BLOCKER notes in `perf-harness.mjs` before trusting a number from any of them: a
gesture that moved nothing, a starved frame sample, a boot-chunk snapshot that races the machine's
own speed, and a noise floor of zero have each produced a confident, false answer here.

## Run
```bash
npm run build
npm run preview &                 # serves dist on :4173
npm install --no-save playwright  # kept out of package.json on purpose (dev-only)
node ui-audit/capture.mjs
```
If the environment's managed Chromium revision differs from the Playwright package's
expected one, point it at the installed binary:
```bash
PW_CHROME=/opt/pw-browsers/chromium-1194/chrome-linux/chrome node ui-audit/capture.mjs
```

## Scope / limits
- Auth-gated cloud views are out of scope (no backend credentials here).
- Map basemap tiles are blocked by the environment network policy, so `map.png`
  shows chrome only (expected, not a defect).
- Document Review's measure/markup/takeoff tools only render with a PDF loaded, so
  only its empty state is captured here; audit those from code or a future PDF pass.
