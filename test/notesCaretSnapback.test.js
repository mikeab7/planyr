/* notesCaretSnapback — NEW-3 (2026-11-12): the PURE half of the caret snap-back recorder. The wiring is judged in a browser by
 * ui-audit/verify-notes-caret-snapback.mjs; the live reproduction attempt is ui-audit/verify-notes-click-after-paste-live.mjs. */
import { describe, it, expect } from "vitest";
import { Schema } from "@tiptap/pm/model";
import { blockAt, snapbackVerdict, listDepthAt, snapbackReport } from "../src/workspaces/notes/lib/notesCaretSnapback.js";

const schema = new Schema({
  nodes: {
    doc: { content: "block+" },
    paragraph: { group: "block", content: "text*", toDOM: () => ["p", 0] },
    listItem: { content: "paragraph block*", toDOM: () => ["li", 0] },
    orderedList: { group: "block", content: "listItem+", toDOM: () => ["ol", 0] },
    text: { group: "inline" },
  },
});
const p = (t) => schema.nodes.paragraph.create(null, t ? schema.text(t) : null);
const li = (...kids) => schema.nodes.listItem.create(null, kids);
const ol = (...items) => schema.nodes.orderedList.create(null, items);
const doc = schema.nodes.doc.create(null, [p("intro"), ol(li(p("Final Plat"), ol(li(p("Baytown")), li(p("")))))]);

describe("snapbackVerdict", () => {
  const at = (needle) => { let pos = null; doc.descendants((n, i) => { if (n.isText && n.text.includes(needle) && pos == null) pos = i + 1; }); return pos; };
  it("is false when the caret is anywhere inside the block that was clicked", () => {
    const clicked = blockAt(doc, at("Baytown") + 2);
    expect(snapbackVerdict(clicked, clicked.start)).toBe(false);
    expect(snapbackVerdict(clicked, clicked.end)).toBe(false);
  });
  it("is true when the caret is in another block — above or below", () => {
    const clicked = blockAt(doc, at("Baytown") + 2);
    expect(snapbackVerdict(clicked, at("intro"))).toBe(true);
    expect(snapbackVerdict(clicked, doc.content.size - 2)).toBe(true);
  });
  it("is false when there is nothing to compare (the click was not in a textblock / no head)", () => {
    expect(snapbackVerdict(null, 5)).toBe(false);
    expect(snapbackVerdict(blockAt(doc, 3), NaN)).toBe(false);
  });
  it("reads an EMPTY list item as a block of its own (the owner's blank '1.' lines)", () => {
    let emptyPos = null; doc.descendants((n, i) => { if (n.type.name === "paragraph" && n.content.size === 0) emptyPos = i + 1; });
    const b = blockAt(doc, emptyPos);
    expect(b.empty).toBe(true);
    expect(snapbackVerdict(b, emptyPos)).toBe(false);
    expect(snapbackVerdict(b, at("Final Plat"))).toBe(true);
  });
});

describe("the report carries structure and never note text", () => {
  it("names node types, list depth, direction and the app-side context — no characters of the note", () => {
    const pos = (() => { let r; doc.descendants((n, i) => { if (n.isText && n.text === "Baytown") r = i + 1; }); return r; })();
    const clicked = blockAt(doc, pos + 2);
    const rep = snapbackReport({ doc, clicked, clickPos: pos + 2, head: 3, ctx: { pasteOffer: true, pasteExpanded: false } });
    expect(rep.clicked).toEqual({ type: "paragraph", empty: false, listDepth: 2 });
    expect(rep.direction).toBe("above");
    expect(rep.pasteOffer).toBe(true);
    const json = JSON.stringify(rep);
    for (const word of ["Baytown", "Final", "intro"]) expect(json.includes(word), word).toBe(false);
  });
  it("counts list levels", () => {
    expect(listDepthAt(doc, 2)).toBe(0);
    expect(listDepthAt(doc, doc.content.size - 3)).toBe(2);
  });
});
