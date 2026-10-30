/* The Univer bridge (lib/univerBridge.js) — the spike's central claim: Planyr blob → Univer → Planyr blob is
 * lossless for every field the model stores. Real fixtures go through the real importers first, so the
 * workbooks under test are ones a person's files actually produce, then a synthetic workbook sets EVERY stored
 * field (styles, borders, merges, names, freeze, hidden rows/columns, heights, odd literals) so a field the
 * fixtures happen not to use cannot slip through. Red-proofs at the bottom break the bridge on purpose. */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { parseSpreadsheetFile } from "../src/workspaces/model/lib/spreadsheetFile.js";
import {
  createWorkbook, migrateWorkbook, canonicalJson, setRaw, setNumberFormat, setCellStyle, applyBorder, mergeRange,
  setRowHeight, setColumnWidth, setRowsHidden, setColumnsHidden, setFreeze, addSheet, applyToActiveSheet, cellKey,
} from "../src/workspaces/model/lib/sheetModel.js";
import { defineName } from "../src/workspaces/model/lib/namedRanges.js";
import {
  workbookToUniver, univerToWorkbook, sidecarAfterStructure, projectNamesToDefinedNames, typeLiteral, inferLiteralPattern,
  refStringToRect, rectToRefString, PROJECT_NAME_ID_PREFIX,
} from "../src/workspaces/model/lib/univerBridge.js";

const fixture = (name) => new Uint8Array(readFileSync(new URL(`./fixtures/spreadsheet/${name}`, import.meta.url)));
const roundTrip = (wb, opts) => {
  const { data, sidecar } = workbookToUniver(wb);
  return { data, sidecar, ...univerToWorkbook(JSON.parse(JSON.stringify(data)), { sidecar, activeSheetId: wb.activeSheetId, ...opts }) };
};
const expectLossless = (wb) => {
  const { workbook, notes } = roundTrip(wb);
  expect(canonicalJson(workbook)).toBe(canonicalJson(migrateWorkbook(wb)));
  return notes;
};

/** A workbook that uses every field the model stores. */
function everythingWorkbook() {
  let wb = createWorkbook();
  wb = addSheet(wb);
  const first = (fn) => applyToActiveSheet({ ...wb, activeSheetId: wb.sheets[0].id }, fn);
  let sh = wb.sheets[0].sheet;
  sh = setRaw(sh, 0, 0, "Land");
  sh = setRaw(sh, 0, 1, "250000");
  sh = setRaw(sh, 1, 0, "Cap rate");
  sh = setRaw(sh, 1, 1, "6.25%");
  sh = setRaw(sh, 2, 0, "Price");
  sh = setRaw(sh, 2, 1, "$1,200.50");
  sh = setRaw(sh, 3, 1, "1,200");
  sh = setRaw(sh, 4, 1, "  42 ");           // number typed with padding: raw text must come back byte-identical
  sh = setRaw(sh, 5, 1, "true");
  sh = setRaw(sh, 6, 1, "=B1*2");
  sh = setRaw(sh, 7, 1, "=SUM(B1:B4)");
  sh = setRaw(sh, 8, 0, "1/15/2027");       // typed date text
  sh = setRaw(sh, 9, 0, "=Sheet2!A1");
  sh = setRaw(sh, 10, 0, "line one\nline two");
  sh = setRaw(sh, 11, 0, "00123");
  sh = setNumberFormat(sh, 0, 0, 1, 1, "#,##0");
  sh = setNumberFormat(sh, 6, 6, 1, 1, "$#,##0.00");
  sh = setNumberFormat(sh, 7, 7, 1, 1, "#,##0.00;[Red](#,##0.00)");
  sh = setNumberFormat(sh, 20, 20, 3, 3, '0.00"/SF"');      // a format on an EMPTY cell
  sh = setCellStyle(sh, 0, 0, 0, 0, { bold: true, italic: true, underline: true, strike: true, fontFamily: "Arial", fontSize: 14, color: "#ff0000", fill: "#eeeeee", align: "center", valign: "middle", wrap: true });
  sh = setCellStyle(sh, 1, 1, 0, 0, { indent: 3 });          // indent ONLY: Univer cannot draw it
  sh = setCellStyle(sh, 2, 2, 0, 0, { align: "right", indent: 2, bold: true });
  sh = applyBorder(sh, 4, 6, 3, 5, { edges: ["top", "right", "bottom", "left"], style: "thin", mode: "outline" });
  sh = applyBorder(sh, 8, 8, 2, 2, { edges: ["bottom", "left"], style: "double", mode: "all" });
  sh = mergeRange(sh, 12, 12, 0, 3);
  sh = setRowHeight(sh, 3, 40);
  sh = setColumnWidth(sh, 2, 200);
  sh = setRowsHidden(sh, 15, 16, true);
  sh = setColumnsHidden(sh, 6, 6, true);
  sh = setFreeze(sh, 2, 1);
  sh = defineName(sh, "LandCost", { r1: 1, c1: 2, r2: 1, c2: 2 });
  sh = defineName(sh, "Block", { r1: 1, c1: 1, r2: 4, c2: 2 });
  sh = { ...sh, dismissedInconsistencies: { [cellKey(sh.columns[1].id, 6)]: true }, unsupportedFormulas: { [cellKey(sh.columns[1].id, 7)]: "=VLOOKUP(A1,A:B,2,0)" } };
  wb = { ...wb, sheets: [{ ...wb.sheets[0], name: "Pro forma", sheet: sh }, ...wb.sheets.slice(1)] };
  void first;
  return wb;
}

describe("Univer bridge — real fixtures round trip", () => {
  for (const name of ["chart.xlsx", "legacy.xls"]) {
    it(`${name}: blob → Univer → blob is byte-equivalent`, async () => {
      const parsed = await parseSpreadsheetFile(fixture(name), name);
      const wb = parsed.workbook;
      expect(wb.sheets.length).toBeGreaterThan(0);
      expect(Object.keys(wb.sheets[0].sheet.cells).length, "the fixture must actually hold cells (vacuity guard)").toBeGreaterThan(0);
      expectLossless(wb);
    });
  }
  it("an empty new workbook round-trips", () => { expectLossless(createWorkbook()); });
});

describe("Univer bridge — every stored field", () => {
  const wb = everythingWorkbook();
  it("the synthetic workbook really uses every field (vacuity guard)", () => {
    const sh = wb.sheets[0].sheet;
    for (const f of ["cells", "formats", "styles", "rowHeights", "hiddenRows", "merges", "names", "dismissedInconsistencies", "unsupportedFormulas"]) {
      expect(Object.keys(sh[f]).length, f).toBeGreaterThan(0);
    }
    expect(sh.freezeRows).toBe(2);
    expect(sh.freezeCols).toBe(1);
    expect(sh.columns.some((c) => c.hidden)).toBe(true);
    expect(wb.sheets.length).toBe(2);
  });
  it("is lossless", () => { expectLossless(wb); });
  it("Univer receives the values and looks, not just opaque text", () => {
    const { data } = workbookToUniver(wb);
    const s = data.sheets[wb.sheets[0].id];
    expect(s.cellData[0][1]).toMatchObject({ v: 250000, t: 2 });
    expect(s.cellData[1][1].v).toBe(0.0625);
    expect(data.styles[s.cellData[1][1].s].n.pattern).toBe("0.00%");        // "6.25%" shows as 6.25%
    expect(data.styles[s.cellData[2][1].s].n.pattern).toBe("$#,##0.00");
    expect(s.cellData[6][1].f).toBe("=B1*2");
    expect(s.freeze).toMatchObject({ xSplit: 1, ySplit: 2 });
    expect(s.mergeData).toEqual([{ startRow: 12, endRow: 12, startColumn: 0, endColumn: 3 }]);
    expect(s.rowData[3]).toMatchObject({ h: 40 });
    expect(s.rowData[15].hd).toBe(1);
    expect(s.columnData[2].w).toBe(200);
    expect(s.columnData[6].hd).toBe(1);
    const st = data.styles[s.cellData[0][0].s];
    expect(st).toMatchObject({ bl: 1, it: 1, ul: { s: 1 }, st: { s: 1 }, ff: "Arial", fs: 14, cl: { rgb: "#ff0000" }, bg: { rgb: "#eeeeee" }, ht: 2, vt: 2, tb: 3 });
    const names = JSON.parse(data.resources[0].data);
    expect(Object.values(names).map((n) => n.name).sort()).toEqual(["Block", "LandCost"]);
  });
  it("a synthesised display pattern is never saved back as the user's format", () => {
    const { workbook } = roundTrip(wb);
    const sh = workbook.sheets[0].sheet;
    expect(sh.formats[cellKey(sh.columns[1].id, 1)]).toBeUndefined();
  });
});

describe("Univer bridge — edits made inside Univer come back", () => {
  const base = everythingWorkbook();
  const open = () => workbookToUniver(base);
  const back = ({ data, sidecar }, extra) => univerToWorkbook(data, { sidecar, activeSheetId: base.activeSheetId, ...extra });

  it("a typed value, a formula and a clear", () => {
    const u = open();
    const sid = base.sheets[0].id;
    u.data.sheets[sid].cellData[30] = { 0: { v: 7, t: 2 }, 1: { f: "=A31+1" } };
    delete u.data.sheets[sid].cellData[0][0];
    const { workbook } = back(u);
    const sh = workbook.sheets[0].sheet;
    expect(sh.cells[cellKey(sh.columns[0].id, 30)]).toBe("7");
    expect(sh.cells[cellKey(sh.columns[1].id, 30)]).toBe("=A31+1");
    expect(sh.cells[cellKey(sh.columns[0].id, 0)]).toBeUndefined();
  });
  it("an inserted column keeps every column's id, so cells stay with their column", () => {
    const u = open();
    const sid = base.sheets[0].id;
    const before = base.sheets[0].sheet.columns.map((c) => c.id);
    // Univer inserts a column at index 1: existing columns 1.. shift right and its cell data with them.
    const sh = u.data.sheets[sid];
    const moved = {};
    for (const [r, row] of Object.entries(sh.cellData)) { moved[r] = {}; for (const [c, cell] of Object.entries(row)) moved[r][Number(c) >= 1 ? Number(c) + 1 : Number(c)] = cell; }
    sh.cellData = moved; sh.columnCount += 1;
    sh.columnData = Object.fromEntries(Object.entries(sh.columnData).map(([c, d]) => [Number(c) >= 1 ? Number(c) + 1 : Number(c), d]));
    const sidecar = sidecarAfterStructure(u.sidecar, sid, { op: "insert-col", index: 1 });
    const { workbook } = back({ data: u.data, sidecar });
    const out = workbook.sheets[0].sheet;
    expect(out.columns.length).toBe(before.length + 1);
    expect(out.columns[0].id).toBe(before[0]);
    expect(out.columns[2].id).toBe(before[1]);
    expect(out.columns[1].id).not.toBe(before[1]);
    expect(out.cells[cellKey(before[1], 0)]).toBe("250000");     // B1 is now C1 but is still the same column id
    expect(out.columns[3].width).toBe(200);                       // the 200-wide column moved with its data
  });
  it("a deleted row drops that row's sidecar entries and shifts the rest", () => {
    const { sidecar } = open();
    const sid = base.sheets[0].id;
    const id0 = base.sheets[0].sheet.columns[0].id;
    const next = sidecarAfterStructure(sidecar, sid, { op: "remove-row", index: 1 });
    expect(next.sheets[sid].indent[cellKey(id0, 1)]).toBe(2);       // old row 2 (indent 2) is now row 1
    expect(next.sheets[sid].indent[cellKey(id0, 2)]).toBeUndefined();
  });
  it("a vertical merge made in Univer is reported, not silently dropped", () => {
    const u = open();
    u.data.sheets[base.sheets[0].id].mergeData.push({ startRow: 20, endRow: 22, startColumn: 0, endColumn: 0 });
    const { notes, workbook } = back(u);
    expect(notes.join(" ")).toMatch(/merge across several rows/);
    expect(workbook.sheets[0].sheet.merges.length).toBe(1);
  });
  it("a shared (copied) formula is resolved through formulaOf, and reported when it cannot be", () => {
    const u = open();
    const sid = base.sheets[0].id;
    u.data.sheets[sid].cellData[40] = { 3: { si: "abc" } };
    expect(back(u).notes.join(" ")).toMatch(/shared formula/);
    const { workbook } = back(u, { formulaOf: (s, r, c) => (s === sid && r === 40 && c === 3 ? "=A1+B1" : null) });
    const sh = workbook.sheets[0].sheet;
    expect(sh.cells[cellKey(sh.columns[3].id, 40)]).toBe("=A1+B1");
  });
  it("an ordinary edit of an existing cell (Univer's one-run rich text) saves as plain text, quietly", () => {
    const u = open();
    const sid = base.sheets[0].id;
    u.data.sheets[sid].cellData[0][1] = { p: { id: "d", body: { dataStream: "alphaX\r\n", textRuns: [{ st: 5, ed: 6, ts: { cl: { rgb: "#1B1E26" } } }], paragraphs: [{ startIndex: 6 }] } } };
    const { workbook, notes } = back(u);
    const sh = workbook.sheets[0].sheet;
    expect(sh.cells[cellKey(sh.columns[1].id, 0)]).toBe("alphaX");
    expect(notes.join(" ")).not.toMatch(/rich text/);
  });
  it("real rich formatting inside a cell IS reported, and a line break survives", () => {
    const u = open();
    const sid = base.sheets[0].id;
    u.data.sheets[sid].cellData[0][1] = { p: { id: "d", body: { dataStream: "a\rb\r\n", textRuns: [{ st: 0, ed: 1, ts: { bl: 1 } }] } } };
    const { workbook, notes } = back(u);
    const sh = workbook.sheets[0].sheet;
    expect(sh.cells[cellKey(sh.columns[1].id, 0)]).toBe("a\nb");
    expect(notes.join(" ")).toMatch(/rich text/);
  });
  it("renaming a sheet and switching the active tab", () => {
    const u = open();
    u.data.sheets[base.sheets[1].id].name = "Renamed";
    const { workbook } = univerToWorkbook(u.data, { sidecar: u.sidecar, activeSheetId: base.sheets[1].id });
    expect(workbook.sheets[1].name).toBe("Renamed");
    expect(workbook.activeSheetId).toBe(base.sheets[1].id);
  });
  it("a defined name that is not a plain range is reported, a project name is never saved", () => {
    const u = open();
    const sid = base.sheets[0].id;
    const names = JSON.parse(u.data.resources[0].data);
    names.x1 = { id: "x1", name: "Weird", formulaOrRefString: "=SUM(A1:A3)", localSheetId: sid };
    names[`${PROJECT_NAME_ID_PREFIX}site.acres`] = { id: `${PROJECT_NAME_ID_PREFIX}site.acres`, name: "Site.Acres", formulaOrRefString: "=12.5" };
    u.data.resources[0].data = JSON.stringify(names);
    const { workbook, notes } = back(u);
    expect(notes.join(" ")).toMatch(/Weird/);
    expect(Object.keys(workbook.sheets[0].sheet.names).sort()).toEqual(["block", "landcost"]);
  });
});

describe("Univer bridge — helpers", () => {
  it("typeLiteral mirrors the engine for numbers, percents, currency, booleans", () => {
    expect(typeLiteral("6.25%")).toEqual({ kind: "number", value: 0.0625 });
    expect(typeLiteral("$1,200.50")).toEqual({ kind: "number", value: 1200.5 });
    expect(typeLiteral("TRUE")).toEqual({ kind: "bool", value: true });
    expect(typeLiteral("abc").kind).toBe("text");
  });
  it("inferLiteralPattern keeps the decimals the person typed", () => {
    expect(inferLiteralPattern("6.25%")).toBe("0.00%");
    expect(inferLiteralPattern("25%")).toBe("0%");
    expect(inferLiteralPattern("$1,200")).toBe("$#,##0");
    expect(inferLiteralPattern("1,200.5")).toBe("#,##0.0");
    expect(inferLiteralPattern("250000")).toBeNull();
  });
  it("range refs convert both ways, including quoted sheet names", () => {
    expect(rectToRefString("Pro forma", { r1: 1, c1: 2, r2: 4, c2: 3 })).toBe("'Pro forma'!$B$1:$C$4");
    expect(refStringToRect("'Pro forma'!$B$1:$C$4")).toEqual({ r1: 1, c1: 2, r2: 4, c2: 3 });
    expect(refStringToRect("Sheet1!$A$1")).toEqual({ r1: 1, c1: 1, r2: 1, c2: 1 });
    expect(refStringToRect("=SUM(A1:A3)")).toBeNull();
  });
  it("project names become constant defined names; errors and strings keep their kind", () => {
    const out = projectNamesToDefinedNames({
      "site.acres": { name: "Site.Acres", computed: true, value: 12.5 },
      "site.county": { name: "Site.County", computed: true, value: "harris" },
      "plan.building1.sf": { name: "Plan.Building1.SF", computed: true, value: { k: "error", code: "#REF!" } },
      "mine": { name: "Mine", r1: 1, c1: 1, r2: 1, c2: 1 },
    });
    expect(Object.values(out).map((d) => d.formulaOrRefString).sort()).toEqual(['="harris"', "#REF!".padStart(6, "=").replace("=#REF!", "=#REF!"), "=12.5"].sort());
    expect(Object.keys(out).every((k) => k.startsWith(PROJECT_NAME_ID_PREFIX))).toBe(true);
    expect(Object.values(out).length).toBe(3);
  });
});

describe("Univer bridge — red proofs (the test must fail on a broken bridge)", () => {
  it("a bridge that forgets the sidecar changes the blob, and the lossless check notices", () => {
    const wb = everythingWorkbook();
    const { data } = workbookToUniver(wb);
    const { workbook } = univerToWorkbook(data, { sidecar: null, activeSheetId: wb.activeSheetId });
    expect(canonicalJson(workbook)).not.toBe(canonicalJson(migrateWorkbook(wb)));
  });
  it("a bridge that drops a style field changes the blob", () => {
    const wb = everythingWorkbook();
    const { data, sidecar } = workbookToUniver(wb);
    for (const s of Object.values(data.styles)) delete s.bl;
    const { workbook } = univerToWorkbook(data, { sidecar, activeSheetId: wb.activeSheetId });
    expect(canonicalJson(workbook)).not.toBe(canonicalJson(migrateWorkbook(wb)));
  });
});
