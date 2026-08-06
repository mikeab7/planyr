# BAIN, MEASURED — and what every previous number was measured on instead

**Written 2026-08-06, at the owner's explicit request.** His words: *"have you been driving the Bain
site that I was telling you about… I'm not saying it was the pond. I'm just saying that BAIN WAS SLOW.
So have you decided to test that? And if not, shouldn't you be testing it in the browser?"*

He was right, and the answer to the second question was no.

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

<!-- RESULTS -->

---

## 5. The findings

<!-- FINDINGS -->

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
2. **His machine.** Everything here is a lower bound with the network absent. `V17200` carries the
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

# regenerate the fixture from the measured census (--check fails CI on drift)
node ui-audit/build-bain-fixture.mjs

# the snippet the owner pastes into his own browser
node scripts/extract-plan.mjs
```
