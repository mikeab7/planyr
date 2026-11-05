import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { insertRowAbove, sortByVisualOrder } from "../ui-audit/stress/schedule-insert-above.mjs";

// NEW-1 — the Insert key adds the row directly ABOVE the selected row in the VISIBLE order and never
// opens anything hidden (Excel / Microsoft Project parity). Owner report (Baytown schedule): rows 73
// "Baytown Approval" and 74 "P&Z" (children of the Baytown Platting summary, which is Focus-filtered
// with its finished children 75–79 hidden), then 80 "TIA" (a top-level summary). Select TIA → Insert:
// the old code un-focused Baytown Platting (75–79 reappeared) and the new row sorted after them.

const T = (id, over = {}) => ({ id, name: "t" + id, parentId: null, isExpanded: true, ...over });

// The grid's own visibility rule (flatTasks in index.html): a collapsed parent hides its subtree; a
// focused parent hides the children Focus classes as finished/not-started (here: `done: true`), unless
// pinned. Returns the visible ids in order.
const visibleIds = (tasks, pins = new Set()) => {
  const kids = new Map();
  tasks.forEach(t => { const p = t.parentId ?? null; if (!kids.has(p)) kids.set(p, []); kids.get(p).push(t); });
  const out = [];
  const walk = (pid) => {
    const parent = tasks.find(t => t.id === pid);
    let ch = kids.get(pid) || [];
    if (parent && parent.focused) ch = ch.filter(c => !c.done || pins.has(c._sid));
    ch.forEach(t => { out.push(t.id); if (t.isExpanded) walk(t.id); });
  };
  walk(null);
  return out;
};

// The pre-fix insertTask position/parent logic, copied from main (8584b49) so the red-proof runs the
// real old algorithm through the SAME assertions.
const legacyInsert = (rawTasks, selectedId, newTask) => {
  const flatOrder = [];
  const walk = (parentId, level) => {
    rawTasks.filter(t => t.parentId === parentId).forEach(t => {
      flatOrder.push({ ...t, level });
      if (t.isExpanded) walk(t.id, level + 1);
    });
  };
  walk(null, 0);
  const flatIdx = flatOrder.findIndex(t => t.id === selectedId);
  const selectedTask = flatOrder[flatIdx];
  const prevTask = flatIdx > 0 ? flatOrder[flatIdx - 1] : null;
  const newParentId = prevTask && prevTask.level > selectedTask.level ? prevTask.parentId : selectedTask.parentId;
  let tasks = [...rawTasks];
  tasks.splice(tasks.findIndex(t => t.id === selectedId), 0, { ...newTask, parentId: newParentId });
  const anc = new Set(); { let p = newParentId; while (p != null) { anc.add(p); const par = tasks.find(t => t.id === p); p = par ? par.parentId : null; } }
  if (anc.size) tasks = tasks.map(t => anc.has(t.id) ? { ...t, isExpanded: true, focused: t.id === newParentId ? false : t.focused } : t);
  return sortByVisualOrder(tasks);
};
const fixedInsert = (tasks, selectedId, newTask) => sortByVisualOrder(insertRowAbove(tasks, visibleIds(tasks), selectedId, newTask));

const NEW = { id: 999, name: "", parentId: null, isExpanded: true, _sid: "new" };
const viewState = ts => Object.fromEntries(ts.filter(t => t.id !== NEW.id).map(t => [t.id, [!!t.isExpanded, !!t.focused]]));

// Baytown-shaped fixture: 70 Baytown Platting (FOCUSED) → 73, 74 visible + 75–79 done (hidden);
// 80 TIA top-level summary, collapsed, with children 81, 82; 90 a later row.
const baytown = () => [
  T(70, { focused: true }),
  T(73, { parentId: 70 }), T(74, { parentId: 70 }),
  ...[75, 76, 77, 78, 79].map(id => T(id, { parentId: 70, done: true })),
  T(80, { isExpanded: false }), T(81, { parentId: 80 }), T(82, { parentId: 80 }),
  T(90),
];

const assertReported = (before, after) => {
  // (a) no row's hidden/collapsed state changed
  expect(viewState(after)).toEqual(viewState(before));
  const row = after.find(t => t.id === NEW.id);
  // (b) the new row's parent is the earlier group
  expect(row.parentId).toBe(70);
  // (c) after all of that group's existing children, immediately before the selected summary
  const order = after.map(t => t.id);
  expect(order.indexOf(NEW.id)).toBe(order.indexOf(79) + 1);
  expect(order.indexOf(80)).toBe(order.indexOf(NEW.id) + 1);
  // and visibly: directly below P&Z, directly above TIA, with 75–79 still hidden
  const vis = visibleIds(after, new Set(["new"]));
  expect(vis.slice(vis.indexOf(74), vis.indexOf(74) + 3)).toEqual([74, NEW.id, 80]);
  [75, 76, 77, 78, 79, 81, 82].forEach(id => expect(vis).not.toContain(id));
};

describe("Insert above — the reported case (red-proof)", () => {
  it("RED on main: the old algorithm un-focuses the group / mis-places the row", () => {
    const before = baytown();
    expect(() => assertReported(before, legacyInsert(before, 80, NEW))).toThrow();
  });
  it("GREEN with insertRowAbove", () => {
    const before = baytown();
    assertReported(before, fixedInsert(before, 80, NEW));
  });
});

describe("Insert above — edge cases", () => {
  it("row above is the selection's own parent → first child of it, same level, nothing opened", () => {
    const before = baytown();
    const after = fixedInsert(before, 73, NEW);
    expect(after.find(t => t.id === NEW.id).parentId).toBe(70);
    const kids = after.filter(t => t.parentId === 70).map(t => t.id);
    expect(kids[0]).toBe(NEW.id);
    expect(viewState(after)).toEqual(viewState(before));
  });

  it("selection is the very first row → new top row, same level", () => {
    const before = baytown();
    const after = fixedInsert(before, 70, NEW);
    expect(after[0].id).toBe(NEW.id);
    expect(after[0].parentId).toBe(null);
  });

  it("row above is a COLLAPSED summary → its sibling, after its whole hidden subtree; it stays collapsed", () => {
    const before = baytown();
    const after = fixedInsert(before, 90, NEW);
    const row = after.find(t => t.id === NEW.id);
    expect(row.parentId).toBe(null);
    const order = after.map(t => t.id);
    expect(order.indexOf(NEW.id)).toBe(order.indexOf(82) + 1);
    expect(order.indexOf(90)).toBe(order.indexOf(NEW.id) + 1);
    expect(after.find(t => t.id === 80).isExpanded).toBe(false);
    expect(viewState(after)).toEqual(viewState(before));
  });

  it("row above is an EXPANDED summary's last visible child (selection on a task, not a summary)", () => {
    const before = [T(1), T(2, { parentId: 1 }), T(3, { parentId: 1 }), T(4)];
    const after = fixedInsert(before, 4, NEW);
    expect(after.find(t => t.id === NEW.id).parentId).toBe(1);
    expect(after.map(t => t.id)).toEqual([1, 2, 3, NEW.id, 4]);
  });

  it("selection is a sibling of the row above, with hidden (Focus) siblings between → directly above the selection", () => {
    const before = [T(1, { focused: true }), T(2, { parentId: 1 }), T(3, { parentId: 1, done: true }), T(4, { parentId: 1 })];
    const after = fixedInsert(before, 4, NEW);
    expect(after.find(t => t.id === NEW.id).parentId).toBe(1);
    expect(after.map(t => t.id)).toEqual([1, 2, 3, NEW.id, 4]);
    expect(after.find(t => t.id === 1).focused).toBe(true);
  });

  it("manual collapse (no Focus) of a NESTED group above a top-level selection", () => {
    const before = [T(1), T(2, { parentId: 1, isExpanded: false }), T(3, { parentId: 2 }), T(5)];
    const after = fixedInsert(before, 5, NEW);
    // row above = 2 (collapsed, level 1) → sibling of 2, after its hidden child 3
    expect(after.find(t => t.id === NEW.id).parentId).toBe(1);
    expect(after.map(t => t.id)).toEqual([1, 2, 3, NEW.id, 5]);
    expect(after.find(t => t.id === 2).isExpanded).toBe(false);
  });

  it("no anchor → appended as a top-level row", () => {
    const before = [T(1), T(2)];
    const after = fixedInsert(before, null, NEW);
    expect(after.map(t => t.id)).toEqual([1, 2, NEW.id]);
  });

  it("the pinned new row shows under a Focus filter even though Focus would class it hidden", () => {
    const before = baytown();
    const after = fixedInsert(before, 80, { ...NEW, done: true });
    expect(visibleIds(after)).not.toContain(NEW.id);
    expect(visibleIds(after, new Set(["new"]))).toContain(NEW.id);
  });
});

describe("wiring in public/sequence/index.html", () => {
  const src = readFileSync(fileURLToPath(new URL("../public/sequence/index.html", import.meta.url)), "utf8");
  const mjs = readFileSync(fileURLToPath(new URL("../ui-audit/stress/schedule-insert-above.mjs", import.meta.url)), "utf8");
  const extractFn = (source, signature) => {
    const start = source.indexOf(signature);
    if (start === -1) return null;
    let depth = 0, i = start, seen = false;
    for (; i < source.length; i++) {
      if (source[i] === "{") { depth++; seen = true; }
      else if (source[i] === "}") { depth--; if (seen && depth === 0) { i++; break; } }
    }
    return source.slice(start, i);
  };

  it("the mirror is byte-identical to index.html (drift guard)", () => {
    for (const sig of ["const sortByVisualOrder = (tasks) => {", "const insertRowAbove = (tasks, visibleIds, anchorId, newTask) => {"]) {
      const a = extractFn(src, sig), b = extractFn(mjs, "export " + sig);
      expect(a, sig).not.toBeNull();
      expect("export " + a).toBe(b);
    }
  });

  it("Insert key and context menu both go through insertAboveAnchor; no insert-above path un-focuses or expands", () => {
    expect(src).toMatch(/if \(!e\.repeat\) insertTask\(\);/);
    expect(src).toMatch(/const insertTaskAbove = useCallback\(\(taskId\) => \{ insertAboveAnchor\(taskId\); \}, \[\]\);/);
    const body = extractFn(src, "const insertAboveAnchor = useCallback((anchorId) => {");
    expect(body).toMatch(/insertRowAbove\(/);
    expect(body).not.toMatch(/isExpanded|focused:/);
  });

  it("Focus keeps a pinned inserted row visible and out of the hidden count", () => {
    expect(src).toMatch(/children\.filter\(c => !hideStatusOf\(c\.id\) \|\| focusPins\.has\(c\._sid\)\)/);
    expect(src).toMatch(/const hs = focusPins\.has\(c\._sid\) \? null : hideStatusOf\(c\.id\);/);
  });

  it("Enter is untouched — it never inserts", () => {
    const enterBlock = src.match(/e\.key === "Enter"[\s\S]{0,400}/g) || [];
    enterBlock.forEach(b => expect(b).not.toMatch(/insertTask\(|insertAboveAnchor\(/));
  });
});
