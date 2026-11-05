/* NEW-2 (2026-10-29) — the sheet's multi-range selection model (lib/selectionModel.js): Ctrl+click adds a
 * range, Ctrl+click on a selected cell removes it, Shift extends only the newest range, a plain click
 * collapses, and a command over several ranges is ONE sheet → sheet function (one undo step).
 * Red on main: the module does not exist there (the selection was a single {r1,r2,c1,c2} rectangle). */
import { describe, it, expect } from "vitest";
import {
  rangesOf, isMulti, selContains, selTouchesRow, selTouchesCol, withActive, collapse, addRange,
  toggleCellOut, subtractCell, cellsOf, applyToRanges, makeSelection,
} from "../src/workspaces/model/lib/selectionModel.js";
import { createSheet, setRaw, rawAt, blankRange, setCellStyle, styleAt } from "../src/workspaces/model/lib/sheetModel.js";
import { fillDown, fillTextToCells } from "../src/workspaces/model/lib/sheetOps.js";

const one = (r, c) => ({ r1: r, r2: r, c1: c, c2: c });

describe("selection model — building a multi-range selection", () => {
  it("Ctrl+click A1, C3, E5 leaves three separate ranges with E5 active", () => {
    let sel = one(0, 0);
    sel = addRange(sel, one(2, 2));
    sel = addRange(sel, one(4, 4));
    expect(rangesOf(sel)).toEqual([one(0, 0), one(2, 2), one(4, 4)]);
    expect([sel.r1, sel.c1]).toEqual([4, 4]); // the active cell moved to the newest range
    expect(isMulti(sel)).toBe(true);
  });

  it("a single-rectangle selection is untouched by the new model (no `extra`, one range)", () => {
    const sel = { r1: 1, r2: 3, c1: 2, c2: 4 };
    expect(isMulti(sel)).toBe(false);
    expect(rangesOf(sel)).toEqual([{ r1: 1, r2: 3, c1: 2, c2: 4 }]);
    expect(collapse(sel)).toBe(sel);
  });

  it("selContains / header tint see EVERY range, not only the last", () => {
    const sel = addRange(addRange(one(0, 0), one(2, 2)), { r1: 5, r2: 7, c1: 5, c2: 6 });
    expect(selContains(sel, 0, 0)).toBe(true);
    expect(selContains(sel, 2, 2)).toBe(true);
    expect(selContains(sel, 6, 6)).toBe(true);
    expect(selContains(sel, 1, 1)).toBe(false);
    expect(selTouchesRow(sel, 0)).toBe(true);
    expect(selTouchesRow(sel, 1)).toBe(false);
    expect(selTouchesCol(sel, 6)).toBe(true);
    expect(selTouchesCol(sel, 3)).toBe(false);
  });

  it("Shift extends only the newest range; earlier ranges stay", () => {
    let sel = addRange(one(0, 0), one(2, 2));
    sel = withActive(sel, { r1: 2, c1: 2, r2: 5, c2: 4 });
    expect(rangesOf(sel)).toEqual([one(0, 0), { r1: 2, r2: 5, c1: 2, c2: 4 }]);
  });

  it("a plain click collapses to one range", () => {
    const sel = addRange(addRange(one(0, 0), one(2, 2)), one(4, 4));
    expect(rangesOf(collapse(sel))).toEqual([one(4, 4)]);
    expect(isMulti(collapse(sel))).toBe(false);
  });

  it("makeSelection normalises extra ranges drawn in any direction", () => {
    const sel = makeSelection(one(0, 0), [{ r1: 5, r2: 2, c1: 7, c2: 3 }]);
    expect(sel.extra).toEqual([{ r1: 2, r2: 5, c1: 3, c2: 7 }]);
  });
});

describe("selection model — Ctrl+click on a selected cell deselects it (Excel 365)", () => {
  it("removing a single-cell range drops it and keeps the others", () => {
    const sel = addRange(addRange(one(0, 0), one(2, 2)), one(4, 4));
    const next = toggleCellOut(sel, 2, 2);
    expect(rangesOf(next)).toEqual([one(0, 0), one(4, 4)]);
    expect(selContains(next, 2, 2)).toBe(false);
  });

  it("removing a cell from inside a big range splits it into pieces that cover everything else", () => {
    const g = { r1: 0, r2: 3, c1: 0, c2: 3 };
    const pieces = subtractCell(g, 1, 2);
    const covered = new Set();
    for (const p of pieces) for (let r = p.r1; r <= p.r2; r++) for (let c = p.c1; c <= p.c2; c++) {
      const key = `${r}:${c}`;
      expect(covered.has(key)).toBe(false); // no overlap
      covered.add(key);
    }
    expect(covered.size).toBe(15);
    expect(covered.has("1:2")).toBe(false);
  });

  it("refuses to deselect the only selected cell (Excel always keeps an active cell)", () => {
    const sel = one(3, 3);
    expect(toggleCellOut(sel, 3, 3)).toBe(sel);
  });
});

describe("commands over every range are ONE pure sheet → sheet function", () => {
  const seed = () => {
    let s = createSheet();
    for (const [r, c, v] of [[0, 0, "a"], [2, 2, "b"], [4, 4, "c"], [1, 1, "keep"]]) s = setRaw(s, r, c, v);
    return s;
  };
  const sel = addRange(addRange(one(0, 0), one(2, 2)), one(4, 4));

  it("Delete clears all three ranges and nothing else", () => {
    const s = applyToRanges(seed(), rangesOf(sel), blankRange);
    expect(rawAt(s, 0, 0)).toBe("");
    expect(rawAt(s, 2, 2)).toBe("");
    expect(rawAt(s, 4, 4)).toBe("");
    expect(rawAt(s, 1, 1)).toBe("keep");
  });

  it("bold applies to all three ranges", () => {
    const s = applyToRanges(seed(), rangesOf(sel), setCellStyle, { bold: true });
    expect(styleAt(s, 0, 0).bold).toBe(true);
    expect(styleAt(s, 2, 2).bold).toBe(true);
    expect(styleAt(s, 4, 4).bold).toBe(true);
    expect(styleAt(s, 1, 1).bold).toBeFalsy();
  });

  it("Ctrl+Enter writes the typed value into every selected cell, relocating formulas like a fill", () => {
    const cells = cellsOf(sel);
    expect(cells).toHaveLength(3);
    const text = fillTextToCells(seed(), cells, "42", 4, 4);
    expect([rawAt(text, 0, 0), rawAt(text, 2, 2), rawAt(text, 4, 4)]).toEqual(["42", "42", "42"]);
    const formula = fillTextToCells(seed(), cells, "=A1+1", 4, 4);
    expect(rawAt(formula, 4, 4)).toBe("=A1+1");
    expect(rawAt(formula, 2, 2)).not.toBe("=A1+1"); // shifted by the offset
  });

  it("Ctrl+D fills each range down independently", () => {
    let s = createSheet();
    s = setRaw(s, 0, 0, "x"); s = setRaw(s, 0, 3, "y");
    const out = applyToRanges(s, [{ r1: 0, r2: 2, c1: 0, c2: 0 }, { r1: 0, r2: 1, c1: 3, c2: 3 }], fillDown);
    expect([rawAt(out, 1, 0), rawAt(out, 2, 0), rawAt(out, 1, 3), rawAt(out, 2, 3)]).toEqual(["x", "x", "y", ""]);
  });
});
