# Session growth — what accumulates across a work session, and what a reload undoes

*B1121's recurrence investigation, 2026-08-08. Instrument: `ui-audit/session-growth.mjs` +
`ui-audit/lib/sessionGrowth.mjs` (`npm run perf:growth`). Companion docs: `PERF-PLAN-SWITCH.md`
(the retired B1439), `PERF-REAL-PLANS.md` (which plans the harness can open), `PERF-TAIL.md`,
`PERF-BUDGETS.md`.*

---

## 0. The sentence this whole document is about

> *"if I reload, it's immediately pretty quick and then, like, give it some panning or zooming or I
> don't even know, and then, you know, a minute later or two, it's, like, lagging just to go side to
> side."*

Unchanged for weeks. It is the oldest and now the **only** unexplained symptom in the speed program.

## 1. The half of that sentence nobody had used

The sentence contains two facts, and every prior instrument used only the first:

1. cost **RISES** with time in session — a detector;
2. cost is **RESTORED** by a reload — an **eliminator**.

Fact 2 is the sharper one. A reload destroys the document, the JS heap, the DOM, every listener,
every timer, every in-memory cache, and the whole React tree. It does **not** destroy localStorage,
IndexedDB, the HTTP cache, the V8 code cache, or anything on a server. Therefore:

> **Any candidate that survives a reload cannot, by itself, be the mechanism.**

If the cause were "IndexedDB filled up", the page would still be slow after the reload, because the
store is still full. He says it is fast. That single observation takes the entire durable-storage
family off the table — which is most of the candidates a reasonable person enumerates first, and all
of the ones this program's recent storage work (**TIER-BY-REBUILDABILITY**, B1427/B1429) makes most
salient.

**The one caveat, stated so it is not discovered later:** a durable store is excluded as *the
mechanism of the slope* — not as a contributor to a **constant** cost. A permanently large store
makes every session slower from its first second, which is **B1121 complaint (b)** and a different
question. `admissibility()` says "excluded" and names this, so nobody reads it as "harmless".

## 2. A step is not a slope, and a pair cannot tell them apart

Two points fit a step and a line equally well, so a before/after pair cannot even be *asked* which it
is. With a curve it becomes decidable, and the answer changes what to do:

| shape | meaning | consequence |
|---|---|---|
| **SLOPE** | an accumulation | unbounded; gets worse the longer he works; bound whatever accumulates |
| **STEP** | a mode change — something switched on and stayed on | bounded; does **not** worsen with time |
| **SAWTOOTH** | a cache filling and being dropped | looks like a slope sampled at the wrong moments and like noise at the right ones |
| **FLAT** | nothing | — |

`classifyCurve` fits all four, reports each model's residual, requires a 35% improvement over the
constant null before preferring a richer model, and **refuses to name any shape for a series whose
whole range fits inside the measured noise floor**. That refusal is the most important branch in the
file: a shape fitted to noise is a story, and this program has already paid for four of those.

## 3. The enumeration — pre-registered, before anything was measured

The dispatch asked for the candidates to be listed first *"so the sweep is not shaped by whichever
one you thought of first."* The list is committed in `ui-audit/lib/sessionGrowth.mjs` as
`GROWTH_CANDIDATES`, each with a **prediction** about whether a reload zeroes it, made in advance and
**scored afterwards**. Twenty-two candidates in six families:

- **memory** — JS heap in use · retained heap after a forced collection
- **dom** — renderer nodes · detached nodes (approximated) · canvas SVG nodes · document elements ·
  layout objects
- **listeners / loops** — event listeners (the renderer's own count) · rAF callbacks in flight ·
  timers outstanding · observers still connected
- **map** — tile elements retained · tiles that actually decoded · compositor layers
- **model** — elements drawn (**the control**) · plan switches made · undo depth
- **durable** — localStorage bytes · origin storage (IndexedDB) in use
- **cache / sync** — GIS screening cache (in-memory half) · pending-edit journal · telemetry buffer

Four of the twenty-two are **not observable from outside the app** and are recorded as open questions
rather than quietly dropped: `undoDepth`, `gisCacheEntries`, `pendingJournalOps`, `telemetryBuffer`.
An unmeasured candidate is an open question, not an exonerated one.

## 4. The regime, and why it is not the repo default

| | this run | every prior growth run |
|---|---|---|
| plan | **the owner's real plans**, with their rasters | synthetic Goose Creek (62 elements, no raster) |
| dpr | **2.15** — his panel | 1 |
| CPU | **1×** — his machine | 1× or 4× |
| session | **mixed** — pan · zoom · panel · layer · edit · plan switch, repeated | one axis varied, everything else frozen |
| reload | **measured** | never |

The mixed shape is the part nothing had ever run. B1432 varied gesture count with content frozen;
`session-axes.mjs` varied one axis with everything else frozen. A real session does all of it at
once, and an interaction between two axes is invisible to both designs by construction.

**B1432's null on gesture COUNT alone — flat across 3,000 gestures in three regimes — stands and is
not re-derived here.**

## 5. What was re-taken, and what it changed

Two instrument defects were fixed before any number below was taken. Both had been silently shaping
results.

### 5a. The harnesses could not open a plan the owner has ever complained about

`session-axes.mjs` and `interaction-degradation.mjs` had no way to load a real plan; both drove the
synthetic Goose Creek scene. `--fixture` (and `--fixture-b`) now seed real saved plans with their
rasters through a Playwright `storageState`, via the shared resolver in `lib/fixtureSeeding.mjs`.

### 5b. The plan-switch axis was switching between a plan and a subset of itself

`session-axes.mjs`'s built-in plan B is plan A **truncated by half** (`perfScenarioSiteB`). Every
plan-switch reading this program has produced was therefore a switch between one synthetic plan and a
subset of itself — same origin, same county, same settings, same (absent) rasters. The owner switches
between whole, unrelated, raster-bearing plans, which tear down and rebuild different things. The
proof that the switch took also had to change: it asserted the element count **fell**, which is only
true of a truncated companion; it now asserts the count **changed**, so a genuine switch to a *larger*
plan is no longer suppressed as "the route change did not take".

### 5c. The counter read that made checkpoint 0 the largest reading in the session

`Nodes`, `JSEventListeners` and `usedJSHeapSize` all count objects that are already garbage but whose
collection has not run. Reading them without a preceding collection reports **GC scheduling, not
retention**. The first version of this harness collected only for the heap figure: on its smoke run
that made checkpoint 0 the highest node reading of the whole session (7,392 falling to 5,497 by
checkpoint 1) purely because the boot's garbage had not been swept. `counters()` now collects first
and reads everything afterwards. Same class of error as B1439 — an artefact of the instrument
presented as a property of the program.

---

## 5.5 THE RE-TAKES — which prior conclusions survive, and which were artifacts

`B1439` was retired as a harness artifact on the same day it was filed, and three harnesses carried
the defect. The readings taken through them were never re-taken. They have been now, on real plans,
with `waitRelease.mjs` in place.

### Interaction axis (`interaction-degradation.mjs`), re-taken on **bain**, dpr 2.15, tiles decoding

**B1432's null SURVIVES.** 400 gestures on unchanged content: renderer nodes **2136 → 2159 (+23)**,
event listeners (the renderer's own count) **1593 → 1593 (+0)**, canvas nodes **598 → 598**,
elements drawn **47 → 47** (the control held), retained heap **26.05 → 27.15 MB**, tiles **291 → 291**
throughout. The frame-median cost metric hit its own ±99.8% quantisation floor and is
INCONCLUSIVE — which is the known limitation of that instrument and the reason `session-axes.mjs`
exists — but **the growth table is not floor-limited and it is flat.**

That matters because B1432's null had a real weakness: it was measured on the synthetic Goose Creek
scene, which the owner has never called slow and which has no raster overlay at all. It now holds on
a plan he *has* called slow, with a 1728×2592 sheet overlay and a 1800×1167 aerial underlay, at his
own display density, with **3,655 tiles served and 291 retained-and-decoded ≈ 72.8 MB of decoded
bitmap** — memory the JS heap cannot see, and the caveat every prior run in this program had to end
on. **Survives, and is now stronger than it was.**

### Plans axis (`session-axes.mjs`), re-taken on **bain ↔ sylvestri** — and it found a defect in itself

The first re-take reported **RETAINED**: `retainedHeapMB +39.1%`, `rendererNodes +38.1%` after one
A→B→A round trip, measured after **two forced collections**.

**That verdict is wrong, and the growth curve is what proved it.** `session-growth.mjs` sampled the
same counters on four separate switch rounds and found the same spike every time — and found it
**gone one ordinary round of work later**, on every one of them, settling *below* where the session
started. The spike is the outgoing tree awaiting collection, pinned through the forced purge by V8's
**conservative stack scanning** — an effect `PERF-PLAN-SWITCH.md` §14 had already recorded ("a forced
purge drains 2,343 → 1, but natural allocation pressure does not") while the single-sample verdict
was built anyway.

So the instrument was fixed rather than the number reported: `planSwitchVerdict` now takes a **settle
sample (A₂)** and has two new verdicts — **`TRANSIENT`** (spiked, then gone: *"a single sample here
would have reported a leak"*) and **`UNSETTLED`** (spiked, and no settle sample was taken, so it
cannot be called retention at all). A one-sample run can no longer produce the word RETAINED.

**Which is to say: the readings that pointed at a plan-switch leak were artifacts twice over** —
first of the harness's undisposed protocol handle (B1439), and then, after that was fixed, of
sampling a transient once at the only moment it exists.

---

## 6. RUN 1 — Bain ↔ Sylvestri, dpr 2.15, 1× CPU, 8 rounds, 390.7 s of driving, 32,202 tiles served

Plan A **bain-concept-original** (47 elements · 5 parcels · 2 rasters) ↔ plan B
**sylvestri-concept-d-full** (98 elements). Tiles served as real decodable PNGs (`--fake-tiles`), so
this is the retina regime with bitmaps that actually decode — the caveat every prior memory run in
this repo had to end on. **Measured noise floor ±6.3%.**

| round | work ms | heap MB | retained MB | renderer nodes | canvas nodes | detached≈ | listeners | tiles |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 0 | 1323.51 | 21.56 | 17.06 | 2223 | 600 | 185 | 1599 | 291 |
| 1 | 1516.82 | 22.10 | 17.60 | 2355 | 634 | 258 | 1605 | 291 |
| 2 ⇄ | 1560.07 | 23.91 | 19.33 | 3224 | 550 | **1245** | 1659 | 291 |
| 3 | 1468.57 | 23.38 | 18.79 | 2230 | 578 | 203 | 1605 | 291 |
| 4 ⇄ | 1325.12 | 24.19 | 19.59 | 2813 | 360 | **1028** | 1659 | 291 |
| 5 | 1504.07 | 23.59 | 19.00 | 2011 | 393 | 168 | 1605 | 291 |
| 6 ⇄ | 1504.66 | 24.66 | 20.06 | 3044 | 410 | **1199** | 1659 | 291 |
| 7 | 1611.38 | 23.76 | 19.16 | 2082 | 449 | 168 | 1605 | 291 |
| 8 ⇄ | 1486.39 | 25.08 | 20.48 | 3436 | 600 | **1396** | 1659 | 291 |
| **RELOAD** | **1374.44** | **21.41** | **16.85** | **2087** | **600** | **49** | **1599** | **291** |

`⇄` = a round that included an A→B→A plan switch (two switches; eight over the session).

### 6a. THE HEADLINE — the symptom did not reproduce, and that is a real result

**The identical gesture cost 1,323 ms at the start and 1,486 ms at the end — +12.3% against a ±6.3%
floor, and NOT MONOTONE.** It was 1,611 at checkpoint 7 and 1,486 at checkpoint 8; it was 1,325 at
checkpoint 4, *lower* than at checkpoint 1. The classifier calls it a **STEP** — a one-time level
change after the first round, then flat — and deliberately reports the weaker of the two claims it
could have made. Nothing here is *"a minute later or two it's lagging just to go side to side."*

A failure to reproduce is not a fix and it is not a refutation of the owner's report. It means **this
regime does not contain the symptom**, and it narrows where the symptom can live (§8).

### 6b. Plan switching is a SAWTOOTH — and this re-confirms B1439's retirement on real plans

The detached-node count spikes on every switch round and **returns below its previous resting level
on every non-switch round**: 185 → 258 → **1245** → 203 → **1028** → 168 → **1199** → 168 → **1396**.
Renderer nodes follow exactly: the resting values *fall* across the session (2355 → 2230 → 2011 →
2082) while the peaks stay flat. Event listeners are **perfectly periodic** — 1599 / 1605 / 1659,
never anything else — which is **zero net accumulation over eight plan switches**.

This is the strongest version of the B1439 test yet run: two *real, unrelated, raster-bearing* plans
rather than one synthetic plan and a truncated copy of itself, eight switches rather than two, and a
harness whose protocol handles are disposed. **The retired +93.9% `rendererNodes` reading is not
merely withdrawn — it is contradicted.** After eight switches the resting node count is *below*
where it started.

The spike itself is the transient a switch legitimately produces: the outgoing tree, unreachable but
not yet swept, and pinned through the forced collection by conservative stack scanning (the effect
`PERF-PLAN-SWITCH.md` §14 already recorded — "a forced purge drains 2,343 → 1"). It is gone by the
next checkpoint without anything being asked to release it.

### 6c. The one thing that genuinely accumulates and resets — and it is small and uncorrelated

**Retained heap after a forced collection: 17.06 → 20.48 MB (+20%), fitted as a SLOPE, and the reload
returns it to 16.85 MB.** That is the *only* candidate in the admissible quadrant with a genuine
slope rather than a sawtooth. It is also **3.4 MB over six and a half minutes**, and its correlation
with the cost curve is **r = 0.29** — it does not track cost. It is named here as the honest residue,
not as a cause; nothing should be shipped against it.

### 6d. The tile cap holds — the measurement B1121 said could not be taken here

**32,202 tiles were served and the retained tile count sat at exactly 291 for the entire session, at
dpr 2.15, with every one of them decoded** (`tilesLoaded` = `tiles` = 291 throughout). B1121's
backfill-layer cap has until now been proven only by reading the code and by unit tests over the
budget arithmetic — its own entry says *"its magnitude in MB is unknown"* because the sandbox could
serve no tiles. `--fake-tiles` closes that: under a real multi-minute mixed session at retina, the
cap holds flat and does not leak. This does not discharge **V518** (that asks for the owner's own
machine on live imagery) but it removes the mechanism V518 was most likely to find.

### 6e. The durable tier grew 49% in six minutes — excluded here, relevant elsewhere

`localStorage` went **71.6 KB → 106.8 KB** across the session and **kept every byte through the
reload** — correctly classified `PERSISTS` → `EXCLUDED`. It cannot be the slope's mechanism, because
the reload that fixes his lag does not empty it.

It is worth a line anyway, on **TIER-BY-REBUILDABILITY** grounds rather than these: **+35 KB per six
minutes of ordinary work, in a tier with a hard ~5 MB ceiling that the owner's own browser was
measured at 3.88 MB / 78% full.** That is B1427/B1429 territory and B1121 complaint (b), not this
question.

### 6f. Everything else, exonerated

Flat across the whole session and across the reload: rAF callbacks in flight (0 throughout),
observers connected (5), compositor layers (297), elements drawn (47 — **the control held**),
document elements (1691 → 1693), layout objects (1391 → 1391), origin storage (10.79 → 10.84 MB).

### 6g. What this run could NOT see, stated rather than implied

- **Four pre-registered candidates are not observable from outside the app** and remain open:
  `undoDepth`, `gisCacheEntries`, `pendingJournalOps`, `telemetryBuffer`.
- **Logged out.** The pending-edit journal, cloud sync and any signed-in ambient loop (the **B874**
  class) cannot be exercised here at all.
- **Synthetic tiles.** They decode and cost real texture memory, but they are not fetched over a real
  network at real latency.
- **⚠ Run 1 carried a driver defect that ran half the layer axis backwards.** The layer step *flipped*
  a checkbox rather than turning one on, and `showDims`/`showAreas` default ON — so rounds 3 and 4
  turned drawn content **off** (canvas nodes fell 600 → 360 mid-session). Fixed to a cumulative
  enable; **run 2 (§7) is the clean one.** Run 1 is kept in full because a measurement is a historical
  fact about what was run, and because the finding in §6b is unaffected by it.

---

## 8. WHERE THE SYMPTOM CAN STILL LIVE — narrowed, in order

Each entry says what would have to be true, so the next session can attack one rather than re-survey
all of them.

1. **Signed in.** Everything above is logged out, because this sandbox's egress proxy CORS-blocks the
   Supabase auth handshake. That excludes the pending-edit journal, the cloud index, revision
   fetching, and any ambient refresh loop that only arms for a real account — **the B874 class,
   which is the one confirmed mechanism in this repo's history that could starve every frame after
   it.** This is now the single largest unexamined region, and it is `Blocker: auth`.
2. **A real network.** B1433's one costed observation was ~6–8 tile fetches *per gesture*, retained
   flat — churn, not accumulation. Here they are served from memory in-process. On his connection
   each is a request, a decode and a texture upload at wire latency. It is a per-gesture cost, so it
   is a candidate for *"annoying immediately after a reload"* — **complaint (b)** — and explicitly
   not for the slope.
3. **Longer than six minutes.** He says "a minute or two", and this run drove six and a half. But a
   +20% retained-heap slope (§6c) over 6.5 minutes is a slope with no measured ceiling; the honest
   statement is that nothing here rises fast enough to matter *at this length*, not that nothing
   would at forty minutes.
4. **His own Chrome.** Extensions, tab count, GPU-process pressure, and a profile that has been open
   for days. No instrument in this repo can reach any of it, and a reload does not fix most of it —
   which, by §1's own eliminator, argues against this and is recorded as an argument, not a
   dismissal.
5. **The four unmeasurable candidates.** `undoDepth` is the one with the right shape by inspection:
   it rises with every edit and dies with the document. B1331 measured it at 0.4 MB and found it
   innocent; nothing has re-measured it since, and it cannot be sampled from outside the app.

## 9. WHAT WOULD SETTLE IT

`ui-audit/session-growth.mjs` is portable: `BASE_URL=https://planyr.io npm run perf:growth`, signed
in, on one of his own plans, produces this same table on the machine that HAS the symptom, with the
reload arm intact. That run needs a browser with direct network access and a signed-in session — it
is not runnable from this sandbox. It is logged as the live verification on B1121.

**If that run also comes back with a flat or stepped cost curve, the honest conclusion is that the
symptom is not interaction-bound at all**, and the program should stop hunting an accumulation and
turn to the baseline cost — complaint (b), which nothing in this document addresses and which remains
entirely open.

## 10. THE RULE THIS DOCUMENT DID NOT BREAK

B1434's standing rule: **do not ship a fix against a signal you cannot explain.** The cost curve here
does not accumulate; the one candidate that does accumulate is small, uncorrelated with cost, and
would be an eviction shipped against a 3.4 MB slope that no gesture was shown to pay for. **No
product code was changed by this investigation, deliberately.** Four hypotheses have died in this
program (semi-transparency, pixel count, easements, the plan-switch leak) and the discipline of
recording refutations is why the surviving questions are sharp.
