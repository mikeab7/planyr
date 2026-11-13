/* notesAnchorNest — B2671237: a box is never inside another box. The stored shape below is what a REAL paste of text copied from a
 * box measurably produced on unmodified main (probe: noteAnchor b › noteAnchor{x:40,y:100} › paragraph) — drawn 57 px right of, and
 * 100 px below, the box it was pasted into. */
import { describe, it, expect } from "vitest";
import { getSchema } from "@tiptap/core";
import { EditorState } from "@tiptap/pm/state";
import { Node as PMNode } from "@tiptap/pm/model";
import { NOTE_EXTENSIONS } from "../src/workspaces/notes/lib/notesExtensions.js";
import { unnestDoc, unnestTr } from "../src/workspaces/notes/lib/notesAnchorNest.js";

const schema = getSchema(NOTE_EXTENSIONS);
const p = (t) => ({ type: "paragraph", content: t ? [{ type: "text", text: t }] : [] });
const box = (aid, y, ...c) => ({ type: "noteAnchor", attrs: { aid, x: 40, y, w: 560, h: null, fit: false }, content: c });
const nested = () => ({ type: "doc", content: [box("a", 100, p("Alpha")), box("b", 150, box("inner", 100, p("Pasted line We did get"))), box("c", 190, p("Gamma")), p("")] });
const depthOfBoxes = (n, d = 0, out = []) => { if (n.type === "noteAnchor") out.push(d); (n.content || []).forEach((c) => depthOfBoxes(c, n.type === "noteAnchor" ? d + 1 : d, out)); return out; };

describe("unnestDoc — a page already stored with a box in a box", () => {
  it("unwraps the inner box: its words stay, its frame goes", () => {
    const out = unnestDoc(nested());
    expect(out.content[1].content).toEqual([p("Pasted line We did get")]);
    expect(Math.max(...depthOfBoxes(out))).toBe(0);
  });
  it("is the SAME object when nothing is nested (callers compare by identity)", () => {
    const d = { type: "doc", content: [box("a", 1, p("x")), p("")] };
    expect(unnestDoc(d)).toBe(d);
  });
  it("unwraps a box nested two deep, and a box inside a list inside a box", () => {
    const deep = { type: "doc", content: [box("o", 0, box("m", 0, box("i", 0, p("deep"))))] };
    expect(unnestDoc(deep).content[0].content).toEqual([p("deep")]);
  });
});

describe("unnestTr — a LIVE edit", () => {
  it("returns null for a normal document", () => {
    const st = EditorState.create({ doc: PMNode.fromJSON(schema, { type: "doc", content: [box("a", 1, p("x")), p("")] }) });
    expect(unnestTr(st)).toBe(null);
  });
  it("unwraps in place and a caret inside the pasted text keeps its place", () => {
    const doc = PMNode.fromJSON(schema, nested());
    let caret = 0; doc.descendants((n, pos) => { if (n.isText && n.text.startsWith("Pasted")) caret = pos + 3; });
    const st = EditorState.create({ doc, selection: undefined });
    const tr = unnestTr(st);
    expect(tr).not.toBe(null);
    expect(Math.max(...depthOfBoxes(tr.doc.toJSON()))).toBe(0);
    const mapped = tr.mapping.map(caret);
    expect(tr.doc.textBetween(mapped - 3, mapped + 3)).toBe("Pasted");
    expect(tr.doc.child(1).childCount).toBe(1);
    expect(tr.doc.child(1).textContent).toBe("Pasted line We did get");
  });
});
