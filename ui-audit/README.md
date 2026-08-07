# ui-audit — UI screenshot harness

Dev tooling for the UI workstream (see `../UI_AUDIT.md`). **Not** part of the app
build or deploy.

- `capture.mjs` — drives a headless Chromium (Playwright) over `vite preview` and
  writes screenshots to `screens/`. It seeds a representative all-element-types site
  into `localStorage` so the app boots straight into the planner — no Supabase
  credentials and no map tiles required.
- `screens/` — the captured screenshots (a point-in-time snapshot; re-run to refresh).

## The speed program's instruments (B1344–B1360)

Five tools, and it matters which question each one answers. **The axis each one varies is the
whole point** — three of them vary how much is DRAWN or nothing at all, and one varies how many
times the view has been MOVED, which is a different question with a different answer:

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
- `interaction-degradation.mjs` — the INTERACTION-COUNT axis, which nothing above varies. One
  identical, **viewport-neutral** probe (pan out-and-back + wheel in-and-out) run at N = 0, 50,
  150, 400, 1000 gestures on **unchanged content**, against an `idle` control arm that waits the
  same wall clock and takes the same probes. Deliverable is a **per-interaction growth table** —
  retained heap after a forced GC, renderer nodes, detached nodes (upper bound), Leaflet tiles,
  compositor layers, raster-area proxy, live listeners/rAF/timers/observers — each with a SLOPE,
  because a step at load and a per-gesture cost have the same endpoint delta and opposite
  meanings. **Must run headed, under `xvfb-run`** (see `lib/frameSampling.mjs`). Decision layer in
  `lib/interactionAxis.mjs`, unit-tested in `test/interactionAxis.test.js`.
- `diagnose-pan-commits.mjs` — how many React commits and DOM writes ONE pan frame costs.
- `detect-view-recompute.mjs` — **the VIEW-INDEPENDENT-ONCE detector** (`npm run perf:recompute`).
  Drives pan / wheel-zoom / single-element-edit / panel-open on a plan whose model and settings are
  FROZEN, and records per computation: identity, call count, ms, and a fingerprint of its INPUTS and
  of its RESULT. Anything that runs twice and answers identically is a violation. The comparison is
  STRUCTURAL on purpose — every instance of this defect returns a fresh object holding an identical
  answer, so `Object.is` (all React's memo does) reports "changed" on 100% of them. Needs the probe
  build (`--build`, i.e. `PLANYR_PROBE=1`; see `scripts/vite-plugin-recompute-probe.mjs`, which is
  inert without the flag). Decision layer in `lib/viewIndependence.mjs` + `lib/recomputeHash.mjs`,
  unit-tested in `test/recomputeProbe.test.js`. Enumeration: `docs/PERF-VIEW-INDEPENDENCE.md`.
- `verify-view-independent.mjs` — the GATE built on it (`npm run perf:viewindep`): a real pure pan,
  failing if any computation in `lib/viewIndependentRegistry.mjs` ran more than once — **or was
  never observed**, which is how a guard of this shape rots into a permanent green. It counts rather
  than looks because this defect draws the identical picture when broken, so every screenshot and
  behavioural test in this repo passes on it.
- `verify-stall-lod-parity.mjs` — the pixel bar. Two builds, five zoom rungs plus the exported
  sheet, byte-identical or one unit of 255. Any render change in this program passes it first.

## ⛔ WHICH PLAN AN INSTRUMENT IS POINTED AT — read this before quoting any number above

Every instrument in the section above defaulted to **Goose Creek** (`fixtures/goose-creek-plan1copy.json`),
because it was the only real plan anyone had committed. The owner has reported **Bain** and **Sylvestri**
as slow and the harness could open neither, so the whole program has been measuring the one site it CAN
open while he reports on two it cannot. **Goose Creek has no raster overlay at all**, so every null result
about rasters, compositing or texture memory taken on it was structurally guaranteed.

**⛔ THAT IS NO LONGER TRUE, as of 2026-08-07 — BOTH of the owner's reported-slow plans are committed,
verbatim, and the synthesised stand-in is GONE.** `bain-concept-a.json` and its generator
`build-bain-fixture.mjs` are DELETED rather than kept beside the real files: its element counts were the
owner's and its coordinates were invented, which is precisely the bound `../docs/PERF-BAIN.md` §6 put on
its own largest claim, and a synthesised fixture left in the tree is a synthesised fixture someone measures
again by accident.

- **`fixtures/bain-concept-original.json`** — site `smr9olizi5ue`, "Concept - Original" (Fort Bend), from
  `public.sites` JOINED to `public.site_elements`. 47 elements · 5 parcels · 1 pond · 38 of 47 rotated ·
  0 annotations. Both rasters at their measured parameters — and **two facts the synthesis did not have**:
  the sheet overlay is rotated **1.5°** (every arm ever run here composited it axis-aligned), and the
  underlay is `fromMap` with a live ArcGIS URL, i.e. **fetched, not read out of IndexedDB**.
- **`fixtures/sylvestri-concept-d-full.json`** — site `sms4zs8unbkg`, "Concept D - Sylvestri Retail"
  (Harris). 98 elements · 3 parcels · **16 callouts, 6 markups, 2 measures** · **NO sheet overlay at all**.
  The first plan this program has ever been able to measure that is not 0/0/0/0 on annotations, and a clean
  control because nothing it shows can be charged to a raster. ⚠ NOT the same file as
  `fixtures/sylvestri-concept-d.json`, which is a 22-element geometry bag for the dock-zone tests whose
  hosts have since been deleted from the live plan; neither replaces the other.
- **`../scripts/plan-dump-to-fixture.mjs`** — the SQL route from a real plan to a committable fixture, and
  the boundary that decides what is safe to commit. ⛔ **The elements are NOT in the site row**
  (`data.els` is `[]`, `elementsInRows` is true) — read only `public.sites` and a 47-element plan reports
  as zero. It strips identity fields, Storage keys and county appraisal records, and replaces callout text
  with a SHAPE-PRESERVING stand-in (exact line count, per-line length and whitespace positions) because a
  callout's cost IS its text and "Note 3" would delete the property the fixture exists to reproduce.
- **`raster-arms.mjs`** — the seven-arm decomposition of the raster hypothesis (blending · size · presence ·
  **rotation** · Bain's own geometry · the Goose Creek control), with a cost metric the rest of this program
  does not have: **paint / raster / decode / composite**, read from Chromium's tracing. The existing
  un-quantised work figure is `Script + Layout + RecalcStyle` — all main-thread work that happens *before* a
  pixel exists — so it is structurally blind to blending. Findings in `../docs/PERF-BAIN.md`.
- **`annotation-arms.mjs`** — the same design on the axis every plan ever measured here was ZERO on.
  Sylvestri's 16 callouts, 6 markups and 2 measures, decomposed per kind against the baseline. Its guard is
  the analogue of `decodeFault`: an arm whose annotations never reached the canvas is SUPPRESSED, never
  reported — because it looks exactly like an arm that is fast. (That guard earned its keep on the first
  run: a Playwright string-vs-function subtlety made every arm read 0 of 24 annotations on a page that was
  rendering all of them.)
- **`lib/planFixture.mjs` + `../scripts/extract-plan.mjs`** — the path from ANY plan the owner works in to
  a fixture the harness can drive, rasters included, with his pixels and his identity stripped and the
  stripping unit-tested as a negative.
- **`lib/fixtureSeeding.mjs`** — how a plan's rasters get in front of an instrument at all. IndexedDB is
  origin-scoped, so they cannot be seeded before navigation; the obvious fix (load, write, reload) leaves a
  warm HTTP and V8 code cache and turns a "cold boot" into a second boot. It seeds once and hands every
  measured context a `storageState({ indexedDB: true })`. That is what `boot-tail.mjs --fixture bain` uses.

⚠ **An arm whose raster never decoded looks exactly like an arm that is fast**, and the first run of
`raster-arms.mjs` wrote nothing to IndexedDB at all (Playwright evaluates a string as an *expression* and
does not call it with the argument, unlike Puppeteer). `lib/rasterCost.mjs`'s `decodeFault` is the guard;
do not remove it, and do not report an arm it suppresses.

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
