# "I JUST ADDED A DETENTION POND, AND NOW IT'S RUNNING SUPER SLOW AGAIN"

**NEW-1 / NEW-2 of the speed program's phase 5, 2026-08-06.** The owner, verbatim:

> *"I definitely noticed a massive improvement in speed on the Bain site. I just added a detention
> pond, and now it's running super slow again. like, doing all the lagging and whatnot. So why
> don't you analyze that?"*

Instrument: `ui-audit/diagnose-pond-pan.mjs` (driver) + `ui-audit/lib/pondPan.mjs` (the pure
estimator, floor and verdict rules) + `test/pondPan.test.js` (29 unit tests on the pure half).

---

## 0. THE REGIME, stated first because it bounds everything below

| | |
|---|---|
| CPU | **1×, not throttled** — his complaint is at 1× |
| display | **dpr 2** (retina) |
| tiles | **`--fake-tiles`** — a real, decodable, per-tile-unique PNG, so decode and texture upload are real work |
| machine | **4 cores.** His has 28. |
| network | GIS and Supabase are **ABSENT, not slow** |
| session | **logged out** |
| panel | **Yield docked** — measuring a pond with every panel closed measures it somewhere he never works |
| zoom | stated per run; the pond contour gate is a ZOOM gate, so this is a real variable and never hidden |

**Cost metric:** main-thread work per gesture — `ScriptDuration + LayoutDuration +
RecalcStyleDuration`, differenced from the renderer's own cumulative counters at microsecond
resolution. Not a frame median: B1432's ±99.8% floor was 16.7 ms display-clock quantisation *in the
metric*, which no number of repeats could ever clear.

**The probe is PAN ONLY, deliberately.** B1440's pan anchor is the thing he felt, and a wheel burst
re-bakes that anchor by construction — folding zoom in would blend the fixed gesture with the one
that defeats the fix being tested.

---

## 1. WHICH PLAN — and the Bain fixture question, answered

The item said to use the Bain plan if it can be opened, and to fix its fixture if it has the
elements-only defect B1448 found in Sylvestri's.

**There is no Bain plan fixture, of any kind, to fix.** `ui-audit/fixtures/` holds Goose Creek,
Sylvestri, Tsakiris and Weld — no Bain. What exists is `test/fixtures/gooseCreekPonds.json`, which
carries **four Bain / Concept A pond RINGS** (bare `{id, points}` geometry, no elements, no parcels,
no settings, no origin), used by `test/pondLabelFit.test.js` as a bag of shapes. It is not a
truncated plan that could be repaired — it is a geometry sample that was never a plan, and there is
nothing in the repo to reconstruct one from. **Fabricating a "Bain plan" would be inventing the
owner's site, not fixing a fixture**, so it was not done. Getting a real one is a one-line export
from a signed-in session and is on `OWNER-TODO.md`.

The Bain rings ARE used where they can be: `test/labelFitMemo.test.js` drives the fix below against
two of them.

So the measurement plan is **`goose-creek-plan1copy.json`** — his own Goose Creek plan pulled from
production, 62 elements, 6 parcels, 6 centreline roads with arc vertices, its real 30-key settings.
A **FLOOR** on Bain, not a match.

**One confound had to be removed first, and it would have produced a confident wrong answer.** The
reference plan **already contains two ponds**, so drawing one on it measures the THIRD — a marginal
pond on a plan whose stormwater ledger, pond verdict rows and drainage facts pass are already
running. His report is about a pond arriving on a plan. `perfScenarioSite({ ponds: false })` removes
them (and anything bonded to one — measured: nothing is), so the `0 → 1` transition can be measured
as itself. Every run states which transition it measured.

---

## 2. TWO INSTRUMENT CORRECTIONS, before any number

### 2a. The arms are ROUND-ROBINED, not run as blocks

The first version ran each arm's pairs contiguously, null arm first. Its null pairs came back
**[+3.0, −29.3, −1.9, −5.5] %**; the pond arm's — measured minutes later, after the machine had
settled — came back **[−0.1, +1.6, +2.3, −2.0] %**. That is not two effects. It is one effect
(early-run drift) landing entirely on whichever arm ran first, and it pushed the stated floor to
**±29.3%** — wide enough to swallow any answer the instrument could give. Honest, and useless.
Round-robining spreads every arm's pairs across the whole session; the floor fell to **±1.6–4%**.

### 2b. The seeded ladder needs a FRESH BROWSER CONTEXT per rung, and the rung assertion is what found that out

Seeding rung N's plan into `localStorage` and reloading **does not work and fails silently**: the
write lands (verified — the store held 8 ponds), and after the reload the plan is back to 2, because
the planner flushes its live in-memory model on unload and that flush wins. Clearing IndexedDB and
localStorage first does not help, for the same reason.

Every rung reported the same **1,203 canvas nodes and the same 8 contour rings** while claiming 0, 2,
4 and 8 ponds — and its perfectly plausible work numbers would have joined a trend line describing
one scene four times. The rung assertion (`elementsDrawn` minus the pond-free element count must
equal the rung) **suppressed them instead of reporting them**, which is `rungEffectFault`'s rule from
`session-axes.mjs` applied to a seed rather than a click. A fresh context per rung is the fix.

---

## 3. THE LEADING HYPOTHESIS, KILLED — with the named mechanism that kills it

The item's leading hypothesis, stated as a hypothesis to kill: *if `pondContours` is still derived
inside the render body without a memo keyed on pond geometry + settings, then the pond is the one
thing on the canvas that did not get B1440's benefit, and every frame re-runs a Clipper-heavy
contour pass.*

**REFUTED, three independent ways:**

1. **`pondContours` has had an LRU memo since B1345's NEW-4(e)** (`lib/pondGeom.js:110–171`), keyed
   on depth · freeboard · slope · interval · top-of-bank elevation · vertex count · first vertex ·
   area. Its own header names the cost it exists to avoid: *"roughly 38 clipper runs per pond, per
   render."* So do `detentionStorage` (`_detMemo`), `bandedStorage` (`_bandMemo`),
   `excavationVolume` (`_excMemo`), `pondFloodFacts` (`_pondFactsMemo`) and the mitigation pass
   (`_mitMemo`). This subsystem is already thoroughly memoised.
2. **`pondContourEls` is inside `ElNode`**, which is `React.memo` (B1352) and whose props are all
   identity-stable through a pan since B1440 pinned `f2p` at the anchor. The element pass does not
   re-run at all during a pan.
3. **Clipper never appears in the profile.** Across a 40-step pan gesture with 16 ponds on the plan,
   "Geometry vendor (Clipper)" is absent from the phase table entirely and no pond-geometry function
   appears in the top 18 by self time. "Site geometry (roads · ponds · contours)" is **1.4%**.

---

## 4. THE PAIRED RESULT — one pond, at working zoom, with the Yield panel open

5 pairs, 5 probes per cost, round-robined, `0 → 1` transition, ppf 0.35:

| arm | pairs | before | after | delta | verdict |
|---|---:|---:|---:|---:|---|
| **one detention pond** | 5 | 502.3 ms | 520.3 ms | **+3.6%** | INCONCLUSIVE |
| one BUILDING of the same footprint (control) | 5 | 489.5 ms | 521.2 ms | +2.3% | INCONCLUSIVE |
| null (nothing added) | 5 | — | — | — | **floor ±3.97%** |

> ### One pond does not make the pan measurably slower. The effect is under ±4%, and a building of the same footprint costs the same.

What the pond actually put on the canvas: **+1 element, +12 canvas nodes, 4 contour rings**, and
**React commits per gesture unchanged at 127**. A building adds **+57 nodes** — nearly five times as
many — for the same cost. So this is not a node-count story.

### The zoom sweep — because the contour gate IS a zoom gate

| ppf | before | after | delta | contour rings | nodes added |
|---|---:|---:|---:|---:|---:|
| 0.10 | 493.7 | 481.6 | −2.4% | **0** | 7 |
| 0.25 | 569.8 | 547.9 | −3.9% | 3 | 10 |
| 0.50 | 530.2 | 561.9 | +6.0% | 4 | 12 |
| 1.00 | 488.6 | 517.4 | +5.9% | 10 | 14 |
| 2.00 | 480.3 | 481.6 | +0.3% | 15 | 15 |
| 4.00 | 471.6 | 504.0 | +6.9% | 19 | 13 |

Contour rings rise 0 → 19 across the sweep (below ppf 0.18 a pond draws **no** contours at all, so
probing only at the landing zoom would have "proved" a pond is free), and the cost delta stays
between −4% and +7% throughout. **No zoom makes one pond expensive.**

### And the app goes SILENT afterwards

12 seconds of nothing touched, straight after the add:

| added | script | layout | style | React commits | DOM mutations | long tasks |
|---|---:|---:|---:|---:|---:|---:|
| nothing | 26.7 ms | 0 | 0 | 1 | 0 | 0 |
| a building | 25.1 ms | 0 | 0 | 0 | 0 | 0 |
| **a pond** | **25.6 ms** | 0 | 0 | 1 | 0 | 0 |

(The MutationObserver reports whether it installed — B1448's recorded instrument bug is exactly
this, and a broken observer reads precisely like a quiet app.) **Adding a pond starts nothing that
keeps running.**

---

## 5. THE LADDER — where the per-pond cost finally shows itself

One pond's cost is a fraction of a per-cent of a gesture and cannot clear any honest floor. The
question "is there a per-pond cost at all" is only answerable with leverage, so the plan is **SEEDED
with N copies of the fixture's own real pond**, reloaded in a fresh context per rung, three
interleaved sweeps:

| ponds | work/gesture | vs 0 ponds | canvas nodes | contour rings | commits |
|---:|---:|---:|---:|---:|---:|
| 0 | 538.3 ms | 0% | 1,180 | 0 | 126 |
| 2 | 507.8 ms | −5.7% | 1,197 | 8 | 127 |
| 4 | 587.9 ms | +9.2% | 1,219 | 16 | 126 |
| 8 | 666.3 ms | +23.8% | 1,268 | 32 | 127 |
| **16** | **702.4 ms** | **+30.5%** | 1,356 | 64 | 127 |

**≈ 10.3 ms of main-thread work per gesture, per pond** (rung-0 spread ±7.8%; the last two rungs both
clear it, which is `axisCost`'s own "a trend, not an endpoint" rule).

**Canvas nodes rise only 1,180 → 1,356 across the whole ladder and React commits are flat.** So the
per-pond cost is neither DOM nor reconciliation. It is script.

---

## 6. WHAT IT IS — attributed, with UNATTRIBUTED at 0.0%

CPU profile of the identical pan at 0 ponds and at 16, source-map resolved, first match wins:

| moved | 0 ponds → 16 ponds | phase |
|---:|---|---|
| **+76.7 ms** | 16.7 → **93.4 ms** | **Label layout & collision** |
| +87.0 ms | 450.9 → 537.9 ms | V8 (program) — parse / compile / VM |
| +79.1 ms | 214.9 → 294.0 ms | Planner render body (`SitePlanner.jsx`) |
| +61.0 ms | 242.1 → 303.1 ms | React render & commit |
| +12.0 ms | 17.9 → 29.7 ms | Site geometry (roads · ponds · contours) |
| **0.0** | | **UNATTRIBUTED — 0.0%**, holding B1448's standard |

And the hottest **application** function in the 16-pond profile, by self time:

```
52.98 ms   2.43%   P — src/workspaces/site-planner/lib/labelFitLadder.js
14.93 ms   0.68%   G5 — src/workspaces/site-planner/lib/labelLayout.js
 7.48 ms   0.34%   (anonymous) — src/workspaces/site-planner/lib/labelFitLadder.js
```

> ### It is the POND LABEL's fit search, re-solved on every frame of every pan.

**Why a pond and nothing else.** `SitePlanner.jsx` hands `layoutLabels` a `ring` / `ringOrigin` /
`ringPpf` for polygon elements and marks **`mustLabel: true` for ponds only**. Those two flags are
the entire fast/slow switch:

- `ring` routes the label through `interiorFitter`, which rasterises the polygon at 96 cells across
  its long axis and enumerates every maximal inscribed rectangle — thousands of them — so "does it
  fit" is answered against the room that exists rather than a bounding box that overstates it. The
  raster is cached per ring (a WeakMap); **the SCAN over those rectangles was not.**
- The ladder tries up to nine candidate label forms per pond (inline → stacked → abbrev, each at
  successive drop levels), and each one was a fresh scan.
- `mustLabel` adds a terminal walk of up to 5 steps × 4 directions that may never give up.

**And none of it depends on the pan.** `spots()` is asked in FEET — `layoutLabels` divides the screen
size by `ppf` before calling — and a pan is a pure translation at constant scale (B1440), so the
ring, the `ppf`, the label's lines and its type metrics are all bit-for-bit identical frame to
frame. Every frame re-asked an identical question and got an identical answer. Only the screen
ORIGIN moved, and the caller applies that with one multiply-add after the answer comes back.

---

## 7. THE FIX, and the same probe after it

Two changes in `lib/labelFitLadder.js`, both **byte-identical by construction** — same pure
function, same arguments, same outputs, moved from *once per frame* to *once per distinct question*.
No threshold, no approximation, no level-of-detail decision. This is the justification B1352 shipped
the neighbour record on and B1437 shipped the dock plan on.

1. **`spots(w, h, want)` is memoised** on a bounded LRU inside the fitter. The cache's lifetime is
   the fitter's, which is the ring's — `fitterCache` is a WeakMap keyed on the ring array, so an
   edited pond arrives as a NEW array, gets a new fitter, and the old cache goes with it. **It can
   never serve a stale interior**, which is the failure that would matter: a label placed against
   the wrong interior is a wrong drawing, and a wrong drawing is worse than a slow one.
2. **An early-out**: no rectangle can be wider than `maxW` or taller than `maxH`, so a request past
   either bound was already guaranteed to scan everything and return nothing. Returning nothing
   immediately is the identical answer, and it turns the WORST case — a label that fits nowhere,
   which is exactly the case the outside rung exists for — from a full scan into a comparison.

**The same ladder, the same probe, after the fix:**

| ponds | before the fix | after the fix |
|---:|---:|---:|
| 0 | 538.3 ms · 0% | 560.7 ms · 0% |
| 2 | 507.8 ms · −5.7% | 592.6 ms · +5.7% |
| 4 | 587.9 ms · +9.2% | 588.7 ms · +5.0% |
| 8 | 666.3 ms · +23.8% | 573.3 ms · +2.2% |
| **16** | **702.4 ms · +30.5%** | **639.8 ms · +14.1%** |
| **per pond** | **10.26 ms/gesture** | **4.94 ms/gesture** |

> ### The per-pond cost of a pan is roughly HALVED, and the 16-pond penalty falls from +30.5% to +14.1%.

Re-profiled, the phase it was aimed at moves exactly as predicted:

| | 0 → 16 ponds, before | 0 → 16 ponds, after |
|---|---:|---:|
| **Label layout & collision** | 16.7 → 93.4 ms (**+76.7**) | 16.4 → 36.4 ms (**+20.0**) |

**−74% of the label-layout half of the per-pond cost.** `labelFitLadder` is no longer the hottest
application function in the profile.

**Guards.** `test/labelFitMemo.test.js` — 8 tests, mutation-checked two ways (dropping `want` from
the cache key → red; an off-by-one early-out → red). The headline test drives every ring in a
hostile battery — including **the owner's own Goose Creek pair and two of the four Bain / Concept A
basins** — through several hundred size questions and asserts the memoised answer is **position for
position, order for order, count for count** what a fresh un-memoised fitter returns. Plus an
end-to-end test that a panned frame places the label at exactly the panned offset, on the same rung,
saying the same words. `test/labelFitLadder.test.js` and `test/pondLabelFit.test.js` (the suites that
own the *behaviour* — a fit failure may never blank a label) are unchanged and green.

**No pixel argument is needed and none is made.** The output is identical, so PERCEPTUAL-PARITY has
nothing to measure; saying "byte-identical" is the stronger claim and it is the true one.

---

## 8. WHAT IS LEFT, NAMED — and why it is not fixed here

After the fix the largest remaining mover between 0 and 16 ponds is **the planner's own render body,
+92.6 ms**. It has a specific, read-not-guessed cause:

**`pondLedgerEntries` is built in the render body, once per render, per pond** —
`SitePlanner.jsx:10533–10566`. For every pond it calls `ringOf` (×3), `incrementalExcavationCf`,
`pondSplitFor` (→ `usablePondVolume` → `bandedStorage`), `detentionStorage`, `detWithAuto` and
`pondDisplayNameFor`. **Not one of them takes the view**, and the loop runs ~127 times per pan
gesture. It is the same class of waste B1352 and B1437 removed for curbs and dock plans.

It is **not** fixed in this dispatch, and the reason is the repo's own strongest rule rather than
time. The heavy geometry underneath is already memoised, so what is left is signature-building and
allocation — and hoisting it means a `useMemo` over **twelve** inputs (`els`, `pondAuto`, `fmZones`,
`fmRule`, `fmElev`, `fmZonesSig`, `drainDetSplitRec`, `drainIsRestored`, `drainCtxData`, `detRegime`,
`coincidentStorm`, `pondBermById`). A hand-maintained dependency list that misses one is a **stale
engineering ledger** — a wrong detention volume presented as current — and this file's own B1352
note says it plainly: *"a hand-maintained dependency list that misses one is a STALE HANDLER … far
worse than a slow render."* Done properly it needs the B1352 treatment (a resolved record whose
identity IS the evidence), which is its own item with its own guards.

---

## 9. THE HONEST LIMIT

The owner's symptom — *"super slow, doing all the lagging"* — **is not reproduced in this sandbox by
adding one pond.** A ~4% paired effect at one pond is not lag; the ladder proves the cost is real and
per-pond, but it takes eight to sixteen ponds on a 62-element plan to become a third of a gesture.

What is missing from his regime, in the order worth betting on it: **his real Bain plan** (larger
than 62 elements, and with more and larger basins) · **signed in**, which turns on the element-sync
seed and the Supabase fetch that never fire here · **live GIS**, so `fmZones` is non-empty and
`pondSplitFor` takes its flood branch — the branch this sandbox can never enter, and the one that
makes every pond's ledger entry dearer · his saved layer set · 28 cores against 4.

**Every number here is a floor.** The instrument is built and the protocol is fixed; pointing it at a
signed-in session on the Bain plan with `BASE_URL` is the measurement that would close the gap, and
that is a live-verify item, not a sandbox one.
