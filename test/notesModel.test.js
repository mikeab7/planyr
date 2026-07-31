/* notesModel — the PURE notebook › section › page tree.
 *
 * The four properties worth defending here are the ones whose failure is silent:
 * purity (a mutator that edits its argument corrupts the caller's state without an error),
 * the DELETE CASCADE (an under-reported cascade orphans page bodies that can never be
 * reached and never be removed — TOMBSTONE-DELETES), project visibility (a loose notebook
 * that stops being visible from inside a project is a notebook you stop using), and a
 * TOLERANT migrate (a notes module that refuses to open because one field is the wrong
 * type is worse than one that drops the field).
 */
import { describe, it, expect } from "vitest";
import {
  addNotebook, addPage, addSection, allPageIds, deleteNode, emptyTree, findPage,
  firstPageId, makeNotebook, migrate, moveNotebook, movePage, moveSection,
  renameNode, searchTitles, setNotebookProject, visibleNotebooks, NOTES_TREE_VERSION,
  boundProjectIds, notebooksInScope, SCOPE_ALL, SCOPE_PROJECT,
} from "../src/workspaces/notes/lib/notesModel.js";

const deepFreeze = (o) => {
  if (o && typeof o === "object" && !Object.isFrozen(o)) { Object.freeze(o); Object.values(o).forEach(deepFreeze); }
  return o;
};

/* A three-notebook fixture with deterministic ids: one bound to project P1, one bound to
 * P2, one loose. Every structural test reads from this. */
function fixture() {
  const tree = {
    v: NOTES_TREE_VERSION,
    notebooks: [
      { id: "nb1", title: "Goose Creek", projectId: "P1", sections: [
        { id: "s1", title: "Due diligence", pages: [{ id: "p1", title: "Site visit" }, { id: "p2", title: "Utilities" }] },
        { id: "s2", title: "Zoning", pages: [{ id: "p3", title: "Setbacks" }] },
      ] },
      { id: "nb2", title: "Katy Prairie", projectId: "P2", sections: [
        { id: "s3", title: "Notes", pages: [{ id: "p4", title: "Broker call" }] },
      ] },
      { id: "nb3", title: "Scratch", projectId: null, sections: [
        { id: "s4", title: "Ideas", pages: [{ id: "p5", title: "Random thought" }] },
      ] },
    ],
  };
  return tree;
}

describe("purity — no mutator touches its input", () => {
  /* Every op runs against a DEEP-FROZEN tree. Under ESM strict mode an in-place write
   * throws, so a mutation shows up as a thrown error rather than as a silent corruption
   * discovered three screens later. */
  const ops = {
    addNotebook: (t) => addNotebook(t, { title: "New" }).tree,
    addSection: (t) => addSection(t, "nb1").tree,
    addPage: (t) => addPage(t, "s1").tree,
    renameNode: (t) => renameNode(t, "p1", "Renamed"),
    "deleteNode(page)": (t) => deleteNode(t, "p1").tree,
    "deleteNode(section)": (t) => deleteNode(t, "s1").tree,
    "deleteNode(notebook)": (t) => deleteNode(t, "nb1").tree,
    movePage: (t) => movePage(t, "p1", "s2", 0),
    moveSection: (t) => moveSection(t, "s1", "nb2", 0),
    moveNotebook: (t) => moveNotebook(t, "nb1", 2),
    setNotebookProject: (t) => setNotebookProject(t, "nb3", "P1"),
  };

  for (const [name, op] of Object.entries(ops)) {
    it(`${name} returns a new tree and leaves the input untouched`, () => {
      const input = deepFreeze(fixture());
      const before = JSON.stringify(input);
      const out = op(input);
      expect(out).not.toBe(input);
      expect(JSON.stringify(input), `${name} mutated its input`).toBe(before);
    });
  }

  it("a returned tree is fully detached — editing it cannot reach back into the input", () => {
    const input = fixture();
    const out = renameNode(input, "p1", "Changed");
    out.notebooks[0].sections[0].pages[0].title = "Edited again";
    expect(input.notebooks[0].sections[0].pages[0].title).toBe("Site visit");
  });
});

describe("the delete cascade is reported in FULL (TOMBSTONE-DELETES)", () => {
  it("deleting a PAGE reports just that page", () => {
    const { tree, removedPageIds, kind } = deleteNode(fixture(), "p1");
    expect(kind).toBe("page");
    expect(removedPageIds).toEqual(["p1"]);
    expect(findPage(tree, "p1")).toBeNull();
    expect(findPage(tree, "p2")).toBeTruthy();
  });

  it("deleting a SECTION reports every page under it", () => {
    const { tree, removedPageIds, kind } = deleteNode(fixture(), "s1");
    expect(kind).toBe("section");
    expect(removedPageIds.sort()).toEqual(["p1", "p2"]);
    expect(allPageIds(tree).sort()).toEqual(["p3", "p4", "p5"]);
  });

  it("deleting a NOTEBOOK reports every page under every one of its sections", () => {
    // The case that matters: the cascade spans TWO sections, so a caller that assumed
    // "the pages of the first section" would silently orphan p3's body forever.
    const { tree, removedPageIds, kind } = deleteNode(fixture(), "nb1");
    expect(kind).toBe("notebook");
    expect(removedPageIds.sort()).toEqual(["p1", "p2", "p3"]);
    expect(allPageIds(tree).sort()).toEqual(["p4", "p5"]);
  });

  it("the cascade set and the pages that actually left the tree are the SAME set", () => {
    for (const id of ["p1", "s1", "s2", "nb1", "nb2", "nb3"]) {
      const before = new Set(allPageIds(fixture()));
      const { tree, removedPageIds } = deleteNode(fixture(), id);
      const after = new Set(allPageIds(tree));
      const gone = [...before].filter((p) => !after.has(p)).sort();
      expect(removedPageIds.slice().sort(), `cascade for ${id}`).toEqual(gone);
    }
  });

  it("deleting an unknown id changes nothing and reports no orphans", () => {
    const { tree, removedPageIds, kind } = deleteNode(fixture(), "nope");
    expect(kind).toBeNull();
    expect(removedPageIds).toEqual([]);
    expect(allPageIds(tree).sort()).toEqual(["p1", "p2", "p3", "p4", "p5"]);
  });
});

describe("project visibility — bound at the NOTEBOOK, and loose notebooks follow you", () => {
  it("a project sees its own notebooks plus every loose one", () => {
    const ids = visibleNotebooks(fixture(), "P1").map((n) => n.id);
    expect(ids).toEqual(["nb1", "nb3"]);
  });

  it("a DIFFERENT project sees its own plus the same loose one — never the other project's", () => {
    const ids = visibleNotebooks(fixture(), "P2").map((n) => n.id);
    expect(ids).toEqual(["nb2", "nb3"]);
    expect(ids).not.toContain("nb1");
  });

  it("the loose notebook is visible from EVERY project — a scratchpad you can't reach is one you stop using", () => {
    for (const p of ["P1", "P2", "P9-never-seen"]) {
      expect(visibleNotebooks(fixture(), p).map((n) => n.id)).toContain("nb3");
    }
  });

  it("with no project selected nothing is out of scope", () => {
    expect(visibleNotebooks(fixture(), null).map((n) => n.id)).toEqual(["nb1", "nb2", "nb3"]);
  });

  it("re-binding a notebook moves which projects can see it", () => {
    const t = setNotebookProject(fixture(), "nb3", "P2");
    expect(visibleNotebooks(t, "P1").map((n) => n.id)).toEqual(["nb1"]);
    expect(visibleNotebooks(t, "P2").map((n) => n.id)).toEqual(["nb2", "nb3"]);
  });

  it("unbinding back to null makes it loose again", () => {
    const t = setNotebookProject(setNotebookProject(fixture(), "nb3", "P2"), "nb3", null);
    expect(visibleNotebooks(t, "P1").map((n) => n.id)).toContain("nb3");
  });
});

/* B1374 — the ESCAPE HATCH. `visibleNotebooks` above is a correct filter and was never the
 * defect; the defect was that it was the ONLY view, so a notebook bound to a project you are
 * not in was invisible from every screen but one. These are about the property that closes
 * that: from anywhere, everything is reachable. */
describe("scope — nothing can become unreachable", () => {
  it("the project scope is exactly the old filter — the default behaviour is unchanged", () => {
    expect(notebooksInScope(fixture(), "P1", SCOPE_PROJECT).map((n) => n.id))
      .toEqual(visibleNotebooks(fixture(), "P1").map((n) => n.id));
  });

  it("THE ALL SCOPE REACHES EVERY NOTEBOOK, from inside any project", () => {
    for (const p of ["P1", "P2", "P9-never-seen"]) {
      expect(notebooksInScope(fixture(), p, SCOPE_ALL).map((n) => n.id)).toEqual(["nb1", "nb2", "nb3"]);
    }
  });

  it("a notebook bound to a project that NO LONGER EXISTS is still reachable — the unreachable case, refuted", () => {
    const t = setNotebookProject(fixture(), "nb3", "P-deleted-long-ago");
    // Invisible from every project, which is correct and is exactly why ALL must exist…
    expect(visibleNotebooks(t, "P1").map((n) => n.id)).not.toContain("nb3");
    expect(visibleNotebooks(t, "P2").map((n) => n.id)).not.toContain("nb3");
    // …and it is one click away from every one of them.
    expect(notebooksInScope(t, "P1", SCOPE_ALL).map((n) => n.id)).toContain("nb3");
    // The dashboard sees it too, so there is a second way home.
    expect(notebooksInScope(t, null, SCOPE_PROJECT).map((n) => n.id)).toContain("nb3");
  });

  it("EVERY notebook in the tree appears in SOME scope, for every project — stated as a property", () => {
    const t = setNotebookProject(fixture(), "nb3", "P-gone");
    for (const p of ["P1", "P2", "P-unrelated", null]) {
      const reachable = new Set([
        ...notebooksInScope(t, p, SCOPE_PROJECT).map((n) => n.id),
        ...notebooksInScope(t, p, SCOPE_ALL).map((n) => n.id),
      ]);
      expect([...reachable].sort()).toEqual(["nb1", "nb2", "nb3"]);
    }
  });

  it("with no project selected the scope is moot — both answers are everything", () => {
    expect(notebooksInScope(fixture(), null, SCOPE_PROJECT).map((n) => n.id)).toEqual(["nb1", "nb2", "nb3"]);
    expect(notebooksInScope(fixture(), null, SCOPE_ALL).map((n) => n.id)).toEqual(["nb1", "nb2", "nb3"]);
  });

  it("reports which projects notebooks claim, in tree order and without repeats", () => {
    expect(boundProjectIds(fixture())).toEqual(["P1", "P2"]);
    expect(boundProjectIds(emptyTree())).toEqual([]);
  });

  it("neither scope function mutates the tree it is handed", () => {
    const t = Object.freeze(fixture());
    expect(() => { notebooksInScope(t, "P1", SCOPE_ALL); boundProjectIds(t); }).not.toThrow();
  });
});

describe("move and reorder, including the bounds", () => {
  it("moves a page to another section at an index", () => {
    const t = movePage(fixture(), "p1", "s2", 0);
    expect(t.notebooks[0].sections[1].pages.map((p) => p.id)).toEqual(["p1", "p3"]);
    expect(t.notebooks[0].sections[0].pages.map((p) => p.id)).toEqual(["p2"]);
  });

  it("reorders within the same section", () => {
    const t = movePage(fixture(), "p1", "s1", 1);
    expect(t.notebooks[0].sections[0].pages.map((p) => p.id)).toEqual(["p2", "p1"]);
  });

  it("a NEGATIVE index clamps to the front rather than throwing", () => {
    const t = movePage(fixture(), "p3", "s1", -99);
    expect(t.notebooks[0].sections[0].pages.map((p) => p.id)).toEqual(["p3", "p1", "p2"]);
  });

  it("an OVER-LONG index clamps to the end rather than throwing", () => {
    const t = movePage(fixture(), "p3", "s1", 999);
    expect(t.notebooks[0].sections[0].pages.map((p) => p.id)).toEqual(["p1", "p2", "p3"]);
  });

  it("a non-numeric index lands last rather than producing a hole", () => {
    const t = movePage(fixture(), "p3", "s1", undefined);
    expect(t.notebooks[0].sections[0].pages.map((p) => p.id)).toEqual(["p1", "p2", "p3"]);
    expect(t.notebooks[0].sections[0].pages.every(Boolean)).toBe(true);
  });

  it("no move ever loses or duplicates a page", () => {
    for (const idx of [-5, 0, 1, 50]) {
      const t = movePage(fixture(), "p1", "s3", idx);
      const ids = allPageIds(t).sort();
      expect(ids).toEqual(["p1", "p2", "p3", "p4", "p5"]);
    }
  });

  it("moves a section between notebooks, carrying its pages", () => {
    const t = moveSection(fixture(), "s1", "nb2", 0);
    expect(t.notebooks[1].sections.map((s) => s.id)).toEqual(["s1", "s3"]);
    expect(t.notebooks[0].sections.map((s) => s.id)).toEqual(["s2"]);
    expect(allPageIds(t).sort()).toEqual(["p1", "p2", "p3", "p4", "p5"]);
  });

  it("reorders notebooks, clamping out-of-range indices", () => {
    expect(moveNotebook(fixture(), "nb1", 99).notebooks.map((n) => n.id)).toEqual(["nb2", "nb3", "nb1"]);
    expect(moveNotebook(fixture(), "nb3", -1).notebooks.map((n) => n.id)).toEqual(["nb3", "nb1", "nb2"]);
  });

  it("moving to an unknown target is a no-op, not a lost page", () => {
    const t = movePage(fixture(), "p1", "no-such-section", 0);
    expect(allPageIds(t).sort()).toEqual(["p1", "p2", "p3", "p4", "p5"]);
  });
});

describe("construction — a new notebook is born ready to type in", () => {
  it("a new notebook arrives with one section and one page", () => {
    const nb = makeNotebook({ title: "Fresh" });
    expect(nb.sections).toHaveLength(1);
    expect(nb.sections[0].pages).toHaveLength(1);
  });

  it("addNotebook hands back the ids the caller needs to open the page immediately", () => {
    const r = addNotebook(emptyTree(), { title: "Fresh", projectId: "P7" });
    expect(r.notebookId).toBeTruthy();
    expect(r.sectionId).toBeTruthy();
    expect(r.pageId).toBeTruthy();
    expect(findPage(r.tree, r.pageId)).toBeTruthy();
    expect(r.tree.notebooks[0].projectId).toBe("P7");
  });

  it("a new SECTION also arrives with a page, for the same reason", () => {
    const r = addSection(fixture(), "nb1");
    expect(r.pageId).toBeTruthy();
    expect(findPage(r.tree, r.pageId)).toBeTruthy();
  });

  it("addSection / addPage against an unknown parent report null rather than throwing", () => {
    expect(addSection(fixture(), "nope").sectionId).toBeNull();
    expect(addPage(fixture(), "nope").pageId).toBeNull();
  });

  it("ids are unique across many creations", () => {
    let t = emptyTree();
    for (let i = 0; i < 60; i += 1) t = addNotebook(t, {}).tree;
    const ids = allPageIds(t);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("firstPageId picks a landing page, and is null on an empty tree", () => {
    expect(firstPageId(fixture())).toBe("p1");
    expect(firstPageId(emptyTree())).toBeNull();
  });
});

describe("rename", () => {
  it("renames a notebook, a section and a page by id", () => {
    let t = renameNode(fixture(), "nb1", "Renamed book");
    t = renameNode(t, "s1", "Renamed section");
    t = renameNode(t, "p1", "Renamed page");
    expect(t.notebooks[0].title).toBe("Renamed book");
    expect(t.notebooks[0].sections[0].title).toBe("Renamed section");
    expect(t.notebooks[0].sections[0].pages[0].title).toBe("Renamed page");
  });

  it("an all-whitespace rename falls back to a readable default instead of a blank row", () => {
    expect(renameNode(fixture(), "p1", "   ").notebooks[0].sections[0].pages[0].title).toBe("Untitled page");
    expect(renameNode(fixture(), "s1", "").notebooks[0].sections[0].title).toBe("Untitled section");
    expect(renameNode(fixture(), "nb1", "  ").notebooks[0].title).toBe("Untitled notebook");
  });
});

describe("title search", () => {
  it("matches case-insensitively on page titles", () => {
    expect(searchTitles(fixture(), "SITE").map((h) => h.pageId)).toEqual(["p1"]);
  });

  it("carries the notebook and section a hit belongs to, so the result can be placed", () => {
    const [hit] = searchTitles(fixture(), "setbacks");
    expect(hit).toMatchObject({ pageId: "p3", sectionTitle: "Zoning", notebookTitle: "Goose Creek", where: "title" });
  });

  it("respects project visibility — another project's pages never leak into results", () => {
    expect(searchTitles(fixture(), "broker", { projectId: "P1" })).toEqual([]);
    expect(searchTitles(fixture(), "broker", { projectId: "P2" }).map((h) => h.pageId)).toEqual(["p4"]);
  });

  it("an empty query returns nothing rather than everything", () => {
    expect(searchTitles(fixture(), "")).toEqual([]);
    expect(searchTitles(fixture(), "   ")).toEqual([]);
  });
});

describe("migrate is tolerant — it never throws and never returns null", () => {
  const junk = [null, undefined, 0, "", "a string", [], { }, { notebooks: null }, { notebooks: "no" }, NaN, true];
  for (const v of junk) {
    it(`${JSON.stringify(v) ?? String(v)} migrates to an empty tree`, () => {
      const t = migrate(v);
      expect(t.notebooks).toEqual([]);
      expect(t.v).toBe(NOTES_TREE_VERSION);
    });
  }

  it("keeps well-formed content unchanged in shape", () => {
    const t = migrate(fixture());
    expect(allPageIds(t).sort()).toEqual(["p1", "p2", "p3", "p4", "p5"]);
    expect(t.notebooks[2].projectId).toBeNull();
  });

  it("drops junk MEMBERS while keeping their well-formed siblings", () => {
    const t = migrate({ notebooks: [null, { id: "ok", title: "Fine", sections: [
      "not a section", { id: "s", title: "S", pages: [null, { id: "p", title: "P" }, 7] },
    ] }, 42] });
    expect(t.notebooks).toHaveLength(1);
    expect(t.notebooks[0].sections).toHaveLength(1);
    expect(allPageIds(t)).toEqual(["p"]);
  });

  it("repairs wrong-typed titles rather than propagating them into the UI", () => {
    const t = migrate({ notebooks: [{ id: "n", title: 99, sections: [{ id: "s", title: [], pages: [{ id: "p", title: { } }] }] }] });
    expect(t.notebooks[0].title).toBe("Untitled notebook");
    expect(t.notebooks[0].sections[0].title).toBe("Untitled section");
    expect(t.notebooks[0].sections[0].pages[0].title).toBe("Untitled page");
  });

  it("mints ids for nodes that arrive without one, so nothing becomes unaddressable", () => {
    const t = migrate({ notebooks: [{ title: "No id", sections: [{ title: "No id", pages: [{ title: "No id" }] }] }] });
    expect(t.notebooks[0].id).toBeTruthy();
    expect(allPageIds(t)[0]).toBeTruthy();
  });

  it("normalises a missing projectId to null (loose), never to undefined", () => {
    const t = migrate({ notebooks: [{ id: "n", title: "T", sections: [] }] });
    expect(t.notebooks[0].projectId).toBeNull();
    expect(visibleNotebooks(t, "any-project")).toHaveLength(1);
  });

  it("stamps the current version onto a tree that claims a future one", () => {
    expect(migrate({ v: 999, notebooks: [] }).v).toBe(NOTES_TREE_VERSION);
  });
});
