/* notesBlockMerge — the per-paragraph 3-way merge behind NEW-1 ("like we do on the site
 * planner… both the edits go in"). PURE: raw ProseMirror JSON in, raw ProseMirror JSON out,
 * no DOM, no editor, no network.
 *
 * ⛔ THE RED-PROOF THE DISPATCH BRIEF ASKED FOR lives in the first `describe` block below:
 * it shows `judgeConflict` (today's ONLY conflict decision, unchanged by this file) calling
 * two independently-edited paragraphs "diverged" — the whole-document pick-one banner, with
 * no way to land both edits — and then shows `mergeNoteDocs` resolving the exact same three
 * documents with both edits present and nothing flagged. That contrast is the feature.
 */
import { describe, it, expect } from "vitest";
import { mergeNoteDocs } from "../src/workspaces/notes/lib/notesBlockMerge.js";
import { flattenBlocks } from "../src/workspaces/notes/lib/notesRedline.js";
import { judgeConflict } from "../src/workspaces/notes/lib/notesCloud.js";

const doc = (...content) => ({ type: "doc", content });
const p = (text) => ({ type: "paragraph", content: text ? [{ type: "text", text }] : [] });
const h = (level, text) => ({ type: "heading", attrs: { level }, content: [{ type: "text", text }] });
const li = (child, indent) => ({ type: "listItem", attrs: indent ? { indent } : { indent: 0 }, content: [child] });
const bulletList = (...items) => ({ type: "bulletList", content: items });
const toggle = (title, open, ...content) => ({
  type: "noteToggle",
  attrs: { open: !!open },
  content: [{ type: "noteToggleTitle", content: title ? [{ type: "text", text: title }] : [] }, ...content],
});

/** Every leaf's plain text, in document order — the cheapest honest way to assert "what does
 *  this document actually say" without re-implementing a serializer in the test file. */
const words = (d) => flattenBlocks(d).filter((b) => !b.opaque).map((b) => b.runs.map((r) => r.text).join(""));

describe("RED-PROOF — the whole-document banner is what main does today; this file is the fix", () => {
  it("judgeConflict calls two independently-edited paragraphs 'diverged' (the pick-one banner)", () => {
    const base = doc(p("Utility Facilities"), p("Water Authority"), p("Sanitary — Discharge Permit"));
    const local = doc(p("Utility Facilities — MUD 377"), p("Water Authority"), p("Sanitary — Discharge Permit"));
    const server = doc(p("Utility Facilities"), p("Water Authority"), p("Sanitary — Discharge Permit — filed"));
    const verdict = judgeConflict({ localDoc: local, serverDoc: server });
    expect(verdict.silent).toBe(false);
    expect(verdict.why).toBe("diverged");
  });

  it("mergeNoteDocs resolves the SAME three documents with both edits present, no conflict", () => {
    const base = doc(p("Utility Facilities"), p("Water Authority"), p("Sanitary — Discharge Permit"));
    const local = doc(p("Utility Facilities — MUD 377"), p("Water Authority"), p("Sanitary — Discharge Permit"));
    const server = doc(p("Utility Facilities"), p("Water Authority"), p("Sanitary — Discharge Permit — filed"));
    const result = mergeNoteDocs({ baseDoc: base, localDoc: local, serverDoc: server });
    expect(result.clean).toBe(true);
    expect(words(result.mergedDoc)).toEqual([
      "Utility Facilities — MUD 377",
      "Water Authority",
      "Sanitary — Discharge Permit — filed",
    ]);
  });
});

describe("mergeNoteDocs — independent edits", () => {
  it("edits to different paragraphs both land, in order", () => {
    const base = doc(p("one"), p("two"), p("three"), p("four"));
    const local = doc(p("ONE"), p("two"), p("three"), p("four"));
    const server = doc(p("one"), p("two"), p("THREE"), p("four"));
    const r = mergeNoteDocs({ baseDoc: base, localDoc: local, serverDoc: server });
    expect(r.clean).toBe(true);
    expect(words(r.mergedDoc)).toEqual(["ONE", "two", "THREE", "four"]);
  });

  it("an insertion by one side and an edit by the other both land", () => {
    const base = doc(p("one"), p("two"));
    const local = doc(p("one"), p("inserted by local"), p("two"));
    const server = doc(p("one"), p("TWO"));
    const r = mergeNoteDocs({ baseDoc: base, localDoc: local, serverDoc: server });
    expect(r.clean).toBe(true);
    expect(words(r.mergedDoc)).toEqual(["one", "inserted by local", "TWO"]);
  });

  it("a deletion by one side and an untouched other paragraph both apply", () => {
    const base = doc(p("one"), p("two"), p("three"));
    const local = doc(p("one"), p("three"));      // local deleted "two"
    const server = doc(p("one"), p("two"), p("THREE"));  // server edited "three"
    const r = mergeNoteDocs({ baseDoc: base, localDoc: local, serverDoc: server });
    expect(r.clean).toBe(true);
    expect(words(r.mergedDoc)).toEqual(["one", "THREE"]);
  });

  it("both sides deleting the SAME paragraph is not a conflict", () => {
    const base = doc(p("one"), p("two"), p("three"));
    const local = doc(p("one"), p("three"));
    const server = doc(p("one"), p("three"));
    const r = mergeNoteDocs({ baseDoc: base, localDoc: local, serverDoc: server });
    expect(r.clean).toBe(true);
    expect(words(r.mergedDoc)).toEqual(["one", "three"]);
  });

  it("both sides making the IDENTICAL edit is not a conflict", () => {
    const base = doc(p("one"), p("two"));
    const local = doc(p("ONE"), p("two"));
    const server = doc(p("ONE"), p("two"));
    const r = mergeNoteDocs({ baseDoc: base, localDoc: local, serverDoc: server });
    expect(r.clean).toBe(true);
    expect(words(r.mergedDoc)).toEqual(["ONE", "two"]);
  });

  it("edits at opposite ends of a longer note all land together", () => {
    const base = doc(h(1, "Title"), p("a"), p("b"), p("c"), p("d"), p("e"));
    const local = doc(h(1, "Title — v2"), p("a"), p("b"), p("c"), p("d"), p("e"));
    const server = doc(h(1, "Title"), p("a"), p("b"), p("c"), p("d"), p("e — done"));
    const r = mergeNoteDocs({ baseDoc: base, localDoc: local, serverDoc: server });
    expect(r.clean).toBe(true);
    expect(words(r.mergedDoc)).toEqual(["Title — v2", "a", "b", "c", "d", "e — done"]);
  });
});

describe("mergeNoteDocs — real, same-block conflicts still resolve to one side and name the loser", () => {
  it("the same paragraph edited two different ways is a real conflict", () => {
    const base = doc(p("one"), p("two"));
    const local = doc(p("one — local"), p("two"));
    const server = doc(p("one — server"), p("two"));
    const r = mergeNoteDocs({ baseDoc: base, localDoc: local, serverDoc: server });
    expect(r.clean).toBe(false);
    expect(words(r.mineDoc)).toEqual(["one — local", "two"]);
    expect(words(r.theirsDoc)).toEqual(["one — server", "two"]);
  });

  it("⛔ SAFETY NET: an asymmetric conflict cluster never drops a paragraph neither side actually disputed", () => {
    // Server's edit spans TWO adjacent paragraphs as one hunk (nothing "same" separates them);
    // local's edit only touches the FIRST of those two. The two hunks' base ranges overlap, so
    // they cluster into one conflict — but paragraph 2 is not itself in dispute: local never
    // touched it. Naively concatenating "each side's own replacement blocks" for the whole
    // cluster silently drops paragraph 2 from the "mine" candidate entirely (found by this
    // file's own two-client integration test, not invented in advance).
    const base = doc(p("one"), p("two"), p("three"));
    const local = doc(p("ONE"), p("two"), p("three — filed"));            // touches 1 and 3 only
    const server = doc(p("one — server"), p("TWO — server"), p("three")); // touches 1 and 2, one hunk
    const r = mergeNoteDocs({ baseDoc: base, localDoc: local, serverDoc: server });
    expect(r.clean).toBe(false);
    // "mine" keeps paragraph 2 exactly as base/local always had it — never adopting server's
    // edit to a paragraph local did not touch, and never simply omitting it.
    expect(words(r.mineDoc)).toEqual(["ONE", "two", "three — filed"]);
    expect(words(r.theirsDoc)).toEqual(["one — server", "TWO — server", "three — filed"]);
  });

  it("a conflict on one paragraph does not swallow a clean edit elsewhere", () => {
    const base = doc(p("one"), p("two"), p("three"));
    const local = doc(p("one — local"), p("two"), p("THREE"));
    const server = doc(p("one — server"), p("two"), p("THREE"));
    const r = mergeNoteDocs({ baseDoc: base, localDoc: local, serverDoc: server });
    expect(r.clean).toBe(false);
    // Both candidates carry the SAME (non-conflicting) edit to "three" — only the disputed
    // paragraph differs between them, which is what lets the existing redline UI show just
    // the real disagreement instead of the whole document.
    expect(words(r.mineDoc)).toEqual(["one — local", "two", "THREE"]);
    expect(words(r.theirsDoc)).toEqual(["one — server", "two", "THREE"]);
  });

  it("⛔ SAFETY NET: a delete-vs-edit on the same paragraph is a conflict, never a silent delete", () => {
    const base = doc(p("one"), p("keep this text"));
    const local = doc(p("one"));                                   // local deleted paragraph 2
    const server = doc(p("one"), p("keep this text — expanded"));  // server edited it
    const r = mergeNoteDocs({ baseDoc: base, localDoc: local, serverDoc: server });
    expect(r.clean).toBe(false);
    expect(words(r.mineDoc)).toEqual(["one"]);                       // the delete, as one candidate
    expect(words(r.theirsDoc)).toEqual(["one", "keep this text — expanded"]); // never silently lost
  });
});

describe("mergeNoteDocs — list items, including an indent-only change", () => {
  it("an indent change (Tab/Shift-Tab) on one item merges silently with an edit to a sibling item", () => {
    const base = doc(bulletList(li(p("Engineer")), li(p("Dustin O'Neal"))));
    const local = doc(bulletList(li(p("Engineer")), li(p("Dustin O'Neal"), 1))); // indented, same text
    const server = doc(bulletList(li(p("Engineer — Pape Dawson")), li(p("Dustin O'Neal"))));
    const r = mergeNoteDocs({ baseDoc: base, localDoc: local, serverDoc: server });
    expect(r.clean).toBe(true);
    expect(words(r.mergedDoc)).toEqual(["Engineer — Pape Dawson", "Dustin O'Neal"]);
  });

  it("an indent-only change is a real edit, not invisible litter — the same item conflicts if both sides touch it", () => {
    const base = doc(bulletList(li(p("Dustin O'Neal"))));
    const local = doc(bulletList(li(p("Dustin O'Neal"), 1)));         // local: indent only
    const server = doc(bulletList(li(p("Dustin O'Neal (Engineer)")))); // server: text only
    const r = mergeNoteDocs({ baseDoc: base, localDoc: local, serverDoc: server });
    expect(r.clean).toBe(false);
  });

  it("a toggle's open/closed state is not itself a conflict signal (UI state, not content)", () => {
    // The toggle's title lives on the wrapper (`flattenBlocks` never flattens it as a leaf),
    // so `words()` — which only walks LEAF blocks — sees just the body paragraph here; the
    // title's own survival is asserted separately below, straight off the merged JSON.
    const base = doc(toggle("Section", false, p("body")));
    const local = doc(toggle("Section", true, p("body")));    // local just opened it
    const server = doc(toggle("Section", false, p("body — edited")));
    const r = mergeNoteDocs({ baseDoc: base, localDoc: local, serverDoc: server });
    expect(r.clean).toBe(true);
    expect(words(r.mergedDoc)).toEqual(["body — edited"]);
    const toggleNode = r.mergedDoc.content[0];
    expect(toggleNode.type).toBe("noteToggle");
    expect(toggleNode.content[0].content[0].text).toBe("Section");
  });
});

describe("mergeNoteDocs — declines cleanly when it cannot run at all", () => {
  it("returns null with no base (the caller falls back to the existing pick-one banner)", () => {
    const local = doc(p("a"));
    const server = doc(p("b"));
    expect(mergeNoteDocs({ baseDoc: null, localDoc: local, serverDoc: server })).toBe(null);
  });
});
