# Programme — decomposing `SitePlanner.jsx` by STATE OWNERSHIP

**Item:** B287058 · **Status:** filed, deliberately NOT started · **Precondition:** B217538's counter
gate green (it is — see §5) · **Written:** 2026-08-09

> ⛔ **THIS DOCUMENT IS THE WHOLE OF B287058's FIRST STEP.** The owner's instruction was explicit:
> *"THIS SESSION: write the programme doc and the slice order ONLY. Do not start moving state."*
> No state has been moved. No slice has been started. If you are reading this in a later session,
> §6 is where the work begins, and §4 is the gate every slice has to pass through.

---

## 1. The measurement, not the impression

Taken on `main` at `ae2ce02`, 2026-08-09:

| | |
|---|---|
| `SitePlanner.jsx` | **27,146 lines** |
| The `SitePlanner` component's own body (L1797–L23867) | **22,070 lines** |
| `useState` **inside that one function** | **206** (215 in the file) |
| `useEffect` | **80** (83) |
| `useRef` | **132** (136) |
| `useMemo` | **41** |
| `useCallback` | **30** |

Every one of those 206 state cells is a re-render trigger for a 22,000-line render body. There is no
boundary anywhere inside it, so **the granularity of "what changed" is the entire component.**

## 2. Why this is the MECHANISM and not a tidiness complaint

The two facts that make this an engineering item rather than an aesthetic one:

**(a) Moving the mouse writes model state's neighbours.** `cursor`, `hoverElId`, `hoverMkId`,
`view`, `panning`, `marquee` and `size` sit in the same 206-cell pool as `els`, `parcels`,
`measures`, `markups`, `settings` and `county`. A pointer move therefore re-runs the same render
body that owns the plan. Measured by B217536's detector: **a 60-move pan produces 186–187 renders of
`SitePlanner`,** a little over three per `pointermove`.

**(b) Everything that body calls un-memoised runs 186 times with it.** That is not a hypothesis; it
is the entire finding list of this programme:

| Instance | What re-ran because the VIEW moved | Fixed by |
|---|---|---|
| 1 | element pixel geometry (`f2p` took the live view) — 101,267 DOM mutations per gesture | B1440 |
| 2 | the pond LABEL FIT, re-solved per frame, in feet | B221761 |
| 3 | the cull rect, `regionPathD`, the polyline caches, `furnPlates`, `stdApplyCount` | B217537 |
| 4 | pond STAGE STORAGE — `pondSplitFor` as a plain arrow, **275,184 `offsetInward` calls in one pan** | B236592 |

Four instances. Four hand fixes, one call site at a time, each found by a human reading code (twice)
or by an instrument built after the fact (twice). **The file guarantees a fifth**, because nothing
about its structure makes instance five harder to write than instance one was.

## 3. The target: a boundary, not a smaller file

**The goal is NOT fewer lines.** It is that a view change becomes **structurally incapable** of
touching model-derived work — the same invariant B217538's guard asserts from the outside, moved
inside the architecture so it holds by construction instead of by a test.

Two stores, split by who WRITES them:

- **VIEW store** — written by gestures, read by the renderer. `view`, `renderView`/`viewAnchor`,
  `size`, `cursor`, `panning`, `spacePan`, `smoothZoom`, `hoverElId`, `hoverMkId`, `hoverChipId`,
  `marquee`, `narrow`, `leftWidth`. Changes many times a second.
- **MODEL store** — the plan. `els`, `parcels`, `measures`, `callouts`, `markups`, `sheetOverlays`,
  `settings`, `county`, `easeRules`, `floodRules`, `xsec`, `drainCtx`. Changes on an EDIT.

Everything else (menus, drafts, tool modes, save status, lookup results — roughly 150 of the 206) is
**UI-LOCAL** and belongs to whichever panel owns it; most of it should never have been in this
component at all, and moving it costs nothing analytically.

The property that has to hold at the end, stated so it can be checked rather than admired:

> **A write to the VIEW store may not invalidate any memo whose inputs are MODEL + SETTINGS.**

## 4. ⛔ The gate every slice passes through, and why it is a COUNTER

**B267539's lesson, and it is not negotiable:** a guard that measures a DURATION passes the moment a
computation that should not run at all merely gets cheaper. A slice that moves state but leaves the
invalidation graph intact will look like a small speed-up and read as a success.

So every slice is landed against **invocation counts**, from the instruments that already exist:

1. `npm run perf:viewindep` — the gate. Fails if any registered computation runs more than once
   during a pure pan, **and fails if a registered one is never observed** (that is how this shape of
   guard rots).
2. `npm run perf:recompute` — the detector, on all four arms (pan · zoom · single-element edit ·
   panel open/close), **before and after each slice**, with the two counts on the item.
3. `test/viewIndependentRegistry.test.js` — the CI-runnable half.

**A slice's acceptance criterion is `after ≤ before` on every counter, with at least one counter
strictly lower, and no registered computation dropping out of observation.** A slice that only moves
code and changes no count is allowed — it is scaffolding, and it must SAY so on the item rather than
claim a win.

**Additionally, each slice grows the registry.** A slice that relocates state without registering
the promise it just made has bought a refactor and no guarantee.

## 5. The precondition, verified rather than assumed

The owner's brief made this work conditional on a green invocation counter. Checked on this branch,
2026-08-09:

- `npm run perf:viewindep` → ✅ **14 of 14 registered computations observed, every one ran at most
  once.**
- Mutation-proven **independently, not taken on trust**: disabling the cull latch in
  `lib/viewCull.js` takes it to **four failures at 186 calls each** (`drawEls`, `drawElsZ`,
  `drawMarkupsZ`, `drawParcels`) and the gate **exits 1**. Reverted.
- `test/viewIndependentRegistry.test.js` (19) + `test/recomputeProbe.test.js` (39) green.

**The precondition is met. This programme is unblocked.**

## 6. The slice order

Ordered by *(risk of getting it wrong) ÷ (invalidation pressure removed)* — cheapest and most
provable first, so the instrument's credibility is established on slices that cannot lose data.

| # | Slice | What moves | Why here | Counter that must move |
|---|---|---|---|---|
| **0** | **Registry pre-pass** | nothing | Register the memos the later slices will disturb, so a regression during the programme is caught by the guard rather than by the owner | none — coverage only |
| **1** | **Hover** | `hoverElId`, `hoverMkId`, `hoverChipId` | Highest write frequency, lowest consequence: a wrong hover is visible instantly and loses nothing. The honest first proof. | `perf:recompute` pan arm |
| **2** | **Cursor + readout** | `cursor`, `secondsInRoute`-adjacent readout state | Written on every `pointermove`; B217541 (the frozen coordinate readout) is an OPEN bug in exactly this state and should be fixed as part of the move, not before it | pan + zoom arms |
| **3** | **Viewport** | `view`, `renderView`/`viewAnchor`, `size`, `panning`, `spacePan`, `smoothZoom`, `marquee` | **The slice this programme is FOR.** Everything before it is rehearsal. | pan + zoom arms; `perf:viewindep` must stay green throughout |
| **4** | **Chrome/layout** | `leftWidth`, `narrow`, `leftPanel`, `floating`, `propsCollapsed`, `mobileTools` | Cheap, and it is what makes the panel arm meaningful | panel open/close arm |
| **5** | **Menus + drafts** (~40 cells) | `*Menu`, `*Draft`, `tool*`, `numEdit`, `mkRect`, `mkPoly` | Pure removal of noise from the body; no analytical claim | none — scaffolding |
| **6** | **Model** | `els`, `parcels`, `measures`, `callouts`, `markups`, `sheetOverlays` | **Last, and by a long way the most dangerous** — see §7 | **edit arm**, which is where B217540's 660 ms lives |

**Slices 1–5 are additive and independently revertable. Slice 6 is not, and it does not start until
1–5 have landed and held.**

## 7. ⛔ What makes slice 6 different, named rather than hand-waved

`els`/`parcels` are the owner's plan. Three named rules bear on any change to how they are held, and
none may be relaxed to make a slice land:

- **ROWS-CANONICAL-ON-SEED** (B1113) — the seed/journal/cache reconciliation reads this state
  directly. A store boundary that changes WHEN the seed folds is a data-loss bug, not a perf bug.
- **TOMBSTONE-DELETES** — the full cascade set must still be recorded before the next flush.
- **LOUD-FAILURE** — no slice may convert a write failure into a silent no-op.

And the open item that must be read first: **B217540** — one building drag re-migrates and
re-serialises the whole plan (`createSiteModel` 80× · `normalizeBondedChildren` 80× · `loadSite` 40×
· `saveSite` 20×). **B217540 should be fixed BEFORE slice 6, not by it.** It is a persistence-layer
invalidation defect that a state-ownership split would otherwise inherit and hide.

## 8. What this programme is NOT

- **Not the deferred single-reducer rewrite.** `/CLAUDE.md` → DEFERRED still holds: this is
  extraction by ownership, incremental and revertable, not one reducer for 206 cells.
- **Not a bundle-size item.** B1064 owns the bytes.
- **Not licence to touch geometry.** No engineering number changes in any slice. Where a slice
  passes near pond storage, `pondStorageGoldenMaster`'s exact-equality assertions are the arbiter
  (see B287059).

## 9. Estimate, stated honestly

Slices 0–2 are one session each. Slice 3 is **its own session with its own live verification** —
it is the pan/zoom path, and B1449's history says that path punishes optimism. Slices 4–5 are one
session together. Slice 6 is **not estimable until B217540 is fixed**, and pretending otherwise is
how a programme like this ends up half-landed.
