import { describe, it, expect } from "vitest";
import { createHistoryStack } from "../src/workspaces/site-planner/lib/history.js";

// Snapshots mimic the planner's drawn-layer state; key on the whole thing the way
// SitePlanner's histKey does. A "building" is an el with a position.
const keyOf = (s) => JSON.stringify(s.els);
const stack = () => createHistoryStack({ keyOf });
const bld = (x, y) => ({ els: [{ id: "b1", cx: x, cy: y }] });
const posOf = (s) => ({ x: s.els[0].cx, y: s.els[0].cy });

describe("history stack (site-planner undo/redo)", () => {
  it("one move = one push → one undo fully reverts to the pre-drag position", () => {
    const h = stack();
    const before = bld(0, 0);
    // drag-start pushes the pre-move snapshot once; the drag then mutates freely.
    h.push(before);
    const after = bld(100, 40); // building dragged to a new spot
    const reverted = h.undo(after);
    expect(reverted).toBe(before);            // the WHOLE move reverts in one step
    expect(posOf(reverted)).toEqual({ x: 0, y: 0 });
  });

  it("B310 repro: undo reading a STALE current snapshots/compares wrong → 'does nothing' or partial revert", () => {
    // The bug: the old code read the live state from a ref updated in a passive
    // effect, so undo()'s baseline could lag a render. Simulate that here: the
    // building has actually moved to (100,40), but the stale baseline still says (0,0).
    const h = stack();
    const before = bld(0, 0);
    h.push(before);
    const liveAfter = bld(100, 40); // real, committed position
    const staleCurrent = bld(0, 0); // what a lagging ref still reports

    // With the STALE baseline, the no-op dedup wrongly treats the pre-move frame as
    // equal to "current" and skips it — undo returns nothing ("appears to do nothing").
    expect(h.undo(staleCurrent)).toBeNull();

    // With the LIVE current (the fix passes the true state), the same frame reverts cleanly.
    const h2 = stack();
    h2.push(before);
    expect(h2.undo(liveAfter)).toBe(before);
  });

  it("redo restores a move that was undone", () => {
    const h = stack();
    const a = bld(0, 0), b = bld(100, 40);
    h.push(a);
    const undone = h.undo(b);          // back to a
    expect(undone).toBe(a);
    const redone = h.redo(a);          // forward to b again
    expect(redone).toBe(b);
    expect(posOf(redone)).toEqual({ x: 100, y: 40 });
  });

  it("a no-op push (click/select with no actual change) is skipped by undo (B32)", () => {
    const h = stack();
    const a = bld(0, 0);
    h.push(a);          // e.g. a select-click pushed a frame but nothing changed
    // current is identical to the pushed frame → there is nothing meaningful to undo
    expect(h.undo(bld(0, 0))).toBeNull();
  });

  it("a no-op frame stacked on a real edit is skipped so one undo reaches the real one", () => {
    const h = stack();
    const a = bld(0, 0);
    h.push(a);                 // real move boundary
    const b = bld(50, 0);      // moved
    h.push(b);                 // then a no-op (select-click) at the new spot
    // current still equals b (the click changed nothing); one undo should reach a.
    const reverted = h.undo(bld(50, 0));
    expect(reverted).toBe(a);
    expect(posOf(reverted)).toEqual({ x: 0, y: 0 });
  });

  it("multiple distinct moves undo/redo one transaction at a time", () => {
    const h = stack();
    const s0 = bld(0, 0), s1 = bld(10, 0), s2 = bld(10, 10);
    h.push(s0); /* → s1 */
    h.push(s1); /* → s2 */
    expect(h.undo(s2)).toBe(s1);   // first undo: s2 → s1
    expect(h.undo(s1)).toBe(s0);   // second undo: s1 → s0
    expect(h.undo(s0)).toBeNull(); // nothing left
    expect(h.redo(s0)).toBe(s1);   // redo climbs back
    expect(h.redo(s1)).toBe(s2);
  });

  it("an unrelated edit after an undo does not let redo clobber it (push clears the future)", () => {
    const h = stack();
    const s0 = bld(0, 0), s1 = bld(10, 0);
    h.push(s0);                    // move → s1
    expect(h.undo(s1)).toBe(s0);   // back to s0, future = [s1]
    // now make a DIFFERENT edit (e.g. a vertex edit) from s0
    const v0 = { els: [{ id: "b1", cx: 0, cy: 0, vtx: 1 }] };
    h.push(s0);                    // new transaction off s0 → clears the stale future
    expect(h.canRedo()).toBe(false);
    expect(h.undo(v0)).toBe(s0);   // undo reverts the vertex edit, not the dropped move
  });

  it("interrupted drag: drop() removes the frame pushed at drag-start (no half-command)", () => {
    const h = stack();
    const before = bld(0, 0);
    h.push(before);                 // drag-start pushed a frame
    expect(h.canUndo()).toBe(true);
    // Esc / lost focus mid-drag: caller restores `before` and drops the frame.
    const dropped = h.drop();
    expect(dropped).toBe(before);
    expect(h.canUndo()).toBe(false); // stack is clean — nothing dangling to undo
    expect(h.drop()).toBeNull();     // dropping an empty stack is safe
  });

  it("canUndo/canRedo reflect the stacks", () => {
    const h = stack();
    expect(h.canUndo()).toBe(false);
    expect(h.canRedo()).toBe(false);
    h.push(bld(0, 0));
    expect(h.canUndo()).toBe(true);
    h.undo(bld(5, 5));
    expect(h.canRedo()).toBe(true);
  });

  it("the past stack is capped at `limit` (old frames fall off, newest kept)", () => {
    const h = createHistoryStack({ keyOf, limit: 3 });
    for (let i = 1; i <= 5; i++) h.push(bld(i, 0));
    expect(h.snapshotStacks().past.map((s) => s.els[0].cx)).toEqual([3, 4, 5]);
  });

  it("reset clears both stacks; bad keyOf throws", () => {
    const h = stack();
    h.push(bld(0, 0));
    h.reset();
    expect(h.canUndo()).toBe(false);
    expect(h.canRedo()).toBe(false);
    expect(() => createHistoryStack({})).toThrow();
  });
});
