/* notesOfficeLists — NEW-1 / NEW-2 (owner report 2026-10-30): a Word / OneNote outline pasted into a Notes box.
 * The PURE halves, node-only (this repo's unit runner has no DOM): the Word list-markup parsers, the outline planner
 * that nests items by level and decides which bullet a table sits under, the tab-row splitter, and the guard that
 * keeps a Word list's `text/plain` ("1.<tab>Entitlements") from being read as a two-column TABLE. The whole pipeline
 * against the committed fixtures in a real browser is ui-audit/verify-notes-list-paste.mjs (19 of 38 red on main).
 * Each describe names the defect it pins. */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  lengthIn, parseMsoList, classifyMarker, listFormatMap, planOutline, splitTabRow, tabRuns, isBlankText,
} from "../src/workspaces/notes/lib/notesOfficeLists.js";
import { isMarkerColumn, tabularFromClipboard, parseTabular } from "../src/workspaces/notes/lib/notesTablePaste.js";

const dt = (map) => ({ getData: (k) => map[k] || "" });
const item = (level, text, extra = {}) => ({ t: "item", id: "l0", level, kind: "bullet", start: null, left: 0.5 * level, text, ...extra });

describe("Word's list markup — what the clipboard actually says", () => {
  it("reads the level and list id out of mso-list, and the marker span as 'ignore'", () => {
    expect(parseMsoList("margin-left:1.0in;text-indent:-.25in;mso-list:l0 level2 lfo1")).toEqual({ id: "l0", level: 2 });
    expect(parseMsoList("mso-list:Ignore")).toBe("ignore");
    expect(parseMsoList("mso-list:none")).toBe(null);
    expect(parseMsoList("margin:0in")).toBe(null);
  });
  it("reads lengths in any CSS unit as inches", () => {
    expect(lengthIn("margin-left:1.5in;x:y", "margin-left")).toBeCloseTo(1.5);
    expect(lengthIn("text-indent:-.25in", "text-indent")).toBeCloseTo(-0.25);
    expect(lengthIn("margin-left:72pt", "margin-left")).toBeCloseTo(1);
    expect(lengthIn("margin-left:96px", "margin-left")).toBeCloseTo(1);
    expect(lengthIn("padding-left:1in", "margin-left")).toBe(null);
  });
  it("tells a bullet glyph from a number: Symbol ·, Courier o, Wingdings §, private-use squares are bullets", () => {
    for (const g of ["·", "o", "§", "", "", "", "□", "▪", "•"]) expect(classifyMarker(`${g}   `).kind, g).toBe("bullet");
  });
  it("tells numbering: 1. / (2) / a. / iv. are ordered, and a plain number other than 1 is the start", () => {
    expect(classifyMarker("1.")).toEqual({ kind: "ordered", start: 1 });
    expect(classifyMarker("4.  ")).toEqual({ kind: "ordered", start: 4 });
    expect(classifyMarker("(2)")).toEqual({ kind: "ordered", start: 2 });
    for (const m of ["a.", "b)", "i.", "iv.", "ii."]) expect(classifyMarker(m).kind, m).toBe("ordered");
  });
  it("a bare 'o' is Courier New's bullet, never the letter", () => {
    expect(classifyMarker("o").kind).toBe("bullet");
  });
  it("@list definitions say which levels are bullets; a level with no number-format is decimal", () => {
    const css = `@list l0:level1 {mso-level-number-format:bullet;mso-level-text:\\F0B7;}
@list l1:level1 {mso-level-start-at:1;mso-level-text:"%1\\.";}
@list l1:level2 {mso-level-number-format:alpha-lower;}`;
    expect(listFormatMap(css)).toEqual({ "l0:1": "bullet", "l1:1": "decimal", "l1:2": "alpha-lower" });
  });
  it("blank means whitespace and non-breaking spaces only", () => {
    expect(isBlankText("   \n")).toBe(true);
    expect(isBlankText("a")).toBe(false);
  });
});

describe("planOutline — nesting by level (NEW-2: levels 2-4 used to come in flat with a literal glyph)", () => {
  const shape = (plan) => {
    const w = (n) => (n.t === "list" ? `[${n.items.map((i) => `${i.src}${i.kids.length ? `(${i.kids.map((k) => (k.t === "table" ? `T${k.src}` : w(k))).join(",")})` : ""}`).join(" ")}]` : n.t === "pass" ? `p${n.src}` : `?`);
    return plan.map(w).join(" ");
  };
  it("four levels nest one inside the next", () => {
    const plan = planOutline([item(1), item(2), item(3), item(4)]);
    expect(shape(plan)).toBe("[0([1([2([3])])])]");
  });
  it("coming back up closes the deeper lists and continues the shallower one", () => {
    expect(shape(planOutline([item(1), item(2), item(3), item(2), item(1)]))).toBe("[0([1([2]) 3]) 4]");
  });
  it("a blank paragraph between items does NOT break the nesting", () => {
    const plan = planOutline([item(1), item(2), { t: "blank" }, item(2), { t: "blank" }, item(1)]);
    expect(shape(plan)).toBe("[0([1 3]) 5]");
  });
  it("a real paragraph between items does end the list", () => {
    const plan = planOutline([item(1), { t: "other" }, item(1)]);
    expect(shape(plan)).toBe("[0] p1 [2]");
  });
  it("blanks that trail a list or sit before a paragraph are kept in place, not swallowed", () => {
    expect(shape(planOutline([item(1), { t: "blank" }, { t: "other" }]))).toBe("[0] p1 p2");
  });
  it("a jump straight to level 3 nests once, then level 2 closes it", () => {
    expect(shape(planOutline([item(1), item(3), item(2)]))).toBe("[0([1 2])]");
  });
  it("a different list id at the same level starts a new list (numbering restarts)", () => {
    const a = { ...item(1), kind: "ordered", id: "l1" };
    const b = { ...item(1), kind: "ordered", id: "l2" };
    expect(shape(planOutline([a, b]))).toBe("[0] [1]");
  });
  it("changing kind at a level (bullets then numbers) starts a new list", () => {
    expect(shape(planOutline([item(1), { ...item(1), kind: "ordered" }]))).toBe("[0] [1]");
  });
  it("an ordered list opened at 4 starts at 4; at 1 it needs no start", () => {
    const four = planOutline([{ ...item(1), kind: "ordered", start: 4 }])[0];
    const one = planOutline([{ ...item(1), kind: "ordered", start: 1 }])[0];
    expect(four.start).toBe(4);
    expect(one.start).toBe(null);
  });
});

describe("planOutline — a table lands under the bullet it sat under (NEW-1)", () => {
  const find = (plan, src) => {
    let hit = null;
    const w = (n, owner) => {
      if (n.t === "list") n.items.forEach((i) => { i.kids.forEach((k) => (k.t === "table" ? (k.src === src && (hit = i.src)) : w(k, i))); });
    };
    plan.forEach((n) => w(n, null));
    return hit;
  };
  it("a table indented to the level-3 text goes INSIDE that level-3 item", () => {
    const plan = planOutline([item(1), item(2), item(3), { t: "blank" }, { t: "table", left: 1.5 }, { t: "blank" }, item(4)]);
    expect(find(plan, 4)).toBe(2);
  });
  it("items after the table resume the list: the next deeper item is still nested under the same bullet", () => {
    const plan = planOutline([item(1), item(2), item(3), { t: "table", left: 1.5 }, item(4)]);
    const l3 = plan[0].items[0].kids[0].items[0].kids[0].items[0];
    expect(l3.kids.map((k) => k.t)).toEqual(["table", "list"]);
  });
  it("a table at the margin goes after the list, not into it", () => {
    const plan = planOutline([item(1), item(2), item(3), { t: "table", left: 0 }]);
    expect(find(plan, 3)).toBe(null);
    expect(plan[plan.length - 1]).toEqual({ t: "pass", src: 3 });
  });
  it("a table indented to level 2's text belongs to the level-2 item, not the deeper one", () => {
    const plan = planOutline([item(1), item(2), item(3), { t: "table", left: 1.0 }]);
    expect(find(plan, 3)).toBe(1);
  });
  it("a table with no known left edge is treated as at the margin", () => {
    expect(find(planOutline([item(1), { t: "table" }]), 1)).toBe(null);
  });
  it("closing: a table nested at level 2 ends level 3's list, so a following level-3 item opens a NEW nested list", () => {
    const plan = planOutline([item(1), item(2), item(3), { t: "table", left: 1.0 }, item(3)]);
    const l2 = plan[0].items[0].kids[0].items[0];
    expect(l2.kids.map((k) => k.t)).toEqual(["list", "table", "list"]);
  });
});

describe("tab-aligned rows read as a table (the 'cells run together by spaces' symptom)", () => {
  it("splits on tabs; needs a non-empty first cell and two non-empty cells", () => {
    expect(splitTabRow("SF\t$/SF")).toEqual(["SF", "$/SF"]);
    expect(splitTabRow("<100K\t1")).toEqual(["<100K", "1"]);
    expect(splitTabRow("\tindented line")).toBe(null);
    expect(splitTabRow("plain sentence")).toBe(null);
    expect(splitTabRow("only\t")).toBe(null);
  });
  it("two or more consecutive rows with the same column count are a run; a lone row or a ragged one is not", () => {
    const r = (...c) => c;
    expect(tabRuns([r("a", "b"), r("c", "d"), null, r("e", "f")])).toEqual([{ from: 0, to: 1, cols: 2 }]);
    expect(tabRuns([r("a", "b"), r("c", "d", "e")])).toEqual([]);
    expect(tabRuns([null, r("a", "b")])).toEqual([]);
  });
});

describe("a Word list's text/plain is a LIST, not a two-column table (it used to become one)", () => {
  const numbered = "1.\tEntitlements\r\na.\tZoning\r\ni.\tConfirm the district\r\n2.\tConstruction\r\n";
  const bulleted = "·\tSoft costs\r\no\tDesign and engineering\r\n§\tFee by building size\r\n";
  it("parses as a grid (that is the trap) …", () => {
    expect(parseTabular(numbered)).not.toBe(null);
  });
  it("… but a grid whose first column is all list markers is a list", () => {
    expect(isMarkerColumn(parseTabular(numbered))).toBe(true);
    expect(isMarkerColumn(parseTabular(bulleted))).toBe(true);
    expect(tabularFromClipboard(dt({ "text/plain": numbered }), { ignoreHtml: true })).toBe(null);
    expect(tabularFromClipboard(dt({ "text/plain": bulleted }), { ignoreHtml: true })).toBe(null);
  });
  it("a real spreadsheet range still becomes a table: Excel's first column is data, not markers", () => {
    const excel = "Unit\tArea\r\nA-100\t12,500\r\nB-300\t8,200\r\n";
    expect(tabularFromClipboard(dt({ "text/plain": excel }), { ignoreHtml: true })).toEqual([["Unit", "Area"], ["A-100", "12,500"], ["B-300", "8,200"]]);
  });
  it("the owner's pricing rows are data, not markers ('<100K', '100K - 250K')", () => {
    const rows = "SF\t$/SF\r\n<100K\t1\r\n100K - 250K\t.60-.75\r\n";
    expect(isMarkerColumn(parseTabular(rows))).toBe(false);
  });
  it("bare numbers in a first column are DATA (Excel), only '1.' / 'a)' style markers read as a list", () => {
    expect(isMarkerColumn([["1", "x"], ["2", "y"]])).toBe(false);
    expect(isMarkerColumn([["1.", "x"], ["2.", "y"]])).toBe(true);
  });
});

describe("the wiring stays in place", () => {
  const src = fs.readFileSync(path.resolve(__dirname, "../src/workspaces/notes/lib/notesPastePlain.js"), "utf8");
  it("the Office conversion runs BEFORE the source-table read, so the tables it reports are the ones the editor holds", () => {
    expect(src.indexOf("convertOfficeLists(d.body)")).toBeGreaterThan(0);
    expect(src.indexOf("convertOfficeLists(d.body)")).toBeLessThan(src.indexOf("readSourceTables(doc2.body"));
  });
  it("a conversion that throws falls back to the unconverted paste, never to no paste", () => {
    expect(src).toMatch(/try \{ doc2 = prepare\(true\); \} catch \(_\) \{ doc2 = prepare\(false\); \}/);
  });
  it("the text-grid fallback stands down when the html already gave a list", () => {
    expect(src).toMatch(/!sliceHasTable\(slice\) && !sliceHasList\(slice\)/);
  });
  it("the table safety net reports a structure-only skeleton (tag/class/property NAMES), not the person's text", () => {
    expect(src).toMatch(/notes-paste-table-rescued/);
    expect(src).not.toMatch(/skeleton:\s*[a-z.]*textContent/);
  });
});
