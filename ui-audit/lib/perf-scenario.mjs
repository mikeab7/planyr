/* perf-scenario — the fixed heavy reference scenario the performance harness measures (NEW-8).
 *
 * WHY THIS EXISTS RATHER THAN REUSING e2e/fixtures/sites/dense-testfit.
 * That fixture is built for the pure-engine unit tests: its elements carry the ENGINE's
 * geometry schema (`x`/`y` top-left corners) and an empty `settings`, so injecting it into
 * localStorage and booting the real planner crashes the render path outright. It is the right
 * fixture for `test/siteFitFixture.test.js` and the wrong one for measuring frames. The harness
 * therefore owns its scenario, in the shape the LIVE canvas actually consumes (`cx`/`cy` element
 * centres — see src/workspaces/site-planner/lib/siteModel.js).
 *
 * PROPERTIES THAT MATTER FOR A BUDGET:
 *  • Deterministic. No RNG, no Date-derived geometry — every number below is a fixed literal or
 *    derived from the loop index, so two runs measure the same scene and a frame-time delta is
 *    attributable to a code change rather than to a different scene.
 *  • Heavy in the way the real one is. It stands in for Sylvestri / "Concept C — Full 275'
 *    Frontage": a large irregular boundary plus a full building/parking/truck-court layout, so
 *    the SVG element count and the boundary vertex count are in the same class as the owner's.
 *  • Fixed location. The Katy / west-Houston industrial corridor, at a fixed origin, because the
 *    aerial-tile-request budget is only comparable run-to-run at a fixed place and zoom.
 *
 * It is deliberately a STAND-IN, not a match: the real Sylvestri scenario is signed-in project
 * data the sandbox cannot reach, and it is heavier than this. Numbers here are a floor. Confirming
 * the ceilings against the real thing is a signed-in live check (VERIFICATION.md).
 */

/* Katy / west-Houston industrial corridor. Constant on purpose — see above. */
export const ORIGIN = { lat: 29.786, lon: -95.83 };

export const SCENARIO_ID = "perf-reference-concept-c";

/* An irregular site boundary with a long frontage, echoing the "full 275' frontage" shape:
 * a wide rectangle whose north edge is broken into many small vertices, so boundary labelling,
 * setback offsetting, and edge-run computation all have real work to do rather than four corners. */
function boundary() {
  const pts = [];
  const W = 1400, H = 760;
  const FRONTAGE_STEPS = 18; // north edge, west → east, gently undulating
  for (let i = 0; i <= FRONTAGE_STEPS; i++) {
    const t = i / FRONTAGE_STEPS;
    pts.push({ x: -W / 2 + t * W, y: -H / 2 + (i % 2 ? 14 : 0) + Math.round(Math.sin(t * Math.PI) * 26) });
  }
  pts.push({ x: W / 2, y: H / 2 - 120 });
  pts.push({ x: W / 2 - 180, y: H / 2 });
  pts.push({ x: -W / 2 + 90, y: H / 2 });
  pts.push({ x: -W / 2, y: H / 2 - 200 });
  return pts;
}

/* A cross-dock layout: two building bars, their dock-side paving and trailer stalls, parking
 * fields, a perimeter road and a landscape buffer.
 *
 * ⚠ USE ONLY REAL ELEMENT TYPES. The canvas resolves an element's type through the dock-zone
 * registry (src/workspaces/site-planner/lib/dockZones.js), so an invented type id crashes the
 * whole workspace on `ZONE[e.type].label`. The valid box types are: building · paving (this is
 * what a truck court actually is — there is no "truckCourt" type) · trailer · landscape ·
 * sidewalk · parking · road. Every type below was confirmed to render before being committed. */
function elements() {
  const els = [];
  const push = (e) => els.push({ rot: 0, ...e, id: `perf-${els.length + 1}` });

  // Two main distribution buildings.
  push({ type: "building", cx: -330, cy: -60, w: 620, h: 220 });
  push({ type: "building", cx: 400, cy: -60, w: 520, h: 220 });

  // Truck-court paving on the dock faces, with trailer stalls beyond.
  push({ type: "paving", cx: -330, cy: 130, w: 620, h: 135 });
  push({ type: "paving", cx: 400, cy: 130, w: 520, h: 135 });
  push({ type: "trailer", cx: -330, cy: 232, w: 620, h: 50 });
  push({ type: "trailer", cx: 400, cy: 232, w: 520, h: 50 });

  // Parking fields — several bays each side, deterministic grid.
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 6; c++) {
      push({ type: "parking", cx: -600 + c * 200, cy: 292 + r * 62, w: 180, h: 54 });
    }
  }
  // A row of smaller ancillary structures along the frontage.
  for (let i = 0; i < 8; i++) {
    push({ type: "building", cx: -560 + i * 150, cy: -280, w: 110, h: 70 });
  }
  // Perimeter circulation + a frontage landscape buffer.
  push({ type: "road", cx: 0, cy: 340, w: 1320, h: 24 });
  push({ type: "landscape", cx: 0, cy: -350, w: 1320, h: 15 });
  return els;
}

/* Dimension strings + annotations: these ride the same render pass as the geometry and are a
 * real part of what makes a mature plan slow, so the scenario carries a representative load. */
function measures() {
  const out = [];
  for (let i = 0; i < 10; i++) {
    out.push({
      id: `perf-m${i + 1}`,
      a: { x: -650 + i * 130, y: -330 },
      b: { x: -650 + i * 130, y: 330 },
    });
  }
  return out;
}

/* Callout shape is {id, tip, box, text} — a leader tip plus the label box it points from
 * (see the `callouts` state in src/workspaces/site-planner/SitePlanner.jsx). A flat {x,y}
 * crashes hit-testing. */
function callouts() {
  return Array.from({ length: 6 }, (_, i) => ({
    id: `perf-c${i + 1}`,
    tip: { x: -520 + i * 190, y: 60 },
    box: { x: -500 + i * 190, y: -190 },
    text: `Note ${i + 1} — reference scenario annotation`,
  }));
}

/** The full site record, in the shape the logged-out planner store persists. */
export function perfScenarioSite() {
  return {
    id: SCENARIO_ID,
    groupId: SCENARIO_ID,
    site: "Perf Reference",
    name: "Concept C — reference",
    origin: ORIGIN,
    county: "harris",
    parcels: [{ id: "perf-parcel-1", locked: false, points: boundary() }],
    els: elements(),
    measures: measures(),
    callouts: callouts(),
    markups: [],
    settings: {},
    underlay: null,
    updatedAt: 0, // fixed, so the seeded bytes are byte-identical run to run
    data: { status: "active" },
  };
}

/** The localStorage seed script the harness injects before navigation. */
export function perfScenarioSeed() {
  const site = perfScenarioSite();
  return `(() => { try {
    localStorage.setItem('planarfit:sites:v1', JSON.stringify(${JSON.stringify({ [site.id]: site })}));
    localStorage.setItem('planarfit:currentSite:v1', ${JSON.stringify(site.id)});
  } catch (e) {} })();`;
}
