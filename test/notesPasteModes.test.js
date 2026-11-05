/* notesPasteModes — the Office-style paste options (NEW-1, 2026-10-29), the PURE halves, driven against the real
 * Notes schema with no DOM (this repo's unit runner is node-only). The browser half — a real Excel paste, the
 * flyout, every option and its undo — is ui-audit/verify-notes-paste-options.mjs.
 *
 * What is pinned here: the SET each kind of paste offers, the letter keys (T means two things), "put the paste back to
 * base" being exact for any pair of documents, and each option's meaning on a table. */
import { describe, it, expect } from "vitest";
import { getSchema } from "@tiptap/core";
import { Node as PMNode } from "@tiptap/pm/model";
import { EditorState } from "@tiptap/pm/state";
import { NOTE_EXTENSIONS } from "../src/workspaces/notes/lib/notesExtensions.js";
import {
  PASTE_MODE_META, pasteSetFor, modesOfSet, modeForKey, analyzePaste, newTablePositions, revertToBase,
  applyPasteModeToTr, flattenCell, valuesTable, valuesFormatTable, formattingOnlyTable, withSourceFills, applyColumnWidths, transposeTable, fillAt,
} from "../src/workspaces/notes/lib/notesPasteModes.js";
import { cssLengthPx, fillsByClass, fillFromDeclarations } from "../src/workspaces/notes/lib/notesTablePaste.js";
import { PASTE_GLYPH_MODES } from "../src/workspaces/notes/components/PasteIcons.jsx";

const schema = getSchema(NOTE_EXTENSIONS);
const node = (json) => PMNode.fromJSON(schema, json);
const text = (t, marks) => ({ type: "text", text: t, ...(marks ? { marks } : {}) });
const p = (t, marks) => ({ type: "paragraph", content: t ? [text(t, marks)] : [] });
const cell = (t, attrs = {}, type = "tableCell") => ({ type, attrs: { colspan: 1, rowspan: 1, colwidth: null, ...attrs }, content: [typeof t === "string" ? p(t) : t] });
const row = (...cells) => ({ type: "tableRow", content: cells });
const table = (...rows) => ({ type: "table", attrs: {}, content: rows });
const doc = (...kids) => node({ type: "doc", content: kids });
const box = (...kids) => ({ type: "noteAnchor", attrs: { x: 10, y: 10, w: 400, aid: "b1" }, content: kids });

const grid3 = () => table(
  row(cell("Name", {}, "tableHeader"), cell("Qty", {}, "tableHeader"), cell("Cost", {}, "tableHeader")),
  row(cell("Dock"), cell("2"), cell("100")),
  row(cell("Door"), cell("4"), cell("250")),
);
const gridText = (t) => {
  const rows = [];
  t.forEach((r) => { const cells = []; r.forEach((c) => cells.push(c.textContent)); rows.push(cells); });
  return rows;
};
const tableOf = (d) => { let t = null; d.descendants((n) => { if (n.type.name === "table" && !t) t = n; return !t; }); return t; };
const tablePosOf = (d) => { let at = -1; d.descendants((n, pos) => { if (n.type.name === "table" && at < 0) at = pos; return at < 0; }); return at; };

describe("the two sets of options, and the letters that pick them", () => {
  it("a text paste offers Word's three; a table paste offers Excel's, grouped", () => {
    expect(modesOfSet(pasteSetFor({ kind: "text" }))).toEqual(["source", "merge", "text"]);
    const set = pasteSetFor({ kind: "table", meta: { tables: [{ widths: [100, 100] }] } });
    expect(set.map((g) => g.title)).toEqual(["Paste", "Paste Values", "Other Paste Options"]);
    expect(modesOfSet(set)).toEqual(["source", "merge", "widths", "transpose", "values", "valuesFormat", "formatting", "picture"]);
  });
  it("Keep Source Column Widths is offered only when the source's widths were captured", () => {
    expect(modesOfSet(pasteSetFor({ kind: "table", meta: { tables: [{ widths: [null, null] }] } }))).not.toContain("widths");
    expect(modesOfSet(pasteSetFor({ kind: "table", meta: { tables: [] } }))).not.toContain("widths");
  });
  it("a grid pasted into existing cells cannot transpose or become a picture; a table that grew keeps only K and M", () => {
    expect(modesOfSet(pasteSetFor({ kind: "cells" }))).toEqual(["source", "merge", "values", "valuesFormat", "formatting"]);
    expect(modesOfSet(pasteSetFor({ kind: "grown" }))).toEqual(["source", "merge"]);
  });
  it("T is Keep Text Only in the text set and Transpose in the table set — the set on screen decides", () => {
    expect(modeForKey(pasteSetFor({ kind: "text" }), "t")).toBe("text");
    expect(modeForKey(pasteSetFor({ kind: "table", meta: {} }), "T")).toBe("transpose");
    expect(modeForKey(pasteSetFor({ kind: "table", meta: {} }), "v")).toBe("values");
    expect(modeForKey(pasteSetFor({ kind: "table", meta: {} }), "e")).toBe("valuesFormat");
    expect(modeForKey(pasteSetFor({ kind: "text" }), "v")).toBeNull();
  });
  it("every option has Word's or Excel's exact name and a drawing", () => {
    expect(Object.fromEntries(Object.entries(PASTE_MODE_META).map(([k, v]) => [k, `${v.label} (${v.key})`]))).toEqual({
      source: "Keep Source Formatting (K)", merge: "Merge Formatting (M)", text: "Keep Text Only (T)",
      widths: "Keep Source Column Widths (W)", transpose: "Transpose (T)", values: "Values (V)",
      valuesFormat: "Values and Source Formatting (E)", formatting: "Formatting only (R)", picture: "Picture (U)",
    });
    for (const mode of Object.keys(PASTE_MODE_META)) expect(PASTE_GLYPH_MODES, `no drawing for ${mode}`).toContain(mode);
  });
});

describe("what did the paste land?", () => {
  it("a new table is found by identity, not position", () => {
    const pre = doc(box(p("Intro")), p(""));
    const post = doc(box(p("Intro"), grid3()), p(""));
    const found = newTablePositions(pre, post);
    expect(found).toHaveLength(1);
    expect(post.nodeAt(found[0]).type.name).toBe("table");
    expect(analyzePaste({ preDoc: pre, postDoc: post, sliceHadTable: true })).toMatchObject({ kind: "table" });
  });
  it("a plain-text paste is text even when the caret sat in a table", () => {
    const pre = doc(box(grid3()), p(""));
    expect(analyzePaste({ preDoc: pre, postDoc: pre, preTablePos: 1, sliceHadTable: false }).kind).toBe("text");
  });
  it("a grid pasted over existing cells is `cells`, naming exactly the cells that changed", () => {
    const pre = doc(box(grid3()), p(""));
    const tpos = tablePosOf(pre);
    const edited = mapCell(pre, tpos, 1, 1, "99");
    const found = analyzePaste({ preDoc: pre, postDoc: edited, preTablePos: tpos, sliceHadTable: true });
    expect(found.kind).toBe("cells");
    expect(found.cells).toHaveLength(1);
    expect(found.cells[0]).toMatchObject({ row: 1, col: 1 });
    expect(edited.nodeAt(found.cells[0].pos).textContent).toBe("99");
  });
  it("a table that gained a row is `grown`", () => {
    const pre = doc(box(table(row(cell("a"), cell("b")))), p(""));
    const post = doc(box(table(row(cell("a"), cell("b")), row(cell("c"), cell("d")))), p(""));
    expect(analyzePaste({ preDoc: pre, postDoc: post, preTablePos: tablePosOf(pre), sliceHadTable: true }).kind).toBe("grown");
  });
});

function mapCell(d, tpos, r, c, newText) {
  const state = EditorState.create({ doc: d });
  const t = d.nodeAt(tpos);
  let pos = tpos + 1;
  for (let i = 0; i < r; i += 1) pos += t.child(i).nodeSize;
  pos += 1;
  for (let i = 0; i < c; i += 1) pos += t.child(r).child(i).nodeSize;
  const target = d.nodeAt(pos);
  const tr = state.tr.replaceWith(pos, pos + target.nodeSize, target.type.create(target.attrs, schema.nodes.paragraph.create(null, schema.text(newText))));
  return tr.doc;
}

describe("putting the paste back to base is exact, for any two documents", () => {
  const states = [
    doc(box(p("one")), p("")),
    doc(box(p("one"), grid3()), p("")),
    doc(box(p("one two")), box(p("one two")), p("")),
    doc(box(grid3()), box(p("same")), p("")),
    doc(p("lonely")),
    doc(box(p("aaa")), box(p("aaa")), box(p("aaa")), p("")),
  ];
  it("reverting any state to any other yields the other, byte for byte", () => {
    for (const from of states) for (const to of states) {
      const tr = EditorState.create({ doc: from }).tr;
      revertToBase(tr, to);
      expect(tr.doc.eq(to), `${JSON.stringify(from.toJSON()).slice(0, 80)} → ${JSON.stringify(to.toJSON()).slice(0, 80)}`).toBe(true);
    }
  });
  it("reverting a document to itself changes nothing and adds no step", () => {
    const tr = EditorState.create({ doc: states[1] }).tr;
    expect(revertToBase(tr, states[1])).toBe(false);
    expect(tr.steps).toHaveLength(0);
  });
});

describe("each option's meaning on a table", () => {
  const styled = () => table(
    row(cell({ type: "paragraph", content: [text("Head", [{ type: "bold" }])] }, {}, "tableHeader"), cell("B", { background: null }, "tableHeader")),
    row(cell({ type: "paragraph", content: [text("site", [{ type: "link", attrs: { href: "https://example.com" } }, { type: "italic" }])] }), cell("x")),
  );

  it("Values: text only — marks, links and fills gone, grid and header cells kept", () => {
    const t = valuesTable(node(styled()), schema);
    expect(gridText(t)).toEqual([["Head", "B"], ["site", "x"]]);
    expect(JSON.stringify(t.toJSON())).not.toMatch(/"marks"/);
    expect(t.child(0).child(0).type.name).toBe("tableHeader");
  });
  it("Values and Source Formatting: styling kept, links dropped, the source's fill applied", () => {
    const fills = [["#ffff00", null], [null, "#ccffcc"]];
    const t = valuesFormatTable(node(styled()), schema, fills);
    const json = JSON.stringify(t.toJSON());
    expect(json).toContain('"bold"');
    expect(json).toContain('"italic"');
    expect(json).not.toContain('"link"');
    expect(t.child(0).child(0).attrs.background).toBe("#ffff00");
    expect(t.child(1).child(1).attrs.background).toBe("#ccffcc");
    expect(t.child(0).child(1).attrs.background).toBeNull();
  });
  it("the Picture shows the source's shading but changes nothing else about the table", () => {
    const t = withSourceFills(node(styled()), [["#ffff00", null], [null, "#ccffcc"]]);
    expect(t.child(0).child(0).attrs.background).toBe("#ffff00");
    expect(t.child(1).child(1).attrs.background).toBe("#ccffcc");
    expect(gridText(t)).toEqual(gridText(node(styled())));
    expect(JSON.stringify(t.child(1).child(0).toJSON())).toContain('"italic"');   // marks and links stay: the picture shows them
  });
  it("a source with a different number of rows than the table gives no fills rather than shifting them", () => {
    expect(fillAt([["#ff0000"]], 2, 0, 0)).toBeNull();
    expect(fillAt([["#ff0000"], [null]], 2, 0, 0)).toBe("#ff0000");
  });
  it("Formatting only on a new table: the grid and the look, no text", () => {
    const t = formattingOnlyTable(node(styled()), schema, [["#ffff00", null], [null, null]]);
    expect(gridText(t)).toEqual([["", ""], ["", ""]]);
    expect(t.child(0).child(0).attrs.background).toBe("#ffff00");
    expect(t.child(0).child(0).type.name).toBe("tableHeader");
  });
  it("flattenCell turns nested blocks into plain paragraphs and drops pictures", () => {
    const c = node(cell({ type: "bulletList", content: [{ type: "listItem", content: [p("a")] }, { type: "listItem", content: [p("b")] }] }));
    const frag = flattenCell(c, schema);
    expect(frag.childCount).toBe(2);
    expect(frag.child(0).type.name).toBe("paragraph");
    expect(frag.textBetween(0, frag.size, "|")).toBe("a|b");
  });
  it("Keep Source Column Widths: stamps the source's widths, raised to the floor, spanning cells get one per column", () => {
    const t = applyColumnWidths(node(grid3()), [64, 200, 150]);
    expect(t.child(0).child(0).attrs.colwidth).toEqual([100]);          // 64 → the table floor
    expect(t.child(0).child(1).attrs.colwidth).toEqual([200]);
    expect(t.child(2).child(2).attrs.colwidth).toEqual([150]);
    const merged = node(table(row(cell("m", { colspan: 2 }), cell("z")), row(cell("a"), cell("b"), cell("c"))));
    const w = applyColumnWidths(merged, [120, 130, 140]);
    expect(w.child(0).child(0).attrs.colwidth).toEqual([120, 130]);
    expect(w.child(0).child(1).attrs.colwidth).toEqual([140]);
  });
  it("Keep Source Column Widths leaves a column the source gave no width unstamped", () => {
    const t = applyColumnWidths(node(grid3()), [null, 200, null]);
    expect(t.child(1).child(0).attrs.colwidth).toBeNull();
    expect(t.child(1).child(1).attrs.colwidth).toEqual([200]);
  });
  it("Transpose: rows become columns, a header row becomes a header column, twice is the identity", () => {
    const t = node(grid3());
    const tt = transposeTable(t);
    expect(gridText(tt)).toEqual([["Name", "Dock", "Door"], ["Qty", "2", "4"], ["Cost", "100", "250"]]);
    expect(tt.child(0).child(0).type.name).toBe("tableHeader");
    expect(tt.child(1).child(0).type.name).toBe("tableHeader");
    expect(tt.child(0).child(1).type.name).toBe("tableCell");
    expect(gridText(transposeTable(tt))).toEqual(gridText(t));
  });
  it("Transpose swaps a merged cell's spans and keeps every cell", () => {
    const t = node(table(
      row(cell("wide", { colspan: 2 }), cell("c")),
      row(cell("a"), cell("b"), cell("d")),
    ));
    const tt = transposeTable(t);
    expect(tt.childCount).toBe(3);                                       // 3 columns became 3 rows
    const first = tt.child(0).child(0);
    expect(first.textContent).toBe("wide");
    expect(first.attrs.rowspan).toBe(2);
    expect(first.attrs.colspan).toBe(1);
    const count = (n) => { let c = 0; n.forEach((r) => r.forEach(() => { c += 1; })); return c; };
    expect(count(tt)).toBe(count(t));
  });
});

describe("applyPasteModeToTr — one transaction, from base, every time", () => {
  const base = doc(box(p("intro"), grid3()), p(""));
  const tpos = tablePosOf(base);
  const offer = (over = {}) => ({
    from: tpos, to: tpos + tableOf(base).nodeSize, baseDoc: base, kind: "table", tables: [{ pos: tpos }], cells: [],
    meta: { tables: [{ widths: [120, 140, 160], fills: [[null, null, null], ["#ffff00", null, null], [null, null, null]] }] }, ...over,
  });
  const run = (mode, from = base, o = offer()) => {
    const tr = EditorState.create({ doc: from }).tr;
    const r = applyPasteModeToTr(tr, mode, o);
    return { tr, r };
  };

  it("each table option leaves the rest of the document alone", () => {
    for (const mode of ["widths", "transpose", "values", "valuesFormat", "formatting"]) {
      const { tr, r } = run(mode);
      expect(r.ok, mode).toBe(true);
      expect(tr.doc.firstChild.firstChild.textContent, mode).toBe("intro");     // the paragraph above the table
      expect(tr.doc.childCount, mode).toBe(base.childCount);
    }
  });
  it("Transpose then Keep Source Formatting returns EXACTLY the pasted document", () => {
    const first = run("transpose");
    expect(first.tr.doc.eq(base)).toBe(false);
    const again = run("source", first.tr.doc);
    expect(again.r.ok).toBe(true);
    expect(again.tr.doc.eq(base)).toBe(true);
  });
  it("picking from an already-transformed document does not compound: Values then Transpose = Transpose of the original", () => {
    const viaValues = run("transpose", run("values").tr.doc);
    const direct = run("transpose");
    expect(viaValues.tr.doc.eq(direct.tr.doc)).toBe(true);
  });
  it("W stamps the captured widths onto the pasted table", () => {
    const { tr } = run("widths");
    expect(tableOf(tr.doc).child(0).child(1).attrs.colwidth).toEqual([140]);
  });
  it("E applies the captured fill; V clears it", () => {
    expect(tableOf(run("valuesFormat").tr.doc).child(1).child(0).attrs.background).toBe("#ffff00");
    expect(tableOf(run("values").tr.doc).child(1).child(0).attrs.background).toBeNull();
  });
  it("Merge removes appearance marks over the paste and keeps meaning", () => {
    const styledBase = doc(box(p("keep", [{ type: "bold" }, { type: "textStyle", attrs: { color: "#ff0000", fontSize: "20px" } }])), p(""));
    const tr = EditorState.create({ doc: styledBase }).tr;
    const r = applyPasteModeToTr(tr, "merge", { from: 2, to: 6, baseDoc: styledBase, kind: "text", tables: [], cells: [] });
    expect(r.ok).toBe(true);
    const json = JSON.stringify(tr.doc.toJSON());
    expect(json).toContain('"bold"');
    expect(json).not.toContain("textStyle");
  });
  it("text and picture are not transaction modes — the editor does those", () => {
    expect(run("text").r.ok).toBe(false);
    expect(run("picture").r.ok).toBe(false);
  });
  it("cells: Values flattens only the cells the paste wrote; Formatting only restores their text and takes the look", () => {
    const pre = doc(box(grid3()), p(""));
    const tp = tablePosOf(pre);
    const post = mapCell(pre, tp, 1, 1, "99");
    const found = analyzePaste({ preDoc: pre, postDoc: post, preTablePos: tp, sliceHadTable: true });
    const o = { from: tp, to: tp + 5, baseDoc: post, kind: "cells", tables: [], cells: found.cells, preTable: found.preTable, meta: { tables: [{ fills: [["#ccffcc"]] }] } };
    const f = EditorState.create({ doc: post }).tr;
    expect(applyPasteModeToTr(f, "formatting", o).ok).toBe(true);
    const out = tableOf(f.doc);
    expect(out.child(1).child(1).textContent).toBe("2");              // the cell's own text, not the pasted 99
    expect(out.child(1).child(1).attrs.background).toBe("#ccffcc");
    expect(out.child(1).child(0).textContent).toBe("Dock");           // a neighbour untouched
  });
});

describe("source lengths", () => {
  it("reads px, pt, in, cm and refuses percentages", () => {
    expect(cssLengthPx("64")).toBe(64);
    expect(cssLengthPx("48pt")).toBe(64);
    expect(cssLengthPx("0.9in")).toBe(86);
    expect(cssLengthPx("2.54cm")).toBe(96);
    expect(cssLengthPx("50%")).toBeNull();
    expect(cssLengthPx("auto")).toBeNull();
    expect(cssLengthPx("")).toBeNull();
  });
});

describe("the source's shading — Excel names it by class, not inline", () => {
  it("reads a fill from a declaration block, and refuses white and nothing", () => {
    expect(fillFromDeclarations("color:black;background:#DBE5F1;border:.5pt solid black")).toBe("#dbe5f1");
    expect(fillFromDeclarations("background-color: rgb(255, 255, 0)")).toBe("#ffff00");
    expect(fillFromDeclarations("background:#FFFFFF")).toBeNull();
    expect(fillFromDeclarations("background:none")).toBeNull();
    expect(fillFromDeclarations("color:red")).toBeNull();
  });
  it("maps Excel's classes to their fills (the committed fixture's own style block)", () => {
    const css = `<!--table\n\t{mso-displayed-decimal-separator:"\\.";}\n.font5\n\t{color:windowtext;font-weight:700;}\n.xl65\n\t{padding-top:1px;color:black;border:.5pt solid black;background:#DBE5F1;}\n.xl66\n\t{color:black;border:.5pt solid black;}\ntd.xl70 { background-color:#FFFF00 }\n-->`;
    expect(fillsByClass(css)).toEqual({ xl65: "#dbe5f1", xl70: "#ffff00" });
  });
});
