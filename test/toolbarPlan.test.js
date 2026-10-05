/* NEW-2 (2026-10-05) — the PURE half of the shared priority toolbar. Every rule the owner asked for is
 * pinned here without a browser; `ui-audit/verify-width-sweep.mjs` proves the rendered half. */
import { describe, it, expect } from "vitest";
import { buildLadder, stateAt, widthAt, stepFor, nextStep, planToolbar, MORE_WIDTH, TOOLBAR_GAP, HYSTERESIS_PX } from "../src/shared/ui/toolbarPlan.js";

// An item with a label (full 100, icon 30) or without one (30 either way).
const mk = (id, priority, o = {}) => ({ id, priority, widthFull: 30, widthIcon: 30, collapsible: true, ...o });
const labelled = (id, priority, o = {}) => mk(id, priority, { widthFull: 100, widthIcon: 30, ...o });
const total = (items) => items.reduce((n, i) => n + i.widthFull, 0) + (items.length - 1) * TOOLBAR_GAP;

describe("buildLadder — the one total order of degradation", () => {
  it("icon-ifies labelled items lowest-priority first, THEN moves items to the menu lowest-priority first", () => {
    const items = [labelled("a", 90), labelled("b", 10), mk("c", 50)];
    expect(buildLadder(items)).toEqual([
      { id: "b", to: "icon" }, { id: "a", to: "icon" },
      { id: "b", to: "menu" }, { id: "c", to: "menu" }, { id: "a", to: "menu" },
    ]);
  });
  it("a non-collapsible item never appears on the ladder", () => {
    const items = [mk("keep", 1, { collapsible: false }), mk("x", 5)];
    expect(buildLadder(items).map((s) => s.id)).toEqual(["x"]);
  });
  it("on a priority tie the LATER item goes first (the trailing end is where More sits)", () => {
    const items = [mk("first", 5), mk("second", 5)];
    expect(buildLadder(items)[0].id).toBe("second");
  });
  it("a ghost (reserved-but-invisible) item gives up its room before anything visible does", () => {
    const items = [labelled("vis", 1), mk("ghost", 99, { ghost: true })];
    expect(buildLadder(items)[0]).toEqual({ id: "ghost", to: "menu" });
  });
});

describe("planToolbar — never wraps, never clips, nothing dropped", () => {
  const items = [labelled("a", 90), labelled("b", 80), mk("c", 70), mk("d", 60), mk("e", 50)];
  it("everything fits → nothing changes", () => {
    const p = planToolbar({ items, available: 10000 });
    expect(p.step).toBe(0); expect(p.menuIds).toEqual([]); expect(p.iconIds).toEqual([]);
  });
  it("tight → labels drop to icons BEFORE anything is moved to the menu", () => {
    const p = planToolbar({ items, available: total(items) - 10 });
    expect(p.menuIds).toEqual([]); expect(p.iconIds.length).toBeGreaterThan(0);
    expect(p.width).toBeLessThanOrEqual(total(items) - 10);
  });
  it("tighter → the lowest-priority items move to the menu, listed in ORIGINAL order", () => {
    const p = planToolbar({ items, available: 140 });
    expect(p.menuIds.length).toBeGreaterThan(0);
    expect(p.menuIds).toEqual(items.map((i) => i.id).filter((id) => p.menuIds.includes(id)));
    expect(p.menuIds).toContain("e");           // lowest priority went first
    expect(p.barIds).toContain("a");            // highest priority is still on the bar
    expect(p.width).toBeLessThanOrEqual(140);
  });
  it("the bar width never exceeds the budget whenever the budget can hold the floor", () => {
    for (let avail = 80; avail < 500; avail += 7) {
      const p = planToolbar({ items, available: avail });
      expect(p.overflowing ? p.width > avail : p.width <= avail).toBe(true);
    }
  });
  it("EVERY item is either on the bar or in the menu — nothing is dropped, at any width", () => {
    for (let avail = 0; avail < 600; avail += 13) {
      const p = planToolbar({ items, available: avail });
      expect([...p.barIds, ...p.menuIds].sort()).toEqual(items.map((i) => i.id).sort());
    }
  });
  it("items that cannot collapse never leave the bar, even when the budget cannot hold them", () => {
    const pinned = [mk("tab", 1000, { collapsible: false, widthFull: 120, widthIcon: 120 }), mk("x", 5), mk("y", 4)];
    const p = planToolbar({ items: pinned, available: 10 });
    expect(p.barIds).toContain("tab"); expect(p.menuIds.sort()).toEqual(["x", "y"]); expect(p.overflowing).toBe(true);
  });
  it("a non-finite budget (not measured yet) leaves the bar untouched", () => {
    expect(planToolbar({ items, available: Infinity }).step).toBe(0);
  });
  it("the More button's own width is charged only when something is in the menu", () => {
    const ladder = buildLadder(items);
    const none = widthAt(items, stateAt(items, ladder, 0));
    const some = widthAt(items, stateAt(items, ladder, ladder.length));
    expect(some).toBeGreaterThanOrEqual(MORE_WIDTH);
    expect(none).toBe(total(items));
  });
});

describe("hysteresis — no flicker at a boundary width", () => {
  const items = [labelled("a", 90), labelled("b", 10)];
  const ladder = buildLadder(items);
  it("collapses the instant it must", () => {
    const need = stepFor(items, ladder, 150);
    expect(nextStep(0, items, ladder, 150)).toBe(need);
  });
  it("does NOT expand again until the room clears the cost by the margin", () => {
    // find the width at which step 1 first fits, then sit exactly on the boundary
    let w = 0; while (stepFor(items, ladder, w) > 0) w++;
    const collapsedAt = w - 1;
    const s1 = nextStep(0, items, ladder, collapsedAt);
    expect(s1).toBeGreaterThan(0);
    expect(nextStep(s1, items, ladder, w)).toBe(s1);                       // just enough → stay collapsed
    expect(nextStep(s1, items, ladder, w + HYSTERESIS_PX)).toBeLessThan(s1); // margin cleared → expand
  });
  it("a sweep up and down across the boundary changes step at most once per direction", () => {
    let step = 0, flips = 0, prev = 0;
    const seq = [];
    for (let w = 260; w >= 60; w -= 1) seq.push(w);
    for (let w = 60; w <= 260; w += 1) seq.push(w);
    for (const w of seq) { step = nextStep(step, items, ladder, w); if (step !== prev) flips++; prev = step; }
    // total flips bounded by ladder length each way — never one flip per pixel
    expect(flips).toBeLessThanOrEqual(2 * ladder.length);
  });
});
