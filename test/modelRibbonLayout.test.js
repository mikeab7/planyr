/* ribbonLayout.js — the ribbon's responsive collapse math (B1007281). computeRibbonLayout is
 * generic and tested against synthetic groups (never mounting a browser); the real RIBBON_GROUPS
 * inventory gets a sanity pass at the brief's own three named checkpoints (729 / 1024 / full). */
import { describe, it, expect } from "vitest";
import { computeRibbonLayout, RIBBON_GROUPS, MORE_BUTTON_WIDTH } from "../src/workspaces/model/lib/ribbonLayout.js";

const G = (key, width, priority) => ({ key, width, priority });

describe("computeRibbonLayout — generic algorithm", () => {
  it("everything fits inline when the container is wide enough — no overflow at all", () => {
    const groups = [G("a", 50, 1), G("b", 50, 2), G("c", 50, 3)];
    const { visibleKeys, overflowKeys } = computeRibbonLayout(1000, groups);
    expect(visibleKeys).toEqual(["a", "b", "c"]);
    expect(overflowKeys).toEqual([]);
  });

  it("collapses the LOWEST-priority group first", () => {
    const groups = [G("a", 100, 3), G("b", 100, 1), G("c", 100, 2)];
    // Total 300; a 250-wide container can't fit all three. Priority 1 ("b") goes first.
    const { visibleKeys, overflowKeys } = computeRibbonLayout(250, groups, 0);
    expect(overflowKeys).toEqual(["b"]);
    expect(visibleKeys).toEqual(["a", "c"]);
  });

  it("collapses MULTIPLE groups, lowest priority first, until it fits", () => {
    const groups = [G("a", 100, 4), G("b", 100, 1), G("c", 100, 2), G("d", 100, 3)];
    const { visibleKeys, overflowKeys } = computeRibbonLayout(150, groups, 0);
    // Only "a" (priority 4, highest) can survive alone at 150 width.
    expect(visibleKeys).toEqual(["a"]);
    expect(overflowKeys.sort()).toEqual(["b", "c", "d"]);
  });

  it("charges reserveForMore ONLY once something has actually collapsed", () => {
    const groups = [G("a", 90, 1), G("b", 90, 2)];
    // 180 fits both with zero reserve; adding a reserve that would only matter if something
    // overflowed must not itself force an overflow when everything already fits untouched.
    const { visibleKeys, overflowKeys } = computeRibbonLayout(180, groups, 40);
    expect(visibleKeys).toEqual(["a", "b"]);
    expect(overflowKeys).toEqual([]);
  });

  it("a reserve that WOULD be needed is accounted for once collapse starts, and can force a SECOND collapse", () => {
    const groups = [G("a", 100, 2), G("b", 100, 1)];
    // 200 total never fits 150 either way, so "b" (lowest priority) always collapses first.
    // With NO reserve, "a" alone (100) fits the remaining 150 and the layout stops there.
    const noReserve = computeRibbonLayout(150, groups, 0);
    expect(noReserve.visibleKeys).toEqual(["a"]);
    expect(noReserve.overflowKeys).toEqual(["b"]);
    // With a 60px reserve charged the moment "b" overflows, "a" (100) + reserve (60) = 160 no
    // longer fits 150 — the reserve itself forces "a" to collapse too.
    const withReserve = computeRibbonLayout(150, groups, 60);
    expect(withReserve.visibleKeys).toEqual([]);
    expect(withReserve.overflowKeys.sort()).toEqual(["a", "b"]);
  });

  it("equal-priority groups collapse the RIGHTMOST one first, deterministically", () => {
    const groups = [G("left", 100, 1), G("right", 100, 1)];
    const { overflowKeys } = computeRibbonLayout(150, groups, 0);
    expect(overflowKeys).toEqual(["right"]);
  });

  it("visible/overflow keys are always returned in the ORIGINAL display order, not priority order", () => {
    const groups = [G("z", 50, 1), G("a", 50, 5), G("m", 50, 3)];
    const { visibleKeys } = computeRibbonLayout(1000, groups);
    expect(visibleKeys).toEqual(["z", "a", "m"]); // display order preserved, not sorted by key or priority
  });

  it("everything collapses when the container is absurdly narrow — never throws", () => {
    const groups = [G("a", 100, 1), G("b", 100, 2)];
    const { visibleKeys, overflowKeys } = computeRibbonLayout(10, groups, 0);
    expect(visibleKeys).toEqual([]);
    expect(overflowKeys).toEqual(["a", "b"]);
  });

  it("an empty group list or a non-finite width never throws", () => {
    expect(computeRibbonLayout(500, [])).toEqual({ visibleKeys: [], overflowKeys: [] });
    expect(() => computeRibbonLayout(NaN, [G("a", 10, 1)])).not.toThrow();
  });

  it("is deterministic — the same inputs always produce the same layout", () => {
    const groups = [G("a", 70, 3), G("b", 70, 1), G("c", 70, 2), G("d", 70, 4)];
    const first = computeRibbonLayout(180, groups, 30);
    const second = computeRibbonLayout(180, groups, 30);
    expect(second).toEqual(first);
  });
});

describe("RIBBON_GROUPS — the real inventory at the brief's own checkpoints", () => {
  it("729px (the owner's real window): Font stays visible — a spreadsheet needs Bold reachable without a menu", () => {
    const { visibleKeys } = computeRibbonLayout(700, RIBBON_GROUPS, MORE_BUTTON_WIDTH);
    expect(visibleKeys).toContain("font");
  });
  it("1024px: strictly more groups are visible than at 729px", () => {
    const at729 = computeRibbonLayout(700, RIBBON_GROUPS, MORE_BUTTON_WIDTH).visibleKeys;
    const at1024 = computeRibbonLayout(1000, RIBBON_GROUPS, MORE_BUTTON_WIDTH).visibleKeys;
    expect(at1024.length).toBeGreaterThanOrEqual(at729.length);
  });
  it("full width (1800px): every group is visible, nothing collapses", () => {
    const { visibleKeys, overflowKeys } = computeRibbonLayout(1800, RIBBON_GROUPS, MORE_BUTTON_WIDTH);
    expect(overflowKeys).toEqual([]);
    expect(visibleKeys.length).toBe(RIBBON_GROUPS.length);
  });
  it("Sort & Filter (the lowest-priority group) is the first to collapse as width shrinks", () => {
    // Find the narrowest width at which everything still fits, then shrink by one group's worth.
    const full = RIBBON_GROUPS.reduce((s, g) => s + g.width, 0);
    const { overflowKeys } = computeRibbonLayout(full - 1, RIBBON_GROUPS, MORE_BUTTON_WIDTH);
    expect(overflowKeys[0]).toBe("sortfilter");
  });
});
