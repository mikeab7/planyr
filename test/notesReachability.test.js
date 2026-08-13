/* NOTHING MAY EXIST WITHOUT A HOME — and the title hypothesis, answered (NEW-1).
 *
 * ⛔ THE FAILURE. A real note went unreachable in the owner's account: `pg_msgaajbf1o61rit`,
 * 215 revisions of Bain meeting notes, `deleted_at` NULL and `purged_at` NULL, healthy in
 * storage AND in the cloud — with no node in the local tree, no node in the cloud tree, and
 * nothing in the bin naming it. Not destroyed. UNREACHABLE, which is worse, because nothing
 * in the product was able to say so.
 *
 * ⛔ THE ROOT CAUSE WAS FOUND BY A SWEEP, NOT BY READING. Two independent holes in
 * `mergeTrees`, and neither is visible in a hand-read of the function:
 *
 *   1. A DELETE TOOK MORE THAN IT NAMED. `deleteNode` stamps an entry with the cascade the
 *      DELETING device could see. The merge lifted out every id in that entry — and returned
 *      BEFORE recursing, so a page the other device had added under the deleted parent was
 *      neither kept live nor carried into the bin. Dropped, body intact.
 *   2. THE OTHER SIDE'S COPY WAS LOOKED UP BY POSITION. `other` came from the sibling list at
 *      the same spot, so re-parenting a page on one device made the merge blind to that
 *      page's copy on the other — and every child it had gained there went with it. No bin
 *      was involved in this one at all: one `move` and one `add` were enough.
 *
 * Both are asserted below as minimal cases AND as a randomised property over thousands of
 * merges, because a hand-written case list is exactly what missed them the first time.
 */
import { describe, expect, it } from "vitest";

import {
  addPage, adoptUnreachable, allPageIds, deleteNode, descendantPageIds, emptyTree, findPage,
  commitTitle, displayTitle, migrate, movePage, recoveredTitle, renameNode, restoreNode, setPageProject, subpagesPhrase,
  subtreePageIds, trashPageIds,
} from "../src/workspaces/notes/lib/notesModel.js";
import { mergeTrees } from "../src/workspaces/notes/lib/notesCloud.js";
import { createdAtFromId } from "../src/workspaces/notes/lib/notesScan.js";

const clone = (v) => JSON.parse(JSON.stringify(v));

/* ════════════════════════════════════════════════════════════════════════════════════════
 * 1. THE TWO HOLES, as minimal cases
 * ═══════════════════════════════════════════════════════════════════════════════════════ */
describe("mergeTrees — a delete takes exactly what its entry named", () => {
  const withParentAndChild = () => {
    let t = emptyTree();
    t = addPage(t, { id: "R", title: "Entitlements", projectId: "P" }).tree;
    t = addPage(t, { parentId: "R", id: "old", title: "Bonding" }).tree;
    return t;
  };

  it("⛔ a page the other device added under a binned parent is KEPT, not dropped", () => {
    const base = withParentAndChild();
    const typing = addPage(clone(base), { parentId: "R", id: "NEW", title: "Bain meeting notes" }).tree;
    const binned = deleteNode(clone(base), "R");
    expect(binned.entry.pageIds).toEqual(["R", "old"]);      // the entry cannot know about NEW

    let told = null;
    const merged = mergeTrees(typing, binned.tree, { onRescue: (r) => { told = r; } });

    expect(allPageIds(merged)).toContain("NEW");             // ⛔ the line that was missing
    expect(trashPageIds(merged)).toEqual(["R", "old"]);      // rule 1 untouched for named ids
    expect(allPageIds(merged)).not.toContain("R");
    expect(told).toEqual([{ pageId: "NEW", title: "Bain meeting notes", projectId: "P" }]);
  });

  it("…and it keeps the project of the branch it was lifted out of — never a guess", () => {
    const base = withParentAndChild();
    const typing = addPage(clone(base), { parentId: "R", id: "NEW", title: "n" }).tree;
    const merged = mergeTrees(typing, deleteNode(clone(base), "R").tree);
    expect(findPage(merged, "NEW").page.projectId).toBe("P");
    expect(findPage(merged, "NEW").parent).toBeNull();       // lifted to the top level
  });

  it("a page the entry DOES name is still binned — the delete is not weakened", () => {
    const base = withParentAndChild();
    const merged = mergeTrees(clone(base), deleteNode(clone(base), "R").tree);
    expect(allPageIds(merged)).toEqual([]);
    expect(trashPageIds(merged)).toEqual(["R", "old"]);
  });

  it("⛔ a RE-PARENTED page keeps the children the OTHER device gave it — no bin involved", () => {
    // The second hole, and the one that needs no delete at all.
    let base = emptyTree();
    base = addPage(base, { id: "r0", title: "r0", projectId: "P" }).tree;
    base = addPage(base, { id: "r2", title: "r2", projectId: "P" }).tree;
    base = addPage(base, { parentId: "r0", id: "k0", title: "k0" }).tree;

    const moved = movePage(clone(base), "r0", "r2", 0);                                   // device A
    const added = addPage(clone(base), { parentId: "k0", id: "LOST", title: "notes" }).tree;  // device B

    const merged = mergeTrees(moved, added);
    expect(allPageIds(merged)).toContain("LOST");
    expect(findPage(merged, "LOST").parent.id).toBe("k0");    // …under the page it was added to
    expect(findPage(merged, "k0").parent.id).toBe("r0");      // …and LOCAL placement still won
  });

  it("a page never appears twice, however it was re-parented", () => {
    let base = emptyTree();
    base = addPage(base, { id: "A", title: "A", projectId: "P" }).tree;
    base = addPage(base, { id: "B", title: "B", projectId: "P" }).tree;
    base = addPage(base, { parentId: "A", id: "X", title: "X" }).tree;
    const mine = movePage(clone(base), "X", "B", 0);
    const theirs = movePage(clone(base), "X", null, 0);
    const ids = allPageIds(mergeTrees(mine, theirs));
    expect(ids.filter((i) => i === "X")).toHaveLength(1);
    expect(findPage(mergeTrees(mine, theirs), "X").parent.id).toBe("B");   // local placement
  });
});

/* ════════════════════════════════════════════════════════════════════════════════════════
 * 2. THE PROPERTY — thousands of merges, because the case list is what missed it
 * ═══════════════════════════════════════════════════════════════════════════════════════ */
describe("PROPERTY: a merge may never leave a page neither live nor binned", () => {
  const OPS = ["delete", "move", "add", "restore", "rename", "refile"];

  const sweep = (seed, trials = 1200) => {
    let s = seed;
    const rnd = () => (s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
    const pick = (a) => a[Math.floor(rnd() * a.length)];
    let orphans = 0;
    let duplicated = 0;
    for (let trial = 0; trial < trials; trial += 1) {
      let b0 = emptyTree();
      for (let i = 0; i < 4; i += 1) b0 = addPage(b0, { projectId: i % 2 ? "P1" : "P2", id: `r${i}`, title: `r${i}` }).tree;
      for (let i = 0; i < 4; i += 1) b0 = addPage(b0, { parentId: `r${i % 4}`, id: `k${i}`, title: `k${i}` }).tree;
      const dev = [clone(b0), clone(b0)];
      for (const d of [0, 1]) {
        for (let op = 0; op < 4; op += 1) {
          const ids = allPageIds(dev[d]);
          if (!ids.length) break;
          const t = pick(ids);
          switch (pick(OPS)) {
            case "delete": dev[d] = deleteNode(dev[d], t).tree; break;
            case "move": dev[d] = movePage(dev[d], t, rnd() < 0.5 ? null : pick(ids), Math.floor(rnd() * 3)); break;
            case "add": dev[d] = addPage(dev[d], { parentId: rnd() < 0.5 ? null : t, id: `n${d}${op}${trial}`, title: "new" }).tree; break;
            case "rename": dev[d] = renameNode(dev[d], t, `t${d}${op}`); break;
            case "refile": dev[d] = setPageProject(dev[d], t, rnd() < 0.5 ? null : "P3"); break;
            default: { const e = (dev[d].trash || [])[0]; if (e) dev[d] = restoreNode(dev[d], e.id).tree; break; }
          }
        }
      }
      const merged = migrate(mergeTrees(dev[0], dev[1]));
      const liveIds = allPageIds(merged);
      const live = new Set(liveIds);
      const binned = new Set(trashPageIds(merged));
      if (liveIds.length !== live.size) duplicated += 1;
      for (const d of [0, 1]) for (const id of allPageIds(dev[d])) if (!live.has(id) && !binned.has(id)) orphans += 1;
    }
    return { orphans, duplicated };
  };

  it.each([12345, 777, 999983, 42, 2026])("seed %i — every page ends up live or binned, and exactly once", (seed) => {
    expect(sweep(seed)).toEqual({ orphans: 0, duplicated: 0 });
  });

  it("the sweep is not passing vacuously — it really does exercise deletes and re-parents", () => {
    // A guard nobody has seen fail is a guard that rots green (VIEW-INDEPENDENT-ONCE §6).
    let s = 12345;
    const rnd = () => (s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
    let sawBin = 0;
    for (let i = 0; i < 200; i += 1) {
      let t = emptyTree();
      t = addPage(t, { id: `a${i}`, title: "a", projectId: "P" }).tree;
      t = addPage(t, { parentId: `a${i}`, id: `b${i}`, title: "b" }).tree;
      if (rnd() < 2) { const d = deleteNode(t, `a${i}`); if (d.entry?.pageIds?.length === 2) sawBin += 1; }
    }
    expect(sawBin).toBe(200);
  });
});

/* ════════════════════════════════════════════════════════════════════════════════════════
 * 3. THE TITLE HYPOTHESIS — asked directly by the owner, answered with evidence
 *
 * ⛔ REFUTED. Every falsy title survives every path. The reason all 56 nodes in his live tree
 * carry a non-empty title is not that a filter ate the empty ones — it is that NO PATH IN
 * THIS MODULE CAN MINT ONE: `addPage` passes `title || DEFAULT_PAGE_TITLE`, `renameNode`
 * coerces a blank back to the default, and `copyPageWithin` falls back to the source's name.
 * The observation is expected, not suspicious.
 *
 * ⛔ AND TITLE IS NOT LOAD-BEARING FOR IDENTITY ANYWHERE. That is asserted, not asserted-in-a
 * comment: the cases below run a titleless node through save, load, migrate, a cloud round
 * trip, a two-window merge, a sibling delete and a sibling rename.
 * ═══════════════════════════════════════════════════════════════════════════════════════ */
describe("a page with no title is still a page", () => {
  const FALSY = [null, undefined, "", "   ", "\t\n "];

  /** Built by hand, because no exported op can produce a titleless node — which is itself
   *  the answer to why the live tree has none. */
  const treeWith = (title) => ({
    v: 3,
    pages: [{
      id: "ROOT", title: "Root", createdAt: 1, updatedAt: 1, projectId: "P",
      pages: [
        { id: "VICTIM", title, createdAt: 1, updatedAt: 1, pages: [] },
        { id: "SIB", title: "Sibling", createdAt: 1, updatedAt: 1, pages: [] },
      ],
    }],
    trash: [],
  });

  const PATHS = {
    "save + load (a JSON round trip)": (t) => clone(t),
    "migrate": (t) => migrate(clone(t)),
    "a cloud round trip, then migrate": (t) => migrate(JSON.parse(JSON.stringify(clone(t)))),
    "a two-window merge of identical trees": (t) => mergeTrees(clone(t), clone(t)),
    "a merge where the other window RENAMED a sibling": (t) => mergeTrees(clone(t), renameNode(clone(t), "SIB", "Renamed")),
    "a merge where the other window ADDED a page": (t) => mergeTrees(clone(t), addPage(clone(t), { parentId: "ROOT", id: "N", title: "n" }).tree),
    "a merge where the other window MOVED it": (t) => mergeTrees(clone(t), movePage(clone(t), "VICTIM", null, 0)),
    "deleting a SIBLING": (t) => deleteNode(clone(t), "SIB").tree,
    "renaming a SIBLING": (t) => renameNode(clone(t), "SIB", "Renamed"),
    "moving a SIBLING": (t) => movePage(clone(t), "SIB", null, 0),
    "binning and restoring its PARENT": (t) => { const d = deleteNode(clone(t), "ROOT"); return restoreNode(d.tree, d.entry.id).tree; },
  };

  for (const title of FALSY) {
    for (const [name, run] of Object.entries(PATHS)) {
      it(`title ${JSON.stringify(title)} survives ${name}`, () => {
        const out = run(treeWith(title));
        expect(allPageIds(out)).toContain("VICTIM");
        expect(findPage(out, "VICTIM")).toBeTruthy();
      });
    }
  }

  it("⛔ NO EXPORTED OP CAN MINT A TITLELESS NODE — which is why his live tree has none", () => {
    for (const title of FALSY) {
      const r = addPage(emptyTree(), { title });
      expect(String(findPage(r.tree, r.pageId).page.title).trim()).not.toBe("");
    }
    /* ⛔ AMENDED (B370527), AND THE AMENDMENT IS DELIBERATE. `renameNode` used to coerce a
     * blank name to the default too — and the title field is a CONTROLLED input that writes on
     * every keystroke, so backspacing a name to nothing wrote the default straight back and the
     * field re-rendered with every character restored. You could not clear it to retype it.
     *
     * So a blank title is now a legal MOMENTARY state, which costs nothing: since B342992 a
     * title is never load-bearing for identity or reachability. What must still hold — and is
     * what this test was really protecting — is that a page never SETTLES without a name. The
     * default is applied when the field is left (`commitTitle`), and the rail shows the
     * placeholder for one that is momentarily empty (`displayTitle`), never writing it back. */
    const t = addPage(emptyTree(), { id: "X", title: "Real" }).tree;
    for (const title of FALSY) {
      const renamed = renameNode(t, "X", title);
      expect(String(findPage(renamed, "X").page.title).trim(), "a rename may leave it blank while you type").toBe("");
      expect(String(findPage(commitTitle(renamed, "X"), "X").page.title).trim(), "…and it may never SETTLE blank").not.toBe("");
      expect(displayTitle(findPage(renamed, "X").page.title).trim(), "…and it never SHOWS blank either").not.toBe("");
      // ⛔ And the node is still reachable by ID throughout, which is the guarantee that counts.
      expect(findPage(renamed, "X").page.id).toBe("X");
    }
  });

  it("identity is the ID: two pages with the SAME title are two pages", () => {
    let t = emptyTree();
    t = addPage(t, { id: "one", title: "Coordination", projectId: "P" }).tree;
    t = addPage(t, { id: "two", title: "Coordination", projectId: "P" }).tree;
    expect(allPageIds(mergeTrees(clone(t), clone(t))).sort()).toEqual(["one", "two"]);
    expect(allPageIds(deleteNode(t, "one").tree)).toEqual(["two"]);
  });
});

/* ════════════════════════════════════════════════════════════════════════════════════════
 * 4. SELF-HEALING — a body with no node gets one, and nothing is invented
 * ═══════════════════════════════════════════════════════════════════════════════════════ */
describe("adoptUnreachable", () => {
  const orphan = (pageId, firstLine = "Channel improvements were needed to slow down conveyance") =>
    ({ pageId, firstLine, createdAt: 1786000000000 });

  it("gives the body a node at the TOP LEVEL, keeping its own id so the body re-attaches", () => {
    const r = adoptUnreachable(emptyTree(), [orphan("pg_lost")]);
    expect(r.adopted.map((a) => a.pageId)).toEqual(["pg_lost"]);
    expect(allPageIds(r.tree)).toEqual(["pg_lost"]);
    expect(findPage(r.tree, "pg_lost").parent).toBeNull();
  });

  it("⛔ NEVER GUESSES A PROJECT — the lost fact stays lost, in a named place", () => {
    const t = addPage(emptyTree(), { id: "r", title: "r", projectId: "P" }).tree;
    const r = adoptUnreachable(t, [orphan("pg_lost")]);
    expect(findPage(r.tree, "pg_lost").page.projectId).toBeNull();
  });

  it("⛔ NEVER INVENTS A TITLE — it is named from the words the person actually wrote", () => {
    const r = adoptUnreachable(emptyTree(), [orphan("pg_lost")]);
    const title = findPage(r.tree, "pg_lost").page.title;
    expect(title).toContain("Recovered — ");
    expect(title).toContain("Channel improvements");
    expect(recoveredTitle("")).toBe("Recovered note (name lost)");
  });

  it("keeps the date the id itself carries, which is the one fact that survived the node", () => {
    const r = adoptUnreachable(emptyTree(), [{ pageId: "pg_lost", firstLine: "x", createdAt: 1786000000000 }]);
    expect(findPage(r.tree, "pg_lost").page.createdAt).toBe(1786000000000);
    // …and that date is recoverable from a real id, which is where it comes from.
    expect(new Date(createdAtFromId("pg_msgaajbf1o61rit")).toISOString()).toBe("2026-08-05T16:11:02.091Z");
    expect(createdAtFromId("not-an-id")).toBeNull();
  });

  it("is idempotent — a page already in the tree or in the BIN is never adopted twice", () => {
    const once = adoptUnreachable(emptyTree(), [orphan("pg_lost")]);
    expect(adoptUnreachable(once.tree, [orphan("pg_lost")]).adopted).toEqual([]);
    const binned = deleteNode(once.tree, "pg_lost");
    expect(adoptUnreachable(binned.tree, [orphan("pg_lost")]).adopted).toEqual([]);
  });

  it("adopts nothing, and rewrites nothing, when there is nothing to adopt", () => {
    const t = addPage(emptyTree(), { id: "r", title: "r" }).tree;
    const r = adoptUnreachable(t, []);
    expect(r.tree).toBe(t);
    expect(r.adopted).toEqual([]);
  });

  it("⛔ THERE IS NO TITLE-KEYED CONTAINER — a second run cannot depend on finding one by name", () => {
    const first = adoptUnreachable(emptyTree(), [orphan("a")]);
    const renamed = renameNode(first.tree, "a", "Whatever I felt like calling it");
    const second = adoptUnreachable(renamed, [orphan("b")]);
    expect(allPageIds(second.tree).sort()).toEqual(["a", "b"]);
    expect(second.tree.pages.every((p) => p.parentId === undefined)).toBe(true);
  });
});

/* ════════════════════════════════════════════════════════════════════════════════════════
 * 5. THE DELETE COUNT (NEW-4) — the number names what ELSE goes
 * ═══════════════════════════════════════════════════════════════════════════════════════ */
describe("what a delete says it is taking", () => {
  const parentWithOneChild = () => {
    let t = addPage(emptyTree(), { id: "sec", title: "Entitlements", projectId: "P" }).tree;
    t = addPage(t, { parentId: "sec", id: "pg", title: "Bonding" }).tree;
    return t;
  };

  it("⛔ ONE PAGE WITH ONE CHILD IS 'its 1 subpage', NOT 'its 2 pages'", () => {
    const t = parentWithOneChild();
    const node = findPage(t, "sec").page;
    expect(subtreePageIds(node)).toEqual(["sec", "pg"]);      // the cascade set — for the DELETE
    expect(descendantPageIds(node)).toEqual(["pg"]);          // the count — for the PERSON
    expect(subpagesPhrase(descendantPageIds(node).length)).toBe("its 1 subpage");
  });

  it("a page that stands alone says nothing extra at all", () => {
    const t = addPage(emptyTree(), { id: "solo", title: "Solo" }).tree;
    expect(descendantPageIds(findPage(t, "solo").page)).toEqual([]);
    expect(subpagesPhrase(0)).toBe("");
  });

  it("counts at EVERY depth, and pluralises", () => {
    let t = addPage(emptyTree(), { id: "a", title: "a" }).tree;
    t = addPage(t, { parentId: "a", id: "b", title: "b" }).tree;
    t = addPage(t, { parentId: "b", id: "c", title: "c" }).tree;
    expect(descendantPageIds(findPage(t, "a").page)).toEqual(["b", "c"]);
    expect(subpagesPhrase(2)).toBe("its 2 subpages");
  });

  it("the DELETE itself still takes the whole subtree — the count changed, the cascade did not", () => {
    const t = parentWithOneChild();
    const d = deleteNode(t, "sec");
    expect(d.entry.pageIds).toEqual(["sec", "pg"]);
    expect(d.removedPageIds).toEqual(["sec", "pg"]);
    expect(allPageIds(d.tree)).toEqual([]);
  });

  it("a delete is TRANSACTIONAL — an unknown id changes nothing at all", () => {
    const t = parentWithOneChild();
    const d = deleteNode(t, "nope");
    expect(d.entry).toBeFalsy();
    expect(allPageIds(d.tree)).toEqual(allPageIds(t));
    expect(d.tree.trash).toEqual([]);
  });
});
