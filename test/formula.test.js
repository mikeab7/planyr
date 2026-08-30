// test/formula.test.js — exhaustive coverage of the pure formula engine.
import { describe, it, expect } from "vitest";
import {
  evaluateFormula, formatValue, parseFormula, extractRefs, planFormulaColumns,
  makeDate, isoToSerial, serialToISO, BLANK, FORMULA_ERRORS, isDate,
  errVal, isErrVal, DEFAULT_CALENDAR,
} from "../src/shared/formula/formula.js";

// ── Test harness ────────────────────────────────────────────────────────────
// A Mon–Fri working-day calendar, optionally with extra holidays (ISO strings).
const calendar = (holidays = []) => {
  const hs = new Set(holidays.map(isoToSerial));
  return { isWorkingDay: s => { const w = new Date(s * 86400000).getUTCDay(); return w !== 0 && w !== 6 && !hs.has(s); } };
};
const D = iso => makeDate(isoToSerial(iso));
const lower = obj => { const o = {}; for (const k of Object.keys(obj)) o[k.toLowerCase()] = obj[k]; return o; };
// Evaluate; return the raw result object { ok, value, error }.
const run = (src, cols = {}, opts = {}) => evaluateFormula(src, {
  columns: lower(cols),
  calendar: opts.calendar || calendar(opts.holidays || []),
  today: opts.today != null ? isoToSerial(opts.today) : isoToSerial("2026-06-29"),
  formatDate: opts.formatDate || serialToISO,
});
// Evaluate against a whole table (array of row column-maps) for aggregation/lookups.
const runTable = (src, rowsArr, rowIndex = 0, opts = {}) => evaluateFormula(src, {
  columns: lower(rowsArr[rowIndex] || {}),
  rows: rowsArr.map(lower),
  rowIndex,
  calendar: opts.calendar || calendar(opts.holidays || []),
  today: opts.today != null ? isoToSerial(opts.today) : isoToSerial("2026-06-29"),
  formatDate: opts.formatDate || serialToISO,
});
const valTable = (src, rowsArr, rowIndex, opts) => { const r = runTable(src, rowsArr, rowIndex, opts); if (!r.ok) throw new Error(`unexpected error ${r.error} (${r.detail})`); return r.value; };
const errTable = (src, rowsArr, rowIndex, opts) => { const r = runTable(src, rowsArr, rowIndex, opts); expect(r.ok, `expected ${src} to error`).toBe(false); return r.error; };
// Value (fails the test if the formula errored).
const val = (src, cols, opts) => { const r = run(src, cols, opts); if (!r.ok) throw new Error(`unexpected error ${r.error} (${r.detail})`); return r.value; };
// Error code (fails if it did NOT error).
const err = (src, cols, opts) => { const r = run(src, cols, opts); expect(r.ok, `expected ${src} to error`).toBe(false); return r.error; };
// Number/string/bool result.
const num = (src, cols, opts) => { const v = val(src, cols, opts); expect(typeof v).toBe("number"); return v; };
const iso = (src, cols, opts) => { const v = val(src, cols, opts); expect(isDate(v)).toBe(true); return serialToISO(v.s); };

describe("operators & precedence", () => {
  it("arithmetic + precedence", () => {
    expect(num("2 + 3 * 4")).toBe(14);
    expect(num("(2 + 3) * 4")).toBe(20);
    expect(num("10 / 4")).toBe(2.5);
    expect(num("2 * -3")).toBe(-6);
    expect(num("7 - 2 - 1")).toBe(4); // left assoc
  });
  it("exponent is left-assoc; unary minus binds tighter (Excel quirk)", () => {
    expect(num("2 ^ 3 ^ 2")).toBe(64);   // (2^3)^2
    expect(num("-2 ^ 2")).toBe(4);        // (-2)^2
    expect(num("2 ^ -2")).toBe(0.25);
  });
  it("comparisons return booleans and sit at lowest precedence", () => {
    expect(val("1 + 1 = 2")).toBe(true);
    expect(val("3 <> 4")).toBe(true);
    expect(val("5 <= 5")).toBe(true);
    expect(val("5 < 5")).toBe(false);
    expect(val('"apple" = "APPLE"')).toBe(true); // text compare is case-insensitive
  });
  it("string concat with &", () => {
    expect(val('"a" & "b" & "c"')).toBe("abc");
    expect(val('[Name] & " #" & [ID]', { Name: "Pad", ID: 3 })).toBe("Pad #3");
  });
});

describe("column references", () => {
  it("resolves case-insensitively and tolerates spaces", () => {
    expect(num("[duration] + 1", { Duration: 5 })).toBe(6);
    expect(num("[% Complete] / 100", { "% Complete": 50 })).toBe(0.5);
  });
  it("unknown column → #REF!", () => {
    expect(err("[Nope]", { a: 1 })).toBe(FORMULA_ERRORS.REF);
  });
  it("blank column acts as 0 in arithmetic", () => {
    expect(num("[x] + 5", { x: BLANK })).toBe(5);
  });
});

describe("date arithmetic", () => {
  it("date − date = days", () => {
    expect(num("[Finish] - [Start]", { Finish: D("2026-07-10"), Start: D("2026-07-01") })).toBe(9);
  });
  it("date + number = date; date − number = date", () => {
    expect(iso("[Start] + 7", { Start: D("2026-07-01") })).toBe("2026-07-08");
    expect(iso("[Start] - 1", { Start: D("2026-07-01") })).toBe("2026-06-30");
  });
  it("number + date = date (commutative)", () => {
    expect(iso("3 + [Start]", { Start: D("2026-07-01") })).toBe("2026-07-04");
  });
  it("adding two dates is a #VALUE!", () => {
    expect(err("[a] + [b]", { a: D("2026-01-01"), b: D("2026-02-01") })).toBe(FORMULA_ERRORS.VALUE);
  });
});

describe("math functions", () => {
  it("SUM / PRODUCT / MIN / MAX over arguments", () => {
    expect(num("SUM(1, 2, 3, 4)")).toBe(10);
    expect(num("PRODUCT(2, 3, 4)")).toBe(24);
    expect(num("MIN(5, 2, 8)")).toBe(2);
    expect(num("MAX(5, 2, 8)")).toBe(8);
    expect(num("SUM([a], [b], 10)", { a: 1, b: 2 })).toBe(13);
  });
  it("ROUND rounds half away from zero", () => {
    expect(num("ROUND(2.5, 0)")).toBe(3);
    expect(num("ROUND(-2.5, 0)")).toBe(-3);
    expect(num("ROUND(2.675, 2)")).toBe(2.68);
    expect(num("ROUND(123.45, -1)")).toBe(120);
  });
  it("ROUNDUP / ROUNDDOWN go away from / toward zero", () => {
    expect(num("ROUNDUP(3.2, 0)")).toBe(4);
    expect(num("ROUNDUP(-3.2, 0)")).toBe(-4);
    expect(num("ROUNDDOWN(3.9, 0)")).toBe(3);
    expect(num("ROUNDDOWN(-3.9, 0)")).toBe(-3);
  });
  it("INT floors toward -infinity", () => {
    expect(num("INT(2.9)")).toBe(2);
    expect(num("INT(-2.1)")).toBe(-3);
  });
  it("MOD takes the sign of the divisor", () => {
    expect(num("MOD(-3, 2)")).toBe(1);
    expect(num("MOD(3, -2)")).toBe(-1);
    expect(err("MOD(3, 0)")).toBe(FORMULA_ERRORS.DIV0);
  });
  it("CEILING / FLOOR round to a multiple", () => {
    expect(num("CEILING(2.1, 0.5)")).toBe(2.5);
    expect(num("FLOOR(2.6, 0.5)")).toBe(2.5);
    expect(num("CEILING(12, 5)")).toBe(15);
  });
  it("POWER / SQRT / ABS", () => {
    expect(num("POWER(2, 10)")).toBe(1024);
    expect(num("SQRT(144)")).toBe(12);
    expect(num("ABS(-7.5)")).toBe(7.5);
    expect(err("SQRT(-1)")).toBe(FORMULA_ERRORS.NUM);
  });
});

describe("logical functions", () => {
  it("IF branches and short-circuits (skips the untaken branch's error)", () => {
    expect(num("IF(TRUE, 1, 2)")).toBe(1);
    expect(num("IF(FALSE, 1, 2)")).toBe(2);
    expect(num("IF(1 > 0, 10, 1/0)")).toBe(10);   // 1/0 never evaluated
    expect(num("IF(1 < 0, 1/0, 20)")).toBe(20);
    expect(val("IF([d] > 5, \"long\", \"short\")", { d: 9 })).toBe("long");
  });
  it("IFS returns the first matching value, else #N/A", () => {
    expect(val('IFS([s] = "g", "Go", [s] = "r", "Stop")', { s: "r" })).toBe("Stop");
    expect(err('IFS(1 > 2, "x", 2 > 3, "y")')).toBe(FORMULA_ERRORS.NA);
  });
  it("AND / OR / NOT", () => {
    expect(val("AND(1 > 0, 2 > 1)")).toBe(true);
    expect(val("AND(1 > 0, 2 < 1)")).toBe(false);
    expect(val("OR(1 < 0, 2 > 1)")).toBe(true);
    expect(val("NOT(1 > 2)")).toBe(true);
  });
  it("SWITCH matches a case or falls to default", () => {
    expect(val('SWITCH([d], "Civil", 1, "Arch", 2, 0)', { d: "Arch" })).toBe(2);
    expect(val('SWITCH([d], "Civil", 1, 99)', { d: "Other" })).toBe(99);
    expect(err('SWITCH([d], "Civil", 1)', { d: "Other" })).toBe(FORMULA_ERRORS.NA);
  });
  it("IFERROR traps an error", () => {
    expect(val('IFERROR(1/0, "n/a")')).toBe("n/a");
    expect(num('IFERROR(5 + 5, 0)')).toBe(10);
    expect(val('IFERROR([Bad], "missing")', {})).toBe("missing"); // #REF! trapped
  });
  it("ISBLANK", () => {
    expect(val("ISBLANK([x])", { x: BLANK })).toBe(true);
    expect(val("ISBLANK([x])", { x: 0 })).toBe(false);
    expect(val("ISBLANK([x])", { x: "" })).toBe(true);
  });
});

describe("date functions", () => {
  it("TODAY is injected for determinism", () => {
    expect(iso("TODAY()", {}, { today: "2026-06-29" })).toBe("2026-06-29");
  });
  it("DATE rolls over out-of-range months/days", () => {
    expect(iso("DATE(2026, 7, 4)")).toBe("2026-07-04");
    expect(iso("DATE(2026, 13, 1)")).toBe("2027-01-01");
    expect(iso("DATE(2026, 1, 0)")).toBe("2025-12-31");
  });
  it("YEAR / MONTH / DAY", () => {
    expect(num("YEAR([d])", { d: D("2026-07-04") })).toBe(2026);
    expect(num("MONTH([d])", { d: D("2026-07-04") })).toBe(7);
    expect(num("DAY([d])", { d: D("2026-07-04") })).toBe(4);
  });
  it("WEEKDAY supports return types 1/2/3", () => {
    // 2026-01-01 is a Thursday.
    expect(num("WEEKDAY([d])", { d: D("2026-01-01") })).toBe(5);       // Sun=1 → Thu=5
    expect(num("WEEKDAY([d], 2)", { d: D("2026-01-01") })).toBe(4);    // Mon=1 → Thu=4
    expect(num("WEEKDAY([d], 3)", { d: D("2026-01-01") })).toBe(3);    // Mon=0 → Thu=3
  });
  it("EDATE clamps to month end; EOMONTH returns month end", () => {
    expect(iso("EDATE([d], 1)", { d: D("2026-01-31") })).toBe("2026-02-28");
    expect(iso("EDATE([d], -1)", { d: D("2026-03-31") })).toBe("2026-02-28");
    expect(iso("EOMONTH([d], 0)", { d: D("2026-01-15") })).toBe("2026-01-31");
    expect(iso("EOMONTH([d], 1)", { d: D("2026-01-15") })).toBe("2026-02-28");
  });
  it("DATEDIF units", () => {
    expect(num('DATEDIF([a], [b], "D")', { a: D("2026-01-01"), b: D("2026-01-31") })).toBe(30);
    expect(num('DATEDIF([a], [b], "M")', { a: D("2026-01-01"), b: D("2026-03-01") })).toBe(2);
    expect(num('DATEDIF([a], [b], "Y")', { a: D("2024-01-15"), b: D("2026-03-20") })).toBe(2);
    expect(num('DATEDIF([a], [b], "MD")', { a: D("2026-01-20"), b: D("2026-03-05") })).toBe(13);
  });
  it("DAYS counts calendar days", () => {
    expect(num("DAYS([b], [a])", { a: D("2026-01-01"), b: D("2026-01-15") })).toBe(14);
  });
  it("WORKDAY / NETWORKDAYS honor the project working-day calendar", () => {
    // 2026-06-29 is a Monday; 2026-07-03 is the following Friday.
    expect(iso("WORKDAY([s], 5)", { s: D("2026-06-29") })).toBe("2026-07-06"); // skip the weekend
    expect(num("NETWORKDAYS([s], [e])", { s: D("2026-06-29"), e: D("2026-07-03") })).toBe(5);
  });
  it("WORKDAY / NETWORKDAYS skip holidays from the calendar", () => {
    const opts = { holidays: ["2026-07-03"] };  // make that Friday a holiday
    expect(iso("WORKDAY([s], 5)", { s: D("2026-06-29") }, opts)).toBe("2026-07-07");
    expect(num("NETWORKDAYS([s], [e])", { s: D("2026-06-29"), e: D("2026-07-03") }, opts)).toBe(4);
  });
  it("NETWORKDAYS is negative when start is after end", () => {
    expect(num("NETWORKDAYS([e], [s])", { s: D("2026-06-29"), e: D("2026-07-03") })).toBe(-5);
  });
  it("a date function on a blank date yields a blank cell, not a 1900 date", () => {
    expect(val("YEAR([d])", { d: BLANK })).toBe(BLANK);
    expect(val("WORKDAY([d], 3)", { d: BLANK })).toBe(BLANK);
  });
});

describe("text functions", () => {
  it("CONCAT / LEN / LEFT / RIGHT / MID / TRIM / UPPER / LOWER", () => {
    expect(val('CONCAT([a], "-", [b])', { a: "AB", b: "CD" })).toBe("AB-CD");
    expect(num('LEN("hello")')).toBe(5);
    expect(val('LEFT("Grading", 4)')).toBe("Grad");
    expect(val('RIGHT("Grading", 3)')).toBe("ing");
    expect(val('MID("Grading", 2, 3)')).toBe("rad");
    expect(val('TRIM("  a   b  ")')).toBe("a b");
    expect(val('UPPER("abc")')).toBe("ABC");
    expect(val('LOWER("ABC")')).toBe("abc");
  });
  it("TEXT formats numbers", () => {
    expect(val('TEXT(1234.5, "#,##0.00")')).toBe("1,234.50");
    expect(val('TEXT(0.125, "0.0%")')).toBe("12.5%");
    expect(val('TEXT(1234.5, "$#,##0.00")')).toBe("$1,234.50");
    expect(val('TEXT(5, "0")')).toBe("5");
  });
  it("TEXT formats dates", () => {
    expect(val('TEXT([d], "m/d/yyyy")', { d: D("2026-07-04") })).toBe("7/4/2026");
    expect(val('TEXT([d], "mmm d, yyyy")', { d: D("2026-07-04") })).toBe("Jul 4, 2026");
    expect(val('TEXT([d], "dddd")', { d: D("2026-01-01") })).toBe("Thursday");
  });
});

describe("errors are surfaced, never silent", () => {
  it("each error code", () => {
    expect(err("[Missing]")).toBe(FORMULA_ERRORS.REF);
    expect(err("1 / 0")).toBe(FORMULA_ERRORS.DIV0);
    expect(err('"abc" + 1')).toBe(FORMULA_ERRORS.VALUE);
    expect(err("BOGUS(1)")).toBe(FORMULA_ERRORS.NAME);
    expect(err("randomword")).toBe(FORMULA_ERRORS.NAME);
    expect(err("SQRT(-4)")).toBe(FORMULA_ERRORS.NUM);
  });
  it("a malformed formula reports a parse error, never throws to the host", () => {
    expect(run("2 +").ok).toBe(false);
    expect(run("((1+2)").ok).toBe(false);
    expect(run('"unterminated').ok).toBe(false);
    expect(run("[unterminated").ok).toBe(false);
  });
});

describe("formatValue", () => {
  it("formats each value type", () => {
    expect(formatValue(42)).toBe("42");
    expect(formatValue(2.5)).toBe("2.5");
    expect(formatValue(true)).toBe("TRUE");
    expect(formatValue("hi")).toBe("hi");
    expect(formatValue(BLANK)).toBe("");
    expect(formatValue(D("2026-07-04"), { formatDate: serialToISO })).toBe("2026-07-04");
  });
  it("renders an error code", () => {
    const r = run("1/0");
    // host typically formats from r.error; ensure code text is stable
    expect(r.error).toBe("#DIV/0!");
  });
});

describe("extractRefs", () => {
  it("returns the referenced column names", () => {
    expect(extractRefs("[Finish] - [Start]").refs.sort()).toEqual(["Finish", "Start"]);
    expect(extractRefs('IF([% Complete] >= 100, [Cost], 0)').refs.sort()).toEqual(["% Complete", "Cost"]);
    expect(extractRefs("SUM(1, 2)").refs).toEqual([]);
  });
  it("reports a parse error instead of throwing", () => {
    expect(extractRefs("1 +").error).toBeTruthy();
  });
});

describe("planFormulaColumns (recalc order + circular detection)", () => {
  const nameToKey = map => name => map[name.toLowerCase()] || null;
  it("orders dependents after their inputs", () => {
    const cols = [
      { key: "f1", formula: "[Sub] + 1" },     // depends on f2
      { key: "f2", formula: "[Cost] * 2" },     // depends only on a built-in
    ];
    const m = { total: "f1", sub: "f2" };
    const { order, cyclic } = planFormulaColumns(cols, name => m[name.toLowerCase()] || null);
    // map display names: [Sub]→f2, but f1's formula uses [Sub]; f2 is named "Sub"
    expect(cyclic.size).toBe(0);
    expect(order.indexOf("f2")).toBeLessThan(order.indexOf("f1"));
  });
  it("flags a reference cycle", () => {
    const cols = [
      { key: "f1", formula: "[Beta] + 1" },
      { key: "f2", formula: "[Alpha] + 1" },
    ];
    const m = { alpha: "f1", beta: "f2" };
    const { cyclic } = planFormulaColumns(cols, name => m[name.toLowerCase()] || null);
    expect(cyclic.has("f1")).toBe(true);
    expect(cyclic.has("f2")).toBe(true);
  });
  it("a self-reference is a cycle", () => {
    const cols = [{ key: "f1", formula: "[Me] + 1" }];
    const { cyclic } = planFormulaColumns(cols, name => (name.toLowerCase() === "me" ? "f1" : null));
    expect(cyclic.has("f1")).toBe(true);
  });
});

describe("B583 adversarial-review fixes", () => {
  it("numbers display clean (no binary-float noise) — General formatting", () => {
    expect(val('[c] & ""', { c: 9999999.99 })).toBe("9999999.99");
    expect(val('[c] & ""', { c: 1234567.89 })).toBe("1234567.89");
    expect(formatValue(9999999.99)).toBe("9999999.99");
    expect(formatValue(0.1 + 0.2)).toBe("0.3");      // arithmetic residue trimmed
    expect(formatValue(1 / 3)).toBe("0.333333333333333");
  });
  it("a non-finite numeric result is surfaced as #NUM!, never a silent Infinity/NaN", () => {
    expect(err("1e308 * 100")).toBe(FORMULA_ERRORS.NUM);
    expect(err("1e309 - 1e309")).toBe(FORMULA_ERRORS.NUM); // Infinity - Infinity = NaN
    expect(err("1e308 + 1e308 + 1e308 + 1e308 + 1e308")).toBe(FORMULA_ERRORS.NUM);
    // The dangerous case: overflow must not slip into a comparison as a wrong boolean.
    expect(err("IF(1e308 * 100 > 0, 1, 2)")).toBe(FORMULA_ERRORS.NUM);
  });
  it("DATEDIF YD is correct across year boundaries (anchored on the end year)", () => {
    expect(num('DATEDIF([a], [b], "YD")', { a: D("2024-01-15"), b: D("2026-03-20") })).toBe(64);
    expect(num('DATEDIF([a], [b], "YD")', { a: D("2026-12-20"), b: D("2027-01-10") })).toBe(21);
    expect(num('DATEDIF([a], [b], "YD")', { a: D("2025-06-15"), b: D("2026-06-15") })).toBe(0);
  });
  it("DATEDIF MD never returns a negative day count", () => {
    expect(num('DATEDIF([a], [b], "MD")', { a: D("2026-01-31"), b: D("2026-03-01") })).toBeGreaterThanOrEqual(0);
  });
  it("TEXT pads the integer part for leading-zero placeholders", () => {
    expect(val('TEXT(7, "00")')).toBe("07");
    expect(val('TEXT(123, "0000")')).toBe("0123");
    expect(val('TEXT(1234, "00,000")')).toBe("01,234");
    expect(val('TEXT(5, "0")')).toBe("5"); // unchanged: no padding needed
  });
  it("CEILING/FLOOR reject a positive number with negative significance (#NUM!)", () => {
    expect(err("CEILING(2.5, -1)")).toBe(FORMULA_ERRORS.NUM);
    expect(err("FLOOR(2.5, -1)")).toBe(FORMULA_ERRORS.NUM);
    expect(num("CEILING(-2.5, -1)")).toBe(-3); // same-sign still works
  });
  it("a pathologically nested formula returns an error and never throws to the host", () => {
    const deep = "(".repeat(600) + "1" + ")".repeat(600);
    const r = run(deep);
    expect(r.ok).toBe(false);          // reported, not thrown
    const deepCall = "ABS(".repeat(600) + "1" + ")".repeat(600);
    expect(run(deepCall).ok).toBe(false);
  });
});

describe("B586 — cross-row aggregation over a whole column", () => {
  const TABLE = [
    { Cost: 100, Status: "Done", Phase: "DD" },
    { Cost: 250, Status: "Open", Phase: "DD" },
    { Cost: 50, Status: "Done", Phase: "Permit" },
    { Cost: "", Status: "Open", Phase: "Permit" }, // blank cost
  ];
  it("SUM/AVERAGE/MIN/MAX/COUNT/COUNTA over a column", () => {
    expect(valTable("SUM([Cost])", TABLE)).toBe(400);
    expect(valTable("MAX([Cost])", TABLE)).toBe(250);
    expect(valTable("MIN([Cost])", TABLE)).toBe(50);
    expect(valTable("AVERAGE([Cost])", TABLE)).toBeCloseTo(400 / 3, 9); // blank skipped → 3 numbers
    expect(valTable("COUNT([Cost])", TABLE)).toBe(3);                    // blank not counted
    expect(valTable("COUNTA([Status])", TABLE)).toBe(4);
  });
  it("COUNTIF / SUMIF / AVERAGEIF with criteria", () => {
    expect(valTable('COUNTIF([Status], "Done")', TABLE)).toBe(2);
    expect(valTable('SUMIF([Status], "Done", [Cost])', TABLE)).toBe(150);   // 100 + 50
    expect(valTable('SUMIF([Cost], ">=100")', TABLE)).toBe(350);            // 100 + 250
    expect(valTable('COUNTIF([Cost], ">100")', TABLE)).toBe(1);
    expect(valTable('AVERAGEIF([Status], "Open", [Cost])', TABLE)).toBe(250); // only 250 (other Open is blank)
  });
  it("COUNTIF honors wildcards", () => {
    expect(valTable('COUNTIF([Phase], "P*")', TABLE)).toBe(2); // Permit, Permit
  });
  it("text criteria that LOOK date-ish/numeric still match TEXT cells (B589 regression guard)", () => {
    // A criterion like "3/4", "6/1", "2026-06-01" or "100" is parsed as a date/number for
    // comparing against date/number columns — but a TEXT cell must still match it as text.
    const slash = [{ Code: "3/4" }, { Code: "1/2" }, { Code: "3/4" }];
    expect(valTable('COUNTIF([Code], "3/4")', slash)).toBe(2);
    expect(valTable('COUNTIF([Code], "<>3/4")', slash)).toBe(1);
    const isoT = [{ Lbl: "2026-06-01" }, { Lbl: "x" }, { Lbl: "2026-06-01" }];
    expect(valTable('COUNTIF([Lbl], "2026-06-01")', isoT)).toBe(2);
    const numT = [{ X: "100" }, { X: "abc" }, { X: "100" }];
    expect(valTable('COUNTIF([X], "100")', numT)).toBe(2);
    const sif = [{ Code: "3/4", Amt: 5 }, { Code: "3/4", Amt: 7 }, { Code: "1/2", Amt: 9 }];
    expect(valTable('SUMIF([Code], "3/4", [Amt])', sif)).toBe(12);
    // The intended fix must still hold: a date criterion matches a real DATE column.
    const dates = [{ D: D("2026-06-01") }, { D: D("2026-06-02") }];
    expect(valTable('COUNTIF([D], "2026-06-01")', dates)).toBe(1);
  });
  it("a bare [Column] still means THIS row in a scalar position (implicit intersection)", () => {
    expect(valTable("[Cost] * 2", TABLE, 1)).toBe(500);       // row 1 cost 250
    expect(valTable("[Cost] / SUM([Cost])", TABLE, 0)).toBe(100 / 400);
  });
  it("[@Column] forces this-row even inside an aggregator", () => {
    expect(valTable("SUM([@Cost])", TABLE, 1)).toBe(250);     // just this row
  });
});

describe("B586 — lookups", () => {
  const T = [
    { Task: "Dig", Owner: "Sam", Cost: 100 },
    { Task: "Pour", Owner: "Lee", Cost: 250 },
    { Task: "Frame", Owner: "Mia", Cost: 300 },
  ];
  it("MATCH / INDEX", () => {
    expect(valTable('MATCH("Pour", [Task], 0)', T)).toBe(2);
    expect(valTable("INDEX([Owner], 3)", T)).toBe("Mia");
    expect(valTable('INDEX([Owner], MATCH("Dig", [Task], 0))', T)).toBe("Sam");
    expect(errTable('MATCH("Nope", [Task], 0)', T)).toBe(FORMULA_ERRORS.NA);
  });
  it("XLOOKUP returns the paired value, or the fallback", () => {
    expect(valTable('XLOOKUP("Frame", [Task], [Cost])', T)).toBe(300);
    expect(valTable('XLOOKUP("X", [Task], [Cost], 0)', T)).toBe(0);
    expect(errTable('XLOOKUP("X", [Task], [Cost])', T)).toBe(FORMULA_ERRORS.NA);
  });
  it("MATCH type 1 = largest value ≤ lookup (ascending)", () => {
    const N = [{ V: 10 }, { V: 20 }, { V: 30 }];
    expect(valTable("MATCH(25, [V], 1)", N)).toBe(2);
  });
});

describe("B586 — % operator and structured-ref niceties", () => {
  it("postfix % divides by 100", () => {
    expect(num("50%")).toBe(0.5);
    expect(num("[Budget] * 25%", { Budget: 100000 })).toBe(25000);
    expect(num("-10%")).toBe(-0.1);
  });
  it("[@Column] reads the current row like [Column]", () => {
    expect(num("[@Duration] + 1", { Duration: 4 })).toBe(5);
  });
});

describe("B586 — expanded function library", () => {
  it("math extras", () => {
    expect(num("SIGN(-3)")).toBe(-1);
    expect(num("TRUNC(3.99)")).toBe(3);
    expect(num("TRUNC(-3.99)")).toBe(-3);
    expect(num("QUOTIENT(17, 5)")).toBe(3);
    expect(num("MROUND(17, 5)")).toBe(15);
    expect(num("EVEN(3)")).toBe(4);
    expect(num("ODD(2)")).toBe(3);
    expect(num("FACT(5)")).toBe(120);
    expect(num("LOG(1000)")).toBeCloseTo(3, 9);
    expect(num("LN(EXP(1))")).toBeCloseTo(1, 9);
    expect(num("PI()")).toBeCloseTo(Math.PI, 9);
  });
  it("text extras", () => {
    expect(val('SUBSTITUTE("a-b-c", "-", "_")')).toBe("a_b_c");
    expect(val('SUBSTITUTE("a-b-c", "-", "_", 2)')).toBe("a-b_c");
    expect(val('REPLACE("2026XX", 5, 2, "07")')).toBe("202607");
    expect(num('FIND("b", "abc")')).toBe(2);
    expect(num('SEARCH("B", "aBc")')).toBe(2);
    expect(val('REPT("ab", 3)')).toBe("ababab");
    expect(val('PROPER("john o\'brien")')).toBe("John O'Brien");
    expect(val('TEXTJOIN("-", TRUE(), "a", "", "b")')).toBe("a-b");
    expect(num('VALUE("1,234.5")')).toBe(1234.5);
    expect(val('EXACT("abc", "ABC")')).toBe(false);
  });
  it("logical + info extras", () => {
    expect(val("XOR(TRUE(), FALSE())")).toBe(true);
    expect(val("XOR(TRUE(), TRUE())")).toBe(false);
    expect(val('IFNA(NA(), "fallback")')).toBe("fallback");
    expect(val("ISERROR(1/0)")).toBe(true);
    expect(val("ISERR(1/0)")).toBe(true);
    expect(val("ISERR(NA())")).toBe(false);   // #N/A excluded from ISERR
    expect(val("ISNA(NA())")).toBe(true);
    expect(val("ISNUMBER(5)")).toBe(true);
    expect(val('ISNUMBER("5")')).toBe(false);
    expect(val('ISTEXT("x")')).toBe(true);
    expect(val("ISEVEN(4)")).toBe(true);
    expect(val("ISODD(4)")).toBe(false);
  });
  it("date extras", () => {
    expect(num("WEEKNUM([d])", { d: D("2026-01-01") })).toBe(1);
    expect(num("ISOWEEKNUM([d])", { d: D("2026-01-05") })).toBe(2); // Mon 2026-01-05 is ISO week 2
    expect(num("YEARFRAC([a], [b])", { a: D("2026-01-01"), b: D("2026-07-01") })).toBeCloseTo(0.5, 2);
  });
});

describe("B589 — adversarial-debug fixes", () => {
  it("date-literal criteria match in COUNTIF/SUMIF/AVERAGEIF", () => {
    const T = [{ D: D("2026-01-01"), V: 1 }, { D: D("2026-06-01"), V: 2 }, { D: D("2026-12-31"), V: 3 }];
    expect(valTable('COUNTIF([D], ">=2026-03-01")', T)).toBe(2);
    expect(valTable('COUNTIF([D], "2026-06-01")', T)).toBe(1);
    expect(valTable('COUNTIF([D], "<>2026-06-01")', T)).toBe(2);
    expect(valTable('SUMIF([D], ">=2026-03-01", [V])', T)).toBe(5);
  });
  it("[@Column] forces this-row inside COUNTIF/SUMIF", () => {
    const T = [{ Cost: 100 }, { Cost: 250 }, { Cost: 50 }];
    expect(valTable('COUNTIF([@Cost], ">=50")', T, 1)).toBe(1);
    expect(valTable('SUMIF([@Cost], ">=50")', T, 1)).toBe(250);
  });
  it("WEEKNUM supports types 1/2/11/21 and #NUM! on an invalid type", () => {
    expect(num("WEEKNUM([d], 2)", { d: D("2026-01-05") })).toBe(2);
    expect(num("WEEKNUM([d], 11)", { d: D("2026-01-04") })).toBe(1);
    expect(num("WEEKNUM([d], 21)", { d: D("2021-01-01") })).toBe(53);
    expect(err("WEEKNUM([d], 99)", { d: D("2026-01-04") })).toBe(FORMULA_ERRORS.NUM);
  });
  it("[@[Column]] bracketed structured reference parses", () => {
    expect(num("[@[Duration]] + 1", { Duration: 4 })).toBe(5);
    expect(num("[@[% Complete]] / 100", { "% Complete": 50 })).toBe(0.5);
  });
  it("MIN/MAX over a date column return a date (not a serial)", () => {
    const T = [{ Start: D("2026-03-01") }, { Start: D("2026-01-15") }, { Start: D("2026-07-04") }];
    const mn = valTable("MIN([Start])", T), mx = valTable("MAX([Start])", T);
    expect(isDate(mn)).toBe(true); expect(serialToISO(mn.s)).toBe("2026-01-15");
    expect(isDate(mx)).toBe(true); expect(serialToISO(mx.s)).toBe("2026-07-04");
  });
  it("MATCH approximate (type 1/-1) doesn't leak across type families", () => {
    const N = [{ V: 10 }, { V: 20 }, { V: 30 }];
    expect(errTable('MATCH("abc", [V], 1)', N)).toBe(FORMULA_ERRORS.NA);
    expect(valTable("MATCH(25, [V], 1)", N)).toBe(2); // numbers still work
  });
  it("YEARFRAC is non-negative regardless of argument order", () => {
    expect(num("YEARFRAC([a],[b])", { a: D("2026-01-01"), b: D("2025-01-01") })).toBeGreaterThan(0);
  });
  it("a column present on only some rows isn't #REF! when row 0 lacks it", () => {
    const T = [{ Task: "a" }, { Task: "b", Cost: 250 }, { Task: "c", Cost: 50 }];
    expect(valTable("SUM([Cost])", T)).toBe(300);
  });
});

describe("a realistic scheduling formula", () => {
  it("computes a working-day buffer label", () => {
    const cols = { Start: D("2026-06-29"), Finish: D("2026-07-10"), "% Complete": 40 };
    const v = val('IF([% Complete] >= 100, "Done", NETWORKDAYS([Start], [Finish]) & " work-days")', cols);
    expect(v).toBe("10 work-days");
  });
  it("weighted cost-to-go", () => {
    const cols = { Budget: 100000, "% Complete": 25 };
    expect(num("ROUND([Budget] * (1 - [% Complete] / 100), 0)", cols)).toBe(75000);
  });
});

// ── Round-2 scheduler fix batch (2026-06-30) ──────────────────────────────────
describe("round-2 formula fixes", () => {
  it("a blank cell equals the empty string — the [Date]=\"\" empty test works", () => {
    expect(val('[d] = ""', { d: BLANK })).toBe(true);
    expect(val('IF([d] = "", "empty", "full")', { d: BLANK })).toBe("empty");
    expect(val('[d] <> ""', { d: BLANK })).toBe(false);
    // ...but a blank is NOT equal to a non-empty string, and sorts before it
    expect(val('[d] = "x"', { d: BLANK })).toBe(false);
    expect(val('[d] < "x"', { d: BLANK })).toBe(true);
    // consistent with the engine's own ISBLANK + LEN idioms
    expect(val("ISBLANK([d])", { d: BLANK })).toBe(true);
  });
  it("date arithmetic that overflows JS Date is surfaced as #NUM!, never a NaN date", () => {
    expect(err("DATE(2024,1,1) + 1000000000000")).toBe(FORMULA_ERRORS.NUM);
    expect(err("EDATE(DATE(2024,1,1), 1000000000)")).toBe(FORMULA_ERRORS.NUM);
    // a normal date offset still works
    expect(iso("DATE(2024,1,1) + 31")).toBe("2024-02-01");
  });
});

describe("B590 — round-2 adversarial-debug fixes", () => {
  it("a non-finite literal or function result is #NUM!, never a silent Infinity/NaN", () => {
    // Literal overflow is caught at the source (so it can't slip into a comparison/label).
    expect(err("1e309")).toBe(FORMULA_ERRORS.NUM);
    expect(err("-1e309")).toBe(FORMULA_ERRORS.NUM);
    expect(err("1e309%")).toBe(FORMULA_ERRORS.NUM);
    expect(err("1e309 > 5")).toBe(FORMULA_ERRORS.NUM);     // overflow can't masquerade as TRUE
    expect(err('"big: " & 1e309')).toBe(FORMULA_ERRORS.NUM);
    // Aggregation/maths that overflow from finite inputs are caught at the call boundary.
    expect(err("SUM(1e308, 1e308)")).toBe(FORMULA_ERRORS.NUM);
    expect(err("PRODUCT(1e308, 1e308)")).toBe(FORMULA_ERRORS.NUM);
    expect(err("AVERAGE(1e308, 1e308)")).toBe(FORMULA_ERRORS.NUM);
    expect(err("TRUNC(0, 9999999999999999)")).toBe(FORMULA_ERRORS.NUM); // 0 × Infinity = NaN
    expect(err("ROUND(1, 1e308)")).toBe(FORMULA_ERRORS.NUM);
    // ...but a finite large literal is still a perfectly good number.
    expect(num("1e300")).toBe(1e300);
    expect(num("SUM(1e150, 1e150)")).toBe(2e150);
  });

  it("MROUND rounds the half AWAY from zero despite float drift (6.05 → 6.1, not 6.0)", () => {
    expect(num("MROUND(6.05, 0.1)")).toBeCloseTo(6.1, 9);
    expect(num("MROUND(1.005, 0.01)")).toBeCloseTo(1.01, 9);
    expect(num("MROUND(-6.05, -0.1)")).toBeCloseTo(-6.1, 9);
    expect(num("MROUND(2.5, 1)")).toBe(3);
    // a value below the half still rounds down (the epsilon only bridges float noise)
    expect(num("MROUND(6.04, 0.1)")).toBeCloseTo(6.0, 9);
    expect(num("MROUND(17, 5)")).toBe(15);  // integer steps unchanged
  });

  it("FLOOR/CEILING to a fractional step land on the true multiple (2.4, not 2.3)", () => {
    expect(num("FLOOR(2.4, 0.1)")).toBeCloseTo(2.4, 9);
    expect(num("CEILING(0.7, 0.1)")).toBeCloseTo(0.7, 9);
    expect(num("FLOOR(2.45, 0.1)")).toBeCloseTo(2.4, 9);
    expect(num("CEILING(2.41, 0.1)")).toBeCloseTo(2.5, 9);
    expect(num("FLOOR(-2.4, -0.1)")).toBeCloseTo(-2.4, 9);
    // integer-significance behavior is unchanged
    expect(num("FLOOR(2.6, 0.5)")).toBe(2.5);
    expect(num("CEILING(2.1, 0.5)")).toBe(2.5);
  });

  it("an over-large formula is rejected deterministically (#ERROR!), never a stack-dependent flip", () => {
    const huge = "1" + "+1".repeat(1500);   // ~3000 tokens — past the token cap
    expect(err(huge)).toBe(FORMULA_ERRORS.ERR);
    expect(run(huge).error).toBe(run(huge).error);   // same input → same verdict every time
    // a normal-length chain still evaluates fine
    expect(num("1" + "+1".repeat(100))).toBe(101);
  });

  it("TEXT() honors ;-separated positive;negative;zero sections (accounting formats)", () => {
    expect(val('TEXT(-1234.5, "#,##0.00;(#,##0.00)")')).toBe("(1,234.50)");
    expect(val('TEXT(1234.5, "#,##0.00;(#,##0.00)")')).toBe("1,234.50");
    expect(val('TEXT(-500, "$#,##0;($#,##0)")')).toBe("($500)");
    expect(val('TEXT(-0.5, "0.00%;(0.00)")')).toBe("(0.50)");
    expect(val('TEXT(0.5, "0.00%;(0.00)")')).toBe("50.00%");
    expect(val('TEXT(0, "0.0;(0.0)")')).toBe("0.0");        // 2-section: zero uses the positive section
    // single-section formats are unchanged (auto "-" for negatives)
    expect(val('TEXT(-5, "0.00")')).toBe("-5.00");
    expect(val('TEXT(1234.5, "#,##0.00")')).toBe("1,234.50");
  });
});

// ── B597 — error propagation through aggregation (match Excel exactly) ──────────
// The HOST stores an errored formula-column cell as errVal(code) in the row map; the
// engine must RE-RAISE that error wherever a cell is consumed — so an aggregation or a
// reference over a column that has a #DIV/0! row yields #DIV/0!, not a silently-smaller
// total. Errors only enter via the host (the engine itself always THROWS, never returns
// an error value), so we simulate the host by seeding errVal cells into the table.
describe("B597 — error cells propagate through aggregation & references (Excel parity)", () => {
  const E = code => errVal(code);
  const DIV0 = FORMULA_ERRORS.DIV0, REF = FORMULA_ERRORS.REF, VALUE = FORMULA_ERRORS.VALUE;

  it("plain aggregations propagate an error cell with its exact code", () => {
    const rows = [{ Cost: 10 }, { Cost: E(DIV0) }, { Cost: 30 }];
    expect(errTable("SUM([Cost])", rows)).toBe(DIV0);
    expect(errTable("AVERAGE([Cost])", rows)).toBe(DIV0);
    expect(errTable("MIN([Cost])", rows)).toBe(DIV0);
    expect(errTable("MAX([Cost])", rows)).toBe(DIV0);
    expect(errTable("PRODUCT([Cost])", rows)).toBe(DIV0);
    expect(errTable("COUNT([Cost])", rows)).toBe(DIV0);
    expect(errTable("COUNTA([Cost])", rows)).toBe(DIV0);
  });

  it("the propagated code is whichever error the cell holds", () => {
    expect(errTable("SUM([X])", [{ X: 1 }, { X: E(REF) }])).toBe(REF);
    expect(errTable("SUM([X])", [{ X: 1 }, { X: E(VALUE) }])).toBe(VALUE);
  });

  it("a column with NO error cells still aggregates normally (no regression)", () => {
    expect(valTable("SUM([Cost])", [{ Cost: 10 }, { Cost: 20 }, { Cost: 30 }])).toBe(60);
    // a blank cell is still skipped — only a real error value propagates
    expect(valTable("SUM([Cost])", [{ Cost: 10 }, { Cost: BLANK }, { Cost: 30 }])).toBe(40);
    // an error in a DIFFERENT, unreferenced column does not affect this aggregation
    expect(valTable("SUM([Cost])", [{ Cost: 10, Other: E(DIV0) }, { Cost: 20, Other: 5 }])).toBe(30);
  });

  it("conditional aggregations propagate an error in the criteria range", () => {
    const rows = [{ Status: "Done", Amt: 5 }, { Status: E(VALUE), Amt: 7 }];
    expect(errTable('COUNTIF([Status], "Done")', rows)).toBe(VALUE);
    expect(errTable('SUMIF([Status], "Done", [Amt])', rows)).toBe(VALUE);
    expect(errTable('AVERAGEIF([Status], "Done", [Amt])', rows)).toBe(VALUE);
  });

  it("SUMIF propagates an error in a MATCHING sum cell, but skips one in a non-matching row", () => {
    expect(errTable('SUMIF([S], "Y", [A])', [{ S: "Y", A: E(DIV0) }, { S: "N", A: 7 }])).toBe(DIV0);
    // a non-matching row's sum-cell error is never consumed → not propagated (documented boundary)
    expect(valTable('SUMIF([S], "Y", [A])', [{ S: "N", A: E(DIV0) }, { S: "Y", A: 7 }])).toBe(7);
  });

  it("a bare reference / arithmetic / concat / comparison over an errored cell propagates", () => {
    expect(err("[Bad]", { Bad: E(REF) })).toBe(REF);
    expect(err("[Bad] + 1", { Bad: E(DIV0) })).toBe(DIV0);
    expect(err("[Bad] * 2", { Bad: E(VALUE) })).toBe(VALUE);
    expect(err('[Bad] & "x"', { Bad: E(VALUE) })).toBe(VALUE);
    expect(err("[Bad] > 5", { Bad: E(DIV0) })).toBe(DIV0);
    expect(err("[@Bad] + 1", { Bad: E(REF) })).toBe(REF);
  });

  it("IFERROR / ISERROR / ISNA trap a propagated error cell", () => {
    expect(val("IFERROR([Bad], 99)", { Bad: E(DIV0) })).toBe(99);
    expect(val("ISERROR([Bad])", { Bad: E(DIV0) })).toBe(true);
    expect(val("ISNA([Bad])", { Bad: E(FORMULA_ERRORS.NA) })).toBe(true);
    expect(val("ISERR([Bad])", { Bad: E(FORMULA_ERRORS.NA) })).toBe(false); // #N/A is excluded from ISERR
    expect(val("ISERR([Bad])", { Bad: E(DIV0) })).toBe(true);
  });

  it("INDEX propagates only the SPECIFIC indexed error cell", () => {
    const rows = [{ Cost: 10 }, { Cost: E(DIV0) }, { Cost: 30 }];
    expect(errTable("INDEX([Cost], 2)", rows)).toBe(DIV0);  // the indexed cell IS the error
    expect(valTable("INDEX([Cost], 1)", rows)).toBe(10);    // a good cell is fine despite an error elsewhere
    expect(valTable("INDEX([Cost], 3)", rows)).toBe(30);
  });

  it("XLOOKUP propagates an error scanned BEFORE a match, but returns an earlier match untouched", () => {
    const rows = [{ K: "a", V: 1 }, { K: E(REF), V: 2 }, { K: "c", V: 3 }];
    expect(errTable('XLOOKUP("c", [K], [V])', rows)).toBe(REF); // must scan past the errored key
    expect(valTable('XLOOKUP("a", [K], [V])', rows)).toBe(1);   // matches index 0 before the error
  });

  it("documented boundary: MATCH's compare-safe scan skips an error cell (use XLOOKUP to propagate)", () => {
    const rows = [{ K: 1 }, { K: E(DIV0) }, { K: 3 }];
    expect(valTable("MATCH(3, [K], 0)", rows)).toBe(3); // exact match found; the error cell is skipped, not raised
  });

  it("isErrVal / errVal / formatValue contract", () => {
    expect(isErrVal(errVal(DIV0))).toBe(true);
    expect(isErrVal(BLANK)).toBe(false);
    expect(isErrVal(5)).toBe(false);
    expect(isErrVal("x")).toBe(false);
    expect(isErrVal(makeDate(0))).toBe(false);
    expect(formatValue(errVal(DIV0))).toBe(DIV0);
  });

  it("a healthy formula never produces an error value itself (only the host injects them)", () => {
    const r = runTable("SUM([Cost])", [{ Cost: 1 }, { Cost: 2 }]);
    expect(r.ok).toBe(true);
    expect(isErrVal(r.value)).toBe(false);
  });
});

// ── Row-invariant whole-column caching (the quadratic-aggregate fix) ───────────────────
// The host (public/sequence/index.html's computeFormulaValues) evaluates one formula
// column by calling evaluateFormula() once per row, reusing the SAME `rows` array object
// across every one of those calls within a recalc pass. The engine now memoizes a
// range-aware call's ENTIRE result per (AST node, rows array) pair whenever every
// argument is row-invariant (see RANGE_ARG_POSITIONS/isRowInvariant in formula.js) — the
// tests below drive that exact scenario directly (one shared rows array, many rowIndex
// values) rather than through runTable(), which builds a fresh rows array per call and so
// never exercises the cache the way the real host does.
describe("row-invariant caching — correctness under the SAME shared rows array", () => {
  const runAllRows = (src, rowsRaw, opts = {}) => {
    const rows = rowsRaw.map(lower);
    return rows.map((_, i) => evaluateFormula(src, {
      columns: rows[i],
      rows,
      rowIndex: i,
      calendar: opts.calendar || calendar(opts.holidays || []),
      today: opts.today != null ? isoToSerial(opts.today) : isoToSerial("2026-06-29"),
      formatDate: opts.formatDate || serialToISO,
    }));
  };

  it("a row-dependent MATCH/XLOOKUP target is never frozen onto other rows (the exact trap named in the brief)", () => {
    // Cost is unique per row; Target on row i asks to look up row i's OWN cost — so the
    // correct answer for XLOOKUP/MATCH varies every row. A "hoist any bare [Column] arg"
    // bug would freeze row 0's answer (Task "T0") onto every subsequent row.
    const rows = [
      { Cost: 10, Task: "T0", Target: 10 },
      { Cost: 20, Task: "T1", Target: 20 },
      { Cost: 30, Task: "T2", Target: 30 },
      { Cost: 40, Task: "T3", Target: 40 },
    ];
    const xl = runAllRows("XLOOKUP([Target],[Cost],[Task])", rows);
    expect(xl.map(r => r.value)).toEqual(["T0", "T1", "T2", "T3"]);
    const mt = runAllRows("MATCH([Target],[Cost],0)", rows);
    expect(mt.map(r => r.value)).toEqual([1, 2, 3, 4]);
  });

  it("a row-dependent INDEX position is never frozen onto other rows", () => {
    const rows = [
      { Cost: 10, Pos: 1 }, { Cost: 20, Pos: 2 }, { Cost: 30, Pos: 3 }, { Cost: 40, Pos: 4 },
    ];
    const idx = runAllRows("INDEX([Cost],[@Pos])", rows);
    expect(idx.map(r => r.value)).toEqual([10, 20, 30, 40]);
  });

  it("a row-dependent COUNTIF/SUMIF criterion is never frozen onto other rows", () => {
    // UniqueCost is 0..N-1 (one row matches each Threshold exactly); Threshold=2*i means
    // only rows 0 and 1 have a match at all (2*0=0 and 2*1=2 both exist among 0..3).
    const rows = [
      { UniqueCost: 0, Threshold: 0 }, { UniqueCost: 1, Threshold: 2 },
      { UniqueCost: 2, Threshold: 4 }, { UniqueCost: 3, Threshold: 6 },
    ];
    const c = runAllRows("COUNTIF([UniqueCost],[Threshold])", rows);
    expect(c.map(r => r.value)).toEqual([1, 1, 0, 0]);
    const s = runAllRows('COUNTIF([UniqueCost], ">" & [Threshold])', rows);
    expect(s.map(r => r.value)).toEqual([3, 1, 0, 0]); // >0,>2,>4,>6 against {0,1,2,3}
  });

  it("a genuinely row-INVARIANT aggregate gives the identical answer from every row", () => {
    const rows = [{ Cost: 5 }, { Cost: 10 }, { Cost: 15 }];
    const s = runAllRows("SUM([Cost])", rows);
    expect(s.map(r => r.value)).toEqual([30, 30, 30]);
    const c = runAllRows('COUNTIF([Cost],">7")', rows);
    expect(c.map(r => r.value)).toEqual([2, 2, 2]);
  });

  it("mixing an invariant range with a row-variant scalar still varies correctly per row", () => {
    const rows = [{ Cost: 5, Adj: 1 }, { Cost: 10, Adj: 2 }, { Cost: 15, Adj: 3 }];
    const s = runAllRows("SUM([Cost], [@Adj])", rows); // SUM([Cost]) part is 30 every row; [@Adj] varies
    expect(s.map(r => r.value)).toEqual([31, 32, 33]);
  });

  it("a cached #REF!/#N/A from a row-invariant call is faithfully re-thrown for every row", () => {
    const rows = [{ Cost: 5 }, { Cost: 10 }];
    const r1 = runAllRows("SUM([NoSuchColumn])", rows);
    expect(r1.every(r => !r.ok && r.error === FORMULA_ERRORS.REF)).toBe(true);
    const r2 = runAllRows('COUNTIF([Cost],">100")', rows); // invariant, legitimately 0 every row
    expect(r2.map(r => r.value)).toEqual([0, 0]);
  });

  it("a lazy branch (IF) selecting between two invariant rng calls resolves independently per row", () => {
    const rows = [
      { Cost: 100, Flag: true }, { Cost: 5, Flag: false },
      { Cost: 100, Flag: true }, { Cost: 5, Flag: false },
    ];
    const r = runAllRows('IF([@Flag], SUM([Cost]), COUNTIF([Cost],">50"))', rows);
    // SUM([Cost]) = 210 every row (invariant); COUNTIF([Cost],">50") = 2 every row (invariant);
    // IF's own condition [@Flag] is row-dependent, so the SELECTED branch must alternate.
    expect(r.map(x => x.value)).toEqual([210, 2, 210, 2]);
  });
});

// ── Perf regression guard: whole-column aggregates must not be quadratic in row count ──
// Generous on purpose (matches the pattern in test/pondViewIndependence.test.js): this
// exists to catch a CLASS CHANGE (an O(rows²) scan returning to this path), not to police
// a few percent on a shared CI box. Sampled REPS times, keeping the MINIMUM of each arm
// (a scheduler steal/GC can only ever ADD time, never subtract it), with the two arms
// interleaved so a machine that drifts mid-run doesn't bias one arm against the other.
describe("perf: whole-column aggregates scale linearly, not quadratically", () => {
  it("COUNTIF over 8x the rows costs nowhere near 8x² (64x) the time", () => {
    const makeRows = n => { const a = []; for (let i = 0; i < n; i++) a.push({ cost: (i % 97) + 1 }); return a; };
    const small = makeRows(300).map(lower);
    const large = makeRows(2400).map(lower); // 8x the rows
    const sample = rows => {
      const t0 = performance.now();
      for (let i = 0; i < rows.length; i++) {
        evaluateFormula('COUNTIF([Cost],">50")', { columns: rows[i], rows, rowIndex: i, calendar: DEFAULT_CALENDAR, today: isoToSerial("2026-06-29"), formatDate: serialToISO });
      }
      return performance.now() - t0;
    };
    const REPS = 5;
    let bestSmall = Infinity, bestLarge = Infinity;
    for (let i = 0; i < REPS; i++) {
      bestSmall = Math.min(bestSmall, sample(small));
      bestLarge = Math.min(bestLarge, sample(large));
    }
    // Linear (with fixed per-call overhead) lands well under 8x; true O(n²) would land near
    // 64x. 20x is a generous midpoint that never flakes on healthy code but still fails
    // hard the moment the quadratic path comes back.
    expect(bestLarge).toBeLessThan(Math.max(bestSmall, 1) * 20);
  });
});

// ── Financial functions (NPV, XNPV, IRR, XIRR, MIRR, PMT, IPMT, PPMT, RATE, NPER, FV,
//    PV, CUMIPMT, CUMPRINC) ── Every assertion here checks a STRUCTURAL INVARIANT (an
// identity that must hold by definition, and so cannot be misremembered) rather than a
// recalled numeric constant — see the brief: a prototype's own remembered PMT constant
// was WRONG and its computed value was right, caught only because it was cross-checked
// against FV=0 and the closed-form annuity formula instead of trusted from memory.
describe("financial functions", () => {
  const approx = (a, b, eps = 1e-6) => Math.abs(a - b) < eps;

  it("IPMT(n) + PPMT(n) == PMT for every period, both END and BEGIN conventions", () => {
    for (const type of [0, 1]) {
      const rate = 0.005, nper = 24, pv = 10000, fv = 0;
      const pmt = num(`PMT(${rate},${nper},${pv},${fv},${type})`);
      for (let n = 1; n <= nper; n++) {
        const ipmt = num(`IPMT(${rate},${n},${nper},${pv},${fv},${type})`);
        const ppmt = num(`PPMT(${rate},${n},${nper},${pv},${fv},${type})`);
        expect(approx(ipmt + ppmt, pmt)).toBe(true);
      }
    }
  });

  it("IPMT(1) is exactly 0 under the BEGIN (type=1) convention — the classic off-by-one", () => {
    // A type=1 payment happens at the START of period 1 (time 0), before any interest has
    // had time to accrue — so period 1's payment is pure principal.
    expect(num("IPMT(0.01,1,12,10000,0,1)")).toBe(0);
    expect(num("PPMT(0.01,1,12,10000,0,1)")).toBe(num("PMT(0.01,12,10000,0,1)"));
  });

  it("sum of PPMT over the full term == -PV when the loan fully amortizes (FV=0)", () => {
    for (const type of [0, 1]) {
      const rate = 0.007, nper = 36, pv = 25000;
      let sum = 0;
      for (let n = 1; n <= nper; n++) sum += num(`PPMT(${rate},${n},${nper},${pv},0,${type})`);
      expect(approx(sum, -pv, 1e-6)).toBe(true);
    }
  });

  it("FV == 0 at the end of a fully amortizing schedule (PMT solved with FV=0)", () => {
    const rate = 0.006, nper = 48, pv = 15000;
    const pmt = num(`PMT(${rate},${nper},${pv},0,0)`);
    expect(approx(num(`FV(${rate},${nper},${pmt},${pv},0)`), 0)).toBe(true);
  });

  it("NPER and RATE round-trip through PMT (both directions)", () => {
    const rate = 0.008, nper = 30, pv = 20000, fv = 0, type = 0;
    const pmt = num(`PMT(${rate},${nper},${pv},${fv},${type})`);
    expect(approx(num(`NPER(${rate},${pmt},${pv},${fv},${type})`), nper, 1e-4)).toBe(true);
    expect(approx(num(`RATE(${nper},${pmt},${pv},${fv},${type})`), rate, 1e-6)).toBe(true);
  });

  it("RATE converges from a supplied guess on a harder (longer-term, low-payment) case", () => {
    const rate = 0.0125, nper = 360, pv = 300000, fv = 0, type = 0; // a 30yr mortgage-shaped case
    const pmt = num(`PMT(${rate},${nper},${pv},${fv},${type})`);
    expect(approx(num(`RATE(${nper},${pmt},${pv},${fv},${type},0.05)`), rate, 1e-6)).toBe(true);
  });

  it("CUMIPMT + CUMPRINC over the full term == nper * PMT", () => {
    const rate = 0.009, nper = 60, pv = 40000, type = 0;
    const pmt = num(`PMT(${rate},${nper},${pv},0,${type})`);
    const cumI = num(`CUMIPMT(${rate},${nper},${pv},1,${nper},${type})`);
    const cumP = num(`CUMPRINC(${rate},${nper},${pv},1,${nper},${type})`);
    expect(approx(cumI + cumP, nper * pmt)).toBe(true);
    expect(approx(cumP, -pv)).toBe(true); // full-term principal repaid == the amount borrowed
  });

  it("CUMIPMT/CUMPRINC reject an invalid period range or domain exactly like Excel (#NUM!)", () => {
    expect(err("CUMIPMT(0.01,12,10000,0,6,0)")).toBe(FORMULA_ERRORS.NUM);   // start < 1
    expect(err("CUMIPMT(0.01,12,10000,6,3,0)")).toBe(FORMULA_ERRORS.NUM);   // end < start
    expect(err("CUMIPMT(0.01,12,10000,1,6,2)")).toBe(FORMULA_ERRORS.NUM);   // type not 0/1
    expect(err("CUMIPMT(-0.01,12,10000,1,6,0)")).toBe(FORMULA_ERRORS.NUM); // rate <= 0
    expect(err("CUMIPMT(0.01,12,-10000,1,6,0)")).toBe(FORMULA_ERRORS.NUM); // pv <= 0
  });

  it("NPV(IRR(cash flows)) == 0 (the classic Excel identity, holds despite NPV/IRR indexing from different periods)", () => {
    const cfs = [-1000, 300, 400, 500, 200];
    const r = num(`IRR(${cfs.join(",")})`);
    expect(approx(num(`NPV(${r},${cfs.join(",")})`), 0, 1e-6)).toBe(true);
  });

  it("XNPV(XIRR(...)) == 0 with real calendar dates", () => {
    const pairs = [
      [-1000, "2026-01-01"], [300, "2026-04-01"], [400, "2026-08-01"],
      [500, "2026-12-01"], [200, "2027-04-01"],
    ];
    const args = pairs.map(([v, d]) => `${v},DATE(${d.slice(0, 4)},${d.slice(5, 7)},${d.slice(8, 10)})`).join(",");
    const r = num(`XIRR(${args})`);
    expect(approx(num(`XNPV(${r},${args})`), 0, 1e-4)).toBe(true);
  });

  it("MIRR reduces to IRR for exactly two cash flows, for ANY finance/reinvest rate (sign-convention check)", () => {
    const cf0 = -1000, cf1 = 1300;
    const irr = num(`IRR(${cf0},${cf1})`);
    for (const [fr, rr] of [[0.05, 0.05], [0.1, 0.02], [0.2, 0.2]]) {
      expect(approx(num(`MIRR(${fr},${rr},${cf0},${cf1})`), irr, 1e-9)).toBe(true);
    }
  });

  it("MIRR on a multi-period project (documented formula, not a remembered example)", () => {
    // Cross-checked against the definition itself, computed independently here rather than
    // trusted from a recalled number: FV of inflows at reinvestRate / -PV of outflows at
    // financeRate, geometric-mean over (n-1) periods, minus 1.
    const cfs = [-1000, -200, 300, 400, 500, 300];
    const financeRate = 0.1, reinvestRate = 0.08;
    const n = cfs.length - 1;
    let pvNeg = 0, fvPos = 0;
    cfs.forEach((cf, i) => { if (cf < 0) pvNeg += cf / Math.pow(1 + financeRate, i); else fvPos += cf * Math.pow(1 + reinvestRate, n - i); });
    const expected = Math.pow(fvPos / -pvNeg, 1 / n) - 1;
    expect(approx(num(`MIRR(${financeRate},${reinvestRate},${cfs.join(",")})`), expected, 1e-9)).toBe(true);
  });

  it("PV/FV/PMT round-trip the fundamental annuity identity", () => {
    const rate = 0.01, nper = 20, pmt = -500, fv = 1000;
    const pv = num(`PV(${rate},${nper},${pmt},${fv},0)`);
    expect(approx(num(`FV(${rate},${nper},${pmt},${pv},0)`), fv, 1e-6)).toBe(true);
    expect(approx(num(`PV(${rate},${nper},${pmt},${fv},0)`), pv)).toBe(true);
  });

  it("rate == 0 degenerates to plain division/multiplication (no NaN from the annuity formula)", () => {
    expect(num("PMT(0,10,1000,0,0)")).toBe(-100);
    expect(num("FV(0,10,-100,1000,0)")).toBeCloseTo(0, 9); // -0 vs 0: same value, JS Object.is distinguishes them
    expect(num("NPER(0,-100,1000,0,0)")).toBe(10);
    expect(num("IPMT(0,3,10,1000,0,0)")).toBe(0);
  });

  it("arity guards reject too few arguments", () => {
    expect(err("NPV(0.1)")).toBe(FORMULA_ERRORS.VALUE);
    expect(err("XNPV(0.1,100)")).toBe(FORMULA_ERRORS.VALUE);
    expect(err("IRR(100)")).toBe(FORMULA_ERRORS.VALUE);
    expect(err("XIRR(100,200)")).toBe(FORMULA_ERRORS.VALUE);
    expect(err("MIRR(0.1,0.1,100)")).toBe(FORMULA_ERRORS.VALUE);
    expect(err("PMT(0.1,10)")).toBe(FORMULA_ERRORS.VALUE);
    expect(err("IPMT(0.1,1,10)")).toBe(FORMULA_ERRORS.VALUE);
    expect(err("RATE(10,-100)")).toBe(FORMULA_ERRORS.VALUE);
    expect(err("NPER(0.1,-100)")).toBe(FORMULA_ERRORS.VALUE);
    expect(err("FV(0.1,10)")).toBe(FORMULA_ERRORS.VALUE);
    expect(err("PV(0.1,10)")).toBe(FORMULA_ERRORS.VALUE);
    expect(err("CUMIPMT(0.1,10,1000,1)")).toBe(FORMULA_ERRORS.VALUE);
    expect(err("CUMPRINC(0.1,10,1000,1)")).toBe(FORMULA_ERRORS.VALUE);
  });

  it("XNPV/XIRR reject an unpaired values/dates argument list", () => {
    expect(err("XNPV(0.1,100,DATE(2026,1,1),200)")).toBe(FORMULA_ERRORS.VALUE);
    expect(err("XIRR(100,DATE(2026,1,1),200)")).toBe(FORMULA_ERRORS.VALUE);
  });
});
