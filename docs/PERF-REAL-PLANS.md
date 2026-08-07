# The owner's two real plans, landed — and what they change about what was already measured

**Written 2026-08-07.** Both plans the owner has reported as slow are now committed fixtures, pulled
verbatim from `public.sites` JOINED to `public.site_elements`. This document records what the real
censuses are, what they CORRECT in `docs/PERF-BAIN.md`, and what they do to the one question that
document closed on — the 304 compositor layers.

---

## 0. What was wrong with the old fixture, stated before anything is claimed from the new ones

`ui-audit/fixtures/bain-concept-a.json` reproduced the owner's reported element COUNTS exactly and
invented every COORDINATE. It said so, in its own header and in `PERF-BAIN.md` §6, and that honesty
was the right call. What it could not do is stop the number being quoted.

**The check that guarded it was a byte-identity check against its own generator, and it was green for
the fixture's entire life — while the coordinates were invented.** That is the exact limit of a
regeneration guard: it proves a file matches the thing that produced it and says nothing about
whether that thing was making the plan up. Both the fixture and the generator are now DELETED, not
kept alongside the real files, because a synthesised fixture left in the tree is one somebody
measures again by accident. The guard is now `test/realPlanFixtures.test.js`, which asserts each file
against the owner's own measured census.

⛔ **The trap that makes this data hard to pull, recorded once so nobody repeats it:** the elements
are NOT in the site row. `public.sites.data.els` is an EMPTY ARRAY on both plans and
`data.elementsInRows` is true; every element, parcel, markup, measure and callout is one row in
`public.site_elements`, discriminated by `kind`, with `deleted_at IS NULL` as the liveness filter.
Read only the site row and a 47-element plan reports as zero elements.

---

## 1. The two plans, as they actually are

| axis | **Bain — "Concept - Original"** | **Sylvestri — "Concept D"** | Goose Creek — Plan 1 (copy) |
|---|---|---|---|
| site id | `smr9olizi5ue` (Fort Bend) | `sms4zs8unbkg` (Harris) | — |
| elements | **47** | **98** | 62 |
| element mix | building 11 · sidewalk 10 · parking 10 · road 8 · paving 5 · trailer 2 · **pond 1** | building 31 · parking 23 · sidewalk 18 · paving 14 · road 7 · trailer 5 · **pond 0** | building 20 · paving 10 · parking 10 · trailer 8 · sidewalk 6 · road 6 · **pond 2** |
| rotated elements | **38 of 47** | **73 of 98** | — |
| parcels | 5 | 3 | 6 |
| centreline roads (points) | 8 (34) | 7 (33) | 6 |
| **callouts** | **0** | **16** | 0 |
| **markups** | **0** | **6** (4 polygons + 2 easements) | 0 |
| **measures** | **0** | **2** | 0 |
| cross-sections | 0 | 0 | 0 |
| **sheet overlay** | 1728 × 2592 @ **0.55**, **rotated 1.5°**, page 1 of a **PDF**, locked, from IndexedDB | **NONE** | **NONE** |
| aerial underlay | 1800 × 1167, opacity 1, `fromMap`, **live ArcGIS URL — fetched, not IndexedDB** | 1800 × 1656, opacity 1, `fromMap` | — |

Every one of those numbers is asserted in `test/realPlanFixtures.test.js`, against the values the
owner measured independently — not read off the files.

---

## 2. Four things the real plans CORRECT in `docs/PERF-BAIN.md`

### 2.1 The plan is 47 elements, not 53 — and the mix is different

Six elements that were measured do not exist, and the ones that do are distributed differently
(building 11 not 12, sidewalk 10 not 12, parking 10 not 12, paving 5 not 6). This bounds nothing in
findings 1, 2 and 5, which are BETWEEN-ARM comparisons with the geometry held identical across every
arm — the synthesis is common-mode there and cancels. It does bound finding 4, which attributes
roughly half the Bain–Goose gap to "Bain's own scene": that half was measured on a scene that was
13% larger than the real one and shaped differently.

### 2.2 ⛔ The sheet overlay is rotated 1.5°, and every arm ever run composited it AXIS-ALIGNED

The synthesis had `rotation: 0`. All six arms, both batteries, sixty runs, ran a raster the owner
has turned. `renderSheetOverlay` wraps the `<image>` in `rotate(θ cx cy)`, and an axis-aligned blit —
one source pixel copied to one destination pixel — is not available under a rotation; every
destination pixel must be resampled from a neighbourhood.

That is an untested term sitting underneath findings 1, 2 and 3, and it is why `raster-arms.mjs` now
carries a seventh arm, **`unrotated`**, which takes the rotation to 0 and holds pixel count,
`ftPerPx`, opacity, position and on-map footprint EXACTLY (unit-tested, the same invariant `quarter`
holds for size).

⚠ **What that arm cannot hold, said rather than glossed:** rotating a rectangle enlarges its
axis-aligned bounding box, so the rotated arm covers slightly more screen area. That is not a
confound to correct away — it is inherent to the change under test, and given finding 2 (the
overlay's cost tracks the AREA IT COVERS rather than its resolution) it is a candidate MECHANISM. A
separating result reads as "rotation costs something", never yet as "resampling costs something".

#### Result — 3 arms × 6 reps, interleaved, 18 runs, 0 suppressed

Medians per pan gesture (ms). Regime: 1× CPU, dpr 2.15, `--fake-tiles`, `decodeFault` armed.

| arm | render total | raster | paint | composite | layerize | work | layers | texture |
|---|---|---|---|---|---|---|---|---|
| `bain` (rotated 1.5°) | **2526** | 2117 | 89 | 226 | 99 | 4008 | 320 | 17.1 MB |
| **`unrotated`** | **2255** | **1851** | 85 | 220 | 99 | 4053 | 320 | 17.1 MB |
| `goose` | 985 | 762 | 96 | 82 | 55 | 479 | 118 | 0 MB |

**IT SEPARATES. Taking the rotation to 0 is CHEAPER in 6 of 6 paired reps (sign test p = 0.031),
median −10.2%** on render total, and it clears the unpaired range floor as well (−10.7% against
±8%). Raster work falls **2117 → 1851 ms, −12.6%**, which is where essentially all of it lives:
paint, composite and layerize each move by ~1% or less, and main-thread work does not separate at all
(2/6, p = 0.688) — the same blindness §5 of `PERF-BAIN.md` describes.

**Put next to the arms that came before it, this is the second-largest raster effect found:**

| what was removed | raster work |
|---|---|
| the overlay entirely (`no-overlay`, B209568) | **−24.3%** |
| **its 1.5° rotation (`unrotated`)** | **−12.6%** |
| three quarters of its pixels (`quarter`, B209568) | −6.3% |
| its alpha (`opaque`, B209568) | not separated |

**A 1.5° rotation costs about half of what having the overlay at all costs, and about twice what
quartering its texture does.** That is coherent with finding 2 rather than in tension with it: the
cost is in rasterising the screen area the overlay occupies, and rotation is the term that changes
how expensively each of those destination pixels is produced.

⛔ **What is NOT claimed.** The arm changes rotation, and rotation changes two things at once —
resampling cost per destination pixel AND the size of the axis-aligned bounding box. This result says
rotation costs something. It does not say resampling does. Separating them needs a further arm (an
unrotated overlay grown to the rotated bounding box) and nobody has run one.

⚠ **And this is not the owner's whole rotation story.** 1.5° is what his *overlay* carries. **38 of
his 47 Bain elements and 73 of his 98 Sylvestri elements are also rotated** — a term no arm in this
program has ever varied either, on a tier this one does not touch.

### 2.3 §8 is wrong about the underlay: it is fetched, not read out of IndexedDB

§8 says the underlay's ~384 KB string "is read out of IndexedDB and held in React state for the whole
session". The real row carries a live ArcGIS `World_Imagery/export` URL as its `src` and has **no
`idbKey`**. `dropIdbBackedSrc` strips the src of anything idb-backed, so a raster that KEPT its src
is proof it never was one.

**§7 is unaffected and stands:** the underlay is still never *painted*, because the plan has an origin
and the live basemap replaces it. What changes is where its bytes come from — a network fetch this
sandbox blocks entirely, rather than a local read. The fixture records `fromIdb: false` and
`_srcHost`, and `test/realPlanFixtures.test.js` asserts both.

### 2.4 §10's lead is now a fact, and it is still unmeasured

§10 flagged that the owner's overlay is page 1 of a PDF, which gates B749's re-raster at up to
8192 px on zoom, and that the fixture's bare image meant the path never ran. The real row confirms it:
`name` ends `.pdf`, `page: 1`, `pageCount: 1`. The fixture carries `pdfBacked: true` and the test
asserts it. **The path still has not run in any arm** — it fires on zoom, and every arm here pans.

---

## 3. The 304-layer question, with the real censuses

`PERF-BAIN.md` §7.3 closed on this: *"304 layers against 118 is the largest deterministic difference
between the two plans, it is identical across every raster arm, and nothing in this dispatch explains
where it comes from."* Two data points support several readings; the obvious one is that layer count
tracks how much is in the scene.

**Sylvestri is the third data point, and it is the one that discriminates** — because it is a real
plan, roughly twice Bain's element count, with no raster overlay at all.

### 3.1 ANSWERED. Every compositor layer is a basemap TILE. `layers = leafletTiles + 4`, exactly.

| plan | elements | canvas nodes | **compositor layers** | **Leaflet tiles in the DOM** | difference |
|---|---|---|---|---|---|
| **Bain** (real) | 47 | 598 | **320** | 316 | **+4** |
| Bain, both rasters hidden | 47 | 596 | **320** | 316 | **+4** |
| Bain, overlay unrotated | 47 | — | **320** | — | — |
| **Sylvestri** | 98 | 1,307 | **202** | 198 | **+4** |
| Sylvestri, annotations stripped | 98 | 1,148 | **202** | 198 | **+4** |
| **Goose Creek** | 62 (66 drawn) | 884 | **118** | 114 | **+4** |

**The scene-size reading is REFUTED, and not marginally.** Bain has the FEWEST elements of the three
and the MOST layers. Sylvestri has **more than twice Bain's element count and 118 FEWER layers**.
Stripping 159 canvas nodes out of Sylvestri moves the layer count by zero; hiding both of Bain's
rasters moves it by zero.

**What it actually is:** the number of basemap tiles Leaflet is holding in the DOM, plus four fixed
layers. Exact on every plan, in every arm, in every run. That single identity explains every
observation `PERF-BAIN.md` recorded about this number and could not account for:

- **Why it was identical across all six raster arms.** Of course it was — no raster arm changes the
  basemap. The count was never measuring the plan.
- **Why it is identical across all five annotation arms too.** Same reason, confirmed independently
  on a second plan by a second harness.
- **Why "304 against 118" looked like the largest deterministic difference between the two plans.**
  It is a real difference and it is not about the plans: it is about how many tiles each plan's
  camera is holding. Bain's fit and Sylvestri's fit cover different tile spans, and `tileBudget`'s
  overscan + `keepBuffer` retain a different number of them.

⛔ **So finding 4 of `PERF-BAIN.md` needs its second clause withdrawn.** It reads: *"roughly half is
Bain's own scene: 1,035 canvas nodes against 884, and 304 compositor layers against 118."* The node
count stands as a scene difference. **The layer count does not belong in that sentence** — it is a
basemap-retention difference that would be there with an empty plan. The composite and layerize
figures it was offered as an explanation for are real and still unexplained; the explanation was
wrong.

⚠ **The real Bain plan reads 320 layers / 598 canvas nodes, not 304 / 1,035.** The synthesised
fixture was a larger, differently-shaped scene, and 304 was a measurement of it. The number to quote
from now on is 320 — and the reason to quote it is that it is 316 tiles, not a plan.

**What this leaves open, stated so it is not mistaken for closed:** *why* Bain's camera retains 316
tiles where Goose Creek's retains 114. That is a tile-budget/overscan question about the initial fit
and the retention policy (`lib/tileBudget.js`, `lib/tileLifecycle.js`), not a scene-complexity
question, and it is now the well-posed version of §7.3's request. Whether 316 retained tiles is
itself a cost is a separate measurement nobody has taken.

---

## 4. The annotation axis, measured for the first time

Every plan this program has ever measured reads **0 / 0 / 0 / 0** on markups, measures, callouts and
cross-sections. Goose Creek does; Bain does. So every null result about annotation cost was
structurally guaranteed before the first gesture — the same shape of miss `PERF-BAIN.md` §0 admits
about rasters, on the other tier.

Sylvestri is the first plan here that is not zero, and it is the plan the owner described as
*"immediately loads super fast, and then literally three seconds later it's lagging again."*

⛔ **It is a clean control, which is what makes it worth more than a second Bain.** It has NO SHEET
OVERLAY. Nothing it shows can be charged to a raster, to blending, or to texture memory — the three
hypotheses the sixty-run Bain battery was about. Its only raster is the `fromMap` underlay the app
never paints on a plan with an origin.

### 4.1 Results — 5 arms × 6 reps, interleaved, 30 runs, 0 suppressed

Regime: 1× CPU, dpr 2.15, `--fake-tiles`. Medians per pan gesture (ms).

| arm | render total | raster | paint | composite | layerize | work | canvas nodes | text nodes | **layers** |
|---|---|---|---|---|---|---|---|---|---|
| `sylvestri` (baseline) | **1315** | 953 | 140 | 126 | 86 | 564 | 1,307 | 50 | **202** |
| `no-callouts` | 1216 | 873 | 126 | 128 | 79 | 521 | 1,185 | 20 | **202** |
| `no-markups` | 1179 | 815 | 140 | 134 | 84 | 544 | 1,280 | 47 | **202** |
| `no-measures` | 1357 | 992 | 151 | 133 | 88 | 581 | 1,297 | 50 | **202** |
| **`no-annotations`** | **1134** | 779 | 124 | 140 | 81 | 518 | **1,148** | **17** | **202** |

Noise floor on the baseline's own repeats: work ±16.6%, render ±8.9%.

**Finding 1 — the annotation tier costs real render work, and it SEPARATES.**
Removing all 24 annotations is **CHEAPER in 6 of 6 paired reps (sign test p = 0.031), median −12.6%**
on render total. It also clears the unpaired range floor (−13.8% against ±8.9%). This is the first
non-null result on this axis in the program, and it could not have been obtained on any plan measured
before — Bain and Goose Creek are both 0/0/0/0.

**Finding 2 — but NO SINGLE KIND separates on its own, and that is a result, not a shortfall.**
Callouts 5/6 (p = 0.219) · markups 5/6 (p = 0.219) · measures 2/6 (p = 0.688). The whole tier clears
the bar and none of its three parts does. The consistent reading is that the cost is DISTRIBUTED
across callouts and markups at roughly half the tier's magnitude each — below what six paired reps
can resolve individually — with measures contributing nothing. Six reps is the arithmetic minimum at
which a sign test can reach p ≤ 0.05 at all (6/6 → 0.031), so a per-kind answer needs more reps, not
a different statistic. ⛔ **Do not read "no single kind separated" as "callouts are free."**

**Finding 3 — `no-measures` came back DEARER (+3.2%), which is how you know the floor is honest.**
Two measurements cannot cost negative work. That arm's rep spread includes one run at 2372 ms against
a 1300 ms median — visible in the per-rep line, which is exactly why every rep is printed — and the
verdict correctly reports INCONCLUSIVE rather than a finding in either direction.

**Finding 4 — main-thread work does not separate here either.** `no-annotations` moves it −8.1%,
inside the ±16.6% floor, at 5/6 paired reps (p = 0.219). The same pattern as `PERF-BAIN.md` §5: the
difference is in paint and raster, and the un-quantised work figure is structurally blind to both.

**Finding 5 — the node census, which needs no statistics.** The 24 annotations are **159 canvas nodes
and 33 text nodes**: callouts 122 nodes / 30 text, markups 27 / 3, measures 10 / 0. Callouts are ~77%
of the annotation tier's DOM by node count on this plan.

---

## 5. What this still cannot settle — stated, not implied

- **The raster CONTENT is still synthetic.** Dimensions, opacity, rotation, footprint and the
  storage path are the owner's; the picture is generated. Sound for decode, texture and blend cost,
  which depend on the parameters rather than on what the drawing depicts.
- **Callout TEXT is shape-redacted, not verbatim.** Line count, per-line length and whitespace
  positions are exact — so every word-wrap break lands where it really does — but per-glyph advance
  width is not preserved, because the app renders in a proportional font. Line count, node count and
  box count are exact; the rendered WIDTH of a callout box is approximate. Any claim resting on the
  exact measured width of a callout must say so. (The alternative was worse: replacing a six-line
  note with "Note 3" deletes the property the fixture exists to reproduce.)
- **The parcel appraisal records are gone and are not coming back.** They carry third-party owner
  names, mailing addresses and valuations, and nothing in any render path reads them.
- **This sandbox blocks every external host.** GIS, Supabase and the real aerial are ABSENT, not
  slow — and on these plans that now includes the underlay itself, which is a live ArcGIS fetch.
  Every figure here is a lower bound.
- **`encodedBytes` for both rasters is the owner's measurement, not the row's.** The bytes live in
  HIS IndexedDB; Supabase holds a Storage pointer, so the row cannot report a length.
- **B749's PDF re-raster is still unmeasured.** It fires on zoom; every arm here pans.

---

## Reproducing

```bash
npx vite build && npx vite preview --port 4173 &

# the raster arms, now including the rotation arm
xvfb-run -a --server-args="-screen 0 1600x1000x24" \
  node ui-audit/raster-arms.mjs --fake-tiles --dpr 2.15 --reps 6

# the annotation arms, on Sylvestri
xvfb-run -a --server-args="-screen 0 1600x1000x24" \
  node ui-audit/annotation-arms.mjs --fake-tiles --dpr 2.15 --reps 6

# re-pull either plan from Supabase (the dump is an INPUT and must never be committed)
node scripts/plan-dump-to-fixture.mjs <dump.json> ui-audit/fixtures/<name>.json
```
