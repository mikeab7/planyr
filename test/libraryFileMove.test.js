import { describe, it, expect } from "vitest";
import {
  FILE_MOVE_TYPE, isFileMoveDrag, isOsFilesDrag, readFileMoveId, moveDecision, disciplineForMove,
  applyOptimisticFolder, fileMenuItems,
} from "../src/workspaces/library/lib/fileMove.js";

const dt = (types, data = {}) => ({ types, getData: (t) => data[t] || "" });
const rows = [{ id: "a", name: "03. Survey" }, { id: "b", name: "09. Geotech" }];
const ids = (o) => fileMenuItems(o).filter((i) => !i.sep).map((i) => i.id);
const base = { pdfRow: true, docRow: false, spatial: false, mapped: false, pinned: false, canPin: true, canHistory: true, canMove: true };

describe("in-app file drag vs OS file drop", () => {
  it("accepts the custom type and reads the id", () => {
    const d = dt([FILE_MOVE_TYPE, "text/plain"], { [FILE_MOVE_TYPE]: "rv1" });
    expect(isFileMoveDrag(d)).toBe(true);
    expect(isOsFilesDrag(d)).toBe(false);
    expect(readFileMoveId(d)).toBe("rv1");
  });
  it("an OS Files payload still routes to upload", () => {
    const d = dt(["Files"]);
    expect(isFileMoveDrag(d)).toBe(false);
    expect(isOsFilesDrag(d)).toBe(true);
    expect(readFileMoveId(d)).toBe(null);
  });
});

describe("moveDecision", () => {
  it("same folder is a no-op", () => expect(moveDecision({ targetFolderId: "a", currentFolderId: "a", folderRows: rows }).action).toBe("noop"));
  it("All files / unknown folder is refused", () => {
    expect(moveDecision({ targetFolderId: null, currentFolderId: "a", folderRows: rows }).action).toBe("refuse");
    expect(moveDecision({ targetFolderId: "zz", currentFolderId: "a", folderRows: rows }).action).toBe("refuse");
  });
  it("a different folder moves", () => expect(moveDecision({ targetFolderId: "b", currentFolderId: "a", folderRows: rows }).action).toBe("move"));
});

describe("disciplineForMove", () => {
  it("keeps a classified file's own discipline", () => expect(disciplineForMove({ discipline: "Survey" }, rows[1])).toBe("Survey"));
  it("an unclassified file takes the folder label, normalised", () => {
    expect(disciplineForMove({ discipline: "Other" }, { name: "05. Civil" })).toBe("Civil");
  });
});

describe("optimistic move + failure restore", () => {
  it("patches the row and a failed move restores it", () => {
    const list = [{ id: "x", folderId: "a" }, { id: "y", folderId: "a" }];
    const { next, restore } = applyOptimisticFolder(list, "x", "b");
    expect(next.find((r) => r.id === "x").folderId).toBe("b");
    expect(next.find((r) => r.id === "y").folderId).toBe("a");
    expect(restore(next).find((r) => r.id === "x").folderId).toBe("a");
  });
});

describe("fileMenuItems", () => {
  it("lists the full set for a PDF drawing to place, in order, Delete last after a separator", () => {
    const items = fileMenuItems({ ...base, spatial: true });
    expect(items.filter((i) => !i.sep).map((i) => i.id)).toEqual(["open", "download", "move", "rename", "share", "versions", "pin", "place", "delete"]);
    expect(items[items.length - 2].sep).toBe(true);
    expect(items[items.length - 1].danger).toBe(true);
  });
  it("Versions is absent for a non-PDF/doc", () => expect(ids({ ...base, pdfRow: false })).not.toContain("versions"));
  it("Place is absent when already mapped, or not spatial", () => {
    expect(ids({ ...base, spatial: true, mapped: true })).not.toContain("place");
    expect(ids(base)).not.toContain("place");
  });
  it("Move is absent without a folder tree; Pin label flips", () => {
    expect(ids({ ...base, canMove: false })).not.toContain("move");
    expect(fileMenuItems({ ...base, pinned: true }).find((i) => i.id === "pin").label).toMatch(/^Unpin/);
  });
});

import fs from "node:fs";
import path from "node:path";
const read = (rel) => fs.readFileSync(path.join(process.cwd(), rel), "utf8");
describe("wiring (source guards)", () => {
  const fb = read("src/workspaces/library/components/FileBrowser.jsx");
  const tree = read("src/workspaces/library/components/FolderTree.jsx");
  it("file rows no longer carry the inline ✕, Versions or Share buttons — the ⋯ menu + right-click do", () => {
    expect(fb).not.toContain("<DeleteButton");
    expect(fb).not.toMatch(/>Versions<\/button>/);
    expect(fb).not.toMatch(/>Share<\/button>/);
    expect(fb).toContain("onContextMenu");
    expect(fb).toContain("More actions for");
    expect(fb).toContain('<ContextMenu');
  });
  it("Delete from the menu is the shared `del` path (soft delete + UndoToast), with no arm step", () => {
    expect(fb).toMatch(/id === "delete"\) del\(f\.id\)/);
  });
  it("drag-to-move and Move to… both end in the ONE fileReviewIntoProject path", () => {
    expect((fb.match(/fileReviewIntoProject\(/g) || []).length).toBe(2); // doRefile + moveFileToFolder
    expect(fb).toContain("moveFileToFolder(f, folderId)");
    expect(fb).toContain("moveFileToFolder(f, movePick.folderId)");
  });
  it("the folder tree accepts the in-app type on folder rows and refuses it on All files; rows are draggable", () => {
    expect(tree).toMatch(/!hasFilesDrag\(e\) && !isFileMoveDrag\(e\.dataTransfer\)/);
    expect(tree).toMatch(/!hasFilesDrag\(e\) \|\| isFileMoveDrag\(e\.dataTransfer\)/);
    expect(fb).toContain("draggable={canDrag");
    expect(fb).toContain("FILE_MOVE_TYPE");
  });
  it("one folder picker serves both the File row and Move to…", () => {
    expect((fb.match(/<FolderPicker/g) || []).length).toBe(2);
  });
  it("the ⋯ is always visible on a coarse pointer and uses no opacity fade", () => {
    const css = read("src/index.css");
    expect(css).toMatch(/@media \(pointer: coarse\)\s*\{\s*\.file-row \.file-kebab\s*\{\s*visibility: visible;/);
    expect(css).not.toMatch(/\.file-kebab[^}]*opacity/);
  });
});
