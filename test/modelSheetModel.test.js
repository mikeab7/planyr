/* Model workspace — the pure sheet data model. Every mutator must be a real pure function
 * (never mutate its argument) and every no-op edit must return the SAME reference (`toBe`,
 * not `toEqual`) — that property is what makes the workspace's undo stack "no-op edits mint
 * no undo frame" guarantee true. A mutator that starts allocating on a no-op is a silent
 * regression an `toEqual` assertion would never catch, which is why these are asserted by
 * identity everywhere it matters.
 */
import { describe, it, expect } from "vitest";
import {
  createSheet, migrateSheet, setRaw, blankRange, renameColumn, setNumberFormat,
  setColumnFormula, clearColumnFormula, commitCellText, addColumn, deleteColumn,
  colAt, cellKey, columnIndexByName,
} from "../src/workspaces/model/lib/sheetModel.js";

describe("createSheet", () => {
  it("starts with named columns, no cells, and a real rowCount", () => {
    const s = createSheet();
    expect(s.columns.length).toBeGreaterThan(0);
    expect(s.columns[0].name).toBe("A");
    expect(s.columns[1].name).toBe("B");
    expect(s.cells).toEqual({});
    expect(s.rowCount).toBeGreaterThan(0);
  });
});

describe("cell addressing lives in the data layer", () => {
  it("colAt / cellKey resolve (rowIndex, colIndex) through the column's stable id, not position", () => {
    const s = createSheet();
    const col0 = colAt(s, 0);
    expect(cellKey(col0.id, 3)).toBe(`${col0.id}:3`);
    // Renaming a column changes its NAME but not its id, so previously-written cells stay
    // addressable — the whole point of keying storage on id rather than name/position.
    const renamed = renameColumn(s, 0, "Revenue");
    expect(colAt(renamed, 0).id).toBe(col0.id);
  });
});

describe("setRaw — plain-column literal edits", () => {
  it("writes a cell and grows rowCount when it types past the end", () => {
    const s = createSheet();
    const past = s.rowCount + 40;
    const next = setRaw(s, past, 0, "1200");
    expect(next.rowCount).toBe(past + 1);
    expect(next.cells[`${colAt(s, 0).id}:${past}`]).toBe("1200");
  });

  it("is a true no-op (same reference) when the text does not change anything", () => {
    const s = createSheet();
    const withValue = setRaw(s, 0, 0, "100");
    const again = setRaw(withValue, 0, 0, "100");
    expect(again).toBe(withValue); // MUTATION CHECK: drop the equality guard and this fails
  });

  it("is a true no-op writing empty text to an already-empty cell", () => {
    const s = createSheet();
    expect(setRaw(s, 0, 0, "")).toBe(s);
  });

  it("clears a cell (and does not just store an empty string) when text is deleted", () => {
    const s = createSheet();
    const withValue = setRaw(s, 0, 0, "100");
    const cleared = setRaw(withValue, 0, 0, "");
    expect(Object.prototype.hasOwnProperty.call(cleared.cells, `${colAt(s, 0).id}:0`)).toBe(false);
  });

  it("refuses to write into a FORMULA column", () => {
    const s = setColumnFormula(createSheet(), 0, "=1+1");
    const attempted = setRaw(s, 0, 0, "hello");
    expect(attempted).toBe(s);
  });
});

describe("blankRange — Delete over a rectangular selection", () => {
  it("clears every plain cell in the range and leaves cells outside it alone", () => {
    let s = createSheet();
    s = setRaw(s, 0, 0, "a"); s = setRaw(s, 1, 0, "b"); s = setRaw(s, 0, 1, "c"); s = setRaw(s, 5, 5, "outside");
    const cleared = blankRange(s, 0, 1, 0, 1);
    expect(cleared.cells[`${colAt(s, 0).id}:0`]).toBeUndefined();
    expect(cleared.cells[`${colAt(s, 0).id}:1`]).toBeUndefined();
    expect(cleared.cells[`${colAt(s, 1).id}:0`]).toBeUndefined();
    expect(cleared.cells[`${colAt(s, 5).id}:5`]).toBe("outside");
  });

  it("is a no-op (same reference) over a range with nothing in it", () => {
    const s = createSheet();
    expect(blankRange(s, 0, 5, 0, 5)).toBe(s);
  });

  it("skips FORMULA-column cells — Delete over a computed column changes nothing there", () => {
    let s = createSheet();
    s = setColumnFormula(s, 0, "=1+1");
    const cleared = blankRange(s, 0, 5, 0, 0);
    expect(cleared).toBe(s); // nothing to blank: the formula itself is untouched by Delete
    expect(colAt(cleared, 0).formula).toBe("=1+1");
  });
});

describe("formulas are per-column (setColumnFormula / clearColumnFormula)", () => {
  it("setting a formula strips any existing literal cells for that column", () => {
    let s = createSheet();
    s = setRaw(s, 0, 0, "100");
    s = setRaw(s, 1, 0, "200");
    const withFormula = setColumnFormula(s, 0, "=1+1");
    expect(colAt(withFormula, 0).formula).toBe("=1+1");
    expect(Object.keys(withFormula.cells).some((k) => k.startsWith(`${colAt(s, 0).id}:`))).toBe(false);
  });

  it("is a no-op (same reference) re-setting the identical formula text", () => {
    const s = setColumnFormula(createSheet(), 0, "=1+1");
    expect(setColumnFormula(s, 0, "=1+1")).toBe(s); // MUTATION CHECK
  });

  it("clearing a column with no formula is a no-op", () => {
    const s = createSheet();
    expect(clearColumnFormula(s, 0)).toBe(s);
  });

  it("clearing a formula column turns it back into an empty plain column", () => {
    const s = setColumnFormula(createSheet(), 0, "=1+1");
    const cleared = clearColumnFormula(s, 0);
    expect(colAt(cleared, 0).formula).toBeNull();
  });
});

describe("commitCellText — the one path every cell edit goes through", () => {
  it("typing '=…' turns the column into a formula column", () => {
    const s = commitCellText(createSheet(), 0, 0, "=[B]*2");
    expect(colAt(s, 0).formula).toBe("=[B]*2");
  });

  it("typing a plain value into a FORMULA column demotes it back to plain data", () => {
    let s = setColumnFormula(createSheet(), 0, "=1+1");
    s = commitCellText(s, 2, 0, "42");
    expect(colAt(s, 0).formula).toBeNull();
    expect(s.cells[`${colAt(s, 0).id}:2`]).toBe("42");
  });

  it("a plain edit to an already-plain column behaves exactly like setRaw", () => {
    const s = commitCellText(createSheet(), 0, 0, "hello");
    expect(s.cells[`${colAt(s, 0).id}:0`]).toBe("hello");
  });
});

describe("setNumberFormat", () => {
  it("applies a format token to every column index given", () => {
    const s = setNumberFormat(createSheet(), [0, 1], "$#,##0.00");
    expect(colAt(s, 0).format).toBe("$#,##0.00");
    expect(colAt(s, 1).format).toBe("$#,##0.00");
    expect(colAt(s, 2).format).toBeNull();
  });

  it("is a no-op (same reference) re-applying the format every touched column already has", () => {
    const s = setNumberFormat(createSheet(), [0], "0.0%");
    expect(setNumberFormat(s, [0], "0.0%")).toBe(s); // MUTATION CHECK
  });

  it("null clears back to General and null == null is still a no-op", () => {
    const s = createSheet();
    expect(setNumberFormat(s, [0], null)).toBe(s);
  });
});

describe("addColumn / deleteColumn", () => {
  it("adds a column with a fresh id and a lettered default name", () => {
    const s = createSheet();
    const withCol = addColumn(s);
    expect(withCol.columns.length).toBe(s.columns.length + 1);
    expect(withCol.columns.at(-1).id).not.toBe(s.columns[0].id);
  });

  it("deletes a column and every cell stored under it, leaving others intact", () => {
    let s = createSheet();
    s = setRaw(s, 0, 0, "keep-col-0");
    s = setRaw(s, 0, 1, "delete-col-1");
    const col1Id = colAt(s, 1).id;
    const next = deleteColumn(s, 1);
    expect(next.columns.length).toBe(s.columns.length - 1);
    expect(Object.keys(next.cells).some((k) => k.startsWith(`${col1Id}:`))).toBe(false);
    expect(next.cells[`${colAt(s, 0).id}:0`]).toBe("keep-col-0");
  });

  it("refuses to delete the last remaining column", () => {
    let s = createSheet();
    while (s.columns.length > 1) s = deleteColumn(s, 0);
    expect(deleteColumn(s, 0)).toBe(s);
  });
});

describe("columnIndexByName", () => {
  it("finds a column case-insensitively by its display name", () => {
    const s = renameColumn(createSheet(), 2, "Purchase Price");
    expect(columnIndexByName(s, "purchase price")).toBe(2);
    expect(columnIndexByName(s, "nope")).toBe(-1);
  });
});

describe("migrateSheet — never guesses at a shape it does not recognize", () => {
  it("round-trips a sheet this version already produced", () => {
    const s = setRaw(createSheet(), 0, 0, "x");
    const round = migrateSheet(JSON.parse(JSON.stringify(s)));
    expect(round.cells).toEqual(s.cells);
  });

  it("returns a fresh empty sheet for garbage / unversioned input, never throws", () => {
    expect(() => migrateSheet(null)).not.toThrow();
    expect(() => migrateSheet({ garbage: true })).not.toThrow();
    expect(migrateSheet({ garbage: true }).columns.length).toBeGreaterThan(0);
  });
});
