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

## Ceilings vs targets

Every metric in `ui-audit/perf-budgets.json` carries two numbers:

- **`ceiling`** — the committed maximum. Breaching it **fails the check**. Seeded from the
  measured baseline *plus headroom*, so it is green on day one and only trips on a real regression.
- **`target`** — where the metric *should* be. Where `target` is below `ceiling`, the metric is
  knowingly out of budget today; the tools report it as `⚠ ABOVE TARGET` on every run and name the
  backlog item that owns closing it.

This two-number shape is deliberate. A single budget set to today's number is unbreachable and
therefore meaningless; a single budget set to the aspiration is red from day one and gets ignored.
Ratchet the ceiling **down** toward the target as optimizations land. Raising a ceiling to make a
red build green is a product decision and needs the same justification as any other.

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

`ui-audit/lib/perf-scenario.mjs` — a fixed, deterministic, dense site plan at a fixed
Katy/west-Houston origin. It is a **stand-in** for Sylvestri / "Concept C — Full 275' Frontage",
which is real signed-in project data the sandbox cannot reach. The stand-in is **lighter** than
the real thing, so its numbers are a **floor, not a match** — which is exactly why the ceilings
are seeded from the owner's production measurements and not from a local run. Confirming them
against the real scenario is a signed-in live check.

Two traps worth knowing:

- **Do not reuse `e2e/fixtures/sites/dense-testfit`.** It is built for the pure-engine unit tests
  and carries the *engine's* geometry schema (`x`/`y` corners); injecting it into `localStorage`
  and booting the real planner crashes the render path outright.
- **Use only real element types.** The canvas resolves an element through the dock-zone registry
  (`src/workspaces/site-planner/lib/dockZones.js`), so an invented type id crashes the whole
  workspace on `ZONE[e.type].label`. Valid box types: `building`, `paving` (this is what a truck
  court actually is — there is no `truckCourt` type), `trailer`, `landscape`, `sidewalk`,
  `parking`, `road`.

## Load timings are refused, not faked

When a render-blocking external resource fails — `index.html` pulls the Inter webfont stylesheet
from `fonts.googleapis.com` with a plain `<link rel=stylesheet>` — first-contentful-paint goes
from ~330 ms to ~13 s. That is the sandbox, not a regression. The harness detects failed
cross-origin requests and reports load-sensitive metrics as **MEASURED BUT NOT JUDGED** rather
than as a breach. A budget that cries wolf gets ignored as fast as one that never fires.

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
BASE_URL=https://planyr.io node ui-audit/perf-harness.mjs   # against production
```

## Changing a budget

1. Lowering a **ceiling** after an optimization: do it in the same pull request, and update
   `measured`.
2. Raising a **ceiling**: needs a stated reason on the backlog item. "The feature needed it" is a
   reason; "CI was red" is not.
3. Changing a **target**: it encodes a product intent (60 fps, a bundle size). Change it when the
   intent changes, not to make a report look better.
4. Re-seeding after a production measurement: update `measured`, and drop `localFloor` /
   provisional notes for any metric that now has a defensible production number.
5. **Withdrawing a seed** (what happened to the frame metrics on 2026-07-29): when a number turns
   out to have come from an instrument that cannot be trusted, say so in the metric's `note` —
   what the old number was, why it is withdrawn, and which instrument replaced it — and add a
   `seededFrom` naming that instrument and the run. Do not quietly overwrite it: the next reader
   needs to know the history, or they will re-seed from the same bad surface.
