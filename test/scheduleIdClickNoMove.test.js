import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// NEW-1 (2026-10-28) — a press on a row's ID cell / grip is a CLICK until the held pointer has travelled a clear
// distance, and the distance is larger for a pen and larger again for a finger. These run the REAL helpers and
// assert the real source's gesture wiring (the browser behaviour itself is ui-audit/verify-schedule-id-click-no-move.mjs).
const src = readFileSync(fileURLToPath(new URL("../public/sequence/index.html", import.meta.url)), "utf8");
const line = (prefix) => { const s = src.indexOf(prefix); if (s === -1) throw new Error(prefix + " missing"); return src.slice(s, src.indexOf("\n", s)); };
const { ROW_DRAG_THRESHOLD, rowDragThreshold, rowDragArmed } = new Function(`
  ${line("const ROW_DRAG_THRESHOLD =")}
  ${line("const rowDragThreshold =")}
  ${line("const rowDragArmed =")}
  return { ROW_DRAG_THRESHOLD, rowDragThreshold, rowDragArmed };
`)();

describe("row-drag threshold", () => {
  it("is larger for a pen than a mouse and larger for a finger than a pen", () => {
    expect(ROW_DRAG_THRESHOLD.mouse).toBeLessThan(ROW_DRAG_THRESHOLD.pen);
    expect(ROW_DRAG_THRESHOLD.pen).toBeLessThan(ROW_DRAG_THRESHOLD.touch);
  });
  it("an unknown pointer type falls back to the mouse distance", () => {
    expect(rowDragThreshold("")).toBe(ROW_DRAG_THRESHOLD.mouse);
    expect(rowDragThreshold(undefined)).toBe(ROW_DRAG_THRESHOLD.mouse);
  });
  it("zero movement, a pixel or two, and the old 4px flag never arm any pointer", () => {
    for (const t of ["mouse", "pen", "touch"]) {
      expect(rowDragArmed(t, 0, 0)).toBe(false);
      expect(rowDragArmed(t, 1, 2)).toBe(false);
      expect(rowDragArmed(t, 0, 4.5)).toBe(false);
    }
  });
  it("a deliberate drag arms every pointer, in any direction", () => {
    for (const t of ["mouse", "pen", "touch"]) {
      expect(rowDragArmed(t, 0, 40)).toBe(true);
      expect(rowDragArmed(t, -40, 0)).toBe(true);
      expect(rowDragArmed(t, 30, 30)).toBe(true);
    }
  });
  it("touch wobble that would reach a neighbouring row's nest zone does not arm", () => {
    expect(rowDragArmed("touch", 0, 15)).toBe(false);
    expect(rowDragArmed("pen", 0, 9)).toBe(false);
    expect(rowDragArmed("mouse", 0, 5)).toBe(false);
  });
});

describe("startRowDrag wiring (source guard)", () => {
  const fn = src.slice(src.indexOf("const startRowDrag = (e, anchorTaskId"), src.indexOf("const up = () => { isDraggingCells.current = false;"));
  it("does not pin the cursor, dim rows, start the frame loop, or register the drag at press time", () => {
    const beforeArm = fn.slice(0, fn.indexOf("const arm = () => {"));
    expect(beforeArm).not.toMatch(/pinSchedCursor\(/);
    expect(beforeArm.match(/requestAnimationFrame\(tick\)/g)).toHaveLength(1);   // only tick() re-queuing itself; the loop is started in arm()
    expect(fn.slice(fn.indexOf("const arm = () => {"), fn.indexOf("const teardown"))).toMatch(/requestAnimationFrame\(tick\)/);
    expect(beforeArm).not.toMatch(/rowDragRef\.current = state/);
    expect(beforeArm).not.toMatch(/style\.opacity = "0\.45"/);
  });
  it("arms only through the threshold test, on move", () => {
    expect(fn).toMatch(/rowDragArmed\(pointerType, ev\.clientX - startX, ev\.clientY - startY\)\) arm\(\)/);
    expect(fn.match(/\barm\(\)/g)).toHaveLength(1);
  });
  it("a release before arming is a click; a release back at the press point writes nothing", () => {
    expect(fn).toMatch(/if \(!wasArmed\) \{ if \(onClick\) onClick\(\); return; \}/);
    expect(fn).toMatch(/if \(!rowDragArmed\(pointerType, state\.lastClientX - startX, state\.lastClientY - startY\)\) return;/);
  });
  it("a context menu, Escape, blur, or a button released out of sight cancels", () => {
    expect(fn).toMatch(/addEventListener\("contextmenu", cancel, true\)/);
    expect(fn).toMatch(/ev\.key === "Escape"\) cancel\(\)/);
    expect(fn).toMatch(/addEventListener\("blur", cancel\)/);
    expect(fn).toMatch(/ev\.buttons === 0\) \{ cancel\(\)/);
  });
  it("the grip click selects its row, and a ctrl/meta press on an ID cell never picks the selection up", () => {
    expect(src).toMatch(/startRowDrag\(e, task\.id, \{ onClick: \(\) => \{ setSelectedId\(task\.id\)/);
    expect(src).toMatch(/!e\.ctrlKey && !e\.metaKey && !e\.altKey && idPressMovesRows\(/);
  });
});
