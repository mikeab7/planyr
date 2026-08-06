import { describe, it, expect } from "vitest";
import { PHASE, loadStatusLine, isLoading, mergeAddQueue, queueKey, deferredAddNotice } from "../src/workspaces/doc-review/lib/stitchLoadState.js";

/* NEW-1 / NEW-2 — the owner's report: clicking a sheet row (or its plus button) did nothing,
 * silently, with zero network requests; and the status bar read "Rendering…" permanently, unchanged
 * after 20+ seconds, over an empty canvas. Both are the same defect: a long critical section with
 * no progress and no failure surface. */

describe("loadStatusLine — the status bar reports real state, never a fixed placeholder", () => {
  it("says nothing when nothing is loading", () => {
    expect(loadStatusLine(null)).toBe("");
    expect(loadStatusLine({ phase: PHASE.IDLE })).toBe("");
  });

  it("counts sheets while drawing, so 20 seconds of work never looks like 0 seconds of work", () => {
    const a = loadStatusLine({ phase: PHASE.RENDERING, done: 0, total: 8 });
    const b = loadStatusLine({ phase: PHASE.RENDERING, done: 3, total: 8 });
    expect(a).toContain("1 of 8");
    expect(b).toContain("4 of 8");
    expect(a).not.toBe(b); // the old bug in one assertion: the line MOVED
  });

  it("names the file it is fetching", () => {
    expect(loadStatusLine({ phase: PHASE.FETCHING, done: 0, total: 2, name: "JACINTOPORT.pdf" }))
      .toContain("JACINTOPORT.pdf");
  });

  it("never renders a count it does not have", () => {
    expect(loadStatusLine({ phase: PHASE.RENDERING, total: 0 })).toBe("Drawing the saved set…");
  });

  it("distinguishes a user's own add from the saved-set load", () => {
    expect(loadStatusLine({ phase: PHASE.ADDING, name: "A227" })).toBe("Adding A227…");
    expect(loadStatusLine({ phase: PHASE.OPENING, name: "set.pdf" })).toBe("Opening set.pdf…");
  });
});

describe("isLoading — only a load owns the canvas", () => {
  it("is true while fetching or drawing the saved set", () => {
    expect(isLoading({ phase: PHASE.FETCHING })).toBe(true);
    expect(isLoading({ phase: PHASE.RENDERING })).toBe(true);
  });
  it("is false when idle, and false for the user's own add/open (which must not block the next one)", () => {
    expect(isLoading(null)).toBe(false);
    expect(isLoading({ phase: PHASE.IDLE })).toBe(false);
    expect(isLoading({ phase: PHASE.ADDING })).toBe(false);
    expect(isLoading({ phase: PHASE.OPENING })).toBe(false);
  });
});

describe("mergeAddQueue — a click during a load is remembered, never dropped", () => {
  const sheet = (srcId, pageNum) => ({ kind: "sheet", srcId, pageNum });

  it("keeps every distinct add the user made while the load held the canvas", () => {
    let q = [];
    q = mergeAddQueue(q, sheet("A", 3));
    q = mergeAddQueue(q, sheet("A", 7));
    expect(q.map(queueKey)).toEqual(["sheet:A:3", "sheet:A:7"]);
  });

  it("collapses a double-click into ONE queued add", () => {
    let q = mergeAddQueue([], sheet("A", 3));
    q = mergeAddQueue(q, sheet("A", 3));
    expect(q).toHaveLength(1);
  });

  it("tells a group apart from a single page from the same source", () => {
    expect(queueKey({ kind: "group", srcId: "A", groupKey: "g0" })).not.toBe(queueKey(sheet("A", 0)));
  });

  it("never mutates the queue it was handed", () => {
    const before = [sheet("A", 1)];
    const after = mergeAddQueue(before, sheet("A", 2));
    expect(before).toHaveLength(1);
    expect(after).toHaveLength(2);
  });

  it("ignores a null request instead of queueing junk", () => {
    expect(mergeAddQueue([], null)).toEqual([]);
  });
});

describe("deferredAddNotice — the press gets an answer in the same beat", () => {
  it("is silent only when nothing was deferred", () => {
    expect(deferredAddNotice([])).toBe("");
  });
  it("answers a single deferred press", () => {
    expect(deferredAddNotice([{ kind: "sheet", srcId: "A", pageNum: 1 }])).toMatch(/still loading/i);
  });
  it("counts several", () => {
    const q = [{ kind: "sheet", srcId: "A", pageNum: 1 }, { kind: "sheet", srcId: "A", pageNum: 2 }];
    expect(deferredAddNotice(q)).toContain("2 sheets");
  });
});
