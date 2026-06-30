// test/formula.test.js — exhaustive coverage of the pure formula engine.
import { describe, it, expect } from "vitest";
import {
  evaluateFormula, formatValue, parseFormula, extractRefs, planFormulaColumns,
  makeDate, isoToSerial, serialToISO, BLANK, FORMULA_ERRORS, isDate,
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

describe("B585 — cross-row aggregation over a whole column", () => {
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
  it("a bare [Column] still means THIS row in a scalar position (implicit intersection)", () => {
    expect(valTable("[Cost] * 2", TABLE, 1)).toBe(500);       // row 1 cost 250
    expect(valTable("[Cost] / SUM([Cost])", TABLE, 0)).toBe(100 / 400);
  });
  it("[@Column] forces this-row even inside an aggregator", () => {
    expect(valTable("SUM([@Cost])", TABLE, 1)).toBe(250);     // just this row
  });
});

describe("B585 — lookups", () => {
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

describe("B585 — % operator and structured-ref niceties", () => {
  it("postfix % divides by 100", () => {
    expect(num("50%")).toBe(0.5);
    expect(num("[Budget] * 25%", { Budget: 100000 })).toBe(25000);
    expect(num("-10%")).toBe(-0.1);
  });
  it("[@Column] reads the current row like [Column]", () => {
    expect(num("[@Duration] + 1", { Duration: 4 })).toBe(5);
  });
});

describe("B585 — expanded function library", () => {
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
