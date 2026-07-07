import { describe, it, expect } from "vitest";
import {
  padPrefix,
  childrenOf,
  treeify,
  descendantIds,
  subtreeIds,
  wouldCreateCycle,
  nextOrder,
  validateFolderName,
  suggestNextNumberedName,
  liveRows,
  stripPrefix,
  resolveDrawingTarget,
  matchDropPathToFolder,
  displayLabel,
} from "../src/shared/folders/folderTree.js";

// A small live tree: A(1) -> A1(1), A2(2); B(2) -> B1(1)
const rows = [
  { id: "A", parentId: null, name: "A", order: 1 },
  { id: "B", parentId: null, name: "B", order: 2 },
  { id: "A1", parentId: "A", name: "A1", order: 1 },
  { id: "A2", parentId: "A", name: "A2", order: 2 },
  { id: "B1", parentId: "B", name: "B1", order: 1 },
];

describe("padPrefix", () => {
  it("zero-pads to two digits", () => {
    expect(padPrefix(1)).toBe("01");
    expect(padPrefix(12)).toBe("12");
  });
});

describe("childrenOf / treeify / liveRows", () => {
  it("returns direct children sorted by order, null = top level", () => {
    expect(childrenOf(rows, null).map((r) => r.id)).toEqual(["A", "B"]);
    expect(childrenOf(rows, "A").map((r) => r.id)).toEqual(["A1", "A2"]);
    expect(childrenOf(rows, "B").map((r) => r.id)).toEqual(["B1"]);
  });

  it("treeify nests and sorts at every level", () => {
    const tree = treeify(rows);
    expect(tree.map((n) => n.id)).toEqual(["A", "B"]);
    expect(tree[0].children.map((n) => n.id)).toEqual(["A1", "A2"]);
  });

  it("excludes trashed rows from the live view", () => {
    const withTrash = [...rows, { id: "Z", parentId: null, name: "Z", order: 3, trashed: true }];
    expect(liveRows(withTrash).some((r) => r.id === "Z")).toBe(false);
    expect(childrenOf(withTrash, null).map((r) => r.id)).toEqual(["A", "B"]);
  });

  it("surfaces an orphan (missing/trashed parent) at top level rather than dropping it", () => {
    const orphaned = [{ id: "O", parentId: "ghost", name: "O", order: 1 }];
    expect(treeify(orphaned).map((n) => n.id)).toEqual(["O"]);
  });
});

describe("descendantIds / subtreeIds", () => {
  const deep = [
    { id: "a", parentId: null, name: "a", order: 1 },
    { id: "b", parentId: "a", name: "b", order: 1 },
    { id: "c", parentId: "b", name: "c", order: 1 },
  ];
  it("descendantIds excludes the node itself", () => {
    expect([...descendantIds(deep, "a")].sort()).toEqual(["b", "c"]);
    expect([...descendantIds(deep, "c")]).toEqual([]);
  });
  it("subtreeIds includes the node + all descendants (the delete set)", () => {
    expect([...subtreeIds(deep, "a")].sort()).toEqual(["a", "b", "c"]);
  });
});

describe("wouldCreateCycle (move guard)", () => {
  it("blocks moving a node under itself or a descendant", () => {
    expect(wouldCreateCycle(rows, "A", "A")).toBe(true);
    expect(wouldCreateCycle(rows, "A", "A1")).toBe(true);
  });
  it("allows a legal move (to another branch or the top)", () => {
    expect(wouldCreateCycle(rows, "A1", "B")).toBe(false);
    expect(wouldCreateCycle(rows, "A1", null)).toBe(false);
  });
});

describe("nextOrder", () => {
  it("returns max sibling order + 1 (1 when empty)", () => {
    expect(nextOrder(rows, null)).toBe(3);
    expect(nextOrder(rows, "A")).toBe(3);
    expect(nextOrder(rows, "B1")).toBe(1);
  });
});

describe("validateFolderName", () => {
  const siblings = [{ id: "A1", name: "01. Civil" }, { id: "A2", name: "02. Survey" }];
  it("accepts a clean, unique name (trimmed)", () => {
    expect(validateFolderName("  03. Grading  ", siblings)).toEqual({ ok: true, name: "03. Grading" });
  });
  it("rejects empty / slash / duplicate (case-insensitive)", () => {
    expect(validateFolderName("   ", siblings).ok).toBe(false);
    expect(validateFolderName("a/b", siblings).ok).toBe(false);
    expect(validateFolderName("01. civil", siblings).ok).toBe(false); // dup of "01. Civil"
  });
  it("lets a row keep its own name via excludeId (rename no-op)", () => {
    expect(validateFolderName("01. Civil", siblings, "A1").ok).toBe(true);
  });
});

describe("resolveDrawingTarget — where a drawing files in the standard tree (B650)", () => {
  // A slice of the real template with drive ids on the interesting rows.
  const tree = [
    { id: "design", parentId: null, name: "02. Design", order: 2 },
    { id: "land", parentId: null, name: "08. Land", order: 8 },
    { id: "drawings", parentId: "design", name: "01. Drawings", order: 1, driveFolderId: "d-drawings" },
    { id: "specs", parentId: "design", name: "02. Specifications", order: 2 },
    { id: "civil", parentId: "drawings", name: "05. Civil", order: 5 },
    { id: "civil-cur", parentId: "civil", name: "01. Current", order: 1, driveFolderId: "d-civil-cur" },
    { id: "civil-arc", parentId: "civil", name: "02. Archive", order: 2, driveFolderId: "d-civil-arc" },
    { id: "exhibits", parentId: "drawings", name: "01. Exhibits", order: 1 },
    { id: "ex-cur", parentId: "exhibits", name: "01. Current", order: 1, driveFolderId: "d-ex-cur" },
  ];

  it("stripPrefix drops the numbered prefix, case-insensitively", () => {
    expect(stripPrefix("05. Civil")).toBe("civil");
    expect(stripPrefix("  12. Bldg Acq ")).toBe("bldg acq");
    expect(stripPrefix("Civil")).toBe("civil");
  });

  it("routes a discipline to Design → Drawings → <discipline> → 01. Current", () => {
    const t = resolveDrawingTarget(tree, "Civil");
    expect(t.row.id).toBe("civil-cur");
    expect(t.driveFolderId).toBe("d-civil-cur");
  });

  it("routes archive:true to 02. Archive (superseded revisions)", () => {
    const t = resolveDrawingTarget(tree, "Civil", { archive: true });
    expect(t.row.id).toBe("civil-arc");
    expect(t.driveFolderId).toBe("d-civil-arc");
  });

  it("tolerates a singular/plural mismatch (Exhibit ↔ 01. Exhibits)", () => {
    const t = resolveDrawingTarget(tree, "Exhibit");
    expect(t.row.id).toBe("ex-cur");
  });

  it("unknown discipline lands at the Drawings folder (visible, never hidden)", () => {
    const t = resolveDrawingTarget(tree, "Geotech");
    expect(t.row.id).toBe("drawings");
    expect(t.driveFolderId).toBe("d-drawings");
  });

  it("returns null when the tree has no Design/Drawings (caller keeps its legacy path)", () => {
    expect(resolveDrawingTarget([{ id: "x", parentId: null, name: "Misc", order: 1 }], "Civil")).toBe(null);
    expect(resolveDrawingTarget([], "Civil")).toBe(null);
  });

  it("ignores trashed rows (a deleted Civil folder no longer captures files)", () => {
    const withTrash = tree.map((r) => (r.id === "civil" ? { ...r, trashed: true } : r));
    const t = resolveDrawingTarget(withTrash, "Civil");
    expect(t.row.id).toBe("drawings"); // falls back a level
  });

  it("a matched folder with no Drive id yet reports driveFolderId null (upload keeps legacy path)", () => {
    const noDrive = tree.map((r) => ({ ...r, driveFolderId: null }));
    const t = resolveDrawingTarget(noDrive, "Civil");
    expect(t.row.id).toBe("civil-cur");
    expect(t.driveFolderId).toBe(null);
  });
});

describe("suggestNextNumberedName", () => {
  it("continues the numbered convention (max prefix + 1, zero-padded)", () => {
    const siblings = [{ name: "01. Correspondence" }, { name: "02. Permits" }, { name: "09. Energy" }];
    expect(suggestNextNumberedName(siblings, "New Folder")).toBe("10. New Folder");
  });
  it("falls back to the bare label when no sibling is numbered", () => {
    expect(suggestNextNumberedName([{ name: "Misc" }], "New Folder")).toBe("New Folder");
    expect(suggestNextNumberedName([], "New Folder")).toBe("New Folder");
  });
});

describe("matchDropPathToFolder (B691 — structure-preserving folder drops)", () => {
  const tree = [
    { id: "design", parentId: null, name: "02. Design", order: 2 },
    { id: "drawings", parentId: "design", name: "01. Drawings", order: 1 },
    { id: "exhibits", parentId: "drawings", name: "01. Exhibits", order: 1 },
    { id: "arch", parentId: "drawings", name: "03. Architectural", order: 3 },
    { id: "archCur", parentId: "arch", name: "01. Current", order: 1 },
    { id: "civil", parentId: "drawings", name: "05. Civil", order: 5 },
    { id: "civilCur", parentId: "civil", name: "01. Current", order: 1 },
    { id: "gov", parentId: null, name: "04. Governmental", order: 4 },
    { id: "testing", parentId: null, name: "09. Testing Contractor", order: 9 },
    { id: "reports", parentId: "testing", name: "02. Reports", order: 2 },
    { id: "ghost", parentId: null, name: "99. Civil", order: 99, trashed: true },
  ];

  it("matches the deepest segment, prefix- and case-insensitive (trashed rows ignored)", () => {
    expect(matchDropPathToFolder(tree, ["Goose Creek", "CIVIL"]).id).toBe("civil");
    expect(matchDropPathToFolder(tree, ["05. Civil"]).id).toBe("civil");
  });

  it("walks up past an unknown leaf to the nearest known ancestor", () => {
    expect(matchDropPathToFolder(tree, ["Civil", "Random Subfolder"]).id).toBe("civil");
  });

  it("disambiguates a shared name by its parent segment", () => {
    expect(matchDropPathToFolder(tree, ["Civil", "Current"]).id).toBe("civilCur");
    expect(matchDropPathToFolder(tree, ["Architectural", "Current"]).id).toBe("archCur");
  });

  it("an ambiguous name with no disambiguating parent is NULL — never a guess", () => {
    expect(matchDropPathToFolder(tree, ["Current"])).toBe(null);
    expect(matchDropPathToFolder(tree, ["Nope", "Current"])).toBe(null);
  });

  it("a KNOWN parent segment that contradicts a unique match rejects it — walks up instead of cross-branch guessing", () => {
    // "Reports" is unique (Testing Contractor's) but the path says Design/Reports —
    // filing into Testing Contractor would be a guess; the file lands in Design.
    expect(matchDropPathToFolder(tree, ["Design", "Reports"]).id).toBe("design");
    // Same for a top-level match reached through a foreign known parent.
    expect(matchDropPathToFolder(tree, ["Design", "Governmental"]).id).toBe("design");
    // A corroborating parent still accepts, of course.
    expect(matchDropPathToFolder(tree, ["Testing Contractor", "Reports"]).id).toBe("reports");
  });

  it("an UNKNOWN intermediate is tolerated (an arbitrary grouping folder isn't a contradiction)", () => {
    expect(matchDropPathToFolder(tree, ["My Random Set", "Civil"]).id).toBe("civil");
  });

  it("an ambiguous segment with a non-pinning parent keeps walking up", () => {
    // "Current" is ambiguous and Design pins none of its candidates — but Design IS in
    // the path, so the file lands there rather than in the holding area.
    expect(matchDropPathToFolder(tree, ["Design", "Current"]).id).toBe("design");
  });

  it("no match anywhere / empty chain → null (caller routes to Needs filing)", () => {
    expect(matchDropPathToFolder(tree, ["Totally Unknown"])).toBe(null);
    expect(matchDropPathToFolder(tree, [])).toBe(null);
  });

  it("tolerates singular/plural like the upload resolver (Exhibit ≡ Exhibits)", () => {
    expect(matchDropPathToFolder(tree, ["Exhibit"]).id).toBe("exhibits");
  });
});

describe("displayLabel", () => {
  it("strips the numbered prefix but keeps the case", () => {
    expect(displayLabel("05. Civil")).toBe("Civil");
    expect(displayLabel("Loose Name")).toBe("Loose Name");
    expect(displayLabel(null)).toBe("");
  });
});
