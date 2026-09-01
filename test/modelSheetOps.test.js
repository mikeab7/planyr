/* Model workspace — copy / paste / fill-down / Ctrl+Arrow block-jump (build-brief follow-up
 * items 6, 7, 12 — live production findings: "copy/paste do nothing", "Ctrl+D does nothing",
 * "Ctrl+End does nothing"). See lib/sheetOps.js's header for why paste/fill share ONE
 * relative-reference transform (the shared engine's rewriteFormulaForCopy).
 */
import { describe, it, expect } from "vitest";
import { createSheet, setRaw, commitCellText, rawAt } from "../src/workspaces/model/lib/sheetModel.js";
import {
  copyRange, pasteRange, fillDown, ctrlArrowTarget,
  parseNameBoxAddress, findMatches, replaceAll,
} from "../src/workspaces/model/lib/sheetOps.js";

describe("copyRange / pasteRange", () => {
  it("copies literal values verbatim to a new location", () => {
    let s = createSheet();
    s = setRaw(s, 0, 0, "500"); // A1
    s = setRaw(s, 1, 0, "300"); // A2
    const clip = copyRange(s, 0, 1, 0, 0);
    const pasted = pasteRange(s, 0, 3, clip); // paste at D1
    expect(rawAt(pasted, 0, 3)).toBe("500");
    expect(rawAt(pasted, 1, 3)).toBe("300");
    // the SOURCE range is untouched
    expect(rawAt(pasted, 0, 0)).toBe("500");
  });

  it("shifts a formula's relative A1 references by the paste delta", () => {
    let s = createSheet();
    s = commitCellText(s, 0, 2, "=A1"); // C1
    const clip = copyRange(s, 0, 0, 2, 2);
    // C1 -> D5: delta col +1, delta row +4. A1 (col1,row1) shifts to B5 (col2,row5).
    const pasted = pasteRange(s, 4, 3, clip);
    expect(rawAt(pasted, 4, 3)).toBe("=B5");
  });

  it("leaves a [Column] structured reference completely untouched — it is same-row by meaning", () => {
    let s = createSheet();
    s = commitCellText(s, 0, 1, "=[A]*2"); // B1
    const clip = copyRange(s, 0, 0, 1, 1);
    const pasted = pasteRange(s, 9, 5, clip);
    expect(rawAt(pasted, 9, 5)).toBe("=[A]*2");
  });

  it("a paste onto itself (zero delta) leaves a formula's references unchanged", () => {
    let s = createSheet();
    s = commitCellText(s, 2, 2, "=A1");
    const clip = copyRange(s, 2, 2, 2, 2);
    const pasted = pasteRange(s, 2, 2, clip);
    expect(rawAt(pasted, 2, 2)).toBe("=A1");
  });

  it("extends the sheet's column count when the paste lands past the last column (item 9)", () => {
    let s = createSheet();
    const startCols = s.columns.length;
    s = setRaw(s, 0, 0, "x");
    const clip = copyRange(s, 0, 0, 0, 0);
    const pasted = pasteRange(s, 0, startCols + 2, clip); // 3 columns past the end
    expect(pasted.columns.length).toBeGreaterThan(startCols);
    expect(rawAt(pasted, 0, startCols + 2)).toBe("x");
  });

  it("tiles the clipboard when the destination selection is a whole multiple of its size", () => {
    let s = createSheet();
    s = setRaw(s, 0, 0, "v"); // one cell
    const clip = copyRange(s, 0, 0, 0, 0);
    // Selection is 4 rows tall (rows 0-3), clip is 1 row -> tiles 4 times down column D.
    const pasted = pasteRange(s, 0, 3, clip, 3, 3);
    expect(rawAt(pasted, 0, 3)).toBe("v");
    expect(rawAt(pasted, 1, 3)).toBe("v");
    expect(rawAt(pasted, 2, 3)).toBe("v");
    expect(rawAt(pasted, 3, 3)).toBe("v");
  });

  it("does nothing on an empty/absent clipboard", () => {
    const s = createSheet();
    expect(pasteRange(s, 0, 0, null)).toBe(s);
  });
});

describe("fillDown — Ctrl+D", () => {
  it("fills the top row's value down through the rest of the selection", () => {
    let s = createSheet();
    s = setRaw(s, 0, 0, "100"); // A1
    const filled = fillDown(s, 0, 3, 0, 0);
    expect(rawAt(filled, 1, 0)).toBe("100");
    expect(rawAt(filled, 2, 0)).toBe("100");
    expect(rawAt(filled, 3, 0)).toBe("100");
  });

  it("shifts a formula's relative references per row, like dragging Excel's fill handle", () => {
    let s = createSheet();
    s = setRaw(s, 0, 0, "500"); // A1
    s = setRaw(s, 1, 0, "300"); // A2
    s = setRaw(s, 2, 0, "999"); // A3
    s = commitCellText(s, 0, 0, "500"); // keep A1 as-is (re-affirm)
    s = commitCellText(s, 20, 0, "=A1+1"); // A21
    const filled = fillDown(s, 20, 23, 0, 0);
    expect(rawAt(filled, 21, 0)).toBe("=A2+1");
    expect(rawAt(filled, 22, 0)).toBe("=A3+1");
    expect(rawAt(filled, 23, 0)).toBe("=A4+1");
  });

  it("fills across every column in a multi-column selection independently", () => {
    let s = createSheet();
    s = setRaw(s, 0, 0, "a"); s = setRaw(s, 0, 1, "b");
    const filled = fillDown(s, 0, 2, 0, 1);
    expect(rawAt(filled, 1, 0)).toBe("a"); expect(rawAt(filled, 1, 1)).toBe("b");
    expect(rawAt(filled, 2, 0)).toBe("a"); expect(rawAt(filled, 2, 1)).toBe("b");
  });

  it("is a no-op on a single-row selection (nothing below the source row to fill)", () => {
    const s = setRaw(createSheet(), 0, 0, "x");
    expect(fillDown(s, 0, 0, 0, 0)).toBe(s);
  });
});

describe("ctrlArrowTarget — Excel's block-jump (Ctrl+Arrow)", () => {
  const gridHas = (occupied) => (r, c) => occupied.has(`${r}:${c}`);

  it("from a BLANK start, jumps to the first occupied cell in that direction", () => {
    const has = gridHas(new Set(["5:0"]));
    const t = ctrlArrowTarget(has, 200, 8, 0, 0, 1, 0); // down, from blank A1
    expect(t).toEqual({ r: 5, c: 0 });
  });

  it("from a blank start with NOTHING further in that direction, lands on the sheet edge", () => {
    const has = gridHas(new Set());
    const t = ctrlArrowTarget(has, 200, 8, 0, 0, 1, 0); // down, nothing anywhere
    expect(t).toEqual({ r: 199, c: 0 });
  });

  it("from an OCCUPIED start with an occupied run, stops at the LAST occupied cell of the run", () => {
    const has = gridHas(new Set(["0:0", "1:0", "2:0", "3:0"])); // rows 0-3 occupied, 4 blank
    const t = ctrlArrowTarget(has, 200, 8, 0, 0, 1, 0);
    expect(t).toEqual({ r: 3, c: 0 });
  });

  it("from an occupied start whose neighbour is BLANK, skips to the next occupied cell", () => {
    const has = gridHas(new Set(["0:0", "5:0"])); // A1 occupied, blank gap, A6 occupied
    const t = ctrlArrowTarget(has, 200, 8, 0, 0, 1, 0);
    expect(t).toEqual({ r: 5, c: 0 });
  });

  it("Ctrl+Home direction analogue: moving left/up from an edge does not go out of bounds", () => {
    const has = gridHas(new Set());
    const t = ctrlArrowTarget(has, 200, 8, 0, 0, -1, 0); // already at the top edge
    expect(t).toEqual({ r: 0, c: 0 }); // cannot move further
  });

  it("works on the column axis identically to the row axis", () => {
    const has = gridHas(new Set(["0:0", "0:1", "0:2"])); // row 0, columns A-C occupied
    const t = ctrlArrowTarget(has, 200, 8, 0, 0, 0, 1); // right
    expect(t).toEqual({ r: 0, c: 2 });
  });
});

// ⛔ STAGE 1 — the Name Box (owner brief: "Name box that ACCEPTS typed input to jump", Ctrl+G).
// B1007280 — the return shape is now a normalized rectangle { r1, c1, r2, c2 } always (a
// single cell has r1===r2, c1===c2), so the SAME function and the SAME caller wiring handle
// both "go to one cell" and "select this range" — see the file header on why a range is
// rejected WHOLE rather than partially landing on whichever side happened to parse.
describe("parseNameBoxAddress", () => {
  it("parses a plain A1-style address into a normalized single-cell rectangle", () => {
    expect(parseNameBoxAddress("C50", 1000, 26)).toEqual({ r1: 49, c1: 2, r2: 49, c2: 2 });
    expect(parseNameBoxAddress("a1", 1000, 26)).toEqual({ r1: 0, c1: 0, r2: 0, c2: 0 }); // case-insensitive
  });
  it("accepts $-anchored text the same as plain (the Name Box has no concept of relative/absolute)", () => {
    expect(parseNameBoxAddress("$C$50", 1000, 26)).toEqual({ r1: 49, c1: 2, r2: 49, c2: 2 });
  });
  it("rejects garbage rather than guessing", () => {
    expect(parseNameBoxAddress("not an address", 1000, 26)).toBe(null);
    expect(parseNameBoxAddress("", 1000, 26)).toBe(null);
  });
  it("rejects an address OUTSIDE the sheet's current bounds — Name Box jumps within today's sheet, never past it", () => {
    expect(parseNameBoxAddress("Z1", 1000, 26)).toEqual({ r1: 0, c1: 25, r2: 0, c2: 25 }); // Z = col 26, within a 26-col sheet
    expect(parseNameBoxAddress("AA1", 1000, 26)).toBe(null); // col 27, one past a 26-col sheet
    expect(parseNameBoxAddress("A1001", 1000, 26)).toBe(null); // row 1001, one past a 1000-row sheet
  });

  it("parses a range in either corner order, normalized to top-left/bottom-right", () => {
    expect(parseNameBoxAddress("C50:E60", 1000, 26)).toEqual({ r1: 49, c1: 2, r2: 59, c2: 4 });
    // Excel's own Name Box accepts the corners in EITHER order — the bottom-right cell typed
    // first is just as valid a range as the top-left cell typed first.
    expect(parseNameBoxAddress("E60:C50", 1000, 26)).toEqual({ r1: 49, c1: 2, r2: 59, c2: 4 });
  });
  it("a single-cell range (both corners the same cell) is just that one cell", () => {
    expect(parseNameBoxAddress("C50:C50", 1000, 26)).toEqual({ r1: 49, c1: 2, r2: 49, c2: 2 });
  });
  it("rejects a range WHOLE if either side is malformed — never a partial jump to the side that parsed", () => {
    expect(parseNameBoxAddress("C50:QQ", 1000, 26)).toBe(null);
    expect(parseNameBoxAddress("QQ:C50", 1000, 26)).toBe(null);
  });
  it("rejects a range WHOLE if either side is out of the sheet's current bounds", () => {
    expect(parseNameBoxAddress("C50:AA60", 1000, 26)).toBe(null); // AA is col 27, past a 26-col sheet
    expect(parseNameBoxAddress("A1001:C50", 1000, 26)).toBe(null); // row 1001, past a 1000-row sheet
  });
  it("rejects a triple-colon shape (not a range the Name Box understands)", () => {
    expect(parseNameBoxAddress("A1:B2:C3", 1000, 26)).toBe(null);
  });
});

// ⛔ STAGE 1 — Find and Replace (owner brief: "Ctrl+F and Ctrl+H").
describe("findMatches", () => {
  it("finds every cell whose raw text contains the needle, case-insensitive", () => {
    let s = createSheet();
    s = setRaw(s, 0, 0, "Revenue");
    s = setRaw(s, 3, 2, "revenue growth");
    s = setRaw(s, 5, 1, "Cost");
    expect(findMatches(s, "revenue")).toEqual([{ r: 0, c: 0 }, { r: 3, c: 2 }]);
  });
  it("an empty needle matches nothing (not 'everything')", () => {
    let s = createSheet();
    s = setRaw(s, 0, 0, "x");
    expect(findMatches(s, "")).toEqual([]);
  });
  it("matches a FORMULA cell's raw text, not its computed value", () => {
    let s = createSheet();
    s = setRaw(s, 0, 0, "=SUM(A1:A2)");
    expect(findMatches(s, "SUM")).toEqual([{ r: 0, c: 0 }]);
  });
});

describe("replaceAll", () => {
  it("replaces every occurrence across every matching cell in one pass", () => {
    let s = createSheet();
    s = setRaw(s, 0, 0, "Revenue 2026");
    s = setRaw(s, 1, 0, "Total Revenue");
    const r = replaceAll(s, "Revenue", "Income");
    expect(rawAt(r, 0, 0)).toBe("Income 2026");
    expect(rawAt(r, 1, 0)).toBe("Total Income");
  });
  it("replaces MULTIPLE occurrences within the SAME cell", () => {
    let s = createSheet();
    s = setRaw(s, 0, 0, "foo foo foo");
    expect(rawAt(replaceAll(s, "foo", "bar"), 0, 0)).toBe("bar bar bar");
  });
  it("is case-insensitive but preserves the REPLACEMENT text's own case exactly as typed", () => {
    let s = createSheet();
    s = setRaw(s, 0, 0, "REVENUE and revenue");
    expect(rawAt(replaceAll(s, "revenue", "Income"), 0, 0)).toBe("Income and Income");
  });
  it("a literal regex-special character in Find matches itself, not a pattern", () => {
    let s = createSheet();
    s = setRaw(s, 0, 0, "=A1*0.05");
    expect(rawAt(replaceAll(s, "A1*0.05", "A2*0.10"), 0, 0)).toBe("=A2*0.10");
  });
  it("a no-op (nothing matches) returns the SAME sheet reference — no undo frame minted for nothing", () => {
    let s = createSheet();
    s = setRaw(s, 0, 0, "hello");
    expect(replaceAll(s, "nomatch", "x")).toBe(s);
  });
  it("an empty find is a no-op, not a crash", () => {
    let s = createSheet();
    expect(replaceAll(s, "", "x")).toBe(s);
  });
});
