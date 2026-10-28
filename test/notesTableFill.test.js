/* notesTableFill — NEW-1 / NEW-2 (2026-10-28): a header row on ANY row, Bold telling the truth inside
 * a header cell, and a solid cell fill. Runs against the REAL note schema (getSchema(NOTE_EXTENSIONS))
 * and the real prosemirror-tables commands — no DOM, no editor view.
 *
 * RED-FIRST, honestly: the brief called the "header-ness leaks into a new row" cause an inference to be
 * confirmed with a red test. It does NOT reproduce — the matrix below passes on unmodified code (the
 * library inserts a plain row beside a lone header row). What produces "row 2 is a header row" is the
 * header row being PUSHED DOWN by Row ↑ (the first block of tests pins that down). The red half is
 * the toggle: Tiptap's `toggleHeaderRow` (= `toggleHeader("row")`) is hard-wired to row 0, so a header
 * row anywhere else cannot be undone (first test of "the library's own toggle").
 */
import { describe, it, expect } from "vitest";
import { getSchema } from "@tiptap/core";
import { EditorState, TextSelection } from "@tiptap/pm/state";
import { Node as PMNode } from "@tiptap/pm/model";
import { history, undo, redo } from "@tiptap/pm/history";
import { CellSelection, addRowAfter, addRowBefore, toggleHeader } from "@tiptap/pm/tables";
import { NOTE_EXTENSIONS } from "../src/workspaces/notes/lib/notesExtensions.js";
import {
  BOLD_TITLE_IN_HEADER, FILL_NONE, TABLE_FILLS, boldTruth, chosenFill, currentFill, fillForCell,
  headerRowsState, normalizeFill, selectionInHeaderCells, setCellFill, toggleHeaderRows,
} from "../src/workspaces/notes/lib/notesTableFill.js";

const schema = getSchema(NOTE_EXTENSIONS);

const cell = (t, h, extra = {}) => ({
  type: h ? "tableHeader" : "tableCell", attrs: { colspan: 1, rowspan: 1, ...extra },
  content: [{ type: "paragraph", content: [{ type: "text", text: t }] }],
});
const docOf = (rows) => PMNode.fromJSON(schema, { type: "doc", content: [{ type: "table", content: rows.map((r) => ({ type: "tableRow", content: r })) }] });
/** rows of [text, isHeader] pairs */
const grid = (rows) => docOf(rows.map((r) => r.map(([t, h, x]) => cell(t, h, x))));
const posOf = (doc, text) => { let p = -1; doc.descendants((n, pos) => { if (n.isText && n.text === text) p = pos + 1; }); if (p < 0) throw new Error(`no ${text}`); return p; };
const stateAt = (doc, text, extra = {}) => {
  const st = EditorState.create({ doc, schema, ...extra });
  return st.apply(st.tr.setSelection(TextSelection.create(st.doc, posOf(doc, text))));
};
const kinds = (doc) => { const o = []; doc.firstChild.forEach((r) => { let s = ""; r.forEach((c) => { s += c.type.name === "tableHeader" ? "H" : "-"; }); o.push(s); }); return o.join("|"); };
const run = (cmd, st) => { let out = st; cmd(st, (tr) => { out = st.apply(tr); }); return out; };
const bgs = (doc) => { const o = []; doc.firstChild.forEach((r) => { const row = []; r.forEach((c) => row.push(c.attrs.background ?? null)); o.push(row); }); return o; };
const threeRows = (hdr) => [0, 1, 2].map((i) => [[`r${i}a`, i === hdr], [`r${i}b`, i === hdr]]);

describe("how a stray header row forms (measured, not inferred)", () => {
  for (const [name, hdr] of [["first", 0], ["middle", 1], ["last", 2]]) {
    it(`Row ↑ and Row ↓ beside a ${name} header row insert a PLAIN row`, () => {
      const d = grid(threeRows(hdr));
      const up = run(addRowBefore, stateAt(d, `r${hdr}a`));
      const down = run(addRowAfter, stateAt(d, `r${hdr}a`));
      // the inserted row is plain; only the original header row is header
      const rowsUp = kinds(up.doc).split("|"); const rowsDown = kinds(down.doc).split("|");
      expect(rowsUp.filter((r) => r === "HH")).toHaveLength(1);
      expect(rowsDown.filter((r) => r === "HH")).toHaveLength(1);
      expect(rowsUp[hdr]).toBe("--");           // the new row took the header's old index…
      expect(rowsUp[hdr + 1]).toBe("HH");       // …and the header row moved DOWN one
      expect(rowsDown[hdr + 1]).toBe("--");
    });
  }

  it("Header on row 1, then Row ↑ — the header row is now ROW 2 (the reported shape)", () => {
    const d = grid(threeRows(0));
    expect(kinds(run(addRowBefore, stateAt(d, "r0a")).doc).startsWith("--|HH")).toBe(true);
  });

  it("a new row between TWO header rows joins the header block (correct, kept)", () => {
    const d = grid([0, 1, 2].map((i) => [[`r${i}a`, i < 2], [`r${i}b`, i < 2]]));
    expect(kinds(run(addRowAfter, stateAt(d, "r0a")).doc)).toBe("HH|HH|HH|--");
    expect(kinds(run(addRowAfter, stateAt(d, "r1a")).doc)).toBe("HH|HH|--|--");
  });
});

describe("the library's own toggle is row 0 only (the bug)", () => {
  it("toggleHeader('row') with the caret in row 3 flips ROW 1 and leaves row 3 alone", () => {
    const d = grid(threeRows(-1));
    const out = run(toggleHeader("row"), stateAt(d, "r2a"));
    expect(kinds(out.doc)).toBe("HH|--|--");
  });
  it("…so a header row that is not row 1 can never be turned off with it", () => {
    const d = grid(threeRows(1));
    const out = run(toggleHeader("row"), stateAt(d, "r1a"));
    expect(kinds(out.doc).split("|")[1]).toBe("HH");       // still a header row
  });
});

describe("toggleHeaderRows — acts on the caret's row", () => {
  it("makes row 2 a header row, and a second press makes it plain again", () => {
    const d = grid(threeRows(-1));
    const on = run(toggleHeaderRows, stateAt(d, "r1a"));
    expect(kinds(on.doc)).toBe("--|HH|--");
    expect(headerRowsState(stateAt(on.doc, "r1a"))).toBe("true");
    const off = run(toggleHeaderRows, stateAt(on.doc, "r1b"));
    expect(kinds(off.doc)).toBe("--|--|--");
  });

  it("un-headers a header row anywhere: first, middle, last (Michael's exact table: row 2)", () => {
    for (const hdr of [0, 1, 2]) {
      const d = grid(threeRows(hdr));
      const st = stateAt(d, `r${hdr}b`);
      expect(headerRowsState(st)).toBe("true");
      expect(kinds(run(toggleHeaderRows, st).doc)).toBe("--|--|--");
    }
  });

  it("reports false / true for the caret row only", () => {
    const d = grid(threeRows(1));
    expect(headerRowsState(stateAt(d, "r0a"))).toBe("false");
    expect(headerRowsState(stateAt(d, "r1a"))).toBe("true");
    expect(headerRowsState(EditorState.create({ schema, doc: PMNode.fromJSON(schema, { type: "doc", content: [{ type: "paragraph" }] }) }))).toBeNull();
  });

  it("a cell selection across two rows toggles both; a mixed selection turns ALL on first", () => {
    const d = grid(threeRows(0));
    const base = stateAt(d, "r0a");
    const a = posOf(d, "r0a") - 2; const b = posOf(d, "r1b") - 2;       // inside the cells → cell positions
    const cellPos = (text) => { const $p = base.doc.resolve(posOf(d, text)); return $p.before($p.depth - 1); };
    const sel = CellSelection.create(base.doc, cellPos("r0a"), cellPos("r1b"));
    void a; void b;
    const st = base.apply(base.tr.setSelection(sel));
    expect(headerRowsState(st)).toBe("mixed");
    expect(kinds(run(toggleHeaderRows, st).doc)).toBe("HH|HH|--");
  });

  it("undo and redo each take ONE step", () => {
    const d = grid(threeRows(-1));
    const st0 = stateAt(d, "r1a", { plugins: [history()] });
    const st1 = run(toggleHeaderRows, st0);
    expect(kinds(st1.doc)).toBe("--|HH|--");
    const st2 = run(undo, st1);
    expect(kinds(st2.doc)).toBe("--|--|--");
    expect(kinds(run(redo, st2).doc)).toBe("--|HH|--");
  });

  it("a header COLUMN survives un-headering a row (the column heading stays)", () => {
    const d = grid([
      [["Name", true], ["V1", true]],          // row 0: header row + header column cell
      [["a", true], ["1", false]],
      [["b", true], ["2", false]],
    ]);
    const off = run(toggleHeaderRows, stateAt(d, "V1"));
    expect(kinds(off.doc)).toBe("H-|H-|H-");
  });

  it("merged cells: a colspan header row toggles whole, nothing is lost, the doc stays valid", () => {
    const d = docOf([
      [cell("Wide", true, { colspan: 2 })],
      [cell("a", false), cell("b", false)],
    ]);
    const off = run(toggleHeaderRows, stateAt(d, "Wide"));
    expect(kinds(off.doc)).toBe("-|--");
    expect(off.doc.firstChild.firstChild.firstChild.attrs.colspan).toBe(2);
    expect(() => off.doc.check()).not.toThrow();
    const back = run(toggleHeaderRows, stateAt(off.doc, "Wide"));
    expect(kinds(back.doc)).toBe("H|--");
  });

  it("a cell spanning rows converts once and is not duplicated", () => {
    const d = docOf([
      [cell("tall", true, { rowspan: 2 }), cell("x", true)],
      [cell("y", true)],
    ]);
    const off = run(toggleHeaderRows, stateAt(d, "x"));
    expect(() => off.doc.check()).not.toThrow();
    let n = 0; off.doc.descendants((nn) => { if (nn.type.name === "tableCell" || nn.type.name === "tableHeader") n += 1; });
    expect(n).toBe(3);
  });
});

describe("Bold tells the truth in a header cell", () => {
  it("a caret in a header cell reports header; in a body cell, none", () => {
    const d = grid(threeRows(1));
    expect(selectionInHeaderCells(stateAt(d, "r1a"))).toBe("all");
    expect(selectionInHeaderCells(stateAt(d, "r0a"))).toBe("none");
  });
  it("boldTruth: lit inside a header, never 'off' on visibly bold text", () => {
    expect(boldTruth("false", "all")).toBe("true");
    expect(boldTruth("false", "none")).toBe("false");
    expect(boldTruth("true", "none")).toBe("true");
    expect(boldTruth("false", "some")).toBe("mixed");
    expect(boldTruth("mixed", "none")).toBe("mixed");
  });
  it("a range across header and body cells is 'some'", () => {
    const d = grid(threeRows(0));
    const st = stateAt(d, "r0a");
    const sel = TextSelection.create(st.doc, posOf(d, "r0a"), posOf(d, "r1b") + 1);
    expect(selectionInHeaderCells(st.apply(st.tr.setSelection(sel)))).toBe("some");
  });
  it("the tooltip names the way out", () => {
    expect(BOLD_TITLE_IN_HEADER).toBe("Bold (header row: use Header row to change)");
  });
});

describe("fill", () => {
  it("normalizeFill: solid hex and rgb() only, explicit transparent; never alpha / names / junk", () => {
    expect(normalizeFill("#FEF08A")).toBe("#fef08a");
    expect(normalizeFill("#abc")).toBe("#aabbcc");
    expect(normalizeFill("rgb(254, 240, 138)")).toBe("#fef08a");
    expect(normalizeFill("transparent")).toBe(FILL_NONE);
    expect(normalizeFill("rgba(0,0,0,0.5)")).toBeNull();
    expect(normalizeFill("red")).toBeNull();
    expect(normalizeFill("url(x)")).toBeNull();
    expect(normalizeFill(null)).toBeNull();
    expect(normalizeFill("rgb(300,0,0)")).toBeNull();
  });
  it("the palette starts with No fill and holds only valid solid tints", () => {
    expect(TABLE_FILLS[0]).toEqual({ name: "No fill", value: null });
    for (const f of TABLE_FILLS.slice(1)) expect(normalizeFill(f.value)).toBe(f.value.toLowerCase());
  });
  it("'No fill' on a header cell is explicit transparent; on a plain cell it is null", () => {
    expect(fillForCell("tableHeader", null)).toBe(FILL_NONE);
    expect(fillForCell("tableCell", null)).toBeNull();
    expect(fillForCell("tableCell", "#E5E7EB")).toBe("#e5e7eb");
    expect(chosenFill(FILL_NONE)).toBeNull();
  });

  it("with only a caret, fills the caret cell's whole ROW", () => {
    const d = grid(threeRows(-1));
    const out = run(setCellFill("#FEF08A"), stateAt(d, "r1a"));
    expect(bgs(out.doc)).toEqual([[null, null], ["#fef08a", "#fef08a"], [null, null]]);
  });

  it("with a cell selection, fills exactly those cells", () => {
    const d = grid(threeRows(-1));
    const base = stateAt(d, "r0a");
    const cellPos = (text) => { const $p = base.doc.resolve(posOf(d, text)); return $p.before($p.depth - 1); };
    const st = base.apply(base.tr.setSelection(CellSelection.create(base.doc, cellPos("r0b"), cellPos("r1b"))));
    const out = run(setCellFill("#BFDBFE"), st);
    expect(bgs(out.doc)).toEqual([[null, "#bfdbfe"], [null, "#bfdbfe"], [null, null]]);
  });

  it("No fill clears a fill; on a header row it writes explicit transparent and keeps the header", () => {
    const d = grid([[["h1", true, { background: "#fef08a" }], ["h2", true, { background: "#fef08a" }]], [["a", false, { background: "#fef08a" }], ["b", false]]]);
    const hdr = run(setCellFill(null), stateAt(d, "h1"));
    expect(bgs(hdr.doc)[0]).toEqual([FILL_NONE, FILL_NONE]);
    expect(kinds(hdr.doc).split("|")[0]).toBe("HH");
    const body = run(setCellFill(null), stateAt(d, "a"));
    expect(bgs(body.doc)[1]).toEqual([null, null]);
  });

  it("un-headering a row drops the now-meaningless transparent; the header shade is back if re-headered", () => {
    const d = grid([[["h1", true, { background: FILL_NONE }]], [["a", false]]]);
    const off = run(toggleHeaderRows, stateAt(d, "h1"));
    expect(bgs(off.doc)[0]).toEqual([null]);
    expect(kinds(off.doc)).toBe("-|-");
  });

  it("refuses a malformed value instead of writing it", () => {
    const d = grid(threeRows(-1));
    const st = stateAt(d, "r0a");
    expect(setCellFill("not-a-colour")(st, () => { throw new Error("must not dispatch"); })).toBe(false);
    expect(setCellFill("rgba(0,0,0,.5)")(st, undefined)).toBe(false);
  });

  it("the Fill button's state: a hex, none, or mixed", () => {
    const d = grid([[["a", false, { background: "#bbf7d0" }], ["b", false, { background: "#bbf7d0" }]], [["c", false], ["d", false, { background: "#fef08a" }]]]);
    expect(currentFill(stateAt(d, "a"))).toBe("#bbf7d0");
    expect(currentFill(stateAt(d, "c"))).toBe("mixed");
    expect(currentFill(stateAt(grid(threeRows(-1)), "r0a"))).toBeNull();
  });

  it("is one undo step", () => {
    const d = grid(threeRows(-1));
    const st1 = run(setCellFill("#FEF08A"), stateAt(d, "r1a", { plugins: [history()] }));
    expect(bgs(run(undo, st1).doc)).toEqual(bgs(d));
  });

  it("survives the stored JSON round trip, and an old doc without the attr loads as no fill", () => {
    const d = grid(threeRows(-1));
    const out = run(setCellFill("#FEF08A"), stateAt(d, "r1a"));
    const again = PMNode.fromJSON(schema, out.doc.toJSON());
    expect(bgs(again)[1]).toEqual(["#fef08a", "#fef08a"]);
    const legacy = PMNode.fromJSON(schema, { type: "doc", content: [{ type: "table", content: [{ type: "tableRow", content: [{ type: "tableCell", attrs: { colspan: 1, rowspan: 1, colwidth: null }, content: [{ type: "paragraph" }] }] }] }] });
    expect(bgs(legacy)).toEqual([[null]]);
  });

  it("the schema renders the fill as data attr + inline background-color (HTML / print / Excel), transparent included", () => {
    const spec = (name, background) => {
      const n = schema.nodes[name].create({ background }, schema.nodes.paragraph.create());
      return n.type.spec.toDOM(n);
    };
    const td = spec("tableCell", "#fef08a")[1];
    expect(td["data-cell-fill"]).toBe("#fef08a");
    expect(td.style).toContain("background-color: #fef08a");
    const th = spec("tableHeader", FILL_NONE)[1];
    expect(th["data-cell-fill"]).toBe("transparent");
    expect(th.style).toContain("background-color: transparent");
    expect(spec("tableCell", null)[1]["data-cell-fill"]).toBeUndefined();
  });
});
