/* Model workspace — wiring the sheet to the shared formula engine (src/shared/formula/
 * formula.js), imported directly — these tests exercise the REAL engine, never a stub, so a
 * change to either side of the wire shows up here.
 *
 * ⛔ B891184-FOLLOWUP (2026-08-31): rewritten for the per-cell architecture. Formulas belong to
 * CELLS now, addressed either by A1 (grid[row][col], from the concurrent session's A1-support
 * commit 0d2d1b3e) or by the pre-existing same-row `[Column]` structured references — a formula
 * can use either or both. The old per-COLUMN tests (setColumnFormula, planFormulaColumns
 * ordering across whole columns) are gone; see sheetEngine.js's header for the live-production
 * finding ("=SUM(A1:A2)" converting a whole column) that drove this.
 */
import { describe, it, expect } from "vitest";
import {
  createSheet, setRaw, commitCellText, renameColumn, setNumberFormat, colAt,
} from "../src/workspaces/model/lib/sheetModel.js";
import {
  evaluateSheet, evaluateWorkbook, displayFor, displayKindFor, displayColorFor, formulaBarText,
  literalTypedValue, kindOf, cellAddressText, cellColorKind,
} from "../src/workspaces/model/lib/sheetEngine.js";

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
  // ⛔ B891184-FOLLOWUP: date recognition was entirely missing — "1/15/2027" round-tripped as
  // the plain STRING "1/15/2027", so date arithmetic on a typed date silently failed.
  it("reads a typed date as a DATE typed value (k:'date'), not a string", () => {
    const v = literalTypedValue("1/15/2027");
    expect(v).toMatchObject({ k: "date" });
    expect(typeof v.s).toBe("number");
  });
  it("an ISO date string is also recognized", () => {
    expect(literalTypedValue("2027-01-15")).toMatchObject({ k: "date" });
  });
});

describe("kindOf — the display-alignment vocabulary (item 5)", () => {
  it("classifies every value shape a cell can hold", () => {
    expect(kindOf(100)).toBe("number");
    expect(kindOf(literalTypedValue("1/15/2027"))).toBe("date");
    expect(kindOf(true)).toBe("bool");
    expect(kindOf("hello")).toBe("text");
    expect(kindOf(literalTypedValue(""))).toBe("blank");
  });
});

describe("cellAddressText", () => {
  it("names the A1 address a (rowIndex, colIndex) pair sits at", () => {
    expect(cellAddressText(0, 0)).toBe("A1");
    expect(cellAddressText(4, 2)).toBe("C5");
    expect(cellAddressText(0, 26)).toBe("AA1");
  });
});

describe("evaluateSheet — per-CELL formulas, the core fix", () => {
  it("a formula in ONE cell does not spread to the rest of its column", () => {
    let s = createSheet();
    s = setRaw(s, 0, 0, "500");  // A1
    s = setRaw(s, 1, 0, "300");  // A2 — a plain, independent value
    s = commitCellText(s, 0, 2, "=A1"); // C1
    const r = evaluateSheet(s);
    expect(r.get(0, 2)).toEqual({ ok: true, value: 500 });
    // A2 is untouched — it was never converted into anything by C1's formula.
    expect(displayFor(s, r, 1, 0)).toBe("300");
  });

  it("SUM(A1:A2) over real A1-addressed cells totals correctly — NOT a silent 0", () => {
    // ⛔ THE EXACT LIVE-PRODUCTION REGRESSION: with no A1 grid wired, this used to read every
    // referenced cell as blank and SUM of blanks is a genuine (and therefore misleadingly
    // confident) 0. Wiring ctx.grid from the sheet's own cells is the fix.
    let s = createSheet();
    s = setRaw(s, 0, 1, "100"); // B1
    s = setRaw(s, 1, 1, "200"); // B2
    s = commitCellText(s, 0, 2, "=SUM(B1:B2)"); // C1
    const r = evaluateSheet(s);
    expect(r.get(0, 2)).toEqual({ ok: true, value: 300 });
  });

  it("a bare A1 reference to a REAL, populated cell resolves to its value, never blank", () => {
    let s = createSheet();
    s = setRaw(s, 0, 0, "500"); // A1
    s = commitCellText(s, 3, 0, "=A1"); // A4
    const r = evaluateSheet(s);
    expect(r.get(3, 0)).toEqual({ ok: true, value: 500 });
  });

  it("a reference to a genuinely never-written cell reads as blank — correct, not a defect", () => {
    let s = createSheet();
    s = commitCellText(s, 0, 0, "=A5"); // A5 was never written
    const r = evaluateSheet(s);
    const res = r.get(0, 0);
    expect(res.ok).toBe(true);
    expect(res.value).toEqual({ k: "blank" });
  });

  it("mixes [Column] same-row refs AND A1 refs in the SAME formula", () => {
    let s = sheetWithColumns(["Revenue", "Cost"]);
    s = setRaw(s, 0, 0, "1000"); // Revenue, row 0 -> A1
    s = setRaw(s, 0, 1, "400");  // Cost, row 0 -> B1
    s = commitCellText(s, 0, 2, "=[Revenue]-B1"); // C1: same-row [Revenue] minus A1-addressed B1(=Cost)
    const r = evaluateSheet(s);
    expect(r.get(0, 2)).toEqual({ ok: true, value: 600 });
  });

  it("evaluates independently per row — a DIFFERENT formula in each row of the same column", () => {
    let s = createSheet();
    s = setRaw(s, 0, 0, "10"); s = setRaw(s, 1, 0, "20"); s = setRaw(s, 2, 0, "30");
    s = commitCellText(s, 0, 1, "=A1*2");
    s = commitCellText(s, 1, 1, "=A2*3");
    s = commitCellText(s, 2, 1, "=A3+100");
    const r = evaluateSheet(s);
    expect(r.get(0, 1).value).toBe(20);
    expect(r.get(1, 1).value).toBe(60);
    expect(r.get(2, 1).value).toBe(130);
  });

  it("a formula can read ANOTHER formula cell — resolved in one dependency-ordered pass", () => {
    let s = createSheet();
    s = setRaw(s, 0, 0, "100");        // A1
    s = commitCellText(s, 0, 1, "=A1*2");   // B1 = 200
    s = commitCellText(s, 0, 2, "=B1+1");   // C1 depends on B1
    const r = evaluateSheet(s);
    expect(r.get(0, 2)).toEqual({ ok: true, value: 201 });
  });

  it("a cell-level circular reference surfaces as #CIRC!, never an infinite loop", () => {
    let s = createSheet();
    s = commitCellText(s, 0, 0, "=B1+1"); // A1 depends on B1
    s = commitCellText(s, 0, 1, "=A1+1"); // B1 depends on A1
    const r = evaluateSheet(s);
    expect(r.get(0, 0)).toEqual({ ok: false, error: "#CIRC!", detail: "circular reference between cells" });
    expect(r.get(0, 1).error).toBe("#CIRC!");
  });

  it("a cell referencing ITSELF is a one-node cycle", () => {
    let s = createSheet();
    s = commitCellText(s, 0, 0, "=A1+1");
    const r = evaluateSheet(s);
    expect(r.get(0, 0).error).toBe("#CIRC!");
  });

  it("a [Column] aggregate can read a column where SOME rows are formulas and some are literal", () => {
    let s = sheetWithColumns(["Rent"]);
    s = setRaw(s, 0, 0, "1000");
    s = commitCellText(s, 1, 0, "=500+500"); // row 1 is itself a formula, resolves to 1000
    s = setRaw(s, 2, 0, "800");
    s = commitCellText(s, 0, 1, "=SUM([Rent])");
    const r = evaluateSheet(s);
    expect(r.get(0, 1).value).toBe(2800);
  });
});

describe("evaluateSheet — unresolvable references error loudly, never silently (item 2/10)", () => {
  it("an out-of-bounds / malformed token is #NAME?, not a generic #ERROR! and never a blank/0", () => {
    let s = createSheet();
    s = commitCellText(s, 0, 0, "=ZQXW123"); // beyond column XFD — not a valid address
    const r = evaluateSheet(s);
    expect(r.get(0, 0)).toMatchObject({ ok: false, error: "#NAME?" });
  });

  it("an unknown [Column] name is #REF!, not a thrown exception or a blank", () => {
    let s = sheetWithColumns(["A"]);
    s = commitCellText(s, 0, 0, "=[NoSuchColumn]");
    const r = evaluateSheet(s);
    expect(r.get(0, 0)).toMatchObject({ ok: false, error: "#REF!" });
  });

  it("a genuinely unparseable formula is reported, not thrown", () => {
    let s = createSheet();
    s = commitCellText(s, 0, 0, "=1+");
    expect(() => evaluateSheet(s)).not.toThrow();
    const r = evaluateSheet(s);
    expect(r.get(0, 0).ok).toBe(false);
  });

  it("a row's #DIV/0! propagates through SUM instead of being silently skipped", () => {
    let s = createSheet();
    s = setRaw(s, 0, 0, "0"); s = setRaw(s, 1, 0, "2");
    s = commitCellText(s, 0, 1, "=1/A1");
    s = commitCellText(s, 1, 1, "=1/A2");
    s = commitCellText(s, 2, 1, "=SUM(B1:B2)");
    const r = evaluateSheet(s);
    expect(r.get(0, 1).error).toBe("#DIV/0!");
    expect(r.get(2, 1).ok).toBe(false); // the total is an error, not a smaller sum
  });
});

describe("displayFor / displayKindFor — per-CELL number format (not per-column)", () => {
  it("formats a literal cell per ITS OWN number format", () => {
    let s = createSheet();
    s = setRaw(s, 0, 0, "1234.5");
    s = setNumberFormat(s, 0, 0, 0, 0, "$#,##0.00");
    const r = evaluateSheet(s);
    expect(displayFor(s, r, 0, 0)).toBe("$1,234.50");
    expect(displayKindFor(s, r, 0, 0)).toBe("number");
  });

  // ⛔ THE PRO-FORMA REGRESSION: formatting ONE cell must not repaint every other value already
  // sitting above it in the same column.
  it("formatting one cell leaves a DIFFERENT cell in the same column at General", () => {
    let s = createSheet();
    s = setRaw(s, 0, 0, "2500000"); // Land cost, row 0
    s = setRaw(s, 6, 0, "0.0852207"); // Yield, row 6 — SAME column
    s = setNumberFormat(s, 6, 6, 0, 0, "0.00%");
    const r = evaluateSheet(s);
    expect(displayFor(s, r, 0, 0)).toBe("2500000"); // untouched — still General
    expect(displayFor(s, r, 6, 0)).toBe("8.52%");
  });

  it("formats a FORMULA cell's computed value per its own number format", () => {
    let s = sheetWithColumns(["Revenue", "Cost"]);
    s = setRaw(s, 0, 0, "1000"); s = setRaw(s, 0, 1, "750");
    s = commitCellText(s, 0, 2, "=([Revenue]-[Cost])/[Revenue]");
    s = setNumberFormat(s, 0, 0, 2, 2, "0.0%");
    const r = evaluateSheet(s);
    expect(displayFor(s, r, 0, 2)).toBe("25.0%");
  });

  it("an errored formula cell displays its error code, not a formatted NaN", () => {
    let s = createSheet();
    s = setRaw(s, 0, 0, "0");
    s = commitCellText(s, 0, 1, "=1/A1");
    s = setNumberFormat(s, 0, 0, 1, 1, "$#,##0.00");
    const r = evaluateSheet(s);
    expect(displayFor(s, r, 0, 1)).toBe("#DIV/0!");
    expect(displayKindFor(s, r, 0, 1)).toBe("error");
  });

  it("an empty plain cell displays as empty, not '0' or 'General'", () => {
    const s = createSheet();
    const r = evaluateSheet(s);
    expect(displayFor(s, r, 0, 0)).toBe("");
    expect(displayKindFor(s, r, 0, 0)).toBe("blank");
  });
});

// Stage 2 ribbon (B1007281) — "negatives in red", wired through the number format's own colour
// tag rather than a second per-cell "text color" field: the Accounting preset (numberFormats.js)
// carries [Red] on its negative section, and displayColorFor surfaces it so SheetView can
// actually paint the text.
describe("displayColorFor — the number format's own colour tag ([Red] etc)", () => {
  it("a literal cell's negative value picks up its format's [Red] tag; the positive doesn't", () => {
    let s = createSheet();
    s = setRaw(s, 0, 0, "-1234.5");
    s = setRaw(s, 1, 0, "1234.5");
    s = setNumberFormat(s, 0, 1, 0, 0, "#,##0.00;[Red](#,##0.00)");
    const r = evaluateSheet(s);
    expect(displayColorFor(s, r, 0, 0)).toBe("red");
    expect(displayColorFor(s, r, 1, 0)).toBe(null);
  });
  it("a FORMULA cell's negative computed result picks up the colour too", () => {
    let s = sheetWithColumns(["Revenue", "Cost"]);
    s = setRaw(s, 0, 0, "100"); s = setRaw(s, 0, 1, "900");
    s = commitCellText(s, 0, 2, "=[Revenue]-[Cost]");
    s = setNumberFormat(s, 0, 0, 2, 2, "#,##0;[Red](#,##0)");
    const r = evaluateSheet(s);
    expect(displayColorFor(s, r, 0, 2)).toBe("red");
  });
  it("no number format at all, or a format with no colour tag, is null — never a crash", () => {
    let s = createSheet();
    s = setRaw(s, 0, 0, "-5");
    const r = evaluateSheet(s);
    expect(displayColorFor(s, r, 0, 0)).toBe(null);
    s = setNumberFormat(s, 0, 0, 0, 0, "#,##0");
    const r2 = evaluateSheet(s);
    expect(displayColorFor(s, r2, 0, 0)).toBe(null);
  });
  it("an errored formula cell has no colour (the error code isn't a formatted number)", () => {
    let s = createSheet();
    s = setRaw(s, 0, 0, "0");
    s = commitCellText(s, 0, 1, "=1/A1");
    s = setNumberFormat(s, 0, 0, 1, 1, "#,##0;[Red](#,##0)");
    const r = evaluateSheet(s);
    expect(displayColorFor(s, r, 0, 1)).toBe(null);
  });
});

describe("formulaBarText — the underlying formula, never the displayed value", () => {
  it("shows a cell's formula verbatim, including its leading '='", () => {
    let s = sheetWithColumns(["Revenue", "Cost"]);
    s = commitCellText(s, 0, 2, "=[Revenue]-[Cost]");
    s = setNumberFormat(s, 0, 0, 2, 2, "$#,##0.00");
    expect(formulaBarText(s, 0, 2)).toBe("=[Revenue]-[Cost]");
  });

  it("shows a plain cell's raw typed text", () => {
    let s = createSheet();
    s = setRaw(s, 0, 0, "1,234.50");
    expect(formulaBarText(s, 0, 0)).toBe("1,234.50");
  });
});

// ── evaluateWorkbook — cross-sheet formulas (Stage 3, NEW-1) ────────────────────────────────
function wb(sheets, activeSheetId) {
  return { sheets: sheets.map((s) => ({ id: s.id, name: s.name, sheet: s.sheet })), activeSheetId: activeSheetId || sheets[0].id };
}

describe("evaluateWorkbook — cross-sheet references", () => {
  it("Sheet1!A1 read from a formula on a different sheet resolves to that sheet's value", () => {
    let s1 = createSheet(); s1 = setRaw(s1, 0, 0, "500"); // Sheet1!A1 = 500
    let s2 = createSheet(); s2 = commitCellText(s2, 0, 0, "=Sheet1!A1"); // Sheet2!A1
    const r = evaluateWorkbook(wb([{ id: "sheet1", name: "Sheet1", sheet: s1 }, { id: "sheet2", name: "Sheet2", sheet: s2 }]));
    expect(r.get("sheet2").get(0, 0)).toEqual({ ok: true, value: 500 });
  });

  it("a bare reference stays scoped to the formula's OWN sheet, never bleeds into another", () => {
    let s1 = createSheet(); s1 = setRaw(s1, 0, 0, "111"); // Sheet1!A1
    let s2 = createSheet(); s2 = setRaw(s2, 0, 0, "222"); // Sheet2!A1 — a DIFFERENT value
    s2 = commitCellText(s2, 0, 1, "=A1"); // Sheet2!B1 — bare, must read ITS OWN A1
    const r = evaluateWorkbook(wb([{ id: "sheet1", name: "Sheet1", sheet: s1 }, { id: "sheet2", name: "Sheet2", sheet: s2 }]));
    expect(r.get("sheet2").get(0, 1)).toEqual({ ok: true, value: 222 });
  });

  it("a cross-sheet formula reads ANOTHER cross-sheet formula, resolved in one dependency-ordered pass", () => {
    let s1 = createSheet(); s1 = setRaw(s1, 0, 0, "10"); // Sheet1!A1
    let s2 = createSheet(); s2 = commitCellText(s2, 0, 0, "=Sheet1!A1*2"); // Sheet2!A1 = 20
    let s3 = createSheet(); s3 = commitCellText(s3, 0, 0, "=Sheet2!A1+1"); // Sheet3!A1 depends on Sheet2!A1
    const r = evaluateWorkbook(wb([
      { id: "sheet1", name: "Sheet1", sheet: s1 }, { id: "sheet2", name: "Sheet2", sheet: s2 }, { id: "sheet3", name: "Sheet3", sheet: s3 },
    ]));
    expect(r.get("sheet3").get(0, 0)).toEqual({ ok: true, value: 21 });
  });

  it("a quoted sheet name with spaces resolves the same way", () => {
    let s1 = createSheet(); s1 = setRaw(s1, 0, 0, "7");
    let s2 = createSheet(); s2 = commitCellText(s2, 0, 0, "='My Sheet'!A1");
    const r = evaluateWorkbook(wb([{ id: "sheet1", name: "My Sheet", sheet: s1 }, { id: "sheet2", name: "Sheet2", sheet: s2 }]));
    expect(r.get("sheet2").get(0, 0)).toEqual({ ok: true, value: 7 });
  });

  it("resolution is case-insensitive on the sheet name, matching same-cell A1 case-insensitivity", () => {
    let s1 = createSheet(); s1 = setRaw(s1, 0, 0, "3");
    let s2 = createSheet(); s2 = commitCellText(s2, 0, 0, "=SHEET1!A1");
    const r = evaluateWorkbook(wb([{ id: "sheet1", name: "Sheet1", sheet: s1 }, { id: "sheet2", name: "Sheet2", sheet: s2 }]));
    expect(r.get("sheet2").get(0, 0)).toEqual({ ok: true, value: 3 });
  });

  it("a reference to a sheet name that doesn't exist is a #REF!, not a crash or a silent blank", () => {
    let s1 = createSheet(); s1 = commitCellText(s1, 0, 0, "=NoSuchSheet!A1");
    const r = evaluateWorkbook(wb([{ id: "sheet1", name: "Sheet1", sheet: s1 }]));
    expect(r.get("sheet1").get(0, 0)).toMatchObject({ ok: false, error: "#REF!" });
  });

  it("a SUM over a cross-sheet A1:B2 range totals correctly, never a silent 0", () => {
    let s1 = createSheet();
    s1 = setRaw(s1, 0, 0, "1"); s1 = setRaw(s1, 0, 1, "2"); s1 = setRaw(s1, 1, 0, "3"); s1 = setRaw(s1, 1, 1, "4");
    let s2 = createSheet(); s2 = commitCellText(s2, 0, 0, "=SUM(Sheet1!A1:B2)");
    const r = evaluateWorkbook(wb([{ id: "sheet1", name: "Sheet1", sheet: s1 }, { id: "sheet2", name: "Sheet2", sheet: s2 }]));
    expect(r.get("sheet2").get(0, 0)).toEqual({ ok: true, value: 10 });
  });

  it("a circular reference THROUGH another sheet is caught as #CIRC!, not an infinite loop", () => {
    let s1 = createSheet(); s1 = commitCellText(s1, 0, 0, "=Sheet2!A1+1");
    let s2 = createSheet(); s2 = commitCellText(s2, 0, 0, "=Sheet1!A1+1");
    const r = evaluateWorkbook(wb([{ id: "sheet1", name: "Sheet1", sheet: s1 }, { id: "sheet2", name: "Sheet2", sheet: s2 }]));
    expect(r.get("sheet1").get(0, 0)).toMatchObject({ ok: false, error: "#CIRC!" });
    expect(r.get("sheet2").get(0, 0)).toMatchObject({ ok: false, error: "#CIRC!" });
  });

  it("a hidden (inactive) sheet's formulas still evaluate — every sheet is live, not just the active one", () => {
    let s1 = createSheet(); s1 = setRaw(s1, 0, 0, "5");
    let s2 = createSheet(); s2 = commitCellText(s2, 0, 0, "=Sheet1!A1*10"); // never made active
    const r = evaluateWorkbook(wb([{ id: "sheet1", name: "Sheet1", sheet: s1 }, { id: "sheet2", name: "Sheet2", sheet: s2 }], "sheet1"));
    expect(r.get("sheet2").get(0, 0)).toEqual({ ok: true, value: 50 });
  });

  it("evaluateSheet (single-sheet) is unaffected — same results as before cross-sheet support existed", () => {
    let s = createSheet(); s = setRaw(s, 0, 0, "9"); s = commitCellText(s, 0, 1, "=A1+1");
    expect(evaluateSheet(s).get(0, 1)).toEqual({ ok: true, value: 10 });
  });
});

// ── cellColorKind — input (blue) / formula (black) / cross-sheet link (green) (Stage 3, NEW-2) ─
describe("cellColorKind", () => {
  it("a blank cell classifies as null — nothing to colour", () => {
    const s = createSheet();
    expect(cellColorKind(s, "Sheet1", 0, 0)).toBe(null);
  });
  it("a hardcoded literal value is an 'input'", () => {
    let s = createSheet(); s = setRaw(s, 0, 0, "500");
    expect(cellColorKind(s, "Sheet1", 0, 0)).toBe("input");
  });
  it("a formula that only reads its OWN sheet is 'formula'", () => {
    let s = createSheet(); s = setRaw(s, 0, 0, "1"); s = commitCellText(s, 0, 1, "=A1+1");
    expect(cellColorKind(s, "Sheet1", 0, 1)).toBe("formula");
  });
  it("a formula referencing [Column] only is 'formula' — brackets are always same-sheet", () => {
    let s = createSheet(); s = renameColumn(s, 0, "Revenue"); s = commitCellText(s, 0, 1, "=[Revenue]*2");
    expect(cellColorKind(s, "Sheet1", 0, 1)).toBe("formula");
  });
  it("a formula referencing ANOTHER sheet is 'cross-sheet' even when it also reads this sheet", () => {
    let s = createSheet(); s = commitCellText(s, 0, 0, "=A2+Sheet2!A1");
    expect(cellColorKind(s, "Sheet1", 0, 0)).toBe("cross-sheet");
  });
  it("an explicit self-qualified reference (typed while sitting on that sheet) reads as 'formula', not 'cross-sheet'", () => {
    let s = createSheet(); s = commitCellText(s, 0, 0, "=Sheet1!A2+1");
    expect(cellColorKind(s, "Sheet1", 0, 0)).toBe("formula");
    // The sheet-name match is case-insensitive, matching every other sheet-name comparison in the engine.
    expect(cellColorKind(s, "sheet1", 0, 0)).toBe("formula");
  });
  it("a cross-sheet range (SUM(Sheet2!A1:B2)) is 'cross-sheet'", () => {
    let s = createSheet(); s = commitCellText(s, 0, 0, "=SUM(Sheet2!A1:B2)");
    expect(cellColorKind(s, "Sheet1", 0, 0)).toBe("cross-sheet");
  });
  it("a genuinely unparseable formula still classifies as 'formula' rather than crashing", () => {
    let s = createSheet(); s = commitCellText(s, 0, 0, "=1+");
    expect(() => cellColorKind(s, "Sheet1", 0, 0)).not.toThrow();
    expect(cellColorKind(s, "Sheet1", 0, 0)).toBe("formula");
  });
});
