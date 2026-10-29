/* Model workspace — NEW-1 (2026-10-29): Ctrl+Z while a cell editor is open undid OTHER, earlier sheet
 * edits instead of the typing. The app's window-level undo listener asked nothing about where the key
 * came from. These are the CI-runnable halves: the pure ownership rule, the editor's own history, and
 * source guards that the wiring stays (the browser half is e2e/model-cell-editor-undo.spec.js, which
 * is red on the pre-fix code). */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import { undoKeyKind, undoKeyOwner } from "../src/workspaces/model/lib/undoKeyScope.js";
import { createEditHistory, recordEdit, undoEdit, redoEdit } from "../src/workspaces/model/lib/cellEditHistory.js";

const key = (k, o = {}) => ({ key: k, ctrlKey: true, ...o });

describe("undoKeyKind", () => {
  it("classifies the three chords, either modifier", () => {
    expect(undoKeyKind(key("z"))).toBe("undo");
    expect(undoKeyKind(key("Z", { shiftKey: true }))).toBe("redo");
    expect(undoKeyKind(key("y"))).toBe("redo");
    expect(undoKeyKind({ key: "z", metaKey: true })).toBe("undo");
  });
  it("ignores everything else", () => {
    expect(undoKeyKind({ key: "z" })).toBeNull();
    expect(undoKeyKind(key("a"))).toBeNull();
    expect(undoKeyKind(key("z", { altKey: true }))).toBeNull();
    expect(undoKeyKind(key("y", { shiftKey: true }))).toBeNull();
  });
});

describe("undoKeyOwner", () => {
  it("text controls and an open cell editor own undo; otherwise the sheet does", () => {
    expect(undoKeyOwner({ textControl: true })).toBe("text");
    expect(undoKeyOwner({ cellEditorOpen: true })).toBe("text"); // editor not yet focused (B1287888 window)
    expect(undoKeyOwner({})).toBe("sheet");
  });
});

describe("cell editor history", () => {
  it("walks typing back to the original, then reports nothing left", () => {
    let h = createEditHistory("42");
    h = recordEdit(h, "a"); h = recordEdit(h, "ab"); h = recordEdit(h, "abc");
    let u = undoEdit(h); expect(u.value).toBe("ab"); h = u.history;
    u = undoEdit(h); expect(u.value).toBe("a"); h = u.history;
    u = undoEdit(h); expect(u.value).toBe("42"); expect(u.atStart).toBe(false); h = u.history;
    u = undoEdit(h); expect(u.atStart).toBe(true);
  });
  it("redo restores, and typing after an undo drops the redo tail", () => {
    let h = recordEdit(recordEdit(createEditHistory(""), "x"), "xy");
    h = undoEdit(h).history;
    const r = redoEdit(h); expect(r.value).toBe("xy"); expect(r.changed).toBe(true);
    h = undoEdit(r.history).history;
    h = recordEdit(h, "xz");
    expect(redoEdit(h).changed).toBe(false);
  });
  it("an unchanged value mints no entry", () => {
    const h = createEditHistory("5");
    expect(recordEdit(h, "5")).toBe(h);
  });
});

describe("wiring (source guards)", () => {
  const app = fs.readFileSync("src/workspaces/model/ModelApp.jsx", "utf8");
  const sheet = fs.readFileSync("src/workspaces/model/components/SheetView.jsx", "utf8");
  it("ModelApp's window undo asks who owns the key before firing", () => {
    const i = app.indexOf("undoKeyOwner(");
    expect(i).toBeGreaterThan(-1);
    expect(i).toBeLessThan(app.indexOf("undo(); }"));
    expect(app).toContain("isTextControl(e.target)");
  });
  it("SheetView marks the editing grid and handles undo/redo inside the edit branch", () => {
    expect(sheet).toContain("CELL_EDITING_ATTR");
    const editBranch = sheet.indexOf("if (edit) {");
    expect(sheet.indexOf("undoKeyKind(e)")).toBeGreaterThan(editBranch);
    expect(sheet.indexOf("undoKeyKind(e)")).toBeLessThan(sheet.indexOf('if (e.key === "Enter") { e.preventDefault(); commitEdit('));
  });
});
