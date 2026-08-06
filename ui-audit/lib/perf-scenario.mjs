/* perf-scenario — the fixed heavy reference scenario the performance harness measures (NEW-8).
 *
 * ⚠ RE-BUILT 2026-07-31 (NEW-1 of the speed program). READ THIS BEFORE TRUSTING AN OLD NUMBER.
 *
 * The scenario this module used to build was HAND-AUTHORED, and the shape of what it left out
 * was not a matter of degree. It had:
 *   • a road that was a RECTANGLE — `{type:'road', cx, cy, w:1320, h:24}`, no `pts`, no `vtx` —
 *     so roadNet / teeJunctionsOf / driveJunctionsOf / weldJunctionsOf / dissolveRings and the
 *     whole of lib/roadGeometry.js never executed once;
 *   • NO PONDS, so pondContours, lib/detentionRules.js and lib/floodplainMitigation.js and the
 *     pond ledger never executed once;
 *   • no polygon (`points`) elements at all.
 * The single most expensive code path in the app ran ZERO TIMES in the benchmark that certified
 * it, and the frame budget it seeded — a perfect 16.7 ms median, both metrics green — was
 * therefore not evidence that anything was fast. It was evidence that the scene was empty of
 * the work. Every optimisation measured against it was unfalsifiable.
 *
 * THE SCENARIO IS NOW DERIVED FROM COMMITTED REAL PLAN DATA, NOT AUTHORED.
 * `ui-audit/fixtures/goose-creek-plan1copy.json` is the owner's Goose Creek / "Plan 1 (copy)"
 * plan, pulled from the production database — 62 elements (20 buildings · 10 parking · 10 paving
 * · 8 trailer · 6 sidewalk · 6 CENTERLINE ROADS with arc/radius vertices · 2 PONDS), 6 parcels,
 * and the plan's real 30-key settings. It is already the fixture of record for
 * ui-audit/verify-pond-label-fit.mjs and e2e/chrome-swallows-press.spec.js.
 *
 * DERIVED, not copied, deliberately: a second hand-maintained copy of the geometry would drift
 * from the fixture the moment either was touched, and then two instruments would disagree about
 * what "the reference plan" is. There is one file, and this module reads it.
 *
 * PROPERTIES THAT MATTER FOR A BUDGET (unchanged in kind, now actually true of the heavy paths):
 *  • Deterministic. The geometry is a committed file; the annotations below are derived from its
 *    own bounding box by pure arithmetic. No RNG, no Date. `updatedAt` is a fixed 0, so the
 *    seeded bytes are identical run to run.
 *  • Heavy in the way the real one is — because it IS one of the real ones.
 *  • Fixed location. The plan's own origin (Baytown / Goose Creek, Harris County), because the
 *    aerial-tile-request budget is only comparable run-to-run at a fixed place and zoom.
 *
 * WHAT IS STILL A STAND-IN. The owner's heaviest plans live behind a signed-in session the
 * sandbox cannot reach, so these numbers remain a FLOOR rather than a match. The difference from
 * before is that the floor now exercises roads, ponds and polygons at all.
 *
 * (The e2e dense-testfit fixture remains the WRONG source, for the original reason: it carries
 * the pure-ENGINE geometry schema — `x`/`y` top-left corners, empty `settings` — and injecting it
 * into localStorage crashes the live render path. The fixture used here is in the shape the LIVE
 * canvas consumes, which is why it can be seeded at all.)
 */
import { readFileSync } from "node:fs";

const PLAN = JSON.parse(readFileSync(new URL("../fixtures/goose-creek-plan1copy.json", import.meta.url), "utf8"));

/** The plan's own origin — Baytown / Goose Creek, Harris County. Constant on purpose. */
export const ORIGIN = PLAN.origin;

export const SCENARIO_ID = "perf-reference-goose-creek";

/* The scene's own bounding box, in plan feet, computed from every drawn vertex — used ONLY to
 * place the synthetic annotations below inside the plan rather than off in empty space. Pure
 * arithmetic over committed data, so it is as deterministic as a literal would be. */
function bounds() {
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  const at = (x, y) => {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
  };
  for (const e of PLAN.els) {
    if (Array.isArray(e.pts)) for (const p of e.pts) at(p.x, p.y);
    else if (Array.isArray(e.points)) for (const p of e.points) at(p.x, p.y);
    else if (Number.isFinite(e.cx)) { at(e.cx - e.w / 2, e.cy - e.h / 2); at(e.cx + e.w / 2, e.cy + e.h / 2); }
  }
  for (const p of PLAN.parcels || []) for (const q of p.points || []) at(q.x, q.y);
  return { minX, maxX, minY, maxY };
}

/** What this scene actually contains, so a harness can PRINT it and a reader can check the
 *  claim above rather than take it on faith. Counted, never asserted. */
export function scenarioShape() {
  const byType = {};
  let centerlineRoads = 0, arcVertices = 0, polygonEls = 0, drawnVertices = 0;
  for (const e of PLAN.els) {
    byType[e.type] = (byType[e.type] || 0) + 1;
    if (Array.isArray(e.pts)) { centerlineRoads++; drawnVertices += e.pts.length; }
    if (Array.isArray(e.points)) { polygonEls++; drawnVertices += e.points.length; }
    for (const v of e.vtx || []) if (v && Number.isFinite(v.radius)) arcVertices++;
  }
  const parcelVertices = (PLAN.parcels || []).reduce((n, p) => n + (p.points || []).length, 0);
  return {
    elements: PLAN.els.length,
    parcels: (PLAN.parcels || []).length,
    byType, centerlineRoads, arcVertices, polygonEls, drawnVertices, parcelVertices,
    ponds: byType.pond || 0,
  };
}

/* Dimension strings + annotations: these ride the same render pass as the geometry and are a
 * real part of what makes a mature plan slow, so the scenario carries a representative load.
 * Spanning the plan's own width, at fixed fractions of its height. */
function measures() {
  const { minX, maxX, minY, maxY } = bounds();
  const spanY = maxY - minY;
  return Array.from({ length: 10 }, (_, i) => {
    const x = minX + ((i + 0.5) / 10) * (maxX - minX);
    return {
      id: `perf-m${i + 1}`,
      a: { x: Math.round(x), y: Math.round(minY + spanY * 0.15) },
      b: { x: Math.round(x), y: Math.round(minY + spanY * 0.85) },
    };
  });
}

/* Callout shape is {id, tip, box, text} — a leader tip plus the label box it points from
 * (see the `callouts` state in src/workspaces/site-planner/SitePlanner.jsx). A flat {x,y}
 * crashes hit-testing. */
function callouts() {
  const { minX, maxX, minY, maxY } = bounds();
  return Array.from({ length: 6 }, (_, i) => {
    const x = minX + ((i + 0.5) / 6) * (maxX - minX);
    return {
      id: `perf-c${i + 1}`,
      tip: { x: Math.round(x), y: Math.round(minY + (maxY - minY) * 0.5) },
      box: { x: Math.round(x + 60), y: Math.round(minY + (maxY - minY) * 0.32) },
      text: `Note ${i + 1} — reference scenario annotation`,
    };
  });
}

/* ---- CONTROL ARMS (NEW-1, phase 3) -------------------------------------------------------------
 * A hypothesis about boot is only settled by a run with the suspect TURNED OFF, measured the same
 * way and interleaved with the baseline. These arms exist so that control is a SEEDED SETTING —
 * the product's own switch, flipped in the plan the harness loads — and never a patched build or a
 * monkey-patched global, either of which measures a different program.
 *
 *   drainageAutoFacts:false   → `settings.drainage.autoFacts = false`, which is exactly what
 *                               `drainAutoEnabled` in SitePlanner.jsx reads. It disables the
 *                               LOAD-kind drainage facts pass (B860) that B1349 put behind a
 *                               requestIdleCallback with a hard 4 s ceiling — the arm that settles
 *                               whether that ceiling and time-to-first-drag are the same 4 seconds.
 */
export function scenarioArm(name) {
  if (name === "no-drainage") return { drainageAutoFacts: false };
  return {};
}

/** The full site record, in the shape the logged-out planner store persists. */
export function perfScenarioSite({ drainageAutoFacts } = {}) {
  const settings = drainageAutoFacts === false
    ? { ...PLAN.settings, drainage: { ...(PLAN.settings.drainage || {}), autoFacts: false } }
    : PLAN.settings;
  return {
    id: SCENARIO_ID,
    groupId: SCENARIO_ID,
    site: "Goose Creek",
    name: "Plan 1 (copy) — perf reference",
    origin: ORIGIN,
    county: "harris",
    parcels: PLAN.parcels,
    els: PLAN.els,
    measures: measures(),
    callouts: callouts(),
    markups: [],
    parcelDrawings: [],
    settings,
    underlay: null,
    updatedAt: 0, // fixed, so the seeded bytes are byte-identical run to run
    data: { status: "active" },
  };
}

/** The localStorage seed script the harness injects before navigation. */
export function perfScenarioSeed(opts) {
  const site = perfScenarioSite(opts);
  return `(() => { try {
    localStorage.setItem('planarfit:sites:v1', JSON.stringify(${JSON.stringify({ [site.id]: site })}));
    localStorage.setItem('planarfit:currentSite:v1', ${JSON.stringify(site.id)});
  } catch (e) {} })();`;
}

/* ---- A SECOND PLAN, for the plan-switch axis (NEW-2) ---------------------------------------
 *
 * The session-shaped probe has to answer "load plan A, load plan B, return to A — was A's
 * geometry, listeners and memos ever released?", and that needs two plans in the store with
 * DIFFERENT project ids, because the app switches projects by route (`#/project/<groupId>/site`).
 *
 * The companion is DERIVED from the same fixture by truncation rather than authored, for the same
 * reason the primary is: a second hand-maintained plan would drift. Truncating also makes the
 * switch OBSERVABLE — B holds a different element count from A, so "did the switch actually
 * happen" is a counter the harness reads rather than a wait it hopes was long enough. A plan the
 * probe cannot prove it opened is a rung that did not take (see lib/sessionAxes.mjs).
 */
export const SCENARIO_ID_B = "perf-reference-goose-creek-b";

export function perfScenarioSiteB(fraction = 0.5) {
  const base = perfScenarioSite();
  const keep = Math.max(1, Math.round(base.els.length * fraction));
  return {
    ...base,
    id: SCENARIO_ID_B,
    groupId: SCENARIO_ID_B,
    name: "Plan 2 (half) — perf reference B",
    els: base.els.slice(0, keep),
    measures: base.measures.slice(0, 4),
    callouts: base.callouts.slice(0, 2),
  };
}

/** Seed BOTH plans, opening on A. Same store keys, same shape — only the map has two entries. */
export function perfScenarioSeedMulti(opts) {
  const a = perfScenarioSite(opts);
  const b = perfScenarioSiteB();
  return `(() => { try {
    localStorage.setItem('planarfit:sites:v1', JSON.stringify(${JSON.stringify({ [a.id]: a, [b.id]: b })}));
    localStorage.setItem('planarfit:currentSite:v1', ${JSON.stringify(a.id)});
  } catch (e) {} })();`;
}
