import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// B2470832 — every summary row (a row with children) gets a Focus button. Owner report 2026-10-28, Grand Port ›
// Master Schedule: Testing Consultants (children in progress), CMT (its one child in progress) and Alternates
// (collapsed) had no funnel while Construction / Contract / Bidding did. The old rule drew the chip only when the row
// was EXPANDED and had something HIDEABLE; the new one is simply "has children". These run the REAL helpers out of
// public/sequence/index.html (sliced from the source, not mirrored). Red-proof: against the pre-fix source
// `rowCanFocus` / `focusGroupIds` / `focusChipTitle` do not exist and everything here fails at extraction, and the
// render-site pins below fail on the old inline `hasChildren && isExpanded && hideableCount > 0` condition.
// The browser half (a real rendered schedule shaped like those rows, Grid + Split) is
// ui-audit/verify-schedule-focus-button.mjs — 26/66 against the old page, 66/66 now.
const src = readFileSync(fileURLToPath(new URL("../public/sequence/index.html", import.meta.url)), "utf8");
const extractFn = (signature) => {
  const start = src.indexOf(signature);
  if (start === -1) throw new Error(`"${signature}" not found in public/sequence/index.html`);
  let depth = 0, i = start, seen = false;
  for (; i < src.length; i++) {
    if (src[i] === "{") { depth++; seen = true; }
    else if (src[i] === "}") { depth--; if (seen && depth === 0) { i++; break; } }
  }
  return src.slice(start, i);
};
const { focusGroupIds, rowCanFocus, focusChipTitle, focusToggleTarget } = new Function(`
  ${extractFn("function focusGroupIds(tasks) {")}
  ${extractFn("function rowCanFocus(row) {")}
  ${extractFn("function focusChipTitle(row) {")}
  ${extractFn("function focusToggleTarget(allTasks, anchorId) {")}
  return { focusGroupIds, rowCanFocus, focusChipTitle, focusToggleTarget };
`)();

// The shapes from the owner's report. Statuses: green done · yellow in progress · red needs attention.
//  1 Testing Consultants (expanded)   — Concrete / CMT / Roofing all in progress: NOTHING hideable
//    2 Concrete   3 CMT (expanded)    — its one child in progress: NOTHING hideable
//      4 Requested proposal
//    5 Roofing
//  6 Alternates (COLLAPSED, complete) — hideable children, but collapsed
//    7 Alt one    8 Alt two
//  9 Level one > 10 Level two > 11 Level three > 12 leaf        (nesting at depth)
// 13 Plain task
const T = (id, parentId, extra = {}) => ({ id, parentId, name: "t" + id, health: "yellow", isExpanded: true, ...extra });
const tasks = [
  T(1, null), T(2, 1), T(3, 1), T(4, 3), T(5, 1, { health: "red" }),
  T(6, null, { health: "green", isExpanded: false }), T(7, 6, { health: "green" }), T(8, 6, { health: "green" }),
  T(9, null), T(10, 9), T(11, 10), T(12, 11),
  T(13, null),
];
// What the grid's flattened list carries per row: hasChildren from focusGroupIds, hideable counts from Focus.
const groups = focusGroupIds(tasks);
const row = (id, hideableCount, extra = {}) => ({ ...tasks.find(t => t.id === id), hasChildren: groups.has(id), hideableCount, hideableDone: 0, hideablePaused: 0, hideableUpcoming: 0, focused: false, ...extra });

describe("which rows are Focus groups", () => {
  it("is every row that has at least one child — at any depth, collapsed or not", () => {
    expect([...groups].sort((a, b) => a - b)).toEqual([1, 3, 6, 9, 10, 11]);
  });
  it("tolerates an empty / missing list and ignores a null parentId", () => {
    expect(focusGroupIds([]).size).toBe(0);
    expect(focusGroupIds(null).size).toBe(0);
    expect(focusGroupIds([{ id: 1, parentId: null }]).size).toBe(0);
  });
});

describe("the Focus button's visibility (rowCanFocus)", () => {
  it("Testing Consultants: expanded, children all in progress (nothing hideable) -> HAS the button", () => {
    expect(rowCanFocus(row(1, 0, { isExpanded: true }))).toBe(true);
  });
  it("CMT: expanded, one in-progress child (nothing hideable) -> HAS the button", () => {
    expect(rowCanFocus(row(3, 0))).toBe(true);
  });
  it("Alternates: COLLAPSED -> HAS the button", () => {
    expect(rowCanFocus(row(6, 2, { isExpanded: false }))).toBe(true);
    expect(rowCanFocus(row(6, 0, { isExpanded: false }))).toBe(true);
  });
  it("nested at any depth, with or without hideable children", () => {
    for (const id of [9, 10, 11]) { expect(rowCanFocus(row(id, 0))).toBe(true); expect(rowCanFocus(row(id, 3))).toBe(true); }
  });
  it("a group that is already Focused keeps its button even when nothing is hideable any more", () => {
    expect(rowCanFocus(row(1, 0, { focused: true }))).toBe(true);
  });
  it("a leaf never has one", () => {
    for (const id of [2, 4, 5, 7, 8, 12, 13]) expect(rowCanFocus(row(id, 0))).toBe(false);
  });
  it("the review list (no hideableCount — it ignores Focus entirely) draws none", () => {
    expect(rowCanFocus({ id: 1, hasChildren: true })).toBe(false);
    expect(rowCanFocus(null)).toBe(false);
  });
});

describe("Alt+F and the button agree on what is a Focus group", () => {
  it("Alt+F targets exactly the rows rowCanFocus says have a button, and each leaf's parent", () => {
    for (const id of groups) expect(focusToggleTarget(tasks, id)).toBe(id);
    expect(focusToggleTarget(tasks, 4)).toBe(3);      // CMT's only child -> CMT
    expect(focusToggleTarget(tasks, 7)).toBe(6);      // inside the collapsed Alternates -> Alternates
    expect(focusToggleTarget(tasks, 13)).toBeNull();  // top-level leaf: no group
  });
});

describe("the tooltip", () => {
  it("keeps the established prefixes and the shortcut in every state", () => {
    expect(focusChipTitle(row(1, 2))).toMatch(/^Focus: hide 2 completed \/ paused \/ not-started tasks \(Alt\+F\)$/);
    expect(focusChipTitle(row(1, 1))).toMatch(/^Focus: hide 1 completed \/ paused \/ not-started task \(Alt\+F\)$/);
    expect(focusChipTitle(row(1, 0))).toMatch(/^Focus: hide .*none right now.*\(Alt\+F\)$/);
    expect(focusChipTitle(row(1, 0, { focused: true, hideableDone: 1, hideablePaused: 0, hideableUpcoming: 2 }))).toMatch(/^Show all tasks in this group — 1 completed, 0 paused, 2 not started hidden \(Alt\+F\)$/);
  });
});

describe("render-site pins", () => {
  it("the chip is drawn on rowCanFocus alone — not on isExpanded or hideableCount", () => {
    expect(src).toMatch(/\{rowCanFocus\(task\) && \(\s*<span\s+data-focus-chip=/);
    expect(src).not.toMatch(/task\.hasChildren && task\.isExpanded && task\.hideableCount > 0/);
  });
  it("hasChildren on both grid lists comes from focusGroupIds (one definition)", () => {
    expect(src).toMatch(/const childSet = focusGroupIds\(proj\.tasks\);/);
    expect(src).toMatch(/const childSet = focusGroupIds\(ts\);/);
  });
});
