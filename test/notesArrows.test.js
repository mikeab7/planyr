/* notesArrows — arrows between rich-text boxes, on the DOCUMENT (NEW-2, 2026-09-22).
 *
 * Replaces the retired sketch canvas's own boxes-and-arrows model: an arrow is now a
 * `{from,to}` pair living in `doc.attrs.arrows`, connecting two `noteAnchor` boxes directly.
 * These are the pure decisions — normalise, add (with a refusal reason), remove, and the
 * TOMBSTONE-DELETES cascade a box's own delete must run.
 */
import { describe, it, expect } from "vitest";
import {
  addArrow, cascadeRemoveArrows, edgePoint, normalizeArrows, removeArrow,
} from "../src/workspaces/notes/lib/notesArrows.js";

const ids = new Set(["a", "b", "c"]);

describe("normalizeArrows — defensive reading", () => {
  it("keeps well-formed arrows between valid ids", () => {
    expect(normalizeArrows([{ from: "a", to: "b" }], ids)).toEqual([{ from: "a", to: "b" }]);
  });

  it("drops a self-arrow, a dangling arrow, and a duplicate", () => {
    const raw = [
      { from: "a", to: "a" },
      { from: "a", to: "ghost" },
      { from: "a", to: "b" },
      { from: "a", to: "b" },
    ];
    expect(normalizeArrows(raw, ids)).toEqual([{ from: "a", to: "b" }]);
  });

  it("junk is dropped, never thrown on", () => {
    expect(normalizeArrows(null, ids)).toEqual([]);
    expect(normalizeArrows("nope", ids)).toEqual([]);
    expect(normalizeArrows([null, 3, { from: "a" }, { to: "b" }], ids)).toEqual([]);
  });

  it("accepts a plain array of ids as well as a Set", () => {
    expect(normalizeArrows([{ from: "a", to: "b" }], ["a", "b"])).toEqual([{ from: "a", to: "b" }]);
  });
});

describe("addArrow — refused WITH A REASON, never a silent no-op", () => {
  it("adds a new arrow", () => {
    const r = addArrow([], "a", "b", ids);
    expect(r.added).toBe(true);
    expect(r.arrows).toEqual([{ from: "a", to: "b" }]);
  });

  it("refuses a self-arrow, by name", () => {
    const r = addArrow([], "a", "a", ids);
    expect(r.added).toBe(false);
    expect(r.reason).toMatch(/itself/);
  });

  it("refuses an arrow to/from a box that does not exist, by name", () => {
    expect(addArrow([], "a", "ghost", ids)).toMatchObject({ added: false, reason: expect.stringMatching(/two boxes/) });
    expect(addArrow([], "ghost", "a", ids)).toMatchObject({ added: false, reason: expect.stringMatching(/two boxes/) });
  });

  it("refuses a duplicate of an arrow already there, by name", () => {
    const once = addArrow([], "a", "b", ids).arrows;
    const twice = addArrow(once, "a", "b", ids);
    expect(twice.added).toBe(false);
    expect(twice.reason).toMatch(/already there/);
  });

  it("an arrow the OTHER way is a different arrow, and is allowed", () => {
    const once = addArrow([], "a", "b", ids).arrows;
    const back = addArrow(once, "b", "a", ids);
    expect(back.added).toBe(true);
    expect(back.arrows).toHaveLength(2);
  });
});

describe("removeArrow", () => {
  it("removes exactly the named arrow and leaves the rest", () => {
    const arrows = [{ from: "a", to: "b" }, { from: "b", to: "c" }];
    expect(removeArrow(arrows, "a", "b")).toEqual([{ from: "b", to: "c" }]);
  });

  it("removing an arrow that is not there changes nothing", () => {
    const arrows = [{ from: "a", to: "b" }];
    expect(removeArrow(arrows, "x", "y")).toEqual(arrows);
  });
});

describe("⛔ cascadeRemoveArrows — TOMBSTONE-DELETES for arrows", () => {
  it("a deleted box takes every arrow that named it, at EITHER end", () => {
    const arrows = [{ from: "a", to: "b" }, { from: "b", to: "c" }, { from: "a", to: "c" }];
    const { arrows: kept, removed } = cascadeRemoveArrows(arrows, ["b"]);
    expect(kept).toEqual([{ from: "a", to: "c" }]);
    expect(removed).toEqual([{ from: "a", to: "b" }, { from: "b", to: "c" }]);
  });

  it("deleting several boxes at once cascades all of them in one pass", () => {
    const arrows = [{ from: "a", to: "b" }, { from: "b", to: "c" }, { from: "a", to: "c" }];
    const { arrows: kept, removed } = cascadeRemoveArrows(arrows, ["a", "b"]);
    expect(kept).toEqual([]);
    expect(removed).toHaveLength(3);
  });

  it("deleting a box nothing points at leaves every arrow untouched", () => {
    const arrows = [{ from: "a", to: "b" }];
    const { arrows: kept, removed } = cascadeRemoveArrows(arrows, ["c"]);
    expect(kept).toEqual(arrows);
    expect(removed).toEqual([]);
  });
});

describe("edgePoint — reused from notesSketchModel, not reimplemented", () => {
  it("lands on the source box's own edge, aimed at the destination's centre", () => {
    const box = { x: 0, y: 0, w: 100, h: 50 };
    const p = edgePoint(box, 300, 25);
    expect(p.x).toBeCloseTo(100, 5);
    expect(p.y).toBeCloseTo(25, 5);
  });
});
