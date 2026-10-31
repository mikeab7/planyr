/* The differential corpus for NEW-1 (one formula engine): builds a Planyr workbook that holds every formula to be compared,
 * evaluates it with BOTH engines, and classifies every cell where the answers differ.
 *
 *   old engine   = src/shared/formula/formula.js through lib/sheetEngine.js (deprecated reference)
 *   new engine   = Univer's, headless, through lib/univerEval.js (THE evaluator)
 *
 * Sources of formulas: (1) every context-free formula in test/formula.test.js (the older engine's own 1,800-line suite),
 * (2) a hand-written reference/range/cross-sheet/name block over a fixed Data sheet, (3) the real fixture workbooks and the
 * pro-forma workbooks (test/fixtures/spreadsheet/proFormaWorkbooks.js). Pure helpers only — the test and
 * scripts/measure-formula-engines.mjs both import it. */
import fs from "node:fs";
import path from "node:path";
import { createWorkbook, addSheet, setRaw, renameSheet, ensureColumnCount, setNumberFormat } from "../../../src/workspaces/model/lib/sheetModel.js";
import { evaluateWorkbook } from "../../../src/workspaces/model/lib/sheetEngine.js";
import { isDate, isErrVal, isFormulaError, isBlank } from "../../../src/shared/formula/formula.js";

export const DATA_ROWS = [
  ["Item", "Qty", "Price", "Date", "Flag"],
  ["Alpha", 10, 2.5, "2026-01-15", "TRUE"],
  ["Beta", 4, 100, "2026-02-01", "FALSE"],
  ["Gamma", 7, 0.75, "2026-03-31", "TRUE"],
  ["Delta", 0, 12, "2026-04-30", "FALSE"],
  ["alpha", 3, 8, "", "TRUE"],
  ["", "", "", "", ""],
  ["Total", 24, 123.25, "", ""],
];

/** Hand-written block: references, ranges, cross-sheet, names, criteria, lookup, text/number coercion. Row i of sheet "Data" is row i+1. */
export const REF_FORMULAS = [
  "=Data!B2+Data!C2", "=Data!B2*Data!C2*2", "=SUM(Data!B2:B6)", "=SUM(Data!B2:C6)", "=AVERAGE(Data!C2:C6)", "=AVERAGE(Data!C2:C7)", "=MIN(Data!B2:B6)", "=MAX(Data!C2:C6)",
  "=COUNT(Data!A2:C8)", "=COUNTA(Data!A2:E8)", "=COUNTIF(Data!A2:A6,\"alpha\")", "=COUNTIF(Data!B2:B6,\">3\")", "=COUNTIF(Data!A2:A6,\"a*\")",
  "=SUMIF(Data!B2:B6,\">3\",Data!C2:C6)", "=SUMIF(Data!A2:A6,\"Alpha\",Data!B2:B6)", "=AVERAGEIF(Data!B2:B6,\">0\",Data!C2:C6)",
  "=COUNTIFS(Data!B2:B6,\">3\",Data!C2:C6,\"<50\")", "=SUMIFS(Data!C2:C6,Data!B2:B6,\">3\",Data!E2:E6,TRUE)", "=AVERAGEIFS(Data!C2:C6,Data!B2:B6,\">3\")",
  "=VLOOKUP(\"Gamma\",Data!A2:C6,3,FALSE)", "=VLOOKUP(\"gamma\",Data!A2:C6,2,0)", "=VLOOKUP(7,Data!B2:C6,2,FALSE)", "=HLOOKUP(\"Qty\",Data!A1:E6,2,FALSE)", "=INDEX(Data!A2:C6,3,2)", "=INDEX(Data!C2:C6,2)",
  "=MATCH(\"Delta\",Data!A2:A6,0)", "=MATCH(8,Data!C2:C6,0)", "=MATCH(450,Data!H2:H5,1)", "=XLOOKUP(\"Beta\",Data!A2:A6,Data!C2:C6)", "=XLOOKUP(\"zzz\",Data!A2:A6,Data!C2:C6,\"none\")",
  "=SUMPRODUCT(Data!B2:B6,Data!C2:C6)", "=PRODUCT(Data!B2:B4)", "=IF(Data!B2>5,\"big\",\"small\")", "=IFERROR(Data!B2/Data!B5,\"n/a\")", "=Data!B2/Data!B5", "=Data!A2&\"-\"&Data!B2", "=Data!A7", "=Data!A7+1", "=Data!A7&\"x\"", "=ISBLANK(Data!A7)",
  "=Data!A2+1", "=Data!D2", "=Data!D3-Data!D2", "=Data!D2+30", "=YEAR(Data!D2)", "=MONTH(Data!D3)", "=EOMONTH(Data!D2,1)", "=EDATE(Data!D2,2)", "=DAYS(Data!D3,Data!D2)", "=DATEDIF(Data!D2,Data!D4,\"m\")", "=NETWORKDAYS(Data!D2,Data!D3)", "=WORKDAY(Data!D2,10)", "=WEEKDAY(Data!D2)", "=TEXT(Data!D2,\"mmm d, yyyy\")",
  "=SUM(Data!B:B)", "=SUM(B2:B3)", "=A1", "=SUM(A1:A1)", "=A1:A2", "=Data!B2:B3+1", "=-Data!B2", "=Data!B2^2", "=Data!B2%", "=Data!E2=TRUE", "=AND(Data!E2,Data!E3)", "=OR(Data!E3,Data!E5)", "=NOT(Data!E2)", "=XOR(Data!E2,Data!E3)",
  "=Data!B2=Data!B2", "=\"a\"<\"B\"", "=\"abc\"=\"ABC\"", "=1<\"a\"", "=TRUE+1", "=\"3\"+4", "=\"abc\"+1", "=\"\"+1", "=B1", "=C1+1", "=Data!B2&Data!E2",
  "=SUM(Data!B2:B6)/COUNT(Data!B2:B6)", "=ROUND(Data!C4*Data!B4,1)", "=INDEX(Data!A2:A6,MATCH(MAX(Data!C2:C6),Data!C2:C6,0))", "=SUMPRODUCT((Data!B2:B6>3)*(Data!C2:C6))", "=SUMPRODUCT(--(Data!B2:B6>3))",
  "=PMT(0.06/12,360,-250000)", "=IPMT(0.06/12,1,360,-250000)", "=PPMT(0.06/12,1,360,-250000)", "=FV(0.05,10,-100,-1000)", "=PV(0.05,10,-100)", "=NPER(0.05,-100,1000)", "=RATE(10,-100,800)", "=NPV(0.1,-100,50,60,70)", "=IRR(Data!H1:H5)", "=XNPV(0.1,Data!H1:H4,Data!I1:I4)", "=XIRR(Data!H1:H4,Data!I1:I4)", "=MIRR(Data!H1:H5,0.1,0.12)", "=CUMIPMT(0.06/12,360,250000,1,12,0)", "=CUMPRINC(0.06/12,360,250000,1,12,0)",
];


/** The functions the harvested suite never calls, plus the edge cases a pro-forma leans on (rounding, negative MOD, text formats). */
export const EXTRA_FORMULAS = [
  "=AVERAGEA(Data!B2:B6)", "=AVERAGEA(Data!A2:A6)", "=CHAR(65)", "=CODE(\"A\")", "=CONCAT(\"a\",1,TRUE)", "=DATEVALUE(\"2026-01-15\")", "=DAY(DATE(2026,3,31))", "=ISLOGICAL(TRUE)", "=ISLOGICAL(1)",
  "=ISOWEEKNUM(DATE(2026,1,1))", "=ISOWEEKNUM(DATE(2026,12,31))", "=LOG10(1000)", "=N(5)", "=N(\"x\")", "=N(TRUE)", "=SWITCH(2,1,\"a\",2,\"b\",\"z\")", "=SWITCH(9,1,\"a\",\"z\")", "=SWITCH(9,1,\"a\")",
  "=WEEKNUM(DATE(2026,1,5))", "=WEEKNUM(DATE(2026,1,5),2)", "=YEARFRAC(DATE(2026,1,1),DATE(2026,7,1))", "=YEARFRAC(DATE(2026,1,1),DATE(2027,1,1),1)",
  "=ROUND(2.5,0)", "=ROUND(-2.5,0)", "=ROUND(1.005,2)", "=ROUND(1234.5678,-2)", "=ROUNDUP(2.1,0)", "=ROUNDDOWN(-2.9,0)", "=MROUND(10,3)", "=CEILING(2.1,0.5)", "=FLOOR(2.9,0.5)", "=INT(-2.5)", "=TRUNC(-2.9)", "=MOD(-7,3)", "=MOD(7,-3)", "=QUOTIENT(7,2)", "=QUOTIENT(-7,2)", "=SIGN(-3)", "=POWER(2,0.5)", "=SQRT(2)", "=EXP(1)", "=LN(10)", "=LOG(100,10)", "=FACT(5)", "=EVEN(3)", "=ODD(2)", "=ISEVEN(3)", "=ISODD(3)",
  "=TEXT(1234.567,\"#,##0.00\")", "=TEXT(0.256,\"0.0%\")", "=TEXT(5,\"00\")", "=TEXT(DATE(2026,1,5),\"yyyy-mm-dd\")", "=TEXT(-1234.5,\"$#,##0\")", "=VALUE(\"1,234.5\")", "=VALUE(\"12%\")", "=VALUE(\"abc\")",
  "=LEFT(\"Planyr\",3)", "=RIGHT(\"Planyr\",2)", "=MID(\"Planyr\",2,3)", "=LEN(\"Planyr\")", "=UPPER(\"ab\")", "=LOWER(\"AB\")", "=PROPER(\"hello wORLD\")", "=TRIM(\"  a   b  \")", "=SUBSTITUTE(\"a-b-c\",\"-\",\"+\")", "=SUBSTITUTE(\"a-b-c\",\"-\",\"+\",2)", "=REPLACE(\"abcdef\",2,3,\"X\")", "=REPT(\"ab\",3)", "=FIND(\"b\",\"abcb\")", "=FIND(\"b\",\"abcb\",3)", "=SEARCH(\"B\",\"abcb\")", "=EXACT(\"a\",\"A\")", "=TEXTJOIN(\",\",TRUE,\"a\",\"\",\"b\")", "=TEXTJOIN(\"-\",FALSE,\"a\",\"\",\"b\")",
  "=IF(1,\"y\",\"n\")", "=IF(0,\"y\")", "=IFS(FALSE,1,TRUE,2)", "=IFNA(NA(),\"x\")", "=ISNUMBER(\"1\")", "=ISTEXT(\"a\")", "=ISERROR(1/0)", "=ISERR(NA())", "=ISNA(NA())",
  "=EDATE(DATE(2026,1,31),1)", "=EOMONTH(DATE(2026,1,31),1)", "=DATEDIF(DATE(2024,2,29),DATE(2026,2,28),\"y\")", "=DATEDIF(DATE(2026,1,31),DATE(2026,3,1),\"md\")", "=DAYS(DATE(2026,3,1),DATE(2026,1,1))", "=WORKDAY(DATE(2026,1,1),5)", "=NETWORKDAYS(DATE(2026,1,1),DATE(2026,1,31))", "=WEEKDAY(DATE(2026,1,4))", "=WEEKDAY(DATE(2026,1,4),2)", "=MONTH(DATE(2026,13,1))", "=DATE(2026,2,30)",
  "=PMT(0.05,10,-1000,0,1)", "=FV(0.05/12,120,-100)", "=NPER(0.05/12,-100,10000)", "=RATE(60,-200,10000)", "=NPV(0.08,100,200,300)", "=IRR(Data!H1:H5,0.2)", "=MIRR(Data!H1:H5,0.08,0.1)", "=XNPV(0.08,Data!H1:H4,Data!I1:I4)",
  "=1+2*3^2", "=(1+2)*3", "=-2^2", "=2^-1", "=10%*5", "=\"a\"&\"b\"&1", "=5/2", "=1=1", "=\"a\"=\"A\"", "=\"a\"<\"b\"", "=TRUE=1", "=1<>2", "=1>=1",
];

const INVALID_ESC = /\\(u[0-9a-fA-F]{4}|.)/g;
const unescapeJs = (body) => body.replace(INVALID_ESC, (m, c) => (c[0] === "u" && c.length === 5 ? String.fromCharCode(parseInt(c.slice(1), 16)) : ({ n: "\n", t: "\t", r: "\r", "\\": "\\", '"': '"', "'": "'", "`": "`" }[c] ?? c)));

/** Every context-free formula the older engine's own suite evaluates (one-argument num/val/err/iso calls), de-duplicated. */
export function harvestFormulaSuite(root = process.cwd()) {
  const text = fs.readFileSync(path.join(root, "test/formula.test.js"), "utf8");
  const re = /\b(?:num|val|err|iso)\(\s*("(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'|`(?:[^`\\]|\\.)*`)\s*\)/g;
  const seen = new Set(), out = [];
  for (let m; (m = re.exec(text));) {
    const lit = m[1];
    const src = unescapeJs(lit.slice(1, -1));
    if (src.includes("${") || src.includes("[") || /\b(TODAY|NOW)\b/i.test(src) || seen.has(src)) continue;
    seen.add(src); out.push(src.startsWith("=") ? src : `=${src}`);
  }
  return out;
}

/** The workbook every formula is evaluated in: sheet "Data" (fixed values) and sheet "F" (one formula per row, column A). */
export function buildCorpusWorkbook(formulas) {
  let wb = createWorkbook();
  wb = renameSheet(wb, wb.activeSheetId, "F");
  wb = addSheet(wb);
  const data = wb.sheets[1];
  wb = renameSheet(wb, data.id, "Data");
  const fill = (entryIdx, fn) => { const e = wb.sheets[entryIdx]; wb = { ...wb, sheets: wb.sheets.map((s, i) => (i === entryIdx ? { ...s, sheet: fn(s.sheet) } : s)) }; void e; };
  fill(1, (sh) => {
    sh = ensureColumnCount(sh, 9); sh = { ...sh, rowCount: Math.max(sh.rowCount, 30) };
    DATA_ROWS.forEach((row, r) => row.forEach((v, c) => { if (v !== "") sh = setRaw(sh, r, c, String(v)); }));
    [-1000, 300, 400, 500, 600].forEach((v, r) => { sh = setRaw(sh, r, 7, String(v)); });        // H: cash flows
    ["2026-01-01", "2026-07-01", "2027-01-01", "2027-07-01"].forEach((d, r) => { sh = setRaw(sh, r, 8, d); });  // I: dates
    return sh;
  });
  fill(0, (sh) => {
    sh = { ...sh, rowCount: Math.max(sh.rowCount, formulas.length + 5) };
    formulas.forEach((f, r) => { sh = setRaw(sh, r, 0, f); });
    return sh;
  });
  return wb;
}

const norm = (rec) => {
  if (!rec) return { k: "none" };
  if (!rec.ok) return { k: "err", v: rec.error };
  const v = rec.value;
  if (isBlank(v)) return { k: "blank" };
  if (isDate(v)) return { k: "date", v: v.s };
  if (isErrVal(v) || isFormulaError(v)) return { k: "err", v: v.code || "#ERROR!" };
  if (typeof v === "boolean") return { k: "bool", v };
  if (typeof v === "number") return { k: "num", v };
  return { k: "str", v: String(v) };
};
const CIRC = new Set(["#CIRC!", "#CYCLE!"]);
const close = (a, b) => Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a), Math.abs(b));

/** Classify one pair of results. `null` = they agree. */
export function classify(oldRec, newRec) {
  const a = norm(oldRec), b = norm(newRec);
  if (a.k === b.k) {
    if (a.k === "num" || a.k === "date") return close(a.v, b.v) ? null : "numeric";
    if (a.k === "err") return a.v === b.v || (CIRC.has(a.v) && CIRC.has(b.v)) ? null : "error-code";
    if (a.k === "str") return a.v === b.v ? null : "text";
    if (a.k === "bool") return a.v === b.v ? null : "bool";
    return null;
  }
  if (a.k === "err" && b.k !== "err") return "old-errors";
  if (b.k === "err" && a.k !== "err") return "univer-errors";
  if (a.k === "blank" && (b.k === "num" && b.v === 0 || b.k === "str" && b.v === "")) return "blank-vs-zero";
  // the older engine counts days from 1970, Univer (like Excel) from 1899-12-30; a date the older engine typed as a date and
  // Univer returned as a plain number (no date pattern attached) is the same day — only the TYPE differs.
  if (a.k === "date" && b.k === "num") return close(a.v + 25569, b.v) ? "date-typing" : "numeric";
  if (a.k === "num" && b.k === "date") return close(a.v, b.v + 25569) ? "date-typing" : "numeric";
  if (a.k === "bool" && b.k === "num" && (b.v === 1 || b.v === 0) && a.v === (b.v === 1)) return "bool-typing";
  if (a.k === "num" && b.k === "bool" && (a.v === 1 || a.v === 0) && b.v === (a.v === 1)) return "bool-typing";
  return "type";
}

/** The function name that dominates a formula (first call), for grouping the disagreement list. */
export const headFunction = (formula) => { const m = /([A-Z][A-Z0-9.]*)\(/.exec(String(formula).toUpperCase()); return m ? m[1] : "(operators)"; };

const show = (rec) => { const n = norm(rec); return n.k === "err" ? n.v : n.k === "blank" ? "(blank)" : n.k === "date" ? `date:${n.v}` : n.k === "none" ? "(none)" : `${n.k}:${JSON.stringify(n.v)}`; };

/** Evaluate a workbook with both engines and list every formula cell whose answers differ. */
export async function compareEngines(workbook, { projectNames, evaluateWorkbookUniver } = {}) {
  const oldRes = evaluateWorkbook(workbook, { projectNames });
  const newRes = await evaluateWorkbookUniver(workbook, { projectNames });
  const diffs = [];
  let compared = 0;
  for (const entry of workbook.sheets) {
    const sh = entry.sheet;
    for (const [key, raw] of Object.entries(sh.cells)) {
      if (!String(raw).trim().startsWith("=")) continue;
      const i = key.lastIndexOf(":");
      const colId = key.slice(0, i), row = Number(key.slice(i + 1));
      const col = sh.columns.findIndex((c) => c.id === colId);
      const a = oldRes.get(entry.id).get(row, col), b = newRes.get(entry.id).get(row, col);
      compared++;
      const cls = classify(a, b);
      if (cls) diffs.push({ sheet: entry.name, row, col, formula: raw, cls, fn: headFunction(raw), old: show(a), univer: show(b) });
    }
  }
  return { compared, diffs };
}
export { setNumberFormat };

/** Every comparison set, by name: the formula corpus and the workbooks. Used by the test and the measuring script. */
export async function allComparisons({ evaluateWorkbookUniver, parseSpreadsheetFile, acquisitionProForma, columnRefTable, PROJECT_NAMES, root = process.cwd() }) {
  const out = {};
  const formulas = [...new Set([...harvestFormulaSuite(root), ...REF_FORMULAS, ...EXTRA_FORMULAS])];
  out.corpus = await compareEngines(buildCorpusWorkbook(formulas), { evaluateWorkbookUniver });
  out.proForma = await compareEngines(acquisitionProForma(), { projectNames: PROJECT_NAMES, evaluateWorkbookUniver });
  out.columnRefTable = await compareEngines(columnRefTable(), { evaluateWorkbookUniver });
  for (const name of ["chart.xlsx", "legacy.xls"]) {
    const bytes = fs.readFileSync(path.join(root, "test/fixtures/spreadsheet", name));
    const parsed = await parseSpreadsheetFile(new Uint8Array(bytes).buffer, name);
    out[name] = await compareEngines(parsed.workbook, { evaluateWorkbookUniver });
  }
  return out;
}
/** A diff's identity in the known-differences manifest. */
export const diffId = (set, d) => `${set} | ${d.sheet}!r${d.row}c${d.col} | ${d.formula} | ${d.cls}`;
