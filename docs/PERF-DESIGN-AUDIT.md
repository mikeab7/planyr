# The browser-performance design audit — every principle, scored against this code

**Filed 2026-08-06 (NEW-1 of the owner's speed block). Companion instrument: `ui-audit/session-axes.mjs` (NEW-2).**

> **The owner, verbatim:** *"Think through every design principle when it comes to browser software that
> could be slowing it down. Like, let me go through every single item, and don't stop until you finish.
> and analyze it against, like, whatever would be best practice or good code architecture or whatever."*

He is right to push, and the reason he had to is recorded here rather than glossed: **B1432 measured the
interaction axis and found nothing, and the response was to hand him a console snippet.** That pushed the
work back onto him. This document and the two instruments beside it exist so that never happens again.

---

## ⛔ THE REFRAME, which changes what "slow" even means here

B1432's probe **froze content and varied interaction count**: same plan, same elements, same layers,
1,000 gestures. Nothing grew, in three regimes. That result stands and it is not being re-litigated.

But **a real work session is not a constant scene.** The owner draws elements, turns layers on, opens
panels, switches plans and revisions, and edits. Every one of those **rises monotonically through a
session** and **every one of them resets on reload** — which is exactly the shape of his complaint
(*"reload and it's quick; a minute or two of panning and it's lagging just to go side to side"*).

So the honest hypothesis is not accumulation, it is **AMPLIFICATION**:

```
per-frame cost ≈ f(elements drawn × panels open × layers enabled × memo-invalidation state)
```

and "time since reload" is only the proxy that correlates with all four.

**This also reconciles B1357's r = 0.93 "cost tracks how much is drawn".** That finding may have been
right all along. What changes during his session is *how much is drawn* — because he is the one drawing
it. Nothing below assumes that reading; the point of NEW-2's probe is to test it, and where it is tested
the result is quoted with its noise floor.

---

## How to read the scoring

Each principle gets: **BEST PRACTICE** (one line) · **WHAT PLANYR ACTUALLY DOES** (with `file:line`) ·
**PASS / VIOLATION / N-A** · the per-frame cost, marked **MEASURED** or **ESTIMATED** with the reason ·
and **GROWS?** — whether the cost rises as a session fills up.

Categories that come back clean are recorded as PASS rather than skipped. Several do, and two of them
(the label engine and the forced-layout *avoidance* in the label tier) are genuinely good engineering
that a "find the problem" sweep would have walked past.

**Where the numbers come from.** `MEASURED (NEW-2)` = `ui-audit/session-axes.mjs`, this session, headed
Chromium, the 62-element Goose Creek reference plan, cost = **script + layout + style-recalculation ms
per identical pan-and-zoom gesture** read from the renderer's own counters, each rung a median of three
probes against a **±11.1% floor**. `MEASURED (B####)` = a prior item's number, cited not re-derived.
`ESTIMATED` = read off the code with the basis stated.

**THE THREE SESSION AXES, MEASURED — this is the audit's own headline and it is the amplification
hypothesis coming back positive on all three:**

| axis | rise across the ladder | per unit | r | by end of a session |
|---|---:|---:|---:|---:|
| **Layers enabled** (0 → 4 drawn layers) | **+102.5%** | 360 ms | 0.775 | ×8 → **2,880 ms** |
| **Elements drawn** (66 → 96) | **+59.9%** | 38.5 ms | **0.927** | ×40 → **1,541 ms** |
| **Panels opened** (0 → 4) | **+34.4%** | 221 ms | 0.914 | ×4 → **885 ms** |

The elements row's **r = 0.927** is worth pausing on: it reproduces **B1357's r = 0.93** almost exactly,
on a completely different instrument, with the elements arriving through the real draw tool rather than a
fixture. That finding was right, and this is what it looks like when the owner is the one drawing.

**Instrument note, because it matters for every "INCONCLUSIVE" in this repo's history.** B1432 could not
clear a ±33–100% noise floor and said so honestly. That floor came from **16.7 ms frame quantisation** —
a frame median can only ever be 16.7, 33.3, 50.0, so on a 16.7 ms median the smallest expressible
difference is ±100%, and **no number of repeats could ever have helped.** NEW-2 fixes the instrument
instead of restating the floor: the cost metric is now main-thread *work* at microsecond resolution,
cross-read against `longtask` and Event Timing. **The floor went from ±99.8% to ±11.1% on the same
machine in the same session** — which is the difference between an instrument that can answer this
question and one that cannot.

---

# (1) LAYOUT

### 1.1 Forced synchronous layout / layout thrashing (read-after-write)
- **Best practice:** never read a geometry property (`clientWidth`, `getBoundingClientRect`) after
  mutating the DOM in the same frame; batch reads before writes.
- **Planyr:** the drawing↔basemap registration layout effect (`SitePlanner.jsx:2751`) reads
  `wrap.clientWidth` / `wrap.clientHeight` at `SitePlanner.jsx:2992` **inside a `useLayoutEffect`** —
  i.e. immediately after React has mutated the DOM — so every run flushes a full layout of the
  just-dirtied tree. The tile branch additionally calls `getBoundingClientRect()` **once per tile
  `<img>`** in a loop (`SitePlanner.jsx:2874`, `SitePlanner.jsx:2881`).
- **VIOLATION.** This is B1359, already filed and already measured.
- **Cost — MEASURED (B1359):** 11.3% of script self-time with panels closed, **13.1% docked**;
  1,471 → 1,776 ms across a 40-event gesture. `LayoutCount` **flat** (97–110 vs 91–100) while
  `LayoutDuration` rose **881 → 1,276 ms (+45%)**. The panel does not make the effect run more often —
  **it makes each forced layout dearer, because there is more DOM to lay out.**
- **GROWS? YES, on two axes at once.** Dearer with every node the session adds (panels, elements), and
  the tile loop is O(tiles) — **105 tiles at retina vs 36 at dpr 1** (MEASURED, B1433), so the loop is
  ~3× longer on the owner's HiDPI display than on the sandbox's.

### 1.2 Style-recalculation scope
- **Best practice:** keep selectors shallow and changes scoped, so a style invalidation does not re-match
  the document.
- **Planyr:** styling is almost entirely **inline `style={{…}}` objects** and a small `index.css` with no
  deep descendant selectors. Inline styles invalidate exactly one element.
- **PASS.**
- **Cost — MEASURED (NEW-2):** style recalculation is **132–247 ms per gesture, 7–11% of total work**,
  and it tracks node count rather than selector complexity.
- **GROWS?** Mildly, with node count — but it is not the mechanism.

### 1.3 Layout invalidation scope
- **Best practice:** a change in one subtree should not force layout of unrelated subtrees.
- **Planyr:** the canvas `<svg>` and the panel column are siblings in one flex row
  (`SitePlanner.jsx:19705`+). There is no containment boundary between them (see 1.4), so the forced
  layout in 1.1 walks the panel DOM too. `layoutObjects` MEASURED (NEW-2): **1,620 with no panel open →
  2,347 with four open (+45%)**.
- **VIOLATION**, and it is the mechanism *behind* 1.1's growth rather than a separate cost.
- **GROWS? YES** — directly with panels open and elements drawn.

### 1.4 CSS containment (`contain`, `content-visibility`)
- **Best practice:** `contain: layout paint` on independent panels/cards stops their internals from
  participating in an ancestor's layout; `content-visibility: auto` skips offscreen subtrees entirely.
- **Planyr:** **not used anywhere.** `grep -rn "content-visibility\|contain:" src/` returns **nothing**.
- **VIOLATION — and it is the cheapest unexploited win in this whole document.** Every docked and
  floating panel is a self-contained scroll region whose internals cannot affect the canvas's geometry,
  which is the textbook case for `contain: layout paint`.
- **Cost — ESTIMATED:** it does not remove work, it removes work *from the forced layout in 1.1*.
  Basis: `layoutObjects` rises 1,620 → 2,347 with four panels open (MEASURED, NEW-2) and `LayoutDuration`
  rises +45% with one panel docked (MEASURED, B1359) at flat `LayoutCount`. Containing the panels should
  recover most of that delta. Not measured directly here because it belongs with the fix, not the audit.
- **GROWS? YES** — the benefit grows exactly as panels and DOM grow.

---

# (2) SVG AS RETAINED-MODE DOM

### 2.1 Node count vs draw cost
- **Best practice:** retained-mode DOM cost is dominated by node count and by how many attributes change
  per frame, not by pixels drawn.
- **Planyr:** MEASURED (NEW-2) — **976 canvas nodes** for the 62-element reference plan with all drawn
  layers on; **531 with them off**. MEASURED (B1360): **679 DOM mutation records per commit** during a
  wheel gesture.
- **VIOLATION by design** (see 2.2) — the node count is fine; **what is written to it every frame is not.**
- **GROWS? YES**, linearly with elements drawn.

### 2.2 ⛔ NO SINGLE PAN/ZOOM TRANSFORM NODE — the structural one
- **Best practice:** draw in a view-independent space and let pan/zoom be **one transform on one group**,
  so a gesture writes one attribute.
- **Planyr:** `f2p` is `worldToScreen({scale: view.ppf, tx: view.offX, ty: view.offY}, p)`
  (`SitePlanner.jsx:4299`), called **141 times** across the render, and every element's pixel geometry is
  therefore a function of the view. A pan re-emits ~1,200 host elements instead of translating one node.
  The root `<svg>` already carries a `transform: translate(…)` for the sub-pixel basemap weld
  (`SitePlanner.jsx:17970`) — so the mechanism exists; the view simply does not use it.
- **VIOLATION.** This is B1360, filed and costed.
- **Cost — MEASURED (B1360):** script ≈ 65–72% of a wheel frame; `ElNode`'s memo (`SitePlanner.jsx:23627`)
  **misses on 100% of elements during a view gesture by construction**, which is why B1352 moved the
  number by less than the noise floor. Pan p90 **133 ms**.
- **GROWS? YES**, linearly with elements drawn — this *is* the r = 0.93 axis.

### 2.3 `getBBox` / `getScreenCTM` / `getComputedTextLength`
- **Best practice:** never call these per element per frame — each forces layout of the SVG.
- **Planyr:** `grep -rn "getBBox()\|getComputedTextLength\|getScreenCTM" src/` returns **zero hits.**
  Label sizing is computed arithmetically (`lib/labelFitLadder.js`, `lib/labelLayout.js`) rather than
  measured from the DOM.
- **PASS — and a deliberately good one.** This is the single most common SVG performance mistake and
  this renderer does not make it.

### 2.4 `<text>` measurement cost
- **Best practice:** text measurement is the dearest SVG operation; avoid it in the hot path.
- **Planyr:** see 2.3 — measurement is arithmetic, not DOM. MEASURED (B1360): number **formatting** is
  3.3% of a zoom frame closed, **5.2% docked** — the panel re-formats its numbers every frame (which is
  a category-3 problem, not a text-measurement one).
- **PASS** on measurement; the formatting cost is charged to 3.2 below.

### 2.5 Label collision complexity — is it O(n²)?
- **Best practice:** screen-space decluttering must be sub-quadratic, or it explodes as the plan grows.
- **Planyr:** `lib/screenDeclutter.js:49` `spaceOut()` uses a **uniform grid hash with a 3×3
  neighbourhood probe** — explicitly O(n), and its own comment says why.
- **PASS.** The answer to the item's question is **no, it is not O(n²)**, and it was deliberately built
  that way after the Weld County "how many dots show up" report.

### 2.6 Filters / masks / clipPaths forcing offscreen raster
- **Best practice:** each of these forces an offscreen surface; keep them off the per-frame path.
- **Planyr:** **3 occurrences** in 26k lines — a building drop-shadow filter and two clip paths. Not in a
  per-element loop.
- **PASS.**

### 2.7 `vector-effect` / non-scaling-stroke
- **Best practice:** `vector-effect="non-scaling-stroke"` lets the *browser* keep stroke widths constant
  under a group scale, at zero script cost.
- **Planyr:** **zero occurrences.** Stroke widths are recomputed in script per element per frame via
  `strokeZoom(...)` (14 call sites).
- **VIOLATION — but a small one today, and a large *blocker* tomorrow.** The per-frame script cost is
  minor; what matters is that **this is the precondition for 2.2's fix.** A group `scale` would scale
  every stroke unless `vector-effect` counter-scales them, and B1360's cost table names exactly this as
  the reason increment 2 is high-risk.
- **GROWS?** Linearly with elements, but the cost is not the point — the dependency is.

---

# (3) REACT

### 3.1 ⛔ ONE component holding the entire workspace
- **Best practice:** components are the unit of re-render; a component's cost is paid in full whenever
  any of its state changes.
- **Planyr:** `SitePlanner` (`SitePlanner.jsx:1796`) runs to ~line 22,913 — **21,117 lines**, of which
  ~15,950 are hooks and handlers and **5,166 are one JSX return** (`SitePlanner.jsx:17748`+), holding
  **1,367 JSX tags**. Hook census: **211 `useState` · 125 `useRef` · 77 `useEffect` · 38 `useMemo` ·
  25 `useCallback` · 5 `useLayoutEffect`.**
- **VIOLATION**, and it is the frame in which most of the rest of this section sits.
- **GROWS? YES** — and this is the amplification mechanism itself: a bigger scene means a dearer render,
  and *every* state change pays the whole thing.

### 3.2 ⛔ Render scope of a single state change — the panel bodies
- **Best practice:** a leaf state change must not rebuild unrelated subtrees.
- **Planyr:** `renderPanelBody` (`SitePlanner.jsx:15933`) is a **called render function**, not a mounted
  component — invoked at `SitePlanner.jsx:22251` for the docked panel and again at
  `SitePlanner.jsx:22271` **once per floating panel**. Every one of those invocations rebuilds its whole
  JSX tree on every render of `SitePlanner`. (The function form is deliberate and correct for
  MODULE-SCOPE-COMPONENTS — a mounted component would remount on drag — but it means there is no memo
  boundary anywhere in the panel tier.)
- **VIOLATION.** This is B1351, filed and not implemented.
- **Cost — MEASURED (NEW-2), and this is one of the audit's three headline axes:**

  | panels open | work per identical gesture | script | layout | style | long tasks |
  |---:|---:|---:|---:|---:|---:|
  | 0 | 2,101 ms | 1,676 | 182 | 243 | 0 ms |
  | 1 | 1,971 ms | 1,618 | 157 | 196 | 113 ms |
  | 2 | 2,254 ms | 1,861 | 169 | 223 | 307 ms |
  | 3 | 2,736 ms | 2,231 | 254 | 251 | 518 ms |
  | 4 | 2,824 ms | 2,359 | 193 | 272 | 645 ms |

  **+34.4% for four panels open (r = 0.914) against a ±11.1% floor**, and **the rise is almost entirely
  script** (+683 ms) with layout and style roughly flat. `canvasNodes` is pinned at **976 at every
  rung** — **the drawing did not change; only the panels did.** Long-task time going 0 → 645 ms is the
  same fact expressed as blocked input.
- **GROWS? YES, directly with panels open** — one of the axes that rises through a session and resets on
  reload.

### 3.3 `React.memo` boundaries
- **Best practice:** memo boundaries at the points where props genuinely do not change.
- **Planyr:** **exactly one in `src/`** — `ElNode` (`SitePlanner.jsx:23627`), added by B1352. Its own
  header states honestly that it **cannot help a pan or a zoom** (3.4). There is **no memo boundary on
  the panel tier at all**, which is what 3.2 measures.
- **VIOLATION** (partial — the element tier is done, the panel tier is not).
- **GROWS? YES** — the missing boundary's cost is 3.2's.

### 3.4 ⛔ Memo dependency arrays that include the MODEL OBJECT
- **Best practice:** a memo keyed on an object that changes identity on every edit caches nothing after
  the first edit.
- **Planyr — and the owner named this one exactly right, but the finding is sharper than the
  hypothesis.** Two distinct patterns, and conflating them would misdirect the fix:
  - **Keyed on `els` (the model array).** `resolveElNeighbors` (`SitePlanner.jsx:9316`), `roadNet`
    (`SitePlanner.jsx:17244`), `teeJunctions` / `driveJunctions` / `weldJunctions`
    (`SitePlanner.jsx:17232`–`17237`). Every edit re-identifies `els`, so **every one of these
    recomputes on every edit** — and `resolveElNeighbors` is O(n²) (see 9.1). This is real, and it is
    paid **once per edit**, not once per frame.
  - **Keyed on `view` — the far worse one.** `cullRect` (`SitePlanner.jsx:2065`) depends on `view`, so it
    changes **every frame of every pan and zoom**, and with it `drawEls` (`SitePlanner.jsx:13040`),
    `drawMarkupsZ` (`SitePlanner.jsx:17211`) and `drawParcels` (`SitePlanner.jsx:17229`) — three O(n)
    passes per frame — plus `labelFrame` (`SitePlanner.jsx:2060`) and `f2p` itself
    (`SitePlanner.jsx:4299`), which is what invalidates `ElNode` for 100% of elements (2.2).
- **VIOLATION**, on both counts.
- **Cost — MEASURED (NEW-2):** the `view`-keyed half is inside the 1,603 ms of script at rung 0. The
  `els`-keyed half is what the **edit-recovery test** (NEW-2 axis (d)) exists to price; its result is
  quoted in the run output rather than predicted here.
- **GROWS? YES for both** — the `view`-keyed memos are O(elements) per frame; the `els`-keyed ones are
  O(n²) per edit, and both n and the edit count rise all session.

### 3.5 Effect cascades (effect sets state → triggers effect → sets state)
- **Best practice:** an interaction should cost one render pass, not a chain of them.
- **Planyr:** the registration effect (`SitePlanner.jsx:2751`) calls `setRegShift`, which re-renders,
  which re-runs the layout effect. It is guarded — `REG_EPS_PX` (`SitePlanner.jsx:3253` region) makes the
  write a no-op below a sub-pixel floor, and **B1189 already had to fix a fifty-render abort** on exactly
  this path.
- **PASS (guarded), with a standing hazard flagged.** The guard is load-bearing and the failure mode when
  it slips has taken the planner down once.
- **GROWS?** No, once the epsilon guard holds.

### 3.6 Context values recreated per render
- **Best practice:** a context value rebuilt each render re-renders every consumer.
- **Planyr:** the planner passes props, not context, for canvas state. `ThemeProvider` is the only
  workspace-wide context and its value changes on theme change only.
- **N-A / PASS.**

### 3.7 Unstable keys forcing remounts
- **Best practice:** keys must be stable identities, never array indices over a reorderable list.
- **Planyr:** element keys are `el.id` (`SitePlanner.jsx:23590`); markup and measurement keys are ids;
  measurement sorting explicitly preserves `i` as selection identity while reordering the DOM
  (`SitePlanner.jsx:17224`). Index keys appear only in fixed-length literal arrays (the shortcuts sheet).
- **PASS.**

### 3.8 Handler identity stability
- **Best practice:** fresh arrow props defeat any memo below them.
- **Planyr:** `elHandlers` (`SitePlanner.jsx:17204`) is a latest-ref bundle with an empty dependency list,
  refreshed in a layout effect — deliberately chosen over `useCallback` because a missed dependency there
  is a *stale handler*, which is worse than a slow render.
- **PASS**, and the reasoning is recorded at the site.

---

# (4) EVENTS

### 4.1 Passive vs non-passive on wheel/touch
- **Best practice:** listeners should be passive unless they call `preventDefault`.
- **Planyr:** `wheel` is registered `{ passive: false }` (`SitePlanner.jsx:4780`) — **correct**, it
  cancels the browser's own zoom. Touch handlers are React's, which are passive; the canvas sets
  `touch-action: none` so nothing needs cancelling (`SitePlanner.jsx:3214` note).
- **PASS.**

### 4.2 `setState` in hot pointer paths
- **Best practice:** a pointer move must not re-render the world.
- **Planyr:** two different disciplines, and only one of them is applied:
  - The **cursor readout** is coalesced to one commit per frame —
    `scheduleFrameJob("cursor", () => setCursor(fp))` (`SitePlanner.jsx:6439`), with `lastPtrFt` /
    `lastPtrClient` kept **ref-only** so nothing else in the hot path commits.
  - The **pan** is not: `setView(...)` is called **directly on every `pointermove`**
    (`SitePlanner.jsx:6530`), outside `scheduleFrameJob`.
- **VIOLATION (partial).** In practice Chrome already delivers `pointermove` at rAF cadence, so the pan
  path is roughly one commit per frame anyway — but it is one commit per frame **by the browser's grace,
  not by design**, and it is the one path with no coalescing guard of its own.
- **Cost — ESTIMATED:** ~0 on Chrome desktop today; a real risk on any input path that outpaces rAF.
- **GROWS?** No — but every commit it makes costs 3.2's panel rebuild, so its *consequence* grows.

### 4.3 `getCoalescedEvents`
- **Best practice:** use it when you need sub-frame input fidelity (inking); ignore it otherwise.
- **Planyr:** not used. For pan/zoom, the *last* position is the only one that matters — coalescing
  would add work, not remove it.
- **N-A**, deliberately.

### 4.4 Listeners on `document`/`window` vs the element
- **Best practice:** scope listeners to the element; global listeners cost every dispatch.
- **Planyr:** ~20 `addEventListener` sites, all in effects with matching cleanup. Drag listeners are
  window-scoped **on purpose** (`SitePlanner.jsx:4680`) so a drag survives leaving the element, and they
  are added on gesture start and removed on end.
- **PASS.**

### 4.5 Do document-level listeners accumulate as panels and overlays open?
- **Best practice:** every listener added on open must be removed on close.
- **Planyr:** **MEASURED (B1432), and this one is settled rather than argued:** renderer-wide
  `JSEventListeners` moved **+8 across 1,000 gestures**, and a naive add-minus-remove count that read
  "+22 per gesture" was shown to be **wrong by a factor of twenty** (it never sees `{once:true}` or
  `AbortSignal`-scoped detachment).
- **PASS.**

---

# (5) MEMORY AND GC

### 5.1 Allocation churn per gesture
- **Best practice:** avoid per-frame allocation in the hot path; reuse buffers.
- **Planyr:** MEASURED (B1433) — **~130 KB of garbage per gesture, 0.9–2.1 KB retained.** Every frame
  builds fresh `{x,y}` objects through `f2p` (141 call sites) and fresh arrays through the three cull
  memos.
- **VIOLATION (minor).** 130 KB/gesture is well inside what a generational collector handles in the
  young generation.
- **GROWS? YES, linearly with elements** — but the allocation is a symptom of 2.2, not an independent
  problem, and fixing 2.2 removes most of it.

### 5.2 ⛔ Does major-GC pause time scale with the LIVE SET? — the item's sharpest memory question
- **Best practice:** a large live set makes every major GC dearer, independent of allocation rate.
- **Planyr:** **the owner's tab is ~278 MB against a 4,192 MB ceiling; the probe's is 17 MB.**
  **The probe never enters his GC regime at all** — that is stated as a fact about the instrument, not a
  finding about the app, and it is the single most important caveat in this document.
- **UNRESOLVED — and honestly labelled as such rather than folded into a PASS.** B1433 established that
  nothing *accumulates* (retained heap plateaus, growth is V8 JIT code, zero detached nodes). It did not
  and could not establish what a major GC costs at 278 MB live.
- **Cost — UNMEASURABLE HERE.** Requires his machine. This is what NEW-4's production instrument now
  samples (`heap` in every row).
- **GROWS? YES, by construction** — the live set is the session.

### 5.3 Per-frame array/object reallocation vs reuse
- **Best practice:** reuse, or make the derived value stable across frames.
- **Planyr:** `drawEls` / `drawMarkupsZ` / `drawParcels` reallocate every frame because `cullRect` does
  (3.4). `drawElsZ` (`SitePlanner.jsx:17187`) copies and sorts `drawEls` — but only when `drawEls`
  changes, and NEW-4(b) already collapsed two sorts into one.
- **VIOLATION**, same root as 3.4.

### 5.4 Undo generations holding model references
- **Best practice:** a bounded history with structural sharing.
- **Planyr:** `createHistoryStack({ limit: 80 })` (`lib/history.js:18`) — **bounded**, and snapshots share
  unchanged element objects, so a frame costs only what the edit changed. `histKey`
  (`SitePlanner.jsx:4103`) is a `JSON.stringify` of the whole model — **not** called on push, only on
  undo, and NEW-4(d) already hoisted it out of undo's dedup loop.
- **PASS.** The undo stack is not the leak, and it is worth recording that it was checked.

---

# (6) NETWORK

### 6.1 Tile fetches per gesture
- **Best practice:** a pan should not re-fetch what it already has.
- **Planyr:** MEASURED (B1434) — **~6 tile fetches per gesture at dpr 1, ~8 at dpr 2**; 6,084 and 7,943
  served across 1,000 gestures while retention stayed at 38 and 107. **Each is a decode plus a texture
  upload that is then discarded** — at retina roughly 2 MB of decode work per gesture.
- **VIOLATION (churn, not accumulation)**, and B1434 already scoped it precisely: the rate at gesture
  1,000 equals the rate at gesture 1, so **it cannot explain "fast after reload, slow two minutes
  later"** — but it is a genuine per-interaction cost **and it is invisible to every JS profile the
  speed program owns.**
- **GROWS?** **No** with session length. **Yes** with display density (~4× at retina, by `detectRetina`
  design — the sharp-aerial trade `lib/tileBudget.js` makes deliberately and the owner's constraint
  protects).

### 6.2 The 6-connections-per-host limit — does tile traffic starve GIS/Supabase?
- **Best practice:** keep a hot media stream off the same origin as latency-sensitive API calls.
- **Planyr:** tiles come from external basemap hosts, GIS from ArcGIS hosts, data from Supabase — **three
  different origins**, so the per-host pool is not shared. HTTP/2 multiplexes anyway.
- **PASS.** The answer to the item's question is **no**.

### 6.3 Request cancellation on pan — are abandoned tiles still decoded?
- **Best practice:** cancel in-flight work the user has panned away from.
- **Planyr:** GIS/API fetches are properly `AbortController`-bounded (`lib/arcgis.js:38`,
  `lib/ebfe.js:132`, `lib/elementApi.js:24`, `lib/elevation.js:20`). **Tiles are Leaflet's `<img>` loads**,
  which the app does not cancel — Leaflet prunes the element, and the browser decodes whatever already
  arrived.
- **VIOLATION (minor), and the honest reading is that it is Leaflet's to own.** Not worth a fix against
  the evidence: retention is flat (38 / 107) and B1433 showed the cache is doing its job.
- **GROWS?** No.

### 6.4 HTTP cache headers on tiles and GIS responses
- **Best practice:** long-lived immutable caching on tiles; short revalidation on GIS.
- **Planyr:** tiles are third-party — **their headers are not ours to set.** GIS responses ride the
  app's own stale-while-revalidate policy (`lib/factRevalidation.js`), which serves the cached pull
  instantly and refreshes only on a user action, never on a map view change (KEY DECISION, B860), and
  always displays the data's age.
- **PASS**, with the third-party half marked N-A.

---

# (7) COMPOSITING AND GPU

### 7.1 Layer count — is 112–114 justified?
- **Best practice:** each compositor layer costs texture memory and upload bandwidth; promote
  deliberately.
- **Planyr:** MEASURED (B1433) — **7 layers with imagery absent · 43–45 at dpr 1 with tiles ·
  112–114 at dpr 2**, and **flat across 1,000 gestures** in all three regimes. The count is dominated by
  Leaflet's tile `<img>` elements, which is inherent to a tiled basemap, and at retina it is ~4× because
  `detectRetina` fetches one zoom level deeper.
- **PASS — the answer to the item's question is yes, they are justified**, in the sense that they are one
  per tile and the tile count is the deliberate retina trade. They are numerous and **they do not
  multiply with interaction.**
- **GROWS?** No with session; yes with display density.

### 7.2 `will-change` / `translateZ` / opacity promoting layers
- **Best practice:** promote only what actually animates, and un-promote when it stops.
- **Planyr:** **zero `will-change` anywhere.** One `translate3d` (`SitePlanner.jsx:3046`), on the basemap
  wrapper during a gesture — exactly the right use.
- **PASS**, and notably restrained.

### 7.3 Overdraw from stacked translucent layers
- **Best practice:** translucent stacks multiply fill cost.
- **Planyr:** the layer model stacks GIS bands under/over the plan, and **B1424 is the owner's own report
  of exactly this** — *"ten layers on and nothing recedes."* That item owns the visual half.
- **VIOLATION (owned elsewhere).** MEASURED (NEW-2): the raster/paint residual is ~13–15% of a frame
  (B1360) — real but not the mechanism.
- **GROWS? YES with layers enabled.**

### 7.4 Texture upload bandwidth at dpr 2.15
- **Planyr:** MEASURED (B1433) — raster proxy **35.62 → 36.12 MB** across 1,000 retina gestures (layer
  area × 4 bytes; a proxy, not a GPU-memory read — no CDP domain exposes that). ~2 MB of decode per
  gesture at retina (6.1).
- **PASS on accumulation, VIOLATION on churn** — same finding as 6.1, same cause.

### 7.5 Layers exceeding max texture size
- **Planyr:** the canvas is viewport-sized; tiles are 256/512 px. Nothing approaches a 4,096–16,384 px
  limit.
- **PASS.**

---

# (8) MAIN-THREAD ARCHITECTURE

### 8.1 Heavy geometry off the main thread
- **Best practice:** polygon booleans, contouring and hydrology belong in a worker.
- **Planyr:** **only two workers exist** — `lib/terrainLayers.js:43` (terrain) and
  `lib/dxf/dxfOverlay.js:10` (DXF parse). **Clipper polygon ops, the road dissolve (`roadNet`,
  `SitePlanner.jsx:17244`), pond contours, `detentionRules`, `floodplainMitigation` and the label layout
  all run on the main thread.**
- **VIOLATION.** B1353 is filed for the detention/floodplain half and not implemented.
- **Cost — MEASURED (B1360):** Clipper 0.8% and `roadNetwork` 1.1% of a *zoom* frame — small, **because
  they are memoised on `els` and a zoom does not change `els`.** They are paid **on every edit**, which
  is where the amplification lives, not on every frame.
- **GROWS? YES with elements, on the edit path.**

### 8.2 Long tasks blocking input
- **Planyr:** MEASURED (NEW-2) — long-task total per gesture rises **53 ms with no panel open → 729 ms
  with three**, on identical content. That is the 3.2 mechanism showing up as blocked input.
- **VIOLATION**, same root as 3.2.
- **GROWS? YES.**

### 8.3 Scheduling (`requestIdleCallback`, `scheduler.yield`)
- **Best practice:** defer non-urgent work to idle, with a timeout so it cannot starve.
- **Planyr:** used well — `modulePrefetch.js`, the drainage facts pass (`SitePlanner.jsx:10866`) with a
  hard ceiling, and `SitePlanner.jsx:3133`. Every one carries a `timeout` so it cannot be starved
  forever. `scheduler.yield` is not used (limited support).
- **PASS.**

### 8.4 `OffscreenCanvas`
- **N-A.** The renderer is SVG, and B1360 records why canvas/WebGL is **rejected structurally**:
  `buildExportSvg` clones the live SVG, 54 of 65 e2e specs read `planner-canvas`, 39 `data-*` names are
  the test contract, and the accessibility tree *is* the SVG.

---

# (9) ALGORITHMIC

### 9.1 ⛔ `resolveElNeighbors` is O(n²) and runs on every edit
- **Best practice:** resolving each item's neighbours across a collection should be indexed, not scanned.
- **Planyr:** `resolveElNeighbors` (`SitePlanner.jsx:23054`) loops every element and, **per element**,
  calls `curbEdgesOf` (which calls `sidewalkBetween` → `.some()` over all elements,
  `SitePlanner.jsx:1152`), `list.filter(...)`, `list.find(...)` and `dimSlideFor` (→ `bumpsAlongLength`
  → another full scan, `SitePlanner.jsx:23015`). That is **four full scans per element** — O(n²) with a
  constant of four.
- **VIOLATION.** Note carefully: **B1352 was right to build it.** Hoisting this out of the per-frame
  render was worth **8.6% of all script self-time in a zoom frame** (MEASURED, B1360). The residue is
  that it is now paid once per *edit* instead of once per *frame*, and it is still quadratic.
- **Cost — ESTIMATED:** at 62 elements, 4 × 62² ≈ 15,000 comparisons per edit — negligible. At 400
  elements, ≈ 640,000 — the point at which an edit stops feeling instant. The owner's heaviest plans are
  the ones that matter and the sandbox cannot open them.
- **GROWS? YES, QUADRATICALLY with elements, on every edit.**

### 9.2 `computeBuildingGrid` recomputed per building per frame
- **Best practice:** derived geometry that does not depend on the view must be cached by a geometry hash,
  not recomputed in the render.
- **Planyr:** `computeBuildingGrid(...)` — a bay-count search over the footprint — is called **inside
  `renderElPx`** at `SitePlanner.jsx:23428` and again in the reshape path at `SitePlanner.jsx:23160`,
  gated on `settings.showDocks || settings.showGrid`. **Both default to `true`**
  (`SitePlanner.jsx:1740`, `SitePlanner.jsx:1745`). Its inputs are the footprint and the settings —
  **nothing view-dependent** — yet it runs for every building on every frame of every pan and zoom.
- **VIOLATION**, and it is the same class of mistake B1352 fixed for `curbEdgesOf`, in a place B1352
  did not reach.
- **Cost — MEASURED (NEW-2), and this is the FIRST RUNG of the top-ranked axis:** turning the first drawn
  layer on (dock doors — which is what arms this whole block) takes the identical gesture from
  **1,804 ms → 2,208 ms (+22%)** on the reference plan's 20 buildings.
- **GROWS? YES, linearly with buildings — and it is default-on, so every plan pays it.**
- **FIXED IN THIS DISPATCH, and PROVEN on the same probe at the same rungs** (see "The fix, measured"
  at the end of this document). The whole view-independent dock plan is resolved once per
  model/settings change into B1352's neighbour record instead of once per frame per building.
  Byte-identical by construction.

### 9.3 Multi-select move: `map` with a `find` inside
- **Planyr:** `SitePlanner.jsx:6566`–`6570` maps every element and calls `d.orig.els.find(...)` inside
  the map — O(n × m) per drag frame, where m is the selection size.
- **VIOLATION (minor).** A `Map` built once outside the loop makes it O(n).
- **GROWS? YES with elements × selection size.**

### 9.4 Hit-testing without a spatial index
- **Best practice:** a spatial index for hit-testing large scenes.
- **Planyr:** hit-testing is the **browser's** — each element is a real SVG node with its own
  `onPointerDown`, so the engine's own optimised hit tree does the work. No app-level scan exists to be
  quadratic.
- **PASS.** The answer to the item's question is that the index already exists; it is the DOM.
  (This is also one of the structural reasons canvas/WebGL is rejected in 8.4 — it would mean *building*
  one.)

### 9.5 Viewport culling
- **Planyr:** `lib/viewCull.js` + `cullToView`, with three guards (selection force-kept, unbounded shapes
  never culled, identity on export).
- **PASS** — this is the right mitigation and it is already in place. It does not fix 2.2, because a
  culled scene still re-emits everything that survived the cull.

---

# (10) OBSERVABILITY

### 10.1 Nothing in production measured itself
- **Best practice:** ship an always-on, sampled RUM instrument; you cannot fix what only reproduces on
  someone else's machine.
- **Planyr, before this session:** `grep -rn "PerformanceObserver\|longtask" src/` returned **zero hits.**
  The only production telemetry was `client_errors` — crashes, not speed. The consequence is exactly what
  the owner objected to: **the only way to learn his tab was slow was to ask him to paste a console
  snippet.**
- **VIOLATION — and it is the reason every other row in this table carries a caveat**, because every
  number above comes from a 62-element reference plan on hardware that is not his.
- **FIXED THIS SESSION (NEW-4)** — `src/shared/telemetry/perfInstrument.js`: `longtask` +
  Event Timing/INP + a periodic sample of heap, canvas nodes, **elements drawn, layers on, panels open,
  edits since load, seconds since load** — i.e. the amplification axes themselves — behind the existing
  `reportClientEvent` path, enrolling a quarter of page loads at a hard six rows each, deliberately far
  under the ceiling error reports draw on.

---

# THE RANKED TABLE

Ranked by **(measured or estimated per-frame cost) × (how much it grows with session activity)** — worst
first. "Session growth" is the multiplier a real working session applies before the owner reloads; the
basis for each is `ui-audit/lib/sessionAxes.mjs`'s declared `sessionRise`, so it can be argued with.

| # | Finding | Cat | Cost | Basis | Grows with | Fix size |
|---:|---|:--:|---|:--:|---|:--:|
| **1** | **Layers: every drawn layer costs ~360 ms of a gesture**, and rung 0→1 alone is +22% — the dock/grid solve (#5) is that first rung | 9.2 / 7.3 | **+102.5% across 4 layers, r = 0.775** | **MEASURED (NEW-2)** | **layers enabled** ×8 | small (#5) + B1424 |
| **2** | **The view is baked into every coordinate; a pan re-emits ~1,200 nodes** (`f2p`, `SitePlanner.jsx:4299`) | 2.2 | **+59.9% across +30 elements, r = 0.927**; script 65–72% of a wheel frame; 679 mutations/commit | **MEASURED (NEW-2)** + B1360 | **elements drawn** ×40 | pan: 1 session · zoom: multi (B1360) |
| **3** | **Panel bodies rebuilt on every render; no memo boundary in the panel tier** (`renderPanelBody`, `SitePlanner.jsx:15933`) | 3.2 | **+34.4% at 4 panels, r = 0.914**; the rise is almost all SCRIPT (1,676 → 2,359 ms) on `canvasNodes` pinned at 976; long tasks 0 → 645 ms | **MEASURED (NEW-2)** | **panels open** ×4 | medium (B1351) |
| **4** | **Forced synchronous layout in the registration effect**, dearer as the DOM grows (`SitePlanner.jsx:2992`) | 1.1 | 11.3%→13.1% of script; LayoutDuration +45% at flat LayoutCount | MEASURED (B1359) | **panels + elements + tiles** | medium (B1359) |
| **5** | **`computeBuildingGrid` + `dockDoorRun` re-solved per building per frame** (`SitePlanner.jsx:23428`) — **FIXED IN THIS DISPATCH** | 9.2 | view-independent work inside the render function, **default-on** | MEASURED (NEW-2) + code | **buildings × layers** | small — shipped |
| **6** | **`resolveElNeighbors` is O(n²), re-run on every edit** (`SitePlanner.jsx:23054`) | 9.1 | ~15k comparisons at 62 els; ~640k at 400 | ESTIMATED (code) | **elements² × edits** ×60 | small |
| **7** | **No CSS containment on the panels**, so their DOM joins the canvas's forced layout | 1.4 | layoutObjects 1,620→2,347 (+45%) with 4 panels | MEASURED (NEW-2) | **panels open** ×4 | **very small** — see the note below |
| **8** | **Switching plans leaves the plan you left alive in the renderer** — `rendererNodes` **+93.9 / +97.1 / +96.6 / +95.2%** after A→B→A in four independent runs, while attached node counts returned to normal every time | 5.2 | **MEASURED (NEW-2)**, reproduced 4 of 4 — a signature, not yet a mechanism | **plan switches** ×6 | filed, not fixed |
| **9** | **Heavy geometry on the main thread** (Clipper, road dissolve, detention, contours) | 8.1 | 0.8–1.1% of a *zoom* frame; the real cost is per-edit | MEASURED (B1360) | **elements × edits** | large (B1353) |
| **10** | **Tile churn — ~6–8 fetch+decode+upload per gesture, discarded** | 6.1 | ~2 MB decode/gesture at retina; invisible to every JS profile | MEASURED (B1434) | **display density** (not session) | n/a — by design |
| **11** | **Multi-move `map`-with-`find`** (`SitePlanner.jsx:6566`) | 9.3 | O(n×m) per drag frame | ESTIMATED (code) | elements × selection | trivial |
| **12** | **`setView` uncoalesced on `pointermove`** (`SitePlanner.jsx:6530`) | 4.2 | ~0 on Chrome today (rAF-aligned delivery) | ESTIMATED | — | trivial |
| **13** | **No `vector-effect`; strokes counter-scaled in script** | 2.7 | small today — but it **blocks** #2's zoom half | ESTIMATED (code) | elements | small |
| **14** | **Allocation churn ~130 KB/gesture** | 5.1 | young-generation only; retention 0.9–2.1 KB/gesture | MEASURED (B1433) | elements | falls out of #2 |
| **—** | **Major-GC pause at a 278 MB live set** | 5.2 | **UNMEASURABLE in this sandbox — his tab is 278 MB, the probe's is 17 MB** | — | **the session itself** | NEW-4 now samples it |

**Why #7 (CSS containment) is ranked high and still NOT shipped in this dispatch.** It is two lines and it
is aimed at a measured cost — but `contain: layout paint` establishes a containing block and clips paint,
and the docked panel column hosts anchored menus and popovers that deliberately overflow it. Shipping it
without a pixel check against every one of those is exactly the "fix you cannot demonstrate" B1434 refused.
It is the cheapest next win and it needs its own item, not a drive-by.

**The edit-recovery test, reported because it came back NEGATIVE.** The owner's sharpest hypothesis was
that memo dependency arrays include the model object, so every edit invalidates every memo and the next
gesture pays to re-fill them. Measured: the gesture immediately after an edit cost **10% more** than the
same gesture after a 30-second settle — **inside the ±11–18% floor, so INCONCLUSIVE.** On a 62-element
plan, that hypothesis is not confirmed. It is not refuted for his heaviest plans either, and the axis is
in the probe so it can be re-run there.

### Recorded PASSES (checked, clean, not skipped)

`getBBox`/`getScreenCTM`/text measurement never called (2.3, 2.4) · label declutter is grid-hashed O(n),
not O(n²) (2.5) · filters/masks/clipPaths off the hot path (2.6) · stable keys (3.7) · handler identity
solved without a dependency list (3.8) · wheel correctly non-passive (4.1) · listeners do not accumulate,
**measured** (4.5) · undo history bounded at 80 with structural sharing (5.4) · tiles/GIS/data on
different origins, so no connection starvation (6.2) · GIS fetches abort-bounded (6.3) ·
stale-while-revalidate with visible data age (6.4) · compositor layers flat with interaction (7.1) ·
no gratuitous layer promotion (7.2) · no texture-size violations (7.5) · idle scheduling always has a
timeout (8.3) · hit-testing uses the browser's own index (9.4) · viewport culling present and guarded
(9.5) · effect cascade guarded by a sub-pixel epsilon (3.5).

---

## What this audit deliberately does NOT claim

- **It does not claim to have reproduced the owner's symptom.** B1432 could not, and nothing here does
  either. What it does is name the mechanism by which his session gets dearer as he works — which is a
  different and more useful claim than "we found the leak", because **there is no leak** (B1433 settled
  that with V8's own detachedness flag and forced-GC heap snapshots).
- **Every number above except the NEW-2 measurements comes from a 62-element reference plan, logged out,
  with every external host blocked.** That is a **floor**, not a match. Row 5.2 in particular — GC pause
  time at his 278 MB live set — is beyond every instrument this repo owns, and saying so is the point.
- **The ranking multiplies a measured cost by a declared guess.** The guesses live in
  `ui-audit/lib/sessionAxes.mjs` with their bases attached, precisely so that disagreeing with the
  ranking means disagreeing with a number you can point at.

---

# The fix, measured — before and after, same probe, same rungs, same machine

The audit's rule for itself is B1434's: **do not ship a fix you cannot demonstrate on the probe.** So the
one fix shipped here (#5 — the per-building dock plan) was measured with `ui-audit/session-axes.mjs`
against two builds of the app served side by side, differing **only** in that change, run back to back.

### The axis the fix targets — LAYERS

| rung (drawn layers on) | before | after | Δ |
|---|---:|---:|---:|
| 0 — none *(control: the code path is not armed at all)* | 1,804 ms | 1,812 ms | **+0.4%** |
| 1 — dock doors | 2,208 ms | 2,130 ms | −3.5% |
| 2 — + column grid | 2,059 ms | 1,959 ms | −4.9% |
| 3 — + dimensions | 2,111 ms | 1,897 ms | −10.1% |
| 4 — + areas *(the product's own default state)* | **3,652 ms** | **2,117 ms** | **−42.0%** |
| **ladder verdict** | **GROWS, +102.5%** (360 ms/layer, r = 0.775) | **UNSUSTAINED** — the trend is gone | |

Long-task time at rung 4 went **1,348 ms → 59 ms**.

**Read rung 0 first.** It is the control: with every drawn layer off, `showDocks || showGrid` is false and
the changed code never executes. It comes back within **0.4%**, which is what says the two builds are
otherwise the same program and the rest of the column is the fix rather than the weather.

**And read the honest caveat with it.** The per-rung deltas at rungs 1–3 (−3.5%, −4.9%, −10.1%) are each
inside the ±11–13% floor on their own; the strong number is rung 4, and rung 4's *before* value was the
highest single reading in that ladder. The defensible claim is the one the harness itself makes: **the
axis went from a sustained upward trend to no trend at all.** The defensible claim is *not* that every
individual rung improved by a measurable amount.

### The axis it also helps — ELEMENTS

| | before | after |
|---|---:|---:|
| rise across 66 → 96 elements | +59.9% | **+42.5%** |
| per element | 38.53 ms | **32.47 ms (−16%)** |
| r | 0.927 | 0.976 |

Every building added to a plan was paying for its own column-grid solve on every frame; now it pays once
per edit. That is why the *slope* of the elements axis falls even though the axis itself still grows —
the rest of that slope is finding #2, the view baked into every coordinate, which this does not touch.

### The control axis it should NOT change — PANELS

| | before | after |
|---|---:|---:|
| rise across 0 → 4 panels | +34.4% | +36.0% |
| per panel | 221 ms | 228 ms |

Unchanged, which is the right answer: the panel tier is a different mechanism (finding #3, B1351) and a
fix that "improved" it too would have been a reason to distrust the whole comparison.
