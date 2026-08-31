/* Model workspace — wiring the sheet to the shared formula engine (src/shared/formula/
 * formula.js), imported directly — these tests exercise the REAL engine, never a stub, so a
 * change to either side of the wire shows up here. */
import { describe, it, expect } from "vitest";
import {
  createSheet, setRaw, setColumnFormula, renameColumn, setNumberFormat, colAt,
} from "../src/workspaces/model/lib/sheetModel.js";
import { evaluateSheet, displayFor, formulaBarText, literalTypedValue } from "../src/workspaces/model/lib/sheetEngine.js";

function sheetWithColumns(names) {
  let s = createSheet();
  names.forEach((n, i) => { s = renameColumn(s, i, n); });
  return s;
}

describe("literalTypedValue", () => {
  it("reads plain numbers, thousands separators, currency and percent as numbers", () => {
    expect(literalTypedValue("1200")).toBe(1200);
    expect(literalTypedValue("1,200.50")).toBe(1200.5);
    expect(literalTypedValue("$1,200")).toBe(1200);
    expect(literalTypedValue("12%")).toBeCloseTo(0.12);
  });
  it("falls back to text for anything else, and TRUE/FALSE to boolean", () => {
    expect(literalTypedValue("Acme LLC")).toBe("Acme LLC");
    expect(literalTypedValue("TRUE")).toBe(true);
  });
});

describe("evaluateSheet — same-row column references", () => {
  it("a formula column reads another column's value in the SAME row", () => {
    let s = sheetWithColumns(["Revenue", "Cost", "NOI"]);
    s = setRaw(s, 0, 0, "1000");
    s = setRaw(s, 0, 1, "400");
    s = setColumnFormula(s, 2, "=[Revenue]-[Cost]");
    const r = evaluateSheet(s);
    const noiCol = colAt(s, 2);
    expect(r.get(noiCol.id, 0)).toEqual({ ok: true, value: 600 });
  });

  it("evaluates independently per row — each row sees its OWN other-column values", () => {
    let s = sheetWithColumns(["Revenue", "Cost", "NOI"]);
    s = setRaw(s, 0, 0, "1000"); s = setRaw(s, 0, 1, "400");
    s = setRaw(s, 1, 0, "500"); s = setRaw(s, 1, 1, "100");
    s = setColumnFormula(s, 2, "=[Revenue]-[Cost]");
    const r = evaluateSheet(s);
    const noiCol = colAt(s, 2);
    expect(r.get(noiCol.id, 0).value).toBe(600);
    expect(r.get(noiCol.id, 1).value).toBe(400);
  });
});

describe("evaluateSheet — whole-column aggregates and formula-of-formula ordering", () => {
  it("SUM over a plain column totals every row, immediately", () => {
    let s = sheetWithColumns(["Rent"]);
    s = setRaw(s, 0, 0, "1000"); s = setRaw(s, 1, 0, "1500"); s = setRaw(s, 2, 0, "800");
    s = setColumnFormula(s, 1, "=SUM([Rent])");
    const r = evaluateSheet(s);
    // A whole-column aggregate must answer identically on EVERY row (it doesn't vary by row).
    expect(r.get(colAt(s, 1).id, 0).value).toBe(3300);
    expect(r.get(colAt(s, 1).id, 2).value).toBe(3300);
  });

  it("a formula column can aggregate ANOTHER formula column — resolved in one pass because", () => {
    // columns are processed in dependency order (planFormulaColumns), so by the time "Total NOI"
    // runs, every row's "NOI" is already computed — no multi-pass / staleness question.
    let s = sheetWithColumns(["Revenue", "Cost", "NOI", "Total NOI"]);
    s = setRaw(s, 0, 0, "1000"); s = setRaw(s, 0, 1, "400");
    s = setRaw(s, 1, 0, "500"); s = setRaw(s, 1, 1, "100");
    s = setColumnFormula(s, 2, "=[Revenue]-[Cost]");
    s = setColumnFormula(s, 3, "=SUM([NOI])");
    const r = evaluateSheet(s);
    expect(r.get(colAt(s, 3).id, 0).value).toBe(1000); // 600 + 400
  });

  it("a circular formula-column reference surfaces as #CIRC!, never an infinite loop", () => {
    let s = sheetWithColumns(["A", "B"]);
    s = setColumnFormula(s, 0, "=[B]+1");
    s = setColumnFormula(s, 1, "=[A]+1");
    const r = evaluateSheet(s);
    expect(r.get(colAt(s, 0).id, 0)).toEqual({ ok: false, error: "#CIRC!", detail: "circular reference between formula columns" });
  });

  it("an unknown column reference is #REF!, not a thrown exception", () => {
    let s = sheetWithColumns(["A"]);
    s = setColumnFormula(s, 0, "=[NoSuchColumn]");
    const r = evaluateSheet(s);
    expect(r.get(colAt(s, 0).id, 0).ok).toBe(false);
    expect(r.get(colAt(s, 0).id, 0).error).toBe("#REF!");
  });

  it("a genuinely unparseable formula is reported, not thrown", () => {
    let s = sheetWithColumns(["A"]);
    s = setColumnFormula(s, 0, "=1+");
    expect(() => evaluateSheet(s)).not.toThrow();
    const r = evaluateSheet(s);
    expect(r.get(colAt(s, 0).id, 0).ok).toBe(false);
  });

  it("a row's #DIV/0! propagates through SUM instead of being silently skipped", () => {
    let s = sheetWithColumns(["Rate", "PerRate"]);
    s = setRaw(s, 0, 0, "0");
    s = setColumnFormula(s, 1, "=1/[Rate]");
    let r = evaluateSheet(s);
    expect(r.get(colAt(s, 1).id, 0).error).toBe("#DIV/0!");

    s = sheetWithColumns(["Rate", "PerRate", "Total"]);
    s = setRaw(s, 0, 0, "0"); s = setRaw(s, 1, 0, "2");
    s = setColumnFormula(s, 1, "=1/[Rate]");
    s = setColumnFormula(s, 2, "=SUM([PerRate])");
    r = evaluateSheet(s);
    expect(r.get(colAt(s, 2).id, 0).ok).toBe(false); // the whole total is an error, not a smaller sum
  });
});

describe("evaluateSheet — a formula column leaves a genuinely empty row blank", () => {
  it("does not compute a confident 0 across hundreds of untouched padding rows", () => {
    let s = sheetWithColumns(["Revenue", "Cost", "NOI"]);
    s = setRaw(s, 0, 0, "1000"); s = setRaw(s, 0, 1, "400");
    s = setColumnFormula(s, 2, "=[Revenue]-[Cost]");
    const r = evaluateSheet(s);
    const noiCol = colAt(s, 2);
    expect(r.get(noiCol.id, 0)).toEqual({ ok: true, value: 600 }); // real data → real answer
    expect(r.get(noiCol.id, 5)).toEqual({ ok: true, value: { k: "blank" } }); // no data → blank, not 0
  });

  it("a formula with NO column reference (a constant) is never suppressed — nothing to be blank about", () => {
    let s = sheetWithColumns(["A"]);
    s = setColumnFormula(s, 0, "=1+1");
    const r = evaluateSheet(s);
    expect(r.get(colAt(s, 0).id, 40)).toEqual({ ok: true, value: 2 });
  });

  it("MUTATION CHECK — the blank-suppression must never mask a genuine #CIRC!", () => {
    // Both columns here are formula columns with no plain data at all, so every reference is
    // "blank" by the naive reading — a check ordered wrong would report this as blank instead
    // of the circular reference it actually is.
    let s = sheetWithColumns(["A", "B"]);
    s = setColumnFormula(s, 0, "=[B]+1");
    s = setColumnFormula(s, 1, "=[A]+1");
    const r = evaluateSheet(s);
    expect(r.get(colAt(s, 0).id, 0).error).toBe("#CIRC!");
  });
});

describe("displayFor — number formats route through the shared formatValue", () => {
  it("formats a literal cell per its column's number format", () => {
    let s = sheetWithColumns(["Rent"]);
    s = setRaw(s, 0, 0, "1234.5");
    s = setNumberFormat(s, [0], "$#,##0.00");
    const r = evaluateSheet(s);
    expect(displayFor(s, r, 0, 0)).toBe("$1,234.50");
  });

  it("formats a FORMULA cell's computed value per its column's number format", () => {
    let s = sheetWithColumns(["Revenue", "Cost", "Margin"]);
    s = setRaw(s, 0, 0, "1000"); s = setRaw(s, 0, 1, "750");
    s = setColumnFormula(s, 2, "=([Revenue]-[Cost])/[Revenue]");
    s = setNumberFormat(s, [2], "0.0%");
    const r = evaluateSheet(s);
    expect(displayFor(s, r, 0, 2)).toBe("25.0%");
  });

  it("an errored formula cell displays its error code, not a formatted NaN", () => {
    let s = sheetWithColumns(["Rate", "Answer"]);
    s = setRaw(s, 0, 0, "0");
    s = setColumnFormula(s, 1, "=1/[Rate]");
    s = setNumberFormat(s, [1], "$#,##0.00");
    const r = evaluateSheet(s);
    expect(displayFor(s, r, 0, 1)).toBe("#DIV/0!");
  });

  it("an empty plain cell displays as empty, not '0' or 'General'", () => {
    const s = sheetWithColumns(["A"]);
    const r = evaluateSheet(s);
    expect(displayFor(s, r, 0, 0)).toBe("");
  });
});

describe("formulaBarText — the underlying formula, never the displayed value", () => {
  it("shows the column's formula verbatim, including its leading '='", () => {
    let s = sheetWithColumns(["Revenue", "Cost", "NOI"]);
    s = setColumnFormula(s, 2, "=[Revenue]-[Cost]");
    s = setNumberFormat(s, [2], "$#,##0.00");
    expect(formulaBarText(s, 0, 2)).toBe("=[Revenue]-[Cost]");
  });

  it("shows a plain cell's raw typed text", () => {
    let s = sheetWithColumns(["A"]);
    s = setRaw(s, 0, 0, "1,234.50");
    expect(formulaBarText(s, 0, 0)).toBe("1,234.50");
  });
});
