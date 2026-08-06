/* NEW-3 — the per-building DOCK PLAN is resolved once per model/settings change, never per frame.
 *
 * WHAT WAS WRONG. `renderElPx` recomputed, for every building, on every frame of every pan and
 * zoom: the validated dock sides, the resolved grid settings, `computeBuildingGrid` (a bay-count
 * SEARCH over the footprint), the footprint axes, and `dockDoorRun` per dock side (the door
 * placement solver). None of them takes the view — and `settings.showDocks` / `settings.showGrid`
 * BOTH default to true, so a default plan paid the whole lot for every building on every frame.
 * It is the same class of defect B1352 fixed for `curbEdgesOf` (measured there at 8.6% of all
 * script self-time in a zoom frame), in the code B1352 did not reach.
 *
 * WHY THE GUARD LOOKS LIKE THIS. Two properties matter and they need different kinds of test:
 *
 *   1. THE FIX IS ONLY SOUND BECAUSE THE COMPUTATION IS PURE. Caching a function of the view
 *      would draw a stale picture; caching a function of (element, settings, dogEars) cannot.
 *      That purity is asserted directly against the real libs, including the property that a
 *      repeated call returns a DEEPLY equal answer — which is what "byte-identical by
 *      construction" actually means and is the whole argument for clearing the B1345 pixel bar
 *      without a pixel diff.
 *
 *   2. THE WIRING IS WHAT A LATER EDIT WILL SILENTLY UNDO. A source guard is the right instrument
 *      for that, for the same reason `handleLayerOrder` uses one: nothing about a re-introduced
 *      per-frame `computeBuildingGrid` call is visible in a screenshot, in a render assertion, or
 *      in any behavioural test — the picture stays identical and only the cost changes.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { computeBuildingGrid, resolveGridSettings, placeDockDoors } from "../src/workspaces/site-planner/lib/buildingGrid.js";
import { dockSidesFor, footprintAxes, footprintDepth, footprintLength } from "../src/workspaces/site-planner/lib/dockZones.js";

const here = dirname(fileURLToPath(import.meta.url));
const SP = readFileSync(join(here, "../src/workspaces/site-planner/SitePlanner.jsx"), "utf8");

const building = (over = {}) => ({ id: "b1", type: "building", cx: 500, cy: 400, w: 620, h: 240, rot: 0, dock: "cross", ...over });
const settings = { showDocks: true, showGrid: true, speedBay: 60, bayLengthTarget: 56, bayDepthTarget: 50, doorWidth: 9, doorOC: 12 };

/* ── 1. The purity the cache rests on ─────────────────────────────────────────────────────── */

describe("the dock plan is a pure function of (element, settings) — the premise of caching it", () => {
  it("computeBuildingGrid returns a deeply equal answer for the same inputs, twice", () => {
    const el = building();
    const g = resolveGridSettings(el, settings);
    const a = computeBuildingGrid({ length: footprintLength(el), depth: footprintDepth(el), dock: el.dock, grid: g });
    const b = computeBuildingGrid({ length: footprintLength(el), depth: footprintDepth(el), dock: el.dock, grid: g });
    expect(a).toEqual(b);
    expect(a.lengthLines.length).toBeGreaterThan(0);
  });

  it("the whole chain is a function of the FOOTPRINT, so nothing about the view can reach it", () => {
    /* Stated as an executable property rather than a comment: the four functions the render used
     * to call per frame take an element and settings and nothing else. If a future edit gave any
     * of them a view/zoom/ppf parameter, caching them per model-change would start drawing a
     * stale picture — and this assertion is where that would be caught. */
    for (const fn of [dockSidesFor, footprintAxes, footprintDepth, footprintLength]) {
      expect(fn.length).toBeLessThanOrEqual(1);
    }
    expect(resolveGridSettings.length).toBeLessThanOrEqual(2);
  });

  it("the door placement is deterministic for the same wall and the same column lines", () => {
    const el = building();
    const g = resolveGridSettings(el, settings);
    const grid = computeBuildingGrid({ length: footprintLength(el), depth: footprintDepth(el), dock: el.dock, grid: g });
    const lines = grid.lengthLines.map((l) => l.at);
    const a = placeDockDoors(0, footprintLength(el), lines, { doorOC: g.doorOC, doorWidth: g.doorWidth });
    const b = placeDockDoors(0, footprintLength(el), lines, { doorOC: g.doorOC, doorWidth: g.doorWidth });
    expect(a).toEqual(b);
    expect(a.length).toBeGreaterThan(0);
  });

  it("a settings change DOES change the answer — which is why the memo is keyed on settings too", () => {
    const el = building();
    const wide = computeBuildingGrid({ length: footprintLength(el), depth: footprintDepth(el), dock: el.dock, grid: resolveGridSettings(el, { ...settings, bayLengthTarget: 56 }) });
    const tight = computeBuildingGrid({ length: footprintLength(el), depth: footprintDepth(el), dock: el.dock, grid: resolveGridSettings(el, { ...settings, bayLengthTarget: 30, bayMin: 20, bayMax: 40 }) });
    expect(tight.lengthLines.length).not.toBe(wide.lengthLines.length);
  });

  it("a footprint change DOES change the answer — which is why the memo is keyed on els", () => {
    const a = building();
    const b = building({ w: 900 });
    const ga = computeBuildingGrid({ length: footprintLength(a), depth: footprintDepth(a), dock: a.dock, grid: resolveGridSettings(a, settings) });
    const gb = computeBuildingGrid({ length: footprintLength(b), depth: footprintDepth(b), dock: b.dock, grid: resolveGridSettings(b, settings) });
    expect(gb.lengthLines.length).not.toBe(ga.lengthLines.length);
  });
});

/* ── 2. The wiring a later edit would silently undo ────────────────────────────────────────── */

/* `renderElPx` is the per-frame element renderer: from its `function renderElPx(` to the start of
 * the next module-scope declaration. Everything inside it runs once per element per frame. */
const renderStart = SP.indexOf("function renderElPx(");
const renderBlock = SP.slice(renderStart, SP.indexOf("\n/* ---- ElNode", renderStart));

/* `resolveElNeighbors` + `resolveDockPlan` are the once-per-model-change tier. */
const resolveStart = SP.indexOf("function resolveElNeighbors(");
const resolveBlock = SP.slice(resolveStart, SP.indexOf("\n/* element renderer working in PIXEL space", resolveStart));

describe("the wiring — a re-introduced per-frame solve is invisible to every other kind of test", () => {
  it("resolveDockPlan exists and is called from the per-model-change resolver", () => {
    expect(SP).toContain("function resolveDockPlan(");
    expect(resolveBlock).toContain("resolveDockPlan(el, settings, dogEars)");
  });

  it("the neighbour memo is keyed on BOTH els and settings", () => {
    expect(SP).toMatch(/resolveElNeighbors\(els, settings\), \[els, settings\]/);
  });

  it("renderElPx reads the RESOLVED plan rather than solving one per frame", () => {
    expect(renderBlock).toContain("nb.dockPlan");
    expect(renderBlock).toContain("plan.runs[s]");
  });

  it("the only computeBuildingGrid / dockDoorRun calls left in renderElPx are the total-function fallback", () => {
    /* The fallback exists so `renderElPx` stays total for a caller with no resolved record, and it
     * is the identical computation — so the two branches cannot draw different pictures. What must
     * never come back is an UNCONDITIONAL solve. Both remaining references sit behind a
     * `(nb && nb.dockPlan) || …` / `plan.runs[s] || …` guard. */
    const grids = renderBlock.match(/computeBuildingGrid\(/g) || [];
    const runs = renderBlock.match(/dockDoorRun\(/g) || [];
    /* ONE `computeBuildingGrid` is left, and it is the LIVE-RESHAPE path asserted below — which
     * is inside `renderElPx` and is deliberately per-frame. The per-frame solve for a SETTLED
     * building is gone entirely; a second call appearing here is the regression. */
    expect(grids.length).toBe(1);
    expect(renderBlock).toContain("computeBuildingGrid({ length: L, depth: D");
    /* TWO `dockDoorRun` calls remain: the reshape path's, and the guarded fallback. */
    expect(runs.length).toBe(2);
    expect(renderBlock).toContain("plan.runs[s] || dockDoorRun(");
    expect(renderBlock).toContain("(nb && nb.dockPlan) || resolveDockPlan(");
    /* THE SHARP ONE: the exact unconditional per-frame solve that this item removed. Its return
     * would restore the defect with the picture unchanged and nothing else to notice. */
    expect(renderBlock).not.toContain("computeBuildingGrid({ length: footprintLength(el)");
  });

  it("the LIVE-RESHAPE path is deliberately NOT cached, and still is not", () => {
    /* `buildingChrome` recomputes from the live `frameBBox` every frame ON PURPOSE, so the grid
     * tracks a reshape drag frame-by-frame. Caching it would be a visible regression, not a
     * saving — this asserts nobody "unifies" it in while tidying. */
    const chromeStart = SP.indexOf("const buildingChrome = (el.type === \"building\" && el.footEdit");
    expect(chromeStart).toBeGreaterThan(-1);
    const chromeBlock = SP.slice(chromeStart, chromeStart + 4000);
    expect(chromeBlock).toContain("frameBBox(el.points, rot)");
    expect(chromeBlock).toContain("computeBuildingGrid({ length: L, depth: D");
  });

  it("the cache is gated on the same condition the render is, so it computes nothing the render would not", () => {
    expect(resolveBlock).toContain("settings.showDocks || settings.showGrid");
    expect(renderBlock).toContain('el.type === "building" && (settings.showDocks || settings.showGrid)');
  });
});
