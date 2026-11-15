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

describe("planClear — a box the PERSON PLACED never pushes anything (NEW-2, owner 2026-11-15: \"like PowerPoint\")", () => {
  it("a group moved together keeps its arrangement", () => {
    const before = M({ a: R(40, 100, 200, 37), b: R(40, 140, 200, 37) });
    const after = M({ a: R(40, 300, 200, 37), b: R(40, 340, 200, 37) });
    expect(planClear(before, after, new Set(["a", "b"])).size).toBe(0);
  });
  it("dropping a box onto one below, or above, it moves NOTHING when it was placed by hand", () => {
    const before = M({ m: R(500, 400, 200, 37), low: R(40, 300, 200, 37), high: R(40, 100, 200, 37) });
    const down = new Map(before); down.set("m", R(40, 290, 200, 37));
    expect(planClear(before, down, new Set(["m"])).size).toBe(0);
    const up = new Map(before); up.set("m", R(40, 110, 200, 37));
    expect(planClear(before, up, new Set(["m"])).size).toBe(0);
  });
  it("narrowing a box until it grows taller covers the box below and moves NOTHING when the narrowing was a placement", () => {
    const before = page(); const after = page(); after.set("b", R(40, 150, 230, 90));
    expect(planClear(before, after, new Set(["b"])).size).toBe(0);
  });
  it("…but the SAME rectangle change from the box's own words (not placed) still pushes the box below down", () => {
    const before = page(); const after = page(); after.set("b", R(40, 150, 560, 54));
    const plan = planClear(before, after, new Set());
    expect(plan.get("c")).toBe(210);
    expect(plan.get("d")).toBeGreaterThanOrEqual(247 + 6);
  });
  it("one box placed and ANOTHER grown in the same edit: only the grown one pushes", () => {
    const before = M({ g: R(40, 100, 300, 37), below: R(40, 150, 300, 37), p: R(600, 100, 100, 37), under: R(600, 140, 100, 37) });
    const after = new Map(before); after.set("g", R(40, 100, 300, 70)); after.set("p", R(600, 100, 100, 80));
    const plan = planClear(before, after, new Set(["p"]));
    expect(plan.has("below")).toBe(true);
    expect(plan.has("under")).toBe(false);
  });
});

describe("changedIds", () => {
  it("ignores boxes present on only one side", () => {
    expect(changedIds(M({ a: R(0, 0, 1, 1) }), M({ a: R(0, 0, 1, 1), n: R(5, 5, 5, 5) }))).toEqual([]);
  });
});

import { placedBetween } from "../src/workspaces/notes/lib/notesBoxClearPlugin.js";
describe("placedBetween — which boxes had their STORED placement changed by an edit", () => {
  const doc = (boxes) => ({ forEach: (fn) => boxes.forEach((b) => fn({ type: { name: "noteAnchor" }, attrs: b }, 0)) });
  const A = (aid, x, y, w, h = null) => ({ aid, x, y, w, h });
  it("a drop (x / y), a width drag (w) and a nudge are placed; typing (no stored change) is not", () => {
    const before = doc([A("a", 40, 100, 560), A("b", 40, 150, 560), A("c", 40, 190, 560)]);
    const after = doc([A("a", 40, 100, 560), A("b", 40, 150, 230), A("c", 61, 190, 560)]);
    expect(placedBetween(before, after).sort()).toEqual(["b", "c"]);
    expect(placedBetween(before, before)).toEqual([]);
  });
  it("a brand-new box is not 'placed' (it is nobody's to push and pushes nobody it did not already overlap)", () => {
    expect(placedBetween(doc([A("a", 1, 1, 100)]), doc([A("a", 1, 1, 100), A("n", 5, 5, 100)]))).toEqual([]);
  });
});
