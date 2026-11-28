import { describe, it, expect } from "vitest";
import { createHistoryStack } from "../src/workspaces/site-planner/lib/history.js";
import { nextUndoEntry, undoToastWords } from "../src/workspaces/site-planner/lib/undoToast.js";

// A tiny planner: state is { parcels } and every real change replaces the array (as React state does).
const mk = () => {
  const h = createHistoryStack({ keyOf: (s) => JSON.stringify(s) });
  let state = { parcels: ["P1", "P2", "P3", "P4"] };
  const wrap = () => ({ ...state }); // a fresh WRAPPER over the same collection references, like stateRef.current
  return {
    h,
    cur: wrap,
    act(fn) { h.push(wrap()); const f = h.top(); state = { ...state, parcels: fn(state.parcels) }; return f; },
    click() { h.push(wrap()); return h.top(); }, // a selection click: a no-op frame
    undoN(n) { const t = h.undoN(wrap(), n); if (t) state = { ...t }; },
    get parcels() { return state.parcels; },
  };
};

describe("history.stepsAreTop", () => {
  it("one action is the top step", () => {
    const p = mk();
    const f = p.act((a) => a.filter((x) => x !== "P2"));
    expect(p.h.stepsAreTop([f], p.cur())).toBe(true);
  });
  it("selection clicks (no-op frames) between and after keep it honest", () => {
    const p = mk();
    const f1 = p.act((a) => a.filter((x) => x !== "P2"));
    p.click();
    const f2 = p.act((a) => a.filter((x) => x !== "P3"));
    p.click(); p.click();
    expect(p.h.stepsAreTop([f1, f2], p.cur())).toBe(true);
  });
  it("another real edit after it makes it dishonest", () => {
    const p = mk();
    const f = p.act((a) => a.filter((x) => x !== "P2"));
    p.act((a) => [...a, "P9"]);
    expect(p.h.stepsAreTop([f], p.cur())).toBe(false);
  });
  it("a real edit BETWEEN two merged actions breaks the run", () => {
    const p = mk();
    const f1 = p.act((a) => a.filter((x) => x !== "P2"));
    p.act((a) => [...a, "P9"]);
    const f2 = p.act((a) => a.filter((x) => x !== "P3"));
    expect(p.h.stepsAreTop([f1, f2], p.cur())).toBe(false);
    expect(p.h.stepsAreTop([f2], p.cur())).toBe(true);
  });
  it("Ctrl+Z (undo) withdraws it, and so does undo then redo", () => {
    const p = mk();
    const f = p.act((a) => a.filter((x) => x !== "P2"));
    p.undoN(1);
    expect(p.h.stepsAreTop([f], p.cur())).toBe(false);
  });
  it("null current = the newest action has not committed yet", () => {
    const p = mk();
    const f1 = p.act((a) => a.filter((x) => x !== "P2"));
    p.h.push(p.cur()); const f2 = p.h.top(); // pushed, change not applied yet
    expect(p.h.stepsAreTop([f1, f2], null)).toBe(true);
  });
  it("empty / missing frames are never honest", () => {
    const p = mk();
    expect(p.h.stepsAreTop([], p.cur())).toBe(false);
    expect(p.h.stepsAreTop(null, p.cur())).toBe(false);
  });
});

describe("one undo toast that keeps count", () => {
  const del = (frame, name) => ({ mergeKey: "delete-parcel", frame, count: 1, names: [name], text: `Deleted ${name}`, many: (n) => `Deleted ${n} parcels` });
  it("three deletes in a row merge, and Undo all 3 reverses exactly those three", () => {
    const p = mk();
    let entry = null;
    for (const name of ["P2", "P3", "P4"]) {
      p.h.push(p.cur()); const frame = p.h.top();
      entry = nextUndoEntry(entry, del(frame, name), (fr) => p.h.stepsAreTop(fr, null));
      // commit the change
      const s = p.cur(); p.h.drop(); p.act(() => s.parcels.filter((x) => x !== name));
      entry.frames[entry.frames.length - 1] = p.h.top();
    }
    expect(entry.frames.length).toBe(3);
    const w = undoToastWords(entry);
    expect(w.text).toBe("Deleted 3 parcels");
    expect(w.detail).toBe("P2, P3, P4");
    expect(w.label).toBe("Undo all 3");
    expect(p.h.stepsAreTop(entry.frames, p.cur())).toBe(true);
    p.undoN(entry.frames.length);
    expect(p.parcels).toEqual(["P1", "P2", "P3", "P4"]);
  });
  it("a different action replaces instead of merging", () => {
    const p = mk();
    p.h.push(p.cur()); const f1 = p.h.top();
    const a = nextUndoEntry(null, del(f1, "P2"), () => true);
    p.h.push(p.cur()); const f2 = p.h.top();
    const b = nextUndoEntry(a, { mergeKey: null, frame: f2, text: "Locked P3" }, () => true);
    expect(b.frames).toEqual([f2]);
    expect(undoToastWords(b)).toEqual({ text: "Locked P3", detail: "", label: "Undo" });
  });
  it("same kind but not the newest steps any more starts fresh", () => {
    const p = mk();
    p.h.push(p.cur()); const f1 = p.h.top();
    const a = nextUndoEntry(null, del(f1, "P2"), () => true);
    p.h.push(p.cur()); const f2 = p.h.top();
    const b = nextUndoEntry(a, del(f2, "P3"), () => false);
    expect(b.frames).toEqual([f2]);
    expect(undoToastWords(b).label).toBe("Undo");
  });
  it("long name lists are shortened with a count", () => {
    const w = undoToastWords({ frames: [1, 2, 3, 4, 5, 6], count: 6, names: ["A", "B", "C", "D", "E", "F"], many: (n) => `Deleted ${n} parcels` });
    expect(w.detail).toBe("A, B, C, D and 2 more");
  });
});
