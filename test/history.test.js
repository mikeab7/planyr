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

  it("B315 repro: undo reading a STALE current snapshots/compares wrong → 'does nothing' or partial revert", () => {
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

/* ⛔ NEW-2 (B648353) — MULTI-STEP UNDO/REDO FOR THE HISTORY DROPDOWN.
 *
 * `undoN`/`redoN` must produce the IDENTICAL end state as calling `undo()`/`redo()` N times in a
 * row with an up-to-date `current` at each step (the thing a component CANNOT safely do itself —
 * see history.js's own header comment on why). `recentUndoSteps`/`recentRedoSteps` must describe
 * exactly the frames a run would consume, without mutating the stacks (a dropdown peek, not a pop). */
describe("NEW-2 (B648353) — undoN/redoN batch a whole run into one target snapshot", () => {
  it("undoN(3) lands on the same state three single undo() calls would, threading the true pivot each step", () => {
    const h = stack();
    const s0 = bld(0, 0), s1 = bld(10, 0), s2 = bld(10, 10), s3 = bld(20, 10);
    h.push(s0); h.push(s1); h.push(s2); // → current is s3

    const hRef = stack(); // reference: three single-step undos, each with the TRUE current
    hRef.push(s0); hRef.push(s1); hRef.push(s2);
    let cur = s3;
    cur = hRef.undo(cur); // → s2
    cur = hRef.undo(cur); // → s1
    cur = hRef.undo(cur); // → s0

    expect(h.undoN(s3, 3)).toBe(cur);
    expect(posOf(cur)).toEqual({ x: 0, y: 0 });
  });

  it("undoN stops early (returns the deepest reachable frame) when n exceeds what's available", () => {
    const h = stack();
    const s0 = bld(0, 0), s1 = bld(10, 0);
    h.push(s0); // → current is s1
    expect(h.undoN(s1, 5)).toBe(s0);
    expect(h.canUndo()).toBe(false);
  });

  it("undoN skips no-op frames exactly like undo() does (B32), so N counts real operations", () => {
    const h = stack();
    const a = bld(0, 0), b = bld(50, 0);
    h.push(a);            // real move boundary → b
    h.push(b);             // then a no-op (select click) at b — current stays b
    // undoN(1) from `b` must reach `a` directly, the same as a single undo() would (B32 dedup).
    expect(h.undoN(b, 1)).toBe(a);
  });

  it("undoN then redoN round-trips back to the original current", () => {
    const h = stack();
    const s0 = bld(0, 0), s1 = bld(10, 0), s2 = bld(10, 10);
    h.push(s0); h.push(s1); // → current s2
    const target = h.undoN(s2, 2); // → s0
    expect(target).toBe(s0);
    const redone = h.redoN(s0, 2);
    expect(redone).toBe(s2);
    expect(h.canRedo()).toBe(false);
    expect(h.canUndo()).toBe(true);
  });

  it("redoN stops early when n exceeds the future stack", () => {
    const h = stack();
    const s0 = bld(0, 0), s1 = bld(10, 0);
    h.push(s0);
    const back = h.undo(s1); // → s0, future = [s1]
    expect(h.redoN(back, 5)).toBe(s1);
    expect(h.canRedo()).toBe(false);
  });

  it("undoN/redoN return null and touch nothing when there is nothing to move", () => {
    const h = stack();
    expect(h.undoN(bld(0, 0), 3)).toBeNull();
    expect(h.redoN(bld(0, 0), 3)).toBeNull();
  });
});

describe("NEW-2 (B648353) — recentUndoSteps/recentRedoSteps peek without mutating the stacks", () => {
  it("recentUndoSteps lists steps newest-first as { before, after } pairs", () => {
    const h = stack();
    const s0 = bld(0, 0), s1 = bld(10, 0), s2 = bld(10, 10);
    h.push(s0); h.push(s1); // → current s2
    const steps = h.recentUndoSteps(s2, 10);
    expect(steps).toEqual([
      { before: s1, after: s2 },
      { before: s0, after: s1 },
    ]);
    // Non-destructive — the real undo still sees the full stack afterward.
    expect(h.snapshotStacks().past).toEqual([s0, s1]);
    expect(h.undo(s2)).toBe(s1);
  });

  it("recentUndoSteps respects the limit and skips no-op frames (matches what undoN would consume)", () => {
    const h = stack();
    const a = bld(0, 0), b = bld(50, 0);
    h.push(a);
    h.push(b); // no-op frame stacked at b
    const steps = h.recentUndoSteps(b, 10);
    expect(steps).toEqual([{ before: a, after: b }]); // the no-op frame produces no separate step
    expect(steps.length).toBe(1);
  });

  it("recentRedoSteps lists the future stack newest-first", () => {
    const h = stack();
    const s0 = bld(0, 0), s1 = bld(10, 0), s2 = bld(10, 10);
    h.push(s0); h.push(s1);
    let cur = s2;
    cur = h.undo(cur); // → s1, future=[s2]
    cur = h.undo(cur); // → s0, future=[s2,s1]
    const steps = h.recentRedoSteps(cur, 10);
    expect(steps).toEqual([
      { before: s0, after: s1 },
      { before: s1, after: s2 },
    ]);
    expect(h.snapshotStacks().future).toEqual([s2, s1]);
  });

  it("both peeks return an empty array on an empty stack", () => {
    const h = stack();
    expect(h.recentUndoSteps(bld(0, 0), 10)).toEqual([]);
    expect(h.recentRedoSteps(bld(0, 0), 10)).toEqual([]);
  });
});

/* ═══ NEW-5 — A SELECTION CLICK IS NOT A DOCUMENT CHANGE ═════════════════════════════════════════
 *
 * Reported live on production 2026-08-12 (site `smsqi16s9ej4`, Building 3): load fresh — Undo
 * correctly DISABLED — single left-click to select, no drag, no modifier, pointer does not move,
 * and Undo turns ENABLED while the database stays byte-identical (md5 over all 50 `site_elements`
 * rows unchanged, `updated_at` does not advance). Undo-enabled is the only signal that a plan has
 * been modified; once selection alone arms it, a plan you merely LOOKED at is indistinguishable
 * from one you edited.
 *
 * ⛔ BOTH DIRECTIONS ARE ASSERTED. A test that only checks "undo works" passes on the defect. */
describe("NEW-5 — canUndo answers about the DOCUMENT, not about the stack's depth", () => {
  const doc = (els) => ({ parcels: [], els, markups: [], measures: [], callouts: [] });
  const key = (s) => JSON.stringify(s);

  it("a frame pushed with no mutation behind it does NOT enable Undo", () => {
    const h = createHistoryStack({ keyOf: key });
    const els = [{ id: "b1", x: 0 }];
    const state = doc(els);
    expect(h.canUndo(state)).toBe(false);
    // The press handler pushes the pre-mutation snapshot before it knows a drag is coming…
    h.push(state);
    // …and the gesture turns out to be a plain selection click: same collections, same references.
    expect(h.canUndo({ ...state })).toBe(false);
    expect(h.canUndo({ ...state }, { exact: true })).toBe(false);
  });

  it("…and a real edit DOES enable it, in the same shape", () => {
    const h = createHistoryStack({ keyOf: key });
    const before = doc([{ id: "b1", x: 0 }]);
    h.push(before);
    const after = doc([{ id: "b1", x: 1 }]);      // React replaces the array on a real mutation
    expect(h.canUndo(after)).toBe(true);
    expect(h.canUndo(after, { exact: true })).toBe(true);
    expect(h.undo(after)).toEqual(before);
  });

  it("six selection clicks leave six frames and Undo still reads disabled", () => {
    const h = createHistoryStack({ keyOf: key });
    const state = doc([{ id: "b1" }]);
    for (let i = 0; i < 6; i++) h.push(state);
    expect(h.snapshotStacks().past.length).toBe(6);
    expect(h.canUndo({ ...state })).toBe(false);
    // …and the honest predicate agrees with what undo() would actually do.
    expect(h.undo({ ...state })).toBe(null);
  });

  it("a reallocated but value-identical frame is refused by the exact check", () => {
    const h = createHistoryStack({ keyOf: key });
    h.push(doc([{ id: "b1", x: 0 }]));
    const reallocated = doc([{ id: "b1", x: 0 }]);   // new arrays, same content
    expect(h.canUndo(reallocated)).toBe(true);        // cheap path errs toward "enabled"…
    expect(h.canUndo(reallocated, { exact: true })).toBe(false); // …exact tells the truth
    expect(h.undo(reallocated)).toBe(null);           // and undo() has always agreed with exact
  });

  it("legacy callers that pass nothing keep the old behaviour exactly", () => {
    const h = createHistoryStack({ keyOf: key });
    expect(h.canUndo()).toBe(false);
    h.push(doc([]));
    expect(h.canUndo()).toBe(true);
  });

  it("redo is empty on a fresh stack — the control was mislabelled, the state was right", () => {
    const h = createHistoryStack({ keyOf: key });
    expect(h.canRedo()).toBe(false);
    expect(h.snapshotStacks().future).toEqual([]);
  });
});
