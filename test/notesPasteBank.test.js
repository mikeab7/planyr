/* notesPasteBank — THE UNIT HALF OF THE NOTES CLIPBOARD REGRESSION BANK (NEW-1, 2026-11-05).
 *
 * The bank itself (ui-audit/lib/pasteBank.mjs + test/fixtures/clipboard-bank/bank.json) is driven through the REAL paste event in
 * a real editor by ui-audit/verify-notes-paste-bank.mjs, a required step of the `build` check (.github/ci-gates.yml). This file is
 * what keeps that harness honest from inside `npm test`, which runs with no browser:
 *   · COMPLETENESS — a clipboard fixture committed to any of the three fixture directories without a structural expectation fails
 *     here, so the bank cannot quietly stop covering a clipboard;
 *   · TEETH — the judge is run on hand-built documents: a correct paste passes, and each defect the bank exists to catch (a
 *     fill, a merge, an empty cell holding a space, a lost mark or colour, a bullet left as a "·" paragraph) is REJECTED. A judge
 *     that cannot fail would make the harness a permanent green;
 *   · THE WIRING — the harness is still listed in the build's gate list.
 * The two pure helpers the fix added are tested here too (their DOM halves run in the harness). */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { loadBank, unregisteredFixtures, summariseDoc, checkEntry, checkOptionFills, normColor, BANK_DIRS } from "../ui-audit/lib/pasteBank.mjs";
import { marksByClass } from "../src/workspaces/notes/lib/notesOfficeStyle.js";
import { fillFromDeclarations } from "../src/workspaces/notes/lib/notesTablePaste.js";

const bank = loadBank();
const byId = (id) => bank.find((b) => b.id === id);

const t = (text, marks) => ({ type: "text", text, ...(marks ? { marks } : {}) });
const p = (...c) => ({ type: "paragraph", content: c });
const cell = (content, attrs = {}) => ({ type: "tableCell", attrs: { colspan: 1, rowspan: 1, colwidth: null, background: null, ...attrs }, content: [p(...content)] });
const row = (...cells) => ({ type: "tableRow", content: cells });
const doc = (...c) => ({ type: "doc", content: [{ type: "noteAnchor", attrs: { x: 40, y: 40, w: 460, h: null, aid: "b1" }, content: c }] });
const table = (...rows) => ({ type: "table", content: rows });

describe("the bank is complete", () => {
  it("every clipboard fixture committed to the three directories has a structural expectation", () => {
    expect(unregisteredFixtures(bank)).toEqual([]);
  });
  it("it draws from all three directories and carries the spike's four losses + the Word lists + the Excel mixed table", () => {
    for (const d of BANK_DIRS) expect(bank.some((b) => b.dir === d), d).toBe(true);
    for (const id of ["spike-bgcolor-attr", "spike-font-color", "spike-excel-nbsp-cell", "spike-word-o-p-cell", "spike-word-bullets", "excel-mixed-cells"]) {
      expect(byId(`clipboard-bank/${id}`), id).toBeTruthy();
    }
  });
  it("every entry has its html and a non-vacuous expectation", () => {
    for (const b of bank) {
      expect(b.html && b.html.length > 50, `${b.id} html`).toBe(true);
      const e = b.expect || {};
      expect(Boolean(e.outline || e.tables || e.runs || e.plainText != null), `${b.id} expects something`).toBe(true);
    }
  });
  it("the manifests' expectations are structural: merged spans, empty cells and column counts are derived, not just text", () => {
    const wide = byId("clipboard-tables/excel-wide-merged").expect.tables[0];
    expect(wide.merges.length).toBeGreaterThan(0);
    expect(wide.cols).toBeGreaterThan(wide.text[0].length - 1);
    expect(byId("clipboard-tables/onenote-desktop").expect.tables[0].empty.length).toBeGreaterThan(0);
  });
  it("the harness is listed in the build's gate list", () => {
    const gates = fs.readFileSync(path.resolve(__dirname, "../.github/ci-gates.yml"), "utf8");
    expect(gates).toContain("ui-audit/verify-notes-paste-bank.mjs");
  });
});

describe("the judge can fail — an empty document fails every fixture that owes structure", () => {
  const empty = summariseDoc({ type: "doc", content: [{ type: "paragraph" }] });
  it("rejects an empty page for all fixtures", () => {
    for (const b of bank) expect(checkEntry(b, empty).length, b.id).toBeGreaterThan(0);
  });
});

describe("the judge on hand-built documents", () => {
  const nbsp = byId("clipboard-bank/spike-excel-nbsp-cell");
  const goodNbsp = () => doc(table(row(cell([t("Left")]), cell([]), cell([t("Right")])), row(cell([t("Under")]), cell([]), cell([t("Also")]))));

  it("passes the correct result for an Excel &nbsp; cell", () => {
    expect(checkEntry(nbsp, summariseDoc(goodNbsp()))).toEqual([]);
  });
  it("rejects an empty cell that arrived holding a space (spike loss 3)", () => {
    const bad = doc(table(row(cell([t("Left")]), cell([t(" ")]), cell([t("Right")])), row(cell([t("Under")]), cell([]), cell([t("Also")]))));
    expect(checkEntry(nbsp, summariseDoc(bad)).join("\n")).toMatch(/should be EMPTY/);
  });
  it("rejects a lost column and a lost row", () => {
    const short = doc(table(row(cell([t("Left")]), cell([t("Right")])), row(cell([t("Under")]), cell([t("Also")]))));
    expect(checkEntry(nbsp, summariseDoc(short)).join("\n")).toMatch(/2 columns, wanted 3/);
    const oneRow = doc(table(row(cell([t("Left")]), cell([]), cell([t("Right")]))));
    expect(checkEntry(nbsp, summariseDoc(oneRow)).join("\n")).toMatch(/1 rows, wanted 2/);
  });

  const mixed = byId("clipboard-bank/excel-mixed-cells");
  const bold = [{ type: "bold" }];
  const red = [{ type: "textStyle", attrs: { color: "#C00000" } }];
  const goodMixed = (over = {}) => doc(table(
    row(cell([t("Header AB", over.noBold ? undefined : bold)], { colspan: over.noMerge ? 1 : 2 }), cell([t("Header C", bold)])),
    row(cell([t("Filled")]), cell([]), cell([t("Red text", over.noColor ? undefined : red)])),
    row(cell([t("Bold cell", bold)]), cell([t("Plain")]), cell([t("12,500")])),
  ));
  it("passes the correct Excel result: merge, empty cell, bold, red text, and NO imported shading", () => {
    expect(checkEntry(mixed, summariseDoc(goodMixed()))).toEqual([]);
  });
  it("rejects a lost merge, a lost bold, a lost text colour", () => {
    expect(checkEntry(mixed, summariseDoc(goodMixed({ noMerge: true }))).join("\n")).toMatch(/spans 1×1, wanted 2×1|merged cell/);
    expect(checkEntry(mixed, summariseDoc(goodMixed({ noBold: true }))).join("\n")).toMatch(/lost its bold/);
    expect(checkEntry(mixed, summariseDoc(goodMixed({ noColor: true }))).join("\n")).toMatch(/text colour is null, wanted #c00000/);
  });
  it("rejects imported shading on a plain paste — the decided behaviour — and judges the option separately", () => {
    const shaded = goodMixed();
    shaded.content[0].content[0].content[0].content[0].attrs.background = "#dbe5f1";
    expect(checkEntry(mixed, summariseDoc(shaded)).join("\n")).toMatch(/imports no foreign shading/);
    // …and after "Values and Source Formatting" the fills are owed
    expect(checkOptionFills(mixed, summariseDoc(goodMixed())).join("\n")).toMatch(/fill is null, wanted #dbe5f1/);
    const after = goodMixed();
    after.content[0].content[0].content[0].content[0].attrs.background = "#dbe5f1";
    after.content[0].content[0].content[1].content[0].attrs.background = "#ffff00";
    expect(checkOptionFills(mixed, summariseDoc(after))).toEqual([]);
  });

  it("judges colour and typeface on a run (spike loss 2: <font color face>)", () => {
    const fc = byId("clipboard-bank/spike-font-color");
    const good = { type: "doc", content: [p(t("Red words", [{ type: "textStyle", attrs: { color: "#c00000" } }]), t(" and "), t("blue Arial words", [{ type: "textStyle", attrs: { color: "rgb(0, 112, 192)", fontFamily: "Arial" } }]), t(" and plain."))] };
    expect(checkEntry(fc, summariseDoc(good))).toEqual([]);
    const bad = { type: "doc", content: [p(t("Red words and blue Arial words and plain."))] };
    expect(checkEntry(fc, summariseDoc(bad)).join("\n")).toMatch(/Red words" colour is none/);
  });

  it("judges list nodes (spike loss 4: Word bullets as '·' paragraphs)", () => {
    const wb = byId("clipboard-bank/spike-word-bullets");
    const li = (s) => ({ type: "listItem", content: [p(t(s))] });
    const good = doc({ type: "bulletList", content: [li("First bullet"), li("Second bullet")] }, p(t("Between the lists")), { type: "orderedList", attrs: { start: 1 }, content: [li("Step one"), li("Step two")] });
    expect(checkEntry(wb, summariseDoc(good))).toEqual([]);
    const glyphs = doc(p(t("·        First bullet")), p(t("·        Second bullet")), p(t("Between the lists")), { type: "orderedList", attrs: { start: 1 }, content: [li("Step one"), li("Step two")] });
    const problems = checkEntry(wb, summariseDoc(glyphs)).join("\n");
    expect(problems).toMatch(/outline differs/);
    expect(problems).toMatch(/bullet glyph was left/);
  });

  it("reads rowspan/colspan into logical columns and normalises colours", () => {
    const s = summariseDoc(doc(table(row(cell([t("a")], { rowspan: 2 }), cell([t("b")])), row(cell([t("c")])))));
    const cells = s.tables[0].cells;
    expect(cells.find((x) => x.text === "c")).toMatchObject({ r: 1, c: 1 });
    expect(normColor("rgb(192, 0, 0)")).toBe("#c00000");
    expect(normColor("#C00")).toBe("#cc0000");
    expect(normColor("yellow")).toBe("#ffff00");
  });
});

describe("the two helpers the bank's red run produced", () => {
  it("marksByClass reads only mark-bearing declarations from a class rule — never the fonts Excel repeats on every cell", () => {
    const css = `<!--table {mso-displayed-decimal-separator:"\\.";}
      .xl65 {mso-style-parent:style0;font-weight:700;color:black;font-size:11.0pt;font-family:Calibri, sans-serif;border:.5pt solid black;background:#DBE5F1;}
      .xl66 {font-weight:400;color:black;font-family:Calibri;}
      .xl68 {color:#C00000;font-style:italic;text-decoration:underline line-through;}
      td.xl69 {font-weight:bold;}-->`;
    const m = marksByClass(css);
    expect(m.xl65).toEqual({ bold: true, color: null });          // bold kept; black ink and the font declarations ignored
    expect(m.xl66).toBeUndefined();                               // nothing that becomes a mark
    expect(m.xl68).toEqual({ italic: true, underline: true, strike: true, color: "#C00000" });
    expect(m.xl69).toEqual({ bold: true });
  });
  it("fillFromDeclarations reads the standard colour names Excel writes (`background:yellow`) — a named fill used to read as none", () => {
    expect(fillFromDeclarations("background:yellow;mso-pattern:black none")).toBe("#ffff00");
    expect(fillFromDeclarations("border:.5pt solid black;background:#DBE5F1;")).toBe("#dbe5f1");
    expect(fillFromDeclarations("background:white")).toBeNull();
    expect(fillFromDeclarations("background:none")).toBeNull();
    expect(fillFromDeclarations("color:red")).toBeNull();
  });
});
