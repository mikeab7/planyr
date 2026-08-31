/* Model workspace — copy / paste / fill-down / Ctrl+Arrow block-jump (build-brief follow-up
 * items 6, 7, 12 — live production findings: "copy/paste do nothing", "Ctrl+D does nothing",
 * "Ctrl+End does nothing"). See lib/sheetOps.js's header for why paste/fill share ONE
 * relative-reference transform (the shared engine's rewriteFormulaForCopy).
 */
import { describe, it, expect } from "vitest";
import { createSheet, setRaw, commitCellText, rawAt } from "../src/workspaces/model/lib/sheetModel.js";
import { copyRange, pasteRange, fillDown, ctrlArrowTarget } from "../src/workspaces/model/lib/sheetOps.js";

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
