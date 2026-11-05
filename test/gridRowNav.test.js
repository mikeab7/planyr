/* NEW-1 (owner report 2026-10-19, B463922 lineage) — Up/Down arrow row navigation in the Schedule grid.
 *
 * "I just click the up or down arrow, and it will like take me all the way up to the top of the schedule or
 * all the way to the bottom." Measured cause: the arrow handler's fallbacks for a selection that is NOT in
 * the visible list (its group folded, or the row deleted) were the first row and the last row. These tests
 * lock `stepGridRow` (src/workspaces/scheduler/lib/gridRowNav.js) and prove the copy inlined in
 * public/sequence/index.html is byte-identical to it. The browser half is
 * ui-audit/verify-grid-keynav-after-commit.mjs.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { stepGridRow } from "../src/workspaces/scheduler/lib/gridRowNav.js";

const NEW = "__NEW_TASK__";
// Full schedule in visual order: 1 Group A { 2, 3 }, 4 Group B { 5, 6, 7 }, 8, 9.
const ALL = [
  { id: 1, parentId: null }, { id: 2, parentId: 1 }, { id: 3, parentId: 1 },
  { id: 4, parentId: null }, { id: 5, parentId: 4 }, { id: 6, parentId: 4 }, { id: 7, parentId: 4 },
  { id: 8, parentId: null }, { id: 9, parentId: null },
];
const flatOf = ids => ids.map(id => ({ id }));
const EXPANDED = flatOf([1, 2, 3, 4, 5, 6, 7, 8, 9]);
const B_FOLDED = flatOf([1, 2, 3, 4, 8, 9]);            // Group B collapsed
const B_FOCUSED = flatOf([1, 2, 3, 4, 5, 7, 8, 9]);     // Focus hid row 6 only

describe("stepGridRow — a selection in the list moves exactly one row (unchanged behaviour)", () => {
  it("↓ and ↑ step one row", () => {
    expect(stepGridRow(EXPANDED, ALL, 5, +1, 4, 0)).toBe(6);
    expect(stepGridRow(EXPANDED, ALL, 5, -1, 4, 0)).toBe(4);
  });
  it("↑ on the first row stays put; ↓ on the last row goes to '+ New task'", () => {
    expect(stepGridRow(EXPANDED, ALL, 1, -1, 0, 0)).toBe(1);
    expect(stepGridRow(EXPANDED, ALL, 9, +1, 8, 0)).toBe(NEW);
  });
  it("from '+ New task', ↑ goes to the last task and ↓ does nothing", () => {
    expect(stepGridRow(EXPANDED, ALL, NEW, -1, 8, 0)).toBe(9);
    expect(stepGridRow(EXPANDED, ALL, NEW, +1, 8, 0)).toBeNull();
  });
});

describe("stepGridRow — THE REPORTED BUG: a lost selection never goes to the first or last row", () => {
  it("cursor on a row inside a FOLDED group: ↓ lands on the row below the group, ↑ on the group row", () => {
    // Old behaviour: both keys → row 1 (findIndex −1 → tasks[0]).
    expect(stepGridRow(B_FOLDED, ALL, 6, +1, 5, 0)).toBe(8);
    expect(stepGridRow(B_FOLDED, ALL, 6, -1, 5, 0)).toBe(4);
  });
  it("cursor on a row a FOCUSED group hid: ↓ / ↑ land on its visible neighbours", () => {
    expect(stepGridRow(B_FOCUSED, ALL, 6, +1, 5, 0)).toBe(7);
    expect(stepGridRow(B_FOCUSED, ALL, 6, -1, 5, 0)).toBe(5);
  });
  it("selected row DELETED (selection null): ↓ lands on the row that slid into its slot, ↑ on the row above", () => {
    // Row at flat index 4 deleted; ids renumbered, so the list is 1..8. Old behaviour: ↓ → row 1, ↑ → row 8 (last).
    const after = flatOf([1, 2, 3, 4, 5, 6, 7, 8]);
    const allAfter = after.map(t => ({ ...t, parentId: null }));
    expect(stepGridRow(after, allAfter, null, +1, 4, 0)).toBe(5);
    expect(stepGridRow(after, allAfter, null, -1, 4, 0)).toBe(4);
  });
  it("deleting the LAST row: ↓ goes to '+ New task', ↑ to the new last row", () => {
    const after = flatOf([1, 2, 3]);
    expect(stepGridRow(after, after, null, +1, 3, 0)).toBe(NEW);
    expect(stepGridRow(after, after, null, -1, 3, 0)).toBe(3);
  });
  it("no known position at all: selects the row at the top of the view, without moving", () => {
    expect(stepGridRow(EXPANDED, ALL, null, +1, null, 5)).toBe(6);
    expect(stepGridRow(EXPANDED, ALL, null, -1, null, 5)).toBe(6);
  });
  it("never returns the first or last row for a lost selection in the middle of a long list", () => {
    const n = 600;
    const all = Array.from({ length: n }, (_, i) => ({ id: i + 1, parentId: null }));
    const flat = all.filter(t => t.id !== 300);           // row 300 hidden
    for (const dir of [+1, -1]) {
      const got = stepGridRow(flat, all, 300, dir, 299, 280);
      expect(got).not.toBe(1);
      expect(got).not.toBe(n);
      expect(got).toBe(dir > 0 ? 301 : 299);
    }
  });
  it("an EMPTY list does nothing — never invents '+ New task' from an empty list", () => {
    expect(stepGridRow([], ALL, 5, +1, 4, 0)).toBeNull();
    expect(stepGridRow([], ALL, null, -1, null, null)).toBeNull();
  });
});

describe("drift guard — the copy inlined in public/sequence/index.html is byte-identical", () => {
  const extractFn = (source, signature) => {
    const start = source.indexOf(signature);
    if (start === -1) return null;
    let depth = 0, i = start, seen = false;
    for (; i < source.length; i++) {
      if (source[i] === "{") { depth++; seen = true; }
      else if (source[i] === "}") { depth--; if (seen && depth === 0) { i++; break; } }
    }
    return source.slice(start, i);
  };
  const SIG = "function stepGridRow(flat, allTasks, selectedId, dir, lastIdx, topIdx) {";
  const html = readFileSync(new URL("../public/sequence/index.html", import.meta.url), "utf8");
  const lib = readFileSync(new URL("../src/workspaces/scheduler/lib/gridRowNav.js", import.meta.url), "utf8");
  it("bodies match character for character", () => {
    const a = extractFn(html, SIG), b = extractFn(lib, "export " + SIG);
    expect(a, "stepGridRow not found in index.html").not.toBeNull();
    expect(b, "stepGridRow not found in gridRowNav.js").not.toBeNull();
    expect("export " + a).toBe(b);
  });
  it("the arrow handler routes BOTH Up and Down through stepGridRow (no inline extreme-row fallback left)", () => {
    expect(html).toMatch(/const target = stepGridRow\(tasks, activeProjectOf\(dataRef\.current\)\?\.tasks \|\| \[\], selectedId,/);
    expect(html).not.toMatch(/findIndex\(t => t\.id === selectedId\) : tasks\.length;/);
    expect(html).not.toMatch(/const next = tasks\[Math\.min\(tasks\.length - 1, idx \+ 1\)\];/);
  });
  it("flatTasksRef is synced in a LAYOUT effect, so a key pressed right after an edit reads the current list", () => {
    expect(html).toMatch(/React\.useLayoutEffect\(\(\) => \{ flatTasksRef\.current = flatTasks; \}, \[flatTasks\]\);/);
  });
});
