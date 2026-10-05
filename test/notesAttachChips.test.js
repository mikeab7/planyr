/* Three attachments inserted one after another must leave three chips (PDF, XLSX, DWG).
 * Pure ProseMirror, no DOM: drives the same transaction insertFiles dispatches. */
import { describe, it, expect } from "vitest";
import { getSchema } from "@tiptap/core";
import { EditorState, NodeSelection } from "@tiptap/pm/state";
import { NOTE_EXTENSIONS } from "../src/workspaces/notes/lib/notesExtensions.js";
import { attachmentTr } from "../src/workspaces/notes/lib/notesAttachNode.js";

const schema = getSchema(NOTE_EXTENSIONS);
const mk = (name) => schema.nodes.noteAttachment.create({ fileId: "f_" + name, name, mime: "", size: 1 });
const chips = (doc) => { const out = []; doc.descendants((n) => { if (n.type.name === "noteAttachment") out.push(n.attrs.name); }); return out; };
const base = () => EditorState.create({ schema, doc: schema.nodeFromJSON({ type: "doc", content: [{ type: "paragraph" }] }) });

function run(names, state) {
  for (const n of names) state = state.apply(attachmentTr(state, mk(n)));
  return state;
}
function selectFirstChip(s) {
  let pos = -1;
  s.doc.descendants((n, p) => { if (n.type.name === "noteAttachment" && pos < 0) pos = p; });
  return s.apply(s.tr.setSelection(NodeSelection.create(s.doc, pos)));
}

describe("attachment chips", () => {
  it("three in a row keep all three", () => {
    expect(chips(run(["a.pdf", "b.xlsx", "c.dwg"], base()).doc)).toEqual(["a.pdf", "b.xlsx", "c.dwg"]);
  });
  it("a node-selected previous chip is not replaced by the next", () => {
    const s = selectFirstChip(run(["a.pdf"], base()));
    expect(chips(run(["b.xlsx", "c.dwg"], s).doc)).toEqual(["a.pdf", "b.xlsx", "c.dwg"]);
  });
  it("chips are inserted after a mid-document caret too, in order", () => {
    const doc = schema.nodeFromJSON({ type: "doc", content: [
      { type: "paragraph", content: [{ type: "text", text: "hello" }] },
      { type: "paragraph", content: [{ type: "text", text: "tail" }] }] });
    const s = run(["a.pdf", "b.xlsx", "c.dwg"], EditorState.create({ schema, doc }));
    expect(chips(s.doc)).toEqual(["a.pdf", "b.xlsx", "c.dwg"]);
    expect(s.doc.textContent).toBe("hellotail");
  });
});
