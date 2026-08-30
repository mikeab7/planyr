/* THE VIEW-INDEPENDENT-ONCE REGISTRY (NEW-3) — the computations that promise not to recompute
 * because the map moved.
 *
 * Its own module, and not a constant inside the harness, for one practical reason: the harness is a
 * top-level script that drives a browser and calls `process.exit`, so importing it to read the list
 * would RUN it. Both consumers need the list and only one of them wants the browser:
 *   • `ui-audit/verify-view-independent.mjs` — the counter-based gate (a real pure pan, an
 *     instrumented build, "ran more than once" fails).
 *   • `test/viewIndependentRegistry.test.js` — the CI-runnable half (every entry still names a real
 *     memo; no dep array carries a raw view term).
 *
 * Entries are keyed on `file:NAME`, never `file:line` — a line number moves on every unrelated edit
 * above it, so a line-keyed registry would either go stale silently or fail on every commit.
 *
 * Adding a line here is a PROMISE. Removing one needs a reason on the backlog item. Each carries a
 * `why`, so a failure names the property rather than the symbol.
 */
const SP = "src/workspaces/site-planner/SitePlanner.jsx";
/* A PURE-LIBRARY entry (B217539). The probe instruments exported library functions as well as
 * `useMemo`s, so a leaf can carry the same promise a component memo does — and must, when it is
 * reached from more than one call site. Registry entries in this file are checked differently by
 * `test/viewIndependentRegistry.test.js`: an SP entry must name a real `useMemo`, a library entry
 * must name a real export. */
const LL = "src/workspaces/site-planner/lib/labelLayout.js";

export const REGISTRY = [
  { file: SP, name: "drawEls",
    why: "the visible element set — a pan that stays inside the latched cull rect cannot change which elements draw" },
  { file: SP, name: "drawElsZ",
    why: "the z-split of the visible element set — a function of drawEls alone" },
  { file: SP, name: "drawParcels",
    why: "the visible parcel set" },
  { file: SP, name: "drawMarkupsZ",
    why: "the visible markup set" },
  { file: SP, name: "roadNet",
    why: "the dissolved road surface — model + settings, no view term at all" },
  { file: SP, name: "roadRegionPaths",
    why: "the dissolved network's path data, baked at the pan anchor" },
  { file: SP, name: "stdApplyCount",
    why: "the Standards Apply badge count — model + the settings ladder" },
  { file: SP, name: "furnPlates",
    why: "the scale bar and north arrow — view-derived via ppf ONLY, which a pan holds constant" },
  { file: SP, name: "elNeighbors",
    why: "element adjacency — model + settings" },
  { file: SP, name: "teeJunctions",
    why: "junction geometry in world feet" },
  { file: SP, name: "markupsZ",
    why: "the markup layer's z order — a function of `markups` alone" },
  { file: SP, name: "measureBands",
    why: "the measurement z bands — a function of `measures` alone" },
  { file: SP, name: "metrics",
    why: "site-metrics-extraction (lib/siteMetrics.js) — the yield/coverage numbers (dissolved site area, building/paving/parking/pond area, coverage %, FAR, ...) are model + settings only, no view term" },
  /* B217539 — the FIRST pure-library entry, and it is registered deliberately rather than being
   * memoised at its two call sites. `layoutLabels` is a leaf called from the render body, and a
   * third caller (an export pass, a future overlay) would reintroduce the defect with nothing to
   * notice; keying the promise to the FUNCTION rather than to a `useMemo` in one component is what
   * makes "a redundant re-solve reached from a different path" the same failure. Its inputs are
   * screen boxes baked at the pan ANCHOR (B1440), so a pan holds every one of them constant. */
  /* ⚠ The registered name is the SOLVER, not the `layoutLabels` wrapper, and that is the same
   * convention every other entry here follows. `drawEls` is a `useMemo`: the component re-renders
   * 372× and the guard counts FACTORY executions, not renders. The library analogue is exactly
   * that — the wrapper is asked once per render by design, and the question this guard asks is how
   * often the pass actually RAN. Registering the wrapper would assert "the render body did not run",
   * which is a different (and false) claim. */
  /* `max: 2` is the number of DISTINCT QUESTIONS, not a tolerance: the planner asks this pass once
   * for the measurement chips and once for the element labels, and the detector confirms it —
   * during a pure pan the input fingerprints ALTERNATE between exactly two values. A perfectly
   * memoised pass therefore solves twice, and `≤ 1` would assert something false. It is pinned to
   * the source: `test/labelLayoutMemo.test.js` asserts SitePlanner has exactly two `layoutLabels(`
   * call sites, so a third turns CI red and forces a decision here instead of a quiet bump.
   * Before the fix this ran 372×. */
  { file: LL, name: "layoutLabelsSolve", max: 2,
    why: "the greedy label COLLISION pass over every label on the plan — items and obstacles are baked at the pan anchor, so a pan cannot change one of its inputs" },
];

export default REGISTRY;
