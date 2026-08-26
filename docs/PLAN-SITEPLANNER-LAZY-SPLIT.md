# Scoping — splitting `SitePlanner.jsx` by LOAD WEIGHT (the lazy-panel axis)

**Item:** B1064 · **Status:** scoping only, nothing built this pass · **Written:** 2026-08-26

> ⛔ **THIS DOCUMENT IS SCOPING ONLY.** Owner instruction, verbatim: *"I'm good with proceeding
> with splitting it up... obviously, we gotta do it strategically because... something like the
> layers panel is pretty important... when I'm using the site plan."* He approved scoping the
> split, not building it. No panel has been extracted by this document. If you are picking this
> up to implement, §6 is the tranche order and §4 is the measurement gate every tranche must
> clear before it ships.
>
> **This is the bundle-weight axis, not the re-render axis.** `docs/PLAN-SITEPLANNER-DECOMPOSITION.md`
> (B287058) is a separate, already-scoped, not-started programme that splits the same file by
> STATE OWNERSHIP, to stop a mouse move from re-running a 22,000-line render body. That
> programme explicitly disclaims byte weight ("Not a bundle-size item. B1064 owns the bytes.").
> This document is the other half. They touch the same file and are cross-referenced where they
> interact (§6, tranche E) but neither substitutes for the other.

---

## 0. The bar, and why it's the bar

Owner-set reference measurement, taken on production `planyr.io` for the already-shipped Layers
panel (B1064 tranche c, merged today as #1187): opening Layers cold after a hard reload fetches
`LayerPanel-KbPjlFAm.js`, **9,633 bytes, 29 ms**, panel renders complete. **29 ms is imperceptible.**
That is the standard every tranche below is measured against — not "did bytes go down," but "does
opening this panel feel the same as before."

A tranche that cannot clear something close to that bar does not get shipped as a bare lazy load —
it either stays in the boot path, or ships with a prefetch so the fetch happens before the click,
never after it.

## 1. Ranked inventory — what's actually in the boot path, measured

### 1.1 How this was measured

`npm ci && npx vite build --sourcemap`, then a source-map byte-attribution pass over
`SitePlannerApp-<hash>.js.map` using the repo's own VLQ decoder
(`ui-audit/lib/sourceMapIndex.mjs`) — for every generated line, each mapped segment's span is
charged to its source file. This is exact for what it measures (minified bytes per source file
inside the real production chunk, today); it is not a guess or a stale backlog figure. The
one-off attribution script is not committed (scratch tooling); `npm run perf:bundle`
(`ui-audit/perf-bundle-audit.mjs`) is the standing, CI-gated version of the route/chunk totals
and reproduces the top-line numbers below.

**Route + chunk totals, measured today:**

| metric | value | ceiling | target | note |
|---|---|---|---|---|
| `bundle.siteRouteJsBytes` | **2543.5 KB** | 2611.8 KB | 1562.5 KB | gap to target: **981.0 KB** |
| `bundle.largestChunkBytes` (`SitePlannerApp`) | **1611.8 KB** | 1638.2 KB | — | this is the chunk containing `SitePlanner.jsx` |
| Site route chunk count | 7 | 8 | — | `SitePlannerApp, index, map-vendor, AppHeader, hitTest, userPrefs, cjs-interop` |

**Inside the `SitePlannerApp` chunk (1645.2 KB generated, 1641.0 KB attributed), the largest source files:**

| source file | minified bytes in this chunk | % of chunk |
|---|---|---|
| `SitePlanner.jsx` | **824.9 KB** | **50.2%** |
| `MapFinder.jsx` | 56.5 KB | 3.4% |
| `lib/detentionRules.js` | 45.9 KB | 2.8% |
| `lib/layers.js` | 32.4 KB | 2.0% |
| `shared/gis/sources.js` | 30.1 KB | 1.8% |
| `lib/detentionCriteria.js` | 26.7 KB | 1.6% |
| `lib/jurisdiction.js` | 24.4 KB | 1.5% |
| `lib/floodplainMitigation.js` | 24.1 KB | 1.5% |
| `lib/siteAnalysis.js` (pure lib, distinct from the lazy `SiteAnalysis.jsx` panel) | 21.6 KB | 1.3% |
| `SitePlannerApp.jsx` (the shell/router) | 17.5 KB | 1.1% |
| `lib/buildability.js` | 15.7 KB | 1.0% |
| `lib/vectorLayers.js` | 14.4 KB | 0.9% |
| everything else (≈180 files) | ≈445 KB | 27.1% |

**One number carries the whole story: `SitePlanner.jsx` alone is half the largest chunk.** It is
**824.9 KB** of minified JS in ONE file — up from 581.2 KB measured 2026-07-30 (+42% in under
four weeks; the file is growing faster than it is being trimmed). Source: **30,799 lines,
2.42 MB**. Of that, **lines 1–1952** are module-scope helpers/constants (pure geometry/math,
icons, tool tables — see §6 tranche 0), and **line 1953 to the end (28,846 lines) is ONE
`export default function SitePlanner(...)`** — a single React component whose body runs to the
closing brace at line 30799. **A dynamic `import()` moves a MODULE. It cannot split a
component.** That is the mechanical reason this file resists the exact technique that made the
Layers panel free: there is no module boundary inside it to hang a `lazy()` on until one is cut
by hand.

### 1.2 What's already been split out (no further action — listed so nothing here is re-proposed)

Twelve panels/dialogs are already `React.lazy()`, all following the same shipped pattern
(a `LazyPanel` height-reserving Suspense wrapper + per-panel error boundary — see §5):
`LayerPanel`, `SiteAnalysis`, `ParcelAppraisal`, `ParcelTaxes`, `SetLocationDialog`,
`RoadCrossSectionDialog`, `ParcelRecord`, `PlacementControls`, `PrintCompose`, `StandardsBar`,
`PondSection`, `StoragePanel`. B1064 tranche (a) shipped SiteAnalysis/TeamPanel/StandardsBar
(−20.5 KB `siteRouteJsBytes`, 2026-07-30); tranche (c) shipped LayerPanel (−26.6 KB,
2026-08-26). Combined shipped-to-date: **−47.1 KB**. Against the 981 KB gap to target, this is
real but small — consistent with §1.1's finding that the low-hanging fruit was already picked
and the mass is concentrated in one file that resists the technique.

`MapFinder.jsx` (56.5 KB) is **not a candidate** — prior analysis (B1042, 2026-07-29) found it
mounted in both map mode and plan mode, so deferring it would delay first paint rather than help
it. Not re-litigated here.

### 1.3 What's still inline in `SitePlanner.jsx`'s render body — the real remaining candidates

The component's docked-panel content is centralized in one function, `renderPanelBody(_pid)`
(L19150–L20524, 1,374 lines, gated on the `leftPanel` state machine —
`parcel|yield|analysis|references|standards|null`, default `null`, so **nothing here renders on
first paint today** regardless of what happens next):

| `_pid` branch | lines | est. minified weight* | what it is | how often touched |
|---|---|---|---|---|
| `references` | 322 | ≈ 8.6 KB | Aerial + survey/overlay backdrop manager | Once or twice per plan (setting up the backdrop), not repeated |
| `parcel` | 499 | ≈ 13.4 KB | Parcel/location card — already delegates the heavy parts to the lazy `ParcelRecord`/`PlacementControls`/`ParcelAppraisal`/`ParcelTaxes`; this is the wrapper + the "place this plan" CTA | Early in a plan's life (locating it, checking parcel/tax data), then occasionally |
| `yield` | 258 | ≈ 6.9 KB | Site yield metrics — the app's core value proposition | **Constantly — this is what the product is for** |
| `standards` | 256 | ≈ 6.9 KB | Company-defaults editor (distinct from the already-lazy `StandardsBar` footer) | Rare — set-and-forget per company/plan |
| `analysis` | 28 | (already thin) | Wrapper around the already-lazy `SiteAnalysis` | — |

*Estimated by line-share of the file's measured bytes/line average (824.9 KB / 30,799 lines ≈
26.8 B/line), **not independently source-mapped** — these blocks aren't their own module yet, so
there's no chunk to attribute bytes from directly. This is stated as an estimate, not measured
fact; §4 is how each real number gets confirmed the same way LayerPanel's 29 ms was.

**The honest read of this table: none of these four panels is individually big.** The four sum
to roughly **35 KB** of the file's 824.9 KB — about 4%. Splitting all of them, even perfectly,
does not meaningfully close the 981 KB gap to target. It closes a little of it safely, the same
way tranches (a) and (c) did.

### 1.4 Where the real weight is, and why it's harder

**The "analysis stack"** — six library modules called **synchronously, unconditionally, ~50
call sites in the render body (204 reference sites total)**, regardless of whether the Yield or
pond panel is even open:

| module | KB in this chunk today |
|---|---|
| `lib/detentionRules.js` | 45.9 |
| `lib/detentionCriteria.js` | 26.7 |
| `lib/floodplainMitigation.js` | 24.1 |
| `lib/siteAnalysis.js` | 21.6 |
| `lib/buildability.js` | 15.7 |
| `lib/pondGeom.js` + `lib/pondRouting.js` | 17.6 |
| **total** | **≈ 151.6 KB** |

This is B1064 tranche (b), filed 2026-07-29, **not shipped**. The reason it wasn't shipped is
not effort — it's that these functions feed things OTHER than the Yield panel (watch-out chips,
canvas badges, on-map overlays), so making the panel lazy doesn't remove the calculation from
the synchronous render path; the calculation has to become conditional/gated on its own, which
is a behavior change to detention/floodplain numbers that carry real regulatory weight, not a
pure import-graph change. §6 addresses this directly rather than re-proposing it as easy.

**Below that, the floor is `SitePlanner.jsx`'s own render/interaction engine** — the canvas SVG
drawing, pointer/keyboard handlers, the road/parking/pond geometry math, all of which must be
present the instant a plan opens because drawing the plan IS the product. This is not deferrable
by any `import()` — it's the reason B287058 (state-ownership, not bytes) exists as a *separate*
programme: shrinking this floor is a re-render-frequency problem, not a load-weight one.

**Stated plainly so it isn't discovered later: doing every tranche in this document, including
the risky one, gets `siteRouteJsBytes` from 2543.5 KB to roughly 2543.5 − 35 − 152 ≈ 2357 KB.
That is still ≈ 795 KB above the 1562.5 KB target.** The target was set against an "indivisible
floor" that B1042 already measured and flagged as a policy question, not an execution gap — see
`BACKLOG.md` B329408. This document does not re-open that question; it only makes sure the split
work that IS worth doing gets done without costing Michael responsiveness on the panel he uses
constantly.

## 2. Recommended tranches, cheapest and safest first

| # | Tranche | Weight removed | Risk | Do it? |
|---|---|---|---|---|
| **1** | `references` panel → own file + `lazy()` | ≈ 8.6 KB | Low — same shipped pattern as tranche (a)/(c), occasional-use panel, no shared-state entanglement found | **Yes** |
| **2** | `standards` (defaults editor) panel → own file + `lazy()` | ≈ 6.9 KB | Low — settings-only UI, rare use, no downstream consumers outside itself | **Yes** |
| **3** | `parcel` panel body → own file + `lazy()` | ≈ 13.4 KB | Low-moderate — larger prop surface (origin/location state, the "place this plan" CTA), more threading, still no evidence of cross-panel reads | **Yes, but scope it its own tranche, not bundled with 1–2** |
| **0** | Move the ~1,900-line module-scope pure-helper preamble (geometry/math, not JSX) into `lib/` files | **0 KB** — same static-import graph, same bytes; this is a pure code-location move | Low, but mechanical/wide-diff (touches every call site) | **Optional.** Not a byte win. Only worth doing if there's separate appetite for shrinking the file for its own sake (eases future diffs). Not required for 1–3 or for tranche E. |
| **E** | The analysis-stack (`detentionRules`/`detentionCriteria`/`floodplainMitigation`/`siteAnalysis`/`buildability`/`pondGeom`/`pondRouting`) made conditional on the Yield/pond panel being open | ≈ 152 KB — **by far the biggest remaining lever** | **High** — 204 call sites, ~50 synchronous, feeding UI outside the panel; getting the gating wrong produces a stale or silently-wrong detention/floodplain number, which is a correctness bug with real-world engineering consequences, not a perf regression | **Not this round.** See §2.1. |
| — | `yield` panel JSX extracted on its own | ≈ 6.9 KB | Low mechanically, but pointless in isolation | **No — explicitly declined, see §2.2** |

### 2.1 Why tranche E is not in this round

The byte prize (152 KB, 4× everything else combined) is real and it's the honest next lever
after 1–3. But shipping it safely means the six modules' outputs have to be memoized and gated
on "is anything downstream actually reading this right now" — not just "is the Yield tab open,"
because watch-out chips and canvas badges read these values too. That is exactly the kind of
invalidation-boundary work B287058 (state-ownership) is already building the counter-based
guard for (`npm run perf:viewindep`, the "a memo's inputs must not include view state, and its
result must be provably read once" discipline). Building tranche E's gating without that
machinery risks reintroducing the exact bug class B287058 exists to catch — a value that looks
right in every existing test but is silently stale. **Recommendation: sequence tranche E after
B287058's slices 0–4 land** (chrome/layout state, which includes `leftPanel` itself, is slice 4),
or scope it as its own dedicated, carefully-designed item with a named gating rule and a live
verification pass on real detention/floodplain numbers — never folded into a quick pass alongside
1–3.

### 2.2 Why the Yield panel is not split on its own

Its own JSX is small (≈ 6.9 KB) and mechanically easy to extract — but it's the panel Michael
described as core to the product, likely opened close to every session. Extracting a tiny amount
of JSX buys almost nothing (the actual weight behind Yield is the analysis stack, tranche E,
which can't move without the harder work above) while introducing a new failure surface — a
Suspense boundary, an error boundary, a chunk fetch — on the one panel where "imperceptible" has
to hold every time, not most of the time. **The 29 ms bar makes this an easy call: don't spend a
lazy-load boundary on 6.9 KB behind the app's most-used panel when the reward doesn't cover the
risk.** If tranche E ships later and genuinely moves ≈150 KB behind a gate, revisit whether the
thin Yield JSX wrapper should move with it — at that point the reward changes.

## 3. Treatment per tranche (boot / lazy / lazy+prefetch)

| Tranche | Treatment | Why |
|---|---|---|
| Canvas/SVG render engine, toolbar, pointer/keyboard handlers, module-scope helpers | **Stays in the boot path** | On screen (or load-bearing for what's on screen) the instant a plan opens — this is the product, not a panel |
| `yield` panel | **Stays in the boot path** (declined as a tranche — §2.2) | Used constantly; the real weight behind it can't move without tranche E, and the JSX alone isn't worth a lazy boundary |
| `references` panel (tranche 1) | **Lazy, no prefetch** | Occasional use; even un-prefetched this is smaller than the panel that measured 29 ms |
| `standards` defaults panel (tranche 2) | **Lazy, no prefetch** | Rare use (set-and-forget) |
| `parcel` panel (tranche 3) | **Lazy, no prefetch** | Used early-and-occasionally per plan, not continuously within a session |
| **Layers panel** (already shipped) | **Currently lazy, no prefetch — confirmed by reading the code** | See below |
| Analysis stack (tranche E, deferred) | Would become **conditionally computed / lazy behind the Yield+pond panels**, likely paired with a **prefetch on `leftPanel` rail-button hover or on plan-open idle** given how central Yield is | Not decided in detail here — this is tranche E's own design work, flagged for when it's picked up |

### 3.1 The Layers panel's prefetch status, answered directly

**It is fetched purely on demand — there is no prefetch, preload, or hover-warm anywhere in the
code.** `SitePlanner.jsx` line 108: `const LayerPanel = lazy(() => import("./components/LayerPanel.jsx"));`
— a bare `React.lazy()`. The import only fires when the user expands the Layers card
(`layersOpen` flips true and the component actually renders); nothing calls `import()` early, on
hover, on idle, or on plan load. Same in `MapFinder.jsx`. **Should it be prefetched?
Recommendation: no, leave it as-is.** At a measured 29 ms it is already indistinguishable from
instant — a hover-prewarm would add a small amount of code and a new thing that can go subtly
wrong (a prefetch that fires and is never used, or races the real click) for a saving Michael
cannot perceive. Prefetch is the right tool when a panel is both constantly used AND its cold-open
cost is large enough to notice; Layers clears the first condition but not the second. Keep this
as the standing example of "lazy is enough, don't add prefetch machinery for its own sake" —
and revisit only if a future measurement (§4) shows it drifting upward as more gets added to it.

## 4. Measurement plan — prove the experience didn't get worse, not just that the number went down

Every tranche in this document ships only after clearing all four of these, mirroring exactly
how tranches (a) and (c) were verified (nothing new invented):

1. **Bundle audit, before/after.** `npm run perf:bundle` — record `siteRouteJsBytes` and
   `largestChunkBytes` before and after each tranche, on the item, same as tranches (a)/(c).
   This proves the bytes actually left the route (not just moved chunks).
2. **Deferral proof, headless.** Extend `ui-audit/verify-lazy-panels.mjs`'s `DEFERRED` list (or a
   sibling script following its exact shape) to include the new panel(s): assert the chunk is
   **absent from the boot fetch set** on a cold load, and that opening the panel **fetches and
   renders it correctly** with no page errors — the same two-sided check (deferred AND renders)
   that already caught "looks split but isn't" and "split but Suspense never resolves" as
   distinct failure modes.
3. **Cold-open timing, the actual 29 ms-style number, under two network conditions.** Playwright
   against a real production build (`vite build && vite preview`), same measurement Michael did
   by hand for Layers: time from click to panel fully rendered, on (a) an unthrottled connection
   — this is the number to compare against the 29 ms bar — and (b) a throttled profile
   representative of a weak cellular connection on a job site (Michael works site visits in the
   field, not just an office network). A panel that's imperceptible on fast wifi but adds a
   real, felt delay on site is exactly the case this document exists to catch, and (a) alone
   would miss it.
4. **Regression gate.** Once a tranche ships, its panel joins the standing `DEFERRED` list
   permanently — the day something regresses it back onto the boot path (a stray static import,
   a prefetch nobody intended), the harness fails by name instead of the regression riding along
   silently for weeks the way `LayerPanel` almost did before tranche c.

All four are Claude-doable in this sandbox, logged out, no live GIS or sign-in needed — the
`references`/`standards`/`parcel` panels' own rendering doesn't require real project data to
prove the split itself works (ATTEMPT-BEFORE-YOU-PARK applies). A **separate, signed-in live
pass** is still owed per the existing rule for anything this sandbox can't drive end-to-end (e.g.
`parcel`'s real tax-record content) — filed as a `V###` on the tranche's own backlog entry when
it ships, not before.

## 5. Risk — what could actually break, and how far it would reach

**The mitigating factor, stated first because it's real:** 145 test files reference
`SitePlanner` in some way, 113 e2e specs exist, and the unit suite carries ~15,000 assertions.
Tranches 1–3 are small, mechanical, and land inside a large existing safety net — that net
catches *behavioral* regressions, though, not *responsiveness* regressions, which is why §4's
measurement plan is separate from "tests pass."

**The concrete illustration Michael's brief pointed at — today's bare-`c` keyboard bug
(B792384, shipped as #1188 in this same session's history).** The Cloud markup tool's `c`
shortcut leaked into every focused text field because `KEY_CONTRACT` (the one shared table every
canvas shortcut is arbitrated against) was simply missing an entry for it. The instructive part
for this document isn't the bug itself, it's what the investigation found while tracing it: **four
separate `window`-level keydown listeners exist across the app** — `SitePlanner.jsx`'s main
handler, its own Shift-tracker, `AppHeader.jsx`'s fullscreen toggle, and one from a
conditionally-mounted `MapFinder.jsx` menu — all arbitrated through one shared table. That is the
shape of coupling a panel-extraction tranche can walk into without warning: a panel that looks
self-contained in its JSX can still share a keyboard scope, a z-order rule, or a piece of
`leftPanel`'s own state machine with code nowhere near it in the file. None of tranches 1–3
touch keyboard handling directly, but the lesson generalizes — **grep for every reader of
whatever state a tranche's panel currently closes over, not just the obvious JSX block**, before
extracting it.

**Ranked by blast radius:**

1. **Tranche E (analysis stack), if it's ever done without the sequencing in §2.1** — highest.
   A gating mistake produces a wrong detention or floodplain number that LOOKS present and
   confident on screen. These numbers carry real engineering/regulatory weight for an industrial
   site plan; a silently-stale one is worse than an honestly-missing one. This is exactly why
   §2.1 declines to schedule it this round.
2. **Tranche 3 (`parcel`)** — moderate. Larger prop surface than 1–2, and it hosts the
   "place this plan" location CTA, a load-bearing flow (an unlocated plan's whole path back to
   the map goes through this block, per the code's own comment at L19510‑ish). Extract it with
   the location/origin flow's existing tests run explicitly, not just the general suite.
3. **Tranches 1–2 (`references`, `standards`)** — low. Isolated UI, no evidence of being read
   from elsewhere in the file (confirmed by grep — `references`'s aerial/overlay state and
   `standards`'s draft-settings state are both scoped to their own block).
4. **Tranche 0 (helper relocation)**, if done — low risk of breakage (pure move, no logic
   change) but a **wide, noisy diff** (every call site's import line changes) that makes a real
   regression, if one snuck in, harder to spot in review. Worth doing in its own single-purpose
   PR, never mixed into a byte-reduction tranche's diff.

**Every tranche reuses the shipped safety mechanism, not a new one:** the `LazyPanel` wrapper
(height-reserving Suspense fallback — a panel that's loading never jumps the content below it —
plus a per-panel error boundary that contains a failed chunk load to that one panel and offers a
cache-busting reload on the stale-deploy case). This is LOUD-FAILURE-compliant and already proven
in production twice. No tranche in this document needs a new loading-state design.

## 6. Size

| Tranche | Estimated size | Basis |
|---|---|---|
| 1 — `references` | ≈ 0.5–1 session | Matches tranche (a)'s per-panel pace (3 panels shipped in one session) |
| 2 — `standards` defaults | ≈ 0.5–1 session | Same pattern, smaller/simpler than 1 |
| 3 — `parcel` | ≈ 1 session | More props to thread, location-flow care |
| 0 — helper relocation (optional) | ≈ 1 session | Mechanical but wide — moving ~1,900 lines and updating every call site's import |
| E — analysis stack | **Not sizeable yet** | Needs its own gating design first (§2.1); sizing it now would be the same mistake B217540 warns against in the sibling programme — pretending a dependency-blocked slice is estimable |

**Whole job (tranches 1–3, the part actually recommended this round): roughly 2–3 sessions**,
each independently shippable and revertable via its own PR — exactly the pattern tranches (a)
and (c) already used. There is no reason to do them in one push; spreading them over separate
sessions/weeks costs nothing, since each tranche's measurement (§4) stands on its own. Tranche 0
is a separate, optional cleanup call. Tranche E is a later, larger, dependency-gated
conversation — not part of "the whole job" as scoped here.

## 7. What this document is not

- **Not an implementation.** Nothing in `SitePlanner.jsx` changed to produce it.
- **Not a claim that splitting reaches the 1562.5 KB `siteRouteJsBytes` target.** §1.4 states the
  honest ceiling of what's achievable through this axis (≈ 2357 KB even doing everything,
  including tranche E) and points at the existing policy question on B329408 rather than
  re-opening it here.
- **Not the state-ownership programme.** `docs/PLAN-SITEPLANNER-DECOMPOSITION.md` (B287058) is a
  separate, cross-referenced effort on the same file, different axis (re-render frequency, not
  load weight). Tranche E's likely sequencing after it is the one place the two intersect.
