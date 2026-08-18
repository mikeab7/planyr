import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { indentSelection, outdentSelection, promoteChildrenAndDelete, flatOrderWithLevel } from "../ui-audit/stress/schedule-tree-ops.mjs";
import { recomputeSchedule } from "../ui-audit/stress/scheduler-engine.mjs";

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

// ── Combined with the REAL recompute engine (scheduler-engine.mjs, the pre-existing mirror of
// cascadeDates/rollupParentDates) — the B463072-shaped landmine and live predecessor survival.
// The live-browser harness measured both of these against the actual app; these are the fast,
// CI-runnable pins for the same two properties, run through the real date-cascade math rather
// than asserted from parentId alone.
describe("indent/outdent through the real recompute engine — B463072 landmine + predecessor survival", () => {
  const dtask = (id, over = {}) => ({
    id, name: "t" + id, start: "2026-06-01", end: "2026-06-01", duration: 1,
    durValue: 1, durUnit: "d", predecessors: [], parentId: null, health: "gray",
    percentComplete: 0, isExpanded: true, ...over,
  });

  it("B463072 round-trip: a leaf's typed duration survives gaining then losing a child, recomputed for real", () => {
    // "6" is a leaf with a typed 3d duration. "7" is a dated 1-day child. Indent 7 under 6 (6
    // becomes a parent for the first time) and recompute for real: 6's duration must reflect the
    // ROLLED span (not the stale 3), because it now has a child with real dates. Then outdent 7
    // back out (6 is childless again) and recompute again: 6 must cleanly restore ITS OWN typed
    // 3d span, not some frozen leftover from while it had children.
    let tasks = [
      dtask(6, { durValue: 3, durUnit: "d", duration: 3, end: "2026-06-03" }),
      dtask(7, { start: "2026-06-01", end: "2026-06-01", duration: 1 }),
    ];
    tasks = recomputeSchedule(tasks);
    expect(tasks.find(t => t.id === 6).duration).toBe(3); // leaf, still its own typed value

    tasks = recomputeSchedule(indentSelection(tasks, [7])); // 6 gains child 7
    const asParent = tasks.find(t => t.id === 6);
    expect(asParent.duration).not.toBe(3); // ROLLED now, not the stale leaf value
    expect(asParent.duration).toBe(1); // rolled from 7's single dated day

    tasks = recomputeSchedule(outdentSelection(tasks, [7])); // 6 loses its only child
    const backToLeaf = tasks.find(t => t.id === 6);
    expect(backToLeaf.duration).toBe(3); // restored — no B463072-shaped stale leftover
    expect(backToLeaf.durValue).toBe(3);
  });

  it("predecessor links survive INDENT and stay LIVE — the moved row's date still derives from its predecessor after recompute", () => {
    // 8 -> 1 -> 9 in visual order, all top-level. 9 is FS-driven by 8 but its new parent (1) is a
    // DIFFERENT task from its predecessor, so reparenting introduces no circularity — isolating
    // exactly "does the link still drive the date after the move," not an unrelated interaction
    // from picking the predecessor itself as the new parent.
    let tasks = [dtask(8, { duration: 2, end: "2026-06-02" }), dtask(1), dtask(9, { predecessors: [{ id: 8, type: "FS", lag: 0 }] })];
    tasks = recomputeSchedule(tasks);
    const baselineStart = tasks.find(t => t.id === 9).start; // 9's FS-derived date BEFORE any move

    const moved = indentSelection(tasks, [9]); // 9 becomes 1's child; 1 is directly above it
    expect(moved.find(t => t.id === 9).parentId).toBe(1);
    expect(moved.find(t => t.id === 9).predecessors).toEqual([{ id: 8, type: "FS", lag: 0 }]);

    const after = recomputeSchedule(moved).find(t => t.id === 9);
    expect(after.predecessors).toEqual([{ id: 8, type: "FS", lag: 0 }]);
    expect(after.start).toBe(baselineStart); // still genuinely FS-driven by 8, unchanged by the move
  });

  it("predecessor links survive OUTDENT and stay LIVE the same way", () => {
    // 8 (unrelated) -> 1 -> 2 (1's child) -> 9 (2's child, FS-driven by 8, predecessor OUTSIDE
    // the 1/2 subtree entirely).
    let tasks = [
      dtask(8, { duration: 2, end: "2026-06-02" }),
      dtask(1),
      dtask(2, { parentId: 1 }),
      dtask(9, { parentId: 2, predecessors: [{ id: 8, type: "FS", lag: 0 }] }),
    ];
    tasks = recomputeSchedule(tasks);
    const baselineStart = tasks.find(t => t.id === 9).start;

    const moved = outdentSelection(tasks, [9]); // 9 promotes from 2 to 2's parent (1)
    expect(moved.find(t => t.id === 9).parentId).toBe(1);
    expect(moved.find(t => t.id === 9).predecessors).toEqual([{ id: 8, type: "FS", lag: 0 }]);

    const after = recomputeSchedule(moved).find(t => t.id === 9);
    expect(after.predecessors).toEqual([{ id: 8, type: "FS", lag: 0 }]);
    expect(after.start).toBe(baselineStart);
  });
});

// ── Source-pin: the fast anchors a CI push can check without a browser ──────────────────────────
describe("wiring in public/sequence/index.html", () => {
  const src = readFileSync(fileURLToPath(new URL("../public/sequence/index.html", import.meta.url)), "utf8");
  const mjs = readFileSync(fileURLToPath(new URL("../ui-audit/stress/schedule-tree-ops.mjs", import.meta.url)), "utf8");

  // Extract a top-level `const <name> = (...) => { ... };` function body from a source string by
  // brace-matching from the signature line to its closing `};`. A regex pin on a few "load-bearing"
  // lines (the previous version of this guard) is BLIND to a change anywhere else in the body —
  // proved empirically: pointing this test at index.html with `parentId: newParent.id` mutated to
  // `parentId: top.id` inside `indentSelection` (a real behavioral bug — every root row would
  // reparent onto itself/the topmost row instead of the row above it) left all 34 tests in this
  // file GREEN, because that line wasn't one of the ones pinned. This extraction makes the WHOLE
  // body the comparison, not a hand-picked subset of it.
  const extractFn = (source, signature) => {
    const start = source.indexOf(signature);
    if (start === -1) return null;
    let depth = 0, i = start, seenFirstBrace = false;
    for (; i < source.length; i++) {
      if (source[i] === "{") { depth++; seenFirstBrace = true; }
      else if (source[i] === "}") { depth--; if (seenFirstBrace && depth === 0) { i++; break; } }
    }
    return source.slice(start, i).replace(/;\s*$/, "");
  };

  it("the pure tree-mutation functions in the mirror are BYTE-IDENTICAL to index.html's, not just similar (drift guard)", () => {
    const pairs = [
      ["const flatOrderWithLevel = (tasks) => {", "export const flatOrderWithLevel = (tasks) => {"],
      ["const indentSelection = (tasks, selectedIds) => {", "export const indentSelection = (tasks, selectedIds) => {"],
      ["const outdentSelection = (tasks, selectedIds) => {", "export const outdentSelection = (tasks, selectedIds) => {"],
      ["const promoteChildrenAndDelete = (tasks, deleteIds) => {", "export const promoteChildrenAndDelete = (tasks, deleteIds) => {"],
    ];
    for (const [srcSig, mjsSig] of pairs) {
      const srcBody = extractFn(src, srcSig);
      const mjsBody = extractFn(mjs, mjsSig);
      expect(srcBody, `"${srcSig}" not found (or unbalanced braces) in index.html`).not.toBeNull();
      expect(mjsBody, `"${mjsSig}" not found (or unbalanced braces) in schedule-tree-ops.mjs`).not.toBeNull();
      // Normalize only the signature's own "export " prefix — the BODY (everything after the
      // opening brace) must match character-for-character, not just structurally.
      const srcNormalized = srcBody.replace(srcSig, mjsSig);
      expect(srcNormalized, `index.html's ${srcSig.split(" ")[1]} body diverged from the schedule-tree-ops.mjs mirror`).toBe(mjsBody);
    }
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

  it("each of the three batch operations calls setData and recomputeAfterStructureChange EXACTLY ONCE — one recompute per operation, never one per row", () => {
    const bodies = {
      indentSelectionByIds: extractFn(src, "const indentSelectionByIds = useCallback((taskIds) => {"),
      outdentSelectionByIds: extractFn(src, "const outdentSelectionByIds = useCallback((taskIds) => {"),
      promoteAndDeleteTasks: extractFn(src, "const promoteAndDeleteTasks = useCallback((taskIds) => {"),
    };
    for (const [name, body] of Object.entries(bodies)) {
      expect(body, `${name} not found in index.html`).not.toBeNull();
      const setDataCalls = (body.match(/\bsetData\(/g) || []).length;
      const recomputeCalls = (body.match(/\brecomputeAfterStructureChange\(/g) || []).length;
      expect(setDataCalls, `${name} calls setData ${setDataCalls} times, expected exactly 1`).toBe(1);
      expect(recomputeCalls, `${name} calls recomputeAfterStructureChange ${recomputeCalls} times, expected exactly 1`).toBe(1);
    }
  });
});
