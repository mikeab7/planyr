// NEW-1 (2026-11-13) — each Notes page keeps its own undo history across a page switch (lib/notesUndoCarry.js).
// Two Schema instances stand in for two Tiptap editors (each editor builds its own schema), because THAT is why a history object cannot be kept
// as-is: its steps hold the old schema's node types. These tests are pure ProseMirror — no DOM.
import { describe, it, expect, beforeEach } from "vitest";
import { Schema } from "@tiptap/pm/model";
import { EditorState } from "@tiptap/pm/state";
import { history, undo, redo, undoDepth, redoDepth, closeHistory } from "@tiptap/pm/history";
import {
  captureHistory, planRestore, clearCarry, carriedPages, hasCarry, docFingerprint, historyPluginOf,
  CARRY_PAGES, CARRY_EVENTS, CARRY_BYTES,
} from "../src/workspaces/notes/lib/notesUndoCarry.js";

const spec = () => ({
  nodes: {
    doc: { content: "block+" },
    paragraph: { group: "block", content: "text*", toDOM: () => ["p", 0] },
    noteAnchor: { group: "block", content: "paragraph+", attrs: { x: { default: 0 }, y: { default: 0 } }, toDOM: () => ["div", 0] },
    text: { group: "inline" },
  },
});
const newSchema = () => new Schema(spec());
const para = (t) => ({ type: "paragraph", content: t ? [{ type: "text", text: t }] : [] });
const box = (x, y, t) => ({ type: "noteAnchor", attrs: { x, y }, content: [para(t)] });
const DOC = () => ({ type: "doc", content: [box(10, 10, "alpha"), para("beta")] });

const fresh = (json, schema = newSchema()) => EditorState.create({ doc: schema.nodeFromJSON(json), plugins: [history()] });
const apply = (state, tr) => state.apply(tr);
/** type `text` at the end of the first box's paragraph as ONE undo step (closeHistory first so nothing groups with the previous edit). */
function typeInBox(state, text) {
  const pos = 1 + 1 + state.doc.child(0).child(0).content.size + 0;   // end of box > paragraph text
  let tr = closeHistory(state.tr).insertText(text, pos);
  return apply(state, tr);
}
/** delete `n` characters from the end of the first box's paragraph as one undo step. */
function deleteInBox(state, n) {
  const end = 2 + state.doc.child(0).child(0).content.size;
  return apply(state, closeHistory(state.tr).delete(end - n, end));
}
function moveBox(state, x, y) {
  return apply(state, closeHistory(state.tr).setNodeMarkup(0, null, { x, y }));
}
const run = (state, cmd) => { let s = state; cmd(s, (tr) => { s = s.apply(tr); }); return s; };
/** leave the page (park its history), come back (a NEW schema, the doc re-read from the JSON that was "stored"), restore. */
function leaveAndReturn(pageKey, state, { storedJson } = {}) {
  const parkedResult = captureHistory(pageKey, state);
  const back = fresh(storedJson || state.doc.toJSON());
  const plan = planRestore(pageKey, back);
  return { parkedResult, plan, back: plan.tr ? back.apply(plan.tr) : back };
}

beforeEach(() => clearCarry());

describe("why the history object cannot simply be kept (the red proof of the design)", () => {
  it("undoing a DELETE with another editor's schema's steps SILENTLY restores nothing — the step carries the old schema's node types", () => {
    let a = fresh(DOC());
    a = apply(a, closeHistory(a.tr).delete(0, a.doc.child(0).nodeSize));      // delete the box: its undo step holds the box NODE
    const hsA = historyPluginOf(a).getState(a);
    const b = fresh(a.doc.toJSON());                                          // a new editor: a new schema
    const b2 = b.apply(b.tr.setMeta(historyPluginOf(b).key, { historyState: hsA }));
    expect(undoDepth(b2)).toBe(1);                                            // it LOOKS carried…
    const undone = run(b2, undo);
    expect(undoDepth(undone)).toBe(0);                                        // …the undo "ran" (the step count dropped)…
    expect(undone.doc.childCount).toBe(1);                                    // …and the box did NOT come back. Measured: no error, no box.
  });
  it("the same delete through the carry module undoes cleanly", () => {
    let a = fresh(DOC());
    a = apply(a, closeHistory(a.tr).delete(0, a.doc.child(0).nodeSize));
    const { back } = leaveAndReturn("local|A", a);
    expect(run(back, undo).doc.childCount).toBe(2);
  });
});

describe("(a) typing on page A → leave → back → Ctrl+Z undoes the typing", () => {
  it("restores the undo stack against the NEW editor's schema and the undo works", () => {
    let s = fresh(DOC());
    s = typeInBox(s, " one");
    s = typeInBox(s, " two");
    expect(s.doc.textContent).toBe("alpha one twobeta");
    const { parkedResult, plan, back } = leaveAndReturn("local|A", s);
    expect(parkedResult).toMatchObject({ parked: true, done: 2 });
    expect(plan.tr).toBeTruthy();
    expect(undoDepth(back)).toBe(2);
    expect(back.schema).not.toBe(s.schema);              // a genuinely different editor
    const u1 = run(back, undo);
    expect(u1.doc.textContent).toBe("alpha onebeta");
    const u2 = run(u1, undo);
    expect(u2.doc.textContent).toBe("alphabeta");
    expect(undoDepth(u2)).toBe(0);
    expect(redoDepth(u2)).toBe(2);
  });
  it("redo works too, and a fresh edit after returning is its own undo step", () => {
    let s = fresh(DOC());
    s = typeInBox(s, " one");
    s = run(s, undo);                                    // alphabeta, redo stack = 1
    const { back } = leaveAndReturn("local|A", s);
    expect(redoDepth(back)).toBe(1);
    expect(run(back, redo).doc.textContent).toBe("alpha onebeta");
    const typed = typeInBox(back, "?");
    expect(undoDepth(typed)).toBe(1);                    // the new edit did not merge into anything
    expect(redoDepth(typed)).toBe(0);                    // and a new edit clears redo, as ever
  });
});

describe("(b) a box move survives the switch", () => {
  it("Ctrl+Z puts the box back where it was", () => {
    let s = fresh(DOC());
    s = moveBox(s, 200, 300);
    s = moveBox(s, 250, 320);
    const { back } = leaveAndReturn("local|A", s);
    expect(back.doc.child(0).attrs).toMatchObject({ x: 250, y: 320 });
    const u1 = run(back, undo);
    expect(u1.doc.child(0).attrs).toMatchObject({ x: 200, y: 300 });
    const u2 = run(u1, undo);
    expect(u2.doc.child(0).attrs).toMatchObject({ x: 10, y: 10 });
  });
  it("a box DELETE and a mix of edits all come back in order", () => {
    let s = fresh(DOC());
    s = typeInBox(s, "+");
    s = apply(s, closeHistory(s.tr).delete(0, s.doc.child(0).nodeSize));   // delete the whole box
    expect(s.doc.childCount).toBe(1);
    const { back } = leaveAndReturn("local|A", s);
    const u1 = run(back, undo);
    expect(u1.doc.childCount).toBe(2);
    expect(u1.doc.textContent).toBe("alpha+beta");
    expect(run(u1, undo).doc.textContent).toBe("alphabeta");
  });
});

describe("(c) one page's history never touches another's", () => {
  it("keeps separate entries per page, and Ctrl+Z on B does not undo A", () => {
    let a = fresh(DOC());
    a = typeInBox(a, "-A");
    let b = fresh(DOC());
    b = typeInBox(b, "-B1"); b = typeInBox(b, "-B2");
    captureHistory("local|A", a);
    captureHistory("local|B", b);
    expect(carriedPages()).toEqual(["local|A", "local|B"]);
    const a2 = fresh(a.doc.toJSON()); const planA = planRestore("local|A", a2);
    const aBack = a2.apply(planA.tr);
    const b2 = fresh(b.doc.toJSON()); const planB = planRestore("local|B", b2);
    const bBack = b2.apply(planB.tr);
    expect(undoDepth(aBack)).toBe(1);
    expect(undoDepth(bBack)).toBe(2);
    expect(run(bBack, undo).doc.textContent).toBe("alphabeta-B1".replace("alphabeta-B1", "alpha-B1beta"));
    expect(aBack.doc.textContent).toBe("alpha-Abeta");   // B's undo left A's document alone
  });
  it("an entry is consumed when it is used (a page is opened once per park)", () => {
    let s = fresh(DOC()); s = typeInBox(s, "x");
    captureHistory("local|A", s);
    planRestore("local|A", fresh(s.doc.toJSON()));
    expect(hasCarry("local|A")).toBe(false);
  });
});

describe("(d) the page changed while it was away → the saved history is DISCARDED, never replayed", () => {
  it("different stored document (another tab / computer / version restore / conflict choice)", () => {
    let s = fresh(DOC()); s = typeInBox(s, " mine");
    const changed = { type: "doc", content: [box(10, 10, "alpha mine"), para("beta CHANGED ELSEWHERE")] };
    const { parkedResult, plan, back } = leaveAndReturn("local|A", s, { storedJson: changed });
    expect(parkedResult.parked).toBe(true);
    expect(plan.tr).toBe(null);
    expect(plan.reason).toBe("page-changed");
    expect(undoDepth(back)).toBe(0);
    expect(hasCarry("local|A")).toBe(false);           // and it is gone, not waiting for the next visit to be replayed against a worse match
  });
  it("a one-character difference is enough", () => {
    let s = fresh(DOC()); s = typeInBox(s, "x");
    const j = s.doc.toJSON(); j.content[1].content[0].text = "betA";
    expect(leaveAndReturn("local|A", s, { storedJson: j }).plan.reason).toBe("page-changed");
  });
  it("the fingerprint is stable for equal documents and different for different ones", () => {
    const a = fresh(DOC()); const b = fresh(DOC());
    expect(docFingerprint(a.doc)).toBe(docFingerprint(b.doc));
    expect(docFingerprint(a.doc)).not.toBe(docFingerprint(typeInBox(a, "q").doc));
  });
});

describe("edge cases", () => {
  it("a page with no edits parks nothing and says so", () => {
    expect(captureHistory("local|A", fresh(DOC()))).toMatchObject({ parked: false, reason: "nothing-to-keep" });
    expect(planRestore("local|A", fresh(DOC())).reason).toBe("none-parked");
  });
  it("a state with no history plugin is a clean no-op", () => {
    const s = EditorState.create({ doc: newSchema().nodeFromJSON(DOC()) });
    expect(captureHistory("local|A", s)).toMatchObject({ parked: false, reason: "no-history-plugin" });
  });
  it("edits kept OUT of history (addToHistory:false — the box auto-size / preview class) between undoable ones still map right", () => {
    let s = fresh(DOC());
    s = typeInBox(s, " one");
    s = apply(s, s.tr.setNodeMarkup(0, null, { x: 10, y: 99 }).setMeta("addToHistory", false));   // a housekeeping write
    s = typeInBox(s, " two");
    const { back } = leaveAndReturn("local|A", s);
    const u1 = run(back, undo);
    expect(u1.doc.textContent).toBe("alpha onebeta");
    const u2 = run(u1, undo);
    expect(u2.doc.textContent).toBe("alphabeta");
    expect(u2.doc.child(0).attrs.y).toBe(99);            // the housekeeping write was not undone, as in the original editor
  });
  it("a step that cannot be revived drops that page's history instead of throwing", () => {
    let s = fresh(DOC()); s = typeInBox(s, "x");
    captureHistory("local|A", s);
    // A schema that lacks the box node: reviving a box step must fail cleanly.
    const lean = new Schema({ nodes: { doc: { content: "block+" }, paragraph: { group: "block", content: "text*" }, text: { group: "inline" } } });
    const back = EditorState.create({ doc: lean.nodeFromJSON({ type: "doc", content: [para("alphax"), para("beta")] }), plugins: [history()] });
    const plan = planRestore("local|A", back);
    expect(plan.tr).toBe(null);
  });
});

describe("the caps — the 'no bloat' decision", () => {
  it("keeps at most CARRY_PAGES pages, dropping the least recently parked", () => {
    for (let i = 0; i < CARRY_PAGES + 3; i += 1) { let s = fresh(DOC()); s = typeInBox(s, String(i)); captureHistory(`local|P${i}`, s); }
    expect(carriedPages()).toHaveLength(CARRY_PAGES);
    expect(hasCarry("local|P0")).toBe(false);
    expect(hasCarry(`local|P${CARRY_PAGES + 2}`)).toBe(true);
  });
  it("re-parking a page makes it the most recent", () => {
    for (let i = 0; i < CARRY_PAGES; i += 1) { let s = fresh(DOC()); s = typeInBox(s, "x"); captureHistory(`local|P${i}`, s); }
    let s = fresh(DOC()); s = typeInBox(s, "x"); captureHistory("local|P0", s);
    let t = fresh(DOC()); t = typeInBox(t, "y"); captureHistory("local|NEW", t);
    expect(hasCarry("local|P0")).toBe(true);
    expect(hasCarry("local|P1")).toBe(false);
  });
  it("keeps at most CARRY_EVENTS undo steps per page, oldest dropped first, and the newest ones still undo correctly", () => {
    let s = fresh(DOC());
    const N = CARRY_EVENTS + 20;
    for (let i = 0; i < N; i += 1) s = moveBox(s, i + 1, i + 1);
    const r = captureHistory("local|A", s);
    expect(r.done).toBe(CARRY_EVENTS);
    const target = fresh(s.doc.toJSON());
    const plan = planRestore("local|A", target);
    let back = target.apply(plan.tr);
    expect(undoDepth(back)).toBe(CARRY_EVENTS);
    for (let i = 0; i < 3; i += 1) back = run(back, undo);
    expect(back.doc.child(0).attrs.x).toBe(N - 3);
  });
  it("drops the oldest steps when a page's steps are over the byte cap, and keeps the newest", () => {
    const big = "z".repeat(Math.floor(CARRY_BYTES / 3));
    let s = fresh({ type: "doc", content: [box(10, 10, big.repeat(8)), para("beta")] });
    for (let i = 0; i < 6; i += 1) s = deleteInBox(s, big.length);               // an undo step of a delete re-holds the deleted text
    const r = captureHistory("local|A", s);
    expect(r.parked).toBe(true);
    expect(r.done).toBeLessThan(6);
    expect(r.done).toBeGreaterThan(0);
  });
  it("one step bigger than the whole cap parks nothing rather than half a history", () => {
    let s = fresh({ type: "doc", content: [box(10, 10, "q".repeat(CARRY_BYTES + 100)), para("beta")] });
    s = deleteInBox(s, CARRY_BYTES + 50);
    expect(captureHistory("local|A", s)).toMatchObject({ parked: false });
  });
});
