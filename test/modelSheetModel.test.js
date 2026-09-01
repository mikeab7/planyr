/* Model workspace — the pure sheet data model. Every mutator must be a real pure function
 * (never mutate its argument) and every no-op edit must return the SAME reference (`toBe`,
 * not `toEqual`) — that property is what makes the workspace's undo stack "no-op edits mint
 * no undo frame" guarantee true. A mutator that starts allocating on a no-op is a silent
 * regression an `toEqual` assertion would never catch, which is why these are asserted by
 * identity everywhere it matters.
 *
 * ⛔ B891184-FOLLOWUP (2026-08-31): rewritten for the per-cell architecture (formulas AND
 * number formats are per-cell now, not per-column — see sheetModel.js's own header for the
 * live-production finding that drove this). setColumnFormula/clearColumnFormula are gone;
 * setNumberFormat now takes a rectangular range, not a list of column indexes.
 */
import { describe, it, expect } from "vitest";
import {
  createSheet, migrateSheet, setRaw, commitCellText, blankRange, renameColumn, setNumberFormat,
  addColumn, deleteColumn, ensureColumnCount, colAt, cellKey, columnIndexByName, formatAt,
  isFormulaText, usedRangeEnd, padRowCount, sheetsDiverge,
  insertColumnAt, insertRowAt, deleteRowAt, setColumnWidth, setRowHeight, rowHeightAt, setFreeze,
  DEFAULT_ROW_H,
} from "../src/workspaces/model/lib/sheetModel.js";

describe("createSheet", () => {
  it("starts with named columns, no cells, no formats, and a real rowCount", () => {
    const s = createSheet();
    expect(s.columns.length).toBeGreaterThan(0);
    expect(s.columns[0].name).toBe("A");
    expect(s.columns[1].name).toBe("B");
    expect(s.cells).toEqual({});
    expect(s.formats).toEqual({});
    expect(s.rowCount).toBeGreaterThan(0);
    // No `formula` or `format` field on a column any more — both are per-cell now.
    expect(s.columns[0]).not.toHaveProperty("formula");
    expect(s.columns[0]).not.toHaveProperty("format");
  });

  // ⛔ STAGE 1 (owner report, 2026-09-01, verbatim: "it's kind of embarrassing that it only
  // goes up to H at first load … this should be a full blown model") — the regression this
  // guards is exactly that: an 8-column, 200-row default that stopped at H on first paint.
  it("starts at 26 columns (A..Z) and 1000+ rows — never the old 8-column/200-row ceiling", () => {
    const s = createSheet();
    expect(s.columns.length).toBe(26);
    expect(s.columns[25].name).toBe("Z");
    expect(s.rowCount).toBeGreaterThanOrEqual(1000);
  });

  it("columns extend past Z (AA, AB…) on demand — never a hard cap", () => {
    let s = createSheet();
    for (let i = 0; i < 5; i++) s = addColumn(s); // Z is index 25; 5 more -> AA..AE
    expect(s.columns[26].name).toBe("AA");
    expect(s.columns[30].name).toBe("AE");
  });

  it("freeze starts at 0/0 (no freeze) and rowHeights starts empty", () => {
    const s = createSheet();
    expect(s.freezeRows).toBe(0);
    expect(s.freezeCols).toBe(0);
    expect(s.rowHeights).toEqual({});
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

describe("isFormulaText", () => {
  it("a leading '=' (optionally after whitespace) marks formula text", () => {
    expect(isFormulaText("=1+1")).toBe(true);
    expect(isFormulaText("  =1+1")).toBe(true);
    expect(isFormulaText("100")).toBe(false);
    expect(isFormulaText("")).toBe(false);
    expect(isFormulaText(null)).toBe(false);
  });
});

describe("setRaw / commitCellText — per-cell, formula OR literal, uniformly", () => {
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

  // ⛔ THE WHOLE POINT OF THIS SESSION'S REWRITE: a formula in ONE cell must never touch its
  // neighbours. The shipped v1 converted the entire column; this is the regression guard.
  it("a formula in ONE cell does not touch the cell next to it in the same column", () => {
    let s = createSheet();
    s = setRaw(s, 0, 0, "100"); // A1
    s = setRaw(s, 1, 0, "200"); // A2
    const withFormula = commitCellText(s, 3, 0, "=A1+A2"); // A4, independent
    expect(withFormula.cells[`${colAt(s, 0).id}:0`]).toBe("100"); // A1 untouched
    expect(withFormula.cells[`${colAt(s, 0).id}:1`]).toBe("200"); // A2 untouched
    expect(withFormula.cells[`${colAt(s, 0).id}:3`]).toBe("=A1+A2"); // A4 holds ONLY its own formula
  });

  it("a formula cell and a literal cell can sit in the SAME column, different rows", () => {
    let s = createSheet();
    s = setRaw(s, 0, 0, "100");
    s = setRaw(s, 1, 0, "=A1*2");
    expect(s.cells[`${colAt(s, 0).id}:0`]).toBe("100");
    expect(s.cells[`${colAt(s, 0).id}:1`]).toBe("=A1*2");
  });

  it("commitCellText is the same path as setRaw — no column-wide promotion/demotion logic left", () => {
    const s = commitCellText(createSheet(), 0, 0, "=[B]*2");
    expect(s.cells[`${colAt(s, 0).id}:0`]).toBe("=[B]*2");
    // The cell NEXT TO IT (same column, next row) is untouched and independently editable.
    const withNeighbor = commitCellText(s, 1, 0, "plain value");
    expect(withNeighbor.cells[`${colAt(s, 0).id}:0`]).toBe("=[B]*2");
    expect(withNeighbor.cells[`${colAt(s, 0).id}:1`]).toBe("plain value");
  });
});

describe("blankRange — Delete over a rectangular selection", () => {
  it("clears every cell in the range (formula or literal) and leaves cells outside it alone", () => {
    let s = createSheet();
    s = setRaw(s, 0, 0, "a"); s = setRaw(s, 1, 0, "=1+1"); s = setRaw(s, 0, 1, "c"); s = setRaw(s, 5, 5, "outside");
    const cleared = blankRange(s, 0, 1, 0, 1);
    expect(cleared.cells[`${colAt(s, 0).id}:0`]).toBeUndefined();
    expect(cleared.cells[`${colAt(s, 0).id}:1`]).toBeUndefined(); // a formula cell clears too — matches Excel
    expect(cleared.cells[`${colAt(s, 1).id}:0`]).toBeUndefined();
    expect(cleared.cells[`${colAt(s, 5).id}:5`]).toBe("outside");
  });

  it("is a no-op (same reference) over a range with nothing in it", () => {
    const s = createSheet();
    expect(blankRange(s, 0, 5, 0, 5)).toBe(s);
  });

  it("a formula cell OUTSIDE the range is left alone, even in the same column", () => {
    let s = createSheet();
    s = setRaw(s, 0, 0, "=1+1");
    s = setRaw(s, 5, 0, "keep-me");
    const cleared = blankRange(s, 0, 0, 0, 0);
    expect(cleared.cells[`${colAt(s, 0).id}:0`]).toBeUndefined();
    expect(cleared.cells[`${colAt(s, 0).id}:5`]).toBe("keep-me");
  });
});

describe("setNumberFormat — per CELL range, not per column", () => {
  it("applies a format token to every cell in the range, leaving cells outside it alone", () => {
    const s = setNumberFormat(createSheet(), 0, 1, 0, 0, "$#,##0.00");
    expect(formatAt(s, 0, 0)).toBe("$#,##0.00");
    expect(formatAt(s, 1, 0)).toBe("$#,##0.00");
    expect(formatAt(s, 2, 0)).toBeNull(); // row 2 outside the range
    expect(formatAt(s, 0, 1)).toBeNull(); // column 1 outside the range
  });

  // ⛔ THE REGRESSION THIS EXISTS FOR: formatting ONE cell as a percent must never repaint the
  // dollar amounts sitting above it in the same column — found live building this session's own
  // verification pro-forma (a "Yield on cost" cell formatted as a percent turned "Land cost"
  // 2500000 into "250000000.00%" under the old per-column design).
  it("formatting one cell does not affect a DIFFERENT cell in the same column", () => {
    let s = createSheet();
    s = setRaw(s, 0, 0, "2500000");   // Land cost
    s = setRaw(s, 6, 0, "0.0852207"); // Yield on cost
    const formatted = setNumberFormat(s, 6, 6, 0, 0, "0.00%");
    expect(formatAt(formatted, 0, 0)).toBeNull();      // Land cost's format is untouched
    expect(formatAt(formatted, 6, 0)).toBe("0.00%");   // only the targeted cell changed
  });

  it("is a no-op (same reference) re-applying the format every touched cell already has", () => {
    const s = setNumberFormat(createSheet(), 0, 0, 0, 0, "0.0%");
    expect(setNumberFormat(s, 0, 0, 0, 0, "0.0%")).toBe(s); // MUTATION CHECK
  });

  it("null clears back to General and null == null is still a no-op", () => {
    const s = createSheet();
    expect(setNumberFormat(s, 0, 0, 0, 0, null)).toBe(s);
  });

  it("clearing a set format actually removes the stored key (round-trips to null)", () => {
    let s = setNumberFormat(createSheet(), 0, 0, 0, 0, "0.0%");
    s = setNumberFormat(s, 0, 0, 0, 0, null);
    expect(formatAt(s, 0, 0)).toBeNull();
    expect(Object.keys(s.formats)).toHaveLength(0);
  });
});

describe("addColumn / ensureColumnCount / deleteColumn", () => {
  it("adds a column with a fresh id and a lettered default name", () => {
    const s = createSheet();
    const withCol = addColumn(s);
    expect(withCol.columns.length).toBe(s.columns.length + 1);
    expect(withCol.columns.at(-1).id).not.toBe(s.columns[0].id);
  });

  it("ensureColumnCount grows to at least the given width and is a no-op once wide enough", () => {
    const s = createSheet();
    const wide = ensureColumnCount(s, s.columns.length + 3);
    expect(wide.columns.length).toBe(s.columns.length + 3);
    expect(ensureColumnCount(wide, wide.columns.length)).toBe(wide); // MUTATION CHECK
    expect(ensureColumnCount(wide, wide.columns.length - 1)).toBe(wide); // already wide enough
  });

  it("deletes a column and every cell AND format stored under it, leaving others intact", () => {
    let s = createSheet();
    s = setRaw(s, 0, 0, "keep-col-0");
    s = setRaw(s, 0, 1, "delete-col-1");
    s = setNumberFormat(s, 0, 0, 1, 1, "0.0%");
    const col1Id = colAt(s, 1).id;
    const next = deleteColumn(s, 1);
    expect(next.columns.length).toBe(s.columns.length - 1);
    expect(Object.keys(next.cells).some((k) => k.startsWith(`${col1Id}:`))).toBe(false);
    expect(Object.keys(next.formats).some((k) => k.startsWith(`${col1Id}:`))).toBe(false); // TOMBSTONE-DELETES
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

describe("usedRangeEnd — what Ctrl+End jumps to", () => {
  it("null on a genuinely empty sheet", () => {
    expect(usedRangeEnd(createSheet())).toBeNull();
  });

  it("the max row and max column that actually hold something", () => {
    let s = createSheet();
    s = setRaw(s, 2, 0, "x");
    s = setRaw(s, 5, 3, "y");
    s = setRaw(s, 1, 7, "z");
    expect(usedRangeEnd(s)).toEqual({ row: 5, col: 7 });
  });

  it("ignores a cell that was written then cleared back to empty", () => {
    let s = createSheet();
    s = setRaw(s, 9, 2, "gone");
    s = setRaw(s, 9, 2, "");
    expect(usedRangeEnd(s)).toBeNull();
  });
});

describe("padRowCount", () => {
  it("never drops below the 200-row floor (item 9 — no artificial ceiling)", () => {
    expect(padRowCount(createSheet(), 5)).toBeGreaterThanOrEqual(200);
  });

  it("grows past the floor for a taller viewport", () => {
    expect(padRowCount(createSheet(), 500)).toBeGreaterThan(200);
  });
});

describe("migrateSheet — never guesses at a shape it does not recognize", () => {
  it("round-trips a sheet this version already produced, formats included", () => {
    let s = setRaw(createSheet(), 0, 0, "x");
    s = setNumberFormat(s, 0, 0, 0, 0, "0.0%");
    const round = migrateSheet(JSON.parse(JSON.stringify(s)));
    expect(round.cells).toEqual(s.cells);
    expect(round.formats).toEqual(s.formats);
  });

  it("returns a fresh empty sheet for garbage / unversioned input, never throws", () => {
    expect(() => migrateSheet(null)).not.toThrow();
    expect(() => migrateSheet({ garbage: true })).not.toThrow();
    expect(migrateSheet({ garbage: true }).columns.length).toBeGreaterThan(0);
  });

  it("drops an OLD column-level `formula`/`format` field cleanly rather than crashing on it", () => {
    const old = createSheet();
    old.columns[0].formula = "=1+1"; // shape from the FIRST shipped version
    old.columns[0].format = "0.0%";
    const migrated = migrateSheet(JSON.parse(JSON.stringify(old)));
    expect(migrated.columns[0]).not.toHaveProperty("formula");
    expect(migrated.columns[0]).not.toHaveProperty("format");
  });

  it("missing `formats` on an otherwise-valid old blob migrates to an empty object, not a crash", () => {
    const old = createSheet();
    delete old.formats;
    const migrated = migrateSheet(JSON.parse(JSON.stringify(old)));
    expect(migrated.formats).toEqual({});
  });
});

// B891184-FOLLOWUP-2 (2026-08-31) — the cross-device silent-overwrite guard. ModelApp.jsx keeps
// showing this device's own local sheet on load even when a cloud copy also exists ("local
// always wins on load"); this is what tells it whether that's actually SAFE (the two are the
// same content — most opens of the SAME device that made the last save) or DANGEROUS (a second
// device's stale copy is about to silently clobber the first device's saved cloud work).
describe("sheetsDiverge — the cross-device divergence check", () => {
  it("identical content (round-tripped through JSON, as the cloud row is) does not diverge", () => {
    const s = setRaw(createSheet(), 0, 0, "100");
    expect(sheetsDiverge(s, JSON.parse(JSON.stringify(s)))).toBe(false);
  });

  it("a real content difference (a different cell value) DOES diverge", () => {
    const a = setRaw(createSheet(), 0, 0, "100");
    const b = setRaw(createSheet(), 0, 0, "999");
    expect(sheetsDiverge(a, b)).toBe(true);
  });

  it("a formula vs. its own evaluated-looking literal still diverges (raw text, not evaluated)", () => {
    const a = setRaw(createSheet(), 0, 0, "=1+2");
    const b = setRaw(createSheet(), 0, 0, "3");
    expect(sheetsDiverge(a, b)).toBe(true);
  });

  it("a format-only difference (same values, different number format) diverges too", () => {
    const base = setRaw(createSheet(), 0, 0, "100");
    const a = setNumberFormat(base, 0, 0, 0, 0, "0.0%");
    const b = setNumberFormat(base, 0, 0, 0, 0, "$#,##0");
    expect(sheetsDiverge(a, b)).toBe(true);
  });
});

// ⛔ STAGE 1 — structural row/column insert & delete, WITH formula reference shifting. "This
// is the piece you deferred; it is now required, and it is the classically underestimated one"
// (owner brief, 2026-09-01). rewriteFormulaForStructuralShift itself is exhaustively unit-tested
// against hand-derived Excel semantics in test/formula.test.js; these tests prove sheetModel.js
// actually WIRES it in — relocating the right cells and touching every formula in the sheet, not
// just the ones that moved.
describe("insertColumnAt — columns are identity-keyed, so only formulas need rewriting", () => {
  it("inserts a blank column at the given position, shifting later columns right", () => {
    let s = createSheet();
    const origB = colAt(s, 1).id;
    s = insertColumnAt(s, 1); // insert before B
    expect(s.columns.length).toBe(27);
    expect(s.columns[1].name).toBe("B"); // the new column's default name reflects its position
    expect(colAt(s, 2).id).toBe(origB); // the OLD "B" column's data is untouched by identity
  });

  it("a formula elsewhere referencing a column at/after the insertion shifts its column ref", () => {
    let s = createSheet();
    s = setRaw(s, 0, 3, "=D1+1"); // in column D (index 3), referencing itself
    s = insertColumnAt(s, 1); // insert before B — D shifts to E
    // The formula physically stayed in the SAME column object (now at index 4, still "D1+1"'s owner)
    const dCol = colAt(s, 4);
    expect(s.cells[`${dCol.id}:0`]).toBe("=E1+1");
  });

  it("a formula BEFORE the insertion point is untouched", () => {
    let s = createSheet();
    s = setRaw(s, 0, 0, "=A1+1");
    s = insertColumnAt(s, 5);
    expect(s.cells[`${colAt(s, 0).id}:0`]).toBe("=A1+1");
  });
});

describe("deleteColumn — now also shifts every remaining formula's column references", () => {
  it("a formula referencing the DELETED column becomes #REF!", () => {
    let s = createSheet();
    s = setRaw(s, 0, 5, "=B1+1"); // column F (index 5) references column B
    s = deleteColumn(s, 1); // delete column B
    const fCol = colAt(s, 4); // F shifted to index 4
    expect(s.cells[`${fCol.id}:0`]).toBe("=#REF!+1");
  });

  it("a formula referencing a column AFTER the deleted one shifts left", () => {
    let s = createSheet();
    s = setRaw(s, 0, 0, "=D1+1"); // column A references column D
    s = deleteColumn(s, 1); // delete column B
    expect(s.cells[`${colAt(s, 0).id}:0`]).toBe("=C1+1");
  });

  it("still refuses to delete the last remaining column (unchanged guard)", () => {
    let s = createSheet();
    while (s.columns.length > 1) s = deleteColumn(s, 0);
    const before = s;
    expect(deleteColumn(s, 0)).toBe(before);
  });
});

describe("insertRowAt / deleteRowAt — rows relocate storage keys AND shift formula refs", () => {
  it("insertRowAt relocates a cell at/after the insertion point down by one", () => {
    let s = createSheet();
    s = setRaw(s, 4, 0, "hello");
    s = insertRowAt(s, 2); // insert before row index 2 (row 3, 1-based)
    expect(s.cells[`${colAt(s, 0).id}:5`]).toBe("hello"); // row 4 (0-based) -> row 5
    expect(s.rowCount).toBe(1001);
  });

  it("insertRowAt leaves a cell BEFORE the insertion point in place", () => {
    let s = createSheet();
    s = setRaw(s, 1, 0, "kept");
    s = insertRowAt(s, 5);
    expect(s.cells[`${colAt(s, 0).id}:1`]).toBe("kept");
  });

  it("insertRowAt shifts a formula's row references sheet-wide, not just the cell that moved", () => {
    let s = createSheet();
    s = setRaw(s, 0, 0, "=A10+1"); // stays at row 0, references row 10 (which moves)
    s = insertRowAt(s, 5); // row 10 (index 9) shifts to index 10 -> A11
    expect(s.cells[`${colAt(s, 0).id}:0`]).toBe("=A11+1");
  });

  it("deleteRowAt removes the row's own cells and shifts everything below up by one", () => {
    let s = createSheet();
    s = setRaw(s, 3, 0, "gone");
    s = setRaw(s, 5, 0, "shifts up");
    s = deleteRowAt(s, 3);
    expect(s.cells[`${colAt(s, 0).id}:4`]).toBe("shifts up"); // was row 5, now row 4
    expect(Object.values(s.cells)).not.toContain("gone");
    expect(s.rowCount).toBe(999);
  });

  it("deleteRowAt turns a reference to the deleted row into #REF!, sheet-wide", () => {
    let s = createSheet();
    s = setRaw(s, 0, 0, "=A6+1"); // references row index 5 (row 6, 1-based)
    s = deleteRowAt(s, 5);
    expect(s.cells[`${colAt(s, 0).id}:0`]).toBe("=#REF!+1");
  });

  it("a real pro-forma shape: inserting a row inside a SUM range grows the total, deleting one shrinks it", () => {
    // A1:A3 = 10, 20, 30; A5 = SUM(A1:A3)
    let s = createSheet();
    s = setRaw(s, 0, 0, "10"); s = setRaw(s, 1, 0, "20"); s = setRaw(s, 2, 0, "30");
    s = setRaw(s, 4, 0, "=SUM(A1:A3)");
    s = insertRowAt(s, 2); // insert before row index 2 (the "30" row) — range should grow to A1:A4
    expect(s.cells[`${colAt(s, 0).id}:5`]).toBe("=SUM(A1:A4)"); // SUM formula shifted from row 4 to row 5
    // Now delete the newly-inserted blank row back out — range shrinks back to A1:A3
    const back = deleteRowAt(s, 2);
    expect(back.cells[`${colAt(back, 0).id}:4`]).toBe("=SUM(A1:A3)");
  });

  it("deleteRowAt relocates a row-height override along with the row it belongs to", () => {
    let s = createSheet();
    s = setRowHeight(s, 5, 60);
    s = deleteRowAt(s, 2); // row 5 shifts up to row 4
    expect(rowHeightAt(s, 4)).toBe(60);
    expect(rowHeightAt(s, 5)).toBe(DEFAULT_ROW_H);
  });

  it("insertRowAt/deleteRowAt never shrink the sheet below 1 row", () => {
    let s = createSheet();
    for (let i = 0; i < 2000; i++) s = deleteRowAt(s, 0);
    expect(s.rowCount).toBeGreaterThanOrEqual(1);
  });
});

describe("setColumnWidth / setRowHeight / rowHeightAt — drag-resize", () => {
  it("setColumnWidth clamps to a sane floor and is a pure setter", () => {
    let s = createSheet();
    s = setColumnWidth(s, 0, 200);
    expect(colAt(s, 0).width).toBe(200);
    s = setColumnWidth(s, 0, -50);
    expect(colAt(s, 0).width).toBeGreaterThanOrEqual(24);
  });

  it("setColumnWidth is a no-op (same reference) when the width doesn't actually change", () => {
    let s = createSheet();
    s = setColumnWidth(s, 0, 200);
    expect(setColumnWidth(s, 0, 200)).toBe(s);
  });

  it("rowHeightAt reads DEFAULT_ROW_H until overridden, then the override", () => {
    let s = createSheet();
    expect(rowHeightAt(s, 3)).toBe(DEFAULT_ROW_H);
    s = setRowHeight(s, 3, 50);
    expect(rowHeightAt(s, 3)).toBe(50);
  });

  it("setRowHeight back to the default REMOVES the override rather than storing it redundantly", () => {
    let s = createSheet();
    s = setRowHeight(s, 3, 50);
    s = setRowHeight(s, 3, DEFAULT_ROW_H);
    expect(s.rowHeights[3]).toBeUndefined();
  });
});

describe("setFreeze — top rows / left columns, clamped to the sheet's real size", () => {
  it("sets freezeRows/freezeCols and is a pure no-op setter when unchanged", () => {
    let s = createSheet();
    s = setFreeze(s, 1, 2);
    expect(s.freezeRows).toBe(1);
    expect(s.freezeCols).toBe(2);
    expect(setFreeze(s, 1, 2)).toBe(s);
  });

  it("clamps to the sheet's actual row/column count — never freezes more than exists", () => {
    let s = createSheet();
    s = setFreeze(s, 99999, 99999);
    expect(s.freezeRows).toBe(s.rowCount);
    expect(s.freezeCols).toBe(s.columns.length);
  });
});

describe("migrateSheet — backward compatible with a pre-Stage-1 blob", () => {
  it("a blob with no rowHeights/freezeRows/freezeCols defaults them cleanly, never crashes", () => {
    const old = createSheet();
    delete old.rowHeights; delete old.freezeRows; delete old.freezeCols;
    const migrated = migrateSheet(JSON.parse(JSON.stringify(old)));
    expect(migrated.rowHeights).toEqual({});
    expect(migrated.freezeRows).toBe(0);
    expect(migrated.freezeCols).toBe(0);
  });

  it("round-trips real rowHeights/freeze state through JSON", () => {
    let s = createSheet();
    s = setRowHeight(s, 4, 44);
    s = setFreeze(s, 1, 1);
    const migrated = migrateSheet(JSON.parse(JSON.stringify(s)));
    expect(migrated.rowHeights).toEqual({ 4: 44 });
    expect(migrated.freezeRows).toBe(1);
    expect(migrated.freezeCols).toBe(1);
  });
});

// B1000960 (owner report, 2026-09-01) — an EXISTING sheet saved before Stage 1 shipped (8
// columns, 200 rows, the app's old defaults) must not stay pinned to that old shape forever.
// Capacity is a floor derived on every load, never a stored ceiling — this is the actual
// defect: he opened a real pre-Stage-1 sheet and saw the old 8-column grid, because the OLD
// migrateSheet just echoed back whatever `columns`/`rowCount` the saved blob already held.
describe("migrateSheet — an old sheet's saved capacity is a FLOOR, never a stored ceiling (B1000960)", () => {
  function preStage1Blob(colCount, rowCount) {
    const columns = Array.from({ length: colCount }, (_, i) => ({
      id: `c${i + 1}`, name: String.fromCharCode(65 + i), width: 120,
    }));
    return { version: 1, nextColId: colCount + 1, columns, rowCount, cells: {}, formats: {} };
  }

  it("an 8-column/200-row pre-Stage-1 sheet migrates UP to the current 26-column/1000-row floor", () => {
    const migrated = migrateSheet(preStage1Blob(8, 200));
    expect(migrated.columns.length).toBe(26);
    expect(migrated.rowCount).toBe(1000);
  });

  it("preserves every existing cell's data untouched by the padding — same id, same row index", () => {
    const old = preStage1Blob(8, 200);
    old.cells["c3:5"] = "42";
    old.cells["c8:199"] = "=SUM(c1:c2)";
    const migrated = migrateSheet(old);
    expect(migrated.cells["c3:5"]).toBe("42");
    expect(migrated.cells["c8:199"]).toBe("=SUM(c1:c2)");
    // The old columns keep their own ids/names — padding APPENDS new columns, it never
    // renumbers or replaces the ones that already held real data.
    expect(migrated.columns[2].id).toBe("c3");
    expect(migrated.columns.slice(0, 8).map((c) => c.name)).toEqual(["A", "B", "C", "D", "E", "F", "G", "H"]);
  });

  it("a sheet ALREADY at or above the floor is never truncated back down", () => {
    const wide = preStage1Blob(30, 1200);
    const migrated = migrateSheet(wide);
    expect(migrated.columns.length).toBe(30);
    expect(migrated.rowCount).toBe(1200);
  });

  it("padded columns get fresh, non-colliding ids continuing from the blob's own nextColId", () => {
    const migrated = migrateSheet(preStage1Blob(8, 200));
    const ids = migrated.columns.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length); // no id collisions
    expect(ids.slice(8)).toEqual(["c9", "c10", "c11", "c12", "c13", "c14", "c15", "c16", "c17", "c18",
      "c19", "c20", "c21", "c22", "c23", "c24", "c25", "c26"]);
  });

  it("migrating an already-migrated sheet a second time is a no-op (idempotent, never re-grows)", () => {
    const once = migrateSheet(preStage1Blob(8, 200));
    const twice = migrateSheet(JSON.parse(JSON.stringify(once)));
    expect(twice.columns.length).toBe(26);
    expect(twice.rowCount).toBe(1000);
  });
});
