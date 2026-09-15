/* B1614544 — "gridlines show at the same zoom for all buildings, I don't like seeing grid
 * lines on some but not others" (owner report, 2026-09-15).
 *
 * ROOT CAUSE (confirmed by live reproduction before this fix, ui-audit/verify-grid-view-scale.mjs):
 * the reveal gate compared EACH building's own rendered footprint px (`Math.min(w,h)`) against a
 * fixed floor (`FEAT_BTN_MIN_PX`), so the show/hide answer depended on which building you asked
 * about rather than on where the map was zoomed. Two buildings of different footprint size could
 * disagree at the identical zoom.
 *
 * THE FIX: buildingGrid.gridLinesVisible(ppf) is a pure function of the render scale alone — no
 * building size, position or rotation term reaches it. This file pins both halves so the bug
 * cannot drift back either the LIBRARY way (a building-shaped parameter creeping into the
 * function) or the WIRING way (a SitePlanner.jsx call site quietly reverting to the retired
 * per-building comparison).
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { GRID_MIN_PPF, gridLinesVisible } from "../src/workspaces/site-planner/lib/buildingGrid.js";

describe("gridLinesVisible — pure function of ppf alone", () => {
  it("takes exactly one argument (ppf) — no building geometry parameter", () => {
    expect(gridLinesVisible.length).toBe(1);
  });

  it("is a simple threshold on GRID_MIN_PPF", () => {
    expect(gridLinesVisible(GRID_MIN_PPF)).toBe(true);
    expect(gridLinesVisible(GRID_MIN_PPF - 0.001)).toBe(false);
    expect(gridLinesVisible(GRID_MIN_PPF + 0.001)).toBe(true);
  });

  it("non-finite / missing ppf reads as hidden, never throws", () => {
    for (const bad of [undefined, null, NaN, -1, "x", {}]) {
      expect(() => gridLinesVisible(bad)).not.toThrow();
      expect(gridLinesVisible(bad)).toBe(false);
    }
  });

  // REGRESSION ROW (the exact check the owner asked for): at a fixed zoom, the set of buildings
  // drawing gridlines is either ALL of them or NONE of them — on a fixture of very different
  // footprint sizes, including the tiny/huge extremes. Because gridLinesVisible takes no building
  // argument at all, this is true by construction; the fixture also proves the RETIRED per-building
  // rule (`Math.min(w,h) >= FEAT_BTN_MIN_PX`, replayed here byte-for-byte) really did disagree with
  // itself somewhere in the same sweep — i.e. this fixture is capable of exhibiting the reported
  // bug, not merely incapable of exhibiting the fix.
  it("buildings of very different sizes always agree at a fixed zoom (fixture sweep)", () => {
    const FEAT_BTN_MIN_PX = 72; // the retired per-building floor (SitePlanner.jsx)
    const perBuildingGateOld = (minSidePx) => minSidePx >= FEAT_BTN_MIN_PX;
    const buildings = [
      { w: 60, h: 60 },     // tiny — no interior bay at all, worst case for a size term
      { w: 200, h: 150 },   // small
      { w: 400, h: 250 },   // mid
      { w: 1200, h: 600 },  // large
      { w: 900, h: 3000 },  // very long and narrow
    ];
    let oldRuleWasMixedSomewhere = false;
    for (let ppf = 0.05; ppf <= 2; ppf += 0.01) {
      const newDecisions = buildings.map(() => gridLinesVisible(ppf));
      expect(new Set(newDecisions).size, `mixed at ppf=${ppf}`).toBe(1);

      const oldDecisions = buildings.map((b) => perBuildingGateOld(Math.min(b.w, b.h) * ppf));
      if (new Set(oldDecisions).size > 1) oldRuleWasMixedSomewhere = true;
    }
    expect(oldRuleWasMixedSomewhere, "fixture never exhibited the old bug — it proves nothing").toBe(true);
  });
});

// ── Source guard: BOTH SitePlanner.jsx render branches gate the grid on gridLinesVisible(...)
// and neither has quietly reverted to comparing a per-building screen size against
// FEAT_BTN_MIN_PX. A render-only assertion can't catch this drifting back (the picture looks
// identical on any single-building fixture); the live ui-audit harness proves the rendered
// consequence, this proves the SOURCE didn't regress.
const here = dirname(fileURLToPath(import.meta.url));
const SP = readFileSync(join(here, "../src/workspaces/site-planner/SitePlanner.jsx"), "utf8");

describe("SitePlanner.jsx — column-grid reveal gate stays view-scale-only", () => {
  it("gridLinesVisible is imported from buildingGrid.js", () => {
    expect(SP).toMatch(/import\s*\{[^}]*\bgridLinesVisible\b[^}]*\}\s*from\s*"\.\/lib\/buildingGrid\.js"/);
  });

  it("both grid-reveal call sites gate on gridLinesVisible(...)", () => {
    const calls = SP.match(/settings\.showGrid\s*&&[^\n]*gridLinesVisible\(/g) || [];
    expect(calls.length, "expected exactly the rect branch + the reshaped-polygon branch").toBe(2);
  });

  it("no grid-reveal call site compares a per-building screen size against FEAT_BTN_MIN_PX", () => {
    // The two known-retired shapes: `Math.min(w, h) / lfK >= FEAT_BTN_MIN_PX` (rect branch) and
    // `Math.min(wpx, hpx) >= FEAT_BTN_MIN_PX` (reshaped-polygon branch). FEAT_BTN_MIN_PX itself is
    // still legitimately used elsewhere (the +/- edit-control affordance, B225) — this only bans
    // the pattern next to `showGrid`.
    const showGridLines = SP.split("\n").filter((l) => l.includes("settings.showGrid"));
    for (const line of showGridLines) {
      expect(line, `a showGrid line still compares a building size against FEAT_BTN_MIN_PX: ${line.trim()}`)
        .not.toMatch(/Math\.min\([^)]*\)\s*(\/\s*lfK\s*)?>=\s*FEAT_BTN_MIN_PX/);
    }
  });
});
