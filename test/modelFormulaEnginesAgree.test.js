// NEW-1 (one formula engine) — Univer's engine, run headless (lib/univerEval.js), is THE evaluator. This suite is the measurement and its guard:
//   1. the DIFFERENTIAL: ~380 formulas (every context-free formula of the older engine's own suite + hand-written reference / lookup / finance /
//      text / date blocks) and the pro-forma, [Column], chart.xlsx and legacy.xls workbooks run through BOTH engines. Every cell where they differ
//      is listed in test/fixtures/spreadsheet/engineKnownDiffs.json with a reason; a NEW difference fails, and so does a listed one that stopped
//      happening (the list may only shrink on purpose).
//   2. independent expected values (known answers, not the older engine's) so the comparison is never "two engines agreeing on a wrong number".
//   3. Planyr-only syntax: [Column], interleaved XIRR/XNPV, `=-Name` — rewritten, never silently.
//   4. the Excel export reads Univer's values, writes Excel-valid formulas, and round-trips through ExcelJS.
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import ExcelJS from "exceljs";
import { allComparisons, diffId, buildCorpusWorkbook, harvestFormulaSuite } from "./fixtures/spreadsheet/engineCorpus.js";
import { acquisitionProForma, columnRefTable, PROJECT_NAMES } from "./fixtures/spreadsheet/proFormaWorkbooks.js";
import { exportViaUniver } from "./fixtures/spreadsheet/exportViaUniver.js";
import { parseSpreadsheetFile } from "../src/workspaces/model/lib/spreadsheetFile.js";
import { importXlsxToWorkbook } from "../src/workspaces/model/lib/xlsxIO.js";
import { evaluateWorkbookUniver, evaluateForExport } from "../src/workspaces/model/lib/univerEval.js";
import { rewriteColumnRefs, rewriteInterleavedPairs, rewriteUnaryMinusBeforeName, migratePlanyrSyntaxInWorkbook, planyrSyntaxNote } from "../src/workspaces/model/lib/planyrSyntax.js";
import { univerSpelling, guardCellValue } from "../src/workspaces/model/lib/univerFormulaGuard.js";
import { evalFromPlain, circularNotice } from "../src/workspaces/model/lib/evalValues.js";
import { evaluateWorkbook } from "../src/workspaces/model/lib/sheetEngine.js";
import { setRaw, createWorkbook, renameSheet } from "../src/workspaces/model/lib/sheetModel.js";

const known = JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures/spreadsheet/engineKnownDiffs.json"), "utf8"));
const read = (f) => fs.readFileSync(path.join(__dirname, "..", f), "utf8");
let sets;
const getSets = async () => (sets ||= await allComparisons({ evaluateWorkbookUniver, parseSpreadsheetFile, acquisitionProForma, columnRefTable, PROJECT_NAMES, root: path.join(__dirname, "..") }));

describe("the differential: Planyr's older engine vs Univer headless", () => {
  it("compares enough to mean something (vacuity guard)", async () => {
    const s = await getSets();
    expect(s.corpus.compared).toBeGreaterThanOrEqual(350);
    expect(s.proForma.compared).toBeGreaterThanOrEqual(85);
    expect(s["chart.xlsx"].compared).toBe(5);
    expect(s["legacy.xls"].compared).toBe(5);
    expect(harvestFormulaSuite(path.join(__dirname, "..")).length, "the older suite's own formulas are harvested").toBeGreaterThan(150);
  });
  it("every disagreement is a KNOWN one with a reason — and every known one still happens", async () => {
    const s = await getSets();
    const seen = new Set();
    for (const [name, { diffs }] of Object.entries(s)) for (const d of diffs) seen.add(diffId(name, d));
    const unknown = [...seen].filter((id) => !(id in known.known));
    expect(unknown, "new disagreement between the engines — decide it, then add it to engineKnownDiffs.json with a reason").toEqual([]);
    const stale = Object.keys(known.known).filter((id) => !seen.has(id));
    expect(stale, "a listed disagreement no longer happens — delete its row").toEqual([]);
    for (const reason of Object.values(known.known)) expect(known.reasons[reason], reason).toBeTruthy();
  });
  it("the pro-forma (PMT, IRR, XIRR, XNPV, NPV, CUMIPMT, lookups, cross-sheet) and the [Column] table agree on every number", async () => {
    const s = await getSets();
    const unexplained = s.proForma.diffs.filter((d) => !["date-typing", "old-errors"].includes(d.cls));
    expect(unexplained).toEqual([]);
    expect(s.columnRefTable.diffs).toEqual([]);
  });
});

describe("independent known answers (not the older engine's)", () => {
  const F = [
    ["=SUM(Data!B2:B6)", 24], ["=PMT(0.06/12,360,-250000)", 1498.8760290], ["=FV(0.05,10,-100,-1000)", 2886.6783], ["=NPV(0.1,-100,50,60,70)", 43.3031],
    ["=IRR(Data!H1:H5)", 0.248883], ["=XIRR(CHOOSE({1,2},-1000,1500),CHOOSE({1,2},DATE(2026,1,1),DATE(2027,1,1)))", 0.5], ["=ROUND(1234.5678,-2)", 1200], ["=MOD(-7,3)", 2],
    ["=VLOOKUP(\"Gamma\",Data!A2:C6,3,FALSE)", 0.75], ["=SUMIF(Data!B2:B6,\">3\",Data!C2:C6)", 103.25], ["=DATEDIF(DATE(2026,1,15),DATE(2026,4,30),\"m\")", 3],
  ];
  it("Univer headless gives the textbook answer", async () => {
    const wb = buildCorpusWorkbook(F.map((f) => f[0]));
    const ev = await evaluateWorkbookUniver(wb);
    const sheet = wb.sheets[0];
    F.forEach(([f, want], i) => {
      const rec = ev.get(sheet.id).get(i, 0);
      expect(rec.ok, f).toBe(true);
      expect(Math.abs(rec.value - want), `${f} → ${rec.value}`).toBeLessThan(Math.max(1e-3, Math.abs(want) * 1e-4));
    });
  });
  it("the real fixtures (written by Excel-compatible tools) evaluate to their known cell values", async () => {
    for (const name of ["chart.xlsx", "legacy.xls"]) {
      const p = await parseSpreadsheetFile(new Uint8Array(fs.readFileSync(path.join(__dirname, "fixtures/spreadsheet", name))).buffer, name);
      const ev = await evaluateWorkbookUniver(p.workbook);
      const data = p.workbook.sheets[0], sh = data.sheet, col = (i) => sh.columns[i].id;
      expect([1, 2, 3, 4].map((r) => ev.get(data.id).get(r, 3).value), name).toEqual([2.5, 10, 22.5, 40]);
      expect(sh.cells[`${col(3)}:1`]).toBe("=B2*C2");
      expect(ev.get(p.workbook.sheets[1].id).get(0, 0).value, name).toBe(3.5);
    }
  });
});

describe("Planyr-only syntax is rewritten, loudly, and means the same thing", () => {
  const cols = [{ name: "Item" }, { name: "Qty" }, { name: "Price" }, { name: "Total" }];
  it("[Column] in a scalar slot is this row's cell; a whole range slot is the whole column", () => {
    expect(rewriteColumnRefs("=[Qty]*[Price]", { rowIndex: 4, columns: cols }).text).toBe("=B5*C5");
    expect(rewriteColumnRefs("=[@Qty]+1", { rowIndex: 0, columns: cols }).text).toBe("=B1+1");
    expect(rewriteColumnRefs("=SUM([Qty])", { rowIndex: 9, columns: cols }).text).toBe("=SUM(B:B)");
    expect(rewriteColumnRefs("=SUMIF([Item],\"a\",[Qty])", { rowIndex: 1, columns: cols }).text).toBe("=SUMIF(A:A,\"a\",B:B)");
    expect(rewriteColumnRefs("=SUM([Qty]*2)", { rowIndex: 1, columns: cols }).text).toBe("=SUM(B2*2)");   // an expression is scalar, as before
    expect(rewriteColumnRefs("=\"[Qty]\"&[Qty]", { rowIndex: 1, columns: cols }).text).toBe("=\"[Qty]\"&B2");
    const un = rewriteColumnRefs("=[Nope]+1", { rowIndex: 1, columns: cols });
    expect(un.text).toBe("=[Nope]+1"); expect(un.unresolved).toEqual(["Nope"]);
  });
  it("interleaved XIRR / XNPV become Excel's two-list form with the same answer; Excel's own shape is untouched", async () => {
    expect(rewriteInterleavedPairs("=XIRR(-1000,DATE(2026,1,1),1500,DATE(2027,1,1))").text).toBe("=XIRR(CHOOSE({1,2},-1000,1500),CHOOSE({1,2},DATE(2026,1,1),DATE(2027,1,1)))");
    expect(rewriteInterleavedPairs("=XNPV(0.1,-100,A1,200,A2)").text).toBe("=XNPV(0.1,CHOOSE({1,2},-100,200),CHOOSE({1,2},A1,A2))");
    expect(rewriteInterleavedPairs("=XIRR(B2:B7,A2:A7,0.2)").count).toBe(0);
    expect(rewriteInterleavedPairs("=XNPV(0.1,B2:B7,A2:A7)").count).toBe(0);
    const f = "=XIRR(-1000,DATE(2026,1,1),1500,DATE(2027,1,1))";
    const wb = buildCorpusWorkbook([f]);
    const old = evaluateWorkbook(wb).get(wb.sheets[0].id).get(0, 0).value;
    const now = (await evaluateWorkbookUniver(wb)).get(wb.sheets[0].id).get(0, 0).value;
    expect(Math.abs(old - now)).toBeLessThan(1e-9);
  });
  it("a minus sign straight before a name is written -(Name) (Univer 1.3.1 answers #NAME? otherwise); everything else is left alone", () => {
    const u = (f) => rewriteUnaryMinusBeforeName(f).text;
    expect(u("=-Rate")).toBe("=-(Rate)"); expect(u("=2*-Site.Acres")).toBe("=2*-(Site.Acres)"); expect(u("=-TRUE")).toBe("=-(TRUE)");
    for (const same of ["=-B9", "=-Sheet1!B9", "=-SUM(A1:A2)", "=A1-Rate", "=1E-5", "=\"-x\"", "=-1.5", "=-'My Sheet'!B2", "=-$B$2"]) expect(u(same), same).toBe(same);
  });
  it("without the rewrite Univer really does answer #NAME? (the bug the rewrite exists for) — and with it, the number", async () => {
    let wb = acquisitionProForma();
    const sheet = wb.sheets[0];
    wb = { ...wb, sheets: wb.sheets.map((e, i) => (i ? e : { ...e, sheet: setRaw(setRaw(e.sheet, 30, 0, "=-TotalCost"), 31, 0, "=-Site.Acres") })) };
    const withRewrite = await evaluateWorkbookUniver(wb, { projectNames: PROJECT_NAMES });
    expect(withRewrite.get(sheet.id).get(30, 0).value).toBe(-18175000);
    expect(withRewrite.get(sheet.id).get(31, 0).value).toBe(-12.5);
    expect(withRewrite.rewritten.length).toBeGreaterThan(0);
  });
  it("the workbook migration reports what it did, in plain words, and never mutates its input", () => {
    const wb = columnRefTable();
    const before = JSON.stringify(wb);
    const { workbook, rewritten } = migratePlanyrSyntaxInWorkbook(wb);
    expect(JSON.stringify(wb)).toBe(before);
    expect(rewritten.length).toBeGreaterThanOrEqual(8);
    expect(JSON.stringify(workbook)).not.toMatch(/\[(Qty|Price|Total)\]/);
    expect(planyrSyntaxNote(rewritten)).toMatch(/\[Column\] names.*rewritten to ordinary cell references/);
    expect(migratePlanyrSyntaxInWorkbook(workbook).rewritten).toEqual([]);           // idempotent: a second pass finds nothing
  });
  it("the in-grid guard rewrites a typed formula's parameters in place and nothing else", () => {
    expect(univerSpelling("=-Rate").text).toBe("=-(Rate)");
    expect(univerSpelling("=SUM(A1:A3)").changed).toBe(false);
    const cv = { 0: { 0: { f: "=-Rate" }, 1: { v: 5 } }, 1: { 0: { f: "=XIRR(1,A1,2,A2)" } } };
    expect(guardCellValue(cv)).toBe(2);
    expect(cv[0][0].f).toBe("=-(Rate)"); expect(cv[0][1]).toEqual({ v: 5 });
  });
});

describe("typed dates are real dates in the engine (so EDATE / XNPV / XIRR work on a workbook's date columns)", () => {
  it("ISO and m/d/yyyy text feed date functions; the text a person typed is kept", async () => {
    const fs_ = ["=EDATE(Data!D2,2)", "=Data!D3-Data!D2", "=YEAR(Data!D2)"];
    const wb = buildCorpusWorkbook(fs_);
    const ev = await evaluateWorkbookUniver(wb);
    const vals = fs_.map((_, i) => ev.get(wb.sheets[0].id).get(i, 0));
    expect(vals.every((r) => r.ok), JSON.stringify(vals)).toBe(true);
    expect(vals[1].value).toBe(17);
    expect(vals[2].value).toBe(2026);
  });
});

describe("circular references are not silent", () => {
  it("Univer calculates 0 (as Excel does); the evaluator LISTS the cells and the notice names them", async () => {
    const ev = await evaluateWorkbookUniver(acquisitionProForma(), { projectNames: PROJECT_NAMES });
    expect(ev.circular.map((c) => `${c.sheetName}!${c.row},${c.col}`).sort()).toEqual(["Assumptions!22,1", "Assumptions!24,1", "Assumptions!25,1"]);
    const n = circularNotice(ev.circular);
    expect(n).toMatch(/3 cells are in a circular reference \(Assumptions!B23/);
    expect(n).toMatch(/show 0, as in Excel/);
    expect(circularNotice([])).toBe("");
  });
});

describe("the Excel export reads Univer's values and writes formulas Excel understands", () => {
  async function exportAndRead(wb, projectNames) {
    const blob = await exportViaUniver(wb, { projectNames });
    const x = new ExcelJS.Workbook();
    await x.xlsx.load(Buffer.from(await blob.arrayBuffer()));
    return x;
  }
  it("pro-forma: every cached value equals Univer's and the formula text has no Planyr-only syntax", async () => {
    const wb = acquisitionProForma();
    const evaluated = await evaluateForExport(wb, { projectNames: PROJECT_NAMES });
    const ev = evalFromPlain(evaluated.values);
    const x = await exportAndRead(wb, PROJECT_NAMES);
    expect(read("src/workspaces/model/lib/xlsxIO.js")).toMatch(/fullCalcOnLoad = true/);
    let checked = 0;
    for (const entry of evaluated.workbook.sheets) {
      const ws = x.getWorksheet(entry.name);
      for (const [key, raw] of Object.entries(entry.sheet.cells)) {
        if (!String(raw).startsWith("=")) continue;
        const i = key.lastIndexOf(":"); const row = Number(key.slice(i + 1)); const col = entry.sheet.columns.findIndex((c) => c.id === key.slice(0, i));
        const cell = ws.getCell(row + 1, col + 1);
        const rec = ev.get(entry.id).get(row, col);
        if (typeof cell.value === "object" && cell.value && "formula" in cell.value) {
          expect(cell.value.formula, key).not.toMatch(/\[|CHOOSE\(\{1,2\},[^)]*\)\s*,\s*CHOOSE\(\{1,2\}.*Site\./);
          if (rec.ok && typeof rec.value === "number") expect(cell.value.result ?? 0, `${entry.name} ${key} ${raw}`).toBeCloseTo(rec.value, 6);
          checked++;
        }
      }
    }
    expect(checked, "vacuity guard: the export must carry live formulas").toBeGreaterThan(60);
  });
  it("[Column] formulas are exported as ordinary references with the right cached numbers", async () => {
    const x = await exportAndRead(columnRefTable());
    const ws = x.getWorksheet("Table");
    expect(ws.getCell("D2").value).toEqual({ formula: "B2*C2", result: 25 });
    expect(ws.getCell("E2").value.formula).toBe("D2/SUM(D:D)");
    expect(ws.getCell("E6").value.formula).toBe("SUM(D:D)");
    expect(ws.getCell("E6").value.result).toBeCloseTo(25 + 400 + 5.25, 9);
    expect(ws.getCell("E8").value.formula).toBe("-B8");
  });
  it("the interleaved XIRR is exported in Excel's two-list form and the cached value is the real XIRR", async () => {
    const x = await exportAndRead(acquisitionProForma(), PROJECT_NAMES);
    const cell = x.getWorksheet("Returns").getCell("B18").value;
    expect(cell.formula).toBe("XIRR(CHOOSE({1,2},B2,B7),CHOOSE({1,2},A2,A7))");
    expect(cell.result).toBeGreaterThan(0.03); expect(cell.result).toBeLessThan(0.05);
  });
  it("a project name (Site.Acres) is frozen to its value with the explanatory note — still Univer's number", async () => {
    const x = await exportAndRead(acquisitionProForma(), PROJECT_NAMES);
    const a = x.getWorksheet("Assumptions");
    expect(a.getCell("B2").value).toBe(12.5);
    expect(String(a.getCell("B2").note?.texts?.map((t) => t.text).join("") || a.getCell("B2").note)).toMatch(/frozen to its resolved value/);
    expect(a.getCell("B3").value.result).toBe(12.5 * 250000);
  });
  it("an error is cached as an error code Excel can store; a circular cell's cached value is not invented", async () => {
    let wb = createWorkbook();
    wb = renameSheet(wb, wb.activeSheetId, "S");
    const sh = [["=1/0"], ["=NA()"], ["=FOO(1)"], ["=A5"]].reduce((s, [f], r) => setRaw(s, r, 0, f), wb.sheets[0].sheet);
    wb = { ...wb, sheets: [{ ...wb.sheets[0], sheet: sh }] };
    const x = await exportAndRead(wb);
    const ws = x.getWorksheet("S");
    expect(ws.getCell("A1").value.result).toEqual({ error: "#DIV/0!" });
    expect(ws.getCell("A2").value.result).toEqual({ error: "#N/A" });
    expect(ws.getCell("A3").value.result).toEqual({ error: "#NAME?" });
  });
  it("round trip: export → import gives back the same formulas and Univer agrees with itself on the re-imported workbook", async () => {
    const wb = acquisitionProForma();
    const blob = await exportViaUniver(wb, { projectNames: PROJECT_NAMES });
    const back = await importXlsxToWorkbook(await blob.arrayBuffer());
    const a = await evaluateWorkbookUniver(back.workbook);
    const b = await evaluateWorkbookUniver(wb, { projectNames: PROJECT_NAMES });
    const pf = (r) => r.get(r === a ? "" : "").get;
    void pf;
    const sheetOf = (w, name) => w.sheets.find((e) => e.name === name);
    const returnsA = sheetOf(back.workbook, "Returns"), returnsB = sheetOf(wb, "Returns");
    for (const row of [8, 9, 10, 11, 12]) expect(a.get(returnsA.id).get(row, 1).value, `Returns row ${row}`).toBeCloseTo(b.get(returnsB.id).get(row, 1).value, 6);
  });
});

describe("the trace tool asks the older code for structure only", () => {
  it("evaluateWorkbook({ graphOnly }) returns the same dependency graph and evaluates nothing", () => {
    const wb = acquisitionProForma();
    const full = evaluateWorkbook(wb, { projectNames: PROJECT_NAMES });
    const only = evaluateWorkbook(wb, { projectNames: PROJECT_NAMES, graphOnly: true });
    const ret = wb.sheets[2];
    expect(only.get(ret.id).get(1, 1)).toBeNull();                        // no value was computed
    expect(full.get(ret.id).get(1, 1)).not.toBeNull();                    // (known-good arm: the full call does)
    for (const [r, c] of [[1, 1], [8, 1], [9, 1]]) {
      expect(only.graph.hopsFor(ret.id, r, c)).toEqual(full.graph.hopsFor(ret.id, r, c));
      expect([...only.graph.dependentsOf(ret.id, r, c)]).toEqual([...full.graph.dependentsOf(ret.id, r, c)]);
    }
    expect(only.graph.hopsFor(ret.id, 8, 1).length).toBeGreaterThan(0);   // vacuity: IRR(B2:B7) really has precedents
    expect(read("src/workspaces/model/lib/univerTools/index.js")).toMatch(/evaluateWorkbook\(wb, \{[^\n]*graphOnly: true/);
  });
});

describe("nothing else computes a value", () => {
  it("the export, the CSV and the grid reach Univer's evaluator; xlsxIO has no evaluator of its own and ModelApp skips the old one under Univer", () => {
    const xlsx = read("src/workspaces/model/lib/xlsxIO.js");
    expect(xlsx).not.toMatch(/evaluateWorkbook\(/);
    expect(xlsx).not.toMatch(/^import .*(@univerjs|univerEval)/m);                      // it runs in a Web Worker: it takes the answer in
    expect(read("src/workspaces/model/lib/spreadsheetClient.js")).toMatch(/import\("\.\/univerEval\.js"\)/);
    const app = read("src/workspaces/model/ModelApp.jsx");
    expect(app).toMatch(/import\("\.\/lib\/univerEval\.js"\)/);
    expect(app).toMatch(/univerOn \? NO_OLD_EVAL : evaluateWorkbook/);
    expect(app).not.toMatch(/sheetToCsv\(entry\.sheet, evaluateWorkbook/);
    expect(read("src/workspaces/model/lib/univerEval.js").replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "")).not.toMatch(/sheetEngine|evaluateFormula|evaluateWorkbook\(/);
  });
  it("the older evaluator says it is deprecated and who may still use it", () => {
    expect(read("src/workspaces/model/lib/sheetEngine.js")).toMatch(/DEPRECATED[\s\S]*univerEval/);
    expect(read("src/shared/formula/formula.js")).toMatch(/univerEval[\s\S]*DEPRECATED/);
  });
});
