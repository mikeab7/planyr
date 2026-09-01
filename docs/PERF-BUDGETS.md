# Performance budgets — the standing rule

**A feature that breaches a performance budget ships with a matching optimization, or it does
not ship.**

That is the whole rule. Everything below is how it is enforced and how to work with it.

## Why this exists

Planyr got slower the way every app gets slower: no single change was wrong. Each feature was
justified, each cost a little speed, and nothing measured the drift until the owner noticed the
app "lagging more as late". A budget converts that invisible, diffuse cost into a visible,
attributable one — a number that goes red in the pull request that moved it.

## The two halves, and why they are split

| | What it measures | Runs | Gates CI |
|---|---|---|---|
| `ui-audit/perf-bundle-audit.mjs` | Bundle weight, per-route download cost, the Site-route chunk allowlist | After `npm run build`, no browser | **Yes** |
| `ui-audit/perf-harness.mjs` | Time-to-first-drag, aerial coverage, frame time, peak heap, tile requests, FCP | Chromium against a built app | No — on demand |

Bundle weight is **deterministic**: it falls out of the build with no browser, no network and no
CPU contention, so a breach is unambiguously caused by the diff in front of you. That half gates
merges.

The runtime half is **not** in the required build check, deliberately. Frame time and heap on a
shared CI runner are dominated by whatever else is running on that machine; gating merges on them
produces flaky reds, and flaky reds teach people to re-run until green — which is worse than
having no budget at all. The aerial metrics additionally need live external tile hosts. So the
runtime harness is run **on demand, before shipping anything that touches render or load**, and
its numbers are recorded on the backlog item.

If you want the runtime half in CI later, the honest way is a dedicated self-hosted runner with a
pinned CPU, not the shared `ubuntu-latest` pool.

## Baseline, band, ceiling, target

> **Changed 2026-07-30 (NEW-1).** The bundle metrics used to carry a hand-written `ceiling`.
> They no longer do, and this section describes what replaced it and why.
>
> **Changed again 2026-09-01 (B1016816, owner decision).** The 2% band below is now **10%**, and
> every baseline was re-seeded to a fresh build the same day. Owner's framing, verbatim: *"keep
> the gate, give it room. A ceiling should be an alarm that something went badly wrong, not a
> per-byte accountant for ordinary work."* The case that forced it: before PR #1281,
> `notesRouteJsBytes` measured 690.0 KB against a 690.2 KB ceiling — 0.2 KB of margin, a 2% band
> already fully consumed by ordinary in-band merges. It cost two reverts (PRs #1262/#1263) and
> blocked B917073 (shipped anyway once #1281 split ~164 KB of Site-Planner libraries out of the
> shared entry chunk). **This is a regression alarm, not a budget** — read that literally: if a
> ceiling ever again sits within about 1% of its measured size, that is a signal to fix the
> *weight* (split the chunk, defer the import), not to nudge the *number*.

**What went wrong with hand-pinned ceilings.** Each one was seeded from a measurement and then
never left it. By 30 July `largestChunkBytes` measured 1707.9 KB against a 1709.0 KB ceiling —
**1.1 KB, 0.06% of headroom** — and `totalJsBytes` sat 3 KB under its own. Three consecutive pull
requests (#858 four times, #859 twice, #860 once) failed the gate on growth of **0.8–0.9%**. None
of them was a regression. They were features hitting a budget with no room in it, and the file's
own stated rule — *"seeded from the baseline PLUS headroom, so it is green on day one and only
trips on a real regression"* — was not true of the numbers in it.

Bumping the three ceilings would have been the same mistake a fourth time. So the shape changed:

- **`baseline`** — the last *deliberately recorded* measurement. Only `npm run perf:ratchet`
  writes it, and only with a `--reason` and an `--item`, both of which land in
  `bundle.ratchetLog`. Nothing in an ordinary merge path can move it.
- **`bundle.headroom`** — the band, committed **once**: `max(10% of baseline, 32 KB)`. One place,
  not three drifting numbers. The 32 KB floor exists because a percentage of a small chunk is not
  enough room for one honest feature; at 10% the floor rarely binds any more (see the 2026-09-01
  note above), but it stays as a backstop for a small metric.
- **`ceiling`** — **derived, never stored**: `baseline + band`. Breaching it still **fails the
  check**.
- **`target`** — where the metric *should* be. Where `target` is below `baseline`, the metric is
  knowingly out of budget; the tools report `⚠ ABOVE TARGET` and name the owning backlog item.

That gives four outcomes per metric, and only the last one is red:

| Measured | Reported | Build |
|---|---|---|
| ≤ target | `✓` | green |
| target … baseline | `⚠ ABOVE TARGET`, names the owner | green |
| baseline … ceiling | `⚠ ABOVE BASELINE`, says how much band is left | green |
| > ceiling | `✗` breach, with the derivation spelled out | **red** |

`siteRouteChunks` is deliberately excluded from the band: a chunk count is a structural guard,
not a size, and "four chunks plus ten percent" is not a sentence. It keeps a hard `ceiling`.

**Ratcheting is a named step.** `npm run perf:ratchet -- --metric bundle.largestChunkBytes --item
B1064 --reason "…"` measures a fresh build itself (you cannot ratchet to a number you typed),
lowers the baseline, and appends the reason to the log. Raising a baseline additionally needs
`--allow-raise`, because that is a product decision and should read like one on the diff.
`test/perfBudgetPolicy.test.js` asserts every baseline equals the `to` of its own latest log
entry — **so a baseline edited by hand, with no reason on the record, goes red in CI.**

## Why a breach names its cause

A bare *"2286.3 KB exceeds 2265.6 KB by 20.7 KB"* reads identically for a 20 KB feature and a
20 KB dependency bump, and cost a local build to disambiguate every time. Two additions fix that:

- `vite.config.js` writes `dist/.vite/chunk-modules.json` (each chunk's per-module size, straight
  out of rollup — no new dependency), and the audit folds it into **vendor / app-shared /
  app-route** buckets per route.
- `scripts/perf-base-stats.mjs` builds the PR's base ref in a throwaway git worktree and snapshots
  it, so `perf-bundle-audit.mjs --compare` names **which modules and packages moved, and by how
  much**. It is diagnosis, not a gate: it never exits non-zero, and it prints why when it cannot
  run (a shallow clone, a base that does not build, a base older than the stats plugin).

Metrics currently above target: `aerialTileRequests`, `siteRouteJsBytes`, `largestChunkBytes`.
(`frameMedianMs` / `frameP90Ms` left that list on 2026-07-29 — not because anything got faster,
but because their old numbers were withdrawn. See blocker 4.)

## ⚠ Four measurement blockers — read before touching the harness

These cost real time to rediscover, and **three of them fail silently**, which is worse than
failing loudly: they produce a number that looks fine and is wrong.

**1. The resource-timing buffer holds 250 entries and fills during load.**
Once full, the browser silently drops every later entry — no error, no warning. A scenario load
issues far more than 250 requests, so tile and JS counts read low and a request budget quietly
never fires. Call `performance.setResourceTimingBufferSize(3000)` (or larger) **before**
navigating. The harness does this in an init script, which is the only place early enough.

**2. Cross-origin tile responses have no `Timing-Allow-Origin`, so `transferSize` is 0.**
Every `arcgisonline.com` / `services.arcgis.com` entry reports zero bytes. Summing `transferSize`
for a byte budget yields 0, which is under every conceivable ceiling — the budget silently never
fires. **Count requests, not bytes**, or re-fetch a sample and multiply. The tile budget counts
requests *issued*, which also keeps it meaningful where tile hosts are blocked.

**3. `performance.measureUserAgentSpecificMemory()` is unavailable on planyr.io.**
It requires cross-origin isolation, which the app does not set. Full-tab memory is therefore
**not measurable**. The heap budget is `performance.memory.usedJSHeapSize` — the **JS heap only**.
Decoded tile bitmaps and GPU memory sit entirely outside it: the owner observed roughly 555 MB for
the tab while the JS heap peaked at 134.6 MB, so about 420 MB is invisible to this harness. Never
present `peakHeapMB` as tab memory. Chrome also quantises `performance.memory` unless launched
with `--enable-precise-memory-info`; without that flag you are budgeting rounded noise.

**4. `requestAnimationFrame` is SUSPENDED in a backgrounded tab, and says nothing about it.**
This one already cost us a committed budget. The original `frameMedianMs` / `frameP90Ms` ceilings
were seeded from a browser session whose tab visibility could not be guaranteed. Re-checked
2026-07-29: that surface reports `document.visibilityState === "hidden"`, and Chrome suspends rAF
entirely in that state — **six real drag gestures produced zero frames**, and a 1500 ms idle
sample produced zero as well. Taking a screenshot does **not** foreground the tab. Sample counts
wandering 1525 → 316 → 0 across otherwise-identical gesture runs are the signature of that
throttling, not of a performance change.

The dangerous case is not the zero. It is the **middle** of that range: a partly throttled run
still yields a perfectly plausible-looking median from a starved sample, and that is exactly how a
bad ceiling gets committed. So the harness now **refuses to report a frame figure it cannot stand
behind** — the tab must be `visible`, and the observed rate across the gesture must clear a 30 fps
plausibility floor (deliberately well under 60, because a genuinely slow frame is the thing we are
trying to *measure*). A failing run prints `NOT REPORTED (measurement invalid)` with the reason,
never a median. The rule is `ui-audit/lib/frameSampling.mjs`, unit-tested in
`test/perfBudgets.test.js`, so it cannot drift from this page.

**The frame metrics are therefore NOT verifiable from a Cowork browser session** (V480(e) /
V481(g) record this). The instrument of record is `perf-harness.mjs` run **headless**, where the
page is guaranteed visible and rAF runs at full rate — and frame timing is a pure render-cost
measurement, so it needs no sign-in and no live data. What headless *cannot* tell you is how the
owner's real plan behaves: the reference scene is lighter than Sylvestri / Concept C, so the
re-seeded ceilings guard **the reference scene**, and a production frame reading still wants an
instrument with guaranteed visibility.

Every other metric in this file — DOM, network, bundle weight, heap — is independent of rAF and of
tab visibility, so blocker 4 does not touch their provenance.

## The reference scenario

`ui-audit/lib/perf-scenario.mjs` — **derived from `ui-audit/fixtures/goose-creek-plan1copy.json`,
the owner's real Goose Creek plan pulled from production**: 62 elements (20 buildings, 6
centerline roads with arc vertices, 2 ponds), 6 parcels, the plan's own 30-key settings. Derived,
never copied — a second hand-maintained scene drifts from the fixture the moment either is edited,
and then two instruments disagree about what "the reference plan" is. It remains a **floor, not a
match** for the owner's heaviest signed-in plans; confirming production is still a live check.

### ⚠ Measurement blocker 5 — the benchmark could not see the problem (NEW-1, 2026-07-31)

Before this date the scenario was **hand-authored**, and what it left out was not a matter of
degree. Its "road" was a `{type:'road', cx, cy, w, h}` **rectangle** — no `pts`, no `vtx` — and it
had **no ponds** and no polygon elements at all. So `roadNet`, `teeJunctionsOf`, `driveJunctionsOf`,
`dissolveRings` and all of `lib/roadGeometry.js`, plus `lib/detentionRules.js`,
`lib/floodplainMitigation.js` and the pond ledger — the most expensive code in the app — **executed
zero times in the benchmark that certified them.**

Worse, the scripted drag pressed at the **exact canvas centre**, which on any real plan lands on an
*element*, so the view never panned. Measured head to head on the real plan: **604 DOM mutations**
for the centre-press gesture versus **641,730** for the identical drag started on bare canvas. The
frame sampler saw a clean 60 fps for both and reported the first as a 16.7 ms median.

Both are fixed, and both are now guarded: `scenarioShape()` is asserted to contain roads, ponds and
polygons (`test/perfBudgets.test.js`), the press point is *chosen* to be bare canvas, and
`idleGestureFault` (`ui-audit/lib/frameSampling.mjs`) **refuses** a sample whose view transform
never moved. What it cost, reported rather than smoothed: canvas DOM nodes **1197 → 2822** at the
innermost zoom rung (+136%), peak JS heap **41.7 → 68.8–98.0 MB**. The frame medians did **not**
move at 1× — this container renders the heavier scene at 60 fps too. No ceiling was raised.

### Dynamic range: `--cpu-throttle` and `--dpr`

A budget measured only on a fast headless box at `deviceScaleFactor` 1 has no dynamic range —
everything passes, so nothing is comparable, and an optimisation that halves the work still reads
16.7 → 16.7. `node ui-audit/perf-harness.mjs --cpu-throttle 4` emulates a slower machine (CDP
`Emulation.setCPUThrottlingRate`, the mechanism Lighthouse uses); `--dpr 2` emulates a retina
display. On the same build and scene at 4×, the pan runs at **14.8 fps (49.9 ms median)** and the
**wheel zoom at 6.4 fps — 199.9 ms median, 250 ms p90**, the first reproduction anywhere in this
repo of the owner's *"I scroll out and it takes probably a whole second."*

Emulated numbers are **MEASURED BUT NEVER JUDGED**: the ceilings here describe a 1× machine, and
`perf-ratchet` refuses an emulated run outright. Compare them only against another run at the same
settings. Under emulation the frame-sampling plausibility floor drops from 30 fps to 2 fps —
`plausibilityFloor()` — because under deliberate throttling slowness is the *measurand* and only
true rAF suspension should be refused; at 1× it returns exactly the committed 30, unchanged.

### Seeding a runtime number

`measured` and `seededFrom` on a harness-seeded runtime metric move **only** through the named step,
the same rule the bundle baselines already had:

```
node ui-audit/perf-harness.mjs --no-tiles --json > /tmp/run.json
npm run perf:ratchet -- --metric runtime.frameMedianMs --from-harness /tmp/run.json \
  --item NEW-1 --reason "…"
```

It takes the value from the instrument's own output — never a number you typed — and refuses the run
if it was emulated, if the frame sampler raised a fault, or if the drag never panned. A metric with
no `seededFrom` (`peakHeapMB`, `aerialTileRequests` — production figures) cannot be written at all,
so a sandbox floor can never quietly overwrite a production measurement.
`test/perfBudgetPolicy.test.js` fails the build if a runtime `measured` does not equal the `to` of
its own latest log entry.

Two traps worth knowing:

- **Do not reuse `e2e/fixtures/sites/dense-testfit`.** It is built for the pure-engine unit tests
  and carries the *engine's* geometry schema (`x`/`y` corners); injecting it into `localStorage`
  and booting the real planner crashes the render path outright.
- **Use only real element types.** The canvas resolves an element through the dock-zone registry
  (`src/workspaces/site-planner/lib/dockZones.js`), so an invented type id crashes the whole
  workspace on `ZONE[e.type].label`. Valid box types: `building`, `paving` (this is what a truck
  court actually is — there is no `truckCourt` type), `trailer`, `landscape`, `sidewalk`,
  `parking`, `road`.

## Load timings are refused, not faked — and paint is no longer refused (B276576)

The original text of this section described a real defect and then lived with it: `index.html`
pulled the Inter webfont stylesheet from `fonts.googleapis.com` with a plain
`<link rel=stylesheet>`, the sandbox blocked it, and first-contentful-paint went from ~330 ms to
~13 s. Refusing to judge was the right call **while that was true** — a budget that cries wolf
gets ignored as fast as one that never fires.

It is no longer true. **B276576 self-hosted Inter**, so the boot path carries no cross-origin
render-blocking resource at all, and the mute has been narrowed to the thing that actually
justifies it. Two gates now, not one:

- **Paint-sensitive** (`firstContentfulPaintMs`, `timeToFirstDragMs`) — muted only when the
  document really does load a cross-origin **render-blocking** resource. The harness measures
  that from the live DOM rather than assuming it, so the mute comes back **automatically, naming
  the culprit**, if a third-party stylesheet or synchronous script is ever reintroduced.
- **Tile-sensitive** (`firstAerialCoverageMs`) — keeps the original gate. It genuinely cannot
  complete without the tile hosts, and it is *not* un-muted.

The old single gate muted all three whenever **any** external host failed, which in a sandbox is
always. A failing aerial *tile* host does not delay first paint by a millisecond — tiles are
images fetched after boot — so that gate was answering a different question from the one it was
asked. **A budget muted for a bug that has since been fixed is a budget nobody is enforcing.**

### What un-muting immediately exposed, recorded rather than papered over

The first judged run reported **FCP 688 ms against the 500 ms ceiling**. That is *not* a
regression from B276576, and the ceiling was deliberately **left alone**:

- The same harness on the **unmodified pre-fix tree** reports **668 ms** on the same container —
  the gap is run-to-run noise, and it was there all along, hidden by the mute.
- With a *perfectly fast* font host, the pre-fix build still paints ~150 ms later than the
  shipped one (`ui-audit/verify-font-blocking.mjs --delay 0`), so the fix moves this metric in
  the right direction on every measurement available here.
- The 500 ms ceiling's provenance is **production planyr.io on the owner's machine** (measured
  328 ms, dpr 2.15, signed in). This is a shared sandbox container. Judging a production-seeded
  ceiling against a different machine is the precise mistake the `EMULATED` rules elsewhere in
  this file exist to prevent.

So the honest position is: the *blocker* is gone and paint is judgeable in principle; whether
**500 ms** is the right number for this metric is a question only a production run can answer,
and that run is already logged as **V477**. Re-seeding it from a sandbox figure — or nudging the
ceiling up to 700 so this run goes green — would be choosing a threshold to fit a result, which
is exactly what this repo forbids.

## The Site-route allowlist

`bundle.siteRouteAllowlist` pins exactly which JS chunks a plain Site route may pull. It exists
because of a specific bug worth not repeating: a boot-time idle prefetch warmed every workspace,
so a Site-only session downloaded and evaluated all 11 chunks — about 805 KB, 27% of all JS, that
it never runs. Because that prefetch was a *runtime* `import()`, no static analysis and no
per-chunk size table would ever have caught it.

So the guard exists twice, on purpose:

- **statically**, in `perf-bundle-audit.mjs`, over the manifest's static-import closure — catches
  someone statically importing a heavy module into the planner;
- **at runtime**, in `perf-harness.mjs` and `verify-new9-lazy-modules.mjs`, over what the browser
  actually requested — catches anything that warms a workspace at boot again.

Both name the offending chunk, because *which chunk came back* is the entire diagnosis.

## Running them

```sh
npm run build
node ui-audit/perf-bundle-audit.mjs            # CI-gated; --json for machine output
npx vite preview --port 4173 &
node ui-audit/perf-harness.mjs                 # full runtime pass
node ui-audit/perf-harness.mjs --no-tiles      # offline: aborts cross-origin, skips aerial metrics
node ui-audit/verify-new9-lazy-modules.mjs     # deferred workspaces still open on first click
node ui-audit/verify-lazy-panels.mjs          # the lazy planner panels: deferred at boot, present on open
BASE_URL=https://planyr.io node ui-audit/perf-harness.mjs   # against production

# byte attribution against the base ref (what CI runs)
node scripts/perf-base-stats.mjs --out .perf/base-stats.json
node ui-audit/perf-bundle-audit.mjs --compare .perf/base-stats.json

# what a PUSH TO MAIN will judge (no GITHUB_BASE_REF ⇒ no attribution shield)
node ui-audit/perf-bundle-audit.mjs --compare .perf/base-stats.json --as-main
```

### ⛔ A LOCAL RUN UNDER-MEASURES CI BY ~300 BYTES. A MARGIN UNDER ~1 KB HERE IS NOT PROOF. (B927104, 2026-08-31)

`import.meta.env.VITE_SUPABASE_URL` and `..._ANON_KEY` are **inlined as string literals at build
time** (`site-planner/lib/supabase.js`, `food/lib/supabaseClient.js` — both statically reachable
from `src/main.jsx`, so they sit in the shared entry chunk **every** route downloads). CI's `Build`
step has those secrets; your checkout does not. So a local build of the *identical tree* is
**~300 bytes lighter on every route** than the one CI judges.

Measured on 2026-08-31, notes route, byte-for-byte:

| commit | local build (no secrets) | CI's head build (secrets) | ceiling |
| --- | --- | --- | --- |
| `a85cd402` | 705,351 | ~705,65x | 706,730 |
| `b4d65330` | 706,504 | ~706,80x — **RED on main** | 706,730 |
| `9a5d54f3` | 706,439 — *"0.3 KB under, ship it"* | ~706,75x — **RED on main** | 706,730 |

That third row is the whole lesson: a local `--as-main` run said PASS with 291 bytes to spare and
`main` went red anyway, twice in one hour. A control build with a full-length dummy project URL +
JWT moved the same metric **+619 B**, confirming the mechanism directly rather than by inference.

**So:** a local margin **under ~1 KB is unproven** — treat it as a fail and find real headroom.
A margin of 10 KB is not sensitive to this at all, which is the practical reason to aim there
rather than at the ceiling. (CI's *base-ref* build was fixed to carry the same secrets in the same
commit as this note, so CI's own attribution is now honest; that does **not** make a local run
predictive, and closing that gap is what B927104 stays open for.)

## Attributing a BOOT — `--boot-timeline` (added 2026-07-31, speed program phase 3)

`timeToFirstDrag` is one number, and for most of this program it was the largest one in it
(4.4–7.9 s at 4× throttle against a first paint under a second) with no breakdown behind it.
`--boot-timeline` produces the breakdown, and it is a different kind of measurement from every
budget above — it is never judged against a ceiling, it is an explanation.

```sh
npx vite build --sourcemap            # ⚠ REQUIRED for named phases — see below
npx vite preview --port 4173 &
node ui-audit/perf-harness.mjs --no-tiles --cpu-throttle 4 --boot-timeline
node ui-audit/perf-harness.mjs --no-tiles --cpu-throttle 4 --boot-timeline \
     --arms baseline,no-drainage --reps 3        # interleaved A/B against a control arm
```

What it prints, and why it is in two halves:

- **The wall spine** — consecutive measured marks (HTML received · first script · first paint ·
  canvas element exists · canvas finished drawing · press delivered · drag serviced). They are
  events, so they sum EXACTLY to time-to-first-drag and no segment can hide a remainder. Ordered by
  measurement, not by expectation: the harness presses as soon as the canvas ELEMENT exists, so on a
  slow boot "canvas drawn" legitimately lands after "press delivered".
- **The attribution** — a CPU sample profile across the same window, resolved through the build's
  source maps, so a sample lands on `lib/roadGeometry.js` or `node_modules/react-dom` rather than on
  `SitePlannerApp-BxMJopPJ.js:7`. Idle is a phase like any other. Whatever no rule can name is
  charged to an explicit **UNATTRIBUTED** row with its top contributors by name.
- **The cross-tab** — the two laid over each other, per segment, busy% vs idle%. The profile clock is
  pinned to the page clock by a **burn marker** (a uniquely-named CPU-burning function that appears in
  both), which is good to a fraction of a millisecond; the pairing by CDP round-trip that this
  replaced was only good to ±390 ms and suppressed itself every run.

⚠ **Without `--sourcemap` the attribution degrades to chunk granularity**, and the run says so rather
than printing a chunk name where a phase name should be. Rebuild without source maps before
shipping — nothing is gated on their absence, but they should not be published.

⚠ **This sandbox blocks every external host.** Basemap tiles, GIS services and Supabase are ABSENT,
not slow, so a boot measured here is a LOWER BOUND. Correspondingly, anything it does find is local
work that the owner's machine pays too.

**Control arms** (`--arms`) are seeded SETTINGS, never patched builds: `no-drainage` sets
`settings.drainage.autoFacts = false`, which is exactly what `drainAutoEnabled` reads. Check the arm
DID something — the run prints per-category request counts, and the drainage arm should visibly drop
the GIS request count — before believing a null result.

## Changing a budget

1. Lowering a bundle **baseline** after an optimization — the good direction, and the only
   routine one:
   ```sh
   npm run build
   npm run perf:ratchet -- --metric bundle.largestChunkBytes --item B1064 \
     --reason "what optimization landed, in a sentence someone can check"
   npm run perf:ratchet -- --all --item B1064 --reason "…"   # every metric that improved
   ```
   Commit `ui-audit/perf-budgets.json` in the same commit as the change it describes. Never edit
   a `baseline` by hand — `test/perfBudgetPolicy.test.js` fails an unlogged edit.
2. Raising a bundle **baseline**: same command plus `--allow-raise`, and the reason has to say
   what shipped **and** what was optimized first. "The feature needed it" is a reason; "CI was
   red" is not. Note that growth inside the headroom band needs no ratchet at all — it is
   annotated and passes.
3. Changing a **runtime** ceiling (those are still hand-written literals — they are browser
   measurements, not build outputs): same standard of justification, stated on the item.
4. Changing a **target**: it encodes a product intent (60 fps, a bundle size). Change it when the
   intent changes, not to make a report look better. One automatic exception: where a target
   *equals* its baseline the metric is asserting "no known gap", and the ratchet moves both
   together so it cannot silently acquire an unowned one.
5. Re-seeding after a production measurement: update `measured`, and drop `localFloor` /
   provisional notes for any metric that now has a defensible production number.
6. **Withdrawing a seed** (what happened to the frame metrics on 2026-07-29): when a number turns
   out to have come from an instrument that cannot be trusted, say so in the metric's `note` —
   what the old number was, why it is withdrawn, and which instrument replaced it — and add a
   `seededFrom` naming that instrument and the run. Do not quietly overwrite it: the next reader
   needs to know the history, or they will re-seed from the same bad surface.
