# Named rule VIEW-INDEPENDENT-ONCE

_Backstory moved verbatim out of `/CLAUDE.md` (audit batch H, 2026-11-23). Nothing below was reworded, shortened or removed: the rule in force is still stated in `/CLAUDE.md`, and this file is the full text and history behind it._

---

- **VIEW-INDEPENDENT-ONCE** — **Work whose inputs are MODEL + SETTINGS must not be recomputed because
  the VIEW moved. A memo key may never contain a view term unless the value is genuinely view-derived
  — and then only the term it actually uses.** (Named 2026-08-06 after the owner, verbatim: *"since
  you're saying it's the same bug, it's like, alright. Well, we didn't find it for this, so find it for
  all the other times. or all the other scenarios."*)
  1. **THE CLASS, and why intuition will not find it.** The same defect had been found TWICE by
     accident: **#926/B1440** — `f2p` was `worldToScreen(view, …)`, so every element's pixel geometry
     was a function of the live view and a pan re-derived all of it (fixing it took DOM mutation
     records per gesture from 101,267 to 2,194) — and the pond **label fit**, re-solved every frame
     with the fit question asked in FEET, so a pan recomputed an identical answer sixty times. One
     class, two accidents. The third was found by an instrument, not by looking.
  2. **⛔ IT IS INVISIBLE TO EVERY VISUAL TEST IN THIS REPO, WHICH IS WHY THE GUARD COUNTS.** #926 said
     it plainly: *"a pan that silently goes back to baking the view is invisible to every screenshot
     and behavioural test in this repo; only a frame counter would notice."* Both instances draw the
     **identical picture** when broken — pixel diffs, DOM assertions, e2e paths and PERCEPTUAL-PARITY
     all pass on the defect. Never propose a screenshot as the guard for this class.
  3. **THE DETECTOR IS THE DELIVERABLE, not a case list.** `ui-audit/detect-view-recompute.mjs` drives
     a gesture that changes ONLY the view on a plan whose model and settings are frozen, through a
     build instrumented by `scripts/vite-plugin-recompute-probe.mjs` (**inert without
     `PLANYR_PROBE=1`** — no probe byte reaches production), and records per computation: identity
     (`file:line:name`, assigned at transform time), call count, ms, and **a structural fingerprint of
     its INPUTS and of its RESULT**. The fingerprint has to be STRUCTURAL: every instance of this bug
     returns a FRESH object holding an IDENTICAL answer, so `Object.is` — which is all React's memo
     does — reports "changed" on 100% of them. Four verdicts (`ui-audit/lib/viewIndependence.mjs`):
     **`once`** ✅ · **`redundant`** (same inputs, same answer, ran N times — a missing memo) ·
     **`view-churned`** (inputs moved, answer did not — a view term in the key) · **`productive`**
     (the answer genuinely moved — the cull rect, the scale bar, the north arrow, the LOD gates, and
     NOT a violation). It runs four scenarios, because the owner asked for all of them: **pan** ·
     **zoom** (correct answer: once per ppf step, not once per frame) · **single-element edit**
     (correct answer: only what depends on that element) · **panel open/close**.
  4. **THE INVERSE IS ALSO CHECKED AND IS NEVER "FIXED" HERE.** Something memoised so hard it fails to
     change when the view legitimately should change it is a correctness bug in the other direction.
     Reported separately (`inverseFindings`), never merged into the violation list.
  5. **THE FIX IS ALWAYS THE SAME SHAPE — extend the resolve-once boundary B1352/B1437/B1440
     established; do not invent a fifth mechanism.** Memoise by a MODEL + SETTINGS key. Where a value
     IS view-derived, key it on the SCALAR it uses (`view.ppf`) rather than on `view`, and where a
     view-derived value only needs to be *approximately* current, LATCH it (`viewCull.cullRectFor`
     keeps the rect it already holds while the true viewport is proven inside it) — holding the same
     OBJECT is half the fix, because a fresh object with identical numbers still invalidates every
     memo downstream. For pure library leaves with no hook to hang a memo on, use
     `site-planner/lib/pureCache.js` (a signature cache, or a `WeakMap` identity cache when the input
     is a large array that is rebuilt rather than mutated).
  6. **MACHINE-ENFORCED, in two halves, because the browser half cannot run in this repo's CI.**
     `ui-audit/verify-view-independent.mjs` is the **counter-based gate**: it drives a real pure pan
     and fails if any computation in its `REGISTRY` ran more than once — **and fails if a registered
     one was never OBSERVED**, which is exactly how a guard of this shape rots into a permanent green.
     `npm run perf:viewindep`; mutation-proven (disabling the cull latch takes it from ✅ to four
     failures at 186 calls each). The CI-runnable half is `test/viewIndependentRegistry.test.js`,
     which asserts every registered memo still exists and that **no dep array carries a raw view
     term**. Pure core unit-tested in `test/recomputeProbe.test.js`, the fixes in
     `test/pureCache.test.js`.
