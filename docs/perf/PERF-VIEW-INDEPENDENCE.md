# VIEW-INDEPENDENT WORK REDONE BECAUSE THE VIEW MOVED — the detector, the enumeration, the guard

**Written 2026-08-06.** The owner, verbatim:

> *"if that's the case, let's also test a couple other cases where that happens or could happen.
> because since you're saying it's the same bug, it's like, alright. Well, we didn't find it for
> this, so find it for all the other times. or all the other scenarios."*

He is right, and this document is the answer. The same defect had been found **twice, by accident**:

1. **#926 / B1440** — `f2p` was `worldToScreen(view, …)`, so every element's pixel geometry was a
   function of the live view and a pan re-derived every element. Fixing it took DOM mutation records
   per gesture from **101,267 to 2,194**.
2. **The pond label fit** — re-solved every frame, with the fit question asked in FEET, so during a
   pan (constant px-per-foot, constant ring, constant text) it recomputed an **identical** answer
   sixty times.

Finding the third by intuition is not a plan. So: **build a detector, run it, and report the
complete list.**

---

## 1. The instrument

`ui-audit/detect-view-recompute.mjs` (`npm run perf:recompute`).

**The method.** Drive a gesture that changes ONLY the view, on a plan whose model and settings are
frozen, and record every instrumented computation that executes: identity, call count, wall time,
and **a fingerprint of its INPUTS and of its RESULT**.

**Why the fingerprint has to be structural, which is the whole reason this class hid.** Every
instance of the bug returns a **fresh object holding an identical answer**. `Object.is` — which is
all React's memo does — reports "changed" on 100% of them, so a reference compare finds nothing,
forever. `ui-audit/lib/recomputeHash.mjs` is a bounded structural walk (cycle-safe, key-order
independent, React-internals aware) with its own unit tests.

**How the app is instrumented.** `scripts/vite-plugin-recompute-probe.mjs` is a Vite transform that
runs under `PLANYR_PROBE=1` and **only** then — `npm run build` produces a bundle in which none of
this exists. It rewrites two things:

- every `useMemo(factory, deps)` under `src/` — the deps become the recorded INPUTS, the return
  value the RESULT, and a **render that reached the site is counted separately from a factory that
  actually ran**, which is exactly the difference between "React re-rendered" and "the memo
  recomputed";
- every exported function of the pure-computation layer (`site-planner/lib/**`, `shared/**`) —
  because **half of this defect class is not in a memo at all**. The pond label fit, the second
  known instance, is a plain function called from the render body; no hook patch could ever see it.

On this build that is **1,744 instrumented sites — 68 memos and 1,676 exported functions.**

Two decisions worth recording:

- **Identity is assigned at transform time**, not recovered from a stack trace. The plugin is
  looking at the source, so `file:line:name` is a literal in the emitted code — exact, and free at
  runtime. (`ui-audit/lib/sourceMapIndex.mjs` does the decoding when the JSX transform has already
  moved the line numbers.)
- **The probe's own cost is subtracted, not just reported.** A wrapped function calls other wrapped
  functions, each fingerprinting inside the caller's timed region. Uncorrected, a parent's `ms` is
  its app time plus every descendant's hashing — which on the hottest paths here is the *larger* of
  the two. The first draft of this report was ranked that way and put `allStandardsImpact` at 728 ms;
  corrected, it is 22. **The instrument was measuring itself and would have set the whole fix order.**

**The four verdicts** (`ui-audit/lib/viewIndependence.mjs`, unit-tested):

| verdict | meaning |
|---|---|
| `once` | ran 0 or 1 times. ✅ the target state for anything model-derived. |
| `redundant` | ran N>1 times, same inputs, same answer. A **missing** memo. |
| `view-churned` | ran N>1 times, inputs moved, **answer did not**. A **mis-keyed** memo — a view term in the key the answer does not use. Both known instances are this. |
| `productive` | the answer genuinely moved with the view. **Not a violation** — the cull rect, the scale bar, the north arrow, the LOD gates. |

---

## 2. The four scenarios, because "all the other scenarios" was the ask

| gesture | the correct answer | what was found |
|---|---|---|
| **pan** (60 moves, constant ppf) | nothing model-derived may run twice | 175 violations, 502 ms of a 4.2 s gesture |
| **wheel zoom** | recomputed once per **ppf step**, not once per frame | 187 violations, 231 ms |
| **single-element edit** (drag one building) | only what depends on that element re-derives | **241 violations, 1,201 ms — the largest finding in the sweep** |
| **panel open/close** | nothing; the content is unchanged | 171 violations, 55 ms |

`#925` measured the panel axis at +34.4% of an identical gesture before the pan anchor and
INCONCLUSIVE after; this puts a number on what is actually being redone there.

**A note on the render count, which is the amplifier under all of it.** A 60-move pan produces
**186–187 renders** of `SitePlanner` — a little over three per pointermove. B1440 made the *emitted
geometry* stable so element memos bail, but the 13,700-line render body still runs, and everything
it calls un-memoised runs with it. That is why so many of the violations below are ordinary pure
library functions: they are not slow, they are called 186 times.

---

## 3. THE ENUMERATION — what was fixed this dispatch

Measured on the committed reference plan (Goose Creek "Plan 1 (copy)": 66 elements, 6 centreline
roads, 2 ponds, 976 canvas nodes), at two plan sizes.

| arm | violations | waste ms | gesture ms |
|---|---|---|---|
| pan ×1 | 175 → **151** | 501.8 → **339.9** | 4,231 → **3,496** |
| pan ×3 | 175 → **152** | 862.4 → **490.9** | 6,983 → **4,303** |
| zoom ×1 | 187 → **178** | 230.8 → **194.3** | 1,972 → **1,558** |
| zoom ×3 | 190 → **176** | 345.4 → **327.5** | 3,664 → **2,472** |
| edit ×1 | 241 → **238** | 1,201.3 → **1,111.5** | 4,446 → **4,236** |
| panel ×1 | 171 → **147** | 55.4 → **35.7** | 1,418 → **1,228** |
| panel ×3 | 171 → **149** | 97.1 → **65.9** | 2,073 → **1,610** |

**Pan waste is down 32% at the reference size and 43% at three times it** — the fixes get *better*
as the plan grows, which is the half of the ranking that matters.

### The sites eliminated, in the order they were ranked and fixed

| was | fix |
|---|---:|
| `roadNetwork.regionPathD` 561× · 36.9 ms | `roadRegionPaths` memo (`roadNet` + `f2p` + settings) |
| `standardsApply.allStandardsImpact` 187× · 21.7 ms | one `useMemo` on `stdApplyCount`, keyed model + settings |
| `standardsApply.applyAllStandards` 187× · 21.0 ms | (same memo — it is called underneath) |
| `standardsApply.applyTypeStandard` 2,992× · 9.1 ms | (same memo) |
| `sheetFurniture.screenFurniturePlates` 187× · 17.4 ms | `furnPlates` memo keyed on `view.ppf` **only** |
| `sheetFurniture.scaleBarPlate` 187× · 11.3 ms | (same memo) |
| `SitePlanner.drawElsZ` 60× · 14.1 ms | the cull-rect latch |
| `SitePlanner.drawEls` 60× · 8.2 ms | the cull-rect latch |
| `SitePlanner.drawParcels` / `drawMarkupsZ` | the cull-rect latch |
| `metesAndBounds.offsetPolyline` 2,256× · 7.3 ms | `WeakMap` identity cache |
| `metesAndBounds.bufferPolyline` 1,128× · 10.6 ms | `WeakMap` identity cache |
| `shared/markup/textWrap.canvasWidth` 1,122× · 11.8 ms | bounded (text × font) cache — `measureText` lays a run out |
| `planStyle.byZ` 15,600× · `zOrder` 38,880× | downstream of the cull latch |
| `viewCull.elementBounds` 4,200× · `boundsIntersect` 4,200× | downstream of the cull latch |
| `userPrefs.getStandardPref` 2,057× + 5 more standards leaves | downstream of the standards memo |

**Twenty-four sites removed from the pan report.**

### The mechanisms, and why each is the right one

**(a) The cull rect is LATCHED, not re-derived** (`lib/viewCull.js` `cullRectFor`). It was a
continuous function of `view`, so it returned four different numbers every frame, `cullToView`
re-filtered the whole model, and on any pan inside the 60% margin the result was *the same set of
elements in a brand-new array* — and the fresh identity then missed every memo downstream.

The first attempt is worth recording because it was **measured and was not good enough**: snapping
each edge outward to a lattice took the recompute count from 60 to **19**. A step function still
steps, and a gesture that oscillates re-crosses the same boundary. What holds is a latch — keep the
rect you have while the true viewport is *proven* inside it. **That containment test is what makes
it safe:** the rect handed to `cullToView` is always a superset of what is on screen, so it can draw
more than necessary and can never drop something visible. It re-arms on a far enough pan and always
on a zoom.

**(b) A view-derived value keys on the SCALAR it uses.** `furnPlates` is genuinely a function of
px-per-foot — so it is keyed on `view.ppf`, not on `view`. It now recomputes once per zoom step and
never during a pan. This is the shape the rule asks for.

**(c) Pure library leaves get a cache, because they have no hook to hang a memo on**
(`lib/pureCache.js`). Two kinds: a **signature** cache where the key is cheap to build relative to
the work (the road tessellator — O(control points) against a tessellation producing hundreds of dense
points), and a **`WeakMap` identity** cache where the input is a large array that is rebuilt rather
than mutated (the polyline buffers, taken of centrelines that are themselves now cached). The
precondition — the keyed object is treated as immutable — is stated in the module header, because
getting it wrong is a *wrong answer*, not a slow one.

---

## 4. THE ENUMERATION — what is still open, with the reason

### 4a. `labelLayout.layoutLabels` — 372× · **88.6 ms · 0.71 ms per element** — the top remaining item

Three times the next item, and the only one that dominates its arm. It is the greedy collision +
level-of-detail label pass, called twice per render (measurement chips, then element labels), so a
60-move pan runs it 372 times for **three distinct answers**.

**Not fixed here, deliberately, and the reason is a collision not a difficulty.** `session_01GZsWkUHMKJphkhNJNwzGHM`
is live on this repo right now inside `labelLayout.js` / `labelFitLadder.js` shipping the pond
label-fit fix — the second known instance of this very class. Two sessions editing the same fit
engine in the same hour produces a merge conflict in the most delicate geometry in the app. **Filed,
ranked first, and left for the session that owns those files.** The mechanism is known: a signature
memo over the item list, with `ring` identity handled carefully.

Its dependants inherit the same fate this dispatch: `labelFitLadder.labelForms` (5,208× · 13.6 ms)
and `inlineLines` (2,604× · 8.9 ms).

### 4b. The EDIT arm — 1,111 ms, and it is a different and larger bug than the pan

The single-element drag is the biggest number in the whole sweep, and what it is spending it on is
not label layout:

| site | calls | ms |
|---|---:|---:|
| `siteModel.createSiteModel` | 80 | 160.8 |
| `siteModel.normalizeBondedChildren` | 80 | 140.6 |
| `storage.loadSite` | 40 | 99.4 |
| `storage.saveSite` (**view-churned**) | 20 | 89.7 |
| `siteModel.migrate` | 40 | 86.0 |
| `roadNetwork.clipPolylineOutside` | 400 | 63.5 |
| `roadNetwork.dissolveRings` | 60 | 46.0 |
| `siteModel.normalizeHostRuns` | 80 | 39.2 |
| `storage.snapshotVersion` (**view-churned**) | 20 | 36.6 |

**Dragging one building re-migrates and re-serialises the entire plan dozens of times.** That is the
memo-invalidation question this program has asked twice and never measured, and now it has a number:
roughly **660 ms of a 4.2-second single-element drag** is the persistence and model-normalisation
layer running on a loop, not the renderer. It is a **different class** from the one this dispatch was
opened for — it is not the view moving, it is one edit invalidating everything — so it is filed on
its own item rather than folded in here. It is the largest single perf finding on the board.

### 4c. The tail

Below the two above, the pan report has **63 violations worth ≥1 ms and an 88-item tail worth
0.4 ms between them.** The tail is *reported*, never silently truncated (`--min-ms 0` prints it).
Fixing further into it would mean putting a cache on functions costing microseconds each, and the
honest statement is that **the remainder below ~5 ms per gesture is inside the noise floor of this
instrument** — the probe's own overhead on the same gesture is 1.2 s.

---

## 5. THE INVERSE CHECK — over-memoisation, reported and not "fixed"

Asked for explicitly, and it found one.

Under a **zoom**, `renderView` and `labelFrame` both move — correct, they are genuinely view-derived.
But **`cursorLL` is frozen through the whole zoom**: it is memoised on `[cursor, origin]`, and
`cursor` is only written by a pointer *move*. Wheel-zoom with the mouse still and the same screen
point now sits over a different place in the world, but the coordinate readout keeps reporting the
pre-zoom lat/lng until you jiggle the mouse.

This is a **correctness** finding, not a performance one, and its fix is the opposite edit (recompute
`cursor` from the last screen position when `ppf` changes). Filed on its own item; not fixed here,
because it touches the pointer path and this dispatch had no business in it.

`cullRect` is deliberately no longer in the view-derived list: as of this dispatch it is a latched
ref rather than a memo, so there is no memo site to observe. Its view-derivedness is asserted
instead by `test/panAnchor.test.js` (it reads the LIVE view, never the anchor) and by
`test/pureCache.test.js` (it re-arms on a zoom and on a far enough pan, and always contains the true
visible rect).

---

## 6. The standing guard — why it counts instead of looking

`ui-audit/verify-view-independent.mjs` (`npm run perf:viewindep`).

#926 said it plainly and it is the whole reason this needs a counter:

> *"a pan that silently goes back to baking the view is invisible to every screenshot and
> behavioural test in this repo; only a frame counter would notice."*

Both known instances **draw the identical picture when broken**. A pixel diff, a DOM assertion, an
e2e click path and the PERCEPTUAL-PARITY harness all pass on the defect. So the guard drives a real
pure pan on the reference plan through the instrumented build and **fails if any computation in its
registry ran more than once**.

Two properties that make it a guard rather than a note:

- **A registered computation that was never OBSERVED is a FAILURE, not a pass.** That is precisely
  how a guard of this shape rots: the memo is renamed, the probe records nothing, and a guard that
  only checks what it happens to see reports green forever.
- **Mutation-proven.** Disabling the cull latch takes it from ✅ to four failures at **186 calls
  each**. It has been red and it has been green, on the real code.

**The CI half.** This repo's required `build` check runs `npm test` and `npm run build`; a browser
gate cannot live there without becoming an outage risk. So the counter is a `npm run` gate, and
`test/viewIndependentRegistry.test.js` is the always-on companion: every registered memo still
exists, and **no registered memo's dep array carries a raw view term** — the exact one-line edit that
reintroduces the class. It is deliberately weaker than the counter (it cannot see a computation with
no memo at all, which was half of what the detector found), and says so.

The rule itself is **VIEW-INDEPENDENT-ONCE** in `/CLAUDE.md`.
