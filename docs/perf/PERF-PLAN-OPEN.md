# PERF — the main-thread stall while a plan opens / switches (slow report 55807aa9, other half · B2225424)

**Report.** Same owner report as B2208416 (`problem_reports` 55807aa9, plan `smun6o2o628f` "Bolt-on", build 99c87bb). B2208416 fixed the jurisdiction half. Then the owner measured his own signed-in
Chrome on build `bae75b0` with a MessageChannel ping-gap heartbeat (proven on a deliberate 200 ms busy loop, in a hidden tab): **Bolt-on → Concept A (`smqfy2r7pdec`): gaps of 908, 560, 118 ms within ~2 s;
Concept A → Bolt-on: 226 and 253 ms; no GIS fetch fired** — so the stall is the app's own plan-open work.

## The rig (so nobody rebuilds it)
`ui-audit/perf-plan-open.mjs` (`npm run perf:planopen`, `--library 140` pads the account like his 143 plans, `--profile` writes a sourcemap-resolved CPU profile per action). It boots the **signed-in** path
(resumable fake session, `lib/authRemount.mjs`) against a dummy Supabase host answered by `lib/planOpenRig.mjs` from the owner's real rows — `ui-audit/fixtures/plan-load/{concept-a,bolt-on,richfield-concept-a-live}.json`
(`public.sites.data` header + live `public.site_elements`, county records / free text / storage keys stripped). Cold open, Bolt-on ↔ Concept A (first visit · back · revisit), Grand Port ↔ Richfield (the larger plan, 193 rows).
Scored with the heartbeat (`lib/planOpenVerdict.mjs`, VOID if the known-good 200 ms arm reads < 150 ms). Build it with `VITE_SUPABASE_URL=https://bootauth.supabase.co VITE_SUPABASE_ANON_KEY=dummy npx vite build --sourcemap true --outDir <dir>` and pass `--dist <dir>`. Same harness, two builds: baseline = main `bae75b0`, fixed = this change.

## The four hypotheses, ruled with numbers
| | Verdict | Evidence |
|---|---|---|
| **derived geometry recomputed on open** | **CONFIRMED — the dominant cause, and it is `polylabel` (the parcel acreage-badge anchor)** | CPU profile of the Bolt-on → Concept A switch, resolved through the build's sourcemaps: `polylabel.js:110` self time **345 ms** (first visit) and **763 ms** (revisit) under `SitePlanner.jsx:17738` (`parcelChips`), in the render. Reproduced in plain Node, no browser: Concept A's 16 parcels cost **416 ms**; two long thin strips (83 × 1,705 ft, 5–6 vertices) cost 155 + 177 ms. Two causes: the best-first search **rescanned its whole candidate queue on every pop** (a flat ridge keeps thousands of cells alive), and its cache was keyed by **array identity** — a plan open re-seeds every parcel into new arrays with the same coordinates, so every open and every revisit paid the whole search again. |
| plan fetch / parse (`Response.text.then`) | **Partly in — it is an ACCOUNT-wide cost, not a per-plan one** | `Response.text.then:index-…:154188` maps (same sources rebuilt at 99c87bb, sourcemap) to `@supabase/postgrest-js` `processResponse` → `await res.text()` → `JSON.parse`, and bills **everything that runs synchronously after it** to that label. The account-wide parcel fetch's continuation ran `summarizeParcelRows` for every plan on the account: **187–201 ms** on a 140-plan library, as one task (`overlappingParcelPairs` is O(parcels²) per plan). Sliced now. **Not proven to be his 134 ms task** — his real parcel set is not in this repo; V1644528 checks it on his account. The plan's own row fetch is tiny (193 rows). |
| element hydration | **Out** | `createSiteModel` + `normalizeBondedChildren` 16–18 ms on the 193-row plan, 8–9 ms on Bolt-on. |
| local store read | **Out — B2165120 is NOT a dependency** | `loadSite` 7–10 ms; `saveSite` 22–30 ms in the click under automation (the legacy-mirror refresh is `sync` under automation and `idle` in production — the rig sets `__PLANYR_LEGACY_MIRROR = "idle"`). 140 filler plans added 20–60 ms in total, none of it a single task. |

Found on the way (not in the brief, same family — an account-scale cost in the header): **`relTimeShort` took 213 ms self** in one plan open on a 140-plan account. `Date#toLocaleDateString(undefined, opts)` builds a
fresh `Intl.DateTimeFormat` per call (~1.5 ms), the project switcher renders a row per project on every header render (the JSX is evaluated whether or not the menu is open), and every plan older than a month takes that branch.

## The fix
1. `lib/polylabel.js` — binary max-heap instead of the linear `popBest` (same search, same stop rule; ties by push order) + a **content-keyed second cache tier** (coordinates → anchor, FIFO-bounded at 512) behind the identity WeakMap. Concept A's parcels: 416 → 41 ms cold in Node, ≈ 0 on every revisit.
2. `lib/parcelSummary.js` `summarizeParcelRowsAsync` — the account-wide summary in ≤ 12 ms slices (a site is the unit), applied by `SitePlannerApp.jsx` with an epoch guard so a finished summary of a superseded call / signed-out account is dropped.
3. `shared/projects/projectSwitcherModel.js` `relTimeShort` — one cached `Intl.DateTimeFormat` (same locale, same options, same strings).

## Measured — same harness, two builds, 3 runs each, `--library 140` (worst single main-thread gap, ms)
| action | baseline `bae75b0` | fixed |
|---|---|---|
| **Bolt-on → Concept A (first visit)** — the owner's 908/560 | 394 · 426 · 513 | **90 · 138 · 142** |
| Concept A → Bolt-on (back) — his 226/253 | 214 · 198 · 233 | 243 · 186 · 178 (not improved) |
| **Bolt-on → Concept A (revisit)** | 491 · 535 · 652 | **139 · 199 · 203** |
| cold open Bolt-on | 244 · 237 · 244 (6 more runs: 219–310) | 261–369 (median ≈ same); total time over 50 ms 1.4 s → 1.2 s |
| Grand Port → Richfield (193 rows) | 479 · 439 · 475 | 475 · 391 · 355 (not fixed) |
| Richfield → Grand Port (back) | 230 · 213 · 311 | 209 · 235 · 253 (not improved) |
Without the library padding: first visit 399–408 → 99–102, revisit 507–600 → 165–197.

## ⛔ WHAT THIS DOES NOT DO — stated loudly
**The brief's acceptance — "no single task over 50 ms on Bolt-on, and the larger plan sharply down" — is NOT met.** Bolt-on's own opens still hold one 180–300 ms task, and Richfield (the larger plan) is not meaningfully down. The remainder is **distributed**, not
one hotspot: `SitePlanner`'s render body ≈ 80–100 ms (renders in the click task: the plan switch is a discrete event, so React renders synchronously inside it; one component = one task, so `startTransition` would not split it), the header's
measuring copies (`PriorityToolbar` 15–26 ms), a Leaflet `addTo` for the detail aerial layer on a 600 ms timer (60–120 ms), and — on Richfield — the **first-time road-network dissolve** (`dissolveRings` 121 ms of a 280 ms render; memoised afterwards, so a revisit is cheaper).
That is B2225425 (open). The budget (`ui-audit/perf-plan-open.budget.json`) is therefore set at what the fixed build measures plus headroom, with the 50 ms as a reported **target**, never a silent pass.
**`m` (1,587 ms in `ef29b5da`, build 4eacb0d): not resolved.** A one-letter minified name cannot be mapped without that build's sourcemap, which is not kept; Richfield (`smt7q6ar8egz`) has three parcels, so it is not `polylabel`. Its first-time road dissolve is 121 ms here. Unexplained.

## Deviations, stated
- The seed (rows → canvas) lands ~4.2 s after a switch in the rig, not ~1–2 s: the engine seeds "on the realtime join or the 4 s fallback" and the rig has no websocket, so it always takes the fallback. The work done at the seed is the same; only its timing differs.
- Aerial tile requests are answered with a solid PNG (a blocked tile is a failure mode Leaflet pays for per tile); GIS data requests are refused (his switches fired none).
- The library padding is clones of the three real plans, so parcel-heavy clones (Concept A ×47) overstate `summarizeParcelRows` relative to his account.
- Two builds, not one build with a toggle.

Guards: repo-root `test/` **polylabelPerf** (the verbatim original replayed as the reference; ratio, not a wall-clock figure), **parcelSummaryAsync**, **relTimeShort** (red on the old code), **planOpenVerdict**; browser: `npm run perf:planopen -- --assert` (baseline fails the Concept A budgets, the fix passes) — deliberately **not** a required CI gate (timing on a shared runner; the unit guards above are the CI-runnable half). Live: V1644528 (`ui-audit/verify-plan-open-live.mjs`).

## ⛔ Round 2 — the owner's own account after round 1 (build 980040d, ~5:25 PM Central, same heartbeat re-proven on a 200 ms busy loop)
| | before | after round 1 |
|---|---|---|
| Bolt-on → Concept A | 908 + 560 + 118 ms | **256 + 58** — the badge-anchor fix is real |
| Concept A → Bolt-on | 226 + 253 ms | **215 + 219 + 59 — UNCHANGED** |

**The refutation, said as loudly as the finding:** round 1 did not touch the Bolt-on open path, and my signed-in arm was VOID, so I shipped saying the brief's acceptance was unmet but had no owner-account number for it. His number says: partial.

**What round 2 found.** (1) *My own window was wrong.* The harness opened its window before Playwright resolved the target with a `*:visible` + `hasText` locator — a 48–59 ms task in the page's CPU profile that is the **driver's**, not the app's (the DRIVER-SCROLL-IS-NOT-APP-SCROLL species). The switch is now scored from the page task that dispatches the click, after the menu settled (the chip click is separate). (2) *The click was ONE task: React rendered the new plan and committed it synchronously inside the click* — render ≈ 120 ms + commit ≈ 56 ms in the profile (`SitePlanner` render, a second pass of children, `PriorityToolbar`'s forced layout, a layout effect, GC). A style/layout split from Chromium's own counters shows layout + style are ≈ 50 ms of 5 s: it is script, not rendering.

**The change.** `SitePlannerApp.goPlan` — the ONE place every open/switch passes through (chip pick, project pick, route sync, new plan) — now sets `currentSiteId` / `activeSiteId` / `mode` inside `startTransition`. The old plan stays on screen while the new one renders, and the browser can take input between React's slices.

| clean window, 4 runs, `--library 140`, worst gap (median) | round 1 | round 2 |
|---|---|---|
| Bolt-on → Concept A, first visit | 71 (worst 117) | **65 (worst 70)** |
| Concept A → Bolt-on (back) | 140 (worst 180) | **91 (worst 156)** |
| Bolt-on → Concept A, revisit | 156 (worst 170) | **114 (worst 149)** |
| Richfield → Grand Port (back) | 189 (worst 246) | **101 (worst 130)** |
| Grand Port → Richfield (first-time, 193 rows) | 350 (worst 361) | 344 (worst 395) — **not fixed** |
A Chromium trace of the back-switch (no heartbeat running) shows two tasks of 42 and 76 ms, where the click used to be one ~200 ms task.

## ⛔ STILL NOT MET — and exactly what is left
- **The 50 ms target is not met.** The first render of a plan is ONE `SitePlanner` fiber (≈ 75–125 ms render + commit); a transition can slice between components, never inside one. On Richfield the first-time road dissolve (`dissolveRings` ≈ 85 ms: `collapseRingSpikes` 42, clipper `closePaths` 30), pond offsets (≈ 25), `siteMetrics` (43) and `clipPolylineOutside` (≈ 40) are all in that one render. That is B2225425, with the next moves in order.
- **The owner's second ~219 ms task on the Bolt-on back-switch is not reproduced.** In the rig the tasks after the click are ≤ 76 ms. Suspect, unproven: his real aerial tiles (decode + `onload` per tile; the rig answers every tile with one solid PNG), or the realtime-join seed (the rig always takes the 4 s fallback). It needs his machine (`--profile`) or a LoAF row in the perfcap.
- **Bolt-on is the heavier of his two plans** (56 live elements vs Concept A's 19; 127 rows vs 73 counting tombstones). The brief called Richfield "the larger plan" because it has the most rows (193); on the plans he actually switches between, Bolt-on is the one to watch.
- **No e2e specs were run for the transition** (the Playwright setup project needs the seeded test-account secrets, absent here), and `verify-plan-switch-release.mjs` fails identically on the pre-change build (its "plan switch proven" precondition — not caused by this). The transition's safety rests on: `goPlan` is the single writer of the three states; the rig's own switches (names, feature counts, row fetches) behave; and V1644528's live seeded arm. A reviewer should treat that as the open risk.

## ⛔ Round 3 (Opus, 2026-10-09) — the owner's account after round 2 (0841ea0): Concept A → Bolt-on 56, 62, 54, 94, **211** / 70, 73, 118, 100; Bolt-on → Concept A 127, 88 / 83, 89, 112

**First, the instrument — re-checked, and it was hiding work.** Round 2's window was 5 s; in the rig the rows seed lands ~4.1–4.6 s after a switch (no websocket → the 4 s fallback), so its render straddled the window edge. The window is now 6 s, and every heartbeat gap in it is scored — the verdict takes the worst of ALL of them and reports, per action, how many runs crossed 50 ms and 150 ms. Each gap is also **classed**: `task` (one long task covers ≥ 70 % of it — the `longtask` entry a visible tab reports) or `queue` (no single long task — the heartbeat's posted message waited behind a run of short ones). Both are main-thread time the owner's heartbeat counts; only `task` blocks input outright. Per action the harness also records the aerial tiles requested (by zoom) and the `commit_elements` calls made, and the rig now ANSWERS commits and serves what was committed back on the next read (the stub's blanket `[]` made every commit an unpaired result and hid one of the causes below). Two adjacent cases added: `cold-concept-a`, and the live harness's "the plan did not open" outcome (below).

**The four causes, each measured, each fixed:**
1. **The rows seed replaced EVERY element on every open of a plan the device had already drawn.** The two read paths normalized differently: the device copy runs `createSiteModel` (z de-dupe — Bolt-on's rows carry **6 duplicate z** so all **56** elements were renumbered; the pre-NEW-5 `locked` flag dropped on Concept A's 10 parcels; `healDockAxes` at mount), the rows path did not — so a second or two after the switch the seed found every element "changed", swapped in new objects, and every memo and `ElNode` re-rendered (60–100 ms, the second gap in the owner's captures). Worse, the road migration that `rowsToModel` DOES run was undone by rows-canonical: the after-seed diff saw the migrated road differ from its row with nothing pending and adopted the raw row back (Bolt-on road `e1455359wmveej`: 8 → 7 → 8 points, every open), and a later diff re-committed 16 elements. **Fix:** `siteModel.READ_NORMALIZE` is ONE table both paths run; the seed applies it (plus `healDockAxes`) to what it shows and passes every key a normalization changed as `exempt`, so it is committed ONCE (`load-normalized-persisted`, loud) and the rows converge. Skipped on a plan this account cannot write. DATA.md inv. 3 carries the rule.
2. **A whole aerial grid answered in one burst.** A switch remounts the planner and with it the Leaflet map; 112–252 tiles at the 2.15 ratio (retina path) arrive together on a revisit (the browser's cache; the rig's instant replies) → measured **1,012 main-thread tasks / 242 ms inside ONE 335 ms heartbeat gap, none over 45 ms**. **Fix:** `tileLifecycle.paceTileLoads` — at most 24 tiles in flight; each load/error starts the next; order kept (centre-out); a tile Leaflet discarded before its turn is never fetched.
3. **The planner's first render was thrown away inside the switch's commit.** It ran at a placeholder box and the default view; the boot framing then re-rendered every element at the real view — synchronously, in a layout effect, in the same task. **Fix:** `framingPoints` / `framedViewFor` are the ONE framing derivation (`fit()` and the first render), started from `lastMeasuredCanvas` (box, docked-panel edge, toast centre — what this page last measured). A GUESS only: the boot framing still measures the real box and still owns the reveal (constraint #8 / B1574432 untouched); it simply finds nothing to change. Also `PriorityToolbar` keeps measured widths across remounts (by name, ratio and item signature, only after web fonts settle) — no measuring layer per switch.
4. **First-time work in the seed's render** (a plan this device has never drawn): parcel badge anchors (`polylabel`, 36–43 ms on Concept A's 16 parcels) and the O(n²) overlap screen (12–14 ms). **Fix:** `warmSeedCaches` asks both from the fetched rows in 8 ms MessageChannel slices BEFORE the seed (never timers — a hidden tab clamps them), and `polyIntersectArea` memoises by ring pair.

**Measured — same harness, same fixtures, two builds of one tree (baseline = main incl. 0841ea0; fix = this change), 10 runs each, `--library 140`, worst gap of every run (ms):**
| action | baseline median / worst | runs > 150 | fix median / worst | runs > 150 | fix runs > 50 |
|---|---|---|---|---|---|
| Bolt-on → Concept A (first visit) | 112 / 126 | 0/10 | **45 / 63** | 0/10 | 5/10 |
| Concept A → Bolt-on (back) — his 211 | 133 / 153 | 1/10 | **59 / 87** | 0/10 | 9/10 |
| Bolt-on → Concept A (revisit) | 143 / 269 | 4/10 | **64 / 84** | 0/10 | 9/10 |
| Richfield → Grand Port (back) | 144 / 183 | 4/10 | **72 / 82** | 0/10 | 10/10 |
| Grand Port → Richfield (first time, 193 rows) | 500 / 683 | 10/10 | 492 / 603 | 10/10 | 10/10 — **not fixed** |
| cold open Bolt-on | 290 / 336 | 10/10 | 303 / 401 | 10/10 | — **not touched** |
| cold open Concept A | 335 / 351 | 10/10 | 254 / 344 | 10/10 | — **not touched** |
Budgets (`perf-plan-open.budget.json`) are set at the fix plus headroom: the baseline FAILS four switch rows, the fix passes all.

## ⛔ STILL NOT MET after round 3 — stated as loudly as the gains
- **The owner's acceptance — no gap over 50 ms on either switch direction across 10 runs — is NOT met.** On the Bolt-on ↔ Concept A switches the rig now sits at a median of 45–64 ms with a worst of 63–87 ms, and 5–9 of 10 runs still cross 50 ms. What remains is ONE task: the planner's remount — `SitePlanner`'s render (one fiber, ≈ 40 ms: the road network, `siteMetrics`, curb edges, `loadSite`/`createSiteModel`) and its commit (the first forced layout of the new page ≈ 16–22 ms, the old plan's unmount save ≈ 5–10 ms, `ElNode`s). Nothing left is a hotspot; it is the cost of tearing down and rebuilding the whole planner. **The next move is structural: switch plans WITHOUT remounting the planner and its Leaflet map** (or mount the next plan off-screen and swap) — a change to the planner's lifecycle that is too large and too close to the boot-framing gate (constraint #8) to do inside this round. B2225425 stays open for it.
- **The larger plan's first open (Grand Port → Richfield) is unchanged** (first-time road dissolve ≈ 85 ms + pond geometry inside the one render). Same structural move, plus warming the road network before the seed the way #4 warms the parcels.
- **Cold page loads are unchanged** (250–400 ms) — the boot, not a switch; not in this round's scope.
- **Not reproduced in the sandbox: the owner's single 211 ms gap.** The rig's worst back-switch gap fell from 153 to 87 and none of 10 runs reached 150. His capture is the arbiter: V1652624.
- **"One live run didn't open the plan at all" (round 2):** per #2245 that one was a COLD mount (1 of 11 live runs never showed the canvas within 60 s; not reproduced in 8 more, nor in 5 here; #2245 prints the page state if it recurs — **not a proven defect, not ruled out**). **But the new route check in `verify-plan-open-live` found a REAL, older defect on the switch path: project A → B → back to A left the URL naming B** (planyr.io b94ffe1, and a 5fc90a1 build from before both perf rounds) — the hash round trip of the URL writer's own write set B881664's one-pass "defer" flag, which then swallowed the next switch's write. Fixed here as **B2233520** (`bootResume.routeChangeNeedsDefer`); verified in a real browser on a local build (hash follows, 3/3 hops PASS).

## ⛔ Round 4 (B2233521, 2026-10-09) — the structural move was BUILT, MEASURED, and NOT SHIPPED; the owner's 50 ms bar is still not proven met

**The brief:** the owner's heartbeat on db8723a read Bolt-on → Concept A 50, 119, 65 | 68, 61 and back 58, 71 | 61, 54 — the remaining cost was believed to be the planner's REMOUNT, and the move on the item was "switch plans without remounting".

### First, the instrument (three findings, each would have produced a false result)
1. **This container is faster than the last one.** On main, the rig at 1× now reads every switch UNDER 50 ms — it cannot red-proof anything. `--cpu <rate>` (CDP CPU throttling) was added and the rig calibrated against the owner's own main-build readings: **2×** reproduces them (first visit 95–129 vs his 119; back 42–58 vs his 54–71).
2. **3× is unusable for a 50 ms bar:** Chromium's throttler pauses the main thread in slices, and a heartbeat task that straddles a pause reads as a gap with nothing behind it — a Chromium trace showed a **58 ms `onmessage` with no other event inside it**. So every run now ends with a **"control: no switch"** row (same page, same window, no switch): at 2× it reads 0 in 19 of 20 runs and one 53 ms gap in the 20th — the floor this bar sits on.
3. **The rig's first three hops carry a rig-only cost** (Concept A has no device copy, so its rows seed draws it ~4 s in, and the view re-frames on the next activation). Two hops were added — **"back, 2nd"** and **"revisit, 2nd"** — the steady state the owner actually measures (both plans already opened once this session).

### What was built
The plan you just left stayed MOUNTED, hidden and detached from the page (a portal into a detached box, so no query/census/hit-test ever saw two planners), at most one kept; it did not re-render on app renders; it re-applied its own layer set when shown; it owned no window hook, floating panel or Alt picker while hidden. Three defects that only a hidden planner exposes were found and fixed on the way (a 0×0 box taken as the canvas size; the tile pacer dropping every queued tile of a detached map, which the blank-tile heal then cache-busted and re-downloaded; per-tile compositor layers — a 20–40 ms frame with no script when ~250 retained tiles came back at once). The owner's data-safety condition was met first: `ui-audit/verify-plan-switch-writes.mjs` (below) PASSED on it and FAILED on each of three mutants that removed a safeguard.

### Why it was not shipped — same harness, same calibration (2×), 10 runs each, worst gap per run, median / worst (ms)
| action | main (0ade8dd) | keep-alive build |
|---|---|---|
| Bolt-on → Concept A (first visit) | 87 / 144 | 69 / 92 |
| Concept A → Bolt-on (back) | **36 / 40** | **77 / 100** |
| Bolt-on → Concept A (revisit) | 43 / 62 | 42 / 66 |
| back, 2nd | 39 / 67 | 35 / 53 |
| revisit, 2nd | 43 / 47 | 37 / 55 |
| control: no switch | 0 / 53 | 0 / 0 |
| cold open Bolt-on (5 runs) | 402 / 463 | 499 / 534 |
| Richfield → Grand Port (back, 5 runs) | 158 / 185 | 222 / 382 |

The steady-state rows (the owner's case) are a wash within the instrument's floor; the first re-show, the cold load and the other project's back switch got WORSE. A re-show is not free: the outgoing planner still re-renders to deactivate, the reattached subtree is laid out and painted, and the aerial grid returns in one frame. **Round 3 had already made the remount cheap enough that keeping a second planner alive does not beat it.** Per the owner's instruction ("if you can't prove it, fall back to an approach that unmounts and say so loudly") the planner unmounts on a switch, as before.

### What DID ship
1. **A real data defect, found by the safety harness: signing out copied the plan on screen into the SIGNED-OUT device store** (`planarfit:sites:v1:p:<id>`, ~200 ms after the click, on main). `lib/saveDedupe.js` `mayWriteForAccount` — a plan opened under an account is never written into another account's or the signed-out store. DATA.md invariant 18.
2. **A switch no longer writes the plan being left twice** (`writeIsRedundant`: the switch handler's flush, then persist-on-leave on unmount, wrote the identical record back to back; the second is skipped only while the store provably still holds the first).
3. The instrument: `--cpu`, the 2nd-round hops, the no-switch control (`perf-plan-open.mjs`), and `verify-plan-switch-writes.mjs`.

### The shipped build against main — same harness, 2×, 10 runs (5 for the adjacent rows), median / worst (ms)
| action | main | shipped |
|---|---|---|
| first visit | 87 / 144 | 88 / 141 |
| back | 36 / 40 | 37 / 76 |
| revisit | 43 / 62 | 41 / 57 |
| back, 2nd | 39 / 67 | 43 / 148 (5/10 runs over 50) |
| revisit, 2nd | 43 / 47 | 39 / 84 |
| control: no switch | 0 / 53 | 0 / 0 |
| cold open Bolt-on / Concept A | 402 / 463 · 438 / 535 | 397 / 429 · 373 / 644 |
| Grand Port → Richfield · back | 721 / 757 · 158 / 185 | 765 / 866 · 98 / 164 |
**No speed claim is made for this round: the two builds are indistinguishable within the run-to-run spread** (the "back, 2nd" worst of 148 and the wide adjacent-row ranges are single runs on a shared CPU; the medians are all within a few ms). What this round changed is a write path and the instrument, not the switch's cost. The budget file is NOT tightened, because nothing measured moved; the two new steady-state rows and the control get budgets so a regression there fails.

### ⛔ STILL NOT MET — stated as loudly as the rest
- **The owner's bar is not proven met, and this round did not move the steady-state switch.** In the calibrated rig the steady-state switches on main already sit at medians of 39–43 ms with 0–1 of 10 runs over 50 — the same rate as the no-switch control. Whether that matches his machine cannot be decided here: **the arbiter is his heartbeat** on the shipped build (the item's live check).
- **What remains over the bar in the rig is the first open of a plan the device has never drawn** (the rows seed draws it ~4 s in, in one render) **and cold loads (400–500 ms) and the larger plan's first open (≈720 ms)** — none of them a switch between two plans he already has open, and none touched here.
- **Not to be retried without new evidence:** keeping the previous planner mounted. The table above is the reason; the safety harness is ready if someone does.

### ✅ Owner's verdict, 2026-10-09 (~1:15 AM Central, build 49043f7, his signed-in Chrome — V1652977)
Six Bolt-on ↔ Concept A switches, gaps over 50 ms: [52, 102, 53] · [54] · [58, 51] · [67] · [75, 53] · [57]; the same tab idle with no switching read 51–84 ms every ~6 s, so 50–85 ms is his instrument's floor. **The back-and-forth switch is at the noise floor — B2233521 closed.** The one ~100 ms gap is the first switch to Concept A after a page load — the first-time-open cost this round isolated (with fresh page loads and the larger plan's first open), which the owner is dispatching as its own item.

## Round 5 (B2236000, 2026-10-09) — the first open of a plan, the larger plan, and the app opened fresh

**The brief.** After four rounds the back-and-forth switch between two plans already opened is at the noise floor on the owner's machine (V1652977). Still clearly long: (1) the first time this computer opens a plan, (2) opening the app fresh, (3) the larger plan ("Richfield") the first time. Acceptance: red-proof each case on current main, then the same harness / same tree / only the fix toggled, 10 runs each, every case reported even if it does not move, a perf budget per case, and a live signed-in check (V1655104).

**Instrument (all in `ui-audit/perf-plan-open.mjs`; same MessageChannel heartbeat, same 200 ms known-good arm, `--cpu 2` = the calibration that reproduces his main-build readings, the no-switch control row).** Three scenarios were added because the existing rows did not isolate the cases: **`first-open`** (land on Concept A in a fresh profile, then open Bolt-on — a plan with no device copy, so its rows seed draws it in ONE render; the old "first visit" row hops to the small road-less Concept A and under-reads this), **`reload-onto-plan`** (a RELOAD of a page that has been open on the plan — storage warm, every chunk / the map / React cold; this is how the owner opens the app, and it lands on the plan directly, unlike the empty-profile `cold-bolt-on` which detours through the map), and **`open-map-after-reload`** (the price check for change 3 below). `byLabelCpu2` in `perf-plan-open.budget.json` is the 2×-throttled budget (the 1× budgets are not a statement about a throttled CPU; a throttled run is scored against `byLabelCpu2`). Every scored row also records the by-value road caches' hit/miss counts (`roadCaches`).

### Where the time was (CPU profiles resolved through the build's sourcemaps; ms at 2×)
| case | the long task | what is inside it |
|---|---|---|
| **first open of Bolt-on** (343 ms span after the rows arrive) | ONE React render of the seed | `SitePlanner` render 228: the dissolved road network **133** (clipper union + the morphological close 45 + the curb-stripe clips 37), `siteMetrics` 39 (its road-ring offsets — the SAME ring `roadStripRing` had just offset for the network, offset again), ElNodes 30 |
| **Richfield first open** | the same shape, bigger | render 432: `useMemo` 330, of which the dissolve alone ≈ 150, plus ~80 ms of drive-pad outline cuts in the ElNodes |
| **app opened fresh** (reload) | three tasks of 240–280 ms each | (a) the plan's first render from the device copy: `SitePlanner` 212 incl. road network 111, `siteMetrics` 23, plus `loadSitesList` (the whole library, 143 plans, read + migrated) 38–60; (b) **a SECOND full render of the plan** — the page had no memory of the canvas box, so the first render ran at the placeholder box and the boot framing then re-rendered every element at the real view (~250–280 ms, the cost round 3 removed for in-session switches only); (c) a later sites-list refresh render |
| **cold open, empty profile** | a 330–410 ms single scheduler task (trace: one `B` call, 408 ms) | the whole app's first mount — React render + commit of the shell, the map, both headers, the planner; no single hotspot over ~50 ms (PriorityToolbar's first forced layout 45–100, MapFinder's pins 36–80, `ProjectBreadcrumb` 58–79, `SitePlanner` 40–70) |

### What shipped
1. **The road network is warmed in slices BEFORE the seed renders** (`lib/roadNetBuild.js`). The body of `SitePlanner`'s `roadNet` memo moved there VERBATIM as a generator (`roadNetSteps`, `yield;` between one road's ring, one cluster's dissolve, one road's curb stripes); the memo drives it to the end (`driveSteps`), `warmSeedCaches` → `warmRoadNet` → `warmRoadNetFromEls` drives the same steps in ~8 ms MessageChannel slices after the rows are fetched and before anything is seeded. `dissolveRingsSteps` (the dissolve as steps: union · close · tree · each ring's spike collapse) and the drive-pad outline cuts are warmed too. The caches are **by value**, so the render — handed different element objects — finds every answer; a warm-up that disagrees with the render only misses the cache, it can never change geometry. Cache caps raised (dissolve 48 → 200, clip 400 → 800: a clear at the cap would throw a warm-up away).
2. **`roadSurfaceRing` is cached by value** (it was offset by clipper up to three times per render — the network memo, `siteMetrics`' paved-area pass, the road's own ElNode — and once more per edit for every untouched road).
3. **The Map mode is built when it is first shown** (`SitePlannerApp`): the second `AppHeader` and the whole `MapFinder` (a Leaflet map, its layers panel, a pin per saved plan) used to be mounted hidden at boot; they now mount the first time the map is shown and stay mounted afterwards (keep-alive unchanged). `MapFinder` additionally parks its saved-site pin rebuild while hidden and runs it before paint when the map is shown; `ProjectBreadcrumb` builds its project rows only while the switcher is open (the JSX was evaluated on every header render, 143 rows, ~60 ms).
4. **The canvas box is remembered across page loads** (`lib/canvasGuess.js`): the last full measurement is stored with the window size and pixel ratio it was taken in and offered as the first render's guess only for the SAME window. It is still a guess — the boot framing measures the real box, owns the reveal (constraint #8, B1574432's gate untouched) and re-frames exactly as before when the guess is wrong. This removes the reload's second full render.

### Measured — same harness, same tree, two builds (baseline = main at 49043f7; after = this change), `--cpu 2 --library 140`, **10 runs each**, worst gap of each run, median / worst (ms), runs over 50 / over 150, median of the summed gaps over 50 ms
| action | baseline (median / worst) | after (median / worst) |
|---|---|---|
| cold open Bolt-on | 424 / 617 (n=10; >50 10, >150 10; sum>50 med 2486) | 427 / 524 (n=10; >50 10, >150 10; sum>50 med 2326) |
| Concept A → Bolt-on (first open, fresh profile) | 252 / 454 (n=10; >50 10, >150 10; sum>50 med 503) | 88 / 161 (n=10; >50 10, >150 1; sum>50 med 295) |
| plan → Map (first time after the app opened on a plan) | 420 / 511 (n=10; >50 10, >150 10; sum>50 med 1066) | 309 / 495 (n=10; >50 10, >150 10; sum>50 med 1383) |
| reload onto a plan (app opened fresh) | 365 / 830 (n=10; >50 10, >150 10; sum>50 med 1837) | 271 / 377 (n=10; >50 10, >150 10; sum>50 med 963) |
| Bolt-on → Concept A (first visit) | 98 / 159 (n=10; >50 10, >150 1; sum>50 med 299) | 102 / 169 (n=10; >50 10, >150 2; sum>50 med 333) |
| Concept A → Bolt-on (back) | 40 / 56 (n=10; >50 1, >150 0; sum>50 med 0) | 42 / 61 (n=10; >50 1, >150 0; sum>50 med 0) |
| Bolt-on → Concept A (revisit) | 45 / 63 (n=10; >50 4, >150 0; sum>50 med 0) | 38 / 60 (n=10; >50 3, >150 0; sum>50 med 0) |
| Concept A → Bolt-on (back, 2nd) | 46 / 64 (n=10; >50 2, >150 0; sum>50 med 0) | 37 / 52 (n=10; >50 1, >150 0; sum>50 med 0) |
| Bolt-on → Concept A (revisit, 2nd) | 41 / 52 (n=10; >50 2, >150 0; sum>50 med 0) | 37 / 54 (n=10; >50 1, >150 0; sum>50 med 0) |
| control: no switch (instrument floor) | 0 / 0 (n=10; >50 0, >150 0; sum>50 med 0) | 0 / 0 (n=10; >50 0, >150 0; sum>50 med 0) |
| Grand Port → Richfield (larger plan) | 775 / 869 (n=10; >50 10, >150 10; sum>50 med 1138) | 388 / 464 (n=10; >50 10, >150 10; sum>50 med 685) |
| Richfield → Grand Port (back) | 151 / 199 (n=10; >50 10, >150 6; sum>50 med 415) | 94 / 207 (n=10; >50 10, >150 3; sum>50 med 240) |

**Read this table in three groups.**
- **The targeted cases that moved.** *First open of a plan this device has never drawn:* 252 / 454 → **88 / 161** (−65 %; 10/10 → 1/10 runs over 150). *The larger plan's first open:* 775 / 869 → **388 / 464** (−50 %; the summed long gaps 1138 → 685). *The app opened fresh (reload):* 365 / 830 → **271 / 377** (median −26 %, worst −55 %, **summed long gaps 1837 → 963, −48 %**) — the worst gap is not "sharply" below the owner's 150 ms line (10/10 runs still cross it), what is gone is the second full render.
- **The case that did NOT move: the empty-profile cold open (424 / 617 → 427 / 524, summed long gaps 2486 → 2326).** Reported as loudly as the rest. Its 330–410 ms task is the first mount of the whole app (see the table above) — dispersed, unsliced React work with no hotspot to remove, and change 3 does not apply (that flow lands in Map mode first, so the map IS wanted). Its budget is a ceiling at the baseline's worst plus headroom, not an achievement.
- **Nothing else got slower.** The steady-state switches (back / revisit / 2nd round trip) and the no-switch control are unchanged within the instrument's spread; the first re-show of the Map (the price of change 3: it is now built at the first click) measured **420 / 511 → 309 / 495** — not slower (the old hidden map re-laid itself out on show, which is not free either).

### Budgets (per case, `ui-audit/perf-plan-open.budget.json` → `byLabelCpu2`; baseline FAILS the three that moved, the shipped build passes all 13)
first open 200 (baseline worst 454) · Richfield first open 560 (869) · reload / app opened fresh 460 (830) · cold open (empty profile) 650 = a ceiling (617 before, 524 after) · plan → Map 620 · switch rows 110 / first visit 210 · Richfield back 250.

### ⛔ STILL NOT MET / NOT DONE — stated with the evidence
- **Reload's worst gap (≈ 270 ms median at 2×) is the plan's own first render from the device copy** — `SitePlanner` ≈ 210–270 ms of which the road network is ≈ 110: it runs inside the render because nothing warms it before the planner mounts. Warming it needs the mount GATED until the slices finish (SitePlannerApp, between `loadSite` and `<SitePlanner>`), which touches boot-resume / the framing reveal and adds latency to every first open; estimated −110 ms off that one task. **Not done; the next move.**
- **`loadSitesList` is a whole-library read + migrate on every sites refresh** (4× per cold load, 25–60 ms each at 2× on a 143-plan account). B2165120 made WRITES flat, but this READ still takes private copies (`planStore.readFresh`) and migrates every record. A stamp-keyed memo needs a read-only model contract (callers mutate what it returns), and `refreshSites()`'s fresh-array identity has a FUNCTIONAL role (the route effect's retry-then-"missing" verdict re-runs on it), so it cannot simply be skipped when nothing changed. **Named as B2165120's read-side follow-on, not attempted.**
- **Why the first mount is one unsliced task is not established.** `goPlan` already uses `startTransition`, yet a Chrome trace shows one 408 ms `B` (scheduler) call. A store update through `useSyncExternalStore` forces a synchronous lane and would explain it; **not verified**, so not built on.
- **The Richfield render that remains (≈ 330 ms at 2×)** is the plan's own render + commit with no hotspot over ~50 ms (pond geometry in `siteMetrics` is cached by ring IDENTITY, which a warm-up on re-folded rows cannot prime — tried: no gain, and it made back-switches slower, so it was removed).
- **Not a claim about his hardware.** Everything above is a container at 2× CPU throttle; the arbiter is his heartbeat (V1655104, `Blocker: real-data`).

### Data safety
Nothing here touches a write path: the warm-up reads fetched rows and fills caches; the canvas guess is a tiny non-plan key (`planarfit:canvasGuess:v1`, window-geometry-gated); the map-mode and pin changes mount/park UI only. `ui-audit/verify-plan-switch-writes.mjs` (round 4's recorder) was re-run on the final build — see the item.
