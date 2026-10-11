/* B2233521 (round 5) — source guards for the cold-load changes that have no pure function to test: the Map mode is built when first shown, the saved-site pins wait while the map
 * is hidden, and the project switcher builds its rows only while open. Each is a cheap structural guard (the measured proof is ui-audit perf-plan-open, `reload-onto-plan` and
 * `open-map-after-reload`); each says what it protects so a "tidy-up" cannot quietly put the cost back. */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

const read = (rel) => readFileSync(new URL(rel, import.meta.url), "utf8");
const app = read("../src/workspaces/site-planner/SitePlannerApp.jsx");
const finder = read("../src/workspaces/site-planner/MapFinder.jsx");
const crumb = read("../src/shared/ui/ProjectBreadcrumb.jsx");

describe("Map mode is built when first shown, then kept (SitePlannerApp)", () => {
  it("the map-mode header + MapFinder render only once the map has been shown, and stay mounted after", () => {
    expect(app).toMatch(/const mapEverRef = useRef\(mode === "map"\);\s*\n\s*if \(mode === "map"\) mapEverRef\.current = true;\s*\n\s*const mapMounted = mapEverRef\.current;/);
    expect(app).toMatch(/\{mapMounted && <>\s*\n\s*<AppHeader/);
    // the wrapper div (and so every [data-mode="map"] selector) is still always present — only its children wait
    expect(app).toMatch(/<div data-mode="map" data-mode-active=/);
  });
  it("it never goes back to unmounted (keep-alive is unchanged): nothing resets the ref", () => {
    expect(app).not.toMatch(/mapEverRef\.current = false/);
  });
});

describe("saved-site pins wait while the map is hidden (MapFinder)", () => {
  it("the rebuild is parked in the pending slot when hidden and run before paint when the map is shown", () => {
    expect(finder).toMatch(/if \(!visibleNowRef\.current\) \{ pendingRebuildRef\.current = build; return; \}/);
    expect(finder).toMatch(/useLayoutEffect\(\(\) => \{\s*\n\s*if \(!visible \|\| pressedRef\.current \|\| !pendingRebuildRef\.current\) return;\s*\n\s*const fn = pendingRebuildRef\.current; pendingRebuildRef\.current = null; fn\(\);\s*\n\s*\}, \[visible\]\);/);
  });
  it("a visible map still builds at once (the park is conditional on hidden)", () => {
    expect(finder).toMatch(/const visibleNowRef = useRef\(visible\); visibleNowRef\.current = visible;/);
  });
});

describe("the project switcher builds its rows only while open (ProjectBreadcrumb)", () => {
  it("renderProjectRow runs over the rows only when `open`", () => {
    expect(crumb).toMatch(/\(open \? \[\.\.\.\(currentRow \? \[currentRow\] : \[\]\), \.\.\.pinnedRows, \.\.\.restRows\] : \[\]\)\.map\(renderProjectRow\)/);
  });
});
