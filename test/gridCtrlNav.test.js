/* NEW-1 (B2451776, owner request 2026-10-28) — Ctrl/Cmd+Arrow in the Schedule grid jumps across blank cells
 * like Excel. These tests lock the pure rule (src/workspaces/scheduler/lib/gridCtrlNav.js), prove the copies
 * inlined in public/sequence/index.html are byte-identical to it, and pin the handler's wiring. The browser half
 * is ui-audit/verify-grid-ctrl-arrow.mjs (real keys, real grid, signed in on planyr.io).
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { ctrlJumpIndex, gridCtrlArrowTarget, gridCellBlank } from "../src/workspaces/scheduler/lib/gridCtrlNav.js";

// A column of cells written as a picture: x = filled, . = blank.
const col = s => i => s[i] === ".";
const jump = (s, cur, dir) => ctrlJumpIndex(col(s), s.length, cur, dir);

describe("ctrlJumpIndex — Excel's rule on one line of cells", () => {
  it("both current and next filled → the LAST cell of the run", () => {
    expect(jump("xxxx..x", 0, +1)).toBe(3);
    expect(jump("xxxx..x", 1, +1)).toBe(3);
    expect(jump("x..xxxx", 6, -1)).toBe(3);
  });
  it("a run that reaches the edge ends at the edge", () => {
    expect(jump("..xxxx", 2, +1)).toBe(5);
    expect(jump("xxxx..", 3, -1)).toBe(0);
  });
  it("current BLANK → the next filled cell in that direction", () => {
    expect(jump("..xxx", 0, +1)).toBe(2);
    expect(jump("xx..x", 3, +1)).toBe(4);
    expect(jump("x..x.", 4, -1)).toBe(3);
  });
  it("current BLANK with a filled neighbour → lands on that neighbour, it does NOT ride the run", () => {
    expect(jump(".xxx", 0, +1)).toBe(1);
    expect(jump("xxx.", 3, -1)).toBe(2);
    expect(jump("x.xxx", 1, +1)).toBe(2);
  });
  it("current filled, NEXT blank → the next filled cell AFTER the gap", () => {
    expect(jump("x...x", 0, +1)).toBe(4);
    expect(jump("xx..xx", 1, +1)).toBe(4);
    expect(jump("xx..xx", 4, -1)).toBe(1);
  });
  it("a single filled cell with the gap beyond it is treated as filled-then-blank, not as a run", () => {
    expect(jump("x.x.x", 0, +1)).toBe(2);   // next is blank → next filled after the gap, not "end of run"
    expect(jump("x.x.x", 2, +1)).toBe(4);
  });
  it("no filled cell anywhere ahead → the EDGE", () => {
    expect(jump("x....", 0, +1)).toBe(4);
    expect(jump("....x", 4, -1)).toBe(0);
    expect(jump(".....", 2, +1)).toBe(4);
    expect(jump(".....", 2, -1)).toBe(0);
  });
  it("already on the edge → stays put", () => {
    expect(jump("xxx", 2, +1)).toBe(2);
    expect(jump("xxx", 0, -1)).toBe(0);
    expect(jump("x", 0, +1)).toBe(0);
  });
  it("a start just past the end (the '+ New task' row) counts as blank, and can only go back", () => {
    expect(jump("xx.x", 4, -1)).toBe(3);             // next filled going up
    expect(jump("x...", 4, -1)).toBe(0);             // nothing filled below → the first row
    expect(jump("xx", 2, +1)).toBeNull();            // nowhere further down
  });
  it("nothing to move through → null", () => {
    expect(ctrlJumpIndex(() => true, 0, 0, +1)).toBeNull();
  });
});

describe("gridCtrlArrowTarget — rows, columns, hidden things", () => {
  // Full schedule in visual order: 1 Group A { 2, 3 }, 4 Group B { 5, 6 }, 7, 8.
  // Column 10 ("Cost") is filled on rows 2, 3, 5, 6, 8 only.
  const ALL = [
    { id: 1, hasChildren: true }, { id: 2 }, { id: 3 }, { id: 4, hasChildren: true }, { id: 5 }, { id: 6 }, { id: 7 }, { id: 8 },
  ];
  const FILLED = new Set([2, 3, 5, 6, 8]);
  const visible = hidden => ALL.filter(t => !hidden.has(t.id));
  const targetIn = (flat, key, fromId, colMasters = [1, 10]) => {
    const row = fromId === "NEW" ? flat.length : flat.findIndex(t => t.id === fromId);
    const blankAt = (r, c) => r >= flat.length ? true : (c === 10 ? !FILLED.has(flat[r].id) : false);
    const t = gridCtrlArrowTarget(key, flat.length, colMasters, row, 10, blankAt);
    return t && { id: t.row < flat.length ? flat[t.row].id : "NEW", col: t.col };
  };
  it("expanded: from a filled cell with a filled neighbour, Down rides the run", () => {
    expect(targetIn(visible(new Set()), "ArrowDown", 2)).toEqual({ id: 3, col: 10 });
  });
  it("from the end of a run, Down jumps the gap to the next filled cell", () => {
    expect(targetIn(visible(new Set()), "ArrowDown", 3)).toEqual({ id: 5, col: 10 });
  });
  it("COLLAPSED rows are skipped: with Group B folded (5 and 6 hidden) the jump from 3 lands on 8", () => {
    const flat = visible(new Set([5, 6]));
    expect(targetIn(flat, "ArrowDown", 3)).toEqual({ id: 8, col: 10 });
    expect(targetIn(flat, "ArrowUp", 8)).toEqual({ id: 3, col: 10 });
  });
  it("Up from the last filled cell with nothing above ends on the FIRST task row", () => {
    expect(targetIn(visible(new Set([2, 3, 5, 6])), "ArrowUp", 8)).toEqual({ id: 1, col: 10 });
  });
  it("Down past the last filled cell ends on the LAST task row — never '+ New task'", () => {
    expect(targetIn(visible(new Set()), "ArrowDown", 8)).toEqual({ id: 8, col: 10 });
    expect(targetIn(visible(new Set()), "ArrowDown", 6)).toEqual({ id: 8, col: 10 });
    expect(targetIn(visible(new Set([8])), "ArrowDown", 6)).toEqual({ id: 7, col: 10 });
  });
  it("from '+ New task': Up lands on the nearest filled cell above, Down does nothing", () => {
    expect(targetIn(visible(new Set()), "ArrowUp", "NEW")).toEqual({ id: 8, col: 10 });
    expect(targetIn(visible(new Set([8])), "ArrowUp", "NEW")).toEqual({ id: 6, col: 10 });
    expect(targetIn(visible(new Set()), "ArrowDown", "NEW")).toBeNull();
  });
  it("no rows → null (nothing invented)", () => {
    expect(gridCtrlArrowTarget("ArrowDown", 0, [1, 10], 0, 10, () => true)).toBeNull();
  });

  // One task row: name filled, start filled, duration blank, predecessors blank, cost filled, notes blank.
  const rowCells = { 1: false, 2: false, 3: true, 5: true, 10: false, 11: true };   // true = blank
  const hz = (key, from, colMasters) => gridCtrlArrowTarget(key, 3, colMasters, 1, from, (r, c) => rowCells[c]);
  it("Right/Left jump across a row by VISIBLE column order", () => {
    expect(hz("ArrowRight", 1, [1, 2, 3, 5, 10, 11])?.col).toBe(2);        // run of 2 → ends at 2
    expect(hz("ArrowRight", 2, [1, 2, 3, 5, 10, 11])?.col).toBe(10);       // next blank → next filled
    expect(hz("ArrowRight", 10, [1, 2, 3, 5, 10, 11])?.col).toBe(11);      // trailing blank → the last column
    expect(hz("ArrowLeft", 10, [1, 2, 3, 5, 10, 11])?.col).toBe(2);
    expect(hz("ArrowLeft", 1, [1, 2, 3, 5, 10, 11])?.col).toBe(1);
  });
  it("a HIDDEN column is never a destination and never a stepping stone", () => {
    expect(hz("ArrowRight", 2, [1, 2, 5, 10, 11])?.col).toBe(10);          // 3 hidden; 5 is blank anyway
    expect(hz("ArrowRight", 1, [1, 10, 11])?.col).toBe(10);                // 2 hidden: 1 filled, next (10) filled → end of run
  });
  it("a cursor parked on a hidden column snaps onto the table toward the key", () => {
    expect(hz("ArrowRight", 4, [1, 2, 5, 10])?.col).toBe(5);
    expect(hz("ArrowLeft", 4, [1, 2, 5, 10])?.col).toBe(2);
    expect(hz("ArrowRight", 99, [1, 2, 5, 10])?.col).toBe(10);
  });
});

describe("gridCellBlank — what the grid draws, column by column", () => {
  const env = {
    formula: (id, k) => ({ 7: { f_x: { display: "12" }, f_y: { display: "" } } })[id]?.[k],
    predCount: a => (Array.isArray(a) ? a.length : 0),
    succCount: id => (id === 1 ? 1 : 0),
    ownerCount: t => (Array.isArray(t.responsibleParty) ? t.responsibleParty.length : 0),
    floatDays: t => (t.meetingBound ? 3 : null),
    costDays: () => null,
  };
  const b = (task, k, extra = {}) => gridCellBlank(task, { k, ...extra }, env);
  const leaf = { id: 2, name: "Pour slab", start: "2026-11-02", end: "2026-11-04", duration: 3, predecessors: [], notes: [], responsibleParty: [] };
  const summary = { id: 1, name: "Site work", start: "2026-11-02", end: "2026-11-30", duration: 20, hasChildren: true, isExpanded: true, rolledCost: 5000, notes: [], responsibleParty: [] };

  it("ID, name, dates, duration and % complete are filled on a normal row", () => {
    for (const k of ["id", "name", "start", "end", "duration", "percentComplete"]) expect(b(leaf, k), k).toBe(false);
  });
  it("a SUMMARY row's rolled-up dates, duration and cost are visible values → NOT blank", () => {
    for (const k of ["start", "end", "duration", "cost"]) expect(b(summary, k), k).toBe(false);
  });
  it("an unnamed row (the 'New task' prompt) and a whitespace name are blank", () => {
    expect(b({ ...leaf, name: "" }, "name")).toBe(true);
    expect(b({ ...leaf, name: "   " }, "name")).toBe(true);
    expect(b({ ...leaf, name: null }, "name")).toBe(true);
  });
  it("undated and zero-cost cells are blank", () => {
    expect(b({ ...leaf, start: "" }, "start")).toBe(true);
    expect(b({ ...leaf, end: undefined }, "end")).toBe(true);
    expect(b({ ...leaf, duration: "" }, "duration")).toBe(true);
    expect(b(leaf, "cost")).toBe(true);
    expect(b({ ...leaf, cost: 100 }, "cost")).toBe(false);
    expect(b({ ...leaf, budget: 0 }, "budget")).toBe(true);
    expect(b({ ...leaf, rolledActual: 40 }, "actualCost")).toBe(false);
  });
  it("the OWNER and NOTES '+' placeholders are blank; real values are not", () => {
    expect(b(leaf, "responsibleParty")).toBe(true);
    expect(b({ ...leaf, responsibleParty: ["Dana"] }, "responsibleParty")).toBe(false);
    expect(b(leaf, "notes")).toBe(true);
    expect(b({ ...leaf, notes: [{ date: "2026-10-01", text: "x" }] }, "notes")).toBe(false);
  });
  it("predecessors / successors follow the engine's own lists", () => {
    expect(b(leaf, "predecessors")).toBe(true);
    expect(b({ ...leaf, predecessors: [{ id: 1 }] }, "predecessors")).toBe(false);
    expect(b({ id: 1 }, "successors")).toBe(false);
    expect(b(leaf, "successors")).toBe(true);
  });
  it("Status / Health are blank on an EXPANDED summary (the grid draws nothing), filled otherwise", () => {
    expect(b(summary, "health")).toBe(true);
    expect(b(summary, "status")).toBe(true);
    expect(b({ ...summary, isExpanded: false }, "health")).toBe(false);
    expect(b(leaf, "status")).toBe(false);
  });
  it("Meeting columns: bound / deadline rows are filled; '—' (a summary), '— none —' and 'set up…' are blank", () => {
    expect(b(leaf, "meetingBody")).toBe(true);
    expect(b({ ...leaf, meetingBound: true, meetingBodyId: "x" }, "meetingBody")).toBe(false);
    expect(b({ ...leaf, deadlineForTaskId: 9 }, "meetingBody")).toBe(false);
    expect(b({ ...summary, meetingBound: true }, "meetingBody")).toBe(true);
    expect(b({ ...leaf, meetingBound: true }, "floatToDeadline")).toBe(false);
    expect(b(leaf, "floatToDeadline")).toBe(true);
    expect(b(leaf, "costIfMissed")).toBe(true);
  });
  it("a formula column is blank when it evaluates to nothing", () => {
    expect(gridCellBlank({ id: 7 }, { k: "f_x", t: "formula" }, env)).toBe(false);
    expect(gridCellBlank({ id: 7 }, { k: "f_y", t: "formula" }, env)).toBe(true);
    expect(gridCellBlank({ id: 8 }, { k: "f_x", t: "formula" }, env)).toBe(true);
  });
  it("an unknown column falls back to the raw field", () => {
    expect(b({ ...leaf, custom: "x" }, "custom")).toBe(false);
    expect(b(leaf, "custom")).toBe(true);
  });
});

describe("drift guard — the copies inlined in public/sequence/index.html are byte-identical", () => {
  // Pull `function <name>(…) { … }` out of a source text by brace-matching from its signature.
  const extractFn = (source, sig) => {
    const start = source.indexOf(sig);
    if (start < 0) return null;
    let depth = 0, seen = false, i = source.indexOf("{", start);
    for (; i < source.length; i++) {
      if (source[i] === "{") { depth++; seen = true; }
      else if (source[i] === "}") { depth--; if (seen && depth === 0) { i++; break; } }
    }
    return source.slice(start, i);
  };
  const html = readFileSync(new URL("../public/sequence/index.html", import.meta.url), "utf8");
  const lib = readFileSync(new URL("../src/workspaces/scheduler/lib/gridCtrlNav.js", import.meta.url), "utf8");
  for (const sig of [
    "function ctrlJumpIndex(isBlank, n, cur, dir) {",
    "function gridCtrlArrowTarget(key, rowCount, colMasters, row, col, blankAt) {",
    "function gridCellBlank(task, col, env) {",
  ]) {
    it(`${sig.slice(9, sig.indexOf("("))} — bodies match character for character`, () => {
      const a = extractFn(html, sig), b = extractFn(lib, "export " + sig);
      expect(a, "not found in index.html").not.toBeNull();
      expect(b, "not found in gridCtrlNav.js").not.toBeNull();
      expect("export " + a).toBe(b);
    });
  }
});

describe("the key handler wiring (public/sequence/index.html)", () => {
  const html = readFileSync(new URL("../public/sequence/index.html", import.meta.url), "utf8");
  const at = html.indexOf("NEW-1 (B2451776) — Ctrl/Cmd+Arrow: jump across blank cells");
  const block = at < 0 ? "" : html.slice(at, html.indexOf("// Fix #8: Ctrl/Cmd+Z", at));
  it("exists once, ahead of the Ctrl+Z branch and the plain-arrow branch", () => {
    expect(at).toBeGreaterThan(0);
    expect(html.indexOf("NEW-1 (B2451776) — Ctrl/Cmd+Arrow", at + 10)).toBe(-1);
    expect(at).toBeLessThan(html.indexOf("// Plain arrow keys — cell navigation"));
  });
  it("accepts Ctrl and Meta, declines Alt, and leaves an input / open editor / contentEditable alone", () => {
    expect(block).toMatch(/\(e\.ctrlKey \|\| e\.metaKey\) && !e\.altKey && !typing/);
    expect(block).toMatch(/!document\.activeElement\?\.isContentEditable && !editLiveRef\.current/);
  });
  it("preventDefault runs only after the grid has an anchor to move from", () => {
    const guard = block.indexOf("if (anchorRow < 0) return;");
    const prevent = block.indexOf("e.preventDefault();");
    expect(guard).toBeGreaterThan(0);
    expect(prevent).toBeGreaterThan(guard);
  });
  it("navigates by VISIBLE rows (flatTasksRef) and VISIBLE columns (visibleColIdxs)", () => {
    expect(block).toContain("flatTasksRef.current");
    expect(block).toContain("visibleColIdxs()");
    expect(block).toMatch(/gridCtrlArrowTarget\(e\.key, flat\.length, colMasters,/);
  });
  it("Shift extends the existing selRange from its moving end and asks the grid to reveal it", () => {
    expect(block).toMatch(/gridCtrlArrowTarget\(e\.key, flat\.length, colMasters, cur\.r2, cur\.c2, blankAt\)/);
    expect(block).toContain('"planar-reveal-cell"');
    expect(html).toMatch(/document\.addEventListener\("planar-reveal-cell", on\)/);
  });
});
