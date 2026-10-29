import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// NEW-1 (B2455200) — Alt+F toggles Focus on the selected group. These run the REAL helpers out of
// public/sequence/index.html (sliced from the source and evaluated), not a hand-copied mirror. Red-proof:
// against the pre-change source neither helper exists and every test here fails at extraction.
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
const { focusToggleTarget, focusReselectTarget } = new Function(`
  ${extractFn("function focusGroupIds(tasks) {")}
  ${extractFn("function focusToggleTarget(allTasks, anchorId) {")}
  ${extractFn("function focusReselectTarget(allTasks, visibleIds, selId) {")}
  return { focusToggleTarget, focusReselectTarget };
`)();

//  1 Group A (summary)
//    2 child        3 sub-group (summary)
//                     4 grandchild
//  5 Lone top-level task (no parent, no children)
const T = (id, parentId = null) => ({ id, parentId, name: "t" + id });
const tasks = [T(1), T(2, 1), T(3, 1), T(4, 3), T(5)];

describe("which group Alt+F toggles", () => {
  it("a summary row toggles its own Focus", () => {
    expect(focusToggleTarget(tasks, 1)).toBe(1);
    expect(focusToggleTarget(tasks, 3)).toBe(3);   // a sub-group is a summary too
  });
  it("a plain task toggles its parent group's Focus", () => {
    expect(focusToggleTarget(tasks, 2)).toBe(1);
    expect(focusToggleTarget(tasks, 4)).toBe(3);
  });
  it("a top-level plain task has no group — does nothing", () => {
    expect(focusToggleTarget(tasks, 5)).toBeNull();
  });
  it("no selection, the + New task affordance, or an unknown id does nothing", () => {
    expect(focusToggleTarget(tasks, null)).toBeNull();
    expect(focusToggleTarget(tasks, undefined)).toBeNull();
    expect(focusToggleTarget(tasks, "__NEW_TASK__")).toBeNull();
    expect(focusToggleTarget(tasks, 999)).toBeNull();
  });
  it("a dangling parentId does nothing rather than toggling a ghost", () => {
    expect(focusToggleTarget([T(7, 42)], 7)).toBeNull();
  });
});

describe("where the selection goes after the toggle", () => {
  const vis = (...ids) => new Set(ids);
  it("a still-visible selection stays put", () => {
    expect(focusReselectTarget(tasks, vis(1, 2, 3, 4, 5), 2)).toBe(2);
  });
  it("a row Focus hid moves to its parent summary row", () => {
    expect(focusReselectTarget(tasks, vis(1, 5), 2)).toBe(1);
  });
  it("a grandchild hidden with its parent moves to the nearest visible ancestor", () => {
    expect(focusReselectTarget(tasks, vis(1, 5), 4)).toBe(1);   // 3 hidden too -> 1
    expect(focusReselectTarget(tasks, vis(1, 3, 5), 4)).toBe(3);
  });
  it("nothing visible above it leaves the selection alone (null) — never invents one", () => {
    expect(focusReselectTarget(tasks, vis(5), 4)).toBeNull();
    expect(focusReselectTarget(tasks, vis(5), 999)).toBeNull();
  });
  it("no selection / the New-task row pass straight through", () => {
    expect(focusReselectTarget(tasks, vis(1), null)).toBeNull();
    expect(focusReselectTarget(tasks, vis(1), "__NEW_TASK__")).toBe("__NEW_TASK__");
  });
});

describe("Alt+F wiring (source pins)", () => {
  const handler = src.slice(src.indexOf("NEW-1 (B2455200) — Alt+F toggles Focus for the group"));
  const branch = handler.slice(0, handler.indexOf("\n      }\n") + 10);
  it("is guarded: Alt only, a real F key, never while typing / content-editable / the cell editor is open", () => {
    expect(branch).toMatch(/e\.altKey && !e\.shiftKey && !e\.ctrlKey && !e\.metaKey && e\.code === "KeyF"/);
    expect(branch).toMatch(/!typing/);
    expect(branch).toMatch(/isContentEditable/);
    expect(branch).toMatch(/!editLiveRef\.current/);
  });
  it("calls preventDefault (Chrome's own File menu) before acting, and ignores key-repeat", () => {
    expect(branch.indexOf("e.preventDefault()")).toBeGreaterThan(-1);
    expect(branch.indexOf("e.preventDefault()")).toBeLessThan(branch.indexOf("toggleGroupFocus"));
    expect(branch).toMatch(/e\.repeat\) return/);
  });
  it("uses the top row of a multi-row selection", () => {
    expect(branch).toMatch(/rowRangeSelIds\(\)/);
    expect(branch).toMatch(/ids\.length \? ids\[0\] : selectedId/);
  });
  it("the toggle goes through updateTask {focused} — the very call the chip makes, so undo matches", () => {
    expect(src).toMatch(/updateTask\(gid, \{ focused: !g\.focused \}\)/);
    expect(src).toMatch(/updateTask\(task\.id, \{focused: !task\.focused\}\)/);
  });
  it("the chip's tooltip lists the shortcut, keeping the prefixes other harnesses key on", () => {
    expect(src).toMatch(/`Focus: hide \$\{row\.hideableCount\}[^`]*\(Alt\+F\)`/);
    expect(src).toMatch(/`Show all tasks in this group — [^`]*\(Alt\+F\)`/);
  });
});
