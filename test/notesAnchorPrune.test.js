/* AN ABANDONED DOUBLE-CLICK LEAVES NOTHING BEHIND — and the reader reads what the row promised.
 *
 * ⛔ THE FIRST FAILURE, reproduced by the owner five times on a scratch page. Double-click
 * blank space, type nothing: the `noteAnchor` was committed to the document the instant it was
 * pressed. All five persisted to storage with x/y/w and no text, and survived a reload.
 *
 * ⛔ AND THAT LITTER IS THE "INTERMITTENCY", which is the part worth writing down. An empty
 * block draws nothing you can see and STILL occupies its box and STILL takes the press. So the
 * second attempt at a spot you already tried lands inside the first attempt's invisible
 * leftover and appears to do nothing at all. It fails exactly where somebody already tried
 * once and gave up — which is what "it works intermittently" turned out to mean.
 *
 * ⛔ THE SECOND FAILURE, confirmed from the database rather than guessed: the bin row for DEV
 * COORDINATION showed real text and "656 characters", and pressing Read it showed a heading
 * and nothing else. DEV COORDINATION is the CONTAINER (`sec_ms8z7vik5yj3mf1`) and has no row
 * in `notes_pages` at all; its words live in the child `pg_ms8z7vik4vejfpp`. The list was
 * reading the child and the reader was opening the parent.
 */
import { beforeEach, describe, expect, it } from "vitest";

import {
  anchorIsEmpty, countEmptyAnchors, pruneEmptyAnchors,
} from "../src/workspaces/notes/lib/notesAnchorPrune.js";
import { addPage, deleteNode, emptyTree } from "../src/workspaces/notes/lib/notesModel.js";
import { ANCHOR_EDGE_PAD, ANCHOR_MIN_WIDTH, fitAnchorBox } from "../src/workspaces/notes/lib/notesAnchorNode.js";

const mem = new Map();
globalThis.window = globalThis.window || {};
globalThis.window.localStorage = {
  get length() { return mem.size; },
  key: (i) => [...mem.keys()][i] ?? null,
  getItem: (k) => (mem.has(k) ? mem.get(k) : null),
  setItem: (k, v) => { mem.set(k, String(v)); },
  removeItem: (k) => { mem.delete(k); },
  clear: () => mem.clear(),
};
const store = await import("../src/workspaces/notes/lib/notesStore.js");

const anchor = (content) => ({ type: "noteAnchor", attrs: { x: 100, y: 200, w: 180 }, content });
const para = (text) => ({ type: "paragraph", ...(text ? { content: [{ type: "text", text }] } : {}) });
const doc = (...content) => ({ type: "doc", content });

beforeEach(() => { mem.clear(); });

describe("anchorIsEmpty — the one definition, used by the screen AND by storage", () => {
  it("a block with nothing but an empty paragraph is empty — the abandoned gesture", () => {
    expect(anchorIsEmpty(anchor([para()]))).toBe(true);
  });

  it("…and so is one whose paragraphs hold only whitespace", () => {
    expect(anchorIsEmpty(anchor([para("   "), para("\n\t")]))).toBe(true);
  });

  it("⛔ ONE CHARACTER MAKES IT REAL", () => {
    expect(anchorIsEmpty(anchor([para("a")]))).toBe(false);
  });

  it("⛔ A PICTURE IS CONTENT even with no text beside it", () => {
    expect(anchorIsEmpty(anchor([{ type: "noteImage", attrs: { imageId: "img1" } }]))).toBe(false);
  });

  it("⛔ AN ATTACHMENT IS CONTENT", () => {
    expect(anchorIsEmpty(anchor([{ type: "noteAttachment", attrs: { assetId: "f1" } }]))).toBe(false);
  });

  it("⛔ AND SO IS A NODE TYPE THIS FILE HAS NEVER HEARD OF — the whitelist refuses to guess", () => {
    expect(anchorIsEmpty(anchor([{ type: "someFutureThing", attrs: {} }]))).toBe(false);
    expect(anchorIsEmpty(anchor([{ type: "heading", content: [] }]))).toBe(false);
  });

  it("only ever answers about a noteAnchor", () => {
    expect(anchorIsEmpty(para())).toBe(false);
    expect(anchorIsEmpty(null)).toBe(false);
  });
});

describe("pruneEmptyAnchors", () => {
  it("takes the abandoned blocks and leaves the writing alone", () => {
    const d = doc(para("Existing line."), anchor([para()]), anchor([para("Bain follow-ups")]), anchor([para(" ")]));
    const { doc: out, removed } = pruneEmptyAnchors(d);
    expect(removed).toBe(2);
    expect(out.content).toHaveLength(2);
    expect(out.content[1].content[0].content[0].text).toBe("Bain follow-ups");
    expect(out.content[0].content[0].text).toBe("Existing line.");
  });

  it("⛔ RETURNS THE VERY SAME OBJECT WHEN THERE IS NOTHING TO DO — identity is load-bearing", () => {
    // This runs inside the save path; a fresh deep copy per keystroke would turn every no-op
    // save into a change for everything downstream that compares documents.
    const d = doc(para("Nothing to prune."), anchor([para("real")]));
    const r = pruneEmptyAnchors(d);
    expect(r.doc).toBe(d);
    expect(r.removed).toBe(0);
  });

  it("finds one nested inside another block, not only at the top level", () => {
    const d = doc({ type: "noteCallout", content: [anchor([para()]), para("kept")] });
    const { doc: out, removed } = pruneEmptyAnchors(d);
    expect(removed).toBe(1);
    expect(out.content[0].content).toHaveLength(1);
  });

  it("counts without changing anything", () => {
    expect(countEmptyAnchors(doc(anchor([para()]), anchor([para()]), anchor([para("x")])))).toBe(2);
    expect(countEmptyAnchors(doc(para("plain")))).toBe(0);
  });

  it("survives junk rather than throwing — a save path may never crash on a shape", () => {
    expect(pruneEmptyAnchors(null).removed).toBe(0);
    expect(pruneEmptyAnchors({ type: "doc" }).removed).toBe(0);
    expect(countEmptyAnchors(undefined)).toBe(0);
  });
});

describe("⛔ THE STORAGE SEAM REFUSES TO WRITE ONE — which is what makes it provisional", () => {
  it("an abandoned block never reaches storage, however it got to the save", () => {
    store.writePage("p1", doc(para("Real writing."), anchor([para()])));
    const back = store.readPage("p1");
    expect(back.content).toHaveLength(1);
    expect(countEmptyAnchors(back)).toBe(0);
  });

  it("…and one that was typed into is written exactly as it is", () => {
    store.writePage("p2", doc(para("Line."), anchor([para("kept")])));
    const back = store.readPage("p2");
    expect(back.content).toHaveLength(2);
    expect(back.content[1].attrs).toMatchObject({ x: 100, y: 200 });
  });

  it("the one-time sweep cleans notes that are ALREADY carrying them, and touches nothing else", () => {
    mem.set("planyr:notes:page:v1:local:dirty", JSON.stringify(doc(para("Words."), anchor([para()]), anchor([para()]))));
    mem.set("planyr:notes:page:v1:local:clean", JSON.stringify(doc(para("Words."))));
    const cleanBefore = mem.get("planyr:notes:page:v1:local:clean");
    const r = store.sweepEmptyAnchors(["dirty", "clean", "missing"]);
    expect(r).toEqual({ pages: 1, removed: 2 });
    expect(countEmptyAnchors(store.readPage("dirty"))).toBe(0);
    expect(store.readPage("dirty").content).toHaveLength(1);
    // Byte-identical: a page with nothing to remove is not rewritten at all.
    expect(mem.get("planyr:notes:page:v1:local:clean")).toBe(cleanBefore);
  });

  it("…and a second sweep over the same pages is a no-op", () => {
    mem.set("planyr:notes:page:v1:local:a", JSON.stringify(doc(anchor([para()]))));
    store.sweepEmptyAnchors(["a"]);
    expect(store.sweepEmptyAnchors(["a"])).toEqual({ pages: 0, removed: 0 });
  });
});

describe("⛔ THE BIN READER READS WHAT THE ROW PROMISED", () => {
  /** His exact shape: a container with no body of its own, whose words live in its child. */
  const container = () => {
    let t = emptyTree();
    t = addPage(t, { id: "sec", title: "DEV COORDINATION" }).tree;
    t = addPage(t, { id: "pg", title: "Coordination", parentId: "sec" }).tree;
    store.writePage("pg", doc(para("Civil working to include irrigation line.")));
    return deleteNode(t, "sec").tree;
  };

  it("the preview and the reading list come from the SAME page — the container has no body", () => {
    const [row] = store.collectBinFacts(container(), []);
    expect(row.preview).toContain("irrigation line");
    expect(row.reading.map((r) => r.pageId)).toEqual(["pg"]);
    expect(row.pageId).toBe("pg");                    // never blindly pageIds[0], which is "sec"
    expect(row.reading[0].chars).toBe(row.chars);
  });

  it("a single page with words reads as itself", () => {
    let t = addPage(emptyTree(), { id: "solo", title: "Solo" }).tree;
    store.writePage("solo", doc(para("Just this.")));
    const [row] = store.collectBinFacts(deleteNode(t, "solo").tree, []);
    expect(row.reading.map((r) => r.pageId)).toEqual(["solo"]);
  });

  it("a container with SEVERAL children reads all of them, in order, and names each", () => {
    let t = emptyTree();
    t = addPage(t, { id: "sec", title: "Parent" }).tree;
    t = addPage(t, { id: "k1", title: "One", parentId: "sec" }).tree;
    t = addPage(t, { id: "k2", title: "Two", parentId: "sec" }).tree;
    store.writePage("k1", doc(para("First child.")));
    store.writePage("k2", doc(para("Second child.")));
    const [row] = store.collectBinFacts(deleteNode(t, "sec").tree, []);
    expect(row.reading.map((r) => r.pageId)).toEqual(["k1", "k2"]);
    expect(row.reading.map((r) => r.title)).toEqual(["One", "Two"]);
    expect(row.preview).toContain("First child.");   // the preview is the first of them
  });

  it("a container whose only child is PURGED offers nothing to read, and says which fact that is", () => {
    let t = emptyTree();
    t = addPage(t, { id: "sec", title: "Parent" }).tree;
    t = addPage(t, { id: "k1", title: "One", parentId: "sec" }).tree;
    const binned = deleteNode(t, "sec").tree;        // no bodies were ever written
    const [row] = store.collectBinFacts(binned, []);
    expect(row.reading).toEqual([]);
    expect(row.gone).toBe(true);                      // NOT "nothing was ever written in it"
    expect(row.empty).toBe(true);
  });

  it("⛔ AND “NEVER WRITTEN” IS A DIFFERENT ROW FROM “PURGED” — they are opposite facts", () => {
    let t = addPage(emptyTree(), { id: "blank", title: "Blank" }).tree;
    store.writePage("blank", doc(para("")));          // a real, empty body on this device
    const [row] = store.collectBinFacts(deleteNode(t, "blank").tree, []);
    expect(row.empty).toBe(true);
    expect(row.gone).toBe(false);
  });
});

/* ⛔ A BOX THAT FITS THE ROOM IT ACTUALLY HAS (B421490).
 *
 * `placeAnchor` spends the WIDTH to keep the LEFT EDGE somebody chose, and only moves that edge
 * past the point where a column would be unreadable anyway. That rule ran at PLACEMENT only —
 * so narrowing the window, or opening the History panel, or opening the same note on a smaller
 * screen, left a box hanging off the end of the sheet, where the outline panel paints over it
 * and takes its presses. Measured on a narrow window: a box's delete button and its width handle
 * both answered `note-outline` instead of themselves.
 *
 * `fitAnchorBox` is the same rule at RENDER. The STORED attributes are deliberately untouched —
 * widening the window must give back exactly what was asked for, not a number that suited one
 * screen and quietly overwrote the intent.
 */
describe("fitAnchorBox — the render-time fit (B421490)", () => {
  it("leaves a box alone when there is room for it", () => {
    expect(fitAnchorBox({ x: 60, w: 200, hostWidth: 800 })).toEqual({ x: 60, w: 200 });
  });

  /* ⛔ AMENDED (NEW-RIGHT-EDGE). The LEFT EDGE half is unchanged and is the guarantee that
   * matters. The width no longer collapses into whatever room is left — that is what produced a
   * one-character-wide box against the right margin — so a block may overhang and THE PAGE GROWS
   * to hold it (`anchorExtentX`), exactly as it already grows downward. */
  it("keeps the LEFT EDGE when the room runs short, and stops at the usable floor", () => {
    const fit = fitAnchorBox({ x: 340, w: 180, hostWidth: 420 });
    expect(fit.x).toBe(340);                    // the edge he chose is kept
    expect(fit.w).toBe(ANCHOR_MIN_WIDTH);       // a column, not a sliver
    expect(fit.w).toBeGreaterThan(420 - 340 - ANCHOR_EDGE_PAD);   // wider than the room, on purpose
  });

  it("never renders narrower than the readable floor", () => {
    const fit = fitAnchorBox({ x: 100, w: 300, hostWidth: 120 });
    expect(fit.w).toBe(ANCHOR_MIN_WIDTH);
  });

  /* ⛔ THIS CASE ONCE ASSERTED THE OPPOSITE, AND THE OPPOSITE WAS A REGRESSION. The first version
   * moved the left edge "just enough to stay reachable" once the width hit its floor, following a
   * sentence in `placeAnchor`'s header. `verify-notes-anchor-zoom` — the owner's own acceptance
   * test for B350000 — went red inside the hour: a click at x=760 stored 751. A clamping band is
   * a clamping band whatever justifies it, and this module has paid for that lesson once. */
  it("⛔ NEVER MOVES THE LEFT EDGE — not even when the width is already at its floor", () => {
    expect(fitAnchorBox({ x: 900, w: 200, hostWidth: 300 })).toEqual({ x: 900, w: ANCHOR_MIN_WIDTH });
    expect(fitAnchorBox({ x: 760, w: 180, hostWidth: 795 }).x).toBe(760);
    for (let x = 0; x <= 1200; x += 20) {
      expect(fitAnchorBox({ x, w: 180, hostWidth: 800 }).x, `x=${x}`).toBe(x);
    }
  });

  it("never shrinks on a GUESS — an unmeasured host returns what it was given", () => {
    expect(fitAnchorBox({ x: 340, w: 180, hostWidth: 0 })).toEqual({ x: 340, w: 180 });
    expect(fitAnchorBox({ x: 340, w: 180, hostWidth: undefined })).toEqual({ x: 340, w: 180 });
  });

  it("is IDEMPOTENT — re-fitting an already-fitted box changes nothing", () => {
    const once = fitAnchorBox({ x: 340, w: 180, hostWidth: 420 });
    expect(fitAnchorBox({ ...once, hostWidth: 420 })).toEqual(once);
  });

  it("gives the full width back when the room returns, because the STORE was never touched", () => {
    const narrow = fitAnchorBox({ x: 340, w: 180, hostWidth: 420 });
    expect(narrow.w).toBeLessThan(180);
    expect(fitAnchorBox({ x: 340, w: 180, hostWidth: 900 })).toEqual({ x: 340, w: 180 });
  });
});
