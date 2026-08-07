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
  { file: SP, name: "siteSqft",
    why: "dissolved site area — parcels only" },
];

export default REGISTRY;
