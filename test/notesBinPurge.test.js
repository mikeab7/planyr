/* EMPTYING THE BIN HAS TO STICK — the tombstone rules, and the fuzz that proves them.
 *
 * ⛔ THE FAILURE, measured on the owner's live account with revisions, not inferred:
 *
 *   • He emptied the bin. The cloud tree went to **rev 991** holding ONE entry; his screen
 *     agreed — "1 deleted note".
 *   • A browser tab that had been open a while was still on **rev 966**, `treeDirty` TRUE,
 *     holding all **23** entries.
 *   • That tab reloaded. Local came back at **rev 992 with all 23 entries** — every one he had
 *     just emptied. The stale tab did not merely fail to notice the purge: it **pushed the
 *     resurrection up** and overwrote the good state. Cloud trash: 23.
 *
 * ⛔ THE CAUSE IS STRUCTURAL, WHICH IS WHY A PATCH WOULD NOT HAVE DONE. The tree merge is a
 * UNION: an ADDITION wins, and a DELETION is the ABSENCE of an entry. Absence loses to any
 * copy that still has one. So a purge could never survive a merge with any client that had
 * not yet seen it — this is the page-loss merge bug's mirror image, on the opposite side.
 *
 * ⛔ THE FIX IS A DEFINITION: a purge is a FACT, recorded in the tree as a tombstone, and rule
 * 0 of the merge honours it before anything else. That is TOMBSTONE-DELETES, which the rest of
 * the product has had since B276 and Notes did not.
 *
 * The fuzz at the bottom is deliberately the same shape as the one that found the page-loss
 * holes: a hand-written case list is what missed those, and it would have missed this.
 */
import { beforeEach, describe, expect, it } from "vitest";

import {
  addPage, deleteNode, emptyTree, migrate, purgeTrashEntry, restoreNode, tombstoneIds,
  trashEntries, withTombstones, TOMB_RETENTION_DAYS,
} from "../src/workspaces/notes/lib/notesModel.js";
import { judgeConflict, mergeTrees } from "../src/workspaces/notes/lib/notesCloud.js";

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

const clone = (v) => JSON.parse(JSON.stringify(v));

/**
 * ⛔ THE STEP THE FIRST ROUND DID NOT HAVE, AND IT IS WHY THE FIRST ROUND SHIPPED BROKEN.
 *
 * Every case below used to work on in-memory trees — including a 6,000-merge fuzz — and NOT ONE
 * of them went through `migrate` or through storage. `migrate` was silently dropping the
 * tombstone ledger on every read (it built a fresh object and then asked THAT object for its
 * tombs), so the ledger was destroyed the instant it was written and the merge fell back to a
 * plain union. A purge-then-RELOAD on ONE client was not a case anybody had.
 *
 * `reload` is that missing step, and it is the real one: the tree goes to localStorage through
 * the store's own writer and comes back through the store's own reader.
 */
const reload = (tree) => { store.writeTree(tree); return migrate(store.readTreeRaw()); };
const trashIds = (t) => trashEntries(t).map((e) => e.id).sort();
const liveIds = (t) => {
  const out = [];
  const walk = (n) => { out.push(n.id); for (const k of n.pages || []) walk(k); };
  for (const p of t.pages || []) walk(p);
  return out.sort();
};

beforeEach(() => { mem.clear(); });

/** A tree with three top-level notes, all binned — the shape of an emptied bin. */
function binnedThree() {
  let t = emptyTree();
  for (const id of ["a", "b", "c"]) t = addPage(t, { id, title: id.toUpperCase() }).tree;
  for (const id of ["a", "b", "c"]) t = deleteNode(t, id).tree;
  return t;
}

describe("a purge is recorded, not merely performed", () => {
  it("stamps the entry id and every page id it named", () => {
    let t = emptyTree();
    t = addPage(t, { id: "top", title: "Top" }).tree;
    t = addPage(t, { id: "kid", title: "Kid", parentId: "top" }).tree;
    const del = deleteNode(t, "top");
    const entryId = del.entry.id;
    const { tree, pageIds } = purgeTrashEntry(del.tree, entryId);
    expect(pageIds.sort()).toEqual(["kid", "top"]);
    const tombs = tombstoneIds(tree);
    expect(tombs.has(entryId)).toBe(true);
    expect(tombs.has("top")).toBe(true);
    expect(tombs.has("kid")).toBe(true);
  });

  it("a purge that names no pages STILL leaves a tombstone — otherwise it cannot survive", () => {
    let t = emptyTree();
    t = addPage(t, { id: "solo", title: "Solo" }).tree;
    const del = deleteNode(t, "solo");
    del.tree.trash[0].pageIds = [];          // an entry written before the cascade was stamped
    const { tree } = purgeTrashEntry(del.tree, del.entry.id);
    expect(tombstoneIds(tree).has(del.entry.id)).toBe(true);
  });

  it("keeps one row per id and ages the ledger out, so it cannot grow without bound", () => {
    const old = Date.now() - (TOMB_RETENTION_DAYS + 5) * 86400000;
    const t = withTombstones({ tombs: [{ id: "ancient", at: old }, { id: "x", at: Date.now() }] }, ["x", "y"]);
    expect(t.tombs.map((r) => r.id).sort()).toEqual(["x", "y"]);
  });

  it("survives the migration — a tree written before tombstones existed simply has none", () => {
    const t = migrate({ v: 3, pages: [], trash: [] });
    expect(Array.isArray(t.tombs)).toBe(true);
    expect(t.tombs).toEqual([]);
  });
});

describe("⛔ THE INCIDENT — a stale window may not resurrect an emptied bin", () => {
  it("his exact sequence: server emptied, stale client still holding every entry", () => {
    const before = binnedThree();
    const stale = clone(before);                 // the tab that never saw the purge (his rev 966)

    let server = clone(before);                  // the window he emptied it in (his rev 991)
    for (const e of trashEntries(server)) server = purgeTrashEntry(server, e.id).tree;
    expect(trashIds(server)).toEqual([]);

    // The stale tab reloads and merges, which is the step that resurrected all 23.
    const merged = mergeTrees(reload(stale), reload(server));
    expect(trashIds(merged)).toEqual([]);
    expect(liveIds(merged)).toEqual([]);
  });

  /* ⛔ HIS SECOND REPORT, AND IT NEEDS NO SECOND CLIENT AT ALL. Create a page, bin it, press
   * Delete forever, RELOAD. The row went and stayed gone — and the page came back in the LIVE
   * list, as a note with nothing in it, and was pushed to the cloud. */
  it("⛔ PURGE → RELOAD ON ONE CLIENT: the id is absent from BOTH pages and trash, three reloads deep", () => {
    let t = addPage(emptyTree(), { id: "pg_msp3ucx811rq9ao", title: "Scratch" }).tree;
    const beforeBin = clone(t);                       // what a server that never saw any of it holds
    const del = deleteNode(t, "pg_msp3ucx811rq9ao");
    t = purgeTrashEntry(del.tree, del.entry.id).tree;

    for (let i = 0; i < 3; i += 1) {
      t = reload(t);
      expect(tombstoneIds(t).has("pg_msp3ucx811rq9ao"), `reload ${i + 1} kept the ledger`).toBe(true);
      expect(liveIds(t), `reload ${i + 1} live`).toEqual([]);
      expect(trashIds(t), `reload ${i + 1} trash`).toEqual([]);
      // …and each reload also syncs against a server still holding the page LIVE.
      t = mergeTrees(t, beforeBin);
      expect(liveIds(t), `reload ${i + 1} after sync`).toEqual([]);
      expect(trashIds(t), `reload ${i + 1} after sync`).toEqual([]);
    }
  });

  it("⛔ AND THE LEDGER SURVIVES THE STORE ITSELF — the one step the first round never took", () => {
    let t = addPage(emptyTree(), { id: "a", title: "A" }).tree;
    const del = deleteNode(t, "a");
    t = purgeTrashEntry(del.tree, del.entry.id).tree;
    const ids = [...tombstoneIds(t)].sort();
    expect(ids).toHaveLength(2);
    expect([...tombstoneIds(reload(t))].sort()).toEqual(ids);
    expect([...tombstoneIds(reload(reload(t)))].sort()).toEqual(ids);
  });

  it("…and in the other direction, because whichever side purged is the side with news", () => {
    const before = binnedThree();
    let local = clone(before);
    for (const e of trashEntries(local)) local = purgeTrashEntry(local, e.id).tree;
    expect(trashIds(mergeTrees(local, clone(before)))).toEqual([]);
  });

  it("⛔ AND THE MERGED TREE CARRIES THE TOMBSTONES ON, so the NEXT stale client is refused too", () => {
    const before = binnedThree();
    let server = clone(before);
    for (const e of trashEntries(server)) server = purgeTrashEntry(server, e.id).tree;
    const once = mergeTrees(clone(before), server);
    const twice = mergeTrees(clone(before), once);          // a second window, equally stale
    expect(trashIds(twice)).toEqual([]);
    expect(tombstoneIds(twice).size).toBeGreaterThan(0);
  });

  it("a purged page may not come back as a LIVE node either", () => {
    const before = binnedThree();
    let server = clone(before);
    for (const e of trashEntries(server)) server = purgeTrashEntry(server, e.id).tree;
    // The stale client restored one of them before it learned about the purge.
    const stale = restoreNode(clone(before), trashEntries(before)[0].id).tree;
    expect(liveIds(stale)).toEqual(["a"]);
    const merged = mergeTrees(stale, server);
    expect(liveIds(merged)).toEqual([]);
    expect(trashIds(merged)).toEqual([]);
  });

  it("⛔ AND A PURGE STILL TAKES ONLY WHAT IT NAMED — a child added elsewhere afterwards is RESCUED", () => {
    // The exact shape of the page-loss bug, arriving through the new rule instead of rule 1.
    let t = emptyTree();
    t = addPage(t, { id: "top", title: "Top" }).tree;
    const del = deleteNode(t, "top");
    const purged = purgeTrashEntry(del.tree, del.entry.id).tree;
    // The other device never saw the delete and added a subpage under it.
    const other = addPage(clone(t), { id: "fresh", title: "Fresh", parentId: "top" }).tree;
    const merged = mergeTrees(other, purged);
    expect(liveIds(merged)).toEqual(["fresh"]);              // kept, lifted to the top level
    expect(trashIds(merged)).toEqual([]);
  });

  it("an ordinary delete is UNAFFECTED — rule 1's conservative direction still holds", () => {
    let t = emptyTree();
    t = addPage(t, { id: "a", title: "A" }).tree;
    const binned = deleteNode(t, "a").tree;
    const merged = mergeTrees(clone(t), binned);             // one side still has it live
    expect(liveIds(merged)).toEqual([]);
    expect(trashIds(merged)).toEqual(trashIds(binned));      // recoverable, as designed
  });
});

/* ════════════════════════════════════════════════════════════════════════════════════════
 * THE FUZZ — the same shape as the sweep that found the page-loss holes, because the
 * hand-written cases above are exactly the kind of list that missed those.
 * ═══════════════════════════════════════════════════════════════════════════════════════ */
describe("PROPERTY: across thousands of two-client merges, a purged id never comes back", () => {
  const rng = (seed) => () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  };

  const randomOps = (tree, rand, n) => {
    let t = tree;
    for (let i = 0; i < n; i += 1) {
      const roll = rand();
      const live = liveIds(t);
      const bin = trashEntries(t);
      if (roll < 0.3) {
        t = addPage(t, { id: `n${Math.floor(rand() * 1e6)}`, title: "N", parentId: live.length && rand() < 0.5 ? live[Math.floor(rand() * live.length)] : null }).tree;
      } else if (roll < 0.55 && live.length) {
        t = deleteNode(t, live[Math.floor(rand() * live.length)]).tree;
      } else if (roll < 0.8 && bin.length) {
        t = purgeTrashEntry(t, bin[Math.floor(rand() * bin.length)].id).tree;
      } else if (bin.length) {
        t = restoreNode(t, bin[Math.floor(rand() * bin.length)].id).tree;
      }
    }
    return t;
  };

  it("6,000 merges across five seeds: nothing tombstoned is ever live or binned afterwards", () => {
    let violations = 0;
    let purges = 0;
    for (const seed of [1, 7, 19, 101, 997]) {
      const rand = rng(seed);
      for (let round = 0; round < 1200; round += 1) {
        let base = emptyTree();
        for (let i = 0; i < 4; i += 1) base = addPage(base, { id: `p${i}`, title: `P${i}` }).tree;
        /* ⛔ RELOADED, which is the step whose absence let the ledger be dropped for a whole
         * shipment. Each side goes to storage and comes back the way the app reads it. */
        const a = reload(randomOps(clone(base), rand, 4));
        const b = reload(randomOps(clone(base), rand, 4));
        const merged = reload(mergeTrees(a, b));
        const tombs = tombstoneIds(merged);
        purges += tombs.size;
        const back = [...liveIds(merged), ...trashIds(merged)].filter((id) => tombs.has(id));
        // Trash entry ids are in the ledger too, so check both populations.
        const binNodes = trashEntries(merged).flatMap((e) => [e.id, ...(e.pageIds || [])]);
        if (back.length || binNodes.some((id) => tombs.has(id))) violations += 1;
      }
    }
    expect(purges).toBeGreaterThan(0);       // the fuzz really did purge things
    expect(violations).toBe(0);
  });

  it("…and the merge is still ORDER-INDEPENDENT about it", () => {
    const rand = rng(31);
    for (let round = 0; round < 300; round += 1) {
      let base = emptyTree();
      for (let i = 0; i < 3; i += 1) base = addPage(base, { id: `q${i}`, title: `Q${i}` }).tree;
      const a = randomOps(clone(base), rand, 3);
      const b = randomOps(clone(base), rand, 3);
      expect(tombstoneIds(mergeTrees(a, b)).size).toBe(tombstoneIds(mergeTrees(b, a)).size);
    }
  });
});

/* ════════════════════════════════════════════════════════════════════════════════════════
 * A DIFFERENCE THAT IS ONLY LITTER IS NOT A DISAGREEMENT
 *
 * The third finding of the live pass: a conflict prompt appeared on a note nobody had edited —
 * *"“Load Study” also changed in another of your windows."* It was REAL, and it was a choice
 * with nothing in it: the one-time clean-up had removed ten empty blocks on one side while the
 * other window still had them, so the two copies differed by exactly the objects the app itself
 * had decided are worthless.
 * ═══════════════════════════════════════════════════════════════════════════════════════ */
describe("judgeConflict — empty blocks cannot be what two windows disagree about", () => {
  const para = (t) => ({ type: "paragraph", ...(t ? { content: [{ type: "text", text: t }] } : {}) });
  const anchor = (kids) => ({ type: "noteAnchor", attrs: { x: 10, y: 20, w: 180 }, content: kids });
  const doc = (...c) => ({ type: "doc", content: c });

  it("⛔ THE SAME NOTE, ONE COPY STILL CARRYING THE LITTER, IS NOT A CONFLICT", () => {
    const clean = doc(para("Load Study — 4.2 MW, feeder to the north."));
    const littered = doc(para("Load Study — 4.2 MW, feeder to the north."), anchor([para()]), anchor([para("   ")]));
    expect(judgeConflict({ localDoc: clean, serverDoc: littered })).toEqual({ silent: true, why: "litter-only" });
    expect(judgeConflict({ localDoc: littered, serverDoc: clean })).toEqual({ silent: true, why: "litter-only" });
  });

  it("⛔ AND A REAL EDIT STILL IS ONE — the guard must not swallow a genuine divergence", () => {
    const mine = doc(para("Load Study — 4.2 MW"), anchor([para()]));
    const theirs = doc(para("Load Study — 6.0 MW"));
    expect(judgeConflict({ localDoc: mine, serverDoc: theirs }).silent).toBe(false);
  });

  it("…including an edit made INSIDE a block, which is content like any other", () => {
    const mine = doc(para("Same"), anchor([para("mine")]));
    const theirs = doc(para("Same"), anchor([para("theirs")]));
    expect(judgeConflict({ localDoc: mine, serverDoc: theirs }).silent).toBe(false);
  });

  it("identical copies are still settled as identical, not as litter", () => {
    const d = doc(para("Same"), anchor([para("kept")]));
    expect(judgeConflict({ localDoc: d, serverDoc: clone(d) })).toEqual({ silent: true, why: "identical" });
  });

  it("and a block holding a PICTURE is never litter, so it can still be a real disagreement", () => {
    const mine = doc(para("Same"), anchor([{ type: "noteImage", attrs: { imageId: "img1" } }]));
    const theirs = doc(para("Same"));
    expect(judgeConflict({ localDoc: mine, serverDoc: theirs }).silent).toBe(false);
  });
});
