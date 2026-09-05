# WHAT IS STILL BLOCKING US

**Written 2026-08-06, at the owner's explicit request, after he lifted two constraints and replaced a
third.** Every constraint this repo currently obeys that limits render performance, with what it costs
and who owns it.

Each is marked:

| mark | means |
|---|---|
| **REAL** | a genuine product or user requirement. Not negotiable without making the product worse. |
| **TEST-DEBT** | a cost measured in migrating tests, not a product requirement. Buyable with engineering time. |
| **OWNER-SETTABLE** | a trade the owner chose and could re-choose. The price is named. |

Numbers are measured on this machine unless stated. Where a number is a lower bound because the sandbox
blocks every external host, it says so.

---

## 0. What just changed, so the rest reads correctly

Three constraints moved on 2026-08-06:

1. **The export no longer has to be a clone of the screen.** Owner: *"we can just have the PDF export
   run whatever calcs need to be done when we actually hit the PDF export."* This was the **first** of
   B1360's four reasons Canvas/WebGL was rejected, and it bounded every render decision since.
2. **The B1345 pixel bar is retired** for LOD-class changes and replaced by **PERCEPTUAL-PARITY**
   (`/CLAUDE.md`): imperceptible at working zoom, measured as CIEDE2000 on an acuity-filtered pair.
3. **"Never downgrade drawing quality or quantity" is rescinded.** Level of detail at working zooms is
   authorised, bounded by the perceptual bar instead of by a prohibition.

---

## 1. The four Canvas/WebGL objections (B1360), re-scored

B1360 rejected Canvas/WebGL for four structural reasons. Here is each one today.

### 1a. "`buildExportSvg` CLONES the live SVG" — **GONE**

The owner removed it. It has also now been *used*: the pan anchor shipped in this dispatch works
precisely because an export pass resolves its own render view instead of inheriting whatever transient
representation the screen is holding. A sheet built mid-gesture is identical to one built at rest, by
construction rather than by luck.

**What it unlocks, concretely.** The screen is now free to hold a representation the export never sees.
That is what made pan-as-a-group-transform safe to ship, and it is the precondition for the same move on
zoom. It also removes the reason the export path had to defeat viewport culling with a synchronous
full-render (`withFullRender`) — that dance exists only because the export reads the live scene graph.

### 1b. "54 of 65 e2e specs read `planner-canvas`" — **TEST-DEBT, and the real number is 23**

Measured today: **64 of 76 spec files** mention `planner-canvas`. But that count is misleading, and it is
the number that has been quoted to justify the objection.

**Only 23 of them assert anything about the SVG's internal structure** (`data-el-id`, the handle layer,
`elementFromPoint` / `elementsFromPoint`, `querySelectorAll` over canvas children). The other 41 use the
canvas as a *click target* or a *screenshot region* — they would not notice if the static content behind
it were painted by a canvas element.

**Migration estimate: 23 specs.** Of those, the ones that hit `elementFromPoint` are the expensive class,
because a canvas has no hit-testable children — they would need a coordinate-based hit-test hook exposed
for tests. Call it **one focused session for the 41 (probably zero work), and two to three for the 23.**

### 1c. "39 `data-*` names are the test contract" — **TEST-DEBT, and it is smaller than it sounds**

Measured today: **56 distinct `data-*` names** are defined in `SitePlanner.jsx`; **48 distinct** are
asserted anywhere in `e2e/`. But most of those live on chrome, panels, handles and the map furniture —
not on the drawn plan geometry that a canvas layer would absorb.

This is real work but it is **mechanical**: a canvas-backed static layer keeps every interactive element
(handles, selection, live edits) in SVG, so the `data-*` names that matter for interaction do not move. The
names that would move are the ones on inert drawn geometry, which is exactly the set that has no behaviour
to assert.

### 1d. "the accessibility tree is the SVG" — **NOT REAL. This one does not survive contact with the code.**

Measured today: **inside the entire canvas SVG there is exactly ONE accessibility attribute** — the
`role="application" aria-label="Site plan canvas"` on the `<svg>` element itself. Not one building, parcel,
pond, road, dimension or label is exposed to assistive technology. (`role="application"` additionally tells
a screen reader to pass keystrokes through and stop describing the subtree.)

**So there is no accessibility tree to lose.** Moving inert geometry to a canvas would change the
accessibility of the plan from "one unlabelled application region" to "one unlabelled application region."

This is worth saying plainly: **the app's plan canvas is not accessible today**, and that is a real gap
worth fixing on its own merits — but it is not, and never was, an argument for staying in SVG. If anything
the reverse: a canvas layer would force the question to be answered deliberately (an off-screen described
list) rather than left implied.

---

## 2. THE B1345 PIXEL BAR — **replaced this dispatch (was OWNER-SETTABLE)**

**The old bar:** byte-identical, or one unit of 255 on one channel.

**What it cost, twice.** B1350's dock-door leaf fold — 424 DOM nodes on the owner's real plan — was
rejected in July, then rejected again in PR #921 when the cause turned out to be that Chromium does not
rasterise a `<rect>` and a rectangular `<path>` to the same antialiased edge **at any zoom**, so no gate
could ever have satisfied the bar.

**The new bar: PERCEPTUAL-PARITY.** Full text in `/CLAUDE.md`. In short: both renders are low-pass
filtered at two scales — one near visual acuity, one inside the eye's high-sensitivity band — and compared
with **CIEDE2000**, the CIE's own perceptual colour-difference formula, rather than an 8-bit channel
distance. Bars: detail ΔE00 ≤ 6.0 · perceived ΔE00 ≤ 1.0 (the classical just-noticeable difference) ·
perceived frame-mean ΔE00 ≤ 0.10.

**Why two scales.** A raw diff cannot tell *the same ink moved a sub-pixel* (invisible) from *a line of ink
removed* (a downgrade). Both read ~23/255. Refusing both is safe and is exactly what byte-identity did — at
the price of refusing every representation change forever.

**What a perceptual bar unlocks, in nodes and milliseconds.** The class of change it admits is
"re-express the same drawing with fewer nodes":

| candidate | nodes on the reference plan | status |
|---|---|---|
| stall striping (B1345, already shipped) | −1,550 (63% of canvas DOM); drag frame median **halved**, 33.3 → 16.8 ms | shipped under the old bar because it happened to be byte-identical |
| dock-door leaves (B1350) | −424 | **measured under the new bar this dispatch — FAILED, see below** |
| dimension ticks / setback chip plates | not yet measured | candidate |

**And the honest result of its first use: it rejected the change it was introduced for.** The dock-door
fold recovers exactly the 424 nodes, and comes in at **perceived ΔE00 1.20–2.19 against a bar of 1.0** at
every armed zoom (control rung above the gate: byte-identical). The cause is not antialiasing: N
95%-opacity `<rect>`s each fill-then-stroke, while one `<path>` fills every subpath and *then* strokes them
all, and at these zooms a door run is a band of overlapping sub-pixel marks where that ordering genuinely
moves ink.

**The bar was not moved to make it pass.** The single modelling parameter the verdict turns on is
`PERCEIVED_ARCMIN` — 6, the half-period at the contrast-sensitivity peak. **12, the full period, would
roughly halve every number and this would clear.** That parameter was chosen at the strict end *before* the
measurement and deliberately left alone *after*, because picking a threshold to suit a result you have
already seen is not a measurement. **It is on `OWNER-TODO.md` as a one-line decision with 424 nodes on it.**

---

## 3. "CAPPING RETAINED MEMORY IS AUTHORISED; A DOWNGRADE OF QUALITY OR QUANTITY IS NOT" — **RESCINDED this dispatch**

Owner, 2026-08-06: *"never downgrade drawing quality or quantity. I think we can scratch that if it makes
sense. like, especially if it's on something too small to see it."*

**What it was forbidding.** Level of detail at working zooms. Concretely, on the owner's Goose Creek plan
at whole-site zoom, a 9′ parking stall is **0.18 px wide** and a dock door leaf is **0.18 px**. Before
B1345, 38 elements were producing ~2,100 of a 2,481-node canvas — roughly **85% of the drawing was marks
finer than one pixel**.

**What LOD would buy, and what it costs visually.** The precedent is measured: B1345's stall collapse took
canvas DOM from 2,485–2,547 to 932–935 at site overview (−63%), halved the drag frame median, and cut the
wheel-zoom median from 200–250 ms to 116–150 ms. It cost **nothing visible** (three rungs byte-identical,
two within 1/255).

**The cost is real but bounded, and it is now measurable rather than argued.** Any LOD change is a bet that
a mark below some size carries no information. The perceptual bar is what settles that bet, and it has
already shown it will say no.

**The B65 anti-flash ghost buffer still stands.** It has not been measured as a cost in this dispatch and I
am not removing it on suspicion. If a future measurement shows it is expensive, it gets costed and put to
the owner, not deleted.

---

## 4. `detectRetina` FETCHING ONE ZOOM LEVEL DEEPER — **OWNER-SETTABLE, and it is applied inconsistently today**

The trade: on a HiDPI display Leaflet requests tiles one zoom level deeper, so the aerial is sharp. That is
**4× the tile pixels**, which is decode work and GPU texture memory — the largest single non-JS memory
consumer this app has (measured: ~420 MB of a ~555 MB tab, against a ~135 MB JS heap).

**Is the trade right for every layer? No — and the code does not actually make it consistently.**

| layer | retina | correct? |
|---|---|---|
| Site Planner — detail aerial | gated by zoom band (`retinaForZoom`, on at zoom ≥ 15) | **Yes.** Sharp where a site is read, clamped at wide context zooms where an extra tile level buys nothing you can see. |
| Site Planner — coarse z13 backfill | **off** | **Yes.** It is a blur-behind layer by design. |
| **Map Finder — main basemap** | **`detectRetina: true`, ungated** | **No.** It ignores `retinaForZoom` entirely — the module that owns the policy. |
| Map Finder — esri overlay | off | Yes. |

**The inconsistency is real and it is not a bug I have fixed here, deliberately.** Applying the planner's
existing, owner-approved policy to the Map Finder would soften the aerial at exactly the wide zooms the
finder is *used* at — you are looking for a site, not reading one. That is a product trade, not a tidy-up,
so it is reported rather than shipped. **Price if taken: roughly a 4× cut in finder tile memory at zoom
< 15, against a visibly softer aerial while browsing.**

---

## 5. THE 26,000-LINE `SitePlanner` COMPONENT — **REAL, and here is a shape and a size**

Measured today (B1360 quoted 23,000 / 194 / 73; it has grown):

| | |
|---|---|
| lines | **26,140** |
| `useState` | **211** |
| `useEffect` | **77** |

**Why it costs render time.** Every one of those 211 state atoms lives in one component, so *any* of them
changing re-runs a ~13,700-line render body. B1158 (yield derivation on every render) and B1352 (element
memo) are both symptoms of this, and both were fixed by drawing a boundary rather than by making the body
faster.

**A shape, so the owner can decide whether to start it.** Not one big-bang rewrite — four extractions, each
independently shippable and independently verifiable, in this order:

| # | extraction | what moves | size | what it buys |
|---:|---|---|---|---|
| 1 | **The inspector / yield panels** (B1351 already filed) | ~1,084 JSX tags + their derivations, behind memoised children | **1 session** | Measured: panels open cost **+34.4% of an identical gesture** (+683 ms script) on unchanged content. This is the single largest measured amplification axis after layers. |
| 2 | **The drawn-content layer** | `renderElPx` + the element/parcel/markup passes into their own memoised component tree | **1–2 sessions** | Makes the B1352 boundary structural rather than a convention. Precondition for #4. |
| 3 | **The gesture/tool state machine** | the ~40 `drag.current` modes and their handlers into a reducer outside the render body | **2 sessions** | Removes the largest source of "any state change re-runs everything". Highest risk of the four — this is where every interaction bug lives. |
| 4 | **The view/transform layer** | `view`, `renderView`, the pan anchor, zoom, registration into one owner | **1 session** | The remaining half of B1360 (zoom as a group scale). |

**Total: five to six focused sessions.** That is a program, not a refactor — but it is four separately
mergeable pieces, and **#1 alone is worth a session on its own measured number.** It is not "a multi-session
project" in the sense of being unstartable; it is a queue.

---

## 6. THE RENDER-ARCHITECTURE CALL (the owner delegated it)

He was asked whether the static layer should move to canvas (Bluebeam-style, active elements staying live
SVG) or stay all-SVG with the per-frame work removed, and answered: *"whatever makes the most sense to
achieve my goal."* His goal, in his words: *"It's always super smooth. It's no matter if I have two hundred
elements on there."*

Both paths, costed honestly.

### Path A — stay in SVG, make the view a transform

**What it is.** Draw in a view-independent space; a pan is a group `translate`, a zoom is a group `scale`
between re-emissions. Nothing re-renders during a gesture; element memos bail on 100% of elements instead
of missing on 100%.

**What it has already delivered, this dispatch.** The pan half shipped and was measured:
**101,267 → 2,194 DOM mutation records** across a 60-move pan on the reference plan — a **46× reduction** —
and the same scripted gesture completed in 2,737 ms against 4,000 ms.

**What is left.** The zoom half. B1360 priced it as "a multi-session project with a design decision at the
front of it", and named two blockers: *the export would have to follow*, and *the pixel bar has to be
re-stated for "during a gesture" or this cannot ship.* **Both of those are now gone** — the export is
independent as of this dispatch, and the bar was re-stated on 2026-08-06. What remains is genuinely
mechanical: counter-scale strokes (`vector-effect`), counter-scale text, and re-decide LOD gates when the
scale crosses a rung. **Estimate: 1–2 sessions**, down from "multi-session with a design decision."

**Cost:** ~2 sessions. **Test migration: zero.** **Accessibility: unchanged.**

### Path B — canvas for the static layer, SVG for the live one

**What it is.** Inert drawn geometry rasterises to a canvas; handles, selection and the element under edit
stay live SVG above it. This is the Bluebeam shape.

**What it buys beyond Path A.** Path A already makes *view gestures* independent of element count. Canvas
additionally makes **content changes** cheap — dragging one element with 200 on screen redraws pixels rather
than reconciling a tree — and cuts retained DOM, which is where the 278 MB tab partly lives.

**Cost:** ~23 e2e specs to migrate (§1b) · a hit-test hook to replace `elementFromPoint` · the `data-*`
names on inert geometry (§1c) · accessibility work that **should be done anyway and is currently zero**
(§1d) · and a second renderer to keep in agreement with the SVG one forever. **Estimate: 4–6 sessions**,
and it carries a permanent maintenance tax that Path A does not.

### The call

**Take Path A now, and re-measure before committing to Path B.**

The reasoning, not the preference: Path A's first increment returned **46×** for roughly a day's work, its
second increment just lost both of the blockers that made it expensive, and it costs **zero test
migration**. Path B's advantage is real but it is over a baseline that Path A has not finished moving — and
the honest thing to say is that **nobody knows what the frame time looks like after the zoom half lands**,
because it has not been built.

So: finish Path A (1–2 sessions), then run the same probe. If a 200-element plan is still not smooth after
that, Path B is the answer and the ~23-spec migration is worth paying. Deciding it now would be choosing the
expensive path against a number we have not measured yet.

**This is not a request for the owner to re-decide.** He delegated it, the choice is reversible (Path A is a
prerequisite for Path B, not an alternative to it — the view-independent space is what a canvas layer would
draw into anyway), and the migration is not larger than one focused program.

---

## 7. THE THREE-SECOND POST-DRAW CLIFF — measured with and without the drainage pass

The amendment asked for this specifically: the drainage pass was the prime suspect, and the measurement had
to be run both ways *because if the cliff survives the removal we need to know that*.

Boot timeline, 4× CPU throttle, one rep per arm, `main` (drainage auto ON) vs this branch (manual only):

| segment | auto ON | manual | Δ |
|---|---:|---:|---:|
| first script → first contentful paint | 933.8 ms | 863.7 ms | −70 |
| first paint → canvas element exists | 2,542.0 ms | 2,472.8 ms | −69 |
| canvas exists → canvas drawn | 364.7 ms | 328.7 ms | −36 |
| **canvas drawn → press delivered** | **1,369.6 ms** | **1,058.7 ms** | **−311** |
| **press delivered → release delivered** | **1,225.1 ms** | **1,157.4 ms** | **−68** |
| **time to first drag** | **6,509 ms** | **5,967 ms** | **−542** |
| **the post-draw tail** | **2,595 ms** | **2,216 ms** | **−379** |
| long tasks | 17, 3,720 ms | 15, 3,421 ms | −299 ms |

**THE CLIFF SURVIVES.** With the load-time facts pass removed from the boot path entirely — no timer, no
idle ceiling, nothing fetched on open — the app still spends **2.2 seconds working after the canvas is
already drawn.** The drainage pass is not the cliff.

**On the −542 ms: one rep per arm is not proof.** B1431 pooled six boots per arm for the same control and
reported ~−0.5 s *with the two ranges overlapping*. This pair is **consistent with** that figure and is not
independent evidence of it. The finding that does not depend on the noise floor is the one above: the tail
is still there.

**Where the tail actually is, from the same run:** the two post-draw segments are **98–99% busy** with V8
parse/compile at 254–389 ms and the rest inside the planner's own re-rendering. It is continued
re-rendering, not waiting. That is the next thing to attribute, and it now has no confounding fetch in it.

---

## 8. Process discipline — NOT constraints, and not up for renegotiation

Listed here so the list is complete and so nobody re-reads them as performance blockers.

- **The mint gate.** The owner asked about this one. It prevents two parallel sessions minting the same
  `B#`/`V#`. It runs on `git push`, reads git refs, and has **zero runtime cost** — it is not in the app, it
  is not in the build output, and it limits nothing about performance. It stays.
- **Never weakening or deleting a guard to make a build pass.** Two guards were **retargeted** this dispatch
  (the dock-leaf source guard, the flood-facts header guard) — both now assert *more* than before, and both
  retargets are annotated with what changed and why. Retargeting a guard whose subject the owner moved is
  correct; deleting one is not.
- **Never raising a ceiling.**
- **No baseline re-recording while B1178 is open.**
