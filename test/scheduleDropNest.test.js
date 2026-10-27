import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { recomputeSchedule } from "../ui-audit/stress/scheduler-engine.mjs";

// NEW-ROWNEST — dragging rows onto the CENTRE of a row nests them under it, including a row that has
// no children yet (the only case where there is no gap between a parent and a first child to aim at).
//
// These tests run the REAL functions out of public/sequence/index.html (sliced out of the source and
// evaluated), not a hand-copied mirror, so they cannot drift from what ships. The red-proof: against
// the pre-change source `rowDropIntent` does not exist and every test here fails at extraction.
const src = readFileSync(fileURLToPath(new URL("../public/sequence/index.html", import.meta.url)), "utf8");

const extractFn = (signature) => {
  const start = src.indexOf(signature);
  if (start === -1) throw new Error(`"${signature}" not found in public/sequence/index.html`);
  let depth = 0, i = start, seen = false;
  for (; i < src.length; i++) {
    if (src[i] === "{") { depth++; seen = true; }
    else if (src[i] === "}") { depth--; if (seen && depth === 0) { i++; break; } }
  }
  return src.slice(start, i);
};
const line = (prefix) => { const s = src.indexOf(prefix); if (s === -1) throw new Error(prefix + " missing"); return src.slice(s, src.indexOf("\n", s)); };

const real = new Function(`
  ${line("const ROW_NEST_BAND =")}
  ${line("const rowDropZone =")}
  ${extractFn("const resolveDropParent = (tasks, blocked, gapIndex) => {")};
  ${extractFn("const rowDropIntent = (tasks, blocked, rowFloat) => {")};
  ${extractFn("const flatOrderWithLevel = (tasks) => {")};
  ${extractFn('const moveSelectionToDestination = (tasks, selectedIds, destParentId, insertAfterId = "end") => {')};
  ${extractFn("const sortByVisualOrder = (tasks) => {")};
  return { ROW_NEST_BAND, rowDropZone, resolveDropParent, rowDropIntent, flatOrderWithLevel, moveSelectionToDestination, sortByVisualOrder };
`)();
const { ROW_NEST_BAND, rowDropZone, rowDropIntent, flatOrderWithLevel, moveSelectionToDestination, sortByVisualOrder } = real;

const T = (id, over = {}) => ({
  id, name: "t" + id, parentId: null, isExpanded: true,
  start: "2026-06-01", end: "2026-06-01", duration: 1, durValue: 1, durUnit: "d",
  predecessors: [], health: "gray", percentComplete: 0, ...over,
});

// The reported shape (Grand Port > Master Schedule): "Plan B" with its own children, then siblings of
// Plan B (one a COLLAPSED parent), then a childless top-level "Plan A" with a typed 0d.
//   1 Pipeline Coordination
//     2 Plan B
//       3 Easement Acquisition   4 Design
//     5 Surveying   6 Kinder Morgan   7 Enterprise (collapsed) -> 8, 9 (hidden)   10 Exxon   11 Air Liquide
//   12 Plan A   (leaf, 0d)
const fixture = () => [
  T(1),
  T(2, { parentId: 1 }),
  T(3, { parentId: 2, start: "2026-06-01", end: "2026-06-02", duration: 2, durValue: 2, notes: [{ text: "keep me" }], owner: "Dana" }),
  T(4, { parentId: 2, start: "2026-06-03", end: "2026-06-03", predecessors: [{ id: 3, type: "FS", lag: 0 }] }),
  T(5, { parentId: 1, start: "2026-06-04", end: "2026-06-04" }),
  T(6, { parentId: 1, start: "2026-06-05", end: "2026-06-05", predecessors: [{ id: 5, type: "FS", lag: 0 }] }),
  T(7, { parentId: 1, isExpanded: false, start: "2026-06-08", end: "2026-06-09", duration: 2 }),
  T(8, { parentId: 7, start: "2026-06-08", end: "2026-06-08" }),
  T(9, { parentId: 7, start: "2026-06-09", end: "2026-06-09" }),
  T(10, { parentId: 1, start: "2026-06-10", end: "2026-06-10" }),
  T(11, { parentId: 1, start: "2026-06-11", end: "2026-06-11", predecessors: [{ id: 10, type: "FS", lag: 0 }] }),
  T(12, { start: "2026-06-12", end: "2026-06-12", duration: 0, durValue: 0, status: "Not Started" }),
];

const visible = (tasks) => flatOrderWithLevel(tasks);
const blockedFor = (tasks, ids) => {
  const b = new Set(ids);
  let grew = true;
  while (grew) { grew = false; tasks.forEach(t => { if (t.parentId != null && b.has(t.parentId) && !b.has(t.id)) { b.add(t.id); grew = true; } }); }
  return b;
};
// rowFloat that lands on row `idx` at fraction `frac` of its height
const at = (idx, frac) => idx + frac;
const childrenOf = (tasks, id) => sortByVisualOrder(tasks).filter(t => t.parentId === id).map(t => t.id);
const settle = (tasks) => recomputeSchedule(sortByVisualOrder(tasks));

describe("rowDropZone — the centre band is the SMALLEST of the three (nesting must be deliberate)", () => {
  it("before / into / after partition the row, and 'into' is narrower than either side band", () => {
    const into = ROW_NEST_BAND;
    const before = (1 - ROW_NEST_BAND) / 2, after = (1 - ROW_NEST_BAND) / 2;
    expect(into).toBeLessThan(before);
    expect(into).toBeLessThan(after);
    expect(rowDropZone(0.05)).toBe("before");
    expect(rowDropZone(0.5)).toBe("into");
    expect(rowDropZone(0.95)).toBe("after");
  });
  it("sweeping a row top to bottom in 1% steps yields before → into → after, once each, in order", () => {
    const seq = [];
    for (let p = 0; p < 100; p++) { const z = rowDropZone(p / 100); if (seq[seq.length - 1] !== z) seq.push(z); }
    expect(seq).toEqual(["before", "into", "after"]);
  });
});

describe("rowDropIntent — what a release means at a pointer position", () => {
  const tasks = fixture();
  const flat = visible(tasks);
  const idx12 = flat.findIndex(t => t.id === 12);
  const blocked = blockedFor(tasks, [3, 4, 5, 6, 7, 10, 11]);

  it("the CENTRE of a childless leaf offers 'into' that row (the reported gap: previously only a line was possible)", () => {
    const it = rowDropIntent(flat, blocked, at(idx12, 0.5));
    expect(it.kind).toBe("into");
    expect(it.targetId).toBe(12);
    expect(it.destParentId).toBe(12);
    expect(it.insertAfterId).toBe("end");
  });
  it("the top / bottom bands of the same row still mean insert above / below (two-band behaviour kept)", () => {
    expect(rowDropIntent(flat, blocked, at(idx12, 0.1)).kind).toBe("gap");
    expect(rowDropIntent(flat, blocked, at(idx12, 0.9)).kind).toBe("gap");
  });
  it("a row that is being dragged — or inside a dragged row, even collapsed — is 'blocked' in its centre, 'none' elsewhere", () => {
    const idx6 = flat.findIndex(t => t.id === 6);
    expect(rowDropIntent(flat, blocked, at(idx6, 0.5))).toEqual({ kind: "blocked", index: idx6 });
    expect(rowDropIntent(flat, blocked, at(idx6, 0.05)).kind).toBe("none");
    // Enterprise (7) is dragged; its hidden children 8, 9 are blocked too, so a nest into 7 is refused
    const idx7 = flat.findIndex(t => t.id === 7);
    expect(rowDropIntent(flat, blocked, at(idx7, 0.5)).kind).toBe("blocked");
  });
  it("above the first row and below the last are still gaps", () => {
    expect(rowDropIntent(flat, blocked, -0.4)).toMatchObject({ kind: "gap", gapIndex: 0, destParentId: null });
    expect(rowDropIntent(flat, blocked, flat.length + 0.4)).toMatchObject({ kind: "gap", gapIndex: flat.length });
  });
});

describe("the reported drag: mixed-depth range (rows under Plan B AND siblings of Plan B) onto the childless Plan A", () => {
  const original = fixture();
  const flat = visible(original);
  // The grid's range selection is over the VISIBLE rows: 3..11 (8, 9 are hidden under collapsed 7)
  const selected = flat.slice(flat.findIndex(t => t.id === 3), flat.findIndex(t => t.id === 11) + 1).map(t => t.id);
  const blocked = blockedFor(original, selected);
  const idx12 = flat.findIndex(t => t.id === 12);
  const intent = rowDropIntent(flat, blocked, at(idx12, 0.5));
  const moved = moveSelectionToDestination(original, selected, intent.destParentId, intent.insertAfterId);
  const after = settle(moved);

  it("the visible range is the 7 rows the owner described (collapsed parent counted once)", () => {
    expect(selected).toEqual([3, 4, 5, 6, 7, 10, 11]);
  });
  it("every selected top-most row becomes a child of Plan A, in their original visual order", () => {
    expect(childrenOf(after, 12)).toEqual([3, 4, 5, 6, 7, 10, 11]);
  });
  it("a selected row that is a descendant of another selected row is NOT flattened — and a collapsed parent keeps its hidden children", () => {
    // only selected rows whose parent is unselected are re-parented; 8 and 9 stay under 7
    expect(after.find(t => t.id === 8).parentId).toBe(7);
    expect(after.find(t => t.id === 9).parentId).toBe(7);
    expect(after.find(t => t.id === 7).isExpanded).toBe(false);
  });
  it("Plan A is auto-expanded so the moved block is visible where it landed", () => {
    expect(after.find(t => t.id === 12).isExpanded).toBe(true);
  });
  it("predecessor links, notes, owner and typed values on moved rows survive untouched", () => {
    expect(after.find(t => t.id === 4).predecessors).toEqual([{ id: 3, type: "FS", lag: 0 }]);
    expect(after.find(t => t.id === 6).predecessors).toEqual([{ id: 5, type: "FS", lag: 0 }]);
    expect(after.find(t => t.id === 11).predecessors).toEqual([{ id: 10, type: "FS", lag: 0 }]);
    expect(after.find(t => t.id === 3).notes).toEqual([{ text: "keep me" }]);
    expect(after.find(t => t.id === 3).owner).toBe("Dana");
    expect(after.find(t => t.id === 3).duration).toBe(2);
  });
  it("rollups recompute on the NEW parent: Plan A now spans its children's dates", () => {
    const a = after.find(t => t.id === 12);
    expect(a.start).toBe("2026-06-01");
    expect(a.end).toBe("2026-06-11");
  });
  it("…and on the OLD parents: Plan B (lost both children) and Pipeline Coordination (lost all but Plan B)", () => {
    const planB = after.find(t => t.id === 2);
    expect(childrenOf(after, 2)).toEqual([]);                       // Plan B is a leaf again
    expect(planB.duration).toBe(1);                                 // its own typed value is back, not a stale roll-up
    const pipeline = after.find(t => t.id === 1);
    expect(childrenOf(after, 1)).toEqual([2]);
    expect(pipeline.start).toBe(planB.start);
    expect(pipeline.end).toBe(planB.end);
  });
  it("the old parent's rolled span SHRANK (proves the old parent really was recomputed, not left stale)", () => {
    const before = settle(original).find(t => t.id === 1);
    expect(before.end).toBe("2026-06-11");
    expect(after.find(t => t.id === 1).end).toBe("2026-06-01");
  });
  it("the leaf's own values are not destroyed: moving everything back restores Plan A's typed 0d/date (reversible, B463072 round-trip)", () => {
    const back = moveSelectionToDestination(after, [3, 4, 5, 6, 7, 10, 11], 1, "end");
    const restored = settle(back).find(t => t.id === 12);
    expect(restored.duration).toBe(0);
    expect(restored.durValue).toBe(0);
    expect(restored.status).toBe("Not Started");
  });
});

describe("adjacent cases", () => {
  const nest = (tasks, ids, targetId) => {
    const flat = visible(tasks);
    const blocked = blockedFor(tasks, ids);
    const intent = rowDropIntent(flat, blocked, at(flat.findIndex(t => t.id === targetId), 0.5));
    expect(intent.kind).toBe("into");
    return { intent, out: settle(moveSelectionToDestination(tasks, ids, intent.destParentId, intent.insertAfterId)) };
  };

  it("single row onto a leaf", () => {
    const { out } = nest(fixture(), [5], 12);
    expect(childrenOf(out, 12)).toEqual([5]);
    expect(out.find(t => t.id === 5).parentId).toBe(12);
  });
  it("onto a leaf that sits ABOVE the dragged range (target above vs below)", () => {
    const { out } = nest(fixture(), [10, 11], 5);
    expect(childrenOf(out, 5)).toEqual([10, 11]);
    expect(childrenOf(out, 1)).toEqual([2, 5, 6, 7]);
  });
  it("onto a COLLAPSED parent: becomes its last children, hidden children kept, and it opens so the drop is visible", () => {
    const { out } = nest(fixture(), [5], 7);
    expect(childrenOf(out, 7)).toEqual([8, 9, 5]);
    expect(out.find(t => t.id === 7).isExpanded).toBe(true);
  });
  it("onto an EXPANDED parent: lands as its last child, existing children undisturbed and in order", () => {
    const { out } = nest(fixture(), [12], 2);
    expect(childrenOf(out, 2)).toEqual([3, 4, 12]);
  });
  it("a NESTED target (a grandchild leaf) works the same as a top-level one", () => {
    const { out } = nest(fixture(), [12], 4);
    expect(out.find(t => t.id === 12).parentId).toBe(4);
    expect(childrenOf(out, 4)).toEqual([12]);
  });
  it("a selected parent + its own selected child travel together (the child is not flattened out of it)", () => {
    const { out } = nest(fixture(), [2, 3, 4], 12);
    expect(out.find(t => t.id === 2).parentId).toBe(12);
    expect(out.find(t => t.id === 3).parentId).toBe(2);
    expect(out.find(t => t.id === 4).parentId).toBe(2);
  });
  it("a row can never be nested into itself or its own descendant — refused by the hover AND by the mover (never a silent no-op)", () => {
    const tasks = fixture();
    const flat = visible(tasks);
    const blocked = blockedFor(tasks, [2]);
    // hover: Plan B's own centre, and its child's centre, are both 'blocked'
    expect(rowDropIntent(flat, blocked, at(flat.findIndex(t => t.id === 2), 0.5)).kind).toBe("blocked");
    expect(rowDropIntent(flat, blocked, at(flat.findIndex(t => t.id === 3), 0.5)).kind).toBe("blocked");
    // mover: independently refuses (returns null) if asked anyway
    expect(moveSelectionToDestination(tasks, [2], 2, "end")).toBeNull();
    expect(moveSelectionToDestination(tasks, [2], 3, "end")).toBeNull();
    expect(moveSelectionToDestination(tasks, [1], 9, "end")).toBeNull();   // deep descendant, hidden
  });
  it("nesting a row into the parent it is already the last child of changes nothing (no phantom undo step)", () => {
    const tasks = fixture();
    expect(moveSelectionToDestination(tasks, [11], 1, "end")).toBeNull();
  });
});

describe("wiring in public/sequence/index.html", () => {
  const body = extractFn("const startRowDrag = (e, anchorTaskId, opts = null) => {");
  it("the drop commits through the ONE moveRows call per outcome (one setData → one undo step), only from onUp", () => {
    const upAt = body.indexOf("const onUp = ");
    expect(upAt).toBeGreaterThan(0);
    expect((body.slice(0, upAt).match(/\bmoveRows\(/g) || []).length).toBe(0);
    const onUp = body.slice(upAt);
    expect(onUp).toMatch(/intent\.kind === "gap" && moveRows\) \{\s*moveRows\(anchorTaskId, intent\.destParentId, intent\.insertAfterId\);/);
    expect(onUp).toMatch(/intent\.kind === "into" && moveRows\) \{[\s\S]*?moveRows\(anchorTaskId, intent\.destParentId, intent\.insertAfterId\);/);
  });
  it("a leaf turning into a summary row says so out loud (toast) and the blocked release says why nothing moved", () => {
    expect(body).toMatch(/is now a summary row/);
    expect(body).toMatch(/can't be moved into itself or its own sub-rows/);
  });
  it("the drag still paints imperatively — no React state is set inside the gesture", () => {
    expect(body).not.toMatch(/(?<![.\w])set[A-Z]\w*\(/);   // bare setX(…) = React state; .setAttribute is DOM
  });
  it("Escape / blur cancels BOTH kinds of drop (the cancel path clears the intent, not just the gap)", () => {
    expect(body).toMatch(/onExit: \(\) => \{ state\.overGapIndex = null; state\.intent = null; onUp\(\); \}/);
  });
});
