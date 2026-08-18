import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { indentSelection, outdentSelection, promoteChildrenAndDelete, flatOrderWithLevel } from "../ui-audit/stress/schedule-tree-ops.mjs";

// Fast, CI-runnable half of the multi-row indent/outdent + delete-with-children fix. The full
// real-browser proof (both entry points, both undo, health rollup, mutation-proven) lives in
// ui-audit/verify-schedule-indent-outdent-delete.mjs — NOT wired into CI
// (.github/workflows/build.yml invokes no ui-audit/verify-*.mjs script; this file exists but is
// not enforced). These are pure-function unit tests plus source-pin regexes so a regression here
// is at least caught on every push, even though the live-browser proof only runs on demand.
//
// Owner report: a multi-row selection ("highlighted all these... shift alt right... only indented
// the top one") was ignored by BOTH the keyboard shortcut and the right-click menu — both read a
// single anchor task id and never consulted the selection range. Fixed by resolving the whole row
// range first (rowRangeSelIds/structuralTargets in index.html) and passing every id through these
// pure functions in one batch. Separately: deleting a row with subtasks now asks (cascade vs.
// promote-to-parent) instead of silently doing either.

const T = (id, over = {}) => ({ id, name: "t" + id, parentId: null, isExpanded: true, ...over });

describe("indentSelection — whole-block indent, all-or-nothing on the topmost row", () => {
  it("a single selected row behaves exactly like the pre-existing single-row indent", () => {
    // 1 (root) -> 2, 3 siblings; indent 3 alone under 2.
    const tasks = [T(1), T(2, { parentId: 1 }), T(3, { parentId: 1 })];
    const out = indentSelection(tasks, [3]);
    expect(out.find(t => t.id === 3).parentId).toBe(2);
  });

  it("a contiguous block moves together, not just one row (the reported bug)", () => {
    // 1 -> 2 (target), 3, 4, 5 (siblings of 2, all children of 1). Select 3,4,5 and indent: all
    // three become children of 2, preserving their relative order.
    const tasks = [T(1), T(2, { parentId: 1 }), T(3, { parentId: 1 }), T(4, { parentId: 1 }), T(5, { parentId: 1 })];
    const out = indentSelection(tasks, [3, 4, 5]);
    expect(out.find(t => t.id === 3).parentId).toBe(2);
    expect(out.find(t => t.id === 4).parentId).toBe(2);
    expect(out.find(t => t.id === 5).parentId).toBe(2);
  });

  it("a block whose TOPMOST row has no eligible predecessor is a clean no-op for the WHOLE block", () => {
    // 1 -> 2, 3, 4 (2 is the FIRST child, no sibling above it). Selecting 2,3,4 and indenting must
    // not move ANY of them, even though 3 and 4 (in isolation) could find 2 as a target.
    const tasks = [T(1), T(2, { parentId: 1 }), T(3, { parentId: 1 }), T(4, { parentId: 1 })];
    expect(indentSelection(tasks, [2, 3, 4])).toBeNull();
  });

  it("selection spanning different depths (a parent + its own children) preserves relative depth", () => {
    // 1 -> 2 (target sibling), 3 (parent) -> 4, 5 (children of 3). Select 3,4,5 together; only 3
    // (the one ROOT row) reparents to 2 — 4 and 5 keep parentId=3 untouched, following 3 down.
    const tasks = [T(1), T(2, { parentId: 1 }), T(3, { parentId: 1 }), T(4, { parentId: 3 }), T(5, { parentId: 3 })];
    const out = indentSelection(tasks, [3, 4, 5]);
    expect(out.find(t => t.id === 3).parentId).toBe(2);
    expect(out.find(t => t.id === 4).parentId).toBe(3); // untouched — still under 3
    expect(out.find(t => t.id === 5).parentId).toBe(3);
  });

  it("indenting a selection already fully under the target parent is a no-op", () => {
    const tasks = [T(1), T(2, { parentId: 1 }), T(3, { parentId: 2 })];
    expect(indentSelection(tasks, [3])).toBeNull();
  });

  it("an id not present in the tree is dropped, not thrown on", () => {
    const tasks = [T(1), T(2, { parentId: 1 }), T(3, { parentId: 1 })];
    expect(() => indentSelection(tasks, [999, 3])).not.toThrow();
  });

  it("an empty or all-invalid selection returns null rather than throwing", () => {
    const tasks = [T(1), T(2, { parentId: 1 })];
    expect(indentSelection(tasks, [])).toBeNull();
    expect(indentSelection(tasks, [999])).toBeNull();
  });

  it("a milestone (duration/typed fields untouched by this function) indents like any other row", () => {
    const tasks = [T(1), T(2, { parentId: 1 }), T(3, { parentId: 1, duration: 0, durValue: 0 })];
    const out = indentSelection(tasks, [3]);
    const moved = out.find(t => t.id === 3);
    expect(moved.parentId).toBe(2);
    expect(moved.duration).toBe(0); // untouched — recompute (outside this pure function) owns dates
  });
});

describe("outdentSelection — per-row, depth-0 rows skipped, adjacent same-parent runs batched", () => {
  it("a single selected row behaves exactly like the pre-existing single-row outdent", () => {
    const tasks = [T(1), T(2, { parentId: 1 }), T(3, { parentId: 2 })];
    const out = outdentSelection(tasks, [3]);
    expect(out.find(t => t.id === 3).parentId).toBe(1);
  });

  it("OUTDENT AT DEPTH ZERO is a clean no-op, not a throw", () => {
    const tasks = [T(1), T(2)];
    expect(outdentSelection(tasks, [1])).toBeNull();
    expect(() => outdentSelection(tasks, [1])).not.toThrow();
  });

  it("a contiguous run of siblings outdents together, keeping relative order", () => {
    // 1 -> 2 -> 3,4,5,6 (all children of 2). Outdent 4,5 (middle two): both promote to 1, in order.
    const tasks = [T(1), T(2, { parentId: 1 }), T(3, { parentId: 2 }), T(4, { parentId: 2 }), T(5, { parentId: 2 }), T(6, { parentId: 2 })];
    const out = outdentSelection(tasks, [4, 5]);
    expect(out.find(t => t.id === 4).parentId).toBe(1);
    expect(out.find(t => t.id === 5).parentId).toBe(1);
    expect(out.find(t => t.id === 3).parentId).toBe(2); // untouched sibling stays put
    expect(out.find(t => t.id === 6).parentId).toBe(2);
    const order = out.map(t => t.id);
    expect(order.indexOf(4)).toBeLessThan(order.indexOf(5)); // relative order preserved
    // both promoted rows land after 2's own remaining subtree (3 and 6), before whatever follows
    expect(order.indexOf(4)).toBeGreaterThan(order.indexOf(6));
  });

  it("moving a run one row at a time would reverse it — batching prevents that (regression pin)", () => {
    // Same fixture as above; a naive per-row splice (re-deriving 'the end of the shrinking
    // remaining subtree' for each row independently) puts row 5 ahead of row 4. This test exists
    // specifically to catch that regression if outdentSelection is ever rewritten to loop per-row.
    const tasks = [T(1), T(2, { parentId: 1 }), T(3, { parentId: 2 }), T(4, { parentId: 2 }), T(5, { parentId: 2 }), T(6, { parentId: 2 })];
    const out = outdentSelection(tasks, [4, 5]);
    const order = out.map(t => t.id);
    expect(order.indexOf(4) < order.indexOf(5)).toBe(true);
  });

  it("outdenting a parent takes its children along, preserving their relative depth", () => {
    // 1 -> 2 -> 3 (parent, child of 2) -> 4,5 (children of 3). Outdent 3 alone: 3 moves to 1's
    // level (child of 1); 4 and 5 keep parentId=3, unaffected — still one level under 3.
    const tasks = [T(1), T(2, { parentId: 1 }), T(3, { parentId: 2 }), T(4, { parentId: 3 }), T(5, { parentId: 3 })];
    const out = outdentSelection(tasks, [3]);
    expect(out.find(t => t.id === 3).parentId).toBe(1);
    expect(out.find(t => t.id === 4).parentId).toBe(3);
    expect(out.find(t => t.id === 5).parentId).toBe(3);
  });

  it("a mixed selection (one depth-0 row + one deeper root row) moves what it can, skips the rest", () => {
    const tasks = [T(1), T(2, { parentId: 1 }), T(3, { parentId: 2 }), T(4)]; // 4 is already depth 0
    const out = outdentSelection(tasks, [3, 4]);
    expect(out.find(t => t.id === 3).parentId).toBe(1); // promoted
    expect(out.find(t => t.id === 4).parentId).toBe(null); // untouched, was already top-level
  });

  it("an orphaned parentId (points at a missing task) is skipped, not dereferenced", () => {
    const tasks = [T(1, { parentId: 999 })];
    expect(() => outdentSelection(tasks, [1])).not.toThrow();
    expect(outdentSelection(tasks, [1])).toBeNull();
  });
});

describe("promoteChildrenAndDelete — 'keep subtasks' delete path", () => {
  it("deletes exactly the given ids; every child promotes to the deleted row's own parent", () => {
    const tasks = [T(1), T(2, { parentId: 1 }), T(3, { parentId: 2 }), T(4, { parentId: 2 })];
    const out = promoteChildrenAndDelete(tasks, [2]);
    expect(out.find(t => t.id === 2)).toBeUndefined();
    expect(out.find(t => t.id === 3).parentId).toBe(1);
    expect(out.find(t => t.id === 4).parentId).toBe(1);
    expect(out.length).toBe(3); // nothing else lost
  });

  it("a multi-level subtree preserves relative depth under the promoted children (not flattened)", () => {
    const tasks = [T(1), T(2, { parentId: 1 }), T(3, { parentId: 2 }), T(4, { parentId: 3 })];
    const out = promoteChildrenAndDelete(tasks, [2]);
    expect(out.find(t => t.id === 3).parentId).toBe(1); // promoted to grandparent
    expect(out.find(t => t.id === 4).parentId).toBe(3); // untouched — still one level under 3
  });

  it("deleting a whole CHAIN of ancestors together promotes transitively past all of them", () => {
    // Delete BOTH 2 and 3 (parent + its own child) at once — 4 (child of 3) must land on 1, the
    // nearest surviving ancestor, not on the also-deleted 2 or 3.
    const tasks = [T(1), T(2, { parentId: 1 }), T(3, { parentId: 2 }), T(4, { parentId: 3 })];
    const out = promoteChildrenAndDelete(tasks, [2, 3]);
    expect(out.find(t => t.id === 4).parentId).toBe(1);
  });

  it("deleting the LAST remaining child of a group leaves the group correctly childless (no crash)", () => {
    const tasks = [T(1), T(2, { parentId: 1 })];
    const out = promoteChildrenAndDelete(tasks, [2]);
    expect(out).toEqual([T(1)]);
  });

  it("a row with NO children deletes with nothing to promote (no-op beyond removing itself)", () => {
    const tasks = [T(1), T(2, { parentId: 1 })];
    const out = promoteChildrenAndDelete(tasks, [2]);
    expect(out.length).toBe(1);
  });

  it("children whose predecessor points OUTSIDE the deleted subtree keep that reference untouched", () => {
    const tasks = [T(1), T(2, { parentId: 1 }), T(3, { parentId: 2, predecessors: [{ id: 1, type: "FS" }] })];
    const out = promoteChildrenAndDelete(tasks, [2]);
    expect(out.find(t => t.id === 3).predecessors).toEqual([{ id: 1, type: "FS" }]);
  });

  it("data safety: the child count before/after matches exactly what was asked for — nothing extra vanishes", () => {
    const tasks = [T(1), T(2, { parentId: 1 }), T(3, { parentId: 2 }), T(4, { parentId: 2 }), T(5)]; // 5 is unrelated
    const out = promoteChildrenAndDelete(tasks, [2]);
    expect(out.map(t => t.id).sort()).toEqual([1, 3, 4, 5]); // exactly "2" is gone
  });
});

describe("flatOrderWithLevel — the shared visual-order walk indent/outdent both read", () => {
  it("respects isExpanded — a collapsed subtree's descendants get no level assigned via this walk's visible path", () => {
    const tasks = [T(1, { isExpanded: false }), T(2, { parentId: 1 })];
    const out = flatOrderWithLevel(tasks);
    expect(out.map(t => t.id)).toEqual([1]); // 2 is not walked into
  });

  it("a parentId cycle does not infinite-loop (tasks not reachable from the root are simply omitted)", () => {
    const tasks = [T(1, { parentId: 2 }), T(2, { parentId: 1 })];
    expect(() => flatOrderWithLevel(tasks)).not.toThrow();
  });
});

// ── Source-pin: the fast anchors a CI push can check without a browser ──────────────────────────
describe("wiring in public/sequence/index.html", () => {
  const src = readFileSync(fileURLToPath(new URL("../public/sequence/index.html", import.meta.url)), "utf8");
  const mjs = readFileSync(fileURLToPath(new URL("../ui-audit/stress/schedule-tree-ops.mjs", import.meta.url)), "utf8");

  it("the pure tree-mutation functions in the mirror match the real source verbatim (drift guard)", () => {
    for (const fnBody of [
      "const flatOrderWithLevel = (tasks) => {",
      "const indentSelection = (tasks, selectedIds) => {",
      "const outdentSelection = (tasks, selectedIds) => {",
      "const promoteChildrenAndDelete = (tasks, deleteIds) => {",
    ]) {
      const exported = fnBody.replace("const ", "export const ");
      expect(src.includes(fnBody), `"${fnBody}" missing from index.html`).toBe(true);
      expect(mjs.includes(exported), `"${exported}" missing from schedule-tree-ops.mjs`).toBe(true);
    }
    // Pin the load-bearing lines that are easy to "simplify" away by accident.
    expect(src).toMatch(/if \(flatOrder\[i\]\.level < L\) break; \/\/ hit the topmost row's own parent first/);
    expect(src).toMatch(/if \(rootIds\.every\(id => flatOrder\[posById\.get\(id\)\]\.parentId === newParent\.id\)\) return null;/);
    expect(src).toMatch(/if \(last && last\.parentId === t\.parentId\) last\.ids\.push\(id\);/);
    expect(src).toMatch(/while \(cur !== null && cur !== undefined && delSet\.has\(cur\)\) cur = byId\.get\(cur\)\?\.parentId \?\? null;/);
  });

  it("BOTH keyboard entry points resolve the whole selection via structuralTargets, not a bare selectedId", () => {
    expect(src).toMatch(/if \(!e\.repeat && selectedId !== null\) indentSelectionByIds\(structuralTargets\(selectedId\)\);/);
    expect(src).toMatch(/if \(!e\.repeat && selectedId !== null\) outdentSelectionByIds\(structuralTargets\(selectedId\)\);/);
    // REVERT-proof: the old single-anchor calls must be gone, not just supplemented.
    expect(src).not.toMatch(/indentTaskById\(selectedId\)/);
    expect(src).not.toMatch(/outdentTaskById\(selectedId\)/);
  });

  it("the CONTEXT MENU indent/outdent also resolve the whole selection, and canOutdent reflects it", () => {
    expect(src).toMatch(/onIndent=\{\(\) => \{ indentSelectionByIds\(structuralTargets\(taskCtx\.task\.id\)\); setTaskCtx\(null\); \}\}/);
    expect(src).toMatch(/onOutdent=\{\(\) => \{ outdentSelectionByIds\(structuralTargets\(taskCtx\.task\.id\)\); setTaskCtx\(null\); \}\}/);
    expect(src).toMatch(/canOutdent=\{\(\(\) => \{/);
  });

  it("rowRangeSelIds requires a genuine multi-row range (never mistakes a single row for one)", () => {
    expect(src).toMatch(/const rowRangeSelIds = \(\) => \{[\s\S]{0,300}if \(r2 <= r1\) return \[\];/);
  });

  it("requestDelete deletes a childless selection immediately — no prompt gains an extra click", () => {
    expect(src).toMatch(/const hasAnyChildren = taskIds\.some\(id => all\.some\(t => t\.parentId === id\)\);/);
    expect(src).toMatch(/if \(!hasAnyChildren\) \{[\s\S]{0,200}deleteTasks\(taskIds\);/);
  });

  it("both delete entry points (keyboard full-row Delete, context menu) now call requestDelete, not a bare deleteTasks", () => {
    expect(src).toMatch(/requestDelete\(ids\.length \? ids : \[selectedId\]\);/);
    expect(src).toMatch(/requestDelete\(ids\.length > 1 && ids\.includes\(taskCtx\.task\.id\) \? ids : \[taskCtx\.task\.id\]\);/);
  });

  it("the delete-children modal reuses FOOTER_BTN_STYLE directly — one shared object, not a look-alike copy", () => {
    expect(src).toMatch(/function DeleteChildrenModal\(\{ rowCount, totalCount, onCascade, onPromote, onCancel \}\) \{/);
    expect(src).toMatch(/<button data-delete-children-choice="cancel" onClick=\{onCancel\} style=\{FOOTER_BTN_STYLE\}/);
    expect(src).toMatch(/<button data-delete-children-choice="promote" onClick=\{onPromote\} style=\{FOOTER_BTN_STYLE\}/);
    expect(src).toMatch(/<button data-delete-children-choice="cascade" onClick=\{onCascade\}[\s\S]{0,40}style=\{\{\.\.\.FOOTER_BTN_STYLE,/);
  });

  it("the delete-children prompt is latched into the overlay guard — a keystroke can't leak through to the grid behind it", () => {
    expect(src).toMatch(/overlayOpenRef\.current = !!\(successorPrompt \|\| notesCtx \|\| projCtx \|\| taskCtx \|\| renameModal \|\|\s*\n\s*deleteChoice \|\|/);
    expect(src).toMatch(/\}, \[successorPrompt, notesCtx, projCtx, taskCtx, renameModal, deleteChoice,/);
  });

  it("promoteAndDeleteTasks reuses the SAME notifyRowsDeleted toast (no duplicate UI for the promote path)", () => {
    expect(src).toMatch(/const promoteAndDeleteTasks = useCallback\(\(taskIds\) => \{[\s\S]{0,400}notifyRowsDeleted\(taskIds\.length, taskIds\.length\);/);
  });

  it("the dead indentTaskById/outdentTaskById props are fully gone from GridView's signature and the shared object (no ReferenceError)", () => {
    expect(src).not.toMatch(/\bindentTaskById\b/);
    expect(src).not.toMatch(/\boutdentTaskById\b/);
  });
});
