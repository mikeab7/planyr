# THE POST-DRAW TAIL, ATTRIBUTED — and the pan that does not get dearer

**NEW-1 of the speed program's phase 4, 2026-08-06.** The item's instruction was explicit: **DO NOT
FIX ANYTHING — the deliverable is the BREAKDOWN.** Nothing in this document is a fix.

Instrument: `ui-audit/boot-tail.mjs` (driver) + `ui-audit/lib/bootTail.mjs` (protocol, definitions,
limits) + `test/bootTail.test.js` (24 unit tests on the pure half).

---

## 0. The regime, and which plan — stated first because it bounds everything below

| | |
|---|---|
| CPU | **1×, not throttled.** The owner's complaint is at 1×; every prior number in this program was at 4×. |
| display | **dpr 2** (retina) |
| tiles | **`--fake-tiles`** — a real, decodable, per-tile-unique PNG is served locally, so decode, bitmap allocation and texture upload are real work rather than absent |
| machine | **4 cores.** His has 28. Parallel-friendly work (raster, decode, GC) is relatively DEARER here; main-thread-serial work is comparable. |
| network | GIS services and Supabase are **ABSENT, not slow** — this sandbox blocks every external host |
| session | **logged out** — the sandbox cannot sign in |

**Which plan, and why it is not Sylvestri.** The item names the owner's Sylvestri / Concept D site.
`ui-audit/fixtures/sylvestri-concept-d.json` exists, and **it cannot be used**: it is an
elements-only export — 22 elements, **no parcels, no settings, no origin** — so it cannot be opened
as a plan at all, let alone exercise the boot path this item is about (no settings means no layer
overrides; no origin means no map). Its two consumers (`test/zoneAlongAnchor.test.js`,
`e2e/dock-zone-anchor.spec.js`) both use it as a bag of geometry, never as a plan. The real record
lives behind a signed-in session this sandbox cannot reach.

So the fixture is **`goose-creek-plan1copy.json`** — the owner's own Goose Creek plan pulled from
production, already the reference of record for every other perf instrument here: **62 elements ·
6 parcels · 2 ponds · 6 centreline roads with arc vertices · its real 30-key settings.** It is a
**FLOOR** on Sylvestri, not a match.

---

## 1. TWO METHOD CORRECTIONS, before any number

### 1a. `canvasDrawn` cannot be the start of the tail — it has a quiet period built into it

B1431's `canvasDrawn` mark fires when the canvas's node count **has held still for 250 ms**. A
window that begins there has already excluded a quarter-second of work *and* can only begin once
the app has gone quiet once. Measured here, `canvasDrawn` lands **20–28 ms before the app actually
falls silent** — so "canvas drawn → settled" is near-zero **by construction**, and it is not the
window the owner is describing.

The window used here starts at **FIRST INK** — the first frame the plan canvas holds real content,
which is the moment he means by *"it immediately loads super fast"*. Both marks are reported.

### 1b. "Settled" is OBSERVED SILENCE, not a wait

`settlePoint` (unit-tested) takes the last activity event after which nothing at all happened for
750 ms. Activity is deliberately over-inclusive — a **React commit** (counted from React's own
`onCommitFiberRoot`, not inferred), **any DOM mutation**, a **long task**, a **network response**,
an **IndexedDB read**. A run that never goes quiet inside the ceiling is reported **NOT SETTLED**
with its reason; it is never rounded down to the ceiling and presented as a tail.

> **⛔ One instrument bug is recorded here because its output was plausible.** The first run
> reported "0 mutation records" and "no aerial tile ever arrived" while 246 tiles were being served
> and 114 were in the DOM. Two silent `catch {}` blocks: a `MutationObserver` observing
> `document.documentElement`, which is null at document-start, and a URL matcher reading the last
> path segment of an extensionless ArcGIS tile URL. **A broken observer reads exactly like a quiet
> app.** Every observer now reports whether it installed (LOUD-FAILURE), and the harness prints the
> failures before any number that depends on one.

---

## 2. THE TABLE — where the post-draw time goes

| | 0 saved layers | 6 saved layers | 0 layers, 4× CPU |
|---|---:|---:|---:|
| first ink | 635 ms | 620 ms | 2,304 ms |
| node count settled (B1431's `canvasDrawn`) | 1,060 ms | 1,100 ms | 2,594 ms |
| **settled** (750 ms of observed silence) | 1,088 ms | 1,119 ms | 3,223 ms |
| **THE TAIL — first ink → settled** | **453 ms** | **499 ms** | **919 ms** |
| busy inside the tail | 43.1% | 48.3% | **81.0%** |
| React commits in the tail (React's own count) | 10 | 9 | 8 |
| DOM mutation records in the tail | 3,246 | 3,277 | 3,232 |
| long tasks ≥50 ms in the tail | 1 (62 ms) | 1 (67 ms) | 5 (531 ms) |
| **UNATTRIBUTED** | **0.0%** | **0.0%** | **0.0%** |

**The 453 ms tail, by named phase** (1×, 0 layers; source-map-resolved, first match wins):

| ms | % | phase |
|---:|---:|---|
| 257.9 | 56.9% | **idle — main thread free** |
| 44.8 | 9.9% | **V8 (program) — parse / compile / VM** |
| 44.8 | 9.9% | React render & commit |
| 30.9 | 6.8% | Planner render body (`SitePlanner.jsx`) |
| 18.0 | 4.0% | browser native (DOM · layout · style) |
| 15.9 | 3.5% | Basemap (Leaflet / Esri) |
| 10.7 | 2.4% | Planner app & panels |
| 9.7 | 2.1% | garbage collection |
| 6.1 | 1.4% | Model load & normalisation |
| 4.8 | 1.1% | App shell & routing |
| 3.1 | 0.7% | Site geometry (roads · ponds · contours) |
| 3.0 | 0.7% | Label layout & collision |
| 2.3 | 0.5% | GIS layers, fetches & basemap wiring |
| 1.0 | 0.2% | Map finder |
| **0.0** | **0.0%** | **UNATTRIBUTED** |

B1431 got UNATTRIBUTED to 0.8% and that was the standard to hold. **It is 0.0% here** — not one
sample in the window landed outside a named rule.

---

## 3. THE HEADLINE, and it is not the one the item expected

> ### There is no three-second post-draw tail at 1×. It is 453 ms, and 57% of it is idle.

**And the 2,216 ms in `docs/PERF-CONSTRAINTS.md` §7 is not this window.** Two things were folded
into it:

1. **It was measured at 4× CPU throttle.** Measured here at 4×, the app's own tail is **919 ms** —
   roughly double the 1× figure, which is what a partly-idle window does under throttling.
2. **It was bounded by the harness's own gesture.** Its two segments run `canvasDrawn → the press
   is DELIVERED` and `press → release delivered`. Those measure **how long a scripted press took to
   reach a saturated main thread at 4×**, which is a real and interesting number about input
   latency — but it is not "the app is still working after it finished drawing", and calling it the
   post-draw tail attributed it to the wrong mechanism. The correction is §1a: `canvasDrawn`
   already implies the node count went still, so the app was largely *done* at the start of that
   window.

**The honest consequence: the owner's symptom is not reproduced in this sandbox.** What is missing
from his regime, in the order I would bet on it: his real plan (larger than 62 elements) · **signed
in**, which turns on the element-sync seed and the Supabase fetch that never fire here · **live
GIS**, so his layers actually fetch rather than merely mount · his saved layer set · 28 cores
against 4. Every number above is a floor.

---

## 4. EVERY CANDIDATE, KILLED OR SIZED

Each was treated as a hypothesis to kill. A candidate that never fired is a **result**.

| candidate | verdict | evidence |
|---|---|---|
| **Supabase auth + the initial site fetch** | **REFUTED for this run** | zero Supabase requests. Structural, not incidental: the whole element-sync engine returns at its first line unless `isCloudActive()` (`SitePlanner.jsx:3873`), so **logged out, the seed and the model normalisation never run at all.** On his machine they DO — this is the single largest hole in the reproduction. |
| **element-sync seed + model normalisation** | **REFUTED here, UNMEASURABLE here** | same gate. `refetchReplace` → `eng.seed(rows)` → `rowsToModel` (`SitePlanner.jsx:3743–3871`) is signed-in-only. |
| **parcel-snapshot hydration from IndexedDB** | **REFUTED — it does not run on plan open at all** | `ensureSnapshot()` (`lib/parcelSnapshot.js:140`) has exactly one caller: MapFinder's `[selectMode]` effect (`MapFinder.jsx:1120`). SitePlanner never imports it. The 2 IndexedDB reads observed both complete **before first ink** (208–361 ms) and are the underlay-raster rehydrate (`SitePlanner.jsx:2201–2215`) and the kv store. |
| **the saved layer set arriving and enabling** | **NOT in the tail on this plan — and the plan opens with ZERO** | `defaultOverlayState()` (`lib/layers.js:963`) starts **every** layer off, and a plan restores only its own sparse `layerOverrides`; the reference fixture saves none. All 4 Leaflet panes exist **at first ink**; no layer becomes visible after it. With **6 layers seeded through the app's own registry ids**, the tail moves 453 → **499 ms (+10%)** and commits across the boot 20 → 26. ⚠ **Floor only**: those layers mount, stage and allocate but never receive a byte, because the sandbox blocks their hosts. |
| **the first `roadNet` dissolve and `pondContours` pass** | **SIZED — 0.7% of the tail** | "Site geometry" 3.1 ms; Clipper 1.0 ms. They are `useMemo`/render-body work (`SitePlanner.jsx:17358`, `:23047`), so they cost on **edit**, not after boot. |
| **the first label layout / declutter** | **SIZED — 0.7% of the tail** | "Label layout & collision" 3.0 ms. |
| **React commit storms from effect cascades** | **REFUTED — counted, not estimated** | **8–10 commits** inside the tail (20–26 across the whole boot), from React's own `onCommitFiberRoot` via a DevTools hook installed before React loads. 211 `useState` and 77 `useEffect` in one component do **not** produce a commit storm at boot. |
| **aerial tile decode / texture upload** | **PRESENT and cheap here** | 246 tiles served, 114 in the DOM; Leaflet 15.9 ms = 3.5% of the tail. |

**What the busy 195 ms actually is:** the largest single named item is **V8 parse/compile at
44.8 ms** — lazily-imported chunks still compiling after the canvas has ink — then React commit
(44.8 ms) and the planner's own render body (30.9 ms). There is a single burst of **~3,240 DOM
mutation records in one 250 ms bucket** immediately after first ink: the canvas completing from
partial to its full 976 nodes, plus the tiles.

---

## 5. THE PAN LADDER — does the same gesture get dearer between t=1s and t=3s?

One **fresh page load per rung** (a probe at t=1s warms memos and settles layout that the t=2s
probe would then inherit), rungs **interleaved** across reps, view asserted neutral, cost measured
as **main-thread work per gesture** — script + layout + style differenced from the renderer's own
cumulative counters at microsecond resolution. **Not a frame median**: B1432's ±99.8% floor was
16.7 ms display-clock quantisation *in the metric*, which no number of repeats could ever clear.

**9 reps × 5 rungs, 1×, dpr 2, fake tiles:**

| delay | n | work/gesture | range | vs t=1s | canvas nodes | tiles | commits |
|---|---:|---:|---:|---:|---:|---:|---:|
| t=1s | 9 | 483.7 ms | 415–548 ms | 0% | 976 | 114 | 148 |
| t=2s | 9 | 498.2 ms | 449–547 ms | +3.0% | 976 | 114 | 147 |
| **t=3s** | 9 | **480.5 ms** | 451–512 ms | **−0.7%** | 976 | 114 | 147 |
| t=5s | 9 | 461.9 ms | 452–537 ms | −4.5% | 976 | 114 | 147 |
| t=10s | 9 | 479.8 ms | 444–574 ms | −0.8% | 976 | 114 | 147 |

> ### NO. The same pan at t=3s costs −0.7% of what it cost at t=1s. Nothing lands in between.

The rung medians span 462–498 ms with **no monotone trend**, every rung's range overlaps every
other's, and the three observables that would explain a rise — **canvas nodes, tiles and React
commits — are IDENTICAL at every rung.**

**One honesty note about the floor.** It is `spread / median`, and a range widens with sample size:
4 reps gave ±8.0%, 9 reps ±27.6%. So the floor is not a fixed property of the machine and a verdict
that turns on it is weak — at 4 reps t=3s read **+8.4% against a ±8.0% floor**, a margin of 0.4
percentage points, which the 9-rep run shows was noise. The finding that does **not** depend on the
floor is the one above: no trend, overlapping ranges, identical observables. The 4-rep result is
recorded here rather than discarded, because a verdict that flips with sample size is a fact about
the instrument that a later reader needs.

---

## 6. WHAT TO ATTACK, with a predicted saving

Ranked by what this dispatch actually measured, not by what was expected.

| # | target | predicted saving | basis | owner |
|---:|---|---|---|---|
| 1 | **The plan-switch leak** — every project switch strands ~2,342 detached DOM nodes and ~106 listeners, **linearly and without bound** (§ `docs/PERF-PLAN-SWITCH.md`) | removes an **unbounded** per-switch cost; at 3 cycles `rendererNodes` is already **+326%** | MEASURED this dispatch, V8's own detachedness flag | **B1439** |
| 2 | **Layers: ~360 ms of a gesture per enabled layer**, +102.5% across 4 | the largest measured per-gesture amplifier, and the owner never turns them on — the FILE does | MEASURED (B1436) | small fix + **B1424** |
| 3 | **Panels: +34.4% of an identical gesture at 4 open**, almost all script | ~683 ms of script on unchanged content | MEASURED (B1436) | **B1351** |
| 4 | **Before first ink, not after it.** 635 ms to first ink at 1×, of which the bulk is `first script → first contentful paint`. The 453 ms tail is 57% idle. | the boot's real cost is upstream of this document's window | MEASURED here + B1431 | **B1349 / B1064** |
| — | ~~the post-draw tail~~ | **nothing to attack: 195 ms busy, no single item above 45 ms, 0.0% unattributed** | this document | — |

**And the thing this document cannot do, said plainly.** It cannot reproduce the owner's symptom,
because the two mechanisms most likely to cause it — a signed-in element-sync seed and live GIS
fetches — are structurally absent from this sandbox. The instrument is built and the protocol is
fixed; running it against a signed-in session on his own plan is the measurement that would settle
it, and that is a live-verify item, not a sandbox one.
