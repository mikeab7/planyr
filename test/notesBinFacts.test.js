/* Notes, block three — THE BIN YOU CAN JUDGE, AND THE BANNER THAT CAN BE SATISFIED.
 *
 * Two owner reports, both about being shown something he could not act on:
 *
 *   • THE BIN. Verbatim: *"figure out the bin thing because there is, like, a bunch of items
 *     in there, but I cannot even see it. Like, if I wanted to check to see if I should keep
 *     it, I cannot."* Twenty-one entries, sixteen of them named "Untitled page", each showing
 *     a title and a countdown and nothing else — so the only way to find out what one WAS, was
 *     to restore it into the live tree and delete it again.
 *   • THE DUPLICATE BANNER. It reported *"“Coordination” in Grand Port · “Page 1” in a project
 *     that no longer exists (in the bin)"* — one copy already binned, the other's project
 *     deleted a week earlier. Nothing to do, and Dismiss the only exit. A banner that cannot
 *     be satisfied teaches you to dismiss the one that will one day be real.
 *
 * Both are decided in code that reads BODIES, so they live at the storage seam rather than in
 * the pure model — and are exercised here through the real seam against a real (in-memory)
 * localStorage, never a mock of the module under test.
 */
import { beforeEach, describe, expect, it } from "vitest";

import { deleteNode, emptyTree, addPage } from "../src/workspaces/notes/lib/notesModel.js";

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
const scan = await import("../src/workspaces/notes/lib/notesScan.js");

const para = (text) => ({ type: "doc", content: [{ type: "paragraph", content: text ? [{ type: "text", text }] : [] }] });

/** A tree with three named pages, their bodies written through the real store. */
function seeded() {
  let t = emptyTree();
  for (const [id, title, projectId] of [["a", "Coordination", "P1"], ["b", "Untitled page", "P2"], ["c", "Untitled page", null]]) {
    const r = addPage(t, { id, title, projectId });
    t = r.tree;
  }
  store.writePage("a", para("Bain coordination meeting: dock doors, trailer parking, and the fire lane."));
  store.writePage("b", para("Bain coordination meeting: dock doors, trailer parking, and the fire lane."));
  store.writePage("c", para(""));
  return t;
}

beforeEach(() => { mem.clear(); });

describe("collectBinFacts — what is actually in the bin (NEW-3)", () => {
  it("⛔ CARRIES THE WORDS, so an entry called “Untitled page” can be recognised without restoring it", () => {
    const t = seeded();
    const { tree } = deleteNode(t, "b", { at: 5_000 });
    const [row] = store.collectBinFacts(tree, [{ id: "P2", name: "Grand Port" }]);
    expect(row.title).toBe("Untitled page");                       // the name is still useless…
    expect(row.preview).toContain("dock doors");                   // …and the entry is now legible anyway
    expect(row.chars).toBeGreaterThan(40);
    expect(row.empty).toBe(false);
  });

  it("names the PROJECT it was deleted from", () => {
    const { tree } = deleteNode(seeded(), "a");
    const [row] = store.collectBinFacts(tree, [{ id: "P1", name: "Bain" }, { id: "P2", name: "Grand Port" }]);
    expect(row.projectLabel).toBe("Bain");
    expect(row.projectResolved).toBe(true);
  });

  it("⛔ AND KEEPS THREE DIFFERENT ANSWERS APART: a live project, no project, and a project that is gone", () => {
    let t = seeded();
    t = deleteNode(t, "a").tree;          // P1 — which we will NOT hand back as live
    t = deleteNode(t, "c").tree;          // no project at all
    const rows = store.collectBinFacts(t, [{ id: "P2", name: "Grand Port" }]);
    const dead = rows.find((r) => r.node.id === "a");
    const none = rows.find((r) => r.node.id === "c");
    expect(dead.projectLabel).toBe("a project that no longer exists");
    expect(dead.projectResolved).toBe(false);
    expect(none.projectLabel).toBe("Not in a project");
    expect(none.projectResolved).toBe(true);          // "nowhere" is a real answer, not a failure
  });

  it("⛔ AN ENTRY THAT NEVER RECORDED A PROJECT SAYS SO, rather than claiming “Not in a project”", () => {
    const { tree } = deleteNode(seeded(), "a");
    delete tree.trash[0].projectId;                    // an entry binned before the field existed
    const [row] = store.collectBinFacts(tree, [{ id: "P1", name: "Bain" }]);
    expect(row.projectLabel).toBe("where it came from was not recorded");
    expect(row.projectResolved).toBe(false);
  });

  it("marks a page nothing was ever written in — the ones that can be emptied without reading them", () => {
    const { tree } = deleteNode(seeded(), "c");
    const [row] = store.collectBinFacts(tree, []);
    expect(row.empty).toBe(true);
    expect(row.chars).toBe(0);
    expect(row.preview).toBe("");
  });

  it("a note binned WITH SUBPAGES takes its words from the first page in the cascade that has any", () => {
    let t = emptyTree();
    t = addPage(t, { id: "top", title: "Untitled page" }).tree;
    t = addPage(t, { id: "kid", title: "Untitled page", parentId: "top" }).tree;
    store.writePage("top", para(""));
    store.writePage("kid", para("The survey came back with the detention pond two feet low."));
    const { tree } = deleteNode(t, "top");
    const [row] = store.collectBinFacts(tree, []);
    expect(row.pageIds).toHaveLength(2);
    expect(row.preview).toContain("detention pond");
    expect(row.empty).toBe(false);
  });

  it("when the words are simply gone the row says nothing rather than inventing something", () => {
    const { tree } = deleteNode(seeded(), "b");
    store.deletePages(["b"]);
    const [row] = store.collectBinFacts(tree, []);
    expect(row.preview).toBe("");
    expect(row.empty).toBe(true);
  });

  it("keeps every field the bin already had — this ADDS facts, it does not replace the entry", () => {
    const { tree } = deleteNode(seeded(), "a", { at: 1234 });
    const [row] = store.collectBinFacts(tree, []);
    expect(row.deletedAt).toBe(1234);
    expect(row.id).toBe(tree.trash[0].id);
    expect(row.node.id).toBe("a");
  });

  it("an empty bin is an empty list, not a row saying there is nothing", () => {
    expect(store.collectBinFacts(emptyTree(), [])).toEqual([]);
  });
});

describe("scanNoteDuplicates — only findings somebody can act on (NEW-4)", () => {
  it("⛔ TWO LIVE COPIES IN TWO LIVE PROJECTS IS STILL A FINDING — the case the detector is for", () => {
    const t = seeded();
    const found = scan.scanNoteDuplicates(t, { liveProjectIds: ["P1", "P2"] });
    expect(found).toHaveLength(1);
    expect(found[0].pages.map((p) => p.pageId).sort()).toEqual(["a", "b"]);
  });

  it("⛔ A COPY IN THE BIN IS NOT A FINDING — it is already on its way out", () => {
    const { tree } = deleteNode(seeded(), "b");
    expect(scan.scanNoteDuplicates(tree, { liveProjectIds: ["P1", "P2"] })).toEqual([]);
  });

  it("⛔ A COPY IN A PROJECT THAT NO LONGER EXISTS IS NOT A FINDING — it is a tombstone", () => {
    const t = seeded();
    // P2 has been deleted, so only P1 is live: there is no longer a decision to make.
    expect(scan.scanNoteDuplicates(t, { liveProjectIds: ["P1"] })).toEqual([]);
  });

  it("BOTH conditions at once — the exact banner he was shown, and it is now silent", () => {
    const { tree } = deleteNode(seeded(), "b");
    expect(scan.scanNoteDuplicates(tree, { liveProjectIds: ["P1"] })).toEqual([]);
  });

  it("a page in NO project is never filtered out — “nowhere” is a real place that still exists", () => {
    const t = seeded();
    store.writePage("c", para("Bain coordination meeting: dock doors, trailer parking, and the fire lane."));
    const found = scan.scanNoteDuplicates(t, { liveProjectIds: ["P1", "P2"] });
    expect(found[0].pages.map((p) => p.pageId).sort()).toEqual(["a", "b", "c"]);
  });

  it("with no project list at hand it filters NOTHING — an unknown answer never suppresses a finding", () => {
    expect(scan.scanNoteDuplicates(seeded(), {})).toHaveLength(1);
  });

  it("⛔ “KEEP BOTH AND STOP TELLING ME” IS REMEMBERED, and it is keyed on the PAIR, either way round", () => {
    const t = seeded();
    const [group] = scan.scanNoteDuplicates(t, { liveProjectIds: ["P1", "P2"] });
    const key = scan.duplicateKey(group);
    expect(key).toBe("a|b");
    expect(scan.duplicateKey({ pages: [{ pageId: "b" }, { pageId: "a" }] })).toBe(key);
    expect(scan.scanNoteDuplicates(t, { liveProjectIds: ["P1", "P2"], ignored: [key] })).toEqual([]);
    // …and it does not silence a DIFFERENT pair.
    expect(scan.scanNoteDuplicates(t, { liveProjectIds: ["P1", "P2"], ignored: ["a|zzz"] })).toHaveLength(1);
  });

  it("the preference round-trips through storage under the account's own scope", () => {
    expect(store.readIgnoredDuplicates()).toEqual([]);
    expect(store.ignoreDuplicate("a|b")).toBe(true);
    expect(store.ignoreDuplicate("a|b")).toBe(true);             // idempotent, not a growing list
    expect(store.readIgnoredDuplicates()).toEqual(["a|b"]);
    expect(scan.scanNoteDuplicates(seeded(), { liveProjectIds: ["P1", "P2"], ignored: store.readIgnoredDuplicates() })).toEqual([]);
  });
});
