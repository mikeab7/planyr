/* notesBoxClear — B2671237/B2671238: a box that grows or lands on another pushes what it newly covers out of the way. */
import { describe, it, expect } from "vitest";
import { planClear, rectsOverlap, changedIds } from "../src/workspaces/notes/lib/notesBoxClear.js";

const R = (x, y, w, h) => ({ x, y, w, h });
const M = (o) => new Map(Object.entries(o));
/* the owner's page: four one-line boxes 40 px apart, each 37 tall */
const page = () => M({ a: R(40, 100, 560, 37), b: R(40, 150, 560, 37), c: R(40, 190, 560, 37), d: R(40, 230, 560, 37) });

describe("rectsOverlap", () => {
  it("touching edges do not overlap, one pixel in does", () => {
    expect(rectsOverlap(R(0, 0, 10, 10), R(0, 10, 10, 10))).toBe(false);
    expect(rectsOverlap(R(0, 0, 10, 10), R(0, 9, 10, 10))).toBe(true);
  });
});

describe("planClear — growth in place pushes DOWN, and cascades", () => {
  it("the owner's paste: b wraps to two lines (+17) and c, d make way", () => {
    const before = page();
    const after = page(); after.set("b", R(40, 150, 560, 54));
    const plan = planClear(before, after);
    // b now ends at 204; c keeps its old 3px gap (190-187) clamped to >=6 -> 210; d then must clear c (210+37=247 + gap)
    expect(plan.get("c")).toBe(210);
    expect(plan.get("d")).toBeGreaterThanOrEqual(247 + 6);
    const final = new Map(after); for (const [k, y] of plan) final.set(k, { ...final.get(k), y });
    const ids = [...final.keys()];
    for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) expect(rectsOverlap(final.get(ids[i]), final.get(ids[j])), `${ids[i]}/${ids[j]}`).toBe(false);
  });
  it("nothing newly covered -> nothing moves (a box above, or beside, is left alone)", () => {
    const before = M({ a: R(40, 100, 200, 37), side: R(400, 100, 200, 37) });
    const after = new Map(before); after.set("a", R(40, 100, 200, 90));
    expect(planClear(before, after).size).toBe(0);
  });
  it("shrinking never pulls anything back", () => {
    const before = page(); before.set("b", R(40, 150, 560, 54)); before.set("c", R(40, 215, 560, 37));
    const after = new Map(before); after.set("b", R(40, 150, 560, 37));
    expect(planClear(before, after).size).toBe(0);
  });
});

describe("planClear — an overlap the person already had is never touched", () => {
  it("two boxes stacked on purpose stay stacked when one of them grows", () => {
    const before = M({ a: R(40, 100, 300, 37), over: R(60, 110, 200, 37) });
    const after = new Map(before); after.set("a", R(40, 100, 300, 60));
    expect(planClear(before, after).size).toBe(0);
  });
  it("opening a page (no changes) moves nothing", () => {
    expect(planClear(page(), page()).size).toBe(0);
  });
});

describe("planClear — movers do not push each other; a drop pushes AWAY from the dropped box", () => {
  it("a group moved together keeps its arrangement", () => {
    const before = M({ a: R(40, 100, 200, 37), b: R(40, 140, 200, 37) });
    const after = M({ a: R(40, 300, 200, 37), b: R(40, 340, 200, 37) });
    expect(planClear(before, after).size).toBe(0);
  });
  it("dropping a box onto one BELOW its centre pushes that one down; onto one ABOVE pushes it up", () => {
    const before = M({ m: R(500, 400, 200, 37), low: R(40, 300, 200, 37), high: R(40, 100, 200, 37) });
    const down = new Map(before); down.set("m", R(40, 290, 200, 37));
    const dp = planClear(before, down);
    expect(dp.get("low")).toBeGreaterThan(300);
    const up = new Map(before); up.set("m", R(40, 110, 200, 37));
    const upPlan = planClear(before, up);
    expect(upPlan.get("high")).toBeLessThan(100);
  });
});

describe("changedIds", () => {
  it("ignores boxes present on only one side", () => {
    expect(changedIds(M({ a: R(0, 0, 1, 1) }), M({ a: R(0, 0, 1, 1), n: R(5, 5, 5, 5) }))).toEqual([]);
  });
});
