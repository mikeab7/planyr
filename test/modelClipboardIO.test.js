/* lib/clipboardIO.js — the REAL clipboard (Ctrl+C / Ctrl+X / Ctrl+V). Owner, 2026-10-29: "Ctrl C, V, and X don't really work
 * that well." Each case below is one of the situations he named; all of them are red on main (the module does not exist there,
 * and the old internal-ref clipboard could do none of the cross-app / formatting / move cases). */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
  buildClip, clipToText, clipToHtml, parseClipboard, parseTsv, clipFromHtml, clipFromText, applyClip, pasteGeometry,
  pasteMoveSameSheet, msoFormatToToken, cssColorToHex, clipIsEmpty, CLIP_MARK,
} from "../src/workspaces/model/lib/clipboardIO.js";
import {
  createSheet, createWorkbook, commitCellText, setCellStyle, setNumberFormat, mergeRange, mergeAt, rawAt, styleAt, formatAt,
  setRowsHidden, setColumnsHidden, applyToActiveSheet, addSheet, activeSheetEntry,
} from "../src/workspaces/model/lib/sheetModel.js";
import { evaluateWorkbook, displayFor } from "../src/workspaces/model/lib/sheetEngine.js";

const EXCEL_HTML = readFileSync(new URL("./fixtures/spreadsheet/excel-range.html", import.meta.url), "utf8");

function show(sheet) {
  const wb = { ...createWorkbook(), sheets: [{ id: "s1", name: "Sheet1", sheet }], activeSheetId: "s1" };
  const ev = evaluateWorkbook(wb, {}).get("s1");
  return (r, c) => displayFor(sheet, ev, r, c);
}
const put = (s, r, c, t) => commitCellText(s, r, c, t);
const sel = (r1, c1, r2 = r1, c2 = c1) => ({ r1, r2, c1, c2 });

function sample() {
  let s = createSheet();
  s = put(s, 0, 0, "Item"); s = put(s, 0, 1, "100"); s = put(s, 1, 0, "Total"); s = put(s, 1, 1, "=B1*2");
  s = setCellStyle(s, 0, 0, 0, 1, { bold: true, fill: "#ffff00" });
  s = setNumberFormat(s, 1, 1, 1, 1, "$#,##0.00");
  return s;
}

describe("copy writes BOTH text/plain (TSV of displayed values) and styled text/html with the Planyr marker", () => {
  const s = sample();
  const clip = buildClip(s, sel(0, 0, 1, 1));
  const at = show(s);
  it("text/plain is tab-separated, rows by newline, DISPLAYED values (the currency formatting shows)", () => {
    expect(clipToText(clip, at)).toBe("Item\t100\nTotal\t$200.00");
  });
  it("text/html is a table with inline styles Excel / Outlook understand", () => {
    const html = clipToHtml(clip, at);
    expect(html).toMatch(/<table[^>]*data-planyr-clip="/);
    expect(html).toContain("font-weight:700");
    expect(html).toContain("background:#ffff00");
    expect(html).toContain("mso-number-format:");
    expect(html).toContain(">$200.00</td>");
    expect(html).toContain("<!--StartFragment-->");
  });
  it("a cell holding a tab, newline or quote is quoted the way Excel writes it", () => {
    let t = put(createSheet(), 0, 0, 'say "hi"\nthere'); t = put(t, 0, 1, "b");
    const text = clipToText(buildClip(t, sel(0, 0, 0, 1)), show(t));
    expect(text).toBe('"say ""hi""\nthere"\tb');
    expect(parseTsv(text)).toEqual([['say "hi"\nthere', "b"]]);
  });
  it("merged cells become colspan; covered cells are not written twice", () => {
    let t = put(createSheet(), 0, 0, "Title"); t = mergeRange(t, 0, 0, 0, 2);
    const html = clipToHtml(buildClip(t, sel(0, 0, 0, 3)), show(t));
    expect(html).toContain('colspan="3"');
    expect((html.match(/<td/g) || []).length).toBe(2);
  });
});

describe("Planyr -> Planyr through the clipboard (marker round-trip)", () => {
  const s = sample();
  const html = clipToHtml(buildClip(s, sel(0, 0, 1, 1)), show(s));
  const parsed = parseClipboard({ html, text: "ignored" });
  it("the marker is found and wins over the plain text", () => {
    expect(parsed.kind).toBe("planyr");
    expect(html).toContain(CLIP_MARK);
  });
  it("formulas keep their text and relocate by the destination delta (=B1*2 pasted at A5 reads B5*2)", () => {
    const { sheet: out } = applyClip(createSheet(), parsed, sel(4, 0));
    expect(rawAt(out, 5, 1)).toBe("=B5*2");
    expect(show(put(out, 4, 1, "100"))(5, 1)).toBe("$200.00");
  });
  it("styles and number formats come along (the old clipboard copied raw text only)", () => {
    const { sheet: out } = applyClip(createSheet(), parsed, sel(4, 0));
    expect(styleAt(out, 4, 0)).toMatchObject({ bold: true, fill: "#ffff00" });
    expect(formatAt(out, 5, 1)).toBe("$#,##0.00");
  });
  it("merges come along", () => {
    let t = put(createSheet(), 0, 0, "Title"); t = mergeRange(t, 0, 0, 0, 2);
    const p = parseClipboard({ html: clipToHtml(buildClip(t, sel(0, 0, 0, 2)), show(t)) });
    const { sheet: out } = applyClip(createSheet(), p, sel(3, 1));
    expect(mergeAt(out, 3, 2)).toEqual({ r: 3, c1: 1, c2: 3 });
  });
  it("works across sheet TABS and across two WORKBOOKS (the payload is plain data on the OS clipboard — a reload loses nothing)", () => {
    let wb = createWorkbook();
    wb = applyToActiveSheet(wb, () => s);
    wb = addSheet(wb);
    const other = activeSheetEntry(wb);
    const fromClipboard = JSON.parse(JSON.stringify(parseClipboard({ html }))); // survives serialisation
    const { sheet: out } = applyClip(other.sheet, fromClipboard, sel(2, 2));
    expect(rawAt(out, 2, 2)).toBe("Item");
    expect(rawAt(out, 3, 3)).toBe("=D3*2");
    const second = applyClip(createSheet(), parseClipboard({ html }), sel(0, 0)); // "another workbook"
    expect(rawAt(second.sheet, 1, 1)).toBe("=B1*2");
  });
});

describe("paste of an EXCEL fragment (captured fixture)", () => {
  const clip = parseClipboard({ html: EXCEL_HTML, text: "Item\tCost" });
  it("is read as an html clip, not the plain text next to it", () => expect(clip.kind).toBe("html"));
  it("values: entities decoded, unformatted numbers taken from x:num, the date shown as typed, <br> kept as a new line", () => {
    const v = clip.cells.map((row) => row.map((x) => x.raw));
    expect(v[0]).toEqual(["Item", "Cost", "Share"]);
    expect(v[1]).toEqual(["Land & site", "1234.5", "0.25"]);
    expect(v[3][2]).toBe("12/24/2025"); // a date keeps its displayed text (Excel's serial is a different epoch)
    expect(v[4][0]).toBe("Two\nlines");
  });
  it("Excel's own formula text is kept (x:fmla)", () => expect(clip.cells[3][1].raw).toBe("=SUM(B2:B3)"));
  it("formatting: bold + yellow from the class rule, <b>, italic red centred with a bottom border, mso-number-format -> tokens", () => {
    expect(clip.cells[0][0].style).toMatchObject({ bold: true, fill: "#ffff00" });
    expect(clip.cells[3][0].style).toMatchObject({ bold: true });
    expect(clip.cells[2][2].style).toMatchObject({ italic: true, color: "#c00000", align: "center", border: { bottom: "thin" } });
    expect(clip.cells[1][1].format).toBe('"$"#,##0.00');
    expect(clip.cells[1][2].format).toBe("0.00%");
    expect(clip.cells[3][2].format).toBe("mm/dd/yyyy");
  });
  it("Excel's defaults are NOT imported as choices (black text, bottom alignment, 'general' alignment, no border)", () => {
    expect(clip.cells[1][0].style).toBeNull();
    expect(clip.cells[1][1].style).toBeNull();
  });
  it("colspan becomes a horizontal merge", () => expect(clip.merges).toEqual([{ ri: 4, ci1: 0, ci2: 2 }]));
  it("pasting it gives real cells that display like Excel's", () => {
    const { sheet: out } = applyClip(createSheet(), clip, sel(10, 0));
    const at = show(out);
    expect(at(11, 1)).toBe("$1,234.50");
    expect(at(11, 2)).toBe("25.00%");
    expect(rawAt(out, 13, 1)).toBe("=SUM(B2:B3)");
    expect(mergeAt(out, 14, 1)).toEqual({ r: 14, c1: 0, c2: 2 });
  });
});

describe("paste of plain text", () => {
  it("a tab / newline block lands as a grid; a final newline adds no empty row", () => {
    const c = clipFromText("a\tb\nc\td\n");
    expect(c.cells.map((r) => r.map((x) => x.raw))).toEqual([["a", "b"], ["c", "d"]]);
  });
  it("RED ON MAIN: a line with commas is ONE cell (Excel does not split on commas)", () => {
    const c = parseClipboard({ text: "alpha, beta, gamma" });
    expect(c.cells).toHaveLength(1);
    expect(c.cells[0]).toHaveLength(1);
    expect(c.cells[0][0].raw).toBe("alpha, beta, gamma");
  });
  it("a plain-text paste leaves the destination's formatting alone", () => {
    let s = setCellStyle(put(createSheet(), 0, 0, "old"), 0, 0, 0, 0, { bold: true });
    const { sheet: out } = applyClip(s, parseClipboard({ text: "new" }), sel(0, 0));
    expect(rawAt(out, 0, 0)).toBe("new");
    expect(styleAt(out, 0, 0).bold).toBe(true);
  });
  it("numbers, percents, currency and dates are stored as typed — the engine coerces them exactly as typing would", () => {
    const { sheet: out } = applyClip(createSheet(), parseClipboard({ text: "1,200\t12%\t$5\t3/4/2026" }), sel(0, 0));
    const at = show(out);
    expect(at(0, 0)).toBe("1,200");
    expect(["12%", "0.12", "12.0%"]).toContain(at(0, 1));
    expect(rawAt(out, 0, 3)).toBe("3/4/2026");
  });
  it("nothing usable -> null (the app says so out loud)", () => {
    expect(parseClipboard({ html: "", text: "" })).toBeNull();
    expect(parseClipboard({ html: "<p>no table here</p>", text: "" })).toBeNull();
    expect(clipIsEmpty(null)).toBe(true);
  });
  it("html without a table falls back to the plain text beside it", () => {
    expect(parseClipboard({ html: "<p>hello</p>", text: "hello" }).kind).toBe("text");
  });
});

describe("where a paste lands: tiling, filling the selection, running past the last column", () => {
  const one = clipFromText("9");
  it("a single value fills EVERY selected cell (Excel)", () => {
    const { sheet: out, dest } = applyClip(createSheet(), one, sel(2, 1, 4, 2));
    expect(dest).toEqual({ r1: 2, r2: 4, c1: 1, c2: 2 });
    for (const [r, c] of [[2, 1], [3, 2], [4, 1]]) expect(rawAt(out, r, c)).toBe("9");
    expect(rawAt(out, 5, 1)).toBe("");
  });
  it("a block tiles when the selection is a whole multiple of it, else pastes once at the top-left", () => {
    const block = clipFromText("a\tb");
    expect(pasteGeometry(block, sel(0, 0, 0, 3))).toMatchObject({ rows: 1, cols: 4 });
    expect(pasteGeometry(block, sel(0, 0, 0, 2))).toMatchObject({ rows: 1, cols: 2 });
    const { sheet: out } = applyClip(createSheet(), block, sel(0, 0, 1, 3));
    expect([rawAt(out, 1, 2), rawAt(out, 1, 3)]).toEqual(["a", "b"]);
  });
  it("a paste that runs past the last column ADDS columns instead of clipping", () => {
    const s = createSheet();
    const { sheet: out } = applyClip(s, clipFromText("1\t2\t3\t4"), sel(0, s.columns.length - 2));
    expect(out.columns.length).toBe(s.columns.length + 2);
    expect(rawAt(out, 0, out.columns.length - 1)).toBe("4");
  });
  it("a whole-sheet single-value fill stays fast (one pass, not 26,000 object copies)", () => {
    const t0 = Date.now();
    const { sheet: out } = applyClip(createSheet(), one, { r1: 0, r2: 999, c1: 0, c2: 25 });
    expect(rawAt(out, 999, 25)).toBe("9");
    expect(Date.now() - t0).toBeLessThan(1500);
  });
});

describe("hidden rows and columns are skipped when copying (Excel copies visible cells only)", () => {
  it("manual hide (Ctrl+9)", () => {
    let s = put(put(put(createSheet(), 0, 0, "a"), 1, 0, "b"), 2, 0, "c");
    s = setRowsHidden(s, 1, 1, true);
    const clip = buildClip(s, sel(0, 0, 2, 0));
    expect(clipToText(clip, show(s))).toBe("a\nc");
    expect(clip.srcRows).toEqual([0, 2]);
  });
  it("filter-hidden rows (a Set from the AutoFilter) and hidden columns", () => {
    let s = put(put(put(createSheet(), 0, 0, "a"), 0, 1, "b"), 0, 2, "c");
    s = setColumnsHidden(s, 1, 1, true);
    expect(clipToText(buildClip(s, sel(0, 0, 0, 2)), show(s))).toBe("a\tc");
    let t = put(put(createSheet(), 0, 0, "x"), 1, 0, "y");
    expect(clipToText(buildClip(t, sel(0, 0, 1, 0), { hiddenRows: new Set([0]) }), show(t))).toBe("y");
  });
  it("a copy whose formulas sit past a hidden row still relocates from their TRUE source row", () => {
    let s = put(put(put(createSheet(), 0, 0, "1"), 1, 0, "hidden"), 2, 0, "=A1+1");
    s = setRowsHidden(s, 1, 1, true);
    const clip = buildClip(s, sel(0, 0, 2, 0));
    const { sheet: out } = applyClip(createSheet(), clip, sel(10, 0));
    expect(rawAt(out, 11, 0)).toBe("=A10+1"); // moved from row 3 to row 12 = +9 rows (A1 -> A10), measured from the TRUE source row
  });
});

describe("cut = MOVE (pasteMoveSameSheet)", () => {
  function wbWith(sheet) { return { ...createWorkbook(), sheets: [{ id: "s1", name: "Sheet1", sheet }], activeSheetId: "s1" }; }
  it("empties the source (contents AND formatting), writes the block, and re-points formulas that referred into it", () => {
    let s = put(createSheet(), 0, 0, "5");              // A1 (the cut cell)
    s = setCellStyle(s, 0, 0, 0, 0, { bold: true });
    s = put(s, 0, 1, "=A1*10");                         // B1 reads A1
    s = put(s, 5, 3, "=SUM(A1:A1)+A1");                 // D6 reads A1 twice
    const clip = buildClip(s, sel(0, 0));
    const { workbook, dest } = pasteMoveSameSheet(wbWith(s), "s1", clip, { sheetId: "s1", rect: sel(0, 0) }, sel(9, 0));
    const out = workbook.sheets[0].sheet;
    expect(dest).toEqual({ r1: 9, r2: 9, c1: 0, c2: 0 });
    expect(rawAt(out, 0, 0)).toBe("");
    expect(styleAt(out, 0, 0).bold).toBeUndefined();
    expect(rawAt(out, 9, 0)).toBe("5");
    expect(styleAt(out, 9, 0).bold).toBe(true);
    expect(rawAt(out, 0, 1)).toBe("=A10*10");
    expect(rawAt(out, 5, 3)).toBe("=SUM(A10:A10)+A10");
    expect(show(out)(0, 1)).toBe("50");
  });
  it("a moved formula keeps pointing where it pointed (references OUTSIDE the block do not shift)", () => {
    let s = put(createSheet(), 0, 0, "7"); s = put(s, 3, 3, "=A1+1");
    const clip = buildClip(s, sel(3, 3));
    const { workbook } = pasteMoveSameSheet(wbWith(s), "s1", clip, { sheetId: "s1", rect: sel(3, 3) }, sel(8, 5));
    expect(rawAt(workbook.sheets[0].sheet, 8, 5)).toBe("=A1+1");
  });
  it("references that point at only PART of a moved range stay put; whole-range references follow", () => {
    let s = put(put(createSheet(), 0, 0, "1"), 1, 0, "2");
    s = put(s, 0, 2, "=SUM(A1:A2)"); s = put(s, 1, 2, "=SUM(A1:A3)");
    const clip = buildClip(s, sel(0, 0, 1, 0));
    const { workbook } = pasteMoveSameSheet(wbWith(s), "s1", clip, { sheetId: "s1", rect: sel(0, 0, 1, 0) }, sel(0, 4));
    const out = workbook.sheets[0].sheet;
    expect(rawAt(out, 0, 2)).toBe("=SUM(E1:E2)");
    expect(rawAt(out, 1, 2)).toBe("=SUM(A1:A3)");
  });
  it("another sheet's formulas that qualify the moved sheet follow too", () => {
    let wb = wbWith(put(createSheet(), 0, 0, "3"));
    wb = { ...wb, sheets: [...wb.sheets, { id: "s2", name: "Other", sheet: put(createSheet(), 0, 0, "=Sheet1!A1+1") }] };
    const clip = buildClip(wb.sheets[0].sheet, sel(0, 0));
    const { workbook } = pasteMoveSameSheet(wb, "s1", clip, { sheetId: "s1", rect: sel(0, 0) }, sel(4, 1));
    expect(rawAt(workbook.sheets[1].sheet, 0, 0)).toBe("=Sheet1!B5+1");
  });
});

describe("small readers", () => {
  it("msoFormatToToken", () => {
    expect(msoFormatToToken("Percent")).toBe("0.00%");
    expect(msoFormatToToken('"Short Date"')).toBe("mm/dd/yyyy");
    expect(msoFormatToToken("General")).toBeNull();
    expect(msoFormatToToken('"\\0022$\\0022\\#\\,\\#\\#0\\.00"')).toBe('"$"#,##0.00');
    expect(msoFormatToToken("@")).toBeNull();
  });
  it("cssColorToHex ignores the theme-fighting defaults", () => {
    expect(cssColorToHex("#C00")).toBe("#cc0000");
    expect(cssColorToHex("rgb(255, 0, 0)")).toBe("#ff0000");
    expect(cssColorToHex("black")).toBeNull();
    expect(cssColorToHex("windowtext")).toBeNull();
    expect(cssColorToHex("white", { forFill: true })).toBeNull();
    expect(cssColorToHex("yellow", { forFill: true })).toBe("#ffff00");
  });
  it("clipFromHtml survives junk: no table, empty table, nested table, unclosed tags", () => {
    expect(clipFromHtml("<div>x</div>")).toBeNull();
    expect(clipFromHtml("<table></table>")).toBeNull();
    const nested = clipFromHtml("<table><tr><td>a<table><tr><td>inner</td></tr></table></td><td>b</td></tr></table>");
    expect(nested.cells[0].map((x) => x.raw)[1]).toBe("b");
    expect(clipFromHtml("<table><tr><td>one<td>two<tr><td>three").cells.map((r) => r.map((x) => x.raw))).toEqual([["one", "two"], ["three", ""]]);
  });
});
