/* Owner-shaped test workbooks for the one-formula-engine work (NEW-1): an acquisition/operating/debt/returns pro-forma that
 * uses the things a real underwriting model uses — typed currency / percent / date literals, cross-sheet references, named
 * ranges, project-derived names (Site.Acres …), SUM/IF/PMT/NPV/IRR/XNPV/XIRR/VLOOKUP/INDEX-MATCH — and a `[Column]` table that
 * only Planyr's older syntax can express. Pure builders; no I/O. */
import { createWorkbook, addSheet, setRaw, renameSheet, ensureColumnCount, setNumberFormat } from "../../../src/workspaces/model/lib/sheetModel.js";
import { defineName } from "../../../src/workspaces/model/lib/namedRanges.js";

const withSheet = (wb, idx, fn) => ({ ...wb, sheets: wb.sheets.map((e, i) => (i === idx ? { ...e, sheet: fn(e.sheet) } : e)) });
const put = (sh, rows) => { rows.forEach((row, r) => row.forEach((v, c) => { if (v !== null && v !== undefined && v !== "") sh = setRaw(sh, r, c, String(v)); })); return sh; };
const grow = (sh, cols, rows) => ({ ...ensureColumnCount(sh, cols), rowCount: rows });

/** The project names the model reads (same shape as lib/projectRefs.js buildProjectNames). */
export const PROJECT_NAMES = {
  "site.acres": { name: "Site.Acres", computed: true, value: 12.5 },
  "site.name": { name: "Site.Name", computed: true, value: "Goose Creek" },
  "plan.building1.sf": { name: "Plan.Building1.SF", computed: true, value: 215000 },
  "comp.dock.date": { name: "Comp.Dock.Date", computed: true, value: { k: "date", s: 20800 } },     // 2026-12-25
  "comp.dock.rentpsf": { name: "Comp.Dock.RentPSF", computed: true, value: { k: "error", code: "#REF!" } },
};

export function acquisitionProForma() {
  let wb = createWorkbook();
  wb = renameSheet(wb, wb.activeSheetId, "Assumptions");
  wb = addSheet(wb); wb = renameSheet(wb, wb.sheets[1].id, "Pro forma");
  wb = addSheet(wb); wb = renameSheet(wb, wb.sheets[2].id, "Returns");
  wb = withSheet(wb, 0, (sh) => {
    sh = grow(sh, 4, 40);
    sh = put(sh, [
      ["Land price per acre", "$250,000"], ["Acres", "=Site.Acres"], ["Land cost", "=B1*B2"],
      ["Building SF", "=Plan.Building1.SF"], ["Hard cost per SF", "$62.50"], ["Hard cost", "=B4*B5"],
      ["Soft cost %", "12%"], ["Soft cost", "=B6*B7"], ["Total cost", "=B3+B6+B8"],
      ["Rent per SF / yr", "7.25"], ["Vacancy", "5%"], ["Opex per SF", "1.85"],
      ["Interest rate", "6.5%"], ["Term (years)", "25"], ["LTC", "65%"],
      ["Purchase date", "1/15/2027"], ["Exit date", "2032-01-15"], ["Exit cap", "6%"],
      ["Project", "=Site.Name"],
    ]);
    sh = setNumberFormat(sh, 8, 8, 1, 1, "$#,##0");
    sh = defineName(sh, "TotalCost", { r1: 9, c1: 2, r2: 9, c2: 2 });
    sh = defineName(sh, "Rate", { r1: 13, c1: 2, r2: 13, c2: 2 });
    sh = setRaw(sh, 20, 0, "Name on this sheet"); sh = setRaw(sh, 20, 1, "=TotalCost/Site.Acres");
    // circular references (deliberate): a cell that reads itself, and two cells that read each other
    sh = setRaw(sh, 22, 1, "=B23"); sh = setRaw(sh, 24, 1, "=B26+1"); sh = setRaw(sh, 25, 1, "=B25+1");
    // a project date (Comp.*.Date) and a project error value used in arithmetic
    sh = setRaw(sh, 27, 1, "=Comp.Dock.Date+30"); sh = setRaw(sh, 28, 1, "=Comp.Dock.Date");
    return sh;
  });
  wb = withSheet(wb, 1, (sh) => {
    sh = grow(sh, 14, 40);

    sh = setRaw(sh, 0, 0, "Month");
    for (let m = 1; m <= 12; m++) sh = setRaw(sh, 0, m, String(m));
    sh = setRaw(sh, 1, 0, "Gross rent");
    sh = setRaw(sh, 1, 1, "=Assumptions!B4*Assumptions!B10/12");
    for (let m = 2; m <= 12; m++) sh = setRaw(sh, 1, m, `=${String.fromCharCode(64 + m)}2*1.003`);
    sh = setRaw(sh, 2, 0, "Vacancy");
    for (let m = 1; m <= 12; m++) sh = setRaw(sh, 2, m, `=-${String.fromCharCode(65 + m)}2*Assumptions!B11`);
    sh = setRaw(sh, 3, 0, "Opex");
    for (let m = 1; m <= 12; m++) sh = setRaw(sh, 3, m, `=-Assumptions!B4*Assumptions!B12/12`);
    sh = setRaw(sh, 4, 0, "NOI");
    for (let m = 1; m <= 12; m++) sh = setRaw(sh, 4, m, `=SUM(${String.fromCharCode(65 + m)}2:${String.fromCharCode(65 + m)}4)`);
    sh = setRaw(sh, 5, 0, "Year 1 NOI"); sh = setRaw(sh, 5, 1, "=SUM(B5:M5)");
    sh = setRaw(sh, 6, 0, "Loan amount"); sh = setRaw(sh, 6, 1, "=Assumptions!B9*Assumptions!B15");
    sh = setRaw(sh, 7, 0, "Monthly payment"); sh = setRaw(sh, 7, 1, "=-PMT(Assumptions!B13/12,Assumptions!B14*12,B7)");
    sh = setRaw(sh, 8, 0, "Annual debt service"); sh = setRaw(sh, 8, 1, "=B8*12");
    sh = setRaw(sh, 9, 0, "DSCR"); sh = setRaw(sh, 9, 1, "=IFERROR(B6/B9,0)");
    sh = setRaw(sh, 10, 0, "Yield on cost"); sh = setRaw(sh, 10, 1, "=B6/Assumptions!B9");
    sh = setRaw(sh, 11, 0, "Year-1 interest"); sh = setRaw(sh, 11, 1, "=-CUMIPMT(Assumptions!B13/12,Assumptions!B14*12,B7,1,12,0)");
    sh = setRaw(sh, 12, 0, "Status"); sh = setRaw(sh, 12, 1, '=IF(B10>=Assumptions!B18,"Meets exit cap","Below exit cap")');
    sh = setRaw(sh, 13, 0, "Label"); sh = setRaw(sh, 13, 1, '=Assumptions!B19&" — "&TEXT(B6,"$#,##0")');
    return sh;
  });
  wb = withSheet(wb, 2, (sh) => {
    sh = grow(sh, 6, 40);
    sh = put(sh, [
      ["Date", "Cash flow", "Label"],
      ["=Assumptions!B16", "=-Assumptions!B9", "Purchase"],
      ["1/15/2028", "='Pro forma'!B6", "Year 1"],
      ["1/15/2029", "='Pro forma'!B6*1.03", "Year 2"],
      ["1/15/2030", "='Pro forma'!B6*1.06", "Year 3"],
      ["1/15/2031", "='Pro forma'!B6*1.09", "Year 4"],
      ["=Assumptions!B17", "='Pro forma'!B6*1.12+'Pro forma'!B6*1.12/Assumptions!B18", "Exit"],
      ["", "", ""],
      ["IRR (annual flows)", "=IRR(B2:B7)", ""], ["XIRR", "=XIRR(B2:B7,A2:A7)", ""], ["XNPV @10%", "=XNPV(0.1,B2:B7,A2:A7)", ""],
      ["NPV @10%", "=NPV(0.1,B3:B7)+B2", ""], ["Equity multiple", "=SUM(B3:B7)/-B2", ""],
      ["Best year", "=INDEX(C3:C7,MATCH(MAX(B3:B6),B3:B6,0))", ""],
      ["Lookup", '=VLOOKUP("Year 3",C2:C7,1,FALSE)', ""],
      ["Hold (years)", "=DATEDIF(A2,A7,\"y\")", ""], ["Exit month end", "=EOMONTH(A7,0)", ""],
      ["Interleaved XIRR", "=XIRR(B2,A2,B7,A7)", ""],
      ["Name from another sheet", "=TotalCost", ""],
    ]);
    return sh;
  });
  return wb;
}

/** A table that uses Planyr's own `[Column]` syntax (columns are named). */
export function columnRefTable() {
  let wb = createWorkbook();
  wb = renameSheet(wb, wb.activeSheetId, "Table");
  wb = withSheet(wb, 0, (sh) => {
    sh = grow(sh, 5, 20);
    sh = { ...sh, columns: sh.columns.map((c, i) => ({ ...c, name: ["Item", "Qty", "Price", "Total", "Share"][i] })) };
    sh = put(sh, [["Item", "Qty", "Price", "Total", "Share"]]);
    [["A", 10, 2.5], ["B", 4, 100], ["C", 7, 0.75]].forEach((row, i) => {
      const r = i + 1;
      sh = setRaw(sh, r, 0, row[0]); sh = setRaw(sh, r, 1, String(row[1])); sh = setRaw(sh, r, 2, String(row[2]));
      sh = setRaw(sh, r, 3, "=[Qty]*[Price]"); sh = setRaw(sh, r, 4, "=[@Total]/SUM([Total])");
    });
    sh = setRaw(sh, 5, 0, "Sum"); sh = setRaw(sh, 5, 4, "=SUM([Total])"); sh = setRaw(sh, 6, 4, "=AVERAGE([Price])+MAX([Qty])"); sh = setRaw(sh, 7, 4, "=-[Qty]");
    return sh;
  });
  return wb;
}
