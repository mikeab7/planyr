/* notesModel — the PURE page tree.
 *
 * ⛔ REWRITTEN FOR THE COLLAPSE (B1420). The previous suite exercised the four-level
 * `notebook › section › page` model: `addNotebook` / `addSection` / `moveSection` /
 * `moveNotebook` / `visibleNotebooks` / `setNotebookProject`. Every one of those is gone, so
 * every one of those cases is REPLACED here rather than left passing against dead code — the
 * property each of them protected is re-asserted against the new shape.
 *
 * The properties worth defending are the ones whose failure is SILENT:
 *   • PURITY — a mutator that edits its argument corrupts the caller's state with no error.
 *   • THE FULL CASCADE, AT EVERY DEPTH — an under-reported cascade orphans page bodies that
 *     can never be reached and never be removed (TOMBSTONE-DELETES).
 *   • NOTHING RENDERS IN ZERO SCOPES — the exact bug the collapse must not create.
 *   • MIGRATION — the owner's own live data, converted, twice, with nothing lost.
 *   • A TOLERANT `migrate` — a notes module that refuses to open because one field is the
 *     wrong type is worse than one that drops the field.
 */
import { describe, it, expect } from "vitest";
import {
  addPage, allPageIds, ancestorIds, boundProjectIds, deleteNode, emptyTree, expiredTrashIds,
  findPage, firstPageId, migrate, movePage, pagesInScope, projectGroups, projectOfPage,
  purgeTrashEntry, recentPages, renameNode, restoreNode, searchTitles, setPageProject,
  subtreePageIds, touchPage, trashEntries, trashPageIds, walkPages,
  NOTES_TREE_VERSION, NO_PROJECT_LABEL, SCOPE_ALL, SCOPE_PROJECT,
} from "../src/workspaces/notes/lib/notesModel.js";

const deepFreeze = (o) => {
  if (o && typeof o === "object" && !Object.isFrozen(o)) { Object.freeze(o); Object.values(o).forEach(deepFreeze); }
  return o;
};

/* The owner's live data as reported 2026-08-04, in the OLD four-level shape. Two notebooks
 * bound to the same project (which must MERGE), one whose names are both generic, and one
 * under a different project. This is the migration's test case, not a synthetic one. */
const OWNER_V2 = () => ({
  v: 2,
  notebooks: [
    { id: "nb1", title: "Grand Port", projectId: "GP", sections: [
      { id: "sec1", title: "Entitlements", pages: [{ id: "pg1", title: "Bonding", createdAt: 10, updatedAt: 20 }] },
      { id: "sec2", title: "DEV COORDINATION", pages: [{ id: "pg2", title: "Page 1", createdAt: 11, updatedAt: 21 }] },
    ] },
    { id: "nb2", title: "Coordination", projectId: "GP", sections: [
      { id: "sec3", title: "Coordination", pages: [
        { id: "pg3", title: "Coordination", createdAt: 12, updatedAt: 22 },
        { id: "pg4", title: "Bonding", createdAt: 13, updatedAt: 23 },
      ] },
    ] },
    { id: "nb3", title: "Untitled notebook", projectId: "GP", sections: [
      { id: "sec4", title: "Section 1", pages: [{ id: "pg5", title: "Load Study", createdAt: 14, updatedAt: 24 }] },
    ] },
    { id: "nb4", title: "Untitled notebook", projectId: "ADDR", sections: [
      { id: "sec5", title: "Section 1", pages: [{ id: "pg6", title: "Page 1", createdAt: 15, updatedAt: 25 }] },
    ] },
  ],
  trash: [],
});

/** A small hand-built v3 tree: one project with a nested branch, plus a no-project page. */
const sample = () => {
  let t = emptyTree();
  t = addPage(t, { projectId: "GP", title: "Entitlements", id: "a", at: 100 }).tree;
  t = addPage(t, { parentId: "a", title: "Bonding", id: "a1", at: 101 }).tree;
  t = addPage(t, { parentId: "a1", title: "Surety letter", id: "a1x", at: 102 }).tree;
  t = addPage(t, { projectId: "GP", title: "Dev coordination", id: "b", at: 103 }).tree;
  t = addPage(t, { projectId: null, title: "Scratch", id: "c", at: 104 }).tree;
  return t;
};

/* ═══════════════════════════════════════════════════════════════════════════════════════ */
describe("purity — no mutator touches its input", () => {
  const ops = [
    ["addPage (root)", (t) => addPage(t, { projectId: "GP", title: "X" })],
    ["addPage (child)", (t) => addPage(t, { parentId: "a", title: "X" })],
    ["renameNode", (t) => renameNode(t, "a", "Renamed")],
    ["movePage (nest)", (t) => movePage(t, "b", "a", 0)],
    ["movePage (to root)", (t) => movePage(t, "a1", null, 0)],
    ["setPageProject", (t) => setPageProject(t, "a", "OTHER")],
    ["touchPage", (t) => touchPage(t, "a1", 999)],
    ["deleteNode", (t) => deleteNode(t, "a")],
  ];
  for (const [name, run] of ops) {
    it(`${name} returns a new tree and never mutates the old one`, () => {
      const t = deepFreeze(sample());
      expect(() => run(t)).not.toThrow();
      expect(allPageIds(t)).toEqual(["a", "a1", "a1x", "b", "c"]);
    });
  }

  it("touchPage returns the SAME object for an unknown page, so the caller can skip a write", () => {
    const t = sample();
    expect(touchPage(t, "nope")).toBe(t);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════════════════ */
describe("anything can hold anything — there is no second kind of node", () => {
  it("a page can be created under a page, at any depth", () => {
    let t = sample();
    t = addPage(t, { parentId: "a1x", title: "Deeper", id: "d4" }).tree;
    t = addPage(t, { parentId: "d4", title: "Deeper still", id: "d5" }).tree;
    expect(ancestorIds(t, "d5")).toEqual(["a", "a1", "a1x", "d4"]);
    expect(findPage(t, "d5").depth).toBe(4);
  });

  it("no node carries a kind/type discriminator — a page with children IS a page", () => {
    walkPages(sample(), (p) => {
      expect(p.kind).toBeUndefined();
      expect(p.type).toBeUndefined();
      expect(Array.isArray(p.pages)).toBe(true);
    });
  });

  it("a subpage carries NO projectId of its own — its project is its root's, derived", () => {
    const t = sample();
    expect(findPage(t, "a1").page.projectId).toBeUndefined();
    expect(projectOfPage(t, "a1x")).toBe("GP");
    expect(projectOfPage(t, "c")).toBeNull();
  });

  it("re-parenting a root page STRIPS its projectId, so the fact lives in exactly one place", () => {
    const t = movePage(sample(), "b", "a", 0);
    expect(findPage(t, "b").page.projectId).toBeUndefined();
    expect(projectOfPage(t, "b")).toBe("GP");
  });

  it("lifting a page to the top level gives it a project — the one it came from by default", () => {
    const t = movePage(sample(), "a1x", null, 0);
    expect(findPage(t, "a1x").page.projectId).toBe("GP");
    expect(findPage(t, "a1x").parent).toBeNull();
  });

  it("…or an explicitly named one", () => {
    const t = movePage(sample(), "a1x", null, 0, { projectId: "OTHER" });
    expect(findPage(t, "a1x").page.projectId).toBe("OTHER");
  });

  it("adding a subpage to an unknown parent is a clean no-op, never a throw", () => {
    const r = addPage(sample(), { parentId: "nope", title: "X" });
    expect(r.pageId).toBeNull();
    expect(allPageIds(r.tree)).toEqual(["a", "a1", "a1x", "b", "c"]);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════════════════ */
describe("a page may never be moved into its own subtree", () => {
  it("refuses the move outright rather than detaching the branch", () => {
    const t = sample();
    const after = movePage(t, "a", "a1x", 0);
    expect(allPageIds(after)).toEqual(allPageIds(t));
    expect(findPage(after, "a").parent).toBeNull();
  });

  it("refuses a move onto itself", () => {
    const t = sample();
    expect(allPageIds(movePage(t, "a", "a", 0))).toEqual(allPageIds(t));
  });

  it("⛔ NOTHING RENDERS IN ZERO SCOPES — every page is reachable from exactly one root", () => {
    let t = sample();
    t = movePage(t, "a", "a1", 0);          // refused
    t = movePage(t, "b", "a1x", 0);         // allowed
    t = movePage(t, "c", null, 0, { projectId: "GP" });
    const reachable = new Set();
    for (const root of t.pages) for (const id of subtreePageIds(root)) {
      expect(reachable.has(id), `${id} is reachable twice`).toBe(false);
      reachable.add(id);
    }
    expect([...reachable].sort()).toEqual(allPageIds(t).slice().sort());
    // …and every page is in some project's scope, so no scope can hide one.
    for (const id of allPageIds(t)) {
      const pid = projectOfPage(t, id);
      const scoped = pagesInScope(t, pid, SCOPE_PROJECT).flatMap(subtreePageIds);
      expect(scoped, `${id} renders in no scope`).toContain(id);
    }
  });
});

/* ═══════════════════════════════════════════════════════════════════════════════════════ */
describe("the delete cascade is reported in FULL, at every depth (TOMBSTONE-DELETES)", () => {
  it("deleting a branch reports every page under it", () => {
    const { removedPageIds, entry } = deleteNode(sample(), "a");
    expect(removedPageIds.slice().sort()).toEqual(["a", "a1", "a1x"]);
    expect(entry.pageIds.slice().sort()).toEqual(["a", "a1", "a1x"]);
  });

  it("the deleted branch leaves the live tree entirely", () => {
    const { tree } = deleteNode(sample(), "a");
    expect(allPageIds(tree)).toEqual(["b", "c"]);
    expect(findPage(tree, "a1x")).toBeNull();
  });

  it("the bin still holds the bodies' ids, so the sweep cannot mistake them for orphans", () => {
    const { tree } = deleteNode(sample(), "a");
    expect(trashPageIds(tree).slice().sort()).toEqual(["a", "a1", "a1x"]);
  });

  it("restoring brings the WHOLE subtree back, in its old place", () => {
    const del = deleteNode(sample(), "a");
    const back = restoreNode(del.tree, del.entry.id);
    expect(allPageIds(back.tree)).toEqual(["a", "a1", "a1x", "b", "c"]);
    expect(ancestorIds(back.tree, "a1x")).toEqual(["a", "a1"]);
    expect(findPage(back.tree, "a").page.projectId).toBe("GP");
    expect(trashEntries(back.tree)).toHaveLength(0);
  });

  it("a deleted SUBPAGE returns under its parent", () => {
    const del = deleteNode(sample(), "a1");
    const back = restoreNode(del.tree, del.entry.id);
    expect(ancestorIds(back.tree, "a1x")).toEqual(["a", "a1"]);
  });

  it("a subpage whose parent is gone for good lands at the TOP LEVEL, never nowhere", () => {
    const first = deleteNode(sample(), "a1");
    const second = deleteNode(first.tree, "a");            // the parent, deleted after it
    const purged = purgeTrashEntry(second.tree, second.entry.id);
    const back = restoreNode(purged.tree, first.entry.id);
    expect(findPage(back.tree, "a1")).not.toBeNull();
    expect(findPage(back.tree, "a1").parent).toBeNull();
    expect(findPage(back.tree, "a1").page.projectId).toBe("GP");
  });

  it("restoring a page whose parent is ALSO binned restores the parent first, once", () => {
    const first = deleteNode(sample(), "a1");
    const second = deleteNode(first.tree, "a");
    const back = restoreNode(second.tree, first.entry.id);
    expect(ancestorIds(back.tree, "a1")).toEqual(["a"]);
    expect(allPageIds(back.tree).filter((id) => id === "a1")).toHaveLength(1);
    expect(trashEntries(back.tree)).toHaveLength(0);
  });

  it("purge hands back exactly the ids whose bytes must go", () => {
    const del = deleteNode(sample(), "a");
    const { tree, pageIds } = purgeTrashEntry(del.tree, del.entry.id);
    expect(pageIds.slice().sort()).toEqual(["a", "a1", "a1x"]);
    expect(trashEntries(tree)).toHaveLength(0);
  });

  it("an expired entry is reported for purge, a fresh one is not", () => {
    const old = deleteNode(sample(), "a", { at: 0 });
    expect(expiredTrashIds(old.tree, { now: 40 * 86400000 })).toEqual([old.entry.id]);
    expect(expiredTrashIds(old.tree, { now: 10 })).toEqual([]);
  });

  it("deleting an unknown id is a clean no-op", () => {
    const r = deleteNode(sample(), "nope");
    expect(r.entry).toBeNull();
    expect(allPageIds(r.tree)).toEqual(["a", "a1", "a1x", "b", "c"]);
  });

  it("restoring an unknown entry id is a clean no-op (a double-click on Undo)", () => {
    const r = restoreNode(sample(), "nope");
    expect(r.restored).toBeNull();
    expect(r.pageIds).toEqual([]);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════════════════ */
describe("project scoping — inside a project you see that project, and only that project", () => {
  it("a project's scope is its own root pages", () => {
    expect(pagesInScope(sample(), "GP", SCOPE_PROJECT).map((p) => p.id)).toEqual(["a", "b"]);
  });

  it("a page in no project does NOT leak into a project's scope", () => {
    expect(pagesInScope(sample(), "GP", SCOPE_PROJECT).map((p) => p.id)).not.toContain("c");
  });

  it("with no project selected, everything is in scope — that IS the Dashboard", () => {
    expect(pagesInScope(sample(), null).map((p) => p.id)).toEqual(["a", "b", "c"]);
  });

  it("SCOPE_ALL is the escape hatch and still shows every root", () => {
    expect(pagesInScope(sample(), "GP", SCOPE_ALL).map((p) => p.id)).toEqual(["a", "b", "c"]);
  });

  it("re-filing a top-level page moves it between scopes", () => {
    const t = setPageProject(sample(), "a", "OTHER");
    expect(pagesInScope(t, "GP", SCOPE_PROJECT).map((p) => p.id)).toEqual(["b"]);
    expect(pagesInScope(t, "OTHER", SCOPE_PROJECT).map((p) => p.id)).toEqual(["a"]);
  });

  it("re-filing a SUBPAGE is a no-op — its project is its root's, and may not be forked", () => {
    const t = setPageProject(sample(), "a1", "OTHER");
    expect(findPage(t, "a1").page.projectId).toBeUndefined();
    expect(projectOfPage(t, "a1")).toBe("GP");
  });

  it("boundProjectIds names every project the tree claims, once", () => {
    expect(boundProjectIds(sample())).toEqual(["GP"]);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════════════════ */
describe("the Dashboard groups by project, with the no-project group last", () => {
  it("names each group from the project list", () => {
    const groups = projectGroups(sample(), [{ id: "GP", name: "Grand Port" }]);
    expect(groups.map((g) => g.name)).toEqual(["Grand Port", NO_PROJECT_LABEL]);
    expect(groups[0].pages.map((p) => p.id)).toEqual(["a", "b"]);
    expect(groups[1].pages.map((p) => p.id)).toEqual(["c"]);
  });

  it("a project the list cannot resolve still gets its OWN group, flagged — never folded away", () => {
    const groups = projectGroups(sample(), []);
    expect(groups[0].projectId).toBe("GP");
    expect(groups[0].resolved).toBe(false);
    expect(groups[0].name).toBeNull();
    expect(groups[0].pages.map((p) => p.id)).toEqual(["a", "b"]);
  });

  it("emits no empty groups", () => {
    expect(projectGroups(emptyTree(), [{ id: "GP", name: "Grand Port" }])).toEqual([]);
  });

  it("every root page appears in exactly one group", () => {
    const groups = projectGroups(sample(), [{ id: "GP", name: "Grand Port" }]);
    const ids = groups.flatMap((g) => g.pages.map((p) => p.id));
    expect(ids.slice().sort()).toEqual(["a", "b", "c"]);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════════════════ */
describe("reorder, rename, timestamps, Recent and search", () => {
  it("reorders among siblings, and clamps at both bounds", () => {
    let t = sample();
    t = movePage(t, "b", null, 0);
    expect(t.pages.map((p) => p.id)).toEqual(["b", "a", "c"]);
    t = movePage(t, "b", null, 99);
    expect(t.pages.map((p) => p.id)).toEqual(["a", "c", "b"]);
    t = movePage(t, "b", null, -5);
    expect(t.pages.map((p) => p.id)).toEqual(["b", "a", "c"]);
  });

  it("renames any page at any depth, and refuses to leave one nameless", () => {
    expect(findPage(renameNode(sample(), "a1x", "Surety"), "a1x").page.title).toBe("Surety");
    expect(findPage(renameNode(sample(), "a1x", "   "), "a1x").page.title).toBe("Untitled page");
  });

  it("touchPage stamps only the page it names", () => {
    const t = touchPage(sample(), "a1", 5000);
    expect(findPage(t, "a1").page.updatedAt).toBe(5000);
    expect(findPage(t, "a").page.updatedAt).toBe(100);
  });

  it("Recent lists every page at every depth, newest first, with its trail", () => {
    const t = touchPage(sample(), "a1x", 9999);
    const r = recentPages(t, { projectId: "GP" });
    expect(r[0].pageId).toBe("a1x");
    expect(r[0].trail).toEqual(["Entitlements", "Bonding"]);
    expect(r.map((x) => x.pageId).slice().sort()).toEqual(["a", "a1", "a1x", "b"]);
  });

  it("Recent obeys the project scope", () => {
    expect(recentPages(sample(), { projectId: "GP" }).map((x) => x.pageId)).not.toContain("c");
  });

  it("title search finds a SUBPAGE, and says where it lives", () => {
    const hits = searchTitles(sample(), "surety", { projectId: "GP" });
    expect(hits.map((h) => h.pageId)).toEqual(["a1x"]);
    expect(hits[0].trail).toEqual(["Entitlements", "Bonding"]);
  });

  it("title search is scoped, and empty for an empty query", () => {
    expect(searchTitles(sample(), "scratch", { projectId: "GP" })).toHaveLength(0);
    expect(searchTitles(sample(), "scratch", { projectId: null }).map((h) => h.pageId)).toEqual(["c"]);
    expect(searchTitles(sample(), "  ")).toEqual([]);
  });

  it("firstPageId is the first page in reading order", () => {
    expect(firstPageId(sample())).toBe("a");
    expect(firstPageId(emptyTree())).toBeNull();
  });
});

/* ═══════════════════════════════════════════════════════════════════════════════════════
 * MIGRATION — the owner's own data, and the promise that nothing is lost.
 * ═══════════════════════════════════════════════════════════════════════════════════════ */
describe("migration: four levels → two concepts, on the owner's live data", () => {
  it("stamps the new version and produces pages, not notebooks", () => {
    const t = migrate(OWNER_V2());
    expect(t.v).toBe(NOTES_TREE_VERSION);
    expect(t.notebooks).toBeUndefined();
    expect(Array.isArray(t.pages)).toBe(true);
  });

  it("⛔ PRESERVES EVERY PAGE — not one id is dropped", () => {
    const t = migrate(OWNER_V2());
    for (const id of ["pg1", "pg2", "pg3", "pg4", "pg5", "pg6"]) {
      expect(findPage(t, id), `${id} was lost`).not.toBeNull();
    }
  });

  it("⛔ TWO NOTEBOOKS BOUND TO THE SAME PROJECT MERGE, their sections becoming siblings", () => {
    const t = migrate(OWNER_V2());
    const gp = pagesInScope(t, "GP", SCOPE_PROJECT);
    expect(gp.map((p) => p.title)).toEqual(["Entitlements", "DEV COORDINATION", "Coordination", "Load Study"]);
    const ids = allPageIds(t);
    expect(new Set(ids).size, "an id collided in the merge").toBe(ids.length);
  });

  it("a section KEEPS ITS ID, which is what lets a binned page find its way home", () => {
    const t = migrate(OWNER_V2());
    expect(findPage(t, "sec1").page.title).toBe("Entitlements");
    expect(findPage(t, "sec1").parent).toBeNull();
  });

  it("a section's pages become its subpages, in order", () => {
    const t = migrate(OWNER_V2());
    expect(findPage(t, "sec3").page.pages.map((p) => p.id)).toEqual(["pg3", "pg4"]);
    expect(ancestorIds(t, "pg4")).toEqual(["sec3"]);
  });

  it("a generic 'Section 1' does not survive as a page name — the notebook's name is recovered", () => {
    const t = migrate({ v: 2, notebooks: [{ id: "n", title: "Bonding file", projectId: "GP", sections: [
      { id: "s", title: "Section 1", pages: [{ id: "p1", title: "A" }, { id: "p2", title: "B" }] },
    ] }] });
    expect(t.pages.map((p) => p.title)).toEqual(["Bonding file"]);
    expect(t.pages[0].id).toBe("s");
  });

  it("when BOTH names are noise and there is one page, that page becomes the top-level page", () => {
    const t = migrate(OWNER_V2());
    const loadStudy = findPage(t, "pg5");
    expect(loadStudy.parent).toBeNull();
    expect(loadStudy.page.title).toBe("Load Study");
    expect(loadStudy.page.projectId).toBe("GP");
  });

  it("a MEANINGFUL section name always wins over the notebook's", () => {
    const t = migrate(OWNER_V2());
    expect(findPage(t, "sec1").page.title).toBe("Entitlements");   // not "Grand Port"
  });

  it("a page's timestamps survive the conversion", () => {
    const t = migrate(OWNER_V2());
    expect(findPage(t, "pg1").page.createdAt).toBe(10);
    expect(findPage(t, "pg1").page.updatedAt).toBe(20);
  });

  it("pages under a DIFFERENT project stay in their own scope", () => {
    const t = migrate(OWNER_V2());
    expect(pagesInScope(t, "ADDR", SCOPE_PROJECT).map((p) => p.id)).toEqual(["pg6"]);
    expect(projectOfPage(t, "pg6")).toBe("ADDR");
  });

  it("a LOOSE notebook lands in the no-project home, same shape", () => {
    const t = migrate({ v: 2, notebooks: [{ id: "n", title: "Scratch", projectId: null, sections: [
      { id: "s", title: "Ideas", pages: [{ id: "p", title: "One" }] },
    ] }] });
    expect(t.pages[0].projectId).toBeNull();
    expect(projectGroups(t, []).map((g) => g.name)).toEqual([NO_PROJECT_LABEL]);
  });

  it("⛔ IS IDEMPOTENT — running it twice changes nothing at all", () => {
    const once = migrate(OWNER_V2());
    const twice = migrate(once);
    expect(twice).toEqual(once);
    // …and a third time, because "twice" is only evidence if it is a fixed point.
    expect(migrate(twice)).toEqual(once);
  });

  it("⛔ AND IT SURVIVES A ROUND TRIP THROUGH JSON — the shape rides the tree blob, so this IS the sync path", () => {
    const once = migrate(OWNER_V2());
    expect(migrate(JSON.parse(JSON.stringify(once)))).toEqual(once);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════════════════ */
describe("migration: the 30-day bin comes with it", () => {
  const BINNED = () => ({
    v: 2,
    notebooks: [{ id: "nb", title: "Live", projectId: "GP", sections: [{ id: "s", title: "Sec", pages: [] }] }],
    trash: [
      { id: "t1", kind: "page", node: { id: "gone1", title: "Deleted page" }, parentId: "s", index: 0, title: "Deleted page", deletedAt: 5, pageIds: ["gone1"] },
      { id: "t2", kind: "section", node: { id: "gone2", title: "Deleted section", pages: [{ id: "gone2a", title: "Inside" }] }, parentId: "nb", index: 1, title: "Deleted section", deletedAt: 6, pageIds: ["gone2a"] },
      { id: "t3", kind: "notebook", node: { id: "gone3", title: "Deleted notebook", projectId: "GP", sections: [{ id: "gone3s", title: "S", pages: [{ id: "gone3p", title: "P" }] }] }, parentId: null, index: 2, title: "Deleted notebook", deletedAt: 7, pageIds: ["gone3p"] },
    ],
  });

  it("keeps every entry, and every cascade id on it (the purge depends on them)", () => {
    const t = migrate(BINNED());
    expect(t.trash).toHaveLength(3);
    expect(trashPageIds(t).slice().sort()).toEqual(["gone1", "gone2a", "gone3p"]);
  });

  it("a binned PAGE restores into the page its old section became", () => {
    const back = restoreNode(migrate(BINNED()), "t1");
    expect(ancestorIds(back.tree, "gone1")).toEqual(["s"]);
  });

  it("a binned SECTION restores as a top-level page, with its own pages under it", () => {
    const back = restoreNode(migrate(BINNED()), "t2");
    expect(findPage(back.tree, "gone2").parent).toBeNull();
    expect(ancestorIds(back.tree, "gone2a")).toEqual(["gone2"]);
  });

  it("a binned NOTEBOOK restores WHOLE — one page carrying everything it held", () => {
    const back = restoreNode(migrate(BINNED()), "t3");
    expect(ancestorIds(back.tree, "gone3p")).toEqual(["gone3", "gone3s"]);
    expect(findPage(back.tree, "gone3").page.projectId).toBe("GP");
  });

  it("the migrated bin is idempotent too", () => {
    const once = migrate(BINNED());
    expect(migrate(once)).toEqual(once);
  });

  it("an entry whose node is unreadable can still free its bytes, but honestly refuses to restore", () => {
    const t = migrate({ v: 2, notebooks: [], trash: [{ id: "t", kind: "page", node: null, pageIds: ["x"] }] });
    expect(trashPageIds(t)).toEqual(["x"]);
    expect(trashEntries(t)[0].restorable).toBe(false);
    expect(restoreNode(t, "t").restored).toBeNull();
    expect(purgeTrashEntry(t, "t").pageIds).toEqual(["x"]);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════════════════ */
describe("migrate is tolerant — it never throws and never returns null", () => {
  for (const junk of [null, undefined, 0, "", "x", [], { v: 9 }, { pages: null }, { notebooks: "no" }]) {
    it(`survives ${JSON.stringify(junk)}`, () => {
      const t = migrate(junk);
      expect(Array.isArray(t.pages)).toBe(true);
      expect(Array.isArray(t.trash)).toBe(true);
      expect(t.v).toBe(NOTES_TREE_VERSION);
    });
  }

  it("drops a malformed page rather than refusing to open the tree", () => {
    const t = migrate({ v: 3, pages: [null, { id: "ok", title: "Fine", pages: [null, { id: "kid", title: "K" }] }] });
    expect(allPageIds(t)).toEqual(["ok", "kid"]);
  });

  it("normalises a missing projectId on a root to null, never to undefined", () => {
    const t = migrate({ v: 3, pages: [{ id: "p", title: "T" }] });
    expect(t.pages[0].projectId).toBeNull();
    expect(pagesInScope(t, null)).toHaveLength(1);
  });

  it("a v1/v2 tree with no trash key still migrates", () => {
    const t = migrate({ notebooks: [{ id: "n", title: "N", sections: [{ id: "s", title: "S", pages: [{ id: "p", title: "P" }] }] }] });
    expect(allPageIds(t)).toEqual(["s", "p"]);
    expect(t.trash).toEqual([]);
  });
});
