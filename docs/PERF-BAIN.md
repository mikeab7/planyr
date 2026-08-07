# BAIN, MEASURED — and what every previous number was measured on instead

**Written 2026-08-06, at the owner's explicit request.** His words: *"have you been driving the Bain
site that I was telling you about… I'm not saying it was the pond. I'm just saying that BAIN WAS SLOW.
So have you decided to test that? And if not, shouldn't you be testing it in the browser?"*

He was right, and the answer to the second question was no.

---

> ## ⛔ SUPERSEDED IN PART, 2026-08-07 — READ THIS BEFORE QUOTING ANY NUMBER BELOW
>
> **Every figure in this document was measured on `bain-concept-a.json`, whose element counts were the
> owner's and whose COORDINATES WERE INVENTED.** §6 said so, and was right to. The real plan has since
> been pulled from `public.sites` JOINED to `public.site_elements` and committed as
> `ui-audit/fixtures/bain-concept-original.json`; the synthesised fixture and its generator are DELETED.
>
> **What that changed, in one line each — the full account is `docs/PERF-REAL-PLANS.md`:**
>
> - The plan is **47 elements, not 53**, in a different mix. Six elements measured here do not exist.
> - **The sheet overlay is rotated 1.5°.** The synthesis said 0, so **every arm in this document
>   composited it AXIS-ALIGNED** — all six arms, both batteries, sixty runs. A rotated raster cannot
>   take an axis-aligned fast path, so that is an untested term in findings 1–3.
> - **§8 is wrong about the underlay.** It is `fromMap` with a live ArcGIS `export` URL and no `idbKey`
>   — **fetched, not read out of IndexedDB.** §7 (it is never *painted*) is unaffected and stands.
> - **§10's lead is confirmed as a fact rather than a suspicion:** the overlay really is page 1 of a
>   PDF, so B749's up-to-8192 px zoom re-raster is genuinely gated on. It still has never run in an arm.
 - **§7.3's 304-layer question is ANSWERED, and the answer is that the count was never about the plan:
>   `layers = leafletTiles + 4`, exactly, on all three real plans and in every arm of both batteries.**
>   Bain has the fewest elements of the three and the most layers; Sylvestri has more than twice Bain's
>   elements and 118 fewer. See `docs/PERF-REAL-PLANS.md` §3.
> - **Two measured results the arms below did not contain**, both at 6/6 paired reps, p = 0.031:
>   removing the overlay's **rotation** is −10.2% render (−12.6% raster), and removing Sylvestri's
>   **annotations** is −12.6% render.
>
> **What is NOT superseded:** findings 1, 2 and 5 rest on BETWEEN-ARM comparisons in which the geometry
> was held identical across every arm, so the synthesis is common-mode and cancels. Semi-transparency is
> still not the mechanism; pixel count is still not the mechanism; main-thread work still cannot tell the
> two plans apart. The numbers below are kept verbatim rather than restated against the real plan,
> because a measurement is a historical fact about what was run, and quietly editing one is how a report
> stops being evidence.
>
> ⛔ **ONE CLAUSE IS WITHDRAWN OUTRIGHT.** Finding 4 reads *"roughly half is Bain's own scene: 1,035
> canvas nodes against 884, and 304 compositor layers against 118."* **The layer count does not belong
> in that sentence** — it is a basemap-tile-retention difference that would be there with an empty plan.
> The node count stands. The composite and layerize gaps it was offered as an explanation for are real
> and are once again unexplained.

---

## 0. The admission this document exists to make

Every performance number this program has produced came from **Goose Creek**, or from a scene derived
from it. That includes every null result — every *"flat across 3,000 gestures"*, every *"the
compositor hypothesis comes back clean"*, every *"inside the noise floor."*

The owner has reported **two other sites** as slow: Bain and Sylvestri. The harness could open
**neither**. B1448 recorded the reason honestly for Sylvestri — *"there is no plan fixture of any kind
to repair, only… a subset that cannot be opened as a plan at all"* — and then measured Goose Creek
anyway, calling it a floor.

So the instrument has been measuring the one site it CAN open while the owner reports on two it
cannot. That is not a floor. A floor is a number you know is too low; this was a number about a
different building.

**And the difference is not a matter of degree.** Goose Creek has **no raster overlay of any kind**.
Bain composites a **1728 × 2592** reference drawing at **55% opacity** over the plan. A plan with no
raster cannot show a raster cost, at any sample size, under any statistic. Every prior null result on
this axis was structurally guaranteed.

---

## 1. What Bain is, next to what we measured

Measured from the owner's live signed-in browser (site `smr9olizi5ue`, "Concept A") against the
reference plan (`goose-creek-plan1copy.json`), and against the two as the harness actually loads them.

| axis | **Bain — Concept A** | **Goose Creek — Plan 1 (copy)** |
|---|---|---|
| elements | **53** | 62 (66 drawn, incl. derived) |
| element mix | building 12 · sidewalk 12 · parking 12 · road 8 · paving 6 · trailer 2 · **pond 1** | building 20 · paving 10 · parking 10 · trailer 8 · sidewalk 6 · road 6 · **pond 2** |
| parcels | **5** | 6 |
| centreline roads (arc geometry) | 8 | 6 |
| markups / measures / callouts / cross-sections | 0 / 0 / 0 / 0 | 0 / 0 / 0 / 0 |
| layers on at open | 0 | 0 |
| **raster overlays** | **2** | **0** |
| — sheet overlay | **1728 × 2592 = 4.48 MP, opacity 0.55**, locked, page 1, ftPerPx 2.7778 | — |
| — aerial underlay | **1800 × 1167 = 2.10 MP**, opacity 1.0, `fromMap` | — |
| raster bytes in IndexedDB (base64 strings) | **~10,188 KB + ~384 KB** | — |
| **canvas nodes (SVG elements)** | **1,035** | **884** |
| **compositor layers** | **304** | **118** |
| decoded raster texture, painted | **17.1 MB** | **0 MB** |
| basemap tiles served in one session | 732 | 246 |

The last three rows are counts, not timings. They need no statistics and no noise floor: they are the
same in every run.

---

## 2. What was done about it

Three things, and the second is the one that matters beyond this week.

1. **A Bain fixture that CONTAINS THE SUSPECT** — `ui-audit/fixtures/bain-concept-a.json`. Its element
   counts, parcel count, and **both rasters' dimensions, opacities, `ftPerPx` and IndexedDB-string
   storage path** are the owner's measured facts, reproduced exactly. Its *coordinates* are
   synthesised, and that limitation is stated everywhere it matters (see §6).
2. **A path from any plan he works in to a fixture the harness can drive** — `scripts/extract-plan.mjs`
   and `ui-audit/lib/planFixture.mjs`. This is the actual fix for the miss. One paste in his browser
   turns Bain, Sylvestri or anything else into a measurable fixture, with its rasters, and **without
   taking a single pixel of his survey drawings**.
3. **An instrument for the half of the cost this program was blind to** — `ui-audit/lib/rasterCost.mjs`.

### 2a. The blind spot, because it explains how this was missable

Every cost metric in this program is the un-quantised work figure:

```
ScriptDuration + LayoutDuration + RecalcStyleDuration
```

Look at what those are. **Script. Layout. Style.** All three are main-thread work that happens
*before a pixel exists*. None of them can see paint, raster, image decode, texture upload or
compositing — and a large translucent backdrop costs almost nothing in script, layout or style. It
costs *blending*, and blending was invisible to the only cost metric the program owned.

The new instrument reads Chromium's own trace events, buckets them by name, and reports paint /
raster / decode / composite / layerize in milliseconds across the same viewport-neutral pan gesture
every other probe here uses.

---

## 3. The arms

Six, interleaved, each changing exactly one thing. Regime: **1× CPU** (his complaint is at 1× on a
28-core machine), **dpr 2.15** (his measured display), **`--fake-tiles`** so aerial decode and texture
upload are real work rather than blocked requests.

| arm | what it changes |
|---|---|
| `bain` | nothing — both rasters exactly as he has them (the baseline) |
| `opaque` | overlay forced to **opacity 1.0**. Same pixels, same footprint → isolates **BLENDING** |
| `no-overlay` | the 4.5 MP semi-transparent overlay **hidden** → removes it entirely |
| `quarter` | both rasters at **¼ the pixels, same on-map footprint** → isolates **SIZE** |
| `no-rasters` | both hidden → isolates **Bain's own geometry** |
| `goose` | the Goose Creek control — the plan every prior number came from |

`quarter` holding the footprint constant is not a detail: an arm that also shrank the picture would
isolate nothing, and would "prove" a size effect that was really a coverage effect. The invariant is
unit-tested.

### ⛔ The guard that makes any of this mean anything

**An arm whose raster never decoded looks exactly like an arm that is fast.**

The first run of this harness wrote **nothing** to IndexedDB. Playwright evaluates a string as an
*expression* and does not call it with the argument, unlike Puppeteer — so the write silently returned
`undefined` and every arm ran with no rasters at all. It would have reported a beautiful, entirely
false null result.

`decodeFault` refuses to report any arm until every raster the app is expected to paint has resolved
`decode()` at intrinsic dimensions **read out of the element's own bytes** (an `<image>` inside an
`<svg>` is an `SVGImageElement` and has **no `naturalWidth`** — the obvious check does not exist).

---

## 4. Results

**Two independent batteries, 4 reps and 6 reps, 60 runs, 0 suppressed.** Arms interleaved. Medians
pooled across both; the paired sign test pairs rep-for-rep **within** a battery.

### Pooled medians, per pan gesture (ms)

| arm | render total | raster | paint | composite | layerize | main-thread work | heap | frame median |
|---|---|---|---|---|---|---|---|---|
| `bain` | **2772** | 2111 | 213 | 283 | 170 | 795 | 67 MB | 50.0 |
| `opaque` (no alpha) | 2640 | 1988 | 221 | 268 | 160 | 807 | 66 MB | 66.6 |
| `no-overlay` | 2308 | 1625 | 218 | 288 | 162 | 777 | 60 MB | 62.4 |
| `quarter` (¼ pixels) | 2613 | 1972 | 217 | 265 | 155 | 753 | 33 MB | 50.0 |
| `no-rasters` | 2184 | 1544 | 203 | 285 | 150 | 779 | 60 MB | 50.0 |
| **`goose`** | **1661** | 1299 | 162 | **124** | **83** | 790 | 26 MB | 49.9 |

Raster totals exceed wall-clock because raster tasks run in parallel across worker threads; they are
comparable between arms, not readable as elapsed time.

### The comparisons that separate

Sign test at p ≤ 0.05, over 10 paired reps. Anything not listed did not separate.

| comparison | metric | result |
|---|---|---|
| **Bain vs Goose Creek** | render | **CHEAPER in 9/10, median −40%** (p = 0.021) |
| | composite | **CHEAPER in 10/10, median −56.9%** (p = 0.002) |
| | layerize | **CHEAPER in 10/10, median −51.5%** (p = 0.002) |
| | paint | CHEAPER in 9/10, median −25.6% (p = 0.021) |
| | **main-thread work** | **NOT SEPARATED — 5/10, p = 1.000** |
| **Bain's geometry alone (`no-rasters`) vs Goose Creek** | render | **CHEAPER in 9/10, median −20.9%** (p = 0.021) |
| | composite | **CHEAPER in 10/10, median −55.6%** (p = 0.002) |
| | layerize | **CHEAPER in 10/10, median −46.4%** (p = 0.002) |
| **Overlay removed vs Bain** | raster | **CHEAPER in 9/10, median −24.3%** (p = 0.021) |
| **¼ the pixels, same footprint, vs Bain** | raster | CHEAPER in 9/10, median **−6.3%** (p = 0.021) |
| | layerize | CHEAPER in 10/10, median −7.8% (p = 0.002) |
| **Blending removed (`opaque`) vs Bain** | *every bucket* | **NOT SEPARATED — nothing reaches p ≤ 0.05, and paint is 5/10** |

The unpaired range-floor verdicts are reported by the harness alongside these and clear nothing: at
4 reps the render floor was ±48.4%, at 6 reps ±14%. See §6 for why that estimator gets worse with
more data and why it was left alone rather than replaced.


---

## 5. The findings

### 1. Semi-transparency is not the mechanism. The hypothesis named first is dead.

Forcing the overlay to **opacity 1.0** — same pixels, same footprint, alpha removed — separates on
**nothing**. Paint is 5/10, raster 6/10, composite 7/10. Not one bucket reaches significance and the
medians move a few per cent in a metric whose reps span more than that.

The premise was reasonable: an opaque layer can be blitted, a 0.55-alpha layer must be blended with
everything beneath it. It is simply not what is happening here, and §3 says why.

### 2. Nor is pixel count. The overlay's cost tracks the AREA IT COVERS, not its resolution.

`quarter` cuts both rasters to a quarter of their pixels **while holding the on-map footprint
exactly** — decoded texture falls 17.1 MB → 4.3 MB, a 75% cut — and raster work falls **6.3%**.

Set that against removing the overlay entirely, which cuts raster work **24.3%**. Three quarters of
the texture buys you a quarter of the saving that removing it does. The cost is in rasterising the
screen area the overlay occupies, and a 4× cheaper source image barely touches it.

### 3. Because the overlay never gets its own compositor layer.

**304 compositor layers with the overlay. 304 with it at a quarter of the size. 304 with it opaque.
304 with it hidden. 304 with both rasters gone.** Identical in every arm, in every run.

That single count explains findings 1 and 2 together. The overlay is not promoted to a layer of its
own — it is painted into the main content layer, so it is re-rastered as part of that layer's tiles
whenever they are invalidated, at the layer's resolution over the area it covers. Alpha is free
because the blend happens inside a raster pass that was going to run anyway; source resolution is
nearly free because the raster is at screen scale, not image scale.

### 4. And most of Bain's cost is NOT the rasters at all.

Bain's render work is **40% above** Goose Creek's. Strip **both rasters out of Bain** and it is still
**20.9% above** Goose Creek — with composite work **55.6%** higher and layerize **46.4%** higher,
both at 10/10 reps.

So roughly half of the gap is the rasters and roughly half is **Bain's own scene**: 1,035 canvas
nodes against 884, and **304 compositor layers against 118**. Nothing in this dispatch explains where
304 layers come from. It is the largest deterministic difference between the two plans, it is
identical across every raster arm, and it is the next thing to measure.

### 5. Main-thread work is IDENTICAL on the two plans — which is why nothing here was ever found.

Script + layout + style: **5 of 10 paired reps, p = 1.000.** Bain 795 ms, Goose Creek 790 ms.

That is the whole story of the miss in one line. **The only cost metric this program owns cannot
tell the two plans apart.** Every difference above lives in paint, raster, composite and layerize —
and the un-quantised work figure is structurally blind to all four.

### 6. The frame median is blind too.

50.0 ms on `bain`, 49.9 on `goose`, 50.0 on `quarter` and `no-rasters` — pinned to three display
frames. A metric whose smallest expressible step is one frame cannot resolve a 40% difference in
render work. (The two arms reading 62–67 ms are not a finding either; they are the same
quantisation landing on four frames.)

### 7. The aerial underlay is never painted at all.

`showAerial && underlay && !(origin && basemapOn)`, and `basemapSrc` initialises to `"esri"` whenever
a plan has an origin, with no persisted preference that can turn it off. On any real plan the live
basemap replaces the aerial, and the app says so in the References panel.

So "26 MB of decoded texture" was wrong. It is **17.1 MB painted**, plus one raster whose ~384 KB
string is read out of IndexedDB and held in React state for the whole session and never becomes a
texture at all.

### 8. The 10 MB strings are read ONCE, not per frame — and the heap shows it.

The overlay-load effect selects only overlays with `(idbKey || storageKey) && !src`, so once `src` is
filled it never re-reads. Read once, then held in React state for the session. The measured heaps
agree: `bain` 67 MB, `quarter` (same scene, quarter-size strings) **33 MB**, `goose` (no rasters at
all) **26 MB**.

### 9. The overlay DOES ride the B1440 pan anchor.

`overlayBands.below.map(renderSheetOverlay)` renders inside `<g transform={panT}>`, and
`renderSheetOverlay` positions through `f2p`, which reads the anchored `renderView`. During an armed
pan the overlay's `x`/`y`/`width`/`height` do not change; the group takes one transform. It is not
re-registered per frame.

### ⚠ 10. And one cost this fixture does NOT reproduce, which is a lead rather than a result.

His real overlay is **page 1 of a PDF**. B749 re-rasters a PDF-backed overlay at up to 8192 px
whenever on-screen magnification exceeds ~1.5× its base raster — gated on `overlayDocs.has(id) ||
storageKey.endsWith(".pdf")`. The fixture's overlay is a bare image with no PDF source, so **that path
never ran in any arm here.** It fires on **zoom**, not pan, and it is the obvious next suspect for
"Bain gets slow when I zoom in." Nothing in this document measures it.


---

## 6. What this still cannot settle — stated, not implied

- **The geometry is synthesised.** The fixture reproduces his measured element *counts* and both
  rasters' exact parameters. Where his buildings actually sit is invented. That bounds exactly one
  claim — the geometry share of the gap — and it is the largest share, so it matters. He offered the
  real 25,022-byte plan JSON; `scripts/extract-plan.mjs` is the tool to take it, and it is on
  `OWNER-TODO.md`.
- **The raster CONTENT is synthetic.** Dimensions, opacity, footprint, and the IndexedDB-string
  storage path are his; the picture is generated. That is sound for decode, texture and blend cost,
  which depend on the parameters rather than on what the drawing depicts.
- **This sandbox blocks every external host.** GIS, Supabase and the real aerial are **absent, not
  slow**. Every figure here is a lower bound.
- **Tracing perturbs.** Absolute paint/raster/composite figures are inflated by trace overhead. Only
  the between-arm comparison is claimed, which is what an arm design needs.
- **The noise-floor estimator has a defect, and it is named here rather than quietly replaced.** The
  floor this repo uses everywhere is a **range** — `(max − min) / median` over the baseline arm's
  repeats. A range is a monotonically increasing function of sample size, so **one contaminated run
  sets the floor for the whole battery, and adding data makes the floor WIDER rather than tighter.**
  That happened here: a single rep ran ~45% hot across several arms at once (container contention,
  visible because the arms are interleaved) and widened the render floor from ±8.5% to ±48.4%. The
  estimator was **not** changed after seeing that — swapping it for a kinder statistic once the result
  is known is precisely the move `PERCEPTUAL-PARITY` rule (4) forbids. Instead: more reps were run, and
  **every rep is printed**, so a reader can tell a genuinely noisy arm from one bad run.

---

## 7. What would settle it

1. **His real plan.** Run the extractor, land `smr9olizi5ue` and `sms4zs8unbkg` verbatim, re-run the
   battery. This turns the geometry finding from "measured on invented coordinates" into a fact.
2. **His machine.** Everything here is a lower bound with the network absent. `V11216` carries the
   signed-in check.
3. **The compositor-layer question, on its own.** 304 layers against 118 is the largest deterministic
   difference between the two plans, it is identical across every raster arm, and nothing in this
   dispatch explains where it comes from. That is the next thing to measure, and it is a *count* — it
   needs no noise floor to be worth chasing.

---

## Reproducing

```bash
npx vite build && npx vite preview --port 4173 &

# the arms
xvfb-run -a --server-args="-screen 0 1600x1000x24" \
  node ui-audit/raster-arms.mjs --fake-tiles --dpr 2.15 --reps 6

# the boot instrument, on Bain, with its rasters present before the first navigation
xvfb-run -a --server-args="-screen 0 1600x1000x24" \
  node ui-audit/boot-tail.mjs --fixture bain --fake-tiles --dpr 2

# ⛔ `node ui-audit/build-bain-fixture.mjs` NO LONGER EXISTS. The fixture it generated had invented
# coordinates, and the byte-identity check that guarded it was green for the fixture's whole life
# while that was true — a regeneration guard proves a file matches what produced it, and says nothing
# about whether that thing was making the plan up. Both real plans now come out of Supabase:
node scripts/plan-dump-to-fixture.mjs <dump.json> ui-audit/fixtures/<name>.json
# and the guard is the owner's own measured census, asserted in test/realPlanFixtures.test.js.

# the snippet the owner pastes into his own browser (the non-SQL route, unchanged)
node scripts/extract-plan.mjs
```
