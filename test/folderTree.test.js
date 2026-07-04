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
