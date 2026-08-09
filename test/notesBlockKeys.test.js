/* notesBlockKeys — the Backspace-at-position-zero DECISION, against real ProseMirror states.
 *
 * ⛔ WHY THESE ARE NOT SOURCE SCANS. B36051's guard read the file for the strings it expected
 * to find, which proves a shape and not a behaviour: it stayed green through the entire
 * period in which one press at the start of a nested bullet un-nested it AND merged it, and
 * one press after a picture DELETED the picture. So these build the real schema out of
 * `NOTE_EXTENSIONS`, put a caret at an exact position in a real document, and assert which
 * row of the table `blockStartAction` picks.
 *
 * The half these CANNOT cover is what the chosen command then does to the document — that is
 * ProseMirror's, and it is asserted end to end, in a browser, on the built bundle, by
 * `ui-audit/verify-notes-backspace.mjs`. Two halves, deliberately: this one runs in CI and
 * catches a decision that drifted; that one catches an outcome that drifted.
 */
import { describe, it, expect } from "vitest";
import { getSchema } from "@tiptap/core";
import { EditorState, TextSelection, NodeSelection } from "@tiptap/pm/state";
import { NOTE_EXTENSIONS } from "../src/workspaces/notes/lib/notesExtensions.js";
import { blockStartAction } from "../src/workspaces/notes/lib/notesBlockKeys.js";

const schema = getSchema(NOTE_EXTENSIONS);

/* ---- the same builders the headless harness uses, so the two read alike ---------------- */
const P = (t, attrs) => ({ type: "paragraph", ...(attrs ? { attrs } : {}), ...(t ? { content: [{ type: "text", text: t }] } : {}) });
const H = (t, level = 2) => ({ type: "heading", attrs: { level }, content: [{ type: "text", text: t }] });
const LI = (t, sub) => ({ type: "listItem", content: [P(t), ...(sub ? [sub] : [])] });
const UL = (...items) => ({ type: "bulletList", content: items });
const OL = (...items) => ({ type: "orderedList", content: items });
const TI = (t, sub) => ({ type: "taskItem", attrs: { checked: false }, content: [P(t), ...(sub ? [sub] : [])] });
const TL = (...items) => ({ type: "taskList", content: items });
const QUOTE = (...b) => ({ type: "blockquote", content: b });
const CODE = (t) => ({ type: "codeBlock", content: [{ type: "text", text: t }] });
const CELL = (t) => ({ type: "tableCell", content: [P(t)] });
const ROW = (...c) => ({ type: "tableRow", content: c });
const TABLE = (...r) => ({ type: "table", content: r });
const IMG = () => ({ type: "noteImage", attrs: { imageId: "probe", alt: "" } });
const SKETCH = () => ({ type: "noteSketch", attrs: { boxes: [], links: [] } });
const doc = (...content) => ({ type: "doc", content });

/** The absolute position just inside the node reached by a path of child indexes — the same
 *  addressing the harness uses, so a case can be moved between the two files verbatim. */
function startOf(pmDoc, path) {
  let node = pmDoc;
  let pos = 0;
  for (const i of path) {
    for (let k = 0; k < i; k += 1) pos += node.child(k).nodeSize;
    node = node.child(i);
    pos += 1;
  }
  return pos;
}

/** The verdict for a caret at the very start of the block at `path`. */
function verdictAt(json, path) {
  const pmDoc = schema.nodeFromJSON(json);
  const state = EditorState.create({ schema, doc: pmDoc });
  const pos = startOf(pmDoc, path);
  return blockStartAction(state.apply(state.tr.setSelection(TextSelection.create(pmDoc, pos))));
}
const actionAt = (json, path) => verdictAt(json, path)?.action ?? null;

describe("blockStartAction — which single step a Backspace at position zero takes", () => {
  it("is not interested in a press that is not at the start of a block", () => {
    const pmDoc = schema.nodeFromJSON(doc(P("one"), P("two")));
    const state = EditorState.create({ schema, doc: pmDoc });
    const mid = startOf(pmDoc, [1]) + 2;
    expect(blockStartAction(state.apply(state.tr.setSelection(TextSelection.create(pmDoc, mid))))).toBeNull();
  });

  it("is not interested in a selection-delete, even one that starts at position zero", () => {
    const pmDoc = schema.nodeFromJSON(doc(P("one"), P("two")));
    const state = EditorState.create({ schema, doc: pmDoc });
    const from = startOf(pmDoc, [1]);
    const sel = TextSelection.create(pmDoc, from, from + 3);
    expect(blockStartAction(state.apply(state.tr.setSelection(sel)))).toBeNull();
  });

  it("is not interested in a NODE selection (a picture that is already selected)", () => {
    const pmDoc = schema.nodeFromJSON(doc(IMG(), P("after")));
    const state = EditorState.create({ schema, doc: pmDoc });
    expect(blockStartAction(state.apply(state.tr.setSelection(NodeSelection.create(pmDoc, 0))))).toBeNull();
  });

  /* ── the owner's two repros, as decisions ─────────────────────────────────────────────── */
  it("REPRO A — a NESTED list item outdents; it never merges into its parent", () => {
    const d = doc(P("para one"), UL(LI("bullet one", UL(LI("bullet two")))));
    expect(actionAt(d, [1, 0, 1, 0, 0])).toBe("outdent-list-item");
  });

  it("REPRO B — a TOP-LEVEL list item becomes a plain paragraph; the join is the second press", () => {
    const d = doc(P("para one"), UL(LI("bullet one", UL(LI("bullet two")))));
    expect(actionAt(d, [1, 0, 0])).toBe("list-item-to-paragraph");
  });

  /* ── the rest of the list surface ─────────────────────────────────────────────────────── */
  it("reads a numbered list and a checklist by the same rule as bullets", () => {
    expect(actionAt(doc(P("x"), OL(LI("one"), LI("two"))), [1, 0, 0])).toBe("list-item-to-paragraph");
    expect(actionAt(doc(P("x"), TL(TI("one", TL(TI("two"))))), [1, 0, 1, 0, 0])).toBe("outdent-list-item");
    expect(verdictAt(doc(P("x"), TL(TI("one", TL(TI("two"))))), [1, 0, 1, 0, 0]).itemType).toBe("taskItem");
  });

  it("⛔ a checklist nested inside a bulleted list is ONE step, not two — the two-pass keymap case", () => {
    // Tiptap's ListKeymap runs its Backspace once per list type over a forEach that does not
    // stop at the first one to act; on the mixed document that dissolved BOTH levels in one
    // press. The verdict here is a single lift of the INNER item's own type.
    const v = verdictAt(doc(P("x"), UL(LI("bullet one", TL(TI("task two"))))), [1, 0, 1, 0, 0]);
    expect(v.action).toBe("outdent-list-item");
    expect(v.itemType).toBe("taskItem");
    const w = verdictAt(doc(P("x"), TL(TI("task one", UL(LI("bullet two"))))), [1, 0, 1, 0, 0]);
    expect(w.action).toBe("outdent-list-item");
    expect(w.itemType).toBe("listItem");
  });

  it("a LATER block inside a list item is the ordinary join, within that item", () => {
    const d = doc(UL({ type: "listItem", content: [P("one"), P("second line")] }));
    expect(actionAt(d, [0, 0, 1])).toBe("join");
  });

  it("the first item of a list that is the document's first block still just leaves the list", () => {
    expect(actionAt(doc(UL(LI("one"), LI("two"))), [0, 0, 0])).toBe("list-item-to-paragraph");
  });

  /* ── formatting comes off before anything structural ──────────────────────────────────── */
  it("an odd ALIGNMENT is undone first — B36051's case, and it is still first in line", () => {
    for (const align of ["center", "right", "justify"]) {
      expect(actionAt(doc(P("above"), P("odd", { textAlign: align })), [1])).toBe("clear-align");
    }
  });

  it("…and a default alignment is not worth a keystroke of its own", () => {
    expect(actionAt(doc(P("above"), P("plain", { textAlign: "left" })), [1])).toBe("join");
    expect(actionAt(doc(P("above"), P("plain")), [1])).toBe("join");
  });

  it("a HEADING gives up its formatting first; a paragraph AFTER a heading just joins", () => {
    expect(actionAt(doc(P("body"), H("Heading")), [1])).toBe("heading-to-paragraph");
    expect(actionAt(doc(H("Heading"), P("body")), [1])).toBe("join");
  });

  it("a CODE BLOCK becomes a paragraph rather than pouring its code into the prose above", () => {
    expect(actionAt(doc(P("before"), CODE("const x = 1;")), [1])).toBe("codeblock-to-paragraph");
  });

  it("the first block of a BLOCKQUOTE leaves the quote", () => {
    expect(actionAt(doc(P("before"), QUOTE(P("quoted"), P("second"))), [1, 0])).toBe("lift-blockquote");
    expect(actionAt(doc(P("before"), QUOTE(P("quoted"), P("second"))), [1, 1])).toBe("join");
  });

  /* ── the boundaries where the wrong answer destroys content ───────────────────────────── */
  it("⛔ a paragraph after a PICTURE or a SKETCH SELECTS it — it must never delete it", () => {
    expect(actionAt(doc(IMG(), P("after")), [1])).toBe("select-node-before");
    expect(actionAt(doc(SKETCH(), P("after")), [1])).toBe("select-node-before");
    expect(actionAt(doc(IMG(), P("")), [1])).toBe("select-node-before");
    // …and at the picture's own start position, so the second press is the deliberate one.
    expect(verdictAt(doc(P("x"), IMG(), P("after")), [2]).pos).toBe(startOf(schema.nodeFromJSON(doc(P("x"), IMG(), P("after"))), [1]) - 1);
  });

  it("a paragraph after a TABLE steps into the last cell instead of selecting the whole table", () => {
    expect(actionAt(doc(TABLE(ROW(CELL("a1"), CELL("b1"))), P("after")), [1])).toBe("into-table-cell");
  });

  it("⛔ the first block of a table CELL does nothing at all — cells never merge", () => {
    const d = doc(P("before"), TABLE(ROW(CELL("a1"), CELL("b1")), ROW(CELL("a2"), CELL("b2"))));
    expect(actionAt(d, [1, 0, 0, 0])).toBe("none");
    expect(actionAt(d, [1, 0, 1, 0])).toBe("none");
    expect(actionAt(d, [1, 1, 0, 0])).toBe("none");
  });

  it("the very first position in the document does nothing", () => {
    expect(actionAt(doc(P("only line")), [0])).toBe("none");
  });

  /* ── containers are joined by their LAST LINE, never absorbed into ───────────────────── */
  it("a paragraph after a LIST or a QUOTE joins the last line — it does not become a bullet", () => {
    expect(actionAt(doc(UL(LI("one"), LI("two")), P("after")), [1])).toBe("join-textblock");
    expect(actionAt(doc(TL(TI("one")), P("after")), [1])).toBe("join-textblock");
    expect(actionAt(doc(QUOTE(P("quoted")), P("after")), [1])).toBe("join-textblock");
  });

  it("a plain paragraph after a plain paragraph is the ordinary join, unchanged", () => {
    expect(actionAt(doc(P("one"), P("two")), [1])).toBe("join");
  });

  /* ── the property the whole table exists for ──────────────────────────────────────────── */
  it("⛔ EVERY boundary has an answer — no block start is left to whatever the default does", () => {
    const CORPUS = [
      [doc(P("a"), P("b")), [1]],
      [doc(P("a"), H("b")), [1]],
      [doc(H("a"), P("b")), [1]],
      [doc(P("a"), CODE("b")), [1]],
      [doc(P("a"), QUOTE(P("b"))), [1, 0]],
      [doc(P("a"), UL(LI("b"))), [1, 0, 0]],
      [doc(P("a"), OL(LI("b"))), [1, 0, 0]],
      [doc(P("a"), TL(TI("b"))), [1, 0, 0]],
      [doc(P("a"), UL(LI("b", UL(LI("c"))))), [1, 0, 1, 0, 0]],
      [doc(UL(LI("a")), P("b")), [1]],
      [doc(TABLE(ROW(CELL("a"))), P("b")), [1]],
      [doc(P("a"), TABLE(ROW(CELL("b")))), [1, 0, 0, 0]],
      [doc(IMG(), P("b")), [1]],
      [doc(SKETCH(), P("b")), [1]],
      [doc(P("a"), P("b", { textAlign: "right" })), [1]],
      [doc(P("a")), [0]],
    ];
    for (const [d, path] of CORPUS) {
      const v = verdictAt(d, path);
      expect(v, `no verdict for ${JSON.stringify(path)} of ${JSON.stringify(d).slice(0, 70)}`).not.toBeNull();
      expect(typeof v.action).toBe("string");
    }
  });
});
