/* ONE GESTURE ON EMPTY PAGE, TWO MEANINGS, DECIDED BY DISTANCE (B421494).
 *
 * ⛔ THE OWNER NAMED THE HARD PART HIMSELF: *"the same drag on empty space currently means 'make a
 * box here'. One gesture has to learn two meanings — a drag beyond a threshold selects, a press
 * without a drag places. Get that boundary right and prove it with a test at several drag
 * distances including zero and one pixel."*
 *
 * That is what this file is. The threshold is the only thing standing between a working feature
 * and a WORSE version of the one that already worked — get it wrong low and every attempt to
 * select leaves a stray box behind; get it wrong high and the marquee never starts. Both failures
 * are silent, and both would land on the owner rather than on a test.
 *
 * The distances below are exhaustive around the boundary rather than illustrative: 0, 1, and every
 * value either side of `DRAG_SLOP`, on both axes and diagonally.
 */
import { describe, expect, it } from "vitest";

import {
  applyMarquee, boxesInMarquee, dragDistance, DRAG_SLOP, gestureOutcome, marqueeRect,
  moveSelection, nudgeDelta, NUDGE_STEP, NUDGE_STEP_FAST, rectsOverlap, toggleSelection,
} from "../src/workspaces/notes/lib/notesMarquee.js";

const at = (x, y) => ({ x, y });

describe("⛔ the boundary between placing and selecting", () => {
  it("a press that never moved PLACES — zero pixels", () => {
    expect(gestureOutcome(at(100, 100), at(100, 100))).toBe("place");
  });

  it("a press that moved ONE pixel still PLACES — every real hand trembles", () => {
    expect(gestureOutcome(at(100, 100), at(101, 100))).toBe("place");
    expect(gestureOutcome(at(100, 100), at(100, 101))).toBe("place");
    expect(gestureOutcome(at(100, 100), at(99, 99))).toBe("place");
  });

  it("⛔ EVERY DISTANCE EITHER SIDE OF THE THRESHOLD, on both axes and diagonally", () => {
    for (let d = 0; d <= DRAG_SLOP; d += 1) {
      expect(gestureOutcome(at(0, 0), at(d, 0)), `${d}px right`).toBe("place");
      expect(gestureOutcome(at(0, 0), at(0, d)), `${d}px down`).toBe("place");
      expect(gestureOutcome(at(0, 0), at(-d, 0)), `${d}px left`).toBe("place");
    }
    for (let d = DRAG_SLOP + 1; d <= DRAG_SLOP + 20; d += 1) {
      expect(gestureOutcome(at(0, 0), at(d, 0)), `${d}px right`).toBe("select");
      expect(gestureOutcome(at(0, 0), at(0, -d)), `${d}px up`).toBe("select");
    }
    // Diagonal: it is the STRAIGHT-LINE distance, not the larger axis, so a gesture that moved
    // 3 across and 3 down (4.24px) is a drag even though neither axis reached the threshold.
    expect(gestureOutcome(at(0, 0), at(3, 3))).toBe("select");
    expect(gestureOutcome(at(0, 0), at(2, 2))).toBe("place");   // 2.83px
  });

  it("⛔ RETURNS EXACTLY ONE ANSWER, ALWAYS — never both, never neither", () => {
    for (let d = 0; d < 40; d += 1) {
      const out = gestureOutcome(at(0, 0), at(d, d));
      expect(["place", "select"]).toContain(out);
    }
  });

  it("survives nonsense rather than throwing — a gesture with no end is not a drag", () => {
    expect(gestureOutcome(null, at(9, 9))).toBe("place");
    expect(gestureOutcome(at(0, 0), null)).toBe("place");
    expect(dragDistance(undefined, undefined)).toBe(0);
  });
});

describe("the band itself", () => {
  it("is the same rectangle whichever corner you started from", () => {
    const a = marqueeRect(at(10, 10), at(60, 90));
    const b = marqueeRect(at(60, 90), at(10, 10));
    expect(a).toEqual({ x: 10, y: 10, w: 50, h: 80 });
    expect(b).toEqual(a);
    expect(marqueeRect(at(60, 10), at(10, 90))).toEqual(a);
  });

  it("catches a box it TOUCHES, not only one it encloses", () => {
    const boxes = [
      { id: "a", x: 0, y: 0, w: 100, h: 40 },      // overlaps the band's corner
      { id: "b", x: 500, y: 500, w: 100, h: 40 },  // nowhere near
    ];
    expect(boxesInMarquee({ x: 80, y: 30, w: 200, h: 200 }, boxes)).toEqual(["a"]);
  });

  it("⛔ a band that merely TOUCHES an edge catches nothing — zero area is not a selection", () => {
    const boxes = [{ id: "a", x: 100, y: 100, w: 50, h: 50 }];
    expect(boxesInMarquee({ x: 0, y: 0, w: 100, h: 100 }, boxes)).toEqual([]);   // edge to edge
    expect(boxesInMarquee({ x: 0, y: 0, w: 101, h: 101 }, boxes)).toEqual(["a"]);
  });

  /* ⛔ THIS CASE WAS WRITTEN THE WRONG WAY ROUND FIRST, AND THE CODE WAS RIGHT. The first version
   * asserted that a band with no area catches nothing — which sounds obviously true and is not the
   * behaviour anybody wants: a drag straight across a row of boxes has zero HEIGHT, and refusing
   * to catch what it sweeps through would make the most natural gesture on a row of boxes do
   * nothing. A degenerate band still sweeps. The genuinely-nothing case is a band that never
   * started, and the distance threshold already rules that out before this function is reached. */
  it("⛔ a FLAT band still sweeps — dragging straight across a row catches it", () => {
    const row = [
      { id: "a", x: 0, y: 100, w: 60, h: 30 },
      { id: "b", x: 90, y: 100, w: 60, h: 30 },
      { id: "c", x: 400, y: 100, w: 60, h: 30 },
    ];
    expect(boxesInMarquee({ x: 10, y: 110, w: 200, h: 0 }, row)).toEqual(["a", "b"]);
  });

  it("…and a band ABOVE that row catches none of it", () => {
    const row = [{ id: "a", x: 0, y: 100, w: 60, h: 30 }];
    expect(boxesInMarquee({ x: 0, y: 10, w: 200, h: 20 }, row)).toEqual([]);
  });

  it("ignores a box with no identity rather than selecting a phantom", () => {
    expect(boxesInMarquee({ x: 0, y: 0, w: 999, h: 999 }, [{ x: 1, y: 1, w: 2, h: 2 }])).toEqual([]);
  });

  it("rectsOverlap is symmetric", () => {
    const a = { x: 0, y: 0, w: 10, h: 10 };
    const b = { x: 5, y: 5, w: 10, h: 10 };
    expect(rectsOverlap(a, b)).toBe(rectsOverlap(b, a));
    expect(rectsOverlap(a, b)).toBe(true);
  });
});

describe("adding and removing from a selection", () => {
  it("a plain click REPLACES the selection", () => {
    expect([...toggleSelection(new Set(["a", "b"]), "c")]).toEqual(["c"]);
  });

  it("⛔ Shift TOGGLES — it does not only add, or you can never drop one of nine", () => {
    expect([...toggleSelection(new Set(["a", "b"]), "c", { additive: true })].sort()).toEqual(["a", "b", "c"]);
    expect([...toggleSelection(new Set(["a", "b"]), "b", { additive: true })]).toEqual(["a"]);
  });

  it("a band replaces by default and adds when Shift is held", () => {
    expect([...applyMarquee(new Set(["a"]), ["b", "c"])].sort()).toEqual(["b", "c"]);
    expect([...applyMarquee(new Set(["a"]), ["b"], { additive: true })].sort()).toEqual(["a", "b"]);
  });
});

describe("moving a selection", () => {
  const set = [
    { id: "a", x: 100, y: 100, w: 50, h: 20 },
    { id: "b", x: 300, y: 240, w: 80, h: 20 },
  ];

  it("moves every member by the same delta", () => {
    expect(moveSelection(set, { dx: 25, dy: -10 })).toEqual([
      { id: "a", x: 125, y: 90 },
      { id: "b", x: 325, y: 230 },
    ]);
  });

  it("⛔ CLAMPS THE SET, NOT EACH BOX — the arrangement must not deform", () => {
    /* Dragging far left: the leftmost box stops at the edge, and the other must stop by the SAME
     * amount. Clamping members independently is what silently destroys a layout somebody built. */
    const moved = moveSelection(set, { dx: -500, dy: 0 });
    expect(moved[0].x).toBe(0);
    expect(moved[1].x).toBe(200);                       // 300 − 100, the same delta as the first
    expect(moved[1].x - moved[0].x).toBe(200);          // the gap is unchanged
  });

  it("…and the same going up", () => {
    const moved = moveSelection(set, { dx: 0, dy: -1000 });
    expect(moved[0].y).toBe(0);
    expect(moved[1].y).toBe(140);                       // the gap of 140 survives
  });

  it("…and against a right-hand edge", () => {
    const moved = moveSelection(set, { dx: 1000, dy: 0 }, { maxX: 500 });
    expect(moved[1].x + 80).toBeLessThanOrEqual(500);
    expect(moved[1].x - moved[0].x).toBe(200);
  });

  it("an empty selection moves nothing rather than throwing", () => {
    expect(moveSelection([], { dx: 5, dy: 5 })).toEqual([]);
    expect(moveSelection(null, { dx: 5, dy: 5 })).toEqual([]);
  });

  it("rounds to whole units, because a stored position is a whole number everywhere else", () => {
    expect(moveSelection([{ id: "a", x: 10, y: 10, w: 5, h: 5 }], { dx: 0.4, dy: 0.6 }))
      .toEqual([{ id: "a", x: 10, y: 11 }]);
  });
});

describe("the arrow keys", () => {
  it("nudge by one, and by ten with Shift", () => {
    expect(nudgeDelta("ArrowLeft")).toEqual({ dx: -NUDGE_STEP, dy: 0 });
    expect(nudgeDelta("ArrowRight")).toEqual({ dx: NUDGE_STEP, dy: 0 });
    expect(nudgeDelta("ArrowUp")).toEqual({ dx: 0, dy: -NUDGE_STEP });
    expect(nudgeDelta("ArrowDown")).toEqual({ dx: 0, dy: NUDGE_STEP });
    expect(nudgeDelta("ArrowDown", { shift: true })).toEqual({ dx: 0, dy: NUDGE_STEP_FAST });
  });

  it("⛔ DECLINE EVERY OTHER KEY, so typing is never mistaken for nudging", () => {
    for (const k of ["a", "Enter", "Tab", "Home", "PageDown", "Escape", "Delete", " "]) {
      expect(nudgeDelta(k), k).toBeNull();
    }
  });
});
