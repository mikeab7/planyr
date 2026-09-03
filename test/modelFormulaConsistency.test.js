/* Model workspace — Stage 3 (NEW-2, owner brief 2026-09-03): inconsistent-formula detection.
 * The classic modelling error: one cell in a run of formulas was overtyped with a hardcoded
 * number, or a formula that quietly skips a term. These tests exercise the REAL formula parser
 * (src/shared/formula/formula.js), never a stub AST.
 */
import { describe, it, expect } from "vitest";
import { createSheet, setRaw, commitCellText } from "../src/workspaces/model/lib/sheetModel.js";
import { findInconsistencies } from "../src/workspaces/model/lib/formulaConsistency.js";

function flagAt(flags, row, col) { return flags.find((f) => f.row === row && f.col === col); }

describe("hardcoded constant inside a formula run — the highest-value case", () => {
  it("flags a plain number overtyped into a column of otherwise-identical formulas", () => {
    let s = createSheet();
    for (let r = 0; r < 5; r++) {
      s = setRaw(s, r, 1, String(10 + r));
      s = setRaw(s, r, 2, "2");
      s = commitCellText(s, r, 0, `=B${r + 1}*C${r + 1}`);
    }
    s = setRaw(s, 2, 0, "5000"); // row 3 (index 2) overtyped with a plain number
    const flags = findInconsistencies(s);
    const f = flagAt(flags, 2, 0);
    expect(f).toBeTruthy();
    expect(f.kind).toBe("hardcoded");
    expect(f.axes).toContain("col");
  });

  it("does NOT flag a short run — no pattern to break yet (precision over recall)", () => {
    let s = createSheet();
    s = commitCellText(s, 0, 0, "=A2*2");
    s = setRaw(s, 1, 0, "999"); // only 2 cells in the run — MIN_RUN_LEN not met
    const flags = findInconsistencies(s);
    expect(flags).toHaveLength(0);
  });

  it("a genuinely mixed run (no majority shape) asserts NOTHING — nothing to break", () => {
    let s = createSheet();
    s = commitCellText(s, 0, 0, "=A2");
    s = commitCellText(s, 1, 0, "=B2*C2");
    s = setRaw(s, 2, 0, "42");
    const flags = findInconsistencies(s);
    expect(flags).toHaveLength(0);
  });
});

describe("differing literal values inside the SAME formula shape — never a false positive", () => {
  it("=B2*1.05 and =B3*1.06 (different growth rates) are the SAME structural pattern", () => {
    let s = createSheet();
    for (let r = 0; r < 5; r++) {
      s = setRaw(s, r, 1, String(100 + r * 10));
      s = commitCellText(s, r, 0, `=B${r + 1}*${(1.05 + r * 0.01).toFixed(2)}`);
    }
    const flags = findInconsistencies(s);
    expect(flags).toHaveLength(0);
  });
});

describe("a genuine structural break — a formula that skips a column or adds a stray term", () => {
  it("=B4*C4+100 is flagged against a run of =B{r}*C{r}", () => {
    let s = createSheet();
    for (let r = 0; r < 5; r++) {
      s = setRaw(s, r, 1, String(10 + r));
      s = setRaw(s, r, 2, "3");
      s = commitCellText(s, r, 0, `=B${r + 1}*C${r + 1}`);
    }
    s = commitCellText(s, 2, 0, "=B3*C3+100"); // row index 2, mid-run — a real structural break
    const flags = findInconsistencies(s);
    const f = flagAt(flags, 2, 0);
    expect(f).toBeTruthy();
    expect(f.kind).toBe("shape-mismatch");
  });

  it("a formula referencing a DIFFERENT named range than its neighbours is flagged", () => {
    let s = createSheet();
    for (let r = 0; r < 4; r++) s = commitCellText(s, r, 0, "=Revenue");
    s = commitCellText(s, 4, 0, "=Cost"); // a genuinely different reference, same run
    const flags = findInconsistencies(s);
    expect(flagAt(flags, 4, 0)).toBeTruthy();
  });
});

describe("$-anchored references — an invariant coordinate reads as the SAME pattern down a column", () => {
  it("a shared tax-rate cell multiplied every row is NOT flagged as inconsistent", () => {
    let s = createSheet();
    for (let r = 0; r < 6; r++) {
      s = setRaw(s, r, 1, String(100 + r * 5));
      s = commitCellText(s, r, 0, `=B${r + 1}*$C$1`); // every row anchors the SAME cell
    }
    const flags = findInconsistencies(s);
    expect(flags).toHaveLength(0);
  });

  it("a MIXED anchor that stops following the row (a forgotten $ removal) breaks the pattern", () => {
    let s = createSheet();
    for (let r = 0; r < 6; r++) {
      s = setRaw(s, r, 1, String(100 + r * 5));
      s = commitCellText(s, r, 0, `=B${r + 1}*$C$1`);
    }
    s = commitCellText(s, 3, 0, "=$B$4*$C$1"); // row 4 (index 3): B got wrongly anchored too
    const flags = findInconsistencies(s);
    expect(flagAt(flags, 3, 0)).toBeTruthy();
  });
});

describe("subtotal/total rows at a run's edge — suppressed as a legitimate different shape", () => {
  it("a SUM total at the BOTTOM of a column of formulas is not flagged", () => {
    let s = createSheet();
    for (let r = 0; r < 5; r++) {
      s = setRaw(s, r, 1, String(10 + r));
      s = setRaw(s, r, 2, "2");
      s = commitCellText(s, r, 0, `=B${r + 1}*C${r + 1}`);
    }
    s = commitCellText(s, 5, 0, "=SUM(A1:A5)"); // total row, bottom edge
    const flags = findInconsistencies(s);
    expect(flagAt(flags, 5, 0)).toBeUndefined();
  });

  it("the SAME aggregate formula sitting in the MIDDLE of a run (not an edge) is still flagged", () => {
    let s = createSheet();
    for (let r = 0; r < 6; r++) {
      s = setRaw(s, r, 1, String(10 + r));
      s = setRaw(s, r, 2, "2");
      s = commitCellText(s, r, 0, `=B${r + 1}*C${r + 1}`);
    }
    s = commitCellText(s, 3, 0, "=SUM(A1:A3)"); // NOT at the run's edge — a real anomaly
    const flags = findInconsistencies(s);
    expect(flagAt(flags, 3, 0)).toBeTruthy();
  });
});

describe("row-axis pattern — the same structural comparison across a row of monthly columns", () => {
  it("each column's own relative-offset formula (reading the prior column) is the SAME row shape", () => {
    let s = createSheet();
    s = setRaw(s, 0, 0, "1000"); // Jan, a seed
    for (let c = 1; c < 5; c++) s = commitCellText(s, 0, c, `=${String.fromCharCode(65 + c - 1)}1*1.03`); // Feb..May, each = prior column * 1.03
    const flags = findInconsistencies(s);
    expect(flags).toHaveLength(0);
  });

  it("one column in that row overtyped with a hardcoded number is flagged on the ROW axis", () => {
    let s = createSheet();
    s = setRaw(s, 0, 0, "1000");
    for (let c = 1; c < 5; c++) s = commitCellText(s, 0, c, `=${String.fromCharCode(65 + c - 1)}1*1.03`);
    s = setRaw(s, 0, 3, "1500"); // one month overtyped
    const flags = findInconsistencies(s);
    const f = flagAt(flags, 0, 3);
    expect(f).toBeTruthy();
    expect(f.axes).toContain("row");
  });
});

describe("dismissal is a UI-level concern, not this module's — findInconsistencies is pure", () => {
  it("re-running on an unchanged sheet always reports the SAME flags — dismissal state lives elsewhere (sheetModel.js)", () => {
    let s = createSheet();
    for (let r = 0; r < 5; r++) { s = setRaw(s, r, 1, String(r)); s = commitCellText(s, r, 0, `=B${r + 1}*2`); }
    s = setRaw(s, 2, 0, "999");
    const first = findInconsistencies(s);
    const second = findInconsistencies(s);
    expect(second).toEqual(first);
    expect(first.some((f) => f.row === 2 && f.col === 0)).toBe(true);
  });
});

describe("measured false-positive rate on a realistic multi-section pro-forma", () => {
  // A representative underwriting sheet: an acquisition section, an operating pro-forma with a
  // subtotal, a debt section, and a yield section — several genuinely different formula shapes
  // living on the SAME sheet, separated by blank rows (real section breaks). Nothing in here is
  // an error; the measured count below is the precision bar this detector has to clear.
  function realisticProForma() {
    let s = createSheet();
    let r = 0;
    // Section 1 — acquisition costs, a column of straight sums (row 0-3)
    const items = [["Land", 5000000], ["Hard costs", 12000000], ["Soft costs", 2000000], ["Contingency", 500000]];
    items.forEach(([label, val], i) => { s = setRaw(s, r + i, 0, label); s = setRaw(s, r + i, 1, String(val)); });
    r += items.length;
    s = commitCellText(s, r, 0, "Total cost");
    s = commitCellText(s, r, 1, `=SUM(B${r - items.length + 1}:B${r})`); // total row, edge of its own run
    r += 2; // blank separator row

    // Section 2 — a 12-month operating pro-forma, each month = prior month * escalation
    const monthRow = r;
    s = setRaw(s, monthRow, 0, "Monthly NOI");
    s = setRaw(s, monthRow, 1, "100000");
    for (let c = 2; c <= 12; c++) s = commitCellText(s, monthRow, c, `=${String.fromCharCode(65 + c - 1)}${monthRow + 1}*1.003`);
    r = monthRow + 2; // blank separator

    // Section 3 — a debt schedule, each row = prior balance less amortization (a genuine
    // recurring formula down 10 rows), with a running-total column beside it via a name.
    const debtStart = r;
    s = setRaw(s, debtStart, 0, "Beg balance"); s = setRaw(s, debtStart, 1, "20000000");
    for (let i = 1; i < 10; i++) {
      s = setRaw(s, debtStart + i, 2, "150000"); // amort payment, an input
      s = commitCellText(s, debtStart + i, 0, `=B${debtStart + i}-C${debtStart + i + 1}`);
      s = commitCellText(s, debtStart + i, 1, `=A${debtStart + i + 1}`);
    }
    r = debtStart + 11;

    // Section 4 — yield summary, a handful of one-off formulas (each structurally unique on
    // purpose — a real "ratios" block, never meant to look like a repeating pattern)
    s = commitCellText(s, r, 0, "Yield on cost");
    s = commitCellText(s, r, 1, `=B${monthRow + 1}*12/B${r - items.length - 8}`);
    r += 1;
    s = commitCellText(s, r, 0, "DSCR");
    s = commitCellText(s, r, 1, `=B${monthRow + 1}/C${debtStart + 1}`);

    return s;
  }

  it("reports the exact, small false-positive count on a realistic sheet — recorded so a regression is visible", () => {
    const s = realisticProForma();
    const flags = findInconsistencies(s);
    // MEASURED (2026-09-03): 0 false positives on this fixture — the subtotal-at-the-edge
    // suppression and the $-anchor/relative-offset shape signature together account for every
    // genuinely-different-but-legitimate formula shape this sheet contains. A future change to
    // the detector that regresses this back up should show here, not be discovered live.
    expect(flags).toHaveLength(0);
  });

  it("a single overtyped cell dropped into that SAME realistic sheet is still caught", () => {
    let s = realisticProForma();
    // Overtype a MIDDLE row of the debt schedule's own "beginning balance" formula column
    // (a real recurring formula run, not the column-2 amortization INPUTS, which are literals
    // by design and establish no formula pattern to break) with a stale hardcoded number.
    s = setRaw(s, 13, 0, "999999");
    const flags = findInconsistencies(s);
    expect(flags.some((f) => f.kind === "hardcoded" && f.row === 13 && f.col === 0)).toBe(true);
  });
});
