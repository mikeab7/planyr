/* Regression: Schedule grid keyboard column navigation must skip HIDDEN columns so the
 * cell-selection outline never lands on (and disappears behind) an off-table column.
 *
 * The reporter's layout hides Health / Status / Owner, which sit immediately LEFT of Cost
 * in the master registry. Pressing ArrowLeft from Cost used to walk the cursor onto those
 * hidden columns and the blue outline vanished for several presses. These tests lock the
 * pure algorithm that drives the fix (mirrored inline in public/sequence/index.html).
 */
import { describe, it, expect } from "vitest";
import { visibleColMasterIdxs, snapToVisible, stepVisibleCol, stepVisibleColByIdx } from "../src/workspaces/scheduler/lib/gridColNav.js";

// The real master registry order from public/sequence/index.html (COLS).
const MASTER = [
  "id", "name", "start", "end", "duration", "predecessors", "successors",
  "health", "status", "responsibleParty", "cost", "notes",
  "percentComplete", "budget", "actualCost",
];
const idx = (k) => MASTER.indexOf(k);

// The reporter's layout: Health(7) / Status(8) / Owner(9) hidden between Successor(6) and
// Cost(10); Id(0), %Comp/Budget/Actual also hidden.
const REPORTER_VISIBLE = ["name", "start", "end", "duration", "predecessors", "successors", "cost", "notes"];

describe("visibleColMasterIdxs — visible columns as master indices, display order", () => {
  it("maps the reporter's visible list to its master indices in order", () => {
    expect(visibleColMasterIdxs(MASTER, REPORTER_VISIBLE)).toEqual([1, 2, 3, 4, 5, 6, 10, 11]);
  });
  it("follows DISPLAY order, not numeric master order, after a reorder", () => {
    expect(visibleColMasterIdxs(MASTER, ["name", "cost", "start"])).toEqual([1, 10, 2]);
  });
  it("drops keys that aren't in the master registry", () => {
    expect(visibleColMasterIdxs(MASTER, ["name", "bogus", "cost"])).toEqual([1, 10]);
  });
  it("is safe on empty / nullish input", () => {
    expect(visibleColMasterIdxs(MASTER, [])).toEqual([]);
    expect(visibleColMasterIdxs(MASTER, undefined)).toEqual([]);
    expect(visibleColMasterIdxs(undefined, REPORTER_VISIBLE)).toEqual([]);
  });
});

describe("stepVisibleCol — the reported bug", () => {
  it("ArrowLeft from Cost lands on Successor (skips hidden Health/Status/Owner), NOT a hidden column", () => {
    const dest = stepVisibleCol(MASTER, REPORTER_VISIBLE, idx("cost"), -1);
    expect(dest).toBe(idx("successors"));
    expect(REPORTER_VISIBLE).toContain(MASTER[dest]); // destination is on screen
  });
  it("ArrowRight from Successor lands back on Cost (skips the same hidden trio)", () => {
    expect(stepVisibleCol(MASTER, REPORTER_VISIBLE, idx("successors"), +1)).toBe(idx("cost"));
  });
  it("never returns a hidden master index while walking the whole visible row in either direction", () => {
    const visIdxs = REPORTER_VISIBLE.map(idx);
    // left to right
    let cur = visIdxs[0];
    for (let n = 0; n < 12; n++) {
      expect(visIdxs).toContain(cur);
      cur = stepVisibleCol(MASTER, REPORTER_VISIBLE, cur, +1);
    }
    // right to left
    cur = visIdxs[visIdxs.length - 1];
    for (let n = 0; n < 12; n++) {
      expect(visIdxs).toContain(cur);
      cur = stepVisibleCol(MASTER, REPORTER_VISIBLE, cur, -1);
    }
  });
});

describe("stepVisibleCol — clamping at the visible edges", () => {
  it("ArrowLeft from the leftmost visible column (Name, since Id is hidden) stays put — does NOT step onto hidden Id", () => {
    expect(stepVisibleCol(MASTER, REPORTER_VISIBLE, idx("name"), -1)).toBe(idx("name"));
  });
  it("ArrowRight from the rightmost visible column (Notes) stays put", () => {
    expect(stepVisibleCol(MASTER, REPORTER_VISIBLE, idx("notes"), +1)).toBe(idx("notes"));
  });
});

describe("stepVisibleCol — display-order walk after a reorder", () => {
  const REORDERED = ["name", "cost", "start", "notes"]; // master idxs 1,10,2,11
  it("steps right by DISPLAY position (Cost → Start), not by numeric master index", () => {
    expect(stepVisibleCol(MASTER, REORDERED, idx("cost"), +1)).toBe(idx("start"));
  });
  it("steps left by display position (Start → Cost)", () => {
    expect(stepVisibleCol(MASTER, REORDERED, idx("start"), -1)).toBe(idx("cost"));
  });
});

describe("stepVisibleCol — cursor starts OFF-TABLE (snaps onto a visible column)", () => {
  it("from hidden Id (master 0) ArrowRight snaps to the first visible column (Name)", () => {
    expect(stepVisibleCol(MASTER, REPORTER_VISIBLE, idx("id"), +1)).toBe(idx("name"));
  });
  it("from hidden Owner (master 9) ArrowLeft snaps back to Successor", () => {
    expect(stepVisibleCol(MASTER, REPORTER_VISIBLE, idx("responsibleParty"), -1)).toBe(idx("successors"));
  });
  it("from hidden Owner (master 9) ArrowRight snaps forward to Cost", () => {
    expect(stepVisibleCol(MASTER, REPORTER_VISIBLE, idx("responsibleParty"), +1)).toBe(idx("cost"));
  });
  it("returns the cursor unchanged when there are no visible columns at all", () => {
    expect(stepVisibleCol(MASTER, [], 10, -1)).toBe(10);
  });
});

describe("stepVisibleColByIdx — precomputed-index core (exact shape the in-cell Tab mirror uses)", () => {
  const visIdxs = REPORTER_VISIBLE.map(idx); // [1,2,3,4,5,6,10,11]
  it("matches stepVisibleCol for the reporter layout in both directions", () => {
    expect(stepVisibleColByIdx(visIdxs, idx("cost"), -1)).toBe(idx("successors"));
    expect(stepVisibleColByIdx(visIdxs, idx("successors"), +1)).toBe(idx("cost"));
  });
  it("clamps at the visible edges and snaps an off-table cursor onto the table", () => {
    expect(stepVisibleColByIdx(visIdxs, idx("name"), -1)).toBe(idx("name"));   // left edge
    expect(stepVisibleColByIdx(visIdxs, idx("notes"), +1)).toBe(idx("notes")); // right edge
    expect(stepVisibleColByIdx(visIdxs, idx("id"), +1)).toBe(idx("name"));     // off-table → snap
  });
  it("leaves the cursor put when there are no visible columns", () => {
    expect(stepVisibleColByIdx([], 7, +1)).toBe(7);
    expect(stepVisibleColByIdx(undefined, 7, -1)).toBe(7);
  });
});

describe("snapToVisible — closest-visible used when the selected column is hidden (dir 0)", () => {
  const visIdxs = REPORTER_VISIBLE.map(idx); // [1,2,3,4,5,6,10,11]
  it("snaps a hidden selection to the nearest visible column by master distance", () => {
    // Owner(9) is distance 3 from Successor(6) and 1 from Cost(10) → Cost wins
    expect(snapToVisible(visIdxs, idx("responsibleParty"), 0)).toBe(idx("cost"));
    // Status(8) is distance 2 from Successor(6) and 2 from Cost(10) → first-seen (Successor) wins on a tie
    expect(snapToVisible(visIdxs, idx("status"), 0)).toBe(idx("successors"));
  });
  it("returns the cursor unchanged when nothing is visible", () => {
    expect(snapToVisible([], 5, 0)).toBe(5);
  });
});
